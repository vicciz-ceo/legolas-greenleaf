/**
 * Tauriel, captain of the Mirkwood guard (~1.78 m): long straight copper-auburn hair with fine
 * temple braids, a layered green wool tunic (long sleeves, pointed hem panels) under a laced,
 * tooled brown leather corset, a draped pale-green cowl, green capelets, long tooled bracers, tall
 * folded-cuff boots; a quiver on a baldric with a bronze ring, two curved knives in brass-collared
 * sheaths at the hips, a Mirkwood bow. Refined against docs/refs/tauriel (sheet palette, landmark
 * heights measured on the calibrated compare).
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { quiverGear, type QuiverOpts } from '../../gear';
import { surface } from '../../../kit/surfaces';
import { sculptPouch, sculptShoulderCap, sculptStrap, slab } from './garments';
import { devNum, shade } from './common';
import { laceFront, sheathed } from './detail';
import { torsoCentreFront } from './geo';
import { makeProjector, snapPoint, placeAlong as placeOn, V } from '../uruks_bosses/common';

/** embossed leaf-work leather (corset, bracers, boots, quiver, capelet trim) */
const TOOLED = surface('leather_tooled', { rough: 0.62, sheen: 0.1 });
/** wool twill: tunic (sheet: coarse woven green wool, roughness 0.85) */
const TWILL = surface('twill', { rough: 0.88, sheen: 0.22 });
/** fitted wool for the leggings */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.15, pat: { weave: -0.6 } });
/** soft draped wool (cowl, capelets) */
const DRAPE = surface('twill', { rough: 0.9, sheen: 0.3, pat: { weave: 0.4 } });

// sRGB design colours from docs/refs/tauriel/spec.json, cross-checked against observed.samples and
// the turnaround. Greens are desaturated (they rendered mint under sky light) and skin is warmer
// and deeper than the sheet hex (a pale albedo renders as clay).
const PAL = {
  hair: 0x652f17, // sheet root #703820 (observed lit #5c2c1b) — slightly deeper so the lab's sheen doesn't wash it orange
  hairTip: 0x8f4a28, // sheet tip #a35730
  skin: 0xe0bda2, // sheet #e0bfa5 (observed lit #d39e8a) // sheet #e0bfa5 (observed #d39e8a); warmer/deeper like Legolas
  skin2: 0xd2a98e,
  lips: 0xa65e56,
  brows: 0x7a3a22,
  eyes: 0x6b8274, // sheet iris #738277 grey-green, a touch darker
  leggings: 0x292d21, // observed #3a3728 under wool sheen; design cloth #45553a
  tunic: 0x2d3427, // design cloth #45553a, desaturated
  tunicTrim: 0x242b1e, // darker hem band
  tunicPanel: 0x293024, // second layer of pointed hem panels
  cowl: 0x4a5a3c, // pale green draped wool (turnaround reads lighter than the tunic)
  capelet: 0x354229,
  corset: 0x573e2b, // design leather #624630 (observed #503b33)
  corsetTrim: 0x6b4d36, // lighter tooling / wear mottle
  bracers: 0x47362a, // observed #4e3c34
  bracersTrim: 0x382b20,
  boots: 0x443323, // observed #3f3025
  bootsTrim: 0x2f2218,
  belt: 0x4a3626, // observed #5a433a (lit)
  strap: 0x5a4330,
  bronze: 0x9a8762, // design metal #9a8762
  bootsCuff: 0x6a4f35, // folded boot cuff (lighter, worn)
  hemBronze: 0x4d4228, // gold-bronze trim on the tunic hem points
  quiver: 0x5a4330,
  quiverTrim: 0x8a6a44,
  fletch: 0xdcd3be, // sheet: cream feathers on dark shafts
  shaft: 0x5c4733,
  lace: 0x2e2014,
};
/** belt raised to the waist: sheet belt at ~1.07 m (the kit puts it at hip + 0.07) */
const BELT_RAISE = 0.05;

/** a tooled, laced corset: torso parts inflated, cut at the underbust hem and the neckline with a
 *  small plunge at the centre front (the sheet's corset ends below the cowl, tunic shows above) */
function corset(ctx: KindContext, o: { y0: number; y1: number; inflate: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.0025 * sc, () => {
    emitParts(s, parts, ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back'], {
      color: PAL.corset,
      color2: PAL.corsetTrim,
      colorNoise: 0.4,
      colorFreq: 34 / sc,
      mat: TOOLED,
      inflate: o.inflate,
    });
    slab(s, o.y0, o.y1, 0.005 * sc, true);
    // centre-front plunge
    const pts: [number, number, number][] = [];
    const radii: number[] = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const y = o.y1 + 0.02 * sc - f * 0.075 * sc;
      pts.push([0, y, torsoCentreFront(P, Math.min(y, P.j.chest[1] + 0.17 * sc)) + o.inflate * 0.6]);
      radii.push(Math.max(0.004 * sc, 0.03 * sc * (1 - f)));
    }
    s.tube(pts, radii, { op: 'subtract', k: 0.006 * sc });
  });
}


/** a thin, smooth cowl: a slim roll on the collarbones, a small bunched hood on the back and a deep
 *  scooped V at the front that ends at the corset top (a lighter copy of the shared sculptCowl) */
function cowl(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const ny = P.j.neck[1];
  const z = -0.004 * sc;
  const r = (0.07 * P.build.neckThick * g + 0.022) * sc;
  const w = { color: PAL.cowl, color2: shade(PAL.cowl, 0.85), colorNoise: 0.35, colorFreq: 18 / sc, mat: DRAPE, bone: 'neck' };
  s.with(w, () => {
    s.group('union', 0.02 * sc, () => {
      s.torus([0, ny - 0.012 * sc, z + 0.008 * sc], r + 0.012 * sc, 0.019 * sc, { k: 0.015 * sc, rot: [-0.4, 0, 0] });
      s.torus([0, ny - 0.04 * sc, z + 0.014 * sc], r + 0.026 * sc, 0.014 * sc, { k: 0.015 * sc, rot: [-0.55, 0, 0] });
      // the hood bunched on the upper back
      s.ellipsoid([0, ny - 0.035 * sc, z - 0.065 * sc], [0.09 * sc * g, 0.05 * sc, 0.045 * sc], { bone: 'chest', k: 0.025 * sc });
      s.mirrored(() => s.ellipsoid([0.09 * sc * g, ny - 0.03 * sc, z - 0.015 * sc], [0.04 * sc, 0.03 * sc, 0.045 * sc], { bone: 'chest', k: 0.02 * sc }));
      // deep scooped V: from the throat down to the corset top
      s.ellipsoid([0, ny - 0.05 * sc, z + r + 0.05 * sc], [0.05 * sc, 0.082 * sc, 0.06 * sc], { op: 'subtract', k: 0.02 * sc });
    });
  });
}

function tauriExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const cy = j.chest[1];
  const hipY = j.thigh_l[1];
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;
  const parts = anatomyParts(P);

  // ── garment layers beyond the kit outfit ──
  // the pale green cowl sits on the shoulders, a hood bunched at the back
  cowl(ctx);
  // small green wool capelets over both shoulder points
  sculptShoulderCap(ctx, { color: PAL.capelet, mat: DRAPE, side: 'both', inflate: 0.013 * sc, reach: 0.44 });
  // tooled corset from just under the belt to the bust
  corset(ctx, { y0: beltY - 0.05 * sc, y1: cy + 0.115 * sc, inflate: 0.0145 * sc });
  // baldric across the chest for the quiver (right shoulder to left hip)
  const n = new THREE.Vector3(1.0, 1.25, 0).normalize();
  const c = n.dot(new THREE.Vector3(0, cy + 0.05 * sc, 0));
  sculptStrap(ctx, { color: PAL.strap, mat: 'leather_worn', width: 0.03 * sc, inflate: 0.0215 * sc, sign: 1 });
  // belt pouches
  sculptPouch(ctx, { x: -0.115 * sc, z: 0.045 * sc, size: 0.8, color: PAL.belt, drop: 0.02 });
  sculptPouch(ctx, { x: 0.12 * sc, z: 0.04 * sc, size: 0.65, color: PAL.bracers, drop: 0.06 });
  // lacing down the corset front
  laceFront(ctx, { y0: beltY - 0.035 * sc, y1: cy + 0.06 * sc, inflate: 0.0165 * sc, color: PAL.lace, rows: 6, spread: 0.018 });

  // ── raised rolls at both bracer ends (tooled cuffs, like Legolas') ──
  const L = P.hand.l.L;
  const bracerLen = 0.86;
  const fromB = 1 - bracerLen;
  const roll = (t0: number, t1: number) =>
    s.mirrored(() =>
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: PAL.bracersTrim, mat: 'leather_worn', inflate: 0.0158 * sc, k: 0.02 * sc, oneSide: true });
        const a0: [number, number, number] = [j.forearm_l[0] + L.x * P.foreArm * t0, j.forearm_l[1] + L.y * P.foreArm * t0, j.forearm_l[2]];
        const a1: [number, number, number] = [j.forearm_l[0] + L.x * P.foreArm * t1, j.forearm_l[1] + L.y * P.foreArm * t1, j.forearm_l[2]];
        s.plane([-L.x, -L.y, -L.z], -(L.x * a0[0] + L.y * a0[1] + L.z * a0[2]), { op: 'intersect', k: 0.003 * sc });
        s.plane([L.x, L.y, L.z], L.x * a1[0] + L.y * a1[1] + L.z * a1[2], { op: 'intersect', k: 0.003 * sc });
      }),
    );
  roll(fromB + 0.004, fromB + 0.045);
  const wristT = 1 - (0.008 * sc) / P.foreArm;
  roll(wristT - 0.06, wristT - 0.012);

  // ── boots: a flared folded cuff in the trim colour at the knee and a heel block ──
  {
    const topY = j.shin_l[1];
    s.group('union', 0.003 * sc, () => {
      emitParts(s, parts, ['shin', 'calf'], { color: PAL.bootsCuff, mat: TOOLED, inflate: 0.021 * sc, k: 0.02 * sc });
      slab(s, topY - 0.07 * sc, topY + 0.004 * sc, 0.004 * sc, true);
    });
    s.mirrored(() => {
      const f = j.foot_l;
      s.box([f[0] + 0.004 * sc, 0.024 * sc, f[2] - 0.042 * sc], [0.03 * sc, 0.024 * sc, 0.03 * sc], 0.006 * sc, { color: PAL.bootsTrim, mat: 'leather_worn', bone: 'foot_l', k: 0.005 * sc });
    });
  }

  // ── quiver on the right back (sheet: mouth over the right shoulder, cream fletchings) ──
  const q: QuiverOpts = {
    center: [-0.06 * sc, cy + 0.03 * sc, -0.165 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.3, 1, -0.05).normalize(),
    length: 0.54 * sc,
    radius: 0.044 * sc,
    color: PAL.quiver,
    trim: PAL.quiverTrim,
    arrows: 14,
    fletch: PAL.fletch,
    shaft: PAL.shaft,
    bone: 'quiver',
    mat: TOOLED,
    knives: null,
    seed: 11,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);

  // ── two curved knives in brass-collared sheaths at the hips (hidden while drawn) ──
  for (const side of [1, -1] as const) {
    sheathed(ctx, {
      kind: 'elven_knives',
      hand: side > 0 ? 'hand_l' : 'hand_r',
      pos: [side * (P.hipX + 0.13 * sc * Math.sqrt(P.build.bulk)), beltY + 0.045 * sc, -0.07 * sc],
      dir: [side * 0.07, -0.85, -0.52],
      len: 0.33,
      r: 0.021 * sc,
      color: PAL.belt,
      trim: PAL.bronze,
      mat: TOOLED,
      seed: side > 0 ? 5 : 6,
    });
  }

  // ── bronze ring where the baldric crosses the right breast (turnaround) ──
  const proj = makeProjector(s, { min: [-0.4 * sc, cy - 0.3 * sc, -0.3 * sc], max: [0.4 * sc, j.neck[1] + 0.1 * sc, 0.4 * sc] });
  if (proj) {
    const bx = -0.07 * sc;
    const by = (c - n.x * bx) / n.y;
    const hp = V(), hn = V();
    if (snapPoint(proj, [bx, by, 0.3 * sc], 'f', hp, hn)) {
      const along = V(-n.y, n.x, 0);
      const m = placeOn(hp.addScaledVector(hn, 0.002 * sc), hn, along);
      const ring = new THREE.TorusGeometry(0.0155 * sc, 0.0034 * sc, 6, 18).rotateX(Math.PI / 2);
      ctx.gear(ring, { bone: 'chest', color: PAL.bronze, mat: 'metal', matrix: m, small: true });
      const bar = new THREE.CylinderGeometry(0.0023 * sc, 0.0023 * sc, 0.031 * sc, 5).rotateZ(Math.PI / 2);
      ctx.gear(bar, { bone: 'chest', color: PAL.bronze, mat: 'metal', matrix: m, small: true });
    }
  }
}

export const taurielDef: KindDef = {
  label: 'Tauriel',
  height: 1.78,
  build: { shoulders: 0.84, hips: 1.1, bulk: 0.78, chest: 0.9, armLength: 0.99, legLength: 1.04, headSize: 0.95, neck: 1.06, neckThick: 0.78, handSize: 0.88, footSize: 0.9, muscle: 0.1 },
  face: {
    jaw: 0.8,
    jawLength: 0.96,
    chin: 0.95,
    brow: 0.62,
    cheekbones: 1.2,
    nose: { length: 0.88, width: 0.84, bridge: 0.95, hook: 0, tip: 0.9 },
    lips: { width: 0.9, fullness: 0.85 },
    ears: 'pointed',
    earSize: 0.96,
    eyeSize: 1.14,
    eyeSpacing: 1.02,
    eyeTilt: 0.1,
    eyeOpen: 1.1,
    foreheadSlope: 0.06,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.08, blemish: 0.07, wrinkles: 0, lips: PAL.lips, brows: PAL.brows, scatter: 0xc87a68, surface: 'skin' },
  eyes: { color: PAL.eyes, sclera: 0xefeae2 },
  // long enough to reach the small of the back (sheet), dense enough for clumped locks
  hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, braids: 'temple', length: 1.22, density: devNum('density', 0.6), bounce: 0.8 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.leggings, mat: WOOL },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 1.0, mat: TOOLED },
    // long sleeves; the hem panels are the skirt layer below
    { type: 'tunic', color: PAL.tunic, color2: PAL.tunicTrim, length: 0, mat: TWILL },
    {
      type: 'skirt',
      color: PAL.tunic,
      color2: PAL.hemBronze,
      mat: TWILL,
      length: 0.3,
      thickness: -0.022,
      strips: { count: 8, color: PAL.tunicPanel, color2: PAL.hemBronze, mat: TWILL, width: 0.15, length: 1.5, phase: 0 },
    },
    { type: 'bracers', color: PAL.bracers, color2: PAL.bracersTrim, length: 0.86, thickness: 0.003, mat: TOOLED },
    { type: 'belt', color: PAL.belt, offset: BELT_RAISE, mat: 'leather_worn' },
  ],
  armor: [],
  weapons: { right: 'none', left: 'elven_bow' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.3 },
  anim: { grace: 1, swagger: 0.05, aggression: 0.3, stance: 0.95, armSwing: 0.85, cadence: 1.02 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region (hero quality) within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.034), headRes: devNum('headRes', 0.0072), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: tauriExtras,
};
