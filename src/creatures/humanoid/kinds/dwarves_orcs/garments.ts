/**
 * Sculpted garments for the dwarves_orcs kinds. The kit's `mail_shirt` / `rags` sleeves are cut by
 * a plane that also slices the torso on stocky bodies (the cut is not limited to the sleeve), so the
 * garments here use nested groups: the torso group is cut by slabs only and every sleeve is its own
 * group with its own end cut.
 */
import * as THREE from 'three';
import type { Sculpt, V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import { put, studs, tube } from './armor';
import type { KindContext } from '../../types';

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];

function slab(s: Sculpt, y0: number | null, y1: number | null, k: number) {
  if (y1 !== null) s.plane([0, 1, 0], y1, { op: 'intersect', k });
  if (y0 !== null) s.plane([0, -1, 0], -y0, { op: 'intersect', k });
}

/** keep the part of a (left) limb not beyond `at` along L (mirrored for the right side by the caller) */
function limbCutBefore(s: Sculpt, L: THREE.Vector3, at: V3, k: number) {
  const d = L.x * at[0] + L.y * at[1] + L.z * at[2];
  s.plane([L.x, L.y, L.z], d, { op: 'intersect', k });
}
function limbCutAfter(s: Sculpt, L: THREE.Vector3, at: V3, k: number) {
  const d = -(L.x * at[0] + L.y * at[1] + L.z * at[2]);
  s.plane([-L.x, -L.y, -L.z], d, { op: 'intersect', k });
}

export interface TorsoGarment {
  color: number;
  mat: SurfaceName | SurfaceSpec;
  /** outward offset (m, scaled by P.s outside) */
  inflate: number;
  /** hem height as a fraction of the hip→knee distance below the hip joint (0 = hip joint, >0 lower) */
  hem?: number;
  /** sleeve length as a fraction of upper arm (0 = sleeveless, 1 = elbow, 2 = wrist) */
  sleeve?: number;
  noise?: { amp: number; freq: number; type: 'ridged' | 'fbm' | 'cells' | 'dents'; octaves?: number };
  /** also the neck/collar */
  neck?: boolean;
  k?: number;
  color2?: number;
  bone?: string;
  /** cover the shoulder caps (default: only when the garment has sleeves) */
  shoulders?: boolean;
}

/** torso + shoulders + sleeves, as one smooth garment */
export function sculptTorsoGarment(ctx: KindContext, g: TorsoGarment) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const hemY = hipY - (hipY - kneeY) * (g.hem ?? 0) - 0.03 * sc;
  const neckTop = P.j.neck[1] + 0.03 * sc;
  const L = P.hand.l.L;
  const o = { color: g.color, mat: g.mat, noise: g.noise, color2: g.color2, colorNoise: g.color2 !== undefined ? 0.4 : undefined };
  const sleeve = g.sleeve ?? 1;
  s.group('union', g.k ?? 0.0035 * sc, () => {
    s.group('union', 0.0, () => {
      emitParts(s, parts, [...TORSO, ...(g.neck === false ? [] : (['neck'] as PartTag[])), ...(g.shoulders ?? sleeve > 0 ? (['deltoid'] as PartTag[]) : [])], { ...o, inflate: g.inflate });
      slab(s, hemY, neckTop, 0.008 * sc);
    });
    if (sleeve > 0) {
      s.mirrored(() =>
        s.group('union', 0.004 * sc, () => {
          emitParts(s, parts, sleeve > 1 ? ['upperarm', 'forearm'] : ['upperarm'], { ...o, inflate: g.inflate * 0.85, oneSide: true });
          const sh = P.j.upperarm_l;
          const end: V3 = [sh[0] + L.x * P.upperArm * Math.min(sleeve, 1) + L.x * P.foreArm * Math.max(0, sleeve - 1), sh[1] + L.y * P.upperArm * Math.min(sleeve, 1) + L.y * P.foreArm * Math.max(0, sleeve - 1), sh[2]];
          limbCutBefore(s, L, end, 0.006 * sc);
          // keep clear of the torso: the sleeve starts at the shoulder
          limbCutAfter(s, L, [sh[0] - L.x * 0.03 * sc, sh[1] - L.y * 0.03 * sc, sh[2]], 0.01 * sc);
        }),
      );
    }
  });
}

/** a diagonal strap across the chest (right shoulder → left hip); sign flips the diagonal */
export function sculptStrap(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec; width: number; inflate: number; sign?: 1 | -1; tilt?: number }) {
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
  });
}

/** a horizontal band round the torso between two heights */
export function sculptBand(ctx: KindContext, o: { color: number; mat: SurfaceName | SurfaceSpec; y0: number; y1: number; inflate: number; tags?: PartTag[]; k?: number }) {
  const { P, sculpt: s } = ctx;
  const parts = anatomyParts(P);
  s.group('union', o.k ?? 0.002 * P.s, () => {
    emitParts(s, parts, o.tags ?? ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'glutes'], { color: o.color, mat: o.mat, inflate: o.inflate });
    slab(s, o.y0, o.y1, 0.003 * P.s);
  });
}

/** thick fur mantle over the shoulders and upper chest/back (open at the front when `open` > 0) */
export function sculptFurMantle(ctx: KindContext, o: { color: number; color2?: number; thick?: number; drop?: number; open?: number; amp?: number }) {
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

/** a wool scarf: a thick ring round the neck with a knot and a hanging tail */
export function sculptScarf(ctx: KindContext, o: { color: number; color2?: number; tail?: number; thick?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const ny = P.j.neck[1];
  const r = (0.07 * P.build.neckThick * Math.sqrt(P.build.bulk) + (o.thick ?? 0.022)) * sc;
  s.with({ color: o.color, color2: o.color2, colorNoise: o.color2 !== undefined ? 0.5 : 0, colorFreq: 22 / sc, mat: 'wool', bone: 'neck' }, () => {
    s.torus([0, ny + 0.035 * sc, -0.012 * sc], r / sc * sc, 0.024 * sc, { k: 0.012 * sc, rot: [0.15, 0, 0], noise: { amp: 0.004 * sc, freq: 28 / sc, type: 'ridged', octaves: 2 } });
    s.torus([0, ny + 0.005 * sc, -0.008 * sc], r * 1.04, 0.022 * sc, { k: 0.012 * sc, rot: [0.1, 0, 0], noise: { amp: 0.004 * sc, freq: 28 / sc, type: 'ridged', octaves: 2 } });
    // knot at the front-left and a tail down the chest
    s.sphere([0.045 * sc, ny - 0.01 * sc, r + 0.0 * sc], 0.03 * sc, { k: 0.015 * sc, bone: 'chest' });
    if (o.tail) s.cone([0.05 * sc, ny - 0.03 * sc, r + 0.01 * sc], [0.06 * sc, ny - 0.03 * sc - o.tail, r + 0.02 * sc + 0.02 * sc], 0.028 * sc, 0.022 * sc, { k: 0.01 * sc, bone: 'chest' });
  });
}

export { slab, limbCutBefore, limbCutAfter };


/**
 * A front opening on a coat or vest: a seam (or lacing) down the middle of the chest with buttons,
 * toggles or lace crosses, following the ribcage. `y0`/`y1` are heights (m); `inflate` is the garment thickness.
 */
export function placket(ctx: KindContext, o: { y0: number; y1: number; inflate: number; color: number; buttons?: number; buttonColor?: number; lace?: boolean; mat?: SurfaceName | SurfaceSpec; width?: number }) {
  const { P } = ctx;
  const s = P.s;
  const b = P.build;
  const g = b.bulk;
  const cy = P.j.chest[1] + 0.075 * s;
  const ry = 0.165 * s;
  const rz = 0.103 * s * b.chest * g;
  const waistRz = (0.092 + 0.06 * b.belly) * s * g * 1.12;
  const zAt = (y: number): number => {
    // chest ellipsoid in the upper part, waist/belly below it
    const k = Math.max(0.05, 1 - ((y - cy) / ry) ** 2);
    const zc = 0.004 * s + Math.sqrt(k) * rz;
    const lower = Math.max(0, (cy - 0.1 * s - y) / (0.25 * s));
    return zc * (1 - Math.min(1, lower)) + waistRz * 1.05 * Math.min(1, lower) + o.inflate;
  };
  const n = 8;
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const y = o.y1 + (o.y0 - o.y1) * (i / n);
    pts.push([0, y, zAt(y) + 0.001 * s]);
  }
  put(ctx, tube(pts, (o.width ?? 0.0042) * s, { seg: 10, radial: 3 }), { bone: 'chest', color: o.color, mat: o.mat ?? 'leather_worn', small: true });
  const nb = o.buttons ?? 0;
  if (nb > 0) {
    const bp: V3[] = [];
    for (let i = 0; i < nb; i++) {
      const y = o.y1 + (o.y0 - o.y1) * ((i + 0.5) / nb);
      bp.push([0.011 * s, y, zAt(y) + 0.003 * s]);
    }
    const bg = studs(bp, 0.0075 * s, 0.8);
    if (bg) put(ctx, bg, { bone: 'chest', color: o.buttonColor ?? 0x9b7432, mat: 'gold', small: true });
  }
  if (o.lace) {
    // criss-cross lace between two rows of eyelets
    const segs: V3[][] = [];
    const m = 5;
    for (let i = 0; i < m; i++) {
      const ya = o.y1 + (o.y0 - o.y1) * (i / m);
      const yb = o.y1 + (o.y0 - o.y1) * ((i + 1) / m);
      segs.push([[-0.018 * s, ya, zAt(ya) + 0.002 * s], [0.018 * s, yb, zAt(yb) + 0.002 * s]]);
      segs.push([[0.018 * s, ya, zAt(ya) + 0.002 * s], [-0.018 * s, yb, zAt(yb) + 0.002 * s]]);
    }
    for (const sg of segs) put(ctx, tube([sg[0], [(sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2, (sg[0][2] + sg[1][2]) / 2 + 0.003 * s], sg[1]], 0.0028 * s, { seg: 3, radial: 3 }), { bone: 'chest', color: o.color, mat: 'leather_worn', small: true });
  }
}
