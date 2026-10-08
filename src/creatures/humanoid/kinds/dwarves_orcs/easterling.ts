/**
 * Easterlings: gold and bronze scale armour, masked helmets with golden faceplates, spears and
 * shields. Four looks across the seed buckets: gold full mask, bronze plumed half-mask,
 * cloth-wrapped painted warrior, black-lacquered elite with gold trim.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { put, studs } from './armor';
import { ctxBucket, devNum, mix, recipeRng } from './common';
import { sculptStrap, sculptTorsoGarment } from './garments';
import { addHairdo } from './hair';
import { BRONZE, DOME_CONICAL, DOME_POINTED, DOME_ROUND, STEEL, domeHelm, faceMask, sculptTurban } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { BLACK_SCALES, BRONZE_SCALES, GOLD_SCALES, jewelry, layeredPauldrons, plume, studdedBand } from './menparts';

const GOLD = 0xd0a640;
const GOLD_DK = 0xa9812c;
const BRONZE_C = 0xa0692c;
const RED = 0x8a1e16;
const BLACK = 0x1c1816;

function faceCommonMan(ctx: KindContext, rng: Rng, o: { brow: number; paint?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0xa86a48, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.3 }));
  void rng;
  void o;
}

/** a hair knot / tail pulled back, black */
function eastHair(ctx: KindContext, rng: Rng, o: { tail?: number; length?: number; color?: number; count?: number }) {
  const { P, sculpt: s } = ctx;
  const c = o.color ?? 0x14100e;
  sculptHairCap(s, P, { style: 'tied_back', color: c, length: 1, density: 1 });
  addHairdo(ctx, { color: c, tip: 0x241c18, deep: 0x0a0807, length: (o.length ?? 0.16) * P.s, count: o.count ?? 60, width: 0.026, wave: 0.2, wild: 0.1, comb: 1.0, front: 0.24, back: -0.38, gravity: 3, tail: (o.tail ?? 0.25) * P.s, segments: 4 }, rng);
}

function goldMask(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  eastHair(ctx, rng, { tail: 0.3 });
  faceCommonMan(ctx, rng, { brow: 0x14100e });
  sculptTorsoGarment(ctx, { color: GOLD, mat: GOLD_SCALES, inflate: 0.014 * sc, hem: 0.0, sleeve: 0 });
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.02 * sc, sign: 1 });
  if (A >= 0.25) layeredPauldrons(ctx, { color: GOLD, trim: GOLD_DK, mat: GOLD_SCALES, layers: 3, size: 1.05, spike: 0.07 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: true, arms: 1 });
  if (ctx.helmet) {
    domeHelm(ctx, { color: GOLD, trim: GOLD_DK, mat: 'gold', trimMat: 'gold', profile: DOME_CONICAL, finial: 'spike', ridge: true, cheeks: true, rivets: 18, neck: 'plates', tilt: -0.08, y: 0.03 });
    faceMask(ctx, { color: GOLD, trim: GOLD_DK, lift: 0.045, slit: [-0.12, -0.02], top: 0.1 });
  }
}

function bronzePlumed(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  eastHair(ctx, rng, { tail: 0.2 });
  faceCommonMan(ctx, rng, { brow: 0x14100e });
  sculptTorsoGarment(ctx, { color: BRONZE_C, mat: BRONZE_SCALES, inflate: 0.014 * sc, hem: 0.05, sleeve: 0.4 });
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.022 * sc, sign: -1 });
  if (A >= 0.25) layeredPauldrons(ctx, { color: BRONZE_C, trim: GOLD, mat: BRONZE_SCALES, layers: 3, size: 1.1 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: false, arms: 2, ears: true });
  if (ctx.helmet) {
    domeHelm(ctx, { color: BRONZE_C, trim: GOLD, mat: 'gold', trimMat: 'gold', profile: DOME_POINTED, finial: 'ball', ridge: true, cheeks: true, nasal: true, rivets: 20, neck: 'plates', tilt: -0.08 });
    plume(ctx, { color: RED, y: 0.5, length: 1.0 });
  }
}

function painted(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  faceCommonMan(ctx, rng, { brow: 0x14100e });
  // red and black war paint: bars across the eyes and cheeks
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.3, -0.04], [sd * 0.12, -0.04]], { color: BLACK, r: 0.026, mat: 'skin', strength: 0.95 });
    faceStroke(ctx, [[sd * 0.26, -0.18], [sd * 0.12, -0.22]], { color: RED, r: 0.02, mat: 'skin', strength: 0.9 });
    faceStroke(ctx, [[sd * 0.2, -0.34], [sd * 0.1, -0.4]], { color: RED, r: 0.016, mat: 'skin', strength: 0.9 });
  }
  faceStroke(ctx, [[0, 0.2], [0, -0.0]], { color: RED, r: 0.02, mat: 'skin', strength: 0.9 });
  scalpStroke(ctx, [[0, 0.5], [0, 1.1]], { color: RED, r: 0.012 });
  sculptTurban(ctx, { color: RED, color2: BLACK, mat: 'cloth', y: 0.1 });
  void s;
  // leather lamellar with gold studs over a red coat
  sculptTorsoGarment(ctx, { color: 0x4a2c1c, mat: 'leather_worn', inflate: 0.016 * sc, hem: 0.0, sleeve: 0 });
  const cy = P.j.chest[1];
  const pts: [number, number, number][] = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) pts.push([(i - 1.5) * 0.04 * sc, cy + 0.14 * sc - r * 0.045 * sc, 0.118 * sc * P.build.chest + 0.012 * sc]);
  const g = studs(pts, 0.0065 * sc);
  if (g) put(ctx, g, { bone: 'chest', color: GOLD, mat: 'gold', small: true });
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.026 * sc, sign: 1 });
  if (A >= 0.25) layeredPauldrons(ctx, { color: 0x6a4a2a, trim: GOLD, mat: 'leather_worn', trimMat: 'gold', layers: 2, size: 1.0, sides: ['l'] });
  jewelry(ctx, { neck: true, arms: 2, ears: true });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  if (ctx.helmet) domeHelm(ctx, { color: BRONZE_C, trim: GOLD, mat: 'gold', trimMat: 'gold', profile: [[0.4, -0.04], [0.405, 0.03], [0.38, 0.14], [0.31, 0.26], [0.2, 0.34], [0.1, 0.38], [0.0, 0.4]], band: true, ridge: false, cheeks: false, rivets: 14, tilt: -0.04, y: 0.12 });
}

function elite(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  eastHair(ctx, rng, { tail: 0.35 });
  faceCommonMan(ctx, rng, { brow: 0x14100e });
  sculptTorsoGarment(ctx, { color: 0x24201e, mat: BLACK_SCALES, inflate: 0.015 * sc, hem: 0.05, sleeve: 0.5 });
  sculptStrap(ctx, { color: GOLD, mat: 'gold', width: 0.02 * sc, inflate: 0.023 * sc, sign: 1 });
  sculptStrap(ctx, { color: GOLD, mat: 'gold', width: 0.02 * sc, inflate: 0.023 * sc, sign: -1 });
  if (A >= 0.25) layeredPauldrons(ctx, { color: 0x24201e, trim: GOLD, mat: BLACK_SCALES, trimMat: 'gold', layers: 3, size: 1.15, spike: 0.09 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: true, arms: 1 });
  if (ctx.helmet) {
    domeHelm(ctx, { color: 0x24201e, trim: GOLD, mat: STEEL, trimMat: 'gold', profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, rivets: 20, neck: 'plates', tilt: -0.08, y: 0.03 });
    faceMask(ctx, { color: 0x24201e, trim: GOLD, mat: STEEL, lift: 0.045, slit: [-0.12, -0.02], top: 0.1 });
    plume(ctx, { color: BLACK, y: 0.5, length: 0.8, n: 5 });
  }
}

export function easterlingExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'easterling');
  switch (ctxBucket(ctx)) {
    case 1: return bronzePlumed(ctx, rng);
    case 2: return painted(ctx, rng);
    case 3: return elite(ctx, rng);
    default: return goldMask(ctx, rng);
  }
}

export const easterlingDef: KindDef = {
  label: 'Easterling',
  height: 1.8,
  build: { shoulders: 1.08, hips: 1.0, bulk: 1.05, chest: 1.04, muscle: 0.55 },
  face: { jaw: 1.0, chin: 0.95, brow: 1.0, cheekbones: 1.2, nose: { length: 1.0, width: 0.95, bridge: 0.9 }, eyeTilt: 0.08, eyeOpen: 0.85, foreheadSlope: 0.12 },
  skin: { color: 0xb88a64, color2: 0x9a6c4c, blotch: 0.25, wrinkles: 0.25, surface: 'skin_weathered', scatter: 0xc05a38, brows: 0x14100e },
  eyes: { color: 0x2e2218, sclera: 0xe2dcd0 },
  hair: { style: 'stringy', color: 0xb88a64, density: 0 },
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x3a1a14 },
    { type: 'boots', color: 0x1e1612, color2: 0x2e2018, length: 0.9 },
    { type: 'tunic', color: RED, color2: BLACK, length: 0.75 },
    { type: 'belt', color: 0x1e1612 },
  ],
  armor: [
    { type: 'vambraces', style: 'easterling', minArmor: 0.25 },
    { type: 'greaves', style: 'easterling', minArmor: 0.75 },
  ],
  weapons: { right: 'spear', left: 'shield', style: 'easterling' },
  anim: { swagger: 0.3, aggression: 0.6, stance: 1.08 },
  variation: { height: 0.03, bulk: 0.08, skin: 0.1 },
  detail: { res: devNum('res', 0.054), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'man', weight: 0.55 },
  extras: easterlingExtras,
};

void mix;
void BRONZE;
void DOME_CONICAL;
void THREE;
