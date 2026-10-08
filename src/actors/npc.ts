/**
 * Shared NPC machinery for enemies and allies: kinematic motor, steering (seek/arrive,
 * separation, obstacle avoidance against physics), the telegraphed melee attack timeline,
 * procedural animation input, LOD/shadow management and voice throttling.
 */
import * as THREE from 'three';
import type { AnimInput, AttackAnim, Combatant, GameContext, Humanoid, SfxName, SpecialPose } from '../core/types';
import { clamp, damp, dampAngle, wrapAngle, yawOf } from '../core/math';
import { BaseCombatant, type CombatantOpts } from './combatant';
import { createMotor, settle, stepMotor, type Motor } from '../physics/motor';

export const STRIKE_TIME = 0.14;
export const RECOVER_TIME = 0.38;

export type AttackPhase = 'none' | 'windup' | 'strike' | 'recover';

export interface AttackState {
  phase: AttackPhase;
  kind: AttackAnim;
  t: number;
  windup: number;
  target: Combatant | null;
  didHit: boolean;
}

// ── melee slots: at most N attackers per target at once ──────────────────────
let slotMap = new WeakMap<Combatant, Set<Combatant>>();
export function requestSlot(target: Combatant, who: Combatant, max: number): boolean {
  let s = slotMap.get(target);
  if (!s) slotMap.set(target, (s = new Set()));
  if (s.has(who)) return true;
  for (const c of s) if (!c.alive) s.delete(c);
  if (s.size >= max) return false;
  s.add(who);
  return true;
}
export function releaseSlot(target: Combatant | null, who: Combatant): void {
  if (target) slotMap.get(target)?.delete(who);
}
export function slotCount(target: Combatant): number {
  return slotMap.get(target)?.size ?? 0;
}
/** other melee attackers currently holding a slot on target */
export function slotHolders(target: Combatant): Iterable<Combatant> {
  return slotMap.get(target) ?? [];
}

// ── attack tokens: stagger swings on one target so they can be read and dodged ─
// The persistent player outlives every level, and the game clock (ctx.time.t) restarts at 0 on each
// load, so the token state is (a) cleared by resetCombatQueues() when a level unloads, (b) robust to
// the clock going backwards, and (c) tracks its holders by identity so a dead or disposed attacker
// can never keep a token forever.
let tokenMap = new WeakMap<Combatant, { last: number; holders: Set<Combatant> }>();
/** may `who` start a wind-up on target now? `gap` = min seconds between wind-up starts */
export function requestAttackToken(target: Combatant, now: number, gap: number, maxActive: number, who: Combatant): boolean {
  let t = tokenMap.get(target);
  if (!t) tokenMap.set(target, (t = { last: -Infinity, holders: new Set() }));
  if (now < t.last) t.last = -Infinity; // the clock restarted (new attempt)
  for (const c of t.holders) if (!c.alive) t.holders.delete(c);
  if (t.holders.has(who)) return true;
  if (now - t.last < gap || t.holders.size >= maxActive) return false;
  t.last = now;
  t.holders.add(who);
  return true;
}
export function releaseAttackToken(target: Combatant | null, who: Combatant): void {
  if (target) tokenMap.get(target)?.holders.delete(who);
}
/** attackers currently holding a wind-up token on target */
export function attackTokenCount(target: Combatant): number {
  return tokenMap.get(target)?.holders.size ?? 0;
}
/** forget every melee slot and attack token (level unload: the player persists, the clock restarts) */
export function resetCombatQueues(): void {
  slotMap = new WeakMap();
  tokenMap = new WeakMap();
}

// ── voice throttle: max 3 vocalisations per 0.6 s per game ─────────────────────
const voice = new WeakMap<object, { t: number; n: number }>();
export function vocal(ctx: GameContext, name: SfxName, pos: THREE.Vector3, volume = 0.8, pitch = 1): void {
  let v = voice.get(ctx);
  if (!v) voice.set(ctx, (v = { t: 0, n: 0 }));
  const now = ctx.time.real;
  if (now - v.t > 0.6) {
    v.t = now;
    v.n = 0;
  }
  if (v.n >= 3) return;
  v.n++;
  ctx.audio.play(name, { pos, volume, pitch: pitch * (0.92 + Math.random() * 0.16) });
}

const _v = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _pdir = new THREE.Vector3();

export interface NpcOpts extends CombatantOpts {
  humanoid: Humanoid;
  speed: number;
  facing?: number;
}

export abstract class NpcBase extends BaseCombatant {
  protected readonly ctx: GameContext;
  protected readonly motor: Motor;
  readonly anim: AnimInput = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null, specialT: 0, lookAt: null };
  protected readonly attackAnim: { kind: AttackAnim; t: number } = { kind: 'slash', t: 0 };
  readonly atk: AttackState = { phase: 'none', kind: 'slash', t: 0, windup: 0.5, target: null, didHit: false };
  facing: number;
  speedMax: number;
  aiEnabled = true;
  moveTarget: THREE.Vector3 | null = null;

  /** steering goal (world), speed toward it and arrival radius */
  protected readonly goal = new THREE.Vector3();
  protected hasGoal = false;
  protected goalSpeed = 0;
  protected arriveRadius = 0.4;
  /** face this point when not moving fast (or always while attacking) */
  protected readonly faceAt = new THREE.Vector3();
  protected hasFaceAt = false;
  protected special: SpecialPose = null;
  protected specialT = 0;
  protected specialTimer = 0;
  protected readonly lookPoint = new THREE.Vector3();
  protected noGravity = false;
  protected accel = 16;
  protected turnRate = 9;
  protected stagger = 0;
  /** steer around obstacles (off while approaching a ladder/wall to climb) */
  protected avoid = true;
  /** seconds since the motor last pushed us off a wall */
  protected wallT = 99;

  private avoidT = 0;
  private avoidHold = 0;
  private avoidSide = 0;
  /** wall following: on while an obstacle blocks the way to the goal */
  private avoiding = false;
  private avoidTime = 0;
  /** horizontal normal of the obstacle being skirted */
  private avoidNx = 0;
  private avoidNz = 0;
  private lod: 0 | 1 | 2 = 0;
  private lodT = Math.random() * 0.3;
  private shadows = true;
  private animSkip = 0;
  private behindCam = false;
  private animAcc = 0;
  private stepAcc = 0;

  constructor(ctx: GameContext, o: NpcOpts) {
    super(o);
    this.ctx = ctx;
    this.speedMax = o.speed;
    this.facing = o.facing ?? 0;
    this.object.rotation.y = this.facing;
    this.motor = createMotor(this.object.position, this.velocity, this.radius, this.height * 0.95);
  }

  get humanoid(): Humanoid {
    return this.body!;
  }

  protected place(pos: THREE.Vector3) {
    this.object.position.copy(pos);
    settle(this.ctx.physics, this.motor, 3);
  }

  // ── steering ───────────────────────────────────────────────────────────────
  protected setGoal(p: THREE.Vector3, speed: number, arrive = 0.4) {
    this.goal.copy(p);
    this.hasGoal = true;
    this.goalSpeed = speed;
    this.arriveRadius = arrive;
  }
  protected clearGoal() {
    this.hasGoal = false;
  }
  protected faceToward(p: THREE.Vector3 | null) {
    if (p) {
      this.faceAt.copy(p);
      this.hasFaceAt = true;
    } else this.hasFaceAt = false;
  }

  protected steer(dt: number) {
    const pos = this.position;
    const v = this.velocity;
    let tx = 0;
    let tz = 0;
    let want = 0;
    if (this.hasGoal && this.stagger <= 0 && this.atk.phase !== 'strike') {
      const dx = this.goal.x - pos.x;
      const dz = this.goal.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.arriveRadius) {
        want = Math.min(this.goalSpeed, (d - this.arriveRadius) * 3 + 0.4);
        tx = (dx / d) * want;
        tz = (dz / d) * want;
      }
    }
    if (this.atk.phase === 'windup' || this.atk.phase === 'recover') {
      tx *= 0.25;
      tz *= 0.25;
    }
    // separation from other living combatants
    let sx = 0;
    let sz = 0;
    for (const c of this.ctx.combatants.all()) {
      if (c === this || !c.alive) continue;
      const ddx = pos.x - c.position.x;
      const ddz = pos.z - c.position.z;
      if (Math.abs(ddx) > 4 || Math.abs(ddz) > 4) continue;
      if (Math.abs(pos.y - c.position.y) > 2) continue;
      const minD = (this.radius + c.radius) * 1.3 + 0.25;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        sx += ((this.id % 7) - 3) * 0.1;
        sz += ((this.id % 5) - 2) * 0.1;
        continue;
      }
      const push = (minD - d) / minD;
      sx += (ddx / d) * push;
      sz += (ddz / d) * push;
    }
    const sepW = Math.max(2.5, this.goalSpeed * 1.2);
    tx += sx * sepW;
    tz += sz * sepW;

    // obstacle avoidance: wall following. Blocked by something close ahead -> pick the side whose
    // tangent is nearer the goal and slide along the obstacle at full speed, keeping that side
    // until a long probe straight at the goal is clear (that is what carries an NPC to the end of a
    // long wall and around its corner); after 6 s without getting round, try the other side.
    this.avoidT -= dt;
    this.avoidHold -= dt;
    this.avoidTime += dt;
    if (this.avoidHold <= 0) this.avoiding = false;
    const tl = Math.hypot(tx, tz);
    if (tl > 0.6 && this.avoidT <= 0 && this.avoid) {
      this.avoidT = 0.12;
      _probe.set(pos.x, pos.y + Math.min(0.9, this.height * 0.45), pos.z);
      _pdir.set(tx / tl, 0, tz / tl);
      // an obstacle beyond the goal (the wall behind a cornered player) is not in the way
      const goalD = this.hasGoal ? Math.hypot(this.goal.x - pos.x, this.goal.z - pos.z) + this.radius : Infinity;
      const near = this.radius + 0.9 + tl * 0.15;
      const hit = this.ctx.physics.raycast(_probe, _pdir, Math.min(goalD, this.avoiding ? Math.max(near, 8) : near), 'all');
      if (hit && hit.normal.y < 0.6) {
        const nl = Math.hypot(hit.normal.x, hit.normal.z) || 1;
        const nx = hit.normal.x / nl;
        const nz = hit.normal.z / nl;
        if (!this.avoiding) {
          this.avoiding = true;
          this.avoidTime = 0;
          this.avoidSide = -nz * _pdir.x + nx * _pdir.z >= 0 ? 1 : -1;
        } else if (this.avoidTime > 6) {
          this.avoidTime = 0;
          this.avoidSide = -this.avoidSide;
        }
        this.avoidHold = 0.6;
        this.avoidNx = nx;
        this.avoidNz = nz;
      } else this.avoiding = false;
    }
    if (this.avoiding && tl > 0.3 && this.avoid) {
      // full speed along the obstacle (rotating the desired velocity by a fixed 70° lost most of
      // the speed into a long wall once the goal lay back along it: ~0.5 m/s along a 60 m wall)
      const sd = this.avoidSide;
      tx = -this.avoidNz * sd * tl;
      tz = this.avoidNx * sd * tl;
    }

    const acc = (this.motor.grounded ? this.accel : 3) * dt;
    let dvx = tx - v.x;
    let dvz = tz - v.z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > acc) {
      dvx *= acc / dl;
      dvz *= acc / dl;
    }
    v.x += dvx;
    v.z += dvz;
  }

  protected stepBody(dt: number) {
    const r = stepMotor(this.ctx.physics, this.motor, dt, this.noGravity);
    if (r.landed && r.landSpeed > 6) this.ctx.fx.dust(this.position, 3);
    this.wallT = r.hitWall ? 0 : this.wallT + dt;
    // facing
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.atk.phase === 'strike') {
      /* committed */
    } else if (this.hasFaceAt && (sp < this.speedMax * 0.6 || this.atk.phase !== 'none')) {
      const yaw = yawOf(this.faceAt.x - this.position.x, this.faceAt.z - this.position.z);
      this.facing = dampAngle(this.facing, yaw, this.atk.phase === 'windup' ? this.turnRate * 0.7 : this.turnRate, dt);
    } else if (sp > 0.4) {
      this.facing = dampAngle(this.facing, yawOf(this.velocity.x, this.velocity.z), this.turnRate, dt);
    }
    this.facing = wrapAngle(this.facing + this.motor.platformYaw);
    this.object.rotation.y = this.facing;
    if (this.position.y < this.ctx.physics.killY && this.alive) this.takeDamage({ amount: 1e6, type: 'fall', source: null });
    return r;
  }

  // ── attacks ────────────────────────────────────────────────────────────────
  protected startAttack(kind: AttackAnim, target: Combatant | null, windup: number) {
    this.atk.phase = 'windup';
    this.atk.kind = kind;
    this.atk.t = 0;
    this.atk.windup = windup;
    this.atk.target = target;
    this.atk.didHit = false;
    this.onWindup(kind);
  }
  protected cancelAttack() {
    if (this.atkToken) releaseAttackToken(this.atk.target, this);
    this.atkToken = false;
    this.atk.phase = 'none';
    this.atk.target = null;
  }
  /** set when the current attack holds a token on its target */
  protected atkToken = false;
  /** attack timeline; calls strike() once at the strike moment. Returns true when finished. */
  protected updateAttack(dt: number): boolean {
    const a = this.atk;
    if (a.phase === 'none') return true;
    a.t += dt;
    if (a.phase === 'windup') {
      if (a.target) this.faceToward(a.target.position);
      if (a.t >= a.windup) {
        a.phase = 'strike';
        a.t = 0;
      }
    } else if (a.phase === 'strike') {
      if (!a.didHit && a.t >= STRIKE_TIME * 0.5) {
        a.didHit = true;
        this.strike(a.kind, a.target);
      }
      if (a.t >= STRIKE_TIME) {
        a.phase = 'recover';
        a.t = 0;
      }
    } else if (a.phase === 'recover') {
      if (a.t >= RECOVER_TIME) {
        if (this.atkToken) releaseAttackToken(a.target, this);
        this.atkToken = false;
        a.phase = 'none';
        a.target = null;
        return true;
      }
    }
    return false;
  }
  /** normalised attack animation time: windup 0→0.4, strike 0.4→0.6, recover 0.6→1 */
  protected attackT(): number {
    const a = this.atk;
    if (a.phase === 'windup') return 0.4 * clamp(a.t / a.windup, 0, 1);
    if (a.phase === 'strike') return 0.4 + 0.2 * clamp(a.t / STRIKE_TIME, 0, 1);
    if (a.phase === 'recover') return 0.6 + 0.4 * clamp(a.t / RECOVER_TIME, 0, 1);
    return 0;
  }
  protected onWindup(_kind: AttackAnim): void {}
  protected abstract strike(kind: AttackAnim, target: Combatant | null): void;

  // ── animation & LOD ────────────────────────────────────────────────────────
  protected animateBody(dt: number, extra?: (a: AnimInput) => void) {
    const a = this.anim;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    a.speed = this.alive ? sp : 0;
    const cf = Math.cos(this.facing);
    const sf = Math.sin(this.facing);
    if (sp > 0.05) {
      a.moveDir!.x = (-this.velocity.x * cf + this.velocity.z * sf) / sp;
      a.moveDir!.z = (this.velocity.x * sf + this.velocity.z * cf) / sp;
    } else {
      a.moveDir!.x = 0;
      a.moveDir!.z = 1;
    }
    a.grounded = this.motor.grounded || this.noGravity;
    a.vy = this.velocity.y;
    if (this.atk.phase !== 'none' && this.alive) {
      this.attackAnim.kind = this.atk.kind;
      this.attackAnim.t = this.attackT();
      a.attack = this.attackAnim;
    } else a.attack = null;
    this.hitReact = Math.max(0, this.hitReact - dt * 4);
    a.hit = this.hitReact;
    a.dead = this.deadProgress;
    a.deathVariant = this.deathVariant;
    a.special = this.alive ? (this.stagger > 0 ? 'stagger' : this.special) : null;
    a.specialT = this.specialT;
    if (extra) extra(a);
    // distant / off-screen NPCs animate at a reduced rate (accumulated dt keeps them in sync)
    this.animAcc += dt;
    let every = this.lod === 2 ? 3 : this.lod === 1 ? 2 : 1;
    if (this.behindCam) every = Math.max(every, 4);
    if (this.alive && this.atk.phase === 'none' && every > 1 && ++this.animSkip % every !== 0) return;
    this.humanoid.animate(this.animAcc, a);
    this.animAcc = 0;
    this.afterAnimate();
  }

  protected updateLod(dt: number) {
    this.lodT -= dt;
    if (this.lodT > 0) return;
    this.lodT = 0.3;
    const cam = this.ctx.engine.camera;
    const d = cam.position.distanceTo(this.position);
    // behind the camera (with a margin for wide FOVs and big bodies)?
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _pdir.copy(this.position).sub(cam.position);
    this.behindCam = d > 6 + this.height && _pdir.dot(_v) < -0.15 * d;
    const lod: 0 | 1 | 2 = d < 18 * Math.max(1, this.height / 2) ? 0 : d < 45 * Math.max(1, this.height / 2) ? 1 : 2;
    if (lod !== this.lod) {
      this.lod = lod;
      this.humanoid.setLod(lod);
    }
    const sh = d < 35 * Math.max(1, this.height / 2.5) && this.deathTime < this.corpseTime;
    if (sh !== this.shadows) {
      this.shadows = sh;
      this.humanoid.setCastShadow(sh);
    }
  }

  /** footstep-ish callback at stride cadence */
  protected stride(dt: number, len: number, cb: () => void) {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this.motor.grounded || sp < 0.6) return;
    this.stepAcc += sp * dt;
    if (this.stepAcc >= len) {
      this.stepAcc -= len;
      cb();
    }
  }

  protected playSpecial(pose: SpecialPose, seconds: number) {
    this.special = pose;
    this.specialTimer = seconds;
    this.specialT = 0;
  }
  protected updateSpecial(dt: number) {
    if (this.specialTimer > 0) {
      this.specialTimer -= dt;
      this.specialT = Math.min(1, this.specialT + dt / 1.2);
      if (this.specialTimer <= 0) {
        this.special = null;
        this.specialT = 0;
      }
    }
  }

  /** horizontal distance to a combatant's surface */
  protected gap(c: Combatant): number {
    return Math.hypot(c.position.x - this.position.x, c.position.z - this.position.z) - c.radius - this.radius;
  }
  /** angle between facing and the direction to p */
  protected angleTo(p: THREE.Vector3): number {
    return Math.abs(wrapAngle(yawOf(p.x - this.position.x, p.z - this.position.z) - this.facing));
  }
  protected losTo(c: Combatant): boolean {
    this.aimPoint(_probe);
    c.aimPoint(_v);
    _pdir.copy(_v).sub(_probe);
    const d = _pdir.length();
    if (d < 1e-3) return true;
    _pdir.divideScalar(d);
    return this.ctx.physics.raycast(_probe, _pdir, d - 0.3, 'arrows') === null;
  }
  protected dampSpeed(dt: number) {
    this.velocity.x = damp(this.velocity.x, 0, 6, dt);
    this.velocity.z = damp(this.velocity.z, 0, 6, dt);
  }
}
