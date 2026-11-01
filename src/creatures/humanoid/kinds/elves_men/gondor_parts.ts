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
import { attachSkinned, hairMaterial } from './common';
import { slab } from './garments';
import { mergeAll, put, taperedTube, torsoSection } from './geo';

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
    // long soft folds that deepen towards the hem
    const ang = Math.atan2(pos.getX(i), pos.getZ(i) - zc);
    const fold = Math.sin(ang * 8) * 0.02 * sc * e;
    pos.setX(i, pos.getX(i) + Math.sin(ang) * fold);
    pos.setZ(i, pos.getZ(i) + Math.cos(ang) * fold);
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
 * The White Tree of Gondor as tapered capsules (a trunk, roots and a fan of branches with twigs)
 * laid on the front of the torso at height `cy`; `h` is the tree's height, `thin` scales the stroke radius.
 */
export function treeEmblem(ctx: KindContext, o: { cy: number; h: number; color: number; mat: SurfaceName | SurfaceSpec; inflate: number; thin: number }) {
  const { P } = ctx;
  const h = o.h;
  const base = o.cy - h * 0.5;
  const surf = (x: number, y: number): V3 => {
    const sec = torsoSection(P, y);
    const z0 = (sec.zf + sec.zb) / 2;
    const rz = (sec.zf - sec.zb) / 2;
    const fx = Math.min(0.96, Math.abs(x) / sec.rx);
    return [x, y, z0 + rz * Math.sqrt(1 - fx * fx) + o.inflate];
  };
  const r = (v: number) => v * h * 0.1 * o.thin;
  const geos: THREE.BufferGeometry[] = [];
  const stroke = (pts: [number, number][], r0: number, r1: number) => geos.push(taperedTube(pts.map(([x, y]) => surf(x, y)), r(r0), r(r1), { seg: pts.length * 2, radial: 4 }));
  // trunk and roots
  stroke([[0, base + 0.03 * h], [0, base + 0.2 * h], [0, base + 0.42 * h]], 0.2, 0.1);
  for (const sx of [-1, 1]) stroke([[sx * 0.01 * h, base + 0.07 * h], [sx * 0.07 * h, base + 0.03 * h], [sx * 0.16 * h, base - 0.005 * h]], 0.12, 0.04);
  stroke([[0, base + 0.06 * h], [0, base + 0.01 * h], [0, base - 0.02 * h]], 0.1, 0.04);
  // branches: seven fanned from the top of the trunk
  const fan = [-1.18, -0.82, -0.46, 0, 0.46, 0.82, 1.18];
  fan.forEach((a, k) => {
    const sx = Math.sin(a);
    const cx = Math.cos(a);
    const ys = base + (0.34 + 0.05 * Math.abs(a)) * h;
    const L = h * (0.5 - 0.09 * Math.abs(a));
    const mid: [number, number] = [sx * L * 0.5 * 0.95, ys + cx * L * 0.5];
    const tip: [number, number] = [sx * L * 0.95, ys + cx * L];
    stroke([[sx * 0.02 * h, ys], mid, tip], 0.1, 0.035);
    if (k % 2 === 0 || Math.abs(a) < 0.5) {
      // a twig either side near the tip
      for (const t of [-1, 1]) stroke([mid, [mid[0] + (sx + t * 0.7) * L * 0.2, mid[1] + (cx + t * 0.1) * L * 0.22]], 0.05, 0.02);
    }
  });
  put(ctx, mergeAll(geos), { bone: 'chest', color: o.color, mat: o.mat, small: true });
}

/**
 * The Minas Tirith helm's two tall feathered wings: five flattened-ellipsoid feathers per side, fanned
 * ~9 degrees apart and splayed ~17 degrees outward from the wing-root plates above the temples
 * (head-unit x = ±0.325), about 0.22 m tall; their tips stay apart. The shared helm's own wings are
 * turned down to a stub (`wing: 0.02`) when these are used.
 */
export function helmWings(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const geos: THREE.BufferGeometry[] = [];
  const splay = 0.3;
  for (const sx of [1, -1]) {
    const root = P.h(sx * 0.325, 0.08, 0.02);
    for (let k = 0; k < 5; k++) {
      const phi = (k - 2) * 0.16 - 0.1;
      const up = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
      const dir = new THREE.Vector3(sx * Math.sin(splay) * up.y, Math.cos(splay) * up.y, up.z).normalize();
      const L = (1.3 - 0.07 * Math.abs(k - 2)) * u;
      const n = new THREE.Vector3(sx, 0, 0).addScaledVector(dir, -sx * dir.x).normalize();
      const w = new THREE.Vector3().crossVectors(dir, n).normalize();
      const m = new THREE.Matrix4().makeBasis(n.clone().multiplyScalar(0.012 * u), dir.clone().multiplyScalar(L / 2), w.clone().multiplyScalar(0.19 * u));
      m.setPosition(root[0] + dir.x * L * 0.45, root[1] + dir.y * L * 0.45, root[2] + dir.z * L * 0.45);
      geos.push(new THREE.SphereGeometry(1, 6, 4).applyMatrix4(m));
    }
  }
  put(ctx, mergeAll(geos), { bone: 'head', color: o.color, mat: o.mat, small: true });
}

/**
 * The kit's hair material for exactly this hair colour, matted down: the stock Kajiya-Kay highlight and
 * sheen read as pale blond streaks and gloss on dark hair under sky light. The material is cached per
 * colour (common.hairMaterial), so use a colour no other kind shares.
 */
export function matteHair(color: number): THREE.MeshPhysicalMaterial {
  const m = hairMaterial(color);
  const u = m.userData.hairUniforms as { hairSpec: { value: number }; hairHighlight: { value: THREE.Vector3 } } | undefined;
  m.roughness = 0.88;
  m.specularIntensity = 0.04;
  m.sheen = 0.05;
  if (u) {
    u.hairSpec.value = 0.12;
    u.hairHighlight.value.set(0.3, 0.19, 0.11);
  }
  return m;
}

