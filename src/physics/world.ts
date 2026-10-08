/**
 * Lightweight character physics (owner: gameplay).
 *
 * - terrain heightfield (any `heightAt(x,z)` function)
 * - yaw-oriented boxes, vertical cylinders, and arbitrary static meshes (three-mesh-bvh)
 * - `ground()` with step-up and walkable-slope filtering, `collide()` for vertical capsules,
 *   `raycast()` with 'arrows' | 'camera' | 'all' filters, moving colliders (setTransform + velocity)
 *
 * Results of `ground()` / `raycast()` come from a small ring of reused objects (no per-call
 * allocation). They stay valid for the next 15 calls; copy them if you need to keep them.
 *
 * Extras beyond the contract (used by src/physics/motor.ts):
 *   `ceiling(x, z, fromY, radius)` lowest solid underside above fromY (head bumps)
 *   `colliderPose(h)` current pose of a collider (platform carry by transform delta)
 */
import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type {
  ColliderHandle,
  ColliderOpts,
  GroundHit,
  PhysicsWorld,
  SurfaceMaterial,
  Vec3Tuple,
  WorldRayHit,
} from '../core/types';

// Install the BVH extensions once (drop-in accelerated raycasts for every Mesh).
const bgProto = THREE.BufferGeometry.prototype as unknown as {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
};
if (bgProto.computeBoundsTree !== computeBoundsTree) {
  bgProto.computeBoundsTree = computeBoundsTree;
  bgProto.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

/** surfaces with normal.y above this can be stood on */
export const WALKABLE_NORMAL_Y = 0.6;
export const DEFAULT_STEP_UP = 0.45;
const CELL = 8;
const LARGE_CELLS = 96;

type Kind = 'box' | 'cyl' | 'mesh';

/** Extended physics API (my implementation). Consumers type-check with `'ceiling' in physics`. */
export interface PhysicsWorldExt extends PhysicsWorld {
  ceiling(x: number, z: number, fromY: number, radius?: number): number;
  colliderPose(h: ColliderHandle): { x: number; y: number; z: number; yaw: number } | null;
  /** number of colliders (debug) */
  readonly count: number;
}

class Collider implements ColliderHandle {
  readonly id: number;
  readonly tag?: string;
  readonly kind: Kind;
  velocity = new THREE.Vector3();
  enabled = true;
  walkable: boolean;
  blocksArrows: boolean;
  blocksCamera: boolean;
  solid: boolean;
  material: SurfaceMaterial;
  // pose (box centre / cylinder axis base / mesh origin)
  px = 0;
  py = 0;
  pz = 0;
  yaw = 0;
  cos = 1;
  sin = 0;
  // box half extents
  hx = 0;
  hy = 0;
  hz = 0;
  // cylinder
  r = 0;
  y0 = 0;
  y1 = 0;
  // mesh
  mesh: THREE.Mesh | null = null;
  bvh: MeshBVH | null = null;
  base = new THREE.Matrix4(); // add-time world matrix
  basePos = new THREE.Vector3();
  baseYaw = 0;
  matrix = new THREE.Matrix4();
  inv = new THREE.Matrix4();
  nrm = new THREE.Matrix3();
  scaleMax = 1;
  scaleMin = 1;
  localBox = new THREE.Box3();
  // world AABB
  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;
  // broadphase bookkeeping
  stamp = 0;
  cells: number[] = [];
  large = false;
  constructor(
    id: number,
    kind: Kind,
    opts: ColliderOpts | undefined,
    private readonly world: { reindex(c: Collider): void },
  ) {
    this.id = id;
    this.kind = kind;
    this.tag = opts?.tag;
    this.walkable = opts?.walkable ?? true;
    this.blocksArrows = opts?.blocksArrows ?? true;
    this.blocksCamera = opts?.blocksCamera ?? true;
    this.solid = opts?.solid ?? true;
    this.material = opts?.material ?? 'stone';
  }
  setTransform(pos: THREE.Vector3, yaw?: number): void {
    if (this.kind === 'cyl') {
      const h = this.y1 - this.y0;
      this.px = pos.x;
      this.pz = pos.z;
      this.y0 = pos.y;
      this.y1 = pos.y + h;
      this.py = pos.y;
    } else if (this.kind === 'box') {
      this.px = pos.x;
      this.py = pos.y;
      this.pz = pos.z;
      if (yaw !== undefined) this.setYaw(yaw);
    } else {
      // mesh: new pose = T(pos)·Ry(yaw - baseYaw)·T(-basePos)·base
      const y = yaw ?? this.yaw;
      this.px = pos.x;
      this.py = pos.y;
      this.pz = pos.z;
      this.setYaw(y);
      _mA.makeTranslation(-this.basePos.x, -this.basePos.y, -this.basePos.z);
      _mB.makeRotationY(y - this.baseYaw);
      this.matrix.copy(this.base).premultiply(_mA).premultiply(_mB);
      _mA.makeTranslation(pos.x, pos.y, pos.z);
      this.matrix.premultiply(_mA);
      this.refreshMesh();
    }
    this.computeAabb();
    this.world.reindex(this);
  }
  setYaw(yaw: number) {
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }
  refreshMesh() {
    this.inv.copy(this.matrix).invert();
    this.nrm.getNormalMatrix(this.matrix);
    const e = this.matrix.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    this.scaleMax = Math.max(sx, sy, sz);
    this.scaleMin = Math.max(1e-6, Math.min(sx, sy, sz));
  }
  computeAabb() {
    if (this.kind === 'box') {
      const ex = Math.abs(this.cos) * this.hx + Math.abs(this.sin) * this.hz;
      const ez = Math.abs(this.sin) * this.hx + Math.abs(this.cos) * this.hz;
      this.minX = this.px - ex;
      this.maxX = this.px + ex;
      this.minZ = this.pz - ez;
      this.maxZ = this.pz + ez;
      this.minY = this.py - this.hy;
      this.maxY = this.py + this.hy;
    } else if (this.kind === 'cyl') {
      this.minX = this.px - this.r;
      this.maxX = this.px + this.r;
      this.minZ = this.pz - this.r;
      this.maxZ = this.pz + this.r;
      this.minY = this.y0;
      this.maxY = this.y1;
    } else {
      _box.copy(this.localBox).applyMatrix4(this.matrix);
      this.minX = _box.min.x;
      this.minY = _box.min.y;
      this.minZ = _box.min.z;
      this.maxX = _box.max.x;
      this.maxY = _box.max.y;
      this.maxZ = _box.max.z;
    }
  }
}

const _mA = new THREE.Matrix4();
const _mB = new THREE.Matrix4();
const _box = new THREE.Box3();
const _ray = new THREE.Ray();
const _seg = new THREE.Line3();
const _segStart0 = new THREE.Vector3();
const _triPt = new THREE.Vector3();
const _capPt = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmpN = new THREE.Vector3();
const _localBox = new THREE.Box3();

function makeGroundHit(): GroundHit {
  return { y: 0, normal: new THREE.Vector3(0, 1, 0), material: 'dirt', collider: null };
}
function makeRayHit(): WorldRayHit {
  return { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), material: 'dirt', collider: null, object: undefined };
}

export function createPhysics(): PhysicsWorldExt {
  let terrain: ((x: number, z: number) => number) | null = null;
  let terrainMat: SurfaceMaterial = 'dirt';
  let nextId = 1;
  let stampCounter = 1;
  const colliders: Collider[] = [];
  const grid = new Map<number, Collider[]>();
  const large: Collider[] = [];

  const groundRing: GroundHit[] = Array.from({ length: 16 }, makeGroundHit);
  let groundIdx = 0;
  const rayRing: WorldRayHit[] = Array.from({ length: 16 }, makeRayHit);
  let rayIdx = 0;
  const nextGround = () => groundRing[(groundIdx = (groundIdx + 1) & 15)];
  const nextRay = () => rayRing[(rayIdx = (rayIdx + 1) & 15)];

  const key = (ix: number, iz: number) => ix * 65536 + iz;

  function unindex(c: Collider) {
    if (c.large) {
      const i = large.indexOf(c);
      if (i >= 0) large.splice(i, 1);
      c.large = false;
    }
    for (const k of c.cells) {
      const arr = grid.get(k);
      if (!arr) continue;
      const i = arr.indexOf(c);
      if (i >= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
      if (arr.length === 0) grid.delete(k);
    }
    c.cells.length = 0;
  }
  function index(c: Collider) {
    const x0 = Math.floor(c.minX / CELL);
    const x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL);
    const z1 = Math.floor(c.maxZ / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > LARGE_CELLS) {
      c.large = true;
      large.push(c);
      return;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(c);
        c.cells.push(k);
      }
    }
  }
  const indexer = {
    reindex(c: Collider) {
      if (!colliders.includes(c)) return;
      unindex(c);
      index(c);
    },
  };

  /** visit colliders whose XZ AABB overlaps the rectangle (deduplicated) */
  const queryOut: Collider[] = [];
  function query(minX: number, minZ: number, maxX: number, maxZ: number): Collider[] {
    queryOut.length = 0;
    const stamp = ++stampCounter;
    for (const c of large) {
      if (!c.enabled || c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
      c.stamp = stamp;
      queryOut.push(c);
    }
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = grid.get(key(ix, iz));
        if (!arr) continue;
        for (const c of arr) {
          if (c.stamp === stamp || !c.enabled) continue;
          c.stamp = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          queryOut.push(c);
        }
      }
    }
    return queryOut;
  }

  function add(c: Collider) {
    c.computeAabb();
    colliders.push(c);
    index(c);
    return c;
  }

  function terrainNormal(x: number, z: number, out: THREE.Vector3) {
    const h = terrain!;
    const e = 0.25;
    out.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e)).normalize();
    return out;
  }

  // ── mesh helpers ─────────────────────────────────────────────────────────
  /** first walkable hit going down from y=top at (x,z), above minY. Returns y or -Infinity. */
  function meshGround(c: Collider, x: number, z: number, top: number, minY: number, outN: THREE.Vector3): number {
    if (top < c.minY || minY > c.maxY) return -Infinity;
    _ray.origin.set(x, Math.min(top, c.maxY + 0.01), z).applyMatrix4(c.inv);
    _ray.direction.set(0, -1, 0).transformDirection(c.inv);
    let near = 0;
    for (let i = 0; i < 6; i++) {
      const hit = c.bvh!.raycastFirst(_ray, THREE.DoubleSide, near, Infinity);
      if (!hit) return -Infinity;
      _tmp.copy(hit.point).applyMatrix4(c.matrix);
      if (_tmp.y < minY) return -Infinity;
      if (hit.face) {
        outN.copy(hit.face.normal).applyMatrix3(c.nrm).normalize();
        if (outN.y < 0) outN.negate();
        if (outN.y > WALKABLE_NORMAL_Y) return _tmp.y;
      }
      near = hit.distance + 1e-3;
    }
    return -Infinity;
  }

  function meshCollide(c: Collider, pos: THREE.Vector3, radius: number, height: number, stepUp: number): boolean {
    const bottom = pos.y + stepUp + radius;
    const top = Math.max(bottom, pos.y + height - radius);
    if (top + radius < c.minY || bottom - radius > c.maxY) return false;
    const rLocal = radius / c.scaleMin;
    _seg.start.set(pos.x, bottom, pos.z).applyMatrix4(c.inv);
    _seg.end.set(pos.x, top, pos.z).applyMatrix4(c.inv);
    _segStart0.copy(_seg.start);
    _localBox.makeEmpty();
    _localBox.expandByPoint(_seg.start);
    _localBox.expandByPoint(_seg.end);
    _localBox.min.addScalar(-rLocal);
    _localBox.max.addScalar(rLocal);
    let hit = false;
    c.bvh!.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_localBox),
      intersectsTriangle: (tri: ExtendedTriangle) => {
        tri.getNormal(_tmpN).applyMatrix3(c.nrm).normalize();
        if (Math.abs(_tmpN.y) > WALKABLE_NORMAL_Y) return false; // floors/ceilings: ground() handles them
        const d = tri.closestPointToSegment(_seg, _triPt, _capPt);
        if (d < rLocal) {
          const depth = rLocal - d;
          _capPt.sub(_triPt);
          if (_capPt.lengthSq() < 1e-12) _capPt.copy(_tmpN).transformDirection(c.inv);
          _capPt.normalize();
          _seg.start.addScaledVector(_capPt, depth);
          _seg.end.addScaledVector(_capPt, depth);
          hit = true;
        }
        return false;
      },
    });
    if (!hit) return false;
    _tmp.copy(_seg.start).applyMatrix4(c.matrix);
    _segStart0.applyMatrix4(c.matrix);
    const dx = _tmp.x - _segStart0.x;
    const dz = _tmp.z - _segStart0.z;
    if (dx * dx + dz * dz < 1e-10) return false;
    pos.x += dx;
    pos.z += dz;
    return true;
  }

  // ── ray helpers (return t or -1; write normal into out) ──────────────────
  function rayBox(c: Collider, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n: THREE.Vector3): number {
    // into local (rotate by -yaw)
    const ox = o.x - c.px;
    const oz = o.z - c.pz;
    slab.tmin = 0;
    slab.tmax = maxT;
    slab.axis = -1;
    if (!slabAxis(ox * c.cos - oz * c.sin, d.x * c.cos - d.z * c.sin, c.hx, 0)) return -1;
    if (!slabAxis(o.y - c.py, d.y, c.hy, 1)) return -1;
    if (!slabAxis(ox * c.sin + oz * c.cos, d.x * c.sin + d.z * c.cos, c.hz, 2)) return -1;
    if (slab.axis < 0) return -1; // origin inside
    const lnx = slab.axis === 0 ? slab.sign : 0;
    const lny = slab.axis === 1 ? slab.sign : 0;
    const lnz = slab.axis === 2 ? slab.sign : 0;
    n.set(lnx * c.cos + lnz * c.sin, lny, -lnx * c.sin + lnz * c.cos);
    return slab.tmin;
  }

  function rayCyl(c: Collider, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n: THREE.Vector3): number {
    const ox = o.x - c.px;
    const oz = o.z - c.pz;
    const r2 = c.r * c.r;
    const inside2 = ox * ox + oz * oz <= r2;
    if (inside2 && o.y >= c.y0 && o.y <= c.y1) return -1;
    let best = Infinity;
    // side
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-12 && !inside2) {
      const b = 2 * (ox * d.x + oz * d.z);
      const cc = ox * ox + oz * oz - r2;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t <= maxT) {
          const y = o.y + d.y * t;
          if (y >= c.y0 && y <= c.y1) {
            best = t;
            n.set((ox + d.x * t) / c.r, 0, (oz + d.z * t) / c.r);
          }
        }
      }
    }
    // caps
    if (Math.abs(d.y) > 1e-9) {
      const capY = d.y < 0 ? c.y1 : c.y0;
      if ((d.y < 0 && o.y >= capY) || (d.y > 0 && o.y <= capY)) {
        const t = (capY - o.y) / d.y;
        if (t >= 0 && t < best && t <= maxT) {
          const x = ox + d.x * t;
          const z = oz + d.z * t;
          if (x * x + z * z <= r2) {
            best = t;
            n.set(0, d.y < 0 ? 1 : -1, 0);
          }
        }
      }
    }
    return best === Infinity ? -1 : best;
  }

  function rayMesh(c: Collider, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n: THREE.Vector3, p: THREE.Vector3): number {
    _ray.origin.copy(o).applyMatrix4(c.inv);
    _ray.direction.copy(d).transformDirection(c.inv);
    const hit = c.bvh!.raycastFirst(_ray, THREE.DoubleSide, 0, Infinity);
    if (!hit) return -1;
    p.copy(hit.point).applyMatrix4(c.matrix);
    const t = p.distanceTo(o);
    if (t > maxT) return -1;
    if (hit.face) {
      n.copy(hit.face.normal).applyMatrix3(c.nrm).normalize();
      if (n.dot(d) > 0) n.negate();
    } else n.copy(d).negate();
    return t;
  }

  function rayTerrain(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    const h = terrain!;
    let t = 0;
    let prevT = 0;
    let gap = o.y - h(o.x, o.z);
    if (gap < 0) return -1; // starts below terrain
    while (t < maxT) {
      const step = Math.min(Math.max(gap * 0.6, 0.15), 3);
      prevT = t;
      t = Math.min(maxT, t + step);
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      gap = y - h(x, z);
      if (gap <= 0) {
        // bisection
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) * 0.5;
          const g = o.y + d.y * m - h(o.x + d.x * m, o.z + d.z * m);
          if (g > 0) lo = m;
          else hi = m;
        }
        return hi;
      }
      if (t >= maxT) break;
    }
    return -1;
  }

  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();

  const world: PhysicsWorldExt = {
    killY: -60,
    get count() {
      return colliders.length;
    },
    setTerrain(fn, material) {
      terrain = fn;
      terrainMat = material ?? 'dirt';
    },
    heightAt(x, z) {
      return terrain ? terrain(x, z) : 0;
    },
    addBox(center, half: Vec3Tuple, yaw = 0, opts) {
      const c = new Collider(nextId++, 'box', opts, indexer);
      c.px = center.x;
      c.py = center.y;
      c.pz = center.z;
      c.hx = Math.abs(half[0]);
      c.hy = Math.abs(half[1]);
      c.hz = Math.abs(half[2]);
      c.setYaw(yaw);
      return add(c);
    },
    addCylinder(x, z, radius, y0, y1, opts) {
      const c = new Collider(nextId++, 'cyl', opts, indexer);
      c.px = x;
      c.pz = z;
      c.py = Math.min(y0, y1);
      c.r = Math.abs(radius);
      c.y0 = Math.min(y0, y1);
      c.y1 = Math.max(y0, y1);
      return add(c);
    },
    addMesh(mesh, opts) {
      const c = new Collider(nextId++, 'mesh', opts, indexer);
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo.boundsTree) geo.computeBoundsTree({ setBoundingBox: true });
      c.bvh = geo.boundsTree!;
      c.mesh = mesh;
      if (!geo.boundingBox) geo.computeBoundingBox();
      c.localBox.copy(geo.boundingBox!);
      c.base.copy(mesh.matrixWorld);
      c.matrix.copy(mesh.matrixWorld);
      c.basePos.setFromMatrixPosition(c.base);
      const e = c.base.elements;
      c.baseYaw = Math.atan2(e[8], e[10]);
      c.px = c.basePos.x;
      c.py = c.basePos.y;
      c.pz = c.basePos.z;
      c.setYaw(c.baseYaw);
      c.refreshMesh();
      return add(c);
    },
    remove(h) {
      const c = h as Collider;
      const i = colliders.indexOf(c);
      if (i < 0) return;
      unindex(c);
      colliders.splice(i, 1);
      c.enabled = false;
    },
    clear() {
      for (const c of colliders) c.enabled = false;
      colliders.length = 0;
      grid.clear();
      large.length = 0;
      terrain = null;
      world.killY = -60;
    },

    ground(x, z, fromY, maxStepUp = DEFAULT_STEP_UP) {
      const limit = fromY + maxStepUp;
      const out = nextGround();
      let bestY = -Infinity;
      if (terrain) {
        // terrain is always a candidate: nothing can stand below it
        bestY = terrain(x, z);
        terrainNormal(x, z, out.normal);
        out.material = terrainMat;
        out.collider = null;
      }
      const list = query(x, z, x, z);
      for (const c of list) {
        if (!c.walkable || c.minY > limit) continue;
        if (c.kind === 'box') {
          const top = c.py + c.hy;
          if (top > limit || top <= bestY) continue;
          const dx = x - c.px;
          const dz = z - c.pz;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          if (lx < -c.hx || lx > c.hx || lz < -c.hz || lz > c.hz) continue;
          bestY = top;
          out.normal.set(0, 1, 0);
          out.material = c.material;
          out.collider = c;
        } else if (c.kind === 'cyl') {
          const top = c.y1;
          if (top > limit || top <= bestY) continue;
          const dx = x - c.px;
          const dz = z - c.pz;
          if (dx * dx + dz * dz > c.r * c.r) continue;
          bestY = top;
          out.normal.set(0, 1, 0);
          out.material = c.material;
          out.collider = c;
        } else {
          const y = meshGround(c, x, z, limit, bestY, _n);
          if (y > bestY) {
            bestY = y;
            out.normal.copy(_n);
            out.material = c.material;
            out.collider = c;
          }
        }
      }
      if (bestY === -Infinity) return null;
      out.y = bestY;
      return out;
    },

    collide(pos, radius, height, stepUp = DEFAULT_STEP_UP) {
      let any = false;
      for (let iter = 0; iter < 3; iter++) {
        let pushed = false;
        const list = query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.solid) continue;
          if (c.maxY <= pos.y + stepUp || c.minY >= pos.y + height) continue;
          if (c.kind === 'box') {
            const dx = pos.x - c.px;
            const dz = pos.z - c.pz;
            const lx = dx * c.cos - dz * c.sin;
            const lz = dx * c.sin + dz * c.cos;
            const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
            const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
            const ex = lx - qx;
            const ez = lz - qz;
            const d2 = ex * ex + ez * ez;
            if (d2 >= radius * radius) continue;
            let nx: number;
            let nz: number;
            let push: number;
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              nx = ex / d;
              nz = ez / d;
              push = radius - d;
            } else {
              const px = c.hx - Math.abs(lx);
              const pz = c.hz - Math.abs(lz);
              if (px < pz) {
                nx = lx >= 0 ? 1 : -1;
                nz = 0;
                push = px + radius;
              } else {
                nx = 0;
                nz = lz >= 0 ? 1 : -1;
                push = pz + radius;
              }
            }
            pos.x += (nx * c.cos + nz * c.sin) * push;
            pos.z += (-nx * c.sin + nz * c.cos) * push;
            pushed = true;
          } else if (c.kind === 'cyl') {
            const dx = pos.x - c.px;
            const dz = pos.z - c.pz;
            const rr = radius + c.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2);
            if (d < 1e-6) {
              pos.x += rr;
            } else {
              pos.x += (dx / d) * (rr - d);
              pos.z += (dz / d) * (rr - d);
            }
            pushed = true;
          } else if (meshCollide(c, pos, radius, height, stepUp)) {
            pushed = true;
          }
        }
        if (!pushed) break;
        any = true;
      }
      return any;
    },

    raycast(origin, dir, maxDist, filter = 'all') {
      let best = maxDist;
      let found = false;
      const out = nextRay();
      out.object = undefined;
      if (terrain) {
        const t = rayTerrain(origin, dir, maxDist);
        if (t >= 0 && t <= best) {
          best = t;
          found = true;
          out.point.copy(origin).addScaledVector(dir, t);
          terrainNormal(out.point.x, out.point.z, out.normal);
          out.material = terrainMat;
          out.collider = null;
        }
      }
      const ex = origin.x + dir.x * maxDist;
      const ez = origin.z + dir.z * maxDist;
      const list = query(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez));
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (filter === 'arrows' && !c.blocksArrows) continue;
        if (filter === 'camera' && !c.blocksCamera) continue;
        // AABB slab precheck
        if (!rayAabb(origin, dir, best, c)) continue;
        let t = -1;
        if (c.kind === 'box') t = rayBox(c, origin, dir, best, _n);
        else if (c.kind === 'cyl') t = rayCyl(c, origin, dir, best, _n);
        else t = rayMesh(c, origin, dir, best, _n, _p);
        if (t >= 0 && t <= best) {
          best = t;
          found = true;
          out.point.copy(origin).addScaledVector(dir, t);
          out.normal.copy(_n);
          out.material = c.material;
          out.collider = c;
          out.object = c.kind === 'mesh' ? c.mesh ?? undefined : undefined;
        }
      }
      if (!found) return null;
      out.t = best;
      return out;
    },

    ceiling(x, z, fromY, radius = 0.3) {
      let best = Infinity;
      const list = query(x - radius, z - radius, x + radius, z + radius);
      for (const c of list) {
        if (!c.solid || c.maxY < fromY) continue;
        if (c.kind === 'box') {
          const bottom = c.py - c.hy;
          if (bottom < fromY || bottom >= best) continue;
          const dx = x - c.px;
          const dz = z - c.pz;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          if (lx < -c.hx - radius || lx > c.hx + radius || lz < -c.hz - radius || lz > c.hz + radius) continue;
          best = bottom;
        } else if (c.kind === 'cyl') {
          if (c.y0 < fromY || c.y0 >= best) continue;
          const dx = x - c.px;
          const dz = z - c.pz;
          const rr = c.r + radius;
          if (dx * dx + dz * dz > rr * rr) continue;
          best = c.y0;
        } else {
          _ray.origin.set(x, fromY, z).applyMatrix4(c.inv);
          _ray.direction.set(0, 1, 0).transformDirection(c.inv);
          const hit = c.bvh!.raycastFirst(_ray, THREE.DoubleSide, 0, Infinity);
          if (!hit) continue;
          _tmp.copy(hit.point).applyMatrix4(c.matrix);
          if (_tmp.y >= fromY && _tmp.y < best) best = _tmp.y;
        }
      }
      return best;
    },

    colliderPose(h) {
      const c = h as Collider;
      if (!(c instanceof Collider)) return null;
      _pose.x = c.px;
      _pose.y = c.kind === 'cyl' ? c.y0 : c.py;
      _pose.z = c.pz;
      _pose.yaw = c.yaw;
      return _pose;
    },
  };
  return world;
}

const _pose = { x: 0, y: 0, z: 0, yaw: 0 };

const slab = { tmin: 0, tmax: 0, axis: -1, sign: 0 };
/** one slab of a centred box [-h, h]; updates `slab`. false = miss */
function slabAxis(o: number, d: number, h: number, axis: number): boolean {
  if (Math.abs(d) < 1e-12) return o >= -h && o <= h;
  let t1 = (-h - o) / d;
  let t2 = (h - o) / d;
  let s = -1;
  if (t1 > t2) {
    const tt = t1;
    t1 = t2;
    t2 = tt;
    s = 1;
  }
  if (t1 > slab.tmin) {
    slab.tmin = t1;
    slab.axis = axis;
    slab.sign = s;
  }
  if (t2 < slab.tmax) slab.tmax = t2;
  return slab.tmin <= slab.tmax;
}

function rayAabb(o: THREE.Vector3, d: THREE.Vector3, maxT: number, c: Collider): boolean {
  slab.tmin = 0;
  slab.tmax = maxT;
  slab.axis = -1;
  const pad = 0.01;
  return (
    slabAxis(o.x - (c.minX + c.maxX) * 0.5, d.x, (c.maxX - c.minX) * 0.5 + pad, 0) &&
    slabAxis(o.y - (c.minY + c.maxY) * 0.5, d.y, (c.maxY - c.minY) * 0.5 + pad, 1) &&
    slabAxis(o.z - (c.minZ + c.maxZ) * 0.5, d.z, (c.maxZ - c.minZ) * 0.5 + pad, 2)
  );
}
