// Sheet music practice. Two modes:
//  - play: play the highlighted notes on the piano; the music waits for you.
//  - name: a reading test; type the name of each highlighted note (e.g. F, F#, Bb).
//    Optionally timed. Every answer feeds the spaced-repetition stats.
import { PIECES } from './pieces.js';
import { buildScore, renderScore } from './sheet.js';
import { randomSheet, weakSheet, DEFAULTS, isMinor } from './generator.js';
import { noteName } from './notes.js';
import * as audio from './audio.js';
import * as store from './storage.js';
import * as stats from './stats.js';

const $ = (id) => document.getElementById(id);
const HAND_LABEL = { rh: 'Right hand', lh: 'Left hand', both: 'Both hands' };
const pretty = (name) => name.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
const keyLabel = (k) => (isMinor(k) ? `${pretty(k.slice(0, -1))} minor` : `${pretty(k)} major`);
const BUILDER_FIELDS = ['clef', 'keys', 'mode', 'range', 'rhythm', 'time', 'chords', 'accidentals'];

let kb;
let piece = null; // entry from PIECES
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
    else load(PIECES[PIECES.indexOf(piece) + 1].id);
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
  if (param && PIECES.some((p) => p.id === param)) {
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
    if (m === 'name' || m === 'play') {
      mode = m;
      document.querySelector(`input[name="sheet-mode"][value="${mode}"]`).checked = true;
    }
    load(param);
  } else if (!piece) load(store.get('sheetPiece', 'rh-c-position'));
  else { draw(); showCurrent(); }
}

export function exit() {
  stop();
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
  const levels = [...new Set(PIECES.map((p) => p.level))];
  $('sheet-list').innerHTML = levels.map((level) => `
    <li class="group-label">${level}</li>
    ${PIECES.filter((p) => p.level === level).map((p) => {
      const best = (mode === 'name' ? named : played)[p.id] ?? 0;
      const tag = p.generated ? 'New every time' : p.rh && p.lh ? 'Both hands' : p.rh ? 'Right hand' : 'Left hand';
      const current = piece === p ? ' aria-current="true"' : '';
      const starsHtml = p.generated ? '' : `<span class="stars${best ? '' : ' empty'}" aria-label="${best} of 3 stars">${stars(best)}</span>`;
      return `<li><button data-id="${p.id}"${current}>
        <span class="lesson-name">${p.title}</span>
        <span class="lesson-meta"><span>${p.generated ? tag : `${p.composer} · ${tag}`}</span>${starsHtml}</span>
      </button></li>`;
    }).join('')}`).join('');
}

function load(id, { keepSession = false } = {}) {
  piece = PIECES.find((p) => p.id === id) ?? PIECES[0];
  store.set('sheetPiece', piece.id);
  stop();
  clearTimeout(autoTimer);
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
      e.el?.classList.remove('right', 'missed');
      e.el?.classList.toggle('done', playing < 0 && i < idx);
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
  clearTimeout(autoTimer);
  done = false;
  busy = false;
  $('sheet-result').hidden = true;
  $('sheet-box').scrollTop = 0;
  kb.clear('target');
  if (mode === 'name') startNaming(keepSession);
  else { clearInterval(clock); startPlaying(); }
}

// ---------------------------------------------------------------- play mode

function startPlaying() {
  idx = 0;
  mistakes = 0;
  setStatus(`Play the highlighted notes (${HAND_LABEL[hands].toLowerCase()}). The music waits for you.`);
  enterStep();
}

function enterStep() {
  clearTimeout(autoTimer);
  hit = new Set();
  if (idx >= score.steps.length) return finishPlaying();
  const step = score.steps[idx];
  const others = step.events.filter((e) => !isRequired(e));
  if (others.length) {
    audio.playNotes(others.flatMap((e) => e.midis.map((midi) => ({ midi, beats: e.beats }))), bpm());
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
  if (idx >= score.steps.length) return;
  const req = required(score.steps[idx]);
  kb.mark(req, 'target');
  kb.reveal(req);
  scrollSheetTo(score.steps[idx].events.find((e) => e.el)?.el);
}

export function onNote(midi) {
  if (mode !== 'play' || !score || done || stopListen || idx >= score.steps.length) return;
  const req = required(score.steps[idx]);
  if (!req.length) return;
  if (req.includes(midi)) {
    kb.flash(midi, 'correct');
    hit.add(midi);
    if (req.every((m) => hit.has(m))) {
      setStatus('');
      idx++;
      enterStep();
    }
  } else {
    mistakes++;
    kb.flash(midi, 'wrong');
    const want = req.filter((m) => !hit.has(m)).map((m) => noteName(m)).join(' + ');
    setStatus(`That was ${noteName(midi)}. Next: ${want}.`, 'bad');
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
  for (const step of score.steps) {
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

function showResult({ accuracy, detail, extra = '', rate = true }) {
  const earned = accuracy >= 95 ? 3 : accuracy >= 80 ? 2 : 1;
  let isBest = false;
  if (rate && !piece.generated) {
    const key = mode === 'name' ? 'piecesNamed' : 'pieces';
    const progress = store.get(key, {});
    isBest = earned > (progress[piece.id] ?? 0);
    if (isBest) store.set(key, { ...progress, [piece.id]: earned });
  }
  renderList();
  setStatus('');
  const hasNext = !piece.generated && PIECES.indexOf(piece) < PIECES.length - 1;
  const result = $('sheet-result');
  result.hidden = false;
  result.innerHTML = `
    ${rate ? `<p class="result-stars" aria-label="${earned} of 3 stars">${stars(earned)}</p>` : '<p class="result-stars">⏱</p>'}
    <p><strong>${rate ? `${accuracy}% accuracy, ` : ''}</strong>${detail}${isBest ? ' · new best' : ''}</p>
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
    notes: s.events.flatMap((e) => e.midis.map((midi) => ({ midi, beats: e.beats }))),
  }));
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
