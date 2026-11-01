/**
 * Men of Gondor. Seed bucket 0 is the CAPTAIN (Boromir): bare-headed, shoulder-length brown hair,
 * a full beard, a blue-grey embroidered wool tunic (tree in bronze thread) over mail, a fur mantle,
 * a long dark cloak, a double belt with a medallion, the Horn of Gondor on the right hip and a sword
 * in its scabbard on the left, no helmet whatever the helmet flag says. Buckets 1-3 are soldiers: mail
 * under a black tabard bearing the white tree and silver trim, the tall winged Minas Tirith helm
 * (helmet flag), a black cloak, leather gloves, and varied hair, beards, scars and armour. Shield
 * and spear/sword are the kit's (`weapons.style: 'gondor'`). Armour level adds pauldrons (0.5),
 * greaves (0.5) and vambraces (0.75). Refined against docs/refs/boromir and docs/refs/gondor.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import { anatomyParts, emitParts } from '../../anatomy';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, withHair } from './common';
import { addSkirt } from './cloth';
import { emblemGeometry, paintScar, placketLine, sheathed, type EmblemStroke } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptFurCollar, sculptPouch, sculptStrap, sculptTorso } from './garments';
import { POLISHED, STEEL, limbGuards, pauldrons } from './armor';
import { gondorHelm } from './headgear';
import { put } from './geo';
import { addFlaredCloak, helmWings, hornOfGondor, medallion } from './gondor_parts';

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
  trousers: 0x302b27, // Boromir #413a32, soldiers' #292929: dark brown-grey wool
  boots: 0x5a4430, // tall brown leather (#614d37 / #574735, observed #4d3e37)
  bootsTrim: 0x3a2b1e,
  belt: 0x4c3828, // #614d37 / #574735 (observed #4b3833)
  gloves: 0x4a3a2e, // soldiers' leather gauntlets (observed #483d3b)
  mail: 0x58585d, // dark aged mail (observed #61534d / #4f4b4a), not the bright silver it first read as
  tunic: 0x23252b, // Boromir: blue-grey wool #474f64, observed #383537 (it renders much lighter than the albedo)
  tunicTrim: 0x84704a, // bronze embroidery
  cloak: 0x2a2a2c, // #383837, observed #413731
  cloakTrim: 0x3d3a34,
  fur: 0x5d4936, // coarse brown fur #786451, observed #5e4639
  fur2: 0x3e3025,
  bracers: 0x5a4332, // engraved brown leather #614d37, observed #554744
  bronze: 0x8a7550,
  ivory: 0xd9ceb4,
  silver: 0xb6b4ae,
  scabbard: 0x3f2c20,
};

const WOOL_TUNIC = surface('twill', { rough: 0.88, sheen: 0.3 });
const WOOL_BLACK = surface('twill', { rough: 0.9, sheen: 0.35, pat: { weave: -0.7 } });
const CLOAK_WOOL = surface('wool', { rough: 0.92 });
const LEATHER = surface('leather_worn', { rough: 0.66, sheen: 0.1 });
const TOOLED = surface('leather_tooled', { rough: 0.6, sheen: 0.1 });

/** the White Tree of Gondor as ribbon strokes (emblem space: x right, y up, ~1 wide, 1.5 tall) */
function treeStrokes(wf = 1): EmblemStroke[] {
  const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [-x, y]);
  const br = (pts: [number, number][], w: number, w1: number): EmblemStroke[] => [
    { pts, w: w * wf, w1: w1 * wf },
    { pts: mirror(pts), w: w * wf, w1: w1 * wf },
  ];
  return [
    { pts: [[0, -0.72], [0.0, -0.4], [0.0, -0.05]], w: 0.14 * Math.min(wf, 1.2), w1: 0.075 * Math.min(wf, 1.2) },
    ...br([[0, -0.74], [-0.14, -0.66]], 0.07, 0.04),
    ...br([[0, -0.2], [-0.12, -0.02], [-0.3, 0.1], [-0.46, 0.12]], 0.07, 0.032),
    ...br([[-0.12, -0.02], [-0.14, 0.2], [-0.26, 0.34]], 0.05, 0.026),
    ...br([[-0.02, 0.02], [-0.06, 0.24], [-0.12, 0.4]], 0.045, 0.024),
    { pts: [[0, -0.05], [0, 0.3], [0, 0.46]], w: 0.06 * wf, w1: 0.03 * wf },
    // the crown above the tree
    { pts: [[-0.2, 0.62], [0.2, 0.62]], w: 0.06 },
    ...br([[0.02, 0.64], [0.1, 0.8]], 0.04, 0.02),
    ...br([[0.18, 0.64], [0.24, 0.76]], 0.035, 0.02),
    { pts: [[0, 0.64], [0, 0.84]], w: 0.045, w1: 0.02 },
  ];
}

interface GonLook {
  hair: HairDef;
  beard?: { color: number; thick: number; cheeks: number; chin?: number; mustache?: boolean; stubble?: boolean };
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
  const beltY = hipY + 0.07 * sc;
  const mailMat = surface('mail', { rough: 0.58, pat: { scales: 1.5, scratches: 0.5 } });
  const dn = devNum('density', 0.6);
  const looks: GonLook[] = [
    { hair: { style: 'shoulder', color: 0x3a281c, tipColor: 0x48331f, length: 1.05, density: dn }, beard: { color: 0x3b2a1c, thick: 0.05, cheeks: 0.5, chin: 0.015 } },
    { hair: { style: 'short', color: 0x3e2c1d, length: 1, density: 0.7 } },
    { hair: { style: 'short', color: 0x20170f, length: 1, density: 0.7 }, beard: { color: 0x1d150f, thick: 0.035, cheeks: 0.3, mustache: true } },
    { hair: { style: 'short', color: 0x8b8880, length: 0.9, density: 0.7 }, beard: { color: 0x96938b, thick: 0.03, cheeks: 0, mustache: true } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet && !captain;

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: captain ? 0.45 : 0.3, mustache: L.beard.mustache !== false, cheeks: 0.7 });
    sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.12, 0.0], to: [0.19, -0.27] });

  // ── hair ──
  withHair(ctx, () => {
    addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('gondor', 'hair', b)), lod: 1, backClear: captain ? 1.35 : 1.0, cap: !helmed });
  });

  // ── mail ──
  sculptTorso(ctx, { color: PAL.mail, mat: mailMat, inflate: 0.0115 * sc, hem: 0.45, sleeve: captain ? 1.4 : 1.6, neck: true, seams: false });
  if (!captain) addSkirt(ctx, { color: PAL.mail, mat: mailMat, length: 0.5, ragged: 0.004 * sc });

  if (captain) {
    // the blue-grey embroidered tunic: short sleeves over the mail, falling to above the knee, bronze trim
    sculptTorso(ctx, { color: PAL.tunic, mat: WOOL_TUNIC, inflate: 0.0185 * sc, hem: 0.08, sleeve: 0.5, neck: false, shoulders: true, seams: true, frontOpen: { top: 0.04 * sc, bottom: 0.012 * sc, y1: ny - 0.03 * sc } });
    addSkirt(ctx, { color: PAL.tunic, color2: PAL.tunicTrim, mat: WOOL_TUNIC, length: 0.68, flare: 0.03 * sc, ragged: 0.004 * sc, panels: [[-0.75, -0.1], [0.1, 0.75], [0.9, 2.3], [2.45, 3.83], [3.98, 5.4]] });
    // bronze embroidery: the tree on the chest and a band down the front
    put(ctx, emblemGeometry(ctx, treeStrokes(), { cy: cy + 0.03 * sc, scale: 0.155 * sc, inflate: 0.0205 * sc }), { bone: 'chest', color: PAL.tunicTrim, mat: surface('cloth', { rough: 0.55, sheen: 0.7 }), small: true });
    placketLine(ctx, { y0: beltY + 0.03 * sc, y1: cy - 0.09 * sc, inflate: 0.0185 * sc, color: PAL.tunicTrim, x: 0, width: 0.0028 * sc });
    sculptFurCollar(ctx, { color: PAL.fur, color2: PAL.fur2, thick: 0.03, drop: 0.07, open: 0.6 });
    // a long dark cloak, wide at the hem, with a bronze-trimmed border
    addFlaredCloak(ctx, { color: PAL.cloak, color2: PAL.cloakTrim, mat: CLOAK_WOOL, length: 0.78, flareX: 0.75, flareZ: 0.5, mantle: false });
    // the baldric from the left shoulder to the right hip, the Horn of Gondor hanging on it
    sculptStrap(ctx, { color: PAL.belt, mat: LEATHER, width: 0.034 * sc, inflate: 0.026 * sc, sign: -1 });
    hornOfGondor(ctx, { side: -1, ivory: PAL.ivory, silver: PAL.silver, bronze: PAL.bronze, leather: PAL.belt, metalMat: POLISHED, leatherMat: LEATHER });
    // the sword in its scabbard on the left hip
    sheathed(ctx, { kind: 'sword', hand: 'hand_r', pos: [P.hipX + 0.14 * sc, hipY + 0.05 * sc, -0.01 * sc], dir: [0.07, -0.93, -0.3], len: 0.9, r: 0.027 * sc, color: PAL.scabbard, trim: PAL.bronze, mat: TOOLED, seed: 3, weaponStart: 0.09 });
    // round bronze belt medallion
    medallion(ctx, { y: beltY, z: 0.108 * sc * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * sc, r: 0.02 * sc, color: PAL.bronze, mat: 'gold' });
    sculptPouch(ctx, { x: -0.13 * sc, z: -0.1 * sc, size: 0.8, color: 0x2a1e14, drop: 0.05 });
    // engraved brown leather bracers over the mail
    limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: PAL.bronze, mat: TOOLED, trimMat: 'gold', length: 0.5 });
  } else {
    // black tabard with silver trim and the white tree; mail shows in the slit below
    sculptTorso(ctx, { color: BLACK, mat: WOOL_BLACK, inflate: 0.0195 * sc, hem: 0.3, sleeve: 0, neck: false, shoulders: false, seams: true, color2: 0x2c2b30, colorNoise: 0.2 });
    addSkirt(ctx, { color: BLACK, color2: SILVER, mat: WOOL_BLACK, length: 0.58, flare: 0.05 * sc, panels: [[-3.0, -0.25], [0.25, 3.0]] });
    const g = emblemGeometry(ctx, treeStrokes(1.7), { cy: cy - 0.02 * sc, scale: 0.27 * sc, inflate: 0.0235 * sc });
    put(ctx, g, { bone: 'chest', color: 0xe6e6e0, mat: surface('cloth', { rough: 0.5, sheen: 0.9 }), small: true });
    sculptPouch(ctx, { x: 0.13 * sc, z: 0.06 * sc, size: 0.85, color: 0x2a1e14, drop: 0.05 });
    // black cloak with the shoulder mantle
    addFlaredCloak(ctx, { color: BLACK, color2: 0x33312f, mat: CLOAK_WOOL, length: 0.8, flareX: 0.4, flareZ: 0.3 });
    // leather gauntlets
    leatherGauntlets(ctx);
    if (A >= 0.5) pauldrons(ctx, { color: 0x8e9096, trim: SILVER, mat: STEEL, trimMat: POLISHED, lames: 3, size: 0.95, cap: true });
    if (A >= 0.5) limbGuards(ctx, { kind: 'greave', color: 0x8e9096, trim: SILVER, mat: STEEL, trimMat: POLISHED, length: 0.9 });
    if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: SILVER, mat: TOOLED, trimMat: POLISHED, length: 0.55 });
    if (helmed) gondorHelm(ctx, { color: 0xb9bbc0, trim: 0xd2d4d8, mat: POLISHED, trimMat: POLISHED, wing: 0.02 });
    if (helmed) helmWings(ctx, { color: 0xc9cbcc, mat: surface('metal', { rough: 0.24, pat: { scratches: 0.5 } }) });
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
  build: { shoulders: 1.03, bulk: 1.02, chest: 1.02, neckThick: 1.08, muscle: 0.5 },
  face: { jaw: 1.04, chin: 1.0, brow: 1.06, cheekbones: 1.03, nose: { length: 1.03, width: 0.97, bridge: 1.05 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.93, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.25, blemish: 0.12, wrinkles: 0.2, lips: PAL.lips, brows: PAL.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PAL.eyes, sclera: 0xe6e0d4 },
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'trousers', color: PAL.trousers },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 0.92, mat: TOOLED },
    { type: 'belt', color: PAL.belt, mat: LEATHER },
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
  extras: gondorExtras,
};
