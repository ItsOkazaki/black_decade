// BLACK DECADE service worker: code always fresh, heavy assets cached.
// First visit downloads the game once; every later visit loads from this
// cache (models, textures, sounds) and only re-checks the small code files.
const CACHE = 'black-decade-v69';
const CORE = ['index.html', 'play.html', 'loadout.js', 'font.js', 'missions.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  const isCode = /\.(html|js|css|json)$/.test(u.pathname) || u.pathname.endsWith('/');
  if (isCode) {   // network-first: new versions arrive immediately, cache is the offline fallback
    e.respondWith(fetch(e.request).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r;
    }).catch(() => caches.match(e.request)));
  } else {        // cache-first: the megabytes (models/textures/sounds) never re-download
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r;
    })));
  }
});
