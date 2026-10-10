import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sampleRamp, rampColorString, buildLUT, bucketFor,
  assignBuckets, resetBucketBuffers,
} from '../src/colors.js';
import { CONFIG } from '../src/config.js';

const B = CONFIG.colorBuckets;
const MAX = CONFIG.maxSpeed;

describe('sampleRamp — renk rampası', () => {
  it('uçlarda kontrol noktalarına sadık kalır', () => {
    const lo = sampleRamp(0, [0, 0, 0]);
    assert.deepEqual(lo, [18, 38, 110], 'hızsız = derin mavi');

    const hi = sampleRamp(1, [0, 0, 0]);
    assert.deepEqual(hi, [208, 42, 38], 'en hızlı = kırmızı');
  });

  it('aralık dışı değerleri kenara sabitler', () => {
    assert.deepEqual(sampleRamp(-5, [0, 0, 0]), sampleRamp(0, [0, 0, 0]));
    assert.deepEqual(sampleRamp(5, [0, 0, 0]), sampleRamp(1, [0, 0, 0]));
  });

  it('kanal değerleri her zaman geçerli RGB', () => {
    for (let i = 0; i <= 100; i++) {
      const c = sampleRamp(i / 100, [0, 0, 0]);
      for (const v of c) {
        assert.ok(Number.isInteger(v), `tamsayı değil: ${v}`);
        assert.ok(v >= 0 && v <= 255, `RGB aralığı dışı: ${v}`);
      }
    }
  });

  it('MONOTON SICAKLIK: maviden kırmızıya doğru ilerler', () => {
    const warmth = [];
    for (let i = 0; i <= 64; i++) {
      const c = sampleRamp(i / 64, [0, 0, 0]);
      warmth.push(c[0] - c[2]);
    }
    assert.ok(warmth[64] > warmth[0],
      `sıcaklık artmıyor: ${warmth[0]} -> ${warmth[64]}`);
    const mid = warmth[Math.floor(warmth.length * 0.7)];
    assert.ok(mid > 0, 'geçiş noktasından sonra yeniden soğuk oluyor');
  });

  it('beyaz geçiş bölgesinde parlaklık tepe yapar', () => {
    let peak = 0;
    let peakAt = 0;
    for (let i = 0; i <= 100; i++) {
      const c = sampleRamp(i / 100, [0, 0, 0]);
      const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (lum > peak) { peak = lum; peakAt = i; }
    }
    assert.ok(peakAt > 40 && peakAt < 80,
      `parlaklık tepesi beklenen aralıkta değil: ${peakAt}`);
  });

  it('rampColorString geçerli CSS rgb() üretir', () => {
    const s = rampColorString(0.5);
    assert.match(s, /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
  });
});

describe('buildLUT', () => {
  it('istenen sayıda renk üretir', () => {
    assert.equal(buildLUT(64).length, 64);
    assert.equal(buildLUT(8).length, 8);
  });

  it('ilk kova soğuk, son kova sıcak', () => {
    const lut = buildLUT(64);
    const first = lut[0].match(/\d+/g).map(Number);
    const last = lut[63].match(/\d+/g).map(Number);
    assert.ok(first[2] > first[0], 'ilk kova mavi ağırlıklı olmalı');
    assert.ok(last[0] > last[2], 'son kova kırmızı ağırlıklı olmalı');
  });

  it('tüm renkler benzersiz değil ama geçerli', () => {
    const lut = buildLUT(64);
    for (const c of lut) assert.match(c, /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
  });
});

describe('bucketFor — hız → kova', () => {
  it('sıfır hız ilk kovaya düşer', () => {
    assert.equal(bucketFor(0, MAX, B), 0);
  });

  it('negatif hız ilk kovaya düşer', () => {
    assert.equal(bucketFor(-50, MAX, B), 0);
  });

  it('tavan hız son kovaya düşer', () => {
    assert.equal(bucketFor(MAX, MAX, B), B - 1);
  });

  it('tavanı aşan hız da son kovada (taşma yok)', () => {
    assert.equal(bucketFor(MAX * 10, MAX, B), B - 1);
  });

  it('NaN ilk kovaya düşer (durgu mavisi)', () => {
    assert.equal(bucketFor(NaN, MAX, B), 0);
  });

  it('Infinity son kovaya düşer (tanımı gereği max hız)', () => {
    assert.equal(bucketFor(Infinity, MAX, B), B - 1);
    assert.equal(bucketFor(-Infinity, MAX, B), 0, 'negatif sonsuz = duruyor');
  });

  it('monoton artar', () => {
    let prev = -1;
    for (let v = 0; v <= MAX; v += MAX / 50) {
      const b = bucketFor(v, MAX, B);
      assert.ok(b >= prev, `kovanın azalması: ${prev} -> ${b} @${v}`);
      prev = b;
    }
  });

  it('tüm kovalar erişilebilir (atlanan kova yok)', () => {
    const seen = new Set();
    for (let v = 0; v <= MAX; v += MAX / (B * 4)) {
      seen.add(bucketFor(v, MAX, B));
    }
    assert.equal(seen.size, B, `${B} kovadan ${seen.size} tanesi dolu`);
  });
});

describe('assignBuckets — gruplama', () => {
  function world(n) {
    return {
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
    };
  }

  it('tüm parçacıklar TAM OLARAK bir kovaya girer', () => {
    resetBucketBuffers();
    const n = 1000;
    const w = world(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = (i / n) * MAX;
      w.vx[i] = Math.cos(a) * s;
      w.vy[i] = Math.sin(a) * s;
    }

    const { kovaOf, order, bucketStart } = assignBuckets(w.vx, w.vy, n, MAX, B);

    const seen = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      assert.ok(i >= 0 && i < n, `geçersiz indeks: ${i}`);
      assert.equal(seen[i], 0, `${i} iki kez yerleştirildi`);
      seen[i] = 1;
    }

    assert.equal(bucketStart[B], n, 'tüm parçacıklar kapsanmadı');
  });

  it('order kovaya göre SIRALI', () => {
    resetBucketBuffers();
    const n = 500;
    const w = world(n);
    for (let i = 0; i < n; i++) { w.vx[i] = (i / n) * MAX; w.vy[i] = 0; }

    const { kovaOf, order, bucketStart } = assignBuckets(w.vx, w.vy, n, MAX, B);

    for (let b = 0; b < B; b++) {
      for (let k = bucketStart[b]; k < bucketStart[b + 1]; k++) {
        const i = order[k];
        assert.equal(kovaOf[i], b, `kovası ${kovaOf[i]} olan parçacık ${b} aralığında`);
      }
    }
  });

  it('arkışık aralıklar: bucketStart monoton', () => {
    resetBucketBuffers();
    const n = 777;
    const w = world(n);
    for (let i = 0; i < n; i++) { w.vx[i] = Math.random() * MAX; w.vy[i] = Math.random() * MAX; }

    const { bucketStart } = assignBuckets(w.vx, w.vy, n, MAX, B);
    for (let b = 1; b <= B; b++) {
      assert.ok(bucketStart[b] >= bucketStart[b - 1], 'ofsetler azalıyor');
    }
  });

  it('NaN hızlı parçacık kovaya girer (kayıp yok)', () => {
    resetBucketBuffers();
    const n = 100;
    const w = world(n);
    w.vx[5] = NaN;
    w.vy[5] = NaN;
    for (let i = 0; i < n; i++) { w.vx[i] = i; w.vy[i] = 0; }

    const { order, bucketStart } = assignBuckets(w.vx, w.vy, n, MAX, B);
    assert.equal(bucketStart[B], n);

    let found = false;
    for (let k = 0; k < n; k++) if (order[k] === 5) found = true;
    assert.ok(found, 'NaN hızlı parçacık order\'da yok');
  });

  it('sıfır parçacıkta çökmüyor', () => {
    resetBucketBuffers();
    const w = world(0);
    const { bucketStart } = assignBuckets(w.vx, w.vy, 0, MAX, B);
    assert.equal(bucketStart[B], 0);
    for (let b = 0; b <= B; b++) assert.equal(bucketStart[b], 0);
  });

  it('ardışık çağrılarda tampon yeniden kullanılır', () => {
    resetBucketBuffers();
    const w = world(100);
    for (let i = 0; i < 100; i++) { w.vx[i] = i; w.vy[i] = 0; }

    const a = assignBuckets(w.vx, w.vy, 100, MAX, B);
    const firstBuf = a.order;
    const b = assignBuckets(w.vx, w.vy, 100, MAX, B);
    assert.equal(b.order, firstBuf, 'tampon yeniden ayrılmamalı (allocation)');
  });

  it('farklı kova sayısında yeniden ayrılır', () => {
    resetBucketBuffers();
    const w = world(50);
    for (let i = 0; i < 50; i++) { w.vx[i] = i; w.vy[i] = 0; }
    assignBuckets(w.vx, w.vy, 50, MAX, 64);
    const small = assignBuckets(w.vx, w.vy, 50, MAX, 16);
    assert.equal(small.bucketStart.length, 17, 'yanlış boyutlu tampon kullanıldı');
    assert.equal(small.bucketStart[16], 50);
  });
});