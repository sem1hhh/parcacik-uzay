import { CONFIG } from './config.js';

export function safe(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

const EPS_DIR = 1e-6;

export function unitVector(dx, dy, out = [0, 0]) {
  const d2 = dx * dx + dy * dy;
  if (d2 < EPS_DIR) {
    out[0] = 1;
    out[1] = 0;
    return out;
  }
  const inv = 1 / Math.sqrt(d2);
  out[0] = dx * inv;
  out[1] = dy * inv;
  return out;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function gravityField(dx, dy, p, out = [0, 0]) {
  if (!(p.strength > 0) || !(p.radius > 0)) {
    out[0] = 0;
    out[1] = 0;
    return false;
  }

  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2);

  if (d > p.radius) {
    out[0] = 0;
    out[1] = 0;
    return false;
  }

  const t = d / p.radius;
  const fade =
    t <= p.fadeStart ? 1 : 1 - smoothstep((t - p.fadeStart) / (1 - p.fadeStart));

  if (fade <= 0) {
    out[0] = 0;
    out[1] = 0;
    return false;
  }

  const denom = d2 + p.softening * p.softening;
  let mag = (p.strength * fade) / denom;

  if (mag > p.maxAcceleration) mag = p.maxAcceleration;
  else if (mag < -p.maxAcceleration) mag = -p.maxAcceleration;

  if (p.shellRadius > 0) {
    const t = (d - p.shellRadius) / p.shellWidth;
    const f = t <= -1 ? -1 : t >= 1 ? 1 : (2 * smoothstep((t + 1) / 2) - 1);
    mag *= f;
  }

  const inv = d > EPS_DIR ? 1 / d : 0;

  let ax = -dx * inv * mag;
  let ay = -dy * inv * mag;

  if (p.swirl !== 0) {
    const s = p.swirl * mag;
    ax += -dy * inv * s;
    ay += dx * inv * s;
  }

  out[0] = ax;
  out[1] = ay;
  return true;
}

export function integrate(x, y, vx, vy, dt, out) {
  out[0] = safe(x + vx * dt);
  out[1] = safe(y + vy * dt);
  return out;
}

export function clampSpeed(vx, vy, maxSpeed, out = [0, 0]) {
  let nvx = safe(vx);
  let nvy = safe(vy);
  const s2 = nvx * nvx + nvy * nvy;

  if (s2 > maxSpeed * maxSpeed) {
    const inv = maxSpeed / Math.sqrt(s2);
    nvx *= inv;
    nvy *= inv;
  }

  out[0] = nvx;
  out[1] = nvy;
  return out;
}

export function applyDamping(vx, vy, damping, out = [0, 0]) {
  out[0] = safe(vx) * damping;
  out[1] = safe(vy) * damping;
  return out;
}

export function wrapPosition(x, y, width, height, out = [0, 0]) {
  const wrap = (v, size) => {
    const n = safe(v);
    if (!(size > 0)) return 0;
    let m = n % size;
    if (m < 0) m += size;
    return m === 0 ? 0 : m;
  };

  out[0] = wrap(x, width);
  out[1] = wrap(y, height);
  return out;
}

export function nearEdge(x, y, width, height, margin = 40) {
  return x < margin || y < margin || x > width - margin || y > height - margin;
}

export function applySpeedFloor(vx, vy, floor, out = [0, 0]) {
  let nvx = safe(vx);
  let nvy = safe(vy);
  const s2 = nvx * nvx + nvy * nvy;

  if (s2 > 0 && s2 < floor * floor) {
    const inv = floor / Math.sqrt(s2);
    out[0] = nvx * inv;
    out[1] = nvy * inv;
    return out;
  }

  if (s2 === 0) {
    out[0] = floor;
    out[1] = 0;
    return out;
  }

  out[0] = nvx;
  out[1] = nvy;
  return out;
}

export function massOf(r) {
  const rr = safe(r, 1);
  return rr * rr;
}

export function resolveCollision(world, i, j, p) {
  const { x, y, vx, vy, r } = world;

  const dx = x[j] - x[i];
  const dy = y[j] - y[i];
  const d2 = dx * dx + dy * dy;

  const rSum = r[i] + r[j];
  if (d2 >= rSum * rSum || d2 < EPS_DIR) return false;

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;

  const overlap = rSum - d;

  const mi = massOf(r[i]);
  const mj = massOf(r[j]);
  const mSum = mi + mj;
  if (mSum <= 0) return false;

  const corr = (overlap * p.correction) / mSum;
  x[i] -= nx * corr * mi;
  y[i] -= ny * corr * mi;
  x[j] += nx * corr * mj;
  y[j] += ny * corr * mj;

  const rvx = vx[j] - vx[i];
  const rvy = vy[j] - vy[i];
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal > 0) return true;

  const jImpulse = (-(1 + p.restitution) * velAlongNormal) / (1 / mi + 1 / mj);
  const ix = jImpulse * nx;
  const iy = jImpulse * ny;

  vx[i] -= ix / mi;
  vy[i] -= iy / mi;
  vx[j] += ix / mj;
  vy[j] += iy / mj;

  vx[i] *= p.damping;
  vy[i] *= p.damping;
  vx[j] *= p.damping;
  vy[j] *= p.damping;

  return true;
}

export function shockImpulse(dx, dy, waveRadius, p, out = [0, 0]) {
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2);

  if (d > waveRadius + p.radius) {
    out[0] = 0;
    out[1] = 0;
    return 0;
  }

  const inv = d > EPS_DIR ? 1 / d : 0;
  if (inv === 0) {
    out[0] = p.strength;
    out[1] = 0;
    return p.strength;
  }

  const band = clamp((d - waveRadius) / p.radius, -1, 1);
  const profile = 1 - band * band;

  const mag = p.strength * profile;

  out[0] = dx * inv * mag;
  out[1] = dy * inv * mag;
  return mag;
}

export function makeParams(overrides = {}) {
  return {
    strength: CONFIG.gravityStrength,
    radius: CONFIG.gravityRadius,
    softening: CONFIG.gravitySoftening,
    swirl: CONFIG.gravitySwirl,
    shellRadius: 0,
    shellWidth: CONFIG.shellWidth,
    fadeStart: CONFIG.gravityFadeStart,
    maxAcceleration: CONFIG.maxAcceleration,
    damping: CONFIG.friction,
    maxSpeed: CONFIG.maxSpeed,
    speedFloor: CONFIG.speedFloor,
    shockStrength: CONFIG.shockStrength,
    shockRadius: CONFIG.shockRadius,
    restitution: CONFIG.restitution,
    corrDamping: CONFIG.collisionDamping,
    correction: CONFIG.positionCorrection,
    ...overrides,
  };
}