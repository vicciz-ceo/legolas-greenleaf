/**
 * Fitting helpers shared by both trolls: cast points onto the finished sculpt (`Projector`), plates and bands that follow
 * the real surface, and the broad belt with its ring buckle.
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';
import { V, placeAlong, shellPatch, ribbon, lerp, type GearFn, type Projector } from './common';
import { TROLL_PAL, IRON, STRAP, rustPatches } from './troll_pal';

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

export interface Grid {
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
export function ribbonThrough(pts: THREE.Vector3[], nrm: THREE.Vector3[], lift: number, width: number, thick: number): THREE.BufferGeometry {
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


/** broad leather belt following the real belly, with a cast ring buckle at the front (right of centre, as in both sheets) */
export function trollBelt(ctx: KindContext, gear: GearFn, proj: Projector, y: number, o: { width: number; edges?: boolean }) {
  const { P } = ctx;
  const sc = P.s;
  loopBand(proj, y, o.width * sc, 0.016 * sc, 0.022 * sc, 'spine', gear, TROLL_PAL.leather);
  // stitched edges: two thin darker straps along the belt's rims
  if (o.edges !== false) for (const d of [-1, 1]) loopBand(proj, y + d * o.width * sc * 0.4, 0.012 * sc, 0.008 * sc, 0.03 * sc, 'spine', gear, TROLL_PAL.leatherDark);
  const q = ringCast(proj, -0.1, y);
  if (q) {
    const at = q.p.addScaledVector(q.n, 0.04 * sc);
    const m = placeAlong(at, q.n, V(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    gear(new THREE.TorusGeometry(0.07 * sc, 0.0145 * sc, 6, 18), { bone: 'spine', color: TROLL_PAL.buckle, mat: IRON, matrix: m, ao: 0.85 });
    gear(new THREE.BoxGeometry(0.1 * sc, 0.016 * sc, 0.016 * sc), { bone: 'spine', color: TROLL_PAL.buckle, mat: IRON, matrix: m, small: true });
  }
}

/** a gear sink that tints metal pieces with rust patches (pieces in the bright edge colour stay clean) */
export function rustGear(gear: GearFn, amount = 0.55, freq = 4.5): GearFn {
  const f = rustPatches(TROLL_PAL.rust, amount, freq);
  return (geo, o) => gear(geo, o.color === TROLL_PAL.edge || o.colorFn ? o : { ...o, colorFn: f });
}

