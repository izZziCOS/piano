// Free play: shows the note you just played and a short history.
import { fullName, noteName, midiToFreq } from './notes.js';

const $ = (id) => document.getElementById(id);
const history = [];

export function init() {}

export function onNote(midi) {
  $('play-note').textContent = fullName(midi);
  $('play-detail').textContent = `${noteName(midi)} · ${midiToFreq(midi).toFixed(1)} Hz`;
  history.unshift(midi);
  history.length = Math.min(history.length, 16);
  $('play-history').innerHTML = history
    .map((m) => `<span class="chip">${noteName(m)}</span>`)
    .join('');
}
