self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* Show a generic notice if needed. */ }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(message.date) ? message.date : null;
  const id = /^[a-f0-9-]{36}$/.test(message.id) ? message.id : null;
  const type = id && ['review', 'sale'].includes(message.type) ? message.type : null;
  const notification = self.registration.showNotification(message.title || 'DigPro', {
    body: message.body || 'Tienes un nuevo aviso de DigPro.',
    icon: '/assets/caja-ios.png',
    ...(type ? { tag: type + '-' + id, data: { type, id, date } } : date ? { tag: 'cierre-' + date, data: { date } } : {}),
  });
  const update = type ? self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => clients.forEach(client => client.postMessage({ type, id }))) : Promise.resolve();
  event.waitUntil(Promise.all([notification, update]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/', self.location.origin);
  if (event.notification.data?.date) url.searchParams.set('fecha', event.notification.data.date);
  if (event.notification.data?.type === 'review') url.searchParams.set('por-confirmar', event.notification.data.id);
  event.waitUntil(self.clients.openWindow(url.href));
});
