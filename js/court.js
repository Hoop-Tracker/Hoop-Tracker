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

// Layups are their own session type: approach side × finishing hand. Kept out of shooting stats.
export const LAYUP_SPOTS = [
  { id: 'y-rr', zone: 'layup', side: 'right', hand: 'right', name: 'Right side, right hand', short: 'RH', x: 368, y: 100 },
  { id: 'y-rl', zone: 'layup', side: 'right', hand: 'left', name: 'Right side, left hand', short: 'LH', x: 368, y: 182 },
  { id: 'y-ll', zone: 'layup', side: 'left', hand: 'left', name: 'Left side, left hand', short: 'LH', x: 132, y: 100 },
  { id: 'y-lr', zone: 'layup', side: 'left', hand: 'right', name: 'Left side, right hand', short: 'RH', x: 132, y: 182 },
  { id: 'y-mr', zone: 'layup', side: 'mid', hand: 'right', name: 'Straight on, right hand', short: 'RH', x: 288, y: 262 },
  { id: 'y-ml', zone: 'layup', side: 'mid', hand: 'left', name: 'Straight on, left hand', short: 'LH', x: 212, y: 262 },
];
export const LAYUP_IDS = new Set(LAYUP_SPOTS.map((p) => p.id));
export const LAYUP_SIDES = [['left', 'Left side'], ['mid', 'Straight on'], ['right', 'Right side']];

const ALL_SPOTS = [...POSITIONS, FT_SPOT, ...LAYUP_SPOTS];
export const zoneLabel = (p) => (p.zone === 'ft' ? 'Free throws' : p.zone === 'layup' ? 'Layups' : ZONES[p.zone]?.label || '');

export const POSITION_IDS = new Set(ALL_SPOTS.map((p) => p.id));
export const positionById = (id) => ALL_SPOTS.find((p) => p.id === id);
// Spots in a session's plan, in walk-through order.
export const planSpots = (plan) => ALL_SPOTS.filter((p) => plan[p.id] > 0);

// ---------- court areas (for the "Areas" / "Sides" heatmap overlays) ----------
// Side comes from a spot's x (screen-left = shooter's left; x = 250 is the middle).
// Inside the arc = close + mid-range spots; beyond = 3-point + deep.
export const sideOf = (p) => (p.x < 250 ? 'left' : p.x > 250 ? 'right' : 'mid');
const inside = (p) => p.zone === 'close' || p.zone === 'mid';
// The 3-point arc meets x = 210 / 290 (the middle strip's edges) at y ≈ 286.6.
const ARC = 'A237.5 237.5 0 0 0';
export const AREAS = [
  { id: 'in-left', label: 'Left, inside the arc', short: 'Left · inside', test: (p) => inside(p) && sideOf(p) === 'left',
    d: `M30 0 L30 142 ${ARC} 210 286.6 L210 0 Z`, lx: 118, ly: 112 },
  { id: 'in-mid', label: 'Middle, inside the arc', short: 'Middle · inside', test: (p) => inside(p) && sideOf(p) === 'mid',
    d: `M210 0 L210 286.6 ${ARC} 290 286.6 L290 0 Z`, lx: 250, ly: 250 },
  { id: 'in-right', label: 'Right, inside the arc', short: 'Right · inside', test: (p) => inside(p) && sideOf(p) === 'right',
    d: `M290 0 L290 286.6 ${ARC} 470 142 L470 0 Z`, lx: 382, ly: 112 },
  { id: 'out-left', label: 'Left, beyond the arc', short: 'Left · 3PT+', test: (p) => !inside(p) && sideOf(p) === 'left',
    d: `M0 0 L30 0 L30 142 ${ARC} 210 286.6 L210 470 L0 470 Z`, lx: 92, ly: 330 },
  { id: 'out-mid', label: 'Middle, beyond the arc', short: 'Middle · 3PT+', test: (p) => !inside(p) && sideOf(p) === 'mid',
    d: `M210 286.6 ${ARC} 290 286.6 L290 470 L210 470 Z`, lx: 250, ly: 372 },
  { id: 'out-right', label: 'Right, beyond the arc', short: 'Right · 3PT+', test: (p) => !inside(p) && sideOf(p) === 'right',
    d: `M290 286.6 ${ARC} 470 142 L470 0 L500 0 L500 470 L290 470 Z`, lx: 408, ly: 330 },
];
export const SIDES = [
  { id: 'left', label: 'Left side', short: 'Left', test: (p) => sideOf(p) === 'left', d: 'M0 0 H250 V470 H0 Z', lx: 125, ly: 250 },
  { id: 'right', label: 'Right side', short: 'Right', test: (p) => sideOf(p) === 'right', d: 'M250 0 H500 V470 H250 Z', lx: 375, ly: 250 },
];

// "Left side" / "Straight on" / "Right side" captions below the layup spots in use.
export function layupSideLabels(g, spots) {
  const at = { left: [132, 236], right: [368, 236], mid: [250, 312] };
  for (const [side, label] of LAYUP_SIDES) {
    if (spots.some((p) => p.side === side)) g.append(svg('text', { x: at[side][0], y: at[side][1], class: 'layup-side', text: label }));
  }
}

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
