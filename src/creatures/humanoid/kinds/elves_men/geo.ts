/**
 * Geometry builders for rigid gear (plates, helmets, leaves, twigs, studs…). Everything returns
 * plain THREE geometry in model space; `put()` hands it to the kit's gear sink (merged into the
 * body draw call, skinned to one bone).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, type Part } from '../../anatomy';
import type { Proportions } from '../../proportions';
import type { KindContext } from '../../types';

export interface PutOpts {
  bone: string;
  color: number;
  mat?: SurfaceName | SurfaceSpec;
  matrix?: THREE.Matrix4;
  small?: boolean;
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;
  ao?: number;
}

/** add rigid gear to the body draw call */
const GEAR_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('em_gear') === '1';
export function put(ctx: KindContext, geo: THREE.BufferGeometry | null, o: PutOpts) {
  if (!geo) return;
  if (GEAR_DEBUG) {
    const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    const where = (new Error().stack ?? '').split('\n').slice(2, 4).map((l) => l.replace(/.*\/(\w+\.ts):(\d+).*/, '$1:$2')).join(' < ');
    ((window as unknown as { __emGear?: string[] }).__emGear ??= []).push(`${ctx.kind}/${ctx.spec.seed ?? 0} ${Math.round(n)} ${where}`);
  }
  ctx.gear(geo, o as Parameters<KindContext['gear']>[1]);
}

/** a partial ellipsoid shell (helmet domes, pauldrons, plates) */
export function shell(rx: number, ry: number, rz: number, o: { phi0?: number; phiLen?: number; th0?: number; th1?: number; w?: number; h?: number } = {}): THREE.BufferGeometry {
  const th0 = o.th0 ?? 0;
  const th1 = o.th1 ?? Math.PI / 2;
  const g = new THREE.SphereGeometry(1, o.w ?? 14, o.h ?? 8, o.phi0 ?? 0, o.phiLen ?? Math.PI * 2, th0, th1 - th0);
  g.scale(rx, ry, rz);
  return g;
}

/** lathe around +Y from (radius, y) pairs */
export function lathe(profile: [number, number][], seg = 16, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)),
    seg,
    phi0,
    phiLen,
  );
}

/** a tube along a smooth path */
export function tube(points: V3[], radius: number, o: { seg?: number; radial?: number; closed?: boolean } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), o.closed ?? false, 'catmullrom', 0.3);
  return new THREE.TubeGeometry(curve, o.seg ?? 16, radius, o.radial ?? 5, o.closed ?? false);
}

/** a tapered tube along a smooth path: radius r0 at the start, r1 at the end (twigs, plumes, horns) */
export function taperedTube(points: V3[], r0: number, r1: number, o: { seg?: number; radial?: number; tension?: number } = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 12;
  const radial = o.radial ?? 5;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', o.tension ?? 0.4);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ringI = Math.floor(i / (radial + 1));
    const t = ringI / seg;
    curve.getPointAt(Math.min(1, t), c);
    v.fromBufferAttribute(pos, i).sub(c);
    const r = r0 + (r1 - r0) * t;
    v.multiplyScalar(r).add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** a cone spike from `base` along `dir` */
export function spike(base: V3, dir: V3, len: number, r: number, seg = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg).translate(0, len / 2, 0);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(base[0], base[1], base[2]), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** merge plain geometries (position+normal only) */
export function mergeAll(list: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const clean = list
    .filter((g): g is THREE.BufferGeometry => !!g)
    .map((g) => {
      const c = g.index ? g.toNonIndexed() : g.clone();
      for (const n of Object.keys(c.attributes)) if (n !== 'position' && n !== 'normal') c.deleteAttribute(n);
      return c;
    });
  if (!clean.length) return null;
  const m = mergeGeometries(clean, false);
  for (const c of clean) c.dispose();
  return m;
}

/** many small domed rivets/studs at the given points (one geometry) */
export function studs(points: V3[], r: number, flat = 0.7): THREE.BufferGeometry | null {
  if (!points.length) return null;
  const list: THREE.BufferGeometry[] = [];
  for (const p of points) list.push(new THREE.SphereGeometry(r, 5, 3).scale(1, flat, 1).translate(p[0], p[1], p[2]));
  return mergeAll(list);
}

/** a model-space matrix: translate then rotate (Euler XYZ) then scale */
export function mat4(pos: V3, rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.Matrix4 {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), s);
}

/** matrix placing local +Y along `dir` at `pos`, local +Z toward `fwd` (approximately) */
export function along(pos: V3, dir: V3, fwd: V3 = [0, 0, 1], scale = 1): THREE.Matrix4 {
  const y = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const z = new THREE.Vector3(fwd[0], fwd[1], fwd[2]);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-6) z.set(1, 0, 0);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(scale, scale, scale)).setPosition(pos[0], pos[1], pos[2]);
}

/** a torus ring around `dir` at `p` */
export function ring(p: V3, dir: V3, r: number, tubeR: number, seg = 10, radial = 4): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tubeR, radial, seg);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** a curved rectangular plate wrapped around a vertical axis (arc of a cylinder) */
export function arcPlate(radius: number, height: number, arc: number, centre = 0, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, seg, 1, true, centre - arc / 2 + Math.PI / 2, arc);
}

/**
 * A leaf: lens-shaped, base at the origin, tip along +Y, face toward +Z, with a raised midrib and
 * an optional lengthwise curl (cup) and tip droop. `w` is the half-width at the widest point.
 */
export function leaf(len: number, w: number, o: { droop?: number; cup?: number; rib?: number; rows?: number; pointy?: number } = {}): THREE.BufferGeometry {
  const rows = o.rows ?? 5;
  const droop = o.droop ?? 0.25;
  const cup = o.cup ?? 0.25;
  const rib = o.rib ?? 0.18;
  const pointy = o.pointy ?? 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    // lens outline: widest at 40 %
    const half = w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.85 * pointy + 0.15);
    const y = t * len;
    const z0 = -droop * len * t * t;
    for (let k = -1; k <= 1; k++) {
      const x = k * half;
      const z = z0 + (k === 0 ? rib * w : 0) - cup * Math.abs(k) * half * 0.5;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 3;
    const b = a + 3;
    idx.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** merge several placed copies of a geometry (leaves, studs) given matrices */
export function instances(base: THREE.BufferGeometry, mats: THREE.Matrix4[]): THREE.BufferGeometry | null {
  return mergeAll(mats.map((m) => base.clone().applyMatrix4(m)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Torso cross-sections: plates that follow the sculpted anatomy
// ─────────────────────────────────────────────────────────────────────────────

const TORSO_TAGS = new Set(['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'glutes']);

export interface TorsoSec {
  /** half width (outermost x) */
  rx: number;
  /** front and back extents (z) */
  zf: number;
  zb: number;
}

/** cached ellipsoid parts of a Proportions' torso */
const partCache = new WeakMap<Proportions, { c: V3; r: V3 }[]>();
function torsoEllipsoids(P: Proportions): { c: V3; r: V3 }[] {
  let l = partCache.get(P);
  if (!l) {
    l = (anatomyParts(P) as Part[]).filter((p) => p.t === 'ell' && TORSO_TAGS.has(p.tag)).map((p) => ({ c: (p as { c: V3 }).c, r: (p as { r: V3 }).r }));
    partCache.set(P, l);
  }
  return l;
}

/** outline of the torso at height y (model space), from the anatomy ellipsoids */
export function torsoSection(P: Proportions, y: number): TorsoSec {
  let rx = 0.05 * P.s;
  let zf = 0.04 * P.s;
  let zb = -0.04 * P.s;
  for (const e of torsoEllipsoids(P)) {
    const dy = (y - e.c[1]) / e.r[1];
    if (Math.abs(dy) >= 1) continue;
    const f = Math.sqrt(1 - dy * dy);
    rx = Math.max(rx, Math.abs(e.c[0]) + e.r[0] * f);
    zf = Math.max(zf, e.c[2] + e.r[2] * f);
    zb = Math.min(zb, e.c[2] - e.r[2] * f);
  }
  return { rx, zf, zb };
}

/** front surface z of the torso's centre line (x = 0) at height y: only the centred anatomy parts (no pecs / glutes) */
export function torsoCentreFront(P: Proportions, y: number): number {
  let zf = 0.03 * P.s;
  for (const e of torsoEllipsoids(P)) {
    if (Math.abs(e.c[0]) > 1e-6) continue;
    const dy = (y - e.c[1]) / e.r[1];
    if (Math.abs(dy) >= 1) continue;
    zf = Math.max(zf, e.c[2] + e.r[2] * Math.sqrt(1 - dy * dy));
  }
  return zf;
}

export interface TorsoShellOpts {
  y0: number;
  y1: number;
  /** angles about the vertical axis: 0 = front, + = character's left, π = back */
  a0: number;
  a1: number;
  /** outward offset from the body (m) */
  off: number;
  nA?: number;
  nY?: number;
  /** lower/upper edge modifiers (m, added to y at that angle fraction 0..1) */
  edge0?: (f: number) => number;
  edge1?: (f: number) => number;
  /** radius multiplier per height fraction (flare) */
  flare?: (f: number) => number;
  /** shape exponent of the cross-section (2 = ellipse, higher = squarer) */
  power?: number;
  /** add radial ripples (m) */
  ripple?: (a: number, y: number) => number;
}

/** a shell hugging the torso between two heights, over an angle range (cuirass, tassets, bands) */
export function torsoShell(P: Proportions, o: TorsoShellOpts): THREE.BufferGeometry {
  const nA = o.nA ?? 16;
  const nY = o.nY ?? 6;
  const pw = o.power ?? 2.4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nY; j++) {
    const fy = j / nY;
    for (let i = 0; i <= nA; i++) {
      const fa = i / nA;
      const a = o.a0 + (o.a1 - o.a0) * fa;
      let y = o.y0 + (o.y1 - o.y0) * fy;
      // edge modifiers shift the vertices near the lower/upper boundary
      if (o.edge0) y += o.edge0(fa) * (1 - fy);
      if (o.edge1) y += o.edge1(fa) * fy;
      const sec = torsoSection(P, y);
      const z0 = (sec.zf + sec.zb) / 2;
      const rz = (sec.zf - sec.zb) / 2;
      const fl = o.flare ? o.flare(fy) : 1;
      const rip = o.ripple ? o.ripple(a, y) : 0;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      // superellipse point at angle a
      const k = Math.pow(Math.pow(Math.abs(sa), pw) + Math.pow(Math.abs(ca), pw), 1 / pw) || 1;
      const x = (sa / k) * (sec.rx + o.off + rip) * fl;
      const z = z0 + (ca / k) * (rz + o.off + rip) * fl;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < nY; j++)
    for (let i = 0; i < nA; i++) {
      const a = j * (nA + 1) + i;
      const b = a + nA + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** point on the torso surface at (angle, height), pushed out by `off` along the radius (for placing studs / leaves) */
export function torsoPoint(P: Proportions, a: number, y: number, off = 0): V3 {
  const sec = torsoSection(P, y);
  const z0 = (sec.zf + sec.zb) / 2;
  const rz = (sec.zf - sec.zb) / 2;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const pw = 2.4;
  const k = Math.pow(Math.pow(Math.abs(sa), pw) + Math.pow(Math.abs(ca), pw), 1 / pw) || 1;
  return [(sa / k) * (sec.rx + off), y, z0 + (ca / k) * (rz + off)];
}

/** outward normal-ish direction of the torso at (angle, y) */
export function torsoNormal(P: Proportions, a: number, y: number): V3 {
  const p0 = torsoPoint(P, a, y, 0);
  const p1 = torsoPoint(P, a, y, 0.05);
  const d = new THREE.Vector3(p1[0] - p0[0], 0, p1[2] - p0[2]).normalize();
  return [d.x, 0, d.z];
}
