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
 * formation order (e.g. for "4-3-3": J2–J5 = defenders, J6–J8 =
 * midfielders, J9–J11 = attackers). This ordering is a data-entry
 * convention — not derived or validated here.
 *
 * Endpoints (all GET, no auth):
 *   ?meta=1             -> ["Journée 1", "Journée 2", ..., "Journée 34"]
 *                          (chronological; the frontend decides which one
 *                          is "current" via the jeu-des-pronos API, same
 *                          approach as the sibling DNP project)
 *   ?journee=Journée 12 -> [{ equipe, formation, joueurs: [11 names, GK first] }]
 *
 * Responses are cached in CacheService (script-wide, up to 6h) and
 * invalidated by bumping a version stamp in PropertiesService whenever the
 * sheet is edited (see onEdit below) — same pattern as DNP's
 * apps-script/Code.gs.
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
    payload = rows
      .filter(function (r) { return r.journee === journee; })
      .map(function (r) { return { equipe: r.equipe, formation: r.formation, joueurs: r.joueurs }; });
  }

  var json = JSON.stringify(payload);
  cacheSet_(cacheKey, json);
  return jsonResponse_(json);
}

/**
 * Simple trigger — fires automatically on any edit to the bound sheet, no
 * installable-trigger setup needed. Bumping the version stamp changes every
 * cache key derived from it, which invalidates the whole cache in one write
 * without needing to know which keys currently exist.
 */
function onEdit(e) {
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
