export function createAudio(options = {}) {
  return {
    ctx: options.ctx ?? null,
    ctor: options.ctor ?? null,

    enabled: options.enabled ?? false,
    unlocked: false,

    baseFreq: options.baseFreq ?? 120,
    sweepTo: options.sweepTo ?? 38,
    duration: options.duration ?? 0.28,
    gain: options.gain ?? 0.32,
    noise: options.noise ?? 0.25,
  };
}

export function ensureContext(audio) {
  if (audio.ctx) return audio.ctx;
  if (!audio.ctor) return null;
  try {
    audio.ctx = new audio.ctor();
    return audio.ctx;
  } catch {
    return null;
  }
}

export function unlockAudio(audio) {
  const ctx = ensureContext(audio);
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume();
    }
    audio.unlocked = true;
    return true;
  } catch {
    return false;
  }
}

export function playThump(audio, opts = {}) {
  if (!audio.enabled) return false;

  const ctx = ensureContext(audio);
  if (!ctx) return false;

  const {
    intensity = 1,
    pitch = 1,
    baseFreq = audio.baseFreq,
    sweepTo = audio.sweepTo,
    duration = audio.duration,
    gain = audio.gain,
  } = opts;

  const amp = Math.max(0, Math.min(1, intensity)) * gain;
  if (amp <= 0) return false;

  const f0 = Math.max(20, baseFreq * pitch);
  const f1 = Math.max(20, sweepTo * pitch);

  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(f1, now + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(amp, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(env);
  env.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration);

  osc.onended = () => {
    try {
      osc.disconnect();
      env.disconnect();
    } catch {
    }
  };

  return true;
}

export function setEnabled(audio, on) {
  audio.enabled = !!on;
  if (on) unlockAudio(audio);
  return audio.enabled;
}

export function pitchForSpeed(speed, reference = 1200) {
  const t = speed / reference;
  if (!(t > 0)) return 1;
  if (t >= 1) return 1.6;
  return 1 + t * 0.6;
}