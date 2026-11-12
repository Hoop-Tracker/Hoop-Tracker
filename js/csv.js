// Spreadsheet export: one row per session per spot. NOT encrypted (by design, it's
// for Excel / Google Sheets), so the UI makes the user confirm explicitly.
import { positionById, planSpots, ZONES } from './court.js';
import { shotTypeLabel } from './store.js';

// Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell).
function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sessionsToCSV(sessions) {
  const head = ['date', 'time', 'session', 'kind', 'shot_type', 'drill_from', 'spot', 'zone', 'planned', 'attempts', 'made', 'pct',
    'miss_short', 'miss_long', 'miss_left', 'miss_right', 'duration_min', 'note'];
  const rows = [head];
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const mins = s.endedAt ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt) - (s.pausedMs || 0)) / 60000) : '';
    for (const p of planSpots(s.plan)) {
      const list = s.shots[p.id] || [];
      if (!list.length) continue;
      const made = list.filter(Boolean).length;
      const dirs = s.misses?.[p.id] || [];
      const count = (k) => dirs.filter((x) => x === k).length;
      rows.push([date, time, s.name, s.kind, s.shotType ? shotTypeLabel(s.shotType) : '', s.drillFrom || '',
        positionById(p.id).name, p.zone === 'ft' ? 'Free throws' : ZONES[p.zone].label, s.plan[p.id], list.length, made,
        Math.round((made / list.length) * 100), count('short'), count('long'), count('left'), count('right'), mins, s.note || '']);
    }
  }
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
