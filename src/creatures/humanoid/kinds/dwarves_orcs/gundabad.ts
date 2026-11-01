/**
 * Gundabad orcs (Five Armies), dressed from `docs/refs/gundabad`: huge (2.1 m), pale lilac-grey
 * and heavily muscled with a bare scarred chest, layered spiked scrap-iron pauldrons, an X harness
 * of leather straps over the chest, a wide ringed belt with a hanging spiked plate, a coarse brown
 * kilt with ragged hem and dark leather strips, spiked leather bracers, spiked greaves over wrapped
 * boots, long loose dark hair and a spiked mace in the right hand.
 *
 * The four seed buckets share that dress; they differ in skin cast, hair, scars/ink and the helmet
 * a tier may add (horned dome, spiked brow band, crested dome, conical mail-hooded helm).
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { V3 } from '../../../kit/sdf';
import { createHairMaterial } from '../../../kit/hair';
import type { KindContext, KindDef } from '../../types';
import { box, put, ring, spike, studs, torsoShell } from './armor';
import { attachSkinned, ctxBucket, devNum, mix, recipeRng } from './common';
import { makeHairdo } from './hair';
import { DOME_CONICAL, DOME_POINTED, DOME_ROUND, IRON, STEEL, domeHelm, hornPair } from './headgear';
import { faceStroke, scalpStroke } from './markings';
import { ORC_FACE } from './orc';
import { RAGS, STRAP, armSpikes, beltBand, greaves, longBracers, orcFittings, orcProjector, shinWraps, strapBand } from './orc_gear';
import { boneNecklace, crudePauldron, eyeRings, orcTeeth, skinMottle, skinTint } from './orcparts';

/**
 * Colours from spec.json: kilt #514637 (observed #5e4436..#674e40, warmer), waist bindings #594d38
 * (observed #43352c), scrap iron #726452 (observed #635550), foot wraps #514637 (observed #4c3e33),
 * hair #3a3934 (observed #170f0a), skin #aeb8b5 design but the lit sheet reads pale lilac-grey
 * (arm #8c7e7f, face #b7a9ae), iris #baa24f (the face crop shows amber-orange).
 */
export const GUNDABAD_PALETTE = {
  kilt: 0x4a392b,
  kiltUnder: 0x372a21,
  wrap: 0x453829,
  leather: 0x40322a, // waist bindings
  leatherDark: 0x2a2019,
  iron: 0x3f362f, // scrap iron (design #726452 renders pale and tan under the sky light; the sheet's plates read dark brown-grey)
  rust: 0x7a4a2c,
  cord: 0x6a5238,
  hair: 0x1a1210,
  hairTip: 0x2a201c,
  hairDeep: 0x100b09,
  eyes: 0xc88a2a,
  scar: 0x8a3a3a,
};

const P_ = GUNDABAD_PALETTE;

interface Look {
  skin: number;
  skin2: number;
  mottle: number[];
  hairLen: number;
  hairCount: number;
  scars: number;
}

const LOOKS: Look[] = [
  // pale lilac-grey
  { skin: 0x827a80, skin2: 0x5e5862, mottle: [0x908890, 0x6a626a, 0x7a6a6a], hairLen: 0.62, hairCount: 60, scars: 5 },
  // greyer, heavily inked
  { skin: 0x7a7a80, skin2: 0x585a62, mottle: [0x888890, 0x646870, 0x786a68], hairLen: 0.5, hairCount: 55, scars: 6 },
  // bluish pale
  { skin: 0x7a7e86, skin2: 0x565c68, mottle: [0x8a8e98, 0x626870, 0x766c6e], hairLen: 0.3, hairCount: 60, scars: 4 },
  // warmer, mottled
  { skin: 0x887c7c, skin2: 0x625458, mottle: [0x988888, 0x6c5c5c, 0x7c6a60], hairLen: 0.4, hairCount: 50, scars: 4 },
];

let hairMat: THREE.MeshPhysicalMaterial | null = null;
function gundabadHairMaterial(): THREE.MeshPhysicalMaterial {
  if (!hairMat) {
    hairMat = createHairMaterial({ roughness: 0.8, anisotropy: 0.28, sheen: 0.04, sheenColor: 0x241a16, highlight: 0x544038 });
    hairMat.specularIntensity = 0.1;
    hairMat.userData.shared = true;
  }
  return hairMat;
}

/** the per-bucket helmet a tier may add (the sheet itself is bare-headed) */
function helmet(ctx: KindContext, b: number) {
  const { P } = ctx;
  const dark = 0x2c2b2d;
  const trim = 0x1c1b1c;
  switch (b) {
    case 0:
      domeHelm(ctx, { color: dark, trim, trimMat: STEEL, mat: STEEL, profile: DOME_POINTED, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'plates', tilt: -0.1 });
      hornPair(ctx, { color: 0xcbc3ac, length: 0.8, curl: 0.6, y: 0.18 });
      break;
    case 1: {
      // a heavy spiked iron brow-band
      const u = P.headH;
      put(ctx, new THREE.TorusGeometry(0.41 * u, 0.04 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.2).translate(...P.h(0, 0.13, -0.04)), { bone: 'head', color: dark, mat: STEEL });
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * 0.4;
        put(ctx, spike(P.h(Math.sin(a) * 0.41, 0.15, -0.04 + Math.cos(a) * 0.5), [Math.sin(a) * 0.4, 1, Math.cos(a) * 0.25], 0.14 * u, 0.028 * u, 5), { bone: 'head', color: trim, mat: STEEL, small: true });
      }
      break;
    }
    case 2: {
      domeHelm(ctx, { color: dark, trim, trimMat: STEEL, mat: STEEL, profile: DOME_ROUND, finial: null, ridge: false, cheeks: true, nasal: true, rivets: 20, neck: 'plates', tilt: -0.08 });
      const u = P.headH;
      put(ctx, box(0.04 * u, 0.3 * u, 0.8 * u, [0, 0.0, 0]).translate(...P.h(0, 0.64, -0.08)), { bone: 'head', color: trim, mat: STEEL, small: true });
      break;
    }
    default:
      domeHelm(ctx, { color: dark, trim, trimMat: STEEL, mat: STEEL, profile: DOME_CONICAL, finial: 'spike', ridge: true, cheeks: true, nasal: true, rivets: 18, neck: 'mail', tilt: -0.08 });
  }
}

/** dress one Gundabad orc: the sheet's harness, kilt and iron, plus the bucket's skin/hair/ink */
function dressGundabad(ctx: KindContext, rng: Rng, look: Look, b: number) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  // skin first: the bare chest is part of the look (torso tint), garments come after
  skinTint(ctx, { dim: 1, color: look.skin, color2: look.skin2, noise: 0.55, torso: true, legs: true, legRange: [0.25, 0.9], sleeve: 0 });
  skinMottle(ctx, rng, look.mottle, { n: 14, torso: true, strength: 0.4 });
  eyeRings(ctx, 0x4a2a30, 0.55);
  orcTeeth(ctx, rng, { n: 8, big: 1.7, color: 0xd6c08a, thick: 2.2 });
  // scars: pink-red healed cuts across the face and chest (sheet), plus ink on the brutes
  const scar = (pts: [number, number][], r: number) => faceStroke(ctx, pts, { color: P_.scar, r, mat: 'skin_orc', strength: 0.85 });
  scar([[0.13, 0.26], [0.07, 0.17], [0.03, 0.1]], 0.011);
  scar([[-0.2, -0.03], [-0.15, -0.13], [-0.12, -0.21]], 0.01);
  if (b === 1) {
    const ink = 0x2a3038;
    scalpStroke(ctx, [[0, 0.4], [0, 0.9], [Math.PI, 1.2]], { color: ink, r: 0.014 });
    for (const sd of [1, -1]) scalpStroke(ctx, [[sd * 0.5, 0.3], [sd * 1.2, 0.5], [sd * 2.0, 0.4]], { color: ink, r: 0.011 });
  }
  // X harness over the bare chest, a belt over the kilt's top and bracers
  const strapA = strapBand(ctx, { color: P_.leather, color2: P_.leatherDark, width: 0.052 * sc, inflate: 0.017 * sc, sign: 1 });
  strapBand(ctx, { color: P_.leather, color2: P_.leatherDark, width: 0.052 * sc, inflate: 0.017 * sc, sign: -1 });
  const lowerBeltY = hipY + 0.05 * sc;
  const beltY = hipY + 0.125 * sc;
  beltBand(ctx, { y: beltY, hw: 0.042 * sc, color: P_.leather, color2: P_.leatherDark, inflate: 0.0215 * sc });
  beltBand(ctx, { y: lowerBeltY, hw: 0.024 * sc, color: P_.leatherDark, color2: P_.leather, inflate: 0.025 * sc });
  longBracers(ctx, { color: P_.leather, color2: P_.leatherDark, length: 0.8, inflate: 0.013 * sc });
  const shinBottom = P.ankleH - 0.004 * sc;
  const shinTop = kneeY - 0.03 * sc;
  shinWraps(ctx, { color: P_.wrap, color2: P_.leatherDark, top: shinTop, bottom: shinBottom, inflate: 0.012 * sc, feet: true });
  boneNecklace(ctx, { rng, n: 6 });
  // ── armour tiers: spiked pauldrons, then greaves / bracer spikes / the chest plate
  if (A >= 0.25) {
    crudePauldron(ctx, 'l', { color: P_.iron, mat: IRON, rng, layers: 3, size: 1.3, spikes: 5, trim: P_.rust });
    crudePauldron(ctx, 'r', { color: P_.iron, mat: IRON, rng, layers: 3, size: 1.3, spikes: 5, trim: P_.rust });
  }
  if (ctx.helmet) helmet(ctx, b);
  // ── hair: long, loose, dark
  const hg = makeHairdo(
    ctx,
    { color: P_.hair, tip: P_.hairTip, deep: P_.hairDeep, length: look.hairLen * sc, count: ctx.helmet ? Math.round(look.hairCount * 0.3) : look.hairCount, width: 0.03, wave: 0.8, wild: 0.6, comb: 0.8, front: 0.22, back: -0.4, gravity: 6, segments: 6 },
    rng,
  );
  if (hg) attachSkinned(ctx, hg, gundabadHairMaterial());
  // ── rigid fittings on the finished sculpt
  const proj = orcProjector(ctx, 0.55);
  if (proj) {
    if (A >= 0.5) {
      greaves(ctx, proj, { iron: P_.iron, rust: P_.rust, rng, top: shinTop - 0.01 * sc, bottom: shinBottom + 0.14 * sc, spikes: 3, size: 1.1 });
      armSpikes(ctx, proj, { iron: P_.iron, count: 3, from: 0.28, to: 0.78, len: 0.034 });
      // spiked plate on the breastbone where the harness crosses
      const hp = new THREE.Vector3(), hn = new THREE.Vector3();
      const cy = P.j.chest[1] + 0.08 * sc;
      if (proj.cast(new THREE.Vector3(0, cy, 0.6 * sc), new THREE.Vector3(0, 0, -1), 1.2 * sc, hp, hn)) {
        const m = new THREE.Matrix4().compose(hp.clone().addScaledVector(hn, 0.01 * sc), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hn), new THREE.Vector3(1, 1, 1));
        const g = new THREE.CylinderGeometry(0.052 * sc, 0.03 * sc, 0.012 * sc, 6).rotateX(Math.PI / 2);
        put(ctx, g, { bone: 'chest', color: P_.iron, mat: IRON, matrix: m, small: true });
        const sp = spike([0, 0, 0.004 * sc], [0, 0.2, 1], 0.045 * sc, 0.014 * sc, 5).applyMatrix4(m);
        put(ctx, sp, { bone: 'chest', color: shade2(P_.iron), mat: IRON, small: true });
      }
    }
    orcFittings(ctx, { rng, proj, beltY, lowerBeltY, cord: P_.cord, leather: P_.leather, iron: P_.iron, rust: P_.rust, shinTop, shinBottom, bracerLen: 0.8, strap: strapA, plate: true, plateX: 0.0, plateScale: 1.5, noFringe: true, sleeve: 0, tunicEdge: P_.leather });
  }
}

function shade2(c: number) {
  return mix(c, 0x000000, 0.2);
}

export function gundabadExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'gundabad');
  const b = ctxBucket(ctx);
  dressGundabad(ctx, rng, LOOKS[b] ?? LOOKS[0], b);
}

export const gundabadDef: KindDef = {
  label: 'Gundabad orc',
  height: devNum('h', 2.15),
  build: { shoulders: devNum('sh', 1.3), hips: 1.04, bulk: devNum('bulk', 1.18), belly: 0.0, chest: 1.15, armLength: 1.14, legLength: devNum('leg', 1.02), headSize: 0.95, neck: 0.55, neckThick: 1.5, hunch: 0.28, handSize: 1.35, footSize: 1.2, muscle: 1.0 },
  face: { ...ORC_FACE, brow: 2.0, jaw: 1.4, tusks: 1.0, underbite: 0.85, ears: 'small', earSize: 1.1, eyeSize: 0.95, eyeOpen: 0.85, asym: 0.7 },
  skin: { color: 0x827a80, color2: 0x5e5862, blotch: 0.7, blemish: 0.5, scars: 4, warts: 0.2, wrinkles: 0.6, lips: 0x6a5458, brows: 0x1a1a20, surface: 'skin_orc', scatter: 0xa08090 },
  eyes: { color: 0xc88a2a, glow: 0.2, sclera: 0xb0a89c },
  hair: { style: 'stringy', color: 0x1a1210, density: 0 },
  beard: null,
  outfit: [
    // coarse brown kilt, ragged hem, with dark leather strips hanging over it (sheet)
    { type: 'skirt', color: P_.kilt, color2: P_.kiltUnder, mat: 'rags', length: devNum('kilt', 0.86), thickness: devNum('kgrow', 0.03), tatter: 0.07, strips: { count: 5, color: P_.leatherDark, color2: P_.leather, mat: STRAP, width: 0.07, length: 0.9, phase: 0.2 } },
  ],
  armor: [],
  weapons: { right: 'mace', style: 'orc' },
  palette: GUNDABAD_PALETTE,
  anim: { hunch: 0.3, swagger: 0.5, aggression: 0.85, stance: 1.3 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.35 },
  detail: { res: devNum('res', 0.06), headRes: devNum('headRes', 0.0165), faceRes: 0, detailScale: 1.2 },
  sfx: { voice: 'orc', grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', weight: 0.75 },
  extras: gundabadExtras,
};

void studs;
void torsoShell;
void ring;
void RAGS;
