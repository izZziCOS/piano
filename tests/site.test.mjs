// End-to-end tests: serve site/ locally and drive a real Chrome.
// Run with `npm test`. Set CHROME_PATH if Chrome isn't in a standard location.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain', '.png': 'image/png', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
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
let offline = false; // when true, the server drops every connection, as if the network were gone
let swBuild = null; // when set, sw.js is served as if deployed with this commit id
let keepFiles = false; // when true, files are sent as cacheable for an hour (like most static hosts)
const requested = []; // paths asked for while keepFiles is on
let browser;
let base;
const problems = []; // console errors/warnings, page errors, failed requests — across all tests

before(async () => {
  server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      if (swBuild && url === '/sw.js') data = data.toString().replace("const BUILD = 'dev';", `const BUILD = '${swBuild}';`);
      const headers = { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
      if (keepFiles) { headers['Cache-Control'] = 'max-age=3600'; requested.push(url); }
      res.writeHead(200, headers).end(data);
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
// `init` runs in the page before any of the site's scripts.
async function open(hash, { width = 1366, height = 900, mobile = false, init, initArg } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (init) await page.evaluateOnNewDocument(init, initArg);
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
/** Wait until `fn()` is true (checked every 50 ms). */
async function until(fn, timeout = 5000, what = 'condition') {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await wait(50);
  }
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const clickKey = async (page, midi) => {
  await page.$eval(`.key[data-midi="${midi}"]`, (e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const box = await page.$(`.key[data-midi="${midi}"]`).then((e) => e.boundingBox());
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
};

test('every section opens', async () => {
  const page = await open('#learn');
  for (const view of ['learn', 'sheet', 'quiz', 'ear', 'scales', 'play', 'progress']) {
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
  assert.equal(mp3.length, 90, '30 notes × 3 dynamic layers requested');
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
  assert.equal(chapters, 12);
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
  for (const hash of ['#learn', '#sheet/twinkle-hands', '#sheet/random?mode=name', '#sheet/minuet-g?mode=tempo', '#quiz', '#scales']) {
    const page = await open(hash, { width: 390, height: 844, mobile: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${hash} overflows by ${overflow}px`);
    await page.close();
  }
});

test('keyboard hints can be turned off and come back when stuck', async () => {
  const page = await open('#sheet/rh-c-position?mode=play');
  await page.select('#sheet-hints', 'off');
  await wait(100);
  assert.equal(await page.$$eval('.key.target', (k) => k.length), 0, 'no hint with hints off');
  await clickKey(page, 62); // wrong (expects C4)
  assert.equal(await page.$$eval('.key.target', (k) => k.length), 0, 'still no hint after one miss');
  assert.doesNotMatch(await text(page, '#sheet-status'), /Next: C4/);
  await clickKey(page, 64); // second miss
  assert.deepEqual(await page.$$eval('.key.target', (k) => k.map((x) => +x.dataset.midi)), [60], 'hint shown after two misses');

  // Fade: hints disappear after three clean notes in a row.
  await page.select('#sheet-hints', 'fade');
  await page.click('#sheet-restart');
  await wait(100);
  for (const m of [60, 62, 64]) {
    assert.equal(await page.$$eval('.key.target', (k) => k.length), 1, 'hint visible while learning');
    await clickKey(page, m);
  }
  await wait(100);
  assert.equal(await page.$$eval('.key.target', (k) => k.length), 0, 'hint faded after 3 in a row');
  await page.close();
});

/** A robot player: press each key the moment its hint appears, skipping every `skip`-th note (0: none). */
function startRobot(page, skip = 0) {
  return page.evaluate((skipEvery) => {
    let n = 0;
    new MutationObserver((muts) => {
      // classList.remove() queues a record even when nothing changes, so look at each key once per batch.
      const fresh = new Set(muts.filter((m) => !(m.oldValue ?? '').includes('target')).map((m) => m.target));
      for (const k of fresh) {
        if (!k.classList.contains('target')) continue;
        if (skipEvery && ++n % skipEvery === 0) continue;
        k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, button: 0 }));
        setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 })), 50);
      }
    }).observe(document.getElementById('keyboard'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }, skip);
}

test('at-tempo mode scores timing, including missed notes', async () => {
  const page = await open('#sheet/rh-c-position?mode=tempo');
  await page.select('#sheet-hints', 'always');
  await page.$eval('#sheet-tempo', (e) => { e.value = 140; e.dispatchEvent(new Event('input')); });
  await startRobot(page, 6); // skips every 6th note
  await page.click('#sheet-start');
  await page.waitForFunction(() => !document.getElementById('sheet-result').hidden, { timeout: 20000 });
  const result = await text(page, '#sheet-result');
  const num = (re) => +(result.match(re)?.[1] ?? -1);
  const ontime = num(/(\d+) on time/);
  const missed = num(/(\d+) missed/);
  assert.ok(missed >= 2, `skipped notes count as missed (${result})`);
  assert.ok(ontime >= 10, `notes played on the beat count as on time (${result})`);
  assert.doesNotMatch(result, /wrong/, 'no wrong notes were played');
  assert.ok(await page.$$eval('#sheet .vf-stavenote.missed', (n) => n.length) >= 2, 'missed notes marked red');
  await page.close();
});

test('notation: fingering, ties, dynamics and repeats', async () => {
  const page = await open('#sheet/rh-c-position?mode=play');
  const svgText = await page.$$eval('#sheet svg text', (t) => t.map((x) => x.textContent));
  assert.ok(['1', '2', '3', '4', '5'].every((f) => svgText.includes(f)), 'finger numbers drawn');
  assert.ok(svgText.includes('mf'), 'dynamic drawn');
  await page.goto(base + '#sheet/ode-full?mode=play');
  await wait(200);
  assert.ok(await page.$$eval('#sheet .vf-stavetie', (t) => t.length) >= 1, 'tie drawn');
  // A tied note is one note: the reading test asks for it once.
  await page.goto(base + '#sheet/minuet-g?mode=name');
  await wait(200);
  assert.match(await text(page, '#sheet-score'), /45 left/, 'repeated section is named once (45 noteheads)');
  await page.close();
});

test('note quiz is drawn with VexFlow', async () => {
  const page = await open('#quiz');
  assert.equal(await page.$$eval('#quiz-staff .vf-stavenote', (n) => n.length), 1);
  assert.equal(await page.$$eval('#quiz-staff .vf-clef', (n) => n.length), 1);
  await page.close();
});

test('ear training: intervals, notes and melodies', async () => {
  const page = await open('#ear');
  await page.select('#ear-type', 'interval');
  await wait(100);
  const buttons = await page.$$('#ear-answers button');
  for (const b of buttons) {
    await b.click();
    if (/Correct|That’s it/.test(await text(page, '#ear-status'))) break;
  }
  assert.match(await text(page, '#ear-status'), /Correct|That’s it/);
  assert.equal(await text(page, '#ear-score'), /That’s it/.test(await text(page, '#ear-status')) ? '0 / 1' : '1 / 1');

  await page.select('#ear-type', 'melody');
  await wait(100);
  await page.click('#ear-reveal');
  const notes = await page.$$eval('.key.target', (k) => k.map((x) => +x.dataset.midi));
  assert.ok(notes.length >= 1, 'answer shown on the keyboard');
  const melody = (await text(page, '#ear-status')).match(/melody: (.*)\. Play/)[1].split(' ');
  assert.equal(melody.length, 3);
  await page.close();
});

test('progress page: goal, calendar, heatmap and speed chart', async () => {
  const page = await open('#sheet/rh-c-position?mode=name');
  await page.focus('#sheet-answer');
  for (const k of 'cdefg') { await page.keyboard.press(k); await wait(550); }
  assert.match(await text(page, '#goal-chip'), /^5\/50/, 'top-bar goal counts answers');
  // Seed a few speed tests so the chart has data.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('piano-practice:v1'));
    all.speedHistory = [
      { at: Date.now() - 3 * 864e5, npm: 18, accuracy: 80, seconds: 60 },
      { at: Date.now() - 2 * 864e5, npm: 24, accuracy: 85, seconds: 60 },
      { at: Date.now() - 864e5, npm: 31, accuracy: 92, seconds: 60 },
    ];
    localStorage.setItem('piano-practice:v1', JSON.stringify(all));
  });
  // The page keeps what it read from storage in memory, so load it again to see the seeded tests.
  await page.goto(base + '#progress');
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(300);
  assert.equal(await text(page, '#goal-today'), '5');
  assert.equal(await page.$$eval('#calendar .day:not(.pad)', (d) => d.length), 35);
  assert.equal(await page.$$eval('#calendar .day.l1', (d) => d.length), 1, 'today shows some practice');
  assert.equal(await page.$$eval('#heat-treble .vf-stavenote.heat', (n) => n.length), 5, 'five notes coloured');
  assert.ok(await page.$$eval('#heat-treble .vf-stavenote.unseen', (n) => n.length) > 10);
  assert.equal(await page.$$eval('#speed-chart .dot', (d) => d.length), 3);
  const hit = await page.$('#speed-chart .hit');
  await hit.evaluate((e) => e.scrollIntoView({ block: 'center' })); // keep it clear of the piano dock
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await wait(50);
  assert.match(await text(page, '#chart-tip'), /31 correct notes\/min/);
  assert.equal(await page.$$eval('#speed-table tbody tr', (r) => r.length), 3, 'table view');
  await page.close();
});

test('progress syncs between two devices through a GitHub gist', async () => {
  // A fake GitHub API shared by both "devices".
  const gists = new Map();
  const calls = [];
  const mockGitHub = async (page) => {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.host !== 'api.github.com') { r.continue(); return; }
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept', 'Access-Control-Allow-Methods': 'GET, POST, PATCH' };
      if (r.method() === 'OPTIONS') { r.respond({ status: 204, headers: cors }); return; }
      const json = (body) => r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      calls.push(`${r.method()} ${url.pathname} ${r.headers().authorization}`);
      const id = url.pathname.split('/')[2];
      if (url.pathname === '/user') json({ login: 'pianist' });
      else if (url.pathname === '/gists' && r.method() === 'GET') json([{ id: 'other', files: { 'notes.md': {} } }, ...gists.values()]);
      else if (url.pathname === '/gists' && r.method() === 'POST') {
        const body = JSON.parse(r.postData());
        assert.equal(body.public, false, 'the gist is secret');
        const gist = { id: `g${gists.size + 1}`, files: body.files };
        gists.set(gist.id, gist);
        json(gist);
      } else if (r.method() === 'GET') json(gists.get(id));
      else if (r.method() === 'PATCH') { gists.get(id).files = JSON.parse(r.postData()).files; json(gists.get(id)); }
    });
  };
  const seed = (page, data) => page.evaluate((d) => {
    localStorage.setItem('piano-practice:v1', JSON.stringify({ ...d, volume: d.volume }));
  }, data);
  const todayKey = await (async () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const remote = () => JSON.parse(gists.get('g1').files['piano-practice.json'].content).progress;

  // Device A: some old practice, then connect. A new secret gist is created.
  const a = await open('#progress');
  await mockGitHub(a);
  await seed(a, {
    practiceLog: { '2026-01-01': 30 }, volume: 0.2,
    noteStats: { 'treble:C4': { seen: 3, missed: 1, box: 1, last: Date.now(), ms: 1000 } },
  });
  await a.reload();
  await wait(200);
  await a.type('#sync-token', 'ghp_test');
  await a.click('#sync-form button');
  await a.waitForFunction(() => /Connected/.test(document.getElementById('sync-status').textContent));
  assert.ok(!(await a.$eval('#sync-on', (e) => e.hidden)), 'shows the connected state');
  assert.equal(await text(a, '#sync-login'), '@pianist');
  assert.deepEqual(remote().practiceLog, { '2026-01-01': 30 });
  assert.equal(remote().volume, undefined, 'device settings are not synced');
  assert.ok(calls.every((c) => c.endsWith('Bearer ghp_test')), 'token sent to GitHub');

  // Device B: its own practice today. Connecting finds the same gist and merges both ways.
  const b = await open('#progress');
  await mockGitHub(b);
  await seed(b, {
    practiceLog: { [todayKey]: 7 },
    noteStats: { 'bass:F3': { seen: 2, missed: 0, box: 2, last: Date.now(), ms: 900 } },
  });
  await b.reload();
  await wait(200);
  await b.type('#sync-token', 'ghp_test');
  await b.click('#sync-form button');
  await b.waitForFunction(() => /other devices was added/.test(document.getElementById('sync-status').textContent));
  assert.equal(gists.size, 1, 'no second gist');
  assert.deepEqual(remote().practiceLog, { '2026-01-01': 30, [todayKey]: 7 }, 'gist has both devices');
  assert.equal(await b.$$eval('#heat-treble .vf-stavenote.heat', (n) => n.length), 1, "device A's C4 shows on B");
  assert.equal(await b.$$eval('#heat-bass .vf-stavenote.heat', (n) => n.length), 1);
  assert.ok(!JSON.stringify(remote()).includes('ghp_'), 'the token is never uploaded');
  assert.ok(!(await b.evaluate(() => localStorage.getItem('piano-practice:v1'))).includes('ghp_'));

  // Back on A: syncing brings in B's practice today.
  await a.click('#sync-now');
  await a.waitForFunction(() => document.getElementById('goal-today').textContent === '7');
  assert.match(await text(a, '#goal-chip'), /^7\//);

  // Leaving the page does a full sync: progress another device uploaded in the
  // meantime stays in the gist instead of being overwritten.
  const file = gists.get('g1').files['piano-practice.json'];
  const content = JSON.parse(file.content);
  content.progress.practiceLog['2026-02-02'] = 5; // uploaded by a third device
  file.content = JSON.stringify(content);
  await a.select('#goal-select', '100'); // a change on A, waiting to be synced
  await a.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await until(() => remote().dailyGoal === 100, 5000, 'the goal change to reach the gist');
  assert.equal(remote().practiceLog['2026-02-02'], 5, "the other device's practice is kept");
  assert.equal(remote().practiceLog[todayKey], 7);

  // Your own pieces merge per piece: the newest edit or deletion wins.
  const pieces = await a.evaluate(async () => {
    const { merge } = await import('./js/sync.js');
    return merge(
      { ownPieces: [{ id: 'a', title: 'Old', updatedAt: 1 }, { id: 'b', title: 'B', updatedAt: 5 }] },
      { ownPieces: [{ id: 'a', title: 'New', updatedAt: 2 }, { id: 'b', deleted: true, updatedAt: 6 }, { id: 'c', title: 'C', updatedAt: 3 }] },
    ).ownPieces;
  });
  assert.deepEqual(pieces.map((p) => `${p.id}:${p.deleted ? 'deleted' : p.title}`).sort(), ['a:New', 'b:deleted', 'c:C']);

  // Disconnecting forgets the token on that device only.
  await a.click('#sync-disconnect');
  assert.ok(!(await a.$eval('#sync-off', (e) => e.hidden)));
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:sync')).token), undefined);
  await a.close();
  await b.close();
});

test('note quiz: response time, notes per minute and a speed test', async () => {
  // With Math.random fixed at 0 the quiz alternates C4, D4, C4, D4… on the treble staff.
  const page = await open('#quiz', { init: () => { Math.random = () => 0; } });
  const prompt = () => text(page, '#quiz-prompt');
  await clickKey(page, 60);
  assert.match(await prompt(), /^Correct, that’s C4 · \d+\.\d s$/, 'answer time shown');
  await until(async () => /^Play this note/.test(await prompt()));
  await clickKey(page, 62);
  await until(async () => /^Play this note/.test(await prompt()));
  assert.match(await text(page, '#quiz-time'), /^\d+\.\d s$/, 'average time');
  assert.equal(await text(page, '#quiz-npm'), '–', 'notes per minute waits for a few answers');
  await clickKey(page, 60);
  await until(async () => /^Play this note/.test(await prompt()));
  assert.equal(await text(page, '#quiz-score'), '3 / 3');
  assert.match(await text(page, '#quiz-npm'), /^\d+$/, 'notes per minute');

  // A short speed test (a 3-second option added just for the test).
  await page.evaluate(() => {
    const timer = document.getElementById('quiz-timer');
    timer.add(new Option('3 seconds', '3'));
    timer.value = '3';
    timer.dispatchEvent(new Event('change'));
  });
  assert.match(await text(page, '#quiz-clock'), /0:03 · speed test: the clock starts with your first note/);
  assert.equal(await text(page, '#quiz-score'), '0 / 0', 'a new test starts from zero');
  let next = 60; // D4 was showing, so the test starts on C4
  while (await page.$eval('#quiz-result', (e) => e.hidden)) {
    await until(async () => /^(Play this note|Time)/.test(await prompt()) || !(await page.$eval('#quiz-result', (e) => e.hidden)), 5000, 'the next question');
    if (!(await page.$eval('#quiz-result', (e) => e.hidden))) break;
    await clickKey(page, next);
    next = next === 60 ? 62 : 60;
    await until(async () => !/^Play this note/.test(await prompt()) || !(await page.$eval('#quiz-result', (e) => e.hidden)), 5000, 'the answer');
  }
  const result = await text(page, '#quiz-result');
  assert.match(result, /\d+ correct notes? per minute · 100% accuracy · new record/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')));
  assert.equal(saved.speedHistory.at(-1).piece, 'quiz', 'speed test recorded');
  assert.ok(saved.bestSpeed['quiz:treble:3'] > 0, 'best speed kept per setting');

  // The Progress page shows quiz speed tests separately from reading tests.
  await page.goto(base + '#progress');
  await wait(200);
  assert.equal(await page.$eval('#speed-source', (e) => e.value), 'quiz', 'shows the latest kind of test');
  assert.match(await text(page, '#speed-chart'), /One speed test so far/);
  await page.select('#speed-source', 'name');
  assert.match(await text(page, '#speed-chart'), /No speed tests yet/);
  await page.close();
});

test('at tempo: loop a few bars and speed up after clean passes', async () => {
  const page = await open('#sheet/rh-c-position?mode=tempo');
  await page.select('#sheet-hints', 'always');
  await page.$eval('#sheet-tempo', (e) => { e.value = 120; e.dispatchEvent(new Event('input')); });
  await page.select('#sheet-from', '1');
  await page.select('#sheet-to', '2'); // bars 2–3: eight quarter notes
  assert.match(await text(page, '#sheet-status'), /bars 2–3/);
  assert.equal(await page.$$eval('#sheet .vf-stavenote:not(.outside)', (n) => n.length), 8, 'the passage stays clear');
  assert.equal(await page.$$eval('#sheet .vf-stavenote.outside', (n) => n.length), 9, 'the other bars fade');
  await page.click('#sheet-loop');
  await page.select('#sheet-speedup', '4');
  await startRobot(page);
  await page.click('#sheet-start');
  await page.waitForFunction(() => /^Pass 1:/.test(document.getElementById('sheet-loop-log').textContent), { timeout: 15000 });
  const log1 = await text(page, '#sheet-loop-log');
  assert.match(log1, /^Pass 1: 8 on time · 0 early · 0 late · 0 missed\. Clean pass! Next pass at 124 bpm\.$/);
  await page.waitForFunction(() => /^Pass 2:/.test(document.getElementById('sheet-loop-log').textContent), { timeout: 15000 });
  assert.match(await text(page, '#sheet-loop-log'), /Clean pass! Next pass at 128 bpm/);
  assert.equal(await text(page, '#sheet-bpm'), '128');
  assert.equal(await page.$eval('#sheet-result', (e) => e.hidden), true, 'no result card while looping');
  await page.click('#sheet-start'); // Stop
  assert.equal(await text(page, '#sheet-loop-log'), 'Stopped after 2 passes, 2 clean, tempo 120 → 128 bpm.');
  assert.equal(await text(page, '#sheet-start'), '▶ Start');
  await page.close();
});

test('your own pieces: write, check, save, play, edit and delete', async () => {
  const page = await open('#sheet');
  page.on('dialog', (d) => d.accept()); // the delete confirmation
  const setField = (id, value) => page.$eval(id, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const errors = async () => { await wait(400); return text(page, '#own-errors'); };

  await page.click('#own-add');
  assert.equal(await page.$eval('#own-dialog', (d) => d.open), true);
  await page.type('#own-title', 'My tune');
  await setField('#own-rh', 'C4 D4 E4 F4:2 | G4:4');
  assert.match(await errors(), /Right hand, bar 1: F4 \(2 beats\) runs past the bar line/);
  await setField('#own-rh', 'C4 D4 E4 F4 | g4:4');
  assert.match(await errors(), /“g4:4” isn’t a note I can read\. Write note letters as capitals/);
  await setField('#own-rh', 'C4 D4 E4 F4:3');
  assert.match(await errors(), /3 beats long|runs past/);
  await setField('#own-rh', '!mf C4@1 D4 E4 F4 | G4:4');
  await setField('#own-lh', 'C3+E3+G3:4 | C3+G3:4');
  assert.equal(await errors(), '', 'no problems');
  assert.equal(await page.$$eval('#own-preview .vf-stavenote', (n) => n.length), 7, 'preview drawn');
  await page.click('#own-save');
  await wait(300);
  assert.equal(await page.$eval('#own-dialog', (d) => d.open), false);
  assert.equal(await text(page, '#sheet-title'), 'My tune');
  assert.match(await text(page, '#sheet-list'), /Your pieces\s*My tune/);
  assert.equal(await page.$eval('#sheet-own', (e) => e.hidden), false, 'edit and delete shown');

  // Play it with the right hand.
  await page.select('#sheet-hands', 'rh');
  for (const m of [60, 62, 64, 65, 67]) await clickKey(page, m);
  await wait(200);
  assert.match(await text(page, '#sheet-result'), /100% accuracy/);

  // It's still there after a reload.
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(200);
  assert.equal(await text(page, '#sheet-title'), 'My tune');

  // Edit: rename it.
  await page.click('#sheet-edit');
  assert.equal(await page.$eval('#own-title', (e) => e.value), 'My tune');
  await setField('#own-title', 'My second tune');
  await page.click('#own-save');
  await wait(300);
  assert.equal(await text(page, '#sheet-title'), 'My second tune');
  assert.equal(await page.$$eval('#sheet-list .lesson-name', (n) => n.filter((x) => /My/.test(x.textContent)).length), 1, 'edited, not copied');

  // Delete it.
  await page.click('#sheet-delete');
  await wait(300);
  assert.doesNotMatch(await text(page, '#sheet-list'), /My second tune/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).ownPieces);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].deleted, true, 'a tombstone stops sync bringing it back');
  await page.close();
});

const WALTZ_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Little Waltz</work-title></work>
  <identification><creator type="composer">A. Tester</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>2</duration></backup>
      <note><rest/><duration>2</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    <measure number="1">
      <direction><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><staff>1</staff>
        <notations><technical><fingering>1</fingering></technical><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>
      <note><chord/><pitch><step>D</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>5</duration><voice>1</voice><staff>1</staff></note>
      <note><rest/><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

test('your own pieces: import MusicXML', async () => {
  const xml = WALTZ_XML;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-'));
  const file = path.join(dir, 'waltz.musicxml');
  fs.writeFileSync(file, xml);
  const page = await open('#sheet');
  await page.click('#own-add');
  await (await page.$('#own-file')).uploadFile(file);
  await page.waitForFunction(() => /Imported/.test(document.getElementById('own-import-status').textContent));
  const value = (id) => page.$eval(id, (e) => e.value);
  assert.equal(await value('#own-title'), 'Little Waltz');
  assert.equal(await value('#own-composer'), 'A. Tester');
  assert.equal(await value('#own-key'), 'G');
  assert.equal(await value('#own-time'), '3/4');
  assert.equal(await value('#own-bpm'), '100');
  assert.equal(await value('#own-pickup'), '1');
  assert.equal(await value('#own-rh'), 'D4 | !p G4@1~ G4:0.5 F#4:0.5 A4 | B4:2~ B4:0.5 R:0.5', 'tie, fingering, dynamic and a split 2.5-beat note');
  assert.equal(await value('#own-lh'), 'R | G2+D3:3 | R:3', 'chord, and an empty bar filled with a rest');
  assert.equal(await text(page, '#own-errors'), '');
  assert.ok(await page.$$eval('#own-preview .vf-stavenote', (n) => n.length) >= 8, 'preview drawn');
  await page.click('#own-save');
  await wait(300);
  assert.equal(await text(page, '#sheet-title'), 'Little Waltz');
  assert.match(await text(page, '#sheet-meta'), /3\/4 time · key of G major/);
  fs.rmSync(dir, { recursive: true, force: true });
  await page.close();
});

/** A zip file (as in .mxl) built by hand: `files` maps names to text; `store` names files kept uncompressed. */
function makeZip(files, { store = [] } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const method = store.includes(name) ? 0 : 8;
    const data = method ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32 ? zlib.crc32(raw) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(method, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBuf.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

test('your own pieces: import compressed MusicXML (.mxl)', async () => {
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score/waltz.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-'));
  // As MuseScore writes them: an uncompressed mimetype first, then the container and the score.
  fs.writeFileSync(path.join(dir, 'waltz.mxl'), makeZip({
    mimetype: 'application/vnd.recordare.musicxml',
    'META-INF/container.xml': container,
    'score/waltz.musicxml': WALTZ_XML,
  }, { store: ['mimetype'] }));
  // No container, and the score stored uncompressed: the first XML file is used.
  fs.writeFileSync(path.join(dir, 'plain.mxl'), makeZip({ 'waltz.xml': WALTZ_XML }, { store: ['waltz.xml'] }));
  fs.writeFileSync(path.join(dir, 'broken.mxl'), Buffer.from('PK this is not really a zip file'));
  const page = await open('#sheet');
  await page.click('#own-add');
  for (const name of ['waltz.mxl', 'plain.mxl']) {
    await page.$eval('#own-import-status', (e) => { e.textContent = ''; });
    await (await page.$('#own-file')).uploadFile(path.join(dir, name));
    await page.waitForFunction(() => /Imported/.test(document.getElementById('own-import-status').textContent));
    assert.equal(await page.$eval('#own-title', (e) => e.value), 'Little Waltz', name);
    assert.equal(await page.$eval('#own-rh', (e) => e.value), 'D4 | !p G4@1~ G4:0.5 F#4:0.5 A4 | B4:2~ B4:0.5 R:0.5', name);
  }
  await (await page.$('#own-file')).uploadFile(path.join(dir, 'broken.mxl'));
  await page.waitForFunction(() => /couldn’t be opened/.test(document.getElementById('own-import-status').textContent));
  assert.equal(await page.$eval('#own-import-status', (e) => e.dataset.tone), 'bad');
  fs.rmSync(dir, { recursive: true, force: true });
  await page.close();
});

test('VexFlow loads only when a page shows sheet music', async () => {
  const page = await open('#play');
  const vexRequested = () => page.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('vexflow')));
  assert.equal(await vexRequested(), false, 'not loaded for free play');
  await page.goto(base + '#ear');
  await wait(150);
  assert.equal(await vexRequested(), false, 'not loaded for ear training');
  await page.click('.tabs a[data-view="sheet"]');
  await page.waitForFunction(() => document.querySelectorAll('#sheet .vf-stavenote').length > 0);
  assert.equal(await page.$eval('#view-sheet', (e) => e.hidden), false);
  await page.close();
});

test('first visit: a welcome banner points to where to start, and can be dismissed', async () => {
  const page = await open('#learn');
  assert.equal(await page.$eval('#welcome', (e) => e.hidden), false, 'shown on a first visit');
  await page.click('#welcome a[href="#sheet/random"]');
  await page.waitForFunction(() => !document.getElementById('view-sheet').hidden);
  assert.equal(await page.$eval('#welcome', (e) => e.hidden), true, 'gone after following a link');
  assert.equal(await text(page, '#sheet-title'), 'Random sheet');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval('#welcome', (e) => e.hidden), true, 'stays dismissed');
  await page.close();

  const closing = await open('#play');
  await closing.click('.welcome-close');
  assert.equal(await closing.$eval('#welcome', (e) => e.hidden), true, 'the close button dismisses it');
  await closing.close();

  // Someone who has already practised (e.g. before this banner existed) doesn't see it.
  const returning = await open('#learn', {
    init: () => localStorage.setItem('piano-practice:v1', JSON.stringify({ learnDone: ['staff'] })),
  });
  assert.equal(await returning.$eval('#welcome', (e) => e.hidden), true);
  await returning.close();
});

test('Content-Security-Policy: the theme script is allowed, injected scripts are not', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'one inline script');
  const hash = `'sha256-${crypto.createHash('sha256').update(inline[0]).digest('base64')}'`;
  assert.ok(policy.includes(hash), `the policy allows the theme script: ${hash}`);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  const nginx = fs.readFileSync(path.join(ROOT, '..', 'nginx.conf'), 'utf8');
  const header = nginx.match(/add_header Content-Security-Policy "([^"]+)"/)[1];
  assert.equal(header, `${policy}; frame-ancestors 'none'`, 'nginx sends the same policy');

  // The theme script still runs under the policy.
  const page = await open('#learn', { init: () => localStorage.setItem('piano-practice:v1', '{"theme":"dark"}') });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  // Markup that sneaks in a script or an inline handler is blocked.
  const before = problems.length;
  const blocked = await page.evaluate(async () => {
    const seen = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.effectiveDirective));
    const box = document.createElement('div');
    box.innerHTML = '<img src="favicon.svg" onload="window.pwned = 1">';
    document.body.append(box);
    const s = document.createElement('script');
    s.textContent = 'window.pwned = 2';
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 300));
    return { pwned: window.pwned, seen };
  });
  assert.equal(blocked.pwned, undefined, 'nothing injected ran');
  assert.ok(blocked.seen.some((d) => d.startsWith('script-src')), 'the browser reported the violation');
  await wait(100);
  problems.splice(before); // those violations were expected
  await page.close();
});

test('works offline and can be installed', async () => {
  // The manifest, and the icons it names.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  // The service worker's list of files matches the site: every script, nothing missing.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const f of shell.filter((f) => f !== './')) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) assert.ok(shell.includes(`js/${f}`), `js/${f} is stored for offline use`);

  const page = await open('#sheet');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 });
  const stored = (name) => page.evaluate(async (n) => (await (await caches.open(n)).keys()).length, name);
  await until(async () => (await stored('piano-shell-dev')) === shell.length, 10000, 'files stored');
  // The samples are stored once the piano has loaded.
  await until(async () => (await stored('piano-media-v1')) >= 90, 30000, 'samples stored');

  offline = true;
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#sheet .vf-stavenote').length > 0, { timeout: 10000 });
    for (const view of ['learn', 'quiz', 'scales', 'progress']) {
      await page.goto(base + '#' + view);
      await wait(200);
      assert.equal(await page.$eval(`#view-${view}`, (e) => e.hidden), false, `#${view} works offline`);
    }
    await until(() => page.evaluate(() => document.getElementById('sound-status').textContent === ''), 10000, 'piano loaded from storage');
  } finally {
    offline = false;
  }
  await page.close();
});

/** A robot drummer for rhythm mode: taps one key (any key) as each note is highlighted on the sheet. */
function startTapper(page, { skip = 0, midi = 50 } = {}) {
  return page.evaluate((skipEvery, key) => {
    let n = 0;
    new MutationObserver((muts) => {
      const fresh = muts.some((m) => m.target.classList.contains('current') && !(m.oldValue ?? '').includes('current'));
      if (!fresh) return;
      if (skipEvery && ++n % skipEvery === 0) return;
      const k = document.querySelector(`.key[data-midi="${key}"]`);
      k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, button: 0 }));
      setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 })), 40);
    }).observe(document.getElementById('sheet'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }, skip, midi);
}

test('rhythm mode: tap the rhythm on any key, scored on timing only', async () => {
  const page = await open('#sheet/rh-c-position?mode=rhythm');
  assert.equal(await page.$eval('input[name="sheet-mode"][value="rhythm"]', (e) => e.checked), true);
  assert.match(await text(page, '#sheet-status'), /tap the rhythm/);
  assert.equal(await page.$eval('#sheet-hints', (e) => e.offsetParent), null, 'no key hints: pitch doesn’t matter');
  assert.notEqual(await page.$eval('#sheet-start', (e) => e.offsetParent), null, 'start button shown');
  await page.$eval('#sheet-tempo', (e) => { e.value = 140; e.dispatchEvent(new Event('input')); });
  await startTapper(page, { skip: 5, midi: 50 }); // D3: nowhere in the piece
  await page.click('#sheet-start');
  await page.waitForFunction(() => !document.getElementById('sheet-result').hidden, { timeout: 20000 });
  const result = await text(page, '#sheet-result');
  const num = (re) => +(result.match(re)?.[1] ?? -1);
  assert.ok(num(/(\d+) on time/) >= 10, `taps on the beat count, whatever the key (${result})`);
  assert.ok(num(/(\d+) missed/) >= 2, `skipped taps are missed (${result})`);
  assert.doesNotMatch(result, /extra tap|wrong/);
  assert.equal(await page.$eval('.key.target', () => 1).catch(() => 0), 0, 'no keys lit up');
  const stars = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).piecesRhythm);
  assert.ok(stars['rh-c-position'] >= 1, 'rhythm stars are kept separately');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).barStats), undefined,
    'rhythm passes don’t count towards trouble bars');
  await page.close();
});

test('at tempo: bars that keep going wrong are suggested as a loop, and clean passes clear them', async () => {
  const page = await open('#sheet/rh-c-position?mode=tempo');
  assert.equal(await page.$eval('#sheet-suggest', (e) => e.hidden), true, 'nothing to suggest yet');
  await page.select('#sheet-hints', 'always');
  await page.$eval('#sheet-tempo', (e) => { e.value = 120; e.dispatchEvent(new Event('input')); });
  // Miss notes only in bar 3 (the 9th–12th notes).
  await page.evaluate(() => {
    let n = 0;
    new MutationObserver((muts) => {
      const fresh = new Set(muts.filter((m) => !(m.oldValue ?? '').includes('target')).map((m) => m.target));
      for (const k of fresh) {
        if (!k.classList.contains('target')) continue;
        n++;
        if (n >= 9 && n <= 11) continue;
        k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, button: 0 }));
        setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 })), 50);
      }
    }).observe(document.getElementById('keyboard'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
  await page.click('#sheet-start');
  await page.waitForFunction(() => !document.getElementById('sheet-result').hidden, { timeout: 20000 });
  const trouble = await page.$eval('#sheet-result .trouble', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  assert.match(trouble, /Trouble spot: bar 3 \(75% of the notes missed or off the beat lately\)\. Loop bar 3 at 102 bpm/);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).barStats['rh-c-position'].bars);
  assert.equal(before[2].trouble, 0.75);
  assert.equal(before[0].trouble, 0, 'clean bars are recorded as fine');

  // The suggestion is there next time too, before starting.
  await page.reload({ waitUntil: 'networkidle0' });
  assert.match(await text(page, '#sheet-suggest'), /Trouble spot: bar 3/);
  await page.click('#sheet-suggest button');
  assert.equal(await page.$eval('#sheet-from', (e) => e.value), '2');
  assert.equal(await page.$eval('#sheet-to', (e) => e.value), '2');
  assert.equal(await page.$eval('#sheet-loop', (e) => e.checked), true, 'looping');
  assert.equal(await text(page, '#sheet-bpm'), '76', '85% of the piece’s 90 bpm');
  assert.equal(await page.$eval('#sheet-suggest', (e) => e.hidden), true, 'no need to suggest what you’re doing');

  // A clean pass of the loop halves the bar's trouble.
  await page.select('#sheet-hints', 'always');
  await startRobot(page);
  await page.click('#sheet-start');
  await page.waitForFunction(() => /^Pass 1:/.test(document.getElementById('sheet-loop-log').textContent), { timeout: 15000 });
  await page.click('#sheet-start'); // stop
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).barStats['rh-c-position'].bars);
  assert.equal(after[2].trouble, 0.375);
  assert.equal(after[2].plays, 2);

  // Syncing keeps each piece's most recently practised record.
  const merged = await page.evaluate(async () => {
    const { merge } = await import('./js/sync.js');
    const older = { barStats: { a: { at: 1, bars: { 0: { trouble: 1 } } }, b: { at: 5, bars: {} } } };
    const newer = { barStats: { a: { at: 2, bars: { 0: { trouble: 0.5 } } } } };
    return merge(older, newer).barStats;
  });
  assert.deepEqual(merged, { a: { at: 2, bars: { 0: { trouble: 0.5 } } }, b: { at: 5, bars: {} } });
  await page.close();
});

test('the piano can be hidden, and stays hidden on this device', async () => {
  const page = await open('#play', { width: 390, height: 800, mobile: true });
  const shown = () => page.$eval('#keyboard-scroll', (e) => e.offsetParent !== null);
  assert.equal(await shown(), true);
  await page.click('#piano-toggle');
  assert.equal(await shown(), false, 'hidden');
  assert.equal(await page.$eval('#piano-toggle', (e) => e.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$eval('#midi-btn', (e) => e.offsetParent), null, 'only the toggle is left');
  assert.ok(await page.$eval('.piano-dock', (e) => e.offsetHeight) < 60, 'a slim bar');
  // The computer keyboard still plays.
  await page.keyboard.press('KeyA');
  await page.waitForFunction(() => document.getElementById('play-note').textContent !== '—');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await shown(), false, 'remembered');
  await page.click('#piano-toggle');
  assert.equal(await shown(), true, 'shown again');
  assert.equal(await page.$eval('#piano-toggle', (e) => e.getAttribute('aria-expanded')), 'true');
  await page.close();
});

test('screen readers and keyboard users can play the piano', async () => {
  const page = await open('#play');
  const piano = await page.$eval('#keyboard', (e) => ({ role: e.getAttribute('role'), label: e.getAttribute('aria-label') }));
  assert.equal(piano.role, 'toolbar');
  assert.match(piano.label, /^Piano/);
  assert.equal(await page.$$eval('.key[tabindex="0"]', (k) => k.map((x) => x.dataset.midi).join()), '60', 'one Tab stop: middle C');
  assert.equal(await page.$$eval('.key:not([role="button"])', (k) => k.length), 0, 'every key is a button');
  const label = (m) => page.$eval(`.key[data-midi="${m}"]`, (e) => e.getAttribute('aria-label'));
  assert.equal(await label(60), 'C4');
  assert.equal(await label(61), 'C sharp 4 / D flat 4');
  const focused = () => page.evaluate(() => +document.activeElement.dataset.midi);

  await page.focus('.key[data-midi="60"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(), 61, 'right: a semitone up');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focused(), 73, 'up: an octave up');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), 60);
  assert.equal(await page.$$eval('.key[tabindex="0"]', (k) => k.map((x) => x.dataset.midi).join()), '60', 'the Tab stop follows');
  await page.keyboard.press('End');
  assert.equal(await focused(), 108);
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(), 108, 'stops at the top');
  await page.keyboard.press('Home');
  assert.equal(await focused(), 21);

  // Space plays the focused key for as long as it's held (not the sustain pedal).
  await page.focus('.key[data-midi="64"]');
  await page.keyboard.down('Space');
  assert.equal(await page.$eval('.key[data-midi="64"]', (e) => e.classList.contains('pressed')), true);
  assert.equal(await page.$eval('#pedal-btn', (e) => e.getAttribute('aria-pressed')), 'false', 'no pedal');
  assert.equal(await text(page, '#play-note'), 'E');
  await page.keyboard.up('Space');
  assert.equal(await page.$eval('.key[data-midi="64"]', (e) => e.classList.contains('pressed')), false, 'released');
  await page.keyboard.press('Enter');
  assert.equal(await page.$$eval('.key.pressed', (k) => k.length), 0, 'Enter plays and lets go');
  // Elsewhere, Space is still the pedal.
  await page.focus('#volume');
  await page.keyboard.down('Space');
  assert.equal(await page.$eval('#pedal-btn', (e) => e.getAttribute('aria-pressed')), 'true');
  await page.keyboard.up('Space');
  await page.close();
});

test('an open page offers a reload when a new version is deployed', async () => {
  // deploy.yml stamps the commit into this line of sw.js.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /^const BUILD = 'dev';$/m);
  const workflow = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.ok(workflow.includes(`s/^const BUILD = 'dev';/const BUILD = '\${GITHUB_SHA::12}';/`), 'the deploy step matches that line');

  const page = await open('#play');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 });
  assert.equal(await page.$eval('#update-note', (e) => e.hidden), true, 'not on a first visit');
  swBuild = 'abc123';
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(() => !document.getElementById('update-note').hidden, { timeout: 10000 });
    assert.match(await text(page, '#update-note'), /new version/);
    // The page switches to the new worker as it activates; the old files are cleared just after.
    const shells = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('piano-shell')).join());
    await until(async () => (await shells()) === 'piano-shell-abc123', 5000, 'the old files replaced');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#update-reload')]);
    assert.equal(await page.$eval('#update-note', (e) => e.hidden), true, 'gone after reloading');
  } finally {
    swBuild = null;
  }
  await page.close();
});

test('Listen lights up the keys being played, for as long as each note sounds', async () => {
  /** Records which keys light up during playback, and for how long. */
  const watchKeys = (page) => page.evaluate(() => {
    window.lit = [];
    const since = new Map();
    new MutationObserver((muts) => {
      for (const m of muts) {
        const on = m.target.classList.contains('demo');
        const was = (m.oldValue ?? '').includes('demo');
        if (on && !was) since.set(m.target, { t: performance.now(), name: m.target.querySelector('.label-played').textContent });
        if (!on && was) {
          const { t, name } = since.get(m.target);
          window.lit.push({ midi: +m.target.dataset.midi, ms: performance.now() - t, name });
        }
      }
    }).observe(document.getElementById('keyboard'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });

  const page = await open('#sheet/rh-c-position?mode=play');
  await watchKeys(page);
  await page.$eval('#sheet-tempo', (e) => { e.value = 200; e.dispatchEvent(new Event('input')); });
  await page.click('#sheet-listen');
  await page.waitForFunction(() => document.getElementById('sheet-listen').textContent === 'Listen', { timeout: 20000 });
  const lit = await page.evaluate(() => window.lit);
  const expected = await page.evaluate(async () => {
    const { PIECES } = await import('./js/pieces.js');
    return PIECES.find((p) => p.id === 'rh-c-position').rh;
  });
  assert.ok(lit.length >= 12, `every note lights its key (${lit.length})`);
  for (const { midi } of lit) assert.ok(midi >= 60 && midi <= 67, `only the piece’s keys (${midi}) in ${expected}`);
  assert.equal(await page.$$eval('.key.demo', (k) => k.length), 0, 'all let go at the end');
  const names = { 60: 'C', 62: 'D', 64: 'E', 65: 'F', 67: 'G' };
  for (const { midi, name } of lit) assert.equal(name, names[midi], 'each lit key shows its note name');
  // 300 ms a beat at 200 bpm: quarter notes light briefly, the final whole note for about a second.
  const ms = lit.map((l) => l.ms).sort((a, b) => a - b);
  assert.ok(ms[0] > 150 && ms[0] < 400, `quarter notes (${Math.round(ms[0])} ms)`);
  assert.ok(ms.at(-1) > 900, `the whole note stays lit (${Math.round(ms.at(-1))} ms)`);
  await page.close();

  // The examples in Learn light up the keys too.
  const learn = await open('#learn');
  await watchKeys(learn);
  await learn.click('#learn-body button[data-ex]');
  await learn.waitForFunction(() => document.querySelector('.key.demo'), { timeout: 5000 });
  await learn.click('#learn-body button[data-ex]'); // stop
  assert.equal(await learn.$$eval('.key.demo', (k) => k.length), 0, 'stopping clears them');
  await learn.close();

  // Names are spelled as the music spells them: F major's fourth note is B♭, not A♯.
  const scales = await open('#scales');
  await scales.select('#scale-root', '5');
  await scales.select('#scale-type', 'major');
  await scales.click('#scale-play');
  await scales.waitForFunction(() => document.querySelector('.key.demo[data-midi="70"]'), { timeout: 5000 });
  assert.equal(await scales.$eval('.key[data-midi="70"] .label-played', (e) => e.textContent), 'B♭');
  assert.equal(await scales.$eval('.key[data-midi="70"] .label-played', (e) => getComputedStyle(e).display), 'block', 'shown while lit');
  await scales.click('#scale-play'); // stop
  await scales.close();
});

test('a new page never runs old scripts: they are always revalidated', async () => {
  const nginx = fs.readFileSync(path.join(ROOT, '..', 'nginx.conf'), 'utf8');
  const map = nginx.match(/map \$uri \$cache_control \{([\s\S]*?)\n\}/)[1];
  for (const line of map.split('\n').filter((l) => /max-age/.test(l))) {
    assert.doesNotMatch(line, /\bjs\b|\bcss\b/, `scripts and styles aren’t kept: ${line.trim()}`);
  }
  assert.match(map, /default\s+"no-cache"/);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/, 'the service worker skips the HTTP cache for the page and scripts');

  // In the browser, with a host that lets browsers keep files for an hour:
  // after the first visit, scripts still come from the server, not the browser's cache.
  keepFiles = true;
  try {
    const page = await open('#play');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 10000 });
    requested.length = 0;
    await page.reload({ waitUntil: 'networkidle0' });
    assert.ok(requested.includes('/js/notes.js'), `scripts were checked with the server (${requested.join(' ')})`);
    assert.ok(requested.includes('/css/style.css'), 'and the styles');
    await page.close();
  } finally {
    keepFiles = false;
  }
});

test('storage is read once and kept in memory, and sees other tabs', async () => {
  const page = await open('#play');
  const result = await page.evaluate(async () => {
    const store = await import('./js/storage.js');
    store.set('memo', { list: [1] });
    const got = store.get('memo');
    got.list.push(2); // changing a copy...
    const unchanged = store.get('memo').list.length; // ...doesn't change what's stored
    const reads = { n: 0 };
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function (...a) { reads.n++; return real.apply(this, a); };
    for (let i = 0; i < 50; i++) store.get('memo');
    Storage.prototype.getItem = real;
    return { unchanged, reads: reads.n, saved: JSON.parse(localStorage.getItem('piano-practice:v1')).memo };
  });
  assert.equal(result.unchanged, 1);
  assert.equal(result.reads, 0, 'no localStorage reads once loaded');
  assert.deepEqual(result.saved, { list: [1] }, 'still written to localStorage');

  // A second tab changes it: the first sees the change.
  const other = await page.browserContext().newPage();
  await other.goto(base + '#play', { waitUntil: 'networkidle0' });
  await other.evaluate(async () => (await import('./js/storage.js')).set('memo', { list: [9] }));
  await until(() => page.evaluate(async () => (await import('./js/storage.js')).get('memo').list[0] === 9), 3000, 'other tab’s change seen');
  await other.close();
  await page.close();
});

test('random sheets can be shared as a link with the exact notes', async () => {
  const page = await open('#sheet/random?mode=name&clef=grand&range=ledger&rhythm=varied');
  await page.waitForFunction(() => document.querySelectorAll('#sheet .vf-stavenote').length > 0);
  assert.equal(await page.$eval('#sheet-share', (e) => e.hidden), false, 'offered for random sheets');
  await page.evaluate(() => {
    window.copied = null;
    navigator.clipboard.writeText = async (t) => { window.copied = t; };
  });
  await page.click('#sheet-share');
  await page.waitForFunction(() => window.copied);
  const url = await page.evaluate(() => window.copied);
  assert.match(await text(page, '#sheet-share'), /Link copied/);
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('mode'), 'name');
  assert.equal(params.get('clef'), 'grand');
  assert.equal(params.get('range'), 'ledger');
  assert.ok(url.length < 2000, `a reasonable length (${url.length})`);
  // The same notes, drawn the same way (ignoring VexFlow's generated ids).
  const drawing = (p) => p.$eval('#sheet', (e) => e.innerHTML.replace(/ id="[^"]*"/g, ''));
  const meta = await text(page, '#sheet-meta');
  const mine = await drawing(page);

  const friend = await open(url.slice(url.indexOf('#')), {
    init: () => localStorage.setItem('piano-practice:v1', JSON.stringify({ builder: { clef: 'treble', range: 'staff' } })),
  });
  await friend.waitForFunction(() => document.querySelectorAll('#sheet .vf-stavenote').length > 0);
  assert.equal(await text(friend, '#sheet-meta'), meta);
  assert.equal(await drawing(friend), mine, 'exactly the same sheet');
  assert.equal(await friend.$eval('input[name="sheet-mode"][value="name"]', (e) => e.checked), true, 'in the same mode');
  assert.equal(await friend.$eval('#gen-clef', (e) => e.value), 'grand', 'with the same settings for new sheets');
  assert.match(await text(friend, '#sheet-desc'), /shared sheet/);
  await friend.click('#sheet-new');
  assert.doesNotMatch(await friend.evaluate(() => location.hash), /notes=/, 'a new sheet leaves the shared link');
  assert.doesNotMatch(await text(friend, '#sheet-desc'), /shared sheet/);
  await friend.close();

  // A damaged link: a new random sheet, and a note saying so.
  const broken = await open('#sheet/random?notes=AAAAnotreally');
  await broken.waitForFunction(() => document.querySelectorAll('#sheet .vf-stavenote').length > 0);
  assert.match(await text(broken, '#sheet-status'), /couldn’t be read/);
  await broken.close();

  // No clipboard access: the link is shown to copy by hand.
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await page.click('#sheet-share');
  await page.waitForFunction(() => !document.getElementById('sheet-share-box').hidden);
  assert.match(await page.$eval('#sheet-share-url', (e) => e.value), /#sheet\/random\?.*notes=/);
  await page.close();
});

test('weekly summary: minutes, notes, pieces improved and trouble fixed', async () => {
  const day = (ago) => { const d = new Date(); d.setDate(d.getDate() - ago); return d; };
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const seeded = {
    practiceTime: { [key(day(0))]: 600, [key(day(2))]: 1200, [key(day(9))]: 300 },
    practiceLog: { [key(day(0))]: 40, [key(day(2))]: 60, [key(day(9))]: 10 },
    milestones: [
      { at: day(20).getTime(), type: 'stars', id: 'ode-hands', title: 'Ode to Joy', mode: 'play', stars: 1, from: 0 },
      { at: day(2).getTime(), type: 'stars', id: 'minuet-g', title: 'Minuet in G', mode: 'tempo', stars: 2, from: 1 },
      { at: day(1).getTime(), type: 'stars', id: 'minuet-g', title: 'Minuet in G', mode: 'tempo', stars: 3, from: 2 },
      { at: day(1).getTime(), type: 'fixed', id: 'minuet-g', title: 'Minuet in G', bars: 'bar 5' },
    ],
    speedHistory: [
      { at: day(10).getTime(), npm: 20, accuracy: 90, seconds: 60 },
      { at: day(1).getTime(), npm: 26, accuracy: 92, seconds: 60 },
    ],
  };
  const page = await open('#progress', { init: (s) => localStorage.setItem('piano-practice:v1', s), initArg: JSON.stringify(seeded) });
  const line = await text(page, '#week-line');
  assert.equal(line, 'Last 7 days: 30 minutes · 100 notes · 1 piece improved · 1 trouble spot fixed, on 2 days. That’s 25 more minutes than the week before.');
  const items = await page.$$eval('#week-list li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(items, [
    '★★★ Minuet in G (at tempo), up from 1 star',
    'Trouble in bar 5 of Minuet in G fixed',
    'Reading speed: 26 correct notes a minute, up from your best of 20',
  ]);
  assert.equal(await page.$eval('#week-list a', (a) => a.getAttribute('href')), '#sheet/minuet-g?mode=tempo');

  // Practice time: the gaps between notes and answers, leaving out breaks over a minute.
  const today = await page.evaluate(async (k) => {
    const stats = await import('./js/stats.js');
    const t = Date.now();
    stats.activity(t);
    stats.activity(t + 30000);
    stats.activity(t + 200000); // after a break: not counted
    stats.activity(t + 210000);
    stats.flushTime();
    return (await import('./js/storage.js')).get('practiceTime')[k];
  }, key(day(0)));
  assert.equal(today, 640);

  // Syncing combines both devices' milestones and keeps each day's longer time.
  const merged = await page.evaluate(async () => {
    const { merge } = await import('./js/sync.js');
    const a = { practiceTime: { d1: 100 }, milestones: [{ at: 1, type: 'stars', id: 'x' }] };
    const b = { practiceTime: { d1: 60, d2: 30 }, milestones: [{ at: 1, type: 'stars', id: 'x' }, { at: 2, type: 'fixed', id: 'x' }] };
    return merge(a, b);
  });
  assert.deepEqual(merged.practiceTime, { d1: 100, d2: 30 });
  assert.equal(merged.milestones.length, 2);
  await page.close();

  const empty = await open('#progress');
  assert.match(await text(empty, '#week-line'), /Nothing yet this week/);
  await empty.close();
});

test('each Learn chapter ends with questions that check you learned it', async () => {
  const page = await open('#learn');
  // Every chapter's questions are well formed, whatever notes come up.
  const problemsFound = await page.evaluate(async () => {
    const { CHECKS } = await import('./js/learncheck.js');
    const found = [];
    for (const [id, make] of Object.entries(CHECKS)) {
      for (let n = 0; n < 30; n++) {
        const qs = make();
        if (qs.length < 3 || qs.length > 5) found.push(`${id}: ${qs.length} questions`);
        for (const q of qs) {
          if (!q.choices.includes(q.answer)) found.push(`${id}: “${q.text}” has no right answer (${q.answer})`);
          if (new Set(q.choices).size !== q.choices.length) found.push(`${id}: repeated choices ${q.choices}`);
          if (!q.why) found.push(`${id}: “${q.text}” explains nothing`);
        }
      }
    }
    return [...new Set(found)];
  });
  assert.deepEqual(problemsFound, []);
  const chapters = await page.$$eval('#learn-toc button', (b) => b.length);
  for (let i = 0; i < chapters; i++) {
    await page.click(`#learn-toc button[data-i="${i}"]`);
    await wait(50);
    const qs = await page.$$eval('#learn-body .check-q', (q) => q.map((x) => ({ sheet: !!x.querySelector('.check-sheet'), drawn: !!x.querySelector('.check-sheet svg') })));
    assert.ok(qs.length >= 3, `chapter ${i + 1} has questions`);
    assert.ok(qs.every((q) => q.sheet === q.drawn), `chapter ${i + 1}: every staff is drawn`);
  }

  // Chapter 1: Next no longer marks it done; answering does.
  await page.click('#learn-toc button[data-i="0"]');
  await page.click('#learn-next');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).learnDone), undefined, 'reading on isn’t passing');
  await page.click('#learn-toc button[data-i="0"]');
  // (Clicked directly: puppeteer's click can land on the piano dock that covers the bottom of the page.)
  const choose = (q, c) => page.$eval(`#learn-body button[data-q="${q}"][data-choice="${c}"]`, (b) => b.click());
  await choose(0, '5');
  assert.match(await text(page, '#check-why-0'), /^Right! Five lines/);
  await choose(1, 'Step'); // a step or a skip, at random: a slip is allowed
  if (await page.$eval('#check-why-1', (e) => e.dataset.tone) === 'bad') await choose(1, 'Skip');
  await choose(2, 'Higher');
  assert.equal(await page.$('#check-result p'), null, 'not finished yet');
  await choose(3, 'White key');
  assert.match(await text(page, '#check-result'), /Chapter done ✓ [34] of 4 right first time/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).learnDone), ['staff']);
  assert.equal(await text(page, '#learn-toc button[data-i="0"] .toc-num'), '✓');
  await page.$eval('#check-result [data-action="next-chapter"]', (b) => b.click());
  assert.equal(await text(page, '#learn-title'), 'The treble clef');

  // Too many slips: not passed, and a new set is offered.
  await page.click('#learn-toc button[data-i="10"]'); // Fingering, ties, dynamics & repeats
  await choose(0, 'Little finger');
  assert.equal(await page.$eval('#learn-body button[data-q="0"][data-choice="Little finger"]', (b) => b.disabled), true);
  await choose(0, 'Thumb');
  await choose(1, 'A note you play twice');
  await choose(1, 'Two notes of the same pitch: play once and hold');
  await choose(2, 'f');
  await choose(3, 'Go back and play that part again');
  assert.match(await text(page, '#check-result'), /2 of 4 right first time/);
  assert.ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('piano-practice:v1')).learnDone)).includes('markings'));
  await page.$eval('#check-result [data-action="new-check"]', (b) => b.click());
  assert.equal(await page.$$eval('#learn-body .is-wrong, #learn-body .is-right', (b) => b.length), 0, 'a fresh set');
  await page.close();
});

test('light/dark theme switch, and nothing loads from other servers', async () => {
  const outside = [];
  const page = await open('#learn', { init: () => {} });
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) outside.push(r.url()); });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const light = await bg();
  assert.match(await page.$eval('#theme-btn', (b) => b.getAttribute('aria-label')), /^Auto theme/);
  await page.click('#theme-btn');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.click('#theme-btn');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.notEqual(await bg(), light, 'dark even though the system is light');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'remembered');
  await page.click('#theme-btn');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined, 'back to following the system');
  // The music-symbol font is served from the site itself.
  await page.goto(base + '#scales');
  const fonts = await page.evaluate(async () => (await document.fonts.load('16px "Noto Music"', '𝄪')).length);
  assert.ok(fonts >= 1, 'Noto Music loads');
  await wait(200);
  assert.deepEqual(outside, [], 'no requests to other servers');
  await page.close();
});

test('no console errors, failed requests or warnings anywhere', () => {
  assert.deepEqual(problems, []);
});
