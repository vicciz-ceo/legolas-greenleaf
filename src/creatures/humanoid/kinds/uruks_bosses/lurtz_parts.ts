/**
 * Lurtz's sculpted hardware (docs/refs/lurtz): dark segmented leather bracers, a wide two-tier
 * belt with an iron ring and hanging tie straps, and wrapped boots with cross-binding. Kept apart
 * from lurtz.ts so the kind file stays readable; self-contained (no dependence on uruk.ts values).
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import { V, placeAlong, rivet, ringSnap, spike, ribbon, type GearFn, type Projector } from './common';
import { kiltEnvelope, kiltPanel } from './bolg_kilt';

export const LURTZ_PAL = {
  // sheet design skin #55432f, lit torso #7f645b: albedo kept darker and redder than the hex because
  // the lab and AgX lift browns toward clay
  skin: 0x4c362d, // between the sheet's chest (lab was +16) and upper arm (lab was -13): one albedo cannot fit both patches, see the report
  skin2: 0x33261f,
  lips: 0x1a110e,
  brows: 0x14100d,
  scatter: 0x8a3a28, // warm shadows
  hair: 0x1b1714, // details hair sample #1b1714 (lit), design #24211b: near-black at root and tip
  eyes: 0xb88c39, // design iris #b88c39
  kilt: 0x1f1d1e, // design #302a25 (lit #463e3a): near-black charcoal
  kilt2: 0x4a3426, // hem grime: rust-brown
  flap: 0x1a130e, // the central flap and the belt hangers: grimy brown. 0x4a3322 rendered (113,92,79) and 0x241911 on leather_worn (82,74,69) against the sheet's (35,31,29): leather lifts dark colours, so they are cloth now
  belt: 0x241810, // design #4d3a2b (lit #463933)
  beltDark: 0x120b07,
  leather: 0x2a211c, // bracers: near-black leather, sheet reads #3a312e lit
  leatherDark: 0x120e0b,
  wrap: 0x30251c, // foot wraps design #40352b (lit #40362f) (0x2e241c rendered ~35 RGB lighter than the sheet's boots)
  wrap2: 0x140f0a,
  iron: 0x3a352e, // blackened iron (shield #302e28, bracer fittings #6b6657 lit)
  ironLt: 0x5a554b,
  bone: 0xcbbf9d,
};

const LEATHER = surface('leather_worn', { rough: 0.74 });
const LEATHER_DK = surface('leather_worn', { rough: 0.8, pat: { leather: -0.3 } });
const IRON = surface('iron_rusty', { rough: 0.62 });

/** dark segmented leather bracers, wrist → ~80 % of the forearm, three raised bands and two tie straps */
export function lurtzBracers(ctx: KindContext, parts: ReturnType<typeof anatomyParts>, gear: GearFn) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const L = P.hand.l.L;
  const j = P.j;
  const at = (t: number): [number, number, number] => [j.forearm_l[0] + L.x * P.foreArm * t, j.forearm_l[1] + L.y * P.foreArm * t, j.forearm_l[2]];
  const cut = (t0: number, t1: number) => {
    const a0 = at(t0), a1 = at(t1);
    s.plane([-L.x, -L.y, -L.z], -(L.x * a0[0] + L.y * a0[1] + L.z * a0[2]), { op: 'intersect', k: 0.003 * sc });
    s.plane([L.x, L.y, L.z], L.x * a1[0] + L.y * a1[1] + L.z * a1[2], { op: 'intersect', k: 0.003 * sc });
  };
  const seam = (t: number, n: 1 | -1) => {
    const a = at(t);
    s.plane([n * L.x, n * L.y, n * L.z], n * (L.x * a[0] + L.y * a[1] + L.z * a[2]), { op: 'paint', seam: 0, k: 0.002 });
  };
  // inflate past the brawn forearm (brawnBody) so the leather isn't swallowed by the muscle
  const inf = 0.024 * sc * P.build.bulk;
  const t0 = 0.1, t1 = 0.84;
  s.mirrored(() =>
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['forearm'], { color: LURTZ_PAL.leather, color2: LURTZ_PAL.leatherDark, colorNoise: 0.4, colorFreq: 34 / sc, mat: LEATHER, inflate: inf, k: 0.014 * sc, oneSide: true });
      cut(t0, t1);
      seam(t0, -1);
      seam(t1, 1);
    }),
  );
  // raised segment bands (darker, a little proud)
  for (const [a, b] of [[0.1, 0.2], [0.4, 0.5], [0.74, 0.84]] as [number, number][])
    s.mirrored(() =>
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: LURTZ_PAL.leatherDark, mat: LEATHER_DK, inflate: inf + 0.0055 * sc, k: 0.014 * sc, oneSide: true });
        cut(a, b);
        seam(a, -1);
        seam(b, 1);
      }),
    );
  // rivets on the outer face of the bands
  for (const side of [1, -1]) {
    const Ls = L.clone();
    Ls.x *= side;
    const f0 = new THREE.Vector3(...j[side > 0 ? 'forearm_l' : 'forearm_r']);
    for (const t of [0.15, 0.45, 0.79]) {
      const c = f0.clone().addScaledVector(Ls, t * P.foreArm).addScaledVector(V(side, 0, 0), 0.05 * sc * P.build.bulk);
      gear(rivet(0.0055 * sc, 5), { bone: side > 0 ? 'forearm_l' : 'forearm_r', color: LURTZ_PAL.ironLt, mat: IRON, matrix: placeAlong(c, V(side, 0, 0), V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
}

/** wide two-tier belt (sheet: ≈ 0.17 m wide, ring buckle, tie ends hanging over the kilt) */
export function lurtzBelt(ctx: KindContext, parts: ReturnType<typeof anatomyParts>, gear: GearFn, proj: Projector) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const hipY = P.j.thigh_l[1];
  const y0 = hipY + 0.02 * sc;
  const y1 = hipY + 0.155 * sc;
  const bodyParts = ['pelvis', 'waist', 'belly', 'glutes'] as const;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, [...bodyParts], { color: LURTZ_PAL.belt, color2: LURTZ_PAL.beltDark, colorNoise: 0.4, colorFreq: 26 / sc, mat: LEATHER, inflate: 0.026 * sc });
    s.plane([0, 1, 0], y1, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -y0, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 1, 0], y1, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -y0, { op: 'paint', seam: 0, k: 0.002 });
  });
  // upper wrap: a second, narrower strap pulled tight over the belt
  const ya = y0 + 0.07 * sc;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, [...bodyParts], { color: LURTZ_PAL.beltDark, mat: LEATHER_DK, inflate: 0.033 * sc });
    s.plane([0, 1, 0], y1 - 0.012 * sc, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, -1, 0], -ya, { op: 'intersect', k: 0.003 * sc });
    s.plane([0, 1, 0], y1 - 0.012 * sc, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -ya, { op: 'paint', seam: 0, k: 0.002 });
  });
  // front ring where the straps meet
  const f = ringSnap(proj, 0, (y0 + y1) / 2);
  if (f) {
    const p = f.p.clone().addScaledVector(f.n, 0.04 * sc);
    gear(new THREE.TorusGeometry(0.03 * sc, 0.0065 * sc, 6, 16), { bone: 'hips', color: LURTZ_PAL.ironLt, mat: IRON, matrix: new THREE.Matrix4().makeTranslation(p.x, p.y, p.z) });
  }
  // a row of studs along the lower tier
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const r = ringSnap(proj, a, y0 + 0.03 * sc);
    if (!r) continue;
    const p = r.p.clone().addScaledVector(r.n, 0.026 * sc);
    gear(rivet(0.006 * sc, 4), { bone: 'hips', color: LURTZ_PAL.ironLt, mat: IRON, matrix: placeAlong(p, r.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
}

/** raised binding bands over the boots (sheet: layered cloth/leather wraps from the ankle to
 *  ≈ 0.44 m on a 2.1 m figure; the calf is bare above and below the kilt hem) */
export function lurtzBootWraps(ctx: KindContext, parts: ReturnType<typeof anatomyParts>) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const bootTop = P.ankleH + (P.j.shin_l[1] - P.ankleH) * LURTZ_BOOT_LENGTH; // the 'boots' outfit layer (length 0.7)
  const n = 5;
  const y0 = P.ankleH + 0.025 * sc;
  const step = (bootTop - 0.02 * sc - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = y0 + i * step;
    const b = a + step * 0.62;
    s.group('union', 0.0015 * sc, () => {
      emitParts(s, parts, ['shin', 'calf'], { color: i % 2 ? LURTZ_PAL.wrap2 : LURTZ_PAL.wrap, mat: surface('rags', { rough: 0.9 }), inflate: 0.021 * sc, k: 0.012 * sc, noise: { amp: 0.0015 * sc, freq: 60 / sc, type: 'ridged' } });
      s.plane([0, 1, 0], b, { op: 'intersect', k: 0.002 * sc });
      s.plane([0, -1, 0], -a, { op: 'intersect', k: 0.002 * sc });
      s.plane([0, 1, 0], b, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([0, -1, 0], -a, { op: 'paint', seam: 0, k: 0.002 });
    });
  }
}

/** boot height as a fraction of knee-above-ankle: shared by the outfit layer and the wrap bands */
export const LURTZ_BOOT_LENGTH = 0.7;

/** the kilt as the outfit layer builds it (see lurtz.ts) */
export const LURTZ_KILT = { length: 0.8, thickness: 0.03 };

/** three or four staggered leather straps hanging from the belt over the front of the kilt (sheet) */
export function lurtzBeltHangers(ctx: KindContext, gear: GearFn) {
  const sc = ctx.P.s;
  const env = kiltEnvelope(ctx, LURTZ_KILT.length, LURTZ_KILT.thickness);
  const base = { color: LURTZ_PAL.flap, mat: surface('rags', { rough: 0.92 }), rivets: 0 };
  for (const [a, w, l] of [[-0.55, 0.09, 0.2], [-0.2, 0.09, 0.36], [0.17, 0.09, 0.27], [0.52, 0.09, 0.16]] as [number, number, number][]) {
    kiltPanel(ctx, env, gear, { ...base, a0: a - w, a1: a + w, len: (u) => (l - 0.05 * Math.abs(2 * u - 1)) * sc, out: 0.016 * sc, thick: 0.007 * sc });
  }
}

/** a long, tapered dark sole under each boot (≈ 25 % longer than the outfit's own, thinner and
 *  centred 6 mm lower so the two never share a surface) */
export function lurtzSoles(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  s.mirrored(() => {
    const f = j.foot_l;
    const toe = j.toe_l;
    s.ellipsoid([f[0] + 0.004 * sc, 0.007 * sc, (f[2] + toe[2]) / 2 + 0.05 * sc], [0.05 * sc * P.build.footSize, 0.0075 * sc, P.footLen * 0.7], { color: 0x1c1712, mat: LEATHER_DK, bone: 'foot_l', bone2: 'toe_l', blendAxis: [[0, 0, f[2]], [0, 0, toe[2] + 0.02 * sc]], blend: [0.5, 0.8], k: 0.004 * sc });
  });
}

/** two small uneven ivory fangs standing up over the lower lip (sheet face views) */
export function lurtzFangs(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const u = P.headH;
  for (const [sx, len, r] of [[1, 0.17, 0.027], [-1, 0.12, 0.022]] as [number, number, number][]) {
    const base = V(...P.h(0.07 * sx, -0.425, 0.385));
    const dir = V(0.02 * sx, 1, 0.25).normalize();
    gear(spike(r * u, len * u, 5, 0.01), { bone: 'jaw', color: 0xd0b878, mat: surface('bone', { rough: 0.45 }), matrix: placeAlong(base, dir, V(0, 0, 1)), small: true });
  }
}

/** chunky black locks (sheet: a big loose mane that frames the face, covers the neck and falls past the
 *  shoulders): three per side from ear height to the chest, and five behind the neck down the back */
export function lurtzHairLocks(ctx: KindContext, gear: GearFn) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const mat = surface('rags', { rough: 0.7, sheen: 0.45 });
  const lock = (pts: THREE.Vector3[], nrm: THREE.Vector3, w0: number, w1: number, bone: string) => {
    gear(ribbon(pts, pts.map(() => nrm.clone()), (t) => w0 + (w1 - w0) * t, 0.007 * sc, 1, { outerOnly: true, noInner: true }, 14), { bone, color: LURTZ_PAL.hair, mat, small: true });
  };
  const chestY = j.chest[1];
  for (const sx of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const q = (x: number, y: number, z: number) => V(...P.h(sx * x, y, z));
      const pts = [
        q(0.3 + 0.02 * k, 0.14 - 0.05 * k, -0.04 - 0.05 * k),
        q(0.36 + 0.02 * k, -0.18, -0.1 - 0.05 * k),
        V(sx * (0.15 + 0.03 * k) * sc, j.neck[1] - 0.1 * sc, (0.01 - 0.03 * k) * sc),
        V(sx * (0.19 + 0.03 * k) * sc, chestY - 0.02 * sc - 0.05 * k * sc, (0.05 - 0.02 * k) * sc),
      ];
      lock(pts, V(sx * 0.6, 0, 0.8).normalize(), 0.06 * sc, 0.03 * sc, 'head');
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.05 * sc;
    const pts = [
      V(...P.h((i - 2) * 0.12, -0.38, -0.42)),
      V(x, j.neck[1] - 0.01 * sc, -0.085 * sc),
      V(x * 1.15, chestY - 0.1 * sc, -0.14 * sc),
      V(x * 1.3, chestY - 0.3 * sc, -0.15 * sc),
    ];
    lock(pts, V(0, 0, -1), 0.065 * sc, 0.035 * sc, 'chest');
  }
}
