/**
 * Lurtz, the first Uruk-hai (Fellowship of the Ring): ~2.1 m, bare scarred torso, the white hand of
 * Saruman painted across his face, long loose black hair, dark leather bracers, a wide belt and a
 * ragged charcoal kilt over wrapped boots, bow + falchion + shield on the back (docs/refs/lurtz).
 */
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import { gearOf, makeProjector, paintSnapped, carveSnapped, strapSnapped, scarTube, type SnapPoint, type Projector } from './common';
import { brawnBody, bareTorso } from './body';
import { LURTZ_PAL, LURTZ_KILT, LURTZ_BOOT_LENGTH, lurtzBracers, lurtzBelt, lurtzBootWraps, lurtzBeltHangers, lurtzSoles, lurtzFangs, lurtzHairLocks } from './lurtz_parts';

const WHITE_SKIN = surface('skin_orc', { rough: 0.8, skin: 0.25 });
const LEATHER = surface('leather_worn', { rough: 0.74 });

export const LURTZ_FACE = {
  jaw: 1.25,
  jawLength: 1.0,
  chin: 1.0,
  brow: 1.6,
  cheekbones: 1.2,
  nose: { length: 0.88, width: 1.35, bridge: 0.7, hook: 0, tip: 1.0, flat: 0.6 },
  lips: { width: 1.15, fullness: 1.0 },
  ears: 'orc' as const,
  earSize: 0.95,
  eyeSize: 0.9,
  eyeSpacing: 1.02,
  eyeTilt: -0.08,
  eyeOpen: 0.75,
  tusks: 1.0, // plus two ivory cones sculpted in lurtzFangs (sheet: uneven fangs over the lip)
  underbite: 0.1, // a bigger one opened a black slot under the nose
  foreheadSlope: 0.5,
  asym: 0.35,
  cranium: 0.95,
};

/** the white hand (sheet face views): an upright five-finger handprint on the brow, thin and a little
 *  worn, then one tapered swoosh from the inner eye (character's right) down beside the nose to the
 *  jaw; the eyes stay clear and a short faint smear marks the other side */
function lurtzFacePaint(ctx: KindContext, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number): SnapPoint => {
    const q = P.h(x, y, 0.5);
    return [q[0], q[1], q[2], 'f'];
  };
  // slightly translucent so the skin grain shows through (the sheet's paint is thin)
  const paint: PrimOpts = { color: 0xe4e0d4, color2: 0xa8a090, colorNoise: 0.45, colorFreq: 45 / P.s, mat: WHITE_SKIN, bone: 'head', k: 0.008 * u, strength: 0.97 };
  // palm: two rows across the brow ridge, solid; the fingers fan up from it with clear gaps between
  for (let r = 0; r < 2; r++) {
    const y = 0.03 + r * 0.055;
    paintSnapped(s, proj, [H(-0.14, y), H(0.14, y)], 0.045 * u, paint);
  }
  const fingers: [number, number, number, number][] = [
    [-0.125, 0.11, -0.2, 0.26],
    [-0.042, 0.12, -0.058, 0.3],
    [0.045, 0.12, 0.068, 0.29],
    [0.125, 0.11, 0.185, 0.24],
  ];
  for (const [x0, y0, x1, y1] of fingers) paintSnapped(s, proj, [H(x0, y0), H((x0 + x1) / 2, (y0 + y1) / 2), H(x1, y1)], [0.026 * u, 0.024 * u, 0.014 * u], paint);
  paintSnapped(s, proj, [H(-0.16, 0.06), H(-0.23, 0.11)], [0.028 * u, 0.016 * u], paint);
  // nose bridge, then the swoosh: wide at the inner eye, tapering to a point at the jaw
  paintSnapped(s, proj, [H(0, 0.0), H(0, -0.07)], 0.024 * u, paint);
  paintSnapped(s, proj, [H(-0.08, -0.11), H(-0.12, -0.23), H(-0.17, -0.34), H(-0.2, -0.43), H(-0.2, -0.5)], [0.045 * u, 0.04 * u, 0.03 * u, 0.018 * u, 0.01 * u], paint);
  paintSnapped(s, proj, [H(0.085, -0.12), H(0.115, -0.2)], [0.014 * u, 0.007 * u], { ...paint, strength: 0.6 });
  // the mouth line and inside the lips: near-black, so it never reads as a grey-brown block
  s.ellipsoid(P.h(0, -0.392, 0.385), [0.05 * u, 0.008 * u, 0.03 * u], { op: 'paint', color: 0x0e0807, mat: 'skin_orc', bone: 'head', k: 0.01 * u, strength: 0.95 });
  // a lower-lip line, so the mouth reads closed / snarling rather than open
  s.ellipsoid(P.h(0, -0.437, 0.378), [0.06 * u, 0.005 * u, 0.02 * u], { op: 'paint', color: 0x0e0807, mat: 'skin_orc', bone: 'jaw', k: 0.008 * u, strength: 0.8 });
  // grime around the eyes (opaque, tight: a translucent disc reads as a ghost ring)
  const dark: PrimOpts = { color: 0x2a1f19, mat: 'skin_orc', bone: 'head', k: 0.01 * u, strength: 0.45 };
  for (const sx of [1, -1]) paintSnapped(s, proj, [H(0.135 * sx, -0.075), H(0.165 * sx, -0.07)], 0.02 * u, dark);
}

function lurtzFaceScars(ctx: KindContext, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number): SnapPoint => {
    const q = P.h(x, y, 0.5);
    return [q[0], q[1], q[2], 'f'];
  };
  const o: PrimOpts = { color: 0x6a3a30, mat: 'skin_orc', bone: 'head', k: 0.006 * u };
  // diagonal slash across the brow and cheek (character's left)
  carveSnapped(s, proj, [H(0.22, 0.1), H(0.17, -0.05), H(0.12, -0.2), H(0.1, -0.33)], 0.0065 * u, 0.0045 * u, o);
  // split lip
  carveSnapped(s, proj, [H(-0.09, -0.35), H(-0.1, -0.43), H(-0.1, -0.52)], 0.006 * u, 0.0042 * u, { ...o, bone: 'jaw' });
}

function lurtzExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const gear = gearOf(ctx);
  const j = P.j;
  const parts = anatomyParts(P);
  const box = { min: [-0.8, 0, -0.6] as [number, number, number], max: [0.8, P.H + 0.3, 0.7] as [number, number, number] };
  const sh = P.build.shoulders;
  const yS = j.upperarm_l[1];
  const chestY = j.chest[1];
  const hipY = j.thigh_l[1];

  // long diagonal scars (sheet face and body views): points from a to b, x in sc units, y in metres
  const line = (a: [number, number], b: [number, number], mode: 'f' | 'b', n = 7): SnapPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [(a[0] + (b[0] - a[0]) * t) * sc, a[1] + (b[1] - a[1]) * t + 0.012 * sc * Math.sin(t * 5.1 + a[0] * 9), 0, mode] as SnapPoint;
    });
  const arm = (side: 1 | -1, y0: number, y1: number, dz0: number, dz1: number): SnapPoint[] =>
    Array.from({ length: 5 }, (_, i) => {
      const t = i / 4;
      return [j[side > 0 ? 'upperarm_l' : 'upperarm_r'][0], y0 + (y1 - y0) * t, (dz0 + (dz1 - dz0) * t) * sc, side > 0 ? 'l' : 'r'] as SnapPoint;
    });
  const scars: SnapPoint[][] = [
    // chest: three diagonals across the pecs and ribs
    line([-0.13, yS - 0.03 * sc], [0.1, chestY - 0.2 * sc], 'f'),
    line([-0.04, yS + 0.0 * sc], [0.16, chestY - 0.12 * sc], 'f', 6),
    line([0.13, yS - 0.05 * sc], [0.02, chestY - 0.13 * sc], 'f', 5),
    // back: a crossing pair
    line([-0.15, yS - 0.02 * sc], [0.1, chestY - 0.2 * sc], 'b'),
    line([0.15, yS - 0.02 * sc], [-0.1, chestY - 0.2 * sc], 'b'),
    // shoulders and upper arms
    arm(1, yS - 0.01 * sc, yS - 0.2 * sc, 0.03, -0.03),
    arm(-1, yS - 0.03 * sc, yS - 0.18 * sc, -0.03, 0.03),
  ];

  brawnBody(ctx, { traps: 1.15, lats: 1.15, delts: 1.15, forearm: 1.1, thigh: 1.22, calf: 1.15, biceps: 1.1 });

  const proj0 = makeProjector(s, box);
  if (proj0) {
    bareTorso(ctx, proj0, { abs: 1.1, ribs: 1 });
    lurtzFacePaint(ctx, proj0);
    lurtzFaceScars(ctx, proj0);
    // healed scars read as lighter, pinker lines (the welts below stand proud of them)
    const sp: PrimOpts = { color: 0x86564a, mat: 'skin_orc', bone: 'chest', k: 0.004 * sc, strength: 0.75 };
    for (const w of scars) paintSnapped(s, proj0, w, 0.004 * sc, sp);
  }

  // legs as ruddy as the torso (they rendered grey from the back and side)
  emitParts(s, parts, ['thigh', 'knee', 'shin', 'calf', 'glutes'], { op: 'paint', color: 0x5e3a2c, mat: 'skin_orc', strength: 0.5, k: 0.02 * sc });

  // ── gear (needs the finished sculpt) ──
  const proj = makeProjector(s, box);
  if (!proj) return;
  lurtzBracers(ctx, parts, gear);
  lurtzBelt(ctx, parts, gear, proj);
  lurtzBootWraps(ctx, parts);
  lurtzSoles(ctx);
  lurtzBeltHangers(ctx, gear);
  lurtzFangs(ctx, gear);
  lurtzHairLocks(ctx, gear);
  const strapMat = { bone: 'chest', color: 0x120d0a, mat: LEATHER } as const;
  // shield harness (sheet: bare chest, no front straps; they come over the top of the shoulders
  // and run down the back to the shield)
  for (const sx of [1, -1]) {
    strapSnapped(
      gear,
      proj,
      [
        [sx * 0.075 * sc * sh, yS + 0.062 * sc, -0.06 * sc, 't'],
        [sx * 0.09 * sc * sh, yS - 0.02 * sc, -0.12 * sc, 'b'],
        [sx * 0.075 * sc, yS - 0.14 * sc, -0.16 * sc, 'b'],
        [sx * 0.06 * sc, chestY - 0.12 * sc, -0.17 * sc, 'b'],
        [sx * 0.07 * sc, hipY + 0.2 * sc, -0.15 * sc, 'b'],
      ],
      0.036 * sc,
      0.009 * sc,
      strapMat,
    );
  }
  // belt across the back under the shield and a chest strap tying the harness
  strapSnapped(gear, proj, [[-0.2 * sc, chestY - 0.14 * sc, -0.12 * sc, 'b'], [0, chestY - 0.14 * sc, -0.19 * sc, 'b'], [0.2 * sc, chestY - 0.14 * sc, -0.12 * sc, 'b']], 0.034 * sc, 0.008 * sc, strapMat);
  // raised welts along the long scars (the first of each group of chest/back diagonals, and the arms)
  for (const i of [0, 1, 3, 4, 5, 6]) {
    const t = scarTube(proj, scars[i], 0.0032 * sc, 0.0008);
    if (t) gear(t, { bone: i >= 5 ? (i === 5 ? 'upperarm_l' : 'upperarm_r') : 'chest', color: 0x7a5448, mat: surface('skin_orc', { rough: 0.7, skin: 0.4 }), small: true });
  }
}

export const lurtzKind: KindDef = {
  label: 'Lurtz',
  height: 2.115, // crown 2.088 m in the calibrated lab for 2.1 (sheet 2.1)
  build: { shoulders: 1.34, hips: 1.04, bulk: 1.12, chest: 1.15, belly: 0, armLength: 1.08, legLength: 0.98, headSize: 0.96, neck: 0.82, neckThick: 1.4, hunch: 0.16, handSize: 1.22, footSize: 1.14, muscle: 1.0 },
  face: LURTZ_FACE,
  // sheet (docs/refs/lurtz): design skin #55432f, lit torso #7f645b → a ruddy dark brown; the albedo
  // is kept darker and redder than the hex (the lab lifts browns toward clay). skin_orc is the
  // matte-leaning preset: skin_brute's sweat sheen read as chocolate plastic.
  skin: { color: LURTZ_PAL.skin, color2: LURTZ_PAL.skin2, blotch: 0.5, blemish: 0.5, scars: 3, warts: 0.06, wrinkles: 0.5, lips: LURTZ_PAL.lips, brows: LURTZ_PAL.brows, surface: 'skin_orc', scatter: LURTZ_PAL.scatter },
  eyes: { color: LURTZ_PAL.eyes, glow: 0.45, sclera: 0xb8aa80 },
  // sheet: a loose black mane that frames the face, covers the neck and falls past the shoulders.
  // `mane` is combed back (long_straight grew a straight fringe over the handprint); chunky side and
  // back locks are added in lurtzHairLocks
  hair: { style: 'mane', color: LURTZ_PAL.hair, tipColor: LURTZ_PAL.hair, length: 1.45, density: 1.4 },
  outfit: [
    // wrapped boots to ≈ 0.44 m (the raised bands are sculpted in lurtz_parts); a bare calf shows above
    { type: 'boots', color: LURTZ_PAL.wrap, color2: 0x1c1712, length: LURTZ_BOOT_LENGTH },
    // near-black charcoal kilt: sides to ≈ 0.55 m, the grimy brown central flap makes the V to ≈ 0.45 m
    { type: 'skirt', color: LURTZ_PAL.kilt, color2: LURTZ_PAL.kilt2, mat: 'rags', length: LURTZ_KILT.length, thickness: LURTZ_KILT.thickness, tatter: 0.05, strips: { count: 2, color: LURTZ_PAL.flap, color2: LURTZ_PAL.beltDark, mat: 'rags', width: 0.09, length: 1.25, phase: 0 } },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'uruk_bow', back: ['shield'], style: 'uruk' },
  // (explicit: no uruk colours leak in; `buckle` is what the base belt reads)
  palette: { ...LURTZ_PAL, buckle: LURTZ_PAL.ironLt },
  sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.8 },
  anim: { hunch: 0.16, swagger: 0.5, aggression: 1, stance: 1.18, armSwing: 1.05, cadence: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { faceRes: 0, res: 0.036, headRes: 0.0095 },
  extras: lurtzExtras,
};
