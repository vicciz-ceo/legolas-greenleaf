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
export function addFlaredCloak(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; length: number; ragged?: number; flareX: number; flareZ: number; mantle?: boolean; hood?: boolean }) {
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
  if (o.hood) {
    // a small hood bunched at the back of the neck
    s.group('union', 0.02 * sc, () => {
      s.ellipsoid([0, j.neck[1] - 0.03 * sc, -0.085 * sc], [0.085 * sc, 0.07 * sc, 0.06 * sc], { color: o.color, mat, bone: 'chest', k: 0.03 * sc });
    });
  }
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
export function hornOfGondor(ctx: KindContext, o: { side: 1 | -1; mouthY: number; ivory: number; silver: number; bronze: number; leather: number; metalMat: SurfaceName | SurfaceSpec; leatherMat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const sc = P.s;
  const sd = o.side;
  const cx = sd * (P.hipX + 0.1 * sc);
  const my = o.mouthY;
  // from the narrow tip (t = 0, curling forward at the thigh) up to the wide mouth (t = 1, at the belt)
  const pts: V3[] = [
    [cx + sd * 0.035 * sc, my - 0.255 * sc, 0.09 * sc],
    [cx + sd * 0.022 * sc, my - 0.17 * sc, 0.115 * sc],
    [cx + sd * 0.008 * sc, my - 0.085 * sc, 0.105 * sc],
    [cx - sd * 0.008 * sc, my, 0.062 * sc],
  ];
  put(ctx, taperedTube(pts, 0.012 * sc, 0.05 * sc, { seg: 10, radial: 6 }), { bone: 'hips', color: o.ivory, mat: 'bone', small: true });
  // bands along the same curve
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.4);
  const at = (t: number): { p: V3; d: V3; r: number } => {
    const p = curve.getPointAt(t);
    const d = curve.getTangentAt(t);
    return { p: [p.x, p.y, p.z], d: [d.x, d.y, d.z], r: (0.012 + (0.05 - 0.012) * t) * sc };
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
    if (Math.abs(a) < 0.5) {
      // a twig either side near the tip
      for (const t of [-1, 1]) stroke([mid, [mid[0] + (sx + t * 0.7) * L * 0.2, mid[1] + (cx + t * 0.1) * L * 0.22]], 0.05, 0.02);
    }
  });
  put(ctx, mergeAll(geos), { bone: 'chest', color: o.color, mat: o.mat, small: true });
}

/**
 * The Minas Tirith helm's two tall feathered wings: seven overlapping flattened-ellipsoid feathers per
 * side, their wide faces turned forward and out (so they show in the front and back views, not edge-on),
 * fanned inside the wing plane and splayed ~0.3 rad from the wing-root plates above the temples
 * (head-unit x = ±0.325); pewter with a darker root and a lighter tip. The shared helm's own wings are
 * turned down to a stub (`wing: 0.02`) when these are used.
 */
export function helmWings(ctx: KindContext, o: { root: number; tip: number; mat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const geos: THREE.BufferGeometry[] = [];
  const rootC = new THREE.Color().setHex(o.root, THREE.SRGBColorSpace);
  const tipC = new THREE.Color().setHex(o.tip, THREE.SRGBColorSpace);
  const feathers = 6;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const sx of [1, -1]) {
    const root = P.h(sx * 0.325, 0.08, 0.02);
    // wing-plane normal: the wide face looks forward and outward (about 0.65 rad from the lateral axis)
    const n = new THREE.Vector3(sx * Math.cos(0.65), 0, Math.sin(0.65)).normalize();
    const base = new THREE.Vector3(sx * Math.sin(0.3), Math.cos(0.3), -0.1).normalize();
    for (let k = 0; k < feathers; k++) {
      const fan = (k - (feathers - 1) / 2) * 0.115;
      const dir = base.clone().applyAxisAngle(n, fan).normalize();
      const L = (1.45 - 0.06 * Math.abs(k - 3)) * u;
      const w = new THREE.Vector3().crossVectors(dir, n).normalize();
      const m = new THREE.Matrix4().makeBasis(n.clone().multiplyScalar(0.01 * u), dir.clone().multiplyScalar(L / 2), w.multiplyScalar(0.035));
      m.setPosition(root[0] + dir.x * L * 0.46, root[1] + dir.y * L * 0.46, root[2] + dir.z * L * 0.46);
      geos.push(new THREE.SphereGeometry(1, 6, 4).applyMatrix4(m));
      y0 = Math.min(y0, root[1]);
      y1 = Math.max(y1, root[1] + dir.y * L);
    }
  }
  const col = new THREE.Color();
  put(ctx, mergeAll(geos), {
    bone: 'head',
    color: 0xffffff,
    mat: o.mat,
    small: true,
    colorFn: (p, _n, c) => {
      const t = Math.min(1, Math.max(0, (p.y - y0) / Math.max(1e-4, y1 - y0)));
      c.copy(col.copy(rootC).lerp(tipC, t));
    },
  });
}

/** boots in the captain's brown (the kit boot layer is the soldiers' dark brown), with two buckled straps on each calf */
export function captainBoots(ctx: KindContext, o: { color: number; strap: number; buckle: number; mat: SurfaceName | SurfaceSpec; metalMat: SurfaceName | SurfaceSpec }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const kneeY = P.j.shin_l[1];
  const top = P.ankleH + (kneeY - P.ankleH) * 0.92;
  s.group('union', 0.0035 * sc, () => {
    emitParts(s, parts, ['foot', 'toes'], { color: o.color, mat: o.mat, inflate: 0.0095 * sc, k: 0.03 * sc });
    emitParts(s, parts, ['shin', 'calf'], { color: o.color, mat: o.mat, inflate: 0.0115 * sc, k: 0.03 * sc });
    slab(s, null, top, 0.006 * sc, true);
  });
  for (const sd of ['l', 'r'] as const) {
    const k = P.j[`shin_${sd}`];
    const f = P.j[`foot_${sd}`];
    const at = (y: number): V3 => {
      const t = (y - f[1]) / (k[1] - f[1]);
      return [f[0] + (k[0] - f[0]) * t, y, f[2] + (k[2] - f[2]) * t];
    };
    for (const y of [top - 0.055 * sc, top - 0.135 * sc]) {
      const c = at(y);
      put(ctx, bandAt(c, [0, 1, 0], 0.0585 * sc, 0.022 * sc, 12), { bone: `shin_${sd}`, color: o.strap, mat: o.mat, small: true });
      put(ctx, new THREE.BoxGeometry(0.016 * sc, 0.02 * sc, 0.006 * sc).translate(c[0], c[1], c[2] + 0.062 * sc), { bone: `shin_${sd}`, color: o.buckle, mat: o.metalMat, small: true });
    }
  }
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

