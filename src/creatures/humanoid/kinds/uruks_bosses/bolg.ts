/**
 * Bolg, son of Azog (The Hobbit): ~2.6 m of heavy, defined muscle under pale, warm, scar-crossed
 * skin; bald scarred head with a heavy brow, small deep-set eyes, a flattened nose, lower fangs and a
 * dark stubble beard; iron plates and braces bolted into skull and jaw; big rust-brown spiked
 * pauldrons over tattered leather, crossed riveted straps, spiked leather bracers, a wide riveted belt
 * over a tattered layered kilt, spiked greaves strapped over foot wraps and sandals; a spiked mace.
 * The boss of chapters 3 and 4 (docs/refs/bolg).
 */
import * as THREE from 'three';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import {
  V, v3, snapPoint, gearOf, makeProjector, carveSnapped, paintSnapped, scarTube, spike, placeAlong, hexBolt, shellPatch, ellipsoidFn, ribbon, lerp, smooth, skullGeo, chainLinks, ringSnap, densePath, ellipticalBand, rivet, tup, type SnapPoint, type GearFn, type Projector,
} from './common';
import { brawnBody, bareTorso, skinOpts } from './body';
import { scaleHeldWeapon } from './common';
import { URUK_PAL } from './uruk';
import { emitParts } from '../../anatomy';

/** rusted, hammered iron: rust blooms in the pits and crevices (kit shader) */
const IRON_RUSTY = surface('iron_rusty', { rough: 0.66 });
const IRON = surface('iron_rusty', { rough: 0.55, pat: { pores: 0.6 } });
const LEATHER = surface('leather_worn', { rough: 0.72 });
const BONE = surface('bone', { rough: 0.6 });
/** healed cuts: dark red-purple */
const SCAR = 0x6a3a3c;

// sheet (docs/refs/bolg): pale warm skin crossed with red-purple scars (#c4c1b6 design, lit sheet
// reads #d1b9b0), rust-brown iron #635647, dark kilt #3c332b, leather straps #4f3827
export const BOLG_PAL = {
  // plausible pale-skin albedo, warm (a grey albedo read as plaster in the tower duel)
  skin: 0x9e7b6b,
  skin2: 0x8a6a5e,
  lips: 0x7a5250,
  scatter: 0xc05a4a,
  eyes: 0x8a6a30, // amber (sheet iris #705529)
  iron: 0x5e4a3a, // dark iron; the shader rusts it toward the sheet's rust brown
  rust: 0x6e4430,
  fur: 0x241d17,
  leather: 0x4f3827, // coarse leather #4f3827
  leatherDark: 0x3a2a1e,
  kilt: 0x3c332b, // ragged dark kilt #3c332b
  kilt2: 0x2c2520,
  stubble: 0x2c241e,
};

/** height where the two chest straps cross (sternum, between the pecs) */
function strapCross(ctx: KindContext) {
  const j = ctx.P.j;
  return j.chest[1] - 0.02 * ctx.P.s;
}

/** two coarse leather straps crossing the bare chest and back (shoulders → opposite hip) */
function crossStraps(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const mid = new THREE.Vector3(0, strapCross(ctx), 0);
  const hw = 0.032 * sc;
  for (const sx of [1, -1]) {
    const n = new THREE.Vector3(sx * 1.0, 1.15, 0).normalize();
    const c = n.dot(mid);
    s.group('union', 0.002 * sc, () => {
      // (inflated past the extra muscle masses of brawnBody)
      emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: BOLG_PAL.leather, mat: LEATHER, inflate: 0.043 * sc, k: 0.05 * sc });
      s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
      s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
      s.plane([0, 1, 0], j.upperarm_l[1] + 0.06 * sc, { op: 'intersect', k: 0.01 * sc });
      s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
    });
  }
}

const BOLG_FACE = {
  jaw: 1.45,
  jawLength: 1.2,
  chin: 1.05,
  brow: 1.82,
  cheekbones: 1.2,
  nose: { length: 0.88, width: 1.28, bridge: 0.5, hook: 0.05, tip: 1.05, flat: 0.62 },
  lips: { width: 1.22, fullness: 0.72 },
  ears: 'orc' as const,
  earSize: 1.0,
  eyeSize: 0.86,
  eyeSpacing: 1.02,
  eyeTilt: -0.12,
  eyeOpen: 0.72,
  tusks: 0.85,
  underbite: 0.8,
  foreheadSlope: 0.4,
  asym: 0.5,
  cranium: 1.0,
};

function bolts(gear: GearFn, bone: string, pts: { p: THREE.Vector3; n: THREE.Vector3 }[], r: number) {
  // domed rivets (sheet: "bald scalp / bolted plates")
  for (const q of pts) gear(rivet(r, 6), { bone, color: 0x5a4a3c, mat: IRON, matrix: placeAlong(q.p, q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
}

/** the iron band bolted into the left side of the skull, continuing as a brace down in front of the
 *  ear and along the jaw (sheet face views) — no helmet rim, no chin plate (the beard shows) */
function skullHardware(ctx: KindContext, gear: GearFn, proj: ReturnType<typeof makeProjector>) {
  const { P } = ctx;
  const u = P.headH;
  const sc = P.s;
  const H = (x: number, y: number, z: number) => new THREE.Vector3(...P.h(x, y, z));
  const C = H(0, 0.045, -0.05);
  const R: [number, number, number] = [0.335 * u, 0.405 * u, 0.435 * u];
  const iron = BOLG_PAL.iron;
  const th = 0.011 * sc;
  const bt: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const onEllipsoid = (az: number, el: number, k = 1) => {
    const d = V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    return { p: V(d.x * R[0] * k, d.y * R[1] * k, d.z * R[2] * k).add(C), n: V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize() };
  };
  // left skull band: from the crown down over the temple, irregular edges
  const a0 = (e: number) => 0.98 + 0.05 * Math.sin(e * 7.0);
  const a1 = (e: number) => 1.46 + 0.04 * Math.sin(e * 5.3 + 1.0);
  const plate = shellPatch(
    (uu, vv, o) => {
      const e = lerp(0.08, 1.42, vv);
      const az = lerp(a0(e), a1(e), uu);
      const d = V(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az));
      o.p.set(d.x * R[0] * 1.04, d.y * R[1] * 1.04, d.z * R[2] * 1.04).add(C);
      o.n.set(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    },
    4,
    12,
    th,
    { thickFn: (uu) => 1 + 0.4 * (1 - smooth(0, 0.2, Math.min(uu, 1 - uu))) },
  );
  gear(plate, { bone: 'head', color: iron, mat: IRON_RUSTY, ao: 0.9 });
  for (let i = 0; i < 6; i++) {
    const e = lerp(0.18, 1.3, i / 5);
    bt.push(onEllipsoid(a0(e) + 0.07, e, 1.06), onEllipsoid(a1(e) - 0.07, e, 1.06));
  }
  bolts(gear, 'head', bt, 0.0085 * sc);

  // jaw brace: continues the band down in front of the ear and along the jawline
  if (proj) {
    const far = 0.55 * u;
    const HP = (x: number, y: number, z: number, m: 'l' | 'r' | 'f' | 'u'): SnapPoint => {
      const q = P.h(x, y, z);
      return [q[0], q[1], q[2], m, far];
    };
    const jawBolts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    const pa = densePath(proj, [HP(0.3, 0.1, 0.06, 'l'), HP(0.3, -0.06, 0.05, 'l'), HP(0.285, -0.22, 0.05, 'l'), HP(0.26, -0.36, 0.06, 'l'), HP(0.21, -0.46, 0.14, 'l')], 0.012 * sc, 0.003 * sc);
    if (pa.p.length > 3) {
      gear(ribbon(pa.p, pa.n, 0.045 * u, 0.011 * sc, 1, { outerOnly: true, noInner: true }, pa.p.length - 1), { bone: 'head', color: iron, mat: IRON_RUSTY });
      for (const f of [0.15, 0.45, 0.75]) {
        const i = Math.floor(pa.p.length * f);
        jawBolts.push({ p: pa.p[i].clone().addScaledVector(pa.n[i], 0.011 * sc), n: pa.n[i] });
      }
    }
    bolts(gear, 'head', jawBolts, 0.0085 * sc);
  }
}

function bolgFaceScars(ctx: KindContext, proj: NonNullable<ReturnType<typeof makeProjector>>) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const H = (x: number, y: number): SnapPoint => {
    const q = P.h(x, y, 0.5);
    return [q[0], q[1], q[2], 'f'];
  };
  const o: PrimOpts = { color: SCAR, mat: 'skin_scarred', bone: 'head', k: 0.006 * u };
  carveSnapped(s, proj, [H(-0.24, 0.16), H(-0.2, 0.04), H(-0.21, -0.12)], 0.0075 * u, 0.0035 * u, o);
  carveSnapped(s, proj, [H(0.12, -0.2), H(0.21, -0.27), H(0.26, -0.36)], 0.0065 * u, 0.003 * u, o);
  // dark mottling around the eyes and mouth
  const dark: PrimOpts = { color: 0x6a5048, mat: 'skin_scarred', bone: 'head', k: 0.02 * u, strength: 0.5 };
  for (const sx of [1, -1]) paintSnapped(s, proj, [H(0.13 * sx, -0.07), H(0.19 * sx, -0.09)], 0.05 * u, dark);
  // dark stubble beard: over the jaw and chin and the sides of the face below the cheekbones, plus
  // a moustache shadow — the lips themselves stay clear (sheet face views)
  const stub: PrimOpts = { color: BOLG_PAL.stubble, mat: surface('skin_scarred', { rough: 0.82, pat: { fur: 1.5, pores: -0.5 } }), k: 0.04 * u, strength: 0.88 };
  s.ellipsoid(P.h(0, -0.47, 0.12), [0.31 * u, 0.15 * u, 0.36 * u], { ...stub, op: 'paint', bone: 'jaw' });
  for (const sx of [1, -1]) s.ellipsoid(P.h(0.235 * sx, -0.3, 0.1), [0.08 * u, 0.15 * u, 0.2 * u], { ...stub, op: 'paint', bone: 'head' });
  s.ellipsoid(P.h(0, -0.335, 0.4), [0.1 * u, 0.026 * u, 0.06 * u], { ...stub, op: 'paint', bone: 'head', k: 0.02 * u, strength: 0.5 });
  // re-assert the lips over the beard shadow
  s.ellipsoid(P.h(0, -0.415, 0.39), [0.07 * u, 0.02 * u, 0.04 * u], { color: BOLG_PAL.lips, mat: 'lips', bone: 'jaw', op: 'paint', k: 0.012 * u, strength: 0.8 });
}


/** big pecs, serratus and a thick neck on top of brawnBody (the sheet's heavy definition) */
function bolgMuscles(ctx: KindContext, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const sh = P.build.shoulders;
  const j = P.j;
  const n = V();
  s.with({ ...skinOpts(ctx), k: 0.03 * sc }, () => {
    // pectorals: heavy slabs with a defined lower edge
    for (const sx of [1, -1]) {
      const p = V(sx * 0.075 * sc * sh, j.chest[1] - 0.005 * sc, 0.4 * sc);
      if (!proj.project(p, n)) continue;
      const c = p.clone().addScaledVector(n, -0.016 * sc);
      s.ellipsoid(tup(c), [0.078 * sc * sh * Math.sqrt(g), 0.054 * sc, 0.034 * sc], { bone: 'chest', k: 0.02 * sc, rot: [0.12, sx * 0.22, sx * -0.18] });
    }
    // sternum groove between the pecs and the linea alba down the abdomen
    for (const [y, d] of [[j.chest[1] + 0.02 * sc, 0.012], [j.chest[1] - 0.05 * sc, 0.011], [j.chest[1] - 0.14 * sc, 0.008]] as [number, number][]) {
      const p = V(0, y, 0.4 * sc);
      if (!proj.project(p, n)) continue;
      s.ellipsoid(tup(p.clone().addScaledVector(n, 0.004 * sc)), [d * sc, 0.045 * sc, 0.012 * sc], { op: 'subtract', k: 0.012 * sc });
    }
    // serratus: three short ridges under each armpit
    for (const sx of [1, -1])
      for (let r = 0; r < 3; r++) {
        const p = V(sx * 0.165 * sc * sh, j.chest[1] - (0.055 + r * 0.035) * sc, 0.05 * sc);
        if (!proj.project(p, n)) continue;
        const c = p.clone().addScaledVector(n, -0.006 * sc);
        s.ellipsoid(tup(c), [0.012 * sc, 0.011 * sc, 0.03 * sc], { bone: 'chest', k: 0.012 * sc, rot: [0, sx * 0.9, sx * 0.5] });
      }
  });
}

/** shoulder armour (sheet): a tattered leather mantle hanging over the deltoid under three
 *  overlapping rust-brown iron lames, a crown of big spikes and a rivet row along each lame */
function bolgPauldron(ctx: KindContext, gear: GearFn, side: 1 | -1) {
  const { P } = ctx;
  const sc = P.s;
  const g = Math.sqrt(P.build.bulk);
  const bone = side > 0 ? 'upperarm_l' : 'upperarm_r';
  const J = v3(P.j[bone]);
  const L = P.hand.l.L.clone();
  L.x *= side;
  const top = new THREE.Vector3(0.55 * side, 0.83, 0.02).normalize();
  const rot = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), top);
  const R = 0.128 * sc * g;
  const c = J.clone().addScaledVector(L, 0.025 * sc).add(V(-0.022 * side * sc, 0.012 * sc, 0));
  // outward-ness of an azimuth (local +X is outward for the left, inward for the right shoulder)
  const outw = (a: number) => Math.sin(a) * side;
  // torn edge: deep on the outside of the arm, shallow toward the neck; saw-tooth tatters
  const jag = (a: number) => {
    const f = ((a * 2.9) % 1 + 1) % 1;
    return 0.16 * Math.abs(f - 0.5) * 2 + 0.06 * Math.sin(a * 11.3) + 0.04 * Math.sin(a * 23.1);
  };
  const el0 = (a: number) => lerp(0.42, -0.62, (outw(a) + 1) / 2) - jag(a);
  const lfn = ellipsoidFn(c, [R * 1.0, R * 0.92, R * 1.05], [-Math.PI, Math.PI], [el0, Math.PI / 2 - 0.05], { rot });
  gear(shellPatch(lfn, 36, 5, 0.007 * sc, { closedU: true, skip: ['v1'] }), { bone, color: BOLG_PAL.leatherDark, mat: LEATHER, ao: 0.8 });
  // iron lames, top dome first, each lower one shifted down the arm
  for (let k = 0; k < 3; k++) {
    const axis = top.clone().lerp(L, k * 0.2).normalize();
    const rk = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
    const Rk = R * (1.1 - k * 0.035);
    const ck = c.clone().addScaledVector(L, k * 0.042 * sc);
    const half = (64 - k * 6) * (Math.PI / 180);
    const fn = ellipsoidFn(ck, [Rk * 1.04, Rk * 0.8, Rk * 1.1], [-Math.PI, Math.PI], [Math.PI / 2 - half, Math.PI / 2], { rot: rk });
    gear(shellPatch(fn, 14, 3, 0.009 * sc, { closedU: true, noInner: true, thickFn: (_u, v) => 1 + 1.2 * (1 - smooth(0, 0.18, v)), skip: ['v1'] }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.82 });
    // rivets along the lower rim
    for (let i = 0; i < 7; i++) {
      const a = ((i + 0.5) / 7) * Math.PI * 2;
      const e = Math.PI / 2 - half + 0.1;
      const d = V(Math.cos(e) * Math.sin(a) * Rk * 1.04, Math.sin(e) * Rk * 0.8, Math.cos(e) * Math.cos(a) * Rk * 1.1);
      const nn = V(Math.cos(e) * Math.sin(a) / 1.04, Math.sin(e) / 0.8, Math.cos(e) * Math.cos(a) / 1.1).normalize().applyQuaternion(rk);
      const p = d.applyQuaternion(rk).add(ck).addScaledVector(nn, 0.008 * sc);
      gear(rivet(0.0075 * sc, 5), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(p, nn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
  // spikes: a crown of seven around the top lame and three on its crest
  const spikes: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i++) spikes.push([((i + 0.25) / 7) * Math.PI * 2, 0.62, 0.019, 0.1]);
  for (let i = 0; i < 3; i++) spikes.push([(i / 3) * Math.PI * 2 + 0.6, 1.15, 0.021, 0.115]);
  for (const [a, e, r, h] of spikes) {
    // inner (neck-side) spikes stay short so they never stab the head
    const inner = outw(a) < -0.4;
    const d = V(Math.cos(e) * Math.sin(a) * 1.04, Math.sin(e) * 0.8, Math.cos(e) * Math.cos(a) * 1.1);
    const nn = V(Math.cos(e) * Math.sin(a) / 1.04, Math.sin(e) / 0.8, Math.cos(e) * Math.cos(a) / 1.1).normalize().applyQuaternion(rot);
    const p = d.multiplyScalar(R * 1.1).applyQuaternion(rot).add(c);
    gear(spike(r * sc, (inner ? h * 0.55 : h) * sc, 6, 0.06), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(p, nn.clone().lerp(top, 0.25).normalize(), V(0, 0, 1)) });
  }
}

/** thick leather bracers with iron bands at both ends and a row of spikes (sheet) */
function bolgBracers(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const L = P.hand.l.L;
  const j = P.j;
  const at = (t: number): [number, number, number] => [j.forearm_l[0] + L.x * P.foreArm * t, j.forearm_l[1] + L.y * P.foreArm * t, j.forearm_l[2]];
  const cut = (t0: number, t1: number) => {
    const a0 = at(t0), a1 = at(t1);
    s.plane([-L.x, -L.y, -L.z], -(L.x * a0[0] + L.y * a0[1] + L.z * a0[2]), { op: 'intersect', k: 0.004 * sc });
    s.plane([L.x, L.y, L.z], L.x * a1[0] + L.y * a1[1] + L.z * a1[2], { op: 'intersect', k: 0.004 * sc });
  };
  const seam = (t: number, n: 1 | -1) => {
    const a = at(t);
    s.plane([n * L.x, n * L.y, n * L.z], n * (L.x * a[0] + L.y * a[1] + L.z * a[2]), { op: 'paint', seam: 0, k: 0.002 });
  };
  // the forearm brawn (brawnBody) is bigger than the anatomy: inflate past it
  const inf = 0.03 * sc * P.build.bulk;
  s.mirrored(() =>
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['forearm'], { color: BOLG_PAL.leather, color2: BOLG_PAL.leatherDark, colorNoise: 0.35, colorFreq: 30 / sc, mat: LEATHER, inflate: inf, k: 0.016 * sc, oneSide: true });
      cut(0.16, 0.95);
      seam(0.16, -1);
      seam(0.95, 1);
    }),
  );
  for (const [t0, t1] of [[0.16, 0.25], [0.84, 0.95]] as [number, number][])
    s.mirrored(() =>
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: BOLG_PAL.iron, mat: IRON_RUSTY, inflate: inf + 0.007 * sc, k: 0.016 * sc, oneSide: true });
        cut(t0, t1);
      }),
    );
}

/** wide two-tier riveted belt with an iron ring at the front (sheet) */
function bolgBelt(ctx: KindContext, parts: ReturnType<typeof anatomyParts>, gear: GearFn, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const y0 = hipY + 0.035 * sc;
  const y1 = hipY + 0.16 * sc;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['pelvis', 'waist', 'belly', 'glutes'], { color: BOLG_PAL.leather, color2: BOLG_PAL.leatherDark, colorNoise: 0.4, colorFreq: 24 / sc, mat: LEATHER, inflate: 0.03 * sc });
    s.plane([0, 1, 0], y1, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -y0, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 1, 0], y1, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -y0, { op: 'paint', seam: 0, k: 0.002 });
  });
  // upper tier: a narrower, darker band proud of the lower one
  const ym = (y0 + y1) / 2 + 0.015 * sc;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['pelvis', 'waist', 'belly', 'glutes'], { color: BOLG_PAL.leatherDark, mat: LEATHER, inflate: 0.039 * sc });
    s.plane([0, 1, 0], y1 - 0.012 * sc, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -ym, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 1, 0], y1 - 0.012 * sc, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -ym, { op: 'paint', seam: 0, k: 0.002 });
  });
  // rivets along both tiers
  const n0 = 16;
  for (let i = 0; i < n0; i++) {
    const a = (i / n0) * Math.PI * 2 + 0.07;
    for (const [yy, lift] of [[y0 + 0.022 * sc, 0.0], [(ym + y1 - 0.012 * sc) / 2, 0.009 * sc]] as [number, number][]) {
      const r = ringSnap(proj, a, yy);
      if (!r) continue;
      const p = r.p.clone().addScaledVector(r.n, 0.03 * sc + lift);
      gear(rivet(0.0085 * sc, 5), { bone: 'hips', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(p, r.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
  // front ring
  const f = ringSnap(proj, 0, y0 + 0.01 * sc);
  if (f) {
    const p = f.p.clone().addScaledVector(f.n, 0.045 * sc);
    p.y -= 0.035 * sc;
    gear(new THREE.TorusGeometry(0.034 * sc, 0.0075 * sc, 6, 18), { bone: 'hips', color: BOLG_PAL.iron, mat: IRON_RUSTY, matrix: new THREE.Matrix4().makeTranslation(p.x, p.y, p.z) });
  }
  return y0;
}

/** big rusted greaves over the shin wraps: knee cap, shin plate, three leather straps (sheet) */
function bolgGreaves(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const g = Math.sqrt(P.build.bulk);
  for (const side of [1, -1]) {
    const sfx = side > 0 ? 'l' : 'r';
    const bone = `shin_${sfx}`;
    const kn = v3(j[`shin_${sfx}`]);
    const an = v3(j[`foot_${sfx}`]);
    const kc = V(kn.x, kn.y + 0.01 * sc, kn.z + 0.016 * sc);
    const kfn = ellipsoidFn(kc, [0.075 * sc * g, 0.07 * sc, 0.08 * sc * g], [-1.2, 1.2], [-0.55, 1.0]);
    gear(shellPatch(kfn, 10, 4, 0.01 * sc, { noInner: true }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
    gear(spike(0.017 * sc, 0.09 * sc, 6, 0.08), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(kc.x, kc.y + 0.01 * sc, kc.z + 0.085 * sc * g), V(0, 0.25, 1), V(0, 1, 0)) });
    // shin plate: from below the knee to just above the ankle, wrapping the front half of the shin
    const yTop = kn.y - 0.06 * sc;
    const yBot = an.y + 0.07 * sc;
    const c0 = V(kn.x, (yTop + yBot) / 2, kn.z - 0.006 * sc);
    const ry = (yTop - yBot) / 2;
    const sfn = ellipsoidFn(c0, [0.078 * sc * g, ry * 1.08, 0.082 * sc * g], [-1.55, 1.55], [-0.9, 0.9], { radial: (_a, e) => 1 / Math.max(0.55, Math.cos(e * 0.85)) * (0.92 + 0.08 * Math.cos(e)) });
    gear(shellPatch(sfn, 12, 8, 0.01 * sc, { noInner: true }), { bone, color: BOLG_PAL.leather, mat: surface('leather_worn', { rough: 0.62, pat: { leather: -0.4 } }), ao: 0.85 });
    // iron splints riveted onto the leather
    for (const a of [-0.9, 0, 0.9]) {
      const sp = ellipsoidFn(c0, [0.083 * sc * g, ry * 1.0, 0.087 * sc * g], [a - 0.2, a + 0.2], [-0.8, 0.8], { radial: (_a, e) => 1 / Math.max(0.55, Math.cos(e * 0.85)) * (0.92 + 0.08 * Math.cos(e)) });
      gear(shellPatch(sp, 2, 6, 0.008 * sc, { noInner: true }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85, small: true });
    }
    gear(spike(0.014 * sc, 0.07 * sc, 6, 0.05), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(c0.x, c0.y + ry * 0.2, c0.z + 0.09 * sc * g), V(0, 0.15, 1), V(0, 1, 0)), small: true });
    // straps around the calf
    for (const t of [0.18, 0.5, 0.82]) {
      const y = yTop - (yTop - yBot) * t;
      const band = ellipticalBand(0.093 * sc * g, 0.095 * sc * g, 0.09 * sc * g, 0.092 * sc * g, 0.024 * sc, 0.006 * sc, 18);
      gear(band, { bone, color: BOLG_PAL.leatherDark, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(kn.x, y, kn.z - 0.012 * sc), small: t !== 0.5 });
    }
  }
}

/** sandals: thick soles with straps over the foot and around the ankle (sheet) */
function bolgSandals(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  s.mirrored(() => {
    const f = j.foot_l;
    const toe = j.toe_l;
    s.box([f[0] + 0.004 * sc, 0.011 * sc, (f[2] + toe[2]) / 2 + 0.018 * sc], [0.054 * sc * P.build.footSize, 0.011 * sc, P.footLen * 0.55], 0.008 * sc, {
      color: BOLG_PAL.leatherDark,
      mat: LEATHER,
      bone: 'foot_l',
      bone2: 'toe_l',
      blendAxis: [[0, 0, f[2]], [0, 0, toe[2] + 0.02 * sc]],
      blend: [0.5, 0.8],
      k: 0.006 * sc,
    });
  });
  // straps across the instep and the toes
  for (const [z0, z1] of [[0.02, 0.045], [0.085, 0.105]] as [number, number][])
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['foot', 'toes'], { color: BOLG_PAL.leather, mat: LEATHER, inflate: 0.006 * sc });
      s.plane([0, 0, 1], j.foot_l[2] + z1 * sc, { op: 'intersect', k: 0.003 * sc });
      s.plane([0, 0, -1], -(j.foot_l[2] + z0 * sc), { op: 'intersect', k: 0.003 * sc });
    });
}

function bolgExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const gear = gearOf(ctx);
  const j = P.j;
  const parts = anatomyParts(P);
  const armor = ctx.armor;
  const box = { min: [-1, 0, -0.8] as [number, number, number], max: [1, P.H + 0.4, 0.9] as [number, number, number] };

  brawnBody(ctx, { traps: 1.45, lats: 1.35, delts: 1.45, forearm: 1.3, thigh: 1.2, calf: 1.2, biceps: 1.4 });
  // abs, clavicles, ribs and the extra chest muscles project onto the brawn body
  const projM = makeProjector(s, box);
  if (projM) {
    bareTorso(ctx, projM, { abs: 1.75, ribs: 1.25 });
    bolgMuscles(ctx, projM);
  }
  // sheet: the torso is bare (pale, scarred) under two crossed leather straps — no cuirass
  crossStraps(ctx, parts);
  if (armor >= 0.25) bolgBracers(ctx, parts);
  bolgSandals(ctx, parts);

  const proj0 = makeProjector(s, box);
  if (proj0) bolgFaceScars(ctx, proj0);

  const proj = makeProjector(s, box);
  if (!proj) return;
  skullHardware(ctx, gear, proj);
  bolgBelt(ctx, parts, gear, proj);

  // a mace sized for a 2.6 m brute
  scaleHeldWeapon(ctx, 'hand_r', ['mace'], [1.7, 1.55, 1.7]);

  // heavy spiked pauldrons over tattered leather on both shoulders (sheet)
  if (armor >= 0.5) {
    bolgPauldron(ctx, gear, 1);
    bolgPauldron(ctx, gear, -1);
  }

  // iron ring where the chest straps cross, rivets down each strap
  {
    const hp = V(), hn = V();
    if (snapPoint(proj, [0, strapCross(ctx), 0.6 * sc], 'f', hp, hn)) {
      const ring = new THREE.TorusGeometry(0.028 * sc, 0.0065 * sc, 6, 16);
      gear(ring, { bone: 'chest', color: BOLG_PAL.iron, mat: IRON_RUSTY, matrix: placeAlong(hp.clone().addScaledVector(hn, 0.004 * sc), V(0, 1, 0), hn) });
    }
    for (const sx of [1, -1]) {
      const n = new THREE.Vector3(sx * 1.0, 1.15, 0).normalize();
      for (let i = 0; i < 6; i++) {
        const x = sx * lerp(0.06, 0.2, i / 5) * sc * (i % 2 ? 1 : 1);
        const xx = -x;
        const y = (n.dot(V(0, strapCross(ctx), 0)) - n.x * xx) / n.y;
        if (Math.abs(xx) < 0.05 * sc) continue;
        if (!snapPoint(proj, [xx, y, 0.6 * sc], 'f', hp, hn)) continue;
        gear(rivet(0.0075 * sc, 5), { bone: 'chest', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(hp.clone().addScaledVector(hn, 0.002 * sc), hn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
    }
  }

  // spikes along the bracers (outer side)
  if (armor >= 0.25)
    for (const side of [1, -1]) {
      const L = P.hand.l.L.clone();
      L.x *= side;
      const a = new THREE.Vector3(...j[side > 0 ? 'forearm_l' : 'forearm_r']);
      for (let i = 0; i < 4; i++) {
        const c = a.clone().addScaledVector(L, (0.32 + i * 0.15) * P.foreArm);
        const pp = V(), nn = V();
        if (!snapPoint(proj, [c.x, c.y, c.z], side > 0 ? 'l' : 'r', pp, nn)) continue;
        gear(spike(0.016 * sc, 0.085 * sc, 6, 0.05), { bone: side > 0 ? 'forearm_l' : 'forearm_r', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(pp.addScaledVector(nn, 0.004 * sc), nn, V(0, 1, 0)) });
      }
    }

  // belt trophies: a skull at the hip and a chain
  {
    const hipY = j.thigh_l[1];
    const by = hipY + 0.08 * sc;
    for (const [a, sz] of [[0.95, 0.024]] as [number, number][]) {
      const r = ringSnap(proj, a, by - 0.01 * sc);
      if (!r) continue;
      const pos = r.p.clone().addScaledVector(r.n, 0.05 * sc);
      pos.y -= 0.1 * sc;
      gear(skullGeo(sz * sc), { bone: 'hips', color: 0x9c8e70, mat: BONE, matrix: placeAlong(pos, V(0, 1, 0), r.n.clone()), small: true });
      gear(new THREE.CylinderGeometry(0.003 * sc, 0.003 * sc, 0.1 * sc, 4, 1).translate(0, 0.05 * sc, 0), { bone: 'hips', color: 0x15100c, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z), small: true });
    }
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = lerp(-1.5, -0.35, i / 8);
      const r = ringSnap(proj, a, by - 0.05 * sc - 0.05 * sc * Math.sin((i / 8) * Math.PI));
      if (r) pts.push(r.p.clone().addScaledVector(r.n, 0.04 * sc));
    }
    if (pts.length > 4) for (const g of chainLinks(pts, 0.03 * sc, 0.005 * sc, V(0, 1, 0))) gear(g, { bone: 'hips', color: 0x4a4540, mat: IRON, small: true });
  }

  if (armor >= 0.5) bolgGreaves(ctx, gear);


  // raised scars across the arms, neck and shoulders (the skin shader adds many finer ones)
  const yS = j.upperarm_l[1];
  const welts: [SnapPoint[], string][] = [
    [[[0.3 * sc, yS - 0.08 * sc, 0.06 * sc, 'f'], [0.33 * sc, yS - 0.14 * sc, 0.0, 'l'], [0.36 * sc, yS - 0.2 * sc, -0.04 * sc, 'l']], 'upperarm_l'],
    [[[-0.32 * sc, yS - 0.1 * sc, 0.05 * sc, 'f'], [-0.35 * sc, yS - 0.17 * sc, 0.0, 'r']], 'upperarm_r'],
  ];
  for (const [w, bone] of welts) {
    const t = scarTube(proj, w, 0.0045 * sc, 0.0006);
    if (t) gear(t, { bone, color: SCAR, mat: surface('skin_scarred', { rough: 0.45, skin: 0.4 }), small: true });
  }
  void densePath;
  void ribbon;
  void hexBolt;
  void URUK_PAL;
}

export const bolgKind: KindDef = {
  label: 'Bolg',
  height: 2.6,
  build: { shoulders: 1.3, hips: 1.08, bulk: 1.25, chest: 1.18, belly: 0.03, armLength: 1.1, legLength: 0.98, headSize: 1.12, neck: 0.72, neckThick: 1.55, hunch: 0.15, handSize: 1.25, footSize: 1.2, muscle: 1.0 },
  face: BOLG_FACE,
  skin: { color: BOLG_PAL.skin, color2: BOLG_PAL.skin2, blotch: 0.3, blemish: 0.4, scars: 5, warts: 0.06, wrinkles: 0.6, lips: BOLG_PAL.lips, brows: 0x4a4440, surface: 'skin_scarred', scatter: BOLG_PAL.scatter },
  eyes: { color: BOLG_PAL.eyes, glow: 0.2, sclera: 0xc8bba4 },
  hair: { style: 'bald', color: 0x1a1612 },
  // bare legs under a tattered, layered knee-length kilt; shins and feet in worn wraps (sheet)
  outfit: [
    { type: 'wraps', color: 0x4f3e2e, thickness: 0.02 },
    { type: 'skirt', color: BOLG_PAL.kilt, color2: BOLG_PAL.kilt2, mat: 'rags', length: 0.9, tatter: 0.05, strips: { count: 9, color: BOLG_PAL.leather, color2: BOLG_PAL.leatherDark, mat: 'leather_worn', width: 0.075, length: 0.82, phase: 0.18 } },
  ],
  armor: [],
  // the 'orc' look turns the mace into a spiked morning star (sheet)
  weapons: { right: 'mace', style: 'orc' },
  palette: BOLG_PAL,
  sfx: { voice: 'orc', roar: 'orc_roar', weight: 0.9 },
  anim: { hunch: 0.15, swagger: 0.5, aggression: 1, stance: 1.2, armSwing: 1.0, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // finer body cells (the muscles need ≈ 3 cm to read) and a face region for the brow, eyes, nose
  // and fangs; one seam-refinement level and coarse hands keep him inside the boss budget
  detail: { faceRes: 0.009, res: 0.038, headRes: 0.0145, detailScale: 0.9, refine: 1, hands: false },
  extras: bolgExtras,
};
