import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import api from './api/caja.mjs';
import whatsapp from './api/whatsapp.mjs';
import { findLocalCredentials } from './lib/local-credentials.mjs';

await findLocalCredentials();
const port = Number(process.env.PORT || 3000);
const origin = 'http://127.0.0.1:' + port;
const openRequested = process.argv.includes('--open');
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/assets/caja.svg': ['assets/caja.svg', 'image/svg+xml'],
  '/assets/caja-ios.png': ['assets/caja-ios.png', 'image/png'],
  '/assets/yape.png': ['assets/yape.png', 'image/png'],
  '/assets/plin.png': ['assets/plin.png', 'image/png'],
  '/assets/venta-confirmada.mp3': ['assets/venta-confirmada.mp3', 'audio/mpeg'],
};

function openBrowser() {
  if (!openRequested || process.platform !== 'win32') return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin + '/'], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  browser.on('error', () => console.log('Abre en tu navegador: ' + origin + '/'));
  browser.unref();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/caja' || url.pathname === '/api/whatsapp') {
      const body = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) {
          res.writeHead(413).end();
          return;
        }
        body.push(chunk);
      }
      const handler = url.pathname === '/api/caja' ? api : whatsapp;
      const response = await handler.fetch(new Request(url, {
        method: req.method, headers: req.headers, body: body.length ? Buffer.concat(body) : undefined,
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!Object.hasOwn(files, url.pathname) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404).end('No encontrado');
      return;
    }
    const [file, type] = files[url.pathname];
    const content = await readFile(new URL('public/' + file, import.meta.url));
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(500).end('Error del servidor local');
  }
});

server.on('error', async error => {
  if (openRequested && error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(origin + '/', { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.text()).includes('<title>DigPro</title>')) {
        openBrowser();
        return;
      }
    } catch {
      // Report the port error if the existing server is unreachable.
    }
  }
  console.error('No se pudo iniciar DigPro:', error.code || error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log('DigPro: ' + origin + '/');
  openBrowser();
});
