/**
 * Trolls. One KindDef, two looks chosen by the seed bucket:
 *   buckets 0, 1  Moria cave troll: grey-green warty hide, one massive barrel chest with a hanging
 *                 belly, huge shoulders, a small head with a heavy brow and an under-slung jaw,
 *                 an iron shackle with a broken chain on the ankle (and a manacle on one wrist), club.
 *   buckets 2, 3  Mordor war troll (Black Gate): the same bulk in black iron plate, spiked
 *                 pauldrons, a plate harness, a pointed helm and a warhammer.
 * Chapter authors: `trollSeed('cave' | 'war')` gives a seed for each look; pass `weapon: 'warhammer'`
 * for the war troll (the KindDef default is the club).
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import {
  V, bucketOf, gearOf, makeProjector, spike, placeAlong, shellPatch, ellipsoidFn, ribbon, lerp, smooth, chainLinks, ringSnap, snapPoint, snapPath, densePath, hexBolt, rivet, ellipticalBand, ringRadii, type GearFn, type Projector, type SnapPoint,
} from './common';
import { skinOpts } from './body';
import { pauldron, URUK_PAL } from './uruk';

const IRON = surface('metal_dark', { rough: 0.55 });
const IRON_RUSTY = surface('metal_rusty', { rough: 0.7 });
const LEATHER = surface('leather_worn', { rough: 0.72 });
const HIDE = surface('hide', { rough: 0.8 });

export const TROLL_PAL = {
  skin: 0x66705c,
  skin2: 0x464e3e,
  belly: 0x8a8d78,
  lips: 0x4a4a3e,
  scatter: 0x6a7a5a,
  eyes: 0xb8a64a,
  wart: 0x5a644e,
  iron: 0x26262a,
  rust: 0x4a3828,
  leather: 0x2c2118,
  chain: 0x3c3a36,
};

export type TrollVariant = 'cave' | 'war';
export function trollVariant(seed: number | undefined): TrollVariant {
  return bucketOf(seed) >= 2 ? 'war' : 'cave';
}

const TROLL_FACE = {
  jaw: 1.5,
  jawLength: 1.15,
  chin: 0.8,
  brow: 2.0,
  cheekbones: 1.0,
  nose: { length: 0.9, width: 1.7, bridge: 0.5, hook: 0, tip: 1.4, flat: 0.9 },
  lips: { width: 1.3, fullness: 0.7 },
  ears: 'small' as const,
  earSize: 0.9,
  eyeSize: 1.7,
  eyeSpacing: 0.95,
  eyeTilt: -0.12,
  eyeOpen: 0.9,
  tusks: 0.6,
  underbite: 0.85,
  foreheadSlope: 0.65,
  asym: 0.5,
  cranium: 0.85,
};

// ─────────────────────────────────────────────────────────────────────────────
// body
// ─────────────────────────────────────────────────────────────────────────────

function trollBody(ctx: KindContext, variant: TrollVariant) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const j = P.j;
  const chestY = j.chest[1];
  const hipY = j.thigh_l[1];
  const shY = j.upperarm_l[1];
  const L = P.hand.l.L;
  const u = P.headH;
  s.with({ ...skinOpts(ctx), k: 0.14 * sc }, () => {
    // barrel chest: one massive volume from the collar to the belt
    const lump = { amp: 0.014 * sc, freq: 5 / sc, type: 'fbm' as const, octaves: 3, seed: 3 };
    s.ellipsoid([0, (shY + hipY) / 2 + 0.02 * sc, 0.02 * sc], [0.215 * sc * g, 0.34 * sc, 0.17 * sc * g], { bone: 'spine', bone2: 'chest', blend: [0.3, 1], k: 0.16 * sc, noise: lump });
    // hanging belly overhanging the belt
    s.ellipsoid([0, hipY + 0.07 * sc, 0.075 * sc * g], [0.2 * sc * g, 0.15 * sc, 0.19 * sc * g], { bone: 'spine', k: 0.14 * sc, noise: { ...lump, seed: 5 } });
    // belly sag: a second, lower fold
    s.ellipsoid([0, hipY - 0.0 * sc, 0.1 * sc * g], [0.17 * sc * g, 0.08 * sc, 0.14 * sc * g], { bone: 'spine', k: 0.1 * sc, noise: { ...lump, seed: 8 } });
    // trapezius / neck hump so the head sits forward between the shoulders
    s.ellipsoid([0, j.neck[1] - 0.03 * sc, -0.07 * sc], [0.16 * sc * g, 0.08 * sc, 0.11 * sc * g], { bone: 'chest', k: 0.1 * sc });
    s.mirrored(() => s.cone([0.05 * sc, j.neck[1] - 0.01 * sc, -0.02 * sc], [0.2 * sc * P.build.shoulders, shY + 0.02 * sc, -0.02 * sc], 0.085 * sc, 0.07 * sc, { bone: 'chest', bone2: 'shoulder_l', blend: [0.6, 1], k: 0.1 * sc }));
    // deltoids and arms
    s.mirrored(() => {
      const c: [number, number, number] = [j.upperarm_l[0] + L.x * 0.05 * sc, j.upperarm_l[1] + L.y * 0.05 * sc + 0.02 * sc, j.upperarm_l[2]];
      s.ellipsoid(c, [0.11 * sc * g, 0.12 * sc, 0.1 * sc * g], { bone: 'upperarm_l', k: 0.08 * sc, rot: [0, 0, 0.6] });
      const a: [number, number, number] = [j.forearm_l[0] + L.x * 0.05 * sc, j.forearm_l[1] + L.y * 0.05 * sc, j.forearm_l[2]];
      const b: [number, number, number] = [j.hand_l[0] - L.x * 0.08 * sc, j.hand_l[1] - L.y * 0.08 * sc, j.hand_l[2]];
      s.cone(a, b, 0.09 * sc * g, 0.055 * sc * g, { bone: 'forearm_l', k: 0.06 * sc });
    });
    // big flat feet: fill the gap between the ankle and the toe plate
    s.mirrored(() => {
      const f = j.foot_l;
      const t = j.toe_l;
      s.cone([f[0], f[1] + 0.02 * sc, f[2] - 0.0 * sc], [t[0], t[1] + 0.03 * sc, t[2] + 0.07 * sc], 0.072 * sc, 0.058 * sc, { bone: 'foot_l', bone2: 'toe_l', blend: [0.55, 0.95], k: 0.04 * sc });
    });
    // thighs / calves
    s.mirrored(() => {
      s.ellipsoid([j.thigh_l[0] + 0.02 * sc, (j.thigh_l[1] + j.shin_l[1]) / 2 + 0.06 * sc, 0.02 * sc], [0.13 * sc * g, 0.21 * sc, 0.13 * sc * g], { bone: 'thigh_l', k: 0.08 * sc });
      s.ellipsoid([j.shin_l[0], j.shin_l[1] - 0.12 * sc, j.shin_l[2] - 0.04 * sc], [0.095 * sc * g, 0.13 * sc, 0.1 * sc * g], { bone: 'shin_l', k: 0.07 * sc });
    });
  });
  void u;
  void variant;
}

/** brutal face: huge brow shelf, under-slung jaw, big nose, small sunken eyes, lower tusks */
function trollFace(ctx: KindContext, variant: TrollVariant) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number, z: number) => P.h(x, y, z);
  const sk = skinOpts(ctx);
  s.with({ ...sk, bone: 'head', k: 0.05 * u }, () => {
    // brow shelf
    s.mirrored(() => s.cone(H(0.2, 0.01, 0.3), H(0.02, 0.03, 0.43), 0.07 * u, 0.065 * u, { k: 0.08 * u }));
    // cheek masses
    s.mirrored(() => s.ellipsoid(H(0.2, -0.2, 0.2), [0.12 * u, 0.1 * u, 0.12 * u], { k: 0.08 * u }));
    // wide flat nose
    s.ellipsoid(H(0, -0.21, 0.46), [0.12 * u, 0.09 * u, 0.07 * u], { k: 0.05 * u });
  });
  s.with({ ...sk, bone: 'jaw', k: 0.06 * u }, () => {
    // massive lower jaw jutting forward
    s.ellipsoid(H(0, -0.5, 0.36), [0.26 * u, 0.12 * u, 0.2 * u], { k: 0.09 * u });
    s.mirrored(() => s.cone(H(0.2, -0.36, 0.1), H(0.12, -0.55, 0.38), 0.075 * u, 0.07 * u, { k: 0.08 * u }));
  });
  // fleshy ears
  s.with({ ...sk, bone: 'head', k: 0.05 * u }, () => {
    s.mirrored(() => s.ellipsoid(H(0.36, -0.08, -0.03), [0.05 * u, 0.14 * u, 0.085 * u], { rot: [-0.2, 0.35, 0] }));
    s.mirrored(() => s.sphere(H(0.37, -0.22, -0.01), 0.04 * u, { k: 0.04 * u }));
  });
  // re-open the eye sockets after the brow and cheek masses
  const ex = 0.135 * 0.95;
  const eR = P.eyeR * 1.7;
  s.mirrored((side) => {
    const c = H(ex, -0.075, 0.29);
    s.ellipsoid([c[0], c[1] + 0.2 * eR, c[2] + 0.9 * eR], [1.55 * eR, 1.0 * eR, 1.6 * eR], { op: 'subtract', k: 0.8 * eR, bone: 'head' });
    void side;
  });
  // tusks
  s.mirrored(() => s.cone(H(0.13, -0.45, 0.46), H(0.15, -0.14, 0.5), 0.034 * u, 0.008 * u, { bone: 'jaw', color: 0xcfc4a2, mat: 'teeth', k: 0.01 * u }));
  if (variant === 'cave') {
    // warts on the face
    for (const [x, y, z, r] of [[0.1, 0.08, 0.35, 0.03], [-0.14, -0.2, 0.34, 0.028], [0.22, -0.22, 0.26, 0.032], [-0.04, 0.2, 0.3, 0.025]] as [number, number, number, number][]) {
      s.sphere(H(x, y, z), r * u, { color: TROLL_PAL.wart, mat: 'skin_troll', bone: 'head', k: 0.02 * u });
    }
  }
}

/** warty hide: low hemispheres scattered over the torso, shoulders and arms (rigid gear) */
function warts(ctx: KindContext, gear: GearFn, proj: Projector, n: number, seed: number) {
  const { P } = ctx;
  const sc = P.s;
  const rng = new Rng(seed);
  const j = P.j;
  const p = V(), nn = V();
  const geo = new THREE.SphereGeometry(1, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(0);
  for (let i = 0; i < n; i++) {
    // sample the front/back/side of the torso and the upper arms
    const y = rng.range(j.thigh_l[1] + 0.05 * sc, j.neck[1] - 0.02 * sc);
    const a = rng.range(-Math.PI, Math.PI);
    const q = ringSnap(proj, a, y, 0, 0.02 * sc, p, nn);
    if (!q) continue;
    const r = (rng.float() < 0.15 ? rng.range(0.03, 0.05) : rng.range(0.01, 0.026)) * sc;
    const bone = y > j.chest[1] - 0.1 * sc ? 'chest' : 'spine';
    const g = geo.clone().scale(r, r * 0.8, r);
    const m = placeAlong(q.p.clone().addScaledVector(q.n, -r * 0.2), q.n.clone(), V(0, 0, 1));
    gear(g, { bone, color: TROLL_PAL.wart, mat: HIDE, matrix: m, small: true, ao: 0.8 });
  }
}

/** iron shackle on the ankle with a short broken chain trailing on the ground */
function shackle(ctx: KindContext, gear: GearFn, side: 'l' | 'r') {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const ank = V(...j[`foot_${side}`]);
  const R = 0.105 * sc * Math.sqrt(P.build.bulk);
  // two half-rings with a hinge block
  const ring = new THREE.TorusGeometry(R, 0.022 * sc, 6, 18).rotateX(Math.PI / 2);
  gear(ring, { bone: `shin_${side}`, color: TROLL_PAL.chain, mat: IRON_RUSTY, matrix: new THREE.Matrix4().makeTranslation(ank.x, ank.y + 0.075 * sc, ank.z + 0.0), ao: 0.8 });
  const block = new THREE.BoxGeometry(0.07 * sc, 0.1 * sc, 0.06 * sc);
  const bx = ank.x + (side === 'l' ? 1 : -1) * 0.0;
  gear(block, { bone: `shin_${side}`, color: TROLL_PAL.chain, mat: IRON_RUSTY, matrix: new THREE.Matrix4().makeTranslation(bx, ank.y + 0.075 * sc, ank.z - R - 0.02 * sc), ao: 0.8 });
  // chain: from the block backwards along the ground, ending in a broken link
  const start = V(bx, ank.y + 0.06 * sc, ank.z - R - 0.06 * sc);
  const path = [start, V(bx, ank.y + 0.02 * sc, start.z - 0.12 * sc), V(bx + 0.02 * sc, 0.025 * sc, start.z - 0.28 * sc), V(bx + 0.06 * sc, 0.02 * sc, start.z - 0.46 * sc), V(bx + 0.1 * sc, 0.02 * sc, start.z - 0.62 * sc)];
  for (const g of chainLinks(path, 0.07 * sc, 0.013 * sc, V(0, 1, 0))) gear(g, { bone: `foot_${side}`, color: TROLL_PAL.chain, mat: IRON_RUSTY, small: true });
}

function wristManacle(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const L = P.hand.l.L;
  const w = V(...j.hand_l).addScaledVector(L, -0.05 * sc);
  const g = new THREE.TorusGeometry(0.07 * sc * Math.sqrt(P.build.bulk), 0.02 * sc, 6, 16);
  gear(g, { bone: 'forearm_l', color: TROLL_PAL.chain, mat: IRON_RUSTY, matrix: placeAlong(w, L.clone(), V(0, 0, 1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), ao: 0.8 });
  const path = [w.clone().addScaledVector(V(0.0, 0, 1), 0.06 * sc), V(w.x + 0.05 * sc, w.y - 0.12 * sc, w.z + 0.1 * sc), V(w.x + 0.08 * sc, w.y - 0.3 * sc, w.z + 0.08 * sc)];
  for (const l of chainLinks(path, 0.06 * sc, 0.011 * sc, V(0, 0, 1))) gear(l, { bone: 'hand_l', color: TROLL_PAL.chain, mat: IRON_RUSTY, small: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// war troll
// ─────────────────────────────────────────────────────────────────────────────

function warTrollGear(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const u = P.headH;
  const j = P.j;
  const g = Math.sqrt(P.build.bulk);
  const H = (x: number, y: number, z: number) => new THREE.Vector3(...P.h(x, y, z));
  // pointed helm with a face opening and a spiked crown
  const C = H(0, 0.045, -0.05);
  const R: [number, number, number] = [0.4 * u, 0.52 * u, 0.5 * u];
  const rimY = (a: number) => lerp(0.04, -0.3, smooth(1.6, 2.9, Math.abs(a))) - 0.03 * smooth(0.9, 1.5, Math.abs(a));
  const elOf = (a: number) => Math.asin(Math.max(-0.97, Math.min(0.97, (rimY(a) - 0.045) / (R[1] / u))));
  const dome = shellPatch(ellipsoidFn(C, R, [-Math.PI, Math.PI], [elOf, Math.PI / 2 - 1e-3], { radial: (_a, e) => (e < 0 ? 1 / Math.pow(Math.max(0.6, Math.cos(e)), 0.8) : 1 + 0.18 * Math.pow(Math.sin(e), 6)) }), 24, 7, 0.016 * sc, { closedU: true, noInner: true, skip: ['v1'], thickFn: (_u, v) => 1 + 0.9 * (1 - smooth(0, 0.12, v)) });
  gear(dome, { bone: 'head', color: TROLL_PAL.iron, mat: IRON, ao: 0.9 });
  // central point
  gear(spike(0.045 * u, 0.42 * u, 6), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(C.clone().add(V(0, R[1] * 1.05, 0)), V(0, 1, -0.1), V(0, 0, 1)) });
  // brow ridge ring of studs + side spikes
  for (let i = 0; i < 9; i++) {
    const a = lerp(-2.4, 2.4, i / 8);
    const e = elOf(a) + 0.15;
    const d = V(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(C);
    const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    gear(spike(0.03 * u, (bucket === 3 ? 0.2 : 0.1) * u, 5), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(p, nn, V(0, 0, 1)), small: true });
  }
  // nose guard
  const pts = [H(0, 0.04, 0.5), H(0, -0.1, 0.57), H(0, -0.28, 0.6)];
  gear(ribbon(pts, [V(0, 0.2, 1).normalize(), V(0, 0, 1), V(0, -0.2, 1).normalize()], 0.07 * u, 0.02 * sc, 1, { outerOnly: true }), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, small: true });
  // plate harness: breast and belly plates strapped on
  const rr = ringRadii(proj, j.chest[1] + 0.07 * sc);
  const bands = 4;
  for (let k = 0; k < bands; k++) {
    const yTop = j.upperarm_l[1] - 0.06 * sc - k * 0.075 * sc;
    const yBot = yTop - 0.085 * sc;
    const rt = ringRadii(proj, yTop);
    const rb = ringRadii(proj, yBot);
    const m = new THREE.Matrix4().makeTranslation(0, (yTop + yBot) / 2, 0);
    // front plates only (a wide arc) so the back stays hide
    const geo = ellipticalBand(rt.rx + 0.02 * sc, (rt.zf + rt.zb) / 2 + 0.018 * sc, rb.rx + 0.03 * sc, (rb.zf + rb.zb) / 2 + 0.028 * sc, 0.085 * sc, 0.014 * sc, 18, -1.45, 1.45, (rt.zf - rt.zb) / 2);
    gear(geo, { bone: k < 2 ? 'chest' : 'spine', color: TROLL_PAL.iron, mat: IRON_RUSTY, matrix: m, ao: 0.85 });
  }
  void rr;
  // chest studs
  for (let k = 0; k < 10; k++) {
    const y = j.upperarm_l[1] - (0.08 + (k % 5) * 0.075) * sc;
    const a = (k < 5 ? -1 : 1) * 0.5;
    const q = ringSnap(proj, a, y);
    if (!q) continue;
    gear(hexBolt(0.016 * sc, 0.014 * sc), { bone: 'chest', color: 0x5a554e, mat: IRON, matrix: placeAlong(q.p.clone().addScaledVector(q.n, 0.034 * sc), q.n, V(0, 1, 0)), small: true });
  }
  // shoulder straps
  for (const sx of [1, -1]) {
    const path = densePath(proj, [[sx * 0.14 * sc, j.upperarm_l[1] + 0.12 * sc, -0.05 * sc, 't'], [sx * 0.16 * sc, j.upperarm_l[1] + 0.0 * sc, 0.2 * sc, 'f'], [sx * 0.16 * sc, j.upperarm_l[1] - 0.1 * sc, 0.28 * sc, 'f']] as SnapPoint[], 0.03 * sc, 0.002 * sc);
    if (path.p.length > 3) gear(ribbon(path.p, path.n, 0.08 * sc, 0.02 * sc, 1, { outerOnly: true, noInner: true }, path.p.length - 1), { bone: 'chest', color: TROLL_PAL.leather, mat: LEATHER, small: true });
  }
  // belt plate with a skull-like boss
  void u;
  void g;
}

// ─────────────────────────────────────────────────────────────────────────────
// extras
// ─────────────────────────────────────────────────────────────────────────────

function trollExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const gear = gearOf(ctx);
  const bucket = bucketOf(ctx.spec.seed);
  const variant = trollVariant(ctx.spec.seed);
  const j = P.j;
  const parts = anatomyParts(P);
  const box = { min: [-2, 0, -1.6] as [number, number, number], max: [2, P.H + 0.5, 1.8] as [number, number, number] };
  void parts;
  void emitParts;
  trollBody(ctx, variant);
  trollFace(ctx, variant);

  const proj = makeProjector(s, box);
  if (!proj) return;
  if (variant === 'cave') {
    warts(ctx, gear, proj, bucket === 1 ? 150 : 120, hashSeed('troll-warts', bucket));
    shackle(ctx, gear, 'r');
    wristManacle(ctx, gear);
  } else {
    if (ctx.armor >= 0.25) warTrollGear(ctx, gear, proj, bucket);
    if (ctx.armor >= 0.5) {
      pauldron(ctx, gear, 1, { lames: 4, spikes: 7, scale: 2.0, rusty: true, color: TROLL_PAL.iron });
      pauldron(ctx, gear, -1, { lames: 4, spikes: 7, scale: 2.0, rusty: true, color: TROLL_PAL.iron });
    }
    warts(ctx, gear, proj, 25, hashSeed('troll-warts', bucket));
  }
  void j;
  void snapPoint;
  void snapPath;
  void rivet;
  void URUK_PAL;
}

export const trollKind: KindDef = {
  label: 'Troll',
  height: 4.5,
  build: { shoulders: 1.12, hips: 1.1, bulk: 1.22, belly: 0.5, chest: 1.1, armLength: 1.3, legLength: 0.78, headSize: 1.05, neck: 0.85, neckThick: 0.9, hunch: 0.5, handSize: 1.45, footSize: 1.45, muscle: 0.6 },
  face: TROLL_FACE,
  skin: { color: TROLL_PAL.skin, color2: TROLL_PAL.skin2, blotch: 0.6, blemish: 0.6, scars: 3, warts: 0.5, wrinkles: 1.0, lips: TROLL_PAL.lips, brows: 0x3a3e30, surface: 'skin_troll', scatter: TROLL_PAL.scatter },
  eyes: { color: TROLL_PAL.eyes, glow: 0.25, sclera: 0xa8a070 },
  hair: { style: 'bald', color: 0x1a1a14 },
  outfit: [
    { type: 'loincloth', color: 0x3a3026, length: 0.95, mat: 'rags' },
    { type: 'belt', color: 0x2a221a },
  ],
  armor: [],
  weapons: { right: 'club' },
  palette: TROLL_PAL,
  sfx: { voice: 'troll', roar: 'troll_roar', grunt: 'troll_hit', footstep: 'troll_step', weight: 1 },
  anim: { hunch: 0.95, swagger: 0.7, aggression: 0.8, stance: 1.3, cadence: 0.9, armSwing: 1.2 },
  variation: { height: 0.03, bulk: 0.06, skin: 0.1 },
  detail: { faceRes: 0, res: 0.085, headRes: 0.028, detailScale: 2.4 },
  extras: trollExtras,
};

void IRON;
