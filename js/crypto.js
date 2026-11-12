// Encryption helpers (Web Crypto only, nothing hand-rolled).
//  - Passphrase -> 256-bit master secret with PBKDF2-SHA256 (600k iterations).
//  - HKDF splits it into an AES-256-GCM key (contents) and an HMAC key (file names).
//  - Every encryption uses a fresh random 96-bit IV; associated data binds a
//    ciphertext to its purpose/file so files can't be swapped around.
const enc = new TextEncoder(), dec = new TextDecoder();
export const PBKDF2_ITER = 600000;
export const MIN_PASSPHRASE = 12;

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKeys(passphrase, salt, iterations = PBKDF2_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  const master = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const info = (s) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(s) });
  const aes = await crypto.subtle.deriveKey(info('hoop-tracker/aes-gcm'), master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const mac = await crypto.subtle.deriveKey(info('hoop-tracker/hmac-names'), master, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return { aes, mac };
}

export async function hmacHex(macKey, text, len = 32) {
  return hex(await crypto.subtle.sign('HMAC', macKey, enc.encode(text))).slice(0, len);
}

// Encrypt an object. padTo hides the exact size (rounds plaintext up to a multiple).
export async function encryptJSON(aesKey, obj, aad, padTo = 0) {
  let text = JSON.stringify(obj);
  if (padTo) text += ' '.repeat((padTo - (enc.encode(text).length % padTo)) % padTo);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, aesKey, enc.encode(text)));
  return { iv: b64(iv), ct: b64(ct) };
}

// Throws if the key is wrong or the data was tampered with.
export async function decryptJSON(aesKey, { iv, ct }, aad) {
  if (typeof iv !== 'string' || typeof ct !== 'string') throw new Error('bad envelope');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad) }, aesKey, unb64(ct));
  return JSON.parse(dec.decode(pt));
}
