import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAudio, ensureContext, unlockAudio, playThump, setEnabled, pitchForSpeed,
} from '../src/audio.js';

class FakeAudioContext {
  constructor() {
    this.log = { oscillators: [], gains: [], connects: [], destConnects: 0 };
    this.currentTime = 1.0;
    this.state = 'running';
    this.destination = { id: 'destination' };
  }

  resume() { this.state = 'running'; return Promise.resolve(); }

  createOscillator() {
    const log = this.log;
    const o = {
      type: 'sine',
      frequency: {
        _events: [],
        setValueAtTime(v, t) { this._events.push(['set', v, t]); },
        exponentialRampToValueAtTime(v, t) { this._events.push(['exp', v, t]); },
      },
      started: null,
      stopped: null,
      onended: null,
      disconnected: false,
      start(t) { this.started = t; },
      stop(t) { this.stopped = t; },
      connect(node) { log.connects.push(node); return node; },
      disconnect() { this.disconnected = true; },
    };
    log.oscillators.push(o);
    return o;
  }

  createGain() {
    const log = this.log;
    const g = {
      gain: {
        _events: [],
        setValueAtTime(v, t) { this._events.push(['set', v, t]); },
        linearRampToValueAtTime(v, t) { this._events.push(['lin', v, t]); },
        exponentialRampToValueAtTime(v, t) { this._events.push(['exp', v, t]); },
      },
      disconnected: false,
      connect(node) { log.connects.push(node); return node; },
      disconnect() { this.disconnected = true; },
    };
    log.gains.push(g);
    return g;
  }

  connect(node) { this.log.connects.push(node); return node; }
}

const ctor = FakeAudioContext;

describe('createAudio — varsayılanlar', () => {
  it('ses VARSAYILAN KAPALI (kullanıcı isteği bekleniyor)', () => {
    const a = createAudio();
    assert.equal(a.enabled, false, 'ses açık başlamamalı — kullanıcı tercihi');
  });

  it('context henüz oluşturulmamış (lazy)', () => {
    const a = createAudio({ ctor });
    assert.equal(a.ctx, null, 'context oluşturulmamalı — oluşturmak pahalı');
  });

  it('unlocked=false başlar', () => {
    assert.equal(createAudio({ ctor }).unlocked, false);
  });
});

describe('ensureContext', () => {
  it('ctor ile context oluşturur', () => {
    const a = createAudio({ ctor });
    const ctx = ensureContext(a);
    assert.ok(ctx, 'context oluşmadı');
    assert.equal(a.ctx, ctx, 'context kaydedilmedi');
  });

  it('aynı context\'i tekrar döner (yoklamaz)', () => {
    const a = createAudio({ ctor });
    const first = ensureContext(a);
    const second = ensureContext(a);
    assert.equal(first, second);
  });

  it('ctor yoksa null döner, çökmez', () => {
    const a = createAudio();
    assert.equal(ensureContext(a), null);
  });

  it('constructor hata fırlatırsa yutulur', () => {
    class Bad { constructor() { throw new Error('AudioContext yok'); } }
    const a = createAudio({ ctor: Bad });
    assert.equal(ensureContext(a), null, 'hata sızdı');
  });

  it('constructor DEĞİL (arrow fn) ise çökmez, null döner', () => {
    const a = createAudio({ ctor: () => makeFakeAudioContext() });
    assert.equal(ensureContext(a), null, 'arrow function kabul edildi');
  });

  it('hazır context doğrudan verilebilir', () => {
    const ctx = new FakeAudioContext();
    const a = createAudio({ ctx });
    assert.equal(ensureContext(a), ctx);
  });
});

describe('unlockAudio — autopolika', () => {
  it('askıdaki context\'i devam ettirir', () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    const a = createAudio({ ctx });
    assert.equal(unlockAudio(a), true);
    assert.equal(ctx.state, 'running');
    assert.equal(a.unlocked, true);
  });

  it('çalışan context\'e dokunmaz', () => {
    const ctx = new FakeAudioContext();
    const a = createAudio({ ctx });
    unlockAudio(a);
    assert.equal(a.unlocked, true);
  });

  it('context yoksa başarısız olur (ses yine de kapalı kalır)', () => {
    const a = createAudio();
    assert.equal(unlockAudio(a), false);
    assert.equal(a.unlocked, false);
  });

  it('resume hata fırlatırsa yutulur', () => {
    const ctx = new FakeAudioContext();
    ctx.resume = () => { throw new Error('izin yok'); };
    const a = createAudio({ ctx });
    assert.doesNotThrow(() => unlockAudio(a));
  });
});

describe('playThump — nota üretimi', () => {
  it('ses kapalıyken HİÇ ÇALMAZ', () => {
    const a = createAudio({ ctor, enabled: false });
    assert.equal(playThump(a), false);
    assert.equal(a.ctx, null, 'kapalıyken context bile oluşturulmamalı');
  });

  it('ses açıkken osilatör ve kazanç üretir', () => {
    const a = createAudio({ ctor, enabled: true });
    assert.equal(playThump(a), true);

    const ctx = a.ctx;
    assert.equal(ctx.log.oscillators.length, 1);
    assert.equal(ctx.log.gains.length, 1);
  });

  it('osilatör -> kazanç -> çıkış zinciri doğru', () => {
    const a = createAudio({ ctor, enabled: true });
    playThump(a);
    const ctx = a.ctx;
    assert.ok(ctx.log.connects.length >= 2,
      `zincir eksik: ${ctx.log.connects.length} bağlantı`);
    assert.ok(ctx.log.connects.includes(ctx.destination),
      'kazanç çıkışa (destination) bağlanmamış');
  });

  it('frekans DÜŞER (bass thup hissi)', () => {
    const a = createAudio({ ctor, enabled: true });
    playThump(a);
    const f = a.ctx.log.oscillators[0].frequency;
    assert.equal(f._events[0][0], 'set');
    const start = f._events[0][1];
    const end = f._events[f._events.length - 1][1];
    assert.ok(end < start, `frekans düşmüyor: ${start} -> ${end}`);
  });

  it('zarf: hızlı yükseliş, yavaş sönüm (percussive)', () => {
    const a = createAudio({ ctor, enabled: true });
    playThump(a);
    const g = a.ctx.log.gains[0].gain;
    const types = g._events.map((e) => e[0]);
    assert.ok(types.includes('lin'), 'doğrusal yükseliş yok');
    assert.ok(types.includes('exp'), 'eksponansiyel sönüm yok');
    assert.ok(g._events[g._events.length - 1][1] < 0.001, 'sönüm sonu sıfır değil');
  });

  it('osilatör durdurulur (kaynak sızmasın)', () => {
    const a = createAudio({ ctor, enabled: true });
    playThump(a);
    const o = a.ctx.log.oscillators[0];
    assert.ok(o.started !== null, 'başlatılmadı');
    assert.ok(o.stopped !== null, 'durdurulmadı — osilatör sonsuza dek çalışır');
    assert.ok(o.stopped > o.started, 'bitiş başlangıçtan önce');
  });

  it('ended olayında düğümler temizlenir (bellek sızıntısı koruması)', () => {
    const a = createAudio({ ctor, enabled: true });
    playThump(a);
    const o = a.ctx.log.oscillators[0];
    const g = a.ctx.log.gains[0];
    assert.equal(typeof o.onended, 'function', 'temizlik işleyicisi yok');

    o.onended();
    assert.equal(o.disconnected, true, 'osilatör kopmadı');
    assert.equal(g.disconnected, true, 'kazanç kopmadı');
  });

  it('intensity 0 ise çalmaz (sessiz şok)', () => {
    const a = createAudio({ ctor, enabled: true });
    assert.equal(playThump(a, { intensity: 0 }), false);
    assert.equal(a.ctx.log.oscillators.length, 0);
  });

  it('intensity genliği ölçekler', () => {
    const weak = createAudio({ ctor, enabled: true });
    playThump(weak, { intensity: 0.25 });
    const strong = createAudio({ ctor, enabled: true });
    playThump(strong, { intensity: 1 });

    const peak = (a) => Math.max(...a.ctx.log.gains[0].gain._events.map((e) => e[1]));
    assert.ok(peak(strong) > peak(weak),
      `yoğunluk genliği etkilemiyor: ${peak(weak)} vs ${peak(strong)}`);
  });

  it('aşırı intensity clamp\'lenir (patlama yok)', () => {
    const a = createAudio({ ctor, enabled: true });
    assert.doesNotThrow(() => playThump(a, { intensity: 9999 }));
    const peak = Math.max(...a.ctx.log.gains[0].gain._events.map((e) => e[1]));
    assert.ok(peak <= a.gain + 1e-6, `genlik clamp edilmedi: ${peak}`);
  });

  it('pitch frekansları ölçekler', () => {
    const normal = createAudio({ ctor, enabled: true });
    playThump(normal);
    const deep = createAudio({ ctor, enabled: true });
    playThump(deep, { pitch: 2 });
    assert.ok(
      deep.ctx.log.oscillators[0].frequency._events[0][1] >
      normal.ctx.log.oscillators[0].frequency._events[0][1],
      'pitch frekansı değiştirmedi');
  });

  it('aşırı düşük pitch sıfırdan büyük kalır (log hatası yok)', () => {
    const a = createAudio({ ctor, enabled: true });
    assert.doesNotThrow(() => playThump(a, { pitch: 0.0001 }));
    const f = a.ctx.log.oscillators[0].frequency._events[0][1];
    assert.ok(f > 0 && f >= 20, `frekans geçersiz: ${f}`);
  });

  it('ses açık ama context yoksa çökmez', () => {
    const a = createAudio({ enabled: true });
    assert.equal(playThump(a), false);
  });

  it('spam çağrılarda context yeniden oluşmaz', () => {
    const a = createAudio({ ctor, enabled: true });
    for (let i = 0; i < 50; i++) playThump(a);
    const first = a.ctx;
    assert.equal(a.ctx, first);
    assert.equal(first.log.oscillators.length, 50, '50 nota üretilmeli');
  });
});

describe('setEnabled', () => {
  it('açar ve context hazırlar', () => {
    const a = createAudio({ ctor });
    assert.equal(setEnabled(a, true), true);
    assert.equal(a.enabled, true);
    assert.ok(a.ctx, 'context oluşmadı');
  });

  it('kapatır', () => {
    const a = createAudio({ ctor, enabled: true });
    ensureContext(a);
    setEnabled(a, false);
    assert.equal(a.enabled, false);
    assert.equal(playThump(a), false, 'kapatıldıktan sonra çalmamalı');
  });

  it('kapatıp açmak yeniden hazırlar', () => {
    const a = createAudio({ ctor, enabled: true });
    ensureContext(a);
    setEnabled(a, false);
    setEnabled(a, true);
    assert.equal(a.unlocked, true);
  });
});

describe('pitchForSpeed — hıza göre ton', () => {
  it('durgunlukta nötr (1.0)', () => {
    assert.equal(pitchForSpeed(0), 1);
  });

  it('hızlı hareket daha tiz', () => {
    assert.ok(pitchForSpeed(1200) > 1, 'hızlı hareket tizleşmiyor');
  });

  it('monoton artar', () => {
    let prev = 0;
    for (let s = 0; s <= 2400; s += 100) {
      const p = pitchForSpeed(s);
      assert.ok(p >= prev, `azaldı @${s}: ${prev} -> ${p}`);
      prev = p;
    }
  });

  it('tavana yapışır (sonsuz artmaz)', () => {
    const a = pitchForSpeed(1200);
    const b = pitchForSpeed(100000);
    assert.equal(a, b);
    assert.ok(b <= 1.7, `tavan çok yüksek: ${b}`);
  });

  it('negatif hız nötr', () => {
    assert.equal(pitchForSpeed(-500), 1);
  });

  it('NaN hız nötr', () => {
    assert.equal(pitchForSpeed(NaN), 1);
  });
});