/**
 * World self-test (dev tool): builds every builder, checks geometry for NaN, counts triangles / draw calls,
 * validates colliders and the terrain heightAt against raycasts.
 *   node scripts/snap.mjs "/src/world/tools/test.html" --eval "JSON.stringify(window.__testResult)"
 */
import * as THREE from 'three';
import { setWorldQuality } from '../quality';
import { buildTerrain } from '../terrain';
import { createCrowd } from '../crowd';
import * as V from '../vegetation';
import * as P from '../props';
import * as A from '../architecture';
import { lake, river } from '../water';
import { fbm2 } from '../../core/rng';
import { addColliders, type ColliderDesc } from '../colliders';
import { createPhysics } from '../../physics/world';

setWorldQuality('high');
const results: Record<string, unknown> = {};
const problems: string[] = [];
const w = window as unknown as Record<string, unknown>;

function stats(name: string, obj: THREE.Object3D, colliders: readonly ColliderDesc[] = []): void {
  let tris = 0;
  let meshes = 0;
  let instances = 0;
  let bad = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.collider) return;
    meshes++;
    const g = m.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const count = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    instances += count;
    tris += (g.index ? g.index.count : pos.count) / 3 * count;
    for (let i = 0; i < pos.array.length; i += 1) if (!Number.isFinite(pos.array[i])) { bad++; break; }
    const nor = g.getAttribute('normal');
    if (nor) for (let i = 0; i < nor.array.length; i += 1) if (!Number.isFinite(nor.array[i])) { bad++; break; }
    if (!g.getAttribute('uv') && !(m.material as THREE.Material).name.includes('flame') && !g.getAttribute('aWUv') && !g.getAttribute('aFlow') && !g.getAttribute('aOrbit') && !g.getAttribute('aAnim') && !g.getAttribute('color')) {
      if (!(m.material as THREE.ShaderMaterial).isShaderMaterial && (m.material as THREE.MeshStandardMaterial).map) problems.push(`${name}: textured mesh without uv (${m.name})`);
    }
  });
  let cbad = 0;
  for (const c of colliders) {
    if (c.kind === 'box') {
      if (![...c.center, ...c.half].every(Number.isFinite) || c.half.some((h) => h <= 0)) cbad++;
    } else if (c.kind === 'cyl') {
      if (![c.x, c.z, c.r, c.y0, c.y1].every(Number.isFinite) || c.r <= 0 || c.y1 <= c.y0) cbad++;
    } else if (!c.mesh.geometry.getAttribute('position')) cbad++;
  }
  if (bad) problems.push(`${name}: ${bad} geometry attributes with NaN/Infinity`);
  if (cbad) problems.push(`${name}: ${cbad} invalid colliders`);
  results[name] = { ...((results[name] as object) ?? {}), tris: Math.round(tris), meshes, instances, colliders: colliders.length };
}

function time<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  const ms = performance.now() - t0;
  (results[name] as Record<string, unknown> | undefined) ??= {};
  (results as Record<string, Record<string, unknown>>)[name].ms = Math.round(ms);
  return r;
}

const flat = () => 0;
const area = { center: new THREE.Vector3(0, 0, 0), halfSize: [60, 60] as [number, number] };

// ── terrain exactness ──
{
  const h = (x: number, z: number) => fbm2(x * 0.02, z * 0.02, 4, 5) * 9 + Math.sin(x * 0.3) * 0.6;
  const t = buildTerrain({ size: 200, segments: 100, height: h, style: 'forest', center: [30, -20] });
  const ray = new THREE.Raycaster();
  let maxErr = 0;
  for (let i = 0; i < 300; i++) {
    const x = 30 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 95;
    const z = -20 + (Math.sin(i * 78.233) * 12345.678 % 1) * 95;
    ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    t.mesh.updateMatrixWorld(true);
    const hit = ray.intersectObject(t.mesh, false)[0];
    if (!hit) continue;
    maxErr = Math.max(maxErr, Math.abs(hit.point.y - t.heightAt(x, z)));
  }
  results.terrain_heightAt_max_error_m = Number(maxErr.toFixed(6));
  if (maxErr > 1e-3) problems.push(`terrain heightAt error ${maxErr}`);
  stats('terrain', t.mesh);
  const out = t.heightAt(1000, 1000);
  if (!Number.isFinite(out)) problems.push('terrain heightAt outside grid is not finite');
}

// ── crowds ──
for (const kind of ['orc', 'uruk', 'goblin', 'rohirrim', 'gondor', 'easterling', 'elf', 'dwarf'] as const) {
  const c = time(`crowd_${kind}`, () => createCrowd({ center: new THREE.Vector3(0, 0, 0), halfSize: [20, 20], count: 400, kind, props: true, speed: 2 }, flat));
  stats(`crowd_${kind}`, c.mesh);
  c.thin(0.3);
  c.setSpeed(5);
  c.dispose();
}

// ── vegetation ──
for (const kind of V.TREE_KINDS) {
  const t = time(`tree_${kind}`, () => V.tree(kind, 1));
  stats(`tree_${kind}`, t.object, t.colliders);
}
{
  const f = time('forest_100', () => V.forest(area, 100, ['mirkwood_oak', 'beech', 'pine', 'dead', 'birch'], flat, { seed: 3 }));
  stats('forest_100', f.object, f.colliders);
  results.forest_trees_placed = f.trees.length;
  stats('grass', time('grass', () => V.grassField(area, 3, flat)));
  stats('ferns', V.ferns(area, 500, flat));
  stats('mushrooms', V.mushrooms(area, 200, flat));
  stats('cocoon', V.cocoon());
  stats('webSheet', V.webSheet([[0, 2, 0], [2, 2, 0], [2, 0, 0], [0, 0, 0]]));
}

// ── water ──
{
  const r = time('river', () => river([[0, 0], [30, 10], [60, 40], [100, 45]], 9, { terrain: () => -2, rocks: [{ x: 30, z: 10, r: 1 }] }));
  stats('river', r.object);
  const l = time('lake', () => lake({ center: [0, 0], radius: 100 }));
  stats('lake', l.object);
}

// ── props ──
const props: [string, () => { object: THREE.Object3D; colliders: ColliderDesc[] }][] = [
  ['rock', () => P.rock(1, 2)],
  ['boulderField', () => P.boulderField(area, 40, [0.3, 1.5], flat)],
  ['barrel', () => P.barrel()],
  ['crate', () => P.crate()],
  ['torch', () => P.torch()],
  ['brazier', () => P.brazier()],
  ['banner', () => P.banner(0x222222, 'white_hand')],
  ['well', () => P.well()],
  ['ladder', () => P.ladder(4)],
  ['chain', () => P.chain(5)],
  ['skeleton', () => P.skeleton('sitting')],
  ['weaponRack', () => P.weaponRack()],
  ['iceSheet', () => P.iceSheet(4, 2)],
  ['batFlock', () => P.batFlock(30, new THREE.Vector3(0, 10, 0), 15)],
  ['fallenLog', () => P.fallenLog()],
  ['lantern', () => P.lantern()],
  ['boat', () => P.boat()],
];
for (const [n, fn] of props) {
  const b = time(`prop_${n}`, fn);
  stats(`prop_${n}`, b.object, b.colliders);
}

// ── architecture ──
const arch: [string, () => { object: THREE.Object3D; colliders: ColliderDesc[] }][] = [
  ['woodenHouse', () => A.woodenHouse({ lit: true })],
  ['bardsHouse', () => A.bardsHouse()],
  ['pier', () => A.pier([[0, 0], [10, 0], [14, 8]], 2)],
  ['stoneWall', () => A.stoneWall([[0, 0, 0], [20, 0, 0], [40, 2, 10]], 10, 3)],
  ['stairs', () => A.stairs([0, 0, 0], [0, 6, 30], 6, { ramp: true })],
  ['tower', () => A.tower(4, 20, { door: true })],
  ['gate', () => A.gate()],
  ['helmsDeep', () => A.helmsDeep()],
  ['pillar', () => A.pillar('dwarven', 14, 2.6)],
  ['dwarvenHall', () => A.dwarvenHall({ cols: 3, rows: 3 })],
  ['chamberOfMazarbul', () => A.chamberOfMazarbul()],
  ['ruinedWatchtower', () => A.ruinedWatchtower()],
  ['brokenBridge', () => A.brokenBridge(34, 6, { gap: [0.4, 0.6] })],
  ['frozenWaterfall', () => A.frozenWaterfall()],
  ['blackGate', () => A.blackGate()],
  ['statue', () => A.statue('standing')],
  ['seatOfSeeing', () => A.seatOfSeeing()],
  ['amonHenSummit', () => A.amonHenSummit()],
  ['ruins', () => A.ruins(area, 30, flat)],
  ['minasTirith', () => A.minasTirith()],
  ['bridge_wood', () => A.bridge([[0, 0, 0], [20, 0, 4]], 3, { kind: 'wood' })],
  ['bridge_rope', () => A.bridge([[0, 0, 0], [24, 0, 0]], 2, { kind: 'rope', sag: 2 })],
  ['bridge_stone', () => A.bridge([[0, 0, 0], [30, 0, 0]], 5, { kind: 'stone' })],
];
for (const [n, fn] of arch) {
  const b = time(`arch_${n}`, fn);
  stats(`arch_${n}`, b.object, b.colliders);
}

// ── physics integration ──
{
  const check = (name: string, got: number | null, want: number, tol: number) => {
    results[`phys_${name}`] = got === null ? 'none' : Number(got.toFixed(2));
    if (got === null || Math.abs(got - want) > tol) problems.push(`physics ${name}: got ${got} want ${want}±${tol}`);
  };
  const phys = createPhysics();
  phys.setTerrain(() => 0);
  // wooden house deck at the origin, translated + rotated
  const house = A.woodenHouse();
  house.object.position.set(100, 3, 100);
  house.object.rotation.y = 0.7;
  addColliders(phys, house.colliders, house.object);
  // standing on the deck beside the door
  const dx = 100 + 1.0 * Math.cos(0.7) + 0.5 * Math.sin(0.7);
  const dz = 100 - 1.0 * Math.sin(0.7) + 0.5 * Math.cos(0.7);
  check('house_deck', phys.ground(dx, dz, 5, 1)?.y ?? null, 3, 0.05);
  // wall: a ray along the front wall must hit it
  const wallA = A.stoneWall([[0, 0, 200], [30, 0, 200]], 8, 3);
  addColliders(phys, wallA.colliders);
  check('wall_top', phys.ground(15, 200, 12, 0.5)?.y ?? null, 8, 0.05);
  const hit = phys.raycast(new THREE.Vector3(15, 4, 210), new THREE.Vector3(0, 0, -1), 20, 'arrows');
  check('wall_ray_z', hit ? hit.point.z : null, 201.5, 0.3);
  // stairs: midpoint of a 0..6 m rise over 30 m
  const st = A.stairs([0, 0, 300], [0, 6, 330], 6, { ramp: false });
  addColliders(phys, st.colliders);
  check('stairs_mid', phys.ground(0, 315, 9, 0.5)?.y ?? null, 3, 0.25);
  // pier
  const pr = A.pier([[0, 0, 400], [20, 0, 400]], 2.4);
  addColliders(phys, pr.colliders);
  check('pier_deck', phys.ground(10, 400, 3, 1)?.y ?? null, 0, 0.1);
  // helm's deep: the walkway of the left wall
  const hd = A.helmsDeep();
  hd.object.position.set(500, 0, 500);
  addColliders(phys, hd.colliders, hd.object);
  check('helms_walkway', phys.ground(500 - 26, 500 - 1, 30, 0.5)?.y ?? null, 14, 0.2);
  check('helms_stair_mid', phys.ground(500 - 30, 500 - 38, 30, 0.5)?.y ?? null, 7.0, 0.35);
  // black gate floor, house roof ridge, tower top
  const rt = A.ruinedWatchtower();
  rt.object.position.set(700, 0, 700);
  addColliders(phys, rt.colliders, rt.object);
  check('tower_floor1', phys.ground(700 + 1.5, 700 + 1.0, 8.6, 0.3)?.y ?? null, 8.2, 0.3);
  const ch = A.chamberOfMazarbul();
  ch.object.position.set(900, 0, 900);
  addColliders(phys, ch.colliders, ch.object);
  check('chamber_floor', phys.ground(900 + 3, 900 + 3, 3, 0.5)?.y ?? null, 0, 0.05);
  check('chamber_tomb_dais', phys.ground(900, 900 - 3, 3, 0.5)?.y ?? null, 0.66, 0.1);
}

results.problems = problems;
w.__testResult = results;
w.__snapReady = true;
document.getElementById('out')!.textContent = JSON.stringify(results, null, 1);
