import { CONFIG, RANGES, MODES, MODE_LABELS } from './config.js';
import { SpatialGrid, cellSizeFor } from './grid.js';
import {
  createParticles, spawnParticles, spawnIntro, stepWorld,
  particleStats, reflowParticles, makeRandom, introEnvelope, applyIntroBurst,
} from './particles.js';
import { createRenderer, resizeRenderer, render, clearTrails } from './renderer.js';
import { makeParams } from './physics.js';
import { createAudio, setEnabled, unlockAudio, playThump, pitchForSpeed } from './audio.js';
import {
  createInteraction, updatePointer, stepInteraction, snapPointer,
  createShockSystem, spawnShock, stepShocks, applyShocks, clearShocks,
} from './interaction.js';

const canvas = document.getElementById('stage');

const el = {
  mode: document.getElementById('hud-mode'),
  modeBadge: document.getElementById('mode-badge'),
  modeIndex: document.getElementById('mode-index'),
  fps: document.getElementById('stat-fps'),
  count: document.getElementById('stat-count'),
  speed: document.getElementById('stat-speed'),
};

const particles = createParticles(RANGES.count.max);
const params = makeParams();

const renderer = createRenderer(canvas);
const grid = new SpatialGrid(CONFIG.width, CONFIG.height, cellSizeFor(CONFIG.maxRadius));

const inter = createInteraction({ x: CONFIG.width / 2, y: CONFIG.height / 2 });
const shocks = createShockSystem();

let width = CONFIG.width;
let height = CONFIG.height;
let dpr = 1;
let modeIndex = 0;
let paused = false;
let seedCounter = 1;
let pressed = false;

const AudioCtor = typeof window !== 'undefined'
  ? (window.AudioContext || window.webkitAudioContext)
  : null;
const audio = createAudio({
  ctor: AudioCtor,
  enabled: false,
  baseFreq: CONFIG.audioBaseFreq,
  sweepTo: CONFIG.audioSweepTo,
  duration: CONFIG.audioDuration,
  gain: CONFIG.audioGain,
});

const reduceMotion = typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let introTime = 0;
const introActive = () => introTime < CONFIG.introDuration;

function startIntro() {
  introTime = 0;
  spawnIntro(particles, width, height, {
    count: CONFIG.count,
    burstSpeed: (Math.min(width, height) / 2) / CONFIG.introFillTime,
    random: makeRandom(seedCounter++),
  });
  clearTrails(renderer);
  renderer.trailFade = CONFIG.introTrailFade;
  el.count.textContent = particles.count.toLocaleString('tr-TR');
}

function resize() {
  const oldW = width;
  const oldH = height;

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);

  resizeRenderer(renderer, width, height, dpr);
  grid.setBounds(width, height, cellSizeFor(CONFIG.maxRadius));

  if (particles.count > 0 && oldW > 0 && oldH > 0) {
    reflowParticles(particles, oldW, oldH, width, height);
  }

  snapPointer(inter, width / 2, height / 2);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

function respawn(count) {
  startIntro();
  const input = document.getElementById('ctl-count');
  if (input) input.value = String(count);
  const label = document.getElementById('val-count');
  if (label) label.textContent = count.toLocaleString('tr-TR');
  particles.count = Math.min(count, particles.capacity);
  el.count.textContent = particles.count.toLocaleString('tr-TR');
}

const CONTROL_KEYS = {
  'ctl-count': 'count',
  'ctl-gravity': 'gravityStrength',
  'ctl-boost': 'velocityBoost',
  'ctl-friction': 'friction',
  'ctl-floor': 'speedFloor',
  'ctl-trail': 'trailFade',
};

const CONTROLS = {
  'ctl-count': {
    fmt: (v) => v.toLocaleString('tr-TR'), el: 'val-count', apply: respawn,
  },
  'ctl-gravity': {
    fmt: (v) => (v / 1e6).toFixed(1) + 'M', el: 'val-gravity',
    apply: (v) => { params.strength = v; },
  },
  'ctl-boost': {
    fmt: (v) => v.toFixed(1) + '×', el: 'val-boost',
    apply: (v) => { inter.boostMax = v; },
  },
  'ctl-friction': {
    fmt: (v) => v.toFixed(4), el: 'val-friction',
    apply: (v) => { params.damping = v; },
  },
  'ctl-floor': {
    fmt: (v) => String(v), el: 'val-floor',
    apply: (v) => { params.speedFloor = v; },
  },
  'ctl-trail': {
    fmt: (v) => v.toFixed(2), el: 'val-trail',
    apply: (v) => { renderer.trailFade = v; },
  },
};

for (const [id, { fmt, el: labelId, apply }] of Object.entries(CONTROLS)) {
  const input = document.getElementById(id);
  const label = document.getElementById(labelId);
  if (!input || !label) continue;

  const initial = CONFIG[CONTROL_KEYS[id]];
  input.value = String(initial);
  label.textContent = fmt(initial);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    apply(v);
    label.textContent = fmt(v);
  });
}

function setMode(i) {
  modeIndex = ((i % MODES.length) + MODES.length) % MODES.length;
  const mode = MODES[modeIndex];
  el.mode.dataset.mode = mode;
  el.modeBadge.textContent = MODE_LABELS[mode].split(' ')[0];
  el.modeIndex.textContent = `${modeIndex + 1} / ${MODES.length}`;
}

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;

  const n = ['1', '2', '3'].indexOf(e.key);
  if (n >= 0) { setMode(n); return; }

  switch (e.code) {
    case 'Space': paused = !paused; e.preventDefault(); break;
    case 'KeyR': respawn(Number(document.getElementById('ctl-count')?.value ?? CONFIG.count)); break;
    case 'KeyT': toggleTrails(); break;
    case 'KeyM': toggleAudio(); break;
    default: break;
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  setMode(modeIndex + 1);
});

canvas.addEventListener('pointermove', (e) => {
  updatePointer(inter, e.clientX, e.clientY);
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pressed = true;
  updatePointer(inter, e.clientX, e.clientY);
  snapPointer(inter, e.clientX, e.clientY);

  if (spawnShock(shocks, e.clientX, e.clientY)) {
    playShockSound();
  }
});

window.addEventListener('pointerup', () => { pressed = false; });
canvas.addEventListener('pointerleave', () => { pressed = false; });

function toggleTrails() {
  renderer.trailsEnabled = !renderer.trailsEnabled;
  const btn = document.getElementById('btn-trails');
  btn?.setAttribute('aria-pressed', String(renderer.trailsEnabled));
  if (!renderer.trailsEnabled) clearTrails(renderer);
}

document.getElementById('btn-trails')?.addEventListener('click', toggleTrails);
document.getElementById('btn-reset')?.addEventListener('click', () => respawn(CONFIG.count));
function toggleAudio() {
  const on = !audio.enabled;
  if (on && !unlockAudio(audio)) {
    setEnabled(audio, false);
  } else {
    setEnabled(audio, on);
  }
  const btn = document.getElementById('btn-audio');
  btn?.setAttribute('aria-pressed', String(audio.enabled));
  if (audio.enabled) playThump(audio, { intensity: 0.6, pitch: 1.2 });
}

document.getElementById('btn-audio')?.addEventListener('click', toggleAudio);

if (reduceMotion) {
  renderer.trailsEnabled = CONFIG.reducedMotionTrails;
  renderer.glow = false;
  CONFIG.introDuration = CONFIG.reducedMotionIntro;
}

setMode(0);
resize();
startIntro();
clearShocks(shocks);
snapPointer(inter, width / 2, height / 2);
document.getElementById('btn-trails')?.setAttribute('aria-pressed', String(renderer.trailsEnabled));
document.getElementById('btn-audio')?.setAttribute('aria-pressed', 'false');

let last = performance.now();
let accumulator = 0;
let fpsSmoother = 60;

function frame(now) {
  requestAnimationFrame(frame);

  if (introTime >= CONFIG.introDuration && introTime < CONFIG.introDuration + 1) {
    introTime = CONFIG.introDuration + 1;
    const trailInput = document.getElementById('ctl-trail');
    renderer.trailFade = trailInput ? Number(trailInput.value) : CONFIG.trailFade;
  }

  const frameTime = Math.min((now - last) / 1000, CONFIG.maxFrameTime);
  last = now;

  if (frameTime > 0) {
    const instant = 1 / frameTime;
    fpsSmoother += (instant - fpsSmoother) * 0.08;
    el.fps.textContent = String(Math.round(fpsSmoother));
  }

  if (paused) { accumulator = 0; return; }

  accumulator += frameTime;
  let steps = 0;
  while (accumulator >= CONFIG.fixedDt && steps < CONFIG.maxSubSteps) {
    physicsStep(CONFIG.fixedDt);
    accumulator -= CONFIG.fixedDt;
    steps++;
  }
  if (steps >= CONFIG.maxSubSteps) accumulator = 0;

  render(renderer, particles, params.maxSpeed);

  const stats = particleStats(particles, params.maxSpeed);
  el.speed.textContent = String(Math.round(stats.avgSpeed));
}

function physicsStep(dt) {
  const mode = MODES[modeIndex];
  const intro = introActive();

  const src = stepInteraction(inter, dt, params);

  let strength = src.strength;
  params.shellRadius = 0;
  if (mode === 'repel') {
    strength = -strength;
  } else if (mode === 'mixed') {
    params.shellRadius = CONFIG.shellRadius;
  }

  if (pressed) applyDrag(dt);

  if (intro) {
    applyIntroBurst(particles, width, height, dt,
      introEnvelope(introTime, CONFIG.introDuration));
    introTime += dt;
  }

  stepWorld(particles, params, grid, dt, width, height, {
    x: src.x,
    y: src.y,
    active: !intro,
    strength,
  });

  stepShocks(shocks, dt);
  if (shocks.waves.length) applyShocks(shocks, particles, params.maxSpeed);
}

function playShockSound() {
  if (!audio.enabled) return;
  playThump(audio, { intensity: 1, pitch: pitchForSpeed(inter.speed) });
}

function applyDrag(dt) {
  const { x, y, vx, vy, count: n } = particles;
  const tx = inter.targetX;
  const ty = inter.targetY;
  const k = CONFIG.dragStrength * dt;

  for (let i = 0; i < n; i++) {
    const dx = tx - x[i];
    const dy = ty - y[i];
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) continue;

    const falloff = 1 / (1 + d / 300);
    const acc = k * falloff * 400;
    vx[i] += (dx / d) * acc;
    vy[i] += (dy / d) * acc;
  }
}

requestAnimationFrame(frame);

console.log(
  `[parcacik-uzay] ${particles.count} parçacık | ızgara ${grid.cols}x${grid.rows} @ ${grid.cellSize.toFixed(1)}px`
);