/**
 * Tauriel, captain of the Mirkwood guard (~1.78 m): long straight copper-auburn hair with fine
 * temple braids, a layered green-grey tunic under a laced brown leather vest, a pale green cowl
 * (hood worn down), asymmetric leather shoulder wrap, laced bracers, tall brown boots; a quiver on
 * a baldric, two curved knives sheathed at the hips, a Mirkwood bow.
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { quiverGear, type QuiverOpts } from '../../gear';
import { createWeapon } from '../../../weapons';
import { put, studs, tube } from './geo';
import { sculptCowl, sculptPouch, sculptShoulderCap, sculptStrap } from './garments';
import { shade } from './common';
import { laceFront } from './detail';

const PAL = {
  hair: 0x8f3216,
  hairTip: 0xa8431f,
  skin: 0xeccdb7,
  skin2: 0xe2b9a2,
  lips: 0xb86c66,
  brows: 0x6b2814,
  eyes: 0x4f7c45,
  leggings: 0x363a30,
  boots: 0x5a4128,
  bootsTrim: 0x3c2a1a,
  tunic: 0x4d5a3d,
  tunicTrim: 0x3c4830,
  vest: 0x6b4a2d,
  vestTrim: 0x4e341f,
  bracers: 0x4f3822,
  belt: 0x3a281a,
  cowl: 0x6b7a56,
  shoulder: 0x5c3f26,
  quiver: 0x5a3e28,
  quiverTrim: 0x8a6a44,
  fletch: 0x5b6a3a,
};

function tauriExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const cy = j.chest[1];

  // ── garment layers beyond the kit outfit ──
  // a thin dark under-sleeve is the tunic itself; a pale green cowl sits on the shoulders
  sculptCowl(ctx, { color: PAL.cowl, color2: shade(PAL.cowl, 0.8), size: 1.0, drape: 0.07 });
  // asymmetric layered leather shoulder wrap on the left (+X) shoulder
  sculptShoulderCap(ctx, { color: PAL.shoulder, mat: 'leather_worn', side: 'l', inflate: 0.024 * sc, reach: 0.55 });
  // baldric across the chest for the quiver (right shoulder to left hip)
  sculptStrap(ctx, { color: PAL.quiver, mat: 'leather_worn', width: 0.032 * sc, inflate: 0.026 * sc, sign: 1 });
  // belt pouches
  sculptPouch(ctx, { x: -0.115 * sc, z: 0.045 * sc, size: 0.85, color: PAL.belt });
  sculptPouch(ctx, { x: 0.12 * sc, z: 0.04 * sc, size: 0.7, color: PAL.bracers, drop: 0.07 });
  // lacing down the vest front
  laceFront(ctx, { y0: j.chest[1] - 0.075 * sc, y1: j.neck[1] - 0.04 * sc, inflate: 0.0165 * sc, color: 0x2e2014 });
  // brass studs on the vest edge
  {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) pts.push([0.088 * sc, cy + 0.18 * sc - i * 0.045 * sc, 0.088 * sc]);
    void pts;
  }

  // ── quiver on the back, strap crossing the chest ──
  const q: QuiverOpts = {
    center: [-0.03 * sc, cy + 0.03 * sc, -0.165 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.3, 1, -0.05).normalize(),
    length: 0.54 * sc,
    radius: 0.044 * sc,
    color: PAL.quiver,
    trim: PAL.quiverTrim,
    arrows: 14,
    fletch: PAL.fletch,
    shaft: 0xb9a37b,
    bone: 'quiver',
    knives: null,
    seed: 11,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);

  // ── two curved knives in hip sheaths (hidden while drawn) ──
  for (const side of [1, -1] as const) {
    const hand = side > 0 ? 'hand_l' : 'hand_r';
    const hip = j.thigh_l;
    const x = side * (P.hipX + 0.11 * sc * Math.sqrt(P.build.bulk));
    const sheath = tube([[x, hip[1] + 0.06 * sc, 0.0], [x + side * 0.012 * sc, hip[1] - 0.06 * sc, 0.022 * sc], [x + side * 0.02 * sc, hip[1] - 0.15 * sc, 0.05 * sc]], 0.019 * sc, { seg: 8, radial: 6 });
    put(ctx, sheath, { bone: 'hips', color: PAL.belt, mat: 'leather_worn', small: true });
    const stud = studs([[x + side * 0.003 * sc, hip[1] + 0.055 * sc, 0.0]], 0.012 * sc);
    put(ctx, stud, { bone: 'hips', color: 0x9a8040, mat: 'gold', small: true });
    ctx.object(
      () => {
        const k = createWeapon('elven_knives', side > 0 ? 5 : 6);
        k.userData.stowFor = { hand, weapon: 'elven_knives' };
        return k;
      },
      { socket: side > 0 ? 'hip_l' : 'hip_r', small: true },
    );
  }
}

export const taurielDef: KindDef = {
  label: 'Tauriel',
  height: 1.78,
  build: { shoulders: 0.84, hips: 1.1, bulk: 0.78, chest: 0.9, armLength: 0.99, legLength: 1.04, headSize: 0.95, neck: 1.06, neckThick: 0.78, handSize: 0.88, footSize: 0.9, muscle: 0.22 },
  face: {
    jaw: 0.8,
    jawLength: 0.96,
    chin: 0.95,
    brow: 0.62,
    cheekbones: 1.2,
    nose: { length: 0.9, width: 0.78, bridge: 0.95, hook: 0, tip: 0.8 },
    lips: { width: 0.96, fullness: 1.25 },
    ears: 'pointed',
    earSize: 0.96,
    eyeSize: 1.14,
    eyeSpacing: 1.02,
    eyeTilt: 0.1,
    eyeOpen: 1.1,
    foreheadSlope: 0.06,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.08, blemish: 0.02, wrinkles: 0, lips: PAL.lips, brows: PAL.brows, scatter: 0xc87a68, surface: 'skin' },
  eyes: { color: PAL.eyes, sclera: 0xefeae2 },
  hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, braids: 'temple', length: 1.0, density: 0.85, bounce: 0.8 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.leggings },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 0.93 },
    { type: 'tunic', color: PAL.tunic, color2: PAL.tunicTrim, length: 0.62 },
    { type: 'vest', color: PAL.vest, color2: PAL.vestTrim },
    { type: 'bracers', color: PAL.bracers },
    { type: 'belt', color: PAL.belt },
  ],
  armor: [],
  weapons: { right: 'none', left: 'elven_bow' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.3 },
  anim: { grace: 1, swagger: 0.05, aggression: 0.3, stance: 0.95, armSwing: 0.85, cadence: 1.02 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { detailScale: 1, faceRes: 0.0058 },
  extras: tauriExtras,
};
