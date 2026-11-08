// Turns a piece from pieces.js into a score (timed events + playable steps) and
// draws it as sheet music with VexFlow (loaded globally from vendor/).
import { parseMelody, noteName } from './notes.js';

const DURATIONS = { 4: 'w', 3: 'hd', 2: 'h', 1.5: 'qd', 1: 'q', 0.75: '8d', 0.5: '8', 0.25: '16' };
// How hard to play each dynamic marking (0–1 velocity).
const DYNAMICS = { pp: 0.3, p: 0.42, mp: 0.55, mf: 0.68, f: 0.85, ff: 1 };
const HANDS = { rh: { clef: 'treble', restKey: 'b/4' }, lh: { clef: 'bass', restKey: 'd/3' } };
/** Every key VexFlow can draw, with its number of sharps (+) or flats (−). */
export const KEY_SIGNATURES = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  Abm: -7, Ebm: -6, Bbm: -5, Fm: -4, Cm: -3, Gm: -2, Dm: -1, Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7,
};
/** Note lengths (in beats) that can be drawn. */
export const NOTE_LENGTHS = Object.keys(DURATIONS).map(Number);

/**
 * Parse a piece into per-hand bars of events and a list of steps (moments
 * where notes start). Tied continuation notes are not steps: they extend the
 * note they're tied from. With `repeat: true` the steps run through twice.
 * Every event gets `play` = how long it actually sounds (including ties).
 * `onIssue({ hand, bar, event })` is told about notes that cross a bar line
 * (by default they are logged as a warning).
 */
export function buildScore(piece, { onIssue } = {}) {
  const issue = onIssue ?? ((i) => console.warn(`${piece.id}: note at beat ${i.event.time} crosses a bar line (use a tie)`));
  const [num, den] = piece.time.split('/').map(Number);
  const barLen = (num * 4) / den;
  const pickup = piece.pickup ?? 0;
  const barOf = (t) => (pickup ? (t < pickup ? 0 : 1 + Math.floor((t - pickup + 1e-6) / barLen)) : Math.floor((t + 1e-6) / barLen));

  const hands = {};
  let barCount = 0;
  for (const hand of ['rh', 'lh']) {
    if (!piece[hand]) continue;
    let t = 0;
    let prev = null;
    let vel = 0.65;
    const events = parseMelody(piece[hand]).map((ev) => {
      if (ev.dynamic) vel = DYNAMICS[ev.dynamic] ?? vel;
      const e = { ...ev, hand, time: t, bar: barOf(t), play: ev.beats, vel };
      if (barOf(t + ev.beats - 0.01) !== e.bar) issue({ hand, bar: e.bar, event: e });
      if (prev?.tie && !e.rest && prev.midis.join() === e.midis.join()) {
        e.tiedFrom = prev.tiedFrom ?? prev;
        e.tiedFrom.play += e.beats;
      }
      t += ev.beats;
      prev = e;
      return e;
    });
    hands[hand] = events;
    barCount = Math.max(barCount, events.length ? events[events.length - 1].bar + 1 : 0);
  }

  const byTime = new Map();
  for (const events of Object.values(hands)) {
    for (const e of events) {
      if (e.rest || e.tiedFrom) continue;
      const key = Math.round(e.time * 1000);
      if (!byTime.has(key)) byTime.set(key, { time: e.time, events: [], pass: 1 });
      byTime.get(key).events.push(e);
    }
  }
  let steps = [...byTime.values()].sort((a, b) => a.time - b.time);
  const end = Math.max(...Object.values(hands).map((evs) => evs.reduce((s, e) => s + e.beats, 0)));
  steps.forEach((s, i) => { s.beats = (steps[i + 1]?.time ?? end) - s.time; });

  if (piece.repeat) {
    // Second time through: same notes (and the same SVG elements), later in time.
    const second = steps.map((s) => ({
      ...s,
      time: s.time + end,
      pass: 2,
      events: s.events.map((e) => Object.create(e, { time: { value: e.time + end } })),
    }));
    steps = steps.concat(second);
  }

  return { piece, num, den, barLen, pickup, hands, barCount, steps };
}

let notationLoading = null;
/**
 * Load VexFlow (about 560 KB), which draws the notation. Pages without sheet
 * music never need it, so it's fetched the first time a page with music opens
 * (main.js waits for this before showing such a page). Resolves even if
 * loading fails: renderScore then says so, and the next call tries again.
 */
export function loadNotation() {
  if (window.Vex?.Flow) return Promise.resolve();
  return notationLoading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/vexflow-4.2.5.js', import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); notationLoading = null; resolve(); };
    document.head.append(script);
  });
}

/**
 * Draw the score into `container`. Each non-rest event gets an `el` property
 * pointing at its SVG group so the caller can highlight it.
 */
export function renderScore(container, score, { noteNames = false, showTime = true, fingering = true, center = false } = {}) {
  const VF = window.Vex?.Flow;
  container.innerHTML = '';
  if (!VF) {
    container.textContent = 'Sheet music could not be loaded.';
    return;
  }
  const { piece, hands, barCount } = score;
  const handIds = Object.keys(hands);
  const grand = handIds.length === 2;
  const hasDynamics = Object.values(hands).some((evs) => evs.some((e) => e.dynamic));

  const width = Math.max(260, container.clientWidth);
  const ideal = piece.measureWidth ?? 220;
  const perLine = Math.max(1, Math.min(4, Math.floor((width - 20) / ideal)));
  const lines = Math.ceil(barCount / perLine);
  const staffGap = 110 + (noteNames ? 20 : 0) + (hasDynamics ? 15 : 0);
  const lineHeight = grand ? staffGap + 130 : 140;

  const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  renderer.resize(width, lines * lineHeight + 20);
  const ctx = renderer.getContext();

  const bars = {};
  for (const h of handIds) {
    bars[h] = Array.from({ length: barCount }, () => []);
    for (const e of hands[h]) bars[h][e.bar].push(e);
  }

  for (let bar = 0; bar < barCount; bar++) {
    const line = Math.floor(bar / perLine);
    const col = bar % perLine;
    const firstInLine = col === 0;
    const last = bar === barCount - 1;
    // The first bar of each line also holds the clef/key (and time) signature.
    const lead = 60 + Math.abs(KEY_SIGNATURES[piece.key] ?? 0) * 10 + (line === 0 && showTime ? 25 : 0) + (line === 0 && piece.repeat ? 10 : 0);
    const unit = (width - 20 - lead) / perLine;
    const x = 10 + col * unit + (firstInLine ? 0 : lead);
    const w = unit + (firstInLine ? lead : 0);
    const y = line * lineHeight + 10;

    const staves = handIds.map((h, i) => {
      const stave = new VF.Stave(x, y + i * staffGap, w);
      if (firstInLine) {
        stave.addClef(HANDS[h].clef).addKeySignature(piece.key);
        if (bar === 0 && showTime) stave.addTimeSignature(piece.time);
      }
      if (bar === 0 && piece.repeat) stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
      if (last) stave.setEndBarType(piece.repeat ? VF.Barline.type.REPEAT_END : VF.Barline.type.END);
      return stave;
    });
    const startX = Math.max(...staves.map((s) => s.getNoteStartX()));
    staves.forEach((s) => s.setNoteStartX(startX).setContext(ctx).draw());

    if (grand) {
      const [top, bottom] = staves;
      if (firstInLine) {
        new VF.StaveConnector(top, bottom).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(top, bottom).setType('singleLeft').setContext(ctx).draw();
      }
      new VF.StaveConnector(top, bottom)
        .setType(last ? 'boldDoubleRight' : 'singleRight')
        .setContext(ctx).draw();
    }

    const voices = [];
    const beams = [];
    handIds.forEach((h, i) => {
      const { clef, restKey } = HANDS[h];
      const events = bars[h][bar];
      let notes;
      if (!events.length) {
        notes = [new VF.StaveNote({ clef, keys: [restKey], duration: 'wr', align_center: true })];
      } else {
        notes = events.map((e) => {
          const duration = DURATIONS[e.beats] ?? 'q';
          const note = new VF.StaveNote({
            clef,
            keys: e.rest ? [restKey] : e.names.map(toVexKey),
            duration: duration.replace('d', '') + (e.rest ? 'r' : ''),
            auto_stem: true,
            align_center: center && events.length === 1,
          });
          if (duration.includes('d')) VF.Dot.buildAndAttach([note], { all: true });
          if (fingering && !e.rest) {
            // Right hand fingering above the notes, left hand below.
            e.fingers.forEach((f, k) => {
              if (!f) return;
              note.addModifier(
                new VF.FretHandFinger(f).setPosition(h === 'rh' ? VF.Modifier.Position.ABOVE : VF.Modifier.Position.BELOW),
                k,
              );
            });
          }
          if (noteNames && !e.rest) {
            note.addModifier(
              new VF.Annotation(e.midis.map((m) => noteName(m, { octave: false, flats: /b/.test(e.names[0].slice(1)) })).join(' '))
                .setFont('Arial', 10)
                .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM),
              0,
            );
          }
          if (e.dynamic) {
            note.addModifier(
              new VF.Annotation(e.dynamic)
                .setFont('Times New Roman', 15, 'bold', 'italic')
                .setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM),
              0,
            );
          }
          e.vfNote = note;
          e.line = line;
          return note;
        });
      }
      const voice = new VF.Voice({ num_beats: score.num, beat_value: score.den }).setStrict(false);
      voice.addTickables(notes);
      VF.Accidental.applyAccidentals([voice], piece.key);
      const groups = score.den === 8 ? [new VF.Fraction(3, 8)] : undefined;
      beams.push(...VF.Beam.generateBeams(notes, { beam_rests: false, ...(groups ? { groups } : {}) }));
      voices.push({ voice, stave: staves[i] });
    });

    const formatter = new VF.Formatter();
    voices.forEach(({ voice }) => formatter.joinVoices([voice]));
    formatter.format(voices.map((v) => v.voice), staves[0].getNoteEndX() - startX - 10);
    voices.forEach(({ voice, stave }) => voice.draw(ctx, stave));
    beams.forEach((b) => b.setContext(ctx).draw());
  }

  // Ties. One that wraps onto the next line is drawn as two halves.
  for (const events of Object.values(hands)) {
    events.forEach((e, i) => {
      const next = events[i + 1];
      if (!e.tie || !next?.tiedFrom || !e.vfNote || !next.vfNote) return;
      const indices = e.midis.map((_, k) => k);
      const tie = (first, lastNote) => new VF.StaveTie({
        first_note: first, last_note: lastNote, first_indices: indices, last_indices: indices,
      }).setContext(ctx).draw();
      if (e.line === next.line) tie(e.vfNote, next.vfNote);
      else { tie(e.vfNote, null); tie(null, next.vfNote); }
    });
  }

  for (const events of Object.values(hands)) {
    for (const e of events) {
      e.el = e.vfNote?.getSVGElement() ?? null;
      delete e.vfNote;
    }
  }
}

function toVexKey(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  return `${m[1].toLowerCase()}${m[2]}/${m[3]}`;
}
