/**
 * The Rohirrim helm of docs/refs/rohirrim: a steel dome with a bronze brow band and rivets, a flat
 * nasal bar, hinged cheek plates and a crown finial holding a thick horsehair plume that rises and
 * arcs back over the nape (the stock `rohanHelm` plume is a spray of thin strings). The
 * helmet is rigid gear on the head bone.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { studs, mergeAll, put, taperedTube } from './geo';
import { domePoint, helmDome, nasalGuard, sidePlate, STEEL } from './armor';

/** same dome as the stock Rohan helm */
const DOME = { tall: 1.12, point: 0.2, clear: 0.05 };

export interface RohirrimHelm {
  color: number;
  trim: number;
  crest: number;
  crest2?: number;
  mat?: SurfaceName | SurfaceSpec;
  rng: () => number;
  /** plume length multiplier */
  plume?: number;
}

export function rohirrimHelm(ctx: KindContext, o: RohirrimHelm) {
  const { P } = ctx;
  const u = P.headH;
  const mat = o.mat ?? STEEL;
  helmDome(ctx, { ...DOME, color: o.color, trim: o.trim, mat, trimMat: 'gold', rim: 0.11, nape: 0.26 });
  nasalGuard(ctx, { color: o.color, mat, width: 0.032, length: 0.4, wide: 1.1 });
  // cheek plates
  for (const sx of [1, -1] as const) {
    const g = sidePlate(P, sx, {
      y0: -0.4,
      y1: 0.05,
      z0: -0.04,
      z1: 0.3,
      off: 0.035,
      nY: 4,
      nZ: 3,
      outline: (fy) => [-0.07 + 0.1 * (1 - fy) * (1 - fy), 0.3 - 0.13 * (1 - fy)],
      flare: 0.02,
    });
    put(ctx, g, { bone: 'head', color: o.color, mat, small: true });
  }
  // bronze rivets along the brow band
  const rivets: V3[] = [];
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.8 + (i / 8) * Math.PI * 1.6; // 0 = front
    const p = domePoint(DOME, a + Math.PI, 0);
    void p;
    const rx = 0.322 + 0.05 + 0.002;
    const rz = 0.43 + 0.05 + 0.002;
    const rimY = 0.11 - 0.26 * ((1 - Math.cos(a)) / 2) + 0.012;
    rivets.push(P.h(Math.sin(a) * rx * 0.995, rimY, -0.06 + Math.cos(a) * rz * 0.995));
  }
  put(ctx, studs(rivets.filter((_, i) => i % 2 === 0), 0.012 * u, 0.7), { bone: 'head', color: o.trim, mat: 'metal', small: true });
  // finial spike on the crown + the plume holder
  const top = domePoint(DOME, Math.PI, 0.0);
  const f0 = P.h(top[0], top[1] - 0.01, top[2]);
  const f1 = P.h(top[0], top[1] + 0.09, top[2]);
  put(ctx, taperedTube([f0, f1], 0.028 * u, 0.016 * u, { seg: 2, radial: 5 }), { bone: 'head', color: o.trim, mat: 'metal', small: true });
  // the horsehair: a fan of tapered bundles rising from the finial, arching back and falling over the nape
  const len = o.plume ?? 1;
  const n = 3;
  const list: THREE.BufferGeometry[] = [];
  const base = new THREE.Vector3(...P.h(top[0], top[1] + 0.07, top[2]));
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1) - 0.5;
    const w = (o.rng() - 0.5) * 0.04;
    const rel: [number, number, number][] = [
      [0, 0.0, 0.0],
      [0.01 * f, 0.15, -0.015],
      [0.02 * f, 0.25, -0.07],
      [0.04 * f + w, 0.28, -0.18],
      [0.07 * f + w, 0.2, -0.32],
      [0.12 * f + w, 0.0, -0.46],
      [0.17 * f + w, -0.45 * len, -0.56],
      [0.2 * f + w, -0.95 * len, -0.6],
    ];
    const pts = rel.map((r) => [base.x + r[0] * u, base.y + r[1] * u, base.z + r[2] * u] as V3);
    list.push(taperedTube(pts, 0.11 * u, 0.028 * u, { seg: 8, radial: 3 }));
  }
  put(ctx, mergeAll(list), { bone: 'head', color: o.crest, mat: surface('wool', { rough: 0.7, pat: { fur: 0.9, weave: 0 } }), small: true });
}
