/**
 * Helmets and crowns for the elves_men kinds, all built on the dome/plate helpers in armor.ts.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import type { KindContext } from '../../types';
import { along, instances, leaf, mergeAll, put, studs, taperedTube, tube } from './geo';
import { domePoint, helmDome, nasalGuard, plume, sidePlate, DARK_STEEL, POLISHED, STEEL } from './armor';
import { shade } from './common';

interface HelmCommon {
  color: number;
  trim: number;
  mat?: SurfaceName | SurfaceSpec;
  trimMat?: SurfaceName | SurfaceSpec;
}

/** a tube following the dome's centre meridian, lifted off the surface */
function meridian(o: { tall?: number; clear?: number; point?: number }, from: number, to: number, lift: number, n = 10, azimuth = 0): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (to - from) * (i / n);
    // t in [-1, 1]: negative = front half (a = 0), positive = back (a = π); |t| → polar angle
    const a = t < 0 ? 0 : Math.PI;
    const th = Math.abs(t) * 1.2;
    const p = domePoint(o, a + azimuth, th);
    pts.push([p[0], p[1] + lift * 0.0, p[2]]);
  }
  return pts;
}

/** Rohan helm: round steel cap with a gilt rim, nasal bar, hinged cheek plates and a crest holding a horsehair plume */
export function rohanHelm(ctx: KindContext, o: HelmCommon & { crest: number; rng: Rng; plumeLen?: number; crestHeight?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const dome = { tall: 1.1, point: 0.22, clear: 0.05 };
  helmDome(ctx, { ...dome, color: o.color, trim: o.trim, mat: o.mat ?? STEEL, trimMat: o.trimMat ?? 'gold', rim: 0.1, nape: 0.28 });
  nasalGuard(ctx, { color: o.color, mat: o.mat ?? STEEL, width: 0.03, length: 0.36 });
  // cheek plates
  for (const sx of [1, -1] as const) {
    const g = sidePlate(P, sx, {
      y0: -0.4,
      y1: 0.05,
      z0: -0.04,
      z1: 0.3,
      off: 0.035,
      nY: 5,
      nZ: 4,
      outline: (fy) => [-0.07 + 0.1 * (1 - fy) * (1 - fy), 0.3 - 0.13 * (1 - fy)],
      flare: 0.02,
    });
    put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? STEEL, small: true });
    // gilt edge
    const rimPts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const fy = i / 6;
      const y = -0.4 + 0.45 * fy;
      const zmax = 0.3 - 0.13 * (1 - fy);
      const k = Math.sqrt(Math.max(0.2, 1 - ((zmax + 0.02) / 0.52) ** 2));
      const hw = y >= 0 ? 0.33 : y > -0.15 ? 0.33 : y > -0.3 ? 0.31 - 0.05 * ((-y - 0.15) / 0.15) : Math.max(0.12, 0.26 - 0.2 * ((-y - 0.3) / 0.2));
      rimPts.push(P.h(sx * (hw * k + 0.037 + 0.02 * (1 - fy)), y, zmax));
    }
    put(ctx, tube(rimPts, 0.0055 * u, { seg: 10, radial: 3 }), { bone: 'head', color: o.trim, mat: 'gold', small: true });
  }
  // crest ridge over the dome
  const ridge = meridian({ ...dome }, -0.62, 0.78, 0.0, 14);
  put(ctx, tube(ridge.map((p) => [p[0], p[1], p[2]] as V3).map((p) => [p[0], p[1], p[2]] as V3), 0.018 * u, { seg: 24, radial: 4 }), { bone: 'head', color: o.trim, mat: 'gold', small: true });
  // the plume holder and horsehair
  const hold = domePoint(dome, Math.PI, 0.55);
  put(ctx, new THREE.SphereGeometry(0.03 * u, 6, 4).translate(...P.h(hold[0], hold[1] + 0.01, hold[2] - 0.0)), { bone: 'head', color: o.trim, mat: 'gold', small: true });
  const rnd = () => o.rng.float();
  plume(ctx, { color: o.crest, from: P.h(hold[0], hold[1] + 0.02, hold[2] - 0.03), length: o.plumeLen ?? 1.25, n: 9, spread: 1.1, thick: 1.0, droop: 0.4, mat: surface('wool', { rough: 0.7, pat: { fur: 0.9, weave: 0 } }), rng: rnd });
}

/** Minas Tirith helm: tall polished dome with a high comb, long nasal and cheek plates, a neck guard and two swept-back wings */
export function gondorHelm(ctx: KindContext, o: HelmCommon & { wing?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const dome = { tall: 1.38, point: 0.5, clear: 0.05 };
  helmDome(ctx, { ...dome, color: o.color, trim: o.trim, mat: o.mat ?? POLISHED, trimMat: o.trimMat ?? POLISHED, rim: 0.1, nape: 0.44 });
  nasalGuard(ctx, { color: o.color, mat: o.mat ?? POLISHED, width: 0.036, length: 0.46, wide: 1.3 });
  for (const sx of [1, -1] as const) {
    const g = sidePlate(P, sx, {
      y0: -0.5,
      y1: 0.05,
      z0: -0.1,
      z1: 0.3,
      off: 0.034,
      nY: 6,
      nZ: 4,
      outline: (fy) => [-0.12 + 0.2 * (1 - fy) * (1 - fy), 0.26 - 0.06 * (1 - fy)],
      flare: 0.03,
    });
    put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? POLISHED, small: true });
  }
  // comb: a thin tall fin along the top
  const comb = meridian({ ...dome }, -0.5, 0.95, 0.0, 16);
  const pos: number[] = [];
  const idx: number[] = [];
  const hts = comb.map((_, i) => 0.05 + 0.2 * Math.sin((i / (comb.length - 1)) * Math.PI) ** 0.8);
  comb.forEach((p, i) => {
    const h = hts[i] * u;
    pos.push(p[0] - 0.0035 * u, p[1], p[2], p[0] + 0.0035 * u, p[1], p[2], p[0] - 0.0035 * u, p[1] + h, p[2] - h * 0.15, p[0] + 0.0035 * u, p[1] + h, p[2] - h * 0.15);
  });
  for (let i = 0; i + 1 < comb.length; i++) {
    const a = i * 4;
    const b = a + 4;
    // two faces + top
    idx.push(a, b, a + 2, b, b + 2, a + 2, a + 1, a + 3, b + 1, b + 1, a + 3, b + 3, a + 2, b + 2, a + 3, b + 2, b + 3, a + 3);
  }
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fin.setIndex(idx);
  fin.computeVertexNormals();
  put(ctx, fin, { bone: 'head', color: o.trim, mat: o.trimMat ?? POLISHED, small: true });
  // wings: swept back and up from above the temples
  const wl = (o.wing ?? 1) * 0.62 * u;
  const wing = leaf(wl, 0.085 * u, { droop: 0.05, cup: 0.15, rows: 7, rib: 0.1, pointy: 1.25 });
  const wm: THREE.Matrix4[] = [];
  for (const sx of [1, -1]) {
    const base = P.h(sx * 0.325, 0.06, 0.02);
    wm.push(along(base, [sx * 0.42, 0.62, -0.66], [sx * 0.9, 0.2, 0.4], 1));
  }
  put(ctx, instances(wing, wm), { bone: 'head', color: 0xeeeeea, mat: surface('metal', { rough: 0.22, pat: { scratches: 0.4 } }), small: true });
  // wing root plates
  put(ctx, studs([P.h(0.33, 0.04, 0.02), P.h(-0.33, 0.04, 0.02)], 0.03 * u, 0.8), { bone: 'head', color: o.trim, mat: 'metal', small: true });
}

/** Galadhrim helm: a tall smooth pointed cap with a swept leaf crest and leaf-shaped cheek wings, gold trim */
export function elvenHelm(ctx: KindContext, o: HelmCommon) {
  const { P } = ctx;
  const u = P.headH;
  const dome = { tall: 1.22, point: 0.7, clear: 0.045 };
  helmDome(ctx, { ...dome, color: o.color, trim: o.trim, mat: o.mat ?? POLISHED, trimMat: o.trimMat ?? 'gold', rim: 0.13, nape: 0.18 });
  // leaf crest sweeping back over the top
  const crest = leaf(0.95 * u, 0.1 * u, { droop: -0.12, cup: 0.35, rows: 8, rib: 0.45, pointy: 1.1 });
  const top = domePoint(dome, 0, 0.5);
  put(ctx, instances(crest, [along(P.h(top[0], top[1] + 0.012, top[2] + 0.02), [0, 0.38, -1], [0, 1, 0.4], 1)]), { bone: 'head', color: o.trim, mat: o.trimMat ?? 'gold', small: true });
  // cheek wings: leaf-shaped plates swept back from the temples
  const cw = leaf(0.5 * u, 0.1 * u, { droop: 0.1, cup: 0.5, rows: 6, rib: 0.3 });
  const mats: THREE.Matrix4[] = [];
  for (const sx of [1, -1]) mats.push(along(P.h(sx * 0.37, 0.0, 0.2), [sx * 0.25, -0.75, -0.55], [sx * 1, 0.2, 0.1], 1));
  put(ctx, instances(cw, mats), { bone: 'head', color: o.color, mat: o.mat ?? POLISHED, small: true });
  // brow ornament: a small leaf above the nose
  const bl = leaf(0.16 * u, 0.035 * u, { droop: 0.0, cup: 0.4, rows: 3 });
  put(ctx, instances(bl, [along(P.h(0, 0.12, 0.43), [0, -1, 0.15], [0, 0.1, 1], 1)]), { bone: 'head', color: o.trim, mat: 'gold', small: true });
}

/** simple iron cap (Lake-town guards, soldiers): a round skull cap with a short nasal and a rim band */
export function ironCap(ctx: KindContext, o: HelmCommon & { nasal?: boolean; tall?: number; cheeks?: boolean }) {
  const { P } = ctx;
  helmDome(ctx, { tall: o.tall ?? 0.95, point: 0.1, clear: 0.045, color: o.color, trim: o.trim, mat: o.mat ?? DARK_STEEL, trimMat: o.trimMat ?? o.mat ?? DARK_STEEL, rim: 0.12, nape: 0.12 });
  if (o.nasal !== false) nasalGuard(ctx, { color: o.color, mat: o.mat ?? DARK_STEEL, width: 0.026, length: 0.22 });
  if (o.cheeks) {
    for (const sx of [1, -1] as const) {
      put(ctx, sidePlate(P, sx, { y0: -0.3, y1: 0.05, z0: -0.04, z1: 0.18, off: 0.034, nY: 3, nZ: 3, outline: (fy) => [-0.06, 0.14 + 0.05 * fy] }), { bone: 'head', color: o.color, mat: o.mat ?? DARK_STEEL, small: true });
    }
  }
}

/** a thin circlet with a leaf at the brow (Mirkwood guard without a helm) */
export function leafCirclet(ctx: KindContext, o: { color: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const pts: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(P.h(Math.sin(a) * 0.35, 0.16 - 0.05 * (1 - Math.cos(a)) / 2 * 0.6 - 0.06 * Math.max(0, -Math.cos(a)), -0.055 + Math.cos(a) * 0.45));
  }
  put(ctx, tube(pts, 0.0065 * u, { seg: 40, radial: 4, closed: true }), { bone: 'head', color: o.color, mat: o.mat ?? 'gold', small: true });
  const lf = leaf(0.16 * u, 0.035 * u, { droop: 0, cup: 0.4, rows: 3 });
  put(ctx, instances(lf, [along(P.h(0, 0.15, 0.4), [0, 1, 0.08], [0, 0.1, 1], 1)]), { bone: 'head', color: o.color, mat: o.mat ?? 'gold', small: true });
}

/** a wool cap pulled onto the head (sculpted into the body) */
export function sculptWoolCap(ctx: KindContext, o: { color: number; color2?: number; pull?: number; mat?: SurfaceName | SurfaceSpec; roll?: boolean; droop?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const pull = o.pull ?? 0.1;
  s.group('union', 0.012 * u, () => {
    s.ellipsoid(P.h(0, 0.05, -0.06), [0.355 * u, 0.44 * u, 0.465 * u], { color: o.color, color2: o.color2, colorNoise: o.color2 ? 0.4 : 0, mat: o.mat ?? 'wool', bone: 'head', k: 0.02 * u, noise: { amp: 0.0035 * P.s, freq: 40 / P.s, type: 'ridged', octaves: 2 } });
    // cut below a line from the brow (pull) to the nape
    const n = new THREE.Vector3(0, -1, 0.34).normalize();
    const pnt = P.h(0, pull, 0.43);
    s.plane([n.x, n.y, n.z], n.dot(new THREE.Vector3(...pnt)), { op: 'intersect', k: 0.014 * u });
    s.plane([n.x, n.y, n.z], n.dot(new THREE.Vector3(...pnt)), { op: 'paint', seam: 0, k: 0.002 });
    // keep the ears clear
    s.mirrored(() => s.ellipsoid(P.h(0.335, -0.135, -0.03), [0.07 * u, 0.13 * u, 0.09 * u], { op: 'subtract', k: 0.025 * u }));
  });
  if (o.droop) {
    // a floppy tip hanging at the back
    s.cone(P.h(0, 0.38, -0.2), P.h(0, 0.2, -0.62), 0.09 * u, 0.04 * u, { color: o.color, mat: o.mat ?? 'wool', bone: 'head', k: 0.03 * u });
  }
}

/**
 * Thranduil's crown: a woven band of dark twigs round the brow with antler-like branches rising and
 * sweeping back, hung with autumn-red leaves and berries.
 */
export function twigCrown(ctx: KindContext, o: { rng: Rng; wood?: number; wood2?: number; leaf?: number[]; berry?: number; branches?: number; height?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const s = P.s;
  const rng = o.rng;
  const wood = o.wood ?? 0x3a2a1e;
  const wood2 = o.wood2 ?? 0x6a5844;
  const leafCols = o.leaf ?? [0xb8481c, 0xd0702a, 0x9a2e18, 0xc65a22];
  const branches = o.branches ?? 9;
  const H = o.height ?? 1;
  // woven band: three tubes with phase offsets
  const bandR = 0.35;
  const woven: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const pts: V3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const wob = Math.sin(a * 7 + k * 2.1) * 0.012 + (k - 1) * 0.012;
      const y = 0.185 - 0.05 * Math.max(0, -Math.cos(a)) + wob;
      pts.push(P.h(Math.sin(a) * (bandR + 0.01 * Math.cos(a * 7 + k)), y, -0.055 + Math.cos(a) * 0.455));
    }
    woven.push(tube(pts, 0.0075 * u, { seg: 60, radial: 4, closed: true }));
  }
  put(ctx, mergeAll(woven), { bone: 'head', color: wood, mat: surface('wood', { rough: 0.7, pat: { wrinkles: 1.2 } }), small: true });
  // branches: rise from the band, arc up and back, fork twice
  const twigs: THREE.BufferGeometry[] = [];
  const twigs2: THREE.BufferGeometry[] = [];
  const leaves: THREE.Matrix4[] = [];
  const berries: V3[] = [];
  const leafGeo = leaf(0.085 * u, 0.034 * u, { droop: 0.3, cup: 0.4, rows: 3, rib: 0.3 });
  const addLeaf = (p: V3, dir: V3) => {
    leaves.push(along(p, dir, [rng.range(-1, 1), 0.3, rng.range(-1, 1)], rng.range(0.8, 1.3)));
  };
  for (let b = 0; b < branches; b++) {
    const a = -Math.PI * 0.55 + (b / (branches - 1)) * Math.PI * 1.1 + rng.range(-0.08, 0.08);
    // a: azimuth from the back (0) around: sides get taller, the front shorter
    const az = a + Math.PI; // start behind
    const sx = Math.sin(az);
    const cz = Math.cos(az);
    const front = Math.max(0, cz); // 1 at the front
    const hgt = (0.34 + 0.2 * rng.float() - 0.13 * front) * H;
    const root: V3 = P.h(sx * bandR, 0.19, -0.055 + cz * 0.455);
    const lean: V3 = [sx * 0.2 * u, 0, -0.18 * u - cz * 0.04 * u];
    const mid: V3 = [root[0] + lean[0] * 0.9, root[1] + hgt * u * 0.5, root[2] + lean[2] * 0.7];
    const tip: V3 = [root[0] + lean[0] * 1.9 + sx * 0.04 * u, root[1] + hgt * u, root[2] + lean[2] * 1.7 - 0.06 * u];
    const pts: V3[] = [root, mid, tip];
    twigs.push(taperedTube(pts, 0.0105 * u, 0.0035 * u, { seg: 10, radial: 4 }));
    // forks
    for (let f = 0; f < 2; f++) {
      const t = 0.45 + f * 0.25;
      const base: V3 = [root[0] + (tip[0] - root[0]) * t, root[1] + (tip[1] - root[1]) * t, root[2] + (tip[2] - root[2]) * t];
      const side = f % 2 ? -1 : 1;
      const end: V3 = [base[0] + (side * 0.14 + sx * 0.08) * u, base[1] + 0.12 * u, base[2] - 0.1 * u];
      twigs2.push(taperedTube([base, [(base[0] + end[0]) / 2 + side * 0.02 * u, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2], end], 0.0055 * u, 0.0024 * u, { seg: 6, radial: 3 }));
      if (rng.float() < 0.7) addLeaf(end, [end[0] - base[0], end[1] - base[1], end[2] - base[2]]);
      if (rng.float() < 0.5) berries.push([end[0] + 0.004 * u, end[1] - 0.01 * u, end[2]]);
    }
    if (rng.float() < 0.75) addLeaf(tip, [tip[0] - mid[0], tip[1] - mid[1], tip[2] - mid[2]]);
    // a leaf mid-way
    if (rng.float() < 0.6) addLeaf([mid[0], mid[1], mid[2]], [sx * 0.7, 0.5, 0.2]);
    if (rng.float() < 0.45) berries.push([tip[0], tip[1] - 0.012 * u, tip[2]]);
  }
  put(ctx, mergeAll(twigs), { bone: 'head', color: wood, mat: surface('wood', { rough: 0.72, pat: { wrinkles: 1.4 } }), small: true });
  put(ctx, mergeAll(twigs2), { bone: 'head', color: wood2, mat: surface('wood', { rough: 0.72, pat: { wrinkles: 1.4 } }), small: true });
  // leaves in mixed autumn colours
  leafCols.forEach((c, ci) => {
    const sub = leaves.filter((_, i) => i % leafCols.length === ci);
    if (sub.length) put(ctx, instances(leafGeo, sub), { bone: 'head', color: c, mat: surface('cloth', { rough: 0.7, sheen: 0.2, pat: { weave: 0 } }), small: true });
  });
  if (berries.length) put(ctx, studs(berries, 0.0095 * u, 1), { bone: 'head', color: 0x9a1c1c, mat: surface('lips', { rough: 0.3 }), small: true });
  void shade;
  void s;
}
