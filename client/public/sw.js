/* eslint-env serviceworker */
/**
 * Lookup's service worker.
 *
 * The point of this app is to be used outdoors, at night, often at a dark-sky
 * site with no usable signal — which is precisely when a network-dependent web
 * app stops working. Everything needed to draw the sky is already local (the
 * star catalog and world map are bundled, and positions are propagated in the
 * browser), so the only things standing between this and a fully usable
 * offline tool are the app shell and a recent copy of the orbital elements.
 *
 * The caching rules below follow one principle: cache what stays true, never
 * cache what would become a lie.
 *
 *   - App shell and bundled data: immutable, hashed, precached.
 *   - Orbital elements (/api/tle/*): stay usable for days, and the response
 *     carries its own epoch so the UI already reports how old they are.
 *     Served from cache immediately and refreshed in the background.
 *   - Pass predictions (/api/passes*): cover the next several days, so a
 *     stored copy is still worth showing. Network first, cache as fallback.
 *   - Aircraft, cloud cover, and the AI endpoints: never cached. A stale
 *     aircraft position is not old data, it is a wrong answer — better to
 *     report the feed as unavailable, which the UI already does.
 *
 * PRECACHE and BUILD_ID are rewritten at build time by scripts/build-sw.mjs.
 */

const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;

const SHELL_CACHE = `lookup-shell-${BUILD_ID}`;
const DATA_CACHE = 'lookup-data-v1';

/** Elements older than this are not worth serving even offline. */
const MAX_DATA_AGE_MS = 30 * 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Fetch explicitly rather than cache.addAll so one missing asset cannot
      // fail the whole install and leave the app with no worker at all.
      Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) await cache.put(url, res);
          } catch {
            // Offline during install, or an asset that moved; the runtime
            // handlers below will pick it up on first use.
          }
        })
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('lookup-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// The page asks for this once the user accepts an update, rather than the
// worker taking over mid-session and swapping the code out from under them.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Endpoints whose answers are only true at the moment they are given. */
function isLiveOnly(pathname) {
  return (
    pathname.startsWith('/api/aircraft') ||
    pathname.startsWith('/api/weather') ||
    pathname.startsWith('/api/explain') ||
    pathname.startsWith('/api/orbit-advice') ||
    pathname.startsWith('/api/ai/')
  );
}

async function putDated(cache, request, response) {
  // Stamp the store time so a cached copy can be aged out later. The response
  // body is untouched; this rides alongside in a cloned set of headers.
  const headers = new Headers(response.headers);
  headers.set('x-lookup-cached-at', new Date().toISOString());
  await cache.put(request, new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

function tooOld(response) {
  const at = response?.headers.get('x-lookup-cached-at');
  if (!at) return false;
  const age = Date.now() - Date.parse(at);
  return Number.isFinite(age) && age > MAX_DATA_AGE_MS;
}

/** Cache first, refresh in the background. Used for orbital elements. */
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await putDated(cache, request, response);
      return response;
    })
    .catch(() => null);

  if (cached && !tooOld(cached)) {
    // Hand back the stored copy at once, but keep the worker alive until the
    // refresh lands — otherwise it can be killed mid-flight and the cache
    // never actually moves forward.
    event.waitUntil(network);
    return cached;
  }
  return (await network) ?? cached ?? Response.error();
}

/** Network first, falling back to a stored copy. Used for pass predictions. */
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await putDated(cache, request, response);
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached && !tooOld(cached)) return cached;
    throw err;
  }
}

/** For navigations: keep the app launchable with no network at all. */
async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match('/index.html');
    if (shell) return shell;
    throw new Error('offline and no cached shell');
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Build output is content-hashed, so anything fetched here is safe to keep.
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch other origins: the API rewrite target, tiles, anything else.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (isLiveOnly(url.pathname)) return; // straight to the network
    if (url.pathname.startsWith('/api/tle/')) {
      event.respondWith(staleWhileRevalidate(event));
      return;
    }
    if (url.pathname.startsWith('/api/passes')) {
      event.respondWith(networkFirst(request));
      return;
    }
    return;
  }

  event.respondWith(cacheFirst(request));
});
