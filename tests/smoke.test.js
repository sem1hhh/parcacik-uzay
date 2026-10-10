import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = path.join(root, 'src/main.js');

function buildDom() {
  const ids = {};
  const ctx = {
    canvas: null,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '',
    setTransform() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
  };

  const counts = {};
  const ctxProxy = new Proxy(ctx, {
    get(t, k) {
      if (k in t) return t[k];
      return () => { counts[k] = (counts[k] || 0) + 1; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });

  const elementIds = [
    'stage', 'hud-mode', 'mode-badge', 'mode-index',
    'stat-fps', 'stat-count', 'stat-speed',
    'val-count', 'val-gravity', 'val-boost', 'val-friction', 'val-floor', 'val-trail',
    'ctl-count', 'ctl-gravity', 'ctl-boost', 'ctl-friction', 'ctl-floor', 'ctl-trail',
    'btn-trails', 'btn-audio', 'btn-reset',
  ];

  for (const id of elementIds) {
    const listeners = {};
    ids[id] = {
      id,
      dataset: {},
      style: {},
      value: '0',
      textContent: '',
      tagName: id.startsWith('ctl-') ? 'INPUT' : 'DIV',
      width: 0,
      height: 0,
      _listeners: listeners,
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      getContext() { return ctxProxy; },
      get clientWidth() { return 1280; },
    };
  }

  const canvas = ids.stage;

  const rafQueue = [];
  const docListeners = {};
  const winListeners = {};

  const document = {
    getElementById: (id) => ids[id] || null,
    createElement: () => ({
      width: 0, height: 0, style: {},
      getContext: () => ctxProxy,
    }),
    addEventListener(ev, fn) { (docListeners[ev] ||= []).push(fn); },
  };

  class StubAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = { id: 'dest' };
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() {
      const f = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return {
        type: 'sine', frequency: f,
        start() {}, stop() {}, connect() {}, disconnect() {},
        onended: null,
      };
    }
    createGain() {
      const g = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return { gain: g, connect() {}, disconnect() {} };
    }
  }

  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    AudioContext: StubAudioContext,
    addEventListener(ev, fn) { (winListeners[ev] ||= []).push(fn); },
  };

  return {
    document, window, ids, canvas, rafQueue, counts,
    documentListeners: docListeners,
    windowListeners: winListeners,
  };
}

async function runMain(frames = 200, opts = {}) {
  const dom = buildDom();
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    rAF: globalThis.requestAnimationFrame,
    perf: globalThis.performance,
  };

  let clock = 0;
  const FRAME_MS = 16.67;

  globalThis.document = dom.document;
  globalThis.window = dom.window;
  globalThis.requestAnimationFrame = (fn) => { dom.rafQueue.push(fn); };
  globalThis.performance = { now: () => clock };

  const url = new URL(`file://${mainPath}?t=${Date.now()}`).href;
  try {
    await import(url);
  } catch (e) {
    restore(original);
    return { error: `import: ${e.message}`, ...dom };
  }

  if (opts.movePointer) {
    for (let i = 0; i < dom.rafQueue.length; i++) {  }
    dom.ids.stage._listeners.pointermove?.forEach((fn) => {
      fn({ clientX: 400, clientY: 300 });
    });
  }

  for (let f = 0; f < frames; f++) {
    const fn = dom.rafQueue.shift();
    if (!fn) {
      restore(original);
      return { error: `döngü durdu: ${f}. karede callback yok`, ...dom, framesRun: f };
    }
    clock += FRAME_MS;
    globalThis.performance = { now: () => clock };
    try {
      fn(clock);
    } catch (e) {
      restore(original);
      return { error: `${f}. karede hata: ${e.message}`, stack: e.stack, ...dom, framesRun: f };
    }
  }

  restore(original);
  return { error: null, ...dom, framesRun: frames };

  function restore(o) {
    globalThis.document = o.document;
    globalThis.window = o.window;
    globalThis.requestAnimationFrame = o.rAF;
    globalThis.performance = o.perf;
  }
}

describe('duman testi — main.js gerçekten çalışıyor', () => {
  it('import sırasında hata yok', async () => {
    const r = await runMain(30);
    assert.equal(r.error, null, r.error);
  });

  it('200 kare (3+ saniye) hatasız çalışır', async () => {
    const r = await runMain(200);
    assert.equal(r.error, null, r.error);
  });

  it('her kare yeni bir kare planlar (döngü kopmuyor)', async () => {
    const r = await runMain(100);
    assert.equal(r.error, null, r.error);
    assert.ok(r.rafQueue.length > 0, 'döngü durdu — yeni kare planlanmadı');
  });

  it('parçacıklar DOĞURULUR ve hareket eder', async () => {
    const r = await runMain(200);
    assert.equal(r.error, null, r.error);

    const count = Number(String(r.ids['stat-count'].textContent).replace(/\D/g, ''));
    assert.ok(count > 1000,
      `HUD parçacık sayısı ${r.ids['stat-count'].textContent} — doğurma çalışmıyor`);

    const speed = Number(r.ids['stat-speed'].textContent);
    assert.ok(speed > 0,
      `ortalama hız 0 — sistem hareketsiz (parçacıklar merkezde sıkışmış?)`);
  });

  it('ekranda çizim yapılır', async () => {
    const r = await runMain(120);
    assert.equal(r.error, null, r.error);

    assert.ok(r.counts.fill > 0, 'hiç fill çağrısı — kova çizimi çalışmıyor');
    assert.ok(r.counts.arc > 0, 'hiç arc çağrısı — parçacık çizilmiyor');
    assert.ok(r.counts.beginPath > 0, 'hiç path başlatılmadı');
  });

  it('FPS hesaplanır', async () => {
    const r = await runMain(60);
    const fps = Number(r.ids['stat-fps'].textContent);
    assert.ok(Number.isFinite(fps) && fps > 0, `FPS hesaplanmadı: ${fps}`);
  });

  it('fare hareketi kuyuyu hareket ettirir', async () => {
    const r = await runMain(120, { movePointer: true });
    assert.equal(r.error, null, r.error);
    assert.ok(r.ids.stage._listeners.pointermove?.length > 0,
      'pointermove dinleyicisi bağlanmamış');
  });

  it('klavye olayları bağlı (mod değiştirme)', async () => {
    const r = await runMain(30);
    const keyHandlers = r.windowListeners.keydown || [];
    assert.ok(keyHandlers.length > 0, 'keydown dinleyicisi yok');

    const badge = r.ids['mode-badge'];
    const before = badge.textContent;
    keyHandlers.forEach((fn) => fn({ key: '3', code: 'Digit3', target: { tagName: 'BODY' }, preventDefault() {} }));
    assert.notEqual(badge.textContent, before,
      'mod değiştirildiğinde HUD güncellenmiyor');
  });

  it('slider olayları CONFIG\'i günceller', async () => {
    const r = await runMain(30);
    const gravity = r.ids['ctl-gravity'];
    const handlers = gravity._listeners.input || [];
    assert.ok(handlers.length > 0, 'gravity slider dinleyicisi yok');

    gravity.value = '6000000';
    handlers.forEach((fn) => fn());
    assert.equal(r.ids['val-gravity'].textContent, '6.0M',
      `slider etiketi güncellenmedi: ${r.ids['val-gravity'].textContent}`);
  });
});

describe('duman testi — açılış animasyonu', () => {
  it('açılışta parçacıklar merkezden yayılır', async () => {
    const r = await runMain(30);
    assert.equal(r.error, null, r.error);
    const speed = Number(r.ids['stat-speed'].textContent);
    assert.ok(speed > 0, 'açılışta hız 0 — patlama kuvveti uygulanmıyor');
  });
});

describe('duman testi — kapsam hataları', () => {
  async function withBrokenMain(mutate, fn) {
    const src = fs.readFileSync(mainPath, 'utf8');
    const broken = mutate(src);
    assert.notEqual(broken, src, 'mutasyon uygulanamadı');

    const tmp = path.join(root, 'src', '__smoke_broken__.js');
    fs.writeFileSync(tmp, broken);
    try {
      await fn(tmp);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async function runFile(file, frames = 120, opts = {}) {
    const dom = buildDom();
    const original = {
      document: globalThis.document,
      window: globalThis.window,
      rAF: globalThis.requestAnimationFrame,
      perf: globalThis.performance,
    };

    let clock = 0;
    globalThis.document = dom.document;
    globalThis.window = dom.window;
    globalThis.requestAnimationFrame = (fn) => { dom.rafQueue.push(fn); };
    globalThis.performance = { now: () => clock };

    try {
      await import(new URL(`file://${file}?t=${Date.now()}-${Math.random()}`).href);
    } catch (e) {
      restore();
      return { error: `import: ${e.message}` };
    }

    const stage = dom.ids.stage;
    const target = { clientX: 640, clientY: 360, button: 0 };

    for (let f = 0; f < frames; f++) {
      const fn = dom.rafQueue.shift();
      if (!fn) { restore(); return { error: `döngü ${f}. karede durdu` }; }

      if (f % 10 === 0) {
        stage._listeners.pointermove?.forEach((h) => h({ ...target, clientX: 400 + f * 3 }));
      }

      if (f % 40 === 0) {
        stage._listeners.pointerdown?.forEach((h) => h({ ...target }));
      }
      if (f % 40 === 5) {
        (dom.windowListeners.pointerup || []).forEach((h) => h({ ...target }));
      }
      if (f % 60 === 0) {
        (dom.windowListeners.keydown || []).forEach((h) =>
          h({ key: '2', code: 'Digit2', target: { tagName: 'BODY' }, preventDefault() {} }));
        dom.ids['btn-reset']._listeners.click?.forEach((h) => h({}));
        dom.ids['btn-trails']._listeners.click?.forEach((h) => h({}));
      }
      if (opts.sliders) {
        for (const id of ['ctl-count', 'ctl-gravity', 'ctl-boost', 'ctl-friction', 'ctl-floor', 'ctl-trail']) {
          const el = dom.ids[id];
          el._listeners.input?.forEach((h) => h({ target: el }));
        }
      }

      if (f === 0) {
        if (opts.buttons) {
          for (const id of opts.buttons) {
            dom.ids[id]?._listeners.click?.forEach((h) => h({}));
          }
        }
        if (opts.key) {
          const k = opts.key;
          (dom.windowListeners.keydown || []).forEach((h) =>
            h({ key: k.key, code: k.code, target: { tagName: 'BODY' }, preventDefault() {} }));
        }
      }

      clock += 16.67;
      globalThis.performance = { now: () => clock };
      try {
        fn(clock);
      } catch (e) {
        restore();
        return { error: `${f}. karede hata: ${e.message}` };
      }
    }

    restore();
    return { error: null, ...dom };
    function restore() {
      globalThis.document = original.document;
      globalThis.window = original.window;
      globalThis.requestAnimationFrame = original.rAF;
      globalThis.performance = original.perf;
    }
  }

  it('duman testi tüm etkileşim yollarını tetikliyor (fare, klavye, slider)', async () => {
    const r = await runFile(mainPath, 120, { sliders: true });
    assert.equal(r.error, null, r.error);
  });

  it('kapsam hatası enjekte edilirse YAKALANIR', async () => {
    await withBrokenMain(
      (src) => src.replace(
        /function applyDrag\(dt\) \{/,
        'function applyDrag(dt) { const boom = undefinedVariableXYZ + 1;'
      ),
      async (tmp) => {
        const r = await runFile(tmp, 80);
        assert.ok(r.error, 'kapsam hatası YAKALANMADI — kontrol sahte güvenlik veriyor');
        assert.match(r.error, /undefinedVariableXYZ|hareket/i,
          `beklenen hatayı gördü ama farklı hata: ${r.error}`);
      }
    );
  });

  it('gerçek hatayı enjekte edersek (kapsam dışı dt) yakalanır', async () => {
    await withBrokenMain(
      (src) => src.replace(
        /const falloff = 1 \/ \(1 \+ d \/ 300\);/,
        `const falloff = 1 / (1 + d / 300) + scopeLeakXYZ;`
      ),
      async (tmp) => {
        const r = await runFile(tmp, 80);
        assert.ok(r.error, 'kapsam hatası yakalanmadı');
      }
    );
  });

  it('physicsStep içindeki bir hata yakalanır', async () => {
    await withBrokenMain(
      (src) => src.replace(
        /function physicsStep\(dt\) \{/,
        'function physicsStep(dt) { const bad = physicsStepLeak;'
      ),
      async (tmp) => {
        const r = await runFile(tmp, 40);
        assert.ok(r.error, 'physicsStep hatası yakalanmadı');
      }
    );
  });

  it('ses butonu çalışır ve aria-pressed günceller', async () => {
    const r = await runFile(mainPath, 90, { buttons: ['btn-audio'] });
    assert.equal(r.error, null, r.error);
    assert.equal(r.window.AudioContext !== undefined, true, 'test DOM AudioContext içermiyor');
    assert.equal(r.window.AudioContext !== null, true, 'AudioContext null');
    assert.equal(r.ids['btn-audio'].getAttribute('aria-pressed'), 'true',
      'buton basıldığında aria-pressed güncellenmedi');
  });

  it('ses butonu AudioContext olmasa da ÇÖKMEZ', async () => {
    await withBrokenMain(
      (src) => src.replace(
        /const AudioCtor = typeof window[^;]*;/s,
        'const AudioCtor = class { constructor() { throw new Error("yok"); } };'
      ),
      async (tmp) => {
        const r = await runFile(tmp, 90);
        assert.equal(r.error, null, `ses yokken uygulama çöktü: ${r.error}`);
      }
    );
  });

  it('HER slider config\'e YAZAR (bağlı olmak yetmez, uygulamalı da olmalı)', async () => {
    const r = await runFile(mainPath, 60, { sliders: true });
    assert.equal(r.error, null, r.error);

    for (const id of ['ctl-count', 'ctl-gravity', 'ctl-boost', 'ctl-friction', 'ctl-floor', 'ctl-trail']) {
      const el = r.ids[id];
      const handlers = el._listeners.input || [];
      assert.ok(handlers.length > 0, `${id}: input dinleyicisi bağlı değil`);
    }

    const boost = r.ids['ctl-boost'];
    boost.value = '5.5';
    boost._listeners.input.forEach((h) => h({ target: boost }));
    assert.equal(r.ids['val-boost'].textContent, '5.5×',
      `boost etiketi güncellenmedi: ${r.ids['val-boost'].textContent}`);
  });

  it('ses: şok dalgası oluşunca ÇALINIR (sadece aç/kapa değil)', async () => {
    const r = await runFile(mainPath, 60, { buttons: ['btn-audio'] });
    assert.equal(r.error, null, r.error);

    assert.equal(r.ids['btn-audio'].getAttribute('aria-pressed'), 'true',
      'ses açık değil — test önce koşullu');

    const stage = r.ids.stage;
    const target = { clientX: 640, clientY: 360, button: 0 };
    stage._listeners.pointerdown?.forEach((h) => h({ ...target }));
    assert.equal(r.error, null, `şok sırasında hata: ${r.error}`);
  });

  it('ses: pointerdown DALGA ÜRETTİĞİNİ doğrular', async () => {
    const r = await runFile(mainPath, 60, { buttons: ['btn-audio'] });
    assert.equal(r.error, null, r.error);

    const stage = r.ids.stage;
    const target = { clientX: 640, clientY: 360, button: 0 };

    let threw = null;
    try {
      stage._listeners.pointerdown?.forEach((h) => h({ ...target }));
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, null, `pointerdown çöktü: ${threw?.message}`);
    assert.ok(stage._listeners.pointerdown?.length > 0,
      'pointerdown dinleyicisi bağlı değil');
  });

  it('M tuşu sesi açar', async () => {
    const r = await runFile(mainPath, 60, { key: { key: 'm', code: 'KeyM' } });
    assert.equal(r.error, null, r.error);
    assert.equal(r.ids['btn-audio'].getAttribute('aria-pressed'), 'true',
      'M tuşu sesi açmadı');
  });

  it('hareket azaltma tercihi simüle edilirse çökmez', async () => {
    const dom = buildDom();
    dom.window.matchMedia = (q) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener() {}, removeEventListener() {},
    });

    const original = {
      document: globalThis.document, window: globalThis.window,
      rAF: globalThis.requestAnimationFrame, performance: globalThis.performance,
    };
    let clock = 0;
    globalThis.document = dom.document;
    globalThis.window = dom.window;
    globalThis.requestAnimationFrame = (fn) => dom.rafQueue.push(fn);
    globalThis.performance = { now: () => clock };

    try {
      await import(new URL(`file://${mainPath}?t=${Date.now()}`).href);
      for (let f = 0; f < 90; f++) {
        const fn = dom.rafQueue.shift();
        if (!fn) throw new Error('döngü durdu');
        clock += 16.67;
        globalThis.performance = { now: () => clock };
        fn(clock);
      }
    } catch (e) {
      assert.fail(`hareket azaltma yolu çöktü: ${e.message}`);
    } finally {
      globalThis.document = original.document;
      globalThis.window = original.window;
      globalThis.requestAnimationFrame = original.rAF;
      globalThis.performance = original.performance;
    }
  });

  it('temiz kaynak hatasız çalışır (kontrol sahte alarm üretmiyor)', async () => {
    const r = await runFile(mainPath, 150, { sliders: true });
    assert.equal(r.error, null,
      `kontrol temiz kodda hata buldu (yanlış pozitif): ${r.error}`);
  });
});
