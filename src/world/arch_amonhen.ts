/** Amon Hen: the Seat of Seeing, statues, and generic ruins. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat } from './mats';
import { latheGeo, limbGeo, xf } from './geom';
import { MeshKit, type Area, type HeightFn } from './util';
import type { Built, ColliderDesc } from './colliders';
import { adoptColliderMeshes, archRing, stoneMat, type V3 } from './arch_common';
import { stairs } from './arch_helms';

export type StatuePose = 'standing' | 'toppled' | 'headless' | 'pedestal';

/** robed Numenorean statue on a pedestal (weathered, mossy). Origin at the base centre. */
export function statue(pose: StatuePose = 'standing', o: { height?: number; seed?: number; mossy?: boolean } = {}): Built {
  const H = o.height ?? 7;
  const rng = new Rng(hashSeed('statue', pose, o.seed ?? 1));
  const kit = new MeshKit();
  const stone = o.mossy === false ? stoneMat('marble') : mat('marble', { key: 'mossStatue', rgb: [0.72, 0.8, 0.68] });
  const base = o.mossy === false ? stoneMat('light') : stoneMat('mossy');
  const colliders: ColliderDesc[] = [];
  const pedH = H * 0.28;
  const pw = H * 0.34;
  // pedestal: stepped
  kit.box(base, [pw * 1.5, pedH * 0.25, pw * 1.5], [0, pedH * 0.125, 0], 0, { tile: 2.5 });
  kit.box(base, [pw * 1.25, pedH * 0.5, pw * 1.25], [0, pedH * 0.5, 0], 0, { tile: 2.5 });
  kit.box(base, [pw * 1.4, pedH * 0.15, pw * 1.4], [0, pedH * 0.9, 0], 0, { tile: 2.5 });
  colliders.push({ kind: 'box', center: [0, pedH / 2, 0], half: [pw * 0.75, pedH / 2, pw * 0.75], opts: { material: 'stone', tag: 'pedestal' } });
  if (pose === 'pedestal') return { object: kit.build({ name: 'statue_pedestal' }), colliders };
  const figH = H - pedH;
  const fig = new THREE.Group();
  const fk = new MeshKit();
  // proportions: figH = full figure (hem to hood tip); head centre at 0.9, shoulders at 0.78
  const robe = latheGeo([[0.0, 0], [figH * 0.12, 0], [figH * 0.125, figH * 0.03], [figH * 0.105, figH * 0.25], [figH * 0.082, figH * 0.5], [figH * 0.092, figH * 0.64], [figH * 0.105, figH * 0.72], [figH * 0.07, figH * 0.78], [figH * 0.035, figH * 0.8], [0, figH * 0.81]], 20, 2.5);
  fk.add(stone, robe);
  // deep vertical folds
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const r0 = figH * 0.122;
    const r1 = figH * 0.088;
    fk.add(stone, limbGeo([Math.cos(a) * r0, figH * 0.01, Math.sin(a) * r0], [Math.cos(a) * r1, figH * 0.5, Math.sin(a) * r1], figH * 0.012, figH * 0.008, 5, 1));
  }
  // shoulders: broad ellipsoid; cloak falls behind
  fk.add(stone, new THREE.SphereGeometry(1, 12, 8), xf(0, figH * 0.755, 0, 0, figH * 0.13, figH * 0.05, figH * 0.07));
  fk.add(stone, limbGeo([0, figH * 0.78, -figH * 0.07], [0, figH * 0.04, -figH * 0.12], figH * 0.075, figH * 0.1, 10, 2.5));
  // left arm hangs and holds a sword point-down in front
  fk.add(stone, limbGeo([-figH * 0.125, figH * 0.75, 0], [-figH * 0.145, figH * 0.55, figH * 0.04], figH * 0.03, figH * 0.026, 6, 1));
  fk.add(stone, limbGeo([-figH * 0.145, figH * 0.55, figH * 0.04], [-figH * 0.07, figH * 0.43, figH * 0.1], figH * 0.026, figH * 0.022, 6, 1));
  fk.add(stone, limbGeo([-figH * 0.07, figH * 0.52, figH * 0.11], [-figH * 0.07, figH * 0.04, figH * 0.11], figH * 0.012, figH * 0.008, 5, 1));
  fk.add(stone, new THREE.BoxGeometry(figH * 0.1, figH * 0.012, figH * 0.016), xf(-figH * 0.07, figH * 0.5, figH * 0.11));
  // right arm raised, palm open (the gesture of the Argonath kings)
  fk.add(stone, limbGeo([figH * 0.125, figH * 0.75, 0], [figH * 0.19, figH * 0.82, figH * 0.07], figH * 0.03, figH * 0.026, 6, 1));
  fk.add(stone, limbGeo([figH * 0.19, figH * 0.82, figH * 0.07], [figH * 0.23, figH * 0.97, figH * 0.1], figH * 0.026, figH * 0.022, 6, 1));
  fk.add(stone, new THREE.SphereGeometry(figH * 0.028, 7, 5), xf(figH * 0.235, figH * 0.995, figH * 0.1, 0, 1, 1.2, 0.5));
  if (pose !== 'headless') {
    fk.add(stone, limbGeo([0, figH * 0.8, figH * 0.005], [0, figH * 0.84, figH * 0.01], figH * 0.03, figH * 0.028, 6, 1));
    fk.add(stone, new THREE.SphereGeometry(figH * 0.052, 12, 8), xf(0, figH * 0.9, figH * 0.012, 0, 0.9, 1.15, 1));
    fk.add(stone, new THREE.ConeGeometry(figH * 0.062, figH * 0.1, 10), xf(0, figH * 0.955, -figH * 0.005));
    fk.add(stone, limbGeo([0, figH * 0.865, figH * 0.04], [0, figH * 0.75, figH * 0.06], figH * 0.03, figH * 0.012, 6, 1));
  }
  const figMesh = fk.build({ name: 'figure' });
  fig.add(figMesh);
  fig.position.y = pedH;
  if (pose === 'toppled') {
    // lying on its side beside the pedestal, broken at the ankles
    fig.rotation.z = Math.PI / 2 * 0.96;
    fig.rotation.y = rng.float() * 1.5;
    fig.position.set(pw * 1.2, figH * 0.14, pw * 1.6);
    colliders.length = 1;
    colliders.push({ kind: 'box', center: [pw * 1.2 + figH * 0.4, figH * 0.18, pw * 1.6], half: [figH * 0.5, figH * 0.17, figH * 0.17], yaw: 0.2, opts: { material: 'stone', tag: 'statue_fallen' } });
  } else {
    colliders.push({ kind: 'cyl', x: 0, z: 0, r: figH * 0.17, y0: pedH, y1: H * 0.95, opts: { material: 'stone', walkable: false, tag: 'statue' } });
  }
  const g = kit.build({ name: 'statue' });
  g.add(fig);
  if (pose === 'headless') {
    const head = new THREE.Mesh(new THREE.SphereGeometry(figH * 0.075, 10, 7), stone);
    head.scale.set(0.9, 1.15, 1);
    head.position.set(pw * 1.8, figH * 0.085, pw * 0.6);
    head.castShadow = head.receiveShadow = true;
    g.add(head);
  }
  return { object: g, colliders };
}

export interface SeatResult extends Built {
  anchors: { top: V3; seat: V3; stairsBottom: V3[]; ring: V3[] };
}

/**
 * The Seat of Seeing: three round tiers with two broad stairs, a ring of broken columns and the stone
 * seat on the summit. Origin at the centre of the base; top surface at y = 6.8. Mossy masonry.
 */
export function seatOfSeeing(o: { seed?: number } = {}): SeatResult {
  const rng = new Rng(hashSeed('seat', o.seed ?? 1));
  const kit = new MeshKit();
  const stone = stoneMat('mossy');
  const light = mat('stone_blocks', { key: 'seatLight', rgb: [0.85, 0.95, 0.8] });
  const colliders: ColliderDesc[] = [];
  const tiers: [number, number, number][] = [[11.5, 0, 2.4], [8.8, 2.4, 2.2], [6.4, 4.6, 2.2]];
  const seg = 28;
  for (const [r, y0, h] of tiers) {
    kit.add(stone, latheGeo([[0, y0 - 1], [r, y0 - 1], [r, y0 + h], [r - 0.35, y0 + h + 0.12], [0, y0 + h + 0.12]], seg, 3));
    colliders.push({ kind: 'cyl', x: 0, z: 0, r: r * 0.98, y0: y0 - 1, y1: y0 + h, opts: { material: 'stone', tag: 'seat_tier' } });
    // coping stones
    const n = Math.round((Math.PI * 2 * r) / 1.8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      kit.box(light, [0.7, 0.28, 1.9], [Math.cos(a) * (r - 0.2), y0 + h + 0.12, Math.sin(a) * (r - 0.2)], -a, { tile: 1.5 }, [0, (rng.float() - 0.5) * 0.04]);
    }
  }
  const topY = 6.8;
  // paving ring pattern on the summit
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    kit.box(light, [0.35, 0.05, 3.0], [Math.cos(a) * 3.6, topY + 0.04, Math.sin(a) * 3.6], -a, { tile: 1.5 });
  }
  // the seat: a stone chair on a two-step plinth, facing +z
  kit.box(light, [4.2, 0.35, 4.2], [0, topY + 0.18, 0], 0.0, { tile: 2 });
  kit.box(light, [3.2, 0.35, 3.2], [0, topY + 0.52, 0], 0.0, { tile: 2 });
  kit.box(stone, [2.2, 0.5, 2.0], [0, topY + 0.95, -0.2], 0, { tile: 1.5 });
  kit.box(stone, [2.2, 2.4, 0.5], [0, topY + 2.1, -1.2], 0, { tile: 1.5 });
  for (const s of [-1, 1]) kit.box(stone, [0.45, 1.1, 2.0], [s * 1.2, topY + 1.4, -0.2], 0, { tile: 1.5 });
  colliders.push({ kind: 'box', center: [0, topY + 0.35, 0], half: [2.1, 0.35, 2.1], opts: { material: 'stone', tag: 'seat_plinth' } });
  colliders.push({ kind: 'box', center: [0, topY + 1.8, -0.4], half: [1.2, 1.0, 1.0], opts: { material: 'stone', tag: 'seat', walkable: true } });
  // ring of columns (some broken)
  const ring: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 5.4;
    const z = Math.sin(a) * 5.4;
    const h = [5.2, 3.0, 5.2, 1.4, 5.2, 4.0, 2.2, 5.2][i];
    kit.add(stone, new THREE.CylinderGeometry(0.42, 0.5, h, 14), xf(x, topY + h / 2, z), { tile: 2 });
    kit.add(light, new THREE.CylinderGeometry(0.62, 0.66, 0.35, 14), xf(x, topY + 0.18, z), { tile: 2 });
    if (h > 5) {
      kit.add(light, new THREE.CylinderGeometry(0.62, 0.45, 0.45, 14), xf(x, topY + h + 0.1, z), { tile: 2 });
    } else {
      for (let k = 0; k < 4; k++) kit.add(stone, new THREE.ConeGeometry(0.24, 0.5 + rng.float() * 0.5, 4), xf(x + (rng.float() - 0.5) * 0.4, topY + h + 0.1, z + (rng.float() - 0.5) * 0.4, rng.float() * 3));
    }
    colliders.push({ kind: 'cyl', x, z, r: 0.5, y0: topY, y1: topY + h, opts: { material: 'stone', walkable: false, tag: 'seat_column' } });
    ring.push([x, topY, z]);
  }
  const root = kit.build({ name: 'seat_of_seeing' });
  // two broad stairs down the south and north sides
  const sb: V3[] = [];
  for (const sz of [1, -1]) {
    const st = stairs([0, 0, sz * 24], [0, 4.6 + 2.2 - 0.0, sz * 6.2], 5.5, { riser: 0.22, material: 'mossy', cheeks: true, ramp: false });
    root.add(st.object);
    colliders.push(...st.colliders);
    sb.push([0, 0, sz * 24]);
  }
  adoptColliderMeshes(root, colliders);
  return { object: root, colliders, anchors: { top: [0, topY, 0], seat: [0, topY + 1.4, 0.6], stairsBottom: sb, ring } };
}

export interface RuinsOpts {
  seed?: number;
  material?: 'mossy' | 'blocks' | 'dark' | 'white' | 'light';
  /** skip points (e.g. clearings, paths) */
  exclude?: (x: number, z: number) => boolean;
  /** 0..1 how many pieces are standing columns / arches vs low wall stubs and rubble */
  grandeur?: number;
}

/**
 * Scatter of ruined stonework over an area: wall stubs, standing and fallen columns, arch fragments,
 * stair fragments, rubble. World coordinates (object at the origin), colliders included.
 */
export function ruins(area: Area, count: number, heightAt: HeightFn, o: RuinsOpts = {}): Built {
  const rng = new Rng(hashSeed('ruins', o.seed ?? 1, count, area.center.x, area.center.z));
  const kit = new MeshKit();
  const stone = stoneMat(o.material ?? 'mossy');
  const light = stoneMat(o.material === 'white' ? 'white' : 'light');
  const colliders: ColliderDesc[] = [];
  const grand = o.grandeur ?? 0.5;
  const extras: THREE.Object3D[] = [];
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 8) {
    const x = area.center.x + (rng.float() * 2 - 1) * area.halfSize[0];
    const z = area.center.z + (rng.float() * 2 - 1) * area.halfSize[1];
    if (o.exclude?.(x, z)) continue;
    const y = heightAt(x, z);
    const yaw = rng.float() * Math.PI * 2;
    const r = rng.float();
    placed++;
    if (r < 0.35) {
      // wall stub with a ragged top
      const len = 2.5 + rng.float() * 5;
      const th = 0.7 + rng.float() * 0.4;
      const steps = Math.ceil(len / 1.2);
      for (let i = 0; i < steps; i++) {
        const h = (0.9 + rng.float() * 2.2) * (0.6 + grand);
        const t = (i + 0.5) / steps;
        const lx = (t - 0.5) * len;
        const cx = x + Math.cos(yaw) * lx;
        const cz = z - Math.sin(yaw) * lx;
        kit.box(stone, [len / steps + 0.04, h + 0.8, th], [cx, y + h / 2 - 0.4, cz], yaw, { tile: 2 });
        colliders.push({ kind: 'box', center: [cx, y + h / 2 - 0.4, cz], half: [len / steps / 2 + 0.02, h / 2 + 0.4, th / 2], yaw, opts: { material: 'stone', tag: 'ruin' } });
      }
    } else if (r < 0.58) {
      // standing / broken column
      const h = 1.0 + rng.float() * (2.0 + 4.0 * grand);
      const rad = 0.35 + rng.float() * 0.2;
      kit.add(stone, new THREE.CylinderGeometry(rad * 0.88, rad, h, 12), xf(x, y + h / 2 - 0.1, z), { tile: 2 });
      kit.add(light, new THREE.CylinderGeometry(rad * 1.3, rad * 1.35, 0.3, 12), xf(x, y + 0.05, z), { tile: 2 });
      colliders.push({ kind: 'cyl', x, z, r: rad * 1.1, y0: y - 0.3, y1: y + h, opts: { material: 'stone', walkable: false, tag: 'ruin' } });
    } else if (r < 0.7) {
      // fallen column
      const len = 2.5 + rng.float() * 3;
      const rad = 0.4 + rng.float() * 0.15;
      kit.add(stone, new THREE.CylinderGeometry(rad, rad * 0.95, len, 12), xf(x, y + rad * 0.7, z, yaw, 1, 1, 1, 0, Math.PI / 2), { tile: 2 });
      colliders.push({ kind: 'box', center: [x, y + rad * 0.7, z], half: [len / 2, rad * 0.8, rad * 0.8], yaw, opts: { material: 'stone', tag: 'ruin' } });
    } else if (r < 0.8 && grand > 0.3) {
      // arch fragment: two jambs and a half ring
      const span = 3.2;
      const k2 = new MeshKit();
      archRing(k2, light, span, 0.5, 0.9, 2.8, 1.5);
      const arch = k2.build({ name: 'arch' });
      arch.position.set(x, y, z);
      arch.rotation.y = yaw;
      kit.box(stone, [0.9, 3.0, 1.0], [x + Math.cos(yaw) * (span / 2 + 0.3), y + 1.4, z - Math.sin(yaw) * (span / 2 + 0.3)], yaw, { tile: 2 });
      kit.box(stone, [0.9, 2.0, 1.0], [x - Math.cos(yaw) * (span / 2 + 0.3), y + 0.9, z + Math.sin(yaw) * (span / 2 + 0.3)], yaw, { tile: 2 });
      colliders.push({ kind: 'box', center: [x + Math.cos(yaw) * (span / 2 + 0.3), y + 1.4, z - Math.sin(yaw) * (span / 2 + 0.3)], half: [0.45, 1.5, 0.5], yaw, opts: { material: 'stone', walkable: false, tag: 'ruin' } });
      colliders.push({ kind: 'box', center: [x - Math.cos(yaw) * (span / 2 + 0.3), y + 0.9, z + Math.sin(yaw) * (span / 2 + 0.3)], half: [0.45, 1.0, 0.5], yaw, opts: { material: 'stone', walkable: false, tag: 'ruin' } });
      extras.push(arch);
    } else {
      // rubble heap
      const n = 4 + Math.floor(rng.float() * 6);
      for (let i = 0; i < n; i++) {
        const s = 0.25 + rng.float() * 0.7;
        const dx = (rng.float() - 0.5) * 2.2;
        const dz = (rng.float() - 0.5) * 2.2;
        kit.box(stone, [s, s * 0.7, s * 0.9], [x + dx, y + s * 0.25, z + dz], rng.float() * 3, { tile: 1.5 }, [rng.float() * 0.5, rng.float() * 0.5]);
      }
      colliders.push({ kind: 'box', center: [x, y + 0.3, z], half: [1.1, 0.4, 1.1], opts: { material: 'stone', tag: 'rubble' } });
    }
  }
  const g = kit.build({ name: 'ruins' });
  for (const a of extras) g.add(a);
  return { object: g, colliders };
}

/** Amon Hen summit: the Seat of Seeing with broken statues around it and ruins on the slopes. Origin at the seat centre. */
export function amonHenSummit(o: { seed?: number } = {}): SeatResult & { statues: THREE.Object3D[] } {
  const seat = seatOfSeeing(o);
  const statues: THREE.Object3D[] = [];
  const colliders = [...seat.colliders];
  const spots: [number, number, number, StatuePose][] = [[-17, 14, 0.8, 'standing'], [17, 12, -0.7, 'toppled'], [-20, -6, 1.5, 'headless'], [19, -9, -1.9, 'standing']];
  for (const [x, z, yaw, pose] of spots) {
    const st = statue(pose, { seed: x });
    st.object.position.set(x, 0, z);
    st.object.rotation.y = yaw;
    seat.object.add(st.object);
    statues.push(st.object);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const d of st.colliders) {
      if (d.kind === 'box') colliders.push({ ...d, center: [x + d.center[0] * c + d.center[2] * s, d.center[1], z - d.center[0] * s + d.center[2] * c], yaw: (d.yaw ?? 0) + yaw });
      else if (d.kind === 'cyl') colliders.push({ ...d, x: x + d.x * c + d.z * s, z: z - d.x * s + d.z * c });
    }
  }
  return { ...seat, colliders, statues };
}
