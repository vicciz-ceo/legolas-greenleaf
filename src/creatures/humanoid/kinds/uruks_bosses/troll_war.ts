/**
 * War troll hardware (docs/refs/war_troll): the pointed helm with a ridge, cheek plates and a nose guard, a riveted
 * breast and back plate with crossed straps and rings, a hanging belt tab, spiked riveted vambraces, tall strapped
 * iron greaves over wrapped feet. All metal is one mid-grey gunmetal family with rust patches and bright worn edges.
 * Every plate is cast onto the finished sculpt (`Projector`) so it follows the troll's bulk.
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import {
  V, placeAlong, spike, shellPatch, ellipsoidFn, ribbon, lerp, smooth, rivet, hexBolt, type GearFn, type Projector,
} from './common';
import { TROLL_PAL, IRON, IRON_RUSTY, IRON_DARK, STRAP, WRAP, HIDE, LEATHER } from './troll_pal';
import { ringCast, surfaceGrid, gridPlate, ribbonThrough, loopBand, type Grid } from './troll_fit';
import { Rng } from '../../../../core/rng';

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
  const rimY = (a: number) => lerp(0.14, -0.3, smooth(1.6, 2.9, Math.abs(a))) - 0.03 * smooth(0.9, 1.5, Math.abs(a));
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
  const pts = [H(0, 0.12, 0.5), H(0, 0.0, 0.56), H(0, -0.16, 0.58)];
  gear(ribbon(pts, [V(0, 0.2, 1).normalize(), V(0, 0, 1), V(0, -0.2, 1).normalize()], 0.04 * u, 0.016 * sc, 1, { outerOnly: true }), { bone: 'head', color: TROLL_PAL.iron, mat: IRON, small: true });
  // long cheek plates hanging in front of the ears down to the jaw (face sheet: the helm's most readable detail)
  for (const side of [1, -1]) {
    const cheek = shellPatch(
      (uu, vv, o) => {
        const y = lerp(0.1, -0.5, vv);
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
    gear(cheek, { bone: 'head', color: TROLL_PAL.iron, mat: IRON, ao: 0.85 });
    for (let k = 0; k < 4; k++) {
      const q = H(side * 0.33, -0.05 - k * 0.12, 0.17);
      gear(rivet(0.009 * sc, 5), { bone: 'head', color: TROLL_PAL.rust, mat: IRON_RUSTY, matrix: placeAlong(q, V(side, 0, 0.3), V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
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
  for (let i = 0; i < 40; i++) {
    // rooted around the back and sides of the skull below the helm rim, cast onto the real surface
    const a = rng.range(1.1, 5.2);
    const y = rng.range(-0.28, -0.02);
    const o = H(Math.sin(a) * 0.9, y, Math.cos(a) * 0.9 - 0.05);
    const d = H(0, y, -0.05).sub(o).normalize();
    if (!proj.cast(o, d, 1.2 * u, p, n)) continue;
    const len = rng.range(0.16, 0.36) * sc;
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
  const yTop = j.neck[1] - 0.04 * sc;
  const yBot = beltY + 0.03 * sc;
  // stand well off the hide so the shell always reads, with the straps and rings above it
  const lift = 0.024 * sc;
  const th = 0.016 * sc;
  const bone = (y: number) => (y > j.chest[1] - 0.08 * sc ? 'chest' : 'spine');

  // one continuous shell (no stacked bands): a smooth plate with a centre ridge, rivets and bright worn edges
  const plate = (a0: number, a1: number, na: number) => {
    const g = surfaceGrid(proj, a0, a1, yTop, yBot, na, 10, lift);
    gear(gridPlate(g, th), { bone: 'chest', color: TROLL_PAL.plate, mat: IRON, ao: 0.85 });
    // centre ridge
    const col = Math.round(na / 2);
    const cp = g.P.map((r) => r[col]);
    const cn = g.N.map((r) => r[col]);
    gear(ribbonThrough(cp, cn, th, 0.028 * sc, 0.012 * sc), { bone: 'chest', color: TROLL_PAL.edge, mat: IRON, small: true });
    // bright worn rims along the top and the bottom, rust only as a streak below
    gear(ribbonThrough(g.P[0], g.N[0], th, 0.016 * sc, 0.008 * sc), { bone: 'chest', color: TROLL_PAL.edge, mat: IRON, small: true });
    gear(ribbonThrough(g.P[10], g.N[10], th, 0.02 * sc, 0.008 * sc), { bone: bone(g.P[10][0].y), color: TROLL_PAL.rust, mat: IRON_RUSTY, small: true });
    // rivets along both side edges
    for (let jr = 1; jr < 10; jr += 3) {
      for (const ci of [1, na - 1]) {
        gear(rivet(0.0085 * sc, 5), { bone: bone(g.P[jr][ci].y), color: TROLL_PAL.edge, mat: IRON, matrix: placeAlong(g.P[jr][ci].clone().addScaledVector(g.N[jr][ci], th), g.N[jr][ci], V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
      }
    }
  };
  plate(-1.3, 1.3, 14);
  plate(Math.PI - 1.3, Math.PI + 1.3, 12);

  // crossed leather straps over the front plate (shoulder to the opposite side of the waist)
  for (const sx of [1, -1]) {
    const pts: THREE.Vector3[] = [], nr: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = lerp(0.62 * sx, -0.7 * sx, t);
      const y = lerp(yTop - 0.02 * sc, yBot + 0.12 * sc, t);
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
    if (q) gear(new THREE.TorusGeometry(0.036 * sc, 0.008 * sc, 5, 14), { bone: 'chest', color: TROLL_PAL.edge, mat: IRON, matrix: placeAlong(q.p.addScaledVector(q.n, lift + th + 0.012 * sc), q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
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
}

/** war troll: the strap with a ring that hangs from the belt down the front of the kilt (the belt itself is `trollBelt`) */
export function warBelts(ctx: KindContext, gear: GearFn, proj: Projector, beltY: number) {
  const { P } = ctx;
  const sc = P.s;
  const t = ringCast(proj, 0.62, beltY);
  if (!t) return;
  const top = t.p.clone().addScaledVector(t.n, 0.05 * sc);
  const down = V(t.n.x * 0.25, -1, t.n.z * 0.1).normalize();
  const len = 0.5 * sc;
  const pts = [top, top.clone().addScaledVector(down, len * 0.5), top.clone().addScaledVector(down, len)];
  const nr = [t.n.clone(), t.n.clone(), t.n.clone()];
  gear(ribbon(pts, nr, 0.05 * sc, 0.014 * sc, 1, { outerOnly: true, noInner: true }, 8), { bone: 'spine', color: TROLL_PAL.leather, mat: STRAP, small: true });
  gear(new THREE.TorusGeometry(0.02 * sc, 0.006 * sc, 5, 10), { bone: 'spine', color: TROLL_PAL.edge, mat: IRON, matrix: placeAlong(pts[1].clone().addScaledVector(t.n, 0.016 * sc), t.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), small: true });
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
  const top = greaveBottom(ctx) + 0.04 * sc;
  s.group('union', 0.006 * sc, () => {
    emitParts(s, parts, ['foot', 'toes'], { color: TROLL_PAL.wrap, mat: WRAP, inflate: 0.02 * sc, k: 0.03 * sc, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' } });
    emitParts(s, parts, ['shin', 'calf'], { color: TROLL_PAL.wrap, mat: WRAP, inflate: 0.02 * sc, k: 0.03 * sc, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' } });
    s.mirrored(() => {
      const f = j.foot_l;
      const t = j.toe_l;
      const wrap = { color: TROLL_PAL.wrap, mat: WRAP, noise: { amp: 0.004 * sc, freq: 50 / sc, type: 'ridged' as const } };
      s.cone([f[0], f[1] + 0.02 * sc, f[2]], [t[0] + 0.05 * sc, t[1] + 0.02 * sc, t[2] + 0.07 * sc + 0.1 * (t[2] - f[2])], 0.094 * sc + 0.02 * sc, 0.075 * sc + 0.02 * sc, { ...wrap, bone: 'foot_l', bone2: 'toe_l', blend: [0.45, 0.95], k: 0.04 * sc });
      s.cone([j.shin_l[0], j.shin_l[1] - 0.2 * sc, j.shin_l[2] - 0.03 * sc], [f[0], f[1] + 0.04 * sc, f[2] + 0.01 * sc], 0.07 * sc * P.build.bulk + 0.02 * sc, 0.052 * sc * P.build.bulk + 0.02 * sc, { ...wrap, bone: 'shin_l', bone2: 'foot_l', blend: [0.4, 1], k: 0.07 * sc });
      s.ellipsoid([j.shin_l[0], j.shin_l[1] - 0.12 * sc, j.shin_l[2] - 0.04 * sc], [0.08 * sc * P.build.bulk + 0.02 * sc, 0.13 * sc, 0.085 * sc * P.build.bulk + 0.02 * sc], { ...wrap, bone: 'shin_l', k: 0.07 * sc });
    });
    s.plane([0, 1, 0], top, { op: 'intersect', k: 0.012 * sc });
    s.plane([0, 1, 0], top, { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** boot-top height: the wrapped feet end here and the greaves start (sheet: about 0.45 m) */
function greaveBottom(ctx: KindContext): number {
  const { P } = ctx;
  return P.ankleH + 0.2 * P.s;
}

export function warGreaves(ctx: KindContext, gear: GearFn, proj: Projector) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const y0 = greaveBottom(ctx) + 0.02 * sc;
  // from just under the wraps to well up under the kilt hem (sheet: greaves reach about the knee)
  const y1 = j.shin_l[1] + 0.03 * sc;
  for (const sd of ['l', 'r'] as const) {
    const f = V(...j[`foot_${sd}`]);
    const kn = V(...j[`shin_${sd}`]);
    const axisAt = (y: number) => {
      const t = (y - f.y) / (kn.y - f.y);
      return [f.x + (kn.x - f.x) * t, f.z + (kn.z - f.z) * t] as const;
    };
    const lift = 0.016 * sc;
    const nrows = 10;
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
    // bright rims top and bottom
    for (const rr of [0, nrows]) gear(ribbonThrough(P2[rr], N2[rr], 0.014 * sc, 0.022 * sc, 0.01 * sc), { bone, color: TROLL_PAL.edge, mat: IRON, small: true });
    // two leather straps round the greave with iron buckles on the outside
    for (const rr of [3, 7]) {
      gear(ribbonThrough(P2[rr], N2[rr], 0.014 * sc, 0.034 * sc, 0.01 * sc), { bone, color: TROLL_PAL.leather, mat: STRAP, small: true });
      // azimuth 0 = front, + toward +X: the outer side of the left leg (+X) is a quarter turn, the right leg's three quarters
      const ob = Math.round(na * (sd === 'l' ? 0.25 : 0.75));
      gear(hexBolt(0.018 * sc, 0.016 * sc), { bone, color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(P2[rr][ob].clone().addScaledVector(N2[rr][ob], 0.024 * sc), N2[rr][ob], V(0, 1, 0)), small: true });
    }
    // spikes up the outer side and a row of rivets along the front splint
    for (const [rr, h] of [[2, 0.1], [5, 0.12], [8, 0.1]] as [number, number][]) {
      const ci = Math.round(na * (sd === 'l' ? 0.25 : 0.75));
      const p = P2[rr][ci].clone().addScaledVector(N2[rr][ci], 0.012 * sc);
      gear(spike(0.02 * sc, h * sc, 5), { bone, color: TROLL_PAL.edge, mat: IRON, matrix: placeAlong(p, N2[rr][ci], V(0, 0, 1)), small: true });
    }
    const ci = 0;
    for (let rr = 1; rr < nrows; rr += 3) gear(rivet(0.009 * sc, 5), { bone, color: TROLL_PAL.edge, mat: IRON, matrix: placeAlong(P2[rr][ci].clone().addScaledVector(N2[rr][ci], 0.014 * sc), N2[rr][ci], V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), small: true });
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
    // outward direction perpendicular to the forearm (guard the degenerate case of an arm lying along X)
    const u = V(sx, 0, 0).sub(axis.clone().multiplyScalar(axis.x * sx));
    if (u.lengthSq() < 1e-6) u.set(0, 0, 1);
    u.normalize();
    const w = new THREE.Vector3().crossVectors(axis, u).normalize();
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
    gear(gridPlate(g, 0.016 * sc, { closedU: true, thickFn: (_u, v) => 1 + 0.8 * (1 - smooth(0, 0.08, Math.min(v, 1 - v))) }), { bone, color: TROLL_PAL.bracer, mat: IRON, ao: 0.85 });
    // iron rings at both ends and the middle (rust as an edge accent on the end rings)
    for (const rr of [0, 3, nr]) gear(ribbonThrough(Pg[rr], Ng[rr], 0.016 * sc, 0.03 * sc, 0.012 * sc), { bone, color: rr === 3 ? TROLL_PAL.iron : TROLL_PAL.edge, mat: IRON, small: true });
    // a few spikes along the outer ridge, standing along the surface normal (away from the body)
    const outI = 0; // the cast direction `u` points outward for either forearm
    for (const r of [1, 2, 4]) {
      const pp = Pg[r][outI].clone().addScaledVector(Ng[r][outI], 0.014 * sc);
      gear(spike(0.017 * sc, 0.1 * sc, 5), { bone, color: TROLL_PAL.iron, mat: IRON, matrix: placeAlong(pp, Ng[r][outI], V(0, 0, 1)), small: true });
    }
  }
}
