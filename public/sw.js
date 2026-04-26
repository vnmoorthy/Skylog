// SKYLOG service worker — minimal app-shell cache.
// We don't cache the API responses (they change every 10s).
// We do cache the HTML/JS/CSS so the PWA can launch offline (read-only).

const CACHE = "skylog-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Don't cache the live-feed APIs.
  if (
    url.host.includes("airplanes.live") ||
    url.host.includes("celestrak.org") ||
    url.host.includes("basemaps.cartocdn.com") ||
    url.host.includes("tile.openstreetmap")
  ) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
