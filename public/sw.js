const CACHE_NAME = "laundry-loop-pos-v2";
const STAFF_FALLBACKS = ["/staff?app=1", "/staff"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STAFF_FALLBACKS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname === "/staff") {
    const isAppShell = url.searchParams.get("app") === "1";

    if (isAppShell) {
      event.respondWith((async () => {
        const cached = (await caches.match(request))
          || (await caches.match("/staff?app=1"))
          || (await caches.match("/staff"));

        if (cached) {
          // Counter POS must open immediately when the internet is unavailable.
          // Refresh the cached shell in the background instead of blocking launch.
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (!response || !response.ok) return;
                return caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
              })
              .catch(() => undefined)
          );
          return cached;
        }

        try {
          const response = await fetch(request);
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          return response;
        } catch {
          return Response.error();
        }
      })());
      return;
    }

    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || (await caches.match("/staff?app=1"))
            || (await caches.match("/staff"))
            || Response.error();
        })
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".svg")
    || url.pathname.endsWith(".jpg")
    || url.pathname.endsWith(".png")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
  }
});
