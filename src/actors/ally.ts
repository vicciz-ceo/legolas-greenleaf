/**
 * Allies: Gimli, Aragorn, Tauriel, elf archers, Rohirrim, dwarves, Gondor soldiers, men.
 * They follow their anchor (a point or the player), fight nearby enemies with plausible kills
 * at a tuned rate, are invulnerable by default (they still flinch and parry), and play
 * gestures. Gimli's kills feed the rivalry (`spec.rivalry` while ctx.rivalry.active); when
 * he gets more than 2 ahead of the player he "plays with" his foes so the count stays close.
 */
import * as THREE from 'three';
import type { Ally, AllyKind, AllySpec, AttackAnim, Combatant, DamageInfo, GameContext, HumanoidKind, WeaponKind } from '../core/types';
import { dirFromYaw } from '../core/math';
import { Rng, hashSeed } from '../core/rng';
import { makeHumanoid } from './humanoids';
import { applyLoadout } from '../creatures/loadouts';
import { NpcBase, vocal } from './npc';
import { hostile, meleeLineClear } from './combatant';
import { ARROW_GRAVITY, ballisticDir, spreadDir } from '../combat/aim';

interface AllyDef {
  kind: HumanoidKind;
  name: string;
  weapon: WeaponKind;
  offhand?: WeaponKind;
  speed: number;
  /** damage per melee hit (before boss scaling) */
  damage: number;
  cooldown: [number, number];
  attacks: AttackAnim[];
  reach: number;
  windup: number;
  archer?: { interval: [number, number]; damage: number };
}

const ALLIES: Record<AllyKind, AllyDef> = {
  gimli: { kind: 'gimli', name: 'Gimli', weapon: 'dwarf_axe', speed: 5.6, damage: 34, cooldown: [0.9, 1.4], attacks: ['overhead', 'slash', 'backslash'], reach: 1.7, windup: 0.32 },
  aragorn: { kind: 'aragorn', name: 'Aragorn', weapon: 'sword', speed: 6.2, damage: 36, cooldown: [0.9, 1.4], attacks: ['slash', 'backslash', 'thrust'], reach: 2.0, windup: 0.28 },
  tauriel: { kind: 'tauriel', name: 'Tauriel', weapon: 'none', offhand: 'elven_bow', speed: 6.4, damage: 28, cooldown: [0.8, 1.2], attacks: ['knife1', 'knife2', 'knife3'], reach: 1.6, windup: 0.22, archer: { interval: [1.5, 2.4], damage: 32 } },
  elf_archer: { kind: 'elf', name: 'Elf', weapon: 'none', offhand: 'elven_bow', speed: 5.6, damage: 18, cooldown: [1.2, 1.8], attacks: ['slash'], reach: 1.6, windup: 0.3, archer: { interval: [1.9, 2.9], damage: 26 } },
  rohirrim: { kind: 'rohirrim', name: 'Rider of Rohan', weapon: 'sword', offhand: 'shield', speed: 5.2, damage: 26, cooldown: [1.2, 1.9], attacks: ['slash', 'overhead'], reach: 1.9, windup: 0.35 },
  dwarf: { kind: 'dwarf', name: 'Dwarf', weapon: 'axe', speed: 4.8, damage: 26, cooldown: [1.2, 1.9], attacks: ['overhead', 'slash'], reach: 1.6, windup: 0.35 },
  gondor: { kind: 'gondor', name: 'Soldier of Gondor', weapon: 'sword', offhand: 'shield', speed: 5.0, damage: 24, cooldown: [1.3, 2.0], attacks: ['slash', 'thrust'], reach: 1.9, windup: 0.35 },
  man: { kind: 'man', name: 'Man', weapon: 'sword', speed: 5.0, damage: 20, cooldown: [1.4, 2.2], attacks: ['slash', 'overhead'], reach: 1.8, windup: 0.38 },
};

const ENGAGE_RANGE = 10;
const LEASH = 14;
/** height difference beyond which a melee ally neither picks nor strikes a foe (m) */
const MELEE_DY = 1.6;

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();

class AllyImpl extends NpcBase implements Ally {
  readonly spec: AllySpec;
  anchor: THREE.Vector3 | 'player';
  private readonly def: AllyDef;
  private readonly rng: Rng;
  private foe: Combatant | null = null;
  private foeT = 0;
  private cooldown = 0.8;
  private shootT = 1;
  private drawT = -1;
  private readonly aimAt = new THREE.Vector3();
  private followSide: number;
  private gestureLook = 0;
  private parryT = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(ctx: GameContext, spec: AllySpec, pos: THREE.Vector3, facing = 0) {
    const def = ALLIES[spec.kind] ?? ALLIES.man;
    const seed = hashSeed('ally', spec.kind, pos.x.toFixed(1), pos.z.toFixed(1));
    const humanoid = makeHumanoid(applyLoadout({ kind: def.kind, seed, weapon: def.weapon, offhand: def.offhand }, !def.archer));
    super(ctx, {
      team: 'ally',
      name: spec.name ?? def.name,
      maxHp: 400,
      humanoid,
      height: humanoid.height,
      radius: Math.max(0.3, humanoid.height * (def.kind === 'gimli' || def.kind === 'dwarf' ? 0.26 : 0.19)),
      bloodKind: 'red',
      speed: def.speed,
      facing,
    });
    this.spec = spec;
    this.def = def;
    this.rng = new Rng(seed);
    this.anchor = spec.anchor ?? 'player';
    this.followSide = this.id % 2 === 0 ? 1 : -1;
    this.targetable = false; // never aim-assisted / Focus-marked
    this.buildHumanoidZones(humanoid, { girth: def.kind === 'gimli' || def.kind === 'dwarf' ? 1.35 : 1 });
    this.place(pos);
    this.object.name = `ally:${this.name}`;
    ctx.engine.levelRoot.add(this.object);
    ctx.combatants.add(this); // idempotent: spawnEnemy/addCombatant may add it again
    this.unsubscribe = ctx.combatants.onKill((victim, killer) => this.onKill(victim, killer));
  }

  private get invulnerable(): boolean {
    return this.spec.invulnerable !== false;
  }

  protected filterDamage(d: DamageInfo): number {
    if (!this.invulnerable) return d.amount;
    // story characters: flinch and parry, never die
    this.hitReact = Math.max(this.hitReact, 0.6);
    this.parryT -= 1;
    if (this.parryT < 0) {
      this.parryT = 2;
      this.ctx.audio.play('sword_clash', { pos: this.position, volume: 0.5, pitch: 1.1 });
    }
    return 0;
  }

  private onKill(victim: Combatant, killer: Combatant | null) {
    if (killer !== this || victim === this) return;
    const v = victim as Combatant & { countsForRivalry?: boolean; spec?: { countsForRivalry?: boolean } };
    const counts = victim.team === 'enemy' && v.countsForRivalry !== false && v.spec?.countsForRivalry !== false;
    if (this.spec.rivalry && counts && this.ctx.rivalry?.active) this.ctx.rivalry.addGimli(1);
    if (this.rng.chance(0.25)) this.gesture(this.spec.kind === 'gimli' ? 'roar' : 'nod');
  }

  gesture(kind: 'cheer' | 'roar' | 'point' | 'nod'): void {
    if (kind === 'cheer') this.playSpecial('cheer', 1.6);
    else if (kind === 'roar') this.playSpecial('roar', 1.3);
    else if (kind === 'point') this.playSpecial('cheer', 0.9);
    else this.gestureLook = 1.0; // nod: dip the head toward the player
  }

  private anchorPos(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    if (this.anchor === 'player') {
      const p = ctx.player;
      if (!p) return out.copy(this.position);
      // a spot beside the player, a little ahead (out of the over-the-shoulder camera's face)
      const f = p.camera ? p.camera.yaw : p.facing ?? 0;
      dirFromYaw(f + this.followSide * 1.15, out).multiplyScalar(3.2 + (this.id % 3) * 0.9).add(p.position);
      return out;
    }
    return out.copy(this.anchor);
  }

  private pickFoe(anchor: THREE.Vector3) {
    let best: Combatant | null = null;
    let bd = Infinity;
    for (const c of this.ctx.combatants.all()) {
      if (!c.alive || !hostile(this.team, c.team) || c.team === 'neutral') continue;
      const fromAnchor = c.position.distanceTo(anchor);
      // a rival (Gimli) ranges further out to meet the foes the player is shooting, otherwise they
      // all die before reaching him and his count never moves
      const rival = this.spec.rivalry ? 8 : 0;
      if (fromAnchor > LEASH + rival + (this.def.archer ? 14 : 0)) continue;
      const d = this.gap(c);
      if (d > ENGAGE_RANGE + rival + (this.def.archer ? 22 : 0)) continue;
      // a melee ally cannot reach a foe on a ledge / platform far above or below him
      if (!this.def.archer && Math.abs(c.position.y - this.position.y) > MELEE_DY) continue;
      // prefer foes already near us; keep the current one (hysteresis)
      const score = d - (c === this.foe ? 2 : 0) + (c.isBoss ? 4 : 0);
      if (score < bd) {
        bd = score;
        best = c;
      }
    }
    this.foe = best;
  }

  /** damage scaling so allies feel strong without stealing the show */
  private damageAgainst(c: Combatant): number {
    let dmg = this.def.damage;
    if (c.isBoss) dmg *= 0.15;
    else if (c.maxHp >= 400) dmg *= 0.25;
    if (this.spec.kind === 'gimli' && this.ctx.rivalry?.active) {
      const lead = this.ctx.rivalry.gimli - this.ctx.rivalry.legolas;
      if (lead >= 3) dmg *= 0.3;
      else if (lead >= 2) dmg *= 0.65;
    }
    return dmg;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.updateLod(dt);
    this.updateSpecial(dt);
    this.parryT = Math.max(0, this.parryT - dt);
    this.gestureLook = Math.max(0, this.gestureLook - dt);
    if (!this.alive) {
      this.dampSpeed(dt);
      this.clearGoal();
      this.stepBody(dt);
      this.animateBody(dt);
      this.updateDeath(dt);
      return;
    }
    this.cooldown -= dt;
    this.stagger = Math.max(0, this.stagger - dt);
    const anchor = this.anchorPos(_o);
    const attacking = !this.updateAttack(dt);

    if (!this.aiEnabled) {
      this.cancelAttack();
      this.drawT = -1;
      if (this.moveTarget) this.setGoal(this.moveTarget, this.speedMax * 0.7, 0.5);
      else this.clearGoal();
      this.faceToward(this.ctx.player ? this.ctx.player.position : null);
    } else if (!attacking || this.atk.phase === 'recover') {
      this.foeT -= dt;
      if (this.foeT <= 0 || (this.foe && !this.foe.alive)) {
        this.foeT = 0.5;
        this.pickFoe(anchor);
      }
      this.think(dt, anchor);
    }
    if (this.drawT >= 0) this.updateShot(dt);
    this.steer(dt);
    this.stepBody(dt);
    this.animateBody(dt, (a) => {
      if (this.drawT >= 0) {
        a.aim = 1;
        a.draw = Math.min(1, this.drawT / 0.7);
        _v.copy(this.aimAt).sub(this.position);
        a.aimPitch = Math.atan2(_v.y - this.height * 0.75, Math.hypot(_v.x, _v.z));
      } else {
        a.aim = 0;
        a.draw = 0;
      }
      const p = this.ctx.player;
      if (this.gestureLook > 0 && p) {
        p.aimPoint(this.lookPoint);
        this.lookPoint.y -= Math.sin((1 - this.gestureLook) * Math.PI * 2) * 0.6;
        a.lookAt = this.lookPoint;
      } else if (this.foe && this.foe.alive) {
        this.foe.aimPoint(this.lookPoint);
        a.lookAt = this.lookPoint;
      } else a.lookAt = null;
    });
  }

  private think(dt: number, anchor: THREE.Vector3) {
    const foe = this.foe;
    if (!foe) {
      this.drawT = -1;
      const d = this.position.distanceTo(anchor);
      if (d > 1.2) this.setGoal(anchor, d > 8 ? this.speedMax : Math.min(this.speedMax, 3 + d * 0.4), 0.8);
      else this.clearGoal();
      this.faceToward(this.anchor === 'player' && this.ctx.player ? this.ctx.player.position : null);
      return;
    }
    const gap = this.gap(foe);
    this.faceToward(foe.position);
    // archers keep their distance and shoot, melee when cornered
    if (this.def.archer && gap > 3) {
      if (this.drawT < 0) {
        this.shootT -= dt;
        const d = this.position.distanceTo(anchor);
        if (d > 4) this.setGoal(anchor, this.speedMax, 1.5);
        else this.clearGoal();
        if (this.shootT <= 0 && gap < 40) {
          if (this.losTo(foe)) {
            this.drawT = 0;
            this.ctx.audio.play('bow_draw', { pos: this.position, volume: 0.35 });
          }
          this.shootT = this.rng.range(...this.def.archer.interval);
        }
      } else this.clearGoal();
      return;
    }
    this.drawT = -1;
    const reach = this.def.reach;
    if (gap > reach * 0.8) {
      this.setGoal(foe.position, this.speedMax, reach * 0.6 + foe.radius + this.radius);
    } else {
      this.clearGoal();
      this.dampSpeed(dt);
    }
    if (this.cooldown <= 0 && gap <= reach + 0.2 && this.angleTo(foe.position) < 0.9 && this.atk.phase === 'none') {
      const kind = this.def.attacks[this.rng.int(0, this.def.attacks.length - 1)];
      this.startAttack(kind, foe, this.def.windup);
      this.cooldown = this.rng.range(...this.def.cooldown) + this.def.windup;
    }
  }

  private updateShot(dt: number) {
    const foe = this.foe;
    if (!foe || !foe.alive || !this.def.archer) {
      this.drawT = -1;
      return;
    }
    this.drawT += dt;
    this.aimPoint(_o);
    _o.y += 0.15;
    foe.aimPoint(this.aimAt);
    if (this.drawT >= 0.7) {
      this.drawT = -1;
      ballisticDir(_o, this.aimAt, 55, ARROW_GRAVITY, _dir);
      spreadDir(_dir, THREE.MathUtils.degToRad(1.2), this.rng.float(), this.rng.float(), _dir);
      this.ctx.projectiles.fire({
        origin: _o.clone(),
        dir: _dir.clone(),
        speed: 55,
        damage: this.damageAgainst(foe) * (this.def.archer.damage / this.def.damage),
        team: 'ally',
        owner: this,
        style: 'elven',
      });
      this.ctx.audio.play('bow_release', { pos: this.position, volume: 0.4 });
    }
  }

  protected onWindup(): void {
    if (this.spec.kind === 'gimli' && this.rng.chance(0.3)) vocal(this.ctx, 'orc_grunt', this.position, 0.5, 0.65);
    this.ctx.audio.play('sword_swing', { pos: this.position, volume: 0.35 });
  }

  protected strike(kind: AttackAnim, target: Combatant | null): void {
    if (!target || !target.alive) return;
    if (this.gap(target) > this.def.reach + 0.5 || this.angleTo(target.position) > 1.3) return;
    if (Math.abs(target.position.y - this.position.y) > MELEE_DY || !meleeLineClear(this.ctx.physics, this, target)) return;
    _v.set(target.position.x - this.position.x, 0, target.position.z - this.position.z).normalize();
    const finisher = kind === 'overhead' || kind === 'knife3';
    target.takeDamage({
      amount: this.damageAgainst(target) * (finisher ? 1.25 : 1),
      type: 'melee',
      source: this,
      point: target.aimPoint(_o).clone(),
      dir: _v.clone(),
      knockback: finisher ? 3 : 1.2,
      stagger: finisher,
    });
    const bk = (target as Combatant & { bloodKind?: 'red' | 'dark' | 'black' | 'ichor' }).bloodKind ?? 'dark';
    this.ctx.fx.blood(_o, _v, bk, 0.7);
    this.ctx.audio.play(this.spec.kind === 'gimli' || this.spec.kind === 'dwarf' ? 'knife_hit' : 'sword_clash', { pos: this.position, volume: 0.6, pitch: 0.85 });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.dispose();
  }
}

export function createAlly(ctx: GameContext, spec: AllySpec, pos: THREE.Vector3, facing?: number): Ally {
  return new AllyImpl(ctx, spec, pos, facing);
}
