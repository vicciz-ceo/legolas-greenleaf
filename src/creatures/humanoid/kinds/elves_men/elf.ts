/**
 * Elven warriors, four looks across the seed buckets (refined against docs/refs/elf_mirkwood and
 * docs/refs/elf_galadhrim, the same pass as Legolas):
 *   0  Mirkwood guard  deep-green wool tunic with gold line work, gold-bronze leaf armour with a
 *                      skirt of long leaf plates, wide green cloak, tooled brown boots and bracers,
 *                      dark wavy hair, glaive (right hand) or bow
 *   1  Galadhrim       fluted gold armour and leaf plates over a dark olive tunic, deep red velvet
 *                      cloak with gold leaf work, blond hair with temple braids, longbow
 *   2  Mirkwood guard  the amber-brown variant: auburn hair, darker bronze, amber cloak with green trim
 *   3  Galadhrim       the dark-haired variant: slate tunic, black hair, deep red cloak
 * Armour level (spec.armor) adds the cuirass and leaf-plate skirt (0.5) and pauldrons (0.75); the
 * leather bracers are worn at every level; the helmet flag shows the helm (a leaf circlet stands in
 * for it on the Mirkwood guard).
 *
 * Landmarks from the calibrated sheets: belt 1.16 m, cuirass point just above it, leaf plates down to
 * ~0.72 m, tunic hem ~0.7 m, boot tops 0.5 m, cloak hem 0.15 m above the ground.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { mergeKitGeometries } from '../../../kit/geometry';
import { createHairMaterial } from '../../../kit/hair';
import { surface } from '../../../kit/surfaces';
import { skirtGeometry } from '../../cloth';
import { quiverGear, type QuiverOpts } from '../../gear';
import type { KindContext, KindDef } from '../../types';
import { devNum, ctxBucket, attachSkinned, mix } from './common';
import { SKIRT_PANELS } from './cloth';
import { leafBuckle } from './armor';
import { elfCrest, elfCuirass, elfPauldrons } from './elf_armor';
import { elfCloak, leafTassets, type TassetLeaf } from './elf_cloth';
import { elvenHelm, leafCirclet } from './headgear';
import { noKitHair } from './hair';
import { buildHair, sculptHairCap } from '../../hairstyles';
import { sculptTorso } from './garments';
import { addGlaiveHead } from './glaive';

/** stitched leather tooled with leaf work (boots, bracers, belt) */
const TOOLED = surface('leather_tooled', { rough: 0.62, sheen: 0.1 });
/** fitted wool (trousers) */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.25, pat: { weave: -0.6 } });
/** dense wool twill (tunic): sheen tinted by the albedo, so the green stays deep instead of minty */
const TWILL = surface('twill', { rough: 0.85, sheen: 0.4 });
/** heavy wool cloak */
const CLOAK_WOOL = surface('wool', { rough: 0.95, sheen: 0, pat: { weave: 1, fur: 0.5 } });
/** crushed red velvet (Galadhrim cloak) */
const VELVET = surface('wool', { rough: 0.9, sheen: 0.35, pat: { fur: 0.25 } });
/** antique bronze (Mirkwood) and gold (Galadhrim) leaf plate: shallow dents, a little less metal so the
 *  sky reflection does not turn it into yellow chrome */
const ELF_BRONZE = surface('gold', { rough: 0.5, metal: 0.82, pat: { scales: -0.35, scratches: 0.6 } });
/** the dark vein grooves of the cuirass */
const VEIN = surface('gold', { rough: 0.62, metal: 0.45, pat: { scratches: 0.3 } });
const ELF_GOLD = surface('gold', { rough: 0.46, metal: 0.82, pat: { scales: -0.3, scratches: 0.5 } });

/** belt raised from the hips to the natural waist (sheets: belt ≈ 1.16 m on a 1.85 m figure) */
const BELT_RAISE = 0.13;

interface ElfLook {
  galadhrim: boolean;
  tunic: number;
  tunicTrim: number;
  metal: number;
  trim: number;
  /** vein groove colour of the cuirass */
  vein: number;
  cloak: number;
  cloakTrim: number;
  /** colour in the cloak's pleat troughs (the lining) */
  cloakFold: number;
  /** gold embroidery on the cloak (Galadhrim) */
  cloakGold?: number;
  hair: number;
  hairTip: number;
  braids: boolean;
  hairLen: number;
}

// Colours: sRGB design values from the spec.json outfit_layers / armor / hair, cross-checked against
// the lit `observed.samples` and the turnarounds. Greens are desaturated and darkened (they render
// mint under the lab's sky light), the sheen follows the albedo.
const LOOKS: ElfLook[] = [
  // Mirkwood: tunic #4c6137 (lit #534e3f incl. gold), cloak #4c6137 (lit #303427: dark grey-green felted wool), metal #a07e39, hair #493728 (lit #2c1f18)
  { galadhrim: false, tunic: 0x2d3b22, tunicTrim: 0x8c7236, metal: 0x8a6a32, trim: 0x7d6530, vein: 0x4a3818, cloak: 0x25362b, cloakTrim: 0x273829, cloakFold: 0x18241b, hair: 0x3a2b1f, hairTip: 0x4a3828, braids: false, hairLen: 1.35 },
  // Galadhrim: tunic dark olive #424832 (lit #322416), cloak deep red #74242c (lit #531216), metal #ae8c4b, hair #c7b18a (lit #c5945b)
  { galadhrim: true, tunic: 0x3d4130, tunicTrim: 0xa88a48, metal: 0xb4893a, trim: 0x9a8040, vein: 0x6a4a1c, cloak: 0x5a1019, cloakTrim: 0x4a0c14, cloakFold: 0x3c0910, cloakGold: 0xb89448, hair: 0xb98a44, hairTip: 0xd2a65c, braids: true, hairLen: 1.35 },
  // Mirkwood variant: amber-brown tunic with green trim, auburn hair
  { galadhrim: false, tunic: 0x58401f, tunicTrim: 0x7a8a3c, metal: 0x7d5f2c, trim: 0x7d6530, vein: 0x45321a, cloak: 0x6a4a1f, cloakTrim: 0x35452a, cloakFold: 0x3e2a12, hair: 0x6b3419, hairTip: 0x844626, braids: false, hairLen: 1.3 },
  // Galadhrim variant: slate tunic, black hair
  { galadhrim: true, tunic: 0x3a4650, tunicTrim: 0xa09060, metal: 0xb4893a, trim: 0x9a8040, vein: 0x6a4a1c, cloak: 0x540f18, cloakTrim: 0x44090f, cloakFold: 0x38080e, cloakGold: 0xb89448, hair: 0x1d1814, hairTip: 0x2c241d, braids: true, hairLen: 1.35 },
];

const hairMats = new Map<number, THREE.MeshPhysicalMaterial>();
/** hair material: dark hair gets a brown (not white-blue) strand highlight, little sheen and spec */
function elfHairMaterial(color: number): THREE.MeshPhysicalMaterial {
  let m = hairMats.get(color);
  if (!m) {
    const dark = ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255) < 330;
    m = createHairMaterial({ roughness: dark ? 0.78 : 0.62, anisotropy: dark ? 0.3 : 0.6, sheen: dark ? 0.04 : 0.2, sheenColor: color, highlight: dark ? mix(color, 0x806040, 0.45) : 0xf0dcb0 });
    m.specularIntensity = dark ? 0.08 : 0.2;
    m.userData.shared = true;
    hairMats.set(color, m);
  }
  return m;
}

const PALETTE = {
  skin: 0xd8ae92, // sheet #e0baa0 / #e2c3a9, a little warmer and deeper (a pale albedo renders as clay)
  skin2: 0xb98466,
  lips: 0xb9796c,
  brows: 0x5b4330,
  eyes: 0x6188a8, // sheet iris #5d8bb5, a touch greyer
  boots: 0x4a3522, // sheet leather #62462e / #584231
  bootsTrim: 0x3b2a1b,
  bracers: 0x57402a,
  bracersTrim: 0x3a2a1c,
  belt: 0x4c3524,
  leggings: 0x2c2b24, // sheet trousers #383d30 / #424832
  quiver: 0x6a4a2c,
  quiverTrim: 0x8c6a3c,
  fletch: 0xece8de,
  shaft: 0xb9a37b,
  buckle: 0xd2ad58,
};

function elfExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const bucket = ctxBucket(ctx);
  const L = LOOKS[bucket];
  const hipY = j.thigh_l[1];
  const cy = j.chest[1];
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;

  // ── hair: long (Mirkwood loose, Galadhrim with temple braids meeting at the back), lying over the cloak ──
  {
    const hair = { style: 'long_straight' as const, color: L.hair, tipColor: L.hairTip, length: L.hairLen, density: devNum('density', L.galadhrim ? 0.41 : 0.44), braids: (L.braids ? 'temple' : 'none') as 'temple' | 'none' };
    sculptHairCap(ctx.sculpt, P, hair, false);
    const Pm = { ...P, build: { ...P.build, chest: P.build.chest * (L.galadhrim ? 1.9 : 1.8) } } as typeof P;
    const geo = buildHair(Pm, ctx.rig, hair, null, new Rng(hashSeed('elf', 'hair', bucket)), 1, false).geo;
    if (geo) attachSkinned(ctx, geo, elfHairMaterial(L.hair), { name: 'hair2' });
  }

  // ── tunic: long sleeves, high stand collar, hem to mid thigh ──
  sculptTorso(ctx, { color: L.tunic, mat: TWILL, inflate: 0.0066 * sc, hem: 0.5, sleeve: 2, neck: true, neckTop: 0.036 * sc, seams: true, color2: L.tunicTrim, colorNoise: 0.12 });

  // ── cloth sheets, one skinned mesh: tunic skirt panels, the cloak, the leaf-plate skirt ──
  const skirtTop = hipY + 0.035 * sc;
  const skirtBottom = hipY - (hipY - j.shin_l[1]) * 0.58 * 1.05;
  const cloth: THREE.BufferGeometry[] = [];
  // tunic skirt: a longer centre-front panel, side panels 8 cm higher, the back a little shorter
  SKIRT_PANELS.forEach((pn, i) => {
    const bottom = skirtBottom + [-0.04, 0.08, 0.02, 0.08][i] * sc;
    cloth.push(skirtGeometry(P, ctx.rig, { top: skirtTop, bottom, color: L.tunic, color2: L.tunicTrim, mat: TWILL, panels: [pn], flare: 0.035 * sc, seed: bucket + i }));
  });
  cloth.push(
    elfCloak(P, ctx.rig, {
      color: L.cloak,
      trim: L.cloakTrim,
      fold: L.cloakFold,
      mat: L.galadhrim ? VELVET : CLOAK_WOOL,
      hem: L.galadhrim ? 0.12 : 0.14,
      pleats: L.galadhrim ? 7 : 9,
      pleatDepth: 0.035,
      aoFloor: L.galadhrim ? 0.7 : 0.62,
      tweed: L.galadhrim ? 0.04 : 0.1,
      vine: L.cloakGold,
      seed: bucket,
    }),
  );
  if (A >= 0.5) {
    // long leaf plates from the belt over the hips: a gap at the centre front (tunic shows), none at the back
    const plates: TassetLeaf[] = [];
    const sides = [1, -1];
    const spec: [number, number, number][] = [
      [0.5, 0.4, 0.088],
      [0.88, 0.42, 0.092],
      [1.26, 0.36, 0.088],
      [1.62, 0.3, 0.08],
      [1.98, 0.24, 0.07],
    ];
    for (const sd of sides) spec.forEach(([a, len, w], i) => plates.push({ a: a * sd, len: len * sc, w: w * sc, off: (i % 2) * 0.007 * sc, tone: i % 2 ? 0.94 : 1 }));
    // a shorter staggered row hanging from higher up, over the gaps
    for (const sd of sides) for (const [a, len, w] of [[0.69, 0.15, 0.08], [1.07, 0.15, 0.08], [1.44, 0.13, 0.075]]) plates.push({ a: a * sd, len: len * sc, w: w * sc, top: beltY - 0.005 * sc, off: 0.012 * sc, tone: 1.06 });
    cloth.push(leafTassets(P, ctx.rig, { top: beltY - 0.012 * sc, skirtBottom, color: L.metal, color2: L.trim, mat: L.galadhrim ? ELF_GOLD : ELF_BRONZE, leaves: plates, seed: bucket }));
  }
  const merged = mergeKitGeometries(cloth);
  for (const g of cloth) g.dispose();
  attachSkinned(ctx, merged, 'body', { small: false, name: 'cloth' });

  // ── armour by level ──
  const metalMat = L.galadhrim ? ELF_GOLD : ELF_BRONZE;
  if (A >= 0.5) {
    elfCuirass(ctx, { color: L.metal, trim: L.trim, mat: metalMat, veinColor: L.vein, veinMat: VEIN, beltY, bottom: L.galadhrim ? 0.0 : 0.045, fluted: L.galadhrim, chevron: !L.galadhrim });
    leafBuckle(ctx, { y: beltY, color: L.trim, mat: metalMat });
  }
  if (A >= 0.75) elfPauldrons(ctx, { color: L.metal, mat: metalMat });

  // ── head: the Mirkwood helm with a tall crest of stacked leaf blades; the Galadhrim go bare-headed ──
  if (!L.galadhrim) {
    if (ctx.helmet) {
      elvenHelm(ctx, { color: L.metal, trim: L.trim, mat: ELF_BRONZE, trimMat: 'gold', crest: 0.01, wings: false });
      elfCrest(ctx, { color: L.metal, mat: ELF_BRONZE });
    } else leafCirclet(ctx, { color: L.trim });
  }

  // ── the Mirkwood guard's glaive: a curved leaf blade over the spear head (only while a spear is held) ──
  if (!L.galadhrim) addGlaiveHead(ctx, { blade: 0xc9c5b2, trim: L.trim });

  // ── quiver on the right back, mouth over the shoulder blade (Galadhrim only: the Mirkwood sheet has none) ──
  if (!L.galadhrim) return;
  const q: QuiverOpts = {
    center: [-0.085 * sc, cy + 0.075 * sc, -0.2 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.28, 1, -0.04).normalize(),
    length: 0.48 * sc,
    radius: 0.034 * sc,
    color: PALETTE.quiver,
    trim: PALETTE.quiverTrim,
    mat: TOOLED,
    arrows: 6,
    fletch: PALETTE.fletch,
    shaft: PALETTE.shaft,
    bone: 'quiver',
    knives: null,
    seed: 3 + bucket,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);
}

export const elfDef: KindDef = {
  label: 'Elf warrior',
  height: 1.86,
  build: { shoulders: 0.98, hips: 0.95, bulk: 0.9, chest: 0.95, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.05, neckThick: 0.9, muscle: 0.4, handSize: 0.97, footSize: 0.97 },
  face: {
    jaw: 0.9,
    chin: 0.95,
    jawLength: 0.95,
    brow: 0.85,
    cheekbones: 1.12,
    nose: { length: 0.8, width: 0.84, bridge: 1.05, tip: 0.85 },
    lips: { width: 0.9, fullness: 0.8 },
    ears: 'pointed',
    eyeSize: 1.08,
    eyeTilt: 0.1,
    eyeOpen: 1.0,
    foreheadSlope: 0.08,
  },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.04, blemish: 0.01, wrinkles: 0, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xc87866, surface: 'skin' },
  eyes: { color: PALETTE.eyes, sclera: 0xeee9e0 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  palette: { buckle: PALETTE.buckle },
  outfit: [
    { type: 'leggings', color: PALETTE.leggings, mat: WOOL },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.95, mat: TOOLED },
    // stiff tooled bracers from the wrist almost to the elbow (sheets: leather at every armour level)
    { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.bracersTrim, length: 0.88, thickness: 0.003, mat: TOOLED },
    { type: 'belt', color: PALETTE.belt, offset: BELT_RAISE, mat: TOOLED },
    // spring bones only: the hem panels and the cloak are built per bucket in extras
    { type: 'skirt', color: 0x4a5a34, chance: 0 },
    { type: 'cloak', color: 0x36482b, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'none', left: 'elven_bow' },
  sfx: { voice: 'elf', weight: 0.4 },
  anim: { grace: 0.9, aggression: 0.3, stance: 0.97, armSwing: 0.9 },
  variation: { height: 0.025, bulk: 0.05, skin: 0.05 },
  detail: { detailScale: 1, res: devNum('res', 0.068), headRes: devNum('headRes', 0.016), faceRes: 0 },
  extras: elfExtras,
};
