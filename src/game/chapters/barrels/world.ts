/**
 * The Forest River gorge, built from the world builders: carved terrain, the flowing river in zones
 * (still pool, calm reaches, white-water rapids), mossy boulders, beech and oak on the rim, the left
 * shelf the bank run follows, the side-stream clefts, the water-gate and the shingle bank.
 *
 * `buildGorge(level)` returns the pieces the script needs (heights, the gate, lever and stairs
 * anchors, the water bodies for flow lookups).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { fbm2, Rng } from '../../../core/rng';
import { clamp, lerp, smoothstep } from '../../../core/math';
import {
  TILE_METERS, addColliders, barrel, boulderField, carveRiver, fallenLog, ferns, forest, grassField, mat, mushrooms, river, rock, torch,
  type Built, type WaterBody,
} from '../../../world';
import {
  CLEFTS, CLEFT_WIDTH, LOW_LOGS, RIVER_LEN, RIVER_PTS, RIVER_ROCKS, RUN_OFFSET as RUN_E, S, TERRAIN, V, bankPos, riverPath, riverPos,
  shelfLeft, shelfRight, terrainPath, tangentAt, widthAt, waterY, flowYaw,
} from './layout';
import { buildWaterGate, type WaterGate } from './gate';

// ─────────────────────────────────────────────────────────────────────────────
// Height field
// ─────────────────────────────────────────────────────────────────────────────

/** water level as a function of z alone (the control points run strictly downstream in z) */
function yRefAt(z: number): number {
  const p = RIVER_PTS;
  if (z <= p[0][2]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (z <= p[i][2]) return lerp(p[i - 1][1], p[i][1], (z - p[i - 1][2]) / (p[i][2] - p[i - 1][2]));
  }
  return p[p.length - 1][1];
}

/** how far the rim stands above the river at z */
const DEPTH: [number, number][] = [[-60, 15], [50, 15], [160, 19], [300, 24], [400, 25], [480, 19], [545, 12], [600, 6], [660, 5]];
function gorgeDepth(z: number): number {
  if (z <= DEPTH[0][0]) return DEPTH[0][1];
  for (let i = 1; i < DEPTH.length; i++) {
    if (z <= DEPTH[i][0]) return lerp(DEPTH[i - 1][1], DEPTH[i][1], smoothstep(DEPTH[i - 1][0], DEPTH[i][0], z));
  }
  return DEPTH[DEPTH.length - 1][1];
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** the rim plateau: rolling forested country the river has cut into */
function plateauAt(x: number, z: number): number {
  const d = gorgeDepth(z);
  const amp = 0.28 * d;
  return yRefAt(z) + d + fbm2(x * 0.011, z * 0.011, 3, 7) * amp + fbm2(x * 0.04, z * 0.04, 2, 9) * Math.min(1.6, amp * 0.25);
}

/** height above the water at distance `e` from the water's edge (e < 0 inside the channel) */
function profile(left: boolean, e: number, s: number, x: number, z: number): number {
  const beachK = left ? smoothstep(688, 726, s) : 0;
  if (beachK > 0) {
    // the shingle bank: the shore lies at the water's level and climbs in low shingle ridges (storm berms)
    const ee = Math.max(e, 0);
    // (long ridges only: the terrain mesh is 2.8 m a cell, anything finer would alias against the gravel sheet)
    const berm = 0.2 * Math.sin(ee * 0.46 + fbm2(x * 0.05, z * 0.05, 2, 41) * 4) * smoothstep(1.5, 5, ee);
    const beach = -0.03 + 0.05 * Math.min(ee, 12) + (ee > 12 ? 0.05 * (ee - 12) * 1.3 : 0) + berm + fbm2(x * 0.3, z * 0.3, 2, 47) * 0.08 * Math.min(1, ee * 0.4);
    const plain = e <= 0 ? 0.4 : (() => {
      const swp = shelfLeft(s);
      return e < swp ? 0.4 + 0.045 * e : 0.4 + 0.045 * swp + (e - swp) * 1.2;
    })();
    return lerp(plain, beach, beachK);
  }
  const sw = left ? shelfLeft(s) : shelfRight(s);
  const k = left ? 1.2 : 2.0;
  if (e <= 0) return 0.4;
  const shelfNoise = (fbm2(x * 0.17, z * 0.17, 2, 21) * 0.5 + 0.1) * Math.min(1, e * 0.5);
  if (e < sw) return 0.4 + 0.045 * e + shelfNoise * 0.55;
  const d = e - sw;
  const rough = fbm2(x * 0.07, z * 0.07, 3, 33) * d * 0.28 + fbm2(x * 0.21, z * 0.21, 2, 35) * Math.min(d, 6) * 0.22;
  return 0.4 + 0.045 * sw + d * k + d * d * 0.012 + rough;
}

/** terrain height before the channel is carved */
function baseHeight(x: number, z: number): number {
  const n = terrainPath.nearest(x, z);
  const hw = widthAt(n.s) / 2;
  const left = n.signed < 0;
  // beyond the path's ends the "bank" wraps around the endpoint: treat as a plain wall
  const e = n.dist - hw;
  let rel = profile(left, e, n.s, x, z);
  if (left && e > 0 && e < 20) {
    // side-stream clefts cut across the walkable shelf
    for (const g of CLEFTS) {
      const ds = Math.abs(n.s - g);
      if (ds < CLEFT_WIDTH / 2 + 1.6) {
        const across = 1 - smoothstep(CLEFT_WIDTH / 2 - 0.2, CLEFT_WIDTH / 2 + 1.6, ds);
        const inland = 1 - smoothstep(13, 19, e);
        rel = lerp(rel, -0.35 + e * 0.045, across * inland);
      }
    }
  }
  const plateau = plateauAt(x, z);
  const yWater = n.y;
  const floor = yRefAt(z) + 0.7;
  return Math.max(floor, smin(plateau, yWater + rel, 5));
}

export interface GorgeHeights {
  heightAt(x: number, z: number): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Instanced boulders at explicit places
// ─────────────────────────────────────────────────────────────────────────────

interface RockSpec {
  x: number;
  z: number;
  y: number;
  size: number;
  yaw: number;
  /** flatten the rock so it lies low */
  squash?: number;
}

function placeRocks(specs: RockSpec[], seed: number, moss: number): Built {
  const variants = 4;
  const geoms: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (let v = 0; v < variants; v++) {
    const b = rock(1, seed + v * 7, { moss }) as Built;
    const mesh = b.object.children[0] as THREE.Mesh;
    geoms.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material });
  }
  const buckets: RockSpec[][] = Array.from({ length: variants }, () => []);
  specs.forEach((r, i) => buckets[i % variants].push(r));
  const g = new THREE.Group();
  g.name = 'placed-rocks';
  const colliders: Built['colliders'] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let v = 0; v < variants; v++) {
    const list = buckets[v];
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(geoms[v].geo, geoms[v].mat, list.length);
    list.forEach((r, i) => {
      e.set(0, r.yaw, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(r.x, r.y + 0.42 * 0.72 * r.size, r.z), q, new THREE.Vector3(r.size, r.size * (r.squash ?? 1), r.size));
      inst.setMatrixAt(i, m);
      colliders.push({ kind: 'cyl', x: r.x, z: r.z, r: r.size * 0.8, y0: r.y - 0.5, y1: r.y + r.size * 0.72 * (r.squash ?? 1), opts: { material: 'stone', tag: 'rock' } });
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = inst.receiveShadow = true;
    g.add(inst);
  }
  return { object: g, colliders };
}

// ─────────────────────────────────────────────────────────────────────────────
// The gorge
// ─────────────────────────────────────────────────────────────────────────────

export interface Gorge {
  heightAt(x: number, z: number): number;
  water: WaterBody[];
  gate: WaterGate;
  /** world-space centres of the river rocks (for foam / bump checks) */
  rocks: { x: number; z: number; r: number; s: number; l: number }[];
  /** low log obstacles, world transform */
  lowLogs: { s: number; object: THREE.Object3D }[];
}

export function buildGorge(level: LevelAPI): Gorge {
  const { physics } = level.ctx;
  const rng = new Rng(7777);

  // ── terrain: one heightfield, the river carved into it ──
  const carved = carveRiver(baseHeight, terrainPath, widthAt, { depth: 1.9, bank: 1.9 });
  const terrain = level.terrain({
    size: TERRAIN.size,
    segments: TERRAIN.segments,
    height: carved,
    style: 'riverbank',
    theme: 'wet',
    center: TERRAIN.center,
    layers: ['grass', 'forest_floor', 'rock'],
    patchiness: 0.5,
    material: 'grass',
  });
  const h = terrain.heightAt;

  // ── water, in zones ──
  const water: WaterBody[] = [];
  const zone = (s0: number, s1: number, style: Parameters<typeof river>[2]) => {
    const pts: [number, number, number][] = [];
    for (let s = s0; s < s1; s += 6) {
      const p = riverPos(s, 0);
      pts.push([p.x, p.y, p.z]);
    }
    const pe = riverPos(s1, 0);
    pts.push([pe.x, pe.y, pe.z]);
    const near = RIVER_ROCKS.filter((r) => r.s >= s0 - 4 && r.s <= s1 + 4).slice(0, 16).map((r) => {
      const p = riverPos(r.s, r.l);
      return { x: p.x, z: p.z, r: r.r };
    });
    const body = river(pts, (s) => widthAt(s0 + s * ((s1 - s0) / Math.max(1, s1 - s0))) + 5.5, { terrain: h, rocks: near, step: 1.5, ...style });
    level.root.add(body.object);
    water.push(body);
  };
  const deep = 0x1b3b3a;
  const shallow = 0x56603f;
  zone(0, S.gate + 1, { speed: 0.9, foam: 0.12, color: deep, shallow, depth: 2.2, ripple: 0.8 });
  zone(S.gate, 170, { speed: 4.5, foam: 0.35, color: deep, shallow, depth: 2.0, ripple: 1.0 });
  zone(168, 430, { speed: 7.6, foam: 0.85, rapids: true, color: 0x1f4440, shallow, depth: 2.0, wave: 0.07 });
  zone(428, 522, { speed: 5.2, foam: 0.45, color: deep, shallow, depth: 2.2, ripple: 1.0, wave: 0.03 });
  zone(520, 706, { speed: 7.9, foam: 0.85, rapids: true, color: 0x1f4440, shallow, depth: 2.0, wave: 0.07 });
  zone(704, RIVER_LEN, { speed: 1.2, foam: 0.16, color: 0x1d4540, shallow: 0x6b6a4c, depth: 2.4, ripple: 0.7 });

  // side streams in the clefts (tiny waterfalls into the river)
  for (const g of CLEFTS) {
    const a = bankPos(g, 12.5);
    const b = bankPos(g, 0.4);
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = lerp(a.x, b.x, t);
      const z = lerp(a.z, b.z, t);
      pts.push([x, lerp(h(a.x, a.z) + 0.12, waterY(g) - 0.05, t), z]);
    }
    const stream = river(pts, 2.8 + 1.5, { terrain: h, speed: 3, foam: 0.6, rapids: true, depth: 0.5, step: 1.0, color: 0x2a504a, shallow });
    level.root.add(stream.object);
  }

  // ── the water-gate with its lever, stairs and walkway ──
  const wg = buildWaterGate(level, h);

  // ── rocks standing in the white water ──
  const rockSpecs: RockSpec[] = RIVER_ROCKS.map((r, i) => {
    const p = riverPos(r.s, r.l);
    return { x: p.x, z: p.z, y: p.y - 0.55, size: r.r * 1.15, yaw: i * 1.7, squash: 1.15 };
  });
  const riverRocks = placeRocks(rockSpecs, 3, 0.7);
  level.root.add(riverRocks.object);
  // no colliders for the water rocks: the barrels steer around them logically, and an arrow
  // should still be able to fly across the river

  // ── boulders along the shelf the bank run follows (colliders: the runner hops over them) ──
  const shelfRocks: RockSpec[] = [];
  const crng = new Rng(4242);
  for (let s = S.runStart + 8; s < S.runEnd - 6; s += 9 + crng.float() * 9) {
    if (CLEFTS.some((g) => Math.abs(s - g) < 9)) continue;
    const e = RUN_E + (crng.float() * 2 - 1) * 1.8;
    const p = bankPos(s, e);
    shelfRocks.push({ x: p.x, z: p.z, y: h(p.x, p.z), size: 0.7 + crng.float() * 0.5, yaw: crng.float() * 6, squash: 0.9 });
  }
  const shelfBoulders = placeRocks(shelfRocks, 11, 0.5);
  level.root.add(shelfBoulders.object);
  addColliders(physics, shelfBoulders.colliders);

  // ── shore clutter: boulder scatter on both banks, in and out of the way ──
  const onWalkway = (x: number, z: number) => {
    const n = terrainPath.nearest(x, z);
    return n.s > S.gate - 14 && n.s < S.gate + 24;
  };
  const sideBoulders = boulderField({ center: V(0, 0, 300), halfSize: [260, 330] }, 90, [0.5, 2.2], h, {
    seed: 5, moss: 0.8, colliderMin: 99, clump: 0.7,
    exclude: (x, z) => {
      const n = terrainPath.nearest(x, z);
      if (n.dist < widthAt(n.s) / 2 + 0.5 || n.dist > widthAt(n.s) / 2 + 22) return true;
      return onWalkway(x, z) || (n.signed < 0 && n.dist < widthAt(n.s) / 2 + RUN_E + 3 && n.s > S.runStart && n.s < S.runEnd);
    },
  });
  level.root.add(sideBoulders.object);

  // ── forest on the rim and the plateau ──
  const slopeOk = (x: number, z: number, max: number) => {
    const e = 1.2;
    const gx = (h(x + e, z) - h(x - e, z)) / (2 * e);
    const gz = (h(x, z + e) - h(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz) < max;
  };
  const rimExclude = (x: number, z: number) => {
    const n = terrainPath.nearest(x, z);
    if (n.dist < widthAt(n.s) / 2 + 3) return true;
    // keep the shelf and the walkway clear; the cliff itself is too steep for trunks
    return !slopeOk(x, z, 0.62) || onWalkway(x, z);
  };
  const rim = forest(
    { center: V(0, 0, 300), halfSize: [330, 340] },
    430,
    [{ kind: 'beech', weight: 3 }, { kind: 'mirkwood_oak', weight: 1.3 }, { kind: 'birch', weight: 0.5 }, { kind: 'pine', weight: 0.6 }],
    h,
    { seed: 21, scale: [0.95, 1.4], spacing: 1.2, exclude: (x, z) => rimExclude(x, z) || Math.hypot(x - riverPos(S.gate, 0).x, z - riverPos(S.gate, 0).z) < 20, lodNear: 52, lodFar: 300, chunk: 64, variants: 3 },
  );
  level.root.add(rim.object);
  addColliders(physics, rim.colliders);

  // ── ground cover: ferns and moss on the shelf, mushrooms, grass on the banks ──
  const shelfArea = { center: V(0, 0, 150), halfSize: [60, 110] as [number, number] };
  const nearRun = (x: number, z: number) => {
    const n = terrainPath.nearest(x, z);
    return n.dist > widthAt(n.s) / 2 + 16 || n.dist < widthAt(n.s) / 2 + 0.6;
  };
  level.root.add(ferns(shelfArea, 120, h, { seed: 31, exclude: nearRun, clump: 0.7 }));
  level.root.add(grassField({ center: V(20, 0, 110), halfSize: [50, 90] }, 0.7, h, { seed: 8, exclude: nearRun, fade: [14, 34], height: [0.25, 0.6] }));
  level.root.add(mushrooms({ center: V(30, 0, 130), halfSize: [30, 70] }, 20, h, { seed: 3, exclude: nearRun }));

  // ── fallen logs on the shelf and shore, mossy and wedged ──
  const placeLog = (s: number, e: number, len: number, rad: number, yaw: number, seed: number) => {
    const p = bankPos(s, e);
    const b = fallenLog(len, rad, seed, { mossy: true });
    b.object.position.set(p.x, h(p.x, p.z), p.z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    addColliders(physics, b.colliders, b.object);
  };
  placeLog(S.runStart + 30, 3.0, 7, 0.4, flowYaw(S.runStart + 30) + 1.1, 2);
  placeLog(S.runStart + 62, 6.6, 6, 0.38, flowYaw(S.runStart + 62) - 0.3, 3);
  placeLog(S.runStart + 104, 2.2, 8, 0.45, flowYaw(S.runStart + 104) + 1.35, 4);

  // ── low logs wedged across the rapids ──
  const lowLogs: Gorge['lowLogs'] = [];
  for (const [i, ll] of LOW_LOGS.entries()) {
    const c = riverPos(ll.s, 0, -0.05);
    const wHere = widthAt(ll.s) + 3.2;
    const b = fallenLog(wHere, 0.5, 8 + i, { mossy: true });
    b.object.position.set(c.x, c.y + 0.18, c.z);
    b.object.rotation.y = flowYaw(ll.s) + Math.PI / 2;
    level.root.add(b.object);
    lowLogs.push({ s: ll.s, object: b.object });
  }

  // ── the shingle bank at the end of the pool: wet grey gravel meeting the water, ridges of loose stones,
  //    driftwood, a few beached barrels and boulders standing in the shallows ──
  {
    const S0 = 692;
    const S1 = RIVER_LEN + 4;
    const NS = 72;
    const NE = 24;
    const E0 = -1.6;
    const E1 = 27;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const tile = TILE_METERS.cobble * 0.2;
    const tmp = V(0, 0, 0);
    for (let j = 0; j <= NS; j++) {
      const sj = lerp(S0, S1, j / NS);
      const upstream = 1 - smoothstep(S0, S0 + 26, sj);
      for (let i = 0; i <= NE; i++) {
        const e = lerp(E0, E1, i / NE);
        bankPos(sj, e, tmp);
        const x = tmp.x;
        const z = tmp.z;
        const nz = fbm2(x * 0.09, z * 0.09, 2, 71);
        // the gravel gives way to turf inland and thins out at the upstream end
        const inland = smoothstep(11 + nz * 7, 21 + nz * 7, e);
        const f = Math.max(inland, upstream);
        pos.push(x, h(x, z) + 0.11 - f * 0.5, z);
        uv.push(x / tile, z / tile);
        const n = fbm2(x * 0.33, z * 0.33, 2, 83);
        const wet = 1 - smoothstep(0.1, 3.4 + n * 1.6, e);
        // broad dark and pale patches break up the texture's regularity (wet gravel, dry gravel, a little sand)
        const patchN = fbm2(x * 0.045, z * 0.045, 3, 97);
        const v = lerp(0.84, 0.46, wet) * (0.82 + n * 0.28 + patchN * 0.5);
        const sand = smoothstep(0.1, 0.45, patchN) * (1 - wet) * 0.25;
        col.push(v * (0.95 + sand), v * (0.98 + sand * 0.7), v * (0.93 + sand * 0.1));
      }
    }
    for (let j = 0; j < NS; j++) {
      for (let i = 0; i < NE; i++) {
        const a = j * (NE + 1) + i;
        const b2 = (j + 1) * (NE + 1) + i;
        idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // make sure the sheet faces up whatever way the river bends there
    const nrm = geo.getAttribute('normal');
    let up = 0;
    for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
    if (up < 0) {
      const ix = geo.getIndex()!;
      for (let k = 0; k < ix.count; k += 3) {
        const t = ix.getX(k + 1);
        ix.setX(k + 1, ix.getX(k + 2));
        ix.setX(k + 2, t);
      }
      geo.computeVertexNormals();
    }
    const patch = new THREE.Mesh(geo, mat('cobble', { key: 'shingle2', vertexColors: true, rgb: [1.05, 1.05, 1.0] }));
    patch.receiveShadow = true;
    patch.name = 'shingle';
    level.root.add(patch);

    const onBeach = (x: number, z: number, e0: number, e1: number): boolean => {
      const n = terrainPath.nearest(x, z);
      if (n.s < 696 || n.signed >= 0) return false;
      const e = n.dist - widthAt(n.s) / 2;
      return e > e0 && e < e1;
    };
    // the outro's stage (s 767..797 near the water) is kept clear of reeds, rocks and wreckage
    const stage = (x: number, z: number): boolean => {
      const n = terrainPath.nearest(x, z);
      return n.s > S.end - 40 && n.s < S.end - 12 && n.signed < 0 && n.dist - widthAt(n.s) / 2 < 12;
    };
    // loose stones: low-poly pebbles (an 80-triangle lump each), dense at the waterline and thinning inland
    const c0 = bankPos(S.end - 34, 8);
    {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const pp = geo.getAttribute('position');
      for (let k = 0; k < pp.count; k++) {
        const bump = 1 + (fbm2(pp.getX(k) * 2.1 + 3, pp.getZ(k) * 2.1 + pp.getY(k) * 1.7, 2, 19) - 0.5) * 0.5;
        pp.setXYZ(k, pp.getX(k) * bump, pp.getY(k) * bump, pp.getZ(k) * bump);
      }
      geo.computeVertexNormals();
      const PEB = 760;
      const pm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true, envMapIntensity: 0.35 });
      const inst = new THREE.InstancedMesh(geo, pm, PEB);
      const prng = new Rng(1717);
      const m4 = new THREE.Matrix4();
      const q4 = new THREE.Quaternion();
      const eu = new THREE.Euler();
      const col = new THREE.Color();
      for (let k = 0; k < PEB; k++) {
        const sj = lerp(698, S.end + 2, prng.float());
        const e = -0.9 + prng.float() * prng.float() * 18;
        const p = bankPos(sj, e);
        const r = 0.04 + prng.float() * prng.float() * 0.2;
        eu.set(prng.float() * 0.5, prng.float() * 6.28, prng.float() * 0.5);
        q4.setFromEuler(eu);
        m4.compose(V(p.x, h(p.x, p.z) + r * 0.2, p.z), q4, V(r, r * 0.62, r * (0.8 + prng.float() * 0.5)));
        inst.setMatrixAt(k, m4);
        const v = 0.22 + prng.float() * 0.3;
        inst.setColorAt(k, col.setRGB(v * 0.98, v, v * 0.94));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.name = 'pebbles';
      level.root.add(inst);
    }
    // boulders standing in the shallows and on the strand
    const pr: RockSpec[] = [];
    const brng = new Rng(5151);
    for (let k = 0; k < 15; k++) {
      const sj = 700 + k * 7.6 + brng.float() * 4;
      const e = k % 3 === 0 ? 4 + brng.float() * 6 : -0.9 + brng.float() * 2.6;
      const p = bankPos(sj, e);
      if (stage(p.x, p.z)) continue;
      pr.push({ x: p.x, z: p.z, y: h(p.x, p.z) - 0.1, size: 0.5 + brng.float() * 0.95, yaw: brng.float() * 6, squash: 0.8 });
    }
    const shoreRocks = placeRocks(pr, 29, 0.25);
    level.root.add(shoreRocks.object);
    // driftwood along the tide line and a few barrels beached from earlier convoys
    const lay = (b: Built, sj: number, e: number, yaw: number, tilt = 0) => {
      const p = bankPos(sj, e);
      b.object.position.set(p.x, h(p.x, p.z) + tilt * 0.0, p.z);
      b.object.rotation.y = yaw;
      level.root.add(b.object);
      addColliders(physics, b.colliders, b.object);
    };
    const wood = [
      [712, 1.4, 0.25, 5, 0.2], [728, 0.6, -0.4, 4, 0.16], [744, 2.4, 0.5, 6.4, 0.24], [757, 1.0, -0.15, 3.6, 0.15],
      [764, 4.2, 0.35, 5.2, 0.2], [803, 1.1, 0.2, 4.4, 0.18], [809, 3.0, -0.5, 3.2, 0.14], [718, 5.5, 1.2, 4.5, 0.17],
    ] as const;
    wood.forEach(([sj, e, dy, len, r], k) => lay(fallenLog(len, r, 61 + k, { mossy: false }), sj, e, flowYaw(sj) + dy + (k % 2 ? 0.3 : 0)));
    const barrels: [number, number, number][] = [[736, 1.7, 0.7], [758, 2.6, 2.1], [802, 0.8, 4.0], [807, 2.6, 5.3]];
    barrels.forEach(([sj, e, yw], k) => lay(barrel({ height: 0.95, open: k % 2 === 0, seed: 90 + k, lying: true }), sj, e, yw));
    // reeds and tall grass at the water's edge
    level.root.add(
      grassField({ center: V(c0.x, 0, c0.z), halfSize: [18, 66] }, 1.6, h, {
        seed: 12, height: [0.7, 1.5], dry: 0.35, fade: [26, 60], color: 0x5a6a30, tipColor: 0xa4a860,
        exclude: (x, z) => !onBeach(x, z, 0.1, 3.4) || stage(x, z),
      }),
    );
    level.root.add(
      grassField({ center: V(c0.x, 0, c0.z), halfSize: [22, 66] }, 0.8, h, {
        seed: 13, height: [0.3, 0.7], dry: 0.5, fade: [20, 44],
        exclude: (x, z) => !onBeach(x, z, 11, 26),
      }),
    );
  }

  // ── the country beyond the river's end and the banks of the pool: trees on the far side and behind the strand ──
  {
    const kinds = [{ kind: 'beech' as const, weight: 3 }, { kind: 'mirkwood_oak' as const, weight: 1.2 }, { kind: 'birch' as const, weight: 0.6 }, { kind: 'pine' as const, weight: 0.5 }];
    const tail = forest(
      { center: V(120, 0, 640), halfSize: [260, 120] },
      150,
      kinds,
      h,
      {
        seed: 23, scale: [0.95, 1.4], spacing: 1.2, lodNear: 52, lodFar: 300, chunk: 64, variants: 3,
        exclude: (x, z) => {
          if (z < 620) return true;
          const n = terrainPath.nearest(x, z);
          const hw = widthAt(n.s) / 2;
          if (n.s < 696 && n.dist < hw + 3) return true;
          // keep the strand clear: left bank, within ~26 m of the water
          if (n.signed < 0 && n.dist < hw + 27 && n.s > 690) return true;
          if (n.dist < hw + 2.5) return true;
          return !slopeOk(x, z, 0.62);
        },
      },
    );
    level.root.add(tail.object);
    addColliders(physics, tail.colliders);
  }

  // ── cliff faces: big mossy outcrops break up the stretched cliff texture (the gorge walls, both sides) ──
  {
    const outcrops = boulderField({ center: V(0, 0, 330), halfSize: [260, 300] }, 170, [1.5, 5.4], h, {
      seed: 77, moss: 0.65, colliderMin: 99, clump: 0.5, sink: 0.35,
      exclude: (x, z) => {
        const n = terrainPath.nearest(x, z);
        const e = n.dist - widthAt(n.s) / 2;
        if (e < 2.5 || e > 20 || n.s > 690 || n.s < 20) return true;
        if (n.s > S.gate - 16 && n.s < S.gate + 26) return true;
        // the run's shelf and the archers' ledges stay clear
        if (n.signed < 0 && e < shelfLeft(n.s) + 1.5) return true;
        if (n.signed >= 0 && e < shelfRight(n.s) + 1.0) return true;
        return !(Math.hypot(h(x + 1.5, z) - h(x - 1.5, z), h(x, z + 1.5) - h(x, z - 1.5)) / 3 > 0.35);
      },
    });
    level.root.add(outcrops.object);
  }

  // far dressing: leave a few torches at the gate (lit by fx lights, budgeted)
  void torch;
  void rng;
  void clamp;
  void riverPath;
  void tangentAt;

  return { heightAt: h, water, gate: wg, rocks: RIVER_ROCKS.map((r) => ({ ...riverPos(r.s, r.l), r: r.r, s: r.s, l: r.l })).map((p, i) => ({ x: p.x, z: p.z, r: RIVER_ROCKS[i].r, s: RIVER_ROCKS[i].s, l: RIVER_ROCKS[i].l })), lowLogs };
}
