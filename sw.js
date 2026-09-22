// __CACHE_VERSION__ is substituted with the commit SHA by the deploy workflow
// (.github/workflows/deploy.yml) on every push, so the browser always sees this
// file as changed and installs a fresh cache. Locally it's just a placeholder.
const CACHE_NAME = "sleep-diary-shell-__CACHE_VERSION__";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/supabase-client.js",
  "./js/auth.js",
  "./js/time.js",
  "./js/date.js",
  "./js/device.js",
  "./js/metrics.js",
  "./js/app.js",
  "./js/version.js",
  "./js/version-init.js",
  "./js/entry.js",
  "./js/dashboard.js",
  "./js/goals.js",
  "./js/table.js",
  "./js/table-scroll-sync.js",
  "./js/export.js",
  "./js/therapy.js",
  "./js/tips.js",
  "./js/sw-register.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// Only intercept our own static assets. Everything else (Supabase API calls,
// third-party CDN scripts) goes straight to the network untouched.
//
// Network-first, cache-fallback: iOS's built-in service-worker update check is
// unreliable for standalone home-screen apps (it often doesn't notice a new
// sw.js after a full force-quit/relaunch), which left this cache-first version
// serving stale app-shell files indefinitely whenever that check silently
// failed. Preferring the network here means the phone always gets fresh files
// while online, regardless of whether the SW itself has updated; the cache is
// only a fallback for offline use.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
