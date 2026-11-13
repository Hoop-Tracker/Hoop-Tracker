// User preferences (appearance, team colourway, practice options, security options).
// Stored inside the encrypted vault, like everything else.
import * as vault from './vault.js';

const KEY = 'hoopTracker.settings.v1'; // only read to migrate unencrypted prefs from older versions

// Team-inspired colourways. `light`/`dark` give the accent used for buttons and
// finished spots in each mode, plus the text colour that sits on top of it.
// `primary` tints the painted key; `secondary` colours the rim.
export const TEAMS = [
  { id: 'classic', name: 'Classic', primary: '#d95926', secondary: '#eb6834', light: ['#d95926', '#ffffff'], dark: ['#eb6834', '#ffffff'] },
  { id: 'warriors', name: 'Golden State', primary: '#1D428A', secondary: '#FFC72C', light: ['#1D428A', '#ffffff'], dark: ['#FFC72C', '#0b0b0b'] },
  { id: 'lakers', name: 'Los Angeles (purple & gold)', primary: '#552583', secondary: '#FDB927', light: ['#552583', '#ffffff'], dark: ['#FDB927', '#0b0b0b'] },
  { id: 'celtics', name: 'Boston', primary: '#007A33', secondary: '#BA9653', light: ['#007A33', '#ffffff'], dark: ['#1DB35F', '#0b0b0b'] },
  { id: 'bulls', name: 'Chicago', primary: '#CE1141', secondary: '#000000', light: ['#CE1141', '#ffffff'], dark: ['#E0284F', '#ffffff'] },
  { id: 'heat', name: 'Miami', primary: '#98002E', secondary: '#F9A01B', light: ['#98002E', '#ffffff'], dark: ['#F9A01B', '#0b0b0b'] },
  { id: 'knicks', name: 'New York', primary: '#006BB6', secondary: '#F58426', light: ['#006BB6', '#ffffff'], dark: ['#F58426', '#0b0b0b'] },
  { id: 'suns', name: 'Phoenix', primary: '#1D1160', secondary: '#E56020', light: ['#1D1160', '#ffffff'], dark: ['#E56020', '#0b0b0b'] },
  { id: 'nuggets', name: 'Denver', primary: '#0E2240', secondary: '#FEC524', light: ['#0E2240', '#ffffff'], dark: ['#FEC524', '#0b0b0b'] },
  { id: 'mavericks', name: 'Dallas', primary: '#00538C', secondary: '#B8C4CA', light: ['#00538C', '#ffffff'], dark: ['#4A9FE0', '#0b0b0b'] },
  { id: 'bucks', name: 'Milwaukee', primary: '#00471B', secondary: '#EEE1C6', light: ['#00471B', '#ffffff'], dark: ['#EEE1C6', '#0b0b0b'] },
  { id: 'spurs', name: 'San Antonio', primary: '#000000', secondary: '#C4CED4', light: ['#1a1a1a', '#ffffff'], dark: ['#C4CED4', '#0b0b0b'] },
];

// Short names shown under the swatches.
export const TEAM_LABELS = {
  classic: 'Classic', warriors: 'Warriors', lakers: 'Lakers', celtics: 'Celtics', bulls: 'Bulls', heat: 'Heat',
  knicks: 'Knicks', suns: 'Suns', nuggets: 'Nuggets', mavericks: 'Mavericks', bucks: 'Bucks', spurs: 'Spurs',
};

export const MODES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const DEFAULTS = { mode: 'system', team: 'classic', heatLabel: 'pct', defaultShots: 5, ftShots: 10, handsFree: false, speakBack: true, autoLock: 5, rotateMonths: 6, missDir: false, restSecs: 0,
  layupShots: 5, layupSpots: ['y-rr', 'y-ll'], layupFinish: 'regular', heatMode: 'spots' };
const LAYUP_SPOT_IDS = ['y-rr', 'y-rl', 'y-ll', 'y-lr', 'y-mr', 'y-ml'];
const LAYUP_FINISH_IDS = ['', 'regular', 'reverse', 'euro', 'floater', 'power', 'fingerroll', 'other'];
export const REST_OPTIONS = [0, 15, 30, 45, 60, 90, 120];
export const AUTO_LOCK = [
  { id: 0, label: 'Every time I leave the app' }, { id: 1, label: 'After 1 minute away' }, { id: 5, label: 'After 5 minutes away' },
  { id: 15, label: 'After 15 minutes away' }, { id: 60, label: 'After 1 hour away' },
];
export const ROTATE = [{ id: 3, label: 'Every 3 months' }, { id: 6, label: 'Every 6 months' }, { id: 12, label: 'Every 12 months' }, { id: 0, label: 'Never remind me' }];
const intIn = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

// Until the vault is unlocked, the app runs on defaults (the lock screen uses the
// standard look, following the phone's light/dark setting). Nothing is stored unencrypted.
let settings = { ...DEFAULTS };

// Call after the vault is unlocked. Also moves preferences saved unencrypted by
// older versions into the vault and deletes the plaintext copy.
export function initSettings() {
  let source = vault.get('settings');
  let legacy = null;
  try { legacy = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!source && legacy) { try { source = JSON.parse(legacy); } catch { /* ignore */ } }
  settings = sanitize(source || {});
  if (legacy) {
    vault.set('settings', settings);
    vault.flush().then(() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } });
  }
  applyTheme();
}

function sanitize(s) {
  try {
    return {
      mode: MODES.some((m) => m.id === s.mode) ? s.mode : DEFAULTS.mode,
      team: TEAMS.some((t) => t.id === s.team) ? s.team : DEFAULTS.team,
      heatLabel: s.heatLabel === 'made' ? 'made' : 'pct',
      defaultShots: intIn(s.defaultShots, 1, 50, DEFAULTS.defaultShots),
      ftShots: intIn(s.ftShots, 1, 50, DEFAULTS.ftShots),
      handsFree: s.handsFree === true,
      speakBack: s.speakBack !== false,
      autoLock: AUTO_LOCK.some((o) => o.id === s.autoLock) ? s.autoLock : DEFAULTS.autoLock,
      rotateMonths: ROTATE.some((o) => o.id === s.rotateMonths) ? s.rotateMonths : DEFAULTS.rotateMonths,
      missDir: s.missDir === true,
      restSecs: REST_OPTIONS.includes(s.restSecs) ? s.restSecs : DEFAULTS.restSecs,
      layupShots: intIn(s.layupShots, 1, 50, DEFAULTS.layupShots),
      layupSpots: Array.isArray(s.layupSpots) && s.layupSpots.length && s.layupSpots.every((x) => LAYUP_SPOT_IDS.includes(x))
        ? LAYUP_SPOT_IDS.filter((x) => s.layupSpots.includes(x)) : [...DEFAULTS.layupSpots],
      layupFinish: LAYUP_FINISH_IDS.includes(s.layupFinish) ? s.layupFinish : DEFAULTS.layupFinish,
      heatMode: ['spots', 'areas', 'sides'].includes(s.heatMode) ? s.heatMode : DEFAULTS.heatMode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const getSettings = () => settings;

export function updateSettings(patch) {
  settings = sanitize({ ...settings, ...patch });
  if (vault.isUnlocked()) vault.set('settings', settings);
  applyTheme();
}

// ---- team text colour: use the team's other colour on buttons when it's readable ----
// WCAG contrast ratio; 4.5:1 is the "AA" level for normal-size text.
const MIN_TEXT_CONTRAST = 4.5;
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Returns [accent, textOnAccent, usesTeamColour].
export function teamColours(team, dark) {
  const [accent, fallback] = dark ? team.dark : team.light;
  if (team.id === 'classic') return [accent, fallback, false];
  const candidates = [team.secondary, team.primary].filter((c) => c.toLowerCase() !== accent.toLowerCase());
  const best = candidates.map((c) => [c, contrast(c, accent)]).sort((p, q) => q[1] - p[1])[0];
  return best && best[1] >= MIN_TEXT_CONTRAST ? [accent, best[0], true] : [accent, fallback, false];
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => settings.mode === 'dark' || (settings.mode === 'system' && darkQuery.matches);

export function applyTheme() {
  const root = document.documentElement;
  if (settings.mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.mode);

  const team = TEAMS.find((t) => t.id === settings.team) || TEAMS[0];
  const [accent, ink] = teamColours(team, isDark());
  // CSSOM property writes are allowed under our CSP (inline style attributes are not).
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-ink', ink);
  root.style.setProperty('--team-primary', team.primary);
  root.style.setProperty('--team-secondary', team.secondary);
  root.dataset.team = team.id;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark() ? '#1a1a19' : '#fcfcfb');
}

darkQuery.addEventListener?.('change', () => { if (settings.mode === 'system') applyTheme(); });
