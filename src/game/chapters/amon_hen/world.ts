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
  const keepClear = (x: number, z: number): boolean =>
    nearRoute(x, z, 5.5) || inClearing(x, z, -2) || inRuins(x, z, -6) || streamDist(x, z) < 6 || z > 128 || nearFlight(x, z, 3) || Math.hypot(x - L.spawn.x, z - L.spawn.z) < 7;
  /** where the player and the fights are: full-detail trees. Beyond it the wood is only ever seen from afar */
  const nearField = (x: number, z: number): boolean => nearRoute(x, z, 34) || inClearing(x, z, 16) || inRuins(x, z, 14);
  const area = { center: new THREE.Vector3(0, 0, 14), halfSize: [165, 138] as [number, number] };
  const KINDS = [{ kind: 'beech' as const, weight: 5 }, { kind: 'birch' as const, weight: 2.4 }, { kind: 'pine' as const, weight: 1.4 }];
  // the near wood: full-detail trees close to the player (two variants per kind), the golden beechwood
  const beech = forest(area, 160, KINDS, h, {
    seed: 6, scale: [1.05, 1.6], spacing: 1.5, variants: 2, exclude: (x, z) => keepClear(x, z) || !nearField(x, z), chunk: 48, lodNear: 30, lodFar: 185, leafTint: [1.22, 1.06, 0.62],
  });
  level.root.add(beech.object);
  addColliders(physics, beech.colliders);
  // the far wood: the same trees at their simplified level only (always beyond ~20 m, in the haze), few big chunks
  const mixed = forest(area, 240, KINDS, h, {
    seed: 17, scale: [1.0, 1.55], spacing: 1.5, variants: 1, exclude: (x, z) => keepClear(x, z) || nearField(x, z), chunk: 80, lodNear: 1, lodFar: 185, leafTint: [1.22, 1.06, 0.62],
  });
  level.root.add(mixed.object);
  addColliders(physics, mixed.colliders);
  for (const t of [...beech.trees, ...mixed.trees]) trunks.push({ x: t.x, z: t.z, r: t.radius });

  level.root.add(ferns({ center: new THREE.Vector3(0, 0, 10), halfSize: [110, 110] }, 340, h, { seed: 3, scale: [0.7, 1.3], exclude: (x, z) => nearRoute(x, z, 2.2) || z > 130 || streamDist(x, z) < 5, tint: [0.95, 0.9, 0.55] }));
  level.root.add(grassField({ center: new THREE.Vector3(CLEARING.x, 0, CLEARING.z), halfSize: [36, 30] }, 0.32, h, { seed: 2, dry: 0.45, fade: [14, 32], exclude: (x, z) => streamDist(x, z) < 4.5 }));

  // a thin golden undergrowth along the way up and down, and mushrooms at the trunks
  const lanes = (x: number, z: number): boolean => !nearRoute(x, z, 22) || z > 128 || streamDist(x, z) < 4.5 || nearFlight(x, z, 1) || inClearing(x, z, -6);
  level.root.add(grassField({ center: new THREE.Vector3(10, 0, 0), halfSize: [60, 80] }, 0.14, h, { seed: 5, dry: 0.55, fade: [8, 26], height: [0.35, 0.7], exclude: lanes }));
  level.root.add(mushrooms({ center: new THREE.Vector3(0, 0, 10), halfSize: [90, 100] }, 40, h, { seed: 8, exclude: (x, z) => nearRoute(x, z, 3) || z > 128 || streamDist(x, z) < 5 }));

  // boulders and fallen logs: cover in the woods, never on a route
  const boulders = boulderField({ center: new THREE.Vector3(0, 0, 10), halfSize: [140, 120] }, 52, [0.5, 1.7], h, {
    seed: 9, moss: 0.7, exclude: (x, z) => nearRoute(x, z, 4) || inRuins(x, z, -4) || inClearing(x, z, -3) || nearFlight(x, z, 3) || z > 130,
  });
  level.root.add(boulders.object);
  addColliders(physics, boulders.colliders);
  for (let i = 0; i < 16; i++) {
    const x = (rng.float() * 2 - 1) * 90;
    const z = -70 + rng.float() * 170;
    if (nearRoute(x, z, 5) || inRuins(x, z, -2) || inClearing(x, z, -2) || nearFlight(x, z, 3) || streamDist(x, z) < 6) continue;
    place(fallenLog(5 + rng.float() * 4, 0.4 + rng.float() * 0.25, i + 3), x, z, rng.float() * Math.PI);
  }

  fallenLeaves(level, { x: 0, z: 14, hx: 110, hz: 110 }, 1500, h, (x, z) => z > 134 || streamDist(x, z) < 3.5, 1);
  driftingLeaves(level, 90);

  // ── the ruins on the terrace ───────────────────────────────────────────
  buildRuins(level, place, h, rng);

  // Saruman's white hands: war banners planted where the Uruk-hai came through
  const bannerSpots: [number, number, number][] = [[-15, 88, Math.PI], [16, 86, Math.PI + 0.3], [31, 14, 2.4], [24, -22, 2.8], [6, -61, 3.3], [-22, -60, 3.0]];
  for (const [x, z, yaw] of bannerSpots) place(banner(0x161616, 'white_hand', { height: 4.4 }), x, z, yaw);

  // ── the clearing by the stream ─────────────────────────────────────────
  buildClearing(level, place, h, rng, trunks);

  // ── the Seat of Seeing ─────────────────────────────────────────────────
  const summit = amonHenSummit({ seed: 4 });
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
    weather(col.object, [0.74, 0.8, 0.66]);
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
  level.root.add(stones.object);
  addColliders(physics, stones.colliders);

  // toppled and headless statues of the old kings
  const kings: [Built, number, number, number][] = [
    [statue('standing', { height: 7.4, seed: 3 }), cx - 19, cz + 8, 0.9],
    [statue('toppled', { height: 7.0, seed: 5 }), cx + 17, cz + 18, -0.6],
    [statue('standing', { height: 8.2, seed: 8 }), cx - 14, cz + 36, 0.4],
  ];
  for (const [k, x, z, yaw] of kings) {
    weather(k.object, [0.78, 0.86, 0.7]);
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
  place(r1, L.boromirTree.x + 7, L.boromirTree.z - 4, 0.4);
  trunks.push({ x: L.boromirTree.x + 7, z: L.boromirTree.z - 4, r: 2 });
  trunks.push({ x: L.boromir.x, z: L.boromir.z, r: 0.6 });
  place(fallenLog(7, 0.5, 11), CLEARING.x + 12, CLEARING.z - 16, 0.3);
  const stones = boulderField({ center: new THREE.Vector3(CLEARING.x, 0, CLEARING.z - 24), halfSize: [30, 4] }, 14, [0.4, 1.2], h, {
    seed: 4, moss: 0.5, exclude: (x, z) => streamDist(x, z) < 3.8,
  });
  level.root.add(stones.object);
  addColliders(physics, stones.colliders);
  void rng;
}
