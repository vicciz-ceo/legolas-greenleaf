/** Siege engines and battlefield props: catapult, siege tower, battering ram, stone blocks, wrecks. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat } from './mats';
import { cliffGeometry, latheGeo, limbGeo, xf } from './geom';
import { MeshKit } from './util';
import type { Built, ColliderDesc } from './colliders';
import { adoptColliderMeshes } from './arch_common';

const grp = (name: string, kit: MeshKit): THREE.Group => kit.build({ name });

function wheel(kit: MeshKit, r: number, w: number, x: number, y: number, z: number, wood: THREE.Material, iron: THREE.Material): void {
  const hub = latheGeo([[0, -w / 2], [r * 0.16, -w / 2], [r * 0.16, w / 2], [0, w / 2]], 10, 0.4);
  hub.rotateZ(Math.PI / 2);
  kit.add(wood, hub, xf(x, y, z));
  kit.add(iron, new THREE.TorusGeometry(r * 0.97, 0.035, 5, 20), xf(x, y, z, Math.PI / 2, 1, 1, 1, 0, 0));
  const rim = new THREE.CylinderGeometry(r, r, w, 18, 1, true);
  rim.rotateZ(Math.PI / 2);
  kit.add(wood, rim, xf(x, y, z), { tile: 0.8 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    kit.add(wood, limbGeo([x, y + Math.cos(a) * r * 0.95, z + Math.sin(a) * r * 0.95], [x, y - Math.cos(a) * r * 0.95, z - Math.sin(a) * r * 0.95], 0.045, 0.045, 5, 0.6));
  }
}

/** a sturdy field catapult. Faces +z (the arm swings toward +z). Origin on the ground at the centre. */
export function catapult(o: { broken?: boolean; seed?: number } = {}): Built {
  const rng = new Rng(hashSeed('catapult', o.seed ?? 1));
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'siege', rgb: [0.85, 0.78, 0.7] });
  const iron = mat('metal_dark', { key: 'siege' });
  const rope = mat('cloth_wool', { key: 'rope', rgb: [0.6, 0.5, 0.35] });
  const colliders: ColliderDesc[] = [];
  // base frame
  for (const s of [-1, 1]) {
    kit.add(wood, limbGeo([s * 1.1, 0.55, -2.2], [s * 1.1, 0.55, 2.4], 0.14, 0.14, 7, 0.6));
    kit.add(wood, limbGeo([s * 1.1, 0.55, -0.8], [s * 1.1, 1.8, -0.4], 0.12, 0.12, 6, 0.6));
    kit.add(wood, limbGeo([s * 1.1, 0.55, 0.9], [s * 1.1, 1.8, 0.5], 0.12, 0.12, 6, 0.6));
    wheel(kit, 0.55, 0.16, s * 1.35, 0.55, -1.6, wood, iron);
    wheel(kit, 0.55, 0.16, s * 1.35, 0.55, 1.6, wood, iron);
  }
  for (const z of [-2.2, -0.2, 2.4]) kit.add(wood, limbGeo([-1.1, 0.6, z], [1.1, 0.6, z], 0.12, 0.12, 6, 0.6));
  // upright frame and windlass axle
  kit.add(wood, limbGeo([-1.1, 1.8, -0.4], [1.1, 1.8, -0.4], 0.13, 0.13, 6, 0.6));
  kit.add(wood, limbGeo([-1.0, 1.7, 0.0], [1.0, 1.7, 0.0], 0.1, 0.1, 6, 0.6));
  // throwing arm: tilted back, with a sling and a bucket
  const armTop: [number, number, number] = [0, 4.3, -1.7];
  kit.add(wood, limbGeo([0, 1.7, 0.0], armTop, 0.14, 0.09, 7, 0.6));
  kit.add(iron, limbGeo([0, 4.2, -1.7], [0, 3.2, -2.3], 0.02, 0.02, 4, 0.4));
  kit.add(wood, new THREE.CylinderGeometry(0.4, 0.3, 0.45, 10), xf(0, 2.95, -2.35));
  // counterweight basket at the short end
  kit.box(wood, [0.9, 0.9, 0.9], [0, 0.95, 1.2], 0, { tile: 0.8 });
  kit.add(rope, limbGeo([0, 1.7, 0.2], [0, 1.4, 1.1], 0.03, 0.03, 4, 0.4));
  // ropes on the windlass
  for (let i = 0; i < 4; i++) kit.add(rope, limbGeo([-0.9 + i * 0.6, 1.7, 0.0], [-0.4 + i * 0.3, 0.7, 0.4], 0.03, 0.03, 4, 0.4));
  if (o.broken) {
    for (let i = 0; i < 6; i++) kit.add(wood, limbGeo([(rng.float() - 0.5) * 3, 0.1, (rng.float() - 0.5) * 4], [(rng.float() - 0.5) * 3, 0.2, (rng.float() - 0.5) * 4], 0.08, 0.07, 5, 0.6));
  }
  colliders.push({ kind: 'box', center: [0, 1.0, 0], half: [1.4, 1.0, 2.5], opts: { material: 'wood', tag: 'catapult', walkable: true } });
  return { object: grp('catapult', kit), colliders };
}

/** timber siege tower on wheels with a hide skin and a drop ramp (facing +z). Origin on the ground at the centre. */
export function siegeTower(o: { height?: number; burnt?: boolean; seed?: number } = {}): Built {
  const H = o.height ?? 13;
  const W = 4.6;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'siege', rgb: [0.85, 0.78, 0.7] });
  const dark = mat('old_wood', { key: 'siegeDark', rgb: [0.45, 0.4, 0.36] });
  const iron = mat('metal_dark', { key: 'siege' });
  const hide = mat('hide', { key: 'siegeHide', rgb: o.burnt ? [0.35, 0.3, 0.28] : [0.9, 0.8, 0.7] });
  const colliders: ColliderDesc[] = [];
  const base = 1.1;
  // wheels and chassis
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(kit, 0.9, 0.3, sx * (W / 2 + 0.2), 0.9, sz * 2.6, wood, iron);
  kit.box(wood, [W + 0.4, 0.6, 6.6], [0, base, 0], 0, { tile: 1.2 });
  // four corner posts and cross bracing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.add(wood, limbGeo([sx * W / 2, base, sz * 2.1], [sx * (W / 2 - 0.5), H, sz * 1.6], 0.22, 0.18, 7, 0.8));
  const levels = Math.max(3, Math.floor(H / 3.2));
  for (let i = 0; i <= levels; i++) {
    const y = base + (i / levels) * (H - base);
    const k = 1 - (0.2 * (y - base)) / H;
    kit.box(wood, [W * k + 0.3, 0.3, 4.2 * k + 0.3], [0, y, 0], 0, { tile: 1.2 });
    if (i > 0 && i < levels) {
      for (const sz of [-1, 1]) kit.add(wood, limbGeo([-W * k / 2, y - 3.1, sz * 2.1 * k], [W * k / 2, y, sz * 2.1 * k], 0.07, 0.07, 5, 0.6));
    }
  }
  // hide-clad walls on three sides, open front at the top where the ramp drops
  kit.box(hide, [W - 0.2, H - base - 1.0, 0.18], [0, base + (H - base - 1.0) / 2 + 0.4, -2.0], 0, { tile: 1.0 });
  for (const sx of [-1, 1]) kit.box(hide, [0.18, H - base - 1.0, 4.0], [sx * (W / 2 - 0.15), base + (H - base - 1.0) / 2 + 0.4, 0], 0, { tile: 1.0 });
  kit.box(hide, [W - 0.2, (H - base) * 0.5, 0.18], [0, base + (H - base) * 0.25 + 0.2, 2.0], 0, { tile: 1.0 });
  // battlement shield at the top and the drop ramp (lowered a little)
  kit.box(dark, [W + 0.2, 1.4, 0.2], [0, H + 0.7, -2.0], 0, { tile: 1.0 });
  kit.box(wood, [W - 0.5, 0.18, 3.2], [0, H - 0.6, 3.4], 0, { tile: 1.0 }, [0.25, 0]);
  for (const sx of [-1, 1]) kit.add(iron, limbGeo([sx * (W / 2 - 0.4), H - 0.3, 2.0], [sx * (W / 2 - 0.4), H - 0.7, 4.8], 0.03, 0.03, 4, 0.4));
  // ladders inside, shown as rungs on the front
  for (let y = base + 0.8; y < H - 1.5; y += 0.5) kit.add(wood, limbGeo([-0.6, y, 2.1], [0.6, y, 2.1], 0.03, 0.03, 4, 0.4));
  // tow ropes
  for (const sx of [-1, 1]) kit.add(mat('cloth_wool', { key: 'rope', rgb: [0.6, 0.5, 0.35] }), limbGeo([sx * 1.8, base, 3.2], [sx * 1.6, base - 0.2, 7.0], 0.05, 0.05, 5, 0.4));
  colliders.push({ kind: 'box', center: [0, H / 2 + 0.4, 0], half: [W / 2 + 0.3, H / 2 + 0.4, 3.0], opts: { material: 'wood', tag: 'siege_tower', walkable: true } });
  return { object: grp('siege_tower', kit), colliders };
}

/** battering ram in a roofed frame on wheels (front toward +z). Origin on the ground at the centre. */
export function batteringRam(o: { seed?: number } = {}): Built {
  void o;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'siege', rgb: [0.85, 0.78, 0.7] });
  const bark = mat('bark', { key: 'ramLog' });
  const iron = mat('metal_dark', { key: 'siege' });
  const hide = mat('hide', { key: 'siegeHide', rgb: [0.5, 0.42, 0.36] });
  const colliders: ColliderDesc[] = [];
  for (const sz of [-2.6, 0, 2.6]) for (const sx of [-1, 1]) wheel(kit, 0.55, 0.2, sx * 1.55, 0.55, sz, wood, iron);
  kit.box(wood, [3.0, 0.3, 7.6], [0, 0.95, 0], 0, { tile: 1.2 });
  for (const sx of [-1, 1]) for (const z of [-3.4, -1.1, 1.1, 3.4]) kit.add(wood, limbGeo([sx * 1.4, 1.0, z], [sx * 1.1, 3.2, z], 0.1, 0.09, 6, 0.6));
  // sloped hide roof
  for (const s of [-1, 1]) kit.box(hide, [1.9, 0.12, 7.6], [s * 0.85, 3.45, 0], 0, { tile: 1.0 }, [0, -s * 0.38]);
  // the ram: a log hung by chains with an iron head
  const logG = new THREE.CylinderGeometry(0.34, 0.38, 7.4, 12);
  logG.rotateX(Math.PI / 2);
  kit.add(bark, logG, xf(0, 1.9, 0.6), { tile: 2 });
  kit.add(iron, new THREE.ConeGeometry(0.5, 0.9, 10), xf(0, 1.9, 4.6, 0, 1, 1, 1, Math.PI / 2, 0));
  for (const z of [-1.2, 1.8]) for (const s of [-1, 1]) kit.add(iron, limbGeo([s * 0.45, 3.25, z], [s * 0.18, 2.2, z], 0.02, 0.02, 4, 0.4));
  colliders.push({ kind: 'box', center: [0, 1.7, 0.2], half: [1.7, 1.7, 3.9], opts: { material: 'wood', tag: 'ram', walkable: true } });
  return { object: grp('battering_ram', kit), colliders };
}

/** rough-cut stone block (falling-stones climb, rubble). Origin at the centre of the bottom. */
export function stoneBlock(size: [number, number, number] = [3, 1.5, 3], seed = 1, o: { kind?: 'dark' | 'light' | 'ice' } = {}): Built {
  const m = o.kind === 'ice' ? mat('ice', { key: 'blk' }) : o.kind === 'light' ? mat('stone_blocks', { key: 'blkL', rgb: [1.1, 1.08, 1.0], macro: { scale: 0.08, strength: 0.25, streaks: 0.4 } }) : mat('cliff', { key: 'blk', rgb: [0.7, 0.68, 0.66] });
  const g = cliffGeometry(size[0], size[1], size[2], seed, { rough: 0.35, strata: 0.1, cell: Math.max(0.5, Math.min(size[0], size[2]) / 5), tile: 3 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = size[1] / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  const gr = new THREE.Group();
  gr.name = 'stone_block';
  gr.add(mesh);
  const colliders: ColliderDesc[] = [{ kind: 'box', center: [0, size[1] / 2, 0], half: [size[0] / 2 * 0.96, size[1] / 2 * 0.96, size[2] / 2 * 0.96], opts: { material: o.kind === 'ice' ? 'ice' : 'stone', tag: 'stone_block' } }];
  adoptColliderMeshes(gr, colliders);
  return { object: gr, colliders };
}
