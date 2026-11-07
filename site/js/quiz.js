// Note-reading quiz: a note is drawn on a staff; play it on the keyboard.
import { diatonicToMidi, diatonicName, pitchClass, noteName } from './notes.js';
import * as store from './storage.js';
import * as noteStats from './stats.js';
import { buildScore, renderScore } from './sheet.js';

const $ = (id) => document.getElementById(id);

// Diatonic numbers: C4 = 28.
const CLEFS = {
  treble: { min: 28, max: 40 }, // C4–A5
  bass: { min: 16, max: 28 }, // E2–C4
};


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
  drawStaff(q);
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
    q.el?.classList.add('right');
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

/** Draw the note with VexFlow, the same engine as the rest of the sheet music. */
function drawStaff({ clefName, dia, acc }) {
  const name = diatonicName(dia, acc).replace('♯', '#').replace('♭', 'b');
  const piece = { id: 'quiz', key: 'C', time: '4/4', [clefName === 'treble' ? 'rh' : 'lh']: `${name}:4` };
  const score = buildScore(piece);
  renderScore($('quiz-staff'), score, { showTime: false, center: true });
  q.el = Object.values(score.hands)[0][0].el;
}

function recordAnswer(right) {
  noteStats.record(q.clefName, diatonicName(q.dia, q.acc), right, performance.now() - q.shownAt);
}
