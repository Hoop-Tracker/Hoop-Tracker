import { h, svg } from '../dom.js';
import { POSITIONS, ZONES, AREAS, SIDES, LAYUP_SPOTS, LAYUP_SIDES, drawCourt, positionById } from '../court.js';
import * as store from '../store.js';
import { shotTypeLabel, finishLabel } from '../store.js';
import {
  aggregate, sessionTotals, sessionsInRange, previousRange, delta, RANGES, fmtPct, pct, durationLabel, shortDate, dateLabel,
  isShooting, isFT, isLayup, layupAggregate, LAYUP_GOAL_SCOPES, personalBests, goalProgress, goalScopeLabel, GOAL_WINDOWS, longestRun, missCounts,
} from '../stats.js';
import { trendChart } from '../chart.js';
import { getSettings, updateSettings } from '../settings.js';
import { getFriends } from '../sync.js';
import { ui, render, setTab, toast, openSheet, locationInput } from '../ui.js';
import { editSessionView, startEditing } from './edit-session.js';
import { shootingCards } from './shooting-stats.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const playerLabel = (key) => (key === 'me' ? 'You' : cap(key));

function playerData(key) {
  if (key === 'me') return { sessions: store.getSessions(), goals: store.getGoals() };
  const f = getFriends()[key];
  return f ? { sessions: f.sessions, goals: f.goals } : null;
}

const byType = (sessions) => (ui.shotType === 'all' ? sessions : sessions.filter((s) => (s.shotType || 'none') === ui.shotType));
// Location filter matches case-insensitively, so "YMCA" and "ymca" are the same place (also across teammates).
const byLoc = (sessions) => (ui.location === 'all' ? sessions : sessions.filter((s) => (s.location || '').toLowerCase() === ui.location));
function locationsOf(sessions) {
  const m = new Map();
  for (let i = sessions.length - 1; i >= 0; i--) {
    const loc = sessions[i].location;
    if (loc && !m.has(loc.toLowerCase())) m.set(loc.toLowerCase(), loc);
  }
  return m; // lower-case key → display name, most recent first
}
const heatClass = (made, att) => (!att ? 'heat-none' : `heat-${Math.min(4, Math.floor(pct(made, att) / 20))}`);
function diffClass(d) {
  if (d === null) return 'heat-none';
  if (Math.abs(d) < 3) return 'diff-0';
  const step = Math.abs(d) >= 20 ? 3 : Math.abs(d) >= 10 ? 2 : 1;
  return `diff-${d > 0 ? 'pos' : 'neg'}-${step}`;
}
const deltaEl = (d, suffix = '') => (d === null ? null
  : h('span', { class: `delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`, text: `${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d)}${suffix}` }));

export function progressView() {
  if (ui.editingSession) return editSessionView();
  const friends = getFriends();
  const friendNames = Object.keys(friends).sort();
  if (ui.player !== 'me' && !friends[ui.player]) ui.player = 'me';
  if (ui.compare && ui.compare !== 'me' && !friends[ui.compare]) ui.compare = '';
  if (ui.compare === ui.player) ui.compare = '';
  const isMe = ui.player === 'me';
  const data = playerData(ui.player);

  const playerChips = friendNames.length ? h('div', { class: 'chips players' },
    ['me', ...friendNames].map((k) => h('button', { class: 'chip', 'aria-pressed': String(ui.player === k),
      onclick: () => { ui.player = k; ui.range = RANGES.some((r) => r.id === ui.range) ? ui.range : 'last5'; ui.inspect = null; render(); } }, playerLabel(k)))) : null;

  if (!data.sessions.length) {
    return h('section', { class: 'view' }, playerChips, h('div', { class: 'panel empty-state' },
      h('h2', { text: isMe ? 'No sessions yet' : `${playerLabel(ui.player)} hasn't synced any sessions yet` }),
      isMe ? h('p', { class: 'muted', text: 'Finish a practice session and your shooting heatmap and trends will appear here.' }) : null,
      isMe ? h('button', { class: 'btn-primary', onclick: () => setTab('practice') }, 'Go to practice') : null),
      isMe ? goalsCard(data.goals, [], true) : null);
  }

  // Location filter (only places that appear in this player's sessions)
  const locations = locationsOf(data.sessions);
  if (ui.location !== 'all' && !locations.has(ui.location)) ui.location = 'all';
  const sessions = byLoc(data.sessions);
  const locName = ui.location === 'all' ? null : locations.get(ui.location);

  // Shot-type filter (only types that appear in this player's sessions)
  const types = [...new Set(sessions.filter(isShooting).map((s) => s.shotType || 'none'))];
  if (ui.shotType !== 'all' && !types.includes(ui.shotType)) ui.shotType = 'all';
  const shooting = byType(sessions.filter(isShooting));
  const ftSessions = sessions.filter(isFT);
  const layupSessions = sessions.filter(isLayup);

  const single = shooting.find((s) => s.id === ui.range);
  if (!single && !RANGES.some((r) => r.id === ui.range)) ui.range = 'last5';
  const rangeId = single ? 'last5' : ui.range;
  const selected = single ? [single] : sessionsInRange(shooting, ui.range);
  const agg = aggregate(selected);
  const prev = previousRange(shooting, ui.range, single?.id);
  const prevAgg = prev ? aggregate(prev.sessions) : null;

  const cmpKey = ui.compare;
  const cmpData = cmpKey ? playerData(cmpKey) : null;
  const cmpShooting = cmpData ? byType(byLoc(cmpData.sessions).filter(isShooting)) : null;
  const cmpAgg = cmpShooting ? aggregate(sessionsInRange(cmpShooting, rangeId)) : null;

  const rangeChips = h('div', { class: 'chips' },
    RANGES.map((r) => h('button', { class: 'chip', 'aria-pressed': String(ui.range === r.id), onclick: () => { ui.range = r.id; render(); } }, r.label)));
  const typeChips = types.length > 1 ? h('div', { class: 'chips small-chips' },
    [['all', 'All shot types'], ...types.map((t) => [t, t === 'none' ? 'Standard / any' : shotTypeLabel(t)])].map(([id, label]) =>
      h('button', { class: 'chip', 'aria-pressed': String(ui.shotType === id), onclick: () => { ui.shotType = id; render(); } }, label))) : null;

  let locFilter = null;
  if (locations.size) {
    const pick = (id) => { ui.location = id; ui.inspect = null; if (!RANGES.some((r) => r.id === ui.range)) ui.range = 'last5'; render(); };
    if (locations.size <= 5) {
      locFilter = h('div', { class: 'chips small-chips' },
        [['all', 'All locations'], ...[...locations].map(([id, name]) => [id, `📍 ${name}`])].map(([id, label]) =>
          h('button', { class: 'chip', 'aria-pressed': String(ui.location === id), onclick: () => pick(id) }, label)));
    } else {
      const sel = h('select', { class: 'select compact', 'aria-label': 'Location' },
        h('option', { value: 'all', text: '📍 All locations' }),
        [...locations].map(([id, name]) => h('option', { value: id, text: `📍 ${name}`, selected: ui.location === id })));
      sel.addEventListener('change', () => pick(sel.value));
      locFilter = sel;
    }
  }

  let compareRow = null;
  if (friendNames.length) {
    const sel = h('select', { class: 'select compact', 'aria-label': 'Compare with' },
      h('option', { value: '', text: 'No comparison' }),
      ['me', ...friendNames].filter((k) => k !== ui.player).map((k) => h('option', { value: k, text: `Compare with ${playerLabel(k)}`, selected: ui.compare === k })));
    sel.addEventListener('change', () => { ui.compare = sel.value; render(); });
    compareRow = sel;
  }

  const rangeTitle = single ? `Session · ${shortDate(single.startedAt)}` : RANGES.find((r) => r.id === ui.range).label;
  const titleText = `${isMe ? '' : `${playerLabel(ui.player)} · `}${rangeTitle}${locName && !single ? ` · ${locName}` : ''}`;

  const pageTabs = h('div', { class: 'segmented two', role: 'tablist', 'aria-label': 'Progress pages' },
    [['overview', 'Overview'], ['shooting', 'Shooting']].map(([id, label]) =>
      h('button', { role: 'tab', 'aria-checked': String(ui.progressPage === id), 'aria-selected': String(ui.progressPage === id),
        onclick: () => { ui.progressPage = id; ui.inspect = null; render(); window.scrollTo(0, 0); } }, label)));

  if (ui.progressPage === 'shooting') {
    return h('section', { class: 'view progress' },
      playerChips, pageTabs, rangeChips, locFilter, typeChips, compareRow,
      h('h2', { class: 'section-title', text: titleText }),
      shooting.length
        ? shootingCards({ shooting, agg, prevAgg, prev, rangeTitle, rangeShort: single ? 'Session' : RANGES.find((r) => r.id === ui.range).label,
          rangeId, locations, byLocPool: byType(data.sessions.filter(isShooting)), byTypePool: byLoc(data.sessions).filter(isShooting),
          who: playerLabel(ui.player), cmp: cmpAgg ? { name: playerLabel(cmpKey), shooting: cmpShooting, agg: cmpAgg } : null })
        : h('div', { class: 'card' }, h('p', { class: 'muted', text: 'No shooting sessions match these filters yet.' })));
  }

  const tiles = h('div', { class: 'tiles' },
    tile('Shooting', fmtPct(agg.all.made, agg.all.att), prevAgg ? deltaEl(delta(agg.all, prevAgg.all), ' pts') : null),
    tile('Made / taken', `${agg.all.made}/${agg.all.att}`),
    tile(single ? 'Duration' : 'Sessions', single ? durationLabel(single) || '–' : String(selected.length)),
  );
  const prevNote = prev ? h('p', { class: 'muted small', text: `▲▼ = change in percentage points vs ${prev.label}.` }) : null;

  const sections = [
    playerChips, pageTabs, rangeChips, locFilter, typeChips, compareRow,
    h('h2', { class: 'section-title', text: titleText }),
    single?.location ? h('p', { class: 'muted small', text: `📍 ${single.location}` }) : null,
    single?.note ? h('p', { class: 'session-note', text: `“${single.note}”` }) : null,
    tiles,
    heatCard(agg, rangeTitle, sessions, cmpKey, cmpAgg, selected),
    zoneCard(agg, prevAgg, prev, cmpKey, cmpAgg, shooting),
    prevNote,
    missCard(selected),
    h('div', { class: 'card' }, h('h3', { text: 'Trend' }),
      h('div', { class: 'chips' }, [['all', 'All shots'], ...Object.entries(ZONES).map(([id, z]) => [id, z.label])].map(([id, label]) =>
        h('button', { class: 'chip', 'aria-pressed': String(ui.trendZone === id), onclick: () => { ui.trendZone = id; render(); } }, label))),
      trendChart([{ label: playerLabel(ui.player), sessions: shooting, cls: 's1' },
        ...(cmpShooting ? [{ label: playerLabel(cmpKey), sessions: cmpShooting, cls: 's2' }] : [])], ui.trendZone)),
    calendarCard(sessions, isMe),
    ftSessions.length || cmpData?.sessions.some(isFT) ? ftCard(ftSessions, rangeId, cmpKey, cmpData) : null,
    layupSessions.length || cmpData?.sessions.some(isLayup) ? layupCard(layupSessions, rangeId, cmpKey, cmpData) : null,
    bestsCard(sessions),
    goalsCard(data.goals, data.sessions, isMe),
    friendNames.length ? leaderboard(['me', ...friendNames], rangeId, locName) : null,
    sessionsCard(sessions, isMe),
  ];
  return h('section', { class: 'view progress' }, ...sections);
}

const tile = (label, value, extra) => h('div', { class: 'tile' }, h('div', { class: 'tile-value', text: value }), h('div', { class: 'tile-label' }, label, extra ? ' ' : '', extra));

// Pooled made/attempts over the spots in an area (same as averaging the spots when each spot gets the same number of shots).
function areaTotals(byPos, area) {
  return POSITIONS.filter(area.test).reduce((t, p) => ({ made: t.made + byPos[p.id].made, att: t.att + byPos[p.id].att }), { made: 0, att: 0 });
}

// "Left 45% · Right 38%: 7 pts better from the left"
function sideSummary(byPos) {
  const [l, r] = SIDES.map((s) => areaTotals(byPos, s));
  if (!l.att || !r.att) return null;
  const d = pct(l.made, l.att) - pct(r.made, r.att);
  return h('p', { class: 'side-summary' },
    h('span', {}, 'Left ', h('strong', { text: fmtPct(l.made, l.att) })), ' · ',
    h('span', {}, 'Right ', h('strong', { text: fmtPct(r.made, r.att) })),
    h('span', { class: 'muted', text: Math.abs(d) < 3 ? '  Even on both sides' : `  ${Math.abs(d)} pts better from the ${d > 0 ? 'left' : 'right'}` }));
}

function drawAreas(court, g, list, agg, cmpAgg) {
  const layer = svg('g', { class: 'areas' });
  for (const a of list) {
    const s = areaTotals(agg.byPos, a);
    let label, cls;
    if (cmpAgg) {
      const c = areaTotals(cmpAgg.byPos, a);
      const d = s.att && c.att ? pct(s.made, s.att) - pct(c.made, c.att) : null;
      label = d === null ? '–' : `${d > 0 ? '+' : ''}${d}`;
      cls = diffClass(d);
    } else {
      label = fmtPct(s.made, s.att);
      cls = heatClass(s.made, s.att);
    }
    const sel = ui.inspect === `area:${a.id}`;
    const el = svg('g', { class: `area ${cls}${sel ? ' selected' : ''}`, role: 'button', tabindex: 0, 'aria-label': `${a.label}: ${s.made} of ${s.att}` },
      svg('path', { d: a.d, class: 'area-fill' }),
      svg('text', { x: a.lx, y: a.ly - 6, class: 'area-pct', text: label }),
      cmpAgg ? null : svg('text', { x: a.lx, y: a.ly + 20, class: 'area-sub', text: s.att ? `${s.made}/${s.att}` : 'no shots' }));
    const tap = () => { ui.inspect = sel ? null : `area:${a.id}`; render(); };
    el.addEventListener('click', tap);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    layer.append(el);
  }
  court.insertBefore(layer, g);
  // Faint markers show where the spots are; the area labels carry the numbers.
  for (const p of POSITIONS) g.append(svg('circle', { cx: p.x, cy: p.y, r: 5, class: 'area-spot' }));
}

function heatCard(agg, rangeTitle, allSessions, cmpKey, cmpAgg, selected) {
  const labelMode = getSettings().heatLabel;
  const toggleLabels = () => updateSettings({ heatLabel: labelMode === 'pct' ? 'made' : 'pct' });
  const mode = getSettings().heatMode; // remembered between app opens
  const areaList = mode === 'areas' ? AREAS : mode === 'sides' ? SIDES : null;
  const court = svg('svg', { 'aria-label': `Shooting heatmap, ${rangeTitle}` });
  const g = drawCourt(court);
  if (areaList) drawAreas(court, g, areaList, agg, cmpAgg);
  for (const p of areaList ? [] : POSITIONS) {
    const s = agg.byPos[p.id];
    let label, cls;
    if (cmpAgg) {
      const c = cmpAgg.byPos[p.id];
      const d = s.att && c.att ? pct(s.made, s.att) - pct(c.made, c.att) : null;
      label = d === null ? '–' : `${d > 0 ? '+' : ''}${d}`;
      cls = diffClass(d);
    } else {
      label = !s.att ? '–' : labelMode === 'pct' ? `${pct(s.made, s.att)}%` : `${s.made}/${s.att}`;
      cls = heatClass(s.made, s.att);
    }
    const el = svg('g', { class: `spot heat ${cls}${ui.inspect === p.id ? ' selected' : ''}`, transform: `translate(${p.x} ${p.y})`, role: 'button', tabindex: 0,
      'aria-label': `${p.name}: ${s.made} of ${s.att}` },
      svg('circle', { r: 34, class: 'hit' }), svg('circle', { r: 23, class: 'ring' }),
      svg('text', { class: `spot-label${label.length > 5 ? ' tiny' : label.length > 3 ? ' small' : ''}`, text: label }));
    const tap = () => { if (!cmpAgg) toggleLabels(); ui.inspect = p.id; render(); };
    el.addEventListener('click', tap);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    g.append(el);
  }

  const who = playerLabel(ui.player);
  const key = cmpAgg
    ? h('span', { class: 'heat-key static' }, h('b', { text: '±' }), ` vs ${playerLabel(cmpKey)}`)
    : areaList ? null
    : h('button', { class: 'heat-key', onclick: () => { toggleLabels(); render(); }, 'aria-label': `Labels show ${labelMode === 'pct' ? 'percentage' : 'shots made out of taken'}. Tap to switch.` },
      labelMode === 'pct' ? h('span', {}, h('b', { text: '%' }), ' Percentage') : h('span', {}, h('b', { text: 'M/T' }), ' Made / Taken'));
  const modes = h('div', { class: 'segmented mini', role: 'radiogroup', 'aria-label': 'Heatmap view' },
    [['spots', 'Spots'], ['areas', 'Areas'], ['sides', 'Sides']].map(([id, label]) =>
      h('button', { role: 'radio', 'aria-checked': String(mode === id), onclick: () => { updateSettings({ heatMode: id }); ui.inspect = null; render(); } }, label)));
  const legend = cmpAgg
    ? h('div', { class: 'heat-legend' }, h('span', { text: `${playerLabel(cmpKey)} better` }),
      ['neg-3', 'neg-2', 'neg-1', '0', 'pos-1', 'pos-2', 'pos-3'].map((c) => h('span', { class: `swatch diff-${c}` })), h('span', { text: `${who} better` }))
    : h('div', { class: 'heat-legend' }, h('span', { text: '0%' }), [0, 1, 2, 3, 4].map((i) => h('span', { class: `swatch heat-${i}` })), h('span', { text: '100%' }));

  let inspect;
  const area = areaList && ui.inspect?.startsWith('area:') ? areaList.find((a) => `area:${a.id}` === ui.inspect) : null;
  if (area) {
    const t = areaTotals(agg.byPos, area);
    const c = cmpAgg ? areaTotals(cmpAgg.byPos, area) : null;
    inspect = h('div', { class: 'inspect' },
      h('strong', { text: area.label }),
      h('span', { text: `${who}, ${rangeTitle}: ${t.made}/${t.att} (${fmtPct(t.made, t.att)})` }),
      c ? h('span', { text: `${playerLabel(cmpKey)}: ${c.made}/${c.att} (${fmtPct(c.made, c.att)})` }) : null,
      h('span', { class: 'muted', text: POSITIONS.filter(area.test).map((p) => `${p.short} ${fmtPct(agg.byPos[p.id].made, agg.byPos[p.id].att)}`).join(' · ') }));
  } else if (areaList) {
    inspect = h('div', {},
      h('p', { class: 'muted small center', text: `Tap an area for its spots.${mode === 'sides' ? ' Middle spots (key, free-throw line, top, half court) count for neither side.' : ''}` }));
  } else if (ui.inspect && positionById(ui.inspect)) {
    const p = positionById(ui.inspect);
    const r = agg.byPos[p.id];
    const life = aggregate(allSessions.filter(isShooting)).byPos[p.id];
    const c = cmpAgg?.byPos[p.id];
    inspect = h('div', { class: 'inspect' },
      h('strong', { text: p.name }),
      h('span', { text: `${who}, ${rangeTitle}: ${r.made}/${r.att} (${fmtPct(r.made, r.att)})` }),
      c ? h('span', { text: `${playerLabel(cmpKey)}: ${c.made}/${c.att} (${fmtPct(c.made, c.att)})` }) : null,
      h('span', { class: 'muted', text: `${who}, all time: ${life.made}/${life.att} (${fmtPct(life.made, life.att)})` }),
      (() => { const ml = missLine(missCounts(selected, (pos) => pos === p.id)); return ml ? h('span', { class: 'muted', text: `Misses: ${ml}` }) : null; })());
  } else {
    inspect = h('p', { class: 'muted small center', text: cmpAgg ? 'Tap a spot for details.' : 'Tap a spot to switch between % and made/taken.' });
  }
  return h('div', { class: 'card heat-card' }, h('div', { class: 'heat-top' }, modes, key), h('div', { class: 'court-wrap' }, court), legend,
    areaList && !cmpAgg ? sideSummary(agg.byPos) : null, inspect);
}

function zoneCard(agg, prevAgg, prev, cmpKey, cmpAgg, shooting) {
  const allAgg = aggregate(shooting);
  const head = cmpAgg
    ? ['Zone', playerLabel(ui.player), playerLabel(cmpKey), 'Diff']
    : ['Zone', 'Made', '%', prev ? 'Change' : null, 'All time'].filter(Boolean);
  const rows = Object.entries(ZONES).map(([id, z]) => {
    const r = agg.byZone[id];
    if (cmpAgg) {
      const c = cmpAgg.byZone[id];
      return h('tr', {}, h('td', { text: z.label }), h('td', { text: fmtPct(r.made, r.att) }), h('td', { text: fmtPct(c.made, c.att) }), h('td', {}, deltaEl(delta(r, c))));
    }
    return h('tr', {}, h('td', { text: z.label }), h('td', { text: `${r.made}/${r.att}` }), h('td', { text: fmtPct(r.made, r.att) }),
      prev ? h('td', {}, deltaEl(delta(r, prevAgg.byZone[id]))) : null,
      h('td', { class: 'muted', text: fmtPct(allAgg.byZone[id].made, allAgg.byZone[id].att) }));
  });
  return h('div', { class: 'card' }, h('h3', { text: 'By zone' }),
    h('table', { class: 'zones' }, h('thead', {}, h('tr', {}, head.map((t) => h('th', { text: t })))), h('tbody', {}, rows)));
}

const DIR_LABEL = { short: 'Short', long: 'Long', left: 'Left', right: 'Right' };
function missLine(c) {
  if (!c.total) return null;
  const top = Object.keys(DIR_LABEL).sort((a, b) => c[b] - c[a])[0];
  return `${Object.keys(DIR_LABEL).map((d) => `${DIR_LABEL[d]} ${c[d]}`).join(' · ')}  →  mostly ${top}`;
}

function missCard(sessions) {
  const rows = Object.entries(ZONES).map(([id, z]) => [z.label, missCounts(sessions, (pos) => positionById(pos)?.zone === id)]).filter(([, c]) => c.total);
  if (!rows.length) return null;
  return h('div', { class: 'card' }, h('h3', { text: 'Miss tendencies' }),
    h('table', { class: 'zones' },
      h('thead', {}, h('tr', {}, ['Zone', 'Short', 'Long', 'Left', 'Right', 'Mostly'].map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.map(([label, c]) => {
        const top = Object.keys(DIR_LABEL).sort((a, b) => c[b] - c[a])[0];
        return h('tr', {}, h('td', { text: label }), ...Object.keys(DIR_LABEL).map((d) => h('td', { text: String(c[d]) })), h('td', {}, h('strong', { text: DIR_LABEL[top] })));
      }))),
    h('p', { class: 'muted small', text: 'Only misses with a direction recorded are counted.' }));
}

// Month view of practice days; darker = more shots that day. Tap a day to see its sessions.
let calMonth = null;
function calendarCard(sessions, isMe) {
  const today = new Date();
  calMonth ||= new Date(today.getFullYear(), today.getMonth(), 1);
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const byDay = new Map();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    const e = byDay.get(d.getDate()) || { shots: 0, list: [] };
    e.shots += Object.values(s.shots).reduce((a, l) => a + l.length, 0);
    e.list.push(s);
    byDay.set(d.getDate(), e);
  }
  const days = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const level = (n) => (n === 0 ? 0 : n <= 40 ? 1 : n <= 80 ? 2 : n <= 160 ? 3 : 4);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-cell empty' }));
  for (let d = 1; d <= days; d++) {
    const e = byDay.get(d);
    const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
    const label = new Date(y, m, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    cells.push(e
      ? h('button', { class: `cal-cell cal-${level(e.shots)}${isToday ? ' today' : ''}`, 'aria-label': `${label}: ${e.list.length} session${e.list.length > 1 ? 's' : ''}, ${e.shots} shots`,
        onclick: () => daySheet(label, e.list, isMe) }, String(d))
      : h('span', { class: `cal-cell${isToday ? ' today' : ''}`, 'aria-label': label }, String(d)));
  }
  const shift = (n) => { calMonth = new Date(y, m + n, 1); render(); };
  const practiceDays = byDay.size;
  return h('div', { class: 'card' },
    h('div', { class: 'row-between' },
      h('button', { class: 'btn-ghost cal-nav', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h('h3', { class: 'cal-title', text: calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
      h('button', { class: 'btn-ghost cal-nav', 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
    h('div', { class: 'cal-grid cal-head', 'aria-hidden': 'true' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', { text: d }))),
    h('div', { class: 'cal-grid' }, cells),
    h('p', { class: 'muted small center', text: `${practiceDays} practice day${practiceDays === 1 ? '' : 's'} this month · darker = more shots` }));
}

function daySheet(label, list, isMe) {
  openSheet((close) => [
    h('h2', { text: label }),
    h('ul', { class: 'sessions' }, list.map((s) => {
      const t = sessionTotals(s, isFT(s) ? 'ft' : 'all');
      return h('li', {}, h('button', { class: 'session-row', onclick: () => { close(); sessionSheet(s, isMe); } },
        h('span', { class: 'session-when' }, h('strong', { text: s.name }), h('span', { class: 'muted small', text: durationLabel(s) })),
        h('span', { class: 'session-score', text: `${t.made}/${t.att} · ${fmtPct(t.made, t.att)}` })));
    })),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-primary', onclick: close }, 'Close')),
  ]);
}

// Layups: side × hand table, weak-hand gap, finishes, trend. Never mixed into shooting %.
function layupCard(layups, rangeId, cmpKey, cmpData) {
  const inRange = sessionsInRange(layups, rangeId);
  const la = layupAggregate(inRange);
  const rangeLabel = RANGES.find((r) => r.id === rangeId)?.label || 'Recent';
  const cell = (v) => h('td', {}, v.att ? h('span', {}, h('strong', { text: fmtPct(v.made, v.att) }), h('span', { class: 'muted small', text: ` ${v.made}/${v.att}` })) : '–');
  const add = (a, b) => ({ made: a.made + b.made, att: a.att + b.att });
  const rows = LAYUP_SIDES.map(([side, label]) => {
    const [l, r] = ['left', 'right'].map((hand) => la.byPos[LAYUP_SPOTS.find((p) => p.side === side && p.hand === hand).id]);
    return { label, l, r, all: add(l, r) };
  }).filter((x) => x.all.att);
  const { left: lh, right: rh } = la.byHand;
  let handNote = null;
  if (lh.att && rh.att) {
    const d = pct(lh.made, lh.att) - pct(rh.made, rh.att);
    handNote = h('p', { class: 'muted small', text: Math.abs(d) < 3 ? 'Both hands are about even.' : `Your ${d > 0 ? 'right' : 'left'} hand is ${Math.abs(d)} pts behind.` });
  }
  const finishes = [...new Set(inRange.map((s) => s.finish || ''))];
  const finishRows = finishes.length > 1 ? finishes.map((f) => {
    const a = layupAggregate(inRange.filter((s) => (s.finish || '') === f)).all;
    return h('li', {}, h('span', { class: 'muted', text: finishLabel(f || null) }), h('span', {}, h('strong', { text: fmtPct(a.made, a.att) }), h('span', { class: 'muted small', text: ` ${a.made}/${a.att}` })));
  }) : null;
  const cmpLayups = cmpData ? byLoc(cmpData.sessions).filter(isLayup) : null;
  return h('div', { class: 'card' }, h('h3', { text: 'Layups' }),
    h('div', { class: 'tiles' },
      tile(rangeLabel, fmtPct(la.all.made, la.all.att)),
      tile('Left hand', fmtPct(lh.made, lh.att)),
      tile('Right hand', fmtPct(rh.made, rh.att))),
    rows.length ? h('table', { class: 'zones layup-table' },
      h('thead', {}, h('tr', {}, ['', 'Left hand', 'Right hand', 'Total'].map((t) => h('th', { text: t })))),
      h('tbody', {}, rows.map((x) => h('tr', {}, h('td', { text: x.label }), cell(x.l), cell(x.r), cell(x.all))))) : h('p', { class: 'muted small', text: 'No layups in this range.' }),
    handNote,
    finishRows ? h('ul', { class: 'bests' }, finishRows) : null,
    trendChart([{ label: playerLabel(ui.player), sessions: layups, cls: 's1' },
      ...(cmpLayups?.length ? [{ label: playerLabel(cmpKey), sessions: cmpLayups, cls: 's2' }] : [])], 'all'));
}

function ftCard(ftSessions, rangeId, cmpKey, cmpData) {
  const inRange = sessionsInRange(ftSessions, rangeId);
  const t = inRange.reduce((a, s) => { const x = sessionTotals(s, 'ft'); a.made += x.made; a.att += x.att; return a; }, { made: 0, att: 0 });
  const best = Math.max(0, ...ftSessions.map((s) => longestRun(s.shots.ft || [])));
  const cmpFT = cmpData ? byLoc(cmpData.sessions).filter(isFT) : null;
  return h('div', { class: 'card' }, h('h3', { text: 'Free throws' }),
    h('div', { class: 'tiles' },
      tile(RANGES.find((r) => r.id === rangeId)?.label || 'Recent', fmtPct(t.made, t.att)),
      tile('Made / taken', `${t.made}/${t.att}`),
      tile('Best streak', String(best))),
    trendChart([{ label: playerLabel(ui.player), sessions: ftSessions, cls: 's1' },
      ...(cmpFT?.length ? [{ label: playerLabel(cmpKey), sessions: cmpFT, cls: 's2' }] : [])], 'ft'));
}

function bestsCard(sessions) {
  const b = personalBests(sessions);
  const row = (label, value, sub) => h('li', {}, h('span', { class: 'muted', text: label }), h('span', {}, h('strong', { text: value }), sub ? h('span', { class: 'muted small', text: ` ${sub}` }) : null));
  return h('div', { class: 'card' }, h('h3', { text: 'Personal bests' }),
    h('ul', { class: 'bests' },
      row('Best session (20+ shots)', b.bestSession ? fmtPct(b.bestSession.made, b.bestSession.att) : '–', b.bestSession ? dateLabel(b.bestSession.s.startedAt) : ''),
      row('Most makes in a row', b.bestRun ? String(b.bestRun) : '–'),
      row('Best spot (15+ shots)', b.bestSpot ? b.bestSpot.p.name : '–', b.bestSpot ? fmtPct(b.bestSpot.made, b.bestSpot.att) : ''),
      row('Most shots in a session', b.mostShots ? String(b.mostShots.att) : '–'),
      row('Practice-day streak', `${b.days.current} day${b.days.current === 1 ? '' : 's'}`, `(longest ${b.days.longest})`),
      b.ftBest || b.ftRun ? row('Free throws: best session / streak', b.ftBest ? fmtPct(b.ftBest.made, b.ftBest.att) : '–', `· ${b.ftRun} in a row`) : null,
      b.layupBest || b.layupRun ? row('Layups: best session (10+) / streak', b.layupBest ? fmtPct(b.layupBest.made, b.layupBest.att) : '–', `· ${b.layupRun} in a row`) : null));
}

function goalsCard(goals, sessions, editable) {
  const items = goals.map((g) => {
    const pr = goalProgress(g, sessions);
    const bar = h('div', { class: 'goal-bar' }, h('span', {}));
    bar.firstChild.style.width = `${Math.min(100, ((pr.value || 0) / g.target) * 100)}%`;
    if (pr.done) bar.classList.add('done');
    const win = GOAL_WINDOWS.find((w) => w.id === g.window)?.label || '';
    return h('li', { class: 'goal' },
      h('div', { class: 'row-between' },
        h('strong', { text: `${goalScopeLabel(g.scope)}: ${g.target}%` }),
        pr.done ? h('span', { class: 'badge-good', text: '✓ Reached' }) : null),
      bar,
      h('div', { class: 'row-between' },
        h('span', { class: 'muted small', text: `${pr.value === null ? 'No shots yet' : `Now ${pr.value}%`} ${win}${g.by ? ` · by ${dateLabel(`${g.by}T12:00:00Z`)}` : ''}` }),
        editable ? h('button', { class: 'btn-link danger small', onclick: () => { if (confirm('Delete this goal?')) { store.deleteGoal(g.id); render(); } } }, 'Delete') : null));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row-between' }, h('h3', { text: 'Goals' }), editable ? h('button', { class: 'btn-link', onclick: addGoalSheet }, '+ Add goal') : null),
    items.length ? h('ul', { class: 'goals' }, items) : h('p', { class: 'muted small', text: editable ? 'Set a target, like 40% from the corners over your last 5 sessions.' : 'No goals set.' }));
}

function addGoalSheet() {
  openSheet((close) => {
    const scope = h('select', { class: 'select' },
      h('option', { value: 'all', text: 'Overall shooting' }),
      h('optgroup', { label: 'Zones' }, Object.entries(ZONES).map(([id, z]) => h('option', { value: `zone:${id}`, text: z.label }))),
      h('optgroup', { label: 'Spots' }, POSITIONS.map((p) => h('option', { value: `pos:${p.id}`, text: p.name }))),
      h('option', { value: 'ft', text: 'Free throws' }),
      h('optgroup', { label: 'Layups' }, LAYUP_GOAL_SCOPES.map(([id, label]) => h('option', { value: id, text: label }))));
    const target = h('input', { class: 'input', type: 'number', min: 1, max: 100, value: 40, inputmode: 'numeric' });
    const win = h('select', { class: 'select' }, GOAL_WINDOWS.map((w) => h('option', { value: w.id, text: cap(w.label) })));
    const by = h('input', { class: 'input', type: 'date' });
    return [
      h('h2', { text: 'New goal' }),
      h('label', { class: 'field-label', text: 'What' }), scope,
      h('label', { class: 'field-label', text: 'Target %' }), target,
      h('label', { class: 'field-label', text: 'Measured' }), win,
      h('label', { class: 'field-label', text: 'Deadline (optional)' }), by,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'),
        h('button', { class: 'btn-primary', onclick: () => {
          const t = Number(target.value);
          if (!Number.isFinite(t) || t < 1 || t > 100) { toast('Target must be between 1 and 100.'); return; }
          if (!store.addGoal({ scope: scope.value, target: t, window: win.value, by: by.value || null })) { toast('Could not save that goal.'); return; }
          close(); render();
        } }, 'Save goal')),
    ];
  });
}

function leaderboard(keys, rangeId, locName) {
  const rows = keys.map((k) => {
    const d = playerData(k);
    const a = aggregate(sessionsInRange(byType(byLoc(d.sessions).filter(isShooting)), rangeId));
    return { k, a };
  }).sort((x, y) => (pct(y.a.all.made, y.a.all.att) ?? -1) - (pct(x.a.all.made, x.a.all.att) ?? -1));
  const zoneIds = Object.keys(ZONES);
  const leader = Object.fromEntries(zoneIds.map((z) => [z, Math.max(...rows.map((r) => pct(r.a.byZone[z].made, r.a.byZone[z].att) ?? -1))]));
  return h('div', { class: 'card' },
    h('h3', { text: `Leaderboard · ${RANGES.find((r) => r.id === rangeId)?.label}${locName ? ` · ${locName}` : ''}` }),
    h('table', { class: 'zones leaderboard' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Player' }), h('th', { text: 'All' }), zoneIds.map((z) => h('th', { text: { close: 'Close', mid: 'Mid', three: '3PT', deep: 'Deep' }[z] })))),
      h('tbody', {}, rows.map(({ k, a }) => h('tr', { class: k === 'me' ? 'me' : '' },
        h('td', { text: playerLabel(k) }),
        h('td', {}, h('strong', { text: fmtPct(a.all.made, a.all.att) })),
        zoneIds.map((z) => {
          const v = pct(a.byZone[z].made, a.byZone[z].att);
          return h('td', { class: v !== null && v === leader[z] && rows.length > 1 ? 'lead' : '', text: v === null ? '–' : `${v}%${v === leader[z] && rows.length > 1 ? ' ★' : ''}` });
        }))))),
    h('p', { class: 'muted small', text: '★ = best in the group for that zone.' }));
}

function sessionsCard(sessions, isMe) {
  return h('div', { class: 'card' }, h('h3', { text: 'Sessions' }),
    h('ul', { class: 'sessions' }, sessions.slice().reverse().map((s) => {
      const t = sessionTotals(s, isFT(s) ? 'ft' : 'all');
      return h('li', { class: s.id === ui.range ? 'current' : '' },
        h('button', { class: 'session-row', onclick: () => sessionSheet(s, isMe) },
          h('span', { class: 'session-when' },
            h('strong', { text: shortDate(s.startedAt) }),
            h('span', { class: 'muted small', text: [s.name, typeText(s), s.location ? `📍 ${s.location}` : null, durationLabel(s), s.note ? '📝' : null].filter(Boolean).join(' · ') })),
          h('span', { class: 'session-score', text: `${t.made}/${t.att} · ${fmtPct(t.made, t.att)}` })));
    })));
}

// Shot type for shooting sessions, finish for layups.
const typeText = (s) => (s.shotType ? shotTypeLabel(s.shotType) : isLayup(s) ? finishLabel(s.finish) : null);

function sessionSheet(s, isMe) {
  const ft = isFT(s);
  const layup = isLayup(s);
  const t = sessionTotals(s, ft ? 'ft' : 'all');
  const a = ft || layup ? null : aggregate([s]);
  const la = layup ? layupAggregate([s]) : null;
  openSheet((close) => {
    const note = isMe ? h('textarea', { class: 'textarea', maxlength: 500, rows: 3, placeholder: 'Add a note…' }) : null;
    if (note) note.value = s.note || '';
    const loc = isMe ? locationInput(s.location || '', store.recentLocations()) : null;
    // Save any note / location changes before leaving the sheet. Returns true if something changed.
    saveEdits = () => {
      let changed = false;
      if (note && note.value.trim() !== (s.note || '')) { store.setSessionNote(s.id, note.value.trim()); changed = true; }
      if (loc && store.cleanLocation(loc.input.value) !== (s.location || '')) { store.setSessionLocation(s.id, loc.input.value); changed = true; }
      return changed;
    };
    return [
      h('h2', { text: shortDate(s.startedAt) }),
      h('p', { class: 'muted', text: [s.name, typeText(s), durationLabel(s)].filter(Boolean).join(' · ') }),
      !isMe && s.location ? h('p', { class: 'muted', text: `📍 ${s.location}` }) : null,
      loc ? h('label', { class: 'field-label', for: loc.input.id, text: 'Location' }) : null, ...(loc ? loc.els : []),
      h('p', { class: 'big-line', text: `${t.made}/${t.att} · ${fmtPct(t.made, t.att)}` }),
      ft ? h('p', { class: 'muted', text: `Longest streak: ${longestRun(s.shots.ft || [])} in a row` })
        : layup ? h('p', { class: 'muted small', text: [...LAYUP_SIDES.map(([id, label]) => [label, la.bySide[id]]), ['Left hand', la.byHand.left], ['Right hand', la.byHand.right]]
          .filter(([, v]) => v.att).map(([label, v]) => `${label} ${v.made}/${v.att}`).join(' · ') })
        : h('p', { class: 'muted small', text: Object.entries(ZONES).map(([id, z]) => `${z.label} ${fmtPct(a.byZone[id].made, a.byZone[id].att)}`).join(' · ') }),
      isMe ? note : s.note ? h('p', { class: 'session-note', text: `“${s.note}”` }) : null,
      h('div', { class: 'sheet-actions' },
        isMe ? h('button', { class: 'btn-ghost danger', onclick: () => {
          if (!confirm(`Delete the session from ${dateLabel(s.startedAt)}? This cannot be undone.`)) return;
          store.deleteSession(s.id); if (ui.range === s.id) ui.range = 'last5'; close(); render();
        } }, 'Delete') : null,
        isMe ? h('button', { class: 'btn-secondary', onclick: () => {
          saveEdits();
          close(); startEditing(s);
        } }, layup ? 'Edit layups' : 'Edit shots & misses') : null,
        isShooting(s) ? h('button', { class: 'btn-secondary', onclick: () => {
          saveEdits();
          ui.range = s.id; ui.inspect = null; ui.shotType = 'all'; ui.location = 'all'; close(); render(); window.scrollTo(0, 0);
        } }, 'Show on court') : null,
        h('button', { class: 'btn-primary', onclick: () => {
          if (saveEdits()) { toast('Saved.'); render(); }
          close();
        } }, isMe ? 'Done' : 'Close')),
    ];
  });
}
let saveEdits = () => false; // set by sessionSheet's builder
