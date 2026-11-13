// Drill diagrams: simple vector shapes drawn over the half court.
// Shapes are stored as { t: type, c: colour index, p: [x,y,…] (court units), s?: text }
// which keeps them tiny, easy to validate and quick to sync.
import { h, svg } from './dom.js';
import { POSITIONS, LAYUP_SPOTS, drawCourt } from './court.js';
import { SHAPE_TYPES } from './store.js';

const TOOLS = [
  { t: 'arrow', label: '➚ Arrow', hint: 'Drag to draw a pass or cut' },
  { t: 'dash', label: '⇢ Dribble', hint: 'Drag to draw a dribble path' },
  { t: 'line', label: '／ Line', hint: 'Drag to draw a line' },
  { t: 'circle', label: '◯ Circle', hint: 'Drag out from the centre' },
  { t: 'x', label: '✕ Mark', hint: 'Tap to place an X (cone or defender)' },
  { t: 'text', label: 'T Text', hint: 'Tap where the label goes' },
  { t: 'pen', label: '✎ Draw', hint: 'Draw freehand' },
];
export const COLOURS = ['Ink', 'Blue', 'Orange', 'Green'];
const MAX_SHAPES = 150;

function arrowHead(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), L = 22, w = 0.45;
  return `M${x2} ${y2} L${x2 - L * Math.cos(a - w)} ${y2 - L * Math.sin(a - w)} L${x2 - L * Math.cos(a + w)} ${y2 - L * Math.sin(a + w)} Z`;
}

function shapeEl(s) {
  const cls = `shape d-c${s.c}`;
  const p = s.p;
  switch (s.t) {
    case 'arrow':
    case 'dash': {
      const [x1, y1] = [p[0], p[1]], [x2, y2] = [p.at(-2), p.at(-1)];
      return svg('g', { class: `${cls}${s.t === 'dash' ? ' dashed' : ''}` },
        svg('line', { x1, y1, x2, y2 }), svg('path', { d: arrowHead(x1, y1, x2, y2), class: 'head' }));
    }
    case 'line': return svg('line', { class: cls, x1: p[0], y1: p[1], x2: p.at(-2), y2: p.at(-1) });
    case 'circle': return svg('circle', { class: cls, cx: p[0], cy: p[1], r: Math.max(6, Math.hypot(p.at(-2) - p[0], p.at(-1) - p[1])) });
    case 'x': return svg('path', { class: cls, d: `M${p[0] - 12} ${p[1] - 12} L${p[0] + 12} ${p[1] + 12} M${p[0] + 12} ${p[1] - 12} L${p[0] - 12} ${p[1] + 12}` });
    case 'text': return svg('text', { class: `${cls} label`, x: p[0], y: p[1], text: s.s });
    case 'pen': return svg('polyline', { class: cls, points: p.join(' ') });
    default: return null;
  }
}

// Court + optional faint plan spots + the drawing. Used for thumbnails and the editor.
export function diagramSvg(shapes, plan = null, { label = 'Drill diagram' } = {}) {
  const root = svg('svg', { class: 'diagram', 'aria-label': label });
  const spots = drawCourt(root);
  if (plan) {
    for (const p of [...POSITIONS, ...LAYUP_SPOTS]) {
      if (plan[p.id]) spots.append(svg('circle', { cx: p.x, cy: p.y, r: 14, class: 'plan-dot' }));
    }
  }
  const layer = svg('g', { class: 'drawing' });
  for (const s of shapes || []) { const el = shapeEl(s); if (el) layer.append(el); }
  root.append(layer);
  return root;
}

// Interactive editor. `shapes` is mutated in place; onChange() is called after each edit.
export function diagramEditor(shapes, plan, onChange) {
  let tool = 'arrow', colour = 0;
  const root = diagramSvg(shapes, plan, { label: 'Drill diagram. Draw with your finger.' });
  root.classList.add('editing');
  const layer = root.querySelector('.drawing');
  const preview = svg('g', { class: 'drawing preview' });
  root.append(preview);
  const hint = h('p', { class: 'muted small center' });

  const redraw = () => {
    layer.replaceChildren(...shapes.map(shapeEl).filter(Boolean));
    undoBtn.disabled = clearBtn.disabled = !shapes.length;
    hint.textContent = shapes.length >= MAX_SHAPES ? 'Diagram is full (150 shapes).' : TOOLS.find((x) => x.t === tool).hint;
  };
  const commit = (s) => { if (shapes.length < MAX_SHAPES && SHAPE_TYPES.includes(s.t)) { shapes.push(s); redraw(); onChange(); } };

  const toCourt = (e) => {
    const pt = root.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(root.getScreenCTM().inverse());
    return [Math.round(r.x), Math.round(r.y)];
  };

  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (shapes.length >= MAX_SHAPES) return;
    e.preventDefault();
    const [x, y] = toCourt(e);
    if (tool === 'x') { commit({ t: 'x', c: colour, p: [x, y] }); return; }
    if (tool === 'text') {
      const s = (prompt('Label text (up to 40 characters):') || '').trim().slice(0, 40);
      if (s) commit({ t: 'text', c: colour, p: [x, y], s });
      return;
    }
    drag = { t: tool, c: colour, p: [x, y, x, y] };
    try { root.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toCourt(e);
    if (drag.t === 'pen') {
      const [lx, ly] = [drag.p.at(-2), drag.p.at(-1)];
      if (Math.hypot(x - lx, y - ly) > 5 && drag.p.length < 398) drag.p.push(x, y);
    } else { drag.p[2] = x; drag.p[3] = y; }
    preview.replaceChildren(shapeEl(drag));
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    preview.replaceChildren();
    const len = Math.hypot(d.p.at(-2) - d.p[0], d.p.at(-1) - d.p[1]);
    if (d.t === 'pen' ? d.p.length >= 4 : len >= 8) commit(d);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  const toolChips = h('div', { class: 'chips small-chips' }, TOOLS.map((x) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(tool === x.t),
    onclick: (e) => { tool = x.t; toolChips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); redraw(); },
  }, x.label)));
  const colourChips = h('div', { class: 'row' }, COLOURS.map((name, i) => h('button', {
    class: `swatch-btn d-c${i}`, type: 'button', 'aria-label': `${name} colour`, 'aria-pressed': String(colour === i),
    onclick: (e) => { colour = i; colourChips.querySelectorAll('.swatch-btn').forEach((c) => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); },
  })));
  const undoBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: () => { shapes.pop(); redraw(); onChange(); } }, '↶ Undo');
  const clearBtn = h('button', { class: 'btn-ghost danger', type: 'button', onclick: () => { if (confirm('Clear the whole diagram?')) { shapes.length = 0; redraw(); onChange(); } } }, 'Clear');
  redraw();
  return h('div', { class: 'diagram-editor' }, toolChips,
    h('div', { class: 'row-between' }, colourChips, h('div', { class: 'row' }, undoBtn, clearBtn)),
    h('div', { class: 'court-wrap' }, root), hint);
}
