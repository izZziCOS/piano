// Sheet music library. Everything here is public domain; some pieces are
// simplified arrangements. Format (see parseMelody in notes.js):
//   note[:beats]  — beats in quarter notes (0.25 = 16th, 0.5 = 8th, 1.5 = dotted quarter…)
//   R:beats       — rest
//   C3+E3+G3:2    — chord
//   |             — bar line (only for readability; bars are computed from `time`)
// `rh` is drawn on the treble staff and `lh` on the bass staff.
// `pickup` is the length of an opening partial bar, in beats.
// `generated` pieces are built on the fly (see generator.js).

export const PIECES = [
  // ---- Reading practice (generated) ----
  {
    id: 'random',
    title: 'Random sheet',
    composer: 'Generated',
    level: 'Reading practice',
    generated: 'random',
    key: 'C', time: '4/4', bpm: 80,
    desc: 'Fresh notes every time. Choose the clef, keys, range, rhythm and more below. Notes you miss come back more often.',
  },
  {
    id: 'weak',
    title: 'Your weak notes',
    composer: 'Generated',
    level: 'Reading practice',
    generated: 'weak',
    key: 'C', time: '4/4', bpm: 80,
    desc: 'Made from the notes you have missed most in the reading tests and the note quiz.',
  },

  // ---- Beginner ----
  {
    id: 'rh-c-position',
    title: 'Right-hand C position',
    composer: 'Exercise',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 90,
    desc: 'Rest your right thumb on middle C with one finger per key, so C is finger 1 and G is finger 5. Don’t look at your hand.',
    rh: 'C4 D4 E4 F4 | G4 F4 E4 D4 | C4 E4 D4 F4 | E4 G4 F4 D4 | C4:4',
  },
  {
    id: 'hot-cross-buns',
    title: 'Hot Cross Buns',
    composer: 'Traditional',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 100,
    desc: 'Only three notes: E, D and C. The third bar has eighth notes, two to each beat.',
    rh: 'E4 D4 C4:2 | E4 D4 C4:2 | C4:0.5 C4:0.5 C4:0.5 C4:0.5 D4:0.5 D4:0.5 D4:0.5 D4:0.5 | E4 D4 C4:2',
  },
  {
    id: 'lh-c-position',
    title: 'Left-hand C position',
    composer: 'Exercise',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 90,
    desc: 'Left hand: pinky (finger 5) on the C below middle C, thumb on G. Notes in the bass clef read differently from the treble clef.',
    lh: 'C3 D3 E3 F3 | G3 F3 E3 D3 | C3 E3 D3 F3 | E3 G3 F3 D3 | C3:4',
  },
  {
    id: 'mary-hands',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 100,
    desc: 'Learn the right hand first. Then add the left hand, which plays one long note per bar.',
    rh: 'E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4',
    lh: 'C3:4 | C3:4 | G2:4 | C3:4 | C3:4 | C3:4 | G2:4 | C3:4',
  },
  {
    id: 'c-major-scale',
    title: 'C major scale',
    composer: 'Exercise',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 96,
    desc: 'Fingering: 1-2-3, then tuck your thumb under to F, then 1-2-3-4-5. Coming down, cross finger 3 over to E.',
    rh: 'C4 D4 E4 F4 | G4 A4 B4 C5 | B4 A4 G4 F4 | E4 D4 C4:2',
  },
  {
    id: 'lh-scale',
    title: 'C major scale (left hand)',
    composer: 'Exercise',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 90,
    desc: 'Left hand: 5-4-3-2-1, then cross finger 3 over to A, then 2-1. Reverse the crossing on the way down.',
    lh: 'C3 D3 E3 F3 | G3 A3 B3 C4 | B3 A3 G3 F3 | E3 D3 C3:2',
  },
  {
    id: 'twinkle-hands',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional',
    level: 'Beginner',
    key: 'C', time: '4/4', bpm: 100,
    desc: 'The first jump is from C up to G, a fifth. Stretch your hand from thumb to pinky.',
    rh: 'C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2',
    lh: 'C3:4 | F3:2 C3:2 | G2:2 C3:2 | G2:2 C3:2 | C3:2 G2:2 | C3:2 G2:2 | C3:2 G2:2 | C3:2 G2:2 | C3:4 | F3:2 C3:2 | G2:2 C3:2 | G2:2 C3:2',
  },

  // ---- Easy ----
  {
    id: 'ode-hands',
    title: 'Ode to Joy',
    composer: 'L. van Beethoven (arr.)',
    level: 'Easy',
    key: 'C', time: '4/4', bpm: 108,
    desc: 'Mostly steps between neighbouring keys. Watch the dotted quarter followed by an eighth in bars 4 and 8.',
    rh: 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2',
    lh: 'C3:4 | G2:4 | C3:4 | C3:2 G2:2 | C3:4 | G2:4 | C3:4 | G2:2 C3:2',
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells (chorus)',
    composer: 'J. Pierpont',
    level: 'Easy',
    key: 'C', time: '4/4', bpm: 120,
    desc: 'Lots of repeated notes. Keep the rhythm even and use a light touch.',
    rh: 'E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4:1.5 D4:0.5 | E4:4 | F4 F4 F4:1.5 F4:0.5 | F4 E4 E4 E4:0.5 E4:0.5 | E4 D4 D4 E4 | D4:2 G4:2',
  },
  {
    id: 'g-major-scale',
    title: 'G major scale',
    composer: 'Exercise',
    level: 'Easy',
    key: 'G', time: '4/4', bpm: 96,
    desc: 'The key signature has one sharp, so every F is played as F♯ even though no ♯ is written next to the note.',
    rh: 'G4 A4 B4 C5 | D5 E5 F#5 G5 | F#5 E5 D5 C5 | B4 A4 G4:2',
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional (arr.)',
    level: 'Easy',
    key: 'G', time: '3/4', bpm: 90, pickup: 1,
    desc: 'In 3/4, so count 1-2-3. It starts with a one-beat pickup before the first full bar.',
    rh: 'D4 | G4:2 B4:0.5 G4:0.5 | B4:2 A4 | G4:2 E4 | D4:2 D4 | G4:2 B4:0.5 G4:0.5 | B4:2 A4 | D5:3 | D5:2 B4:0.5 D5:0.5 | B4:2 G4 | D4:2 E4 | G4:2 E4 | D4:2 D4 | G4:2 B4:0.5 G4:0.5 | B4:2 A4 | G4:2',
    lh: 'R:1 | G3:3 | G3:3 | C3:3 | G3:3 | G3:3 | D3:3 | D3:3 | G3:3 | G3:3 | C3:3 | C3:3 | G3:3 | G3:3 | D3:3 | G3:2',
  },

  // ---- Intermediate ----
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditional',
    level: 'Intermediate',
    key: 'G', time: '4/4', bpm: 112,
    desc: 'In G major. Bars 5 and 6 have quick eighth notes, and the last phrase jumps down to the low D.',
    rh: 'G4 A4 B4 G4 | G4 A4 B4 G4 | B4 C5 D5:2 | B4 C5 D5:2 | D5:0.5 E5:0.5 D5:0.5 C5:0.5 B4 G4 | D5:0.5 E5:0.5 D5:0.5 C5:0.5 B4 G4 | G4 D4 G4:2 | G4 D4 G4:2',
  },
  {
    id: 'minuet-g',
    title: 'Minuet in G',
    composer: 'C. Petzold (simplified)',
    level: 'Intermediate',
    key: 'G', time: '3/4', bpm: 100,
    desc: 'A graceful dance in 3/4. Practise each hand on its own before putting them together.',
    rh: 'D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5 G4 G4 | E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5 G4 G4 | C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3',
    lh: 'G3+B3:2 A3 | B3:3 | C4:3 | B3:3 | A3:3 | G3:3 | D4 B3 G3 | D4:2 D3',
  },
  {
    id: 'canon-d',
    title: 'Canon in D (theme)',
    composer: 'J. Pachelbel (arr.)',
    level: 'Intermediate',
    key: 'D', time: '4/4', bpm: 72,
    desc: 'Two sharps, F♯ and C♯. The left hand repeats the same eight-note bass line, which is what makes it a ground bass.',
    rh: 'F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 | D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 | D4+F#4+A4:4',
    lh: 'D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2 | D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2 | D2:4',
  },
  {
    id: 'fur-elise',
    title: 'Für Elise (opening)',
    composer: 'L. van Beethoven',
    level: 'Intermediate',
    key: 'C', time: '3/8', bpm: 60, pickup: 0.5,
    desc: 'In 3/8, so count the eighth notes. The hands take turns: the left-hand broken chord leads straight into the right hand.',
    rh: 'E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 R:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 R:0.25 E4:0.25 G#4:0.25 B4:0.25 | C5:0.5 R:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 R:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 R:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1',
    lh: 'R:0.5 | R:1.5 | A2:0.25 E3:0.25 A3:0.25 R:0.75 | E2:0.25 E3:0.25 G#3:0.25 R:0.75 | A2:0.25 E3:0.25 A3:0.25 R:0.75 | R:1.5 | A2:0.25 E3:0.25 A3:0.25 R:0.75 | E2:0.25 E3:0.25 G#3:0.25 R:0.75 | A2:1',
    measureWidth: 260,
  },

  // ---- Advanced ----
  {
    id: 'prelude-c',
    title: 'Prelude in C (opening)',
    composer: 'J. S. Bach (simplified)',
    level: 'Advanced',
    key: 'C', time: '4/4', bpm: 66,
    desc: 'Each bar is one chord played as a pattern of sixteenth notes. Spot the chord shape and your hand can find the notes.',
    rh: 'C4:0.25 E4:0.25 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 C4:0.25 E4:0.25 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 | C4:0.25 D4:0.25 A4:0.25 D5:0.25 F5:0.25 A4:0.25 D5:0.25 F5:0.25 C4:0.25 D4:0.25 A4:0.25 D5:0.25 F5:0.25 A4:0.25 D5:0.25 F5:0.25 | B3:0.25 D4:0.25 G4:0.25 D5:0.25 F5:0.25 G4:0.25 D5:0.25 F5:0.25 B3:0.25 D4:0.25 G4:0.25 D5:0.25 F5:0.25 G4:0.25 D5:0.25 F5:0.25 | C4:0.25 E4:0.25 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 C4:0.25 E4:0.25 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25',
    lh: 'C3:4 | C3:4 | B2:4 | C3:4',
    measureWidth: 420,
  },
];
