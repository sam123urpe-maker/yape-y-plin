self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* Show a generic notice if needed. */ }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(message.date) ? message.date : null;
  event.waitUntil(self.registration.showNotification(message.title || 'DigPro', {
    body: message.body || 'Tienes un nuevo aviso de DigPro.',
    icon: '/assets/caja-ios.png',
    ...(date ? { tag: 'cierre-' + date, data: { date } } : {}),
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/', self.location.origin);
  if (event.notification.data?.date) url.searchParams.set('fecha', event.notification.data.date);
  event.waitUntil(self.clients.openWindow(url.href));
});
