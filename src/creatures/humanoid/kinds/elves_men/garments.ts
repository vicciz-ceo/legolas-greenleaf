/**
 * Sculpted garments for the elves_men kinds. The kit's outfit layers cover the basics (leggings,
 * boots, bracers, belt, cloak panels, skirt panels); the garments here add what they cannot
 * express: torso pieces with their own sleeve cuts and open fronts, straps, cowls, fur collars,
 * shoulder wraps and belt pouches. Each is a group of re-emitted anatomy parts, inflated, cut by
 * planes and unioned onto the body, so they follow the skin exactly.
 */
import * as THREE from 'three';
import type { Sculpt, V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import { torsoCentreFront } from './geo';
import type { KindContext } from '../../types';

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];

export function slab(s: Sculpt, y0: number | null, y1: number | null, k: number, seam = false) {
  if (y1 !== null) {
    s.plane([0, 1, 0], y1, { op: 'intersect', k });
    if (seam) s.plane([0, 1, 0], y1, { op: 'paint', seam: 0, k: 0.002 });
  }
  if (y0 !== null) {
    s.plane([0, -1, 0], -y0, { op: 'intersect', k });
    if (seam) s.plane([0, -1, 0], -y0, { op: 'paint', seam: 0, k: 0.002 });
  }
}

/** keep the part of a (left) limb not beyond `at` along L (mirrored for the right side by the caller) */
export function limbCutBefore(s: Sculpt, L: THREE.Vector3, at: V3, k: number, seam = false) {
  const d = L.x * at[0] + L.y * at[1] + L.z * at[2];
  s.plane([L.x, L.y, L.z], d, { op: 'intersect', k });
  if (seam) s.plane([L.x, L.y, L.z], d, { op: 'paint', seam: 0, k: 0.002 });
}
export function limbCutAfter(s: Sculpt, L: THREE.Vector3, at: V3, k: number, seam = false) {
  const d = -(L.x * at[0] + L.y * at[1] + L.z * at[2]);
  s.plane([-L.x, -L.y, -L.z], d, { op: 'intersect', k });
  if (seam) s.plane([-L.x, -L.y, -L.z], d, { op: 'paint', seam: 0, k: 0.002 });
}

export interface TorsoGarment {
  color: number;
  mat: SurfaceName | SurfaceSpec;
  /** outward offset (m, already scaled) */
  inflate: number;
  /** hem height as a fraction of the hip→knee distance below the hip joint (0 = hip joint) */
  hem?: number;
  /** sleeve length: 0 = sleeveless, 1 = elbow, 2 = wrist */
  sleeve?: number;
  noise?: { amp: number; freq: number; type: 'ridged' | 'fbm' | 'cells' | 'dents'; octaves?: number };
  /** include the neck (a collar); false leaves a bare neck */
  neck?: boolean;
  /** neckline height above the neck joint (m) */
  neckTop?: number;
  k?: number;
  color2?: number;
  colorNoise?: number;
  /** cover the shoulder caps (default: when the garment has sleeves) */
  shoulders?: boolean;
  /** stitch the hem / neckline / sleeve ends */
  seams?: boolean;
  /** also cover thighs (coats, tabards) */
  thighs?: boolean;
  /** a V-shaped opening down the front (open coats): half width at the neckline / at the bottom (m, scaled), bottom height */
  frontOpen?: { top: number; bottom: number; y0?: number; y1?: number };
}

/** torso + shoulders + sleeves, as one smooth garment */
export function sculptTorso(ctx: KindContext, g: TorsoGarment) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const hemY = hipY - (hipY - kneeY) * (g.hem ?? 0) - 0.03 * sc;
  const neckTop = P.j.neck[1] + (g.neckTop ?? 0.03 * sc);
  const L = P.hand.l.L;
  const o = { color: g.color, mat: g.mat, noise: g.noise, color2: g.color2, colorNoise: g.color2 !== undefined ? g.colorNoise ?? 0.4 : undefined };
  const sleeve = g.sleeve ?? 1;
  const seams = g.seams ?? true;
  s.group('union', g.k ?? 0.0035 * sc, () => {
    s.group('union', 0.0, () => {
      emitParts(s, parts, [...TORSO, ...(g.neck === false ? [] : (['neck'] as PartTag[])), ...(g.shoulders ?? sleeve > 0 ? (['deltoid'] as PartTag[]) : []), ...(g.thighs ? (['thigh'] as PartTag[]) : [])], { ...o, inflate: g.inflate });
      slab(s, hemY, neckTop, 0.008 * sc, seams);
      if (g.frontOpen) {
        // a V-shaped slit: a round cone whose axis follows the front surface of the torso, so the
        // opening has the width given at the neckline (top) and at the bottom end
        const fo = g.frontOpen;
        const y1 = fo.y1 ?? neckTop + 0.02 * sc;
        const y0 = fo.y0 ?? hemY - 0.06 * sc;
        const n = 8;
        const pts: V3[] = [];
        const radii: number[] = [];
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const y = y1 + (y0 - y1) * f;
          const z = torsoCentreFront(P, Math.min(y, P.j.chest[1] + 0.17 * sc)) + g.inflate * 0.6;
          pts.push([0, y, z]);
          radii.push(fo.top + (fo.bottom - fo.top) * f);
        }
        s.tube(pts, radii, { op: 'subtract', k: 0.006 * sc });
      }
    });
    if (sleeve > 0) {
      s.mirrored(() =>
        s.group('union', 0.004 * sc, () => {
          emitParts(s, parts, sleeve > 1 ? ['upperarm', 'forearm'] : ['upperarm'], { ...o, inflate: g.inflate * 0.85, oneSide: true });
          const sh = P.j.upperarm_l;
          const end: V3 = [sh[0] + L.x * P.upperArm * Math.min(sleeve, 1) + L.x * P.foreArm * Math.max(0, sleeve - 1), sh[1] + L.y * P.upperArm * Math.min(sleeve, 1) + L.y * P.foreArm * Math.max(0, sleeve - 1), sh[2]];
          limbCutBefore(s, L, end, 0.006 * sc, seams);
          // keep clear of the torso: the sleeve starts at the shoulder
          limbCutAfter(s, L, [sh[0] - L.x * 0.03 * sc, sh[1] - L.y * 0.03 * sc, sh[2]], 0.01 * sc);
        }),
      );
    }
  });
}

/** a diagonal strap across the chest (right shoulder → left hip); sign flips the diagonal */
export function sculptStrap(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec; width: number; inflate: number; sign?: 1 | -1; tilt?: number; seams?: boolean }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const sign = o.sign ?? 1;
  const parts = anatomyParts(P);
  const n = new THREE.Vector3(sign * (o.tilt ?? 1.0), 1.25, 0).normalize();
  const mid = new THREE.Vector3(0.0, P.j.chest[1] + 0.05 * sc, 0);
  const c = n.dot(mid);
  const hw = o.width * 0.5;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: o.color, mat: o.mat, inflate: o.inflate });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
    if (o.seams !== false) {
      s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
    }
  });
}

/** a horizontal band round the torso between two heights */
export function sculptBand(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec; y0: number; y1: number; inflate: number; tags?: PartTag[]; k?: number; seams?: boolean }) {
  const { P, sculpt: s } = ctx;
  const parts = anatomyParts(P);
  s.group('union', o.k ?? 0.002 * P.s, () => {
    emitParts(s, parts, o.tags ?? ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'glutes'], { color: o.color, mat: o.mat, inflate: o.inflate });
    slab(s, o.y0, o.y1, 0.003 * P.s, o.seams ?? false);
  });
}

/** a cowl: a thick roll of cloth around the neck with a hood bunched on the upper back (a hood worn down) */
export function sculptCowl(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceName | SurfaceSpec; size?: number; drape?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const ny = P.j.neck[1];
  const z = -0.012 * sc;
  const r = (0.07 * P.build.neckThick * g + 0.014 * (o.size ?? 1)) * sc;
  const mat = o.mat ?? 'wool';
  const w = { color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.4 : 0, colorFreq: 20 / sc, mat, bone: 'neck' };
  s.with(w, () => {
    // roll around the neck (open at the front throat)
    s.group('union', 0.02 * sc, () => {
      s.torus([0, ny + 0.02 * sc, z], r + 0.012 * sc, 0.03 * sc * (o.size ?? 1), { k: 0.02 * sc, rot: [-0.18, 0, 0], noise: { amp: 0.004 * sc, freq: 26 / sc, type: 'ridged', octaves: 2 } });
      // the bunched hood: sits on the shoulders at the back
      s.ellipsoid([0, ny - 0.03 * sc, z - 0.07 * sc], [0.11 * sc * g, 0.075 * sc, 0.065 * sc], { bone: 'chest', k: 0.03 * sc, noise: { amp: 0.006 * sc, freq: 20 / sc, type: 'ridged', octaves: 2 } });
      s.mirrored(() => s.ellipsoid([0.09 * sc * g, ny - 0.035 * sc, z - 0.03 * sc], [0.05 * sc, 0.045 * sc, 0.06 * sc], { bone: 'chest', k: 0.025 * sc }));
      // front throat opening
      s.ellipsoid([0, ny + 0.0 * sc, z + r + 0.035 * sc], [0.034 * sc, 0.075 * sc, 0.045 * sc], { op: 'subtract', k: 0.02 * sc });
    });
    if (o.drape) s.ellipsoid([0, ny - 0.1 * sc, z - 0.1 * sc], [0.085 * sc * g, o.drape * sc, 0.035 * sc], { bone: 'chest', k: 0.03 * sc, noise: { amp: 0.004 * sc, freq: 22 / sc, type: 'ridged', octaves: 2 } });
  });
}

/** thick fur collar over the shoulders and upper chest/back */
export function sculptFurCollar(ctx: KindContext, o: { color: number; color2?: number; thick?: number; drop?: number; open?: number; amp?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const y0 = P.j.upperarm_l[1] - (o.drop ?? 0.1) * sc;
  s.group('union', 0.006 * sc, () => {
    emitParts(s, parts, ['trap', 'chest', 'back', 'deltoid', 'ribs'], {
      color: o.color,
      color2: o.color2,
      colorNoise: o.color2 !== undefined ? 0.7 : 0,
      colorFreq: 40 / sc,
      mat: 'fur',
      k: 0.05 * sc,
      noise: { amp: (o.amp ?? 0.011) * sc, freq: 24 / sc, type: 'fbm', octaves: 3 },
      inflate: (o.thick ?? 0.032) * sc,
    });
    slab(s, y0, null, 0.02 * sc);
    if (o.open) s.ellipsoid([0, y0 + 0.05 * sc, 0.17 * sc], [0.05 * sc * o.open, 0.12 * sc, 0.06 * sc], { op: 'subtract', k: 0.03 * sc });
  });
}

/** one shoulder wrapped in a leather cap/mantle (Tauriel's asymmetric layering, ranger mantles) */
export function sculptShoulderCap(ctx: KindContext, o: { color: number; mat?: SurfaceName | SurfaceSpec; side: 'l' | 'r' | 'both'; inflate?: number; reach?: number; seams?: boolean }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  const sides: ('l' | 'r')[] = o.side === 'both' ? ['l', 'r'] : [o.side];
  for (const sd of sides) {
    const draw = () =>
      s.group('union', 0.004 * sc, () => {
        emitParts(s, parts, ['deltoid', 'trap'], { color: o.color, mat: o.mat ?? 'leather', inflate: o.inflate ?? 0.02 * sc, oneSide: true, k: 0.02 * sc });
        emitParts(s, parts, ['upperarm'], { color: o.color, mat: o.mat ?? 'leather', inflate: (o.inflate ?? 0.02 * sc) * 0.9, oneSide: true });
        const sh = P.j.upperarm_l;
        const reach = o.reach ?? 0.45;
        limbCutBefore(s, L, [sh[0] + L.x * P.upperArm * reach, sh[1] + L.y * P.upperArm * reach, sh[2]], 0.01 * sc, o.seams ?? true);
        limbCutAfter(s, L, [sh[0] - L.x * 0.02 * sc, sh[1] - L.y * 0.02 * sc, sh[2]], 0.01 * sc);
        // trim along the inner edge of the trapezius
        s.plane([-0.55, 0.1, 0], -0.55 * 0.04 * sc + 0.1 * (P.j.neck[1] - 0.04 * sc), { op: 'intersect', k: 0.01 * sc });
      });
    if (sd === 'l') draw();
    else s.mirrored((side) => (side === -1 ? draw() : undefined));
  }
}

/** a belt pouch / purse hanging at the hip */
export function sculptPouch(ctx: KindContext, o: { x: number; z?: number; size?: number; color: number; flapColor?: number; drop?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const z = o.z ?? 0.075 * sc;
  const sz = (o.size ?? 1) * sc;
  const cy = hipY + 0.035 * sc - (o.drop ?? 0.04) * sc;
  s.group('union', 0.004 * sc, () => {
    s.ellipsoid([o.x, cy, z], [0.034 * sz, 0.04 * sz, 0.026 * sz], { color: o.color, mat: 'leather_worn', bone: 'hips', k: 0.012 * sc });
    s.box([o.x, cy + 0.02 * sz, z + 0.004 * sz], [0.036 * sz, 0.02 * sz, 0.028 * sz], 0.006 * sc, { color: o.flapColor ?? o.color, mat: 'leather_worn', bone: 'hips', k: 0.004 * sc });
  });
}

/** a draped sash across one shoulder and the waist */
export function sculptSashDiagonal(ctx: KindContext, o: { color: number; mat?: SurfaceName | SurfaceSpec; width: number; inflate: number; sign?: 1 | -1 }) {
  sculptStrap(ctx, { color: o.color, mat: o.mat ?? 'cloth', width: o.width, inflate: o.inflate, sign: o.sign, seams: false });
}
