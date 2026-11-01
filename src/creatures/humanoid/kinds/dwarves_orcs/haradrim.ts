/**
 * Men of Harad (docs/refs/haradrim): a red open-fronted coat with embroidered borders and short
 * wide sleeves over black long sleeves, a black tunic with a hanging panel, a wide leather belt with
 * a gilt boss and a red sash with a tail, baggy black trousers gathered into soft boots, a red
 * turban whose tails wrap the neck and chest, white war paint on a dark warm face, a short black
 * beard and gold jewellery. Four looks across the seed buckets share the dress: red turban with
 * cowl (the sheet), braided and face-painted, bronze helm with plume, black head-wrap raider.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { sculptHairCap } from '../../hairstyles';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import type { KindContext, KindDef } from '../../types';
import type { V3 } from '../../../kit/sdf';
import { surface } from '../../../kit/surfaces';
import { put, studs } from './armor';
import { ctxBucket, devNum, recipeRng } from './common';
import { sculptBand, slab, limbCutBefore } from './garments';
import { addHairdo, withHair } from './hair';
import { DOME_ROUND, domeHelm } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { GILT, WOVEN, addSkirtCloth, cowl, forearmBand, jewelry, layeredPauldrons, plume, surfaceMatrix } from './menparts';
import { makeProjector, snapPoint, V } from '../uruks_bosses/common';

/** sRGB albedos from docs/refs/haradrim/spec.json (outfit_layers, face, hair), cross-checked with the lit samples */
const PALETTE = {
  // design headwrap #852d2a / red_coat #8d302a, lit samples #632020 / #642524: the albedo is deeper and less orange than the hex
  red: 0x6c1f1c,
  redDeep: 0x45120f,
  border: 0x2a0e0c, // black embroidery on the coat borders
  black: 0x131214, // black_tunic #292725 (lit #2e2b2c), trousers #232325
  leather: 0x4a3828, // leather_belt #584331 (lit #2c1713)
  boots: 0x3d3029, // boots #332a23 (lit #342d2a)
  gold: 0xb58d3d, // gold_jewellery #b58d3d
  iron: 0x77756a, // belt_iron_fittings #777568
  // skin_base #8a5e43, lit #75462f: warm and a touch deeper than the hex
  skin: 0x57341f,
  skin2: 0x482a1a,
  iris: 0x392b1e,
  brows: 0x1c1410,
  beard: 0x15110e, // black beard (hair #2a231b, lit #342d2a)
  paint: 0xe6dfd0, // white strokes
};

const RED_COAT = surface('cloth', { rough: 0.9, sheen: 0.3, pat: { weave: 1.3, wrinkles: 0.15 } });
const BLACK_CLOTH = surface('twill', { rough: 0.95, sheen: 0.08 });
const LEATHER = surface('leather_worn', { rough: 0.72, pat: { leather: 1.1, scratches: 0.5 } });
const BOOT = surface('leather_worn', { rough: 0.62, sheen: 0.14, pat: { leather: 1.1, scratches: 0.7, wrinkles: 0.5 } });

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];

interface Look {
  coat: number;
  coatDeep: number;
  trim: number;
  head: 'turban' | 'braided' | 'helm' | 'wrap';
}
const LOOKS: Look[] = [
  { coat: PALETTE.red, coatDeep: PALETTE.redDeep, trim: PALETTE.border, head: 'turban' },
  { coat: 0x5a1a16, coatDeep: 0x38100d, trim: PALETTE.border, head: 'braided' },
  { coat: 0x6a2420, coatDeep: 0x45140f, trim: 0x2a1410, head: 'helm' },
  { coat: 0x3e1613, coatDeep: 0x240c0a, trim: 0x140807, head: 'wrap' },
];

function browsAndFace(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: PALETTE.brows, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.8 }));
}

/** sheet war paint: a forehead line with a diamond and a chevron on each cheek */
function sheetPaint(ctx: KindContext) {
  const o = { color: PALETTE.paint, mat: 'skin' as const, strength: 0.95 };
  faceStroke(ctx, [[0, 0.3], [0, 0.0]], { ...o, r: 0.026 });
  faceStroke(ctx, [[0, 0.24], [0.045, 0.19], [0, 0.14], [-0.045, 0.19], [0, 0.24]], { ...o, r: 0.026 });
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.33, 0.0], [sd * 0.2, -0.1], [sd * 0.32, -0.22]], { ...o, r: 0.038 });
    faceStroke(ctx, [[sd * 0.26, -0.3], [sd * 0.22, -0.36]], { ...o, r: 0.03 });
  }
}

/** the short black beard (jaw, chin, sideburns) and moustache, sculpted: hair cards read pale and stringy at crowd distance */
function shortBeard(ctx: KindContext, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  void rng;
  const h = P.h;
  s.with({ color: PALETTE.beard, color2: 0x2a2420, colorNoise: 0.5, colorFreq: 40 / sc, mat: 'hair', bone: 'jaw' }, () => {
    s.group('union', 0.02 * u, () => {
      s.ellipsoid(h(0, -0.5, 0.16), [0.27 * u, 0.13 * u, 0.28 * u], { k: 0.03 * u });
      for (const sd of [1, -1]) s.ellipsoid(h(sd * 0.25, -0.3, 0.1), [0.06 * u, 0.17 * u, 0.2 * u], { k: 0.03 * u });
      for (const sd of [1, -1]) s.cone(h(sd * 0.015, -0.3, 0.425), h(sd * 0.15, -0.38, 0.36), 0.04 * u, 0.028 * u, { k: 0.03 * u });
    });
  });
}

/** a big wrapped turban: a tall cap with stacked bands, sculpted into the body */
function turban(ctx: KindContext, o: { color: number; color2: number; y?: number; tall?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const y0 = o.y ?? 0.2;
  const tall = o.tall ?? 1;
  s.with({ color: o.color, color2: o.color2, colorNoise: 0.55, colorFreq: 20 / P.s, mat: RED_COAT, bone: 'head', noise: { amp: 0.0035 * P.s, freq: 36 / P.s, type: 'ridged', octaves: 2 } }, () => {
    s.group('union', 0.012 * u, () => {
      s.ellipsoid(P.h(0, y0 + 0.2 * tall, -0.07), [0.46 * u, 0.4 * u * tall, 0.53 * u], { k: 0.03 * u });
      for (let i = 0; i < 4; i++) {
        const f = i / 3;
        s.torus(P.h(0, y0 + 0.04 + f * 0.3 * tall, -0.07 - f * 0.01), 0.37 * u * (1 - f * 0.1), 0.08 * u * (1 - f * 0.15), { k: 0.02 * u, rot: [-0.18 + f * 0.1 + (i % 2 ? 0.08 : -0.06), 0, i % 2 ? 0.1 : -0.08] });
      }
    });
    // keep the face open
    s.ellipsoid(P.h(0, -0.1, 0.5), [0.33 * u, 0.3 * u, 0.3 * u], { op: 'subtract', k: 0.03 * u });
  });
}

/** the turban's tails: falling beside the face, wrapped round the neck and crossing the chest, and a tail down the back */
function turbanTails(ctx: KindContext, color: number, color2: number) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const j = P.j;
  const cy = j.chest[1];
  s.with({ color, color2, colorNoise: 0.5, colorFreq: 22 / sc, mat: RED_COAT, noise: { amp: 0.0035 * sc, freq: 30 / sc, type: 'ridged', octaves: 2 } }, () => {
    for (const sd of [1, -1]) {
      // from the temple down beside the cheek and over the collarbone
      s.cone(P.h(sd * 0.4, 0.05, 0.02), P.h(sd * 0.43, -0.75, 0.0), 0.075 * u, 0.065 * u, { bone: 'head', bone2: 'neck', blend: [0.3, 1], k: 0.04 * u });
      s.cone(P.h(sd * 0.43, -0.75, 0.0), [sd * 0.125 * sc, cy + 0.17 * sc, 0.075 * sc], 0.065 * u, 0.03 * sc, { bone: 'neck', bone2: 'chest', blend: [0, 1], k: 0.03 * sc });
      // across the chest to the opposite lower breast
      s.cone([sd * 0.125 * sc, cy + 0.17 * sc, 0.082 * sc], [-sd * 0.045 * sc, cy + 0.02 * sc, 0.105 * sc], 0.034 * sc, 0.026 * sc, { bone: 'chest', k: 0.02 * sc });
    }
    // the back tail from the nape down between the shoulder blades
    s.cone(P.h(0, -0.25, -0.45), [0, cy + 0.05 * sc, -0.115 * sc], 0.15 * u, 0.1 * u, { bone: 'head', bone2: 'chest', blend: [0.2, 0.9], k: 0.05 * u });
  });
}

/** black tunic panel, red sash tail, the red open coat's tails and the border strips (one skinned sheet) */
function clothSheets(ctx: KindContext, look: Look, bottom: number, top: number) {
  const { P } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const flare = 0.17 * sc;
  const grow = 0.011 * sc;
  const borders = (phase: number) => ({ count: 2, color: look.trim, color2: look.trim, mat: RED_COAT, width: 0.062 * sc, length: 1, phase });
  addSkirtCloth(ctx, [
    // coat tails, open at the front
    { color: look.coat, color2: look.coatDeep, mat: RED_COAT, top, bottom, flare, grow, panels: [[0.56, 5.72]], strips: borders(0.64), name: 'coat' },
    { color: look.coat, mat: RED_COAT, top, bottom, flare, grow, panels: [], strips: borders(-0.64) },
    // the black tunic's hanging panel with the red sash tail over it
    { color: PALETTE.black, color2: 0x1c1a1d, mat: BLACK_CLOTH, top, bottom: 0.38 * k, flare: 0.05 * sc, panels: [[-0.5, 0.5]], strips: { count: 1, color: look.coat, color2: look.coatDeep, mat: RED_COAT, width: 0.075 * sc, length: 0.56, phase: 0.28 } },
  ]);
}

function coat(ctx: KindContext, look: Look) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  const hemY = 0.86 * k;
  const opts = { color: look.coat, color2: look.coatDeep, colorNoise: 0.4, colorFreq: 34 / sc, mat: RED_COAT };
  s.group('union', 0.0035 * sc, () => {
    s.group('union', 0, () => {
      emitParts(s, parts, [...TORSO, 'neck', 'deltoid'], { ...opts, inflate: 0.016 * sc });
      slab(s, hemY, P.j.neck[1] + 0.05 * sc, 0.008 * sc);
      // the front is open: the black tunic and the sash show between the lapels
      s.box([0, (hemY + 1.62 * k) / 2, 0.19 * sc], [0.046 * sc, (1.62 * k - hemY) / 2, 0.13 * sc], 0.002 * sc, { op: 'subtract', k: 0.008 * sc });
      // the embroidered borders run down both sides of the opening and either side of the back
      for (const sx of [1, -1]) {
        s.box([sx * 0.082 * sc, (hemY + 1.55 * k) / 2, 0], [0.026 * sc, (1.55 * k - hemY) / 2, 0.3 * sc], 0.002 * sc, { op: 'paint', color: look.trim, mat: RED_COAT, strength: 0.85, k: 0.004 * sc });
      }
    });
    // short wide sleeves to the elbow
    s.mirrored(() =>
      s.group('union', 0.004 * sc, () => {
        emitParts(s, parts, ['upperarm'], { ...opts, inflate: 0.022 * sc, oneSide: true });
        const sh = P.j.upperarm_l;
        limbCutBefore(s, L, [sh[0] + L.x * P.upperArm * 0.97, sh[1] + L.y * P.upperArm * 0.97, sh[2]], 0.006 * sc);
        const d = L.x * (sh[0] + L.x * P.upperArm * 0.97) + L.y * (sh[1] + L.y * P.upperArm * 0.97);
        s.plane([L.x, L.y, L.z], d, { op: 'paint', seam: 0, k: 0.002 });
      }),
    );
  });
}

function dress(ctx: KindContext, look: Look) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const hipY = P.j.thigh_l[1];
  const parts = anatomyParts(P);
  const A = ctx.armor;
  // baggy trousers: the legs blown out above the boot tops
  s.group('union', 0.012 * sc, () => {
    emitParts(s, parts, ['thigh', 'knee', 'shin', 'calf'], { color: PALETTE.black, color2: 0x1c1a1d, colorNoise: 0.35, colorFreq: 30 / sc, mat: BLACK_CLOTH, inflate: 0.024 * sc, k: 0.04 * sc });
    s.plane([0, -1, 0], -0.32 * k, { op: 'intersect', k: 0.02 * sc });
    s.plane([0, 1, 0], hipY - 0.02 * sc, { op: 'intersect', k: 0.02 * sc });
  });
  coat(ctx, look);
  // wide leather belt (1.12-1.25 m), a red sash over it and the iron fittings
  sculptBand(ctx, { color: PALETTE.leather, mat: LEATHER, y0: 1.12 * k, y1: 1.24 * k, inflate: 0.034 * sc, k: 0.002 * sc });
  s.group('union', 0.002 * sc, () => {
    sculptBand(ctx, { color: look.coat, mat: RED_COAT, y0: 1.245 * k, y1: 1.325 * k, inflate: 0.036 * sc, k: 0.004 * sc });
  });
  const top = hipY + 0.035 * sc;
  clothSheets(ctx, look, 0.25 * k, top);
  // gold wrist cuffs over the black sleeves
  forearmBand(ctx, { t0: 0.8, t1: 0.95, color: PALETTE.gold, mat: GILT, inflate: 0.0105 * sc, seam: false });
  if (A >= 0.5 && look.head === 'helm') layeredPauldrons(ctx, { color: 0x3a2418, trim: PALETTE.gold, mat: 'leather_worn', trimMat: GILT, layers: 2, size: 1.0, sides: ['r'] });
}

/** fittings snapped onto the finished sculpt: belt boss and ring, the necklace and pendant (call last) */
function fittings(ctx: KindContext, look: Look, necklace: boolean) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const proj = makeProjector(s, { min: [-0.4 * sc, 0.9 * k, -0.3 * sc], max: [0.4 * sc, 1.75 * k, 0.4 * sc] });
  if (!proj) return;
  const boss = surfaceMatrix(proj, 0, 1.185 * k, 0.003 * sc);
  if (boss) {
    put(ctx, new THREE.CylinderGeometry(0.036 * sc, 0.038 * sc, 0.008 * sc, 14), { bone: 'spine', color: PALETTE.gold, mat: GILT, matrix: boss, small: true });
    put(ctx, new THREE.TorusGeometry(0.031 * sc, 0.0035 * sc, 4, 14).rotateX(Math.PI / 2).translate(0, 0.006 * sc, 0), { bone: 'spine', color: PALETTE.gold, mat: GILT, matrix: boss, small: true });
    put(ctx, new THREE.SphereGeometry(0.014 * sc, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.004 * sc, 0), { bone: 'spine', color: PALETTE.gold, mat: GILT, matrix: boss, small: true });
  }
  // an iron ring hung on the belt at the right hip
  const rm = surfaceMatrix(proj, -0.09 * sc, 1.17 * k, 0.004 * sc);
  if (rm) put(ctx, new THREE.TorusGeometry(0.014 * sc, 0.0028 * sc, 4, 10), { bone: 'spine', color: PALETTE.iron, mat: 'metal', matrix: rm, small: true });
  if (necklace) {
    // a beaded gold necklace in a V on the chest with a round pendant (sheet: over the black tunic)
    const hp = V();
    const hn = V();
    const beads: V3[] = [];
    const cy = P.j.neck[1];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = (1 - t) * 0.075 * sc;
      for (const sd of [1, -1]) {
        if (i === 8 && sd === -1) continue;
        const y = cy + 0.02 * sc - (1 - Math.pow(1 - t, 2)) * 0.1 * sc;
        if (snapPoint(proj, [sd * x, y, 0.4], 'f', hp, hn)) beads.push([hp.x + hn.x * 0.003, hp.y + hn.y * 0.003, hp.z + hn.z * 0.003]);
      }
    }
    const bg = studs(beads, 0.0075 * sc, 0.9);
    if (bg) put(ctx, bg, { bone: 'chest', color: PALETTE.gold, mat: GILT, small: true });
    const pm = surfaceMatrix(proj, 0, cy - 0.095 * sc, 0.004 * sc);
    if (pm) put(ctx, new THREE.CylinderGeometry(0.019 * sc, 0.02 * sc, 0.005 * sc, 12), { bone: 'chest', color: PALETTE.gold, mat: GILT, matrix: pm, small: true });
  }
  void look;
}

function head(ctx: KindContext, look: Look, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const A = ctx.armor;
  browsAndFace(ctx);
  switch (look.head) {
    case 'turban':
      turban(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, tall: 0.85 });
      turbanTails(ctx, PALETTE.red, PALETTE.redDeep);
      cowl(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, mat: RED_COAT, rings: 2, thick: 0.03, lift: 0.05 });
      sheetPaint(ctx);
      shortBeard(ctx, rng);
      jewelry(ctx, { color: PALETTE.gold, ears: true });
      break;
    case 'braided': {
      sculptHairCap(s, P, { style: 'short', color: 0x0e0a08, length: 1, density: 1 });
      addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.4 * sc, count: 70, width: 0.03, wave: 0.9, wild: 0.6, comb: 0.8, front: 0.24, back: -0.4, gravity: 5, tail: 0.3 * sc, segments: 5 }, rng);
      for (const sd of [1, -1]) {
        faceStroke(ctx, [[sd * 0.33, 0.0], [sd * 0.2, -0.1], [sd * 0.32, -0.22]], { color: PALETTE.paint, r: 0.036, mat: 'skin', strength: 1 });
        faceStroke(ctx, [[sd * 0.2, 0.08], [sd * 0.1, 0.04]], { color: 0x8a2018, r: 0.03, mat: 'skin', strength: 1 });
      }
      faceStroke(ctx, [[0, 0.22], [0, -0.05]], { color: PALETTE.paint, r: 0.026, mat: 'skin', strength: 0.95 });
      scalpStroke(ctx, [[0, 0.5], [0, 1.0]], { color: PALETTE.paint, r: 0.01 });
      shortBeard(ctx, rng);
      jewelry(ctx, { color: PALETTE.gold, neck: true, ears: true });
      cowl(ctx, { color: look.coat, color2: look.coatDeep, mat: RED_COAT, rings: 2, thick: 0.026, lift: 0.04 });
      break;
    }
    case 'helm': {
      addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.16 * sc, count: ctx.helmet ? 15 : 50, width: 0.028, wave: 0.3, wild: 0.2, comb: 0.9, front: 0.24, back: -0.4, gravity: 4, segments: 4 }, rng);
      shortBeard(ctx, rng);
      cowl(ctx, { color: look.coat, color2: look.coatDeep, mat: RED_COAT, rings: 2, thick: 0.028, lift: 0.04 });
      jewelry(ctx, { color: PALETTE.gold, neck: true });
      if (ctx.helmet) {
        domeHelm(ctx, { color: 0x9a7a38, trim: PALETTE.gold, mat: GILT, trimMat: GILT, profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'mail', tilt: -0.08 });
        plume(ctx, { color: PALETTE.red, y: 0.52, length: 0.7, n: 5 });
      }
      break;
    }
    default: {
      turban(ctx, { color: 0x1c1818, color2: 0x2e2220, y: 0.1, tall: 0.9 });
      turbanTails(ctx, 0x1c1818, 0x2e2220);
      for (const sd of [1, -1]) {
        faceStroke(ctx, [[sd * 0.28, -0.14], [sd * 0.1, -0.16]], { color: PALETTE.paint, r: 0.03, mat: 'skin', strength: 1 });
        faceStroke(ctx, [[sd * 0.22, -0.22], [sd * 0.08, -0.24]], { color: PALETTE.paint, r: 0.026, mat: 'skin', strength: 0.95 });
      }
      cowl(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, mat: RED_COAT, rings: 2, thick: 0.03, lift: 0.04 });
      shortBeard(ctx, rng);
      jewelry(ctx, { color: PALETTE.gold, neck: true });
    }
  }
  void A;
  void u;
}

export function haradrimExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const rng = recipeRng(ctx, 'haradrim');
    const look = LOOKS[ctxBucket(ctx)] ?? LOOKS[0];
    head(ctx, look, rng);
    dress(ctx, look);
    fittings(ctx, look, look.head === 'turban' || look.head === 'helm');
  });
}

export const haradrimDef: KindDef = {
  label: 'Haradrim',
  // sheet silhouette 1.93 m with the turban on (the head top is ~1.88 m)
  height: 1.88,
  build: { shoulders: 1.0, hips: 0.98, bulk: 0.96, chest: 1.0, muscle: 0.5, footSize: 0.92 },
  face: { jaw: 0.95, chin: 1.0, brow: 1.52, cheekbones: 1.1, nose: { length: 1.05, width: 1.0, bridge: 1.05, hook: 0.1 }, eyeTilt: 0.04, eyeOpen: 0.9 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.3, wrinkles: 0.2, surface: 'skin_weathered', scatter: 0xa04a30, brows: PALETTE.brows },
  eyes: { color: PALETTE.iris, sclera: 0xe2d8c8 },
  hair: { style: 'stringy', color: 0x2a231b, density: 0 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PALETTE.black, mat: BLACK_CLOTH },
    { type: 'boots', color: PALETTE.boots, color2: 0x241a12, length: 0.5, mat: BOOT },
    // black long sleeves; the red coat and the panel hems are cloth sheets / sculpted in `dress`
    { type: 'tunic', color: PALETTE.black, mat: BLACK_CLOTH, length: 0 },
    { type: 'skirt', color: PALETTE.red, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'scimitar', style: 'haradrim' },
  anim: { swagger: 0.3, aggression: 0.55, stance: 1.05 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.14 },
  detail: { res: devNum('res', 0.055), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'man', weight: 0.5 },
  extras: haradrimExtras,
};

void WOVEN;
