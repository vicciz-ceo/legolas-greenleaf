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
import { URUK_PAL, forearms, cuirassSdf, cuirassGear, pauldron } from './uruk';
import { emitParts } from '../../anatomy';

const IRON_RUSTY = surface('metal_rusty', { rough: 0.68 });
const IRON = surface('metal_dark', { rough: 0.5 });
const LEATHER = surface('leather_worn', { rough: 0.7 });
const BONE = surface('bone', { rough: 0.6 });
const SCAR = 0x2d2828;

export const BOLG_PAL = {
  skin: 0x8d887f,
  skin2: 0x56514b,
  lips: 0x5a4a48,
  scatter: 0x8a6a62,
  eyes: 0xa6b2bc,
  iron: 0x2a2724,
  rust: 0x4a3426,
  fur: 0x241d17,
  leather: 0x1f1813,
};

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
    // lower jaw band (follows the jaw bone): jaw angle → chin → other jaw angle
    const pj = densePath(
      proj,
      [HP(0.265, -0.38, 0.02, 'l'), HP(0.22, -0.48, 0.14, 'l'), HP(0.13, -0.6, 0.27, 'u'), HP(0.0, -0.64, 0.33, 'u'), HP(-0.13, -0.6, 0.27, 'u'), HP(-0.22, -0.48, 0.14, 'r'), HP(-0.265, -0.38, 0.02, 'r')],
      0.012 * sc,
      0.003 * sc,
    );
    if (pj.p.length > 4) {
      gear(ribbon(pj.p, pj.n, 0.05 * u, 0.012 * sc, 1, { outerOnly: true, noInner: true }, pj.p.length - 1), { bone: 'jaw', color: iron, mat: IRON_RUSTY });
      for (let i = 2; i < pj.p.length - 1; i += 4) jawBolts.push({ p: pj.p[i].clone().addScaledVector(pj.n[i], 0.006 * sc), n: pj.n[i] });
    }
    // chin plate over the front of the jaw
    const pc = densePath(proj, [HP(-0.11, -0.52, 0.34, 'f'), HP(0, -0.55, 0.36, 'f'), HP(0.11, -0.52, 0.34, 'f')], 0.01 * sc, 0.004 * sc);
    if (pc.p.length > 2) {
      gear(ribbon(pc.p, pc.n, 0.09 * u, 0.012 * sc, 1, { outerOnly: true, noInner: true }, pc.p.length - 1), { bone: 'jaw', color: iron, mat: IRON_RUSTY });
      jawBolts.push({ p: pc.p[0].clone().addScaledVector(pc.n[0], 0.006 * sc), n: pc.n[0] }, { p: pc.p[pc.p.length - 1].clone().addScaledVector(pc.n[pc.p.length - 1], 0.006 * sc), n: pc.n[pc.p.length - 1] });
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
  const cuirass = armor >= 0.25 ? cuirassSdf(ctx, { cuirass: 'plate' }, parts, { rusty: true, color: BOLG_PAL.iron }) : null;
  if (armor >= 0.25) forearms(ctx, parts, 'plate');

  // heavy fur collar over the trapezius
  s.group('union', 0.006 * sc, () => {
    emitParts(s, parts, ['trap', 'neck'], { color: BOLG_PAL.fur, mat: 'fur', inflate: 0.05 * sc, k: 0.06 * sc, noise: { amp: 0.018 * sc, freq: 16 / sc, type: 'fbm', octaves: 3 } });
    s.plane([0, 1, 0], j.neck[1] + 0.05 * sc, { op: 'intersect', k: 0.02 * sc });
    s.plane([0, -1, 0], -(j.neck[1] - 0.06 * sc), { op: 'intersect', k: 0.02 * sc });
  });

  const proj0 = makeProjector(s, box);
  if (proj0) bolgFaceScars(ctx, proj0);

  const proj = makeProjector(s, box);
  if (!proj) return;
  if (cuirass) cuirassGear(ctx, gear, proj, { cuirass: 'plate' }, cuirass.botY);
  skullHardware(ctx, gear, proj);

  // a mace sized for a 2.6 m brute
  scaleHeldWeapon(ctx, 'hand_r', ['mace'], [1.45, 1.4, 1.45]);

  // spiked pauldron (left) and a smaller plate on the right
  if (armor >= 0.5) {
    pauldron(ctx, gear, 1, { lames: 4, spikes: 7, scale: 1.3, rusty: true, color: BOLG_PAL.iron });
    pauldron(ctx, gear, -1, { lames: 3, spikes: 3, scale: 1.0, rusty: true, color: BOLG_PAL.iron });
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
      {
        const c = V(t.x + side * 0.012 * sc, t.y - 0.17 * sc, 0.0);
        const R: [number, number, number] = [0.108 * sc * g, 0.17 * sc, 0.105 * sc * g];
        const fn = ellipsoidFn(c, R, [-0.8, 0.8], [-0.75, 0.55]);
        gear(shellPatch(fn, 10, 6, 0.009 * sc, { noInner: true }), { bone: `thigh_${sfx}`, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
      }
      const kn = new THREE.Vector3(...j[`shin_${sfx}`]);
      const kc = V(kn.x, kn.y + 0.005 * sc, kn.z + 0.012 * sc);
      const kfn = ellipsoidFn(kc, [0.062 * sc * g, 0.06 * sc, 0.07 * sc * g], [-1.1, 1.1], [-0.5, 0.9]);
      gear(shellPatch(kfn, 8, 3, 0.008 * sc, { noInner: true }), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85, small: true });
      gear(spike(0.014 * sc, 0.07 * sc, 5), { bone: `shin_${sfx}`, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(kc.x, kc.y + 0.01 * sc, kc.z + 0.07 * sc), V(0, 0.2, 1), V(0, 1, 0)), small: true });
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
    const t = scarTube(proj, w, 0.0032 * sc, 0.0006);
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
  skin: { color: BOLG_PAL.skin, color2: BOLG_PAL.skin2, blotch: 0.75, blemish: 0.6, scars: 5, warts: 0.12, wrinkles: 0.7, lips: BOLG_PAL.lips, brows: 0x4a4440, surface: 'skin_orc', scatter: BOLG_PAL.scatter },
  eyes: { color: BOLG_PAL.eyes, glow: 0.3, sclera: 0xbdb6a6 },
  hair: { style: 'bald', color: 0x1a1612 },
  outfit: [
    { type: 'trousers', color: 0x25201b, mat: 'leather_worn' },
    { type: 'boots', color: 0x1a1613, color2: 0x120f0d, length: 0.92 },
    { type: 'belt', color: 0x17120f },
    { type: 'loincloth', color: 0x1f1813, mat: 'leather_worn', length: 0.65 },
  ],
  armor: [],
  weapons: { right: 'mace' },
  palette: BOLG_PAL,
  sfx: { voice: 'orc', roar: 'orc_roar', weight: 0.9 },
  anim: { hunch: 0.15, swagger: 0.5, aggression: 1, stance: 1.2, armSwing: 1.0, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { faceRes: 0, res: 0.05, headRes: 0.0135 },
  extras: bolgExtras,
};
