/**
 * Humanoid factory for gameplay actors: the kit's `createHumanoid`, with the capsule stand-in
 * (src/actors/_standin.ts) as a runtime fallback if building a kind ever throws.
 */
import type { Humanoid, HumanoidSpec } from '../core/types';
import { createHumanoid } from '../creatures/humanoid';
import { createStandinHumanoid } from './_standin';

let kitBroken = false;

export function makeHumanoid(spec: HumanoidSpec): Humanoid {
  if (!kitBroken) {
    try {
      return createHumanoid(spec);
    } catch (e) {
      kitBroken = true;
      console.warn('[actors] createHumanoid failed, using capsule stand-ins:', e);
    }
  }
  return createStandinHumanoid(spec);
}

export const usingStandins = () => kitBroken;
