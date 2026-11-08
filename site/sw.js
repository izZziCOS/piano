// Service worker: lets the site work offline and be installed as an app.
//
// - The page, styles, scripts, font and icons (SHELL) are stored when the
//   service worker installs, so every section works offline after one visit.
// - They're fetched network-first: online you always get the latest version
//   (and the stored copy is refreshed); offline, or when the network takes more
//   than a few seconds, the stored copy is used. Network fetches always
//   revalidate with the server, skipping the browser's own HTTP cache, so a
//   new page is never paired with an older script (GitHub Pages lets browsers
//   keep files for 10 minutes otherwise).
// - Piano samples and VexFlow never change (a new VexFlow has a new file
//   name), so they're served from storage first. The page asks for the
//   samples to be stored once the piano has loaded (see main.js).
//
// BUILD is replaced with the commit id when the site is deployed
// (.github/workflows/deploy.yml), so every deploy is a new service worker: open
// pages are told a new version is ready, and the stored files are refreshed.
// When running locally it stays 'dev'.
const BUILD = 'dev';
const SHELL_CACHE = `piano-shell-${BUILD}`;
const MEDIA_CACHE = 'piano-media-v1';
const NETWORK_TIMEOUT = 4000;

const SHELL = [
  './',
  'css/style.css',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/noto-music.woff2',
  'vendor/vexflow-4.2.5.js',
  'js/audio.js',
  'js/ear.js',
  'js/generator.js',
  'js/keyboard.js',
  'js/learn.js',
  'js/learncheck.js',
  'js/main.js',
  'js/musicxml.js',
  'js/notes.js',
  'js/ownpieces.js',
  'js/pieces.js',
  'js/play.js',
  'js/progress.js',
  'js/quiz.js',
  'js/scales.js',
  'js/sheet.js',
  'js/sheetpractice.js',
  'js/stats.js',
  'js/storage.js',
  'js/sync.js',
];
const INDEX = new URL('./', self.location).href;
const UNCHANGING = /\/(samples|vendor)\//;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 'reload' skips the browser's HTTP cache, so a new version never stores old files.
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, MEDIA_CACHE];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Only this site's own files. GitHub (sync) and anything else go straight to the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return;
  event.respondWith(UNCHANGING.test(url.pathname) ? cacheFirst(event) : networkFirst(event));
});

async function cacheFirst(event) {
  const { request } = event;
  const stored = await caches.match(request);
  if (stored) return stored;
  const response = await fetch(request);
  if (response.status === 200) {
    const copy = response.clone();
    event.waitUntil(caches.open(MEDIA_CACHE).then((cache) => cache.put(request, copy)));
  }
  return response;
}

async function networkFirst(event) {
  const { request } = event;
  // Every page address (#learn, #sheet/…) is the same index.html.
  const key = request.mode === 'navigate' ? INDEX : request;
  const stored = () => caches.match(key, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy)));
    }
    return response;
  });
  const slow = new Promise((resolve) => { setTimeout(resolve, NETWORK_TIMEOUT); })
    .then(async () => (await stored()) ?? network);
  try {
    return await Promise.race([network, slow]);
  } catch {
    return (await stored()) ?? Response.error();
  }
}

// The page sends the piano samples' addresses once the piano has loaded. Most
// come straight from the browser's HTTP cache, so this rarely downloads anything.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'store-media' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    for (const href of event.data.urls) {
      const url = new URL(href, self.location);
      if (url.origin !== self.location.origin || !UNCHANGING.test(url.pathname) || await cache.match(url)) continue;
      try {
        const response = await fetch(url);
        if (response.status === 200) await cache.put(url, response);
      } catch { /* offline again: try next time */ }
    }
  })());
});
