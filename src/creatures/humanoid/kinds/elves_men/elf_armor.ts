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
import { along, instances, leaf, put, torsoPoint, torsoShell, tube } from './geo';
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

/** outward horizontal normal of the torso at (angle, y) */
function normalAt(P: KindContext['P'], a: number, y: number): V3 {
  const p0 = torsoPoint(P, a, y, 0);
  const p1 = torsoPoint(P, a, y, 0.05);
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, 0, dz / l];
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
  // overlapping leaves fanning from the central ridge (the breastplate's veining)
  const lf = leaf(0.085 * s, 0.025 * s, { droop: 0.2, cup: 0.3, rows: 3 });
  const mats: THREE.Matrix4[] = [];
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = y1 - 0.05 * s - r * 0.065 * s;
    const n = r === 0 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      const a = f * 1.75;
      const p = torsoPoint(P, a, y, 0.027 * s);
      const nrm = normalAt(P, a, y);
      mats.push(along(p, [f * 0.55, -1, 0.05], [nrm[0], 0.2, nrm[2]], 1));
    }
  }
  put(ctx, instances(lf, mats), { bone: 'chest', color: o.trim, mat: tm, small: true });
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
 * Shoulder armour of the sheets: three tiers of broad leaf plates fanned over the shoulder and
 * sliding down the upper arm (outer tier longest), the lowest overlapping the sleeve.
 */
export function elfPauldrons(ctx: KindContext, o: { color: number; trim: number; mat: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; tiers?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const L = P.hand.l.L;
  const tiers = o.tiers ?? 3;
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    const axis = new THREE.Vector3(sx * L.x, L.y, L.z);
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const front = new THREE.Vector3(0, 0, 1);
    const mats: THREE.Matrix4[] = [];
    for (let k = 0; k < tiers; k++) {
      const t = -0.005 + k * 0.055;
      const r = (0.068 * g + 0.006 * k) * s + 0.01 * s;
      const n = k === 0 ? 3 : 4;
      const len = (0.115 + 0.022 * k) * s;
      const w = (0.05 + 0.006 * k) * s;
      const lf = leaf(len, w, { droop: 0.18, cup: 0.5, rows: 3, rib: 0.3 });
      for (let i = 0; i < n; i++) {
        const phi = (i / (n - 1) - 0.5) * (1.9 + 0.2 * k);
        const radial = up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(front, Math.sin(phi));
        const pos = new THREE.Vector3(sh[0], sh[1], sh[2]).addScaledVector(axis, t * s).addScaledVector(radial, r);
        const dir = axis.clone().addScaledVector(radial, 0.32 + 0.06 * k).normalize();
        mats.push(along([pos.x, pos.y, pos.z], [dir.x, dir.y, dir.z], [radial.x, radial.y, radial.z], 1).clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.01 * s, 0)));
      }
      // each tier is its own geometry: leaf size differs
      put(ctx, instances(lf, mats.splice(0, mats.length)), { bone: `upperarm_${side}`, color: k % 2 ? shade(o.color, 0.93) : o.color, mat: o.mat });
    }
  }
}
