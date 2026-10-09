/**
 * Bolg, son of Azog: the Ravenhill boss.
 *
 * The enemy factory has no way to ask for the 'bolg' humanoid kind (EnemySpec has no `kind`; the
 * 'gundabad' archetype builds a Gundabad orc), so Bolg is spawned as a 'gundabad' boss and his
 * body is swapped for the real 'bolg' humanoid right after (LOCAL WORKAROUND, reported as a
 * blocker: an optional `EnemySpec.kind?: HumanoidKind` would remove it). Everything else is the
 * stock enemy AI (mace combos, stagger, death), plus this controller's telegraphed specials:
 *
 *   chain lash   (4–11 m)  he whirls a chain overhead for ~1.1 s, then lashes it along a locked
 *                          line: sidestep or dash. 20 damage.
 *   ground slam  (< 5 m)   mace raised high for ~1.2 s ("Jump!" prompt), then a shockwave that hits
 *                          anyone still on the ground within 5 m. 24 damage.
 *
 * and an HP floor (`floor`, a fraction of max HP) that the script uses to end a phase on its own
 * terms (a single big hit can never skip a phase).
 */
import * as THREE from 'three';
import type { DamageInfo, Enemy, Humanoid, LevelAPI } from '../../../core/types';
import type { BaseCombatant } from '../../../actors/combatant';
import { createHumanoid } from '../../../creatures/humanoid';
import { chain } from '../../../world';
import { clamp, yawOf } from '../../../core/math';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

export interface BolgBoss {
  readonly enemy: Enemy;
  /** HP fraction Bolg cannot be taken below (the script lowers it to open the next phase) */
  floor: number;
  /** telegraphed specials on/off */
  specials: boolean;
  /** seconds between specials [min, max] */
  specialEvery: [number, number];
  /** a special is winding up or striking */
  readonly busy: boolean;
  readonly hpFrac: number;
  /** cancel any special (cinematics) */
  cancel(): void;
  /** phase 2 rage: faster, more specials, steaming breath */
  enrage(): void;
  readonly enraged: boolean;
  stop(): void;
}

type Swappable = BaseCombatant & { body: Humanoid; motor?: { height: number; radius: number }; facing: number; speedMax: number };

/** spawn Bolg at `pos` with `hpFrac` of his max HP left */
export function spawnBolg(level: LevelAPI, pos: THREE.Vector3, facing: number, o: { maxHp: number; hpFrac?: number }): BolgBoss {
  const { ctx } = level;
  const e = level.spawnEnemy(
    { archetype: 'gundabad', boss: true, name: 'Bolg', hp: o.maxHp, damage: 22, speed: 4.9, weapon: 'mace', countsForRivalry: false, seed: 77 },
    pos,
    facing,
  );
  // ── body swap: the real Bolg (2.6 m, pale, scarred, bolted plates) ──
  const sw = e as unknown as Swappable;
  try {
    const bolg = createHumanoid({ kind: 'bolg', seed: 3, weapon: 'mace' });
    const old = sw.body;
    old.root.removeFromParent();
    old.dispose();
    sw.body = bolg;
    sw.object.add(bolg.root);
    sw.height = bolg.height;
    sw.radius = Math.max(0.45, bolg.height * 0.19);
    if (sw.motor) {
      sw.motor.height = bolg.height * 0.95;
      sw.motor.radius = sw.radius;
    }
    sw.clearZones();
    sw.buildHumanoidZones(bolg, { girth: 1.15 });
  } catch (err) {
    console.warn('[ravenhill] Bolg body swap failed, keeping the Gundabad body', err);
  }
  e.hp = Math.round(o.maxHp * (o.hpFrac ?? 1));

  // the chain he lashes with: hangs from his left hand at rest, whirls and lashes on a special
  const ch = chain(3.2, { link: 0.16, thick: 0.03 });
  const chainObj = ch.object;
  chainObj.traverse((m) => (m.castShadow = true));
  level.root.add(chainObj);
  const hand = e.humanoid.bones.hand_l;

  const boss: BolgBoss = {
    enemy: e,
    floor: 0,
    specials: true,
    specialEvery: [5.5, 8.5],
    get busy() {
      return state !== 'none';
    },
    get hpFrac() {
      return e.hp / e.maxHp;
    },
    get enraged() {
      return enraged;
    },
    enrage() {
      if (enraged) return;
      enraged = true;
      sw.speedMax *= 1.3;
      boss.specialEvery = [2.8, 4.5];
      next = Math.min(next, 1.5);
    },
    cancel() {
      if (state !== 'none') endSpecial();
      // drop a stock attack mid-swing too (cinematics, the finisher): NpcBase.cancelAttack is protected
      (e as unknown as { cancelAttack?: () => void }).cancelAttack?.();
    },
    stop() {
      stopUpdate();
      chainObj.visible = false;
    },
  };

  // HP floor: clamp incoming damage so one hit can never drop him through the floor
  const takeDamage = e.takeDamage.bind(e);
  e.takeDamage = (d: DamageInfo) => {
    if (boss.floor > 0 && e.alive) {
      const min = boss.floor * e.maxHp;
      const room = e.hp - min;
      if (room <= 0.5) {
        // shrug it off: flash and a spark, no damage
        if (d.point) ctx.fx.sparks(d.point, _d.set(0, 1, 0), 3);
        return;
      }
      if (d.amount > room) d = { ...d, amount: room };
    }
    takeDamage(d);
  };

  type State = 'none' | 'chainWind' | 'chainLash' | 'slamWind';
  let state: State = 'none';
  let enraged = false;
  let breath = 0;
  /** the last special: up close he alternates the slam with the chain, so both always show */
  let last: 'chain' | 'slam' = 'chain';
  let stT = 0;
  let next = 3.5;
  let whirl = 0;
  const lashFrom = new THREE.Vector3();
  const lashDir = new THREE.Vector3();
  const LASH_LEN = 10;

  function endSpecial(): void {
    state = 'none';
    stT = 0;
    e.aiEnabled = true;
    ctx.hud.setPrompt(null);
    chainObj.scale.set(1, 1, 1);
    next = boss.specialEvery[0] + level.rng() * (boss.specialEvery[1] - boss.specialEvery[0]);
  }

  function faceToPlayer(): void {
    const p = ctx.player.position;
    sw.facing = yawOf(p.x - e.position.x, p.z - e.position.z);
  }

  const stopUpdate = level.onUpdate((dt) => {
    // floor clamp (also catches damage that bypassed takeDamage, e.g. scripted)
    if (boss.floor > 0 && e.alive && e.hp < boss.floor * e.maxHp) e.hp = boss.floor * e.maxHp;
    if (!e.alive) {
      chainObj.visible = false;
      return;
    }
    if (enraged && boss.specials) {
      // steaming breath in the cold, a snort every second or so
      breath -= dt;
      if (breath <= 0) {
        breath = 0.9 + level.rng() * 0.6;
        e.humanoid.bones.head.getWorldPosition(_c);
        _c.x += Math.sin(sw.facing) * 0.35;
        _c.z += Math.cos(sw.facing) * 0.35;
        ctx.fx.dust(_c, 3, 0xe9eef2);
      }
    }
    // chain follows his left hand
    hand.getWorldPosition(_a);
    chainObj.position.copy(_a);
    if (state === 'none') {
      // hanging, swinging with his stride
      whirl += dt * (1 + e.velocity.length() * 0.4);
      _b.set(Math.sin(whirl * 2.1) * 0.25, -1, Math.cos(whirl * 1.7) * 0.2).normalize();
      _q.setFromUnitVectors(DOWN, _b);
      chainObj.quaternion.copy(_q);
      chainObj.scale.set(1, 0.8, 1);
    }
    const player = ctx.player;
    const dist = Math.hypot(player.position.x - e.position.x, player.position.z - e.position.z);
    const sameLevel = Math.abs(player.position.y - e.position.y) < 2.5;
    stT += dt;
    switch (state) {
      case 'none': {
        if (!boss.specials || !e.aiEnabled || !player.alive || e.attacking) break;
        next -= dt;
        if (next > 0 || !sameLevel) break;
        if ((dist > 4 && dist < 11) || (dist <= 4.5 && last === 'slam')) {
          last = 'chain';
          if (ctx.flags.bot === '1') console.info(`[ravenhill] bolg chain lash t=${ctx.time.t.toFixed(1)} d=${dist.toFixed(1)}`);
          state = 'chainWind';
          stT = 0;
          e.aiEnabled = false;
          e.moveTarget = null;
          e.attack?.('throw', { windup: 1.15 });
          ctx.audio.play('chain_rattle', { pos: e.position, volume: 1 });
          ctx.audio.play('orc_roar', { pos: e.position, volume: 0.9, pitch: 0.7 });
        } else if (dist <= 4.5) {
          last = 'slam';
          if (ctx.flags.bot === '1') console.info(`[ravenhill] bolg slam t=${ctx.time.t.toFixed(1)} d=${dist.toFixed(1)}`);
          state = 'slamWind';
          stT = 0;
          e.aiEnabled = false;
          e.moveTarget = null;
          e.attack?.('overhead', { windup: 1.2 });
          ctx.hud.setPrompt('jump', 'Jump the shockwave');
          ctx.audio.play('orc_roar', { pos: e.position, volume: 1, pitch: 0.62 });
        }
        break;
      }
      case 'chainWind': {
        // whirl overhead, tracking the player until the last 0.3 s, then the line is locked
        whirl += dt * 11;
        _b.set(Math.cos(whirl), 0.35, Math.sin(whirl)).normalize();
        _q.setFromUnitVectors(DOWN, _b);
        chainObj.quaternion.copy(_q);
        chainObj.scale.set(1, 0.9, 1);
        if (stT < 0.85) {
          faceToPlayer();
          lashDir.copy(player.position).sub(e.position).setY(0).normalize();
        }
        if (stT >= 1.15) {
          state = 'chainLash';
          stT = 0;
          lashFrom.copy(e.position);
          lashFrom.y += e.height * 0.55;
          ctx.audio.play('sword_swing', { pos: e.position, volume: 1, pitch: 0.6 });
          ctx.audio.play('chain_rattle', { pos: e.position, volume: 1, pitch: 1.2 });
          // hit test along the lash line
          _a.copy(player.position).sub(e.position).setY(0);
          const along = _a.dot(lashDir);
          _c.copy(lashDir).multiplyScalar(clamp(along, 0, LASH_LEN));
          const lateral = _a.sub(_c).length();
          if (along > 0 && along < LASH_LEN + 0.5 && lateral < 1.3 && sameLevel && player.alive) {
            player.takeDamage({ amount: 20, type: 'blunt', source: e, point: player.position.clone().setY(player.position.y + 1.2), dir: lashDir.clone(), knockback: 6 });
            player.camera.shake(0.35, 0.3);
          }
          _b.copy(e.position).addScaledVector(lashDir, Math.min(LASH_LEN, Math.max(2, along)));
          _b.y = e.position.y + 0.1;
          ctx.fx.sparks(_b, _d.set(0, 1, 0), 10);
          ctx.fx.dust(_b, 8, 0xd8dde2);
        }
        break;
      }
      case 'chainLash': {
        // the chain snaps out along the line, then recoils
        const k = stT < 0.12 ? stT / 0.12 : Math.max(0, 1 - (stT - 0.12) / 0.3);
        _b.copy(lashDir);
        _b.y = -0.12;
        _b.normalize();
        _q.setFromUnitVectors(DOWN, _b);
        chainObj.quaternion.copy(_q);
        chainObj.scale.set(1, 0.8 + k * (LASH_LEN / 3.2 - 0.8), 1);
        if (stT > 0.5) endSpecial();
        break;
      }
      case 'slamWind': {
        if (stT < 0.7) faceToPlayer();
        if (stT >= 1.2 + 0.14) {
          // shockwave
          ctx.hud.setPrompt(null);
          ctx.audio.play('troll_hit', { pos: e.position, volume: 1, pitch: 0.8 });
          ctx.audio.play('stone_crumble', { pos: e.position, volume: 0.9 });
          _a.set(Math.sin(sw.facing), 0, Math.cos(sw.facing)).multiplyScalar(1.6).add(e.position);
          for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2;
            _b.set(_a.x + Math.cos(ang) * 2.2, _a.y + 0.1, _a.z + Math.sin(ang) * 2.2);
            ctx.fx.dust(_b, 4, 0xdfe5ea);
          }
          ctx.fx.debris(_a, 10, 0x6a6a70);
          const d2 = Math.hypot(player.position.x - _a.x, player.position.z - _a.z);
          const cam = Math.max(0, 1 - d2 / 14);
          player.camera.shake(0.25 + 0.4 * cam, 0.5);
          if (d2 < 5 && player.grounded && sameLevel && player.alive) {
            _d.copy(player.position).sub(_a).setY(0).normalize();
            player.takeDamage({ amount: 24, type: 'blunt', source: e, point: player.position.clone().setY(player.position.y + 0.4), dir: _d.clone(), knockback: 7, stagger: true });
          }
          endSpecial();
        }
        break;
      }
    }
  });

  return boss;
}
