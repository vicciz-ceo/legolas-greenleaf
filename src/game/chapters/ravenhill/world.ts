/**
 * Ravenhill: the level geometry (no gameplay). Terrain, the frozen river and falls, the ruined
 * dwarven watchtower on its crag, the stone bridge (intact and broken versions), the east pinnacle,
 * set dressing, Erebor's flank in the snow haze, and the distant battle in the valley.
 */
import * as THREE from 'three';
import type { ColliderHandle, LevelAPI } from '../../../core/types';
import {
  addColliders, banner, batFlock, boulderField, brazier, brokenBridge, forest, frozenWaterfall, iceSheet, mat,
  removeColliders, rock, ruins, ruinedWatchtower, skeleton, stoneBlock, weaponRack, type Built, type BridgeResult,
} from '../../../world';
import { Rng, fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import {
  BRIDGE, BRIDGE_CX, BRIDGE_LEN, CRAG, FALLS_H, FALLS_Z, ICE_HALF, ICE_Z, L, PINNACLE, TERRAIN, TOWER, V, heightAt, riverX,
} from './layout';

export interface RavenhillWorld {
  ground: (x: number, z: number) => number;
  /** swap the intact bridge for the broken one (the collapse) */
  breakBridge(): void;
  readonly bridgeBroken: boolean;
  /** loose crown blocks on the tower that tumble down in the collapse */
  crown: { object: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }[];
  /** bridge segments in the gap that fall when it breaks */
  gapChunks: { object: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }[];
}

const noShadow = (o: THREE.Object3D) => o.traverse((c) => (c.castShadow = false));

/** the frozen river: a strip of ice following the river line, with colliders tagged 'ice' */
function iceRiver(level: LevelAPI): void {
  const z0 = ICE_Z[0] - 2;
  const z1 = ICE_Z[1] + 1;
  const nz = Math.ceil((z1 - z0) / 1.5);
  const nx = 18;
  const w = ICE_HALF + 0.6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const z = z0 + ((z1 - z0) * j) / nz;
    const cx = riverX(z);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = cx - w + 2 * w * u;
      // a hair above the river bed; pressure ridges and a slight sag toward the middle
      const y = 0.035 + fbm2(x * 0.15, z * 0.15, 2, 77) * 0.025 - (1 - Math.pow(2 * u - 1, 2)) * 0.01;
      pos.push(x, y, z);
      uv.push(x / 3.2, z / 3.2);
    }
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat('ice', { key: 'rh_river', rgb: [0.86, 0.94, 1.04] }));
  m.receiveShadow = true;
  m.name = 'ice_river';
  level.root.add(m);
  // colliders: 6 m boxes along the river, top at y 0.05, tagged ice
  const { physics } = level.ctx;
  for (let z = ICE_Z[0]; z < ICE_Z[1]; z += 6) {
    const zc = z + 3;
    const slope = (riverX(zc + 1) - riverX(zc - 1)) / 2;
    physics.addBox(V(riverX(zc), -0.2, zc), [ICE_HALF, 0.25, 3.3], Math.atan2(slope, 1), { material: 'ice', tag: 'ice', blocksCamera: false });
  }
}

/** Erebor's flank: a huge hazy mountain north of Ravenhill, baked lighting and haze (no fog) */
function ereborBackdrop(level: LevelAPI): void {
  const nx = 110;
  const nz = 60;
  const x0 = -950;
  const x1 = 750;
  const zA = 330;
  const zB = 1150;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const H = (x: number, z: number): number => {
    // the Lonely Mountain: one great massif with spurs, its peak far to the north-west
    const d = Math.hypot((x + 120) * 0.85, z - 820);
    const cone = Math.max(0, 640 - d * 0.95);
    const ridges = (1 - Math.abs(fbm2(x * 0.004, z * 0.004, 5, 91))) * 150 * smoothstep(0, 300, cone);
    const spur = Math.max(0, 260 - Math.hypot(x - 260, (z - 520) * 1.4) * 0.8);
    const foot = 20 + fbm2(x * 0.01, z * 0.01, 3, 92) * 18;
    return Math.max(foot, cone + ridges * 0.8, spur + ridges * 0.35);
  };
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = zA + ((zB - zA) * j) / nz;
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = H(x, z) - 25;
      pos[k + 2] = z;
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const sun = new THREE.Vector3(-0.45, 0.55, 0.5).normalize();
  const rockC = new THREE.Color(0x4c5562);
  const snowC = new THREE.Color(0xe6edf3);
  const haze = new THREE.Color(0xc0ccd7);
  const c = new THREE.Color();
  for (let i = 0; i < nrm.count; i++) {
    const ny = nrm.getY(i);
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const snow = smoothstep(0.55, 0.78, ny + fbm2(x * 0.02, z * 0.02, 2, 93) * 0.18) * smoothstep(40, 120, y) + (y < 60 ? 0.6 : 0);
    c.copy(rockC).lerp(snowC, Math.min(1, snow));
    const lit = 0.55 + 0.6 * Math.max(0, nrm.getX(i) * sun.x + ny * sun.y + nrm.getZ(i) * sun.z);
    c.multiplyScalar(lit);
    // aerial perspective: distance and altitude haze (the snow storm swallows the far mountain)
    const d = Math.hypot(x, z - 60);
    const hz = Math.min(0.9, 1 - Math.exp(-Math.pow(d * 0.00145, 2)) + 0.25 - y * 0.00012);
    c.lerp(haze, Math.max(0.35, hz));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.name = 'erebor_backdrop';
  m.castShadow = m.receiveShadow = false;
  m.userData.noAO = true;
  m.frustumCulled = false;
  level.root.add(m);
}

export function buildRavenhill(level: LevelAPI): RavenhillWorld {
  const { physics, fx } = level.ctx;
  const rng = new Rng(4404);
  const terrain = level.terrain({ size: TERRAIN.size, segments: TERRAIN.segments, height: heightAt, style: 'snow', material: 'snow', center: TERRAIN.center, patchiness: 0.25, cavity: 0.7 });
  const ground = terrain.heightAt;
  const add = (b: Built, x: number, y: number, z: number, yaw = 0, colliders = true): Built => {
    b.object.position.set(x, y, z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    if (colliders) addColliders(physics, b.colliders, b.object);
    return b;
  };

  // ── the frozen river and falls ──────────────────────────────────────────
  iceRiver(level);
  const falls = frozenWaterfall(18, FALLS_H, { seed: 3 });
  add(falls, riverX(FALLS_Z), 0, FALLS_Z, Math.PI);
  // break the curtain's straight edges: ice-bound boulders up both sides and along the lip
  {
    const fx0 = riverX(FALLS_Z);
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2) / 7;
      const lip = i >= 12;
      const x = lip ? fx0 + (i - 13.5) * 3.2 : fx0 + side * (8.6 + rng.float() * 1.2);
      const y = lip ? FALLS_H - 0.6 : k * (FALLS_H - 2) - 0.5;
      const r = rock(1.4 + rng.float() * 1.6, 200 + i, { kind: rng.chance(0.5) ? 'ice' : 'cliff', flat: 0.9 });
      add(r, x, y, FALLS_Z + 1.2 - rng.float() * 1.5, rng.float() * 6, false);
      if (y > 3) noShadow(r.object);
    }
  }
  // broken ice plates and upended slabs along the river
  for (let i = 0; i < 14; i++) {
    const z = ICE_Z[0] + 12 + rng.float() * (ICE_Z[1] - ICE_Z[0] - 20);
    const side = rng.chance(0.5) ? -1 : 1;
    const nearBank = rng.chance(0.65);
    const x = riverX(z) + side * (nearBank ? ICE_HALF - 1.5 - rng.float() * 2 : rng.float() * 5);
    const s = iceSheet(2.2 + rng.float() * 3.5, i + 1, { thickness: 0.35 + rng.float() * 0.3 });
    add(s, x, 0.0, z, rng.float() * 3, true);
    if (nearBank) s.object.rotation.z = side * (0.1 + rng.float() * 0.25);
  }

  // ── the gorge banks: ruined dwarven stonework, rocks, dead pines ──────────
  const onRiverLane = (x: number, z: number) => Math.abs(x - riverX(z)) < ICE_HALF + 2.5;
  for (const side of [-1, 1]) {
    const stones = ruins({ center: V(riverX(25) + side * 19, 0, 22), halfSize: [7, 42] }, 14, ground, {
      seed: side > 0 ? 7 : 8,
      material: 'dark',
      grandeur: 0.55,
      exclude: (x, z) => onRiverLane(x, z) || Math.abs(x - riverX(z)) > 26,
    });
    level.root.add(stones.object);
    addColliders(physics, stones.colliders);
  }
  // great fallen blocks and cliff boulders along the gorge walls
  const walls = boulderField({ center: V(0, 0, 0), halfSize: [48, 75] }, 44, [1.6, 4.8], ground, {
    seed: 12,
    kind: 'cliff',
    exclude: (x, z) => Math.abs(x - riverX(z)) < 20 || z > FALLS_Z - 6 || z < -60,
    clump: 0.6,
  });
  level.root.add(walls.object);
  addColliders(physics, walls.colliders);
  const bankRocks = boulderField({ center: V(0, 0, 0), halfSize: [24, 70] }, 30, [0.35, 1.3], ground, {
    seed: 13,
    kind: 'rock',
    exclude: (x, z) => onRiverLane(x, z) || z > FALLS_Z - 4,
  });
  level.root.add(bankRocks.object);
  addColliders(physics, bankRocks.colliders);
  // icefall boulders round the falls base
  const iceRocks = boulderField({ center: V(riverX(64), 0, 64), halfSize: [14, 6] }, 12, [0.6, 1.6], ground, { seed: 14, kind: 'ice', exclude: (x) => Math.abs(x - riverX(64)) < 5 });
  level.root.add(iceRocks.object);
  addColliders(physics, iceRocks.colliders);
  // pines and dead trees on the high ground, sparse and wind-bent
  const woods = forest({ center: V(0, 0, 60), halfSize: [200, 200] }, 110, [{ kind: 'pine', weight: 2 }, { kind: 'dead', weight: 3 }], ground, {
    seed: 21,
    scale: [0.75, 1.15],
    exclude: (x, z) =>
      Math.abs(x - riverX(z)) < 34 ||
      Math.hypot(x - CRAG.x, z - CRAG.z) < CRAG.r + 14 ||
      Math.hypot(x - PINNACLE.x, z - PINNACLE.z) < PINNACLE.r + 18 ||
      (z > FALLS_Z - 10 && Math.abs(x) < 30) ||
      (Math.abs(z - BRIDGE.z) < 12 && x > BRIDGE.x0 - 4 && x < BRIDGE.x1 + 4) ||
      z < -110,
    lodNear: 40,
    lodFar: 230,
    leafTint: [0.75, 0.8, 0.8],
  });
  noShadow(woods.object);
  level.root.add(woods.object);
  addColliders(physics, woods.colliders);
  // the Gundabad camp on the banks: war banners, braziers, a weapon rack, the dead of an earlier fight
  for (const [x, z, yaw] of [[riverX(52) - 13, 52, 0.4], [riverX(30) + 14, 30, -0.6], [riverX(8) - 14, 8, 0.9]] as [number, number, number][]) {
    add(banner(0x2c1a14, 'none', { height: 4.2, clothW: 1.1, clothH: 2.4 }), x, ground(x, z), z, yaw + Math.PI);
  }
  for (const [x, z] of [[riverX(46) + 13.5, 46], [riverX(14) - 13.5, 14]] as [number, number][]) {
    const b = add(brazier({ lit: true, scale: 1.1 }), x, ground(x, z), z) as Built & { flameAnchor: THREE.Object3D };
    b.object.updateMatrixWorld(true);
    fx.fire(b.flameAnchor.getWorldPosition(new THREE.Vector3()), 0.5);
    fx.smoke(b.flameAnchor.getWorldPosition(new THREE.Vector3()).add(V(0, 1, 0)), 0.5);
  }
  add(weaponRack({ width: 2.2, seed: 3 }), riverX(40) + 15, ground(riverX(40) + 15, 40), 40, -1.2);
  for (let i = 0; i < 7; i++) {
    const z = -24 + i * 12 + rng.float() * 5;
    const x = riverX(z) + (rng.chance(0.5) ? -1 : 1) * (ICE_HALF + 1 + rng.float() * 4);
    add(skeleton(rng.chance(0.5) ? 'sprawled' : 'lying', i + 2, 0.82), x, ground(x, z), z, rng.float() * 6, false);
  }

  // ── Ravenhill: the crag and its ruined watchtower ─────────────────────────
  const tower = ruinedWatchtower({ radius: TOWER.r, height: TOWER.h, thickness: 1.7, tallSide: -Math.PI / 2, seed: 5, snow: true });
  add(tower, CRAG.x, CRAG.y, CRAG.z, TOWER.yaw);
  // dwarven columns and wall stubs round the plateau rim
  const rim = ruins({ center: V(CRAG.x, 0, CRAG.z), halfSize: [CRAG.r, CRAG.r] }, 12, ground, {
    seed: 31,
    material: 'dark',
    grandeur: 0.7,
    exclude: (x, z) => {
      const d = Math.hypot(x - CRAG.x, z - CRAG.z);
      return d < TOWER.r + 3.5 || d > CRAG.r - 2 || (Math.abs(z - BRIDGE.z) < 5 && x > CRAG.x);
    },
  });
  level.root.add(rim.object);
  addColliders(physics, rim.colliders);
  const cragRocks = boulderField({ center: V(CRAG.x, 0, CRAG.z), halfSize: [CRAG.r + 16, CRAG.r + 16] }, 40, [1.6, 5], ground, {
    seed: 32,
    kind: 'cliff',
    exclude: (x, z) => {
      const d = Math.hypot(x - CRAG.x, z - CRAG.z);
      return d < CRAG.r + 1 || (Math.abs(z - BRIDGE.z) < 6 && x > CRAG.x);
    },
  });
  level.root.add(cragRocks.object);
  addColliders(physics, cragRocks.colliders);
  // crown blocks perched on the broken top of the tall wall (they fall in the collapse)
  const crown: RavenhillWorld['crown'] = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i - 3) * 0.28; // the tall side faces -x in the world
    const r = TOWER.r + (rng.float() - 0.5) * 0.6;
    const b = stoneBlock([1.2 + rng.float() * 0.8, 0.8 + rng.float() * 0.6, 1.0 + rng.float() * 0.6], 40 + i, { kind: 'dark' });
    b.object.position.set(CRAG.x + Math.cos(a) * r, CRAG.y + TOWER.h * (0.86 + rng.float() * 0.1), CRAG.z + Math.sin(a) * r);
    b.object.rotation.set(0, -a + rng.float() * 0.4, (rng.float() - 0.5) * 0.3);
    level.root.add(b.object);
    crown.push({ object: b.object, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
  }

  // ── the bridge (intact until the collapse, then the broken one) ───────────
  const deckDepth = BRIDGE.y - 22;
  const intact = brokenBridge(BRIDGE_LEN, BRIDGE.width, { seed: 6, snow: true, depth: deckDepth });
  add(intact, BRIDGE_CX, BRIDGE.y, BRIDGE.z, 0, false);
  let intactCols: ColliderHandle[] = addColliders(physics, intact.colliders, intact.object);
  const broken: BridgeResult = brokenBridge(BRIDGE_LEN, BRIDGE.width, { seed: 6, snow: true, depth: deckDepth, gap: BRIDGE.gap });
  add(broken, BRIDGE_CX, BRIDGE.y, BRIDGE.z, 0, false);
  broken.object.visible = false;
  let bridgeBroken = false;
  // the deck stones that fall out of the gap
  const gapChunks: RavenhillWorld['gapChunks'] = [];
  const gx0 = BRIDGE.x0 + BRIDGE.gap[0] * BRIDGE_LEN;
  const gx1 = BRIDGE.x0 + BRIDGE.gap[1] * BRIDGE_LEN;
  for (let i = 0; i < 8; i++) {
    const b = stoneBlock([1.8 + rng.float(), 1.0, 1.6 + rng.float()], 60 + i, { kind: 'dark' });
    b.object.position.set(gx0 + ((i + 0.5) / 8) * (gx1 - gx0), BRIDGE.y - 1.1, BRIDGE.z + (rng.float() - 0.5) * 3);
    b.object.visible = false;
    level.root.add(b.object);
    gapChunks.push({ object: b.object, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
  }

  // ── the east pinnacle summit ──────────────────────────────────────────────
  const summitRocks = boulderField({ center: V(PINNACLE.x, 0, PINNACLE.z), halfSize: [PINNACLE.r + 10, PINNACLE.r + 10] }, 26, [1.2, 3.6], ground, {
    seed: 41,
    kind: 'cliff',
    exclude: (x, z) => {
      const d = Math.hypot(x - PINNACLE.x, z - PINNACLE.z);
      return d < PINNACLE.r + 0.5 || (Math.abs(z - BRIDGE.z) < 5 && x < PINNACLE.x);
    },
  });
  level.root.add(summitRocks.object);
  addColliders(physics, summitRocks.colliders);
  add(banner(0x2c1a14, 'none', { height: 4.6, clothW: 1.2, clothH: 2.6 }), PINNACLE.x + 6.5, PINNACLE.y, PINNACLE.z + 1.2, -Math.PI / 2);
  // fallen masonry on the summit (what is left of a dwarven beacon): low cover round the rim
  for (const [dx, dz, w, h, d, yaw] of [[-3.5, 5.6, 1.8, 0.7, 1.2, 0.4], [2.5, -6.2, 2.2, 0.9, 1.3, -0.3], [6.2, 2.4, 1.4, 1.1, 1.4, 1.1], [-5.6, -4.4, 1.5, 0.6, 1.0, 2.2]] as [number, number, number, number, number, number][]) {
    const x = PINNACLE.x + dx;
    const z = PINNACLE.z + dz;
    const b = stoneBlock([w, h, d], 80 + Math.round(dx * 7), { kind: 'dark' });
    b.object.rotation.z = (rng.float() - 0.5) * 0.2;
    add(b, x, ground(x, z) - 0.15, z, yaw);
  }

  // big cliff faces under the crag and the pinnacle (dressing over the steep terrain)
  for (let i = 0; i < 18; i++) {
    const onCrag = i < 12;
    const cx = onCrag ? CRAG.x : PINNACLE.x;
    const cz = onCrag ? CRAG.z : PINNACLE.z;
    const r0 = onCrag ? CRAG.r + 5 : PINNACLE.r + 6;
    const a = (i / (onCrag ? 12 : 6)) * Math.PI * 2 + rng.float() * 0.3;
    const x = cx + Math.cos(a) * r0;
    const z = cz + Math.sin(a) * r0;
    if (Math.abs(z - BRIDGE.z) < 5 && x > CRAG.x && x < PINNACLE.x) continue;
    const r = rock(5 + rng.float() * 4, 100 + i, { kind: 'cliff', flat: 1.3, rough: 0.9 });
    add(r, x, ground(x, z) - 3, z, rng.float() * 6, false);
    noShadow(r.object);
  }

  // ── far away: Erebor, the battle in the valley, smoke, bat flocks ──────────
  ereborBackdrop(level);
  for (const c of [
    level.crowd({ center: V(L.battle.x - 20, 0, L.battle.z), halfSize: [70, 18], count: 420, kind: 'orc', facing: Math.PI * 0.1, speed: 0, props: true }),
    level.crowd({ center: V(L.battle.x + 10, 0, L.battle.z - 28), halfSize: [55, 12], count: 170, kind: 'dwarf', facing: Math.PI, speed: 0, props: true }),
    level.crowd({ center: V(L.battle.x + 70, 0, L.battle.z - 6), halfSize: [30, 20], count: 140, kind: 'elf', facing: -Math.PI / 2, speed: 0, props: true }),
  ])
    noShadow(c.mesh);
  for (const [x, z, s] of [[-40, -128, 4], [20, -150, 5], [80, -120, 3.5], [110, -150, 4.5], [-90, -140, 3]] as [number, number, number][]) fx.smoke(V(x, ground(x, z), z), s);
  for (const [x, y, z, n, r] of [[40, 70, -110, 28, 60], [-120, 110, 320, 24, 80], [120, 90, 260, 18, 50]] as [number, number, number, number, number][]) {
    const f = batFlock(n, V(x, y, z), r, { size: 2.6, seed: Math.round(x + z), height: 18 });
    level.root.add(f.object);
  }

  return {
    ground,
    crown,
    gapChunks,
    get bridgeBroken() {
      return bridgeBroken;
    },
    breakBridge() {
      if (bridgeBroken) return;
      bridgeBroken = true;
      removeColliders(physics, intactCols);
      intactCols = [];
      intact.object.visible = false;
      broken.object.visible = true;
      addColliders(physics, broken.colliders, broken.object);
      for (const c of gapChunks) c.object.visible = true;
    },
  };
}
