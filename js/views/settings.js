import { h } from '../dom.js';
import * as store from '../store.js';
import { getSettings, updateSettings, TEAMS, TEAM_LABELS, MODES, AUTO_LOCK, ROTATE, REST_OPTIONS } from '../settings.js';
import { APP_VERSION } from '../version.js';
import { strengthMeter, estimate } from '../strength.js';
import { sessionsToCSV } from '../csv.js';
import * as vault from '../vault.js';
import { voiceSupported } from '../voice.js';
import * as sync from '../sync.js';
import { ui, render, toast, openSheet, stepper } from '../ui.js';
import { makeEncryptedBackup, backupKind, restoreEncryptedBackup } from '../backup.js';

const toggle = (label, on, onChange, hint) => {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: on });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle-row' }, h('span', {}, h('span', { text: label }), hint ? h('span', { class: 'muted small block', text: hint }) : null), input);
};

export function settingsView() {
  const s = getSettings();
  const modes = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Colour mode' },
    MODES.map((m) => h('button', { role: 'radio', 'aria-checked': String(s.mode === m.id), onclick: () => { updateSettings({ mode: m.id }); render(); } }, m.label)));

  const teams = h('div', { class: 'team-grid', role: 'radiogroup', 'aria-label': 'Team colourway' },
    TEAMS.map((t) => {
      const sw = h('span', { class: 'team-swatch', 'aria-hidden': 'true' }, h('span', {}), h('span', {}));
      sw.children[0].style.background = t.primary; // CSSOM writes are allowed by our CSP
      sw.children[1].style.background = t.secondary;
      return h('button', { class: 'team', role: 'radio', 'aria-checked': String(s.team === t.id), onclick: () => { updateSettings({ team: t.id }); render(); } },
        sw, h('span', { text: TEAM_LABELS[t.id] }));
    }));

  return h('section', { class: 'view settings' },
    h('div', { class: 'card stack' }, h('h3', { text: 'Colour mode' }), modes),
    h('div', { class: 'card' }, h('h3', { text: 'Team colours' }), teams,
      h('p', { class: 'muted small hint', text: 'Changes buttons, the painted key and finished spots. Make/miss stay green and red so they’re always easy to read.' })),
    h('div', { class: 'card stack' }, h('h3', { text: 'Practice' }),
      h('div', { class: 'row-between' },
        h('span', {}, 'Default shots per spot', h('span', { class: 'muted small block', text: 'Used for standard sessions and new drill spots' })),
        stepper(s.defaultShots, { min: 1, max: 50, label: 'default shots per spot', onChange: (v) => updateSettings({ defaultShots: v }) })),
      toggle('Hands-free voice entry', s.handsFree, (v) => { updateSettings({ handsFree: v }); render(); },
        voiceSupported ? 'Say your results after each spot, e.g. “3 makes, missed shots 2 and 5”.' : 'Not supported in this browser.'),
      s.handsFree ? toggle('Speak results back', s.speakBack, (v) => updateSettings({ speakBack: v }), 'Confirms what it heard and announces the next spot.') : null,
      s.handsFree ? h('p', { class: 'muted small', text: 'Privacy: your phone’s speech service turns your voice into text. On Android (Chrome) that is Google’s service; on iPhone it’s Apple’s. Only the words go to the app.' }) : null,
      toggle('Miss direction', s.missDir, (v) => updateSettings({ missDir: v }),
        'After a miss, tap short, long, left or right. You can also add directions after a session in Edit shots & misses.'),
      h('div', { class: 'row-between' },
        h('span', {}, 'Rest timer between spots', h('span', { class: 'muted small block', text: 'Counts down after each spot; skip any time' })),
        (() => {
          const sel = h('select', { class: 'select compact narrow', 'aria-label': 'Rest timer' },
            REST_OPTIONS.map((v) => h('option', { value: String(v), text: v ? `${v} s` : 'Off', selected: s.restSecs === v })));
          sel.addEventListener('change', () => updateSettings({ restSecs: Number(sel.value) }));
          return sel;
        })())),
    securityCard(),
    syncCard(),
    ...dataCards(),
    h('p', { class: 'muted small center', text: `Hoop Tracker v${APP_VERSION}` }),
  );
}

// ---------- security ----------
const MONTH = 30.44 * 86400000;
const ageText = (iso) => {
  if (!iso) return 'not recorded';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : `${Math.round(days / 30.44)} months ago`;
};
const overdue = (iso) => {
  const m = getSettings().rotateMonths;
  return !!(m && iso && Date.now() - Date.parse(iso) > m * MONTH);
};

// Names of secrets due for a change, used for the reminder on unlock.
export function rotationDue() {
  const due = [];
  if (overdue(vault.meta().appPassSetAt)) due.push('app passphrase');
  if (sync.isConfigured()) {
    const c = sync.getConfig();
    if (overdue(c.passphraseSetAt)) due.push('team passphrase');
    if (overdue(c.tokenSetAt)) due.push('GitHub token');
  }
  return due;
}

function securityCard() {
  const s = getSettings();
  const c = sync.getConfig();
  const row = (label, iso, action, onClick, extra) => h('div', { class: 'sec-row' },
    h('div', {},
      h('div', { text: label }),
      h('div', { class: overdue(iso) ? 'error-text small' : 'muted small', text: `${overdue(iso) ? '⚠ Due for a change · ' : ''}Changed ${ageText(iso)}` }),
      extra ? h('div', { class: 'muted small', text: extra } ) : null),
    h('button', { class: 'btn-secondary', onclick: onClick }, action));
  const select = (opts, value, onChange, label) => {
    const el = h('select', { class: 'select', 'aria-label': label }, opts.map((o) => h('option', { value: String(o.id), text: o.label, selected: o.id === value })));
    el.addEventListener('change', () => onChange(Number(el.value)));
    return el;
  };
  const graceNote = c.prevPassphrase && c.prevUntil && Date.parse(c.prevUntil) > Date.now()
    ? `Old team passphrase still accepted for reading until ${new Date(c.prevUntil).toLocaleDateString()}.` : null;
  return h('div', { class: 'card stack' },
    h('h3', { text: 'Security' }),
    row('App passphrase', vault.meta().appPassSetAt, 'Change', changeAppPassSheet),
    sync.isConfigured() ? row('Team passphrase', c.passphraseSetAt, 'Change', changeTeamPassSheet, graceNote) : null,
    sync.isConfigured() ? row('GitHub access token', c.tokenSetAt, 'Replace', syncSheet, 'Fine-grained tokens expire. Replace it before the expiry date you chose.') : null,
    h('label', { class: 'field-label', text: 'Lock the app' }),
    select(AUTO_LOCK, s.autoLock, (v) => updateSettings({ autoLock: v }), 'Auto-lock'),
    h('label', { class: 'field-label', text: 'Remind me to change passphrases and token' }),
    select(ROTATE, s.rotateMonths, (v) => { updateSettings({ rotateMonths: v }); render(); }, 'Change reminder'),
    h('button', { class: 'btn-ghost', onclick: async () => { await vault.flush(); location.reload(); } }, '🔒 Lock now'));
}

function changeAppPassSheet() {
  openSheet((close) => {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Current app passphrase' });
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: `New passphrase (at least ${vault.MIN_APP_PASSPHRASE} characters)` });
    const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Type the new one again' });
    const msg = h('p', { class: 'small', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn-primary' }, 'Change passphrase');
    const fail = (t) => { msg.className = 'error-text small'; msg.textContent = t; btn.disabled = false; };
    btn.addEventListener('click', async () => {
      if (p1.value.length < vault.MIN_APP_PASSPHRASE) return fail(`Use at least ${vault.MIN_APP_PASSPHRASE} characters.`);
      if (p1.value !== p2.value) return fail('The new passphrases don’t match.');
      if (estimate(p1.value).score < 2) return fail('That passphrase is too easy to guess. Try 4 random words.');
      if (p1.value === cur.value) return fail('Choose a different passphrase from the current one.');
      btn.disabled = true; msg.className = 'muted small'; msg.textContent = 'Re-encrypting…';
      try { await vault.changePassphrase(cur.value, p1.value); close(); toast('App passphrase changed.'); render(); } catch (e) { fail(e.message); }
    });
    return [h('h2', { text: 'Change app passphrase' }),
      h('p', { class: 'muted small', text: 'This only affects this phone. Your data is re-encrypted with the new passphrase.' }),
      cur, p1, strengthMeter(p1), p2, msg, h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'), btn)];
  });
}

function changeTeamPassSheet() {
  openSheet((close) => {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Current team passphrase' });
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: `New team passphrase (at least ${sync.MIN_PASSPHRASE} characters)` });
    const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Type the new one again' });
    const msg = h('p', { class: 'small', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn-primary' }, 'Change & re-encrypt');
    const fail = (t) => { msg.className = 'error-text small'; msg.textContent = t; btn.disabled = false; };
    btn.addEventListener('click', async () => {
      if (p1.value !== p2.value) return fail('The new passphrases don’t match.');
      if (estimate(p1.value).score < 2) return fail('That passphrase is too easy to guess. Try 4 random words.');
      if (!navigator.onLine) return fail('You need to be online to change the team passphrase.');
      btn.disabled = true; msg.className = 'muted small'; msg.textContent = 'Re-encrypting and uploading…';
      try {
        const r = await sync.changeTeamPassphrase(cur.value, p1.value);
        close();
        toast(r.ok ? 'Team passphrase changed. Tell everyone the new one in person.' : r.message, 5000);
        render();
      } catch (e) { fail(e.message); }
    });
    return [h('h2', { text: 'Change team passphrase' }),
      h('ol', { class: 'steps small' },
        h('li', { text: 'Agree the new passphrase with everyone in person (not via GitHub).' }),
        h('li', { text: 'The first person changes it here. Your synced file is re-encrypted with the new key and the old copy is deleted.' }),
        h('li', { text: 'Everyone else then changes it on their phones too (current = old, new = the agreed one).' }),
        h('li', { text: 'For 30 days you can still see anyone who hasn’t switched yet. After that, they’ll disappear until they update.' })),
      cur, p1, strengthMeter(p1), p2, msg, h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'), btn)];
  });
}

// ---------- sync ----------
function syncCard() {
  if (!sync.isConfigured()) {
    return h('div', { class: 'card stack' },
      h('h3', { text: 'Sync & friends' }),
      h('p', { class: 'muted', text: 'Keep your sessions on all your devices and see your friends’ shooting through a private GitHub repository you all share. Everything is encrypted with a team passphrase before it leaves the phone.' }),
      h('button', { class: 'btn-primary', onclick: syncSheet }, 'Set up sync'));
  }
  const c = sync.getConfig();
  const friends = sync.getFriends();
  const names = Object.keys(friends).sort();
  const status = sync.isSyncing() ? 'Syncing…' : c.lastSync ? `Last synced ${new Date(c.lastSync).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet';
  return h('div', { class: 'card stack' },
    h('h3', { text: 'Sync & friends' }),
    h('p', {}, h('strong', { text: c.player }), h('span', { class: 'muted', text: ` → ${c.owner}/${c.repo}` })),
    h('p', { class: 'good-text small', text: '🔒 End-to-end encrypted. Sessions, notes, names and dates are scrambled before they leave this phone.' }),
    h('p', { class: 'muted small', text: status }),
    c.lastError ? h('p', { class: 'error-text small', text: `⚠ ${c.lastError}` }) : null,
    c.reviewIds.length ? h('div', { class: 'review' },
      h('strong', { text: `⚠ Sync wants to delete ${c.reviewIds.length} of your sessions` }),
      h('p', { class: 'small', text: 'Another device (or someone with access to the repository) removed them. If you didn’t delete them yourself, keep them.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn-primary', onclick: async () => { const r = await sync.resolveDeletions('keep'); toast(r?.message || 'Kept.', 3500); render(); } }, 'Keep them'),
        h('button', { class: 'btn-ghost danger', onclick: async () => {
          if (!confirm(`Delete ${c.reviewIds.length} sessions from this phone too?`)) return;
          const r = await sync.resolveDeletions('delete'); toast(r?.message || 'Deleted.', 3500); render();
        } }, 'Delete them'))) : null,
    names.length ? h('p', { class: 'small', text: `Friends: ${names.map((n) => `${n} (${friends[n].sessions.length} sessions)`).join(', ')}` })
      : h('p', { class: 'muted small', text: 'No friends synced yet. They’ll appear once they connect to the same repository.' }),
    h('div', { class: 'card-actions' },
      h('button', { class: 'btn-ghost', onclick: syncSheet }, 'Edit'),
      h('button', { class: 'btn-ghost danger', onclick: () => {
        if (!confirm('Disconnect sync on this device? Your sessions stay on this phone and in the repository.')) return;
        sync.disconnect(); ui.player = 'me'; ui.compare = ''; render();
      } }, 'Disconnect'),
      h('button', { class: 'btn-primary', disabled: sync.isSyncing(), onclick: async () => {
        const p = sync.syncNow(); render(); const r = await p; toast(r.message, 3500); render();
      } }, 'Sync now')));
}

function syncSheet() {
  const c = sync.getConfig();
  openSheet((close) => {
    const field = (label, input, hint) => [h('label', { class: 'field-label', text: label }), input, hint ? h('p', { class: 'muted small', text: hint }) : null];
    const owner = h('input', { class: 'input', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. my-hoops-team', value: c.owner });
    const repo = h('input', { class: 'input', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. hoops-data', value: c.repo });
    const player = h('input', { class: 'input', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. jettson', value: c.player, maxlength: 23 });
    const token = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: c.token ? '•••••••• (saved, leave blank to keep)' : 'github_pat_…' });
    // The team passphrase is chosen here only at first setup; later changes go through Security.
    const settingUp = !c.passphrase;
    const pass = settingUp ? h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: `Required, at least ${sync.MIN_PASSPHRASE} characters` }) : null;
    const pass2 = settingUp ? h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Type it again' }) : null;
    const msg = h('p', { class: 'small', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn-primary' }, 'Test & save');
    btn.addEventListener('click', async () => {
      const next = {
        owner: owner.value.trim(), repo: repo.value.trim(), player: player.value.trim().toLowerCase(),
        token: token.value.trim() || c.token, passphrase: settingUp ? pass.value : c.passphrase,
      };
      if (settingUp) {
        const fail = (t) => { msg.className = 'error-text small'; msg.textContent = t; };
        if (next.passphrase.length < sync.MIN_PASSPHRASE) return fail(`The team passphrase must be at least ${sync.MIN_PASSPHRASE} characters. Four random words works well.`);
        if (next.passphrase !== pass2.value) return fail('The two team passphrases don’t match.');
        if (estimate(next.passphrase).score < 2) return fail('That team passphrase is too easy to guess. Try 4 random words.');
      }
      btn.disabled = true; msg.className = 'muted small'; msg.textContent = 'Checking with GitHub and preparing encryption keys…';
      const r = await sync.testConnection(next);
      btn.disabled = false;
      if (!r.ok) { msg.className = 'error-text small'; msg.textContent = r.message; return; }
      sync.setConfig(next);
      close();
      toast(`${r.message} Syncing…`, 3000);
      render();
      const res = await sync.syncNow();
      toast(res.message, 3500);
      render();
    });
    return [
      h('h2', { text: 'Sync & friends' }),
      h('details', { class: 'howto' }, h('summary', { text: 'How to set this up (one time, ~10 minutes)' }),
        h('ol', {},
          h('li', { text: 'Create free GitHub accounts (one each).' }),
          h('li', { text: 'One of you creates a free organisation (github.com → + → New organization → Free) and invites the others.' }),
          h('li', { text: 'In the organisation, create a PRIVATE repository, e.g. “hoops-data”.' }),
          h('li', { text: 'Each person: Settings → Developer settings → Fine-grained tokens → Generate. Resource owner: the organisation. Only select repositories: hoops-data. Permissions: Contents → Read and write. Copy the token.' }),
          h('li', { text: `Agree on a team passphrase (at least ${sync.MIN_PASSPHRASE} characters, e.g. four random words) and enter the same one on every phone.` }))),
      ...field('Organisation (or GitHub username)', owner),
      ...field('Private repository name', repo),
      ...field('Your player name', player, 'Lowercase letters, numbers and dashes. Each person needs a different one.'),
      ...field('Access token', token, 'Stays on this device. Only used to talk to GitHub.'),
      ...(settingUp
        ? [...field('Team passphrase', pass, 'Encrypts everything (data, names, dates) before it leaves the phone. Everyone uses the same one. Share it in person, and never put it in GitHub. If it’s lost, synced copies can’t be read, but each phone keeps its own data.'), strengthMeter(pass), pass2]
        : [h('p', { class: 'muted small', text: 'To change the team passphrase, use Settings → Security.' })]),
      msg,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'), btn),
    ];
  });
}

// ---------- backup ----------
function passphraseSheet({ title, hint, action, confirmTwice, allowBlank = false, run }) {
  openSheet((close) => {
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: allowBlank ? 'Blank = team passphrase' : `At least ${sync.MIN_PASSPHRASE} characters` });
    const p2 = confirmTwice ? h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Type it again' }) : null;
    const msg = h('p', { class: 'small', 'aria-live': 'polite' });
    const btn = h('button', { class: 'btn-primary' }, action);
    btn.addEventListener('click', async () => {
      const v = p1.value;
      const fail = (t) => { msg.className = 'error-text small'; msg.textContent = t; };
      if (!(allowBlank && !v) && v.length < (confirmTwice ? sync.MIN_PASSPHRASE : 1)) return fail(`Use at least ${sync.MIN_PASSPHRASE} characters.`);
      if (p2 && v !== p2.value) return fail('The two passphrases don’t match.');
      btn.disabled = true; msg.className = 'muted small'; msg.textContent = 'Working… (this takes a second)';
      try { await run(v); close(); } catch (e) { btn.disabled = false; fail(e.message || 'Something went wrong.'); }
    });
    return [h('h2', { text: title }), h('p', { class: 'muted small', text: hint }), p1, p2, msg,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'), btn)];
  });
}

function dataCards() {
  const n = store.getSessions().length;
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const imported = ({ added, skipped }) => {
    toast(`Imported ${added} session${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already here)` : ''}.`);
    render();
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 20_000_000) { toast('File is too large.'); return; }
    const text = await f.text();
    const kind = backupKind(text);
    if (!kind) { toast('This file is not a Hoop Tracker backup.'); return; }
    if (kind === 'plain') {
      try { imported(store.importJSON(text)); } catch (e) { toast(e.message); }
      return;
    }
    passphraseSheet({
      title: 'Unlock backup', confirmTwice: false, action: 'Unlock & import',
      hint: 'Enter the passphrase used when this backup was made.',
      run: async (pass) => imported(await restoreEncryptedBackup(text, pass)),
    });
  });
  const exportData = () => passphraseSheet({
    title: 'Encrypted backup', confirmTwice: true, action: 'Create backup',
    hint: `The backup file is encrypted. You'll need this passphrase to restore it${sync.isConfigured() ? '. Leave it blank to use your team passphrase' : ''}.`,
    allowBlank: sync.isConfigured(),
    run: async (pass) => {
      const text = await makeEncryptedBackup(pass || sync.getConfig().passphrase);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `hoop-tracker-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Encrypted backup saved.');
    },
  });
  return [
    h('div', { class: 'card' },
      h('h3', { text: 'Your data' }),
      h('ul', { class: 'bullets' },
        h('li', { text: 'No account with us, no server, no tracking. The app can only talk to GitHub, and only if you set up sync.' }),
        h('li', { text: 'Sessions, notes, drills, goals, friends’ data and your sync settings are encrypted on this phone with your app passphrase. Clearing site data or uninstalling removes them unless you sync or export.' }),
        h('li', { text: 'Everything that leaves the phone (sync files and backup files) is encrypted with a passphrase first.' })),
      h('p', { class: 'muted', text: `${n} saved session${n === 1 ? '' : 's'}, ${store.getDrills().length} drill${store.getDrills().length === 1 ? '' : 's'}, ${store.getGoals().length} goal${store.getGoals().length === 1 ? '' : 's'}.` })),
    h('div', { class: 'card stack' },
      h('h3', { text: 'Backup' }),
      h('button', { class: 'btn-primary', disabled: !n, onclick: exportData }, '🔒 Export encrypted backup'),
      h('button', { class: 'btn-secondary', onclick: () => fileInput.click() }, 'Import backup'),
      fileInput),
    h('div', { class: 'card stack' },
      h('h3', { text: 'Export & delete' }),
      h('p', { class: 'muted small', text: 'Both need you to type a word to confirm, so they can’t happen by accident.' }),
      h('button', { class: 'btn-secondary', disabled: !n, onclick: () => typedConfirm({
        title: 'Export spreadsheet (CSV)',
        body: 'Creates a .csv file of all your sessions to open in Excel or Google Sheets. This file is NOT encrypted: anyone who gets it can read your sessions and notes. Keep it somewhere private and delete it when you’re done.',
        word: 'EXPORT', action: 'Export CSV', danger: false,
        run: () => {
          const blob = new Blob([sessionsToCSV(store.getSessions())], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: `hoop-tracker-sessions-${new Date().toISOString().slice(0, 10)}.csv` });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast('Spreadsheet exported (unencrypted).');
        },
      }) }, '📄 Export spreadsheet (CSV)'),
      h('button', { class: 'btn-ghost danger', disabled: !n && !store.getActive(), onclick: () => typedConfirm({
        title: 'Delete all data',
        body: `Deletes ALL sessions, drills, goals and favourites from this phone. This cannot be undone.${sync.isConfigured()
          ? ' Sync is on, so your synced copy is kept and will download again on the next sync. Disconnect sync first if you want it gone from this phone for good.'
          : ' Consider exporting an encrypted backup first.'}`,
        word: 'DELETE', action: 'Delete everything', danger: true,
        run: () => { store.deleteAll(); ui.range = 'last5'; toast('All data deleted from this device.'); render(); },
      }) }, 'Delete all data')),
  ];
}

// A confirmation sheet that only enables its button once the given word is typed.
function typedConfirm({ title, body, word, action, danger, run }) {
  openSheet((close) => {
    const input = h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: `Type ${word}`, 'aria-label': `Type ${word} to confirm` });
    const btn = h('button', { class: danger ? 'btn-primary danger-fill' : 'btn-primary', disabled: true }, action);
    input.addEventListener('input', () => { btn.disabled = input.value.trim().toUpperCase() !== word; });
    btn.addEventListener('click', () => { if (input.value.trim().toUpperCase() !== word) return; close(); run(); });
    return [h('h2', { text: title }), h('p', { class: 'muted', text: body }),
      h('label', { class: 'field-label' }, 'To confirm, type ', h('strong', { text: word })), input,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn-ghost', onclick: close }, 'Cancel'), btn)];
  });
}
