/**
 * Elven warriors, four looks across the seed buckets:
 *   0  Mirkwood guard  moss-green tunic, gold-bronze leaf-scale armour, green cloak with amber trim, dark hair
 *   1  Galadhrim       fluted golden armour, tall leaf-crested helm, deep red cloak, blond hair with braids
 *   2  Mirkwood guard  amber-brown tunic, darker bronze leaf armour, amber cloak with green trim, auburn hair
 *   3  Galadhrim       fluted golden armour, deep red cloak, black hair with braids, pale blue-grey tunic
 * Armour level (spec.armor) adds vambraces (0.25), the cuirass (0.5) and pauldrons + collar (0.75);
 * the helmet flag shows the helm (a leaf circlet stands in for it on the Mirkwood guard).
 */
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { devNum, shade, withHair, ctxBucket } from './common';
import { addCloak, addSkirt } from './cloth';
import { quiverGear, type QuiverOpts } from '../../gear';
import { BRONZE_LEAF, GOLD_LEAF, POLISHED, flutedCuirass, leafBuckle, leafCuirass, limbGuards, pauldrons } from './armor';
import { elvenHelm, leafCirclet } from './headgear';
import { addHair, noKitHair } from './hair';
import { sculptTorso } from './garments';
import { laceFront } from './detail';
import { addGlaiveHead } from './glaive';
import * as THREE from 'three';

interface ElfLook {
  galadhrim: boolean;
  tunic: number;
  tunicTrim: number;
  metal: number;
  trim: number;
  cloak: number;
  cloakTrim: number;
  hair: number;
  hairTip: number;
  braids: boolean;
  hairLen: number;
  skin?: number;
  scar?: boolean;
}

const LOOKS: ElfLook[] = [
  { galadhrim: false, tunic: 0x4f5c34, tunicTrim: 0x8a6a2e, metal: 0xaf8a4a, trim: 0xd2b062, cloak: 0x36482b, cloakTrim: 0x9a6c2c, hair: 0x2e2118, hairTip: 0x3c2c20, braids: false, hairLen: 0.9 },
  { galadhrim: true, tunic: 0x8f8466, tunicTrim: 0xb09a62, metal: 0xd0ae60, trim: 0xe8d28c, cloak: 0x5c1a24, cloakTrim: 0xc8a050, hair: 0xcdb27c, hairTip: 0xe2cd9a, braids: true, hairLen: 1.0 },
  { galadhrim: false, tunic: 0x6b4c2a, tunicTrim: 0x4a5a30, metal: 0x93703a, trim: 0xc09a54, cloak: 0x7b5626, cloakTrim: 0x3e4d2a, hair: 0x6f361b, hairTip: 0x884726, braids: false, hairLen: 0.8 },
  { galadhrim: true, tunic: 0x58667a, tunicTrim: 0xb0a070, metal: 0xcfb067, trim: 0xe8d490, cloak: 0x641c28, cloakTrim: 0xc09a4c, hair: 0x1b1612, hairTip: 0x2a221c, braids: true, hairLen: 1.0 },
];

function elfExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const L = LOOKS[ctxBucket(ctx)];
  const wool = surface('wool', { rough: 0.9 });
  const tunicMat = surface('cloth', { rough: 0.85, sheen: 0.7, pat: { weave: 1 } });
  const hipY = j.thigh_l[1];
  const cy = j.chest[1];

  // ── hair ──
  withHair(ctx, () => {
    addHair(ctx, { hair: { style: 'long_straight', color: L.hair, tipColor: L.hairTip, length: L.hairLen, density: devNum('density', 0.36), braids: L.braids ? 'temple' : 'none' }, rng: new Rng(hashSeed('elf', 'hair', ctxBucket(ctx))), lod: 1, backClear: 1.35 });
  });

  // ── clothing: tunic with long sleeves, hem panels, cloak ──
  sculptTorso(ctx, { color: L.tunic, mat: tunicMat, inflate: 0.0072 * sc, hem: 0.45, sleeve: 2, neck: true, seams: true, color2: L.tunicTrim, colorNoise: 0.15 });
  addSkirt(ctx, { color: L.tunic, color2: L.tunicTrim, mat: tunicMat, length: 0.55, flare: 0.04 * sc });
  addCloak(ctx, { color: L.cloak, color2: L.cloakTrim, mat: wool, length: L.galadhrim ? 0.95 : 0.85, mantle: true });
  if (A < 0.5) laceFront(ctx, { y0: cy + 0.04 * sc, y1: j.neck[1] - 0.01 * sc, inflate: 0.0085 * sc, color: shade(L.tunicTrim, 0.7), rows: 3, spread: 0.014 });

  // ── armour by level ──
  if (A >= 0.25) limbGuards(ctx, { kind: 'vambrace', color: L.metal, trim: L.trim, mat: L.galadhrim ? POLISHED : BRONZE_LEAF, trimMat: 'gold', length: 0.6, leafy: !L.galadhrim });
  if (A >= 0.5) {
    if (L.galadhrim) flutedCuirass(ctx, { color: L.metal, trim: L.trim, mat: L.galadhrim ? surface('gold', { rough: 0.3, pat: { scratches: 0.5 } }) : GOLD_LEAF, back: true });
    else leafCuirass(ctx, { color: L.metal, trim: L.trim, mat: BRONZE_LEAF, back: true });
    leafBuckle(ctx, { y: hipY + 0.09 * sc, color: L.trim });
  }
  if (A >= 0.75) {
    pauldrons(ctx, { color: L.metal, trim: L.trim, mat: L.galadhrim ? surface('gold', { rough: 0.3, pat: { scratches: 0.5 } }) : BRONZE_LEAF, trimMat: 'gold', lames: 2, size: 0.92, cap: true });
  }

  // ── head ──
  if (ctx.helmet) {
    if (L.galadhrim) elvenHelm(ctx, { color: L.metal, trim: L.trim, mat: surface('gold', { rough: 0.3, pat: { scratches: 0.5 } }), trimMat: 'gold' });
    else elvenHelm(ctx, { color: L.metal, trim: L.trim, mat: BRONZE_LEAF, trimMat: 'gold', crest: 0.55, wings: false });
  } else if (!L.galadhrim) leafCirclet(ctx, { color: L.trim });

  // ── the Mirkwood guard's glaive: a curved leaf blade over the spear head (only while a spear is held) ──
  if (!L.galadhrim) addGlaiveHead(ctx, { blade: 0xc9c5b2, trim: L.trim });

  // ── quiver (kept behind the cloak) ──
  const q: QuiverOpts = {
    center: [-0.03 * sc, cy + 0.05 * sc, -0.215 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.3, 1, -0.05).normalize(),
    length: 0.5 * sc,
    radius: 0.04 * sc,
    color: 0x4a3524,
    trim: L.cloakTrim,
    arrows: 8,
    fletch: 0xece8de,
    shaft: 0xb9a37b,
    bone: 'quiver',
    knives: null,
    seed: 3 + ctxBucket(ctx),
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);
}

export const elfDef: KindDef = {
  label: 'Elf warrior',
  height: 1.86,
  build: { shoulders: 0.98, hips: 0.95, bulk: 0.9, chest: 0.95, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.05, neckThick: 0.9, muscle: 0.4, handSize: 0.97, footSize: 0.97 },
  face: {
    jaw: 0.9,
    chin: 1.08,
    brow: 0.85,
    cheekbones: 1.12,
    nose: { length: 1.0, width: 0.86, bridge: 1.08, tip: 0.85 },
    lips: { width: 0.97, fullness: 0.95 },
    ears: 'pointed',
    eyeSize: 1.08,
    eyeTilt: 0.1,
    eyeOpen: 1.05,
    foreheadSlope: 0.08,
  },
  skin: { color: 0xe2bfa6, color2: 0xd4a68c, blotch: 0.08, blemish: 0.02, wrinkles: 0, lips: 0xb87a72, brows: 0x5a4632, scatter: 0xc87866, surface: 'skin' },
  eyes: { color: 0x5f7a8e, sclera: 0xeee9e0 },
  hair: noKitHair(0xe2bfa6),
  beard: null,
  outfit: [
    { type: 'leggings', color: 0x433f31 },
    { type: 'boots', color: 0x4a3626, color2: 0x33241a, length: 0.9 },
    { type: 'belt', color: 0x3a2a1c },
    // spring bones only: the hem panels and the cloak are built per bucket in extras
    { type: 'skirt', color: 0x4a5a34, chance: 0 },
    { type: 'cloak', color: 0x36482b, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'none', left: 'elven_bow' },
  sfx: { voice: 'elf', weight: 0.4 },
  anim: { grace: 0.9, aggression: 0.3, stance: 0.97, armSwing: 0.9 },
  variation: { height: 0.025, bulk: 0.05, skin: 0.05 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.016), faceRes: 0 },
  extras: elfExtras,
};
