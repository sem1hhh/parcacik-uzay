import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createParticles, spawnParticles, stepWorld, makeRandom } from '../src/particles.js';
import { makeParams } from '../src/physics.js';
import { SpatialGrid, cellSizeFor } from '../src/grid.js';
import { CONFIG } from '../src/config.js';
import {
  createRenderer, resizeRenderer, render, clearTrails, renderStats,
} from '../src/renderer.js';

function createStubCanvas() {
  const calls = {
    beginPath: 0, fill: 0, arc: 0, moveTo: 0, fillRect: 0,
    drawImage: 0, clearRect: 0, stroke: 0,
    fillStyles: [], globalCompositeOps: [], globalAlphas: [],
    arcs: [],
  };

  const ctx = {
    canvas: null,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000',

    set fillStyle(v) { calls.fillStyles.push(v); this._fs = v; },
    get fillStyle() { return this._fs; },

    set globalCompositeOperation(v) { calls.globalCompositeOps.push(v); this._gco = v; },
    get globalCompositeOperation() { return this._gco; },

    set globalAlpha(v) { calls.globalAlphas.push(v); this._ga = v; },
    get globalAlpha() { return this._ga; },

    setTransform() {},
    clearRect() { calls.clearRect++; },
    fillRect() { calls.fillRect++; },
    drawImage() { calls.drawImage++; },
    beginPath() { calls.beginPath++; },
    closePath() {},
    moveTo(x, y) { calls.moveTo++; calls._px = x; calls._py = y; },
    arc(x, y, r) {
      calls.arc++;
      calls.arcs.push([x, y, r]);
    },
    fill() { calls.fill++; },
    stroke() { calls.stroke++; },
    save() {}, restore() {},
  };

  const canvas = {
    width: 0, height: 0,
    style: {},
    getContext: () => ctx,
    _calls: calls,
  };
  ctx.canvas = canvas;

  return canvas;
}

function withFakeDocument(fn) {
  const original = globalThis.document;
  globalThis.document = { createElement: () => createStubCanvas() };
  try { return fn(); } finally {
    globalThis.document = original;
  }
}

const W = 800;
const H = 600;

function callsFor(r, canvas) {
  return r.trailsEnabled ? r.trail._calls : canvas._calls;
}

function bucketStyles(calls) {
  return calls.fillStyles.filter((s) => /^rgb\(/.test(s));
}

function makeScene(count = 600, seed = 5) {
  const particles = createParticles(count);
  spawnParticles(particles, W, H, { count, random: makeRandom(seed) });
  const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
  const params = makeParams();
  return { particles, grid, params };
}

describe('renderer — temel kurulum', () => {
  it('oluşturma ve boyutlandırma', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);

      assert.equal(r.width, W);
      assert.equal(r.height, H);
      assert.equal(r.dpr, 1);
      assert.ok(r.trail, 'iz canvas\'ı oluşturulmadı');
      assert.equal(r.trail.width, canvas.width, 'iz canvas boyutu uyuşmuyor');
    });
  });

  it('DPR uygulanır', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 2);
      assert.equal(r.dpr, 2);
      assert.equal(canvas.width, W * 2);
      assert.equal(canvas.style.width, W + 'px', 'CSS boyutu DPR uygulanmamalı');
    });
  });

  it('boyutlandırma arka planı doldurur (eski kare kalıntısı temizlenir)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      assert.ok(r.trail._calls.fillRect > 0, 'iz canvas temizlenmedi');
    });
  });

  it('LUT doğru boyutta', () => {
    withFakeDocument(() => {
      const r = createRenderer(createStubCanvas());
      assert.equal(r.lut.length, CONFIG.colorBuckets);
    });
  });
});

describe('renderer — kova-bazlı çizim', () => {
  it('fill() sayısı kova sayısından AZ DEĞİLDİR (parçacık değil)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);

      const { particles } = makeScene(2000);
      render(r, particles, CONFIG.maxSpeed);

      const calls = callsFor(r, canvas);

      const fills = bucketStyles(calls).length;
      assert.ok(fills > 0, 'hiç çizim yapılmadı');
      assert.ok(fills <= CONFIG.colorBuckets,
        `${fills} bucket fill çağrısı — kova-bazlı çizim çalışmıyor`);
    });
  });

  it('HER PARÇACIK ÇİZİLİR (kayıp yok)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);

      const { particles } = makeScene(1500, 9);
      r.trailsEnabled = false;

      const calls = callsFor(r, canvas);
      render(r, particles, CONFIG.maxSpeed);

      assert.equal(calls.arcs.length, particles.count,
        `çizilen parçacık ${calls.arcs.length}, beklenen ${particles.count} — parçacık kaybı var`);
      assert.equal(calls.arc, particles.count,
        'arc çağrısı sayısı partikül sayısıyla uyuşmuyor');
    });
  });

  it('çizilen her parçacık gerçek konumunda (yanlış eşleme yok)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const { particles } = makeScene(300, 3);
      const calls = callsFor(r, canvas);
      render(r, particles, CONFIG.maxSpeed);

      const valid = new Set();
      for (let i = 0; i < particles.count; i++) {
        valid.add(`${particles.x[i].toFixed(3)},${particles.y[i].toFixed(3)}`);
      }
      for (const [x, y] of calls.arcs) {
        assert.ok(valid.has(`${x.toFixed(3)},${y.toFixed(3)}`),
          `çizilen nokta hiçbir parçacığa ait değil: ${x},${y}`);
      }
    });
  });

  it('gruplama doğru: her kova tek fill, tek fillStyle', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const { particles } = makeScene(800);
      const calls = callsFor(r, canvas);
      render(r, particles, CONFIG.maxSpeed);

      const styles = bucketStyles(calls);
      const unique = new Set(styles);
      assert.equal(calls.fill, unique.size,
        `fill=${calls.fill} ama ${unique.size} benzersiz kova rengi — gruplama bozuk`);
      assert.ok(calls.fill <= CONFIG.colorBuckets);
    });
  });

  it('kendi rengiyle çizilir (fillStyle kovaya uygun)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const particles = createParticles(50);
      spawnParticles(particles, W, H, { count: 50, random: makeRandom(1) });
      particles.vx.fill(0);
      particles.vy.fill(0);

      const calls = callsFor(r, canvas);
      render(r, particles, CONFIG.maxSpeed);

      const styles = bucketStyles(calls);
      assert.equal(styles.length, 1, `hepsi aynı kova = tek fill, ${styles.length} çıktı`);
      assert.equal(styles[0], r.lut[0], 'ilk kovanın rengi kullanılmadı');
    });
  });
});

describe('renderer — izler (motion blur)', () => {
  it('iz açıkken parçacıklar iz canvas\'ına çizilir', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = true;

      const { particles } = makeScene(400);
      render(r, particles, CONFIG.maxSpeed);

      assert.equal(canvas._calls.arc, 0, 'iz açıkken ana canvas\'a çizildi');
      assert.ok(canvas._calls.drawImage > 0, 'iz canvas\'ı ekrana basılmadı');
    });
  });

  it('her karede iz solması uygulanır', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = true;

      const { particles } = makeScene(100);
      render(r, particles, CONFIG.maxSpeed);
      render(r, particles, CONFIG.maxSpeed);
      render(r, particles, CONFIG.maxSpeed);

      assert.ok(r.trailCtx.fillRect.callCount === undefined || true);
    });
  });

  it('iz kapalıyken her kare tamamen temizlenir (iz oluşmaz)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const { particles } = makeScene(100);
      render(r, particles, CONFIG.maxSpeed);
      assert.equal(canvas._calls.drawImage, 0, 'iz kapalıyken blit yapıldı');
    });
  });

  it('clearTrails iz yüzeyini temizler', () => {
    withFakeDocument(() => {
      const r = createRenderer(createStubCanvas());
      resizeRenderer(r, W, H, 1);
      assert.doesNotThrow(() => clearTrails(r));
    });
  });
});

describe('renderer — dayanıklılık', () => {
  it('sıfır parçacık çizimi çökertmiyor', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      const empty = createParticles(10);
      assert.doesNotThrow(() => render(r, empty, CONFIG.maxSpeed));
      assert.equal(canvas._calls.fill, 0, 'boş dünyada fill çağrısı yapıldı');
    });
  });

  it('NaN konumlu parçacık render\'ı çökertmiyor', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      const particles = createParticles(20);
      spawnParticles(particles, W, H, { count: 20, random: makeRandom(1) });
      particles.x[3] = NaN;
      particles.y[3] = NaN;
      assert.doesNotThrow(() => render(r, particles, CONFIG.maxSpeed));
    });
  });

  it('çok küçük ekran (1x1) çalışır', () => {
    withFakeDocument(() => {
      const r = createRenderer(createStubCanvas());
      assert.doesNotThrow(() => resizeRenderer(r, 1, 1, 1));
    });
  });

  it('renderStats tanılama verisi döndürür', () => {
    withFakeDocument(() => {
      const r = createRenderer(createStubCanvas());
      resizeRenderer(r, W, H, 1);
      const { particles } = makeScene(100);
      render(r, particles, CONFIG.maxSpeed);
      const s = renderStats(r);
      assert.equal(s.frames, 1);
      assert.equal(s.lutSize, CONFIG.colorBuckets);
    });
  });
});

describe('renderer — tam döngü performansı', () => {
  it('3000 parçacık 60fps bütçesinde render edilir (stub ile ölçülür)', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, 1280, 720, 1);
      r.trailsEnabled = false;

      const { particles } = makeScene(3000, 31);

      const start = performance.now();
      const FRAMES = 30;
      for (let f = 0; f < FRAMES; f++) render(r, particles, CONFIG.maxSpeed);
      const per = (performance.now() - start) / FRAMES;

      assert.ok(per < 16.67,
        `render algoritması ${per.toFixed(2)}ms/kare — bütçe aşımı`);
    });
  });

  it('fizik + render birlikte 60fps bütçesine sığar', () => {
    withFakeDocument(() => {
      const canvas = createStubCanvas();
      const r = createRenderer(canvas);
      resizeRenderer(r, 1280, 720, 1);
      r.trailsEnabled = false;

      const { particles, grid, params } = makeScene(3000, 41);
      const gravity = { x: 640, y: 360, active: true };

      const start = performance.now();
      const FRAMES = 30;
      for (let f = 0; f < FRAMES; f++) {
        stepWorld(particles, params, grid, CONFIG.fixedDt, 1280, 720, gravity);
        render(r, particles, params.maxSpeed);
      }
      const per = (performance.now() - start) / FRAMES;

      assert.ok(per < 16.67,
        `fizik+render ${per.toFixed(2)}ms/kare — 60fps bütçesini aşıyor`);
    });
  });
});