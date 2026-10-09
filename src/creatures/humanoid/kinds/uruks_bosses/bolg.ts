/**
 * Bolg, son of Azog (The Hobbit): ~2.6 m, pale white-grey skin cross-hatched with dark scars,
 * iron plates and braces bolted into his skull and jaw, rusted black plate with a fur collar,
 * spiked pauldron, trophies on a heavy belt and a spiked mace. The boss of chapters 3 and 4.
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import {
  V, snapPoint, gearOf, makeProjector, carveSnapped, paintSnapped, scarTube, spike, placeAlong, hexBolt, shellPatch, ellipsoidFn, ribbon, lerp, smooth, skullGeo, chainLinks, ringSnap, densePath, snapPath, type SnapPoint, type GearFn,
} from './common';
import { brawnBody } from './body';
import { scaleHeldWeapon } from './common';
import { ringRadii } from './common';
import { URUK_PAL, forearms, cuirassSdf, cuirassGear, pauldron } from './uruk';
import { emitParts } from '../../anatomy';

const IRON_RUSTY = surface('metal_rusty', { rough: 0.68 });
const IRON = surface('metal_dark', { rough: 0.5 });
const LEATHER = surface('leather_worn', { rough: 0.7 });
const BONE = surface('bone', { rough: 0.6 });
const SCAR = 0x2d2828;

// sheet (docs/refs/bolg): pale grey-white skin #c4c1b6, rusted iron #635647, dark kilt #3c332b,
// leather straps #4f3827; bare scarred torso with crossed straps
export const BOLG_PAL = {
  skin: 0x7d776f, // renders close to the sheet's lit #c4c1b6 under daylight
  skin2: 0x5e5852,
  lips: 0x5a4a48,
  scatter: 0x8a6a62,
  eyes: 0xa6b2bc,
  iron: 0x4e4234, // rusted iron (lit sheet colour #635647)
  rust: 0x5a3c28,
  fur: 0x241d17,
  leather: 0x3e2c1f, // coarse leather straps #4f3827
  kilt: 0x3a3029, // ragged dark kilt #3c332b
};

/** two coarse leather straps crossing the bare chest and back (shoulders → opposite hip) */
function crossStraps(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const mid = new THREE.Vector3(0, (j.chest[1] + j.thigh_l[1]) / 2 + 0.06 * sc, 0);
  const hw = 0.03 * sc;
  for (const sx of [1, -1]) {
    const n = new THREE.Vector3(sx * 1.0, 1.15, 0).normalize();
    const c = n.dot(mid);
    s.group('union', 0.002 * sc, () => {
      // (inflated past the extra muscle masses of brawnBody)
      emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: BOLG_PAL.leather, mat: LEATHER, inflate: 0.034 * sc, k: 0.05 * sc });
      s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
      s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
      s.plane([0, 1, 0], j.upperarm_l[1] + 0.06 * sc, { op: 'intersect', k: 0.01 * sc });
      s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
    });
  }
}

const BOLG_FACE = {
  jaw: 1.32,
  jawLength: 1.22,
  chin: 0.95,
  brow: 1.75,
  cheekbones: 1.1,
  nose: { length: 0.9, width: 1.1, bridge: 0.6, hook: 0.1, tip: 0.95, flat: 0.5 },
  lips: { width: 1.2, fullness: 0.6 },
  ears: 'small' as const,
  earSize: 0.9,
  eyeSize: 0.82,
  eyeSpacing: 1.0,
  eyeTilt: -0.1,
  eyeOpen: 0.66,
  tusks: 0.2,
  underbite: 0.7,
  foreheadSlope: 0.45,
  asym: 0.55,
  cranium: 0.97,
};

function bolts(gear: GearFn, bone: string, pts: { p: THREE.Vector3; n: THREE.Vector3 }[], r: number) {
  for (const q of pts) gear(hexBolt(r, r * 0.9), { bone, color: 0x5a554e, mat: IRON, matrix: placeAlong(q.p, q.n, V(0, 1, 0)), small: true });
}

/** plates and braces bolted into the skull and jaw */
function skullHardware(ctx: KindContext, gear: GearFn, proj: ReturnType<typeof makeProjector>) {
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => new THREE.Vector3(...P.h(x, y, z));
  const C = H(0, 0.045, -0.05);
  const R: [number, number, number] = [0.335 * u, 0.405 * u, 0.435 * u];
  const iron = BOLG_PAL.iron;
  const th = 0.012 * sc;
  const bt: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const onEllipsoid = (az: number, el: number, k = 1) => {
    const d = V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    return { p: V(d.x * R[0] * k, d.y * R[1] * k, d.z * R[2] * k).add(C), n: V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize() };
  };
  // left skull plate (irregular outline)
  const outline = (a: number) => 0.55 + 0.1 * Math.sin(a * 3.1) + 0.18 * Math.cos(a * 1.7);
  const plate = shellPatch(
    ellipsoidFn(C, [R[0] * 1.045, R[1] * 1.04, R[2] * 1.04], [0.1, 1.75], [(a) => 0.18 + 0.1 * Math.sin(a * 4), (a) => 0.18 + outline(a) * 1.05]),
    10,
    6,
    th,
    { thickFn: (_u, v) => 1 + 0.5 * (1 - smooth(0, 0.15, v)) },
  );
  gear(plate, { bone: 'head', color: iron, mat: IRON_RUSTY, ao: 0.9 });
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const az = lerp(0.2, 1.65, t);
    const el = 0.2 + outline(az) * 0.95 * 0.0 + (0.1 * Math.sin(az * 4) + 0.18 + outline(az) * 1.05) * 0.0;
    void el;
    const e = lerp(0.22 + 0.1 * Math.sin(az * 4), 0.18 + outline(az) * 1.05, 0.9);
    bt.push(onEllipsoid(az, e, 1.065));
  }
  bt.push(onEllipsoid(0.8, 0.7, 1.07), onEllipsoid(1.1, 0.55, 1.07));
  // forehead band over the brow, bolted at both ends
  const band = shellPatch(ellipsoidFn(C, [R[0] * 1.05, R[1] * 1.05, R[2] * 1.05], [-1.1, 1.1], [0.12, 0.36]), 12, 1, th * 0.9, { noInner: true });
  gear(band, { bone: 'head', color: iron, mat: IRON_RUSTY, ao: 0.9 });
  bt.push(onEllipsoid(-1.0, 0.24, 1.07), onEllipsoid(-0.5, 0.24, 1.07), onEllipsoid(0.5, 0.24, 1.07));
  // central brow stud with a short spike
  const mid = onEllipsoid(0.0, 0.24, 1.07);
  gear(spike(0.03 * u, 0.12 * u, 5), { bone: 'head', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(mid.p, mid.n, V(0, 1, 0)), small: true });
  bolts(gear, 'head', bt, 0.0125 * sc);

  // jaw brace: strap from the skull plate down in front of the ear, along the jawline and around the chin
  if (proj) {
    const far = 0.55 * u;
    const HP = (x: number, y: number, z: number, m: 'l' | 'r' | 'f' | 'u'): SnapPoint => {
      const q = P.h(x, y, z);
      return [q[0], q[1], q[2], m, far];
    };
    const jawBolts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    const pa = densePath(proj, [HP(0.3, 0.1, 0.02, 'l'), HP(0.3, -0.06, 0.02, 'l'), HP(0.285, -0.22, 0.02, 'l'), HP(0.26, -0.36, 0.02, 'l')], 0.012 * sc, 0.003 * sc);
    if (pa.p.length > 3) {
      gear(ribbon(pa.p, pa.n, 0.04 * u, 0.012 * sc, 1, { outerOnly: true, noInner: true }, pa.p.length - 1), { bone: 'head', color: iron, mat: IRON_RUSTY });
      jawBolts.push({ p: pa.p[1].clone().addScaledVector(pa.n[1], 0.006 * sc), n: pa.n[1] }, { p: pa.p[Math.floor(pa.p.length * 0.6)].clone().addScaledVector(pa.n[Math.floor(pa.p.length * 0.6)], 0.006 * sc), n: pa.n[Math.floor(pa.p.length * 0.6)] });
    }
    // lower jaw plate over the chin and the jaw line (follows the jaw bone), bolted into the bone
    {
      const cc = H(0, -0.25, 0.02);
      const R: [number, number, number] = [0.36 * u, 0.47 * u, 0.55 * u];
      const plate = shellPatch(ellipsoidFn(cc, R, [-0.95, 0.95], [-1.0, -0.47]), 14, 5, 0.014 * sc, { noInner: true, thickFn: (_u2, v) => 1 + 0.6 * (1 - smooth(0, 0.2, v)) });
      gear(plate, { bone: 'jaw', color: iron, mat: IRON_RUSTY, ao: 0.9 });
      for (const [a, e] of [[-0.6, -0.62], [0, -0.62], [0.6, -0.62], [-0.85, -0.85], [0.85, -0.85], [-0.3, -0.85], [0.3, -0.85]] as [number, number][]) {
        const d = V(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
        const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(cc);
        const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
        jawBolts.push({ p: p.addScaledVector(nn, 0.008 * sc), n: nn });
      }
      // two spikes jutting from the chin plate
      for (const sx of [-1, 1]) {
        const d = V(Math.cos(-0.75) * Math.sin(sx * 0.42), Math.sin(-0.75), Math.cos(-0.75) * Math.cos(sx * 0.42));
        const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(cc);
        gear(spike(0.018 * u, 0.1 * u, 5), { bone: 'jaw', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(p, V(sx * 0.2, -0.7, 0.7), V(0, 0, 1)), small: true });
      }
    }
    bolts(gear, 'jaw', jawBolts, 0.011 * sc);
  }
}

function bolgFaceScars(ctx: KindContext, proj: NonNullable<ReturnType<typeof makeProjector>>) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number): SnapPoint => {
    const q = P.h(x, y, 0.5);
    return [q[0], q[1], q[2], 'f'];
  };
  const o: PrimOpts = { color: SCAR, mat: 'skin_orc', bone: 'head', k: 0.006 * u };
  carveSnapped(s, proj, [H(-0.21, 0.12), H(-0.15, -0.02), H(-0.1, -0.2), H(-0.12, -0.34)], 0.012 * u, 0.008 * u, o);
  carveSnapped(s, proj, [H(0.08, -0.24), H(0.2, -0.3), H(0.26, -0.38)], 0.01 * u, 0.007 * u, o);
  carveSnapped(s, proj, [H(-0.28, -0.05), H(-0.2, -0.1)], 0.009 * u, 0.006 * u, o);
  // dark mottling around the eyes and mouth
  const dark: PrimOpts = { color: 0x4a4440, mat: 'skin_orc', bone: 'head', k: 0.02 * u, strength: 0.55 };
  for (const sx of [1, -1]) paintSnapped(s, proj, [H(0.13 * sx, -0.07), H(0.19 * sx, -0.09)], 0.05 * u, dark);
  paintSnapped(s, proj, [H(-0.08, -0.42), H(0.1, -0.42)], 0.04 * u, { ...dark, strength: 0.4 });
}

function bolgExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const gear = gearOf(ctx);
  const j = P.j;
  const parts = anatomyParts(P);
  const armor = ctx.armor;
  const box = { min: [-1, 0, -0.8] as [number, number, number], max: [1, P.H + 0.4, 0.9] as [number, number, number] };

  brawnBody(ctx, { traps: 1.2, lats: 1.2, delts: 1.2, forearm: 1.15, thigh: 1.1, calf: 1.1, biceps: 1.15 });
  // sheet: the torso is bare (pale, scarred) under two crossed leather straps — no cuirass
  void cuirassSdf;
  void cuirassGear;
  crossStraps(ctx, parts);
  if (armor >= 0.25) forearms(ctx, parts, 'plate', 1.15);

  const proj0 = makeProjector(s, box);
  if (proj0) bolgFaceScars(ctx, proj0);

  const proj = makeProjector(s, box);
  if (!proj) return;
  skullHardware(ctx, gear, proj);

  // a mace sized for a 2.6 m brute
  scaleHeldWeapon(ctx, 'hand_r', ['mace'], [1.7, 1.55, 1.7]);

  // heavy spiked pauldrons of rusted iron on both shoulders (sheet)
  if (armor >= 0.5) {
    pauldron(ctx, gear, 1, { lames: 4, spikes: 6, scale: 1.3, rusty: true, color: BOLG_PAL.iron });
    pauldron(ctx, gear, -1, { lames: 4, spikes: 6, scale: 1.3, rusty: true, color: BOLG_PAL.iron });
  }

  // spikes along the forearm guards
  for (const side of [1, -1]) {
    const L = P.hand.l.L.clone();
    L.x *= side;
    const a = new THREE.Vector3(...j[side > 0 ? 'forearm_l' : 'forearm_r']);
    for (let i = 0; i < 3; i++) {
      const c = a.clone().addScaledVector(L, (0.42 + i * 0.17) * P.foreArm);
      const pp = V(), nn = V();
      if (!snapPoint(proj, [c.x, c.y, c.z], side > 0 ? 'l' : 'r', pp, nn)) continue;
      gear(spike(0.0125 * sc, 0.075 * sc, 5), { bone: side > 0 ? 'forearm_l' : 'forearm_r', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(pp.addScaledVector(nn, 0.004 * sc), nn, V(0, 1, 0)), small: true });
    }
  }

  // belt: skull buckle, trophies and a chain
  {
    const hipY = j.thigh_l[1];
    const by = hipY + 0.07 * sc;
    const q = ringSnap(proj, 0, by);
    if (q) {
      gear(skullGeo(0.034 * sc), { bone: 'hips', color: URUK_PAL.bone, mat: BONE, matrix: placeAlong(q.p.clone().addScaledVector(q.n, 0.03 * sc), V(0, 1, 0), q.n.clone()), small: true });
    }
    for (const [a, sz] of [[0.95, 0.026], [-0.9, 0.022]] as [number, number][]) {
      const r = ringSnap(proj, a, by - 0.01 * sc);
      if (!r) continue;
      const pos = r.p.clone().addScaledVector(r.n, 0.04 * sc);
      pos.y -= 0.07 * sc;
      gear(skullGeo(sz * sc), { bone: 'hips', color: 0xb8ab88, mat: BONE, matrix: placeAlong(pos, V(0, 1, 0), r.n.clone()), small: true });
      // cord
      gear(new THREE.CylinderGeometry(0.003 * sc, 0.003 * sc, 0.07 * sc, 4, 1).translate(0, 0.035 * sc, 0), { bone: 'hips', color: 0x15100c, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z), small: true });
    }
    // chain looped across the belt
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = lerp(0.35, 1.5, i / 8);
      const r = ringSnap(proj, a, by - 0.03 * sc - 0.05 * sc * Math.sin((i / 8) * Math.PI));
      if (r) pts.push(r.p.clone().addScaledVector(r.n, 0.014 * sc));
    }
    if (pts.length > 4) for (const g of chainLinks(pts, 0.028 * sc, 0.0045 * sc, V(0, 1, 0))) gear(g, { bone: 'hips', color: 0x4a4540, mat: IRON, small: true });
  }

  // tassets on the thighs and spiked knee guards
  if (armor >= 0.5) {
    for (const side of [1, -1]) {
      const sfx = side > 0 ? 'l' : 'r';
      const t = new THREE.Vector3(...j[`thigh_${sfx}`]);
      const g = Math.sqrt(P.build.bulk);
      void t; // (no thigh tassets: the sheet's kilt hangs over bare thighs)
      const kn = new THREE.Vector3(...j[`shin_${sfx}`]);
      const kc = V(kn.x, kn.y + 0.005 * sc, kn.z + 0.012 * sc);
      const kfn = ellipsoidFn(kc, [0.062 * sc * g, 0.06 * sc, 0.07 * sc * g], [-1.1, 1.1], [-0.5, 0.9]);
      gear(shellPatch(kfn, 8, 3, 0.008 * sc, { noInner: true }), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85, small: true });
      gear(spike(0.014 * sc, 0.07 * sc, 5), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(kc.x, kc.y + 0.01 * sc, kc.z + 0.07 * sc), V(0, 0.2, 1), V(0, 1, 0)), small: true });
      // rusted shin plate over the foot wraps (sheet)
      const an = new THREE.Vector3(...j[`foot_${sfx}`]);
      const sc0 = V(kn.x, (kn.y + an.y) / 2 + 0.02 * sc, kn.z + 0.012 * sc);
      const sfn = ellipsoidFn(sc0, [0.07 * sc * g, (kn.y - an.y) * 0.46, 0.072 * sc * g], [-1.25, 1.25], [-0.85, 0.85]);
      gear(shellPatch(sfn, 8, 6, 0.009 * sc, { noInner: true }), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
      gear(spike(0.012 * sc, 0.06 * sc, 5), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(sc0.x, sc0.y, sc0.z + 0.078 * sc * g), V(0, 0.1, 1), V(0, 1, 0)), small: true });
    }
  }

  // raised dark scars across the arms, neck and shoulders
  const yS = j.upperarm_l[1];
  const welts: SnapPoint[][] = [
    [[0.3 * sc, yS - 0.08 * sc, 0.06 * sc, 'f'], [0.33 * sc, yS - 0.14 * sc, 0.0, 'l'], [0.36 * sc, yS - 0.2 * sc, -0.04 * sc, 'l']],
    [[-0.32 * sc, yS - 0.1 * sc, 0.05 * sc, 'f'], [-0.35 * sc, yS - 0.17 * sc, 0.0, 'r']],
    [[0.05 * sc, j.neck[1] + 0.02 * sc, 0.08 * sc, 'f'], [0.1 * sc, j.neck[1] - 0.01 * sc, 0.07 * sc, 'f']],
    [[0.34 * sc, yS - 0.32 * sc, 0.0, 'l'], [0.37 * sc, yS - 0.4 * sc, 0.02 * sc, 'l']],
  ];
  for (const w of welts) {
    const t = scarTube(proj, w, 0.0042 * sc, 0.0006);
    if (t) gear(t, { bone: 'upperarm_l', color: SCAR, mat: surface('skin_orc', { rough: 0.75, skin: 0.3 }), small: true });
  }
  void snapPath;
  void IRON;
  void LEATHER;
}

export const bolgKind: KindDef = {
  label: 'Bolg',
  height: 2.6,
  build: { shoulders: 1.3, hips: 1.08, bulk: 1.25, chest: 1.15, belly: 0.05, armLength: 1.1, legLength: 0.98, headSize: 0.98, neck: 0.8, neckThick: 1.5, hunch: 0.15, handSize: 1.25, footSize: 1.2, muscle: 1.0 },
  face: BOLG_FACE,
  skin: { color: BOLG_PAL.skin, color2: BOLG_PAL.skin2, blotch: 0.4, blemish: 0.6, scars: 5, warts: 0.12, wrinkles: 0.7, lips: BOLG_PAL.lips, brows: 0x4a4440, surface: 'skin_orc', scatter: BOLG_PAL.scatter },
  eyes: { color: BOLG_PAL.eyes, glow: 0.3, sclera: 0xbdb6a6 },
  hair: { style: 'bald', color: 0x1a1612 },
  // bare legs under a ragged knee-length kilt, shins and feet in worn wraps (sheet)
  outfit: [
    { type: 'wraps', color: 0x4a3a2c, thickness: 0.02 },
    { type: 'belt', color: BOLG_PAL.leather, thickness: 0.006 },
    { type: 'skirt', color: BOLG_PAL.kilt, color2: 0x2a231e, mat: 'rags', length: 0.85 },
  ],
  armor: [],
  weapons: { right: 'mace' },
  palette: BOLG_PAL,
  sfx: { voice: 'orc', roar: 'orc_roar', weight: 0.9 },
  anim: { hunch: 0.15, swagger: 0.5, aggression: 1, stance: 1.2, armSwing: 1.0, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { faceRes: 0, res: 0.05, headRes: 0.0135, detailScale: 0.9 },
  extras: bolgExtras,
};
