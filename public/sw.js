self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open('pm-cache-v1').then(cache=>cache.addAll([
    '/', '/index.html', '/styles.css', '/app.js'
  ])));
});
self.addEventListener('fetch', (e)=>{
  e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
});

