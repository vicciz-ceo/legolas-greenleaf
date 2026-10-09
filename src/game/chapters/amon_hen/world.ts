/**
 * The wooded hill of Amon Hen, built from the world builders: autumn forest floor, beech and birch
 * in golden haze, the stream at the foot, the clearing, the mossy Numenorean ruins on the terrace,
 * and the Seat of Seeing on the summit.
 *
 * `buildAmonHen(level)` returns the pieces the script needs (heights, the water, the trunks, so
 * spawns can keep out of them).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { Rng } from '../../../core/rng';
import {
  addColliders, amonHenSummit, banner, boulderField, fallenLog, ferns, forest, grassField, mat, mushrooms, pillar, river, rock, ruins, statue, stairs, stoneWall,
  tree, type Built, type WaterBody,
} from '../../../world';
import {
  CLEARING, FLIGHTS, L, RUINS, SEAT, STREAM_PTS, STREAM_W, ground, inClearing, inRuins, nearRoute, streamDist,
} from './layout';
import { driftingLeaves, fallenLeaves } from './leaves';
import { distantRidge, groundCover } from './cover';
import { fbm2 } from '../../../core/rng';

export interface Trunk {
  x: number;
  z: number;
  r: number;
}

export interface AmonHenWorld {
  heightAt(x: number, z: number): number;
  water: WaterBody;
  /** every trunk and big prop footprint (for spawn placement) */
  trunks: Trunk[];
}

/**
 * Weather a built prop: swap its (shared, cached) materials for tinted clones, so pale marble and
 * limestone read as old, mossy stone in the golden light. Clones are cached per source material, so
 * instancing and draw-call merging are untouched, and the shell disposes them with the level.
 */
const tinted = new WeakMap<THREE.Material, THREE.Material>();
function weather(obj: THREE.Object3D, rgb: [number, number, number]): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.Material;
    if (Array.isArray(src)) return;
    let t = tinted.get(src);
    if (!t) {
      t = src.clone();
      t.userData = { ...t.userData, shared: false };
      const c = (t as THREE.MeshStandardMaterial).color;
      if (c) c.multiply(new THREE.Color(rgb[0], rgb[1], rgb[2]));
      tinted.set(src, t);
    }
    m.material = t;
  });
}

/** distance from (x, z) to the nearest flight of stairs' centre line */
function nearFlight(x: number, z: number, pad: number): boolean {
  for (const f of FLIGHTS) {
    const dx = f.to[0] - f.from[0];
    const dz = f.to[1] - f.from[1];
    const l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - f.from[0]) * dx + (z - f.from[1]) * dz) / l2));
    if (Math.hypot(x - (f.from[0] + dx * t), z - (f.from[1] + dz * t)) < f.width / 2 + pad) return true;
  }
  return false;
}

export function buildAmonHen(level: LevelAPI): AmonHenWorld {
  const { physics } = level.ctx;
  const rng = new Rng(61);
  const trunks: Trunk[] = [];

  // ── terrain ────────────────────────────────────────────────────────────
  const terrain = level.terrain({
    size: 360, segments: 160, height: ground, style: 'forest', theme: 'autumn', material: 'leaves', center: [0, 28], patchiness: 0.6, cavity: 0.55,
    // a touch of green out of the orange litter, so the upper hill and the far bank read as woodland floor, not desert
    tint: 0xd9e0c6,
  });
  const h = terrain.heightAt;

  /** place a single prop at the ground (built at the origin: place first, colliders with the object) */
  const place = (b: Built, x: number, z: number, yaw = 0, y?: number): Built => {
    b.object.position.set(x, y ?? h(x, z), z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    b.object.updateMatrixWorld(true);
    addColliders(physics, b.colliders, b.object);
    return b;
  };

  // ── the stream ─────────────────────────────────────────────────────────
  const water = river(STREAM_PTS, STREAM_W, {
    speed: 1.1, color: 0x2c4a44, shallow: 0x6f8f78, depth: 1.0, foam: 0.3, ripple: 0.8, terrain: h, opacity: 0.95,
  });
  level.root.add(water.object);

  // ── woods ──────────────────────────────────────────────────────────────
  // the host of Isengard stands on the far bank: no trunks in its footprint (the wood stands behind and beside it)
  const inHost = (x: number, z: number): boolean => x > -54 && x < 70 && z > -138 && z < -114;
  // the summit: the Seat's disc stays open, and a broad lane up the great stair to it (the intro looks along it)
  const onSummit = (x: number, z: number): boolean => Math.hypot(x - SEAT.x, z - SEAT.z) < 27 || (z > 112 && z < SEAT.z && Math.abs(x - 2) < 13);
  const keepClear = (x: number, z: number): boolean =>
    nearRoute(x, z, 5.5) || inClearing(x, z, -2) || inRuins(x, z, -6) || streamDist(x, z) < 6 || onSummit(x, z) || inHost(x, z) || nearFlight(x, z, 3) || Math.hypot(x - L.spawn.x, z - L.spawn.z) < 7 || Math.hypot(x - L.boromir.x, z - L.boromir.z) < 13;
  /** where the player and the fights are: full-detail trees. Beyond it the wood is only ever seen from afar */
  const nearField = (x: number, z: number): boolean => nearRoute(x, z, 34) || inClearing(x, z, 16) || inRuins(x, z, 14);
  // the wood now climbs round the summit plateau and across the stream (z -148 .. 202)
  const area = { center: new THREE.Vector3(0, 0, 27), halfSize: [165, 175] as [number, number] };
  const KINDS = [{ kind: 'beech' as const, weight: 5 }, { kind: 'birch' as const, weight: 2.4 }, { kind: 'pine' as const, weight: 1.4 }];
  // the near wood: full-detail trees close to the player (two variants per kind), the golden beechwood
  const beech = forest(area, 175, KINDS, h, {
    seed: 6, scale: [1.05, 1.6], spacing: 1.5, variants: 2, exclude: (x, z) => keepClear(x, z) || !nearField(x, z), chunk: 48, lodNear: 30, lodFar: 185, leafTint: [1.22, 1.06, 0.62],
  });
  level.root.add(beech.object);
  addColliders(physics, beech.colliders);
  // the far wood: the same trees at their simplified level only (always beyond ~20 m, in the haze), few big chunks
  const mixed = forest(area, 400, KINDS, h, {
    seed: 17, scale: [1.0, 1.55], spacing: 1.5, variants: 1, exclude: (x, z) => keepClear(x, z) || nearField(x, z), chunk: 80, lodNear: 1, lodFar: 185, leafTint: [1.22, 1.06, 0.62],
  });
  level.root.add(mixed.object);
  addColliders(physics, mixed.colliders);
  for (const t of [...beech.trees, ...mixed.trees]) trunks.push({ x: t.x, z: t.z, r: t.radius });
  // the summit wood (round the plateau, in sight of the intro's first shot) and the far bank's wood (behind the host): more
  // trees here, near-detail within 45 m, so neither edge of the world reads as an empty horizon
  const summitWood = forest({ center: new THREE.Vector3(0, 0, 168), halfSize: [120, 36] }, 150, KINDS, h, {
    seed: 31, scale: [1.05, 1.6], spacing: 1.6, variants: 2, exclude: (x, z) => keepClear(x, z) || Math.hypot(x - SEAT.x, z - SEAT.z) < 30, chunk: 60, lodNear: 45, lodFar: 190, leafTint: [1.18, 1.08, 0.7],
  });
  level.root.add(summitWood.object);
  addColliders(physics, summitWood.colliders);
  const bankWood = forest({ center: new THREE.Vector3(0, 0, -132), halfSize: [150, 20] }, 140, KINDS, h, {
    seed: 33, scale: [1.0, 1.55], spacing: 1.6, variants: 1, exclude: (x, z) => keepClear(x, z) || streamDist(x, z) < 8, chunk: 70, lodNear: 1, lodFar: 190, leafTint: [1.18, 1.08, 0.7],
  });
  level.root.add(bankWood.object);
  addColliders(physics, bankWood.colliders);
  for (const t of [...summitWood.trees, ...bankWood.trees]) trunks.push({ x: t.x, z: t.z, r: t.radius });


  level.root.add(ferns({ center: new THREE.Vector3(0, 0, 20), halfSize: [115, 165] }, 560, h, {
    seed: 3, scale: [0.7, 1.3], exclude: (x, z) => nearRoute(x, z, 2.2) || Math.hypot(x - SEAT.x, z - SEAT.z) < 15 || (z > 112 && z < SEAT.z && Math.abs(x - 2) < 3.5) || inHost(x, z) || streamDist(x, z) < 5 || nearFlight(x, z, 1), tint: [0.8, 0.9, 0.5],
  }));
  level.root.add(grassField({ center: new THREE.Vector3(CLEARING.x, 0, CLEARING.z), halfSize: [36, 30] }, 0.32, h, { seed: 2, dry: 0.45, fade: [14, 32], exclude: (x, z) => streamDist(x, z) < 4.5 }));

  // a thin golden undergrowth along the way up and down, and mushrooms at the trunks
  const lanes = (x: number, z: number): boolean => !nearRoute(x, z, 22) || z > 128 || streamDist(x, z) < 4.5 || nearFlight(x, z, 1) || inClearing(x, z, -6);
  level.root.add(grassField({ center: new THREE.Vector3(10, 0, 0), halfSize: [60, 80] }, 0.14, h, { seed: 5, dry: 0.55, fade: [8, 26], height: [0.35, 0.7], exclude: lanes }));
  // the summit plateau and the far bank: grass and bracken among the trees, so neither reads as bare ground
  level.root.add(grassField({ center: new THREE.Vector3(0, 0, 168), halfSize: [64, 36] }, 0.2, h, {
    seed: 21, dry: 0.4, fade: [10, 40], height: [0.4, 0.8], exclude: (x, z) => Math.hypot(x - SEAT.x, z - SEAT.z) < 13 || (z < SEAT.z && Math.abs(x - 2) < 3.5),
  }));
  level.root.add(grassField({ center: new THREE.Vector3(0, 0, -132), halfSize: [90, 20] }, 0.2, h, { seed: 22, dry: 0.5, fade: [12, 44], height: [0.4, 0.8], exclude: (x, z) => streamDist(x, z) < 4.5 }));
  level.root.add(mushrooms({ center: new THREE.Vector3(0, 0, 10), halfSize: [90, 100] }, 40, h, { seed: 8, exclude: (x, z) => nearRoute(x, z, 3) || z > 128 || streamDist(x, z) < 5 }));

  // boulders and fallen logs: cover in the woods, never on a route
  const boulders = boulderField({ center: new THREE.Vector3(0, 0, 10), halfSize: [140, 120] }, 52, [0.5, 1.7], h, {
    seed: 9, moss: 0.7, exclude: (x, z) => nearRoute(x, z, 4) || inRuins(x, z, -4) || inClearing(x, z, -3) || nearFlight(x, z, 3) || onSummit(x, z) || inHost(x, z),
  });
  level.root.add(boulders.object);
  addColliders(physics, boulders.colliders);
  const rim = boulderField({ center: new THREE.Vector3(0, 0, 172), halfSize: [70, 30] }, 16, [0.6, 1.8], h, { seed: 19, moss: 0.8, exclude: (x, z) => onSummit(x, z) });
  level.root.add(rim.object);
  addColliders(physics, rim.colliders);
  for (let i = 0; i < 16; i++) {
    const x = (rng.float() * 2 - 1) * 90;
    const z = -70 + rng.float() * 170;
    if (nearRoute(x, z, 5) || inRuins(x, z, -2) || inClearing(x, z, -2) || nearFlight(x, z, 3) || streamDist(x, z) < 6) continue;
    place(fallenLog(5 + rng.float() * 4, 0.4 + rng.float() * 0.25, i + 3), x, z, rng.float() * Math.PI);
  }

  // leaf litter over the whole hill, the plateau and the far bank included (clear only round the Seat and the stair lane)
  fallenLeaves(level, { x: 0, z: 30, hx: 120, hz: 165 }, 2200, h, (x, z) => Math.hypot(x - SEAT.x, z - SEAT.z) < 14 || streamDist(x, z) < 3.5 || nearFlight(x, z, 0.5), 1);
  driftingLeaves(level, 90);

  // grass over the plateau and the far bank (the terrain shader alone leaves them a bare orange slab): off the stair lane,
  // the Seat's footing and the water
  const edge = (v: number, lo: number, hi: number): number => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  groundCover(level, {
    x0: -90, x1: 90, z0: 114, z1: 214, step: 3, heightAt: h, tint: [0.78, 0.76, 0.46], name: 'summit_cover',
    alpha: (x, z) => {
      const rim = Math.min(edge(90 - Math.abs(x), 0, 30), edge(214 - z, 0, 26), edge(z, 114, 134));
      const hole = edge(Math.hypot(x - SEAT.x, z - SEAT.z), 12.5, 17);
      // the great stair runs to z 124: keep the sheet off its treads (the lane beyond is open ground and gets grass)
      const lane = z < 128 ? edge(Math.abs(x - 2), 6.5, 10.5) : 1;
      return rim * hole * lane * 0.92;
    },
  });
  groundCover(level, {
    x0: -100, x1: 110, z0: -152, z1: -108, step: 3, heightAt: h, tint: [0.62, 0.66, 0.4], name: 'bank_cover',
    alpha: (x, z) => edge(streamDist(x, z), 4.2, 8) * Math.min(edge(110 - Math.abs(x - 5), 0, 30), edge(z, -152, -140)) * 0.9,
  });

  // a far wooded ridge behind everything (see distantRidge)
  distantRidge(level, new THREE.Vector3(0, 0, 28), 260, -6, (a) => fbm2(Math.cos(a) * 3.1 + 7, Math.sin(a) * 3.1 + 3, 3, 77) * 0.5 + 0.5);

  // ── the ruins on the terrace ───────────────────────────────────────────
  buildRuins(level, place, h, rng);

  // Saruman's white hands: war banners planted where the Uruk-hai came through
  const bannerSpots: [number, number, number][] = [[-15, 88, Math.PI], [16, 86, Math.PI + 0.3], [31, 14, 2.4], [24, -22, 2.8], [6, -61, 3.3], [-22, -60, 3.0]];
  for (const [x, z, yaw] of bannerSpots) place(banner(0x161616, 'white_hand', { height: 4.4 }), x, z, yaw);

  // ── the clearing by the stream ─────────────────────────────────────────
  buildClearing(level, place, h, rng, trunks);

  // ── the Seat of Seeing ─────────────────────────────────────────────────
  const summit = amonHenSummit({ seed: 4 });
  // weathered: grey-green, mossed sandstone rather than fresh yellow masonry
  weather(summit.object, [0.56, 0.62, 0.8]);
  summit.object.position.set(SEAT.x, SEAT.y, SEAT.z);
  level.root.add(summit.object);
  summit.object.updateMatrixWorld(true);
  addColliders(physics, summit.colliders, summit.object);

  return { heightAt: h, water, trunks };
}

type Place = (b: Built, x: number, z: number, yaw?: number, y?: number) => Built;

/** the terrace: a worn plaza, columns, wall stubs, toppled statues and the great broken stair */
function buildRuins(level: LevelAPI, place: Place, h: (x: number, z: number) => number, rng: Rng): void {
  const { physics } = level.ctx;
  const cx = RUINS.x;
  const cz = RUINS.z;

  // flights of stairs: each flush with the terrain's lane
  for (const f of FLIGHTS) {
    const st = stairs([f.from[0], f.y0, f.from[1]], [f.to[0], f.y1, f.to[1]], f.width, { riser: 0.22, material: 'mossy', cheeks: true, ramp: false });
    weather(st.object, [0.8, 0.88, 0.72]);
    level.root.add(st.object);
    addColliders(physics, st.colliders);
  }

  // the plaza: a disc of worn paving, a little proud of the grass
  const paving = mat('stone_blocks', { key: 'amonPaving', rgb: [0.7, 0.8, 0.62] }).clone();
  paving.polygonOffset = true;
  paving.polygonOffsetFactor = -3;
  paving.polygonOffsetUnits = -3;
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(10.5, 56), paving);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(cx, RUINS.y + 0.16, cz + 2);
  const uv = plaza.geometry.getAttribute('uv') as THREE.BufferAttribute;
  const pos = plaza.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2.6, pos.getY(i) / 2.6);
  plaza.receiveShadow = true;
  plaza.userData.noAO = true;
  level.root.add(plaza);

  // columns: a broken colonnade framing the great stair, and a pair at the south gate
  const cols: [number, number, number, 'ionic' | 'round' | 'broken', number][] = [
    [-8, 94, 8.2, 'ionic', 1], [12, 94, 7.4, 'round', 2], [-8, 102, 6.0, 'broken', 3], [12, 103, 8.0, 'ionic', 4],
    [-9, 111, 8.4, 'round', 5], [13, 112, 4.6, 'broken', 6],
    [-7, 46, 7.2, 'ionic', 7], [11, 45, 5.4, 'broken', 8],
  ];
  for (const [x, z, hh, kind, seed] of cols) {
    const col = pillar(kind, hh, 1.5, { seed, broken: 0.5 });
    weather(col.object, [0.6, 0.67, 0.5]);
    place(col, x, z, 0.4 * seed);
  }

  // a ragged curtain of old wall around the terrace, with the south gate and the north stair left open
  const wallArc = (a0: number, a1: number, r: number, height: number, thick: number, seed: number): void => {
    const pts: [number, number, number][] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = cx + Math.cos(a) * r * 1.1;
      const z = cz + Math.sin(a) * r;
      pts.push([x, h(x, z), z]);
    }
    const w = stoneWall(pts, height, thick, { crenellated: false, walkway: false, material: 'mossy', sink: 1.4, slits: false, anchorEvery: 0, smooth: true, seed });
    weather(w.object, [0.8, 0.88, 0.72]);
    level.root.add(w.object);
    addColliders(physics, w.colliders);
  };
  wallArc(0.15, 1.0, 25.5, 2.4, 1.1, 1);
  wallArc(2.2, 3.0, 25.5, 1.8, 1.1, 2);
  wallArc(3.3, 4.0, 25.5, 2.9, 1.2, 3);
  wallArc(5.5, 6.1, 25.5, 1.5, 1.1, 4);

  // scattered stonework: stubs, fallen columns, arches and rubble, with the fighting ground kept open
  const stones = ruins({ center: new THREE.Vector3(cx, 0, cz), halfSize: [34, 30] }, 26, h, {
    seed: 12, material: 'mossy', grandeur: 0.55,
    exclude: (x, z) => Math.hypot(x - cx, (z - (cz - 2)) * 1.1) < 11 || nearFlight(x, z, 3.5) || (Math.abs(x - cx) < 6 && z < cz - 14) || z > 100,
  });
  weather(stones.object, [0.8, 0.88, 0.72]);
  level.root.add(stones.object);
  addColliders(physics, stones.colliders);

  // toppled and headless statues of the old kings
  const kings: [Built, number, number, number][] = [
    [statue('standing', { height: 7.4, seed: 3 }), cx - 19, cz + 8, 0.9],
    [statue('toppled', { height: 7.0, seed: 5 }), cx + 17, cz + 18, -0.6],
    [statue('standing', { height: 8.2, seed: 8 }), cx - 14, cz + 36, 0.4],
  ];
  for (const [k, x, z, yaw] of kings) {
    weather(k.object, [0.68, 0.78, 0.58]);
    place(k, x, z, yaw);
  }
  void rng;
}

/** the clearing: Boromir's beech, boulders and a log by the water */
function buildClearing(level: LevelAPI, place: Place, h: (x: number, z: number) => number, rng: Rng, trunks: Trunk[]): void {
  const { physics } = level.ctx;
  // the old beech Boromir leans against
  const t = tree('beech', 7);
  const sc = 1.45;
  const tx = L.boromirTree.x;
  const tz = L.boromirTree.z;
  t.object.position.set(tx, h(tx, tz), tz);
  t.object.scale.setScalar(sc);
  t.object.rotation.y = 0.8;
  level.root.add(t.object);
  physics.addCylinder(tx, tz, t.trunkRadius * sc * 0.95, h(tx, tz) - 1, h(tx, tz) + 12, { material: 'wood', walkable: false, tag: 'tree' });
  trunks.push({ x: tx, z: tz, r: t.trunkRadius * sc });
  // a big mossy rock and a fallen log on the stream side
  const r1 = rock(2.4, 5, { moss: 0.6 }) as Built;
  // (behind the tree, off the death scene: the outro's cameras work in front of it)
  place(r1, L.boromirTree.x - 8, L.boromirTree.z + 2, 0.4);
  trunks.push({ x: L.boromirTree.x - 8, z: L.boromirTree.z + 2, r: 2 });
  trunks.push({ x: L.boromir.x, z: L.boromir.z, r: 0.6 });
  place(fallenLog(7, 0.5, 11), CLEARING.x + 12, CLEARING.z - 16, 0.3);
  const stones = boulderField({ center: new THREE.Vector3(CLEARING.x, 0, CLEARING.z - 24), halfSize: [30, 4] }, 14, [0.4, 1.2], h, {
    seed: 4, moss: 0.5, exclude: (x, z) => streamDist(x, z) < 3.8,
  });
  level.root.add(stones.object);
  addColliders(physics, stones.colliders);
  void rng;
}
