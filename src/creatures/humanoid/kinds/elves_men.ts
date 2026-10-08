/**
 * elves_men: tauriel, elf, thranduil, aragorn, man, rohirrim, gondor.
 *
 * The definitions live in ./elves_men/*.ts. This file registers them and exports
 * `loadoutFor(kind, seed)`: a deterministic per-seed weapon / helmet / armour choice that
 * gameplay can pass to `createHumanoid` so rank-and-file characters differ visibly (the geometry
 * itself varies across the four seed buckets, see `seedForBucket`).
 */
import type { HumanoidKind } from '../../../core/types';
import type { KindDef } from '../types';
import { taurielDef } from './elves_men/tauriel';
import { thranduilDef } from './elves_men/thranduil';

export { loadoutFor, seedForBucket, type Loadout } from './elves_men/loadout';

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  tauriel: taurielDef,
  thranduil: thranduilDef,
};
