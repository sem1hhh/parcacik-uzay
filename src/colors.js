import { CONFIG } from './config.js';

const RAMP = [
  { at: 0.00, r: 18,  g: 38,  b: 110 },
  { at: 0.22, r: 34,  g: 120, b: 205 },
  { at: 0.42, r: 92,  g: 200, b: 235 },
  { at: 0.58, r: 226, g: 240, b: 240 },
  { at: 0.74, r: 245, g: 188, b: 82  },
  { at: 0.88, r: 236, g: 108, b: 48  },
  { at: 1.00, r: 208, g: 42,  b: 38  },
];

export function sampleRamp(t, out = [0, 0, 0]) {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;

  let i = 0;
  while (i < RAMP.length - 2 && p > RAMP[i + 1].at) i++;

  const a = RAMP[i];
  const b = RAMP[i + 1];
  const span = b.at - a.at;
  const f = span > 0 ? (p - a.at) / span : 0;

  out[0] = Math.round(a.r + (b.r - a.r) * f);
  out[1] = Math.round(a.g + (b.g - a.g) * f);
  out[2] = Math.round(a.b + (b.b - a.b) * f);
  return out;
}

export function rampColorString(t) {
  const c = sampleRamp(t, [0, 0, 0]);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function buildLUT(bucketCount = CONFIG.colorBuckets) {
  const lut = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    lut[i] = rampColorString(i / (bucketCount - 1));
  }
  return lut;
}

export function bucketFor(speed, maxSpeed, bucketCount = CONFIG.colorBuckets) {
  if (Number.isNaN(speed)) return 0;
  if (speed >= maxSpeed) return bucketCount - 1;
  if (speed <= 0) return 0;
  const i = Math.floor((speed / maxSpeed) * bucketCount);
  return i >= bucketCount ? bucketCount - 1 : i;
}

let _buf = null;

function ensureBuffers(n, bucketCount) {
  if (!_buf || _buf.n < n || _buf.buckets !== bucketCount) {
    _buf = {
      n: Math.max(n, 1024),
      buckets: bucketCount,
      kovaOf: new Int32Array(Math.max(n, 1024)),
      order: new Int32Array(Math.max(n, 1024)),
      bucketStart: new Int32Array(bucketCount + 1),
      cursor: new Int32Array(bucketCount + 1),
    };
  }
  return _buf;
}

export function assignBuckets(vx, vy, n, maxSpeed, bucketCount = CONFIG.colorBuckets) {
  const { kovaOf, order, bucketStart, cursor } = ensureBuffers(n, bucketCount);

  bucketStart.fill(0);

  for (let i = 0; i < n; i++) {
    const b = bucketFor(Math.hypot(vx[i], vy[i]), maxSpeed, bucketCount);
    kovaOf[i] = b;
    bucketStart[b + 1]++;
  }

  for (let b = 0; b < bucketCount; b++) bucketStart[b + 1] += bucketStart[b];

  for (let b = 0; b <= bucketCount; b++) cursor[b] = bucketStart[b];
  for (let i = 0; i < n; i++) order[cursor[kovaOf[i]]++] = i;

  return { kovaOf, order, bucketStart };
}

export function resetBucketBuffers() {
  _buf = null;
}