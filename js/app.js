// Boot: theme, lock screen, then views, tabs, auto-lock, background sync.
import { $, h } from './dom.js';
import { APP_VERSION, CHANGELOG } from './version.js';
import { applyTheme, getSettings, initSettings } from './settings.js';
import * as vault from './vault.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { ui, registerView, render, setTab, toast, openSheet } from './ui.js';
import { lockView } from './views/lock.js';
import { practiceView } from './views/practice.js';
import { drillsView } from './views/drills.js';
import { progressView } from './views/progress.js';
import { settingsView, rotationDue } from './views/settings.js';

applyTheme();
registerView('practice', practiceView);
registerView('drills', drillsView);
registerView('progress', progressView);
registerView('settings', settingsView);

function showLock() {
  document.body.classList.add('locked');
  $('#main').replaceChildren(lockView(start));
}

function start({ weak = false } = {}) {
  initSettings();
  store.init();
  sync.init();
  document.body.classList.remove('locked');
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.onclick = () => { if (b.dataset.tab === 'drills') ui.editingDrill = null; setTab(b.dataset.tab); };
  });
  sync.onStatus(() => { if (ui.tab === 'progress' || ui.tab === 'settings') render(); });
  setTab(store.getActive() ? 'practice' : ui.tab);
  if (sync.isConfigured()) sync.scheduleSync(1500);

  // Update notice: show what changed once per new version, so an unexpected update stands out.
  const seen = vault.meta().lastVersion;
  vault.setMeta({ lastVersion: APP_VERSION });
  if (seen && seen !== APP_VERSION) showUpdateNotice(seen);
  else if (weak) setTimeout(() => toast('🔑 Your app passphrase is shorter or weaker than recommended. Change it in Settings → Security.', 6000), 800);
  else {
    const due = rotationDue();
    if (due.length) setTimeout(() => toast(`🔑 Time to change your ${due.join(' and ')}. See Settings → Security.`, 6000), 800);
  }
}

function showUpdateNotice(from) {
  const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const notes = CHANGELOG.filter((c) => newer(c.v, from)).flatMap((c) => c.notes);
  openSheet((close) => [
    h('h2', { text: `Updated to version ${APP_VERSION}` }),
    h('p', { class: 'muted small', text: `You were on version ${from}. What's new:` }),
    h('ul', { class: 'bullets' }, notes.map((n) => h('li', { text: n }))),
    h('p', { class: 'note', text: 'Didn’t expect an update? Only the person who manages the app’s GitHub repository can publish one. If nobody in your group did, don’t enter any passphrases and check with them first.' }),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-primary', onclick: close }, 'Got it')),
  ]);
}

// Auto-lock: after being away for the chosen time, lock by reloading (which also
// clears the decryption key from memory). Data is flushed to storage first.
let hiddenAt = null;
document.addEventListener('visibilitychange', async () => {
  if (!vault.isUnlocked()) return;
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const mins = getSettings().autoLock;
  if (hiddenAt !== null && Date.now() - hiddenAt >= mins * 60000) {
    await vault.flush();
    location.reload();
  }
  hiddenAt = null;
});

showLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support unavailable */ });
}
