import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, RANGES, MODES, MODE_LABELS } from '../src/config.js';

const html = (await import('node:fs')).readFileSync(
  new URL('../index.html', import.meta.url), 'utf8');

describe('config', () => {
  it('varsayılan parametreler sayısal ve pozitif', () => {
    assert.ok(CONFIG.count > 0);
    assert.ok(CONFIG.count >= 2000 && CONFIG.count <= 3000, 'hedef aralık 2000-3000');
    assert.ok(CONFIG.fixedDt > 0);
    assert.ok(CONFIG.maxFrameTime > 0);
    assert.ok(CONFIG.friction > 0 && CONFIG.friction <= 1);
    assert.ok(CONFIG.maxSpeed > 0);
    assert.ok(CONFIG.minRadius > 0 && CONFIG.maxRadius > CONFIG.minRadius);
  });

  it('sabit zaman adımı makul (fizik 120Hz)', () => {
    assert.ok(Math.abs(CONFIG.fixedDt - 1 / 120) < 1e-9);
  });

  it('maxSubSteps negatif olamaz', () => {
    assert.ok(CONFIG.maxSubSteps >= 1);
  });

  it('yerçekimi yumuşatması negatif değil (merkezde singularite yok)', () => {
    assert.ok(CONFIG.gravitySoftening > 0);
    assert.ok(CONFIG.gravityRadius > 0);
  });

  it('renk kova sayısı makul', () => {
    assert.ok(CONFIG.colorBuckets >= 8 && CONFIG.colorBuckets <= 256);
  });

  it('RANGES her alan için geçerli aralık tanımlar', () => {
    for (const [key, r] of Object.entries(RANGES)) {
      assert.ok(r.min < r.max, `${key}: min < max`);
      assert.ok(r.step > 0, `${key}: step > 0`);
      assert.ok(r.default >= r.min && r.default <= r.max, `${key}: default aralıkta`);
      assert.ok(key in CONFIG, `${key}: CONFIG'de karşılığı yok`);
    }
  });

  it('RANGES default değerleri CONFIG ile tutarlı', () => {
    for (const [key, r] of Object.entries(RANGES)) {
      assert.equal(r.default, CONFIG[key], `${key} default uyuşmuyor`);
    }
  });

  it('MODES üç mod içerir ve her modun etiketi var', () => {
    assert.equal(MODES.length, 3);
    for (const m of MODES) assert.ok(MODE_LABELS[m], `${m} etiketi eksik`);
  });

  it('canlılık tabanı tavanın çok altında (ısınma koruması)', () => {
    assert.ok(CONFIG.speedFloor < CONFIG.maxSpeed * 0.1);
    assert.ok(CONFIG.speedFloor > 0, 'taban sıfırsa sistem donuyor');
  });

  it('sürtünme 1\'den küçük ama makul (üstel birikim)', () => {
    assert.ok(CONFIG.friction < 1, 'sürtünme 1 veya üstü hız artırır');
    const perSecond = CONFIG.friction ** (1 / CONFIG.fixedDt);
    assert.ok(perSecond > 0.7, `saniyede %${(perSecond * 100).toFixed(0)} hız kalıyor`);
  });

  });