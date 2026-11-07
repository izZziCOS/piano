// Note-reading quiz: a note is drawn on a staff; play it on the keyboard.
import { diatonicToMidi, diatonicName, pitchClass, noteName } from './notes.js';
import * as store from './storage.js';
import * as noteStats from './stats.js';

const $ = (id) => document.getElementById(id);

// Diatonic numbers: C4 = 28. The bottom staff line is E4 (30) in treble, G2 (18) in bass.
const CLEFS = {
  treble: { bottom: 30, min: 28, max: 40, glyph: '\u{1D11E}', glyphLine: 31 }, // C4–A5, G-clef on G4
  bass: { bottom: 18, min: 16, max: 28, glyph: '\u{1D122}', glyphLine: 24 }, // E2–C4, F-clef on F3
};

const SPACE = 12; // distance between staff lines
const TOP = 48; // y of the top staff line
const BOTTOM = TOP + 4 * SPACE;
const NOTE_X = 150;

let kb;
let q = null;
let stats = { right: 0, total: 0, streak: 0 };
let advanceTimer = null;

export function init(keyboard) {
  kb = keyboard;
  $('quiz-clef').value = store.get('quizClef', 'treble');
  $('quiz-accidentals').checked = store.get('quizAccidentals', false);
  $('quiz-clef').addEventListener('change', (e) => { store.set('quizClef', e.target.value); next(); });
  $('quiz-accidentals').addEventListener('change', (e) => { store.set('quizAccidentals', e.target.checked); next(); });
  $('quiz-skip').addEventListener('click', () => {
    if (q && !q.answered) { stats.total++; stats.streak = 0; renderStats(); }
    next();
  });
  $('quiz-reset').addEventListener('click', () => {
    stats = { right: 0, total: 0, streak: 0 };
    renderStats();
  });
  renderStats();
}

export function enter() {
  if (!q) next();
  else if (q.missed) kb.mark(q.midi, 'target');
}

export function exit() {
  kb.clear('target');
}

function rand(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function next() {
  clearTimeout(advanceTimer);
  kb.clear('target');
  const setting = $('quiz-clef').value;
  const clefName = setting === 'both' ? (Math.random() < 0.5 ? 'treble' : 'bass') : setting;
  const clef = CLEFS[clefName];
  // Every note in range (plus sharps/flats if enabled), weighted so that notes
  // you miss come back more often (spaced repetition, see stats.js).
  const candidates = [];
  for (let d = clef.min; d <= clef.max; d++) {
    const letter = d % 7;
    const accs = [0];
    if ($('quiz-accidentals').checked) {
      // Skip E♯, B♯, F♭, C♭: valid, but confusing for beginners.
      if (letter !== 2 && letter !== 6) accs.push(1);
      if (letter !== 0 && letter !== 3) accs.push(-1);
    }
    for (const a of accs) {
      const m = diatonicToMidi(d, a);
      if (q && m === q.midi && clefName === q.clefName) continue;
      candidates.push({ dia: d, acc: a, midi: m });
    }
  }
  const { dia, acc, midi } = noteStats.pickWeighted(candidates, (c) =>
    noteStats.weight(clefName, diatonicName(c.dia, c.acc)) * (c.acc ? 0.6 : 1));

  q = { clefName, clef, dia, acc, midi, answered: false, missed: false, shownAt: performance.now() };
  $('quiz-staff').innerHTML = drawStaff(q);
  $('quiz-staff').setAttribute('aria-label', `${clefName} clef staff showing a note`);
  setPrompt('Play this note on the piano. Any octave counts.');
}

function setPrompt(text, tone = '') {
  const el = $('quiz-prompt');
  el.textContent = text;
  el.dataset.tone = tone;
}

function renderStats() {
  const best = store.get('quizBestStreak', 0);
  if (stats.streak > best) store.set('quizBestStreak', stats.streak);
  $('quiz-score').textContent = `${stats.right} / ${stats.total}`;
  $('quiz-streak').textContent = stats.streak;
  $('quiz-best').textContent = Math.max(best, stats.streak);
}

export function onNote(midi) {
  if (!q || q.answered) return;
  const name = diatonicName(q.dia, q.acc);
  if (pitchClass(midi) === pitchClass(q.midi)) {
    q.answered = true;
    kb.flash(midi, 'correct', 600);
    kb.clear('target');
    if (!q.missed) {
      recordAnswer(true);
      stats.right++;
      stats.total++;
      stats.streak++;
      setPrompt(`Correct, that’s ${name}.`, 'good');
    } else {
      setPrompt(`That’s it: ${name}.`, 'good');
    }
    renderStats();
    $('quiz-staff').querySelector('.notehead')?.classList.add('good');
    advanceTimer = setTimeout(next, 900);
  } else {
    kb.flash(midi, 'wrong', 500);
    if (!q.missed) {
      recordAnswer(false);
      q.missed = true;
      stats.total++;
      stats.streak = 0;
      renderStats();
    }
    kb.mark(q.midi, 'target');
    kb.reveal(q.midi);
    setPrompt(`You played ${noteName(midi, { octave: false, flats: q.acc < 0 })}. This note is ${name}, now highlighted. Play it to continue.`, 'bad');
  }
}

function drawStaff({ clef, dia, acc }) {
  const y = (d) => BOTTOM - (d - clef.bottom) * (SPACE / 2);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    parts.push(`<line class="staff-line" x1="10" x2="250" y1="${TOP + i * SPACE}" y2="${TOP + i * SPACE}"/>`);
  }
  // Ledger lines sit on even steps from the staff's bottom/top line.
  const top = clef.bottom + 8;
  for (let d = clef.bottom - 2; d >= dia; d -= 2) parts.push(ledger(y(d)));
  for (let d = top + 2; d <= dia; d += 2) parts.push(ledger(y(d)));

  const glyphSize = SPACE * 4;
  parts.push(`<text class="clef" x="16" y="${y(clef.glyphLine)}" font-size="${glyphSize}">${clef.glyph}</text>`);

  const ny = y(dia);
  const stemUp = dia < clef.bottom + 4; // below the middle line: stem up
  parts.push(stemUp
    ? `<line class="stem" x1="${NOTE_X + 6.6}" x2="${NOTE_X + 6.6}" y1="${ny - 1}" y2="${ny - 3.5 * SPACE}"/>`
    : `<line class="stem" x1="${NOTE_X - 6.6}" x2="${NOTE_X - 6.6}" y1="${ny + 1}" y2="${ny + 3.5 * SPACE}"/>`);
  parts.push(`<ellipse class="notehead" cx="${NOTE_X}" cy="${ny}" rx="7.4" ry="5.4" transform="rotate(-20 ${NOTE_X} ${ny})"/>`);
  if (acc) {
    parts.push(`<text class="accidental" x="${NOTE_X - 24}" y="${ny + 5}" font-size="${SPACE * 1.6}">${acc > 0 ? '♯' : '♭'}</text>`);
  }
  return `<svg viewBox="0 0 260 150" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

function ledger(y) {
  return `<line class="staff-line" x1="${NOTE_X - 13}" x2="${NOTE_X + 13}" y1="${y}" y2="${y}"/>`;
}

function recordAnswer(right) {
  noteStats.record(q.clefName, diatonicName(q.dia, q.acc), right, performance.now() - q.shownAt);
}
