import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, RANGES } from '../src/config.js';
import { SpatialGrid, cellSizeFor } from '../src/grid.js';
import {
  createParticles, spawnParticles, spawnIntro, stepWorld,
  particleStats, makeRandom,
} from '../src/particles.js';
import { makeParams } from '../src/physics.js';
import { assignBuckets, buildLUT, resetBucketBuffers } from '../src/colors.js';
import { createRenderer, resizeRenderer, render } from '../src/renderer.js';

const W = 1280;
const H = 720;
const DT = CONFIG.fixedDt;
const FRAME_BUDGET = 16.67;

function scene(count, seed = 1, intro = false) {
  const world = createParticles(RANGES.count.max);
  if (intro) {
    spawnIntro(world, W, H, { count, burstSpeed: 514, random: makeRandom(seed) });
  } else {
    spawnParticles(world, W, H, { count, random: makeRandom(seed) });
  }
  const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
  const params = makeParams();
  return { world, grid, params };
}

function bench(fn, frames, warmup = 60) {
  for (let i = 0; i < warmup; i++) fn(i);
  const t = performance.now();
  for (let i = 0; i < frames; i++) fn(i);
  return (performance.now() - t) / frames;
}

describe('performans — fizik', () => {
  it('3000 parçacıkta fizik adımı 60fps bütçesinin %10\'undan az', () => {
    const { world, grid, params } = scene(3000, 1);
    const ms = bench((f) => {
      stepWorld(world, params, grid, DT, W, H, {
        x: 640 + Math.cos(f * 0.01) * 300, y: 360, active: true, strength: params.strength,
      });
    }, 120);

    assert.ok(ms < FRAME_BUDGET * 0.1,
      `fizik ${ms.toFixed(2)}ms/kare — bütçenin %10'unu aşıyor (${(ms / FRAME_BUDGET * 100).toFixed(1)}%)`);
  });

  it('4000 parçacıkta (slider maksimumu) da bütçeye sığar', () => {
    const { world, grid, params } = scene(RANGES.count.max, 2);
    const ms = bench(() => {
      stepWorld(world, params, grid, DT, W, H,
        { x: 640, y: 360, active: true, strength: params.strength });
    }, 80);

    assert.ok(ms < FRAME_BUDGET * 0.25,
      `4000 parçacıkta fizik ${ms.toFixed(2)}ms — fazla`);
  });

  it('daha fazla parçacık doğrusal-olmayan biçimde patlamıyor', () => {
    const t2000 = bench(() => {
      const s = scene(2000, 3);
      stepWorld(s.world, s.params, s.grid, DT, W, H,
        { x: 640, y: 360, active: true, strength: s.params.strength });
    }, 40, 5);

    const t4000 = bench(() => {
      const s = scene(4000, 3);
      stepWorld(s.world, s.params, s.grid, DT, W, H,
        { x: 640, y: 360, active: true, strength: s.params.strength });
    }, 40, 5);

    assert.ok(t4000 < t2000 * 8,
      `4000 parçacık ${t2000.toFixed(2)}ms'den ${(t4000 / t2000).toFixed(1)} kat yavaş — kuadratik`);
  });

  it('açılış animasyonu sırasında da bütçede kalır', () => {
    const { world, grid, params } = scene(3000, 5, true);
    const ms = bench((f) => {
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < world.count; i++) {
        const dx = world.x[i] - cx;
        const dy = world.y[i] - cy;
        const d = Math.hypot(dx, dy);
        if (d < 1e-3) continue;
        world.vx[i] += (dx / d) * 900 * DT;
        world.vy[i] += (dy / d) * 900 * DT;
      }
      stepWorld(world, params, grid, DT, W, H,
        { x: cx, y: cy, active: false, strength: params.strength });
    }, 80);

    assert.ok(ms < FRAME_BUDGET * 0.3,
      `açılışta ${ms.toFixed(2)}ms — en yoğun an bütçeyi aşıyor`);
  });
});

describe('performans — renk kovalama', () => {
  it('kovalama O(n) ve bütçenin %5\'inden az', () => {
    const world = createParticles(3000);
    spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });
    resetBucketBuffers();

    const ms = bench(() => {
      assignBuckets(world.vx, world.vy, world.count, CONFIG.maxSpeed, CONFIG.colorBuckets);
    }, 300, 50);

    assert.ok(ms < FRAME_BUDGET * 0.05,
      `kovalama ${ms.toFixed(3)}ms — beklenenden yavaş`);
  });

  it('LUT bir kez üretilir, kare başına değil', () => {
    const ms = bench(() => buildLUT(CONFIG.colorBuckets), 20);
    assert.ok(ms < 5, `LUT üretimi ${ms.toFixed(2)}ms`);
  });
});

describe('performans — istatistik', () => {
  it('particleStats tek geçişte ve hızlı', () => {
    const world = createParticles(3000);
    spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });

    const ms = bench(() => particleStats(world, CONFIG.maxSpeed), 300, 50);
    assert.ok(ms < FRAME_BUDGET * 0.02,
      `istatistik ${ms.toFixed(3)}ms`);
  });
});

describe('performans — bellek (allocation)', () => {
  it('kare başına yeni nesne üretilmiyor', () => {
    const { world, grid, params } = scene(3000, 7);
    for (let f = 0; f < 200; f++) {
      stepWorld(world, params, grid, DT, W, H,
        { x: 640, y: 360, active: true, strength: params.strength });
      assignBuckets(world.vx, world.vy, world.count, params.maxSpeed, CONFIG.colorBuckets);
      particleStats(world, params.maxSpeed);
    }

    const before = process.memoryUsage().heapUsed;
    const FRAMES = 2000;

    for (let f = 0; f < FRAMES; f++) {
      stepWorld(world, params, grid, DT, W, H,
        { x: 640, y: 360, active: true, strength: params.strength });
      assignBuckets(world.vx, world.vy, world.count, params.maxSpeed, CONFIG.colorBuckets);
      particleStats(world, params.maxSpeed);
    }

    const growth = process.memoryUsage().heapUsed - before;
    const perFrame = growth / FRAMES;

    assert.ok(perFrame < 512,
      `kare başına ${perFrame.toFixed(0)} bayt artış — allocation var`);
  });

  it('renk tamponları yeniden kullanılıyor (module-level cache)', () => {
    const world = createParticles(1000);
    spawnParticles(world, W, H, { count: 1000, random: makeRandom(1) });
    resetBucketBuffers();

    const a = assignBuckets(world.vx, world.vy, 1000, CONFIG.maxSpeed, 64);
    const firstOrder = a.order;
    const b = assignBuckets(world.vx, world.vy, 1000, CONFIG.maxSpeed, 64);
    assert.equal(b.order, firstOrder, 'tampon yeniden ayrıldı');
  });
});

describe('performans — render hattı (stub)', () => {
  it('render algoritması bütçeye sığır', () => {
    const original = globalThis.document;
    globalThis.document = {
      createElement: () => ({
        width: 0, height: 0, style: {},
        getContext: () => new Proxy({}, {
          get: (t, k) => (k in t ? t[k] : (() => {})),
          set: (t, k, v) => { t[k] = v; return true; },
        }),
      }),
    };

    try {
      const canvas = {
        width: 0, height: 0, style: {},
        getContext: () => new Proxy({}, {
          get: (t, k) => (k in t ? t[k] : (() => {})),
          set: (t, k, v) => { t[k] = v; return true; },
        }),
      };
      const r = createRenderer(canvas);
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const world = createParticles(3000);
      spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });

      const ms = bench(() => render(r, world, CONFIG.maxSpeed), 100, 30);
      assert.ok(ms < FRAME_BUDGET * 0.5,
        `render algoritması ${ms.toFixed(2)}ms`);
    } finally {
      globalThis.document = original;
    }
  });

  it('kova sayısı sabit kalıyor (parçacık sayısı artsa bile)', () => {
    const original = globalThis.document;
    globalThis.document = { createElement: () => mkCanvas() };

    try {
      const r = createRenderer(mkCanvas());
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const world = createParticles(3000);
      spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });
      for (let i = 0; i < 3000; i++) {
        const f = i / 3000;
        world.vx[i] = f * CONFIG.maxSpeed;
        world.vy[i] = 0;
      }
      resetBucketBuffers();
      const { bucketStart } = assignBuckets(
        world.vx, world.vy, 3000, CONFIG.maxSpeed, CONFIG.colorBuckets
      );
      let used = 0;
      for (let b = 0; b < CONFIG.colorBuckets; b++) {
        if (bucketStart[b + 1] > bucketStart[b]) used++;
      }
      assert.equal(used, CONFIG.colorBuckets,
        `tüm kovalar dolu olmalı, ${used} dolu`);
    } finally {
      globalThis.document = original;
    }
  });
});

function mkCanvas() {
  return {
    width: 0, height: 0, style: {},
    getContext: () => new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : (() => {})),
      set: (t, k, v) => { t[k] = v; return true; },
    }),
  };
}

describe('tam döngü — 3000 parçacık 60fps', () => {
  it('fizik + render birlikte bütçeye sığar', () => {
    const original = globalThis.document;
    globalThis.document = { createElement: () => mkCanvas() };

    try {
      const r = createRenderer(mkCanvas());
      resizeRenderer(r, W, H, 1);
      r.trailsEnabled = false;

      const world = createParticles(3000);
      spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });
      const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
      const params = makeParams();
      resetBucketBuffers();

      const ms = bench((f) => {
        stepWorld(world, params, grid, DT, W, H, {
          x: 640 + Math.cos(f * 0.02) * 250, y: 360, active: true, strength: params.strength,
        });
        render(r, world, params.maxSpeed);
        particleStats(world, params.maxSpeed);
      }, 100, 30);

      assert.ok(ms < FRAME_BUDGET,
        `tam döngü ${ms.toFixed(2)}ms/kare — 60fps bütçesini aşıyor ` +
        `(render gerçek Canvas'ta daha pahalı olacak)`);
    } finally {
      globalThis.document = original;
    }
  });

  it('DPR 2 bile JS tarafını zorlamıyor', () => {
    const original = globalThis.document;
    globalThis.document = { createElement: () => mkCanvas() };

    try {
      const r = createRenderer(mkCanvas());
      resizeRenderer(r, W, H, 2);
      r.trailsEnabled = false;

      const world = createParticles(3000);
      spawnParticles(world, W, H, { count: 3000, random: makeRandom(1) });
      const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
      const params = makeParams();
      resetBucketBuffers();

      const ms = bench(() => {
        stepWorld(world, params, grid, DT, W, H,
          { x: 640, y: 360, active: true, strength: params.strength });
        render(r, world, params.maxSpeed);
      }, 80, 20);

      assert.ok(ms < FRAME_BUDGET,
        `DPR 2'de JS ${ms.toFixed(2)}ms — beklenenden yavaş`);
    } finally {
      globalThis.document = original;
    }
  });
});