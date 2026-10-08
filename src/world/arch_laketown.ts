/** Lake-town: wooden stilt houses, Bard's house, piers and walkways. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { limbGeo, xf } from './geom';
import { MeshKit } from './util';
import type { PathPoint } from './util';
import { Path } from './path';
import type { Built, ColliderDesc } from './colliders';
import { gableRoof, mergedColliderMesh, stoneMat, wallWithOpenings, type Opening, type V3 } from './arch_common';
import { ladder, lantern } from './props';

export interface HouseResult extends Built {
  anchors: {
    /** door position (outside, deck level) */
    door: V3;
    /** top of the ridge */
    ridge: V3;
    /** deck corners (outside) */
    deckCorners: V3[];
    /** eave height */
    eaveY: number;
  };
}

export interface HouseOpts {
  w?: number;
  d?: number;
  floors?: number;
  /** warm light in the windows (night) */
  lit?: boolean;
  seed?: number;
  /** roof pitch in radians (default 0.6) */
  pitch?: number;
  /** door ajar */
  doorOpen?: boolean;
  /** piles below the deck (m) */
  stilts?: number;
}

const FLOOR_H = 2.7;

function glassMat(lit: boolean): THREE.Material {
  return lit
    ? plain(0xffd08a, { roughness: 0.3, emissive: 0xff9a3c, emissiveIntensity: 1.6, key: 'glass_lit' })
    : plain(0x0c1318, { roughness: 0.08, metalness: 0.4, key: 'glass_dark' });
}

function piles(kit: MeshKit, w: number, d: number, depth: number, rng: Rng): ColliderDesc[] {
  const old = mat('old_wood', { key: 'pile', rgb: [0.8, 0.78, 0.74] });
  const cols: ColliderDesc[] = [];
  const nx = Math.max(2, Math.round(w / 2.6) + 1);
  const nz = Math.max(2, Math.round(d / 2.6) + 1);
  const pts: [number, number][] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
    pts.push([-w / 2 - 0.2 + (i / (nx - 1)) * (w + 0.4), -d / 2 - 0.2 + (j / (nz - 1)) * (d + 0.4)]);
  }
  for (const [x, z] of pts) {
    const r = 0.14 + rng.float() * 0.04;
    kit.add(old, limbGeo([x, -depth, z], [x, 0.0, z], r * 1.15, r, 8, 0.8));
    cols.push({ kind: 'cyl', x, z, r: r * 1.1, y0: -depth, y1: -0.2, opts: { walkable: false, material: 'wood', tag: 'pile' } });
  }
  // cross braces between neighbouring piles on the front and back rows
  for (let i = 0; i < nx - 1; i++) for (const zz of [-d / 2 - 0.2, d / 2 + 0.2]) {
    const x0 = -w / 2 - 0.2 + (i / (nx - 1)) * (w + 0.4);
    const x1 = -w / 2 - 0.2 + ((i + 1) / (nx - 1)) * (w + 0.4);
    kit.add(old, limbGeo([x0, -0.9, zz], [x1, -1.9, zz], 0.045, 0.045, 5, 0.8));
    kit.add(old, limbGeo([x0, -1.9, zz], [x1, -0.9, zz], 0.045, 0.045, 5, 0.8));
  }
  return cols;
}

/** Lake-town stilt house. Origin at the centre of the deck surface (y = 0), front (door) toward +z. */
export function woodenHouse(o: HouseOpts = {}): HouseResult {
  const w = o.w ?? 6.2;
  const d = o.d ?? 5.0;
  const floors = o.floors ?? 1;
  const lit = o.lit ?? false;
  const rng = new Rng(hashSeed('house', o.seed ?? 1, w, d));
  const kit = new MeshKit();
  const planks = mat('old_wood', { key: 'houseWall', rgb: [1.15, 1.02, 0.88] });
  const deckMat = mat('wood_planks', { key: 'house', rgb: [0.82, 0.72, 0.6] });
  const dark = mat('old_wood', { key: 'house' });
  const shingles = mat('shingles', { key: 'house' });
  const colliders: ColliderDesc[] = [];

  // deck + beams
  kit.box(deckMat, [w + 0.8, 0.2, d + 0.8], [0, -0.1, 0], 0, { tile: 1.2 });
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.4) kit.box(dark, [0.2, 0.26, d + 0.9], [x, -0.33, 0], 0, { tile: 0.8 });
  for (const sz of [-1, 1]) kit.box(dark, [w + 0.9, 0.24, 0.2], [0, -0.32, sz * (d / 2 + 0.4)], 0, { tile: 0.8 });
  colliders.push({ kind: 'box', center: [0, -0.1, 0], half: [w / 2 + 0.4, 0.1, d / 2 + 0.4], opts: { material: 'wood', tag: 'deck' } });
  colliders.push(...piles(kit, w, d, o.stilts ?? 3.4, rng));

  const t = 0.18;
  const door: Opening = { x0: w / 2 - 0.55 + (rng.float() - 0.5) * (w - 2.4), x1: 0, y0: 0, y1: 2.1 };
  door.x0 = Math.max(0.5, Math.min(w - 1.6, door.x0));
  door.x1 = door.x0 + 1.05;
  const glass = glassMat(lit);
  const winOpen = (x: number, y = 1.0): Opening => ({ x0: x - 0.42, x1: x + 0.42, y0: y, y1: y + 0.95 });

  const buildFloor = (f: number) => {
    const y = f * FLOOR_H;
    const front: Opening[] = f === 0 ? [door, winOpen(w * 0.16), winOpen(w * 0.84)] : [winOpen(w * 0.2), winOpen(w * 0.5), winOpen(w * 0.8)];
    const side: Opening[] = [winOpen(d * 0.5)];
    const back: Opening[] = [winOpen(w * 0.3), winOpen(w * 0.7)];
    const m = { opts: { material: 'wood' as const, tag: 'wall' } };
    colliders.push(...wallWithOpenings(kit, planks, w, FLOOR_H, t, front, { tile: 1.0, swap: true }, { x: -w / 2, y, z: d / 2, yaw: 0 }, m));
    colliders.push(...wallWithOpenings(kit, planks, w, FLOOR_H, t, back, { tile: 1.0, swap: true }, { x: -w / 2, y, z: -d / 2, yaw: 0 }, m));
    colliders.push(...wallWithOpenings(kit, planks, d, FLOOR_H, t, side, { tile: 1.0, swap: true }, { x: -w / 2, y, z: -d / 2, yaw: -Math.PI / 2 }, m));
    colliders.push(...wallWithOpenings(kit, planks, d, FLOOR_H, t, side, { tile: 1.0, swap: true }, { x: w / 2, y, z: -d / 2, yaw: -Math.PI / 2 }, m));
    // corner posts
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(dark, [0.22, FLOOR_H, 0.22], [sx * w / 2, y + FLOOR_H / 2, sz * d / 2], 0, { tile: 0.8 });
    // window panes, frames and shutters
    const frameWin = (op: Opening, wx: number, wz: number, yaw: number, wy: number, out = 1) => {
      const cx = (op.x0 + op.x1) / 2;
      const ww = op.x1 - op.x0;
      const wh = op.y1 - op.y0;
      const wm = (op.y0 + op.y1) / 2;
      // wall-local (lx along the wall, lz outward) to world; outward for yaw = -pi/2 walls is handled by `out`
      const world = (lx: number, lz: number): [number, number] => {
        const ox = lx * Math.cos(yaw) + lz * Math.sin(yaw) * (yaw === 0 ? 0 : 1) * out * -1;
        const oz = -lx * Math.sin(yaw) + lz * (yaw === 0 ? 1 : 0) * out;
        return [wx + ox, wz + oz];
      };
      const [px, pz] = world(cx, 0);
      kit.box(glass, [ww, wh, 0.03], [px, wy + wm, pz], yaw, undefined);
      kit.box(dark, [ww + 0.16, 0.08, t + 0.1], [px, wy + op.y0 - 0.03, pz], yaw, { tile: 0.6 });
      kit.box(dark, [ww + 0.16, 0.08, t + 0.1], [px, wy + op.y1 + 0.03, pz], yaw, { tile: 0.6 });
      for (const sd of [-1, 1]) {
        const [sx, sz] = world(cx + sd * (ww / 2 + 0.03), 0);
        kit.box(dark, [0.06, wh, t + 0.08], [sx, wy + wm, sz], yaw, { tile: 0.6 });
        // shutter swung open against the wall
        const [hx, hz] = world(cx + sd * (ww / 2 + 0.2), 0.14);
        kit.box(dark, [0.4, wh, 0.04], [hx, wy + wm, hz], yaw, { tile: 0.6 });
      }
      kit.box(dark, [0.03, wh, 0.05], [px, wy + wm, pz], yaw, { tile: 0.6 });
      kit.box(dark, [ww, 0.03, 0.05], [px, wy + wm, pz], yaw, { tile: 0.6 });
    };
    for (const op of front.filter((q) => q !== door)) frameWin(op, -w / 2, d / 2 + 0.0, 0, y);
    for (const op of back) frameWin(op, -w / 2, -d / 2, 0, y, -1);
    for (const op of side) {
      frameWin(op, -w / 2, -d / 2, -Math.PI / 2, y, -1);
      frameWin(op, w / 2, -d / 2, -Math.PI / 2, y, 1);
    }
    if (f === 0) {
      // door with frame, plank door and iron ring
      const dx = -w / 2 + (door.x0 + door.x1) / 2;
      kit.box(dark, [0.12, door.y1 + 0.1, t + 0.14], [dx - 0.58, door.y1 / 2, d / 2], 0, { tile: 0.6 });
      kit.box(dark, [0.12, door.y1 + 0.1, t + 0.14], [dx + 0.58, door.y1 / 2, d / 2], 0, { tile: 0.6 });
      kit.box(dark, [1.3, 0.12, t + 0.14], [dx, door.y1 + 0.06, d / 2], 0, { tile: 0.6 });
      const open = o.doorOpen ?? false;
      kit.box(dark, [0.98, 2.0, 0.06], open ? [dx - 0.78, 1.0, d / 2 + 0.38] : [dx, 1.0, d / 2 - 0.02], open ? -1.25 : 0, { tile: 0.8 });
      kit.add(mat('metal_dark', { key: 'house' }), new THREE.TorusGeometry(0.05, 0.01, 5, 10), xf(dx + 0.3, 1.0, d / 2 + 0.03, 0));
    }
  };
  for (let f = 0; f < floors; f++) buildFloor(f);
  for (let f = 1; f < floors; f++) kit.box(deckMat, [w, 0.2, d], [0, f * FLOOR_H - 0.1, 0], 0, { tile: 1.2 });
  if (floors > 1) colliders.push({ kind: 'box', center: [0, FLOOR_H - 0.1, 0], half: [w / 2, 0.1, d / 2], opts: { material: 'wood', tag: 'floor2' } });

  // roof
  const roofY = floors * FLOOR_H;
  const roof = gableRoof(kit, { w, d, y: roofY, pitch: o.pitch ?? 0.6, overhang: 0.55, material: shingles, gableMaterial: planks, trim: dark });
  const roofMesh = mergedColliderMesh(roof.collider, 'roof_collider');
  colliders.push({ kind: 'mesh', mesh: roofMesh, opts: { material: 'wood', tag: 'roof' } });
  // chimney
  const stone = stoneMat('dark');
  const cx = w / 2 - 1.1;
  kit.box(stone, [0.7, roof.ridgeY - roofY + 1.2, 0.7], [cx, roofY + (roof.ridgeY - roofY + 1.2) / 2 - 0.2, -d * 0.12], 0, { tile: 1.5 });
  kit.box(stone, [0.9, 0.14, 0.9], [cx, roof.ridgeY + 0.95, -d * 0.12], 0, { tile: 1.5 });
  colliders.push({ kind: 'box', center: [cx, roof.ridgeY + 0.3, -d * 0.12], half: [0.35, 0.8, 0.35], opts: { material: 'stone', walkable: false, tag: 'chimney' } });

  // porch step and rail in front of the door
  const dx = -w / 2 + (door.x0 + door.x1) / 2;
  kit.box(deckMat, [1.8, 0.14, 0.9], [dx, -0.2, d / 2 + 0.85], 0, { tile: 1.2 });
  for (const s of [-1, 1]) kit.add(dark, limbGeo([dx + s * 0.85, -0.25, d / 2 + 1.2], [dx + s * 0.85, 0.9, d / 2 + 1.2], 0.04, 0.04, 6, 0.6));
  kit.add(dark, limbGeo([dx - 0.85, 0.9, d / 2 + 1.2], [dx + 0.85, 0.9, d / 2 + 1.2], 0.03, 0.03, 6, 0.6));
  colliders.push({ kind: 'box', center: [dx, -0.2, d / 2 + 0.85], half: [0.9, 0.07, 0.45], opts: { material: 'wood', tag: 'porch' } });

  const g = kit.build({ name: 'wooden_house' });
  g.add(roofMesh);
  // lantern by the door
  const lan = lantern({ lit });
  lan.object.position.set(dx + 0.8, 2.3, d / 2 + 0.3);
  g.add(lan.object);
  // ladder down to the water at the back corner
  const lad = ladder(3.6, { width: 0.5 });
  lad.object.position.set(-w / 2 + 0.6, -3.3, -d / 2 - 0.3);
  g.add(lad.object);

  return {
    object: g,
    colliders,
    anchors: {
      door: [dx, 0, d / 2 + 1.4],
      ridge: [0, roof.ridgeY, 0],
      deckCorners: [[-w / 2 - 0.4, 0, -d / 2 - 0.4], [w / 2 + 0.4, 0, -d / 2 - 0.4], [w / 2 + 0.4, 0, d / 2 + 0.4], [-w / 2 - 0.4, 0, d / 2 + 0.4]],
      eaveY: roofY,
    },
  };
}

/**
 * Bard's house: two storeys on stilts, the ground-floor front completely open (a room you can fight
 * into), an inner stair, a balcony above the open front and a big gable roof. Front toward +z.
 */
export function bardsHouse(o: { lit?: boolean; seed?: number } = {}): HouseResult & { anchors: HouseResult['anchors'] & { stairBottom: V3; stairTop: V3; table: V3 } } {
  const w = 9.0;
  const d = 6.6;
  const lit = o.lit ?? true;
  const rng = new Rng(hashSeed('bard', o.seed ?? 1));
  const kit = new MeshKit();
  const planks = mat('old_wood', { key: 'bardWall', rgb: [1.12, 1.0, 0.86] });
  const deckMat = mat('wood_planks', { key: 'bard', rgb: [0.78, 0.68, 0.56] });
  const dark = mat('old_wood', { key: 'house' });
  const shingles = mat('shingles', { key: 'house' });
  const stone = stoneMat('dark');
  const cloth = mat('cloth_wool', { key: 'bard', rgb: [0.7, 0.5, 0.4] });
  const colliders: ColliderDesc[] = [];
  const glass = glassMat(lit);
  const t = 0.2;

  kit.box(deckMat, [w + 1.0, 0.22, d + 1.0], [0, -0.11, 0], 0, { tile: 1.2 });
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.5) kit.box(dark, [0.22, 0.28, d + 1.1], [x, -0.36, 0], 0, { tile: 0.8 });
  colliders.push({ kind: 'box', center: [0, -0.11, 0], half: [w / 2 + 0.5, 0.11, d / 2 + 0.5], opts: { material: 'wood', tag: 'deck' } });
  colliders.push(...piles(kit, w, d, 3.6, rng));
  // front apron: the deck extends further so fights spill onto the walkway
  kit.box(deckMat, [w + 1.0, 0.2, 1.6], [0, -0.12, d / 2 + 1.3], 0, { tile: 1.2 });
  colliders.push({ kind: 'box', center: [0, -0.12, d / 2 + 1.3], half: [w / 2 + 0.5, 0.1, 0.8], opts: { material: 'wood', tag: 'apron' } });

  const winOpen = (x: number, y = 1.0): Opening => ({ x0: x - 0.5, x1: x + 0.5, y0: y, y1: y + 1.05 });
  const m = { opts: { material: 'wood' as const, tag: 'wall' } };
  // ground floor: back wall with windows, side walls with a window each, OPEN FRONT
  colliders.push(...wallWithOpenings(kit, planks, w, FLOOR_H, t, [winOpen(w * 0.25), winOpen(w * 0.75)], { tile: 1.0, swap: true }, { x: -w / 2, y: 0, z: -d / 2, yaw: 0 }, m));
  colliders.push(...wallWithOpenings(kit, planks, d, FLOOR_H, t, [winOpen(d * 0.5)], { tile: 1.0, swap: true }, { x: -w / 2, y: 0, z: -d / 2, yaw: -Math.PI / 2 }, m));
  // right wall has a door onto a side walkway
  colliders.push(...wallWithOpenings(kit, planks, d, FLOOR_H, t, [{ x0: d * 0.5 - 0.55, x1: d * 0.5 + 0.55, y0: 0, y1: 2.15 }], { tile: 1.0, swap: true }, { x: w / 2, y: 0, z: -d / 2, yaw: -Math.PI / 2 }, m));
  // corner posts and the front frame: big posts + header beam carrying the upper floor
  const postX = [-w / 2, -w / 6, w / 6, w / 2];
  for (const x of postX) {
    kit.box(dark, [0.4, FLOOR_H, 0.4], [x, FLOOR_H / 2, d / 2], 0, { tile: 0.8 });
    colliders.push({ kind: 'box', center: [x, FLOOR_H / 2, d / 2], half: [0.2, FLOOR_H / 2, 0.2], opts: { material: 'wood', walkable: false, tag: 'post' } });
  }
  kit.box(dark, [w + 0.5, 0.5, 0.45], [0, FLOOR_H + 0.1, d / 2], 0, { tile: 0.8 });
  // low front sill walls under the openings between posts (waist-high) to read as a tavern front: only at the sides
  kit.box(deckMat, [w / 3 - 0.4, 0.8, 0.2], [-w / 3, 0.4, d / 2], 0, { tile: 1.2 });
  kit.box(deckMat, [w / 3 - 0.4, 0.8, 0.2], [w / 3, 0.4, d / 2], 0, { tile: 1.2 });
  colliders.push({ kind: 'box', center: [-w / 3, 0.4, d / 2], half: [w / 6 - 0.2, 0.4, 0.1], opts: { material: 'wood', tag: 'sill' } });
  colliders.push({ kind: 'box', center: [w / 3, 0.4, d / 2], half: [w / 6 - 0.2, 0.4, 0.1], opts: { material: 'wood', tag: 'sill' } });

  // upper floor (balcony extends to the front)
  kit.box(deckMat, [w, 0.22, d + 1.8], [0, FLOOR_H - 0.01, 0.9], 0, { tile: 1.2 });
  // leave a stair hole at the back-right: the floor collider is split around it
  const holeX0 = w / 2 - 2.2;
  colliders.push({ kind: 'box', center: [(-w / 2 + holeX0) / 2, FLOOR_H - 0.01, 0.9], half: [(holeX0 + w / 2) / 2, 0.11, (d + 1.8) / 2], opts: { material: 'wood', tag: 'floor2' } });
  colliders.push({ kind: 'box', center: [(holeX0 + w / 2) / 2, FLOOR_H - 0.01, 0.9 + 1.4], half: [(w / 2 - holeX0) / 2, 0.11, (d + 1.8) / 2 - 1.4], opts: { material: 'wood', tag: 'floor2' } });
  // upper walls: front wall with windows and a balcony door, side walls, back wall
  const y2 = FLOOR_H;
  colliders.push(...wallWithOpenings(kit, planks, w, FLOOR_H, t, [winOpen(w * 0.18), { x0: w * 0.5 - 0.6, x1: w * 0.5 + 0.6, y0: 0, y1: 2.15 }, winOpen(w * 0.82)], { tile: 1.0, swap: true }, { x: -w / 2, y: y2, z: d / 2, yaw: 0 }, m));
  colliders.push(...wallWithOpenings(kit, planks, w, FLOOR_H, t, [winOpen(w * 0.3), winOpen(w * 0.7)], { tile: 1.0, swap: true }, { x: -w / 2, y: y2, z: -d / 2, yaw: 0 }, m));
  for (const sx of [-1, 1]) colliders.push(...wallWithOpenings(kit, planks, d, FLOOR_H, t, [winOpen(d * 0.5)], { tile: 1.0, swap: true }, { x: sx * w / 2, y: y2, z: -d / 2, yaw: -Math.PI / 2 }, m));
  // balcony rail
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.1) kit.add(dark, limbGeo([x, y2, d / 2 + 1.7], [x, y2 + 1.05, d / 2 + 1.7], 0.045, 0.045, 6, 0.6));
  kit.add(dark, limbGeo([-w / 2, y2 + 1.05, d / 2 + 1.7], [w / 2, y2 + 1.05, d / 2 + 1.7], 0.04, 0.04, 6, 0.6));
  for (const sx of [-1, 1]) kit.add(dark, limbGeo([sx * w / 2, y2 + 1.05, d / 2 + 1.7], [sx * w / 2, y2 + 1.05, d / 2], 0.04, 0.04, 6, 0.6));
  colliders.push({ kind: 'box', center: [0, y2 + 0.5, d / 2 + 1.7], half: [w / 2, 0.5, 0.05], opts: { walkable: false, material: 'wood', tag: 'rail' } });
  // window panes
  for (const [wx, wz, yaw, ox] of [[-w / 2, d / 2, 0, w * 0.18], [-w / 2, d / 2, 0, w * 0.82], [-w / 2, -d / 2, 0, w * 0.3], [-w / 2, -d / 2, 0, w * 0.7]] as [number, number, number, number][]) {
    kit.box(glass, [1.0, 1.05, 0.03], [wx + ox, y2 + 1.52, wz], yaw, undefined);
    kit.box(dark, [1.12, 0.08, t + 0.1], [wx + ox, y2 + 0.98, wz], yaw, { tile: 0.6 });
    kit.box(dark, [1.12, 0.08, t + 0.1], [wx + ox, y2 + 2.1, wz], yaw, { tile: 0.6 });
  }
  for (const sx of [-1, 1]) kit.box(glass, [0.03, 1.05, 1.0], [sx * w / 2, y2 + 1.52, 0], 0, undefined);

  // interior (ground floor): hearth with chimney, long table, benches, stair
  kit.box(stone, [2.2, 1.2, 0.9], [-w / 2 + 1.5, 0.6, -d / 2 + 0.55], 0, { tile: 1.5 });
  kit.box(plain(0x050302, { roughness: 1, key: 'hearth' }), [1.2, 0.8, 0.1], [-w / 2 + 1.5, 0.55, -d / 2 + 1.02], 0, undefined);
  kit.box(plain(0xff6a18, { roughness: 0.9, emissive: 0xff5a10, emissiveIntensity: lit ? 1.3 : 0.2, key: 'embers' }), [0.9, 0.12, 0.3], [-w / 2 + 1.5, 0.2, -d / 2 + 1.0], 0, undefined);
  kit.box(stone, [1.0, FLOOR_H + 2, 0.9], [-w / 2 + 1.5, (FLOOR_H + 2) / 2, -d / 2 + 0.55], 0, { tile: 1.5 });
  colliders.push({ kind: 'box', center: [-w / 2 + 1.5, 0.6, -d / 2 + 0.55], half: [1.1, 0.6, 0.45], opts: { material: 'stone', tag: 'hearth' } });
  // table and benches
  kit.box(deckMat, [3.0, 0.1, 1.0], [0.4, 0.82, -0.6], 0, { tile: 1.2 });
  for (const sx of [-1.3, 1.3]) for (const sz of [-0.25, 0.25]) kit.box(dark, [0.12, 0.8, 0.12], [0.4 + sx, 0.4, -0.6 + sz * 1.6], 0, { tile: 0.6 });
  for (const sz of [-1.45, 0.3]) kit.box(deckMat, [2.8, 0.08, 0.34], [0.4, 0.46, sz], 0, { tile: 1.2 });
  colliders.push({ kind: 'box', center: [0.4, 0.45, -0.6], half: [1.5, 0.45, 0.5], opts: { material: 'wood', tag: 'table' } });
  // stairs against the right wall rising toward the back (hole in the upper floor)
  const stairX = w / 2 - 1.1;
  const nSteps = 14;
  const rise = FLOOR_H / nSteps;
  const run = 0.28;
  const stairGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nSteps; i++) {
    const z0 = d / 2 - 1.2 - i * run;
    kit.box(deckMat, [1.2, rise, run + 0.04], [stairX, rise * (i + 0.5) + 0.02, z0], 0, { tile: 1.2 });
    const g = new THREE.BoxGeometry(1.2, rise * (i + 1), run);
    g.translate(stairX, (rise * (i + 1)) / 2, z0);
    stairGeos.push(g);
  }
  const stairMesh = mergedColliderMesh(stairGeos, 'stairs_collider');
  colliders.push({ kind: 'mesh', mesh: stairMesh, opts: { material: 'wood', tag: 'stairs' } });
  // bed and chest upstairs
  kit.box(deckMat, [2.0, 0.4, 1.0], [-w / 2 + 1.3, y2 + 0.3, -d / 2 + 0.8], 0, { tile: 1.2 });
  kit.box(cloth, [1.9, 0.14, 0.9], [-w / 2 + 1.3, y2 + 0.56, -d / 2 + 0.8], 0, { tile: 0.5 });
  colliders.push({ kind: 'box', center: [-w / 2 + 1.3, y2 + 0.3, -d / 2 + 0.8], half: [1.0, 0.3, 0.5], opts: { material: 'wood', tag: 'bed' } });

  // roof: higher pitch and a wide overhang over the balcony
  const roof = gableRoof(kit, { w, d: d + 1.8, y: 2 * FLOOR_H, pitch: 0.66, overhang: 0.7, material: shingles, gableMaterial: planks, trim: dark });
  const roofMesh = mergedColliderMesh(roof.collider, 'roof_collider');
  roofMesh.position.z = 0.9;
  colliders.push({ kind: 'mesh', mesh: roofMesh, opts: { material: 'wood', tag: 'roof' } });
  const g = kit.build({ name: 'bards_house' });
  g.add(roofMesh);
  // shift the roof visuals to cover the balcony too
  g.traverse((ch) => {
    if ((ch as THREE.Mesh).isMesh && ch.name.includes('shingles')) ch.position.z = 0.9;
  });
  // lanterns under the balcony
  for (const x of [-w / 3, w / 3]) {
    const lan = lantern({ lit });
    lan.object.position.set(x, FLOOR_H - 0.3, d / 2 + 0.2);
    g.add(lan.object);
  }
  return {
    object: g,
    colliders,
    anchors: {
      door: [0, 0, d / 2 + 2.4],
      ridge: [0, roof.ridgeY, 0.9],
      deckCorners: [[-w / 2 - 0.5, 0, -d / 2 - 0.5], [w / 2 + 0.5, 0, -d / 2 - 0.5], [w / 2 + 0.5, 0, d / 2 + 2.1], [-w / 2 - 0.5, 0, d / 2 + 2.1]],
      eaveY: 2 * FLOOR_H,
      stairBottom: [stairX, 0, d / 2 - 0.9],
      stairTop: [stairX, FLOOR_H, d / 2 - 1.2 - nSteps * run],
      table: [0.4, 0.9, -0.6],
    },
  };
}

export interface PierOpts {
  /** deck half-thickness etc. are fixed; width in metres */
  width?: number;
  /** rope railings on both sides (default true) */
  rails?: boolean;
  /** depth of the piles below the deck */
  depth?: number;
  /** y of the deck surface when the path has no y */
  y?: number;
  seed?: number;
  /** lamp posts every N metres (0 = none) */
  lamps?: number;
  lit?: boolean;
}

/** plank walkway on piles along a path (corners are mitred by overlap). Deck surface at the path's y. */
export function pier(path: PathPoint[], width = 2.2, o: PierOpts = {}): Built & { path: Path } {
  const p = new Path(path, { smooth: false, step: 1e9, y: o.y ?? 0 });
  const rng = new Rng(hashSeed('pier', o.seed ?? 1, width));
  const kit = new MeshKit();
  const planks = mat('wood_planks', { key: 'pier', rgb: [0.78, 0.7, 0.58] });
  const dark = mat('old_wood', { key: 'pier', rgb: [0.85, 0.82, 0.78] });
  const colliders: ColliderDesc[] = [];
  const depth = o.depth ?? 3.2;
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i];
    const b = p.pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const yaw = Math.atan2(-dz, dx);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const cy = (a.y + b.y) / 2;
    const pitch = Math.atan2(b.y - a.y, l);
    const ext = width * 0.5;
    kit.box(planks, [l + ext, 0.16, width], [cx, cy - 0.08, cz], yaw, { tile: 1.2 }, [0, pitch]);
    // cross beams and stringers
    for (let s = 0.3; s < l; s += 1.5) {
      const t = s / l;
      const bx = a.x + dx * t;
      const bz = a.z + dz * t;
      kit.box(dark, [0.18, 0.22, width + 0.25], [bx, a.y + (b.y - a.y) * t - 0.27, bz], yaw + Math.PI / 2, { tile: 0.8 });
    }
    // piles every 3 m on both sides
    for (let s = 0.2; s < l + 0.1; s += 3.0) {
      const t = Math.min(1, s / l);
      const bx = a.x + dx * t;
      const bz = a.z + dz * t;
      const by = a.y + (b.y - a.y) * t;
      for (const side of [-1, 1]) {
        const px = bx + (-dz / l) * side * (width / 2 - 0.1);
        const pz = bz + (dx / l) * side * (width / 2 - 0.1);
        const r = 0.12 + rng.float() * 0.03;
        kit.add(dark, limbGeo([px, by - depth, pz], [px, by + (o.rails === false ? -0.1 : 0.95), pz], r * 1.15, r, 7, 0.8));
        colliders.push({ kind: 'cyl', x: px, z: pz, r: r * 1.2, y0: by - depth, y1: by - 0.2, opts: { walkable: false, material: 'wood', tag: 'pile' } });
      }
    }
    // rope rails: a sagging line between rail posts is approximated by a straight thin cylinder
    if (o.rails !== false) {
      for (const side of [-1, 1]) {
        const ox = (-dz / l) * side * (width / 2 - 0.1);
        const oz = (dx / l) * side * (width / 2 - 0.1);
        kit.add(plain(0x6a5a3a, { roughness: 1, key: 'rope' }), limbGeo([a.x + ox, a.y + 0.82, a.z + oz], [b.x + ox, b.y + 0.82, b.z + oz], 0.014, 0.014, 4, 0.3));
        kit.add(plain(0x6a5a3a, { roughness: 1, key: 'rope' }), limbGeo([a.x + ox, a.y + 0.5, a.z + oz], [b.x + ox, b.y + 0.5, b.z + oz], 0.012, 0.012, 4, 0.3));
      }
    }
    // collider: slanted segments use a box tilted by pitch only when flat enough
    colliders.push({ kind: 'box', center: [cx, cy - 0.08, cz], half: [l / 2 + ext / 2, 0.08, width / 2], yaw, opts: { material: 'wood', tag: 'pier' } });
  }
  // lamp posts
  const lampObjs: THREE.Object3D[] = [];
  if (o.lamps && o.lamps > 0) {
    for (let s = o.lamps / 2; s < p.length; s += o.lamps) {
      const q = p.at(s);
      const lp = lantern({ lit: o.lit ?? true });
      kit.add(dark, limbGeo([q.x, q.y, q.z], [q.x, q.y + 2.3, q.z], 0.06, 0.05, 6, 0.6));
      lp.object.position.set(q.x, q.y + 2.1, q.z);
      lampObjs.push(lp.object);
    }
  }
  const g = kit.build({ name: 'pier' });
  for (const l of lampObjs) g.add(l);
  return { object: g, colliders, path: p };
}
