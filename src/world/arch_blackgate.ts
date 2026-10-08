/** The Black Gate (Morannon): the Towers of the Teeth, wing walls and the colossal iron gates. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat } from './mats';
import { cliffGeometry, limbGeo, xf } from './geom';
import { MeshKit } from './util';
import type { Built, ColliderDesc } from './colliders';
import { stoneMat, type V3 } from './arch_common';

export interface BlackGateResult extends Built {
  left: THREE.Group;
  right: THREE.Group;
  /** 0 = closed, 1 = fully open. Gate colliders tagged 'gate_left' / 'gate_right' stay where they are: remove them when opening. */
  setOpen(t: number): void;
  anchors: {
    /** centre of the opening on the ground, outside (+z) */
    front: V3;
    /** opening size */
    opening: { w: number; h: number };
    leftTower: V3;
    rightTower: V3;
    /** walls' top y */
    wallTop: number;
  };
}

/**
 * Colossal black iron gates between the Towers of the Teeth. Faces +z (toward the Plateau of Gorgoroth
 * side is -z). `scale` multiplies every dimension (default 1: opening 30 x 36 m, towers 76 m).
 */
export function blackGate(o: { scale?: number; seed?: number } = {}): BlackGateResult {
  const S = o.scale ?? 1;
  const rng = new Rng(hashSeed('blackgate', o.seed ?? 1));
  const kit = new MeshKit();
  const black = mat('cliff', { key: 'mordor', rgb: [0.3, 0.28, 0.3] });
  const slag = mat('rock', { key: 'mordorRock', rgb: [0.28, 0.26, 0.26] });
  const iron = mat('metal_dark', { key: 'gateplate', rgb: [0.6, 0.55, 0.55] });
  const rust = mat('metal_dark', { key: 'gaterust', rgb: [1.15, 0.8, 0.65] });
  const colliders: ColliderDesc[] = [];
  const W = 30 * S;
  const Hh = 36 * S;
  const towerW = 30 * S;
  const towerD = 34 * S;
  const towerH = 76 * S;
  const wallH = 24 * S;
  const wallT = 8 * S;
  const box = (m: THREE.Material, size: [number, number, number], pos: [number, number, number], yaw = 0, tile = 5 * S, tilt?: [number, number]) => kit.box(m, size, pos, yaw, { tile }, tilt);

  for (const s of [-1, 1]) {
    const cx = s * (W / 2 + towerW / 2);
    // craggy tapered tower: one displaced mass, a fortified base and cliff buttresses
    kit.add(black, cliffGeometry(towerW + 6 * S, 16 * S, towerD + 6 * S, 3 + s, { rough: 0.5, taper: 0.1, cell: 4 * S, tile: 8 * S }), xf(cx, 8 * S - 1, 0));
    kit.add(black, cliffGeometry(towerW, towerH - 12 * S, towerD, 7 + s, { rough: 0.9, taper: 0.38, strata: 0.9, cell: 3.2 * S, tile: 8 * S }), xf(cx, 14 * S + (towerH - 12 * S) / 2, 0));
    for (let i = 0; i < 5; i++) {
      const by = 20 * S + i * 11 * S;
      const sh = 1 - 0.34 * ((by - 14 * S) / towerH);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (rng.chance(0.45)) continue;
        kit.add(black, cliffGeometry(5 * S, 10 * S, 5 * S, i * 5 + sx + sz * 3, { rough: 1, cell: 2 * S, tile: 6 * S }), xf(cx + sx * towerW * 0.5 * sh, by + 5 * S, sz * towerD * 0.5 * sh, rng.float()));
      }
    }
    for (const y of [0.3, 0.55, 0.8]) box(slag, [towerW * (1 - 0.34 * y) + 3 * S, 1.8 * S, towerD * (1 - 0.34 * y) + 3 * S], [cx, towerH * y, 0], 0, 4 * S);
    // the teeth: jagged spikes crowning the tower, leaning outward
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = towerW * 0.3;
      const x0 = cx + Math.cos(a) * rr;
      const z0 = Math.sin(a) * rr * 1.1;
      const len = (14 + rng.float() * 18) * S;
      const lean = 0.35 + rng.float() * 0.3;
      kit.add(black, limbGeo([x0, towerH * 1.04, z0], [x0 + Math.cos(a) * len * lean + -s * len * 0.25, towerH * 1.04 + len, z0 + Math.sin(a) * len * lean], 2.2 * S, 0.12 * S, 6, 6 * S));
    }
    // great horn arching toward the gate
    const hx = cx - s * towerW * 0.35;
    kit.add(black, limbGeo([hx, towerH * 0.85, towerD * 0.28], [hx - s * 10 * S, towerH * 1.15, towerD * 0.34], 4 * S, 1.2 * S, 7, 6 * S));
    kit.add(black, limbGeo([hx - s * 10 * S, towerH * 1.15, towerD * 0.34], [hx - s * 16 * S, towerH * 1.32, towerD * 0.3], 1.2 * S, 0.1 * S, 6, 6 * S));
    colliders.push({ kind: 'box', center: [cx, 7 * S, 0], half: [towerW / 2 + 3 * S, 7 * S, towerD / 2 + 3 * S], opts: { material: 'stone', tag: 'tower' } });
    colliders.push({ kind: 'box', center: [cx, towerH / 2, 0], half: [towerW / 2, towerH / 2, towerD / 2], opts: { material: 'stone', walkable: false, tag: 'tower' } });
    // wing wall running outward with a battlemented top
    const wl = 80 * S;
    const wx = s * (W / 2 + towerW + wl / 2 - 1);
    box(black, [wl, wallH + 3, wallT], [wx, wallH / 2 - 1.5, -2 * S]);
    box(slag, [wl, 2 * S, wallT + 2 * S], [wx, wallH - 1 * S, -2 * S], 0, 4 * S);
    const nM = Math.floor(wl / (3.2 * S));
    for (let i = 0; i < nM; i++) box(black, [2 * S, 2.2 * S, 1.6 * S], [s * (W / 2 + towerW) + s * (i + 0.5) * (wl / nM), wallH + 1.1 * S, -2 * S + wallT / 2 - 0.8 * S], 0, 3 * S);
    colliders.push({ kind: 'box', center: [wx, wallH / 2, -2 * S], half: [wl / 2, wallH / 2, wallT / 2], opts: { material: 'stone', tag: 'wing_wall' } });
  }
  // gate lintel with hanging teeth
  box(black, [W + 2 * S, 14 * S, towerD * 0.9], [0, Hh + 7 * S, 0]);
  box(slag, [W + 6 * S, 3 * S, towerD], [0, Hh + 1.5 * S, 0], 0, 4 * S);
  colliders.push({ kind: 'box', center: [0, Hh + 7 * S, 0], half: [W / 2 + S, 7 * S, towerD * 0.45], opts: { material: 'stone', walkable: false, tag: 'lintel' } });
  for (let i = 0; i < 16; i++) {
    const x = -W / 2 + ((i + 0.5) / 16) * W;
    const len = (3 + rng.float() * 4) * S;
    kit.add(iron, new THREE.ConeGeometry(0.8 * S, len, 5), xf(x, Hh - len / 2 + 0.5 * S, towerD * 0.45, 0, 1, -1, 1));
  }
  // floor slab through the gate
  box(slag, [W + 20 * S, 3, towerD + 10 * S], [0, -1.5, 0], 0, 5 * S);
  colliders.push({ kind: 'box', center: [0, -1.5, 0], half: [(W + 20 * S) / 2, 1.5, (towerD + 10 * S) / 2], opts: { material: 'stone', tag: 'gate_floor' } });
  const root = kit.build({ name: 'black_gate' });

  // the gate leaves: plated iron, ribs, rivets, spikes, hinge columns
  const makeLeaf = (s: number): THREE.Group => {
    const k = new MeshKit();
    const lw = W / 2 - 0.2 * S;
    const t = 2.6 * S;
    const cxl = -s * lw / 2;
    k.box(iron, [lw, Hh - 0.4, t], [cxl, Hh / 2, 0], 0, { tile: 4 * S });
    // vertical ribs
    for (let i = 0; i < 6; i++) k.box(rust, [0.9 * S, Hh - 1, 0.8 * S], [-s * (0.6 * S + i * (lw - 1.2 * S) / 5), Hh / 2, t / 2 + 0.3 * S], 0, { tile: 2 * S });
    // massive horizontal bands
    for (const y of [3, 9, 15, 21, 27, 33]) k.box(rust, [lw + 0.4, 1.6 * S, t + 1.2 * S], [cxl, y * S, 0], 0, { tile: 3 * S });
    // rivets
    const rv = new THREE.SphereGeometry(0.28 * S, 6, 4);
    for (const y of [3, 9, 15, 21, 27, 33]) for (let i = 0; i < 12; i++) k.add(iron, rv.clone(), xf(-s * (0.8 * S + i * (lw - 1.6 * S) / 11), y * S + 0.0, t / 2 + 0.9 * S));
    // hinge column
    k.add(iron, new THREE.CylinderGeometry(1.4 * S, 1.4 * S, Hh, 10), xf(-s * 0.2, Hh / 2, 0));
    // spikes along the top
    for (let i = 0; i < 9; i++) k.add(iron, new THREE.ConeGeometry(0.7 * S, 3.2 * S, 5), xf(-s * (1 + i * (lw - 2) / 8), Hh + 1.2 * S, 0));
    // heavy eye-like boss
    k.add(rust, new THREE.TorusGeometry(2.4 * S, 0.45 * S, 6, 14), xf(-s * lw * 0.8, Hh * 0.55, t / 2 + 1.2 * S, 0));
    const grp = k.build({ name: 'leaf' });
    const pivot = new THREE.Group();
    pivot.position.set(s * W / 2, 0, 0);
    pivot.add(grp);
    return pivot;
  };
  const left = makeLeaf(-1);
  const right = makeLeaf(1);
  left.name = 'gate_left';
  right.name = 'gate_right';
  root.add(left, right);
  colliders.push({ kind: 'box', center: [-W / 4, Hh / 2, 0], half: [W / 4, Hh / 2, 1.3 * S], opts: { material: 'metal', tag: 'gate_left' } });
  colliders.push({ kind: 'box', center: [W / 4, Hh / 2, 0], half: [W / 4, Hh / 2, 1.3 * S], opts: { material: 'metal', tag: 'gate_right' } });
  const setOpen = (t: number) => {
    const a = Math.max(0, Math.min(1, t)) * 1.7;
    // open outward (toward +z): rotate about the outer hinge
    left.rotation.y = a;
    right.rotation.y = -a;
  };
  setOpen(0);
  return {
    object: root,
    colliders,
    left,
    right,
    setOpen,
    anchors: {
      front: [0, 0, towerD / 2 + 4],
      opening: { w: W, h: Hh },
      leftTower: [-(W / 2 + towerW / 2), 0, 0],
      rightTower: [W / 2 + towerW / 2, 0, 0],
      wallTop: wallH,
    },
  };
}
