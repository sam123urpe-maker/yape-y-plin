import { createHash, timingSafeEqual } from 'node:crypto';
import { closedLimaDay, pushKeys, sendClosure } from '../lib/push.mjs';

const headers = { 'Cache-Control': 'no-store' };
const digest = value => createHash('sha256').update(value).digest();

export default {
  async fetch(request) {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers.get('authorization') || '';
    if (!secret || !timingSafeEqual(digest(authorization), digest('Bearer ' + secret))) {
      return Response.json({ error: 'No autorizado.' }, { status: 401, headers });
    }
    if (request.method !== 'GET') return Response.json({ error: 'Método no permitido.' }, { status: 405, headers });
    const keys = pushKeys(new URL(request.url).origin);
    if (!keys) return Response.json({ error: 'Faltan las claves de avisos.' }, { status: 503, headers });
    const date = closedLimaDay();
    try {
      const result = await sendClosure(date, keys);
      return Response.json({ date, ...result }, { status: result.failed ? 502 : 200, headers });
    } catch (error) {
      console.error('DigPro cron', error.response?.status || error.code || error.name);
      return Response.json({ error: 'No se pudo preparar el cierre.' }, { status: 502, headers });
    }
  },
};
