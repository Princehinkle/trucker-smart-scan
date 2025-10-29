  if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}
self.addEventListener('install', e => {  
  e.waitUntil(caches.open('sst-v1').then(cache => cache.addAll([  
    './','./index.html','./styles.css','./app.js','./manifest.webmanifest'  
  ])));  
});  
self.addEventListener('fetch', e => {  
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));  
});  
