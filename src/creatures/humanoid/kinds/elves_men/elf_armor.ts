/**
 * Elf guard armour, cut to the Mirkwood / Galadhrim turnarounds (adapted from armor.ts'
 * leafCuirass / flutedCuirass, which are shared and sized for a lower belt):
 *   - `elfCuirass`: a smooth breastplate from a V-notched collar to the belt, its lower edge drawn
 *     into a leaf point at the centre front, with three tiers of overlapping leaf plates over the
 *     lower plate (Mirkwood: a chevron pointing down to the belt; Galadhrim: a fan), a raised midrib
 *     and dark angled vein grooves
 *   - `elfPauldrons`: three flat overlapping leaf tiers per side lying along the upper arm, each a
 *     little further out than the one above, darker in the recesses
 *   - `elfCrest`: the Mirkwood helm's tall crest of stacked leaf blades and hanging cheek leaves
 * The armour skirt of long leaf plates is `leafTassets` in elf_cloth.ts.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { domePoint } from './armor';
import { along, instances, leaf, mergeAll, put, torsoPoint, torsoShell, tube } from './geo';
import { shade } from './common';

export interface ElfCuirassOpts {
  color: number;
  /** midrib and edge line colour */
  trim: number;
  mat: SurfaceName | SurfaceSpec;
  /** the dark groove colour and surface of the vein lines */
  veinColor: number;
  veinMat: SurfaceName | SurfaceSpec;
  /** belt height */
  beltY: number;
  /** height of the plate's centre point above the belt (m, unscaled): Mirkwood leaves the belt visible */
  bottom: number;
  /** fluted (Galadhrim) rather than plain (Mirkwood) */
  fluted?: boolean;
  /** the lower leaf tiers point inward to a V (Mirkwood) instead of fanning out (Galadhrim) */
  chevron?: boolean;
  /** half angle (rad) of the plate round the chest: wider wraps further round the ribs */
  half?: number;
}

export function elfCuirass(ctx: KindContext, o: ElfCuirassOpts) {
  const { P } = ctx;
  const s = P.s;
  const j = P.j;
  const y0 = o.beltY + o.bottom * s;
  const y1 = j.neck[1] - 0.012 * s;
  const flutes = 9;
  // the lower edge is a leaf point at the centre front (lowest), a little higher at the sides
  const v = (f: number) => Math.pow(Math.abs(f - 0.5) * 2, 1.25);
  const lowEdge = (f: number) => -0.025 * s + 0.035 * s * v(f);
  const front = torsoShell(P, {
    y0,
    y1,
    a0: -(o.half ?? 1.3),
    a1: o.half ?? 1.3,
    off: 0.024 * s,
    nA: o.fluted ? 18 : 16,
    nY: 6,
    edge0: lowEdge,
    // V-notch at the collar
    edge1: (f) => -0.04 * s * Math.pow(1 - Math.abs(f - 0.5) * 2, 1.4),
    // taper in toward the waist
    flare: (fy) => 0.965 + 0.035 * fy,
    power: 2.6,
    ripple: o.fluted ? (a) => 0.0058 * s * Math.cos(a * flutes * 1.1) : undefined,
  });
  put(ctx, front, { bone: 'chest', color: o.color, mat: o.mat });
  put(ctx, torsoShell(P, { y0: y0 + 0.02 * s, y1: y1 - 0.01 * s, a0: Math.PI - 1.15, a1: Math.PI + 1.15, off: 0.022 * s, nA: 8, nY: 4, power: 2.6 }), { bone: 'chest', color: shade(o.color, 0.92), mat: o.mat, small: true });

  // three tiers of overlapping leaf plates over the lower breastplate
  const lf = leaf(0.085 * s, 0.03 * s, { droop: 0.12, cup: 0.35, rows: 3, rib: 0.25 });
  const tiers: THREE.Matrix4[] = [];
  const rowsN = o.fluted ? [5, 7] : [5, 7, 9];
  for (let r = 0; r < rowsN.length; r++) {
    const n = rowsN[r];
    const rowY = y0 + (0.105 - r * 0.036) * s;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      const a = f * (1.45 + 0.1 * r);
      const y = rowY + (o.chevron ? 0.055 * Math.abs(f) * 2 * s : 0);
      const p = torsoPoint(P, a, y, (0.03 + 0.004 * r) * s);
      const p0 = torsoPoint(P, a, y, 0);
      const p1 = torsoPoint(P, a, y, 0.05);
      const nx = p1[0] - p0[0];
      const nz = p1[2] - p0[2];
      const nl = Math.hypot(nx, nz) || 1;
      const dirx = o.chevron ? -f * 1.1 : f * 0.6;
      tiers.push(along(p, [dirx, -1, 0.04], [nx / nl, 0.2, nz / nl], 1));
    }
  }
  put(ctx, instances(lf, tiers), { bone: 'chest', color: shade(o.color, 1.04), mat: o.mat, small: true });

  // angled vein grooves from the midrib, dark, kept off the lower tiers and the plate edge
  const veins: THREE.BufferGeometry[] = [];
  const yTop = y1 - 0.04 * s;
  const yBot = y0 + 0.14 * s;
  const nV = 4;
  for (const sd of [1, -1]) {
    for (let r = 0; r < nV; r++) {
      const ya = yTop - (r * (yTop - yBot - 0.06 * s)) / (nV - 1);
      const pts: V3[] = [];
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        pts.push(torsoPoint(P, sd * (0.04 + f * (0.6 + 0.1 * r)), ya - f * (0.055 + 0.008 * r) * s, 0.0285 * s));
      }
      veins.push(tube(pts, 0.0023 * s, { seg: 6, radial: 3 }));
    }
  }
  const vm = mergeAll(veins);
  for (const g of veins) g.dispose();
  put(ctx, vm, { bone: 'chest', color: o.veinColor, mat: o.veinMat, small: true });
  // midrib down to the point
  const ridge: V3[] = [];
  for (let i = 0; i <= 8; i++) ridge.push(torsoPoint(P, 0, y1 - 0.02 * s - ((y1 - 0.02 * s - (y0 + lowEdge(0.5) + 0.01 * s)) * i) / 8, 0.0305 * s));
  put(ctx, tube(ridge, 0.0038 * s, { seg: 8, radial: 3 }), { bone: 'chest', color: o.trim, mat: o.mat, small: true });
  // trim line along the lower edge
  const edge: V3[] = [];
  for (let i = 0; i <= 18; i++) {
    const f = i / 18;
    edge.push(torsoPoint(P, -(o.half ?? 1.3) + 0.02 + f * 2 * ((o.half ?? 1.3) - 0.02), y0 + lowEdge(f) + 0.003 * s, 0.028 * s));
  }
  put(ctx, tube(edge, 0.0032 * s, { seg: 18, radial: 3 }), { bone: 'chest', color: o.trim, mat: o.mat, small: true });
}

/**
 * Shoulder armour of the sheets: three flat leaf plates per side stepping out and down the upper arm (each
 * tier a little further from the sleeve than the one above it, so the lower tiers stand proud),
 * darker in the recesses of the upper tiers, plus a small leaf at the collar. Outer reach is about
 * 0.12-0.14 m beyond the shoulder, like the sheets.
 */
export function elfPauldrons(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec; tiers?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const L = P.hand.l.L;
  const tiers = o.tiers ?? 3;
  const tone = [0.8, 0.92, 1.02];
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    const axis = new THREE.Vector3(sx * L.x, L.y, L.z);
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const front = new THREE.Vector3(0, 0, 1);
    for (let k = 0; k < tiers; k++) {
      const t = -0.005 + k * 0.05; // down the arm
      const r = (0.047 * g + 0.005 * k) * s + 0.007 * s; // each tier a little further out than the one above
      const n = 3;
      const len = (0.09 + 0.016 * k) * s;
      const w = (0.036 + 0.003 * k) * s;
      const lf = leaf(len, w, { droop: 0.08, cup: 0.3, rows: 2, rib: 0.22 });
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const phi = (i / (n - 1) - 0.5) * (1.6 + 0.1 * k);
        const radial = up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(front, Math.sin(phi));
        const pos = new THREE.Vector3(sh[0], sh[1], sh[2]).addScaledVector(axis, t * s).addScaledVector(radial, r);
        const dir = axis.clone().addScaledVector(radial, 0.18).normalize();
        mats.push(along([pos.x, pos.y, pos.z], [dir.x, dir.y, dir.z], [radial.x, radial.y, radial.z], 1));
      }
      put(ctx, instances(lf, mats), { bone: `upperarm_${side}`, color: shade(o.color, tone[Math.min(k, tone.length - 1)]), mat: o.mat });
    }
  }
}

/** the Mirkwood helm's crest: four stacked leaf blades fanning back from the dome, and a hanging leaf on each cheek */
export function elfCrest(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const top = domePoint({ tall: 1.22, point: 0.7, clear: 0.045 }, 0, 0.5);
  const dirs: V3[] = [[0, 0.62, -0.78], [0, 0.5, -0.87], [0, 0.4, -0.92], [0, 0.3, -0.95]];
  const lens = [0.78, 0.72, 0.62, 0.52];
  const geos: THREE.BufferGeometry[] = [];
  dirs.forEach((d, i) => {
    const bl = leaf(lens[i] * u, 0.125 * u, { droop: 0.1, cup: 0.35, rows: 6, rib: 0.4, pointy: 1.1 });
    geos.push(bl.clone().applyMatrix4(along(P.h(top[0], top[1] + 0.012 - 0.01 * i, top[2] + 0.04 - 0.085 * i), d, [0, 0.2, 1], 1)));
    bl.dispose();
  });
  put(ctx, mergeAll(geos), { bone: 'head', color: o.color, mat: o.mat, small: true });
  for (const g of geos) g.dispose();
  const cheek = leaf(0.4 * u, 0.075 * u, { droop: 0.08, cup: 0.45, rows: 4, rib: 0.3 });
  const mats: THREE.Matrix4[] = [];
  for (const sx of [1, -1]) mats.push(along(P.h(sx * 0.335, 0.02, 0.1), [sx * 0.08, -1, 0.12], [sx, 0.1, 0.1], 1));
  put(ctx, instances(cheek, mats), { bone: 'head', color: shade(o.color, 0.95), mat: o.mat, small: true });
}
