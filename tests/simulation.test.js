import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createParticles, spawnParticles, stepWorld, particleStats, makeRandom } from '../src/particles.js';
import { SpatialGrid, cellSizeFor } from '../src/grid.js';
import { makeParams } from '../src/physics.js';
import { CONFIG, MODES } from '../src/config.js';
import {
  createInteraction, updatePointer, stepInteraction,
  createShockSystem, spawnShock, stepShocks, applyShocks, clearShocks,
} from '../src/interaction.js';
import { assignBuckets, resetBucketBuffers } from '../src/colors.js';

const W = 1280;
const H = 720;
const DT = CONFIG.fixedDt;

function createSim(count = 1200, seed = 42) {
  const particles = createParticles(count);
  spawnParticles(particles, W, H, { count, random: makeRandom(seed) });
  const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
  const params = makeParams();
  const inter = createInteraction({ x: W / 2, y: H / 2 });
  const shocks = createShockSystem();

  const sim = {
    particles, grid, params, inter, shocks,
    mode: 'attract',
    pressed: false,
    step(dt, cursorX, cursorY) {
      if (cursorX !== undefined) updatePointer(inter, cursorX, cursorY);
      const src = stepInteraction(inter, dt, params);

      let strength = src.strength;
      if (sim.mode === 'repel') {
        strength = -strength;
        params.shellRadius = 0;
      } else if (sim.mode === 'mixed') {
        params.shellRadius = CONFIG.shellRadius;
      } else {
        params.shellRadius = 0;
      }

      if (sim.pressed) {
        const { x, y, vx, vy, count: n } = particles;
        const k = CONFIG.dragStrength * dt;
        for (let i = 0; i < n; i++) {
          const dx = inter.targetX - x[i];
          const dy = inter.targetY - y[i];
          const d = Math.hypot(dx, dy);
          if (d < 1e-3) continue;
          const acc = k * (1 / (1 + d / 300)) * 400;
          vx[i] += (dx / d) * acc;
          vy[i] += (dy / d) * acc;
        }
      }

      stepWorld(particles, params, grid, dt, W, H, {
        x: src.x, y: src.y, active: true, strength,
      });

      stepShocks(shocks, dt);
      if (shocks.waves.length) applyShocks(shocks, particles);
    },
  };
  return sim;
}

function centerDensity(particles, cx, cy, radius = 150) {
  let inside = 0;
  for (let i = 0; i < particles.count; i++) {
    if (Math.hypot(particles.x[i] - cx, particles.y[i] - cy) <= radius) inside++;
  }
  return inside / particles.count;
}

function innerDensity(particles, cx, cy, shellR) {
  let inBand = 0;
  for (let i = 0; i < particles.count; i++) {
    const d = Math.hypot(particles.x[i] - cx, particles.y[i] - cy);
    if (d > shellR * 0.35 && d <= shellR * 0.85) inBand++;
  }
  return inBand / particles.count;
}

describe('modlar — davranış farkları', () => {
  it('attract: merkezi BOŞALTTIR (yörünge diski oluşur)', () => {
    const sim = createSim(800, 1);
    sim.mode = 'attract';
    const before = centerDensity(sim.particles, W / 2, H / 2, 150);
    for (let s = 0; s < 4000; s++) sim.step(DT);
    const after = centerDensity(sim.particles, W / 2, H / 2, 150);
    assert.ok(after < before,
      `merkez boşalmadı: doluluk %${(before * 100).toFixed(1)} -> %${(after * 100).toFixed(1)}`);
  });

  it('repel: merkezi DAĞITIR (itme etkisi)', () => {
    const sim = createSim(800, 1);
    sim.mode = 'repel';
    for (let i = 0; i < sim.particles.count; i++) {
      sim.particles.x[i] = W / 2; sim.particles.y[i] = H / 2;
      sim.particles.vx[i] = 0; sim.particles.vy[i] = 0;
    }
    const before = centerDensity(sim.particles, W / 2, H / 2, 150);
    for (let s = 0; s < 600; s++) sim.step(DT);
    const after = centerDensity(sim.particles, W / 2, H / 2, 150);
    assert.ok(after < before,
      `itme merkezi dağıtmadı: %${(before * 100).toFixed(1)} -> %${(after * 100).toFixed(1)}`);
  });

  it('repel: merkezdeki parçacık doğrudan dışarı fırlar', () => {
    const sim = createSim(100, 1);
    sim.mode = 'repel';
    for (let i = 0; i < 100; i++) {
      sim.particles.x[i] = W / 2 + 20; sim.particles.y[i] = H / 2;
      sim.particles.vx[i] = 0; sim.particles.vy[i] = 0;
    }
    const x0 = sim.particles.x[0];
    for (let s = 0; s < 120; s++) sim.step(DT);
    assert.ok(sim.particles.x[0] > x0,
      'repel modunda parçacık uzaklaşmadı (çekiyor gibi)');
  });

  it('mixed: denge kurar (ne tam çeker ne tam iter)', () => {
    const sim = createSim(800, 1);
    sim.mode = 'mixed';
    for (let s = 0; s < 4000; s++) sim.step(DT);
    const d = centerDensity(sim.particles, W / 2, H / 2);
    const attractD = (() => {
      const a = createSim(800, 1); a.mode = 'attract';
      for (let s = 0; s < 4000; s++) a.step(DT);
      return centerDensity(a.particles, W / 2, H / 2, 150);
    })();
    assert.ok(d > attractD,
      `karışık mod çekim gibi davranıyor: ${(d * 100).toFixed(1)}% <= ${(attractD * 100).toFixed(1)}%`);
  });

  it('üç mod birbirinden GERÇEKTEN farklı sonuç verir', () => {
    const center = {};
    for (const mode of MODES) {
      const sim = createSim(700, 7);
      sim.mode = mode;
      for (let s = 0; s < 8000; s++) sim.step(DT);
      center[mode] = centerDensity(sim.particles, W / 2, H / 2, 150);
    }
    const distinct = new Set(Object.values(center).map((v) => Math.round(v * 1000)));
    assert.ok(distinct.size >= 2,
      `modlar merkez yoğunluğuyla ayırt edilemiyor: ${JSON.stringify(center)}`);
    assert.ok(center.attract < center.repel,
      `attract merkezi boşaltmalı, repel doldurmalı: ${JSON.stringify(center)}`);

    const inner = {};
    for (const mode of ['attract', 'mixed']) {
      const sim = createSim(700, 7);
      sim.mode = mode;
      for (let s = 0; s < 8000; s++) sim.step(DT);
      inner[mode] = innerDensity(sim.particles, W / 2, H / 2, CONFIG.shellRadius);
    }
    assert.ok(inner.mixed > inner.attract * 2,
      `mixed kabuk oluşturmuyor: ${JSON.stringify(inner)}`);
  });
});

describe('fare hızı — hızlı hareket artık etkili', () => {
  function sweepResponse(sim, cursorSpeed) {
    for (let i = 0; i < sim.particles.count; i++) {
      sim.particles.x[i] = W / 2; sim.particles.y[i] = H / 2;
      sim.particles.vx[i] = 0; sim.particles.vy[i] = 0;
    }
    let peak = 0;
    const steps = Math.ceil(5 / DT);
    for (let s = 0; s < steps; s++) {
      sim.step(DT, s * DT * cursorSpeed, H / 2);
      for (let i = 0; i < sim.particles.count; i++) {
        const sp = Math.hypot(sim.particles.vx[i], sim.particles.vy[i]);
        if (sp > peak) peak = sp;
      }
    }
    return peak;
  }

  it('yavaş fare hâlâ güçlü tepki veriyor (regresyon koruması)', () => {
    const sim = createSim(100, 1);
    sim.mode = 'attract';
    const peak = sweepResponse(sim, 200);
    assert.ok(peak > 200, `yavaş fare tepkisi düştü: ${peak.toFixed(0)}`);
  });

  it('hızlı fare artık kaçırmıyor (asıl düzeltme)', () => {
    const sim = createSim(100, 1);
    sim.mode = 'attract';
    const peak = sweepResponse(sim, 2000);
    assert.ok(peak > 180,
      `hızlı fare hâlâ etkisiz: ${peak.toFixed(0)} px/s`);
  });

  it('çok hızlı fare de kabul edilebilir tepki veriyor', () => {
    const sim = createSim(100, 1);
    sim.mode = 'attract';
    const peak = sweepResponse(sim, 5000);
    assert.ok(peak > 100, `çok hızlı fare etkisiz: ${peak.toFixed(0)} px/s`);
  });

  it('boost kapalıyken hızlı fare zayıf kalır (fark ölçülebilir)', () => {
    const sim = createSim(100, 1);
    sim.inter.boostMax = 1;
    sim.mode = 'attract';
    const withoutBoost = sweepResponse(sim, 2000);

    const sim2 = createSim(100, 1);
    sim2.mode = 'attract';
    const withBoost = sweepResponse(sim2, 2000);

    assert.ok(withBoost > withoutBoost * 1.5,
      `boost etkisi yok: ${withoutBoost.toFixed(0)} -> ${withBoost.toFixed(0)}`);
  });
});

describe('sürükleme (basılı tutma)', () => {
  it('basılıyken parçacıklar fareye yaklaşır', () => {
    const sim = createSim(600, 1);
    sim.mode = 'attract';
    for (let s = 0; s < 600; s++) sim.step(DT);
    sim.pressed = true;
    const before = centerDensity(sim.particles, W / 2, H / 2, 200);
    for (let s = 0; s < 900; s++) sim.step(DT, W / 2, H / 2);
    const after = centerDensity(sim.particles, W / 2, H / 2, 200);
    assert.ok(after > before,
      `sürükleme merkeze toplamadı: %${(before * 100).toFixed(1)} -> %${(after * 100).toFixed(1)}`);
  });

  it('bırakılınca sürükleme durur', () => {
    const sim = createSim(300, 1);
    sim.pressed = true;
    for (let s = 0; s < 300; s++) sim.step(DT, W / 2, H / 2);
    sim.pressed = false;
    const a = Float32Array.from(sim.particles.x);
    for (let s = 0; s < 50; s++) sim.step(DT, W / 2, H / 2);
    for (let i = 0; i < sim.particles.count; i++) {
      assert.ok(Number.isFinite(sim.particles.x[i]), 'NaN');
    }
    assert.ok(a.length === sim.particles.x.length);
  });
});

describe('şok dalgası — uçtan uca', () => {
  it('tıklama hızı dramatik artırır', () => {
    const sim = createSim(1000, 1);
    sim.mode = 'attract';
    for (let s = 0; s < 500; s++) sim.step(DT);
    const before = particleStats(sim.particles).avgSpeed;

    spawnShock(sim.shocks, W / 2, H / 2);
    for (let s = 0; s < 60; s++) sim.step(DT);
    const after = particleStats(sim.particles).avgSpeed;

    assert.ok(after > before * 1.3,
      `şok hızı artırmadı: ${before.toFixed(1)} -> ${after.toFixed(1)}`);
  });

  it('şok sonrası sistem hâlâ kararlı (NaN/tavan)', () => {
    const sim = createSim(800, 1);
    sim.mode = 'mixed';
    for (let f = 0; f < 60; f++) {
      spawnShock(sim.shocks, 300 + f * 10, 300);
      for (let s = 0; s < 4; s++) sim.step(DT);
    }
    const st = particleStats(sim.particles, sim.params.maxSpeed);
    assert.equal(st.nan, 0, 'şok sonrası NaN');
    assert.ok(st.maxSpeed <= sim.params.maxSpeed + 1e-3, 'şok tavanı aştı');
  });

  it('spam tıklama sistemi bozmaz', () => {
    const sim = createSim(600, 1);
    sim.pressed = true;
    for (let f = 0; f < 400; f++) {
      updatePointer(sim.inter, Math.random() * W, Math.random() * H);
      spawnShock(sim.shocks, Math.random() * W, Math.random() * H);
      for (let s = 0; s < 3; s++) sim.step(DT);
    }
    const st = particleStats(sim.particles, sim.params.maxSpeed);
    assert.equal(st.nan, 0);
    assert.ok(st.maxSpeed <= sim.params.maxSpeed + 1e-3);
  });
});

describe('karma mod — uçtan uca kararlılık', () => {
  it('mod + fare + şok birlikte 30.000 adım dayanır', () => {
    resetBucketBuffers();
    const sim = createSim(1000, 99);

    for (let s = 0; s < 30000; s++) {
      sim.mode = MODES[Math.floor(s / 3000) % MODES.length];
      const t = s * DT;
      sim.step(DT, W / 2 + Math.cos(t * 2) * 500, H / 2 + Math.sin(t * 3) * 300);
      if (s % 400 === 0) spawnShock(sim.shocks, W / 2, H / 2);
      sim.pressed = s % 900 < 120;

      if (s % 5000 === 0) {
        const { bucketStart } = assignBuckets(
          sim.particles.vx, sim.particles.vy, sim.particles.count,
          sim.params.maxSpeed, CONFIG.colorBuckets
        );
        assert.equal(bucketStart[CONFIG.colorBuckets], sim.particles.count,
          `${s}. adımda kovalama kaybı`);
      }
    }

    const st = particleStats(sim.particles, sim.params.maxSpeed);
    assert.equal(st.nan, 0, 'NaN üretildi');
    assert.equal(st.count, 1000);
    assert.ok(st.maxSpeed <= sim.params.maxSpeed + 1e-3, 'tavan aşıldı');
    clearShocks(sim.shocks);
  });
});