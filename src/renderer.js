import { CONFIG } from './config.js';
import { buildLUT, assignBuckets } from './colors.js';

export function createRenderer(canvas, background = CONFIG.background) {
  const ctx = canvas.getContext('2d', { alpha: false });

  const state = {
    canvas,
    ctx,
    background,
    dpr: 1,
    width: 0,
    height: 0,

    trail: null,
    trailCtx: null,

    lut: buildLUT(CONFIG.colorBuckets),

    trailsEnabled: CONFIG.trailsEnabled,
    trailFade: CONFIG.trailFade,
    glow: CONFIG.glow,
    glowAlpha: CONFIG.bloomAlpha,

    frames: 0,
    lastBucketFills: 0,
  };

  return state;
}

export function resizeRenderer(r, cssWidth, cssHeight, dpr) {
  r.dpr = dpr;
  r.width = cssWidth;
  r.height = cssHeight;

  r.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  r.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  r.canvas.style.width = cssWidth + 'px';
  r.canvas.style.height = cssHeight + 'px';

  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!r.trail) {
    r.trail = document.createElement('canvas');
    r.trailCtx = r.trail.getContext('2d', { alpha: false });
  }
  r.trail.width = r.canvas.width;
  r.trail.height = r.canvas.height;
  r.trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  r.trailCtx.globalCompositeOperation = 'source-over';
  r.trailCtx.fillStyle = r.background;
  r.trailCtx.fillRect(0, 0, cssWidth, cssHeight);

  return r;
}

export function render(r, world, maxSpeed = CONFIG.maxSpeed) {
  const { width, height } = r;
  const useTrails = r.trailsEnabled && r.trailCtx;

  const g = useTrails ? r.trailCtx : r.ctx;

  if (useTrails) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = r.background;
    g.globalAlpha = r.trailFade;
    g.fillRect(0, 0, width, height);
    g.globalAlpha = 1;
  } else {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = r.background;
    g.fillRect(0, 0, width, height);
  }

  const { order, bucketStart } = assignBuckets(
    world.vx, world.vy, world.count, maxSpeed, r.lut.length
  );

  g.globalCompositeOperation = 'lighter';

  const { x, y, r: radii, count: n } = world;
  let fills = 0;

  for (let b = 0; b < r.lut.length; b++) {
    const start = bucketStart[b];
    const end = bucketStart[b + 1];
    if (start === end) continue;

    g.beginPath();
    for (let k = start; k < end; k++) {
      const i = order[k];
      const rad = radii[i];
      g.moveTo(x[i] + rad, y[i]);
      g.arc(x[i], y[i], rad, 0, Math.PI * 2);
    }
    g.fillStyle = r.lut[b];
    g.fill();
    fills++;
  }

  g.globalCompositeOperation = 'source-over';
  r.lastBucketFills = fills;
  r.frames++;

  if (useTrails) {
    r.ctx.globalCompositeOperation = 'source-over';
    r.ctx.drawImage(r.trail, 0, 0, width, height);

    if (r.glow && r.glowAlpha > 0) {
      r.ctx.globalCompositeOperation = 'lighter';
      r.ctx.globalAlpha = r.glowAlpha;
      r.ctx.drawImage(r.trail, 0, 0, width, height);
      r.ctx.globalAlpha = 1;
      r.ctx.globalCompositeOperation = 'source-over';
    }
  }

  void n;
  return r;
}

export function clearTrails(r) {
  if (!r.trailCtx) return;
  r.trailCtx.globalCompositeOperation = 'source-over';
  r.trailCtx.fillStyle = r.background;
  r.trailCtx.fillRect(0, 0, r.width, r.height);
}

export function renderStats(r) {
  return {
    frames: r.frames,
    bucketFills: r.lastBucketFills,
    lutSize: r.lut.length,
    trailsEnabled: r.trailsEnabled,
  };
}