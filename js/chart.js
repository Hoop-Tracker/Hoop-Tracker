// Line chart of shooting % per session over time. One series normally; two when
// comparing with a friend (each with legend + direct label so colour is never alone).
import { svg, h } from './dom.js';
import { sessionTotals, pct, dateLabel } from './stats.js';

const W = 340, H = 200;
const PAD = { l: 34, r: 44, t: 12, b: 26 };

function points(sessions, zone) {
  return sessions
    .map((s) => ({ s, t: Date.parse(s.startedAt), ...sessionTotals(s, zone) }))
    .filter((p) => p.att > 0)
    .map((p) => ({ ...p, v: pct(p.made, p.att) }));
}

// series: [{ label, sessions, cls: 's1' | 's2' }]
export function trendChart(series, zone) {
  const sets = series.map((s) => ({ ...s, pts: points(s.sessions, zone) })).filter((s) => s.pts.length);
  const wrap = h('div', { class: 'chart' });
  if (!sets.length) {
    wrap.append(h('p', { class: 'muted empty', text: 'No shots recorded here yet.' }));
    return wrap;
  }
  const multi = sets.length > 1;
  const all = sets.flatMap((s) => s.pts);
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (t) => PAD.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const y = (v) => PAD.t + ih - (v / 100) * ih;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': sets.map((s) => `${s.label}: ${s.pts.length} sessions, latest ${s.pts.at(-1).v}%`).join('; ') });

  for (const v of [0, 25, 50, 75, 100]) {
    root.append(
      svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }),
      svg('text', { x: PAD.l - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end', text: `${v}%` }),
    );
  }
  const fmt = (t) => dateLabel(new Date(t).toISOString(), { day: 'numeric', month: 'short' });
  root.append(svg('text', { x: x(t0), y: H - 8, class: 'tick', 'text-anchor': t1 === t0 ? 'middle' : 'start', text: fmt(t0) }));
  if (t1 !== t0) root.append(svg('text', { x: x(t1), y: H - 8, class: 'tick', 'text-anchor': 'end', text: fmt(t1) }));

  for (const set of sets) {
    // Rolling 5-session average shows the underlying trend (single-series only, to stay readable).
    if (!multi && set.pts.length >= 3) {
      const avg = set.pts.map((_, i) => {
        const win = set.pts.slice(Math.max(0, i - 4), i + 1);
        return (win.reduce((a, p) => a + p.made, 0) / win.reduce((a, p) => a + p.att, 0)) * 100;
      });
      root.append(svg('path', { class: 'avg-line', d: avg.map((v, i) => `${i ? 'L' : 'M'}${x(set.pts[i].t)} ${y(v)}`).join(' ') }));
    }
    root.append(svg('path', { class: `series-line ${set.cls}`, d: set.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)} ${y(p.v)}`).join(' ') }));
    const r = set.pts.length > 40 ? 2.5 : 4;
    set.pts.forEach((p) => root.append(svg('circle', { cx: x(p.t), cy: y(p.v), r, class: `series-dot ${set.cls}` })));
  }
  // Direct labels at the line ends; nudge apart if they would collide.
  if (multi) {
    const ends = sets.map((s) => ({ s, yy: y(s.pts.at(-1).v) + 3.5 })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 12) ends[i].yy = ends[i - 1].yy + 12;
    for (const e of ends) root.append(svg('text', { x: W - PAD.r + 6, y: e.yy, class: 'end-label', text: e.s.label.slice(0, 7) }));
  }

  const cross = svg('line', { class: 'crosshair', y1: PAD.t, y2: PAD.t + ih, visibility: 'hidden' });
  const focus = svg('circle', { class: 'focus-dot', r: 6, visibility: 'hidden' });
  root.append(cross, focus);
  const tip = h('div', { class: 'tooltip', hidden: true });

  const show = (evt) => {
    const box = root.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const py = ((evt.clientY - box.top) / box.height) * H;
    let best = null, bd = Infinity;
    for (const set of sets) for (const p of set.pts) {
      const d = Math.abs(x(p.t) - px) * 3 + Math.abs(y(p.v) - py);
      if (d < bd) { bd = d; best = { p, set }; }
    }
    const { p, set } = best;
    cross.setAttribute('x1', x(p.t)); cross.setAttribute('x2', x(p.t)); cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', x(p.t)); focus.setAttribute('cy', y(p.v)); focus.setAttribute('visibility', 'visible');
    focus.setAttribute('class', `focus-dot ${set.cls}`);
    tip.replaceChildren(
      multi ? h('div', { class: 'tip-name', text: set.label }) : null,
      h('strong', { text: `${p.v}%` }), h('span', { text: ` ${p.made}/${p.att}` }),
      h('div', { class: 'muted', text: dateLabel(p.s.startedAt, { weekday: 'short', day: 'numeric', month: 'short' }) }),
    );
    tip.hidden = false;
    const left = (x(p.t) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 55), box.width - 55)}px`;
    tip.style.top = `${(y(p.v) / H) * box.height}px`;
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', hide);

  wrap.append(root, tip);
  const legend = h('div', { class: 'legend' });
  if (multi) for (const s of sets) legend.append(h('span', { class: `key ${s.cls}` }), s.label);
  else if (sets[0].pts.length >= 3) legend.append(h('span', { class: 'key s1' }), 'Each session', h('span', { class: 'key key-avg' }), '5-session average');
  if (legend.childNodes.length) wrap.append(legend);
  return wrap;
}
