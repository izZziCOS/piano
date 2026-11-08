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
  activity();
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

// ------------------------------------------------------------ trouble bars (at tempo)
//
// Spaced repetition for pieces: after every pass in At tempo, each bar that was
// played gets a "trouble" score, the share of its notes that were missed,
// wrong or (counting half) early or late, averaged with its earlier score. Bars
// you keep fumbling stay high and are suggested as the next loop; clean passes
// bring the score down until the suggestion goes away. Stored per piece with a
// fingerprint of its notes, so editing one of your own pieces starts afresh.

const BARS_KEY = 'barStats';
const TROUBLE = 0.2; // below this a bar is fine

/** A short fingerprint of a piece's notes. */
export function pieceSignature(piece) {
  const text = [piece.time, piece.pickup ?? 0, piece.repeat ? 1 : 0, piece.rh ?? '', piece.lh ?? ''].join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function barsOf(piece) {
  const entry = store.get(BARS_KEY, {})[piece.id];
  return entry?.sig === pieceSignature(piece) ? entry.bars : {};
}

/**
 * Record one pass. `results` maps bar index → { notes, errors }, where errors
 * already weighs early/late notes as half a mistake.
 */
export function recordBars(piece, results) {
  const all = store.get(BARS_KEY, {});
  const bars = { ...barsOf(piece) };
  const fixed = [];
  for (const [bar, { notes, errors }] of results) {
    if (!notes) continue;
    const rate = Math.min(1, errors / notes);
    const old = bars[bar];
    bars[bar] = {
      trouble: Math.round((old ? old.trouble * 0.5 + rate * 0.5 : rate) * 1000) / 1000,
      plays: (old?.plays ?? 0) + 1,
    };
    if (old && old.trouble >= TROUBLE && bars[bar].trouble < TROUBLE) fixed.push(bar);
  }
  all[piece.id] = { sig: pieceSignature(piece), at: Date.now(), bars };
  store.set(BARS_KEY, all);
  return fixed;
}

/** Trouble score of every bar played so far: { [bar]: { trouble, plays } }. */
export const barTrouble = (piece) => barsOf(piece);

/**
 * The passage most worth looping: the worst bar, together with a neighbour
 * that is nearly as bad. null if every bar is fine (or nothing is recorded).
 * Returns { from, to, trouble }.
 */
export function troubleSpot(piece, barCount) {
  const bars = barsOf(piece);
  const t = (b) => bars[b]?.trouble ?? 0;
  let worst = -1;
  for (let b = 0; b < barCount; b++) if (t(b) >= TROUBLE && (worst < 0 || t(b) > t(worst))) worst = b;
  if (worst < 0) return null;
  let from = worst;
  let to = worst;
  const left = worst > 0 ? t(worst - 1) : 0;
  const right = worst < barCount - 1 ? t(worst + 1) : 0;
  const neighbour = Math.max(left, right);
  if (neighbour >= TROUBLE && neighbour >= t(worst) / 2) {
    if (left >= right) from = worst - 1;
    else to = worst + 1;
  }
  if (from === 0 && to >= barCount - 1) return null; // that's the whole piece
  return { from, to, trouble: t(worst) };
}

// ------------------------------------------------------------ the week (Progress page)
//
// Practice time: any key played or answer given counts as practising, and the
// time between two of them is added up, unless the gap was over a minute (a
// break). Kept per day in seconds, and written every few seconds rather than
// on every note.

const IDLE = 60 * 1000;
let lastActive = 0;
let pendingMs = 0;
let flushTimer = 0;

/** Note that the player is practising right now. */
export function activity(now = Date.now()) {
  if (lastActive && now - lastActive < IDLE) pendingMs += now - lastActive;
  lastActive = now;
  if (!flushTimer && pendingMs) flushTimer = setTimeout(flushTime, 10000);
}

/** Save the practice time counted so far. */
export function flushTime() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const secs = Math.floor(pendingMs / 1000);
  if (!secs) return;
  pendingMs -= secs * 1000;
  const log = store.get('practiceTime', {});
  log[dayKey()] = (log[dayKey()] ?? 0) + secs;
  store.set('practiceTime', log);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushTime(); });
window.addEventListener('pagehide', flushTime);

/**
 * Things worth celebrating, for the weekly summary:
 * { type: 'stars', id, title, mode, stars, from } when a piece earns more stars,
 * { type: 'fixed', id, title, bars } when a trouble spot is played cleanly enough.
 */
export function addMilestone(entry) {
  const list = store.get('milestones', []);
  list.push({ at: Date.now(), ...entry });
  store.set('milestones', list.slice(-100));
}

/**
 * The last 7 days (today included) and the 7 before, for the summary on the
 * Progress page: { minutes, notes, days, before: { minutes, notes }, milestones, speed }.
 */
export function week(now = new Date()) {
  const time = store.get('practiceTime', {});
  const log = store.get('practiceLog', {});
  const span = (from, to) => {
    let secs = 0;
    let notes = 0;
    let days = 0;
    const d = new Date(now);
    d.setDate(d.getDate() - from);
    for (let i = from; i < to; i++) {
      const k = dayKey(d);
      secs += time[k] ?? 0;
      notes += log[k] ?? 0;
      if (log[k] || time[k]) days++;
      d.setDate(d.getDate() - 1);
    }
    return { minutes: Math.round(secs / 60), notes, days };
  };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const since = start.getTime();
  const milestones = store.get('milestones', []).filter((m) => m.at >= since);
  // Reading speed: the best test this week against the best one before it.
  const tests = speedHistory().filter((h) => h.piece !== 'quiz');
  const best = (list) => (list.length ? Math.max(...list.map((h) => h.npm)) : 0);
  const thisWeek = best(tests.filter((h) => h.at >= since));
  const earlier = best(tests.filter((h) => h.at < since));
  return {
    ...span(0, 7),
    before: span(7, 14),
    milestones,
    speed: thisWeek ? { now: thisWeek, before: earlier } : null,
  };
}
