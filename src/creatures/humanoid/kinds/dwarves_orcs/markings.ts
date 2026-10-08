/**
 * Painted markings on skin (tattoos, war paint, scars, soot): strokes are chains of paint-only
 * round cones, so they cost no triangles beyond the colour boundary refinement.
 */
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName } from '../../../kit/surfaces';
import type { KindContext } from '../../types';

export interface StrokeOpts {
  color: number;
  /** stroke radius in head units */
  r?: number;
  k?: number;
  strength?: number;
  mat?: SurfaceName;
  bone?: string;
  /** taper to this fraction at the end */
  taper?: number;
}

/** point on the cranium for (azimuth, elevation): az 0 = front, + = character's left; el 0 = eye-level ring … π/2 = crown */
export function scalpPoint(ctx: KindContext, az: number, el: number, lift = 0): V3 {
  const { P } = ctx;
  const cx = 0, cy = 0.045, cz = -0.055;
  const rx = 0.322 + lift, ry = 0.398 + lift, rz = 0.428 + lift;
  return P.h(cx + rx * Math.cos(el) * Math.sin(az), cy + ry * Math.sin(el), cz + rz * Math.cos(el) * Math.cos(az));
}

/** a smooth stroke over the scalp through (az, el) points */
export function scalpStroke(ctx: KindContext, pts: [number, number][], o: StrokeOpts) {
  const { sculpt: s, P } = ctx;
  const u = P.headH;
  const r = (o.r ?? 0.008) * u;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = scalpPoint(ctx, pts[i][0], pts[i][1]);
    const b = scalpPoint(ctx, pts[i + 1][0], pts[i + 1][1]);
    const t0 = 1 - (o.taper ?? 0) * (i / (pts.length - 1));
    const t1 = 1 - (o.taper ?? 0) * ((i + 1) / (pts.length - 1));
    s.cone(a, b, r * t0, r * t1, { op: 'paint', color: o.color, mat: o.mat ?? 'skin_weathered', bone: o.bone ?? 'head', k: (o.k ?? 0.004) * u, strength: o.strength ?? 0.95 });
  }
}

/** approximate front-of-face surface (head units) for painting: forehead, cheeks, nose bridge */
export function facePoint(x: number, y: number, lift = 0): V3 {
  // flatter across the forehead and cheeks, curving back at the temples
  const ax = Math.min(1, Math.abs(x) / 0.34);
  const z = 0.4 - 0.5 * ax * ax - (y < -0.15 ? 0.1 * Math.min(1, (-y - 0.15) / 0.3) : 0) - (y > 0.15 ? 0.2 * Math.min(1, (y - 0.15) / 0.3) : 0) + lift;
  return [x, y, z];
}

export function faceStroke(ctx: KindContext, pts: [number, number][], o: StrokeOpts & { lift?: number }) {
  const { sculpt: s, P } = ctx;
  const u = P.headH;
  const r = (o.r ?? 0.012) * u;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = facePoint(pts[i][0], pts[i][1], o.lift);
    const b = facePoint(pts[i + 1][0], pts[i + 1][1], o.lift);
    const t0 = 1 - (o.taper ?? 0) * (i / (pts.length - 1));
    const t1 = 1 - (o.taper ?? 0) * ((i + 1) / (pts.length - 1));
    s.cone(P.h(a[0], a[1], a[2]), P.h(b[0], b[1], b[2]), r * t0, r * t1, { op: 'paint', color: o.color, mat: o.mat ?? 'skin', bone: o.bone ?? 'head', k: (o.k ?? 0.006) * u, strength: o.strength ?? 0.9 });
  }
}

/** a mirrored face stroke (left side given, right side mirrored) */
export function faceStrokeMirrored(ctx: KindContext, pts: [number, number][], o: StrokeOpts & { lift?: number }) {
  faceStroke(ctx, pts, o);
  faceStroke(ctx, pts.map(([x, y]) => [-x, y] as [number, number]), o);
}

/** a painted blob (ellipsoid) */
export function paintBlob(ctx: KindContext, c: V3, r: V3, o: { color: number; mat?: SurfaceName; k?: number; strength?: number; bone?: string; rot?: V3 }) {
  ctx.sculpt.ellipsoid(c, r, { op: 'paint', color: o.color, mat: o.mat ?? 'skin', bone: o.bone ?? 'head', k: o.k ?? 0.01, strength: o.strength ?? 0.8, rot: o.rot });
}

/** a limb band painted around a bone segment (tattoo bands, war-paint stripes on arms) */
export function paintRing(ctx: KindContext, a: V3, b: V3, r: number, o: { color: number; mat?: SurfaceName; bone: string; k?: number; strength?: number }) {
  ctx.sculpt.cone(a, b, r, r, { op: 'paint', color: o.color, mat: o.mat ?? 'skin', bone: o.bone, k: o.k ?? 0.004, strength: o.strength ?? 0.9 });
}
