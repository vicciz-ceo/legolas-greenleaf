/**
 * Lurtz, the first Uruk-hai (Fellowship of the Ring): ~2.1 m, bare scarred torso under a leather
 * harness, the white hand of Saruman painted across his face, bow + falchion + shield.
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import { V, v3, gearOf, makeProjector, paintSnapped, carveSnapped, strapSnapped, scarTube, snapPoint, spike, placeAlong, rivet, type SnapPoint, ringSnap, projectPath, ribbon, type Projector } from './common';
import { brawnBody, bareTorso, skinOpts } from './body';
import { URUK_PAL, forearms } from './uruk';
import * as _u from './uruk';

void _u;

const WHITE_SKIN = surface('skin_orc', { rough: 0.8, skin: 0.25 });
const LEATHER = surface('leather_worn', { rough: 0.68 });
const BONE = surface('bone', { rough: 0.55 });

export const LURTZ_FACE = {
  jaw: 1.25,
  jawLength: 1.1,
  chin: 0.9,
  brow: 1.6,
  cheekbones: 1.2,
  nose: { length: 0.88, width: 1.35, bridge: 0.7, hook: 0, tip: 1.0, flat: 0.6 },
  lips: { width: 1.15, fullness: 0.8 },
  ears: 'orc' as const,
  earSize: 0.95,
  eyeSize: 0.9,
  eyeSpacing: 1.02,
  eyeTilt: -0.08,
  eyeOpen: 0.75,
  tusks: 0.3,
  underbite: 0.55,
  foreheadSlope: 0.5,
  asym: 0.35,
  cranium: 0.95,
};

/** the white hand across the face: palm over nose and cheeks, fingers up over the brow and forehead */
function lurtzFacePaint(ctx: KindContext, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number): SnapPoint => {
    const q = P.h(x, y, 0.5);
    return [q[0], q[1], q[2], 'f'];
  };
  const paint: PrimOpts = { color: 0xe7e2d3, color2: 0xa8a090, colorNoise: 0.4, colorFreq: 45 / P.s, mat: WHITE_SKIN, bone: 'head', k: 0.012 * u, strength: 0.97 };
  const tilt = 0.1; // the hand leans a little
  const fx = (x: number, y: number) => x + tilt * y;
  // palm: a dense fan of strokes
  for (let r = 0; r < 4; r++) {
    const y = -0.28 + r * 0.075;
    paintSnapped(s, proj, [H(fx(-0.2, y), y), H(fx(0.2, y), y)], 0.058 * u, paint);
  }
  // fingers (index→little, character's right→left), thumb and wrist
  const fingers: [number, number, number, number, number][] = [
    [-0.19, 0.0, -0.27, 0.3, 0.052],
    [-0.065, 0.02, -0.08, 0.37, 0.055],
    [0.065, 0.02, 0.1, 0.34, 0.054],
    [0.185, -0.02, 0.28, 0.24, 0.045],
  ];
  for (const [x0, y0, x1, y1, r] of fingers) paintSnapped(s, proj, [H(fx(x0, y0), y0), H(fx((x0 + x1) / 2, (y0 + y1) / 2), (y0 + y1) / 2), H(fx(x1, y1), y1)], r * u, paint);
  paintSnapped(s, proj, [H(-0.22, -0.2), H(-0.33, -0.1), H(-0.38, 0.0)], 0.05 * u, paint);
  paintSnapped(s, proj, [H(0.03, -0.36), H(0.05, -0.5), H(0.05, -0.58)], 0.09 * u, paint);
  // grime around the eyes
  const dark: PrimOpts = { color: 0x2a1f19, mat: 'skin_orc', bone: 'head', k: 0.012 * u, strength: 0.5 };
  for (const sx of [1, -1]) paintSnapped(s, proj, [H(0.135 * sx, -0.075), H(0.17 * sx, -0.07)], 0.045 * u, dark);
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
  carveSnapped(s, proj, [H(0.22, 0.1), H(0.17, -0.05), H(0.12, -0.2), H(0.1, -0.33)], 0.011 * u, 0.0075 * u, o);
  // split lip
  carveSnapped(s, proj, [H(-0.09, -0.35), H(-0.1, -0.43), H(-0.1, -0.52)], 0.009 * u, 0.006 * u, { ...o, bone: 'jaw' });
}

function lurtzExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const gear = gearOf(ctx);
  const j = P.j;
  const parts = anatomyParts(P);
  const box = { min: [-0.8, 0, -0.6] as [number, number, number], max: [0.8, P.H + 0.3, 0.7] as [number, number, number] };

  brawnBody(ctx, { traps: 1.15, lats: 1.15, delts: 1.15, forearm: 1.1, thigh: 1.22, calf: 1.15, biceps: 1.1 });
  forearms(ctx, parts, 'leather', 1.1);

  const proj0 = makeProjector(s, box);
  if (proj0) {
    bareTorso(ctx, proj0, { abs: 1.1, ribs: 1 });
    lurtzFacePaint(ctx, proj0);
    lurtzFaceScars(ctx, proj0);
  }

  // ── gear (needs the finished sculpt) ──
  const proj = makeProjector(s, box);
  if (!proj) return;
  const sh = P.build.shoulders;
  const yS = j.upperarm_l[1];
  const chestY = j.chest[1];
  const hipY = j.thigh_l[1];
  const strapMat = { bone: 'chest', color: 0x1c1511, mat: LEATHER } as const;
  // crossed harness straps (front), over the shoulders to the back
  for (const sx of [1, -1]) {
    const pts: SnapPoint[] = [
      [sx * 0.07 * sc * sh, yS + 0.06 * sc, -0.05 * sc, 't'],
      [sx * 0.085 * sc * sh, yS - 0.01 * sc, 0.12 * sc, 'f'],
      [sx * 0.03 * sc, yS - 0.12 * sc, 0.2 * sc, 'f'],
      [-sx * 0.04 * sc, chestY - 0.1 * sc, 0.2 * sc, 'f'],
      [-sx * 0.12 * sc, hipY + 0.17 * sc, 0.18 * sc, 'f'],
    ];
    strapSnapped(gear, proj, pts, 0.04 * sc, 0.009 * sc, strapMat);
    // back strap
    strapSnapped(
      gear,
      proj,
      [
        [sx * 0.07 * sc * sh, yS + 0.06 * sc, -0.05 * sc, 't'],
        [sx * 0.085 * sc * sh, yS - 0.02 * sc, -0.12 * sc, 'b'],
        [sx * 0.05 * sc, yS - 0.14 * sc, -0.16 * sc, 'b'],
        [-sx * 0.04 * sc, chestY - 0.1 * sc, -0.17 * sc, 'b'],
        [-sx * 0.1 * sc, hipY + 0.17 * sc, -0.15 * sc, 'b'],
      ],
      0.04 * sc,
      0.009 * sc,
      strapMat,
    );
  }
  // iron ring where the straps cross, and a belt of studs
  {
    const p = V(), n = V();
    if (snapPoint(proj, [0, yS - 0.12 * sc, 0], 'f', p, n)) {
      const g = new THREE.TorusGeometry(0.03 * sc, 0.0065 * sc, 5, 12);
      gear(g, { bone: 'chest', color: URUK_PAL.ironLt, mat: surface('metal_dark', { rough: 0.45 }), matrix: placeAlong(p.clone().addScaledVector(n, 0.008 * sc), V(0, 1, 0), n.clone()).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
    }
    for (let i = 0; i < 6; i++) {
      const a = -0.5 + i * 0.2;
      const q = ringSnap(proj, a * 1.4, hipY + 0.11 * sc);
      if (!q) continue;
      gear(rivet(0.008 * sc, 4), { bone: 'hips', color: URUK_PAL.ironLt, mat: LEATHER, matrix: placeAlong(q.p, q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
  // fang necklace on a cord
  {
    const pts: SnapPoint[] = [];
    const cy = j.neck[1] - 0.012 * sc;
    for (let i = 0; i <= 10; i++) {
      const a = -1.5 + (i / 10) * 3.0;
      const y = cy - 0.03 * sc * (1 - Math.abs(a) / 1.5) - 0.04 * sc * Math.exp(-a * a * 2.5);
      const q = ringSnap(proj, a, y, 0, -0.012 * sc);
      if (q) pts.push([q.p.x, q.p.y, q.p.z]);
    }
    if (pts.length > 4) {
      const path = projectPath(proj, pts.map((q) => [q[0], q[1], q[2]] as [number, number, number]), 0.003 * sc);
      gear(ribbon(path.p, path.n, 0.012 * sc, 0.005 * sc, 1, { outerOnly: true, noInner: true }), { bone: 'chest', color: 0x1a130e, mat: LEATHER, small: true });
      for (let i = 1; i < path.p.length - 1; i += 2) {
        gear(spike(0.008 * sc, 0.04 * sc * (i % 4 === 1 ? 1 : 0.75), 5), { bone: 'chest', color: URUK_PAL.bone, mat: BONE, matrix: placeAlong(path.p[i], V(0.1 * (path.p[i].x > 0 ? -1 : 1), -1, 0.35), path.n[i]).multiply(new THREE.Matrix4().makeRotationX(Math.PI)), small: true });
      }
    }
  }
  // scars: raised welts across the chest and back
  const welts: SnapPoint[][] = [
    [[0.14 * sc, yS - 0.04 * sc, 0.16 * sc, 'f'], [0.07 * sc, yS - 0.1 * sc, 0.2 * sc, 'f'], [0.02 * sc, yS - 0.17 * sc, 0.2 * sc, 'f']],
    [[-0.12 * sc, chestY - 0.06 * sc, 0.19 * sc, 'f'], [-0.1 * sc, chestY - 0.13 * sc, 0.2 * sc, 'f'], [-0.14 * sc, chestY - 0.2 * sc, 0.16 * sc, 'f']],
    [[0.03 * sc, yS - 0.02 * sc, -0.14 * sc, 'b'], [-0.07 * sc, yS - 0.12 * sc, -0.17 * sc, 'b'], [-0.13 * sc, yS - 0.22 * sc, -0.16 * sc, 'b']],
    [[0.12 * sc, chestY - 0.05 * sc, -0.17 * sc, 'b'], [0.07 * sc, chestY - 0.14 * sc, -0.18 * sc, 'b']],
  ];
  for (const w of welts) {
    const t = scarTube(proj, w, 0.0034 * sc, 0.0008);
    if (t) gear(t, { bone: 'chest', color: 0x6e5448, mat: surface('skin_orc', { rough: 0.7, skin: 0.4 }), small: true });
  }
  void v3;
}

export const lurtzKind: KindDef = {
  label: 'Lurtz',
  height: 2.1,
  build: { shoulders: 1.34, hips: 1.04, bulk: 1.12, chest: 1.15, belly: 0, armLength: 1.08, legLength: 0.98, headSize: 0.96, neck: 0.82, neckThick: 1.4, hunch: 0.16, handSize: 1.22, footSize: 1.14, muscle: 1.0 },
  face: LURTZ_FACE,
  skin: { color: 0x43372d, color2: 0x2a211b, blotch: 0.55, blemish: 0.5, scars: 3, warts: 0.08, wrinkles: 0.55, lips: 0x30221d, brows: 0x14100d, surface: 'skin_orc', scatter: 0x4c2e22 },
  eyes: { color: 0xd8a830, glow: 0.45, sclera: 0xb8aa80 },
  hair: { style: 'tied_back', color: URUK_PAL.hair, length: 1.6, density: 1.0 },
  outfit: [
    { type: 'trousers', color: URUK_PAL.cloth, mat: 'leather_worn' },
    { type: 'boots', color: 0x1a1613, color2: 0x120f0d, length: 0.92 },
    { type: 'belt', color: 0x17120f },
    { type: 'loincloth', color: 0x211913, mat: 'leather_worn', length: 0.6 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'uruk_bow', back: ['shield'], style: 'uruk' },
  palette: URUK_PAL,
  sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.8 },
  anim: { hunch: 0.16, swagger: 0.5, aggression: 1, stance: 1.18, armSwing: 1.05, cadence: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { faceRes: 0, res: 0.036, headRes: 0.0095 },
  extras: lurtzExtras,
};
