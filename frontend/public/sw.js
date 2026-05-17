// TG云盘 Service Worker — offline shell
var CACHE_NAME = 'tgpan-v2';
var PRECACHE_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (url.pathname.indexOf('/api/') === 0) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function() { return caches.match('/'); })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) { return cached || fetch(event.request); })
  );
});
