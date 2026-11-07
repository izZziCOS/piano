// Per-note reading statistics with a simple Leitner (spaced-repetition) box.
// Keys look like "treble:F#5" or "bass:Bb2". Notes you miss drop to box 1 and
// come back often; notes you name quickly and correctly climb to box 5 and
// show up rarely.
import * as store from './storage.js';

const KEY = 'noteStats';
const SLOW_MS = 5000; // a correct but slow answer doesn't move a note up a box
const DAY = 24 * 60 * 60 * 1000;

let cache = null;
const all = () => (cache ??= store.get(KEY, {}));
const save = () => store.set(KEY, cache);

/** Normalise "F♯5" / "F#5" / "B♭3" to "F#5" / "Bb3". */
export const normalise = (name) => name.replace('♯', '#').replace('♭', 'b');

export function record(clef, name, right, ms = 0) {
  const k = `${clef}:${normalise(name)}`;
  const s = all()[k] ?? { seen: 0, missed: 0, box: 0, last: 0, ms: 0 };
  s.seen++;
  if (!right) s.missed++;
  s.box = right ? (ms && ms > SLOW_MS ? Math.max(1, s.box) : Math.min(5, s.box + 1)) : 1;
  s.ms = s.ms ? Math.round(s.ms * 0.7 + ms * 0.3) : ms;
  s.last = Date.now();
  all()[k] = s;
  save();
  logPractice(1);
}

/** Sampling weight: weak or long-unseen notes come up more often. */
export function weight(clef, name) {
  const s = all()[`${clef}:${normalise(name)}`];
  if (!s) return 1.5; // not seen yet: slightly favoured so everything gets covered
  const base = [1.5, 6, 4, 2, 1, 0.5][s.box];
  const stale = Date.now() - s.last > DAY && s.box < 5 ? 1.5 : 1;
  return base * stale;
}

/** The notes you most need to practise, worst first. */
export function weakest(limit = 8, clef = null) {
  return Object.entries(all())
    .map(([k, s]) => {
      const [c, name] = k.split(':');
      return { clef: c, name, ...s, accuracy: (s.seen - s.missed) / s.seen };
    })
    .filter((s) => (!clef || s.clef === clef) && s.box <= 2 && s.missed > 0)
    .sort((a, b) => a.box - b.box || a.accuracy - b.accuracy || b.missed - a.missed)
    .slice(0, limit);
}

export function summary() {
  const entries = Object.values(all());
  const seen = entries.reduce((n, s) => n + s.seen, 0);
  const missed = entries.reduce((n, s) => n + s.missed, 0);
  return { notes: entries.length, seen, accuracy: seen ? (seen - missed) / seen : 0 };
}

export function reset() {
  cache = {};
  save();
  store.set('noteStatsResetAt', Date.now()); // so sync doesn't bring old stats back
}

/** Re-read everything from storage (after progress was synced from another device). */
export function reload() {
  cache = null;
  listeners.forEach((fn) => fn());
}

/** Weighted random choice. */
export function pickWeighted(items, weightOf) {
  const ws = items.map(weightOf);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ------------------------------------------------------------ practice log
// One entry per day: how many notes were answered or played correctly.
// Used for the daily goal, the streak and the calendar on the Progress page.

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const listeners = new Set();

export function onPractice(fn) { listeners.add(fn); }

/** Count `n` practised notes for today (any mode). */
export function logPractice(n = 1) {
  const log = store.get('practiceLog', {});
  const k = dayKey();
  log[k] = (log[k] ?? 0) + n;
  store.set('practiceLog', log);
  listeners.forEach((fn) => fn());
}

export const getGoal = () => store.get('dailyGoal', 50);
export function setGoal(n) {
  store.set('dailyGoal', n);
  store.set('dailyGoalAt', Date.now()); // the newest choice wins when syncing
  listeners.forEach((fn) => fn());
}

export function today() {
  return store.get('practiceLog', {})[dayKey()] ?? 0;
}

/** Days in a row (ending today, or yesterday if today isn't done yet) that met the goal. */
export function streak() {
  const log = store.get('practiceLog', {});
  const goal = getGoal();
  const d = new Date();
  if ((log[dayKey(d)] ?? 0) < goal) d.setDate(d.getDate() - 1);
  let n = 0;
  while ((log[dayKey(d)] ?? 0) >= goal) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The last `days` days, oldest first: [{ date, notes }]. */
export function recentDays(days = 35) {
  const log = store.get('practiceLog', {});
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  for (let i = 0; i < days; i++) {
    out.push({ date: dayKey(d), notes: log[dayKey(d)] ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ------------------------------------------------------------ speed tests

export function recordSpeed(entry) {
  const list = store.get('speedHistory', []);
  list.push({ at: Date.now(), ...entry });
  store.set('speedHistory', list.slice(-200));
}

export const speedHistory = () => store.get('speedHistory', []);

/** Every note with stats, for the heatmap. */
export function allNotes() {
  return Object.entries(all()).map(([k, s]) => {
    const [clef, name] = k.split(':');
    return { clef, name, ...s, accuracy: (s.seen - s.missed) / s.seen };
  });
}
