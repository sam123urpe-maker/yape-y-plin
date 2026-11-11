import { createHash } from 'node:crypto';

const clean = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function checkReceipt(receipt, evidence) {
  if (!evidence || evidence.successful !== true || evidence.currency !== 'PEN'
      || !['Yape', 'Plin'].includes(evidence.method)
      || !receipt.course || !Number.isInteger(receipt.cents) || receipt.cents <= 0
      || evidence.amountCents !== receipt.cents) return null;
  const name = clean(evidence.recipientName);
  const phone = String(evidence.recipientPhone || '').replace(/\D/g, '');
  if (name.length < 11 || !'samanthaurpeque'.startsWith(name)
      || phone.length < 3 || !'51921211598'.endsWith(phone)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.date || '') || !/^\d{2}:\d{2}:\d{2}$/.test(evidence.time || '')
      || !/^\d{6,24}$/.test(evidence.operation || '')) return null;
  const paidAt = Date.parse(evidence.date + 'T' + evidence.time + '-05:00');
  const receivedAt = Date.parse(receipt.receivedAt);
  const elapsed = receivedAt - paidAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 10 * 60_000) return null;
  const lima = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(paidAt);
  if (lima !== evidence.date || Number(evidence.time.slice(0, 2)) > 23
      || Number(evidence.time.slice(3, 5)) > 59 || Number(evidence.time.slice(6, 8)) > 59) return null;
  const proof = createHash('sha256').update([evidence.method, evidence.date, evidence.operation].join('|')).digest('hex');
  return { method: evidence.method, proof };
}
