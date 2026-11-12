// Half-court geometry. Units are tenths of a foot (NBA dimensions):
// court is 50 ft wide (500) by 47 ft deep (470); the baseline is at the top.
import { svg } from './dom.js';

export const COURT_W = 500;
export const COURT_H = 470;
export const HOOP = { x: 250, y: 52.5 };
export const MAX_SHOTS_PER_SPOT = 50;

export const ZONES = {
  close: { label: 'Close' },
  mid: { label: 'Mid-range' },
  three: { label: '3-point' },
  deep: { label: 'Deep' },
};

// Order matters: it is the default walk-through order during a session.
// Screen-left is the shooter's left when facing the hoop.
export const POSITIONS = [
  { id: 'c-l', zone: 'close', name: 'Left block', short: 'LB', x: 192, y: 82 },
  { id: 'c-m', zone: 'close', name: 'Middle of key', short: 'MK', x: 250, y: 128 },
  { id: 'c-r', zone: 'close', name: 'Right block', short: 'RB', x: 308, y: 82 },

  { id: 'm-lb', zone: 'mid', name: 'Left baseline (mid)', short: 'LBL', x: 98, y: 60 },
  { id: 'm-lw', zone: 'mid', name: 'Left wing (mid)', short: 'LW', x: 140, y: 166 },
  { id: 'm-t', zone: 'mid', name: 'Free-throw line', short: 'FT', x: 250, y: 205 },
  { id: 'm-rw', zone: 'mid', name: 'Right wing (mid)', short: 'RW', x: 360, y: 166 },
  { id: 'm-rb', zone: 'mid', name: 'Right baseline (mid)', short: 'RBL', x: 402, y: 60 },

  { id: 't-lc', zone: 'three', name: 'Left corner 3', short: 'LC3', x: 12, y: 58 },
  { id: 't-lw', zone: 'three', name: 'Left wing 3', short: 'LW3', x: 66, y: 244 },
  { id: 't-t', zone: 'three', name: 'Top of key 3', short: 'T3', x: 250, y: 318 },
  { id: 't-rw', zone: 'three', name: 'Right wing 3', short: 'RW3', x: 434, y: 244 },
  { id: 't-rc', zone: 'three', name: 'Right corner 3', short: 'RC3', x: 488, y: 58 },

  { id: 'd-l', zone: 'deep', name: 'Deep left', short: 'DL', x: 100, y: 396 },
  { id: 'd-c', zone: 'deep', name: 'Half court', short: 'HC', x: 250, y: 440 },
  { id: 'd-r', zone: 'deep', name: 'Deep right', short: 'DR', x: 400, y: 396 },
];

// Free throws are tracked separately from the 16-spot shooting rotation.
export const FT_SPOT = { id: 'ft', zone: 'ft', name: 'Free throws', short: 'FT', x: 250, y: 190 };
const ALL_SPOTS = [...POSITIONS, FT_SPOT];

export const POSITION_IDS = new Set(ALL_SPOTS.map((p) => p.id));
export const positionById = (id) => ALL_SPOTS.find((p) => p.id === id);
// Spots in a session's plan, in walk-through order.
export const planSpots = (plan) => ALL_SPOTS.filter((p) => plan[p.id] > 0);

// Draws the court lines into the given <svg>; returns the group that spots go into.
export function drawCourt(root) {
  root.setAttribute('viewBox', '-30 -24 560 518');
  root.setAttribute('role', 'img');
  root.classList.add('court');

  const lines = svg('g', { class: 'court-lines' });
  lines.append(
    svg('rect', { x: 0, y: 0, width: COURT_W, height: COURT_H, class: 'court-floor' }),
    // Key / paint
    svg('rect', { x: 170, y: 0, width: 160, height: 190, class: 'court-paint' }),
    // Free-throw circle: solid half outside the key, dashed half inside
    svg('path', { d: 'M190 190 A60 60 0 0 0 310 190' }),
    svg('path', { d: 'M190 190 A60 60 0 0 1 310 190', class: 'dashed' }),
    // Restricted area
    svg('path', { d: 'M210 40 L210 52.5 A40 40 0 0 0 290 52.5 L290 40' }),
    // Three-point line: straight corners, then the arc (23.75 ft from hoop)
    svg('path', { d: 'M30 0 L30 142 A237.5 237.5 0 0 0 470 142 L470 0' }),
    // Half-court line + centre circle
    svg('path', { d: 'M190 470 A60 60 0 0 1 310 470' }),
    // Lane hash marks
    ...[70, 80, 110, 140].flatMap((y) => [
      svg('line', { x1: 160, y1: y, x2: 170, y2: y }),
      svg('line', { x1: 330, y1: y, x2: 340, y2: y }),
    ]),
  );

  const hoop = svg('g', { class: 'court-hoop' });
  hoop.append(
    svg('line', { x1: 220, y1: 40, x2: 280, y2: 40, class: 'backboard' }),
    svg('line', { x1: 250, y1: 40, x2: 250, y2: 45 }),
    svg('circle', { cx: HOOP.x, cy: HOOP.y, r: 7.5, class: 'rim' }),
  );

  const spots = svg('g', { class: 'spots' });
  root.replaceChildren(lines, hoop, spots);
  return spots;
}
