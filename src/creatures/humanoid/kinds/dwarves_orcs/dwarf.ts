/**
 * Dwarves of Thorin's company: four looks across the seed buckets, each built against its sheet in
 * docs/refs/dwarf_{bald,hat,elder,redbeard}:
 *   0  bald and tattooed warrior: dark braided beard with brass rings, leather vest over mail with
 *      crossed straps, bare muscular arms with knotwork, two hatchets at the belt
 *   1  floppy felt hat, chestnut curls, ochre tunic under a quilted brown vest
 *   2  elder: long wavy white beard, dark blue wool tunic, brown leather vest
 *   3  redbeard: huge wild copper hair and beard, russet tunic under a heavy worn leather vest
 * They ride waist-deep in barrels and appear in crowds, so the upper body, hair and beard carry
 * the character. Budget ≤ 12k triangles each (crowd kind, faceRes 0).
 */
import { Rng } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { makeProjector } from '../uruks_bosses/common';
import { ctxBucket, devNum, devSkip, mix, recipeRng } from './common';
import { sculptStrap } from './garments';
import { addBrows, braidClasps, sculptBeardMass, withHair, type BeardOpts } from './hair';
import { DOME_ROUND, domeHelm } from './headgear';
import {
  bodyLayer,
  feltHat,
  hipHatchet,
  knotTattoos,
  sculptBelt,
  sculptVest,
  skirt,
  sleeveCuffs,
  squareBuckle,
} from './dwarf_parts';
import { HairSet, dwarfHairMaterial, hangLocks, ribbonBeard, sculptHairDome } from './dwarf_hair';
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
const MAIL = surface('mail', { rough: 0.62, metal: 0.6 });

/**
 * sRGB albedo per look. Every colour starts from the sheet (spec.json design.outfit_layers, face,
 * hair) cross-checked with observed.samples (lit medians, so albedo is a little deeper than they
 * read); the lab and AgX render browns lighter and wools more saturated, so reds and blues are
 * pulled slightly towards grey.
 */
const PAL = {
  common: {
    skin: 0x8c543b, // sheet skin_base #bc947c..#c7a082 (observed lit #c97e68): much deeper, the lab renders skin pale
    skin2: 0x74402f,
    lips: 0x9a5650,
    eyes: 0x5b4430, // sheet iris #684f36
    sclera: 0xc4b4a0,
    trousers: 0x483a2c, // dark brown wool (all four sheets: #4a3a2c .. #5b4636)
    boots: 0x3e2c20,
    bootsCuff: 0x5a4130,
    belt: 0x3d2c1e,
  },
  bald: {
    vest: 0x3d2b20, // design leather #594232, observed #5b453b (renders lighter)
    vest2: 0x4a3626,
    strap: 0x5a3d2a,
    mail: 0x4a4843, // metal fittings #66615a, observed axe metal #535051; the lab renders mail light
    beard: 0x2e2018, // hair root #34251e; the hair shader lifts dark hair, so the albedo goes darker
    beardTip: 0x40322a,
    beardDeep: 0x1a110c,
    brow: 0x2a1e18,
    ink: 0x38404c, // blue-grey tattoo ink
    brass: 0xb08a3a,
    steel: 0x7d7a74,
    haft: 0x5a3e28,
    buckle: 0x7d7a74,
  },
  hat: {
    tunic: 0x7d5d2c, // design cloth #99743e (observed #a66f35); wool renders much lighter
    vest: 0x35261f, // padded vest, observed leather #483127
    felt: 0x6a4d2c,
    felt2: 0x7e5d38,
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
    beard: 0xe6e0d4, // hair #cfc7c3 lit; warm off-white
    beardTip: 0xcfc8ba,
    beardDeep: 0xbab3a6,
    brow: 0xcfc9bc,
    belt: 0x4a3424,
    buckle: 0xb08a3a,
  },
  red: {
    tunic: 0x8a3a2c, // design cloth #74412c (observed #6d2e1d)
    vest: 0x3a2a22, // observed leather #533b2e
    vest2: 0x4e3a2e,
    beard: 0x8c3a12, // copper #8f4424 (observed hair #702c13): saturated, no near-black roots
    beardTip: 0xae5219,
    beardDeep: 0x74300f,
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

/** the box the finished sculpt is sampled in (torso, head and hair) */
function sampleBox(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  return { min: [-0.45 * sc, 0.2 * sc, -0.4 * sc] as [number, number, number], max: [0.45 * sc, P.headC[1] + 0.4 * sc, 0.4 * sc] as [number, number, number] };
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
  faceCommon(ctx, { brow: C.brow, blush: 0.4, scars: 2, browLen: 0.085 }, rng);
  // beard: dark brown, full and round, a heavy moustache and three thick braids with brass rings
  const hs = new HairSet();
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.2), color2: C.beard, length: 0.15 * sc, width: 1.02, fullness: 1.05 });
  const beard: BeardOpts = {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.16 * sc, locks: 12, perLock: 6, segments: 4, shape: 'round', spread: 1.05, cheeks: true, wave: 0.55, width: 0.058,
    moustache: { length: 0.12 * sc, droop: 0.5, curl: 0.3 },
    braids: [{ x: 0.1, length: 0.13 * sc, radius: 0.026 }, { x: 0, length: 0.17 * sc, radius: 0.026 }, { x: -0.1, length: 0.13 * sc, radius: 0.026 }],
  };
  const br = hs.beard(ctx, beard, rng);
  hs.attach(ctx, dwarfHairMaterial('dwarf0', { color: C.beard, spec: 0.5, alpha: 0.3 }));
  braidClasps(ctx, br.braidPaths, C.brass);

  // ── torso: mail shirt, open leather vest, crossed straps (front and back), two belts ──
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.mail, mat: MAIL, inflate: 0.011, sleeve: 0, hemY: hem, pad: { rx: 0.166, rz: 0.142, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.021, hemY: hem, open: 0.085, openY: P.j.chest[1] - 0.2 * sc, neckUp: 0.01, skirtParts: true });
  const strapOpts = { color: C.strap, mat: LEATHER, width: 0.055 * sc, inflate: 0.043 * sc };
  sculptStrap(ctx, { ...strapOpts, sign: 1 });
  sculptStrap(ctx, { ...strapOpts, sign: -1 });
  sculptBelt(ctx, { y: beltY, hw: 0.027, color: PAL.common.belt, mat: LEATHER, inflate: 0.05, pad: { rx: 0.19, rz: 0.165 } });
  sculptBelt(ctx, { y: beltY - 0.05 * sc, hw: 0.011, color: PAL.common.belt, mat: LEATHER, inflate: 0.046, pad: { rx: 0.188, rz: 0.163 } });

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
  const proj = makeProjector(s, sampleBox(ctx));
  if (proj) {
    const yRef = beltY - 0.027 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.03 * sc, yRef, yBot: 0.5 * k, color: C.mail, mat: MAIL, flare: 0.03, out: 0.004, thick: 0.01, seg: 20 });
    skirt(ctx, proj, { yTop: beltY - 0.035 * sc, yRef, yBot: 0.535 * k, color: C.vest, mat: VEST_LEATHER, flare: 0.05, out: 0.014, thick: 0.014, gapFront: 0.42, seg: 20 });
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
  // curls at the sides and nape under the hat, a full curly beard to the chest, a moustache that joins it
  const hs = new HairSet();
  hs.hairdo(ctx, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.2 * sc, count: 48, width: 0.05, segments: 4, wave: 1.2, wild: 0.5, comb: 0.4, front: 0.15, back: -0.45, gravity: 6, maxY: 0.1 }, rng);
  faceCommon(ctx, { brow: C.brow, blush: 0.7 }, rng);
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.2), color2: C.beard, length: 0.14 * sc, width: 1.04, fullness: 1.0 });
  hs.beard(ctx, {
    clear: 0.05 * sc, color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.17 * sc, locks: 12, perLock: 6, segments: 4, shape: 'round', spread: 1.08, cheeks: true, wave: 1.3, width: 0.06, gravity: 5,
    moustache: { length: 0.13 * sc, droop: 0.45, curl: 1.0 },
  }, rng);
  hs.attach(ctx, dwarfHairMaterial('dwarf1', { color: C.beard, spec: 0.7, alpha: 0.3 }));
  feltHat(ctx, { color: C.felt, color2: C.felt2, mat: WOOL, brim: 0.58, droop: 0.12, y: 0.1, band: 0x3a2a1c });

  // ochre tunic with long gathered sleeves, a padded brown vest running from the shoulders to the hip, a thin belt
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: WOOL, inflate: 0.012, sleeveInflate: 0.024, sleeve: 2, hemY: hem, pad: { rx: 0.185, rz: 0.158, y: beltY } });
  sculptVest(ctx, { color: C.vest, mat: QUILT, inflate: 0.026, hemY: hem, open: 0.032, openY: P.j.chest[1] - 0.05 * sc, neckUp: 0.004, skirtParts: true, noise: devSkip('quilt') ? undefined : { amp: 0.006, freq: 13, type: 'cells', octaves: 1 } });
  sculptBelt(ctx, { y: beltY, hw: 0.02, color: C.belt, mat: LEATHER, inflate: 0.037, pad: { rx: 0.2, rz: 0.172 } });
  sleeveCuffs(ctx, { color: C.tunic, mat: WOOL });
  const proj = makeProjector(ctx.sculpt, sampleBox(ctx));
  if (proj) {
    const yRef = beltY - 0.02 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.505 * k, color: C.tunic, mat: WOOL, flare: 0.04, out: 0.004, thick: 0.012, seg: 26 });
    skirt(ctx, proj, { yTop: beltY - 0.02 * sc, yRef, yBot: 0.525 * k, color: C.vest, mat: QUILT, flare: 0.05, out: 0.012, thick: 0.014, seg: 26 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.05, h: 0.042, mat: 'gold' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 2: the white-bearded elder
// ─────────────────────────────────────────────────────────────────────────────
function elder(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const C = PAL.elder;
  const { sc, k, beltY } = stance(ctx);
  faceCommon(ctx, { brow: C.brow, blush: 0.55, browLen: 0.09 }, rng);

  // dark blue wool tunic with long sleeves and a flared hem, short brown leather vest open in the middle, brass buckle
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: TWILL, inflate: 0.012, sleeveInflate: 0.022, sleeve: 2, hemY: hem, pad: { rx: 0.18, rz: 0.155, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.022, hemY: beltY - 0.03 * sc, open: 0.1, openY: P.j.chest[1] - 0.2 * sc, neckUp: 0.004, armLean: 0.5 });
  sculptBelt(ctx, { y: beltY, hw: 0.021, color: C.belt, mat: LEATHER, inflate: 0.034, pad: { rx: 0.192, rz: 0.166 } });
  // the beard's mass and the hair dome go in before the sculpt is sampled, so the ribbons lie on them
  sculptBeardMass(ctx, { color: mix(C.beard, C.beardDeep, 0.3), color2: C.beardTip, length: 0.45 * sc, width: 0.92, fullness: 1.0 });
  if (!devSkip('dome')) sculptHairDome(ctx, { color: C.beardTip, color2: C.beardDeep });
  const proj = makeProjector(ctx.sculpt, sampleBox(ctx));
  const hs = new HairSet();
  if (proj) {
    // long wavy white beard to the belt: a few wide overlapping ribbons
    hs.add(ribbonBeard(ctx, proj, rng, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.62 * sc, locks: 15, layers: 2, width: 0.062, spread: 0.29, shape: 'spade', amp: 0.012, waveLen: 0.1, clear: 0.012 }));
    // thin white hair at the sides and back of the head, falling to the shoulders
    const locks = [1.3, 1.6, 2.0, 2.4, 2.75].flatMap((az, i) => [1, -1].map((sd) => ({ az: sd * az, el: 0.12 + 0.05 * (i % 3), drop: (0.18 + 0.04 * i) * (sc / 0.735) })));
    locks.push({ az: 3.14, el: 0.1, drop: 0.3 * (sc / 0.735) }, { az: 2.95, el: 0.12, drop: 0.28 * (sc / 0.735) }, { az: -2.95, el: 0.12, drop: 0.28 * (sc / 0.735) });
    hs.add(hangLocks(ctx, proj, rng, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, locks, width: 0.05, amp: 0.008, waveLen: 0.1, clear: 0.01, layers: 1 }));
    const yRef = beltY - 0.021 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.5 * k, color: C.tunic, mat: TWILL, flare: 0.065, out: 0.008, thick: 0.012, seg: 28 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.066, h: 0.054, mat: 'gold' });
  }
  hs.attach(ctx, dwarfHairMaterial('dwarf2', { color: C.beard, spec: 0.35, alpha: 0.3, highlight: 0xe8e0d0 }));
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
  faceCommon(ctx, { brow: C.brow, blush: 0.8, scars: 1, browLen: 0.085 }, rng);

  // russet tunic with long sleeves, a heavy worn leather vest as ONE panel from the shoulders to the hip, thick belt
  const hem = beltY - 0.05 * sc;
  bodyLayer(ctx, { color: C.tunic, mat: WOOL, inflate: 0.013, sleeveInflate: 0.026, sleeve: 2, hemY: hem, pad: { rx: 0.2, rz: 0.172, y: beltY } });
  sculptVest(ctx, { color: C.vest, color2: C.vest2, mat: VEST_LEATHER, inflate: 0.028, hemY: hem, open: 0.06, openY: P.j.chest[1] - 0.12 * sc, neckUp: 0.006, skirtParts: true });
  sculptBelt(ctx, { y: beltY, hw: 0.024, color: C.belt, mat: LEATHER, inflate: 0.04, pad: { rx: 0.213, rz: 0.186 } });
  sleeveCuffs(ctx, { color: C.tunic, mat: WOOL });
  sculptBeardMass(ctx, { color: mix(C.beard, 0x000000, 0.12), color2: C.beard, length: 0.42 * sc, width: 1.18, fullness: 1.3 });
  const proj = makeProjector(s, sampleBox(ctx));
  const hs = new HairSet();
  // thick copper hair on top and a mane over the shoulders and back
  hs.hairdo(ctx, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.3 * sc, count: 40, width: 0.06, segments: 4, wave: 1.0, wild: 0.5, comb: 0.8, front: 0.25, back: -0.4, gravity: 4 }, rng);
  if (proj) {
    hs.add(ribbonBeard(ctx, proj, rng, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, length: 0.46 * sc, locks: 15, layers: 2, width: 0.064, spread: 0.3, shape: 'round', amp: 0.016, waveLen: 0.08, clear: 0.014 }));
    const f = sc / 0.735;
    const locks = [1.3, 1.6, 1.95, 2.3, 2.6, 2.9].flatMap((az, i) => [1, -1].map((sd) => ({ az: sd * az, el: 0.2 + 0.1 * (i % 3), drop: (0.3 + 0.04 * i) * f })));
    locks.push({ az: 3.14, el: 0.25, drop: 0.5 * f }, { az: 3.4, el: 0.3, drop: 0.46 * f }, { az: 2.88, el: 0.3, drop: 0.46 * f });
    hs.add(hangLocks(ctx, proj, rng, { color: C.beard, tip: C.beardTip, deep: C.beardDeep, locks, width: 0.075, amp: 0.016, waveLen: 0.09, clear: 0.014, layers: 2 }));
    const yRef = beltY - 0.024 * sc - 0.012 * sc;
    skirt(ctx, proj, { yTop: beltY - 0.012 * sc, yRef, yBot: 0.5 * k, color: C.tunic, mat: WOOL, flare: 0.04, out: 0.004, thick: 0.012, seg: 26 });
    skirt(ctx, proj, { yTop: beltY - 0.02 * sc, yRef, yBot: 0.55 * k, color: C.vest, mat: VEST_LEATHER, flare: 0.05, out: 0.012, thick: 0.016, seg: 26 });
    squareBuckle(ctx, proj, beltY, C.buckle, { w: 0.06, h: 0.05, mat: 'metal_dark' });
  }
  hs.attach(ctx, dwarfHairMaterial('dwarf3', { color: C.beard, spec: 0.7, alpha: 0.3 }));
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
    jaw: 1.2, jawLength: 0.95, chin: 0.9, brow: 1.6, cheekbones: 1.2,
    nose: { length: 1.15, width: 1.45, bridge: 1.1, hook: 0.2, tip: 1.35 },
    lips: { width: 1.0, fullness: 0.85 }, ears: 'round', earSize: 1.0, eyeSize: 0.95, eyeOpen: 0.68, eyeSpacing: 0.97, eyeTilt: -0.03, foreheadSlope: 0.1, asym: 0.15,
  },
  skin: { color: PAL.common.skin, color2: PAL.common.skin2, blotch: 0.45, blemish: 0.2, scars: 1, wrinkles: 0.55, lips: PAL.common.lips, surface: 'skin_weathered', scatter: 0x9a4030 },
  eyes: { color: PAL.common.eyes, sclera: PAL.common.sclera },
  // chain bones only: the visible hair and beard are grown per seed bucket in extras (see dwarf_hair.ts)
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
  detail: { res: devNum('res', 0.058), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.3 },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: dwarfExtras,
};
