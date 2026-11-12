import { h, svg } from '../dom.js';
import { ZONES, FT_SPOT, drawCourt, positionById, planSpots } from '../court.js';
import * as store from '../store.js';
import { SHOT_TYPES, shotTypeLabel } from '../store.js';
import { sessionTotals, fmtPct, dateLabel, currentRun } from '../stats.js';
import { getSettings, updateSettings } from '../settings.js';
import { voiceSupported, parseUtterance, VoiceListener } from '../voice.js';
import { ui, render, setTab, toast, buzz, openSheet, stepper, onNextRender } from '../ui.js';
import { startEditing } from './edit-session.js';

let advanceTimer = null;
let standardShotType = 'standing'; // plain spot-to-spot shooting is the usual standard session
const rest = { until: 0 };          // rest timer between spots
let lastMiss = null;                // { pos, index } awaiting a direction (miss-direction mode)

// Move to the next spot after one is finished, starting the rest timer if it's on.
function spotDone(fromId) {
  const a = store.getActive();
  const next = a && nextOpenSpot(a, fromId);
  if (!next) return null;
  ui.selected = next;
  const secs = getSettings().restSecs;
  if (secs) rest.until = Date.now() + secs * 1000;
  return next;
}

// ---------- hands-free state (persists across re-renders) ----------
const voice = { on: false, state: 'stopped', heard: '', message: '' };
let listener = null;
function getListener() {
  listener ||= new VoiceListener({
    onFinal: handleSpeech,
    onInterim: (t) => { voice.heard = t; const el = document.querySelector('.voice-heard'); if (el) el.textContent = `“${t}”`; },
    onState: (s) => {
      voice.state = s;
      if (s === 'denied') { voice.on = false; voice.message = 'Microphone access was blocked. Allow it in your browser settings.'; render(); }
      const dot = document.querySelector('.voice-dot');
      if (dot) dot.dataset.state = s;
    },
  });
  return listener;
}
const say = (text) => { if (getSettings().speakBack && listener) listener.speak(text); };

function spotIntro(p, active) {
  const n = active.plan[p.id];
  return p.id === 'ft' ? `${n} free throws` : `${p.name}, ${n} shot${n === 1 ? '' : 's'}`;
}

function handleSpeech(text) {
  const active = store.getActive();
  if (!active || ui.tab !== 'practice') return;
  const p = positionById(ui.selected);
  const list = active.shots[p.id] || [];
  const r = parseUtterance(text, list.length, active.plan[p.id]);
  voice.heard = text;
  if (r.action === 'undo') {
    if (store.undoShot(p.id)) { voice.message = 'Undid the last shot.'; say('Undone'); }
    render(); return;
  }
  if (r.action === 'next') {
    const next = nextOpenSpot(active, p.id);
    if (next) { ui.selected = next; voice.message = `Moved to ${positionById(next).name}.`; say(spotIntro(positionById(next), active)); }
    render(); return;
  }
  if (r.error) { voice.message = r.error; say(r.error); render(); return; }
  if (active.pausedAt) { voice.message = 'Session is paused.'; say('Session is paused'); render(); return; }
  rest.until = 0;
  store.recordShots(p.id, r.shots, r.dirs);
  buzz(30);
  voice.message = `Recorded ${r.summary}.`;
  const nowList = store.getActive().shots[p.id];
  if (nowList.length >= active.plan[p.id]) {
    const next = spotDone(p.id);
    const secs = getSettings().restSecs;
    if (next) say(`${r.summary}. ${secs ? `Rest ${secs} seconds. ` : ''}Next: ${spotIntro(positionById(next), active)}.`);
    else say(`${r.summary}. All spots done. Tap finish to save.`);
  } else say(r.summary);
  render();
}

// ---------- view ----------
export function practiceView() {
  const active = store.getActive();
  onNextRender(() => { if (ui.tab !== 'practice' || !store.getActive()) { listener?.stop(); voice.on = false; } });
  if (!active) return startScreen();
  if (active.pausedAt) { listener?.stop(); voice.on = false; return pausedScreen(active); }

  const spots = planSpots(active.plan);
  if (!ui.selected || !active.plan[ui.selected]) ui.selected = nextOpenSpot(active, null) || spots[0].id;
  const isFT = active.kind === 'freethrow';
  const zone = isFT ? 'ft' : 'all';
  const totals = sessionTotals(active, zone);
  const doneSpots = spots.filter((p) => (active.shots[p.id]?.length || 0) >= active.plan[p.id]).length;
  const run = currentRun(Object.values(active.shots).flat());

  const clock = h('span', { class: 'muted' });
  const tick = () => { clock.textContent = `${Math.floor((Date.now() - Date.parse(active.startedAt) - (active.pausedMs || 0)) / 60000)} min`; };
  tick();
  const clockTimer = setInterval(tick, 30000);
  onNextRender(() => clearInterval(clockTimer));

  const score = h('div', { class: 'scorebar' },
    h('div', {}, h('div', { class: 'big', text: fmtPct(totals.made, totals.att) }), h('div', { class: 'muted', text: `${totals.made} / ${totals.att} made` })),
    h('div', { class: 'right' },
      h('div', { class: 'session-name', text: active.name + (active.shotType ? ` · ${shotTypeLabel(active.shotType)}` : '') }),
      h('div', { text: isFT ? `${totals.att} / ${active.plan.ft} shots` : `${doneSpots} / ${spots.length} spots` }),
      run >= 3 ? h('div', { class: 'streak', text: `🔥 ${run} in a row` }) : clock),
  );

  const court = svg('svg', { 'aria-label': 'Half court. Tap a shooting spot to select it.' });
  const g = drawCourt(court);
  for (const p of spots) {
    const list = active.shots[p.id] || [];
    const n = active.plan[p.id];
    const made = list.filter(Boolean).length;
    const state = list.length >= n ? 'done' : list.length ? 'partial' : 'empty';
    const label = list.length ? `${made}/${list.length}` : p.short;
    const el = svg('g', {
      class: `spot state-${state}${ui.selected === p.id ? ' selected' : ''}`,
      transform: `translate(${p.x} ${p.y})`, role: 'button', tabindex: 0, 'aria-label': `${p.name}: ${made} of ${list.length}, ${n} planned`,
    },
      svg('circle', { r: 34, class: 'hit' }), svg('circle', { r: 23, class: 'ring' }),
      svg('text', { class: `spot-label${label.length > 5 ? ' tiny' : label.length > 3 ? ' small' : ''}`, text: label }));
    const select = () => { clearTimeout(advanceTimer); ui.selected = p.id; render(); };
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    g.append(el);
  }

  return h('section', { class: 'view practice' }, score, h('div', { class: 'court-wrap' }, court), shotPanel(active, spots));
}

function shotPanel(active, spots) {
  const p = positionById(ui.selected);
  const n = active.plan[p.id];
  const list = active.shots[p.id] || [];
  const full = list.length >= n;

  const pips = h('div', { class: `pips${n > 6 ? ' many' : ''}`, 'aria-label': `${list.filter(Boolean).length} made of ${list.length}` },
    Array.from({ length: n }, (_, i) => {
      const v = list[i];
      return h('span', { class: `pip ${v === true ? 'make' : v === false ? 'miss' : ''}`, text: v === true ? '✓' : v === false ? '✗' : '' });
    }));

  const shoot = (made) => {
    clearTimeout(advanceTimer);
    rest.until = 0;
    if (!store.recordShot(p.id, made)) return;
    lastMiss = made ? null : { pos: p.id, index: store.getActive().shots[p.id].length - 1 };
    buzz(made ? 20 : [10, 40, 10]);
    render();
    if ((store.getActive().shots[p.id]?.length || 0) >= n) {
      advanceTimer = setTimeout(() => {
        const a = store.getActive();
        if (!a || ui.tab !== 'practice' || a.pausedAt) return;
        if (spotDone(p.id)) render();
      }, 700);
    }
  };

  const allDone = spots.every((q) => (active.shots[q.id]?.length || 0) >= active.plan[q.id]);

  // Rest timer banner (counts down; shooting or Skip ends it early).
  let restBanner = null;
  if (rest.until > Date.now() && !allDone) {
    const left = h('strong', { class: 'rest-left' });
    const upd = () => {
      const s = Math.max(0, Math.ceil((rest.until - Date.now()) / 1000));
      left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s === 0) { rest.until = 0; buzz([120, 60, 120]); if (voice.on) say('Go'); render(); }
    };
    upd();
    const t = setInterval(upd, 250);
    onNextRender(() => clearInterval(t));
    restBanner = h('div', { class: 'rest-banner', role: 'timer' },
      h('span', {}, '⏱ Rest ', left, h('span', { class: 'muted', text: ` · next: ${p.name}` })),
      h('button', { class: 'btn-ghost', onclick: () => { rest.until = 0; render(); } }, 'Skip'));
  }

  // Miss direction for the most recent miss (non-blocking; can also be done after the session).
  let dirRow = null;
  const lm = lastMiss && store.getActive().shots[lastMiss.pos]?.[lastMiss.index] === false ? lastMiss : null;
  if (getSettings().missDir && lm && !(active.misses?.[lm.pos]?.[lm.index])) {
    const where = lm.pos === p.id ? `shot ${lm.index + 1}` : `${positionById(lm.pos).name}, shot ${lm.index + 1}`;
    dirRow = h('div', { class: 'dir-row' },
      h('span', { class: 'muted small', text: `Miss (${where}): which way?` }),
      h('div', { class: 'dir-buttons' }, [['short', 'Short'], ['long', 'Long'], ['left', '← Left'], ['right', 'Right →']].map(([d, label]) =>
        h('button', { class: 'chip', onclick: () => { store.setActiveMissDir(lm.pos, lm.index, d); lastMiss = null; render(); } }, label))));
  }

  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { text: p.name }),
        h('div', { class: 'muted', text: `${p.id === 'ft' ? 'Free throws' : ZONES[p.zone].label} · shot ${Math.min(list.length + 1, n)} of ${n}` })),
      pips),
    allDone ? h('p', { class: 'note', text: 'All done. Nice work! Finish the session to save it.' }) : null,
    restBanner,
    dirRow,
    getSettings().handsFree ? voiceBar(active) : null,
    h('div', { class: 'shot-buttons' },
      h('button', { class: 'btn-miss', disabled: full, onclick: () => shoot(false), 'aria-label': 'Miss' }, h('span', { class: 'icon', text: '✗' }), 'Miss'),
      h('button', { class: 'btn-make', disabled: full, onclick: () => shoot(true), 'aria-label': 'Make' }, h('span', { class: 'icon', text: '✓' }), 'Make'),
    ),
    h('div', { class: 'panel-foot' },
      h('button', { class: 'btn-ghost', disabled: !list.length, onclick: () => { clearTimeout(advanceTimer); store.undoShot(p.id); lastMiss = null; render(); } }, '↶ Undo'),
      h('button', { class: 'btn-ghost', onclick: confirmPause, 'aria-label': 'Pause session' }, '⏸ Pause'),
      h('button', { class: 'btn-ghost danger', onclick: discard }, 'Discard'),
      h('button', { class: 'btn-primary', onclick: finish }, 'Finish session'),
    ),
  );
}

function voiceBar(active) {
  if (!voiceSupported) {
    return h('p', { class: 'note', text: 'Hands-free mode isn’t supported in this browser. Try Chrome on Android or Safari on iPhone.' });
  }
  const toggle = () => {
    const l = getListener();
    if (voice.on) { voice.on = false; l.stop(); voice.message = ''; }
    else {
      voice.on = true; voice.message = ''; l.start();
      say(`Listening. ${spotIntro(positionById(ui.selected), active)}.`);
    }
    render();
  };
  return h('div', { class: `voice-bar${voice.on ? ' on' : ''}` },
    h('button', { class: 'voice-toggle', onclick: toggle, 'aria-pressed': String(voice.on) },
      h('span', { class: 'voice-dot', 'data-state': voice.on ? voice.state : 'stopped', 'aria-hidden': 'true' }),
      voice.on ? 'Listening' : 'Start hands-free'),
    h('div', { class: 'voice-text' },
      voice.on || voice.message
        ? [voice.heard ? h('div', { class: 'voice-heard', text: `“${voice.heard}”` }) : h('div', { class: 'voice-heard muted', text: 'Say e.g. “3 makes, missed shots 2 and 4”' }),
          voice.message ? h('div', { class: 'voice-msg', text: voice.message }) : null]
        : h('div', { class: 'muted small', text: 'Speak your results after each spot.' })));
}

function nextOpenSpot(active, fromId) {
  const spots = planSpots(active.plan);
  const start = fromId ? spots.findIndex((p) => p.id === fromId) + 1 : 0;
  for (let k = 0; k < spots.length; k++) {
    const p = spots[(start + k) % spots.length];
    if ((active.shots[p.id]?.length || 0) < active.plan[p.id]) return p.id;
  }
  return null;
}

function begin(opts) {
  store.startSession(opts);
  store.requestPersistence();
  ui.selected = null; rest.until = 0; lastMiss = null;
  voice.heard = ''; voice.message = '';
  render();
  window.scrollTo(0, 0);
}

function startScreen() {
  const s = getSettings();
  const sessions = store.getSessions();
  const last = sessions.at(-1);
  const lastT = last ? sessionTotals(last, last.kind === 'freethrow' ? 'ft' : 'all') : null;
  const drills = store.getDrills();

  const typeSelect = h('select', { class: 'select', 'aria-label': 'Shot type for this session' },
    h('option', { value: '', text: 'Any shot type' }),
    SHOT_TYPES.map((t) => h('option', { value: t.id, text: t.label, selected: standardShotType === t.id })));
  typeSelect.addEventListener('change', () => { standardShotType = typeSelect.value || null; });

  return h('section', { class: 'view start' },
    lastT ? h('p', { class: 'muted small last-line', text: `Last session ${dateLabel(last.startedAt)}: ${last.name}, ${lastT.made}/${lastT.att} (${fmtPct(lastT.made, lastT.att)})` }) : null,
    h('div', { class: 'panel' },
      h('h2', { text: 'Standard session' }),
      h('p', { class: 'muted', text: `All 16 spots × ${s.defaultShots} shots. Change the default in Settings.` }),
      typeSelect,
      h('button', { class: 'btn-primary wide', onclick: () => begin({ name: 'Standard', shotType: standardShotType, plan: store.standardPlan(s.defaultShots) }) }, 'Start standard session')),
    h('div', { class: 'panel' },
      h('div', { class: 'row-between' }, h('h2', { text: 'Drills' }),
        h('button', { class: 'btn-link', onclick: () => { ui.editingDrill = null; setTab('drills'); } }, drills.length ? 'Manage' : 'Create a drill')),
      drills.length
        ? h('ul', { class: 'drill-list' }, drills.map((d) => {
          const total = Object.values(d.plan).reduce((a, b) => a + b, 0);
          return h('li', {},
            h('span', {}, h('strong', { text: d.name }), h('span', { class: 'muted small', text: `${Object.keys(d.plan).length} spots · ${total} shots${d.shotType ? ` · ${shotTypeLabel(d.shotType)}` : ''}` })),
            h('button', { class: 'btn-secondary', onclick: () => begin({ name: d.name, drillId: d.id, shotType: d.shotType, plan: d.plan }) }, 'Start'));
        }))
        : h('p', { class: 'muted', text: 'Build your own sessions: pick spots, set shots per spot and a shot type like off the dribble.' })),
    h('div', { class: 'panel' },
      h('h2', { text: 'Free throws' }),
      h('div', { class: 'row-between' },
        h('span', { class: 'muted', text: 'Shots' }),
        stepper(s.ftShots, { min: 1, max: 50, label: 'free throws', onChange: (v) => updateSettings({ ftShots: v }) })),
      h('button', { class: 'btn-primary wide', onclick: () => begin({ kind: 'freethrow', name: 'Free throws', plan: { [FT_SPOT.id]: getSettings().ftShots } }) }, 'Start free throws')),
  );
}

function finish() {
  clearTimeout(advanceTimer);
  const active = store.getActive();
  const t = sessionTotals(active, active.kind === 'freethrow' ? 'ft' : 'all');
  if (!t.att) {
    if (confirm('No shots recorded. Close this session without saving?')) { store.discardActive(); render(); }
    return;
  }
  const remaining = planSpots(active.plan).filter((p) => (active.shots[p.id]?.length || 0) < active.plan[p.id]).length;
  const misses = t.att - t.made;
  openSheet((close) => {
    const note = h('textarea', { class: 'textarea', maxlength: 500, rows: 3, placeholder: 'Notes (optional): how you felt, what to work on…' });
    return [
      h('h2', { text: 'Finish session' }),
      h('p', { class: 'big-line', text: `${t.made}/${t.att} · ${fmtPct(t.made, t.att)}` }),
      remaining ? h('p', { class: 'muted', text: `${remaining} spot${remaining > 1 ? 's' : ''} not finished. They won't count.` }) : null,
      note,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn-ghost', onclick: close }, 'Keep shooting'),
        misses ? h('button', { class: 'btn-secondary', onclick: () => save(true) }, 'Save & add miss directions') : null,
        h('button', { class: 'btn-primary', onclick: () => save(false) }, 'Save session')),
    ];
    function save(editAfter) {
      close();
      const saved = store.finishSession(note.value.trim());
      ui.selected = null; ui.inspect = null; ui.player = 'me'; rest.until = 0; lastMiss = null;
      ui.range = saved.kind === 'freethrow' ? ui.range : saved.id;
      toast(`Session saved: ${t.made}/${t.att} (${fmtPct(t.made, t.att)})`);
      setTab('progress');
      if (editAfter) startEditing(saved);
    }
  });
}

function confirmPause() {
  openSheet((close) => [
    h('h2', { text: 'Pause session?' }),
    h('p', { class: 'muted', text: 'The clock stops and shooting is locked until you resume. Your shots so far are saved.' }),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'),
      h('button', { class: 'btn-primary', onclick: () => { close(); clearTimeout(advanceTimer); rest.until = 0; store.pauseActive(); render(); } }, '⏸ Pause')),
  ]);
}

function pausedScreen(active) {
  const since = h('span');
  const upd = () => { since.textContent = `${Math.max(0, Math.floor((Date.now() - Date.parse(active.pausedAt)) / 60000))} min`; };
  upd();
  const t = setInterval(upd, 30000);
  onNextRender(() => clearInterval(t));
  const totals = sessionTotals(active, active.kind === 'freethrow' ? 'ft' : 'all');
  return h('section', { class: 'view paused' },
    h('div', { class: 'panel center-panel' },
      h('div', { class: 'lock-badge', 'aria-hidden': 'true', text: '⏸' }),
      h('h2', { text: 'Session paused' }),
      h('p', { class: 'muted' }, `${active.name} · ${totals.made}/${totals.att} so far · paused for `, since),
      h('button', { class: 'btn-primary wide', onclick: () => { store.resumeActive(); render(); } }, '▶ Resume'),
      h('div', { class: 'row' },
        h('button', { class: 'btn-ghost danger', onclick: discard }, 'Discard'),
        h('button', { class: 'btn-ghost', onclick: finish }, 'Finish session'))));
}

function discard() {
  if (!confirm('Discard this session? Shots recorded so far will be lost.')) return;
  clearTimeout(advanceTimer);
  store.discardActive();
  ui.selected = null;
  render();
}
