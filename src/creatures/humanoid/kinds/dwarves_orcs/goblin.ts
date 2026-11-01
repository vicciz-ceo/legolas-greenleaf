/**
 * Moria goblins, dressed from `docs/refs/goblin`: pale pinkish-grey, wiry and long-limbed, huge
 * glinting amber eyes, big bat ears, sparse stringy dark hair; a coarse brown rag wrap over the
 * torso (sleeveless, torn at the neck), a ragged kilt on a fibrous waist binding with a rusty
 * plate hanging at the hip and another strapped to the left shoulder, wrapped feet and ankles,
 * a crude serrated blade in the right hand.
 *
 * The four seed buckets keep the same rags and differ by what a tier adds: bare scrambler, ragged
 * hood, pot helmet, bone-and-paint shaman.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { createHairMaterial } from '../../../kit/hair';
import type { KindContext, KindDef } from '../../types';
import { box, put, spike } from './armor';
import { scaleHeldWeapon } from '../uruks_bosses/common';
import { attachSkinned, ctxBucket, devNum, recipeRng } from './common';
import { makeOrcHair } from './orc_hair';
import { IRON, domeHelm } from './headgear';
import { faceStroke } from './markings';
import { RAGS, STRAP, armMass, beltBand, orcFittings, ragTunic, rustPauldron, shinWraps } from './orc_gear';
import { boneNecklace, eyeRings, orcTeeth, skinMottle, skinTint } from './orcparts';

const FACE = {
  jaw: 1.05, jawLength: 1.05, chin: 0.6, brow: 1.25, cheekbones: 1.0,
  nose: { length: 0.8, width: 1.1, bridge: 0.4, hook: 0.35, tip: 0.9, flat: 0.5 },
  lips: { width: 1.35, fullness: 0.6 }, ears: 'small' as const, earSize: 0.7, eyeSize: 1.55, eyeSpacing: 1.1, eyeTilt: 0.08,
  eyeOpen: 1.25, tusks: 0.3, underbite: 0.4, foreheadSlope: 0.45, asym: 0.85, cranium: 1.12,
};

/**
 * spec.json: rag wrap #554b3a (observed #694932, lit), waist binding #594a34 (observed #2a1c10),
 * rusty plates #665d4c (observed #5f4634), skin #9a9e92 design but the lit sheet is a warm pinkish
 * grey (arm median #796c61, face #766c63), hair #393a30 (observed #3e3128), iris #bb8b32.
 */
export const GOBLIN_PALETTE = {
  wrap: 0x4e3b2a,
  wrapTrim: 0x362a1e,
  kilt: 0x4a3826,
  kiltUnder: 0x33271c,
  binding: 0x3a2d1e,
  iron: 0x4a3f34,
  rust: 0x7a4a2c,
  cord: 0x6a5238,
  hair: 0x2a2420,
  hairTip: 0x2a2420,
  skin: 0x8e7c70, // warmer than the lit pinkish grey: the kit's skin shader adds a green cast to orc skin
  skin2: 0x705a4e,
  scar: 0x8a4a40,
};

const G = GOBLIN_PALETTE;

let hairMat: THREE.MeshPhysicalMaterial | null = null;
function goblinHairMaterial(): THREE.MeshPhysicalMaterial {
  if (!hairMat) {
    hairMat = createHairMaterial({ roughness: 0.85, anisotropy: 0.2, sheen: 0.03, sheenColor: 0x2a2018, highlight: 0x4a3a2e });
    hairMat.specularIntensity = 0.08;
    hairMat.userData.shared = true;
  }
  return hairMat;
}

/** a ragged hood with a long drooping point and a ragged face opening */
function raggedHood(ctx: KindContext, color: number) {
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
}

function addons(ctx: KindContext, b: number) {
  const { P } = ctx;
  const sc = P.s;
  switch (b) {
    case 1:
      raggedHood(ctx, 0x3a3228);
      break;
    case 2:
      if (ctx.helmet) domeHelm(ctx, { color: G.iron, trim: 0x3a3028, trimMat: IRON, mat: IRON, profile: [[0.42, -0.06], [0.43, 0.04], [0.4, 0.17], [0.32, 0.3], [0.2, 0.4], [0.1, 0.45], [0.0, 0.47]], band: true, ridge: false, cheeks: false, rivets: 10, nasal: false, finial: 'spike', tilt: 0.12, y: -0.04 });
      break;
    case 3: {
      // white face paint, a bone necklace and (with a helmet) a horned skull band
      for (const sd of [1, -1]) {
        faceStroke(ctx, [[sd * 0.2, 0.1], [sd * 0.14, -0.1], [sd * 0.07, -0.28]], { color: 0xddd8c8, r: 0.02, mat: 'skin_orc', strength: 0.9 });
        faceStroke(ctx, [[sd * 0.28, -0.05], [sd * 0.2, -0.15]], { color: 0xddd8c8, r: 0.014, mat: 'skin_orc', strength: 0.9 });
      }
      if (ctx.helmet) {
        const u = P.headH;
        for (const sd of [1, -1]) put(ctx, spike(P.h(sd * 0.22, 0.28, 0.0), [sd * 0.9, 1, -0.2], 0.28 * u, 0.04 * u, 5), { bone: 'head', color: 0xcfc4a2, mat: 'bone' });
        put(ctx, new THREE.TorusGeometry(0.39 * u, 0.025 * u, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 1.18).translate(...P.h(0, 0.16, -0.04)), { bone: 'head', color: 0x4a3a2a, mat: 'leather_worn' });
      }
      put(ctx, box(0.05 * sc, 0.06 * sc, 0.02 * sc, [0.0, P.j.thigh_l[1] + 0.07 * sc, 0.1 * sc]), { bone: 'hips', color: 0x8a7a50, mat: 'bone', small: true });
      break;
    }
    default:
  }
}

/**
 * The sheet's big pointed bat ears as thin rigid leaves (the kit's ear at crowd resolution is too
 * small to read): a blade rising from the skull side, pink inside, with a darker rim.
 */
function batEars(ctx: KindContext, skin: number) {
  const { P } = ctx;
  const pink = new THREE.Color().setHex(0xb07868, THREE.SRGBColorSpace);
  const base = new THREE.Color().setHex(skin, THREE.SRGBColorSpace);
  for (const sd of [1, -1]) {
    const A = P.h(sd * 0.33, -0.2, -0.02);
    const B = P.h(sd * 0.36, 0.1, 0.1);
    const T = P.h(sd * 1.0, 0.46, -0.12);
    const C = P.h(sd * 0.36, 0.08, -0.17);
    const M = P.h(sd * 0.62, 0.12, -0.04);
    const tris = [[A, B, M], [B, T, M], [T, C, M], [C, A, M]];
    const pos: number[] = [];
    for (const [a, b, c] of tris) pos.push(...a, ...b, ...c, ...a, ...c, ...b);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    put(ctx, g, {
      bone: 'head',
      color: skin,
      mat: 'skin_orc',
      colorFn: (p, _n, c) => {
        const f = Math.min(1, Math.max(0, (Math.abs(p.x) - Math.abs(M[0]) * 0.6) / (Math.abs(T[0]) - Math.abs(M[0]) * 0.6)));
        c.copy(base).lerp(pink, 0.55 * (1 - f * 0.6));
      },
    });
  }
}

/** the sheet's goblin: rag wrap, binding, rusty plates, wrapped feet, sparse stringy hair */
function dressGoblin(ctx: KindContext, rng: Rng, b: number) {
  const { P } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const skinTone = [
    [G.skin, G.skin2, [0xa88a78, 0x705a4e, 0x96705e]],
    [0x7e7468, 0x5a5248, [0x8a8070, 0x62584c, 0x7c6a60]],
    [0x948068, 0x706050, [0xa49078, 0x76644e, 0x8a7258]],
    [0x7a7a78, 0x585a5c, [0x8a8a86, 0x626466, 0x78706c]],
  ][b] as [number, number, number[]] | undefined;
  const tone = skinTone ?? [G.skin, G.skin2, [0xa88a78, 0x705a4e, 0x96705e]];
  skinTint(ctx, { color: tone[0], color2: tone[1], noise: 0.55, torso: true, legs: true, sleeve: 0, legRange: [0.15, 0.95] });
  skinMottle(ctx, rng, tone[2], { n: 12, torso: true, strength: 0.4 });
  armMass(ctx, { color: tone[0], color2: tone[1], inflate: 0.01 * sc });
  eyeRings(ctx, 0x24160f, 0.85);
  {
    // heavy dark brow ridge shading above the big amber eyes
    const { sculpt: s } = ctx;
    const u = P.headH;
    s.mirrored(() => s.ellipsoid(P.h(0.15, 0.06, 0.36), [0.11 * u, 0.045 * u, 0.06 * u], { op: 'paint', color: 0x3a2a22, mat: 'skin_orc', bone: 'head', k: 0.04 * u, strength: 0.65 }));
  }
  orcTeeth(ctx, rng, { n: 10, big: 0.8, color: 0xd8cca0 });
  if (b === 3) boneNecklace(ctx, { rng, n: 9 });
  // ── rag wrap over the torso (sleeveless), diagonal tie, waist binding
  ragTunic(ctx, { color: b === 1 ? 0x3a3026 : G.wrap, color2: G.wrapTrim, inflate: 0.012 * sc, sleeve: 0.6, hemY: hipY - 0.02 * sc, cowl: true });
  const lowerBeltY = hipY + 0.045 * sc;
  beltBand(ctx, { y: hipY + 0.1 * sc, hw: 0.026 * sc, color: G.binding, color2: G.wrapTrim, mat: RAGS, inflate: 0.0215 * sc });
  beltBand(ctx, { y: lowerBeltY, hw: 0.014 * sc, color: G.binding, color2: G.wrapTrim, mat: STRAP, inflate: 0.0245 * sc });
  // wrapped ankles and feet
  const shinBottom = P.ankleH - 0.004 * sc;
  const shinTop = P.ankleH + 0.075 * sc;
  shinWraps(ctx, { color: G.wrap, color2: G.wrapTrim, top: shinTop, bottom: shinBottom, inflate: 0.011 * sc, feet: true });
  // ── rusty plate strapped to the left shoulder
  rustPauldron(ctx, 'l', { iron: G.iron, rust: G.rust, rng, size: 0.62, lames: 1 });
  batEars(ctx, tone[0]);
  addons(ctx, b);
  // ── sparse long stringy hair (the sheet's crown is nearly bald)
  const hg = makeOrcHair(
    ctx,
    { color: G.hair, tip: G.hairTip, deep: 0x1a140f, length: (b === 3 ? 0.2 : 0.17) * sc, count: ctx.helmet ? 8 : 12, width: 0.008, wave: 0.5, wild: 0.3, comb: 0.3, front: 0.45, back: -0.42, gravity: 7, segments: 5, maxY: 0.0, maxZ: -0.02 },
    rng,
  );
  if (hg) attachSkinned(ctx, hg, goblinHairMaterial());
  orcFittings(ctx, { rng, beltY: hipY + 0.1 * sc, lowerBeltY, cord: G.cord, leather: G.binding, iron: G.iron, rust: G.rust, shinTop, shinBottom, bracerLen: 0.7, plate: true, plateX: 0.1, plateScale: 0.75, noCords: true, sleeve: 0.6, tunicEdge: G.wrap, collar: true });
}

export function goblinExtras(ctx: KindContext) {
  const rng = recipeRng(ctx, 'goblin');
  scaleHeldWeapon(ctx, 'hand_r', ['scimitar'], [0.5, 0.5, 0.5]);
  dressGoblin(ctx, rng, ctxBucket(ctx));
}

export const goblinDef: KindDef = {
  label: 'Moria goblin',
  height: devNum('h', 1.48),
  // sheet: lean and wiry with long limbs (bulk 0.15), deep crouch, big head, bat ears
  build: { shoulders: devNum('sh', 0.95), hips: devNum('hips', 0.9), bulk: devNum('bulk', 0.8), belly: 0.0, chest: 0.9, armLength: devNum('arm', 1.32), legLength: devNum('leg', 0.9), headSize: 1.26, neck: 0.75, neckThick: 0.8, hunch: 0.78, handSize: 1.45, footSize: 1.25, muscle: 0.45 },
  face: FACE,
  skin: { color: G.skin, color2: G.skin2, blotch: 0.5, blemish: 0.5, scars: 2, warts: 0.6, wrinkles: 0.7, lips: 0x7a5a54, brows: 0x3a3028, surface: 'skin_orc', scatter: 0xb08070 },
  // large glinting amber eyes (#bb8b32)
  eyes: { color: 0xd08a1c, glow: 0.9, sclera: 0x8a7a5a },
  hair: { style: 'stringy', color: G.hair, density: 0 },
  beard: null,
  outfit: [
    // the kilt: a ragged rag skirt to the knees (the torso wrap and binding are sculpted in extras)
    { type: 'skirt', color: G.kilt, color2: G.kiltUnder, mat: 'rags', length: devNum('kilt', 0.66), thickness: 0.012, tatter: 0.05 },
  ],
  armor: [],
  // the sheet's blade is short, curved and serrated, with a wrapped grip: the orc scimitar, scaled down
  weapons: { right: 'scimitar', style: 'orc' },
  palette: GOBLIN_PALETTE,
  // sheet: a deep scrambling crouch
  anim: { hunch: devNum('hunch', 0.3), swagger: 0.3, aggression: 0.9, stance: devNum('stance', 1.4), cadence: 1.2, armSwing: 1.3, crouch: devNum('crouch', 0.9), lean: devNum('lean', 0.3) },
  variation: { height: 0.06, bulk: 0.1, skin: 0.45 },
  detail: { res: devNum('res', 0.058), headRes: devNum('headRes', 0.0135), faceRes: 0, detailScale: 0.9 },
  sfx: { voice: 'goblin', grunt: 'goblin_screech', die: 'orc_die', roar: 'goblin_screech', weight: 0.35 },
  extras: goblinExtras,
};


