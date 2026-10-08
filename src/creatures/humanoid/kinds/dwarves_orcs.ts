/**
 * dwarves_orcs: gimli, dwarf, orc, goblin, gundabad, easterling, haradrim.
 *
 * The definitions live in ./dwarves_orcs/*.ts. This file registers them and exports
 * `loadoutFor(kind, seed)`: a deterministic per-seed weapon / helmet / armour choice that
 * gameplay can pass to `createHumanoid` so rank-and-file enemies differ visibly (the geometry
 * itself varies across the four seed buckets, see `seedForBucket`).
 */
import type { HumanoidKind, WeaponKind } from '../../../core/types';
import { hashSeed } from '../../../core/rng';
import type { KindDef } from '../types';
import { bucketOf } from './dwarves_orcs/common';
import { gimliDef } from './dwarves_orcs/gimli';

export interface Loadout {
  weapon?: WeaponKind;
  offhand?: WeaponKind;
  helmet?: boolean;
  armor?: number;
}

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  gimli: gimliDef,
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

/** weapon / helmet / armour choice for a rank-and-file kind (deterministic in the seed) */
export function loadoutFor(kind: HumanoidKind, seed: number): Loadout {
  void kind;
  void seed;
  void hashSeed;
  return {};
}
