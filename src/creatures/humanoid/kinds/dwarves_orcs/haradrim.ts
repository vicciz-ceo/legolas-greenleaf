/**
 * Men of Harad (docs/refs/haradrim): a red open-fronted coat with dark embroidered borders and short wide sleeves over
 * black long sleeves, a black tunic panel with a red sash tail, a wide leather belt with a gilt boss, baggy black
 * trousers gathered into tall soft boots, a red turban whose scarf crosses the collarbones, white war paint on a dark
 * warm face, a short black beard and gold jewellery. Four looks across the seed buckets share the dress: red turban
 * with cowl (the sheet), braided and face-painted, bronze helm with plume, black head-wrap raider.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { surface } from '../../../kit/surfaces';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { makeProjector, snapPoint, V } from '../uruks_bosses/common';
import { put, studs } from './armor';
import { ctxBucket, devNum, recipeRng } from './common';
import { limbCutBefore, sculptBand, slab } from './garments';
import { addHairdo, withHair } from './hair';
import { DOME_ROUND, domeHelm } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { GILT, addClothSheets, cowl, forearmBand, jewelry, layeredPauldrons, plume, surfaceMatrix, type SheetCol, type SheetOpts } from './menparts';

/** sRGB albedos from docs/refs/haradrim/spec.json (outfit_layers, face, hair), cross-checked with the lit samples */
const PALETTE = {
  // headwrap #852d2a / red_coat #8d302a, lit samples #632020 / #642524: deeper and less orange than the hex
  red: 0x7a1c1c,
  redDeep: 0x4a1010,
  border: 0x1c0a09, // black embroidery on the coat borders
  black: 0x131214, // black_tunic #292725 (lit #2e2b2c), darker for the lab's light
  leather: 0x4a3828, // leather_belt #584331 (lit #2c1713)
  boots: 0x3d3029, // boots #332a23 (lit #342d2a)
  gold: 0xb58d3d, // gold_jewellery #b58d3d
  iron: 0x77756a, // belt_iron_fittings #777568
  // skin_base #8a5e43, lit #75462f: warm brown, not dark plastic
  skin: 0x70462d,
  skin2: 0x5e3a26,
  lips: 0x5a3226,
  iris: 0x392b1e,
  sclera: 0xcfc2b0, // dim warm eye whites
  brows: 0x1c1410,
  beard: 0x1c1917, // black beard (hair #2a231b, lit #342d2a): a matte dark grey-black
  paint: 0xc4b8a4, // white strokes, a little dimmed so they do not glare
};

const RED_COAT = surface('cloth', { rough: 0.9, sheen: 0.3, pat: { weave: 1.3, wrinkles: 0.15 } });
const BLACK_CLOTH = surface('twill', { rough: 0.95, sheen: 0.08 });
const LEATHER = surface('leather_worn', { rough: 0.72, pat: { leather: 1.1, scratches: 0.5 } });
const BOOT = surface('leather_worn', { rough: 0.62, sheen: 0.14, pat: { leather: 1.1, scratches: 0.7, wrinkles: 0.5 } });
const BEARD = surface('hair', { rough: 0.9, sheen: 0, pat: { fur: 0.15 } });
const HELM_LEATHER = surface('leather_worn', { rough: 0.7, pat: { leather: 1.1 } });

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];
/** half angle of the coat's front opening */
const OPEN = 0.75;

interface Look {
  coat: number;
  coatDeep: number;
  trim: number;
  head: 'turban' | 'braided' | 'helm' | 'wrap';
}
const LOOKS: Look[] = [
  { coat: PALETTE.red, coatDeep: PALETTE.redDeep, trim: PALETTE.border, head: 'turban' },
  { coat: 0x5e1816, coatDeep: 0x38100d, trim: PALETTE.border, head: 'braided' },
  { coat: 0x6a2420, coatDeep: 0x45140f, trim: 0x2a1410, head: 'helm' },
  { coat: 0x3e1613, coatDeep: 0x240c0a, trim: 0x140807, head: 'wrap' },
];

function browsAndFace(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: PALETTE.brows, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.8 }));
}

/** war paint as thin soft strokes (anything thinner than the head mesh cell would vanish; anything stronger leaves white specks) */
function paintStrokes(ctx: KindContext, strokes: [number, number][][], r: number) {
  for (const st of strokes) faceStroke(ctx, st, { color: PALETTE.paint, r, mat: 'skin', strength: 0.5 });
}

/** the sheet's paint: a short brow line and a chevron on each cheek (the forehead diamond sits under the turban) */
function sheetPaint(ctx: KindContext) {
  const strokes: [number, number][][] = [[[0, 0.12], [0, 0.0]]];
  for (const sd of [1, -1]) strokes.push([[sd * 0.33, 0.0], [sd * 0.2, -0.1], [sd * 0.32, -0.22]], [[sd * 0.26, -0.3], [sd * 0.22, -0.36]]);
  paintStrokes(ctx, strokes, 0.016);
}

/** the short black beard (jaw, chin, sideburns) and a moustache over the mouth, sculpted: hair cards read pale and stringy at crowd distance */
function shortBeard(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const h = P.h;
  s.with({ color: PALETTE.beard, mat: BEARD, bone: 'jaw' }, () => {
    s.group('union', 0.02 * u, () => {
      s.ellipsoid(h(0, -0.46, 0.15), [0.285 * u, 0.17 * u, 0.29 * u], { k: 0.03 * u });
      // the moustache sits on the upper lip and the beard rises to the lower lip: the mouth is closed
      s.ellipsoid(h(0, -0.385, 0.415), [0.15 * u, 0.04 * u, 0.06 * u], { k: 0.025 * u });
    });
  });
}

/** a big wrapped turban: a rounded dome with stacked, tilted wrap layers, sculpted into the body (crown ~1.93 m) */
function turban(ctx: KindContext, o: { color: number; color2: number; y?: number; tall?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const y0 = o.y ?? 0.2;
  const tall = o.tall ?? 0.85;
  s.with({ color: o.color, color2: o.color2, colorNoise: 0.55, colorFreq: 20 / P.s, mat: RED_COAT, bone: 'head', noise: { amp: 0.0035 * P.s, freq: 36 / P.s, type: 'ridged', octaves: 2 } }, () => {
    s.group('union', 0.012 * u, () => {
      s.ellipsoid(P.h(0, y0 + 0.22 * tall, -0.07), [0.43 * u, 0.36 * u * tall, 0.5 * u], { k: 0.03 * u });
      for (let i = 0; i < 4; i++) {
        const f = i / 3;
        s.torus(P.h(0, y0 + 0.05 + f * 0.3 * tall, -0.07 - f * 0.012), 0.38 * u * (1 - f * 0.25), 0.085 * u * (1 - f * 0.2), { k: 0.02 * u, rot: [-0.3 + f * 0.25 + (i % 2 ? 0.18 : -0.12), 0, i % 2 ? 0.2 : -0.2] });
      }
    });
    // keep the face open
    s.ellipsoid(P.h(0, -0.1, 0.5), [0.33 * u, 0.3 * u, 0.3 * u], { op: 'subtract', k: 0.03 * u });
  });
}

/** the turban's scarf: from behind the left ear down the neck, over the collarbones and across the chest; and the tail down the back */
function turbanScarf(ctx: KindContext, color: number, color2: number) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const u = P.headH;
  const cy = P.j.chest[1];
  s.with({ color, color2, colorNoise: 0.5, colorFreq: 22 / sc, mat: RED_COAT, noise: { amp: 0.0035 * sc, freq: 30 / sc, type: 'ridged', octaves: 2 } }, () => {
    s.cone(P.h(0.42, 0.0, -0.2), P.h(0.38, -0.78, -0.05), 0.06 * u, 0.055 * u, { bone: 'head', bone2: 'neck', blend: [0.3, 1], k: 0.04 * u });
    s.cone(P.h(0.38, -0.78, -0.05), [0.1 * sc, cy + 0.17 * sc, 0.085 * sc], 0.055 * u, 0.036 * sc, { bone: 'neck', bone2: 'chest', blend: [0, 1], k: 0.03 * sc });
    s.cone([0.1 * sc, cy + 0.17 * sc, 0.085 * sc], [-0.075 * sc, cy + 0.0 * sc, 0.108 * sc], 0.036 * sc, 0.027 * sc, { bone: 'chest', k: 0.02 * sc });
    // the back tail from the nape down between the shoulder blades
    s.cone(P.h(0, -0.25, -0.45), [0, cy + 0.04 * sc, -0.118 * sc], 0.2 * u, 0.14 * u, { bone: 'head', bone2: 'chest', blend: [0.2, 0.9], k: 0.05 * u });
  });
}

/** cloth: the open coat's tails (dark borders at the front edges and either side of the back), the black tunic panel and the red sash tail */
function clothSheets(ctx: KindContext, look: Look): SheetOpts[] {
  const { P } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const top = P.j.thigh_l[1] + 0.035 * sc;
  const edge = 2 * Math.PI - OPEN;
  const b = 0.2; // border width (rad)
  const o = 0.003 * sc;
  const cols: SheetCol[] = [
    { a0: OPEN, a1: OPEN + b, color: look.trim, out: o },
    { a0: OPEN + b, a1: 2.2, color: look.coat, nu: 4 },
    { a0: 2.2, a1: 2.2 + b, color: look.trim, out: o },
    { a0: 2.2 + b, a1: 4.0, color: look.coat, nu: 5 },
    { a0: 4.0, a1: 4.0 + b, color: look.trim, out: o },
    { a0: 4.0 + b, a1: edge - b, color: look.coat, nu: 4 },
    { a0: edge - b, a1: edge, color: look.trim, out: o },
  ];
  const coat: SheetOpts = { cols, top, bottom: 0.27 * k, rx1: 0.38 * sc, rz1: 0.26 * sc, curve: 0.7, rows: 7, mat: RED_COAT, hem: { color: look.coatDeep, band: 0.05 }, fold: 0.006 * sc, seed: 3 };
  const tunic: SheetOpts = { cols: [{ a0: -0.55, a1: 0.55, color: PALETTE.black, nu: 3 }], top, bottom: 0.4 * k, rx1: 0.2 * sc, rz1: 0.17 * sc, curve: 0.8, rows: 5, mat: BLACK_CLOTH, fold: 0.004 * sc, seed: 5 };
  const sash: SheetOpts = { cols: [{ a0: 0.2, a1: 0.42, color: look.coat, out: 0.012 * sc }], top, bottom: 0.68 * k, rx1: 0.2 * sc, rz1: 0.17 * sc, curve: 0.8, rows: 4, mat: RED_COAT, fold: 0.003 * sc, seed: 7 };
  return [coat, tunic, sash];
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
      emitParts(s, parts, [...TORSO, 'neck', 'deltoid'], { ...opts, inflate: 0.013 * sc });
      slab(s, hemY, P.j.neck[1] + 0.05 * sc, 0.008 * sc);
      // the front is open: the black tunic and the sash show between the lapels
      s.box([0, (hemY + 1.62 * k) / 2, 0.19 * sc], [0.046 * sc, (1.62 * k - hemY) / 2, 0.13 * sc], 0.002 * sc, { op: 'subtract', k: 0.008 * sc });
      // the embroidered borders run down both sides of the opening and either side of the back
      for (const sx of [1, -1]) s.box([sx * 0.082 * sc, (hemY + 1.55 * k) / 2, 0], [0.026 * sc, (1.55 * k - hemY) / 2, 0.3 * sc], 0.002 * sc, { op: 'paint', color: look.trim, mat: RED_COAT, strength: 0.85, k: 0.004 * sc });
    });
    // short, thick sleeves to the elbow
    s.mirrored(() =>
      s.group('union', 0.004 * sc, () => {
        emitParts(s, parts, ['upperarm'], { ...opts, inflate: 0.03 * sc, oneSide: true });
        const sh = P.j.upperarm_l;
        const end: V3 = [sh[0] + L.x * P.upperArm * 0.97, sh[1] + L.y * P.upperArm * 0.97, sh[2]];
        limbCutBefore(s, L, end, 0.006 * sc);
        s.plane([L.x, L.y, L.z], L.x * end[0] + L.y * end[1], { op: 'paint', seam: 0, k: 0.002 });
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
  // baggy trousers: the legs blown out above the boot tops (~0.4 m)
  s.group('union', 0.012 * sc, () => {
    emitParts(s, parts, ['thigh', 'knee', 'shin', 'calf'], { color: PALETTE.black, color2: 0x1c1a1d, colorNoise: 0.35, colorFreq: 30 / sc, mat: BLACK_CLOTH, inflate: 0.024 * sc, k: 0.04 * sc });
    s.plane([0, -1, 0], -0.4 * k, { op: 'intersect', k: 0.02 * sc });
    s.plane([0, 1, 0], hipY - 0.02 * sc, { op: 'intersect', k: 0.02 * sc });
  });
  coat(ctx, look);
  // wide leather belt (1.12-1.25 m) and a red sash over it
  sculptBand(ctx, { color: PALETTE.leather, mat: LEATHER, y0: 1.12 * k, y1: 1.24 * k, inflate: 0.034 * sc, k: 0.002 * sc });
  sculptBand(ctx, { color: look.coat, mat: RED_COAT, y0: 1.245 * k, y1: 1.325 * k, inflate: 0.036 * sc, k: 0.004 * sc });
  addClothSheets(ctx, clothSheets(ctx, look), 'coat');
  // gold wrist cuffs over the black sleeves
  forearmBand(ctx, { t0: 0.8, t1: 0.95, color: PALETTE.gold, mat: GILT, inflate: 0.0105 * sc, seam: false });
  if (ctx.armor >= 0.5 && look.head === 'helm') layeredPauldrons(ctx, { color: 0x3a2418, trim: PALETTE.gold, mat: HELM_LEATHER, trimMat: GILT, layers: 2, size: 1.0, sides: ['r'] });
}

/** fittings snapped onto the finished sculpt: belt boss and ring, the necklace and pendant (call last) */
function fittings(ctx: KindContext, necklace: boolean) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.88;
  const proj = makeProjector(s, { min: [-0.4 * sc, 0.9 * k, -0.3 * sc], max: [0.4 * sc, 1.75 * k, 0.4 * sc] });
  if (!proj) return;
  const boss = surfaceMatrix(proj, 0, 1.185 * k, 0.003 * sc);
  if (boss) {
    put(ctx, new THREE.CylinderGeometry(0.036 * sc, 0.038 * sc, 0.008 * sc, 10), { bone: 'spine', color: PALETTE.gold, mat: GILT, matrix: boss, small: true });
    put(ctx, new THREE.SphereGeometry(0.014 * sc, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.004 * sc, 0), { bone: 'spine', color: PALETTE.gold, mat: GILT, matrix: boss, small: true });
  }
  // an iron ring hung on the belt at the right hip
  const rm = surfaceMatrix(proj, -0.09 * sc, 1.17 * k, 0.004 * sc);
  if (rm) put(ctx, new THREE.TorusGeometry(0.014 * sc, 0.0028 * sc, 4, 8), { bone: 'spine', color: PALETTE.iron, mat: 'metal', matrix: rm, small: true });
  if (necklace) {
    // a beaded gold necklace in a V on the chest with a round pendant
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
    if (pm) put(ctx, new THREE.CylinderGeometry(0.019 * sc, 0.02 * sc, 0.005 * sc, 10), { bone: 'chest', color: PALETTE.gold, mat: GILT, matrix: pm, small: true });
  }
}

function head(ctx: KindContext, look: Look, rng: Rng) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  browsAndFace(ctx);
  switch (look.head) {
    case 'turban':
      turban(ctx, { color: PALETTE.red, color2: PALETTE.redDeep });
      turbanScarf(ctx, PALETTE.red, PALETTE.redDeep);
      cowl(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, mat: RED_COAT, rings: 2, thick: 0.03, lift: 0.05 });
      sheetPaint(ctx);
      shortBeard(ctx);
      jewelry(ctx, { color: PALETTE.gold, ears: true });
      break;
    case 'braided': {
      sculptHairCap(s, P, { style: 'short', color: 0x0e0a08, length: 1, density: 1 });
      addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.4 * sc, count: 70, width: 0.03, wave: 0.9, wild: 0.6, comb: 0.8, front: 0.24, back: -0.4, gravity: 5, tail: 0.3 * sc, segments: 5 }, rng);
      const strokes: [number, number][][] = [[[0, 0.22], [0, -0.05]]];
      for (const sd of [1, -1]) strokes.push([[sd * 0.33, 0.0], [sd * 0.2, -0.1], [sd * 0.32, -0.22]], [[sd * 0.2, 0.08], [sd * 0.1, 0.04]]);
      paintStrokes(ctx, strokes, 0.016);
      scalpStroke(ctx, [[0, 0.5], [0, 1.0]], { color: PALETTE.paint, r: 0.01 });
      shortBeard(ctx);
      jewelry(ctx, { color: PALETTE.gold, neck: true, ears: true });
      cowl(ctx, { color: look.coat, color2: look.coatDeep, mat: RED_COAT, rings: 2, thick: 0.026, lift: 0.04 });
      break;
    }
    case 'helm':
      addHairdo(ctx, { color: 0x100c0a, tip: 0x1e1814, deep: 0x080606, length: 0.16 * sc, count: ctx.helmet ? 15 : 50, width: 0.028, wave: 0.3, wild: 0.2, comb: 0.9, front: 0.24, back: -0.4, gravity: 4, segments: 4 }, rng);
      shortBeard(ctx);
      cowl(ctx, { color: look.coat, color2: look.coatDeep, mat: RED_COAT, rings: 2, thick: 0.028, lift: 0.04 });
      jewelry(ctx, { color: PALETTE.gold, neck: true });
      if (ctx.helmet) {
        domeHelm(ctx, { color: 0x9a7a38, trim: PALETTE.gold, mat: GILT, trimMat: GILT, profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'mail', tilt: -0.08 });
        plume(ctx, { color: PALETTE.red, y: 0.52, length: 0.7, n: 5 });
      }
      break;
    default:
      turban(ctx, { color: 0x1c1818, color2: 0x2e2220, y: 0.16, tall: 0.8 });
      turbanScarf(ctx, 0x1c1818, 0x2e2220);
      paintStrokes(ctx, [[[0.28, -0.14], [0.1, -0.16]], [[-0.28, -0.14], [-0.1, -0.16]], [[0.22, -0.22], [0.08, -0.24]], [[-0.22, -0.22], [-0.08, -0.24]]], 0.014);
      cowl(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, mat: RED_COAT, rings: 2, thick: 0.03, lift: 0.04 });
      shortBeard(ctx);
      jewelry(ctx, { color: PALETTE.gold, neck: true });
  }
}

export function haradrimExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const rng = recipeRng(ctx, 'haradrim');
    const look = LOOKS[ctxBucket(ctx)] ?? LOOKS[0];
    head(ctx, look, rng);
    dress(ctx, look);
    fittings(ctx, look.head === 'turban' || look.head === 'helm');
  });
}

export const haradrimDef: KindDef = {
  label: 'Haradrim',
  // sheet silhouette 1.93 m with the turban on (the head top is ~1.88 m)
  height: 1.88,
  build: { shoulders: 1.03, hips: 0.98, bulk: 0.9, chest: 0.96, muscle: 0.5, footSize: 0.92 },
  // brow > 1.5 keeps the kit's wire-like brow cards off (they poke out as black lines at crowd mesh resolution)
  face: { jaw: 0.95, chin: 1.0, brow: 1.52, cheekbones: 1.1, nose: { length: 1.05, width: 1.0, bridge: 1.05, hook: 0.1 }, lips: { width: 1.0, fullness: 0.7 }, eyeTilt: 0.04, eyeOpen: 0.75, eyeSize: 0.7 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.3, wrinkles: 0.2, lips: PALETTE.lips, surface: 'skin_weathered', scatter: 0xa04a30, brows: PALETTE.brows },
  eyes: { color: PALETTE.iris, sclera: PALETTE.sclera },
  hair: { style: 'stringy', color: 0x2a231b, density: 0 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PALETTE.black, mat: BLACK_CLOTH },
    // tall soft boots, tops ~0.4 m
    { type: 'boots', color: PALETTE.boots, color2: 0x241a12, length: 0.72, mat: BOOT, thickness: 0.004 },
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
