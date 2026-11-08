// Progress page: daily goal and streak, a practice calendar, a per-note
// accuracy heatmap drawn on the staff, and reading speed over time.
import * as stats from './stats.js';
import { buildScore, renderScore } from './sheet.js';
import * as sync from './sync.js';

const $ = (id) => document.getElementById(id);
const pretty = (name) => name.replace('#', '♯').replace(/(?<=[A-G])b/, '♭');

// Accuracy bins → sequential blue ramp (light = weak, dark = strong).
const BINS = [
  { max: 0.5, color: '#86b6ef', label: 'under 50%' },
  { max: 0.75, color: '#5598e7', label: '50–74%' },
  { max: 0.9, color: '#2a78d6', label: '75–89%' },
  { max: 1.01, color: '#184f95', label: '90% or more' },
];
const binOf = (acc) => BINS.find((b) => acc < b.max);

// Natural notes shown on each staff (diatonic numbers, C4 = 28).
const STAFF_RANGE = { treble: [24, 44], bass: [12, 32] };
const LETTERS = 'CDEFGAB';

export function init() {
  $('goal-select').addEventListener('change', () => stats.setGoal(+$('goal-select').value));
  $('progress-reset').addEventListener('click', () => {
    if (!window.confirm('Reset all note statistics? Your practice calendar is kept.')) return;
    stats.reset();
    render();
  });
  stats.onPractice(updateChip);
  updateChip();
  initSync();
  $('speed-source').addEventListener('change', () => { speedSourceChosen = true; renderSpeed(); });
  const tip = $('chart-tip');
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (e.target.closest?.('.line-chart')) return; // the chart runs its own tooltip
    if (!t || !$('view-progress').contains(t)) { tip.hidden = true; return; }
    showTip(t.dataset.tip, e.clientX, e.clientY);
  });
}

export function enter() { render(); }

/** The "today / streak" chip in the top bar. */
function updateChip() {
  const today = stats.today();
  const goal = stats.getGoal();
  const streak = stats.streak();
  $('goal-chip').innerHTML = `<span class="goal-ring"></span>
    <span>${today}/${goal}</span>${streak ? `<span class="streak">🔥 ${streak}</span>` : ''}`;
  $('goal-chip').querySelector('.goal-ring').style.setProperty('--p', Math.min(1, today / goal));
  $('goal-chip').setAttribute('aria-label', `Today ${today} of ${goal} notes; streak ${streak} days`);
  if (!$('view-progress').hidden) renderGoal();
}

function render() {
  renderGoal();
  renderCalendar();
  renderHeatmap();
  renderSpeed();
}

function renderGoal() {
  const today = stats.today();
  const goal = stats.getGoal();
  const streak = stats.streak();
  $('goal-select').value = String(goal);
  $('goal-today').textContent = today;
  $('goal-target').textContent = goal;
  $('goal-bar').style.setProperty('--pct', `${Math.min(100, (today / goal) * 100)}%`);
  $('goal-streak').textContent = streak;
  $('goal-streak-label').textContent = streak === 1 ? 'day in a row' : 'days in a row';
  $('goal-message').textContent = today >= goal ? 'Goal reached today. Nice work!'
    : `${goal - today} more ${goal - today === 1 ? 'note' : 'notes'} to reach today’s goal.`;
  const s = stats.summary();
  $('summary-notes').textContent = s.seen;
  $('summary-accuracy').textContent = s.seen ? `${Math.round(s.accuracy * 100)}%` : '–';
}

function renderCalendar() {
  const goal = stats.getGoal();
  const days = stats.recentDays(35);
  const level = (n) => (n === 0 ? 0 : n >= goal ? 3 : n >= goal / 2 ? 2 : 1);
  const first = new Date(`${days[0].date}T00:00`);
  const pad = (first.getDay() + 6) % 7; // weeks start on Monday
  $('calendar').innerHTML = Array.from({ length: pad }, () => '<span class="day pad"></span>').join('')
    + days.map((d) => {
      const date = new Date(`${d.date}T00:00`);
      const label = `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.notes} ${d.notes === 1 ? 'note' : 'notes'}${d.notes >= goal ? ' · goal met' : ''}`;
      return `<span class="day l${level(d.notes)}" data-tip="${label}" aria-label="${label}" role="img"></span>`;
    }).join('');
}

function renderHeatmap() {
  const notes = stats.allNotes();
  const byKey = new Map(notes.map((n) => [`${n.clef}:${n.name}`, n]));
  for (const clef of ['treble', 'bass']) {
    const [lo, hi] = STAFF_RANGE[clef];
    const names = [];
    for (let d = lo; d <= hi; d++) names.push(`${LETTERS[d % 7]}${Math.floor(d / 7)}`);
    const piece = { id: `heat-${clef}`, key: 'C', time: '4/4', measureWidth: 900, [clef === 'treble' ? 'rh' : 'lh']: names.map((n) => `${n}:1`).join(' ') };
    const score = buildScore({ ...piece, time: `${names.length}/4` });
    const box = $(`heat-${clef}`);
    box.style.minWidth = `${names.length * 34 + 80}px`;
    renderScore(box, score, { showTime: false });
    Object.values(score.hands)[0].forEach((e) => {
      const n = byKey.get(`${clef}:${e.names[0]}`);
      if (!e.el) return;
      e.el.querySelectorAll('.vf-stem').forEach((s) => s.remove()); // noteheads only
      if (!n) {
        e.el.classList.add('unseen');
        e.el.dataset.tip = `${pretty(e.names[0])}: not practised yet`;
        return;
      }
      const bin = binOf(n.accuracy);
      e.el.style.setProperty('--heat', bin.color);
      e.el.classList.add('heat');
      e.el.dataset.tip = `${pretty(e.names[0])} (${clef}): ${Math.round(n.accuracy * 100)}% of ${n.seen} · avg ${(n.ms / 1000).toFixed(1)} s`;
    });
  }
  // Sharps and flats don't fit on one staff line-up: list them.
  const accs = notes.filter((n) => /[#b]/.test(n.name.slice(1))).sort((a, b) => a.accuracy - b.accuracy);
  $('heat-accidentals').innerHTML = accs.length
    ? accs.map((n) => `<span class="chip heat-chip" data-heat="${binOf(n.accuracy).color}" data-tip="${pretty(n.name)} (${n.clef}): ${Math.round(n.accuracy * 100)}% of ${n.seen}">
        <span class="sw"></span>${pretty(n.name)} <span class="muted small">${n.clef} · ${Math.round(n.accuracy * 100)}%</span></span>`).join('')
    : '<span class="muted small">None yet. Turn on sharps and flats in the note quiz, or use a random sheet with key signatures.</span>';
  $('heat-legend').innerHTML = BINS.map((b) => `<span><span class="sw" data-heat="${b.color}"></span>${b.label}</span>`).join('')
    + '<span><span class="sw unseen-sw"></span>not practised</span>';
  // Colours are set here rather than in a style="" attribute, which the Content-Security-Policy blocks.
  document.querySelectorAll('#heat-accidentals [data-heat]').forEach((el) => el.style.setProperty('--heat', el.dataset.heat));
  document.querySelectorAll('#heat-legend [data-heat]').forEach((el) => { el.style.background = el.dataset.heat; });
  const weak = stats.weakest(8);
  $('weak-list').innerHTML = weak.length
    ? weak.map((w) => `<span class="chip">${pretty(w.name)} <span class="muted small">${w.clef} · ${Math.round(w.accuracy * 100)}%</span></span>`).join('')
      + ' <a class="btn btn-small" href="#sheet/weak?mode=name">Practise these</a>'
    : '<span class="muted small">No weak spots recorded yet.</span>';
}

// Speed tests come from "Name the notes" (typing names) and the note quiz
// (playing them), which run at different speeds, so each has its own chart.
let speedSourceChosen = false;
const isQuiz = (h) => h.piece === 'quiz';

function renderSpeed() {
  const all = stats.speedHistory();
  const source = $('speed-source');
  // Until you pick one, show the kind of test you took last.
  if (!speedSourceChosen && all.length) source.value = isQuiz(all[all.length - 1]) ? 'quiz' : 'name';
  const quiz = source.value === 'quiz';
  const history = all.filter((h) => isQuiz(h) === quiz);
  const box = $('speed-chart');
  const table = $('speed-table');
  if (history.length < 2) {
    const how = quiz
      ? 'Set the Timer in the <a href="#quiz">note quiz</a> to 1 minute'
      : 'Take a timed test in <a href="#sheet/random?mode=name">Name the notes</a> (Timer: 1 minute)';
    box.innerHTML = `<p class="empty-state">${history.length ? 'One speed test so far.' : 'No speed tests yet.'}
      ${how} to start the chart.</p>`;
    table.innerHTML = '';
    return;
  }
  const W = 640;
  const H = 240;
  const m = { l: 40, r: 16, t: 14, b: 30 };
  const max = Math.max(10, ...history.map((h) => h.npm));
  const niceMax = Math.ceil(max / 10) * 10;
  const x = (i) => m.l + (i / (history.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / niceMax) * (H - m.t - m.b);
  const ticks = [0, niceMax / 2, niceMax];
  const fmt = (h) => new Date(h.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const path = history.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.npm).toFixed(1)}`).join('');
  const best = history.reduce((b, h, i) => (h.npm > history[b].npm ? i : b), 0);
  const lastI = history.length - 1;
  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="line-chart" role="img" aria-label="Correct notes per minute over ${history.length} speed tests">
      ${ticks.map((t) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      <text class="axis" x="${m.l}" y="${H - 8}">${fmt(history[0])}</text>
      <text class="axis" x="${W - m.r}" y="${H - 8}" text-anchor="end">${fmt(history[lastI])}</text>
      <path class="series" d="${path}"/>
      ${history.map((h, i) => `<circle class="dot" cx="${x(i)}" cy="${y(h.npm)}" r="${i === best || i === lastI ? 4.5 : 3}"/>`).join('')}
      <text class="direct" x="${x(best)}" y="${y(history[best].npm) - 10}" text-anchor="middle">best ${history[best].npm}</text>
      <line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg>`;
  const svg = box.querySelector('svg');
  const cross = svg.querySelector('.crosshair');
  const hit = svg.querySelector('.hit');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(lastI, Math.round(((px - m.l) / (W - m.l - m.r)) * lastI)));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    const h = history[i];
    showTip(`${fmt(h)} · ${h.npm} correct notes/min · ${h.accuracy}% accuracy`, e.clientX, e.clientY);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); $('chart-tip').hidden = true; });

  table.innerHTML = `<table><thead><tr><th>Date</th><th>Correct notes/min</th><th>Accuracy</th><th>Length</th></tr></thead><tbody>
    ${history.slice().reverse().map((h) => `<tr><td>${new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
      <td>${h.npm}</td><td>${h.accuracy}%</td><td>${h.seconds / 60} min</td></tr>`).join('')}</tbody></table>`;
}

function initSync() {
  $('sync-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      await sync.connect($('sync-token').value);
      $('sync-token').value = '';
    } catch { /* the status line explains */ }
    button.disabled = false;
  });
  $('sync-now').addEventListener('click', () => sync.syncNow());
  $('sync-disconnect').addEventListener('click', () => sync.disconnect());
  sync.onStatus((s) => {
    $('sync-off').hidden = s.connected;
    $('sync-on').hidden = !s.connected;
    $('sync-now').disabled = s.busy;
    if (s.connected) {
      $('sync-login').textContent = `@${s.login}`;
      $('sync-gist').href = `https://gist.github.com/${s.login}/${s.gistId}`;
      $('sync-last').textContent = s.lastSync
        ? `Last synced ${new Date(s.lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.` : '';
    }
    $('sync-status').textContent = s.text;
    $('sync-status').dataset.tone = s.tone;
    if (s.updated) {
      updateChip();
      if (!$('view-progress').hidden) render();
    }
  });
}

function showTip(text, cx, cy) {
  const tip = $('chart-tip');
  tip.textContent = text;
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, cx - w / 2))}px`;
  tip.style.top = `${cy - tip.offsetHeight - 14}px`;
}
