/**
 * War troll hardware (docs/refs/war_troll): the pointed helm with a ridge and nose guard, a riveted
 * breast and back plate with crossed straps and rings, a double belt with a ring buckle and a hanging tab,
 * spiked riveted vambraces, strapped iron greaves over wrapped feet, and the oversized warhammer head.
 * Every plate is cast onto the finished sculpt (`Projector`) so it follows the troll's bulk.
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import {
  V, placeAlong, spike, shellPatch, ellipsoidFn, ribbon, lerp, smooth, rivet, hexBolt, type GearFn, type Projector,
} from './common';
import { TROLL_PAL, IRON, IRON_RUSTY, IRON_DARK, STRAP, WRAP, HIDE, LEATHER } from './troll_pal';
import { Rng } from '../../../../core/rng';

// ─────────────────────────────────────────────────────────────────────────────
// casting onto the body
// ─────────────────────────────────────────────────────────────────────────────

const _n = V();

/**
 * the body surface at azimuth `a` (0 = front, + toward +X) and height y around the axis through (cx, cz): marched
 * from the axis OUTWARD to the first exit, so an arm or weapon beside the torso never gets hit instead of the torso.
 */
export function ringCast(proj: Projector, a: number, y: number, cx = 0, cz = 0, R = 1.7): { p: THREE.Vector3; n: THREE.Vector3 } | null {
  const dx = Math.sin(a), dz = Math.cos(a);
  const step = 0.025;
  if (proj.dist(cx, y, cz) > 0) return null;
  let t = step;
  for (; t < R; t += step) if (proj.dist(cx + dx * t, y, cz + dz * t) > 0) break;
  if (t >= R) return null;
  let lo = t - step, hi = t;
  for (let i = 0; i < 12; i++) {
    const m = (lo + hi) / 2;
    if (proj.dist(cx + dx * m, y, cz + dz * m) > 0) hi = m;
    else lo = m;
  }
  const p = V(cx + dx * lo, y, cz + dz * lo);
  if (!proj.project(p, _n, 3)) return null;
  return { p, n: _n.clone() };
}

interface Grid {
  P: THREE.Vector3[][];
  N: THREE.Vector3[][];
  na: number;
  ny: number;
}

/** a grid of surface points: columns by azimuth a0..a1, rows by height y1 (top) .. y0 (bottom); failed casts are filled from the row's neighbours */
export function surfaceGrid(proj: Projector, a0: number, a1: number, y1: number, y0: number, na: number, ny: number, lift: number, cx = 0, cz = 0): Grid {
  const P: THREE.Vector3[][] = [];
  const N: THREE.Vector3[][] = [];
  for (let j = 0; j <= ny; j++) {
    const y = lerp(y1, y0, j / ny);
    const row: (THREE.Vector3 | null)[] = [];
    const nrm: (THREE.Vector3 | null)[] = [];
    for (let i = 0; i <= na; i++) {
      const a = lerp(a0, a1, i / na);
      const q = ringCast(proj, a, y, cx, cz);
      row.push(q ? q.p.addScaledVector(q.n, lift) : null);
      nrm.push(q ? q.n : null);
    }
    // fill gaps
    for (let i = 0; i <= na; i++) {
      if (row[i]) continue;
      let l = i - 1, r = i + 1;
      while (l >= 0 && !row[l]) l--;
      while (r <= na && !row[r]) r++;
      const src = (l >= 0 ? l : r <= na ? r : -1);
      if (src < 0) {
        row[i] = V(Math.sin(lerp(a0, a1, i / na)) * 0.5, y, Math.cos(lerp(a0, a1, i / na)) * 0.4);
        nrm[i] = V(Math.sin(lerp(a0, a1, i / na)), 0, Math.cos(lerp(a0, a1, i / na)));
      } else {
        row[i] = row[src]!.clone();
        nrm[i] = nrm[src]!.clone();
      }
    }
    P.push(row as THREE.Vector3[]);
    N.push(nrm as THREE.Vector3[]);
  }
  return { P, N, na, ny };
}

function gridSurf(g: Grid) {
  return (u: number, v: number, o: { p: THREE.Vector3; n: THREE.Vector3 }) => {
    const fi = Math.min(g.na - 1e-6, u * g.na);
    const fj = Math.min(g.ny - 1e-6, v * g.ny);
    const i = Math.floor(fi), j = Math.floor(fj);
    const tu = fi - i, tv = fj - j;
    const lerp4 = (A: THREE.Vector3[][], out: THREE.Vector3) => {
      out.copy(A[j][i]).multiplyScalar((1 - tu) * (1 - tv));
      out.addScaledVector(A[j][i + 1], tu * (1 - tv));
      out.addScaledVector(A[j + 1][i], (1 - tu) * tv);
      out.addScaledVector(A[j + 1][i + 1], tu * tv);
    };
    lerp4(g.P, o.p);
    lerp4(g.N, o.n);
    o.n.normalize();
  };
}

/** a smooth plate over a surface grid */
export function gridPlate(g: Grid, thick: number, opt: Parameters<typeof shellPatch>[4] = {}): THREE.BufferGeometry {
  return shellPatch(gridSurf(g), g.na, g.ny, thick, { noInner: true, outerOnly: true, ...opt });
}

/** a ribbon through a row (or any path) of a grid, lifted by `lift` along the normals */
function ribbonThrough(pts: THREE.Vector3[], nrm: THREE.Vector3[], lift: number, width: number, thick: number): THREE.BufferGeometry {
  const p = pts.map((q, i) => q.clone().addScaledVector(nrm[i], lift));
  return ribbon(p, nrm, width, thick, 1, { outerOnly: true, noInner: true }, Math.max(4, p.length - 1));
}

/** closed band around the torso at height y following the real surface (belts, straps) */
export function loopBand(proj: Projector, y: number, width: number, thick: number, lift: number, bone: string, gear: GearFn, color: number, mat = STRAP, cx = 0, cz = 0, N = 28) {
  const pts: THREE.Vector3[] = [], nr: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const q = ringCast(proj, (i / N) * Math.PI * 2, y, cx, cz);
    if (!q) return null;
    pts.push(q.p.addScaledVector(q.n, lift));
    nr.push(q.n);
  }
  // seam closure: the last point equals the first one
  pts[N].copy(pts[0]);
  nr[N].copy(nr[0]);
  gear(ribbon(pts, nr, width, thick, 1, { outerOnly: true, noInner: true }, N), { bone, color, mat, ao: 0.85 });
  return { pts, nr };
}

// ─────────────────────────────────────────────────────────────────────────────
// helm
// ─────────────────────────────────────────────────────────────────────────────

export function warHelm(ctx: KindContext, gear: GearFn, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const u = P.headH;
  const H = (x: number, y: number, z: number) => new THREE.Vector3(...P.h(x, y, z));
  // pointed helm with a face opening and a spiked crown (sheet: tall pointed skull with a ridge and a nose guard)
  const C = H(0, 0.05, -0.05);
  const R: [number, number, number] = [0.42 * u, 0.66 * u, 0.5 * u];
  const rimY = (a: number) => lerp(0.04, -0.3, smooth(1.6, 2.9, Math.abs(a))) - 0.03 * smooth(0.9, 1.5, Math.abs(a));
  const elOf = (a: number) => Math.asin(Math.max(-0.97, Math.min(0.97, (rimY(a) - 0.05) / (R[1] / u))));
  const dome = shellPatch(ellipsoidFn(C, R, [-Math.PI, Math.PI], [elOf, Math.PI / 2 - 1e-3], { radial: (_a, e) => (e < 0 ? 1 / Math.pow(Math.max(0.6, Math.cos(e)), 0.8) : 1 + 0.2 * Math.pow(Math.sin(e), 5)) }), 28, 8, 0.016 * sc, { closedU: true, noInner: true, skip: ['v1'], thickFn: (_u, v) => 1 + 0.9 * (1 - smooth(0, 0.12, v)) });
  gear(dome, { bone: 'head', color: TROLL_PAL.iron, mat: IRON, ao: 0.9 });
  // central point
  gear(spike(0.05 * u, 0.42 * u, 6), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(C.clone().add(V(0, R[1] * 1.06, 0)), V(0, 1, -0.1), V(0, 0, 1)) });
  // raised ridge front to back over the crown (helm detail tile), with studs
  const ridge: THREE.Vector3[] = [], rn: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const e = lerp(-0.3, Math.PI - 0.3, i / 12);
    const d = V(0, Math.sin(e), Math.cos(e));
    const k = 1 + 0.2 * Math.pow(Math.max(0, Math.sin(e)), 5);
    ridge.push(V(0, d.y * R[1] * k, d.z * R[2] * k).add(C));
    rn.push(V(0, d.y / R[1], d.z / R[2]).normalize());
  }
  gear(ribbonThrough(ridge, rn, 0.004 * sc, 0.03 * sc, 0.012 * sc), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, ao: 0.9 });
  // brow ridge ring of studs + side spikes
  for (let i = 0; i < 9; i++) {
    const a = lerp(-2.4, 2.4, i / 8);
    const e = elOf(a) + 0.15;
    const d = V(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    const p = V(d.x * R[0], d.y * R[1], d.z * R[2]).add(C);
    const nn = V(d.x / R[0], d.y / R[1], d.z / R[2]).normalize();
    gear(spike(0.03 * u, (bucket === 3 ? 0.2 : 0.1) * u, 5), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(p, nn, V(0, 0, 1)), small: true });
  }
  // nose guard
  const pts = [H(0, 0.04, 0.5), H(0, -0.1, 0.57), H(0, -0.28, 0.6)];
  gear(ribbon(pts, [V(0, 0.2, 1).normalize(), V(0, 0, 1), V(0, -0.2, 1).normalize()], 0.07 * u, 0.02 * sc, 1, { outerOnly: true }), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, small: true });
  // long cheek plates hanging in front of the ears down to the jaw (face sheet: the helm's most readable detail)
  for (const side of [1, -1]) {
    const cheek = shellPatch(
      (uu, vv, o) => {
        const y = lerp(0.02, -0.5, vv);
        const x = side * (0.375 - 0.12 * uu * uu - 0.07 * vv);
        const z = lerp(0.0, 0.3, uu) + 0.03 * vv;
        o.p.copy(H(x, y, z));
        o.n.set(side, 0, 0.9 * uu).normalize();
      },
      6,
      8,
      0.012 * sc,
      { outerOnly: true, noInner: false, thickFn: (_u, v) => 1 + 0.5 * (1 - smooth(0, 0.1, v)) },
    );
    gear(cheek, { bone: 'head', color: TROLL_PAL.iron, mat: IRON_RUSTY, ao: 0.85 });
    for (let k = 0; k < 4; k++) {
      const q = H(side * 0.33, -0.05 - k * 0.12, 0.17);
      gear(rivet(0.009 * sc, 5), { bone: 'head', color: 0x6a5a4a, mat: IRON, matrix: placeAlong(q, V(side, 0, 0.3), V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
    }
  }
}

/** the war troll's long dark mane from under the helm down over the neck and shoulders (face sheet, back view) */
export function warMane(ctx: KindContext, gear: GearFn, proj: Projector, bucket: number) {
  const { P } = ctx;
  const sc = P.s;
  const u = P.headH;
  const rng = new Rng(9100 + bucket);
  const p = V(), n = V();
  const H = (x: number, y: number, z: number) => V(...P.h(x, y, z));
  for (let i = 0; i < 64; i++) {
    // rooted around the back and sides of the skull below the helm rim, cast onto the real surface
    const a = rng.range(1.5, 4.8);
    const y = rng.range(-0.28, -0.02);
    const o = H(Math.sin(a) * 0.9, y, Math.cos(a) * 0.9 - 0.05);
    const d = H(0, y, -0.05).sub(o).normalize();
    if (!proj.cast(o, d, 1.2 * u, p, n)) continue;
    const len = rng.range(0.14, 0.32) * sc;
    const dir = V(n.x * 0.25, -1, n.z * 0.25 - 0.08).normalize();
    gear(spike(0.0075 * sc, len, 3), { bone: 'head', color: rng.float() < 0.4 ? TROLL_PAL.mane : 0x1e1a16, mat: HIDE, matrix: placeAlong(p.clone().addScaledVector(n, -0.004 * sc), dir, V(0, 0, 1)), small: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// torso plate, straps, belts
// ─────────────────────────────────────────────────────────────────────────────

export function warHarness(ctx: KindContext, gear: GearFn, proj: Projector, beltY: number) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const yTop = j.neck[1] - 0.05 * sc;
  const yBot = beltY + 0.045 * sc;
  const lift = 0.016 * sc;
  const th = 0.014 * sc;
  const bone = (y: number) => (y > j.chest[1] - 0.08 * sc ? 'chest' : 'spine');

  const plate = (a0: number, a1: number, na: number, back: boolean) => {
    const g = surfaceGrid(proj, a0, a1, yTop, yBot, na, 8, lift);
    gear(gridPlate(g, th), { bone: 'chest', color: TROLL_PAL.plate, mat: IRON, ao: 0.85 });
    // horizontal lames: raised bands through the lower rows
    for (const jr of [4, 6]) {
      gear(ribbonThrough(g.P[jr], g.N[jr], th, 0.036 * sc, 0.01 * sc), { bone: bone(g.P[jr][0].y), color: TROLL_PAL.plate, mat: IRON, small: true });
    }
    // centre ridge
    const col = Math.round(na / 2);
    const cp = g.P.map((r) => r[col]);
    const cn = g.N.map((r) => r[col]);
    gear(ribbonThrough(cp, cn, th, 0.026 * sc, 0.012 * sc), { bone: 'chest', color: TROLL_PAL.iron, mat: IRON, small: true });
    // rivets along both side edges and the top
    for (let jr = 1; jr < 8; jr += 3) {
      for (const ci of [1, na - 1]) {
        gear(rivet(0.0085 * sc, 5), { bone: bone(g.P[jr][ci].y), color: 0x6a5a4a, mat: IRON, matrix: placeAlong(g.P[jr][ci].clone().addScaledVector(g.N[jr][ci], th), g.N[jr][ci], V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
    }
    return g;
  };
  const front = plate(-1.3, 1.3, 14, false);
  plate(Math.PI - 1.3, Math.PI + 1.3, 12, true);

  // crossed leather straps over the front plate (shoulder → opposite side of the waist)
  for (const sx of [1, -1]) {
    const pts: THREE.Vector3[] = [], nr: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = lerp(0.62 * sx, -0.7 * sx, t);
      const y = lerp(yTop - 0.02 * sc, yBot + 0.16 * sc, t);
      const q = ringCast(proj, a, y);
      if (!q) continue;
      pts.push(q.p.addScaledVector(q.n, lift + th));
      nr.push(q.n);
    }
    if (pts.length > 3) gear(ribbon(pts, nr, 0.045 * sc, 0.014 * sc, 1, { outerOnly: true, noInner: true }, pts.length - 1), { bone: 'chest', color: TROLL_PAL.leather, mat: STRAP, small: true });
  }
  // rings where the straps meet the shoulder plates (sheet: two O-rings high on the chest)
  for (const sx of [1, -1]) {
    const q = ringCast(proj, 0.78 * sx, yTop + 0.01 * sc);
    if (q) gear(new THREE.TorusGeometry(0.036 * sc, 0.008 * sc, 5, 14), { bone: 'chest', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(q.p.addScaledVector(q.n, lift + th + 0.012 * sc), q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
  }
  // back: two straps down from the shoulders meeting at the waist
  for (const sx of [1, -1]) {
    const pts: THREE.Vector3[] = [], nr: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const q = ringCast(proj, Math.PI + lerp(0.7 * sx, 0.25 * sx, t), lerp(yTop, yBot + 0.1 * sc, t));
      if (!q) continue;
      pts.push(q.p.addScaledVector(q.n, lift + th));
      nr.push(q.n);
    }
    if (pts.length > 3) gear(ribbon(pts, nr, 0.045 * sc, 0.014 * sc, 1, { outerOnly: true, noInner: true }, pts.length - 1), { bone: 'chest', color: TROLL_PAL.leather, mat: STRAP, small: true });
  }
  return front;
}

/** broad leather belt following the real belly, with a cast ring buckle at the front (right of centre, as in both sheets) */
export function trollBelt(ctx: KindContext, gear: GearFn, proj: Projector, y: number, o: { width: number }) {
  const { P } = ctx;
  const sc = P.s;
  loopBand(proj, y, o.width * sc, 0.016 * sc, 0.022 * sc, 'spine', gear, TROLL_PAL.leather);
  // stitched edges: two thin darker straps along the belt's rims
  for (const d of [-1, 1]) loopBand(proj, y + d * o.width * sc * 0.4, 0.012 * sc, 0.008 * sc, 0.03 * sc, 'spine', gear, TROLL_PAL.leatherDark);
  const q = ringCast(proj, -0.1, y);
  if (q) {
    const at = q.p.addScaledVector(q.n, 0.04 * sc);
    const m = placeAlong(at, q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    gear(new THREE.TorusGeometry(0.07 * sc, 0.0145 * sc, 6, 18), { bone: 'spine', color: TROLL_PAL.buckle, mat: IRON, matrix: m, ao: 0.85 });
    gear(new THREE.BoxGeometry(0.1 * sc, 0.016 * sc, 0.016 * sc), { bone: 'spine', color: TROLL_PAL.buckle, mat: IRON, matrix: m, small: true });
  }
}

/** war troll: a second belt strap above the main belt, the hanging tab (sheet: double belt, strap down the kilt) and a
 *  leather apron between the belt and the kilt's top edge (the kilt hangs from the belt in the sheet) */
export function warBelts(ctx: KindContext, gear: GearFn, proj: Projector, beltY: number) {
  const { P } = ctx;
  const sc = P.s;
  loopBand(proj, beltY + 0.085 * sc, 0.03 * sc, 0.012 * sc, 0.027 * sc, 'spine', gear, TROLL_PAL.leatherDark);
  const topY = P.j.thigh_l[1] + 0.06 * sc;
  const hBand = beltY - 0.05 * sc - topY;
  if (hBand > 0.02) loopBand(proj, topY + hBand / 2, hBand, 0.016 * sc, 0.06 * sc, 'spine', gear, TROLL_PAL.kiltLeather, LEATHER);
  // hanging tab on the left hip (sheet: a strap with a buckle down the front of the kilt)
  const t = ringCast(proj, 0.62, beltY);
  if (t) {
    const top = t.p.clone().addScaledVector(t.n, 0.05 * sc);
    const down = V(t.n.x * 0.25, -1, t.n.z * 0.1).normalize();
    const len = 0.62 * sc;
    const pts = [top, top.clone().addScaledVector(down, len * 0.5), top.clone().addScaledVector(down, len)];
    const nr = [t.n.clone(), t.n.clone(), t.n.clone()];
    gear(ribbon(pts, nr, 0.05 * sc, 0.014 * sc, 1, { outerOnly: true, noInner: true }, 8), { bone: 'spine', color: TROLL_PAL.leather, mat: STRAP, small: true });
    gear(new THREE.TorusGeometry(0.02 * sc, 0.006 * sc, 5, 10), { bone: 'spine', color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(pts[1].clone().addScaledVector(t.n, 0.016 * sc), t.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// limbs
// ─────────────────────────────────────────────────────────────────────────────

/** feet and ankles wrapped in dark cloth up to where the greaves start (sculpted so the wraps follow the huge feet) */
export function warFootWraps(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const parts = anatomyParts(P);
  const top = greaveBottom(ctx) + 0.03 * sc;
  s.group('union', 0.006 * sc, () => {
    emitParts(s, parts, ['foot', 'toes'], { color: TROLL_PAL.wrap, mat: WRAP, inflate: 0.03 * sc, k: 0.03 * sc, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' } });
    emitParts(s, parts, ['shin', 'calf'], { color: TROLL_PAL.wrap, mat: WRAP, inflate: 0.03 * sc, k: 0.03 * sc, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' } });
    s.mirrored(() => {
      const f = j.foot_l;
      const t = j.toe_l;
      const wrap = { color: TROLL_PAL.wrap, mat: WRAP, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' as const } };
      s.cone([f[0], f[1] + 0.02 * sc, f[2]], [t[0], t[1] + 0.03 * sc, t[2] + 0.07 * sc], 0.072 * sc + 0.03 * sc, 0.058 * sc + 0.03 * sc, { ...wrap, bone: 'foot_l', bone2: 'toe_l', blend: [0.55, 0.95], k: 0.04 * sc });
      s.ellipsoid([j.shin_l[0], j.shin_l[1] - 0.12 * sc, j.shin_l[2] - 0.04 * sc], [0.095 * sc * P.build.bulk + 0.03 * sc, 0.13 * sc, 0.1 * sc * P.build.bulk + 0.03 * sc], { ...wrap, bone: 'shin_l', k: 0.07 * sc });
    });
    s.plane([0, 1, 0], top, { op: 'intersect', k: 0.012 * sc });
    s.plane([0, 1, 0], top, { op: 'paint', seam: 0, k: 0.002 });
  });
}

export function greaveBottom(ctx: KindContext): number {
  const { P } = ctx;
  return P.ankleH + 0.16 * P.s;
}

export function warGreaves(ctx: KindContext, gear: GearFn, proj: Projector) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const y0 = greaveBottom(ctx) + 0.02 * sc;
  // from just under the wraps to well up under the kilt hem (sheet: greaves reach about the knee)
  const y1 = j.shin_l[1] + 0.2 * sc;
  for (const sd of ['l', 'r'] as const) {
    const f = V(...j[`foot_${sd}`]);
    const kn = V(...j[`shin_${sd}`]);
    const axisAt = (y: number) => {
      const t = (y - f.y) / (kn.y - f.y);
      return [f.x + (kn.x - f.x) * t, f.z + (kn.z - f.z) * t] as const;
    };
    const lift = 0.016 * sc;
    const nrows = 6;
    // gather a grid whose centre line follows the shin axis row by row
    const P2: THREE.Vector3[][] = [], N2: THREE.Vector3[][] = [];
    const na = 14;
    for (let r = 0; r <= nrows; r++) {
      const y = lerp(y1, y0, r / nrows);
      const [cx, cz] = axisAt(Math.min(y, kn.y));
      const row: THREE.Vector3[] = [], nr: THREE.Vector3[] = [];
      for (let i = 0; i <= na; i++) {
        const q = ringCast(proj, (i / na) * Math.PI * 2, y, cx, cz, 0.9);
        if (q) {
          row.push(q.p.addScaledVector(q.n, lift));
          nr.push(q.n);
        } else {
          row.push(row.length ? row[row.length - 1].clone() : V(cx, y, cz));
          nr.push(nr.length ? nr[nr.length - 1].clone() : V(0, 0, 1));
        }
      }
      row[na].copy(row[0]);
      nr[na].copy(nr[0]);
      P2.push(row);
      N2.push(nr);
    }
    const g: Grid = { P: P2, N: N2, na, ny: nrows };
    const bone = `shin_${sd}`;
    gear(gridPlate(g, 0.014 * sc, { closedU: true, thickFn: (_u, v) => 1 + 0.6 * (1 - smooth(0, 0.1, v)) }), { bone, color: TROLL_PAL.ironDark, mat: IRON_DARK, ao: 0.85 });
    // two leather straps round the greave with iron buckles on the outside
    for (const rr of [2, 5]) {
      gear(ribbonThrough(P2[rr], N2[rr], 0.014 * sc, 0.034 * sc, 0.01 * sc), { bone, color: TROLL_PAL.leather, mat: STRAP, small: true });
      const ob = Math.round(na * (sd === 'l' ? 0.75 : 0.25));
      gear(hexBolt(0.018 * sc, 0.016 * sc), { bone, color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(P2[rr][ob].clone().addScaledVector(N2[rr][ob], 0.024 * sc), N2[rr][ob], V(0, 1, 0)), small: true });
    }
    // spikes up the outer side and a row of rivets along the front splint
    for (let k = 0; k < 4; k++) {
      const rr = 1 + k * 2 - (k === 3 ? 1 : 0);
      const ci = Math.round(na * (sd === 'l' ? 0.78 : 0.22));
      const p = P2[rr][ci].clone().addScaledVector(N2[rr][ci], 0.012 * sc);
      gear(spike(0.02 * sc, (k === 3 ? 0.13 : 0.1) * sc, 5), { bone, color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(p, N2[rr][ci], V(0, 0, 1)), small: true });
    }
    const ci = 0;
    for (let rr = 1; rr < nrows; rr++) gear(rivet(0.009 * sc, 5), { bone, color: 0x6a5a4a, mat: IRON, matrix: placeAlong(P2[rr][ci].clone().addScaledVector(N2[rr][ci], 0.014 * sc), N2[rr][ci], V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
  }
}

/** riveted iron vambrace on the forearm, elbow to wrist, with spikes along the outside (sheet: both arms) */
export function warBracers(ctx: KindContext, gear: GearFn, proj: Projector) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  for (const sd of ['l', 'r'] as const) {
    const sx = sd === 'l' ? 1 : -1;
    const el = V(...j[`forearm_${sd}`]);
    const wr = V(...j[`hand_${sd}`]);
    const axis = wr.clone().sub(el);
    const len = axis.length();
    axis.normalize();
    const lift = 0.014 * sc;
    const na = 14, nr = 5;
    const [u, w] = [V(sx, 0, 0).sub(axis.clone().multiplyScalar(axis.x * sx)).normalize(), V(0, 0, 1)];
    const Pg: THREE.Vector3[][] = [], Ng: THREE.Vector3[][] = [];
    const p = V(), n = V();
    const t0 = 0.08, t1 = 0.92;
    for (let r = 0; r <= nr; r++) {
      const c = el.clone().addScaledVector(axis, len * lerp(t0, t1, r / nr));
      const row: THREE.Vector3[] = [], nrm: THREE.Vector3[] = [];
      for (let i = 0; i <= na; i++) {
        const th = (i / na) * Math.PI * 2;
        const dir = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(w, Math.sin(th));
        const o = c.clone().addScaledVector(dir, 0.8);
        if (proj.cast(o, dir.clone().negate(), 0.85, p, n)) {
          row.push(p.clone().addScaledVector(n, lift));
          nrm.push(n.clone());
        } else {
          row.push(row.length ? row[row.length - 1].clone() : c.clone());
          nrm.push(nrm.length ? nrm[nrm.length - 1].clone() : dir.clone());
        }
      }
      row[na].copy(row[0]);
      nrm[na].copy(nrm[0]);
      Pg.push(row);
      Ng.push(nrm);
    }
    const g: Grid = { P: Pg, N: Ng, na, ny: nr };
    const bone = `forearm_${sd}`;
    gear(gridPlate(g, 0.016 * sc, { closedU: true, thickFn: (_u, v) => 1 + 0.8 * (1 - smooth(0, 0.08, Math.min(v, 1 - v))) }), { bone, color: TROLL_PAL.bracer, mat: IRON_RUSTY, ao: 0.85 });
    // iron rings at both ends and the middle, rivet rows
    for (const rr of [0, 3, nr]) gear(ribbonThrough(Pg[rr], Ng[rr], 0.016 * sc, 0.03 * sc, 0.012 * sc), { bone, color: TROLL_PAL.iron, mat: IRON, small: true });
    // spikes along the outer side (away from the body) in two rows
    const outI = 0; // the cast direction `u` points outward along +x for the left forearm
    for (let r = 1; r < nr; r++) {
      for (const ci of [outI, 2, na - 2]) {
        const pp = Pg[r][ci].clone().addScaledVector(Ng[r][ci], 0.014 * sc);
        gear(spike(0.017 * sc, ci === outI ? 0.11 * sc : 0.07 * sc, 5), { bone, color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(pp, Ng[r][ci], V(0, 0, 1)), small: true });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// the hammer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The shared warhammer prop is a small box on a haft; at troll size the sheet's block head (about 0.75 x 0.45 x
 * 0.45 m, spiked, banded) needs a bigger head. A marker in the hand socket finds the held `warhammer` object the
 * first time it updates, scales the haft (`S`, haft thicker and shorter) and hangs the big head on it, in
 * unscaled weapon units (the prop's own small head is inside the block).
 */
export function bigHammerHead(ctx: KindContext, hand: 'hand_r' | 'hand_l', size: [number, number, number], S: [number, number, number]) {
  ctx.object(
    () => {
      const g = new THREE.Group();
      g.name = 'hammer_head_marker';
      g.updateMatrixWorld = function (force?: boolean) {
        const par = this.parent;
        if (par) {
          for (const c of par.children) {
            if (c !== this && c.userData.kind === 'warhammer' && !c.userData.bigHead) {
              c.userData.bigHead = true;
              c.scale.set(c.scale.x * S[0], c.scale.y * S[1], c.scale.z * S[2]);
              const h = makeHammerHead(size);
              h.position.set(0.045, 0.8, 0);
              h.scale.set(1 / S[0], 1 / S[1], 1 / S[2]);
              c.add(h);
            }
          }
        }
        THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
      };
      return g;
    },
    { socket: hand },
  );
}

function makeHammerHead(size: [number, number, number]): THREE.Object3D {
  const [sx, sy, sz] = size;
  const grp = new THREE.Group();
  grp.name = 'war_hammer_head';
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.55, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.7, metalness: 0.7 });
  const spk = new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 0.5, metalness: 0.9 });
  grp.add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), iron));
  // two iron collars near the ends and the haft's binding below the head
  for (const s of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.08, sy * 1.08, sz * 1.08), dark);
    band.position.x = s * sx * 0.3;
    grp.add(band);
  }
  const bind = new THREE.Mesh(new THREE.CylinderGeometry(sy * 0.2, sy * 0.2, sy * 0.2, 8), dark);
  bind.position.y = -sy * 0.5;
  grp.add(bind);
  // studs: a spike on every face (two on the long sides), the end faces carry one big one
  const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 4);
  const add = (geo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number]) => {
    const m = new THREE.Mesh(geo, spk);
    m.position.set(...pos);
    m.rotation.set(...rot);
    grp.add(m);
  };
  const h = sy * 0.3;
  for (const o of [-0.2, 0.2]) {
    add(cone(sy * 0.1, h), [o * sx, 0, sz / 2 + h / 2], [Math.PI / 2, 0, 0]);
    add(cone(sy * 0.1, h), [o * sx, 0, -sz / 2 - h / 2], [-Math.PI / 2, 0, 0]);
    add(cone(sy * 0.1, h), [o * sx, sy / 2 + h / 2, 0], [0, 0, 0]);
    add(cone(sy * 0.1, h), [o * sx, -sy / 2 - h / 2, 0], [Math.PI, 0, 0]);
  }
  add(cone(sy * 0.14, h * 1.2), [sx / 2 + h * 0.6, 0, 0], [0, 0, -Math.PI / 2]);
  add(cone(sy * 0.14, h * 1.2), [-sx / 2 - h * 0.6, 0, 0], [0, 0, Math.PI / 2]);
  return grp;
}
