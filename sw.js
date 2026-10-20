// Offline support.
// The app's own files are fetched fresh whenever there is a connection, so an update shows up on the
// next normal load and the page and its scripts always come from the same version; the cache is only
// used when offline. Fonts and libraries from CDNs live at fixed, versioned addresses, so they are
// served from the cache once fetched.
// Change VERSION only when this file's logic or the SHELL list changes, not for normal app updates:
// a new service worker makes open pages reload once to switch over.
const VERSION = "kwick-study-v15";
const SHELL = [
  "./", "index.html", "css/styles.css", "js/config.js", "js/app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/logo.svg", "icons/icon-192.png", "icons/icon-512.png",
];
const CDN_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first: fresh files online, cached copy offline.
    e.respondWith(fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req.mode === "navigate" ? "index.html" : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "index.html" : req, { ignoreSearch: true })));
    return;
  }
  if (CDN_HOSTS.includes(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => "focus" in c);
    return open ? open.focus() : self.clients.openWindow("./");
  }));
});
