import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../src/config.js';
import {
  gravityField, wrapPosition, clampSpeed, applySpeedFloor, resolveCollision, makeParams, safe,
} from '../src/physics.js';

const W = 1280;
const H = 720;
const DT = CONFIG.fixedDt;

function makeWorld(n, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const w = {
    x: new Float32Array(n), y: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n),
    r: new Float32Array(n),
  };

  for (let i = 0; i < n; i++) {
    w.x[i] = rnd() * W;
    w.y[i] = rnd() * H;
    const a = rnd() * Math.PI * 2;
    const sp = rnd() * 200;
    w.vx[i] = Math.cos(a) * sp;
    w.vy[i] = Math.sin(a) * sp;
    w.r[i] = 1 + rnd() * 2;
  }
  return w;
}

function step(w, params, gx, gy, tmp) {
  const { x, y, vx, vy } = w;

  for (let i = 0; i < x.length; i++) {
    gravityField(gx - x[i], gy - y[i], params, tmp);
    vx[i] = safe(vx[i] + tmp[0] * DT);
    vy[i] = safe(vy[i] + tmp[1] * DT);

    vx[i] *= params.damping;
    vy[i] *= params.damping;

    applySpeedFloor(vx[i], vy[i], params.speedFloor, tmp);
    vx[i] = tmp[0];
    vy[i] = tmp[1];

    clampSpeed(vx[i], vy[i], params.maxSpeed, tmp);
    vx[i] = tmp[0];
    vy[i] = tmp[1];

    x[i] = safe(x[i] + vx[i] * DT);
    y[i] = safe(y[i] + vy[i] * DT);

    wrapPosition(x[i], y[i], W, H, tmp);
    x[i] = tmp[0];
    y[i] = tmp[1];
  }
}

function stats(w) {
  const n = w.x.length;
  let nan = 0;
  let maxSpeed = 0;
  let sumSpeed = 0;
  let outside = 0;

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(w.x[i]) || !Number.isFinite(w.y[i]) ||
        !Number.isFinite(w.vx[i]) || !Number.isFinite(w.vy[i])) nan++;

    const s = Math.hypot(w.vx[i], w.vy[i]);
    if (s > maxSpeed) maxSpeed = s;
    sumSpeed += s;

    if (w.x[i] < 0 || w.x[i] >= W || w.y[i] < 0 || w.y[i] >= H) outside++;
  }

  return { nan, maxSpeed, avgSpeed: sumSpeed / n, outside };
}

describe('entegrasyon — uzun vadeli kararlılık', () => {
  it('10.000 adım sonrası NaN üretilmez', () => {
    const w = makeWorld(2400);
    const p = makeParams();
    const tmp = [0, 0];

    for (let s = 0; s < 10000; s++) step(w, p, 640, 360, tmp);

    const { nan } = stats(w);
    assert.equal(nan, 0, `${nan} parçacık sayısal değer kaybetti`);
  });

  it('parçacık sayısı değişmez', () => {
    const w = makeWorld(2400);
    const p = makeParams();
    const tmp = [0, 0];
    for (let s = 0; s < 1000; s++) step(w, p, 640, 360, tmp);
    assert.equal(w.x.length, 2400);
  });

  it('hız tavanı hiç aşılmaz (ısınma yok)', () => {
    const w = makeWorld(2400);
    const p = makeParams();
    const tmp = [0, 0];
    for (let s = 0; s < 10000; s++) step(w, p, 640, 360, tmp);

    const { maxSpeed } = stats(w);
    assert.ok(maxSpeed <= p.maxSpeed + 1e-3, `tavan aşıldı: ${maxSpeed}`);
  });

  it('tüm parçacıklar ekran sınırları içinde kalır', () => {
    const w = makeWorld(2400);
    const p = makeParams();
    const tmp = [0, 0];
    for (let s = 0; s < 5000; s++) step(w, p, 640, 360, tmp);

    const { outside } = stats(w);
    assert.equal(outside, 0, `${outside} parçacık sınır dışında`);
  });

  it('sistem ölmez: 8 dakika sonra hâlâ kararlı hareket var', () => {
    const w = makeWorld(1200, 12345);
    const p = makeParams();
    const tmp = [0, 0];

    const STEPS = 60000;
    for (let s = 0; s < STEPS; s++) step(w, p, 640, 360, tmp);

    const { avgSpeed, maxSpeed, nan, outside } = stats(w);
    assert.equal(nan, 0, 'NaN üretildi');
    assert.equal(outside, 0, 'sınır kaçağı');
    assert.ok(avgSpeed > 25, `sistem dondu: ortalama hız ${avgSpeed.toFixed(2)} px/s`);
    assert.ok(maxSpeed > 60, `max hız çok düşük: ${maxSpeed.toFixed(2)} px/s`);
    assert.ok(maxSpeed < p.maxSpeed * 0.9, `ısınma var: ${maxSpeed} / ${p.maxSpeed}`);
  });

  it('canlılık tabanı olmadan sistem kaçınılmaz olarak çöker', () => {
    const w = makeWorld(800, 12345);
    const p = makeParams({ speedFloor: 0 });
    const tmp = [0, 0];

    for (let s = 0; s < 30000; s++) step(w, p, 640, 360, tmp);
    const { avgSpeed } = stats(w);

    assert.ok(
      avgSpeed < 25,
      `taban olmadan sistem canlı kaldı (${avgSpeed.toFixed(1)}) — farkındalık eksik`
    );

    const w2 = makeWorld(800, 12345);
    const p2 = makeParams();
    const tmp2 = [0, 0];
    for (let s = 0; s < 30000; s++) step(w2, p2, 640, 360, tmp2);
    assert.ok(stats(w2).avgSpeed > 25, 'varsayılan taban sistemi canlı tutmuyor');
  });

  it('sürtünme varsayılanı üstel olarak çok sert değil', () => {
    const perSecond = CONFIG.friction ** (1 / CONFIG.fixedDt);
    assert.ok(
      perSecond > 0.7,
      `saniyede sadece %${(perSecond * 100).toFixed(0)} hız kalıyor — çok sert`
    );
    assert.ok(perSecond < 1, 'sürtünme asla hız artırmamalı');
  });

  it('canlılık tabanı tavanın çok altında (ısınma koruması)', () => {
    assert.ok(
      CONFIG.speedFloor < CONFIG.maxSpeed * 0.1,
      `speedFloor=${CONFIG.speedFloor}, maxSpeed=${CONFIG.maxSpeed} — taban tavana yaklaşırsa sistem ısınır`
    );
  });

  it('farklı sürtünme değerleriyle de kararlı (parametre taraması)', () => {
  for (const friction of [0.999, 0.9995, 0.9999, 0.99995]) {
      const w = makeWorld(600, 42);
      const p = makeParams({ damping: friction });
      const tmp = [0, 0];
      for (let s = 0; s < 3000; s++) step(w, p, 640, 360, tmp);

      const { nan, maxSpeed, outside } = stats(w);
      assert.equal(nan, 0, `friction=${friction}: NaN üretildi`);
      assert.ok(maxSpeed <= p.maxSpeed + 1e-3, `friction=${friction}: tavan aşıldı`);
      assert.equal(outside, 0, `friction=${friction}: sınır kaçağı`);
    }
  });

  it('şok dalgası sonrası dağılım bozulmaz', () => {
    const w = makeWorld(1200);
    const p = makeParams();
    const tmp = [0, 0];

    for (let s = 0; s < 500; s++) step(w, p, 640, 360, tmp);
    const before = stats(w);

    for (let s = 0; s < 60; s++) {
      const sp = [0, 0];
      for (let i = 0; i < w.x.length; i++) {
        const dx = w.x[i] - 640;
        const dy = w.y[i] - 360;
        const d = Math.hypot(dx, dy) || 1;
        w.vx[i] += (dx / d) * 900 * DT;
        w.vy[i] += (dy / d) * 900 * DT;
      }
      step(w, p, 640, 360, tmp);
      void sp;
    }

    const after = stats(w);
    assert.equal(after.nan, 0, 'şıktan sonra NaN');
    assert.equal(after.outside, 0, 'şıktan sonra sınır kaçağı');
    assert.ok(after.maxSpeed <= p.maxSpeed + 1e-3, 'şıktan sonra tavan aşıldı');
    assert.ok(after.avgSpeed > before.avgSpeed, 'şok hızı artırmadı');
  });

  it('çarpışma çözümü 3000 parçacıkla performanslı kalır', () => {
    const n = 3000;
    const w = makeWorld(n, 7);
    const start = performance.now();
    const CP = { restitution: CONFIG.restitution, damping: CONFIG.collisionDamping, correction: CONFIG.positionCorrection };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < Math.min(i + 6, n); j++) {
        resolveCollision(w, i, j, CP);
      }
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `çarpışma çok yavaş: ${elapsed.toFixed(1)}ms`);
  });

  it('tüm yarıçaplar pozitif kalır (çökme yok)', () => {
    const w = makeWorld(500);
    const CP = { restitution: 0.7, damping: 0.95, correction: 0.5 };
    for (let pass = 0; pass < 50; pass++) {
      for (let i = 0; i < w.x.length; i++) {
        for (let j = i + 1; j < Math.min(i + 8, w.x.length); j++) {
          resolveCollision(w, i, j, CP);
        }
      }
    }
    for (let i = 0; i < w.r.length; i++) {
      assert.ok(Number.isFinite(w.r[i]) && w.r[i] > 0, `yarıçap bozuldu @${i}`);
    }
  });
});

describe('sarmalama — geniş koordinatlar', () => {
  const W2 = 1000, H2 = 800;

  it('birden fazla ekran boyu sapmada da doğru sarmalar', () => {
    const o = [0, 0];
    wrapPosition(-2500, -3000, W2, H2, o);
    assert.deepEqual(o, [500, 200]);
  });

  it('sarma sonucu -0 üretmez (derin eşitlik kontrolleri için)', () => {
    const o = [0, 0];
    wrapPosition(-0, 0, W2, H2, o);
    assert.ok(Object.is(o[0], 0), `-0 üretildi: ${Object.is(o[0], -0)}`);
  });

  it('rastgele büyük sapmalarda daima sınırlar içinde', () => {
    for (let i = 0; i < 1000; i++) {
      const x = (Math.random() - 0.5) * 1e6;
      const y = (Math.random() - 0.5) * 1e6;
      const o = [0, 0];
      wrapPosition(x, y, W2, H2, o);
      assert.ok(o[0] >= 0 && o[0] < W2 && o[1] >= 0 && o[1] < H2, `sapma: ${o}`);
    }
  });
});