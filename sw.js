/* Service Worker for Snake AI PWA */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `snake-static-${CACHE_VERSION}`;

const STATIC_ASSETS = ["/", "/index.html", "/styles.css", "/script.js", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.includes(CACHE_VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Bypass non-GET
  if (request.method !== "GET") return;

  // Network-first for navigations (HTML)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(STATIC_CACHE);
          cache.put("/", fresh.clone());
          return fresh;
        } catch (err) {
          const cacheMatch = await caches.match("/index.html");
          return cacheMatch || new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // Cache-first for same-origin static files
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request)
            .then((resp) => {
              const copy = resp.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {});
              return resp;
            })
            .catch(() => caches.match("/index.html"))
      )
    );
  }
});
