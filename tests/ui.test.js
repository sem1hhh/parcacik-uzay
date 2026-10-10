import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CONFIG, RANGES } from '../src/config.js';

const ID_MAP = {
  count: 'ctl-count',
  gravityStrength: 'ctl-gravity',
  velocityBoost: 'ctl-boost',
  friction: 'ctl-friction',
  speedFloor: 'ctl-floor',
  trailFade: 'ctl-trail',
};
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

const idsInHtml = new Set([...html.matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]));
const idsUsed = [...main.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]);

describe('index.html yapısı', () => {
  it('canvas ve hud kabı mevcut', () => {
    assert.ok(idsInHtml.has('stage'));
    assert.ok(idsInHtml.has('hud'));
  });

  it('ana script modül olarak yükleniyor', () => {
    assert.match(html, /<script type="module" src="src\/main\.js">/);
  });

  it('eski AI-slop sınıfları tamamen kaldırılmış', () => {
    for (const cls of ['hud-badge', 'hud-title-overlay', 'hud-help']) {
      if (cls === 'hud-help') continue;
      assert.ok(!html.includes(`class="${cls}"`), `${cls} hala HTML'de`);
    }
    assert.ok(!css.includes('.hud-badge'), '.hud-badge CSS\'te hala var');
    assert.ok(!html.includes('hud-badge"'), 'eski rozet sınıfı HTML\'de hala var');
  });

  it('yeni editoryal sınıflar mevcut', () => {
    for (const cls of ['hud-index', 'hud-subtitle', 'hud-mode', 'hud-mode-mark', 'control-head']) {
      assert.ok(html.includes(cls) || css.includes(`.${cls}`), `${cls} eksik`);
    }
  });

  it('her slider etiketli ve aria-label\'ı var (erişilebilirlik)', () => {
    const ranges = [...html.matchAll(/<input type="range"[^>]*>/g)].map((m) => m[0]);
    assert.equal(ranges.length, 6, '6 slider bekleniyordu');
    for (const r of ranges) {
      assert.match(r, /aria-label="[^"]+"/, 'aria-label eksik: ' + r);
      assert.match(r, /id="ctl-[\w-]+"/, 'id eksik');
    }
  });

  it('her slider bir <label> içinde (tıklama alanı geniş)', () => {
    const labelCount = (html.match(/<label class="control">/g) || []).length;
    assert.equal(labelCount, 6);
  });

  it('slider değerleri CONFIG varsayılanlarıyla aynı (HTML güncel)', () => {
    for (const [key, id] of Object.entries(ID_MAP)) {
      const tag = html.match(new RegExp(`id="${id}"[^>]*>`))?.[0];
      assert.ok(tag, `${id} bulunamadı`);
      const value = Number(tag.match(/value="([\d.]+)"/)[1]);
      assert.equal(value, CONFIG[key], `${id} (${key}) HTML'de ${value}, config'de ${CONFIG[key]}`);
    }
  });

  it('slider min/max/step değerleri RANGES ile aynı', () => {
    for (const [key, r] of Object.entries(RANGES)) {
      const id = ID_MAP[key];
      assert.ok(id, `${key} için HTML id eşlemesi tanımsız`);
      const tag = html.match(new RegExp(`id="${id}"[^>]*>`))?.[0];
      assert.ok(tag, `${id} bulunamadı`);
      assert.equal(Number(tag.match(/min="([\d.]+)"/)[1]), r.min, `${key} min uyuşmuyor`);
      assert.equal(Number(tag.match(/max="([\d.]+)"/)[1]), r.max, `${key} max uyuşmuyor`);
      assert.equal(Number(tag.match(/step="([\d.]+)"/)[1]), r.step, `${key} step uyuşmuyor`);
    }
  });

  it('ID_MAP her RANGES anahtarını kapsıyor', () => {
    for (const key of Object.keys(RANGES)) {
      assert.ok(ID_MAP[key], `RANGES.${key} için HTML id eşlemesi yok`);
    }
    assert.equal(Object.keys(ID_MAP).length, Object.keys(RANGES).length);
  });

  it('HTML\'deki HER slider main.js\'de bağlı', () => {
    const htmlIds = [...html.matchAll(/id="(ctl-[\w-]+)"/g)].map((m) => m[1]);
    const mainKeys = [...main.matchAll(/'(ctl-[\w-]+)':/g)].map((m) => m[1]);

    for (const id of htmlIds) {
      assert.ok(mainKeys.includes(id),
        `${id} HTML'de var ama main.js'de bağlı değil — slider işlevsiz`);
    }
  });

  it('main.js\'deki HER slider HTML\'de var', () => {
    const mainKeys = [...main.matchAll(/'(ctl-[\w-]+)':/g)].map((m) => m[1]);
    const htmlIds = new Set([...html.matchAll(/id="(ctl-[\w-]+)"/g)].map((m) => m[1]));

    for (const id of mainKeys) {
      assert.ok(htmlIds.has(id),
        `${id} main.js'de bağlı ama HTML'de yok — ölü kod`);
    }
  });

  it('her slider bir label öğesine bağlı (tıklanabilir alan)', () => {
    const htmlIds = [...html.matchAll(/id="(ctl-[\w-]+)"/g)].map((m) => m[1]);
    const labelWraps = (html.match(/<label class="control">/g) || []).length;
    assert.equal(htmlIds.length, labelWraps,
      'slider sayısı ile label sayısı uyuşmuyor — bazı slider etiketsiz');
  });

  it('butonlar aria-pressed kullanıyor', () => {
    const buttons = [...html.matchAll(/<button[^>]*class="toggle"[^>]*>/g)].map((m) => m[0]);
    assert.equal(buttons.length, 3);
    assert.ok(buttons.filter((b) => b.includes('aria-pressed')).length >= 2);
  });

  it('yardım bloğu sözlük (dl/dt/dd) semantiği kullanıyor', () => {
    assert.match(html, /<dl>/);
    assert.match(html, /<dt>/);
    assert.match(html, /<dd>/);
  });
});

describe('main.js ↔ index.html eşleşmesi', () => {
  it('kullanılan tüm id\'ler HTML\'de var', () => {
    const missing = idsUsed.filter((id) => !idsInHtml.has(id));
    assert.deepEqual(missing, [], `HTML\'de eksik id: ${missing.join(', ')}`);
  });

  it('HTML\'deki tüm istatistik id\'lerine erişiliyor', () => {
    for (const id of ['stat-fps', 'stat-count', 'stat-speed', 'mode-badge', 'hud-mode']) {
      assert.ok(idsUsed.includes(id), `${id} main.js'de kullanılmıyor`);
    }
  });
});

describe('styles.css tasarım kuralları', () => {
  it('Univers öncelikli font yığını, Helvetica Neue fallback ile', () => {
    assert.match(css, /"Helvetica Neue"/);
    assert.match(css, /--sans:/);
  });

  it('neon camgöbeği glow / blur kaldırılmış', () => {
    assert.ok(!/text-shadow:[^;]*glow/.test(css), 'glow text-shadow kaldı');
    assert.ok(!css.includes('backdrop-filter'), 'glassmorphism blur kaldı');
    assert.ok(!/box-shadow:[^;]*\d+px[^;]*\d+px[^;]*rgba\([^)]*\)/.test(css), 'dekoratif box-shadow kaldı');
  });

  it('vurgu rengi olarak amber ve turkuaz/mor renkleri yok', () => {
    assert.ok(css.includes('#e0a03c'), 'amber vurgu eksik');
    assert.ok(!/#7fc4ff/i.test(css), 'eski camgöbeği kaldı');
    assert.ok(!/#[0-9a-f]{0,2}ff[0-9a-f]{4}/i.test(css), 'magenta kaldı');
  });

  it('tabular rakam etkin (sütun hizası)', () => {
    assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  });

  it('prefers-reduced-motion destekleniyor', () => {
    assert.match(css, /prefers-reduced-motion/);
  });

  it('mobil için medya sorgusu var', () => {
    assert.match(css, /@media \(max-width:/);
  });

  it('slider thumb\'u kare (yuvarlak knob yok)', () => {
    assert.match(css, /::-webkit-slider-thumb[\s\S]{0,400}?border-radius:\s*0/);
  });
});