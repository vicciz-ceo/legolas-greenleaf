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
import { anatomyParts, emitParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import type { PrimOpts } from '../../../kit/sdf';
import {
  V, v3, snapPoint, gearOf, makeProjector, carveSnapped, paintSnapped, scarTube, spike, placeAlong, shellPatch, ellipsoidFn, ribbon, lerp, smooth, ringSnap, densePath, ellipticalBand, rivet, tup, type SnapPoint, type GearFn, type Projector,
} from './common';
import { brawnBody, bareTorso, skinOpts } from './body';
import { scaleHeldWeapon } from './common';
import { kiltEnvelope, kiltPanel } from './bolg_kilt';

/** rusted, hammered iron: rust blooms in the pits and crevices (kit shader) */
const IRON_RUSTY = surface('iron_rusty', { rough: 0.66 });
const IRON = surface('iron_rusty', { rough: 0.55, pat: { pores: 0.6 } });
const LEATHER = surface('leather_worn', { rough: 0.72 });
/** healed cuts: dark red-purple */
const SCAR = 0x6a3a3c;

// sheet (docs/refs/bolg): pale warm skin crossed with red-purple scars (#c4c1b6 design, lit sheet
// reads #bca095 ≈ R:G:B 1 : .85 : .79), rust-brown iron #635647 (reads orange-brown, #8a5a3e lit),
// dark charcoal kilt #3c332b (lit #433a36), leather straps #4f3827 (lit #674539)
export const BOLG_PAL = {
  // second pass: warmer and a little pinker than the first-pass 0x967f70, which read grey-white
  skin: 0xa38477,
  skin2: 0x93706a,
  lips: 0x7a5652,
  scatter: 0xb86a58,
  eyes: 0x8a6a30, // amber (sheet iris #705529)
  iron: 0x74492f, // dark iron; the shader rusts it toward the sheet's orange-brown
  rust: 0x8a4f30,
  fur: 0x241d17,
  leather: 0x5a3b28, // coarse leather #4f3827 (lit #674539)
  leatherDark: 0x40291b,
  kilt: 0x3a3430, // charcoal cloth (sheet #3c332b design, lit #433a36): not pure black
  kilt2: 0x2a2622,
  stubble: 0x4a3626, // sheet beard: warm brown stubble-fuzz, not black
  ivory: 0xc9ad6a, // fangs: warm ivory
};

/** height where the two chest straps cross (sternum, between the pecs) */
function strapCross(ctx: KindContext) {
  const j = ctx.P.j;
  return j.chest[1] - 0.02 * ctx.P.s;
}

/** the sheet's harness (front, three-quarter and back views): ONE long baldric from the character's
 *  right shoulder (under the pauldron) across the chest to the left hip with an O-ring at the
 *  sternum, a second, shorter strap from the ring down to the right side, and at the back only two
 *  short vertical straps with rings under the pauldrons: the back is bare and scarred */
type Pl = [[number, number, number], number];
function crossStraps(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const mid = new THREE.Vector3(0, strapCross(ctx), 0);
  const hw = 0.024 * sc;
  const yTop = j.upperarm_l[1] + 0.06 * sc;
  const yBelt = j.thigh_l[1] + 0.12 * sc;
  const tags = ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'] as const;
  const group = (planes: Pl[], seams: Pl[]) =>
    s.group('union', 0.002 * sc, () => {
      // (inflated past the extra muscle masses of brawnBody)
      emitParts(s, parts, [...tags], { color: BOLG_PAL.leather, mat: LEATHER, inflate: 0.043 * sc, k: 0.05 * sc });
      for (const [n, d] of planes) s.plane(n, d, { op: 'intersect', k: 0.003 * sc });
      for (const [n, d] of seams) s.plane(n, d, { op: 'paint', seam: 0, k: 0.002 });
    });
  const frontOnly: Pl = [[0, 0, -1], 0.01 * sc];
  // the baldric (viewer-left shoulder → viewer-right hip)
  {
    const n = new THREE.Vector3(1, 1.15, 0).normalize();
    const c = n.dot(mid);
    const a: Pl = [[n.x, n.y, n.z], c + hw];
    const b: Pl = [[-n.x, -n.y, -n.z], -(c - hw)];
    group([a, b, [[0, 1, 0], yTop], [[0, -1, 0], -yBelt], frontOnly], [a, b]);
  }
  // the short strap from the ring toward the character's right hip
  {
    const n = new THREE.Vector3(-1, 1.15, 0).normalize();
    const c = n.dot(mid);
    const a: Pl = [[n.x, n.y, n.z], c + hw];
    const b: Pl = [[-n.x, -n.y, -n.z], -(c - hw)];
    group([a, b, [[1, 0, 0], 0.01 * sc], [[-1, 0, 0], 0.13 * sc], [[0, -1, 0], -yBelt], frontOnly], [a, b]);
  }
  // back: two short vertical straps from under the pauldrons (rings are added in the extras)
  for (const sx of [1, -1]) {
    const cx = sx * 0.133 * sc;
    const hx = 0.018 * sc;
    const a: Pl = [[1, 0, 0], cx + hx];
    const b: Pl = [[-1, 0, 0], -(cx - hx)];
    group([a, b, [[0, 1, 0], yTop - 0.02 * sc], [[0, -1, 0], -(j.upperarm_l[1] - 0.2 * sc)], [[0, 0, 1], 0]], [a, b]);
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
  tusks: 0, // the face's own cone rendered as a tiny dark peg: ivory fangs are gear (bolgFangs)
  underbite: 0.55, // (0.9 opened a dark slot under the nose)
  foreheadSlope: 0.4,
  asym: 0.5,
  cranium: 1.0,
};

function bolts(gear: GearFn, bone: string, pts: { p: THREE.Vector3; n: THREE.Vector3 }[], r: number) {
  // domed rivets (sheet: "bald scalp / bolted plates")
  for (const q of pts) gear(rivet(r, 6), { bone, color: 0x5a4a3c, mat: IRON, matrix: placeAlong(q.p, q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
}

/** the iron band bolted into the skull (sheet front and profile views show one on EACH side),
 *  continuing as a brace down in front of the ear and along the jaw — no helmet rim, no chin plate
 *  (the beard shows) */
function skullHardware(ctx: KindContext, gear: GearFn, proj: ReturnType<typeof makeProjector>) {
  for (const sg of [1, -1] as const) skullSide(ctx, gear, proj, sg);
}

function skullSide(ctx: KindContext, gear: GearFn, proj: ReturnType<typeof makeProjector>, sg: 1 | -1) {
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
    return { p: V(sg * d.x * R[0] * k, d.y * R[1] * k, d.z * R[2] * k).add(C), n: V(sg * d.x / R[0], d.y / R[1], d.z / R[2]).normalize() };
  };
  // skull band (mirrored per side by sg): from the crown down over the temple, irregular edges
  const a0 = (e: number) => 0.98 + 0.05 * Math.sin(e * 7.0);
  const a1 = (e: number) => 1.46 + 0.04 * Math.sin(e * 5.3 + 1.0);
  const plate = shellPatch(
    (uu0, vv, o) => {
      const uu = sg > 0 ? uu0 : 1 - uu0; // mirrored: reverse u so the winding stays outward
      const e = lerp(0.06, 1.08, vv);
      const az = lerp(a0(e), a1(e), uu);
      const d = V(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az));
      o.p.set(sg * d.x * R[0] * 1.04, d.y * R[1] * 1.04, d.z * R[2] * 1.04).add(C);
      o.n.set(sg * d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    },
    4,
    12,
    th,
    { thickFn: (uu) => 1 + 0.4 * (1 - smooth(0, 0.2, Math.min(uu, 1 - uu))) },
  );
  gear(plate, { bone: 'head', color: iron, mat: IRON_RUSTY, ao: 0.9 });
  for (let i = 0; i < 6; i++) {
    const e = lerp(0.16, 0.98, i / 5);
    bt.push(onEllipsoid(a0(e) + 0.07, e, 1.06), onEllipsoid(a1(e) - 0.07, e, 1.06));
  }
  bolts(gear, 'head', bt, 0.0085 * sc);

  // jaw brace: continues the band down in front of the ear and along the jawline
  if (proj) {
    const far = 0.55 * u;
    const HP = (x: number, y: number, z: number, m: 'l' | 'r' | 'f' | 'u'): SnapPoint => {
      const q = P.h(sg * x, y, z);
      return [q[0], q[1], q[2], m, far];
    };
    const M = sg > 0 ? 'l' : 'r';
    const jawBolts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    const pa = densePath(proj, [HP(0.3, 0.1, 0.06, M), HP(0.3, -0.06, 0.05, M), HP(0.285, -0.22, 0.05, M), HP(0.26, -0.36, 0.06, M), HP(0.21, -0.46, 0.14, M)], 0.012 * sc, 0.003 * sc);
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
  // dark stubble beard (sheet face views): a short thick beard that follows the jaw from the ear to
  // the chin and climbs the cheek, a chin patch and a moustache; the lips themselves stay clear
  const stub: PrimOpts = { color: BOLG_PAL.stubble, mat: surface('skin_scarred', { rough: 0.82, pat: { fur: 1.5, pores: -0.5 } }), k: 0.03 * u, strength: 0.86 };
  for (const sx of [1, -1]) {
    // sideburn → along the jaw → chin
    paintSnapped(s, proj, [H(0.27 * sx, -0.14), H(0.26 * sx, -0.26), H(0.215 * sx, -0.37), H(0.12 * sx, -0.45), H(0.03 * sx, -0.49)], [0.032 * u, 0.045 * u, 0.05 * u, 0.055 * u, 0.055 * u], { ...stub, bone: 'head' });
  }
  paintSnapped(s, proj, [H(-0.12, -0.47), H(0.0, -0.5), H(0.12, -0.47)], 0.06 * u, { ...stub, bone: 'jaw' });
  // chin centre and the point of the chin: no pale blob under the strokes
  paintSnapped(s, proj, [H(-0.06, -0.52), H(0.0, -0.535), H(0.06, -0.52)], 0.04 * u, { ...stub, bone: 'jaw', k: 0.05 * u, strength: 0.8 });
  // moustache
  paintSnapped(s, proj, [H(-0.11, -0.345), H(0.0, -0.335), H(0.11, -0.345)], 0.022 * u, { ...stub, bone: 'head', strength: 0.8 });
  // light mottling round the eye sockets (soft and shallow: a hard disc read as a ghost ring)
  for (const sx of [1, -1]) paintSnapped(s, proj, [H(0.13 * sx, -0.07), H(0.18 * sx, -0.08)], 0.034 * u, { color: 0x6a5048, mat: 'skin_scarred', bone: 'head', k: 0.05 * u, strength: 0.3 });
  // re-assert the lips over the beard, and close the dark slot under the nose with the lip colour
  s.ellipsoid(P.h(0, -0.415, 0.39), [0.07 * u, 0.02 * u, 0.04 * u], { color: BOLG_PAL.lips, mat: 'lips', bone: 'jaw', op: 'paint', k: 0.012 * u, strength: 0.85 });
  s.ellipsoid(P.h(0, -0.392, 0.392), [0.07 * u, 0.012 * u, 0.04 * u], { color: BOLG_PAL.lips, mat: 'lips', bone: 'head', op: 'paint', k: 0.012 * u, strength: 0.95 });
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
  /** dome height of the lames (flat layered plates, not domes) */
  const LY = 0.72;
  const c = J.clone().addScaledVector(L, 0.025 * sc).add(V(-0.043 * side * sc, 0.0, 0));
  // outward-ness of an azimuth (local +X is outward for the left, inward for the right shoulder)
  const outw = (a: number) => Math.sin(a) * side;
  // torn edge: deep on the outside of the arm, shallow toward the neck; saw-tooth tatters
  const jag = (a: number) => {
    const f = ((a * 2.9) % 1 + 1) % 1;
    return 0.24 * Math.abs(f - 0.5) * 2 + 0.07 * Math.sin(a * 11.3) + 0.05 * Math.sin(a * 23.1);
  };
  const el0 = (a: number) => lerp(0.42, -0.62, (outw(a) + 1) / 2) - jag(a);
  const lfn = ellipsoidFn(c, [R * 1.12, R * 0.78, R * 1.1], [-Math.PI, Math.PI], [el0, Math.PI / 2 - 0.05], { rot });
  gear(shellPatch(lfn, 26, 4, 0.007 * sc, { closedU: true, skip: ['v1'] }), { bone, color: BOLG_PAL.leatherDark, mat: LEATHER, ao: 0.8 });
  // iron lames, top dome first, each lower one shifted down the arm
  for (let k = 0; k < 3; k++) {
    const axis = top.clone().lerp(L, k * 0.2).normalize();
    const rk = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
    const Rk = R * (1.1 - k * 0.035);
    const ck = c.clone().addScaledVector(L, k * 0.058 * sc);
    const half = (64 - k * 6) * (Math.PI / 180);
    const fn = ellipsoidFn(ck, [Rk * 1.14, Rk * LY, Rk * 1.16], [-Math.PI, Math.PI], [Math.PI / 2 - half, Math.PI / 2], { rot: rk });
    gear(shellPatch(fn, 14, 3, 0.009 * sc, { closedU: true, noInner: true, thickFn: (_u, v) => 1 + 1.2 * (1 - smooth(0, 0.18, v)), skip: ['v1'] }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.82 });
    // rivets along the lower rim
    for (let i = 0; i < 5; i++) {
      const a = ((i + 0.5) / 5) * Math.PI * 2;
      const e = Math.PI / 2 - half + 0.1;
      const d = V(Math.cos(e) * Math.sin(a) * Rk * 1.14, Math.sin(e) * Rk * LY, Math.cos(e) * Math.cos(a) * Rk * 1.16);
      const nn = V(Math.cos(e) * Math.sin(a) / 1.14, Math.sin(e) / LY, Math.cos(e) * Math.cos(a) / 1.16).normalize().applyQuaternion(rk);
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
    const d = V(Math.cos(e) * Math.sin(a) * 1.14, Math.sin(e) * LY, Math.cos(e) * Math.cos(a) * 1.16);
    const nn = V(Math.cos(e) * Math.sin(a) / 1.14, Math.sin(e) / LY, Math.cos(e) * Math.cos(a) / 1.16).normalize().applyQuaternion(rot);
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
  const n0 = 12;
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
}

/** greaves as the sheet draws them: plated, strapped boots from the ankle wraps up to a flared knee
 *  plate above the knee — a full leather shaft, a riveted iron shin plate, three tight straps and
 *  layered ankle wraps (not a barrel with floating hoops) */
function bolgGreaves(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const g = Math.sqrt(P.build.bulk);
  const radial = (_a: number, e: number) => (1 / Math.max(0.55, Math.cos(e * 0.85))) * (0.92 + 0.08 * Math.cos(e));
  for (const side of [1, -1]) {
    const sfx = side > 0 ? 'l' : 'r';
    const bone = `shin_${sfx}`;
    const kn = v3(j[`shin_${sfx}`]);
    const an = v3(j[`foot_${sfx}`]);
    const yTop = kn.y + 0.07 * sc;
    const yBot = an.y + 0.11 * sc;
    // the shin axis leans: knee → ankle
    const axis = (y: number) => {
      const t = (y - an.y) / (kn.y - an.y);
      return V(lerp(an.x, kn.x, t), y, lerp(an.z, kn.z, t) - 0.004 * sc);
    };
    const c0 = axis((yTop + yBot) / 2);
    const cs = c0.clone();
    cs.z -= 0.022 * sc; // the brawn calf sits behind the shin axis: the shaft follows it
    const ry = (yTop - yBot) / 2;
    // leather shaft: the whole way round
    const shaft = ellipsoidFn(cs, [0.088 * sc * g, ry * 1.06, 0.098 * sc * g], [-Math.PI, Math.PI], [-0.9, 0.9], { radial });
    gear(shellPatch(shaft, 12, 5, 0.009 * sc, { closedU: true, noInner: true }), { bone, color: BOLG_PAL.leatherDark, mat: surface('leather_worn', { rough: 0.62, pat: { leather: -0.4 } }), ao: 0.85 });
    // riveted iron plate over the front of the shin
    const plate = ellipsoidFn(c0, [0.092 * sc * g, ry * 1.0, 0.098 * sc * g], [-0.95, 0.95], [-0.85, 0.85], { radial });
    gear(shellPatch(plate, 8, 6, 0.009 * sc, { noInner: true }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
    for (const [a, t] of [[-0.72, 0.1], [0.72, 0.1], [-0.72, 0.9], [0.72, 0.9], [0, 0.5]] as [number, number][]) {
      const y = yTop - (yTop - yBot) * t;
      const cc = axis(y);
      const p = V(cc.x + Math.sin(a) * 0.098 * sc * g, y, cc.z + Math.cos(a) * 0.104 * sc * g);
      gear(rivet(0.0075 * sc, 5), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(p, V(Math.sin(a), 0, Math.cos(a)), V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
    // flared knee plate with the spike
    const kc = axis(yTop - 0.012 * sc);
    const kfn = ellipsoidFn(V(kc.x, kc.y, kc.z + 0.004 * sc), [0.1 * sc * g, 0.05 * sc, 0.108 * sc * g], [-1.25, 1.25], [-0.2, 0.9]);
    gear(shellPatch(kfn, 10, 4, 0.009 * sc, { noInner: true }), { bone, color: BOLG_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
    gear(spike(0.017 * sc, 0.085 * sc, 6, 0.08), { bone, color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(V(kc.x, kc.y + 0.012 * sc, kc.z + 0.095 * sc * g), V(0, 0.25, 1), V(0, 1, 0)) });
    // three tight straps round the shaft
    for (const t of [0.24, 0.52, 0.8]) {
      const y = yTop - (yTop - yBot) * t;
      const cc = axis(y);
      const band = ellipticalBand(0.096 * sc * g, 0.106 * sc * g, 0.095 * sc * g, 0.105 * sc * g, 0.022 * sc, 0.006 * sc, 16, 0, Math.PI * 2, -0.022 * sc);
      gear(band, { bone, color: BOLG_PAL.leather, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(cc.x, cc.y, cc.z), small: t !== 0.52 });
    }
    // layered ankle wraps below the shaft
    for (let i = 0; i < 3; i++) {
      const y = yBot - 0.012 * sc - i * 0.022 * sc;
      const cc = axis(y);
      const r = (0.074 - i * 0.002) * sc * g;
      const band = ellipticalBand(r, r * 1.08, r - 0.002 * sc, r * 1.08, 0.021 * sc, 0.0055 * sc, 14);
      gear(band, { bone, color: i % 2 ? 0x4a3524 : 0x5a3f2a, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(cc.x, cc.y, cc.z), small: true });
    }
  }
}

/** sandals: a thick dark sole, the foot tinted toward the body's warm skin, and two wide leather
 *  bands (ankle and instep): thin repeated straps aliased into black-and-white stripes on the pale foot */
function bolgSandals(ctx: KindContext, gear: GearFn) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const fs = P.build.footSize;
  s.mirrored(() => {
    const f = j.foot_l;
    const toe = j.toe_l;
    s.box([f[0] + 0.004 * sc, 0.016 * sc, (f[2] + toe[2]) / 2 + 0.018 * sc], [0.06 * sc * fs, 0.022 * sc, P.footLen * 0.57], 0.01 * sc, {
      color: 0x2a1d13,
      mat: LEATHER,
      bone: 'foot_l',
      bone2: 'toe_l',
      blendAxis: [[0, 0, f[2]], [0, 0, toe[2] + 0.02 * sc]],
      blend: [0.5, 0.8],
      k: 0.006 * sc,
    });
    // warm tint on the foot itself (the pale foot read as a white boot)
    s.ellipsoid([f[0] + 0.004 * sc, 0.07 * sc, (f[2] + toe[2]) / 2 + 0.018 * sc], [0.07 * sc * fs, 0.08 * sc, P.footLen * 0.6], { op: 'paint', color: BOLG_PAL.skin2, mat: 'skin_scarred', bone: 'foot_l', bone2: 'toe_l', blendAxis: [[0, 0, f[2]], [0, 0, toe[2] + 0.02 * sc]], blend: [0.5, 0.8], k: 0.04 * sc, strength: 0.6 });
  });
  for (const side of [1, -1]) {
    const sfx = side > 0 ? 'l' : 'r';
    const f = v3(j[`foot_${sfx}`]);
    const toe = v3(j[`toe_${sfx}`]);
    for (const [t, rx, ry, hh] of [[0.0, 0.066, 0.07, 0.04], [0.36, 0.058, 0.048, 0.034]] as [number, number, number, number][]) {
      const z = f.z + (toe.z - f.z) * t + 0.012 * sc;
      const x = f.x + (toe.x - f.x) * t;
      const y = Math.max(0.03 * sc, f.y * (1 - t) * 0.62 + 0.03 * sc * t) + 0.012 * sc;
      const band = ellipticalBand(rx * sc * fs, ry * sc, rx * sc * fs, ry * sc, hh * sc, 0.005 * sc, 16);
      gear(band, { bone: `foot_${sfx}`, color: 0x5a3b28, mat: LEATHER, matrix: new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: t > 0.2 });
    }
  }
}

/** a dark cloth liner under the kilt: the kilt is four panels with small gaps between them, and on
 *  Bolg's pale body the bare thigh showed through them as bright vertical lines. It reaches the
 *  kilt's short side hem; the long front/back points hang over bare thigh like the sheet's. */
function bolgKiltLiner(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const bottom = hipY - (hipY - kneeY) * KILT.length * 1.1 + 0.01 * sc;
  s.group('union', 0.003 * sc, () => {
    emitParts(s, parts, ['thigh', 'knee', 'glutes', 'pelvis'], { color: BOLG_PAL.kilt2, mat: surface('rags', { rough: 0.95 }), inflate: 0.05 * sc * Math.sqrt(P.build.bulk), k: 0.02 * sc });
    s.plane([0, 1, 0], hipY + 0.05 * sc, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -bottom, { op: 'intersect', k: 0.004 * sc });
  });
}

/** ivory lower fangs standing up out of the lower lip, a little outward (sheet face views) */
function bolgFangs(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const u = P.headH;
  for (const sx of [1, -1]) {
    const base = v3(P.h(0.072 * sx, -0.43, 0.392));
    const dir = V(0.2 * sx, 1, 0.3).normalize();
    gear(spike(0.033 * u, 0.09 * u, 6, 0.02), { bone: 'jaw', color: BOLG_PAL.ivory, mat: surface('bone', { rough: 0.45 }), matrix: placeAlong(base, dir, V(0, 0, 1)), small: true });
  }
}

/** the sheet's hip hardware over the charcoal kilt: a pointed front plate under the belt and two
 *  rivetted flank panels, rust-brown leather */
function bolgHipPanels(ctx: KindContext, gear: GearFn) {
  const sc = ctx.P.s;
  const env = kiltEnvelope(ctx, KILT.length, KILT.thickness);
  const base = { color: BOLG_PAL.leather, mat: LEATHER, rivetColor: 0x6a4a34, rivetMat: IRON };
  // front plate: pointed at the centre
  kiltPanel(ctx, env, gear, { ...base, a0: -0.5, a1: 0.5, len: (u) => (0.3 - 0.2 * Math.abs(2 * u - 1)) * sc, rivets: 2 });
  // the rust centre strap down the long front tongue
  kiltPanel(ctx, env, gear, { ...base, a0: -0.07, a1: 0.07, len: () => 0.52 * sc, out: 0.026 * sc, rivets: 2 });
  // leather panel at the back
  kiltPanel(ctx, env, gear, { ...base, a0: Math.PI - 0.55, a1: Math.PI + 0.55, len: (u) => (0.3 - 0.16 * Math.abs(2 * u - 1)) * sc, rivets: 0 });
  // flank panels: squared, with a ragged lower edge
  for (const sg of [1, -1]) {
    const a0 = sg > 0 ? 0.85 : -1.5;
    const a1 = sg > 0 ? 1.5 : -0.85;
    kiltPanel(ctx, env, gear, { ...base, a0, a1, len: (u) => (0.26 + 0.03 * Math.sin(u * 17)) * sc, out: 0.03 * sc, rivets: 1 });
  }
}

/** scar networks (sheet back, scalp and chest): painted healed cuts */
function bolgScars(ctx: KindContext, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const yS = j.upperarm_l[1];
  const chestY = j.chest[1];
  const o: PrimOpts = { color: SCAR, mat: 'skin_scarred', bone: 'chest', k: 0.004 * sc, strength: 0.85 };
  const line = (a: [number, number], b: [number, number], n = 7): SnapPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [(a[0] + (b[0] - a[0]) * t) * sc, a[1] + (b[1] - a[1]) * t + 0.01 * sc * Math.sin(t * 6 + a[0] * 11), 0, 'b'] as SnapPoint;
    });
  // back: two long crossing diagonals with shorter ones across them
  for (const w of [line([-0.16, yS - 0.02 * sc], [0.12, chestY - 0.36 * sc]), line([0.16, yS - 0.02 * sc], [-0.12, chestY - 0.36 * sc]), line([-0.14, chestY - 0.1 * sc], [0.03, chestY - 0.3 * sc], 5), line([0.14, chestY - 0.12 * sc], [-0.03, chestY - 0.3 * sc], 5)]) paintSnapped(s, proj, w, 0.0045 * sc, o);
  // traps and chest
  for (const sx of [1, -1]) paintSnapped(s, proj, [[sx * 0.09 * sc, yS + 0.05 * sc, 0, 't'], [sx * 0.12 * sc, yS + 0.0 * sc, 0, 't']], 0.004 * sc, o);
  // scalp: three long cuts across the bald head
  const H = (x: number, y: number, z: number): SnapPoint => {
    const q = P.h(x, y, z);
    return [q[0], q[1], q[2], 't'];
  };
  const so: PrimOpts = { color: SCAR, mat: 'skin_scarred', bone: 'head', k: 0.004 * sc, strength: 0.8 };
  paintSnapped(s, proj, [H(-0.2, 0.2, 0.05), H(-0.1, 0.32, 0.0), H(0.0, 0.4, -0.1), H(0.12, 0.34, -0.2)], 0.0045 * sc, so);
  paintSnapped(s, proj, [H(0.18, 0.2, 0.15), H(0.12, 0.3, 0.05), H(0.05, 0.4, -0.05)], 0.004 * sc, so);
  paintSnapped(s, proj, [H(-0.12, 0.3, -0.3), H(0.0, 0.2, -0.4), H(0.14, 0.1, -0.42)], 0.004 * sc, so);
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
  bolgSandals(ctx, gear);
  bolgKiltLiner(ctx, parts);

  const proj0 = makeProjector(s, box);
  if (proj0) {
    bolgFaceScars(ctx, proj0);
    bolgScars(ctx, proj0);
  }

  const proj = makeProjector(s, box);
  if (!proj) return;
  skullHardware(ctx, gear, proj);
  bolgFangs(ctx, gear);
  bolgHipPanels(ctx, gear);
  bolgBelt(ctx, parts, gear, proj);

  // a mace sized for a 2.6 m brute
  scaleHeldWeapon(ctx, 'hand_r', ['mace'], [1.7, 1.55, 1.7]);

  // heavy spiked pauldrons over tattered leather on both shoulders (sheet)
  if (armor >= 0.5) {
    bolgPauldron(ctx, gear, 1);
    bolgPauldron(ctx, gear, -1);
  }

  // iron ring where the straps meet at the sternum, rivets along the baldric and the short strap
  {
    const hp = V(), hn = V();
    if (snapPoint(proj, [0, strapCross(ctx), 0.6 * sc], 'f', hp, hn)) {
      const ring = new THREE.TorusGeometry(0.028 * sc, 0.0065 * sc, 6, 16);
      gear(ring, { bone: 'chest', color: BOLG_PAL.iron, mat: IRON_RUSTY, matrix: placeAlong(hp.clone().addScaledVector(hn, 0.004 * sc), V(0, 1, 0), hn) });
    }
    const mid = V(0, strapCross(ctx), 0);
    const rivets = (nx: number, xs: number[]) => {
      const n = new THREE.Vector3(nx, 1.15, 0).normalize();
      const c = n.dot(mid);
      for (const x of xs) {
        const xx = x * sc;
        const y = (c - n.x * xx) / n.y;
        if (!snapPoint(proj, [xx, y, 0.6 * sc], 'f', hp, hn)) continue;
        gear(rivet(0.0075 * sc, 5), { bone: 'chest', color: BOLG_PAL.iron, mat: IRON, matrix: placeAlong(hp.clone().addScaledVector(hn, 0.002 * sc), hn, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
    };
    rivets(1, [-0.27, -0.22, -0.17, -0.12, 0.08, 0.13, 0.17]); // along the baldric, inside its y clip (belt top … shoulder)
    rivets(-1, [-0.03, -0.06, -0.09]); // the short strap is clipped to x ∈ [-0.13 sc, 0.01 sc]
    // the back: a ring at the foot of each short strap, under the pauldron
    for (const sx of [1, -1]) {
      if (!snapPoint(proj, [sx * 0.133 * sc, j.upperarm_l[1] - 0.005 * sc, -0.6 * sc], 'b', hp, hn)) continue;
      gear(new THREE.TorusGeometry(0.024 * sc, 0.006 * sc, 6, 14), { bone: 'chest', color: BOLG_PAL.iron, mat: IRON_RUSTY, matrix: placeAlong(hp.clone().addScaledVector(hn, 0.004 * sc), V(0, 1, 0), hn), small: true });
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
}

/** the outfit kilt's length and clearance; the rigid hip panels in bolgHipPanels follow it */
const KILT = { length: 0.72, thickness: 0.02 };

export const bolgKind: KindDef = {
  label: 'Bolg',
  // legLength 1.08 puts the hip, and so the belt, at the sheet's 1.45-1.65 m (it was 0.15 m low).
  // 2.64: the hunch and the idle sag put the crown at 2.557 m in the calibrated lab for 2.6 (sheet 2.6)
  height: 2.66,
  build: { shoulders: 1.3, hips: 1.08, bulk: 1.25, chest: 1.18, belly: 0.03, armLength: 1.1, legLength: 1.08, headSize: 1.12, neck: 0.8, neckThick: 1.55, hunch: 0.15, handSize: 1.25, footSize: 1.2, muscle: 1.0 },
  face: BOLG_FACE,
  skin: { color: BOLG_PAL.skin, color2: BOLG_PAL.skin2, blotch: 0.3, blemish: 0.4, scars: 5, warts: 0.06, wrinkles: 0.6, lips: BOLG_PAL.lips, brows: 0x4a4440, surface: 'skin_scarred', scatter: BOLG_PAL.scatter },
  eyes: { color: BOLG_PAL.eyes, glow: 0.2, sclera: 0xc8bba4 },
  hair: { style: 'bald', color: 0x1a1612 },
  // bare legs under a tattered, layered knee-length kilt; shins and feet in worn wraps (sheet)
  outfit: [
    { type: 'wraps', color: 0x4f3e2e, thickness: 0.02 },
    // charcoal cloth to just above the knee at the sides; two long pointed tongues (front and back) make the V
    // (strips, ≈ 0.5 m at the centre), the rust leather is only the belt hangers
    { type: 'skirt', color: BOLG_PAL.kilt, color2: BOLG_PAL.kilt2, mat: 'rags', length: KILT.length, thickness: KILT.thickness, tatter: 0.08, strips: { count: 2, color: 0x2e2a27, color2: BOLG_PAL.kilt2, mat: 'rags', width: 0.2, length: 1.7, phase: 0 } },
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
