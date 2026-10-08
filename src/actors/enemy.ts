/**
 * Enemies: every EnemyArchetype with a stats table, behaviours (charge, hold, archer, guard,
 * flank, climb), steering with separation + obstacle avoidance, melee slots around the target
 * (max 3 on the player; the rest circle and taunt), telegraphed attacks (0.4–0.7 s wind-up),
 * archers that lead their shots, stagger, death variants, difficulty scaling, voices, dark
 * blood, LOD + shadow culling beyond 35 m. The troll is a slow brute with sweep/slam/stomp,
 * a head weak point (×3) and lots of HP.
 */
import * as THREE from 'three';
import type {
  AttackAnim,
  BloodKind,
  Combatant,
  DamageInfo,
  Difficulty,
  Enemy,
  EnemyArchetype,
  EnemyBehavior,
  EnemySpec,
  GameContext,
  HitZone,
  HumanoidKind,
  SfxName,
  SpecialPose,
  WeaponKind,
} from '../core/types';
import { clamp, dirFromYaw, wrapAngle, yawOf } from '../core/math';
import { Rng, hashSeed } from '../core/rng';
import { makeHumanoid } from './humanoids';
import { NpcBase, releaseSlot, requestAttackToken, requestSlot, slotHolders, vocal } from './npc';
import { hostile } from './combatant';
import { ARROW_GRAVITY, ballisticDir, leadTarget, spreadDir } from '../combat/aim';

export interface ArchetypeDef {
  kind: HumanoidKind;
  hp: number;
  damage: number;
  speed: number;
  weapon: WeaponKind;
  offhand?: WeaponKind;
  attacks: AttackAnim[];
  /** wind-up seconds (telegraph) */
  windup: number;
  reach: number;
  behavior: EnemyBehavior;
  scale: number;
  girth: number;
  blood: BloodKind;
  voice: { grunt: SfxName; die: SfxName; roar: SfxName; pitch: number };
  /** 0 = staggers easily, 1 = never (except weak point) */
  poise: number;
  /** seconds between attacks [min, max] at normal difficulty */
  cooldown: [number, number];
  ranged?: { speed: number; interval: [number, number]; style: 'orc' | 'uruk' | 'bolt'; draw: number };
  headZone?: HitZone;
  headMult?: number;
  bodyMult?: number;
  armored?: boolean;
}

const ORC_VOICE = { grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', pitch: 1 } as const;
const URUK_VOICE = { grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', pitch: 0.82 } as const;
const MAN_VOICE = { grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', pitch: 1.28 } as const;

export const ARCHETYPES: Record<EnemyArchetype, ArchetypeDef> = {
  orc: { kind: 'orc', hp: 60, damage: 12, speed: 4.6, weapon: 'scimitar', attacks: ['slash', 'backslash', 'overhead'], windup: 0.5, reach: 1.9, behavior: 'charge', scale: 1, girth: 1, blood: 'dark', voice: ORC_VOICE, poise: 0, cooldown: [1.1, 2.0] },
  goblin: { kind: 'goblin', hp: 38, damage: 8, speed: 5.4, weapon: 'scimitar', attacks: ['slash', 'thrust'], windup: 0.42, reach: 1.6, behavior: 'charge', scale: 1, girth: 0.9, blood: 'dark', voice: { grunt: 'goblin_screech', die: 'orc_die', roar: 'goblin_screech', pitch: 1.3 }, poise: 0, cooldown: [0.9, 1.6] },
  gundabad: { kind: 'gundabad', hp: 95, damage: 17, speed: 4.3, weapon: 'cleaver', attacks: ['overhead', 'slash'], windup: 0.6, reach: 2.0, behavior: 'charge', scale: 1, girth: 1.15, blood: 'dark', voice: { ...ORC_VOICE, pitch: 0.8 }, poise: 0.3, cooldown: [1.3, 2.2] },
  uruk: { kind: 'uruk', hp: 115, damage: 18, speed: 4.9, weapon: 'sword', attacks: ['slash', 'overhead', 'thrust'], windup: 0.55, reach: 2.1, behavior: 'charge', scale: 1, girth: 1.1, blood: 'black', voice: URUK_VOICE, poise: 0.3, cooldown: [1.2, 2.0] },
  uruk_archer: { kind: 'uruk', hp: 85, damage: 14, speed: 4.6, weapon: 'uruk_bow', attacks: ['punch'], windup: 0.45, reach: 1.7, behavior: 'archer', scale: 1, girth: 1.05, blood: 'black', voice: URUK_VOICE, poise: 0.1, cooldown: [1.4, 2.2], ranged: { speed: 38, interval: [2.4, 3.6], style: 'uruk', draw: 0.95 } },
  uruk_pike: { kind: 'uruk', hp: 115, damage: 20, speed: 4.2, weapon: 'pike', attacks: ['thrust'], windup: 0.6, reach: 3.2, behavior: 'hold', scale: 1, girth: 1.1, blood: 'black', voice: URUK_VOICE, poise: 0.4, cooldown: [1.4, 2.4] },
  berserker: { kind: 'berserker', hp: 170, damage: 28, speed: 5.8, weapon: 'sword', attacks: ['overhead', 'slash', 'backslash'], windup: 0.45, reach: 2.2, behavior: 'charge', scale: 1, girth: 1.15, blood: 'black', voice: { ...URUK_VOICE, pitch: 0.75 }, poise: 0.6, cooldown: [0.8, 1.5] },
  orc_archer: { kind: 'orc', hp: 45, damage: 10, speed: 4.6, weapon: 'orc_bow', attacks: ['punch'], windup: 0.45, reach: 1.6, behavior: 'archer', scale: 1, girth: 1, blood: 'dark', voice: ORC_VOICE, poise: 0, cooldown: [1.3, 2.2], ranged: { speed: 34, interval: [2.6, 4.0], style: 'orc', draw: 1.05 } },
  easterling: { kind: 'easterling', hp: 100, damage: 16, speed: 4.4, weapon: 'sword', offhand: 'shield', attacks: ['slash', 'thrust'], windup: 0.55, reach: 2.0, behavior: 'charge', scale: 1, girth: 1, blood: 'red', voice: MAN_VOICE, poise: 0.35, cooldown: [1.2, 2.0], armored: true },
  haradrim: { kind: 'haradrim', hp: 85, damage: 15, speed: 4.8, weapon: 'scimitar', attacks: ['slash', 'thrust', 'backslash'], windup: 0.5, reach: 2.0, behavior: 'charge', scale: 1, girth: 1, blood: 'red', voice: MAN_VOICE, poise: 0.1, cooldown: [1.1, 1.9] },
  troll: { kind: 'troll', hp: 900, damage: 40, speed: 3.0, weapon: 'club', attacks: ['sweep', 'slam', 'stomp'], windup: 0.7, reach: 4.4, behavior: 'charge', scale: 1, girth: 1.5, blood: 'dark', voice: { grunt: 'troll_roar', die: 'troll_roar', roar: 'troll_roar', pitch: 1 }, poise: 1, cooldown: [1.4, 2.4], headZone: 'weakpoint', headMult: 3, bodyMult: 0.8 },
};

export const DIFFICULTY: Record<Difficulty, { hp: number; dmg: number; cooldown: number; spread: number; windup: number; slots: number; speed: number; tokenGap: number; concurrent: number }> = {
  easy: { hp: 0.75, dmg: 0.6, cooldown: 1.4, spread: 1.6, windup: 1.15, slots: 2, speed: 0.92, tokenGap: 1.1, concurrent: 1 },
  normal: { hp: 1, dmg: 1, cooldown: 1, spread: 1, windup: 1, slots: 3, speed: 1, tokenGap: 0.65, concurrent: 2 },
  hard: { hp: 1.3, dmg: 1.4, cooldown: 0.75, spread: 0.65, windup: 0.9, slots: 3, speed: 1.08, tokenGap: 0.4, concurrent: 2 },
};

const ARCHER_MIN = 9;
const ARCHER_MAX = 26;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();

type EState = 'idle' | 'advance' | 'circle' | 'engage' | 'shoot' | 'climb' | 'return';

class EnemyImpl extends NpcBase implements Enemy {
  readonly spec: EnemySpec;
  behavior: EnemyBehavior;
  readonly def: ArchetypeDef;
  private readonly diff: (typeof DIFFICULTY)['normal'];
  private readonly rng: Rng;
  private readonly home = new THREE.Vector3();
  private target: Combatant | null = null;
  private targetT = 0;
  private state: EState = 'idle';
  private cooldown = 0.6;
  private hasSlot = false;
  private slotTime = 0;
  private slotRest = 0;
  private circleAngle = 0;
  private circleDir = 1;
  private tauntT = 2;
  private shootT = 0;
  private drawT = -1;
  private readonly aimAt = new THREE.Vector3();
  private strafeT = 0;
  private strafeDir = 1;
  private flankSide = 1;
  private flankDone = false;
  private climbPhase = 0;
  private damageMul: number;
  private aggroRoared = false;
  private hpRoar = 0.75;
  private lastAttacker: Combatant | null = null;
  private lastAttackedT = -99;

  constructor(ctx: GameContext, spec: EnemySpec, pos: THREE.Vector3, facing = 0) {
    const def = ARCHETYPES[spec.archetype] ?? ARCHETYPES.orc;
    const diff = DIFFICULTY[ctx.settings?.difficulty ?? 'normal'] ?? DIFFICULTY.normal;
    const seed = spec.seed ?? hashSeed(spec.archetype, pos.x.toFixed(2), pos.z.toFixed(2));
    const humanoid = makeHumanoid({ kind: def.kind, seed, weapon: spec.weapon ?? def.weapon, offhand: def.offhand, scale: spec.scale ?? def.scale });
    const hp = Math.round((spec.hp ?? def.hp) * diff.hp);
    super(ctx, {
      team: 'enemy',
      name: spec.name ?? spec.archetype,
      maxHp: hp,
      humanoid,
      height: humanoid.height,
      radius: Math.max(0.3, humanoid.height * 0.18 * def.girth),
      bloodKind: def.blood,
      isBoss: spec.boss,
      countsForRivalry: spec.countsForRivalry ?? true,
      speed: (spec.speed ?? def.speed) * diff.speed,
      facing,
    });
    this.spec = spec;
    this.def = def;
    this.diff = diff;
    this.behavior = spec.behavior ?? def.behavior;
    this.rng = new Rng(seed);
    this.damageMul = diff.dmg;
    this.buildHumanoidZones(humanoid, { girth: def.girth, headZone: def.headZone, headMult: def.headMult, bodyMult: def.bodyMult });
    // a shield in the off hand blocks arrows (armour zone on its face: arrows glance off)
    const shield = humanoid.weaponObject('hand_l');
    if (shield && shield.userData.kind === 'shield') {
      shield.updateWorldMatrix(true, true);
      const size = new THREE.Box3().setFromObject(shield).getSize(new THREE.Vector3());
      const r = Math.max(0.25, Math.min(0.6, Math.max(size.x, size.y, size.z) * 0.5));
      this.addZoneDisc(shield, r, new THREE.Vector3(1, 0, 0), 'armor');
    }
    if (def.kind === 'troll') {
      this.aimBone = humanoid.bones.head; // weak point
      this.turnRate = 3.2;
      this.accel = 8;
      this.corpseTime = 10;
    }
    this.deathVariant = this.rng.int(0, 3);
    this.circleDir = this.rng.chance(0.5) ? 1 : -1;
    this.flankSide = this.rng.chance(0.5) ? 1 : -1;
    this.cooldown = this.rng.range(0.4, 1.4);
    this.shootT = this.rng.range(0.8, 2.2);
    this.tauntT = this.rng.range(2, 6);
    this.flashColor = def.blood === 'red' ? 0xff5040 : 0xffa070;
    this.place(pos);
    this.home.copy(this.position);
    this.object.name = `enemy:${this.name}`;
    ctx.engine.levelRoot.add(this.object);
    ctx.combatants.add(this); // idempotent: spawnEnemy/addCombatant may add it again
  }

  // ── damage ─────────────────────────────────────────────────────────────────
  protected onDamaged(d: DamageInfo, amount: number): void {
    const ctx = this.ctx;
    // remember who hurt us (allies fighting us get fought back)
    if (d.source && d.source.alive && hostile(this.team, d.source.team)) {
      this.lastAttacker = d.source;
      this.lastAttackedT = ctx.time.t;
      if (!this.target || (this.spec.target !== 'player' && this.gap(d.source) < this.gap(this.target))) this.setTarget(d.source);
    }
    if (d.knockback && d.dir) {
      _v.copy(d.dir).setY(0);
      if (_v.lengthSq() > 1e-6) {
        const k = d.knockback * (1 - this.def.poise * 0.8);
        _v.normalize().multiplyScalar(k);
        this.velocity.x += _v.x;
        this.velocity.z += _v.z;
      }
    }
    const weak = d.zone === 'weakpoint' || d.zone === 'head';
    const heavy = amount >= this.maxHp * 0.35;
    const canStagger = this.def.poise < 1 ? (d.stagger || heavy) && this.rng.float() > this.def.poise * 0.6 : weak && amount >= 60;
    if (this.alive && canStagger) {
      this.stagger = this.def.kind === 'troll' ? 1.1 : 0.65;
      this.cancelAttack();
      this.drawT = -1;
      if (this.def.kind === 'troll') vocal(ctx, 'troll_hit', this.position, 1);
    }
    if (this.alive) {
      if (this.def.kind === 'troll') {
        if (this.hp / this.maxHp < this.hpRoar) {
          this.hpRoar -= 0.25;
          this.roar();
        } else if (weak) vocal(ctx, 'troll_hit', this.position, 0.9);
      } else if (this.rng.chance(0.45)) vocal(ctx, this.def.voice.grunt, this.position, 0.7, this.def.voice.pitch * 1.1);
    }
  }

  protected onDied(killer: Combatant | null, d: DamageInfo | null): void {
    const ctx = this.ctx;
    releaseSlot(this.target, this);
    this.hasSlot = false;
    this.cancelAttack();
    vocal(ctx, this.def.voice.die, this.position, this.def.kind === 'troll' ? 1 : 0.85, this.def.voice.pitch * (this.def.kind === 'troll' ? 0.7 : 1));
    // fall away from the killing blow
    if (d?.dir) {
      const yawHit = yawOf(d.dir.x, d.dir.z);
      const rel = Math.abs(wrapAngle(yawHit - this.facing));
      this.deathVariant = rel < Math.PI / 2 ? 1 + (this.rng.chance(0.5) ? 2 : 0) : this.rng.chance(0.5) ? 0 : 2;
      _v.copy(d.dir).setY(0);
      if (_v.lengthSq() > 1e-6) {
        _v.normalize().multiplyScalar(this.def.kind === 'troll' ? 0.5 : 1.5 + (d.knockback ?? 0) * 0.4);
        this.velocity.x = _v.x;
        this.velocity.z = _v.z;
      }
    }
    this.aimAt.copy(this.position).setY(this.position.y + this.height * 0.6);
    ctx.fx.blood(this.aimAt, d?.dir ?? _v.set(0, 1, 0), this.bloodKind, this.def.kind === 'troll' ? 3 : 1.2);
    if (this.def.kind === 'troll') ctx.fx.dust(this.position, 20, 0x6a5a44);
  }

  // ── targeting ──────────────────────────────────────────────────────────────
  private setTarget(t: Combatant | null) {
    if (t === this.target) return;
    if (this.hasSlot) releaseSlot(this.target, this);
    this.hasSlot = false;
    this.target = t;
    if (t && !this.aggroRoared) {
      this.aggroRoared = true;
      if (this.def.kind === 'troll') this.roar();
    }
    if (t) this.circleAngle = yawOf(this.position.x - t.position.x, this.position.z - t.position.z);
  }

  private pickTarget() {
    const ctx = this.ctx;
    const want = this.spec.target ?? 'player';
    const player = ctx.player;
    if (want === 'player') {
      // fight back against an ally that is carving into us while the player is far away
      const la = this.lastAttacker;
      if (la && la.alive && la.team === 'ally' && ctx.time.t - this.lastAttackedT < 4 && this.gap(la) < 4 && (!player || !player.alive || this.gap(player) > 7)) {
        this.setTarget(la);
        return;
      }
      this.setTarget(player && player.alive ? player : this.nearestFoe(30));
      return;
    }
    if (want === 'nearest') {
      this.setTarget(this.nearestFoe(80));
      return;
    }
    // marching to a point: engage foes that come close
    const near = this.nearestFoe(7);
    this.setTarget(near);
  }

  private nearestFoe(maxDist: number): Combatant | null {
    let best: Combatant | null = null;
    let bd = maxDist;
    for (const c of this.ctx.combatants.all()) {
      if (!c.alive || !hostile(this.team, c.team) || c.team === 'neutral') continue;
      const d = this.gap(c) + (c.team === 'player' ? -1.5 : 0);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private maxSlots(t: Combatant): number {
    return t.team === 'player' ? this.diff.slots : 2;
  }

  private roar() {
    this.playSpecial('roar', this.def.kind === 'troll' ? 1.6 : 1.1);
    vocal(this.ctx, this.def.voice.roar, this.position, 1, this.def.voice.pitch);
    if (this.def.kind === 'troll') this.ctx.player?.camera?.shake(0.25, 0.8);
  }

  // ── update ─────────────────────────────────────────────────────────────────
  update(dt: number): void {
    const ctx = this.ctx;
    if (dt <= 0) return;
    this.updateLod(dt);
    if (!this.alive) {
      this.dampSpeed(dt);
      this.velocity.y = Math.min(this.velocity.y, 0);
      this.clearGoal();
      this.stepBody(dt);
      this.animateBody(dt);
      this.updateDeath(dt);
      return;
    }
    this.stagger = Math.max(0, this.stagger - dt);
    this.cooldown -= dt;
    this.slotRest -= dt;
    this.updateSpecial(dt);
    this.noGravity = false;

    if (!this.aiEnabled) {
      this.clearGoal();
      if (this.moveTarget) this.setGoal(this.moveTarget, this.speedMax * 0.6, 0.5);
      // a scripted attack (attack()) plays out even with the AI frozen; anything else is dropped
      if (this.scriptedAtk && this.atk.phase !== 'none') {
        if (this.updateAttack(dt)) this.scriptedAtk = false;
      } else {
        this.scriptedAtk = false;
        this.cancelAttack();
      }
      this.steer(dt);
      this.stepBody(dt);
      this.animateBody(dt);
      return;
    }

    this.targetT -= dt;
    if (this.targetT <= 0 || (this.target && !this.target.alive)) {
      this.targetT = 0.4 + this.rng.float() * 0.2;
      this.pickTarget();
    }

    const attacking = !this.updateAttack(dt);
    if (this.stagger > 0) {
      this.clearGoal();
    } else if (!attacking || this.atk.phase === 'recover') {
      this.think(dt);
    }
    if (this.def.ranged && this.drawT >= 0) this.updateShot(dt);

    this.steer(dt);
    this.stepBody(dt);
    if (this.def.kind === 'troll') {
      this.stride(dt, 2.6, () => {
        vocal(ctx, 'troll_step', this.position, 0.9);
        ctx.fx.dust(this.position, 4, 0x6a5a44);
        const d = ctx.player ? ctx.player.position.distanceTo(this.position) : 99;
        if (d < 14) ctx.player.camera.shake(0.18 * (1 - d / 14), 0.25);
      });
    }
    this.animateBody(dt, (a) => {
      if (this.drawT >= 0 && this.def.ranged) {
        a.aim = 1;
        a.draw = clamp(this.drawT / this.def.ranged.draw, 0, 1);
        _v.copy(this.aimAt).sub(this.position);
        a.aimPitch = Math.atan2(_v.y - this.height * 0.75, Math.hypot(_v.x, _v.z));
      } else {
        a.aim = 0;
        a.draw = 0;
      }
      if (this.state === 'climb') {
        a.special = 'climb';
        a.specialT = this.climbPhase;
      }
      if (this.target && this.target.alive && this.gap(this.target) < 15) {
        (this.target as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 }).headPoint?.(this.lookPoint) ?? this.target.aimPoint(this.lookPoint);
        a.lookAt = this.lookPoint;
      } else a.lookAt = null;
    });
  }

  /** behaviour decision (not while mid-attack) */
  private think(dt: number) {
    const t = this.target;
    const b = this.behavior;
    const march = this.spec.target instanceof THREE.Vector3 ? this.spec.target : null;
    if (b === 'climb' && this.moveTarget) {
      this.doClimb(dt);
      return;
    }
    if (this.moveTarget && b !== 'climb') {
      // scripted destination wins until reached, unless a foe is right here
      if (!t || this.gap(t) > 3) {
        this.state = 'advance';
        this.setGoal(this.moveTarget, this.speedMax, 0.6);
        this.faceToward(null);
        if (this.position.distanceTo(this.moveTarget) < 1) this.moveTarget = null;
        return;
      }
    }
    if (!t) {
      if (march) {
        this.state = 'advance';
        this.setGoal(march, this.speedMax * 0.85, 1.5);
        this.faceToward(null);
      } else if (b === 'guard' || b === 'hold') {
        this.state = 'return';
        this.setGoal(this.home, this.speedMax * 0.6, 0.6);
      } else {
        this.state = 'idle';
        this.clearGoal();
      }
      return;
    }
    if (this.def.ranged && b !== 'charge' && b !== 'flank') {
      this.thinkArcher(dt, t, b === 'hold' || b === 'guard');
      return;
    }
    switch (b) {
      case 'hold':
        this.thinkHold(dt, t, march ?? this.home, 2);
        return;
      case 'guard': {
        const fromHome = t.position.distanceTo(this.home);
        if (fromHome > 12) {
          this.releaseMySlot();
          this.state = 'return';
          this.setGoal(this.home, this.speedMax * 0.7, 0.6);
          this.faceToward(t.position);
          return;
        }
        this.thinkMelee(dt, t);
        return;
      }
      case 'flank':
        if (!this.flankDone) {
          // swing wide to the target's side, then go in
          const tf = (t as Combatant & { facing?: number }).facing ?? yawOf(this.position.x - t.position.x, this.position.z - t.position.z);
          const ang = tf + this.flankSide * 1.9;
          dirFromYaw(ang, _v).multiplyScalar(5).add(t.position);
          this.state = 'advance';
          this.setGoal(_v, this.speedMax, 1);
          this.faceToward(null);
          if (this.position.distanceTo(_v) < 2.5 || this.gap(t) < 2.5) this.flankDone = true;
          return;
        }
        this.thinkMelee(dt, t);
        return;
      default:
        this.thinkMelee(dt, t);
    }
  }

  private releaseMySlot() {
    if (this.hasSlot) releaseSlot(this.target, this);
    this.hasSlot = false;
  }

  private thinkMelee(dt: number, t: Combatant) {
    const gap = this.gap(t);
    const troll = this.def.kind === 'troll';
    const reach = this.def.reach * (this.spec.scale ?? 1);
    // slot management: max N attackers on the target; rotate after a while
    if (!troll) {
      if (this.hasSlot) {
        this.slotTime += dt;
        if (gap > 8 || (this.slotTime > 6 && this.atk.phase === 'none' && this.cooldown > 0.3)) {
          this.releaseMySlot();
          this.slotRest = 1.5;
        }
      } else if (gap < 9 && this.slotRest <= 0) {
        this.hasSlot = requestSlot(t, this, this.maxSlots(t));
        if (this.hasSlot) this.slotTime = 0;
      }
    }
    const engaged = troll || this.hasSlot;
    if (engaged) {
      this.state = 'engage';
      this.faceToward(t.position);
      const standoff = reach * 0.7 + t.radius + this.radius;
      if (troll) {
        if (gap > reach * 0.8) this.setGoal(t.position, gap > 6 ? this.speedMax : this.speedMax * 0.75, standoff);
        else {
          this.clearGoal();
          this.dampSpeed(dt);
        }
      } else {
        // surround: keep my bearing at least ~60° away from the other attackers on this target
        let ang = yawOf(this.position.x - t.position.x, this.position.z - t.position.z);
        for (const o of slotHolders(t)) {
          if (o === this || !o.alive) continue;
          const oa = yawOf(o.position.x - t.position.x, o.position.z - t.position.z);
          const d = wrapAngle(ang - oa);
          if (Math.abs(d) < 1.05) ang += Math.sign(d || this.circleDir) * (1.05 - Math.abs(d)) * 0.6;
        }
        dirFromYaw(ang, _v2).multiplyScalar(standoff).add(t.position);
        if (this.position.distanceTo(_v2) > 0.35 || gap > reach * 0.8) this.setGoal(_v2, gap > 6 ? this.speedMax : this.speedMax * 0.7, 0.25);
        else {
          this.clearGoal();
          this.dampSpeed(dt);
        }
      }
      if (this.cooldown <= 0 && gap <= reach + 0.2 && this.angleTo(t.position) < 0.9 && this.atk.phase === 'none') {
        // one wind-up at a time per target (troll ignores the queue)
        if (troll || requestAttackToken(t, this.ctx.time.t, this.diff.tokenGap, this.diff.concurrent)) {
          const kind = this.chooseAttack(gap, t);
          this.startAttack(kind, t, this.def.windup * this.diff.windup);
          this.atkToken = !troll;
          const [a, b] = this.def.cooldown;
          this.cooldown = this.rng.range(a, b) * this.diff.cooldown + this.def.windup;
        } else this.cooldown = this.rng.range(0.15, 0.4);
      }
      return;
    }
    // waiting for a slot: circle at a distance and taunt
    this.state = 'circle';
    const radius = 4.2 + (this.id % 3) * 0.7;
    if (gap > radius + 6) {
      this.setGoal(t.position, this.speedMax, radius);
    } else {
      this.circleAngle += this.circleDir * 0.35 * dt;
      dirFromYaw(this.circleAngle, _v).multiplyScalar(radius + t.radius).add(t.position);
      this.setGoal(_v, this.speedMax * 0.45, 0.5);
    }
    this.faceToward(t.position);
    this.tauntT -= dt;
    if (this.tauntT <= 0 && gap < radius + 3) {
      this.tauntT = this.rng.range(4, 9);
      this.playSpecial(this.rng.chance(0.5) ? 'roar' : 'cheer', 1.0);
      vocal(this.ctx, this.def.voice.roar, this.position, 0.7, this.def.voice.pitch);
    }
    if (this.rng.float() < dt * 0.25) this.circleDir *= -1;
  }

  private thinkHold(dt: number, t: Combatant, anchor: THREE.Vector3, leash: number) {
    const gap = this.gap(t);
    const reach = this.def.reach * (this.spec.scale ?? 1);
    this.faceToward(t.position);
    if (gap < reach + 2.5 && t.position.distanceTo(anchor) < reach + leash + 2) {
      // step in a little, but never far from the anchor
      this.state = 'engage';
      if (this.position.distanceTo(anchor) < leash && gap > reach * 0.8) this.setGoal(t.position, this.speedMax * 0.6, reach * 0.7 + t.radius);
      else this.setGoal(anchor, this.speedMax * 0.5, 0.4);
      if (this.cooldown <= 0 && gap <= reach + 0.2 && this.angleTo(t.position) < 0.8) {
        if (requestAttackToken(t, this.ctx.time.t, this.diff.tokenGap, this.diff.concurrent)) {
          this.startAttack(this.chooseAttack(gap, t), t, this.def.windup * this.diff.windup);
          this.atkToken = true;
          this.cooldown = this.rng.range(...this.def.cooldown) * this.diff.cooldown + this.def.windup;
        } else this.cooldown = this.rng.range(0.15, 0.4);
      }
    } else {
      this.state = 'idle';
      this.setGoal(anchor, this.speedMax * 0.5, 0.4);
    }
  }

  private thinkArcher(dt: number, t: Combatant, stationary: boolean) {
    const ctx = this.ctx;
    const d = this.position.distanceTo(t.position);
    const gap = this.gap(t);
    this.faceToward(t.position);
    if (gap < 1.8) {
      // bow-bash anyone who gets too close
      this.drawT = -1;
      this.state = 'engage';
      this.clearGoal();
      if (this.cooldown <= 0 && this.atk.phase === 'none') {
        this.startAttack('punch', t, this.def.windup * this.diff.windup);
        this.cooldown = this.rng.range(...this.def.cooldown) * this.diff.cooldown;
      }
      return;
    }
    if (this.drawT >= 0) {
      // drawing: stand still and track
      this.clearGoal();
      this.dampSpeed(dt);
      return;
    }
    this.state = 'shoot';
    if (stationary) {
      this.setGoal(this.home, this.speedMax * 0.5, 0.5);
    }
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = this.rng.range(1.5, 3);
      this.strafeDir = this.rng.chance(0.5) ? 1 : -1;
    }
    if (stationary) {
      /* hold position */
    } else if (d < ARCHER_MIN) {
      // back off
      _v.copy(this.position).sub(t.position).setY(0).normalize().multiplyScalar(4).add(this.position);
      this.setGoal(_v, this.speedMax * 0.7, 0.3);
    } else if (d > ARCHER_MAX) {
      this.setGoal(t.position, this.speedMax, ARCHER_MAX - 4);
    } else {
      // slow strafe
      const yaw = yawOf(t.position.x - this.position.x, t.position.z - this.position.z) + (Math.PI / 2) * this.strafeDir;
      dirFromYaw(yaw, _v).multiplyScalar(2).add(this.position);
      this.setGoal(_v, 1.2, 0.3);
    }
    this.shootT -= dt;
    if (this.shootT <= 0 && d < ARCHER_MAX + 8) {
      if (this.losTo(t)) {
        this.drawT = 0;
        this.atk.target = t;
        ctx.audio.play('bow_draw', { pos: this.position, volume: 0.45, pitch: 0.8 });
      } else {
        // no line of sight: move toward the target for a moment
        if (!stationary) this.setGoal(t.position, this.speedMax, 4);
        this.shootT = 0.6;
      }
    }
  }

  private updateShot(dt: number) {
    const r = this.def.ranged!;
    const t = this.target;
    if (!t || !t.alive || this.stagger > 0) {
      this.drawT = -1;
      this.shootT = this.rng.range(...r.interval);
      return;
    }
    this.drawT += dt;
    this.aimPoint(_o);
    _o.y += 0.15;
    t.aimPoint(_v);
    leadTarget(_o, _v, t.velocity, r.speed, this.aimAt, 1.5);
    if (this.drawT >= r.draw) {
      this.drawT = -1;
      this.shootT = this.rng.range(r.interval[0], r.interval[1]) * this.diff.cooldown;
      ballisticDir(_o, this.aimAt, r.speed, ARROW_GRAVITY, _dir);
      const dist = _o.distanceTo(this.aimAt);
      const spread = THREE.MathUtils.degToRad(2 + dist * 0.03) * this.diff.spread;
      spreadDir(_dir, spread, this.rng.float(), this.rng.float(), _dir);
      this.ctx.projectiles.fire({
        origin: _o.clone(),
        dir: _dir.clone(),
        speed: r.speed,
        damage: (this.spec.damage ?? this.def.damage) * this.damageMul,
        team: 'enemy',
        owner: this,
        style: r.style,
      });
      this.ctx.audio.play('bow_release', { pos: this.position, volume: 0.55, pitch: 0.85 });
    }
  }

  private doClimb(dt: number) {
    const mt = this.moveTarget!;
    const dx = mt.x - this.position.x;
    const dz = mt.z - this.position.z;
    const h = Math.hypot(dx, dz);
    const above = mt.y > this.position.y + 0.4;
    const climbing = this.state === 'climb';
    if (above && (climbing || h < 1.4 || (this.wallT < 0.3 && h < 3.5))) {
      // on the ladder / wall face: climb straight up, pressing toward the target
      this.state = 'climb';
      this.noGravity = true;
      this.avoid = false;
      this.clearGoal();
      const press = Math.min(h, 0.8);
      this.velocity.x = (dx / Math.max(h, 1e-3)) * press;
      this.velocity.z = (dz / Math.max(h, 1e-3)) * press;
      this.velocity.y = 2.1;
      this.climbPhase = (this.climbPhase + dt * 1.4) % 1;
      this.faceToward(mt);
      if (this.position.y >= mt.y - 0.15) {
        // haul over the top onto the target spot
        this.position.set(mt.x, mt.y + 0.05, mt.z);
        this.velocity.set(0, 0, 0);
        this.finishClimb();
      }
      return;
    }
    this.state = 'advance';
    this.avoid = false; // walk straight to the foot of the wall/ladder
    this.velocity.y = Math.min(this.velocity.y, 0);
    this.setGoal(mt, this.speedMax, 0.2);
    this.faceToward(null);
    if (h < 0.3 && !above) this.finishClimb();
  }

  private finishClimb() {
    this.moveTarget = null;
    this.behavior = 'charge';
    this.noGravity = false;
    this.avoid = true;
    this.state = 'advance';
  }

  private chooseAttack(gap: number, t: Combatant): AttackAnim {
    const atks = this.def.attacks;
    if (this.def.kind === 'troll') {
      if (gap < 1.2) return 'stomp';
      // sweep when the target is off-centre, slam when straight ahead
      return this.angleTo(t.position) > 0.35 || this.rng.chance(0.45) ? 'sweep' : 'slam';
    }
    return atks[this.rng.int(0, atks.length - 1)];
  }

  protected onWindup(kind: AttackAnim): void {
    if (this.def.kind === 'troll') vocal(this.ctx, 'troll_roar', this.position, 0.75, 1.15);
    else if (this.rng.chance(0.6)) vocal(this.ctx, this.def.voice.grunt, this.position, 0.75, this.def.voice.pitch);
    if (kind !== 'punch') this.ctx.audio.play('sword_swing', { pos: this.position, volume: 0.35, pitch: 0.85 });
  }

  protected strike(kind: AttackAnim, target: Combatant | null): void {
    const ctx = this.ctx;
    const dmg = (this.spec.damage ?? this.def.damage) * this.damageMul;
    const reach = this.def.reach * (this.spec.scale ?? 1);
    const troll = this.def.kind === 'troll';
    dirFromYaw(this.facing, _dir);
    if (troll && (kind === 'slam' || kind === 'stomp')) {
      // area attack
      const center = _o.copy(this.position);
      const rad = kind === 'slam' ? 2.7 : 3.2;
      if (kind === 'slam') center.addScaledVector(_dir, reach * 0.65);
      ctx.fx.dust(center, 24, 0x6a5a44);
      ctx.fx.debris(center, 10, 0x5a5048);
      ctx.audio.play('troll_hit', { pos: center, volume: 1 });
      ctx.audio.play('stone_crumble', { pos: center, volume: 0.8 });
      const pd = ctx.player ? ctx.player.position.distanceTo(center) : 99;
      if (pd < 18) ctx.player.camera.shake(0.55 * (1 - pd / 18), 0.4);
      for (const c of ctx.combatants.all()) {
        if (!c.alive || !hostile(this.team, c.team)) continue;
        const d = Math.hypot(c.position.x - center.x, c.position.z - center.z) - c.radius;
        if (d > rad || Math.abs(c.position.y - center.y) > 1.5) continue;
        _v.set(c.position.x - center.x, 0.4, c.position.z - center.z).normalize();
        c.takeDamage({ amount: dmg * (kind === 'slam' ? 1.3 : 0.6) * (1 - (0.4 * d) / rad), type: 'crush', source: this, point: c.position, dir: _v.clone(), knockback: kind === 'slam' ? 8 : 6, stagger: true });
      }
      return;
    }
    if (!target || !target.alive) return;
    let reachOk = reach + 0.35;
    let cone = 1.2;
    if (kind === 'thrust') {
      reachOk += 0.4;
      cone = 0.6;
    } else if (kind === 'sweep') cone = 1.35;
    else if (kind === 'punch') reachOk = 1.6;
    // also hit others caught by a troll sweep
    const victims: Combatant[] = troll && kind === 'sweep' ? ctx.combatants.query(this.position, reachOk + 0.5).filter((c) => hostile(this.team, c.team)) : [target];
    let hitAny = false;
    for (const v of victims) {
      const g = this.gap(v);
      const a = this.angleTo(v.position);
      if (g > reachOk || a > cone || Math.abs(v.position.y - this.position.y) > this.height * 0.8) continue;
      _v.set(v.position.x - this.position.x, 0, v.position.z - this.position.z).normalize();
      const heavy = kind === 'overhead' || kind === 'sweep' || this.def.kind === 'berserker';
      v.takeDamage({
        amount: dmg * (kind === 'punch' ? 0.6 : kind === 'overhead' ? 1.2 : 1),
        type: troll ? 'blunt' : 'melee',
        source: this,
        point: v.position,
        dir: _v.clone(),
        knockback: troll ? 10 : heavy ? 3 : 1.5,
        stagger: troll || (heavy && this.def.poise > 0.25),
      });
      hitAny = true;
      if (v.team !== 'player') ctx.fx.blood(_o.copy(v.position).setY(v.position.y + v.height * 0.6), _v, 'red', 0.5);
    }
    if (hitAny) ctx.audio.play(troll ? 'troll_hit' : 'sword_clash', { pos: this.position, volume: 0.7, pitch: troll ? 1 : 1.1 });
    if (troll) {
      const pd = ctx.player ? ctx.player.position.distanceTo(this.position) : 99;
      if (pd < 16) ctx.player.camera.shake(0.35 * (1 - pd / 16), 0.3);
    }
  }

  // ── scripting surface for boss patterns (Enemy.attack / playPose / attacking) ──
  private scriptedAtk = false;
  /** start a telegraphed attack now; false while dead or already mid-attack */
  attack(kind: AttackAnim, opts: { windup?: number; target?: Combatant | null } = {}): boolean {
    if (!this.alive || this.atk.phase !== 'none') return false;
    const target = opts.target === undefined ? (this.target ?? this.ctx.player) : opts.target;
    this.startAttack(kind, target, opts.windup ?? this.def.windup * this.diff.windup);
    this.scriptedAtk = true;
    return true;
  }
  /** hold a special pose (roar, stagger, kneel, block...) for `seconds` */
  playPose(pose: SpecialPose, seconds: number): void {
    this.playSpecial(pose, seconds);
  }
  get attacking(): boolean {
    return this.atk.phase !== 'none';
  }

  dispose(): void {
    releaseSlot(this.target, this);
    super.dispose();
  }
}

export function createEnemy(ctx: GameContext, spec: EnemySpec, pos: THREE.Vector3, facing?: number): Enemy {
  return new EnemyImpl(ctx, spec, pos, facing);
}
