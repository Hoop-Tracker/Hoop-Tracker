// Progress → Shooting: the detailed shooting page. Spot-by-spot trends (sparklines),
// zone trends, and breakdowns by location and by shot type.
import { h } from '../dom.js';
import { POSITIONS, ZONES } from '../court.js';
import { shotTypeLabel } from '../store.js';
import { aggregate, sessionTotals, sessionsInRange, delta, pct, fmtPct } from '../stats.js';
import { sparkline, trendChart } from '../chart.js';
import { render } from '../ui.js';

const SPARK_N = 10; // sessions shown in each sparkline
let openSpot = null; // spot whose full trend chart is expanded

// Per-session % for one area ('pos:<id>' or a zone id), last SPARK_N sessions that had shots there.
function series(sessions, area) {
  const out = [];
  for (let i = sessions.length - 1; i >= 0 && out.length < SPARK_N; i--) {
    const t = sessionTotals(sessions[i], area);
    if (t.att) out.unshift(pct(t.made, t.att));
  }
  return out;
}

const deltaText = (d) => (d === null ? null
  : h('span', { class: `delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`, text: `${d > 0 ? '▲' : d < 0 ? '▼' : '•'}${Math.abs(d)}` }));

// opts: { shooting, agg, prevAgg, prev, rangeTitle, rangeShort, rangeId, byLocPool, byTypePool, locations, who,
//         cmp: { name, shooting, agg } | null }   (cmp = the teammate being compared with)
export function shootingCards(o) {
  return [
    o.cmp ? compareKey(o) : null,
    zoneTrendCard(o),
    spotCard(o),
    locationCard(o),
    typeCard(o),
  ];
}

// Colour key for the two sparkline series (colour is never the only cue: tiles also name both players).
function compareKey({ who, cmp }) {
  return h('div', { class: 'legend compare-key' }, h('span', { class: 'key s1' }), who, h('span', { class: 'key s2' }), cmp.name);
}

function zoneTrendCard({ shooting, agg, rangeTitle, who, cmp }) {
  return h('div', { class: 'card' },
    h('h3', { text: 'Zone trends' }),
    h('p', { class: 'muted small', text: `% = ${rangeTitle} · line = last ${SPARK_N} sessions · dashed = 50%` }),
    h('div', { class: 'zone-grid' }, Object.entries(ZONES).map(([id, z]) => {
      const r = agg.byZone[id];
      const c = cmp?.agg.byZone[id];
      return h('div', { class: 'zone-tile' },
        h('div', { class: 'zone-tile-head' }, h('span', { class: 'muted small', text: z.label }), h('strong', { text: fmtPct(r.made, r.att) })),
        c ? h('div', { class: 'zone-tile-cmp muted small' }, `${cmp.name} ${fmtPct(c.made, c.att)} `, deltaText(delta(r, c))) : null,
        sparkline(series(shooting, id), `${who}, ${z.label}`, cmp ? series(cmp.shooting, id) : null));
    })));
}

function spotCard({ shooting, agg, prevAgg, prev, rangeTitle, rangeShort, who, cmp }) {
  const all = aggregate(shooting);
  const groups = Object.entries(ZONES).map(([zid, z]) => {
    const rows = POSITIONS.filter((p) => p.zone === zid).map((p) => {
      const r = agg.byPos[p.id], life = all.byPos[p.id];
      const c = cmp?.agg.byPos[p.id];
      // Compare mode: ▲▼ = you vs teammate. Otherwise ▲▼ = change vs the previous period.
      const d = c ? delta(r, c) : prevAgg ? delta(r, prevAgg.byPos[p.id]) : null;
      const open = openSpot === p.id;
      const row = h('button', { class: 'spot-row', 'aria-expanded': String(open), onclick: () => { openSpot = open ? null : p.id; render(); } },
        h('span', { class: 'spot-name' }, h('strong', { text: p.short }), h('span', { class: 'muted small', text: p.name })),
        sparkline(series(shooting, `pos:${p.id}`), `${who}, ${p.name}`, cmp ? series(cmp.shooting, `pos:${p.id}`) : null),
        h('span', { class: 'spot-pct' }, h('strong', { text: fmtPct(r.made, r.att) }), ' ', deltaText(d)),
        h('span', { class: 'spot-life muted small', text: c ? fmtPct(c.made, c.att) : fmtPct(life.made, life.att) }));
      return h('li', {}, row, open ? h('div', { class: 'spot-detail' },
        h('p', { class: 'muted small', text: c
          ? `${p.name}, ${rangeTitle}: ${who} ${r.made}/${r.att} · ${cmp.name} ${c.made}/${c.att}`
          : `${p.name}: ${r.made}/${r.att} (${rangeTitle}) · ${life.made}/${life.att} (all time)` }),
        trendChart([{ label: who, sessions: shooting, cls: 's1' }, ...(cmp ? [{ label: cmp.name, sessions: cmp.shooting, cls: 's2' }] : [])], `pos:${p.id}`)) : null);
    });
    return [h('li', { class: 'spot-group', text: z.label }), ...rows];
  });
  return h('div', { class: 'card' },
    h('h3', { text: 'Spot by spot' }),
    h('div', { class: 'spot-head muted small' }, h('span', { text: 'Spot' }), h('span', { text: `Last ${SPARK_N}` }),
      h('span', { text: cmp ? who : rangeShort }), h('span', { text: cmp ? cmp.name.slice(0, 6) : 'All' })),
    h('ul', { class: 'spot-list' }, groups.flat()),
    h('p', { class: 'muted small', text: cmp
      ? `${rangeTitle}. ▲▼ = ${who} vs ${cmp.name} in percentage points. Tap a spot for both trends.`
      : `Tap a spot for its full trend.${prev ? ` ▲▼ = change vs ${prev.label}.` : ''}` }));
}

// Zones × columns table; the best % in each row is starred.
function breakdownTable(cols) {
  const rows = [['all', 'All'], ...Object.entries(ZONES).map(([id, z]) => [id, z.label])];
  return h('table', { class: 'zones breakdown' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Zone' }), cols.map((c) => h('th', { title: c.label, text: c.label })))),
    h('tbody', {},
      rows.map(([id, label]) => {
        const vals = cols.map((c) => (id === 'all' ? c.agg.all : c.agg.byZone[id]));
        const best = Math.max(...vals.map((v) => pct(v.made, v.att) ?? -1));
        const contested = vals.filter((v) => v.att).length > 1;
        return h('tr', {}, h('td', { text: label }), vals.map((v) => {
          const p = pct(v.made, v.att);
          const top = contested && p !== null && p === best;
          return h('td', { class: top ? 'lead' : '', text: p === null ? '–' : `${p}%${top ? ' ★' : ''}` });
        }));
      }),
      h('tr', { class: 'muted' }, h('td', { text: 'Shots' }), cols.map((c) => h('td', { text: String(c.agg.all.att) })))));
}

function locationCard({ byLocPool, rangeId, rangeTitle, locations, who, cmp }) {
  if (locations.size < 2) {
    return h('div', { class: 'card' }, h('h3', { text: 'By location' }),
      h('p', { class: 'muted small', text: 'Add a location when you finish sessions at two or more places to compare how you shoot at each.' }));
  }
  const cols = [...locations].map(([key, label]) => {
    const list = byLocPool.filter((s) => (s.location || '').toLowerCase() === key);
    return { label, agg: aggregate(sessionsInRange(list, rangeId)) };
  }).filter((c) => c.agg.all.att).sort((a, b) => b.agg.all.att - a.agg.all.att).slice(0, 3);
  return h('div', { class: 'card' }, h('h3', { text: 'By location' }),
    cols.length > 1 ? breakdownTable(cols) : h('p', { class: 'muted small', text: 'Only one location has shots in this range.' }),
    h('p', { class: 'muted small', text: `${cmp ? `${who} only. ` : ''}${rangeTitle} at each place (up to 3 busiest). Ignores the location filter. ★ = best.` }));
}

const SHORT_TYPE = { none: 'Any', standing: 'Standing', catch: 'Catch', dribble: 'Dribble', pullup: 'Pull-up', stepback: 'Step-back', fade: 'Fade', finish: 'Finish', other: 'Other' };
function typeCard({ byTypePool, rangeId, rangeTitle, who, cmp }) {
  const types = [...new Set(byTypePool.map((s) => s.shotType || 'none'))];
  if (types.length < 2) return null;
  const cols = types.map((t) => ({
    label: SHORT_TYPE[t] || shotTypeLabel(t),
    agg: aggregate(sessionsInRange(byTypePool.filter((s) => (s.shotType || 'none') === t), rangeId)),
  })).filter((c) => c.agg.all.att).sort((a, b) => b.agg.all.att - a.agg.all.att).slice(0, 3);
  if (cols.length < 2) return null;
  return h('div', { class: 'card' }, h('h3', { text: 'By shot type' }),
    breakdownTable(cols),
    h('p', { class: 'muted small', text: `${cmp ? `${who} only. ` : ''}${rangeTitle} for each shot type (up to 3 most used). Ignores the shot-type filter. ★ = best.` }));
}
