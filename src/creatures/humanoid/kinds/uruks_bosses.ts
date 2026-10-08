/**
 * Group `uruks_bosses`: Saruman's Uruk-hai, the Helm's Deep berserker, Lurtz, Bolg and the trolls
 * (Moria cave troll / Mordor war troll, chosen by seed bucket). See `./uruks_bosses/`.
 */
import type { HumanoidKind } from '../../../core/types';
import type { KindDef } from '../types';
import { urukKinds } from './uruks_bosses/uruk';
import { lurtzKind } from './uruks_bosses/lurtz';
import { bolgKind } from './uruks_bosses/bolg';
import { trollKind } from './uruks_bosses/troll';

export { bucketOf, seedForBucket } from './uruks_bosses/common';
export { trollVariant, type TrollVariant } from './uruks_bosses/troll';

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  uruk: urukKinds.uruk,
  berserker: urukKinds.berserker,
  lurtz: lurtzKind,
  bolg: bolgKind,
  troll: trollKind,
};
