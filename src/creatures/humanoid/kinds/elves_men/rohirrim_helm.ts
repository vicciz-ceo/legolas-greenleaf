/**
 * The Rohirrim helm of docs/refs/rohirrim: a steel dome with a brass brow band and rivets, a
 * curved nasal bar, hinged cheek plates and a crown finial holding a thick horsehair plume that
 * rises and arcs back over the nape (the stock `rohanHelm` plume is a spray of thin strings). The
 * helmet is rigid gear on the head bone.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { studs, mergeAll, put, taperedTube, tube } from './geo';
import { domePoint, helmDome, sidePlate, STEEL } from './armor';

/** same dome as the stock Rohan helm */
const DOME = { tall: 1.12, point: 0.2, clear: 0.05 };
const RIM = 0.11;
const NAPE = 0.26;
/** brass: rough enough that it does not throw white specular hot spots */
const BRASS = surface('metal', { rough: 0.5 });

export interface RohirrimHelm {
  color: number;
  trim: number;
  crest: number;
  mat?: SurfaceName | SurfaceSpec;
  rng: () => number;
  /** plume length multiplier */
  plume?: number;
}

/** head-unit point on the brow band at azimuth a (0 = front), lifted by `dy` */
function bandPoint(P: KindContext['P'], a: number, push = 1.0, dy = 0): V3 {
  const rx = 0.322 + DOME.clear + 0.004;
  const rz = 0.43 + DOME.clear + 0.004;
  const rimY = RIM - NAPE * ((1 - Math.cos(a)) / 2) + dy;
  // the dome narrows toward the rim: same polar scaling as helmDome
  const ry = (0.4 + DOME.clear) * DOME.tall;
  const cosRim = Math.max(-0.95, Math.min(0.999, (rimY - 0.05) / ry));
  const rr = Math.sin(Math.acos(cosRim));
  return P.h(Math.sin(a) * rx * rr * push, rimY, -0.06 + Math.cos(a) * rz * rr * push);
}

export function rohirrimHelm(ctx: KindContext, o: RohirrimHelm) {
  const { P } = ctx;
  const u = P.headH;
  const mat = o.mat ?? STEEL;
  helmDome(ctx, { ...DOME, color: o.color, trim: o.trim, mat, trimMat: BRASS, rim: RIM, nape: NAPE });
  // a broad brass brow band with seven rivets on its front half
  const band: V3[] = [];
  for (let i = 0; i <= 20; i++) band.push(bandPoint(P, (i / 20) * Math.PI * 2, 1.012, 0.012));
  put(ctx, tube(band, 0.013 * u, { seg: 20, radial: 3, closed: true }), { bone: 'head', color: o.trim, mat: BRASS, small: true });
  const rivets: V3[] = [];
  for (let i = 0; i < 7; i++) rivets.push(bandPoint(P, -Math.PI * 0.78 + (i / 6) * Math.PI * 1.56, 1.03, 0.012));
  put(ctx, studs(rivets, 0.011 * u, 0.7), { bone: 'head', color: shadeUp(o.trim), mat: BRASS, small: true });
  // nasal bar: curved to follow the bridge, a little closer to the nose than the stock bar
  const nz = 0.457;
  const nasal: V3[] = [P.h(0, 0.11, 0.44), P.h(0, -0.02, nz - 0.012), P.h(0, -0.15, nz + 0.003), P.h(0, -0.3, nz - 0.01)];
  put(ctx, taperedTube(nasal, 0.034 * u, 0.02 * u, { seg: 10, radial: 3 }), { bone: 'head', color: o.color, mat, small: true });
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
      flare: 0.03,
    });
    put(ctx, g, { bone: 'head', color: o.color, mat, small: true });
  }
  // finial spike on the crown + the plume holder
  const top = domePoint(DOME, Math.PI, 0.0);
  put(ctx, taperedTube([P.h(top[0], top[1] - 0.01, top[2]), P.h(top[0], top[1] + 0.05, top[2])], 0.028 * u, 0.016 * u, { seg: 2, radial: 5 }), { bone: 'head', color: o.trim, mat: BRASS, small: true });
  // the horsehair: three tapered tails rising from the finial, arching back and falling over the nape
  const len = o.plume ?? 1;
  const list: THREE.BufferGeometry[] = [];
  const base = new THREE.Vector3(...P.h(top[0], top[1] + 0.04, top[2]));
  for (let i = 0; i < 3; i++) {
    const f = i - 1;
    const w = (o.rng() - 0.5) * 0.04;
    const rel: [number, number, number][] = [
      [0, 0.0, 0.0],
      [0.005 * f, 0.1, -0.015],
      [0.01 * f, 0.17, -0.07],
      [0.04 * f + w, 0.2, -0.18],
      [0.07 * f + w, 0.12, -0.32],
      [0.1 * f + w, -0.1, -0.46],
      [0.14 * f + w, -0.6 * len, -0.56],
      [0.17 * f + w, -1.15 * len, -0.58],
    ];
    const pts = rel.map((r) => [base.x + r[0] * u, base.y + r[1] * u, base.z + r[2] * u] as V3);
    list.push(taperedTube(pts, 0.1 * u, 0.025 * u, { seg: 7, radial: 3 }));
  }
  put(ctx, mergeAll(list), { bone: 'head', color: o.crest, mat: surface('wool', { rough: 0.7, pat: { fur: 0.9, weave: 0 } }), small: true });
}

function shadeUp(c: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * 1.12);
  const g = Math.min(255, ((c >> 8) & 255) * 1.12);
  const b = Math.min(255, (c & 255) * 1.12);
  return (r << 16) | (g << 8) | b;
}
