/* Rig Radar v2 service worker.
 * The shell is cached so the app opens instantly; telemetry and map data
 * always go to the network, because stale telemetry is worse than none.
 *
 * CACHE was hardcoded to 'rig-radar-v2.7.1' and never bumped again across
 * eleven-plus releases, while fetch below served cache-first with no
 * revalidation — so a phone that installed the PWA anywhere around 2.7.1
 * kept silently serving that exact shell forever, including every
 * manoeuvre-arrow fix from 2.7.3 through 2.7.11. Each "fix the arrow"
 * report this session was investigated as a drawing bug and came back
 * clean, because the drawing code really was already fixed — just never
 * reaching the one device actually being tested on. Fetch is now
 * stale-while-revalidate (serve the cached copy immediately for the fast
 * open, but always refetch in the background and update the cache for
 * next time) so this can't silently recur even if CACHE isn't bumped on
 * some future release.
 */
const CACHE = 'rig-radar-v2.9.0';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((hit) => {
        const network = fetch(event.request)
          .then((res) => { cache.put(event.request, res.clone()); return res; })
          .catch(() => hit);
        return hit || network;
      })
    )
  );
});
