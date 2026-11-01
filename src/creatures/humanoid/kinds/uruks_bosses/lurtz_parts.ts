/**
 * Lurtz's sculpted hardware (docs/refs/lurtz): dark segmented leather bracers, a wide two-tier
 * belt with an iron ring and hanging tie straps, and wrapped boots with cross-binding. Kept apart
 * from lurtz.ts so the kind file stays readable; self-contained (no dependence on uruk.ts values).
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { surface } from '../../../kit/surfaces';
import { V, placeAlong, rivet, ringSnap, type GearFn, type Projector } from './common';

export const LURTZ_PAL = {
  // sheet design skin #55432f, lit torso #7f645b: albedo kept darker and redder than the hex because
  // the lab and AgX lift browns toward clay
  skin: 0x4e3a31, // measured against the sheet's chest (111,90,85): 0x5a3a2c rendered lighter and more orange
  skin2: 0x33261f,
  lips: 0x2e211c,
  brows: 0x14100d,
  scatter: 0x5e3328,
  hair: 0x1b1714, // details hair sample #1b1714 (lit), design #24211b: near-black at root and tip
  eyes: 0xb88c39, // design iris #b88c39
  kilt: 0x2a2522, // design #302a25 (lit #463e3a): charcoal, brown only on the central flap
  kilt2: 0x3b3029, // hem grime
  belt: 0x30231a, // design #4d3a2b (lit #463933)
  beltDark: 0x20160f,
  leather: 0x2e2622, // bracers: near-black leather, sheet reads #3a312e lit
  leatherDark: 0x1d1713,
  wrap: 0x3a3027, // foot wraps design #40352b (lit #40362f)
  wrap2: 0x28201a,
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
  const bootTop = P.ankleH + (P.j.shin_l[1] - P.ankleH) * 0.7; // the 'boots' outfit layer (length 0.7)
  const n = 5;
  const y0 = P.ankleH + 0.025 * sc;
  const step = (bootTop - 0.02 * sc - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = y0 + i * step;
    const b = a + step * 0.62;
    s.group('union', 0.0015 * sc, () => {
      emitParts(s, parts, ['shin', 'calf'], { color: i % 2 ? LURTZ_PAL.wrap2 : LURTZ_PAL.wrap, mat: surface('rags', { rough: 0.9 }), inflate: 0.0145 * sc, k: 0.012 * sc, noise: { amp: 0.0015 * sc, freq: 60 / sc, type: 'ridged' } });
      s.plane([0, 1, 0], b, { op: 'intersect', k: 0.002 * sc });
      s.plane([0, -1, 0], -a, { op: 'intersect', k: 0.002 * sc });
      s.plane([0, 1, 0], b, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([0, -1, 0], -a, { op: 'paint', seam: 0, k: 0.002 });
    });
  }
}
