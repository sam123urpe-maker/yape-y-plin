'use strict';

const $ = id => document.getElementById(id);
const filePreview = location.protocol === 'file:';
const dayStrip = $('week-days');
const dayStripBatch = 28;
const saleForm = $('sale-form');
const saleEditForm = $('sale-edit-form');
const adsForm = $('ads-form');
const formatter = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const limaClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const dayTitle = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short' });
const shortDate = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const monthTitle = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const prices = { Rituales: [1000, 500], 'Cócteles': [500, 300] };

function limaNow() {
  const parts = Object.fromEntries(limaClock.formatToParts().map(part => [part.type, part.value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), time: parts.hour + ':' + parts.minute };
}
const asDate = date => new Date(date + 'T12:00:00Z');
const asKey = date => date.toISOString().slice(0, 10);
const capitalized = value => value.charAt(0).toUpperCase() + value.slice(1);
const money = cents => (cents < 0 ? '−' : '') + 'S/ ' + formatter.format(Math.abs(cents) / 100);

let today = limaNow().date;
const requestedDay = new URLSearchParams(location.search).get('fecha');
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = requestedDay && datePattern.test(requestedDay) &&
  Number.isFinite(+asDate(requestedDay)) && asKey(asDate(requestedDay)) === requestedDay;
let selected = isDate ? requestedDay : today;
let historyMonth = selected.slice(0, 7) + '-01';
let historyWeek = monday(selected);
let loaded = null;
let daily = new Map();
let loadVersion = 0;
let toastTimer;
let editingSale;
const pending = new WeakMap();
const push = { started: false, registration: null, publicKey: null, subscription: null, enabled: false };

function shift(date, count) {
  const value = asDate(date);
  value.setUTCDate(value.getUTCDate() + count);
  return asKey(value);
}

function drawDayHeading() {
  const title = dayTitle.format(asDate(selected));
  $('day-title').textContent = selected === today
    ? 'Hoy, ' + title.replace(/^.*?,? (\d+ de .*)$/, '$1')
    : capitalized(title) + (selected.slice(0, 4) === today.slice(0, 4) ? '' : ' de ' + selected.slice(0, 4));
}

function updateDayButton(button) {
  const date = button.dataset.date;
  button.dataset.records = daily.has(date);
  button.setAttribute('aria-pressed', date === selected);
  button.tabIndex = date === selected ? 0 : -1;
  if (date === today) button.setAttribute('aria-current', 'date');
  else button.removeAttribute('aria-current');
}

function makeDayButtons(anchor, offset, count) {
  const days = [];
  for (let index = 0; index < count; index++) {
    const date = shift(anchor, offset + index);
    if (!datePattern.test(date)) continue;
    const value = asDate(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.date = date;
    button.setAttribute('aria-label', fullDate.format(value));
    updateDayButton(button);
    const label = document.createElement('small');
    label.textContent = weekday.format(value).slice(0, 3);
    const number = document.createElement('strong');
    number.textContent = value.getUTCDate();
    button.append(label, number, document.createElement('i'));
    button.addEventListener('click', () => selectDay(date));
    days.push(button);
  }
  return days;
}

function drawDayStrip(revealSelected = true) {
  const first = dayStrip.firstElementChild;
  const last = dayStrip.lastElementChild;
  if (!first || selected < first.dataset.date || selected > last.dataset.date) {
    dayStrip.replaceChildren(...makeDayButtons(selected, -dayStripBatch, dayStripBatch * 2 + 1));
  } else {
    for (const button of dayStrip.children) updateDayButton(button);
  }
  if (!revealSelected || !dayStrip.clientWidth) return;
  const strip = dayStrip.getBoundingClientRect();
  const day = dayStrip.querySelector('[aria-pressed="true"]').getBoundingClientRect();
  if (day.left < strip.left - 1 || day.right > strip.right + 1) {
    dayStrip.scrollLeft += day.left + day.width / 2 - (strip.left + strip.width / 2);
  }
}

function monday(date) {
  return shift(date, -((asDate(date).getUTCDay() + 6) % 7));
}

function weekRange(start) {
  return shortDate.format(asDate(start)) + ' – ' + shortDate.format(asDate(shift(start, 6)));
}

function changeMonth(first, direction) {
  const date = asDate(first);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return asKey(date);
}

function showNet(element, cents) {
  element.textContent = money(cents);
  element.dataset.negative = cents < 0;
}

function historyDay(date, month) {
  const item = $('history-day-template').content.firstElementChild.cloneNode(true);
  const totals = daily.get(date);
  item.dataset.date = date;
  item.dataset.adjacent = !date.startsWith(month);
  item.setAttribute('aria-pressed', date === selected);
  if (date === today) item.setAttribute('aria-current', 'date');
  item.querySelector('.history-day-date').textContent = (date === today ? 'Hoy · ' : '') + capitalized(dayTitle.format(asDate(date)));
  const net = item.querySelector('.history-day-net');
  if (date > today && !totals) net.textContent = '—';
  else showNet(net, totals?.netCents ?? 0);
  item.querySelector('.history-day-ads').hidden = date > today || Boolean(totals?.adRecorded);
  item.addEventListener('click', () => {
    $('calendar-dialog').close();
    selectDay(date);
    $('day-title').focus({ preventScroll: true });
    $('day-title').scrollIntoView({ block: 'start' });
  });
  return item;
}

function drawHistory() {
  const container = $('history-weeks');
  const month = historyMonth.slice(0, 7);
  const next = changeMonth(historyMonth, 1);
  $('month-title').textContent = capitalized(monthTitle.format(asDate(historyMonth)));
  $('week-title').textContent = 'Semana ' + weekRange(historyWeek);
  let total = 0;
  for (const [date, day] of daily) {
    if (date.startsWith(month)) total += day.netCents;
  }
  showNet($('month-net'), total);

  const weeks = [];
  for (let start = monday(historyMonth); start < next; start = shift(start, 7)) {
    const week = $('history-week-template').content.firstElementChild.cloneNode(true);
    week.dataset.week = start;
    week.open = start === historyWeek;
    const dates = Array.from({ length: 7 }, (_, index) => shift(start, index));
    const range = weekRange(start);
    week.querySelector('.week-dates').textContent = range;
    week.addEventListener('toggle', () => {
      if (week.open && week.isConnected) {
        historyWeek = start;
        $('week-title').textContent = 'Semana ' + range;
      }
    });
    showNet(week.querySelector('.week-net'), dates.reduce((sum, date) => sum + (daily.get(date)?.netCents ?? 0), 0));
    week.querySelector('.history-days').append(...dates.map(date => historyDay(date, month)));
    weeks.push(week);
  }
  container.replaceChildren(...weeks);
}

function moveMonth(direction) {
  historyMonth = changeMonth(historyMonth, direction);
  const preferred = selected.startsWith(historyMonth.slice(0, 7)) ? selected : shift(changeMonth(historyMonth, 1), -1);
  historyWeek = monday(preferred);
  drawHistory();
}

function moveWeek(direction) {
  historyWeek = shift(historyWeek, direction * 7);
  const end = shift(historyWeek, 6);
  if (end < historyMonth) historyMonth = end.slice(0, 7) + '-01';
  if (historyWeek >= changeMonth(historyMonth, 1)) historyMonth = historyWeek.slice(0, 7) + '-01';
  drawHistory();
}

function status(state, label) {
  $('sync').dataset.state = state;
  $('sync').lastElementChild.textContent = label;
}

function empty(title, description) {
  $('sales').hidden = true;
  $('count').hidden = true;
  $('empty-title').textContent = title;
  $('empty-copy').textContent = description;
  $('empty-sales').hidden = false;
}

function formatSaleTime(time) {
  const [hour, minutes] = time.split(':');
  if (!minutes) return time;
  const hours = Number(hour);
  return (hours % 12 || 12) + ':' + minutes + (hours < 12 ? ' a. m.' : ' p. m.');
}

function renderSummary(day) {
  const gross = day.sales.reduce((sum, sale) => sum + sale.cents, 0);
  $('gross').textContent = money(gross);
  $('ads').textContent = day.adRecorded ? '−' + money(day.adCents) : '—';
  $('net').textContent = money(gross - day.adCents);
  $('net').dataset.negative = gross < day.adCents;
  $('ads-reminder-text').textContent = day.date === today
    ? 'Falta poner el monto de publicidad de hoy.'
    : 'Falta poner el monto de publicidad de este día.';
  $('ads-reminder').hidden = day.adRecorded || day.date > today;
  if (!day.sales.length) {
    empty('Aún no hay ventas', 'Registra un cobro de Yape o Plin con Nueva venta.');
    return;
  }
  const list = day.sales.map(sale => {
    const item = document.createElement('li');
    item.className = 'sale-row';
    const icon = document.createElement('img');
    icon.src = sale.method === 'Plin' ? './assets/plin.png' : './assets/yape.png';
    icon.alt = '';
    icon.width = icon.height = 38;
    const copy = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = sale.course;
    const meta = document.createElement('span');
    meta.className = 'sale-meta';
    meta.textContent = [sale.method, formatSaleTime(sale.time), sale.promotion ? 'Promoción' : ''].filter(Boolean).join(' · ');
    copy.append(name, meta);
    const amount = document.createElement('strong');
    amount.textContent = money(sale.cents);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'sale-edit';
    edit.setAttribute('aria-label', 'Editar venta de ' + sale.course + ', ' + meta.textContent + ', ' + amount.textContent);
    const editLabel = document.createElement('span');
    editLabel.textContent = 'Editar';
    edit.append(amount, editLabel);
    edit.addEventListener('click', () => openSaleEdit(sale, day.date));
    item.append(icon, copy, edit);
    return item;
  });
  $('sales').replaceChildren(...list);
  $('sales').hidden = false;
  $('empty-sales').hidden = true;
  $('count').textContent = day.sales.length + (day.sales.length === 1 ? ' venta' : ' ventas');
  $('count').hidden = false;
}

async function api(query = '', body) {
  let response;
  try {
    response = await fetch('/api/caja' + query, {
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Se perdió la conexión. Intenta nuevamente.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Ocurrió un error. Intenta nuevamente.');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function selectDay(date) {
  selected = date;
  drawDayHeading();
  drawDayStrip();
  const version = ++loadVersion;
  loaded = null;
  $('load-error').hidden = true;
  $('ads-reminder').hidden = true;
  $('edit-ads').disabled = true;
  $('open-calendar').disabled = true;
  $('new-sale').disabled = true;
  $('gross').textContent = $('ads').textContent = $('net').textContent = '—';
  $('net').dataset.negative = false;
  if (filePreview) {
    $('file-preview').hidden = false;
    $('new-sale').disabled = false;
    empty('Ventas del día', 'Abre la app para consultar los datos de Google Sheets.');
    status('loading', 'Vista previa');
    return;
  }
  empty('Cargando ventas', 'Consultando Google Sheets…');
  status('loading', 'Conectando');
  try {
    const day = await api('?date=' + date);
    if (version !== loadVersion) return;
    loaded = day;
    daily = new Map(day.daily.map(totals => [totals.date, totals]));
    const wasHidden = $('dashboard').hidden;
    $('locked').hidden = true;
    $('dashboard').hidden = false;
    $('edit-ads').disabled = false;
    $('open-calendar').disabled = false;
    $('new-sale').disabled = false;
    drawDayStrip(wasHidden);
    renderSummary(day);
    status('ready', 'En línea');
    void initPush();
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) {
      $('dashboard').hidden = true;
      $('locked').hidden = false;
      status('loading', 'Acceso privado');
      $('password').focus();
      return;
    }
    $('load-error-text').textContent = error.message;
    $('load-error').hidden = false;
    $('new-sale').disabled = false;
    empty('Ventas sin consultar', 'Vuelve a intentar para ver los movimientos del día.');
    const label = error.status === 503 ? 'Falta configurar' : error.status ? 'Error de conexión' : 'Sin conexión';
    status('error', label);
  }
}

function showError(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').hidden = false;
  $('toast').textContent = message;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}

function updatePush(message = '') {
  $('push-toggle').hidden = !push.registration;
  $('push-toggle').textContent = push.enabled ? 'Desactivar aviso' : 'Activar aviso';
  $('push-test').hidden = !push.enabled;
  $('push-status').textContent = message || (push.enabled
    ? 'Activo en este dispositivo. Recibirás tu cierre a las 12:00 a. m., hora de Lima.'
    : 'Recibe tu ganancia neta del día a las 12:00 a. m., hora de Lima.');
}

async function initPush() {
  if (push.started || location.protocol !== 'https:' ||
      !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  push.started = true;
  try {
    const { publicKey } = await api('?action=push');
    if (!publicKey) return;
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    push.subscription = await registration.pushManager.getSubscription();
    if (push.subscription) {
      const status = await api('?action=push', { operation: 'status', endpoint: push.subscription.endpoint });
      push.enabled = status.enabled;
    }
    push.publicKey = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    push.registration = registration;
    updatePush();
    $('push-panel').hidden = false;
    void refreshReviewPush();
  } catch {
    push.started = false;
  }
}

$('push-toggle').addEventListener('click', async () => {
  $('push-toggle').disabled = $('push-test').disabled = true;
  try {
    if (push.enabled) {
      await api('?action=push', { operation: 'off', endpoint: push.subscription.endpoint });
      push.enabled = false;
    } else {
      push.subscription ||= await push.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: push.publicKey,
      });
      await api('?action=push', { operation: 'on', subscription: push.subscription.toJSON() });
      push.enabled = true;
    }
    updatePush();
  } catch (error) {
    updatePush(Notification.permission === 'denied'
      ? 'Permite las notificaciones de DigPro en los ajustes del dispositivo.'
      : error.message || 'No se pudo cambiar el aviso. Intenta otra vez.');
  } finally {
    $('push-toggle').disabled = $('push-test').disabled = false;
  }
});

$('push-test').addEventListener('click', async () => {
  $('push-toggle').disabled = $('push-test').disabled = true;
  try {
    await api('?action=push', { operation: 'test', endpoint: push.subscription.endpoint });
    notify('Aviso de prueba enviado.');
  } catch (error) {
    if (error.status === 410) {
      await push.subscription.unsubscribe().catch(() => {});
      push.subscription = null;
      push.enabled = reviewPushEnabled = false;
      updateReviewPush();
    }
    updatePush(error.message);
  } finally {
    $('push-toggle').disabled = $('push-test').disabled = false;
  }
});

function updatePrices() {
  const promo = saleForm.elements.promotion.checked ? 1 : 0;
  $('rituales-price').textContent = money(prices.Rituales[promo]);
  $('cocteles-price').textContent = money(prices['Cócteles'][promo]);
  const course = saleForm.elements.course.value;
  if (course) $('price').value = (prices[course][promo] / 100).toFixed(2);
}

function parseCents(value) {
  const amount = value.trim().replace(',', '.');
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [soles, decimal = ''] = amount.split('.');
  return Number(soles) * 100 + Number(decimal.padEnd(2, '0'));
}

function setBusy(form, busy) {
  form.dataset.busy = busy;
  for (const control of form.elements) control.disabled = busy;
}

async function save(form, data, errorId, message) {
  if (form.dataset.busy === 'true') return;
  if (!Object.hasOwn(data, 'id')) {
    const key = JSON.stringify(data);
    if (pending.get(form)?.key !== key) pending.set(form, { key, id: crypto.randomUUID() });
    data = { ...data, id: pending.get(form).id };
  }
  setBusy(form, true);
  showError(errorId);
  try {
    await api('', data);
    pending.delete(form);
    form.closest('dialog').close();
    notify(message);
    selectDay(data.date);
  } catch (error) {
    showError(errorId, error.message);
  } finally {
    setBusy(form, false);
  }
}

function showDeleteConfirmation(confirming) {
  $('sale-edit-fields').hidden = confirming;
  $('sale-delete-confirmation').hidden = !confirming;
  showError('sale-edit-error');
}

function openSaleEdit(sale, date) {
  editingSale = { id: sale.id, date };
  $('sale-edit-summary').textContent = [sale.course, sale.method, formatSaleTime(sale.time), money(sale.cents)].join(' · ');
  $('sale-edit-price').value = (sale.cents / 100).toFixed(2);
  showDeleteConfirmation(false);
  $('sale-edit-dialog').showModal();
}

$('start-sale-delete').addEventListener('click', () => {
  showDeleteConfirmation(true);
  $('cancel-sale-delete').focus();
});
$('cancel-sale-delete').addEventListener('click', () => {
  showDeleteConfirmation(false);
  $('start-sale-delete').focus();
});
saleEditForm.addEventListener('submit', event => {
  event.preventDefault();
  if (event.submitter?.value === 'delete') {
    save(saleEditForm, { ...editingSale, kind: 'delete-sale' }, 'sale-edit-error', 'Venta eliminada.');
    return;
  }
  const price = $('sale-edit-price');
  const cents = parseCents(price.value);
  if (!cents) {
    showError('sale-edit-error', 'Ingresa un pago mayor que cero con hasta dos decimales.');
    price.focus();
    return;
  }
  save(saleEditForm, { ...editingSale, kind: 'update-sale', cents }, 'sale-edit-error', 'Precio actualizado en Google Sheets.');
});

$('previous').addEventListener('click', () => selectDay(shift(selected, -1)));
$('next').addEventListener('click', () => selectDay(shift(selected, 1)));
dayStrip.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const adjacent = event.key === 'ArrowLeft' ? event.target.previousElementSibling : event.target.nextElementSibling;
  if (!adjacent) return;
  event.preventDefault();
  adjacent.focus();
});
dayStrip.addEventListener('scroll', () => {
  const first = dayStrip.firstElementChild;
  if (!first || !dayStrip.clientWidth) return;
  const dayWidth = first.getBoundingClientRect().width;
  if (dayStrip.scrollLeft < dayWidth) {
    const left = first.getBoundingClientRect().left;
    dayStrip.prepend(...makeDayButtons(first.dataset.date, -dayStripBatch, dayStripBatch));
    dayStrip.scrollLeft += first.getBoundingClientRect().left - left;
  }
  if (dayStrip.scrollWidth - dayStrip.clientWidth - dayStrip.scrollLeft < dayWidth) {
    const last = dayStrip.lastElementChild;
    dayStrip.append(...makeDayButtons(last.dataset.date, 1, dayStripBatch));
  }
}, { passive: true });
$('retry').addEventListener('click', () => selectDay(selected));
$('open-calendar').addEventListener('click', () => {
  historyMonth = selected.slice(0, 7) + '-01';
  historyWeek = monday(selected);
  drawHistory();
  $('calendar-dialog').showModal();
});
$('previous-month').addEventListener('click', () => moveMonth(-1));
$('next-month').addEventListener('click', () => moveMonth(1));
$('previous-week').addEventListener('click', () => moveWeek(-1));
$('next-week').addEventListener('click', () => moveWeek(1));
$('back-today').addEventListener('click', () => {
  $('calendar-dialog').close();
  selectDay(today);
});
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (dialog.querySelector('[data-busy="true"]')) event.preventDefault();
  });
}

$('new-sale').addEventListener('click', () => {
  saleForm.reset();
  pending.delete(saleForm);
  const now = limaNow();
  $('sale-date').value = selected;
  $('sale-time').value = now.time;
  updatePrices();
  saleForm.querySelector('[type="submit"]').disabled = filePreview;
  showError('sale-error', filePreview ? 'Para guardar, abre la app con Abrir Caja diaria.cmd.' : '');
  $('sale-dialog').showModal();
});
saleForm.addEventListener('change', event => {
  if (['course', 'promotion'].includes(event.target.name)) updatePrices();
});
saleForm.addEventListener('submit', event => {
  event.preventDefault();
  if (filePreview) return;
  const values = new FormData(saleForm);
  const cents = parseCents(values.get('price'));
  if (!cents) {
    showError('sale-error', 'Ingresa un pago mayor que cero con hasta dos decimales.');
    $('price').focus();
    return;
  }
  save(saleForm, {
    kind: 'sale', date: values.get('date'), time: values.get('time'),
    method: values.get('method'), course: values.get('course'), promotion: values.has('promotion'), cents,
  }, 'sale-error', 'Venta guardada en Google Sheets.');
});

function openAds() {
  if (!loaded) return;
  adsForm.dataset.date = selected;
  $('ads-date').textContent = fullDate.format(asDate(selected));
  $('ad-price').value = loaded.adRecorded ? (loaded.adCents / 100).toFixed(2) : '';
  pending.delete(adsForm);
  showError('ads-error');
  $('ads-dialog').showModal();
}
$('edit-ads').addEventListener('click', openAds);
$('add-ads').addEventListener('click', openAds);
adsForm.addEventListener('submit', event => {
  event.preventDefault();
  const cents = parseCents($('ad-price').value);
  if (cents === null) {
    showError('ads-error', 'Ingresa cero o un monto con hasta dos decimales.');
    $('ad-price').focus();
    return;
  }
  save(adsForm, { kind: 'ads', date: adsForm.dataset.date, cents }, 'ads-error', 'Publicidad actualizada.');
});

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  showError('login-error');
  const password = $('password').value;
  setBusy(form, true);
  try {
    await api('?action=login', { password });
    form.reset();
    $('locked').hidden = true;
    $('dashboard').hidden = false;
    selectDay(selected);
  } catch (error) {
    showError('login-error', error.message);
  } finally {
    setBusy(form, false);
    if (!$('locked').hidden) $('password').focus();
  }
});

function updateToday() {
  if (document.hidden || !$('locked').hidden || document.querySelector('dialog[open]')) return;
  const date = limaNow().date;
  if (today === date) return;
  const followToday = selected === today;
  today = date;
  if (followToday) selectDay(today);
  else {
    drawDayHeading();
    drawDayStrip(false);
    if (loaded) {
      renderSummary(loaded);
    }
  }
}

const whatsappToggle = $('whatsapp-toggle');
const whatsappLink = $('whatsapp-link');
let whatsappBusy = false;
let whatsappAvailable = true;
let whatsappLinked = false;
let nextWhatsAppRefresh = 0;
let reviewPushEnabled = false;
let reviewPushBusy = false;
let reviewFetch = 0;
let reviewing;
const reviewDate = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });
const reviewLink = new URLSearchParams(location.search).get('por-confirmar');
const reviewDraft = 'Hola 😊 Espera un momento, por favor. Voy a verificar tu pago.';
const saleSound = new Audio('./assets/venta-confirmada.mp3?v=2');
const saleSoundStatus = $('sale-sound-status');
const saleSoundDescription = saleSoundStatus.textContent;
const playedSales = new Set();
let soundEnabled = false;
try { soundEnabled = localStorage.getItem('digpro-sale-sound') === 'on'; } catch { /* Storage can be unavailable. */ }

async function whatsappRequest(action = '', body) {
  const response = await fetch('/api/whatsapp' + (action ? '?action=' + action : ''), {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'No se pudo consultar WhatsApp.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function updateReviewPush(message = '') {
  $('review-push-toggle').hidden = !push.registration || !whatsappLinked;
  $('review-push-toggle').textContent = reviewPushEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones';
  $('review-push-test').hidden = !reviewPushEnabled || !whatsappLinked;
  $('review-push-status').textContent = message || (!whatsappLinked
    ? 'Vincula este dispositivo en Ajustes → WhatsApp automático para activar los avisos de ventas.'
    : !push.registration ? 'Abre DigPro desde la pantalla de inicio del iPhone para recibir notificaciones.'
    : reviewPushEnabled ? 'Avisos de comprobantes y ventas activos en este dispositivo.'
    : 'Activa los avisos de comprobantes por revisar y ventas confirmadas.');
}

async function refreshReviewPush() {
  if (reviewPushBusy || !push.registration || !whatsappLinked) return;
  if (push.subscription) {
    try {
      const { enabled } = await whatsappRequest('review-push', { operation: 'status', endpoint: push.subscription.endpoint });
      reviewPushEnabled = enabled;
    } catch (error) {
      updateReviewPush(error.message);
      return;
    }
  }
  updateReviewPush();
}

async function changeReviewPush(test = false) {
  if (reviewPushBusy || !whatsappLinked || !push.registration) return;
  reviewPushBusy = true;
  $('review-push-toggle').disabled = $('review-push-test').disabled = true;
  try {
    if (test) {
      await whatsappRequest('review-push', { operation: 'test', endpoint: push.subscription.endpoint });
      notify('Notificación de prueba enviada.');
    } else if (reviewPushEnabled) {
      await whatsappRequest('review-push', { operation: 'off', endpoint: push.subscription.endpoint });
      reviewPushEnabled = false;
    } else {
      push.subscription ||= await push.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: push.publicKey });
      await whatsappRequest('review-push', { operation: 'on', subscription: push.subscription.toJSON() });
      reviewPushEnabled = true;
    }
    updateReviewPush();
  } catch (error) {
    if (error.status === 410) {
      await push.subscription?.unsubscribe().catch(() => {});
      push.subscription = null;
      reviewPushEnabled = push.enabled = false;
      updatePush();
    }
    updateReviewPush(Notification.permission === 'denied'
      ? 'Permite las notificaciones de DigPro en los ajustes del iPhone.' : error.message);
  } finally {
    $('review-push-toggle').disabled = $('review-push-test').disabled = false;
    reviewPushBusy = false;
  }
}

function updateSaleSound() {
  $('sale-sound-toggle').textContent = soundEnabled ? 'Desactivar sonido' : 'Activar y probar sonido';
  $('sale-sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  $('sale-sound-test').hidden = !soundEnabled;
}

function playSaleSound() {
  saleSound.currentTime = 0;
  return saleSound.play();
}

function playSaleOnce(id) {
  if (!soundEnabled || document.hidden || playedSales.has(id)) return;
  playedSales.add(id);
  void playSaleSound().catch(() => playedSales.delete(id));
}

async function testSaleSound() {
  saleSoundStatus.textContent = saleSoundDescription;
  try {
    await playSaleSound();
    return true;
  } catch {
    saleSoundStatus.textContent = 'El navegador no pudo reproducir el sonido. Toca el botón para probar de nuevo.';
    return false;
  }
}

$('sale-sound-toggle').addEventListener('click', async () => {
  if (soundEnabled) {
    soundEnabled = false;
    saleSound.pause();
    saleSoundStatus.textContent = saleSoundDescription;
  } else {
    soundEnabled = await testSaleSound();
  }
  try { localStorage.setItem('digpro-sale-sound', soundEnabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
  updateSaleSound();
});
$('sale-sound-test').addEventListener('click', () => void testSaleSound());
updateSaleSound();

$('open-settings').addEventListener('click', () => {
  $('settings-dialog').showModal();
  updateReviewPush();
  void refreshWhatsApp();
  void initPush();
  void refreshReviewPush();
});
$('review-push-toggle').addEventListener('click', () => changeReviewPush());
$('review-push-test').addEventListener('click', () => changeReviewPush(true));

function openReview(receipt) {
  reviewing = receipt;
  $('review-customer').textContent = 'Cliente +' + receipt.phone;
  $('review-course').value = receipt.course || '';
  $('review-form').elements.method.value = 'Yape';
  $('review-amount').value = receipt.cents ? (receipt.cents / 100).toFixed(2) : '';
  $('review-delivered').checked = receipt.alreadyDelivered === true;
  updateReviewDelivery();
  showError('review-error');
  $('review-dialog').showModal();
}

function updateReviewDelivery() {
  $('review-form').querySelector('[type="submit"]').lastChild.textContent = $('review-delivered').checked
    ? 'Registrar venta sin reenviar' : 'Confirmar y enviar curso';
}
$('review-delivered').addEventListener('change', updateReviewDelivery);
$('review-course').addEventListener('change', () => {
  if (reviewing?.alreadyDelivered) {
    $('review-delivered').checked = $('review-course').value === reviewing.course;
    updateReviewDelivery();
  }
});

function renderReviews(receipts, message = '') {
  $('review-count').textContent = receipts.length;
  $('review-count').hidden = receipts.length === 0;
  $('review-list').hidden = receipts.length === 0;
  $('review-status').hidden = receipts.length > 0;
  $('review-status').textContent = message || 'No hay pagos por confirmar.';
  const entries = receipts.map(receipt => {
    const row = document.createElement('li');
    row.className = 'review-item';
    if (receipt.id === reviewLink) row.tabIndex = -1;
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = 'Cliente +' + receipt.phone;
    const details = document.createElement('p');
    details.textContent = [receipt.course || 'Curso por identificar', receipt.cents ? money(receipt.cents) : 'Monto por revisar',
      reviewDate.format(new Date(receipt.receivedAt)), ...(receipt.alreadyDelivered ? ['Curso ya enviado'] : [])].join(' · ');
    info.append(name, details);
    const link = document.createElement('a');
    link.className = 'text-button';
    link.textContent = 'Ver pago';
    link.href = 'https://wa.me/' + receipt.phone + '?text=' + encodeURIComponent(reviewDraft);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'icon-button';
    check.setAttribute('aria-label', 'Confirmar pago de +' + receipt.phone);
    check.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
    check.addEventListener('click', () => openReview(receipt));
    row.append(info, link, check);
    return row;
  });
  $('review-list').replaceChildren(...entries);
}

async function refreshReviews() {
  const version = ++reviewFetch;
  if (!whatsappLinked) {
    renderReviews([], 'Vincula este dispositivo en Ajustes → WhatsApp automático para revisar pagos.');
    return;
  }
  try {
    const { pending: receipts } = await whatsappRequest('reviews');
    if (version === reviewFetch) renderReviews(receipts);
  } catch (error) {
    if (version === reviewFetch) renderReviews([], error.message);
  }
}

function showReviewView(open) {
  $('show-sales').setAttribute('aria-pressed', String(!open));
  $('show-reviews').setAttribute('aria-pressed', String(open));
  $('current-sales').hidden = open;
  $('pending-sales').hidden = !open;
  if (open) void refreshReviews();
}
$('show-sales').addEventListener('click', () => showReviewView(false));
$('show-reviews').addEventListener('click', () => showReviewView(true));

$('review-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.dataset.busy === 'true' || !reviewing) return;
  const cents = parseCents($('review-amount').value);
  if (!cents) { showError('review-error', 'Ingresa un monto mayor que cero.'); return; }
  const { id } = reviewing;
  const method = form.elements.method.value;
  const course = $('review-course').value;
  const alreadyDelivered = $('review-delivered').checked;
  setBusy(form, true);
  showError('review-error');
  try {
    const { date, delivery } = await whatsappRequest('confirm', { id, method, course, cents, alreadyDelivered });
    $('review-dialog').close();
    notify(delivery === 'queued' ? 'Venta registrada. Envío del curso en cola para WhatsApp.'
      : delivery === 'sent' || delivery === 'manual' ? 'Venta registrada. El curso ya se envió por WhatsApp.' : 'Venta confirmada y registrada.');
    playSaleOnce(id);
    await refreshReviews();
    await selectDay(date || selected);
  } catch (error) {
    showError('review-error', error.message);
  } finally {
    setBusy(form, false);
  }
});

navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'sale') {
    playSaleOnce(event.data.id);
    if (!document.hidden) void selectDay(selected);
  }
  if (event.data?.type === 'sale' || event.data?.type === 'review') void refreshReviews();
});

async function refreshWhatsApp() {
  if (whatsappBusy || !whatsappAvailable || document.hidden || location.protocol === 'file:') return;
  whatsappBusy = true;
  try {
    const { desired, applied, connected } = await whatsappRequest();
    const wasLinked = whatsappLinked;
    whatsappLinked = true;
    $('whatsapp-panel').hidden = false;
    $('whatsapp-control').hidden = false;
    $('whatsapp-offers').hidden = false;
    whatsappLink.hidden = true;
    whatsappToggle.checked = desired;
    whatsappToggle.disabled = !connected || desired !== applied;
    nextWhatsAppRefresh = Date.now() + (connected && desired !== applied ? 5000 : 30000);
    $('whatsapp-status').textContent = !connected ? 'Esperando conexión del servidor.' : desired !== applied
      ? 'Aplicando el cambio en el servidor…' : desired ? 'Respuestas automáticas activas' : 'Respuestas manuales';
    void refreshReviews();
    if (!wasLinked) void refreshReviewPush();
  } catch (error) {
    if (error.status === 401) {
      whatsappLinked = false;
      void refreshReviews();
      updateReviewPush();
      $('whatsapp-panel').hidden = false;
      $('whatsapp-control').hidden = true;
      $('whatsapp-offers').hidden = true;
      whatsappLink.hidden = false;
      $('whatsapp-status').textContent = 'Vincula este dispositivo para controlar WhatsApp.';
    } else if ([404, 503].includes(error.status)) {
      whatsappAvailable = false;
      $('whatsapp-panel').hidden = true;
    } else {
      whatsappToggle.disabled = true;
      $('whatsapp-status').textContent = 'No se pudo consultar el servidor de WhatsApp.';
    }
  } finally {
    whatsappBusy = false;
  }
}

whatsappToggle.addEventListener('change', async () => {
  if (whatsappBusy) {
    whatsappToggle.checked = !whatsappToggle.checked;
    return;
  }
  whatsappBusy = true;
  whatsappToggle.disabled = true;
  try {
    await whatsappRequest('mode', { enabled: whatsappToggle.checked });
  } catch (error) {
    whatsappToggle.checked = !whatsappToggle.checked;
    $('whatsapp-status').textContent = error.message;
    whatsappToggle.disabled = false;
    return;
  } finally {
    whatsappBusy = false;
  }
  await refreshWhatsApp();
});

whatsappLink.addEventListener('submit', async event => {
  event.preventDefault();
  if (whatsappBusy) return;
  whatsappBusy = true;
  const submit = whatsappLink.querySelector('button');
  submit.disabled = true;
  try {
    await whatsappRequest('link', { code: $('whatsapp-code').value.trim() });
    whatsappLink.reset();
  } catch (error) {
    $('whatsapp-status').textContent = error.message;
    return;
  } finally {
    submit.disabled = false;
    whatsappBusy = false;
  }
  await refreshWhatsApp();
});

document.addEventListener('visibilitychange', updateToday);
document.addEventListener('visibilitychange', refreshWhatsApp);
setInterval(updateToday, 30000);
setInterval(() => { if (whatsappLink.hidden && Date.now() >= nextWhatsAppRefresh) refreshWhatsApp(); }, 5000);
selectDay(selected);
refreshWhatsApp();
if (reviewLink) showReviewView(true);
