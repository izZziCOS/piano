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

const $ = (id) => document.getElementById(id);
const modes = { learn, sheet, quiz, ear, scales, play, progress };
const ALIASES = { lessons: 'sheet' }; // old links
let current = null;

const keyboard = new Keyboard($('keyboard'));

// Full 88-key piano, scrolled so middle C is in view.
keyboard.build();
requestAnimationFrame(() => keyboard.reveal(60, { center: true, smooth: false }));

for (const m of Object.values(modes)) m.init?.(keyboard);
keyboard.on('noteon', (midi) => modes[current]?.onNote?.(midi));

// --- Routing: #learn, #sheet, #sheet/<piece-id>?mode=name, #quiz, #scales, #play ---
function route() {
  const [path] = location.hash.slice(1).split('?');
  let [name, param] = path.split('/');
  name = ALIASES[name] ?? name;
  const next = name in modes ? name : 'learn';
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

// --- MIDI input (Chrome / Edge) ---
const midiBtn = $('midi-btn');
if (!navigator.requestMIDIAccess) {
  midiBtn.disabled = true;
  midiBtn.title = 'This browser does not support Web MIDI. Try Chrome or Edge.';
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
