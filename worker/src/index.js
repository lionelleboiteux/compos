/**
 * compos-l1-cache — Cloudflare Worker edge cache in front of the Apps
 * Script JSON API backing l1.compos.fantasy-coach.fr (apps-script/Code.gs).
 *
 * Routes:
 *   GET  /                  -> the finished HTML page for the current journée
 *   GET  /journee/<name>    -> the finished HTML page for that journée
 *                              (rendered here from the KV data below -- see
 *                              render.js -- and held in the edge cache for a
 *                              minute, so visitors never fetch data from the
 *                              browser)
 *   GET  /?journee=<name>   -> cached (or live-fetched+cached) journée JSON
 *   GET  /?meta=1           -> cached (or live-fetched+cached) meta (journée list)
 *                              (the two JSON routes are kept for older cached
 *                              copies of the page and for debugging)
 *   POST /__revalidate      -> webhook, called from Code.gs on data changes:
 *                              re-fetches and overwrites KV for specific
 *                              journée(s) (always + "meta"). Requires the
 *                              X-Revalidate-Secret header.
 *   GET|POST /__warm-all    -> one-off admin command: populate KV for every
 *                              journée currently in ?meta=1. Same secret,
 *                              accepted as a header OR a ?secret= query
 *                              param so it's easy to curl by hand.
 *
 * KV key scheme deliberately mirrors Code.gs's own doGet cache-key logic
 * exactly (`cacheKey = journee ? 'journee:'+journee : 'meta'`), so a
 * revalidate call for "Journée 12" overwrites precisely the key a real
 * ?journee=Journée 12 request reads -- never a blanket flush.
 */

import { renderPage, renderErrorPage } from './render.js';

// Same URLs the old client-side page called from the browser; now fetched
// server-side, where a blocked/flaky workers.dev hostname can't reach users.
const DNP_API_BASE = 'https://dnp-l1-cache.fantasycoachfr.workers.dev';
const PRONOS_CURRENT_URL =
  'https://dmytkubjxwwwkroutvdu.supabase.co/functions/v1/api/v1/leagues/27f27a15-02a9-448a-98d5-80998e2fa52e/current';

// Fresh for 5 minutes (30s when a dependency failed -- see buildPage), then
// served stale while a background refresh runs; the stored copy lingers for
// a day so it can also cover an outage.
const PAGE_FRESH_SECONDS = 300;
const PAGE_PARTIAL_FRESH_SECONDS = 30;
const PAGE_STORE_SECONDS = 86400;
const BROWSER_TTL_SECONDS = 60;
const CURRENT_GW_TTL_SECONDS = 300;

const CORS_HEADERS = {
  // Public, read-only, non-sensitive data with no cookies/credentials, and
  // the frontend's own ?api= override (see frontend/index.html) is meant to
  // let a developer point at arbitrary hosts for local/dev testing -- a
  // strict origin allowlist would break that override for no real security
  // benefit here. If this ever needs tightening, swap for a fixed
  // 'https://l1.compos.fantasy-coach.fr'.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Revalidate-Secret',
  'Access-Control-Max-Age': '86400',
};

export default {
  /**
   * @param {Request} request
   * @param {{CACHE: KVNamespace, APPS_SCRIPT_BASE: string, REVALIDATE_SECRET: string}} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === '/__revalidate' && request.method === 'POST') {
        return await handleRevalidate(request, env, ctx);
      }
      if (url.pathname === '/__warm-all') {
        return await handleWarmAll(request, env);
      }
      const readOnly = request.method === 'GET' || request.method === 'HEAD';
      if (url.pathname === '/' && readOnly) {
        if (url.searchParams.has('journee') || url.searchParams.has('meta')) {
          return await handleCachedProxy(url, env);
        }
        return await handlePage(request, url, env, ctx, null);
      }
      const m = url.pathname.match(/^\/journee\/([^/]+)\/?$/);
      if (m && readOnly) {
        return await handlePage(request, url, env, ctx, decodeURIComponent(m[1]));
      }
      if (env.ASSETS && readOnly) {
        return await env.ASSETS.fetch(request);
      }
      return jsonResponse({ error: 'not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: String((err && err.message) || err) }, 500);
    }
  },
};

// --- HTML pages -----------------------------------------------------------

async function handlePage(request, url, env, ctx, requestedJournee) {
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
  const stored = await cache.match(cacheKey);

  if (stored) {
    const age = (Date.now() - Number(stored.headers.get('X-Rendered-At'))) / 1000;
    const fresh = stored.headers.get('X-Partial') ? PAGE_PARTIAL_FRESH_SECONDS : PAGE_FRESH_SECONDS;
    if (age < fresh) return served(stored, request, 'HIT');
    // Stale: answer instantly, refresh in the background. A failed refresh
    // leaves the stored copy alone; a partial refresh never replaces a
    // complete copy.
    ctx.waitUntil(refreshPage(env, requestedJournee, cache, cacheKey, !stored.headers.get('X-Partial')));
    return served(stored, request, 'STALE');
  }

  let built;
  try {
    built = await buildPage(env, requestedJournee);
  } catch (err) {
    console.error('page render failed', requestedJournee, err);
    return htmlResponse(
      renderErrorPage('Les compositions sont momentanément indisponibles. Réessayez dans un instant.'),
      503,
      { 'Cache-Control': 'no-store', 'Retry-After': '30' }
    );
  }
  if (built.status === 200) ctx.waitUntil(storePage(cache, cacheKey, built));
  return served(built.response, request, 'MISS');
}

async function refreshPage(env, requestedJournee, cache, cacheKey, storedWasComplete) {
  try {
    const built = await buildPage(env, requestedJournee);
    if (built.status !== 200) return;
    if (built.partial && storedWasComplete) return;
    await storePage(cache, cacheKey, built);
  } catch (err) {
    console.error('page refresh failed, keeping stale copy', requestedJournee, err);
  }
}

async function storePage(cache, cacheKey, built) {
  const copy = new Response(built.response.clone().body, built.response);
  copy.headers.set('Cache-Control', 'public, max-age=' + PAGE_STORE_SECONDS);
  copy.headers.set('X-Rendered-At', String(Date.now()));
  if (built.partial) copy.headers.set('X-Partial', '1');
  await cache.put(cacheKey, copy);
}

function served(response, request, cacheStatus) {
  const out = new Response(request.method === 'HEAD' ? null : response.body, response);
  out.headers.set('X-Cache', cacheStatus);
  out.headers.set('Cache-Control', 'public, max-age=' + BROWSER_TTL_SECONDS);
  out.headers.delete('X-Rendered-At');
  out.headers.delete('X-Partial');
  return out;
}

// Resolves to { response, status, partial }. partial = a non-essential
// dependency (DNP) failed, so the page is complete but not the full picture.
async function buildPage(env, requestedJournee) {
  const journees = await getKvJson(env, 'meta', originUrlFor(env, null));
  if (!Array.isArray(journees)) throw new Error('meta is not a list');

  if (requestedJournee !== null && !journees.includes(requestedJournee)) {
    return built(htmlResponse(renderErrorPage('Cette journée n’existe pas.'), 404, { 'Cache-Control': 'no-store' }), false);
  }

  const isDefault = requestedJournee === null;
  const selected = isDefault ? await pickDefaultJournee(journees) : requestedJournee;
  if (selected === null) {
    return built(htmlResponse(renderPage({
      journees, selected: '', isDefault, compos: { equipes: [] }, dnpByTeam: {}, dnpOk: true,
    })), false);
  }

  const [compos, dnp] = await Promise.all([
    getKvJson(env, cacheKeyForJournee(selected), originUrlFor(env, selected)),
    fetchDnpByTeam(selected),
  ]);
  if (compos && compos.error) throw new Error(compos.error);

  return built(
    htmlResponse(renderPage({ journees, selected, isDefault, compos, dnpByTeam: dnp.byTeam, dnpOk: dnp.ok })),
    !dnp.ok
  );
}

function built(response, partial) {
  return { response, status: response.status, partial };
}

async function getKvJson(env, key, originUrl) {
  let cached = null;
  try {
    cached = await env.CACHE.get(key);
  } catch (err) {
    console.error('kv get failed for', key, err); // fall through to the origin
  }
  if (cached !== null) return JSON.parse(cached);
  const json = await fetchOriginJsonWithRetry(originUrl, 3, 2000, 30000);
  // Best-effort: a failed put (e.g. the free tier's daily write cap) must
  // not fail a page whose data we already have in hand.
  try {
    await env.CACHE.put(key, json);
  } catch (err) {
    console.error('kv put failed for', key, err);
  }
  return JSON.parse(json);
}

// DNP is optional: if it fails the page still renders, with the capsules
// saying the information is unavailable (not "no absences") and a short
// cache lifetime so it recovers quickly.
async function fetchDnpByTeam(journee) {
  const byTeam = {};
  let ok = false;
  try {
    const resp = await fetch(DNP_API_BASE + '?journee=' + encodeURIComponent('Journée ' + journee), {
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!resp.ok) throw new Error('dnp responded ' + resp.status);
    const data = await resp.json();
    ((data && data.equipes) || []).forEach((t) => { byTeam[t.equipe] = t.joueurs || []; });
    ok = true;
  } catch (err) {
    console.error('dnp fetch failed', journee, err);
  }
  return { byTeam, ok };
}

async function fetchCurrentGameweekNumber() {
  try {
    const resp = await fetch(PRONOS_CURRENT_URL, {
      signal: AbortSignal.timeout(3000),
      cf: { cacheTtl: CURRENT_GW_TTL_SECONDS, cacheEverything: true },
    });
    const data = await resp.json();
    return data && data.gameweek ? data.gameweek.number : null;
  } catch (err) {
    return null;
  }
}

// currentNumber is the *upcoming* gameweek per the pronos API (it flips
// before that gameweek's Compos row has been filled in), so show the
// highest journée that's <= currentNumber; falls back to the highest
// numbered journée overall. (Journée labels are bare numbers like "3", but
// match by extracted number like Code.gs's gameweekNumberFromJournee_.)
async function pickDefaultJournee(journees) {
  const numbered = journees
    .map((j) => ({ journee: j, number: parseInt(String(j).match(/\d+/), 10) }))
    .filter((x) => !isNaN(x.number));
  const currentNumber = await fetchCurrentGameweekNumber();
  if (currentNumber != null) {
    const eligible = numbered.filter((x) => x.number <= currentNumber).sort((a, b) => b.number - a.number);
    if (eligible.length) return eligible[0].journee;
  }
  const highest = numbered.slice().sort((a, b) => b.number - a.number)[0];
  return highest ? highest.journee : (journees.length ? journees[0] : null);
}

function htmlResponse(html, status, extraHeaders) {
  return new Response(html, {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, extraHeaders || {}),
  });
}

function cacheKeyForJournee(journee) {
  return journee ? 'journee:' + journee : 'meta';
}

function originUrlFor(env, journee) {
  return journee
    ? env.APPS_SCRIPT_BASE + '?journee=' + encodeURIComponent(journee)
    : env.APPS_SCRIPT_BASE + '?meta=1';
}

async function handleCachedProxy(url, env) {
  const journee = url.searchParams.get('journee');
  const key = cacheKeyForJournee(journee);

  const cached = await env.CACHE.get(key);
  if (cached !== null) {
    return jsonPayload(cached, { 'X-Cache': 'HIT' });
  }

  const json = await fetchOriginJsonWithRetry(originUrlFor(env, journee), 3, 2000, 30000);
  await env.CACHE.put(key, json);
  return jsonPayload(json, { 'X-Cache': 'MISS' });
}

// Mirrors frontend/index.html's fetchJson_ retry/backoff shape (see its own
// comment about Apps Script's 10-40s cold-start window) -- this Worker is
// now the only thing that regularly has to absorb that latency; ordinary
// visitors should almost never hit this path once webhook-driven
// revalidation (see handleRevalidate) has pre-warmed the common journées.
//
// timeoutMs is a parameter (not always 30000) because this function serves
// two call sites with very different time budgets: handleCachedProxy is a
// normal request/response with no hard ceiling, but handleRevalidate's
// re-fetch runs inside ctx.waitUntil, which Cloudflare hard-caps at 30s
// TOTAL for a request (shared across every waitUntil call for that
// invocation, cancelled without completing if exceeded -- see
// revalidateAll for how that's budgeted for).
async function fetchOriginJsonWithRetry(url, attemptsLeft, delayMs, timeoutMs) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) throw new Error('origin responded ' + resp.status);
    const text = await resp.text();
    JSON.parse(text); // Apps Script cold-starts/errors can return an HTML
                       // page with a 200 status -- validate before trusting
                       // or caching it.
    return text;
  } catch (err) {
    if (attemptsLeft <= 1) throw err;
    await sleep(delayMs);
    return fetchOriginJsonWithRetry(url, attemptsLeft - 1, delayMs * 2, timeoutMs);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRevalidate(request, env, ctx) {
  if (!validSecret(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }

  const journees = Array.isArray(body.journees) ? body.journees
    : (body.journee ? [body.journee] : []);
  // meta is always included -- a journée-level change can mean a brand new
  // row (new journée) in the sheet, which changes the meta list too.
  const targets = Array.from(new Set([null, ...journees]));

  // Respond immediately so the caller -- Code.gs's onEdit, via
  // UrlFetchApp.fetch, which runs inside Google's execution-time budget for
  // simple triggers -- is never blocked on how long Apps Script itself
  // takes to answer the re-fetch below. The actual re-fetch+KV overwrite
  // continues in the background via ctx.waitUntil.
  ctx.waitUntil(revalidateAll(targets, env));
  return jsonResponse({ ok: true, queued: targets.map(cacheKeyForJournee) });
}

async function revalidateAll(journees, env) {
  // Parallel, single attempt, no retry/backoff -- ctx.waitUntil (see
  // handleRevalidate) has a hard 30s ceiling for the WHOLE invocation
  // (confirmed against Cloudflare's docs; exceeding it cancels whatever
  // hasn't settled yet, with no error surfaced to the caller -- this is
  // exactly what silently broke the first version of this function, which
  // retried each target sequentially at a 30s-per-attempt timeout). A
  // single 25s-per-target attempt, raced together via Promise.all instead
  // of looped, keeps the common case (an edit's own journée + "meta", i.e.
  // 2 targets) comfortably inside the 30s ceiling even against a cold Apps
  // Script, and gives the rare all-journées fallback (~35 targets, see
  // onEditCacheWebhook_) its best realistic shot -- some may still miss
  // the window, which is an accepted, self-correcting degradation (see the
  // catch below), not a failure worth engineering further for.
  await Promise.all(journees.map(async (journee) => {
    try {
      const json = await fetchOriginJsonWithRetry(originUrlFor(env, journee), 1, 0, 25000);
      await env.CACHE.put(cacheKeyForJournee(journee), json);
    } catch (err) {
      // Best-effort: a failed revalidation just leaves whatever was
      // previously in KV in place (stale, not missing) -- the next real
      // visitor still gets a fast, if outdated, response instead of an
      // error, and the next successful edit's revalidation call corrects it.
      console.error('revalidate failed for', journee, err);
    }
  }));
}

async function handleWarmAll(request, env) {
  if (!validSecret(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);

  const metaJson = await fetchOriginJsonWithRetry(originUrlFor(env, null), 3, 2000, 30000);
  await env.CACHE.put('meta', metaJson);
  const journees = JSON.parse(metaJson);

  const results = [];
  // Small batches, not all ~34 at once -- stays well clear of Apps Script's
  // per-account concurrent-execution ceiling for anonymous web-app requests.
  // No ctx.waitUntil/30s-ceiling concern here (unlike revalidateAll) --
  // this handler is awaited directly by the curl/caller, so it can take as
  // long as it needs.
  const BATCH_SIZE = 4;
  for (let i = 0; i < journees.length; i += BATCH_SIZE) {
    const batch = journees.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (journee) => {
      try {
        const json = await fetchOriginJsonWithRetry(originUrlFor(env, journee), 3, 2000, 30000);
        await env.CACHE.put(cacheKeyForJournee(journee), json);
        return { journee, ok: true };
      } catch (err) {
        return { journee, ok: false, error: String((err && err.message) || err) };
      }
    }));
    results.push(...batchResults);
  }

  return jsonResponse({ ok: true, meta: journees.length, results });
}

function validSecret(request, env) {
  const url = new URL(request.url);
  const provided = request.headers.get('X-Revalidate-Secret') || url.searchParams.get('secret');
  return Boolean(env.REVALIDATE_SECRET) && provided === env.REVALIDATE_SECRET;
}

function jsonResponse(obj, status) {
  return jsonPayload(JSON.stringify(obj), {}, status);
}

function jsonPayload(text, extraHeaders, status) {
  return new Response(text, {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      CORS_HEADERS,
      extraHeaders || {}
    ),
  });
}
