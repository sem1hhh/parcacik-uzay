import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInteraction, updatePointer, stepInteraction,
  boostFor, setActive, snapPointer,
} from '../src/interaction.js';
import { CONFIG } from '../src/config.js';
import { makeParams } from '../src/physics.js';

const DT = CONFIG.fixedDt;
const params = () => makeParams();

function moveTo(inter, x, y) {
  updatePointer(inter, x, y);
  return stepInteraction(inter, DT, params());
}

describe('createInteraction', () => {
  it('başlangıç durumu geçerli', () => {
    const i = createInteraction({ x: 100, y: 200 });
    assert.equal(i.x, 100);
    assert.equal(i.y, 200);
    assert.equal(i.speed, 0);
    assert.equal(i.boost, 1);
    assert.equal(i.seen, false);
  });

  it('fare görülene kadar seen=false kalır', () => {
    const i = createInteraction({ x: 0, y: 0 });
    assert.equal(i.seen, false);
    updatePointer(i, 50, 50);
    assert.equal(i.seen, true);
  });
});

describe('stepInteraction — kuyu takibi', () => {
  it('kuyu fareye doğru hareket eder', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 100, 100);
    for (let s = 0; s < 200; s++) stepInteraction(i, DT, params());

    assert.ok(Math.hypot(i.x - 100, i.y - 100) < 1,
      `kuyu hedefe ulaşmadı: ${i.x},${i.y}`);
  });

  it('yumuşatma: kuyu ANINDA sıçramaz (kısmi hareket)', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 1000, 1000);
    stepInteraction(i, DT, params());

    assert.ok(i.x < 1000, `kuyu tek adımda hedefe ulaştı: ${i.x}`);
    assert.ok(i.x > 0, 'kuyu hiç hareket etmedi');
  });

  it('yumuşatma oranı: tek adımda yalnızca `smoothing` kadarı', () => {
    const s = 0.25;
    const i = createInteraction({ x: 0, y: 0, smoothing: s });
    updatePointer(i, 1000, 0);
    stepInteraction(i, DT, params());
    assert.ok(Math.abs(i.x - 1000 * s) < 1e-6,
      `beklenen ${1000 * s}, gerçek ${i.x}`);
  });

  it('yumuşatma katsayısı etkili', () => {
    const slow = createInteraction({ x: 0, y: 0, smoothing: 0.05 });
    const fast = createInteraction({ x: 0, y: 0, smoothing: 0.95 });
    updatePointer(slow, 100, 0); stepInteraction(slow, DT, params());
    updatePointer(fast, 100, 0); stepInteraction(fast, DT, params());
    assert.ok(fast.x > slow.x, 'yumuşatma etkisi yok');
  });

  it('smoothing=0 hareketsiz, 1 anında hedefe', () => {
    const still = createInteraction({ x: 0, y: 0, smoothing: 0 });
    updatePointer(still, 500, 500);
    stepInteraction(still, DT, params());
    assert.equal(still.x, 0, 'smoothing=0 hareket etti');

    const snap = createInteraction({ x: 0, y: 0, smoothing: 1 });
    updatePointer(snap, 500, 500);
    stepInteraction(snap, DT, params());
    assert.equal(snap.x, 500, 'smoothing=1 hedefe gitmedi');
  });

  it('NaN hedef kuyuyu bozmaz (korunur)', () => {
    const i = createInteraction({ x: 10, y: 10 });
    for (let s = 0; s < 50; s++) stepInteraction(i, DT, params());

    updatePointer(i, NaN, NaN);
    for (let s = 0; s < 20; s++) stepInteraction(i, DT, params());

    assert.ok(Number.isFinite(i.x), `kuyu NaN oldu: ${i.x}`);
    assert.ok(Number.isFinite(i.y), `kuyu NaN oldu: ${i.y}`);
    assert.ok(Number.isFinite(i.speed), `hız NaN oldu: ${i.speed}`);
  });

  it('Infinity hedef kuyuyu bozmaz', () => {
    const i = createInteraction({ x: 10, y: 10 });
    updatePointer(i, Infinity, -Infinity);
    for (let s = 0; s < 20; s++) stepInteraction(i, DT, params());
    assert.ok(Number.isFinite(i.x) && Number.isFinite(i.y));
  });

  it('fare hızı FARENİN hareketinden ölçülür (kuyunun değil)', () => {
    const i = createInteraction({ x: 0, y: 0, smoothing: 1 });
    updatePointer(i, 100, 0);
    stepInteraction(i, DT, params());
    updatePointer(i, 101, 0);
    stepInteraction(i, DT, params());

    assert.ok(i.speed < 12000 * 0.5,
      `hız kuyunun hareketinden ölçülüyor gibi: ${i.speed}`);
    assert.ok(i.speed > 0, 'hız sıfır');
  });
});

describe('boostFor — fare hızından güç ölçekleme', () => {
  it('durma hızında katsayı 1 (etkisiz)', () => {
    assert.ok(Math.abs(boostFor(0, 3.5) - 1) < 1e-9);
  });

  it('yavaş harekette neredeyse 1 (hassasiyet korunur)', () => {
    const b = boostFor(100, CONFIG.velocityBoost, CONFIG.boostReference, CONFIG.boostPower);
    assert.ok(b < 1.15, `yavaş harekette boost çok yüksek: ${b}`);
  });

  it('referans hızda tam güce ulaşır', () => {
    const b = boostFor(2000, 3.5, 2000, 0.8);
    assert.ok(Math.abs(b - 3.5) < 1e-9, `tam güç ulaşılmadı: ${b}`);
  });

  it('referans üstünde TAVANA yapışır (sonsuz büyüme yok)', () => {
    for (const s of [4000, 8000, 100000]) {
      assert.ok(Math.abs(boostFor(s, 3.5, 2000, 0.8) - 3.5) < 1e-9,
        `tavan aşıldı @${s}`);
    }
  });

  it('monoton artar', () => {
    let prev = 0;
    for (let s = 0; s <= 3000; s += 100) {
      const b = boostFor(s, 3.5);
      assert.ok(b >= prev, `azalan: ${prev} -> ${b}`);
      prev = b;
    }
  });

  it('boost=1 iken her zaman 1 (özellik kapalı)', () => {
    for (const s of [0, 500, 2000, 100000]) {
      assert.ok(Math.abs(boostFor(s, 1) - 1) < 1e-9);
    }
  });

  it('stepInteraction boost uygular', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 5000, 0);
    const src = stepInteraction(i, DT, params());
    assert.ok(src.strength > params().strength, 'boost uygulanmadı');
  });

  it('durgun kuyuda güç değişmez', () => {
    const i = createInteraction({ x: 0, y: 0 });
    for (let s = 0; s < 300; s++) stepInteraction(i, DT, params());

    const src = stepInteraction(i, DT, params());
    const base = params().strength;
    assert.equal(src.strength, base, 'hareket yokken güç değişmemeli');
    assert.equal(i.boost, 1);
    assert.equal(i.speed, 0);
  });

  it('çok yavaş fare hareketi boost uygulamaz (eşik altı)', () => {
    const i = createInteraction({ x: 0, y: 0 });
    let t = 0;
    for (let s = 0; s < 600; s++) {
      t += DT;
      updatePointer(i, 100 * t, 0);
      stepInteraction(i, DT, params());
    }
    assert.ok(Math.abs(i.speed - 100) / 100 < 0.1,
      `yumuşatılmış hız 100 px/s olmalı, ${i.speed.toFixed(1)}`);
    assert.ok(i.boost < 1.15, `yavaş harekette boost yüksek: ${i.boost.toFixed(3)}`);
  });
});

describe('setActive / snapPointer', () => {
  it('setActive kuyuyu kapatır', () => {
    const i = createInteraction({ x: 0, y: 0 });
    setActive(i, false);
    const src = stepInteraction(i, DT, params());
    assert.equal(src.active, false);
  });

  it('snapPointer kuyuyu anında hedefe taşır', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 500, 500);
    for (let s = 0; s < 10; s++) stepInteraction(i, DT, params());
    snapPointer(i, 300, 300);
    assert.equal(i.x, 300);
    assert.equal(i.targetX, 300);
    assert.equal(i.speed, 0);
    assert.equal(i.boost, 1, 'snap boost sıfırlamalı');
  });
});

describe('REGRESYON — hızlı fare hareketinde tepki', () => {
  it('boost olmadan hızlı farede tepki çöker (sorunun kaynağı)', () => {
    const noBoost = boostFor(2000, 1);
    assert.ok(Math.abs(noBoost - 1) < 1e-9, 'boost=1 iken ölçekleme olmamalı');
  });

  it('hızlı fare artık ESKİSİNDEN daha güçlü tepki verir', () => {
    const boosted = boostFor(2000, CONFIG.velocityBoost, CONFIG.boostReference, CONFIG.boostPower);
    assert.ok(boosted > 3,
      `varsayılan boost beklenenden zayıf: ${boosted}`);
  });

  it('yavaş hareket BOZULMAZ (regresyon koruması)', () => {
    const slowBoost = boostFor(120, CONFIG.velocityBoost, CONFIG.boostReference, CONFIG.boostPower);
    assert.ok(slowBoost < 1.2,
      `yavaş hareket etkileniyor: ${slowBoost}`);
  });
});

describe('etkileşim — dayanıklılık', () => {
  it('sıfır dt çökmüyor', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 100, 100);
    assert.doesNotThrow(() => stepInteraction(i, 0, params()));
    assert.ok(Number.isFinite(i.x));
  });

  it('çok büyük dt çökmüyor', () => {
    const i = createInteraction({ x: 0, y: 0 });
    updatePointer(i, 100, 100);
    assert.doesNotThrow(() => stepInteraction(i, 1000, params()));
  });

  it('dönen kaynak her zaman sonlu sayı', () => {
    const i = createInteraction({ x: 0, y: 0 });
    for (let s = 0; s < 2000; s++) {
      updatePointer(i, Math.random() * 3000, Math.random() * 2000);
      const src = stepInteraction(i, DT, params());
      assert.ok(Number.isFinite(src.x) && Number.isFinite(src.y), 'NaN konum');
      assert.ok(Number.isFinite(src.strength), 'NaN güç');
      assert.ok(src.strength > 0, 'güç sıfır/negatif');
    }
  });
});

import {
  createShockSystem, spawnShock, stepShocks, applyShocks, clearShocks,
} from '../src/interaction.js';
import { createParticles, spawnParticles, makeRandom } from '../src/particles.js';

function makeWorld(n = 200, seed = 3) {
  const w = createParticles(n);
  spawnParticles(w, 1280, 720, { count: n, random: makeRandom(seed) });
  return w;
}

describe('şok dalgası sistemi', () => {
  it('tıklama yeni dalga doğurur', () => {
    const s = createShockSystem();
    assert.equal(s.waves.length, 0);
    assert.equal(spawnShock(s, 100, 100), true);
    assert.equal(s.waves.length, 1);
    assert.equal(s.waves[0].x, 100);
    assert.equal(s.waves[0].radius, 0);
  });

  it('cooldown spam\'i engeller', () => {
    const s = createShockSystem();
    spawnShock(s, 0, 0);
    assert.equal(spawnShock(s, 0, 0), false, 'cooldown yok sayıldı');
    for (let i = 0; i < 60; i++) stepShocks(s, DT);
    assert.ok(s.cooldown <= 0);
    assert.equal(spawnShock(s, 0, 0), true);
  });

  it('dalga zamanla genişler', () => {
    const s = createShockSystem();
    spawnShock(s, 0, 0);
    stepShocks(s, DT);
    assert.ok(s.waves[0].radius > 0, 'dalga genişlemedi');
    const r1 = s.waves[0].radius;
    stepShocks(s, DT);
    assert.ok(s.waves[0].radius > r1, 'dalga genişlemeye devam etmiyor');
  });

  it('dalga maxRadius\'ı aşınca ölür', () => {
    const s = createShockSystem();
    spawnShock(s, 0, 0);
    for (let i = 0; i < 5000; i++) stepShocks(s, DT);
    assert.equal(s.waves.length, 0, 'ölü dalgalar temizlenmedi');
  });

  it('dalga parçacıkları dışarı iter', () => {
    const s = createShockSystem();
    const w = makeWorld(200);
    for (let i = 0; i < w.count; i++) { w.x[i] = 640; w.y[i] = 360; }
    for (let i = 0; i < w.count; i++) { w.vx[i] = 0; w.vy[i] = 0; }

    spawnShock(s, 640, 360);
    stepShocks(s, DT);
    const touched = applyShocks(s, w);

    assert.ok(touched > 0, 'hiç parçacık etkilenmedi');
    const moved = w.vx[0] !== 0 || w.vy[0] !== 0;
    assert.ok(moved, 'parçacık itilmedi');
  });

  it('dalga dışındaki parçacığa etki etmez', () => {
    const s = createShockSystem();
    const w = makeWorld(50);
    for (let i = 0; i < w.count; i++) { w.x[i] = 5000; w.y[i] = 5000; w.vx[i] = 0; w.vy[i] = 0; }
    spawnShock(s, 640, 360);
    const touched = applyShocks(s, w);
    assert.equal(touched, 0, 'uzaktaki parçacık etkilendi');
  });

  it('şok sonrası NaN yok', () => {
    const s = createShockSystem();
    const w = makeWorld(300);
    spawnShock(s, 640, 360);
    for (let i = 0; i < 200; i++) { stepShocks(s, DT); applyShocks(s, w); }
    for (let i = 0; i < w.count; i++) {
      assert.ok(Number.isFinite(w.vx[i]) && Number.isFinite(w.vy[i]), `NaN @${i}`);
    }
  });

  it('clearShocks her şeyi siler', () => {
    const s = createShockSystem();
    spawnShock(s, 0, 0);
    spawnShock(s, 10, 10);
    clearShocks(s);
    assert.equal(s.waves.length, 0);
    assert.equal(s.cooldown, 0);
  });

  it('dalga yokken applyShocks çalışır ve 0 döner', () => {
    const s = createShockSystem();
    const w = makeWorld(50);
    assert.equal(applyShocks(s, w), 0);
  });

  it('tekrarlanan şok sistemi patlatmaz', () => {
    const s = createShockSystem();
    const w = makeWorld(300);
    for (let f = 0; f < 2000; f++) {
      spawnShock(s, 640, 360);
      stepShocks(s, DT);
      applyShocks(s, w);
    }
    let nan = 0;
    for (let i = 0; i < w.count; i++) {
      if (!Number.isFinite(w.vx[i]) || !Number.isFinite(w.vy[i])) nan++;
    }
    assert.equal(nan, 0, 'spam şok sistemi patlattı');
  });
});
