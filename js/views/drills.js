import { h, svg } from '../dom.js';
import { POSITIONS, ZONES, LAYUP_SPOTS, LAYUP_SIDES, drawCourt, positionById, layupSideLabels } from '../court.js';
import * as store from '../store.js';
import { SHOT_TYPES, shotTypeLabel, LAYUP_FINISHES, finishLabel } from '../store.js';
import { getSettings } from '../settings.js';
import { getFriends } from '../sync.js';
import { diagramSvg, diagramEditor } from '../diagram.js';
import { ui, render, setTab, toast, stepper } from '../ui.js';

// Working copy of the drill being edited (survives re-renders).
let draft = null;
let focus = null;
const view = { tab: 'mine', player: 'all' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const isLayupDrill = (d) => d.kind === 'layup';
const spotsFor = (kind) => (kind === 'layup' ? LAYUP_SPOTS : POSITIONS);
// One-line summary, e.g. "4 spots · 20 shots · Pull-up" or "2 spots · 10 layups · Reverse".
export function drillSummary(d) {
  const total = Object.values(d.plan).reduce((a, b) => a + b, 0);
  const n = Object.keys(d.plan).length;
  return isLayupDrill(d)
    ? `Layups · ${n} spot${n === 1 ? '' : 's'} · ${total} layups · ${finishLabel(d.finish)}`
    : `${n} spots · ${total} shots · ${d.shotType ? shotTypeLabel(d.shotType) : 'Any shot type'}`;
}
// Session options for starting a drill (used here and on the Practice tab).
export function drillSession(d, name, drillFrom = null) {
  return isLayupDrill(d)
    ? { kind: 'layup', name, drillId: d.id, drillFrom, finish: d.finish, plan: d.plan }
    : { kind: 'shooting', name, drillId: d.id, drillFrom, shotType: d.shotType, plan: d.plan };
}

export function drillsView() {
  if (ui.editingDrill) return editor();
  const friends = getFriends();
  const names = Object.keys(friends).sort();
  if (view.player !== 'all' && !friends[view.player]) view.player = 'all';

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Drill lists' },
    [['mine', 'Mine'], ['team', 'Team'], ['fav', '★ Favourites']].map(([id, label]) =>
      h('button', { role: 'tab', 'aria-checked': String(view.tab === id), 'aria-selected': String(view.tab === id), onclick: () => { view.tab = id; render(); } }, label)));

  let items = [], empty = '', extra = null;
  if (view.tab === 'mine') {
    items = store.getDrills().map((d) => ({ d, owner: 'me' }));
    empty = 'A drill is a custom session: choose the spots, how many shots at each, a shot type, a description and an optional diagram. Layup drills work the same way, with sides, hands and a finish.';
  } else if (view.tab === 'team') {
    if (names.length) {
      const sel = h('select', { class: 'select compact', 'aria-label': 'Whose drills' },
        h('option', { value: 'all', text: 'Everyone' }), names.map((n) => h('option', { value: n, text: cap(n), selected: view.player === n })));
      sel.addEventListener('change', () => { view.player = sel.value; render(); });
      extra = sel;
    }
    items = names.filter((n) => view.player === 'all' || n === view.player)
      .flatMap((n) => (friends[n].drills || []).map((d) => ({ d, owner: n })));
    empty = names.length ? 'No team drills yet.' : 'Set up sync (Settings → Sync & friends) to see your teammates’ drills.';
  } else {
    const favs = store.getFavourites();
    for (const key of favs) {
      const [owner, id] = key.split(':');
      const d = owner === '~' ? store.getDrill(id) : friends[owner]?.drills?.find((x) => x.id === id);
      if (d) items.push({ d, owner: owner === '~' ? 'me' : owner });
    }
    empty = 'Tap ☆ on any drill to add it here.';
  }

  return h('section', { class: 'view drills' },
    tabs,
    h('div', { class: 'row-between' }, extra || h('span'),
      h('button', { class: 'btn-primary', onclick: () => openEditor('new') }, '+ New drill')),
    items.length ? null : h('div', { class: 'panel empty-state' }, h('p', { class: 'muted', text: empty })),
    ...items.map(({ d, owner }) => drillCard(d, owner)),
  );
}

function drillCard(d, owner) {
  const mine = owner === 'me';
  const done = store.getSessions().filter((s) => s.drillId === d.id).length;
  const key = store.favKey(owner, d.id);
  const fav = store.getFavourites().includes(key);
  const busy = !!store.getActive();
  const start = () => {
    const name = mine ? d.name : `${d.name} (${cap(owner)}'s)`.slice(0, 40);
    store.startSession(drillSession(d, name, mine ? null : owner));
    ui.selected = null;
    setTab('practice');
  };
  return h('div', { class: 'card drill-card' },
    h('div', { class: 'row-between drill-head' },
      h('div', {}, h('h3', { text: d.name }), mine ? null : h('span', { class: 'by', text: `by ${cap(owner)}` })),
      h('button', { class: `fav-btn${fav ? ' on' : ''}`, 'aria-pressed': String(fav), 'aria-label': fav ? 'Remove from favourites' : 'Add to favourites',
        onclick: () => { store.toggleFavourite(key); render(); } }, fav ? '★' : '☆')),
    h('p', { class: 'muted small', text: `${drillSummary(d)} · ${done ? `done ${done}×` : 'not tried yet'}` }),
    d.description ? h('p', { class: 'drill-desc', text: d.description }) : null,
    h('div', { class: 'drill-visual' }, d.drawing?.length ? diagramSvg(d.drawing, d.plan, { label: `${d.name} diagram` }) : miniCourt(d.plan, d.kind)),
    h('div', { class: 'card-actions' },
      mine ? h('button', { class: 'btn-ghost', onclick: () => openEditor(d.id) }, 'Edit')
        : h('button', { class: 'btn-ghost', onclick: () => {
          store.saveDrill({ id: null, name: d.name, kind: d.kind, shotType: d.shotType, finish: d.finish, plan: d.plan, description: d.description, drawing: JSON.parse(JSON.stringify(d.drawing || [])) });
          toast(`Saved a copy of “${d.name}” to your drills.`);
        } }, 'Save a copy'),
      h('button', { class: 'btn-primary', disabled: busy, onclick: start }, busy ? 'Session in progress' : 'Start')));
}

function openEditor(id) {
  const d = id === 'new' ? null : store.getDrill(id);
  draft = d ? { id: d.id, name: d.name, kind: d.kind || 'shooting', shotType: d.shotType, finish: d.finish || null, plan: { ...d.plan }, description: d.description || '', drawing: JSON.parse(JSON.stringify(d.drawing || [])) }
    : { id: null, name: '', kind: 'shooting', shotType: 'dribble', finish: 'regular', plan: {}, description: '', drawing: [] };
  focus = null;
  ui.editingDrill = id;
  render();
  window.scrollTo(0, 0);
}

function closeEditor() { ui.editingDrill = null; draft = null; render(); }

function miniCourt(plan, kind) {
  const court = svg('svg', { class: 'mini', 'aria-hidden': 'true' });
  const g = drawCourt(court);
  if (kind === 'layup') layupSideLabels(g, LAYUP_SPOTS.filter((p) => plan[p.id]));
  for (const p of spotsFor(kind)) {
    const on = !!plan[p.id];
    g.append(svg('g', { class: `spot ${on ? 'state-done' : 'state-off'}`, transform: `translate(${p.x} ${p.y})` },
      svg('circle', { r: 23, class: 'ring' }), on ? svg('text', { class: 'spot-label', text: String(plan[p.id]) }) : null));
  }
  return h('div', { class: 'mini-court' }, court);
}

function editor() {
  const layup = draft.kind === 'layup';
  const unit = layup ? 'layups' : 'shots';
  const def = layup ? getSettings().layupShots : getSettings().defaultShots;
  const spots = spotsFor(draft.kind);
  const name = h('input', { class: 'input', type: 'text', maxlength: 40, placeholder: layup ? 'Drill name, e.g. Weak-hand finishes' : 'Drill name, e.g. Pull-up wings', value: draft.name });
  name.addEventListener('input', () => { draft.name = name.value; });

  // Shooting drill or layup drill. Switching clears the chosen spots (they're different spots).
  const kindToggle = h('div', { class: 'segmented two', role: 'radiogroup', 'aria-label': 'Drill type' },
    [['shooting', 'Shooting'], ['layup', 'Layups']].map(([id, label]) =>
      h('button', { role: 'radio', 'aria-checked': String(draft.kind === id), onclick: () => {
        if (draft.kind === id) return;
        if (Object.keys(draft.plan).length && !confirm('Switching the drill type clears the spots you picked. Continue?')) return;
        draft.kind = id; draft.plan = {}; focus = null; render();
      } }, label)));

  const type = layup
    ? h('select', { class: 'select', 'aria-label': 'Finish' },
      h('option', { value: '', text: 'Mixed finishes', selected: !draft.finish }),
      LAYUP_FINISHES.map((t) => h('option', { value: t.id, text: t.label, selected: draft.finish === t.id })))
    : h('select', { class: 'select', 'aria-label': 'Shot type' },
      h('option', { value: '', text: 'Any shot type' }),
      SHOT_TYPES.map((t) => h('option', { value: t.id, text: t.label, selected: draft.shotType === t.id })));
  type.addEventListener('change', () => { if (layup) draft.finish = type.value || null; else draft.shotType = type.value || null; });
  const desc = h('textarea', { class: 'textarea', maxlength: 500, rows: 3,
    placeholder: layup ? 'What to do, e.g. “Two-foot jump stop, reverse on the left side, weak hand only.”' : 'What to do, e.g. “Jab step, one dribble left, pull-up. Reset at the arc.”' });
  desc.value = draft.description;
  desc.addEventListener('input', () => { draft.description = desc.value; });

  const court = svg('svg', { 'aria-label': 'Tap spots to add them to the drill' });
  const g = drawCourt(court);
  if (layup) layupSideLabels(g, LAYUP_SPOTS);
  for (const p of spots) {
    const n = draft.plan[p.id] || 0;
    const el = svg('g', { class: `spot ${n ? 'state-done' : 'state-off'}${focus === p.id ? ' selected' : ''}`, transform: `translate(${p.x} ${p.y})`,
      role: 'button', tabindex: 0, 'aria-label': `${p.name}: ${n ? `${n} ${unit}` : 'not included'}` },
      svg('circle', { r: 34, class: 'hit' }), svg('circle', { r: 23, class: 'ring' }),
      svg('text', { class: 'spot-label', text: n ? String(n) : layup ? p.short : '+' }));
    const tap = () => {
      if (!n) { draft.plan[p.id] = def; focus = p.id; }
      else if (focus === p.id) { delete draft.plan[p.id]; focus = null; }
      else focus = p.id;
      render();
    };
    el.addEventListener('click', tap);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    g.append(el);
  }

  const chosen = Object.keys(draft.plan);
  const total = Object.values(draft.plan).reduce((a, b) => a + b, 0);
  const zoneChip = (zone, label) => {
    const ids = spots.filter((p) => zone === 'all' || p.zone === zone || p.side === zone || `hand-${p.hand}` === zone).map((p) => p.id);
    const allOn = ids.every((id) => draft.plan[id]);
    return h('button', { class: 'chip', 'aria-pressed': String(allOn), onclick: () => {
      for (const id of ids) { if (allOn) delete draft.plan[id]; else draft.plan[id] ||= def; }
      focus = null; render();
    } }, label);
  };

  let focusPanel;
  if (focus && draft.plan[focus]) {
    const p = positionById(focus);
    focusPanel = h('div', { class: 'focus-panel' },
      h('strong', { text: p.name }),
      stepper(draft.plan[focus], { min: 1, max: 50, label: `${unit} at ${p.name}`, onChange: (v) => { draft.plan[focus] = v; render(); } }),
      h('button', { class: 'btn-link danger', onclick: () => { delete draft.plan[focus]; focus = null; render(); } }, 'Remove'));
  } else {
    focusPanel = h('p', { class: 'muted small center', text: `Tap a spot to add it, tap again to remove it. Tap an added spot once to change how many ${unit}.${layup ? ' LH / RH = which hand finishes.' : ''}` });
  }

  let setAllValue = def;
  const setAll = h('div', { class: 'row-between' },
    h('span', { class: 'muted small', text: 'Set every chosen spot to' }),
    h('div', { class: 'row' },
      stepper(def, { min: 1, max: 50, label: `${unit} for all spots`, onChange: (v) => { setAllValue = v; } }),
      h('button', { class: 'btn-secondary', disabled: !chosen.length, onclick: () => { for (const id of chosen) draft.plan[id] = setAllValue; render(); } }, 'Apply')));

  const save = () => {
    if (!chosen.length) { toast('Add at least one spot.'); return; }
    if (!draft.name.trim()) { toast('Give the drill a name.'); name.focus(); return; }
    store.saveDrill(draft);
    toast('Drill saved.');
    closeEditor();
  };

  return h('section', { class: 'view drill-editor' },
    h('div', { class: 'row-between' },
      h('button', { class: 'btn-link', onclick: closeEditor }, '‹ Back'),
      h('h2', { text: draft.id ? 'Edit drill' : 'New drill' }),
      h('span', {})),
    h('div', { class: 'card stack' }, kindToggle, h('label', { class: 'field-label', text: 'Name' }), name,
      h('label', { class: 'field-label', text: layup ? 'Finish' : 'Shot type' }), type,
      h('label', { class: 'field-label', text: 'Description (optional)' }), desc),
    h('div', { class: 'card' },
      h('div', { class: 'chips' }, layup
        ? [zoneChip('all', 'All'), ...LAYUP_SIDES.map(([id, label]) => zoneChip(id, label)), zoneChip('hand-left', 'Left hand'), zoneChip('hand-right', 'Right hand')]
        : [zoneChip('all', 'All spots'), ...Object.entries(ZONES).map(([z, v]) => zoneChip(z, v.label))]),
      h('div', { class: 'court-wrap' }, court),
      focusPanel,
      h('p', { class: 'center summary-line', text: `${chosen.length} spot${chosen.length === 1 ? '' : 's'} · ${total} ${unit}` })),
    h('div', { class: 'card stack' }, setAll),
    h('div', { class: 'card' }, h('h3', { text: 'Diagram (optional)' }),
      h('p', { class: 'muted small', text: 'Draw the movement: arrows for cuts and passes, dashed arrows for dribbles, circles or X marks for cones and defenders.' }),
      diagramEditor(draft.drawing, draft.plan, () => {})),
    h('div', { class: 'card-actions' },
      draft.id ? h('button', { class: 'btn-ghost danger', onclick: () => {
        if (!confirm(`Delete the drill “${draft.name}”? Past sessions are kept.`)) return;
        store.deleteDrill(draft.id); toast('Drill deleted.'); closeEditor();
      } }, 'Delete') : h('span', {}),
      h('button', { class: 'btn-primary', onclick: save }, 'Save drill')),
  );
}
