import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  safe, len, clamp, clampSpeed, smoothstep, unitVector,
  gravityField, integrate, applyDamping, applySpeedFloor, wrapPosition, nearEdge,
  massOf, resolveCollision, shockImpulse, makeParams,
} from '../src/physics.js';
import { CONFIG } from '../src/config.js';

const P = makeParams();
const out = () => [0, 0];

describe('yardımcılar', () => {
  it('safe() NaN ve Infinity\'yi yedeğe çevirir', () => {
    assert.equal(safe(NaN), 0);
    assert.equal(safe(Infinity), 0);
    assert.equal(safe(-Infinity), 0);
    assert.equal(safe(NaN, 7), 7);
    assert.equal(safe(3.5), 3.5);
    assert.equal(safe(0), 0);
  });

  it('len() hipotenüsü doğru hesaplar', () => {
    assert.equal(len(3, 4), 5);
    assert.equal(len(0, 0), 0);
    assert.ok(Math.abs(len(1, 1) - Math.SQRT2) < 1e-12);
  });

  it('clamp() sınırları uygular', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
  });

  it('smoothstep() [0,1] aralığında monoton artar, uçlarda doğru', () => {
    assert.equal(smoothstep(0), 0);
    assert.equal(smoothstep(1), 1);
    assert.equal(smoothstep(-5), 0);
    assert.equal(smoothstep(5), 1);
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = smoothstep(t);
      assert.ok(v >= prev, `monoton artış bozuldu @${t}`);
      prev = v;
    }
  });

  it('unitVector() normalize eder ve uzunluğu 1 yapar', () => {
    const o = unitVector(3, 4);
    assert.ok(Math.abs(Math.hypot(o[0], o[1]) - 1) < 1e-12);
  });

  it('unitVector() sıfır vektörde NaN ÜRETMEZ (deterministik yön)', () => {
    const o = unitVector(0, 0);
    assert.ok(Number.isFinite(o[0]) && Number.isFinite(o[1]), 'NaN üretildi');
    assert.ok(Math.abs(Math.hypot(o[0], o[1]) - 1) < 1e-12, 'normalize değil');
    const o2 = unitVector(0, 0);
    assert.deepEqual(o, o2);
  });
});

describe('gravityField — yerçekimi kuyusu', () => {
  it('etki alanı dışında kuvvet üretmez', () => {
    const o = out();
    const inside = gravityField(1000, 0, P, o);
    assert.equal(inside, false);
    assert.deepEqual(o, [0, 0]);
  });

  it('tam merkezde (dx=dy=0) sonsuzluk/NaN yok', () => {
    const o = out();
    const inside = gravityField(0, 0, P, o);
    assert.ok(Number.isFinite(o[0]) && Number.isFinite(o[1]), 'merkezde NaN');
    const mag = Math.hypot(o[0], o[1]);
    assert.ok(mag <= P.maxAcceleration + 1e-6, 'ivme tavanı aşıldı');
  });

  it('merkeze yakınken uzakken daha güçlü çeker (monoton azalan)', () => {
    const mags = [];
    for (const r of [20, 50, 100, 150, 200, 250]) {
      const o = out();
      gravityField(r, 0, { ...P, swirl: 0 }, o);
      mags.push(Math.hypot(o[0], o[1]));
    }
    for (let i = 1; i < mags.length; i++) {
      assert.ok(mags[i] < mags[i - 1], `azalan ivme bozuldu: ${mags}`);
    }
  });

  it('merkezden uzaklaştıkça ivme azalır (kuyu hipotezini doğrular)', () => {
    const a = out(), b = out();
    gravityField(50, 0, { ...P, fadeStart: 1 }, a);
    gravityField(100, 0, { ...P, fadeStart: 1 }, b);
    const ma = Math.hypot(a[0], a[1]);
    const mb = Math.hypot(b[0], b[1]);
    assert.ok(ma / mb > 2.0, `oran çok düşük: ${ma / mb}`);
  });

  it('ivme parçacığı kuyuya doğru çeker (yön doğru)', () => {
    const o = out();
    gravityField(100, 0, { ...P, swirl: 0 }, o);
    assert.ok(o[0] < 0, 'x yönü yanlış');
    assert.ok(Math.abs(o[1]) < 1e-9, 'y bileşeni sıfır olmalı (eksende)');
  });

  it('yumuşatma sayesinde merkezdeki ivme sınırlı kalır', () => {
    const near = out(), at = out();
    gravityField(1, 0, P, near);
    gravityField(0, 0, P, at);
    assert.ok(Math.hypot(at[0], at[1]) <= P.maxAcceleration);
    assert.ok(Math.hypot(at[0], at[1]) < Math.hypot(near[0], near[1]) + 1e6);
  });

  it('swirl=0 iken tangenciel bileşen yok', () => {
    const o = out();
    gravityField(100, 50, { ...P, swirl: 0 }, o);
    const radial = [100, 50];
    const dot = o[0] * radial[0] + o[1] * radial[1];
    const cross = o[0] * radial[1] - o[1] * radial[0];
    assert.ok(Math.abs(cross) < 1e-6, 'swirl=0 iken dik bileşen var');
    assert.ok(dot < 0, 'radial bileşen içeri yönelmeli');
  });

  it('swirl açıkken yörünge (tangenciel) bileşen üretir', () => {
    const o = out();
    gravityField(100, 0, { ...P, swirl: 0.5 }, o);
    assert.ok(Math.abs(o[1]) > 1e-6, 'girdap bileşeni yok');
  });

  it('strength=0 iken hiç kuvvet üretilmez', () => {
    const o = out();
    gravityField(50, 0, { ...P, strength: 0 }, o);
    assert.deepEqual(o, [0, 0]);
  });

  it('radius=0 iken kuvvet uygulanmaz (bölme koruması)', () => {
    const o = out();
    const inside = gravityField(0.0001, 0, { ...P, radius: 0 }, o);
    assert.equal(inside, false);
    assert.deepEqual(o, [0, 0]);
  });

  it('fadeStart=0.55: yarıçapın yarısından sonra kuvvet yumuşak sönümlenir', () => {
    const inner = out(), outer = out();
    gravityField(P.radius * 0.5, 0, P, inner);
    gravityField(P.radius * 0.9, 0, P, outer);
    const mi = Math.hypot(inner[0], inner[1]);
    const mo = Math.hypot(outer[0], outer[1]);
    assert.ok(mo < mi, 'dış bölgede sönümleme çalışmıyor');
    assert.ok(mo > 0, 'dış bölgede kuvvet tamamen kesildi (sert kenar)');
  });
});

describe('clampSpeed — hız tavanı', () => {
  it('sınırın altındaki hızı değiştirmez', () => {
    const o = clampSpeed(3, 4, 100, out());
    assert.deepEqual(o, [3, 4]);
  });

  it('sınırın üstündeki hızı tam sınıra indirir', () => {
    const o = clampSpeed(300, 400, 100, out());
    assert.ok(Math.abs(Math.hypot(o[0], o[1]) - 100) < 1e-9, 'hız sınıra indirilmedi');
  });

  it('aşırı hız (ısınma) durumunda da sınıra iner', () => {
    const o = clampSpeed(1e9, 1e9, 500, out());
    assert.ok(Math.abs(Math.hypot(o[0], o[1]) - 500) < 1e-6);
  });

  it('NaN hızı sıfırlar (savunma hattı)', () => {
    const o = clampSpeed(NaN, Infinity, 100, out());
    assert.deepEqual(o, [0, 0]);
  });

  it('yön korunur (ölçekleme, sıfırlama değil)', () => {
    const o = clampSpeed(1000, 0, 100, out());
    assert.ok(o[0] > 0, 'yön korunmadı');
    assert.ok(Math.abs(o[1]) < 1e-12);
  });
});

describe('integrate ve applyDamping', () => {
  it('konum hız*dt ile ilerler', () => {
    const o = integrate(100, 200, 10, -5, 0.1, out());
    assert.ok(Math.abs(o[0] - 101) < 1e-9);
    assert.ok(Math.abs(o[1] - 199.5) < 1e-9);
  });

  it('sıfır hızda konum değişmez', () => {
    const o = integrate(50, 60, 0, 0, 0.5, out());
    assert.deepEqual(o, [50, 60]);
  });

  it('NaN konumu güvenli hale getirir', () => {
    const o = integrate(NaN, 50, 10, 10, 0.1, out());
    assert.ok(Number.isFinite(o[0]), 'NaN kaldı');
  });

  it('sönümleme hızı çarpanla azaltır', () => {
    const o = applyDamping(100, -50, 0.5, out());
    assert.deepEqual(o, [50, -25]);
  });

  it('damping=1 hiç kayıp yok', () => {
    const o = applyDamping(100, -50, 1, out());
    assert.deepEqual(o, [100, -50]);
  });

  it('sönümleme enerjiyi korumaz (azaltır)', () => {
    const before = 100 * 100 + 50 * 50;
    const o = applyDamping(100, 50, 0.9, out());
    const after = o[0] * o[0] + o[1] * o[1];
    assert.ok(after < before, 'sönümleme enerji artırdı');
  });
});

describe('wrapPosition — sarmalama', () => {
  const W = 1000, H = 800;

  it('içerideyse konum değişmez', () => {
    const o = wrapPosition(500, 400, W, H, out());
    assert.deepEqual(o, [500, 400]);
  });

  it('sol üstten çıkınca sağ alta sarar', () => {
    const o = wrapPosition(-10, -5, W, H, out());
    assert.deepEqual(o, [990, 795]);
  });

  it('sağ alttan çıkınca sol üste sarar', () => {
    const o = wrapPosition(1010, 805, W, H, out());
    assert.deepEqual(o, [10, 5]);
  });

  it('sarmalama sonrası daima sınırlar içinde', () => {
    for (let i = 0; i < 500; i++) {
      const x = (Math.random() - 0.5) * 5000;
      const y = (Math.random() - 0.5) * 5000;
      const o = wrapPosition(x, y, W, H, out());
      assert.ok(o[0] >= 0 && o[0] < W, `x sınır dışı: ${o[0]}`);
      assert.ok(o[1] >= 0 && o[1] < H, `y sınır dışı: ${o[1]}`);
    }
  });

  it('birden fazla ekran boyu sapmayı da sarar', () => {
    const o = wrapPosition(-2500, -3000, W, H, out());
    assert.ok(o[0] >= 0 && o[0] < W, `x sınır dışı: ${o[0]}`);
    assert.ok(o[1] >= 0 && o[1] < H, `y sınır dışı: ${o[1]}`);
  });

  it('sarma -0 üretmez', () => {
    const o = wrapPosition(-0, -0, W, H, out());
    assert.ok(Object.is(o[0], 0), `-0 üretildi`);
    assert.ok(Object.is(o[1], 0), `-0 üretildi`);
  });

  it('NaN koordinatı güvenli hale getirir', () => {
    const o = wrapPosition(NaN, Infinity, W, H, out());
    assert.ok(Number.isFinite(o[0]) && Number.isFinite(o[1]));
  });

  it('nearEdge dört kenarı da doğru algılar', () => {
    assert.equal(nearEdge(5, 400, W, H, 40), true);
    assert.equal(nearEdge(400, 5, W, H, 40), true);
    assert.equal(nearEdge(995, 400, W, H, 40), true);
    assert.equal(nearEdge(400, 795, W, H, 40), true);
    assert.equal(nearEdge(500, 400, W, H, 40), false);
  });
});

describe('applySpeedFloor — canlılık tabanı', () => {
  const FLOOR = 40;
  const o = () => [0, 0];

  it('tabandan hızlı parçacığa dokunmaz', () => {
    const r = applySpeedFloor(100, 0, FLOOR, o());
    assert.deepEqual(r, [100, 0]);
  });

  it('tabandan yavaş parçacığı tabana çeker', () => {
    const r = applySpeedFloor(5, 0, FLOOR, o());
    assert.ok(Math.abs(Math.hypot(r[0], r[1]) - FLOOR) < 1e-9, `tabana ulaşmadı: ${r}`);
  });

  it('yavaşlatırken YÖNÜ korur', () => {
    const r = applySpeedFloor(3, 4, FLOOR, o());
    assert.ok(r[0] > 0 && r[1] > 0, 'yön bozuldu');
    assert.ok(Math.abs(r[0] / r[1] - 3 / 4) < 1e-6, 'yön değişti');
  });

  it('tam durmuş parçacığa deterministik yönde taban verir', () => {
    const r = applySpeedFloor(0, 0, FLOOR, o());
    assert.ok(Number.isFinite(r[0]) && Number.isFinite(r[1]), 'NaN üretildi');
    assert.ok(Math.abs(Math.hypot(r[0], r[1]) - FLOOR) < 1e-9);
    assert.deepEqual(r, applySpeedFloor(0, 0, FLOOR, o()));
  });

  it('taban=0 iken hiç müdahale etmez', () => {
    const r = applySpeedFloor(1, 2, 0, o());
    assert.deepEqual(r, [1, 2]);
    assert.deepEqual(applySpeedFloor(0, 0, 0, o()), [0, 0]);
  });

  it('tabandan tam hızda dokunmaz (süreklilik)', () => {
    const r = applySpeedFloor(FLOOR, 0, FLOOR, o());
    assert.ok(Math.abs(r[0] - FLOOR) < 1e-9);
  });

  it('NaN hızı güvenli hale getirir', () => {
    const r = applySpeedFloor(NaN, Infinity, FLOOR, o());
    assert.ok(Number.isFinite(r[0]) && Number.isFinite(r[1]));
  });

  it('devamlı sönümleme sonrası hız tabanın üstünde kalır', () => {
    let v = 300;
    const tmp = [0, 0];
    for (let i = 0; i < 100000; i++) {
      v *= 0.999;
      const r = applySpeedFloor(v, 0, FLOOR, tmp);
      v = r[0];
    }
    assert.ok(v >= FLOOR - 1e-9, `sönümleme tabanın altına indi: ${v}`);
  });
});

describe('massOf', () => {
  it('kütle yarıçapın karesi', () => {
    assert.equal(massOf(2), 4);
    assert.equal(massOf(0.5), 0.25);
  });

  it('NaN yarıçap güvenli kütle verir', () => {
    assert.ok(Number.isFinite(massOf(NaN)));
  });
});

describe('resolveCollision — çarpışma', () => {
  const world = (n) => ({
    x: new Float32Array(n), y: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n),
    r: new Float32Array(n),
  });
  const P2 = { restitution: 0.7, damping: 0.95, correction: 0.5 };

  it('çakışmayan parçacıklar dokunulmaz', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 100; w.r[0] = 2; w.r[1] = 2;
    const hit = resolveCollision(w, 0, 1, P2);
    assert.equal(hit, false);
    assert.equal(w.vx[0], 0);
  });

  it('tam değme (distance == rSum) çarpışma sayılmaz', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 4; w.r[0] = 2; w.r[1] = 2;
    assert.equal(resolveCollision(w, 0, 1, P2), false);
  });

  it('çakışan parçacıklar iç içe geçmez', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 2; w.r[0] = 2; w.r[1] = 2;
    resolveCollision(w, 0, 1, P2);
    const d = Math.abs(w.x[1] - w.x[0]);
    assert.ok(d > 2, `ayırma yapılmadı: ${d}`);
  });

  it('yaklaşan parçacıklar çarpışınca ayrılır (normal hız işaret değiştirir)', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 3; w.r[0] = 2; w.r[1] = 2;
    w.vx[0] = 10; w.vx[1] = -10;
    const before = w.vx[1] - w.vx[0];
    assert.ok(before < 0, 'test kurulumu: parçacıklar yaklaşmıyor');

    resolveCollision(w, 0, 1, P2);
    const after = w.vx[1] - w.vx[0];

    assert.ok(after > 0, `çarpışma sonrası hâlâ yaklaşıyorlar: ${after}`);
    assert.ok(Math.abs(after) < Math.abs(before), `daha fazla enerji üretildi: ${before} -> ${after}`);
  });

  it('ayrılan parçacıklara impuls uygulanmaz', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 3; w.r[0] = 2; w.r[1] = 2;
    w.vx[0] = -10; w.vx[1] = 10;
    const v0 = w.vx[0];
    resolveCollision(w, 0, 1, P2);
    assert.ok(Math.abs(w.vx[0] - v0) < 1e-6, 'ayrılan parçacığa kuvvet uygulandı');
  });

  it('simetri: eşit kütleli iki parçacık hızını değişir (momentum korunur)', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 2; w.r[0] = 2; w.r[1] = 2;
    w.vx[0] = 5; w.vx[1] = -5;
    const pBefore = w.vx[0] * 4 + w.vx[1] * 4;
    resolveCollision(w, 0, 1, { ...P2, damping: 1 });
    const pAfter = w.vx[0] * 4 + w.vx[1] * 4;
    assert.ok(Math.abs(pBefore - pAfter) < 1e-4, `momentum korunmadı: ${pBefore} -> ${pAfter}`);
  });

  it('ağır parçacık daha az itilir', () => {
    const w = world(2);
    w.x[0] = 0; w.r[0] = 1; w.vx[0] = 20;
    w.x[1] = 2; w.r[1] = 8; w.vx[1] = -2;

    const v0Before = w.vx[0];
    const v1Before = w.vx[1];
    resolveCollision(w, 0, 1, P2);

    const d0 = Math.abs(w.vx[0] - v0Before);
    const d1 = Math.abs(w.vx[1] - v1Before);

    assert.ok(d0 > 0 && d1 > 0, 'hiç değişim yok');
    assert.ok(d0 > d1, `kütle etkisi yok: hafif ${d0}, ağır ${d1}`);
  });

  it('esneklik 0 ise tamamen inel (damping hariç)', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 3; w.r[0] = 2; w.r[1] = 2;
    w.vx[0] = 10; w.vx[1] = -10;
    resolveCollision(w, 0, 1, { ...P2, restitution: 0, damping: 1 });
    const rel = w.vx[1] - w.vx[0];
    assert.ok(Math.abs(rel) < 1e-3, `tam ince değil: göreli hız ${rel}`);
  });

  it('esneklik 1 ise enerji korunur', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 3; w.r[0] = 2; w.r[1] = 2;
    w.vx[0] = 10; w.vx[1] = -10;
    resolveCollision(w, 0, 1, { ...P2, restitution: 1, damping: 1 });
    const rel = w.vx[1] - w.vx[0];
    assert.ok(Math.abs(Math.abs(rel) - 20) < 1e-3, `esneklik kaybı: ${rel}`);
  });

  it('tam üst üste binen parçacıklar NaN üretmez', () => {
    const w = world(2);
    w.x[0] = 50; w.x[1] = 50; w.y[0] = 50; w.y[1] = 50;
    w.r[0] = 2; w.r[1] = 2;
    const hit = resolveCollision(w, 0, 1, P2);
    assert.ok(Number.isFinite(w.vx[0]) && Number.isFinite(w.vy[0]), 'NaN üretildi');
  });

  it('tekrarlanan çözüm sistemi patlatmaz (stress)', () => {
    const w = world(2);
    w.x[0] = 0; w.x[1] = 0.5; w.r[0] = 3; w.r[1] = 3;
    w.vx[0] = 100; w.vx[1] = -100;
    for (let i = 0; i < 2000; i++) {
      resolveCollision(w, 0, 1, P2);
      w.x[0] += w.vx[0] * (1 / 120);
      w.x[1] += w.vx[1] * (1 / 120);
    }
    assert.ok(Number.isFinite(w.x[0]) && Number.isFinite(w.vx[0]), 'sistem patladı');
  });
});

describe('shockImpulse — şok dalgası', () => {
  const S = { strength: 1000, radius: 100 };

  it('halkın dışında hiç etki yok', () => {
    const o = out();
    const mag = shockImpulse(1000, 0, 100, S, o);
    assert.equal(mag, 0);
    assert.deepEqual(o, [0, 0]);
  });

  it('halkın merkezinde en güçlü', () => {
    const o = out();
    const mag = shockImpulse(100, 0, 100, S, o);
    assert.ok(Math.abs(mag - 1000) < 1e-6, `tepe değer yanlış: ${mag}`);
  });

  it('dalgadan uzaklaştıkça kuvvet azalır (merkezde tepe)', () => {
    const a = out(), b = out(), c = out();
    const ma = shockImpulse(100, 0, 100, S, a);
    const mb = shockImpulse(180, 0, 100, S, b);
    const mc = shockImpulse(200, 0, 100, S, c);
    assert.ok(ma > mb && mb >= mc, `profil monoton değil: ${ma} ${mb} ${mc}`);
  });

  it('merkezden dışarı doğru itiş yönü', () => {
    const o = out();
    shockImpulse(150, 0, 100, S, o);
    assert.ok(o[0] > 0, 'itış yönü yanlış');
  });

  it('tam merkezde NaN yok', () => {
    const o = out();
    const mag = shockImpulse(0, 0, 0, S, o);
    assert.ok(Number.isFinite(mag) && Number.isFinite(o[0]));
  });

  it('halk bandının dışındaki çapraz nokta etki görmez', () => {
    const o = out();
    const mag = shockImpulse(150, 150, 100, S, o);
    assert.equal(mag, 0);
    assert.deepEqual(o, [0, 0]);
  });

  it('2 boyutlu: çapraz yön de doğru', () => {
    const o = out();
    const mag = shockImpulse(120, 120, 100, S, o);
    assert.ok(mag > 0, 'etki yok');
    assert.ok(o[0] > 0 && o[1] > 0, 'çapraz yön bozuk');
    assert.ok(Math.abs(o[0] - o[1]) < 1e-5, 'asimetrik bileşen');
    assert.ok(Math.abs(Math.hypot(o[0], o[1]) - mag) < 1e-6);
  });
});

describe('kabuk kuvveti — shellRadius', () => {
  const o = () => [0, 0];
  const SHELL = 300;
  const WIDTH = 110;

  const withShell = (over) => makeParams({
    shellRadius: SHELL, shellWidth: WIDTH, ...over,
  });

  it('kapalıyken davranış klasik çekimle AYNIDIR', () => {
    for (const d of [30, 120, 250, 400]) {
      const a = o(), b = o();
      gravityField(d, 0, makeParams(), a);
      gravityField(d, 0, withShell({ shellRadius: 0 }), b);
      assert.ok(Math.abs(a[0] - b[0]) < 1e-9,
        `d=${d}: kabuk kapalıyken değişiklik var (${a[0]} vs ${b[0]})`);
    }
  });

  it('denge yarıçapında kuvvet SIFIR (kabuğun kendisi)', () => {
    const r = o();
    gravityField(SHELL, 0, withShell(), r);
    assert.ok(Math.abs(r[0]) < 1e-9,
      `denge yarıçapında kuvvet sıfır değil: ${r[0].toFixed(4)}`);
  });

  it('denge yarıçapının İÇİNDE itme yapar', () => {
    const r = o();
    gravityField(120, 0, withShell(), r);
    assert.ok(r[0] > 0, `içeride itmiyor: ax=${r[0].toFixed(1)}`);
  });

  it('denge yarıçapının DIŞINDA çeker', () => {
    const d = SHELL + WIDTH;
    assert.ok(d < CONFIG.gravityRadius,
      `test mesafesi etki alanı dışında (${d} >= ${CONFIG.gravityRadius})`);
    const r = o();
    gravityField(d, 0, withShell(), r);
    assert.ok(r[0] < -0.1,
      `geçiş sonrası çekim çok zayıf: ax=${r[0].toFixed(4)}`);
  });

  it('geçiş YUMUŞAK (sert sıçrama yok)', () => {
    let prev = null;
    for (let d = 150; d <= 450; d += 10) {
      const r = o();
      gravityField(d, 0, withShell(), r);
      if (prev !== null) {
        assert.ok(Math.abs(r[0] - prev) < 300,
          `d=${d}px'te ani sıçrama: ${prev.toFixed(0)} -> ${r[0].toFixed(0)}`);
      }
      prev = r[0];
    }
  });

  it('simetrik: sol ve sağ aynı büyüklük', () => {
    const l = o(), r = o();
    gravityField(-120, 0, withShell(), l);
    gravityField(120, 0, withShell(), r);
    assert.ok(Math.abs(Math.abs(l[0]) - Math.abs(r[0])) < 1e-6,
      'simetri bozuk');
  });

  it('etki alanı dışında yine de kuvvet yok', () => {
    const r = o();
    const inside = gravityField(makeParams().radius + 50, 0, withShell(), r);
    assert.equal(inside, false);
    assert.deepEqual(r, [0, 0]);
  });

  it('NaN üretmez', () => {
    for (const d of [0, 1e-9, SHELL, SHELL + WIDTH, 1e6]) {
      const r = o();
      gravityField(d, 0, withShell(), r);
      assert.ok(Number.isFinite(r[0]) && Number.isFinite(r[1]), `d=${d} -> NaN`);
    }
  });

  it('varsayılan parametrede KAPALI (mixed moduna özel)', () => {
    assert.equal(makeParams().shellRadius, 0,
      'varsayılan kabuk açık — çekim ve itme modları bozulur');
  });

  it('config kabuk yarıçapı etki alanından KÜÇÜK', () => {
    assert.ok(CONFIG.shellRadius < CONFIG.gravityRadius,
      `shellRadius=${CONFIG.shellRadius} >= gravityRadius=${CONFIG.gravityRadius} — kabuk çalışmaz`);
  });

  it('geçiş bandı etki alanının İÇİNDE bitmeli (marj kalsın)', () => {
    const end = CONFIG.shellRadius + CONFIG.shellWidth;
    assert.ok(end < CONFIG.gravityRadius,
      `geçiş bandı alan sınırında bitiyor (${end} >= ${CONFIG.gravityRadius})`);
  });
});
