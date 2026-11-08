// "Check yourself" questions at the end of each Learn chapter. A chapter counts
// as done once you answer its questions with at most one slip, so the ticks on
// the Learn page show what you've actually learned, not just read.
//
// Each chapter has a function that makes a fresh set of questions (the notes
// to name are picked at random, so trying again isn't just memorising
// answers). A question is { text, piece?, showTime?, choices, answer, why }:
// `piece` is drawn on a staff above the choices (with its time signature if
// `showTime`), and `why` is shown after answering.

const ex = (opts) => ({ key: 'C', time: '4/4', bpm: 90, ...opts });
const LETTERS = 'CDEFGAB';
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pickN = (arr, n) => shuffle(arr).slice(0, n);
/** "F#5" → "F♯", "Bb4" → "B♭". */
const pretty = (note) => note.replace(/-?\d+$/, '').replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
const order = (name) => LETTERS.indexOf(name[0]) * 3 + (name.includes('♭') ? 0 : name.includes('♯') ? 2 : 1);

/**
 * "What is this note?": a whole note on a staff, with four names to choose
 * from in alphabetical order. `hand` is 'rh' (treble) or 'lh' (bass).
 */
function nameNote(note, { hand = 'rh', key = 'C', text = 'What is this note?', why = '', other = false } = {}) {
  const answer = pretty(note);
  const letter = answer[0];
  const choices = new Set([answer]);
  if (answer.length > 1) {
    // Sharps and flats: the plain letter and its other accidental are the tempting wrong answers.
    choices.add(letter);
    choices.add(answer.includes('♯') ? `${letter}♭` : `${letter}♯`);
  }
  for (const l of shuffle([...LETTERS])) if (choices.size < 4 && l !== letter) choices.add(l);
  const piece = { [hand]: `${note}:4` };
  // With both staves showing, the other one gets a rest.
  if (other) piece[hand === 'rh' ? 'lh' : 'rh'] = 'R:4';
  return { text, piece: ex({ key, ...piece }), choices: [...choices].sort((a, b) => order(a) - order(b)), answer, why };
}

const lineWhy = (note, clef) => {
  const lines = clef === 'treble' ? ['E4', 'G4', 'B4', 'D5', 'F5'] : ['G2', 'B2', 'D3', 'F3', 'A3'];
  const i = lines.indexOf(note);
  if (i >= 0) return `It’s on line ${i + 1} from the bottom: ${clef === 'treble' ? 'Every Good Boy Does Fine' : 'Good Boys Do Fine Always'}.`;
  const spaces = clef === 'treble' ? ['F4', 'A4', 'C5', 'E5'] : ['A2', 'C3', 'E3', 'G3'];
  const j = spaces.indexOf(note);
  if (j >= 0) return `It’s in space ${j + 1} from the bottom: ${clef === 'treble' ? 'F A C E' : 'All Cows Eat Grass'}.`;
  return '';
};

export const CHECKS = {
  staff: () => {
    const from = pick(['E4', 'F4', 'G4', 'A4', 'B4']);
    const dia = (n) => LETTERS.indexOf(n[0]) + 7 * +n.slice(-1);
    const nameOf = (d) => `${LETTERS[d % 7]}${Math.floor(d / 7)}`;
    const step = Math.random() < 0.5;
    const to = nameOf(dia(from) + (step ? 1 : 2));
    return [
      { text: 'How many lines does a staff have?', choices: ['3', '4', '5', '6'], answer: '5', why: 'Five lines, with four spaces between them.' },
      {
        text: 'From the first note to the second: a step or a skip?',
        piece: ex({ rh: `${from}:2 ${to}:2` }),
        choices: ['Step', 'Skip'],
        answer: step ? 'Step' : 'Skip',
        why: step ? 'It moves from a line to the very next space (or space to line): a step, the next white key.'
          : 'It jumps over one line or space: a skip, which jumps over one white key.',
      },
      { text: 'A note written higher on the staff sounds…', choices: ['Higher', 'Lower', 'The same'], answer: 'Higher', why: 'Higher on the staff means higher in pitch, further right on the piano.' },
      { text: 'A step on the staff is the next … on the piano.', choices: ['White key', 'Black key', 'Octave'], answer: 'White key', why: 'Each line and space is one white key.' },
    ];
  },

  treble: () => [
    ...pickN(['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'], 3).map((n) => nameNote(n, { why: lineWhy(n, 'treble') })),
    { text: 'The lines of the treble staff, from the bottom up, are…', choices: ['E G B D F', 'F A C E', 'G B D F A', 'A C E G'], answer: 'E G B D F', why: '“Every Good Boy Does Fine”. F A C E are the spaces.' },
  ],

  bass: () => [
    ...pickN(['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'], 3).map((n) => nameNote(n, { hand: 'lh', why: lineWhy(n, 'bass') })),
    { text: 'The spaces of the bass staff, from the bottom up, are…', choices: ['A C E G', 'F A C E', 'G B D F A', 'E G B D F'], answer: 'A C E G', why: '“All Cows Eat Grass”. G B D F A are the lines.' },
  ],

  ledger: () => [
    ...pickN([['C4', 'rh'], ['B3', 'rh'], ['A3', 'rh'], ['C4', 'lh'], ['D4', 'lh'], ['E4', 'lh']], 3).map(([n, hand]) => nameNote(n, {
      hand,
      why: n === 'C4' ? 'One ledger line between the staves is middle C.' : `Count on from middle C, line, space, line: it’s ${pretty(n)}.`,
    })),
    {
      text: 'In the bass clef, middle C sits…',
      choices: ['One ledger line above the staff', 'One ledger line below the staff', 'On the middle line'],
      answer: 'One ledger line above the staff',
      why: 'Middle C is between the two staves: below the treble staff, above the bass staff.',
    },
  ],

  grand: () => [
    { text: 'Which staff does the left hand usually read?', choices: ['The bottom (bass) staff', 'The top (treble) staff'], answer: 'The bottom (bass) staff', why: 'Treble on top for the right hand, bass underneath for the left.' },
    { text: 'Notes lined up one above the other are played…', choices: ['At the same time', 'One after the other', 'Only with the right hand'], answer: 'At the same time', why: 'Read both staves at each point: everything lined up sounds together.' },
    ...[pick(['E4', 'G4', 'B4', 'D5', 'F4', 'A4', 'C5'])].map((n) => nameNote(n, { text: 'What is the note on the top staff?', other: true, why: `The top staff is treble. ${lineWhy(n, 'treble')}` })),
    ...[pick(['G2', 'B2', 'D3', 'F3', 'A2', 'C3', 'E3'])].map((n) => nameNote(n, { hand: 'lh', text: 'What is the note on the bottom staff?', other: true, why: `The bottom staff is bass. ${lineWhy(n, 'bass')}` })),
  ],

  durations: () => {
    const notes = [
      { rh: 'C5:4', beats: '4', name: 'A whole note (hollow, no stem)' },
      { rh: 'C5:2 R:2', beats: '2', name: 'A half note (hollow, with a stem)' },
      { rh: 'C5 R:3', beats: '1', name: 'A quarter note (filled, with a stem)' },
      { rh: 'C5:3 R:1', beats: '3', name: 'A dotted half note: 2 beats and half again' },
      { rh: 'C5:1.5 R:0.5 R:2', beats: '1½', name: 'A dotted quarter: 1 beat and half again' },
      { rh: 'C5:0.5 R:0.5 R:3', beats: '½', name: 'An eighth note (one flag)' },
    ];
    return [
      ...pickN(notes, 3).map((n) => ({
        text: 'How many beats does the first note last?',
        piece: ex({ rh: n.rh }),
        choices: ['½', '1', '1½', '2', '3', '4'],
        answer: n.beats,
        why: `${n.name} lasts ${n.beats} ${n.beats === '1' || n.beats === '½' ? 'beat' : 'beats'}.`,
      })),
      { text: 'A dot after a note…', choices: ['Adds half its length again', 'Doubles its length', 'Makes it short and detached'], answer: 'Adds half its length again', why: 'A dotted half note is 2 + 1 = 3 beats.' },
    ];
  },

  rests: () => {
    const rests = [
      { rh: 'R:4', name: 'Whole rest', why: 'It hangs below a line.' },
      { rh: 'R:2 C5:2', name: 'Half rest', why: 'It sits on top of a line, like a hat.' },
      { rh: 'R:1 C5 C5:2', name: 'Quarter rest', why: 'The squiggle is a quarter rest.' },
      { rh: 'R:0.5 C5:0.5 C5 C5:2', name: 'Eighth rest', why: 'It looks like a 7 with a dot.' },
    ];
    return [
      ...pickN(rests, 3).map((r) => ({
        text: 'What is the first symbol in this bar?',
        piece: ex({ rh: r.rh }),
        choices: rests.map((x) => x.name),
        answer: r.name,
        why: r.why,
      })),
      { text: 'How many beats of silence is a half rest?', choices: ['½', '1', '2', '4'], answer: '2', why: 'Rests last as long as the matching note: a half note is 2 beats.' },
    ];
  },

  time: () => {
    const [time, rh] = pick([['2/4', 'C5 E5'], ['3/4', 'C5 E5 G5'], ['4/4', 'C5 E5 G5 E5']]);
    return [
      {
        text: 'How many beats are in each bar of this music?',
        piece: ex({ time, rh: `${rh} | ${rh}` }),
        showTime: true,
        choices: ['2', '3', '4', '8'],
        answer: time[0],
        why: `The top number of ${time} says ${time[0]} beats in each bar.`,
      },
      { text: 'The top number of a time signature tells you…', choices: ['How many beats are in a bar', 'Which note gets one beat', 'How fast to play'], answer: 'How many beats are in a bar', why: 'The bottom number says which note gets the beat.' },
      { text: 'A bottom number of 4 means…', choices: ['A quarter note gets one beat', 'There are four bars', 'Play everything four times'], answer: 'A quarter note gets one beat', why: '4 = quarter note, 8 = eighth note.' },
    ];
  },

  accidentals: () => [
    { text: 'A sharp (♯)…', choices: ['Raises a note a half step', 'Lowers a note a half step', 'Cancels a flat only'], answer: 'Raises a note a half step', why: 'F♯ is the black key just right of F.' },
    ...pickN(['C#4', 'Eb4', 'F#4', 'Bb4', 'G#4', 'Ab4', 'C#5', 'Eb5'], 2).map((n) => nameNote(n, {
      why: n.includes('#') ? `The ♯ raises ${n[0]}: the key just right of it.` : `The ♭ lowers ${n[0]}: the key just left of it.`,
    })),
    { text: 'An accidental lasts…', choices: ['Until the end of the bar', 'For the whole piece', 'For that one note only'], answer: 'Until the end of the bar', why: 'The next bar goes back to normal. (Key signatures last the whole piece.)' },
  ],

  keysig: () => [
    ...pickN([['G', 'F#5'], ['G', 'F#4'], ['F', 'Bb4'], ['D', 'C#5'], ['D', 'F#4']], 2).map(([key, n]) => nameNote(n, {
      key,
      text: 'Mind the key signature. What is this note?',
      why: `The key signature makes every ${n[0]} a ${pretty(n)}, even without a sign next to the note.`,
    })),
    { text: 'One sharp (F♯) in the key signature means…', choices: ['G major', 'D major', 'F major', 'C major'], answer: 'G major', why: 'One sharp, F♯: G major (or E minor).' },
    { text: 'One flat (B♭) in the key signature means…', choices: ['F major', 'G major', 'B♭ major', 'D major'], answer: 'F major', why: 'One flat, B♭: F major (or D minor).' },
  ],

  markings: () => [
    { text: 'Finger number 1 is your…', choices: ['Thumb', 'Index finger', 'Little finger'], answer: 'Thumb', why: 'Thumb 1 to little finger 5, on both hands.' },
    { text: 'A tie joins…', choices: ['Two notes of the same pitch: play once and hold', 'Different notes, played smoothly', 'A note you play twice'], answer: 'Two notes of the same pitch: play once and hold', why: 'Play the first note and hold it through the second.' },
    { text: 'Which marking is the loudest?', choices: ['pp', 'p', 'mf', 'f'], answer: 'f', why: 'f (forte) is loud; ff would be louder still.' },
    { text: 'A repeat sign :‖ means…', choices: ['Go back and play that part again', 'The end of the piece', 'Pause for a beat'], answer: 'Go back and play that part again', why: 'Go back to the matching sign, or the beginning, and play it again.' },
  ],

  'reading-tips': () => [
    ...pickN(['D4', 'E4', 'F4', 'G4'], 2).map((n) => ({
      text: 'The first note is middle C, a landmark. What is the second?',
      piece: ex({ rh: `C4:2 ${n}:2` }),
      choices: ['D', 'E', 'F', 'G'],
      answer: n[0],
      why: `Count up from C: ${'CDEFG'.slice(0, 'CDEFG'.indexOf(n[0]) + 1).split('').join(', ')}.`,
    })),
    { text: 'While you play one note, your eyes should be…', choices: ['Already on the next note', 'On your hands', 'On the note you’re playing'], answer: 'Already on the next note', why: 'Look ahead, so the next note is ready before you need it.' },
    { text: 'Which helps your reading more?', choices: ['Five minutes every day', 'One hour once a week'], answer: 'Five minutes every day', why: 'Little and often beats long and rare.' },
  ],
};
