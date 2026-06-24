// textures.ts — procedural realistic Level 0 textures via <canvas>
// No network requests, instant generation.
// Targets the canonical "Level 0" photo: damp mono-yellow wallpaper,
// moist yellowed carpet, drop-ceiling tiles, fluorescent panel lights.

export interface LevelTextures {
  wallpaper: HTMLCanvasElement;
  carpet: HTMLCanvasElement;
  ceiling: HTMLCanvasElement;
  lightPanel: HTMLCanvasElement;
  baseboard: HTMLCanvasElement;
}

// Tiny seeded RNG (mulberry32) so textures are stable per session.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Add per-pixel noise around a base color
function noisyFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: [number, number, number],
  variance: number,
  rand: () => number
) {
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * variance;
    img.data[i * 4 + 0] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Yellow wallpaper: mono-yellow #C8B566 base with subtle vertical stripe,
// damp stains, and fine grain noise.
function makeWallpaper(seed: number): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(seed);

  // Base fill: mono-yellow with vertical fiber variation
  noisyFill(ctx, W, H, [200, 181, 102], 18, rand);

  // Vertical wallpaper stripe (slightly darker)
  ctx.globalCompositeOperation = 'multiply';
  for (let x = 0; x < W; x += 32) {
    ctx.fillStyle = 'rgba(180, 160, 80, 0.35)';
    ctx.fillRect(x, 0, 8, H);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Damp stains (radial gradients, brownish)
  for (let i = 0; i < 5; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 30 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(90, 70, 30, 0.35)');
    g.addColorStop(0.7, 'rgba(110, 85, 40, 0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Hairline cracks (random short dark lines)
  ctx.strokeStyle = 'rgba(40, 30, 10, 0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    let x = rand() * W;
    let y = rand() * H;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rand() - 0.5) * 40;
      y += (rand() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return c;
}

// Moist yellowed carpet: mottled mustard with darker speckles
function makeCarpet(seed: number): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(seed + 1);

  // Base: dark mustard
  noisyFill(ctx, W, H, [105, 88, 38], 28, rand);

  // Mottle: large soft dark blobs
  for (let i = 0; i < 14; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 20 + rand() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60, 45, 15, 0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Fine fiber speckle (random dark dots)
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i += 1) {
    if (rand() < 0.18) {
      const n = -40 + rand() * 20;
      img.data[i * 4 + 0] = Math.max(0, img.data[i * 4 + 0] + n);
      img.data[i * 4 + 1] = Math.max(0, img.data[i * 4 + 1] + n);
      img.data[i * 4 + 2] = Math.max(0, img.data[i * 4 + 2] + n);
    }
  }
  ctx.putImageData(img, 0, 0);

  return c;
}

// Drop-ceiling tile: pale yellowish with dotted acoustic texture and grid seam
function makeCeiling(seed: number): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(seed + 2);

  // Base: yellowed off-white
  noisyFill(ctx, W, H, [195, 178, 110], 12, rand);

  // Acoustic dots (small punctures, rendered as darker dots)
  ctx.fillStyle = 'rgba(120, 100, 50, 0.55)';
  for (let i = 0; i < 600; i++) {
    const x = rand() * W;
    const y = rand() * H;
    ctx.fillRect(x | 0, y | 0, 1, 1);
  }

  // Tile seam (cross in the middle)
  ctx.strokeStyle = 'rgba(80, 65, 25, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  return c;
}

// Fluorescent light panel: bright emissive white with slight yellow tint
function makeLightPanel(): HTMLCanvasElement {
  const W = 128;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // Soft gradient (brighter center)
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 1.5);
  g.addColorStop(0, 'rgb(255, 252, 230)');
  g.addColorStop(0.7, 'rgb(245, 240, 200)');
  g.addColorStop(1, 'rgb(220, 210, 160)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Long fluorescent tubes (two horizontal bright streaks)
  ctx.fillStyle = 'rgba(255, 255, 240, 0.85)';
  ctx.fillRect(8, H * 0.3 - 3, W - 16, 6);
  ctx.fillRect(8, H * 0.7 - 3, W - 16, 6);

  return c;
}

// Baseboard: dark stained wood trim
function makeBaseboard(): HTMLCanvasElement {
  const W = 128;
  const H = 32;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(99);

  noisyFill(ctx, W, H, [60, 40, 20], 18, rand);

  // Wood grain lines
  ctx.strokeStyle = 'rgba(30, 18, 8, 0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = rand() * H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < W; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.1) * 1.5);
    }
    ctx.stroke();
  }

  return c;
}

export function generateLevelTextures(seed: number): LevelTextures {
  return {
    wallpaper: makeWallpaper(seed),
    carpet: makeCarpet(seed),
    ceiling: makeCeiling(seed),
    lightPanel: makeLightPanel(),
    baseboard: makeBaseboard(),
  };
}
