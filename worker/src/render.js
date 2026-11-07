/**
 * Server-side rendering of l1.compos.fantasy-coach.fr. Ported from the
 * client-side renderer that used to live in frontend/index.html (same
 * markup, same class names, same CSS -- see styles.css), so the page now
 * arrives as finished HTML instead of depending on a browser-side fetch.
 */

import STYLES from './styles.css';

const SITE_URL = 'https://l1.compos.fantasy-coach.fr';
const DNP_SITE_URL = 'https://l1.dnp.fantasy-coach.fr/';

const TITLE = 'Compositions Probables Ligue 1 par Journée | Fantasy Coach';
const DESCRIPTION = 'Equipe par équipe, la composition probable et la formation.';

// Sourced from the pronos Supabase `teams` table (same account/project as
// pronos.fantasy-coach.fr) -- copied verbatim from l1.dnp.fantasy-coach.fr's
// frontend, which already curated it by hand against real team names.
const TEAM_LOGOS = {
  'Angers': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_4_37_512x512_b5149d8c4312c158b2975298205510eb.png',
  'Auxerre': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_4_2_512x512_4bed22ddd777a8b0977284bee7f416a7.png',
  'Brest': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_44_512x512_b8930455bc938de7b9f4e128e1036989.png',
  'Le Havre': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_5_512x512_e9bf970697e022dcbd3d51e245f3682d.png',
  'Lens': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2026_1_6_512x512_d08b45acce8a87d13b938cde8974362f.png',
  'Lille': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_158_512x512_39a605746d9cf4eb12d9cd4f63adb27c.png',
  'Lorient': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_7_512x512_7d0c497c5f41d0dcf5dabad2910699e3.png',
  'Lyon': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_159_512x512_1a9c2cd8f58fba433bb5cd568b3de7d0.png',
  'Marseille': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2025_1_1_512x512_16ca4f08072a6b6d99169ba2b6a8b228.png',
  'Monaco': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_9_512x512_ad7dd146950eee8eb68ea9588a674fe8.png',
  'Nice': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_30_512x512_2ccb89a2f1fbad23e693d1c5d101a25d.png',
  'Paris FC': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_4_90_512x512_8b2bb52cf67eb9456c794509c7e58c46.png',
  'Paris SG': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_13_512x512_4a9438034a011c1368c52d097a93b98f.png',
  'Rennes': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_14_512x512_28c7492293ca34c6e26d6cb71e858a57.png',
  'Strasbourg': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_15_512x512_e9553990e86d8098a3cf94febe8b4b96.png',
  'Toulouse': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_1_16_512x512_a7be4e575396227614acc0ed47083503.png',
  // Troyes and Le Mans are this season's promoted clubs (confirmed
  // directly against pronos' live team data).
  'Troyes': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_4_33_512x512_fa84337aa111aaf34990dd2590ba1789.png',
  'Estac Troyes': 'https://s3.eu-west-1.amazonaws.com/image.mpg/assets/clubs/logo/2023_4_33_512x512_fa84337aa111aaf34990dd2590ba1789.png',
  'Le Mans': 'https://s3.eu-west-1.amazonaws.com/image.mpg/daabb8d9-230e-4fe2-8214-682fbbdedb5e',
  'Le Mans FC': 'https://s3.eu-west-1.amazonaws.com/image.mpg/daabb8d9-230e-4fe2-8214-682fbbdedb5e',
};

// Full official names, shown at desktop width (>=640px) alongside the
// short/town name shown at mobile width -- see .team-name-full/
// .team-name-short in styles.css.
const TEAM_FULL_NAMES = {
  'Angers': 'Angers SCO',
  'Auxerre': 'AJ Auxerre',
  'Brest': 'Stade Brestois 29',
  'Le Havre': 'Havre Athletic Club',
  'Lens': 'RC Lens',
  'Lille': 'LOSC Lille',
  'Lorient': 'FC Lorient',
  'Lyon': 'Olympique Lyonnais',
  'Marseille': 'Olympique de Marseille',
  'Monaco': 'AS Monaco',
  'Nice': 'OGC Nice',
  'Paris FC': 'Paris FC',
  'Paris SG': 'Paris Saint-Germain',
  'Rennes': 'Stade Rennais FC',
  'Strasbourg': 'RC Strasbourg Alsace',
  'Toulouse': 'Toulouse FC',
  'Troyes': 'Estac Troyes',
  'Estac Troyes': 'Estac Troyes',
  'Le Mans': 'Le Mans FC',
  'Le Mans FC': 'Le Mans FC',
};

// 2-3 letter codes, shown next to the logo at mobile width.
const TEAM_CODES = {
  'Angers': 'SCO',
  'Auxerre': 'AJA',
  'Brest': 'BRE',
  'Le Havre': 'HAC',
  'Lens': 'RCL',
  'Lille': 'LIL',
  'Lorient': 'FCL',
  'Lyon': 'OL',
  'Marseille': 'OM',
  'Monaco': 'ASM',
  'Nice': 'NIC',
  'Paris FC': 'PFC',
  'Paris SG': 'PSG',
  'Rennes': 'REN',
  'Strasbourg': 'RCS',
  'Toulouse': 'TFC',
  'Troyes': 'TRO',
  'Estac Troyes': 'TRO',
  'Le Mans': 'LEM',
  'Le Mans FC': 'LEM',
};

// Hand-picked main jersey color + secondary "sash" color -- decorative,
// not official kit hex codes.
const TEAM_COLORS = {
  'Angers': { main: '#000000', second: '#ffffff' },
  'Auxerre': { main: '#ffffff', second: '#0c3c8a' },
  'Brest': { main: '#dc1f26', second: '#ffffff' },
  'Le Havre': { main: '#63b8ff', second: '#001489' },
  'Lens': { main: '#dc143c', second: '#ffcc00' },
  'Lille': { main: '#c8102e', second: '#ffffff' },
  'Lorient': { main: '#ff6600', second: '#000000' },
  'Lyon': { main: '#ffffff', second: '#0033a0' },
  'Marseille': { main: '#ffffff', second: '#5fb4e5' },
  'Monaco': { main: '#cc0000', second: '#ffffff' },
  'Nice': { main: '#000000', second: '#e2001a' },
  'Paris FC': { main: '#0033a0', second: '#e2001a' },
  'Paris SG': { main: '#04234c', second: '#e30613' },
  'Rennes': { main: '#e2001a', second: '#000000' },
  'Strasbourg': { main: '#0055a4', second: '#ffffff' },
  'Toulouse': { main: '#6a0dad', second: '#ffffff' },
  'Troyes': { main: '#002868', second: '#ffffff' },
  'Estac Troyes': { main: '#002868', second: '#ffffff' },
  'Le Mans': { main: '#0033a0', second: '#ffffff' },
  'Le Mans FC': { main: '#0033a0', second: '#ffffff' },
};
const DEFAULT_SHIRT_COLOR = { main: '#9ca3af', second: null };
// One fixed neutral color for every team's goalkeeper.
const GK_SHIRT_COLOR = { main: '#f2c40c', second: null };

const REASON_ICON = {
  disponible: '✅',
  suspendu: '🟥',
  blessure: '+',
  personnel: '🤝',
  hors_groupe: '🙅',
  transfert: '✈️',
  incertain: '❓',
};
const REASON_LABEL = {
  disponible: 'Disponible',
  suspendu: 'Suspendu',
  blessure: 'Blessé',
  personnel: 'Raison personnelle',
  hors_groupe: 'Hors groupe',
  transfert: 'Transfert',
  incertain: 'Incertain',
};
// Injured first, then suspended, then out-of-group, personal, transfer,
// and finally the least certain. "disponible" is filtered out entirely.
const REASON_ORDER = ['blessure', 'suspendu', 'hors_groupe', 'personnel', 'transfert', 'incertain'];

const SHIRT_PATH = 'M2,4 L8,2 L10,4 L14,4 L16,2 L22,4 L18,8 L18,22 L6,22 L6,8 Z';

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function teamInitials(equipe) {
  return String(equipe || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

// "4-3-3" -> [4, 3, 3]. Null if any part isn't a positive integer.
function parseFormationLines(formation) {
  const parts = String(formation || '').split('-').map((p) => parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => !n || n <= 0)) return null;
  return parts;
}

// A standalone "(P)"/"(C)" bracket marks the penalty taker / captain,
// distinct from the "Surname (Real Name)" disambiguation bracket.
function parsePlayerName(rawName) {
  let isPenalty = false;
  let isCaptain = false;
  const displayName = String(rawName || '').replace(/\(([^)]*)\)/g, (match, inner) => {
    const trimmed = inner.trim();
    if (/^p$/i.test(trimmed)) {
      isPenalty = true;
      return '';
    }
    if (/^c$/i.test(trimmed)) {
      isCaptain = true;
      return '';
    }
    return match;
  }).replace(/\s+/g, ' ').trim();
  return { displayName, isPenalty, isCaptain };
}

function formatPlayerName(prenom, nom) {
  const initial = String(prenom || '').trim().charAt(0);
  return String(nom || '').trim() + (initial ? ' ' + initial + '.' : '');
}

// Two-tone jersey: solid main color, optional diagonal sash clipped to the
// silhouette, white outline on top. Every shirt shares the one clipPath
// defined in the page's hidden <svg> (id "shirt-clip") since the silhouette
// itself never changes.
function shirtIcon(colorPair) {
  const pair = colorPair || DEFAULT_SHIRT_COLOR;
  let svg = '<svg class="player-shirt" viewBox="0 0 24 24">';
  svg += '<path d="' + SHIRT_PATH + '" fill="' + escapeHtml(pair.main || DEFAULT_SHIRT_COLOR.main) + '"/>';
  if (pair.second) {
    svg += '<g clip-path="url(#shirt-clip)"><rect x="-10" y="9" width="44" height="7" transform="rotate(-45 12 12)" fill="' +
      escapeHtml(pair.second) + '"/></g>';
  }
  svg += '<path d="' + SHIRT_PATH + '" fill="none" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>';
  svg += '</svg>';
  return svg;
}

function renderLine(names, color) {
  // Sheet order within a line is entered right-to-left, but flexbox renders
  // left-to-right, so reverse to match.
  const chips = names.slice().reverse().map((name) => {
    const parsed = parsePlayerName(name);
    let shirtWrap = '<div class="player-shirt-wrap">' + shirtIcon(color);
    if (parsed.isCaptain) {
      shirtWrap += '<img class="captain-badge" src="/captain-badge.png" alt="Capitaine" width="28" height="28" loading="lazy">';
    }
    if (parsed.isPenalty) {
      shirtWrap += '<img class="penalty-badge" src="/penalty-badge.png" alt="Tireur de penalty" width="24" height="20" loading="lazy">';
    }
    shirtWrap += '</div>';
    return '<div class="player-chip">' + shirtWrap +
      '<span class="player-label">' + escapeHtml(parsed.displayName) + '</span></div>';
  });
  return '<div class="pitch-line">' + chips.join('') + '</div>';
}

// orientation 'goal-top' (home team) or 'goal-bottom' (away team).
function renderHalfPitch(team, orientation) {
  const joueurs = (team && team.joueurs) || [];
  const gk = joueurs[0];
  const outfield = joueurs.slice(1);
  const lines = parseFormationLines(team && team.formation);
  const sum = lines ? lines.reduce((a, b) => a + b, 0) : 0;
  const color = TEAM_COLORS[team && team.equipe] || DEFAULT_SHIRT_COLOR;

  let groups = null;
  if (lines && sum === outfield.length) {
    let idx = 0;
    groups = lines.map((n) => {
      const g = outfield.slice(idx, idx + n);
      idx += n;
      return g;
    });
  }

  const gkLine = renderLine(gk ? [gk] : [], GK_SHIRT_COLOR);
  let body = '';
  if (orientation === 'goal-top') {
    body += gkLine;
    if (groups) body += groups.map((g) => renderLine(g, color)).join('');
    else if (outfield.length) body += renderLine(outfield, color);
  } else {
    if (groups) body += groups.slice().reverse().map((g) => renderLine(g, color)).join('');
    else if (outfield.length) body += renderLine(outfield, color);
    body += gkLine;
  }
  return '<div class="pitch-half">' + body + '</div>';
}

function renderTeamHeading(team, sideClass) {
  const logoUrl = TEAM_LOGOS[team.equipe];
  const fallback = '<span class="team-logo-fallback">' + escapeHtml(teamInitials(team.equipe)) + '</span>';
  let logo;
  if (logoUrl) {
    // The crest host can 404 or be blocked; swap in the initials badge, as
    // the client-side renderer did.
    logo = '<img class="team-logo" src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(team.equipe) +
      '" loading="lazy" data-fallback="' + escapeHtml(teamInitials(team.equipe)) + '">';
  } else {
    logo = fallback;
  }
  return '<div class="team-header ' + sideClass + '"><div class="team-header-top">' + logo +
    '<span class="team-name team-name-short">' + escapeHtml(TEAM_CODES[team.equipe] || team.equipe) + '</span>' +
    '<span class="team-name team-name-full">' + escapeHtml(TEAM_FULL_NAMES[team.equipe] || team.equipe) + '</span>' +
    (team.formation ? '<span class="team-formation">' + escapeHtml(team.formation) + '</span>' : '') +
    '</div><fc-team-form team="' + escapeHtml(team.equipe) + '" league="L1"></fc-team-form></div>';
}

function renderDnpCapsule(joueurs, sideClass, dnpOk) {
  const sorted = (joueurs || [])
    .filter((j) => j.categorie !== 'disponible')
    .slice()
    .sort((a, b) => {
      let ai = REASON_ORDER.indexOf(a.categorie);
      let bi = REASON_ORDER.indexOf(b.categorie);
      if (ai === -1) ai = REASON_ORDER.length;
      if (bi === -1) bi = REASON_ORDER.length;
      return ai - bi;
    });
  let inner;
  if (!dnpOk) {
    inner = '<span class="dnp-capsule-empty">Indisponibles : information momentanément absente</span>';
  } else if (sorted.length === 0) {
    inner = '<span class="dnp-capsule-empty">Aucun indisponible connu</span>';
  } else {
    inner = sorted.map((j) => {
      const categorie = Object.prototype.hasOwnProperty.call(REASON_ICON, j.categorie) ? j.categorie : 'incertain';
      const iconClass = 'dnp-capsule-icon' + (categorie === 'blessure' ? ' icon-blessure' : '');
      return '<div class="dnp-capsule-player"><span class="' + iconClass + '" title="' +
        escapeHtml(REASON_LABEL[categorie]) + '">' + REASON_ICON[categorie] + '</span><span>' +
        escapeHtml(formatPlayerName(j.prenom, j.nom)) + '</span></div>';
    }).join('');
  }
  return '<a class="dnp-capsule ' + sideClass + '" href="' + DNP_SITE_URL +
    '" target="_blank" rel="noopener" title="Voir le détail sur l1.dnp.fantasy-coach.fr">' + inner + '</a>';
}

// compos' API is per-team, not per-match: pair each team's row (carrying
// its own fixture: opponent + isHome + kickoff) into one match per pair.
export function buildMatches(teams) {
  const byName = {};
  (teams || []).forEach((t) => { byName[t.equipe] = t; });
  const seen = {};
  const matches = [];
  (teams || []).forEach((t) => {
    if (seen[t.equipe] || !t.fixture) return;
    const opponent = byName[t.fixture.opponent];
    seen[t.equipe] = true;
    if (opponent) seen[opponent.equipe] = true;
    const home = t.fixture.isHome ? t : opponent;
    const away = t.fixture.isHome ? opponent : t;
    if (!home || !away) return; // opponent's own row missing from this journée's data
    matches.push({ home, away, kickoff: t.fixture.kickoff });
  });
  matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return matches;
}

function renderMatchCard(match, dnpByTeam, dnpOk) {
  const d = new Date(match.kickoff);
  const when = isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  }).format(d);

  let pitch = '<div class="pitch">';
  // Accuracy badges over the pitch's own corners (home top-left, away
  // bottom-left): both teams share this one pitch.
  if (match.home.score) {
    pitch += '<span class="team-score pitch-score-home">' + match.home.score.correct + '/' + match.home.score.total + '</span>';
  }
  if (match.away.score) {
    pitch += '<span class="team-score pitch-score-away">' + match.away.score.correct + '/' + match.away.score.total + '</span>';
  }
  pitch += renderHalfPitch(match.home, 'goal-top') + renderHalfPitch(match.away, 'goal-bottom') + '</div>';

  return '<div class="match-card">' +
    (when ? '<div class="match-kickoff">' + escapeHtml(when.charAt(0).toUpperCase() + when.slice(1)) + '</div>' : '') +
    '<div class="match-body">' +
    renderTeamHeading(match.home, 'team-heading-home') +
    renderDnpCapsule(dnpByTeam[match.home.equipe], 'team-capsule-home', dnpOk) +
    pitch +
    renderDnpCapsule(dnpByTeam[match.away.equipe], 'team-capsule-away', dnpOk) +
    renderTeamHeading(match.away, 'team-heading-away') +
    '</div></div>';
}

// Grouped by Paris calendar day and ordered chronologically.
function dayGroupKey(kickoffIso) {
  const d = new Date(kickoffIso);
  if (isNaN(d.getTime())) return null;
  const parts = {};
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  if (!parts.year || !parts.month || !parts.day || !parts.weekday) return null;
  return {
    key: parts.year + '-' + parts.month + '-' + parts.day,
    label: 'Matchs du ' + parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1) + ' ' + parts.day + ' ' + parts.month,
    date: d,
  };
}

function groupMatchesByDay(matches) {
  const byKey = {};
  const undated = [];
  matches.forEach((m) => {
    const group = dayGroupKey(m.kickoff);
    if (!group) { undated.push(m); return; }
    if (!byKey[group.key]) byKey[group.key] = { label: group.label, date: group.date, matches: [] };
    byKey[group.key].matches.push(m);
  });
  const days = Object.keys(byKey).map((k) => byKey[k]).sort((a, b) => a.date - b.date);
  return { days, undated };
}

function renderMatches(matches, dnpByTeam, dnpOk) {
  if (!matches || matches.length === 0) {
    return '<div class="empty-state">Aucune composition disponible pour cette journée.</div>';
  }
  const grouped = groupMatchesByDay(matches);
  const cards = (list) => '<div class="match-list">' + list.map((m) => renderMatchCard(m, dnpByTeam, dnpOk)).join('') + '</div>';

  // No fixture data resolved for anyone: one flat list rather than an
  // awkward "Autres rencontres" heading with nothing to contrast it against.
  if (grouped.days.length === 0) return cards(matches);

  let html = grouped.days.map((day) =>
    '<section class="day-section"><h2 class="day-heading">' + escapeHtml(day.label) + '</h2>' + cards(day.matches) + '</section>'
  ).join('');
  if (grouped.undated.length) {
    html += '<section class="day-section"><h2 class="day-heading">Autres rencontres</h2>' + cards(grouped.undated) + '</section>';
  }
  return html;
}

// ISO datetime -> "dd/mm  HH:mm" in Europe/Paris, or null.
function formatLastUpdated(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return null;
  const parts = {};
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
  if (!parts.day || !parts.month || !parts.hour || !parts.minute) return null;
  return parts.day + '/' + parts.month + '  ' + parts.hour + ':' + parts.minute;
}

function renderBadgeLegend() {
  return '<div id="badge-legend" class="badge-legend">' +
    '<div class="legend-item"><span class="legend-swatch"><img class="legend-badge-penalty" src="/penalty-badge.png" alt="" width="24" height="20"></span><span>Tireur de penalty désigné</span></div>' +
    '<div class="legend-item"><span class="legend-swatch"><img class="legend-badge-captain" src="/captain-badge.png" alt="" width="28" height="28"></span><span>Capitaine</span></div>' +
    '</div>';
}

export function journeePath(journee) {
  return '/journee/' + encodeURIComponent(journee);
}

/**
 * @param {object} opts
 * @param {string[]} opts.journees   journée labels, as returned by ?meta=1
 * @param {string}   opts.selected   the journée being shown
 * @param {boolean}  opts.isDefault  true when served at "/" (canonical = "/")
 * @param {object}   opts.compos     the ?journee= payload
 * @param {object}   opts.dnpByTeam  { equipe: joueurs[] }
 * @param {boolean}  opts.dnpOk      false when the DNP fetch failed
 */
export function renderPage({ journees, selected, isDefault, compos, dnpByTeam, dnpOk }) {
  const canonical = SITE_URL + (isDefault ? '/' : journeePath(selected));
  const title = isDefault ? TITLE : 'Journée ' + selected + ' — ' + TITLE;
  const options = journees.map((j) =>
    '<option value="' + escapeHtml(j) + '"' + (j === selected ? ' selected' : '') + '>' + escapeHtml(j) + '</option>'
  ).join('');
  const lastUpdated = formatLastUpdated(compos && compos.lastUpdated);
  const score = compos && compos.score;

  return '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escapeHtml(title) + '</title>\n' +
    '<meta name="description" content="' + escapeHtml(DESCRIPTION) + '">\n' +
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">\n' +
    '<link rel="icon" type="image/png" href="https://static.wixstatic.com/media/449182_b075115d95e54908bebcaaef43561929~mv2.png/v1/fill/w_64,h_64,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/newlogo.png">\n' +
    '<meta name="robots" content="index, follow">\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:site_name" content="Fantasy Coach">\n' +
    '<meta property="og:title" content="Fantasy Coach | Compositions Probables Ligue 1">\n' +
    '<meta property="og:description" content="' + escapeHtml(DESCRIPTION) + '">\n' +
    '<meta property="og:url" content="' + escapeHtml(canonical) + '">\n' +
    '<meta property="og:image" content="' + SITE_URL + '/og-image.jpg">\n' +
    '<meta property="og:image:type" content="image/jpeg">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="Fantasy Coach — Les Compos Probables : composition probable et formation, équipe par équipe, Ligue 1">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="Fantasy Coach | Compositions Probables Ligue 1">\n' +
    '<meta name="twitter:description" content="' + escapeHtml(DESCRIPTION) + '">\n' +
    '<meta name="twitter:image" content="' + SITE_URL + '/og-image.jpg">\n' +
    '<script type="application/ld+json">\n' + JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Compositions Probables Ligue 1 — Fantasy Coach',
      url: SITE_URL + '/',
      description: 'Compositions probables de Ligue 1, journée par journée, équipe par équipe.',
      inLanguage: 'fr',
    }).replace(/</g, '\\u003c') + '\n</script>\n' +
    '<!-- Shared nav/ads/feedback/analytics components — see https://github.com/lionelleboiteux/fc-shared -->\n' +
    '<script src="https://assets.fantasy-coach.fr/nav.js" defer></script>\n' +
    '<script src="https://assets.fantasy-coach.fr/ads.js" async></script>\n' +
    '<script src="https://assets.fantasy-coach.fr/feedback.js" defer></script>\n' +
    '<script src="https://assets.fantasy-coach.fr/ga.js" async></script>\n' +
    '<script src="https://assets.fantasy-coach.fr/pageview.js" data-project="compos" async></script>\n' +
    '<script src="https://assets.fantasy-coach.fr/team-form.js" defer></script>\n' +
    '<style>\n' + STYLES + '</style>\n</head>\n<body>\n' +
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="shirt-clip"><path d="' + SHIRT_PATH + '"/></clipPath></defs></svg>\n' +
    '<fc-nav current="compos"></fc-nav>\n\n' +
    '<main id="app">\n' +
    '  <h1>Compositions probables — Ligue 1</h1>\n' +
    '  <div class="intro"><p>Choisissez une journée pour voir, équipe par équipe, la composition probable et la formation.</p></div>\n' +
    '  <div class="journee-picker"><label for="journee-select">Journée</label><div class="journee-picker-row">' +
    '<select id="journee-select">' + options + '</select>' +
    '<span id="gameweek-score" class="gameweek-score">' + (score ? escapeHtml(score.percent) + '%' : '') + '</span>' +
    '</div></div>\n' +
    '  <p id="last-updated" class="last-updated">' + (lastUpdated
      ? '<span>Dernière mise à jour :</span><span class="last-updated-time">' + escapeHtml(lastUpdated) + '</span>' : '') + '</p>\n' +
    '  ' + renderBadgeLegend() + '\n' +
    '  <div id="match-list" class="journee-results">' + renderMatches(buildMatches(compos && compos.equipes), dnpByTeam, dnpOk) + '</div>\n' +
    '  <noscript><nav>' + journees.map((j) => '<a href="' + escapeHtml(journeePath(j)) + '">Journée ' + escapeHtml(j) + '</a>').join(' · ') + '</nav></noscript>\n' +
    '  <fc-feedback project="compos"></fc-feedback>\n' +
    '</main>\n\n' +
    '<footer class="site-footer">&copy;2026 by Fantasy Coach.</footer>\n' +
    '<script>\n' +
    '(function () {\n' +
    '  var select = document.getElementById("journee-select");\n' +
    '  select.addEventListener("change", function () { location.href = "/journee/" + encodeURIComponent(select.value); });\n' +
    // The crest host can 404 or be blocked: swap in the initials badge.
    '  document.addEventListener("error", function (e) {\n' +
    '    var t = e.target;\n' +
    '    if (!t || t.tagName !== "IMG" || !t.hasAttribute("data-fallback")) return;\n' +
    '    var s = document.createElement("span");\n' +
    '    s.className = "team-logo-fallback";\n' +
    '    s.textContent = t.getAttribute("data-fallback");\n' +
    '    t.replaceWith(s);\n' +
    '  }, true);\n' +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

export function renderErrorPage(message) {
  return '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Compositions probables — indisponible</title>' +
    '<style>' + STYLES + '</style></head><body><main id="app"><h1>Compositions probables — Ligue 1</h1>' +
    '<div class="error-state">' + escapeHtml(message) + '</div>' +
    '<p style="text-align:center"><a href="">Réessayer</a></p></main></body></html>\n';
}
