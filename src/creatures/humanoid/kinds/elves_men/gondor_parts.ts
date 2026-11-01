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
export function addFlaredCloak(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; length: number; ragged?: number; flareX: number; flareZ: number; mantle?: boolean; hood?: boolean; foldAmp?: number }) {
  const { P, rig, sculpt: s, spec } = ctx;
  const sc = P.s;
  const j = P.j;
  const mat = o.mat ?? 'wool';
  const geo = cloakGeometry(P, rig, { color: o.color, color2: o.color2, mat, length: o.length, ragged: o.ragged, seed: spec.seed ?? 0 });
  const pos = geo.attributes.position;
  const top = j.neck[1] + 0.005 * sc;
  const bottom = P.ankleH + (1 - o.length) * (j.shin_l[1] - P.ankleH) * 1.8;
  const zc = -0.03 * sc;
  // squeeze the last quad row to a 3 cm hem band (the sheet's colour lerps from the row above to the trim row), so the trim is a
  // narrow border rather than a 5-10 cm haze
  {
    const row = 17; // the kit cloak sheet has 16 columns
    const rows = Math.round(pos.count / row);
    // (the kit colours the last two rows (v > 0.96) with the trim: pull the three last rows together)
    for (let iu = 0; iu < row; iu++) {
      const y = pos.getY((rows - 1) * row + iu);
      pos.setY((rows - 2) * row + iu, y + 0.03 * sc);
      pos.setY((rows - 3) * row + iu, y + 0.06 * sc);
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (top - pos.getY(i)) / (top - bottom)));
    const f = Math.min(1, Math.max(0, (t - 0.2) / 0.8));
    const e = f * f * (3 - 2 * f);
    pos.setX(i, pos.getX(i) * (1 + o.flareX * e));
    pos.setZ(i, zc + (pos.getZ(i) - zc) * (1 + o.flareZ * e));
    // long soft folds that deepen towards the hem
    const ang = Math.atan2(pos.getX(i), pos.getZ(i) - zc);
    const fold = Math.sin(ang * 8) * (o.foldAmp ?? 0.02) * sc * e;
    pos.setX(i, pos.getX(i) + Math.sin(ang) * fold);
    pos.setZ(i, pos.getZ(i) + Math.cos(ang) * fold);
  }
  geo.computeVertexNormals();
  // the kit's automatic edge wear lightens a cloth edge to a tan haze on dark wool: keep the border to the trim colour alone
  const seam = geo.attributes.seam;
  if (seam) for (let i = 0; i < seam.count; i++) seam.setX(i, -0.03);
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
}

/**
 * A thick fur collar over the shoulders and upper chest/back (a copy of garments.sculptFurCollar with a finer
 * colour noise, a base/tip two-tone and a closed throat): the shared one's 40 / sc colour noise reads as coarse
 * blotches at game distance.
 */
export function furMantle(ctx: KindContext, o: { color: number; tip: number; thick?: number; drop?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const y0 = P.j.upperarm_l[1] - (o.drop ?? 0.1) * sc;
  s.group('union', 0.006 * sc, () => {
    emitParts(s, parts, ['trap', 'chest', 'back', 'deltoid', 'ribs'], {
      color: o.color,
      color2: o.tip,
      colorNoise: 0.3,
      colorFreq: 220 / sc,
      mat: 'fur',
      k: 0.05 * sc,
      noise: { amp: 0.006 * sc, freq: 60 / sc, type: 'fbm', octaves: 3 },
      inflate: (o.thick ?? 0.032) * sc,
    });
    slab(s, y0, null, 0.02 * sc);
  });
}

/** a round belt medallion (bronze) at the front of the belt */
export function medallion(ctx: KindContext, o: { y: number; z: number; r: number; color: number; mat: SurfaceName | SurfaceSpec; bone?: string }) {
  const g = new THREE.CylinderGeometry(o.r, o.r * 1.05, 0.006 * ctx.P.s, 14).rotateX(Math.PI / 2).translate(0, o.y, o.z);
  put(ctx, g, { bone: o.bone ?? 'hips', color: o.color, mat: o.mat, small: true });
  const r = new THREE.TorusGeometry(o.r * 0.62, 0.0022 * ctx.P.s, 4, 12).translate(0, o.y, o.z + 0.0045 * ctx.P.s);
  put(ctx, r, { bone: o.bone ?? 'hips', color: o.color, mat: o.mat, small: true });
}

/**
 * The White Tree of Gondor as thin tapered capsules laid on the torso front at height `cy`: one contiguous
 * trunk that forks into mirrored branches (three pairs and a leader) with a short twig on the outer pairs.
 * `h` is the tree's height, `thin` scales the stroke radius, `roots` adds the root flare at the foot.
 */
export function treeEmblem(ctx: KindContext, o: { cy: number; h: number; color: number; mat: SurfaceName | SurfaceSpec; inflate: number; thin: number; roots?: boolean }) {
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
  const stroke = (pts: [number, number][], r0: number, r1: number) => geos.push(taperedTube(pts.map(([x, y]) => surf(x, y)), r(r0), r(r1), { seg: pts.length, radial: 4 }));
  // trunk (continuous from the foot to the fork) and the leader
  stroke([[0, base], [0, base + 0.2 * h], [0, base + 0.4 * h]], 0.2, 0.12);
  stroke([[0, base + 0.4 * h], [0, base + 0.7 * h], [0, base + 0.96 * h]], 0.12, 0.03);
  if (o.roots) for (const sx of [-1, 1]) stroke([[0, base + 0.05 * h], [sx * 0.07 * h, base + 0.01 * h], [sx * 0.15 * h, base - 0.01 * h]], 0.1, 0.03);
  // three mirrored branch pairs, each leaving the trunk higher and leaning less
  const pairs: [number, number, number][] = [[0.4, 1.12, 0.46], [0.5, 0.8, 0.42], [0.6, 0.44, 0.36]];
  for (const [yf, lean, len] of pairs) {
    for (const sx of [-1, 1]) {
      const y0 = base + yf * h;
      const dx = Math.sin(lean) * len * h;
      const dy = Math.cos(lean) * len * h;
      const mid: [number, number] = [sx * dx * 0.5, y0 + dy * 0.5];
      const tip: [number, number] = [sx * dx, y0 + dy];
      stroke([[0, y0], mid, tip], 0.1, 0.03);
      if (lean > 0.6) stroke([mid, [mid[0] + sx * 0.1 * h, mid[1] + 0.08 * h]], 0.05, 0.02);
    }
  }
  put(ctx, mergeAll(geos), { bone: 'chest', color: o.color, mat: o.mat, small: true });
}

/**
 * The Minas Tirith helm's two feathered wings (sheet: in the front and back views a narrow, near-vertical crest
 * hugging the side of the helm, its tip only a few cm outside the helm's width; in profile the broad face, a fan
 * of feathers sweeping up and back). So each wing is eight flattened-ellipsoid feathers in a plane parallel to the
 * side of the head (faces pointing left/right), splayed ~7 degrees outward, fanned in the side plane from nearly
 * vertical to nearly horizontal-back, each a little offset sideways so they overlap like layers. Feather
 * half-width is a fraction of the head height `u`. The shared helm's own wings are turned down to a stub
 * (`wing: 0.02`) when these are used. Steel with a dark root and a lighter tip.
 */
export function helmWings(ctx: KindContext, o: { root: number; tip: number; mat: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const geos: THREE.BufferGeometry[] = [];
  const rootC = new THREE.Color().setHex(o.root, THREE.SRGBColorSpace);
  const tipC = new THREE.Color().setHex(o.tip, THREE.SRGBColorSpace);
  const feathers = 8;
  const splay = 0.12;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const sx of [1, -1]) {
    const root = P.h(sx * 0.335, 0.02, -0.08);
    const n = new THREE.Vector3(sx * Math.cos(splay), 0, Math.sin(splay) * 0.2).normalize();
    for (let k = 0; k < feathers; k++) {
      const f = k / (feathers - 1);
      // angle from straight up, toward the back (-z): the top feather leans a little forward
      const phi = -0.05 + 1.2 * f;
      const dir = new THREE.Vector3(sx * Math.sin(splay) * (1 - 0.5 * f), Math.cos(phi), -Math.sin(phi)).normalize();
      const L = (1.55 - 0.5 * f) * u;
      // slight inward curl at the tips: the ellipsoid is straight, so lean the whole feather a touch inward
      const w = new THREE.Vector3().crossVectors(dir, n).normalize();
      const m = new THREE.Matrix4().makeBasis(n.clone().multiplyScalar(0.02 * u), dir.clone().multiplyScalar(L / 2), w.multiplyScalar(0.095 * u));
      const lift = sx * 0.012 * u * (feathers - 1 - k);
      m.setPosition(root[0] + dir.x * L * 0.5 + lift, root[1] + dir.y * L * 0.5, root[2] + dir.z * L * 0.5);
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

/**
 * Tall boots re-emitted over the kit's boot layer (a little thicker, so they win): a mottled shaft up to `top`
 * (fraction of ankle -> knee), a folded cuff band of a different tone, two buckled straps, a dark squared toe
 * cap and a small heel. `calf` widens the calf (0.15 = 15 %).
 */
export function tallBoots(ctx: KindContext, o: { color: number; color2?: number; cuff: number; strap: number; buckle: number; toe: number; top?: number; calf?: number; mat: SurfaceName | SurfaceSpec; metalMat: SurfaceName | SurfaceSpec }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const parts = anatomyParts(P);
  const kneeY = j.shin_l[1];
  const top = P.ankleH + (kneeY - P.ankleH) * (o.top ?? 0.92);
  const mottle = o.color2 !== undefined ? { color2: o.color2, colorNoise: 0.5, colorFreq: 70 / sc } : {};
  s.group('union', 0.0035 * sc, () => {
    emitParts(s, parts, ['foot', 'toes'], { color: o.color, mat: o.mat, inflate: 0.0105 * sc, k: 0.03 * sc, ...mottle });
    emitParts(s, parts, ['shin', 'calf'], { color: o.color, mat: o.mat, inflate: (0.0125 + 0.05 * (o.calf ?? 0)) * sc, k: 0.03 * sc, ...mottle });
    slab(s, null, top, 0.006 * sc, true);
  });
  // squared, darker toe cap and a small heel
  s.mirrored(() => {
    const f = j.foot_l;
    const t = j.toe_l;
    s.ellipsoid([t[0], t[1] + 0.008 * sc, t[2] + 0.028 * sc], [0.046 * sc * P.build.footSize, 0.03 * sc, 0.05 * sc], { color: o.toe, mat: o.mat, bone: 'toe_l', k: 0.01 * sc });
    s.box([f[0], 0.014 * sc, f[2] - 0.034 * sc], [0.04 * sc, 0.014 * sc, 0.036 * sc], 0.008 * sc, { color: o.toe, mat: o.mat, bone: 'foot_l', k: 0.006 * sc });
  });
  const wide = 1 + (o.calf ?? 0);
  for (const sd of ['l', 'r'] as const) {
    const k = j[`shin_${sd}`];
    const f = j[`foot_${sd}`];
    const at = (y: number): V3 => {
      const t = (y - f[1]) / (k[1] - f[1]);
      return [f[0] + (k[0] - f[0]) * t, y, f[2] + (k[2] - f[2]) * t];
    };
    // the folded cuff
    put(ctx, bandAt(at(top - 0.028 * sc), [0, 1, 0], 0.0665 * sc * wide, 0.05 * sc, 14), { bone: `shin_${sd}`, color: o.cuff, mat: o.mat, small: true });
    for (const y of [top - 0.1 * sc, top - 0.175 * sc]) {
      const c = at(y);
      put(ctx, bandAt(c, [0, 1, 0], 0.0605 * sc * wide, 0.022 * sc, 14), { bone: `shin_${sd}`, color: o.strap, mat: o.mat, small: true });
      put(ctx, new THREE.BoxGeometry(0.017 * sc, 0.021 * sc, 0.006 * sc).translate(c[0], c[1], c[2] + 0.064 * sc * wide), { bone: `shin_${sd}`, color: o.buckle, mat: o.metalMat, small: true });
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

