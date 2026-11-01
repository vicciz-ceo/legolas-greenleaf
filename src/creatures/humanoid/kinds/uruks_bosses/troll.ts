/**
 * Trolls (docs/refs/cave_troll, docs/refs/war_troll). One KindDef, two looks chosen by the seed bucket:
 *   buckets 0, 1  Moria cave troll: warty olive-tan hide, one massive barrel chest with a hanging belly,
 *                 huge sloping shoulders, a small head with a heavy brow and an under-slung jaw, coarse
 *                 bristles on the shoulders, a ragged woven kilt on a broad belt, a riveted iron shackle with
 *                 a short chain on the RIGHT ankle, a knobbly club in the right hand.
 *   buckets 2, 3  Mordor war troll (Black Gate): the same bulk with dark brown hide in battered iron: a
 *                 pointed helm, breast and back plates with crossed straps, huge spiked pauldrons, spiked
 *                 vambraces, strapped greaves over wrapped feet, a double belt with a ring buckle over a
 *                 leather kilt, and a spiked block warhammer in the right hand.
 * Chapter authors: `trollSeed('cave' | 'war')` gives a seed for each look; pass `weapon: 'warhammer'`
 * for the war troll (the KindDef default is the club).
 *
 * Files: `troll_pal.ts` (palette, surfaces), `troll_cave.ts` (warts, bristles, shackle), `troll_war.ts`
 * (helm, plates, belts, limb armour, hammer head).
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { surface } from '../../../kit/surfaces';
import { V, bucketOf, gearOf, makeProjector, spike, placeAlong, scaleHeldWeapon, type GearFn } from './common';
import { skinOpts } from './body';
import { pauldron } from './uruk';
import { TROLL_PAL, HIDE } from './troll_pal';
import { caveWarts, caveBristles, ankleShackle } from './troll_cave';
import { warHelm, warMane, warHarness, warBelts, trollBelt, warFootWraps, warGreaves, warBracers, bigHammerHead } from './troll_war';

export { TROLL_PAL };

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
  eyeSize: 1.2,
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

/** belt height (m) from the sheets' calibrated rows: cave 2.2 m, war 2.74 m (longer legs and a higher waist), scaled with the troll */
function beltHeight(ctx: KindContext, variant: TrollVariant): number {
  return (variant === 'war' ? 2.74 : 2.2) * (ctx.P.H / 4.52);
}

function trollBody(ctx: KindContext, variant: TrollVariant) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const shY = j.upperarm_l[1];
  const L = P.hand.l.L;
  const beltY = beltHeight(ctx, variant);
  // the war troll is a little leaner in the belly (sheet: hip width 1.2 m against the cave troll's 1.4 m)
  const lean = variant === 'war' ? 0.9 : 1;
  s.with({ ...skinOpts(ctx), k: 0.14 * sc }, () => {
    // barrel chest: one massive volume from the collar down to the belt
    const lump = { amp: 0.014 * sc, freq: 5 / sc, type: 'fbm' as const, octaves: 3, seed: 3 };
    const cTop = shY + 0.1 * sc;
    const cBot = beltY - 0.1 * sc;
    s.ellipsoid([0, (cTop + cBot) / 2, 0.02 * sc], [0.215 * sc * g, (cTop - cBot) / 2, 0.17 * sc * g], { bone: 'spine', bone2: 'chest', blend: [0.3, 1], k: 0.16 * sc, noise: lump });
    // hanging belly: a soft mass above the belt that overhangs it (sheet side view: carried well forward of the chest)
    s.ellipsoid([0, beltY + 0.3 * sc, 0.1 * sc * g * lean], [0.2 * sc * g * lean, 0.17 * sc, 0.2 * sc * g * lean], { bone: 'spine', k: 0.14 * sc, noise: { ...lump, seed: 5 } });
    // belly sag: a second, lower fold resting on the belt
    s.ellipsoid([0, beltY + 0.17 * sc, 0.1 * sc * g * lean], [0.17 * sc * g * lean, 0.07 * sc, 0.15 * sc * g * lean], { bone: 'spine', k: 0.1 * sc, noise: { ...lump, seed: 8 } });
    // war troll: the waist between the hip joints and the high belt
    if (variant === 'war' && beltY > hipY + 0.1 * sc) s.ellipsoid([0, (hipY + beltY) / 2, 0.0], [0.19 * sc * g, (beltY - hipY) / 2 + 0.05 * sc, 0.15 * sc * g], { bone: 'spine', k: 0.1 * sc });
    // trapezius / neck hump: the head sits forward between two sloping masses that rise toward the ears
    s.ellipsoid([0, j.neck[1] - 0.01 * sc, -0.08 * sc], [0.19 * sc * g, 0.1 * sc, 0.13 * sc * g], { bone: 'chest', k: 0.1 * sc });
    s.mirrored(() => s.cone([0.06 * sc, j.neck[1] + 0.02 * sc, -0.03 * sc], [0.2 * sc * P.build.shoulders, shY + 0.03 * sc, -0.02 * sc], 0.1 * sc, 0.085 * sc, { bone: 'chest', bone2: 'shoulder_l', blend: [0.6, 1], k: 0.1 * sc }));
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
      s.cone([f[0], f[1] + 0.02 * sc, f[2]], [t[0], t[1] + 0.03 * sc, t[2] + 0.07 * sc], 0.072 * sc, 0.058 * sc, { bone: 'foot_l', bone2: 'toe_l', blend: [0.55, 0.95], k: 0.04 * sc });
    });
    // thighs / calves (thick: the sheet legs are pillars)
    s.mirrored(() => {
      s.ellipsoid([j.thigh_l[0] + 0.02 * sc, (j.thigh_l[1] + j.shin_l[1]) / 2 + 0.06 * sc, 0.02 * sc], [0.15 * sc * g, 0.22 * sc, 0.15 * sc * g], { bone: 'thigh_l', k: 0.08 * sc });
      s.ellipsoid([j.shin_l[0], j.shin_l[1] - 0.12 * sc, j.shin_l[2] - 0.04 * sc], [0.11 * sc * g, 0.14 * sc, 0.115 * sc * g], { bone: 'shin_l', k: 0.07 * sc });
    });
  });
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
  const eR = P.eyeR * 1.2;
  s.mirrored(() => {
    const c = H(ex, -0.075, 0.29);
    s.ellipsoid([c[0], c[1] + 0.2 * eR, c[2] + 0.9 * eR], [1.7 * eR, 1.15 * eR, 1.7 * eR], { op: 'subtract', k: 0.9 * eR, bone: 'head' });
  });
  // lower tusks, cream, rising from the under-slung jaw (face sheet: short and blunt)
  s.mirrored(() => s.cone(H(0.14, -0.45, 0.46), H(0.155, -0.27, 0.5), 0.04 * u, 0.014 * u, { bone: 'jaw', color: TROLL_PAL.tusk, mat: 'teeth', k: 0.01 * u }));
  // nose, ears and the cheeks over the cheekbones are pinker than the hide (face sheet)
  const pink = { op: 'paint' as const, color: TROLL_PAL.nose, mat: 'skin_troll' as const, bone: 'head', strength: 0.55 };
  s.ellipsoid(H(0, -0.2, 0.5), [0.1 * u, 0.1 * u, 0.1 * u], { ...pink, k: 0.05 * u });
  s.mirrored(() => s.ellipsoid(H(0.37, -0.1, -0.03), [0.07 * u, 0.15 * u, 0.1 * u], { ...pink, k: 0.04 * u }));
  s.mirrored(() => s.ellipsoid(H(0.2, -0.2, 0.3), [0.09 * u, 0.07 * u, 0.06 * u], { ...pink, strength: 0.35, k: 0.06 * u }));
  if (variant === 'cave') {
    // warts on the face
    for (const [x, y, z, r] of [[0.1, 0.08, 0.35, 0.03], [-0.14, -0.2, 0.34, 0.028], [0.22, -0.22, 0.26, 0.032], [-0.04, 0.2, 0.3, 0.025]] as [number, number, number, number][]) {
      s.sphere(H(x, y, z), r * u, { color: TROLL_PAL.wart, mat: 'skin_troll', bone: 'head', k: 0.02 * u });
    }
  }
}

/** knuckles and claws so the mitten hands read as hands with fingers */
function trollHands(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const sc = P.s;
  const hs = P.build.handSize * sc;
  for (const side of ['l', 'r'] as const) {
    const f = P.hand[side];
    for (let i = 0; i < 4; i++) {
      const b = (i - 1.5) * 0.0215 * hs;
      // knuckle on the back of the hand
      const kp = V(...P.hp(side, P.palm * 0.98, b, -0.02 * hs));
      const ks = 0.019 * hs;
      gear(new THREE.SphereGeometry(ks, 5, 4).scale(1, 0.8, 1), { bone: `hand_${side}`, color: TROLL_PAL.skin2, mat: HIDE, matrix: new THREE.Matrix4().makeTranslation(kp.x, kp.y, kp.z), small: true });
      // claw at the fingertip
      const tp = V(...P.hp(side, P.palm + P.finger * 0.98, b, 0.0));
      gear(spike(0.008 * hs, 0.04 * hs, 4, 0.3), { bone: `fing2_${side}`, color: 0x2c2a22, mat: surface('horn', { rough: 0.5 }), matrix: placeAlong(tp, f.L.clone(), f.N.clone().multiplyScalar(-1)), small: true });
    }
  }
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
  const beltY = beltHeight(ctx, variant);
  const box = { min: [-2.2, 0, -1.8] as [number, number, number], max: [2.2, P.H + 0.9, 2.0] as [number, number, number] };
  trollBody(ctx, variant);
  trollFace(ctx, variant);
  if (variant === 'war') {
    // the war sheet's hide is dark warm brown (lit sample #4a3424); tint the whole body
    s.ellipsoid([0, P.H / 2, 0], [2.6 * sc, P.H * 0.7, 2.6 * sc], { op: 'paint', color: bucket === 3 ? 0x362920 : TROLL_PAL.warSkin, color2: TROLL_PAL.warSkin2, colorNoise: 0.45, colorFreq: 2.5 / sc, mat: 'skin_troll', strength: 1, k: 0.2 * sc });
    if (ctx.armor >= 0.25) warFootWraps(ctx);
  }

  const proj = makeProjector(s, box);
  if (!proj) return;
  trollHands(ctx, gear);
  if (variant === 'cave') {
    caveWarts(ctx, gear, proj, bucket, 0.55);
    caveBristles(ctx, gear, proj, bucket);
    ankleShackle(ctx, gear, proj);
    trollBelt(ctx, gear, proj, beltY, { width: 0.085 });
    // the club (sheet): a huge knobbly head, 2.5 m overall
    scaleHeldWeapon(ctx, 'hand_r', ['club'], [1.55, 0.92, 1.55]);
  } else {
    if (ctx.helmet) warHelm(ctx, gear, bucket);
    warMane(ctx, gear, proj, bucket);
    if (ctx.armor >= 0.25) {
      warHarness(ctx, gear, proj, beltY);
      trollBelt(ctx, gear, proj, beltY, { width: 0.085 });
      warBelts(ctx, gear, proj, beltY);
      warGreaves(ctx, gear, proj);
      warBracers(ctx, gear, proj);
    }
      // the war sheet's spaulders ride higher than the joint (spike tips at about 4.3 m): lift them as they are built
      const lift = new THREE.Matrix4().makeTranslation(0, 0.06 * sc, 0);
      const liftedGear: GearFn = (geo, o) => gear(geo, { ...o, matrix: o.matrix ? lift.clone().multiply(o.matrix) : lift });
    if (ctx.armor >= 0.5) {
      pauldron(ctx, liftedGear, 1, { lames: 3, spikes: 5, scale: 1.6, rusty: false, color: TROLL_PAL.pauldron, reach: 2.2, half: 80, ry: 1.0 });
      pauldron(ctx, liftedGear, -1, { lames: 3, spikes: 5, scale: 1.6, rusty: false, color: TROLL_PAL.pauldron, reach: 2.2, half: 80, ry: 1.0 });
    }
    caveWarts(ctx, gear, proj, bucket + 10, 0.08);
    bigHammerHead(ctx, 'hand_r', [0.36, 0.2, 0.2], [1.3, 0.8, 1.3]);
  }
}

export const trollKind: KindDef = {
  label: 'Troll',
  // crown height of the 4.5 m sheets once the hunch has taken its share (the war troll's helm rises to 4.95 m)
  height: 4.52,
  build: { shoulders: 1.85, hips: 1.7, bulk: 1.45, belly: 0.5, chest: 1.1, armLength: 1.3, legLength: 0.93, headSize: 1.3, neck: 0.85, neckThick: 0.9, hunch: 0.3, handSize: 1.45, footSize: 1.45, muscle: 0.6 },
  face: TROLL_FACE,
  skin: { color: TROLL_PAL.skin, color2: TROLL_PAL.skin2, blotch: 0.45, blemish: 0.5, scars: 3, warts: 0.38, wrinkles: 1.0, lips: TROLL_PAL.lips, brows: 0x3a3a2c, surface: 'skin_troll', scatter: TROLL_PAL.scatter },
  eyes: { color: TROLL_PAL.eyes, glow: 0.2, sclera: 0xa8a070 },
  hair: { style: 'bald', color: TROLL_PAL.bristle },
  // knee-length ragged kilt on a broad leather belt at the waist (both sheets)
  outfit: [
    { type: 'skirt', color: TROLL_PAL.kilt, color2: TROLL_PAL.kilt2, length: 0.84, mat: 'rags', thickness: 0.075, tatter: 0.02 },
  ],
  armor: [],
  weapons: { right: 'club' },
  palette: TROLL_PAL,
  sfx: { voice: 'troll', roar: 'troll_roar', grunt: 'troll_hit', footstep: 'troll_step', weight: 1 },
  anim: { hunch: 0.95, swagger: 0.7, aggression: 0.8, stance: 1.3, cadence: 0.9, armSwing: 1.2 },
  variation: { height: 0.03, bulk: 0.06, skin: 0.1 },
  detail: { faceRes: 0.0125, refine: 1, hands: false, res: 0.105, headRes: 0.03, detailScale: 2.4 },
  extras: trollExtras,
};
