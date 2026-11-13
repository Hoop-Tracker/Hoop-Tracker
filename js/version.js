// App version + what changed. Bump APP_VERSION (and sw.js VERSION) with every release.
// After an update, the app shows these notes once, so an update nobody expected stands out.
export const APP_VERSION = '1.6.0';

export const CHANGELOG = [
  { v: '1.6.0', notes: [
    'Add a location when you finish a session (courts and hoops vary)',
    'Progress: filter by location; edit a session\'s location any time',
    'CSV export includes the location',
    'Sync copes better with future updates: teammates on a newer version no longer stop yours from syncing',
    'New Progress → Shooting page: spot-by-spot trends, zone trends, and breakdowns by location and shot type',
    'Layups: their own session type (left / straight on / right side × left / right hand, plus finish type), kept out of your shooting %',
    'Layup drills, layup goals (both hands, left or right hand) and layup personal bests',
    'Shooting page: compare with a teammate. The heatmap remembers Spots / Areas / Sides',
    'Heatmap: switch between Spots, Areas (left / middle / right, inside and beyond the arc) and Sides (left vs right)',
  ] },
  { v: '1.5.0', notes: [
    'Drills: Mine / Team / Favourites, descriptions and drawn diagrams',
    'Miss direction (short / long / left / right), live or after a session',
    'Rest timer, session pause, practice calendar',
    'CSV export, deletion safeguard for sync, passphrase strength meter',
  ] },
];
