// Encrypted on-device storage. Everything sensitive (sessions, drills, goals, notes,
// sync settings incl. token and team passphrase, friends' data) is kept in one
// AES-256-GCM blob in localStorage, unlocked with your app passphrase on each open.
// Preferences (theme, team colours, options) are in the vault too: nothing is stored
// unencrypted, so the lock screen always uses the default look.
import { deriveKeys, encryptJSON, decryptJSON, b64, unb64, randomBytes, PBKDF2_ITER } from './crypto.js';

const KEY = 'hoopTracker.vault.v1';
const AAD = 'hoop-tracker-vault:v1';
export const MIN_APP_PASSPHRASE = 12;
const LEGACY = { store: ['hoopTracker.v2', 'hoopTracker.v1'], sync: ['hoopTracker.sync.v1'], friends: ['hoopTracker.friends.v3', 'hoopTracker.friends.v1'] };

let aesKey = null, salt = null, data = null, timer = null;
let chain = Promise.resolve();

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const legacyKeys = () => {
  const keys = Object.values(LEGACY).flat();
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('hoopTracker.v2.unreadable.')) keys.push(k); } } catch { /* ignore */ }
  return keys;
};

export const hasVault = () => !!read(KEY);
export const hasLegacyData = () => legacyKeys().some((k) => read(k));
export const isUnlocked = () => !!aesKey;

export async function unlock(passphrase) {
  const v = parse(read(KEY));
  if (!v || v.v !== 1 || v.kdf?.name !== 'PBKDF2-SHA256') throw new Error('Stored data is in an unknown format.');
  const keys = await deriveKeys(passphrase, unb64(v.kdf.salt), v.kdf.iter);
  try { data = await decryptJSON(keys.aes, v, AAD); } catch { throw new Error('Wrong passphrase.'); }
  aesKey = keys.aes; salt = unb64(v.kdf.salt);
}

// First run (or upgrade from an unencrypted version): create the vault and move any
// existing plaintext data into it, then delete the plaintext copies.
export async function create(passphrase) {
  salt = randomBytes(16);
  aesKey = (await deriveKeys(passphrase, salt)).aes;
  const firstOf = (keys) => { for (const k of keys) { const v = parse(read(k)); if (v) return v; } return null; };
  data = { meta: { appPassSetAt: new Date().toISOString() }, store: firstOf(LEGACY.store), sync: firstOf(LEGACY.sync), friends: firstOf(LEGACY.friends), recovered: {} };
  for (const k of legacyKeys()) if (k.includes('.unreadable.')) data.recovered[k] = read(k);
  await flush();
  if (!parse(read(KEY))) throw new Error('Could not save encrypted data on this device.');
  for (const k of legacyKeys()) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

export async function changePassphrase(current, next) {
  const v = parse(read(KEY));
  const check = await deriveKeys(current, unb64(v.kdf.salt), v.kdf.iter);
  try { await decryptJSON(check.aes, v, AAD); } catch { throw new Error('Current passphrase is wrong.'); }
  salt = randomBytes(16);
  aesKey = (await deriveKeys(next, salt)).aes;
  data.meta = { ...(data.meta || {}), appPassSetAt: new Date().toISOString() };
  await flush();
}

export const get = (section) => data?.[section] ?? null;
export const meta = () => data?.meta || {};
export function setMeta(patch) { if (data) { data.meta = { ...(data.meta || {}), ...patch }; set('meta', data.meta); } }

export function set(section, value) {
  if (!data) return;
  data[section] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 100);
}

// Writes are serialised so an older snapshot can never overwrite a newer one.
export function flush() {
  clearTimeout(timer);
  if (!aesKey) return chain;
  const snapshot = JSON.stringify(data);
  const k = aesKey, s = salt;
  chain = chain.then(async () => {
    const box = await encryptJSON(k, JSON.parse(snapshot), AAD);
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(s) }, ...box })); } catch { /* storage full */ }
  }).catch(() => {});
  return chain;
}

// Forgotten passphrase: the only way out is to erase everything on this device.
export function wipe() {
  aesKey = null; data = null;
  for (const k of [KEY, 'hoopTracker.settings.v1', ...legacyKeys()]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', () => { flush(); });
