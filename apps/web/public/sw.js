/* global self, caches */
/* Constitution Intelligence service worker (offline reading).
 *
 * What it caches — and nothing else:
 *   - the app's own static files (/_next/static/..., icons, the manifest): no personal data;
 *   - the offline reader page shell (/offline/<portal>), which contains no content or personal
 *     data: the constitution text itself is kept by the page in IndexedDB, not here.
 * What it never touches: anything under /api/ (so no content, sessions, tokens or personal data
 * go into this cache), the control centre (/admin), sign-in and every non-GET request.
 * When a portal page cannot be loaded because the device is offline, it sends the person to the
 * offline reader for that portal.
 */
const VERSION = 'v1';
const STATIC_CACHE = `ci-static-${VERSION}`;
const PAGE_CACHE = `ci-offline-pages-${VERSION}`;
const FALLBACK = '/offline-fallback.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([FALLBACK, '/manifest.webmanifest', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('ci-') && key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === FALLBACK
  );
}

/** "/o/<slug>/..." or "/offline/<slug>" → slug; null otherwise. */
function portalSlug(url) {
  const match = /^\/(?:o|offline)\/([a-z0-9][a-z0-9-]{1,62})(?:\/|$)/.exec(url.pathname);
  return match ? match[1] : null;
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function offlineNavigation(url) {
  const slug = portalSlug(url);
  if (slug) {
    const page = await caches.open(PAGE_CACHE).then((cache) => cache.match(`/offline/${slug}`));
    if (page) {
      return url.pathname.startsWith('/offline/')
        ? page
        : Response.redirect(`/offline/${slug}`, 302);
    }
  }
  const fallback = await caches.open(STATIC_CACHE).then((cache) => cache.match(FALLBACK));
  return (
    fallback ??
    new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cached, never answered from the cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => offlineNavigation(url)));
  }
});

/** Messages from the page: save or remove the offline reader for a portal. */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (message) => event.ports && event.ports[0] && event.ports[0].postMessage(message);
  if (
    data.type === 'cache-offline-page' &&
    typeof data.slug === 'string' &&
    /^[a-z0-9][a-z0-9-]{1,62}$/.test(data.slug)
  ) {
    event.waitUntil(
      (async () => {
        const path = `/offline/${data.slug}`;
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not save ${path}`);
        const html = await response.clone().text();
        await caches.open(PAGE_CACHE).then((cache) => cache.put(path, response));
        // The files the page needs to start (scripts and styles), so it opens without a network.
        const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
        const cache = await caches.open(STATIC_CACHE);
        await Promise.all(
          assets.map((asset) =>
            cache.match(asset).then((hit) => hit || cache.add(asset).catch(() => undefined)),
          ),
        );
        reply({ ok: true, assets: assets.length });
      })().catch((error) => reply({ ok: false, error: String(error) })),
    );
  }
  if (data.type === 'clear-offline') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        if (typeof data.slug === 'string') await cache.delete(`/offline/${data.slug}`);
        else await caches.delete(PAGE_CACHE);
        reply({ ok: true });
      })(),
    );
  }
});
