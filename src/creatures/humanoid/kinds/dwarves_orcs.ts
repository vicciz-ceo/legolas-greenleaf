/**
 * dwarves_orcs: gimli, dwarf, orc, goblin, gundabad, easterling, haradrim.
 *
 * The definitions live in ./dwarves_orcs/*.ts. This file registers them and exports
 * `loadoutFor(kind, seed)`: a deterministic per-seed weapon / helmet / armour choice that
 * gameplay can pass to `createHumanoid` so rank-and-file enemies differ visibly (the geometry
 * itself varies across the four seed buckets, see `seedForBucket`).
 */
import type { HumanoidKind, WeaponKind } from '../../../core/types';
import { Rng, hashSeed } from '../../../core/rng';
import type { KindDef } from '../types';
import { bucketOf } from './dwarves_orcs/common';
import { dwarfDef } from './dwarves_orcs/dwarf';
import { gimliDef } from './dwarves_orcs/gimli';
import { easterlingDef } from './dwarves_orcs/easterling';
import { goblinDef } from './dwarves_orcs/goblin';
import { gundabadDef } from './dwarves_orcs/gundabad';
import { haradrimDef } from './dwarves_orcs/haradrim';
import { orcDef } from './dwarves_orcs/orc';

export interface Loadout {
  weapon?: WeaponKind;
  offhand?: WeaponKind;
  helmet?: boolean;
  armor?: number;
}

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  gimli: gimliDef,
  dwarf: dwarfDef,
  orc: orcDef,
  goblin: goblinDef,
  gundabad: gundabadDef,
  easterling: easterlingDef,
  haradrim: haradrimDef,
};

const seedMemo = new Map<number, number>();
/** a small seed that maps to a given geometry bucket (0..3) */
export function seedForBucket(bucket: number): number {
  const hit = seedMemo.get(bucket);
  if (hit !== undefined) return hit;
  let s = bucket === 0 ? 0 : 1;
  while (bucketOf(s) !== bucket) s++;
  seedMemo.set(bucket, s);
  return s;
}

interface Pool {
  weapons: [WeaponKind, number][];
  /** chance of an off-hand shield */
  shield?: number;
  /** chance of wearing a helmet (undefined = the kit default) */
  helmet?: number;
  armor?: number[];
}

/** weapon / helmet / armour pools per kind (weights are relative) */
const POOLS: Partial<Record<HumanoidKind, Pool>> = {
  orc: { weapons: [['scimitar', 4], ['cleaver', 3], ['axe', 1], ['spear', 2], ['club', 1.5], ['mace', 1]], shield: 0.18, helmet: 0.55, armor: [0.5, 1] },
  goblin: { weapons: [['cleaver', 3], ['scimitar', 3], ['spear', 3], ['club', 1]], shield: 0.08, helmet: 0.4, armor: [0.5] },
  gundabad: { weapons: [['warhammer', 3], ['mace', 2], ['cleaver', 3], ['axe', 1.5]], shield: 0.12, helmet: 0.8, armor: [0.5, 1] },
  easterling: { weapons: [['spear', 4], ['sword', 3], ['scimitar', 2]], shield: 0.85, helmet: 0.85, armor: [0.5, 1] },
  haradrim: { weapons: [['scimitar', 4], ['spear', 3], ['sword', 1]], shield: 0.2, helmet: 0.5, armor: [0.5, 1] },
  dwarf: { weapons: [['axe', 3], ['dwarf_axe', 2], ['warhammer', 2], ['mace', 1.5], ['club', 1], ['sword', 1]], shield: 0.25, helmet: 0.0, armor: [0.5] },
};

/**
 * Weapon / off-hand / helmet / armour choice for a rank-and-file kind, deterministic in the seed
 * and independent of the geometry bucket (so a bucket's look appears with different weapons and
 * with or without a helmet). Pass the result to `createHumanoid`:
 *   createHumanoid({ kind, seed, ...loadoutFor(kind, seed) })
 * Cached geometry variants per kind: 4 buckets x helmet on/off x up to 2 armour levels.
 * Dwarves only wear a helmet when `helmet: true` is passed (the barrel dwarves are bare-headed or hatted).
 */
export function loadoutFor(kind: HumanoidKind, seed: number): Loadout {
  const pool = POOLS[kind];
  if (!pool) return {};
  const rng = new Rng(hashSeed('loadout', kind, seed));
  const total = pool.weapons.reduce((a, [, w]) => a + w, 0);
  let r = rng.float() * total;
  let weapon: WeaponKind = pool.weapons[0][0];
  for (const [k, w] of pool.weapons) {
    r -= w;
    if (r <= 0) {
      weapon = k;
      break;
    }
  }
  const out: Loadout = { weapon };
  const twoHanded = weapon === 'spear' || weapon === 'pike' || weapon === 'warhammer';
  if (pool.shield && !twoHanded && rng.float() < pool.shield) out.offhand = 'shield';
  else if (twoHanded) out.offhand = 'none';
  if (pool.helmet !== undefined) out.helmet = rng.float() < pool.helmet ? true : kind === 'dwarf' ? undefined : false;
  if (pool.armor) out.armor = pool.armor[Math.floor(rng.float() * pool.armor.length)];
  return out;
}
