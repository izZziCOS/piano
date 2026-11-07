// Progress saved in this browser. Every access is guarded: storage can be
// unavailable (private windows, blocked site data) and the site must still work.
// Optional GitHub Gist sync (sync.js) listens for changes and copies progress
// between devices.
const KEY = 'piano-practice:v1';
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function write(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

export function get(name, fallback) {
  const v = load()[name];
  return v === undefined ? fallback : v;
}

export function set(name, value) {
  const all = load();
  all[name] = value;
  write(all);
  listeners.forEach((fn) => fn(name));
}

/** Everything that's stored (a copy). */
export const getAll = () => load();

/** Replace several values at once without notifying change listeners (used by sync). */
export function setMany(values) {
  write({ ...load(), ...values });
}

/** Called with the key name whenever a value is changed with set(). */
export function onChange(fn) { listeners.add(fn); }
