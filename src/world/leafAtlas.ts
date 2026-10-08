/**
 * Procedural foliage atlas (RGBA, 1024x512, 4x2 cells of 256 px), drawn once with Canvas2D and then
 * converted to a DataTexture with colour bleeding into transparent texels (no dark halos when mip-mapped).
 *
 *   cells: 0 oak sprig, 1 beech sprig, 2 pine spray, 3 birch sprig, 4 dark oak sprig (Mirkwood),
 *          5 fern frond, 6 ivy / vine sprig, 7 dead leaves
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';

export const LEAF_CELLS = { oak: 0, beech: 1, pine: 2, birch: 3, mirk: 4, fern: 5, ivy: 6, dead: 7 } as const;
export type LeafCell = keyof typeof LEAF_CELLS;

const CELL = 256;
const COLS = 4;
const ROWS = 2;
let atlas: THREE.DataTexture | null = null;

/** uv rect of a cell [u0, v0, u1, v1] with a half-texel inset. v is flipped (image row 0 = top) */
export function cellRect(cell: number): [number, number, number, number] {
  const cx = cell % COLS;
  const cy = Math.floor(cell / COLS);
  const e = 0.5 / 1024;
  const u0 = (cx * CELL) / (COLS * CELL) + e;
  const u1 = ((cx + 1) * CELL) / (COLS * CELL) - e;
  // DataTexture flipY=false: row 0 of data is v = 0. We draw the canvas top-down, so row index = cy.
  const v0 = (cy * CELL) / (ROWS * CELL) + e;
  const v1 = ((cy + 1) * CELL) / (ROWS * CELL) - e;
  return [u0, v0, u1, v1];
}

type Ctx = CanvasRenderingContext2D;

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;
}

interface LeafStyle {
  hue: number;
  sat: number;
  lit: number;
  hueVar: number;
  litVar: number;
}

/** leaf outline: envelope(t) gives half-width, lobes modulate it, serration adds teeth */
function leafPath(ctx: Ctx, len: number, wid: number, env: (t: number) => number, lobes: number, lobeAmp: number, teeth: number): void {
  const n = 28;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    let w = wid * env(t);
    if (lobes > 0) w *= 1 - lobeAmp + lobeAmp * Math.abs(Math.cos(t * lobes * Math.PI));
    if (teeth > 0) w *= 1 + 0.07 * Math.sin(t * teeth * Math.PI * 2);
    ctx.lineTo(t * len, -w);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    let w = wid * env(t);
    if (lobes > 0) w *= 1 - lobeAmp + lobeAmp * Math.abs(Math.cos(t * lobes * Math.PI + 0.4));
    if (teeth > 0) w *= 1 + 0.07 * Math.sin(t * teeth * Math.PI * 2 + 1.3);
    ctx.lineTo(t * len, w);
  }
  ctx.closePath();
}

const envOval = (t: number) => Math.sin(Math.pow(t, 0.75) * Math.PI) * (1 - t * 0.25);
const envPointy = (t: number) => Math.sin(Math.pow(t, 0.65) * Math.PI) * (1 - t * 0.5);
const envBirch = (t: number) => Math.sin(Math.pow(t, 0.55) * Math.PI) * (1 - t * 0.2);

function drawLeaf(
  ctx: Ctx, rng: Rng, x: number, y: number, ang: number, len: number, wid: number, st: LeafStyle,
  env: (t: number) => number, lobes: number, lobeAmp: number, teeth: number, veins: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const h = st.hue + (rng.float() - 0.5) * st.hueVar;
  const l = st.lit + (rng.float() - 0.5) * st.litVar;
  const g = ctx.createLinearGradient(0, -wid, 0, wid);
  g.addColorStop(0, hsl(h, st.sat, l * 1.12));
  g.addColorStop(0.5, hsl(h, st.sat, l));
  g.addColorStop(1, hsl(h + 4, st.sat * 1.05, l * 0.78));
  leafPath(ctx, len, wid, env, lobes, lobeAmp, teeth);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hsl(h, st.sat, l * 0.55, 0.65);
  ctx.stroke();
  // midrib + veins
  ctx.strokeStyle = hsl(h - 4, st.sat * 0.8, Math.min(0.8, l * 1.35), 0.8);
  ctx.lineWidth = Math.max(1, len * 0.025);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.93, 0);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = hsl(h, st.sat * 0.9, l * 1.2, 0.45);
  for (let i = 1; i <= veins; i++) {
    const t = i / (veins + 1);
    const w = wid * env(t) * 0.8;
    ctx.beginPath();
    ctx.moveTo(t * len, 0);
    ctx.lineTo(t * len + len * 0.12, -w);
    ctx.moveTo(t * len, 0);
    ctx.lineTo(t * len + len * 0.12, w);
    ctx.stroke();
  }
  ctx.restore();
}

function twig(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + 6, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
}

/** generic broadleaf sprig growing up from the bottom centre of the cell */
function sprig(
  ctx: Ctx, rng: Rng, ox: number, oy: number, st: LeafStyle,
  o: { n: number; len: number; wid: number; env: (t: number) => number; lobes: number; lobeAmp: number; teeth: number; veins: number; spread: number; twig: string },
): void {
  const cx = ox + CELL / 2;
  const baseY = oy + CELL - 8;
  const topY = oy + 20;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  twig(ctx, cx, baseY, cx + (rng.float() - 0.5) * 18, topY + 30, 3.2, o.twig);
  for (let i = 0; i < o.n; i++) {
    const t = i / (o.n - 1);
    const y = baseY - 14 - t * (baseY - topY - 40);
    const side = i % 2 === 0 ? -1 : 1;
    const stemX = cx + (topY + 30 - y) * 0.0;
    const ang = -Math.PI / 2 + side * (o.spread * (0.65 + 0.35 * (1 - t)) + (rng.float() - 0.5) * 0.3);
    const size = 1 - t * 0.35;
    const L = o.len * size * (0.85 + rng.float() * 0.3);
    twig(ctx, stemX, y + 4, stemX + Math.cos(ang) * L * 0.14, y + 4 + Math.sin(ang) * L * 0.14, 1.6, o.twig);
    drawLeaf(ctx, rng, stemX + Math.cos(ang) * L * 0.12, y + 4 + Math.sin(ang) * L * 0.12, ang, L, o.wid * size, st, o.env, o.lobes, o.lobeAmp, o.teeth, o.veins);
  }
  // terminal leaf
  drawLeaf(ctx, rng, cx + 2, topY + 34, -Math.PI / 2 + (rng.float() - 0.5) * 0.3, o.len * 0.8, o.wid * 0.75, st, o.env, o.lobes, o.lobeAmp, o.teeth, o.veins);
  ctx.restore();
}

function pineSpray(ctx: Ctx, rng: Rng, ox: number, oy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  const cx = ox + CELL / 2;
  const baseY = oy + CELL - 6;
  const topY = oy + 12;
  twig(ctx, cx, baseY, cx + 4, topY + 20, 3.4, '#4a3426');
  const tufts = 17;
  for (let i = 0; i < tufts; i++) {
    const t = i / (tufts - 1);
    const y = baseY - 10 - t * (baseY - topY - 24);
    const spreadL = 1 - t * 0.55;
    for (const side of [-1, 1]) {
      const n = 11;
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + side * (0.55 + (k / n) * 0.9 + (rng.float() - 0.5) * 0.18);
        const L = (70 + rng.float() * 38) * spreadL;
        const x0 = cx + 2;
        const col = hsl(112 + rng.float() * 22, 0.34, 0.2 + rng.float() * 0.1);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.quadraticCurveTo(x0 + Math.cos(a) * L * 0.55, y + Math.sin(a) * L * 0.55 - 4, x0 + Math.cos(a) * L, y + Math.sin(a) * L + 6);
        ctx.stroke();
        ctx.strokeStyle = hsl(95 + rng.float() * 20, 0.38, 0.34, 0.85);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0 + Math.cos(a) * L * 0.3, y + Math.sin(a) * L * 0.3 - 1);
        ctx.quadraticCurveTo(x0 + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6 - 4, x0 + Math.cos(a) * L, y + Math.sin(a) * L + 6);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function fernFrond(ctx: Ctx, rng: Rng, ox: number, oy: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  const cx = ox + CELL / 2;
  const baseY = oy + CELL - 4;
  const topY = oy + 8;
  // rachis
  ctx.strokeStyle = hsl(95, 0.4, 0.25);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(cx, topY);
  ctx.stroke();
  const pairs = 22;
  for (let i = 0; i < pairs; i++) {
    const t = i / (pairs - 1);
    const y = baseY - 12 - t * (baseY - topY - 14);
    const L = (96 * Math.sin(Math.pow(t, 0.7) * Math.PI * 0.95 + 0.25) + 14) * (1 - t * 0.2);
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (1.1 - t * 0.35);
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(a);
      const h = 96 + rng.float() * 18;
      const l = 0.27 + rng.float() * 0.1 - t * 0.04;
      // pinna: row of small lobes
      ctx.fillStyle = hsl(h, 0.5, l);
      ctx.strokeStyle = hsl(h, 0.5, l * 0.6, 0.7);
      ctx.lineWidth = 0.7;
      const lobes = 9;
      for (let k = 0; k < lobes; k++) {
        const tt = (k + 0.5) / lobes;
        const lw = 7.5 * (1 - tt * 0.75) * Math.min(1, 0.4 + L / 90);
        const ll = (L / lobes) * 1.6;
        ctx.beginPath();
        ctx.ellipse(tt * L, 0, ll / 2, lw, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = hsl(h - 6, 0.4, l * 1.4, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(L, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function ivySprig(ctx: Ctx, rng: Rng, ox: number, oy: number): void {
  const st: LeafStyle = { hue: 100, sat: 0.42, lit: 0.22, hueVar: 24, litVar: 0.06 };
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, CELL, CELL);
  ctx.clip();
  const cx = ox + CELL / 2;
  twig(ctx, cx, oy + CELL - 6, cx - 6, oy + 10, 3, '#3a2e22');
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const y = oy + CELL - 30 - t * (CELL - 70);
    const side = i % 2 ? 1 : -1;
    const ang = -Math.PI / 2 + side * (0.9 + rng.float() * 0.3);
    // palmate leaf: three lobes
    for (const da of [-0.7, 0, 0.7]) {
      drawLeaf(ctx, rng, cx - 3, y, ang + da * 0.55, da === 0 ? 62 : 46, da === 0 ? 17 : 14, st, envPointy, 0, 0, 0, 3);
    }
  }
  ctx.restore();
}

function deadLeaves(ctx: Ctx, rng: Rng, ox: number, oy: number): void {
  const st: LeafStyle = { hue: 28, sat: 0.5, lit: 0.26, hueVar: 26, litVar: 0.09 };
  sprig(ctx, rng, ox, oy, st, { n: 8, len: 78, wid: 24, env: envOval, lobes: 3, lobeAmp: 0.18, teeth: 0, veins: 5, spread: 1.0, twig: '#3a2c20' });
}

function paint(): THREE.DataTexture {
  const W = COLS * CELL;
  const H = ROWS * CELL;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  const rng = new Rng(7331);
  const cell = (i: number): [number, number] => [(i % COLS) * CELL, Math.floor(i / COLS) * CELL];
  // 0 oak: lobed leaves
  {
    const [ox, oy] = cell(0);
    sprig(ctx, rng, ox, oy, { hue: 92, sat: 0.46, lit: 0.27, hueVar: 22, litVar: 0.07 }, { n: 14, len: 60, wid: 20, env: envOval, lobes: 3.5, lobeAmp: 0.22, teeth: 0, veins: 5, spread: 1.0, twig: '#3f3022' });
  }
  // 1 beech: oval, parallel veins, fine teeth
  {
    const [ox, oy] = cell(1);
    sprig(ctx, rng, ox, oy, { hue: 84, sat: 0.5, lit: 0.34, hueVar: 20, litVar: 0.08 }, { n: 15, len: 54, wid: 18, env: envPointy, lobes: 0, lobeAmp: 0, teeth: 9, veins: 7, spread: 1.05, twig: '#4a3a2c' });
  }
  { const [ox, oy] = cell(2); pineSpray(ctx, rng, ox, oy); }
  // 3 birch: small triangular, serrated
  {
    const [ox, oy] = cell(3);
    sprig(ctx, rng, ox, oy, { hue: 80, sat: 0.55, lit: 0.4, hueVar: 24, litVar: 0.09 }, { n: 18, len: 42, wid: 16, env: envBirch, lobes: 0, lobeAmp: 0, teeth: 7, veins: 5, spread: 1.1, twig: '#5a4a3a' });
  }
  // 4 dark oak
  {
    const [ox, oy] = cell(4);
    sprig(ctx, rng, ox, oy, { hue: 112, sat: 0.34, lit: 0.15, hueVar: 26, litVar: 0.05 }, { n: 14, len: 64, wid: 21, env: envOval, lobes: 3.5, lobeAmp: 0.25, teeth: 0, veins: 5, spread: 1.0, twig: '#241a12' });
  }
  { const [ox, oy] = cell(5); fernFrond(ctx, rng, ox, oy); }
  { const [ox, oy] = cell(6); ivySprig(ctx, rng, ox, oy); }
  { const [ox, oy] = cell(7); deadLeaves(ctx, rng, ox, oy); }

  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  // per-cell mean colour of opaque texels, bled into transparent ones
  const out = new Uint8Array(W * H * 4);
  for (let c = 0; c < COLS * ROWS; c++) {
    const ox = (c % COLS) * CELL;
    const oy = Math.floor(c / COLS) * CELL;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const i = ((oy + y) * W + ox + x) * 4;
        if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      }
    }
    if (n === 0) n = 1;
    r /= n; g /= n; b /= n;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const i = ((oy + y) * W + ox + x) * 4;
        const a = d[i + 3];
        if (a >= 250) { out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2]; }
        else if (a <= 4) { out[i] = r; out[i + 1] = g; out[i + 2] = b; }
        else {
          // un-premultiplied by getImageData already; mix toward mean for thin edges
          const k = a / 255;
          out[i] = d[i] * k + r * (1 - k);
          out[i + 1] = d[i + 1] * k + g * (1 - k);
          out[i + 2] = d[i + 2] * k + b * (1 - k);
        }
        out[i + 3] = a;
      }
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  tex.name = 'leaf_atlas';
  return tex;
}

export function getLeafAtlas(): THREE.DataTexture {
  atlas ??= paint();
  return atlas;
}
