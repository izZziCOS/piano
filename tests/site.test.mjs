// End-to-end tests: serve site/ locally and drive a real Chrome.
// Run with `npm test`. Set CHROME_PATH if Chrome isn't in a standard location.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain', '.png': 'image/png',
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
}

let server;
let browser;
let base;
const problems = []; // console errors/warnings, page errors, failed requests — across all tests

before(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

// Each page gets a fresh profile, so saved progress/stats don't leak between tests.
async function open(hash, { width = 1366, height = 900, mobile = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${hash}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning') problems.push(`[${hash}] console.${m.type()}: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`[${hash}] request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${hash}] HTTP ${r.status()}: ${r.url()}`); });
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  await page.goto(base + hash, { waitUntil: 'networkidle0' });
  return page;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const clickKey = async (page, midi) => {
  await page.$eval(`.key[data-midi="${midi}"]`, (e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const box = await page.$(`.key[data-midi="${midi}"]`).then((e) => e.boundingBox());
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
};

test('every section opens', async () => {
  const page = await open('#learn');
  for (const view of ['learn', 'sheet', 'quiz', 'scales', 'play']) {
    await page.goto(base + '#' + view);
    await wait(150);
    assert.equal(await page.$eval(`#view-${view}`, (e) => e.hidden), false, `#view-${view} visible`);
  }
  // Old Lessons links go to Sheet music.
  await page.goto(base + '#lessons');
  await wait(150);
  assert.equal(await page.$eval('#view-sheet', (e) => e.hidden), false);
  await page.close();
});

test('full 88-key piano from A0 to C8', async () => {
  const page = await open('#play');
  const midis = await page.$$eval('.key', (ks) => ks.map((k) => +k.dataset.midi));
  assert.equal(midis.length, 88);
  assert.equal(Math.min(...midis), 21);
  assert.equal(Math.max(...midis), 108);
  await page.close();
});

test('piano samples load', async () => {
  const page = await (await browser.createBrowserContext()).newPage();
  const mp3 = [];
  page.on('response', (r) => { if (r.url().endsWith('.mp3')) mp3.push(r.status()); });
  await page.goto(base + '#play', { waitUntil: 'networkidle0' });
  await wait(500);
  assert.equal(mp3.length, 30, '30 samples requested');
  assert.ok(mp3.every((s) => s === 200), 'all samples served');
  assert.equal(await text(page, '#sound-status'), '', 'no loading/failed message once loaded');
  await page.close();
});

test('sustain pedal follows the space bar', async () => {
  const page = await open('#play');
  await page.keyboard.down('Space');
  assert.equal(await page.$eval('#pedal-btn', (b) => b.getAttribute('aria-pressed')), 'true');
  await page.keyboard.up('Space');
  assert.equal(await page.$eval('#pedal-btn', (b) => b.getAttribute('aria-pressed')), 'false');
  await page.click('#pedal-btn');
  assert.equal(await page.$eval('#pedal-btn', (b) => b.getAttribute('aria-pressed')), 'true', 'click latches');
  await page.close();
});

test('every library piece renders as notation', async () => {
  const page = await open('#sheet');
  const ids = await page.$$eval('#sheet-list button[data-id]', (bs) => bs.map((b) => b.dataset.id));
  assert.ok(ids.length >= 15, `library has ${ids.length} entries`);
  for (const id of ids.filter((i) => i !== 'weak')) {
    await page.click(`#sheet-list button[data-id="${id}"]`);
    await wait(100);
    const notes = await page.$$eval('#sheet .vf-stavenote', (n) => n.length);
    assert.ok(notes > 4, `${id} draws notes (got ${notes})`);
  }
  await page.close();
});

test('play mode advances when the right notes are played', async () => {
  const page = await open('#sheet/minuet-g?mode=play');
  const first = await page.$$eval('.key.target', (ks) => ks.map((k) => +k.dataset.midi).sort((a, b) => a - b));
  assert.deepEqual(first, [55, 59, 74], 'G3+B3 in the left hand, D5 in the right');
  await clickKey(page, 60); // wrong note
  assert.match(await text(page, '#sheet-status'), /That was C4/);
  for (const m of first) await clickKey(page, m);
  await wait(100);
  assert.deepEqual(await page.$$eval('.key.target', (ks) => ks.map((k) => +k.dataset.midi)), [67], 'next step is G4');
  await page.close();
});

test('name-the-notes grading, including key signatures', async () => {
  const page = await open('#sheet/canon-d?mode=name');
  await page.select('#sheet-hands', 'rh');
  await page.focus('#sheet-answer');
  await page.keyboard.press('f');
  assert.match(await text(page, '#sheet-score'), /^0 \/ 0/, 'waits for the accidental after F');
  await page.keyboard.type('#'); // F♯ from the key signature
  await wait(600);
  assert.match(await text(page, '#sheet-score'), /^1 \/ 1/);
  await page.keyboard.press('e');
  await wait(600);
  await page.keyboard.press('d');
  await wait(600);
  await page.keyboard.press('c');
  await page.keyboard.press('Enter'); // C natural, but the note is C♯
  assert.match(await text(page, '#sheet-status'), /C♯5/);
  await wait(1600);
  assert.match(await text(page, '#sheet-score'), /^3 \/ 4/);
  assert.equal(await page.$$eval('#sheet .vf-stavenote.missed', (n) => n.length), 1);
  // Typing into the answer box must not play the piano.
  assert.equal(await page.$$eval('.key.pressed', (k) => k.length), 0);
  // The on-screen pad works too.
  await page.click('#sheet-pad button[data-key="B"]');
  await wait(600);
  assert.match(await text(page, '#sheet-score'), /^4 \/ 5/);
  await page.close();
});

test('timed mode shows a clock and keeps going', async () => {
  const page = await open('#sheet/random?mode=name&clef=treble&keys=c&keymode=major&range=staff&chords=0&accidentals=0');
  await page.select('#sheet-timer', '60');
  await wait(200);
  assert.match(await text(page, '#sheet-status'), /Speed test/);
  await page.focus('#sheet-answer');
  await page.keyboard.press('c');
  await wait(300);
  assert.match(await text(page, '#sheet-score'), /⏱ 0:5\d|⏱ 1:00/);
  await page.close();
});

test('random sheets: many setting combinations generate valid music', async () => {
  const page = await open('#sheet');
  const result = await page.evaluate(async () => {
    const { randomSheet } = await import('./js/generator.js');
    const { buildScore } = await import('./js/sheet.js');
    const bad = [];
    let count = 0;
    for (const clef of ['treble', 'bass', 'grand']) {
      for (const keys of ['c', 'easy', 'medium', 'hard']) {
        for (const mode of ['major', 'minor', 'both']) {
          for (const rhythm of ['simple', 'varied']) {
            for (const time of ['4/4', '3/4']) {
              const settings = { clef, keys, mode, rhythm, time, range: 'wide', chords: true, accidentals: true };
              const piece = { id: 'gen', bpm: 80, ...randomSheet(settings) };
              const score = buildScore(piece);
              count++;
              if (!score.steps.length) bad.push(`${JSON.stringify(settings)}: no notes`);
              const tokens = `${piece.rh ?? ''} ${piece.lh ?? ''}`;
              if (/E#|B#|Cb|Fb/.test(tokens)) bad.push(`odd spelling in ${tokens}`);
            }
          }
        }
      }
    }
    return { bad, count };
  });
  assert.equal(result.count, 144);
  assert.deepEqual(result.bad, []);
  // And the builder renders them.
  for (const [field, value] of [['gen-range', 'wide'], ['gen-rhythm', 'varied'], ['gen-keys', 'hard'], ['gen-mode', 'minor'], ['gen-clef', 'grand']]) {
    await page.click('#sheet-list button[data-id="random"]');
    await page.select(`#${field}`, value);
    await wait(150);
    assert.ok(await page.$$eval('#sheet .vf-stavenote', (n) => n.length) > 8, `renders with ${field}=${value}`);
  }
  await page.close();
});

test('missed notes come back in the weak-notes sheet', async () => {
  const page = await open('#sheet/weak');
  assert.match(await text(page, '#sheet'), /Not enough history/);
  // Miss three notes on purpose in the treble C-position exercise (C D E …), answering G each time.
  await page.goto(base + '#sheet/rh-c-position?mode=name');
  await wait(200);
  await page.focus('#sheet-answer');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('g'); await wait(1600); }
  await page.goto(base + '#sheet/weak');
  await wait(300);
  const notes = await page.$$eval('#sheet .vf-stavenote', (n) => n.length);
  assert.ok(notes > 0, 'weak-notes sheet is drawn');
  await page.close();
});

test('scales and chords are spelled correctly', async () => {
  const page = await open('#scales');
  const notesOf = async (root, type) => {
    await page.select('#scale-root', String(root));
    await page.select('#scale-type', type);
    await wait(50);
    return page.$$eval('#scale-notes .chip', (c) => c.map((x) => x.textContent).join(' '));
  };
  assert.equal(await notesOf(2, 'harmonic'), 'D E F G A B♭ C♯ D');
  assert.equal(await notesOf(5, 'major'), 'F G A B♭ C D E F');
  assert.equal(await notesOf(0, 'blues'), 'C E♭ F G♭ G B♭ C');
  assert.equal(await notesOf(1, 'min'), 'C♯ E G♯');
  assert.equal(await notesOf(10, 'dom7'), 'B♭ D F A♭');
  await page.close();
});

test('every Learn chapter renders its examples', async () => {
  const page = await open('#learn');
  const chapters = await page.$$eval('#learn-toc button', (b) => b.length);
  assert.equal(chapters, 11);
  for (let i = 0; i < chapters; i++) {
    await page.click(`#learn-toc button[data-i="${i}"]`);
    await wait(80);
    const figures = await page.$$eval('#learn-body figure', (f) => f.length);
    const drawn = await page.$$eval('#learn-body figure svg', (s) => s.length);
    assert.ok(figures > 0 && drawn === figures, `chapter ${i + 1}: ${drawn}/${figures} examples drawn`);
  }
  await page.close();
});

test('note quiz accepts the right key and records it', async () => {
  const page = await open('#quiz');
  // Press all 12 keys of one octave: exactly one is correct, the score must end at 0/1 or 1/1.
  for (let m = 60; m < 72; m++) await clickKey(page, m);
  await wait(200);
  assert.match(await text(page, '#quiz-score'), /^[01] \/ 1$/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).noteStats);
  assert.ok(stored && Object.keys(stored).length >= 1, 'answer saved to note stats');
  await page.close();
});

test('phone layout has no sideways scrolling', async () => {
  for (const hash of ['#learn', '#sheet/twinkle-hands', '#sheet/random?mode=name', '#quiz', '#scales']) {
    const page = await open(hash, { width: 390, height: 844, mobile: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${hash} overflows by ${overflow}px`);
    await page.close();
  }
});

test('no console errors, failed requests or warnings anywhere', () => {
  assert.deepEqual(problems, []);
});
