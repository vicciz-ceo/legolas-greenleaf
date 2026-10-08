/**
 * The cast of the Black Gate: enemy spec factories (orcs, Easterlings, archers, war trolls) and the
 * soldiers of the West. War trolls are the `troll` archetype with a seed in bucket 2 or 3 (the kit's
 * "war" variant: plate, warhammer).
 */
import * as THREE from 'three';
import type { Ally, EnemySpec, LevelAPI } from '../../../core/types';
import { bucketOf } from '../../../creatures/humanoid/kinds/uruks_bosses';
import { L, V } from './layout';

/** n-th seed that falls into a war-troll bucket (2 or 3) */
export function warSeed(n: number): number {
  let found = 0;
  for (let s = 1; s < 20000; s++) {
    if (bucketOf(s) >= 2 && found++ === n) return s;
  }
  return 3;
}

export const orc = (o: Partial<EnemySpec> = {}): EnemySpec => ({ archetype: 'orc', ...o });
export const orcArcher = (): EnemySpec => ({ archetype: 'orc_archer', behavior: 'hold' });
/** Easterlings carry shield and sword, and some a spear */
export const easterling = (spear = false): EnemySpec => (spear ? { archetype: 'easterling', weapon: 'spear' } : { archetype: 'easterling' });
export const warTroll = (n: number, hp: number, name = 'War Troll'): EnemySpec => ({ archetype: 'troll', seed: warSeed(n), hp, name, boss: true, scale: 1 });

/** the soldiers who stand with the player: Gondor and Rohan, anchored around the saddle */
export function spawnSoldiers(level: LevelAPI, ground: (x: number, z: number) => number, facing: number): Ally[] {
  const out: Ally[] = [];
  const G = (p: THREE.Vector3) => V(p.x, ground(p.x, p.z), p.z);
  L.gondor.forEach((p, i) => out.push(level.spawnAlly({ kind: 'gondor', name: i % 2 ? 'Soldier of Gondor' : 'Guard of the Citadel', anchor: G(p) }, G(p), facing)));
  L.rohan.forEach((p) => out.push(level.spawnAlly({ kind: 'rohirrim', name: 'Rider of Rohan', anchor: G(p) }, G(p), facing)));
  return out;
}
