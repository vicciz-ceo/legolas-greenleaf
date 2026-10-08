/**
 * The Morannon and the plain before it: terrain, the Gate, rock and ruin, banners, fires, lava
 * cracks, the invisible edge of the field and the hosts. Geometry and colliders only: no gameplay.
 */
import * as THREE from 'three';
import type { CrowdHandle, LevelAPI, WeaponKind } from '../../../core/types';
import {
  addColliders, banner, blackGate, boulderField, brazier, buildTerrain, ringColliders, rock, skeleton, type BlackGateResult, type Built,
} from '../../../world';
import { createWeapon } from '../../../creatures/weapons';
import { Rng } from '../../../core/rng';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import { HostSystem } from './hosts';
import { buildLandmarks, type Landmarks } from './landmarks';
import { FIGHT, HILL_E, HILL_W, L, V, blackGateHeight } from './layout';

export interface BlackGateWorld {
  ground: (x: number, z: number) => number;
  gate: BlackGateResult;
  hosts: HostSystem;
  landmarks: Landmarks;
  /** 0 closed .. 1 open */
  setGateOpen(t: number): void;
  /** the broken-host crowd of the fallen (for the finale) */
  dead: CrowdHandle[];
  summits: { w: THREE.Vector3; e: THREE.Vector3 };
}

/** instance every mesh of a template object at the given matrices (one draw call per sub-mesh) */
function instanceTemplate(template: THREE.Object3D, mats: THREE.Matrix4[], name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  template.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    local.multiplyMatrices(inv, mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, m.multiplyMatrices(mats[i], local));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  });
  return g;
}

/** thin glowing fissures in the ash: additive ribbons laid on the ground (one draw call) */
function lavaCracks(level: LevelAPI, ground: (x: number, z: number) => number, rng: Rng): void {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const cracks = 26;
  for (let c = 0; c < cracks; c++) {
    // anywhere on the plain outside the fighting ground
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = (rng.float() - 0.5) * 420;
      z = 20 + rng.float() * 330;
      if (Math.hypot(x - FIGHT.x, z - FIGHT.z) > 34 && Math.hypot(x - HILL_W.x, z - HILL_W.z) > 20 && Math.hypot(x - HILL_E.x, z - HILL_E.z) > 20) break;
    }
    let a = rng.float() * Math.PI * 2;
    const n = 12 + Math.floor(rng.float() * 14);
    const step = 2.2 + rng.float() * 2.4;
    const w0 = 0.12 + rng.float() * 0.18;
    for (let k = 0; k < n; k++) {
      a += (rng.float() - 0.5) * 0.9;
      const nx = x + Math.cos(a) * step;
      const nz = z + Math.sin(a) * step;
      const w = w0 * Math.sin((Math.PI * (k + 0.5)) / n) * (0.6 + 0.8 * rng.float());
      const px = -Math.sin(a) * w;
      const pz = Math.cos(a) * w;
      const y = ground(x, z) + 0.06;
      pos.push(x + px, y, z + pz, x - px, y, z - pz);
      const heat = 0.6 + 0.8 * rng.float();
      col.push(1.4 * heat, 0.42 * heat, 0.07 * heat, 1.4 * heat, 0.42 * heat, 0.07 * heat);
      if (k > 0) {
        const i = base + (k - 1) * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
      x = nx;
      z = nz;
    }
    base += n * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'lava_cracks';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.noAO = true;
  mesh.frustumCulled = false;
  level.root.add(mesh);
}

export function buildBlackGate(level: LevelAPI): BlackGateWorld {
  const { physics, fx } = level.ctx;
  const rng = new Rng(909);

  // ── terrain: a fine heightfield around the hills, a coarse apron out to the horizon ──
  const terrain = level.terrain({
    size: 470,
    segments: 176,
    height: blackGateHeight,
    style: 'ash',
    material: 'dirt',
    center: [0, 150],
    patchiness: 0.5,
    tint: 0x786e6a,
  });
  const ground = terrain.heightAt;
  const apron = buildTerrain({
    size: 2600,
    segments: 66,
    height: (x, z) => blackGateHeight(x, z) - 2.5 * (1 - smoothstep(228, 270, Math.max(Math.abs(x), Math.abs(z - 150)))),
    style: 'ash',
    tint: 0x7c706a,
    patchiness: 0.5,
    center: [0, 150],
  });
  {
    // a ring: drop the triangles under the fine terrain (no overdraw of the costly terrain shader)
    const g = apron.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const idx = g.getIndex();
    if (idx) {
      const keep: number[] = [];
      const inner = (i: number) => Math.abs(pos.getX(i) + apron.mesh.position.x) < 226 && Math.abs(pos.getZ(i) + apron.mesh.position.z - 150) < 226;
      for (let t = 0; t < idx.count; t += 3) {
        const a0 = idx.getX(t);
        const a1 = idx.getX(t + 1);
        const a2 = idx.getX(t + 2);
        if (inner(a0) && inner(a1) && inner(a2)) continue;
        keep.push(a0, a1, a2);
      }
      g.setIndex(keep);
    }
  }
  apron.mesh.castShadow = false;
  apron.mesh.userData.noAO = true;
  level.root.add(apron.mesh);

  // ── the Black Gate ────────────────────────────────────────────────────────
  const gate = blackGate({ scale: 1, seed: 3 });
  gate.object.position.set(0, 0, 0);
  gate.object.traverse((o) => {
    o.castShadow = false; // 200 m away: never in the sun's shadow box, and a huge caster list otherwise
    o.userData.noAO = true;
  });
  level.root.add(gate.object);
  // no colliders: the field is closed off 110 m out, the Gate is a backdrop

  // ── rock: boulders on the flanks of the hills, a crown of crags on each summit ──
  const keepClear = (x: number, z: number): boolean => {
    if (Math.hypot(x - FIGHT.x, z - FIGHT.z) < 27) return true;
    const arcs = [...L.arcN, ...L.arcNW, ...L.arcNE, ...L.arcW, ...L.arcE, ...L.arcS, ...L.archers];
    if (arcs.some((p) => Math.hypot(x - p.x, z - p.z) < 7)) return true;
    // the lanes the waves run up, and the pin spot
    if (Math.hypot(x - L.pin.x, z - L.pin.z) < 12) return true;
    return false;
  };
  const arcsNear = (x: number, z: number): boolean => [...L.arcN, ...L.arcNW, ...L.arcNE, ...L.arcW, ...L.arcE, ...L.arcS].some((p) => Math.hypot(x - p.x, z - p.z) < 5);
  const boulders = boulderField({ center: V(0, 0, 175), halfSize: [105, 95] }, 52, [0.5, 2.2], ground, {
    seed: 7,
    kind: 'dark',
    moss: 0,
    exclude: keepClear,
    colliderMin: 0.9,
    clump: 0.6,
  });
  boulders.object.traverse((o) => (o.castShadow = false));
  level.root.add(boulders.object);
  addColliders(physics, boulders.colliders);
  // small stones and slag chunks underfoot (no colliders): texture for the fighting ground
  const stones = boulderField({ center: V(0, 0, 178), halfSize: [64, 60] }, 55, [0.25, 0.7], ground, {
    seed: 21,
    kind: 'dark',
    exclude: (x, z) => arcsNear(x, z),
    colliderMin: 99,
    clump: 0.5,
  });
  stones.object.traverse((o) => (o.castShadow = false));
  level.root.add(stones.object);
  // far scatter, no colliders needed
  const farRocks = boulderField({ center: V(0, 0, 170), halfSize: [230, 230] }, 40, [1.0, 3.6], ground, {
    seed: 12,
    kind: 'dark',
    exclude: (x, z) => Math.hypot(x - FIGHT.x, z - FIGHT.z) < 100,
    colliderMin: 99,
  });
  farRocks.object.traverse((o) => (o.castShadow = false));
  level.root.add(farRocks.object);

  const place = (b: Built, x: number, z: number, yaw = 0, y = 0): Built => {
    b.object.position.set(x, ground(x, z) + y, z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    addColliders(physics, b.colliders, b.object);
    return b;
  };
  // crags crowning the summits and shouldering the saddle (cover, and a ragged skyline)
  const crags: [number, number, number, number][] = [
    [HILL_W.x - 4, HILL_W.z - 12, 7.5, 1], [HILL_W.x + 12, HILL_W.z + 6, 5.5, 2], [HILL_W.x - 20, HILL_W.z + 4, 6.5, 3], [HILL_W.x + 2, HILL_W.z + 18, 4.5, 4],
    [HILL_E.x + 4, HILL_E.z - 10, 7, 5], [HILL_E.x - 14, HILL_E.z + 4, 5.5, 6], [HILL_E.x + 18, HILL_E.z + 8, 6, 7], [HILL_E.x - 2, HILL_E.z + 16, 4.8, 8],
    [-30, 162, 3.4, 9], [24, 158, 3.6, 10], [-26, 196, 3.2, 11], [30, 198, 3.4, 12], [22, 146, 2.6, 14],
  ];
  for (const [x, z, s, seed] of crags) place(rock(s * 0.55, seed, { kind: 'dark', flat: 1.1, rough: 0.9, sit: true }), x, z, seed * 1.7);
  // slag spires further out (silhouettes on the horizon of the plain)
  for (let i = 0; i < 16; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = 105 + rng.float() * 120;
    const x = FIGHT.x + Math.cos(a) * r;
    const z = FIGHT.z + Math.sin(a) * r * 0.9;
    if (z < 40) continue;
    const b = rock(3 + rng.float() * 5, 30 + i, { kind: 'dark', flat: 1.8, rough: 1, sit: true });
    b.object.traverse((o) => (o.castShadow = false));
    place(b, x, z, rng.float() * 6);
  }

  // ── banners and fires ────────────────────────────────────────────────────
  const summitW = V(HILL_W.x + 4, ground(HILL_W.x + 4, HILL_W.z - 6), HILL_W.z - 6);
  const summitE = V(HILL_E.x - 4, ground(HILL_E.x - 4, HILL_E.z - 4), HILL_E.z - 4);
  place(banner(0x0e0e12, 'white_tree', { height: 11, clothW: 2.8, clothH: 5.4 }), summitW.x, summitW.z, 0.2);
  place(banner(0x2e5a2e, 'horse', { height: 10, clothW: 2.6, clothH: 5 }), summitE.x, summitE.z, -0.3);
  for (const [x, z, c, e, yaw] of [
    [-30, 168, 0x0e0e12, 'white_tree', 0.5], [30, 166, 0x2e5a2e, 'horse', -0.4], [-62, 186, 0x0e0e12, 'white_tree', 1.1], [66, 168, 0x2e5a2e, 'horse', -1.2], [2, 208, 0x0e0e12, 'white_tree', 3.1],
  ] as [number, number, number, 'white_tree' | 'horse', number][]) {
    place(banner(c, e, { height: 6.4, clothW: 1.6, clothH: 3.1 }), x, z, yaw);
  }
  // Mordor's banners along the wing walls (red eyes on black), and braziers burning on the battlements
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = s * (66 + i * 17);
      const b = banner(0x6a1410, 'eye', { height: 14, clothW: 3.4, clothH: 7 });
      b.object.position.set(x, 24, -1.6);
      b.object.rotation.y = Math.PI + s * 0.12;
      level.root.add(b.object);
      b.object.traverse((o) => (o.castShadow = false));
      const br = brazier({ lit: true, scale: 3 });
      br.object.position.set(x + s * 5, 24, -2.6);
      level.root.add(br.object);
      br.object.traverse((o) => (o.castShadow = false));
    }
  }
  // firelight for the Army of the West on both summits (lights come from the fx budget)
  fx.fire(V(summitW.x - 5, summitW.y + 0.6, summitW.z + 3), 0.8);
  fx.fire(V(summitE.x + 5, summitE.y + 0.6, summitE.z + 3), 0.8);
  const lowQ = level.ctx.settings.quality === 'low';
  const columns: [number, number, number][] = [[-210, 70, 5.5], [220, 80, 5], [-150, 300, 4.5], [190, 310, 4.5]];
  for (const [x, z, s] of columns.slice(0, lowQ ? 2 : 4)) fx.smoke(V(x, ground(x, z) + 2, z), s);

  // ── the aftermath of earlier fighting: weapons, shields, skeletons ──────────
  const scatter = (kind: WeaponKind, n: number, stuck: boolean, r0: number, r1: number) => {
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = rng.float() * Math.PI * 2;
      const r = r0 + Math.sqrt(rng.float()) * (r1 - r0);
      const x = FIGHT.x + Math.cos(a) * r;
      const z = FIGHT.z + Math.sin(a) * r * 0.85;
      if (stuck) e.set(rng.range(-0.5, 0.5), rng.float() * 6.28, rng.range(-0.5, 0.5), 'YXZ');
      else e.set(Math.PI / 2 + rng.range(-0.1, 0.1), rng.float() * 6.28, 0, 'YXZ');
      q.setFromEuler(e);
      mats.push(new THREE.Matrix4().compose(V(x, ground(x, z) + (stuck ? -0.35 : 0.04), z), q, new THREE.Vector3(1, 1, 1)));
    }
    level.root.add(instanceTemplate(createWeapon(kind, 3), mats, `scatter:${kind}`));
  };
  scatter('spear', 22, true, 14, 90);
  scatter('shield', 14, false, 22, 80);
  scatter('scimitar', 16, false, 22, 80);
  scatter('sword', 8, false, 22, 80);
  scatter('axe', 8, false, 22, 80);
  for (let i = 0; i < 5; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = 30 + rng.float() * 60;
    const x = FIGHT.x + Math.cos(a) * r;
    const z = FIGHT.z + Math.sin(a) * r * 0.85;
    if (keepClear(x, z)) continue;
    const sk = skeleton((['lying', 'sprawled', 'slumped'] as const)[i % 3], i + 3, 0.95);
    sk.object.traverse((o) => (o.castShadow = false));
    place(sk, x, z, rng.float() * 6.28);
  }
  // the fallen of both sides, lying where they fell (crowds thinned to nothing but corpses)
  const dead: CrowdHandle[] = [];
  for (const [x, z, hx, hz, n, kind] of ([
    [-60, 126, 26, 12, 16, 'orc'], [58, 120, 24, 12, 14, 'easterling'], [-98, 170, 10, 20, 12, 'orc'], [98, 164, 10, 20, 12, 'easterling'],
    [-52, 220, 14, 8, 10, 'gondor'], [48, 222, 14, 8, 10, 'rohirrim'], [0, 134, 20, 8, 12, 'orc'], [-14, 236, 20, 8, 10, 'orc'],
  ] as [number, number, number, number, number, 'orc' | 'easterling' | 'gondor' | 'rohirrim'][]).slice(0, 5)) {
    const d = level.crowd({ center: V(x, 0, z), halfSize: [hx, hz], count: n, kind, facing: rng.float() * 6.28, speed: 0 });
    d.thin(1);
    d.mesh.traverse((o) => {
      o.castShadow = false;
      o.userData.noAO = true;
    });
    dead.push(d);
  }

  lavaCracks(level, ground, rng);

  // ── the edge of the field: an invisible wall behind the enemy lines (never the Gate) ──
  addColliders(physics, ringColliders(FIGHT.x, FIGHT.z, 112, 120, -40, 140, 28, { solid: true, walkable: false, blocksArrows: false, blocksCamera: false, tag: 'bounds' }));

  // ── the hosts and the far landmarks ─────────────────────────────────────────
  const hosts = new HostSystem(level, ground);
  level.onUpdate((dt) => hosts.update(dt));
  const landmarks = buildLandmarks(level, ground);
  level.onUpdate((dt) => landmarks.update(dt));

  void fbm2;
  return {
    ground,
    gate,
    hosts,
    landmarks,
    setGateOpen: (t: number) => gate.setOpen(t),
    dead,
    summits: { w: summitW, e: summitE },
  };
}
