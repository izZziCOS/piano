// Import a (partwise) MusicXML file into the note format of pieces.js, so it
// can be checked and edited before it's saved. Both uncompressed files
// (.musicxml, .xml) and compressed ones (.mxl, a zip) are read.
//
// Piano scores: staff 1 becomes the right hand and staff 2 the left. A score
// with two single-staff parts uses the first part for the right hand and the
// second for the left. Only the first voice of each staff is read. Grace notes
// are skipped, and tuplets are rounded to the nearest sixteenth.
import { KEY_SIGNATURES, NOTE_LENGTHS } from './sheet.js';
import { parseNote } from './notes.js';

const TIMES = ['2/4', '3/4', '4/4', '3/8', '6/8'];
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const LENGTHS = [...NOTE_LENGTHS].sort((a, b) => b - a);
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const txt = (el, sel) => el?.querySelector(sel)?.textContent.trim() ?? null;

/** The text of a MusicXML file the user picked: uncompressed, or a compressed .mxl. */
export async function readMusicXMLFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": a zip, whatever the file is called
  return decodeText(zipped ? await scoreFromMxl(bytes) : bytes);
}

/** XML text from bytes: UTF-8 unless there's a UTF-16 byte-order mark (some editors export UTF-16). */
function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder().decode(bytes);
}

// A compressed MusicXML file is a zip. META-INF/container.xml names the score
// inside it. Only "stored" and "deflate" entries occur in practice; deflate is
// undone with the browser's DecompressionStream, so no zip library is needed.
const NOT_MXL = 'That .mxl file couldn’t be opened. Try exporting uncompressed MusicXML (.musicxml) instead.';

async function scoreFromMxl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true);
  const u32 = (at) => view.getUint32(at, true);

  // The end-of-central-directory record: 22 bytes, then a comment of up to 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error(NOT_MXL);

  // The central directory lists every file: its name, compression, size and where it starts.
  const entries = new Map();
  let p = u32(end + 16);
  for (let n = u16(end + 10); n > 0; n--) {
    if (p + 46 > bytes.length || u32(p) !== 0x02014b50) throw new Error(NOT_MXL);
    const nameLength = u16(p + 28);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { method: u16(p + 10), size: u32(p + 20), offset: u32(p + 42) });
    p += 46 + nameLength + u16(p + 30) + u16(p + 32);
  }

  const read = async (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const at = entry.offset;
    if (at + 30 > bytes.length || u32(at) !== 0x04034b50) throw new Error(NOT_MXL);
    const start = at + 30 + u16(at + 26) + u16(at + 28);
    const data = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error(NOT_MXL);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser can’t open .mxl files. Export uncompressed MusicXML (.musicxml) instead.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    try {
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw new Error(NOT_MXL);
    }
  };

  let path = null;
  const container = await read('META-INF/container.xml');
  if (container) {
    const doc = new DOMParser().parseFromString(decodeText(container), 'application/xml');
    // The first rootfile is the score; others may be extra files such as a PDF of it.
    const root = [...doc.getElementsByTagName('rootfile')]
      .find((r) => !r.getAttribute('media-type') || /musicxml/.test(r.getAttribute('media-type')));
    path = root?.getAttribute('full-path') ?? null;
  }
  // Files without a container: the first XML file that isn't in META-INF.
  path ??= [...entries.keys()].find((n) => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF/'));
  const score = path ? await read(path) : null;
  if (!score) throw new Error('There’s no score in that .mxl file.');
  return score;
}

export function fromMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file isn’t valid MusicXML.');
  const root = doc.documentElement;
  if (root.nodeName === 'score-timewise') throw new Error('Timewise MusicXML isn’t supported. Export the usual (partwise) MusicXML instead.');
  if (root.nodeName !== 'score-partwise') throw new Error('That file isn’t MusicXML.');
  const parts = [...root.children].filter((el) => el.nodeName === 'part');
  if (!parts.length) throw new Error('That MusicXML file has no music in it.');
  const warnings = new Set();

  // ---- Which part and staff each hand comes from.
  const first = parts[0];
  const staves = +(txt(first, 'attributes > staves') ?? 1);
  let sources;
  if (staves >= 2) {
    sources = [{ part: first, staff: '1', hand: 'rh' }, { part: first, staff: '2', hand: 'lh' }];
    if (parts.length > 1) warnings.add('Only the first (piano) part was imported.');
    if (staves > 2) warnings.add('Only the top two staves were imported.');
  } else if (parts.length >= 2) {
    sources = [{ part: parts[0], staff: null, hand: 'rh' }, { part: parts[1], staff: null, hand: 'lh' }];
    if (parts.length > 2) warnings.add('Only the first two parts were imported.');
  } else {
    sources = [{ part: first, staff: null, hand: txt(first, 'attributes > clef > sign') === 'F' ? 'lh' : 'rh' }];
  }

  // ---- Key, time and tempo (from the start of the piece).
  const fifths = +(txt(first, 'attributes > key > fifths') ?? 0);
  const minor = txt(first, 'attributes > key > mode') === 'minor';
  const key = Object.keys(KEY_SIGNATURES).find((k) => KEY_SIGNATURES[k] === fifths && k.endsWith('m') === minor) ?? 'C';
  const beats = txt(first, 'attributes > time > beats') ?? '4';
  const beatType = txt(first, 'attributes > time > beat-type') ?? '4';
  const time = `${beats}/${beatType}`;
  if (!TIMES.includes(time)) throw new Error(`The piece is in ${time} time. Only ${TIMES.join(', ')} are supported.`);
  if (first.querySelectorAll('attributes > time').length > 1) warnings.add('Time signature changes were ignored.');
  if (first.querySelectorAll('attributes > key').length > 1) warnings.add('Key changes were ignored.');
  const barLen = (+beats * 4) / +beatType;
  const tempo = +(first.querySelector('sound[tempo]')?.getAttribute('tempo') ?? txt(first, 'metronome > per-minute') ?? 90);
  const bpm = Math.max(40, Math.min(160, Math.round(tempo) || 90));
  if (root.querySelector('barline > repeat, barline > ending')) warnings.add('Repeat signs were left out; the music is played once.');

  // ---- Read each hand, bar by bar.
  const hands = sources.map((src) => ({ ...src, bars: readPart(src, warnings) }));
  const measures = Math.max(...hands.map((h) => h.bars.length));
  const implicit = first.querySelector('measure')?.getAttribute('implicit') === 'yes';
  const pickupLen = implicit ? Math.max(...hands.map((h) => sum(h.bars[0] ?? []))) : 0;
  const pickup = pickupLen > 0 && pickupLen < barLen ? pickupLen : 0;

  const out = { title: txt(root, 'work > work-title') || txt(root, 'movement-title') || 'Imported piece' };
  out.composer = txt(root, 'identification > creator[type="composer"]') ?? '';
  Object.assign(out, { key, time, bpm, pickup, rh: '', lh: '' });

  for (const h of hands) {
    const bars = [];
    for (let i = 0; i < measures; i++) {
      const events = h.bars[i] ?? [];
      const want = i === 0 && pickup ? pickup : barLen;
      const have = sum(events);
      if (have > want + 1e-6) warnings.add(`Bar ${i + 1} is longer than the time signature allows; check it.`);
      if (have < want - 1e-6) events.push({ rest: true, beats: want - have });
      bars.push(events.flatMap(toTokens).join(' '));
    }
    if (h.bars.flat().some((e) => !e.rest)) out[h.hand] = bars.join(' | ');
  }
  if (!out.rh && !out.lh) throw new Error('No notes were found in that file.');
  out.warnings = [...warnings];
  return out;
}

const sum = (events) => events.reduce((s, e) => s + e.beats, 0);

/** One part (or one staff of it) as a list of bars of events. */
function readPart({ part, staff }, warnings) {
  let divisions = 1;
  let voice = null;
  const bars = [];
  for (const measure of part.querySelectorAll(':scope > measure')) {
    const events = [];
    let dynamic = null;
    let last = null;
    for (const el of measure.children) {
      if (el.nodeName === 'attributes') {
        divisions = +(txt(el, 'divisions') ?? divisions);
        continue;
      }
      if (el.nodeName === 'direction') {
        if (staff && (txt(el, 'staff') ?? '1') !== staff) continue;
        const d = el.querySelector('dynamics > *')?.nodeName;
        if (DYNAMICS.includes(d)) dynamic = d;
        continue;
      }
      if (el.nodeName !== 'note') continue;
      if (el.querySelector('grace, cue')) { warnings.add('Grace notes were left out.'); continue; }
      if (staff && (txt(el, 'staff') ?? '1') !== staff) continue;
      const v = txt(el, 'voice') ?? '1';
      voice ??= v;
      if (v !== voice) { warnings.add('Only the first voice of each staff was imported.'); continue; }

      const rest = el.querySelector('rest');
      const tie = !!el.querySelector('tie[type="start"], notations > tied[type="start"]');
      const finger = txt(el, 'notations > technical > fingering') ?? '';
      if (rest) {
        if (el.querySelector('chord')) continue;
        events.push(last = { rest: true, beats: +txt(el, 'duration') / divisions });
        continue;
      }
      const step = txt(el, 'pitch > step');
      const alter = Math.round(+(txt(el, 'pitch > alter') ?? 0));
      const octave = txt(el, 'pitch > octave');
      if (!step || octave === null) continue; // unpitched
      let name = `${step}${alter === 1 ? '#' : alter === -1 ? 'b' : ''}${octave}`;
      if (Math.abs(alter) > 1) {
        // Double sharps/flats aren't in the note format: use the plain key.
        const midi = parseNote(`${step}${octave}`) + alter;
        name = `${SHARP[midi % 12]}${Math.floor(midi / 12) - 1}`;
        warnings.add('Double sharps and flats were respelled.');
      }
      const finger1 = /^[1-5]$/.test(finger) ? finger : '';
      if (el.querySelector('chord') && last && !last.rest) {
        last.notes.push({ name, finger: finger1 });
        last.tie ||= tie;
        continue;
      }
      events.push(last = { notes: [{ name, finger: finger1 }], beats: +txt(el, 'duration') / divisions, tie, dynamic });
      dynamic = null;
    }
    for (const e of events) {
      const rounded = Math.round(e.beats * 4) / 4;
      if (Math.abs(rounded - e.beats) > 1e-3) warnings.add('Triplets and other tuplets were rounded; check the rhythm.');
      e.beats = rounded;
    }
    bars.push(events.filter((e) => e.beats > 0));
  }
  return bars;
}

/** Split a length into drawable note lengths: 2.5 → [2, 0.5]. */
function split(beats) {
  const parts = [];
  let left = beats;
  for (const n of LENGTHS) while (left >= n - 1e-6) { parts.push(n); left -= n; }
  return parts;
}

function toTokens(e) {
  const parts = split(e.beats);
  const len = (b) => (b === 1 ? '' : `:${b}`);
  if (e.rest) return parts.map((b) => `R${len(b)}`);
  const notes = [...e.notes].sort((a, b) => parseNote(a.name) - parseNote(b.name));
  const names = notes.map((n) => n.name).join('+');
  const fingers = notes.some((n) => n.finger) ? `@${notes.map((n) => n.finger).join('+')}` : '';
  return parts.map((b, i) => {
    const tied = i < parts.length - 1 || e.tie;
    return `${i === 0 && e.dynamic ? `!${e.dynamic} ` : ''}${names}${i === 0 ? fingers : ''}${len(b)}${tied ? '~' : ''}`;
  });
}
