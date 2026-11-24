import { readRows, appendRows, prepareSheets, readNodosControl, writeNodosMode, writeNodosHeartbeat } from './sheets.mjs';
export const validNodosId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const validNodosMode = value => ['nodos', 'paused', 'courses'].includes(value);
export function validNodosCommand(value) {
  const time = Date.parse(value?.requestedAt);
  return validNodosId(value?.id) && validNodosId(value.clientId) && ['pause', 'resume', 'enroll', 'reviewed'].includes(value.action)
    && Number.isFinite(time) && time >= Date.now() - 86400_000 && time <= Date.now() + 30_000;
}
const stages = ['inquiry', 'collecting', 'manual', 'legacy', 'opted_out', 'review', 'ready', 'reviewed'];
export function validNodosClient(value) {
  return validNodosId(value?.id) && /^[1-9]\d{9,14}$/.test(value.phone) && stages.includes(value.stage)
    && ['paused', 'optedOut', 'legacy', 'confirmed', 'teamPalette'].every(key => typeof value[key] === 'boolean')
    && ['businessName', 'colors', 'summary', 'folder'].every(key => typeof value[key] === 'string' && value[key].length <= 800)
    && ['version', 'fileVersion', 'syncedVersion'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && value.version > 0 && value.fileVersion > 0 && Number.isFinite(Date.parse(value.updatedAt))
    && (value.logoId === null || validNodosId(value.logoId))
    && Array.isArray(value.reviewNotes) && value.reviewNotes.length <= 30 && value.reviewNotes.every(note => typeof note === 'string' && note.length <= 240)
    && Array.isArray(value.missing) && value.missing.every(item => ['confirmation', 'name', 'logo', 'colors'].includes(item))
    && Array.isArray(value.assets) && value.assets.length <= 100 && value.assets.every(asset => validNodosId(asset.id)
      && asset.file === asset.id + '.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[asset.mime]
      && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 10 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(asset.sha256));
}
let ready;
async function prepare() {
  ready ||= prepareSheets(['nodosControl', 'nodos', 'nodosCommands']).catch(error => { ready = undefined; throw error; });
  await ready;
}
export function createNodosLedger(io = { readRows, appendRows, prepare, readNodosControl, writeNodosMode, writeNodosHeartbeat }) {
  const parse = text => { try { return JSON.parse(text); } catch { return null; } };
  async function clients() {
    const latest = new Map();
    for (const [, id, json] of await io.readRows('nodos')) {
      const value = parse(json);
      if (validNodosClient(value) && value.id === id && (!latest.has(id) || latest.get(id).version < value.version)) latest.set(id, value);
    }
    return [...latest.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function pending(existing) {
    const rows = existing || await io.readRows('nodosCommands');
    const done = new Set(rows.filter(([, action]) => action === 'result').map(([, , json]) => parse(json)?.id));
    return rows.filter(([, action]) => action !== 'result').map(([, , json]) => parse(json))
      .filter(command => validNodosCommand(command) && !done.has(command.id)).slice(0, 20);
  }
  return {
    async overview() {
      await io.prepare();
      const rows = await io.readRows('nodosCommands');
      const results = rows.filter(([, action]) => action === 'result').slice(-20).reverse().map(([, , json]) => parse(json))
        .filter(result => validNodosId(result?.id)).map(result => ({ ...result, clientId: parse(rows.find(([id]) => id === result.id)?.[2])?.clientId }));
      return { control: await io.readNodosControl(), clients: await clients(), commands: await pending(rows), results };
    },
    async mode(mode) { if (!validNodosMode(mode)) throw new TypeError('Modo no válido'); await io.prepare(); await io.writeNodosMode(mode); },
    async command(command) {
      if (!validNodosCommand(command)) throw new TypeError('Orden no válida');
      await io.prepare();
      if (!(await clients()).some(client => client.id === command.clientId)) return false;
      const rows = await io.readRows('nodosCommands');
      if (!rows.some(([id]) => id === command.id)) await io.appendRows('nodosCommands', [[command.id, command.action, JSON.stringify(command), command.requestedAt]]);
      return true;
    },
    async sync(business) {
      if (!validNodosMode(business?.appliedMode) || !Array.isArray(business.updates) || business.updates.length > 5
        || business.updates.some(value => !validNodosClient(value)) || !Array.isArray(business.commandAcks) || business.commandAcks.length > 20
        || business.commandAcks.some(ack => !validNodosId(ack?.id) || typeof ack.ok !== 'boolean' || !(ack.error === null || typeof ack.error === 'string' && ack.error.length <= 300))) throw new TypeError('Sincronización no válida');
      await io.prepare();
      const rows = business.updates.length ? await io.readRows('nodos') : [];
      const ids = new Set(rows.map(([id]) => id));
      const updates = business.updates.filter(value => !ids.has(value.id + ':' + value.version))
        .map(value => [value.id + ':' + value.version, value.id, JSON.stringify(value), value.updatedAt]);
      if (updates.length) await io.appendRows('nodos', updates);
      if (business.commandAcks.length) {
        const commands = await io.readRows('nodosCommands');
        const results = business.commandAcks.filter(ack => commands.some(([id]) => id === ack.id) && !commands.some(([id]) => id === ack.id + ':result'))
          .map(ack => [ack.id + ':result', 'result', JSON.stringify(ack), new Date().toISOString()]);
        if (results.length) await io.appendRows('nodosCommands', results);
      }
      await io.writeNodosHeartbeat(business.appliedMode);
      return { ...(await io.readNodosControl()), commands: await pending() };
    },
  };
}
export const nodosLedger = createNodosLedger();
