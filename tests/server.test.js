import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;
let baseUrl = BASE;

async function waitForServer(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  const up = await waitForServer(`${BASE}/`);
  if (!up) {
    child.kill();
    throw new Error(`sunucu ${PORT} portunda ayağa kalkamadı`);
  }
});

after(() => {
  child?.kill('SIGTERM');
});

const get = (p, init) => fetch(`${baseUrl}${p}`, init);

describe('sunucu — temel', () => {
  it('index.html sunar', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.match(body, /<canvas id="stage">/);
  });

  it('doğru MIME tipi (ES modülü text/javascript olmalı)', async () => {
    const r = await get('/src/main.js');
    assert.match(r.headers.get('content-type'), /text\/javascript/);
  });

  it('CSS MIME tipi', async () => {
    const r = await get('/styles.css');
    assert.match(r.headers.get('content-type'), /text\/css/);
  });

  it('tüm kaynak modülleri erişilebilir', async () => {
    const mods = [
      'config', 'physics', 'grid', 'particles',
      'colors', 'renderer', 'interaction', 'audio',
    ];
    for (const m of mods) {
      const r = await get(`/src/${m}.js`);
      assert.equal(r.status, 200, `src/${m}.js sunulamadı`);
    }
  });

  it('Cache-Control: no-store (geliştirmede anında güncellensin)', async () => {
    const r = await get('/src/main.js');
    assert.match(r.headers.get('cache-control') || '', /no-store/);
  });
});

describe('sunucu — hatalar', () => {
  it('olmayan dosya 404', async () => {
    assert.equal((await get('/boyle-bir-dosya-yok')).status, 404);
  });

  it('POST reddedilir (405)', async () => {
    assert.equal((await get('/', { method: 'POST' })).status, 405);
  });

  it('HEAD çalışır', async () => {
    assert.equal((await get('/', { method: 'HEAD' })).status, 200);
  });
});

describe('sunucu — yol güvenliği', () => {

  it('düz traversal engellenir', async () => {
    const r = await get('/../../../etc/passwd');
    assert.notEqual(r.status, 200, 'traversal ile sistem dosyası okundu!');
  });

  it('kodlanmış traversal engellenir', async () => {
    const r = await get('/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    assert.notEqual(r.status, 200, 'kodlanmış traversal ile sistem dosyası okundu!');
  });

  it('çift kodlanmış traversal engellenir', async () => {
    const r = await get('/%252e%252e%252fetc%252fpasswd');
    assert.notEqual(r.status, 200);
  });

  it('null byte reddedilir (dosya sistemine ulaşmaz)', async () => {
    const r = await get('/index.html%00.png');
    assert.equal(r.status, 400, 'null byte reddedilmeli');
  });

  it('bozuk yüzde kodlaması reddedilir', async () => {
    const r = await get('/%zz');
    assert.equal(r.status, 400);
  });

  it('sunucu traversal denemelerinden sonra hâlâ ayakta', async () => {
    for (const p of ['/../..', '/%00', '/%c0%ae%c0%ae/', '/....//etc/passwd']) {
      await get(p);
    }
    const r = await get('/');
    assert.equal(r.status, 200, 'sunucu saldırı denemelerinden sonra düştü');
  });
});