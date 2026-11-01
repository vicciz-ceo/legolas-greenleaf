/**
 * Dwarves of Thorin's company: four looks across the seed buckets, each built against its sheet in
 * docs/refs/dwarf_{bald,hat,elder,redbeard}:
 *   0  bald and tattooed warrior: dark braided beard with brass rings, leather vest over mail with
 *      crossed straps, bare muscular arms with knotwork, two hatchets at the belt
 *   1  floppy felt hat, chestnut curls, ochre tunic under a quilted brown vest
 *   2  elder: long wavy white beard, dark blue wool tunic, brown leather vest
 *   3  redbeard: huge wild red hair and beard, russet tunic under a heavy leather vest
 * They ride waist-deep in barrels and appear in crowds, so the upper body, hair and beard carry
 * the character. Budget ≤ 12k triangles each (crowd kind, faceRes 0).
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import { createWeapon } from '../../../weapons';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { makeProjector } from '../uruks_bosses/common';
import { put } from './armor';
import { ctxBucket, devNum, devSkip, mix, recipeRng } from './common';
import { sculptStrap } from './garments';
import { addBeard, addBrows, addHairdo, braidClasps, hairMaterial, sculptBeardMass, withHair, type BeardOpts } from './hair';
import { DOME_ROUND, STEEL, domeHelm } from './headgear';
import {
  bodyLayer,
  feltHat,
  hipHatchet,
  knotTattoos,
  quiltLines,
  sculptBelt,
  sculptVest,
  skirt,
  sculptMane,
  sleeveCuffs,
  squareBuckle,
  tuneHair,
} from './dwarf_parts';
import { faceStroke } from './markings';

/** belt raised from the hip joint to the sheet's waist (belt at ~0.73 m on a 1.36 m dwarf) */
const BELT_RAISE = 0.263;

// materials, tuned against the sheets' roughness/sheen notes (leather 0.72 / 0.08, cloth 0.85 / 0.3)
const LEATHER = surface('leather_worn', { rough: 0.72, sheen: 0.08 });
const VEST_LEATHER = surface('leather_worn', { rough: 0.66, sheen: 0.12 });
const WOOL = surface('wool', { rough: 0.9, sheen: 0.3 });
const TWILL = surface('twill', { rough: 0.88, sheen: 0.3 });
const TROUSER = surface('twill', { rough: 0.92, sheen: 0.2, pat: { weave: -0.6 } });
const QUILT = surface('wool', { rough: 0.95, sheen: 0.18, pat: { weave: 0.3 } });
const MAIL = surface('mail', { rough: 0.5, metal: 0.85 });

/**
 * sRGB albedo per look. Every colour starts from the sheet (spec.json design.outfit_layers, face,
 * hair) cross-checked with observed.samples (lit medians, so albedo is a little deeper than they
 * read); the lab and AgX render browns lighter and wools more saturated, so reds and blues are
 * pulled slightly towards grey.
 */
const PAL = {
  common: {
    skin: 0xa8664a, // sheet skin_base #bc947c..#c7a082: much warmer and deeper (it renders pale pink in the lab)
    skin2: 0x8a4f3a,
    lips: 0xa65e54,
    eyes: 0x5b4430, // sheet iris #684f36
    sclera: 0xc4b4a0,
    trousers: 0x483a2c, // dark brown wool (all four sheets: #4a3a2c .. #5b4636)
    boots: 0x3e2c20,
    bootsCuff: 0x5a4130,
    belt: 0x3d2c1e,
  },
  bald: {
    vest: 0x3d2b20, // design leather #594232, observed #5b453b (renders lighter)
    vest2: 0x58402e,
    strap: 0x5a3d28,
    mail: 0x6a675f, // metal fittings #66615a, observed axe metal #535051
    beard: 0x1f150f, // hair root #34251e: the hair shader lifts dark colours a lot, so the albedo goes very dark
    beardTip: 0x3a2c22,
    beardDeep: 0x0f0a07,
    brow: 0x2a1e18,
    ink: 0x38404c, // blue-grey tattoo ink
    brass: 0x9a7a3a,
    steel: 0x7d7a74,
    haft: 0x5a3e28,
    buckle: 0x7d7a74,
  },
  hat: {
    tunic: 0x7d5d2c, // design cloth #99743e (observed #a66f35); wool renders much lighter
    vest: 0x35261f, // padded vest, observed leather #483127
    felt: 0x6a4d2c,
    felt2: 0x7e5d38,
    quilt: 0x20160f,
    beard: 0x4e2e1a, // chestnut #70452b
    beardTip: 0x6e4428,
    beardDeep: 0x2c180c,
    brow: 0x5a3820,
    belt: 0x4a3322,
    buckle: 0xa8873f,
  },
  elder: {
    tunic: 0x2b374f, // design cloth #394354 (observed #242c42, lit darker)
    vest: 0x56382a, // observed leather #6c4b3c
    vest2: 0x6e4a32,
    beard: 0xd6d0c4, // #cfc9bc
    beardTip: 0xf0ece4,
    beardDeep: 0xa49e92,
    brow: 0xcfc9bc,
    belt: 0x4a3424,
    buckle: 0x9a8244,
  },
  red: {
    tunic: 0x6a2f20, // design cloth #74412c (observed #6d2e1d)
    vest: 0x42312a, // observed leather #533b2e
    vest2: 0x5a3f2e,
    beard: 0x6a2410, // #8f4424 (renders much lighter)
    beardTip: 0x8e4018,
    beardDeep: 0x34120a,
    brow: 0x7a2f12,
    belt: 0x3e2e22,
    buckle: 0x6f695d,
  },
};

/** shared: ruddy cheeks and nose, eyebrows, wrinkles */
function faceCommon(ctx: KindContext, o: { brow: number; blush?: number; scars?: number; browLen?: number }, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  addBrows(ctx, { color: o.brow, count: 11, length: o.browLen ?? 0.075, width: 0.015, y: 0.075, z: 0.395 }, rng);
  s.mirrored(() => s.ellipsoid(P.h(0.135, -0.055, 0.33), [0.095 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0x8a4a38, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.45 }));
  const b = o.blush ?? 0.6;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0xa8503e, mat: 'skin_weathered', bone: 'head', k: 0.05 * u, strength: b }));
  s.ellipsoid(P.h(0, -0.27, 0.52), [0.075 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0xb4584a, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: b });
  for (let i = 0; i < (o.scars ?? 0); i++) {
    const x = (rng.float() > 0.5 ? 1 : -1) * rng.range(0.1, 0.22);
    faceStroke(ctx, [[x, rng.range(0.0, 0.1)], [x + rng.range(-0.05, 0.05), rng.range(-0.28, -0.15)]], { color: 0x8a4a40, r: 0.007, mat: 'skin_weathered', strength: 0.8 });
  }
}

/** landmark heights of a layout, in metres above the ground, scaled to this dwarf's actual size */
function stance(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const k = sc / 0.735;
  const beltY = P.j.thigh_l[1] + (0.07 + BELT_RAISE) * sc;
  return { sc, k, beltY };
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 0: the bald, tattooed warrior
// ─────────────────────────────────────────────────────────────────────────────
function warrior(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const C = PAL.bald;
  const { sc, k, beltY } = stance(ctx);
  const u = P.headH;
  // bald: the thin cap painted back to skin
  s.ellipsoid(P.h(0, 0.045, -0.055), [0.35 * u, 0.43 * u, 0.455 * u], { op: 'paint', color: PAL.common.skin, mat: 'skin_weathered', bone: 'head', k: 0.02 * u, strength: 1 });
  tuneHair(hairMaterial(C.brow), { spec: 0.5, alpha: 0.3 });
  faceCommon(ctx, { brow: C.brow, blush: 0.4, scars: 2, browLen: 0.085 }, rng);
  // beard: dark brown with grey in it, full round, a heavy moustache and three braids with brass rings
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.beard, length: 0.15 * sc, width: 1.02, fullness: 1.05 });
  const beard: BeardOpts = {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.16 * sc, locks: 15, perLock: 8, shape: 'round', spread: 1.05, cheeks: true, wave: 0.55, width: 0.05,
    moustache: { length: 0.12 * sc, droop: 0.5, curl: 0.3 },
    braids: [{ x: 0.1, length: 0.13 * sc, radius: 0.02 }, { x: 0, length: 0.17 * sc, radius: 0.02 }, { x: -0.1, length: 0.13 * sc, radius: 0.02 }],
  };
  const br = addBeard(ctx, beard, rng);
  braidClasps(ctx, br.braidPaths, C.brass);

  // ── torso: mail shirt, open leather vest, crossed straps, two belts ──
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.mail, mat: MAIL, inflate: 0.011, sleeve: 0, hemY: hem, pad: { rx: 0.166, rz: 0.142, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.021, hemY: hem, open: 0.05, openY: P.j.chest[1] - 0.08 * sc, neckUp: 0.01, skirtParts: true });
  const strapOpts = { color: C.strap, mat: LEATHER, width: 0.042 * sc, inflate: 0.03 * sc };
  sculptStrap(ctx, { ...strapOpts, sign: 1 });
  sculptStrap(ctx, { ...strapOpts, sign: -1 });
  sculptBelt(ctx, { y: beltY, hw: 0.027, color: PAL.common.belt, mat: LEATHER, inflate: 0.031, pad: { rx: 0.19, rz: 0.165 } });
  sculptBelt(ctx, { y: beltY - 0.05 * sc, hw: 0.011, color: PAL.common.belt, mat: LEATHER, inflate: 0.03, pad: { rx: 0.188, rz: 0.163 } });

  // ── bare muscular arms (sheet): swell the upper arm; knotwork goes on top ──
  const L = P.hand.l.L;
  const sh = P.j.upperarm_l;
  const skin = ctx.def.skin.color;
  s.mirrored(() => {
    const a: [number, number, number] = [sh[0] + L.x * 0.02 * sc, sh[1] + L.y * 0.02 * sc, sh[2]];
    const b: [number, number, number] = [sh[0] + L.x * P.upperArm * 0.96, sh[1] + L.y * P.upperArm * 0.96, sh[2]];
    s.cone(a, b, 0.072 * k, 0.056 * k, { color: skin, mat: 'skin_weathered', bone: 'upperarm_l', k: 0.03 * sc, noise: null });
  });

  // ── gear on the finished sculpt ──
  const proj = makeProjector(s, { min: [-0.45 * sc, 0.2 * sc, -0.4 * sc], max: [0.45 * sc, P.headC[1] + 0.4 * sc, 0.4 * sc] });
  if (proj) {
    const yRef = beltY - 0.027 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.015 * sc, yRef, yBot: 0.47 * k, color: C.mail, mat: MAIL, flare: 0.045, out: 0.004, thick: 0.01, seg: 22 });
    skirt(ctx, proj, { yTop: beltY - 0.02 * sc, yRef, yBot: 0.535 * k, color: C.vest, mat: VEST_LEATHER, flare: 0.06, out: 0.016, thick: 0.014, gapFront: 0.42, seg: 22 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.06, h: 0.05 });
    if (!devSkip('tattoo')) knotTattoos(ctx, proj, { ink: C.ink, skin, head: true, arms: true });
  }
  hipHatchet(ctx, 1, beltY, { steel: C.steel, leather: PAL.common.belt, haft: C.haft });
  hipHatchet(ctx, -1, beltY, { steel: C.steel, leather: PAL.common.belt, haft: C.haft });
  if (ctx.spec.helmet === true) domeHelm(ctx, { color: 0x55565a, trim: 0x6a5a3a, profile: DOME_ROUND, finial: 'ball', cheeks: true, nasal: true, rivets: 22, neck: 'mail' });
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 1: the floppy-hat dwarf with the curly chestnut beard
// ─────────────────────────────────────────────────────────────────────────────
function jester(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const C = PAL.hat;
  const { sc, k, beltY } = stance(ctx);
  tuneHair(hairMaterial(C.beard), { spec: 0.7, alpha: 0.3 });
  // curls at the sides and nape under the hat
  addHairdo(ctx, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.2 * sc, count: 80, width: 0.042, wave: 1.2, wild: 0.5, comb: 0.4, front: 0.02, back: -0.45, gravity: 6, maxY: 0.1 }, rng);
  faceCommon(ctx, { brow: C.brow, blush: 0.7 }, rng);
  // full curly beard: rounded, to the chest, a moustache that joins it
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.beard, length: 0.14 * sc, width: 1.04, fullness: 1.0 });
  const beard: BeardOpts = {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.17 * sc, locks: 16, perLock: 8, shape: 'round', spread: 1.08, cheeks: true, wave: 1.3, width: 0.05, gravity: 5,
    moustache: { length: 0.13 * sc, droop: 0.45, curl: 1.0 },
  };
  addBeard(ctx, beard, rng);
  feltHat(ctx, { color: C.felt, color2: C.felt2, mat: WOOL, brim: 0.86, droop: 0.24, y: 0.15, band: 0x3a2a1c });

  // ochre tunic with long gathered sleeves, a padded brown vest open at the front, a thin belt
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: WOOL, inflate: 0.012, sleeveInflate: 0.024, sleeve: 2, hemY: hem, pad: { rx: 0.185, rz: 0.158, y: beltY } });
  sculptVest(ctx, { color: C.vest, mat: QUILT, inflate: 0.026, hemY: hem, open: 0.032, openY: P.j.chest[1] - 0.05 * sc, neckUp: 0.004, skirtParts: true });
  sculptBelt(ctx, { y: beltY, hw: 0.02, color: C.belt, mat: LEATHER, inflate: 0.037, pad: { rx: 0.2, rz: 0.172 } });
  sleeveCuffs(ctx, { color: C.tunic, mat: WOOL });
  const proj = makeProjector(ctx.sculpt, { min: [-0.45 * sc, 0.2 * sc, -0.4 * sc], max: [0.45 * sc, P.headC[1] + 0.4 * sc, 0.4 * sc] });
  if (proj) {
    const yRef = beltY - 0.02 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.505 * k, color: C.tunic, mat: WOOL, flare: 0.05, out: 0.008, thick: 0.012, seg: 26 });
    skirt(ctx, proj, { yTop: beltY - 0.02 * sc, yRef, yBot: 0.57 * k, color: C.vest, mat: QUILT, flare: 0.03, out: 0.02, thick: 0.016, gapFront: 0.22, seg: 26 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.05, h: 0.042, mat: 'gold' });
    if (!devSkip('quilt')) quiltLines(ctx, proj, { rows: [0.64 * k, 0.8 * k, 0.88 * k, 0.96 * k], cols: [0.04 * k, 0.085 * k, 0.13 * k, -0.04 * k, -0.085 * k, -0.13 * k], y0: 0.6 * k, y1: 1.0 * k, color: C.quilt, skipY: [beltY - 0.03 * sc, beltY + 0.03 * sc] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 2: the white-bearded elder
// ─────────────────────────────────────────────────────────────────────────────
function elder(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const C = PAL.elder;
  const { sc, k, beltY } = stance(ctx);
  tuneHair(hairMaterial(C.beard), { spec: 1, alpha: 0.3 });
  // thinning hair: nothing on the crown, long white hair at the sides and behind
  sculptMane(ctx, { color: mix(C.beard, 0x000000, 0.25), color2: C.beard, drop: 0.1, width: 0.95 });
  addHairdo(ctx, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.3 * sc, count: 70, width: 0.045, wave: 0.7, wild: 0.2, comb: 1.0, front: 0.0, back: -0.4, gravity: 5, maxY: 0.1 }, rng);
  faceCommon(ctx, { brow: C.brow, blush: 0.55, browLen: 0.09 }, rng);
  // long wavy white beard to the belt
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.3), color2: C.beardDeep, length: 0.5 * sc, width: 0.95, fullness: 0.85 });
  const beard: BeardOpts = {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.62 * sc, locks: 15, perLock: 8, shape: 'spade', spread: 0.9, cheeks: true, wave: 0.9, width: 0.05, gravity: 6,
    moustache: { length: 0.2 * sc, droop: 0.8, curl: 0.3 },
  };
  addBeard(ctx, beard, rng);

  // dark blue wool tunic with long sleeves and a flared hem, short brown leather vest, brass buckle
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: TWILL, inflate: 0.012, sleeveInflate: 0.022, sleeve: 2, hemY: hem, pad: { rx: 0.18, rz: 0.155, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.022, hemY: beltY - 0.045 * sc, open: 0.075, openY: P.j.chest[1] - 0.16 * sc, neckUp: 0.004, armLean: 0.5 });
  sculptBelt(ctx, { y: beltY, hw: 0.021, color: C.belt, mat: LEATHER, inflate: 0.034, pad: { rx: 0.192, rz: 0.166 } });
  const proj = makeProjector(ctx.sculpt, { min: [-0.45 * sc, 0.2 * sc, -0.4 * sc], max: [0.45 * sc, P.headC[1] + 0.4 * sc, 0.4 * sc] });
  if (proj) {
    const yRef = beltY - 0.021 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.5 * k, color: C.tunic, mat: TWILL, flare: 0.065, out: 0.008, thick: 0.012, seg: 28 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.056, h: 0.046, mat: 'gold' });
  }
  if (ctx.spec.helmet === true) domeHelm(ctx, { color: 0x6a6a6e, trim: 0xa88a48, profile: DOME_ROUND, finial: 'ball', cheeks: true, rivets: 22 });
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 3: the huge red beard
// ─────────────────────────────────────────────────────────────────────────────
function redbeard(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const C = PAL.red;
  const { sc, k, beltY } = stance(ctx);
  sculptHairCap(s, P, { style: 'wild', color: C.beard, tipColor: C.beardTip, length: 1, density: 1 });
  tuneHair(hairMaterial(C.beard), { spec: 1, alpha: 0.3 });
  sculptMane(ctx, { color: mix(C.beard, 0x000000, 0.2), color2: C.beard, drop: 1, width: 1.05 });
  // red-brown hair falling past the shoulders, wavy
  addHairdo(ctx, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.62 * sc, count: 120, width: 0.052, wave: 1.0, wild: 0.5, comb: 0.8, front: 0.12, back: -0.4, gravity: 4 }, rng);
  faceCommon(ctx, { brow: C.brow, blush: 0.8, scars: 1, browLen: 0.085 }, rng);
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.3), color2: C.beard, length: 0.4 * sc, width: 1.18, fullness: 1.35 });
  const beard: BeardOpts = {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.46 * sc, locks: 17, perLock: 9, shape: 'round', spread: 1.2, cheeks: true, wave: 1.0, width: 0.056, gravity: 5,
    moustache: { length: 0.16 * sc, droop: 0.55, curl: 0.7 },
  };
  addBeard(ctx, beard, rng);

  // russet tunic with long sleeves, a heavy worn leather vest, thick belt with a steel buckle
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: WOOL, inflate: 0.013, sleeveInflate: 0.026, sleeve: 2, hemY: hem, pad: { rx: 0.2, rz: 0.172, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.028, hemY: hem, open: 0.06, openY: P.j.chest[1] - 0.12 * sc, neckUp: 0.006, skirtParts: true });
  sculptBelt(ctx, { y: beltY, hw: 0.024, color: C.belt, mat: LEATHER, inflate: 0.04, pad: { rx: 0.213, rz: 0.186 } });
  sleeveCuffs(ctx, { color: C.tunic, mat: WOOL });
  const proj = makeProjector(s, { min: [-0.45 * sc, 0.2 * sc, -0.4 * sc], max: [0.45 * sc, P.headC[1] + 0.4 * sc, 0.4 * sc] });
  if (proj) {
    const yRef = beltY - 0.024 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.5 * k, color: C.tunic, mat: WOOL, flare: 0.05, out: 0.008, thick: 0.012, gapFront: 0.12, seg: 26 });
    skirt(ctx, proj, { yTop: beltY - 0.02 * sc, yRef, yBot: 0.62 * k, color: C.vest, mat: VEST_LEATHER, flare: 0.035, out: 0.022, thick: 0.016, gapFront: 0.3, seg: 26 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.06, h: 0.05, mat: 'metal_dark' });
  }
  if (ctx.spec.helmet === true) domeHelm(ctx, { color: 0x5a5b5e, trim: 0x9b7432, profile: DOME_ROUND, finial: 'spike', cheeks: true, rivets: 22 });
}

export function dwarfExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const b = ctxBucket(ctx);
    const rng = recipeRng(ctx, 'dwarf');
    switch (b) {
      case 1: return jester(ctx, rng);
      case 2: return elder(ctx, rng);
      case 3: return redbeard(ctx, rng);
      default: return warrior(ctx, rng);
    }
  });
}

export const dwarfDef: KindDef = {
  label: 'Dwarf',
  height: 1.36,
  // barrel-chested: sheet shoulders 0.56 m, hips 0.43 m at 1.35-1.46 m; short legs (hip joint ~0.48 m)
  build: { shoulders: 1.25, hips: 1.25, bulk: 1.3, belly: 0.35, chest: 1.12, armLength: 0.95, legLength: 0.72, headSize: 1.42, neck: 0.4, neckThick: 1.4, handSize: 1.25, footSize: 1.15, muscle: 0.65 },
  face: {
    jaw: 1.2, jawLength: 0.95, chin: 0.9, brow: 1.9, cheekbones: 1.2,
    nose: { length: 1.15, width: 1.45, bridge: 1.1, hook: 0.2, tip: 1.35 },
    lips: { width: 1.0, fullness: 0.85 }, ears: 'round', earSize: 1.0, eyeSize: 0.86, eyeOpen: 0.62, eyeSpacing: 0.97, eyeTilt: -0.03, foreheadSlope: 0.1, asym: 0.15,
  },
  skin: { color: PAL.common.skin, color2: PAL.common.skin2, blotch: 0.45, blemish: 0.2, scars: 1, wrinkles: 0.55, lips: PAL.common.lips, surface: 'skin_weathered', scatter: 0xd0503a },
  eyes: { color: PAL.common.eyes, sclera: PAL.common.sclera },
  // chain bones only: the visible hair and beard are grown per seed bucket in extras (see hair.ts)
  hair: { style: 'stringy', color: PAL.common.skin, density: 0 },
  beard: { style: 'stubble', color: 0x5a3a24, length: 0.08 },
  // tunics, vests and belts are sculpted per look in extras (the outfit list is the same for every bucket)
  outfit: [
    { type: 'trousers', color: PAL.common.trousers, mat: TROUSER, thickness: 0.004 },
    { type: 'boots', color: PAL.common.boots, color2: PAL.common.bootsCuff, length: 1.0, thickness: 0.016, mat: LEATHER },
  ],
  armor: [],
  weapons: { right: 'axe', style: 'dwarf' },
  anim: { swagger: 0.5, aggression: 0.5, stance: 1.3, cadence: 1.05 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.14 },
  detail: { res: devNum('res', 0.056), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.3 },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: dwarfExtras,
};

void STEEL;
void put;
void createWeapon;
void THREE;
