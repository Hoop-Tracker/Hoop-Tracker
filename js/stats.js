import { POSITIONS, ZONES, positionById } from './court.js';

export const pct = (made, att) => (att ? Math.round((made / att) * 100) : null);
export const fmtPct = (made, att) => (att ? `${pct(made, att)}%` : '–');
const DAY = 86400000;

export const isShooting = (s) => s.kind !== 'freethrow';
export const isFT = (s) => s.kind === 'freethrow';

// Totals for one session. zone: 'all' | zone id | 'ft' | 'pos:<id>'
export function sessionTotals(session, zone = 'all') {
  let made = 0, att = 0;
  for (const [pos, list] of Object.entries(session.shots)) {
    const p = positionById(pos);
    if (!p) continue;
    if (zone === 'all' ? p.zone === 'ft' : zone.startsWith('pos:') ? pos !== zone.slice(4) : p.zone !== zone) continue;
    att += list.length;
    made += list.filter(Boolean).length;
  }
  return { made, att };
}

const blank = () => ({ made: 0, att: 0 });

// Aggregate shooting sessions: per position, per zone, overall (free throws excluded).
export function aggregate(sessions) {
  const byPos = Object.fromEntries(POSITIONS.map((p) => [p.id, blank()]));
  const byZone = Object.fromEntries(Object.keys(ZONES).map((z) => [z, blank()]));
  const all = blank();
  for (const s of sessions) {
    for (const [pos, list] of Object.entries(s.shots)) {
      const p = positionById(pos);
      if (!p || p.zone === 'ft') continue;
      const m = list.filter(Boolean).length;
      for (const b of [byPos[pos], byZone[p.zone], all]) { b.made += m; b.att += list.length; }
    }
  }
  return { byPos, byZone, all };
}

export const RANGES = [
  { id: 'last', label: 'Last session' },
  { id: 'last5', label: 'Last 5' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

export function sessionsInRange(sessions, range) {
  switch (range) {
    case 'last': return sessions.slice(-1);
    case 'last5': return sessions.slice(-5);
    case 'last10': return sessions.slice(-10);
    case '30d': { const cut = Date.now() - 30 * DAY; return sessions.filter((s) => Date.parse(s.startedAt) >= cut); }
    default: return sessions;
  }
}

// The comparable window just before the current one, for "change vs last time".
export function previousRange(sessions, range, singleId) {
  if (singleId) {
    const i = sessions.findIndex((s) => s.id === singleId);
    return i > 0 ? { sessions: [sessions[i - 1]], label: 'previous session' } : null;
  }
  switch (range) {
    case 'last': return sessions.length > 1 ? { sessions: sessions.slice(-2, -1), label: 'previous session' } : null;
    case 'last5': return sessions.length > 5 ? { sessions: sessions.slice(-10, -5), label: 'previous 5' } : null;
    case '30d': {
      const t = Date.now();
      const prev = sessions.filter((s) => { const d = Date.parse(s.startedAt); return d < t - 30 * DAY && d >= t - 60 * DAY; });
      return prev.length ? { sessions: prev, label: 'previous 30 days' } : null;
    }
    default: return null;
  }
}

// Percentage-point change, or null when either side has no attempts.
export function delta(cur, prev) {
  if (!prev || !cur.att || !prev.att) return null;
  return Math.round((cur.made / cur.att) * 100 - (prev.made / prev.att) * 100);
}

// Longest run of makes in a list of booleans.
export function longestRun(list) {
  let best = 0, run = 0;
  for (const v of list) { run = v ? run + 1 : 0; if (run > best) best = run; }
  return best;
}
export function currentRun(list) {
  let run = 0;
  for (let i = list.length - 1; i >= 0 && list[i]; i--) run++;
  return run;
}
const flatShots = (s) => Object.values(s.shots).flat();

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export function practiceDayStreaks(sessions) {
  const days = [...new Set(sessions.map((s) => { const d = new Date(s.startedAt); d.setHours(0, 0, 0, 0); return d.getTime(); }))].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = days.at(-1);
  const current = last !== undefined && Math.round((today.getTime() - last) / DAY) <= 1 ? run : 0;
  return { current, longest };
}

export function personalBests(sessions) {
  const shooting = sessions.filter(isShooting), ft = sessions.filter(isFT);
  let bestSession = null, mostShots = null, bestRun = 0;
  for (const s of shooting) {
    const t = sessionTotals(s);
    if (t.att >= 20 && (!bestSession || t.made / t.att > bestSession.made / bestSession.att)) bestSession = { ...t, s };
    if (!mostShots || t.att > mostShots.att) mostShots = { ...t, s };
    bestRun = Math.max(bestRun, longestRun(flatShots(s)));
  }
  const agg = aggregate(shooting);
  let bestSpot = null;
  for (const p of POSITIONS) {
    const r = agg.byPos[p.id];
    if (r.att >= 15 && (!bestSpot || r.made / r.att > bestSpot.made / bestSpot.att)) bestSpot = { ...r, p };
  }
  let ftBest = null, ftRun = 0;
  for (const s of ft) {
    const t = sessionTotals(s, 'ft');
    if (t.att >= 10 && (!ftBest || t.made / t.att > ftBest.made / ftBest.att)) ftBest = { ...t, s };
    ftRun = Math.max(ftRun, longestRun(s.shots.ft || []));
  }
  return { bestSession, mostShots, bestRun, bestSpot, ftBest, ftRun, days: practiceDayStreaks(sessions) };
}

export function goalScopeLabel(scope) {
  if (scope === 'all') return 'Overall shooting';
  if (scope === 'ft') return 'Free throws';
  if (scope.startsWith('zone:')) return ZONES[scope.slice(5)]?.label || scope;
  return positionById(scope.slice(4))?.name || scope;
}

export const GOAL_WINDOWS = [
  { id: 'last5', label: 'over last 5 sessions' },
  { id: 'last10', label: 'over last 10 sessions' },
  { id: '30d', label: 'over last 30 days' },
];

export function goalProgress(goal, sessions) {
  const pool = goal.scope === 'ft' ? sessions.filter(isFT) : sessions.filter(isShooting);
  const inWin = sessionsInRange(pool, goal.window);
  const zone = goal.scope === 'all' ? 'all' : goal.scope === 'ft' ? 'ft' : goal.scope.startsWith('zone:') ? goal.scope.slice(5) : goal.scope;
  const t = inWin.reduce((acc, s) => { const x = sessionTotals(s, zone); acc.made += x.made; acc.att += x.att; return acc; }, blank());
  const value = pct(t.made, t.att);
  return { ...t, value, done: value !== null && value >= goal.target };
}

// Miss-direction counts, optionally limited to some spots: { short, long, left, right, total }
export function missCounts(sessions, keep = () => true) {
  const out = { short: 0, long: 0, left: 0, right: 0, total: 0 };
  for (const s of sessions) {
    for (const [pos, arr] of Object.entries(s.misses || {})) {
      if (!keep(pos)) continue;
      for (const d of arr) if (d && d in out) { out[d]++; out.total++; }
    }
  }
  return out;
}

export function durationLabel(s) {
  if (!s.endedAt) return '';
  const mins = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt) - (s.pausedMs || 0)) / 60000);
  if (mins < 1) return '<1 min';
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export const dateLabel = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(iso).toLocaleDateString(undefined, opts);

export const shortDate = (iso) => dateLabel(iso, { weekday: 'short', day: 'numeric', month: 'short',
  ...(new Date(iso).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
export { dayKey };
