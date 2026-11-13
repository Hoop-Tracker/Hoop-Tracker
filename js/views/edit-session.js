// Correct the shots of a finished session: flip make/miss, add or remove shots.
import { h, svg } from '../dom.js';
import { drawCourt, positionById, planSpots, zoneLabel, layupSideLabels } from '../court.js';
import * as store from '../store.js';
import { sessionTotals, fmtPct, shortDate } from '../stats.js';
import { ui, render, toast } from '../ui.js';

let draft = null; // { id, shots }
let focus = null;

export function startEditing(session) {
  draft = { id: session.id, shots: JSON.parse(JSON.stringify(session.shots)), misses: JSON.parse(JSON.stringify(session.misses || {})) };
  focus = planSpots(session.plan).find((p) => session.shots[p.id]?.length)?.id || planSpots(session.plan)[0].id;
  ui.editingSession = session.id;
  render();
  window.scrollTo(0, 0);
}

function stop() { ui.editingSession = null; draft = null; render(); }

export function editSessionView() {
  const session = store.getSessions().find((s) => s.id === ui.editingSession);
  if (!session || !draft || draft.id !== session.id) { ui.editingSession = null; draft = null; return h('div'); }
  const spots = planSpots(session.plan);
  const isFT = session.kind === 'freethrow';
  const isLayup = session.kind === 'layup';
  const t = sessionTotals({ shots: draft.shots }, isFT ? 'ft' : 'all');
  const original = sessionTotals(session, isFT ? 'ft' : 'all');
  // Keep miss directions lined up with the shots (drop extras, and directions on makes).
  for (const pos of Object.keys(draft.misses)) {
    const shots = draft.shots[pos] || [];
    const arr = draft.misses[pos].slice(0, shots.length).map((d, i) => (shots[i] === false ? d : null));
    if (arr.some(Boolean)) draft.misses[pos] = arr; else delete draft.misses[pos];
  }
  const changed = JSON.stringify(draft.shots) !== JSON.stringify(session.shots) || JSON.stringify(draft.misses) !== JSON.stringify(session.misses || {});

  const court = svg('svg', { 'aria-label': 'Tap a spot to edit its shots' });
  const g = drawCourt(court);
  if (isLayup) layupSideLabels(g, spots);
  for (const p of spots) {
    const list = draft.shots[p.id] || [];
    const made = list.filter(Boolean).length;
    const label = list.length ? `${made}/${list.length}` : p.short;
    const el = svg('g', { class: `spot ${list.length ? 'state-done' : 'state-empty'}${focus === p.id ? ' selected' : ''}`, transform: `translate(${p.x} ${p.y})`,
      role: 'button', tabindex: 0, 'aria-label': `${p.name}: ${made} of ${list.length}` },
      svg('circle', { r: 34, class: 'hit' }), svg('circle', { r: 23, class: 'ring' }),
      svg('text', { class: `spot-label${label.length > 5 ? ' tiny' : label.length > 3 ? ' small' : ''}`, text: label }));
    const pick = () => { focus = p.id; render(); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    g.append(el);
  }

  const p = positionById(focus);
  const list = draft.shots[p.id] || [];
  const cap = session.plan[p.id];
  const setList = (next) => { if (next.length) draft.shots[p.id] = next; else delete draft.shots[p.id]; render(); };

  const shotButtons = h('div', { class: 'edit-shots' },
    list.length ? list.map((v, i) => h('button', {
      class: `pip-btn ${v ? 'make' : 'miss'}`, 'aria-label': `Shot ${i + 1}: ${v ? 'make' : 'miss'}. Tap to change.`,
      onclick: () => { const next = list.slice(); next[i] = !v; setList(next); },
    }, h('span', { class: 'pip-num', text: String(i + 1) }), v ? '✓' : '✗'))
      : h('p', { class: 'muted small', text: 'No shots recorded here.' }));

  // Miss directions (optional) for each miss at this spot.
  const dirs = draft.misses[p.id] || [];
  const setDir = (i, d) => {
    const arr = (draft.misses[p.id] ||= []);
    while (arr.length < list.length) arr.push(null);
    arr[i] = arr[i] === d ? null : d;
    render();
  };
  const missRows = isLayup ? [] : list.map((v, i) => (v ? null : h('div', { class: 'dir-edit' },
    h('span', { class: 'small', text: `Shot ${i + 1}` }),
    h('div', { class: 'dir-buttons' }, [['short', 'Short'], ['long', 'Long'], ['left', '←'], ['right', '→']].map(([d, label]) =>
      h('button', { class: 'chip', 'aria-pressed': String(dirs[i] === d), 'aria-label': `Shot ${i + 1} missed ${d}`, onclick: () => setDir(i, d) }, label))))))
    .filter(Boolean);

  return h('section', { class: 'view edit-session' },
    h('div', { class: 'row-between' },
      h('button', { class: 'btn-link', onclick: () => { if (!changed || confirm('Discard your changes?')) stop(); } }, '‹ Cancel'),
      h('h2', { text: isLayup ? 'Edit layups' : 'Edit shots' }),
      h('span', {})),
    h('p', { class: 'muted center', text: `${session.name} · ${shortDate(session.startedAt)}` }),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-value', text: fmtPct(t.made, t.att) }), h('div', { class: 'tile-label', text: `was ${fmtPct(original.made, original.att)}` })),
      h('div', { class: 'tile' }, h('div', { class: 'tile-value', text: `${t.made}/${t.att}` }), h('div', { class: 'tile-label', text: `was ${original.made}/${original.att}` }))),
    isFT ? null : h('div', { class: 'court-wrap' }, court),
    h('div', { class: 'panel' },
      h('div', {}, h('h2', { text: p.name }), h('div', { class: 'muted small', text: `${zoneLabel(p)} · ${list.length} of ${cap} ${isLayup ? 'layups' : 'shots'}` })),
      h('p', { class: 'muted small', text: 'Tap a shot to switch it between make and miss.' }),
      shotButtons,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn-secondary', disabled: list.length >= cap, onclick: () => setList([...list, true]) }, '+ Make'),
        h('button', { class: 'btn-secondary', disabled: list.length >= cap, onclick: () => setList([...list, false]) }, '+ Miss'),
        h('button', { class: 'btn-ghost danger', disabled: !list.length, onclick: () => setList(list.slice(0, -1)) }, 'Remove last')),
      missRows.length ? h('div', { class: 'stack' }, h('div', { class: 'field-label', text: 'Which way did the misses go? (optional)' }), ...missRows) : null),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn-ghost', disabled: !changed, onclick: () => { draft.shots = JSON.parse(JSON.stringify(session.shots)); draft.misses = JSON.parse(JSON.stringify(session.misses || {})); render(); } }, 'Reset'),
      h('button', { class: 'btn-primary', disabled: !changed, onclick: () => {
        if (!t.att) { toast('Every shot is removed. Delete the session instead (Progress → session → Delete).', 4000); return; }
        if (!store.updateSessionShots(session.id, draft.shots, draft.misses)) { toast('Could not save those changes.'); return; }
        toast('Session updated.');
        ui.range = session.kind === 'shooting' ? session.id : ui.range;
        stop();
      } }, 'Save changes')),
  );
}
