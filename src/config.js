export const CONFIG = {
  width: 1280,
  height: 720,
  background: '#14120f',

  count: 2400,
  minRadius: 0.6,
  maxRadius: 2.2,

  fixedDt: 1 / 120,
  maxFrameTime: 0.25,
  maxSubSteps: 8,

  friction: 0.999,
  maxSpeed: 900,

  speedFloor: 40,
  maxAcceleration: 2500,

  gravityStrength: 4500000,
  gravityRadius: 420,
  gravitySoftening: 40,
  gravitySwirl: 1.0,
  gravityFadeStart: 0.55,

  velocityBoost: 3.5,
  boostReference: 2000,
  boostPower: 1.0,
  pointerSmoothing: 0.35,

  shellRadius: 300,
  shellWidth: 110,

  shockStrength: 1500,
  shockRadius: 190,
  shockSpeed: 1400,
  shockMaxRadius: 900,
  shockCooldown: 0.09,

  dragStrength: 3.2,

  restitution: 0.7,
  collisionDamping: 0.95,
  positionCorrection: 0.5,

  colorBuckets: 64,
  trailFade: 0.18,
  trailsEnabled: true,
  glow: true,
  bloomAlpha: 0.35,

  audioBaseFreq: 120,
  audioSweepTo: 38,
  audioDuration: 0.28,
  audioGain: 0.32,

  reducedMotionTrails: false,
  reducedMotionIntro: 0.5,

  introDuration: 1.8,
  introFillTime: 0.7,
  introAccel: 900,
  introTrailFade: 0.45,
  introSpread: 0.7,
  introCoreRadius: 40,
  get introBurst() {
    return 640 / this.introFillTime;
  },
};

export const RANGES = {
  count: { min: 500, max: 4000, step: 100, default: CONFIG.count },
  gravityStrength: { min: 0, max: 12000000, step: 50000, default: CONFIG.gravityStrength },
  velocityBoost: { min: 1, max: 6, step: 0.1, default: CONFIG.velocityBoost },
  friction: { min: 0.99, max: 0.9999, step: 0.0001, default: CONFIG.friction },
  speedFloor: { min: 0, max: 80, step: 2, default: CONFIG.speedFloor },
  trailFade: { min: 0, max: 0.6, step: 0.02, default: CONFIG.trailFade },
};

export const MODES = ['attract', 'repel', 'mixed'];

export const MODE_LABELS = {
  attract: 'ÇEK (yerçekimi)',
  repel: 'İT (şok dalgası)',
  mixed: 'KARİŞIK',
};