/** Ravenhill: ruined dwarven watchtower, broken stone bridges and a frozen waterfall. */
import * as THREE from 'three';
import { Rng, hashSeed, noise2 } from '../core/rng';
import { mat, plain } from './mats';
import { xf } from './geom';
import { MeshKit, bakeFaceBoxUV } from './util';
import type { Built, ColliderDesc } from './colliders';
import { archRing, mergedColliderMesh, stoneMat, type V3 } from './arch_common';
import { rock } from './props';

export interface TowerRuinOpts {
  radius?: number;
  height?: number;
  thickness?: number;
  /** angle (radians, 0 = +x) where the walls stay tallest */
  tallSide?: number;
  seed?: number;
  snow?: boolean;
}

export interface TowerRuinResult extends Built {
  anchors: {
    /** door on the ground floor (outside) */
    door: V3;
    /** floor heights inside */
    floors: number[];
    /** spiral stair: bottom and top step centres */
    stairBottom: V3;
    stairTop: V3;
    /** top of the tallest wall */
    top: V3;
  };
}

/**
 * Ruined dwarven watchtower: a ring of masonry with a broken crown, two timber floors with holes, a
 * spiral stair along the inside wall, a door and arrow windows, snow caps and rubble. Origin at the
 * centre of the base, door toward +z.
 */
export function ruinedWatchtower(o: TowerRuinOpts = {}): TowerRuinResult {
  const R = o.radius ?? 6.5;
  const H = o.height ?? 26;
  const T = o.thickness ?? 1.7;
  const rng = new Rng(hashSeed('ruin_tower', o.seed ?? 1));
  const tall = o.tallSide ?? -Math.PI / 2;
  const kit = new MeshKit();
  const stone = stoneMat('dark');
  const light = stoneMat('light');
  const snow = mat('snow', { key: 'ruinsnow' });
  const wood = mat('old_wood', { key: 'tower', rgb: [0.8, 0.78, 0.75] });
  const colliders: ColliderDesc[] = [];
  const N = 30;
  const chord = (2 * Math.PI * R) / N;
  const noise = noise2(hashSeed('rt', o.seed ?? 1) % 1000);
  const windows = [[0.55, 8.0], [2.4, 8.0], [4.2, 8.0], [1.2, 15.5], [3.4, 15.5], [5.3, 15.5]];
  const doorA = Math.PI / 2; // +z
  let topTall = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    // ruined height profile
    const k = 0.5 + 0.5 * Math.cos(a - tall);
    let h = H * (0.38 + 0.62 * Math.pow(k, 0.8)) + noise(a * 2.2, 3) * 2.4;
    h = Math.max(6, Math.min(H, h));
    const doorGap = Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < (chord * 1.1) / R;
    const nBlocks = Math.max(1, Math.ceil(h / 2.1));
    const bh = h / nBlocks;
    for (let b = 0; b < nBlocks; b++) {
      const y0 = b * bh;
      const yc = y0 + bh / 2;
      // skip window openings
      let isWin = false;
      for (const [wa, wy] of windows) {
        const da = Math.abs(Math.atan2(Math.sin(a - wa), Math.cos(a - wa)));
        if (da < chord * 0.6 / R && yc > wy - 0.2 && yc < wy + 2.6) isWin = true;
      }
      if (doorGap && yc < 4.0) isWin = true;
      if (isWin) continue;
      const off = (rng.float() - 0.5) * 0.12;
      const rr = R + off;
      kit.box(stone, [T + (rng.float() - 0.5) * 0.12, bh + 0.02, chord * 1.04], [Math.cos(a) * rr, yc, Math.sin(a) * rr], -a, { tile: 3 }, [0, (rng.float() - 0.5) * 0.02]);
    }
    // jagged top: a few loose blocks
    if (h < H - 1 && rng.chance(0.6)) {
      const s = 0.5 + rng.float() * 0.8;
      kit.box(stone, [T * 0.8, s, chord * 0.6], [Math.cos(a) * R, h + s / 2 - 0.1, Math.sin(a) * R], -a + (rng.float() - 0.5) * 0.4, { tile: 2 }, [0, (rng.float() - 0.5) * 0.4]);
    }
    if (o.snow !== false) {
      kit.box(snow, [T + 0.25, 0.3 + rng.float() * 0.3, chord * 1.1], [Math.cos(a) * R, h + 0.1, Math.sin(a) * R], -a, { tile: 2 });
    }
    if (h > topTall) topTall = h;
    if (!doorGap) colliders.push({ kind: 'box', center: [x, h / 2, z], half: [T / 2, h / 2, (chord * 1.04) / 2], yaw: -a, opts: { material: 'stone', tag: 'tower_wall' } });
    else colliders.push({ kind: 'box', center: [x, (h + 4.0) / 2, z], half: [T / 2, (h - 4.0) / 2, (chord * 1.04) / 2], yaw: -a, opts: { material: 'stone', tag: 'tower_lintel' } });
  }
  // door arch
  const dk = new MeshKit();
  archRing(dk, light, 2.4, 0.5, T + 0.4, 2.7, 2);
  const door = dk.build({ name: 'door_arch' });
  door.position.set(0, 0, R);
  door.rotation.y = 0;
  // base plinth ring
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    kit.box(light, [T + 0.6, 0.9, chord * 1.05], [Math.cos(a) * R, 0.45, Math.sin(a) * R], -a, { tile: 2 });
  }
  // floors: timber discs with holes
  const floors = [8.2, 15.8];
  const floorGeos: THREE.BufferGeometry[] = [];
  floors.forEach((fy, fi) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, R - T / 2 + 0.05, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    const hx = fi === 0 ? -1.4 : 1.2;
    hole.absarc(hx, 0.8, 1.9 + fi * 0.5, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 20 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, fy - 0.3, 0);
    floorGeos.push(g.clone());
    g.deleteAttribute('uv');
    kit.add(wood, g, null, { tile: 1.2 });
    // joists
    for (let j = -4; j <= 4; j++) kit.box(wood, [0.28, 0.4, (R - T / 2) * 1.8], [j * 1.3, fy - 0.5, 0], 0, { tile: 0.8 });
  });
  const floorMesh = mergedColliderMesh(floorGeos, 'floors_collider');
  colliders.push({ kind: 'mesh', mesh: floorMesh, opts: { material: 'wood', tag: 'tower_floor' } });
  // spiral stair against the inside wall
  const steps = 56;
  const r = R - T / 2 - 0.95;
  const total = 16.0;
  const stairBox: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const a = Math.PI / 2 + 0.4 + (i / 16) * Math.PI * 2 * 0.99;
    const y = (i / steps) * total + 0.2;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r;
    kit.box(stone, [1.5, 0.3, 1.75], [sx, y, sz], -a, { tile: 1.5 });
    // support block down to the floor below
    kit.box(stone, [0.9, Math.min(y, 2.6), 1.1], [Math.cos(a) * (r + 0.35), y - Math.min(y, 2.6) / 2, Math.sin(a) * (r + 0.35)], -a, { tile: 1.5 });
    const g = new THREE.BoxGeometry(1.5, 0.3, 1.75);
    g.rotateY(-a);
    g.translate(sx, y, sz);
    stairBox.push(g);
  }
  const stairMesh = mergedColliderMesh(stairBox, 'spiral_collider');
  colliders.push({ kind: 'mesh', mesh: stairMesh, opts: { material: 'stone', tag: 'tower_stair' } });
  // rubble and snow drifts around the base
  for (let i = 0; i < 28; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = R + 1.5 + rng.float() * 5.5;
    const s = 0.35 + rng.float() * 0.9;
    kit.box(stone, [s, s * 0.7, s * 0.9], [Math.cos(a) * d, s * 0.3, Math.sin(a) * d], rng.float() * 3, { tile: 2 }, [rng.float() * 0.5, rng.float() * 0.5]);
  }
  if (o.snow !== false) {
    for (let i = 0; i < 9; i++) {
      const a = rng.float() * Math.PI * 2;
      const d = R + 1 + rng.float() * 3;
      const sg = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      kit.add(snow, sg, xf(Math.cos(a) * d, 0, Math.sin(a) * d, a, 2.0 + rng.float() * 2, 0.6 + rng.float() * 0.5, 1.4 + rng.float() * 1.5), { tile: 3 });
    }
  }
  const g = kit.build({ name: 'ruined_watchtower' });
  g.add(door);
  g.add(floorMesh);
  g.add(stairMesh);
  void plain;
  void bakeFaceBoxUV;
  return {
    object: g,
    colliders,
    anchors: {
      door: [0, 0, R + 1.5],
      floors,
      stairBottom: [Math.cos(Math.PI / 2 + 0.4) * r, 0.2, Math.sin(Math.PI / 2 + 0.4) * r],
      stairTop: [Math.cos(Math.PI / 2 + 0.4 + (55 / 16) * Math.PI * 2 * 0.99) * r, total + 0.2, Math.sin(Math.PI / 2 + 0.4 + (55 / 16) * Math.PI * 2 * 0.99) * r],
      top: [Math.cos(tall) * R, topTall, Math.sin(tall) * R],
    },
  };
}

export interface BridgeResult extends Built {
  anchors: { start: V3; end: V3; gapStart: V3; gapEnd: V3 };
}

/**
 * Stone arch bridge along +x centred on the origin, deck top at y = 0. `gap` = [t0, t1] fractions of the
 * length that have collapsed (default none). Two arched spans per half, parapets, rubble at the breaks.
 */
export function brokenBridge(length = 30, width = 6, o: { gap?: [number, number]; seed?: number; snow?: boolean; depth?: number } = {}): BridgeResult {
  const rng = new Rng(hashSeed('bridge', o.seed ?? 1, length));
  const kit = new MeshKit();
  const stone = stoneMat('dark');
  const light = stoneMat('light');
  const snow = mat('snow', { key: 'bridgesnow' });
  const colliders: ColliderDesc[] = [];
  const depth = o.depth ?? 10;
  const gap = o.gap;
  const g0 = gap ? -length / 2 + gap[0] * length : length;
  const g1 = gap ? -length / 2 + gap[1] * length : length;
  const segs: [number, number][] = gap ? [[-length / 2, g0], [g1, length / 2]] : [[-length / 2, length / 2]];
  const deckT = 1.1;
  const archObjs: THREE.Object3D[] = [];
  for (const [x0, x1] of segs) {
    const len = x1 - x0;
    // deck slab with a ragged end at the break
    const broken0 = gap && x0 === g1;
    const broken1 = gap && x1 === g0;
    const cx = (x0 + x1) / 2;
    kit.box(stone, [len, deckT, width], [cx, -deckT / 2, 0], 0, { tile: 3 });
    colliders.push({ kind: 'box', center: [cx, -deckT / 2, 0], half: [len / 2, deckT / 2, width / 2], opts: { material: 'stone', tag: 'bridge' } });
    // arch ring under each span (pier every ~9 m)
    const n = Math.max(1, Math.round(len / 9));
    const sp = len / n;
    for (let i = 0; i < n; i++) {
      const ax = x0 + (i + 0.5) * sp;
      const k2 = new MeshKit();
      archRing(k2, light, sp - 1.2, 0.8, width, -deckT - 0.0, 2);
      const ar = k2.build({ name: 'arch' });
      ar.rotation.y = 0;
      ar.position.set(ax, -deckT - (sp - 1.2) / 2, 0);
      archObjs.push(ar);
      // spandrel fill between ring and deck
      kit.box(stone, [sp, (sp - 1.2) / 2 + 0.2, width * 0.96], [ax, -deckT - (sp - 1.2) / 4, 0], 0, { tile: 3 });
      // pier
      kit.box(stone, [1.4, depth, width + 0.6], [x0 + i * sp, -deckT - depth / 2, 0], 0, { tile: 3 });
      colliders.push({ kind: 'box', center: [x0 + i * sp, -deckT - depth / 2, 0], half: [0.7, depth / 2, width / 2 + 0.3], opts: { material: 'stone', walkable: false, tag: 'bridge_pier' } });
    }
    kit.box(stone, [1.4, depth, width + 0.6], [x1, -deckT - depth / 2, 0], 0, { tile: 3 });
    // parapets (missing near the break)
    for (const side of [-1, 1]) {
      let px = x0;
      while (px < x1 - 0.3) {
        const seg = 1.4 + rng.float() * 0.6;
        const e = Math.min(px + seg, x1);
        const nearBreak = (broken0 && px < x0 + 2.5) || (broken1 && e > x1 - 2.5);
        const hgt = nearBreak ? 0.3 + rng.float() * 0.6 : 1.05;
        kit.box(stone, [e - px, hgt, 0.55], [(px + e) / 2, hgt / 2, side * (width / 2 - 0.27)], 0, { tile: 2 });
        if (!nearBreak) colliders.push({ kind: 'box', center: [(px + e) / 2, hgt / 2, side * (width / 2 - 0.27)], half: [(e - px) / 2, hgt / 2, 0.275], opts: { material: 'stone', walkable: false, tag: 'bridge_rail' } });
        if (o.snow !== false) kit.box(snow, [e - px, 0.14, 0.7], [(px + e) / 2, hgt + 0.05, side * (width / 2 - 0.27)], 0, { tile: 2 });
        px = e;
      }
    }
    // jagged teeth at the break
    for (const [bx, dir, is] of [[x1, 1, broken1], [x0, -1, broken0]] as [number, number, boolean | undefined][]) {
      if (!is) continue;
      for (let i = 0; i < 5; i++) {
        const w = 0.8 + rng.float() * 1.6;
        const zz = -width / 2 + (i + 0.5) * (width / 5);
        kit.box(stone, [w, deckT * (0.5 + rng.float() * 0.7), width / 5 + 0.05], [bx - dir * (w / 2 - 0.1) * -1 + (is ? 0 : 0) + dir * 0.0, -deckT * 0.6, zz], 0, { tile: 2 });
      }
    }
    if (o.snow !== false) kit.box(snow, [len, 0.22, width * 0.7], [cx, 0.05, 0], 0, { tile: 3 });
  }
  const grp = kit.build({ name: 'bridge' });
  for (const x of archObjs) grp.add(x);
  if (gap) {
    // rubble in the chasm
    for (let i = 0; i < 12; i++) {
      const rb = rock(0.6 + rng.float() * 1.2, i + 3, { kind: 'rock' });
      rb.object.position.set(g0 + rng.float() * (g1 - g0), -depth + 1, (rng.float() - 0.5) * width);
      grp.add(rb.object);
    }
  }
  return {
    object: grp,
    colliders,
    anchors: { start: [-length / 2, 0, 0], end: [length / 2, 0, 0], gapStart: [g0, 0, 0], gapEnd: [g1, 0, 0] },
  };
}

/** a frozen waterfall: fluted ice curtain, icicles, a bulging base and the dark cliff behind. Faces +z. */
export function frozenWaterfall(width = 14, height = 22, o: { seed?: number } = {}): Built {
  const rng = new Rng(hashSeed('falls', o.seed ?? 1));
  const noise = noise2(hashSeed('falls', o.seed ?? 1) % 997);
  const kit = new MeshKit();
  const ice = mat('ice', { key: 'falls', rgb: [0.9, 0.97, 1.08] });
  const rockM = stoneMat('rough');
  const colliders: ColliderDesc[] = [];
  // cliff behind
  kit.box(rockM, [width + 14, height + 6, 6], [0, height / 2, -3.4], 0, { tile: 4 });
  for (const s of [-1, 1]) kit.box(rockM, [7, height + 10, 9], [s * (width / 2 + 5.2), (height + 10) / 2, -0.5], 0, { tile: 4 });
  // curtain
  const sx = 40;
  const sy = 64;
  const geo = new THREE.PlaneGeometry(width, height, sx, sy);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + height / 2; // 0 at the bottom
    const t = y / height;
    const flutes = Math.sin(x * 2.6 + noise(x * 0.3, y * 0.12) * 3) * 0.3 + Math.sin(x * 5.2 + y * 0.2) * 0.12;
    const bulge = Math.pow(1 - t, 2.4) * 3.2 + noise(x * 0.5, y * 0.25) * 0.5 + 0.8;
    const edge = 1 - Math.pow(Math.abs(x) / (width / 2), 3);
    pos.setZ(i, (flutes + bulge) * (0.6 + 0.4 * edge));
    pos.setY(i, y);
  }
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const curtain = bakeFaceBoxUV(geo, 2.5, 0, 0);
  kit.add(ice, curtain);
  // icicles on the lip and in the folds
  for (let i = 0; i < 46; i++) {
    const x = (rng.float() - 0.5) * width * 0.96;
    const y = height * (0.55 + rng.float() * 0.45);
    const len = 1.0 + rng.float() * 4.5 * (y / height);
    const r = 0.12 + rng.float() * 0.22;
    kit.add(ice, new THREE.ConeGeometry(r, len, 6), xf(x, y - len / 2, 1.0 + (1 - y / height) * 2.2 + rng.float() * 0.6, 0, 1, -1, 1, 0.08 * (rng.float() - 0.5), 0), { tile: 1.5 });
  }
  // frozen pool / mound at the base
  const mound = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  kit.add(ice, mound, xf(0, -0.1, 3.0, 0, width * 0.6, 1.8, 5.5), { tile: 3 });
  for (let i = 0; i < 10; i++) {
    const a = rng.float() * Math.PI;
    const s = 0.8 + rng.float() * 2.2;
    kit.add(ice, new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), xf(Math.cos(a) * width * 0.45, 0, 2 + Math.sin(a) * 6, a, s * 1.5, s * 0.6, s), { tile: 2 });
  }
  colliders.push({ kind: 'box', center: [0, height / 2, -0.3], half: [width / 2, height / 2, 1.6], opts: { material: 'ice', walkable: false, tag: 'falls' } });
  colliders.push({ kind: 'box', center: [0, 0.8, 3.4], half: [width * 0.5, 0.8, 4.2], opts: { material: 'ice', tag: 'falls_base' } });
  for (const s of [-1, 1]) colliders.push({ kind: 'box', center: [s * (width / 2 + 5.2), (height + 10) / 2, -0.5], half: [3.5, (height + 10) / 2, 4.5], opts: { material: 'stone', walkable: false, tag: 'falls_cliff' } });
  colliders.push({ kind: 'box', center: [0, height / 2, -3.4], half: [width / 2 + 7, (height + 6) / 2, 3], opts: { material: 'stone', walkable: false, tag: 'falls_cliff' } });
  void plain;
  return { object: kit.build({ name: 'frozen_waterfall' }), colliders };
}
