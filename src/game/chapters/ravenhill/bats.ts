/**
 * Ravenhill bats: the hostile giant bats (Combatants that circle, screech and swoop at Legolas, and
 * tumble out of the sky when shot) and the mount bat whose talons carry Legolas up to the tower
 * (a PlayerMover with pose 'hang' that follows a flight spline).
 */
import * as THREE from 'three';
import type { Combatant, DamageInfo, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { BaseCombatant, ZONE_MULT } from '../../../actors/combatant';
import { createGundabadBat, type GundabadBat } from '../../../creatures/bat';
import { clamp, damp, dampAngle, smoothstep, wrapAngle, yawOf } from '../../../core/math';
import type { Path } from '../../../world';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();

/** the 'hang' pose puts the hands this far above the feet */
export const HANG_DROP = 2.02;

/** add hit zones for a giant bat (body, head, both wings) */
function batZones(c: BaseCombatant, bat: GundabadBat, s: number): void {
  const b = bat.creature.rig.byName;
  c.addZoneSphere(b.body, 0.42 * s, 'body', ZONE_MULT.body, new THREE.Vector3(0, 0, -0.05 * s));
  c.addZoneSphere(b.hips, 0.3 * s, 'body', ZONE_MULT.body);
  c.addZoneSphere(b.head, 0.2 * s, 'head', ZONE_MULT.head, new THREE.Vector3(0, 0, 0.1 * s));
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    c.addZoneCapsule(b[`hum_${side}`], b[`arm_${side}`], 0.12 * s, 'limb');
    c.addZoneCapsule(b[`arm_${side}`], b[`hand_${side}`], 0.1 * s, 'limb');
    // the membrane: a fat capsule along the middle finger, and the leading finger
    c.addZoneCapsule(b[`f3_${side}`], b[`f3_${side}`], 0.42 * s, 'limb', ZONE_MULT.limb, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 0.95 * s, -0.12 * s, -1.0 * s));
    c.addZoneCapsule(b[`f2_${side}`], b[`f2_${side}`], 0.18 * s, 'limb', ZONE_MULT.limb, new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 1.15 * s, -0.03 * s, -0.2 * s));
  }
}

export interface GiantBatOpts {
  /** orbit centre (world); can be moved every frame */
  center: THREE.Vector3;
  radius: number;
  /** altitude above the centre */
  altitude?: number;
  seed: number;
  scale?: number;
  hp?: number;
  damage?: number;
  /** seconds between swoops [min, max] */
  swoopEvery?: [number, number];
  /** only swoop when the player is within this distance */
  swoopRange?: number;
}

/** a hostile Gundabad bat */
export class GiantBat extends BaseCombatant {
  readonly bat: GundabadBat;
  readonly center = new THREE.Vector3();
  private readonly s: number;
  private t: number;
  private angle: number;
  private dir: number;
  private mode: 'circle' | 'swoop' | 'climb' = 'circle';
  private modeT = 0;
  private swoopT: number;
  private readonly aim = new THREE.Vector3();
  private readonly climbTo = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private bank = 0;
  private flash = 0;
  private hitAnim = 0;
  private fallVy = 0;
  private landed = false;
  private readonly o: Required<Omit<GiantBatOpts, 'center' | 'seed' | 'scale' | 'hp'>>;

  constructor(private readonly level: LevelAPI, o: GiantBatOpts) {
    const scale = o.scale ?? 0.8;
    super({ team: 'enemy', name: 'Gundabad bat', maxHp: o.hp ?? 60, radius: 1.2 * scale, height: 2.6 * scale, bloodKind: 'dark' });
    this.s = 1.5 * scale;
    this.bat = createGundabadBat(o.seed % 3, scale);
    this.object.add(this.bat.object);
    this.center.copy(o.center);
    this.o = { radius: o.radius, altitude: o.altitude ?? 0, damage: o.damage ?? 10, swoopEvery: o.swoopEvery ?? [5, 9], swoopRange: o.swoopRange ?? 40 };
    const r = Math.sin(o.seed * 12.9898) * 43758.5453;
    const rnd = r - Math.floor(r);
    this.t = rnd * 10;
    this.angle = rnd * Math.PI * 2;
    this.dir = o.seed % 2 === 0 ? 1 : -1;
    this.swoopT = this.o.swoopEvery[0] + rnd * (this.o.swoopEvery[1] - this.o.swoopEvery[0]);
    this.object.position.set(this.center.x + Math.cos(this.angle) * o.radius, this.center.y + this.o.altitude, this.center.z + Math.sin(this.angle) * o.radius);
    batZones(this, this.bat, this.s);
    this.aimBone = this.bat.creature.rig.byName.body;
    this.corpseTime = 2.5;
    this.countsForRivalry = false;
    this.object.name = 'enemy:gundabad_bat';
    this.bat.pose('fly', this.t);
  }

  protected onDamaged(d: DamageInfo): void {
    this.flash = 1;
    this.hitAnim = 0.35;
    if (this.mode === 'swoop') this.startClimb(); // a hit breaks the dive
    this.level.ctx.audio.play('bat_screech', { pos: this.position, volume: 0.8, pitch: 1.15 });
    void d;
  }

  protected onDied(): void {
    this.level.ctx.audio.play('bat_screech', { pos: this.position, volume: 1, pitch: 0.75 });
    this.fallVy = Math.min(0, this.velocity.y);
  }

  private startClimb(): void {
    this.mode = 'climb';
    this.modeT = 0;
    _d.copy(this.velocity).setY(0);
    if (_d.lengthSq() < 1) _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _d.normalize();
    this.climbTo.copy(this.position).addScaledVector(_d, 18).setY(Math.max(this.position.y + 10, this.center.y + this.o.altitude));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const ctx = this.level.ctx;
    const player = ctx.player;
    this.t += dt;
    if (!this.alive) {
      // tumble out of the sky until it hits the ground, then lie there briefly
      if (!this.landed) {
        this.fallVy -= 18 * dt;
        this.velocity.x = damp(this.velocity.x, 0, 0.8, dt);
        this.velocity.z = damp(this.velocity.z, 0, 0.8, dt);
        this.object.position.addScaledVector(this.velocity, dt);
        this.object.position.y += this.fallVy * dt;
        const g = ctx.physics.ground(this.position.x, this.position.z, this.position.y + 0.5)?.y ?? ctx.physics.heightAt(this.position.x, this.position.z);
        if (this.position.y <= g + 0.3 || this.deathTime > 6) {
          this.landed = true;
          this.object.position.y = Math.max(this.position.y, g + 0.3);
          ctx.fx.dust(this.position, 10, 0xe8eef2);
        }
        this.object.rotation.z += dt * 4;
      }
      this.bat.pose('death', this.deathTime);
      this.updateDeath(dt);
      if (this.deathTime > this.corpseTime + 1.8) this.expired = true;
      this.afterAnimate();
      return;
    }
    const pos = this.position;
    const target = _v;
    let speed = 13;
    this.modeT += dt;
    if (this.mode === 'circle') {
      this.angle += (this.dir * speed * dt) / Math.max(8, this.o.radius);
      target.set(
        this.center.x + Math.cos(this.angle) * this.o.radius,
        this.center.y + this.o.altitude + Math.sin(this.t * 0.45) * 3,
        this.center.z + Math.sin(this.angle) * this.o.radius,
      );
      this.swoopT -= dt;
      if (this.swoopT <= 0 && player.alive && pos.distanceTo(player.position) < this.o.swoopRange) {
        this.mode = 'swoop';
        this.modeT = 0;
        this.aim.copy(player.position).addScaledVector(player.velocity, 0.7);
        this.aim.y += 1.3;
        ctx.audio.play('bat_screech', { pos, volume: 1, pitch: 0.9 + Math.random() * 0.2 });
      }
    } else if (this.mode === 'swoop') {
      speed = 19;
      // re-aim a little at the player during the first half of the dive (dodgeable late)
      if (this.modeT < 1.2) {
        _w.copy(player.position).addScaledVector(player.velocity, 0.4);
        _w.y += 1.3;
        this.aim.lerp(_w, Math.min(1, dt * 1.5));
      }
      target.copy(this.aim);
      _w.copy(player.position);
      _w.y += 1.1;
      if (pos.distanceTo(_w) < 2.4 * this.s && player.alive) {
        _d.copy(player.position).sub(pos).setY(0).normalize();
        player.takeDamage({ amount: this.o.damage, type: 'melee', source: this, point: _w, dir: _d, knockback: 2 });
        ctx.audio.play('bat_screech', { pos, volume: 1, pitch: 1.05 });
        this.startClimb();
      } else if (pos.distanceTo(this.aim) < 2.5 || this.modeT > 4) {
        this.startClimb();
      }
    } else {
      target.copy(this.climbTo);
      if (this.modeT > 2.4) {
        this.mode = 'circle';
        this.modeT = 0;
        this.swoopT = this.o.swoopEvery[0] + this.level.rng() * (this.o.swoopEvery[1] - this.o.swoopEvery[0]);
        this.angle = Math.atan2(pos.z - this.center.z, pos.x - this.center.x);
      }
    }
    // steer: velocity toward the carrot, capped, smooth
    _d.copy(target).sub(pos);
    const dist = _d.length();
    if (dist > 1e-3) _d.multiplyScalar(Math.min(speed, dist * 2.2) / dist);
    this.velocity.lerp(_d, 1 - Math.exp(-dt * (this.mode === 'swoop' ? 2.6 : 1.6)));
    // never fly into the ground
    const gy = ctx.physics.heightAt(pos.x, pos.z);
    if (pos.y < gy + 2.5) this.velocity.y = Math.max(this.velocity.y, (gy + 2.5 - pos.y) * 3);
    pos.addScaledVector(this.velocity, dt);
    // orientation from the flight: yaw along the velocity, bank into turns, pitch with the climb
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.5) {
      const want = yawOf(this.velocity.x, this.velocity.z);
      const turn = wrapAngle(want - this.yaw);
      this.yaw = dampAngle(this.yaw, want, 3, dt);
      this.bank = damp(this.bank, clamp(-turn * 1.4, -0.7, 0.7), 3, dt);
    }
    this.pitch = damp(this.pitch, clamp(-Math.atan2(this.velocity.y, Math.max(1, hs)) * 0.8, -0.6, 0.6), 4, dt);
    this.object.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    // animation
    this.hitAnim -= dt;
    const anim = this.hitAnim > 0 ? 'hit' : this.mode === 'swoop' ? 'swoop' : this.velocity.y < -3 ? 'glide' : 'fly';
    this.bat.pose(anim, this.t);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      this.bat.creature.material.emissive.setRGB(0.5 * this.flash, 0.12 * this.flash, 0.05 * this.flash);
    }
    this.afterAnimate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.bat.dispose();
  }
}

/** the mount: a giant bat that flies a spline, carrying Legolas by its talons */
export class MountBat {
  readonly bat: GundabadBat;
  readonly object: THREE.Object3D;
  private t = 0;
  private yaw = 0;
  private pitch = 0;
  private bank = 0;
  constructor(level: LevelAPI, seed = 7) {
    this.bat = createGundabadBat(seed, 1.05);
    this.object = this.bat.object;
    level.root.add(this.object);
  }
  /** place at p heading along dir (smoothed); pose with anim at the bat's clock */
  fly(p: THREE.Vector3, dir: THREE.Vector3, dt: number, anim: string): void {
    this.t += dt;
    const hs = Math.hypot(dir.x, dir.z);
    if (hs > 1e-3) {
      const want = yawOf(dir.x, dir.z);
      const turn = wrapAngle(want - this.yaw);
      this.yaw = dt > 0 ? dampAngle(this.yaw, want, 2.5, dt) : want;
      this.bank = damp(this.bank, clamp(-turn * 2.2, -0.45, 0.45), 2, dt);
    }
    this.pitch = damp(this.pitch, clamp(-Math.atan2(dir.y, Math.max(0.3, hs)) * 0.7, -0.45, 0.45), 3, dt);
    this.object.position.copy(p);
    this.object.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    this.bat.pose(anim, this.t);
    this.object.updateMatrixWorld(true);
  }
  get heading(): number {
    return this.yaw;
  }
}

export interface BatRide extends PlayerMover {
  /** metres travelled along the path */
  s: number;
  done: boolean;
}

/**
 * The bat ride mover: the mount bat follows `path` (its root positions), Legolas hangs from the
 * talons (pose 'hang'), steers a little (left/right and up/down), and can shoot. `onEnd` fires once
 * at the end of the path (the caller removes the mover there).
 */
export function batRide(level: LevelAPI, mount: MountBat, path: Path, cruise: number, onEnd: () => void): BatRide {
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const grip = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const leapFrom = new THREE.Vector3();
  let lat = 0;
  let up = 0;
  let t = 0;
  let first = true;
  const ride: BatRide = {
    s: 0,
    done: false,
    pose: 'hang',
    poseT: () => (t * 0.35) % 1,
    allowShoot: true,
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    lockCameraYaw: false,
    camera: { distance: 7.6, height: 1.0, shoulder: 0.3, fov: 66 },
    update(dt: number, player: PlayerAPI, input) {
      t += dt;
      // lift off gently, cruise, slow down over the release point
      const left = path.length - ride.s;
      const v = cruise * smoothstep(0, 3.2, t) * (0.45 + 0.55 * smoothstep(0, 26, left));
      ride.s = Math.min(path.length, ride.s + v * dt);
      path.at(ride.s, p);
      path.tangent(ride.s, tan);
      // steering (fades out at both ends so the pick-up and the drop stay on the marks)
      const room = smoothstep(0, 30, ride.s) * smoothstep(0, 30, left);
      lat = clamp(lat + input.moveX * 4.5 * dt, -5 * room, 5 * room);
      up = clamp(up + input.moveY * 3 * dt, -2.5 * room, 2.5 * room);
      // right of the travel direction = (-t.z, 0, t.x)
      const hl = Math.hypot(tan.x, tan.z) || 1;
      p.x += (-tan.z / hl) * lat;
      p.z += (tan.x / hl) * lat;
      p.y += up;
      mount.fly(p, tan, dt, 'carry');
      mount.bat.gripPoint(grip);
      prev.copy(player.position);
      if (first) {
        first = false;
        leapFrom.copy(player.position);
      }
      // the leap up to the talons: ease from where he stood onto the grip over the first 0.4 s
      const k = smoothstep(0, 0.4, t);
      player.position.set(grip.x, grip.y - HANG_DROP, grip.z);
      if (k < 1) player.position.lerpVectors(leapFrom, player.position, k);
      player.velocity.subVectors(player.position, prev).divideScalar(Math.max(dt, 1e-4));
      player.facing = mount.heading;
      if (!ride.done && ride.s >= path.length - 0.01) {
        ride.done = true;
        onEnd();
      }
    },
  };
  return ride;
}

/** the closest living hostile bat, for scripts */
export function livingBats(list: readonly GiantBat[]): number {
  let n = 0;
  for (const b of list) if (b.alive) n++;
  return n;
}

export type { Combatant };
