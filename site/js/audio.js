// Sound engine: a sampled grand piano (Salamander, CC BY 3.0, see
// samples/salamander/LICENSE.txt) with a small synth used as a fallback while
// the samples load, or if the player picks it. Includes a sustain pedal.
import { midiToFreq } from './notes.js';

let ctx = null;
let master = null;
let volume = 0.7;
let instrument = 'piano';
let pedal = false;

const live = new Map(); // midi -> voice held by the player
const sustained = []; // voices released while the pedal was down
const buffers = new Map(); // sample midi -> AudioBuffer
let loadState = 'idle'; // idle | loading | ready | failed
const statusListeners = new Set();

// Samples every minor third from A0 to C8.
const SAMPLE_FILES = (() => {
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

/** Start downloading the piano samples. Safe to call before any user gesture. */
export function loadPiano() {
  if (loadState !== 'idle') return;
  setLoadState('loading');
  // Decode with an offline context so no audio output is created before a gesture.
  const decoder = new OfflineAudioContext(2, 1, 44100);
  const base = new URL('../samples/salamander/', import.meta.url);
  Promise.allSettled(SAMPLE_FILES.map(async ([name, midi]) => {
    const res = await fetch(new URL(`${name}.mp3`, base));
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const data = await res.arrayBuffer();
    buffers.set(midi, await decoder.decodeAudioData(data));
  })).then((results) => {
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setLoadState(ok >= SAMPLE_FILES.length * 0.8 ? 'ready' : 'failed');
  });
}

function setLoadState(s) {
  loadState = s;
  statusListeners.forEach((fn) => fn(s));
}

export function onLoadState(fn) {
  statusListeners.add(fn);
  fn(loadState);
}

function nearestSample(midi) {
  let best = null;
  for (const m of buffers.keys()) {
    if (best === null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
  }
  return best;
}

function sampleVoice(midi, velocity, t) {
  const c = ensure();
  const sm = nearestSample(midi);
  const src = c.createBufferSource();
  src.buffer = buffers.get(sm);
  src.playbackRate.value = Math.pow(2, (midi - sm) / 12);

  // Softer notes on a real piano are also darker.
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200 + 14000 * velocity * velocity;

  const env = c.createGain();
  const level = 0.25 + 0.95 * Math.pow(velocity, 1.6);
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
  return instrument === 'piano' && loadState === 'ready'
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

/** Play notes right now for a fixed length (used for auto-played accompaniment). */
export function playNotes(notes, bpm = 100) {
  const c = ensure();
  for (const { midi, beats } of notes) {
    const v = createVoice(midi, 0.55, c.currentTime);
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
      const v = createVoice(n.midi, 0.65, t);
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
