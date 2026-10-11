/**
 * Player stat modifiers (PlayerAPI.addModifier, finishing pass). Pure helpers, kept apart from
 * player.ts so the unit tests can import them without the character pipeline.
 */
import type { PlayerModifier, PlayerStats } from '../core/types';

/** fold timed modifiers into a stats object (multipliers stack multiplicatively) */
export function applyModifiers(base: PlayerStats, mods: readonly PlayerModifier[]): PlayerStats {
  if (!mods.length) return base;
  let move = 1;
  let dmg = 1;
  let draw = 1;
  for (const m of mods) {
    move *= m.moveSpeedMul ?? 1;
    dmg *= m.damageTakenMul ?? 1;
    draw *= m.drawTimeMul ?? 1;
  }
  return { ...base, moveSpeed: base.moveSpeed * move, damageTakenMul: base.damageTakenMul * dmg, drawTime: base.drawTime * draw };
}
