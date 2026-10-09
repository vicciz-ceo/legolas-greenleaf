/**
 * Uruk-hai for Amon Hen: roles on top of the stock archetypes.
 *
 *   shield   sword and shield (archetype 'uruk', a seed whose loadout carries the shield): the shield's
 *            armour disc glances frontal arrows, so shoot the head, or flank
 *   blade    sword, no shield (archetype 'uruk')
 *   pike     long pike, holds a line (archetype 'uruk_pike')
 *   archer   Uruk bow, holds a post among the trunks (archetype 'uruk_archer')
 *
 * The humanoid kit gives every 'uruk' a shield in the left hand by default, which would replace an
 * archer's bow and put a shield on a pikeman, so `dress` puts the right item in each hand (and drops
 * the shield's armour zone with the shield).
 */
import * as THREE from 'three';
import type { Enemy, EnemyBehavior, EnemySpec, LevelAPI } from '../../../core/types';
import type { BaseCombatant } from '../../../actors/combatant';
import { hashSeed } from '../../../core/rng';
import { bucketOf } from '../../../creatures/humanoid/kinds/uruks_bosses';

export type UrukRole = 'shield' | 'blade' | 'pike' | 'archer';

const ARCHETYPE: Record<UrukRole, EnemySpec['archetype']> = { shield: 'uruk', blade: 'uruk', pike: 'uruk_pike', archer: 'uruk_archer' };

/** seeds per armour look (4 buckets): shielded and unshielded melee loadouts */
const SHIELD_SEEDS: number[][] = [[], [], [], []];
const BLADE_SEEDS: number[][] = [[], [], [], []];
const ANY_SEEDS: number[][] = [[], [], [], []];
for (let s = 1; s < 600; s++) {
  const shield = hashSeed('loadout', s) % 6 < 3;
  (shield ? SHIELD_SEEDS : BLADE_SEEDS)[bucketOf(s)].push(s);
  ANY_SEEDS[bucketOf(s)].push(s);
}

/** a seed per spawn: cycles through the four looks so a squad never looks cloned */
export class SeedPicker {
  private n = 0;
  constructor(private readonly start = 0) {
    this.n = start;
  }
  next(role: UrukRole): number {
    const b = this.n++ % 4;
    const list = role === 'shield' ? SHIELD_SEEDS[b] : role === 'blade' ? BLADE_SEEDS[b] : ANY_SEEDS[b];
    return list[(Math.floor(this.n / 4) * 3 + b) % list.length];
  }
}

export interface UrukOpts {
  behavior?: EnemyBehavior;
  name?: string;
  hp?: number;
  damage?: number;
  speed?: number;
  target?: EnemySpec['target'];
  facing?: number;
}

/** put the right item in each hand: bow for archers, nothing off-hand for pikes */
export function dress(e: Enemy, role: UrukRole): void {
  const h = e.humanoid;
  const left = h.weaponObject('hand_l');
  if (role === 'archer') {
    if (left?.userData.kind !== 'uruk_bow') {
      if (left) (e as unknown as BaseCombatant).removeZonesOf(left);
      h.setWeapon('hand_l', 'uruk_bow');
    }
  } else if (role === 'pike' || role === 'blade') {
    if (left && left.userData.kind === 'shield') {
      (e as unknown as BaseCombatant).removeZonesOf(left);
      h.setWeapon('hand_l', 'none');
    }
  }
}

/**
 * A shield-bearer's shield hangs at his side, so its own armour disc rarely lies in the way of a frontal
 * arrow. This adds a disc in front of the torso (body-fixed, a little to the shield side): a frontal
 * body shot glances off with sparks, a head shot (above it) or a shot from the side lands.
 */
function guardFront(e: Enemy): void {
  const s = e.height / 1.85;
  const g = new THREE.Object3D();
  g.position.set(0.14 * s, 1.14 * s, 0.4 * s);
  e.object.add(g);
  (e as unknown as BaseCombatant).addZoneDisc(g, 0.46 * s, new THREE.Vector3(0, 0, 1), 'armor', 0.3);
}

/**
 * Loadout probe: after dressing, each role must hold what it is named for (archer: bow in the left hand; pike: a weapon in
 * the right and nothing in the left; blade: no shield; shield: a shield). A mismatch means the stock archetype loadouts
 * changed under `dress`; it is reported once per kind of mismatch, never thrown.
 */
const reported = new Set<string>();
export function loadoutOf(e: Enemy): { left: string | null; right: string | null } {
  const h = e.humanoid;
  return { left: (h.weaponObject('hand_l')?.userData.kind as string | undefined) ?? null, right: (h.weaponObject('hand_r')?.userData.kind as string | undefined) ?? null };
}
function verifyLoadout(e: Enemy, role: UrukRole): void {
  const { left, right } = loadoutOf(e);
  const ok =
    role === 'archer' ? left === 'uruk_bow' : role === 'pike' ? left === null && right !== null : role === 'blade' ? left !== 'shield' && right !== null : left === 'shield';
  const key = `${role}:${left}:${right}`;
  if (!ok && !reported.has(key)) {
    reported.add(key);
    console.warn(`[amon_hen] ${role} loadout is ${left ?? 'nothing'} / ${right ?? 'nothing'}: the stock Uruk loadouts changed, re-check dress() in amon_hen/uruks.ts`);
  }
}

const NAMES: Record<UrukRole, string> = { shield: 'Uruk-hai', blade: 'Uruk-hai', pike: 'Uruk pikeman', archer: 'Uruk archer' };

export function spawnUruk(level: LevelAPI, seeds: SeedPicker, role: UrukRole, pos: THREE.Vector3, o: UrukOpts = {}): Enemy {
  const spec: EnemySpec = {
    archetype: ARCHETYPE[role],
    seed: seeds.next(role),
    name: o.name ?? NAMES[role],
    behavior: o.behavior ?? (role === 'archer' ? 'hold' : 'charge'),
    hp: o.hp,
    damage: o.damage,
    speed: o.speed,
    target: o.target,
  };
  const e = level.spawnEnemy(spec, pos, o.facing);
  dress(e, role);
  verifyLoadout(e, role);
  if (role === 'shield') guardFront(e);
  return e;
}
