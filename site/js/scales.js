// Scales & chords reference: highlights the shape on the keyboard and plays it.
import { SHARP_NAMES, FLAT_NAMES, spell } from './notes.js';
import * as audio from './audio.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

const SCALES = {
  major: { name: 'Major scale', steps: [0, 2, 4, 5, 7, 9, 11, 12], deg: [1, 2, 3, 4, 5, 6, 7, 8], minor: false, desc: 'The bright, familiar “do-re-mi” sound. Start here: every major scale uses the same pattern of whole and half steps.' },
  minor: { name: 'Natural minor scale', steps: [0, 2, 3, 5, 7, 8, 10, 12], deg: [1, 2, 3, 4, 5, 6, 7, 8], minor: true, desc: 'A darker, sadder sound. It shares its notes with the major scale three half steps above.' },
  harmonic: { name: 'Harmonic minor scale', steps: [0, 2, 3, 5, 7, 8, 11, 12], deg: [1, 2, 3, 4, 5, 6, 7, 8], minor: true, desc: 'Natural minor with a raised 7th, which gives the step-and-a-half jump near the top.' },
  pentaMajor: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9, 12], deg: [1, 2, 3, 5, 6, 8], minor: false, desc: 'Five notes with no half steps, so it is hard to play a wrong-sounding note. Common in folk songs.' },
  pentaMinor: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10, 12], deg: [1, 3, 4, 5, 7, 8], minor: true, desc: 'The go-to scale for rock and blues improvisation.' },
  blues: { name: 'Blues scale', steps: [0, 3, 5, 6, 7, 10, 12], deg: [1, 3, 4, 5, 5, 7, 8], minor: true, desc: 'Minor pentatonic plus the “blue note” (♭5).' },
};

const CHORDS = {
  maj: { name: 'Major chord', steps: [0, 4, 7], deg: [1, 3, 5], minor: false, desc: 'Root, major 3rd and 5th. Sounds stable and happy.' },
  min: { name: 'Minor chord', steps: [0, 3, 7], deg: [1, 3, 5], minor: true, desc: 'Lower the 3rd of a major chord by one half step and you get a minor chord.' },
  dim: { name: 'Diminished chord', steps: [0, 3, 6], deg: [1, 3, 5], minor: true, desc: 'Two minor 3rds stacked. Tense, and it wants to resolve.' },
  aug: { name: 'Augmented chord', steps: [0, 4, 8], deg: [1, 3, 5], minor: false, desc: 'Two major 3rds stacked. Dreamy and unresolved.' },
  sus2: { name: 'Sus2 chord', steps: [0, 2, 7], deg: [1, 2, 5], minor: false, desc: 'The 3rd is replaced by the 2nd, so it is neither major nor minor.' },
  sus4: { name: 'Sus4 chord', steps: [0, 5, 7], deg: [1, 4, 5], minor: false, desc: 'The 3rd is replaced by the 4th. It usually resolves to a major chord.' },
  maj7: { name: 'Major 7th chord', steps: [0, 4, 7, 11], deg: [1, 3, 5, 7], minor: false, desc: 'A major chord plus the major 7th. Smooth and jazzy.' },
  min7: { name: 'Minor 7th chord', steps: [0, 3, 7, 10], deg: [1, 3, 5, 7], minor: true, desc: 'A minor chord plus the flat 7th. Mellow.' },
  dom7: { name: 'Dominant 7th chord', steps: [0, 4, 7, 10], deg: [1, 3, 5, 7], minor: false, desc: 'A major chord plus the flat 7th. Bluesy, and it pulls toward the chord a 5th below.' },
};

const DEGREES = { 0: '1', 2: '2', 3: '♭3', 4: '3', 5: '4', 6: '♭5', 7: '5', 8: '♯5', 10: '♭7', 11: '7' };
const STEP_NAMES = { 1: 'H', 2: 'W', 3: 'W+H' };

let kb;
let stopPlay = null;

export function init(keyboard) {
  kb = keyboard;
  $('scale-root').innerHTML = SHARP_NAMES.map((n, pc) =>
    `<option value="${pc}">${n === FLAT_NAMES[pc] ? n : `${n} / ${FLAT_NAMES[pc]}`}</option>`).join('');
  const opts = (group) => Object.entries(group).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join('');
  $('scale-type').innerHTML = `<optgroup label="Scales">${opts(SCALES)}</optgroup><optgroup label="Chords">${opts(CHORDS)}</optgroup>`;
  $('scale-root').value = store.get('scaleRoot', 0);
  $('scale-type').value = store.get('scaleType', 'major');
  $('scale-root').addEventListener('change', () => { store.set('scaleRoot', +$('scale-root').value); show(); });
  $('scale-type').addEventListener('change', () => { store.set('scaleType', $('scale-type').value); show(); });
  $('scale-play').addEventListener('click', play);
}

export function enter() { show(); }

export function exit() {
  stop();
  kb.clear('scale');
  kb.clear('root');
}

function current() {
  const root = +$('scale-root').value;
  const type = $('scale-type').value;
  const isChord = type in CHORDS;
  const def = isChord ? CHORDS[type] : SCALES[type];
  const base = 60 + root;
  const names = spell(root, def.minor, def.steps, def.deg);
  return { def, isChord, names, midis: def.steps.map((s) => base + s) };
}

function show() {
  stop();
  const { def, isChord, names, midis } = current();
  kb.clear('scale');
  kb.clear('root');
  kb.mark(midis, 'scale');
  kb.reveal(midis);
  kb.mark([midis[0], isChord ? midis[0] : midis[midis.length - 1]], 'root');

  const rootName = names[0];
  $('scale-title').textContent = `${rootName} ${def.name.replace(/ (scale|chord)$/, '').toLowerCase()} ${isChord ? 'chord' : def.name.endsWith('scale') ? 'scale' : ''}`.trim();
  $('scale-notes').innerHTML = names.map((n, i) =>
    `<span class="chip${i === 0 ? ' root' : ''}">${n}</span>`).join('');
  $('scale-formula').textContent = isChord
    ? `Formula: ${def.steps.map((s) => DEGREES[s]).join(' – ')}`
    : `Steps: ${def.steps.slice(1).map((s, i) => STEP_NAMES[s - def.steps[i]]).join(' – ')}  (W = whole step, H = half step)`;
  $('scale-desc').textContent = def.desc;
}

function play() {
  if (stopPlay) return stop();
  const { isChord, midis, names } = current();
  const nameOf = new Map(midis.map((m, i) => [m, names[i]]));
  const steps = isChord
    ? [...midis.map((midi) => ({ midi, beats: 0.6 })), { midis, beats: 2.5 }]
    : [...midis, ...midis.slice(0, -1).reverse()].map((midi) => ({ midi, beats: 0.5 }));
  $('scale-play').textContent = 'Stop';
  stopPlay = audio.playSequence(steps, {
    bpm: 100,
    onStep: (i) => {
      kb.showPlayed((steps[i].midis ?? [steps[i].midi]).map((midi) => ({ midi, beats: steps[i].beats, name: nameOf.get(midi) })), 60 / 100);
    },
    onDone: stop,
  });
}

function stop() {
  if (!stopPlay) return;
  stopPlay();
  stopPlay = null;
  $('scale-play').textContent = 'Play';
  kb.clear('demo');
}
