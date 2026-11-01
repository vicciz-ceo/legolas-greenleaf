/**
 * Saruman's Uruk-hai and the Helm's Deep berserker.
 *
 * Everything that makes them (armour, helmets, the white hand, scars, prints) is built in
 * `extras`, so the same two KindDefs cover four seed buckets with visibly different kit.
 * The helmets are sized to enclose the kit's scalp hair, which then spills out under the neck
 * guard like the long black hair of the films.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts, type Part } from '../../anatomy';
import { surface, type SurfaceName } from '../../../kit/surfaces';
import type { Sculpt } from '../../../kit/sdf';
import { brawnBody } from './body';
import {
  V, v3, bucketOf, gearOf, shellPatch, ellipsoidFn, ribbon, spike, rivet, ellipticalBand, placeAlong, lerp, smooth, makeProjector, ringRadii, ellipsoidProjector,
  type GearFn, type Projector, lathe, handStrips, frameAt, snapPoint, type SnapMode, scaleHeldWeapon, strapSnapped,
} from './common';
import { bareTorso } from './body';
import { URUK_SHEET_PAL as SP, SHEET_IRON, SHEET_LEATHER, greaves, greaveLames, beltAndFaulds, chestLames, berserkerBelt, legWraps, underSkirt, dirtyHand, muscleShade } from './uruk_sheet';

export const URUK_PAL = {
  skin: 0x3d3027,
  skin2: 0x251c16,
  lips: 0x2b1f1b,
  scatter: 0x4c2c20,
  hair: 0x0b0a09,
  eyes: 0xc89a2c,
  iron: 0x2c2c2f,
  ironLt: 0x55555c,
  iron2: 0x1f1f22,
  leather: 0x2a2019,
  leatherLt: 0x3d2d21,
  strap: 0x17110d,
  cloth: 0x2a2520,
  white: 0xe9e4d6,
  bone: 0xcbbf9d,
};

/** chalky white paint over metal, leather or skin */
export const WHITE_PAINT = surface('leather', { rough: 0.9, metal: 0, sheen: 0.05, pat: { leather: 0.3, scratches: 0.5, pores: 0.5 } });
const IRON = surface('metal_dark', { rough: 0.55 });
const IRON_RUSTY = surface('metal_rusty', { rough: 0.7 });
const LEATHER = surface('leather_worn', { rough: 0.7 });

export interface UrukLook {
  cuirass: 'plate' | 'studded' | 'mail' | 'none';
  pauldrons: 'r' | 'l' | 'both' | 'none';
  helm: 'dome' | 'ridge' | 'cap' | 'none';
  hand: 'helm' | 'chest' | 'none';
  nasal: boolean;
  cheeks: boolean;
  vambraces: boolean;
  wraps: boolean;
  scar: boolean;
  earring: boolean;
  gorget: boolean;
  trophy: boolean;
  spikes: number;
}

const LOOKS: UrukLook[] = [
  // bucket 0 is the sheet's Uruk: plate cuirass, layered pauldrons on both shoulders, open dome helm with the white hand
  { cuirass: 'plate', pauldrons: 'both', helm: 'dome', hand: 'helm', nasal: false, cheeks: true, vambraces: true, wraps: false, scar: false, earring: false, gorget: false, trophy: false, spikes: 0 },
  { cuirass: 'studded', pauldrons: 'both', helm: 'ridge', hand: 'helm', nasal: false, cheeks: true, vambraces: false, wraps: true, scar: true, earring: true, gorget: false, trophy: false, spikes: 3 },
  { cuirass: 'plate', pauldrons: 'l', helm: 'cap', hand: 'chest', nasal: true, cheeks: false, vambraces: true, wraps: false, scar: true, earring: false, gorget: true, trophy: true, spikes: 0 },
  { cuirass: 'mail', pauldrons: 'l', helm: 'none', hand: 'chest', nasal: true, cheeks: true, vambraces: true, wraps: true, scar: true, earring: true, gorget: true, trophy: false, spikes: 0 },
];

export function urukLook(bucket: number): UrukLook {
  return LOOKS[bucket % LOOKS.length];
}

export interface BerserkLook {
  spikes: number;
  crest: number;
  shoulder: 'l' | 'r' | 'both' | 'none';
  bandolier: 1 | -1 | 0;
  prints: number[];
  flip: boolean;
  mask: 'plate' | 'cage';
  cheekSpikes: boolean;
  scar: boolean;
}
const BERSERK_LOOKS: BerserkLook[] = [
  // bucket 0 is the sheet's berserker: bare shoulders, no bandolier, handprints on both shoulders, chest and back
  { spikes: 9, crest: 1, shoulder: 'none', bandolier: 0, prints: [0, 1, 2, 3, 4, 5], flip: false, mask: 'plate', cheekSpikes: false, scar: false },
  { spikes: 7, crest: 1.35, shoulder: 'r', bandolier: -1, prints: [0, 2, 4, 5], flip: true, mask: 'plate', cheekSpikes: false, scar: false },
  { spikes: 11, crest: 0.8, shoulder: 'both', bandolier: 0, prints: [0, 1, 4, 5], flip: false, mask: 'cage', cheekSpikes: true, scar: true },
  { spikes: 5, crest: 1.6, shoulder: 'none', bandolier: 1, prints: [1, 2, 3, 5], flip: true, mask: 'cage', cheekSpikes: false, scar: false },
];
export function berserkLook(bucket: number): BerserkLook {
  return BERSERK_LOOKS[bucket % BERSERK_LOOKS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// armour
// ─────────────────────────────────────────────────────────────────────────────

/** layered shoulder plate (spaulder). side +1 = left (+X). */
export function pauldron(ctx: KindContext, gear: GearFn, side: 1 | -1, o: { lames: number; spikes: number; scale?: number; color?: number; rusty?: boolean; reach?: number; half?: number; ry?: number; mat?: typeof IRON; rivets?: number }) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const bone = side > 0 ? 'upperarm_l' : 'upperarm_r';
  const J = v3(P.j[bone]);
  const L = P.hand.l.L.clone();
  L.x *= side;
  const top = new THREE.Vector3(0.6 * side, 0.8, 0.05).normalize();
  const k0 = o.scale ?? 1;
  const mat = o.mat ?? (o.rusty ? IRON_RUSTY : IRON);
  for (let k = 0; k < o.lames; k++) {
    const axis = top.clone().lerp(L, k * 0.22).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
    const R = (0.1 - k * 0.003) * sc * g * k0;
    const rch = o.reach ?? 1;
    const c = J.clone().addScaledVector(L, (0.03 + k * 0.034 * rch) * sc).add(V(-0.012 * side * sc, 0.0, 0));
    const half = ((o.half ?? 66) - k * 5) * (Math.PI / 180);
    const fn = ellipsoidFn(c, [R * 1.05, R * (o.ry ?? 0.78), R * 1.1], [-Math.PI, Math.PI], [Math.PI / 2 - half, Math.PI / 2], { rot });
    gear(shellPatch(fn, 12, 3, 0.0075 * sc, { closedU: true, noInner: true, thickFn: (_u, v) => 1 + 1.1 * (1 - smooth(0, 0.18, v)), skip: ['v1'] }), {
      bone,
      color: o.color ?? URUK_PAL.iron,
      mat,
      ao: 0.85,
    });
    // a few rivets along each lame's lower rim (only when asked for)
    for (let i = 0; i < (o.rivets ?? 0); i++) {
      const a = lerp(-1.1, 1.1, (i + 0.5) / (o.rivets ?? 1)) + 0.15;
      const e = Math.PI / 2 - half + 0.12;
      const ry = o.ry ?? 0.78;
      const dd = V(Math.cos(e) * Math.sin(a) * R * 1.05, Math.sin(e) * R * ry, Math.cos(e) * Math.cos(a) * R * 1.1);
      const nn = V((Math.cos(e) * Math.sin(a)) / 1.05, Math.sin(e) / ry, (Math.cos(e) * Math.cos(a)) / 1.1).normalize().applyQuaternion(rot);
      const pp = dd.applyQuaternion(rot).add(c).addScaledVector(nn, 0.006 * sc);
      gear(rivet(0.0065 * sc, 4), { bone, color: URUK_PAL.ironLt, mat, matrix: placeAlong(pp, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
  const rot = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), top);
  const R0 = 0.1 * sc * g * k0;
  const c0 = J.clone().addScaledVector(L, 0.03 * sc).add(V(-0.012 * side * sc, 0, 0));
  for (let i = 0; i < o.spikes; i++) {
    const a = ((i + 0.5) / o.spikes) * Math.PI * 2;
    const d = V(Math.sin(a) * 1.05, 0.7, Math.cos(a) * 1.1).normalize().applyQuaternion(rot);
    const p = c0.clone().add(V(d.x * R0 * 0.98, d.y * R0 * 0.98, d.z * R0 * 0.98));
    gear(spike(0.013 * sc, 0.07 * sc, 5), { bone, color: URUK_PAL.iron2, mat, matrix: placeAlong(p, d, V(0, 0, 1)), small: true });
  }
}

/** SDF part of the torso armour; returns the lower edge height */
export function cuirassSdf(ctx: KindContext, look: Pick<UrukLook, 'cuirass'>, parts: Part[], o: { rusty?: boolean; color?: number; lats?: number; mat?: typeof IRON; raise?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const botY = hipY + (0.14 + (o.raise ?? 0)) * sc;
  const kind = look.cuirass;
  const plate = kind === 'plate';
  const mat = plate ? (o.mat ?? (o.rusty ? IRON_RUSTY : IRON)) : kind === 'mail' ? surface('mail', { rough: 0.5 }) : LEATHER;
  const color = o.color ?? (plate ? URUK_PAL.iron : kind === 'mail' ? 0x35353a : URUK_PAL.leather);
  const infl = (plate ? 0.021 : kind === 'mail' ? 0.014 : 0.018) * sc;
  s.group('union', 0.003 * sc, () => {
    const noise = plate ? { amp: 0.0016 * sc, freq: 38 / sc, type: 'dents' as const } : kind === 'studded' ? { amp: 0.002 * sc, freq: 25 / sc, type: 'ridged' as const } : undefined;
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap'], { color, mat, inflate: infl, k: 0.012 * sc, noise });
    // cover the latissimus mass added by brawnBody
    const lt = o.lats;
    if (lt) {
      const g = P.build.bulk;
      s.mirrored(() => s.ellipsoid([0.1 * sc * P.build.shoulders, j.upperarm_l[1] - 0.15 * sc, -0.075 * sc * g], [0.05 * sc * g * lt + infl, 0.115 * sc + infl, 0.045 * sc * g * lt + infl], { bone: 'chest', k: 0.03 * sc, color, mat }));
    }
    // the lower torso keeps the anatomy's own (large) blend radii so the plate stays outside the blended skin
    emitParts(s, parts, ['waist', 'belly', 'pelvis', 'glutes'], { color, mat, inflate: infl + 0.004 * sc, noise });
    // neckline: high at the back, lower at the front
    s.plane([0, 1, 0.5], j.neck[1] + 0.012 * sc, { op: 'intersect', k: 0.006 * sc });
    s.plane([0, -1, 0], -botY, { op: 'intersect', k: 0.004 * sc });
    // arm holes: carve the shoulder and upper arm out of the plate
    const gs = Math.sqrt(P.build.bulk);
    const Lh = P.hand.l.L;
    s.mirrored(() => {
      const J = j.upperarm_l;
      s.cone([J[0] - 0.01 * sc, J[1] + 0.025 * sc, J[2]], [J[0] + Lh.x * 0.14 * sc, J[1] + Lh.y * 0.14 * sc, J[2]], 0.092 * sc * gs, 0.09 * sc * gs, { op: 'subtract', k: 0.014 * sc });
    });
  });
  return { botY };
}

/** rigid parts of the torso armour (needs a projector for the finished sculpt) */
export function cuirassGear(ctx: KindContext, gear: GearFn, proj: Projector, look: Pick<UrukLook, 'cuirass'>, botY: number, o: { noBelly?: boolean; mat?: typeof IRON } = {}) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const plate = look.cuirass === 'plate';
  const hipY = j.thigh_l[1];
  // belly lames (overlapping elliptical bands from the cuirass edge down to the belt)
  const n = o.noBelly ? 0 : plate ? 3 : look.cuirass === 'mail' ? 2 : 0;
  const IRON_M = o.mat ?? IRON;
  const hBand = 0.058 * sc;
  for (let k = 0; k < n; k++) {
    const yTop = botY + 0.012 * sc - k * 0.045 * sc;
    const yBot = yTop - hBand;
    const rt = ringRadii(proj, yTop);
    const rb = ringRadii(proj, yBot);
    const m = new THREE.Matrix4().makeTranslation(0, (yTop + yBot) / 2, 0);
    const g = ellipticalBand(rt.rx + 0.012 * sc, (rt.zf + rt.zb) / 2 + 0.012 * sc, rb.rx + 0.022 * sc, (rb.zf + rb.zb) / 2 + 0.022 * sc, hBand, 0.0065 * sc, 22, 0, Math.PI * 2, (rt.zf - rt.zb) / 2);
    gear(g, { bone: 'spine', color: URUK_PAL.iron, mat: IRON_M, matrix: m, ao: 0.85 });
  }
  void hipY;
  // front ridge
  if (plate) {
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const nn = V();
    const yTop = j.upperarm_l[1] - 0.02 * sc;
    for (let i = 0; i <= 6; i++) {
      const y = lerp(yTop, botY + 0.02 * sc, i / 6);
      const p = V(0, y, 0.2 * sc);
      if (!proj.project(p, nn)) continue;
      pts.push(p);
      nrm.push(nn.clone());
    }
    if (pts.length > 3) gear(ribbon(pts, nrm, 0.03 * sc, 0.011 * sc, 1, { outerOnly: true, noInner: true }), { bone: 'chest', color: URUK_PAL.iron2, mat: IRON_M, small: true });
  }
  // shoulder straps (front plate → back plate over the trapezius)
  for (const sx of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const nn = V();
    const xs = 0.085 * sc * P.build.shoulders * sx;
    const yS = j.upperarm_l[1] + 0.05 * sc;
    const path: [number, number, number][] = [
      [xs, yS - 0.08 * sc, 0.16 * sc],
      [xs * 1.02, yS - 0.01 * sc, 0.1 * sc],
      [xs * 1.05, yS + 0.03 * sc, 0.0],
      [xs * 1.02, yS - 0.01 * sc, -0.1 * sc],
      [xs, yS - 0.09 * sc, -0.15 * sc],
    ];
    for (const q of path) {
      const p = V(q[0], q[1], q[2]);
      if (!proj.project(p, nn)) continue;
      pts.push(p);
      nrm.push(nn.clone());
    }
    if (pts.length > 3) gear(ribbon(pts, nrm, 0.036 * sc, 0.007 * sc, 1, { outerOnly: true, noInner: true }), { bone: 'chest', color: URUK_PAL.strap, mat: LEATHER, small: true });
  }
  // rivets on the front plate
  if (plate) {
    for (const sx of [1, -1])
      for (let r = 0; r < 3; r++) {
        const p = V(sx * (0.095 - r * 0.012) * sc * P.build.shoulders, j.upperarm_l[1] - (0.045 + r * 0.075) * sc, 0.2 * sc);
        const nn = V();
        if (!proj.project(p, nn)) continue;
        gear(rivet(0.0085 * sc, 5), { bone: 'chest', color: URUK_PAL.ironLt, mat: IRON_M, matrix: placeAlong(p, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
  }
}

function limbCut(s: Sculpt, L: THREE.Vector3, at: [number, number, number], keepBeyond: boolean, k: number) {
  const n = keepBeyond ? L.clone().multiplyScalar(-1) : L.clone();
  s.plane([n.x, n.y, n.z], n.x * at[0] + n.y * at[1] + n.z * at[2], { op: 'intersect', k });
}

/** forearm guards (plate / leather) or bandage wraps */
export function forearms(ctx: KindContext, parts: Part[], kind: 'plate' | 'wraps' | 'leather', grow = 1, o: { mat?: typeof IRON; color?: number; from?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const L = P.hand.l.L;
  const j = P.j;
  const plate = kind === 'plate';
  const from = o.from ?? (kind === 'plate' ? 0.2 : kind === 'leather' ? 0.12 : 0.4);
  s.mirrored(() =>
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['forearm'], {
        color: o.color ?? (plate ? URUK_PAL.iron : kind === 'leather' ? 0x1e1712 : 0x4a4236),
        mat: plate ? o.mat ?? IRON : kind === 'leather' ? LEATHER : surface('rags', { rough: 0.95 }),
        inflate: (plate ? 0.011 : kind === 'leather' ? 0.01 : 0.007) * sc + (grow - 1) * 0.045 * sc * P.build.bulk,
        k: 0.014 * sc,
        oneSide: true,
        noise: kind === 'wraps' ? { amp: 0.0025 * sc, freq: 50 / sc, type: 'ridged' } : undefined,
      });
      limbCut(s, L, [j.hand_l[0] - L.x * 0.012 * sc, j.hand_l[1] - L.y * 0.012 * sc, j.hand_l[2]], false, 0.004 * sc);
      limbCut(s, L, [j.forearm_l[0] + L.x * P.foreArm * from, j.forearm_l[1] + L.y * P.foreArm * from, j.forearm_l[2]], true, 0.004 * sc);
    }),
  );
}

export function gorget(ctx: KindContext, parts: Part[], o: { mat?: typeof IRON; color?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  s.group('union', 0.004 * sc, () => {
    emitParts(s, parts, ['neck', 'trap'], { color: o.color ?? URUK_PAL.iron, mat: o.mat ?? IRON, inflate: 0.016 * sc, k: 0.02 * sc });
    s.plane([0, 1, 0], j.neck[1] + 0.075 * sc, { op: 'intersect', k: 0.006 * sc });
    s.plane([0, -1, 0], -(j.neck[1] - 0.022 * sc), { op: 'intersect', k: 0.006 * sc });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// helmets
// ─────────────────────────────────────────────────────────────────────────────

export interface HelmetInfo {
  C: THREE.Vector3;
  R: [number, number, number];
  rimY: (a: number) => number;
  elOf: (a: number) => number;
  radial: (a: number, e: number) => number;
}

/** Isengard helmet. Dome sized to enclose the scalp hair, flared neck guard, comb ridge, nasal bar, cheek plates. */
export function helmet(ctx: KindContext, gear: GearFn, o: { style: UrukLook['helm']; nasal: boolean; cheeks: boolean; spikes?: number; color?: number; crest?: number; brow?: boolean; mat?: typeof IRON; cheekDrop?: number; rivets?: number; domeSeg?: [number, number]; scale?: number; ring?: number; rivetColor?: number }): HelmetInfo {
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => v3(P.h(x, y, z));
  const iron = o.color ?? URUK_PAL.iron;
  const IM = o.mat ?? IRON;
  const C = H(0, 0.045, -0.05);
  const hs = o.scale ?? 1;
  const R: [number, number, number] = [0.405 * u * hs, 0.48 * u * hs, 0.505 * u * hs];
  const cyHead = 0.045;
  const rimY = (a: number) => {
    const t = Math.abs(a);
    const side = smooth(0.95, 1.6, t);
    const back = smooth(1.9, 2.9, t);
    let y = lerp(0.04, 0.0, side);
    y = lerp(y, -0.36, back);
    return y;
  };
  const elOf = (a: number) => Math.asin(Math.max(-0.97, Math.min(0.97, (rimY(a) - cyHead) / (R[1] / u))));
  const radial = (a: number, e: number) => {
    const t = Math.abs(a);
    let k = 1;
    if (e < 0) k = 1 / Math.pow(Math.max(0.55, Math.cos(e)), 0.85);
    k += 0.1 * smooth(2.2, 3.0, t) * smooth(0, -0.4, e);
    return k;
  };
  const shell = shellPatch(ellipsoidFn(C, R, [-Math.PI, Math.PI], [elOf, Math.PI / 2 - 1e-3], { radial }), o.domeSeg?.[0] ?? 20, o.domeSeg?.[1] ?? 5, 0.011 * sc, {
    closedU: true,
    noInner: true,
    thickFn: (_u2, v) => 1 + 0.9 * (1 - smooth(0, 0.12, v)),
    skip: ['v1'],
  });
  const wearFn = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const rel = (p.y - C.y) / u;
    c.multiplyScalar(1 + 0.6 * smooth(0.0, -0.25, rel));
  };
  gear(shell, { bone: 'head', color: iron, mat: IM, ao: 0.9, colorFn: wearFn });

  if (o.style === 'dome' || o.style === 'ridge') {
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const e = lerp(0.95, Math.PI - 0.55, i / n);
      pts.push(V(0, Math.sin(e) * R[1] * 1.03, Math.cos(e) * R[2] * 1.03).add(C));
      nrm.push(V(0, Math.sin(e) / R[1], Math.cos(e) / R[2]).normalize());
    }
    gear(ribbon(pts, nrm, 0.05 * u * (o.style === 'ridge' ? 1.3 : 1), (o.style === 'ridge' ? 0.07 : 0.035) * u, 1, { outerOnly: true, noInner: true }), { bone: 'head', color: URUK_PAL.iron2, mat: IM, ao: 0.9 });
  }
  const nRiv = o.rivets ?? 9;
  for (let i = 0; i < nRiv; i++) {
    const a = lerp(-2.6, 2.6, i / Math.max(1, nRiv - 1));
    const e = elOf(a) + 0.12;
    const d = V(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    const k = radial(a, e);
    const p = V(d.x * R[0] * k, d.y * R[1] * k, d.z * R[2] * k).add(C);
    const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    gear(rivet(0.0075 * sc, 5), { bone: 'head', color: o.rivetColor ?? URUK_PAL.ironLt, mat: IM, matrix: placeAlong(p.addScaledVector(nn, 0.005 * sc), nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
  if (o.nasal) {
    const pts = [H(0, 0.04, 0.458), H(0, -0.07, 0.505), H(0, -0.2, 0.545)];
    const nrm = [V(0, 0.15, 1).normalize(), V(0, 0, 1), V(0, -0.2, 1).normalize()];
    gear(ribbon(pts, nrm, 0.05 * u, 0.012 * sc, 1, { outerOnly: true }), { bone: 'head', color: iron, mat: IM, small: true });
  }
  if (o.cheeks) {
    for (const sx of [1, -1]) {
      const fn = ellipsoidFn(H(0, -0.16, 0.03), [0.41 * u, 0.5 * u, 0.45 * u], sx > 0 ? [0.95, 1.5] : [-1.5, -0.95], [-0.5 - (o.cheekDrop ?? 0), 0.1]);
      gear(shellPatch(fn, 5, 5 + Math.round((o.cheekDrop ?? 0) * 6), 0.008 * sc, { noInner: true }), { bone: 'head', color: iron, mat: IM, small: true, ao: 0.9 });
    }
  }
  const spikes = o.spikes ?? 0;
  for (let i = 0; i < spikes; i++) {
    const t = (i + 0.5) / spikes;
    const e = lerp(0.35, Math.PI - 0.6, t);
    const p = V(0, Math.sin(e) * R[1], Math.cos(e) * R[2]).add(C);
    const nn = V(0, Math.sin(e) / R[1], Math.cos(e) / R[2]).normalize();
    const hgt = (0.16 + 0.14 * Math.sin(t * Math.PI)) * u * (o.crest ?? 1);
    gear(spike(0.034 * u, hgt, 6), { bone: 'head', color: URUK_PAL.iron2, mat: IM, matrix: placeAlong(p, nn, V(0, 0, 1)), small: true });
  }
  // a ring of short thick spikes round the crown (berserker great-helm)
  for (let i = 0; i < (o.ring ?? 0); i++) {
    const a = ((i + 0.5) / (o.ring ?? 1)) * Math.PI * 2;
    const el = 0.92;
    const d = V(Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a));
    const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(C);
    const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    gear(spike(0.05 * u, 0.13 * u, 5), { bone: 'head', color: iron, mat: IM, matrix: placeAlong(p, nn, V(0, 0, 1)), small: true });
  }
  return { C, R, rimY, elOf, radial };
}

/** berserker face mask: a riveted iron faceplate with eye slits, a vent grille and a movable chin plate */
export function muzzleMask(ctx: KindContext, gear: GearFn, o: { style?: 'plate' | 'cage'; cheekSpikes?: boolean; color?: number; mat?: typeof IRON; scale?: number; rivetColor?: number } = {}) {
  const IM = o.mat ?? IRON;
  const color = o.color ?? URUK_PAL.iron;
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => v3(P.h(x, y, z));
  const cc = H(0, -0.22, 0.0);
  const ms = o.scale ?? 1;
  const R: [number, number, number] = [0.37 * u * ms, 0.53 * u * (ms + 0.05), 0.55 * u * ms];
  const ex = 0.135 * u;
  const ey = P.h(0, -0.075, 0)[1];
  const eyeSlit = (p: THREE.Vector3) => Math.abs(Math.abs(p.x) - ex) < 0.115 * u && Math.abs(p.y - ey) < 0.04 * u;
  const vent = (p: THREE.Vector3) => {
    if (Math.abs(p.x) > 0.17 * u) return false;
    for (const y of [-0.32, -0.38, -0.44]) if (Math.abs(p.y - P.h(0, y, 0)[1]) < 0.0125 * u) return true;
    return false;
  };
  if ((o.style ?? 'plate') === 'plate') {
    const upper = shellPatch(ellipsoidFn(cc, R, [-0.95, 0.95], [-0.5, 0.5], { radial: (a) => 1 + 0.05 * Math.cos(a * 2) }), 14, 9, 0.011 * sc, { noInner: true, cull: (p) => eyeSlit(p) || vent(p) });
    gear(upper, { bone: 'head', color, mat: IM, ao: 0.85 });
  } else {
    // cage: a brow band over the eyes and vertical bars down the face
    const brow = shellPatch(ellipsoidFn(cc, R, [-0.95, 0.95], [0.18, 0.5]), 14, 2, 0.012 * sc, { noInner: true });
    gear(brow, { bone: 'head', color, mat: IM, ao: 0.85 });
    for (let k = -2; k <= 2; k++) {
      const az = k * 0.3;
      const pts: THREE.Vector3[] = [];
      const nrm: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const el = lerp(0.2, -0.5, i / 5);
        const d = V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
        pts.push(V(d.x * R[0], d.y * R[1], d.z * R[2]).add(cc));
        nrm.push(V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize());
      }
      gear(ribbon(pts, nrm, 0.04 * u, 0.012 * sc, 1, { outerOnly: true, noInner: true }, 5), { bone: 'head', color, mat: IM, ao: 0.85 });
    }
  }
  const lower = shellPatch(ellipsoidFn(cc, R, [-0.8, 0.8], [-0.82, -0.52], { radial: (a) => 1 + 0.05 * Math.cos(a * 2) }), 14, 4, 0.011 * sc, { noInner: true });
  gear(lower, { bone: 'jaw', color, mat: IM, ao: 0.85 });
  // central nose ridge and cheek rivets
  const pts = [H(0, 0.02, 0.57), H(0, -0.12, 0.62), H(0, -0.28, 0.63)];
  gear(ribbon(pts, [V(0, 0.2, 1).normalize(), V(0, 0, 1), V(0, -0.15, 1).normalize()], 0.06 * u, 0.026 * sc, 1, { outerOnly: true }), { bone: 'head', color: URUK_PAL.iron2, mat: IM, small: true });
  for (const sx of [1, -1])
    for (let k = 0; k < 3; k++) {
      const a = sx * (0.6 + k * 0.12);
      const el = -0.1 - k * 0.2;
      const d = V(Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a));
      const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(cc);
      const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
      gear(rivet(0.0085 * sc, 4), { bone: 'head', color: o.rivetColor ?? URUK_PAL.ironLt, mat: IM, matrix: placeAlong(p.addScaledVector(nn, 0.005 * sc), nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  // cheek spikes
  for (const sx of o.cheekSpikes === false ? [] : [1, -1]) {
    const a = sx * 0.9;
    const el = -0.35;
    const d = V(Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a));
    const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(cc);
    gear(spike(0.022 * u, 0.12 * u, 5), { bone: 'head', color: URUK_PAL.iron2, mat: IM, matrix: placeAlong(p, V(sx * 1, -0.1, 0.4), V(0, 0, 1)), small: true });
  }
}

/** the white hand on the helmet brow */
export function helmetHand(ctx: KindContext, gear: GearFn, h: HelmetInfo, size = 1) {
  const { P } = ctx;
  const u = P.headH;
  const pad = 0.0035 * P.s;
  const proj = ellipsoidProjector(h.C, [h.R[0] + pad, h.R[1] + pad, h.R[2] + pad]);
  const pos = v3(P.h(0, 0.27, 0.35));
  const n = V();
  proj.project(pos, n);
  const y = V(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, n);
  const frame = new THREE.Matrix4().makeBasis(x, y, n.clone()).setPosition(pos);
  const geo = handStrips(proj, frame.multiply(new THREE.Matrix4().makeTranslation(0, 0.02 * u * size, 0)), 0.36 * u * size, 0.0018 * P.s, { jitter: 0.012, seed: 3 });
  if (geo) gear(geo, { bone: 'head', color: URUK_PAL.white, mat: WHITE_PAINT });
}

/** white hand printed on the body (skin or armour): `pos` is a rough point, snapped by casting from `mode` */
export function printHand(
  ctx: KindContext,
  gear: GearFn,
  proj: Projector,
  o: { pos: [number, number, number]; mode?: SnapMode; up?: [number, number, number]; size: number; bone: string; rot?: number; seed?: number; paint?: number; mat?: typeof WHITE_PAINT; wrist?: boolean },
) {
  const { P } = ctx;
  const p = V();
  const n = V();
  if (!snapPoint(proj, o.pos, o.mode ?? 'f', p, n)) return;
  const frame = frameAt(p, n, o.up ? V(...o.up) : V(0, 1, 0));
  if (o.rot) frame.multiply(new THREE.Matrix4().makeRotationZ(o.rot));
  const seed = o.seed ?? 1;
  const geo = handStrips(proj, frame, o.size, 0.0022 * P.s, { wrist: o.wrist ?? true, samples: 5, jitter: 0.035, seed });
  if (!geo) return;
  const base = new THREE.Color().setHex(o.paint ?? URUK_PAL.white, THREE.SRGBColorSpace);
  gear(geo, {
    bone: o.bone,
    color: o.paint ?? URUK_PAL.white,
    mat: o.mat ?? surface('skin_orc', { rough: 0.82, skin: 0.2 }),
    colorFn: (q, _n, c) => {
      // smudged, uneven paint
      const t = 0.84 + 0.16 * Math.sin(q.x * 70 + seed) * Math.sin(q.y * 55 + q.z * 40 + seed * 2);
      c.copy(base).multiplyScalar(t);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// the extras
// ─────────────────────────────────────────────────────────────────────────────

function urukExtras(berserker: boolean) {
  return (ctx: KindContext) => {
    const { P, sculpt: s } = ctx;
    const sc = P.s;
    const gear = gearOf(ctx);
    const bucket = bucketOf(ctx.spec.seed);
    const look = urukLook(bucket);
    const bl = berserkLook(bucket);
    const parts = anatomyParts(P);
    const armor = ctx.armor;
    const j = P.j;
    const u = P.headH;
    const box = { min: [-0.7, 0, -0.5] as [number, number, number], max: [0.7, P.H + 0.2, 0.6] as [number, number, number] };

    brawnBody(ctx, berserker ? { traps: 1.0, lats: 1.1, delts: 1.1, forearm: 1.12, thigh: 1.3, calf: 1.05, biceps: 1.15 } : { traps: 1.0, lats: 1.0, delts: 1.0, forearm: 1.05, thigh: 1.42, calf: 1.28 });

    // sheet landmarks (metres above the sole at the sheet's scale): belt ~1.19 (uruk) / ~1.27 (berserker)
    const hipY = j.thigh_l[1];
    const beltY = hipY + (berserker ? 0.19 : 0.125) * sc;
    let botY = 0;
    const doCuirass = !berserker && armor >= 0.25 && look.cuirass !== 'none';
    if (doCuirass) botY = cuirassSdf(ctx, look, parts, { lats: 1.0, mat: SHEET_IRON, color: look.cuirass === 'plate' ? SP.iron : look.cuirass === 'mail' ? SP.mail : SP.strap, raise: 0.015 }).botY;
    if (!berserker && look.gorget && armor >= 0.5) gorget(ctx, parts, { mat: SHEET_IRON, color: SP.iron });
    if (!berserker && armor >= 0.25 && look.vambraces) forearms(ctx, parts, 'plate', 1.12, { mat: SHEET_IRON, color: SP.iron, from: 0.08 });
    else if (!berserker && look.wraps) forearms(ctx, parts, 'wraps', 1.05);
    // greaves over the boots (sheet: plated shins and knee cops)
    if (!berserker && armor >= 0.25) greaves(ctx, parts);
    // the berserker's kilt hangs from the high belt: dark cloth under it (waist to just above the hem) so the
    // gaps between the kilt's panels never show bare skin
    if (berserker) {
      const kneeY = j.shin_l[1];
      const hemY = hipY - (hipY - kneeY) * 0.88 * 1.1;
      underSkirt(ctx, parts, { topY: beltY + 0.035 * sc, botY: hemY + 0.12 * (hipY - kneeY) });
    }

    // bare chests get defined abdominals and ribs
    if (berserker || !doCuirass) {
      const p0 = makeProjector(s, box);
      if (p0) bareTorso(ctx, p0, { abs: berserker ? 1.15 : 0.8, ribs: berserker ? 0.9 : 0.5 });
    }

    // sheet face: deep eye sockets and a darker, greyer lower face (the open-faced uruk only)
    if (!berserker && !look.nasal) {
      s.mirrored(() => s.ellipsoid(P.h(0.135, -0.07, 0.34), [0.1 * u, 0.065 * u, 0.07 * u], { op: 'paint', k: 0.03 * u, color: 0x1b100d, mat: 'skin_brute', bone: 'head', strength: 0.5 }));
      s.ellipsoid(P.h(0, -0.38, 0.3), [0.3 * u, 0.2 * u, 0.3 * u], { op: 'paint', k: 0.06 * u, color: 0x2b201c, mat: 'skin_brute', bone: 'head', strength: 0.4 });
    }

    // facial scar (carved)
    if (berserker ? bl.scar : look.scar) {
      const sg = (berserker ? bucket % 2 === 0 : bucket % 2 === 1) ? 1 : -1;
      s.cone(P.h(0.2 * sg, 0.06, 0.37), P.h(0.07 * sg, -0.3, 0.44), 0.012 * u, 0.007 * u, { op: 'subtract', k: 0.006 * u, color: 0x6a3a30, paintCarve: true, mat: 'skin_orc', bone: 'head' });
    }

    // ── rigid gear (needs the finished sculpt for placement) ──
    const proj = makeProjector(s, box);
    if (proj && doCuirass) {
      const plate = look.cuirass === 'plate';
      cuirassGear(ctx, gear, proj, look, botY, { noBelly: true, mat: SHEET_IRON });
      if (plate) chestLames(ctx, gear, proj, botY);
    }
    if (proj && !berserker && armor >= 0.25) {
      beltAndFaulds(ctx, gear, proj, { beltY, lames: 2 });
      greaveLames(ctx, gear, proj, { n: 2 });
    }

    if (armor >= 0.5 && !berserker) {
      const pa = look.pauldrons;
      // flatter plates stepping down over the shoulder, riveted along each lame
      const po = { color: SP.iron, mat: SHEET_IRON, reach: 1.45, ry: 0.42, half: 66, rivets: 2 };
      if (pa === 'r' || pa === 'both') pauldron(ctx, gear, -1, { lames: 4, spikes: look.spikes, scale: 1.12, ...po });
      if (pa === 'l' || pa === 'both') pauldron(ctx, gear, 1, { lames: 4, spikes: 0, scale: pa === 'both' ? 1.08 : 1.12, ...po });
    }

    if (berserker && proj) {
      berserkerBelt(ctx, gear, proj, beltY);
      legWraps(ctx, gear, proj);
      if (armor >= 0.25) {
        if (bl.shoulder === 'l' || bl.shoulder === 'both') pauldron(ctx, gear, 1, { lames: 2, spikes: 5, scale: 0.9, rusty: true, mat: SHEET_IRON, color: SP.iron });
        if (bl.shoulder === 'r' || bl.shoulder === 'both') pauldron(ctx, gear, -1, { lames: 2, spikes: 5, scale: 0.9, rusty: true, mat: SHEET_IRON, color: SP.iron });
        // leather bandolier across the chest
        if (bl.bandolier !== 0) {
          const sx = bl.bandolier;
          strapSnapped(
            gear,
            proj,
            [
              [-sx * 0.1 * sc, j.upperarm_l[1] + 0.05 * sc, -0.02 * sc, 't'],
              [-sx * 0.09 * sc, j.upperarm_l[1] - 0.04 * sc, 0.16 * sc, 'f'],
              [0.0, j.chest[1] - 0.04 * sc, 0.2 * sc, 'f'],
              [sx * 0.1 * sc, j.thigh_l[1] + 0.2 * sc, 0.18 * sc, 'f'],
            ],
            0.042 * sc,
            0.009 * sc,
            { bone: 'chest', color: SP.strap, mat: SHEET_LEATHER },
          );
        }
      }
      // dirty white handprints (sheet: one per pec, one per deltoid on the outer side, one per shoulder blade)
      const dy = j.upperarm_l[1];
      const sh = P.build.shoulders;
      const f = bl.flip ? -1 : 1;
      type PrintSpot = { pos: [number, number, number]; mode?: SnapMode; up?: [number, number, number]; size: number; rot?: number; bone: string };
      const prints: PrintSpot[] = [
        { pos: [0.088 * sc * sh, dy - 0.1 * sc, 0.3 * sc], size: 0.15 * sc, rot: -0.3 * f, bone: 'chest' },
        { pos: [-0.088 * sc * sh, dy - 0.1 * sc, 0.3 * sc], size: 0.15 * sc, rot: 0.3 * f, bone: 'chest' },
        { pos: [P.shoulderX * 1.05 + 0.18 * sc, dy - 0.03 * sc, 0.0], mode: 'l', up: [0, 1, 0], size: 0.15 * sc, rot: (Math.PI / 2) * f, bone: 'upperarm_l' },
        { pos: [-(P.shoulderX * 1.05 + 0.18 * sc), dy - 0.03 * sc, 0.0], mode: 'r', up: [0, 1, 0], size: 0.15 * sc, rot: (-Math.PI / 2) * f, bone: 'upperarm_r' },
        { pos: [0.1 * sc * sh, dy - 0.12 * sc, -0.3 * sc], mode: 'b', size: 0.16 * sc, rot: -0.2 * f, bone: 'chest' },
        { pos: [-0.1 * sc * sh, dy - 0.12 * sc, -0.3 * sc], mode: 'b', size: 0.16 * sc, rot: 0.2 * f, bone: 'chest' },
      ];
      bl.prints.forEach((pi, i) => dirtyHand(ctx, gear, proj, { ...prints[pi], seed: i + 1 + bucket * 5, skin: ctx.def.skin.color }));
      muscleShade(ctx, proj, { dark: 0x1f1511 });
      // huge two-handed sword
      scaleHeldWeapon(ctx, 'hand_r', ['sword'], [1.9, 1.25, 1.9]);
    }

    if (ctx.helmet && (berserker || look.helm !== 'none')) {
      const style = berserker ? 'cap' : look.helm === 'none' ? 'dome' : look.helm;
      const h = helmet(ctx, gear, {
        style,
        nasal: !berserker && look.nasal,
        cheeks: !berserker && look.cheeks,
        cheekDrop: 0.4,
        rivets: 6,
        spikes: berserker ? 0 : style === 'cap' ? 5 : 0,
        crest: berserker ? bl.crest : 1,
        color: berserker ? SP.bhelm : SP.iron,
        mat: SHEET_IRON,
        ...(berserker ? { rivets: 5, domeSeg: [16, 5] as [number, number], scale: 1.16, ring: Math.max(6, Math.min(8, Math.round(bl.spikes * 0.75))), rivetColor: SP.copper } : {}),
      });
      if (berserker) muzzleMask(ctx, gear, { style: bl.mask, cheekSpikes: bl.cheekSpikes, color: SP.bhelm, mat: SHEET_IRON, scale: 1.16, rivetColor: SP.copper });
      if (look.hand === 'helm' || berserker) helmetHand(ctx, gear, h, berserker ? 1.1 : 1);
    }
    if (proj && look.hand === 'chest' && doCuirass) {
      printHand(ctx, gear, proj, { pos: [0.0, j.upperarm_l[1] - 0.1 * sc, 0.3 * sc], size: 0.17 * sc, bone: 'chest', mat: WHITE_PAINT, wrist: false });
    }
    // an earring (ring through the ear) for some
    if (!berserker && look.earring) {
      const c = P.h(-0.43, -0.2, -0.02);
      gear(new THREE.TorusGeometry(0.02 * u * 1.6, 0.0035 * sc, 5, 10), { bone: 'head', color: URUK_PAL.bone, mat: surface('bone', { rough: 0.5 }), matrix: new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), small: true });
    }
    void lathe;
    void ellipticalBand;
  };
}

/** a loadout (right hand, off hand) for a seed: sword + shield, archer, or pikeman; for chapter authors */
export function urukLoadout(seed: number | undefined, kind: 'uruk' | 'berserker' = 'uruk'): { weapon: 'sword' | 'uruk_bow' | 'pike'; offhand: 'shield' | 'none' } {
  if (kind === 'berserker') return { weapon: 'sword', offhand: 'none' };
  const b = hashSeed('loadout', seed ?? 0) % 6;
  if (b < 3) return { weapon: 'sword', offhand: 'shield' };
  if (b < 5) return { weapon: 'uruk_bow', offhand: 'none' };
  return { weapon: 'pike', offhand: 'none' };
}

const URUK_FACE = {
  jaw: 1.22,
  jawLength: 1.08,
  chin: 0.85,
  brow: 1.55,
  cheekbones: 1.18,
  nose: { length: 0.85, width: 1.4, bridge: 0.65, hook: 0, tip: 1.05, flat: 0.75 },
  lips: { width: 1.15, fullness: 0.75 },
  ears: 'orc' as const,
  earSize: 1.0,
  eyeSize: 0.88,
  eyeSpacing: 1.0,
  eyeTilt: -0.07,
  eyeOpen: 0.72,
  tusks: 0.42, // sheet face: two prominent lower fangs
  underbite: 0.5,
  foreheadSlope: 0.5,
  asym: 0.3,
  cranium: 0.94,
};

const SHEET_TROUSERS = surface('leather_worn', { rough: 0.8 });
const SHEET_KILT = surface('rags', { rough: 0.95 });
const SHEET_BOOT = surface('leather_worn', { rough: 0.78 });
/** uruk face and body skin: brute skin with a gentler pore pattern and a drier, rougher finish */
const URUK_SKIN = surface('skin_brute', { rough: 0.52, sheen: 0.02, pat: { pores: 0.8, wrinkles: 0.5 } }) as unknown as SurfaceName;

export const urukKinds: Record<'uruk' | 'berserker', KindDef> = {
  uruk: {
    label: 'Uruk-hai',
    // sheet: 2.0 m anatomy + helmet = 2.14 m overall; the helmet sits inside the head's height here
    height: 2.15,
    build: { shoulders: 1.3, hips: 1.04, bulk: 1.16, chest: 1.14, belly: 0.0, armLength: 1.07, legLength: 0.98, headSize: 1.03, neck: 0.92, neckThick: 1.3, hunch: 0.14, handSize: 1.2, footSize: 1.12, muscle: 0.95 },
    face: URUK_FACE,
    skin: { color: SP.skin, color2: SP.skin2, blotch: 0.5, blemish: 0.45, scars: 0, warts: 0.1, wrinkles: 0.5, lips: SP.lips, brows: 0x0d0a08, surface: URUK_SKIN, scatter: SP.scatter },
    eyes: { color: SP.eyes, glow: 0.35, sclera: 0xb8a878 },
    hair: { style: 'long_straight', color: URUK_PAL.hair, density: 0.12, length: 0.95 },
    outfit: [
      { type: 'trousers', color: SP.trousers, mat: SHEET_TROUSERS },
      { type: 'boots', color: SP.boots, color2: SP.boots2, mat: SHEET_BOOT, length: 0.92 },
      // belt raised to the sheet's ~1.19 m; the plate straps are sculpted over it in extras
      { type: 'belt', color: SP.belt, offset: 0.055 },
      // knee-length ragged black kilt with hanging leather strips over it (sheet details: cloth/leather)
      // front and back cloth panels only (the hip lames cover the sides), leather strips hang over them
      { type: 'loincloth', color: SP.kilt, color2: SP.kilt2, mat: SHEET_KILT, length: 0.88, thickness: 0.045, strips: { count: 5, color: SP.strip, color2: SP.strip2, mat: 'leather_worn', width: 0.05, length: 0.8, phase: 0.25 } },
    ],
    armor: [],
    weapons: { right: 'sword', left: 'shield', style: 'uruk' },
    palette: URUK_PAL,
    sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.7 },
    anim: { hunch: 0.14, swagger: 0.4, aggression: 0.8, stance: 1.35, armSwing: 1.0, cadence: 1.0 },
    variation: { height: 0.025, bulk: 0.06, skin: 0.12 },
    detail: { faceRes: 0, res: 0.094, headRes: 0.0175 },
    extras: urukExtras(false),
  },
  berserker: {
    label: 'Uruk berserker',
    // sheet: 2.10 m anatomy + spiked helmet = 2.25 m overall
    height: 2.18,
    build: { shoulders: 1.28, hips: 1.0, bulk: 1.22, chest: 1.13, belly: 0.0, armLength: 1.08, legLength: 0.97, headSize: 1.08, neck: 0.9, neckThick: 1.3, hunch: 0.16, handSize: 1.25, footSize: 1.3, muscle: 1.0 },
    face: URUK_FACE,
    skin: { color: SP.bskin, color2: SP.bskin2, blotch: 0.5, blemish: 0.45, scars: 0, warts: 0.1, wrinkles: 0.5, lips: URUK_PAL.lips, brows: 0x120e0b, surface: URUK_SKIN, scatter: SP.bscatter },
    eyes: { color: 0xd0a030, glow: 0.5, sclera: 0xb8a878 },
    hair: { style: 'long_straight', color: URUK_PAL.hair, density: 0.12, length: 0.8 },
    outfit: [
      // bare thighs and calves; sandals with wrapped lower legs (wraps are strapped on in extras)
      { type: 'boots', color: SP.bwrap, color2: SP.bwrap2, mat: SHEET_BOOT, length: 0.98 },
      { type: 'belt', color: SP.bbelt, offset: 0.12 },
      // thick black cloth kilt to the knee
      // 'rags' (the string) is what tears the hem; a spec object would leave it straight
      { type: 'skirt', color: SP.bkilt, color2: SP.bkilt, mat: 'rags', length: 0.88, thickness: 0.045 },
    ],
    armor: [],
    // the sheet's two-handed sword is a straight broadsword, not the falchion
    weapons: { right: 'sword', left: 'none' },
    palette: URUK_PAL,
    sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.8 },
    anim: { hunch: 0.16, swagger: 0.55, aggression: 1, stance: 1.4, armSwing: 1.1, cadence: 1.0 },
    variation: { height: 0.02, bulk: 0.05, skin: 0.1 },
    detail: { faceRes: 0, res: 0.078, headRes: 0.0175 },
    extras: urukExtras(true),
  },
};
