/**
 * Orcs (Hobbit / LOTR rank and file): wiry, hunched, mottled grey-green to brown skin, scars,
 * uneven fangs, matted hair, scraps of leather and crude rusty armour. Four looks across the seed
 * buckets: bare-headed scavenger, helmeted jerkin, painted mohawk ravager, black-armoured Mordor guard.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import type { KindContext, KindDef } from '../../types';
import { box, put, ring, spike, studs } from './armor';
import { ctxBucket, devNum, devSkip, mix, recipeRng, shade } from './common';
import { sculptStrap, sculptTorsoGarment } from './garments';
import { addHairdo } from './hair';
import { DOME_POINTED, DOME_ROUND, IRON, STEEL, domeHelm } from './headgear';
import { faceStroke, paintBlob } from './markings';
import { bodyMarks, boneNecklace, crudePauldron, eyeRings, orcTeeth, scrapBreastplate, skinMottle, skinTint } from './orcparts';

export const ORC_FACE = {
  jaw: 1.3, jawLength: 1.1, chin: 0.7, brow: 1.9, cheekbones: 1.3,
  nose: { length: 0.75, width: 1.55, bridge: 0.5, hook: 0, tip: 1.15, flat: 0.85 },
  lips: { width: 1.3, fullness: 0.7 }, ears: 'orc' as const, earSize: 1.3, eyeSize: 1.0, eyeSpacing: 1.04, eyeTilt: -0.1,
  eyeOpen: 0.95, tusks: 0.9, underbite: 0.75, foreheadSlope: 0.65, asym: 0.8, cranium: 0.9,
};

function warPaintFace(ctx: KindContext, color: number, rng: Rng) {
  // three diagonal slashes across the face and a chin stripe
  for (const sd of [1, -1]) {
    const x = sd * rng.range(0.05, 0.1);
    faceStroke(ctx, [[x + sd * 0.12, 0.14], [x + sd * 0.1, -0.05], [x + sd * 0.02, -0.22]], { color, r: 0.022, mat: 'skin_orc', strength: 0.9 });
    faceStroke(ctx, [[sd * 0.24, -0.08], [sd * 0.16, -0.18]], { color, r: 0.016, mat: 'skin_orc', strength: 0.9 });
  }
  faceStroke(ctx, [[0, 0.22], [0, 0.05]], { color, r: 0.02, mat: 'skin_orc', strength: 0.9 });
  faceStroke(ctx, [[0, -0.48], [0, -0.58]], { color, r: 0.02, mat: 'skin_orc', strength: 0.9 });
}

/** an iron band with spikes round the head (when a helmet is allowed but this orc wears none) */
function spikedBand(ctx: KindContext, color: number) {
  const { P } = ctx;
  const u = P.headH;
  const band = new THREE.TorusGeometry(0.4 * u, 0.02 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.2).translate(...P.h(0, 0.14, -0.04));
  put(ctx, band, { bone: 'head', color, mat: IRON });
  for (let i = 0; i < 6; i++) {
    const a = -1.1 + i * 0.44;
    put(ctx, spike(P.h(Math.sin(a) * 0.4, 0.15, -0.04 + Math.cos(a) * 0.48), [Math.sin(a) * 0.5, 1, Math.cos(a) * 0.3], 0.1 * u, 0.02 * u, 5), { bone: 'head', color, mat: IRON, small: true });
  }
}

/** crude rag cloth hanging from the belt */
function beltScraps(ctx: KindContext, color: number, n: number, rng: Rng) {
  const { P } = ctx;
  const s = P.s;
  const by = P.j.thigh_l[1] + 0.05 * s;
  const rx = 0.15 * s * Math.sqrt(P.build.bulk);
  for (let i = 0; i < n; i++) {
    const a = -1.3 + (i / Math.max(1, n - 1)) * 2.6;
    const len = (0.06 + rng.float() * 0.08) * s;
    const g = box(0.035 * s, len, 0.008 * s, [Math.sin(a) * rx * 1.05, by - len / 2, Math.cos(a) * rx * 0.85], [0, a, 0]);
    put(ctx, g, { bone: 'hips', color: shade(color, 0.7 + rng.float() * 0.5), mat: 'rags', small: true });
  }
}

// ── bucket 0: bare-headed scavenger ──────────────────────────────────────────
function scavenger(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const helm = ctx.helmet;
  addHairdo(ctx, { color: 0x1c1814, tip: 0x2c261f, deep: 0x100e0c, length: 0.36 * sc, count: helm ? 30 : 70, width: 0.03, wave: 0.6, wild: 0.9, comb: 0.5, front: 0.2, back: -0.42, gravity: 7, segments: 5 }, rng);
  skinTint(ctx, { color: 0x6c6652, color2: 0x4a4034, noise: 0.6 });
  skinMottle(ctx, rng, [0x5a4a38, 0x7a7a5a, 0x4a4a34], { n: 12, torso: true });
  eyeRings(ctx, 0x2a1a14, 0.6);
  orcTeeth(ctx, rng, { n: 6, big: 1.0 });
  bodyMarks(ctx, rng, { scars: 5 });
  sculptStrap(ctx, { color: 0x2a2018, mat: 'leather_worn', width: 0.036 * sc, inflate: 0.015 * sc, sign: 1 });
  sculptStrap(ctx, { color: 0x3a2a1e, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.017 * sc, sign: -1 });
  if (A >= 0.25) crudePauldron(ctx, 'r', { color: 0x5a4a3a, rng, layers: 2, size: 1.05, trim: 0x4a4038 });
  if (A >= 0.5) scrapBreastplate(ctx, { color: 0x56483a, rng, half: 0.6, y0: P.j.chest[1] - 0.02 * sc, y1: P.j.chest[1] + 0.12 * sc, jag: 0.04, seed: 4 });
  beltScraps(ctx, 0x4a4234, 5, rng);
  if (helm) domeHelm(ctx, { color: 0x5a4c3e, trim: 0x3a2e24, trimMat: IRON, mat: IRON, profile: [[0.38, -0.05], [0.385, 0.02], [0.36, 0.14], [0.29, 0.26], [0.2, 0.36], [0.1, 0.42], [0.0, 0.45]], band: false, ridge: false, cheeks: false, rivets: 0, nasal: true, tilt: -0.05 });
}

// ── bucket 1: helmeted jerkin ────────────────────────────────────────────────
function helmeted(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { color: 0x7c5c44, color2: 0x56402e, noise: 0.55, torso: false });
  skinMottle(ctx, rng, [0x6a5238, 0x5a4a36, 0x7c6a4a], { n: 10 });
  eyeRings(ctx, 0x30201a, 0.5);
  orcTeeth(ctx, rng, { n: 7, big: 1.1 });
  bodyMarks(ctx, rng, { scars: 3, back: false });
  addHairdo(ctx, { color: 0x2a1e16, tip: 0x3a2c20, deep: 0x16100c, length: 0.22 * sc, count: ctx.helmet ? 20 : 55, width: 0.03, wave: 0.5, wild: 0.7, comb: 0.8, front: 0.2, back: -0.42, gravity: 7, segments: 5 }, rng);
  // leather jerkin with rivets, open at the sides
  sculptTorsoGarment(ctx, { color: 0x3a2c20, mat: 'leather_worn', inflate: 0.017 * sc, hem: -0.05, sleeve: 0 });
  const rv: V3[] = [];
  const cy = P.j.chest[1];
  for (let i = 0; i < 6; i++) rv.push([0.04 * sc * (i % 2 ? 1 : -1), cy + 0.14 * sc - i * 0.045 * sc, 0.118 * sc * P.build.chest + 0.005 * sc * (i % 2)]);
  const sg = studs(rv, 0.0065 * sc);
  if (sg) put(ctx, sg, { bone: 'chest', color: 0x6a5a46, mat: 'metal_dark', small: true });
  if (A >= 0.25) crudePauldron(ctx, 'l', { color: 0x6a4a34, rng, layers: 3, size: 1.1, spikes: 1, trim: 0x4a4038 });
  if (A >= 0.75) crudePauldron(ctx, 'r', { color: 0x6a4a34, rng, layers: 2, size: 1.0, trim: 0x4a4038 });
  beltScraps(ctx, 0x3a3228, 4, rng);
  if (ctx.helmet) domeHelm(ctx, { color: 0x6a5648, trim: 0x4a3a30, trimMat: IRON, mat: IRON, profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 14, neck: 'plates', tilt: -0.06 });
}

// ── bucket 2: painted mohawk ravager ─────────────────────────────────────────
function ravager(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  addHairdo(ctx, { color: 0x14100d, tip: 0x2a2018, deep: 0x0c0a08, length: 0.13 * sc, count: 55, width: 0.03, wave: 0.2, wild: 0.4, comb: 0.0, front: 0.28, back: -0.38, gravity: 1.5, mohawk: true, ridge: 0.06, segments: 4 }, rng);
  if (!devSkip('tint')) skinTint(ctx, { color: 0x8e9874, color2: 0x65725a, noise: 0.5 });
  if (!devSkip('mottle')) skinMottle(ctx, rng, [0x84886a, 0x5a6048, 0x6a6a52], { n: 12, torso: true, strength: 0.5 });
  if (!devSkip('rings')) eyeRings(ctx, 0x1a1210, 0.7);
  if (!devSkip('teeth')) orcTeeth(ctx, rng, { n: 8, big: 1.25 });
  if (!devSkip('face')) warPaintFace(ctx, 0xd2cdbd, rng);
  if (!devSkip('marks')) bodyMarks(ctx, rng, { scars: 4, paint: 5, paintColor: 0xd2cdbd });
  if (!devSkip('marks')) bodyMarks(ctx, rng, { paint: 3, paintColor: 0xd2cdbd, back: true });
  boneNecklace(ctx, { rng, n: 9 });
  if (!devSkip('strap')) sculptStrap(ctx, { color: 0x2a2018, mat: 'leather_worn', width: 0.034 * sc, inflate: 0.014 * sc, sign: -1 });
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: 0x4a4038, rng, layers: 2, size: 1.0, spikes: 3, trim: 0x3a3028 });
    crudePauldron(ctx, 'r', { color: 0x4a4038, rng, layers: 2, size: 1.0, spikes: 3, trim: 0x3a3028 });
  }
  beltScraps(ctx, 0x3a2e24, 6, rng);
  if (ctx.helmet) spikedBand(ctx, 0x5a4a3c);
}

// ── bucket 3: black-armoured Mordor guard ────────────────────────────────────
function guard(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  skinTint(ctx, { color: 0x484c3e, color2: 0x2c3028, noise: 0.5, torso: false });
  skinMottle(ctx, rng, [0x3e3c30, 0x4e4a3a, 0x5a5a48], { n: 10, strength: 0.5 });
  eyeRings(ctx, 0x1a1412, 0.5);
  orcTeeth(ctx, rng, { n: 6, big: 0.9 });
  bodyMarks(ctx, rng, { scars: 2 });
  addHairdo(ctx, { color: 0x181410, tip: 0x261e18, deep: 0x0e0c0a, length: 0.14 * sc, count: ctx.helmet ? 15 : 50, width: 0.03, wave: 0.3, wild: 0.6, comb: 0.9, front: 0.22, back: -0.42, gravity: 7, segments: 4 }, rng);
  // black quilted tunic and a plate cuirass painted with a red eye
  sculptTorsoGarment(ctx, { color: 0x201c1a, mat: 'cloth', inflate: 0.012 * sc, hem: 0.0, sleeve: 0.45 });
  const cy = P.j.chest[1];
  const eye = (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const ex = p.x / (0.06 * sc);
    const ey = (p.y - (cy + 0.1 * sc)) / (0.03 * sc);
    const d = ex * ex + ey * ey;
    if (p.z > 0 && d < 1) c.setHex(Math.abs(ex) < 0.18 ? 0x14100e : 0xc2441c, THREE.SRGBColorSpace);
  };
  if (A >= 0.5) scrapBreastplate(ctx, { color: 0x34322f, rng, half: 0.9, y0: cy - 0.05 * sc, y1: cy + 0.17 * sc, jag: 0.012, mat: STEEL, seed: 7, colorFn: eye, thick: 0.016 });
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: 0x34322f, mat: STEEL, rng, layers: 2, size: 1.05, trim: 0x2a2826 });
    crudePauldron(ctx, 'r', { color: 0x34322f, mat: STEEL, rng, layers: 2, size: 1.05, trim: 0x2a2826 });
  }
  beltScraps(ctx, 0x2a2420, 5, rng);
  if (ctx.helmet) domeHelm(ctx, { color: 0x34322f, trim: 0x22201e, trimMat: STEEL, mat: STEEL, profile: DOME_POINTED, finial: 'spike', ridge: false, cheeks: true, nasal: true, rivets: 16, neck: 'plates', tilt: -0.08 });
}

export function orcExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'orc');
  switch (ctxBucket(ctx)) {
    case 1: return helmeted(ctx, rng);
    case 2: return ravager(ctx, rng);
    case 3: return guard(ctx, rng);
    default: return scavenger(ctx, rng);
  }
}

export const orcDef: KindDef = {
  label: 'Orc',
  height: 1.68,
  build: { shoulders: 1.16, hips: 0.98, bulk: 1.08, belly: 0.16, chest: 1.04, armLength: 1.2, legLength: 0.92, headSize: 1.04, neck: 0.55, neckThick: 1.35, hunch: 0.5, handSize: 1.3, footSize: 1.15, muscle: 0.85 },
  face: ORC_FACE,
  skin: { color: 0x6a6c52, color2: 0x3c3a2c, blotch: devNum('blotch', 0.95), blemish: devNum('blemish', 0.6), scars: 3, warts: 0.35, wrinkles: 0.65, lips: 0x4a3a34, brows: 0x1a1612, surface: 'skin_orc', scatter: 0x8a7040 },
  eyes: { color: 0xc8a030, glow: 0.35, sclera: 0xb0a080 },
  hair: { style: 'stringy', color: 0x666850, density: 0 },
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x2e2a24, mat: 'rags' },
    { type: 'shoes', color: 0x2a221a },
    { type: 'loincloth', color: 0x3a3428, length: 0.5 },
    { type: 'belt', color: 0x241e18 },
  ],
  armor: [],
  weapons: { right: 'scimitar', style: 'orc' },
  anim: { hunch: 0.35, swagger: 0.6, aggression: 0.75, stance: 1.15, cadence: 1.1 },
  variation: { height: 0.06, bulk: 0.1, skin: 0.45 },
  detail: { res: devNum('res', 0.05), headRes: devNum('headRes', 0.0125), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'orc', grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', weight: 0.5 },
  extras: orcExtras,
};

void mix;
void paintBlob;
void ring;
