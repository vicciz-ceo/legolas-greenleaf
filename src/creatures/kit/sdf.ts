/**
 * Kit — SDF sculpting.
 *
 * A `Sculpt` collects signed-distance primitives (round cones / capsules between two points,
 * ellipsoids, rounded boxes, tori, planes) combined with smooth union / subtraction /
 * intersection (blend radius `k`), plus `paint` primitives that only change colour/material.
 * Every primitive carries:
 *   - the bone(s) it is skinned to (optionally blended along a segment),
 *   - a colour and a surface preset (skin, cloth, leather, chitin, …, see material.ts),
 *   - optional noise displacement (fbm, ridged wrinkles, cells for scales/warts, dents).
 *
 * `compile()` turns it into a flat, typed-array `SdfProgram` that the mesher evaluates.
 * All coordinates are model space at the rig's rest pose (metres, +Y up, facing +Z).
 */
import * as THREE from 'three';
import { noise3 } from '../../core/rng';
import { SURFACES, type SurfaceName, type SurfaceSpec } from './surfaces';

export type V3 = readonly [number, number, number];
export type SdfOp = 'union' | 'subtract' | 'intersect' | 'paint';
export type NoiseType = 'fbm' | 'ridged' | 'cells' | 'dents';

export interface NoiseDef {
  /** displacement amplitude (m). Positive = bumps outward. */
  amp: number;
  /** spatial frequency (1/m) */
  freq: number;
  type?: NoiseType;
  /** fbm octaves (1..5, default 3) */
  octaves?: number;
  seed?: number;
}

export interface PrimOpts {
  op?: SdfOp;
  /** smooth blend radius (m). 0 = hard. */
  k?: number;
  /** bone this primitive is skinned to */
  bone?: string;
  /** optional second bone: weights blend bone → bone2 along the primitive's axis (a→b for cones) */
  bone2?: string;
  /** normalised range along the axis where the bone→bone2 blend happens (default [0.3, 1]) */
  blend?: [number, number];
  /** explicit blend axis (model space) for non-cone primitives */
  blendAxis?: [V3, V3];
  /** skin-weight blend radius against what came before (default max(k, sculpt.skinK)) */
  skinK?: number;
  /** sRGB colour */
  color?: number;
  /** second colour mixed in by noise (blotches, dirt, freckles) */
  color2?: number;
  /** 0..1 amount of color2 noise */
  colorNoise?: number;
  /** colour noise frequency (1/m, default 30) */
  colorFreq?: number;
  /** surface preset or explicit spec */
  mat?: SurfaceName | SurfaceSpec;
  noise?: NoiseDef | null;
  /** paint ops: 0..1 strength (default 1). Paint fades out over `k` outside the primitive. */
  strength?: number;
  /** subtract/intersect: also repaint the carved surface (default false: keeps the base attributes) */
  paintCarve?: boolean;
  /**
   * paint ops only: instead of colour/material, write this primitive's signed distance (minus the
   * given offset, metres) into the per-vertex `seam` channel. Linear interpolation of a distance is
   * exact for planes, so the shader draws crisp stitch lines and edge wear along garment edges at
   * any mesh resolution (stitches at seam ≈ −stitchInset, wear where |seam| is small). Put it inside
   * the garment's group so it only affects that garment. See material.ts (`seam`).
   */
  seam?: number;
  /** rotation: Euler XYZ (radians) or a quaternion (ellipsoid, box, torus) */
  rot?: V3 | THREE.Quaternion;
  /** debug label */
  tag?: string;
}

export const PRIM_STRIDE = 32;
export const ATTR_STRIDE = 24;
export const BONE_STRIDE = 12;

const T_CONE = 0;
const T_ELLIPSOID = 1;
const T_BOX = 2;
const T_TORUS = 3;
const T_PLANE = 4;

const OP: Record<SdfOp, number> = { union: 0, subtract: 1, intersect: 2, paint: 3 };
const NOISE: Record<NoiseType, number> = { fbm: 0, ridged: 1, cells: 2, dents: 3 };

interface PrimRec {
  type: number;
  geo: number[];
  rotInv: number[] | null;
  bounds: [number, number, number, number, number, number];
  o: PrimOpts;
  bone: number;
  bone2: number;
  axisA: V3;
  axisB: V3;
}

type Node = { kind: 'prim'; i: number } | { kind: 'group'; op: SdfOp; k: number; skinK: number; children: Node[] };

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

function srgbToLinear(hex: number): [number, number, number] {
  _c.setHex(hex, THREE.SRGBColorSpace);
  return [_c.r, _c.g, _c.b];
}

function rotInverse(rot: V3 | THREE.Quaternion | undefined, mirror: boolean): number[] | null {
  if (!rot) return null;
  if (rot instanceof THREE.Quaternion) _q.copy(rot);
  else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ'));
  if (mirror) {
    // reflect across the YZ plane: (x, y, z, w) → (x, -y, -z, w)
    _q.set(_q.x, -_q.y, -_q.z, _q.w);
  }
  if (Math.abs(_q.w) > 0.999999) return null;
  _m.makeRotationFromQuaternion(_q).transpose(); // inverse rotation
  const e = _m.elements; // column-major
  // row-major 3x3 of the inverse: r[row*3+col] = e[col*4+row]
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

function maxAbs(v: V3) {
  return Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
}

/** Rig-like lookup the sculpt uses to resolve bone names → indices. */
export interface BoneIndexer {
  boneIndex(name: string): number;
  boneNames: readonly string[];
}

/**
 * Builder for SDF creatures. Typical use:
 * ```ts
 * const s = new Sculpt(rig);
 * s.set({ bone: 'chest', color: 0x7a5a3a, mat: 'leather' });
 * s.ellipsoid([0, 1.3, 0], [0.16, 0.18, 0.11]);
 * s.mirrored(() => s.capsule(rig.at('upperarm_l'), rig.at('forearm_l'), 0.05, { bone: 'upperarm_l', k: 0.03 }));
 * ```
 */
export class Sculpt {
  private prims: PrimRec[] = [];
  private root: Node[] = [];
  private stack: Node[][] = [];
  private defaults: PrimOpts = {};
  private mirror = false;
  /** default skin-weight blend radius (m) */
  skinK: number;
  readonly rig: BoneIndexer;

  constructor(rig: BoneIndexer, opts: { skinK?: number } = {}) {
    this.rig = rig;
    this.skinK = opts.skinK ?? 0.04;
  }

  get primCount() {
    return this.prims.length;
  }

  /** set defaults applied to every following primitive (merged) */
  set(o: PrimOpts): this {
    this.defaults = { ...this.defaults, ...o };
    return this;
  }
  /** run fn with temporarily merged defaults */
  with(o: PrimOpts, fn: () => void): this {
    const prev = this.defaults;
    this.defaults = { ...prev, ...o };
    try {
      fn();
    } finally {
      this.defaults = prev;
    }
    return this;
  }
  /** run fn twice: as written (left side, +X) and mirrored across X with _l/_r bone names swapped */
  mirrored(fn: (side: 1 | -1, s: 'l' | 'r') => void): this {
    fn(1, 'l');
    const prev = this.mirror;
    this.mirror = !prev;
    try {
      fn(-1, 'r');
    } finally {
      this.mirror = prev;
    }
    return this;
  }
  get isMirrored() {
    return this.mirror;
  }

  /** nested group: children are combined first, then the group result is combined with `op`/`k` */
  group(op: SdfOp, k: number, fn: () => void, o: { skinK?: number } = {}): this {
    const g: Node = { kind: 'group', op, k, skinK: o.skinK ?? Math.max(k, this.skinK), children: [] };
    this.cur().push(g);
    this.stack.push(g.children);
    try {
      fn();
    } finally {
      this.stack.pop();
    }
    return this;
  }

  private cur(): Node[] {
    return this.stack.length ? this.stack[this.stack.length - 1] : this.root;
  }

  private mp(p: V3): V3 {
    return this.mirror ? [-p[0], p[1], p[2]] : p;
  }
  private mbone(name: string | undefined): number {
    if (!name) return 0;
    let n = name;
    if (this.mirror) {
      if (n.endsWith('_l')) n = n.slice(0, -2) + '_r';
      else if (n.endsWith('_r')) n = n.slice(0, -2) + '_l';
      else if (n.includes('_l_')) n = n.replace('_l_', '_r_');
      else if (n.includes('_r_')) n = n.replace('_r_', '_l_');
    }
    const i = this.rig.boneIndex(n);
    if (i < 0) throw new Error(`[kit] unknown bone "${n}"`);
    return i;
  }

  private add(type: number, geo: number[], bounds: PrimRec['bounds'], o: PrimOpts | undefined, axisA: V3, axisB: V3, rot: number[] | null) {
    const opts: PrimOpts = { ...this.defaults, ...(o ?? {}) };
    const k = opts.k ?? 0;
    const amp = opts.noise ? Math.abs(opts.noise.amp) * 1.25 : 0;
    const pad = (opts.op === 'paint' ? k : k * 0.5) + amp;
    bounds = [bounds[0] - pad, bounds[1] - pad, bounds[2] - pad, bounds[3] + pad, bounds[4] + pad, bounds[5] + pad];
    let ax = axisA;
    let bx = axisB;
    if (opts.blendAxis) {
      ax = this.mp(opts.blendAxis[0]);
      bx = this.mp(opts.blendAxis[1]);
    }
    const rec: PrimRec = {
      type,
      geo,
      rotInv: rot,
      bounds,
      o: opts,
      bone: this.mbone(opts.bone),
      bone2: opts.bone2 ? this.mbone(opts.bone2) : -1,
      axisA: ax,
      axisB: bx,
    };
    this.prims.push(rec);
    this.cur().push({ kind: 'prim', i: this.prims.length - 1 });
    return this;
  }

  /** round cone between a (radius ra) and b (radius rb) */
  cone(a: V3, b: V3, ra: number, rb: number, o?: PrimOpts): this {
    a = this.mp(a);
    b = this.mp(b);
    const bounds: PrimRec['bounds'] = [
      Math.min(a[0] - ra, b[0] - rb),
      Math.min(a[1] - ra, b[1] - rb),
      Math.min(a[2] - ra, b[2] - rb),
      Math.max(a[0] + ra, b[0] + rb),
      Math.max(a[1] + ra, b[1] + rb),
      Math.max(a[2] + ra, b[2] + rb),
    ];
    return this.add(T_CONE, [a[0], a[1], a[2], b[0], b[1], b[2], ra, rb], bounds, o, a, b, null);
  }
  capsule(a: V3, b: V3, r: number, o?: PrimOpts): this {
    return this.cone(a, b, r, r, o);
  }
  sphere(c: V3, r: number, o?: PrimOpts): this {
    return this.cone(c, [c[0], c[1] + 1e-4, c[2]], r, r, o);
  }
  /** chain of round cones through points with per-point radii (tails, horns, tentacles, legs) */
  tube(points: V3[], radii: number[], o?: PrimOpts): this {
    for (let i = 0; i + 1 < points.length; i++) this.cone(points[i], points[i + 1], radii[i], radii[i + 1], o);
    return this;
  }
  ellipsoid(c: V3, r: V3, o?: PrimOpts): this {
    c = this.mp(c);
    const rot = rotInverse(o?.rot ?? this.defaults.rot, this.mirror);
    const e = rot ? [maxAbs(r), maxAbs(r), maxAbs(r)] : [r[0], r[1], r[2]];
    const bounds: PrimRec['bounds'] = [c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]];
    return this.add(T_ELLIPSOID, [c[0], c[1], c[2], r[0], r[1], r[2]], bounds, o, [c[0], c[1] - r[1], c[2]], [c[0], c[1] + r[1], c[2]], rot);
  }
  /** rounded box: half extents (including the rounding), corner radius */
  box(c: V3, half: V3, round: number, o?: PrimOpts): this {
    c = this.mp(c);
    const rot = rotInverse(o?.rot ?? this.defaults.rot, this.mirror);
    const L = Math.hypot(half[0], half[1], half[2]);
    const e = rot ? [L, L, L] : [half[0], half[1], half[2]];
    const bounds: PrimRec['bounds'] = [c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]];
    return this.add(T_BOX, [c[0], c[1], c[2], half[0], half[1], half[2], Math.min(round, half[0], half[1], half[2])], bounds, o, [c[0], c[1] - half[1], c[2]], [c[0], c[1] + half[1], c[2]], rot);
  }
  /** torus lying in the local XZ plane (axis = local +Y; rotate with `rot`) */
  torus(c: V3, R: number, r: number, o?: PrimOpts): this {
    c = this.mp(c);
    const rot = rotInverse(o?.rot ?? this.defaults.rot, this.mirror);
    const e = R + r;
    const bounds: PrimRec['bounds'] = [c[0] - e, c[1] - e, c[2] - e, c[0] + e, c[1] + e, c[2] + e];
    return this.add(T_TORUS, [c[0], c[1], c[2], R, r], bounds, o, [c[0], c[1] - r, c[2]], [c[0], c[1] + r, c[2]], rot);
  }
  /** half-space: dot(n, p) - d <= 0 is solid. Use with op 'intersect' (cuts) or 'subtract'. */
  plane(n: V3, d: number, o?: PrimOpts): this {
    const nn = this.mirror ? [-n[0], n[1], n[2]] : [n[0], n[1], n[2]];
    const L = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    const B = 1e3;
    return this.add(T_PLANE, [nn[0] / L, nn[1] / L, nn[2] / L, d / L], [-B, -B, -B, B, B, B], o, [0, 0, 0], [0, 1, 0], null);
  }

  private _hash: string | null = null;
  private _hashN = -1;
  /** stable content hash of everything that affects the mesh (memoised until primitives change) */
  hash(): string {
    if (this._hash && this._hashN === this.prims.length) return this._hash;
    this._hash = this.computeHash();
    this._hashN = this.prims.length;
    return this._hash;
  }
  private computeHash(): string {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => {
      // quantise to 0.01 mm so float noise does not split the cache
      const q = Math.round(v * 1e5) | 0;
      h ^= q & 0xffff;
      h = Math.imul(h, 16777619);
      h ^= q >>> 16;
      h = Math.imul(h, 16777619);
    };
    const mixS = (s: string) => {
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    };
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.kind === 'group') {
          mixS('G' + n.op);
          mix(n.k);
          mix(n.skinK);
          walk(n.children);
          mixS('E');
          continue;
        }
        const p = this.prims[n.i];
        mix(p.type);
        for (const g of p.geo) mix(g);
        if (p.rotInv) for (const g of p.rotInv) mix(g);
        mix(p.bone);
        mix(p.bone2);
        const o = p.o;
        mixS(o.op ?? 'u');
        mix(o.k ?? 0);
        mix(o.skinK ?? -1);
        mix(o.color ?? -1);
        mix(o.color2 ?? -1);
        mix(o.colorNoise ?? 0);
        mix(o.colorFreq ?? 0);
        mix(o.strength ?? 1);
        mix(o.paintCarve ? 1 : 0);
        mix(o.seam ?? -9);
        if (o.blend) {
          mix(o.blend[0]);
          mix(o.blend[1]);
        }
        for (const v of [...p.axisA, ...p.axisB]) mix(v);
        const m = o.mat;
        if (typeof m === 'string') mixS(m);
        else if (m) for (const v of [m.rough, m.metal, m.sheen, m.skin, ...m.pat]) mix(v);
        if (o.noise) {
          mix(o.noise.amp);
          mix(o.noise.freq);
          mixS(o.noise.type ?? 'fbm');
          mix(o.noise.octaves ?? 3);
          mix(o.noise.seed ?? 0);
        }
      }
    };
    walk(this.root);
    mix(this.skinK);
    mixS(this.rig.boneNames.join(','));
    return (h >>> 0).toString(36) + '_' + this.prims.length;
  }

  compile(): SdfProgram {
    return new SdfProgram(this.prims, this.root, this.skinK, this.rig.boneNames.length);
  }
}

/** plain, structured-cloneable form of an SdfProgram (worker transfer) */
export interface SdfProgramData {
  n: number;
  PF: Float64Array;
  PA: Float32Array;
  PB: Float64Array;
  bounds: Float64Array;
  code: Int32Array;
  groupOp: Int32Array;
  groupK: Float64Array;
  groupSkinK: Float64Array;
  groupBounds: Float64Array;
  groupEnd: Int32Array;
  maxNoise: number;
  boneCount: number;
  hasPaint: boolean;
  solidBounds: [number, number, number, number, number, number];
}

/**
 * Compiled SDF. Primitive parameters live in typed arrays; groups are encoded as
 * instructions (>=0 prim index, -1 BEGIN, -(2+g) END of group g).
 */
export class SdfProgram {
  /** plain data copy for postMessage (the mesher runs in a worker pool) */
  toData(): SdfProgramData {
    return {
      n: this.n,
      PF: this.PF,
      PA: this.PA,
      PB: this.PB,
      bounds: this.bounds,
      code: this.code,
      groupOp: this.groupOp,
      groupK: this.groupK,
      groupSkinK: this.groupSkinK,
      groupBounds: this.groupBounds,
      groupEnd: this.groupEnd,
      maxNoise: this.maxNoise,
      boneCount: this.boneCount,
      hasPaint: this.hasPaint,
      solidBounds: this.solidBounds,
    };
  }
  /** rebuild a program from `toData()` output (inside a worker) */
  static fromData(d: SdfProgramData): SdfProgram {
    const p = Object.create(SdfProgram.prototype) as SdfProgram;
    Object.assign(p, d);
    return p;
  }

  readonly n: number;
  readonly PF: Float64Array; // geometry & op params
  readonly PA: Float32Array; // attributes
  readonly PB: Float64Array; // bone params
  readonly bounds: Float64Array; // 6 per prim
  readonly code: Int32Array;
  readonly groupOp: Int32Array;
  readonly groupK: Float64Array;
  readonly groupSkinK: Float64Array;
  readonly groupBounds: Float64Array;
  readonly groupEnd: Int32Array; // instruction index of END for the BEGIN at index i (or -1)
  readonly maxNoise: number;
  readonly boneCount: number;
  readonly hasPaint: boolean;
  /** overall bounds of solid primitives */
  readonly solidBounds: [number, number, number, number, number, number];

  constructor(prims: PrimRec[], root: Node[], skinKDefault: number, boneCount: number) {
    this.boneCount = boneCount;
    const n = prims.length;
    this.n = n;
    this.PF = new Float64Array(n * PRIM_STRIDE);
    this.PA = new Float32Array(n * ATTR_STRIDE);
    this.PB = new Float64Array(n * BONE_STRIDE);
    this.bounds = new Float64Array(n * 6);
    let maxNoise = 0;
    let hasPaint = false;
    const sb: [number, number, number, number, number, number] = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    prims.forEach((p, i) => {
      const o = i * PRIM_STRIDE;
      const F = this.PF;
      const op = OP[p.o.op ?? 'union'];
      if (op === 3) hasPaint = true;
      F[o] = p.type;
      F[o + 1] = op;
      F[o + 2] = Math.max(0, p.o.k ?? 0);
      F[o + 3] = p.o.skinK ?? Math.max(p.o.k ?? 0, skinKDefault);
      const nz = p.o.noise;
      if (nz && nz.amp !== 0) {
        F[o + 4] = nz.amp;
        F[o + 5] = nz.freq;
        F[o + 6] = NOISE[nz.type ?? 'fbm'];
        F[o + 7] = Math.max(1, Math.min(5, nz.octaves ?? 3));
        F[o + 8] = (nz.seed ?? 0) * 17.31 + 3.7;
        maxNoise = Math.max(maxNoise, Math.abs(nz.amp));
      }
      const g = p.geo;
      // bounding sphere for early-outs (slots 26..29)
      {
        let cx = 0, cy = 0, cz = 0, R = 1e9;
        if (p.type === T_CONE) {
          cx = (g[0] + g[3]) / 2; cy = (g[1] + g[4]) / 2; cz = (g[2] + g[5]) / 2;
          R = Math.hypot(g[3] - g[0], g[4] - g[1], g[5] - g[2]) / 2 + Math.max(g[6], g[7]);
        } else if (p.type === T_ELLIPSOID) {
          cx = g[0]; cy = g[1]; cz = g[2]; R = Math.max(g[3], g[4], g[5]);
        } else if (p.type === T_BOX) {
          cx = g[0]; cy = g[1]; cz = g[2]; R = Math.hypot(g[3], g[4], g[5]);
        } else if (p.type === T_TORUS) {
          cx = g[0]; cy = g[1]; cz = g[2]; R = g[3] + g[4];
        }
        F[o + 26] = cx; F[o + 27] = cy; F[o + 28] = cz;
        F[o + 29] = R + (nz ? Math.abs(nz.amp) * 1.3 : 0);
      }
      if (p.type === T_CONE) {
        let [ax, ay, az, bx, by, bz, r1, r2] = g;
        let l = Math.hypot(bx - ax, by - ay, bz - az);
        // degenerate (one sphere inside the other): collapse to the larger sphere
        if (l <= Math.abs(r1 - r2) + 1e-5) {
          if (r1 >= r2) {
            bx = ax; by = ay + 1e-4; bz = az; r2 = r1;
          } else {
            ax = bx; ay = by - 1e-4; az = bz; r1 = r2;
          }
          l = Math.hypot(bx - ax, by - ay, bz - az);
        }
        const bax = bx - ax, bay = by - ay, baz = bz - az;
        const l2 = bax * bax + bay * bay + baz * baz;
        const rr = r1 - r2;
        F[o + 10] = ax; F[o + 11] = ay; F[o + 12] = az;
        F[o + 13] = bax; F[o + 14] = bay; F[o + 15] = baz;
        F[o + 16] = r1; F[o + 17] = r2;
        F[o + 18] = l2; F[o + 19] = rr; F[o + 20] = l2 - rr * rr; F[o + 21] = 1 / l2;
      } else if (p.type === T_PLANE) {
        F[o + 10] = g[0]; F[o + 11] = g[1]; F[o + 12] = g[2]; F[o + 13] = g[3];
      } else {
        for (let j = 0; j < Math.min(g.length, 6); j++) F[o + 10 + j] = g[j];
        if (p.type === T_BOX) F[o + 30] = g[6];
        if (p.rotInv) {
          F[o + 25] = 1;
          for (let j = 0; j < 9; j++) F[o + 16 + j] = p.rotInv[j];
        }
      }
      // attributes
      const A = this.PA;
      const a = i * ATTR_STRIDE;
      const col = srgbToLinear(p.o.color ?? 0xb0a090);
      A[a] = col[0]; A[a + 1] = col[1]; A[a + 2] = col[2];
      const ms = p.o.mat;
      const spec: SurfaceSpec = typeof ms === 'string' ? SURFACES[ms] : ms ?? SURFACES.skin;
      A[a + 3] = spec.rough; A[a + 4] = spec.metal; A[a + 5] = spec.sheen; A[a + 6] = spec.skin;
      for (let j = 0; j < 8; j++) A[a + 7 + j] = spec.pat[j] ?? 0;
      A[a + 15] = p.o.strength ?? 1;
      if (p.o.color2 !== undefined && (p.o.colorNoise ?? 0) > 0) {
        const c2 = srgbToLinear(p.o.color2);
        A[a + 16] = c2[0]; A[a + 17] = c2[1]; A[a + 18] = c2[2];
        A[a + 19] = p.o.colorNoise ?? 0;
        A[a + 20] = p.o.colorFreq ?? 30;
      }
      A[a + 21] = p.o.paintCarve ? 1 : 0;
      A[a + 22] = p.o.seam !== undefined && op === 3 ? 1 : 0;
      A[a + 23] = p.o.seam ?? 0;
      // bones
      const B = this.PB;
      const b = i * BONE_STRIDE;
      B[b] = p.bone;
      B[b + 1] = p.bone2;
      const bl = p.o.blend ?? [0.3, 1];
      B[b + 2] = bl[0];
      B[b + 3] = Math.max(bl[1], bl[0] + 1e-3);
      B[b + 4] = p.axisA[0]; B[b + 5] = p.axisA[1]; B[b + 6] = p.axisA[2];
      const dx = p.axisB[0] - p.axisA[0], dy = p.axisB[1] - p.axisA[1], dz = p.axisB[2] - p.axisA[2];
      B[b + 7] = dx; B[b + 8] = dy; B[b + 9] = dz;
      B[b + 10] = 1 / Math.max(1e-9, dx * dx + dy * dy + dz * dz);
      for (let j = 0; j < 6; j++) this.bounds[i * 6 + j] = p.bounds[j];
      if (op === 0 && p.type !== T_PLANE) {
        for (let j = 0; j < 3; j++) {
          sb[j] = Math.min(sb[j], p.bounds[j]);
          sb[j + 3] = Math.max(sb[j + 3], p.bounds[j + 3]);
        }
      }
    });
    this.maxNoise = maxNoise;
    this.hasPaint = hasPaint;
    this.solidBounds = sb;

    // flatten program
    const code: number[] = [];
    const gOp: number[] = [];
    const gK: number[] = [];
    const gSK: number[] = [];
    const gB: number[] = [];
    const flatten = (nodes: Node[]): [number, number, number, number, number, number] => {
      const bb: [number, number, number, number, number, number] = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
      for (const nd of nodes) {
        let cb: number[];
        let op: number;
        if (nd.kind === 'prim') {
          code.push(nd.i);
          cb = prims[nd.i].bounds;
          op = OP[prims[nd.i].o.op ?? 'union'];
        } else {
          const gi = gOp.length;
          gOp.push(OP[nd.op]);
          gK.push(nd.k);
          gSK.push(nd.skinK);
          gB.push(0, 0, 0, 0, 0, 0);
          code.push(-1);
          const inner = flatten(nd.children);
          const pad = nd.k * 0.5;
          for (let j = 0; j < 3; j++) {
            gB[gi * 6 + j] = inner[j] - pad;
            gB[gi * 6 + 3 + j] = inner[j + 3] + pad;
          }
          code.push(-(2 + gi));
          cb = gB.slice(gi * 6, gi * 6 + 6);
          op = OP[nd.op];
        }
        if (op === 0) {
          for (let j = 0; j < 3; j++) {
            bb[j] = Math.min(bb[j], cb[j]);
            bb[j + 3] = Math.max(bb[j + 3], cb[j + 3]);
          }
        }
      }
      return bb;
    };
    flatten(root);
    this.code = Int32Array.from(code);
    this.groupOp = Int32Array.from(gOp);
    this.groupK = Float64Array.from(gK);
    this.groupSkinK = Float64Array.from(gSK);
    this.groupBounds = Float64Array.from(gB);
    this.groupEnd = new Int32Array(code.length).fill(-1);
    const st: number[] = [];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === -1) st.push(i);
      else if (code[i] <= -2) this.groupEnd[st.pop()!] = i;
    }
  }

  /**
   * Instructions relevant to an AABB. Union/subtract/paint primitives and groups whose bounds miss
   * the box are dropped; intersect primitives are always kept.
   */
  cull(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]): number {
    out.length = 0;
    const code = this.code;
    const B = this.bounds;
    const F = this.PF;
    let unions = 0;
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (c >= 0) {
        const op = F[c * PRIM_STRIDE + 1];
        const o = c * 6;
        const hit = !(B[o] > x1 || B[o + 3] < x0 || B[o + 1] > y1 || B[o + 4] < y0 || B[o + 2] > z1 || B[o + 5] < z0);
        if (hit || op === 2) {
          out.push(c);
          if (op === 0 && hit) unions++;
        }
      } else if (c === -1) {
        // find group index from END
        const end = this.groupEnd[i];
        const gi = -code[end] - 2;
        const op = this.groupOp[gi];
        const o = gi * 6;
        const G = this.groupBounds;
        const hit = !(G[o] > x1 || G[o + 3] < x0 || G[o + 1] > y1 || G[o + 4] < y0 || G[o + 2] > z1 || G[o + 5] < z0);
        if (!hit && op !== 2) {
          i = end; // skip whole group
          continue;
        }
        out.push(-1);
      } else out.push(c);
    }
    return unions;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation (hot paths). Closures over the program's typed arrays.
// ─────────────────────────────────────────────────────────────────────────────

/** 3D cellular (Worley F1) noise, deterministic. Returns distance to the nearest feature point in cell units. */
function hash3(x: number, y: number, z: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function cellular3(x: number, y: number, z: number, seed: number): number {
  // 2×2×2 search with feature points jittered in [0.15, 0.85] (cheap, near-exact F1)
  const ix = Math.floor(x - 0.5), iy = Math.floor(y - 0.5), iz = Math.floor(z - 0.5);
  let best = 9;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const fx = cx + 0.15 + 0.7 * hash3(cx, cy, cz, seed) - x;
        const fy = cy + 0.15 + 0.7 * hash3(cx, cy, cz, seed + 1) - y;
        const fz = cz + 0.15 + 0.7 * hash3(cx, cy, cz, seed + 2) - z;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < best) best = d;
      }
  return Math.sqrt(best);
}

export interface Evaluator {
  /** distance only */
  dist(x: number, y: number, z: number, list: Int32Array, start: number, end: number): number;
  /** distance + attributes (into attr[0..15]) + sparse bone weights (into bw: Float64Array(boneCount)) */
  full(x: number, y: number, z: number, list: Int32Array, start: number, end: number, attr: Float64Array, bw: Float64Array): number;
}

export const ATTR_COUNT = 17; // r g b | rough metal sheen skin | pat0..7 | seam distance, seam flag

export function makeEvaluator(prog: SdfProgram): Evaluator {
  const PF = prog.PF;
  const PA = prog.PA;
  const PB = prog.PB;
  const gOp = prog.groupOp;
  const gK = prog.groupK;
  const gSK = prog.groupSkinK;
  const nb = prog.boneCount;
  const n3 = noise3(9173);
  const nc3 = noise3(4421);

  // one-entry cache: consecutive primitives with the same noise at the same point reuse it
  let cX = NaN, cY = NaN, cZ = NaN, cF = NaN, cT = NaN, cS = NaN, cO = NaN, cV = 0;
  function noiseAt(o: number, x: number, y: number, z: number): number {
    const amp = PF[o + 4];
    const f = PF[o + 5];
    const t = PF[o + 6];
    const s = PF[o + 8];
    if (x === cX && y === cY && z === cZ && f === cF && t === cT && s === cS && PF[o + 7] === cO) return amp * cV;
    const v = noiseRaw(o, x, y, z, f, t, s);
    cX = x; cY = y; cZ = z; cF = f; cT = t; cS = s; cO = PF[o + 7]; cV = v;
    return amp * v;
  }
  function noiseRaw(o: number, x: number, y: number, z: number, f: number, t: number, s: number): number {
    const amp = 1;
    const px = x * f + s, py = y * f - s * 0.7, pz = z * f + s * 0.3;
    if (t === 0) {
      const oct = PF[o + 7];
      let sum = 0, a = 0.5, fr = 1, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += a * n3(px * fr, py * fr, pz * fr);
        norm += a;
        a *= 0.5;
        fr *= 2.03;
      }
      return amp * (sum / norm);
    }
    if (t === 1) {
      const oct = PF[o + 7];
      let sum = 0, a = 0.5, fr = 1, norm = 0;
      for (let i = 0; i < oct; i++) {
        const r = 1 - Math.abs(n3(px * fr, py * fr, pz * fr));
        sum += a * r * r;
        norm += a;
        a *= 0.5;
        fr *= 2.03;
      }
      return amp * (sum / norm - 0.35);
    }
    const c = cellular3(px, py, pz, (s * 13) | 0);
    const bump = 1 - Math.min(1, c * 1.35);
    return t === 2 ? amp * (bump * bump - 0.15) : -amp * (bump * bump - 0.15);
  }

  function primDist(i: number, x: number, y: number, z: number): number {
    const d = primBase(i, x, y, z);
    const o = i * PRIM_STRIDE;
    return PF[o + 4] !== 0 ? d - noiseAt(o, x, y, z) : d;
  }

  /** distance of primitive i without its noise displacement (|noise| ≤ 1.3·amp) */
  function primBase(i: number, x: number, y: number, z: number): number {
    const o = i * PRIM_STRIDE;
    const t = PF[o];
    let d: number;
    if (t === 0) {
      const pax = x - PF[o + 10], pay = y - PF[o + 11], paz = z - PF[o + 12];
      const bax = PF[o + 13], bay = PF[o + 14], baz = PF[o + 15];
      const l2 = PF[o + 18], rr = PF[o + 19], a2 = PF[o + 20], il2 = PF[o + 21];
      const r1 = PF[o + 16], r2 = PF[o + 17];
      const yv = pax * bax + pay * bay + paz * baz;
      const zv = yv - l2;
      const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yv * yv * l2;
      const z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - r2;
      else if (Math.sign(yv) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - r1;
      else d = (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
    } else if (t === 4) {
      d = x * PF[o + 10] + y * PF[o + 11] + z * PF[o + 12] - PF[o + 13];
    } else {
      let lx = x - PF[o + 10], ly = y - PF[o + 11], lz = z - PF[o + 12];
      if (PF[o + 25] === 1) {
        const rx = PF[o + 16] * lx + PF[o + 17] * ly + PF[o + 18] * lz;
        const ry = PF[o + 19] * lx + PF[o + 20] * ly + PF[o + 21] * lz;
        const rz = PF[o + 22] * lx + PF[o + 23] * ly + PF[o + 24] * lz;
        lx = rx; ly = ry; lz = rz;
      }
      if (t === 1) {
        const ax = PF[o + 13], ay = PF[o + 14], az = PF[o + 15];
        const k0 = Math.sqrt((lx * lx) / (ax * ax) + (ly * ly) / (ay * ay) + (lz * lz) / (az * az));
        const k1 = Math.sqrt((lx * lx) / (ax * ax * ax * ax) + (ly * ly) / (ay * ay * ay * ay) + (lz * lz) / (az * az * az * az));
        d = k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(ax, ay, az);
      } else if (t === 2) {
        const r = PF[o + 30];
        const qx = Math.abs(lx) - PF[o + 13] + r, qy = Math.abs(ly) - PF[o + 14] + r, qz = Math.abs(lz) - PF[o + 15] + r;
        const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
        d = Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
      } else {
        const qx = Math.sqrt(lx * lx + lz * lz) - PF[o + 13];
        d = Math.sqrt(qx * qx + ly * ly) - PF[o + 14];
      }
    }
    return d;
  }

  // stacks for groups (depth ≤ 16)
  const stD = new Float64Array(16);
  const stA = new Float64Array(16 * ATTR_COUNT);
  const pa = new Float64Array(ATTR_COUNT);

  function dist(x: number, y: number, z: number, list: Int32Array, start: number, end: number): number {
    let d = 1e9;
    let sp = 0;
    for (let ii = start; ii < end; ii++) {
      const c = list[ii];
      let op: number, k: number, b: number;
      if (c >= 0) {
        const o = c * PRIM_STRIDE;
        op = PF[o + 1];
        if (op === 3) continue; // paint
        k = PF[o + 2];
        if (op !== 2) {
          // lower bound from the bounding sphere: skip primitives that cannot change d
          const ex = x - PF[o + 26], ey = y - PF[o + 27], ez = z - PF[o + 28];
          const lb = Math.sqrt(ex * ex + ey * ey + ez * ez) - PF[o + 29];
          if (op === 0 ? lb >= d + k : lb >= k - d) continue;
        }
        b = primBase(c, x, y, z);
        const amp = PF[o + 4];
        if (amp !== 0) {
          // the displacement cannot bring this primitive close enough to matter: skip the noise
          const lo = b - Math.abs(amp) * 1.3;
          if (op === 0 ? lo >= d + k : op === 1 ? lo >= k - d : false) continue;
          b -= noiseAt(o, x, y, z);
        }
      } else if (c === -1) {
        stD[sp++] = d;
        d = 1e9;
        continue;
      } else {
        const g = -c - 2;
        b = d;
        d = stD[--sp];
        op = gOp[g];
        k = gK[g];
        if (op === 3) continue;
      }
      if (op === 0) {
        if (k > 0) {
          const h = Math.max(k - Math.abs(d - b), 0) / k;
          d = Math.min(d, b) - h * h * k * 0.25;
        } else d = Math.min(d, b);
      } else if (op === 1) {
        if (k > 0) {
          const h = Math.min(Math.max(0.5 - (0.5 * (d + b)) / k, 0), 1);
          d = d + (-b - d) * h + k * h * (1 - h);
        } else d = Math.max(d, -b);
      } else {
        if (k > 0) {
          const h = Math.min(Math.max(0.5 - (0.5 * (b - d)) / k, 0), 1);
          d = b + (d - b) * h + k * h * (1 - h);
        } else d = Math.max(d, b);
      }
    }
    return d;
  }

  // sparse bone weights of the current primitive (at most two bones)
  let pb0 = 0, pw0 = 0, pb1 = -1, pw1 = 0;
  function primColor(c: number, x: number, y: number, z: number) {
    const a = c * ATTR_STRIDE;
    pa[0] = PA[a]; pa[1] = PA[a + 1]; pa[2] = PA[a + 2];
    const cn = PA[a + 19];
    if (cn > 0) {
      const f = PA[a + 20];
      const nv = nc3(x * f, y * f, z * f) * 0.6 + nc3(x * f * 2.7, y * f * 2.7, z * f * 2.7) * 0.4;
      const w = Math.min(1, Math.max(0, (nv * 0.5 + 0.5 - (1 - cn)) / Math.max(0.05, cn)));
      pa[0] += (PA[a + 16] - pa[0]) * w;
      pa[1] += (PA[a + 17] - pa[1]) * w;
      pa[2] += (PA[a + 18] - pa[2]) * w;
    }
    for (let j = 3; j < 15; j++) pa[j] = PA[a + j];
    pa[15] = 0;
    pa[16] = 0;
  }
  function primBones(c: number, x: number, y: number, z: number) {
    const b = c * BONE_STRIDE;
    const b0 = PB[b], b1 = PB[b + 1];
    pb0 = b0;
    if (b1 < 0) {
      pw0 = 1;
      pb1 = -1;
      pw1 = 0;
    } else {
      const t = ((x - PB[b + 4]) * PB[b + 7] + (y - PB[b + 5]) * PB[b + 8] + (z - PB[b + 6]) * PB[b + 9]) * PB[b + 10];
      const t0 = PB[b + 2], t1 = PB[b + 3];
      let w = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      w = w * w * (3 - 2 * w);
      pw0 = 1 - w;
      pb1 = b1;
      pw1 = w;
    }
  }

  // ── sparse weight accumulator with a lazy global scale ──
  const NB = Math.max(1, nb);
  const wv = new Float64Array(NB); // stored values (true = stored * wscale)
  const inL = new Uint8Array(NB);
  const tl = new Int32Array(NB);
  let tc = 0;
  let wscale = 1;
  function wClear() {
    for (let i = 0; i < tc; i++) {
      wv[tl[i]] = 0;
      inL[tl[i]] = 0;
    }
    tc = 0;
    wscale = 1;
  }
  function wAdd(j: number, v: number) {
    if (v === 0) return;
    if (!inL[j]) {
      inL[j] = 1;
      tl[tc++] = j;
    }
    wv[j] += v / wscale;
  }
  function wScale(f: number) {
    wscale *= f;
    if (wscale < 1e-9) {
      for (let i = 0; i < tc; i++) wv[tl[i]] *= wscale;
      wscale = 1;
    }
  }
  // group stack (sparse snapshots)
  const sIdx = new Int32Array(16 * NB);
  const sVal = new Float64Array(16 * NB);
  const sCnt = new Int32Array(16);
  // group result bones (popped) — dense scratch reused
  const gIdx = new Int32Array(NB);
  const gVal = new Float64Array(NB);
  let gCnt = 0;

  const emptyStack: boolean[] = new Array(16).fill(false);

  function fullImpl(x: number, y: number, z: number, list: Int32Array, start: number, end: number, attr: Float64Array, bw: Float64Array): number {
    let d = 1e9;
    let sp = 0;
    attr.fill(0);
    wClear();
    let empty = true;
    const stEmpty: boolean[] = emptyStack;
    for (let ii = start; ii < end; ii++) {
      const c = list[ii];
      let op: number, k: number, sk: number, b: number, s = 1;
      let isGroup = false;
      if (c >= 0) {
        const o = c * PRIM_STRIDE;
        op = PF[o + 1];
        k = PF[o + 2];
        sk = PF[o + 3];
        if (op !== 2 && !empty) {
          const ex = x - PF[o + 26], ey = y - PF[o + 27], ez = z - PF[o + 28];
          const lb = Math.sqrt(ex * ex + ey * ey + ez * ez) - PF[o + 29];
          if (op === 0 ? lb >= d + Math.max(k, sk) : op === 1 ? lb >= k - d : lb >= k) continue;
        } else if (op === 3) {
          const ex = x - PF[o + 26], ey = y - PF[o + 27], ez = z - PF[o + 28];
          if (Math.sqrt(ex * ex + ey * ey + ez * ez) - PF[o + 29] >= k) continue;
        }
        b = primDist(c, x, y, z);
        s = PA[c * ATTR_STRIDE + 15];
      } else if (c === -1) {
        stD[sp] = d;
        for (let j = 0; j < ATTR_COUNT; j++) stA[sp * ATTR_COUNT + j] = attr[j];
        // snapshot weights (true values)
        for (let i = 0; i < tc; i++) {
          sIdx[sp * NB + i] = tl[i];
          sVal[sp * NB + i] = wv[tl[i]] * wscale;
        }
        sCnt[sp] = tc;
        stEmpty[sp] = empty;
        sp++;
        d = 1e9;
        empty = true;
        wClear();
        continue;
      } else {
        const g = -c - 2;
        const groupWasEmpty = empty;
        b = d;
        sp--;
        d = stD[sp];
        empty = stEmpty[sp];
        for (let j = 0; j < ATTR_COUNT; j++) {
          pa[j] = attr[j];
          attr[j] = stA[sp * ATTR_COUNT + j];
        }
        // group weights → g*, restore the outer accumulator
        gCnt = 0;
        for (let i = 0; i < tc; i++) {
          gIdx[gCnt] = tl[i];
          gVal[gCnt++] = wv[tl[i]] * wscale;
        }
        wClear();
        for (let i = 0; i < sCnt[sp]; i++) wAdd(sIdx[sp * NB + i], sVal[sp * NB + i]);
        op = gOp[g];
        k = gK[g];
        sk = gSK[g];
        isGroup = true;
        if (groupWasEmpty) continue;
      }
      if (op === 3) {
        let w = k > 0 ? 1 - Math.min(1, Math.max(0, b / k)) : b <= 0 ? 1 : 0;
        w = w * w * (3 - 2 * w) * s;
        if (w > 0) {
          if (!isGroup && PA[c * ATTR_STRIDE + 22] > 0) {
            // seam paint: only the seam channel (signed distance to this primitive − offset)
            let sd = Math.max(-0.03, Math.min(0.03, b - PA[c * ATTR_STRIDE + 23]));
            // several seams on one garment: keep the nearest edge
            if (attr[16] > 0.5 && Math.abs(attr[15]) < Math.abs(sd)) sd = attr[15];
            attr[15] += (sd - attr[15]) * w;
            attr[16] += (1 - attr[16]) * w;
            continue;
          }
          if (!isGroup) primColor(c, x, y, z);
          for (let j = 0; j < 17; j++) attr[j] += (pa[j] - attr[j]) * w;
        }
        continue;
      }
      if (op === 0) {
        let wb: number, ws: number;
        if (empty) {
          wb = 1;
          ws = 1;
          d = b;
        } else {
          const diff = d - b;
          ws = Math.min(1, Math.max(0, 0.5 + (0.5 * diff) / Math.max(sk, 1e-4)));
          if (k > 0) {
            const h = Math.max(k - Math.abs(diff), 0) / k;
            wb = Math.min(1, Math.max(0, 0.5 + (0.5 * diff) / k));
            d = Math.min(d, b) - h * h * k * 0.25;
          } else {
            wb = b < d ? 1 : 0;
            d = Math.min(d, b);
          }
        }
        empty = false;
        if (wb > 0) {
          if (!isGroup) primColor(c, x, y, z);
          for (let j = 0; j < 17; j++) attr[j] += (pa[j] - attr[j]) * wb;
        }
        if (ws > 0) {
          if (ws >= 0.999999) wClear();
          else wScale(1 - ws);
          if (isGroup) for (let i = 0; i < gCnt; i++) wAdd(gIdx[i], gVal[i] * ws);
          else {
            primBones(c, x, y, z);
            wAdd(pb0, pw0 * ws);
            if (pb1 >= 0) wAdd(pb1, pw1 * ws);
          }
        }
      } else if (op === 1) {
        if (empty) continue;
        let h: number;
        if (k > 0) {
          h = Math.min(Math.max(0.5 - (0.5 * (d + b)) / k, 0), 1);
          d = d + (-b - d) * h + k * h * (1 - h);
        } else {
          h = -b > d ? 1 : 0;
          d = Math.max(d, -b);
        }
        if (c >= 0 && PA[c * ATTR_STRIDE + 21] > 0 && h > 0) {
          primColor(c, x, y, z);
          for (let j = 0; j < 17; j++) attr[j] += (pa[j] - attr[j]) * h;
        }
      } else {
        let h: number;
        if (k > 0) {
          h = Math.min(Math.max(0.5 - (0.5 * (b - d)) / k, 0), 1);
          d = b + (d - b) * h + k * h * (1 - h);
        } else {
          h = b > d ? 1 : 0;
          d = Math.max(d, b);
        }
        if (c >= 0 && PA[c * ATTR_STRIDE + 21] > 0 && h < 1) {
          primColor(c, x, y, z);
          for (let j = 0; j < 17; j++) attr[j] += (pa[j] - attr[j]) * (1 - h);
        }
      }
    }
    // export dense weights
    bw.fill(0);
    for (let i = 0; i < tc; i++) bw[tl[i]] = wv[tl[i]] * wscale;
    return d;
  }
  return { dist, full: fullImpl };
}

/**
 * Point queries against a compiled program inside a box (cull once, evaluate many): distance,
 * gradient and projection onto the surface. Used to place cards (lashes, brows, decals) exactly
 * on a sculpted surface.
 */
export interface SdfProbe {
  dist(x: number, y: number, z: number): number;
  /** move p onto the surface along the gradient (Newton). Returns a new point. */
  project(p: V3, iters?: number): [number, number, number];
  /** unit outward normal at p */
  normal(p: V3): [number, number, number];
}

export function sdfProbe(prog: SdfProgram, min: V3, max: V3): SdfProbe {
  const ev = makeEvaluator(prog);
  const tmp: number[] = [];
  prog.cull(min[0], min[1], min[2], max[0], max[1], max[2], tmp);
  const list = Int32Array.from(tmp);
  const dist = (x: number, y: number, z: number) => ev.dist(x, y, z, list, 0, list.length);
  const normal = (p: V3): [number, number, number] => {
    const e = 0.0004;
    const gx = dist(p[0] + e, p[1], p[2]) - dist(p[0] - e, p[1], p[2]);
    const gy = dist(p[0], p[1] + e, p[2]) - dist(p[0], p[1] - e, p[2]);
    const gz = dist(p[0], p[1], p[2] + e) - dist(p[0], p[1], p[2] - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const project = (p: V3, iters = 6): [number, number, number] => {
    let q: [number, number, number] = [p[0], p[1], p[2]];
    for (let i = 0; i < iters; i++) {
      const d = dist(q[0], q[1], q[2]);
      if (Math.abs(d) < 1e-5) break;
      const n = normal(q);
      q = [q[0] - n[0] * d, q[1] - n[1] * d, q[2] - n[2] * d];
    }
    return q;
  };
  return { dist, project, normal };
}
