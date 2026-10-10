import { CONFIG } from './config.js';
import {
  gravityField, applySpeedFloor, clampSpeed, wrapPosition, safe,
  resolveCollision, makeParams,
} from './physics.js';
import { SpatialGrid, cellSizeFor } from './grid.js';

const TAU = Math.PI * 2;

export function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createParticles(capacity = CONFIG.count) {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    r: new Float32Array(capacity),
  };
}

export function spawnParticles(world, width, height, options = {}) {
  const {
    count = CONFIG.count,
    minRadius = CONFIG.minRadius,
    maxRadius = CONFIG.maxRadius,
    initSpeed = 120,
    random = makeRandom(1),
  } = options;

  if (count > world.capacity) {
    throw new RangeError(
      `capacity ${world.capacity} yetersiz, ${count} parçacık istendi`
    );
  }

  const n = Math.max(0, Math.floor(count));
  world.count = n;

  for (let i = 0; i < n; i++) {
    world.x[i] = random() * width;
    world.y[i] = random() * height;

    const angle = random() * TAU;
    const speed = random() * initSpeed;
    world.vx[i] = Math.cos(angle) * speed;
    world.vy[i] = Math.sin(angle) * speed;

    world.r[i] = minRadius + Math.sqrt(random()) * (maxRadius - minRadius);
  }

  return world;
}

export function spawnIntro(world, width, height, options = {}) {
  const {
    count = CONFIG.count,
    minRadius = CONFIG.minRadius,
    maxRadius = CONFIG.maxRadius,
    burstSpeed = CONFIG.introBurst,
    random = makeRandom(1),
  } = options;

  if (count > world.capacity) {
    throw new RangeError(
      `capacity ${world.capacity} yetersiz, ${count} parçacık istendi`
    );
  }
  const n = Math.max(0, Math.floor(count));
  world.count = n;

  const cx = width / 2;
  const cy = height / 2;
  const coreRadius = CONFIG.introCoreRadius;

  for (let i = 0; i < n; i++) {
    const a = random() * TAU;
    const d = Math.sqrt(random()) * coreRadius;
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d;
    world.x[i] = cx + dx;
    world.y[i] = cy + dy;

    const radial = Math.atan2(dy, dx);
    const angle = radial + (random() - 0.5) * CONFIG.introSpread;
    const speed = burstSpeed * (0.55 + random() * 0.45);
    world.vx[i] = Math.cos(angle) * speed;
    world.vy[i] = Math.sin(angle) * speed;

    world.r[i] = minRadius + Math.sqrt(random()) * (maxRadius - minRadius);
  }

  return world;
}

export function introEnvelope(t, duration = CONFIG.introDuration) {
  if (!(duration > 0) || t >= duration) return 0;
  if (t < 0) return 0;
  if (t === 0) return 1;
  const x = t / duration;
  return 1 - x * x * (3 - 2 * x);
}

export function applyIntroBurst(world, width, height, dt, envelope, cx = null, cy = null) {
  if (!(envelope > 0)) return world;

  const ox = cx === null ? width / 2 : cx;
  const oy = cy === null ? height / 2 : cy;

  const { x, y, vx, vy, count: n } = world;
  const edgeScale = Math.min(width, height) / 3.6;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - ox;
    const dy = y[i] - oy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-3) continue;

    const edge = Math.min(x[i], y[i], width - x[i], height - y[i]) / edgeScale;
    const falloff = edge < 1 ? edge : 1;

    const acc = CONFIG.introAccel * envelope * falloff * dt;
    vx[i] += (dx / d) * acc;
    vy[i] += (dy / d) * acc;
  }

  return world;
}

function wrapAxis(v, size) {
  if (!(size > 0)) return 0;
  let m = v % size;
  if (m < 0) m += size;
  return m === 0 ? 0 : m;
}

export function reflowParticles(world, oldW, oldH, newW, newH) {
  const n = world.count;
  const sx = oldW > 0 ? newW / oldW : 1;
  const sy = oldH > 0 ? newH / oldH : 1;

  for (let i = 0; i < n; i++) {
    world.x[i] = wrapAxis(world.x[i] * sx, newW);
    world.y[i] = wrapAxis(world.y[i] * sy, newH);
  }
  return world;
}

const FIELD_PARAMS = {
  strength: 0, radius: 0, softening: 0,
  swirl: 0, shellRadius: 0, shellWidth: 1, fadeStart: 0, maxAcceleration: 0,
};

function syncFieldParams(params, strength) {
  FIELD_PARAMS.strength = strength;
  FIELD_PARAMS.radius = params.radius;
  FIELD_PARAMS.softening = params.softening;
  FIELD_PARAMS.swirl = params.swirl;
  FIELD_PARAMS.shellRadius = params.shellRadius ?? 0;
  FIELD_PARAMS.shellWidth = params.shellWidth ?? 1;
  FIELD_PARAMS.fadeStart = params.fadeStart;
  FIELD_PARAMS.maxAcceleration = params.maxAcceleration;
  return FIELD_PARAMS;
}

export function stepWorld(world, params, grid, dt, width, height, gravity = null) {
  const { x, y, vx, vy, r, count: n } = world;
  const tmp = stepWorld._tmp || (stepWorld._tmp = [0, 0]);

  const gActive = gravity && gravity.active !== false;

  const gStrength = gActive && Number.isFinite(gravity.strength)
    ? gravity.strength
    : params.strength;

  const field = gStrength === params.strength ? params : syncFieldParams(params, gStrength);

  for (let i = 0; i < n; i++) {
    let ax = 0;
    let ay = 0;

    if (gActive) {
      gravityField(gravity.x - x[i], gravity.y - y[i], field, tmp);
      ax = tmp[0];
      ay = tmp[1];
    }

    let nvx = safe(vx[i] + ax * dt);
    let nvy = safe(vy[i] + ay * dt);

    nvx *= params.damping;
    nvy *= params.damping;

    applySpeedFloor(nvx, nvy, params.speedFloor, tmp);
    nvx = tmp[0];
    nvy = tmp[1];

    clampSpeed(nvx, nvy, params.maxSpeed, tmp);
    nvx = tmp[0];
    nvy = tmp[1];

    wrapPosition(
      safe(x[i] + nvx * dt),
      safe(y[i] + nvy * dt),
      width, height, tmp
    );

    x[i] = tmp[0];
    y[i] = tmp[1];
    vx[i] = nvx;
    vy[i] = nvy;
  }

  const CP = stepWorld._cp || (stepWorld._cp = {});
  CP.restitution = params.restitution;
  CP.damping = params.corrDamping;
  CP.correction = params.correction;

  grid.build(x, y, n);
  grid.forEachPair((i, j) => resolveCollision(world, i, j, CP));

  const max2 = params.maxSpeed * params.maxSpeed;
  for (let i = 0; i < n; i++) {
    if (vx[i] * vx[i] + vy[i] * vy[i] > max2) {
      clampSpeed(vx[i], vy[i], params.maxSpeed, tmp);
      vx[i] = tmp[0];
      vy[i] = tmp[1];
    }
  }

  return world;
}

export function particleStats(world, maxSpeed = CONFIG.maxSpeed) {
  const { vx, vy, x, y, count: n } = world;
  let sum = 0;
  let max = 0;
  let nan = 0;

  for (let i = 0; i < n; i++) {
    const vxi = vx[i];
    const vyi = vy[i];
    if (!Number.isFinite(vxi) || !Number.isFinite(vyi) ||
        !Number.isFinite(x[i]) || !Number.isFinite(y[i])) {
      nan++;
      continue;
    }
    const s = Math.hypot(vxi, vyi);
    sum += s;
    if (s > max) max = s;
  }

  return {
    count: n,
    nan,
    avgSpeed: n > 0 ? sum / n : 0,
    maxSpeed: max,
    ratio: maxSpeed > 0 ? max / maxSpeed : 0,
  };
}

export function createWorld(count = CONFIG.count, width = CONFIG.width, height = CONFIG.height) {
  return {
    particles: createParticles(Math.max(count, CONFIG.count)),
    params: makeParams(),
    grid: new SpatialGrid(width, height, cellSizeFor(CONFIG.maxRadius)),
  };
}