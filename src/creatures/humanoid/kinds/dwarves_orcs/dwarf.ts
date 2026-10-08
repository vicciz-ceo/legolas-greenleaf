/**
 * Dwarves of Thorin's company: four looks across the seed buckets (bald and tattooed warrior,
 * floppy-hat jester with braided moustache, white-bearded elder with braids, huge red beard).
 * Upper body first: they ride waist-deep in barrels, so coats, mantles, scarves, straps and
 * beards carry the character.
 */
import * as THREE from 'three';
import { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { createWeapon } from '../../../weapons';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { box, put, ring, shell, spike, studs } from './armor';
import { ctxBucket, devNum, mix, recipeRng, shade } from './common';
import { placket, sculptFurMantle, sculptScarf, sculptStrap, sculptTorsoGarment } from './garments';
import { addBeard, addBrows, addHairdo, braidClasps, hairMaterial, sculptBeardMass, type BeardOpts, withHair } from './hair';
import { DOME_ROUND, STEEL, domeHelm, floppyHat } from './headgear';
import { faceStroke, inkScalp, paintBlob, paintRing } from './markings';

const MAIL = 0x76756f;

/** shared: ruddy cheeks/nose, eyebrows, wrinkles */
function faceCommon(ctx: KindContext, o: { brow: number; blush?: number; scars?: number }, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  addBrows(ctx, { color: o.brow, count: 11, length: 0.07, width: 0.014, y: 0.075, z: 0.395 }, rng);
  s.mirrored(() => s.ellipsoid(P.h(0.135, -0.055, 0.33), [0.095 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0x8a4a38, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: 0.45 }));
  const b = o.blush ?? 0.6;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: 0xa8503e, mat: 'skin_weathered', bone: 'head', k: 0.05 * u, strength: b }));
  s.ellipsoid(P.h(0, -0.27, 0.52), [0.075 * u, 0.06 * u, 0.06 * u], { op: 'paint', color: 0xb4584a, mat: 'skin_weathered', bone: 'head', k: 0.04 * u, strength: b });
  for (let i = 0; i < (o.scars ?? 0); i++) {
    const x = (rng.float() > 0.5 ? 1 : -1) * rng.range(0.1, 0.22);
    faceStroke(ctx, [[x, rng.range(0.0, 0.1)], [x + rng.range(-0.05, 0.05), rng.range(-0.28, -0.15)]], { color: 0x8a4a40, r: 0.007, mat: 'skin_weathered', strength: 0.8 });
  }
}


/** a pouch hanging from the belt */
function pouch(ctx: KindContext, side: number, color: number, z = 0.0) {
  const { P } = ctx;
  const s = P.s;
  const by = P.j.thigh_l[1] + 0.045 * s;
  const rx = 0.152 * s * Math.sqrt(P.build.bulk);
  const g = box(0.06 * s, 0.075 * s, 0.045 * s, [side * rx, by - 0.02 * s, z + 0.02 * s]);
  put(ctx, g, { bone: 'hips', color, mat: 'leather_worn', small: true });
  put(ctx, box(0.062 * s, 0.025 * s, 0.047 * s, [side * rx, by + 0.012 * s, z + 0.02 * s]), { bone: 'hips', color: shade(color, 0.8), mat: 'leather_worn', small: true });
}

function beltBuckle(ctx: KindContext, color: number) {
  const { P } = ctx;
  const s = P.s;
  const by = P.j.thigh_l[1] + 0.07 * s;
  const bz = 0.104 * s * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * s;
  put(ctx, box(0.06 * s, 0.05 * s, 0.01 * s, [0, by, bz]), { bone: 'hips', color, mat: 'gold', small: true });
}

/** the weapon rack on the back: a second weapon stowed (hammer, axe, mattock) */
function backWeapon(ctx: KindContext, kind: 'axe' | 'warhammer' | 'mace', seed: number) {
  const s = ctx.P.s;
  ctx.object(
    () => {
      const w = createWeapon(kind, seed, 'dwarf');
      w.scale.setScalar(0.55 * s);
      const hold = new THREE.Group();
      hold.add(w);
      hold.position.set(0.05 * s, ctx.P.j.chest[1] + 0.02 * s, -0.17 * s * ctx.P.build.chest * Math.sqrt(ctx.P.build.bulk));
      hold.rotation.set(0.15, 0.2, 0.9);
      return hold;
    },
    { bone: 'chest', small: true },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 0: the bald, tattooed warrior
// ─────────────────────────────────────────────────────────────────────────────
function warrior(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const grey = 0x4a4741;
  // bald: paint the thin cap back to skin, then the swirling tattoos
  s.ellipsoid(P.h(0, 0.045, -0.055), [0.35 * u, 0.43 * u, 0.455 * u], { op: 'paint', color: 0xb98462, mat: 'skin_weathered', bone: 'head', k: 0.02 * u, strength: 1 });
  const ink = 0x1d2430;
  const strokes: [number, number][][] = [];
  const HALF = Math.PI / 2;
  // centre line front → crown → back
  strokes.push([[0, 0.55], [0, 0.95], [0, HALF], [Math.PI, HALF], [Math.PI, 0.95], [Math.PI, 0.5]]);
  for (const sd of [1, -1]) {
    // two arcs sweeping from the temple over the ear to the nape, joined by short rungs
    const arcA: [number, number][] = [];
    const arcB: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      const az = 0.5 + f * 2.4;
      arcA.push([sd * az, 0.22 + 0.42 * Math.sin(f * Math.PI)]);
      arcB.push([sd * (az + 0.05), 0.5 + 0.5 * Math.sin(f * Math.PI)]);
    }
    strokes.push(arcA, arcB);
    for (let i = 1; i < 12; i += 2) strokes.push([arcA[i], arcB[i]]);
    // a spiral behind the ear
    const sp: [number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const a2 = i * 0.62;
      const r = 0.3 - i * 0.017;
      sp.push([sd * (2.45 + Math.cos(a2) * r), 0.15 + Math.sin(a2) * r * 0.8]);
    }
    strokes.push(sp);
  }
  inkScalp(ctx, strokes, { color: ink, width: 0.016 });
  faceCommon(ctx, { brow: grey, blush: 0.4, scars: 2 }, rng);
  // forearm tattoo bands
  for (const sd of ['l', 'r'] as const) {
    const a = P.j[`forearm_${sd}`];
    const b = P.j[`hand_${sd}`];
    for (const f of [0.35, 0.5, 0.65]) paintRing(ctx, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2]], [a[0] + (b[0] - a[0]) * (f + 0.04), a[1] + (b[1] - a[1]) * (f + 0.04), a[2]], 0.04 * sc, { color: ink, bone: `forearm_${sd}`, mat: 'skin_weathered' });
  }
  // beard: iron grey, forked, two braids with clasps
  sculptBeardMass(ctx, { color: mix(grey, 0x000000, 0.3), color2: grey, length: 0.22 * sc, width: 1.0, fork: 1.0, fullness: 1.0 });
  const beard: BeardOpts = { clear: 0.05 * sc, color: grey, tip: 0x6a6660, deep: 0x24221f, length: 0.22 * sc, locks: 13, perLock: 7, shape: 'forked', spread: 1.0, wave: 0.5, width: 0.04, moustache: { length: 0.1 * sc, droop: 0.6, curl: 0.4 }, braids: [{ x: 0.08, length: 0.3 * sc, radius: 0.016 }, { x: -0.08, length: 0.3 * sc, radius: 0.016 }] };
  const br = addBeard(ctx, beard, rng);
  braidClasps(ctx, br.braidPaths, 0x9b7432);
  // mail sleeves + torso, a dark leather jerkin, a fur mantle and crossed straps
  sculptTorsoGarment(ctx, { color: MAIL, mat: 'mail', inflate: 0.0125 * sc, hem: 0.12, sleeve: 1.0 });
  sculptTorsoGarment(ctx, { color: 0x2c231d, mat: 'leather_worn', inflate: 0.02 * sc, hem: 0.02, sleeve: 0 });
  sculptFurMantle(ctx, { color: 0x3a3028, color2: 0x1e1814, thick: 0.034, drop: 0.07 });
  sculptStrap(ctx, { color: 0x4a3524, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.03 * sc, sign: 1 });
  placket(ctx, { y0: P.j.chest[1] - 0.12 * sc, y1: P.j.chest[1] + 0.12 * sc, inflate: 0.02 * sc, color: 0x14100c, lace: true });
  // single heavy pauldron on the left shoulder and a steel bracer
  const sh = P.j.upperarm_l;
  for (let k = 0; k < 2; k++) {
    const R = (0.098 - k * 0.006) * sc * 1.2 * Math.sqrt(P.build.bulk);
    const m = new THREE.Matrix4().makeTranslation(sh[0] + 0.02 * sc, sh[1] + (0.04 - k * 0.032) * sc, sh[2]).multiply(new THREE.Matrix4().makeRotationZ(-(0.62 + k * 0.1)));
    put(ctx, shell(R, R * 0.75, R * 1.05, { th0: 0, th1: Math.PI * (0.4 - k * 0.03), w: 12, h: 5 }), { bone: 'upperarm_l', color: 0x5a5b5e, mat: STEEL, matrix: m });
  }
  const sg = studs([[sh[0] + 0.06 * sc, sh[1] + 0.07 * sc, sh[2] + 0.03 * sc], [sh[0] + 0.06 * sc, sh[1] + 0.07 * sc, sh[2] - 0.03 * sc]], 0.008 * sc);
  if (sg) put(ctx, sg, { bone: 'upperarm_l', color: 0x9b7432, mat: 'gold', small: true });
  put(ctx, spike([sh[0] + 0.05 * sc, sh[1] + 0.085 * sc, sh[2]], [0.35, 1, 0], 0.06 * sc, 0.013 * sc, 6), { bone: 'upperarm_l', color: 0x5a5b5e, mat: STEEL, small: true });
  beltBuckle(ctx, 0x8a6a30);
  pouch(ctx, 1, 0x2c231d);
  backWeapon(ctx, 'warhammer', 3);
  if (ctx.spec.helmet === true) domeHelm(ctx, { color: 0x55565a, trim: 0x6a5a3a, profile: DOME_ROUND, finial: 'ball', cheeks: true, nasal: true, rivets: 22, neck: 'mail' });
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 1: the floppy-hat dwarf with the braided moustache
// ─────────────────────────────────────────────────────────────────────────────
function jester(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const ginger = 0x7e4a22;
  sculptHairCap(s, P, { style: 'short', color: ginger, tipColor: 0x9a6030, length: 1, density: 1 });
  addHairdo(ctx, { color: ginger, tip: 0x9a6030, deep: 0x4a2a14, length: 0.22 * sc, count: 85, width: 0.034, wave: 0.6, wild: 0.4, comb: 0.5, front: 0.1, back: -0.45, gravity: 6, maxY: 0.08 }, rng);
  faceCommon(ctx, { brow: 0x5a3416, blush: 0.65 }, rng);
  // two thick side braids with beads, a short goatee and a long curled moustache
  const h = P.h;
  const braids: { x: number; len: number }[] = [{ x: 1, len: 0.34 }, { x: -1, len: 0.34 }];
  const geoBraids: THREE.BufferGeometry[] = [];
  void geoBraids;
  sculptBeardMass(ctx, { color: mix(ginger, 0x000000, 0.2), color2: ginger, length: 0.1 * sc, width: 0.95, fullness: 0.75 });
  const beard: BeardOpts = {
    clear: 0.03 * sc,
    color: ginger, tip: 0x9a6030, deep: 0x4a2a14, length: 0.11 * sc, locks: 11, perLock: 6, shape: 'goatee', spread: 0.9, cheeks: true, wave: 0.8, width: 0.04,
    moustache: { length: 0.2 * sc, droop: 0.9, curl: 1.4 },
    braids: [{ x: 0.2, y: -0.34, length: 0.2 * sc, radius: 0.016 }, { x: -0.2, y: -0.34, length: 0.2 * sc, radius: 0.016 }],
  };
  const br = addBeard(ctx, beard, rng);
  braidClasps(ctx, br.braidPaths, 0x9b7432);
  void h;
  void braids;
  floppyHat(ctx, { color: 0x6b4e2e, color2: 0x8a6a40, crown: 0.7, brim: 0.62, droop: 0.16, lean: 0.4, point: 0.7, seed: 2, y: 0.16 });
  // ochre jerkin over the brown tunic, striped scarf, straps
  sculptTorsoGarment(ctx, { color: 0x8a7236, mat: 'wool', inflate: 0.018 * sc, hem: 0.05, sleeve: 0 });
  placket(ctx, { y0: P.j.chest[1] - 0.2 * sc, y1: P.j.chest[1] + 0.1 * sc, inflate: 0.018 * sc, color: 0x4a3a1a, buttons: 5, buttonColor: 0x5a3a1c });
  sculptScarf(ctx, { color: 0x9a3a2a, color2: 0x2a2a30, tail: 0.14 * sc });
  sculptStrap(ctx, { color: 0x4a3524, mat: 'leather_worn', width: 0.035 * sc, inflate: 0.026 * sc, sign: -1 });
  beltBuckle(ctx, 0x8a6a30);
  pouch(ctx, -1, 0x4a3524);
  backWeapon(ctx, 'axe', 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 2: the white-bearded elder with braids
// ─────────────────────────────────────────────────────────────────────────────
function elder(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const white = 0xd8d2c4;
  sculptHairCap(s, P, { style: 'long_wavy', color: white, tipColor: 0xf0ece2, length: 1, density: 1 });
  addHairdo(ctx, { color: white, tip: 0xf2eee4, deep: 0xa8a294, length: 0.5 * sc, count: 80, width: 0.05, wave: 0.7, wild: 0.2, comb: 1.0, front: 0.12, back: -0.4, gravity: 5, tail: 0 }, rng);
  faceCommon(ctx, { brow: 0xb8b2a4, blush: 0.5 }, rng);
  sculptBeardMass(ctx, { color: mix(white, 0x000000, 0.35), color2: 0x9a9488, length: 0.4 * sc, width: 1.05, fullness: 1.1 });
  const beard: BeardOpts = {
    clear: 0.05 * sc,
    color: white, tip: 0xf2eee4, deep: 0x9a9488, length: 0.4 * sc, locks: 14, perLock: 7, shape: 'spade', spread: 1.05, cheeks: true, wave: 0.6, width: 0.042,
    moustache: { length: 0.13 * sc, droop: 0.7, curl: 0.4 },
    braids: [{ x: 0.1, length: 0.5 * sc, radius: 0.017 }, { x: 0, length: 0.55 * sc, radius: 0.017 }, { x: -0.1, length: 0.5 * sc, radius: 0.017 }],
  };
  const br = addBeard(ctx, beard, rng);
  braidClasps(ctx, br.braidPaths, 0xa88a48);
  // deep red coat with long sleeves and a pale fur collar
  sculptTorsoGarment(ctx, { color: 0x6a2a24, mat: 'wool', inflate: 0.017 * sc, hem: 0.3, sleeve: 1.4, color2: 0x4a1c18 });
  placket(ctx, { y0: P.j.chest[1] - 0.3 * sc, y1: P.j.chest[1] + 0.05 * sc, inflate: 0.017 * sc, color: 0x3a1410, buttons: 6, buttonColor: 0xa88a48, width: 0.006 });
  sculptFurMantle(ctx, { color: 0xb5ad9c, color2: 0x8a8272, thick: 0.03, drop: 0.05, amp: 0.012 });
  sculptStrap(ctx, { color: 0x3a2a1c, mat: 'leather_worn', width: 0.032 * sc, inflate: 0.032 * sc, sign: 1 });
  beltBuckle(ctx, 0xa88a48);
  pouch(ctx, 1, 0x3a2a1c);
  pouch(ctx, -1, 0x3a2a1c, -0.02 * sc);
  if (ctx.spec.helmet === true) domeHelm(ctx, { color: 0x6a6a6e, trim: 0xa88a48, profile: DOME_ROUND, finial: 'ball', cheeks: true, rivets: 22 });
}

// ─────────────────────────────────────────────────────────────────────────────
// bucket 3: the huge red beard
// ─────────────────────────────────────────────────────────────────────────────
function redbeard(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const red = 0x8e3418;
  sculptHairCap(s, P, { style: 'wild', color: red, tipColor: 0xc8602c, length: 1, density: 1 });
  addHairdo(ctx, { color: red, tip: 0xae5226, deep: 0x4a1a0c, length: 0.45 * sc, count: 90, width: 0.05, wave: 1.0, wild: 0.6, comb: 0.7, front: 0.12, back: -0.4, gravity: 4 }, rng);
  faceCommon(ctx, { brow: 0x7a2a12, blush: 0.75, scars: 1 }, rng);
  sculptBeardMass(ctx, { color: mix(red, 0x000000, 0.35), color2: red, length: 0.42 * sc, width: 1.2, fullness: 1.4 });
  const beard: BeardOpts = {
    clear: 0.05 * sc,
    color: red, tip: 0xae5226, deep: 0x4a1a0c, length: 0.42 * sc, locks: 15, perLock: 8, shape: 'round', spread: 1.2, cheeks: true, wave: 0.9, width: 0.048,
    moustache: { length: 0.16 * sc, droop: 0.6, curl: 0.8 },
    braids: [{ x: 0.15, y: -0.5, length: 0.3 * sc, radius: 0.018 }, { x: -0.15, y: -0.5, length: 0.3 * sc, radius: 0.018 }],
  };
  const br = addBeard(ctx, beard, rng);
  braidClasps(ctx, br.braidPaths, 0x9b7432);
  sculptTorsoGarment(ctx, { color: 0x8c4a22, mat: 'wool', inflate: 0.017 * sc, hem: 0.18, sleeve: 0.9 });
  sculptTorsoGarment(ctx, { color: 0x3a281c, mat: 'leather_worn', inflate: 0.023 * sc, hem: 0.02, sleeve: 0 });
  sculptFurMantle(ctx, { color: 0x6a4a2a, color2: 0x3a2a1a, thick: 0.034, drop: 0.08 });
  sculptStrap(ctx, { color: 0x2c1e14, mat: 'leather_worn', width: 0.04 * sc, inflate: 0.034 * sc, sign: -1 });
  placket(ctx, { y0: P.j.chest[1] - 0.15 * sc, y1: P.j.chest[1] + 0.1 * sc, inflate: 0.024 * sc, color: 0x14100c, lace: true });
  beltBuckle(ctx, 0x9b7432);
  pouch(ctx, 1, 0x2c1e14);
  backWeapon(ctx, 'axe', 1);
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
  height: 1.4,
  build: { shoulders: 1.36, hips: 1.1, bulk: 1.26, belly: 0.15, chest: 1.32, armLength: 0.95, legLength: 0.8, headSize: 1.3, neck: 0.4, neckThick: 1.4, handSize: 1.3, footSize: 1.12, muscle: 0.5 },
  face: {
    jaw: 1.2, jawLength: 0.95, chin: 0.9, brow: 1.9, cheekbones: 1.2,
    nose: { length: 1.15, width: 1.45, bridge: 1.1, hook: 0.2, tip: 1.35 },
    lips: { width: 1.0, fullness: 0.85 }, ears: 'round', earSize: 1.0, eyeSize: 0.86, eyeOpen: 0.62, eyeSpacing: 0.97, eyeTilt: -0.03, foreheadSlope: 0.1, asym: 0.15,
  },
  skin: { color: 0xbd7a58, color2: 0x9c5240, blotch: 0.45, blemish: 0.2, scars: 1, wrinkles: 0.55, lips: 0xa85c52, surface: 'skin_weathered', scatter: 0xd0503a },
  eyes: { color: 0x3a2a1c, sclera: 0xbcaa96 },
  // chain bones only: the visible hair and beard are grown per seed bucket in extras (see hair.ts)
  hair: { style: 'stringy', color: 0xb98462, density: 0 },
  beard: { style: 'stubble', color: 0x5a3a24, length: 0.08 },
  outfit: [
    { type: 'trousers', color: 0x4a3c2e },
    { type: 'boots', color: 0x33261a, color2: 0x4a3626, length: 0.9 },
    { type: 'tunic', color: 0x5a4632, color2: 0x4a3828, length: 0.4 },
    { type: 'belt', color: 0x2c1e14 },
    { type: 'bracers', color: 0x4a3222, color2: 0x2c1e14 },
  ],
  armor: [],
  weapons: { right: 'axe', style: 'dwarf' },
  anim: { swagger: 0.5, aggression: 0.5, stance: 1.2, cadence: 1.05 },
  variation: { height: 0.04, bulk: 0.1, skin: 0.14 },
  detail: { res: devNum('res', 0.05), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.3 },
  sfx: { voice: 'dwarf', weight: 0.7 },
  extras: dwarfExtras,
};

void paintBlob;
void hairMaterial;
