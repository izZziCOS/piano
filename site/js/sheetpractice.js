// Sheet music practice. Three modes:
//  - play:  play the notes on the piano; the music waits for you. Keyboard
//           hints can be always on, fade out as you get notes right, or off.
//  - tempo: play along in time after a count-in; every note is scored as on
//           time, early, late or missed. You can pick a range of bars, loop it,
//           and have the tempo go up after every clean pass.
//  - name:  a reading test; type the name of each highlighted note (e.g. F, F#, Bb).
//           Optionally timed. Every answer feeds the spaced-repetition stats.
import { PIECES } from './pieces.js';
import { buildScore, renderScore } from './sheet.js';
import { randomSheet, weakSheet, DEFAULTS, isMinor } from './generator.js';
import { noteName } from './notes.js';
import * as audio from './audio.js';
import * as store from './storage.js';
import * as stats from './stats.js';
import * as own from './ownpieces.js';

const $ = (id) => document.getElementById(id);
const HAND_LABEL = { rh: 'Right hand', lh: 'Left hand', both: 'Both hands' };
const pretty = (name) => name.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
const keyLabel = (k) => (isMinor(k) ? `${pretty(k.slice(0, -1))} minor` : `${pretty(k)} major`);
/** The built-in library followed by your own pieces. */
const allPieces = () => [...PIECES, ...own.list()];
const findPiece = (id) => allPieces().find((p) => p.id === id);
const BUILDER_FIELDS = ['clef', 'keys', 'mode', 'range', 'rhythm', 'time', 'chords', 'accidentals'];

let kb;
let piece = null; // entry from PIECES (or one of your own pieces)
let source = null; // the notes actually shown (generated pieces differ each time)
let score = null;
let mode = 'play';
let hands = 'both';
let stopListen = null;
let autoTimer = null;
let lastWidth = 0;

// play mode
let idx = 0;
let hit = new Set();
let mistakes = 0;
let done = false;
let cleanStreak = 0; // correct steps in a row without a wrong note (for fading hints)
let stepMistakes = 0;

// tempo mode
let tempo = null; // { expected[], wrong, stopAudio, timers[], spb }
let loop = null; // while looping a passage: { passes, clean, startBpm, timer }

// name mode
let items = [];
let qi = 0;
let typed = '';
let busy = false;
let shownAt = 0;
let session = null; // { right, total, missed[], ms[], start, end, timer }
let clock = null;

export function init(keyboard) {
  kb = keyboard;
  $('sheet-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) load(btn.dataset.id);
  });
  document.querySelectorAll('input[name="sheet-mode"]').forEach((r) => r.addEventListener('change', () => {
    mode = r.value;
    store.set('sheetMode', mode);
    applyMode();
  }));
  $('sheet-hands').addEventListener('change', () => { hands = $('sheet-hands').value; restart(); });
  $('sheet-tempo').addEventListener('input', () => { $('sheet-bpm').textContent = $('sheet-tempo').value; });
  $('sheet-names').checked = store.get('sheetNames', false);
  $('sheet-names').addEventListener('change', () => {
    store.set('sheetNames', $('sheet-names').checked);
    draw();
  });
  $('sheet-timer').value = String(store.get('sheetTimer', 0));
  $('sheet-timer').addEventListener('change', () => {
    store.set('sheetTimer', +$('sheet-timer').value);
    restart();
  });
  $('sheet-hints').value = store.get('sheetHints', 'always');
  $('sheet-hints').addEventListener('change', () => {
    store.set('sheetHints', $('sheet-hints').value);
    showCurrent();
  });
  $('sheet-metronome').checked = store.get('sheetMetronome', true);
  $('sheet-metronome').addEventListener('change', () => store.set('sheetMetronome', $('sheet-metronome').checked));
  $('sheet-start').addEventListener('click', () => (tempo?.running || loop ? restart() : startTempo()));
  // Passage: a range of bars, optionally looped and sped up after each clean pass.
  $('sheet-from').addEventListener('change', () => {
    if (+$('sheet-from').value > +$('sheet-to').value) $('sheet-to').value = $('sheet-from').value;
    markRange();
    restart();
  });
  $('sheet-to').addEventListener('change', () => {
    if (+$('sheet-to').value < +$('sheet-from').value) $('sheet-from').value = $('sheet-to').value;
    markRange();
    restart();
  });
  $('sheet-loop').checked = store.get('sheetLoop', false);
  $('view-sheet').dataset.loop = $('sheet-loop').checked;
  $('sheet-loop').addEventListener('change', () => {
    store.set('sheetLoop', $('sheet-loop').checked);
    $('view-sheet').dataset.loop = $('sheet-loop').checked;
  });
  $('sheet-speedup').value = String(store.get('sheetSpeedup', 4));
  $('sheet-speedup').addEventListener('change', () => store.set('sheetSpeedup', +$('sheet-speedup').value));

  // Your own pieces
  own.init({ onSaved: (id) => load(id) });
  $('own-add').addEventListener('click', () => own.open());
  $('sheet-edit').addEventListener('click', () => piece?.own && own.open(piece));
  $('sheet-delete').addEventListener('click', () => {
    if (!piece?.own || !window.confirm(`Delete “${piece.title}”? This can’t be undone.`)) return;
    own.remove(piece.id);
    load(PIECES.find((p) => !p.generated).id);
  });
  $('sheet-listen').addEventListener('click', toggleListen);
  $('sheet-restart').addEventListener('click', restart);
  $('sheet-new').addEventListener('click', () => load(piece.id));
  $('sheet-result').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'again') restart();
    else if (a === 'new') load(piece.id);
    else if (a === 'weak') load('weak');
    else {
      const list = allPieces();
      load(list[list.findIndex((p) => p.id === piece.id) + 1].id);
    }
  });
  $('sheet-answer').addEventListener('keydown', onAnswerKey);
  // On touch screens use the on-screen buttons instead of popping up the phone keyboard.
  if (window.matchMedia('(pointer: coarse)').matches) $('sheet-answer').setAttribute('inputmode', 'none');
  $('sheet-pad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) answerKey(b.dataset.key);
  });

  // Random sheet builder
  const saved = { ...DEFAULTS, ...store.get('builder', {}) };
  for (const f of BUILDER_FIELDS) {
    const el = $(`gen-${f}`);
    if (el.type === 'checkbox') el.checked = !!saved[f];
    else el.value = saved[f];
    el.addEventListener('change', () => { store.set('builder', builderSettings()); load('random'); });
  }

  new ResizeObserver(() => {
    const w = $('sheet').clientWidth;
    if (score && w && Math.abs(w - lastWidth) > 30) draw();
  }).observe($('sheet'));
  mode = store.get('sheetMode', 'play');
  document.querySelector(`input[name="sheet-mode"][value="${mode}"]`).checked = true;
}

function builderSettings() {
  const s = {};
  for (const f of BUILDER_FIELDS) {
    const el = $(`gen-${f}`);
    s[f] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return s;
}

/** Route parameter: a piece id, optionally with ?mode=name&clef=bass&range=ledger… */
export function enter(param) {
  const query = new URLSearchParams(location.hash.split('?')[1] ?? '');
  if (param && findPiece(param)) {
    let changed = false;
    for (const f of BUILDER_FIELDS) {
      const v = query.get(f === 'mode' ? 'keymode' : f);
      if (v === null) continue;
      const el = $(`gen-${f}`);
      if (el.type === 'checkbox') el.checked = v === '1';
      else el.value = v;
      changed = true;
    }
    if (changed) store.set('builder', builderSettings());
    const m = query.get('mode');
    if (m === 'name' || m === 'play' || m === 'tempo') {
      mode = m;
      document.querySelector(`input[name="sheet-mode"][value="${mode}"]`).checked = true;
    }
    load(param);
  } else if (!piece) load(store.get('sheetPiece', 'rh-c-position'));
  else { draw(); showCurrent(); }
}

export function exit() {
  stop();
  stopTempo();
  endLoop();
  clearTimeout(autoTimer);
  clearInterval(clock);
  kb.clear('target');
}

const bpm = () => +$('sheet-tempo').value;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const timerSeconds = () => (mode === 'name' ? +$('sheet-timer').value : 0);

function renderList() {
  const played = store.get('pieces', {});
  const named = store.get('piecesNamed', {});
  const timed = store.get('piecesTempo', {});
  const pieces = allPieces();
  const levels = [...new Set(pieces.map((p) => p.level))];
  $('sheet-list').innerHTML = levels.map((level) => `
    <li class="group-label">${level}</li>
    ${pieces.filter((p) => p.level === level).map((p) => {
      const best = ({ name: named, tempo: timed }[mode] ?? played)[p.id] ?? 0;
      const tag = p.generated ? 'New every time' : p.rh && p.lh ? 'Both hands' : p.rh ? 'Right hand' : 'Left hand';
      const current = piece?.id === p.id ? ' aria-current="true"' : '';
      const starsHtml = p.generated ? '' : `<span class="stars${best ? '' : ' empty'}" aria-label="${best} of 3 stars">${stars(best)}</span>`;
      return `<li><button data-id="${p.id}"${current}>
        <span class="lesson-name">${escapeHtml(p.title)}</span>
        <span class="lesson-meta"><span>${p.generated ? tag : `${escapeHtml(p.composer)} · ${tag}`}</span>${starsHtml}</span>
      </button></li>`;
    }).join('')}`).join('');
}

const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function load(id, { keepSession = false } = {}) {
  piece = findPiece(id) ?? PIECES[0];
  store.set('sheetPiece', piece.id);
  stop();
  stopTempo();
  endLoop();
  $('sheet-loop-log').textContent = '';
  clearTimeout(autoTimer);
  $('sheet-own').hidden = !piece.own;
  $('sheet-builder').hidden = piece.generated !== 'random';
  $('sheet-new').hidden = !piece.generated;
  $('sheet-title').textContent = piece.title;
  $('sheet-desc').textContent = piece.desc ?? '';
  $('sheet-result').hidden = true;
  renderList();

  if (piece.generated === 'weak') {
    const weak = weakSheet();
    if (!weak) {
      score = null;
      source = null;
      $('sheet-meta').textContent = '';
      $('sheet-controls').hidden = true;
      $('sheet').innerHTML = `<p class="empty-state">Not enough history yet. Name around 20 notes in a reading test
        (<a href="#sheet/random?mode=name">random sheet</a>) or the <a href="#quiz">note quiz</a> and come back.
        The notes you miss will show up here.</p>`;
      setStatus('');
      kb.clear('target');
      return;
    }
    source = { ...piece, ...weak };
  } else if (piece.generated === 'random') {
    source = { ...piece, ...randomSheet(builderSettings()) };
  } else {
    source = piece;
  }
  $('sheet-controls').hidden = false;
  score = buildScore(source);
  $('sheet-meta').textContent = piece.generated
    ? `Key of ${keyLabel(source.key)} · ${source.time} time`
    : `${piece.composer} · ${piece.level} · ${piece.time} time · key of ${keyLabel(piece.key)}`;
  const options = [];
  if (source.rh && source.lh) options.push('both');
  if (source.rh) options.push('rh');
  if (source.lh) options.push('lh');
  const prevHands = hands;
  $('sheet-hands').innerHTML = options.map((h) => `<option value="${h}">${HAND_LABEL[h]}</option>`).join('');
  hands = keepSession && options.includes(prevHands) ? prevHands : options[0];
  $('sheet-hands').value = hands;
  $('sheet-hands').disabled = options.length === 1;
  $('sheet-tempo').value = piece.bpm;
  $('sheet-bpm').textContent = piece.bpm;
  fillBars();
  draw();
  restart({ keepSession });
}

function applyMode() {
  $('view-sheet').dataset.mode = mode;
  renderList();
  if (!score) return;
  draw();
  restart();
}

function draw() {
  $('view-sheet').dataset.mode = mode;
  if (!score) return;
  lastWidth = $('sheet').clientWidth;
  // Note names on the sheet would give the answers away in the reading test.
  renderScore($('sheet'), score, { noteNames: mode === 'play' && $('sheet-names').checked });
  paint();
  markRange();
}

// ---------------------------------------------------------------- passage (bar range)

/** Where bar `b` starts, in beats from the start of the piece. */
const barStart = (b) => (score.pickup ? (b === 0 ? 0 : score.pickup + (b - 1) * score.barLen) : b * score.barLen);
const barLabel = (b) => (score.pickup ? (b === 0 ? 'pickup' : String(b)) : String(b + 1));

function fillBars() {
  const n = score?.barCount ?? 0;
  const options = Array.from({ length: n }, (_, b) => `<option value="${b}">${barLabel(b)}</option>`).join('');
  for (const id of ['sheet-from', 'sheet-to']) {
    $(id).innerHTML = options;
    $(id).disabled = n < 2;
  }
  $('sheet-from').value = '0';
  $('sheet-to').value = String(Math.max(0, n - 1));
}

const barRange = () => ({ from: +$('sheet-from').value, to: +$('sheet-to').value });
const wholePiece = () => {
  const r = barRange();
  return r.from === 0 && r.to >= score.barCount - 1;
};

/** In tempo mode, fade the bars outside the chosen passage. */
function markRange() {
  if (!score) return;
  const { from, to } = barRange();
  const active = mode === 'tempo' && !wholePiece();
  for (const evs of Object.values(score.hands)) {
    for (const e of evs) e.el?.classList.toggle('outside', active && (e.bar < from || e.bar > to));
  }
}

function paint(playing = -1) {
  if (!score) return;
  if (mode === 'name' && playing < 0) {
    for (const it of items) it.event.el?.classList.remove('current', 'done', 'right', 'missed');
    for (const it of items.slice(0, qi)) {
      const el = it.event.el;
      if (!el) continue;
      const answered = it.event.items.filter((x) => x.answered);
      el.classList.add(answered.every((x) => x.right) ? 'right' : 'missed');
    }
    items[qi]?.event.el?.classList.add('current');
    return;
  }
  score.steps.forEach((s, i) => {
    for (const e of s.events) {
      if (mode !== 'tempo') e.el?.classList.remove('right', 'missed', 'close');
      e.el?.classList.toggle('done', playing < 0 && i < idx && mode !== 'tempo');
      e.el?.classList.toggle('current', playing < 0 ? i === idx && !done : i === playing);
    }
  });
}

function scrollSheetTo(el) {
  if (!el) return;
  const box = $('sheet-box');
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top < b.top + 20 || r.bottom > b.bottom - 20) {
    box.scrollBy({ top: r.top - b.top - box.clientHeight / 3, behavior: 'smooth' });
  }
}

const isRequired = (e) => hands === 'both' || e.hand === hands;
const required = (step) => [...new Set(step.events.filter(isRequired).flatMap((e) => e.midis))];

function setStatus(text, tone = '') {
  $('sheet-status').textContent = text;
  $('sheet-status').dataset.tone = tone;
}

function restart({ keepSession = false } = {}) {
  if (!score) return;
  stop();
  stopTempo();
  endLoop();
  clearTimeout(autoTimer);
  done = false;
  busy = false;
  $('sheet-result').hidden = true;
  $('sheet-box').scrollTop = 0;
  kb.clear('target');
  if (mode === 'name') startNaming(keepSession);
  else if (mode === 'tempo') { clearInterval(clock); readyTempo(); }
  else { clearInterval(clock); startPlaying(); }
}

// ---------------------------------------------------------------- play mode

const hintMode = () => $('sheet-hints').value;
/** Should the keyboard light up the next notes? */
function hintsVisible() {
  if (stepMistakes >= 2) return true; // stuck: help out
  if (hintMode() === 'always') return true;
  if (hintMode() === 'fade') return cleanStreak < 3;
  return false;
}

function startPlaying() {
  idx = 0;
  mistakes = 0;
  cleanStreak = 0;
  stepMistakes = 0;
  const how = hintMode() === 'off'
    ? 'Read the notes and play them, with no keyboard hints.'
    : hintMode() === 'fade'
      ? 'Keyboard hints fade out once you get three notes right in a row.'
      : 'Play the highlighted notes.';
  setStatus(`${how} (${HAND_LABEL[hands]}.) The music waits for you.`);
  enterStep();
}

function enterStep() {
  clearTimeout(autoTimer);
  hit = new Set();
  stepMistakes = 0;
  if (idx >= score.steps.length) return finishPlaying();
  const step = score.steps[idx];
  const others = step.events.filter((e) => !isRequired(e));
  if (others.length) {
    audio.playNotes(others.flatMap((e) => e.midis.map((midi) => ({ midi, beats: e.play, velocity: e.vel * 0.85 }))), bpm());
  }
  showCurrent();
  if (!required(step).length) {
    // Only the other hand plays here: let it sound, then move on.
    autoTimer = setTimeout(() => { idx++; enterStep(); }, step.beats * (60 / bpm()) * 1000);
  }
}

function showCurrent() {
  kb.clear('target');
  paint();
  if (!score || done || stopListen) return;
  if (mode === 'name') {
    scrollSheetTo(items[qi]?.event.el);
    return;
  }
  if (mode === 'tempo') return;
  if (idx >= score.steps.length) return;
  const req = required(score.steps[idx]);
  if (hintsVisible()) {
    kb.mark(req, 'target');
    kb.reveal(req);
  }
  scrollSheetTo(score.steps[idx].events.find((e) => e.el)?.el);
}

export function onNote(midi) {
  if (mode === 'tempo') return onTempoNote(midi);
  if (mode !== 'play' || !score || done || stopListen || idx >= score.steps.length) return;
  const req = required(score.steps[idx]);
  if (!req.length) return;
  if (req.includes(midi)) {
    kb.flash(midi, 'correct');
    if (!hit.has(midi)) stats.logPractice(1);
    hit.add(midi);
    if (req.every((m) => hit.has(m))) {
      cleanStreak = stepMistakes ? 0 : cleanStreak + 1;
      setStatus('');
      idx++;
      enterStep();
    }
  } else {
    mistakes++;
    stepMistakes++;
    cleanStreak = 0;
    kb.flash(midi, 'wrong');
    if (hintsVisible()) {
      const want = req.filter((m) => !hit.has(m)).map((m) => noteName(m)).join(' + ');
      setStatus(`That was ${noteName(midi)}. Next: ${want}.`, 'bad');
      showCurrent();
    } else {
      setStatus(`That was ${noteName(midi)}. Read the note again.`, 'bad');
    }
  }
}

function finishPlaying() {
  done = true;
  kb.clear('target');
  paint();
  const total = score.steps.filter((s) => required(s).length).length;
  const accuracy = Math.round((total / (total + mistakes)) * 100);
  showResult({ accuracy, detail: `${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}` });
}

// ---------------------------------------------------------------- name mode

function startNaming(keepSession) {
  // One question per notehead: in time order, treble before bass, chords low to high.
  items = [];
  for (const step of score.steps.filter((st) => st.pass === 1)) { // name each note once, even if the piece repeats
    const events = step.events.filter(isRequired).sort((a, b) => (a.hand === b.hand ? 0 : a.hand === 'rh' ? -1 : 1));
    for (const event of events) {
      event.items = event.names
        .map((name, i) => ({ event, name, midi: event.midis[i], answered: false, right: false }))
        .sort((a, b) => a.midi - b.midi);
      items.push(...event.items);
    }
  }
  qi = 0;
  typed = '';
  if (!keepSession || !session) {
    clearInterval(clock);
    session = { right: 0, total: 0, missed: [], ms: [], start: 0, end: 0, timer: timerSeconds() };
    setStatus(session.timer
      ? `Speed test: name as many notes as you can in ${session.timer / 60} minute${session.timer > 60 ? 's' : ''}. The clock starts on your first answer.`
      : 'Type the name of the highlighted note: a letter A–G, then # for sharp or b for flat if it has one. Remember the key signature!');
  }
  shownAt = performance.now();
  renderAnswer();
  showCurrent();
  focusAnswer();
}

function focusAnswer() {
  if (window.matchMedia('(pointer: fine)').matches) $('sheet-answer').focus({ preventScroll: true });
}

function timeLeft() {
  if (!session?.timer || !session.start) return session?.timer ?? 0;
  return Math.max(0, session.timer - (performance.now() - session.start) / 1000);
}

function renderAnswer() {
  $('sheet-answer').value = pretty(typed);
  if (!session) return;
  const parts = [`${session.right} / ${session.total} correct`];
  if (session.timer) {
    const t = Math.ceil(timeLeft());
    parts.push(`⏱ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  } else {
    parts.push(`${Math.max(0, items.length - qi)} left`);
  }
  $('sheet-score').textContent = parts.join(' · ');
  const it = items[qi];
  $('sheet-chord-hint').textContent = it && it.event.items.length > 1
    ? `Chord: note ${it.event.items.indexOf(it) + 1} of ${it.event.items.length}, lowest first`
    : '';
}

function onAnswerKey(e) {
  if (mode !== 'name' || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
  e.preventDefault();
  answerKey(e.key);
}

function answerKey(key) {
  if (busy || done || !score || qi >= items.length) return;
  if (session.timer && !session.start) {
    session.start = performance.now();
    clock = setInterval(() => {
      renderAnswer();
      if (timeLeft() <= 0) finishNaming();
    }, 250);
  }
  const it = items[qi];
  const letter = it.name[0];
  const acc = it.name.slice(1, -1); // '', '#' or 'b'

  if (key === 'Backspace') { typed = ''; renderAnswer(); return; }
  if (!typed) {
    if (!/^[a-gA-G]$/.test(key)) return;
    typed = key.toUpperCase();
    renderAnswer();
    if (typed !== letter) return grade(false);
    if (!acc) return grade(true);
    return; // right letter; wait for the accidental
  }
  let a = null;
  if (key === '#' || key === 's' || key === 'S' || key === '+' || key === '♯') a = '#';
  else if (key === 'b' || key === 'f' || key === 'F' || key === '-' || key === '♭') a = 'b';
  else if (key === 'Enter' || key === ' ' || key === 'n' || key === 'N' || key === '♮') a = '';
  if (a === null) return;
  typed += a;
  renderAnswer();
  grade(a === acc);
}

function grade(right) {
  const it = items[qi];
  const ms = performance.now() - shownAt;
  it.answered = true;
  it.right = right;
  it.typed = typed;
  session.total++;
  if (right) session.right++;
  else session.missed.push(it);
  session.ms.push(ms);
  stats.record(it.event.hand === 'rh' ? 'treble' : 'bass', it.name, right, ms);

  busy = true;
  const timed = !!session.timer;
  if (!timed || !right) {
    audio.noteOn(it.midi, 0.6);
    setTimeout(() => audio.noteOff(it.midi), 400);
  }
  kb.clear('target');
  kb.mark(it.midi, 'target');
  kb.reveal(it.midi);
  $('sheet-answer').dataset.tone = right ? 'good' : 'bad';
  setStatus(right ? `Correct: ${pretty(it.name)}.` : `Not quite: that note is ${pretty(it.name)}.`, right ? 'good' : 'bad');
  renderAnswer();
  setTimeout(() => {
    if (done) return;
    busy = false;
    typed = '';
    $('sheet-answer').dataset.tone = '';
    kb.clear('target');
    qi++;
    if (qi >= items.length) {
      // Timed test on a generated sheet: keep going with fresh notes.
      if (timed && piece.generated && timeLeft() > 0) return load(piece.id, { keepSession: true });
      return finishNaming();
    }
    shownAt = performance.now();
    renderAnswer();
    showCurrent();
  }, right ? (timed ? 120 : 450) : (timed ? 700 : 1400));
}

function finishNaming() {
  if (done) return;
  done = true;
  busy = true;
  clearInterval(clock);
  kb.clear('target');
  paint();
  const s = session;
  const accuracy = Math.round((s.right / Math.max(1, s.total)) * 100);
  const avg = s.ms.length ? s.ms.reduce((a, b) => a + b, 0) / s.ms.length / 1000 : 0;
  let detail = `${s.right} of ${s.total} notes named correctly · ${avg.toFixed(1)} s per note`;
  let extra = '';
  if (s.timer) {
    const minutes = s.timer / 60;
    const npm = Math.round(s.right / minutes);
    const key = `${piece.id}:${s.timer}`;
    const best = store.get('bestSpeed', {});
    const isBest = npm > (best[key] ?? 0);
    if (isBest) store.set('bestSpeed', { ...best, [key]: npm });
    stats.recordSpeed({ npm, accuracy, seconds: s.timer, piece: piece.id });
    detail = `${npm} correct notes per minute${isBest ? ' · new record' : ` · best ${best[key]}`} · ${accuracy}% accuracy`;
  }
  if (s.missed.length) {
    const seen = new Set();
    const list = s.missed.filter((it) => !seen.has(it.name) && seen.add(it.name)).slice(0, 12);
    extra += `<p class="muted">Missed: ${list.map((it) => `${pretty(it.name)} (you typed ${pretty(it.typed || '–')})`).join(', ')}</p>`;
  }
  const weak = stats.weakest(6);
  if (weak.length) {
    extra += `<p class="muted small">Your weakest notes overall: ${weak.map((w) => `${pretty(w.name)} <span class="tag">${w.clef}</span> ${Math.round(w.accuracy * 100)}%`).join(', ')}
      · <button class="link" data-action="weak">Practise them</button></p>`;
  }
  showResult({ accuracy, detail, extra, rate: !s.timer });
}

// ---------------------------------------------------------------- shared

function showResult({ accuracy, detail, extra = '', rate = true, showAccuracy = rate, icon = '⏱' }) {
  const earned = accuracy >= 95 ? 3 : accuracy >= 80 ? 2 : 1;
  let isBest = false;
  if (rate && !piece.generated) {
    const key = { name: 'piecesNamed', tempo: 'piecesTempo' }[mode] ?? 'pieces';
    const progress = store.get(key, {});
    isBest = earned > (progress[piece.id] ?? 0);
    if (isBest) store.set(key, { ...progress, [piece.id]: earned });
  }
  renderList();
  setStatus('');
  const list = allPieces();
  const hasNext = !piece.generated && list.findIndex((p) => p.id === piece.id) < list.length - 1;
  const result = $('sheet-result');
  result.hidden = false;
  result.innerHTML = `
    ${rate ? `<p class="result-stars" aria-label="${earned} of 3 stars">${stars(earned)}</p>` : `<p class="result-stars">${icon}</p>`}
    <p><strong>${showAccuracy ? `${accuracy}% accuracy, ` : ''}</strong>${detail}${isBest ? ' · new best' : ''}</p>
    ${extra}
    <div class="btn-row center">
      <button class="btn btn-ghost" data-action="again">Try again</button>
      ${piece.generated ? '<button class="btn" data-action="new">New notes</button>' : ''}
      ${hasNext ? '<button class="btn" data-action="next">Next piece</button>' : ''}
    </div>`;
  result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function toggleListen() {
  if (!score) return;
  if (stopListen) return stop();
  clearTimeout(autoTimer);
  kb.clear('target');
  $('sheet-listen').textContent = 'Stop';
  const steps = score.steps.map((s) => ({
    beats: s.beats,
    notes: s.events.flatMap((e) => e.midis.map((midi) => ({ midi, beats: e.play, velocity: e.vel }))),
  }));
  stopTempo();
  stopListen = audio.playSequence(steps, {
    bpm: bpm(),
    onStep: (i, dur) => {
      paint(i);
      for (const n of steps[i].notes) kb.flash(n.midi, 'demo', Math.max(dur, 0.15) * 900);
      kb.reveal(steps[i].notes.map((n) => n.midi));
      scrollSheetTo(score.steps[i].events.find((e) => e.el)?.el);
    },
    onDone: stop,
  });
}

function stop() {
  if (!stopListen) return;
  stopListen();
  stopListen = null;
  $('sheet-listen').textContent = 'Listen';
  kb.clear('demo');
  showCurrent();
}

// ---------------------------------------------------------------- tempo mode

function readyTempo() {
  idx = 0;
  paint();
  const { from, to } = barRange();
  setStatus(wholePiece()
    ? 'Press Start. You’ll hear one bar of clicks, then play along in time. The other hand plays itself.'
    : `Press Start to play bars ${barLabel(from)}–${barLabel(to)} after one bar of clicks.${$('sheet-loop').checked ? ' They repeat until you press Stop.' : ''}`);
  $('sheet-start').textContent = '▶ Start';
}

function startTempo() {
  if (!score) return;
  stop();
  stopTempo();
  $('sheet-result').hidden = true;
  for (const evs of Object.values(score.hands)) for (const e of evs) e.el?.classList.remove('right', 'close', 'missed', 'done');
  done = false;
  idx = -1;

  const spb = 60 / bpm();
  const clickBeats = 4 / score.den; // one click per beat of the time signature
  const clickSec = clickBeats * spb;
  const countIn = Math.round(score.barLen / clickBeats);
  const t0 = audio.now() + 0.25;
  const musicStart = t0 + countIn * clickSec;

  // The whole piece (with its repeat), or just the chosen bars, played once.
  const whole = wholePiece();
  const { from, to } = barRange();
  const last = score.steps[score.steps.length - 1];
  const offset = whole ? 0 : barStart(from); // beat where the passage starts
  const endBeat = whole ? last.time + last.beats : barStart(to + 1);
  const totalBeats = endBeat - offset;
  const steps = score.steps.map((st, i) => ({ st, i }))
    .filter(({ st }) => whole || (st.pass === 1 && st.events[0].bar >= from && st.events[0].bar <= to));
  const when = (st) => musicStart + (st.time - offset) * spb;

  const clicks = [];
  for (let k = 0; k < countIn; k++) clicks.push({ at: t0 + k * clickSec, accent: k === 0 });
  if ($('sheet-metronome').checked) {
    for (let k = 0; k * clickBeats < totalBeats - 1e-6; k++) {
      const beat = offset + k * clickBeats - score.pickup;
      const accent = Math.abs(((beat % score.barLen) + score.barLen) % score.barLen) < 1e-6;
      clicks.push({ at: musicStart + k * clickSec, accent });
    }
  }
  const notes = steps.flatMap(({ st }) => st.events.filter((e) => !isRequired(e)).flatMap((e) =>
    e.midis.map((midi) => ({ midi, at: when(st), dur: Math.min(e.play, endBeat - st.time) * spb, velocity: e.vel * 0.85 }))));

  const expected = [];
  for (const { st, i } of steps) {
    for (const e of st.events.filter(isRequired)) {
      for (const midi of e.midis) {
        expected.push({ midi, step: i, event: e, perf: audio.heardAt(when(st)), result: null, dt: 0 });
      }
    }
  }

  const timers = [];
  const at = (audioTime, fn) => timers.push(setTimeout(fn, Math.max(0, audio.heardAt(audioTime) - performance.now())));
  for (let k = 0; k < countIn; k++) at(t0 + k * clickSec, () => setStatus(`Count-in: ${'● '.repeat(k + 1)}${'○ '.repeat(countIn - k - 1)}`));
  steps.forEach(({ st, i }, n) => at(when(st), () => {
    if (n === 0) setStatus(loop ? `Pass ${loop.passes + 1}. Play!` : 'Play!');
    idx = i;
    kb.clear('target');
    paint();
    const req = required(st);
    if (req.length && hintsVisible()) { kb.mark(req, 'target'); kb.reveal(req); }
    scrollSheetTo(st.events.find((e) => e.el)?.el);
  }));
  const window = tempoWindow(spb);
  timers.push(setTimeout(finishTempo, audio.heardAt(musicStart + totalBeats * spb) - performance.now() + window));

  tempo = { expected, wrong: 0, timers, spb, whole, running: true, stopAudio: audio.schedule({ notes, clicks }) };
  $('sheet-start').textContent = '■ Stop';
}

/** How far from the beat a note may be and still count (ms). */
const tempoWindow = (spb) => Math.max(160, Math.min(350, spb * 1000 * 0.45));
const onTimeWindow = (spb) => Math.max(70, Math.min(120, spb * 1000 * 0.15));

function onTempoNote(midi) {
  if (!tempo?.running) return;
  const t = performance.now();
  let best = null;
  for (const x of tempo.expected) {
    if (x.result || x.midi !== midi) continue;
    if (!best || Math.abs(t - x.perf) < Math.abs(t - best.perf)) best = x;
  }
  if (!best || Math.abs(t - best.perf) > tempoWindow(tempo.spb)) {
    tempo.wrong++;
    kb.flash(midi, 'wrong');
    return;
  }
  best.dt = t - best.perf;
  best.result = Math.abs(best.dt) <= onTimeWindow(tempo.spb) ? 'ontime' : best.dt < 0 ? 'early' : 'late';
  kb.flash(midi, best.result === 'ontime' ? 'correct' : 'demo');
  stats.logPractice(1);
  judgeEvent(best.event);
}

function judgeEvent(e) {
  const xs = tempo.expected.filter((x) => x.event === e);
  if (xs.some((x) => !x.result)) return;
  e.el?.classList.remove('right', 'close', 'missed');
  e.el?.classList.add(xs.every((x) => x.result === 'ontime') ? 'right' : xs.some((x) => x.result === 'missed') ? 'missed' : 'close');
}

function stopTempo() {
  if (!tempo) return;
  tempo.timers.forEach(clearTimeout);
  tempo.stopAudio?.();
  tempo.running = false;
  tempo = null;
  kb.clear('target');
  $('sheet-start').textContent = '▶ Start';
}

function finishTempo() {
  if (!tempo?.running) return;
  const t = tempo;
  for (const x of t.expected) if (!x.result) x.result = 'missed';
  for (const e of new Set(t.expected.map((x) => x.event))) judgeEvent(e);
  t.running = false;
  t.timers.forEach(clearTimeout);
  tempo = null;
  done = true;
  idx = -1;
  kb.clear('target');
  for (const evs of Object.values(score.hands)) for (const e of evs) e.el?.classList.remove('current');
  $('sheet-start').textContent = '▶ Start';

  const count = (r) => t.expected.filter((x) => x.result === r).length;
  const [ontime, early, late, missed] = ['ontime', 'early', 'late', 'missed'].map(count);
  const points = ontime + 0.6 * (early + late);
  const accuracy = Math.round((points / Math.max(1, t.expected.length + t.wrong * 0.5)) * 100);
  const hits = t.expected.filter((x) => x.result !== 'missed');
  const avg = hits.length ? hits.reduce((a, x) => a + x.dt, 0) / hits.length : 0;
  const tendency = Math.abs(avg) < 25 ? 'Your timing is centred on the beat.'
    : `On average you play ${Math.round(Math.abs(avg))} ms ${avg < 0 ? 'early (rushing)' : 'late (dragging)'}.`;
  const detail = `${ontime} on time · ${early} early · ${late} late · ${missed} missed${t.wrong ? ` · ${t.wrong} wrong ${t.wrong === 1 ? 'note' : 'notes'}` : ''}`;

  if ($('sheet-loop').checked) return nextPass({ clean: missed === 0 && t.wrong === 0, detail });
  endLoop(); // Loop was switched off during this pass: it was the last one.
  const { from, to } = barRange();
  showResult({
    accuracy,
    detail: t.whole ? detail : `Bars ${barLabel(from)}–${barLabel(to)}: ${detail}`,
    extra: `<p class="muted">${tendency} Green notes were on time, gold early or late, red missed.</p>`,
    rate: t.whole, // stars are for playing the whole piece
    showAccuracy: true,
    icon: '♪',
  });
}

// ---------------------------------------------------------------- looping

/**
 * Called after each pass of a loop. A clean pass (every note played, no wrong
 * notes) raises the tempo by the chosen step; then the passage starts again.
 */
function nextPass({ clean, detail }) {
  loop ??= { passes: 0, clean: 0, startBpm: bpm(), timer: 0 };
  loop.passes++;
  const step = +$('sheet-speedup').value;
  let note = clean ? 'Clean pass!' : 'Not clean yet, so the same tempo again.';
  if (clean) {
    loop.clean++;
    const max = +$('sheet-tempo').max;
    if (step && bpm() < max) {
      const next = Math.min(max, bpm() + step);
      $('sheet-tempo').value = next;
      $('sheet-bpm').textContent = next;
      note += ` Next pass at ${next} bpm.`;
    } else if (step) note += ` That’s the top speed (${max} bpm).`;
  }
  $('sheet-loop-log').textContent = `Pass ${loop.passes}: ${detail}. ${note}`;
  $('sheet-loop-log').dataset.tone = clean ? 'good' : '';
  $('sheet-start').textContent = '■ Stop';
  loop.timer = setTimeout(startTempo, 700); // a short breath, then the count-in again
}

/** Stop looping and say how it went. */
function endLoop() {
  if (!loop) return;
  clearTimeout(loop.timer);
  const { passes, clean, startBpm } = loop;
  loop = null;
  $('sheet-loop-log').textContent = `Stopped after ${passes} ${passes === 1 ? 'pass' : 'passes'}, ${clean} clean`
    + `${bpm() !== startBpm ? `, tempo ${startBpm} → ${bpm()} bpm` : ''}.`;
  $('sheet-loop-log').dataset.tone = '';
}
