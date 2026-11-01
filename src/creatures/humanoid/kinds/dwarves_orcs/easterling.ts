/**
 * Easterlings (docs/refs/easterling): gilded bronze scale cuirass with three-tier shoulder lames,
 * black undersleeves and trousers, a wide black belt with a gilt medallion, scale hip tassets over
 * a knee-length pleated red-and-black skirt, scale-topped boots and vambraces, a red wrapped cowl
 * and a Corinthian-style gilt helm with a T-shaped face opening and a low black crest.
 * Spear and kite shield are the weapon kit's. Four looks across the seed buckets share that
 * structure: gilt (the sheet), plumed bronze, cloth-wrapped painted warrior, black-lacquered elite.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { put, studs } from './armor';
import { ctxBucket, devNum, recipeRng } from './common';
import { sculptBand, sculptTorsoGarment } from './garments';
import { addHairdo, withHair } from './hair';
import { DOME_ROUND, domeHelm, faceMask, sculptTurban } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { BLACK_SCALES, GILT, GOLD_SCALES, WOVEN, addSkirtCloth, type SkirtOpts, cowl, crest, forearmBand, layeredPauldrons, plume, rosetteGeo, shinBand, skirtRadius, surfaceMatrix } from './menparts';
import { gearOf, makeProjector, strapSnapped, V, type SnapPoint } from '../uruks_bosses/common';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';

/** sRGB albedos from docs/refs/easterling/spec.json (design.outfit_layers / armor), cross-checked with the lit samples */
const PALETTE = {
  // design #b0904b, lit sample #3e2a13 (in shadow): the gilt reads best a little darker and warmer than the hex
  gilt: 0x86692f,
  giltDeep: 0x3a2812, // stippled dark bronze between the scales
  giltTrim: 0xa8873f,
  bronze: 0x7a4f26,
  bronzeDeep: 0x34200f,
  black: 0x1b1a18, // black_undercloth #242523 (lit #2e2d2e): the lab lifts blacks, so the albedo is darker
  blackIron: 0x2d2b27, // black_greaves #2b2925
  // red_black_skirt #642f29, red_cowl #682d2a (lit #632b2b / #5c1c1d): a deeper crimson than the hex, which rendered orange-red
  red: 0x6a2020,
  redDeep: 0x45140f,
  strap: 0x35231a, // leather_straps #583c2b
  glove: 0x2c2824, // gloves
  boots: 0x4a3626, // boots #302b27 (lit #3c332f)
  bootSole: 0x241a12,
  skin: 0x84583a, // skin_base #b98f72, warmer and deeper
  skin2: 0x6e4a30,
  iris: 0x5c7f9e, // #5d8bb5, greyed
  brow: 0x7a5c34, // pale gold brows
  hair: 0x2a231b, // #312920
};

/** gilded scale armour (sheet: large overlapping worn gilt scales) */
const SCALES = surface('gold', { rough: 0.5, pat: { scales: 1.9, scratches: 0.6, pores: 0.45 } });
const RED_CLOTH = surface('cloth', { rough: 0.88, sheen: 0.3, pat: { weave: 1.2 } });
const BLACK_CLOTH = surface('twill', { rough: 0.95, sheen: 0.08 });
const LEATHER = surface('leather_worn', { rough: 0.7, pat: { leather: 1.0, scratches: 0.5 } });
const BOOT = surface('leather_worn', { rough: 0.62, sheen: 0.14, pat: { leather: 1.1, scratches: 0.7, wrinkles: 0.4 } });

interface Look {
  scale: number;
  deep: number;
  trim: number;
  scaleMat: typeof SCALES;
  skirt: number;
  skirtDeep: number;
  strip: number;
  hem: number;
  crest: number;
  helm: 'gilt' | 'plumed' | 'black' | 'wrap';
}

const LOOKS: Look[] = [
  { scale: PALETTE.gilt, deep: PALETTE.giltDeep, trim: PALETTE.giltTrim, scaleMat: SCALES, skirt: PALETTE.red, skirtDeep: PALETTE.redDeep, strip: PALETTE.black, hem: 0x6a5226, crest: 0x1a1816, helm: 'gilt' },
  { scale: PALETTE.bronze, deep: PALETTE.bronzeDeep, trim: PALETTE.giltTrim, scaleMat: SCALES, skirt: PALETTE.red, skirtDeep: PALETTE.redDeep, strip: PALETTE.black, hem: 0x6a5226, crest: 0x7a1c14, helm: 'plumed' },
  { scale: 0x5a4030, deep: 0x2e2018, trim: PALETTE.giltTrim, scaleMat: surface('leather_worn', { rough: 0.6, pat: { scales: 1.6, leather: 0.8 } }) as typeof SCALES, skirt: PALETTE.black, skirtDeep: 0x16130f, strip: PALETTE.red, hem: 0x6a5226, crest: 0x1a1816, helm: 'wrap' },
  { scale: 0x34322e, deep: 0x1a1917, trim: PALETTE.giltTrim, scaleMat: BLACK_SCALES as typeof SCALES, skirt: 0x2a1614, skirtDeep: 0x120c0a, strip: PALETTE.black, hem: 0x6a5226, crest: 0x1a1816, helm: 'black' },
];

function brows(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: PALETTE.brow, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.3 }));
}

/** a black tied-back hair tail (shown when the helmet is off) */
function eastHair(ctx: KindContext, rng: Rng, o: { tail?: number; length?: number; count?: number }) {
  const { P, sculpt: s } = ctx;
  const c = PALETTE.hair;
  sculptHairCap(s, P, { style: 'tied_back', color: c, length: 1, density: 1 });
  addHairdo(ctx, { color: c, tip: 0x241c18, deep: 0x0a0807, length: (o.length ?? 0.16) * P.s, count: o.count ?? 50, width: 0.026, wave: 0.2, wild: 0.1, comb: 1.0, front: 0.24, back: -0.38, gravity: 3, tail: (o.tail ?? 0.25) * P.s, segments: 4 }, rng);
}

/** everything below the neck: the same structure for all four looks (sheet front/back/profile) */
function body(ctx: KindContext, look: Look) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const k = P.H / 1.8; // landmark heights below are metres on the 1.8 m sheet
  // ── scale cuirass to the hips (sheet: scales from the cowl to the belt, tassets below it) ──
  sculptTorsoGarment(ctx, { color: look.scale, color2: look.deep, mat: look.scaleMat, inflate: 0.0145 * sc, hem: 0.2, sleeve: 0, neck: false });
  // ── belt: a wide black band at 1.08-1.19 m with a gilt medallion (sheet) ──
  sculptBand(ctx, { color: PALETTE.black, mat: LEATHER, y0: 1.075 * k, y1: 1.2 * k, inflate: 0.0215 * sc, k: 0.002 * sc });
  // ── the diagonal leather harness: right shoulder to left hip, and the shoulder braces ──
  // ── black undersleeves come from the tunic; vambraces of scale on the forearm, dark gloves ──
  if (A >= 0.25) forearmBand(ctx, { t0: 0.18, t1: 0.68, color: look.scale, color2: look.deep, mat: look.scaleMat, inflate: 0.0105 * sc });
  // ── greaves: scale plates over the boot tops (0.33-0.5 m) ──
  if (A >= 0.25) shinBand(ctx, { y0: 0.33 * k, y1: kneeY - 0.012 * sc, color: look.scale, color2: look.deep, mat: look.scaleMat, inflate: 0.0235 * sc });
  // ── shoulders: three-tier scale lames ──
  if (A >= 0.25) layeredPauldrons(ctx, { color: look.scale, trim: look.trim, mat: look.scaleMat, trimMat: GILT, layers: 3, size: 1.12, drop: 0.036 });
  // ── wrapped red cowl at the neck ──
  cowl(ctx, { color: PALETTE.red, color2: PALETTE.redDeep, mat: RED_CLOTH, rings: 3, thick: 0.03 });
  // ── the pleated skirt: red cloth with black pleat strips and a gilt hem band, to ~0.58 m ──
  const top = hipY + 0.035 * sc;
  const bottom = 0.58 * k;
  const nP = 10; // red/black pairs
  const pair = (Math.PI * 2) / nP;
  const redArc = pair * 0.66;
  const sheets: SkirtOpts[] = [];
  for (let i = 0; i < nP; i++) {
    const a0 = -redArc / 2 + i * pair;
    sheets.push({ color: look.skirt, color2: look.hem, mat: RED_CLOTH, top, bottom, panels: [[a0, a0 + redArc]], name: 'skirt' });
    sheets.push({ color: look.strip, color2: look.hem, mat: BLACK_CLOTH, top, bottom, panels: [[a0 + redArc, a0 + pair]], name: 'skirt' });
  }
  addSkirtCloth(ctx, sheets);
  // the centre tab: a gilt-studded leather panel hung from the belt to ~0.68 m
  {
    const zf = skirtRadius(P, top, bottom, 0.9 * k).rz + 0.02 * sc;
    const w0 = 0.05 * sc;
    const shape = new THREE.Shape();
    shape.moveTo(-w0, 0.18 * k);
    shape.lineTo(w0, 0.18 * k);
    shape.lineTo(w0 * 0.85, -0.17 * k);
    shape.lineTo(0, -0.215 * k);
    shape.lineTo(-w0 * 0.85, -0.17 * k);
    const g = new THREE.ShapeGeometry(shape).scale(1, 1, 1);
    g.translate(0, 0.87 * k, zf + 0.006 * sc);
    put(ctx, g, { bone: 'hips', color: look.deep, mat: LEATHER, small: true });
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 6; i++) pts.push([0, (0.98 - i * 0.052) * k, zf + 0.009 * sc]);
    const st = studs(pts, 0.0085 * sc);
    if (st) put(ctx, st, { bone: 'hips', color: look.trim, mat: GILT, small: true });
    const rim = new THREE.BufferGeometry();
    void rim;
  }
  return { top, bottom };
}

/** gilt rosettes and the belt medallion, snapped onto the finished sculpt (call last) */
function fittings(ctx: KindContext, look: Look) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.8;
  const proj = makeProjector(s, { min: [-0.4 * sc, 0.9 * k, -0.3 * sc], max: [0.4 * sc, 1.65 * k, 0.4 * sc] });
  if (!proj) return;
  // the diagonal harness: front strap right shoulder to left hip, and the crossed pair on the back (rigid ribbons: a 4 cm
  // strap does not survive in the 6 cm body mesh)
  const gear = gearOf(ctx);
  const cy = P.j.chest[1];
  const fpts: SnapPoint[] = [];
  const bpts: SnapPoint[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (-0.1 + (0.25 * i) / 8) * sc;
    fpts.push([x, cy + 0.05 * sc - 0.8 * x, 0.4, 'f']);
    bpts.push([-x, cy + 0.05 * sc - 0.8 * x, -0.4, 'b']);
  }
  strapSnapped(gear, proj, fpts, 0.04 * sc, 0.006 * sc, { bone: 'chest', color: PALETTE.strap, mat: LEATHER });
  strapSnapped(gear, proj, bpts, 0.04 * sc, 0.006 * sc, { bone: 'chest', color: PALETTE.strap, mat: LEATHER });
  // belt medallion (sheet: round gilt plate with a boss at 1.13 m)
  const mm = surfaceMatrix(proj, 0, 1.135 * k, 0.003 * sc);
  if (mm) {
    const g = rosetteGeo(0.034 * sc, 0.16);
    put(ctx, g, { bone: 'spine', color: look.trim, mat: GILT, matrix: mm, small: true });
  }
  // the two shoulder-strap rosettes on the upper chest (sheet: 1.5 m)
  for (const sx of [0.088, -0.088]) {
    const m = surfaceMatrix(proj, sx * sc, 1.5 * k, 0.003 * sc);
    if (m) put(ctx, rosetteGeo(0.021 * sc, 0.2), { bone: 'chest', color: look.trim, mat: GILT, matrix: m, small: true });
  }
  void V;
}

function helmet(ctx: KindContext, look: Look) {
  const { P } = ctx;
  const u = P.headH;
  const dome = DOME_ROUND;
  const isBlack = look.helm === 'black';
  const hc = isBlack ? 0x2d2b28 : look.helm === 'plumed' ? PALETTE.bronze : PALETTE.gilt;
  const trim = look.trim;
  const mat = isBlack ? BLACK_SCALES : GILT;
  domeHelm(ctx, { color: hc, trim, mat, trimMat: GILT, profile: dome, ridge: true, cheeks: true, rivets: 0, neck: 'plates', tilt: -0.08, y: 0.03, band: false });
  faceMask(ctx, { color: hc, trim, mat, lift: 0.085, slit: [-0.12, -0.0], top: 0.12, mouth: false, bottom: -0.56, half: 0.36 });
  // the two brow-band bosses at the temples (sheet profile)
  const bosses: V3[] = [];
  for (const sd of [1, -1]) {
    bosses.push(P.h(sd * 0.395, 0.05, 0.12), P.h(sd * 0.38, -0.06, 0.1));
  }
  const bs = studs(bosses, 0.02 * u, 0.9);
  if (bs) put(ctx, bs, { bone: 'head', color: trim, mat: GILT, small: true });
  if (look.helm === 'plumed') plume(ctx, { color: look.crest, y: 0.55, length: 0.9, n: 5 });
  else crest(ctx, { color: look.crest, profile: dome, y: 0.03, height: 0.2, zs: 1.28 });
}

function wrapHead(ctx: KindContext, rng: Rng, look: Look) {
  const { P } = ctx;
  const u = P.headH;
  // red and black war paint: bars across the eyes and cheeks
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.3, -0.04], [sd * 0.12, -0.04]], { color: PALETTE.black, r: 0.026, mat: 'skin', strength: 0.95 });
    faceStroke(ctx, [[sd * 0.26, -0.18], [sd * 0.14, -0.2]], { color: PALETTE.red, r: 0.02, mat: 'skin', strength: 0.9 });
  }
  faceStroke(ctx, [[0, 0.2], [0, -0.0]], { color: PALETTE.red, r: 0.02, mat: 'skin', strength: 0.9 });
  scalpStroke(ctx, [[0, 0.5], [0, 1.1]], { color: PALETTE.red, r: 0.012 });
  sculptTurban(ctx, { color: PALETTE.red, color2: PALETTE.black, mat: 'cloth', y: 0.1 });
  if (ctx.helmet) {
    // a gilt brow-band and a spike over the turban
    put(ctx, new THREE.TorusGeometry(0.4 * u, 0.026 * u, 4, 20).rotateX(Math.PI / 2 - 0.1).scale(1, 1, 1.15).translate(...P.h(0, 0.17, -0.05)), { bone: 'head', color: look.trim, mat: GILT, small: true });
    put(ctx, new THREE.ConeGeometry(0.045 * u, 0.14 * u, 5).translate(...P.h(0, 0.27, 0.36)), { bone: 'head', color: look.trim, mat: GILT, small: true });
  }
  void rng;
}

function easterlingLook(ctx: KindContext, look: Look, rng: Rng) {
  brows(ctx);
  body(ctx, look);
  if (look.helm === 'wrap') {
    wrapHead(ctx, rng, look);
  } else if (ctx.helmet) {
    helmet(ctx, look);
  } else {
    eastHair(ctx, rng, { tail: look.helm === 'black' ? 0.35 : 0.28 });
  }
  fittings(ctx, look);
}

export function easterlingExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const rng = recipeRng(ctx, 'easterling');
    easterlingLook(ctx, LOOKS[ctxBucket(ctx)] ?? LOOKS[0], rng);
  });
}

export const easterlingDef: KindDef = {
  label: 'Easterling',
  height: 1.82,
  build: { shoulders: 1.1, hips: 1.0, bulk: 1.1, chest: 1.04, muscle: 0.55, footSize: 0.92 },
  face: { jaw: 1.0, chin: 0.95, brow: 1.0, cheekbones: 1.2, nose: { length: 1.0, width: 0.95, bridge: 0.9 }, eyeTilt: 0.08, eyeOpen: 0.85, foreheadSlope: 0.12 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.25, wrinkles: 0.25, surface: 'skin_weathered', scatter: 0xc05a38, brows: PALETTE.brow },
  eyes: { color: PALETTE.iris, sclera: 0xe2dcd0 },
  hair: { style: 'stringy', color: PALETTE.hair, density: 0 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PALETTE.black, mat: BLACK_CLOTH },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootSole, length: 1.0, mat: BOOT, thickness: 0.008 },
    // black undersleeves (no skirt: the pleated skirt is a per-bucket cloth sheet, see `body`)
    { type: 'tunic', color: PALETTE.black, mat: BLACK_CLOTH, length: 0 },
    { type: 'gloves', color: PALETTE.glove, mat: LEATHER },
    { type: 'skirt', color: PALETTE.red, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'spear', left: 'shield', style: 'easterling' },
  anim: { swagger: 0.3, aggression: 0.6, stance: 1.3 },
  variation: { height: 0.03, bulk: 0.08, skin: 0.1 },
  detail: { res: devNum('res', 0.066), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'man', weight: 0.55 },
  extras: easterlingExtras,
};

void GOLD_SCALES;
void WOVEN;
