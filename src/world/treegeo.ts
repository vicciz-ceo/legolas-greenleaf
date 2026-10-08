/**
 * Procedural tree geometry: tapered tubes with root flare / buttress roots / gnarled lumps for bark,
 * leaf cards (atlas sprigs with canopy-sphere normals) for foliage, hanging vines and old webs.
 * Output geometries carry position, normal, uv, aWind(vec2) and (leaves) color.
 */
import * as THREE from 'three';
import { Rng, noise2 } from '../core/rng';
import { cellRect, LEAF_CELLS } from './leafAtlas';

export type TreeKind = 'mirkwood_oak' | 'beech' | 'pine' | 'dead' | 'birch';

export interface TreeGeo {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry | null;
  /** old webs (alpha blended, double sided) */
  webs: THREE.BufferGeometry | null;
  height: number;
  /** trunk radius at the base (m, without flare) */
  trunkR: number;
  /** collision radius at 1.2 m */
  colliderR: number;
  crownR: number;
}

type V3 = [number, number, number];

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  wind: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  toGeometry(withColor: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 2));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface TubeOpts {
  seg: number;
  /** metres per bark tile */
  tile: number;
  /** tree height for the wind weight */
  windH: number;
  /** radial lump amplitude (fraction of radius) */
  lump?: number;
  lumpSeed?: number;
  /** wind weight multiplier (hanging vines use their own) */
  windScale?: number;
  /** override wind weight along the tube (0..1 parameter -> weight) */
  windFn?: (t: number, y: number) => number;
  capStart?: boolean;
  uOffset?: number;
}

/** sweep a circle along a polyline */
function tube(buf: Buf, pts: V3[], radii: number[], o: TubeOpts): void {
  const n = pts.length;
  if (n < 2) return;
  const seg = o.seg;
  const lump = o.lump ?? 0;
  const ls = o.lumpSeed ?? 0;
  const base = buf.count;
  let T: V3 = norm(sub(pts[1], pts[0]));
  let N: V3 = Math.abs(T[1]) < 0.95 ? norm(cross(T, [0, 1, 0])) : norm(cross(T, [1, 0, 0]));
  let dist = 0;
  const tangents: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    tangents.push(norm(sub(b, a)));
  }
  for (let i = 0; i < n; i++) {
    T = tangents[i];
    // parallel transport
    N = norm(sub(N, mul(T, dot(N, T))));
    const B = cross(T, N);
    if (i > 0) dist += len(sub(pts[i], pts[i - 1]));
    const r = radii[i];
    const rNext = radii[Math.min(n - 1, i + 1)];
    const rPrev = radii[Math.max(0, i - 1)];
    const segLen = Math.max(1e-3, len(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
    const drds = (rNext - rPrev) / segLen;
    const nTiles = Math.max(1, Math.round((Math.PI * 2 * r) / o.tile));
    const t01 = i / (n - 1);
    const ww = o.windFn ? o.windFn(t01, pts[i][1]) : Math.min(1, Math.max(0, pts[i][1] / o.windH)) * (o.windScale ?? 1);
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const rr = r * (1 + lump * (Math.sin(th * 3 + ls + pts[i][1] * 0.45) * 0.5 + Math.sin(th * 5 - ls * 1.7 + pts[i][1] * 0.8) * 0.3 + Math.sin(th * 2 + ls * 0.6) * 0.4));
      const rad: V3 = [N[0] * c + B[0] * s, N[1] * c + B[1] * s, N[2] * c + B[2] * s];
      buf.pos.push(pts[i][0] + rad[0] * rr, pts[i][1] + rad[1] * rr, pts[i][2] + rad[2] * rr);
      const nn = norm(sub(rad, mul(T, drds)));
      buf.nor.push(nn[0], nn[1], nn[2]);
      buf.uv.push((k / seg) * nTiles + (o.uOffset ?? 0), dist / o.tile);
      buf.wind.push(ww, 0);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k;
      const b = a + 1;
      const c = a + (seg + 1);
      const d = c + 1;
      buf.idx.push(a, c, b, b, c, d);
    }
  }
  if (o.capStart) {
    // closed fan at the end (broken stubs)
    const last = base + (n - 1) * (seg + 1);
    const cIdx = buf.count;
    const p = pts[n - 1];
    buf.pos.push(p[0], p[1], p[2]);
    const tt = tangents[n - 1];
    buf.nor.push(tt[0], tt[1], tt[2]);
    buf.uv.push(0.5, dist / o.tile);
    buf.wind.push(Math.min(1, Math.max(0, p[1] / o.windH)), 0);
    for (let k = 0; k < seg; k++) buf.idx.push(last + k, last + k + 1, cIdx);
  }
}

/** a quad card holding one atlas cell. base = stem root, up = growth direction (unit), side = width direction */
function card(
  buf: Buf, cell: number, base: V3, up: V3, side: V3, length: number, width: number, nrm: V3, windW: number, flutter: number, tint: [number, number, number],
): void {
  const [u0, v0, u1, v1] = cellRect(cell);
  const i0 = buf.count;
  const hw = width / 2;
  const tip = add(base, mul(up, length));
  const corners: V3[] = [sub(base, mul(side, hw)), add(base, mul(side, hw)), add(tip, mul(side, hw)), sub(tip, mul(side, hw))];
  const uvs: [number, number][] = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
  for (let k = 0; k < 4; k++) {
    buf.pos.push(corners[k][0], corners[k][1], corners[k][2]);
    buf.nor.push(nrm[0], nrm[1], nrm[2]);
    buf.uv.push(uvs[k][0], uvs[k][1]);
    buf.wind.push(windW, flutter * (k < 2 ? 0.35 : 1));
    buf.col.push(tint[0], tint[1], tint[2]);
  }
  buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
}

interface CardCtx {
  leaves: Buf;
  rng: Rng;
  center: V3;
  crownR: number;
  H: number;
  cell: number;
  /** card length range */
  size: [number, number];
  tints: [number, number, number][];
  /** 0..1 how much normals follow the canopy sphere (rest = up) */
  sphere: number;
  flutter: number;
}

function addLeafCard(c: CardCtx, p: V3, dir: V3, scale = 1): void {
  const rng = c.rng;
  const L = (c.size[0] + rng.float() * (c.size[1] - c.size[0])) * scale;
  // growth direction: along dir with some upward bias and random roll
  const up = norm(add(mul(dir, 0.7), [rng.float() - 0.5, rng.float() * 0.5 - 0.15, rng.float() - 0.5]));
  let side = cross(up, [rng.float() - 0.5, 1, rng.float() - 0.5]);
  if (len(side) < 1e-3) side = [1, 0, 0];
  side = norm(side);
  const mid = add(p, mul(up, L * 0.5));
  const away = norm(sub(mid, c.center));
  const nrm = norm(add(mul(away, c.sphere), mul([0, 1, 0], 1 - c.sphere * 0.7)));
  const tint = c.tints[Math.floor(rng.float() * c.tints.length)];
  const j = 0.85 + rng.float() * 0.3;
  card(c.leaves, c.cell, p, up, side, L, L * 0.95, nrm, Math.min(1, Math.max(0, p[1] / c.H)), c.flutter, [tint[0] * j, tint[1] * j, tint[2] * j]);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// branch growth
// ───────────────────────────────────────────────────────────────────────────────────────────

interface BranchOpts {
  start: V3;
  dir: V3;
  length: number;
  r0: number;
  r1: number;
  step: number;
  /** gravity bend per step (negative = droop), applied to dir.y */
  bend: number;
  /** random turn per step (radians) */
  wiggle: number;
  seg: number;
  depth: number;
}

function growBranch(rng: Rng, o: BranchOpts): { pts: V3[]; radii: number[] } {
  const n = Math.max(2, Math.round(o.length / o.step));
  const pts: V3[] = [o.start];
  const radii: number[] = [o.r0];
  let d = norm(o.dir);
  let p = o.start;
  for (let i = 1; i <= n; i++) {
    d = norm([d[0] + (rng.float() - 0.5) * o.wiggle, d[1] + o.bend + (rng.float() - 0.5) * o.wiggle * 0.6, d[2] + (rng.float() - 0.5) * o.wiggle]);
    p = add(p, mul(d, o.length / n));
    pts.push(p);
    const t = i / n;
    radii.push(o.r0 + (o.r1 - o.r0) * Math.pow(t, 0.8));
  }
  return { pts, radii };
}

const TINT_LIGHT: [number, number, number][] = [[1.05, 1.08, 0.9], [0.95, 1.0, 0.85], [1.1, 1.05, 0.8], [0.85, 0.95, 0.8]];
const TINT_DARK: [number, number, number][] = [[0.55, 0.62, 0.5], [0.45, 0.52, 0.42], [0.62, 0.64, 0.46], [0.4, 0.46, 0.4]];
const TINT_GOLD: [number, number, number][] = [[1.2, 1.1, 0.7], [1.0, 1.0, 0.65], [1.1, 0.95, 0.6], [0.95, 1.05, 0.75]];
const TINT_PINE: [number, number, number][] = [[0.85, 0.95, 0.9], [0.75, 0.88, 0.8], [0.9, 0.98, 0.85]];

function ringLerp(pts: V3[], t: number): V3 {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  return lerp3(pts[i], pts[i + 1], f - i);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// buttress roots
// ───────────────────────────────────────────────────────────────────────────────────────────

function roots(buf: Buf, rng: Rng, r0: number, count: number, spread: number, tile: number, H: number, seg: number, lod: number): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.float() * 0.6;
    const L = r0 * (spread * (0.8 + rng.float() * 0.7));
    const pts: V3[] = [];
    const radii: number[] = [];
    const steps = lod === 0 ? 7 : 4;
    let px = Math.cos(a) * r0 * 0.5;
    let pz = Math.sin(a) * r0 * 0.5;
    const rw = r0 * (0.28 + rng.float() * 0.14);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const ang = a + Math.sin(t * 5 + i) * 0.18;
      px = Math.cos(ang) * (r0 * 0.5 + L * t);
      pz = Math.sin(ang) * (r0 * 0.5 + L * t);
      // arches up near the trunk, dives into the soil
      const y = (r0 * 1.15) * Math.pow(1 - t, 1.8) + 0.12 * (1 - t) - t * t * 0.55;
      pts.push([px, y, pz]);
      radii.push(rw * (1 - t * 0.78) + 0.04);
    }
    tube(buf, pts, radii, { seg, tile, windH: H, lump: 0.1, lumpSeed: i * 3.7, windScale: 0 });
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// kinds
// ───────────────────────────────────────────────────────────────────────────────────────────

function finish(bark: Buf, leaves: Buf | null, webs: Buf | null, H: number, r0: number, crownR: number): TreeGeo {
  return {
    bark: bark.toGeometry(false),
    leaves: leaves && leaves.count ? leaves.toGeometry(true) : null,
    webs: webs && webs.count ? webs.toGeometry(false) : null,
    height: H,
    trunkR: r0,
    colliderR: r0 * 0.85,
    crownR,
  };
}

function trunkProfile(rng: Rng, H: number, r0: number, top: number, flare: number, wobble: number, step: number, seed: number): { pts: V3[]; radii: number[] } {
  const n = Math.max(3, Math.round(top / step));
  const pts: V3[] = [];
  const radii: number[] = [];
  const nx = noise2(seed * 7 + 1);
  const nz = noise2(seed * 7 + 2);
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * top - (i === 0 ? 0.5 : 0);
    const t = Math.max(0, y) / H;
    const w = wobble * r0 * Math.pow(t * 2.2, 0.8);
    pts.push([nx(y * 0.07, 3.3) * w * 2, y, nz(y * 0.07, 9.1) * w * 2]);
    const taper = 1 - 0.5 * Math.pow(t * (H / top), 0.9);
    radii.push(r0 * Math.max(0.2, taper) * (1 + flare * Math.exp(-Math.max(0, y) / (r0 * 0.9 + 0.8))));
  }
  void rng;
  return { pts, radii };
}

function buildMirkwoodOak(rng: Rng, lod: number, seed: number): TreeGeo {
  const bark = new Buf();
  const leaves = new Buf();
  const webs = new Buf();
  const H = 38 + rng.float() * 9;
  const r0 = 1.45 + rng.float() * 1.5;
  const tile = 2.4;
  const seg = lod === 0 ? 20 : 9;
  const top = H * 0.62;
  const prof = trunkProfile(rng, H, r0, top, 0.55, 0.28, lod === 0 ? 2.0 : 4.0, seed);
  tube(bark, prof.pts, prof.radii, { seg, tile, windH: H, lump: 0.12, lumpSeed: seed, windScale: 0.6 });
  roots(bark, rng, r0 * 1.15, lod === 0 ? 8 : 5, 2.6, tile, H, lod === 0 ? 8 : 5, lod);
  const crownR = 14;
  const center: V3 = [0, H * 0.68, 0];
  const lc: CardCtx = {
    leaves, rng, center, crownR, H, cell: LEAF_CELLS.mirk, size: lod === 0 ? [2.4, 3.8] : [4, 6.2], tints: TINT_DARK, sphere: 0.85, flutter: 0.5,
  };
  const limbs = lod === 0 ? 9 + Math.floor(rng.float() * 3) : 7;
  const anchors: V3[] = [];
  for (let i = 0; i < limbs; i++) {
    const lr = new Rng(seed * 7919 + i * 131 + 17);
    lc.rng = lr;
    const t = 0.32 + (i / limbs) * 0.55 + (lr.float() - 0.5) * 0.05;
    const y = t * H;
    const base = ringLerp(prof.pts, Math.min(1, y / top));
    const rTrunk = prof.radii[Math.min(prof.radii.length - 1, Math.round((y / top) * (prof.radii.length - 1)))];
    const az = i * 2.399 + lr.float() * 0.6;
    const out = 0.9 + lr.float() * 0.5;
    const up = 0.12 + lr.float() * 0.45 + (t > 0.7 ? 0.5 : 0);
    const dir = norm([Math.cos(az) * out, up, Math.sin(az) * out]);
    const L = (7 + lr.float() * 8) * (1 - Math.abs(t - 0.5) * 0.5);
    const rb = Math.max(0.22, rTrunk * (0.3 + lr.float() * 0.1));
    const startP: V3 = [base[0] + Math.cos(az) * rTrunk * 0.4, y, base[2] + Math.sin(az) * rTrunk * 0.4];
    const br = growBranch(lr, { start: startP, dir, length: L, r0: rb, r1: rb * 0.18, step: lod === 0 ? 1.7 : 3.4, bend: -0.035, wiggle: 0.5, seg: 8, depth: 1 });
    tube(bark, br.pts, br.radii, { seg: lod === 0 ? 9 : 6, tile, windH: H, lump: 0.1, lumpSeed: i * 5.1, windScale: 1 });
    anchors.push(br.pts[Math.floor(br.pts.length * 0.5)]);
    // sub branches and leaves
    const subs = lod === 0 ? 4 : 2;
    for (let s = 0; s < subs; s++) {
      const bt = 0.3 + (s / subs) * 0.6;
      const bp = ringLerp(br.pts, bt);
      const sd = norm([dir[0] + (lr.float() - 0.5) * 1.6, dir[1] + (lr.float() - 0.2) * 0.8, dir[2] + (lr.float() - 0.5) * 1.6]);
      const sl = 3 + lr.float() * 4.5;
      const sr = rb * 0.3;
      const sbr = growBranch(lr, { start: bp, dir: sd, length: sl, r0: sr, r1: 0.04, step: 1.3, bend: -0.04, wiggle: 0.6, seg: 5, depth: 2 });
      tube(bark, sbr.pts, sbr.radii, { seg: lod === 0 ? 5 : 4, tile, windH: H, windScale: 1.15 });
      const nCards = lod === 0 ? 6 : 2;
      for (let k = 0; k < nCards; k++) addLeafCard(lc, ringLerp(sbr.pts, 0.35 + (k / nCards) * 0.65), norm(sub(sbr.pts[sbr.pts.length - 1], sbr.pts[0])));
    }
    for (let k = 0; k < (lod === 0 ? 5 : 2); k++) addLeafCard(lc, ringLerp(br.pts, 0.5 + (k / 5) * 0.5), dir, 1.1);
  }
  // crown leader foliage
  for (let k = 0; k < (lod === 0 ? 14 : 5); k++) {
    const a = rng.float() * Math.PI * 2;
    const r = rng.float() * 5;
    addLeafCard(lc, [Math.cos(a) * r, H * (0.8 + rng.float() * 0.2), Math.sin(a) * r], [Math.cos(a), 0.6, Math.sin(a)], 1.2);
  }
  // hanging vines and old webs (full detail only)
  if (lod === 0) {
    const ivy: CardCtx = { ...lc, cell: LEAF_CELLS.ivy, size: [0.9, 1.5], tints: TINT_DARK, sphere: 0.2, flutter: 0.9 };
    const vines = 9 + Math.floor(rng.float() * 6);
    for (let i = 0; i < vines; i++) {
      const a = anchors[Math.floor(rng.float() * anchors.length)];
      const o: V3 = [a[0] + (rng.float() - 0.5) * 5, a[1] - rng.float() * 1.5, a[2] + (rng.float() - 0.5) * 5];
      const Lh = 5 + rng.float() * 11;
      const n = Math.round(Lh / 1.2);
      const pts: V3[] = [];
      const radii: number[] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        pts.push([o[0] + Math.sin(k * 0.9 + i) * 0.12, o[1] - t * Lh, o[2] + Math.cos(k * 0.7 + i * 2) * 0.12]);
        radii.push(0.055 * (1 - t * 0.6) + 0.012);
      }
      tube(bark, pts, radii, { seg: 4, tile: 1.0, windH: H, windFn: (t) => 0.55 + t * 0.45 });
      for (let k = 2; k < n; k += 2) addLeafCard(ivy, pts[k], [0, -0.2, 0], 1);
    }
    // old webs: grey sheets sagging between limbs and trunk
    for (let i = 0; i < 6; i++) {
      const a = anchors[Math.floor(rng.float() * anchors.length)];
      const b = anchors[Math.floor(rng.float() * anchors.length)];
      const ty = Math.max(5, Math.min(a[1], b[1]) - 1);
      const tr = prof.radii[Math.min(prof.radii.length - 1, Math.round((ty / top) * (prof.radii.length - 1)))];
      const az = Math.atan2(a[2], a[0]);
      const p0: V3 = [Math.cos(az) * tr, ty + 3, Math.sin(az) * tr];
      sheet(webs, [p0, a, b, [b[0] * 0.5, ty - 2.5, b[2] * 0.5]], 7, rng.float() * 1.5 + 1.5);
    }
  }
  return finish(bark, leaves, webs, H, r0, crownR);
}

/** subdivided quad with sag, uv 0..1 (for the web alpha texture) */
export function sheet(buf: Buf, c: [V3, V3, V3, V3], div: number, sag: number): void {
  const base = buf.count;
  for (let j = 0; j <= div; j++) {
    for (let i = 0; i <= div; i++) {
      const u = i / div;
      const v = j / div;
      const a = lerp3(c[0], c[1], u);
      const b = lerp3(c[3], c[2], u);
      const p = lerp3(a, b, v);
      const s = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * sag * 0.35;
      buf.pos.push(p[0], p[1] - s, p[2]);
      buf.nor.push(0, 1, 0);
      buf.uv.push(u * 3, v * 3);
      buf.wind.push(0.7, 0);
    }
  }
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      const a = base + j * (div + 1) + i;
      buf.idx.push(a, a + 1, a + div + 2, a, a + div + 2, a + div + 1);
    }
  }
}

function buildBeech(rng: Rng, lod: number, seed: number): TreeGeo {
  const bark = new Buf();
  const leaves = new Buf();
  const H = 21 + rng.float() * 6;
  const r0 = 0.42 + rng.float() * 0.25;
  const tile = 2.4;
  const top = H * 0.78;
  const prof = trunkProfile(rng, H, r0, top, 0.5, 0.12, lod === 0 ? 1.8 : 4, seed);
  tube(bark, prof.pts, prof.radii, { seg: lod === 0 ? 14 : 8, tile, windH: H, lump: 0.05, lumpSeed: seed, windScale: 0.7 });
  roots(bark, rng, r0, lod === 0 ? 6 : 4, 2.2, tile, H, 6, lod);
  const center: V3 = [0, H * 0.68, 0];
  const lc: CardCtx = { leaves, rng, center, crownR: 9, H, cell: LEAF_CELLS.beech, size: lod === 0 ? [1.5, 2.3] : [2.8, 4.2], tints: rng.chance(0.25) ? TINT_GOLD : TINT_LIGHT, sphere: 0.9, flutter: 0.45 };
  const limbs = lod === 0 ? 11 : 7;
  for (let i = 0; i < limbs; i++) {
    const lr = new Rng(seed * 7919 + i * 131 + 17);
    lc.rng = lr;
    const t = 0.3 + (i / limbs) * 0.55;
    const y = t * H;
    const base = ringLerp(prof.pts, Math.min(1, y / top));
    const az = i * 2.399 + lr.float() * 0.5;
    const up = 0.5 + lr.float() * 0.5 + t * 0.4;
    const dir = norm([Math.cos(az), up, Math.sin(az)]);
    const L = (5.5 + lr.float() * 4) * (1.15 - t * 0.5);
    const rb = Math.max(0.1, r0 * (0.38 - t * 0.2));
    const br = growBranch(lr, { start: [base[0], y, base[2]], dir, length: L, r0: rb, r1: 0.04, step: lod === 0 ? 1.5 : 3, bend: -0.03, wiggle: 0.3, seg: 7, depth: 1 });
    tube(bark, br.pts, br.radii, { seg: lod === 0 ? 7 : 5, tile, windH: H, lump: 0.04, windScale: 1 });
    const subs = lod === 0 ? 3 : 1;
    for (let s = 0; s < subs; s++) {
      const bp = ringLerp(br.pts, 0.35 + s * 0.25);
      const sd = norm([dir[0] + (lr.float() - 0.5) * 1.4, dir[1] + (lr.float() - 0.3) * 0.6, dir[2] + (lr.float() - 0.5) * 1.4]);
      const sbr = growBranch(lr, { start: bp, dir: sd, length: 2.5 + lr.float() * 3, r0: rb * 0.35, r1: 0.025, step: 1.2, bend: -0.03, wiggle: 0.4, seg: 4, depth: 2 });
      tube(bark, sbr.pts, sbr.radii, { seg: 4, tile, windH: H, windScale: 1.1 });
      for (let k = 0; k < (lod === 0 ? 5 : 2); k++) addLeafCard(lc, ringLerp(sbr.pts, 0.3 + k * 0.17), sd);
    }
    for (let k = 0; k < (lod === 0 ? 7 : 3); k++) addLeafCard(lc, ringLerp(br.pts, 0.35 + k * 0.1), dir);
  }
  for (let k = 0; k < (lod === 0 ? 14 : 5); k++) {
    const a = rng.float() * Math.PI * 2;
    addLeafCard(lc, [Math.cos(a) * 1.5, H * (0.84 + rng.float() * 0.16), Math.sin(a) * 1.5], [Math.cos(a), 0.8, Math.sin(a)], 1.2);
  }
  return finish(bark, leaves, null, H, r0, 8);
}

function buildPine(rng: Rng, lod: number, seed: number): TreeGeo {
  const bark = new Buf();
  const leaves = new Buf();
  const H = 22 + rng.float() * 9;
  const r0 = 0.34 + rng.float() * 0.2;
  const tile = 2.4;
  const prof = trunkProfile(rng, H, r0, H, 0.35, 0.05, lod === 0 ? 2.2 : 4.4, seed);
  // pine tapers to a fine tip
  for (let i = 0; i < prof.radii.length; i++) prof.radii[i] *= 1 - 0.78 * Math.pow(i / (prof.radii.length - 1), 1.3);
  tube(bark, prof.pts, prof.radii, { seg: lod === 0 ? 12 : 7, tile, windH: H, lump: 0.04, lumpSeed: seed, windScale: 0.8 });
  roots(bark, rng, r0, lod === 0 ? 5 : 3, 1.8, tile, H, 5, lod);
  const center: V3 = [0, H * 0.55, 0];
  const lc: CardCtx = { leaves, rng, center, crownR: 4, H, cell: LEAF_CELLS.pine, size: lod === 0 ? [1.3, 2.0] : [2.2, 3.4], tints: TINT_PINE, sphere: 0.7, flutter: 0.3 };
  const whorlStep = lod === 0 ? 1.25 : 2.5;
  for (let y = H * 0.22; y < H * 0.97; y += whorlStep) {
    const t = y / H;
    const base = ringLerp(prof.pts, Math.min(1, t));
    const n = lod === 0 ? 5 : 4;
    const L = (4.2 * (1 - t) + 0.9) * (0.85 + rng.float() * 0.3);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + y * 1.7 + rng.float() * 0.5;
      const dir = norm([Math.cos(az), 0.12 + (1 - t) * 0.05, Math.sin(az)]);
      const br = growBranch(rng, { start: [base[0], y, base[2]], dir, length: L, r0: 0.07 * (1 - t) + 0.02, r1: 0.01, step: L / 3, bend: -0.1, wiggle: 0.15, seg: 4, depth: 1 });
      tube(bark, br.pts, br.radii, { seg: 4, tile, windH: H, windScale: 1.1 });
      const cards = lod === 0 ? 3 : 1;
      for (let k = 0; k < cards; k++) addLeafCard(lc, ringLerp(br.pts, 0.25 + (k / cards) * 0.7), norm(sub(br.pts[br.pts.length - 1], br.pts[0])), 1.0 + (1 - t) * 0.5);
    }
  }
  for (let k = 0; k < 4; k++) addLeafCard(lc, [0, H * 0.93, 0], [Math.cos(k * 1.57), 0.9, Math.sin(k * 1.57)], 0.9);
  return finish(bark, leaves, null, H, r0, 4);
}

function buildDead(rng: Rng, lod: number, seed: number): TreeGeo {
  const bark = new Buf();
  const leaves = new Buf();
  const H = 12 + rng.float() * 8;
  const r0 = 0.4 + rng.float() * 0.3;
  const tile = 2.4;
  const top = H * (0.55 + rng.float() * 0.3);
  const prof = trunkProfile(rng, H, r0, top, 0.5, 0.35, lod === 0 ? 1.6 : 3.2, seed);
  tube(bark, prof.pts, prof.radii, { seg: lod === 0 ? 12 : 7, tile, windH: H, lump: 0.13, lumpSeed: seed, windScale: 0.4, capStart: true });
  roots(bark, rng, r0, lod === 0 ? 6 : 4, 2.2, tile, H, 6, lod);
  const limbs = lod === 0 ? 8 : 5;
  const lc: CardCtx = { leaves, rng, center: [0, H * 0.6, 0], crownR: 5, H, cell: LEAF_CELLS.dead, size: [1.0, 1.6], tints: [[0.9, 0.8, 0.7], [0.7, 0.65, 0.55]], sphere: 0.4, flutter: 0.7 };
  for (let i = 0; i < limbs; i++) {
    const lr = new Rng(seed * 7919 + i * 131 + 17);
    lc.rng = lr;
    const y = top * (0.25 + (i / limbs) * 0.72);
    const base = ringLerp(prof.pts, Math.min(1, y / top));
    const az = i * 2.399 + lr.float() * 0.8;
    const dir = norm([Math.cos(az), 0.25 + lr.float() * 0.9, Math.sin(az)]);
    const L = (2.5 + lr.float() * 4.5) * (1 - y / H * 0.5);
    const rb = Math.max(0.07, r0 * 0.28 * (1 - y / H));
    const br = growBranch(lr, { start: [base[0], y, base[2]], dir, length: L, r0: rb, r1: rb * 0.3, step: 1.2, bend: -0.015, wiggle: 0.9, seg: 6, depth: 1 });
    tube(bark, br.pts, br.radii, { seg: lod === 0 ? 6 : 4, tile, windH: H, lump: 0.06, windScale: 0.9, capStart: true });
    if (lod === 0 && lr.chance(0.7)) {
      const bp = ringLerp(br.pts, 0.5);
      const sbr = growBranch(lr, { start: bp, dir: norm([dir[0] + (lr.float() - 0.5), dir[1] + 0.3, dir[2] + (lr.float() - 0.5)]), length: 1.5 + lr.float() * 2, r0: rb * 0.4, r1: 0.015, step: 0.8, bend: -0.02, wiggle: 0.8, seg: 4, depth: 2 });
      tube(bark, sbr.pts, sbr.radii, { seg: 4, tile, windH: H, windScale: 1, capStart: true });
    }
    if (lr.chance(0.3)) addLeafCard(lc, ringLerp(br.pts, 0.8), dir);
  }
  return finish(bark, leaves, null, H, r0, 4);
}

function buildBirch(rng: Rng, lod: number, seed: number): TreeGeo {
  const bark = new Buf();
  const leaves = new Buf();
  const H = 11 + rng.float() * 6;
  const r0 = 0.11 + rng.float() * 0.08;
  const tile = 2.2;
  const prof = trunkProfile(rng, H, r0, H * 0.96, 0.25, 0.9, lod === 0 ? 1.4 : 3, seed);
  for (let i = 0; i < prof.radii.length; i++) prof.radii[i] *= 1 - 0.65 * Math.pow(i / (prof.radii.length - 1), 1.2);
  tube(bark, prof.pts, prof.radii, { seg: lod === 0 ? 9 : 6, tile, windH: H, lump: 0.02, lumpSeed: seed, windScale: 1.2 });
  roots(bark, rng, r0 * 1.2, 4, 2.0, tile, H, 4, lod);
  const lc: CardCtx = { leaves, rng, center: [0, H * 0.65, 0], crownR: 3.5, H, cell: LEAF_CELLS.birch, size: lod === 0 ? [0.8, 1.3] : [1.5, 2.2], tints: TINT_GOLD, sphere: 0.8, flutter: 0.9 };
  const limbs = lod === 0 ? 14 : 8;
  for (let i = 0; i < limbs; i++) {
    const lr = new Rng(seed * 7919 + i * 131 + 17);
    lc.rng = lr;
    const t = 0.3 + (i / limbs) * 0.65;
    const y = t * H;
    const base = ringLerp(prof.pts, Math.min(1, y / (H * 0.96)));
    const az = i * 2.399 + lr.float() * 0.5;
    const dir = norm([Math.cos(az), 0.7 + (t) * 0.4, Math.sin(az)]);
    const L = (2.6 + lr.float() * 2.4) * (1.1 - t * 0.5);
    const br = growBranch(lr, { start: [base[0], y, base[2]], dir, length: L, r0: 0.035 * (1 - t * 0.5) + 0.012, r1: 0.008, step: 0.9, bend: -0.08, wiggle: 0.25, seg: 4, depth: 1 });
    tube(bark, br.pts, br.radii, { seg: 4, tile, windH: H, windScale: 1.2 });
    for (let k = 0; k < (lod === 0 ? 5 : 2); k++) addLeafCard(lc, ringLerp(br.pts, 0.3 + k * 0.17), dir);
  }
  for (let k = 0; k < (lod === 0 ? 7 : 3); k++) {
    const a = rng.float() * Math.PI * 2;
    addLeafCard(lc, [Math.cos(a) * 0.3, H * (0.88 + rng.float() * 0.12), Math.sin(a) * 0.3], [Math.cos(a), 1, Math.sin(a)], 1.2);
  }
  return finish(bark, leaves, null, H, r0, 3);
}

const cache = new Map<string, TreeGeo>();

/** cached tree geometry (shared between trees / forests) */
export function buildTreeGeometry(kind: TreeKind, variant: number, lod: 0 | 1): TreeGeo {
  const key = `${kind}:${variant}:${lod}`;
  let g = cache.get(key);
  if (g) return g;
  // the same seed for both LODs keeps the silhouette consistent
  const seed = (variant + 1) * 1013 + kind.length * 77;
  const rng = new Rng(seed);
  switch (kind) {
    case 'mirkwood_oak': g = buildMirkwoodOak(rng, lod, seed % 97); break;
    case 'beech': g = buildBeech(rng, lod, seed % 89); break;
    case 'pine': g = buildPine(rng, lod, seed % 83); break;
    case 'dead': g = buildDead(rng, lod, seed % 79); break;
    case 'birch': g = buildBirch(rng, lod, seed % 71); break;
  }
  cache.set(key, g);
  return g;
}

export { Buf, tube, card, growBranch };
export type { V3 };
