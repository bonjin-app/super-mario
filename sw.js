/* ---------- PIPO JUMP service worker ----------
   The manifest makes this installable to a home screen. Without a worker, an
   installed copy still needs the network to fetch its own HTML, CSS, engine and
   fonts, so opening it on a subway gives you a blank screen -- an installed app
   that only works online is the same broken promise as loading the control-panel
   font from a third party.

   STRATEGY: network-first with a fast cache fallback, NOT cache-first.

   This project has no build step, so filenames are not content-hashed. Cache-first
   would then need a version constant bumped by hand on every deploy, and the failure
   mode when someone forgets is the worst one available: players pinned to an old
   build with no way to know, and no way to fix it from the server side. Network-first
   removes that trap entirely -- online you always get what was deployed, and the
   cache exists purely so the game still runs with no network.

   The cost is a network round-trip when online, which this page was already paying:
   it is four files and none of them block on each other. Flaky networks are handled
   by racing the fetch against a short timer rather than hanging on a dead socket. */

const VERSION = 'pipo-v1';
/* Everything the game needs to boot and play with no network. If a file is added to
   the page, add it here too -- a miss only costs offline availability for that one
   file, never correctness, because the fetch handler falls through to the network. */
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/engine.js',
  './fonts/silkscreen-400-latin.woff2',
  './fonts/silkscreen-700-latin.woff2',
  './manifest.webmanifest',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

/* Precache with individual requests rather than cache.addAll: addAll rejects the whole
   install if any single file 404s, which would leave the game with no offline support
   at all because one icon was renamed. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (err) { /* keep going */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== VERSION) await caches.delete(key);
    }
    /* Take over open pages now. The page already running keeps the JS it has in
       memory, so nothing swaps under a live game; the next load gets the new build. */
    await self.clients.claim();
  })());
});

const TIMEOUT_MS = 2500;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only same-origin GETs. Anything else (there is nothing else today) goes straight out.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    /* Race the network against a timer instead of awaiting it outright: on a dead or
       crawling connection a bare fetch can hang for tens of seconds, and a game that
       takes 30s to open offline is not meaningfully different from one that fails. */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('slow network')), TIMEOUT_MS);
    });

    try {
      const res = await Promise.race([fetch(req), timeout]);
      clearTimeout(timer);
      // Only cache real, complete responses -- an opaque or error response would
      // poison the cache and break the offline path it is supposed to protect.
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      clearTimeout(timer);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      /* A navigation with nothing cached for that exact URL still wants the app, so
         fall back to the shell entry rather than the browser's offline error page. */
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
