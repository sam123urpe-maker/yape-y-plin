'use strict';

const $ = id => document.getElementById(id);
const filePreview = location.protocol === 'file:';
const saleForm = $('sale-form');
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
const isDate = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) &&
  Number.isFinite(+asDate(requestedDay)) && asKey(asDate(requestedDay)) === requestedDay;
let selected = isDate ? requestedDay : today;
let historyMonth = selected.slice(0, 7) + '-01';
let loaded = null;
let daily = new Map();
let loadVersion = 0;
let toastTimer;
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

function drawDayStrip() {
  const strip = $('week-days');
  const focusedDate = strip.contains(document.activeElement) ? document.activeElement.dataset.date : null;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shift(selected, index - 3);
    const value = asDate(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.date = date;
    button.dataset.records = daily.has(date);
    button.setAttribute('aria-label', fullDate.format(value));
    button.setAttribute('aria-pressed', date === selected);
    if (date === today) button.setAttribute('aria-current', 'date');
    const label = document.createElement('small');
    label.textContent = weekday.format(value).slice(0, 3);
    const number = document.createElement('strong');
    number.textContent = value.getUTCDate();
    button.append(label, number, document.createElement('i'));
    button.addEventListener('click', () => selectDay(date));
    return button;
  });
  strip.replaceChildren(...days);
  if (focusedDate) days.find(button => button.dataset.date === focusedDate)?.focus();
}

function monday(date) {
  return shift(date, -((asDate(date).getUTCDay() + 6) % 7));
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
  let total = 0;
  for (const [date, day] of daily) {
    if (date.startsWith(month)) total += day.netCents;
  }
  showNet($('month-net'), total);

  const sameMonth = container.dataset.month === month;
  const openWeeks = new Set([...container.querySelectorAll('details[open]')].map(week => week.dataset.week));
  const preferredDay = selected.startsWith(month) ? selected : shift(next, -1);
  const preferredWeek = monday(preferredDay);
  const weeks = [];
  for (let start = monday(historyMonth); start < next; start = shift(start, 7)) {
    const week = $('history-week-template').content.firstElementChild.cloneNode(true);
    week.dataset.week = start;
    week.open = (sameMonth && openWeeks.has(start)) ||
      ((!sameMonth || container.dataset.selected !== selected) && start === preferredWeek);
    const dates = Array.from({ length: 7 }, (_, index) => shift(start, index));
    week.querySelector('.week-dates').textContent = shortDate.format(asDate(start)) + ' – ' + shortDate.format(asDate(dates[6]));
    showNet(week.querySelector('.week-net'), dates.reduce((sum, date) => sum + (daily.get(date)?.netCents ?? 0), 0));
    week.querySelector('.history-days').append(...dates.map(date => historyDay(date, month)));
    weeks.push(week);
  }
  container.dataset.month = month;
  container.dataset.selected = selected;
  container.replaceChildren(...weeks);
}

function moveMonth(direction) {
  historyMonth = changeMonth(historyMonth, direction);
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
    meta.textContent = [sale.method, sale.time, sale.promotion ? 'Promoción' : ''].filter(Boolean).join(' · ');
    copy.append(name, meta);
    const amount = document.createElement('strong');
    amount.textContent = money(sale.cents);
    item.append(icon, copy, amount);
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
    $('locked').hidden = true;
    $('dashboard').hidden = false;
    $('edit-ads').disabled = false;
    $('open-calendar').disabled = false;
    $('new-sale').disabled = false;
    drawDayStrip();
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
  if (push.started) return;
  push.started = true;
  $('push-panel').hidden = false;
  if (location.protocol !== 'https:') {
    updatePush('Disponible en DigPro cuando publiques la app.');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    updatePush('En iPhone, añade DigPro a la pantalla de inicio y ábrela desde su icono.');
    return;
  }
  try {
    const { publicKey } = await api('?action=push');
    if (!publicKey) {
      updatePush('El aviso de medianoche aún no está disponible.');
      return;
    }
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
  } catch {
    push.started = false;
    updatePush('No se pudo consultar el aviso. Vuelve a cargar DigPro.');
  }
}

$('push-toggle').addEventListener('click', async () => {
  $('push-toggle').disabled = $('push-test').disabled = true;
  try {
    if (push.enabled) {
      await api('?action=push', { operation: 'off', endpoint: push.subscription.endpoint });
      push.enabled = false;
      await push.subscription.unsubscribe().catch(() => {});
      push.subscription = null;
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
      push.enabled = false;
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
  const key = JSON.stringify(data);
  if (pending.get(form)?.key !== key) pending.set(form, { key, id: crypto.randomUUID() });
  setBusy(form, true);
  showError(errorId);
  try {
    await api('', { ...data, id: pending.get(form).id });
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

$('previous').addEventListener('click', () => selectDay(shift(selected, -1)));
$('next').addEventListener('click', () => selectDay(shift(selected, 1)));
$('retry').addEventListener('click', () => selectDay(selected));
$('open-calendar').addEventListener('click', () => {
  historyMonth = selected.slice(0, 7) + '-01';
  drawHistory();
  $('calendar-dialog').showModal();
});
$('previous-month').addEventListener('click', () => moveMonth(-1));
$('next-month').addEventListener('click', () => moveMonth(1));
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
    drawDayStrip();
    if (loaded) {
      renderSummary(loaded);
    }
  }
}
document.addEventListener('visibilitychange', updateToday);
setInterval(updateToday, 30000);
selectDay(selected);
