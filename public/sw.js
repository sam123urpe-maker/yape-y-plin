function foregroundSaleSound(client, id) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const deadline = Date.now() + 800;
    const finish = played => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(played);
    };
    const timer = setTimeout(() => finish(false), 800);
    channel.port1.onmessage = event => finish(event.data?.id === id && event.data?.played === true);
    try { client.postMessage({ type: 'sale-sound', id, deadline }, [channel.port2]); }
    catch { finish(false); }
  });
}

async function showPush(message) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(message.date) ? message.date : null;
  const id = /^[a-f0-9-]{36}$/.test(message.id) ? message.id : null;
  const type = id && ['review', 'sale'].includes(message.type) ? message.type : null;
  const clients = type ? await self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []) : [];
  const visible = clients.filter(client => client.visibilityState === 'visible').sort((a, b) => Number(b.focused) - Number(a.focused));
  const played = type === 'sale' && visible.length ? await foregroundSaleSound(visible[0], id) : false;
  // Always display a notification. Silence its default tone only after the
  // visible page confirms that the custom effect played (or already played).
  await self.registration.showNotification(message.title || 'DigPro', {
    body: message.body || 'Tienes un nuevo aviso de DigPro.',
    icon: '/assets/caja-ios.png',
    silent: played,
    ...(type ? { tag: type + '-' + id, data: { type, id, date } } : date ? { tag: 'cierre-' + date, data: { date } } : {}),
  });
  for (const client of clients) {
    try { client.postMessage({ type, id, soundHandled: true }); } catch { /* Window closed after the push. */ }
  }
}

self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* Show a generic notice if needed. */ }
  event.waitUntil(showPush(message));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/', self.location.origin);
  if (event.notification.data?.date) url.searchParams.set('fecha', event.notification.data.date);
  if (event.notification.data?.type === 'review') url.searchParams.set('por-confirmar', event.notification.data.id);
  event.waitUntil(self.clients.openWindow(url.href));
});
