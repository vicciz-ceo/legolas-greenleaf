/**
 * Tileable (periodic) noise for procedural textures.
 * All functions take coordinates in "tile space" u,v in [0,1) and integer lattice periods, so the
 * result wraps seamlessly. Fast, allocation-free hot paths (results are written to module scratch).
 */
import { mulberry32 } from '../core/rng';

const COS = new Float32Array(256);
const SIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  COS[i] = Math.cos((i / 256) * Math.PI * 2);
  SIN[i] = Math.sin((i / 256) * Math.PI * 2);
}

export class TileNoise {
  private perm = new Uint8Array(512);
  /** scratch results of the last worley() call */
  f1 = 0;
  f2 = 0;
  /** hash id [0,1) of the nearest cell's feature point */
  id = 0;
  /** cell-relative coordinates of the nearest feature point's offset from the sample (in cell units) */
  dx = 0;
  dy = 0;
  /** integer cell coordinates of the nearest cell */
  cx = 0;
  cy = 0;

  constructor(seed: number) {
    const r = mulberry32(seed * 7919 + 13);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** gradient noise, periodic in px,py lattice cells. x,y are lattice units. Range ~[-1,1]. */
  g(x: number, y: number, px: number, py: number, so = 0): number {
    const perm = this.perm;
    if (x < 0 || x >= px) x -= Math.floor(x / px) * px;
    if (y < 0 || y >= py) y -= Math.floor(y / py) * py;
    const ix = x | 0;
    const iy = y | 0;
    const fx = x - ix;
    const fy = y - iy;
    const x0 = ix % px;
    const y0 = iy % py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1;
    const y1 = y0 + 1 === py ? 0 : y0 + 1;
    const a0 = perm[(x0 + so) & 255];
    const a1 = perm[(x1 + so) & 255];
    const sy = so * 3;
    const yy0 = (y0 + sy) & 255;
    const yy1 = (y1 + sy) & 255;
    const h00 = perm[a0 + yy0];
    const h10 = perm[a1 + yy0];
    const h01 = perm[a0 + yy1];
    const h11 = perm[a1 + yy1];
    const n00 = COS[h00] * fx + SIN[h00] * fy;
    const n10 = COS[h10] * (fx - 1) + SIN[h10] * fy;
    const n01 = COS[h01] * fx + SIN[h01] * (fy - 1);
    const n11 = COS[h11] * (fx - 1) + SIN[h11] * (fy - 1);
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sfy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = n00 + sx * (n10 - n00);
    const b = n01 + sx * (n11 - n01);
    return (a + sfy * (b - a)) * 1.41;
  }

  /** fbm over tile coords u,v in [0,1). px,py = base periods. returns ~[-1,1] */
  fbm(u: number, v: number, px: number, py: number, oct = 4, gain = 0.5): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    let fx = px;
    let fy = py;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.g(u * fx, v * fy, fx, fy, i * 41 + 7);
      norm += amp;
      amp *= gain;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  }

  /** ridged fbm, returns ~[0,1] (1 at ridges) */
  ridged(u: number, v: number, px: number, py: number, oct = 4, gain = 0.5): number {
    let amp = 1;
    let sum = 0;
    let norm = 0;
    let fx = px;
    let fy = py;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(this.g(u * fx, v * fy, fx, fy, i * 29 + 3));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      fx *= 2;
      fy *= 2;
    }
    return sum / norm;
  }

  private hash2(x: number, y: number, k: number): number {
    const perm = this.perm;
    return perm[(perm[(x + k * 37) & 255] + y + k * 91) & 255] / 255;
  }

  /**
   * Tileable cellular noise (Worley). u,v in [0,1), px,py cell counts. jitter 0..1.
   * Sets this.f1,f2 (distances in cell units), id, dx,dy, cx,cy.
   */
  worley(u: number, v: number, px: number, py: number, jitter = 1): void {
    const x = u * px;
    const y = v * py;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    let bdx = 0;
    let bdy = 0;
    let bcx = 0;
    let bcy = 0;
    const off = (1 - jitter) * 0.5;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const wx = ((cx % px) + px) % px;
        const wy = ((cy % py) + py) % py;
        const hx = this.hash2(wx, wy, 0);
        const hy = this.hash2(wx, wy, 1);
        const fx = cx + off + hx * jitter - x;
        const fy = cy + off + hy * jitter - y;
        const d = fx * fx + fy * fy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = this.hash2(wx, wy, 2);
          bdx = fx;
          bdy = fy;
          bcx = wx;
          bcy = wy;
        } else if (d < f2) f2 = d;
      }
    }
    this.f1 = Math.sqrt(f1);
    this.f2 = Math.sqrt(f2);
    this.id = id;
    this.dx = bdx;
    this.dy = bdy;
    this.cx = bcx;
    this.cy = bcy;
  }

  /** deterministic hash of an integer cell to [0,1) */
  cell(x: number, y: number, k = 0): number {
    return this.hash2(x & 255, y & 255, k);
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Low-resolution tileable scalar field with smooth (C1) bilinear lookup. Used to evaluate expensive
 * low-frequency noise at 1/4..1/2 resolution and reuse it per pixel.
 */
export class Field {
  readonly res: number;
  readonly data: Float32Array;
  constructor(res: number, fn: (u: number, v: number) => number) {
    this.res = res;
    this.data = new Float32Array(res * res);
    const inv = 1 / res;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) this.data[y * res + x] = fn((x + 0.5) * inv, (y + 0.5) * inv);
  }
  /** u,v in [0,1) (wraps) */
  at(u: number, v: number): number {
    const res = this.res;
    const x = u * res - 0.5;
    const y = v * res - 0.5;
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    let fx = x - x0;
    let fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    x0 = ((x0 % res) + res) % res;
    y0 = ((y0 % res) + res) % res;
    const x1 = x0 + 1 === res ? 0 : x0 + 1;
    const y1 = y0 + 1 === res ? 0 : y0 + 1;
    const d = this.data;
    const a = d[y0 * res + x0];
    const b = d[y0 * res + x1];
    const c = d[y1 * res + x0];
    const e = d[y1 * res + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  }
}
