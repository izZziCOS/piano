// Progress saved in this browser only. Every access is guarded: storage can be
// unavailable (private windows, blocked site data) and the site must still work.
const KEY = 'piano-practice:v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function get(name, fallback) {
  const v = load()[name];
  return v === undefined ? fallback : v;
}

export function set(name, value) {
  try {
    const all = load();
    all[name] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}
