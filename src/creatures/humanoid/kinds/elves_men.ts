/**
 * elves_men: tauriel, elf, thranduil, aragorn, man, rohirrim, gondor.
 *
 * The definitions live in ./elves_men/*.ts (one file per kind plus shared helpers). This file
 * registers them and re-exports `loadoutFor(kind, seed)`: a deterministic per-seed weapon /
 * off-hand / helmet / armour choice that gameplay passes to `createHumanoid`, so rank-and-file
 * characters differ visibly (the geometry itself varies across the four seed buckets, see
 * `seedForBucket`):
 *
 *   const lo = loadoutFor('rohirrim', seed);
 *   createHumanoid({ kind: 'rohirrim', seed, ...lo });
 *
 * Fixed (named) characters ignore the seed: tauriel, thranduil, aragorn.
 *
 * Seed buckets (bucket = kit `seedBucket(seed)`; seed 0 is always bucket 0, seeds 2, 3, 4 are buckets 1, 2, 3):
 *   elf       0 Mirkwood guard (green, bronze leaf armour) · 1 Galadhrim (gold, red cloak, blond)
 *             2 Mirkwood guard (amber, auburn hair) · 3 Galadhrim (gold, red cloak, black hair)
 *             Mirkwood guards carry a glaive (the kit spear + a curved leaf blade) or a bow; Galadhrim a longbow
 *   man       0 fisherman (wool cap) · 1 guard (quilted jacket, iron cap) · 2 soldier (mail + leather jerkin) · 3 old hand (long coat, grey beard)
 *   rohirrim  0 green tunic, blond, white crest · 1 brown tunic, black crest · 2 chestnut crest, scar · 3 grey veteran
 *   gondor    0 CAPTAIN / Boromir: bare-headed, brown hair, beard, fur-collared cloak, Horn of Gondor (no helm whatever the flag says)
 *             1-3 soldiers: black surcoat with the white tree, tall winged helm (helmet flag), varied faces
 *
 * Boromir is `BOROMIR` (seed 0 of 'gondor'). Because the kit caches geometry per seed BUCKET, every
 * other seed that hashes to bucket 0 (1, 5, 9, 12, ...) shows the same captain look: pick Gondor
 * soldier seeds with `soldierSeed(n)` (never bucket 0) when Boromir is on screen.
 *
 * Triangles (LOD0, everything visible except held weapons): regular kinds 8-13 k, named 20-26 k.
 * `HumanoidExt.triangles` reports less (the kit counts body + kit hair + eyes only; our hair, cloaks
 * and hem panels are extra skinned meshes sharing the body skeleton and material).
 */
import type { HumanoidKind, HumanoidSpec } from '../../../core/types';
import type { KindDef } from '../types';
import { bucketOf } from './elves_men/common';
import { taurielDef } from './elves_men/tauriel';
import { thranduilDef } from './elves_men/thranduil';
import { aragornDef } from './elves_men/aragorn';
import { elfDef } from './elves_men/elf';
import { manDef } from './elves_men/man';
import { rohirrimDef } from './elves_men/rohirrim';
import { gondorDef } from './elves_men/gondor';

export { loadoutFor, seedForBucket, type Loadout } from './elves_men/loadout';

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  tauriel: taurielDef,
  thranduil: thranduilDef,
  aragorn: aragornDef,
  elf: elfDef,
  man: manDef,
  rohirrim: rohirrimDef,
  gondor: gondorDef,
};

/** Boromir: the captain look of the 'gondor' kind (bare-headed, fur-collared cloak, Horn of Gondor) */
export const BOROMIR: HumanoidSpec = { kind: 'gondor', seed: 0, weapon: 'sword', offhand: 'shield', helmet: false, armor: 0.75 };

/** the n-th small seed that is NOT the captain bucket (use for Gondor soldiers so none looks like Boromir) */
export function soldierSeed(n: number): number {
  let found = -1;
  for (let s = 1; ; s++) {
    if (bucketOf(s) === 0) continue;
    if (++found === n) return s;
  }
}
