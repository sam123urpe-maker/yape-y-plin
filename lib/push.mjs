import { createHash, randomUUID } from 'node:crypto';
import { sendNotification } from 'web-push';
import { appendRows, readDay, readRows } from './sheets.mjs';

const limaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
const number = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const celebration = ['¡Celebra cada venta! 🎉', '¡Bien hecho, DigPro! 🥳', '¡Tu esfuerzo dio frutos! 🚀'];
const encouragement = ['Cada día es una nueva oportunidad. 💪', 'Mañana volvemos a intentarlo. 🌱', 'Sigue a tu ritmo. Cada paso cuenta. ✨'];

function keyOf(endpoint) {
  return createHash('sha256').update(endpoint).digest('base64url');
}

function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1500) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash &&
      url.pathname.length > 1 &&
      (url.hostname.endsWith('.push.apple.com') || url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com');
  } catch {
    return false;
  }
}

function validKey(value, length) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === length;
}

function validSubscription(subscription) {
  return validEndpoint(subscription?.endpoint) && validKey(subscription.keys?.p256dh, 65) &&
    validKey(subscription.keys?.auth, 16);
}

export function pushKeys(origin) {
  const { PUSH_PUBLIC_KEY: publicKey, PUSH_PRIVATE_KEY: privateKey, VERCEL_PROJECT_PRODUCTION_URL: host } = process.env;
  const subject = host ? 'https://' + host : origin;
  if (!subject.startsWith('https://') || !validKey(publicKey, 65) || !validKey(privateKey, 32)) return null;
  return { subject, publicKey, privateKey };
}

async function devices(date, scope = '') {
  const active = new Map();
  const sent = new Set();
  for (const [, event, id, data, delivered] of await readRows('push')) {
    if (event === scope + 'off') active.delete(id);
    if (event === 'sent' && delivered === date) sent.add(id);
    if (event === scope + 'on') {
      try {
        const sub = JSON.parse(data);
        if (validSubscription(sub) && keyOf(sub.endpoint) === id) active.set(id, sub);
      } catch {
        // Ignore malformed subscriptions.
      }
    }
  }
  return { active, sent };
}

function send(subscription, payload, keys, topic) {
  return sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: keys, timeout: 8000, TTL: topic ? 43200 : 120, urgency: 'high', topic,
  });
}

export async function managePush(input, keys, scope = '') {
  const { operation, subscription } = input;
  const endpoint = operation === 'on' ? subscription?.endpoint : input.endpoint;
  if (!['on', 'off', 'status', 'test'].includes(operation) || !validEndpoint(endpoint) ||
      (operation === 'on' && !validSubscription(subscription))) {
    return { error: 'El dispositivo no tiene una suscripción válida.', status: 400 };
  }
  const id = keyOf(endpoint);
  const { active } = await devices(undefined, scope);
  const current = active.get(id);
  if (operation === 'status') return { enabled: Boolean(current) };
  if (operation === 'off') {
    if (current) await appendRows('push', [[randomUUID(), scope + 'off', id]]);
    return { enabled: false };
  }
  if (operation === 'on') {
    const value = { endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      await appendRows('push', [[randomUUID(), scope + 'on', id, JSON.stringify(value)]]);
    }
    return { enabled: true };
  }
  if (!current) return { error: 'Activa primero el aviso en este dispositivo.', status: 409 };
  try {
    await send(current, { title: 'DigPro · Aviso de prueba', body: scope ? 'Recibirás avisos de ventas y comprobantes. 🔔' : 'Tu cierre diario llegará a medianoche. 🔔' }, keys);
    return { enabled: true };
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await appendRows('push', [[randomUUID(), scope + 'off', id]]);
      return { error: 'La suscripción venció. Vuelve a activar el aviso.', status: 410 };
    }
    console.error('DigPro push', error.statusCode || error.code || error.name);
    return { error: 'No se pudo enviar el aviso de prueba. Intenta de nuevo.', status: 502 };
  }
}

export async function sendReviewNotice(payload, keys) {
  if (!keys) return;
  const scope = 'review-';
  const { active } = await devices(undefined, scope);
  const subscriptions = [...active];
  const topic = keyOf(payload.type + ':' + payload.id).slice(0, 24);
  const results = await Promise.allSettled(subscriptions.map(([, sub]) => send(sub, payload, keys, topic)));
  const expired = results.flatMap((result, index) => result.status === 'rejected' && [404, 410].includes(result.reason.statusCode)
    ? [[randomUUID(), scope + 'off', subscriptions[index][0]]] : []);
  if (expired.length) await appendRows('push', expired);
}

export function closedLimaDay(now = new Date()) {
  const midnight = Date.parse(limaDate.format(now) + 'T00:00:00Z');
  return new Date(midnight - 86400000).toISOString().slice(0, 10);
}

export function closureMessage(date, cents) {
  const index = Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
  const messages = cents > 0 ? celebration : encouragement;
  const amount = 'S/ ' + number.format(Math.abs(cents) / 100);
  const result = cents >= 0 ? 'Hoy hiciste ' + amount + ' de ganancia neta.' : 'Hoy cerraste con una pérdida de ' + amount + '.';
  return {
    title: 'DigPro · Cierre del ' + new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date)),
    body: result + ' ' + messages[index % messages.length],
    date,
  };
}

export async function sendClosure(date, keys) {
  const { active, sent } = await devices(date);
  const pending = [...active].filter(([id]) => !sent.has(id));
  if (!pending.length) return { sent: 0, expired: 0, failed: 0 };
  const day = await readDay(date);
  const net = day.sales.reduce((total, sale) => total + sale.cents, 0) - day.adCents;
  const payload = closureMessage(date, net);
  const results = await Promise.allSettled(pending.map(([, sub]) => send(sub, payload, keys, 'cierre-' + date)));
  const summary = { sent: 0, expired: 0, failed: 0 };
  const events = [];
  for (const [index, result] of results.entries()) {
    const [id] = pending[index];
    if (result.status === 'fulfilled') {
      summary.sent++;
      events.push(['sent:' + date + ':' + id, 'sent', id, '', date]);
    } else if ([404, 410].includes(result.reason.statusCode)) {
      summary.expired++;
      events.push([randomUUID(), 'off', id]);
    } else {
      summary.failed++;
      console.error('DigPro cierre', result.reason.statusCode || result.reason.code || result.reason.name);
    }
  }
  if (events.length) await appendRows('push', events);
  return summary;
}
