/**
 * Orcs (rank and file), dressed from `docs/refs/orc` and `docs/refs/orc_variants`: a lean, sinewy,
 * hunched figure in a ragged brown rag tunic with a cowl neck and short torn sleeves, a layered
 * tattered kilt of strips and rags, long wrapped leather bracers, shin wraps with criss-crossing
 * cord, a double belt with iron rings and a hanging plate, a leather baldric from a single rusty
 * shoulder plate, long stringy black hair and a rusty cleaver in the right hand.
 *
 * The four seed buckets are the four orcs of the variants sheet (wiry grey-green, brown with a
 * heavy brow, scarred pale mottle, matted long hair): same rags, different skin, hair and scars.
 * Armour and helmets stay gameplay tiers: the sheet's shoulder plate comes with any armour, a
 * second plate / scrap breastplate with heavy armour, and helmets only when the loadout asks.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { KindContext, KindDef } from '../../types';
import { put, spike } from './armor';
import { ctxBucket, devNum, recipeRng, shade } from './common';
import { createHairMaterial } from '../../../kit/hair';
import { attachSkinned } from './common';
import { makeOrcHair } from './orc_hair';
import { DOME_POINTED, DOME_ROUND, IRON, domeHelm } from './headgear';
import { faceStroke } from './markings';
import { eyeRings, orcTeeth, scrapBreastplate, skinMottle, skinTint } from './orcparts';
import { RAGS, beltBand, longBracers, orcFittings, ragTunic, rustPauldron, shinWraps, strapBand } from './orc_gear';

export const ORC_FACE = {
  jaw: 1.3, jawLength: 1.1, chin: 0.7, brow: 1.9, cheekbones: 1.3,
  nose: { length: 0.75, width: 1.55, bridge: 0.5, hook: 0, tip: 1.15, flat: 0.85 },
  lips: { width: 1.3, fullness: 0.7 }, ears: 'orc' as const, earSize: 1.3, eyeSize: 1.0, eyeSpacing: 1.04, eyeTilt: -0.1,
  eyeOpen: 0.95, tusks: 0.9, underbite: 0.75, foreheadSlope: 0.65, asym: 0.8, cranium: 0.9,
};

/**
 * Colours. `spec.json` design: rag cloth #554333, leather #55412c, rusty metal #71614b, skin base
 * #6b7156 (grey-green), hair #302f25, iris #a8863a. The lit turnaround reads warmer and browner
 * than the design hex (skin medians #6c5539..#806750 on arms and face, tunic #523b2a, kilt #523e30,
 * hair #19110e), and the lab/AgX lifts albedos toward grey, so the albedos here are deeper and
 * warmer than the hex values.
 */
export const ORC_PALETTE = {
  tunic: 0x4c3322, // design #554333; turnaround chest #523b2a (lit); a warmer, more orange albedo so the cloth stops reading as flat plastic
  tunicTrim: 0x7c5e38, // ochre mottle
  kilt: 0x4a3626, // turnaround kilt #523e30
  kiltHem: 0x523c2f, // lighter, worn hem edges
  kiltUnder: 0x4a2c22, // rust-red shreds // the darker, redder inner panels / strips of the kilt (details image)
  leather: 0x47341f, // design #55412c
  leatherDark: 0x2e2116,
  wrap: 0x4a3828, // shin wraps (observed foot wraps #423125 .. #513e28)
  cord: 0x6a5238, // the paler cord spiralling round wraps and bracers
  iron: 0x6a5a46, // design #71614b
  rust: 0x7a4c2c, // orange rust blooms on the plates
  hair: 0x1d1612,
  hairTip: 0x2a2019,
  hairDeep: 0x120e0b,
  eyes: 0xd19a2a, // sheet iris #a8863a lit; a saturated amber so the eyes read at distance
  scar: 0x6a3c30, // old healed scars: dark and weak, they should not read as cracks
  flush: 0xa05a4a, // pink-red flush on nose, cheeks, brow
};

interface Look {
  skin: number;
  skin2: number;
  mottle: number[];
  hairLen: number;
  hairCount: number;
  wild: number;
  wave: number;
  comb: number;
  front: number;
  scars: number;
  helm: 'cap' | 'dome' | 'band' | 'pointed';
}

const LOOKS: Look[] = [
  // wiry / grey-green, long stringy hair
  { skin: 0x726848, skin2: 0x524632, mottle: [0x7c7650, 0x584a34, 0x665a3c], hairLen: 0.85, hairCount: 80, wild: 0.55, wave: 0.9, comb: 0.8, front: 0.6, scars: 2, helm: 'cap' },
  // brown, heavy brow, short messy hair
  { skin: 0x7a6444, skin2: 0x58442c, mottle: [0x84704c, 0x5e4a32, 0x6c5a3c], hairLen: 0.17, hairCount: 60, wild: 0.85, wave: 0.5, comb: 0.3, front: 0.6, scars: 3, helm: 'dome' },
  // scarred, pale mottle, shoulder-length hair
  { skin: 0x867450, skin2: 0x5e4e36, mottle: [0x928058, 0x66523a, 0x786844], hairLen: 0.4, hairCount: 70, wild: 0.7, wave: 0.8, comb: 0.4, front: 0.6, scars: 6, helm: 'band' },
  // matted, long hair
  { skin: 0x6c6244, skin2: 0x4c4430, mottle: [0x767050, 0x544a34, 0x605238], hairLen: 0.9, hairCount: 90, wild: 0.75, wave: 1.0, comb: 0.85, front: 0.6, scars: 3, helm: 'pointed' },
];

/** old scars across the brow and cheek (sheet: a diagonal gash over the forehead, nicks on the cheeks) */
function faceScars(ctx: KindContext, rng: Rng, n: number) {
  const hit = (pts: [number, number][], r: number) => faceStroke(ctx, pts, { color: ORC_PALETTE.scar, r: r * 0.75, mat: 'skin_orc', strength: 0.6 });
  hit([[0.13, 0.27], [0.07, 0.19], [0.02, 0.12]], 0.011);
  if (n > 2) hit([[-0.2, -0.04], [-0.15, -0.14], [-0.12, -0.22]], 0.009);
  for (let i = 3; i < n; i++) {
    const x = rng.range(-0.22, 0.22);
    const y = rng.range(-0.18, 0.2);
    hit([[x, y], [x + rng.range(-0.06, 0.06), y - rng.range(0.04, 0.1)]], 0.008);
  }
}

/** pink-red flush over the nose, cheeks, brow and ears (the sheet's skin_variation) */
function flush(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const o = { op: 'paint' as const, color: ORC_PALETTE.flush, mat: 'skin_orc' as const, bone: 'head', k: 0.05 * u, strength: 0.3 };
  s.ellipsoid(P.h(0, -0.1, 0.42), [0.08 * u, 0.07 * u, 0.06 * u], { ...o, strength: 0.4 });
  s.mirrored(() => s.ellipsoid(P.h(0.2, -0.12, 0.3), [0.09 * u, 0.07 * u, 0.07 * u], o));
  s.mirrored(() => s.ellipsoid(P.h(0.16, 0.08, 0.36), [0.1 * u, 0.04 * u, 0.06 * u], { ...o, strength: 0.25 }));
  s.mirrored(() => s.ellipsoid(P.h(0.36, -0.05, -0.02), [0.06 * u, 0.14 * u, 0.1 * u], { ...o, strength: 0.35 }));
}

/** rusty plate over the character's LEFT shoulder (sheet) or both for heavy armour */
function shoulderPlates(ctx: KindContext, rng: Rng, A: number) {
  if (A >= 0.25) rustPauldron(ctx, 'l', { iron: ORC_PALETTE.iron, rust: ORC_PALETTE.rust, rng, size: 1.0 });
  if (A >= 0.75 && !ctx.helmet) rustPauldron(ctx, 'r', { iron: shade(ORC_PALETTE.iron, 0.9), rust: ORC_PALETTE.rust, rng, size: 0.85, lames: 1 });
}

function helmet(ctx: KindContext, look: Look['helm']) {
  const c = ORC_PALETTE.iron;
  const trim = ORC_PALETTE.leatherDark;
  switch (look) {
    case 'cap':
      return domeHelm(ctx, { color: c, trim, trimMat: IRON, mat: IRON, profile: [[0.38, -0.05], [0.385, 0.02], [0.36, 0.14], [0.29, 0.26], [0.2, 0.36], [0.1, 0.42], [0.0, 0.45]], band: false, ridge: false, cheeks: false, rivets: 0, nasal: true, tilt: -0.05 });
    case 'dome':
      return domeHelm(ctx, { color: c, trim, trimMat: IRON, mat: IRON, profile: DOME_ROUND, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 6, neck: 'plates', tilt: -0.06 });
    case 'pointed':
      return domeHelm(ctx, { color: shade(c, 0.85), trim, trimMat: IRON, mat: IRON, profile: DOME_POINTED, finial: 'spike', ridge: false, cheeks: true, nasal: true, rivets: 8, neck: 'plates', tilt: -0.08 });
    case 'band': {
      // an iron band with spikes round the head (a helmet allowed, but this orc wears just the band)
      const { P } = ctx;
      const u = P.headH;
      const band = new THREE.TorusGeometry(0.4 * u, 0.02 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.2).translate(...P.h(0, 0.14, -0.04));
      put(ctx, band, { bone: 'head', color: c, mat: IRON });
      for (let i = 0; i < 6; i++) {
        const a = -1.1 + i * 0.44;
        put(ctx, spike(P.h(Math.sin(a) * 0.4, 0.15, -0.04 + Math.cos(a) * 0.48), [Math.sin(a) * 0.5, 1, Math.cos(a) * 0.3], 0.1 * u, 0.02 * u, 5), { bone: 'head', color: c, mat: IRON, small: true });
      }
    }
  }
}

/** one orc: the sheet's rags, with the bucket's skin, hair and scars */
function dressOrc(ctx: KindContext, rng: Rng, look: Look, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const pal = ORC_PALETTE;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  // ── skin first, so every garment added after keeps its own colour
  skinTint(ctx, { color: look.skin, color2: look.skin2, noise: 0.6, torso: false, legs: true, legRange: [0.25, 0.92], sleeve: 0.5 });
  skinMottle(ctx, rng, look.mottle, { n: 12 });
  eyeRings(ctx, 0x180e0a, 0.8);
  flush(ctx);
  orcTeeth(ctx, rng, { n: 7, big: 1.25, thick: 1.6, color: 0xd8c690 });
  faceScars(ctx, rng, look.scars);
  // ── rag tunic: short torn sleeves, cowl at the throat, hem hidden under the belts and kilt
  ragTunic(ctx, { color: pal.tunic, color2: pal.tunicTrim, inflate: devNum('tun', 0.012) * sc, sleeve: 0.5, hemY: hipY - 0.03 * sc });
  // ── leather baldric from the left shoulder plate to the right hip
  const strap = strapBand(ctx, { color: pal.leather, color2: pal.leatherDark, width: 0.05 * sc, inflate: 0.021 * sc, sign: -1 });
  // ── stacked belt bands: a wide upper one, a thin middle one with hanging rings, and a lower one
  // that hides the kilt's top edge
  const lowerBeltY = hipY + 0.045 * sc;
  const midBeltY = hipY + 0.082 * sc;
  const beltY = hipY + 0.12 * sc;
  beltBand(ctx, { y: beltY, hw: 0.034 * sc, color: pal.leather, color2: pal.leatherDark, inflate: 0.0265 * sc });
  beltBand(ctx, { y: midBeltY, hw: 0.011 * sc, color: pal.leatherDark, color2: pal.leather, inflate: 0.0285 * sc });
  beltBand(ctx, { y: lowerBeltY, hw: 0.02 * sc, color: pal.leatherDark, color2: pal.leather, inflate: 0.0295 * sc });
  // ── long wrapped bracers and shin wraps
  // a thick cuff over about 60 % of the forearm, wrist side (it stands off the arm; nothing cuts the arm itself)
  const bracerLen = 0.6;
  longBracers(ctx, { color: pal.leather, color2: pal.leatherDark, length: bracerLen, inflate: 0.022 * sc });
  const shinBottom = P.ankleH - 0.004 * sc;
  const shinTop = kneeY - 0.012 * sc;
  // wraps up to the knee, ~25 % thicker; the feet are wrapped in the same strap brown (sandals)
  shinWraps(ctx, { color: pal.wrap, color2: pal.leatherDark, top: shinTop, bottom: shinBottom, inflate: 0.013 * sc, feet: true, footInflate: 0.005 * sc });
  // ── armour tiers
  shoulderPlates(ctx, rng, A);
  if (bucket === 3 && A >= 0.75 && !ctx.helmet) scrapBreastplate(ctx, { color: pal.iron, rng, half: 0.55, y0: P.j.chest[1] - 0.02 * sc, y1: P.j.chest[1] + 0.12 * sc, jag: 0.03, seed: 7, mat: IRON });
  if (ctx.helmet) helmet(ctx, look.helm);
  // ── hair: long and stringy, parted over the brow
  const hairGeo = makeOrcHair(
    ctx,
    { color: pal.hair, tip: pal.hairTip, deep: pal.hairDeep, length: look.hairLen * sc, count: ctx.helmet ? 8 : look.hairCount, width: 0.024, wave: look.wave, wild: look.wild, comb: look.comb, front: look.front, back: -0.42, gravity: 7, segments: 6, maxZ: 0.1, part: 0.03 },
    rng,
  );
  if (hairGeo) attachSkinned(ctx, hairGeo, orcHairMaterial());
  // ── rigid fittings go on the finished sculpt
  orcFittings(ctx, { rng, beltY, lowerBeltY, cord: pal.cord, leather: pal.leather, iron: pal.iron, rust: pal.rust, shinTop, shinBottom, bracerLen, strap, plate: true, sleeve: 0.5, tunicEdge: pal.tunic, midBeltY, collar: true, shinR: 0.066 });
}

let hairMat: THREE.MeshPhysicalMaterial | null = null;
/** matted black hair: the kit's strand shader with its bright highlight kept low and warm (the sheet's hair is #19110e with brown sheen) */
function orcHairMaterial(): THREE.MeshPhysicalMaterial {
  if (!hairMat) {
    hairMat = createHairMaterial({ roughness: 0.82, anisotropy: 0.26, sheen: 0.04, sheenColor: 0x2a1e16, highlight: 0x4a3828 });
    hairMat.specularIntensity = 0.1;
    hairMat.userData.shared = true;
  }
  return hairMat;
}

export function orcExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'orc');
  const b = ctxBucket(ctx);
  dressOrc(ctx, rng, LOOKS[b] ?? LOOKS[0], b);
}

export const orcDef: KindDef = {
  label: 'Orc',
  height: devNum('h', 1.725),
  build: { shoulders: devNum('sh', 1.2), hips: 1.02, bulk: devNum('bulk', 0.9), belly: devNum('belly', 0.0), chest: devNum('chest', 1.05), armLength: devNum('arm', 1.15), legLength: devNum('leg', 1.0), headSize: 1.02, neck: 0.6, neckThick: 1.5, hunch: 0.55, handSize: 1.3, footSize: 1.1, muscle: 0.8 },
  face: { ...ORC_FACE, earSize: 1.9, tusks: 0.75 },
  skin: { color: 0x726848, color2: 0x524632, blotch: devNum('blotch', 0.9), blemish: devNum('blemish', 0.6), scars: 3, warts: 0.3, wrinkles: 0.7, lips: 0x5a3c34, brows: 0x1a1612, surface: 'skin_orc', scatter: 0x9a5a40 },
  eyes: { color: 0xd19a2a, glow: 0.25, sclera: 0x8a7a58 },
  hair: { style: 'stringy', color: 0x1d1612, density: 0 },
  beard: null,
  outfit: [
    // the kilt: tattered rag cloth with leather strips over it (sheet: layered, darker redder inner panels)
    // two layers: the long cloth with lighter worn hem, and shorter dark shreds over it at another hem height
    { type: 'skirt', color: ORC_PALETTE.kilt, color2: ORC_PALETTE.kiltHem, mat: 'rags', length: devNum('kilt', 0.8), thickness: devNum('kgrow', 0.03), tatter: 0.07, strips: { count: 8, color: ORC_PALETTE.kiltUnder, color2: ORC_PALETTE.kilt, mat: RAGS, width: 0.085, length: 0.7, phase: 0.2 } },
  ],
  armor: [],
  weapons: { right: 'cleaver', style: 'orc' },
  palette: ORC_PALETTE,
  anim: { hunch: devNum('hunch', 0.35), swagger: 0.6, aggression: 0.75, stance: devNum('stance', 1.25), cadence: 1.1, lean: devNum('lean', 0.85) },
  variation: { height: 0.06, bulk: 0.1, skin: 0.45 },
  detail: { res: devNum('res', 0.058), headRes: devNum('headRes', 0.0125), faceRes: 0, detailScale: 1.0 },
  sfx: { voice: 'orc', grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', weight: 0.5 },
  extras: orcExtras,
};
