/**
 * Gundabad orcs (Five Armies): huge (~2.1 m), pale bluish-grey, heavy dark plate with spikes and
 * horns, brutal weapons. Four looks across the seed buckets: horned warlord, bare-headed fur brute,
 * crested plate guard, mail-hooded raider.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import type { KindContext, KindDef } from '../../types';
import { box, put, ring, spike, studs, torsoShell } from './armor';
import { ctxBucket, devNum, mix, recipeRng } from './common';
import { sculptBand, sculptFurMantle, sculptStrap, sculptTorsoGarment } from './garments';
import { addHairdo, withHair } from './hair';
import { DOME_CONICAL, DOME_POINTED, DOME_ROUND, IRON, STEEL, domeHelm, hornPair } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { ORC_FACE } from './orc';
import { bodyMarks, boneNecklace, crudePauldron, eyeRings, orcTeeth, scrapBreastplate, skinMottle, skinTint } from './orcparts';

const DARK = 0x2c2b2d;
const DARK_TRIM = 0x1c1b1c;

/** hanging chain looped between two points (a swag of small rings) */
function chainSwag(ctx: KindContext, a: V3, b: V3, sag: number, bone: string, n = 9) {
  const s = ctx.P.s;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
    put(ctx, ring(p, [0, 0.5 + (i % 2), 1], 0.011 * s, 0.003 * s, 6), { bone, color: 0x5a5650, mat: 'metal_dark', small: true });
  }
}

function warlord(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { dim: 0.56, color: 0x8a949c, color2: 0x626c74, noise: 0.55, torso: true });
  skinMottle(ctx, rng, [0x7a848c, 0x9aa4ac, 0x566068], { dim: 0.56, n: 12, torso: true, strength: 0.4 });
  eyeRings(ctx, 0x2a2e34, 0.6);
  orcTeeth(ctx, rng, { n: 8, big: 1.3 });
  bodyMarks(ctx, rng, { scars: 6, color: 0x3a3a44 });
  addHairdo(ctx, { color: 0x1a1a20, tip: 0x2c2c34, deep: 0x0e0e12, length: 0.55 * sc, count: ctx.helmet ? 40 : 90, width: 0.032, wave: 0.7, wild: 0.85, comb: 0.8, front: 0.22, back: -0.4, gravity: 5, segments: 5 }, rng);
  if (A >= 0.5) {
    const cy = P.j.chest[1];
    scrapBreastplate(ctx, { color: DARK, rng, half: 1.35, y0: cy + 0.03 * sc, y1: cy + 0.22 * sc, jag: 0.012, mat: STEEL, seed: 11, thick: 0.022 });
    scrapBreastplate(ctx, { color: mix(DARK, 0x505058, 0.3), rng, half: 1.5, y0: cy - 0.1 * sc, y1: cy + 0.05 * sc, jag: 0.012, mat: STEEL, seed: 12, thick: 0.02 });
    scrapBreastplate(ctx, { color: DARK, rng, half: 1.25, y0: cy - 0.24 * sc, y1: cy - 0.08 * sc, jag: 0.012, mat: STEEL, seed: 13, thick: 0.018 });
  }
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: DARK, mat: STEEL, rng, layers: 3, size: 1.2, spikes: 3, trim: DARK_TRIM });
    crudePauldron(ctx, 'r', { color: DARK, mat: STEEL, rng, layers: 3, size: 1.2, spikes: 3, trim: DARK_TRIM });
  }
  sculptStrap(ctx, { color: 0x2a2018, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.03 * sc, sign: 1 });
  if (ctx.helmet) {
    domeHelm(ctx, { color: DARK, trim: DARK_TRIM, trimMat: STEEL, mat: STEEL, profile: DOME_POINTED, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'plates', tilt: -0.1 });
    hornPair(ctx, { color: 0xcbc3ac, length: 0.8, curl: 0.6, y: 0.18 });
  }
  const hy = P.j.thigh_l[1] + 0.07 * sc;
  chainSwag(ctx, [0.1 * sc, hy, 0.13 * sc], [-0.1 * sc, hy, 0.13 * sc], 0.06 * sc, 'hips');
}

function brute(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { dim: 0.56, color: 0x929ca2, color2: 0x687279, noise: 0.5, torso: true });
  skinMottle(ctx, rng, [0x808a92, 0xa0aab0, 0x5c666e], { dim: 0.56, n: 14, torso: true, strength: 0.4 });
  eyeRings(ctx, 0x30343a, 0.6);
  orcTeeth(ctx, rng, { n: 9, big: 1.4 });
  bodyMarks(ctx, rng, { scars: 7, color: 0x3a3a44 });
  const ink = 0x2a3038;
  scalpStroke(ctx, [[0, 0.4], [0, 0.9], [Math.PI, 1.2]], { color: ink, r: 0.014 });
  for (const sd of [1, -1]) scalpStroke(ctx, [[sd * 0.5, 0.3], [sd * 1.2, 0.5], [sd * 2.0, 0.4]], { color: ink, r: 0.011 });
  faceStroke(ctx, [[0.2, 0.1], [0.12, -0.15]], { color: ink, r: 0.016, mat: 'skin_orc', strength: 0.8 });
  sculptFurMantle(ctx, { color: 0x5a4c3e, color2: 0x2e261e, thick: 0.04, drop: 0.12, amp: 0.016 });
  boneNecklace(ctx, { rng, n: 8 });
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: 0x3a3a3c, mat: STEEL, rng, layers: 2, size: 1.25, spikes: 4, trim: DARK_TRIM });
    crudePauldron(ctx, 'r', { color: 0x3a3a3c, mat: STEEL, rng, layers: 2, size: 1.25, spikes: 4, trim: DARK_TRIM });
  }
  sculptStrap(ctx, { color: 0x2a2018, mat: 'leather_worn', width: 0.045 * sc, inflate: 0.045 * sc, sign: -1 });
  if (ctx.helmet) {
    // a heavy spiked iron brow-band
    const u = P.headH;
    put(ctx, new THREE.TorusGeometry(0.41 * u, 0.04 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.2).translate(...P.h(0, 0.13, -0.04)), { bone: 'head', color: DARK, mat: STEEL });
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + i * 0.4;
      put(ctx, spike(P.h(Math.sin(a) * 0.41, 0.15, -0.04 + Math.cos(a) * 0.5), [Math.sin(a) * 0.4, 1, Math.cos(a) * 0.25], 0.14 * u, 0.028 * u, 5), { bone: 'head', color: DARK_TRIM, mat: STEEL, small: true });
    }
  }
}

function crested(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { dim: 0.56, color: 0x86909a, color2: 0x5e6870, noise: 0.5, torso: false });
  eyeRings(ctx, 0x242830, 0.6);
  orcTeeth(ctx, rng, { n: 7, big: 1.2 });
  bodyMarks(ctx, rng, { scars: 4, color: 0x3a3a44 });
  addHairdo(ctx, { color: 0x24242a, tip: 0x34343c, deep: 0x121216, length: 0.3 * sc, count: ctx.helmet ? 20 : 60, width: 0.03, wave: 0.4, wild: 0.6, comb: 0.9, front: 0.22, back: -0.4, gravity: 6, segments: 4 }, rng);
  // banded plate: three overlapping bands round the torso
  const cy = P.j.chest[1];
  if (A >= 0.5) {
    sculptBand(ctx, { color: DARK, mat: STEEL, y0: cy - 0.1 * sc, y1: cy + 0.2 * sc, inflate: 0.026 * sc, tags: ['ribs', 'chest', 'pecs', 'back', 'waist'] });
    sculptBand(ctx, { color: mix(DARK, 0x505058, 0.4), mat: STEEL, y0: cy - 0.2 * sc, y1: cy - 0.1 * sc, inflate: 0.022 * sc, tags: ['waist', 'belly', 'ribs', 'back', 'pelvis'] });
    sculptBand(ctx, { color: DARK, mat: STEEL, y0: cy - 0.3 * sc, y1: cy - 0.2 * sc, inflate: 0.026 * sc, tags: ['waist', 'belly', 'pelvis', 'back'] });
  }
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: DARK, mat: STEEL, rng, layers: 3, size: 1.25, spikes: 2, trim: DARK_TRIM });
    crudePauldron(ctx, 'r', { color: DARK, mat: STEEL, rng, layers: 3, size: 1.25, spikes: 2, trim: DARK_TRIM });
  }
  sculptStrap(ctx, { color: 0x2a2018, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.034 * sc, sign: 1 });
  if (ctx.helmet) {
    domeHelm(ctx, { color: DARK, trim: DARK_TRIM, trimMat: STEEL, mat: STEEL, profile: DOME_ROUND, finial: null, ridge: false, cheeks: true, nasal: true, rivets: 20, neck: 'plates', tilt: -0.08 });
    // tall comb-like crest along the skull
    const u = P.headH;
    put(ctx, box(0.04 * u, 0.3 * u, 0.8 * u, [0, 0.0, 0]).translate(...P.h(0, 0.64, -0.08)), { bone: 'head', color: DARK_TRIM, mat: STEEL, small: true });
  }
}

function raider(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { dim: 0.56, color: 0x8e9898, color2: 0x646e6e, noise: 0.5, torso: false });
  eyeRings(ctx, 0x282c30, 0.55);
  orcTeeth(ctx, rng, { n: 8, big: 1.1 });
  bodyMarks(ctx, rng, { scars: 4, color: 0x3a3a44 });
  // mail hauberk with leather over it
  sculptTorsoGarment(ctx, { color: 0x6a6a68, mat: 'mail', inflate: 0.014 * sc, hem: 0.1, sleeve: 0.9 });
  sculptTorsoGarment(ctx, { color: 0x2a2018, mat: 'leather_worn', inflate: 0.022 * sc, hem: 0.0, sleeve: 0 });
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: DARK, mat: STEEL, rng, layers: 2, size: 1.2, spikes: 1, trim: DARK_TRIM });
    crudePauldron(ctx, 'r', { color: DARK, mat: STEEL, rng, layers: 2, size: 1.2, trim: DARK_TRIM });
  }
  sculptStrap(ctx, { color: 0x1c1610, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.034 * sc, sign: -1 });
  const hy = P.j.thigh_l[1] + 0.07 * sc;
  chainSwag(ctx, [0.12 * sc, hy, 0.14 * sc], [-0.12 * sc, hy - 0.02 * sc, 0.14 * sc], 0.08 * sc, 'hips', 10);
  addHairdo(ctx, { color: 0x20202a, tip: 0x30303a, deep: 0x101016, length: 0.25 * sc, count: ctx.helmet ? 10 : 45, width: 0.03, wave: 0.4, wild: 0.7, comb: 0.9, front: 0.22, back: -0.4, gravity: 6, segments: 4 }, rng);
  if (ctx.helmet) domeHelm(ctx, { color: DARK, trim: DARK_TRIM, trimMat: STEEL, mat: STEEL, profile: DOME_CONICAL, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'mail', tilt: -0.08 });
}

export function gundabadExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const rng = recipeRng(ctx, 'gundabad');
    switch (ctxBucket(ctx)) {
      case 1: return brute(ctx, rng);
      case 2: return crested(ctx, rng);
      case 3: return raider(ctx, rng);
      default: return warlord(ctx, rng);
    }
  });
}

export const gundabadDef: KindDef = {
  label: 'Gundabad orc',
  height: 2.1,
  build: { shoulders: 1.3, hips: 1.04, bulk: 1.28, belly: 0.14, chest: 1.18, armLength: 1.14, legLength: 0.92, headSize: 0.95, neck: 0.55, neckThick: 1.5, hunch: 0.28, handSize: 1.35, footSize: 1.2, muscle: 1.0 },
  face: { ...ORC_FACE, brow: 2.0, jaw: 1.4, tusks: 1.0, underbite: 0.85, ears: 'small', earSize: 1.1, eyeSize: 0.95, eyeOpen: 0.85, asym: 0.7 },
  skin: { color: 0x4e585e, color2: 0x363e46, blotch: 0.7, blemish: 0.5, scars: 4, warts: 0.2, wrinkles: 0.6, lips: 0x5a5658, brows: 0x1a1a20, surface: 'skin_orc', scatter: 0x8090a0 },
  eyes: { color: 0xb8cce0, glow: 0.35, sclera: 0xb8bcb8 },
  hair: { style: 'stringy', color: 0x4e585e, density: 0 },
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x2a2622, mat: 'leather_worn' },
    { type: 'boots', color: 0x1e1a18, color2: 0x2a2220, length: 0.9 },
    { type: 'loincloth', color: 0x2c2620, length: 0.6 },
    { type: 'belt', color: 0x1e1a18 },
  ],
  armor: [],
  weapons: { right: 'warhammer', style: 'orc' },
  anim: { hunch: 0.25, swagger: 0.5, aggression: 0.85, stance: 1.2 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.35 },
  detail: { res: devNum('res', 0.06), headRes: devNum('headRes', 0.0165), faceRes: 0, detailScale: 1.2 },
  sfx: { voice: 'orc', grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', weight: 0.75 },
  extras: gundabadExtras,
};

void studs;
void torsoShell;
void IRON;
