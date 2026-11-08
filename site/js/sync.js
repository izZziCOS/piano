// Optional progress sync through a private (secret) GitHub Gist.
//
// You paste a GitHub token that can only access gists. The site keeps one gist
// with a single file, piano-practice.json, and every device merges its own
// progress with it, so nothing is lost when two devices practise in between
// syncs: counts take the larger value, lists are combined.
//
// The token and the gist id are kept in this browser only, under their own
// storage key, and are never part of the synced file.
import * as store from './storage.js';
import * as stats from './stats.js';
import { mergeLists } from './ownpieces.js';

const API = 'https://api.github.com';
const FILE = 'piano-practice.json';
const STATE_KEY = 'piano-practice:sync';
const PUSH_DELAY = 15000; // batch changes: at most one sync every 15 s while practising
const STALE = 30000; // pull again when coming back to the tab after this long

// Stored keys that are progress (synced). Everything else (volume, octave,
// last piece, menu choices) is a per-device setting and stays local.
const MAX_KEYS = ['quizBestStreak'];
const isMaxKey = (k) => MAX_KEYS.includes(k) || k.startsWith('earBest:');
const MAP_MAX_KEYS = ['practiceLog', 'pieces', 'piecesNamed', 'piecesTempo', 'bestSpeed'];
const SYNCED = (k) => isMaxKey(k) || MAP_MAX_KEYS.includes(k)
  || ['noteStats', 'noteStatsResetAt', 'speedHistory', 'learnDone', 'dailyGoal', 'dailyGoalAt', 'ownPieces'].includes(k);

// ------------------------------------------------------------ state

function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
}
let state = loadState(); // { token, login, gistId, lastSync }
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

let busy = null; // the running sync, if any
let again = false; // another change arrived while syncing
let timer = 0;
let status = { tone: '', text: '' };
const listeners = new Set();

/** Called with { connected, login, gistId, lastSync, busy, tone, text, updated } on every change. */
export function onStatus(fn) { listeners.add(fn); fn(info()); }
export const isConnected = () => Boolean(state.token && state.gistId);
const info = (extra = {}) => ({
  connected: isConnected(), login: state.login, gistId: state.gistId, lastSync: state.lastSync,
  busy: Boolean(busy), ...status, ...extra,
});
function setStatus(tone, text, extra) {
  status = { tone, text };
  listeners.forEach((fn) => fn(info(extra)));
}

// ------------------------------------------------------------ merging

/** Only the synced part of everything that's stored. */
export function progressOf(all) {
  return Object.fromEntries(Object.entries(all).filter(([k]) => SYNCED(k)));
}

/** Combine two progress snapshots. Never loses practice from either side. */
export function merge(a = {}, b = {}) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(SYNCED));
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) { out[k] = y; continue; }
    if (y === undefined) { out[k] = x; continue; }
    if (isMaxKey(k) || k === 'noteStatsResetAt') out[k] = Math.max(x, y);
    else if (MAP_MAX_KEYS.includes(k)) {
      out[k] = { ...x };
      for (const [n, v] of Object.entries(y)) out[k][n] = Math.max(out[k][n] ?? 0, v);
    } else if (k === 'learnDone') out[k] = [...new Set([...x, ...y])].sort((p, q) => p - q);
    else if (k === 'speedHistory') {
      const byTime = new Map([...x, ...y].map((h) => [h.at, h]));
      out[k] = [...byTime.values()].sort((p, q) => p.at - q.at).slice(-200);
    } else if (k === 'ownPieces') {
      out[k] = mergeLists(x, y); // per piece, the newest edit or deletion wins
    } else if (k === 'noteStats') {
      // Per note, keep the record that has seen more answers (it includes the other's history).
      out[k] = { ...x };
      for (const [n, s] of Object.entries(y)) {
        const mine = out[k][n];
        if (!mine || s.seen > mine.seen || (s.seen === mine.seen && s.last > mine.last)) out[k][n] = s;
      }
    }
  }
  // The newest goal choice wins.
  if (a.dailyGoal !== undefined && b.dailyGoal !== undefined) {
    out.dailyGoal = (b.dailyGoalAt ?? 0) > (a.dailyGoalAt ?? 0) ? b.dailyGoal : a.dailyGoal;
    out.dailyGoalAt = Math.max(a.dailyGoalAt ?? 0, b.dailyGoalAt ?? 0) || undefined;
  }
  // A reset on any device clears the notes practised before it, everywhere.
  if (out.noteStats && out.noteStatsResetAt) {
    out.noteStats = Object.fromEntries(Object.entries(out.noteStats).filter(([, s]) => s.last > out.noteStatsResetAt));
  }
  return out;
}

const same = (p, q) => JSON.stringify(sortKeys(p)) === JSON.stringify(sortKeys(q));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])]));
  return v;
}

// ------------------------------------------------------------ GitHub API

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, token = state.token, keepalive = false } = {}) {
  let res;
  const payload = body ? JSON.stringify(body) : undefined;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      // keepalive lets a request finish after the page closes, but browsers cap its size at 64 KB.
      keepalive: keepalive && (payload?.length ?? 0) < 60000,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach GitHub. Check your connection; progress is still saved on this device.');
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  const messages = {
    401: 'GitHub didn’t accept the token. It may have expired or been revoked.',
    403: 'The token isn’t allowed to use gists, or GitHub is rate-limiting. Create a token with the “gist” permission.',
    404: 'Not found on GitHub. Check that the token has the “gist” permission.',
  };
  throw new ApiError(res.status, messages[res.status] ?? `GitHub returned an error (${res.status}).`);
}

const fileBody = (progress) => ({
  description: 'Piano Practice progress (synced by the Piano Practice website)',
  files: { [FILE]: { content: JSON.stringify({ app: 'piano-practice', version: 1, savedAt: new Date().toISOString(), progress }, null, 1) } },
});

async function readGist(gist) {
  const file = gist.files?.[FILE];
  if (!file) return {};
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  try { return JSON.parse(content).progress ?? {}; } catch { return {}; }
}

// ------------------------------------------------------------ public actions

/** Check the token, then find the existing progress gist or create one. */
export async function connect(token) {
  token = token.trim();
  if (!token) throw new Error('Paste a GitHub token first.');
  setStatus('', 'Connecting to GitHub…');
  try {
    const user = await api('/user', { token });
    let gistId = null;
    for (let page = 1; page <= 5 && !gistId; page++) {
      const list = await api(`/gists?per_page=100&page=${page}`, { token });
      gistId = list.find((g) => g.files?.[FILE])?.id ?? null;
      if (list.length < 100) break;
    }
    state = { token, login: user.login, gistId, lastSync: 0 };
    if (!gistId) {
      const gist = await api('/gists', { method: 'POST', token, body: { ...fileBody(progressOf(store.getAll())), public: false } });
      state.gistId = gist.id;
      state.lastSync = Date.now();
      saveState();
      setStatus('good', 'Connected. Your progress is now saved to a new secret gist.');
      return;
    }
    saveState();
    await syncNow();
  } catch (e) {
    setStatus('bad', e.message);
    throw e;
  }
}

/** Forget the token on this device. The gist stays on GitHub. */
export function disconnect() {
  clearTimeout(timer);
  state = {};
  saveState();
  setStatus('', 'Disconnected. Progress stays on this device; the gist is still on GitHub.');
}

/**
 * Pull, merge, and push if anything changed. Safe to call at any time.
 * `keepalive` lets the final upload finish even if the page is closing.
 */
export function syncNow({ keepalive = false } = {}) {
  if (!isConnected()) return Promise.resolve();
  if (busy) { again = true; return busy; }
  clearTimeout(timer);
  timer = 0;
  setStatus('', 'Syncing…');
  busy = (async () => {
    let updated = false;
    try {
      let remote;
      try {
        remote = await readGist(await api(`/gists/${state.gistId}`));
      } catch (e) {
        if (e.status !== 404) throw e;
        // The gist was deleted on GitHub: start a new one.
        const gist = await api('/gists', { method: 'POST', body: { ...fileBody(progressOf(store.getAll())), public: false } });
        state.gistId = gist.id;
        remote = null;
      }
      const local = progressOf(store.getAll());
      const merged = remote ? merge(local, remote) : local;
      if (!same(merged, local)) {
        store.setMany(merged);
        stats.reload();
        updated = true;
      }
      if (remote && !same(merged, remote)) await api(`/gists/${state.gistId}`, { method: 'PATCH', body: fileBody(merged), keepalive });
      state.lastSync = Date.now();
      saveState();
      status = { tone: 'good', text: updated ? 'Synced. Progress from your other devices was added.' : 'Synced.' };
    } catch (e) {
      status = { tone: 'bad', text: e.message };
      if (e.status === 401) { state.token = null; saveState(); }
    } finally {
      busy = null;
      listeners.forEach((fn) => fn(info({ updated })));
      if (again) { again = false; schedule(); }
    }
  })();
  return busy;
}

function schedule(delay = PUSH_DELAY) {
  if (!isConnected() || timer) return;
  timer = setTimeout(() => { timer = 0; syncNow(); }, delay);
}

export function init() {
  store.onChange((key) => { if (SYNCED(key)) schedule(); });
  document.addEventListener('visibilitychange', () => {
    if (!isConnected()) return;
    if (document.visibilityState === 'hidden' && timer) {
      // Leaving the page with unsynced practice: sync it now. This is a full
      // pull-merge-push, so progress another device uploaded in the meantime
      // stays in the gist. If the page closes before the pull finishes, nothing
      // is overwritten; the practice is still saved here and syncs next visit.
      syncNow({ keepalive: true });
    } else if (document.visibilityState === 'visible' && Date.now() - (state.lastSync ?? 0) > STALE) {
      syncNow();
    }
  });
  if (isConnected()) setTimeout(syncNow, 500);
}
