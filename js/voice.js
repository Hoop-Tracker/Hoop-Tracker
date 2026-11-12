// Hands-free entry: speech recognition + a parser for phrases like
// "3 makes, 2 misses", "missed shots 3 and 5", "4 for 5", "make make miss", "undo".
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

const WORD_NUM = { zero: 0, one: 1, won: 1, two: 2, too: 2, three: 3, tree: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const MAKE = new Set(['make', 'makes', 'made', 'hit', 'hits', 'in', 'bucket', 'buckets', 'good', 'yes', 'swish', 'score', 'scored', 'net', 'cash']);
const MISS = new Set(['miss', 'misses', 'missed', 'missing', 'out', 'no', 'brick', 'bricks', 'bricked', 'airball', 'off']);
const LIST_FILLER = new Set(['and', 'shot', 'shots', 'number', 'numbers', 'the', 'on', 'at', 'attempt', 'attempts', 'n']);
const SEQ_FILLER = new Set(['and', 'then', 'a', 'the', 'one', 'it', 'that', 'was', 'shot']);

function normalise(text, total) {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9\s&]/g, ' ').replace(/&/g, ' and ')} `;
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
  t = t.replace(/\b[a-z]+\b/g, (w) => (w in WORD_NUM ? String(WORD_NUM[w]) : w));
  // "first 3" / "last 2" -> explicit shot numbers
  t = t.replace(/\b(first|last) (\d+)\b/g, (_, which, n) => {
    const k = Math.min(Number(n), total);
    const nums = Array.from({ length: k }, (_, i) => (which === 'first' ? i + 1 : total - k + i + 1));
    return ` shots ${nums.join(' and ')} `;
  });
  t = t.replace(/\b(the )?last (one|shot)\b/g, ` shot ${total} `);
  t = t.replace(/\b[a-z]+\b/g, (w) => (w in ORDINAL ? `shot ${ORDINAL[w]}` : w));
  return t.trim().split(/\s+/).filter(Boolean);
}

const isNum = (w) => /^\d+$/.test(w);
const kindOf = (w) => (MAKE.has(w) ? 'make' : MISS.has(w) ? 'miss' : null);

// Returns { action: 'undo' | 'next' } or { shots: boolean[], summary } or { error }.
// done = shots already taken at this spot, total = planned shots at this spot.
export function parseUtterance(text, done, total) {
  const remaining = total - done;
  const raw = ` ${text.toLowerCase()} `;
  if (/\b(undo|scratch that|take (that|it) back|delete)\b/.test(raw)) return { action: 'undo' };
  if (/\b(next|skip|move on)\b/.test(raw)) return { action: 'next' };
  if (remaining <= 0) return { error: 'This spot is already complete.' };

  const w = normalise(text, total);
  const result = (shots) => {
    if (!shots.length) return { error: `Didn't catch that.` };
    if (shots.length > remaining) return { error: `That's ${shots.length} shots but only ${remaining} left here.` };
    const m = shots.filter(Boolean).length;
    // Miss directions said anywhere ("…missed short and left") attach to the misses in order.
    const said = (` ${text.toLowerCase()} `.match(/\b(short|long|left|right)\b/g) || []);
    let k = 0;
    const dirs = shots.map((made) => (!made && k < said.length ? said[k++] : null));
    const dirText = dirs.filter(Boolean).length ? ` (${dirs.filter(Boolean).join(', ')})` : '';
    return { shots, dirs, summary: `${m} make${m === 1 ? '' : 's'}, ${shots.length - m} miss${shots.length - m === 1 ? '' : 'es'}${dirText}` };
  };

  // All in / all out
  const joined = ` ${w.join(' ')} `;
  if (/ (all|every|perfect)\b/.test(joined) && !/ (miss|missed|misses|out|bricks?)\b/.test(joined)) return result(Array(remaining).fill(true));
  if (/ (all|every) (\w+ )?(miss|missed|misses|out|bricks?)\b| (miss|missed) (them |it )?all\b| (none|0 (made|makes|in)|no makes)\b/.test(joined)) return result(Array(remaining).fill(false));

  // Shot-number lists: "missed shots 3 and 5", "made on 1 2 and 4", "shots 2 and 4 missed"
  const idx = { make: new Set(), miss: new Set() };
  for (let i = 0; i < w.length; i++) {
    const k = kindOf(w[i]);
    if (!k) continue;
    // forward: verb [on|at|the|shot(s)]* n [and n]*
    let j = i + 1, keyword = false; const nums = [];
    while (j < w.length && (LIST_FILLER.has(w[j]) || isNum(w[j]))) {
      if (isNum(w[j])) nums.push(Number(w[j])); else if (w[j] !== 'and') keyword = true;
      j++;
    }
    if (nums.length && (keyword || nums.length >= 2)) nums.forEach((n) => idx[k].add(n));
    // backward: shot(s) n [and n]* [were|was] verb
    let b = i - 1; const back = []; let sawShot = false;
    while (b >= 0 && (LIST_FILLER.has(w[b]) || isNum(w[b]) || w[b] === 'were' || w[b] === 'was')) {
      if (isNum(w[b])) back.push(Number(w[b])); if (w[b] === 'shot' || w[b] === 'shots') sawShot = true;
      b--;
    }
    // ...unless that list already belongs to an earlier verb ("made shots 1 2 3 missed …")
    if (sawShot && back.length && (b < 0 || !kindOf(w[b]))) back.forEach((n) => idx[k].add(n));
  }
  const valid = (n) => n > done && n <= total;
  if (idx.miss.size || idx.make.size) {
    const bad = [...idx.miss, ...idx.make].filter((n) => n < 1 || n > total);
    if (bad.length) return { error: `There are only ${total} shots at this spot.` };
    const shots = [];
    for (let n = done + 1; n <= total; n++) {
      if (idx.miss.size) shots.push(!idx.miss.has(n));
      else shots.push(idx.make.has(n));
    }
    if (![...idx.miss, ...idx.make].some(valid)) return { error: 'Those shots are already recorded.' };
    return result(shots);
  }

  // "4 for 5", "4 of 5", "4 out of 5"
  for (let i = 0; i + 2 < w.length; i++) {
    if (isNum(w[i]) && ['for', 'of', 'from'].includes(w[i + 1]) && isNum(w[i + 2])) {
      const m = Number(w[i]), n = Number(w[i + 2]);
      if (m > n) return { error: `Didn't catch that.` };
      return result([...Array(m).fill(true), ...Array(n - m).fill(false)]);
    }
    if (isNum(w[i]) && w[i + 1] === 'out' && w[i + 2] === 'of' && isNum(w[i + 3])) {
      const m = Number(w[i]), n = Number(w[i + 3]);
      if (m > n) return { error: `Didn't catch that.` };
      return result([...Array(m).fill(true), ...Array(n - m).fill(false)]);
    }
  }

  // Counts: "3 makes 2 misses", "made 3", "2 missed"
  let makes = null, misses = null;
  for (let i = 0; i < w.length; i++) {
    const k = kindOf(w[i]);
    if (!k) continue;
    let n = null;
    if (i > 0 && isNum(w[i - 1])) n = Number(w[i - 1]);
    else if (i + 1 < w.length && isNum(w[i + 1])) n = Number(w[i + 1]);
    if (n === null) continue;
    if (k === 'make') makes = (makes || 0) + n; else misses = (misses || 0) + n;
  }
  if (makes !== null || misses !== null) {
    if (makes === null) makes = Math.max(0, remaining - misses);
    if (misses === null) misses = Math.max(0, remaining - makes);
    return result([...Array(makes).fill(true), ...Array(misses).fill(false)]);
  }

  // Sequence of single results: "make", "miss miss make"
  const seq = w.filter((x) => !SEQ_FILLER.has(x) && !/^(short|long|left|right)$/.test(x));
  if (seq.length && seq.every((x) => kindOf(x))) return result(seq.map((x) => kindOf(x) === 'make'));

  return { error: `Didn't catch that.` };
}

// ---------- speech I/O ----------
export class VoiceListener {
  constructor({ onFinal, onInterim, onState }) {
    this.onFinal = onFinal; this.onInterim = onInterim; this.onState = onState;
    this.active = false; this.paused = false; this.rec = null;
  }

  start() {
    if (!SR || this.active) return;
    this.active = true;
    this.#begin();
  }

  #begin() {
    if (!this.active || this.paused) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.onFinal?.(r[0].transcript.trim());
        else this.onInterim?.(r[0].transcript.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; this.onState?.('denied'); }
    };
    rec.onend = () => {
      this.rec = null;
      if (this.active && !this.paused) setTimeout(() => this.#begin(), 250); // browsers stop after silence
      else if (!this.active) this.onState?.('stopped');
    };
    try { rec.start(); this.rec = rec; this.onState?.('listening'); } catch { /* already started */ }
  }

  stop() {
    this.active = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
    this.onState?.('stopped');
  }

  // Speak without hearing ourselves: pause recognition while talking.
  speak(text) {
    if (!('speechSynthesis' in window) || !text) return Promise.resolve();
    return new Promise((resolve) => {
      this.paused = true;
      try { this.rec?.abort(); } catch { /* ignore */ }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = navigator.language || 'en-US';
      u.rate = 1.05;
      const done = () => { this.paused = false; if (this.active) setTimeout(() => this.#begin(), 200); resolve(); };
      u.onend = done; u.onerror = done;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }
}
