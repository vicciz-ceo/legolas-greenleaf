/**
 * Kit — geometry helpers.
 *
 *  - `meshDataToGeometry`  sculpted MeshData → BufferGeometry with kit attributes + skinning
 *  - `paintGeometry`       give any BufferGeometry (Lathe, Tube, Box…) the kit attributes so it
 *                          renders with the creature material and is rigidly skinned to one bone
 *  - `mergeKitGeometries`  concatenate kit geometries (sculpt + rigid gear) → ONE draw call
 */
import * as THREE from 'three';
import type { MeshData } from './mesher';
import { SURFACES, type SurfaceName, type SurfaceSpec } from './surfaces';

export const KIT_ATTRS = ['position', 'normal', 'color', 'surf', 'pat0', 'pat1', 'ao', 'skinIndex', 'skinWeight'] as const;
const SIZES: Record<(typeof KIT_ATTRS)[number], number> = {
  position: 3,
  normal: 3,
  color: 3,
  surf: 4,
  pat0: 4,
  pat1: 4,
  ao: 1,
  skinIndex: 4,
  skinWeight: 4,
};

export function meshDataToGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(d.surf, 4));
  g.setAttribute('pat0', new THREE.BufferAttribute(d.pat0, 4));
  g.setAttribute('pat1', new THREE.BufferAttribute(d.pat1, 4));
  g.setAttribute('ao', new THREE.BufferAttribute(d.ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(d.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

export interface PaintOpts {
  color: number;
  /** optional per-vertex colour function (model-space position, normal) → sRGB hex or linear rgb */
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
  mat?: SurfaceName | SurfaceSpec;
  /** bone index (rig.boneIndex(name)) */
  bone: number;
  /** optional second bone + weight function (0 → bone, 1 → bone2) */
  bone2?: number;
  weight2?: (p: THREE.Vector3) => number;
  ao?: number | ((p: THREE.Vector3, n: THREE.Vector3) => number);
  /** transform applied first (model space placement) */
  matrix?: THREE.Matrix4;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Convert any geometry to a non-indexed-or-indexed kit geometry: adds color/surf/pat/ao/skin
 * attributes, applies `matrix`. Returns a NEW geometry (input untouched).
 */
export function paintGeometry(src: THREE.BufferGeometry, o: PaintOpts): THREE.BufferGeometry {
  let g = src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (o.matrix) g.applyMatrix4(o.matrix);
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const n = g.attributes.position.count;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const spec: SurfaceSpec = typeof o.mat === 'string' ? SURFACES[o.mat] : o.mat ?? SURFACES.leather;
  const color = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  const pat0 = new Float32Array(n * 4);
  const pat1 = new Float32Array(n * 4);
  const ao = new Float32Array(n);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  _c.setHex(o.color, THREE.SRGBColorSpace);
  const base = [_c.r, _c.g, _c.b];
  for (let i = 0; i < n; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    if (o.colorFn) {
      _c.setRGB(base[0], base[1], base[2]);
      o.colorFn(_p, _n, _c);
      color[i * 3] = _c.r;
      color[i * 3 + 1] = _c.g;
      color[i * 3 + 2] = _c.b;
    } else {
      color[i * 3] = base[0];
      color[i * 3 + 1] = base[1];
      color[i * 3 + 2] = base[2];
    }
    surf[i * 4] = spec.rough;
    surf[i * 4 + 1] = spec.metal;
    surf[i * 4 + 2] = spec.sheen;
    surf[i * 4 + 3] = spec.skin;
    for (let j = 0; j < 4; j++) {
      pat0[i * 4 + j] = spec.pat[j];
      pat1[i * 4 + j] = spec.pat[4 + j];
    }
    ao[i] = typeof o.ao === 'function' ? o.ao(_p, _n) : o.ao ?? 1;
    si[i * 4] = o.bone;
    if (o.bone2 !== undefined && o.weight2) {
      const w = Math.min(1, Math.max(0, o.weight2(_p)));
      si[i * 4 + 1] = o.bone2;
      sw[i * 4] = 1 - w;
      sw[i * 4 + 1] = w;
    } else sw[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  g.setAttribute('pat0', new THREE.BufferAttribute(pat0, 4));
  g.setAttribute('pat1', new THREE.BufferAttribute(pat1, 4));
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // make the index Uint32 for merging
  const idx = g.index!;
  if (!(idx.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx.array as ArrayLike<number>), 1));
  return g;
}

/** Concatenate kit geometries (all must have KIT_ATTRS and an index). */
export function mergeKitGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index!.count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of KIT_ATTRS) {
    const size = SIZES[name];
    const arr = name === 'skinIndex' ? new Uint16Array(nv * size) : new Float32Array(nv * size);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[name] as THREE.BufferAttribute | undefined;
      const cnt = g.attributes.position.count;
      if (a) arr.set(a.array as ArrayLike<number>, o);
      else if (name === 'ao' || name === 'skinWeight') {
        for (let i = 0; i < cnt; i++) arr[o + i * size] = 1;
      }
      o += cnt * size;
    }
    out.setAttribute(name, name === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr, size) : new THREE.BufferAttribute(arr, size));
  }
  const index = new Uint32Array(ni);
  let io = 0;
  let vo = 0;
  for (const g of list) {
    const a = g.index!.array;
    for (let i = 0; i < a.length; i++) index[io + i] = a[i] + vo;
    io += a.length;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** triangle count of an indexed or non-indexed geometry */
export function triCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

/** matrix that maps a unit segment along local +Y (0 → 1) onto a → b; local +Z toward `up` */
export function segmentMatrix(a: readonly number[], b: readonly number[], up: readonly number[] = [0, 1, 0]): THREE.Matrix4 {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const y = B.clone().sub(A);
  const len = y.length() || 1e-6;
  y.divideScalar(len);
  const z = new THREE.Vector3(up[0], up[1], up[2]);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y.clone().multiplyScalar(len), z).setPosition(A);
}

/** tapered limb segment (unit length along +Y) as a lathe: radii r0 → r1, optional joint bulb */
export function limbSegment(r0: number, r1: number, len: number, bulb = 0, radial = 7, rings = 6): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.0001, 0)];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = r0 + (r1 - r0) * t + bulb * Math.exp(-Math.pow((t - 0.05) * 9, 2)) * r0;
    pts.push(new THREE.Vector2(Math.max(1e-4, r), t));
  }
  pts.push(new THREE.Vector2(0.0001, 1));
  const g = new THREE.LatheGeometry(pts, radial);
  void len;
  return g;
}
