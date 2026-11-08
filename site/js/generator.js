// Random sheet-music generator for reading practice, plus a "weak notes"
// sheet built from your statistics. Notes are chosen with spaced-repetition
// weights (stats.js), so notes you miss come back more often.
import { weight, pickWeighted, weakest } from './stats.js';

// Number of sharps (+) or flats (−) in each key signature.
export const KEYS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Ab: -4,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, Dm: -1, Gm: -2, Cm: -3, Fm: -4,
};
export const isMinor = (key) => key.endsWith('m');

const LETTERS = 'CDEFGAB';
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';
const INVALID = new Set(['E#', 'B#', 'Cb', 'Fb']); // valid, but confusing; we avoid them

// Diatonic ranges (C4 = 28) for each clef.
export const RANGES = {
  staff: { treble: [30, 38], bass: [18, 26] }, // on the staff only
  ledger: { treble: [26, 42], bass: [14, 30] }, // up to two ledger lines
  wide: { treble: [24, 44], bass: [12, 32] }, // up to three or four ledger lines
};

export const DEFAULTS = {
  clef: 'treble', // treble | bass | grand
  keys: 'easy', // c | easy (≤1 ♯/♭) | medium (≤2) | hard (≤4)
  mode: 'major', // major | minor | both
  range: 'staff',
  rhythm: 'simple', // simple | varied
  chords: false,
  accidentals: false,
  time: '4/4', // 4/4 | 3/4 | mixed
  bars: 8,
};
const MAX_ACC = { c: 0, easy: 1, medium: 2, hard: 4 };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function keyAccidentals(key) {
  const n = KEYS[key];
  const map = {};
  for (let i = 0; i < Math.abs(n); i++) map[n > 0 ? SHARP_ORDER[i] : FLAT_ORDER[i]] = n > 0 ? '#' : 'b';
  return map;
}

const nameOf = (dia, acc) => `${LETTERS[dia % 7]}${acc}${Math.floor(dia / 7)}`;

// Rhythm patterns: [durations, weight]. Each one fills whole beats so beams group sensibly.
const SIMPLE = [[[1], 5], [[2], 2], [[3], 1], [[4], 0.5]];
const VARIED = [
  [[1], 4], [[2], 1.5], [[0.5, 0.5], 3], [[1.5, 0.5], 1.5], [[0.25, 0.25, 0.25, 0.25], 1],
  [[0.5, 0.25, 0.25], 1], [[0.75, 0.25], 0.7], [[3], 0.5], [[4], 0.3],
];

function rhythmFor(barLen, style, longer = false) {
  const out = [];
  let left = barLen;
  while (left > 0) {
    const fits = (style === 'varied' ? VARIED : SIMPLE).filter(([p]) => {
      const total = p.reduce((a, b) => a + b, 0);
      if (total > left) return false;
      if (total === 3 && barLen !== 3) return false; // dotted halves only fill a 3/4 bar
      if (total === 4 && left !== 4) return false;
      return true;
    });
    const [pattern] = pickWeighted(fits, ([p, w]) => (longer && p[0] >= 2 ? w * 4 : w));
    out.push(...pattern);
    left -= pattern.reduce((a, b) => a + b, 0);
  }
  return out;
}

function line(clefName, key, opts, barLen) {
  const [lo, hi] = RANGES[opts.range][clefName];
  const accs = keyAccidentals(key);
  const minor = isMinor(key);
  const leading = minor ? LETTERS[(LETTERS.indexOf(key[0]) + 6) % 7] : null;
  const tokens = [];
  let prev = Math.round((lo + hi) / 2);

  for (let b = 0; b < opts.bars; b++) {
    const rhythm = rhythmFor(barLen, opts.rhythm, clefName === 'bass' && opts.clef === 'grand');
    for (const beats of rhythm) {
      if (opts.rhythm === 'varied' && beats < 4 && Math.random() < 0.1) {
        tokens.push(`R:${beats}`);
        continue;
      }
      // Candidate notes in range, favouring steps (like real melodies) and weak notes.
      const candidates = [];
      for (let d = lo; d <= hi; d++) {
        const letter = LETTERS[d % 7];
        let acc = accs[letter] ?? '';
        if (minor && letter === leading && Math.random() < 0.35) acc = acc === 'b' ? '' : '#'; // harmonic minor
        if (opts.accidentals && Math.random() < 0.12) acc = acc ? '' : pick(['#', 'b']);
        if (INVALID.has(letter + acc)) acc = accs[letter] ?? '';
        candidates.push({ d, acc });
      }
      const c = pickWeighted(candidates, ({ d, acc }) => {
        const dist = Math.abs(d - prev);
        const shape = dist === 0 ? 0.6 : dist <= 2 ? 3 : dist <= 4 ? 1.4 : 0.5;
        return shape * weight(clefName, nameOf(d, acc));
      });
      prev = c.d;
      const names = [nameOf(c.d, c.acc)];
      if (opts.chords && beats >= 1 && Math.random() < 0.3) {
        // Add a third, sometimes a triad, using the key signature's notes.
        for (const step of Math.random() < 0.5 ? [2] : [2, 4]) {
          const d = c.d + step;
          if (d > hi + 2) break;
          names.push(nameOf(d, accs[LETTERS[d % 7]] ?? ''));
        }
      }
      tokens.push(`${names.join('+')}:${beats}`);
    }
    tokens.push('|');
  }
  if (opts.rhythm === 'varied') addTies(tokens);
  return tokens.join(' ');
}

/** Now and then, tie the last note of a bar into a repeat of it at the start of the next. */
function addTies(tokens) {
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i] !== '|' || Math.random() > 0.2) continue;
    const prev = tokens[i - 1];
    const nextIdx = i + 1;
    const next = tokens[nextIdx];
    if (!next || next === '|' || prev.startsWith('R') || next.startsWith('R') || prev.includes('+') || next.includes('+')) continue;
    const [prevNote] = prev.split(':');
    const nextBeats = next.split(':')[1];
    tokens[i - 1] = `${prev}~`;
    tokens[nextIdx] = `${prevNote}:${nextBeats}`;
  }
}

/** Build a random piece from settings (see DEFAULTS). */
export function randomSheet(settings) {
  const opts = { ...DEFAULTS, ...settings };
  const keys = Object.keys(KEYS).filter((k) => {
    if (Math.abs(KEYS[k]) > MAX_ACC[opts.keys]) return false;
    if (opts.mode === 'major') return !isMinor(k);
    if (opts.mode === 'minor') return isMinor(k);
    return true;
  });
  const key = pick(keys);
  const time = opts.time === 'mixed' ? pick(['4/4', '3/4']) : opts.time;
  const barLen = time === '3/4' ? 3 : 4;
  const piece = { key, time };
  if (opts.clef !== 'bass') piece.rh = line('treble', key, opts, barLen);
  if (opts.clef !== 'treble') piece.lh = line('bass', key, opts, barLen);
  return piece;
}

/**
 * A sheet made of the notes you get wrong most. Returns null if there isn't
 * enough history yet.
 */
export function weakSheet() {
  const weak = weakest(14);
  if (weak.length < 3) return null;
  const piece = { key: 'C', time: '4/4', weakNotes: weak };
  for (const [hand, clef] of [['rh', 'treble'], ['lh', 'bass']]) {
    const names = weak.filter((w) => w.clef === clef).map((w) => w.name);
    if (!names.length) continue;
    const tokens = [];
    let prev = null;
    for (let i = 0; i < 24; i++) {
      const options = names.length > 1 ? names.filter((n) => n !== prev) : names;
      prev = pickWeighted(options, (n) => weight(clef, n));
      tokens.push(`${prev}:1`);
      if (i % 4 === 3) tokens.push('|');
    }
    piece[hand] = tokens.join(' ');
  }
  // Two hands would play the same beats together; that's fine for reading.
  return piece;
}

// ------------------------------------------------------------ sharing
//
// A random sheet can be shared as a link. The notes themselves go in the link
// (compressed), not a random seed: which notes come up depends on each
// person's own statistics, so the same seed would give someone else a
// different sheet.

const MAX_LINE = 4000;
const LINE_CHARS = /^[A-Ga-g0-9R#+:.~|!@\s-]*$/;

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** A sheet's notes as a short, URL-safe code. */
export async function encodeSheet({ key, time, rh, lh }) {
  const json = JSON.stringify({ key, time, rh, lh });
  return toBase64Url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

/** The sheet in a code from encodeSheet(), or null if it isn't a valid one. */
export async function decodeSheet(code) {
  try {
    if (!/^[\w-]{1,6000}$/.test(code)) return null;
    const json = new TextDecoder().decode(await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw')));
    const { key, time, rh, lh } = JSON.parse(json);
    const line = (v) => v === undefined || (typeof v === 'string' && v.length <= MAX_LINE && LINE_CHARS.test(v));
    if (!(key in KEYS) || !['4/4', '3/4'].includes(time) || !line(rh) || !line(lh) || !(rh || lh)) return null;
    return { key, time, ...(rh ? { rh } : {}), ...(lh ? { lh } : {}) };
  } catch {
    return null;
  }
}
