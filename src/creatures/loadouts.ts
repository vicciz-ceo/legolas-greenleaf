/**
 * Per-seed loadouts: one entry point over the dressers' loadout helpers, so gameplay spawns
 * show the visual variety designed into each kind (helmet on/off, armour level, shield,
 * weapon choice) without breaking archetype behaviour.
 *
 * Rule: the archetype's weapon defines its AI (archers need bows, pike-men hold), so the
 * weapon is only swapped for melee fighters and only for another melee weapon.
 */
import type { HumanoidKind, HumanoidSpec, WeaponKind } from '../core/types';
import { loadoutFor as dwarvesOrcsLoadout } from './humanoid/kinds/dwarves_orcs';
import { loadoutFor as elvesMenLoadout } from './humanoid/kinds/elves_men';
import { trollVariant } from './humanoid/kinds/uruks_bosses';
import { urukLoadout } from './humanoid/kinds/uruks_bosses/uruk';

const MELEE: ReadonlySet<WeaponKind> = new Set<WeaponKind>([
  'sword', 'elven_sword', 'scimitar', 'cleaver', 'axe', 'dwarf_axe', 'mace', 'club', 'warhammer', 'spear',
]);

const DWARVES_ORCS: ReadonlySet<HumanoidKind> = new Set<HumanoidKind>(['dwarf', 'orc', 'goblin', 'gundabad', 'easterling', 'haradrim']);
const ELVES_MEN: ReadonlySet<HumanoidKind> = new Set<HumanoidKind>(['elf', 'man', 'rohirrim', 'gondor']);

type Loadout = Pick<HumanoidSpec, 'weapon' | 'offhand' | 'helmet' | 'armor'>;

function rawLoadout(kind: HumanoidKind, seed: number): Loadout {
  if (DWARVES_ORCS.has(kind)) return dwarvesOrcsLoadout(kind, seed);
  if (ELVES_MEN.has(kind)) return elvesMenLoadout(kind, seed);
  if (kind === 'uruk') return urukLoadout(seed, 'uruk');
  if (kind === 'troll') return trollVariant(seed) === 'war' ? { weapon: 'warhammer' } : { weapon: 'club' };
  return {};
}

/**
 * Merge a kind's per-seed loadout into a base spec.
 * @param base     spec built from the archetype / ally table
 * @param melee    true when the actor fights in melee (its weapon may be swapped)
 * @param explicit fields the caller set explicitly (e.g. a chapter's EnemySpec.weapon) — never overridden
 */
export function applyLoadout(base: HumanoidSpec, melee: boolean, explicit: { weapon?: boolean; offhand?: boolean } = {}): HumanoidSpec {
  const seed = base.seed ?? 0;
  let lo: Loadout;
  try {
    lo = rawLoadout(base.kind, seed);
  } catch (e) {
    console.warn(`[loadouts] ${base.kind} loadout failed`, e);
    return base;
  }
  const out: HumanoidSpec = { ...base };
  if (lo.helmet !== undefined && base.helmet === undefined) out.helmet = lo.helmet;
  if (lo.armor !== undefined && base.armor === undefined) out.armor = lo.armor;
  if (melee && !explicit.weapon && lo.weapon && MELEE.has(lo.weapon) && (!base.weapon || MELEE.has(base.weapon))) {
    out.weapon = lo.weapon;
  }
  if (melee && !explicit.offhand && lo.offhand && (lo.offhand === 'shield' || lo.offhand === 'none') && base.offhand !== 'elven_bow') {
    out.offhand = lo.offhand;
  }
  // war trolls carry the warhammer even when the archetype says club
  if (base.kind === 'troll' && !explicit.weapon && lo.weapon) out.weapon = lo.weapon;
  return out;
}
