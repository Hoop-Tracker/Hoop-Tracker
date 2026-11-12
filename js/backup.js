// Encrypted backup files. Each backup has its own random salt, so it can be
// restored on any device with just the passphrase that was used to make it.
import * as store from './store.js';
import { deriveKeys, encryptJSON, decryptJSON, b64, unb64, randomBytes, PBKDF2_ITER } from './crypto.js';

const FORMAT = 'hoop-tracker-backup';
const AAD = `${FORMAT}:v3`;

export async function makeEncryptedBackup(passphrase) {
  const salt = randomBytes(16);
  const { aes } = await deriveKeys(passphrase, salt);
  const box = await encryptJSON(aes, JSON.parse(store.exportJSON()), AAD, 4096);
  return JSON.stringify({ format: FORMAT, v: 3, kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) }, ...box });
}

// Returns 'encrypted' | 'plain' | null (not a backup we recognise).
export function backupKind(text) {
  try {
    const d = JSON.parse(text);
    if (d?.format === FORMAT && d.v === 3) return 'encrypted';
    if (d?.version === 1 || d?.version === 2) return 'plain'; // older unencrypted backups
  } catch { /* fall through */ }
  return null;
}

export async function restoreEncryptedBackup(text, passphrase) {
  const d = JSON.parse(text);
  if (d.kdf?.name !== 'PBKDF2-SHA256' || !Number.isInteger(d.kdf.iter) || d.kdf.iter < 100000 || d.kdf.iter > 5_000_000) {
    throw new Error('Unknown backup format.');
  }
  const { aes } = await deriveKeys(passphrase, unb64(d.kdf.salt), d.kdf.iter);
  let inner;
  try { inner = await decryptJSON(aes, d, AAD); } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
  return store.importJSON(JSON.stringify(inner));
}
