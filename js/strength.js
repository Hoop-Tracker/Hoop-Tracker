// Rough passphrase strength estimate (no external libraries). It errs on the side of
// "weak": common words, keyboard runs and repeats count for little.
import { h } from './dom.js';

const COMMON = ['password', 'passphrase', 'qwerty', 'letmein', 'welcome', 'basketball', 'hoops', 'hoop', 'tracker',
  'admin', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'lakers', 'warriors', 'celtics', 'bulls', 'jordan',
  'lebron', 'kobe', 'curry', 'abc', '123', 'shoot', 'ball', 'nba', 'game', 'team'];

export function estimate(pass) {
  if (!pass) return { bits: 0, score: 0, label: '' };
  let p = pass.toLowerCase();
  for (const w of COMMON) p = p.split(w).join('§'); // a common word counts as a single symbol
  p = p.replace(/(.)\1{2,}/g, '$1$1');               // aaaa → aa
  p = p.replace(/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/g, '§');
  let pool = 0;
  if (/[a-z]/.test(pass)) pool += 26;
  if (/[A-Z]/.test(pass)) pool += 26;
  if (/\d/.test(pass)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pass)) pool += 20;
  const words = pass.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  // Character-based estimate, discounted; random-word passphrases get credit per word.
  const charBits = [...p].length * Math.log2(Math.max(pool, 10)) * 0.55;
  const wordBits = words >= 3 ? words * 11 : 0;
  const bits = Math.round(Math.max(charBits, wordBits));
  const score = bits < 35 ? 1 : bits < 50 ? 2 : bits < 65 ? 3 : 4;
  return { bits, score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

// A meter that follows an input's value.
export function strengthMeter(input) {
  const bar = h('span', { class: 'strength-bar' });
  const text = h('span', { class: 'strength-text' });
  const el = h('div', { class: 'strength', 'aria-live': 'polite' }, h('span', { class: 'strength-track' }, bar), text);
  const update = () => {
    const r = estimate(input.value);
    el.dataset.score = String(r.score);
    bar.style.width = `${r.score * 25}%`;
    text.textContent = r.label ? `${r.label}${r.score < 3 ? ': try 4 random words' : ''}` : '';
  };
  input.addEventListener('input', update);
  update();
  return el;
}
