// Shared UI shell: view state, tab routing, toast, modal sheet.
import { h, $ } from './dom.js';

export const ui = {
  tab: 'practice',
  selected: null,      // position id during a session
  range: 'last5',      // progress range id, or a session id
  trendZone: 'all',
  inspect: null,       // position id tapped on the heatmap
  player: 'me',        // whose progress is shown
  compare: '',         // second player to compare with
  shotType: 'all',     // progress filter
  location: 'all',     // progress filter: 'all' or a lower-cased location
  progressPage: 'overview', // progress sub-page: 'overview' | 'shooting'  editingDrill: null,  // drill id being edited, or 'new'
  editingSession: null, // finished session id whose shots are being corrected
};

const views = {};
let cleanup = [];
export const registerView = (name, fn) => { views[name] = fn; };
export const onNextRender = (fn) => cleanup.push(fn);

export function render() {
  for (const fn of cleanup) { try { fn(); } catch { /* ignore */ } }
  cleanup = [];
  $('#main').replaceChildren(views[ui.tab]());
}

export function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  render();
  window.scrollTo(0, 0);
}

export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

export const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } };

// Bottom sheet. build(close) returns the sheet's content.
export function openSheet(build) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, build(close));
  overlay.append(sheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  sheet.querySelector('textarea, input, button')?.focus();
  return close;
}

// Small numeric stepper.
// Text box for where a session happened, with chips for recently used locations.
// Returns { input, els } so callers can place the label themselves.
let locSeq = 0;
export function locationInput(value = '', recent = []) {
  const input = h('input', { class: 'input', id: `loc-${++locSeq}`, maxlength: 40, autocomplete: 'off', autocapitalize: 'words',
    placeholder: 'e.g. Home driveway, YMCA court 2', value });
  const chips = recent.length ? h('div', { class: 'chips small-chips loc-chips' },
    recent.slice(0, 5).map((loc) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(loc === value),
      onclick: (e) => {
        input.value = loc;
        for (const c of e.currentTarget.parentNode.children) c.setAttribute('aria-pressed', String(c === e.currentTarget));
      } }, loc))) : null;
  input.addEventListener('input', () => { if (chips) for (const c of chips.children) c.setAttribute('aria-pressed', String(c.textContent === input.value)); });
  return { input, els: [input, chips] };
}

export function stepper(value, { min = 1, max = 50, onChange, label }) {
  const out = h('span', { class: 'stepper-value', 'aria-live': 'polite', text: String(value) });
  const set = (v) => { const n = Math.max(min, Math.min(max, v)); out.textContent = String(n); onChange(n); };
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', 'aria-label': `Decrease ${label}`, onclick: () => set(Number(out.textContent) - 1) }, '−'),
    out,
    h('button', { type: 'button', 'aria-label': `Increase ${label}`, onclick: () => set(Number(out.textContent) + 1) }, '+'));
}
