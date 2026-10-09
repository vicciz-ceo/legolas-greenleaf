/**
 * Humanoid animator: AnimInput → layered pose → IK solve → spring bones → THREE.Bones.
 *
 * Layers (in order): locomotion (idle/walk/run/sprint/strafe/back, planted feet) or air
 * (jump/fall) + landing → special pose → attack → bow aim (torso twist + exact bow/draw hand IK)
 * → hit flinch → death (overrides) → look-at → springs (hair, skirt, cloak, quiver, beard).
 */
import * as THREE from 'three';
import { PoseSolver, solveTwoBone, fastTwoBone, frameRotation, lookAt, SpringChain, gaitFrequency } from '../kit/anim';
import type { RigDef } from '../kit/rig';
import type { AnimInput, SpecialPose } from '../../core/types';
import type { Proportions } from './proportions';
import type { AnimStyle } from './types';
import {
  F, newPose, neutralPose, idlePose, locomotionPose, airPose, landOverlay, specialPose, attackOverlay, hitOverlay,
  deathPose, mixInto, type BodyMetrics, type Pose,
} from './poses';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const REST_UP_ARM = new THREE.Vector3(0, 0, 1);
const REST_UP_LEG = new THREE.Vector3(0, 0, -1);
const _grip = new THREE.Vector3();
const _nock = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _poleR = new THREE.Vector3();

export interface BowHook {
  /** called after the pose is solved: draw 0..1 and the nock position in MODEL space (null = rest) */
  (pull: number, nockModel: THREE.Vector3 | null, arrowVisible: boolean): void;
}

export class HumanoidAnimator {
  /** benchmarking: force the full solve at every LOD */
  static forceFull = false;
  readonly ps: PoseSolver;
  readonly B: BodyMetrics;
  private P: Proportions;
  private base: Pose = newPose();
  private tmp: Pose = newPose();
  private tmp2: Pose = newPose();
  private t = 0;
  private phase = 0;
  private airTime = 0;
  private landT = 9;
  private wasGrounded = true;
  private specialW = 0;
  private lastSpecial: Exclude<SpecialPose, null> = 'crouch';
  private moveW = 0;
  private springs: SpringChain[] = [];
  private bones: THREE.Bone[];
  private root: THREE.Object3D;
  private idx: Record<string, number> = {};
  private restL: Record<'l' | 'r', THREE.Vector3>;
  private restT = new THREE.Vector3(0, 0, 1);
  /** right hand holds a bow string target this frame (for the bow hook) */
  bowHook: BowHook | null = null;
  /** true when the left hand holds a bow (aim uses the bow arm) */
  hasBow = false;
  /** the right hand holds a crossbow: aiming shoulders it (two-hand hold) instead of drawing a bow */
  hasCrossbow = false;
  /** hand holds something (closes the fist) */
  gripL = false;
  gripR = false;
  /** last computed values for consumers */
  drawPull = 0;
  /**
   * Level of detail of the animation: 0 = full (IK with hand/foot frames, look-at, springs,
   * per-frame fingers); 1 = cheap swing-only limb solve, weapon hand frames, no springs/look-at,
   * fingers only when the grip changes; 2 = as 1 without hand frames and skirt follow.
   * Bow aiming always uses the full solve.
   */
  lod: 0 | 1 | 2 = 0;
  private fingerGrip = { l: -1, r: -1 };

  constructor(rig: RigDef, P: Proportions, style: AnimStyle, bones: THREE.Bone[], root: THREE.Object3D) {
    this.ps = new PoseSolver(rig);
    this.P = P;
    this.bones = bones;
    this.root = root;
    for (const n of rig.boneNames) this.idx[n] = rig.boneIndex(n);
    this.B = {
      s: P.s,
      hipY: P.j.thigh_l[1],
      legLen: P.thigh + P.shin,
      reach: P.upperArm + P.foreArm,
      hipX: P.hipX,
      shoulderY: P.j.upperarm_l[1],
      shoulderX: P.shoulderX,
      ankleH: P.ankleH,
      footLen: P.footLen,
      height: P.H,
      style,
    };
    this.restL = { l: P.hand.l.L.clone(), r: P.hand.r.L.clone() };
    const n = rig.count;
    this.keepCheap = new Uint8Array(n);
    this.fingerBone = new Uint8Array(n);
    for (const nm of ['fing1', 'fing2', 'thumb1', 'thumb2']) for (const sd of ['l', 'r']) this.keepCheap[this.idx[`${nm}_${sd}`]] = this.fingerBone[this.idx[`${nm}_${sd}`]] = 1;
    // constant in the cheap path: toes and every spring chain bone
    for (const nm of rig.boneNames) if (/^(toe_|hair\d|cloak\d|beard\d|quiver)/.test(nm) || (/^skirt_/.test(nm) && false)) this.keepCheap[this.idx[nm]] = 1;
    this.trunk = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_l', 'shoulder_r', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r'].map((nm) => this.idx[nm]);
    for (const sd of ['l', 'r'] as const) {
      const th = P.j[`thigh_${sd}`], kn = P.j[`shin_${sd}`], an = P.j[`foot_${sd}`];
      this.restLeg[sd].a.set(kn[0] - th[0], kn[1] - th[1], kn[2] - th[2]).normalize();
      this.restLeg[sd].b.set(an[0] - kn[0], an[1] - kn[1], an[2] - kn[2]).normalize();
    }
    this.gripOff = { l: this.gripOffset('l'), r: this.gripOffset('r') };
    const ps = this.ps;
    const s = P.s;
    const has = (n: string) => this.idx[n] !== undefined;
    const backCol = { bone: this.idx.chest, offset: [0, 0.06 * s, -0.035 * s] as [number, number, number], radius: 0.15 * s * Math.sqrt(P.build.bulk) * P.build.chest };
    const hipCol = { bone: this.idx.hips, offset: [0, -0.02 * s, -0.02 * s] as [number, number, number], radius: 0.15 * s * Math.sqrt(P.build.bulk) };
    const thighL = { bone: this.idx.thigh_l, offset: [0, -0.16 * s, 0.01 * s] as [number, number, number], radius: 0.085 * s * P.build.bulk };
    const thighR = { bone: this.idx.thigh_r, offset: [0, -0.16 * s, 0.01 * s] as [number, number, number], radius: 0.085 * s * P.build.bulk };
    if (has('hair1')) {
      this.springs.push(
        new SpringChain(ps, [this.idx.hair1, this.idx.hair2, this.idx.hair3], [0, -0.16 * s, -0.02 * s], {
          stiffness: 0.07,
          drag: 0.14,
          gravity: 3,
          colliders: [backCol, { bone: this.idx.neck, offset: [0, 0.03 * s, -0.01 * s], radius: 0.07 * s }],
          // the hair lies on the back: a turned head (aiming, look-at) must not swing it around
          // the neck onto the shoulders
          frame: { bone: this.idx.chest, weight: 0.85 },
        }),
      );
    }
    if (has('skirt_f')) {
      this.springs.push(new SpringChain(ps, [this.idx.skirt_f], [0, -0.26 * s, 0.03 * s], { stiffness: 0.16, drag: 0.2, gravity: 2, colliders: [thighL, thighR] }));
      this.springs.push(new SpringChain(ps, [this.idx.skirt_b], [0, -0.26 * s, -0.03 * s], { stiffness: 0.16, drag: 0.2, gravity: 2, colliders: [thighL, thighR, hipCol] }));
    }
    if (has('cloak1_l')) {
      for (const sd of ['l', 'r']) {
        this.springs.push(
          new SpringChain(ps, [this.idx[`cloak1_${sd}`], this.idx[`cloak2_${sd}`], this.idx[`cloak3_${sd}`]], [0, -0.42 * s, -0.03 * s], {
            stiffness: 0.05,
            drag: 0.12,
            gravity: 5,
            colliders: [backCol, hipCol, thighL, thighR],
          }),
        );
      }
    }
    if (has('quiver')) this.springs.push(new SpringChain(ps, [this.idx.quiver], [0, 0.22 * s, 0], { stiffness: 0.35, drag: 0.3, gravity: 1 }));
    if (has('beard1')) this.springs.push(new SpringChain(ps, [this.idx.beard1, this.idx.beard2], [0, -0.1 * s, 0.02 * s], { stiffness: 0.12, drag: 0.2, gravity: 3 }));
  }

  /** reset time-dependent state (lab determinism); optionally seek the clock and gait phase */
  reset(time = 0, phase = 0) {
    this.t = time;
    this.phase = phase;
    this.airTime = 0;
    this.landT = 9;
    this.wasGrounded = true;
    this.specialW = 0;
    this.moveW = 0;
    for (const sp of this.springs) sp.reset();
  }

  update(dt: number, inp: AnimInput) {
    const B = this.B;
    this.t += dt;
    const t = this.t;
    const speed = Math.max(0, inp.speed || 0);
    const grounded = inp.grounded !== false;
    const dead = inp.dead ?? 0;
    // gait phase
    const freq = gaitFrequency(speed, B.legLen) * B.style.cadence;
    if (grounded) this.phase += freq * dt;
    // air tracking
    if (!grounded) this.airTime += dt;
    else {
      if (!this.wasGrounded && this.airTime > 0.12) this.landT = 0;
      this.airTime = 0;
    }
    this.wasGrounded = grounded;
    this.landT += dt;
    const mw = Math.min(1, speed / 0.5);
    this.moveW += (mw - this.moveW) * Math.min(1, dt * 8);

    // ── base layer ─────────────────────────────────────────────────────────
    const base = this.base;
    const md = inp.moveDir ?? { x: 0, z: 1 };
    if (speed > 0.02) locomotionPose(B, this.phase, speed, md.x, md.z, t, base);
    else idlePose(B, t, base);
    if (speed > 0.02 && speed < 0.6) {
      // ease from idle into walking
      idlePose(B, t, this.tmp);
      mixInto(base, this.tmp, 1 - speed / 0.6);
    }
    if (!grounded) {
      airPose(B, inp.vy ?? 0, this.airTime, t, this.tmp);
      mixInto(base, this.tmp, Math.min(1, this.airTime * 10));
    }
    if (this.landT < 0.4 && grounded) {
      const k = this.landT < 0.08 ? this.landT / 0.08 : 1 - (this.landT - 0.08) / 0.32;
      landOverlay(B, Math.max(0, k), base);
    }
    // ── special poses ──────────────────────────────────────────────────────
    if (inp.special) this.lastSpecial = inp.special;
    const sTarget = inp.special ? 1 : 0;
    this.specialW += (sTarget - this.specialW) * Math.min(1, dt * 7);
    if (this.specialW > 0.001) {
      specialPose(B, this.lastSpecial, inp.specialT ?? t * 0.8, t, this.tmp);
      mixInto(base, this.tmp, this.specialW);
    }
    // ── attacks ───────────────────────────────────────────────────────────
    let aim = Math.min(1, Math.max(0, inp.aim ?? 0));
    let draw = Math.min(1, Math.max(0, inp.draw ?? 0));
    if (inp.attack) {
      if (inp.attack.kind === 'shoot') {
        const at = inp.attack.t;
        aim = Math.max(aim, Math.min(1, at / 0.2) * (at < 0.9 ? 1 : (1 - at) / 0.1));
        draw = at < 0.7 ? Math.min(1, Math.max(0, (at - 0.12) / 0.5)) : Math.max(0, 1 - (at - 0.7) / 0.06);
      } else {
        this.tmp2.set(base);
        attackOverlay(B, inp.attack.kind, Math.min(1, Math.max(0, inp.attack.t)), base, this.tmp2);
      }
    }
    // ── bow aim stance (torso) ─────────────────────────────────────────────
    const aimW = this.hasBow || this.hasCrossbow || aim > 0 ? aim : 0;
    const pitch = inp.aimPitch ?? 0;
    if (aimW > 0) {
      const still = 1 - this.moveW;
      const xb = this.hasCrossbow && !this.hasBow ? 0.45 : 1; // crossbows are shot square-on
      base[F.pyaw] += (-0.55 * aimW * xb) * (0.4 + 0.6 * still);
      base[F.sy] += -0.25 * aimW;
      base[F.cy] += (-0.42 * aimW - (1 - (0.4 + 0.6 * still)) * 0.33 * aimW) * xb;
      base[F.cr] += pitch * 0.45 * aimW;
      base[F.ny] += 0.5 * aimW * xb;
      base[F.hy] += 0.55 * aimW * xb;
      base[F.hp] += -pitch * 0.35 * aimW;
      base[F.cp] += -0.04 * aimW;
      // stance when standing
      const k = aimW * still;
      base[F.flz] += 0.1 * B.legLen * k;
      base[F.frz] += -0.12 * B.legLen * k;
      base[F.flx] += 0.03 * B.s * k;
      base[F.frx] += -0.05 * B.s * k;
      base[F.flyaw] += 0.0 * k;
      base[F.fryaw] += -0.9 * k;
      base[F.py] += -0.02 * B.s * k;
    }
    // ── hit ────────────────────────────────────────────────────────────────
    hitOverlay(B, inp.hit ?? 0, base);
    // ── death ──────────────────────────────────────────────────────────────
    if (dead > 0) {
      deathPose(B, inp.deathVariant ?? 0, Math.min(1, dead), this.tmp);
      mixInto(base, this.tmp, Math.min(1, dead * 5));
    }
    // carrying a bow at rest: forearm a little forward, wrist flexed so the bow stands tilted up-forward
    if (this.hasBow && dead <= 0) {
      const k = (1 - aimW) * (1 - this.specialW) * (inp.attack ? 0 : 1);
      if (k > 0) {
        base[F.hlz] += (0.16 - base[F.hlz] * 0.3) * k;
        base[F.hly] += 0.06 * k;
        base[F.hldx] += (0.05 - base[F.hldx]) * k;
        base[F.hldy] += (-0.55 - base[F.hldy]) * k;
        base[F.hldz] += (0.83 - base[F.hldz]) * k;
        base[F.hltx] += (-0.08 - base[F.hltx]) * k;
        base[F.hlty] += (0.84 - base[F.hlty]) * k;
        base[F.hltz] += (0.54 - base[F.hltz]) * k;
      }
    }
    if (this.gripL) base[F.gl] = Math.max(base[F.gl], 0.95 * (1 - Math.min(1, dead * 2)));
    if (this.gripR) base[F.gr] = Math.max(base[F.gr], 0.95 * (1 - Math.min(1, dead * 2)));

    const aimS = dead > 0 ? 0 : aimW;
    if (this.lod > 0 && aimS <= 0.001 && !HumanoidAnimator.forceFull) this.solveCheap(base, dt);
    else this.solve(base, aimS, draw, pitch, dead > 0 ? null : inp.lookAt ?? null, dt);
  }

  /** distant LODs: no springs, no look-at, swing-only limb solve, fingers only on grip change */
  private solveCheap(p: Pose, dt: number) {
    const ps = this.ps;
    const I = this.idx;
    const B = this.B;
    const P = this.P;
    const s = B.s;
    void dt;
    // keep finger locals (set on grip change) — reset everything else
    const keep = this.keepCheap;
    for (let i = 0; i < ps.n; i++) {
      if (keep[i]) continue;
      ps.local[i].identity();
      ps.offset[i].set(0, 0, 0);
    }
    ps.offset[I.hips].set(p[F.px], p[F.py], p[F.pz]);
    ps.local[I.hips].setFromEuler(_e.set(p[F.pp], p[F.pyaw], p[F.pr], 'YXZ'));
    ps.local[I.spine].setFromEuler(_e.set(p[F.sp], p[F.sy], p[F.sr], 'YXZ'));
    ps.local[I.chest].setFromEuler(_e.set(p[F.cp], p[F.cy], p[F.cr], 'YXZ'));
    ps.local[I.neck].setFromEuler(_e.set(p[F.np], p[F.ny], p[F.nr], 'YXZ'));
    ps.local[I.head].setFromEuler(_e.set(p[F.hp], p[F.hy], p[F.hr], 'YXZ'));
    ps.local[I.jaw].setFromAxisAngle(_v1.set(1, 0, 0), p[F.jaw] * 0.45);
    ps.local[I.shoulder_l].setFromAxisAngle(_v1.set(0, 0, 1), p[F.cll] * 0.6);
    ps.local[I.shoulder_r].setFromAxisAngle(_v1.set(0, 0, 1), -p[F.clr] * 0.6);
    // FK of the trunk only (limb roots); limbs are solved below
    for (const i of this.trunk) ps.fkBone(i);
    // legs
    for (const sd of ['l', 'r'] as const) {
      const xi = sd === 'l' ? F.flx : F.frx;
      const rest = P.j[`foot_${sd}`];
      const tgt = _v1.set(rest[0] + p[xi], rest[1] + p[xi + 1], rest[2] + p[xi + 2]);
      const sx = sd === 'l' ? 1 : -1;
      const yaw = p[xi + 4];
      const thigh = ps.modelP[I[`thigh_${sd}`]];
      const kb = sd === 'l' ? p[F.kl] : p[F.kr];
      const pole = _v2.set(Math.sin(yaw) + sx * kb, 0, Math.cos(yaw)).normalize().multiplyScalar(0.6 * s).add(_v3.copy(thigh).lerp(tgt, 0.5));
      _q1.setFromEuler(_e.set(p[xi + 3], yaw, 0, 'YXZ'));
      fastTwoBone(ps, I[`thigh_${sd}`], I[`shin_${sd}`], I[`foot_${sd}`], tgt, pole, this.restLeg[sd].a, this.restLeg[sd].b, _q1);
    }
    // arms
    const chestQ = ps.modelQ[I.chest];
    const R = B.reach;
    for (const sd of ['l', 'r'] as const) {
      const sh = ps.modelP[I[`upperarm_${sd}`]];
      const hx = sd === 'l' ? F.hlx : F.hrx;
      const ex = sd === 'l' ? F.elx : F.erx;
      const pw = sd === 'l' ? F.plw : F.prw;
      const tgt = _v1.set(p[hx], p[hx + 1], p[hx + 2]).multiplyScalar(R).applyQuaternion(chestQ).add(sh);
      if (p[pw] > 0) tgt.lerp(_v2.set(p[pw + 1], p[pw + 2], p[pw + 3]), Math.min(1, p[pw]));
      const pole = _v2.set(p[ex], p[ex + 1], p[ex + 2]).normalize().applyQuaternion(chestQ).multiplyScalar(0.5 * s).add(sh);
      let end: THREE.Quaternion | null = null;
      if (this.lod === 1 && (sd === 'l' ? this.gripL : this.gripR)) {
        const dx = sd === 'l' ? F.hldx : F.hrdx;
        const tx = sd === 'l' ? F.hltx : F.hrtx;
        const dir = _v3.set(p[dx], p[dx + 1], p[dx + 2]).normalize().applyQuaternion(chestQ);
        const thumb = _v4.set(p[tx], p[tx + 1], p[tx + 2]).normalize().applyQuaternion(chestQ);
        end = frameRotation(this.restL[sd], this.restT, dir, thumb, _q2);
      }
      fastTwoBone(ps, I[`upperarm_${sd}`], I[`forearm_${sd}`], I[`hand_${sd}`], tgt, pole, this.restL[sd], this.restL[sd], end);
    }
    // fingers: only when the grip changed noticeably (locals persist between frames)
    let fingersDirty = false;
    for (const sd of ['l', 'r'] as const) {
      const g = sd === 'l' ? p[F.gl] : p[F.gr];
      if (Math.abs(g - this.fingerGrip[sd]) < 0.08) continue;
      this.fingerGrip[sd] = g;
      fingersDirty = true;
      const f = P.hand[sd];
      const axis = sd === 'l' ? _v1.copy(f.T).multiplyScalar(-1) : _v1.copy(f.T);
      ps.local[I[`fing1_${sd}`]].setFromAxisAngle(axis, g * 1.45);
      ps.local[I[`fing2_${sd}`]].setFromAxisAngle(axis, g * 1.55);
      ps.local[I[`thumb1_${sd}`]].setFromAxisAngle(_v2.copy(f.L), (sd === 'l' ? 1 : -1) * g * 0.5);
      ps.local[I[`thumb2_${sd}`]].setFromAxisAngle(axis, g * 0.7);
    }
    // skirt panels follow the thighs (LOD1)
    if (I.skirt_f !== undefined && this.lod === 1) {
      const fl = this.thighFlex('l');
      const fr = this.thighFlex('r');
      ps.local[I.skirt_f].setFromAxisAngle(_v1.set(1, 0, 0), -Math.max(0, fl, fr) * 0.85);
      ps.local[I.skirt_b].setFromAxisAngle(_v1.set(1, 0, 0), -Math.min(0, fl, fr) * 0.85);
    }
    // write the animated bones; static ones (fingers, toes, spring chains) keep their matrices
    const bones = this.bones;
    for (let i = 0; i < ps.n; i++) {
      if (keep[i] && !fingersDirty) continue;
      const b = bones[i];
      b.quaternion.copy(ps.local[i]);
      b.position.copy(ps.restLocal[i]).add(ps.offset[i]);
      if (keep[i]) b.updateMatrix();
    }
    if (this.bowHook) this.bowHook(0, null, false);
  }

  /** bones whose locals persist in the cheap path (fingers, toes, spring chains) */
  private keepCheap: Uint8Array = new Uint8Array(0);
  private fingerBone: Uint8Array = new Uint8Array(0);
  /** trunk bones FK'd in the cheap path (root → shoulders/upper arms, thighs) */
  private trunk: number[] = [];
  private restLeg = { l: { a: new THREE.Vector3(), b: new THREE.Vector3() }, r: { a: new THREE.Vector3(), b: new THREE.Vector3() } };

  /** switch animation LOD; the full path re-initialises springs when coming back to LOD0 */
  setLod(level: 0 | 1 | 2) {
    if (level === this.lod) return;
    if (level === 0) for (const sp of this.springs) sp.reset();
    this.fingerGrip.l = this.fingerGrip.r = -1;
    const ps = this.ps;
    for (let i = 0; i < ps.n; i++) {
      if (!this.keepCheap[i]) continue;
      const b = this.bones[i];
      b.matrixAutoUpdate = level === 0;
      if (level > 0 && !this.fingerBone[i]) {
        // spring chains / toes rest at identity in the cheap path
        ps.local[i].identity();
        ps.offset[i].set(0, 0, 0);
        b.quaternion.identity();
        b.position.copy(ps.restLocal[i]);
        b.updateMatrix();
      }
    }
    this.lod = level;
  }

  private solve(p: Pose, aimW: number, draw: number, pitch: number, look: THREE.Vector3 | null, dt: number) {
    const ps = this.ps;
    const I = this.idx;
    const B = this.B;
    const P = this.P;
    const s = B.s;
    ps.reset();
    ps.offset[I.hips].set(p[F.px], p[F.py], p[F.pz]);
    ps.local[I.hips].setFromEuler(_e.set(p[F.pp], p[F.pyaw], p[F.pr], 'YXZ'));
    ps.local[I.spine].setFromEuler(_e.set(p[F.sp], p[F.sy], p[F.sr], 'YXZ'));
    ps.local[I.chest].setFromEuler(_e.set(p[F.cp], p[F.cy], p[F.cr], 'YXZ'));
    ps.local[I.neck].setFromEuler(_e.set(p[F.np], p[F.ny], p[F.nr], 'YXZ'));
    ps.local[I.head].setFromEuler(_e.set(p[F.hp], p[F.hy], p[F.hr], 'YXZ'));
    ps.local[I.jaw].setFromAxisAngle(_v1.set(1, 0, 0), p[F.jaw] * 0.45);
    ps.local[I.shoulder_l].setFromAxisAngle(_v1.set(0, 0, 1), p[F.cll] * 0.6);
    ps.local[I.shoulder_r].setFromAxisAngle(_v1.set(0, 0, 1), -p[F.clr] * 0.6);
    ps.fk();

    // ── legs ──────────────────────────────────────────────────────────────
    for (const sd of ['l', 'r'] as const) {
      const xi = sd === 'l' ? F.flx : F.frx;
      const rest = P.j[`foot_${sd}`];
      const tgt = _v1.set(rest[0] + p[xi], rest[1] + p[xi + 1], rest[2] + p[xi + 2]);
      const sx = sd === 'l' ? 1 : -1;
      const yaw = p[xi + 4];
      // knee pole: forward of the knee, rotated with the foot yaw and pushed outward
      const thigh = ps.modelP[I[`thigh_${sd}`]];
      const kb = sd === 'l' ? p[F.kl] : p[F.kr];
      const pole = _v2.set(Math.sin(yaw) + sx * kb, 0, Math.cos(yaw)).normalize().multiplyScalar(0.6 * s).add(_v3.copy(thigh).lerp(tgt, 0.5));
      // foot orientation: yaw then pitch (toe down +)
      _q1.setFromEuler(_e.set(p[xi + 3], yaw, 0, 'YXZ'));
      solveTwoBone(ps, I[`thigh_${sd}`], I[`shin_${sd}`], I[`foot_${sd}`], tgt, pole, {
        restUp: REST_UP_LEG,
        endRotation: _q1,
        maxStretch: 1.04,
      });
      // toe stays flat-ish when the heel lifts (pitch > 0 → toes bend up)
      const tb = Math.max(0, p[xi + 3]) * 0.9;
      ps.local[I[`toe_${sd}`]].setFromAxisAngle(_v1.set(1, 0, 0), -tb);
      ps.fkFrom(I[`toe_${sd}`]);
    }

    // ── arms ──────────────────────────────────────────────────────────────
    const chestQ = ps.modelQ[I.chest];
    const R = B.reach;
    for (const sd of ['l', 'r'] as const) {
      const sh = ps.modelP[I[`upperarm_${sd}`]];
      const hx = sd === 'l' ? F.hlx : F.hrx;
      const dx = sd === 'l' ? F.hldx : F.hrdx;
      const tx = sd === 'l' ? F.hltx : F.hrtx;
      const ex = sd === 'l' ? F.elx : F.erx;
      const pw = sd === 'l' ? F.plw : F.prw;
      const tgt = _v1.set(p[hx], p[hx + 1], p[hx + 2]).multiplyScalar(R).applyQuaternion(chestQ).add(sh);
      if (p[pw] > 0) tgt.lerp(_v2.set(p[pw + 1], p[pw + 2], p[pw + 3]), Math.min(1, p[pw]));
      const pole = _v2.set(p[ex], p[ex + 1], p[ex + 2]).normalize().applyQuaternion(chestQ).multiplyScalar(0.5 * s).add(sh);
      const dir = _v3.set(p[dx], p[dx + 1], p[dx + 2]).normalize().applyQuaternion(chestQ);
      const thumb = _v4.set(p[tx], p[tx + 1], p[tx + 2]).normalize().applyQuaternion(chestQ);
      frameRotation(this.restL[sd], this.restT, dir, thumb, _q2);
      solveTwoBone(ps, I[`upperarm_${sd}`], I[`forearm_${sd}`], I[`hand_${sd}`], tgt, pole, {
        restDirA: this.restL[sd],
        restDirB: this.restL[sd],
        restUp: REST_UP_ARM,
        endRotation: _q2,
        maxStretch: 1.02,
      });
    }

    // ── bow aim: exact bow arm along the aim line, draw hand on the string ──
    this.drawPull = 0;
    let nock: THREE.Vector3 | null = null;
    if (aimW > 0.001 && this.hasCrossbow && !this.hasBow) {
      // crossbow: stock shouldered along the aim line, right hand on the grip, left hand under the fore-stock
      const aimDir = _v3.set(0, Math.sin(pitch), Math.cos(pitch));
      const shR = ps.modelP[I.upperarm_r];
      const right = _right.crossVectors(aimDir, UP).normalize(); // character's right (−X)
      const gripT = _grip.copy(shR).addScaledVector(aimDir, 0.28 * s).addScaledVector(UP, -0.01 * s).addScaledVector(right, -0.1 * s);
      gripT.lerp(ps.modelP[I.hand_r], 1 - aimW);
      const poleR = _poleR.copy(shR).addScaledVector(right, 0.5 * s).addScaledVector(UP, -0.4 * s);
      // pistol grip: thumb (stock) along the aim line, knuckles down
      frameRotation(this.restL.r, this.restT, _v4.set(0, -1, 0).addScaledVector(aimDir, 0.25), aimDir, _q2);
      _q1.copy(ps.modelQ[I.hand_r]).slerp(_q2, aimW);
      solveTwoBone(ps, I.upperarm_r, I.forearm_r, I.hand_r, gripT, poleR, { restDirA: this.restL.r, restDirB: this.restL.r, restUp: REST_UP_ARM, endRotation: _q1, maxStretch: 1.03 });
      const shL = ps.modelP[I.upperarm_l];
      const foreT = _wrist.copy(gripT).addScaledVector(aimDir, 0.26 * s).addScaledVector(UP, -0.045 * s).addScaledVector(right, 0.015 * s);
      foreT.lerp(ps.modelP[I.hand_l], 1 - aimW);
      const poleL = _v2.copy(shL).add(_v1.set(0.6, -1, -0.1).normalize().multiplyScalar(0.5 * s));
      // supporting hand: palm up under the stock, knuckles across toward the right
      frameRotation(this.restL.l, this.restT, _v1.copy(right).addScaledVector(aimDir, 0.5), aimDir, _q2);
      _q1.copy(ps.modelQ[I.hand_l]).slerp(_q2, aimW);
      solveTwoBone(ps, I.upperarm_l, I.forearm_l, I.hand_l, foreT, poleL, { restDirA: this.restL.l, restDirB: this.restL.l, restUp: REST_UP_ARM, endRotation: _q1, maxStretch: 1.03 });
      p[F.gr] = Math.max(p[F.gr], aimW);
      p[F.gl] = Math.max(p[F.gl], 0.6 * aimW);
    } else if (aimW > 0.001) {
      const aimDir = _v3.set(0, Math.sin(pitch), Math.cos(pitch));
      const shL = ps.modelP[I.upperarm_l];
      const bowT = _v1.copy(shL).addScaledVector(aimDir, R * 0.93).addScaledVector(UP, -0.035 * s);
      const curL = ps.modelP[I.hand_l];
      bowT.lerp(curL, 1 - aimW);
      const poleL = _v2.copy(shL).add(_v4.set(0.6, -1, -0.15).normalize().multiplyScalar(0.5 * s));
      // knuckles along the aim line, thumb up
      const thumbUp = _v4.set(0.12, 1, 0).normalize();
      frameRotation(this.restL.l, this.restT, aimDir, thumbUp, _q2);
      _q1.copy(ps.modelQ[I.hand_l]).slerp(_q2, aimW);
      solveTwoBone(ps, I.upperarm_l, I.forearm_l, I.hand_l, bowT, poleL, {
        restDirA: this.restL.l,
        restDirB: this.restL.l,
        restUp: REST_UP_ARM,
        endRotation: _q1,
        maxStretch: 1.02,
        weight: 1,
      });
      // grip point of the bow (hand_l socket position)
      const go = this.gripOff.l;
      const grip = ps.pointOn(I.hand_l, go[0], go[1], go[2], _grip);
      const brace = 0.17 * s;
      const pull = brace + 0.56 * s * draw;
      nock = _nock.copy(grip).addScaledVector(aimDir, -pull).addScaledVector(UP, 0.012 * s);
      // right wrist behind the nock (fingers hook the string)
      const right = _right.crossVectors(aimDir, UP).normalize(); // character's right (−X at rest)
      const wristT = _wrist.copy(nock).addScaledVector(aimDir, -0.075 * s).addScaledVector(UP, -0.03 * s).addScaledVector(right, 0.02 * s);
      wristT.lerp(ps.modelP[I.hand_r], 1 - aimW);
      const shR = ps.modelP[I.upperarm_r];
      const poleR = _poleR.copy(shR).addScaledVector(right, 0.6 * s).addScaledVector(UP, 0.35 * s).addScaledVector(aimDir, -0.5 * s);
      const thumbR = _v4.copy(UP).multiplyScalar(-1).addScaledVector(aimDir, -0.4).addScaledVector(right, 0.3).normalize();
      frameRotation(this.restL.r, this.restT, aimDir, thumbR, _q2);
      _q1.copy(ps.modelQ[I.hand_r]).slerp(_q2, aimW);
      solveTwoBone(ps, I.upperarm_r, I.forearm_r, I.hand_r, wristT, poleR, {
        restDirA: this.restL.r,
        restDirB: this.restL.r,
        restUp: REST_UP_ARM,
        endRotation: _q1,
        maxStretch: 1.05,
      });
      this.drawPull = draw;
      p[F.gr] = Math.max(p[F.gr], 0.75 * aimW);
      p[F.gl] = Math.max(p[F.gl], aimW);
      // ease the nock back to rest when not fully aiming
      if (aimW < 1) nock = null;
    }

    // ── fingers ───────────────────────────────────────────────────────────
    for (const sd of ['l', 'r'] as const) {
      const g = sd === 'l' ? p[F.gl] : p[F.gr];
      const f = P.hand[sd];
      const axis = sd === 'l' ? _v1.copy(f.T).multiplyScalar(-1) : _v1.copy(f.T);
      ps.local[I[`fing1_${sd}`]].setFromAxisAngle(axis, g * 1.45);
      ps.local[I[`fing2_${sd}`]].setFromAxisAngle(axis, g * 1.55);
      // thumb folds across the palm
      const ta = _v2.copy(f.L);
      ps.local[I[`thumb1_${sd}`]].setFromAxisAngle(ta, (sd === 'l' ? 1 : -1) * g * 0.5);
      ps.local[I[`thumb2_${sd}`]].setFromAxisAngle(axis, g * 0.7);
      ps.fkFrom(I[`hand_${sd}`]);
    }

    // ── skirt follows the thighs ─────────────────────────────────────────
    if (I.skirt_f !== undefined) {
      const fl = this.thighFlex('l');
      const fr = this.thighFlex('r');
      ps.local[I.skirt_f].setFromAxisAngle(_v1.set(1, 0, 0), -Math.max(0, fl, fr) * 0.85);
      ps.local[I.skirt_b].setFromAxisAngle(_v1.set(1, 0, 0), -Math.min(0, fl, fr) * 0.85);
      ps.fkFrom(I.skirt_f);
      ps.fkFrom(I.skirt_b);
    }

    // ── look-at ───────────────────────────────────────────────────────────
    if (look && aimW < 0.5) {
      this.root.updateWorldMatrix(true, false);
      _m.copy(this.root.matrixWorld).invert();
      const lt = _v1.copy(look).applyMatrix4(_m);
      lookAt(ps, [I.neck, I.head], [0.4, 0.6], lt, { amount: 1 - aimW * 2, maxYaw: 1.2, maxPitch: 0.6 });
    }

    // ── springs ───────────────────────────────────────────────────────────
    if (this.springs.length) {
      this.root.updateWorldMatrix(true, false);
      for (const sp of this.springs) sp.update(ps, dt, this.root.matrixWorld);
    }
    ps.apply(this.bones);
    if (this.bowHook) this.bowHook(this.drawPull, nock, aimW > 0.3);
  }

  /** forward flexion of a thigh (radians, + = leg forward) */
  private thighFlex(sd: 'l' | 'r'): number {
    const ps = this.ps;
    const a = ps.modelP[this.idx[`thigh_${sd}`]];
    const b = ps.modelP[this.idx[`shin_${sd}`]];
    const hipQ = ps.modelQ[this.idx.hips];
    const d = _v1.subVectors(b, a).applyQuaternion(_q1.copy(hipQ).invert());
    return Math.atan2(d.z, -d.y);
  }

  private gripOff = { l: [0, 0, 0] as [number, number, number], r: [0, 0, 0] as [number, number, number] };
  /** grip point offset in hand-bone rest axes (wrist-relative) */
  gripOffset(sd: 'l' | 'r'): [number, number, number] {
    const P = this.P;
    const f = P.hand[sd];
    const a = P.palm * 0.78;
    const c = 0.022 * P.s;
    return [f.L.x * a + f.N.x * c, f.L.y * a + f.N.y * c, f.L.z * a + f.N.z * c];
  }

  /** world-space spring/tick for external use */
  get time() {
    return this.t;
  }
}
