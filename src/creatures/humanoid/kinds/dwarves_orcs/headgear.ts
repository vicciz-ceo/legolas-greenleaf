/**
 * Headgear: soft hats, domed helmets with bands/ridges/cheek plates/crests, face masks, turbans.
 * Everything is rigid gear on the head bone (merged into the body draw call).
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { arcPlate, lathe, mergeAll, put, spike, studs, taperedTube, tube } from './armor';

/** hammered steel that reads grey in studio light and in shade */
export const STEEL = surface('metal_dark', { rough: 0.46, metal: 0.8 });
export const IRON = surface('metal_rusty', { rough: 0.62, metal: 0.7 });
export const BRONZE = surface('gold', { rough: 0.38 });

export interface HatOpts {
  color: number;
  color2?: number;
  /** crown height above the head crown (head units) */
  crown?: number;
  /** brim radius (head units) */
  brim?: number;
  /** how far the brim droops (head units) */
  droop?: number;
  /** crown tip bends backward (head units) */
  lean?: number;
  /** crown tip point: 0 = round, 1 = pointed */
  point?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** raise or lower the hat on the head (head units) */
  y?: number;
  /** floppiness variation seed */
  seed?: number;
  /** band colour (null = none) */
  band?: number | null;
}

/** a soft felt hat: crown, folded brim, floppy droop; double-sided */
export function floppyHat(ctx: KindContext, o: HatOpts) {
  const { P } = ctx;
  const u = P.headH;
  const h = P.h;
  const crown = o.crown ?? 0.6;
  const brim = o.brim ?? 0.66;
  const droop = o.droop ?? 0.2;
  const lean = o.lean ?? 0.25;
  const point = o.point ?? 0.6;
  const seed = o.seed ?? 1;
  const nv = 16;
  const nph = 30;
  const pos: number[] = [];
  const idx: number[] = [];
  const Rh = 0.4; // radius at the head
  const zScale = 1.14;
  const zOff = -0.06;
  const y0 = (o.y ?? 0.1) + 0.0;
  const vc = 0.62;
  for (let i = 0; i <= nv; i++) {
    const v = i / nv;
    for (let j = 0; j <= nph; j++) {
      const ph = (j / nph) * Math.PI * 2;
      let r: number, y: number, zl = 0;
      if (v <= vc) {
        // crown: from the tip (v=0) to the head ring (v=vc)
        const t = v / vc; // 0 tip … 1 ring
        r = Rh * (point > 0 ? Math.pow(t, 0.5 + 0.9 * (1 - point) * 0.5 + 0.4 * point * 0.0) : Math.sin(t * Math.PI * 0.5));
        r = Rh * Math.pow(t, 1 - 0.45 * point + 0.0) * (1 + 0.1 * Math.sin(t * Math.PI));
        y = y0 + crown * Math.pow(1 - t, 1.0 + 0.5 * point) * 0.9 + 0.0;
        zl = -lean * Math.pow(1 - t, 1.5);
        y += 0.1 * Math.sin(t * Math.PI);
      } else {
        // brim: radius grows, y drops
        const t = (v - vc) / (1 - vc);
        r = Rh + (brim - Rh) * Math.pow(t, 0.85);
        const floppy = 0.5 + 0.5 * Math.sin(ph * 2 + seed * 1.7) * Math.cos(ph * 1 + seed);
        y = y0 - droop * Math.pow(t, 1.7) * (0.55 + 0.9 * floppy) + 0.03 * Math.sin(t * 6 + ph * 3);
        // front brim turns up a little, back drops
        y += 0.06 * Math.cos(ph) * t;
      }
      const x = Math.sin(ph) * r;
      const z = Math.cos(ph) * r * zScale + zOff + zl;
      const q = h(x, y, z);
      pos.push(q[0], q[1], q[2]);
    }
  }
  for (let i = 0; i < nv; i++) {
    for (let j = 0; j < nph; j++) {
      const a = i * (nph + 1) + j;
      const b = a + nph + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const c2 = o.color2 ?? o.color;
  const cc = new THREE.Color();
  const ca = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const cb = new THREE.Color().setHex(c2, THREE.SRGBColorSpace);
  const base = o.color;
  void base;
  put(ctx, g, {
    bone: 'head',
    color: o.color,
    mat: o.mat ?? 'wool',
    colorFn: (p, _n, c) => {
      // sun-faded top, darker underside of the brim
      const f = Math.min(1, Math.max(0, (p.y - (P.headC[1] + 0.2 * u)) / (0.5 * u)));
      cc.copy(ca).lerp(cb, f * 0.6);
      c.copy(cc);
    },
  });
  if (o.band !== null) {
    const bc = o.band ?? 0x2a2018;
    const ring = new THREE.TorusGeometry(Rh * 1.02 * u, 0.028 * u, 5, 28).rotateX(Math.PI / 2).scale(1, 1, zScale);
    ring.translate(...h(0, y0 + 0.02, zOff));
    put(ctx, ring, { bone: 'head', color: bc, mat: 'leather_worn', small: true });
  }
}

export interface DomeHelmOpts {
  color: number;
  trim?: number;
  mat?: SurfaceName | SurfaceSpec;
  trimMat?: SurfaceName | SurfaceSpec;
  /** profile points (radius, y) in head units, rim first */
  profile?: [number, number][];
  /** tilt forward (rad, negative = front up) */
  tilt?: number;
  /** raise on the head (head units) */
  y?: number;
  zScale?: number;
  band?: boolean;
  ridge?: boolean;
  rivets?: number;
  cheeks?: boolean;
  nasal?: boolean;
  /** neck guard (mail / plates) hanging behind */
  neck?: 'mail' | 'plates' | null;
  finial?: 'spike' | 'ball' | null;
  /** brow band width */
  bandWidth?: number;
}

export const DOME_ROUND: [number, number][] = [
  [0.4, -0.04], [0.405, 0.03], [0.392, 0.12], [0.36, 0.22], [0.31, 0.32], [0.24, 0.41], [0.16, 0.48], [0.08, 0.53], [0.0, 0.55],
];
export const DOME_POINTED: [number, number][] = [
  [0.4, -0.04], [0.405, 0.03], [0.392, 0.12], [0.36, 0.22], [0.305, 0.32], [0.235, 0.41], [0.155, 0.48], [0.085, 0.53], [0.04, 0.565], [0.016, 0.59], [0.0, 0.605],
];
export const DOME_CONICAL: [number, number][] = [
  [0.4, -0.04], [0.405, 0.02], [0.39, 0.12], [0.345, 0.24], [0.28, 0.36], [0.2, 0.5], [0.12, 0.62], [0.06, 0.72], [0.025, 0.8], [0.0, 0.85],
];

/** a domed helmet shell with optional rim band, ridge, rivets, cheek plates and neck guard */
export function domeHelm(ctx: KindContext, o: DomeHelmOpts) {
  const { P } = ctx;
  const u = P.headH;
  const trim = o.trim ?? o.color;
  const mat = o.mat ?? STEEL;
  const tilt = new THREE.Matrix4().makeRotationX(o.tilt ?? -0.1);
  const centre = P.h(0, 0.075 + (o.y ?? 0), -0.06);
  const zs = o.zScale ?? 1.28;
  const place = new THREE.Matrix4().makeTranslation(centre[0], centre[1], centre[2]).multiply(tilt).multiply(new THREE.Matrix4().makeScale(1, 1, zs));
  const prof = (o.profile ?? DOME_POINTED).map(([r, y]) => [r * u, y * u] as [number, number]);
  put(ctx, lathe(prof, 28), { bone: 'head', color: o.color, mat, matrix: place, ao: 0.95 });
  const bw = o.bandWidth ?? 1;
  if (o.band !== false) {
    const band = lathe([[0.42 * u, -0.07 * u * bw], [0.44 * u, -0.05 * u * bw], [0.445 * u, 0.0], [0.425 * u, 0.055 * u * bw], [0.405 * u, 0.06 * u * bw], [0.4 * u, 0.0], [0.4 * u, -0.05 * u * bw]], 28);
    put(ctx, band, { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, matrix: place });
  }
  if (o.ridge !== false) {
    const up = prof.slice(1);
    const pts: V3[] = [];
    for (let i = 0; i < up.length; i++) pts.push([0, up[i][1] + 0.006 * u, up[i][0] + 0.01 * u]);
    for (let i = up.length - 1; i >= 0; i--) pts.push([0, up[i][1] + 0.006 * u, -(up[i][0] + 0.01 * u)]);
    put(ctx, tube(pts, 0.016 * u, { seg: 40, radial: 5 }), { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, matrix: place });
  }
  const nr = o.rivets ?? 26;
  if (nr > 0) {
    const rv: V3[] = [];
    for (let i = 0; i < nr; i++) {
      const a = (i / nr) * Math.PI * 2;
      rv.push([Math.sin(a) * 0.428 * u, 0.0, Math.cos(a) * 0.428 * u]);
    }
    const rg = studs(rv, 0.012 * u, 0.8);
    if (rg) put(ctx, rg, { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, matrix: place, small: true });
  }
  const top = prof[prof.length - 1];
  if (o.finial === 'ball') put(ctx, new THREE.SphereGeometry(0.03 * u, 8, 6).translate(0, top[1] + 0.01 * u, 0), { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, matrix: place, small: true });
  if (o.finial === 'spike') put(ctx, new THREE.ConeGeometry(0.022 * u, 0.12 * u, 6).translate(0, top[1] + 0.05 * u, 0), { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, matrix: place, small: true });
  if (o.cheeks !== false) {
    for (const sx of [1, -1]) {
      const plate = arcPlate(0.375 * u, 0.26 * u, 1.0, sx > 0 ? 0 : Math.PI, 10);
      plate.translate(...P.h(0, -0.15 + (o.y ?? 0), -0.03));
      put(ctx, plate, { bone: 'head', color: o.color, mat, small: true });
      const tr = arcPlate(0.381 * u, 0.02 * u, 1.0, sx > 0 ? 0 : Math.PI, 10).translate(...P.h(0, -0.285 + (o.y ?? 0), -0.03));
      put(ctx, tr, { bone: 'head', color: trim, mat: o.trimMat ?? BRONZE, small: true });
    }
  }
  if (o.nasal) {
    const nasal = new THREE.BoxGeometry(0.05 * u, 0.3 * u, 0.012 * u).translate(0, -0.11 * u, 0);
    put(ctx, nasal, { bone: 'head', color: o.color, mat, matrix: new THREE.Matrix4().makeTranslation(...P.h(0, 0.09 + (o.y ?? 0), 0.5)).multiply(new THREE.Matrix4().makeRotationX(-0.12)), small: true });
  }
  if (o.neck) {
    const m = o.neck === 'mail' ? 'mail' : STEEL;
    const g = arcPlate(0.43 * u, 0.3 * u, Math.PI * 1.3, Math.PI, 14);
    g.scale(1, 1, 1.1);
    g.translate(...P.h(0, -0.2 + (o.y ?? 0), -0.06));
    put(ctx, g, { bone: 'head', color: o.neck === 'mail' ? 0x77766f : o.color, mat: m, small: true });
  }
}

void mergeAll;
void spike;

/** a pair of curved horns growing from the temples */
export function hornPair(ctx: KindContext, o: { color: number; length?: number; curl?: number; y?: number; z?: number; thick?: number; mat?: SurfaceName | SurfaceSpec; lift?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const L = (o.length ?? 0.7) * u;
  const curl = o.curl ?? 0.5;
  const y = o.y ?? 0.15;
  const z = o.z ?? -0.05;
  for (const sd of [1, -1]) {
    const pts: V3[] = [
      P.h(sd * 0.36, y, z),
      P.h(sd * 0.5, y + 0.08, z - 0.02),
      P.h(sd * (0.6 + 0.2 * curl), y + 0.26 + 0.1 * (1 - curl), z + 0.02 * curl),
      P.h(sd * (0.58 + 0.3 * curl), y + 0.42 + L / u * 0.4, z + 0.12 * curl + 0.04),
    ];
    put(ctx, taperedTube(pts, (o.thick ?? 0.05) * u, 0.008 * u, { seg: 12, radial: 5 }), { bone: 'head', color: o.color, mat: o.mat ?? 'horn', small: true });
  }
}

export interface MaskOpts {
  color: number;
  trim?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** distance in front of the skin (head units) */
  lift?: number;
  /** eye slit: y range (head units) of the gap between the upper and lower plates */
  slit?: [number, number];
  /** brow/forehead plate top (head units) */
  top?: number;
  /** chin bottom (head units) */
  bottom?: number;
  /** half width of the plates at the cheeks (head units) */
  half?: number;
  /** nose bump height (head units) */
  nose?: number;
  /** mouth grill slits */
  mouth?: boolean;
}

/** a stylised face mask (golden Easterling faceplate): forehead + nose bridge, cheek/mouth plate, eye slits between */
export function faceMask(ctx: KindContext, o: MaskOpts) {
  const { P } = ctx;
  const h = P.h;
  const lift = o.lift ?? 0.04;
  const slit = o.slit ?? [-0.115, -0.015];
  const top = o.top ?? 0.13;
  const bottom = o.bottom ?? -0.6;
  const half = o.half ?? 0.3;
  const noseH = o.nose ?? 0.1;
  const mat = o.mat ?? 'gold';
  const surfZ = (x: number, y: number): number => {
    const ax = Math.min(1, Math.abs(x) / 0.36);
    let z = 0.405 - 0.52 * ax * ax;
    if (y > 0.1) z -= 0.12 * Math.min(1, (y - 0.1) / 0.3);
    if (y < -0.18) z -= 0.05 * Math.min(1, (-y - 0.18) / 0.3) * (1 - ax) - 0.12 * Math.min(1, (-y - 0.3) / 0.3) * ax;
    // nose and brow bulge
    const nb = Math.exp(-((x / 0.075) ** 2)) * Math.min(1, Math.max(0, (0.0 - y) / 0.12)) * Math.min(1, Math.max(0, (y + 0.3) / 0.06));
    z += noseH * nb + 0.2 * Math.exp(-((x / 0.04) ** 2)) * Math.exp(-(((y + 0.27) / 0.05) ** 2)) * 0;
    return z + lift;
  };
  const patch = (xHalf: (y: number) => number, y0: number, y1: number, nx: number, ny: number, tint?: number): THREE.BufferGeometry => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= ny; j++) {
      const y = y0 + (y1 - y0) * (j / ny);
      const hw = xHalf(y);
      for (let i = 0; i <= nx; i++) {
        const x = -hw + (2 * hw * i) / nx;
        const q = h(x, y, surfZ(x, y));
        pos.push(q[0], q[1], q[2]);
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + nx + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    void tint;
    return g;
  };
  // forehead / brow plate
  put(ctx, patch((y) => half * (0.95 - 0.35 * Math.max(0, (y - 0.0) / 0.3)), slit[1], top, 8, 4), { bone: 'head', color: o.color, mat, small: true });
  // nose bridge down the middle through the slit
  put(ctx, patch(() => 0.05, slit[0], slit[1], 2, 2), { bone: 'head', color: o.color, mat, small: true });
  // cheeks, mouth and chin
  put(ctx, patch((y) => half * (1.0 - 0.7 * Math.max(0, (slit[0] - y) / 0.5)), bottom, slit[0], 10, 8), { bone: 'head', color: o.color, mat, small: true });
  // rim lines: slit edges and mouth grill
  const rim = o.trim ?? o.color;
  const edge = (y: number, hw: number, r: number) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 8; i++) {
      const x = -hw + (2 * hw * i) / 8;
      pts.push(h(x, y, surfZ(x, y) + 0.004));
    }
    put(ctx, tube(pts, r * P.headH, { seg: 14, radial: 4 }), { bone: 'head', color: rim, mat, small: true });
  };
  edge(slit[0], half * 0.95, 0.008);
  edge(slit[1], half * 0.9, 0.008);
  if (o.mouth !== false) {
    for (const y of [-0.4, -0.45, -0.5]) edge(y, 0.1, 0.005);
  }
}

/** wrapped cloth head covering (turban): layered torus bands + a cap, sculpted into the body */
export function sculptTurban(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName; y?: number; height?: number; thick?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const y0 = o.y ?? 0.1;
  const th = (o.thick ?? 0.07) * u;
  const mat = o.mat ?? 'cloth';
  s.with({ color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.5 : 0, colorFreq: 20 / P.s, mat, bone: 'head', noise: { amp: 0.0035 * P.s, freq: 36 / P.s, type: 'ridged', octaves: 2 } }, () => {
    s.group('union', 0.012 * u, () => {
      s.ellipsoid(P.h(0, y0 + 0.17, -0.06), [0.37 * u, 0.32 * u, 0.45 * u], { k: 0.03 * u });
      for (let i = 0; i < 4; i++) {
        const f = i / 3;
        s.torus(P.h(0, y0 + 0.03 + f * 0.26, -0.06 - f * 0.01), 0.355 * u * (1 - f * 0.1), th * (1 - f * 0.15), { k: 0.02 * u, rot: [-0.18 + f * 0.1 + (i % 2 ? 0.08 : -0.06), 0, (i % 2 ? 0.1 : -0.08)] });
      }
      // knot / tail at the side
      s.cone(P.h(-0.3, y0 + 0.2, 0.05), P.h(-0.42, y0 - 0.2, -0.15), 0.09 * u, 0.04 * u, { k: 0.03 * u });
    });
    // keep the face open
    s.ellipsoid(P.h(0, -0.1, 0.5), [0.33 * u, 0.3 * u, 0.3 * u], { op: 'subtract', k: 0.03 * u });
  });
}

/** a cloth veil over the lower face (cheek-veil / scarf mask), as a partial cylinder with a fold */
export function veil(ctx: KindContext, o: { color: number; y0?: number; y1?: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const u = P.headH;
  const y0 = o.y0 ?? -0.6;
  const y1 = o.y1 ?? -0.12;
  const g = new THREE.CylinderGeometry(0.34 * u, 0.28 * u, (y1 - y0) * u, 18, 3, true, -Math.PI * 0.62 + Math.PI / 2 * 0 + 0, Math.PI * 1.24);
  // cylinder theta=0 faces +Z in three? (x = sin, z = cos) -> centre the arc on +Z
  g.rotateY(0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    // squash to the face depth and add a gentle fold line
    pos.setZ(i, z * 1.05 + 0.03 * u * Math.sin((y / ((y1 - y0) * u)) * 9));
    pos.setX(i, x);
  }
  g.computeVertexNormals();
  g.translate(...P.h(0, (y0 + y1) / 2, 0.11));
  put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? 'cloth', small: true });
}
