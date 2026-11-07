// Ear training: hear a note, an interval or a short melody, then name it or
// play it back on the piano.
import { noteName, pitchClass } from './notes.js';
import * as audio from './audio.js';
import * as store from './storage.js';
import * as stats from './stats.js';

const $ = (id) => document.getElementById(id);

const INTERVALS = {
  1: { name: 'Minor 2nd', song: 'the “Jaws” theme' },
  2: { name: 'Major 2nd', song: '“Happy Birthday” (first two notes)' },
  3: { name: 'Minor 3rd', song: '“Greensleeves” (first two notes)' },
  4: { name: 'Major 3rd', song: '“When the Saints Go Marching In”' },
  5: { name: 'Perfect 4th', song: '“Here Comes the Bride”' },
  6: { name: 'Tritone', song: '“Maria” from West Side Story' },
  7: { name: 'Perfect 5th', song: '“Twinkle, Twinkle” (first jump)' },
  8: { name: 'Minor 6th', song: '“The Entertainer” (the jump up after the opening)' },
  9: { name: 'Major 6th', song: '“My Bonnie Lies over the Ocean”' },
  10: { name: 'Minor 7th', song: '“Somewhere” from West Side Story' },
  11: { name: 'Major 7th', song: '“Take On Me” (chorus jump)' },
  12: { name: 'Octave', song: '“Somewhere over the Rainbow”' },
};
const INTERVAL_SETS = { easy: [2, 4, 5, 7, 12], medium: [2, 3, 4, 5, 7, 9, 12], all: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

let kb;
let q = null;
let score = { right: 0, total: 0, streak: 0 };
let stopSound = null;

const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function init(keyboard) {
  kb = keyboard;
  for (const id of ['ear-type', 'ear-level', 'ear-direction']) {
    $(id).value = store.get(id, $(id).value);
    $(id).addEventListener('change', () => { store.set(id, $(id).value); applyType(); next(); });
  }
  $('ear-reference').checked = store.get('ear-reference', true);
  $('ear-reference').addEventListener('change', () => store.set('ear-reference', $('ear-reference').checked));
  $('ear-play').addEventListener('click', () => play());
  $('ear-next').addEventListener('click', () => {
    if (q && !q.answered) { score.total++; score.streak = 0; renderScore(); }
    next();
  });
  $('ear-reveal').addEventListener('click', reveal);
  $('ear-answers').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-semis]');
    if (b) answerInterval(+b.dataset.semis, b);
  });
  applyType();
  renderScore();
}

export function enter() {
  if (!q) next();
}

export function exit() {
  stopSound?.();
  kb.clear('target');
}

const type = () => $('ear-type').value;

function applyType() {
  const t = type();
  $('view-ear').dataset.type = t;
  const level = $('ear-level');
  const options = t === 'interval'
    ? [['easy', 'Easy: 2nds, 3rds, 4th, 5th, octave'], ['medium', 'Medium: + minor 3rd, major 6th'], ['all', 'All twelve']]
    : t === 'note'
      ? [['white', 'White keys, one octave'], ['chromatic', 'All 12 notes, one octave'], ['wide', 'All notes, three octaves']]
      : [['3', '3 notes'], ['4', '4 notes'], ['5', '5 notes']];
  const current = level.value;
  level.innerHTML = options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  level.value = options.some(([v]) => v === current) ? current : options[0][0];
}

function renderScore() {
  const key = `earBest:${type()}`;
  const best = Math.max(store.get(key, 0), score.streak);
  store.set(key, best);
  $('ear-score').textContent = `${score.right} / ${score.total}`;
  $('ear-streak').textContent = score.streak;
  $('ear-best').textContent = best;
}

function setStatus(text, tone = '') {
  $('ear-status').textContent = text;
  $('ear-status').dataset.tone = tone;
}

function next() {
  stopSound?.();
  kb.clear('target');
  const t = type();
  const level = $('ear-level').value;
  if (t === 'note') {
    const pool = [];
    const [lo, hi] = level === 'wide' ? [48, 83] : [60, 71];
    for (let m = lo; m <= hi; m++) if (level !== 'white' || C_MAJOR.includes(pitchClass(m))) pool.push(m);
    const options = pool.filter((m) => m !== q?.midi);
    q = { type: t, midi: pick(options), answered: false, missed: false };
    setStatus('Listen, then find the note on the piano. Any octave counts.');
  } else if (t === 'interval') {
    const semis = pick(INTERVAL_SETS[level]);
    const dir = $('ear-direction').value === 'mixed' ? pick(['up', 'down', 'together']) : $('ear-direction').value;
    const low = rand(55, 72 - (dir === 'down' ? 0 : 0));
    q = { type: t, semis, dir, low, answered: false, missed: false };
    $('ear-answers').innerHTML = INTERVAL_SETS[level]
      .map((s) => `<button class="btn btn-ghost" data-semis="${s}">${INTERVALS[s].name}</button>`).join('');
    setStatus('Which interval is it?');
  } else {
    const len = +level;
    const notes = [pick([60, 62, 64, 65, 67])];
    // Steps and small skips within C major, like a simple tune.
    while (notes.length < len) {
      const prev = notes[notes.length - 1];
      const choices = [-4, -3, -2, -1, 1, 2, 3, 4].map((d) => stepFrom(prev, d)).filter((m) => m >= 55 && m <= 79);
      notes.push(pick(choices));
    }
    q = { type: t, notes, pos: 0, mistakes: 0, answered: false, missed: false };
    setStatus(`Listen, then play the ${len} notes back. The first note is ${noteName(notes[0])}, shown on the piano.`);
    kb.mark(notes[0], 'target');
    kb.reveal(notes[0]);
  }
  q.shownAt = performance.now();
  play();
}

/** Move `d` steps along the C major scale from `midi`. */
function stepFrom(midi, d) {
  const oct = Math.floor(midi / 12);
  let idx = C_MAJOR.indexOf(pitchClass(midi)) + d;
  const o = oct + Math.floor(idx / 7);
  idx = ((idx % 7) + 7) % 7;
  return o * 12 + C_MAJOR[idx];
}

function play() {
  if (!q) return;
  stopSound?.();
  const t0 = audio.now() + 0.1;
  const notes = [];
  if (q.type === 'note') {
    let at = t0;
    if ($('ear-reference').checked) {
      notes.push({ midi: 60, at, dur: 0.7, velocity: 0.55 });
      at += 1.1;
    }
    notes.push({ midi: q.midi, at, dur: 1.2, velocity: 0.7 });
  } else if (q.type === 'interval') {
    const [a, b] = q.dir === 'down' ? [q.low + q.semis, q.low] : [q.low, q.low + q.semis];
    if (q.dir === 'together') {
      notes.push({ midi: a, at: t0, dur: 1.6, velocity: 0.6 }, { midi: b, at: t0, dur: 1.6, velocity: 0.6 });
    } else {
      notes.push({ midi: a, at: t0, dur: 0.75, velocity: 0.65 }, { midi: b, at: t0 + 0.8, dur: 1.1, velocity: 0.65 });
    }
  } else {
    q.notes.forEach((m, i) => notes.push({ midi: m, at: t0 + i * 0.55, dur: 0.5, velocity: 0.65 }));
  }
  stopSound = audio.schedule({ notes });
}

function done(right, message) {
  q.answered = true;
  score.total++;
  if (right && !q.missed) { score.right++; score.streak++; } else score.streak = 0;
  stats.logPractice(1);
  renderScore();
  setStatus(message, right && !q.missed ? 'good' : 'bad');
  setTimeout(() => { if (q?.answered) next(); }, right && !q.missed ? 1300 : 2600);
}

export function onNote(midi) {
  if (!q || q.answered) return;
  if (q.type === 'note') {
    if (pitchClass(midi) === pitchClass(q.midi)) {
      kb.flash(midi, 'correct', 600);
      done(true, q.missed ? `That’s it: ${noteName(q.midi, { octave: false })}.` : `Correct: ${noteName(q.midi, { octave: false })}.`);
    } else {
      kb.flash(midi, 'wrong');
      q.missed = true;
      setStatus(`Not ${noteName(midi, { octave: false })}. Listen again (▶ Play) and keep trying.`, 'bad');
    }
  } else if (q.type === 'melody') {
    const want = q.notes[q.pos];
    if (midi === want) {
      kb.flash(midi, 'correct');
      kb.clear('target');
      q.pos++;
      if (q.pos === q.notes.length) {
        done(q.mistakes === 0, q.mistakes === 0
          ? 'Perfect, every note right.'
          : `You got there with ${q.mistakes} ${q.mistakes === 1 ? 'mistake' : 'mistakes'}: ${q.notes.map((m) => noteName(m)).join(' ')}.`);
        if (q.mistakes) q.missed = true;
      } else setStatus(`${q.pos} of ${q.notes.length}…`);
    } else {
      kb.flash(midi, 'wrong');
      q.mistakes++;
      q.missed = true;
      setStatus(`Note ${q.pos + 1} isn’t ${noteName(midi)}. Try again, or press ▶ Play to hear it again.`, 'bad');
    }
  }
}

function answerInterval(semis, btn) {
  if (!q || q.type !== 'interval' || q.answered) return;
  const right = semis === q.semis;
  btn.classList.add(right ? 'is-right' : 'is-wrong');
  if (!right) {
    q.missed = true;
    setStatus(`Not a ${INTERVALS[semis].name.toLowerCase()}. Listen again and try another.`, 'bad');
    return;
  }
  const info = INTERVALS[q.semis];
  done(true, `${q.missed ? 'That’s it' : 'Correct'}: ${info.name}. Think of ${info.song}.`);
}

function reveal() {
  if (!q || q.answered) return;
  q.missed = true;
  if (q.type === 'note') {
    kb.mark(q.midi, 'target');
    kb.reveal(q.midi);
    setStatus(`It was ${noteName(q.midi)}. Play it to continue.`, 'bad');
  } else if (q.type === 'interval') {
    const info = INTERVALS[q.semis];
    $('ear-answers').querySelector(`[data-semis="${q.semis}"]`)?.classList.add('is-right');
    done(false, `It was a ${info.name.toLowerCase()}. Think of ${info.song}.`);
  } else {
    kb.mark(q.notes.slice(q.pos), 'target');
    kb.reveal(q.notes);
    setStatus(`The melody: ${q.notes.map((m) => noteName(m)).join(' ')}. Play it to continue.`, 'bad');
  }
}
