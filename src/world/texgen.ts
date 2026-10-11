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

/**
 * Furrowed bark (2.4 m tile, u around the trunk, v along it): long vertical plates ~12 cm wide and
 * 0.3–0.6 m tall split by deep fissures that wander and branch, plates broken into crumbly flakes, the
 * plate faces weathered lighter than the fissures, lichen on some plates.
 */
function bark(s: Surf, N: TileNoise, o: { dark: C3; mid: C3; lichen: C3; lichenAmt: number }): void {
  const warp = new Field(128, (u, v) => N.fbm(u, v, 4, 3, 3));
  const warp2 = fbmF(N, 9, 4, 2);
  const pv = fbmF(N, 6, 3, 3);
  const lich = fbmF(N, 5, 5, 3);
  const pidF = new Field(128, (u, v) => clamp01(N.g(u * 16, v * 2, 16, 2, 6) * 0.5 + 0.5));
  const hbF = new Field(256, (u, v) => Math.abs(N.g(u * 10, v * 16, 10, 16, 3)));
  fillRange(s, (i, x, y, u, v) => {
    const w = warp.at(u, v);
    // long vertical fissures: zero crossings of noise stretched along the trunk (they wander and branch)
    const uw = u + w * 0.05 + warp2.at(u, v) * 0.01;
    const sv = N.g(uw * 16, v * 2, 16, 2, 1) + 0.55 * N.g(uw * 30, v * 4, 30, 4, 2);
    const ae = Math.abs(sv);
    const pid = pidF.at(uw, v);
    // shallow breaks across the plates
    const hb = (1 - sstep(0.0, 0.06, hbF.at(uw, v))) * 0.6;
    const edge = Math.min(ae, 0.12 + (1 - hb) * 0.5);
    const fiss = 1 - sstep(0.0, 0.13, ae);
    const plate = Math.pow(sstep(0.03, 0.45, edge), 0.6);
    // crumbly flakes: stepped breaks across the plates
    const fl = N.g(u * 40 + pid * 7, v * 22, 40, 22, 4);
    const flake = sstep(0.1, 0.16, fl) * 0.5 + sstep(0.38, 0.44, fl) * 0.5;
    const fib = N.g(u * 120, v * 30, 120, 30, 5);
    const sp = ih(x, y, 31);
    s.h[i] = plate * 0.75 + flake * 0.18 * plate + fib * 0.04 + (sp - 0.5) * 0.03 - fiss * 0.15;
    lc(o.dark, o.mid, clamp01(plate * 0.9 + flake * 0.08 + (fib * 0.5 + 0.5) * 0.12));
    const k = (0.82 + (pv.at(u, v) * 0.5 + 0.5) * 0.3) * (0.92 + pid * 0.14) * (0.94 + sp * 0.1);
    const lm = sstep(0.25, 0.55, lich.at(u, v) + fib * 0.15) * o.lichenAmt * plate;
    s.px(i, mix(cr * k, o.lichen[0], lm), mix(cg * k, o.lichen[1], lm), mix(cb * k, o.lichen[2], lm));
    s.rough[i] = 0.9 - plate * 0.05 + fib * 0.04 + fiss * 0.05;
  });
  cavityAO(s, 6, 2.6, 0.35, 0.2);
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

/**
 * Forest floor: dark crumbly soil showing through compressed, muted brown leaves with ragged edges
 * (some half-rotted into the soil), a few needles and twigs, low damp moss. No saturated confetti.
 */
function forestFloor(s: Surf, N: TileNoise, R: Rng): void {
  const n = s.n;
  const K = n / 512;
  const f1 = fbmF(N, 5, 5, 5);
  const f2 = fbmF(N, 3, 3, 3);
  const f3 = fbmF(N, 14, 14, 2);
  fillRange(s, (i, x, y, u, v) => {
    const f = f1.at(u, v) * 0.5 + 0.5;
    const sp = ih(x, y, 21);
    lc([30, 23, 17], [66, 50, 36], f);
    const gk = 0.9 + sp * 0.2;
    const m = sstep(0.18, 0.5, f2.at(u, v) + f3.at(u, v) * 0.3) * 0.5;
    s.px(i, mix(cr * gk, 50, m), mix(cg * gk, 56, m), mix(cb * gk, 32, m));
    s.h[i] = 0.1 + f * 0.1 + m * 0.08 + sp * 0.03;
    s.rough[i] = 0.94;
  });
  const needle: C3[] = [[96, 72, 48], [80, 62, 44], [108, 82, 56], [68, 54, 40]];
  const nn = 2400;
  for (let k = 0; k < nn; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.016 + R.float() * 0.026);
    const c = needle[Math.floor(R.float() * 4)];
    const tone = 0.6 + R.float() * 0.5;
    const lay = 0.3 + (k / nn) * 0.3;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 1.0 * K + 0.3, (i) => {
      s.px(i, c[0] * tone, c[1] * tone, c[2] * tone);
      s.h[i] = lay;
      s.rough[i] = 0.86;
    });
  }
  const pal: C3[] = [[112, 80, 54], [96, 70, 48], [128, 96, 66], [84, 64, 44], [104, 74, 50], [118, 92, 70]];
  const nl = 300;
  for (let k = 0; k < nl; k++) {
    const col = pal[Math.floor(R.float() * pal.length)];
    const tone = 0.62 + R.float() * 0.45;
    const L = n * (0.04 + R.float() * 0.05);
    const decay = R.float() * R.float() * 0.75;
    const lay = 0.55 + (k / nl) * 0.3;
    const seed = k * 13;
    leaf(s, R.float() * n, R.float() * n, R.float() * 6.28, L, L * (0.3 + R.float() * 0.12), (i, a, ac, rib) => {
      const aa = Math.abs(ac);
      // ragged, broken edges
      if (aa > 0.72 && ih(i, seed, 23) < (aa - 0.72) * 3.2) return;
      const vein = Math.abs(fract(a * 5 + aa * 1.4) - 0.5) < 0.06 ? 0.88 : 1;
      const sh = tone * (0.84 + 0.22 * (1 - aa)) * (1 + rib * 0.12) * vein;
      const o = i * 4;
      s.rgba[o] = mix(col[0] * sh, s.rgba[o], decay);
      s.rgba[o + 1] = mix(col[1] * sh, s.rgba[o + 1], decay);
      s.rgba[o + 2] = mix(col[2] * sh, s.rgba[o + 2], decay);
      s.h[i] = lay + (1 - aa) * 0.04;
      s.rough[i] = 0.82;
    });
  }
  for (let k = 0; k < 34; k++) {
    const x0 = R.float() * n;
    const y0 = R.float() * n;
    const ang = R.float() * Math.PI * 2;
    const L = n * (0.06 + R.float() * 0.12);
    const w = (1.4 + R.float() * 1.6) * K;
    stroke(s, x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, w, (i, t, kk) => {
      const sh = 0.8 + (1 - kk) * 0.4;
      s.px(i, 74 * sh, 60 * sh, 46 * sh);
      s.h[i] = 0.92 + (1 - kk) * 0.12;
      s.rough[i] = 0.9;
    });
  }
  cavityAO(s, 5, 2.4, 0.45, 0.25);
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

// ── stone helpers (shared rendering pass) ───────────────────────────────────────────────────

/** cheap integer hash of a texel / cell to [0,1) (per-pixel speckle, grains) */
function ih(x: number, y: number, k: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((k | 0) + 0x3c6ef372, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** several low-resolution fields filled by one evaluation per texel (e.g. a worley lookup's channels) */
function multiField(res: number, ch: number, fn: (u: number, v: number, out: Float32Array) => void): Field[] {
  const buf = new Float32Array(res * res * ch);
  const tmp = new Float32Array(ch);
  const inv = 1 / res;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      fn((x + 0.5) * inv, (y + 0.5) * inv, tmp);
      const o = (y * res + x) * ch;
      for (let c = 0; c < ch; c++) buf[o + c] = tmp[c];
    }
  }
  const out: Field[] = [];
  for (let c = 0; c < ch; c++) {
    let k = 0;
    out.push(new Field(res, () => buf[k++ * ch + c]));
  }
  return out;
}

/** 256 fixed pseudo-random plane gradients, indexed by a worley cell id (0..1, 256 distinct values) */
const GRAD_X = new Float32Array(256);
const GRAD_Y = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  GRAD_X[i] = Math.sin(i * 91.7 + 1.3);
  GRAD_Y[i] = Math.cos(i * 53.3 + 2.1);
}
const gidx = (id: number, k: number) => ((id * 255 + 0.5) | 0) + k * 37 & 255;

/** separable box blur with wraparound (two passes ≈ a soft gaussian) */
function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n);
  const dst = new Float32Array(n * n);
  const inv = 1 / (2 * r + 1);
  const add = new Int32Array(n);
  const sub = new Int32Array(n);
  for (let x = 0; x < n; x++) {
    add[x] = wrap(x + r + 1, n);
    sub[x] = wrap(x - r, n);
  }
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + wrap(k, n)];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + add[x]] - src[row + sub[x]];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[wrap(k, n) * n + x];
    for (let y = 0; y < n; y++) {
      dst[y * n + x] = acc * inv;
      acc += tmp[add[y] * n + x] - tmp[sub[y] * n + x];
    }
  }
  return dst;
}

/**
 * Cavity occlusion: how far each texel sits below its blurred neighbourhood (joints, cracks, pits),
 * instead of the absolute height (which turned every low patch into a dark camouflage blotch).
 * Writes s.ao when present; `bake` (0..1) also darkens the albedo by that much of the occlusion so the
 * joints still read under direct light and at a distance (the aoMap only scales indirect light).
 */
function cavityAO(s: Surf, r: number, k: number, lo: number, bake: number): void {
  const n = s.n;
  const R = Math.max(1, Math.round((r * n) / 512));
  const b = boxBlur(boxBlur(s.h, n, R), n, R);
  const ao = s.ao;
  const rgba = s.rgba;
  for (let i = 0; i < n * n; i++) {
    const a = Math.max(lo, Math.min(1, 1 - (b[i] - s.h[i]) * k));
    if (ao) ao[i] = a;
    if (bake > 0) {
      const m = 1 - bake * (1 - a);
      const o = i * 4;
      rgba[o] *= m;
      rgba[o + 1] *= m;
      rgba[o + 2] *= m;
    }
  }
}

/**
 * Granular weathered rock (boulders, the 'rock' terrain layer): faceted plates ~0.5 m with fractures
 * between some of them, small angular fracture scars, salt-and-pepper grains, low-contrast tone and
 * sparse lichen. No baked large-scale shading (the old version read as grey camouflage).
 */
function rock(s: Surf, N: TileNoise, o: { base: C3; lichen: number }): void {
  const warp = fbmF(N, 3, 3, 3);
  const tone = fbmF(N, 3, 3, 3);
  const mid = fbmF(N, 8, 8, 4);
  const crackOn = fbmF(N, 4, 4, 2);
  const lich = fbmF(N, 7, 7, 3);
  const weath = fbmF(N, 4, 4, 3);
  // small fracture facets (~15 cm): a random plane per cell, evaluated at quarter resolution
  const [facetF, scarF, chipF] = multiField(256, 3, (u, v, out) => {
    const w = warp.at(u, v);
    N.worley(u + w * 0.02, v - w * 0.02, 20, 20, 0.9);
    const gi = gidx(N.id, 3);
    out[0] = N.dx * GRAD_X[gi] + N.dy * GRAD_Y[gi];
    out[1] = 1 - sstep(0.0, 0.07, N.f2 - N.f1);
    out[2] = N.id > 0.86 ? 1 : 0;
  });
  fillRange(s, (i, x, y, u, v) => {
    const w = warp.at(u, v);
    N.worley(u + w * 0.05, v + w * 0.05, 6, 6, 0.95);
    const pid = N.id;
    const pe = N.f2 - N.f1;
    const gp = gidx(pid, 1);
    const plane = N.dx * GRAD_X[gp] + N.dy * GRAD_Y[gp];
    const facet = facetF.at(u, v);
    const scar = scarF.at(u, v);
    const crack = (1 - sstep(0.008, 0.04, pe)) * sstep(0.0, 0.3, crackOn.at(u, v));
    const seam = 1 - sstep(0.0, 0.1, pe);
    const grit = N.g(u * 170, v * 170, 170, 170, 13);
    const bump = N.g(u * 60, v * 60, 60, 60, 14);
    const sp = ih(x, y, 3);
    const h = 0.45 + plane * 0.6 + facet * 0.12 + mid.at(u, v) * 0.14 + bump * 0.08 + grit * 0.035 + (sp - 0.5) * 0.025 - crack * 0.38 - seam * 0.05 - scar * 0.04;
    s.h[i] = h;
    // mid-scale contrast (plates, weathered patches) so a big wall is not a flat grey plane at distance
    const dk = sstep(0.05, 0.35, weath.at(u, v));
    let k = (0.86 + tone.at(u, v) * 0.3) * (0.92 + (pid - 0.5) * 0.24) * (1 - dk * 0.22) * (1 + grit * 0.07 + bump * 0.05 + facet * 0.05);
    // salt-and-pepper grains (quartz / feldspar light, mica dark)
    if (sp > 0.92) k *= 1.16 + (sp - 0.92) * 3;
    else if (sp < 0.08) k *= 0.68 + sp * 2.5;
    // fresh, lighter fracture chips on some small facets
    k *= 1 + chipF.at(u, v) * (0.1 + facet * 0.06);
    k *= 1 - crack * 0.5 - scar * 0.06;
    const lm = sstep(0.28, 0.5, lich.at(u, v) + (h - 0.45) * 0.5) * o.lichen;
    const lr = 146 * (0.85 + grit * 0.1);
    s.px(i, mix(o.base[0] * k, lr, lm * 0.55), mix(o.base[1] * k, lr * 1.03, lm * 0.55), mix(o.base[2] * k, lr * 0.88, lm * 0.55));
    s.rough[i] = 0.82 + grit * 0.05 + crack * 0.13 + lm * 0.08 - (sp > 0.92 ? 0.08 : 0);
  });
  cavityAO(s, 6, 2.6, 0.4, 0.25);
}

/**
 * Layered cliff rock (4 m tile, the steep terrain layer and big crags): horizontal beds 0.18–0.6 m with
 * proud hard beds (undercut foot, rounded lip) and recessed soft ones, slanted joints breaking each bed
 * into blocks, angular fracture facets, mineral specks, iron stains and wet seepage running down from
 * the joints. v grows upward (terrain biplanar and box UVs both map v to world height).
 */
function cliff(s: Surf, N: TileNoise): void {
  const n = s.n;
  const K = n / 512;
  const BEDS = 12;
  const bedY: number[] = [0];
  {
    const hs: number[] = [];
    let sum = 0;
    for (let b = 0; b < BEDS; b++) {
      const h = 0.45 + Math.pow(N.cell(b, 2, 31), 1.5) * 1.15;
      hs.push(h);
      sum += h;
    }
    for (let b = 0; b < BEDS; b++) bedY.push(bedY[b] + hs[b] / sum);
    bedY[BEDS] = 1;
  }
  interface Bed { prot: number; hard: number; tone: number; warm: number; js: number[]; slant: number; jw: number; part: number }
  const beds: Bed[] = [];
  for (let b = 0; b < BEDS; b++) {
    const p = N.cell(b, 3, 33);
    const hard = p > 0.42 ? 1 : 0;
    const nj = 2 + Math.floor(N.cell(b, 6, 36) * 5);
    const js: number[] = [];
    let acc = N.cell(b, 8, 38);
    for (let j = 0; j < nj; j++) {
      js.push(fract(acc));
      acc += (0.35 + 1.3 * N.cell(b, j + 20, 39)) / nj;
    }
    js.sort((a, c) => a - c);
    beds.push({
      prot: hard ? 0.18 + p * 0.28 : p * 0.1,
      hard,
      tone: 0.95 + N.cell(b, 4, 34) * 0.08,
      warm: (N.cell(b, 5, 35) - 0.5) * 0.035,
      js,
      slant: (N.cell(b, 7, 37) - 0.5) * 0.12,
      jw: N.cell(b, 9, 40),
      part: 0.25 + 0.75 * N.cell(b, 10, 41),
    });
  }
  const warp = fbmF(N, 2, 2, 3);
  const warp2 = fbmF(N, 7, 4, 2);
  const jWob = fbmF(N, 8, 14, 2);
  const jGate = fbmF(N, 9, 6, 2);
  const relief = fbmF(N, 9, 9, 4);
  const tone = fbmF(N, 3, 3, 3);
  const stain = new Field(256, (u, v) => N.fbm(u, v, 22, 3, 2));
  const lich = fbmF(N, 6, 6, 3);
  const base: C3 = [124, 120, 110];
  // broad fracture planes (~0.7 m) at quarter resolution (in unwarped bed space: smooth enough)
  const [bigPF, bigEF, planeF, scarF] = multiField(256, 4, (u, v, out) => {
    const wv = warp.at(u, v);
    N.worley(u + wv * 0.03, v + wv * 0.035, 6, 7, 0.95);
    const gi = gidx(N.id, 5);
    out[0] = N.dx * GRAD_X[gi] + N.dy * GRAD_Y[gi];
    out[1] = N.f2 - N.f1;
    // small angular scars (~0.25 m) in the warped bed space
    N.worley(u + wv * 0.02, fract(v + wv * 0.035 + warp2.at(u, v) * 0.007), 15, 18, 0.9);
    const gs = gidx(N.id, 9);
    out[2] = N.dx * GRAD_X[gs] + N.dy * GRAD_Y[gs];
    out[3] = 1 - sstep(0.0, 0.05, N.f2 - N.f1);
  });
  fillRange(s, (i, x, y, u, v) => {
    const wv = warp.at(u, v);
    const vw = fract(v + wv * 0.035 + warp2.at(u, v) * 0.007);
    let b = 0;
    while (b < BEDS - 1 && vw >= bedY[b + 1]) b++;
    const bd = beds[b];
    const th = bedY[b + 1] - bedY[b];
    const t = (vw - bedY[b]) / th;
    // nearest joint of this bed: slanted, wobbling, fading out along part of its length
    const uj = fract(u + bd.slant * (t - 0.5) + jWob.at(u, v) * 0.014);
    let dj = 1;
    for (let j = 0; j < bd.js.length; j++) {
      const d = Math.abs(fract(uj - bd.js[j] + 0.5) - 0.5);
      if (d < dj) dj = d;
    }
    const djp = dj * n;
    const gate = sstep(-0.2, 0.25, jGate.at(u, v));
    // angular fracture planes: broad (~0.7 m) and small scars (~0.25 m), a random plane per cell
    const bigP = bigPF.at(u, v);
    const bigE = bigEF.at(u, v);
    const plane = planeF.at(u, v);
    const scar = scarF.at(u, v);
    const grit = N.g(u * 130, vw * 130, 130, 130, 17);
    const sp = ih(x, y, 9);
    const ledge = sstep(0.0, 0.2, t) * (1 - 0.35 * sstep(0.72, 1.0, t));
    const jwid = (0.7 + bd.jw * 1.8) * K;
    const crack = (1 - sstep(jwid * 0.5, jwid + 1.2 * K, djp)) * gate;
    const round = (1 - sstep(0, 9 * K, djp)) * gate;
    const part = (1 - sstep(0.4 * K, 2.0 * K, t * th * n)) * bd.part;
    const bigCrack = (1 - sstep(0.0, 0.025, bigE)) * (1 - gate) * 0.6;
    const h = 0.3 + bd.prot * ledge + relief.at(u, v) * 0.12 + bigP * 0.16 + plane * 0.07 + grit * 0.025 - crack * 0.42 - round * 0.07 - part * 0.22 - scar * 0.025 - bigCrack * 0.2;
    s.h[i] = h;
    let k = bd.tone * (0.92 + tone.at(u, v) * 0.2) * (1 + grit * 0.06 + bigP * 0.05 + plane * 0.03);
    // proud beds: dusty tops, dark undersides
    k *= 1 + 0.05 * sstep(0.6, 1, t) * bd.hard - 0.08 * (1 - sstep(0, 0.25, t)) * bd.hard;
    if (sp > 0.992) k *= 1.2;
    else if (sp < 0.006) k *= 0.75;
    else k *= 0.97 + sp * 0.06;
    k *= 1 - crack * 0.28 - part * 0.1 - scar * 0.04 - bigCrack * 0.16;
    const st = stain.at(u, vw);
    // iron staining bleeding down the joints, dark wet seepage in streaks
    const jf = 1 - sstep(0, 44 * K, djp);
    const iron = sstep(0.12, 0.55, st) * (jf * jf * gate + 0.3 * sstep(0.75, 1, t)) * 0.4;
    const wet = sstep(0.35, 0.65, -st) * 0.16;
    k *= 1 - wet;
    let r = base[0] * k * (1 + bd.warm);
    let g = base[1] * k;
    let bl = base[2] * k * (1 - bd.warm);
    r = mix(r, 132 * k, iron);
    g = mix(g, 102 * k, iron);
    bl = mix(bl, 76 * k, iron);
    const lm = sstep(0.25, 0.5, lich.at(u, v)) * sstep(0.5, 0.8, t) * (0.4 + 0.6 * bd.hard) * 0.45;
    s.px(i, mix(r, 150, lm), mix(g, 154, lm), mix(bl, 134, lm));
    s.rough[i] = 0.86 + grit * 0.04 + crack * 0.1 - bigP * 0.03 - wet * 0.5 + lm * 0.08;
  });
  cavityAO(s, 8, 2.2, 0.35, 0.18);
}

/**
 * Cobbles: separate rounded stones 12–24 cm (grey, grey-green, buff) set in gravelly soil with moss in
 * the damp joints, not a dark-lined voronoi tile.
 */
function cobble(s: Surf, N: TileNoise): void {
  const warp = fbmF(N, 4, 4, 2);
  const moss = fbmF(N, 6, 6, 3);
  const tone = fbmF(N, 3, 3, 2);
  const pal: C3[] = [[114, 116, 110], [98, 106, 96], [126, 120, 106], [92, 95, 93], [136, 132, 120], [106, 102, 90]];
  fillRange(s, (i, x, y, u, v) => {
    const w = warp.at(u, v);
    N.worley(u + w * 0.03, v + w * 0.03, 9, 11, 0.85);
    const f1 = N.f1;
    const id = N.id;
    const sdx = N.dx;
    const sdy = N.dy;
    const edge = Math.min(N.f2 - f1, (0.6 - f1) * 1.6);
    const st = sstep(0.06, 0.13, edge);
    const dome = Math.pow(sstep(0.06, 0.45, edge), 0.55);
    const grit = N.g(u * 140, v * 140, 140, 140, 19);
    const sp = ih(x, y, 11);
    const c = pal[Math.floor(id * pal.length) % pal.length];
    let k = (0.92 + tone.at(u, v) * 0.08) * (0.86 + dome * 0.18) * (1 + grit * 0.07 + (sdx * 0.6 - sdy * 0.4) * 0.05);
    if (sp > 0.95) k *= 1.14;
    else if (sp < 0.05) k *= 0.8;
    const ms = sstep(0.0, 0.42, moss.at(u, v));
    let jr = mix(80, 62, ms);
    let jg = mix(70, 76, ms);
    let jb = mix(54, 36, ms);
    let jh = 0.08 + grit * 0.03;
    if (st < 0.99) {
      // grit and small pebbles in the joints
      N.worley(u, v, 48, 48, 1);
      const peb = (1 - sstep(0.16, 0.3, N.f1)) * (N.id > 0.72 ? 1 : 0);
      const pk = 0.7 + N.id * 0.35;
      jr = mix(jr, 112 * pk, peb);
      jg = mix(jg, 106 * pk, peb);
      jb = mix(jb, 94 * pk, peb);
      jh += peb * 0.1;
    }
    // moss creeping over the stone feet in the damp patches
    const edgeMoss = ms * (1 - sstep(0.13, 0.26, edge)) * 0.6;
    const r = mix(c[0] * k, 70, edgeMoss);
    const g = mix(c[1] * k, 80, edgeMoss);
    const b = mix(c[2] * k, 40, edgeMoss);
    s.px(i, mix(jr, r, st), mix(jg, g, st), mix(jb, b, st));
    s.h[i] = mix(jh, 0.35 + dome * 0.55 + grit * 0.025, st);
    s.rough[i] = mix(0.95, 0.84 - dome * 0.1 + grit * 0.05 + edgeMoss * 0.1, st);
  });
  cavityAO(s, 6, 2.2, 0.35, 0.3);
}

/**
 * Ashlar (3 m tile): irregular course heights (0.3–0.62 m) and block lengths (0.6–1.25 m), recessed
 * mortar a little darker and browner than the stone (its depth comes from the normal and AO, not an ink
 * line), chipped arrises, flaking terraces on the faces, per-block colour, weathered patches, seepage
 * below the joints and splash grime at the foot of each block. v grows upward.
 */
function stoneBlocks(s: Surf, N: TileNoise, o: { rows: number; base: C3; var: number; mortar: C3 }): void {
  const n = s.n;
  const K = n / 512;
  const rows = o.rows;
  const rowY: number[] = [0];
  {
    const hs: number[] = [];
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      const h = 0.7 + N.cell(r, 1, 3) * 0.6;
      hs.push(h);
      sum += h;
    }
    for (let r = 0; r < rows; r++) rowY.push(rowY[r] + hs[r] / sum);
    rowY[rows] = 1;
  }
  // per block: id (tone), warm/cool shift, whether water seeps down its face
  const rowsDef: { start: number; cum: number[]; bid: number[]; warm: number[]; seep: number[] }[] = [];
  for (let r = 0; r < rows; r++) {
    const ls: number[] = [];
    let tot = 0;
    while (tot < 0.88 || ls.length < 2) {
      const l = 0.2 + N.cell(r, ls.length + 10, 5) * 0.22;
      ls.push(l);
      tot += l;
    }
    const cum = [0];
    const bid: number[] = [];
    const warm: number[] = [];
    const seep: number[] = [];
    for (let b = 0; b < ls.length; b++) {
      cum.push(cum[b] + ls[b] / tot);
      bid.push(N.cell(r * 7 + b, r + 3, 11));
      warm.push((N.cell(r * 7 + b, r + 3, 13) - 0.5) * 0.05);
      seep.push(N.cell(r * 7 + b, r + 3, 17) > 0.5 ? 1 : 0.25);
    }
    cum[ls.length] = 1;
    rowsDef.push({ start: N.cell(r, 9, 7), cum, bid, warm, seep });
  }
  const relief = fbmF(N, 10, 10, 3);
  const spallF = fbmF(N, 7, 7, 4);
  const mott = fbmF(N, 16, 16, 3);
  const patchF = fbmF(N, 5, 5, 3);
  const chipF = fbmF(N, 24, 24, 2);
  const streakF = new Field(256, (u, v) => N.fbm(u, v, 28, 2, 2));
  const rc = 5 * K;
  fillRange(s, (i, x, y, u, v) => {
    let r = 0;
    while (r < rows - 1 && v >= rowY[r + 1]) r++;
    const rd = rowsDef[r];
    const up = fract(u - rd.start);
    const nb = rd.cum.length - 1;
    let b = 0;
    while (b < nb - 1 && up >= rd.cum[b + 1]) b++;
    const ch = (rowY[r + 1] - rowY[r]) * n;
    const dx0 = (up - rd.cum[b]) * n;
    const dx1 = (rd.cum[b + 1] - up) * n;
    const dy0 = (v - rowY[r]) * n;
    const dy1 = (rowY[r + 1] - v) * n;
    const dxp = Math.min(dx0, dx1);
    const dyp = Math.min(dy0, dy1);
    const qx = rc - dxp;
    const qy = rc - dyp;
    const dEdge = qx > 0 && qy > 0 ? rc - Math.sqrt(qx * qx + qy * qy) : Math.min(dxp, dyp);
    const bid = rd.bid[b];
    const cf = chipF.at(u, v);
    const e = dEdge - (1.6 + (cf * 0.5 + 0.5) * 0.9) * K;
    const grit = N.g(u * 150, v * 150, 150, 150, 23);
    const sp = ih(x, y, 5);
    const bu = u + bid * 0.37;
    const bv = v + bid * 0.61;
    const spv = spallF.at(bu, bv);
    const sp1 = sstep(0.14, 0.18, spv);
    const sp2 = sstep(0.4, 0.44, spv);
    const chipW = (1.2 + 10 * sstep(-0.15, 0.45, cf)) * K;
    const chip = e < 0 ? 0 : 1 - sstep(chipW - 1.0 * K, chipW + 0.4 * K, e);
    const bevel = sstep(-0.6 * K, 1.8 * K, e);
    // dressed faces bulge a little toward the middle (pillowed ashlar), with broken, flaky relief
    const pillow = sstep(0, Math.min(0.35 * ch, 40 * K), e);
    const faceH = 0.74 + pillow * 0.12 + relief.at(bu, bv) * 0.15 - sp1 * 0.11 - sp2 * 0.08 + grit * 0.03 - chip * 0.26;
    const mortarH = 0.16 + grit * 0.04 + (sp - 0.5) * 0.04;
    s.h[i] = mix(mortarH, faceH, bevel);
    // per-block colour, mottling, weathered patches, fresh light stone where it flaked or chipped
    const warm = rd.warm[b];
    const pd = sstep(0.15, 0.55, patchF.at(bu * 0.7 + 0.3, bv));
    const mt = mott.at(u, v);
    let k = (1 + (bid - 0.5) * o.var * 1.4) * (1 + mt * 0.09) * (1 - pd * 0.15) * (1 + sp1 * 0.05 + sp2 * 0.03 + chip * 0.07) * (1 + grit * 0.04 + (sp - 0.5) * 0.06);
    // seepage below each block's top joint fading down the face, splash grime at its foot
    const st = sstep(0.05, 0.55, streakF.at(u, v));
    const seep = st * rd.seep[b] * (Math.exp(-dy1 / (0.4 * ch)) * 0.16 + 0.04);
    const foot = (1 - sstep(0, 0.35 * ch, dy0)) * 0.07;
    k *= 1 - seep - foot;
    const fr = o.base[0] * k * (1 + warm) * (1 - pd * 0.02);
    const fg = o.base[1] * k;
    const fb = o.base[2] * k * (1 - warm);
    const mk = 0.9 + grit * 0.08 + sp * 0.1;
    s.px(i, mix(o.mortar[0] * mk, fr, bevel), mix(o.mortar[1] * mk, fg, bevel), mix(o.mortar[2] * mk, fb, bevel));
    s.rough[i] = mix(0.93, 0.8 + mt * 0.04 + grit * 0.04 - sp1 * 0.03 - chip * 0.05 - seep * 0.3, bevel);
  });
  // gentle: the joints read through the normal map and a soft occlusion, never as ink lines
  cavityAO(s, 7, 1.7, 0.62, 0.1);
}

/**
 * Carved Moria stone. `weathered` (the 'dwarven_stone_weathered' set): lower albedo contrast, no
 * polish, tarnished inlay, and a grime layer (soot pooled in the grooves, blotches and vertical
 * seepage streaks) so long walls do not read as a clean, high-contrast tile.
 */
function dwarvenStone(s: Surf, N: TileNoise, weathered = false): void {
  const vein = fbmF(N, 4, 4, 4);
  const mott = fbmF(N, 10, 10, 3);
  const blot = weathered ? fbmF(N, 3, 3, 4) : null;
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
    if (!weathered) {
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
      return;
    }
    // ── weathered ──
    const pit = N.g(u * 64, v * 64, 64, 64, 37);
    h -= sstep(0.45, 0.8, pit) * 0.05; // pitting
    s.h[i] = h;
    const streak = sstep(0.1, 0.75, N.g(u * 14, v * 2, 14, 2, 31) * 0.7 + N.g(u * 29, v * 3, 29, 3, 33) * 0.3);
    const bl = blot!.at(u, v);
    const grime = Math.min(1, sstep(-0.35, 0.45, bl) * 0.7 + groove * 0.55 + streak * 0.45 + sstep(0.5, 0.9, pit) * 0.25);
    const base = 0.92 + ve * 0.1 + grain * 0.05;
    let r = 60 * base * (1 - groove * 0.3);
    let g = 61 * base * (1 - groove * 0.3);
    let b = 65 * base * (1 - groove * 0.28);
    if (inlay > 0) {
      r = mix(r, 74, 0.3);
      g = mix(g, 66, 0.3);
      b = mix(b, 50, 0.3);
    }
    r = mix(r, 33, grime * 0.75);
    g = mix(g, 30, grime * 0.75);
    b = mix(b, 26, grime * 0.75);
    s.px(i, r, g, b);
    s.rough[i] = Math.min(0.98, 0.62 + grain * 0.08 + groove * 0.18 + grime * 0.18 + Math.abs(mott.at(u, v)) * 0.08);
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
/**
 * Boards: long fibrous grain along the board (no drawn contour rings), a soft low-contrast figure,
 * per-board tone, cupped edges, dark-brown (not black) joints, checks along the grain, darker end grain,
 * silvering and raised grain with `wear`, nail heads with a rust halo.
 */
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
  const wearF = fbmF(N, 5, 14, 3);
  const figF = fbmF(N, 2, 4, 2);
  const tone = fbmF(N, 3, 6, 2);
  const crackGate = fbmF(N, 3, 12, 2);
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
    const fu = fract(u + pid);
    // fibres: long streaks along the board, plus fine ones
    const f1 = N.g(fu * 4, wy * 60, 4, 60, 31);
    const f2 = N.g(fu * 10, wy * 240, 10, 240, 32);
    const fib = f1 * 0.6 + f2 * 0.4;
    const fig = Math.sin((fv * 3 + figF.at(fu, wy) * 2.5 + pid * 5) * Math.PI * 2) * 0.5 + 0.5;
    lc(o.dark, o.light, clamp01(0.45 + fib * 0.35 + (fig - 0.5) * 0.12 + (pid - 0.5) * 0.18 + tone.at(u, v) * 0.1));
    let k = 0.94 + (pid - 0.5) * 0.1;
    let knot = 0;
    if (N.cell(row, seg, 43) > 0.6) {
      const dxk = fract(u - N.cell(row, seg, 41) + 0.5) - 0.5;
      const dyk = (fv - (0.25 + N.cell(row, seg, 42) * 0.5)) / P;
      const dk = Math.hypot(dxk * 0.6, dyk) * 40;
      knot = Math.exp(-dk * dk * 0.5);
      k *= 1 - knot * 0.35;
    }
    let r = cr * k;
    let g = cg * k;
    let b = cb * k;
    const gw = o.wear > 0 ? clamp01((0.35 + 0.65 * (wearF.at(u, v) * 0.5 + 0.5)) * o.wear) : 0;
    if (gw > 0) {
      const lum = (r + g + b) / 3;
      r = mix(r, lum * 1.0, gw);
      g = mix(g, lum * 0.98, gw);
      b = mix(b, lum * 0.93, gw);
    }
    const gapY = Math.min(fv, 1 - fv) * (n / P);
    const gap = Math.max(1 - sstep(o.gap * K * 0.4, o.gap * K * 1.4, gapY), 1 - sstep(o.gap * K * 0.3, o.gap * K, jointDist));
    const chk = Math.abs(N.g(fu * 2, wy * 90, 2, 90, 37));
    const crk = o.crack * (1 - sstep(0.0, 0.022, chk)) * sstep(0.05, 0.35, crackGate.at(fu, wy));
    // fine dark grain lines (zero crossings of a strongly stretched noise)
    const line = (1 - sstep(0.0, 0.07, Math.abs(N.g(fu * 6, wy * 320, 6, 320, 33)))) * 0.22;
    const endDark = (1 - sstep(0, 10 * K, jointDist)) * 0.15;
    const dark = Math.min(1, gap * 0.75 + crk * 0.5);
    const kk = (1 - dark) * (1 - endDark) * (1 - line);
    r = mix(r * kk, 40, gap * 0.4);
    g = mix(g * kk, 32, gap * 0.4);
    b = mix(b * kk, 26, gap * 0.4);
    let nail = 0;
    let halo = 0;
    if (o.nails) {
      const near = Math.min(Math.abs(fv - 0.25), Math.abs(fv - 0.75)) * (n / P);
      if (jointDist > 3 * K && jointDist < 11 * K) {
        const dn = Math.sqrt((jointDist - 7 * K) * (jointDist - 7 * K) + near * near);
        nail = 1 - sstep(1.2 * K, 2.4 * K, dn);
        halo = (1 - sstep(2 * K, 6 * K, dn)) * 0.35;
      }
    }
    r = mix(mix(r, r * 0.8 + 18, halo), 54, nail);
    g = mix(mix(g, g * 0.72, halo), 46, nail);
    b = mix(mix(b, b * 0.6, halo), 40, nail);
    s.px(i, r, g, b);
    const cup = sstep(0, 0.25, Math.min(fv, 1 - fv));
    s.h[i] = 0.55 + fib * 0.06 * (1 + gw * 1.5) + cup * 0.08 - dark * 0.45 - line * 0.12 + nail * 0.05 - knot * 0.03;
    s.rough[i] = 0.74 + fib * 0.06 + o.wear * 0.15 - nail * 0.3;
  });
  cavityAO(s, 5, 2.4, 0.4, 0.15);
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

/**
 * Wind-packed snow (3 m tile): soft drifts, asymmetric wind ripples (~12 cm spacing, gentle windward
 * slope, steep lee) that fade in and out in patches, a faint cool-grey occlusion on the lee faces and in
 * the troughs (the blue comes from the sky light, not the albedo), grain noise and sparse glints.
 */
function snow(s: Surf, N: TileNoise, R: Rng): void {
  void R;
  const drift = fbmF(N, 3, 3, 4);
  const warpR = fbmF(N, 3, 4, 3);
  const ampF = fbmF(N, 4, 4, 2);
  const fineF = fbmF(N, 12, 12, 2);
  const RIP = 26;
  fillRange(s, (i, x, y, u, v) => {
    const dr = drift.at(u, v);
    const ph = v * RIP + u * 2 + warpR.at(u, v) * 2.2;
    const f = ph - Math.floor(ph);
    const prof = f < 0.7 ? sstep(0, 0.7, f) : 1 - sstep(0.7, 1.0, f);
    const amp = sstep(-0.35, 0.45, ampF.at(u, v));
    const g = N.g(u * 90, v * 90, 90, 90, 41);
    const sp = ih(x, y, 7);
    s.h[i] = dr * 0.6 + prof * 0.3 * amp + fineF.at(u, v) * 0.06 + g * 0.05;
    const lee = (f >= 0.7 ? 1 - prof : 0) * amp;
    const k = 0.985 + dr * 0.025 + g * 0.012 - lee * 0.05 - (1 - prof) * amp * 0.015;
    if (sp > 0.994) s.px(i, 252, 253, 255);
    else s.px(i, 226 * k, 231 * k, 234 * k);
    s.rough[i] = sp > 0.994 ? 0.22 : 0.7 + (1 - prof) * amp * 0.1 + g * 0.05 - prof * amp * 0.06;
  });
  cavityAO(s, 10, 1.6, 0.75, 0.12);
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
  bark: { normal: 5.5, ao: true, fn: (s, N) => bark(s, N, { dark: [34, 27, 21], mid: [110, 90, 72], lichen: [126, 132, 112], lichenAmt: 0.2 }) },
  mossy_bark: { normal: 3.2, ao: true, fn: mossyBark },
  birch_bark: { normal: 1.6, ao: true, fn: birch },
  bone: { normal: 1.8, ao: true, fn: bone },
  leaves: { normal: 3.2, ao: true, fn: leafLitter },
  grass: { normal: 2.2, ao: true, fn: grass },
  forest_floor: { normal: 3.0, ao: true, fn: forestFloor },
  mud: { normal: 3.0, ao: true, fn: mud },
  dirt: { normal: 3.0, ao: true, fn: dirt },
  rock: { normal: 4.0, ao: true, fn: (s, N) => rock(s, N, { base: [128, 126, 118], lichen: 0.3 }) },
  cliff: { normal: 4.4, ao: true, fn: cliff },
  cobble: { normal: 4.8, ao: true, fn: cobble },
  stone_blocks: { normal: 3.6, ao: true, fn: (s, N) => stoneBlocks(s, N, { rows: 7, base: [138, 133, 120], var: 0.26, mortar: [120, 112, 99] }) },
  dwarven_stone: { normal: 4.0, ao: true, fn: (s, N) => dwarvenStone(s, N) },
  dwarven_stone_weathered: { normal: 3.4, ao: true, fn: (s, N) => dwarvenStone(s, N, true) },
  marble: { normal: 0.8, ao: true, fn: marble },
  wood_planks: {
    normal: 3.0,
    ao: true,
    fn: (s, N) => planks(s, N, { rows: 6, light: [178, 136, 94], dark: [104, 74, 48], gap: 1.6, crack: 0.5, wear: 0.15, nails: true }),
  },
  old_wood: {
    normal: 3.4,
    ao: true,
    fn: (s, N) => planks(s, N, { rows: 6, light: [150, 134, 112], dark: [80, 70, 58], gap: 2.4, crack: 1.0, wear: 0.45, nails: true }),
  },
  shingles: { normal: 3.6, ao: true, fn: shingles },
  thatch: { normal: 2.8, ao: true, fn: thatch },
  snow: { normal: 4.0, ao: true, fn: snow },
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
