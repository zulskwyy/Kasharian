/* KasHarian web: offline cache. App files: network first (so updates arrive), cache fallback.
   /vendor files (OCR engine, language data, pdf.js): cache first because they are large and never change. */
const BUILD = '20261030090645';
const CACHE = 'kh-web-' + BUILD;
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png',
  'js/theme-early.js', 'js/i18n-en.js', 'js/i18n.js', 'js/rules.js', 'js/slip.js', 'js/store.js', 'js/ui.js', 'js/app.js', 'js/backup.js', 'js/charts.js', 'js/more.js', 'js/recovery.js', 'js/slipui.js', 'js/scan.js', 'js/bucket.js', 'js/extra.js', 'js/habit.js', 'js/statement.js', 'js/tidy.js', 'js/docs.js', 'js/ocr.js', 'js/boot.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kh-web-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
