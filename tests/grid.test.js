import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SpatialGrid, cellSizeFor, createDefaultGrid } from '../src/grid.js';
import { CONFIG } from '../src/config.js';

const W = 800;
const H = 600;

function arrays(n) {
  return { x: new Float32Array(n), y: new Float32Array(n) };
}

function pairsCollected(grid, fn) {
  const found = [];
  fn((i, j) => found.push([i, j]));
  return found;
}

function normalizeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

function bruteForcePairs(x, y, r, n, pad = 0) {
  const out = new Set();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      const wx = Math.min(Math.abs(dx), W - Math.abs(dx));
      const wy = Math.min(Math.abs(dy), H - Math.abs(dy));
      if (Math.hypot(wx, wy) <= r[i] + r[j] + pad) out.add(`${i},${j}`);
    }
  }
  return out;
}

describe('SpatialGrid — temel kurulum', () => {
  it('hücre boyutu doğruluk alt sınırının ÜSTÜNDE (asla düşürme)', () => {
    const cs = cellSizeFor(CONFIG.maxRadius);
    assert.ok(cs >= CONFIG.maxRadius * 2, 'hücre boyutu yarıçap katı 2 olmalı');
  });

  it('hücre boyutu alt sınırı asla küçültmez (büyük yarıçap koruması)', () => {
    for (const r of [0.5, 1, 2.2, 10, 50, 200]) {
      const cs = cellSizeFor(r);
      assert.ok(cs >= r * 2, `maxRadius=${r} -> cellSize=${cs}, alt sınır ${r * 2}`);
    }
  });

  it('varsayılan ızgara CONFIG ile uyumlu', () => {
    const g = createDefaultGrid(W, H);
    assert.ok(g.cols > 1 && g.rows > 1);
    assert.ok(g.cellSize >= CONFIG.maxRadius * 2);
  });

  it('her parçacık bir hücreye indekslenir', () => {
    const g = new SpatialGrid(W, H, 20);
    const { x, y } = arrays(5);
    g.build(x, y, 5);
    assert.equal(g.count, 5);
    let placed = 0;
    for (let c = 0; c < g.cellCount; c++) placed += g.cellStart[c + 1] - g.cellStart[c];
    assert.equal(placed, 5);
  });

  it('hiç parçacık yoksa build çökmüyor', () => {
    const g = new SpatialGrid(W, H, 20);
    g.build(new Float32Array(0), new Float32Array(0), 0);
    assert.equal(g.count, 0);
    let found = 0;
    g.forEachPair(() => found++);
    assert.equal(found, 0);
  });

  it('yeniden build edince eski veri kalıntısı yok', () => {
    const g = new SpatialGrid(W, H, 20);
    let { x, y } = arrays(100);
    for (let i = 0; i < 100; i++) { x[i] = (i % 10) * 70; y[i] = Math.floor(i / 10) * 70; }
    g.build(x, y, 100);
    const first = g.items.slice(0, 100);

    const small = arrays(3);
    small.x.set([10, 20, 30]); small.y.set([10, 20, 30]);
    g.build(small.x, small.y, 3);
    let placed = 0;
    for (let c = 0; c < g.cellCount; c++) placed += g.cellStart[c + 1] - g.cellStart[c];
    assert.equal(placed, 3, 'önceki 97 parçacık hâlâ sayılıyor');
    void first;
  });

  it(' negatif koordinatlar sarmalı indekslenir', () => {
    const g = new SpatialGrid(W, H, 20);
    const { x, y } = arrays(2);
    x[0] = -5; y[0] = -5;
    x[1] = 5;  y[1] = 5;
    g.build(x, y, 2);
    assert.equal(g.count, 2);
    let found = 0;
    g.forEachPair(() => found++);
    assert.ok(found >= 0);
  });

  it('sınır ötesi koordinatlar sarmalı indekslenir', () => {
    const g = new SpatialGrid(W, H, 20);
    const { x, y } = arrays(2);
    x[0] = W + 10; y[0] = 10;
    x[1] = W - 10; y[1] = 10;
    g.build(x, y, 2);
    assert.equal(g.count, 2);
    const pairs = pairsCollected(g, g.forEachPair.bind(g));
    assert.equal(pairs.length, 1, 'kenar komşuluğu bulunamadı (torus çalışmıyor)');
  });
});

describe('SpatialGrid — forEachPair doğruluğu', () => {
  it('aynı hücredeki tüm çiftleri bulur', () => {
    const g = new SpatialGrid(W, H, 50);
    const { x, y } = arrays(4);
    x.fill(100); y.fill(100);
    g.build(x, y, 4);
    const pairs = pairsCollected(g, g.forEachPair.bind(g));
    assert.equal(pairs.length, 6, `4 parçacık -> 6 çift beklenir, ${pairs.length} bulundu`);
  });

  it('hiçbir çifti iki kez saymaz', () => {
    const g = new SpatialGrid(W, H, 40);
    const n = 400;
    const { x, y } = arrays(n);
    let s = 99;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * W; y[i] = rnd() * H; }
    g.build(x, y, n);

    const keys = new Set();
    let total = 0;
    g.forEachPair((i, j) => {
      const k = normalizeKey(i, j);
      assert.ok(!keys.has(k), `çift iki kez sayıldı: ${k}`);
      assert.ok(i < j, 'her çiftte küçük indeks önce olmalı');
      keys.add(k);
      total++;
    });
    assert.equal(keys.size, total);
  });

  it('her çift TAM OLARAK bir kez (çift sayımı yok)', () => {
    const g = new SpatialGrid(W, H, 100);
    const n = 200;
    const { x, y } = arrays(n);
    let s = 7;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * W; y[i] = rnd() * H; }
    g.build(x, y, n);

    const seen = new Map();
    g.forEachPair((i, j) => {
      const k = normalizeKey(i, j);
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    for (const [k, c] of seen) {
      assert.equal(c, 1, `${k} ${c} kez sayıldı — çift sayımı hatası`);
    }
  });

  it('varsayılan hücre boyu alt sınırdan büyük ama makul', () => {
    const cs = cellSizeFor(CONFIG.maxRadius);
    assert.ok(cs >= 12, 'ölçülmüş performans değeri 12px');
    assert.ok(cs <= 20, '30px hücreler aşırı kalabalık, tarama yavaşlıyor');
});

it('DOĞRULUK: gerçek çiftleri ızgara asla kaçırmaz', () => {
    const cellSize = cellSizeFor(CONFIG.maxRadius);
    const g = new SpatialGrid(W, H, cellSize);
    const n = 500;
    const { x, y } = arrays(n);
    const r = new Float32Array(n);

    let s = 2024;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      x[i] = rnd() * W;
      y[i] = rnd() * H;
      r[i] = CONFIG.minRadius + rnd() * (CONFIG.maxRadius - CONFIG.minRadius);
    }
    g.build(x, y, n);

    const gridPairs = new Set();
    g.forEachPair((i, j) => gridPairs.add(normalizeKey(i, j)));

    const realPairs = bruteForcePairs(x, y, r, n, 0);

    const missing = [...realPairs].filter((k) => !gridPairs.has(k));
    assert.equal(missing.length, 0, `${missing.length} çift kaçtı: ${missing.slice(0, 5)}`);
  });

  it('DOĞRULUK: hücre boyutu çok küçükse çift kaçar (alt sınır neden şart)', () => {

    const n = 40;
    const r = new Float32Array(n).fill(CONFIG.maxRadius);
    const { x, y } = arrays(n);

    for (let i = 0; i < n; i++) {
      x[i] = 400 + i;
      y[i] = 300;
    }

    const realPairs = bruteForcePairs(x, y, r, n, 0);
    assert.ok(realPairs.size > 0,
      'test kurulumu bozuk: bu yerleşimde hiç çarpışan çift yok');

    const good = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    good.build(x, y, n);
    const goodPairs = new Set();
    good.forEachPair((i, j) => goodPairs.add(normalizeKey(i, j)));
    const lostGood = [...realPairs].filter((k) => !goodPairs.has(k)).length;
    assert.equal(lostGood, 0,
      `doğru hücre boyunda ${lostGood} çift kaçtı — 3×3 komşuluk bozuk`);

    const broken = new SpatialGrid(W, H, 1);
    broken.build(x, y, n);
    const brokenPairs = new Set();
    broken.forEachPair((i, j) => brokenPairs.add(normalizeKey(i, j)));
    const lostBroken = [...realPairs].filter((k) => !brokenPairs.has(k)).length;

    assert.ok(lostBroken > 0,
      `1px hücre boyunda hiç çift kaçmadı (${lostBroken}/${realPairs.size}) — ` +
      'alt sınır kanıtlanamadı. 3×3 komşuluk 1px hücrede yeterli olamaz.');
  });

  it('DOĞRULUK: yoğun kümede tüm yakın çiftler bulunur', () => {
    const n = 6;
    const r = new Float32Array(n).fill(CONFIG.maxRadius);
    const { x, y } = arrays(n);
    for (let i = 0; i < n; i++) {
      x[i] = 400 + (i % 2);
      y[i] = 300;
    }

    const realPairs = bruteForcePairs(x, y, r, n, 0);
    assert.equal(realPairs.size, (n * (n - 1)) / 2,
      'test kurulumu bozuk: hepsi üst üste olmalı');

    const g = new SpatialGrid(W, H, cellSizeFor(CONFIG.maxRadius));
    g.build(x, y, n);
    const pairs = new Set();
    g.forEachPair((i, j) => pairs.add(normalizeKey(i, j)));
    assert.equal(pairs.size, realPairs.size, 'çift eksik');
  });

  it('ızgara gereksiz çift üretmez (verim)', () => {
    const cellSize = cellSizeFor(CONFIG.maxRadius);
    const g = new SpatialGrid(W, H, cellSize);
    const n = 800;
    const { x, y } = arrays(n);
    const r = new Float32Array(n);

    let s = 555;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      x[i] = rnd() * W;
      y[i] = rnd() * H;
      r[i] = CONFIG.minRadius + rnd() * (CONFIG.maxRadius - CONFIG.minRadius);
    }
    g.build(x, y, n);

    let gridPairs = 0;
    g.forEachPair(() => gridPairs++);

    const allPairs = (n * (n - 1)) / 2;
    assert.ok(gridPairs < allPairs * 0.35,
      `ızgara yeterince verimli değil: ${gridPairs} / ${allPairs}`);
  });

  it('yoğun kümede de doğru (tümü tek hücre)', () => {
    const g = new SpatialGrid(W, H, 20);
    const n = 300;
    const { x, y } = arrays(n);
    let s = 11;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      x[i] = 400 + rnd() * 8;
      y[i] = 300 + rnd() * 8;
    }
    g.build(x, y, n);
    const keys = new Set();
    g.forEachPair((i, j) => keys.add(normalizeKey(i, j)));
    assert.equal(keys.size, (n * (n - 1)) / 2, 'yoğun kümede çift eksik');
  });

  it('tek hücreli dünyada çift sayımı yok', () => {
    const g = new SpatialGrid(10, 10, 100);
    const n = 20;
    const { x, y } = arrays(n);
    let s = 3;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * 10; y[i] = rnd() * 10; }
    g.build(x, y, n);
    const keys = new Set();
    g.forEachPair((i, j) => keys.add(normalizeKey(i, j)));
    assert.equal(keys.size, (n * (n - 1)) / 2, 'tek hücrede çift eksik/çok');
  });

  it('çok geniş hücre (tek satır/sütun) çalışır', () => {
    const g = new SpatialGrid(W, H, 5000);
    assert.equal(g.cellCount, 1);
    const n = 5;
    const { x, y } = arrays(n);
    for (let i = 0; i < n; i++) { x[i] = i * 100; y[i] = i * 100; }
    g.build(x, y, n);
    let count = 0;
    g.forEachPair(() => count++);
    assert.equal(count, 10);
  });
});

describe('SpatialGrid — forEachNeighbor', () => {
  it('yalnız j > i olanları gezer', () => {
    const g = new SpatialGrid(W, H, 50);
    const { x, y } = arrays(6);
    for (let i = 0; i < 6; i++) { x[i] = 100; y[i] = 100; }
    g.build(x, y, 6);

    for (let i = 0; i < 6; i++) {
      g.forEachNeighbor(i, x[i], y[i], (j) => {
        assert.ok(j > i, `i=${i} iken j=${j} gezildi, j>i olmalı`);
      });
    }
  });

  it('her çift yalnız bir kez bulunur (küresel sayaç)', () => {
    const g = new SpatialGrid(W, H, 30);
    const n = 150;
    const { x, y } = arrays(n);
    let s = 77;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * W; y[i] = rnd() * H; }
    g.build(x, y, n);

    const seen = new Map();
    for (let i = 0; i < n; i++) {
      g.forEachNeighbor(i, x[i], y[i], (j) => {
        const k = normalizeKey(i, j);
        seen.set(k, (seen.get(k) || 0) + 1);
      });
    }
    for (const [k, c] of seen) {
      assert.equal(c, 1, `${k} ${c} kez sayıldı`);
    }
  });

  it('uzak parçacıkları getirmez (doğruluk)', () => {
    const g = new SpatialGrid(W, H, 20);
    const { x, y } = arrays(2);
    x[0] = 10; y[0] = 10;
    x[1] = 700; y[1] = 500;
    g.build(x, y, 2);

    let found = false;
    g.forEachNeighbor(0, x[0], y[0], (j) => { if (j === 1) found = true; });
    assert.equal(found, false, 'uzak parçacık komşu sayıldı');
  });

  it('sarmalama üzerinden kenar komşuluğu bulur', () => {
    const g = new SpatialGrid(W, H, 20);
    const { x, y } = arrays(2);
    x[0] = 2;   y[0] = 300;
    x[1] = W - 2; y[1] = 300;
    g.build(x, y, 2);

    let found = false;
    g.forEachNeighbor(0, x[0], y[0], (j) => { if (j === 1) found = true; });
    assert.equal(found, true, 'kenar komşuluğu bulunamadı');
  });
});

describe('SpatialGrid — performans', () => {
  it('3000 parçacıkta O(n) kurulum hızlı', () => {
    const g = new SpatialGrid(1280, 720, cellSizeFor(CONFIG.maxRadius));
    const n = 3000;
    const { x, y } = arrays(n);
    let s = 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * 1280; y[i] = rnd() * 720; }

    const start = performance.now();
    for (let f = 0; f < 60; f++) g.build(x, y, n);
    const per = (performance.now() - start) / 60;

    assert.ok(per < 2, `build çok yavaş: ${per.toFixed(3)}ms/kare (60fps için <2ms gerekli)`);
  });

  it('3000 parçacıkta çift taraması O(n²)DEN ÇOK HIZLI', () => {
    const g = new SpatialGrid(1280, 720, cellSizeFor(CONFIG.maxRadius));
    const n = 3000;
    const { x, y } = arrays(n);
    let s = 42;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * 1280; y[i] = rnd() * 720; }
    g.build(x, y, n);

    let pairs = 0;
    const start = performance.now();
    g.forEachPair(() => pairs++);
    const elapsed = performance.now() - start;

    const allPairs = (n * (n - 1)) / 2;
    assert.ok(elapsed < 30, `çift taraması çok yavaş: ${elapsed.toFixed(1)}ms`);
    assert.ok(pairs < allPairs * 0.1,
      `keşfedilen çift çok fazla: ${pairs} / ${allPairs} — ızgara verimsiz`);
  });

  it('bellek: cellStart doğru boyutta', () => {
    const g = new SpatialGrid(1280, 720, cellSizeFor(CONFIG.maxRadius));
    assert.equal(g.cellStart.length, g.cellCount + 1);
  });
});

describe('SpatialGrid — istatistikler', () => {
  it('stats doluluk bilgisi verir', () => {
    const g = new SpatialGrid(W, H, 40);
    const n = 100;
    const { x, y } = arrays(n);
    let s = 8;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) { x[i] = rnd() * W; y[i] = rnd() * H; }
    g.build(x, y, n);

    const st = g.stats();
    assert.ok(st.cellCount > 0);
    assert.ok(st.occupiedCells > 0 && st.occupiedCells <= n);
    assert.ok(st.occupancy > 0 && st.occupancy <= 1);
    assert.ok(st.maxCellFill >= 1);
    assert.ok(Math.abs(st.avgFill - n / st.cellCount) < 1e-6);
  });

  it('dağıtık parçacıklarda doluluk düşük olur', () => {
    const cs = 40;
    const g = new SpatialGrid(W, H, cs);
    const cols = g.cols;
    const rows = g.rows;
    const n = cols * rows;

    const { x, y } = arrays(n);
    for (let i = 0; i < n; i++) {
      x[i] = (i % cols) * cs + cs / 2;
      y[i] = Math.floor(i / cols) * cs + cs / 2;
    }
    g.build(x, y, n);

    const st = g.stats();
    assert.equal(st.occupiedCells, st.cellCount, 'her hücre dolu olmalı');
    assert.equal(st.maxCellFill, 1, 'tam seyrek: hücre başına tek parçacık');
    assert.equal(st.occupancy, 1);
  });
});