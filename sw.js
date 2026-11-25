// offline cache. bump V when shipping changes
const V = 'tithe-v1';
const CDN = 'tithe-cdn';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== CDN).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // own files: network first so updates land, cache if offline
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => {
      const cp = res.clone();
      caches.open(V).then(c => c.put(r, cp));
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true })));
    return;
  }

  // libs + fonts: cache first
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tessdata/.test(u.hostname)) {
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok || res.type === 'opaque') c.put(r, res.clone());
      return res;
    }));
  }
});
