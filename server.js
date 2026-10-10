import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const START_PORT = Number(process.env.PORT) || 5173;
const MAX_PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function safeResolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;

  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = join(ROOT, relative);

  if (!full.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) && full !== ROOT.slice(0, -1)) {
    return null;
  }
  return full;
}

async function serve(res, filePath) {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return serve(res, join(filePath, 'index.html'));
    }

    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = safeResolve(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 — Geçersiz istek');
    return;
  }

  if (await serve(res, filePath)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`404 — Bulunamadı: ${req.url}`);
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[sunucu] hata:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('500 — Sunucu hatası');
  });
});

function listen(port, attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES) {
      listen(port + 1, attempt + 1);
    } else {
      console.error(`[sunucu] ${port} portunda başlatılamadı:`, e.message);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  ┌─────────────────────────────────────────┐');
    console.log('  │  PARÇACIK UZAYI                         │');
    console.log('  └─────────────────────────────────────────┘');
    console.log('');
    console.log(`  →  ${url}`);
    console.log('');
    console.log('   1 / 2 / 3  ·  çek / it / karışık');
    console.log('   sağ tık    ·  mod değiştir');
    console.log('   tıkla      ·  şok dalgası');
    console.log('   boşluk     ·  duraklat');
    console.log('   M / R / T  ·  ses / sıfırla / izler');
    console.log('');
    console.log('   Durdurmak için Ctrl+C');
    console.log('');
  });
}

listen(START_PORT);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[sunucu] kapatılıyor...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}