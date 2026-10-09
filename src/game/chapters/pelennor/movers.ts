/**
 * PlayerMovers for the oliphaunt climb. All of them live in the beast's moving frame (bones and the
 * howdah are re-read every step), so it can walk, sway, turn and thrash underneath Legolas.
 *
 *   climbMover      up the rope ladder on the left flank; left/right dodges the archers' arrows
 *   deckMover       free movement on the howdah deck (camera-relative), knives and bow
 *   pathMover       an on-rails run through bone-attached points (the run up the neck)
 *   neckStandMover  braced on the neck behind the skull, aiming down into it
 *   trunkSlideMover sliding down the trunk of the kneeling beast to the ground
 */
import * as THREE from 'three';
import type { InputState, PlayerAPI, PlayerMover } from '../../../core/types';
import { clamp, dampAngle, lerp, yawOf } from '../../../core/math';
import type { MumakActor } from './mumak_actor';

const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function yawOfObject(o: THREE.Object3D): number {
  o.getWorldQuaternion(_q);
  _e.setFromQuaternion(_q, 'YXZ');
  return _e.y;
}

function moveTo(player: PlayerAPI, target: THREE.Vector3, dt: number): void {
  player.velocity.subVectors(target, player.position).divideScalar(Math.max(dt, 1e-4));
  player.position.copy(target);
}

/** camera-relative wish direction (world XZ), returns magnitude */
function wish(player: PlayerAPI, input: InputState, out: THREE.Vector3): number {
  const cy = Math.cos(player.camera.yaw);
  const sy = Math.sin(player.camera.yaw);
  out.set(sy * input.moveY - cy * input.moveX, 0, cy * input.moveY + sy * input.moveX);
  const m = Math.min(1, out.length());
  if (m > 1e-4) out.normalize();
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `auto` (the smoke-test bot, which cannot steer a mover): climb at full speed and sway left/right
 * the way a player dodging the archers would.
 */
export function climbMover(m: MumakActor, onTop: () => void, auto: () => boolean = () => false): PlayerMover & { s: number } {
  const ladder = m.model.ladder!;
  let lateral = 0;
  let done = false;
  let t = 0;
  const mover: PlayerMover & { s: number } = {
    s: 0.2,
    pose: 'climb',
    poseT: () => (mover.s * 0.75) % 1,
    allowShoot: false,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    camera: { distance: 4.6, height: 0.9, fov: 64, shoulder: 0.5 },
    update(dt, player, input) {
      // a hesitant player still inches upward; pushing forward climbs fast
      t += dt;
      const bot = auto();
      const up = bot ? 1 : Math.max(0.42, input.moveY);
      mover.s = Math.min(ladder.length, mover.s + up * 2.3 * dt);
      // the dodge: a swing along the flank, wide and quick enough to slip an arrow already loosed
      const side = bot ? clamp(Math.sin(t * 1.7) * 1.6, -1, 1) : input.moveX;
      lateral = clamp(lateral - side * 3.0 * dt, -1.15, 1.15);
      ladder.pointAt(mover.s, _w);
      // hang just outside the ladder, slid along the flank by the dodge
      const yaw = m.yaw;
      _a.set(Math.cos(yaw), 0, -Math.sin(yaw)); // the beast's left (+X) in world
      _b.set(Math.sin(yaw), 0, Math.cos(yaw)); // its forward
      _w.addScaledVector(_a, 0.42).addScaledVector(_b, lateral);
      _w.y -= 0.15;
      moveTo(player, _w, dt);
      player.facing = yaw - Math.PI / 2;
      if (!done && mover.s >= ladder.length - 0.05) {
        done = true;
        onTop();
      }
    },
  };
  return mover;
}

/** deck-local position of the player (shared with the chapter for prompts) */
export interface DeckState {
  local: THREE.Vector3;
}

export function deckMover(m: MumakActor, state: DeckState): PlayerMover {
  const h = m.model.howdah!;
  let localYaw = -Math.PI / 2;
  return {
    pose: null,
    allowShoot: true,
    allowMelee: true,
    allowJump: false,
    allowDash: false,
    camera: { distance: 3.6, height: 1.5, fov: 66 },
    update(dt, player, input) {
      const frameYaw = yawOfObject(h.object);
      const mag = wish(player, input, _w);
      const speed = 3.6 * mag;
      // world wish → deck-local (yaw only)
      const c = Math.cos(-frameYaw);
      const s = Math.sin(-frameYaw);
      const lx = _w.x * c + _w.z * s;
      const lz = -_w.x * s + _w.z * c;
      const L = state.local;
      L.x = clamp(L.x + lx * speed * dt, -h.half[0], h.half[0]);
      L.z = clamp(L.z + lz * speed * dt, -h.half[1], h.half[1]);
      L.y = h.deckY;
      // keep a little room around the crew
      for (const cr of m.crew) {
        if (!cr.alive || !cr.attached || cr.role === 'driver') continue;
        const dx = L.x - cr.local.x;
        const dz = L.z - cr.local.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 1e-4) {
          L.x = cr.local.x + (dx / d) * 0.75;
          L.z = cr.local.z + (dz / d) * 0.75;
        }
      }
      // facing: aim where the camera looks when shooting or striking, else where we walk
      if (player.aiming || player.drawCharge > 0 || input.melee || input.drawHeld) {
        localYaw = player.camera.yaw - frameYaw;
        if (input.melee) {
          // turn to the nearest foe within knife reach
          let best = 3.2;
          for (const cr of m.crew) {
            if (!cr.alive || !cr.attached) continue;
            const d = cr.object.position.distanceTo(player.position);
            if (d < best) {
              best = d;
              localYaw = yawOf(cr.object.position.x - player.position.x, cr.object.position.z - player.position.z) - frameYaw;
            }
          }
        }
      } else if (mag > 0.1) localYaw = dampAngle(localYaw, yawOf(lx, lz), 10, dt);
      _l.copy(L);
      h.object.updateWorldMatrix(true, false);
      h.object.localToWorld(_l);
      moveTo(player, _l, dt);
      // velocity for the animation: our own walking only (the beast's motion is the frame's)
      player.velocity.set(_w.x * speed, 0, _w.z * speed);
      player.facing = frameYaw + localYaw;
    },
  };
}

/** a point attached to a bone: model-space position relative to the bone's rest head */
export interface BonePoint {
  bone: THREE.Object3D;
  /** offset from the bone's joint (model axes at rest) */
  off: THREE.Vector3;
  /** extra world-up lift */
  lift?: number;
}

function bonePointWorld(p: BonePoint, out: THREE.Vector3): THREE.Vector3 {
  out.copy(p.off);
  p.bone.updateWorldMatrix(true, false);
  p.bone.localToWorld(out);
  if (p.lift) out.y += p.lift;
  return out;
}

/** on rails through bone points at `speed` (m/s, forward input speeds up); pose optional */
export function pathMover(points: BonePoint[], speed: number, onEnd: () => void, o: { pose?: PlayerMover['pose']; accel?: number; cam?: PlayerMover['camera'] } = {}): PlayerMover {
  let s = 0;
  let v = speed;
  let done = false;
  const pts = points.map(() => new THREE.Vector3());
  return {
    pose: o.pose ?? null,
    allowShoot: false,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    camera: o.cam ?? { distance: 4.2, height: 1.6, fov: 68 },
    lockCameraYaw: true,
    update(dt, player, input) {
      for (let i = 0; i < points.length; i++) bonePointWorld(points[i], pts[i]);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
      v = o.accel ? Math.min(speed * 2.4, v + o.accel * dt) : speed * (1 + Math.max(0, input.moveY) * 0.5);
      s = Math.min(total, s + v * dt);
      let rem = s;
      let k = 1;
      for (; k < pts.length - 1; k++) {
        const l = pts[k].distanceTo(pts[k - 1]);
        if (rem <= l) break;
        rem -= l;
      }
      const l = Math.max(1e-4, pts[k].distanceTo(pts[k - 1]));
      _w.copy(pts[k - 1]).lerp(pts[k], clamp(rem / l, 0, 1));
      _a.subVectors(pts[k], pts[k - 1]);
      moveTo(player, _w, dt);
      if (_a.x * _a.x + _a.z * _a.z > 1e-4) player.facing = dampAngle(player.facing, yawOf(_a.x, _a.z), 12, dt);
      if (!done && s >= total - 0.02) {
        done = true;
        onEnd();
      }
    },
  };
}

/** braced on the neck behind the skull: small side steps, the bow free */
export function neckStandMover(m: MumakActor, point: BonePoint): PlayerMover {
  let side = 0;
  return {
    pose: null,
    allowShoot: true,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    camera: { distance: 3.4, height: 1.2, shoulder: 0.65, fov: 66 },
    update(dt, player, input) {
      side = clamp(side - input.moveX * 1.2 * dt, -0.6, 0.6);
      bonePointWorld(point, _w);
      _a.set(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
      _w.addScaledVector(_a, side);
      moveTo(player, _w, dt);
      player.velocity.set(0, 0, 0);
      player.facing = dampAngle(player.facing, player.camera.yaw, 10, dt);
    },
  };
}

/** slide from the neck down over the brow and along the trunk lying on the ground */
export function trunkSlideMover(m: MumakActor, ground: (x: number, z: number) => number, onEnd: () => void): PlayerMover {
  const b = m.model.bones;
  const P = (bone: THREE.Object3D, x: number, y: number, z: number, lift = 0): BonePoint => ({ bone, off: new THREE.Vector3(x, y, z), lift });
  // offsets relative to each bone's rest joint (see mumakRig)
  const pts: BonePoint[] = [
    P(b.neck, 0, 1.9, 0.2), // on the neck (0, 14.1, 6.6)
    P(b.head, 0, 3.05, 0.6), // the crown between the domes
    P(b.head, 0, 1.9, 2.6), // over the brow
    P(b.trunk1, 0, 0, 1.45, 0.1), // the front of the trunk is its top once it lies on the ground
    P(b.trunk2, 0, 0, 1.15, 0.1),
    P(b.trunk3, 0, 0, 0.95, 0.1),
    P(b.trunk4, 0, 0, 0.78, 0.1),
    P(b.trunk5, 0, 0, 0.62, 0.1),
    P(b.trunk6, 0, 0, 0.5, 0.1),
  ];
  const world = pts.map(() => new THREE.Vector3());
  let s = 0;
  let v = 2.5;
  let done = false;
  let hop = -1;
  const hopFrom = new THREE.Vector3();
  const hopTo = new THREE.Vector3();
  return {
    pose: 'surf',
    poseT: () => clamp(s / 22, 0, 1),
    allowShoot: false,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    lockCameraYaw: true,
    camera: { distance: 5.2, height: 1.9, fov: 72 },
    update(dt, player) {
      if (hop >= 0) {
        // the last bound off the trunk tip onto the field
        hop = Math.min(1, hop + dt / 0.6);
        _w.lerpVectors(hopFrom, hopTo, hop);
        _w.y = lerp(hopFrom.y, hopTo.y, hop) + Math.sin(hop * Math.PI) * 1.4;
        moveTo(player, _w, dt);
        if (hop >= 1 && !done) {
          done = true;
          onEnd();
        }
        return;
      }
      for (let i = 0; i < pts.length; i++) bonePointWorld(pts[i], world[i]);
      let total = 0;
      for (let i = 1; i < world.length; i++) total += world[i].distanceTo(world[i - 1]);
      v = Math.min(13, v + 6.5 * dt);
      s = Math.min(total, s + v * dt);
      let rem = s;
      let k = 1;
      for (; k < world.length - 1; k++) {
        const l = world[k].distanceTo(world[k - 1]);
        if (rem <= l) break;
        rem -= l;
      }
      const l = Math.max(1e-4, world[k].distanceTo(world[k - 1]));
      _w.copy(world[k - 1]).lerp(world[k], clamp(rem / l, 0, 1));
      _a.subVectors(world[k], world[k - 1]);
      moveTo(player, _w, dt);
      player.facing = dampAngle(player.facing, yawOf(_a.x, _a.z), 14, dt);
      if (s >= total - 0.02) {
        hop = 0;
        hopFrom.copy(player.position);
        _a.y = 0;
        _a.normalize();
        hopTo.copy(player.position).addScaledVector(_a, 4.5);
        hopTo.y = ground(hopTo.x, hopTo.z);
      }
    },
  };
}
