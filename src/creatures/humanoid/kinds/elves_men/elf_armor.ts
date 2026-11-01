/**
 * Elf guard body armour, cut to the Mirkwood / Galadhrim turnarounds (adapted from armor.ts'
 * leafCuirass / flutedCuirass, which are shared and sized for a lower belt):
 *   - a smooth gold breastplate worn from the collar to the belt, its lower edge drawn down into a
 *     leaf point at the centre front and swept up at the sides, with overlapping leaves fanning
 *     from a raised central ridge (Mirkwood: hammered bronze leaf scales; Galadhrim: fluted gold)
 *   - a plain high back plate, trim lines along the edge
 * The armour skirt of long leaf plates is `leafTassets` in elf_cloth.ts.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { along, instances, leaf, mergeAll, put, torsoPoint, torsoShell, tube } from './geo';
import { shade } from './common';

export interface ElfCuirassOpts {
  color: number;
  trim: number;
  mat: SurfaceName | SurfaceSpec;
  trimMat?: SurfaceName | SurfaceSpec;
  /** belt height: the plate ends on it */
  beltY: number;
  /** fluted (Galadhrim) rather than plain leaf scales (Mirkwood) */
  fluted?: boolean;
}

export function elfCuirass(ctx: KindContext, o: ElfCuirassOpts) {
  const { P } = ctx;
  const s = P.s;
  const j = P.j;
  const tm = o.trimMat ?? 'gold';
  const y0 = o.beltY + 0.02 * s;
  const y1 = j.neck[1] - 0.012 * s;
  const flutes = 9;
  // breastplate: the lower edge is a leaf point at the centre front (lowest) and rises to the sides
  const v = (f: number) => Math.pow(Math.abs(f - 0.5) * 2, 1.25);
  const front = torsoShell(P, {
    y0,
    y1,
    a0: -1.3,
    a1: 1.3,
    off: 0.024 * s,
    nA: o.fluted ? 22 : 16,
    nY: 6,
    edge0: (f) => -0.03 * s + 0.07 * s * v(f),
    edge1: (f) => -0.008 * s * Math.abs(f - 0.5) * 2,
    power: 2.6,
    ripple: o.fluted ? (a) => 0.0034 * s * Math.cos(a * flutes * 1.1) : undefined,
  });
  put(ctx, front, { bone: 'chest', color: o.color, mat: o.mat });
  put(ctx, torsoShell(P, { y0: y0 + 0.02 * s, y1: y1 - 0.01 * s, a0: Math.PI - 1.15, a1: Math.PI + 1.15, off: 0.022 * s, nA: 8, nY: 4, power: 2.6 }), { bone: 'chest', color: shade(o.color, 0.92), mat: o.mat, small: true });
  // angled vein grooves fanning down and out from the midrib (the breastplate's leaf veining)
  const veins: THREE.BufferGeometry[] = [];
  const nV = 5;
  for (const sd of [1, -1]) {
    for (let r = 0; r < nV; r++) {
      const ya = y1 - 0.04 * s - r * 0.052 * s;
      const pts: V3[] = [];
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        const a = sd * (0.04 + f * (0.62 + 0.1 * r));
        pts.push(torsoPoint(P, a, ya - f * (0.07 + 0.01 * r) * s, 0.0285 * s));
      }
      veins.push(tube(pts, 0.0021 * s, { seg: 6, radial: 3 }));
    }
  }
  put(ctx, mergeAll(veins), { bone: 'chest', color: shade(o.trim, 0.9), mat: tm, small: true });
  // central ridge down to the point
  const ridge: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const y = y1 - 0.005 * s - ((y1 - (y0 - 0.03 * s)) * i) / 8;
    ridge.push(torsoPoint(P, 0, y, 0.03 * s));
  }
  put(ctx, tube(ridge, 0.0036 * s, { seg: 8, radial: 3 }), { bone: 'chest', color: o.trim, mat: tm, small: true });
  // trim line along the lower edge
  const edge: V3[] = [];
  for (let i = 0; i <= 18; i++) {
    const f = i / 18;
    edge.push(torsoPoint(P, -1.28 + f * 2.56, y0 - 0.03 * s + 0.07 * s * v(f) + 0.003 * s, 0.028 * s));
  }
  put(ctx, tube(edge, 0.0032 * s, { seg: 18, radial: 3 }), { bone: 'chest', color: o.trim, mat: tm, small: true });
}

/**
 * Shoulder armour of the sheets: four narrow overlapping leaf plates sliding down the upper arm from
 * the shoulder cap (shallow droop, hugging the sleeve), the lowest overlapping it. Sheet: about
 * 0.11-0.14 m beyond the shoulder, so the silhouette stays slim.
 */
export function elfPauldrons(ctx: KindContext, o: { color: number; trim: number; mat: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; tiers?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const L = P.hand.l.L;
  const tiers = o.tiers ?? 4;
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    const axis = new THREE.Vector3(sx * L.x, L.y, L.z);
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const front = new THREE.Vector3(0, 0, 1);
    for (let k = 0; k < tiers; k++) {
      const t = 0.015 + k * 0.034; // anchored a little lower than before
      const r = (0.05 * g + 0.002 * k) * s + 0.006 * s;
      const n = 3;
      const len = (0.07 + 0.012 * k) * s;
      const w = (0.03 + 0.002 * k) * s;
      const lf = leaf(len, w, { droop: 0.1, cup: 0.35, rows: 3, rib: 0.25 });
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const phi = (i / (n - 1) - 0.5) * (1.5 + 0.1 * k);
        const radial = up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(front, Math.sin(phi));
        const pos = new THREE.Vector3(sh[0], sh[1], sh[2]).addScaledVector(axis, t * s).addScaledVector(radial, r);
        const dir = axis.clone().addScaledVector(radial, 0.16).normalize();
        mats.push(along([pos.x, pos.y, pos.z], [dir.x, dir.y, dir.z], [radial.x, radial.y, radial.z], 1));
      }
      put(ctx, instances(lf, mats), { bone: `upperarm_${side}`, color: k % 2 ? shade(o.color, 0.93) : o.color, mat: o.mat });
    }
  }
}
