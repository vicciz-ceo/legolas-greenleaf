/**
 * Men of Harad (Pelennor Fields): red and black robes and wraps, painted faces, dark skin,
 * scimitars and spears, gold jewellery. Four looks across the seed buckets: red turban with black
 * veil, braided and face-painted, round bronze helm with mail, black head-wrap raider.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { put, studs } from './armor';
import { ctxBucket, devNum, recipeRng } from './common';
import { sculptStrap, sculptTorsoGarment } from './garments';
import { addHairdo } from './hair';
import { DOME_ROUND, domeHelm, sculptTurban, veil } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { LAMELLAR, jewelry, layeredPauldrons, plume, studdedBand } from './menparts';

const GOLD = 0xd0a640;
const RED = 0x6e140e;
const RED_DK = 0x42100c;
const BLACK = 0x1a1414;

function darkBrows(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0x5a3322, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.3 }));
}

function turbaned(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  darkBrows(ctx);
  sculptTurban(ctx, { color: RED, color2: RED_DK, mat: 'cloth', y: 0.1, height: 1 });
  veil(ctx, { color: BLACK, y0: -0.62, y1: -0.14 });
  // red coat, leather lamellar with gold studs
  sculptTorsoGarment(ctx, { color: RED, mat: 'cloth', inflate: 0.011 * sc, hem: 0.0, sleeve: 2, color2: RED_DK });
  sculptTorsoGarment(ctx, { color: 0x3a2418, mat: LAMELLAR, inflate: 0.019 * sc, hem: 0.0, sleeve: 0 });
  const cy = P.j.chest[1];
  const pts: [number, number, number][] = [];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) pts.push([(i - 1.5) * 0.045 * sc, cy + 0.12 * sc - r * 0.05 * sc, 0.118 * sc * P.build.chest + 0.016 * sc]);
  const g = studs(pts, 0.0065 * sc);
  if (g) put(ctx, g, { bone: 'chest', color: GOLD, mat: 'gold', small: true });
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.026 * sc, sign: -1 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: true, arms: 1, ears: true });
  if (A >= 0.5) layeredPauldrons(ctx, { color: 0x3a2418, trim: GOLD, mat: LAMELLAR, trimMat: 'gold', layers: 2, size: 1.0, sides: ['r'] });
  void rng;
}

function braided(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  darkBrows(ctx);
  sculptHairCap(s, P, { style: 'short', color: 0x0e0a08, length: 1, density: 1 });
  addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.4 * sc, count: 80, width: 0.03, wave: 0.9, wild: 0.6, comb: 0.8, front: 0.24, back: -0.4, gravity: 5, tail: 0.3 * sc, segments: 5 }, rng);
  // red and white paint: bars, a stripe down the nose, dots
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.3, 0.02], [sd * 0.22, -0.1], [sd * 0.14, -0.3]], { color: 0xe6dfd0, r: 0.02, mat: 'skin', strength: 0.9 });
    faceStroke(ctx, [[sd * 0.2, 0.08], [sd * 0.1, 0.04]], { color: RED, r: 0.018, mat: 'skin', strength: 0.9 });
  }
  faceStroke(ctx, [[0, 0.22], [0, -0.05]], { color: 0xe6dfd0, r: 0.016, mat: 'skin', strength: 0.9 });
  faceStroke(ctx, [[0, -0.46], [0, -0.58]], { color: RED, r: 0.02, mat: 'skin', strength: 0.9 });
  scalpStroke(ctx, [[0, 0.5], [0, 1.0]], { color: 0xe6dfd0, r: 0.01 });
  // bare muscular arms with gold bangles; black waistcoat, red sash
  sculptTorsoGarment(ctx, { color: BLACK, mat: 'cloth', inflate: 0.012 * sc, hem: 0.0, sleeve: 0 });
  sculptStrap(ctx, { color: RED, mat: 'cloth', width: 0.05 * sc, inflate: 0.02 * sc, sign: 1 });
  jewelry(ctx, { neck: true, arms: 3, ears: true });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
}

function helmed(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  darkBrows(ctx);
  addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.16 * sc, count: ctx.helmet ? 15 : 55, width: 0.028, wave: 0.3, wild: 0.2, comb: 0.9, front: 0.24, back: -0.4, gravity: 4, segments: 4 }, rng);
  sculptTorsoGarment(ctx, { color: RED, mat: 'cloth', inflate: 0.011 * sc, hem: 0.0, sleeve: 2, color2: RED_DK });
  sculptTorsoGarment(ctx, { color: 0xb09050, mat: 'mail', inflate: 0.017 * sc, hem: 0.0, sleeve: 0 });
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.024 * sc, sign: 1 });
  if (A >= 0.25) layeredPauldrons(ctx, { color: 0x9a7a38, trim: GOLD, mat: 'gold', layers: 2, size: 1.0 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: true, arms: 2 });
  if (ctx.helmet) {
    domeHelm(ctx, { color: 0x9a7a38, trim: GOLD, mat: 'gold', trimMat: 'gold', profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'mail', tilt: -0.08 });
    plume(ctx, { color: RED, y: 0.52, length: 0.7, n: 5 });
  }
}

function wrapped(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  darkBrows(ctx);
  sculptTurban(ctx, { color: BLACK, color2: 0x2e2220, mat: 'cloth', y: 0.08 });
  // white stripes under the eyes, a red scarf at the neck
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.28, -0.14], [sd * 0.1, -0.16]], { color: 0xe6dfd0, r: 0.016, mat: 'skin', strength: 0.9 });
    faceStroke(ctx, [[sd * 0.22, -0.22], [sd * 0.08, -0.24]], { color: 0xe6dfd0, r: 0.014, mat: 'skin', strength: 0.9 });
  }
  veil(ctx, { color: RED, y0: -0.6, y1: -0.3 });
  sculptTorsoGarment(ctx, { color: RED, mat: 'cloth', inflate: 0.011 * sc, hem: 0.0, sleeve: 1.6, color2: BLACK });
  // crossed bandoliers
  sculptStrap(ctx, { color: BLACK, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.022 * sc, sign: 1 });
  sculptStrap(ctx, { color: 0x3a2418, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.026 * sc, sign: -1 });
  studdedBand(ctx, { y: P.j.thigh_l[1] + 0.07 * sc, color: GOLD });
  jewelry(ctx, { neck: true, arms: 1 });
  void rng;
}

export function haradrimExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'haradrim');
  switch (ctxBucket(ctx)) {
    case 1: return braided(ctx, rng);
    case 2: return helmed(ctx, rng);
    case 3: return wrapped(ctx, rng);
    default: return turbaned(ctx, rng);
  }
}

export const haradrimDef: KindDef = {
  label: 'Haradrim',
  height: 1.78,
  build: { shoulders: 1.02, hips: 0.98, bulk: 0.98, chest: 1.0, muscle: 0.5 },
  face: { jaw: 0.95, chin: 1.0, brow: 1.05, cheekbones: 1.1, nose: { length: 1.05, width: 0.9, bridge: 1.05, hook: 0.1 }, eyeTilt: 0.04, eyeOpen: 0.9 },
  skin: { color: 0x62402a, color2: 0x4a2e1c, blotch: 0.3, wrinkles: 0.2, surface: 'skin_weathered', scatter: 0xa04a30, brows: 0x0e0a08 },
  eyes: { color: 0x2a1c12, sclera: 0xe2d8c8 },
  hair: { style: 'stringy', color: 0x72492f, density: 0 },
  beard: null,
  outfit: [
    { type: 'trousers', color: RED_DK },
    { type: 'shoes', color: 0x2a1c14 },
    { type: 'skirt', color: RED, color2: BLACK, length: 0.8 },
    { type: 'sash', color: BLACK, color2: GOLD },
  ],
  armor: [{ type: 'vambraces', style: 'haradrim', minArmor: 0.5 }],
  weapons: { right: 'scimitar', style: 'haradrim' },
  anim: { swagger: 0.3, aggression: 0.55, stance: 1.05 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.14 },
  detail: { res: devNum('res', 0.052), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'man', weight: 0.5 },
  extras: haradrimExtras,
};

void THREE;
