// Note-reading quiz: a note is drawn on a staff; play it on the keyboard.
// Shows how fast you answer (average time and correct notes per minute), and
// can run as a 1- or 2-minute speed test that is charted on the Progress page.
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
const fresh = () => ({ right: 0, total: 0, streak: 0, times: [], activeMs: 0 });
let stats = fresh(); // times: ms to a right first answer; activeMs: time spent on questions
let advanceTimer = null;
let test = null; // timed speed test: { seconds, start, clock, done }

export function init(keyboard) {
  kb = keyboard;
  $('quiz-clef').value = store.get('quizClef', 'treble');
  $('quiz-accidentals').checked = store.get('quizAccidentals', false);
  // A speed test starts over when its settings change (each setting has its own record).
  $('quiz-clef').addEventListener('change', (e) => { store.set('quizClef', e.target.value); if (test) resetSession(); next(); });
  $('quiz-accidentals').addEventListener('change', (e) => { store.set('quizAccidentals', e.target.checked); if (test) resetSession(); next(); });
  $('quiz-timer').value = String(store.get('quizTimer', 0));
  $('quiz-timer').addEventListener('change', (e) => { store.set('quizTimer', +e.target.value); resetSession(); next(); });
  $('quiz-skip').addEventListener('click', () => {
    if (test?.done) return;
    if (q && !q.answered) {
      stats.total++;
      stats.streak = 0;
      stats.activeMs += performance.now() - q.shownAt;
      renderStats();
    }
    next();
  });
  $('quiz-reset').addEventListener('click', () => { resetSession(); next(); });
  $('quiz-result').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="again"]')) { resetSession(); next(); }
  });
  resetSession();
}

export function enter() {
  if (!q) next();
  else if (q.missed) kb.mark(q.midi, 'target');
}

export function exit() {
  kb.clear('target');
  // Leaving in the middle of a speed test cancels it.
  if (test?.start && !test.done) { resetSession(); q = null; }
}

const timerSeconds = () => +$('quiz-timer').value;

/** Start counting from zero (score, times and any speed test). */
function resetSession() {
  clearInterval(test?.clock);
  stats = fresh();
  const seconds = timerSeconds();
  test = seconds ? { seconds, start: 0, clock: 0, done: false } : null;
  $('quiz-result').hidden = true;
  renderClock();
  renderStats();
}

function renderClock() {
  const el = $('quiz-clock');
  el.hidden = !test;
  if (!test) return;
  const left = Math.ceil(timeLeft());
  const t = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.textContent = test.start ? t : `${t} · speed test: the clock starts with your first note`;
}

const timeLeft = () => (!test?.start ? test?.seconds ?? 0 : Math.max(0, test.seconds - (performance.now() - test.start) / 1000));

function startClock() {
  test.start = performance.now();
  test.clock = setInterval(() => {
    renderClock();
    if (timeLeft() <= 0) finishTest();
  }, 250);
}

function finishTest() {
  clearInterval(test.clock);
  clearTimeout(advanceTimer);
  test.done = true;
  kb.clear('target');
  renderClock();
  const minutes = test.seconds / 60;
  const npm = Math.round(stats.right / minutes);
  const accuracy = Math.round((stats.right / Math.max(1, stats.total)) * 100);
  const key = `quiz:${$('quiz-clef').value}${$('quiz-accidentals').checked ? '+acc' : ''}:${test.seconds}`;
  const best = store.get('bestSpeed', {});
  const isBest = stats.right > 0 && npm > (best[key] ?? 0);
  if (isBest) store.set('bestSpeed', { ...best, [key]: npm });
  if (stats.total) noteStats.recordSpeed({ npm, accuracy, seconds: test.seconds, piece: 'quiz' });
  setPrompt('Time’s up!');
  const avg = average(stats.times);
  $('quiz-result').hidden = false;
  $('quiz-result').innerHTML = `
    <p class="result-stars">⏱</p>
    <p><strong>${npm} correct ${npm === 1 ? 'note' : 'notes'} per minute</strong> · ${accuracy}% accuracy${isBest ? ' · new record' : best[key] ? ` · best ${best[key]}` : ''}</p>
    <p class="muted small">${avg ? `About ${(avg / 1000).toFixed(1)} s per correct note. ` : ''}Your speed tests are charted on the Progress page.</p>
    <div class="btn-row center">
      <button class="btn" data-action="again">Go again</button>
      <a class="btn btn-ghost" href="#progress">See progress</a>
    </div>`;
}

const average = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

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
  const avg = average(stats.times);
  $('quiz-time').textContent = avg ? `${(avg / 1000).toFixed(1)} s` : '–';
  // Untimed: correct notes per minute of answering time. Timed: per minute of the test.
  const minutes = test?.start ? (performance.now() - test.start) / 60000 : stats.activeMs / 60000;
  // Wait for a few answers so the first one doesn't produce a wild number.
  $('quiz-npm').textContent = stats.right >= 3 && minutes > 0 ? Math.round(stats.right / minutes) : '–';
}

export function onNote(midi) {
  if (!q || q.answered || test?.done) return;
  if (test && !test.start) {
    // The clock starts now: count this question from here, not from when it appeared.
    startClock();
    q.shownAt = performance.now();
  }
  const name = diatonicName(q.dia, q.acc);
  if (pitchClass(midi) === pitchClass(q.midi)) {
    const ms = performance.now() - q.shownAt;
    q.answered = true;
    stats.activeMs += ms;
    kb.flash(midi, 'correct', 600);
    kb.clear('target');
    if (!q.missed) {
      recordAnswer(true);
      stats.right++;
      stats.total++;
      stats.streak++;
      stats.times.push(ms);
      setPrompt(`Correct, that’s ${name} · ${(ms / 1000).toFixed(1)} s`, 'good');
    } else {
      setPrompt(`That’s it: ${name}.`, 'good');
    }
    renderStats();
    q.el?.classList.add('right');
    advanceTimer = setTimeout(next, test ? 250 : 900);
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
