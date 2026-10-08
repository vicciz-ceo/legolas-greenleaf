/**
 * The Fellowship in the chamber: Gimli (the rivalry), Aragorn and Boromir.
 *
 * Boromir is the Captain look of the 'gondor' kind (BOROMIR in src/creatures/humanoid/kinds/elves_men.ts:
 * bare-headed, fur-collared cloak, the Horn of Gondor). AllySpec has no seed, and the ally factory
 * derives its seed from (kind, x, y of the spawn point to 0.1 m), so `boromirSpot` nudges the spawn
 * point by a few decimetres until that seed lands in geometry bucket 0, the Boromir bucket.
 */
import * as THREE from 'three';
import type { Ally, LevelAPI } from '../../../core/types';
import { hashSeed } from '../../../core/rng';
import { bucketOf } from '../../../creatures/humanoid/kinds/elves_men/common';

/** the nearest point to (x, z) whose ally seed falls in bucket 0 for this kind */
export function bucketSpot(kind: string, x: number, z: number, bucket = 0): { x: number; z: number } {
  for (let r = 0; r < 12; r++) {
    for (let k = 0; k < (r === 0 ? 1 : 8); k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = Math.round((x + Math.cos(a) * r * 0.1) * 10) / 10;
      const pz = Math.round((z + Math.sin(a) * r * 0.1) * 10) / 10;
      if (bucketOf(hashSeed('ally', kind, px.toFixed(1), pz.toFixed(1))) === bucket) return { x: px, z: pz };
    }
  }
  return { x, z };
}

export interface Cast {
  gimli: Ally;
  aragorn: Ally;
  boromir: Ally;
}

/**
 * Spawn the three allies. `at` positions are nominal; Gimli follows the player, Aragorn and Boromir
 * hold anchors (they fight whatever comes within reach of them).
 */
export function spawnCast(
  level: LevelAPI,
  p: { gimli: THREE.Vector3; aragorn: THREE.Vector3; boromir: THREE.Vector3; aragornAnchor?: THREE.Vector3; boromirAnchor?: THREE.Vector3 },
  facing: number,
): Cast {
  const gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: 'player' }, p.gimli, facing);
  const aragorn = level.spawnAlly({ kind: 'aragorn', anchor: p.aragornAnchor ?? p.aragorn }, p.aragorn, facing);
  const b = bucketSpot('gondor', p.boromir.x, p.boromir.z, 0);
  const boromir = level.spawnAlly({ kind: 'gondor', name: 'Boromir', anchor: p.boromirAnchor ?? p.boromir }, new THREE.Vector3(b.x, p.boromir.y, b.z), facing);
  // keep the race within a few kills of each other (the shell resets this on every load)
  level.ctx.rivalry.autoGimli = true;
  return { gimli, aragorn, boromir };
}
