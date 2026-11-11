import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readWhatsAppControl, writeWhatsAppMode, writeWhatsAppHeartbeat } from '../lib/sheets.mjs';
import { confirmPaymentReview, listPendingReviews, markCourseSent, pendingCourseDeliveries, queuePaymentReview, recordManualCourse, validReceipt, validReviewCents, validReviewCourse, validReviewId } from '../lib/reviews.mjs';
import { checkReceipt } from '../lib/receipt-check.mjs';
import { managePush, pushKeys, sendReviewNotice } from '../lib/push.mjs';

const lifetime = 30 * 86400;
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const sign = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
const reply = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export function whatsappApi(store = {
  readWhatsAppControl, writeWhatsAppMode, writeWhatsAppHeartbeat,
  confirmPaymentReview, listPendingReviews, markCourseSent, pendingCourseDeliveries, queuePaymentReview, recordManualCourse, sendReviewNotice,
}) {
  return {
    async fetch(req) {
      const secret = process.env.DIGPRO_WHATSAPP_CONTROL;
      if (!/^[a-f0-9]{64}$/.test(secret || '')) return reply({ available: false }, 503);
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      const now = Math.floor(Date.now() / 1000);
      const cookie = (req.headers.get('cookie') || '').match(/(?:^|;\s*)digpro_whatsapp=([^;]+)/)?.[1] || '';
      const [expires, signature] = cookie.split('.');
      const operator = signature && /^\d{10}$/.test(expires) && Number(expires) > now && equal(signature, sign(secret, 'device:' + expires));
      const agentAction = ['sync', 'receipt', 'course-sent', 'manual-course'].includes(action);
      const agent = agentAction && equal(req.headers.get('authorization') || '', 'Bearer ' + sign(secret, 'digpro:whatsapp:agent:v1'));
      const login = action === 'link' && req.method === 'POST';
      if (!login && (agentAction ? !agent : !operator)) return reply({ error: 'Vincula este dispositivo para usar WhatsApp en DigPro.' }, 401);
      try {
        if (req.method === 'GET' && !action) {
          const { desired, applied, connected, heartbeat } = await store.readWhatsAppControl();
          return reply({ desired, applied, connected: connected && Date.now() - Date.parse(heartbeat) < 65_000 });
        }
        if (req.method === 'GET' && action === 'reviews') return reply({ pending: await store.listPendingReviews() });
        if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
        if (req.headers.get('sec-fetch-site') === 'cross-site' || !req.headers.get('content-type')?.startsWith('application/json')) {
          return reply({ error: 'Solicitud no válida.' }, 400);
        }
        const raw = await req.text();
        if (raw.length > 4096) return reply({ error: 'Solicitud demasiado grande.' }, 413);
        const body = JSON.parse(raw);
        if (login) {
          if (typeof body?.code !== 'string' || !equal(body.code, secret)) return reply({ error: 'El código es incorrecto.' }, 401);
          const until = now + lifetime;
          const session = `digpro_whatsapp=${until}.${sign(secret, 'device:' + until)}; Path=/api/whatsapp; HttpOnly; SameSite=Strict; Max-Age=${lifetime}`;
          return reply({ ok: true }, 200, { 'Set-Cookie': session + (url.protocol === 'https:' || process.env.VERCEL ? '; Secure' : '') });
        }
        if (action === 'sync' && typeof body?.applied === 'boolean' && typeof body.connected === 'boolean') {
          await store.writeWhatsAppHeartbeat(body.applied, body.connected);
          const { desired } = await store.readWhatsAppControl();
          const deliveries = body.connected && body.courseDelivery === true ? await store.pendingCourseDeliveries() : undefined;
          return reply({ desired, deliveries });
        }
        if (action === 'course-sent' && validReviewId(body?.id)) {
          await store.markCourseSent(body.id);
          return reply({ ok: true });
        }
        if (action === 'manual-course' && validReviewId(body?.id) && /^[1-9]\d{9,14}$/.test(body.phone)
            && validReviewCourse(body.course) && typeof body.sentAt === 'string'
            && Date.parse(body.sentAt) >= Date.now() - 86400_000 && Date.parse(body.sentAt) <= Date.now() + 1000) {
          await store.recordManualCourse(body);
          return reply({ ok: true });
        }
        if (action === 'mode' && typeof body?.enabled === 'boolean') {
          await store.writeWhatsAppMode(body.enabled);
          return reply({ ok: true });
        }
        if (action === 'receipt' && validReceipt(body)) {
          const created = await store.queuePaymentReview(body);
          const checked = checkReceipt(body, body.evidence);
          if (checked) {
            const result = await store.confirmPaymentReview(body.id, checked.method, body.cents, body.course, { proof: checked.proof });
            if (result.receipt) {
              await store.sendReviewNotice({ type: 'sale', id: body.id, date: result.date,
                title: 'DigPro · Venta confirmada automáticamente',
                body: `${body.course} · S/ ${(body.cents / 100).toFixed(2)} 🎉` }, pushKeys(url.origin))
                .catch(error => console.error('DigPro aviso de venta', error.code || error.name));
            }
            if (result.found) return reply({ ok: true, confirmed: true }, 201);
          }
          if (created) {
            await store.sendReviewNotice({ type: 'review', id: body.id, title: 'DigPro · Pago por confirmar',
              body: `Un cliente (+${body.phone}) envió un comprobante${body.course ? ' de ' + body.course : ''}.` }, pushKeys(url.origin))
              .catch(error => console.error('DigPro aviso de comprobante', error.code || error.name));
          }
          return reply({ ok: true }, 201);
        }
        if (action === 'confirm' && validReviewId(body?.id) && validReviewCents(body.cents)
            && validReviewCourse(body.course) && ['Yape', 'Plin'].includes(body.method)
            && (body.alreadyDelivered === undefined || typeof body.alreadyDelivered === 'boolean')) {
          const { found, receipt, date, course, cents, delivery } = await store.confirmPaymentReview(body.id, body.method, body.cents, body.course, { alreadyDelivered: body.alreadyDelivered });
          if (!found) return reply({ error: 'El comprobante ya no está disponible.' }, 404);
          if (receipt) {
            await store.sendReviewNotice({ type: 'sale', id: receipt.id, date, title: 'DigPro · Venta confirmada',
              body: `${course} · S/ ${(cents / 100).toFixed(2)} 🎉` }, pushKeys(url.origin))
              .catch(error => console.error('DigPro aviso de venta', error.code || error.name));
          }
          return reply({ ok: true, date, delivery });
        }
        if (action === 'review-push' && body && typeof body === 'object') {
          const keys = pushKeys(url.origin);
          if (!keys) return reply({ error: 'Los avisos aún no están configurados.' }, 503);
          const { status, ...result } = await managePush(body, keys, 'review-');
          return reply(result, status || 200);
        }
        return reply({ error: 'Solicitud no válida.' }, 400);
      } catch (error) {
        if (error instanceof SyntaxError) return reply({ error: 'Solicitud no válida.' }, 400);
        console.error('DigPro WhatsApp', error.response?.status || error.code || error.name);
        return reply({ error: 'No se pudo completar la operación de WhatsApp.' }, 502);
      }
    },
  };
}

export default whatsappApi();
