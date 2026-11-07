// Note helpers. Notes are MIDI numbers: middle C (C4) = 60, A4 = 69.

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const LETTERS = 'CDEFGAB';

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(pitchClass(midi));
export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function noteName(midi, { flats = false, octave = true } = {}) {
  const name = (flats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
  return octave ? name + octaveOf(midi) : name;
}

/** Both spellings for black keys, e.g. "C♯/D♭". */
export function fullName(midi, { octave = false } = {}) {
  const s = noteName(midi, { octave });
  return isBlack(midi) ? `${s}/${noteName(midi, { flats: true, octave })}` : s;
}

/** Parse "C4", "F#3", "Bb5" into a MIDI number. */
export function parseNote(str) {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(str.trim());
  if (!m) throw new Error(`Bad note: ${str}`);
  let pc = LETTER_PCS[LETTERS.indexOf(m[1].toUpperCase())];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  else if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

/**
 * Parse a melody string such as "!mf E4@3 D4@2 C4:2~ | C4 R:1 C3+E3+G3@5+3+1:2".
 *   :2        two beats (default one)       R        rest
 *   +         joins a chord                  @3       finger number(s), "+"-separated for chords
 *   ~         tie into the next note         !mf      dynamic marking for the next note
 *   |         optional bar line, only for readability
 * Each event: { midis, names, beats, rest, midi, fingers, tie, dynamic }.
 */
export function parseMelody(str) {
  const events = [];
  let dynamic = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|' || !tok) continue;
    if (tok.startsWith('!')) { dynamic = tok.slice(1); continue; }
    const tie = tok.endsWith('~');
    const [head, beatsStr] = tok.replace(/~$/, '').split(':');
    const beats = beatsStr ? parseFloat(beatsStr) : 1;
    const [notes, fingerStr] = head.split('@');
    const fingers = fingerStr ? fingerStr.split('+') : [];
    if (notes === 'R') {
      events.push({ midis: [], names: [], beats, rest: true, midi: null, fingers: [], tie: false, dynamic });
    } else {
      const names = notes.split('+');
      const midis = names.map(parseNote);
      events.push({ midis, names, beats, rest: false, midi: midis[0], fingers, tie, dynamic });
    }
    dynamic = null;
  }
  return events;
}

/**
 * Diatonic step number (C0 = 0, D0 = 1 ... C4 = 28) plus accidental -> MIDI.
 * Used for drawing notes on a staff.
 */
export function diatonicToMidi(dia, accidental = 0) {
  const letter = ((dia % 7) + 7) % 7;
  const oct = Math.floor(dia / 7);
  return (oct + 1) * 12 + LETTER_PCS[letter] + accidental;
}

export function diatonicName(dia, accidental = 0) {
  const letter = LETTERS[((dia % 7) + 7) % 7];
  const acc = accidental > 0 ? '♯' : accidental < 0 ? '♭' : '';
  return letter + acc + Math.floor(dia / 7);
}

// Conventional spelling of each root: major keys prefer flats for D♭ E♭ A♭ B♭,
// minor keys prefer C♯ and G♯ minor (their relative majors are E and B major).
const ROOT_MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const ROOT_MINOR = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

/**
 * Spell the notes of a scale or chord. `semis` are semitones above the root and
 * `degrees` the matching scale degrees (1 = root, 3 = third…), so each note gets
 * the right letter: D harmonic minor is D E F G A B♭ C♯, not … D♭.
 */
export function spell(rootPc, minor, semis, degrees) {
  const root = (minor ? ROOT_MINOR : ROOT_MAJOR)[pitchClass(rootPc)];
  const rootLetter = LETTERS.indexOf(root[0]);
  const rootSpelledPc = pitchClass(LETTER_PCS[rootLetter] + (root[1] === '♯' ? 1 : root[1] === '♭' ? -1 : 0));
  return semis.map((s, i) => {
    const letter = (rootLetter + degrees[i] - 1) % 7;
    const diff = ((rootSpelledPc + s - LETTER_PCS[letter]) % 12 + 18) % 12 - 6;
    return LETTERS[letter] + (ACC[diff] ?? '?');
  });
}
