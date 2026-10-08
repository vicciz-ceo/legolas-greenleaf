/**
 * Painted markings on skin (tattoos, war paint, scars, soot): strokes are chains of paint-only
 * round cones, so they cost no triangles beyond the colour boundary refinement.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import { put } from './armor';
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

/**
 * Crisp thin lines (tattoos) as flat ink ribbons floating a few millimetres above the scalp. Painted
 * colour is per vertex, so lines thinner than the head mesh cell would vanish; ribbons keep them sharp.
 * The ribbons sit on the cranium ellipsoid; a soft broad paint underneath hides the gap.
 */
export function inkScalp(ctx: KindContext, strokes: [number, number][][], o: { color: number; width?: number; lift?: number; under?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const w = (o.width ?? 0.012) * u;
  const lift = (o.lift ?? 0.012) * u;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const stroke of strokes) {
    // resample the stroke so ribbons follow the curvature
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < stroke.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(stroke[i + 1][0] - stroke[i][0], stroke[i + 1][1] - stroke[i][1]) / 0.18));
      for (let k = 0; k < n; k++) pts.push([stroke[i][0] + ((stroke[i + 1][0] - stroke[i][0]) * k) / n, stroke[i][1] + ((stroke[i + 1][1] - stroke[i][1]) * k) / n]);
    }
    pts.push(stroke[stroke.length - 1]);
    const base = pos.length / 3;
    const q = pts.map(([az, el]) => new THREE.Vector3(...scalpPoint(ctx, az, el, lift / u)));
    const c = new THREE.Vector3(...P.h(0, 0.045, -0.055));
    for (let i = 0; i < q.length; i++) {
      const t = (q[Math.min(i + 1, q.length - 1)] as THREE.Vector3).clone().sub(q[Math.max(i - 1, 0)]).normalize();
      const n = q[i].clone().sub(c).normalize();
      const side = new THREE.Vector3().crossVectors(t, n).normalize().multiplyScalar(w / 2);
      const taper = 1 - 0.5 * Math.pow(Math.abs(i / (q.length - 1) - 0.5) * 2, 3);
      const a = q[i].clone().addScaledVector(side, taper);
      const b = q[i].clone().addScaledVector(side, -taper);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i + 1 < q.length; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  put(ctx, g, { bone: 'head', color: o.color, mat: 'skin_weathered', small: true, ao: 1 });
  // broad faint paint under the lines so they do not look pasted on
  for (const stroke of strokes) {
    for (let i = 0; i + 1 < stroke.length; i++) {
      ctx.sculpt.cone(scalpPoint(ctx, stroke[i][0], stroke[i][1]), scalpPoint(ctx, stroke[i + 1][0], stroke[i + 1][1]), (o.under ?? 0.03) * u, (o.under ?? 0.03) * u, { op: 'paint', color: o.color, mat: 'skin_weathered', bone: 'head', k: 0.03 * u, strength: 0.14 });
    }
  }
}
