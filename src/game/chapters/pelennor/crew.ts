/**
 * The howdah crew: Haradrim archers and spearmen standing on the moving war tower, and the driver
 * astride the mûmak's neck. Custom combatants (a humanoid in a moving frame), because the deck is
 * the beast's back: they live in the frame's LOCAL space, shoot down at Legolas while he closes in
 * and climbs, draw blades when he boards, and topple off when they die.
 */
import * as THREE from 'three';
import type { AnimInput, AttackAnim, Combatant, DamageInfo, LevelAPI } from '../../../core/types';
import { BaseCombatant } from '../../../actors/combatant';
import { createHumanoid, type HumanoidExt } from '../../../creatures/humanoid';
import { ballisticDir, leadTarget, spreadDir, ARROW_GRAVITY } from '../../../combat/aim';
import { clamp, dampAngle, wrapAngle, yawOf } from '../../../core/math';
import { mulberry32 } from '../../../core/rng';

export type CrewRole = 'archer' | 'spear' | 'driver';

const _w = new THREE.Vector3();
const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export interface CrewHost {
  /** is the player standing on this crew's deck (melee range matters only then) */
  playerAboard(): boolean;
  /** crew are alert (shoot) */
  alert(): boolean;
  /** ground height for corpses that fall off */
  groundAt(x: number, z: number): number;
}

export class CrewMember extends BaseCombatant {
  readonly humanoid: HumanoidExt;
  readonly role: CrewRole;
  /** position in the frame's local space */
  readonly local = new THREE.Vector3();
  /** facing in the frame (yaw relative to the frame's forward) */
  yawLocal = 0;
  /** deck half extents for walking (archers and spearmen) */
  half: [number, number] = [2.4, 3.1];
  deckY = 0;
  attached = true;
  private readonly anim: AnimInput = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null, specialT: 0, lookAt: null };
  private readonly atkAnim: { kind: AttackAnim; t: number } = { kind: 'slash', t: 0 };
  private readonly rnd: () => number;
  private shootT: number;
  private drawT = -1;
  private atkT = -1;
  private atkHit = false;
  private atkCd = 1;
  private bladesOut = false;
  private readonly fallVel = new THREE.Vector3();
  private falling = false;
  private landed = false;
  private lodT = 0;
  private readonly look = new THREE.Vector3();
  private moveSpeed = 0;

  constructor(
    private readonly level: LevelAPI,
    private readonly frame: THREE.Object3D,
    private readonly host: CrewHost,
    role: CrewRole,
    local: THREE.Vector3,
    seed: number,
  ) {
    const humanoid = createHumanoid({ kind: 'haradrim', seed, weapon: role === 'archer' ? 'orc_bow' : 'spear', helmet: true });
    super({ team: 'enemy', name: role === 'driver' ? 'Mûmak driver' : 'Haradrim', maxHp: role === 'driver' ? 60 : 70, humanoid, bloodKind: 'red' });
    this.humanoid = humanoid;
    this.role = role;
    this.local.copy(local);
    this.rnd = mulberry32(seed * 977 + 13);
    this.shootT = 1.5 + this.rnd() * 2.5;
    this.buildHumanoidZones(humanoid);
    this.corpseTime = 8;
    this.targetable = false;
    this.yawLocal = role === 'driver' ? 0 : Math.PI * (this.rnd() - 0.5);
    this.anim.deathVariant = seed % 4;
    if (role === 'driver') {
      this.anim.special = 'ride';
    }
    this.syncToFrame();
  }

  protected filterDamage(d: DamageInfo): number {
    return d.amount;
  }

  protected onDied(killer: Combatant | null, d: DamageInfo | null): void {
    void killer;
    // the driver always goes over the side; deck crew topple off half the time (and when knocked)
    const off = this.role === 'driver' || this.rnd() < 0.5 || (d?.knockback ?? 0) > 3;
    if (off && this.attached) this.detach(d?.dir ?? null);
    this.level.ctx.audio.play('orc_die', { pos: this.object.position, volume: 0.9, pitch: 1.25 });
  }

  /** leave the frame and fall (ropes cut / killed) */
  detach(dir: THREE.Vector3 | null): void {
    if (!this.attached) return;
    this.attached = false;
    this.falling = true;
    this.frame.updateWorldMatrix(true, false);
    // outward from the frame centre unless a hit direction says otherwise
    this.frame.getWorldPosition(_o);
    _d.copy(this.object.position).sub(_o).setY(0);
    if (dir && dir.lengthSq() > 0.01) _d.lerp(_t.copy(dir).setY(0).normalize().multiplyScalar(2), 0.6);
    if (_d.lengthSq() < 1e-4) _d.set(1, 0, 0);
    _d.normalize();
    this.fallVel.set(_d.x * 3.2, 2.5, _d.z * 3.2);
  }

  private syncToFrame(): void {
    this.frame.updateWorldMatrix(true, false);
    _o.copy(this.local);
    this.frame.localToWorld(_o);
    this.object.position.copy(_o);
    this.frame.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    this.object.rotation.set(0, _e.y + this.yawLocal, 0);
  }

  private frameYaw(): number {
    this.frame.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    return _e.y;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const ctx = this.level.ctx;
    const player = ctx.player;
    this.updateLod(dt);
    if (!this.alive) {
      if (this.attached) this.syncToFrame();
      else if (this.falling) this.fall(dt);
      this.anim.attack = null;
      this.anim.aim = 0;
      this.anim.draw = 0;
      this.anim.special = null;
      this.anim.dead = Math.min(1, this.deathTime / 1.1);
      this.anim.grounded = this.attached || this.landed;
      this.anim.speed = 0;
      this.humanoid.animate(dt, this.anim);
      this.afterAnimate();
      this.updateDeath(dt);
      return;
    }
    if (!this.attached) {
      this.fall(dt);
      this.humanoid.animate(dt, this.anim);
      this.afterAnimate();
      return;
    }
    const aboard = this.host.playerAboard();
    const alert = this.host.alert();
    // ── where is the player, in the frame? ──
    this.frame.updateWorldMatrix(true, false);
    _t.copy(player.position);
    this.frame.worldToLocal(_t);
    const dx = _t.x - this.local.x;
    const dz = _t.z - this.local.z;
    const dLocal = Math.hypot(dx, dz);
    const dyLocal = _t.y - this.local.y;
    const close = aboard && dLocal < 7 && Math.abs(dyLocal) < 2.5;
    const wantYaw = yawOf(dx, dz);
    this.moveSpeed = 0;

    if (this.role === 'driver') {
      // astride the neck, goading the beast; stabs at anyone close
      this.yawLocal = dampAngle(this.yawLocal, close && dLocal < 4.5 ? wantYaw : 0, 3, dt);
      if (close && dLocal < 3.4) this.melee(dt, dLocal, dx, dz, 'thrust', 2.9);
      else this.tickAttack(dt, dLocal, dx, dz, 2.9);
      this.anim.special = this.atkT >= 0 ? null : 'ride';
    } else if (close) {
      // he is on our deck: blades out, close in
      if (!this.bladesOut && this.role === 'archer') {
        this.bladesOut = true;
        this.humanoid.setWeapon('hand_l', 'none');
        this.humanoid.setWeapon('hand_r', 'scimitar');
      }
      this.drawT = -1;
      this.yawLocal = dampAngle(this.yawLocal, wantYaw, 8, dt);
      const reach = this.role === 'spear' ? 2.4 : 1.7;
      if (dLocal > reach && this.atkT < 0) {
        const sp = Math.min(2.2, (dLocal - reach) * 3);
        this.local.x += (dx / dLocal) * sp * dt;
        this.local.z += (dz / dLocal) * sp * dt;
        this.local.x = clamp(this.local.x, -this.half[0], this.half[0]);
        this.local.z = clamp(this.local.z, -this.half[1], this.half[1]);
        this.moveSpeed = sp;
      }
      this.melee(dt, dLocal, dx, dz, this.role === 'spear' ? 'thrust' : this.rnd() < 0.5 ? 'slash' : 'backslash', reach + 0.6);
    } else if (this.role === 'archer' && alert && !this.bladesOut) {
      this.yawLocal = dampAngle(this.yawLocal, wantYaw, 4, dt);
      this.shoot(dt);
    } else {
      // spearmen brace at the parapet, watching
      this.yawLocal = dampAngle(this.yawLocal, alert ? wantYaw : this.yawLocal, 2, dt);
      this.tickAttack(dt, dLocal, dx, dz, 2.6);
    }
    // keep crew apart (local space)
    this.syncToFrame();
    // ── animate ──
    const a = this.anim;
    a.speed = this.moveSpeed;
    a.grounded = true;
    a.hit = (this.hitReact = Math.max(0, this.hitReact - dt * 4));
    a.dead = 0;
    if (this.atkT >= 0) {
      this.atkAnim.t = clamp(this.atkT, 0, 1);
      a.attack = this.atkAnim;
    } else a.attack = null;
    if (this.drawT >= 0 && this.role === 'archer') {
      a.aim = 1;
      a.draw = clamp(this.drawT / 1.0, 0, 1);
      player.aimPoint(this.look);
      a.aimPitch = Math.atan2(this.look.y - (this.object.position.y + 1.5), Math.hypot(this.look.x - this.object.position.x, this.look.z - this.object.position.z));
    } else {
      a.aim = alert && this.role === 'archer' && !this.bladesOut ? 0.6 : 0;
      a.draw = 0;
    }
    if (alert) {
      player.aimPoint(this.look);
      a.lookAt = this.look;
    } else a.lookAt = null;
    this.humanoid.animate(dt, a);
    this.afterAnimate();
  }

  private shoot(dt: number): void {
    const ctx = this.level.ctx;
    const player = ctx.player;
    if (!player.alive) return;
    const dist = player.position.distanceTo(this.object.position);
    if (dist > 75) {
      this.drawT = -1;
      return;
    }
    if (this.drawT < 0) {
      this.shootT -= dt;
      if (this.shootT <= 0) {
        this.drawT = 0;
        ctx.audio.play('bow_draw', { pos: this.object.position, volume: 0.4, pitch: 0.85 });
      }
      return;
    }
    this.drawT += dt;
    if (this.drawT < 1.0) return;
    this.drawT = -1;
    this.shootT = 2.6 + this.rnd() * 1.6;
    this.aimPoint(_o);
    _o.y += 0.25;
    player.aimPoint(_t);
    const speed = 36;
    leadTarget(_o, _t, player.velocity, speed, _w, 1.2);
    ballisticDir(_o, _w, speed, ARROW_GRAVITY, _d);
    const spread = THREE.MathUtils.degToRad(1.4 + dist * 0.02);
    spreadDir(_d, spread, this.rnd(), this.rnd(), _d);
    ctx.projectiles.fire({ origin: _o.clone(), dir: _d.clone(), speed, damage: 9, team: 'enemy', owner: this, style: 'orc' });
    ctx.audio.play('bow_release', { pos: this.object.position, volume: 0.6, pitch: 0.9 });
  }

  private melee(dt: number, d: number, dx: number, dz: number, kind: AttackAnim, reach: number): void {
    this.atkCd -= dt;
    if (this.atkT < 0 && this.atkCd <= 0 && d < reach) {
      this.atkT = 0;
      this.atkHit = false;
      this.atkAnim.kind = kind;
      this.level.ctx.audio.play('orc_grunt', { pos: this.object.position, volume: 0.6, pitch: 1.3 });
    }
    this.tickAttack(dt, d, dx, dz, reach);
  }

  private tickAttack(dt: number, d: number, dx: number, dz: number, reach: number): void {
    if (this.atkT < 0) return;
    // windup 0..0.4 (0.55 s), strike at 0.5, recover to 1 (≈1.3 s total)
    this.atkT += dt / 1.3;
    if (!this.atkHit && this.atkT >= 0.48) {
      this.atkHit = true;
      const player = this.level.ctx.player;
      const facing = Math.abs(wrapAngle(yawOf(dx, dz) - this.yawLocal)) < 1.0;
      if (d < reach && facing && player.alive) {
        _d.set(dx, 0, dz).normalize();
        player.takeDamage({ amount: 11, type: 'melee', source: this, dir: _d.clone(), knockback: 2 });
        this.level.ctx.audio.play('sword_swing', { pos: this.object.position, volume: 0.7 });
      }
    }
    if (this.atkT >= 1) {
      this.atkT = -1;
      this.atkCd = 1.1 + this.rnd() * 0.9;
    }
  }

  private fall(dt: number): void {
    if (this.landed) return;
    const p = this.object.position;
    this.fallVel.y -= 22 * dt;
    p.addScaledVector(this.fallVel, dt);
    this.object.rotation.y += dt * 1.5;
    const g = this.host.groundAt(p.x, p.z);
    if (p.y <= g) {
      p.y = g;
      this.landed = true;
      this.falling = false;
      const ctx = this.level.ctx;
      ctx.fx.dust(p, 6, 0x8a7a60);
      ctx.audio.play('land', { pos: p, volume: 0.9, pitch: 0.7 });
      if (this.alive) this.kill(this.lastDamage?.source ?? null);
    }
    this.anim.grounded = false;
    this.anim.vy = this.fallVel.y;
    this.anim.special = null;
  }

  private updateLod(dt: number): void {
    this.lodT -= dt;
    if (this.lodT > 0) return;
    this.lodT = 0.3;
    const cam = this.level.ctx.engine.camera;
    const d = cam.position.distanceTo(this.object.position);
    const lod: 0 | 1 | 2 = d < 20 ? 0 : d < 50 ? 1 : 2;
    if (lod !== this.humanoid.lod) this.humanoid.setLod(lod);
    this.humanoid.setCastShadow(d < 45 && this.deathTime < this.corpseTime);
  }
}
