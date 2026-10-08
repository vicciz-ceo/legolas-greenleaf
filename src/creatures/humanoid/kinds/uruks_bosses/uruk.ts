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
import { surface } from '../../../kit/surfaces';
import type { Sculpt } from '../../../kit/sdf';
import { brawnBody } from './body';
import {
  V, v3, bucketOf, gearOf, shellPatch, ellipsoidFn, ribbon, spike, rivet, ellipticalBand, placeAlong, lerp, smooth, makeProjector, ringRadii, surfaceDecal, ellipsoidProjector,
  whiteHandMask, type GearFn, type Projector, lathe,
} from './common';

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
  strap: 0x241a13,
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
  helm: 'dome' | 'ridge' | 'cap';
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
  { cuirass: 'plate', pauldrons: 'r', helm: 'dome', hand: 'helm', nasal: true, cheeks: true, vambraces: true, wraps: false, scar: false, earring: false, gorget: false, trophy: false, spikes: 0 },
  { cuirass: 'studded', pauldrons: 'both', helm: 'ridge', hand: 'helm', nasal: false, cheeks: true, vambraces: false, wraps: true, scar: true, earring: true, gorget: false, trophy: false, spikes: 3 },
  { cuirass: 'plate', pauldrons: 'l', helm: 'cap', hand: 'chest', nasal: true, cheeks: false, vambraces: true, wraps: false, scar: true, earring: false, gorget: true, trophy: true, spikes: 0 },
  { cuirass: 'mail', pauldrons: 'none', helm: 'dome', hand: 'helm', nasal: true, cheeks: true, vambraces: true, wraps: true, scar: false, earring: true, gorget: true, trophy: false, spikes: 0 },
];

export function urukLook(bucket: number): UrukLook {
  return LOOKS[bucket % LOOKS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// armour
// ─────────────────────────────────────────────────────────────────────────────

/** layered shoulder plate (spaulder). side +1 = left (+X). */
export function pauldron(ctx: KindContext, gear: GearFn, side: 1 | -1, o: { lames: number; spikes: number; scale?: number; color?: number; rusty?: boolean }) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const bone = side > 0 ? 'upperarm_l' : 'upperarm_r';
  const J = v3(P.j[bone]);
  const L = P.hand.l.L.clone();
  L.x *= side;
  const top = new THREE.Vector3(0.6 * side, 0.8, 0.05).normalize();
  const k0 = o.scale ?? 1;
  const mat = o.rusty ? IRON_RUSTY : IRON;
  for (let k = 0; k < o.lames; k++) {
    const axis = top.clone().lerp(L, k * 0.22).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
    const R = (0.1 - k * 0.003) * sc * g * k0;
    const c = J.clone().addScaledVector(L, (0.03 + k * 0.034) * sc).add(V(-0.012 * side * sc, 0.0, 0));
    const half = (66 - k * 5) * (Math.PI / 180);
    const fn = ellipsoidFn(c, [R * 1.05, R * 0.78, R * 1.1], [-Math.PI, Math.PI], [Math.PI / 2 - half, Math.PI / 2], { rot });
    gear(shellPatch(fn, 14, 4, 0.0075 * sc, { closedU: true, noInner: true, thickFn: (_u, v) => 1 + 1.1 * (1 - smooth(0, 0.18, v)), skip: ['v1'] }), {
      bone,
      color: o.color ?? URUK_PAL.iron,
      mat,
      ao: 0.85,
    });
  }
  const rot = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), top);
  const R0 = 0.1 * sc * g * k0;
  const c0 = J.clone().addScaledVector(L, 0.03 * sc).add(V(-0.012 * side * sc, 0, 0));
  for (let i = 0; i < o.spikes; i++) {
    const a = ((i + 0.5) / o.spikes) * Math.PI * 2;
    const d = V(Math.sin(a) * 1.05, 0.7, Math.cos(a) * 1.1).normalize().applyQuaternion(rot);
    const p = c0.clone().add(V(d.x * R0 * 0.98, d.y * R0 * 0.98, d.z * R0 * 0.98));
    gear(spike(0.013 * sc, 0.07 * sc, 5), { bone, color: URUK_PAL.iron2, mat: IRON, matrix: placeAlong(p, d, V(0, 0, 1)), small: true });
  }
}

/** SDF part of the torso armour; returns the lower edge height */
export function cuirassSdf(ctx: KindContext, look: Pick<UrukLook, 'cuirass'>, parts: Part[], o: { rusty?: boolean; color?: number } = {}) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const botY = hipY + 0.14 * sc;
  const kind = look.cuirass;
  const plate = kind === 'plate';
  const mat = plate ? (o.rusty ? IRON_RUSTY : IRON) : kind === 'mail' ? surface('mail', { rough: 0.5 }) : LEATHER;
  const color = o.color ?? (plate ? URUK_PAL.iron : kind === 'mail' ? 0x35353a : URUK_PAL.leather);
  const infl = (plate ? 0.021 : kind === 'mail' ? 0.014 : 0.018) * sc;
  s.group('union', 0.003 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist'], {
      color,
      mat,
      inflate: infl,
      k: 0.012 * sc,
      noise: plate ? { amp: 0.0016 * sc, freq: 38 / sc, type: 'dents' } : kind === 'studded' ? { amp: 0.002 * sc, freq: 25 / sc, type: 'ridged' } : undefined,
    });
    // neckline: high at the back, lower at the front
    s.plane([0, 1, 0.5], j.neck[1] + 0.012 * sc, { op: 'intersect', k: 0.006 * sc });
    s.plane([0, -1, 0], -botY, { op: 'intersect', k: 0.004 * sc });
    s.mirrored(() => s.plane([1, -0.25, 0], P.shoulderX * 0.86 - 0.25 * j.upperarm_l[1], { op: 'intersect', k: 0.014 * sc }));
  });
  return { botY };
}

/** rigid parts of the torso armour (needs a projector for the finished sculpt) */
export function cuirassGear(ctx: KindContext, gear: GearFn, proj: Projector, look: Pick<UrukLook, 'cuirass'>, botY: number) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const plate = look.cuirass === 'plate';
  const hipY = j.thigh_l[1];
  // belly lames (overlapping elliptical bands from the cuirass edge down to the belt)
  const n = plate ? 3 : look.cuirass === 'mail' ? 2 : 0;
  const hBand = 0.058 * sc;
  for (let k = 0; k < n; k++) {
    const yTop = botY + 0.012 * sc - k * 0.045 * sc;
    const yBot = yTop - hBand;
    const rt = ringRadii(proj, yTop);
    const rb = ringRadii(proj, yBot);
    const m = new THREE.Matrix4().makeTranslation(0, (yTop + yBot) / 2, 0);
    const g = ellipticalBand(rt.rx + 0.012 * sc, (rt.zf + rt.zb) / 2 + 0.012 * sc, rb.rx + 0.022 * sc, (rb.zf + rb.zb) / 2 + 0.022 * sc, hBand, 0.0065 * sc, 22, 0, Math.PI * 2, (rt.zf - rt.zb) / 2);
    gear(g, { bone: 'spine', color: URUK_PAL.iron, mat: IRON, matrix: m, ao: 0.85 });
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
    if (pts.length > 3) gear(ribbon(pts, nrm, 0.03 * sc, 0.011 * sc, 1, { outerOnly: true, noInner: true }), { bone: 'chest', color: URUK_PAL.iron2, mat: IRON, small: true });
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
        gear(rivet(0.0085 * sc, 5), { bone: 'chest', color: URUK_PAL.ironLt, mat: IRON, matrix: placeAlong(p, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
  }
}

function limbCut(s: Sculpt, L: THREE.Vector3, at: [number, number, number], keepBeyond: boolean, k: number) {
  const n = keepBeyond ? L.clone().multiplyScalar(-1) : L.clone();
  s.plane([n.x, n.y, n.z], n.x * at[0] + n.y * at[1] + n.z * at[2], { op: 'intersect', k });
}

/** forearm guards (plate / leather) or bandage wraps */
export function forearms(ctx: KindContext, parts: Part[], kind: 'plate' | 'wraps' | 'leather') {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const L = P.hand.l.L;
  const j = P.j;
  const plate = kind === 'plate';
  const from = kind === 'plate' ? 0.2 : kind === 'leather' ? 0.12 : 0.4;
  s.mirrored(() =>
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['forearm'], {
        color: plate ? URUK_PAL.iron : kind === 'leather' ? 0x1e1712 : 0x4a4236,
        mat: plate ? IRON : kind === 'leather' ? LEATHER : surface('rags', { rough: 0.95 }),
        inflate: (plate ? 0.011 : kind === 'leather' ? 0.01 : 0.007) * sc,
        k: 0.014 * sc,
        oneSide: true,
        noise: kind === 'wraps' ? { amp: 0.0025 * sc, freq: 50 / sc, type: 'ridged' } : undefined,
      });
      limbCut(s, L, [j.hand_l[0] - L.x * 0.012 * sc, j.hand_l[1] - L.y * 0.012 * sc, j.hand_l[2]], false, 0.004 * sc);
      limbCut(s, L, [j.forearm_l[0] + L.x * P.foreArm * from, j.forearm_l[1] + L.y * P.foreArm * from, j.forearm_l[2]], true, 0.004 * sc);
    }),
  );
}

export function gorget(ctx: KindContext, parts: Part[]) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  s.group('union', 0.004 * sc, () => {
    emitParts(s, parts, ['neck', 'trap'], { color: URUK_PAL.iron, mat: IRON, inflate: 0.016 * sc, k: 0.02 * sc });
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
export function helmet(ctx: KindContext, gear: GearFn, o: { style: UrukLook['helm']; nasal: boolean; cheeks: boolean; spikes?: number; color?: number; crest?: number; brow?: boolean }): HelmetInfo {
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => v3(P.h(x, y, z));
  const iron = o.color ?? URUK_PAL.iron;
  const C = H(0, 0.045, -0.05);
  const R: [number, number, number] = [0.405 * u, 0.48 * u, 0.505 * u];
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
  const shell = shellPatch(ellipsoidFn(C, R, [-Math.PI, Math.PI], [elOf, Math.PI / 2 - 1e-3], { radial }), 26, 7, 0.011 * sc, {
    closedU: true,
    noInner: true,
    thickFn: (_u2, v) => 1 + 0.9 * (1 - smooth(0, 0.12, v)),
    skip: ['v1'],
  });
  const wearFn = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const rel = (p.y - C.y) / u;
    c.multiplyScalar(1 + 0.6 * smooth(0.0, -0.25, rel));
  };
  gear(shell, { bone: 'head', color: iron, mat: IRON, ao: 0.9, colorFn: wearFn });

  if (o.style === 'dome' || o.style === 'ridge') {
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const e = lerp(0.25, Math.PI - 0.55, i / n);
      pts.push(V(0, Math.sin(e) * R[1] * 1.03, Math.cos(e) * R[2] * 1.03).add(C));
      nrm.push(V(0, Math.sin(e) / R[1], Math.cos(e) / R[2]).normalize());
    }
    gear(ribbon(pts, nrm, 0.05 * u * (o.style === 'ridge' ? 1.3 : 1), (o.style === 'ridge' ? 0.07 : 0.035) * u, 1, { outerOnly: true, noInner: true }), { bone: 'head', color: URUK_PAL.iron2, mat: IRON, ao: 0.9 });
  }
  for (let i = 0; i < 9; i++) {
    const a = lerp(-2.6, 2.6, i / 8);
    const e = elOf(a) + 0.12;
    const d = V(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    const k = radial(a, e);
    const p = V(d.x * R[0] * k, d.y * R[1] * k, d.z * R[2] * k).add(C);
    const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    gear(rivet(0.0075 * sc, 5), { bone: 'head', color: URUK_PAL.ironLt, mat: IRON, matrix: placeAlong(p.addScaledVector(nn, 0.005 * sc), nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
  if (o.nasal) {
    const pts = [H(0, 0.04, 0.458), H(0, -0.07, 0.505), H(0, -0.2, 0.545)];
    const nrm = [V(0, 0.15, 1).normalize(), V(0, 0, 1), V(0, -0.2, 1).normalize()];
    gear(ribbon(pts, nrm, 0.05 * u, 0.012 * sc, 1, { outerOnly: true }), { bone: 'head', color: iron, mat: IRON, small: true });
  }
  if (o.cheeks) {
    for (const sx of [1, -1]) {
      const fn = ellipsoidFn(H(0, -0.16, 0.03), [0.41 * u, 0.5 * u, 0.45 * u], sx > 0 ? [0.95, 1.5] : [-1.5, -0.95], [-0.5, 0.1]);
      gear(shellPatch(fn, 5, 5, 0.008 * sc, { noInner: true }), { bone: 'head', color: iron, mat: IRON, small: true, ao: 0.9 });
    }
  }
  const spikes = o.spikes ?? 0;
  for (let i = 0; i < spikes; i++) {
    const t = (i + 0.5) / spikes;
    const e = lerp(0.35, Math.PI - 0.6, t);
    const p = V(0, Math.sin(e) * R[1], Math.cos(e) * R[2]).add(C);
    const nn = V(0, Math.sin(e) / R[1], Math.cos(e) / R[2]).normalize();
    const hgt = (0.16 + 0.14 * Math.sin(t * Math.PI)) * u * (o.crest ?? 1);
    gear(spike(0.034 * u, hgt, 6), { bone: 'head', color: URUK_PAL.iron2, mat: IRON, matrix: placeAlong(p, nn, V(0, 0, 1)), small: true });
  }
  return { C, R, rimY, elOf, radial };
}

/** berserker face mask: slatted muzzle plates, brow band, eye slits */
export function muzzleMask(ctx: KindContext, gear: GearFn, color = URUK_PAL.iron) {
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => v3(P.h(x, y, z));
  const cc = H(0, -0.22, 0.02);
  const R: [number, number, number] = [0.36 * u, 0.52 * u, 0.53 * u];
  const lames: [number, number, string][] = [
    [-0.34, -0.2, 'head'],
    [-0.5, -0.35, 'head'],
    [-0.72, -0.56, 'jaw'],
  ];
  for (const [e0, e1, bone] of lames) {
    const fn = ellipsoidFn(cc, R, [-0.95, 0.95], [e0, e1], { radial: (a) => 1 + 0.06 * Math.cos(a * 2) });
    gear(shellPatch(fn, 8, 2, 0.011 * sc, { noInner: true }), { bone, color, mat: IRON, ao: 0.85, small: false });
  }
  // brow band over the eyes
  const fnB = ellipsoidFn(H(0, 0.0, -0.02), [0.4 * u, 0.5 * u, 0.5 * u], [-1.25, 1.25], [0.05, 0.3]);
  gear(shellPatch(fnB, 10, 2, 0.013 * sc, { noInner: true }), { bone: 'head', color, mat: IRON, ao: 0.85 });
  // nose plate
  const pts = [H(0, 0.05, 0.5), H(0, -0.1, 0.57), H(0, -0.3, 0.6)];
  const nrm = [V(0, 0.15, 1).normalize(), V(0, 0, 1), V(0, -0.15, 1).normalize()];
  gear(ribbon(pts, nrm, 0.09 * u, 0.02 * sc, 1, { outerOnly: true }), { bone: 'head', color: URUK_PAL.iron2, mat: IRON, small: true });
}

/** the white hand on the helmet brow */
export function helmetHand(ctx: KindContext, gear: GearFn, h: HelmetInfo, size = 1) {
  const { P } = ctx;
  const u = P.headH;
  const proj = ellipsoidProjector(h.C, [h.R[0] + 0.007 * P.s, h.R[1] + 0.007 * P.s, h.R[2] + 0.007 * P.s]);
  const pos = v3(P.h(0, 0.255, 0.35));
  const n = V();
  proj.project(pos, n);
  const y = V(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, n);
  const frame = new THREE.Matrix4().makeBasis(x, y, n.clone()).setPosition(pos);
  const S = 0.34 * u * size;
  const d = surfaceDecal({
    proj,
    frame,
    w: S * 1.1,
    h: S * 1.2,
    cell: 0.0046 * P.s,
    mask: (px, py) => whiteHandMask(px / S, py / S + 0.1, 0.03),
    lift: 0.0028 * P.s,
    paint: URUK_PAL.white,
    skin: URUK_PAL.iron,
    streak: (px, py) => Math.sin(px * 90) * 0.5 + Math.sin(py * 55 + px * 20) * 0.5,
  });
  if (d) gear(d.geo, { bone: 'head', color: URUK_PAL.white, mat: WHITE_PAINT, colorFn: d.colorFn });
}

/** white hand printed on the body (cuirass or skin): `pos` is a rough point in front of the surface */
export function printHand(ctx: KindContext, gear: GearFn, proj: Projector, o: { pos: [number, number, number]; up?: [number, number, number]; size: number; bone: string; base: number; rot?: number; seed?: number; cell?: number; mat?: typeof WHITE_PAINT }) {
  const { P } = ctx;
  const p = V(...o.pos);
  const n = V();
  if (!proj.project(p, n)) return;
  const up = o.up ? V(...o.up) : V(0, 1, 0);
  const frame = new THREE.Matrix4();
  const y = up.clone().addScaledVector(n, -up.dot(n)).normalize();
  const x = new THREE.Vector3().crossVectors(y, n);
  frame.makeBasis(x, y, n.clone()).setPosition(p);
  if (o.rot) frame.multiply(new THREE.Matrix4().makeRotationZ(o.rot));
  const S = o.size;
  const seed = (o.seed ?? 1) * 7.3;
  const d = surfaceDecal({
    proj,
    frame,
    w: S * 1.15,
    h: S * 1.25,
    cell: o.cell ?? 0.0075 * P.s,
    mask: (px, py) => {
      const m = whiteHandMask(px / S, py / S + 0.1, 0.04);
      // dry-brush streaks: paint breaks up along the fingers
      const br = 0.8 + 0.4 * Math.sin(px * 60 + seed) * Math.sin(py * 43 + seed * 2);
      return Math.min(1, m * br);
    },
    lift: 0.0022 * P.s,
    paint: URUK_PAL.white,
    skin: o.base,
    streak: (px, py) => Math.sin(px * 70 + seed) * 0.5 + Math.sin(py * 50 - seed) * 0.5,
  });
  if (d) gear(d.geo, { bone: o.bone, color: URUK_PAL.white, mat: o.mat ?? surface('skin_orc', { rough: 0.8, skin: 0.2 }), colorFn: d.colorFn });
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
    const parts = anatomyParts(P);
    const armor = ctx.armor;
    const j = P.j;
    const u = P.headH;
    const rng = new Rng(hashSeed('uruk-extras', berserker ? 1 : 0, bucket));
    void rng;

    brawnBody(ctx, berserker ? { traps: 1.15, lats: 1.2, delts: 1.15, forearm: 1.12, thigh: 1.05 } : { traps: 1.05, lats: 1.0, delts: 1.0, forearm: 1.05 });

    let botY = 0;
    const doCuirass = !berserker && armor >= 0.25 && look.cuirass !== 'none';
    if (doCuirass) botY = cuirassSdf(ctx, look, parts).botY;
    if (!berserker && look.gorget && armor >= 0.5) gorget(ctx, parts);
    if (!berserker && armor >= 0.25 && look.vambraces) forearms(ctx, parts, 'plate');
    else if (look.wraps || berserker) forearms(ctx, parts, 'wraps');

    // facial scar (carved)
    if (look.scar || berserker) {
      const sg = look.scar ? 1 : -1;
      s.cone(P.h(0.2 * sg, 0.06, 0.37), P.h(0.07 * sg, -0.3, 0.44), 0.012 * u, 0.007 * u, { op: 'subtract', k: 0.006 * u, color: 0x6a3a30, paintCarve: true, mat: 'skin_orc', bone: 'head' });
    }

    // ── rigid gear (needs the finished sculpt for placement) ──
    const proj = makeProjector(s, { min: [-0.7, 0, -0.5], max: [0.7, P.H + 0.2, 0.6] });
    if (proj && doCuirass) cuirassGear(ctx, gear, proj, look, botY);

    if (armor >= 0.5 && !berserker) {
      const pa = look.pauldrons;
      if (pa === 'r' || pa === 'both') pauldron(ctx, gear, -1, { lames: 3, spikes: look.spikes, scale: 1.05 });
      if (pa === 'l' || pa === 'both') pauldron(ctx, gear, 1, { lames: pa === 'both' ? 2 : 3, spikes: 0, scale: pa === 'both' ? 0.92 : 1.05 });
    }
    if (berserker) {
      pauldron(ctx, gear, 1, { lames: 2, spikes: 5, scale: 0.9, rusty: true });
    }

    if (ctx.helmet) {
      const style = berserker ? 'cap' : look.helm;
      const h = helmet(ctx, gear, { style, nasal: !berserker && look.nasal, cheeks: !berserker && look.cheeks, spikes: berserker ? 9 : style === 'cap' ? 5 : 0 });
      if (berserker) muzzleMask(ctx, gear);
      if (look.hand === 'helm' || berserker) helmetHand(ctx, gear, h, berserker ? 1.1 : 1);
    }
    if (proj && look.hand === 'chest' && doCuirass) {
      printHand(ctx, gear, proj, { pos: [0.0, j.upperarm_l[1] - 0.1 * sc, 0.3 * sc], size: 0.17 * sc, bone: 'chest', base: URUK_PAL.iron, cell: 0.005 * sc, mat: WHITE_PAINT });
    }
    void gorget;
    void lathe;
    void ellipticalBand;
  };
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
  tusks: 0.25,
  underbite: 0.5,
  foreheadSlope: 0.5,
  asym: 0.3,
  cranium: 0.94,
};

export const urukKinds: Record<'uruk' | 'berserker', KindDef> = {
  uruk: {
    label: 'Uruk-hai',
    height: 2.0,
    build: { shoulders: 1.3, hips: 1.02, bulk: 1.12, chest: 1.12, belly: 0.0, armLength: 1.07, legLength: 0.98, headSize: 0.98, neck: 0.8, neckThick: 1.4, hunch: 0.14, handSize: 1.2, footSize: 1.12, muscle: 0.95 },
    face: URUK_FACE,
    skin: { color: URUK_PAL.skin, color2: URUK_PAL.skin2, blotch: 0.5, blemish: 0.45, scars: 2, warts: 0.1, wrinkles: 0.5, lips: URUK_PAL.lips, brows: 0x120e0b, surface: 'skin_orc', scatter: URUK_PAL.scatter },
    eyes: { color: URUK_PAL.eyes, glow: 0.35, sclera: 0xb8a878 },
    hair: { style: 'wild', color: URUK_PAL.hair, density: 0.55, length: 1.0 },
    outfit: [
      { type: 'trousers', color: URUK_PAL.cloth, mat: 'leather_worn' },
      { type: 'boots', color: 0x1a1613, color2: 0x120f0d, length: 0.9 },
      { type: 'belt', color: 0x17120f },
      { type: 'loincloth', color: 0x211913, mat: 'leather_worn', length: 0.55 },
    ],
    armor: [],
    weapons: { right: 'sword', left: 'shield', style: 'uruk' },
    palette: URUK_PAL,
    sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.7 },
    anim: { hunch: 0.14, swagger: 0.4, aggression: 0.8, stance: 1.15, armSwing: 1.0, cadence: 1.0 },
    variation: { height: 0.025, bulk: 0.06, skin: 0.12 },
    detail: { faceRes: 0, res: 0.046, headRes: 0.016 },
    extras: urukExtras(false),
  },
  berserker: {
    label: 'Uruk berserker',
    height: 2.1,
    build: { shoulders: 1.36, hips: 1.02, bulk: 1.22, chest: 1.15, belly: 0.0, armLength: 1.08, legLength: 0.97, headSize: 0.98, neck: 0.78, neckThick: 1.5, hunch: 0.16, handSize: 1.25, footSize: 1.15, muscle: 1.0 },
    face: URUK_FACE,
    skin: { color: 0x372b23, color2: 0x241b15, blotch: 0.5, blemish: 0.45, scars: 3, warts: 0.1, wrinkles: 0.5, lips: URUK_PAL.lips, brows: 0x120e0b, surface: 'skin_orc', scatter: URUK_PAL.scatter },
    eyes: { color: 0xd0a030, glow: 0.5, sclera: 0xb8a878 },
    hair: { style: 'wild', color: URUK_PAL.hair, density: 0.55, length: 1.0 },
    outfit: [
      { type: 'trousers', color: URUK_PAL.cloth, mat: 'leather_worn' },
      { type: 'boots', color: 0x1a1613, color2: 0x120f0d, length: 0.9 },
      { type: 'belt', color: 0x17120f },
      { type: 'loincloth', color: 0x211913, mat: 'leather_worn', length: 0.6 },
    ],
    armor: [],
    weapons: { right: 'sword', left: 'none', style: 'uruk' },
    palette: URUK_PAL,
    sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.8 },
    anim: { hunch: 0.16, swagger: 0.55, aggression: 1, stance: 1.2, armSwing: 1.1, cadence: 1.0 },
    variation: { height: 0.02, bulk: 0.05, skin: 0.1 },
    detail: { faceRes: 0, res: 0.0405, headRes: 0.0145 },
    extras: urukExtras(true),
  },
};
