/**
 * Per-seed loadouts for the rank-and-file kinds (elf, man, rohirrim, gondor). The geometry of a
 * seed is one of four buckets (see common.bucketOf); weapon, off-hand, helmet and armour level are
 * chosen here, independent of the bucket, so every look appears with different weapons.
 */
import type { HumanoidKind, WeaponKind } from '../../../../core/types';
import { Rng, hashSeed } from '../../../../core/rng';
import { bucketOf } from './common';

export interface Loadout {
  weapon?: WeaponKind;
  offhand?: WeaponKind;
  helmet?: boolean;
  armor?: number;
}

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

function pick<T>(rng: Rng, list: [T, number][]): T {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let r = rng.float() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[0][0];
}

const TWO_HANDED: WeaponKind[] = ['spear', 'pike'];

/**
 * Weapon / off-hand / helmet / armour choice for a rank-and-file kind, deterministic in the seed.
 *   createHumanoid({ kind, seed, ...loadoutFor(kind, seed) })
 */
export function loadoutFor(kind: HumanoidKind, seed: number): Loadout {
  const rng = new Rng(hashSeed('elmen-loadout', kind, seed));
  const bucket = bucketOf(seed);
  switch (kind) {
    case 'elf': {
      // buckets 0 / 2: Mirkwood guard (glaive-like spear or bow, optional helm); 1 / 3: Galadhrim (longbow, helm)
      const galadhrim = bucket % 2 === 1;
      if (galadhrim) return { weapon: 'none', offhand: 'elven_bow', helmet: rng.float() < 0.75, armor: 0.75 };
      const bow = rng.float() < 0.5;
      return bow ? { weapon: 'none', offhand: 'elven_bow', helmet: rng.float() < 0.35, armor: 0.75 } : { weapon: 'spear', offhand: 'none', helmet: rng.float() < 0.5, armor: 0.75 };
    }
    case 'man': {
      const weapon = pick<WeaponKind>(rng, [['sword', 3], ['axe', 2], ['club', 1], ['spear', 2], ['mace', 0.6]]);
      return { weapon, offhand: TWO_HANDED.includes(weapon) ? 'none' : rng.float() < 0.3 ? 'shield' : 'none', helmet: rng.float() < 0.45, armor: pick(rng, [[0.25, 1], [0.5, 2], [0.75, 1]]) };
    }
    case 'rohirrim': {
      const weapon = pick<WeaponKind>(rng, [['sword', 3], ['spear', 3]]);
      return { weapon, offhand: TWO_HANDED.includes(weapon) ? 'none' : 'shield', helmet: rng.float() < 0.85, armor: pick(rng, [[0.5, 2], [0.75, 2]]) };
    }
    case 'gondor': {
      if (seed === 0) return { weapon: 'sword', offhand: 'shield', helmet: false, armor: 0.75 };
      const weapon = pick<WeaponKind>(rng, [['sword', 3], ['spear', 3]]);
      return { weapon, offhand: TWO_HANDED.includes(weapon) ? 'none' : 'shield', helmet: rng.float() < 0.85, armor: pick(rng, [[0.5, 1], [0.75, 2]]) };
    }
    default:
      return {};
  }
}
