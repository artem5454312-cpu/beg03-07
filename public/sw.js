// Service worker: даёт установить приложение на экран домой и работать чуть быстрее.
// Версия кеша бампается при каждом изменении — старый кеш сам удаляется.
const CACHE = 'fitpulse-v6';
const SHELL = ['/css/style.css', '/js/api.js', '/js/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;

  // Главную страницу (и вообще любую навигацию) всегда берём из сети первой —
  // чтобы новый деплой сразу было видно, а не показывать старую версию из кеша.
  // Кешируем только как запасной вариант на случай отсутствия интернета.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  // Статику (css/js/manifest) — сначала из кеша, для скорости
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'FitPulse', body: 'У тебя новое уведомление' };
  e.waitUntil(self.registration.showNotification(data.title || 'FitPulse', { body: data.body }));
});
