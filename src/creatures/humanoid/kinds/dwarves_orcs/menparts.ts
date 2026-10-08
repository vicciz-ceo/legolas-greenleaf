/**
 * Parts for the human kinds (easterling, haradrim): layered pauldrons, scale armour surfaces,
 * jewellery, plumes and sashes.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { put, ring, shell, spike, studs, taperedTube } from './armor';

export const GOLD_SCALES = surface('gold', { rough: 0.42, pat: { scales: 1.9, scratches: 0.25 } });
export const BRONZE_SCALES = surface('gold', { rough: 0.5, pat: { scales: 1.9, scratches: 0.4 } });
export const BLACK_SCALES = surface('metal_dark', { rough: 0.4, metal: 0.85, pat: { scales: 1.9, scratches: 0.5 } });
export const LAMELLAR = surface('leather_worn', { rough: 0.6, pat: { scales: 1.6, leather: 0.8 } });

/** layered, rounded shoulder plates with edge rings and an optional spike */
export function layeredPauldrons(ctx: KindContext, o: { color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; layers?: number; size?: number; spike?: number; sides?: ('l' | 'r')[] }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const layers = o.layers ?? 3;
  const trim = o.trim ?? o.color;
  for (const side of o.sides ?? (['l', 'r'] as const)) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    for (let k = 0; k < layers; k++) {
      const R = (0.1 - k * 0.006) * s * g * (o.size ?? 1);
      const th = Math.PI * (0.4 - k * 0.03);
      const geo = shell(R, R * 0.75, R * 1.05, { th0: 0, th1: th, w: 10, h: 4 });
      const m = new THREE.Matrix4()
        .makeTranslation(sh[0] + sx * 0.018 * s, sh[1] + (0.032 - k * 0.032) * s, sh[2])
        .multiply(new THREE.Matrix4().makeRotationZ(-sx * (0.6 + k * 0.1)));
      put(ctx, geo, { bone: `upperarm_${side}`, color: o.color, mat: o.mat ?? 'gold', matrix: m });
      const rg = new THREE.TorusGeometry(R * 0.99, 0.0045 * s * 1.3, 3, 12).rotateX(Math.PI / 2);
      rg.scale(Math.sin(th), 1, Math.sin(th) * 1.05).translate(0, Math.cos(th) * R * 0.75, 0);
      put(ctx, rg, { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', matrix: m, small: true });
    }
    if (o.spike) put(ctx, spike([sh[0] + sx * 0.05 * s, sh[1] + 0.085 * s, sh[2]], [sx * 0.35, 1, 0], o.spike * s, 0.014 * s, 6), { bone: `upperarm_${side}`, color: trim, mat: o.trimMat ?? 'gold', small: true });
  }
}

/** gold neck ring (torque), arm bangles and ear rings */
export function jewelry(ctx: KindContext, o: { color?: number; neck?: boolean; arms?: number; ears?: boolean; rng?: Rng }) {
  const { P } = ctx;
  const s = P.s;
  const c = o.color ?? 0xd0a640;
  if (o.neck) {
    const r = (0.066 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.012) * s;
    put(ctx, new THREE.TorusGeometry(r, 0.0075 * s, 6, 20).rotateX(Math.PI / 2 - 0.25).translate(0, P.j.neck[1] + 0.012 * s, 0.0), { bone: 'neck', color: c, mat: 'gold', small: true });
  }
  for (let i = 0; i < (o.arms ?? 0); i++) {
    for (const sd of ['l', 'r'] as const) {
      const a = P.j[`forearm_${sd}`];
      const w = P.j[`hand_${sd}`];
      const t = 0.3 + i * 0.16;
      const p: V3 = [a[0] + (w[0] - a[0]) * t, a[1] + (w[1] - a[1]) * t, a[2]];
      const d: V3 = [w[0] - a[0], w[1] - a[1], 0];
      put(ctx, ring(p, d, 0.037 * s * (1 - t * 0.35), 0.0055 * s, 10), { bone: `forearm_${sd}`, color: c, mat: 'gold', small: true });
    }
  }
  if (o.ears) {
    for (const sd of [1, -1]) put(ctx, new THREE.TorusGeometry(0.014 * s, 0.0025 * s, 4, 10).translate(...P.h(sd * 0.36, -0.2, -0.015)), { bone: 'head', color: c, mat: 'gold', small: true });
  }
}

/** a horsehair plume streaming back from the crown */
export function plume(ctx: KindContext, o: { color: number; length?: number; y?: number; spread?: number; n?: number; mat?: SurfaceName }) {
  const { P } = ctx;
  const u = P.headH;
  const n = o.n ?? 7;
  const len = (o.length ?? 0.9) * u;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const base = P.h(f * 0.12 * (o.spread ?? 1), (o.y ?? 0.62) - Math.abs(f) * 0.04, 0.0);
    const pts: V3[] = [base, [base[0] + f * 0.1 * u, base[1] + 0.12 * u, base[2] - 0.2 * u], [base[0] + f * 0.22 * u, base[1] + 0.12 * u, base[2] - 0.5 * u], [base[0] + f * 0.34 * u, base[1] - len * 0.35, base[2] - 0.7 * u]];
    put(ctx, taperedTube(pts, 0.05 * u, 0.012 * u, { seg: 10, radial: 4 }), { bone: 'head', color: o.color, mat: o.mat ?? 'wool', small: true });
  }
}

/** a sash/belt with gold studs */
export function studdedBand(ctx: KindContext, o: { y: number; color: number; n?: number; rx?: number; rz?: number }) {
  const { P } = ctx;
  const s = P.s;
  const rx = o.rx ?? 0.15 * s * Math.sqrt(P.build.bulk);
  const rz = o.rz ?? (0.108 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.02 * s);
  const pts: V3[] = [];
  const n = o.n ?? 14;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * 0.8 + (i / (n - 1)) * Math.PI * 1.6;
    pts.push([Math.sin(a) * rx, o.y, Math.cos(a) * rz]);
  }
  const g = studs(pts, 0.0065 * s);
  if (g) put(ctx, g, { bone: 'hips', color: o.color, mat: 'gold', small: true });
}
