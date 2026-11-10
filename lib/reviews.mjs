import { appendOnce, appendRows, readRows } from './sheets.mjs';

const limaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
const limaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const validReviewId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export const validReviewCents = cents => Number.isInteger(cents) && cents > 0 && cents <= 99999999;
export const validReviewCourse = course => ['Rituales', 'Cócteles'].includes(course);

export function validReceipt(receipt) {
  return validReviewId(receipt?.id) && typeof receipt.phone === 'string' && /^[1-9]\d{9,14}$/.test(receipt.phone)
    && (receipt.course === null || validReviewCourse(receipt.course)) && (receipt.cents === null || validReviewCents(receipt.cents))
    && typeof receipt.promotion === 'boolean' && typeof receipt.receivedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.receivedAt)
    && Number.isFinite(Date.parse(receipt.receivedAt));
}

function pendingFrom(rows) {
  const confirmed = new Set(rows.filter(([, state]) => state === 'confirmed').map(([id]) => id.slice('confirmed:'.length)));
  return rows.filter(([id, state]) => state === 'received' && !confirmed.has(id))
    .map(([id, , phone, course, cents, promotion, receivedAt]) => ({ id, phone, course: course || null, cents: cents || null, promotion, receivedAt }))
    .filter(validReceipt).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function listPendingReviews() {
  return pendingFrom(await readRows('reviews'));
}

export async function queuePaymentReview({ id, phone, course, cents, promotion, receivedAt }) {
  if ((await readRows('reviews')).some(([previous]) => previous === id)) return false;
  await appendRows('reviews', [[id, 'received', phone, course || '', cents ?? '', promotion, receivedAt]]);
  return true;
}

export async function confirmPaymentReview(id, method, cents, course) {
  const rows = await readRows('reviews');
  const receipt = pendingFrom(rows).find(item => item.id === id);
  if (!receipt) {
    const confirmed = rows.find(([key, state]) => key === 'confirmed:' + id && state === 'confirmed');
    const sent = rows.some(([key, state]) => key === 'sent:' + id && state === 'sent');
    return { found: Boolean(confirmed), delivery: sent ? 'sent' : confirmed?.[2] ? 'queued' : undefined };
  }
  const date = limaDate.format(new Date(receipt.receivedAt));
  const time = limaTime.format(new Date(receipt.receivedAt));
  await appendOnce('sales', ['whatsapp-' + id, date, time, method, course, receipt.promotion && course === receipt.course, cents / 100]);
  const [, , , , savedCourse, , amount] = (await readRows('sales')).find(([key]) => key === 'whatsapp-' + id);
  const savedCents = Math.round(amount * 100);
  await appendOnce('reviews', ['confirmed:' + id, 'confirmed', receipt.phone, savedCourse, savedCents]);
  return { found: true, receipt, date, course: savedCourse, cents: savedCents, delivery: 'queued' };
}

export async function pendingCourseDeliveries() {
  const rows = await readRows('reviews');
  const seen = new Set(rows.filter(([, state]) => state === 'sent').map(([key]) => key.slice('sent:'.length)));
  const pending = [];
  for (const [key, state, phone, course, cents] of rows) {
    if (state !== 'confirmed' || !key.startsWith('confirmed:')) continue;
    const id = key.slice('confirmed:'.length);
    if (seen.has(id) || !validReviewId(id) || !/^[1-9]\d{9,14}$/.test(phone)
        || !validReviewCourse(course) || !validReviewCents(cents)) continue;
    seen.add(id);
    pending.push({ id, phone, course, cents });
  }
  return pending;
}

export async function markCourseSent(id) {
  await appendOnce('reviews', ['sent:' + id, 'sent']);
}
