// Sound engine: a sampled grand piano (Salamander, CC BY 3.0, see
// samples/salamander/LICENSE.txt) recorded at three dynamic levels, with a
// small synth as a fallback while the samples load, or if the player picks it.
// Also: sustain pedal, metronome clicks and precisely scheduled notes.
import { midiToFreq } from './notes.js';

let ctx = null;
let master = null;
let volume = 0.7;
let instrument = 'piano';
let pedal = false;

const live = new Map(); // midi -> voice held by the player
const sustained = []; // voices released while the pedal was down
const buffers = { p: new Map(), m: new Map(), f: new Map() }; // layer -> (sample midi -> AudioBuffer)
const LAYERS = ['m', 'p', 'f']; // medium loads first so the piano is playable sooner
let loadState = 'idle'; // idle | loading | ready | failed
const statusListeners = new Set();

// Samples every minor third from A0 to C8, in three velocity layers.
const SAMPLE_NOTES = (() => {
  const files = [['A0', 21]];
  const pcs = { C: 0, Ds: 3, Fs: 6, A: 9 };
  for (let oct = 1; oct <= 7; oct++) {
    for (const [n, pc] of Object.entries(pcs)) files.push([`${n}${oct}`, (oct + 1) * 12 + pc]);
  }
  files.push(['C8', 108]);
  return files;
})();

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ------------------------------------------------------------------ samples

/**
 * Start downloading the piano samples. Safe to call before any user gesture.
 * The medium layer loads first (the piano is usable as soon as it's in), then
 * the soft and loud layers in the background.
 */
export function loadPiano() {
  if (loadState !== 'idle') return;
  setLoadState('loading');
  // Decode with an offline context so no audio output is created before a gesture.
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const loadLayer = (layer) => Promise.allSettled(SAMPLE_NOTES.map(async ([name, midi]) => {
    const res = await fetch(sampleUrl(name, layer));
    if (!res.ok) throw new Error(`${name}-${layer}: ${res.status}`);
    buffers[layer].set(midi, await decoder.decodeAudioData(await res.arrayBuffer()));
  }));
  (async () => {
    for (const layer of LAYERS) {
      await loadLayer(layer);
      if (layer === 'm') {
        setLoadState(buffers.m.size >= SAMPLE_NOTES.length * 0.8 ? 'ready' : 'failed');
        if (loadState === 'failed') return;
      }
    }
    allLayersLoaded();
  })();
}

const SAMPLE_BASE = new URL('../samples/salamander/', import.meta.url);
const sampleUrl = (name, layer) => new URL(`${name}-${layer}.mp3`, SAMPLE_BASE).href;
/** Every sample file's address (for the service worker to keep them for offline use). */
export const sampleUrls = () => LAYERS.flatMap((layer) => SAMPLE_NOTES.map(([name]) => sampleUrl(name, layer)));
let allLayersLoaded;
/** Resolves once all three layers of the sampled piano have loaded. */
export const pianoLoaded = new Promise((resolve) => { allLayersLoaded = resolve; });

function setLoadState(s) {
  loadState = s;
  statusListeners.forEach((fn) => fn(s));
}

export function onLoadState(fn) {
  statusListeners.add(fn);
  fn(loadState);
}

function nearestSample(map, midi) {
  let best = null;
  for (const m of map.keys()) {
    if (best === null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
  }
  return best;
}

/** Which recorded dynamic to use: soft (p), medium (m) or loud (f). */
function layerFor(velocity) {
  const want = velocity < 0.45 ? 'p' : velocity < 0.85 ? 'm' : 'f';
  return buffers[want].size === SAMPLE_NOTES.length ? want : 'm'; // until that layer has loaded
}

function sampleVoice(midi, velocity, t) {
  const c = ensure();
  const layer = layerFor(velocity);
  const sm = nearestSample(buffers[layer], midi);
  const src = c.createBufferSource();
  src.buffer = buffers[layer].get(sm);
  src.playbackRate.value = Math.pow(2, (midi - sm) / 12);

  // The recordings already differ in tone between layers; the filter only
  // smooths the steps within a layer.
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 3000 + 15000 * velocity;

  const env = c.createGain();
  const level = 1.5 * (0.7 + 0.3 * velocity);
  env.gain.setValueAtTime(level, t);
  src.connect(filter).connect(env).connect(master);
  src.start(t);
  return { env, sources: [src], damper: 0.09 };
}

// -------------------------------------------------------------------- synth

const PARTIALS = [
  [1, 'triangle', 1],
  [2, 'sine', 0.35],
  [3, 'sine', 0.12],
  [4, 'sine', 0.05],
];

function synthVoice(midi, velocity, t) {
  const c = ensure();
  const f = midiToFreq(midi);
  const tau = Math.min(3, Math.max(0.25, 1.4 * Math.pow(2, -(midi - 60) / 18)));

  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.28 * velocity, t + 0.005);
  env.gain.setTargetAtTime(0, t + 0.005, tau);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.4;
  filter.frequency.setValueAtTime(Math.min(f * 12, 16000), t);
  filter.frequency.setTargetAtTime(Math.min(f * 3, 10000), t, 0.3);
  filter.connect(env).connect(master);

  const end = t + tau * 7;
  const sources = PARTIALS.map(([mult, type, amp]) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    o.detune.value = (Math.random() - 0.5) * 4;
    const g = c.createGain();
    g.gain.value = amp;
    o.connect(g).connect(filter);
    o.start(t);
    o.stop(end);
    return o;
  });
  return { env, sources, damper: 0.08 };
}

// ------------------------------------------------------------------- voices

function createVoice(midi, velocity, t) {
  return instrument === 'piano' && loadState === 'ready' && buffers.m.size
    ? sampleVoice(midi, velocity, t)
    : synthVoice(midi, velocity, t);
}

function releaseVoice(v, t, time = v.damper) {
  v.env.gain.cancelScheduledValues(t);
  v.env.gain.setTargetAtTime(0, t, time);
  for (const s of v.sources) {
    try { s.stop(t + time * 10); } catch { /* already stopped */ }
  }
}

export function noteOn(midi, velocity = 0.8) {
  const c = ensure();
  const now = c.currentTime;
  if (live.has(midi)) releaseVoice(live.get(midi), now, 0.03);
  // Re-striking a note that the pedal is holding damps the old one.
  for (let i = sustained.length - 1; i >= 0; i--) {
    if (sustained[i].midi === midi) releaseVoice(sustained.splice(i, 1)[0], now, 0.05);
  }
  const v = createVoice(midi, velocity, now);
  v.midi = midi;
  live.set(midi, v);
}

export function noteOff(midi) {
  const v = live.get(midi);
  if (!v || !ctx) return;
  live.delete(midi);
  if (pedal) sustained.push(v);
  else releaseVoice(v, ctx.currentTime);
}

export function setPedal(down) {
  if (pedal === down) return;
  pedal = down;
  if (!down && ctx) {
    const now = ctx.currentTime;
    for (const v of sustained.splice(0)) releaseVoice(v, now, 0.15);
  }
}

export const isPedalDown = () => pedal;

export function setInstrument(name) {
  instrument = name;
  if (name === 'piano') loadPiano();
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
}

/** Wake the audio context from a user gesture (browsers block autoplay). */
export function unlock() { ensure(); }

// ------------------------------------------------------------- scheduling

/** Current audio clock time in seconds. */
export const now = () => ensure().currentTime;

/**
 * Convert an audio-clock time to the performance.now() time at which the
 * listener actually hears it (including output latency), so key presses can be
 * compared with when the beat was heard.
 */
export function heardAt(audioTime) {
  const c = ensure();
  const latency = (c.baseLatency || 0) + (c.outputLatency || 0);
  return performance.now() + (audioTime - c.currentTime + latency) * 1000;
}

/** Metronome click at an audio time. `accent` for the first beat of a bar. */
export function click(t, accent = false) {
  const c = ensure();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1320;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.22 : 0.13, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.06);
  return { env: g, sources: [o], damper: 0.01 };
}

/**
 * Schedule notes and clicks at absolute audio times:
 * notes [{ midi, at, dur, velocity }], clicks [{ at, accent }].
 * Returns a function that silences everything.
 */
export function schedule({ notes = [], clicks = [] }) {
  const voices = [];
  for (const n of notes) {
    const v = createVoice(n.midi, n.velocity ?? 0.6, n.at);
    releaseVoice(v, n.at + n.dur * 0.95);
    voices.push(v);
  }
  for (const k of clicks) voices.push(click(k.at, k.accent));
  return () => {
    const t = ctx.currentTime;
    for (const v of voices) {
      v.env.gain.cancelScheduledValues(0);
      v.env.gain.setValueAtTime(0, t);
      for (const src of v.sources) {
        try { src.stop(t + 0.02); } catch { /* not started or already stopped */ }
      }
    }
  };
}

/** Play notes right now for a fixed length (used for auto-played accompaniment). */
export function playNotes(notes, bpm = 100) {
  const c = ensure();
  for (const { midi, beats, velocity } of notes) {
    const v = createVoice(midi, velocity ?? 0.55, c.currentTime);
    releaseVoice(v, c.currentTime + beats * (60 / bpm) * 0.95);
  }
}

/**
 * Play a list of steps. Each step is { beats, midi | midis | notes } where
 * `beats` is the gap to the next step and `notes` ([{midi, beats}]) lets each
 * note ring for its own length. Calls onStep(i, seconds) as each step starts
 * and onDone() at the end. Returns a function that stops playback.
 */
export function playSequence(steps, { bpm = 100, onStep, onDone } = {}) {
  const c = ensure();
  const spb = 60 / bpm;
  const t0 = c.currentTime + 0.1;
  const voices = [];
  const timers = [];
  let t = t0;

  steps.forEach((step, i) => {
    const dur = step.beats * spb;
    const notes = step.notes ?? (step.midis ?? [step.midi]).map((midi) => ({ midi, beats: step.beats }));
    for (const n of notes) {
      const v = createVoice(n.midi, n.velocity ?? 0.65, t);
      releaseVoice(v, t + n.beats * spb * 0.95);
      voices.push(v);
    }
    const delay = (t - c.currentTime) * 1000;
    timers.push(setTimeout(() => onStep?.(i, dur), delay));
    t += dur;
  });
  timers.push(setTimeout(() => onDone?.(), (t - c.currentTime) * 1000));

  return function stop() {
    timers.forEach(clearTimeout);
    const now = c.currentTime;
    for (const v of voices) {
      v.env.gain.cancelScheduledValues(0);
      v.env.gain.setValueAtTime(v.env.gain.value, now);
      v.env.gain.linearRampToValueAtTime(0, now + 0.05);
      for (const s of v.sources) {
        try { s.stop(now + 0.06); } catch { /* not started or already stopped */ }
      }
    }
  };
}
