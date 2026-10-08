/** Geometry helpers shared by props and architecture. All UVs are in tiles of `tile` metres. */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3, Rng } from '../core/rng';
import { bakeFaceBoxUV } from './util';

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

/** tapered cylinder from A (radius r0) to B (radius r1) with metre-based UVs (u around, v along) */
export function limbGeo(a: [number, number, number], b: [number, number, number], r0: number, r1: number, seg = 8, tile = 1, open = false): THREE.BufferGeometry {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const dir = _b.clone().sub(_a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(r0, r1);
  const sideCount = (seg + 1) * 2;
  for (let i = 0; i < uv.count; i++) {
    if (i < sideCount) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * len) / tile);
    else uv.setXY(i, (uv.getX(i) * 2 * Math.max(r0, r1)) / tile, (uv.getY(i) * 2 * Math.max(r0, r1)) / tile);
  }
  _q.setFromUnitVectors(_up, dir.normalize());
  _m.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** surface of revolution around Y. profile = [radius, y] from bottom to top. */
export function latheGeo(profile: [number, number][], seg = 24, tile = 1, swap = false): THREE.BufferGeometry {
  const pts = profile.map((p) => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(pts, seg);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // length along the profile for v, circumference of the widest ring for u
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const rmax = Math.max(...pts.map((p) => p.x));
  const circ = Math.PI * 2 * rmax;
  for (let i = 0; i < uv.count; i++) {
    const ring = i % pts.length;
    if (swap) uv.setXY(i, cum[ring] / tile, (uv.getX(i) * circ) / tile);
    else uv.setXY(i, (uv.getX(i) * circ) / tile, cum[ring] / tile);
  }
  return g;
}

/** transform matrix from position, yaw (about Y), optional pitch/roll and scale */
export function xf(x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0): THREE.Matrix4 {
  _e.set(pitch, yaw, roll, 'YXZ');
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(sx, sy, sz));
}

export interface RockOpts {
  /** vertical squash (default 0.72) */
  flat?: number;
  /** elongation along x (default 1..1.4 random) */
  stretch?: number;
  /** ridge / crack strength 0..1 */
  rough?: number;
  detail?: number;
  /** moss tint on upward faces */
  moss?: number;
  /** flatten the bottom so the rock sits on the ground */
  sit?: boolean;
  tile?: number;
}

const rockCache = new Map<string, THREE.BufferGeometry>();

/** displaced icosphere rock, unit size (radius ~1), per-face box UVs, optional moss vertex colours */
export function rockGeometry(seed: number, o: RockOpts = {}): THREE.BufferGeometry {
  const key = `${seed}|${o.flat}|${o.stretch}|${o.rough}|${o.detail}|${o.moss}|${o.sit}|${o.tile}`;
  const hit = rockCache.get(key);
  if (hit) return hit;
  const rng = new Rng(seed * 977 + 13);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const flat = o.flat ?? 0.72;
  const stretch = o.stretch ?? 1 + rng.float() * 0.4;
  const rough = o.rough ?? 0.6;
  const sx = stretch;
  const sz = 0.8 + rng.float() * 0.3;
  const p = new THREE.Vector3();
  const ox = rng.float() * 50;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const big = fbm3(p.x * 1.3 + ox, p.y * 1.3, p.z * 1.3, 3, 3);
    const ridge = 1 - Math.abs(fbm3(p.x * 3.1 + ox, p.y * 3.1 + 4, p.z * 3.1, 3, 7));
    const fine = fbm3(p.x * 9 + ox, p.y * 9, p.z * 9 + 2, 2, 9);
    // faceted look: quantise a little along a few directions
    const r = 1 + big * 0.35 + (ridge - 0.7) * 0.22 * rough + fine * 0.035 * rough;
    p.multiplyScalar(r);
    p.x *= sx;
    p.z *= sz;
    p.y *= flat;
    if (o.sit !== false && p.y < -0.42 * flat) p.y = -0.42 * flat + (p.y + 0.42 * flat) * 0.08;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  // moss on upward facing vertices
  if (o.moss) {
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const up = nor.getY(i);
      const n = fbm3(pos.getX(i) * 2.2 + ox, pos.getY(i) * 2.2, pos.getZ(i) * 2.2, 3, 5) * 0.5 + 0.5;
      const m = Math.max(0, Math.min(1, ((up - 0.45) * 2.0 + (n - 0.5) * 1.0) * o.moss));
      col[i * 3] = 1 - m * 0.42;
      col[i * 3 + 1] = 1 - m * 0.08;
      col[i * 3 + 2] = 1 - m * 0.46;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g = bakeFaceBoxUV(g, o.tile ?? 3.4, rng.float(), rng.float());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  rockCache.set(key, g);
  return g;
}

/** merge simple geometries sharing position / normal / uv into one */
export function transformGeo(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  g.applyMatrix4(m);
  return g;
}

export interface CliffOpts {
  /** displacement strength 0..1 (default 0.6) */
  rough?: number;
  /** how much the top narrows (0 = straight walls, 0.4 = pronounced taper) */
  taper?: number;
  /** horizontal strata strength */
  strata?: number;
  /** metres per grid cell (default 2.5) */
  cell?: number;
  tile?: number;
}

/** craggy block: a subdivided box displaced along its normals with ridged noise and strata. Centred on the origin. */
export function cliffGeometry(w: number, h: number, d: number, seed = 1, o: CliffOpts = {}): THREE.BufferGeometry {
  const cell = o.cell ?? 2.5;
  const sx = Math.max(2, Math.round(w / cell));
  const sy = Math.max(2, Math.round(h / cell));
  const sz = Math.max(2, Math.round(d / cell));
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const rough = o.rough ?? 0.6;
  const taper = o.taper ?? 0;
  const strata = o.strata ?? 0.5;
  const amp = Math.min(w, d) * 0.1 * rough + 0.5;
  const ox = seed * 17.3;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const big = fbm3(x * 0.045 + ox, y * 0.03, z * 0.045, 3, 5);
    const ridge = 1 - Math.abs(fbm3(x * 0.11 + ox, y * 0.07, z * 0.11, 3, 8));
    const fine = fbm3(x * 0.35, y * 0.3 + ox, z * 0.35, 2, 9);
    const step = Math.sin(y * 0.55 + big * 3) * strata * 0.45;
    const d0 = (big * 1.2 + (ridge - 0.65) * 1.1 + fine * 0.18 + step) * amp;
    // keep the base and top edges roughly in place
    x += nx * d0;
    y += ny * d0 * 0.4;
    z += nz * d0;
    const t = (y + h / 2) / h;
    const k = 1 - taper * Math.max(0, Math.min(1, t));
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  g = bakeFaceBoxUV(g, o.tile ?? 5, 0, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
