# Compos — Compositions Probables (Ligue 1)

A page, separate from the Wix-hosted fantasy-coach.fr, showing — for a
selected journée — the likely starting XI and formation for every Ligue 1
team, one card per team with a pitch diagram. Data comes from a private
Google Sheet maintained by a teammate; the sheet itself is never published
or made public.

Same $0 hosting pattern as the sibling projects
[`pronos`](../pronos) (`pronos.fantasy-coach.fr`) and
[`DNP`](../DNP) (`l1.dnp.fantasy-coach.fr`): a static page deployed via
GitHub Actions to GitHub Pages, on its own subdomain of fantasy-coach.fr.
No writes, no scheduling — so there's no Supabase/pg_cron here, same as DNP.

## Architecture

```
Google Sheet (private)
      |
      v
Apps Script Web App (apps-script/Code.gs)   <-- runs as the sheet owner/editor
      |
      | JSON (only equipe/formation/joueurs — never the raw sheet)
      v
frontend/index.html (static, GitHub Pages, l1.compos.fantasy-coach.fr)
```

## Setup

### 1. Create the Sheet

Create a new Google Sheet named **"Compos L1 - Saison 26-27"**, with a
single tab named **"Compos"**. Row 1 is the header, one data row per team
per journée from row 2:

```
Journée | Équipe | Formation | J1 | J2 | J3 | J4 | J5 | J6 | J7 | J8 | J9 | J10 | J11
```

- `J1` is always the **goalkeeper**.
- `J2` onward are outfield players entered **in formation order, right to
  left** (as viewed from behind the team's own goal) — e.g. for a `4-3-3`:
  `J2` = right-back … `J5` = left-back, `J6` = right-sided midfielder …
  `J8` = left-sided midfielder, `J9` = right-sided forward … `J11` =
  left-sided forward. The frontend groups players into pitch lines and
  orders them left-to-right purely from this position in the row plus the
  `Formation` column, so this ordering matters — the app doesn't validate
  or infer it.
- `Formation` is free text like `4-3-3` or `4-2-3-1` (any `-`-separated
  numbers summing to 10 work — nothing is hardcoded to specific
  formations).
- `Équipe` must match a `TEAM_LOGOS` key in `frontend/index.html` to show
  the crest (falls back to initials otherwise — see Notes).

### 2. Attach and deploy the Apps Script

1. Open the Sheet with an account that has **edit** access.
2. Extensions > Apps Script. Delete the default `Code.gs` content and paste
   in the **entire** contents of [`apps-script/Code.gs`](apps-script/Code.gs)
   (replace the whole file, not just parts of it — partial pastes have
   caused stale-deploy confusion on the sibling DNP project). Add a second
   file for [`apps-script/appsscript.json`](apps-script/appsscript.json)
   (Project Settings > "Show appsscript.json in editor" to expose it), or
   just apply its `webapp` settings via Deploy settings in the next step.
3. Confirm `SHEET_NAME` in `Code.gs` matches the tab name (`'Compos'`).
4. Deploy > New deployment > type **Web app**. "Execute as: **Me**",
   "Who has access: **Anyone**". Deploy and copy the Web App URL
   (`https://script.google.com/macros/s/.../exec`).
5. Sanity-check it directly in a browser:
   - `<url>?meta=1` should return a JSON array of journée names.
   - `<url>?journee=Journée 1` (URL-encode the space) should return the
     per-team compo list.

When the code changes later, redeploy via **Manage deployments > edit the
active deployment > New version > Deploy** — always replacing the whole
file first, for the same reason as step 2.

### 2b. (Optional) Enable actual-composition tracking

Separately from the Web App deployment above, `Code.gs` can also record the
*actual* starting XIs after each gameweek finishes, pulled from
ligue1.com's own public API, into a second tab called **"actuelles"**
(auto-created if missing — no setup needed for the tab itself). This never
touches the "Compos" tab.

1. In the Apps Script editor, select `setupGameweekTrigger` in the function
   dropdown and click **Run** once (grant the requested permissions —
   it needs to add a trigger and make external requests). This installs an
   hourly-ish (every 6h) time-driven trigger that checks whether the current
   gameweek has advanced (via the same jeu-des-pronos API the frontend uses)
   and, if so, fetches and records the gameweek just finished.
2. To test without waiting, run `recordActualCompos_(1)` (with the gameweek
   number you want) directly from the editor — it's idempotent, safe to
   re-run.
3. Re-running `setupGameweekTrigger` later (e.g. after redeploying) is safe;
   it clears any trigger it previously installed first, so triggers never
   stack up.

### 3. Point the frontend at the Web App

Edit `frontend/index.html`, replace `REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL`
with the Web App URL from step 2.4. (For local testing without editing the
file, append `?api=<url>` to the page's own URL instead.)

### 4. Host it

1. Create a GitHub repo for this directory (e.g. `lionelleboiteux/compos`,
   public — GitHub Pages on the free tier requires a public repo), push
   `main`.
2. Repo Settings > Pages > Source: **GitHub Actions** (the included
   `.github/workflows/pages.yml` handles the rest on every push to `main`).
3. Add a DNS **CNAME** record: `l1.compos` → `<your-github-username>.github.io`
   (same as was done for `l1.dnp.fantasy-coach.fr`).
4. Once DNS propagates and a deploy has run,
   https://l1.compos.fantasy-coach.fr should serve the page.

## Notes

- **Caching**: responses are cached in `CacheService` and invalidated
  automatically on sheet edit (an `onEdit` simple trigger bumps a version
  stamp in `PropertiesService`) — same pattern used in DNP's `Code.gs`.
  First request after an edit is slower (recomputes from the sheet);
  everything after that is served from cache until the next edit or a 6h
  TTL, whichever comes first.
- **Current journée**: like DNP, this page does *not* try to infer which
  journée is "current" from the sheet's own data. It fetches the real
  current Ligue 1 gameweek from the public jeu-des-pronos API
  (`/v1/leagues/{id}/current`) and defaults the picker to that, falling
  back to the first journée in the list if that call fails.
- **Team logos**: `TEAM_LOGOS` in `frontend/index.html` is sourced from the
  pronos Supabase `teams` table, matched by hand against this sheet's
  `Équipe` values, and updated directly against live pronos game data when
  Troyes/Le Mans were confirmed as this season's promoted clubs. Any team
  name that doesn't match a key falls back to a colored initials badge
  (`teamInitials()`) — including any future crest URL that 404s at runtime.
- **Shirt colors**: `TEAM_COLORS` in `frontend/index.html` is a hand-picked,
  best-effort approximation — no team-color data exists in any source this
  project pulls from (pronos' API only has crests, not colors), so treat
  these as decorative, not official brand hex codes. Any team missing from
  the map renders in a neutral gray.
- **Formation parsing is defensive, not validating**: if `Formation` is
  empty, malformed, or its numbers don't sum to the outfield player count
  actually entered, the frontend falls back to rendering all outfield
  players on a single undifferentiated line above the goalkeeper, rather
  than guessing or erroring.
- **"actuelles" tab left/right ordering is unverified**: `actualCompoRow_`
  in `Code.gs` orders each team's actual starters by ma-api.ligue1.fr's
  `formationPlace` field, since that API exposes no explicit left/right side
  per player — unlike "Compos", which relies on the teammate manually
  entering players right-to-left. Spot-check a real gameweek's "actuelles"
  rows against known matchday lineups before pointing any frontend rendering
  at that tab. This doesn't affect the accuracy score below, which is
  order-independent by design.
- **Accuracy scoring**: once a team's actual result is recorded in
  "actuelles", `doGet`'s `?journee=` response includes how many of that
  team's 11 probable names (from "Compos") match its actual starters —
  shown as a slanted mark (e.g. "9/11") right after the team name, order
  doesn't matter. A probable entry written as `"Surname (Real Name)"`
  counts as correct if *either* half matches the actual starter — one
  guess, not two: a single actual name can't satisfy two different probable
  rows. The gameweek-wide percentage (next to the journée picker) sums
  those tallies across every team already scored — see `teamScore_` and
  `journeePayload_` in `Code.gs` for the exact rules.
