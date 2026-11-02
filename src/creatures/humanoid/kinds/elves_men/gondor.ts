/**
 * Men of Gondor. Seed bucket 0 is the CAPTAIN (Boromir): bare-headed, shoulder-length brown hair,
 * a full beard, a blue-grey embroidered wool tunic (tree in bronze thread) over mail, a fur mantle,
 * a long dark cloak, a double belt with a medallion, the Horn of Gondor on the right hip and a sword
 * in its scabbard on the left, no helmet whatever the helmet flag says. Buckets 1-3 are soldiers: mail
 * under a black tabard bearing the white tree and silver trim, the tall winged Minas Tirith helm
 * (helmet flag), a black cloak, leather gloves, and varied hair, beards, scars and armour. Shield
 * and spear/sword are the kit's (`weapons.style: 'gondor'`). Armour level adds pauldrons (0.5),
 * greaves (0.5) and vambraces (0.75); those armour levels apply to the soldiers only, the captain's kit is fixed. Refined against docs/refs/boromir and docs/refs/gondor.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import { anatomyParts, emitParts } from '../../anatomy';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, withHair } from './common';
import { addSkirt } from './cloth';
import { paintScar, placketLine, sheathed } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptPouch, sculptStrap, sculptTorso } from './garments';
import { POLISHED, limbGuards, pauldrons } from './armor';
import { gondorHelm } from './headgear';
import { put } from './geo';
import { addFlaredCloak, furMantle, helmWings, hornOfGondor, matteHair, medallion, tallBoots, treeEmblem } from './gondor_parts';

const BLACK = 0x242326; // surcoat/tabard: sheet #292929 design, observed #19191a (it renders darker than it looks)
const SILVER = 0xb2b4ba;

// sRGB design colours from docs/refs/boromir and docs/refs/gondor spec.json, corrected against the
// turnarounds' lit samples (observed.samples) for the lab / AgX render
const PAL = {
  skin: 0xb98a6a, // sheet #bf9379 / #c39b82: a deeper, warmer albedo (pale hex renders pink-clay)
  skin2: 0xa57654,
  lips: 0xa06458,
  brows: 0x3e2c1d,
  eyes: 0x6e5240, // Boromir's hazel #765640 (the soldiers' #5d8bb5 would need a per-bucket eye)
  trousers: 0x3b342e, // Boromir #413a32, soldiers' #292929: dark brown-grey wool
  boots: 0x3b2b22, // soldiers: dark brown leather (#574735 design, observed #463b36)
  bootsTrim: 0x2a1e17,
  captainBoots: 0x4a3426, // Boromir: tall brown leather (#614d37, observed #4d3e37; it renders lighter than the albedo)
  captainCuff: 0x6a4d36,
  captainToe: 0x2f2119,
  belt: 0x4c3828, // #614d37 / #574735 (observed #4b3833)
  gloves: 0x4a3a2e, // soldiers' leather gauntlets (observed #483d3b)
  mail: 0x58585d, // Boromir's mail sleeves (observed #61534d)
  mailSoldier: 0x8a8d92, // soldiers' mail sleeves, silver-grey (observed #4f4b4a in shade)
  mailSkirt: 0x5e6064, // the chain skirt below the tabard
  pewter: 0x7d7f84, // worn pewter plate (design #969c9d; it renders brighter than the albedo)
  tunic: 0x23252b, // Boromir: blue-grey wool #474f64, observed #383537 (it renders much lighter than the albedo)
  tunicTrim: 0xa08660, // bronze embroidery
  cloak: 0x2b2c31, // #383837, observed #413731: opaque dark twill (about 25 % lighter and less blue than pass 4)
  cloakTrim: 0x6f5a3e, // 3 cm bronze hem trim
  fur: 0x4f3c2a, // coarse fur: brown base with pale tips (#786451, observed #5e4639)
  fur2: 0xb59a74, // fur tips (cream-tan)
  fur3: 0x3a2a1c, // dark fur undercoat
  bracers: 0x5a4332, // engraved brown leather #614d37, observed #554744
  bronze: 0x8a7550,
  ivory: 0xd9ceb4,
  silver: 0xb6b4ae,
  scabbard: 0x3f2c20,
};

const WOOL_TUNIC = surface('twill', { rough: 0.88, sheen: 0.3 });
const WOOL_BLACK = surface('twill', { rough: 0.9, sheen: 0.35, pat: { weave: -0.7 } });
const CLOAK_WOOL = surface('twill', { rough: 0.95, sheen: 0.1 });
/** worn pewter plate (greaves, pauldrons, helm): darker than polished steel, with scratches */
const PEWTER = surface('metal', { rough: 0.5, metal: 0.7, pat: { scratches: 1.3, pores: 0.3 } });
/** belt height above the kit default (sheet: Boromir ~1.17 m, soldiers ~1.2 m) */
const BELT_UP = 0.15;
const LEATHER = surface('leather_worn', { rough: 0.66, sheen: 0.1 });
const TOOLED = surface('leather_tooled', { rough: 0.6, sheen: 0.1 });

interface GonLook {
  hair: HairDef;
  beard?: { color: number; color2?: number; thick: number; cheeks: number; chin?: number; mustache?: boolean; stubble?: boolean };
}

function gondorExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const b = ctxBucket(ctx);
  const captain = b === 0;
  const cy = j.chest[1];
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const beltY = hipY + (0.07 + BELT_UP) * sc;
  const mailMat = surface('mail', { rough: 0.45, pat: { scales: 1.5, scratches: 0.5 } });
  const looks: GonLook[] = [
    { hair: { style: 'shoulder', color: 0x4a3220, tipColor: 0x4e3523, length: 0.95, density: 0.85 }, beard: { color: 0x45301f, color2: 0x5a4a3c, thick: 0.058, cheeks: 0.6, chin: 0.02, mustache: true } },
    { hair: { style: 'short', color: 0x3e2c1d, length: 1, density: 0.7 } },
    { hair: { style: 'short', color: 0x20170f, length: 1, density: 0.7 }, beard: { color: 0x1d150f, thick: 0.035, cheeks: 0.3, mustache: true } },
    { hair: { style: 'short', color: 0x8b8880, length: 0.9, density: 0.7 }, beard: { color: 0x96938b, thick: 0.03, cheeks: 0, mustache: true } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet && !captain;

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: 0.3, mustache: L.beard.mustache !== false, cheeks: 0.7 });
    sculptBeard(ctx, { color: L.beard.color, color2: L.beard.color2, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.12, 0.0], to: [0.19, -0.27] });

  // ── hair ──
  if (captain) matteHair(L.hair.color);
  withHair(ctx, () => {
    if (!helmed) addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('gondor', 'hair', b)), lod: captain ? 0 : 1, backClear: captain ? 1.35 : 1.0, cap: true });
  });

  // ── mail ──
  sculptTorso(ctx, { color: captain ? PAL.mail : PAL.mailSoldier, mat: mailMat, inflate: 0.0115 * sc, hem: 0.45, sleeve: captain ? 1.4 : 1.6, neck: true, neckTop: captain ? 0.06 * sc : undefined, seams: false });
  if (!captain) addSkirt(ctx, { color: PAL.mailSkirt, mat: mailMat, length: 0.55, ragged: 0.004 * sc });

  if (captain) {
    // the blue-grey embroidered tunic: short sleeves over the mail, falling to above the knee, bronze trim
    sculptTorso(ctx, { color: PAL.tunic, mat: WOOL_TUNIC, inflate: 0.0185 * sc, hem: 0.08, sleeve: 0.5, neck: false, shoulders: true, seams: true });
    addSkirt(ctx, { color: PAL.tunic, color2: PAL.tunicTrim, mat: WOOL_TUNIC, length: 0.68, flare: 0.03 * sc, ragged: 0.004 * sc, panels: [[-0.75, -0.1], [0.1, 0.75], [0.9, 2.3], [2.45, 3.83], [3.98, 5.4]] });
    // bronze embroidery: the tree on the chest and a band down the front
    treeEmblem(ctx, { cy: cy - 0.03 * sc, h: 0.3 * sc, color: PAL.tunicTrim, inflate: 0.0215 * sc, mat: surface('cloth', { rough: 0.55, sheen: 0.7 }), thin: 0.55, roots: true });
    placketLine(ctx, { y0: beltY + 0.03 * sc, y1: cy - 0.09 * sc, inflate: 0.0185 * sc, color: PAL.tunicTrim, x: 0, width: 0.0028 * sc });
    furMantle(ctx, { color: PAL.fur, tip: PAL.fur2, dark: PAL.fur3, thick: 0.03, drop: 0.07 });
    // a round bronze clasp closing the throat
    medallion(ctx, { y: ny - 0.025 * sc, z: 0.095 * sc * P.build.chest + 0.055 * sc, r: 0.016 * sc, color: PAL.bronze, mat: 'gold', bone: 'chest' });
    // a long dark cloak, wide at the hem, with a bronze-trimmed border
    addFlaredCloak(ctx, { color: PAL.cloak, color2: PAL.cloakTrim, mat: CLOAK_WOOL, length: 0.78, flareX: 0.8, flareZ: 1.05, ragged: 0.02 * sc, mantle: false });
    // the baldric from the left shoulder to the right hip, the Horn of Gondor hanging on it
    sculptStrap(ctx, { color: PAL.belt, mat: LEATHER, width: 0.034 * sc, inflate: 0.026 * sc, sign: -1 });
    hornOfGondor(ctx, { side: -1, mouthY: beltY - 0.02 * sc, ivory: PAL.ivory, silver: PAL.silver, bronze: PAL.bronze, leather: PAL.belt, metalMat: POLISHED, leatherMat: LEATHER });
    // the sword in its scabbard on the left hip
    sheathed(ctx, { kind: 'sword', hand: 'hand_r', pos: [P.hipX + 0.14 * sc, beltY - 0.04 * sc, -0.01 * sc], dir: [0.07, -0.93, -0.3], len: 0.82, r: 0.027 * sc, color: PAL.scabbard, trim: PAL.bronze, mat: TOOLED, seed: 3, weaponStart: 0.09 });
    // round bronze belt medallion
    medallion(ctx, { y: beltY, z: 0.108 * sc * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * sc, r: 0.02 * sc, color: PAL.bronze, mat: 'gold' });
    sculptPouch(ctx, { x: -0.13 * sc, z: -0.1 * sc, size: 0.8, color: 0x2a1e14, drop: 0.05 });
    tallBoots(ctx, { color: PAL.captainBoots, color2: 0x5a4030, cuff: PAL.captainCuff, strap: PAL.bootsTrim, buckle: PAL.bronze, toe: PAL.captainToe, top: 1.0, calf: 0.15, mat: LEATHER, metalMat: 'gold' });
    // engraved brown leather bracers over the mail
    limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: PAL.bronze, mat: TOOLED, trimMat: 'gold', length: 0.5 });
  } else {
    // black tabard with silver trim and the white tree; mail shows in the slit below
    sculptTorso(ctx, { color: BLACK, mat: WOOL_BLACK, inflate: 0.0195 * sc, hem: 0.3, sleeve: 0, neck: false, shoulders: false, seams: true, color2: 0x2c2b30, colorNoise: 0.2 });
    addSkirt(ctx, { color: BLACK, color2: SILVER, mat: WOOL_BLACK, length: 0.58, flare: 0.05 * sc, panels: [[-3.0, -0.25], [0.25, 3.0]] });
    treeEmblem(ctx, { cy: beltY + 0.235 * sc, h: 0.44 * sc, color: 0xd6d6d0, inflate: 0.03 * sc, mat: surface('cloth', { rough: 0.5, sheen: 0.9 }), thin: 1.1 });
    // silver edge trim down both sides of the tabard front
    for (const x of [-0.115 * sc, 0.115 * sc]) placketLine(ctx, { y0: beltY + 0.02 * sc, y1: cy + 0.11 * sc, inflate: 0.0165 * sc, color: SILVER, x, width: 0.0034 * sc, mat: PEWTER });
    sculptPouch(ctx, { x: 0.13 * sc, z: 0.06 * sc, size: 0.85, color: 0x2a1e14, drop: 0.05 });
    // black cloak with the shoulder mantle
    addFlaredCloak(ctx, { color: BLACK, color2: 0x33312f, mat: CLOAK_WOOL, length: 0.6, flareX: 0.42, flareZ: 0.4, ragged: 0.02 * sc, hood: true, foldAmp: 0.032 });
    // leather gauntlets
    leatherGauntlets(ctx);
    if (A >= 0.5) pauldrons(ctx, { color: PAL.pewter, trim: 0x9a9ca2, mat: PEWTER, trimMat: PEWTER, lames: 3, size: 0.95, cap: true });
    if (A >= 0.5) {
      limbGuards(ctx, { kind: 'greave', color: PAL.pewter, trim: 0x9a9ca2, mat: PEWTER, trimMat: PEWTER, length: 1.12 });
      kneeCops(ctx);
    }
    if (A >= 0.5) {
      limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: 0x9a9ca2, mat: TOOLED, trimMat: PEWTER, length: 0.55 });
      elbowCouters(ctx);
    }
    if (helmed) {
      gondorHelm(ctx, { color: 0x8a8c92, trim: 0xa4a6ac, mat: PEWTER, trimMat: PEWTER, wing: 0.02 });
      helmWings(ctx, { root: 0x5c5e63, tip: 0xb4b7bd, mat: PEWTER });
    }
  }
}

/** pewter elbow couters: flattened domes over the elbows, on the vambraces' upper edge */
function elbowCouters(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  for (const sd of ['l', 'r'] as const) {
    const e = P.j[`forearm_${sd}`];
    const geo = new THREE.SphereGeometry(1, 6, 4).scale(0.05 * sc, 0.046 * sc, 0.05 * sc).translate(e[0], e[1] + 0.004 * sc, e[2] - 0.012 * sc);
    put(ctx, geo, { bone: `forearm_${sd}`, color: PAL.pewter, mat: PEWTER, small: true });
  }
}

/** pewter knee cops: flattened domes over the knees (the greaves end under them) */
function kneeCops(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  for (const sd of ['l', 'r'] as const) {
    const k = P.j[`shin_${sd}`];
    const geo = new THREE.SphereGeometry(1, 7, 4).scale(0.062 * sc * g, 0.05 * sc, 0.036 * sc).translate(k[0], k[1] + 0.036 * sc, k[2] + 0.052 * sc * g);
    put(ctx, geo, { bone: `shin_${sd}`, color: PAL.pewter, mat: PEWTER, small: true });
  }
}

/** leather gauntlets: the hands re-emitted slightly inflated */
function leatherGauntlets(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.0035 * sc, () => {
    emitParts(s, parts, ['hand', 'fingers', 'thumb'], { color: PAL.gloves, mat: LEATHER, inflate: 0.0035 * sc });
  });
}

export const gondorDef: KindDef = {
  label: 'Soldier of Gondor',
  height: 1.83,
  build: { shoulders: 1.03, bulk: 1.02, chest: 1.02, neckThick: 1.08, muscle: 0.5, footSize: 1.08 },
  face: { jaw: 1.04, chin: 1.0, brow: 1.06, cheekbones: 1.03, nose: { length: 1.03, width: 0.97, bridge: 1.05 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.93, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.25, blemish: 0.12, wrinkles: 0.2, lips: PAL.lips, brows: PAL.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PAL.eyes, sclera: 0xe6e0d4 },
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.trousers },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 0.92, mat: TOOLED },
    { type: 'belt', color: PAL.belt, offset: BELT_UP, mat: LEATHER },
    // spring bones only: hem panels and the cloaks are built in extras
    { type: 'skirt', color: BLACK, chance: 0 },
    { type: 'cloak', color: PAL.cloak, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'shield', style: 'gondor' },
  sfx: { voice: 'man', weight: 0.55 },
  anim: { swagger: 0.15, aggression: 0.4, stance: 1.03 },
  variation: { height: 0.035, bulk: 0.07, skin: 0.08 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  // the captain (bucket 0, Boromir) is a named hero: a fine face region within the 45k budget; the soldiers keep the crowd cost
  bucketDetail: { 0: { detailScale: 1, res: devNum('bres', 0.05), headRes: devNum('bheadRes', 0.0085), faceRes: devNum('bfaceRes', 0.0056), refine: 1, hands: false } },
  extras: gondorExtras,
};
