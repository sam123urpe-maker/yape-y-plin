import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';

const spreadsheet = process.env.SHEETS_ID || '1fdFgdntMbLI7Vp2a8kgjuJij5mL8AWw0CM9ztEBeEDk';
const endpoint = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheet);
const tabs = {
  sales: { title: 'App - Ventas', columns: 'G', headers: ['ID', 'Fecha (Lima)', 'Hora (Lima)', 'Medio de pago', 'Curso', 'Promoción', 'Monto (PEN)'] },
  ads: { title: 'App - Publicidad', columns: 'D', headers: ['ID', 'Fecha (Lima)', 'Monto (PEN)', 'Registro (UTC)'] },
  push: { title: 'App - Avisos', columns: 'E', headers: ['ID', 'Evento', 'Dispositivo', 'Datos', 'Fecha de cierre'], hidden: true },
};
let client;

async function credentials() {
  const source = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (source) return JSON.parse(source);
  if (!process.env.VERCEL && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const contents = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
    return JSON.parse(contents.replace(/^\uFEFF/, ''));
  }
  throw new Error('Faltan las credenciales de Google Sheets.');
}

async function request(path = '', method = 'GET', data) {
  if (!client) {
    const { type, client_email, private_key } = await credentials();
    if (type !== 'service_account' || !client_email || !private_key) {
      throw new Error('El JSON debe pertenecer a una cuenta de servicio.');
    }
    client = new JWT({ email: client_email, key: private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  const result = await client.request({ url: endpoint + path, method, data, timeout: 15000, retry: false });
  return result.data;
}

function range(tab) {
  return "'" + tab.title + "'!A1:" + tab.columns;
}

export async function prepareSheets() {
  const info = await request('?fields=sheets(properties(sheetId,title))');
  for (const tab of Object.values(tabs)) {
    if (info.sheets.some(({ properties }) => properties.title === tab.title)) {
      const data = await request('/values/' + encodeURIComponent(range(tab) + '1'));
      if (JSON.stringify(data.values?.[0]) !== JSON.stringify(tab.headers)) {
        throw new Error('Encabezados inesperados en ' + tab.title + '.');
      }
      continue;
    }
    const used = new Set(info.sheets.map(({ properties }) => properties.sheetId));
    let sheetId = 1000;
    while (used.has(sheetId)) sheetId++;
    await request(':batchUpdate', 'POST', { requests: [
      { addSheet: { properties: { sheetId, title: tab.title, hidden: Boolean(tab.hidden), gridProperties: { frozenRowCount: 1 } } } },
      { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat',
        rows: [{ values: tab.headers.map(stringValue => ({
          userEnteredValue: { stringValue },
          userEnteredFormat: { backgroundColor: { red: 0.13, green: 0.13, blue: 0.25 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } },
        })) }],
      } },
    ] });
    info.sheets.push({ properties: { sheetId } });
  }
}

function records(values, tab) {
  const [header, ...rows] = values || [];
  if (JSON.stringify(header) !== JSON.stringify(tab.headers)) {
    throw new Error('Encabezados inesperados en ' + tab.title + '.');
  }
  const seen = new Set();
  return rows.filter(([id]) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function readDay(date) {
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  [tabs.sales, tabs.ads].forEach(tab => params.append('ranges', range(tab)));
  const { valueRanges } = await request('/values:batchGet?' + params);
  const sales = records(valueRanges[0]?.values, tabs.sales);
  const ads = records(valueRanges[1]?.values, tabs.ads);
  const daySales = sales.filter(row => row[1] === date).reverse().map(
    ([id, , time, method, course, promotion, amount]) => ({ id, time, method, course, promotion, cents: Math.round(amount * 100) }),
  ).sort((a, b) => b.time.localeCompare(a.time));
  const daily = new Map();
  for (const [, day, , , , , amount] of sales) {
    const totals = daily.get(day) || { grossCents: 0, adCents: 0, adRecorded: false };
    totals.grossCents += Math.round(amount * 100);
    daily.set(day, totals);
  }
  for (const [, day, amount] of ads) {
    const value = typeof amount === 'string' && amount.trim() ? Number(amount) : amount;
    if (!Number.isFinite(value)) continue;
    const totals = daily.get(day) || { grossCents: 0, adCents: 0, adRecorded: false };
    totals.adCents = Math.round(value * 100);
    totals.adRecorded = true;
    daily.set(day, totals);
  }
  return {
    date, sales: daySales,
    adCents: daily.get(date)?.adCents ?? 0,
    adRecorded: daily.get(date)?.adRecorded ?? false,
    dates: [...daily.keys()],
    daily: [...daily].map(([day, totals]) => ({
      date: day, netCents: totals.grossCents - totals.adCents, adRecorded: totals.adRecorded,
    })),
  };
}

export async function readRows(kind) {
  const tab = tabs[kind];
  const { values } = await request('/values/' + encodeURIComponent(range(tab)) + '?valueRenderOption=UNFORMATTED_VALUE');
  return records(values, tab);
}

export async function appendRows(kind, rows) {
  const table = encodeURIComponent(range(tabs[kind]));
  await request('/values/' + table + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', 'POST', { values: rows });
}

export async function appendOnce(kind, row) {
  if ((await readRows(kind)).some(([id]) => id === row[0])) return;
  await appendRows(kind, [row]);
}
