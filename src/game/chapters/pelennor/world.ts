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
import { applyFogCap, patchShader } from '../../../world/shader';
import { cliffGeometry } from '../../../world/geom';
import { mat } from '../../../world';
import { TILE_METERS, getTextureSet } from '../../../world/textures';
import { createWeapon } from '../../../creatures/weapons';
import type { WeaponKind } from '../../../core/types';
import { Rng, fbm2 } from '../../../core/rng';
import { clamp, smoothstep } from '../../../core/math';
import { worldQuality } from '../../../world';
import { L, V, pelennorHeight, beastCorridor } from './layout';
import { clods, debris, hostForest, mountainRing, puddles } from './scenery';

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
function instanceTemplate(template: THREE.Object3D, mats: THREE.Matrix4[], name: string, castShadow = true): THREE.Group {
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
    im.castShadow = castShadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  });
  return g;
}

/**
 * A transparent mud skin laid over the terrain (vertex alpha from `mudAt`): its own mesh so the mud
 * can follow the beasts' routes and the fight exactly, which the terrain's noise splat cannot.
 * Drawn first among the transparent objects (renderOrder -1) so smoke and decals stay on top.
 */
function churnedMud(ground: (x: number, z: number) => number, mudAt: (x: number, z: number) => number): THREE.Mesh {
  const cx = 8;
  const cz = -4;
  const W = 176;
  const D = 144;
  const step = 1.6;
  const geo = new THREE.PlaneGeometry(W, D, Math.round(W / step), Math.round(D / step)).rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 4);
  const tile = TILE_METERS.mud;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, ground(x, z) + 0.05, z);
    // a fine grain (the plates of the stock texture read as dried desert cracks at tile scale)
    uv.setXY(i, (x / tile) * 3.2, (z / tile) * 3.2);
    const edge = 1 - smoothstep(0.86, 1, Math.max(Math.abs(x - cx) / (W / 2), Math.abs(z - cz) / (D / 2)));
    const wet = 0.5 + 0.5 * fbm2(x * 0.07 + 5, z * 0.07, 3, 34);
    const shade = (0.56 + 0.5 * (0.5 + 0.5 * fbm2(x * 0.3, z * 0.3, 2, 33))) * (0.72 + 0.5 * wet);
    col[i * 4] = shade;
    col[i * 4 + 1] = shade;
    col[i * 4 + 2] = shade;
    col[i * 4 + 3] = mudAt(x, z) * edge;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.computeVertexNormals();
  // keep only the triangles that show some mud
  const idx = geo.getIndex()!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (col[a * 4 + 3] + col[b * 4 + 3] + col[c * 4 + 3] > 0.03) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  // Lambert: trodden earth has no sheen, and any specular term catches the low sun straight ahead
  // in a glare streak across the field
  const set = getTextureSet('mud');
  const m = new THREE.MeshLambertMaterial({
    map: set.map,
    normalMap: set.normalMap,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.color.setRGB(0.78, 0.64, 0.5);
  m.normalScale.set(1.7, 1.7);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'pelennor:mud';
  mesh.renderOrder = -1;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noAO = true;
  return mesh;
}

export function buildPelennor(level: LevelAPI): PelennorWorld {
  const { physics, fx } = level.ctx;
  const rng = new Rng(808);

  // ── terrain: a fine heightfield around the battle, a coarse apron out to the horizon ──
  // grass-green plains, a little darker and greener than the sun-bleached default so the field does
  // not read as sand under the morning haze (the mud is a matte overlay, churnedMud: the terrain's
  // own wet-mud layer mirrors the low sun into a glare streak)
  const terrain = level.terrain({ size: 640, segments: 140, height: pelennorHeight, style: 'plains', material: 'grass', center: [10, 0], patchiness: 0.5, tint: 0x96966f });
  const ground = terrain.heightAt;
  const apron = buildTerrain({
    size: 3600,
    segments: 72,
    height: (x, z) => pelennorHeight(x, z) - 3 * (1 - smoothstep(312, 350, Math.max(Math.abs(x - 10), Math.abs(z)))),
    style: 'plains',
    tint: 0x98986f,
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

  // ── Minas Tirith on the south-south-east horizon, Mindolluin behind it, the mountain ring beyond ──
  const city = minasTirith({ scale: 0.72, tiers: 5, fires: true, seed: 3 });
  city.object.position.set(L.city.x, pelennorHeight(L.city.x, L.city.z) - 6, L.city.z);
  city.object.rotation.y = L.cityYaw;
  city.object.traverse((o) => (o.castShadow = false));
  // Mindolluin behind it: recoloured slate and snow to match the mountain ring (the shared builder's
  // pale rock reads as a beige cone in this warm haze), and given the ring's material
  const rock = mat('cliff', { key: 'pelennorMindolluin', vertexColors: true, rgb: [0.62, 0.64, 0.7] });
  applyFogCap(rock, 0.5);
  city.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.getAttribute('color')) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    if (bb.max.y - bb.min.y <= 300) return;
    const g = m.geometry;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const nr = g.getAttribute('normal') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const hgt = bb.max.y - bb.min.y;
    for (let i = 0; i < p.count; i++) {
      const hn = (p.getY(i) - bb.min.y) / hgt;
      const ny = Math.max(0, nr.getY(i));
      const nz = 0.5 + 0.5 * fbm2(p.getX(i) * 0.012, p.getZ(i) * 0.012 + p.getY(i) * 0.004, 2, 57);
      const shade = 0.44 * (0.78 + 0.4 * nz) * (0.7 + 0.5 * ny);
      const snow = smoothstep(0.3, 0.55, hn + (ny - 0.55) * 0.3);
      col.setXYZ(i, shade * 0.9 * (1 - snow) + 1.55 * snow, shade * 0.93 * (1 - snow) + 1.6 * snow, shade * 1.06 * (1 - snow) + 1.7 * snow);
    }
    col.needsUpdate = true;
    m.material = rock;
    // a little lower: the ring's jagged ridges behind it carry the skyline, and the massif should not wall the frame
    const lower = 0.72;
    m.scale.y = lower;
    m.position.y -= (1 - lower) * (bb.max.y - bb.min.y) * 0.5;
  });
  // the white city is the brightest thing on the horizon: let it keep more of its own light in the haze
  const seen = new Set<THREE.Material>();
  city.object.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m || seen.has(m) || m === rock || m.userData.pelennorCap) return;
    seen.add(m);
    m.userData.pelennorCap = true;
    patchShader(m, 'pelennorCityCap', (shader) => {
      if (shader.uniforms.uFogCap) shader.uniforms.uFogCap.value = 0.46;
    });
  });
  level.root.add(city.object);
  // the White Mountains and the mountains of Shadow: one jagged ring inside the far plane
  mountainRing(level, 10, 0, 33);

  // ── churned mud: the beasts' trails and the fighting ground are trodden into dark wet earth ──
  const corridor = beastCorridor();
  const mudAt = (x: number, z: number): number => {
    const n = fbm2(x * 0.045, z * 0.045, 3, 31) + fbm2(x * 0.17, z * 0.17, 2, 32) * 0.45;
    const trail = 1 - smoothstep(3.5, 12, corridor(x, z));
    const fight = 1 - smoothstep(18, 66, Math.hypot(x - 8, z));
    const ruts = smoothstep(0.55, 0.95, Math.abs(Math.sin(z * 0.21 + Math.sin(x * 0.03) * 2.2)));
    const a = Math.max(trail * 0.95, fight * 0.85, ruts * fight * 0.95) * smoothstep(-0.45, 0.2, n + trail * 0.35);
    return clamp(a * 1.25, 0, 0.92);
  };
  level.root.add(churnedMud(ground, mudAt));
  // grass stays off the mud
  const churn = (x: number, z: number) => 1 - 0.9 * mudAt(x, z);
  level.root.add(grassField({ center: V(10, 0, 0), halfSize: [70, 70] }, 0.75, ground, { seed: 8, dry: 0.55, fade: [20, 46], height: [0.25, 0.6], mask: churn }));

  // ── what the churned ground is made of: puddles mirroring the sky, clods of turned earth, the
  // splintered wheels and planks of the siege (cosmetic: no colliders, clear of the beasts' routes) ──
  const okSpot = (x: number, z: number) => corridor(x, z) > 7 && Math.hypot(x - L.spawn.x, z - L.spawn.z) > 6;
  {
    const pr = new Rng(909);
    const pools: [number, number, number, number, number][] = [];
    for (let tries = 0; pools.length < (worldQuality() === 'low' ? 8 : 16) && tries < 600; tries++) {
      const a = pr.float() * Math.PI * 2;
      const d = 9 + Math.sqrt(pr.float()) * 66;
      const x = 8 + Math.cos(a) * d;
      const z = -4 + Math.sin(a) * d * 0.8;
      if (mudAt(x, z) < 0.45 || !okSpot(x, z)) continue;
      if (pools.some(([qx, qz, qr]) => Math.hypot(qx - x, qz - z) < qr * 2.4 + 6)) continue;
      pools.push([x, z, pr.range(1.7, 3.6), pr.range(1.3, 2.6), pr.float() * Math.PI]);
    }
    puddles(level, ground, pools);
  }
  const art = new Rng(1717);
  clods(level, ground, mudAt, art, V(8, 0, -4), 66, worldQuality() === 'low' ? 160 : 460);
  debris(level, ground, okSpot, art, V(8, 0, -4), 78, [[10, 15], [13, 27], [21, -4], [31, 12], [-8, 20]]);

  // ── wreckage of the siege: towers, catapults, a ram, crates and spilled barrels ──
  const place = (b: Built, x: number, z: number, yaw = 0, tilt: [number, number] = [0, 0]): Built => {
    b.object.position.set(x, ground(x, z), z);
    b.object.rotation.set(tilt[0], yaw, tilt[1], 'YXZ');
    level.root.add(b.object);
    if (tilt[0] === 0 && tilt[1] === 0) addColliders(physics, b.colliders, b.object);
    return b;
  };
  // every wreck stands at least 14 m clear of the beasts' routes (beastCorridor): a mûmak never
  // walks through a tower; the fight inside the loop stays open ground
  const WRECKS: [number, number][] = [[-80, -60], [58, 74], [-112, 52], [120, -90], [30, -72], [-34, -58], [86, -44], [-82, 8], [28, 86], [-96, -18], [-78, -18], [52, 68], [-20, -74]];
  for (const [x, z] of WRECKS) if (corridor(x, z) < 14) console.warn(`[pelennor] wreck at (${x}, ${z}) is ${corridor(x, z).toFixed(1)} m from a mûmak route`);
  place(siegeTower({ height: 15, burnt: true, seed: 1 }), -80, -60, 1.2);
  place(siegeTower({ height: 13, burnt: true, seed: 2 }), 58, 74, -0.4, [0.08, 0.22]);
  place(siegeTower({ height: 14, burnt: false, seed: 3 }), -112, 52, 0.9);
  place(siegeTower({ height: 16, burnt: true, seed: 4 }), 120, -90, 2.4);
  place(siegeTower({ height: 14, burnt: true, seed: 5 }), 30, -72, 2.0, [0.05, -0.12]);
  place(catapult({ broken: true, seed: 1 }), -34, -58, 0.3);
  place(catapult({ broken: true, seed: 2 }), 86, -44, 2.1, [0.12, -0.2]);
  place(catapult({ broken: false, seed: 3 }), -82, 8, 1.6);
  place(catapult({ broken: true, seed: 4 }), 28, 86, -1.0);
  place(batteringRam({ seed: 1 }), -96, -18, 0.6, [0, 0.35]);
  for (const [x, z] of [[-78, -18], [52, 68], [-20, -74]]) {
    for (let k = 0; k < 3; k++) place(crate(0.8 + rng.float() * 0.4, { seed: k }), x + rng.range(-4, 4), z + rng.range(-4, 4), rng.float() * 3);
    place(barrel({ seed: 5, lying: true }), x + rng.range(-3, 3), z + rng.range(-3, 3), rng.float() * 3);
  }
  // fires smouldering in the wrecks (lights come from the fx budget) and smoke columns over the field
  // (big soft particles are the costliest thing to rasterise: fewer columns on the low preset)
  const low = worldQuality() === 'low';
  for (const [x, z, s] of [[-80, -60, 1.1], [58, 74, 1.4], [30, -72, 1.3]] as [number, number, number][]) {
    fx.fire(V(x, ground(x, z) + 1.2, z), s);
    if (!low || x > 0) fx.smoke(V(x, ground(x, z) + 4, z), 1.8);
  }
  // the burning field: tall columns with a broad base (a wide emitter on the ground and a second,
  // larger one high in the column, so they rise as pillars instead of puffs)
  const columns: [number, number, number][] = [
    [210, -60, 5.5], [280, 120, 5], [160, 300, 4.5], [110, 165, 4.5], [-240, -120, 5], [330, 250, 6], [-420, 40, 6], [-180, 160, 4.5], [90, -240, 4],
  ];
  columns.slice(0, low ? 3 : 9).forEach(([x, z, s], i) => {
    fx.smoke(V(x, ground(x, z) + 2, z), s * 1.25);
    if (!low && i < 6) fx.smoke(V(x + 4, ground(x, z) + 26 * (s / 5), z + 2), s * 1.5);
  });
  // the skyline: more towers and engines of the siege standing and burning in the middle distance,
  // the silhouettes that break the horizon line between the hosts (all beyond the beasts' loops)
  for (const [x, z, h, yaw, burnt, seed, tilt] of [
    [230, -150, 17, 2.7, true, 6, [0, 0]], [300, 30, 16, 1.9, false, 7, [0.06, 0.1]], [150, 210, 18, -0.6, true, 8, [0, 0]],
    [-200, 120, 15, 0.4, true, 9, [0.1, -0.15]], [320, 150, 17, 2.2, true, 10, [0, 0]], [-150, -190, 16, 1.1, false, 11, [0, 0]],
  ] as [number, number, number, number, boolean, number, [number, number]][]) {
    place(siegeTower({ height: h, burnt, seed }), x, z, yaw, tilt);
  }
  for (const [x, z, sc] of [[230, -150, 2.4], [150, 210, 2.6], [320, 150, 2.4], [-200, 120, 2.0]] as [number, number, number][]) {
    fx.fire(V(x, ground(x, z) + 2.5, z), sc);
    fx.smoke(V(x, ground(x, z) + 8, z), sc * 2.4);
  }
  // Minas Tirith burning on its hill: flames in the tiers and columns of smoke leaning off to the north-west
  {
    const cb = city.object;
    const lp = new THREE.Vector3();
    const cityAt = (lx: number, ly: number, lz: number) => cb.localToWorld(lp.set(lx, ly, lz)).clone();
    const flames: [number, number, number, number][] = [[-45, 32, 116, 6], [30, 40, 110, 7], [50, 100, 46, 6.5], [-25, 106, 50, 6], [6, 170, -18, 5.5]];
    flames.slice(0, low ? 3 : 5).forEach(([lx, ly, lz, sc]) => {
      const w = cityAt(lx, ly, lz);
      fx.fire(w, sc);
      fx.smoke(V(w.x, w.y + 10, w.z), sc * 1.3);
    });
    if (!low) for (const [lx, ly, lz, sc] of [[10, 240, -25, 5.5], [-54, 70, 80, 5]] as [number, number, number, number][]) fx.smoke(cityAt(lx, ly, lz), sc);
  }

  // stones flung by the catapults of Mordor, scattered rubble
  const rubble = boulderField({ center: V(10, 0, 0), halfSize: [110, 110] }, 46, [0.4, 1.9], ground, {
    seed: 4,
    moss: 0,
    exclude: (x, z) => Math.hypot(x - 8, z) < 26 || corridor(x, z) < 9,
  });
  level.root.add(rubble.object);
  addColliders(physics, rubble.colliders);

  // banners: Rohan (fallen and standing), Gondor, and the red of Harad
  const bnr = (color: number, emblem: Parameters<typeof banner>[1], x: number, z: number, yaw: number, tilt: [number, number] = [0, 0], h = 3.8) =>
    place(banner(color, emblem, { height: h, clothW: 1.2, clothH: 2.4 }), x, z, yaw, tilt);
  // (clear of the routes too: none stands where a beast walks)
  bnr(0x2e5a2e, 'horse', -4, 10, 0.4);
  bnr(0x2e5a2e, 'horse', -8, 24, 1.2, [0.5, 0.2]);
  bnr(0x111114, 'white_tree', -20, -2, 1.6, [0, 0], 4.4);
  bnr(0x2e5a2e, 'horse', 22, -18, -0.6, [0.9, -0.3]);
  bnr(0x8a1a12, 'none', 14, 22, 2.6, [0.25, 0.4], 4.2);
  bnr(0x8a1a12, 'none', 42, -6, -2.8, [0, 0], 4.6);
  bnr(0x8a1a12, 'none', 28, -70, 2.0, [1.1, 0.2], 4.2);
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
    // small and flat on the ground: no shadow pass (a few hundred triangles per instance)
    level.root.add(instanceTemplate(tpl, mats, `scatter:${kind}`, false));
  };
  scatter('spear', 26, true, 10, 70);
  scatter('spear', 14, false, 8, 60);
  scatter('shield', 12, false, 9, 60);
  scatter('scimitar', 12, false, 8, 55);
  scatter('sword', 8, false, 8, 55);

  // ── the hosts: Rohirrim in the north, Gondor before the city, Mordor and Harad in the east ──
  // Every crowd figure costs ~450–580 triangles whatever it carries (`props` only swaps weapons), so
  // the budget lever is the head count: the high preset (whose crowd density would be 1/0.7 of
  // medium's) is held a little under the medium head count: at 100–250 m in the haze the extra
  // ranks never read, and the triangles go to the beasts and the fighters up close (High peaked at
  // 1.85 M with the full hosts; budget 1.5 M).
  const hq = worldQuality() === 'high' || worldQuality() === 'ultra';
  const heads = (count: number) => Math.round(count * (hq ? 0.55 : 1));
  const rohirrim = level.crowd({ center: V(-30, 0, -150), halfSize: [130, 26], count: heads(210), kind: 'rohirrim', facing: Math.PI / 2, speed: 0, props: true });
  const gondor = level.crowd({ center: V(-250, 0, -20), halfSize: [36, 110], count: heads(200), kind: 'gondor', facing: Math.PI / 2, speed: 0, props: true });
  const orcs = level.crowd({ center: V(185, 0, 10), halfSize: [40, 110], count: heads(400), kind: 'orc', facing: -Math.PI / 2, speed: 0, props: true });
  const harad = level.crowd({ center: V(120, 0, 170), halfSize: [80, 34], count: heads(240), kind: 'easterling', facing: -Math.PI * 0.75, speed: 0, props: true });
  const orcsNorth = level.crowd({ center: V(150, 0, -160), halfSize: [60, 34], count: heads(220), kind: 'orc', facing: -Math.PI * 0.3, speed: 0, props: true });
  // the fallen: riders, men and orcs lying where they fell, away from the fighting ground
  for (const [x, z, hx, hz, n, kind] of [
    [-40, -70, 40, 18, 40, 'rohirrim'], [70, 40, 30, 30, 60, 'orc'], [-60, 60, 30, 25, 40, 'gondor'], [90, -60, 30, 25, 45, 'easterling'], [-30, 40, 16, 10, 18, 'rohirrim'], [44, -36, 14, 12, 22, 'orc'], [10, 56, 18, 8, 20, 'easterling'], [-42, -24, 10, 14, 14, 'gondor'],
  ] as [number, number, number, number, number, 'rohirrim' | 'orc' | 'gondor' | 'easterling'][]) {
    const dead = level.crowd({ center: V(x, 0, z), halfSize: [hx, hz], count: hq ? Math.round(n * 0.45) : n, kind, facing: rng.float() * 6.28, speed: 0 });
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
  // the pike-forests and standards of the hosts: instanced shafts behind and between the crowd figures
  hostForest(
    level,
    ground,
    [
      { cx: 200, cz: 10, hx: 56, hz: 120, flag: 0x7a1a12, n: 950 },
      { cx: 125, cz: 180, hx: 95, hz: 44, flag: 0x8f1d16, n: 760 },
      { cx: 155, cz: -165, hx: 76, hz: 44, flag: 0x2a201c, n: 640 },
      { cx: -255, cz: -20, hx: 44, hz: 120, flag: 0xc8c8c0, n: 520 },
      { cx: -35, cz: -155, hx: 140, hz: 32, flag: 0x32602c, n: 520 },
    ],
    (
      [
        [96, 44, 9, 0x8e1c14], [112, -34, 8, 0x8e1c14], [132, 104, 9.5, 0x8e1c14], [152, 62, 8, 0x8e1c14], [82, 134, 8.5, 0x8e1c14], [172, 150, 10, 0x8e1c14],
        [124, -66, 10, 0x14110e], [162, -122, 9, 0x14110e], [98, -92, 8, 0x14110e], [210, -20, 9.5, 0x8e1c14],
        [-20, -112, 8, 0x2f5a2c], [-70, -132, 8, 0x2f5a2c], [32, -122, 7.5, 0x2f5a2c], [-120, -140, 8, 0x2f5a2c],
        [-172, -30, 9, 0xd8d4c8], [-192, 42, 8.5, 0xd8d4c8], [-162, 74, 8, 0xd8d4c8], [-210, -80, 9, 0x20201e],
      ] as [number, number, number, number][]
    ).filter(([x, z]) => corridor(x, z) > 18),
    art,
  );
  return { ground, crowds: { rohirrim, gondor, orcs, harad, orcsNorth } };
}
