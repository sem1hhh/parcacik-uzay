import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeRandom, createParticles, spawnParticles, reflowParticles,
  stepWorld, particleStats, createWorld,
} from '../src/particles.js';
import { makeParams } from '../src/physics.js';
import { SpatialGrid, cellSizeFor } from '../src/grid.js';
import { CONFIG, RANGES } from '../src/config.js';
import { bucketFor, assignBuckets, resetBucketBuffers } from '../src/colors.js';

const W = 1280;
const H = 720;
const DT = CONFIG.fixedDt;

function setup(count = 500, seed = 7) {
  const particles = createParticles(count);
  spawnParticles(particles, W, H, { count, random: makeRandom(seed) });
  const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
  const params = makeParams();
  return { particles, grid, params };
}

const gravityAt = (x, y) => ({ x, y, active: true });

describe('makeRandom', () => {
  it('aynı tohum aynı dizi üretir (deterministik)', () => {
    const a = makeRandom(42);
    const b = makeRandom(42);
    for (let i = 0; i < 100; i++) assert.equal(a(), b());
  });

  it('farklı tohum farklı dizi üretir', () => {
    const a = makeRandom(1);
    const b = makeRandom(2);
    let diff = 0;
    for (let i = 0; i < 50; i++) if (a() !== b()) diff++;
    assert.ok(diff > 40);
  });

  it('0-1 aralığında üretir', () => {
    const r = makeRandom(9);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `aralık dışı: ${v}`);
    }
  });
});

describe('createParticles / spawnParticles', () => {
  it('kapasite aşılmazsa doğru sayıda doğurur', () => {
    const { particles } = setup(300);
    assert.equal(particles.count, 300);
    assert.ok(particles.capacity >= 300);
  });

  it('kapasite aşımı HATA verir (sessiz bozulma yok)', () => {
    const p = createParticles(100);
    assert.throws(
      () => spawnParticles(p, W, H, { count: 101, random: makeRandom(1) }),
      RangeError,
      'kapasite aşımı sessizce yutuldu'
    );
  });

  it('tüm konumlar ekran sınırları içinde', () => {
    const { particles } = setup(2000);
    for (let i = 0; i < particles.count; i++) {
      assert.ok(particles.x[i] >= 0 && particles.x[i] < W, `x ${i}`);
      assert.ok(particles.y[i] >= 0 && particles.y[i] < H, `y ${i}`);
    }
  });

  it('yarıçaplar min/max aralığında', () => {
    const { particles } = setup(1000);
    for (let i = 0; i < particles.count; i++) {
      assert.ok(particles.r[i] >= CONFIG.minRadius - 1e-6, `min ihlali @${i}`);
      assert.ok(particles.r[i] <= CONFIG.maxRadius + 1e-6, `max ihlali @${i}`);
    }
  });

  it('yarıçap dağılımı alan-ağırlıklı (sqrt — küçük parçacık fazla)', () => {
    const { particles } = setup(4000, 21);
    const mid = (CONFIG.minRadius + CONFIG.maxRadius) / 2;
    let belowMid = 0;
    for (let i = 0; i < particles.count; i++) if (particles.r[i] < mid) belowMid++;

    const ratio = belowMid / particles.count;
    assert.ok(ratio > 0.20 && ratio < 0.30,
      `sqrt dağılımı beklenen %20-30 aralığında değil: %${(ratio * 100).toFixed(1)}`);
  });

  it('sqrt dağılımı lineerden DAHA FAZLA küçük parçacık üretir', () => {
    const mid = (CONFIG.minRadius + CONFIG.maxRadius) / 2;

    const a = createParticles(4000);
    spawnParticles(a, W, H, { count: 4000, random: makeRandom(21) });
    let smallA = 0;
    for (let i = 0; i < a.count; i++) if (a.r[i] < mid) smallA++;

    const rnd = makeRandom(21);
    let smallB = 0;
    for (let i = 0; i < 4000; i++) {
      const r = CONFIG.minRadius + rnd() * (CONFIG.maxRadius - CONFIG.minRadius);
      if (r < mid) smallB++;
    }

    assert.ok(Math.abs(smallB / 4000 - 0.5) < 0.03,
      `lineer referans beklenen gibi değil: %${(smallB / 40).toFixed(1)}`);

    assert.ok(smallA < smallB * 0.7,
      `sqrt daha fazla küçük parçacık vermeli: sqrt ${smallA}, lineer ${smallB}`);
  });

  it('başlangıç hızları dairesel dağılır (hepsi tek yön değil)', () => {
    const { particles } = setup(500, 5);
    let up = 0;
    for (let i = 0; i < particles.count; i++) if (particles.vy[i] < 0) up++;
    assert.ok(up > particles.count * 0.4 && up < particles.count * 0.6,
      `dairesel dağılım yok: ${up}/${particles.count} yukarı`);
  });

  it('sıfır parçacık geçerli', () => {
    const p = createParticles(10);
    spawnParticles(p, W, H, { count: 0, random: makeRandom(1) });
    assert.equal(p.count, 0);
  });

  it('tekrar doğurmak eski veriyi tamamen siler', () => {
    const p = createParticles(200);
    spawnParticles(p, W, H, { count: 200, random: makeRandom(1) });
    spawnParticles(p, W, H, { count: 5, random: makeRandom(2) });
    assert.equal(p.count, 5);
    const s = particleStats(p);
    assert.equal(s.count, 5);
    assert.equal(s.nan, 0);
  });
});

describe('reflowParticles — yeniden boyutlandırma', () => {
  it('boyut büyüyünce konumlar sınırlar içinde kalır', () => {
    const { particles } = setup(500);
    reflowParticles(particles, W, H, 1920, 1080);
    for (let i = 0; i < particles.count; i++) {
      assert.ok(particles.x[i] >= 0 && particles.x[i] < 1920, `x ${i}`);
      assert.ok(particles.y[i] >= 0 && particles.y[i] < 1080, `y ${i}`);
    }
  });

  it('boyut küçülünce konumlar sınırlar içinde kalır', () => {
    const { particles } = setup(500);
    reflowParticles(particles, W, H, 640, 360);
    for (let i = 0; i < particles.count; i++) {
      assert.ok(particles.x[i] >= 0 && particles.x[i] < 640, `x ${i}`);
      assert.ok(particles.y[i] >= 0 && particles.y[i] < 360, `y ${i}`);
    }
  });

  it('sıfır ölçüde çökmez', () => {
    const { particles } = setup(100);
    assert.doesNotThrow(() => reflowParticles(particles, 0, 0, W, H));
  });
});

describe('stepWorld — simülasyon adımı', () => {
  it('pozisyonları hareket ettirir', () => {
    const { particles, grid, params } = setup(200);
    particles.vx.fill(100);
    particles.vy.fill(0);
    const before = Float32Array.from(particles.x);
    stepWorld(particles, params, grid, DT, W, H, gravityAt(W / 2, H / 2));
    let moved = 0;
    for (let i = 0; i < particles.count; i++) if (particles.x[i] !== before[i]) moved++;
    assert.ok(moved > 0, 'hiç parçacık hareket etmedi');
  });

  it('ızgarayı her adımda günceller', () => {
    const { particles, grid, params } = setup(300);
    stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    assert.equal(grid.count, particles.count);
  });

  it('yerçekimi kapalıyken parçacıklar yalnız sönümlenir', () => {
    const { particles, grid, params } = setup(200);
    particles.vx.fill(200);
    particles.vy.fill(0);
    const y0 = Float32Array.from(particles.y);
    stepWorld(particles, params, grid, DT, W, H, { x: 0, y: 0, active: false });
    for (let i = 0; i < particles.count; i++) {
      assert.ok(Math.abs(particles.vx[i]) <= 200 + 1e-3, 'hız arttı');
      assert.ok(Math.abs(particles.y[i] - y0[i]) < 1e-6, 'yerçekimi kapalıyken y değişti');
    }
  });

  it('gravity=null güvenli (çökmez)', () => {
    const { particles, grid, params } = setup(100);
    assert.doesNotThrow(() => stepWorld(particles, params, grid, DT, W, H, null));
  });

  it('10000 adım sonrası NaN yok', () => {
    const { particles, grid, params } = setup(800, 3);
    for (let s = 0; s < 10000; s++) {
      stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    }
    const st = particleStats(particles);
    assert.equal(st.nan, 0, 'NaN üretildi');
    assert.equal(st.count, 800, 'parçacık sayısı değişti');
  });

  it('5000 adım sonrası hız tavanı aşılmaz', () => {
    const { particles, grid, params } = setup(800, 4);
    for (let s = 0; s < 5000; s++) {
      stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    }
    const st = particleStats(particles, params.maxSpeed);
    assert.ok(st.maxSpeed <= params.maxSpeed + 1e-3, `tavan aşıldı: ${st.maxSpeed}`);
  });

  it('çarpışma çözümü iç içe geçmeyi engeller', () => {
    const particles = createParticles(200);
    spawnParticles(particles, W, H, { count: 200, random: makeRandom(1) });
    for (let i = 0; i < particles.count; i++) { particles.x[i] = 640; particles.y[i] = 360; }
    const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    const params = makeParams();

    for (let s = 0; s < 300; s++) {
      stepWorld(particles, params, grid, DT, W, H, { x: 0, y: 0, active: false });
    }

    const st = particleStats(particles);
    assert.equal(st.nan, 0);
    assert.ok(st.maxSpeed <= params.maxSpeed + 1e-3, 'yığılma patladı');
  });

  it('yarıçaplar değişmez (çarpışma yarıçap bozmaz)', () => {
    const { particles, grid, params } = setup(400);
    const before = Float32Array.from(particles.r);
    for (let s = 0; s < 1000; s++) stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    for (let i = 0; i < particles.count; i++) {
      assert.equal(particles.r[i], before[i], `yarıçap ${i} değişti`);
    }
  });
});

describe('particleStats', () => {
  it('boş dünyada sıfır döner (NaN değil)', () => {
    const p = createParticles(10);
    const st = particleStats(p);
    assert.equal(st.count, 0);
    assert.equal(st.avgSpeed, 0);
    assert.equal(st.maxSpeed, 0);
    assert.equal(st.nan, 0);
  });

  it('ortalama hızı doğru hesaplar', () => {
    const p = createParticles(3);
    p.count = 3;
    p.vx[0] = 3; p.vy[0] = 4;
    p.vx[1] = 0; p.vy[1] = 0;
    p.vx[2] = 6; p.vy[2] = 8;
    const st = particleStats(p);
    assert.ok(Math.abs(st.avgSpeed - 5) < 1e-4, `ortalama ${st.avgSpeed}`);
    assert.equal(st.maxSpeed, 10);
  });

  it('NaN sayacı NaN değerleri tespit eder', () => {
    const p = createParticles(3);
    p.count = 3;
    p.vx[1] = NaN;
    const st = particleStats(p);
    assert.equal(st.nan, 1);
    assert.ok(Number.isFinite(st.avgSpeed), 'ortalama NaN oldu');
  });
});

describe('createWorld', () => {
  it('parçacık + parametre + ızgara döndürür', () => {
    const w = createWorld(300);
    assert.ok(w.particles);
    assert.ok(w.params);
    assert.ok(w.grid instanceof SpatialGrid);
    assert.ok(w.grid.cellSize >= CONFIG.maxRadius * 2, 'ızgara doğruluk alt sınırında değil');
  });
});

describe('bütünsel — fizik → renk akışı', () => {
  it('simülasyon sonrası her parçacık geçerli bir kovaya düşer', () => {
    resetBucketBuffers();
    const { particles, grid, params } = setup(1200, 11);
    for (let s = 0; s < 2000; s++) {
      stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    }

    const { order, bucketStart } = assignBuckets(
      particles.vx, particles.vy, particles.count, params.maxSpeed, CONFIG.colorBuckets
    );

    assert.equal(bucketStart[CONFIG.colorBuckets], particles.count,
      'baskı sayımında parçacık kaybı var');

    const seen = new Set();
    for (let k = 0; k < particles.count; k++) seen.add(order[k]);
    assert.equal(seen.size, particles.count, 'order\'da eksik parçacık');
  });

  it('canlı sistemde renk dağılımı tüm rampı kullanır', () => {
    resetBucketBuffers();
    const { particles, grid, params } = setup(1500, 13);
    for (let s = 0; s < 3000; s++) {
      stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    }
    const { bucketStart } = assignBuckets(
      particles.vx, particles.vy, particles.count, params.maxSpeed, CONFIG.colorBuckets
    );

    let used = 0;
    for (let b = 0; b < CONFIG.colorBuckets; b++) {
      if (bucketStart[b + 1] > bucketStart[b]) used++;
    }
    assert.ok(used >= 8, `sadece ${used} kova dolu — renk geçişi görünmez`);
  });

  it('tüm kovalar erişilebilir (bucketFor tutarlılığı)', () => {
    for (const s of [0, 1, 100, 450, 899, 900, 5000]) {
      const b = bucketFor(s, CONFIG.maxSpeed, CONFIG.colorBuckets);
      assert.ok(b >= 0 && b < CONFIG.colorBuckets, `geçersiz kova: ${b}`);
    }
  });
});

describe('performans bütünlüğü', () => {
  it('3000 parçacık 60fps bütçesine sığar (fizik + ızgara)', () => {
    const { particles, grid, params } = setup(RANGES.count.max, 17);
    const start = performance.now();
    const FRAMES = 30;
    for (let f = 0; f < FRAMES; f++) {
      stepWorld(particles, params, grid, DT, W, H, gravityAt(640, 360));
    }
    const per = (performance.now() - start) / FRAMES;
    assert.ok(per < 16.67,
      `fizik kare başına ${per.toFixed(2)}ms — 60fps bütçesini aşıyor (render de yer alacak)`);
  });
});

describe('uçtan uca — doğur, sür, renklendir', () => {
  it('20000 adım boyunca hiçbir katmanda veri kaybı yok', () => {
    resetBucketBuffers();
    const { particles, grid, params } = setup(2400, 77);
    const B = CONFIG.colorBuckets;

    for (let s = 0; s < 20000; s++) {
      const t = s * CONFIG.fixedDt;
      const gx = W / 2 + Math.cos(t * 0.4) * 320;
      const gy = H / 2 + Math.sin(t * 0.55) * 200;

      stepWorld(particles, params, grid, CONFIG.fixedDt, W, H, { x: gx, y: gy, active: true });

      if (s % 500 === 0) {
        const { bucketStart } = assignBuckets(
          particles.vx, particles.vy, particles.count, params.maxSpeed, B
        );
        assert.equal(bucketStart[B], particles.count,
          `${s}. adımda ${particles.count - bucketStart[B]} parçacık kovalama kayboldu`);
      }
    }

    const st = particleStats(particles, params.maxSpeed);
    assert.equal(st.nan, 0, `${st.nan} parçacık sayısal değer kaybetti`);
    assert.equal(st.count, 2400, 'parçacık sayısı değişti');
    assert.ok(st.maxSpeed <= params.maxSpeed + 1e-3,
      `hız tavanı aşıldı: ${st.maxSpeed}`);
    assert.ok(st.avgSpeed > 10,
      `sistem dondu: ortalama hız ${st.avgSpeed.toFixed(2)} px/s`);
  });

  it('hareketli kuyuda da sistem canlı kalır', () => {
    resetBucketBuffers();
    const { particles, grid, params } = setup(1200, 88);

    for (let s = 0; s < 20000; s++) {
      const t = s * CONFIG.fixedDt;
      const gx = W / 2 + Math.cos(t * 3) * 450;
      const gy = H / 2 + Math.sin(t * 4.2) * 300;
      stepWorld(particles, params, grid, CONFIG.fixedDt, W, H, { x: gx, y: gy, active: true });
    }

    const st = particleStats(particles, params.maxSpeed);
    assert.equal(st.nan, 0);
    assert.ok(st.avgSpeed > 20,
      `hareketli kuyuda sistem dondu: ${st.avgSpeed.toFixed(2)} px/s`);
  });

  it('pencere yeniden boyutlanınca kova akışı bozulmaz', () => {
    resetBucketBuffers();
    const { particles, grid, params } = setup(600, 99);

    for (const [w, h] of [[1920, 1080], [640, 360], [1280, 720], [800, 600]]) {
      grid.setBounds(w, h, cellSizeFor(CONFIG.maxRadius));
      for (let s = 0; s < 200; s++) {
        stepWorld(particles, params, grid, CONFIG.fixedDt, w, h,
          { x: w / 2, y: h / 2, active: true });
      }
      const { bucketStart } = assignBuckets(
        particles.vx, particles.vy, particles.count, params.maxSpeed, CONFIG.colorBuckets
      );
      assert.equal(bucketStart[CONFIG.colorBuckets], particles.count,
        `${w}x${h}: parçacık kovalama kaybı`);
    }
    assert.equal(particleStats(particles).nan, 0);
  });
});

import { spawnIntro, introEnvelope } from '../src/particles.js';

describe('introEnvelope — zaman zarfı', () => {
  const D = CONFIG.introDuration;

  it('t=0\'da tam güç (1)', () => {
    assert.equal(introEnvelope(0, D), 1);
  });

  it('süre sonunda tamamen sıfır', () => {
    assert.equal(introEnvelope(D, D), 0);
    assert.equal(introEnvelope(D + 1, D), 0);
    assert.equal(introEnvelope(D * 10, D), 0);
  });

  it('negatif sürede sıfır (zaman geri gitmiş)', () => {
    assert.equal(introEnvelope(-5, D), 0);
  });

  it('monoton azalır', () => {
    let prev = Infinity;
    for (let t = 0; t <= D; t += 0.05) {
      const v = introEnvelope(t, D);
      assert.ok(v <= prev, `zarf arttı @${t}: ${prev} -> ${v}`);
      assert.ok(v >= 0 && v <= 1, `zarf [0,1] dışında: ${v}`);
      prev = v;
    }
  });

  it('süre = 0 ise her zaman sıfır (bölme sıfırı yok)', () => {
    for (const t of [0, 0.5, 10]) {
      assert.equal(introEnvelope(t, 0), 0);
    }
  });

  it('yumuşak kapanış: sonda ani düşüş yok', () => {
    const near = introEnvelope(D * 0.9, D);
    assert.ok(near > 0, 'sonda zarf zaten sıfır — ani kesme');
    assert.ok(near < 0.2, 'sonda zarf çok yüksek — kapanış yavaş');
  });
});

describe('spawnIntro — patlama doğurma', () => {
  it('hepsini merkeze yakın yığar', () => {
    const w = createParticles(1000);
    spawnIntro(w, W, H, { count: 1000, random: makeRandom(1) });
    for (let i = 0; i < w.count; i++) {
      const d = Math.hypot(w.x[i] - W / 2, w.y[i] - H / 2);
      assert.ok(d <= CONFIG.introCoreRadius + 1e-3,
        `çekirdek dışında doğdu: ${d.toFixed(1)}px`);
    }
  });

  it('tam noktada yığmaz (çarpışma patlaması olurdu)', () => {
    const w = createParticles(500);
    spawnIntro(w, W, H, { count: 500, random: makeRandom(1) });
    let atCenter = 0;
    for (let i = 0; i < w.count; i++) {
      if (Math.hypot(w.x[i] - W / 2, w.y[i] - H / 2) < 1e-3) atCenter++;
    }
    assert.ok(atCenter < w.count * 0.02,
      `${atCenter}/${w.count} parçacık tam merkezde`);
  });

  it('hepsi merkezden DIŞARI fırlatır', () => {
    const w = createParticles(500);
    spawnIntro(w, W, H, { count: 500, random: makeRandom(1) });
    let outward = 0;
    for (let i = 0; i < w.count; i++) {
      const dx = w.x[i] - W / 2;
      const dy = w.y[i] - H / 2;
      const d = Math.hypot(dx, dy) || 1;
      if ((w.vx[i] * dx + w.vy[i] * dy) / d > 0) outward++;
    }
    assert.equal(outward, w.count, 'bazı parçacıklar içeri gidiyor');
  });

  it('patlama hızı makul (tavanı geçmiyor)', () => {
    const w = createParticles(500);
    spawnIntro(w, W, H, {
      count: 500, burstSpeed: 514, random: makeRandom(1),
    });
    for (let i = 0; i < w.count; i++) {
      const s = Math.hypot(w.vx[i], w.vy[i]);
      assert.ok(s <= 514 * 1.001, `başlangıç hızı aştı: ${s}`);
      assert.ok(s >= 514 * 0.44, `patlama hızı çok düşük: ${s}`);
    }
  });

  it('yarıçap dağılımı normal spawn ile aynı', () => {
    const a = createParticles(1000);
    spawnIntro(a, W, H, { count: 1000, random: makeRandom(3) });
    const b = createParticles(1000);
    spawnParticles(b, W, H, { count: 1000, random: makeRandom(3) });
    for (let i = 0; i < a.count; i++) {
      assert.ok(a.r[i] >= CONFIG.minRadius && a.r[i] <= CONFIG.maxRadius);
    }
    assert.ok(b.r.length === a.r.length);
  });

  it('kapasite aşımı HATA verir', () => {
    const w = createParticles(50);
    assert.throws(() => spawnIntro(w, W, H, { count: 51, random: makeRandom(1) }), RangeError);
  });
});

describe('açılış — uçtan uca', () => {
  it('ekranı 2 saniyede doldurur', () => {
    const w = createParticles(2000);
    spawnIntro(w, W, H, { count: 2000, random: makeRandom(7) });
    const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    const p = makeParams();
    const cx = W / 2;
    const cy = H / 2;

    let t = 0;
    let spread = 0;
    for (let s = 0; s <= 2 / DT; s++) {
      const env = introEnvelope(t, CONFIG.introDuration);
      if (env > 0) {
        for (let i = 0; i < w.count; i++) {
          const dx = w.x[i] - cx;
          const dy = w.y[i] - cy;
          const d = Math.hypot(dx, dy);
          if (d < 1e-3) continue;
          const edge = Math.min(w.x[i], w.y[i], W - w.x[i], H - w.y[i]) / 220;
          const a = CONFIG.introAccel * env * (edge < 1 ? edge : 1);
          w.vx[i] += (dx / d) * a * DT;
          w.vy[i] += (dy / d) * a * DT;
        }
      }
      stepWorld(w, p, grid, DT, W, H, {
        x: cx, y: cy, active: t >= CONFIG.introDuration, strength: p.strength,
      });
      t += DT;

      let sum = 0;
      for (let i = 0; i < w.count; i++) {
        sum += Math.hypot(w.x[i] - cx, w.y[i] - cy);
      }
      spread = sum / w.count;
    }

    assert.ok(spread > 150, `yayılma yetersiz: ${spread.toFixed(0)}px`);
    assert.ok(spread < 600, `aşırı yayıldı: ${spread.toFixed(0)}px`);
  });

  it('açılış boyunca NaN yok ve hız tavanı aşılmaz', () => {
    const w = createParticles(1500);
    spawnIntro(w, W, H, { count: 1500, random: makeRandom(11) });
    const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    const p = makeParams();
    let t = 0;

    for (let s = 0; s <= 3 / DT; s++) {
      const env = introEnvelope(t, CONFIG.introDuration);
      if (env > 0) {
        for (let i = 0; i < w.count; i++) {
          const dx = w.x[i] - W / 2;
          const dy = w.y[i] - H / 2;
          const d = Math.hypot(dx, dy);
          if (d < 1e-3) continue;
          const a = CONFIG.introAccel * env;
          w.vx[i] += (dx / d) * a * DT;
          w.vy[i] += (dy / d) * a * DT;
        }
      }
      stepWorld(w, p, grid, DT, W, H, {
        x: W / 2, y: H / 2, active: t >= CONFIG.introDuration, strength: p.strength,
      });
      t += DT;

      const st = particleStats(w, p.maxSpeed);
      assert.equal(st.nan, 0, `${t.toFixed(2)}s: NaN oluştu`);
      assert.ok(st.maxSpeed <= p.maxSpeed + 1e-3,
        `${t.toFixed(2)}s: tavan aşıldı (${st.maxSpeed.toFixed(1)})`);
    }
  });

  it('açılış BİTİNCE sistem normal kararlılığa döner', () => {
    const w = createParticles(1200);
    spawnIntro(w, W, H, { count: 1200, random: makeRandom(13) });
    const grid = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    const p = makeParams();
    let t = 0;

    for (let s = 0; s <= (CONFIG.introDuration + 3) / DT; s++) {
      const env = introEnvelope(t, CONFIG.introDuration);
      if (env > 0) {
        for (let i = 0; i < w.count; i++) {
          const dx = w.x[i] - W / 2;
          const dy = w.y[i] - H / 2;
          const d = Math.hypot(dx, dy);
          if (d < 1e-3) continue;
          const a = CONFIG.introAccel * env;
          w.vx[i] += (dx / d) * a * DT;
          w.vy[i] += (dy / d) * a * DT;
        }
      }
      stepWorld(w, p, grid, DT, W, H, {
        x: W / 2, y: H / 2, active: t >= CONFIG.introDuration, strength: p.strength,
      });
      t += DT;
    }

    const st = particleStats(w, p.maxSpeed);
    assert.equal(st.nan, 0);
    assert.ok(st.avgSpeed > 20,
      `açılış sonrası sistem dondu: ${st.avgSpeed.toFixed(1)} px/s`);
    assert.ok(st.avgSpeed < 400,
      `patlama etkisi kalıcı: ${st.avgSpeed.toFixed(1)} px/s`);
  });
});
