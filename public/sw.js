const CACHE_NAME = "laundry-loop-pos-v4";
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

        try {
          const onlineResponse = await Promise.race([
            fetch(request),
            new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
          ]);
          if (onlineResponse && onlineResponse.ok) {
            const copy = onlineResponse.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
            return onlineResponse;
          }
          return cached || Response.error();
        } catch {
          return cached || Response.error();
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
