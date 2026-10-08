/**
 * Procedural texture generators (tileable). Each generator fills a Surf with albedo, height,
 * roughness (and optionally AO / metalness / alpha). textures.ts turns those into DataTextures.
 *
 * All generators are resolution independent: they work in tile space (u,v in [0,1)).
 * Speed: expensive low-frequency noise is evaluated into low-resolution Fields and sampled per pixel;
 * point-like features (pebbles, pores, scales) are stamped instead of evaluated per pixel.
 */
import { Rng } from '../core/rng';
import { Field, TileNoise, clamp01, mix, sstep } from './noise';

export class Surf {
  readonly n: number;
  rgba: Uint8ClampedArray;
  h: Float32Array;
  rough: Float32Array;
  ao: Float32Array | null = null;
  metal: Float32Array | null = null;
  constructor(n: number, wantAo: boolean, wantMetal: boolean) {
    this.n = n;
    this.rgba = new Uint8ClampedArray(n * n * 4);
    this.h = new Float32Array(n * n);
    this.rough = new Float32Array(n * n);
    this.rough.fill(0.8);
    this.rgba.fill(255);
    if (wantAo) {
      this.ao = new Float32Array(n * n);
      this.ao.fill(1);
    }
    if (wantMetal) this.metal = new Float32Array(n * n);
  }
  px(i: number, r: number, g: number, b: number): void {
    const o = i * 4;
    this.rgba[o] = r;
    this.rgba[o + 1] = g;
    this.rgba[o + 2] = b;
  }
}

export interface GenSpec {
  /** normal map strength (height units per pixel at 512) */
  normal: number;
  ao?: boolean;
  metal?: boolean;
  alpha?: boolean;
  fn: (s: Surf, N: TileNoise, R: Rng) => void;
}

type C3 = readonly [number, number, number];
let cr = 0;
let cg = 0;
let cb = 0;
/** lerp two colours into scratch cr,cg,cb */
function lc(a: C3, b: C3, t: number): void {
  cr = a[0] + (b[0] - a[0]) * t;
  cg = a[1] + (b[1] - a[1]) * t;
  cb = a[2] + (b[2] - a[2]) * t;
}
function lc3(a: C3, b: C3, c: C3, t: number): void {
  if (t < 0.5) lc(a, b, t * 2);
  else lc(b, c, t * 2 - 1);
}
const wrap = (v: number, n: number) => ((v % n) + n) % n;
const fract = (v: number) => v - Math.floor(v);

// ── field helpers ──
const pow2 = (v: number) => 1 << Math.ceil(Math.log2(Math.max(2, v)));
function fres(px: number, py: number, oct: number): number {
  const f = Math.max(px, py) * Math.pow(2, oct - 1);
  return Math.min(256, Math.max(32, pow2(f * 2.5)));
}
function fbmF(N: TileNoise, px: number, py: number, oct = 4, gain = 0.5): Field {
  return new Field(fres(px, py, oct), (u, v) => N.fbm(u, v, px, py, oct, gain));
}
function ridgedF(N: TileNoise, px: number, py: number, oct = 4): Field {
  return new Field(fres(px, py, oct), (u, v) => N.ridged(u, v, px, py, oct));
}
/** worley F2-F1 field (edge distance in cell units) */
function edgeF(N: TileNoise, px: number, py: number, jitter: number, warp?: Field, warpAmt = 0, res = 256): Field {
  return new Field(res, (u, v) => {
    const w = warp ? warp.at(u, v) * warpAmt : 0;
    N.worley(u + w, v + w, px, py, jitter);
    return N.f2 - N.f1;
  });
}
/** field holding the cell id of worley at (u,v) (piecewise constant: sample nearest) */
function fillRange(s: Surf, fn: (i: number, x: number, y: number, u: number, v: number) => void): void {
  const n = s.n;
  const inv = 1 / n;
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) * inv;
    const row = y * n;
    for (let x = 0; x < n; x++) fn(row + x, x, y, (x + 0.5) * inv, v);
  }
}

/** thick line with wraparound; cb(pixelIndex, tAlong, tAcross 0 centre..1 edge) */
function stroke(
  s: Surf,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  cb: (i: number, t: number, k: number) => void,
): void {
  const n = s.n;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const steps = Math.ceil(len);
  const r = Math.max(0.6, w / 2);
  const r2 = r * r;
  const ri = Math.ceil(r);
  for (let st = 0; st <= steps; st++) {
    const t = st / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const ix = Math.round(cx);
    const iy = Math.round(cy);
    for (let j = -ri; j <= ri; j++) {
      const ey = iy + j - cy;
      for (let i = -ri; i <= ri; i++) {
        const ex = ix + i - cx;
        const d2 = ex * ex + ey * ey;
        if (d2 > r2) continue;
        cb(wrap(iy + j, n) * n + wrap(ix + i, n), t, Math.sqrt(d2) / r);
      }
    }
  }
}

const LEAF_PROF = new Float32Array(64);
for (let i = 0; i < 64; i++) LEAF_PROF[i] = Math.pow(Math.sin(Math.PI * Math.pow((i + 0.5) / 64, 0.8)), 0.75);
/** paint a leaf shape with wraparound */
function leaf(
  s: Surf,
  cxp: number,
  cyp: number,
  ang: number,
  L: number,
  W: number,
  cb: (i: number, along: number, across: number, rib: number) => void,
): void {
  const n = s.n;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const R = Math.ceil(L * 0.6) + 1;
  const ox = Math.round(cxp);
  const oy = Math.round(cyp);
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const lx = i * ca + j * sa;
      const t = lx / L + 0.5;
      if (t < 0 || t > 1) continue;
      const ly = -i * sa + j * ca;
      const prof = LEAF_PROF[(t * 63) | 0] * W;
      const a = Math.abs(ly);
      if (a > prof) continue;
      cb(wrap(oy + j, n) * n + wrap(ox + i, n), t, prof > 0 ? ly / prof : 0, 1 - clamp01(a / 1.2));
    }
  }
}

/** stamp cellular domes (jittered grid): cb(pixel, d 0..1 from centre, cellId, dome height 0..1) */
function domes(
  s: Surf,
  R: Rng,
  cells: number,
  jitter: number,
  radius: number,
  cb: (i: number, d: number, id: number, dome: number) => void,
  keep = 1,
): void {
  const n = s.n;
  const cs = n / cells;
  const rad = cs * radius;
  const ri = Math.ceil(rad);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      if (keep < 1 && R.float() > keep) {
        R.float();
        R.float();
        R.float();
        continue;
      }
      const px = (cx + 0.5 + (R.float() - 0.5) * jitter) * cs;
      const py = (cy + 0.5 + (R.float() - 0.5) * jitter) * cs;
      const id = R.float();
      const ix = Math.round(px);
      const iy = Math.round(py);
      const r2 = rad * rad;
      for (let j = -ri; j <= ri; j++) {
        const ey = iy + j - py;
        for (let i = -ri; i <= ri; i++) {
          const ex = ix + i - px;
          const d2 = (ex * ex + ey * ey) / r2;
          if (d2 >= 1) continue;
          cb(wrap(iy + j, n) * n + wrap(ix + i, n), Math.sqrt(d2), id, Math.sqrt(1 - d2));
        }
      }
    }
  }
}

function aoFromHeight(s: Surf, lo: number, k = 1.2): void {
  if (!s.ao) return;
  const h = s.h;
  const ao = s.ao;
  for (let i = 0; i < ao.length; i++) ao[i] = lo + (1 - lo) * clamp01(h[i] * k);
}

// ───────────────────────────────────────────────────────────────────────────────────────────

function bark(s: Surf, N: TileNoise, o: { dark: C3; mid: C3; lichen: C3; lichenAmt: number }): void {
  const warp = new Field(128, (u, v) => N.fbm(u, v, 3, 3, 3));
  const warp2 = new Field(128, (u, v) => N.fbm(u + 0.37, v + 0.11, 4, 4, 2));
  const pv = fbmF(N, 6, 3, 3);
  const lich = fbmF(N, 5, 5, 3);
  fillRange(s, (i, x, y, u, v) => {
    const w1 = warp.at(u, v) * 0.1;
    const w2 = warp2.at(u, v) * 0.05;
    // fissures: zero crossings of anisotropic noise (long, branching, vertical)
    const sv = N.g(u * 9 + w1 * 9, v * 2 + w2, 9, 2, 1) + 0.85 * N.g(u * 18 + w1 * 18, v * 5, 18, 5, 2) + 0.5 * N.g(u * 36, v * 11, 36, 11, 3);
    const a = Math.abs(sv);
    const crease = 1 - sstep(0.0, 0.2, a);
    const roundOver = sstep(0.0, 0.42, a);
    const fib = N.g(u * 70, v * 7, 70, 7, 4);
    const plate = roundOver;
    const h = plate * 0.7 + fib * 0.07 + 0.1 - crease * 0.1;
    s.h[i] = h;
    lc(o.dark, o.mid, clamp01(plate * 0.85 + (fib * 0.5 + 0.5) * 0.2));
    const k = 0.78 + (pv.at(u, v) * 0.5 + 0.5) * 0.4;
    const lm = sstep(0.2, 0.55, lich.at(u, v) + fib * 0.2) * o.lichenAmt * plate;
    s.px(i, mix(cr * k, o.lichen[0], lm), mix(cg * k, o.lichen[1], lm), mix(cb * k, o.lichen[2], lm));
    s.rough[i] = 0.92 - plate * 0.06 + fib * 0.04;
  });
  aoFromHeight(s, 0.4, 1.3);
}

function mossyBark(s: Surf, N: TileNoise): void {
  bark(s, N, { dark: [22, 18, 14], mid: [78, 66, 52], lichen: [96, 108, 78], lichenAmt: 0.25 });
  const big = new Field(128, (u, v) => N.fbm(u, v, 3, 3, 4) * 0.6 + N.fbm(u, v, 9, 9, 3) * 0.4);
  fillRange(s, (i, x, y, u, v) => {
    const m = sstep(-0.08, 0.26, big.at(u, v) + (s.h[i] < 0.45 ? 0.14 : -0.02));
    if (m <= 0.001) return;
    const fuzz = N.g(u * 60, v * 60, 60, 60, 5) * 0.5 + 0.5;
    const shade = 0.7 + fuzz * 0.6;
    const o4 = i * 4;
    s.rgba[o4] = mix(s.rgba[o4], 44 * shade, m * 0.92);
    s.rgba[o4 + 1] = mix(s.rgba[o4 + 1], 80 * shade + fuzz * 22, m * 0.92);
    s.rgba[o4 + 2] = mix(s.rgba[o4 + 2], 24 * shade, m * 0.92);
    s.h[i] += m * (0.12 + fuzz * 0.16);
    s.rough[i] = mix(s.rough[i], 0.97, m);
  });
  aoFromHeight(s, 0.45, 1.2);
}

function leafLitter(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const base = fbmF(N, 6, 6, 4);
  fillRange(s, (i, x, y, u, v) => {
    const f = base.at(u, v);
    lc([34, 26, 18], [58, 44, 28], f * 0.5 + 0.5);
    s.px(i, cr, cg, cb);
    s.h[i] = 0.1 + f * 0.05;
    s.rough[i] = 0.9;
  });
  const pal: C3[] = [
    [132, 82, 36], [110, 64, 28], [150, 110, 48], [92, 78, 32], [70, 62, 28], [118, 52, 26], [86, 56, 30], [60, 70, 32],
  ];
  const count = 620;
  for (let k = 0; k < count; k++) {
    const cx = R.float() * n;
    const cy = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.05 + R.float() * 0.045);
    const Wd = L * (0.2 + R.float() * 0.1);
    const col = pal[Math.floor(R.float() * pal.length)];
    const tone = 0.7 + R.float() * 0.5;
    const lay = 0.2 + (k / count) * 0.7;
    leaf(s, cx, cy, ang, L, Wd, (i, along, across, rib) => {
      const edge = 1 - Math.abs(across);
      const sh = tone * (0.75 + 0.35 * edge) * (1 + rib * 0.18);
      s.px(i, col[0] * sh, col[1] * sh, col[2] * sh);
      s.h[i] = lay + edge * 0.05 + rib * 0.04;
      s.rough[i] = 0.78;
    });
  }
  aoFromHeight(s, 0.6, 1.2);
}

function grass(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const f1 = fbmF(N, 5, 5, 4);
  const f2 = fbmF(N, 2, 2, 2);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    lc([22, 38, 14], [58, 78, 28], f);
    const dry = sstep(0.55, 0.9, f2.at(u, v) * 0.5 + 0.5) * 0.5;
    s.px(i, mix(cr, 96, dry), mix(cg, 96, dry), mix(cb, 40, dry));
    s.h[i] = 0.15 + f * 0.1;
    s.rough[i] = 0.88;
  });
  const count = 4600;
  for (let k = 0; k < count; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.035 + R.float() * 0.06);
    const tone = 0.75 + R.float() * 0.5;
    const yellow = R.float() > 0.86 ? 1 : 0;
    const lay = 0.25 + (k / count) * 0.6;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 1.6 * K + 0.4, (i, t) => {
      s.px(i, mix(26, yellow ? 150 : 104, t) * tone, mix(46, yellow ? 148 : 140, t) * tone, mix(16, yellow ? 56 : 52, t) * tone);
      s.h[i] = lay + t * 0.12;
      s.rough[i] = 0.82;
    });
  }
  aoFromHeight(s, 0.5, 1.2);
}

function forestFloor(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const f1 = fbmF(N, 5, 5, 5);
  const f2 = fbmF(N, 3, 3, 3);
  const f3 = fbmF(N, 14, 14, 2);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    lc([24, 18, 13], [58, 44, 30], f);
    const m = sstep(0.1, 0.45, f2.at(u, v) + f3.at(u, v) * 0.3);
    s.px(i, mix(cr, 40, m * 0.85), mix(cg, 62, m * 0.85), mix(cb, 24, m * 0.85));
    s.h[i] = 0.1 + f * 0.1 + m * 0.08;
    s.rough[i] = 0.93;
  });
  const needle: C3[] = [[118, 82, 44], [96, 66, 36], [138, 98, 52], [78, 58, 34]];
  const nn = 5200;
  for (let k = 0; k < nn; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.018 + R.float() * 0.03);
    const c = needle[Math.floor(R.float() * 4)];
    const tone = 0.6 + R.float() * 0.6;
    const lay = 0.3 + (k / nn) * 0.4;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 1.2 * K + 0.3, (i) => {
      s.px(i, c[0] * tone, c[1] * tone, c[2] * tone);
      s.h[i] = lay;
      s.rough[i] = 0.85;
    });
  }
  const pal: C3[] = [[100, 62, 30], [84, 56, 28], [120, 88, 42], [66, 60, 28], [90, 40, 22]];
  for (let k = 0; k < 110; k++) {
    const col = pal[Math.floor(R.float() * pal.length)];
    const tone = 0.6 + R.float() * 0.5;
    const L = n * (0.05 + R.float() * 0.04);
    leaf(s, R.float() * n, R.float() * n, R.float() * 6.28, L, L * 0.26, (i, a, ac, rib) => {
      const sh = tone * (0.8 + 0.3 * (1 - Math.abs(ac))) * (1 + rib * 0.15);
      s.px(i, col[0] * sh, col[1] * sh, col[2] * sh);
      s.h[i] = 0.75 + (1 - Math.abs(ac)) * 0.05;
      s.rough[i] = 0.8;
    });
  }
  for (let k = 0; k < 24; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.08 + R.float() * 0.12);
    const w = (1.8 + R.float() * 1.6) * K;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, w, (i, t, kk) => {
      const sh = 0.8 + (1 - kk) * 0.4;
      s.px(i, 70 * sh, 56 * sh, 42 * sh);
      s.h[i] = 0.82 + (1 - kk) * 0.12;
      s.rough[i] = 0.9;
    });
  }
  aoFromHeight(s, 0.55, 1.2);
}

function mud(s: Surf, N: TileNoise): void {
  const f1 = fbmF(N, 4, 4, 5);
  const wetF = fbmF(N, 3, 3, 3);
  const cracks = edgeF(N, 7, 7, 0.9);
  const warm = fbmF(N, 12, 12, 2);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    const wet = sstep(0.38, 0.55, wetF.at(u, v) * 0.5 + 0.5);
    const crack = (1 - sstep(0.0, 0.07, cracks.at(u, v))) * (1 - wet);
    const fine = N.g(u * 48, v * 48, 48, 48, 9);
    lc([48, 36, 25], [88, 68, 48], f);
    const wk = (1 - wet * 0.35) * (1 - crack * 0.5) * (0.92 + warm.at(u, v) * 0.1);
    s.px(i, cr * wk, cg * wk, cb * wk);
    s.h[i] = mix(f * 0.5 + fine * 0.05 - crack * 0.3 + (1 - wet) * 0.12, 0.3, wet * 0.6);
    s.rough[i] = mix(0.9, 0.16, wet) - fine * 0.05;
  });
  aoFromHeight(s, 0.6, 1.4);
}

function dirt(s: Surf, N: TileNoise, R: Rng): void {
  const f1 = fbmF(N, 5, 5, 5);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    const grit = N.g(u * 96, v * 96, 96, 96, 11);
    lc([72, 54, 36], [132, 104, 72], f);
    const k = 1 + grit * 0.15;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = f * 0.35 + grit * 0.05;
    s.rough[i] = 0.92;
  });
  domes(s, R, 36, 0.9, 0.34, (i, d, id, dome) => {
    if (id < 0.45) return;
    if (dome * 0.5 + 0.2 < s.h[i] - 0.4 + 0.2) return;
    const pt = 0.7 + id * 0.6;
    const e = 1 - d * d * 0.5;
    s.px(i, 112 * pt * e, 102 * pt * e, 90 * pt * e);
    s.h[i] = Math.max(s.h[i], 0.35 + dome * 0.45);
    s.rough[i] = 0.82;
  });
  aoFromHeight(s, 0.6, 1.5);
}

function rock(s: Surf, N: TileNoise, o: { lo: C3; hi: C3; strata: number; lichen: number }): void {
  const warp = fbmF(N, 3, 3, 3);
  const edge = edgeF(N, 5, 5, 0.95, warp, 0.07, 256);
  const facet = new Field(256, (u, v) => {
    const w = warp.at(u, v) * 0.07;
    N.worley(u + w, v + w, 5, 5, 0.95);
    return N.id;
  });
  const mid = fbmF(N, 8, 8, 4);
  const lich = fbmF(N, 6, 6, 3);
  const tone = fbmF(N, 3, 3, 2);
  fillRange(s, (i, x, y, u, v) => {
    const w = warp.at(u, v);
    const fr = Math.abs(N.g(u * 7 + w * 4, v * 7 + w * 3, 7, 7, 5) + 0.6 * N.g(u * 15 + w * 6, v * 15, 15, 15, 6));
    const fracture = 1 - sstep(0.0, 0.17, fr);
    const crack = 1 - sstep(0.0, 0.07, edge.at(u, v));
    const rid = N.ridged(u + w * 0.03, v, 10, 10, 2);
    const grain = N.g(u * 90, v * 90, 90, 90, 13);
    const strata = Math.sin((v * 7 + tone.at(u, v) * 1.5) * Math.PI * 2) * o.strata;
    const h = 0.3 + facet.at(u, v) * 0.35 + mid.at(u, v) * 0.22 + rid * 0.18 - crack * 0.28 - fracture * 0.3 + strata + grain * 0.05;
    s.h[i] = h;
    lc(o.lo, o.hi, sstep(0.2, 0.9, h));
    const k = (0.86 + (tone.at(u, v) * 0.5 + 0.5) * 0.26 + grain * 0.1) * (1 - crack * 0.24) * (1 - fracture * 0.16);
    const lm = sstep(0.2, 0.55, lich.at(u, v) + (h - 0.6)) * o.lichen * 0.5;
    s.px(i, mix(cr * k, 138, lm), mix(cg * k, 142, lm), mix(cb * k, 86, lm));
    s.rough[i] = 0.82 + grain * 0.1;
  });
  aoFromHeight(s, 0.35, 1.1);
}

function cliff(s: Surf, N: TileNoise): void {
  const bands: C3[] = [[74, 64, 54], [112, 98, 82], [88, 80, 72], [132, 112, 90], [60, 56, 54]];
  const warp = fbmF(N, 3, 3, 3);
  const band = new Field(256, (u, v) => {
    const w = warp.at(u, v);
    return N.fbm(u + w * 0.1, v + w * 0.04, 2, 7, 3) * 0.5 + 0.5;
  });
  const vcr = edgeF(N, 9, 3, 0.9, warp, 0.03);
  const hor = fbmF(N, 3, 22, 1);
  const rd = ridgedF(N, 6, 6, 5);
  fillRange(s, (i, x, y, u, v) => {
    const b = band.at(u, v);
    const vcrack = 1 - sstep(0.0, 0.1, vcr.at(u, v));
    const grain = N.g(u * 90, v * 90, 90, 90, 17);
    const r = rd.at(u, v);
    const h = r * 0.45 + b * 0.4 + 0.15 - vcrack * 0.38 - sstep(0.5, 0.9, hor.at(u, v)) * 0.12 + grain * 0.04;
    s.h[i] = h;
    const bi = clamp01(b) * (bands.length - 1);
    const b0 = Math.min(bands.length - 2, Math.floor(bi));
    lc(bands[b0], bands[b0 + 1], sstep(0.2, 0.8, bi - b0));
    const k = (0.8 + r * 0.35 + grain * 0.1) * (1 - vcrack * 0.25);
    s.px(i, cr * k, cg * k, cb * k);
    s.rough[i] = 0.88;
  });
  aoFromHeight(s, 0.3, 1.2);
}

function cobble(s: Surf, N: TileNoise): void {
  const warp = fbmF(N, 4, 4, 2);
  const w2 = new Field(256, (u, v) => {
    const w = warp.at(u, v) * 0.025;
    N.worley(u + w, v + w, 7, 7, 0.78);
    return N.f2 - N.f1;
  });
  const ids = new Field(256, (u, v) => {
    const w = warp.at(u, v) * 0.025;
    N.worley(u + w, v + w, 7, 7, 0.78);
    return N.id;
  });
  const moss = fbmF(N, 9, 9, 3);
  const tone = fbmF(N, 5, 5, 3);
  // ids as a piecewise constant field would blur between cells: acceptable for tone variation
  fillRange(s, (i, x, y, u, v) => {
    const edge = w2.at(u, v);
    const id = clamp01(ids.at(u, v));
    const dome = Math.pow(sstep(0.0, 0.5, edge), 0.65);
    const grain = N.g(u * 90, v * 90, 90, 90, 19);
    const mort = 1 - sstep(0.025, 0.12, edge);
    lc([104, 100, 96], id > 0.6 ? [138, 118, 96] : [126, 124, 120], id);
    const k = 0.78 + grain * 0.12 + dome * 0.2 + tone.at(u, v) * 0.08;
    const ms = sstep(0.3, 0.6, moss.at(u, v)) * 0.5;
    s.px(i, mix(cr * k, mix(46, 44, ms), mort), mix(cg * k, mix(40, 62, ms), mort), mix(cb * k, mix(32, 30, ms), mort));
    s.h[i] = dome * 0.85 + grain * 0.05 - mort * 0.1;
    s.rough[i] = 0.8 + mort * 0.15 - dome * 0.05;
  });
  aoFromHeight(s, 0.25, 1.1);
}

function stoneBlocks(s: Surf, N: TileNoise, o: { rows: number; base: C3; var: number; mortar: C3 }): void {
  const n = s.n;
  const K = n / 512;
  const rows = o.rows;
  const bounds: { start: number; cum: number[] }[] = [];
  const BLK = 3;
  for (let r = 0; r < rows; r++) {
    const ws: number[] = [];
    let sum = 0;
    for (let b = 0; b < BLK; b++) {
      const w = 0.7 + N.cell(r, b, 5) * 0.6;
      ws.push(w);
      sum += w;
    }
    const cum = [0];
    for (let b = 0; b < BLK; b++) cum.push(cum[b] + ws[b] / sum);
    bounds.push({ start: N.cell(r, 9, 7), cum });
  }
  const edgeN = fbmF(N, 24, 24, 2);
  const surfF = fbmF(N, 12, 12, 4);
  const streak = fbmF(N, 14, 3, 2);
  fillRange(s, (i, x, y, u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const bd = bounds[row];
    const up = fract(u - bd.start);
    let b = 0;
    while (b < BLK - 1 && up >= bd.cum[b + 1]) b++;
    const dxp = Math.min(up - bd.cum[b], bd.cum[b + 1] - up) * n;
    const dyp = Math.min(fv, 1 - fv) * (n / rows);
    const d = Math.min(dxp, dyp) + edgeN.at(u, v) * 5 * K;
    const bevel = sstep(0, 7 * K, d);
    const mort = 1 - sstep(1.5 * K, 3.5 * K, d);
    const bid = N.cell(row, b, 11);
    const sf = surfF.at(u, v);
    const grain = N.g(u * 80, v * 80, 80, 80, 23);
    const sh = 1 - o.var * 0.5 + bid * o.var + sf * 0.12 + grain * 0.06 - sstep(0.25, 0.7, streak.at(u, v)) * 0.1;
    s.px(i, mix(o.base[0] * sh, o.mortar[0], mort), mix(o.base[1] * sh, o.mortar[1], mort), mix(o.base[2] * sh, o.mortar[2], mort));
    s.h[i] = bevel * 0.7 + sf * 0.12 + grain * 0.03 + 0.1 - mort * 0.1;
    s.rough[i] = 0.86 - bevel * 0.04 + grain * 0.05;
  });
  aoFromHeight(s, 0.35, 1.2);
  if (s.ao) {
    // darker in the joints
    fillRange(s, (i, x, y, u, v) => {
      void x; void y; void u; void v;
      s.ao![i] = clamp01(s.ao![i]);
    });
  }
}

function dwarvenStone(s: Surf, N: TileNoise): void {
  const vein = fbmF(N, 4, 4, 4);
  const mott = fbmF(N, 10, 10, 3);
  fillRange(s, (i, x, y, u, v) => {
    const pu = fract(u * 2);
    const pv = fract(v * 2);
    const px = pu - 0.5;
    const py = pv - 0.5;
    const dInf = Math.max(Math.abs(px), Math.abs(py));
    const dL1 = Math.abs(px) + Math.abs(py);
    const ve = vein.at(u, v);
    const grain = N.g(u * 100, v * 100, 100, 100, 29);
    let h = 0.62 + ve * 0.05 + grain * 0.02;
    const frame = Math.abs(dInf - 0.465);
    let groove = 1 - sstep(0.004, 0.012, frame);
    let inlay = 0;
    if (dInf < 0.43) {
      const useDiamond = dInf < 0.24;
      const q = useDiamond ? fract(dL1 * 11) : fract(dInf * 17);
      groove = Math.max(groove, (1 - sstep(0.12, 0.2, Math.abs(q - 0.5))) * 0.9);
      const diag = Math.abs(Math.abs(px) - Math.abs(py));
      if (dInf > 0.24) groove = Math.max(groove, (1 - sstep(0.006, 0.016, diag)) * 0.8);
      if (dInf < 0.05) h += 0.12;
    }
    if (frame < 0.01) inlay = 1;
    h -= groove * 0.34;
    s.h[i] = h;
    const base = 0.85 + ve * 0.25 + grain * 0.08;
    let r = 66 * base * (1 - groove * 0.55);
    let g = 70 * base * (1 - groove * 0.55);
    let b = 82 * base * (1 - groove * 0.5);
    if (inlay > 0) {
      r = mix(r, 92, 0.45);
      g = mix(g, 74, 0.45);
      b = mix(b, 42, 0.45);
    }
    s.px(i, r, g, b);
    s.rough[i] = 0.34 + grain * 0.12 + groove * 0.3 + Math.abs(mott.at(u, v)) * 0.15;
  });
  aoFromHeight(s, 0.4, 1.3);
}

function marble(s: Surf, N: TileNoise): void {
  const n = s.n;
  const t1 = fbmF(N, 3, 3, 5);
  const t2 = fbmF(N, 7, 7, 4);
  fillRange(s, (i, x, y, u, v) => {
    const a1 = t1.at(u, v);
    const a2 = t2.at(u, v);
    const veinA = Math.abs(Math.sin((u * 3 + v * 2 + a1 * 1.6) * Math.PI));
    const veinB = Math.abs(Math.sin((u * 5 - v * 4 + a2 * 1.1) * Math.PI));
    const va = 1 - sstep(0.0, 0.06, veinA);
    const vb = (1 - sstep(0.0, 0.03, veinB)) * 0.55;
    const veins = Math.max(va, vb) * (0.55 + 0.45 * sstep(-0.2, 0.3, a2));
    lc([236, 233, 226], [208, 206, 202], (a1 * 0.5 + 0.5) * 0.8);
    const seamU = (Math.min(fract(u * 2), 1 - fract(u * 2)) * n) / 2;
    const seamV = (Math.min(fract(v * 2), 1 - fract(v * 2)) * n) / 2;
    const seam = 1 - sstep(0.4, 1.8, Math.min(seamU, seamV) * (512 / n));
    s.px(i, mix(cr, 118, veins * 0.55) * (1 - seam * 0.4), mix(cg, 124, veins * 0.55) * (1 - seam * 0.4), mix(cb, 134, veins * 0.55) * (1 - seam * 0.38));
    s.h[i] = 0.7 - seam * 0.2 + a2 * 0.01;
    s.rough[i] = 0.22 + Math.abs(a2) * 0.12 + seam * 0.4;
  });
  aoFromHeight(s, 0.5, 1.3);
}

interface PlankOpts {
  rows: number;
  light: C3;
  dark: C3;
  gap: number;
  crack: number;
  wear: number;
  nails: boolean;
}
function planks(s: Surf, N: TileNoise, o: PlankOpts): void {
  const n = s.n;
  const K = n / 512;
  const P = o.rows;
  const joints: number[][] = [];
  for (let r = 0; r < P; r++) {
    const j1 = N.cell(r, 3, 21);
    const two = N.cell(r, 4, 22) > 0.55;
    joints.push(two ? [j1, fract(j1 + 0.38 + N.cell(r, 5, 23) * 0.2)] : [j1]);
  }
  const wobF = fbmF(N, 2, 4, 2);
  const wearF = fbmF(N, 5, 14, 3);
  const ringF = fbmF(N, 2, 2, 2);
  fillRange(s, (i, x, y, u, v) => {
    const row = Math.floor(v * P);
    const fv = v * P - row;
    const jr = joints[row];
    let seg = 0;
    let jd = 1;
    let jointDist = 1e9;
    for (let k = 0; k < jr.length; k++) {
      const d = fract(u - jr[k]);
      if (k === 0 || d < jd) {
        jd = d;
        seg = k;
      }
      const dd = Math.abs(fract(u - jr[k] + 0.5) - 0.5) * n;
      if (dd < jointDist) jointDist = dd;
    }
    const pid = N.cell(row, seg, 31);
    const wy = (row + fv) / P;
    const wob = wobF.at(u, wy) * 0.35;
    const ring = 0.5 + 0.5 * Math.sin((fv * 9 + wob * 4 + pid * 6 + ringF.at(u, wy) * 2) * Math.PI * 2);
    const fibre = N.g(fract(u + pid) * 3, wy * 80, 3, 80, 31);
    const grain = ring * 0.5 + fibre * 0.4 + 0.3;
    lc(o.dark, o.light, clamp01(grain * 0.8 + (pid - 0.5) * 0.3 + 0.1));
    let k = 0.9 + (pid - 0.5) * 0.2;
    let knot = 0;
    if (N.cell(row, seg, 43) > 0.6) {
      const dxk = fract(u - N.cell(row, seg, 41) + 0.5) - 0.5;
      const dyk = (fv - (0.25 + N.cell(row, seg, 42) * 0.5)) / P;
      const dk = Math.hypot(dxk, dyk) * 40;
      knot = Math.exp(-dk * dk * 0.35);
      k *= 1 - knot * 0.45 * (0.6 + 0.4 * Math.sin(dk * 7));
    }
    let r = cr * k;
    let g = cg * k;
    let b = cb * k;
    if (o.wear > 0) {
      const gw = (0.35 + 0.65 * wearF.at(u, v) * 0.5 + 0.2) * o.wear;
      const lum = (r + g + b) / 3;
      r = mix(r, lum * 1.02, gw);
      g = mix(g, lum * 0.98, gw);
      b = mix(b, lum * 0.92, gw);
    }
    const gapY = Math.min(fv, 1 - fv) * (n / P);
    const gap = Math.max(1 - sstep(o.gap * K * 0.4, o.gap * K * 1.4, gapY), 1 - sstep(o.gap * K * 0.3, o.gap * K, jointDist));
    const crk = o.crack * (1 - sstep(0.0, 0.03, Math.abs(N.g(fract(u + pid) * 6, wy * 70, 6, 70, 37))));
    const dark = Math.min(1, gap + crk * 0.6);
    r *= 1 - dark * 0.78;
    g *= 1 - dark * 0.78;
    b *= 1 - dark * 0.78;
    let nail = 0;
    if (o.nails) {
      const ndy = Math.abs(fv - 0.25) < 0.04 || Math.abs(fv - 0.75) < 0.04;
      if (ndy && jointDist > 5 * K && jointDist < 9 * K) nail = 1 - sstep(1.0 * K, 2.4 * K, Math.abs(jointDist - 7 * K));
    }
    s.px(i, mix(r, 40, nail), mix(g, 38, nail), mix(b, 36, nail));
    s.h[i] = 0.6 + grain * 0.1 - dark * 0.45 + nail * 0.05 - knot * 0.05;
    s.rough[i] = 0.72 + fibre * 0.1 + o.wear * 0.15 - nail * 0.3;
  });
  aoFromHeight(s, 0.4, 1.3);
}

function thatch(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const f1 = fbmF(N, 6, 6, 3);
  fillRange(s, (i, x, y, u, v) => {
    lc([54, 40, 24], [92, 72, 40], f1.at(u, v) * 0.5 + 0.5);
    s.px(i, cr, cg, cb);
    s.h[i] = 0.1;
    s.rough[i] = 0.95;
  });
  const pal: C3[] = [[190, 160, 92], [166, 134, 72], [210, 184, 112], [140, 112, 60], [176, 148, 84], [120, 98, 52]];
  const count = 9000;
  for (let k = 0; k < count; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = Math.PI / 2 + (R.float() - 0.5) * 0.35;
    const L = n * (0.08 + R.float() * 0.1);
    const c = pal[Math.floor(R.float() * pal.length)];
    const tone = 0.7 + R.float() * 0.5;
    const lay = 0.2 + (k / count) * 0.7;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 1.5 * K + 0.4, (i, t) => {
      const sh = tone * (0.7 + 0.45 * t);
      s.px(i, c[0] * sh, c[1] * sh, c[2] * sh);
      s.h[i] = lay;
      s.rough[i] = 0.9;
    });
  }
  const rows = 6;
  const wob = fbmF(N, 1, 6, 2);
  fillRange(s, (i, x, y, u, v) => {
    const f = fract(v * rows + wob.at(0.3, v) * 0.1);
    const sh = 0.55 + 0.45 * sstep(0.0, 0.35, f);
    s.rgba[i * 4] *= sh;
    s.rgba[i * 4 + 1] *= sh;
    s.rgba[i * 4 + 2] *= sh;
    s.h[i] += f * 0.25;
  });
  aoFromHeight(s, 0.4, 1.0);
}

function snow(s: Surf, N: TileNoise, R: Rng): void {
  const f1 = fbmF(N, 3, 3, 5);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v);
    const g = N.g(u * 60, v * 60, 60, 60, 41);
    lc([196, 210, 230], [244, 247, 252], clamp01(f * 0.5 + 0.55));
    const k = 1 + g * 0.03;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = f * 0.5 + g * 0.03;
    s.rough[i] = 0.62 + g * 0.1;
  });
  const n = s.n;
  for (let k = 0; k < n * n * 0.004; k++) {
    const i = Math.floor(R.float() * n * n);
    s.px(i, 255, 255, 255);
    s.rough[i] = 0.2;
  }
}

function ice(s: Surf, N: TileNoise): void {
  const warp = fbmF(N, 3, 3, 3);
  const c1 = edgeF(N, 5, 5, 0.95, warp, 0.06);
  const c2 = edgeF(N, 11, 11, 1, warp, 0.12);
  const cl = fbmF(N, 4, 4, 5);
  const bub = fbmF(N, 30, 30, 2);
  fillRange(s, (i, x, y, u, v) => {
    const crack = 1 - sstep(0.0, 0.035, c1.at(u, v));
    const crack2 = (1 - sstep(0.0, 0.02, c2.at(u, v))) * 0.5;
    const c = Math.max(crack, crack2);
    const clv = cl.at(u, v) * 0.5 + 0.5;
    const bubbles = sstep(0.62, 0.7, bub.at(u, v) * 0.5 + 0.5);
    lc([136, 186, 214], [226, 241, 247], clv);
    let r = mix(cr, 246, c * 0.7);
    let g = mix(cg, 250, c * 0.7);
    let b = mix(cb, 252, c * 0.7);
    r = mix(r, 235, bubbles * 0.4);
    g = mix(g, 244, bubbles * 0.4);
    b = mix(b, 250, bubbles * 0.4);
    s.px(i, r, g, b);
    s.h[i] = clv * 0.15 - c * 0.15;
    s.rough[i] = 0.1 + c * 0.35 + (1 - clv) * 0.05;
  });
}

function sand(s: Surf, N: TileNoise): void {
  const w1 = fbmF(N, 3, 3, 3);
  fillRange(s, (i, x, y, u, v) => {
    const w = w1.at(u, v);
    const rip = Math.sin((v * 14 + w * 3.2 + u * 2) * Math.PI * 2) * 0.5 + 0.5;
    const grit = N.g(u * 110, v * 110, 110, 110, 43);
    lc([178, 146, 98], [222, 194, 140], clamp01(rip * 0.6 + w * 0.3 + 0.3));
    const k = 1 + grit * 0.1;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = rip * 0.4 + grit * 0.04;
    s.rough[i] = 0.92;
  });
}

function ash(s: Surf, N: TileNoise, R: Rng): void {
  const f1 = fbmF(N, 5, 5, 5);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    const g = N.g(u * 90, v * 90, 90, 90, 47);
    lc([30, 29, 28], [74, 72, 68], f);
    const k = 1 + g * 0.18;
    s.px(i, cr * k, cg * k * 0.99, cb * k * 0.97);
    s.h[i] = f * 0.4 + g * 0.05;
    s.rough[i] = 0.96;
  });
  domes(s, R, 28, 1, 0.45, (i, d, id, dome) => {
    if (id < 0.55) return;
    const k = 0.8 + id * 0.5;
    s.px(i, 62 * k * (0.7 + dome * 0.3), 60 * k * (0.7 + dome * 0.3), 57 * k * (0.7 + dome * 0.3));
    s.h[i] = Math.max(s.h[i], 0.2 + dome * 0.35);
  });
  const n = s.n;
  for (let k = 0; k < n * n * 0.0007; k++) s.px(Math.floor(R.float() * n * n), 12, 12, 12);
  aoFromHeight(s, 0.6, 1.6);
}

function metal(s: Surf, N: TileNoise, R: Rng, o: { lo: C3; hi: C3; rust: number; rough: number; scratches: number; dimples?: boolean }): void {
  const n = s.n;
  const K = n / 512;
  const mottF = fbmF(N, 6, 6, 4);
  const rustF = fbmF(N, 5, 5, 4);
  const rustF2 = fbmF(N, 30, 30, 2);
  fillRange(s, (i, x, y, u, v) => {
    const brush = N.g(u * 2, v * 150, 2, 150, 53);
    const mott = mottF.at(u, v) * 0.5 + 0.5;
    const rustM = o.rust > 0 ? sstep(0.62 - o.rust * 0.3, 0.8, rustF.at(u, v) * 0.5 + 0.5 + rustF2.at(u, v) * 0.15) : 0;
    lc(o.lo, o.hi, clamp01(mott * 0.7 + brush * 0.15 + 0.1));
    const k = 1 + brush * 0.12;
    s.px(i, mix(cr * k, 96, rustM * 0.8), mix(cg * k, 52, rustM * 0.8), mix(cb * k, 28, rustM * 0.8));
    s.h[i] = 0.5 + brush * 0.04 + rustM * 0.12;
    s.rough[i] = o.rough + brush * 0.08 + rustM * 0.35 + (1 - mott) * 0.08;
    if (s.metal) s.metal[i] = 1 - rustM * 0.85;
  });
  if (o.dimples) {
    domes(s, R, 20, 0.9, 0.5, (i, d, id, dome) => {
      s.h[i] -= (1 - d) * 0.22;
      const o4 = i * 4;
      const k = 1 + (0.5 - d) * 0.1;
      s.rgba[o4] *= k;
      s.rgba[o4 + 1] *= k;
      s.rgba[o4 + 2] *= k;
      void id; void dome;
    });
  }
  const sc = Math.floor(o.scratches);
  for (let k = 0; k < sc; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = (R.float() - 0.5) * 1.2 + (R.float() > 0.5 ? 0 : Math.PI / 2);
    const L = n * (0.05 + R.float() * 0.2);
    const bright = 0.15 + R.float() * 0.25;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 0.9 * K + 0.2, (i) => {
      const o4 = i * 4;
      s.rgba[o4] = Math.min(255, s.rgba[o4] * (1 + bright));
      s.rgba[o4 + 1] = Math.min(255, s.rgba[o4 + 1] * (1 + bright));
      s.rgba[o4 + 2] = Math.min(255, s.rgba[o4 + 2] * (1 + bright));
      s.h[i] -= 0.04;
      s.rough[i] += 0.1;
    });
  }
}

function leather(s: Surf, N: TileNoise, R: Rng): void {
  const crease = ridgedF(N, 3, 3, 4);
  const wearF = fbmF(N, 4, 4, 4);
  fillRange(s, (i, x, y, u, v) => {
    const wear = sstep(0.4, 0.8, wearF.at(u, v) * 0.5 + 0.5);
    const cv = crease.at(u, v);
    lc([62, 40, 26], [112, 76, 48], wear * 0.7 + 0.1);
    const k = 0.9 - sstep(0.75, 0.95, cv) * 0.25;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = 0.1 + cv * 0.35;
    s.rough[i] = 0.5 + wear * 0.18 + 0.15;
  });
  domes(s, R, 46, 0.7, 0.62, (i, d, id, dome) => {
    const o4 = i * 4;
    const k = 0.85 + id * 0.2 + dome * 0.18;
    s.rgba[o4] = Math.min(255, s.rgba[o4] * k);
    s.rgba[o4 + 1] = Math.min(255, s.rgba[o4 + 1] * k);
    s.rgba[o4 + 2] = Math.min(255, s.rgba[o4 + 2] * k);
    s.h[i] += dome * 0.4;
    s.rough[i] -= dome * 0.12;
  });
  aoFromHeight(s, 0.5, 1.1);
}

function linen(s: Surf, N: TileNoise): void {
  const T = 64;
  const slubA = new Field(256, (u, v) => N.fbm(u, v, 3, 40, 1));
  const slubB = new Field(256, (u, v) => N.fbm(u, v, 40, 3, 1));
  fillRange(s, (i, x, y, u, v) => {
    const tu = u * T;
    const tv = v * T;
    const cu = Math.floor(tu);
    const cv = Math.floor(tv);
    const fu = tu - cu;
    const fv = tv - cv;
    let h: number;
    let thread: number;
    if ((cu + cv) & 1) {
      h = (1 - (fu - 0.5) * (fu - 0.5) * 4) * (0.65 + 0.35 * Math.sin(fv * Math.PI));
      thread = N.cell(cu, 0, 51);
    } else {
      h = (1 - (fv - 0.5) * (fv - 0.5) * 4) * (0.65 + 0.35 * Math.sin(fu * Math.PI));
      thread = N.cell(cv, 0, 52);
    }
    const slub = slubA.at(u, v) * 0.5 + slubB.at(u, v) * 0.5;
    const k = 0.8 + thread * 0.22 + h * 0.2 + slub * 0.12;
    s.px(i, 205 * k, 192 * k, 165 * k);
    s.h[i] = h;
    s.rough[i] = 0.9;
  });
  aoFromHeight(s, 0.5, 1.0);
}

function wool(s: Surf, N: TileNoise): void {
  const T = 40;
  fillRange(s, (i, x, y, u, v) => {
    const tu = u * T;
    const tv = v * T;
    const cu = Math.floor(tu);
    const cv = Math.floor(tv);
    const fu = tu - cu;
    const fv = tv - cv;
    const par = (((cu - cv) % 4) + 4) % 4 < 2;
    const prof = par ? 1 - (fu - 0.5) * (fu - 0.5) * 3 : 1 - (fv - 0.5) * (fv - 0.5) * 3;
    const twist = 0.5 + 0.5 * Math.sin((par ? fv + fu * 0.7 : fu + fv * 0.7) * Math.PI * 4);
    const fuzz = N.g(u * 140, v * 140, 140, 140, 59);
    const h = prof * (0.75 + 0.25 * twist) + fuzz * 0.25;
    const thread = N.cell(par ? cu : cv, par ? 1 : 2, 53);
    const k = 0.75 + thread * 0.25 + h * 0.25 + fuzz * 0.18;
    s.px(i, 108 * k, 96 * k, 84 * k);
    s.h[i] = h;
    s.rough[i] = 1;
  });
  aoFromHeight(s, 0.45, 1.0);
}

function web(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const warp = fbmF(N, 3, 3, 2);
  const net = edgeF(N, 6, 6, 1, warp, 0.03, 256);
  const haze = fbmF(N, 8, 8, 3);
  fillRange(s, (i, x, y, u, v) => {
    s.px(i, 226, 228, 232);
    const line = 1 - sstep(0.0, 0.03, net.at(u, v));
    const hz = sstep(0.1, 0.5, haze.at(u, v) * 0.5 + 0.5) * 36;
    s.rgba[i * 4 + 3] = Math.max(line * 230, hz);
    s.rough[i] = 0.5;
  });
  const setA = (i: number, a: number) => {
    const o = i * 4 + 3;
    if (a > s.rgba[o]) s.rgba[o] = a;
  };
  for (let k = 0; k < 40; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.15 + R.float() * 0.3);
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 1.1 * K, (i) => setA(i, 200));
  }
  for (let i = 0; i < n * n; i++) s.h[i] = s.rgba[i * 4 + 3] / 255;
}

function waterNormal(s: Surf, N: TileNoise): void {
  const a = fbmF(N, 4, 4, 5);
  const b = new Field(256, (u, v) => N.fbm(u + 0.3, v, 8, 3, 4));
  fillRange(s, (i, x, y, u, v) => {
    const av = a.at(u, v);
    const rip = Math.sin((u * 6 + v * 3 + av * 2.2) * Math.PI * 2) * 0.5;
    s.h[i] = av * 0.6 + b.at(u, v) * 0.35 + rip * 0.08;
    s.px(i, 24 + av * 8, 52 + av * 10, 60 + av * 10);
    s.rough[i] = 0.06;
  });
}

function chitin(s: Surf, N: TileNoise): void {
  const warp = fbmF(N, 3, 3, 2);
  const edge = edgeF(N, 9, 9, 0.8, warp, 0.04);
  const ids = new Field(128, (u, v) => {
    const w = warp.at(u, v) * 0.04;
    N.worley(u + w, v + w, 9, 9, 0.8);
    return N.id;
  });
  const vein = ridgedF(N, 6, 6, 4);
  fillRange(s, (i, x, y, u, v) => {
    const dome = Math.pow(sstep(0.0, 0.55, edge.at(u, v)), 0.7);
    const pit = N.g(u * 80, v * 80, 80, 80, 61);
    const vv = vein.at(u, v);
    lc([20, 15, 12], [64, 40, 26], clamp01(dome * 0.6 + vv * 0.25 + clamp01(ids.at(u, v)) * 0.25));
    const k = 0.85 + pit * 0.1;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = dome * 0.7 + pit * 0.03 + vv * 0.05;
    s.rough[i] = 0.28 + (1 - dome) * 0.4 + Math.abs(pit) * 0.1;
  });
  aoFromHeight(s, 0.3, 1.2);
}

function scales(s: Surf, N: TileNoise, o: { rows: number; lo: C3; hi: C3 }): void {
  const R = o.rows;
  const cols = Math.round(R * 0.8);
  fillRange(s, (i, x, y, u, v) => {
    const row = Math.floor(v * R);
    const fv = v * R - row;
    const off = row & 1 ? 0.5 : 0;
    const cu = Math.floor(u * cols + off);
    const fu = u * cols + off - cu;
    const sx = fu - 0.5;
    const dist = Math.sqrt(sx * sx * 3.2 + Math.pow(Math.max(0, fv - 0.15), 2) * 1.4);
    const body = 1 - sstep(0.62, 0.9, dist);
    const id = N.cell(((cu % cols) + cols) % cols, row, 61);
    const grain = N.g(u * 70, v * 70, 70, 70, 67);
    s.h[i] = body * (0.35 + fv * 0.55) + grain * 0.03;
    lc(o.lo, o.hi, clamp01(id * 0.7 + body * 0.3));
    const k = (0.55 + body * 0.55) * (0.88 + grain * 0.15);
    s.px(i, cr * k, cg * k, cb * k);
    s.rough[i] = 0.7 - body * 0.1 + grain * 0.1;
  });
  aoFromHeight(s, 0.25, 1.1);
}

function hide(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const warp = fbmF(N, 4, 4, 3);
  const wr = new Field(256, (u, v) => {
    const w = warp.at(u, v) * 0.05;
    return N.ridged(u + w, v + w, 7, 7, 4);
  });
  const f1 = fbmF(N, 5, 5, 4);
  fillRange(s, (i, x, y, u, v) => {
    const r = wr.at(u, v);
    const f = f1.at(u, v) * 0.5 + 0.5;
    const fine = N.g(u * 70, v * 70, 70, 70, 71);
    lc([82, 56, 36], [138, 98, 66], f);
    const k = 0.85 + r * 0.25 + fine * 0.1;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = r * 0.6 + f * 0.2 + fine * 0.05;
    s.rough[i] = 0.78 + fine * 0.1;
  });
  for (let k = 0; k < 2200; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = Math.PI / 2 + (R.float() - 0.5) * 0.7;
    const L = n * (0.012 + R.float() * 0.02);
    const tone = 0.7 + R.float() * 0.6;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 0.9 * K + 0.2, (i) => {
      s.px(i, 100 * tone, 70 * tone, 46 * tone);
      s.h[i] += 0.05;
    });
  }
  aoFromHeight(s, 0.5, 1.1);
}

function skinHuman(s: Surf, N: TileNoise, R: Rng): void {
  const blotch = fbmF(N, 5, 5, 4);
  const redF = fbmF(N, 9, 9, 3);
  const wr = ridgedF(N, 12, 12, 3);
  fillRange(s, (i, x, y, u, v) => {
    const red = sstep(0.45, 0.8, redF.at(u, v) * 0.5 + 0.5);
    const fine = N.g(u * 160, v * 160, 160, 160, 73);
    lc([206, 156, 128], [226, 178, 148], blotch.at(u, v) * 0.5 + 0.5);
    s.px(i, mix(cr, 214, red * 0.35) * (1 + fine * 0.03), mix(cg, 138, red * 0.35) * (1 + fine * 0.03), mix(cb, 118, red * 0.35) * (1 + fine * 0.03));
    s.h[i] = 0.7 + wr.at(u, v) * 0.12 + fine * 0.03;
    s.rough[i] = 0.52 + fine * 0.05;
  });
  domes(s, R, 100, 0.95, 0.4, (i, d, id, dome) => {
    if (id < 0.3) return;
    const k = 1 - (1 - d) * 0.22;
    const o4 = i * 4;
    s.rgba[o4] *= k;
    s.rgba[o4 + 1] *= k;
    s.rgba[o4 + 2] *= k;
    s.h[i] -= dome * 0.3;
    s.rough[i] += dome * 0.15;
  });
  aoFromHeight(s, 0.7, 1.0);
}

function skinOrc(s: Surf, N: TileNoise, R: Rng): void {
  const warp = fbmF(N, 4, 4, 3);
  const wr = new Field(256, (u, v) => {
    const w = warp.at(u, v) * 0.04;
    return N.ridged(u + w, v + w, 6, 6, 5);
  });
  const f1 = fbmF(N, 4, 4, 4);
  const dirtF = fbmF(N, 7, 7, 4);
  fillRange(s, (i, x, y, u, v) => {
    const r = wr.at(u, v);
    const f = f1.at(u, v) * 0.5 + 0.5;
    const dirt = sstep(0.45, 0.8, dirtF.at(u, v) * 0.5 + 0.5);
    lc([66, 74, 52], [110, 118, 84], f);
    const k = 0.75 + r * 0.4;
    s.px(i, mix(cr, 50, dirt * 0.4) * k, mix(cg, 46, dirt * 0.4) * k, mix(cb, 36, dirt * 0.4) * k);
    s.h[i] = r * 0.5 + f * 0.1;
    s.rough[i] = 0.6 + dirt * 0.25;
  });
  domes(s, R, 14, 1, 0.5, (i, d, id, dome) => {
    if (id < 0.8) return;
    const o4 = i * 4;
    s.rgba[o4] = mix(s.rgba[o4], 122, 0.3 * dome);
    s.rgba[o4 + 1] = mix(s.rgba[o4 + 1], 112, 0.3 * dome);
    s.rgba[o4 + 2] = mix(s.rgba[o4 + 2], 84, 0.3 * dome);
    s.h[i] += dome * 0.4;
  });
  domes(s, R, 64, 1, 0.45, (i, d, id, dome) => {
    s.h[i] -= dome * 0.1;
    const o4 = i * 4;
    const k = 1 - (1 - d) * 0.2;
    s.rgba[o4] *= k;
    s.rgba[o4 + 1] *= k;
    s.rgba[o4 + 2] *= k;
  });
  aoFromHeight(s, 0.4, 1.1);
}

function skinTroll(s: Surf, N: TileNoise, R: Rng): void {
  const warp = fbmF(N, 3, 3, 3);
  const edge = edgeF(N, 6, 6, 0.9, warp, 0.05);
  const ids = new Field(128, (u, v) => {
    const w = warp.at(u, v) * 0.05;
    N.worley(u + w, v + w, 6, 6, 0.9);
    return N.id;
  });
  const rd = ridgedF(N, 8, 8, 4);
  const mossF = fbmF(N, 5, 5, 4);
  fillRange(s, (i, x, y, u, v) => {
    const plate = sstep(0.0, 0.2, edge.at(u, v));
    const r = rd.at(u, v);
    const moss = sstep(0.35, 0.7, mossF.at(u, v) * 0.5 + 0.5) * sstep(0.45, 0.2, r);
    lc([84, 88, 80], [124, 126, 112], clamp01(ids.at(u, v)));
    const k = 0.7 + plate * 0.3 + r * 0.2;
    s.px(i, mix(cr * k, 58, moss * 0.45), mix(cg * k, 82, moss * 0.45), mix(cb * k, 44, moss * 0.45));
    s.h[i] = plate * 0.5 + r * 0.25;
    s.rough[i] = 0.8 - plate * 0.05 + moss * 0.1;
  });
  domes(s, R, 20, 1, 0.5, (i, d, id, dome) => {
    if (id < 0.7) return;
    s.h[i] += dome * 0.35;
    const o4 = i * 4;
    const k = 0.9 + dome * 0.15;
    s.rgba[o4] *= k;
    s.rgba[o4 + 1] *= k;
    s.rgba[o4 + 2] *= k;
  });
  aoFromHeight(s, 0.3, 1.1);
}

function birch(s: Surf, N: TileNoise): void {
  const mk = new Field(256, (u, v) => N.fbm(u, v, 3, 14, 3) + N.fbm(u, v, 12, 40, 2) * 0.4);
  const peel = fbmF(N, 3, 2, 4);
  fillRange(s, (i, x, y, u, v) => {
    const dash = sstep(0.28, 0.42, mk.at(u, v));
    const p = peel.at(u, v);
    const flake = sstep(0.2, 0.34, p) * 0.5;
    const fine = N.g(u * 20, v * 80, 20, 80, 79);
    lc([226, 222, 210], [188, 184, 172], flake + fine * 0.2);
    const k = 1 - dash * 0.88;
    s.px(i, cr * k + 10 * dash, cg * k + 9 * dash, cb * k + 8 * dash);
    s.h[i] = 0.6 - dash * 0.15 + p * 0.08 + flake * 0.2;
    s.rough[i] = 0.62 + dash * 0.25;
  });
  aoFromHeight(s, 0.7, 1.0);
}

function shingles(s: Surf, N: TileNoise): void {
  const n = s.n;
  const rows = 8;
  const cols = 8;
  const mossF = fbmF(N, 5, 5, 4);
  const ringW = fbmF(N, 3, 3, 2);
  fillRange(s, (i, x, y, u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const off = row & 1 ? 0.5 : 0.0;
    const cu = Math.floor(u * cols + off);
    const fu = u * cols + off - cu;
    const cuw = ((cu % cols) + cols) % cols;
    const id = N.cell(cuw, row, 71);
    const id2 = N.cell(cuw, row, 72);
    const bottom = 0.92 + id2 * 0.06;
    const gapx = Math.min(fu, 1 - fu) * (n / cols);
    const gap = 1 - sstep(1.0 * (n / 512), 3.0 * (n / 512), gapx);
    const grain = N.g(fract(u + id) * 4, v * 120, 4, 120, 83);
    const ring = Math.sin((fu * 9 + ringW.at(u, v) * 1.5 + id * 4) * Math.PI * 2) * 0.5 + 0.5;
    lc([74, 58, 42], [124, 104, 82], clamp01(grain * 0.5 + 0.4 + id * 0.25));
    const shade = 0.5 + 0.5 * sstep(0.0, 0.6, fv) * (fv < bottom ? 1 : 0.6);
    const k = shade * (0.9 + ring * 0.15) * (1 - gap * 0.6);
    const moss = sstep(0.5, 0.8, mossF.at(u, v) * 0.5 + 0.5) * 0.35;
    s.px(i, mix(cr * k, 60 * k, moss), mix(cg * k, 80 * k, moss), mix(cb * k, 40 * k, moss));
    s.h[i] = fv * 0.55 * (fv < bottom ? 1 : 0.4) + grain * 0.04 - gap * 0.2;
    s.rough[i] = 0.82;
  });
  aoFromHeight(s, 0.3, 1.1);
}

function bone(s: Surf, N: TileNoise, R: Rng): void {
  const f1 = fbmF(N, 4, 4, 4);
  const streak = fbmF(N, 3, 18, 3);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    const st = streak.at(u, v) * 0.5 + 0.5;
    const grain = N.g(u * 80, v * 80, 80, 80, 91);
    lc([150, 128, 96], [220, 205, 172], clamp01(f * 0.7 + st * 0.3));
    const k = 0.92 + grain * 0.1;
    s.px(i, cr * k, cg * k, cb * k);
    s.h[i] = f * 0.3 + st * 0.2 + grain * 0.04;
    s.rough[i] = 0.62 + grain * 0.1;
  });
  domes(s, R, 60, 1, 0.4, (i, d, id, dome) => {
    if (id < 0.5) return;
    s.h[i] -= dome * 0.15;
    const o4 = i * 4;
    const k = 1 - dome * 0.25;
    s.rgba[o4] *= k;
    s.rgba[o4 + 1] *= k;
    s.rgba[o4 + 2] *= k;
  });
  aoFromHeight(s, 0.6, 1.2);
}

// ───────────────────────────────────────────────────────────────────────────────────────────

export const GENERATORS: Record<string, GenSpec> = {
  bark: { normal: 5.5, ao: true, fn: (s, N) => bark(s, N, { dark: [26, 20, 16], mid: [92, 76, 60], lichen: [126, 132, 112], lichenAmt: 0.2 }) },
  mossy_bark: { normal: 3.2, ao: true, fn: mossyBark },
  birch_bark: { normal: 1.6, ao: true, fn: birch },
  bone: { normal: 1.8, ao: true, fn: bone },
  leaves: { normal: 3.2, ao: true, fn: leafLitter },
  grass: { normal: 2.2, ao: true, fn: grass },
  forest_floor: { normal: 3.0, ao: true, fn: forestFloor },
  mud: { normal: 3.0, ao: true, fn: mud },
  dirt: { normal: 3.0, ao: true, fn: dirt },
  rock: { normal: 4.0, ao: true, fn: (s, N) => rock(s, N, { lo: [52, 50, 48], hi: [136, 128, 118], strata: 0.05, lichen: 0.3 }) },
  cliff: { normal: 4.4, ao: true, fn: cliff },
  cobble: { normal: 4.8, ao: true, fn: cobble },
  stone_blocks: { normal: 3.6, ao: true, fn: (s, N) => stoneBlocks(s, N, { rows: 6, base: [130, 122, 110], var: 0.2, mortar: [60, 56, 50] }) },
  dwarven_stone: { normal: 4.0, ao: true, fn: dwarvenStone },
  marble: { normal: 0.8, ao: true, fn: marble },
  wood_planks: {
    normal: 3.0,
    ao: true,
    fn: (s, N) => planks(s, N, { rows: 6, light: [166, 124, 82], dark: [96, 66, 40], gap: 1.6, crack: 0.5, wear: 0.15, nails: true }),
  },
  old_wood: {
    normal: 3.4,
    ao: true,
    fn: (s, N) => planks(s, N, { rows: 6, light: [116, 100, 82], dark: [52, 42, 32], gap: 2.4, crack: 1.0, wear: 0.65, nails: true }),
  },
  shingles: { normal: 3.6, ao: true, fn: shingles },
  thatch: { normal: 2.8, ao: true, fn: thatch },
  snow: { normal: 1.2, fn: snow },
  ice: { normal: 1.4, fn: ice },
  sand: { normal: 2.0, fn: sand },
  ash: { normal: 2.6, ao: true, fn: ash },
  metal_dark: { normal: 1.6, metal: true, fn: (s, N, R) => metal(s, N, R, { lo: [34, 35, 38], hi: [80, 82, 88], rust: 0.45, rough: 0.46, scratches: 160 }) },
  metal_bright: { normal: 1.0, metal: true, fn: (s, N, R) => metal(s, N, R, { lo: [158, 162, 168], hi: [214, 218, 222], rust: 0, rough: 0.28, scratches: 240 }) },
  gold: { normal: 1.4, metal: true, fn: (s, N, R) => metal(s, N, R, { lo: [176, 134, 40], hi: [236, 196, 92], rust: 0, rough: 0.28, scratches: 80, dimples: true }) },
  leather: { normal: 3.2, ao: true, fn: leather },
  cloth_linen: { normal: 2.8, ao: true, fn: linen },
  cloth_wool: { normal: 3.2, ao: true, fn: wool },
  web: { normal: 0.6, alpha: true, fn: web },
  water_normal: { normal: 4.5, fn: waterNormal },
  chitin: { normal: 3.6, ao: true, fn: chitin },
  scales_rough: { normal: 3.6, ao: true, fn: (s, N) => scales(s, N, { rows: 16, lo: [54, 62, 46], hi: [104, 112, 82] }) },
  hide: { normal: 2.8, ao: true, fn: hide },
  skin_human: { normal: 1.0, ao: true, fn: skinHuman },
  skin_orc: { normal: 3.4, ao: true, fn: skinOrc },
  skin_troll: { normal: 4.0, ao: true, fn: skinTroll },
};

export { lc3 as _lc3 };
