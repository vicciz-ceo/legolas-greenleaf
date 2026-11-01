/**
 * Rigid leather pieces that follow the surface of the base kind's kilt (outfit `skirt`): hip plates,
 * flank panels and hanging belt straps for Bolg and Lurtz (docs/refs/bolg, docs/refs/lurtz). The
 * kilt itself is a skinned cloth panel built in cloth.ts; this reproduces its envelope (same
 * formulas as `skirtGeometry`, kept in sync by hand) so rigid gear can sit just outside it near
 * the belt, where the cloth hardly moves.
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import type { SurfaceSpec } from '../../../kit/surfaces';
import { V, shellPatch, rivet, placeAlong, type GearFn } from './common';

export interface KiltEnvelope {
  top: number;
  bottom: number;
  /** point on the kilt at azimuth a (0 = front, + = character's left) and height y, `out` metres outside the cloth */
  point(a: number, y: number, out?: number): THREE.Vector3;
  /** outward normal at azimuth a */
  normal(a: number, y: number): THREE.Vector3;
}

/** `length` and `thickness` as given to the outfit layer (thickness in the layer's own units, × P.s here) */
export function kiltEnvelope(ctx: KindContext, length: number, thickness: number): KiltEnvelope {
  const { P } = ctx;
  const s = P.s;
  const g = P.build.bulk;
  const hips = P.build.hips;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const top = hipY + 0.035 * s;
  const bottom = hipY - (hipY - kneeY) * length * 1.1;
  const grow = thickness * s;
  const rx0 = 0.158 * s * hips * Math.sqrt(g) + 0.012 * s + grow;
  const rz0 = 0.112 * s * Math.sqrt(g) + 0.012 * s + grow;
  const legR = 0.08 * s * g;
  const rx1 = Math.max(rx0, P.hipX + legR + 0.03 * s + grow) + 0.04 * s;
  const rz1 = Math.max(rz0, legR + 0.035 * s + grow) + 0.04 * s * 0.8;
  const H = top - bottom;
  const radii = (y: number): [number, number] => {
    const vv = Math.min(1, Math.max(0, (top - y) / H));
    return [rx0 + (rx1 - rx0) * Math.sqrt(vv), rz0 + (rz1 - rz0) * Math.sqrt(vv)];
  };
  return {
    top,
    bottom,
    point(a, y, out = 0) {
      const [rx, rz] = radii(y);
      return V(Math.sin(a) * (rx + out), y, Math.cos(a) * (rz + out) - 0.01 * s);
    },
    normal(a, y) {
      const [rx, rz] = radii(y);
      return V(Math.sin(a) / rx, 0.25, Math.cos(a) / rz).normalize();
    },
  };
}

export interface KiltPanelOpts {
  bone?: string;
  color: number;
  mat: SurfaceSpec | string;
  /** azimuth range (rad) */
  a0: number;
  a1: number;
  /** length (m) of the panel below the kilt top at u = 0..1 across the panel */
  len: (u: number) => number;
  /** clearance (m) outside the cloth */
  out?: number;
  thick?: number;
  /** rivet rows along the edges (count per edge, 0 = none) */
  rivets?: number;
  rivetColor?: number;
  rivetMat?: SurfaceSpec | string;
  small?: boolean;
}

/** a leather panel hugging the kilt just under the belt */
export function kiltPanel(ctx: KindContext, env: KiltEnvelope, gear: GearFn, o: KiltPanelOpts) {
  const sc = ctx.P.s;
  const out = o.out ?? 0.02 * sc;
  const nu = Math.max(3, Math.round(Math.abs(o.a1 - o.a0) * 7));
  const geo = shellPatch(
    (u, v, p) => {
      const a = o.a0 + (o.a1 - o.a0) * u;
      const y = env.top - 0.004 * sc - v * o.len(u);
      p.p.copy(env.point(a, y, out));
      p.n.copy(env.normal(a, y));
    },
    nu,
    4,
    o.thick ?? 0.006 * sc,
    { noInner: true },
  );
  gear(geo, { bone: o.bone ?? 'hips', color: o.color, mat: o.mat as SurfaceSpec, ao: 0.8, small: o.small });
  const n = o.rivets ?? 0;
  if (n > 0)
    for (const u of [0.1, 0.9])
      for (let i = 0; i < n; i++) {
        const a = o.a0 + (o.a1 - o.a0) * u;
        const y = env.top - 0.012 * sc - ((i + 0.5) / n) * Math.max(0.02 * sc, o.len(u) - 0.02 * sc);
        const nn = env.normal(a, y);
        const p = env.point(a, y, out + 0.006 * sc);
        gear(rivet(0.0058 * sc, 4), { bone: o.bone ?? 'hips', color: o.rivetColor ?? 0x5a4a3c, mat: (o.rivetMat ?? o.mat) as SurfaceSpec, matrix: placeAlong(p, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
}
