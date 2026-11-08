// Your own pieces: written in the same note format as pieces.js, or imported
// from a MusicXML file. They are kept in storage under `ownPieces` (synced
// between devices like the rest of your progress). A deleted piece stays as a
// small tombstone { id, deleted, updatedAt } so a sync doesn't bring it back.
import * as store from './storage.js';
import { buildScore, renderScore, KEY_SIGNATURES, NOTE_LENGTHS } from './sheet.js';
import { parseNote } from './notes.js';
import { fromMusicXML } from './musicxml.js';

const $ = (id) => document.getElementById(id);
const KEY = 'ownPieces';
export const LEVEL = 'Your pieces';
const TIMES = ['2/4', '3/4', '4/4', '3/8', '6/8'];
const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const NOTE = '[A-G][#b]?\\d';
const TOKEN = new RegExp(`^(R|${NOTE}(?:\\+${NOTE})*)(@[1-5]?(?:\\+[1-5]?)*)?(?::(\\d*\\.?\\d+))?(~)?$`);
const HAND_NAME = { rh: 'Right hand', lh: 'Left hand' };

// ------------------------------------------------------------ storage

const records = () => store.get(KEY, []);

/** Your pieces, ready to use like an entry of PIECES. */
export function list() {
  return records().filter((p) => !p.deleted).map((p) => ({ ...p, level: LEVEL, own: true }));
}

export function save(piece) {
  const id = piece.id ?? `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clean = {
    id,
    title: piece.title.trim(),
    composer: piece.composer?.trim() || 'Your piece',
    key: piece.key,
    time: piece.time,
    bpm: piece.bpm,
    ...(piece.pickup ? { pickup: piece.pickup } : {}),
    ...(piece.repeat ? { repeat: true } : {}),
    ...(piece.rh?.trim() ? { rh: piece.rh.trim() } : {}),
    ...(piece.lh?.trim() ? { lh: piece.lh.trim() } : {}),
    updatedAt: Date.now(),
  };
  store.set(KEY, [...records().filter((p) => p.id !== id), clean]);
  return id;
}

export function remove(id) {
  store.set(KEY, [...records().filter((p) => p.id !== id), { id, deleted: true, updatedAt: Date.now() }]);
}

/** Combine two devices' lists: for each piece, the newest edit (or deletion) wins. */
export function mergeLists(a = [], b = []) {
  const byId = new Map();
  for (const p of [...a, ...b]) {
    const have = byId.get(p.id);
    if (!have || (p.updatedAt ?? 0) > (have.updatedAt ?? 0)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((p, q) => (p.updatedAt ?? 0) - (q.updatedAt ?? 0));
}

// ------------------------------------------------------------ checking

function checkHand(text, hand) {
  const errors = [];
  const where = HAND_NAME[hand];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    if (tok.startsWith('!')) {
      if (!DYNAMICS.includes(tok.slice(1))) errors.push(`${where}: “${tok}” isn’t a dynamic. Use !pp, !p, !mp, !mf, !f or !ff.`);
      continue;
    }
    const m = TOKEN.exec(tok);
    if (!m) {
      const hint = /[a-g]\d/.test(tok) && !/[A-G]/.test(tok[0]) ? ' Write note letters as capitals: C4, not c4.'
        : /[♯♭]/.test(tok) ? ' Write sharps as # and flats as b: F#4, Bb3.'
          : ' Write a note as a letter and octave (C4, F#4, Bb3), a rest as R, and add :beats for the length.';
      errors.push(`${where}: “${tok}” isn’t a note I can read.${hint}`);
      continue;
    }
    if (m[3] !== undefined && !NOTE_LENGTHS.includes(parseFloat(m[3]))) {
      errors.push(`${where}: “${tok}” is ${m[3]} beats long. Use 4, 3, 2, 1.5, 1, 0.75, 0.5 or 0.25, and tie notes (~) for other lengths.`);
    }
    if (m[1] !== 'R') {
      for (const name of m[1].split('+')) {
        const midi = parseNote(name);
        if (midi < 21 || midi > 108) errors.push(`${where}: ${name} is off the piano (A0 to C8).`);
      }
    }
  }
  return errors;
}

/** Everything wrong with a piece, as sentences. An empty list means it's fine. */
export function check(piece) {
  const errors = [];
  if (!piece.title?.trim()) errors.push('Give the piece a title.');
  if (!piece.rh?.trim() && !piece.lh?.trim()) errors.push('Write the notes for at least one hand.');
  if (!(piece.key in KEY_SIGNATURES)) errors.push('Choose a key.');
  if (!TIMES.includes(piece.time)) errors.push('Choose a time signature.');
  if (!(piece.bpm >= 40 && piece.bpm <= 160)) errors.push('The tempo must be between 40 and 160 bpm.');
  const [num, den] = (piece.time ?? '4/4').split('/').map(Number);
  const barLen = (num * 4) / den;
  if (piece.pickup && !(piece.pickup > 0 && piece.pickup < barLen && Number.isInteger(piece.pickup * 4))) {
    errors.push(`The pickup must be shorter than a bar (${barLen} beats), in quarter beats (0.25, 0.5, 1…).`);
  }
  for (const hand of ['rh', 'lh']) if (piece[hand]?.trim()) errors.push(...checkHand(piece[hand], hand));
  if (errors.length) return errors;

  // The notes read fine. Do any of them run past a bar line?
  const seen = new Set();
  buildScore({ id: 'check', ...piece }, {
    onIssue: ({ hand, bar, event }) => {
      const barNo = piece.pickup ? bar : bar + 1;
      const k = `${hand}${barNo}`;
      if (seen.has(k)) return;
      seen.add(k);
      const what = event.rest ? 'A rest' : event.names.join('+');
      errors.push(`${HAND_NAME[hand]}, ${piece.pickup && !bar ? 'pickup bar' : `bar ${barNo}`}: ${what} (${event.beats} beats) runs past the bar line. Split it into two notes joined with a tie, for example C4:1~ C4:1.`);
    },
  });
  return errors;
}

// ------------------------------------------------------------ editor

let onSavedFn = null;
let editingId = null;
let previewTimer = 0;

const KEY_OPTIONS = (() => {
  const label = (k) => {
    const minor = k.endsWith('m');
    const root = (minor ? k.slice(0, -1) : k).replace('#', '♯').replace(/(?<=[A-G])b/, '♭');
    const n = KEY_SIGNATURES[k];
    return `${root} ${minor ? 'minor' : 'major'}${n ? ` (${Math.abs(n)}${n > 0 ? '♯' : '♭'})` : ''}`;
  };
  const keys = Object.keys(KEY_SIGNATURES).sort((a, b) => KEY_SIGNATURES[a] - KEY_SIGNATURES[b]);
  const group = (name, minor) => `<optgroup label="${name}">${keys.filter((k) => k.endsWith('m') === minor)
    .map((k) => `<option value="${k}">${label(k)}</option>`).join('')}</optgroup>`;
  return group('Major', false) + group('Minor', true);
})();

function readForm() {
  return {
    id: editingId ?? undefined,
    title: $('own-title').value,
    composer: $('own-composer').value,
    key: $('own-key').value,
    time: $('own-time').value,
    bpm: Math.round(+$('own-bpm').value),
    pickup: +$('own-pickup').value || 0,
    repeat: $('own-repeat').checked,
    rh: $('own-rh').value,
    lh: $('own-lh').value,
  };
}

function fillForm(p) {
  $('own-title').value = p.title ?? '';
  $('own-composer').value = p.composer && p.composer !== 'Your piece' ? p.composer : '';
  $('own-key').value = p.key ?? 'C';
  $('own-time').value = p.time ?? '4/4';
  $('own-bpm').value = p.bpm ?? 90;
  $('own-pickup').value = p.pickup ?? 0;
  $('own-repeat').checked = !!p.repeat;
  $('own-rh').value = p.rh ?? '';
  $('own-lh').value = p.lh ?? '';
}

/** Check the form and draw a preview. Returns the problems found. */
function preview() {
  const piece = readForm();
  // While the title is still empty, don't complain about it yet.
  const errors = check({ ...piece, title: piece.title || 'Untitled' });
  const box = $('own-preview');
  $('own-errors').innerHTML = errors.slice(0, 6).map((e) => `<span>${escape(e)}</span>`).join('')
    + (errors.length > 6 ? `<span>…and ${errors.length - 6} more.</span>` : '');
  if (errors.length || (!piece.rh.trim() && !piece.lh.trim())) {
    box.innerHTML = `<p class="empty-state">${errors.length ? 'Fix the notes above to see the music.' : 'The music appears here as you type.'}</p>`;
    return errors;
  }
  renderScore(box, buildScore({ id: 'preview', ...piece }));
  return errors;
}

const escape = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function init({ onSaved }) {
  onSavedFn = onSaved;
  $('own-key').innerHTML = KEY_OPTIONS;
  const form = $('own-form');
  form.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 250);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(previewTimer);
    const piece = readForm();
    const errors = check(piece);
    if (errors.length) {
      preview();
      if (!piece.title.trim()) $('own-errors').insertAdjacentHTML('afterbegin', '<span>Give the piece a title.</span>');
      $('own-errors').scrollIntoView({ block: 'nearest' });
      return;
    }
    const id = save(piece);
    $('own-dialog').close();
    onSavedFn?.(id);
  });
  $('own-cancel').addEventListener('click', () => $('own-dialog').close());
  $('own-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('own-import-status');
    try {
      if (/\.mxl$/i.test(file.name)) throw new Error('That’s a compressed .mxl file. Export it as uncompressed MusicXML (.musicxml or .xml) and try again.');
      const piece = fromMusicXML(await file.text());
      fillForm({ ...readForm(), ...piece, id: undefined });
      const notes = piece.warnings.length ? ` ${piece.warnings.join(' ')}` : '';
      status.textContent = `Imported “${piece.title}”. Check the notes below before saving.${notes}`;
      status.dataset.tone = piece.warnings.length ? '' : 'good';
    } catch (err) {
      status.textContent = err.message;
      status.dataset.tone = 'bad';
    }
    preview();
  });
}

/** Open the editor, empty or with one of your pieces. */
export function open(piece = null) {
  editingId = piece?.id ?? null;
  fillForm(piece ?? {});
  $('own-heading').textContent = piece ? 'Edit your piece' : 'Add your own piece';
  $('own-save').textContent = piece ? 'Save changes' : 'Save piece';
  $('own-import-status').textContent = '';
  $('own-dialog').showModal();
  preview();
  $('own-title').focus();
}
