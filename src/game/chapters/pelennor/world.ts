/**
 * Pelennor Fields: terrain, the White City on the western horizon, the wreckage of the siege,
 * smoke columns, fires, banners, the hosts of both sides (crowds) and the far mûmak herd.
 * Geometry and colliders only: no gameplay.
 */
import * as THREE from 'three';
import type { CrowdHandle, LevelAPI } from '../../../core/types';
import {
  addColliders, banner, boulderField, buildTerrain, catapult, grassField, minasTirith, siegeTower, batteringRam, crate, barrel, type Built,
} from '../../../world';
import { applyFogCap } from '../../../world/shader';
import { cliffGeometry } from '../../../world/geom';
import { mat } from '../../../world';
import { createWeapon } from '../../../creatures/weapons';
import type { WeaponKind } from '../../../core/types';
import { Rng } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import { worldQuality } from '../../../world';
import { L, V, pelennorHeight } from './layout';

export interface PelennorWorld {
  ground: (x: number, z: number) => number;
  crowds: {
    rohirrim: CrowdHandle;
    gondor: CrowdHandle;
    orcs: CrowdHandle;
    harad: CrowdHandle;
    orcsNorth: CrowdHandle;
  };
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
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  });
  return g;
}

export function buildPelennor(level: LevelAPI): PelennorWorld {
  const { physics, fx } = level.ctx;
  const rng = new Rng(808);

  // ── terrain: a fine heightfield around the battle, a coarse apron out to the horizon ──
  const terrain = level.terrain({ size: 640, segments: 140, height: pelennorHeight, style: 'plains', material: 'grass', center: [10, 0], patchiness: 0.5, tint: 0xc4c6a2 });
  const ground = terrain.heightAt;
  const apron = buildTerrain({
    size: 3600,
    segments: 72,
    height: (x, z) => pelennorHeight(x, z) - 3 * (1 - smoothstep(312, 350, Math.max(Math.abs(x - 10), Math.abs(z)))),
    style: 'plains',
    tint: 0xbcbc9a,
    patchiness: 0.45,
  });
  {
    // a ring: drop the triangles under the fine terrain (no overdraw of the costly terrain shader)
    const g = apron.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const idx = g.getIndex();
    if (idx) {
      const keep: number[] = [];
      const inner = (i: number) => Math.abs(pos.getX(i) + apron.mesh.position.x - 10) < 290 && Math.abs(pos.getZ(i) + apron.mesh.position.z) < 290;
      for (let t = 0; t < idx.count; t += 3) {
        const a0 = idx.getX(t), a1 = idx.getX(t + 1), a2 = idx.getX(t + 2);
        if (inner(a0) && inner(a1) && inner(a2)) continue;
        keep.push(a0, a1, a2);
      }
      g.setIndex(keep);
    }
  }
  apron.mesh.castShadow = false;
  apron.mesh.userData.noAO = true;
  level.root.add(apron.mesh);

  // ── Minas Tirith on the western horizon, Mindolluin behind it ──
  const city = minasTirith({ scale: 0.72, fires: true, seed: 3 });
  city.object.position.set(L.city.x, pelennorHeight(L.city.x, L.city.z) - 6, L.city.z);
  city.object.rotation.y = Math.PI / 2;
  city.object.traverse((o) => (o.castShadow = false));
  level.root.add(city.object);
  // the dark mountains of Shadow on the eastern horizon, against the morning sun
  const ridgeMat = mat('cliff', { key: 'pelennorRidge', rgb: [0.42, 0.4, 0.42] });
  applyFogCap(ridgeMat, 0.9);
  for (const [x, z, w, h, seed] of [[1700, -500, 1400, 420, 3], [1850, 300, 1600, 520, 5], [1600, 1000, 1200, 360, 8]] as [number, number, number, number, number][]) {
    const g = cliffGeometry(w, h, 300, seed, { rough: 1.4, taper: 0.7, strata: 0.1, cell: 60, tile: 120 });
    const ridge = new THREE.Mesh(g, ridgeMat);
    ridge.position.set(x, h * 0.35, z);
    ridge.rotation.y = Math.PI / 2 + (seed - 5) * 0.08;
    ridge.castShadow = false;
    ridge.userData.noAO = true;
    level.root.add(ridge);
  }

  // ── trampled grass: thin where hooves and feet churned the field into mud ──
  const churn = (x: number, z: number) => {
    const ring = Math.abs(Math.hypot((x - 6) / 62, (z + 6) / 46) - 1) * 50; // the mûmak's loop
    const ruts = Math.abs(Math.sin(z * 0.21 + Math.sin(x * 0.03) * 2.2));
    return smoothstep(2, 9, ring) * (0.35 + 0.65 * smoothstep(0.25, 0.8, ruts));
  };
  level.root.add(grassField({ center: V(10, 0, 0), halfSize: [70, 70] }, 0.45, ground, { seed: 8, dry: 0.45, fade: [20, 46], height: [0.25, 0.6], mask: churn }));

  // ── wreckage of the siege: towers, catapults, a ram, crates and spilled barrels ──
  const place = (b: Built, x: number, z: number, yaw = 0, tilt: [number, number] = [0, 0]): Built => {
    b.object.position.set(x, ground(x, z), z);
    b.object.rotation.set(tilt[0], yaw, tilt[1], 'YXZ');
    level.root.add(b.object);
    if (tilt[0] === 0 && tilt[1] === 0) addColliders(physics, b.colliders, b.object);
    return b;
  };
  place(siegeTower({ height: 15, burnt: true, seed: 1 }), -64, -36, 1.2);
  place(siegeTower({ height: 13, burnt: true, seed: 2 }), 58, 74, -0.4, [0.08, 0.22]);
  place(siegeTower({ height: 14, burnt: false, seed: 3 }), -112, 52, 0.9);
  place(siegeTower({ height: 16, burnt: true, seed: 4 }), 120, -90, 2.4);
  place(siegeTower({ height: 14, burnt: true, seed: 5 }), 34, -46, 2.0, [0.05, -0.12]);
  place(catapult({ broken: true, seed: 1 }), -34, -58, 0.3);
  place(catapult({ broken: true, seed: 2 }), 66, -30, 2.1, [0.12, -0.2]);
  place(catapult({ broken: false, seed: 3 }), -82, 8, 1.6);
  place(catapult({ broken: true, seed: 4 }), 28, 86, -1.0);
  place(batteringRam({ seed: 1 }), -96, -18, 0.6, [0, 0.35]);
  for (const [x, z] of [[-60, -30], [52, 68], [-30, -54]]) {
    for (let k = 0; k < 3; k++) place(crate(0.8 + rng.float() * 0.4, { seed: k }), x + rng.range(-4, 4), z + rng.range(-4, 4), rng.float() * 3);
    place(barrel({ seed: 5, lying: true }), x + rng.range(-3, 3), z + rng.range(-3, 3), rng.float() * 3);
  }
  // fires smouldering in the wrecks (lights come from the fx budget) and smoke columns over the field
  // (big soft particles are the costliest thing to rasterise: fewer columns on the low preset)
  const low = worldQuality() === 'low';
  for (const [x, z, s] of [[-64, -36, 1.1], [58, 74, 1.4], [34, -46, 1.3]] as [number, number, number][]) {
    fx.fire(V(x, ground(x, z) + 1.2, z), s);
    if (!low || x > 0) fx.smoke(V(x, ground(x, z) + 4, z), 1.8);
  }
  const columns: [number, number, number][] = [[-240, -120, 5], [210, -60, 5.5], [280, 120, 5], [-420, 40, 6], [160, 300, 4.5], [-180, 160, 4.5], [90, -240, 4]];
  for (const [x, z, s] of columns.slice(0, low ? 3 : 7)) fx.smoke(V(x, ground(x, z) + 2, z), s);

  // stones flung by the catapults of Mordor, scattered rubble
  const rubble = boulderField({ center: V(10, 0, 0), halfSize: [110, 110] }, 46, [0.4, 1.9], ground, {
    seed: 4,
    moss: 0,
    exclude: (x, z) => Math.hypot(x - 8, z) < 26,
  });
  level.root.add(rubble.object);
  addColliders(physics, rubble.colliders);

  // banners: Rohan (fallen and standing), Gondor, and the red of Harad
  const bnr = (color: number, emblem: Parameters<typeof banner>[1], x: number, z: number, yaw: number, tilt: [number, number] = [0, 0], h = 3.8) =>
    place(banner(color, emblem, { height: h, clothW: 1.2, clothH: 2.4 }), x, z, yaw, tilt);
  bnr(0x2e5a2e, 'horse', -14, -16, 0.4);
  bnr(0x2e5a2e, 'horse', -22, 14, 1.2, [0.5, 0.2]);
  bnr(0x111114, 'white_tree', -40, -6, 1.6, [0, 0], 4.4);
  bnr(0x2e5a2e, 'horse', 18, -26, -0.6, [0.9, -0.3]);
  bnr(0x8a1a12, 'none', 40, 30, 2.6, [0.25, 0.4], 4.2);
  bnr(0x8a1a12, 'none', 62, -14, -2.8, [0, 0], 4.6);
  bnr(0x8a1a12, 'none', 34, -48, 2.0, [1.1, 0.2], 4.2);
  bnr(0x111114, 'white_tree', -70, 30, 0.8, [0.7, 0], 4.2);

  // spent arrows, broken spears, dropped shields and blades across the churned ground
  const scatter = (kind: WeaponKind, n: number, stuck: boolean, r0: number, r1: number) => {
    const mats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = rng.float() * Math.PI * 2;
      const r = r0 + Math.sqrt(rng.float()) * (r1 - r0);
      const x = 8 + Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (stuck) e.set(rng.range(-0.5, 0.5), rng.float() * 6.28, rng.range(-0.5, 0.5), 'YXZ');
      else e.set(Math.PI / 2 + rng.range(-0.1, 0.1), rng.float() * 6.28, 0, 'YXZ');
      q.setFromEuler(e);
      const y = ground(x, z) + (stuck ? -0.35 : 0.04);
      mats.push(new THREE.Matrix4().compose(V(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    }
    const tpl = createWeapon(kind, 3);
    level.root.add(instanceTemplate(tpl, mats, `scatter:${kind}`));
  };
  scatter('spear', 26, true, 10, 70);
  scatter('spear', 14, false, 8, 60);
  scatter('shield', 12, false, 9, 60);
  scatter('scimitar', 12, false, 8, 55);
  scatter('sword', 8, false, 8, 55);

  // ── the hosts: Rohirrim in the north, Gondor before the city, Mordor and Harad in the east ──
  const rohirrim = level.crowd({ center: V(-30, 0, -150), halfSize: [130, 26], count: 210, kind: 'rohirrim', facing: Math.PI / 2, speed: 0, props: true });
  const gondor = level.crowd({ center: V(-250, 0, -20), halfSize: [36, 110], count: 200, kind: 'gondor', facing: Math.PI / 2, speed: 0, props: true });
  const orcs = level.crowd({ center: V(185, 0, 10), halfSize: [40, 110], count: 400, kind: 'orc', facing: -Math.PI / 2, speed: 0, props: true });
  const harad = level.crowd({ center: V(120, 0, 170), halfSize: [80, 34], count: 240, kind: 'easterling', facing: -Math.PI * 0.75, speed: 0, props: true });
  const orcsNorth = level.crowd({ center: V(150, 0, -160), halfSize: [60, 34], count: 220, kind: 'orc', facing: -Math.PI * 0.3, speed: 0, props: true });
  // the fallen: riders, men and orcs lying where they fell, away from the fighting ground
  for (const [x, z, hx, hz, n, kind] of [
    [-40, -70, 40, 18, 40, 'rohirrim'], [70, 40, 30, 30, 60, 'orc'], [-60, 60, 30, 25, 40, 'gondor'], [90, -60, 30, 25, 45, 'easterling'], [-30, 40, 16, 10, 18, 'rohirrim'], [44, -36, 14, 12, 22, 'orc'], [10, 56, 18, 8, 20, 'easterling'], [-42, -24, 10, 14, 14, 'gondor'],
  ] as [number, number, number, number, number, 'rohirrim' | 'orc' | 'gondor' | 'easterling'][]) {
    const dead = level.crowd({ center: V(x, 0, z), halfSize: [hx, hz], count: n, kind, facing: rng.float() * 6.28, speed: 0 });
    dead.thin(1);
    dead.mesh.traverse((o) => {
      o.castShadow = false;
      o.userData.noAO = true;
    });
  }
  // the hosts stand 100 m+ out, far beyond the ±35 m shadow box: never draw them into the shadow
  // pass (crowd meshes are not frustum culled, so every figure would be rendered there)
  for (const c of [rohirrim, gondor, orcs, harad, orcsNorth])
    c.mesh.traverse((o) => {
      o.castShadow = false;
      o.userData.noAO = true; // and skip the GTAO pre-pass: ambient occlusion is invisible at that range
    });
  return { ground, crowds: { rohirrim, gondor, orcs, harad, orcsNorth } };
}
