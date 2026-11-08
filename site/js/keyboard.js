// On-screen piano keyboard. Emits 'noteon' / 'noteoff' for every input source.
//
// For keyboard and screen-reader users the piano is one stop in the Tab order
// (a "roving tabindex"): the arrow keys move between keys (left/right by a
// semitone, up/down by an octave, Home/End to the ends) and Enter or Space
// plays the focused key for as long as it's held. Each key is a button named
// by its note, e.g. "C4" or "C sharp 4 / D flat 4".
import { isBlack, noteName } from './notes.js';
import * as audio from './audio.js';

// Computer keys, layout-independent (KeyboardEvent.code), starting at the base note.
export const KEY_CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY',
  'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
const KEY_LABELS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'];
/** A key's name as a screen reader should say it: "C sharp 4 / D flat 4". */
const spoken = (name) => name.replace('♯', ' sharp ').replace('♭', ' flat ');
const keyName = (m) => (isBlack(m) ? `${spoken(noteName(m))} / ${spoken(noteName(m, { flats: true }))}` : noteName(m));

/** "F#5" → "F♯", "Bb4" → "B♭": the letter and accidental, no octave. */
const playedName = (n) => (n.name ? n.name.replace(/-?\d+$/, '').replace('#', '♯').replace(/(?<=[A-G])b/, '♭')
  : noteName(n.midi, { octave: false }));

export class Keyboard {
  constructor(el) {
    this.el = el;
    this.keys = new Map(); // midi -> element
    this.pointers = new Map(); // pointerId -> midi
    this.held = new Map(); // midi -> number of sources holding it
    this.listeners = { noteon: new Set(), noteoff: new Set() };
    this.base = 60;
    this.low = 21; // A0
    this.high = 108; // C8 — a full 88-key piano
    this.focusMidi = 60; // the key that Tab lands on
    this.keyHeld = null; // the key held down with Enter or Space
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Piano. Arrow keys choose a key, Enter or Space plays it.');
    this.bindPointer();
    this.bindKeys();
  }

  on(type, fn) { this.listeners[type].add(fn); }

  setRange(low, high) {
    if (low === this.low && high === this.high && this.keys.size) return;
    this.low = low;
    this.high = high;
    this.build();
  }

  build() {
    const saved = [...this.keys].map(([m, el]) => [m, el.className]);
    this.el.innerHTML = '';
    this.keys.clear();
    const whites = [];
    for (let m = this.low; m <= this.high; m++) if (!isBlack(m)) whites.push(m);
    const n = whites.length;
    this.el.style.setProperty('--whites', n);

    let whiteIndex = 0;
    for (let m = this.low; m <= this.high; m++) {
      const key = document.createElement('div');
      key.dataset.midi = m;
      key.setAttribute('role', 'button');
      key.setAttribute('aria-label', keyName(m));
      key.tabIndex = m === this.focusMidi ? 0 : -1;
      key.innerHTML = `<span class="label-key"></span><span class="label-note">${noteName(m, { octave: m % 12 === 0 })}</span>`
        + '<span class="label-played" aria-hidden="true"></span>';
      if (isBlack(m)) {
        key.className = 'key black';
        key.style.left = `calc(${(whiteIndex / n) * 100}% - var(--black-w) / 2)`;
      } else {
        key.className = 'key white' + (m === 60 ? ' middle-c' : '');
        whiteIndex++;
      }
      this.el.appendChild(key);
      this.keys.set(m, key);
    }
    for (const [m, cls] of saved) this.keys.get(m)?.setAttribute('class', cls);
    this.updateKeyLabels();
  }

  setBase(base) {
    this.base = base;
    this.updateKeyLabels();
  }

  updateKeyLabels() {
    for (const [m, el] of this.keys) {
      const i = m - this.base;
      el.querySelector('.label-key').textContent = i >= 0 && i < KEY_LABELS.length ? KEY_LABELS[i] : '';
    }
  }

  codeToMidi(code) {
    const i = KEY_CODES.indexOf(code);
    return i < 0 ? null : this.base + i;
  }

  press(midi, velocity = 0.8) {
    const count = this.held.get(midi) ?? 0;
    this.held.set(midi, count + 1);
    audio.noteOn(midi, velocity);
    this.keys.get(midi)?.classList.add('pressed');
    this.listeners.noteon.forEach((fn) => fn(midi));
  }

  release(midi) {
    const count = (this.held.get(midi) ?? 0) - 1;
    if (count > 0) { this.held.set(midi, count); return; }
    this.held.delete(midi);
    audio.noteOff(midi);
    this.keys.get(midi)?.classList.remove('pressed');
    this.listeners.noteoff.forEach((fn) => fn(midi));
  }

  bindPointer() {
    const keyFrom = (e) => e.target.closest?.('.key');
    const move = (id, midi) => {
      const prev = this.pointers.get(id);
      if (prev === midi) return;
      if (prev != null) this.release(prev);
      this.pointers.set(id, midi);
      this.press(midi);
    };
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.release(this.pointers.get(e.pointerId));
      this.pointers.delete(e.pointerId);
    };

    this.el.addEventListener('pointerdown', (e) => {
      const key = keyFrom(e);
      if (!key || e.button > 0) return;
      e.preventDefault();
      // Release implicit touch capture so dragging across keys fires pointerover.
      if (key.hasPointerCapture?.(e.pointerId)) key.releasePointerCapture(e.pointerId);
      move(e.pointerId, +key.dataset.midi);
      // Tab comes back to the last key played.
      this.keys.get(this.focusMidi)?.setAttribute('tabindex', '-1');
      this.focusMidi = +key.dataset.midi;
      key.tabIndex = 0;
    });
    this.el.addEventListener('pointerover', (e) => {
      const key = keyFrom(e);
      if (key && this.pointers.has(e.pointerId)) move(e.pointerId, +key.dataset.midi);
    });
    this.el.addEventListener('pointerleave', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); }; // not the page's Space-for-pedal shortcut
    this.el.addEventListener('keydown', (e) => {
      const key = e.target.closest?.('.key');
      if (!key || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = +key.dataset.midi;
      const to = { ArrowRight: m + 1, ArrowLeft: m - 1, ArrowUp: m + 12, ArrowDown: m - 12, Home: this.low, End: this.high }[e.key];
      if (to !== undefined) {
        stop(e);
        this.focusKey(Math.max(this.low, Math.min(this.high, to)));
      } else if (e.key === 'Enter' || e.key === ' ') {
        stop(e);
        if (!e.repeat && this.keyHeld === null) {
          this.keyHeld = m;
          this.press(m);
        }
      }
    });
    const letGo = () => {
      if (this.keyHeld === null) return;
      this.release(this.keyHeld);
      this.keyHeld = null;
    };
    this.el.addEventListener('keyup', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && this.keyHeld !== null) { stop(e); letGo(); }
    });
    this.el.addEventListener('focusout', letGo);
  }

  /** Move keyboard focus (and the Tab stop) to a key. */
  focusKey(midi) {
    const el = this.keys.get(midi);
    if (!el) return;
    this.keys.get(this.focusMidi)?.setAttribute('tabindex', '-1');
    this.focusMidi = midi;
    el.tabIndex = 0;
    el.focus({ preventScroll: true });
    this.reveal(midi);
  }

  /** Persistent highlight (e.g. 'target', 'scale', 'root'). */
  mark(midis, cls) {
    for (const m of [].concat(midis)) this.keys.get(m)?.classList.add(cls);
  }

  clear(cls) {
    for (const el of this.keys.values()) el.classList.remove(cls);
  }

  /**
   * Scroll the keyboard (it is wider than the screen on most devices) so the
   * given notes are visible. Does nothing if they already are.
   */
  reveal(midis, { center = false, smooth = true } = {}) {
    const scroller = this.el.parentElement;
    const els = [].concat(midis).map((m) => this.keys.get(m)).filter(Boolean);
    if (!els.length || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = Math.min(...els.map((e) => e.offsetLeft));
    const right = Math.max(...els.map((e) => e.offsetLeft + e.offsetWidth));
    const view = scroller.scrollLeft;
    const pad = 40;
    if (!center && left >= view + pad && right <= view + scroller.clientWidth - pad) return;
    scroller.scrollTo({
      left: (left + right) / 2 - scroller.clientWidth / 2,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  /**
   * Light up the keys of notes being played back (Listen buttons): each key
   * stays lit for as long as its note sounds, showing the note's name. `notes`
   * are [{ midi, beats, name }], where `name` is how the music spells it
   * ("Bb4", "F♯"; the key's own name if left out). `spb` is seconds per beat.
   */
  showPlayed(notes, spb) {
    if (!notes.length) return;
    for (const n of notes) {
      const label = this.keys.get(n.midi)?.querySelector('.label-played');
      if (label) label.textContent = playedName(n);
    }
    // A little shorter than the note, so a repeated key visibly lets go in between.
    for (const n of notes) this.flash(n.midi, 'demo', Math.max(n.beats * spb * 1000 * 0.95 - 40, 120));
    this.reveal(notes.map((n) => n.midi));
  }

  /** Brief highlight (e.g. 'correct', 'wrong', 'demo'). */
  flash(midi, cls, ms = 400) {
    const el = this.keys.get(midi);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart CSS animation
    el.classList.add(cls);
    clearTimeout(el[`_t_${cls}`]);
    el[`_t_${cls}`] = setTimeout(() => el.classList.remove(cls), ms);
  }
}
