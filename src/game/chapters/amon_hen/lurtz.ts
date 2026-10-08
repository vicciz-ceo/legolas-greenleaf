/**
 * Lurtz, the first Uruk-hai: the boss of Amon Hen, built on top of the stock enemy (createEnemy via
 * level.spawnEnemy) with the same body-swap trick the Ravenhill Bolg uses: the enemy factory has no
 * way to ask for the 'lurtz' humanoid kind, so he is spawned as an 'uruk_archer' (bow AI) and his body
 * is swapped for the real Lurtz right after. (Blocker report: an optional `EnemySpec.kind` would
 * remove the workaround.)
 *
 * Two phases, switched by the script (`toBlade`):
 *
 *   BOW    stock archer AI on a faster bow: leads his shots, strafes, backs off when you close in.
 *   BLADE  sword and shield. A guard in front of his chest glances frontal arrows while he advances
 *          (a head shot or a flank still lands, and four blocked arrows crack the guard open for a
 *          moment). The guard is down while he swings. Stock melee AI plus two telegraphed specials:
 *
 *            shield bash  (< 4.5 m)  he drops behind the shield for ~1 s ("Jump or dash clear"),
 *                                    then lunges 3 m. 16 damage, knockback, stagger.
 *            knife throw  (7-16 m)   an arm-back wind-up of ~0.9 s, then a fast thrown knife at
 *                                    where you will be. 18 damage. Strafe.
 *
 * An HP `floor` (a fraction of max HP) lets the script end a phase on its own terms: a single big hit
 * can never skip a phase or the 15 % finisher.
 */
import * as THREE from 'three';
import type { AnimInput, DamageInfo, Enemy, EnemySpec, Humanoid, LevelAPI } from '../../../core/types';
import type { BaseCombatant } from '../../../actors/combatant';
import { ARCHETYPES, type ArchetypeDef } from '../../../actors/enemy';
import { createHumanoid } from '../../../creatures/humanoid';
import { ARROW_GRAVITY, ballisticDir, leadTarget } from '../../../combat/aim';
import { plain } from '../../../world';
import { clamp, yawOf } from '../../../core/math';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();

export type LurtzPhase = 'bow' | 'blade';

export interface LurtzBoss {
  readonly enemy: Enemy;
  readonly phase: LurtzPhase;
  /** HP fraction he cannot be taken below */
  floor: number;
  /** telegraphed specials on/off */
  specials: boolean;
  /** a special is winding up, striking or recovering */
  readonly busy: boolean;
  /** the guard is up (frontal arrows glance off) */
  readonly guarding: boolean;
  /** the guard cracked open and is down for a moment */
  readonly guardBroken: boolean;
  readonly hpFrac: number;
  /** swap bow for sword and shield and switch to the melee AI */
  toBlade(): void;
  /** scripted aim (cinematics, AI off): bow drawn `draw` 0..1 at a world point; null lowers the bow */
  aim(at: THREE.Vector3 | null, draw: number): void;
  /** scripted shot at a world point */
  shoot(at: THREE.Vector3, o?: { speed?: number; damage?: number }): void;
  /** turn on the spot toward a point (AI off) */
  face(at: THREE.Vector3): void;
  /** cancel a special in progress (cinematics) */
  cancel(): void;
  /** stop the controller (it also stops itself on death) */
  stop(): void;
}

type Swappable = BaseCombatant & {
  body: Humanoid;
  motor?: { height: number; radius: number };
  facing: number;
  speedMax: number;
  def: ArchetypeDef;
  spec: EnemySpec;
  anim: AnimInput;
  faceToward(p: THREE.Vector3 | null): void;
};

export const BOW_PHASE = { speed: 5.0, damage: 15, arrow: 44, draw: 0.78, interval: [1.15, 1.9] as [number, number] };
export const BLADE_PHASE = { speed: 4.7, damage: 22 };

/** spawn Lurtz at `pos` with `hpFrac` of his max HP left */
export function spawnLurtz(level: LevelAPI, pos: THREE.Vector3, facing: number, o: { maxHp: number; hpFrac?: number }): LurtzBoss {
  const { ctx } = level;
  const e = level.spawnEnemy(
    { archetype: 'uruk_archer', behavior: 'archer', boss: true, name: 'Lurtz', hp: o.maxHp, damage: BOW_PHASE.damage, speed: BOW_PHASE.speed, countsForRivalry: false, seed: 5 },
    pos,
    facing,
  );
  const sw = e as unknown as Swappable;

  // ── body swap: the real Lurtz (2.1 m, the white hand, scars), bow in the left hand ──
  try {
    const lurtz = createHumanoid({ kind: 'lurtz', seed: 2, weapon: 'none', offhand: 'uruk_bow' });
    const old = sw.body;
    old.root.removeFromParent();
    old.dispose();
    sw.body = lurtz;
    sw.object.add(lurtz.root);
    sw.height = lurtz.height;
    sw.radius = Math.max(0.42, lurtz.height * 0.2);
    if (sw.motor) {
      sw.motor.height = lurtz.height * 0.95;
      sw.motor.radius = sw.radius;
    }
    sw.clearZones();
    sw.buildHumanoidZones(lurtz, { girth: 1.12 });
  } catch (err) {
    console.warn('[amon_hen] Lurtz body swap failed, keeping the Uruk archer body', err);
  }
  e.hp = Math.round(e.maxHp * (o.hpFrac ?? 1));
  // the bow phase: a faster bow than the stock archer's
  const bowDef: ArchetypeDef = {
    ...ARCHETYPES.uruk_archer,
    girth: 1.12,
    poise: 0.5,
    cooldown: [1.1, 1.8],
    ranged: { speed: BOW_PHASE.arrow, interval: BOW_PHASE.interval, style: 'uruk', draw: BOW_PHASE.draw },
  };
  sw.def = bowDef;
  const baseSpeed = sw.speedMax;

  let phaseV: LurtzPhase = 'bow';
  const boss: LurtzBoss = {
    enemy: e,
    get phase() {
      return phaseV;
    },
    floor: 0,
    specials: true,
    get busy() {
      return state !== 'none';
    },
    get guarding() {
      return guardOn;
    },
    get guardBroken() {
      return guardBreakT > 0;
    },
    get hpFrac() {
      return e.hp / e.maxHp;
    },
    toBlade,
    aim(at, draw) {
      const a = sw.anim;
      if (!at) {
        a.aim = 0;
        a.draw = 0;
        a.lookAt = null;
        return;
      }
      e.aimPoint(_a);
      _b.copy(at).sub(_a);
      a.aim = 1;
      a.draw = clamp(draw, 0, 1);
      a.aimPitch = Math.atan2(_b.y, Math.hypot(_b.x, _b.z));
      a.lookAt = at;
      sw.faceToward(at);
    },
    shoot(at, so = {}) {
      const speed = so.speed ?? BOW_PHASE.arrow;
      e.aimPoint(_o);
      _o.y += 0.15;
      ballisticDir(_o, at, speed, ARROW_GRAVITY, _d);
      ctx.projectiles.fire({ origin: _o.clone(), dir: _d.clone(), speed, damage: so.damage ?? 0, team: 'enemy', owner: e, style: 'uruk' });
      ctx.audio.play('bow_release', { pos: e.position, volume: 0.7, pitch: 0.8 });
    },
    face(at) {
      sw.faceToward(at);
      sw.facing = yawOf(at.x - e.position.x, at.z - e.position.z);
    },
    cancel() {
      if (state !== 'none') endSpecial();
    },
    stop() {
      stopUpdate();
      setGuard(false);
    },
  };
  // ── HP floor: one hit can never skip a phase or the finisher ──
  const takeDamage = e.takeDamage.bind(e);
  e.takeDamage = (d: DamageInfo) => {
    if (e.alive && boss.floor > 0) {
      const min = boss.floor * e.maxHp;
      const room = e.hp - min;
      if (room <= 0.5) {
        if (d.point) ctx.fx.sparks(d.point, _d.set(0, 1, 0), 3);
        return;
      }
      if (d.amount > room) d = { ...d, amount: room };
    }
    // blocked arrows crack the guard
    if (guardOn && d.zone === 'armor' && d.type === 'arrow') {
      guardHits++;
      if (guardHits >= GUARD_HITS) breakGuard();
    }
    takeDamage(d);
  };

  // ── the guard: an armour disc in front of the chest while the shield is up ──
  const guardObj = new THREE.Object3D();
  guardObj.position.set(0, e.height * 0.56, 0.5);
  e.object.add(guardObj);
  let guardOn = false;
  let guardHits = 0;
  let guardBreakT = 0;
  const GUARD_HITS = 4;
  function setGuard(on: boolean): void {
    if (on === guardOn) return;
    guardOn = on;
    if (on) sw.addZoneDisc(guardObj, 0.5, new THREE.Vector3(0, 0, 1), 'armor', 0.14);
    else sw.removeZonesOf(guardObj);
  }
  function breakGuard(): void {
    guardHits = 0;
    guardBreakT = 2.6;
    setGuard(false);
    e.playPose?.('stagger', 0.9);
    ctx.hud.toast('Guard broken!', 'info');
    ctx.audio.play('sword_clash', { pos: e.position, volume: 1, pitch: 0.7 });
    e.aimPoint(_a);
    ctx.fx.sparks(_a, _d.set(0, 0.4, 1), 14);
  }

  // ── phases ──
  function toBlade(): void {
    phaseV = 'blade';
    const h = e.humanoid;
    h.setWeapon('hand_r', 'sword');
    h.setWeapon('hand_l', 'shield');
    const d: ArchetypeDef = {
      ...ARCHETYPES.uruk,
      kind: 'uruk',
      girth: 1.12,
      poise: 0.75,
      attacks: ['slash', 'overhead', 'thrust', 'slash'],
      windup: 0.6,
      reach: 2.5,
      cooldown: [1.1, 1.9],
      ranged: undefined,
      behavior: 'charge',
    };
    sw.def = d;
    e.spec.damage = BLADE_PHASE.damage;
    sw.speedMax = baseSpeed * (BLADE_PHASE.speed / BOW_PHASE.speed);
    e.behavior = 'charge';
    guardHits = 0;
    nextSpecial = 2.2;
  }

  // ── specials ──
  type State = 'none' | 'bashWind' | 'bashLunge' | 'bashRecover' | 'knifeWind' | 'knifeRecover';
  let state: State = 'none';
  let stT = 0;
  let nextSpecial = 3;
  let bashHit = false;
  const lockDir = new THREE.Vector3();
  const knifeFrom = new THREE.Vector3();

  function endSpecial(): void {
    state = 'none';
    stT = 0;
    e.aiEnabled = true;
    ctx.hud.setPrompt(null);
    nextSpecial = 3.4 + level.rng() * 3.2;
  }
  function faceToPlayer(): void {
    const p = ctx.player.position;
    sw.faceToward(p);
    sw.facing = yawOf(p.x - e.position.x, p.z - e.position.z);
  }

  function throwKnife(): void {
    const k = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.012), plain(0xb9bec6, { metalness: 0.9, roughness: 0.3, key: 'lurtzKnifeBlade' }));
    blade.position.y = 0.2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.03), plain(0x2a1d14, { key: 'lurtzKnifeGrip' }));
    k.add(blade, grip);
    k.userData.throwKind = 'spear';
    const p = ctx.player;
    p.aimPoint(_a);
    _b.copy(e.position);
    _b.y += e.height * 0.78;
    leadTarget(_b, _a, p.velocity, 32, _c, 0.8);
    // thrown objects fall at 18 m/s²: aim above the lead point by the drop over the flight time
    const t = _b.distanceTo(_c) / 32;
    _c.y += 0.5 * 18 * t * t;
    _d.copy(_c).sub(_b).normalize().multiplyScalar(32);
    ctx.projectiles.throwObject({ object: k, origin: _b.clone(), velocity: _d.clone(), damage: 18, team: 'enemy', owner: e, radius: 0.28 });
    ctx.audio.play('sword_swing', { pos: e.position, volume: 0.8, pitch: 1.5 });
    ctx.audio.play('knife_slash', { pos: e.position, volume: 0.6, pitch: 0.8 });
  }

  const stopUpdate = level.onUpdate((dt) => {
    if (boss.floor > 0 && e.alive && e.hp < boss.floor * e.maxHp) e.hp = boss.floor * e.maxHp;
    if (!e.alive) {
      setGuard(false);
      stopUpdate();
      return;
    }
    const player = ctx.player;
    // the guard: up while the blade phase advances; down while he swings, in specials and when cracked
    if (guardBreakT > 0) guardBreakT -= dt;
    const want = phaseV === 'blade' && guardBreakT <= 0 && (state === 'bashWind' || state === 'bashLunge' || (state === 'none' && !e.attacking));
    if (want !== guardOn) setGuard(want);

    const dx = player.position.x - e.position.x;
    const dz = player.position.z - e.position.z;
    const dist = Math.hypot(dx, dz);
    const sameLevel = Math.abs(player.position.y - e.position.y) < 2.5;
    stT += dt;
    switch (state) {
      case 'none': {
        if (!boss.specials || phaseV !== 'blade' || !e.aiEnabled || !player.alive || e.attacking || guardBreakT > 0) break;
        nextSpecial -= dt;
        if (nextSpecial > 0 || !sameLevel) break;
        if (dist < 4.6) {
          state = 'bashWind';
          stT = 0;
          bashHit = false;
          e.aiEnabled = false;
          e.moveTarget = null;
          e.velocity.x = e.velocity.z = 0;
          e.playPose?.('block', 1.1);
          ctx.hud.setPrompt('jump', 'Jump or dash clear');
          ctx.audio.play('uruk_roar', { pos: e.position, volume: 0.9, pitch: 0.8 });
        } else if (dist > 7 && dist < 16) {
          state = 'knifeWind';
          stT = 0;
          e.aiEnabled = false;
          e.moveTarget = null;
          e.attack?.('throw', { windup: 0.85, target: null });
          ctx.hud.toast('He draws a knife: sidestep', 'warning');
          ctx.audio.play('orc_grunt', { pos: e.position, volume: 0.8, pitch: 0.7 });
          ctx.audio.play('chain_rattle', { pos: e.position, volume: 0.35, pitch: 1.6 });
        } else nextSpecial = 0.6;
        break;
      }
      case 'bashWind': {
        e.velocity.x = e.velocity.z = 0;
        if (stT < 0.75) {
          faceToPlayer();
          lockDir.set(dx, 0, dz).normalize();
        }
        if (stT >= 1.0) {
          state = 'bashLunge';
          stT = 0;
          ctx.hud.setPrompt(null);
          e.attack?.('thrust', { windup: 0.02, target: null });
          ctx.audio.play('sword_swing', { pos: e.position, volume: 0.9, pitch: 0.65 });
        }
        break;
      }
      case 'bashLunge': {
        // a short charge behind the shield
        const k = stT < 0.3 ? 1 : 0;
        e.velocity.x = lockDir.x * 11 * k;
        e.velocity.z = lockDir.z * 11 * k;
        if (!bashHit && player.alive && sameLevel && dist < e.radius + player.radius + 0.9 && (dx * lockDir.x + dz * lockDir.z) > 0) {
          bashHit = true;
          if (player.grounded) {
            player.takeDamage({ amount: 16, type: 'blunt', source: e, point: player.position.clone().setY(player.position.y + 1.0), dir: lockDir.clone(), knockback: 9, stagger: true });
            player.camera.shake(0.4, 0.3);
            ctx.audio.play('troll_hit', { pos: player.position, volume: 0.8, pitch: 1.3 });
          }
        }
        if (stT >= 0.4) {
          state = 'bashRecover';
          stT = 0;
          e.velocity.x = e.velocity.z = 0;
        }
        break;
      }
      case 'bashRecover':
        // spent: the guard is down, a free window
        e.velocity.x *= 0.8;
        e.velocity.z *= 0.8;
        if (stT >= 0.7) endSpecial();
        break;
      case 'knifeWind': {
        faceToPlayer();
        if (stT >= 0.95) {
          state = 'knifeRecover';
          stT = 0;
          throwKnife();
        }
        break;
      }
      case 'knifeRecover':
        if (stT >= 0.45) endSpecial();
        break;
    }
  });

  return boss;
}
