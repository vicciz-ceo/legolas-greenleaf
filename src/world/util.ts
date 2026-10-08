/**
 * Geometry toolkit for the world builders: collects pieces per material, bakes world-scale UVs
 * (uv = metres / tile) and merges everything into one mesh per material.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3Tuple } from '../core/types';

/** axis aligned scatter area: centre (y ignored) + half extents */
export interface Area {
  center: THREE.Vector3;
  halfSize: [number, number];
}

export type HeightFn = (x: number, z: number) => number;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export interface PieceUV {
  /** tile size in metres. Bakes box-projected UVs from the piece's local (pre-transform) coordinates */
  tile?: number;
  /** extra UV offset in tile units (decorrelates repeating pieces) */
  offset?: [number, number];
  /** scale tile independently along u and v (e.g. planks running along an axis) */
  swap?: boolean;
}

/** Box-project UVs from local positions (uses normals to choose the plane). uv = metres / tile. */
export function bakeBoxUV(geo: THREE.BufferGeometry, tile: number, ox = 0, oy = 0, swap = false): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    if (swap) uv.setXY(i, v * inv + oy, u * inv + ox);
    else uv.setXY(i, u * inv + ox, v * inv + oy);
  }
  uv.needsUpdate = true;
}

/** Per-triangle box projection for displaced / smooth meshes (non-indexed result, keeps smooth normals). */
export function bakeFaceBoxUV(geo: THREE.BufferGeometry, tile: number, ox = 0, oy = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  const inv = 1 / tile;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = p.x;
        v = p.z;
      } else if (ax >= az) {
        u = p.z;
        v = p.y;
      } else {
        u = p.x;
        v = p.y;
      }
      uv.setXY(i + k, u * inv + ox, v * inv + oy);
    }
  }
  g.setAttribute('uv', uv);
  return g;
}

/** keep only position/normal/uv so pieces can be merged */
export function normalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) {
    const n = (geo.getAttribute('position') as THREE.BufferAttribute).count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return geo;
}

export interface BuildOpts {
  name?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** Collects pieces per material and merges them. Takes ownership of the geometries passed in. */
export class MeshKit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** triangle counter (diagnostics) */
  tris = 0;

  /** add a geometry (ownership transferred). matrix is applied after UV baking. */
  add(mat: THREE.Material, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4 | null, uv?: PieceUV): this {
    normalizeGeometry(geo);
    if (uv?.tile) bakeBoxUV(geo, uv.tile, uv.offset?.[0] ?? 0, uv.offset?.[1] ?? 0, uv.swap);
    if (matrix) geo.applyMatrix4(matrix);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(geo);
    this.tris += geo.index ? geo.index.count / 3 : (geo.getAttribute('position') as THREE.BufferAttribute).count / 3;
    return this;
  }

  /** axis-aligned (yaw / tilt) box with box-projected UVs. size = full extents, pos = centre */
  box(mat: THREE.Material, size: Vec3Tuple, pos: Vec3Tuple | THREE.Vector3, yaw = 0, uv?: PieceUV, tilt?: [number, number]): this {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const px = Array.isArray(pos) ? pos[0] : pos.x;
    const py = Array.isArray(pos) ? pos[1] : pos.y;
    const pz = Array.isArray(pos) ? pos[2] : pos.z;
    const o = uv ? { ...uv, offset: uv.offset ?? hashOffset(px, py, pz) } : undefined;
    _e.set(tilt?.[0] ?? 0, yaw, tilt?.[1] ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(px, py, pz), _q, _s);
    return this.add(mat, g, _m.clone(), o);
  }

  /** vertical (or tilted) cylinder with cylindrical UVs (u around, v along; metres / tile) */
  cyl(
    mat: THREE.Material,
    rTop: number,
    rBot: number,
    h: number,
    seg: number,
    pos: Vec3Tuple | THREE.Vector3,
    tile = 1,
    opts: { open?: boolean; yaw?: number; tilt?: [number, number]; swap?: boolean } = {},
  ): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, opts.open ?? false);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    // side UVs: first (seg+1)*2 vertices belong to the side
    const sideCount = (seg + 1) * 2;
    for (let i = 0; i < uv.count; i++) {
      if (i < sideCount) uv.setXY(i, opts.swap ? (uv.getY(i) * h) / tile : (uv.getX(i) * circ) / tile, opts.swap ? (uv.getX(i) * circ) / tile : (uv.getY(i) * h) / tile);
      else uv.setXY(i, (uv.getX(i) * 2 * rTop) / tile, (uv.getY(i) * 2 * rTop) / tile);
    }
    const px = Array.isArray(pos) ? pos[0] : pos.x;
    const py = Array.isArray(pos) ? pos[1] : pos.y;
    const pz = Array.isArray(pos) ? pos[2] : pos.z;
    _e.set(opts.tilt?.[0] ?? 0, opts.yaw ?? 0, opts.tilt?.[1] ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(px, py, pz), _q, _s);
    return this.add(mat, g, _m.clone());
  }

  /** every merged mesh becomes a child of the returned group */
  build(opts: BuildOpts = {}): THREE.Group {
    const group = new THREE.Group();
    if (opts.name) group.name = opts.name;
    for (const [mat, list] of this.parts) {
      const allIndexed = list.every((g) => g.index);
      const noneIndexed = list.every((g) => !g.index);
      const prepared = allIndexed || noneIndexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
      const merged = list.length === 1 ? prepared[0] : mergeGeometries(prepared, false);
      if (!merged) throw new Error('[world] mergeGeometries failed (attribute mismatch)');
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.name = (opts.name ?? 'kit') + ':' + (mat.name || 'mat');
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** deterministic small UV offset from a position so repeated pieces do not tile identically */
export function hashOffset(x: number, y: number, z: number): [number, number] {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  const f = h - Math.floor(h);
  const h2 = Math.sin(x * 39.346 + y * 11.135 + z * 83.155) * 24634.6345;
  return [f, h2 - Math.floor(h2)];
}

/** displace vertices along their normals with a noise function and recompute normals */
export function displaceGeometry(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const d = fn(x, y, z, nx, ny, nz);
    pos.setXYZ(i, x + nx * d, y + ny * d, z + nz * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** random point inside an area */
export function pointInArea(rand: () => number, area: Area, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(area.center.x + (rand() * 2 - 1) * area.halfSize[0], 0, area.center.z + (rand() * 2 - 1) * area.halfSize[1]);
}

/** Instanced mesh from matrices (frustum culling on, bounds computed) */
export function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], matrices: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.count = matrices.length;
  if (colors) for (let i = 0; i < colors.length; i++) mesh.setColorAt(i, colors[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** compose a matrix quickly */
export function compose(x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, pitch = 0, roll = 0): THREE.Matrix4 {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone(), new THREE.Vector3(sx, sy, sz));
}

/** path helper: accept [x,z] pairs, Vector3s or Vector2s */
export type PathPoint = THREE.Vector3 | THREE.Vector2 | [number, number] | [number, number, number];
export function pathXZ(p: PathPoint): { x: number; z: number; y: number } {
  if (Array.isArray(p)) return p.length === 3 ? { x: p[0], y: p[1], z: p[2] } : { x: p[0], y: 0, z: p[1] };
  if ((p as THREE.Vector3).isVector3) return { x: (p as THREE.Vector3).x, y: (p as THREE.Vector3).y, z: (p as THREE.Vector3).z };
  return { x: (p as THREE.Vector2).x, y: 0, z: (p as THREE.Vector2).y };
}

/** soft shared-material cache keyed by string; materials are rebuilt if disposed state is irrelevant (three re-uploads on demand) */
const matCache = new Map<string, THREE.Material>();
export function cachedMaterial<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.userData.shared = true; // reused by every level: never disposed by disposeObject
    matCache.set(key, m);
  }
  return m;
}
