/** Stone fortifications: walls, towers, stairs, gates, and the Helm's Deep complex. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { limbGeo, latheGeo, xf } from './geom';
import { MeshKit } from './util';
import type { PathPoint } from './util';
import { Path } from './path';
import type { Built, ColliderDesc } from './colliders';
import { adoptColliderMeshes, mergedColliderMesh, stairSteps, stoneMat, wallPrism, archRing, type V3 } from './arch_common';
import { brazier, ladder, ringColliders, torch } from './props';

export type StoneKind = 'blocks' | 'light' | 'dark' | 'mossy' | 'white' | 'black' | 'rough';

export interface WallOpts {
  crenellated?: boolean;
  walkway?: boolean;
  /** which side is the outside (battlements) relative to the travel direction (default 'right') */
  outer?: 'left' | 'right';
  material?: StoneKind;
  /** bury depth below the path y (default 1.5) */
  sink?: number;
  /** buttress spacing on the inside, 0 = none */
  buttress?: number;
  /** curve the path (Catmull-Rom). default false (sharp corners) */
  smooth?: boolean;
  seed?: number;
  /** arrow slits in the parapet (default true when crenellated) */
  slits?: boolean;
  /** torch / brazier anchor spacing along the top (m); 0 = none (default 14) */
  anchorEvery?: number;
}

export interface WallAnchor {
  /** on the walkway, centred */
  pos: V3;
  /** outward unit normal (XZ) */
  out: V3;
  /** distance along the wall */
  s: number;
}

export interface WallResult extends Built {
  path: Path;
  anchors: WallAnchor[];
  /** walkway surface height per path vertex is the path y + height */
  topY: number;
}

/** crenellated stone wall following a path (world coordinates, object at the origin) */
export function stoneWall(points: PathPoint[], height: number, thickness: number, o: WallOpts = {}): WallResult {
  const smooth = o.smooth ?? false;
  const path = new Path(points, { smooth, step: smooth ? 2.5 : 1e9 });
  const rng = new Rng(hashSeed('wall', o.seed ?? 1, height, thickness, points.length));
  const kit = new MeshKit();
  const stone = stoneMat(o.material ?? 'blocks');
  const trim = stoneMat(o.material === 'white' ? 'white' : o.material === 'black' ? 'black' : 'light');
  const sink = o.sink ?? 1.5;
  const colliders: ColliderDesc[] = [];
  const crenel = o.crenellated ?? true;
  const walkway = o.walkway ?? true;
  const outerSign = (o.outer ?? 'right') === 'right' ? 1 : -1;
  const pts = path.pts;
  const parapetH = 1.1;
  const pt = Math.min(0.55, thickness * 0.3);
  const mw = 1.15;
  const gap = 0.8;
  const anchors: WallAnchor[] = [];
  const anchorEvery = o.anchorEvery ?? 14;
  let nextAnchor = anchorEvery / 2;
  let travelled = 0;
  const mat3 = new THREE.Matrix4();
  void mat3;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const ux = dx / l;
    const uz = dz / l;
    // right-hand normal (-dz, dx)
    const nx = -uz * outerSign;
    const nz = ux * outerSign;
    const yaw = Math.atan2(-dz, dx);
    const ext = i === 0 || i === pts.length - 2 ? 0 : thickness * 0.5;
    const body = wallPrism(a, b, height, thickness, sink, 3.0, ext);
    kit.add(stone, body);
    // plinth steps (batter)
    const p1 = wallPrism(a, b, Math.min(3, height * 0.28), thickness + 0.8, sink, 3.0, ext);
    kit.add(stone, p1);
    const p2 = wallPrism(a, b, Math.min(1.4, height * 0.12), thickness + 1.6, sink, 3.0, ext);
    kit.add(stone, p2);
    // string course
    const sc = wallPrism(new THREE.Vector3(a.x, a.y + height * 0.62, a.z), new THREE.Vector3(b.x, b.y + height * 0.62, b.z), 0.4, thickness + 0.3, 0, 2.0, ext);
    kit.add(trim, sc);
    const cornice = wallPrism(new THREE.Vector3(a.x, a.y + height - 0.55, a.z), new THREE.Vector3(b.x, b.y + height - 0.55, b.z), 0.6, thickness + 0.5, 0, 2.0, ext);
    kit.add(trim, cornice);
    // wall body collider
    const slope = Math.abs(b.y - a.y);
    if (slope < 0.25) {
      colliders.push({
        kind: 'box',
        center: [(a.x + b.x) / 2, (a.y + b.y) / 2 + (height - sink) / 2, (a.z + b.z) / 2],
        half: [l / 2 + ext, (height + sink) / 2, thickness / 2],
        yaw,
        opts: { material: 'stone', tag: 'wall', walkable: walkway },
      });
    } else {
      colliders.push({ kind: 'mesh', mesh: mergedColliderMesh([wallPrism(a, b, height, thickness, sink, 3.0, ext)], 'wall_collider'), opts: { material: 'stone', tag: 'wall', walkable: walkway } });
    }
    // parapet on the outer side
    const ymid = (a.y + b.y) / 2 + height;
    const po = thickness / 2 - pt / 2;
    const cxp = (a.x + b.x) / 2 + nx * po;
    const czp = (a.z + b.z) / 2 + nz * po;
    if (crenel) {
      kit.box(stone, [l + ext * 2, parapetH, pt], [cxp, ymid + parapetH / 2, czp], yaw, { tile: 3 }, [0, Math.atan2(b.y - a.y, l)]);
      colliders.push({ kind: 'box', center: [cxp, ymid + parapetH / 2, czp], half: [l / 2 + ext, parapetH / 2, pt / 2], yaw, opts: { material: 'stone', walkable: false, tag: 'parapet' } });
      const n = Math.floor(l / (mw + gap));
      const start = (l - (n * (mw + gap) - gap)) / 2;
      for (let k = 0; k < n; k++) {
        const s = start + k * (mw + gap) + mw / 2;
        const t = s / l;
        const mxp = a.x + dx * t + nx * po;
        const mzp = a.z + dz * t + nz * po;
        const my = a.y + (b.y - a.y) * t + height + parapetH + 0.45;
        const mh = 0.95 + rng.float() * 0.06;
        kit.box(stone, [mw, mh, pt + 0.06], [mxp, my + (mh - 0.9) / 2 - 0.0, mzp], yaw, { tile: 2 });
        kit.box(trim, [mw + 0.1, 0.12, pt + 0.14], [mxp, my + mh / 2 + 0.05, mzp], yaw, { tile: 2 });
        colliders.push({ kind: 'box', center: [mxp, my, mzp], half: [mw / 2, mh / 2, pt / 2], yaw, opts: { material: 'stone', walkable: false, tag: 'merlon' } });
      }
    } else {
      kit.box(stone, [l + ext * 2, parapetH, pt], [cxp, ymid + parapetH / 2, czp], yaw, { tile: 3 });
      colliders.push({ kind: 'box', center: [cxp, ymid + parapetH / 2, czp], half: [l / 2 + ext, parapetH / 2, pt / 2], yaw, opts: { material: 'stone', walkable: false, tag: 'parapet' } });
    }
    // low inner coping
    kit.box(trim, [l + ext * 2, 0.35, 0.34], [(a.x + b.x) / 2 - nx * (thickness / 2 - 0.17), ymid + 0.175, (a.z + b.z) / 2 - nz * (thickness / 2 - 0.17)], yaw, { tile: 2 });
    // buttresses on the inner face
    if (o.buttress && o.buttress > 0) {
      for (let s = o.buttress / 2; s < l; s += o.buttress) {
        const t = s / l;
        const by = a.y + (b.y - a.y) * t;
        const bx = a.x + dx * t - nx * (thickness / 2 + 0.9);
        const bz = a.z + dz * t - nz * (thickness / 2 + 0.9);
        kit.box(stone, [1.8, height * 0.55, 1.8], [bx, by + height * 0.27 - sink / 2, bz], yaw, { tile: 3 });
        kit.box(stone, [1.5, height * 0.3, 1.4], [bx + nx * 0.35, by + height * 0.55 + height * 0.15 - 0.1, bz + nz * 0.35], yaw, { tile: 3 });
        colliders.push({ kind: 'box', center: [bx, by + height * 0.27 - sink / 2, bz], half: [0.9, height * 0.275, 0.9], yaw, opts: { material: 'stone', walkable: false, tag: 'buttress' } });
      }
    }
    // torch anchors
    while (anchorEvery > 0 && travelled + l >= nextAnchor) {
      const s = nextAnchor - travelled;
      const t = s / l;
      anchors.push({
        pos: [a.x + dx * t, a.y + (b.y - a.y) * t + height, a.z + dz * t],
        out: [nx, 0, nz],
        s: travelled + s,
      });
      nextAnchor += anchorEvery;
    }
    travelled += l;
  }
  const g = kit.build({ name: 'stone_wall' });
  adoptColliderMeshes(g, colliders);
  return { object: g, colliders, path, anchors, topY: height };
}

export interface StairsOpts {
  riser?: number;
  material?: StoneKind;
  /** cheek walls on both sides (default true) */
  cheeks?: boolean;
  /** extra invisible smooth ramp collider just above the nosing line (for sliding) */
  ramp?: boolean;
  /** torch-height balustrade (default false) */
  rails?: boolean;
}

/** broad stone stairs from `from` (bottom) to `to` (top). World coordinates (object at the origin). */
export function stairs(from: V3, to: V3, width: number, o: StairsOpts = {}): Built & { steps: number } {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const run = Math.hypot(dx, dz);
  const rise = to[1] - from[1];
  const riser = o.riser ?? 0.18;
  const n = Math.max(1, Math.round(rise / riser));
  const h = rise / n;
  const tread = run / n;
  const yaw = Math.atan2(dx, dz);
  const fx = dx / run;
  const fz = dz / run;
  const kit = new MeshKit();
  const stone = stoneMat(o.material ?? 'light');
  const dark = stoneMat(o.material ?? 'dark');
  const topGeos: THREE.BufferGeometry[] = [];
  const colliders: ColliderDesc[] = [];
  for (let i = 0; i < n; i++) {
    const hh = (i + 1) * h;
    const cx = from[0] + fx * (i + 0.5) * tread;
    const cz = from[2] + fz * (i + 0.5) * tread;
    // each tread is a slab reaching down to the first step so no gaps show on the sides
    kit.box(stone, [width, h, tread + 0.04], [cx, from[1] + hh - h / 2, cz], yaw, { tile: 2.5 });
    const g = new THREE.BoxGeometry(width, hh, tread);
    g.rotateY(yaw);
    g.translate(cx, from[1] + hh / 2, cz);
    topGeos.push(g);
  }
  // solid core below the steps so the underside is never visible
  const coreLen = run + 0.2;
  const core = new THREE.BoxGeometry(width - 0.1, rise, coreLen);
  core.rotateX(Math.atan2(rise, run) * 0);
  void core;
  if (o.cheeks !== false) {
    for (const side of [-1, 1]) {
      // side wall: trapezoid profile along the run
      const sh = new THREE.Shape();
      sh.moveTo(0, -1.2);
      sh.lineTo(run + 0.4, -1.2);
      sh.lineTo(run + 0.4, rise + 0.9);
      sh.lineTo(-0.4, 0.9);
      sh.closePath();
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: false });
      // shape x = along run, y = height; extrude along z = lateral
      const m = new THREE.Matrix4();
      const rot = new THREE.Matrix4().makeRotationY(yaw - Math.PI / 2);
      m.copy(rot);
      m.setPosition(from[0] + (-fz) * 0 + (fz * -1) * 0, from[1], from[2]);
      eg.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, side * (width / 2 + (side > 0 ? 0 : 0.6) - (side > 0 ? 0 : 0))));
      eg.applyMatrix4(rot);
      eg.applyMatrix4(new THREE.Matrix4().makeTranslation(from[0], from[1], from[2]));
      kit.add(dark, eg, null, { tile: 3 });
      colliders.push({ kind: 'mesh', mesh: mergedColliderMesh([eg.clone()], 'cheek'), opts: { material: 'stone', walkable: false, tag: 'cheek' } });
    }
  }
  const g = kit.build({ name: 'stairs' });
  const stepMesh = mergedColliderMesh(topGeos, 'steps_collider');
  g.add(stepMesh);
  colliders.push({ kind: 'mesh', mesh: stepMesh, opts: { material: 'stone', tag: 'stairs' } });
  if (o.ramp) {
    const rg = new THREE.BufferGeometry();
    const hw = width / 2;
    const px = -fz;
    const pz = fx;
    const y0 = from[1] + h * 1.0 + 0.02;
    const y1 = to[1] + 0.02;
    const v = [
      from[0] + px * hw, y0, from[2] + pz * hw,
      from[0] - px * hw, y0, from[2] - pz * hw,
      to[0] + px * hw, y1, to[2] + pz * hw,
      to[0] - px * hw, y1, to[2] - pz * hw,
    ];
    rg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    rg.setIndex([0, 2, 1, 1, 2, 3, 0, 1, 2, 1, 3, 2]);
    const rm = mergedColliderMesh([rg], 'ramp_collider');
    g.add(rm);
    colliders.push({ kind: 'mesh', mesh: rm, opts: { material: 'stone', tag: 'stairs_ramp' } });
  }
  adoptColliderMeshes(g, colliders);
  return { object: g, colliders, steps: n };
}

export interface TowerOpts {
  /** 'round' (default) or 'square' */
  shape?: 'round' | 'square';
  material?: StoneKind;
  crenellated?: boolean;
  /** conical roof of this height (0 = flat battlements) */
  roof?: number;
  roofColor?: 'slate' | 'copper';
  /** arrow slit rows */
  slits?: number;
  /** door arch at the base facing +z */
  door?: boolean;
  seed?: number;
  /** collider: solid body walkable on top (default true) */
  solid?: boolean;
}

/** stone tower, origin at the centre of the base. Solid collider; top is walkable unless roofed. */
export function tower(radius: number, height: number, o: TowerOpts = {}): Built {
  const rng = new Rng(hashSeed('tower', o.seed ?? 1, radius, height));
  const kit = new MeshKit();
  const stone = stoneMat(o.material ?? 'blocks');
  const trim = stoneMat(o.material === 'white' ? 'white' : 'light');
  const colliders: ColliderDesc[] = [];
  const sq = o.shape === 'square';
  const seg = 28;
  if (sq) {
    const s = radius * 2;
    kit.box(stone, [s, height + 1.5, s], [0, height / 2 - 0.75, 0], 0, { tile: 3 });
    kit.box(stone, [s + 0.9, 3, s + 0.9], [0, 0.75, 0], 0, { tile: 3 });
    kit.box(trim, [s + 0.5, 0.7, s + 0.5], [0, height - 1.2, 0], 0, { tile: 2 });
    colliders.push({ kind: 'box', center: [0, height / 2, 0], half: [radius, height / 2, radius], opts: { material: 'stone', tag: 'tower' } });
  } else {
    const body = latheGeo([[0, -1.5], [radius + 0.7, -1.5], [radius + 0.7, 0.8], [radius + 0.25, 1.4], [radius, 2.2], [radius, height - 1.6], [radius + 0.55, height - 1.2], [radius + 0.55, height - 0.4], [radius + 0.35, height], [radius, height], [0, height]], seg, 3.0);
    kit.add(stone, body);
    colliders.push({ kind: 'cyl', x: 0, z: 0, r: radius * 0.97, y0: -1.5, y1: height, opts: { material: 'stone', tag: 'tower' } });
  }
  // crenellations on top
  if (o.crenellated ?? !o.roof) {
    const n = sq ? Math.max(6, Math.round(radius * 2 * 4 / 1.9)) : Math.max(8, Math.round((Math.PI * 2 * radius) / 1.9));
    for (let i = 0; i < n; i++) {
      if (sq) {
        const per = radius * 8;
        const d = (i / n) * per;
        const side = Math.floor(d / (radius * 2));
        const t = (d % (radius * 2)) - radius;
        const pos: [number, number] = side === 0 ? [t, radius] : side === 1 ? [radius, -t] : side === 2 ? [-t, -radius] : [-radius, t];
        kit.box(stone, [1.2, 1.1, 0.6], [pos[0], height + 0.55, pos[1]], side % 2 ? Math.PI / 2 : 0, { tile: 2 });
        colliders.push({ kind: 'box', center: [pos[0], height + 0.55, pos[1]], half: [side % 2 ? 0.3 : 0.6, 0.55, side % 2 ? 0.6 : 0.3], opts: { walkable: false, material: 'stone', tag: 'merlon' } });
      } else {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * (radius + 0.2);
        const z = Math.sin(a) * (radius + 0.2);
        kit.box(stone, [0.7, 1.1, 1.2], [x, height + 0.55, z], -a, { tile: 2 });
        colliders.push({ kind: 'box', center: [x, height + 0.55, z], half: [0.35, 0.55, 0.6], yaw: -a, opts: { walkable: false, material: 'stone', tag: 'merlon' } });
      }
    }
  }
  if (o.roof && o.roof > 0) {
    const roofMat = o.roofColor === 'copper' ? mat('metal_dark', { key: 'copper', rgb: [0.55, 0.9, 0.8] }) : mat('shingles', { key: 'slate', rgb: [0.55, 0.58, 0.64] });
    const rg = latheGeo([[radius + 0.9, height - 0.1], [radius * 0.55, height + o.roof * 0.55], [radius * 0.22, height + o.roof * 0.85], [0.06, height + o.roof]], seg, 1.0);
    kit.add(roofMat, rg);
    kit.add(trim, limbGeo([0, height + o.roof, 0], [0, height + o.roof + 1.8, 0], 0.07, 0.03, 6, 0.5));
  }
  // arrow slits
  const slitRows = o.slits ?? Math.floor(height / 8);
  for (let r = 0; r < slitRows; r++) {
    const y = 4 + (r + 0.5) * ((height - 7) / Math.max(1, slitRows));
    const n = Math.max(2, Math.round(radius / 1.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.7 + rng.float() * 0.2;
      if (sq) {
        const side = i % 4;
        const t = (rng.float() - 0.5) * radius * 1.2;
        const pos: [number, number, number] = side === 0 ? [t, y, radius + 0.01] : side === 1 ? [radius + 0.01, y, t] : side === 2 ? [t, y, -radius - 0.01] : [-radius - 0.01, y, t];
        kit.box(plain(0x050403, { roughness: 1, key: 'slit' }), side % 2 ? [0.04, 1.0, 0.22] : [0.22, 1.0, 0.04], pos, 0, undefined);
      } else {
        kit.box(plain(0x050403, { roughness: 1, key: 'slit' }), [0.05, 1.0, 0.22], [Math.cos(a) * (radius + 0.015), y, Math.sin(a) * (radius + 0.015)], -a, undefined);
      }
    }
  }
  if (o.door) {
    const iron = mat('metal_dark', { key: 'gate' });
    const wood = mat('old_wood', { key: 'gate' });
    const z = radius + (sq ? 0.02 : 0.0);
    archRing(kit, trim, 1.8, 0.35, 0.6, 2.2, 1.5);
    kit.box(wood, [1.9, 2.5, 0.2], [0, 1.25 + 0.0, z - 0.05], 0, { tile: 1.2 });
    kit.box(iron, [1.9, 0.12, 0.24], [0, 0.7, z - 0.03], 0, { tile: 1 });
    kit.box(iron, [1.9, 0.12, 0.24], [0, 1.7, z - 0.03], 0, { tile: 1 });
  }
  return { object: kit.build({ name: 'tower' }), colliders };
}

export interface GateOpts {
  width?: number;
  height?: number;
  /** wall thickness the gatehouse sits in */
  depth?: number;
  kind?: 'wood' | 'iron';
  material?: StoneKind;
  /** portcullis above the door */
  portcullis?: boolean;
  /** 0 closed .. 1 open */
  open?: number;
}

export interface GateResult extends Built {
  left: THREE.Group;
  right: THREE.Group;
  /** rotate the door leaves open (0..1). Colliders tagged 'gate_left' / 'gate_right' are static: remove them when opening. */
  setOpen(t: number): void;
}

/** gatehouse: stone portal with an arch, double doors (iron-banded timber or plated iron). Faces +z. */
export function gate(o: GateOpts = {}): GateResult {
  const w = o.width ?? 4.4;
  const h = o.height ?? 5.2;
  const dep = o.depth ?? 3.2;
  const kit = new MeshKit();
  const stone = stoneMat(o.material ?? 'blocks');
  const trim = stoneMat('light');
  const iron = mat('metal_dark', { key: 'gate', rgb: [0.85, 0.82, 0.8] });
  const wood = mat('old_wood', { key: 'gate', rgb: [0.9, 0.82, 0.74] });
  const colliders: ColliderDesc[] = [];
  const side = 3.2;
  // piers either side
  for (const s of [-1, 1]) {
    kit.box(stone, [side, h + 2.0, dep], [s * (w / 2 + side / 2), (h + 2.0) / 2 - 0.0, 0], 0, { tile: 3 });
    colliders.push({ kind: 'box', center: [s * (w / 2 + side / 2), (h + 2.0) / 2, 0], half: [side / 2, (h + 2.0) / 2, dep / 2], opts: { material: 'stone', tag: 'gate_pier' } });
  }
  const extras: THREE.Object3D[] = [];
  // lintel over the opening (flat) with an arch ring in front
  kit.box(stone, [w + side * 2, 2.0, dep], [0, h + 1.0, 0], 0, { tile: 3 });
  colliders.push({ kind: 'box', center: [0, h + 1.0, 0], half: [w / 2 + side, 1.0, dep / 2], opts: { material: 'stone', tag: 'gate_lintel' } });
  // arch moulding on both faces
  for (const sz of [-1, 1]) {
    const k2 = new MeshKit();
    archRing(k2, trim, w, 0.5, 0.35, h - w / 2, 2.0);
    const grp = k2.build({ name: 'arch' });
    grp.position.z = sz * (dep / 2 + 0.1);
    kit.box(trim, [w + 1.2, 0.5, 0.4], [0, h + 1.9, sz * (dep / 2 + 0.1)], 0, { tile: 2 });
    extras.push(grp);
  }
  const g = kit.build({ name: 'gate' });
  for (const ex of extras) g.add(ex);
  // door leaves (pivot at the outer hinge)
  const makeLeaf = (s: number): THREE.Group => {
    const k = new MeshKit();
    const lw = w / 2 - 0.04;
    if ((o.kind ?? 'wood') === 'iron') {
      k.box(mat('metal_dark', { key: 'plate', rgb: [0.55, 0.5, 0.48] }), [lw, h - 0.05, 0.3], [-s * lw / 2, h / 2, 0], 0, { tile: 1.5 });
      for (let y = 0.4; y < h; y += 0.9) k.box(iron, [lw + 0.05, 0.18, 0.4], [-s * lw / 2, y, 0], 0, { tile: 1 });
    } else {
      k.box(wood, [lw, h - 0.05, 0.3], [-s * lw / 2, h / 2, 0], 0, { tile: 1.2, swap: true });
      for (const y of [0.5, h * 0.5, h - 0.5]) k.box(iron, [lw, 0.16, 0.34], [-s * lw / 2, y, 0], 0, { tile: 1 });
      for (let i = 0; i < 6; i++) for (const y of [0.5, h * 0.5, h - 0.5]) k.add(iron, new THREE.SphereGeometry(0.05, 6, 4), xf(-s * (0.2 + i * (lw - 0.3) / 5), y, 0.18));
      k.add(iron, new THREE.TorusGeometry(0.2, 0.03, 6, 14), xf(-s * 0.35, h * 0.45, 0.2, 0));
    }
    const grp = k.build({ name: 'leaf' });
    const pivot = new THREE.Group();
    pivot.position.set(s * w / 2, 0, 0);
    pivot.add(grp);
    return pivot;
  };
  const left = makeLeaf(-1);
  const right = makeLeaf(1);
  left.name = 'gate_left';
  right.name = 'gate_right';
  g.add(left, right);
  colliders.push({ kind: 'box', center: [-w / 4, h / 2, 0], half: [w / 4, h / 2, 0.15], opts: { material: 'wood', tag: 'gate_left' } });
  colliders.push({ kind: 'box', center: [w / 4, h / 2, 0], half: [w / 4, h / 2, 0.15], opts: { material: 'wood', tag: 'gate_right' } });
  if (o.portcullis) {
    for (let x = -w / 2 + 0.3; x < w / 2; x += 0.45) g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.08, h * 0.45, 0.08), iron), { position: new THREE.Vector3(x, h * 0.78, dep / 2 - 0.2) }));
  }
  const setOpen = (t: number) => {
    const a = Math.max(0, Math.min(1, t)) * 1.75;
    left.rotation.y = -a;
    right.rotation.y = a;
  };
  setOpen(o.open ?? 0);
  return { object: g, colliders, left, right, setOpen };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Helm's Deep
// ───────────────────────────────────────────────────────────────────────────────────────────

export interface HelmsDeepOpts {
  /** wall height (default 14) */
  wallHeight?: number;
  seed?: number;
}

export interface HelmsDeepResult extends Built {
  anchors: {
    /** walkway points along the top, from the left end to the Hornburg */
    walkway: V3[];
    /** where siege ladders lean on the outer face: position of the top, outward normal */
    ladders: { top: V3; out: V3 }[];
    /** brazier / torch spots on the wall top */
    fires: WallAnchor[];
    culvert: V3;
    /** shield stair: top (on the wall) and bottom */
    stairTop: V3;
    stairBottom: V3;
    gate: V3;
    hornburgDoor: V3;
    causewayStart: V3;
    /** the breach centre */
    breach: V3;
  };
  /** the intact middle section of the wall with the culvert, and its broken replacement */
  breach: { intact: THREE.Object3D; broken: THREE.Object3D; intactColliders: ColliderDesc[]; brokenColliders: ColliderDesc[] };
  gateLeaf: GateResult;
}

/**
 * The Deeping Wall and the Hornburg. Local frame: the wall runs along x, the enemy (the Deep) is at +z,
 * the fortress inside at -z. y = 0 is the ground at the foot of the wall. Object at the origin.
 *
 *   breach.intact  visible at the start, breach.broken after the culvert explodes
 *   (add intactColliders first, swap to brokenColliders when it blows)
 */
export function helmsDeep(o: HelmsDeepOpts = {}): HelmsDeepResult {
  const H = o.wallHeight ?? 14;
  const T = 5.0;
  const rng = new Rng(hashSeed('helms', o.seed ?? 1));
  const root = new THREE.Group();
  root.name = 'helms_deep';
  const colliders: ColliderDesc[] = [];
  // outer is toward +z: for a wall travelling +x the right-hand side is -z, so travel toward -x
  const leftPts: PathPoint[] = [[-4, 0, -6], [-14, 0, -4], [-26, 0, -1], [-42, 0, 1], [-60, 0, 3]];
  const midPts: PathPoint[] = [[-4, 0, -6], [14, 0, -7]];
  const rightPts: PathPoint[] = [[14, 0, -7], [32, 0, -8], [50, 0, -10], [62, 0, -12]];
  // travel along -x (left → ...): outer on the 'right' side means +z? verify: travel (-1,0): right-hand normal (-dz,dx) = (0,-1)
  // so travel along +x puts the right-hand normal at -z. Use 'left' as outer for +x travel.
  const wallA = stoneWall([...leftPts].reverse(), H, T, { outer: 'left', smooth: true, buttress: 9, seed: 1, material: 'blocks', anchorEvery: 15 });
  const wallC = stoneWall(rightPts, H, T, { outer: 'left', smooth: true, buttress: 9, seed: 3, material: 'blocks', anchorEvery: 15 });
  const wallB = stoneWall(midPts, H, T, { outer: 'left', buttress: 9, seed: 2, material: 'blocks', anchorEvery: 0 });
  root.add(wallA.object, wallC.object);
  colliders.push(...wallA.colliders, ...wallC.colliders);

  // intact middle (with the culvert) vs. broken middle
  const intact = new THREE.Group();
  intact.name = 'wall_intact';
  intact.add(wallB.object);
  const culvertK = new MeshKit();
  const dark = stoneMat('dark');
  const ironM = mat('metal_dark', { key: 'gate' });
  const cx = 5;
  const cz = -6.5 + (1 / 18) * 0; // on the outer face of the mid wall
  // culvert: arched opening at the base of the outer face
  archRing(culvertK, stoneMat('light'), 2.8, 0.55, 0.5, 2.4, 1.5);
  const cg = culvertK.build({ name: 'culvert_arch' });
  cg.position.set(cx, 0, -3.0);
  intact.add(cg);
  const darkHole = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.8), plain(0x020202, { roughness: 1, key: 'culvert' }));
  darkHole.position.set(cx, 1.9, -3.08);
  intact.add(darkHole);
  for (let x = -1.2; x <= 1.21; x += 0.4) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 5), ironM);
    bar.position.set(cx + x, 1.8, -3.03);
    intact.add(bar);
  }
  for (const y of [0.8, 1.9, 3.0]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.9, 5), ironM);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(cx, y, -3.03);
    intact.add(bar);
  }
  root.add(intact);
  const intactColliders: ColliderDesc[] = [...wallB.colliders];

  // broken section: two jagged wall stubs with a gap and a rubble ramp
  const broken = new THREE.Group();
  broken.name = 'wall_broken';
  const bk = new MeshKit();
  const stone = stoneMat('blocks');
  const brokenColliders: ColliderDesc[] = [];
  const gapX0 = -1;
  const gapX1 = 11;
  for (const [x0, x1, sign] of [[-4, gapX0, -1], [gapX1, 14, 1]] as [number, number, number][]) {
    const len = x1 - x0;
    for (let i = 0; i < 6; i++) {
      const t0 = i / 6;
      const bx = x0 + len * (t0 + 1 / 12);
      // jagged heights falling toward the gap
      const k = sign < 0 ? t0 : 1 - t0 - 1 / 6;
      const bh = H * (1 - 0.8 * Math.pow(Math.max(0, k), 1.2)) * (0.85 + rng.float() * 0.3);
      bk.box(stone, [len / 6 + 0.05, bh + 1.5, T], [bx, bh / 2 - 0.75, -6.5 - (bx - 5) * 0.0], 0, { tile: 3 });
      brokenColliders.push({ kind: 'box', center: [bx, bh / 2 - 0.75, -6.5], half: [len / 12 + 0.03, bh / 2 + 0.75, T / 2], opts: { material: 'stone', tag: 'wall_broken' } });
    }
  }
  // rubble heaps
  for (let i = 0; i < 26; i++) {
    const s = 0.7 + rng.float() * 1.8;
    const x = gapX0 + 0.5 + rng.float() * (gapX1 - gapX0 - 1);
    const z = -6.5 + (rng.float() - 0.5) * 8;
    bk.box(stone, [s, s * 0.8, s * 0.9], [x, s * 0.35, z], rng.float() * 3, { tile: 2 }, [rng.float() * 0.4, rng.float() * 0.4]);
  }
  brokenColliders.push({ kind: 'box', center: [5, 0.8, -6.5], half: [6, 0.8, 4.5], opts: { material: 'stone', tag: 'rubble' } });
  broken.add(bk.build({ name: 'rubble' }));
  broken.visible = false;
  root.add(broken);

  // projecting towers on the outer face
  const towers: [number, number, number][] = [[-38, 4.5, 6], [22, -4.5 - 7.5, 6], [-14, 0, 5]];
  const towerSpec: { x: number; z: number; size: number; hgt: number }[] = [
    { x: -42, z: 2.5, size: 4.6, hgt: H + 5 },
    { x: -18, z: -2.5, size: 4.2, hgt: H + 3 },
    { x: 30, z: -10, size: 4.6, hgt: H + 5 },
  ];
  void towers;
  for (const t of towerSpec) {
    const tw = tower(t.size, t.hgt, { shape: 'square', slits: 2, seed: t.x, crenellated: true });
    tw.object.position.set(t.x, 0, t.z + 3.8);
    root.add(tw.object);
    for (const c of tw.colliders) {
      if (c.kind === 'box') colliders.push({ ...c, center: [c.center[0] + t.x, c.center[1], c.center[2] + t.z + 3.8] });
    }
    const br = brazier({ scale: 1.1 });
    br.object.position.set(t.x + t.size * 0.55, t.hgt, t.z + 3.8 - t.size * 0.55);
    root.add(br.object);
  }

  // stair: from the wall top down into the fortress court (inside = -z), parallel to the wall then away
  const stairTop: V3 = [-30, H, -5.5];
  const stairBottom: V3 = [-30, 0, -5.5 - 62];
  const st = stairs([stairBottom[0], stairBottom[1], stairBottom[2]], [stairTop[0], stairTop[1], stairTop[2] - 3.0], 9.0, { ramp: true, riser: 0.18, material: 'light' });
  root.add(st.object);
  colliders.push(...st.colliders);

  // courtyard paving behind the wall
  const court = new THREE.Mesh(new THREE.PlaneGeometry(150, 80), mat('cobble', { key: 'court', rgb: [0.8, 0.8, 0.8] }));
  court.rotation.x = -Math.PI / 2;
  court.position.set(0, 0.04, -52);
  const cuv = court.geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 75, cuv.getY(i) * 40);
  court.receiveShadow = true;
  root.add(court);

  // Hornburg: keep with corner towers, causeway and gate
  const hx = 76;
  const hz = -14;
  const keepK = new MeshKit();
  const light = stoneMat('light');
  keepK.box(stone, [30, 30, 24], [hx, 15 - 0.5, hz], 0, { tile: 3 });
  keepK.box(light, [31, 1.2, 25], [hx, 24, hz], 0, { tile: 2 });
  keepK.box(stone, [14, 12, 12], [hx, 30 + 5.5, hz - 2], 0, { tile: 3 });
  keepK.box(light, [15, 1.2, 13], [hx, 36, hz - 2], 0, { tile: 2 });
  root.add(keepK.build({ name: 'hornburg_keep' }));
  colliders.push({ kind: 'box', center: [hx, 14.5, hz], half: [15, 15, 12], opts: { material: 'stone', tag: 'hornburg' } });
  colliders.push({ kind: 'box', center: [hx, 35.5, hz - 2], half: [7, 6, 6], opts: { material: 'stone', tag: 'hornburg_top' } });
  for (const [dx, dz] of [[-14, -11], [14, -11], [-14, 11], [14, 11]]) {
    const ct = tower(4.2, 40, { roof: 9, slits: 4, seed: dx * 3 + dz });
    ct.object.position.set(hx + dx, 0, hz + dz);
    root.add(ct.object);
    colliders.push({ kind: 'cyl', x: hx + dx, z: hz + dz, r: 4.1, y0: -1, y1: 40, opts: { material: 'stone', tag: 'hornburg_tower', walkable: false } });
  }
  // the keep top: battlements
  const topK = new MeshKit();
  for (let i = 0; i < 14; i++) {
    for (const sz of [-1, 1]) topK.box(stone, [1.3, 1.1, 0.7], [hx - 6.5 + i * 1.0, 36.7 + 0.0, hz - 2 + sz * 6.3], 0, { tile: 2 });
  }
  root.add(topK.build({ name: 'keep_top' }));

  // causeway: raised road from the court to the keep's door (door on the -z face)
  const doorX = hx;
  const doorZ = hz - 12;
  const cw = stairs([hx - 5, 0, doorZ - 36], [hx - 5, 6, doorZ - 8], 8, { riser: 0.2, material: 'light', cheeks: true });
  void cw;
  const ramp = new MeshKit();
  const roadMat = stoneMat('cobble');
  const roadLen = 40;
  ramp.box(roadMat, [8, 6.0, roadLen], [doorX, 3.0 - 0.2, doorZ - roadLen / 2 - 0.5], 0, { tile: 2.5 });
  for (const s of [-1, 1]) {
    ramp.box(stone, [0.7, 1.4, roadLen], [doorX + s * 4.0, 6.0 + 0.5, doorZ - roadLen / 2 - 0.5], 0, { tile: 3 });
  }
  root.add(ramp.build({ name: 'causeway' }));
  colliders.push({ kind: 'box', center: [doorX, 2.8, doorZ - roadLen / 2 - 0.5], half: [4, 3.0, roadLen / 2], opts: { material: 'stone', tag: 'causeway' } });
  for (const s of [-1, 1]) colliders.push({ kind: 'box', center: [doorX + s * 4.0, 6.5, doorZ - roadLen / 2 - 0.5], half: [0.35, 0.7, roadLen / 2], opts: { material: 'stone', walkable: false, tag: 'causeway_parapet' } });
  const hg = gate({ width: 5.4, height: 6.5, depth: 3.4, kind: 'wood' });
  hg.object.position.set(doorX, 6.0, doorZ + 0.3);
  hg.object.rotation.y = Math.PI;
  root.add(hg.object);
  for (const c of hg.colliders) {
    if (c.kind === 'box') colliders.push({ ...c, center: [doorX - c.center[0], 6.0 + c.center[1], doorZ + 0.3 - c.center[2]] });
  }

  // fires along the wall tops
  const fires = [...wallA.anchors, ...wallC.anchors];
  for (const f of fires) {
    const br = brazier({ scale: 0.9 });
    br.object.position.set(f.pos[0] + f.out[0] * 1.6, f.pos[1], f.pos[2] + f.out[2] * 1.6);
    root.add(br.object);
  }
  for (const x of [-52, -22, 26, 44]) {
    const tc = torch({ wall: true });
    tc.object.position.set(x, H * 0.5, 0);
    void tc;
  }

  // ladder spots along the outer face (tops, outward normals)
  const ladders: { top: V3; out: V3 }[] = [];
  const outerAt = (p: Path, s: number) => {
    const q = p.at(s);
    const tg = p.tangent(s);
    const nx = tg.z;
    const nz = -tg.x;
    return { q, nx: -nx, nz: -nz };
  };
  void outerAt;
  for (const w of [wallA, wallC]) {
    for (let s = 8; s < w.path.length - 6; s += 11) {
      const q = w.path.at(s);
      const tg = w.path.tangent(s);
      // wall travels +x so the outside (+z for the left wall) = left-hand normal (dz, -dx)... use (tg.z, -tg.x) then pick +z
      let nx = tg.z;
      let nz = -tg.x;
      if (nz < 0) { nx = -nx; nz = -nz; }
      ladders.push({ top: [q.x + nx * T / 2, q.y + H, q.z + nz * T / 2], out: [nx, 0, nz] });
    }
  }
  adoptColliderMeshes(root, colliders);
  const wlk: V3[] = [];
  for (const w of [wallA, wallB, wallC]) for (let s = 0; s <= w.path.length; s += 6) {
    const q = w.path.at(s);
    wlk.push([q.x, H, q.z]);
  }
  return {
    object: root,
    colliders,
    anchors: {
      walkway: wlk,
      ladders,
      fires,
      culvert: [cx, 0, -2.4],
      stairTop,
      stairBottom,
      gate: [doorX, 6.0, doorZ],
      hornburgDoor: [doorX, 6.0, doorZ],
      causewayStart: [doorX, 0, doorZ - roadLen - 0.5],
      breach: [5, 0, -6.5],
    },
    breach: { intact, broken, intactColliders, brokenColliders },
    gateLeaf: hg,
  };
}
void ladder;
void ringColliders;
