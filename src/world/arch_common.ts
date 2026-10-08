/** Shared helpers for the architecture builders (materials, wall-with-openings, stairs, arches, roofs). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './mats';
import { MeshKit, bakeBoxUV, type PieceUV } from './util';
import type { ColliderDesc } from './colliders';
import { colliderMesh } from './colliders';

export type V3 = [number, number, number];

/** stone looks used across the world */
export function stoneMat(kind: 'blocks' | 'light' | 'dark' | 'mossy' | 'white' | 'black' | 'dwarven' | 'marble' | 'rough' | 'cobble' = 'blocks'): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  switch (kind) {
    case 'light': return mat('stone_blocks', { key: 'light', rgb: [1.0, 0.98, 0.92] });
    case 'dark': return mat('stone_blocks', { key: 'dark', rgb: [0.62, 0.62, 0.64] });
    case 'mossy': return mat('stone_blocks', { key: 'mossy', rgb: [0.62, 0.78, 0.52] });
    case 'white': return mat('marble', { key: 'white', rgb: [1.05, 1.05, 1.02] });
    case 'black': return mat('cliff', { key: 'black', rgb: [0.3, 0.29, 0.3] });
    case 'dwarven': return mat('dwarven_stone');
    case 'marble': return mat('marble');
    case 'rough': return mat('rock');
    case 'cobble': return mat('cobble');
    default: return mat('stone_blocks', { key: 'base', rgb: [0.82, 0.8, 0.76] });
  }
}

export const wood = () => mat('wood_planks');
export const oldWood = () => mat('old_wood');
export const iron = () => mat('metal_dark');

/** a wall opening in wall-local coordinates: x along the wall from its start, y from the base */
export interface Opening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Solid wall of boxes with rectangular openings. The wall runs along +x from (0,0,0) at its base with
 * the given thickness centred on z = 0. Returns the colliders (boxes) for the solid parts.
 */
export function wallWithOpenings(
  kit: MeshKit, material: THREE.Material, length: number, height: number, thick: number, openings: Opening[], tile: number | PieceUV,
  place: { x: number; y: number; z: number; yaw: number },
  collider?: { opts?: ColliderDesc['opts'] },
): ColliderDesc[] {
  const out: ColliderDesc[] = [];
  const c = Math.cos(place.yaw);
  const s = Math.sin(place.yaw);
  const emit = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3) return;
    const lx = (x0 + x1) / 2;
    const ly = (y0 + y1) / 2;
    // yaw about +Y: local +x maps to (cos, 0, -sin)
    const wx = place.x + lx * c;
    const wz = place.z - lx * s;
    kit.box(material, [x1 - x0, y1 - y0, thick], [wx, place.y + ly, wz], place.yaw, typeof tile === 'number' ? { tile } : tile);
    if (collider) out.push({ kind: 'box', center: [wx, place.y + ly, wz], half: [(x1 - x0) / 2, (y1 - y0) / 2, thick / 2], yaw: place.yaw, opts: collider.opts });
  };
  const xs = new Set<number>([0, length]);
  for (const o of openings) {
    xs.add(Math.max(0, o.x0));
    xs.add(Math.min(length, o.x1));
  }
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const x0 = sorted[i];
    const x1 = sorted[i + 1];
    const mid = (x0 + x1) / 2;
    const ops = openings.filter((o) => mid > o.x0 && mid < o.x1).sort((a, b) => a.y0 - b.y0);
    let y = 0;
    for (const o of ops) {
      emit(x0, x1, y, o.y0);
      y = Math.max(y, o.y1);
    }
    emit(x0, x1, y, height);
  }
  return out;
}

/** x,z in wall-local coordinates to world (see wallWithOpenings) */
export function wallPoint(place: { x: number; z: number; yaw: number }, lx: number, lz = 0): [number, number] {
  const c = Math.cos(place.yaw);
  const s = Math.sin(place.yaw);
  return [place.x + lx * c + lz * s, place.z - lx * s + lz * c];
}

/** prism between A and B (world positions at the wall base) with sloped top and bottom */
export function wallPrism(a: THREE.Vector3, b: THREE.Vector3, height: number, thick: number, sink: number, tile: number, extend = 0): THREE.BufferGeometry {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  const g = new THREE.BoxGeometry(l + extend * 2, height + sink, thick);
  bakeBoxUV(g, tile, Math.random() * 0, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) + (l + extend * 2) / 2 - extend) / Math.max(l, 1e-3);
    pos.setY(i, pos.getY(i) + (a.y + (b.y - a.y) * t) + (height - sink) / 2);
  }
  const yaw = Math.atan2(-dz, dx);
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.setPosition((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  g.applyMatrix4(m);
  g.computeVertexNormals();
  return g;
}

/** merged invisible collider mesh from several geometries (positions only) */
export function mergedColliderMesh(geos: THREE.BufferGeometry[], name = 'collider'): THREE.Mesh {
  const stripped = geos.map((g) => {
    const c = g.clone();
    for (const k of Object.keys(c.attributes)) if (k !== 'position') c.deleteAttribute(k);
    return c.index ? c.toNonIndexed() : c;
  });
  const merged = mergeGeometries(stripped, false)!;
  return colliderMesh(merged, name);
}

/** stepped stair block along +z from the origin, rising to +y. width along x. Returns geometry parts. */
export function stairSteps(kit: MeshKit, material: THREE.Material, run: number, rise: number, width: number, opts: { riser?: number; tile?: number; nosing?: number; baseY?: number } = {}): { top: THREE.BufferGeometry[]; steps: number } {
  const riser = opts.riser ?? 0.18;
  const n = Math.max(1, Math.round(rise / riser));
  const h = rise / n;
  const tread = run / n;
  const top: THREE.BufferGeometry[] = [];
  const base = opts.baseY ?? 0;
  for (let i = 0; i < n; i++) {
    // each step is a box from the ground (stacked look) of height (i+1)*h; the tread is its top
    const hh = (i + 1) * h;
    kit.box(material, [width, h, tread + (opts.nosing ?? 0.04)], [0, base + hh - h / 2, (i + 0.5) * tread], 0, { tile: opts.tile ?? 2.5 });
    const tg = new THREE.BoxGeometry(width, h, tread);
    tg.translate(0, base + hh - h / 2, (i + 0.5) * tread);
    top.push(tg);
  }
  return { top, steps: n };
}

/** gable roof with ridge along x centred at the origin: returns geometry list and the collider pieces */
export interface RoofOpts {
  w: number;
  d: number;
  pitch?: number;
  overhang?: number;
  thickness?: number;
  material: THREE.Material;
  gableMaterial?: THREE.Material;
  trim?: THREE.Material;
  y: number;
  /** gable end walls filled with planks */
  gables?: boolean;
}

export function gableRoof(kit: MeshKit, o: RoofOpts): { collider: THREE.BufferGeometry[]; ridgeY: number } {
  const pitch = o.pitch ?? 0.62;
  const ov = o.overhang ?? 0.5;
  const th = o.thickness ?? 0.14;
  const tn = Math.tan(pitch);
  const half = o.d / 2 + ov;
  const slope = half / Math.cos(pitch);
  const len = o.w + ov * 1.6;
  const rise = tn * (o.d / 2);
  const col: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const cz = (s * half) / 2;
    const cy = o.y + (rise - tn * ov) / 2 + th / 2;
    kit.box(o.material, [len, th, slope], [0, cy, cz], 0, { tile: 1.0 }, [s * pitch, 0]);
    const g = new THREE.BoxGeometry(len, th, slope);
    g.rotateX(s * pitch);
    g.translate(0, cy, cz);
    col.push(g);
  }
  const ridgeY = o.y + rise + th;
  kit.box(o.trim ?? o.material, [len + 0.1, 0.14, 0.36], [0, ridgeY, 0], 0, { tile: 1.0 });
  if (o.gables !== false) {
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-o.d / 2 - 0.05, 0);
      sh.lineTo(o.d / 2 + 0.05, 0);
      sh.lineTo(0, rise + 0.05);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      g.translate(sx * (o.w / 2) - (sx > 0 ? 0.16 : 0) + sx * 0.0, o.y, 0);
      kit.add(o.gableMaterial ?? o.material, g, null, { tile: 1.2 });
    }
  }
  return { collider: col, ridgeY };
}

/** half-round arch (voussoir ring) opening of the given span in a wall, along +x centred at the origin */
export function archRing(kit: MeshKit, material: THREE.Material, span: number, thick: number, depth: number, y: number, tile = 2): void {
  const n = 11;
  const r0 = span / 2;
  const r1 = r0 + thick;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI;
    const a1 = ((i + 1) / n) * Math.PI;
    const am = (a0 + a1) / 2;
    const rm = (r0 + r1) / 2;
    const w = (a1 - a0) * rm * 1.06;
    kit.box(material, [thick, w, depth], [Math.cos(am) * rm, y + Math.sin(am) * rm, 0], 0, { tile }, [0, am]);
  }
}

/** merge a list of box colliders hugging a polygon outline (used by ruins) */
export function box(center: V3, half: V3, yaw = 0, opts?: ColliderDesc['opts']): ColliderDesc {
  return { kind: 'box', center, half, yaw, opts };
}
