// Progress saved in this browser. Every access is guarded: storage can be
// unavailable (private windows, blocked site data) and the site must still work.
// Optional GitHub Gist sync (sync.js) listens for changes and copies progress
// between devices.
//
// Everything is read from localStorage once and kept in memory, so reading is
// cheap. Values are handed out as copies: changing one doesn't change what's
// stored until it's set(). Before writing, the stored text is compared with
// what was last seen; if another tab saved in between, its changes are read
// first so they aren't overwritten. (The 'storage' event also tells this tab
// when another one saves.)
const KEY = 'piano-practice:v1';
const listeners = new Set();
let memory = null;
let seen = null; // the stored text that `memory` was read from or written as

function readText() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function parse(text) {
  let v;
  try { v = JSON.parse(text); } catch { v = null; }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function load() {
  if (!memory) {
    seen = readText();
    memory = parse(seen);
  }
  return memory;
}

/** The latest stored state, for changing and writing back. */
function fresh() {
  const text = readText();
  if (!memory || text !== seen) {
    seen = text;
    memory = parse(text);
  }
  return memory;
}

function write(all) {
  memory = all;
  const text = JSON.stringify(all);
  try {
    localStorage.setItem(KEY, text);
    seen = text;
  } catch { /* full or blocked: kept in memory for this visit */ }
}

const copy = (v) => (v && typeof v === 'object' ? structuredClone(v) : v);

window.addEventListener('storage', (e) => {
  if (e.key === KEY || e.key === null) memory = null;
});

export function get(name, fallback) {
  const v = load()[name];
  return v === undefined ? fallback : copy(v);
}

export function set(name, value) {
  const all = fresh();
  all[name] = copy(value);
  write(all);
  listeners.forEach((fn) => fn(name));
}

/** Everything that's stored (a copy). */
export const getAll = () => copy(load());

/** Replace several values at once without notifying change listeners (used by sync). */
export function setMany(values) {
  write({ ...fresh(), ...copy(values) });
}

/** Called with the key name whenever a value is changed with set(). */
export function onChange(fn) { listeners.add(fn); }
