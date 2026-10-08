/**
 * Helm's Deep: the level geometry (no gameplay). The Deeping Wall and the Hornburg from the
 * helmsDeep() builder, the coomb terrain closed by the Deep's cliffs, the court dressing, the wall
 * lights, the Lórien archers lining the battlements and the Uruk host filling the coomb.
 *
 * The helmsDeep() builder puts the wall battlements on the INSIDE (stoneWall's 'left' side is -z
 * for +x travel, while the culvert, towers and ladder anchors are on +z). Until that is fixed in
 * src/world, the three wall runs are rebuilt here with the parapet on the coomb side and swapped
 * into the builder's object (the builder's own colliders for them are filtered out by tag).
 */
import * as THREE from 'three';
import type { CrowdHandle, LevelAPI, ColliderHandle } from '../../../core/types';
import {
  addColliders, banner, barrel, boulderField, brazier, crate, createCrowd, helmsDeep, lake, mat, removeColliders, stairs, stoneWall, torch,
  weaponRack, type Built, type ColliderDesc, type HelmsDeepResult, type WaterBody,
} from '../../../world';
import { createWeapon } from '../../../creatures/weapons';
import { yawOf } from '../../../core/math';
import { L, WALL_A_PTS, WALL_B_PTS, WALL_C_PTS, WALL_H, WALL_T, terrainHeight, walk, wallAt } from './layout';

const WALL_TAGS = new Set(['wall', 'parapet', 'merlon', 'buttress']);

export interface HelmsWorld {
  hd: HelmsDeepResult;
  ground: (x: number, z: number) => number;
  /** swap the culvert section for the blasted breach (and flood the court behind it) */
  setBreached(on: boolean): void;
  readonly breached: boolean;
  /** the shield lying at the head of the stair */
  shield: THREE.Object3D;
  /** the flood water behind the breach */
  pool: WaterBody;
  /** world positions of the brazier flames on the wall tops */
  fireSpots: THREE.Vector3[];
  /** wall torch flame positions in the court */
  torchSpots: THREE.Vector3[];
  /** the Uruk host (main body, front ranks) */
  host: CrowdHandle;
  front: CrowdHandle;
  /** the torch glow over the host; setFraction() dims it as the host thins */
  torchSea: { points: THREE.Points; setFraction(f: number): void };
  /** the Galadhrim lining the far battlements (not combatants) */
  elves: CrowdHandle[];
  dispose(): void;
}

/** a box in the walls' stone with world-scale UVs (3 m per texture tile) */
function stoneBox(w: number, h: number, d: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order px, nx, py, ny, pz, nz: (u, v) extents per face
  const ext: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * ext[f][0]) / 3, (uv.getY(k) * ext[f][1]) / 3);
  }
  const m = new THREE.Mesh(g, mat('stone_blocks', { key: 'base' }));
  m.castShadow = m.receiveShadow = true;
  m.name = 'stair_head';
  return m;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !mesh.geometry.userData?.shared) mesh.geometry.dispose();
  });
}

/** replace the builder's three wall runs with battlements on the coomb side */
function fixWalls(hd: HelmsDeepResult): void {
  const root = hd.object;
  const old: THREE.Object3D[] = [];
  for (const c of root.children) if (c.name === 'stone_wall') old.push(c);
  for (const c of hd.breach.intact.children) if (c.name === 'stone_wall') old.push(c);
  for (const o of old) {
    o.removeFromParent();
    disposeTree(o);
  }
  const opts = { outer: 'right' as const, buttress: 9, material: 'blocks' as const };
  const a = stoneWall([...WALL_A_PTS], WALL_H, WALL_T, { ...opts, smooth: true, seed: 1, anchorEvery: 15 });
  const b = stoneWall([...WALL_B_PTS], WALL_H, WALL_T, { ...opts, seed: 2, anchorEvery: 0 });
  const c = stoneWall([...WALL_C_PTS], WALL_H, WALL_T, { ...opts, smooth: true, seed: 3, anchorEvery: 15 });
  root.add(a.object, c.object);
  hd.breach.intact.add(b.object);
  const keep = hd.colliders.filter((d) => !WALL_TAGS.has(d.opts?.tag ?? ''));
  hd.colliders.length = 0;
  hd.colliders.push(...keep, ...a.colliders, ...c.colliders);
  hd.breach.intactColliders.length = 0;
  hd.breach.intactColliders.push(...b.colliders);
  // the builder's rubble collider is a 1.6 m block that seals the breach: make it a low, walkable heap
  const bc = hd.breach.brokenColliders;
  for (let i = 0; i < bc.length; i++) {
    if (bc[i].opts?.tag === 'rubble') bc[i] = { kind: 'box', center: [5, 0.12, -6.5], half: [5.6, 0.24, 4.5], opts: { material: 'stone', tag: 'rubble' } };
  }
}

export function buildWorld(level: LevelAPI, startBreached: boolean): HelmsWorld {
  const { physics, fx } = level.ctx;

  // ── terrain ─────────────────────────────────────────────────────────────
  // ~3.3 m cells: the cliffs dissolve into the storm fog long before the facets show
  const terrain = level.terrain({
    size: 640, segments: 184, height: terrainHeight, style: 'plains', material: 'dirt', center: [20, 120],
    theme: 'wet', layers: ['grass', 'mud', 'cliff'], patchiness: 0.72, cavity: 0.7,
  });
  const ground = terrain.heightAt;

  // ── the fortress ────────────────────────────────────────────────────────
  const hd = helmsDeep({ seed: 7 });
  fixWalls(hd);
  level.root.add(hd.object);
  hd.object.updateMatrixWorld(true);
  addColliders(physics, hd.colliders);
  hd.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    // the court paving: the builder tiles 2 m flagstones; halve them so the cobbles read at scale
    const g = m.geometry as THREE.PlaneGeometry;
    if (g.type === 'PlaneGeometry' && g.parameters.width === 150) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
      uv.needsUpdate = true;
    }
  });

  // the breach: intact culvert section first, the blasted gap after the explosion
  let breachHandles: ColliderHandle[] = [];
  let breached = false;
  const pool = lake({ center: [5, -15.5], halfSize: [11.5, 8.5], y: 0.16, depth: 0.45, color: 0x1a2430, shallow: 0x30383c, foam: 0.25, ripple: 1.4, opacity: 0.92 });
  pool.object.visible = false;
  pool.object.receiveShadow = true;
  level.root.add(pool.object);
  const setBreached = (on: boolean) => {
    breached = on;
    removeColliders(physics, breachHandles);
    hd.breach.intact.visible = !on;
    hd.breach.broken.visible = on;
    breachHandles = addColliders(physics, on ? hd.breach.brokenColliders : hd.breach.intactColliders);
    pool.object.visible = on;
  };
  setBreached(startBreached);

  // the stair head: the builder's stair stops 6 m short of the wall's inner face; fill it with a
  // stone landing block so the walkway runs straight onto the stair
  {
    const w = wallAt(L.stairTop.x);
    const z0 = w.c.z - WALL_T / 2 + 0.4;
    const z1 = L.stairTop.z - 0.1;
    const depth = z0 - z1;
    const hgt = WALL_H + 1.5;
    const block = stoneBox(9.2, hgt, depth);
    block.position.set(L.stairTop.x, WALL_H - hgt / 2, (z0 + z1) / 2);
    level.root.add(block);
    physics.addBox(block.position.clone(), [4.6, hgt / 2, depth / 2], 0, { material: 'stone', tag: 'stair_head' });
  }
  // an invisible guard along the inner edge of the walkway (the open drop into the court), with a
  // gap where the stair head joins
  const guard = (x: number, half: number) => {
    const w = wallAt(x);
    const p = w.c.clone().addScaledVector(w.n, -(WALL_T / 2 - 0.12));
    // tall enough that a (double) jump cannot clear it
    p.y = WALL_H + 2.2;
    physics.addBox(p, [half, 2.2, 0.14], Math.atan2(w.n.x, w.n.z), { solid: true, walkable: false, blocksArrows: false, blocksCamera: false, tag: 'inner_guard' });
  };
  for (let x = -58.5; x < 61; x += 3) if (Math.abs(x - L.stairTop.x) >= 5.2) guard(x, 1.62);
  // close the slivers either side of the stair head (it is 9.2 m wide)
  guard(L.stairTop.x - 5.35, 0.8);
  guard(L.stairTop.x + 5.35, 0.8);

  // the causeway ramp up from the court (the builder's causeway stands 6 m proud of the court)
  const ramp = stairs([L.rampFoot.x, 0, L.rampFoot.z + 0.5], [L.causewayStart.x, 5.85, L.causewayStart.z + 0.4], 8, { riser: 0.2, material: 'light', ramp: true });
  level.root.add(ramp.object);
  addColliders(physics, ramp.colliders);

  const place = (b: Built, x: number, y: number, z: number, yaw = 0): Built => {
    b.object.position.set(x, y, z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    addColliders(physics, b.colliders, b.object);
    return b;
  };

  // ── banners of Rohan along the inner edge of the walkway and on the keep ─
  const ROHAN = 0x23472a;
  for (const x of [-50, -37, -21, -7, 9, 26, 40, 54]) {
    const w = wallAt(x);
    const p = w.c.clone().addScaledVector(w.n, -2.05);
    place(banner(ROHAN, 'horse', { height: 4.6, clothW: 1.2, clothH: 2.7 }), p.x, WALL_H, p.z, yawOf(-w.n.x, -w.n.z));
  }
  for (const dx of [-9, 9]) place(banner(ROHAN, 'horse', { height: 6, clothW: 1.6, clothH: 3.6 }), 76 + dx, 29.6, -26.4, Math.PI);

  // ── fire: the builder's braziers along the wall tops + wall torches in the court ─
  const fireSpots: THREE.Vector3[] = [];
  for (const f of hd.anchors.fires) fireSpots.push(new THREE.Vector3(f.pos[0] + f.out[0] * 1.6, f.pos[1] + 1.0 * 0.9, f.pos[2] + f.out[2] * 1.6));
  const torchSpots: THREE.Vector3[] = [];
  const wallTorch = (p: THREE.Vector3, yaw: number) => {
    const t = torch({ wall: true, lit: true, length: 0.9 }) as Built & { flameAnchor: THREE.Object3D };
    t.object.position.copy(p);
    t.object.rotation.y = yaw;
    level.root.add(t.object);
    t.object.updateMatrixWorld(true);
    torchSpots.push(t.flameAnchor.getWorldPosition(new THREE.Vector3()));
  };
  for (const x of [-44, -24, -10, 20, 38, 52]) {
    const w = wallAt(x);
    const p = w.c.clone().addScaledVector(w.n, -WALL_T / 2 - 0.05);
    p.y = 5.2;
    wallTorch(p, yawOf(-w.n.x, -w.n.z));
  }
  for (const dx of [-4.6, 4.6]) wallTorch(new THREE.Vector3(76 + dx, 9.2, -26.15), Math.PI);
  // the builder's tower-top braziers (towers project from the outer face)
  for (const t of [{ x: -42, z: 2.5, size: 4.6, hgt: WALL_H + 5 }, { x: -18, z: -2.5, size: 4.2, hgt: WALL_H + 3 }, { x: 30, z: -10, size: 4.6, hgt: WALL_H + 5 }]) {
    fireSpots.push(new THREE.Vector3(t.x + t.size * 0.55, t.hgt + 1.0, t.z + 3.8 - t.size * 0.55));
  }
  // braziers where the fighting happens in the court: the stair foot, by the breach, the causeway
  const courtFires: [number, number, number][] = [
    [-36.5, 0.04, -70], [-23.5, 0.04, -70], [-36, 0.04, -40], [-24, 0.04, -24], [-10, 0.04, -24], [20, 0.04, -24],
    [70.5, 0.04, -97], [81.5, 0.04, -97], [72.6, 5.82, -45], [79.4, 5.82, -45], [72.6, 5.82, -60], [79.4, 5.82, -60],
  ];
  for (const [x, y, z] of courtFires) {
    const b = brazier({ scale: 1.1 }) as Built & { flameAnchor: THREE.Object3D };
    place(b, x, y, z, 0);
    b.object.updateMatrixWorld(true);
    torchSpots.push(b.flameAnchor.getWorldPosition(new THREE.Vector3()));
  }
  for (const f of [...fireSpots, ...torchSpots]) fx.fire(f, 0.5);

  // ── the court: stores, racks, barrels by the stair foot and the causeway ramp ─
  const rng = level.rng;
  const props: [Built, number, number, number][] = [
    [crate(1.0, { seed: 1 }), -36.5, -64, 0.3], [crate([0.9, 0.7, 0.9], { seed: 2 }), -37.4, -62.6, -0.2], [barrel({ seed: 3 }), -36.2, -60.8, 0],
    [barrel({ seed: 4, lying: true }), -24, -63, 1.2], [weaponRack({ width: 2.4, seed: 5 }), -22.8, -58, Math.PI / 2],
    [crate(1.1, { seed: 6 }), 64, -88, 0.5], [crate([1.2, 0.8, 1.0], { seed: 7 }), 65.4, -86.6, 0.1], [barrel({ seed: 8 }), 66, -90, 0],
    [barrel({ seed: 9 }), 86.5, -90.2, 0], [weaponRack({ width: 2.6, seed: 10 }), 87.5, -84, -Math.PI / 2], [barrel({ seed: 11, open: true }), 85.6, -92, 0],
    [crate(0.9, { seed: 12 }), 30, -40, 0.7], [barrel({ seed: 13 }), 31.4, -41.2, 0], [crate([1.4, 0.9, 1.1], { seed: 14 }), -48, -30, 0.2],
    [barrel({ seed: 15 }), -46.8, -28.6, 0], [weaponRack({ width: 2.2, seed: 16 }), 44, -25, Math.PI],
  ];
  for (const [b, x, z, yaw] of props) place(b, x, 0.04, z, yaw);
  for (let i = 0; i < 6; i++) {
    const x = -14 + rng() * 40;
    const z = -42 - rng() * 30;
    place(barrel({ seed: 30 + i, lying: rng() < 0.4 }), x, 0.04, z, rng() * 6);
  }

  // ── rocks: the cliff toes and the stony coomb ───────────────────────────
  const rocks = [
    boulderField({ center: new THREE.Vector3(-76, 0, 20), halfSize: [10, 60] }, 28, [2.2, 6.5], ground, { seed: 3, kind: 'cliff', moss: 0.15, clump: 0.5, colliderMin: 99 }),
    boulderField({ center: new THREE.Vector3(106, 0, -62), halfSize: [8, 50] }, 20, [2.5, 7], ground, { seed: 4, kind: 'cliff', moss: 0.1, clump: 0.5, colliderMin: 99 }),
    boulderField({ center: new THREE.Vector3(10, 0, -138), halfSize: [80, 8] }, 26, [3, 8], ground, { seed: 5, kind: 'cliff', moss: 0.1, clump: 0.5, colliderMin: 99 }),
    boulderField({ center: new THREE.Vector3(4, 0, 44), halfSize: [70, 30] }, 70, [0.25, 1.3], ground, {
      seed: 6, kind: 'rock', moss: 0.05, clump: 0.6, colliderMin: 99,
      exclude: (x, z) => z < 14 || Math.abs(x - 5) < 6,
    }),
  ];
  for (const r of rocks) {
    level.root.add(r.object);
    addColliders(physics, r.colliders);
  }

  // ── the shield at the head of the stair ─────────────────────────────────
  const shield = createWeapon('shield', 4);
  shield.rotation.set(0, 0.6, Math.PI / 2);
  shield.position.set(L.shield.x, WALL_H + 0.1, L.shield.z);
  shield.traverse((o) => (o.castShadow = true));
  level.root.add(shield);

  // ── the Uruk host: thousands in the coomb, the front ranks with ladders and torches ─
  const host = level.crowd({ center: L.armyCenter, halfSize: [115, 32], count: 1900, kind: 'uruk', facing: Math.PI, speed: 0, props: true });
  const front = level.crowd({ center: new THREE.Vector3(4, 0, 58), halfSize: [80, 7], count: 440, kind: 'uruk', facing: Math.PI, speed: 0, props: true });
  // a sea of torches over the host (the crowd's own torch figures are too small to read through the rain)
  const torchSea = makeTorchSea(ground, rng, [
    { c: L.armyCenter, h: [115, 32], n: 520 },
    { c: new THREE.Vector3(4, 0, 58), h: [80, 7], n: 110 },
  ]);
  level.root.add(torchSea.points);
  // the armies are far from the camera: keep them out of the GTAO / depth pre-passes (half their cost on High)
  host.mesh.userData.noAO = true;
  front.mesh.userData.noAO = true;

  // ── the Galadhrim on the far battlements: instanced figures on the walkway (y = 14) ─
  const elves: CrowdHandle[] = [];
  const onWall = () => WALL_H;
  for (const [x0, x1] of [[-58, -51], [-51, -45.5], [34, 41], [41, 48], [48, 56]]) {
    const xm = (x0 + x1) / 2;
    const p = walk(xm, 1.35);
    const w = wallAt(xm);
    const crowd = createCrowd({ center: p, halfSize: [(x1 - x0) / 2, 0.25], count: Math.round((x1 - x0) / 1.1), kind: 'elf', facing: yawOf(w.n.x, w.n.z), speed: 0 }, onWall);
    crowd.mesh.userData.noAO = true;
    level.root.add(crowd.mesh);
    elves.push(crowd);
  }

  return {
    hd,
    ground,
    setBreached,
    get breached() {
      return breached;
    },
    shield,
    pool,
    fireSpots,
    torchSpots,
    host,
    front,
    elves,
    torchSea,
    dispose() {
      for (const e of elves) e.dispose();
    },
  };
}

export type { ColliderDesc };

/** additive glow sprites at torch height over the host: one draw call */
function makeTorchSea(
  ground: (x: number, z: number) => number,
  rng: () => number,
  areas: { c: THREE.Vector3; h: [number, number]; n: number }[],
): { points: THREE.Points; setFraction(f: number): void } {
  const total = areas.reduce((s, a) => s + a.n, 0);
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let i = 0;
  for (const a of areas) {
    for (let k = 0; k < a.n; k++, i++) {
      const x = a.c.x + (rng() * 2 - 1) * a.h[0];
      const z = a.c.z + (rng() * 2 - 1) * a.h[1];
      pos[i * 3] = x;
      pos[i * 3 + 1] = ground(x, z) + 2.35 + rng() * 0.3;
      pos[i * 3 + 2] = z;
      const w = 0.75 + rng() * 0.5;
      col[i * 3] = 1.0 * w;
      col[i * 3 + 1] = (0.36 + rng() * 0.12) * w;
      col[i * 3 + 2] = 0.08 * w;
    }
  }
  // shuffle so thinning removes torches evenly over the whole host
  for (let a = total - 1; a > 0; a--) {
    const b = Math.floor(rng() * (a + 1));
    for (let c = 0; c < 3; c++) {
      const t = pos[a * 3 + c]; pos[a * 3 + c] = pos[b * 3 + c]; pos[b * 3 + c] = t;
      const u = col[a * 3 + c]; col[a * 3 + c] = col[b * 3 + c]; col[b * 3 + c] = u;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // radial glow: hot core, soft halo (generated, no image files)
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
    const v = Math.max(0, 1 - d);
    const a = Math.min(1, Math.pow(v, 2.2) * 1.4 + Math.pow(v, 8) * 2);
    const o = (y * S + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const mat = new THREE.PointsMaterial({ size: 2.1, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true });
  const points = new THREE.Points(geo, mat);
  points.name = 'torch_sea';
  points.frustumCulled = false;
  points.userData.noAO = true;
  return {
    points,
    setFraction(f: number) {
      geo.setDrawRange(0, Math.round(total * Math.max(0, Math.min(1, f))));
    },
  };
}
