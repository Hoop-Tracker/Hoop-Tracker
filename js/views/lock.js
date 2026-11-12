// Lock screen: create the app passphrase (first run / upgrade) or unlock.
import { h } from '../dom.js';
import * as vault from '../vault.js';
import { strengthMeter, estimate } from '../strength.js';

export function lockView(onUnlocked) {
  const creating = !vault.hasVault();
  const upgrading = creating && vault.hasLegacyData();
  const p1 = h('input', { class: 'input', type: 'password', autocomplete: creating ? 'new-password' : 'current-password', placeholder: creating ? `New app passphrase (${vault.MIN_APP_PASSPHRASE}+ characters)` : 'App passphrase', 'aria-label': 'App passphrase' });
  const p2 = creating ? h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Type it again', 'aria-label': 'Repeat passphrase' }) : null;
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn-primary wide', type: 'submit' }, creating ? 'Create passphrase & continue' : 'Unlock');
  const fail = (t) => { msg.className = 'error-text small'; msg.textContent = t; btn.disabled = false; };

  const form = h('form', { class: 'stack', autocomplete: 'off' }, p1, creating ? strengthMeter(p1) : null, p2, msg, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = p1.value;
    if (creating) {
      if (v.length < vault.MIN_APP_PASSPHRASE) return fail(`Use at least ${vault.MIN_APP_PASSPHRASE} characters.`);
      if (v !== p2.value) return fail('The two passphrases don’t match.');
      if (estimate(v).score < 2) return fail('That passphrase is too easy to guess. Try 4 random words.');
    } else if (!v) return fail('Enter your passphrase.');
    btn.disabled = true; msg.className = 'muted small'; msg.textContent = creating ? 'Encrypting…' : 'Unlocking…';
    try {
      if (creating) await vault.create(v); else await vault.unlock(v);
      const weak = !creating && (v.length < vault.MIN_APP_PASSPHRASE || estimate(v).score < 2);
      p1.value = ''; if (p2) p2.value = '';
      onUnlocked({ weak, created: creating });
    } catch (err) { fail(err.message); p1.select(); }
  });

  const forgot = creating ? null : h('button', { class: 'btn-link small', type: 'button', onclick: () => {
    if (!confirm('Forgotten your passphrase? The only way back in is to ERASE all Hoop Tracker data on this phone. You can restore it afterwards from sync or an encrypted backup. Erase now?')) return;
    if (!confirm('Really erase everything on this phone? This cannot be undone.')) return;
    vault.wipe();
    location.reload();
  } }, 'Forgot passphrase?');

  setTimeout(() => p1.focus(), 50);
  return h('section', { class: 'view lock' },
    h('div', { class: 'lock-badge', 'aria-hidden': 'true', text: '🔒' }),
    h('h2', { class: 'center', text: creating ? (upgrading ? 'Protect your data' : 'Welcome to Hoop Tracker') : 'Hoop Tracker is locked' }),
    h('p', { class: 'muted center', text: creating
      ? `${upgrading ? 'Your sessions will now be encrypted on this phone. ' : ''}Choose an app passphrase. You'll enter it each time you open the app. It can't be recovered if you forget it, so pick something memorable.`
      : 'Enter your app passphrase to unlock your data.' }),
    h('div', { class: 'panel' }, form),
    forgot ? h('div', { class: 'center' }, forgot) : null);
}
