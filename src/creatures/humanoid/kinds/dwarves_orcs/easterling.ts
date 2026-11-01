/**
 * Easterlings (docs/refs/easterling): gilded bronze scale cuirass with stepped shoulder lames, black undersleeves and
 * leggings, a wide black belt with a gilt medallion and a crossed leather harness, a knee-length pleated red-and-black
 * skirt, scale vambraces, blackened greaves with a gilt cap over dark boots, a thick wrapped red cowl and a
 * Corinthian-style gilt helm with a T-shaped face opening and a low black crest.
 * Spear and shield are the weapon kit's. Four looks across the seed buckets share that structure: gilt (the sheet),
 * plumed bronze, cloth-wrapped painted warrior, black-lacquered elite.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import { sculptHairCap } from '../../hairstyles';
import type { KindContext, KindDef } from '../../types';
import { gearOf, makeProjector, strapSnapped, type SnapPoint } from '../uruks_bosses/common';
import { put, studs } from './armor';
import { ctxBucket, devNum, recipeRng } from './common';
import { sculptBand, sculptTorsoGarment } from './garments';
import { addHairdo, withHair } from './hair';
import { DOME_ROUND, domeHelm, faceMask, sculptTurban } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { BLACK_SCALES, GILT, GOLD_SCALES, addClothSheets, cowl, crest, forearmBand, kneeCap, layeredPauldrons, plume, rosetteGeo, sheetRadius, shinBand, surfaceMatrix, type SheetCol, type SheetOpts } from './menparts';

/** sRGB albedos from docs/refs/easterling/spec.json (design.outfit_layers / armor), cross-checked with the lit samples */
const PALETTE = {
  gilt: 0x8a6a30, // gilded_scales #b0904b: the lab lifts metal, so the albedo is darker and the scale gaps carry the contrast
  giltDeep: 0x3e2a13, // the dark stippled gaps between the scales (lit sample #3e2a13)
  giltTrim: 0x8c6e32,
  giltKnee: 0x6a5226,
  skirtDark: 0x2a1010, // the thin dark separators of the pleats
  bronze: 0x8a5a2c,
  bronzeDeep: 0x3a2410,
  black: 0x1b1a18, // black_undercloth #242523 (lit #2e2d2e): the lab lifts blacks, so the albedo is darker
  // red_black_skirt #642f29, red_cowl #682d2a (lit #632b2b / #5c1c1d): a deeper, less orange crimson than the hex
  skirtRed: 0x5a2626,
  cowlRed: 0x561a1a,
  cowlDeep: 0x2e0e0d,
  strap: 0x241810, // leather_straps #583c2b, darker in the lab's light
  glove: 0x2c2824, // gloves
  boots: 0x30241c, // boots #302b27 (lit #3c332f)
  bootSole: 0x241a12,
  skin: 0x84583a, // skin_base #b98f72, warmer and deeper
  skin2: 0x6e4a30,
  iris: 0x5c7f9e, // #5d8bb5, greyed
  brow: 0x7a5c34, // pale gold brows
  hair: 0x2a231b, // #312920
  crest: 0x1a1816,
};

const RED_CLOTH = surface('cloth', { rough: 0.88, sheen: 0.3, pat: { weave: 1.2 } });
const BLACK_CLOTH = surface('twill', { rough: 0.95, sheen: 0.08 });
const LEATHER = surface('leather_worn', { rough: 0.7, pat: { leather: 1.0, scratches: 0.5 } });
const BOOT = surface('leather_worn', { rough: 0.62, sheen: 0.14, pat: { leather: 1.1, scratches: 0.7, wrinkles: 0.4 } });
const RED_COWL = surface('cloth', { rough: 0.95, sheen: 0.2, pat: { weave: 1.4 } });
const LAMELLAR_LEATHER = surface('leather_worn', { rough: 0.6, pat: { scales: 1.6, leather: 0.8 } });

interface Look {
  scale: number;
  deep: number;
  trim: number;
  scaleMat: SurfaceName | SurfaceSpec;
  skirt: number;
  skirtBlack: number;
  hem: number;
  crest: number;
  helm: 'gilt' | 'plumed' | 'black' | 'wrap';
}

const LOOKS: Look[] = [
  { scale: PALETTE.gilt, deep: PALETTE.giltDeep, trim: PALETTE.giltTrim, scaleMat: GOLD_SCALES, skirt: PALETTE.skirtRed, skirtBlack: PALETTE.skirtDark, hem: 0x6a5226, crest: PALETTE.crest, helm: 'gilt' },
  { scale: PALETTE.bronze, deep: PALETTE.bronzeDeep, trim: PALETTE.giltTrim, scaleMat: GOLD_SCALES, skirt: PALETTE.skirtRed, skirtBlack: PALETTE.skirtDark, hem: 0x6a5226, crest: 0x7a1c14, helm: 'plumed' },
  { scale: 0x5a4030, deep: 0x2e2018, trim: PALETTE.giltTrim, scaleMat: LAMELLAR_LEATHER, skirt: PALETTE.black, skirtBlack: PALETTE.skirtDark, hem: 0x6a5226, crest: PALETTE.crest, helm: 'wrap' },
  { scale: 0x34322e, deep: 0x1a1917, trim: PALETTE.giltTrim, scaleMat: BLACK_SCALES, skirt: 0x3a1614, skirtBlack: PALETTE.skirtDark, hem: 0x6a5226, crest: PALETTE.crest, helm: 'black' },
];

function brows(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.mirrored(() => s.ellipsoid(P.h(0.17, -0.2, 0.31), [0.1 * u, 0.08 * u, 0.06 * u], { op: 'paint', color: PALETTE.brow, mat: 'skin', bone: 'head', k: 0.05 * u, strength: 0.3 }));
}

/** a black tied-back hair tail (shown when the helmet is off) */
function eastHair(ctx: KindContext, rng: Rng, o: { tail?: number }) {
  const { P, sculpt: s } = ctx;
  const c = PALETTE.hair;
  sculptHairCap(s, P, { style: 'tied_back', color: c, length: 1, density: 1 });
  addHairdo(ctx, { color: c, tip: 0x241c18, deep: 0x0a0807, length: 0.16 * P.s, count: 50, width: 0.026, wave: 0.2, wild: 0.1, comb: 1.0, front: 0.24, back: -0.38, gravity: 3, tail: (o.tail ?? 0.25) * P.s, segments: 4 }, rng);
}

/** the pleated skirt: crimson cloth columns (a few triangles each) with a thin dark separator every 4th column and a hem band, to ~0.6 m */
function skirtSheet(ctx: KindContext, look: Look): SheetOpts {
  const { P } = ctx;
  const sc = P.s;
  const n = 24; // pleats
  const arc = (Math.PI * 2) / n;
  const cols: SheetCol[] = [];
  for (let i = 0; i < n; i++) cols.push({ a0: -arc / 2 + i * arc, a1: -arc / 2 + (i + 1) * arc, color: i % 4 === 3 ? look.skirtBlack : look.skirt, out: i % 4 === 3 ? -0.004 * sc : (i % 2 ? 0.002 : 0.004) * sc });
  return { cols, top: P.j.thigh_l[1] + 0.035 * sc, bottom: 0.58 * (P.H / 1.8), rx1: 0.26 * sc, rz1: 0.22 * sc, curve: 0.7, rows: 4, mat: RED_CLOTH, hem: { color: look.hem, band: 0.07 }, fold: 0.004 * sc, seed: 3 + ctxBucket(ctx) };
}

/** everything below the neck: the same structure for all four looks (sheet front/back/profile) */
function body(ctx: KindContext, look: Look) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const kneeY = P.j.shin_l[1];
  const k = P.H / 1.8; // landmark heights below are metres on the 1.8 m sheet
  // scale cuirass to the hips (scales from the cowl to the belt)
  sculptTorsoGarment(ctx, { color: look.scale, color2: look.deep, mat: look.scaleMat, inflate: 0.0145 * sc, hem: 0.2, sleeve: 0, neck: false });
  // belt: a wide black band at 1.08-1.2 m with a gilt medallion
  sculptBand(ctx, { color: PALETTE.black, mat: LEATHER, y0: 1.075 * k, y1: 1.2 * k, inflate: 0.0215 * sc, k: 0.002 * sc });
  // scale vambraces over the black undersleeves (the tunic) and dark gloves
  if (A >= 0.25) forearmBand(ctx, { t0: 0.18, t1: 0.68, color: look.scale, color2: look.deep, mat: look.scaleMat, inflate: 0.0105 * sc });
  // blackened greaves from mid-shin to the knee over the boots, and a gilt cap on the front of each knee
  if (A >= 0.25) shinBand(ctx, { y0: 0.11 * k, y1: kneeY - 0.01 * sc, color: 0x2b2925, mat: BLACK_SCALES, inflate: 0.0235 * sc });
  // one gilt knee guard on the front of each knee (no full rings): the boots are slim, tall and dark
  if (A >= 0.25) kneeCap(ctx, { y0: kneeY - 0.07 * sc, y1: kneeY + 0.015 * sc, color: PALETTE.giltKnee, mat: GILT, inflate: 0.035 * sc });
  // shoulders: four stacked, flared lames, each smaller than the one below
  if (A >= 0.25) layeredPauldrons(ctx, { color: look.scale, trim: look.trim, mat: look.scaleMat, trimMat: GILT, layers: 4, size: 1.02, shrink: 0.83, rise: 0.02, tilt: 0.55 });
  // wrapped red cowl: thick folds overlapping the helm's neck plates
  cowl(ctx, { color: PALETTE.cowlRed, color2: PALETTE.cowlDeep, mat: RED_COWL, rings: 4, thick: 0.046 });
  // the skirt and the centre tab (a narrow gilt panel hung from the belt to ~0.68 m)
  const sheet = skirtSheet(ctx, look);
  addClothSheets(ctx, [sheet], 'skirt');
  const zf = sheetRadius(P, sheet, 0.9 * k).rz + 0.02 * sc;
  const w0 = 0.05 * sc;
  const shape = new THREE.Shape();
  shape.moveTo(-w0, 0.18 * k);
  shape.lineTo(w0, 0.18 * k);
  shape.lineTo(w0 * 0.85, -0.17 * k);
  shape.lineTo(0, -0.215 * k);
  shape.lineTo(-w0 * 0.85, -0.17 * k);
  const g = new THREE.ShapeGeometry(shape);
  g.translate(0, 0.87 * k, zf + 0.006 * sc);
  put(ctx, g, { bone: 'hips', color: look.trim, mat: GILT, small: true });
  const pts: V3[] = [];
  for (let i = 0; i < 6; i++) pts.push([0, (0.98 - i * 0.052) * k, zf + 0.009 * sc]);
  const st = studs(pts, 0.0085 * sc);
  if (st) put(ctx, st, { bone: 'hips', color: look.deep, mat: GILT, small: true });
}

/** the harness straps, gilt rosettes and the belt medallion, snapped onto the finished sculpt (call last) */
function fittings(ctx: KindContext, look: Look) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const k = P.H / 1.8;
  const proj = makeProjector(s, { min: [-0.4 * sc, 0.9 * k, -0.3 * sc], max: [0.4 * sc, 1.65 * k, 0.4 * sc] });
  if (!proj) return;
  // the diagonal harness as rigid ribbons (a 5 cm strap does not survive in the 6 cm body mesh): front, right shoulder to
  // left hip, and a mirrored strap on the back
  const gear = gearOf(ctx);
  const cy = P.j.chest[1];
  const fpts: SnapPoint[] = [];
  const bpts: SnapPoint[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = (-0.1 + (0.25 * i) / 8) * sc;
    fpts.push([x, cy + 0.05 * sc - 0.8 * x, 0.4, 'f']);
    bpts.push([-x, cy + 0.05 * sc - 0.8 * x, -0.4, 'b']);
  }
  strapSnapped(gear, proj, fpts, 0.055 * sc, 0.011 * sc, { bone: 'chest', color: PALETTE.strap, mat: LEATHER });
  strapSnapped(gear, proj, bpts, 0.055 * sc, 0.011 * sc, { bone: 'chest', color: PALETTE.strap, mat: LEATHER });
  // a gilt medallion where each strap crosses the chest and the back
  const fm = surfaceMatrix(proj, 0.03 * sc, cy + 0.05 * sc - 0.8 * 0.03 * sc, 0.013 * sc);
  if (fm) put(ctx, rosetteGeo(0.026 * sc, 0.18), { bone: 'chest', color: look.trim, mat: GILT, matrix: fm, small: true });
  const bm = surfaceMatrix(proj, -0.03 * sc, cy + 0.05 * sc - 0.8 * 0.03 * sc, 0.013 * sc, undefined, true);
  if (bm) put(ctx, rosetteGeo(0.026 * sc, 0.18), { bone: 'chest', color: look.trim, mat: GILT, matrix: bm, small: true });
  // belt medallion (round gilt plate with a boss at 1.13 m)
  const mm = surfaceMatrix(proj, 0, 1.135 * k, 0.003 * sc);
  if (mm) put(ctx, rosetteGeo(0.034 * sc, 0.16), { bone: 'spine', color: look.trim, mat: GILT, matrix: mm, small: true });
  // the two shoulder-strap rosettes on the upper chest (1.5 m)
  for (const sx of [0.088, -0.088]) {
    const m = surfaceMatrix(proj, sx * sc, 1.5 * k, 0.003 * sc);
    if (m) put(ctx, rosetteGeo(0.021 * sc, 0.2), { bone: 'chest', color: look.trim, mat: GILT, matrix: m, small: true });
  }
}

/** the face behind the T-slot and the neck under the jaw are in shadow: paint them near black before any cloth goes on, so no skin shows through */
function shadowFace(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.ellipsoid(P.h(0, -0.18, 0.22), [0.42 * u, 0.46 * u, 0.42 * u], { op: 'paint', color: 0x14100d, mat: 'skin', bone: 'head', k: 0.03 * u, strength: 1 });
  s.ellipsoid(P.h(0, -0.9, -0.02), [0.55 * u, 0.5 * u, 0.55 * u], { op: 'paint', color: 0x1a1410, mat: 'skin', bone: 'neck', k: 0.03 * u, strength: 1 });
}

function helmet(ctx: KindContext, look: Look) {
  const { P } = ctx;
  const u = P.headH;
  const dome = DOME_ROUND.map(([r, y]) => [r * 1.06, y * 1.06] as [number, number]);
  const isBlack = look.helm === 'black';
  const hc = isBlack ? 0x2d2b28 : look.helm === 'plumed' ? PALETTE.bronze : PALETTE.gilt;
  const mat = isBlack ? BLACK_SCALES : GILT;
  domeHelm(ctx, { color: hc, trim: look.trim, mat, trimMat: GILT, profile: dome, ridge: true, cheeks: true, rivets: 0, neck: 'plates', tilt: -0.08, y: 0.03, band: false });
  faceMask(ctx, { color: hc, trim: look.trim, mat, lift: 0.085, slit: [-0.12, -0.0], top: 0.12, mouth: false, bottom: -0.56, half: 0.36 });
  // the two brow-band bosses at the temples
  const bosses: V3[] = [];
  for (const sd of [1, -1]) bosses.push(P.h(sd * 0.395, 0.05, 0.12), P.h(sd * 0.38, -0.06, 0.1));
  const bs = studs(bosses, 0.02 * u, 0.9);
  if (bs) put(ctx, bs, { bone: 'head', color: look.trim, mat: GILT, small: true });
  if (look.helm === 'plumed') plume(ctx, { color: look.crest, y: 0.55, length: 0.9, n: 5 });
  else crest(ctx, { color: look.crest, profile: dome, y: 0.03, height: 0.07 * P.s, zs: 1.28 });
}

function wrapHead(ctx: KindContext, look: Look) {
  const { P } = ctx;
  const u = P.headH;
  const red = PALETTE.skirtRed;
  // red and black war paint: bars across the eyes and cheeks
  for (const sd of [1, -1]) {
    faceStroke(ctx, [[sd * 0.3, -0.04], [sd * 0.12, -0.04]], { color: PALETTE.black, r: 0.026, mat: 'skin', strength: 0.95 });
    faceStroke(ctx, [[sd * 0.26, -0.18], [sd * 0.14, -0.2]], { color: red, r: 0.02, mat: 'skin', strength: 0.9 });
  }
  faceStroke(ctx, [[0, 0.2], [0, -0.0]], { color: red, r: 0.02, mat: 'skin', strength: 0.9 });
  scalpStroke(ctx, [[0, 0.5], [0, 1.1]], { color: red, r: 0.012 });
  sculptTurban(ctx, { color: red, color2: PALETTE.black, mat: 'cloth', y: 0.1 });
  if (ctx.helmet) {
    // a gilt brow-band and a spike over the turban
    put(ctx, new THREE.TorusGeometry(0.4 * u, 0.026 * u, 4, 20).rotateX(Math.PI / 2 - 0.1).scale(1, 1, 1.15).translate(...P.h(0, 0.17, -0.05)), { bone: 'head', color: look.trim, mat: GILT, small: true });
    put(ctx, new THREE.ConeGeometry(0.045 * u, 0.14 * u, 5).translate(...P.h(0, 0.27, 0.36)), { bone: 'head', color: look.trim, mat: GILT, small: true });
  }
}

export function easterlingExtras(ctx: KindContext) {
  withHair(ctx, () => {
    const rng = recipeRng(ctx, 'easterling');
    const look = LOOKS[ctxBucket(ctx)] ?? LOOKS[0];
    brows(ctx);
    if (ctx.helmet && look.helm !== 'wrap') shadowFace(ctx);
    body(ctx, look);
    if (look.helm === 'wrap') wrapHead(ctx, look);
    else if (ctx.helmet) helmet(ctx, look);
    else eastHair(ctx, rng, { tail: look.helm === 'black' ? 0.35 : 0.28 });
    fittings(ctx, look);
  });
}

export const easterlingDef: KindDef = {
  label: 'Easterling',
  height: 1.84,
  build: { shoulders: 1.1, hips: 1.1, bulk: 1.2, chest: 1.08, muscle: 0.55, footSize: 0.92 },
  face: { jaw: 1.0, chin: 0.95, brow: 1.0, cheekbones: 1.2, nose: { length: 1.0, width: 0.95, bridge: 0.9 }, eyeTilt: 0.08, eyeOpen: 0.85, foreheadSlope: 0.12 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.25, wrinkles: 0.25, surface: 'skin_weathered', scatter: 0xc05a38, brows: PALETTE.brow },
  eyes: { color: PALETTE.iris, sclera: 0xe2dcd0 },
  hair: { style: 'stringy', color: PALETTE.hair, density: 0 },
  beard: null,
  outfit: [
    // padded, thick leggings: the sheet's legs are chunky under the skirt
    { type: 'leggings', color: PALETTE.black, mat: BLACK_CLOTH, thickness: 0.011 },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootSole, length: 1.0, mat: BOOT, thickness: 0.01 },
    // black undersleeves (no skirt layer geometry: the pleated skirt is a cloth sheet, see `body`)
    { type: 'tunic', color: PALETTE.black, mat: BLACK_CLOTH, length: 0 },
    { type: 'gloves', color: PALETTE.glove, mat: LEATHER },
    { type: 'skirt', color: PALETTE.skirtRed, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'spear', left: 'shield', style: 'easterling' },
  anim: { swagger: 0.3, aggression: 0.6, stance: 1.28 },
  variation: { height: 0.03, bulk: 0.08, skin: 0.1 },
  detail: { res: devNum('res', 0.069), headRes: devNum('headRes', 0.0145), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'man', weight: 0.55 },
  extras: easterlingExtras,
};
