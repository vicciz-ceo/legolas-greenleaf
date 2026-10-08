/**
 * Shared helpers for the Uruk-hai / Bolg / troll kinds (group `uruks_bosses`):
 *  - seed buckets (the kit's ≤4 geometry buckets) and tiny deterministic variation helpers
 *  - rigid-gear geometry builders: curved plates with thickness (`shellPatch`), straps, spikes,
 *    chain links, elliptical bands, lathes
 *  - the white hand of Saruman (distance field, flat emblem, painted decal)
 *  - surface decals that are projected onto the finished sculpt (hand prints, scars)
 */
import * as THREE from 'three';
import { hashSeed } from '../../../../core/rng';
import { makeEvaluator, type PrimOpts, type Sculpt, type V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// seed buckets
// ─────────────────────────────────────────────────────────────────────────────

/** the kit's geometry bucket for a spec seed (bucket 0 = canonical look). Mirrors build.ts. */
export function bucketOf(seed: number | undefined): number {
  if (!seed) return 0;
  return hashSeed('bucket', seed) % 4;
}

/** the smallest seed (≥ 0) that falls into the given bucket; handy for labs and chapter authors */
export function seedForBucket(bucket: number): number {
  if (bucket <= 0) return 0;
  for (let s = 1; s < 10000; s++) if (bucketOf(s) === bucket) return s;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// gear plumbing
// ─────────────────────────────────────────────────────────────────────────────

export interface GearOpts {
  bone: string;
  color: number;
  mat?: SurfaceName | SurfaceSpec;
  matrix?: THREE.Matrix4;
  small?: boolean;
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;
  ao?: number;
}
export type GearFn = (geo: THREE.BufferGeometry, o: GearOpts) => void;

/** `ctx.gear` with the extra paint options the kit's gear sink accepts at runtime (colorFn, ao) */
export function gearOf(ctx: KindContext): GearFn {
  const log = typeof location !== 'undefined' && location.search.includes('gearlog');
  return (geo, o) => {
    if (log) {
      const w = window as unknown as { __gearLog?: string[] };
      (w.__gearLog ??= []).push(`${o.bone}:${Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3)}`);
    }
    ctx.gear(geo, o);
  };
}

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
export const tup = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** matrix: local +Y along `dir`, local +Z toward `fwd` (as far as perpendicular), origin at `pos` */
export function placeAlong(pos: V3 | THREE.Vector3, dir: THREE.Vector3, fwd: THREE.Vector3 = V(0, 0, 1), scale = 1): THREE.Matrix4 {
  const p = pos instanceof THREE.Vector3 ? pos : v3(pos);
  const y = dir.clone().normalize();
  const z = fwd.clone().addScaledVector(y, -fwd.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x.multiplyScalar(scale), y.multiplyScalar(scale), z.multiplyScalar(scale)).setPosition(p);
}

/** orientation whose local +Z is `n`, local +Y as close to `up` as possible */
export function frameAt(pos: V3 | THREE.Vector3, n: THREE.Vector3, up: THREE.Vector3 = V(0, 1, 0)): THREE.Matrix4 {
  const p = pos instanceof THREE.Vector3 ? pos : v3(pos);
  const z = n.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-6) y.set(0, 0, 1).addScaledVector(z, -z.z);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// plates with thickness
// ─────────────────────────────────────────────────────────────────────────────

export interface SurfPoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
}
/** parametric mid-surface: u, v in 0..1 → point and outward normal */
export type SurfFn = (u: number, v: number, o: SurfPoint) => void;

export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  vert(p: THREE.Vector3, n: THREE.Vector3): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    return this.pos.length / 3 - 1;
  }
  /** quad a,b,c,d (CCW seen from the side `n` points to; flips if needed) */
  quad(a: number, b: number, c: number, d: number, n: THREE.Vector3) {
    const pa = V(this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2]);
    const pb = V(this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]);
    const pc = V(this.pos[c * 3], this.pos[c * 3 + 1], this.pos[c * 3 + 2]);
    const f = pb.sub(pa).cross(pc.sub(pa));
    if (f.dot(n) >= 0) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(a, c, b, a, d, c);
  }
  tri(a: number, b: number, c: number, n: THREE.Vector3) {
    const pa = V(this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2]);
    const pb = V(this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]);
    const pc = V(this.pos[c * 3], this.pos[c * 3 + 1], this.pos[c * 3 + 2]);
    const f = pb.sub(pa).cross(pc.sub(pa));
    if (f.dot(n) >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setIndex(this.idx);
    return g;
  }
}

export interface ShellOpts {
  /** build the four rim walls (default true) */
  edges?: boolean;
  /** u wraps around (no rim walls at u = 0 / 1) */
  closedU?: boolean;
  /** thickness multiplier across the patch: (u, v) → 0..1 (e.g. thin rims) */
  thickFn?: (u: number, v: number) => number;
  /** put the whole thickness on the outer (+n) side of the mid-surface */
  outerOnly?: boolean;
  /** skip the inner skin (domes seen only from outside) */
  noInner?: boolean;
  /** skip rim walls on some sides */
  skip?: ('u0' | 'u1' | 'v0' | 'v1')[];
  /** omit grid cells (slits, vents): called with the cell centre on the mid-surface */
  cull?: (centre: THREE.Vector3) => boolean;
}

/** A curved plate: outer + inner skin and rim walls. Great for pauldrons, helmet lames, cuirass plates. */
export function shellPatch(f: SurfFn, nu: number, nv: number, thick: number, opt: ShellOpts = {}): THREE.BufferGeometry {
  const b = new Builder();
  const W = nu + 1;
  const P: THREE.Vector3[] = [];
  const N: THREE.Vector3[] = [];
  const o: SurfPoint = { p: V(), n: V() };
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      f(i / nu, j / nv, o);
      P.push(o.p.clone());
      N.push(o.n.clone().normalize());
    }
  const t = (i: number, j: number) => (opt.thickFn ? opt.thickFn(i / nu, j / nv) : 1) * thick;
  const outer: number[] = [];
  const inner: number[] = [];
  const tmp = V();
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const k = j * W + i;
      const tt = t(i, j);
      const hi = opt.outerOnly ? tt : tt / 2;
      const lo = opt.outerOnly ? 0 : tt / 2;
      outer.push(b.vert(tmp.copy(P[k]).addScaledVector(N[k], hi), N[k]));
      inner.push(b.vert(tmp.copy(P[k]).addScaledVector(N[k], -lo), tmp.clone().copy(N[k]).negate()));
    }
  const centre = V();
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * W + i;
      if (opt.cull) {
        centre.copy(P[a]).add(P[a + 1]).add(P[a + W]).add(P[a + W + 1]).multiplyScalar(0.25);
        if (opt.cull(centre)) continue;
      }
      const n = N[a].clone().add(N[a + 1]).add(N[a + W]).add(N[a + W + 1]);
      b.quad(outer[a], outer[a + 1], outer[a + W + 1], outer[a + W], n);
      if (!opt.noInner) b.quad(inner[a], inner[a + 1], inner[a + W + 1], inner[a + W], n.clone().negate());
    }
  if (opt.edges !== false) {
    const wall = (ks: number[], outward: (k: number, k2: number) => THREE.Vector3) => {
      for (let m = 0; m + 1 < ks.length; m++) {
        const k = ks[m];
        const k2 = ks[m + 1];
        const en = outward(k, k2);
        const a = b.vert(V(b.pos[outer[k] * 3], b.pos[outer[k] * 3 + 1], b.pos[outer[k] * 3 + 2]), en);
        const c = b.vert(V(b.pos[outer[k2] * 3], b.pos[outer[k2] * 3 + 1], b.pos[outer[k2] * 3 + 2]), en);
        const d = b.vert(V(b.pos[inner[k2] * 3], b.pos[inner[k2] * 3 + 1], b.pos[inner[k2] * 3 + 2]), en);
        const e = b.vert(V(b.pos[inner[k] * 3], b.pos[inner[k] * 3 + 1], b.pos[inner[k] * 3 + 2]), en);
        b.quad(a, c, d, e, en);
      }
    };
    const col = (i: number) => Array.from({ length: nv + 1 }, (_, j) => j * W + i);
    const row = (j: number) => Array.from({ length: nu + 1 }, (_, i) => j * W + i);
    const outDir = (from: number, to: number, away: number) => {
      // wall normal: perpendicular to the wall direction, in the surface, pointing away from the interior
      const along = P[to].clone().sub(P[from]).normalize();
      const nrm = N[from].clone();
      const side = new THREE.Vector3().crossVectors(along, nrm).normalize();
      const interior = P[away].clone().sub(P[from]);
      if (side.dot(interior) > 0) side.negate();
      return side;
    };
    const sk = opt.skip ?? [];
    if (!opt.closedU) {
      if (!sk.includes('u0')) wall(col(0), (k, k2) => outDir(k, k2, k + 1));
      if (!sk.includes('u1')) wall(col(nu), (k, k2) => outDir(k, k2, k - 1));
    }
    if (!sk.includes('v0')) wall(row(0), (k, k2) => outDir(k, k2, k + W));
    if (!sk.includes('v1')) wall(row(nv), (k, k2) => outDir(k, k2, k - W));
  }
  return b.geometry();
}

/**
 * Surface on an ellipsoid (centre c, radii r): azimuth az0..az1 (0 = +Z, + toward +X), elevation
 * from el0 to el1 (0 = equator, π/2 = top); elevation limits may depend on the azimuth.
 */
export function ellipsoidFn(
  c: V3 | THREE.Vector3,
  r: V3,
  az: [number, number],
  el: [number | ((a: number) => number), number | ((a: number) => number)],
  opt: { rot?: THREE.Quaternion; radial?: (az: number, el: number) => number } = {},
): SurfFn {
  const cc = c instanceof THREE.Vector3 ? c : v3(c);
  const d = V();
  return (u, v, o) => {
    const a = az[0] + (az[1] - az[0]) * u;
    const e0 = typeof el[0] === 'function' ? el[0](a) : el[0];
    const e1 = typeof el[1] === 'function' ? el[1](a) : el[1];
    const e = e0 + (e1 - e0) * v;
    d.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    const k = opt.radial ? opt.radial(a, e) : 1;
    o.p.set(d.x * r[0] * k, d.y * r[1] * k, d.z * r[2] * k);
    o.n.set(d.x / r[0], d.y / r[1], d.z / r[2]).normalize();
    if (opt.rot) {
      o.p.applyQuaternion(opt.rot);
      o.n.applyQuaternion(opt.rot);
    }
    o.p.add(cc);
  };
}

/** a strip along a polyline: width across (side = tangent × normal), with thickness */
export function ribbon(pts: THREE.Vector3[], nrm: THREE.Vector3[], width: number | ((t: number) => number), thick: number, sub = 1, opt: ShellOpts = {}, segs?: number): THREE.BufferGeometry {
  const n = pts.length - 1;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const tmpA = V();
  return shellPatch(
    (u, v, o) => {
      curve.getPointAt(u, o.p);
      curve.getTangentAt(u, tmpA);
      const f = u * n;
      const i = Math.min(n - 1, Math.floor(f));
      o.n.copy(nrm[i]).lerp(nrm[i + 1], f - i).normalize();
      const side = tmpA.clone().cross(o.n).normalize();
      const w = typeof width === 'number' ? width : width(u);
      o.p.addScaledVector(side, (v - 0.5) * w);
    },
    segs ?? Math.max(4, n * 4),
    sub,
    thick,
    opt,
  );
}

/** tapered spike pointing along +Y from the origin */
export function spike(r: number, h: number, seg = 6, bend = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg, bend ? 3 : 1, false);
  g.translate(0, h / 2, 0);
  if (bend) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h;
      p.setX(i, p.getX(i) + bend * t * t * h);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** hex bolt head pointing +Y from the origin */
export function hexBolt(r: number, h: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r * 0.92, r, h, 6, 1).translate(0, h / 2, 0);
}

/** crude skull (cranium + jaw), facing +Z, origin at the centre of the cranium */
export function skullGeo(r: number): THREE.BufferGeometry {
  const cr = new THREE.SphereGeometry(r, 8, 6).scale(0.9, 1, 1.05);
  const jaw = new THREE.BoxGeometry(r * 1.0, r * 0.45, r * 0.8).translate(0, -r * 0.85, r * 0.25);
  const cheek = new THREE.BoxGeometry(r * 1.5, r * 0.3, r * 0.5).translate(0, -r * 0.45, r * 0.45);
  const merged = new THREE.BufferGeometry();
  const parts = [cr, jaw, cheek].map((g) => g.toNonIndexed());
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of parts) {
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return merged;
}

/** low-poly rivet / stud dome pointing +Z */
export function rivet(r: number, seg = 5): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
}

/** open elliptical band around the Y axis: radii at the top and bottom, flared, with thickness */
export function ellipticalBand(rxTop: number, rzTop: number, rxBot: number, rzBot: number, h: number, thick: number, seg = 20, a0 = 0, a1 = Math.PI * 2, zShift = 0): THREE.BufferGeometry {
  const closed = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  return shellPatch(
    (u, v, o) => {
      const a = a0 + (a1 - a0) * u;
      const rx = lerp(rxBot, rxTop, v);
      const rz = lerp(rzBot, rzTop, v);
      o.p.set(Math.sin(a) * rx, (v - 0.5) * h, Math.cos(a) * rz + zShift);
      o.n.set(Math.sin(a) / rx, (rxBot - rxTop) / h * 0.0 + 0.0, Math.cos(a) / rz).normalize();
    },
    seg,
    1,
    thick,
    { closedU: closed, noInner: true },
  );
}

export function lathe(profile: [number, number][], seg = 12, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)),
    seg,
    phi0,
    phiLen,
  );
}

/** a chain of links along a polyline (alternating orientation) */
export function chainLinks(path: THREE.Vector3[], linkLen: number, tubeR: number, up: THREE.Vector3 = V(0, 0, 1)): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const curve = new THREE.CatmullRomCurve3(path, false, 'centripetal');
  const total = curve.getLength();
  const n = Math.max(2, Math.floor(total / (linkLen * 0.78)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const pos = curve.getPointAt(t);
    const dir = curve.getTangentAt(t);
    // oval link in the local XY plane, long axis along Y (= the chain); every second link turned 90° about the chain
    const g = new THREE.TorusGeometry(linkLen * 0.3, tubeR, 4, 8).scale(0.78, 1.25, 1.0);
    if (i % 2) g.rotateY(Math.PI / 2);
    g.applyMatrix4(placeAlong(pos, dir, up));
    out.push(g);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// the white hand of Saruman
// ─────────────────────────────────────────────────────────────────────────────

function sdSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay || 1e-9));
  return Math.hypot(pax - bax * h, pay - bay * h);
}
const FINGERS: [number, number, number, number, number][] = [
  // base x, base y, tip x, tip y, radius
  [-0.205, 0.04, -0.285, 0.43, 0.052],
  [-0.075, 0.07, -0.095, 0.5, 0.054],
  [0.07, 0.07, 0.1, 0.47, 0.053],
  [0.195, 0.03, 0.29, 0.34, 0.046],
];

/** signed distance (unit hand height ≈ 1, wrist at y = -0.5, fingertips up to y ≈ +0.53; negative inside) */
export function whiteHandSd(x: number, y: number): number {
  // palm: rounded box
  const qx = Math.abs(x) - 0.215, qy = Math.abs(y + 0.1) - 0.14;
  let d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.06;
  for (const [bx, by, tx, ty, r] of FINGERS) d = Math.min(d, sdSeg(x, y, bx, by, tx, ty) - r);
  // thumb (on the viewer's left) and wrist
  d = Math.min(d, sdSeg(x, y, -0.22, -0.2, -0.47, -0.02) - 0.058);
  d = Math.min(d, sdSeg(x, y, 0, -0.3, 0, -0.52) - 0.15);
  return d;
}
/** coverage 0..1 of the hand at (x, y) in unit-hand coordinates, with a soft edge of `soft` */
export function whiteHandMask(x: number, y: number, soft = 0.02): number {
  return 1 - smooth(-soft, soft, whiteHandSd(x, y));
}

/** outline points (CCW) of the hand (unit height), traced radially from the palm centre and simplified */
export function whiteHandOutline(n = 360, eps = 0.012): THREE.Vector2[] {
  const raw: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let lo = 0, hi = 0.9;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      if (whiteHandSd(dx * m, -0.1 + dy * m) < 0) lo = m;
      else hi = m;
    }
    raw.push(new THREE.Vector2(dx * lo, -0.1 + dy * lo));
  }
  // Douglas-Peucker-ish simplification on the closed loop (greedy: drop points that deviate < eps from the chord)
  const out: THREE.Vector2[] = [raw[0]];
  let last = 0;
  for (let i = 2; i <= raw.length; i++) {
    const a = raw[last];
    const b = raw[i % raw.length];
    let ok = true;
    for (let j = last + 1; j < i; j++) {
      const p = raw[j];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1e-9)));
      if (p.distanceTo(a.clone().addScaledVector(ab, t)) > eps) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      out.push(raw[i - 1]);
      last = i - 1;
    }
  }
  return out;
}

/** a strip between two points of a frame's XY plane, draped over the surface (width tapers w0 → w1) */
export function surfaceStrip(proj: Projector, frame: THREE.Matrix4, a: [number, number], b: [number, number], w0: number, w1: number, lift: number, samples: number, out: Builder): void {
  const dir = new THREE.Vector2(b[0] - a[0], b[1] - a[1]);
  const len = dir.length();
  if (len < 1e-6) return;
  dir.divideScalar(len);
  const perp = new THREE.Vector2(-dir.y, dir.x);
  const rows: [number, number][] = [];
  const n = V(), p = V();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const w = lerp(w0, w1, t) / 2;
    const cx = a[0] + dir.x * len * t, cy = a[1] + dir.y * len * t;
    const ids: number[] = [];
    for (const sd of [-1, 1]) {
      p.set(cx + perp.x * w * sd, cy + perp.y * w * sd, 0).applyMatrix4(frame);
      if (!proj.project(p, n, 4)) {
        ids.push(-1);
        continue;
      }
      p.addScaledVector(n, lift);
      ids.push(out.vert(p, n));
    }
    rows.push([ids[0], ids[1]]);
  }
  for (let i = 0; i < samples; i++) {
    const [l0, r0] = rows[i];
    const [l1, r1] = rows[i + 1];
    if (l0 < 0 || r0 < 0 || l1 < 0 || r1 < 0) continue;
    const nn = V(out.nor[l0 * 3], out.nor[l0 * 3 + 1], out.nor[l0 * 3 + 2]);
    out.quad(l0, r0, r1, l1, nn);
  }
}

/** the white hand (unit height ≈ 1 → `size` metres) built from strips draped over the surface */
export function handStrips(proj: Projector, frame: THREE.Matrix4, size: number, lift: number, o: { wrist?: boolean; samples?: number; jitter?: number; seed?: number } = {}): THREE.BufferGeometry | null {
  const b = new Builder();
  const S = size;
  const ns = o.samples ?? 4;
  const j = o.jitter ?? 0;
  let r = (o.seed ?? 1) * 12.9898;
  const rnd = () => {
    r = (Math.sin(r) * 43758.5453) % 1;
    return Math.abs(r) - 0.5;
  };
  const P = (x: number, y: number): [number, number] => [(x + rnd() * j) * S, (y + rnd() * j) * S];
  // palm: three wide strips
  for (const [y, h] of [[-0.19, 0.12], [-0.075, 0.12], [0.03, 0.115]] as [number, number][]) surfaceStrip(proj, frame, P(-0.255, y), P(0.255, y), h * S, h * S, lift, ns + 2, b);
  // fingers
  const fingers: [number, number, number, number, number][] = [
    [-0.19, 0.06, -0.265, 0.42, 0.098],
    [-0.065, 0.07, -0.085, 0.5, 0.1],
    [0.065, 0.07, 0.095, 0.47, 0.1],
    [0.185, 0.05, 0.27, 0.35, 0.088],
  ];
  for (const [x0, y0, x1, y1, w] of fingers) surfaceStrip(proj, frame, P(x0, y0), P(x1, y1), w * S, w * S * 0.72, lift, ns, b);
  // thumb
  surfaceStrip(proj, frame, P(-0.22, -0.16), P(-0.46, 0.02), 0.105 * S, 0.075 * S, lift, ns, b);
  if (o.wrist) surfaceStrip(proj, frame, P(0, -0.26), P(0, -0.5), 0.3 * S, 0.24 * S, lift, ns, b);
  return b.idx.length ? b.geometry() : null;
}

/** a flat extruded white-hand emblem (width ~1 unit × scale). Faces +Z, centred on its palm. */
export function whiteHandEmblem(scale: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(whiteHandOutline(140));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: 0.012, bevelSegments: 1, curveSegments: 1, steps: 1 });
  g.translate(0, 0.1, 0);
  g.scale(scale, scale, 1);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// surface projection & decals
// ─────────────────────────────────────────────────────────────────────────────

export interface Projector {
  /** snap a point onto the sculpt surface (Newton on the SDF); returns the surface normal */
  project(p: THREE.Vector3, nOut: THREE.Vector3, iters?: number): boolean;
  /** sphere-trace from `origin` along `dir` to the first surface; writes the hit point and normal */
  cast(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, pOut: THREE.Vector3, nOut: THREE.Vector3): boolean;
  /** signed distance (negative inside) */
  dist(x: number, y: number, z: number): number;
}

/** SDF snapshot of everything sculpted so far. Build it at the END of your extras. */
export function makeProjector(s: Sculpt, box: { min: V3; max: V3 }): Projector | null {
  try {
    const prog = s.compile();
    const ev = makeEvaluator(prog);
    const tmp: number[] = [];
    prog.cull(box.min[0], box.min[1], box.min[2], box.max[0], box.max[1], box.max[2], tmp);
    const list = Int32Array.from(tmp);
    const dist = (x: number, y: number, z: number) => ev.dist(x, y, z, list, 0, list.length);
    const e = 0.0025;
    const gradient = (p: THREE.Vector3, nOut: THREE.Vector3) => {
      nOut.set(dist(p.x + e, p.y, p.z) - dist(p.x - e, p.y, p.z), dist(p.x, p.y + e, p.z) - dist(p.x, p.y - e, p.z), dist(p.x, p.y, p.z + e) - dist(p.x, p.y, p.z - e));
      return nOut.lengthSq() > 1e-12 ? nOut.normalize() : null;
    };
    return {
      dist,
      cast(origin, dir, maxT, pOut, nOut) {
        let t = 0;
        pOut.copy(origin);
        for (let i = 0; i < 160 && t < maxT; i++) {
          const d = dist(pOut.x, pOut.y, pOut.z);
          if (d < 0.0006) {
            gradient(pOut, nOut);
            return true;
          }
          const step = Math.max(d * 0.9, 0.0015);
          t += step;
          pOut.copy(origin).addScaledVector(dir, t);
        }
        return false;
      },
      project(p, nOut, iters = 5) {
        for (let i = 0; i < iters; i++) {
          const d = dist(p.x, p.y, p.z);
          nOut.set(dist(p.x + e, p.y, p.z) - dist(p.x - e, p.y, p.z), dist(p.x, p.y + e, p.z) - dist(p.x, p.y - e, p.z), dist(p.x, p.y, p.z + e) - dist(p.x, p.y, p.z - e));
          if (nOut.lengthSq() < 1e-12) return false;
          nOut.normalize();
          p.addScaledVector(nOut, -d);
        }
        const d = dist(p.x, p.y, p.z);
        return Math.abs(d) < 0.01;
      },
    };
  } catch (err) {
    console.warn('[uruks_bosses] projector unavailable', err);
    return null;
  }
}

export interface DecalOpts {
  proj: Projector;
  /** frame: local +Z outward, +Y up on the decal; origin on / near the surface */
  frame: THREE.Matrix4;
  w: number;
  h: number;
  cell: number;
  /** coverage in local metres (x right in the frame, y up) → 0..1 */
  mask: (x: number, y: number) => number;
  lift?: number;
  /** colour of the painted area and of the skin it fades into */
  paint: number;
  skin: number;
  /** extra colour variation (streaks / smudges): (x, y) → -1..1 */
  streak?: (x: number, y: number) => number;
}

/** a thin sheet of quads hugging the sculpt wherever mask > 0, coloured paint → skin by the mask */
export function surfaceDecal(o: DecalOpts): { geo: THREE.BufferGeometry; colorFn: NonNullable<GearOpts['colorFn']> } | null {
  const nx = Math.ceil(o.w / o.cell);
  const ny = Math.ceil(o.h / o.cell);
  const lift = o.lift ?? 0.0025;
  const P: (THREE.Vector3 | null)[] = [];
  const Nn: THREE.Vector3[] = [];
  const M: number[] = [];
  const key = (p: THREE.Vector3) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const maskByPos = new Map<string, number>();
  const streakByPos = new Map<string, number>();
  const tmp = V();
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = -o.w / 2 + i * o.cell;
      const y = -o.h / 2 + j * o.cell;
      M.push(o.mask(x, y));
      P.push(tmp.set(x, y, 0).applyMatrix4(o.frame).clone());
      Nn.push(V());
    }
  const b = new Builder();
  const id: number[] = new Array(P.length).fill(-1);
  const W = nx + 1;
  const getV = (k: number): number => {
    if (id[k] >= 0) return id[k];
    const p = P[k]!;
    const n = Nn[k];
    if (!o.proj.project(p, n)) {
      id[k] = -2;
      return -2;
    }
    p.addScaledVector(n, lift);
    id[k] = b.vert(p, n);
    const kk = key(p);
    maskByPos.set(kk, M[k]);
    if (o.streak) {
      const x = -o.w / 2 + (k % W) * o.cell;
      const y = -o.h / 2 + Math.floor(k / W) * o.cell;
      streakByPos.set(kk, o.streak(x, y));
    }
    return id[k];
  };
  let any = false;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * W + i;
      if (M[a] < 0.02 && M[a + 1] < 0.02 && M[a + W] < 0.02 && M[a + W + 1] < 0.02) continue;
      const va = getV(a), vb = getV(a + 1), vc = getV(a + W + 1), vd = getV(a + W);
      if (va < 0 || vb < 0 || vc < 0 || vd < 0) continue;
      const n = Nn[a].clone().add(Nn[a + 1]).add(Nn[a + W]).add(Nn[a + W + 1]);
      b.quad(va, vb, vc, vd, n);
      any = true;
    }
  if (!any) return null;
  const cPaint = new THREE.Color().setHex(o.paint, THREE.SRGBColorSpace);
  const cSkin = new THREE.Color().setHex(o.skin, THREE.SRGBColorSpace);
  const cTmp = new THREE.Color();
  const colorFn: NonNullable<GearOpts['colorFn']> = (p, _n, c) => {
    const kk = key(p);
    const m = maskByPos.get(kk) ?? 0;
    const st = streakByPos.get(kk) ?? 0;
    const t = smooth(0.15, 0.7, m);
    cTmp.copy(cPaint).multiplyScalar(1 + 0.12 * st);
    c.copy(cSkin).lerp(cTmp, t);
  };
  return { geo: b.geometry(), colorFn };
}

/** analytic projector for an ellipsoid (helmets, domes): snaps points onto the outer surface */
export function ellipsoidProjector(c: V3 | THREE.Vector3, r: V3, rot?: THREE.Quaternion): Projector {
  const cc = c instanceof THREE.Vector3 ? c : v3(c);
  const inv = rot ? rot.clone().invert() : null;
  const q = V();
  return {
    cast: () => false,
    dist(x, y, z) {
      q.set(x, y, z).sub(cc);
      if (inv) q.applyQuaternion(inv);
      const k = Math.hypot(q.x / r[0], q.y / r[1], q.z / r[2]);
      return (k - 1) * Math.min(r[0], r[1], r[2]);
    },
    project(p, nOut) {
      q.copy(p).sub(cc);
      if (inv) q.applyQuaternion(inv);
      const k = Math.hypot(q.x / r[0], q.y / r[1], q.z / r[2]) || 1;
      q.divideScalar(k);
      nOut.set(q.x / (r[0] * r[0]), q.y / (r[1] * r[1]), q.z / (r[2] * r[2])).normalize();
      p.copy(q);
      if (rot) {
        p.applyQuaternion(rot);
        nOut.applyQuaternion(rot);
      }
      p.add(cc);
      return true;
    },
  };
}

/** measure the body at height y: half widths along x and z (front, back) by marching out of the axis */
export function ringRadii(proj: Projector, y: number, cx = 0, cz = 0): { rx: number; zf: number; zb: number } {
  const march = (dx: number, dz: number) => {
    let lo = 0, hi = 0.6;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      if (proj.dist(cx + dx * m, y, cz + dz * m) < 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  return { rx: (march(1, 0) + march(-1, 0)) / 2, zf: march(0, 1), zb: march(0, -1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// strokes (paint / carve / straps) that follow the sculpt surface
// ─────────────────────────────────────────────────────────────────────────────

export interface PathOnSurface {
  p: THREE.Vector3[];
  n: THREE.Vector3[];
}

/** snap rough points onto the sculpt surface (points that fail to project are dropped) */
export function projectPath(proj: Projector, pts: V3[], offset = 0): PathOnSurface {
  const out: PathOnSurface = { p: [], n: [] };
  const nn = V();
  for (const q of pts) {
    const p = V(q[0], q[1], q[2]);
    if (!proj.project(p, nn)) continue;
    out.p.push(p.addScaledVector(nn, offset));
    out.n.push(nn.clone());
  }
  return out;
}

/** a painted stroke (capsule chain centred on the surface) */
export function paintStroke(s: Sculpt, proj: Projector, pts: V3[], radius: number | number[], o: PrimOpts) {
  const path = projectPath(proj, pts);
  for (let i = 0; i + 1 < path.p.length; i++) {
    const r0 = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
    const r1 = typeof radius === 'number' ? radius : radius[Math.min(i + 1, radius.length - 1)];
    s.cone(tup(path.p[i]), tup(path.p[i + 1]), r0, r1, { op: 'paint', ...o });
  }
  if (path.p.length === 1) s.sphere(tup(path.p[0]), typeof radius === 'number' ? radius : radius[0], { op: 'paint', ...o });
}

/** a carved groove (scar, cut) following the surface, with the groove painted `color` */
export function carveStroke(s: Sculpt, proj: Projector, pts: V3[], radius: number | number[], depth: number, o: PrimOpts) {
  const path = projectPath(proj, pts, radius instanceof Array ? radius[0] - depth : (radius as number) - depth);
  for (let i = 0; i + 1 < path.p.length; i++) {
    const r0 = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
    const r1 = typeof radius === 'number' ? radius : radius[Math.min(i + 1, radius.length - 1)];
    s.cone(tup(path.p[i]), tup(path.p[i + 1]), r0, r1, { op: 'subtract', paintCarve: true, ...o });
  }
}

/** a strap hugging the sculpt along rough points, as rigid gear */
export function strapGear(gear: GearFn, proj: Projector, pts: V3[], width: number, thick: number, o: GearOpts, lift = 0.0008) {
  const path = projectPath(proj, pts, lift);
  if (path.p.length < 3) return;
  gear(ribbon(path.p, path.n, width, thick, 1, { outerOnly: true, noInner: true }), o);
}

/** place a geometry on the surface at a rough point: local +Y = surface normal (spikes, studs) */
export function placeOnSurface(proj: Projector, pt: V3, upRef: THREE.Vector3 = V(0, 0, 1)): THREE.Matrix4 | null {
  const p = V(pt[0], pt[1], pt[2]);
  const n = V();
  if (!proj.project(p, n)) return null;
  return placeAlong(p, n, upRef);
}

export type SnapMode = 'f' | 'b' | 't' | 'u' | 'l' | 'r' | 'p';

/** snap a rough point onto the surface by casting from outside: f = from the front (-z), b = back, t = from above, l/r = from the sides, p = Newton */
export function snapPoint(proj: Projector, q: V3, mode: SnapMode, pOut: THREE.Vector3, nOut: THREE.Vector3, farIn = 0.7): boolean {
  const far = farIn;
  const o = V(q[0], q[1], q[2]);
  const d = V();
  switch (mode) {
    case 'f': o.z += far; d.set(0, 0, -1); break;
    case 'b': o.z -= far; d.set(0, 0, 1); break;
    case 't': o.y += far; d.set(0, -1, 0); break;
    case 'u': o.y -= far; d.set(0, 1, 0); break;
    case 'l': o.x += far; d.set(-1, 0, 0); break;
    case 'r': o.x -= far; d.set(1, 0, 0); break;
    default:
      pOut.copy(o);
      return proj.project(pOut, nOut);
  }
  return proj.cast(o, d, far * 2, pOut, nOut);
}

export type SnapPoint = [number, number, number, SnapMode?, number?];

export function snapPath(proj: Projector, pts: SnapPoint[], offset = 0): PathOnSurface {
  const out: PathOnSurface = { p: [], n: [] };
  const p = V(), n = V();
  for (const q of pts) {
    if (!snapPoint(proj, [q[0], q[1], q[2]], q[3] ?? 'p', p, n, q[4])) continue;
    out.p.push(p.clone().addScaledVector(n, offset));
    out.n.push(n.clone());
  }
  return out;
}

/** painted stroke following the surface (see `paintStroke`), points snapped by casting */
export function paintSnapped(s: Sculpt, proj: Projector, pts: SnapPoint[], radius: number | number[], o: PrimOpts, inset = 0) {
  const path = snapPath(proj, pts, -inset);
  for (let i = 0; i + 1 < path.p.length; i++) {
    const r0 = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
    const r1 = typeof radius === 'number' ? radius : radius[Math.min(i + 1, radius.length - 1)];
    s.cone(tup(path.p[i]), tup(path.p[i + 1]), r0, r1, { op: 'paint', ...o });
  }
  if (path.p.length === 1) s.sphere(tup(path.p[0]), typeof radius === 'number' ? radius : radius[0], { op: 'paint', ...o });
}

export function carveSnapped(s: Sculpt, proj: Projector, pts: SnapPoint[], radius: number | number[], depth: number, o: PrimOpts) {
  const r0 = typeof radius === 'number' ? radius : radius[0];
  const path = snapPath(proj, pts, r0 - depth);
  for (let i = 0; i + 1 < path.p.length; i++) {
    const ra = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
    const rb = typeof radius === 'number' ? radius : radius[Math.min(i + 1, radius.length - 1)];
    s.cone(tup(path.p[i]), tup(path.p[i + 1]), ra, rb, { op: 'subtract', paintCarve: true, ...o });
  }
}

/** resample a snapped path every `step` metres and re-project it (so chords across bulges hug the surface) */
export function densePath(proj: Projector, pts: SnapPoint[], step: number, offset = 0): PathOnSurface {
  const rough = snapPath(proj, pts, 0);
  const out: PathOnSurface = { p: [], n: [] };
  if (rough.p.length < 2) return out;
  const curve = new THREE.CatmullRomCurve3(rough.p, false, 'centripetal');
  const n = Math.max(3, Math.ceil(curve.getLength() / step));
  const nn = V();
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    if (!proj.project(p, nn, 3)) continue;
    out.p.push(p.addScaledVector(nn, offset));
    out.n.push(nn.clone());
  }
  return out;
}

/** strap hugging the surface along snapped points */
export function strapSnapped(gear: GearFn, proj: Projector, pts: SnapPoint[], width: number, thick: number, o: GearOpts, lift = 0.0008) {
  const path = densePath(proj, pts, Math.max(0.012, width * 0.5), lift);
  if (path.p.length < 3) return;
  gear(ribbon(path.p, path.n, width, thick, 1, { outerOnly: true, noInner: true }, path.p.length - 1), o);
}

/** points around a body ring: radial cast toward the axis at angle a (0 = front, + toward +X) */
export function ringSnap(proj: Projector, a: number, y: number, cx = 0, cz = 0, pOut = V(), nOut = V()): { p: THREE.Vector3; n: THREE.Vector3 } | null {
  const o = V(cx + Math.sin(a) * 0.7, y, cz + Math.cos(a) * 0.7);
  const d = V(-Math.sin(a), 0, -Math.cos(a));
  if (!proj.cast(o, d, 0.7, pOut, nOut)) return null;
  return { p: pOut, n: nOut };
}

/** a thin raised scar / welt (tube) hugging the sculpt along snapped points; returns null when it does not fit */
export function scarTube(proj: Projector, pts: SnapPoint[], radius: number, lift = 0.0004): THREE.BufferGeometry | null {
  const rough = snapPath(proj, pts, lift);
  if (rough.p.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(rough.p, false, 'centripetal');
  const n = Math.max(6, rough.p.length * 5);
  const path: THREE.Vector3[] = [];
  const nn = V();
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    if (!proj.project(p, nn)) continue;
    path.push(p.addScaledVector(nn, lift));
  }
  if (path.length < 3) return null;
  const c2 = new THREE.CatmullRomCurve3(path, false, 'catmullrom');
  return new THREE.TubeGeometry(c2, Math.max(8, path.length), radius, 4, false);
}

/**
 * Make whatever the given hand holds bigger (huge two-handed swords, giant hammers). KindDef has no
 * weapon scale, so this adds a marker object to the hand socket that rescales the held weapon
 * object (matched by userData.kind) the first time it sees it. Works for weapons swapped later too.
 */
export function scaleHeldWeapon(ctx: KindContext, hand: 'hand_r' | 'hand_l', kinds: string[], scale: [number, number, number]) {
  ctx.object(
    () => {
      const g = new THREE.Group();
      g.name = 'weapon_scaler';
      g.updateMatrixWorld = function (force?: boolean) {
        const par = this.parent;
        if (par) {
          for (const c of par.children) {
            if (c !== this && typeof c.userData.kind === 'string' && kinds.includes(c.userData.kind) && !c.userData.scaledBy) {
              c.scale.set(c.scale.x * scale[0], c.scale.y * scale[1], c.scale.z * scale[2]);
              c.userData.scaledBy = 'uruks_bosses';
            }
          }
        }
        THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
      };
      return g;
    },
    { socket: hand },
  );
}
