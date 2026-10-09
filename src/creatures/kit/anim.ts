/**
 * Kit — procedural animation library. Everything is a pure function of its inputs (time, phase,
 * speed), so a lab pose at (anim, t) is deterministic. Springs are deterministic for a given
 * sequence of dt (fixed internal substeps); the lab pre-rolls them from rest.
 *
 * Core pieces
 *  - PoseSolver       local rotations/offsets per bone + model-space FK (no three.js matrices)
 *  - aimBone          orient a bone so its rest direction/up map to a new direction/up
 *  - solveTwoBone     analytic two-bone IK with a pole (arms, legs, insect legs)
 *  - lookAt           distribute a look-at over a chain (neck → head) with limits
 *  - SpringChain      verlet spring bones (hair, tails, cloaks, quivers, trunks) with sphere colliders
 *  - footCycle / bipedGait / quadGait / insectGait / wingFlap   gait & cycle generators
 *  - PoseBuffer       capture / blend / additive layering with bone masks
 */
import * as THREE from 'three';
import type { RigDef } from './rig';
import type { V3 } from './sdf';

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _vd = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();
const _e = new THREE.Euler();

// ─────────────────────────────────────────────────────────────────────────────
// Pose solver
// ─────────────────────────────────────────────────────────────────────────────

export class PoseSolver {
  readonly n: number;
  readonly parent: Int32Array;
  readonly restLocal: THREE.Vector3[]; // rest offset from parent (model axes)
  readonly restModel: THREE.Vector3[];
  /** local rotation relative to parent (rest = identity) */
  readonly local: THREE.Quaternion[];
  /** extra local translation added to the rest offset (hips bob, root motion, stretch) */
  readonly offset: THREE.Vector3[];
  /** model-space results after fk() */
  readonly modelQ: THREE.Quaternion[];
  readonly modelP: THREE.Vector3[];
  readonly names: string[];
  private idx = new Map<string, number>();
  /** descendants of each bone in topological order (fkFrom without a full scan) */
  private desc: Int32Array[];

  constructor(rig: RigDef) {
    const n = rig.count;
    this.n = n;
    this.parent = new Int32Array(n);
    this.restLocal = [];
    this.restModel = [];
    this.local = [];
    this.offset = [];
    this.modelQ = [];
    this.modelP = [];
    this.names = rig.boneNames;
    for (let i = 0; i < n; i++) {
      const d = rig.defs[i];
      const pi = rig.parentIndex(i);
      this.parent[i] = pi;
      const h = new THREE.Vector3(...d.head);
      this.restModel.push(h);
      this.restLocal.push(pi >= 0 ? h.clone().sub(new THREE.Vector3(...rig.defs[pi].head)) : h.clone());
      this.local.push(new THREE.Quaternion());
      this.offset.push(new THREE.Vector3());
      this.modelQ.push(new THREE.Quaternion());
      this.modelP.push(h.clone());
      this.idx.set(d.name, i);
    }
    const kids: number[][] = Array.from({ length: n }, () => []);
    for (let j = 1; j < n; j++) {
      let p = this.parent[j];
      while (p >= 0) {
        kids[p].push(j);
        p = this.parent[p];
      }
    }
    this.desc = kids.map((k) => Int32Array.from(k));
  }
  i(name: string): number {
    const v = this.idx.get(name);
    if (v === undefined) throw new Error(`[kit] PoseSolver: unknown bone ${name}`);
    return v;
  }
  has(name: string) {
    return this.idx.has(name);
  }
  reset(): this {
    for (let i = 0; i < this.n; i++) {
      this.local[i].identity();
      this.offset[i].set(0, 0, 0);
    }
    return this;
  }
  /** local rotation from Euler angles (radians, model axes at rest) */
  euler(i: number, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): this {
    this.local[i].setFromEuler(_e.set(x, y, z, order));
    return this;
  }
  /** multiply an extra Euler rotation onto the bone's current local rotation (pre-multiplied: parent space) */
  rotate(i: number, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): this {
    _qa.setFromEuler(_e.set(x, y, z, order));
    this.local[i].premultiply(_qa);
    return this;
  }
  /** forward kinematics for every bone (defs are topologically ordered) */
  fk(): this {
    for (let i = 0; i < this.n; i++) this.fkBone(i);
    return this;
  }
  fkBone(i: number) {
    const p = this.parent[i];
    if (p < 0) {
      this.modelQ[i].copy(this.local[i]);
      this.modelP[i].copy(this.restLocal[i]).add(this.offset[i]);
    } else {
      this.modelQ[i].multiplyQuaternions(this.modelQ[p], this.local[i]);
      _va.copy(this.restLocal[i]).add(this.offset[i]).applyQuaternion(this.modelQ[p]);
      this.modelP[i].copy(this.modelP[p]).add(_va);
    }
  }
  /** recompute FK for a bone and all its descendants */
  fkFrom(i: number) {
    this.fkBone(i);
    const d = this.desc[i];
    for (let k = 0; k < d.length; k++) this.fkBone(d[k]);
  }
  /** set a bone's MODEL rotation (parents must be up to date) */
  setModelRotation(i: number, q: THREE.Quaternion) {
    const p = this.parent[i];
    if (p < 0) this.local[i].copy(q);
    else this.local[i].copy(this.modelQ[p]).invert().multiply(q);
    this.modelQ[i].copy(q);
  }
  /** model-space point attached to bone i at rest-local offset (dx,dy,dz) */
  pointOn(i: number, dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(dx, dy, dz).applyQuaternion(this.modelQ[i]).add(this.modelP[i]);
  }
  /** write the pose to three.js bones (same order as the rig). See `fastBones` for speed. */
  apply(bones: THREE.Bone[], from = 0) {
    for (let i = from; i < this.n; i++) {
      const b = bones[i];
      b.quaternion.copy(this.local[i]);
      b.position.copy(this.restLocal[i]).add(this.offset[i]);
    }
  }
}

const NOOP = () => {};
/**
 * Detach the Euler sync of procedurally animated bones: three.js recomputes `bone.rotation` from
 * the quaternion on every write (an expensive matrix → Euler conversion). Animated rigs only use
 * quaternions, so after this `bone.rotation` is NOT kept in sync (read `bone.quaternion`).
 */
export function fastBones(bones: THREE.Bone[]) {
  for (const b of bones) b.quaternion._onChange(NOOP);
}

// ─────────────────────────────────────────────────────────────────────────────
// Orientation helpers & IK
// ─────────────────────────────────────────────────────────────────────────────

const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fc = new THREE.Vector3();
const _fa1 = new THREE.Vector3();
const _fb1 = new THREE.Vector3();
const _fc1 = new THREE.Vector3();
const _fm0 = new THREE.Matrix4();
const _fm1 = new THREE.Matrix4();
/** any unit vector perpendicular to v */
function perpendicular(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(v.x) < 0.9) out.set(0, v.z, -v.y).cross(v).normalize();
  else out.set(-v.z, 0, v.x).cross(v).normalize();
  return out;
}
/** quaternion mapping frame (d0, u0) to (d1, u1) (u is orthogonalised against d) */
export function frameRotation(d0: THREE.Vector3, u0: THREE.Vector3, d1: THREE.Vector3, u1: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const a = _fa.copy(d0).normalize();
  const b = _fb.copy(u0).addScaledVector(a, -u0.dot(a));
  if (b.lengthSq() < 1e-10) perpendicular(a, b);
  b.normalize();
  const c = _fc.crossVectors(a, b);
  _fm0.makeBasis(a, b, c);
  const a1 = _fa1.copy(d1).normalize();
  const b1 = _fb1.copy(u1).addScaledVector(a1, -u1.dot(a1));
  if (b1.lengthSq() < 1e-10) {
    // fall back to the rest up carried along by the minimal rotation
    b1.copy(b).addScaledVector(a1, -b.dot(a1));
    if (b1.lengthSq() < 1e-10) perpendicular(a1, b1);
  }
  b1.normalize();
  const c1 = _fc1.crossVectors(a1, b1);
  _fm1.makeBasis(a1, b1, c1);
  _fm0.transpose(); // inverse of a rotation basis
  _fm1.multiply(_fm0);
  return out.setFromRotationMatrix(_fm1);
}

const _fq = new THREE.Quaternion();
/**
 * Orient bone i (model space) so its rest direction `restDir` points along `dir` and `restUp`
 * maps as close as possible to `up`. Updates FK of the bone and its descendants.
 */
export function aimBone(ps: PoseSolver, i: number, dir: THREE.Vector3, up: THREE.Vector3, restDir: THREE.Vector3, restUp: THREE.Vector3) {
  frameRotation(restDir, restUp, dir, up, _fq);
  ps.setModelRotation(i, _fq);
  ps.fkFrom(i);
}

export interface TwoBoneOpts {
  /** rest direction of the upper bone (model), e.g. A-pose arm direction. Default: rest a→b */
  restDirA?: THREE.Vector3;
  restDirB?: THREE.Vector3;
  /** rest "up" (direction the middle joint points away from), e.g. elbow → (0,0,-1), knee → (0,0,1) */
  restUp: THREE.Vector3;
  /** model rotation for the end bone (hand/foot); null keeps it following the lower bone */
  endRotation?: THREE.Quaternion | null;
  /** extra twist (radians) of the lower bone about its own axis (forearm pronation) */
  lowerTwist?: number;
  /** allow up to this stretch factor when the target is out of reach (default 1, no stretch) */
  maxStretch?: number;
  /** 0..1 blend from the current pose toward the IK result */
  weight?: number;
}

const _A = new THREE.Vector3();
const _B = new THREE.Vector3();
const _C = new THREE.Vector3();
const _T = new THREE.Vector3();
const _D = new THREE.Vector3();
const _P = new THREE.Vector3();
const _E = new THREE.Vector3();
const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _rdA = new THREE.Vector3();
const _rdB = new THREE.Vector3();
const _tq = new THREE.Quaternion();
const _sq = new THREE.Quaternion();
const _upA = new THREE.Vector3();
const _upB = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _yax = new THREE.Vector3(0, 1, 0);

/**
 * Analytic two-bone IK in MODEL space. a = upper (thigh/upperarm), b = lower (shin/forearm),
 * c = end (foot/hand). `pole` is a model-space point the middle joint bends toward.
 * Call ps.fk() first (parents of `a` must be current).
 */
export function solveTwoBone(ps: PoseSolver, a: number, b: number, c: number, target: THREE.Vector3, pole: THREE.Vector3, o: TwoBoneOpts) {
  const w = o.weight ?? 1;
  if (w <= 0) return;
  _A.copy(ps.modelP[a]);
  const l1 = ps.restLocal[b].length();
  const l2 = ps.restLocal[c].length();
  _T.copy(target);
  if (w < 1) {
    // blend target from the current end position
    _T.lerpVectors(ps.modelP[c], target, w);
  }
  _D.subVectors(_T, _A);
  let dist = _D.length();
  if (dist < 1e-6) return;
  _D.multiplyScalar(1 / dist);
  const maxR = (l1 + l2) * 0.9995 * (o.maxStretch ?? 1);
  const minR = Math.abs(l1 - l2) + 1e-4;
  const stretch = dist > (l1 + l2) * 0.9995 ? Math.min(dist / ((l1 + l2) * 0.9995), o.maxStretch ?? 1) : 1;
  dist = Math.min(Math.max(dist, minR), maxR);
  const L1 = l1 * stretch, L2 = l2 * stretch;
  // pole direction perpendicular to the reach axis
  _P.subVectors(pole, _A);
  _P.addScaledVector(_D, -_P.dot(_D));
  if (_P.lengthSq() < 1e-10) {
    _P.copy(o.restUp).multiplyScalar(-1);
    _P.addScaledVector(_D, -_P.dot(_D));
  }
  _P.normalize();
  const cosA = Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _E.copy(_A).addScaledVector(_D, L1 * cosA).addScaledVector(_P, L1 * sinA);
  _dirA.subVectors(_E, _A).normalize();
  _dirB.subVectors(_T, _E).normalize();
  // "up" for both bones = away from the pole (the middle joint points toward the pole)
  const up = _upA.copy(_P).multiplyScalar(-1);
  const upB = _upB.copy(up);
  _rdA.copy(o.restDirA ?? _B.copy(ps.restModel[b]).sub(ps.restModel[a])).normalize();
  _rdB.copy(o.restDirB ?? _C.copy(ps.restModel[c]).sub(ps.restModel[b])).normalize();
  aimBone(ps, a, _dirA, up, _rdA, o.restUp);
  if (stretch !== 1) ps.offset[b].copy(ps.restLocal[b]).multiplyScalar(stretch - 1);
  // lower bone: up projected so the hinge stays consistent; twist about the bone axis
  if (o.lowerTwist) {
    _tq.setFromAxisAngle(_dirB, o.lowerTwist);
    upB.applyQuaternion(_tq);
  }
  aimBone(ps, b, _dirB, upB, _rdB, o.restUp);
  if (stretch !== 1) {
    ps.offset[c].copy(ps.restLocal[c]).multiplyScalar(stretch - 1);
    ps.fkFrom(b);
  }
  if (o.endRotation) {
    ps.setModelRotation(c, o.endRotation);
    ps.fkFrom(c);
  }
}

const _fq1 = new THREE.Quaternion();
/**
 * Cheap two-bone solve for distant LODs: same elbow/knee placement as `solveTwoBone`, but each
 * bone gets the minimal (swing-only) rotation from its rest direction — no frame/basis build, no
 * stretch, no descendant FK. Only the bones a, b and c are updated (local + model). `endRotation`
 * (model) orients the end bone; null leaves it following the lower bone.
 */
export function fastTwoBone(ps: PoseSolver, a: number, b: number, c: number, target: THREE.Vector3, pole: THREE.Vector3, restDirA: THREE.Vector3, restDirB: THREE.Vector3, endRotation: THREE.Quaternion | null) {
  const A = ps.modelP[a];
  const l1 = ps.restLocal[b].length();
  const l2 = ps.restLocal[c].length();
  _D.subVectors(target, A);
  let dist = _D.length();
  if (dist < 1e-6) return;
  _D.multiplyScalar(1 / dist);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995);
  _P.subVectors(pole, A);
  _P.addScaledVector(_D, -_P.dot(_D));
  const pl = _P.length();
  if (pl < 1e-6) return;
  _P.multiplyScalar(1 / pl);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _dirA.copy(_D).multiplyScalar(cosA).addScaledVector(_P, sinA); // unit
  _E.copy(A).addScaledVector(_dirA, l1);
  _dirB.copy(A).addScaledVector(_D, dist).sub(_E).normalize();
  _fq1.setFromUnitVectors(restDirA, _dirA);
  ps.setModelRotation(a, _fq1);
  ps.fkBone(b);
  _fq1.setFromUnitVectors(restDirB, _dirB);
  ps.setModelRotation(b, _fq1);
  ps.fkBone(c);
  if (endRotation) ps.setModelRotation(c, endRotation);
}

/**
 * Look-at over a chain (e.g. [spine, chest, neck, head]) with weights (summing to ~1).
 * forward = rest facing of the last bone (model, usually +Z). Angles are clamped.
 */
export function lookAt(ps: PoseSolver, chain: number[], weights: number[], targetModel: THREE.Vector3, opts: { forward?: V3; maxYaw?: number; maxPitch?: number; amount?: number } = {}) {
  const amount = opts.amount ?? 1;
  if (amount <= 0) return;
  const head = chain[chain.length - 1];
  const fwdRest = opts.forward ? _va.set(opts.forward[0], opts.forward[1], opts.forward[2]) : _va.set(0, 0, 1);
  const fwd = _vb.copy(fwdRest).applyQuaternion(ps.modelQ[head]);
  const eye = ps.modelP[head];
  const to = _vc.subVectors(targetModel, eye);
  if (to.lengthSq() < 1e-6) return;
  to.normalize();
  // yaw/pitch difference in the head's current frame
  const curYaw = Math.atan2(fwd.x, fwd.z);
  const curPitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
  const tgtYaw = Math.atan2(to.x, to.z);
  const tgtPitch = Math.asin(Math.max(-1, Math.min(1, to.y)));
  let dy = tgtYaw - curYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const maxYaw = opts.maxYaw ?? 1.3;
  const maxPitch = opts.maxPitch ?? 0.8;
  dy = Math.max(-maxYaw, Math.min(maxYaw, dy)) * amount;
  const dp = Math.max(-maxPitch, Math.min(maxPitch, tgtPitch - curPitch)) * amount;
  for (let k = 0; k < chain.length; k++) {
    const i = chain[k];
    const wgt = weights[k] ?? 1 / chain.length;
    // rotate in model space about world Y (yaw) and the bone's lateral axis (pitch)
    _qa.setFromAxisAngle(_yax, dy * wgt);
    const lat = _lat.set(1, 0, 0).applyQuaternion(ps.modelQ[i]);
    lat.y = 0;
    if (lat.lengthSq() < 1e-6) lat.set(1, 0, 0);
    lat.normalize();
    _qb.setFromAxisAngle(lat, -dp * wgt);
    _sq.copy(_qa).multiply(_qb).multiply(ps.modelQ[i]);
    ps.setModelRotation(i, _sq);
    ps.fkFrom(i);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spring bones
// ─────────────────────────────────────────────────────────────────────────────

export interface SpringCollider {
  /** bone the sphere follows */
  bone: number;
  /** rest-local offset from the bone joint (model axes at rest) */
  offset: V3;
  radius: number;
}

export interface SpringOpts {
  /** 0..1 pull back to the animated pose per step (default 0.08) */
  stiffness?: number;
  /** 0..1 velocity damping per step (default 0.12) */
  drag?: number;
  /** gravity (m/s², model/world down) default 6 */
  gravity?: number;
  colliders?: SpringCollider[];
  /**
   * Orientation reference (optional): the chain's rest targets and twist follow this bone
   * (blended by `weight`) instead of only the chain's parent. Long hair hangs from the head but
   * lies on the back: with the chest as reference, a turned head no longer swings the hair
   * around the neck onto the shoulders.
   */
  frame?: { bone: number; weight: number };
}

/**
 * Verlet spring chain. Bones listed in order (root-most first). Each bone points at the next
 * (the last one at its `tail`). Works in WORLD space so root movement creates inertia.
 * Call `update(dt, root)` AFTER the animated pose is applied to PoseSolver (it rewrites
 * local rotations of the chain bones) and BEFORE ps.apply().
 */
export class SpringChain {
  private bones: number[];
  private tails: THREE.Vector3[]; // rest tail offsets (model axes) for each bone
  private cur: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private init = false;
  private acc = 0;
  private lens: number[];
  private colOff: THREE.Vector3[];
  readonly opts: Required<Omit<SpringOpts, 'colliders' | 'frame'>> & { colliders: SpringCollider[]; frame?: SpringOpts['frame'] };

  constructor(ps: PoseSolver, bones: number[], lastTail: V3, o: SpringOpts = {}) {
    this.bones = bones;
    this.tails = bones.map((b, k) =>
      k + 1 < bones.length ? ps.restModel[bones[k + 1]].clone().sub(ps.restModel[b]) : new THREE.Vector3(...lastTail),
    );
    for (let k = 0; k < bones.length; k++) {
      this.cur.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    this.opts = { stiffness: o.stiffness ?? 0.08, drag: o.drag ?? 0.12, gravity: o.gravity ?? 6, colliders: o.colliders ?? [], frame: o.frame };
    this.lens = this.tails.map((t) => t.length());
    this.colOff = this.opts.colliders.map((c) => new THREE.Vector3(c.offset[0], c.offset[1], c.offset[2]));
  }
  reset() {
    this.init = false;
    this.acc = 0;
  }
  private _ref = new THREE.Quaternion();
  /** the bone's reference orientation: its animated one, blended toward the frame bone */
  private refQ(ps: PoseSolver, b: number): THREE.Quaternion {
    const f = this.opts.frame;
    if (!f || f.weight <= 0) return this._ref.copy(ps.modelQ[b]);
    return this._ref.copy(ps.modelQ[b]).slerp(ps.modelQ[f.bone], Math.min(1, f.weight));
  }
  /** root: the object whose matrixWorld maps model → world (the creature's root group) */
  update(ps: PoseSolver, dt: number, rootMatrix: THREE.Matrix4) {
    const inv = _m4.copy(rootMatrix).invert();
    const step = 1 / 60;
    // animated (target) tail positions in world
    const n = this.bones.length;
    if (!this.init) {
      for (let k = 0; k < n; k++) {
        const b = this.bones[k];
        this.cur[k].copy(this.tails[k]).applyQuaternion(this.refQ(ps, b)).add(ps.modelP[b]).applyMatrix4(rootMatrix);
        this.prev[k].copy(this.cur[k]);
      }
      this.init = true;
    }
    this.acc = Math.min(this.acc + dt, step * 8);
    const down = _vd.set(0, -1, 0);
    while (this.acc >= step) {
      this.acc -= step;
      for (let k = 0; k < n; k++) {
        const b = this.bones[k];
        // head of this bone in world (from the current solved chain)
        const head = _va.copy(ps.modelP[b]).applyMatrix4(rootMatrix);
        const refQ = this.refQ(ps, b);
        const target = _vb.copy(this.tails[k]).applyQuaternion(refQ).add(ps.modelP[b]).applyMatrix4(rootMatrix);
        const c = this.cur[k];
        const p = this.prev[k];
        const vx = (c.x - p.x) * (1 - this.opts.drag), vy = (c.y - p.y) * (1 - this.opts.drag), vz = (c.z - p.z) * (1 - this.opts.drag);
        p.copy(c);
        c.x += vx + (target.x - c.x) * this.opts.stiffness + down.x * this.opts.gravity * step * step;
        c.y += vy + (target.y - c.y) * this.opts.stiffness + down.y * this.opts.gravity * step * step;
        c.z += vz + (target.z - c.z) * this.opts.stiffness + down.z * this.opts.gravity * step * step;
        // colliders (world)
        const cols = this.opts.colliders;
        for (let ci = 0; ci < cols.length; ci++) {
          const col = cols[ci];
          const cp = _vc.copy(this.colOff[ci]).applyQuaternion(ps.modelQ[col.bone]).add(ps.modelP[col.bone]).applyMatrix4(rootMatrix);
          const dx = c.x - cp.x, dy = c.y - cp.y, dz = c.z - cp.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < col.radius && d > 1e-6) {
            const s = col.radius / d;
            c.set(cp.x + dx * s, cp.y + dy * s, cp.z + dz * s);
          }
        }
        // keep length
        const len = this.lens[k];
        const hx = c.x - head.x, hy = c.y - head.y, hz = c.z - head.z;
        const hl = Math.hypot(hx, hy, hz) || 1;
        c.set(head.x + (hx / hl) * len, head.y + (hy / hl) * len, head.z + (hz / hl) * len);
        // orient bone toward simulated tail (model space)
        const tailModel = _vc.copy(c).applyMatrix4(inv);
        const dir = tailModel.sub(ps.modelP[b]).normalize();
        const restDir = _vb.copy(this.tails[k]).normalize();
        // minimal rotation from the bone's current animated direction to the simulated one
        const curDir = _va.copy(restDir).applyQuaternion(refQ);
        _qa.setFromUnitVectors(curDir, dir);
        _qb.copy(_qa).multiply(refQ);
        ps.setModelRotation(b, _qb);
        ps.fkFrom(b);
      }
    }
    void inv;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gait generators (pure functions)
// ─────────────────────────────────────────────────────────────────────────────

export interface FootSample {
  /** offset along the travel direction from the foot's neutral position (m) */
  along: number;
  /** foot lift (m) */
  lift: number;
  /** 0..1 planted weight (1 = on the ground) */
  planted: number;
  /** toe pitch hint (radians, + = toe down) */
  pitch: number;
  /** 0..1 progress within the current phase (stance or swing) */
  u: number;
}

/**
 * One leg's cycle. phase in [0,1): stance during [0, duty), swing after.
 * During stance the foot moves backward at exactly the body speed (no sliding): the travel per
 * stance is stride*duty where stride = distance covered per full cycle.
 */
export function footCycle(phase: number, duty: number, stride: number, liftH: number, out: FootSample): FootSample {
  let p = phase - Math.floor(phase);
  const half = (stride * duty) / 2;
  if (p < duty) {
    const u = p / duty;
    out.along = half - u * stride * duty;
    out.lift = 0;
    out.planted = 1;
    // heel strike → flat → heel lift
    out.pitch = u < 0.15 ? -0.25 * (1 - u / 0.15) : u > 0.7 ? ((u - 0.7) / 0.3) * 0.5 : 0;
    out.u = u;
  } else {
    const u = (p - duty) / (1 - duty);
    const e = u * u * (3 - 2 * u);
    out.along = -half + e * 2 * half;
    out.lift = Math.sin(Math.PI * Math.min(1, u * 1.1)) * liftH * (u < 0.5 ? 1 : 1 - (u - 0.5) * 0.4);
    out.planted = u < 0.08 ? 1 - u / 0.08 : u > 0.92 ? (u - 0.92) / 0.08 : 0;
    out.pitch = 0.5 * (1 - u) * (1 - u) - 0.25 * u * u;
    out.u = u;
  }
  return out;
}

/** cycle frequency (full cycles per second) for a speed and leg length (Froude-scaled) */
export function gaitFrequency(speed: number, legLength: number): number {
  const s = Math.max(0, speed);
  return (0.62 + 0.26 * Math.pow(s * Math.sqrt(0.95 / Math.max(0.2, legLength)), 0.75)) * Math.sqrt(0.95 / Math.max(0.2, legLength));
}

export interface BipedGaitSample {
  left: FootSample;
  right: FootSample;
  /** 0 = walk … 1 = run (flight phase) */
  run: number;
  /** pelvis vertical offset (m), pelvis roll/yaw (radians) */
  pelvisY: number;
  pelvisRoll: number;
  pelvisYaw: number;
  /** -1..1 arm swing (left arm forward = +1) */
  armSwing: number;
  stride: number;
  freq: number;
}

export function makeBipedSample(): BipedGaitSample {
  const f = (): FootSample => ({ along: 0, lift: 0, planted: 1, pitch: 0, u: 0 });
  return { left: f(), right: f(), run: 0, pelvisY: 0, pelvisRoll: 0, pelvisYaw: 0, armSwing: 0, stride: 0, freq: 0 };
}

/**
 * Biped locomotion at `phase` (cycles, integrate phase += freq·dt) and `speed` (m/s).
 * Walk → run blend by speed; stride = speed / freq so feet never slide at constant speed.
 */
export function bipedGait(phase: number, speed: number, legLength: number, out: BipedGaitSample): BipedGaitSample {
  const freq = gaitFrequency(speed, legLength);
  const stride = speed / Math.max(freq, 1e-3);
  const run = Math.min(1, Math.max(0, (speed - 2.6 * Math.sqrt(legLength / 0.95)) / (1.4 * Math.sqrt(legLength / 0.95))));
  const duty = 0.62 - 0.3 * run;
  const lift = Math.min(0.09 + 0.18 * run, 0.06 + stride * 0.08) * Math.min(1, speed / 0.8) * (legLength / 0.95);
  footCycle(phase, duty, stride, lift, out.left);
  footCycle(phase + 0.5, duty, stride, lift, out.right);
  const p2 = Math.PI * 2 * phase;
  // walk: pelvis highest mid-stance (2x per cycle); run: lowest mid-stance
  const bob = Math.cos(p2 * 2);
  const amp = Math.min(speed, 1.6) * 0.018;
  out.pelvisY = (-bob * amp * (1 - run) + bob * 0.035 * run) * (legLength / 0.95) - run * 0.03 * (legLength / 0.95);
  out.pelvisRoll = Math.sin(p2) * 0.05 * Math.min(1, speed) * (1 - run * 0.5);
  out.pelvisYaw = Math.sin(p2 + Math.PI / 2) * (0.08 + 0.1 * run) * Math.min(1, speed / 1.5);
  out.armSwing = Math.sin(p2 + Math.PI / 2) * Math.min(1, speed / 1.5);
  out.run = run;
  out.stride = stride;
  out.freq = freq;
  return out;
}

export type QuadGaitKind = 'walk' | 'trot' | 'canter' | 'gallop';
/** leg order: [frontLeft, frontRight, hindLeft, hindRight] */
const QUAD_OFFSETS: Record<QuadGaitKind, number[]> = {
  walk: [0.25, 0.75, 0.0, 0.5],
  trot: [0.0, 0.5, 0.5, 0.0],
  canter: [0.3, 0.6, 0.0, 0.3],
  gallop: [0.1, 0.2, 0.55, 0.65],
};

export interface QuadGaitSample {
  legs: FootSample[];
  kind: QuadGaitKind;
  bodyPitch: number;
  bodyY: number;
  stride: number;
  freq: number;
}
export function quadGait(phase: number, speed: number, legLength: number, out?: QuadGaitSample, kind?: QuadGaitKind): QuadGaitSample {
  const o = out ?? { legs: [0, 1, 2, 3].map(() => ({ along: 0, lift: 0, planted: 1, pitch: 0, u: 0 })), kind: 'walk', bodyPitch: 0, bodyY: 0, stride: 0, freq: 0 };
  const rel = speed / Math.sqrt(9.8 * legLength);
  const k: QuadGaitKind = kind ?? (rel < 0.45 ? 'walk' : rel < 1.1 ? 'trot' : rel < 1.6 ? 'canter' : 'gallop');
  const freq = gaitFrequency(speed * 0.8, legLength * 1.1);
  const stride = speed / Math.max(freq, 1e-3);
  const duty = k === 'walk' ? 0.68 : k === 'trot' ? 0.5 : k === 'canter' ? 0.42 : 0.32;
  const lift = Math.min(legLength * 0.22, 0.03 + stride * 0.12) * Math.min(1, speed / 0.5);
  const offs = QUAD_OFFSETS[k];
  for (let i = 0; i < 4; i++) footCycle(phase + offs[i], duty, stride, lift, o.legs[i]);
  const p2 = Math.PI * 2 * phase;
  o.bodyPitch = k === 'gallop' || k === 'canter' ? Math.sin(p2) * 0.08 : 0;
  o.bodyY = -Math.cos(p2 * (k === 'walk' || k === 'trot' ? 2 : 1)) * 0.012 * Math.min(1, speed) * (legLength / 0.6);
  o.kind = k;
  o.stride = stride;
  o.freq = freq;
  return o;
}

/**
 * Multi-leg gait. Legs indexed 0..n-1 as [L1, R1, L2, R2, …] front to back.
 * 'tetrapod' (spiders, 8 legs): alternating sets {L1,R2,L3,R4} / {R1,L2,R3,L4}, plus a small
 * metachronal wave so the set doesn't land at once. 'tripod' for 6 legs. 'wave' ripples.
 */
export function insectGait(phase: number, speed: number, legReach: number, nLegs: number, out: FootSample[], pattern: 'tetrapod' | 'tripod' | 'wave' = 'tetrapod'): FootSample[] {
  const freq = gaitFrequency(speed * 0.7, legReach * 0.8) * 1.2;
  const stride = speed / Math.max(freq, 1e-3);
  const duty = pattern === 'wave' ? 0.75 : 0.55;
  const lift = Math.min(legReach * 0.25, 0.02 + stride * 0.18) * Math.min(1, speed / 0.3);
  const pairs = nLegs / 2;
  for (let i = 0; i < nLegs; i++) {
    const pair = Math.floor(i / 2);
    const side = i % 2;
    let off: number;
    if (pattern === 'wave') off = pair / pairs + side * 0.5;
    else off = ((pair + side) % 2) * 0.5 + pair * 0.06;
    if (!out[i]) out[i] = { along: 0, lift: 0, planted: 1, pitch: 0, u: 0 };
    footCycle(phase + off, duty, stride, lift, out[i]);
  }
  return out;
}

export interface WingSample {
  /** shoulder elevation (radians, + up) */
  shoulder: number;
  /** shoulder sweep forward/back (radians) */
  sweep: number;
  /** elbow fold (0 = extended, 1 = folded) */
  elbowFold: number;
  /** wrist/hand fold */
  wristFold: number;
  /** body vertical bob (m, relative to wing span) */
  bob: number;
}
/** wing flap at phase (cycles). Downstroke is faster and spread, upstroke folds the hand wing. */
export function wingFlap(phase: number, amplitude = 1, out?: WingSample): WingSample {
  const o = out ?? { shoulder: 0, sweep: 0, elbowFold: 0, wristFold: 0, bob: 0 };
  const p = phase - Math.floor(phase);
  // asymmetric: downstroke 0..0.45, upstroke 0.45..1
  const down = p < 0.45;
  const u = down ? p / 0.45 : (p - 0.45) / 0.55;
  const s = down ? Math.cos(u * Math.PI) : -Math.cos(u * Math.PI);
  o.shoulder = s * 0.85 * amplitude;
  o.sweep = (down ? -0.15 : 0.2) * Math.sin(u * Math.PI) * amplitude;
  o.elbowFold = down ? 0.05 : Math.sin(u * Math.PI) * 0.55;
  o.wristFold = down ? 0.0 : Math.sin(u * Math.PI) * 0.75;
  o.bob = -s * 0.04 * amplitude;
  return o;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layering
// ─────────────────────────────────────────────────────────────────────────────

/** Snapshot of local rotations + offsets. Blend/add buffers, then write back to a PoseSolver. */
export class PoseBuffer {
  readonly q: Float32Array;
  readonly p: Float32Array;
  constructor(readonly n: number) {
    this.q = new Float32Array(n * 4);
    this.p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.q[i * 4 + 3] = 1;
  }
  capture(ps: PoseSolver): this {
    for (let i = 0; i < this.n; i++) {
      const q = ps.local[i];
      this.q.set([q.x, q.y, q.z, q.w], i * 4);
      const o = ps.offset[i];
      this.p.set([o.x, o.y, o.z], i * 3);
    }
    return this;
  }
  /** write into the solver, optionally with weight (slerp from the solver's current pose) and a mask */
  apply(ps: PoseSolver, weight = 1, mask?: Float32Array | null): this {
    for (let i = 0; i < this.n; i++) {
      const w = weight * (mask ? mask[i] : 1);
      if (w <= 0) continue;
      _qa.set(this.q[i * 4], this.q[i * 4 + 1], this.q[i * 4 + 2], this.q[i * 4 + 3]);
      if (w >= 1) ps.local[i].copy(_qa);
      else ps.local[i].slerp(_qa, w);
      ps.offset[i].lerp(_va.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]), Math.min(1, w));
    }
    return this;
  }
  /** additive: solver.local = solver.local * (this as delta from identity) ^ weight */
  add(ps: PoseSolver, weight = 1, mask?: Float32Array | null): this {
    for (let i = 0; i < this.n; i++) {
      const w = weight * (mask ? mask[i] : 1);
      if (w <= 0) continue;
      _qa.set(this.q[i * 4], this.q[i * 4 + 1], this.q[i * 4 + 2], this.q[i * 4 + 3]);
      _qb.identity().slerp(_qa, w);
      ps.local[i].multiply(_qb);
      ps.offset[i].addScaledVector(_va.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]), w);
    }
    return this;
  }
  /** this = lerp(a, b, t) */
  blend(a: PoseBuffer, b: PoseBuffer, t: number): this {
    for (let i = 0; i < this.n; i++) {
      _qa.set(a.q[i * 4], a.q[i * 4 + 1], a.q[i * 4 + 2], a.q[i * 4 + 3]);
      _qb.set(b.q[i * 4], b.q[i * 4 + 1], b.q[i * 4 + 2], b.q[i * 4 + 3]);
      _qa.slerp(_qb, t);
      this.q.set([_qa.x, _qa.y, _qa.z, _qa.w], i * 4);
      for (let j = 0; j < 3; j++) this.p[i * 3 + j] = a.p[i * 3 + j] + (b.p[i * 3 + j] - a.p[i * 3 + j]) * t;
    }
    return this;
  }
}

/** bone mask (1 for listed bones and, optionally, all their descendants) */
export function boneMask(ps: PoseSolver, names: string[], descendants = true): Float32Array {
  const m = new Float32Array(ps.n);
  const roots = new Set(names.filter((n) => ps.has(n)).map((n) => ps.i(n)));
  for (let i = 0; i < ps.n; i++) {
    let p = i;
    while (p >= 0) {
      if (roots.has(p)) {
        m[i] = 1;
        break;
      }
      if (!descendants) break;
      p = ps.parent[p];
    }
  }
  return m;
}

/** smooth 0→1→0 envelope for one-shot animations: rise over a, hold, fall over the last r */
export function envelope(t: number, a: number, r: number): number {
  if (t <= 0 || t >= 1) return 0;
  const up = a > 0 ? Math.min(1, t / a) : 1;
  const dn = r > 0 ? Math.min(1, (1 - t) / r) : 1;
  const v = Math.min(up, dn);
  return v * v * (3 - 2 * v);
}
