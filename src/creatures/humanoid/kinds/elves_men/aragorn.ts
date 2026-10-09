/**
 * Aragorn, the Ranger (~1.88 m): shoulder-length dark brown wavy hair, a weathered face with
 * stubble and a short beard, a dark linen shirt laced at the neck under a worn leather jerkin and a
 * long dark green-grey coat with a turned-up collar, black leather bracers, a broad belt with
 * pouches and a sword in a leather scabbard at the left hip.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { devNum, devSkip, withHair } from './common';
import { addSkirt } from './cloth';
import { laceFront, sheathed } from './detail';
import { put, studs, tube } from './geo';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptPouch, sculptShoulderCap, sculptTorso } from './garments';
import { limbGuards } from './armor';

const PAL = {
  hair: 0x30261f, // sheet: root #30261f → tip #49372b
  hairTip: 0x49372b,
  skin: 0xbf9478, // #b98e73 weathered
  skin2: 0xa87d62,
  lips: 0xa06860,
  brows: 0x33241a,
  eyes: 0x778077,
  trousers: 0x38332b,
  boots: 0x3b2b1f,
  bootsTrim: 0x2a1e15,
  shirt: 0x403f38,
  jerkin: 0x513c2d, // worn leather #513c2d
  jerkinTrim: 0x3c2c20,
  coat: 0x4c5141, // faded green-grey wool #565b4b
  coatTrim: 0x3a3e31,
  bracers: 0x2a2018,
  belt: 0x2c2018,
  steel: 0x9a9ca0,
};

function aragornExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const cy = j.chest[1];
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const g = Math.sqrt(P.build.bulk);
  const wool = surface('wool', { rough: 0.9, pat: { weave: 0.9, fur: 0.2 } });

  // short dark beard and stubble (sculpted hair volume + skin shadow)
  paintStubble(ctx, { color: 0x2a1d15, paint: 0.5, cheeks: 0.8 });
  sculptBeard(ctx, { color: 0x2c1f16, color2: 0x3d2b1e, thick: devNum('beard', 0.05), cheeks: 0.3, chin: 0.012 });

  withHair(ctx, () => {
    if (!devSkip('hair')) addHair(ctx, { hair: { style: 'shoulder', color: PAL.hair, tipColor: PAL.hairTip, length: 0.95, density: devNum('density', 0.7), braids: 'none' }, rng: new Rng(hashSeed('aragorn', 'hair')), backClear: 1.3 });
  });

  // ── the shirt: dark linen, long sleeves, laced at the throat ──
  sculptTorso(ctx, { color: PAL.shirt, mat: 'linen', inflate: 0.0066 * sc, hem: 0.15, sleeve: 2, neck: true, seams: true });
  laceFront(ctx, { y0: cy + 0.06 * sc, y1: ny - 0.015 * sc, inflate: 0.0075 * sc, color: 0x1e1812, rows: 3, spread: 0.014 });

  // ── the coat: long, dark, with a turned-up collar and a V opening over the jerkin ──
  sculptTorso(ctx, { color: PAL.coat, mat: wool, inflate: 0.0175 * sc, hem: 0.2, sleeve: 2, neck: false, seams: true, frontOpen: { top: 0.048 * sc, bottom: 0.012 * sc, y1: ny } });
  addSkirt(ctx, { color: PAL.coat, color2: PAL.coatTrim, mat: wool, length: 1.55, flare: 0.08 * sc, panels: [[-3.0, -0.3], [0.3, 3.0]], ragged: 0.008 * sc });
  // turned-up collar
  s.group('union', 0.01 * sc, () => {
    s.mirrored(() => s.ellipsoid([0.075 * sc * g, ny + 0.02 * sc, 0.025 * sc], [0.045 * sc, 0.085 * sc, 0.06 * sc], { color: PAL.coat, mat: wool, bone: 'chest', k: 0.02 * sc }));
    s.ellipsoid([0, ny + 0.035 * sc, -0.05 * sc], [0.105 * sc * g, 0.1 * sc, 0.07 * sc], { color: PAL.coat, mat: wool, bone: 'chest', k: 0.02 * sc });
    s.ellipsoid([0, ny + 0.05 * sc, 0.0], [0.07 * sc * P.build.neckThick, 0.14 * sc, 0.088 * sc], { op: 'subtract', k: 0.014 * sc });
    s.ellipsoid([0, ny + 0.03 * sc, 0.1 * sc], [0.05 * sc, 0.1 * sc, 0.075 * sc], { op: 'subtract', k: 0.02 * sc });
  });
  // black leather bracers over the coat sleeves
  limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: 0x6a5a40, mat: 'leather_worn', trimMat: 'metal', length: 0.5, grow: 0.0125 * sc });
  // a leather mantle over the left shoulder (quiver-less ranger's cape strap)
  sculptShoulderCap(ctx, { color: PAL.jerkinTrim, mat: 'leather_worn', side: 'both', inflate: 0.022 * sc, reach: 0.3 });

  // ── belt hardware, pouches and the scabbard ──
  const by = hipY + 0.07 * sc;
  const zf = 0.108 * sc * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * sc;
  put(ctx, new THREE.BoxGeometry(0.044 * sc, 0.036 * sc, 0.008 * sc).translate(0, by, zf), { bone: 'hips', color: PAL.steel, mat: 'metal', small: true });
  sculptPouch(ctx, { x: -0.14 * sc, z: 0.05 * sc, size: 1.0, color: PAL.jerkinTrim, drop: 0.05 });
  sculptPouch(ctx, { x: -0.06 * sc, z: -0.11 * sc, size: 0.8, color: PAL.bracers, drop: 0.04 });
  sheathed(ctx, {
    kind: 'sword',
    hand: 'hand_r',
    pos: [P.hipX + 0.15 * sc, hipY + 0.045 * sc, -0.01 * sc],
    dir: [0.08, -0.9, -0.42],
    len: 0.88,
    r: 0.03 * sc,
    color: 0x2a1e16,
    trim: 0x8a7a58,
    seed: 2,
    weaponStart: 0.09,
  });
  // a strap with a buckle across the chest holding the coat closed
  {
    put(ctx, studs([[0.06 * sc, cy - 0.02 * sc, 0.115 * sc], [-0.06 * sc, cy - 0.02 * sc, 0.115 * sc]], 0.008 * sc), { bone: 'chest', color: PAL.steel, mat: 'metal', small: true });
    put(ctx, tube([[-0.07 * sc, cy - 0.02 * sc, 0.1 * sc], [0, cy - 0.025 * sc, 0.122 * sc], [0.07 * sc, cy - 0.02 * sc, 0.1 * sc]], 0.0045 * sc), { bone: 'chest', color: PAL.bracers, mat: 'leather_worn', small: true });
  }
}

export const aragornDef: KindDef = {
  label: 'Aragorn',
  height: 1.88,
  build: { shoulders: 1.04, hips: 0.98, bulk: 1.02, chest: 1.0, armLength: 1.01, legLength: 1.0, headSize: 0.98, neck: 1.0, neckThick: 1.12, handSize: 1.05, footSize: 1.03, muscle: 0.5 },
  face: {
    jaw: 1.08,
    jawLength: 1.03,
    chin: 1.0,
    brow: 1.12,
    cheekbones: 1.05,
    nose: { length: 1.08, width: 0.95, bridge: 1.1, hook: 0.05, tip: 0.95 },
    lips: { width: 0.95, fullness: 0.9 },
    ears: 'round',
    earSize: 0.95,
    eyeSize: 0.95,
    eyeSpacing: 1.0,
    eyeTilt: 0.02,
    eyeOpen: 0.88,
    foreheadSlope: 0.12,
    asym: 0.06,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.3, blemish: 0.15, wrinkles: 0.4, scars: 1, lips: PAL.lips, brows: PAL.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PAL.eyes, sclera: 0xe6e0d4 },
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'trousers', color: PAL.trousers },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 0.93 },
    { type: 'jerkin', color: PAL.jerkin, color2: PAL.jerkinTrim },
    { type: 'bracers', color: PAL.bracers },
    { type: 'belt', color: PAL.belt },
    // spring bones only: the coat skirt is built in extras
    { type: 'skirt', color: PAL.coat, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'none' },
  palette: PAL,
  sfx: { voice: 'man', hurt: 'hurt', die: 'orc_die', footstep: 'footstep', weight: 0.55 },
  anim: { grace: 0.35, swagger: 0.15, aggression: 0.45, stance: 1.05, armSwing: 1.0, cadence: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.05), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: aragornExtras,
};
