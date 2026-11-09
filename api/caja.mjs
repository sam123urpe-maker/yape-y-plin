import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendOnce, readDay } from '../lib/sheets.mjs';
import { managePush, pushKeys } from '../lib/push.mjs';

const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionLifetime = 60 * 60 * 24 * 30;

function reply(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...responseHeaders, ...headers } });
}

function validDate(date) {
  if (typeof date !== 'string' || !dayPattern.test(date) || date < '1900-01-01') return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
}

function equal(a, b) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function signature(expires, password) {
  return createHmac('sha256', password).update('caja:v1:' + expires).digest('base64url');
}

function authorized(req, password) {
  if (!password) return true;
  const cookie = (req.headers.get('cookie') || '').match(/(?:^|;\s*)caja=([^;]+)/)?.[1] || '';
  const [expires, hash] = cookie.split('.');
  return Boolean(hash && /^\d{10}$/.test(expires) && Number(expires) > Date.now() / 1000 && equal(hash, signature(expires, password)));
}

async function handler(req) {
  const password = process.env.APP_PASSWORD;
  if (process.env.VERCEL && password && password.length < 12) {
    return reply({ error: 'Configura APP_PASSWORD con al menos 12 caracteres en Vercel.' }, 503);
  }
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const login = req.method === 'POST' && action === 'login';
  if (!login && !authorized(req, password)) return reply({ error: 'Ingresa tu clave para continuar.' }, 401);
  if (process.env.VERCEL && !login && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return reply({ error: 'Falta configurar GOOGLE_SERVICE_ACCOUNT_JSON en Vercel para conectar Google Sheets.' }, 503);
  }
  try {
    if (req.method === 'GET') {
      if (action === 'push') return reply({ publicKey: pushKeys(url.origin)?.publicKey || null });
      const date = url.searchParams.get('date');
      if (!validDate(date)) return reply({ error: 'Elige una fecha válida.' }, 400);
      return reply(await readDay(date));
    }
    if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405, { Allow: 'GET, POST' });
    if (req.headers.get('sec-fetch-site') === 'cross-site' || !req.headers.get('content-type')?.startsWith('application/json')) {
      return reply({ error: 'Solicitud no válida.' }, 400);
    }
    const raw = await req.text();
    if (raw.length > 4096) return reply({ error: 'Solicitud demasiado grande.' }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return reply({ error: 'Solicitud no válida.' }, 400); }
    if (!data || typeof data !== 'object') return reply({ error: 'Solicitud no válida.' }, 400);

    if (login) {
      if (!password) return reply({ ok: true });
      if (typeof data.password !== 'string' || !equal(password, data.password)) {
        return reply({ error: 'La clave es incorrecta.' }, 401);
      }
      const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
      const cookie = 'caja=' + expires + '.' + signature(expires, password) +
        '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + sessionLifetime +
        (process.env.VERCEL || url.protocol === 'https:' ? '; Secure' : '');
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie });
    }

    if (action === 'push') {
      const keys = pushKeys(url.origin);
      if (!keys) return reply({ error: 'Los avisos aún no están configurados.' }, 503);
      const { status, ...result } = await managePush(data, keys);
      return reply(result, status || 200);
    }

    const { id, date, time, method, course, promotion, cents, kind } = data;
    if (!validDate(date) || typeof id !== 'string' || !idPattern.test(id) ||
      !Number.isInteger(cents) || cents < 0 || cents > 99999999) {
      return reply({ error: 'Revisa la fecha y el monto.' }, 400);
    }
    if (kind === 'ads') {
      await appendOnce('ads', [id, date, cents / 100, new Date().toISOString()]);
    } else if (kind === 'sale' && ['Yape', 'Plin'].includes(method) &&
      ['Rituales', 'Cócteles'].includes(course) && typeof promotion === 'boolean' &&
      typeof time === 'string' && timePattern.test(time) && cents > 0) {
      await appendOnce('sales', [id, date, time, method, course, promotion, cents / 100]);
    } else {
      return reply({ error: 'Revisa el curso, el medio, la hora y el pago.' }, 400);
    }
    return reply({ ok: true }, 201);
  } catch (error) {
    console.error('Caja API', error.response?.status || error.code || error.name);
    if (error.response?.data?.error?.details?.some(detail => detail.reason === 'SERVICE_DISABLED')) {
      return reply({ error: 'Google Sheets API está deshabilitada en el proyecto de la cuenta de servicio.' }, 502);
    }
    if (error.response?.status === 403) {
      return reply({ error: 'Google Sheets negó el acceso. Revisa que la cuenta de servicio sea editora de la hoja.' }, 502);
    }
    if (error.response?.status === 400) {
      return reply({ error: 'Revisa las pestañas de la app en Google Sheets. Ejecuta npm run setup para prepararlas.' }, 502);
    }
    return reply({ error: 'No se pudo conectar con Google Sheets. Intenta nuevamente.' }, 502);
  }
}

export default { fetch: handler };
