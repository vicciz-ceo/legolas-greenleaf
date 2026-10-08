/**
 * Third-person camera rig (over the right shoulder).
 *
 * - smoothed pivot that follows the player's chest; yaw/pitch are written by the player
 *   controller from look input
 * - aim zoom (FOV 70 → 48, tighter shoulder), sprint/focus FOV changes, dash/recoil punches
 * - collision pull-in via physics.raycast(…, 'camera') with fast-in / slow-out
 * - trauma-based shake, scripted shots (CameraShot) with blend in/out, mover camera params,
 *   lockCameraYaw
 * - per-frame `aimTarget`: the world point under the crosshair (hostile combatants + world)
 */
import * as THREE from 'three';
import type { CameraParams, CameraRig, CameraShot, Combatant, GameContext, HitZone, PlayerMover } from '../core/types';
import { clamp, damp, dampAngle, dampFactor, easeInOutSine, lerp } from '../core/math';
import { hostile } from './combatant';

export const DEFAULT_CAMERA: CameraParams = { distance: 3.4, height: 1.62, shoulder: 0.62, fov: 70 };
export const AIM_CAMERA: CameraParams = { distance: 2.15, height: 1.6, shoulder: 0.78, fov: 48 };
const PITCH_MIN = -1.2;
const PITCH_MAX = 1.05;
const AIM_RANGE = 250;

/** what the rig reads from the player each frame */
export interface CameraSubject {
  readonly position: THREE.Vector3;
  readonly facing: number;
  readonly mover: PlayerMover | null;
  /** 0..1: 1 = full aim (aim held), ~0.45 = drawing from the hip */
  readonly aimZoom: number;
  readonly focusActive: boolean;
  /** 0..1 */
  readonly sprintBlend: number;
  /** visual vertical offset of the body (step smoothing), added to the pivot */
  readonly visualYOffset: number;
  readonly self: Combatant;
}

export interface CameraRigExt extends CameraRig {
  /** current camera position (after collision, before shake) */
  readonly position: THREE.Vector3;
  /** combatant under the crosshair this frame */
  readonly aimCombatant: Combatant | null;
  /** zone of aimCombatant under the crosshair */
  readonly aimZone: HitZone | null;
  /** start of the aim ray this frame (on the camera ray, at the player's depth) */
  readonly aimOrigin: THREE.Vector3;
  /** current aim blend 0..1 */
  readonly aimBlend: number;
  /** kick the view up by `rad` (bow recoil); recovers over ~0.25 s */
  recoil(rad: number): void;
  /** brief FOV punch in degrees (dash, impacts) */
  punch(deg: number): void;
  /** skip smoothing next frame (teleport/respawn) */
  snap(): void;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivotTarget = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _back = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _shake = new THREE.Euler();
const _qs = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** smooth 1D pseudo-noise from summed sines (-1..1) */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.2);
}

export function createCameraRig(ctx: GameContext, subject: CameraSubject): CameraRigExt {
  const cam = () => ctx.engine.camera;
  const pivot = new THREE.Vector3().copy(subject.position).setY(subject.position.y + DEFAULT_CAMERA.height);
  const position = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, 1);
  const aimTarget = new THREE.Vector3();
  const aimOrigin = new THREE.Vector3();
  let aimCombatant: Combatant | null = null;
  let aimZone: HitZone | null = null;
  let curDist = DEFAULT_CAMERA.distance;
  let aimBlend = 0;
  let focusBlend = 0;
  let sprintBlend = 0;
  let trauma = 0;
  let traumaDecay = 1;
  let shakeT = 0;
  let recoilP = 0;
  let punchDeg = 0;
  let snapNext = true;
  let fovCur = DEFAULT_CAMERA.fov;

  // scripted shots
  let shot: CameraShot | null = null;
  let lastShot: CameraShot | null = null;
  let blendT = 1;
  let blendDur = 0.6;
  const fromPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  let fromFov = 70;
  let shotActive = false; // currently showing (or blending into) a scripted shot
  const playerPos = new THREE.Vector3();
  const playerQuat = new THREE.Quaternion();
  let playerFov = 70;

  function computePlayerPose(dt: number) {
    const mc = subject.mover?.camera;
    const base = rig.params;
    const pd = mc?.distance ?? base.distance;
    const ph = mc?.height ?? base.height;
    const ps = mc?.shoulder ?? base.shoulder;
    const pf = mc?.fov ?? base.fov;
    aimBlend = damp(aimBlend, subject.aimZoom, 12, dt);
    focusBlend = damp(focusBlend, subject.focusActive ? 1 : 0, 6, dt);
    sprintBlend = damp(sprintBlend, subject.sprintBlend, 4, dt);
    const dist = lerp(pd, AIM_CAMERA.distance, aimBlend) + sprintBlend * 0.35 - focusBlend * 0.3;
    const height = lerp(ph, AIM_CAMERA.height, aimBlend);
    const shoulder = lerp(ps, AIM_CAMERA.shoulder, aimBlend);
    const fov = lerp(pf, AIM_CAMERA.fov, aimBlend) + sprintBlend * 5 - focusBlend * 7 + punchDeg;
    punchDeg = damp(punchDeg, 0, 7, dt);

    if (subject.mover?.lockCameraYaw) rig.yaw = dampAngle(rig.yaw, subject.facing, 5, dt);
    rig.pitch = clamp(rig.pitch, PITCH_MIN, PITCH_MAX);
    recoilP = damp(recoilP, 0, 9, dt);
    const pitch = clamp(rig.pitch + recoilP, PITCH_MIN, PITCH_MAX);

    _pivotTarget.copy(subject.position);
    _pivotTarget.y += height + subject.visualYOffset;
    if (snapNext || pivot.distanceToSquared(_pivotTarget) > 36) {
      pivot.copy(_pivotTarget);
    } else {
      const kxz = dampFactor(28, dt);
      const ky = dampFactor(11, dt);
      pivot.x += (_pivotTarget.x - pivot.x) * kxz;
      pivot.z += (_pivotTarget.z - pivot.z) * kxz;
      pivot.y += (_pivotTarget.y - pivot.y) * ky;
    }

    const cy = Math.cos(rig.yaw);
    const sy = Math.sin(rig.yaw);
    const cp = Math.cos(pitch);
    _fwd.set(sy * cp, Math.sin(pitch), cy * cp);
    _right.set(-cy, 0, sy);
    forward.copy(_fwd);

    // shoulder offset (pull in if a wall is beside us)
    _shoulder.copy(pivot);
    const sDir = shoulder >= 0 ? 1 : -1;
    _tmp.copy(_right).multiplyScalar(sDir);
    const sh = ctx.physics.raycast(pivot, _tmp, Math.abs(shoulder) + 0.25, 'camera');
    const sLen = sh ? Math.max(0, sh.t - 0.25) : Math.abs(shoulder);
    _shoulder.addScaledVector(_tmp, sLen);

    // boom
    _back.copy(_fwd).negate();
    const hit = ctx.physics.raycast(_shoulder, _back, dist + 0.3, 'camera');
    const allowed = hit ? Math.max(0.3, hit.t - 0.28) : dist;
    // pull in instantly (never clip through walls), ease back out slowly
    if (snapNext || allowed < curDist) curDist = allowed;
    else curDist = damp(curDist, allowed, 4.5, dt);
    position.copy(_shoulder).addScaledVector(_back, curDist);
    const floor = ctx.physics.heightAt(position.x, position.z) + 0.3;
    if (position.y < floor) position.y = floor;

    fovCur = snapNext ? fov : damp(fovCur, fov, 10, dt);
    playerPos.copy(position);
    _look.copy(position).add(_fwd);
    _m.lookAt(position, _look, UP);
    playerQuat.setFromRotationMatrix(_m);
    playerFov = fovCur;
    snapNext = false;
  }

  function shotPose(s: CameraShot, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    outPos.copy(s.position);
    _look.copy(s.lookAt);
    if (s.follow) {
      s.follow.updateWorldMatrix(true, false);
      s.follow.localToWorld(outPos);
      s.follow.localToWorld(_look);
    }
    _m.lookAt(outPos, _look, UP);
    outQuat.setFromRotationMatrix(_m);
  }

  function updateAimTarget() {
    // start the ray near the player so nothing between camera and player is picked
    const origin = playerPos;
    const fwd = forward;
    _tmp.copy(subject.position).sub(origin);
    const skip = Math.max(0, _tmp.dot(fwd) - 0.3);
    _shoulder.copy(origin).addScaledVector(fwd, skip);
    aimOrigin.copy(_shoulder);
    let best = AIM_RANGE;
    aimCombatant = null;
    aimZone = null;
    const self = subject.self;
    for (const c of ctx.combatants.all()) {
      if (!c.alive || c === self || !hostile(self.team, c.team)) continue;
      const h = c.raycast(_shoulder, fwd, best);
      if (h && h.t < best) {
        best = h.t;
        aimCombatant = c;
        aimZone = h.zone;
      }
    }
    const w = ctx.physics.raycast(_shoulder, fwd, best, 'arrows');
    if (w && w.t < best) {
      best = w.t;
      aimCombatant = null;
      aimZone = null;
    }
    aimTarget.copy(_shoulder).addScaledVector(fwd, best);
  }

  const rig: CameraRigExt = {
    yaw: 0,
    pitch: -0.12,
    params: { ...DEFAULT_CAMERA },
    get shot() {
      return shot;
    },
    set shot(s: CameraShot | null) {
      shot = s;
    },
    forward,
    aimTarget,
    position,
    get aimCombatant() {
      return aimCombatant;
    },
    get aimZone() {
      return aimZone;
    },
    aimOrigin,
    get aimBlend() {
      return aimBlend;
    },
    shake(amount, duration) {
      trauma = clamp(Math.max(trauma, amount), 0, 1);
      traumaDecay = Math.max(traumaDecay * 0.5, trauma / Math.max(0.05, duration));
    },
    recoil(rad) {
      recoilP += rad;
    },
    punch(deg) {
      punchDeg += deg;
    },
    snap() {
      snapNext = true;
    },
    update(dtReal) {
      const dt = Math.min(Math.max(dtReal, 0), 0.1);
      computePlayerPose(dt);
      updateAimTarget();

      // scripted shot transitions
      if (shot !== lastShot) {
        const c = cam();
        fromPos.copy(c.position);
        fromQuat.copy(c.quaternion);
        fromFov = c.fov;
        blendDur = shot ? shot.blend ?? 0.6 : lastShot?.blend ?? 0.6;
        blendT = blendDur <= 0 ? 1 : 0;
        lastShot = shot;
        shotActive = !!shot;
      }
      blendT = Math.min(1, blendT + dt / Math.max(1e-3, blendDur));
      const e = easeInOutSine(blendT);
      const c = cam();
      if (shotActive && shot) {
        shotPose(shot, _tmp, _q);
        c.position.copy(fromPos).lerp(_tmp, e);
        c.quaternion.copy(fromQuat).slerp(_q, e);
        c.fov = lerp(fromFov, shot.fov ?? fromFov, e);
      } else if (blendT < 1) {
        c.position.copy(fromPos).lerp(playerPos, e);
        c.quaternion.copy(fromQuat).slerp(playerQuat, e);
        c.fov = lerp(fromFov, playerFov, e);
      } else {
        c.position.copy(playerPos);
        c.quaternion.copy(playerQuat);
        c.fov = playerFov;
      }

      // shake (trauma²)
      shakeT += dt;
      if (trauma > 0) {
        const s = trauma * trauma;
        const t = shakeT * 22;
        c.position.x += wobble(t, 1.3) * 0.16 * s;
        c.position.y += wobble(t, 7.1) * 0.12 * s;
        c.position.z += wobble(t, 3.7) * 0.16 * s;
        _shake.set(wobble(t, 11.2) * 0.035 * s, wobble(t, 5.5) * 0.035 * s, wobble(t, 2.2) * 0.05 * s);
        _qs.setFromEuler(_shake);
        c.quaternion.multiply(_qs);
        trauma = Math.max(0, trauma - traumaDecay * dt);
      }
      c.updateProjectionMatrix();
      c.updateMatrixWorld();

      // listener follows the camera; shadow frustum follows the action
      _tmp.set(0, 0, -1).applyQuaternion(c.quaternion);
      ctx.audio.setListener(c.position, _tmp);
      if (shotActive && shot) {
        ctx.engine.shadowFocus.copy(shot.lookAt);
        if (shot.follow) shot.follow.localToWorld(ctx.engine.shadowFocus);
      } else ctx.engine.shadowFocus.copy(subject.position);
    },
  };
  return rig;
}
