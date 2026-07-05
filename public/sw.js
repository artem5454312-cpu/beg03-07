// Service worker: даёт установить приложение на экран домой и работать чуть быстрее.
// Версия кеша бампается при каждом изменении — старый кеш сам удаляется.
const CACHE = 'fitpulse-v17';
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

  // Сеть — всегда в приоритете (и страница, и JS/CSS), кеш — только подстраховка на
  // случай отсутствия интернета. Так любое обновление видно сразу при следующем открытии,
  // без ручной очистки кеша браузера.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => cached || (e.request.mode === 'navigate' ? caches.match('/') : undefined))
      )
  );
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'PULSE', body: 'У тебя новое уведомление' };
  e.waitUntil(self.registration.showNotification(data.title || 'PULSE', {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.type || 'general',
    data: { url: '/#/agent' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
