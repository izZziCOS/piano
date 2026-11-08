import { Keyboard } from './keyboard.js';
import { noteName } from './notes.js';
import * as audio from './audio.js';
import * as store from './storage.js';
import * as play from './play.js';
import * as quiz from './quiz.js';
import * as scales from './scales.js';
import * as learn from './learn.js';
import * as sheet from './sheetpractice.js';
import * as ear from './ear.js';
import * as progress from './progress.js';
import * as sync from './sync.js';
import { loadNotation } from './sheet.js';

const $ = (id) => document.getElementById(id);
const modes = { learn, sheet, quiz, ear, scales, play, progress };
const ALIASES = { lessons: 'sheet' }; // old links
let current = null;

const keyboard = new Keyboard($('keyboard'));

// Full 88-key piano, scrolled so middle C is in view.
keyboard.build();
requestAnimationFrame(() => keyboard.reveal(60, { center: true, smooth: false }));

for (const m of Object.values(modes)) m.init?.(keyboard);
sync.init();
keyboard.on('noteon', (midi) => modes[current]?.onNote?.(midi));

// --- Routing: #learn, #sheet, #sheet/<piece-id>?mode=name, #quiz, #scales, #play ---
// Pages that draw sheet music wait for VexFlow, which is only loaded when first needed.
const NEEDS_NOTATION = new Set(['learn', 'sheet', 'quiz', 'progress']);
let routing = 0;
async function route() {
  const ticket = ++routing;
  const [path] = location.hash.slice(1).split('?');
  let [name, param] = path.split('/');
  name = ALIASES[name] ?? name;
  const next = name in modes ? name : 'learn';
  if (NEEDS_NOTATION.has(next) && !window.Vex?.Flow) {
    document.body.setAttribute('aria-busy', 'true');
    await loadNotation();
    document.body.removeAttribute('aria-busy');
    if (ticket !== routing) return; // the address changed again while loading
  }
  if (next === current) {
    if (param) modes[next].enter?.(param);
    return;
  }
  if (current) modes[current].exit?.();
  current = next;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${next}`; });
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === next) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  modes[next].enter?.(param);
}
window.addEventListener('hashchange', route);
route();

// --- Computer keyboard ---
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'range' && el.type !== 'checkbox');
const downCodes = new Map(); // code -> midi, so key-up releases the note that key-down started

function setBase(base) {
  base = Math.max(24, Math.min(84, base)); // C1..C6 keeps all 17 computer keys on the piano
  keyboard.setBase(base);
  $('oct-label').textContent = noteName(base);
  store.set('base', base);
}
setBase(store.get('base', 60));

// --- Sustain pedal: hold Space, click the Pedal button to latch, or a MIDI pedal ---
const pedalBtn = $('pedal-btn');
let pedalLatched = false;
let midiPedal = false;
let spaceDown = false;
function syncPedal() {
  const down = pedalLatched || spaceDown || midiPedal;
  audio.setPedal(down);
  pedalBtn.setAttribute('aria-pressed', String(down));
}
pedalBtn.addEventListener('click', () => { pedalLatched = !pedalLatched; syncPedal(); });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); // don't scroll the page or press a focused button
    if (!e.repeat) { spaceDown = true; syncPedal(); }
    return;
  }
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (e.code === 'KeyZ') return setBase(keyboard.base - 12);
  if (e.code === 'KeyX') return setBase(keyboard.base + 12);
  const midi = keyboard.codeToMidi(e.code);
  if (midi == null || downCodes.has(e.code)) return;
  e.preventDefault();
  downCodes.set(e.code, midi);
  keyboard.press(midi);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && spaceDown) { e.preventDefault(); spaceDown = false; syncPedal(); return; }
  if (!downCodes.has(e.code)) return;
  keyboard.release(downCodes.get(e.code));
  downCodes.delete(e.code);
});
window.addEventListener('blur', () => {
  for (const midi of downCodes.values()) keyboard.release(midi);
  downCodes.clear();
  spaceDown = false;
  syncPedal();
});

// --- Light / dark theme: follow the system, or pick one (applied early by a script in index.html) ---
const THEMES = { auto: ['◐', 'Auto theme'], light: ['☀', 'Light theme'], dark: ['☾', 'Dark theme'] };
const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' };
function setTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const [icon, label] = THEMES[theme];
  const btn = $('theme-btn');
  btn.innerHTML = `<span aria-hidden="true">${icon}</span><span class="theme-label">${label.split(' ')[0]}</span>`;
  btn.setAttribute('aria-label', `${label}. Switch to ${THEMES[NEXT_THEME[theme]][1].toLowerCase()}`);
  btn.title = btn.getAttribute('aria-label');
}
let theme = store.get('theme', 'auto');
if (!(theme in THEMES)) theme = 'auto';
setTheme(theme);
$('theme-btn').addEventListener('click', () => {
  theme = NEXT_THEME[theme];
  store.set('theme', theme);
  setTheme(theme);
});

// --- Toolbar ---
$('oct-down').addEventListener('click', () => setBase(keyboard.base - 12));
$('oct-up').addEventListener('click', () => setBase(keyboard.base + 12));

const labelMode = $('label-mode');
labelMode.value = store.get('labels', 'notes');
$('keyboard').dataset.labels = labelMode.value;
labelMode.addEventListener('change', () => {
  $('keyboard').dataset.labels = labelMode.value;
  store.set('labels', labelMode.value);
});

const volume = $('volume');
volume.value = store.get('volume', 0.7);
audio.setVolume(+volume.value);
volume.addEventListener('input', () => {
  audio.setVolume(+volume.value);
  store.set('volume', +volume.value);
});

// --- Sound: sampled grand piano (downloads ~2 MB once) or the built-in synth ---
const instrumentSel = $('instrument');
instrumentSel.value = store.get('instrument', 'piano');
audio.setInstrument(instrumentSel.value);
instrumentSel.addEventListener('change', () => {
  audio.setInstrument(instrumentSel.value);
  store.set('instrument', instrumentSel.value);
});
audio.onLoadState((state) => {
  $('sound-status').textContent = instrumentSel.value !== 'piano' ? ''
    : { loading: 'loading…', failed: 'couldn’t load, using synth', ready: '', idle: '' }[state];
});

// Browsers only allow audio after a user gesture.
window.addEventListener('pointerdown', audio.unlock, { once: true });
window.addEventListener('keydown', audio.unlock, { once: true });

// --- MIDI input (Chrome, Edge, Firefox; Firefox asks for permission first) ---
const midiBtn = $('midi-btn');
if (!navigator.requestMIDIAccess) {
  midiBtn.disabled = true;
  midiBtn.title = 'This browser does not support Web MIDI. Try Chrome, Edge or Firefox.';
} else {
  midiBtn.addEventListener('click', async () => {
    try {
      const access = await navigator.requestMIDIAccess();
      const bind = () => {
        let count = 0;
        for (const input of access.inputs.values()) {
          input.onmidimessage = onMidi;
          count++;
        }
        midiBtn.textContent = count ? `MIDI: ${count} connected` : 'MIDI: no device';
      };
      access.onstatechange = bind;
      bind();
    } catch {
      midiBtn.textContent = 'MIDI blocked';
      midiBtn.title = 'MIDI access was refused. Allow it in the browser’s site permissions (in Firefox, accept the add-on prompt) and try again.';
    }
  });
}

const midiHeld = new Set();
function onMidi({ data }) {
  const [status, note, velocity] = data;
  const cmd = status & 0xf0;
  if (cmd === 0xb0 && note === 64) { // control change 64: sustain pedal
    midiPedal = velocity >= 64;
    syncPedal();
  } else if (cmd === 0x90 && velocity > 0) {
    if (midiHeld.has(note)) keyboard.release(note);
    midiHeld.add(note);
    keyboard.press(note, 0.3 + (velocity / 127) * 0.7);
  } else if ((cmd === 0x80 || (cmd === 0x90 && velocity === 0)) && midiHeld.has(note)) {
    midiHeld.delete(note);
    keyboard.release(note);
  }
}

// --- First visit: a short pointer to where to begin ---
const welcome = $('welcome');
const hasProgress = () => ['practiceLog', 'learnDone', 'noteStats', 'pieces'].some((k) => {
  const v = store.get(k);
  return v && Object.keys(v).length > 0;
});
if (!store.get('welcomed', false) && !hasProgress()) {
  welcome.hidden = false;
  const dismiss = () => { welcome.hidden = true; store.set('welcomed', true); };
  welcome.addEventListener('click', (e) => { if (e.target.closest('a, button')) dismiss(); });
}

// --- Hide the piano (it takes a lot of a phone screen); remembered on this device ---
const dock = document.querySelector('.piano-dock');
function showPiano(shown) {
  dock.dataset.collapsed = String(!shown);
  const toggle = $('piano-toggle');
  toggle.setAttribute('aria-expanded', String(shown));
  toggle.querySelector('.toggle-label').textContent = shown ? 'Hide piano' : 'Show piano';
  toggle.title = shown ? 'Hide the piano. Your computer keyboard and MIDI keyboard still play.' : 'Show the piano';
  if (shown) requestAnimationFrame(() => keyboard.reveal(keyboard.focusMidi, { center: true, smooth: false }));
}
showPiano(!store.get('pianoHidden', false));
$('piano-toggle').addEventListener('click', () => {
  const shown = dock.dataset.collapsed === 'true';
  store.set('pianoHidden', !shown);
  showPiano(shown);
});

// --- Offline use and installing as an app (sw.js) ---
if ('serviceWorker' in navigator && window.isSecureContext) {
  // Every deploy changes sw.js (deploy.yml stamps the commit into it). The new
  // service worker takes over at once; this page is still running the old
  // code, so offer a reload. (Not on the first visit: then there was no old one.)
  let hadWorker = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadWorker) $('update-note').hidden = false;
    hadWorker = true;
  });
  $('update-reload').addEventListener('click', () => location.reload());
  $('update-close').addEventListener('click', () => { $('update-note').hidden = true; });

  navigator.serviceWorker.register('sw.js').then(async (registration) => {
    // Browsers only look for a new version when a page loads. The site is often
    // left open for a long practice session, so also look when you come back to it.
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 10 * 60 * 1000) return;
      checked = Date.now();
      registration.update().catch(() => { /* offline */ });
    });
    // Keep the piano samples for offline use once they've all loaded (they're
    // usually in the HTTP cache by then, so nothing is downloaded twice).
    await audio.pianoLoaded;
    const ready = await navigator.serviceWorker.ready;
    ready.active?.postMessage({ type: 'store-media', urls: audio.sampleUrls() });
  }).catch(() => { /* not available (e.g. blocked storage): the site works online as before */ });
}
