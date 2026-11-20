import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, WebSocketTransport } from 'colyseus';
import { MobaRoom } from './rooms/MobaRoom.js';

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '0.0.0.0';

/**
 * Koyeb menjalankan satu proses: Colyseus + build Vite dari `client/dist`.
 * Override dengan CLIENT_DIST bila struktur folder berbeda.
 */
const clientDist = resolve(
  process.env.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist/', import.meta.url)),
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const immutable = filePath.includes(`${sep}assets${sep}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', immutable
    ? 'public, max-age=31536000, immutable'
    : 'no-cache');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/**
 * Melayani SPA + aset PNG. Rute Colyseus (/matchmake, /ws) dan /health
 * sengaja dilewati supaya tetap ditangani server game.
 */
function serveClient(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (res.headersSent || res.writableEnded) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    next();
    return;
  }

  if (
    pathname === '/health' ||
    pathname === '/ws' ||
    pathname.startsWith('/ws/') ||
    pathname.startsWith('/matchmake/')
  ) {
    next();
    return;
  }

  const candidate = resolve(clientDist, pathname.replace(/^\/+/, ''));
  if (candidate !== clientDist && !candidate.startsWith(clientDist + sep)) {
    next();
    return;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(req, res, candidate);
    return;
  }

  // SPA fallback: hanya untuk rute tanpa ekstensi (bukan aset yang typo).
  if (!extname(pathname)) {
    const index = join(clientDist, 'index.html');
    if (existsSync(index)) {
      sendFile(req, res, index);
      return;
    }
  }

  next();
}

const gameServer = new Server({
  transport: new WebSocketTransport({ pingInterval: 30000, pingMaxRetries: 5 }),
  greet: true,
  express: (app) => {
    app.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
      res.json({ ok: true, game: 'perang-petasan' });
    });
    app.use(serveClient);
  },
});

// Filter mode penting: bot mengisi slot kosong, jadi jumlah client bukan ukuran
// mode. Tanpa filter ini, pemilih 5v5 bisa masuk ke room 10v10 yang masih aktif.
gameServer.define('moba', MobaRoom).filterBy(['mode']);

await gameServer.listen(port, host);

/**
 * Client produksi memakai satu origin: /ws/matchmake/... dan WS /ws/<room>/<session>.
 * Colyseus mengenali /matchmake/... dan /<room>/<session>, jadi prefix /ws
 * dibuang lebih awal, sebelum router Colyseus membaca req.url.
 */
const httpServer = gameServer.transport.server;
if (!httpServer) throw new Error('Colyseus transport tidak memiliki HTTP server.');

const stripWsPrefix = (req: IncomingMessage): void => {
  if (req.url?.startsWith('/ws/')) req.url = req.url.slice(3);
};

httpServer.prependListener('upgrade', stripWsPrefix);
httpServer.prependListener('request', stripWsPrefix);

console.log(`[Perang Petasan] arena PvP siap di http://${host}:${port} (WS /ws)`);
console.log(`[Perang Petasan] client statis: ${clientDist}`);
