// GoBoard as an installed app: keeps copies of the site's files so it loads fast and bots and
// puzzles work offline. Pages and unversioned files always come fresh from the internet when
// online (the saved copy is only for offline); files with ?v= in their address never change,
// so their saved copy is used straight away. Other websites (Supabase, PeerJS) aren't touched.
const CACHE = "goboard-files";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Remember a file; for ?v= files, forget the older versions of the same file.
async function remember(cache, request, response) {
  const url = new URL(request.url);
  if (url.searchParams.has("v")) {
    for (const old of await cache.keys()) {
      const oldUrl = new URL(old.url);
      if (oldUrl.pathname === url.pathname && oldUrl.search !== url.search) cache.delete(old);
    }
  }
  await cache.put(request, response);
}

async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) await remember(cache, request, response.clone());
  return response;
}

async function internetFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await remember(cache, request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (saved) return saved;
    // Offline and this page was never opened: show the start page if we have it.
    if (request.mode === "navigate") {
      const start = await cache.match("index.html", { ignoreSearch: true });
      if (start) return start;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const neverChanges = url.searchParams.has("v") || url.pathname.includes("/models/") || url.pathname.includes("/js/vendor/");
  event.respondWith(neverChanges ? savedFirst(request) : internetFirst(request));
});
