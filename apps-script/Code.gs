/**
 * Compos — likely Ligue 1 starting XIs & formations.
 *
 * Bound to the Google Sheet "Compos L1 - Saison 26-27". Deployed as a Web
 * App (Deploy > New deployment > Web app), "Execute as: Me", "Who has
 * access: Anyone" — this lets an anonymous visitor's browser read data
 * derived from the sheet without the sheet itself being shared or
 * published. Only the fields returned below ever leave the sheet.
 *
 * Sheet layout — single tab "Compos", one header row, one data row per
 * team per journée:
 *   Journée | Équipe | Formation | J1 | J2 | ... | J11
 * J1 is always the goalkeeper; J2 onward are outfield players entered in
 * formation order, right to left as viewed from behind the team's own goal
 * (e.g. for "4-3-3": J2 = right-back ... J5 = left-back, J6 = right-sided
 * midfielder ... J8 = left-sided midfielder, J9 = right-sided forward ...
 * J11 = left-sided forward). This ordering is a data-entry convention — not
 * derived or validated here; the frontend reverses each line when rendering
 * left-to-right on the pitch.
 *
 * Endpoints (all GET, no auth):
 *   ?meta=1             -> ["Journée 1", "Journée 2", ..., "Journée 34"]
 *                          (chronological; the frontend decides which one
 *                          is "current" via the jeu-des-pronos API, same
 *                          approach as the sibling DNP project)
 *   ?journee=Journée 12 -> {
 *                            equipes: [{ equipe, formation,
 *                                        joueurs: [11 names, GK first],
 *                                        score: { correct, total } | null,
 *                                        fixture: { opponent, isHome,
 *                                                   kickoff } | null }],
 *                            score: { correct, total, percent } | null
 *                          }
 *                          Each team's `score` is how many of its 11
 *                          probable names appear (order-independent) among
 *                          that team's actual starters recorded in
 *                          "actuelles" — null until that team's result is
 *                          recorded. The top-level `score` is the same
 *                          tally summed across every team in the gameweek
 *                          that has one yet; null until at least one does.
 *                          See journeePayload_/teamScore_ below for the
 *                          exact matching rules (bracket handling, etc).
 *                          `fixture` is sourced live from ma-api.ligue1.fr
 *                          (see fetchGameweekFixtures_) — `kickoff` is an
 *                          ISO datetime, `opponent` is this project's short
 *                          Équipe name (see API_TEAM_NAME_MAP). null when
 *                          the gameweek number can't be resolved or the API
 *                          call fails; a fixture-lookup failure never blocks
 *                          the compo/formation data the rest of the
 *                          response carries.
 *
 * Responses are cached in CacheService (script-wide, up to 6h) and
 * invalidated by bumping a version stamp in PropertiesService whenever the
 * sheet is edited (see onEdit below) — same pattern as DNP's
 * apps-script/Code.gs.
 *
 * Actual (post-match) compositions: a separate concern from doGet above.
 * checkGameweekTransition, installed as a time-driven trigger (see
 * setupGameweekTrigger), notices when the current Ligue 1 gameweek advances
 * and pulls the real starting XIs for the gameweek just finished from
 * ma-api.ligue1.fr (the public JSON API behind ligue1.com's own results
 * pages), writing them to a second tab, "actuelles" — never touching the
 * teammate's manually-entered "Compos" tab. doGet's ?journee= response
 * reads from it (see journeePayload_) to compute the scores above.
 */

var SHEET_NAME = 'Compos';

// Columns, 1-indexed. J1..J11 are contiguous starting at COL_J1.
var COL_JOURNEE = 1;
var COL_EQUIPE = 2;
var COL_FORMATION = 3;
var COL_J1 = 4;
var NUM_PLAYERS = 11;

// Single header row.
var FIRST_DATA_ROW = 2;

// --- Actual (post-match) compositions -------------------------------------
//
// Separate tab, same column layout as 'Compos' (Journée | Équipe | Formation
// | J1..J11), so it can reuse readRows_/formationText_ etc. Kept apart from
// 'Compos' because that tab is the teammate's manually-entered *probable*
// lineups — this one is filled in automatically from the official result,
// after the fact, and must never overwrite their input.
var SHEET_NAME_RESULTS = 'actuelles';

// ma-api.ligue1.fr backs ligue1.com's own results/match-sheet pages (found
// by inspecting its network calls) and is public — no auth/cookies needed.
// championshipId 1 = Ligue 1 for the current season as observed 2026-08;
// re-verify at the start of a season in case IDs get reassigned.
var LIGUE1_API_BASE = 'https://ma-api.ligue1.fr';
var LIGUE1_CHAMPIONSHIP_ID = 1;

// jeu-des-pronos already tracks the current Ligue 1 gameweek (same API the
// frontend uses to default the journée picker) — reused here as the signal
// for "gameweek advanced", rather than inferring it from the sheet.
var PRONOS_API_BASE = 'https://dmytkubjxwwwkroutvdu.supabase.co/functions/v1/api';
var PRONOS_L1_LEAGUE_ID = '27f27a15-02a9-448a-98d5-80998e2fa52e';

// ma-api.ligue1.fr's clubIdentity.name (full official name) -> this
// project's short Équipe convention (must match TEAM_LOGOS keys in
// frontend/index.html). Hand-built the same way TEAM_LOGOS was, by
// inspecting real gameweek-1 API responses; update by hand if a club
// enters/leaves the league or the API renames a club.
var API_TEAM_NAME_MAP = {
  'Olympique de Marseille': 'Marseille',
  'RC Strasbourg Alsace': 'Strasbourg',
  'RC Lens': 'Lens',
  'AJ Auxerre': 'Auxerre',
  'Le Mans FC': 'Le Mans',
  'Stade Brestois 29': 'Brest',
  'OGC Nice': 'Nice',
  'FC Lorient': 'Lorient',
  'Toulouse FC': 'Toulouse',
  'Olympique Lyonnais': 'Lyon',
  'Estac Troyes': 'Troyes',
  'Paris FC': 'Paris FC',
  'Angers SCO': 'Angers',
  'LOSC Lille': 'Lille',
  'Havre Athletic Club': 'Le Havre',
  'AS Monaco': 'Monaco',
  'Stade Rennais FC': 'Rennes',
  'Paris Saint-Germain': 'Paris SG'
};

// CacheService's own cap; also used as a safety-net TTL in case an edit
// somehow doesn't trigger onEdit below.
var CACHE_TTL_SECONDS = 21600;

function doGet(e) {
  var journee = e.parameter.journee;
  var cacheKey = journee ? 'journee:' + journee : 'meta';

  var cached = cacheGet_(cacheKey);
  if (cached !== null) {
    return jsonResponse_(cached);
  }

  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var rows = readRows_(sheet);

  var payload;
  if (!journee) {
    payload = orderedJourneeList_(rows);
  } else {
    payload = journeePayload_(rows, journee);
  }

  var json = JSON.stringify(payload);
  cacheSet_(cacheKey, json);
  return jsonResponse_(json);
}

/**
 * Builds the ?journee= response: each team's probable compo (from 'Compos')
 * alongside a score against the actual compo ('actuelles' tab, if that
 * team's result has been recorded yet), plus the gameweek-wide total.
 *
 *   { equipes: [{ equipe, formation, joueurs, score }], score }
 *
 * where each `score` is either `{ correct, total }` or `null` (no actual
 * data recorded yet for that team) — the gameweek-wide `score` is `null`
 * until at least one team has one.
 */
function journeePayload_(composRows, journee) {
  // 'Compos' and 'actuelles' aren't guaranteed to spell a journée the same
  // way — recordActualCompos_ always writes "Journée N", but 'Compos' is
  // free text a teammate fills in by hand (observed in practice to be just
  // "1", "2", ... some seasons). Match on the extracted gameweek NUMBER,
  // not the raw string, so either tab can use either convention.
  var targetGw = gameweekNumberFromJournee_(journee);

  var actuellesSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME_RESULTS);
  var actuellesByEquipe = {};
  if (actuellesSheet) {
    readRows_(actuellesSheet).forEach(function (r) {
      var matches = isNaN(targetGw)
        ? r.journee === journee
        : gameweekNumberFromJournee_(r.journee) === targetGw;
      if (matches) actuellesByEquipe[r.equipe] = r.joueurs;
    });
  }

  var totalCorrect = 0;
  var totalPossible = 0;

  var fixturesByEquipe = isNaN(targetGw) ? {} : fetchGameweekFixtures_(targetGw);

  var equipes = composRows
    .filter(function (r) { return r.journee === journee; })
    .map(function (r) {
      var score = teamScore_(r.joueurs, actuellesByEquipe[r.equipe]);
      if (score) {
        totalCorrect += score.correct;
        totalPossible += score.total;
      }
      return {
        equipe: r.equipe,
        formation: r.formation,
        joueurs: r.joueurs,
        score: score,
        fixture: fixturesByEquipe[r.equipe] || null
      };
    });

  return {
    equipes: equipes,
    score: totalPossible > 0
      ? { correct: totalCorrect, total: totalPossible, percent: Math.round(totalCorrect / totalPossible * 100) }
      : null
  };
}

// "Journée 12" -> 12, "12" -> 12, "J12" -> 12. NaN if no digits at all —
// callers fall back to exact string comparison in that case.
function gameweekNumberFromJournee_(journee) {
  var m = String(journee || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

/**
 * Compares one team's probable lineup against its actual one. Order-
 * independent, and tolerant of accent/case differences between how the two
 * tabs happen to spell a name (see normalizeBase_).
 *
 * The "Surname (real name)" bracket convention some probable entries use
 * (see frontend's player-chip comment) is treated as two guesses, not one:
 * "Jhon (Smith)" counts as correct if the actual starter is *either* "Jhon"
 * *or* "Smith" — never both, so one actual name still can't satisfy two
 * probable rows.
 *
 * Total is always NUM_PLAYERS (11), regardless of how many names actually
 * got entered for this team/journée — an incomplete "Compos" row just costs
 * itself points on the missing slots rather than shrinking the denominator.
 *
 * Returns null (rather than a 0/11 score) when there's no actual data yet,
 * so the frontend can tell "not played yet" apart from "got none right".
 */
function teamScore_(probableJoueurs, actualJoueurs) {
  if (!probableJoueurs || !probableJoueurs.length || !actualJoueurs || !actualJoueurs.length) return null;
  var actualPool = actualJoueurs.map(normalizeBase_);
  var correct = 0;
  probableJoueurs.forEach(function (rawName) {
    var candidates = nameCandidates_(rawName);
    for (var i = 0; i < candidates.length; i++) {
      var idx = actualPool.indexOf(candidates[i]);
      if (idx !== -1) {
        correct++;
        actualPool.splice(idx, 1); // consume so one actual name can't satisfy two probable rows
        break;
      }
    }
  });
  return { correct: correct, total: NUM_PLAYERS };
}

// "Jhon (Smith)" -> ['jhon', 'smith']; "Palmieri" -> ['palmieri']. The
// bracketed part, if any, is a second guess (see teamScore_ above), not
// extra detail to discard.
function nameCandidates_(rawName) {
  var raw = String(rawName || '');
  var bracketMatch = raw.match(/\(([^)]*)\)/);
  var primary = normalizeBase_(raw.replace(/\([^)]*\)/g, ' '));
  var candidates = primary ? [primary] : [];
  if (bracketMatch && bracketMatch[1]) {
    var alt = normalizeBase_(bracketMatch[1]);
    if (alt) candidates.push(alt);
  }
  return candidates;
}

// Letters like ø/æ/ß have no NFD decomposition into base+accent (they're
// atomic, not "o"/"a"/"s" with a mark) so NFD-stripping alone silently drops
// them instead of folding them, breaking otherwise-correct matches for e.g.
// Højbjerg. Folded by hand for the letters most likely to show up in a
// Ligue 1 squad list (Scandinavian, German, French, Turkish).
var SPECIAL_LETTER_FOLDS_ = [
  [/ø/g, 'o'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ß/g, 'ss'],
  [/ł/g, 'l'], [/đ/g, 'd'], [/þ/g, 'th'], [/ı/g, 'i']
];

// Lowercases, folds accents/special letters, and drops stray punctuation.
// Does NOT handle brackets — that's nameCandidates_'s job, since a bracket
// here means "alternate guess", not noise to strip.
function normalizeBase_(name) {
  var normalized = String(name || '')
    .replace(/’/g, "'")   // curly apostrophe -> straight, e.g. N'Diaye
    .toLowerCase();
  SPECIAL_LETTER_FOLDS_.forEach(function (pair) {
    normalized = normalized.replace(pair[0], pair[1]);
  });
  return normalized
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip remaining accents (NFD combining marks)
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Simple trigger — fires automatically on any edit to the bound sheet, no
 * installable-trigger setup needed. Bumping the version stamp changes every
 * cache key derived from it, which invalidates the whole cache in one write
 * without needing to know which keys currently exist.
 */
function onEdit(e) {
  bumpCacheVersion_();
}

/**
 * Also called directly by recordActualCompos_ after writing to 'actuelles':
 * appendRow() is a script-driven edit, which onEdit's simple trigger does
 * NOT fire for (only direct user edits in the sheet UI do) — without this,
 * journée responses already in cache would keep serving pre-result scores
 * for up to CACHE_TTL_SECONDS after a gameweek's actual compos are recorded.
 */
function bumpCacheVersion_() {
  PropertiesService.getScriptProperties().setProperty('cacheVersion', String(Date.now()));
}

function getCacheVersion_() {
  var v = PropertiesService.getScriptProperties().getProperty('cacheVersion');
  return v || '0';
}

function cacheGet_(key) {
  return CacheService.getScriptCache().get('v' + getCacheVersion_() + ':' + key);
}

function cacheSet_(key, value) {
  CacheService.getScriptCache().put('v' + getCacheVersion_() + ':' + key, value, CACHE_TTL_SECONDS);
}

/**
 * Reads every data row once. Journée order in the returned list is
 * first-seen order (top to bottom in the sheet), i.e. chronological, since
 * rows are entered in journée order.
 */
function readRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var numRows = lastRow - FIRST_DATA_ROW + 1;
  if (numRows <= 0) return [];

  var numCols = COL_J1 - 1 + NUM_PLAYERS;
  var values = sheet.getRange(FIRST_DATA_ROW, 1, numRows, numCols).getValues();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var journee = String(row[COL_JOURNEE - 1] || '').trim();
    var equipe = String(row[COL_EQUIPE - 1] || '').trim();
    if (!journee || !equipe) continue; // skip blank/malformed rows

    var joueurs = [];
    for (var p = 0; p < NUM_PLAYERS; p++) {
      var name = String(row[COL_J1 - 1 + p] || '').trim();
      if (name) joueurs.push(name);
    }

    rows.push({
      journee: journee,
      equipe: equipe,
      formation: formationText_(row[COL_FORMATION - 1]),
      joueurs: joueurs
    });
  }
  return rows;
}

/**
 * Google Sheets aggressively auto-converts text that looks date-like into
 * an actual date — typing "4-3-3" into a plain (non-text-formatted) cell
 * gets silently reinterpreted as 4/3/(20)03 (April 3rd 2003) and getValues()
 * then hands back a real JS Date, not the string "4-3-3". Reconstruct the
 * original digits from that date rather than showing a stringified Date.
 * The actual fix is formatting the Formation column as Plain Text in the
 * sheet (Format > Number > Plain text) so this never happens in the first
 * place — this is just a defensive fallback in case that slips.
 */
function formationText_(raw) {
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return (raw.getMonth() + 1) + '-' + raw.getDate() + '-' + (raw.getFullYear() % 100);
  }
  return String(raw || '').trim();
}

function orderedJourneeList_(rows) {
  var seen = {};
  var list = [];
  rows.forEach(function (r) {
    if (!seen[r.journee]) {
      seen[r.journee] = true;
      list.push(r.journee);
    }
  });
  return list;
}

function jsonResponse_(json) {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Fetches the current Ligue 1 gameweek number from the same jeu-des-pronos
 * endpoint the frontend uses, and — if it has advanced since the last time
 * this ran — records the actual (post-match) compositions for every
 * gameweek in between into the 'actuelles' tab.
 *
 * Meant to be run on an installable time-driven trigger (see
 * setupGameweekTrigger below); onEdit-style simple triggers can't do this
 * since it needs UrlFetchApp and takes longer than a simple trigger allows.
 * Safe to run more often than the gameweek actually changes — recordActualCompos_
 * skips any (journée, équipe) pair already present, so re-runs are harmless.
 */
function checkGameweekTransition() {
  var props = PropertiesService.getScriptProperties();
  var lastSeen = parseInt(props.getProperty('lastSeenGameweek'), 10) || 0;
  var current = fetchCurrentGameweekNumber_();
  if (!current || current <= lastSeen) return;

  for (var gw = lastSeen + 1; gw < current; gw++) {
    recordActualCompos_(gw);
  }
  props.setProperty('lastSeenGameweek', String(current));
}

function fetchCurrentGameweekNumber_() {
  var url = PRONOS_API_BASE + '/v1/leagues/' + PRONOS_L1_LEAGUE_ID + '/current';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  var data = JSON.parse(resp.getContentText());
  return data && data.gameweek ? data.gameweek.number : null;
}

/**
 * Fetches every match of the given gameweek from ma-api.ligue1.fr, extracts
 * each team's actual starting XI + formation, and appends any rows not
 * already present in the 'actuelles' tab (keyed on journée+équipe, so
 * re-running for an already-recorded gameweek is a no-op).
 */
function recordActualCompos_(gameweekNumber) {
  var journee = 'Journée ' + gameweekNumber;
  var sheet = getOrCreateResultsSheet_();
  var existing = existingResultsKeys_(sheet);
  var wroteAny = false;

  var matches = fetchGameweekMatches_(gameweekNumber);
  matches.forEach(function (m) {
    var detail = fetchMatchDetail_(m.matchId);
    if (!detail) return;
    [detail.home, detail.away].forEach(function (side) {
      if (!side) return;
      var equipe = mapApiTeamName_(side.clubIdentity && side.clubIdentity.name);
      var key = journee + ' ' + equipe;
      if (!equipe || existing[key]) return;

      var row = actualCompoRow_(side);
      if (!row) return;

      sheet.appendRow([journee, equipe, row.formation].concat(row.joueurs));
      existing[key] = true;
      wroteAny = true;
    });
  });

  // appendRow() is script-driven, so onEdit's simple trigger won't fire for
  // it -- bump the cache ourselves so newly-recorded scores show up on the
  // next request instead of waiting out the existing 6h TTL.
  if (wroteAny) bumpCacheVersion_();
}

function getOrCreateResultsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEET_NAME_RESULTS);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME_RESULTS);
  // Also covers a pre-existing-but-empty tab (e.g. created by hand ahead of
  // this code, with no header row yet) — not just a brand new one — since
  // existingResultsKeys_/appendRow both assume row 1 is a header.
  if (sheet.getLastRow() === 0) {
    var header = ['Journée', 'Équipe', 'Formation'];
    for (var p = 1; p <= NUM_PLAYERS; p++) header.push('J' + p);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return sheet;
}

function existingResultsKeys_(sheet) {
  var lastRow = sheet.getLastRow();
  var keys = {};
  if (lastRow < FIRST_DATA_ROW) return keys;
  var values = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, 2).getValues();
  values.forEach(function (r) {
    var journee = String(r[0] || '').trim();
    var equipe = String(r[1] || '').trim();
    if (journee && equipe) keys[journee + ' ' + equipe] = true;
  });
  return keys;
}

function mapApiTeamName_(apiName) {
  if (!apiName) return null;
  // Falls back to the raw API name if unmapped (new/renamed club) rather
  // than dropping the row — same "defensive, not validating" approach as
  // formationText_ above; a mismatch is easy to spot and fix by hand.
  return API_TEAM_NAME_MAP[apiName] || apiName;
}

/**
 * Home ground/away, opponent, and kickoff time for every team in one
 * gameweek — sourced from the same match-week list fetchGameweekMatches_
 * already calls for recordActualCompos_, but only that list call: each
 * entry already carries `date`/`home`/`away`, so no per-match detail fetch
 * (fetchMatchDetail_) is needed here, unlike recordActualCompos_ which also
 * needs starters. Adds exactly one UrlFetchApp call to a cache-cold journée
 * request, not one per match.
 *
 * Returns { equipe: { opponent, isHome, kickoff } }, or {} if the API call
 * fails or returns nothing usable — fixture display is a nice-to-have on
 * top of the compo/formation data, so a ligue1.fr outage here must never
 * turn into a broken ?journee= response.
 */
function fetchGameweekFixtures_(gameweekNumber) {
  var fixtures = {};
  try {
    fetchGameweekMatches_(gameweekNumber).forEach(function (m) {
      if (!m.home || !m.away || !m.date) return;
      var home = mapApiTeamName_(m.home.clubIdentity && m.home.clubIdentity.name);
      var away = mapApiTeamName_(m.away.clubIdentity && m.away.clubIdentity.name);
      if (!home || !away) return;
      fixtures[home] = { opponent: away, isHome: true, kickoff: m.date };
      fixtures[away] = { opponent: home, isHome: false, kickoff: m.date };
    });
  } catch (err) {
    // Swallowed deliberately — see doc comment above.
  }
  return fixtures;
}

function fetchGameweekMatches_(gameweekNumber) {
  var url = LIGUE1_API_BASE + '/championship-matches/championship/' + LIGUE1_CHAMPIONSHIP_ID +
    '/game-week/' + gameweekNumber;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return [];
  var data = JSON.parse(resp.getContentText());
  return Array.isArray(data) ? data : (data.matches || []);
}

function fetchMatchDetail_(matchId) {
  var url = LIGUE1_API_BASE + '/championship-match/' + matchId;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  return JSON.parse(resp.getContentText());
}

/**
 * Builds one team's { formation, joueurs } from its side of a
 * championship-match response: starters only, goalkeeper first, everyone
 * else ordered by formationPlace.
 *
 * NOT VERIFIED against the sheet's hand-entry convention (J2..J11 outfield
 * players right-to-left as viewed from behind the team's own goal, per
 * README) — the API doesn't expose an explicit left/right side, only
 * formationPlace/position/realUltraPosition numeric codes. Ordering here is
 * formationPlace ascending as a best guess; spot-check a real gameweek's
 * 'actuelles' rows against known lineups before trusting the L/R order the
 * frontend renders from this tab.
 */
function actualCompoRow_(side) {
  var players = side.players;
  if (!players) return null;

  var starters = Object.keys(players)
    .map(function (id) { return players[id]; })
    .filter(function (p) { return p && p.startedMatch; })
    .sort(function (a, b) { return (a.formationPlace || 0) - (b.formationPlace || 0); });
  if (starters.length === 0) return null;

  // playerIdentity has firstName/lastName, no combined "name" field.
  // lastName alone matches how ligue1.com's own UI labels the starting XI
  // (confirmed against the site directly) and how 'Compos' is conventionally
  // filled in (surnames, with a "Surname (Real Name)" bracket for
  // disambiguation) — see teamScore_'s bracket-as-second-guess handling.
  var joueurs = starters.map(function (p) {
    return p.playerIdentity ? String(p.playerIdentity.lastName || '').trim() : '';
  }).filter(function (n) { return n; });

  return {
    formation: formationDashes_(side.formation),
    joueurs: joueurs
  };
}

// "4231" -> "4-2-3-1". Ligue 1 formations never have a double-digit line, so
// splitting one digit per line is safe and needs no lookup table.
function formationDashes_(code) {
  return String(code || '').split('').join('-');
}

/**
 * One-time setup: run this once from the Apps Script editor (select it in
 * the function dropdown, click Run) to install the time-driven trigger.
 * Re-running is safe — it removes any trigger it previously installed for
 * checkGameweekTransition before adding a new one, so this never stacks up
 * duplicate triggers.
 */
function setupGameweekTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkGameweekTransition') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkGameweekTransition').timeBased().everyHours(6).create();
}
