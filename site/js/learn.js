// "Learn to read" path: short chapters that explain how to read sheet music,
// each with rendered examples you can hear, a link to practise that skill, and
// a few questions to check yourself (learncheck.js). Passing the check marks
// the chapter done.
import { buildScore, renderScore } from './sheet.js';
import { CHECKS } from './learncheck.js';
import * as audio from './audio.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

const ex = (opts) => ({ key: 'C', time: '4/4', bpm: 90, ...opts });

const CHAPTERS = [
  {
    id: 'staff',
    title: 'The staff',
    body: `
      <p>Music is written on a <strong>staff</strong>: five horizontal lines with four spaces between them.
      Each line and each space is one note. The higher a note sits on the staff, the higher it sounds.</p>
      <p>Moving from a line to the very next space (or space to line) is a <strong>step</strong>, which is the
      next white key on the piano. Skipping a line or space is a <strong>skip</strong>, which jumps over one white key.</p>`,
    examples: [{ caption: 'Steps up the staff: line, space, line, space…', names: true, piece: ex({ rh: 'C4 D4 E4 F4 | G4 A4 B4 C5' }) }],
    practice: null,
  },
  {
    id: 'treble',
    title: 'The treble clef',
    body: `
      <p>The symbol at the start of the staff is a <strong>clef</strong>. It tells you which notes the lines mean.
      The <strong>treble clef</strong> (or G clef) curls around the second line from the bottom, and that line is
      <strong>G above middle C</strong>. Your right hand usually reads the treble clef.</p>
      <p>The <strong>lines</strong>, from the bottom up, are <strong>E G B D F</strong>. Remember them with
      “<em>Every Good Boy Does Fine</em>”.<br>
      The <strong>spaces</strong>, from the bottom up, spell <strong>F A C E</strong>, which rhymes with “space”.</p>`,
    examples: [
      { caption: 'Lines: E G B D F', names: true, piece: ex({ rh: 'E4 G4 B4 D5 F5:3' }) },
      { caption: 'Spaces: F A C E', names: true, piece: ex({ rh: 'F4 A4 C5 E5' }) },
    ],
    practice: { label: 'Name random treble notes', href: '#sheet/random?mode=name&clef=treble&range=staff&keys=c&keymode=major&chords=0&accidentals=0' },
  },
  {
    id: 'bass',
    title: 'The bass clef',
    body: `
      <p>The <strong>bass clef</strong> (or F clef) is for lower notes, usually played by your left hand.
      Its two dots sit either side of the second line from the top, and that line is <strong>F below middle C</strong>.</p>
      <p>The <strong>lines</strong>, from the bottom up, are <strong>G B D F A</strong>: “<em>Good Boys Do Fine Always</em>”.<br>
      The <strong>spaces</strong>, from the bottom up, are <strong>A C E G</strong>: “<em>All Cows Eat Grass</em>”.</p>`,
    examples: [
      { caption: 'Lines: G B D F A', names: true, piece: ex({ lh: 'G2 B2 D3 F3 | A3:4' }) },
      { caption: 'Spaces: A C E G', names: true, piece: ex({ lh: 'A2 C3 E3 G3' }) },
    ],
    practice: { label: 'Name random bass notes', href: '#sheet/random?mode=name&clef=bass&range=staff&keys=c&keymode=major&chords=0&accidentals=0' },
  },
  {
    id: 'ledger',
    title: 'Ledger lines & middle C',
    body: `
      <p>Notes that don’t fit on the staff get short extra lines called <strong>ledger lines</strong>.
      Keep counting line, space, line, space just as you would on the staff.</p>
      <p><strong>Middle C</strong> is the C in the middle of the piano. It sits on one ledger line
      <em>below</em> the treble staff, or one ledger line <em>above</em> the bass staff. Both are the same key.</p>`,
    examples: [
      { caption: 'Treble clef going below the staff', names: true, piece: ex({ rh: 'E4 D4 C4 B3 | A3:4' }) },
      { caption: 'Bass clef going above the staff', names: true, piece: ex({ lh: 'A3 B3 C4 D4 | E4:4' }) },
    ],
    practice: { label: 'Name notes on ledger lines', href: '#sheet/random?mode=name&clef=grand&range=ledger&keys=c&keymode=major&chords=0&accidentals=0' },
  },
  {
    id: 'grand',
    title: 'The grand staff',
    body: `
      <p>Piano music uses two staves joined by a brace: the <strong>grand staff</strong>. The treble staff on top
      is usually for the right hand, and the bass staff underneath is usually for the left.</p>
      <p>Notes that line up vertically are played <strong>at the same time</strong>. Read from left to right,
      looking at both staves at each point.</p>`,
    examples: [{
      caption: 'Right hand melody over left hand notes',
      names: true,
      piece: ex({ rh: 'E4 D4 C4 D4 | E4 E4 E4:2', lh: 'C3:4 | C3:2 G2:2' }),
    }],
    practice: { label: 'Name notes on a grand staff', href: '#sheet/random?mode=name&clef=grand&range=staff&keys=c&keymode=major' },
  },
  {
    id: 'durations',
    title: 'Note lengths',
    body: `
      <p>The shape of a note tells you <strong>how long</strong> to hold it, counted in beats:</p>
      <ul class="defs">
        <li><strong>Whole note</strong>: hollow, no stem. 4 beats.</li>
        <li><strong>Half note</strong>: hollow, with a stem. 2 beats.</li>
        <li><strong>Quarter note</strong>: filled, with a stem. 1 beat.</li>
        <li><strong>Eighth note</strong>: one flag, or joined to others by a beam. ½ beat.</li>
        <li><strong>Sixteenth note</strong>: two flags or beams. ¼ beat.</li>
      </ul>
      <p>A <strong>dot</strong> after a note adds half its length again. A dotted half note lasts 3 beats,
      and a dotted quarter lasts 1½.</p>`,
    examples: [
      { caption: 'Whole, halves, quarters', piece: ex({ rh: 'C5:4 | C5:2 C5:2 | C5 C5 C5 C5' }) },
      { caption: 'Eighths, sixteenths, dotted notes', piece: ex({ rh: 'C5:0.5 C5:0.5 C5:0.5 C5:0.5 C5:0.25 C5:0.25 C5:0.25 C5:0.25 C5 | C5:1.5 C5:0.5 C5:2' }) },
    ],
    practice: { label: 'Play “Ode to Joy”', href: '#sheet/ode-hands?mode=play' },
  },
  {
    id: 'rests',
    title: 'Rests',
    body: `
      <p>A <strong>rest</strong> is a silence of a set length. Each note length has a matching rest.
      Count rests exactly like notes, just without playing.</p>
      <ul class="defs">
        <li><strong>Whole rest</strong> hangs <em>below</em> a line. A whole rest also means a full bar of silence in any time signature.</li>
        <li><strong>Half rest</strong> sits <em>on top of</em> a line, like a hat.</li>
        <li><strong>Quarter rest</strong> is a squiggle, and <strong>eighth rest</strong> looks like a 7 with a dot.</li>
      </ul>`,
    examples: [{ caption: 'Whole rest · half rest · quarter rest · eighth rest', piece: ex({ rh: 'R:4 | R:2 C5:2 | R:1 C5 R:0.5 C5:0.5 C5' }) }],
    practice: { label: 'Read varied rhythms with rests', href: '#sheet/random?mode=play&rhythm=varied&clef=treble&chords=0' },
  },
  {
    id: 'time',
    title: 'Time signatures & bars',
    body: `
      <p>Vertical <strong>bar lines</strong> divide music into <strong>bars</strong> (also called measures). The
      <strong>time signature</strong> at the start says how to count each bar:</p>
      <ul class="defs">
        <li>The <strong>top number</strong> is how many beats are in each bar.</li>
        <li>The <strong>bottom number</strong> is which note gets one beat: 4 = quarter note, 8 = eighth note.</li>
      </ul>
      <p><strong>4/4</strong> (“common time”) is 1-2-3-4. <strong>3/4</strong> is the waltz: 1-2-3, 1-2-3.
      A piece can also start with a short <strong>pickup</strong> bar before the first full bar.</p>`,
    examples: [{ caption: '3/4 time: three beats in every bar', piece: ex({ time: '3/4', rh: 'C4:2 E4 | G4:2 E4 | F4 E4 D4 | C4:3' }) }],
    practice: { label: 'Play “Amazing Grace” (3/4)', href: '#sheet/amazing-grace?mode=play' },
  },
  {
    id: 'accidentals',
    title: 'Sharps, flats & naturals',
    body: `
      <p><strong>Accidentals</strong> change a note by a half step, the very next key with no key skipped:</p>
      <ul class="defs">
        <li><strong>♯ Sharp</strong> raises the note a half step. F♯ is the black key just right of F.</li>
        <li><strong>♭ Flat</strong> lowers it a half step. B♭ is the black key just left of B.</li>
        <li><strong>♮ Natural</strong> cancels a sharp or flat.</li>
      </ul>
      <p>An accidental lasts until the end of the bar. The next bar goes back to normal. One key can have two names:
      C♯ and D♭ are the same black key.</p>`,
    examples: [{ caption: 'C, C♯, D, E♭, E, then a natural cancelling the sharp', names: true, piece: ex({ rh: 'C4 C#4 D4 Eb4 | E4 F#4 F4:2' }) }],
    practice: null,
  },
  {
    id: 'keysig',
    title: 'Key signatures',
    body: `
      <p>Instead of writing the same sharp or flat over and over, music puts them right after the clef in a
      <strong>key signature</strong>. They apply to that note in <em>every</em> octave, for the whole piece.</p>
      <ul class="defs">
        <li><strong>No sharps or flats</strong>: C major (or A minor).</li>
        <li><strong>One sharp (F♯)</strong>: G major. Every F is played as F♯.</li>
        <li><strong>Two sharps (F♯, C♯)</strong>: D major.</li>
        <li><strong>One flat (B♭)</strong>: F major. Every B is played as B♭.</li>
      </ul>
      <p>Before you play, always check the key signature, and say the sharps or flats out loud.</p>`,
    examples: [
      { caption: 'G major: the F has no ♯ written next to it, but it is still F♯', names: true, piece: ex({ key: 'G', rh: 'G4 A4 B4 C5 | D5 E5 F#5 G5' }) },
      { caption: 'F major: every B is B♭', names: true, piece: ex({ key: 'F', rh: 'F4 G4 A4 Bb4 | C5:4' }) },
    ],
    practice: { label: 'Name notes with key signatures', href: '#sheet/random?mode=name&clef=treble&keys=medium&keymode=both&accidentals=1' },
  },
  {
    id: 'markings',
    title: 'Fingering, ties, dynamics & repeats',
    body: `
      <p>Sheet music tells you more than which notes to play:</p>
      <ul class="defs">
        <li><strong>Fingering</strong> numbers above or below a note say which finger to use. Your thumb is 1 and your
        little finger is 5, on <em>both</em> hands.</li>
        <li>A <strong>tie</strong> is a curved line joining two notes of the <em>same</em> pitch. Play the first one and hold it
        through the second. Ties let a note last across a bar line.</li>
        <li><strong>Dynamics</strong> say how loud to play: <em>pp</em> very soft, <em>p</em> soft, <em>mp</em> and <em>mf</em>
        moderately soft and loud, <em>f</em> loud, <em>ff</em> very loud. On a piano, loudness comes from how fast you press the key.</li>
        <li><strong>Repeat signs</strong> (a thick and thin line with two dots, like <strong>:‖</strong>) mean go back to the matching
        sign, or to the beginning, and play that part again.</li>
      </ul>`,
    examples: [
      { caption: 'Fingering for the right hand in C position', piece: ex({ rh: 'C4@1 D4@2 E4@3 F4@4 | G4@5 F4@4 E4@3 D4@2 | C4@1:4' }) },
      { caption: 'A tie: the E is held for four beats, across the bar line', names: true, piece: ex({ rh: 'C5:2 E5:2~ | E5:2 C5:2' }) },
      { caption: 'Dynamics: soft (p), then loud (f). Listen to the difference', piece: ex({ rh: '!p C4 E4 G4 C5 | !f C5 G4 E4 C4' }) },
      { caption: 'Repeat signs: play these two bars twice', piece: ex({ rh: 'C4 D4 E4 F4 | G4:4', repeat: true }) },
    ],
    practice: { label: 'Play the C position exercise with fingering', href: '#sheet/rh-c-position?mode=play' },
  },
  {
    id: 'reading-tips',
    title: 'Reading tips',
    body: `
      <p>Good readers don’t work out every note from scratch. They use a few tricks:</p>
      <ul class="defs">
        <li><strong>Landmarks.</strong> Learn a few notes by sight: middle C, treble G (where the clef curls), and bass F
        (between the dots). Work out other notes from the nearest landmark.</li>
        <li><strong>Read the shape.</strong> Is the next note a step, a skip, or a bigger leap? Up or down? Your hand can move
        before you have named the note.</li>
        <li><strong>Look ahead.</strong> While you play one note, your eyes should already be on the next.</li>
        <li><strong>Little and often.</strong> Five minutes of naming notes every day beats an hour once a week.</li>
      </ul>`,
    examples: [{ caption: 'Steps, skips and leaps', piece: ex({ rh: 'C4 D4 E4 G4 | E4 C5 G4 C4' }) }],
    practice: { label: 'Open the sheet music library', href: '#sheet' },
  },
];

let current = 0;
let stopPlay = null;
let kb;
let check = null; // { questions, tries: [wrong answers per question], solved: [bool] }

export function init(keyboard) {
  kb = keyboard;
  $('learn-toc').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (btn) show(+btn.dataset.i);
  });
  $('learn-prev').addEventListener('click', () => show(current - 1));
  $('learn-next').addEventListener('click', () => show(current + 1));
  $('learn-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ex]');
    if (btn) playExample(+btn.dataset.ex, btn);
    const choice = e.target.closest('button[data-choice]');
    if (choice) answer(+choice.dataset.q, choice);
    if (e.target.closest('[data-action="new-check"]')) startCheck(true);
    if (e.target.closest('[data-action="next-chapter"]')) show(current + 1);
  });
  current = Math.min(store.get('learnChapter', 0), CHAPTERS.length - 1);
}

export function enter() {
  show(current);
}

export function exit() {
  stop();
}

const doneSet = () => new Set(store.get('learnDone', []));

function markDone(id) {
  const s = doneSet();
  s.add(id);
  store.set('learnDone', [...s]);
}

function renderToc() {
  const done = doneSet();
  $('learn-toc').innerHTML = CHAPTERS.map((c, i) => `
    <li><button data-i="${i}"${i === current ? ' aria-current="true"' : ''}>
      <span class="toc-num${done.has(c.id) ? ' done' : ''}" aria-hidden="true">${done.has(c.id) ? '✓' : i + 1}</span>
      <span>${c.title}</span>
    </button></li>`).join('');
  const pct = Math.round((done.size / CHAPTERS.length) * 100);
  $('learn-progress').style.setProperty('--pct', `${pct}%`);
  $('learn-progress-label').textContent = `${done.size} of ${CHAPTERS.length} chapters done`;
}

function show(i) {
  stop();
  current = Math.max(0, Math.min(CHAPTERS.length - 1, i));
  store.set('learnChapter', current);
  const c = CHAPTERS[current];
  $('learn-eyebrow').textContent = `Chapter ${current + 1} of ${CHAPTERS.length}`;
  $('learn-title').textContent = c.title;
  $('learn-body').innerHTML = `
    ${c.body}
    ${c.examples.map((x, j) => `
      <figure class="example">
        <div class="sheet-paper example-sheet" id="learn-ex-${j}"></div>
        <figcaption><span>${x.caption}</span>
          <button class="btn btn-small btn-ghost" data-ex="${j}">▶ Listen</button></figcaption>
      </figure>`).join('')}
    ${c.practice ? `<p class="practice-link"><a class="btn" href="${c.practice.href}">Try it: ${c.practice.label} →</a></p>` : ''}
    <section class="check" aria-labelledby="check-title">
      <h3 id="check-title">Check yourself</h3>
      <div id="check-body"></div>
    </section>`;
  c.examples.forEach((x, j) => {
    x.score = buildScore(x.piece);
    renderScore($(`learn-ex-${j}`), x.score, { noteNames: !!x.names });
  });
  startCheck();
  $('learn-prev').disabled = current === 0;
  $('learn-next').hidden = current === CHAPTERS.length - 1;
  renderToc();
  // Back to the top of the new chapter, but only if it's scrolled out of sight
  // (otherwise opening the page would scroll the top bar and welcome banner away).
  if ($('view-learn').getBoundingClientRect().top < 0) $('view-learn').scrollIntoView({ block: 'start' });
}

// ------------------------------------------------------------ check yourself

const isDone = () => doneSet().has(CHAPTERS[current].id);

/** A fresh set of questions for this chapter. */
function startCheck(focus = false) {
  const questions = CHECKS[CHAPTERS[current].id]();
  check = { questions, tries: questions.map(() => 0), solved: questions.map(() => false) };
  $('check-body').innerHTML = `
    <p class="muted small">${isDone() ? 'You’ve passed this chapter. Try again any time for a refresher.'
      : 'Answer these to finish the chapter. One slip is fine.'}</p>
    <ol class="check-list">
      ${questions.map((q, i) => `
        <li class="check-q">
          <p class="check-text" id="check-text-${i}">${q.text}</p>
          ${q.piece ? `<div class="sheet-paper example-sheet check-sheet" id="check-sheet-${i}"></div>` : ''}
          <div class="ear-answers check-choices" role="group" aria-labelledby="check-text-${i}">
            ${q.choices.map((ch) => `<button class="btn btn-ghost" data-q="${i}" data-choice="${ch}">${ch}</button>`).join('')}
          </div>
          <p class="status check-why" id="check-why-${i}" aria-live="polite"></p>
        </li>`).join('')}
    </ol>
    <div id="check-result" class="check-result" aria-live="polite"></div>`;
  questions.forEach((q, i) => {
    if (q.piece) renderScore($(`check-sheet-${i}`), buildScore(q.piece), { showTime: !!q.showTime });
  });
  if (focus) $('check-body').querySelector('button[data-choice]')?.focus();
}

function answer(i, btn) {
  const q = check.questions[i];
  if (check.solved[i] || btn.disabled) return;
  const why = $(`check-why-${i}`);
  if (btn.dataset.choice === q.answer) {
    check.solved[i] = true;
    btn.classList.add('is-right');
    btn.closest('.check-choices').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    why.dataset.tone = 'good';
    why.textContent = `${check.tries[i] ? 'Yes, now you’ve got it.' : 'Right!'} ${q.why}`.trim();
    if (check.solved.every(Boolean)) finishCheck();
  } else {
    check.tries[i]++;
    btn.classList.add('is-wrong');
    btn.disabled = true;
    why.dataset.tone = 'bad';
    why.textContent = `Not ${btn.dataset.choice}. Try again.`;
  }
}

function finishCheck() {
  const total = check.questions.length;
  const first = check.tries.filter((n) => n === 0).length;
  const passed = first >= total - 1;
  const last = current === CHAPTERS.length - 1;
  if (passed) {
    markDone(CHAPTERS[current].id);
    renderToc();
  }
  $('check-result').dataset.tone = passed ? 'good' : 'bad';
  $('check-result').innerHTML = passed
    ? `<p><strong>Chapter done ✓</strong> ${first} of ${total} right first time.${last && doneSet().size === CHAPTERS.length ? ' That’s every chapter. Well done!' : ''}</p>
       ${last ? '' : '<button class="btn" data-action="next-chapter">Next chapter →</button>'}`
    : `<p>${first} of ${total} right first time. Read the chapter again, then try a new set of questions.</p>
       <button class="btn" data-action="new-check">New questions</button>`;
}

// ------------------------------------------------------------ examples

function playExample(j, btn) {
  const wasPlaying = stopPlay?.btn === btn;
  stop();
  if (wasPlaying) return;
  const { score } = CHAPTERS[current].examples[j];
  const steps = score.steps.map((s) => ({
    beats: s.beats,
    notes: s.events.flatMap((e) => e.midis.map((midi, k) => ({ midi, beats: e.play, velocity: e.vel, name: e.names[k] }))),
  }));
  // Rests at the very start: delay the first note.
  if (score.steps[0]?.time > 0) steps.unshift({ beats: score.steps[0].time, notes: [] });
  const offset = steps.length - score.steps.length;
  btn.textContent = '■ Stop';
  stopPlay = audio.playSequence(steps, {
    bpm: score.piece.bpm,
    onStep: (i) => {
      kb.showPlayed(steps[i].notes, 60 / score.piece.bpm);
      score.steps.forEach((s, k) => s.events.forEach((e) => e.el?.classList.toggle('current', k === i - offset)));
    },
    onDone: stop,
  });
  stopPlay.btn = btn;
}

function stop() {
  if (!stopPlay) return;
  stopPlay();
  stopPlay.btn.textContent = '▶ Listen';
  stopPlay = null;
  kb.clear('demo');
  document.querySelectorAll('#learn-body .current').forEach((el) => el.classList.remove('current'));
}
