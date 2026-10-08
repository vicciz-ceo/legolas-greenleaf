/**
 * The cinematic menu backdrop (owner: shell): Legolas on a mossy ledge above the Forest River at a
 * misty golden dawn, built ENTIRELY from the world builders (terrain, carved river, instanced
 * forest, grass, ferns, boulders, a fallen log) so it doubles as a compact example of composing a
 * vista. Rendered behind the title and every menu, so it is kept cheap: a modest terrain grid,
 * instanced vegetation with short LOD distances, grass only near the hero, no colliders except
 * the ground the hero stands on.
 *
 * Layout (metres, +Y up): the hero stands at the origin on a mossy ledge, looking out across the
 * river (+Z) and a little downstream (+X); the river flows along +X about 13 m in front of him; the
 * far bank is a wall of beech and oak in the mist; the sun rises low behind it, so light shafts and
 * the fog glow face the camera, which swings slowly behind his left shoulder (see game.ts orbit()).
 */
import * as THREE from 'three';
import { fbm2 } from '../core/rng';
import { smoothstep } from '../core/math';
import { boulderField, buildTerrain, carveRiver, fallenLog, ferns, forest, grassField, Path, river, tree } from '../world';

export interface MenuBackdrop {
  root: THREE.Group;
  /** where Legolas stands (feet) */
  hero: THREE.Vector3;
  /** yaw Legolas faces */
  heroFacing: number;
  heightAt(x: number, z: number): number;
}

/** river centre line: gentle meander along +X in front of the hero */
const RIVER_PTS: [number, number][] = [[-160, 34], [-90, 22], [-40, 15], [0, 16], [40, 21], [90, 16], [160, 26]];
const RIVER_Y = -1.1;
const riverWidth = (s: number): number => 19 + Math.sin(s * 0.021) * 3;

export function buildMenuBackdrop(): MenuBackdrop {
  const root = new THREE.Group();
  root.name = 'menu-backdrop';
  // a coarse sampling step: nearest() is a linear scan and runs for every terrain vertex
  const path = new Path(RIVER_PTS, { y: RIVER_Y, step: 2 });

  // ground: rolling banks that climb into the forest, a raised mossy ledge for the hero
  const base = (x: number, z: number): number => {
    const roll = fbm2(x * 0.018, z * 0.018, 4, 31) * 4.2 + fbm2(x * 0.08, z * 0.08, 2, 5) * 0.45;
    // both banks rise away from the water; the far bank higher, for a wall of trees in the mist
    const n = path.nearest(x, z);
    const far = n.signed > 0; // the +Z bank
    const away = Math.max(0, n.dist - (far ? 12 : 24));
    const rise = far ? 0.12 : 0.1;
    const dHero = Math.hypot(x, z - 0.6);
    const ledge = 1.15 * (1 - smoothstep(2.2, 6.5, dHero));
    // a gentle, open bank around the hero; rolling ground further out
    const calm = 0.25 + 0.75 * smoothstep(10, 45, dHero);
    return roll * calm * smoothstep(4, 30, n.dist) + away * rise + ledge;
  };
  const height = carveRiver(base, path, riverWidth, { depth: 1.7, bank: 5 });
  const terrain = buildTerrain({ size: 300, segments: 120, height, style: 'riverbank', theme: 'wet', center: [0, 10], patchiness: 0.35 });
  root.add(terrain.mesh);
  const h = terrain.heightAt;

  const water = river(RIVER_PTS, riverWidth, { y: RIVER_Y, terrain: h, depth: 1.7, speed: 1.6, foam: 0.3, step: 2 });
  root.add(water.object);

  // keep the hero's ledge, the camera arc and the river itself free of trunks
  const nearHero = (x: number, z: number, r: number) => Math.hypot(x, z) < r;
  const inRiver = (x: number, z: number) => path.nearest(x, z).dist < riverWidth(0) * 0.5 + 3;
  // the far bank: a belt of beech, birch and pine across the water, then old oaks and pines
  // climbing into the mist behind them, backlit by the rising sun. Every tree there is 25 m+ from
  // the camera, so a short full-detail range keeps the triangle count low.
  const farBelt = forest(
    { center: new THREE.Vector3(10, 0, 52), halfSize: [130, 18] },
    170,
    [{ kind: 'beech', weight: 3 }, { kind: 'birch', weight: 1 }, { kind: 'pine', weight: 1 }],
    h,
    { seed: 11, exclude: (x, z) => path.nearest(x, z).dist < 17, colliders: false, lodNear: 30, lodFar: 220, spacing: 1.5, chunk: 96 },
  );
  farBelt.object.name = 'far-belt';
  root.add(farBelt.object);
  const farDeep = forest(
    { center: new THREE.Vector3(10, 0, 92), halfSize: [140, 24] },
    120,
    [{ kind: 'mirkwood_oak', weight: 1 }, { kind: 'pine', weight: 2 }, { kind: 'beech', weight: 1 }],
    h,
    { seed: 13, colliders: false, lodNear: 30, lodFar: 240, spacing: 2, chunk: 96 },
  );
  farDeep.object.name = 'far-deep';
  // too far away for their shadows to matter, and the low sun would drag all of them into the map
  farDeep.object.traverse((o) => (o.castShadow = false));
  root.add(farDeep.object);
  // the near bank behind the hero (seen when the camera swings): thinner, with a clearing around him
  const nearBank = forest(
    { center: new THREE.Vector3(0, 0, -42), halfSize: [110, 30] },
    60,
    [{ kind: 'beech', weight: 2 }, { kind: 'mirkwood_oak', weight: 2 }, 'birch'],
    h,
    { seed: 12, exclude: (x, z) => inRiver(x, z) || nearHero(x, z, 18), colliders: false, lodNear: 24, lodFar: 180 },
  );
  nearBank.object.name = 'near-bank';
  root.add(nearBank.object);
  // two hand-placed framing trees at the edges of frame (kept clear of the camera arc: an oak's
  // buttress roots spread several metres)
  for (const [kind, x, z, seed, sc] of [['beech', -9.5, 10, 2, 1.1], ['beech', 13, 6, 1, 1.0]] as const) {
    const t = tree(kind, seed);
    t.object.position.set(x, h(x, z) - 0.3, z);
    t.object.scale.setScalar(sc);
    t.object.rotation.y = seed * 1.7;
    root.add(t.object);
  }

  // ground cover, densest around the hero where the camera looks
  root.add(grassField({ center: new THREE.Vector3(1, 0, 1), halfSize: [18, 11] }, 1.6, h, { seed: 3, height: [0.25, 0.55], fade: [14, 26], exclude: (x, z) => inRiver(x, z) || nearHero(x, z, 1.6), dry: 0.15 }));
  root.add(ferns({ center: new THREE.Vector3(0, 0, -2), halfSize: [26, 12] }, 110, h, { seed: 4, exclude: (x, z) => inRiver(x, z) || nearHero(x, z, 2.4), clump: 0.6 }));
  root.add(ferns({ center: new THREE.Vector3(10, 0, 33), halfSize: [60, 6] }, 80, h, { seed: 5, exclude: inRiver, clump: 0.5 }));

  // mossy boulders along both banks and in the shallows, a few under the hero's ledge, a fallen trunk
  root.add(boulderField({ center: new THREE.Vector3(5, 0, 16), halfSize: [60, 14] }, 40, [0.35, 1.5], h, { seed: 7, moss: 0.7, colliderMin: 99, clump: 0.6, exclude: (x, z) => nearHero(x, z, 3) }).object);
  root.add(boulderField({ center: new THREE.Vector3(1.6, 0, 2.2), halfSize: [3, 2] }, 5, [0.3, 0.7], h, { seed: 8, moss: 0.9, colliderMin: 99, clump: 0.9, exclude: (x, z) => nearHero(x, z, 1.4) }).object);
  const log = fallenLog(9, 0.55, 3, { mossy: true });
  log.object.position.set(9.5, h(9.5, 5.5) + 0.2, 5.5);
  log.object.rotation.y = -0.6;
  root.add(log.object);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m !== terrain.mesh && !(m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) m.receiveShadow = true;
  });

  const hero = new THREE.Vector3(0, h(0, 0), 0);
  return { root, hero, heroFacing: 0.4, heightAt: h };
}
