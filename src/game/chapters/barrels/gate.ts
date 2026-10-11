/**
 * The Elvenking's water-gate: a stone gatehouse across the river with iron-banded doors, a walkway
 * over the lintel with the lever house, walls into the cliffs, broad stairs down the left bank, and
 * (far upstream) the cellar outlet the river comes from.
 *
 * Everything is built with the world builders (gate, stoneWall, stairs, torch, banner, lantern) and
 * placed in the gate's own frame: u = lateral (left of the flow = +u), v = downstream, y = up.
 */
import * as THREE from 'three';
import type { ColliderHandle, LevelAPI } from '../../../core/types';
import { addColliders, banner, gate, lantern, stairs, stoneWall, type Built } from '../../../world';
import { MeshKit } from '../../../world/util';
import { mat, plain } from '../../../world';
import { S, flowYaw, riverPos, waterY } from './layout';

export interface WaterGate {
  /** 0 closed .. 1 open: swings the door leaves, drops their colliders */
  setOpen(t: number): void;
  /** pull animation for the lever, 0 up .. 1 down */
  setLever(t: number): void;
  readonly isOpen: boolean;
  /** world point the player stands at to pull the lever */
  leverStand: THREE.Vector3;
  leverPos: THREE.Vector3;
  /** walkway surface height */
  topY: number;
  /** a point on the walkway left of the lever, on the right, and the lever itself (world) */
  walkLeft: THREE.Vector3;
  walkRight: THREE.Vector3;
  stairTop: THREE.Vector3;
  stairBottom: THREE.Vector3;
  /** waypoints up the stair axis, a tread or so apart: a walker steered along them cannot wander off the stairs */
  stairRoute: THREE.Vector3[];
  /** the foot of the stairs: where the bank run begins */
  landing: THREE.Vector3;
  /** gate frame -> world */
  at(u: number, v: number, y?: number, out?: THREE.Vector3): THREE.Vector3;
  yaw: number;
  /** world centre of the gate opening at water level */
  centre: THREE.Vector3;
}

/** lateral position of the lever house on the walkway */
const LX = -2.6;

export function buildWaterGate(level: LevelAPI, heightAt: (x: number, z: number) => number): WaterGate {
  const { physics } = level.ctx;
  const sG = S.gate;
  const yaw = flowYaw(sG);
  const c = riverPos(sG, 0);
  const y0 = waterY(sG) - 2.0;
  const topY = y0 + 8.5;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  /** gate frame -> world: rotation about Y by `yaw` (local +z is downstream) */
  const at = (u: number, v: number, y = 0, out = new THREE.Vector3()): THREE.Vector3 =>
    out.set(c.x + u * cos + v * sin, y, c.z - u * sin + v * cos);

  const handles: ColliderHandle[] = [];
  const add = (b: Built, parent?: THREE.Object3D) => {
    level.root.add(b.object);
    handles.push(...addColliders(physics, b.colliders, parent ?? b.object));
    return b;
  };

  // ── the gatehouse itself: wooden iron-banded leaves in a stone portal ──
  const g = gate({ width: 8, height: 6.5, depth: 4, material: 'blocks', kind: 'wood' });
  g.object.position.set(c.x, y0, c.z);
  g.object.rotation.y = yaw;
  add(g);
  const leafHandles = handles.filter((h) => h.tag === 'gate_left' || h.tag === 'gate_right');

  // ── walls: gate piers -> cliffs ──
  // the left wall is split where the stairs arrive (u 8.0 .. 10.6): a solid slab carries the deck across
  const wallL1 = stoneWall([at(7.0, 0, y0), at(8.0, 0, y0)], 8.5, 4, { crenellated: false, outer: 'right', material: 'blocks', anchorEvery: 0, sink: 3 });
  add(wallL1, undefined);
  const wallL2 = stoneWall([at(10.6, 0, y0), at(19, 0, y0)], 8.5, 4, { crenellated: false, outer: 'right', material: 'blocks', anchorEvery: 0, sink: 3 });
  add(wallL2, undefined);
  const wallR = stoneWall([at(-7.0, 0, y0), at(-17, 0, y0)], 8.5, 4, { crenellated: false, outer: 'left', material: 'blocks', anchorEvery: 0, sink: 3 });
  add(wallR, undefined);

  // ── parapet across the lintel (downstream side), the lever house on the upstream side ──
  const kit = new MeshKit();
  const stone = mat('stone_blocks', { key: 'gate-grey', rgb: [0.8, 0.82, 0.8] });
  const trim = mat('stone_blocks', { key: 'gate-trim', rgb: [0.98, 0.96, 0.9] });
  const iron = mat('metal_dark', { key: 'lever' });
  const wood = mat('old_wood', { key: 'lever' });
  // low parapet over the opening
  // (waist high: arrows fired down at the bank must clear it, and so must the archers' answer)
  kit.box(stone, [8.0, 0.8, 0.5], [0, topY + 0.4, 1.75], 0, { tile: 2 });
  kit.box(trim, [8.2, 0.14, 0.7], [0, topY + 0.87, 1.75], 0, { tile: 2 });
  // upstream parapet
  kit.box(stone, [8.0, 1.1, 0.5], [0, topY + 0.55, -1.75], 0, { tile: 2 });
  kit.box(trim, [8.2, 0.16, 0.7], [0, topY + 1.16, -1.75], 0, { tile: 2 });
  // the lever housing: a stone block on the upstream half of the walkway, left of centre
  kit.box(stone, [1.6, 1.15, 1.0], [LX, topY + 0.575, -0.95], 0, { tile: 1.4 });
  kit.box(trim, [1.8, 0.18, 1.2], [LX, topY + 1.2, -0.95], 0, { tile: 1.4 });
  // axle and winch drum (the chain that holds the leaves shut)
  kit.cyl(iron, 0.12, 0.12, 1.4, 10, [LX, topY + 1.5, -0.95], 1, { tilt: [0, Math.PI / 2] });
  const geo = kit.build({ name: 'gatehouse-top' });
  level.root.add(geo);
  const topCols: Built['colliders'] = [
    { kind: 'box', center: [0, topY + 0.4, 1.75], half: [4.0, 0.4, 0.25], opts: { material: 'stone', walkable: false, tag: 'parapet' } },
    { kind: 'box', center: [0, topY + 0.55, -1.75], half: [4.0, 0.55, 0.25], opts: { material: 'stone', walkable: false, tag: 'parapet' } },
    { kind: 'box', center: [LX, topY + 0.575, -0.95], half: [0.8, 0.575, 0.5], opts: { material: 'stone', walkable: false, tag: 'lever_house' } },
  ];
  // these are in gate frame; transform with a helper group
  const frame = new THREE.Group();
  frame.position.set(c.x, 0, c.z);
  frame.rotation.y = yaw;
  frame.add(geo);
  level.root.add(frame);
  frame.updateMatrixWorld(true);
  handles.push(...addColliders(physics, topCols, frame));
  // the winch frame over the lever house: timber posts on the upstream parapet, a cross-beam, braces and the chains
  // that hold the leaves (the tall timber machine on the left of the reference gate)
  {
    const tk = new MeshKit();
    const beam = mat('old_wood', { key: 'winch', rgb: [0.85, 0.78, 0.68] });
    const chainM = mat('metal_dark', { key: 'winch-chain' });
    const vz = -1.75;
    const top = topY + 4.3;
    for (const du of [-2.0, 2.0]) {
      tk.box(beam, [0.34, 4.3 + 0.2, 0.34], [LX + du, topY + 2.05, vz], 0, { tile: 1.6, swap: true });
      tk.box(beam, [0.2, 1.9, 0.2], [LX + du * 0.62, topY + 3.2, vz], 0, { tile: 1.6, swap: true }, [0, du > 0 ? 0.6 : -0.6]);
    }
    tk.box(beam, [4.9, 0.36, 0.4], [LX, top, vz], 0, { tile: 1.6 });
    tk.box(beam, [4.4, 0.24, 0.3], [LX, top - 1.25, vz], 0, { tile: 1.6 });
    tk.cyl(iron, 0.2, 0.2, 1.7, 10, [LX, top - 0.55, vz], 1, { tilt: [0, Math.PI / 2] });
    for (const du of [-0.7, 0.7]) {
      // a taut chain from the drum down to the leaves' lintel (the slab of links is a thin dark rod)
      const x = LX + du;
      tk.cyl(chainM, 0.045, 0.045, 5.4, 6, [x, topY + 1.2, vz + 0.0], 0.5, { tilt: [0.02, 0] });
    }
    // banner poles on the downstream parapet get a tall timber cap
    const frame = new THREE.Group();
    frame.position.set(c.x, 0, c.z);
    frame.rotation.y = yaw;
    frame.add(tk.build({ name: 'winch-frame' }));
    level.root.add(frame);
  }
  // two stone towers where the walls meet the cliffs: the gate reads as a fortress from the bank run
  {
    const sk = new MeshKit();
    const slate = mat('stone_blocks', { key: 'gate-slate', rgb: [0.46, 0.52, 0.5] });
    const darkSlot = plain(0x070706, { roughness: 1, key: 'slit' });
    const towers: { u: number; w: number }[] = [{ u: 14.8, w: 4.4 }, { u: -12.8, w: 4.4 }];
    const cols: Built['colliders'] = [];
    for (const t of towers) {
      const hgt = 5.4;
      sk.box(stone, [t.w, hgt + 3, 4.6], [t.u, topY - 3 + (hgt + 3) / 2, 0], 0, { tile: 2.4 });
      sk.box(trim, [t.w + 0.4, 0.3, 5.0], [t.u, topY + hgt - 0.1, 0], 0, { tile: 2 });
      // pyramid roof
      sk.cyl(slate, 0.1, t.w * 0.82, 3.0, 4, [t.u, topY + hgt + 1.6, 0], 2, { yaw: Math.PI / 4 });
      // pointed window on the downstream face, an arrow slit on each side
      sk.box(darkSlot, [0.75, 1.7, 0.1], [t.u, topY + 3.2, 2.33], 0, undefined);
      sk.box(trim, [1.1, 0.18, 0.2], [t.u, topY + 4.15, 2.36], 0, { tile: 1 });
      sk.box(darkSlot, [0.1, 1.2, 0.18], [t.u - t.w / 2 - 0.0, topY + 2.8, 0.0], 0, undefined);
      cols.push({ kind: 'box', center: [t.u, topY + hgt / 2 - 0.2, 0], half: [t.w / 2, hgt / 2 + 0.2, 2.3], opts: { material: 'stone', walkable: false, tag: 'gate_tower' } });
    }
    const tf = new THREE.Group();
    tf.position.set(c.x, 0, c.z);
    tf.rotation.y = yaw;
    tf.add(sk.build({ name: 'gate-towers' }));
    level.root.add(tf);
    tf.updateMatrixWorld(true);
    handles.push(...addColliders(physics, cols, tf));
  }
  // the stair-head slab: a solid block under the deck between the wall ends
  {
    const sk = new MeshKit();
    sk.box(stone, [2.6, 10.5, 4], [9.3, topY - 5.25, 0], 0, { tile: 3 });
    sk.box(trim, [2.8, 0.2, 4.2], [9.3, topY - 0.1, 0], 0, { tile: 2 });
    frame.add(sk.build({ name: 'stair-head-slab' }));
    handles.push(...addColliders(physics, [{ kind: 'box', center: [9.3, topY - 5.25, 0], half: [1.3, 5.25, 2], opts: { material: 'stone', tag: 'slab' } }], frame));
  }
  // invisible rails above the parapets: nobody jumps off the walkway (arrows and the camera pass through)
  {
    const rail = (u0: number, u1: number, v: number): Built['colliders'][number] => ({
      kind: 'box', center: [(u0 + u1) / 2, topY + 1.9, v], half: [Math.abs(u1 - u0) / 2, 1.4, 0.15],
      opts: { walkable: false, blocksArrows: false, blocksCamera: false, solid: true, tag: 'rail' },
    });
    handles.push(...addColliders(physics, [rail(-17, 19, -2.0), rail(-17, 7.9, 2.0), rail(10.7, 19, 2.0)], frame));
  }

  // the lever: a long iron arm with a wooden grip, pivoting on the axle
  const leverPivot = new THREE.Group();
  leverPivot.position.set(LX, topY + 1.5, -0.95);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.0, 8), iron);
  arm.position.y = 1.0;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10), wood);
  grip.rotation.z = Math.PI / 2;
  grip.position.y = 2.05;
  arm.castShadow = grip.castShadow = true;
  leverPivot.add(arm, grip);
  leverPivot.rotation.x = -0.6;
  frame.add(leverPivot);
  const setLever = (t: number) => {
    leverPivot.rotation.x = THREE.MathUtils.lerp(-0.6, 0.85, t);
  };

  // ── stairs down the left bank, from the walkway's left end to the shelf ──
  const stairX = 9.3;
  const bottomV = 17.6;
  const bx = at(stairX, bottomV, 0);
  bx.y = heightAt(bx.x, bx.z);
  const st = stairs([bx.x, bx.y, bx.z], [at(stairX, 2.1, 0).x, topY, at(stairX, 2.1, 0).z], 2.6, { material: 'mossy', rails: true });
  add(st, undefined);

  // elven banners on the downstream parapet
  for (const u of [-2.6, 2.6]) {
    const b = banner(0x233d2b, 'white_tree', { height: 3.4, clothW: 0.85, clothH: 2.5 });
    const p = at(u, 1.75, topY + 0.9);
    b.object.position.copy(p);
    b.object.rotation.y = yaw + Math.PI;
    level.root.add(b.object);
  }
  // lanterns over the lintel
  for (const u of [-3.6, 3.6]) {
    const lt = lantern({ lit: true });
    const p = at(u, 0, topY + 3.6);
    lt.object.position.copy(p);
    level.root.add(lt.object);
    void plain;
  }

  // ── the cellar outlet, far upstream: a huge open archway the river runs out of ──
  const yo = waterY(5) - 2.4;
  const co = riverPos(5, 0);
  const yawO = flowYaw(5);
  const outlet = gate({ width: 12, height: 9, depth: 7, material: 'light', kind: 'iron' });
  outlet.object.position.set(co.x, yo, co.z);
  outlet.object.rotation.y = yawO;
  outlet.setOpen(1);
  level.root.add(outlet.object);
  // dark interior behind the arch so the opening reads as a hall
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(13, 10), new THREE.MeshBasicMaterial({ color: 0x020403, side: THREE.DoubleSide }));
  // the hall behind the arch: the river runs out of it toward +v, so the plane sits upstream (-v) of the opening
  dark.position.set(0, 4.8, -3.0);
  const oframe = new THREE.Group();
  oframe.position.set(co.x, yo, co.z);
  oframe.rotation.y = yawO;
  oframe.add(dark);
  level.root.add(oframe);
  // the outlet's own piers collide so nobody wanders into it
  handles.push(...addColliders(physics, outlet.colliders.filter((d) => d.opts?.tag !== 'gate_left' && d.opts?.tag !== 'gate_right'), outlet.object));

  let open = 0;
  const setOpen = (t: number) => {
    open = t;
    g.setOpen(t);
    const on = t < 0.15;
    for (const h of leafHandles) h.enabled = on;
  };

  const leverStand = at(LX, 0.9, topY);
  // dense waypoints along the stair axis (the treads rise linearly; each point sits on its tread)
  const stairTopP = at(stairX, 2.6, topY);
  const stairRoute: THREE.Vector3[] = [];
  {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      stairRoute.push(new THREE.Vector3(bx.x + (stairTopP.x - bx.x) * t, bx.y + (topY - bx.y) * t, bx.z + (stairTopP.z - bx.z) * t));
    }
  }
  const out: WaterGate = {
    setOpen,
    setLever,
    get isOpen() {
      return open > 0.5;
    },
    leverStand,
    leverPos: at(LX, -0.95, topY + 1.2),
    topY,
    walkLeft: at(7.2, 0.4, topY),
    walkRight: at(-5.4, 0.4, topY),
    stairTop: at(stairX, 2.6, topY),
    stairBottom: bx.clone(),
    stairRoute,
    landing: at(stairX - 2.2, bottomV + 3.0, 0),
    at,
    yaw,
    centre: c.clone().setY(waterY(sG)),
  };
  out.landing.y = heightAt(out.landing.x, out.landing.z);
  return out;
}
