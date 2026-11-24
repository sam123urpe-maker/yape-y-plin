(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const stages = { inquiry: 'Consulta inicial', collecting: 'Datos por completar', manual: 'Atención manual', legacy: 'Cliente de Cursos · atención humana', opted_out: 'No contactar', review: 'Revisión necesaria', ready: 'Listo para revisar y preparar', reviewed: 'Revisado por el equipo' };
  const missing = { confirmation: 'autorización de propuesta', name: 'nombre del negocio', logo: 'logo en imagen', colors: 'colores o delegación al equipo' };
  let clients = [], selected, busy = false, pending = [];
  async function request(action = 'nodos', data) {
    const result = await fetch('/api/whatsapp' + (action ? '?action=' + action : ''), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(18000),
      ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    const body = await result.json();
    if (!result.ok) { const error = new Error(body.error || 'No se pudo completar la operación.'); error.status = result.status; throw error; }
    return body;
  }
  function notice(text) { $('notice').textContent = text; }
  function render() {
    const filter = $('filter').value;
    const visible = clients.filter(client => filter === 'all' || (filter === 'collecting' ? ['inquiry','collecting'].includes(client.stage) : ['ready','review','manual','legacy'].includes(client.stage)));
    $('count').textContent = String(visible.length); $('empty').hidden = Boolean(visible.length); $('clients').replaceChildren();
    for (const client of visible) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'client-card'; button.dataset.ready = String(client.stage === 'ready');
      const name = document.createElement('strong'); name.textContent = client.businessName || '+' + client.phone;
      const status = document.createElement('span'); status.className = 'status-pill'; status.textContent = stages[client.stage] || 'Pendiente';
      const copy = document.createElement('small'); copy.textContent = client.summary || (client.missing?.length ? 'Falta: ' + client.missing.map(key => missing[key]).join(', ') : 'Datos recibidos.');
      button.append(name, status, copy); button.addEventListener('click', () => show(client)); $('clients').append(button);
    }
  }
  function field(title, value) {
    const dl = document.createElement('dl'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = title; dd.textContent = value || 'Pendiente'; dl.append(dt, dd); $('detail-body').append(dl);
  }
  function show(client, open = true) {
    selected = client; $('detail-title').textContent = client.businessName || 'Ficha de cliente'; $('detail-body').replaceChildren();
    field('WhatsApp', '+' + client.phone); field('Estado', stages[client.stage]); field('Propuesta autorizada', client.confirmed ? 'Sí · sin obligación de pago' : 'Todavía no');
    field('Nombre del negocio', client.businessName); field('Colores', client.teamPalette ? 'El equipo propone la paleta' : client.colors);
    field('Datos pendientes', client.missing.length ? client.missing.map(key => missing[key]).join(', ') : 'Datos completos; pendiente del equipo');
    field('Resumen', client.summary); field('Consultas por confirmar y notas', client.reviewNotes.join('\n') || 'Sin notas pendientes');
    field('Originales recibidos', client.assets.length ? client.assets.map(asset => (asset.id === client.logoId ? 'Logo confirmado · ' : 'Imagen por revisar · ') + asset.file).join('\n') : 'Aún no se recibió una imagen válida');
    field('Copia en la laptop', client.syncedVersion >= client.fileVersion ? 'Sincronizada · ' + new Date(client.syncedAt).toLocaleString('es-PE') : 'Pendiente de sincronización; se conserva en el servidor');
    $('open-chat').href = 'https://wa.me/' + client.phone;
    $('resume-chat').textContent = client.legacy ? 'Autorizar NodoS para este contacto' : 'Reactivar este chat';
    $('resume-chat').disabled = client.optedOut || !client.paused;
    $('pause-chat').disabled = client.paused;
    $('copy-folder').disabled = !client.assets.length;
    $('command-status').textContent = pending.some(command => command.clientId === client.id) ? 'Hay una orden pendiente de aplicar en el agente.' : '';
    if (open && !$('detail').open) $('detail').showModal();
  }
  async function refresh(silent = false) {
    if (busy) return; busy = true; $('refresh').disabled = true; $('refresh').dataset.loading = 'true';
    try {
      const [data, control] = await Promise.all([request(), request(null)]);
      clients = data.clients; pending = data.commands; $('login').hidden = true; $('workspace').hidden = false;
      const active = data.control.appliedMode === 'nodos' && control.applied && control.connected;
      document.querySelector('.agent-card').dataset.active = String(active);
      $('agent-state').textContent = active ? 'NodoS activo' : data.control.desiredMode === 'nodos' && control.desired ? 'Activación solicitada' : 'Agente pausado';
      $('connection').textContent = control.connected ? 'WhatsApp conectado · +51 948 772 399' : 'Esperando conexión con WhatsApp';
      $('activate').disabled = active; $('pause').disabled = data.control.desiredMode === 'paused';
      notice('Actualizado ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })); render();
      if ($('detail').open && selected) { const updated = clients.find(client => client.id === selected.id); if (updated) show(updated, false); }
    } catch (error) {
      if (error.status === 401) { $('login').hidden = false; $('workspace').hidden = true; }
      if (!silent || !clients.length) notice(error.message || 'No se pudo actualizar. Inténtalo de nuevo.');
    } finally { busy = false; $('refresh').disabled = false; $('refresh').dataset.loading = 'false'; }
  }
  async function changeMode(mode) {
    $('activate').disabled = $('pause').disabled = true;
    try { await request('nodos-mode', { mode }); if (mode === 'nodos') await request('mode', { enabled: true }); notice('Cambio solicitado. El agente lo aplicará en unos segundos.'); }
    catch (error) { notice(error.message); }
    finally { $('activate').disabled = $('pause').disabled = false; }
    setTimeout(() => refresh(), 1500);
  }
  async function command(action) {
    if (!selected) return;
    if (action === 'enroll' && !confirm('¿Autorizar atención de páginas web para este contacto anterior de Cursos? Solo responderá cuando el cliente escriba.')) return;
    const buttons = ['pause-chat', 'resume-chat', 'reviewed']; buttons.forEach(id => { $(id).disabled = true; });
    try { await request('nodos-command', { id: crypto.randomUUID(), clientId: selected.id, action, requestedAt: new Date().toISOString() }); $('command-status').textContent = 'Orden guardada. Se aplicará en unos segundos. Reactivar no envía mensajes por sí solo.'; }
    catch (error) { $('command-status').textContent = error.message; }
    finally { buttons.forEach(id => { $(id).disabled = false; }); }
  }
  $('refresh').addEventListener('click', () => refresh()); $('filter').addEventListener('change', render);
  $('activate').addEventListener('click', () => changeMode('nodos')); $('pause').addEventListener('click', () => changeMode('paused'));
  $('close-detail').addEventListener('click', () => $('detail').close());
  $('pause-chat').addEventListener('click', () => command('pause')); $('resume-chat').addEventListener('click', () => command(selected?.legacy ? 'enroll' : 'resume')); $('reviewed').addEventListener('click', () => command('reviewed'));
  $('download-ficha').addEventListener('click', () => {
    if (!selected) return;
    const text = ['NodoS · Ficha de cliente', 'WhatsApp: +' + selected.phone, 'Negocio: ' + (selected.businessName || 'Pendiente'), 'Estado: ' + stages[selected.stage],
      'Propuesta autorizada: ' + (selected.confirmed ? 'Sí, sin obligación de pago' : 'No'), 'Colores: ' + (selected.teamPalette ? 'El equipo propone la paleta' : selected.colors || 'Pendiente'),
      'Logo: ' + (selected.logoId || 'Pendiente'), 'Resumen: ' + selected.summary, 'Notas: ' + selected.reviewNotes.join('\n'),
      'Originales: ' + selected.assets.map(asset => asset.file).join(', '), 'S/ 280, dominio y hosting incluidos. Sin adelantos. Primero la ves, luego decides.'].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = 'ficha-' + selected.id + '.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('copy-folder').addEventListener('click', async () => {
    if (!selected) return; const path = 'C:\\Users\\Lazz.p\\Downloads\\Clientes NodoS\\cliente-' + selected.phone + '-' + selected.id.slice(0,8);
    try { await navigator.clipboard.writeText(path); $('command-status').textContent = 'Ruta copiada. Ábrela en el Explorador de tu laptop.'; } catch { $('command-status').textContent = path; }
  });
  $('link').addEventListener('submit', async event => { event.preventDefault(); try { await request('link', { code: $('code').value }); $('code').value = ''; await refresh(); } catch (error) { notice(error.message); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  setInterval(() => { if (!document.hidden && !$('detail').open) refresh(true); }, 20000);
  void refresh();
})();
