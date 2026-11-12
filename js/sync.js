// Sync through a PRIVATE GitHub repository shared by your group. Everything is
// end-to-end encrypted with the team passphrase before it leaves the phone:
//  - file contents (sessions, drills, goals, notes, player name, timestamps)
//  - file names: players/<HMAC(name)>.json, so the listing reveals nothing
//  - contents are padded so file sizes only hint loosely at how much data there is
// The token and passphrases live only in this device's encrypted vault.
//
// Changing the team passphrase: your file is re-encrypted under the new key and the
// old one deleted. For 30 days the old passphrase is still used to READ friends who
// haven't switched yet, so nobody loses sight of anyone during the changeover.
import * as store from './store.js';
import * as vault from './vault.js';
import { deriveKeys, hmacHex, encryptJSON, decryptJSON, MIN_PASSPHRASE } from './crypto.js';

const API = 'https://api.github.com';
const FORMAT = 'hoop-tracker-enc';
const VERSION = 3;
const MAX_FILE = 15_000_000;
const FILE_RE = /^[a-f0-9]{32}\.json$/;
const GRACE_DAYS = 30;
const DAY = 86400000;

export const PATTERNS = {
  owner: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  repo: /^[A-Za-z0-9._-]{1,100}$/,
  player: /^[a-z0-9](?:[a-z0-9-]{0,22})$/,
  token: /^(github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{20,255})$/,
};
export { MIN_PASSPHRASE };

// ---------- config (stored in the encrypted vault) ----------
function isoOrNull(v) { return typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null; }

let config = sanitizeConfig({});
let friends = {};

export function init() {
  config = sanitizeConfig(vault.get('sync') || {});
  friends = sanitizeFriends(vault.get('friends') || {});
}

function sanitizeConfig(c) {
  const ok = (k) => typeof c?.[k] === 'string' && PATTERNS[k].test(c[k]);
  const pass = (v) => (typeof v === 'string' && v.length >= MIN_PASSPHRASE ? v.slice(0, 200) : '');
  return {
    owner: ok('owner') ? c.owner : '', repo: ok('repo') ? c.repo : '', player: ok('player') ? c.player : '',
    token: ok('token') ? c.token : '',
    passphrase: pass(c?.passphrase),
    passphraseSetAt: isoOrNull(c?.passphraseSetAt),
    tokenSetAt: isoOrNull(c?.tokenSetAt),
    prevPassphrase: pass(c?.prevPassphrase),
    prevUntil: isoOrNull(c?.prevUntil),
    pendingDelete: typeof c?.pendingDelete === 'string' && /^[a-f0-9]{32}$/.test(c.pendingDelete) ? c.pendingDelete : null,
    lastSync: isoOrNull(c?.lastSync),
    lastError: typeof c?.lastError === 'string' ? c.lastError.slice(0, 300) : null,
    reviewIds: ids(c?.reviewIds), allowDelete: ids(c?.allowDelete), keepIds: ids(c?.keepIds),
  };
}
function ids(list) { return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && /^[a-f0-9]{8,32}$/.test(x)).slice(0, 20000) : []; }

function sanitizeFriends(f) {
  const out = {};
  if (!f || typeof f !== 'object') return out;
  for (const [name, v] of Object.entries(f)) {
    if (!PATTERNS.player.test(name) || !v || typeof v !== 'object' || typeof v.fileId !== 'string') continue;
    const data = store.validatePayload({ sessions: v.sessions, goals: v.goals, drills: v.drills });
    if (data) out[name] = { fileId: v.fileId, sha: typeof v.sha === 'string' ? v.sha : '', updatedAt: isoOrNull(v.updatedAt), oldKey: v.oldKey === true, sessions: data.sessions, goals: data.goals, drills: data.drills };
  }
  return out;
}

const saveConfig = () => vault.set('sync', config);
const saveFriends = () => vault.set('friends', friends);

export const getConfig = () => ({ ...config });
export const isConfigured = () => !!(config.owner && config.repo && config.player && config.token && config.passphrase);
export const getFriends = () => friends;
const graceActive = () => !!(config.prevPassphrase && config.prevUntil && Date.parse(config.prevUntil) > Date.now());

// First-time setup, or editing repo / player / token. (Passphrase changes go through changeTeamPassphrase.)
export function setConfig(patch) {
  const next = sanitizeConfig({ ...config, ...patch });
  const now = new Date().toISOString();
  if (next.token !== config.token) next.tokenSetAt = now;
  if (next.passphrase !== config.passphrase) next.passphraseSetAt = now;
  const changedTarget = ['owner', 'repo', 'player', 'passphrase'].some((k) => next[k] !== config[k]);
  config = next;
  if (changedTarget) { friends = {}; saveFriends(); config.lastSync = null; }
  saveConfig();
}

export async function changeTeamPassphrase(current, next) {
  if (current !== config.passphrase) throw new Error('Current team passphrase is wrong.');
  while (syncing && inFlight) await inFlight.catch(() => {}); // let a running sync finish first
  if (next.length < MIN_PASSPHRASE) throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
  if (next === current) throw new Error('The new passphrase is the same as the current one.');
  const oldKeys = await teamKeys(config.passphrase);
  config.pendingDelete = await fileIdFor(oldKeys, config.player);
  config.prevPassphrase = config.passphrase;
  config.prevUntil = new Date(Date.now() + GRACE_DAYS * DAY).toISOString();
  config.passphrase = next;
  config.passphraseSetAt = new Date().toISOString();
  saveConfig();
  for (const f of Object.values(friends)) f.sha = ''; // re-check which passphrase each friend is on
  return syncNow();
}

export function disconnect() {
  config = sanitizeConfig({});
  friends = {};
  keyCache.clear();
  saveConfig(); saveFriends();
  notify();
}

const statusListeners = new Set();
export const onStatus = (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
let syncing = false;
export const isSyncing = () => syncing;
function notify() { for (const fn of statusListeners) { try { fn(); } catch { /* ignore */ } } }

// ---------- team keys ----------
// Salt is tied to the repository, so the same passphrase gives different keys elsewhere.
const keyCache = new Map();
async function teamKeys(passphrase, cfg = config) {
  const repoId = `${cfg.owner.toLowerCase()}/${cfg.repo.toLowerCase()}`;
  const id = `${repoId}\n${passphrase}`;
  if (!keyCache.has(id)) {
    keyCache.set(id, await deriveKeys(passphrase, new TextEncoder().encode(`hoop-tracker:v3:team:${repoId}`)));
  }
  return keyCache.get(id);
}
const fileIdFor = async (k, player) => hmacHex(k.mac, `player:${player}`);
const aadFor = (fileId) => `${FORMAT}:v${VERSION}:${fileId}`;

// ---------- GitHub API ----------
class GitHubError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function gh(path, { method = 'GET', body, raw = false, cfg = config } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const msg = res.status === 401 ? 'GitHub rejected the access token. It may have expired: create a new one and update it in Sync → Edit.'
      : res.status === 403 ? 'The token does not have permission for this repository (needs Contents: read & write).'
      : res.status === 409 || res.status === 422 ? 'conflict'
      : `GitHub error ${res.status}.`;
    throw new GitHubError(msg, res.status);
  }
  if (raw) {
    const text = await res.text();
    if (text.length > MAX_FILE) throw new GitHubError('A player file is too large.', 413);
    return text;
  }
  return res.status === 204 ? {} : res.json();
}

const repoPath = (cfg = config) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

export async function testConnection(cfg) {
  const c = sanitizeConfig(cfg);
  if (!c.owner || !c.repo) return { ok: false, message: 'Enter the organisation (or username) and repository name.' };
  if (!c.token) return { ok: false, message: 'That doesn’t look like a GitHub access token (should start with github_pat_).' };
  if (!c.player) return { ok: false, message: 'Pick a player name: lowercase letters, numbers and dashes.' };
  if (!c.passphrase) return { ok: false, message: `The team passphrase must be at least ${MIN_PASSPHRASE} characters.` };
  try {
    const repo = await gh(repoPath(c), { cfg: c });
    if (!repo) return { ok: false, message: 'Repository not found, or the token can’t see it.' };
    if (repo.private !== true) return { ok: false, message: 'That repository is PUBLIC. Sync only works with a private repository.' };
    if (repo.permissions && repo.permissions.push === false) return { ok: false, message: 'The token can read but not write. Give it Contents: read & write.' };
    return { ok: true, message: `Connected to ${repo.full_name} (private).` };
  } catch (e) {
    return { ok: false, message: e instanceof GitHubError ? e.message : 'Could not reach GitHub. Are you online?' };
  }
}

// ---------- file format ----------
// On GitHub: { format, v, iv, ct }. Nothing else in the clear.
async function encodeFile(k, fileId, payload) {
  const inner = { player: config.player, updatedAt: new Date().toISOString(), data: payload };
  const box = await encryptJSON(k.aes, inner, aadFor(fileId), 4096);
  return JSON.stringify({ format: FORMAT, v: VERSION, ...box });
}

class UnreadableError extends Error {}
class ReviewNeeded extends Error { constructor(count) { super('review'); this.count = count; } }
const DELETE_GUARD = 3; // more deletions than this in one sync need confirming

// The user's answer to "sync wants to delete N sessions": 'delete' or 'keep'.
export function resolveDeletions(choice) {
  if (!config.reviewIds.length) return;
  if (choice === 'delete') config.allowDelete = [...config.reviewIds];
  else config.keepIds = [...config.reviewIds];
  config.reviewIds = [];
  saveConfig();
  return syncNow();
}
async function decodeFile(k, fileId, text) {
  let file;
  try { file = JSON.parse(text); } catch { throw new UnreadableError(); }
  if (!file || file.format !== FORMAT || file.v !== VERSION) throw new UnreadableError();
  let inner;
  try { inner = await decryptJSON(k.aes, file, aadFor(fileId)); } catch { throw new UnreadableError(); }
  if (!inner || typeof inner.player !== 'string' || !PATTERNS.player.test(inner.player)) throw new UnreadableError();
  // The file name must match the name inside, so nobody's data can pose as someone else's.
  if ((await fileIdFor(k, inner.player)) !== fileId) throw new UnreadableError();
  const data = store.validatePayload(inner.data);
  if (!data) throw new UnreadableError();
  return { player: inner.player, updatedAt: isoOrNull(inner.updatedAt), data };
}

// ---------- sync ----------
let inFlight = null;
export function syncNow() {
  if (syncing && inFlight) return inFlight; // join the running sync instead of failing
  inFlight = runSync();
  return inFlight;
}

async function runSync() {
  if (!isConfigured()) return { ok: false, message: 'Sync is not set up.' };
  if (!navigator.onLine) return { ok: false, message: 'Offline: will sync when you’re back online.' };
  syncing = true; notify();
  try {
    let warnings = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        warnings = await syncOnce();
        break;
      } catch (e) {
        if (e instanceof GitHubError && e.message === 'conflict' && attempt === 0) continue; // another device wrote; retry
        throw e;
      }
    }
    config.lastSync = new Date().toISOString();
    config.lastError = warnings.length ? warnings.join(' ') : null;
    if (config.prevPassphrase && !graceActive()) { config.prevPassphrase = ''; config.prevUntil = null; }
    saveConfig();
    return { ok: true, message: warnings.length ? warnings.join(' ') : 'Synced.' };
  } catch (e) {
    config.lastError = e instanceof GitHubError ? (e.message === 'conflict' ? 'Sync conflict. Try again.' : e.message)
      : e instanceof ReviewNeeded ? `Sync paused: it would delete ${e.count} of your sessions. Review this in Settings → Sync.`
      : e instanceof UnreadableError ? 'This passphrase doesn’t unlock the data in this repository. Check it’s typed exactly the same as everyone else’s. Nothing was uploaded.'
      : e instanceof TypeError ? 'Could not reach GitHub.' : e.message;
    saveConfig();
    return { ok: false, message: config.lastError };
  } finally {
    syncing = false; notify();
  }
}

async function syncOnce() {
  const k = await teamKeys(config.passphrase);
  const prevK = graceActive() ? await teamKeys(config.prevPassphrase) : null;
  const myId = await fileIdFor(k, config.player);
  const listing = (await gh(`${repoPath()}/contents/players`)) || [];
  if (!Array.isArray(listing)) throw new Error('Unexpected repository layout.');
  const files = new Map(listing.filter((f) => f.type === 'file' && FILE_RE.test(f.name)).map((f) => [f.name.slice(0, -5), f]));

  // 1) Pull my own file (written by my other devices) and merge it in.
  //    Mid-changeover, my newest copy may still be under the old passphrase.
  let mine = files.get(myId);
  let remote = null;
  if (mine) {
    const text = await gh(`${repoPath()}/contents/players/${mine.name}`, { raw: true });
    if (text) {
      remote = (await decodeFile(k, myId, text)).data; // throws on a wrong passphrase: never overwrite
      // Safeguard: a copy that would delete several of my sessions needs my say-so first.
      const doomed = store.pendingDeletions(remote).filter((id) => !config.allowDelete.includes(id) && !config.keepIds.includes(id));
      if (doomed.length > DELETE_GUARD) {
        config.reviewIds = doomed;
        throw new ReviewNeeded(doomed.length);
      }
      store.mergeRemote(remote, { keep: config.keepIds });
    }
  }
  const oldMine = config.pendingDelete ? files.get(config.pendingDelete) : null;
  if (oldMine && prevK) {
    const text = await gh(`${repoPath()}/contents/players/${oldMine.name}`, { raw: true });
    if (text) { try { store.mergeRemote((await decodeFile(prevK, oldMine.name.slice(0, -5), text)).data); } catch { /* stale or foreign */ } }
  }

  // 2) Pull friends whose files changed. Files we can't decrypt (another passphrase,
  //    stale or foreign files) are skipped; their owners' names are unknowable to us.
  const known = new Map(Object.entries(friends).map(([name, f]) => [f.fileId, name]));
  const next = {};
  let unreadable = 0;
  for (const [fileId, f] of files) {
    if (fileId === myId || fileId === config.pendingDelete) continue;
    const cachedName = known.get(fileId);
    if (cachedName && friends[cachedName].sha === f.sha) { next[cachedName] = friends[cachedName]; continue; }
    const text = await gh(`${repoPath()}/contents/players/${f.name}`, { raw: true });
    if (!text) continue;
    let decoded = null, oldKey = false;
    try { decoded = await decodeFile(k, fileId, text); } catch {
      if (prevK) { try { decoded = await decodeFile(prevK, fileId, text); oldKey = true; } catch { /* unreadable */ } }
    }
    if (!decoded) { unreadable++; if (cachedName) next[cachedName] = friends[cachedName]; continue; }
    if (decoded.player === config.player) continue;
    // If a friend has files under both passphrases, prefer the new one.
    if (next[decoded.player] && !next[decoded.player].oldKey && oldKey) continue;
    next[decoded.player] = { fileId, sha: f.sha, updatedAt: decoded.updatedAt, oldKey, sessions: decoded.data.sessions, goals: decoded.data.goals, drills: decoded.data.drills };
  }

  // A typo in the passphrase gives a different (empty) identity. If the repository has
  // data but nothing unlocks, refuse to upload rather than scatter stray files.
  const readable = Object.keys(next).length + (mine ? 1 : 0) + (oldMine && prevK ? 1 : 0);
  if (!mine && files.size > 0 && readable === 0) throw new UnreadableError();

  friends = next;
  saveFriends();

  // 3) Push mine if anything differs.
  const local = store.validatePayload(store.getSyncPayload());
  if (!remote || JSON.stringify(local) !== JSON.stringify(remote)) {
    const text = await encodeFile(k, myId, local);
    await gh(`${repoPath()}/contents/players/${myId}.json`, {
      method: 'PUT',
      body: { message: 'sync', content: btoa(text), ...(mine ? { sha: mine.sha } : {}) },
    });
  }

  config.reviewIds = []; config.allowDelete = []; config.keepIds = [];

  // 4) After a passphrase change, remove my copy under the old passphrase.
  if (config.pendingDelete) {
    if (oldMine) await gh(`${repoPath()}/contents/players/${oldMine.name}`, { method: 'DELETE', body: { message: 'sync', sha: oldMine.sha } });
    config.pendingDelete = null;
  }

  const warnings = [];
  const behind = Object.entries(friends).filter(([, f]) => f.oldKey).map(([n]) => n);
  if (behind.length) warnings.push(`Still on the old team passphrase: ${behind.join(', ')}. They need to enter the new one before ${new Date(config.prevUntil).toLocaleDateString()}.`);
  if (unreadable) warnings.push(`${unreadable} file${unreadable > 1 ? 's' : ''} in the repository couldn’t be unlocked. Someone may be using a different passphrase.`);
  return warnings;
}

// Background sync: shortly after data changes (not on every shot), and on launch.
let timer = null;
export function scheduleSync(delay = 4000) {
  if (!isConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}
store.subscribe((kind) => { if (kind !== 'active' && kind !== 'merge') scheduleSync(); });
window.addEventListener('online', () => scheduleSync(1000));
