// Local-first persistence, kept inside the encrypted vault (vault.js). Optional sync
// (sync.js) copies it, encrypted, to a private GitHub repository.
import { POSITION_IDS, MAX_SHOTS_PER_SPOT, POSITIONS } from './court.js';
import * as vault from './vault.js';

const LIMITS = { sessions: 10000, drills: 200, goals: 100, tombstones: 20000, note: 500, name: 40, description: 500, shapes: 150, favourites: 300 };

export const SHOT_TYPES = [
  { id: 'standing', label: 'Standing / regular' },
  { id: 'catch', label: 'Catch & shoot' },
  { id: 'dribble', label: 'Off the dribble' },
  { id: 'pullup', label: 'Pull-up' },
  { id: 'stepback', label: 'Step-back' },
  { id: 'fade', label: 'Fadeaway' },
  { id: 'finish', label: 'Layup / finish' },
  { id: 'other', label: 'Other' },
];
export const shotTypeLabel = (id) => SHOT_TYPES.find((t) => t.id === id)?.label || 'Any shot';
export const MISS_DIRS = ['short', 'long', 'left', 'right'];
export const SHAPE_TYPES = ['arrow', 'dash', 'line', 'circle', 'x', 'text', 'pen'];

const empty = () => ({
  version: 2, sessions: [], drills: [], goals: [], favourites: [], favouritesAt: null,
  deleted: { sessions: [], drills: [], goals: [] }, active: null,
});

let state = null; // set by init() once the vault is unlocked
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function persist(kind = 'data') {
  vault.set('store', state);
  for (const fn of listeners) { try { fn(kind); } catch { /* ignore */ } }
}

// Call after the vault is unlocked.
export function init() {
  const raw = vault.get('store');
  if (!raw) { state = empty(); return; }
  state = validateData(raw);
  if (!state) {
    // Never silently overwrite data we couldn't read: keep a copy aside (still encrypted).
    vault.set('recovered', { ...(vault.get('recovered') || {}), [`store.${Date.now()}`]: JSON.stringify(raw) });
    state = empty();
  }
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

export const newId = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const now = () => new Date().toISOString();
const byStart = (a, b) => a.startedAt.localeCompare(b.startedAt);

// ---------- reads ----------
export const getSessions = () => state.sessions;
export const getActive = () => state.active;
export const getDrills = () => state.drills;
export const getDrill = (id) => state.drills.find((d) => d.id === id);
export const getGoals = () => state.goals;
export const getFavourites = () => state.favourites;

// ---------- sessions ----------
export function standardPlan(n) {
  return Object.fromEntries(POSITIONS.map((p) => [p.id, n]));
}

export function startSession({ kind = 'shooting', name = 'Standard', drillId = null, drillFrom = null, shotType = null, plan }) {
  state.active = { id: newId(), kind, name, drillId, drillFrom, shotType, startedAt: now(), endedAt: null,
    plan: { ...plan }, shots: {}, misses: {}, note: '', pausedMs: 0, pausedAt: null };
  persist('active');
  return state.active;
}

const spotRemaining = (posId) => {
  const s = state.active;
  return (s.plan[posId] || 0) - (s.shots[posId]?.length || 0);
};

// Miss directions are kept in arrays aligned with the shots (null = make / not recorded).
function setDir(session, pos, index, dir) {
  const shots = session.shots[pos] || [];
  if (index < 0 || index >= shots.length || shots[index]) return false;
  const arr = (session.misses[pos] ||= []);
  while (arr.length < shots.length) arr.push(null);
  arr[index] = MISS_DIRS.includes(dir) ? dir : null;
  if (arr.every((d) => d === null)) delete session.misses[pos];
  return true;
}

export function recordShot(posId, made, dir = null) {
  return recordShots(posId, [made], [dir]);
}

export function recordShots(posId, list, dirs = []) {
  const s = state.active;
  if (!s || s.pausedAt || !POSITION_IDS.has(posId) || !list.length || list.length > spotRemaining(posId)) return false;
  const start = s.shots[posId]?.length || 0;
  (s.shots[posId] ||= []).push(...list.map(Boolean));
  list.forEach((made, i) => { if (!made && dirs[i]) setDir(s, posId, start + i, dirs[i]); });
  persist('active');
  return true;
}

export function setActiveMissDir(posId, index, dir) {
  if (!state.active || !setDir(state.active, posId, index, dir)) return false;
  persist('active');
  return true;
}

export function undoShot(posId) {
  const s = state.active;
  const list = s?.shots[posId];
  if (!list?.length || s.pausedAt) return false;
  list.pop();
  if (s.misses[posId]) { s.misses[posId].length = Math.min(s.misses[posId].length, list.length); if (!s.misses[posId].some(Boolean)) delete s.misses[posId]; }
  if (!list.length) delete s.shots[posId];
  persist('active');
  return true;
}

export function pauseActive() {
  if (!state.active || state.active.pausedAt) return;
  state.active.pausedAt = now();
  persist('active');
}

export function resumeActive() {
  const s = state.active;
  if (!s?.pausedAt) return;
  s.pausedMs = (s.pausedMs || 0) + Math.max(0, Date.now() - Date.parse(s.pausedAt));
  s.pausedAt = null;
  persist('active');
}

export function finishSession(note = '') {
  const s = state.active;
  if (!s) return null;
  if (s.pausedAt) resumeActive();
  state.active = null;
  const attempts = Object.values(s.shots).reduce((n, l) => n + l.length, 0);
  if (attempts > 0) {
    s.endedAt = now();
    s.note = String(note).slice(0, LIMITS.note);
    delete s.pausedAt;
    state.sessions.push(s);
    state.sessions.sort(byStart);
  }
  persist();
  return attempts > 0 ? s : null;
}

export function discardActive() {
  state.active = null;
  persist('active');
}

export function setSessionNote(id, note) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  s.note = String(note).slice(0, LIMITS.note);
  s.editedAt = now();
  persist();
}

// Replace a finished session's shots and miss directions (fixing mistakes).
export function updateSessionShots(id, shots, misses = {}) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return false;
  const clean = validShots(s.plan, shots);
  if (!clean || !Object.keys(clean).length) return false;
  const cleanMisses = validMisses(clean, misses);
  if (!cleanMisses) return false;
  s.shots = clean;
  s.misses = cleanMisses;
  s.editedAt = now();
  persist();
  return true;
}

const tombstone = (kind, id) => {
  const list = state.deleted[kind];
  if (!list.includes(id)) list.push(id);
  if (list.length > LIMITS.tombstones) list.splice(0, list.length - LIMITS.tombstones);
};

export function deleteSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  tombstone('sessions', id);
  persist();
}

// ---------- drills ----------
export function saveDrill({ id, name, shotType, plan, description = '', drawing = [] }) {
  const existing = id && state.drills.find((d) => d.id === id);
  const clean = {
    name: String(name || 'Untitled drill').trim().slice(0, LIMITS.name) || 'Untitled drill',
    shotType: SHOT_TYPES.some((t) => t.id === shotType) ? shotType : null,
    plan: Object.fromEntries(Object.entries(plan).filter(([k, v]) => POSITION_IDS.has(k) && k !== 'ft' && v > 0)
      .map(([k, v]) => [k, Math.min(MAX_SHOTS_PER_SPOT, Math.round(v))])),
    description: String(description || '').trim().slice(0, LIMITS.description),
    drawing: validDrawing(drawing) || [],
    updatedAt: now(),
  };
  if (existing) Object.assign(existing, clean);
  else state.drills.push({ id: newId(), createdAt: now(), ...clean });
  persist();
  return existing || state.drills.at(-1);
}

export function deleteDrill(id) {
  state.drills = state.drills.filter((d) => d.id !== id);
  tombstone('drills', id);
  state.favourites = state.favourites.filter((k) => k !== `~:${id}`);
  persist();
}

// Favourites: '~:<drillId>' for my drills, '<player>:<drillId>' for a teammate's.
export const favKey = (owner, id) => `${owner === 'me' ? '~' : owner}:${id}`;
export function toggleFavourite(key) {
  if (!FAV_RE.test(key)) return;
  state.favourites = state.favourites.includes(key) ? state.favourites.filter((k) => k !== key) : [...state.favourites, key].slice(-LIMITS.favourites);
  state.favouritesAt = now();
  persist();
}

// ---------- goals ----------
export function addGoal({ scope, target, window: win, by }) {
  const g = { id: newId(), scope, target: Math.max(1, Math.min(100, Math.round(target))), window: win, by: by || null, createdAt: now() };
  if (!validGoal(g)) return null;
  state.goals.push(g);
  persist();
  return g;
}

export function deleteGoal(id) {
  state.goals = state.goals.filter((g) => g.id !== id);
  tombstone('goals', id);
  persist();
}

// ---------- whole-store operations ----------
export function deleteAll() {
  state = empty();
  persist();
}

export function exportJSON() {
  return JSON.stringify({ app: 'hoop-tracker', exportedAt: now(), ...state, active: null }, null, 1);
}

export function importJSON(text) {
  if (text.length > 20_000_000) throw new Error('File is too large.');
  const data = validateData(JSON.parse(text));
  if (!data) throw new Error('This file is not a valid Hoop Tracker backup.');
  const before = state.sessions.length;
  mergeRemote(data);
  const added = state.sessions.length - before;
  return { added, skipped: data.sessions.length - added };
}

// Data shape that is synced to GitHub.
export const getSyncPayload = () => ({
  sessions: state.sessions, drills: state.drills, goals: state.goals, deleted: state.deleted,
  favourites: state.favourites, favouritesAt: state.favouritesAt,
});

// Sessions that a remote copy would delete here.
export function pendingDeletions(remote) {
  const local = new Set(state.sessions.map((s) => s.id));
  return (remote.deleted?.sessions || []).filter((id) => local.has(id));
}

// Merge another copy of *my* data (another device, or a backup). Union by id,
// honouring deletions from both sides; drills use last-write-wins.
// keep: session ids whose remote deletion the user rejected (kept here, re-uploaded).
export function mergeRemote(remote, { keep = [] } = {}) {
  const keepSet = new Set(keep);
  const before = JSON.stringify(getSyncPayload());
  for (const k of ['sessions', 'drills', 'goals']) {
    for (const id of remote.deleted?.[k] || []) if (!(k === 'sessions' && keepSet.has(id))) tombstone(k, id);
  }
  const dead = (k) => new Set(state.deleted[k]);

  const deadS = dead('sessions');
  const sessions = new Map(state.sessions.filter((s) => !deadS.has(s.id)).map((s) => [s.id, s]));
  for (const s of remote.sessions || []) {
    if (deadS.has(s.id)) continue;
    const mine = sessions.get(s.id);
    if (!mine || (s.editedAt || '') > (mine.editedAt || '')) sessions.set(s.id, s);
  }
  state.sessions = [...sessions.values()].sort(byStart);

  const deadD = dead('drills');
  const drills = new Map(state.drills.filter((d) => !deadD.has(d.id)).map((d) => [d.id, d]));
  for (const d of remote.drills || []) {
    if (deadD.has(d.id)) continue;
    const mine = drills.get(d.id);
    if (!mine || d.updatedAt > mine.updatedAt) drills.set(d.id, d);
  }
  state.drills = [...drills.values()];

  const deadG = dead('goals');
  const goals = new Map(state.goals.filter((g) => !deadG.has(g.id)).map((g) => [g.id, g]));
  for (const g of remote.goals || []) if (!deadG.has(g.id) && !goals.has(g.id)) goals.set(g.id, g);
  state.goals = [...goals.values()];

  if (remote.favouritesAt && (!state.favouritesAt || remote.favouritesAt > state.favouritesAt)) {
    state.favourites = [...(remote.favourites || [])];
    state.favouritesAt = remote.favouritesAt;
  }

  const changed = JSON.stringify(getSyncPayload()) !== before;
  if (changed) persist('merge');
  return changed;
}

// ---------- strict validation: rebuild clean objects, never trust input shape ----------
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ID_RE = /^[a-f0-9]{8,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLAYER_RE = /^[a-z0-9](?:[a-z0-9-]{0,22})$/;
const FAV_RE = /^(~|[a-z0-9][a-z0-9-]{0,22}):[a-f0-9]{8,32}$/;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isIso = (v) => typeof v === 'string' && ISO_RE.test(v) && !isNaN(Date.parse(v));
const cleanStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function validPlan(p) {
  if (!isObj(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (!POSITION_IDS.has(k) || !Number.isInteger(v) || v < 1 || v > MAX_SHOTS_PER_SPOT) return null;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function validShots(plan, shots) {
  if (!isObj(shots)) return null;
  const out = {};
  for (const [pos, list] of Object.entries(shots)) {
    if (!plan[pos] || !Array.isArray(list) || list.length > plan[pos] || !list.every((v) => typeof v === 'boolean')) return null;
    if (list.length) out[pos] = list.slice();
  }
  return out;
}

// Miss directions must line up with misses; anything else is dropped (or rejected if malformed).
function validMisses(shots, misses) {
  if (misses == null) return {};
  if (!isObj(misses)) return null;
  const out = {};
  for (const [pos, arr] of Object.entries(misses)) {
    if (!shots[pos] || !Array.isArray(arr) || arr.length > shots[pos].length) return null;
    const clean = arr.map((d, i) => (MISS_DIRS.includes(d) && shots[pos][i] === false ? d : null));
    if (clean.some(Boolean)) out[pos] = clean;
  }
  return out;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -200 && v <= 700;
export function validDrawing(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.shapes) return null;
  const out = [];
  for (const s of list) {
    if (!isObj(s) || !SHAPE_TYPES.includes(s.t) || !Number.isInteger(s.c) || s.c < 0 || s.c > 3) return null;
    if (!Array.isArray(s.p) || s.p.length < 2 || s.p.length > 400 || s.p.length % 2 || !s.p.every(num)) return null;
    const shape = { t: s.t, c: s.c, p: s.p.map((v) => Math.round(v)) };
    if (s.t === 'text') { shape.s = cleanStr(s.s, 40); if (!shape.s) return null; }
    out.push(shape);
  }
  return out;
}

function validSession(s, allowOpen, v1) {
  if (!isObj(s) || typeof s.id !== 'string' || !ID_RE.test(s.id) || !isIso(s.startedAt)) return null;
  let endedAt = null;
  if (s.endedAt != null) { if (!isIso(s.endedAt)) return null; endedAt = s.endedAt; } else if (!allowOpen) return null;
  const kind = s.kind === 'freethrow' ? 'freethrow' : 'shooting';
  // v1 sessions had no plan: every spot was 5 shots.
  const plan = v1 ? Object.fromEntries(POSITIONS.map((p) => [p.id, 5])) : validPlan(s.plan);
  if (!plan) return null;
  const shots = validShots(plan, s.shots);
  if (!shots) return null;
  const misses = validMisses(shots, s.misses);
  if (!misses) return null;
  const out = {
    id: s.id, kind, startedAt: s.startedAt, endedAt, plan, shots, misses,
    name: cleanStr(s.name, LIMITS.name) || (kind === 'freethrow' ? 'Free throws' : 'Standard'),
    drillId: typeof s.drillId === 'string' && ID_RE.test(s.drillId) ? s.drillId : null,
    drillFrom: typeof s.drillFrom === 'string' && PLAYER_RE.test(s.drillFrom) ? s.drillFrom : null,
    shotType: SHOT_TYPES.some((t) => t.id === s.shotType) ? s.shotType : null,
    note: cleanStr(s.note, LIMITS.note),
    pausedMs: Number.isInteger(s.pausedMs) && s.pausedMs >= 0 && s.pausedMs < 1e9 ? s.pausedMs : 0,
  };
  if (allowOpen && !endedAt) out.pausedAt = isIso(s.pausedAt) ? s.pausedAt : null;
  if (isIso(s.editedAt)) out.editedAt = s.editedAt;
  return out;
}

function validDrill(d) {
  if (!isObj(d) || typeof d.id !== 'string' || !ID_RE.test(d.id) || !isIso(d.createdAt) || !isIso(d.updatedAt)) return null;
  const plan = validPlan(d.plan);
  if (!plan || plan.ft) return null;
  const drawing = validDrawing(d.drawing);
  if (!drawing) return null;
  return { id: d.id, name: cleanStr(d.name, LIMITS.name) || 'Untitled drill', shotType: SHOT_TYPES.some((t) => t.id === d.shotType) ? d.shotType : null,
    plan, description: cleanStr(d.description, LIMITS.description), drawing, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

const GOAL_SCOPE_RE = /^(all|ft|zone:(close|mid|three|deep)|pos:[a-z0-9-]{1,8})$/;
function validGoal(g) {
  if (!isObj(g) || typeof g.id !== 'string' || !ID_RE.test(g.id) || !isIso(g.createdAt)) return null;
  if (typeof g.scope !== 'string' || !GOAL_SCOPE_RE.test(g.scope)) return null;
  if (g.scope.startsWith('pos:') && !POSITION_IDS.has(g.scope.slice(4))) return null;
  if (!Number.isInteger(g.target) || g.target < 1 || g.target > 100) return null;
  if (!['last5', 'last10', '30d'].includes(g.window)) return null;
  if (g.by != null && !(typeof g.by === 'string' && DATE_RE.test(g.by))) return null;
  return { id: g.id, scope: g.scope, target: g.target, window: g.window, by: g.by || null, createdAt: g.createdAt };
}

function validList(list, fn, max) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > max) return null;
  const out = [];
  for (const x of list) { const v = fn(x); if (!v) return null; out.push(v); }
  return out;
}

const validIds = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(-LIMITS.tombstones) : []);

// Validates a payload of sessions/drills/goals/deleted/favourites (backup, synced file or local store).
export function validatePayload(d, v1 = false) {
  if (!isObj(d)) return null;
  const sessions = validList(d.sessions, (s) => validSession(s, false, v1), LIMITS.sessions);
  const drills = validList(d.drills, validDrill, LIMITS.drills);
  const goals = validList(d.goals, validGoal, LIMITS.goals);
  if (!sessions || !drills || !goals) return null;
  const del = isObj(d.deleted) ? d.deleted : {};
  const favourites = Array.isArray(d.favourites) ? d.favourites.filter((k) => typeof k === 'string' && FAV_RE.test(k)).slice(-LIMITS.favourites) : [];
  return { sessions: sessions.sort(byStart), drills, goals,
    deleted: { sessions: validIds(del.sessions), drills: validIds(del.drills), goals: validIds(del.goals) },
    favourites, favouritesAt: isIso(d.favouritesAt) ? d.favouritesAt : null };
}

function validateData(d) {
  if (!isObj(d) || (d.version !== 1 && d.version !== 2)) return null;
  const v1 = d.version === 1;
  const payload = validatePayload(d, v1);
  if (!payload) return null;
  const active = d.active ? validSession(d.active, true, v1) : null;
  return { version: 2, ...payload, active };
}
