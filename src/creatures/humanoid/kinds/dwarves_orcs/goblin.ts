/**
 * Moria goblins: small (1.4-1.55 m), pale grey, huge glinting eyes, bat ears, lean and agile,
 * a crouched scrambling posture, crude blades and spears. Four looks across the seed buckets:
 * bare warty scrambler, ragged hood, pot helmet, bone-and-paint shaman.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { box, put, spike } from './armor';
import { ctxBucket, devNum, recipeRng, shade } from './common';
import { sculptStrap } from './garments';
import { addHairdo } from './hair';
import { IRON, domeHelm } from './headgear';
import { faceStroke } from './markings';
import { bodyMarks, boneNecklace, crudePauldron, eyeRings, orcTeeth, skinMottle, skinTint } from './orcparts';

const FACE = {
  jaw: 1.05, jawLength: 1.05, chin: 0.6, brow: 1.25, cheekbones: 1.0,
  nose: { length: 0.8, width: 1.1, bridge: 0.4, hook: 0.35, tip: 0.9, flat: 0.5 },
  lips: { width: 1.35, fullness: 0.6 }, ears: 'bat' as const, earSize: 1.9, eyeSize: 1.55, eyeSpacing: 1.1, eyeTilt: 0.08,
  eyeOpen: 1.25, tusks: 0.3, underbite: 0.4, foreheadSlope: 0.45, asym: 0.85, cranium: 1.12,
};

/** a ragged hood with a long drooping point and a ragged face opening */
function raggedHood(ctx: KindContext, color: number, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const j = P.j;
  s.group('union', 0.004 * sc, () => {
    s.ellipsoid(P.h(0, 0.08, -0.07), [0.385 * u, 0.46 * u, 0.5 * u], { color, mat: 'rags', bone: 'head', k: 0.02 * sc, noise: { amp: 0.0035 * sc, freq: 40 / sc, type: 'ridged', octaves: 2 } });
    s.cone([0, j.neck[1] - 0.03 * sc, -0.03 * sc], P.h(0, -0.3, -0.12), 0.1 * sc, 0.115 * sc, { color, mat: 'rags', bone: 'neck', bone2: 'head', k: 0.06 * sc });
    // face opening
    s.ellipsoid(P.h(0, -0.15, 0.45), [0.3 * u, 0.44 * u, 0.34 * u], { op: 'subtract', k: 0.04 * u });
    // ragged lower edge in front of the chest
    s.plane([0, -1, 0], -(j.neck[1] - 0.045 * sc), { op: 'intersect', k: 0.01 * sc });
  });
  // the drooping tip
  s.cone(P.h(0, 0.4, -0.35), P.h(0, 0.15, -0.8), 0.07 * u, 0.012 * u, { color, mat: 'rags', bone: 'head', k: 0.03 * u });
  void rng;
}

/** crude strips of cloth wrapped round the forearms/shins */
function strips(ctx: KindContext, color: number, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  for (const sd of ['l', 'r'] as const) {
    const e = P.j[`forearm_${sd}`];
    const w = P.j[`hand_${sd}`];
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.25 + rng.range(-0.04, 0.04);
      const c: [number, number, number] = [e[0] + (w[0] - e[0]) * t, e[1] + (w[1] - e[1]) * t, e[2]];
      s.torus(c, 0.036 * sc * (1 - t * 0.3), 0.005 * sc, { color, mat: 'rags', bone: `forearm_${sd}`, k: 0.004 * sc, rot: [0, 0, sd === 'l' ? -0.78 : 0.78] });
    }
  }
}

function scrambler(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  skinTint(ctx, { color: 0xb2ada0, color2: 0x8c8878, noise: 0.55, torso: true, legs: true });
  skinMottle(ctx, rng, [0x9a9588, 0xc2bdae, 0x7a766a], { n: 14, torso: true, strength: 0.45 });
  eyeRings(ctx, 0x5a5448, 0.5);
  orcTeeth(ctx, rng, { n: 10, big: 0.8, color: 0xd8cca0 });
  bodyMarks(ctx, rng, { scars: 3 });
  boneNecklace(ctx, { rng, n: 7 });
  sculptStrap(ctx, { color: 0x3a2e22, mat: 'leather_worn', width: 0.028 * P.s, inflate: 0.013 * P.s, sign: -1 });
  strips(ctx, 0x4a4234, rng);
  void s;
}

function hooded(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  skinTint(ctx, { color: 0x9aa090, color2: 0x72786a, noise: 0.55, torso: true, legs: true });
  eyeRings(ctx, 0x4a5048, 0.5);
  orcTeeth(ctx, rng, { n: 9, big: 0.8, color: 0xd8cca0 });
  raggedHood(ctx, 0x3a3228, rng);
  strips(ctx, 0x3a3228, rng);
  sculptStrap(ctx, { color: 0x2c241a, mat: 'leather_worn', width: 0.028 * sc, inflate: 0.013 * sc, sign: 1 });
  crudePauldron(ctx, 'l', { color: 0x4a4038, rng, layers: 1, size: 0.9, trim: 0x3a3028 });
}

function potHelm(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  skinTint(ctx, { color: 0xb8b090, color2: 0x8e8a70, noise: 0.55, torso: true, legs: true });
  skinMottle(ctx, rng, [0x9c9678, 0xc8c2a2], { n: 10, torso: true, strength: 0.4 });
  eyeRings(ctx, 0x5a5440, 0.55);
  orcTeeth(ctx, rng, { n: 9, big: 0.9, color: 0xd8cca0 });
  bodyMarks(ctx, rng, { scars: 4 });
  sculptHairCap(s, P, { style: 'stringy', color: 0x2c2820, length: 1, density: 1 });
  addHairdo(ctx, { color: 0x2c2820, tip: 0x3c3830, deep: 0x1a1812, length: 0.2 * sc, count: ctx.helmet ? 12 : 35, width: 0.026, wave: 0.5, wild: 0.9, comb: 0.5, front: 0.2, back: -0.42, gravity: 7, segments: 4 }, rng);
  crudePauldron(ctx, 'r', { color: 0x4a4038, rng, layers: 2, size: 0.95, trim: 0x3a3028 });
  sculptStrap(ctx, { color: 0x3a2e22, mat: 'leather_worn', width: 0.028 * sc, inflate: 0.013 * sc, sign: 1 });
  strips(ctx, 0x4a4234, rng);
  if (ctx.helmet) domeHelm(ctx, { color: 0x4a4038, trim: 0x3a3028, trimMat: IRON, mat: IRON, profile: [[0.42, -0.06], [0.43, 0.04], [0.4, 0.17], [0.32, 0.3], [0.2, 0.4], [0.1, 0.45], [0.0, 0.47]], band: true, ridge: false, cheeks: false, rivets: 10, nasal: false, finial: 'spike', tilt: 0.12, y: -0.04 });
}

function shaman(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  skinTint(ctx, { color: 0x8c96a0, color2: 0x646e7a, noise: 0.5, torso: true, legs: true });
  eyeRings(ctx, 0x3a4048, 0.55);
  orcTeeth(ctx, rng, { n: 10, big: 0.9, color: 0xd8d0a8 });
  // white face paint
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.2, 0.1], [sd * 0.14, -0.1], [sd * 0.07, -0.28]], { color: 0xddd8c8, r: 0.02, mat: 'skin_orc', strength: 0.9 });
    faceStroke(ctx, [[sd * 0.28, -0.05], [sd * 0.2, -0.15]], { color: 0xddd8c8, r: 0.014, mat: 'skin_orc', strength: 0.9 });
  }
  sculptHairCap(s, P, { style: 'stringy', color: 0x8a8a84, length: 1, density: 1 });
  addHairdo(ctx, { color: 0x8a8a84, tip: 0xaaaaa2, deep: 0x5a5a56, length: 0.42 * sc, count: 60, width: 0.026, wave: 0.8, wild: 1.0, comb: 0.5, front: 0.2, back: -0.42, gravity: 6, segments: 5 }, rng);
  boneNecklace(ctx, { rng, n: 11 });
  bodyMarks(ctx, rng, { scars: 2, paint: 4, paintColor: 0xddd8c8 });
  strips(ctx, 0x4a3a2a, rng);
  // a horned skull cap of bone
  if (ctx.helmet) {
    const u = P.headH;
    for (const sd of [1, -1]) put(ctx, spike(P.h(sd * 0.22, 0.28, 0.0), [sd * 0.9, 1, -0.2], 0.28 * u, 0.04 * u, 5), { bone: 'head', color: 0xcfc4a2, mat: 'bone' });
    put(ctx, new THREE.TorusGeometry(0.39 * u, 0.025 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.18).translate(...P.h(0, 0.16, -0.04)), { bone: 'head', color: 0x4a3a2a, mat: 'leather_worn' });
  }
  put(ctx, box(0.05 * sc, 0.06 * sc, 0.02 * sc, [0.0, P.j.thigh_l[1] + 0.07 * sc, 0.1 * sc]), { bone: 'hips', color: 0x8a7a50, mat: 'bone', small: true });
}

export function goblinExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'goblin');
  switch (ctxBucket(ctx)) {
    case 1: return hooded(ctx, rng);
    case 2: return potHelm(ctx, rng);
    case 3: return shaman(ctx, rng);
    default: return scrambler(ctx, rng);
  }
}

export const goblinDef: KindDef = {
  label: 'Moria goblin',
  height: 1.48,
  build: { shoulders: 0.92, hips: 0.88, bulk: 0.88, belly: 0.12, chest: 0.92, armLength: 1.3, legLength: 0.9, headSize: 1.24, neck: 0.75, neckThick: 0.85, hunch: 0.72, handSize: 1.45, footSize: 1.25, muscle: 0.7 },
  face: FACE,
  skin: { color: 0xb2ada0, color2: 0x8c8878, blotch: 0.5, blemish: 0.5, scars: 2, warts: 0.6, wrinkles: 0.7, lips: 0x6a5a54, brows: 0x4a463e, surface: 'skin_orc', scatter: 0x9a8a70 },
  eyes: { color: 0xe6dc7a, glow: 1.1, sclera: 0xd8d4b0 },
  hair: { style: 'stringy', color: 0xb2ada0, density: 0 },
  beard: null,
  outfit: [
    { type: 'loincloth', color: 0x3a3428, length: 0.55 },
    { type: 'belt', color: 0x2a2218 },
  ],
  armor: [],
  weapons: { right: 'cleaver', style: 'orc' },
  anim: { hunch: 0.7, swagger: 0.3, aggression: 0.9, stance: 1.28, cadence: 1.2, armSwing: 1.3 },
  variation: { height: 0.06, bulk: 0.1, skin: 0.45 },
  detail: { res: devNum('res', 0.058), headRes: devNum('headRes', 0.0135), faceRes: 0, detailScale: 0.9 },
  sfx: { voice: 'goblin', grunt: 'goblin_screech', die: 'orc_die', roar: 'goblin_screech', weight: 0.35 },
  extras: goblinExtras,
};

void shade;
