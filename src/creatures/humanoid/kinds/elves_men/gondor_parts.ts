/**
 * Parts for the Gondor kind that the shared elves_men helpers do not offer: a flared cloak, the
 * Horn of Gondor with its bands, and a round belt medallion.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { cloakGeometry } from '../../cloth';
import { anatomyParts, emitParts } from '../../anatomy';
import type { KindContext } from '../../types';
import { attachSkinned } from './common';
import { slab } from './garments';
import { along, leaf, mergeAll, put, taperedTube } from './geo';

/**
 * The kit's cloak sheet, widened towards the hem (an A-line cloak that falls clear of the legs)
 * and attached as a skinned extra; the shoulder mantle is sculpted into the body.
 * `flareX` / `flareZ` are the extra fractions of the sheet's width / depth at the hem.
 */
export function addFlaredCloak(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; length: number; ragged?: number; flareX: number; flareZ: number; mantle?: boolean }) {
  const { P, rig, sculpt: s, spec } = ctx;
  const sc = P.s;
  const j = P.j;
  const mat = o.mat ?? 'wool';
  const geo = cloakGeometry(P, rig, { color: o.color, color2: o.color2, mat, length: o.length, ragged: o.ragged, seed: spec.seed ?? 0 });
  const pos = geo.attributes.position;
  const top = j.neck[1] + 0.005 * sc;
  const bottom = P.ankleH + (1 - o.length) * (j.shin_l[1] - P.ankleH) * 1.8;
  const zc = -0.03 * sc;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (top - pos.getY(i)) / (top - bottom)));
    const f = Math.min(1, Math.max(0, (t - 0.2) / 0.8));
    const e = f * f * (3 - 2 * f);
    pos.setX(i, pos.getX(i) * (1 + o.flareX * e));
    pos.setZ(i, zc + (pos.getZ(i) - zc) * (1 + o.flareZ * e));
  }
  geo.computeVertexNormals();
  attachSkinned(ctx, geo, 'body', { small: false, name: 'cloak' });
  if (o.mantle !== false) {
    const parts = anatomyParts(P);
    s.group('union', 0.004 * sc, () => {
      emitParts(s, parts, ['trap', 'back'], { color: o.color, mat, k: 0.04 * sc, inflate: 0.02 * sc });
      slab(s, j.upperarm_l[1] - 0.05 * sc, null, 0.01 * sc);
      s.plane([0, 0, 1], 0.02 * sc, { op: 'intersect', k: 0.02 * sc });
    });
  }
}

/** an open metal band round a path point: a short cylinder along `dir` */
export function bandAt(p: V3, dir: V3, r: number, h: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** the Horn of Gondor: a pale carved horn hanging at the hip, a wide silver mouth band, a bronze band and a silver tip */
export function hornOfGondor(ctx: KindContext, o: { side: 1 | -1; ivory: number; silver: number; bronze: number; leather: number; metalMat: SurfaceName | SurfaceSpec; leatherMat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const sd = o.side;
  const cx = sd * (P.hipX + 0.1 * sc);
  const hy = hipY + 0.0 * sc;
  // from the narrow tip (t = 0, hanging forward at the thigh) up to the wide mouth (t = 1, at the belt)
  const pts: V3[] = [
    [cx + sd * 0.02 * sc, hy - 0.2 * sc, 0.085 * sc],
    [cx + sd * 0.012 * sc, hy - 0.05 * sc, 0.1 * sc],
    [cx, hy + 0.1 * sc, 0.085 * sc],
    [cx - sd * 0.01 * sc, hy + 0.2 * sc, 0.05 * sc],
  ];
  put(ctx, taperedTube(pts, 0.014 * sc, 0.056 * sc, { seg: 10, radial: 6 }), { bone: 'hips', color: o.ivory, mat: 'bone', small: true });
  // bands along the same curve
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.4);
  const at = (t: number): { p: V3; d: V3; r: number } => {
    const p = curve.getPointAt(t);
    const d = curve.getTangentAt(t);
    return { p: [p.x, p.y, p.z], d: [d.x, d.y, d.z], r: (0.014 + (0.056 - 0.014) * t) * sc };
  };
  const mouth = at(0.985);
  put(ctx, bandAt(mouth.p, mouth.d, mouth.r * 1.12, 0.036 * sc, 12), { bone: 'hips', color: o.silver, mat: o.metalMat, small: true });
  const mid = at(0.62);
  put(ctx, bandAt(mid.p, mid.d, mid.r * 1.14, 0.022 * sc, 10), { bone: 'hips', color: o.bronze, mat: o.metalMat, small: true });
  const tip = at(0.05);
  put(ctx, bandAt(tip.p, tip.d, tip.r * 1.25, 0.03 * sc, 8), { bone: 'hips', color: o.silver, mat: o.metalMat, small: true });
  // the strap: a leather loop from the mouth band up to the baldric
  const m1 = at(0.9);
  const strap: V3[] = [m1.p, [m1.p[0] + sd * 0.01 * sc, m1.p[1] + 0.08 * sc, m1.p[2] - 0.02 * sc], [m1.p[0] - sd * 0.02 * sc, m1.p[1] + 0.2 * sc, m1.p[2] - 0.045 * sc]];
  put(ctx, taperedTube(strap, 0.006 * sc, 0.006 * sc, { seg: 6, radial: 4 }), { bone: 'hips', color: o.leather, mat: o.leatherMat, small: true });
}

/** a round belt medallion (bronze) at the front of the belt */
export function medallion(ctx: KindContext, o: { y: number; z: number; r: number; color: number; mat: SurfaceName | SurfaceSpec }) {
  const g = new THREE.CylinderGeometry(o.r, o.r * 1.05, 0.006 * ctx.P.s, 14).rotateX(Math.PI / 2).translate(0, o.y, o.z);
  put(ctx, g, { bone: 'hips', color: o.color, mat: o.mat, small: true });
  const r = new THREE.TorusGeometry(o.r * 0.62, 0.0022 * ctx.P.s, 4, 12).translate(0, o.y, o.z + 0.0045 * ctx.P.s);
  put(ctx, r, { bone: 'hips', color: o.color, mat: o.mat, small: true });
}

/**
 * The Minas Tirith helm's two tall feathered wings (sheet: slender, standing nearly upright and
 * a little back from above the temples, ~0.25 m over the crown), as three overlapping feathers each.
 * The shared helm's own wings are turned down to a stub (`wing: 0.02`) when these are used.
 */
export function helmWings(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const feather = leaf(1, 0.17, { droop: 0.1, cup: 0.15, rows: 5, rib: 0.1, pointy: 1.3 });
  const geos: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const base = P.h(sx * 0.4, 0.08, 0.0);
    for (let k = 0; k < 2; k++) {
      const len = (1.35 - 0.3 * k) * u;
      const dir: V3 = [sx * (0.18 + 0.14 * k), 1.0 - 0.08 * k, -0.2 - 0.12 * k];
      const m = along([base[0] + sx * 0.03 * u * k, base[1] - 0.05 * u * k, base[2]], dir, [sx, 0.1, 0.12], 1);
      geos.push(feather.clone().scale(u, len, 1).applyMatrix4(m));
    }
  }
  put(ctx, mergeAll(geos), { bone: 'head', color: o.color, mat: o.mat, small: true });
}
