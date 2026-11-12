import { createHash } from 'node:crypto';

const clean = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function receiptReviewReason(receipt, evidence) {
  if (!evidence) return 'image_not_read';
  if (evidence.successful !== true) return 'payment_not_successful';
  if (evidence.currency !== 'PEN') return 'currency_mismatch';
  if (!['Yape', 'Plin'].includes(evidence.method)) return 'method_unknown';
  if (!receipt.course) return 'course_missing';
  if (!Number.isInteger(receipt.cents) || receipt.cents <= 0) return 'amount_missing';
  if (evidence.amountCents !== receipt.cents) return 'amount_mismatch';
  const name = clean(evidence.recipientName);
  const phone = String(evidence.recipientPhone || '').replace(/\D/g, '');
  if (name.length < 11 || !'samanthaurpeque'.startsWith(name)) return 'recipient_name_mismatch';
  if (phone.length < 3 || !'51921211598'.endsWith(phone)) return 'recipient_phone_mismatch';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.date || '')) return 'date_missing';
  if (!/^\d{2}:\d{2}:\d{2}$/.test(evidence.time || '')) return 'time_missing';
  if (!/^\d{6,24}$/.test(evidence.operation || '')) return 'operation_missing';
  const paidAt = Date.parse(evidence.date + 'T' + evidence.time + '-05:00');
  const receivedAt = Date.parse(receipt.receivedAt);
  const elapsed = receivedAt - paidAt;
  if (!Number.isFinite(elapsed)) return 'date_or_time_invalid';
  if (elapsed < 0) return 'payment_in_future';
  if (elapsed > 10 * 60_000) return 'payment_older_than_10_minutes';
  const lima = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(paidAt);
  if (lima !== evidence.date || Number(evidence.time.slice(0, 2)) > 23
      || Number(evidence.time.slice(3, 5)) > 59 || Number(evidence.time.slice(6, 8)) > 59) return 'date_or_time_invalid';
  return null;
}

export function checkReceipt(receipt, evidence) {
  if (receiptReviewReason(receipt, evidence)) return null;
  const proof = createHash('sha256').update([evidence.method, evidence.date, evidence.operation].join('|')).digest('hex');
  return { method: evidence.method, proof };
}
