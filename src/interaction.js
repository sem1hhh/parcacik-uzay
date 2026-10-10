import { CONFIG } from './config.js';
import { safe, clamp, clampSpeed, shockImpulse } from './physics.js';

const DT = CONFIG.fixedDt;

export function createInteraction(options = {}) {
  const x0 = options.x ?? CONFIG.width / 2;
  const y0 = options.y ?? CONFIG.height / 2;
  return {
    x: x0,
    y: y0,

    targetX: x0,
    targetY: y0,

    prevTargetX: x0,
    prevTargetY: y0,

    speed: 0,
    rawSpeed: 0,

    active: true,
    seen: false,
    lastFrame: 0,

    boost: 1,

    boostMax: options.boostMax ?? CONFIG.velocityBoost,
    boostReference: options.boostReference ?? CONFIG.boostReference,
    boostPower: options.boostPower ?? CONFIG.boostPower,

    smoothing: options.smoothing ?? CONFIG.pointerSmoothing,
  };
}

export function updatePointer(inter, clientX, clientY) {
  inter.targetX = Number.isFinite(clientX) ? clientX : inter.targetX;
  inter.targetY = Number.isFinite(clientY) ? clientY : inter.targetY;
  inter.seen = true;
}

function computeSpeed(inter, dt) {
  const dx = inter.targetX - inter.prevTargetX;
  const dy = inter.targetY - inter.prevTargetY;
  inter.prevTargetX = inter.targetX;
  inter.prevTargetY = inter.targetY;

  inter.rawSpeed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
  inter.speed += (inter.rawSpeed - inter.speed) * 0.25;
  return inter.speed;
}

export function boostFor(speed, boost, reference = 2000, power = 0.8) {
  const t = clamp(speed / reference, 0, 1);
  return 1 + (boost - 1) * Math.pow(t, power);
}

export function stepInteraction(inter, dt, params) {
  computeSpeed(inter, dt);

  const k = clamp(inter.smoothing * (dt / DT), 0, 1);
  inter.x += (inter.targetX - inter.x) * k;
  inter.y += (inter.targetY - inter.y) * k;

  inter.boost = boostFor(inter.speed, inter.boostMax, inter.boostReference, inter.boostPower);

  return {
    x: safe(inter.x),
    y: safe(inter.y),
    active: inter.active,
    strength: params.strength * inter.boost,
  };
}

export function setActive(inter, active) {
  inter.active = active;
}

export function snapPointer(inter, x, y) {
  inter.x = x;
  inter.y = y;
  inter.targetX = x;
  inter.targetY = y;
  inter.prevTargetX = x;
  inter.prevTargetY = y;
  inter.speed = 0;
  inter.rawSpeed = 0;
  inter.boost = 1;
}

export function createShockSystem(options = {}) {
  return {
    waves: [],
    cooldown: 0,
    cooldownTime: options.cooldown ?? CONFIG.shockCooldown,
    strength: options.strength ?? CONFIG.shockStrength,
    radius: options.radius ?? CONFIG.shockRadius,
    speed: options.speed ?? CONFIG.shockSpeed,
    maxRadius: options.maxRadius ?? CONFIG.shockMaxRadius,
    _impulse: [0, 0],
  };
}

export function spawnShock(system, x, y) {
  if (system.cooldown > 0) return false;
  system.cooldown = system.cooldownTime;
  system.waves.push({ x, y, radius: 0, age: 0 });
  return true;
}

export function stepShocks(system, dt) {
  if (system.cooldown > 0) system.cooldown -= dt;

  const keep = [];
  for (const w of system.waves) {
    w.age += dt;
    w.radius += system.speed * dt;
    if (w.radius < system.maxRadius) keep.push(w);
  }
  system.waves = keep;
}

export function applyShocks(system, world, maxSpeed = CONFIG.maxSpeed) {
  if (system.waves.length === 0) return 0;

  const { x, y, vx, vy, count: n } = world;
  const p = system._impulse;
  const sp = { strength: system.strength, radius: system.radius };
  const clamped = system._clamped || (system._clamped = [0, 0]);
  const max2 = maxSpeed * maxSpeed;
  let touched = 0;

  for (const w of system.waves) {
    for (let i = 0; i < n; i++) {
      shockImpulse(w.x - x[i], w.y - y[i], w.radius, sp, p);
      if (p[0] === 0 && p[1] === 0) continue;

      let nvx = vx[i] + p[0];
      let nvy = vy[i] + p[1];

      if (nvx * nvx + nvy * nvy > max2) {
        clampSpeed(nvx, nvy, maxSpeed, clamped);
        nvx = clamped[0];
        nvy = clamped[1];
      }

      vx[i] = nvx;
      vy[i] = nvy;
      touched++;
    }
  }
  return touched;
}

export function clearShocks(system) {
  system.waves.length = 0;
  system.cooldown = 0;
}

export function setMode(system, mode) {
  system.mode = mode;
}