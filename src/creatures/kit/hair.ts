/**
 * Kit — hair & fur: strand cards (ribbons) and braids with an anisotropic highlight.
 *
 *  - growStrands()     grow strand polylines from roots under gravity, pushed out of ellipsoid
 *                      colliders (scalp, neck, back) — gives natural hanging/combed hair
 *  - hairGeometry()    ribbons (cards facing away from the colliders) + braids → one skinned
 *                      BufferGeometry with uv (u across, v root→tip) and vertex colour
 *  - createHairMaterial()  MeshPhysicalMaterial with a generated strand texture (alpha-tested),
 *                      GGX anisotropy along the fibres and a sheen for the soft scatter
 * Skinning: you pass a weight function (model-space point, 0..1 along strand) → bone weights,
 * so strands follow the head near the root and spring bones further down.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng';
import type { V3 } from './sdf';

export interface EllipsoidCollider {
  c: V3;
  r: V3;
}

export interface GrowRoot {
  p: V3;
  /** initial direction (will be bent by gravity) */
  dir: V3;
  length: number;
  /** extra offset from colliders for this strand (layering) */
  lift?: number;
  /** card width at the root */
  width?: number;
  /** strand colour override (sRGB) */
  color?: number;
  /** stop growing once the strand drops below this height (model y) */
  minY?: number;
  /** rigidly skin this strand to one bone (overrides the weight function) */
  bone?: number;
  /** steer toward this model-space point while above it (hair combed to a gathering point,
   *  e.g. half-up elven hair meeting at the back of the crown) */
  toward?: V3;
  /** steering strength per 3 cm of growth (default 0.35) */
  steer?: number;
}

export interface Strand {
  /** rigid bone (overrides the weight function) */
  bone?: number;
  points: THREE.Vector3[];
  /** outward hint per point (card normal) */
  normals: THREE.Vector3[];
  width: number;
  tipWidth: number;
  color?: number;
  /** brightness multiplier of the whole strand (lock tone, set by clumpStrands) */
  tone?: number;
  /** arc fraction where the strand leaves the scalp (end of the hug); clumping and card turning
   *  start there, so cards lying on the head stay flat */
  free?: number;
}

export interface GrowOpts {
  segments?: number;
  /** how quickly strands bend toward gravity (per metre); 0 = straight */
  gravity?: number;
  colliders?: EllipsoidCollider[];
  /** random wobble (radians per segment) */
  jitter?: number;
  seed?: number;
  /** default card width */
  width?: number;
  /** tip width as a fraction of root width */
  taper?: number;
  /** gentle wave (amplitude in m, wavelength in m) */
  wave?: { amp: number; length: number };
  /** index of a collider the strands hug (stay on its surface at their lift) while above its
   *  lower part — combed hair lying on the scalp. Below that they fall freely. */
  hug?: number | 'nearest';
  /** outward-normal y below which hugging stops (default -0.2) */
  hugUntil?: number;
  /** collider indices used for card normals (default: all). Leave out face/ear colliders so
   *  cards near the hairline lie flat on the scalp instead of twisting toward the face. */
  normalColliders?: number[];
  /** gravity multiplier while a strand lies on the hug collider (combed hair follows the comb,
   *  not gravity, until it leaves the scalp; default 1). Steering is kept tangential there. */
  hugGravity?: number;
  /** curvature-adaptive sampling (m of extra "length" per radian of bend): the card's segments
   *  gather where the strand bends (over the back of the skull) and thin out along the straight
   *  fall, so long cards don't crease at the same triangle count. Default 0 (even spacing). */
  adaptive?: number;
}

/** signed-ish distance to an ellipsoid and its outward normal */
function ellipsoidPush(p: THREE.Vector3, e: EllipsoidCollider, margin: number, outN: THREE.Vector3): boolean {
  const lx = (p.x - e.c[0]) / (e.r[0] + margin);
  const ly = (p.y - e.c[1]) / (e.r[1] + margin);
  const lz = (p.z - e.c[2]) / (e.r[2] + margin);
  const k = Math.sqrt(lx * lx + ly * ly + lz * lz);
  outN.set(lx / (e.r[0] + margin), ly / (e.r[1] + margin), lz / (e.r[2] + margin)).normalize();
  if (k >= 1 || k < 1e-6) return false;
  p.set(e.c[0] + (lx / k) * (e.r[0] + margin), e.c[1] + (ly / k) * (e.r[1] + margin), e.c[2] + (lz / k) * (e.r[2] + margin));
  return true;
}

const _n = new THREE.Vector3();
const _best = new THREE.Vector3();
const _st = new THREE.Vector3();

export function growStrands(roots: GrowRoot[], o: GrowOpts = {}): Strand[] {
  const segs = o.segments ?? 10;
  const grav = o.gravity ?? 9;
  const hugC0 = o.hug !== undefined;
  const cols = o.colliders ?? [];
  const rnd = mulberry32(o.seed ?? 1);
  const out: Strand[] = [];
  const raw: THREE.Vector3[] = [];
  const cum: number[] = [];
  for (const r of roots) {
    let rawN = 0;
    const rawAt = (i: number) => raw[i];
    const rawPush = (v: THREE.Vector3) => {
      if (rawN < raw.length) raw[rawN].copy(v);
      else raw.push(v.clone());
      rawN++;
    };
    const p = new THREE.Vector3(...r.p);
    const dir = new THREE.Vector3(...r.dir).normalize();
    const step = Math.min(0.01, r.length / 12);
    const nSteps = Math.max(2, Math.ceil(r.length / step));
    const lift = r.lift ?? 0.004;
    const phase = rnd() * Math.PI * 2;
    rawPush(p);
    let travelled = 0;
    let hugging = typeof o.hug === 'number';
    let freeAt = -1;
    const hugG = o.hugGravity ?? 1;
    for (let i = 0; i < nSteps; i++) {
      const f = i / nSteps;
      // bend toward gravity, more as the strand leaves the scalp (less while combed on it)
      dir.y -= grav * step * (0.35 + 0.65 * f) * (hugging ? hugG : 1);
      dir.x += (rnd() - 0.5) * (o.jitter ?? 0.08) * (step / 0.03);
      dir.z += (rnd() - 0.5) * (o.jitter ?? 0.08) * (step / 0.03);
      if (r.toward) {
        const last = rawAt(rawN - 1);
        if (last.y > r.toward[1]) {
          _st.set(r.toward[0] - last.x, r.toward[1] - last.y, r.toward[2] - last.z);
          if (hugging && typeof o.hug === 'number' && cols[o.hug]) {
            // along the scalp: drop the part of the pull that points into the head
            const c = cols[o.hug];
            _n.set((last.x - c.c[0]) / (c.r[0] * c.r[0]), (last.y - c.c[1]) / (c.r[1] * c.r[1]), (last.z - c.c[2]) / (c.r[2] * c.r[2])).normalize();
            _st.addScaledVector(_n, -_st.dot(_n));
          }
          const dl = _st.length();
          if (dl > 0.004) dir.addScaledVector(_st, ((r.steer ?? 0.35) * (step / 0.03)) / dl);
        }
      }
      dir.normalize();
      const prev = rawAt(rawN - 1);
      p.copy(prev).addScaledVector(dir, step);
      if (o.wave) {
        const sw = Math.cos(phase + (travelled * Math.PI * 2) / o.wave.length) * o.wave.amp * ((Math.PI * 2 * step) / o.wave.length);
        p.x += sw * 0.7;
        p.z += sw * 0.7;
      }
      for (let it = 0; it < 2; it++) for (const c of cols) ellipsoidPush(p, c, lift, _n);
      let hugC: EllipsoidCollider | undefined = typeof o.hug === 'number' ? cols[o.hug] : undefined;
      if (o.hug === 'nearest') {
        let best = Infinity;
        for (const c of cols) {
          const lx = (p.x - c.c[0]) / c.r[0], ly = (p.y - c.c[1]) / c.r[1], lz = (p.z - c.c[2]) / c.r[2];
          const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (kk < best) {
            best = kk;
            hugC = c;
          }
        }
      }
      if (hugC) {
        const c = hugC;
        const lx = (p.x - c.c[0]) / (c.r[0] + lift), ly = (p.y - c.c[1]) / (c.r[1] + lift), lz = (p.z - c.c[2]) / (c.r[2] + lift);
        const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
        _n.set(lx / (c.r[0] + lift), ly / (c.r[1] + lift), lz / (c.r[2] + lift)).normalize();
        if (kk > 1 && _n.y > (o.hugUntil ?? -0.2)) p.set(c.c[0] + (lx / kk) * (c.r[0] + lift), c.c[1] + (ly / kk) * (c.r[1] + lift), c.c[2] + (lz / kk) * (c.r[2] + lift));
        hugging = _n.y > (o.hugUntil ?? -0.2) && kk < 1.15;
        if (!hugging && freeAt < 0) freeAt = travelled;
      }
      dir.subVectors(p, prev).normalize();
      p.copy(prev).addScaledVector(dir, step);
      rawPush(p);
      travelled += step;
      if (r.minY !== undefined && p.y < r.minY) break;
    }
    // resample to segs+1 points evenly along the arc (or along arc + bend when adaptive)
    cum.length = rawN;
    cum[0] = 0;
    const ad = o.adaptive ?? 0;
    for (let i = 1; i < rawN; i++) {
      let c = raw[i].distanceTo(raw[i - 1]);
      if (ad > 0 && i < rawN - 1) {
        _st.subVectors(raw[i], raw[i - 1]);
        _n.subVectors(raw[i + 1], raw[i]);
        const l1 = _st.length(), l2 = _n.length();
        if (l1 > 1e-7 && l2 > 1e-7) c += ad * Math.acos(Math.max(-1, Math.min(1, _st.dot(_n) / (l1 * l2))));
      }
      cum[i] = cum[i - 1] + c;
    }
    const total = cum[rawN - 1];
    const pts: THREE.Vector3[] = [];
    let k = 0;
    for (let i = 0; i <= segs; i++) {
      const d = (total * i) / segs;
      while (k < rawN - 2 && cum[k + 1] < d) k++;
      const t = (d - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      pts.push(raw[k].clone().lerp(raw[Math.min(k + 1, rawN - 1)], Math.min(1, Math.max(0, t))));
    }
    // normals: away from the nearest collider (fallback: horizontal away from the axis)
    const nrm: THREE.Vector3[] = [];
    const ncols = o.normalColliders ? o.normalColliders.map((i) => cols[i]).filter(Boolean) : cols;
    for (const q of pts) {
      let bestD = Infinity;
      _best.set(q.x, 0, q.z).normalize();
      for (const c of ncols) {
        const lx = (q.x - c.c[0]) / c.r[0], ly = (q.y - c.c[1]) / c.r[1], lz = (q.z - c.c[2]) / c.r[2];
        const kk = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (kk < bestD) {
          bestD = kk;
          _best.set(lx / c.r[0], ly / c.r[1], lz / c.r[2]).normalize();
        }
      }
      nrm.push(_best.clone());
    }
    // smooth the card normals along the strand (no sudden twists between colliders)
    for (let pass = 0; pass < 2; pass++)
      for (let i = 1; i < nrm.length - 1; i++) nrm[i].add(nrm[i - 1]).add(nrm[i + 1]).normalize();
    const width = r.width ?? o.width ?? 0.022;
    out.push({ points: pts, normals: nrm, width, tipWidth: width * (o.taper ?? 0.45), color: r.color, bone: r.bone, free: hugC0 ? (freeAt < 0 ? 1 : freeAt / Math.max(1e-6, travelled)) : 0 });
  }
  return out;
}

export interface ClumpOpts {
  /** number of locks the strands are grouped into */
  locks: number;
  /** 0..1 how far each strand converges onto its lock's axis at its tip */
  strength: number;
  /** along-fraction where the convergence begins (default 0.2) */
  start?: number;
  /** along-fraction whose positions group the strands into locks (default 0.65) */
  groupAt?: number;
  /** 0..1 card normals turned sideways around the lock axis (rounded locks with their own
   *  highlight instead of one flat sheet) */
  radial?: number;
  /** ± brightness variation per lock */
  tone?: number;
  /** per-lock length variation (0..1): each lock is shortened by up to this fraction, and its
   *  outer members end up to `taperTips` earlier, so every lock ends in one soft point and the
   *  hem is irregular lock by lock instead of a comb of equal strand tips */
  lockLength?: number;
  taperTips?: number;
  /** push the clumped points back out of these colliders (margin in m) */
  colliders?: EllipsoidCollider[];
  margin?: number;
  seed?: number;
  /** strands that take part (default all) */
  filter?: (s: Strand, i: number) => boolean;
}

const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _cr = new THREE.Vector3();
const _ct = new THREE.Vector3();

function cumLengths(pts: THREE.Vector3[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return c;
}

/** point at arc distance d along an evenly sampled polyline (extrapolated past the tip) */
function pointAtDist(pts: THREE.Vector3[], cum: number[], d: number, out: THREE.Vector3): THREE.Vector3 {
  const n = pts.length;
  const L = cum[n - 1];
  if (d <= 0) return out.copy(pts[0]);
  if (d >= L) {
    const seg = Math.max(1e-6, cum[n - 1] - cum[n - 2]);
    return out.copy(pts[n - 1]).addScaledVector(_ct.subVectors(pts[n - 1], pts[n - 2]), (d - L) / seg);
  }
  let k = Math.min(n - 2, Math.floor((d / L) * (n - 1)));
  while (k > 0 && cum[k] > d) k--;
  while (k < n - 2 && cum[k + 1] < d) k++;
  const t = (d - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
  return out.copy(pts[k]).lerp(pts[k + 1], t);
}

/** cut a strand to `len` (m) keeping its point count (points/normals resampled along the arc) */
function trimStrand(s: Strand, cum: number[], len: number) {
  const n = s.points.length;
  const L = cum[n - 1];
  if (len >= L * 0.999 || len <= 0) return;
  const pts = s.points.map((p) => p.clone());
  const nrm = s.normals.map((v) => v.clone());
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = (len * i) / (n - 1);
    while (k < n - 2 && cum[k + 1] < d) k++;
    const t = Math.min(1, Math.max(0, (d - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k])));
    s.points[i].copy(pts[k]).lerp(pts[k + 1], t);
    s.normals[i].copy(nrm[k]).lerp(nrm[k + 1], t).normalize();
  }
  // the card's taper is relative to its length: keep the tip width
  if (s.free !== undefined) s.free = Math.min(1, (s.free * L) / len);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + s.points[i].distanceTo(s.points[i - 1]);
}

/**
 * Natural clumping: group strands into locks (k-means on their positions part-way down) and
 * pull each strand toward its lock's mean curve, more toward the tip. Locks taper to soft points
 * (shorter members end inside the lock), each lock gets its own tone, and card normals turn
 * around the lock axis so every lock catches its own highlight. Returns the lock index per
 * strand (-1 for strands left out).
 */
export function clumpStrands(strands: Strand[], o: ClumpOpts): Int32Array {
  const lockOf = new Int32Array(strands.length).fill(-1);
  const ids = strands.map((_, i) => i).filter((i) => !o.filter || o.filter(strands[i], i));
  const K = Math.min(Math.max(1, Math.round(o.locks)), ids.length);
  if (ids.length < 2 || K < 1) return lockOf;
  const rnd = mulberry32(o.seed ?? 3);
  const ga = o.groupAt ?? 0.65;
  const key = ids.map((i) => {
    const p = strands[i].points;
    return p[Math.round(ga * (p.length - 1))];
  });
  // farthest-point seeds, then a few Lloyd iterations
  const cent: THREE.Vector3[] = [key[Math.floor(rnd() * key.length)].clone()];
  const dmin = key.map((k) => k.distanceToSquared(cent[0]));
  while (cent.length < K) {
    let best = 0;
    for (let j = 1; j < key.length; j++) if (dmin[j] > dmin[best]) best = j;
    cent.push(key[best].clone());
    for (let j = 0; j < key.length; j++) dmin[j] = Math.min(dmin[j], key[j].distanceToSquared(key[best]));
  }
  const assign = new Int32Array(ids.length);
  for (let it = 0; it < 5; it++) {
    for (let j = 0; j < key.length; j++) {
      let b = 0, bd = Infinity;
      for (let c = 0; c < K; c++) {
        const d = key[j].distanceToSquared(cent[c]);
        if (d < bd) {
          bd = d;
          b = c;
        }
      }
      assign[j] = b;
    }
    if (it === 4) break;
    const cnt = new Array(K).fill(0);
    for (const c of cent) c.set(0, 0, 0);
    for (let j = 0; j < key.length; j++) {
      cent[assign[j]].add(key[j]);
      cnt[assign[j]]++;
    }
    for (let c = 0; c < K; c++) if (cnt[c]) cent[c].divideScalar(cnt[c]);
  }
  const cums = new Map<number, number[]>();
  for (const i of ids) cums.set(i, cumLengths(strands[i].points));
  const start = o.start ?? 0.2;
  const radial = o.radial ?? 0;
  const margin = o.margin ?? 0.003;
  const smooth = (e0: number, e1: number, x: number) => {
    // (a strand that never leaves the scalp has e0 = e1 = 1: no clumping, no 0/0)
    if (e1 - e0 < 1e-6) return x > e1 ? 1 : 0;
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let c = 0; c < K; c++) {
    const members = ids.filter((_, j) => assign[j] === c);
    if (!members.length) continue;
    const tone = 1 + (rnd() * 2 - 1) * (o.tone ?? 0);
    for (const i of members) {
      lockOf[i] = c;
      strands[i].tone = (strands[i].tone ?? 1) * tone;
    }
    if (members.length < 2) continue;
    // lock length & pointed lock tips: trim the members (outer ones more) before converging
    if (o.lockLength || o.taperTips) {
      const lockK = 1 - rnd() * (o.lockLength ?? 0);
      const mid = members.map((i) => {
        const p = strands[i].points;
        return p[Math.round(0.6 * (p.length - 1))];
      });
      const c0 = mid.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(mid.length);
      const offs = mid.map((p) => p.distanceTo(c0));
      const maxOff = Math.max(1e-4, ...offs);
      members.forEach((i, m) => {
        const cu = cums.get(i)!;
        const Ls = cu[cu.length - 1];
        const free = (strands[i].free ?? 0) * Ls;
        // never trim into the part lying on the scalp
        const want = Ls * lockK * (1 - (o.taperTips ?? 0) * (offs[m] / maxOff) * (0.6 + 0.4 * rnd()));
        trimStrand(strands[i], cu, Math.max(free + 0.05 * Ls, want));
      });
    }
    // lock axis: mean curve by arc distance (members that reach that far), lightly smoothed
    const Lmax = Math.max(...members.map((i) => cums.get(i)![cums.get(i)!.length - 1]));
    const M = 20;
    const axis: THREE.Vector3[] = [];
    for (let k = 0; k <= M; k++) {
      const d = (Lmax * k) / M;
      const acc = new THREE.Vector3();
      let n = 0;
      for (const i of members) {
        const cu = cums.get(i)!;
        if (cu[cu.length - 1] < d * 0.999 && k > 0) continue;
        acc.add(pointAtDist(strands[i].points, cu, d, _ca));
        n++;
      }
      axis.push(n ? acc.divideScalar(n) : axis[axis.length - 1].clone());
    }
    for (let pass = 0; pass < 2; pass++)
      for (let k = 1; k < M; k++) axis[k].multiplyScalar(0.5).addScaledVector(axis[k - 1], 0.25).addScaledVector(axis[k + 1], 0.25);
    const axisCum = cumLengths(axis);
    for (const i of members) {
      const s = strands[i];
      const cu = cums.get(i)!;
      const Ls = cu[cu.length - 1] || 1;
      const n = s.points.length;
      // which side of the lock this card lies on (measured once, part-way down, along the card's
      // own side vector): the card is turned by a CONSTANT angle about its strand, so it never
      // twists back and forth along its length
      let sideSign = 0;
      if (radial > 0) {
        const km = Math.round(Math.min(0.85, Math.max(0.45, (s.free ?? 0) + 0.2)) * (n - 1));
        pointAtDist(axis, axisCum, (cu[km] / Lmax) * axisCum[axisCum.length - 1], _cb);
        _cr.subVectors(s.points[km], _cb);
        _ct.subVectors(s.points[Math.min(n - 1, km + 1)], s.points[Math.max(0, km - 1)]).normalize();
        const side = _ca.crossVectors(_ct, s.normals[km]).normalize();
        sideSign = Math.max(-1, Math.min(1, _cr.dot(side) / Math.max(1e-4, s.width * 0.8)));
      }
      // clumping starts where the strand leaves the scalp (or at `start` if later)
      const f0 = Math.max(start, s.free ?? 0);
      for (let k = 0; k < n; k++) {
        const f = cu[k] / Ls;
        const w = o.strength * smooth(f0, 1, f);
        const p = s.points[k];
        if (w > 0) {
          // axis point at the same arc distance (axis re-parametrised by its own length)
          pointAtDist(axis, axisCum, (cu[k] / Lmax) * axisCum[axisCum.length - 1], _cb);
          _cr.subVectors(p, _cb); // offset from the lock axis
          p.addScaledVector(_cr, -w);
          if (o.colliders) for (let it = 0; it < 2; it++) for (const col of o.colliders) ellipsoidPush(p, col, margin, _n);
        }
      }
      if (sideSign !== 0)
        for (let k = 0; k < n; k++) {
          const f = cu[k] / Ls;
          const nm = s.normals[k];
          _ct.subVectors(s.points[Math.min(n - 1, k + 1)], s.points[Math.max(0, k - 1)]).normalize();
          const side = _ca.crossVectors(_ct, nm).normalize();
          nm.addScaledVector(side, sideSign * radial * smooth(f0, Math.min(1, f0 + 0.3), f)).normalize();
        }
    }
  }
  return lockOf;
}

export type WeightFn = (p: THREE.Vector3, along: number, out: [number, number][]) => void;

export interface HairGeoOpts {
  /** sRGB root colour and tip colour (vertex colour multiplies the strand texture) */
  color: number;
  tipColor?: number;
  weights: WeightFn;
  /** card curl: bend the card across its width (0 = flat) for volume */
  curl?: number;
  /** brightness at the root (darker roots give depth), default 0.72 */
  rootShade?: number;
  /** length over which the root shade fades out (m), default 0.04 */
  rootLength?: number;
}

export interface BraidDef {
  points: V3[];
  radius: number;
  /** strand crossings per metre */
  twist?: number;
  color?: number;
}

const _side = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Build ribbon cards + braid tubes into one skinned geometry (uv: u across, v root→tip). */
export function hairGeometry(strands: Strand[], braids: BraidDef[], o: HairGeoOpts): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const wtmp: [number, number][] = [];
  let rigidBone = -1;
  const pushVert = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, along: number) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(u, v);
    col.push(c.r, c.g, c.b);
    wtmp.length = 0;
    if (rigidBone >= 0) wtmp.push([rigidBone, 1]);
    else o.weights(p, along, wtmp);
    wtmp.sort((a, b) => b[1] - a[1]);
    let s = 0;
    for (let k = 0; k < 4; k++) s += wtmp[k]?.[1] ?? 0;
    s = s || 1;
    for (let k = 0; k < 4; k++) {
      si.push(wtmp[k]?.[0] ?? 0);
      sw.push((wtmp[k]?.[1] ?? 0) / s);
    }
  };
  const root = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const tip = new THREE.Color().setHex(o.tipColor ?? o.color, THREE.SRGBColorSpace);
  const curl = o.curl ?? 0.25;
  let uOff = 0;
  for (const s of strands) {
    rigidBone = s.bone ?? -1;
    const n = s.points.length;
    const base = pos.length / 3;
    const sc = s.color !== undefined ? _c2.setHex(s.color, THREE.SRGBColorSpace) : null;
    // each card samples a different slice of the strand texture
    uOff = (uOff + 0.37) % 1;
    let strandLen = 0;
    for (let i = 1; i < n; i++) strandLen += s.points[i].distanceTo(s.points[i - 1]);
    const rootFrac = Math.min(1, (o.rootLength ?? 0.04) / Math.max(1e-4, strandLen));
    for (let i = 0; i < n; i++) {
      const p = s.points[i];
      const along = i / (n - 1);
      if (i < n - 1) _tan.subVectors(s.points[i + 1], p);
      else _tan.subVectors(p, s.points[i - 1]);
      _tan.normalize();
      const nm = s.normals[i];
      _side.crossVectors(_tan, nm).normalize();
      const w = (s.width + (s.tipWidth - s.width) * along) * 0.5;
      // root slightly darker, tips toward the tip colour
      const rs0 = o.rootShade ?? 0.72;
      _c.copy(sc ?? root).multiplyScalar(rs0 + (1 - rs0) * Math.min(1, along / rootFrac));
      if (o.tipColor !== undefined) _c.lerp(tip, along * along * 0.8);
      if (s.tone !== undefined) _c.multiplyScalar(s.tone);
      // three verts across (centre raised along the normal for a curved card)
      for (let k = -1; k <= 1; k++) {
        const q = p.clone().addScaledVector(_side, k * w).addScaledVector(nm, (k === 0 ? 1 : 0) * w * curl);
        const nn = nm.clone().addScaledVector(_side, k * 0.35).normalize();
        pushVert(q, nn, uOff * 4 + (k + 1) * 0.5, along, _c, along);
      }
    }
    // wound so the front face points along the card normal (outward): with DoubleSide the
    // normal is flipped on back faces, and inward-facing cards rendered the lit side dark
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 3;
      const b = base + (i + 1) * 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  rigidBone = -1;
  // braids: tubes whose radius and shade follow a plait (chevrons of three crossing strands)
  for (const br of braids) {
    const curve = new THREE.CatmullRomCurve3(br.points.map((p) => new THREE.Vector3(...p)));
    const len = curve.getLength();
    const twist = br.twist ?? 60;
    // enough rings per crossing that the plait does not alias into noise
    const segs = Math.max(8, Math.round(Math.max(len / 0.012, len * twist * 2.5)));
    const radial = 6;
    const frames = curve.computeFrenetFrames(segs, false);
    const base = pos.length / 3;
    const bc = br.color !== undefined ? new THREE.Color().setHex(br.color, THREE.SRGBColorSpace) : root;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      const taper = 1 - 0.45 * t * t;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        // symmetric around the frame normal → interlocking chevrons along the braid
        const aa = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
        const g = 0.5 + 0.5 * Math.cos(Math.PI * 2 * t * len * twist + aa * 1.6);
        const r = br.radius * taper * (0.78 + 0.22 * g);
        const nrm = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
        const q = p.clone().addScaledVector(nrm, r);
        _c.copy(bc).multiplyScalar(0.66 + 0.4 * g);
        pushVert(q, nrm, j / radial, t, _c, 0.5 + 0.5 * t);
      }
    }
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let strandTex: THREE.DataTexture | null = null;
/**
 * RGBA strand texture (4 card tiles across): fibres grouped in bundles with darker gaps between
 * them, sparse wispy edges, and a TAPERED tip — centre fibres run to the end of the card, edge
 * fibres stop earlier — so cards (and the locks they form) end in soft points instead of a blunt,
 * straw-like fringe. Brightness is smooth along the length (no banding). Shared (do not dispose).
 */
export function strandTexture(): THREE.DataTexture {
  if (strandTex) return strandTex;
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const rnd = mulberry32(777);
  // fibre table per column
  const fib: { b: number; end: number; a: number; ph: number }[] = [];
  let bundleB = 1, bundleLeft = 0, bundlePh = 0;
  for (let x = 0; x < W; x++) {
    const u = (x % 64) / 64; // 4 tiles across (cards pick one)
    const edge = Math.min(u, 1 - u) * 2; // 0 at card edge, 1 at centre
    if (bundleLeft <= 0 || x % 64 === 0) {
      bundleLeft = 3 + Math.floor(rnd() * 6);
      bundleB = 0.86 + rnd() * 0.16;
      bundlePh = rnd() * 6.28;
    }
    bundleLeft--;
    // a slightly darker fibre between bundles (opaque: holes inside a card read as wool once
    // cards cross at different angles)
    const gap = bundleLeft === 0;
    // brightness is a LINEAR multiplier on the vertex colour (texture is not sRGB-decoded)
    const b = bundleB * (0.95 + rnd() * 0.07) * (gap ? 0.84 : 1);
    // tapered tip: the centre reaches the end, the edges stop ~22 % earlier (+ jitter)
    const end = 1 - 0.22 * Math.pow(1 - edge, 1.3) - rnd() * 0.05;
    const a = edge < 0.2 ? (rnd() < edge * 4 ? 1 : 0) : 1;
    fib.push({ b, end, a, ph: bundlePh });
  }
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const f = fib[x];
      const i = (y * W + x) * 4;
      // very gentle lengthwise variation per bundle (one slow wave over the card)
      const vary = 0.96 + 0.04 * Math.sin(v * 5.5 + f.ph);
      const b = Math.min(1, f.b * vary);
      data[i] = data[i + 1] = data[i + 2] = Math.round(b * 255);
      // fibres thin out just before their end; roots fade in over the first 1.5 % (no square starts)
      const tipFade = v > f.end ? 0 : v > f.end - 0.05 ? (rnd() < 0.75 ? 1 : 0) : v < 0.015 ? (v / 0.015 > (x % 7) / 7 ? 1 : 0) : 1;
      data[i + 3] = Math.round(f.a * tipFade * 255);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.userData.shared = true;
  strandTex = t;
  return t;
}

export interface HairMaterialOpts {
  roughness?: number;
  /** strength of the Kajiya-Kay strand highlight (0..1.5) */
  anisotropy?: number;
  sheen?: number;
  sheenColor?: number;
  alphaTest?: number;
  /** highlight tint (sRGB), defaults to a warm white */
  highlight?: number;
}

const KK_COMMON = /* glsl */ `
vec3 gHairT = vec3( 0.0, 1.0, 0.0 );
uniform float hairSpec;
uniform vec3 hairHighlight;
`;

/**
 * Hair: alpha-tested strand cards with a Kajiya-Kay highlight along the strand direction
 * (tangent = UV v direction from screen derivatives): a sharp primary lobe shifted toward the
 * root and a broader secondary lobe tinted by the hair colour. Specular F0/F90 kept low so dark
 * hair stays dark at grazing angles.
 */
export function createHairMaterial(o: HairMaterialOpts = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    map: strandTexture(),
    vertexColors: true,
    roughness: o.roughness ?? 0.55,
    metalness: 0,
    sheen: o.sheen ?? 0.3,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(o.sheenColor ?? 0x6a6258),
    alphaTest: o.alphaTest ?? 0.45,
    side: THREE.DoubleSide,
    specularIntensity: 0.25,
  });
  const hl = new THREE.Color().setHex(o.highlight ?? 0xfff4e0, THREE.SRGBColorSpace);
  const uniforms = { hairSpec: { value: o.anisotropy ?? 0.7 }, hairHighlight: { value: new THREE.Vector3(hl.r, hl.g, hl.b) } };
  m.userData.hairUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    const target = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );';
    if (chunk.includes(target)) {
      chunk = chunk.replace(
        target,
        `${target}
	{
		// Kajiya-Kay strand highlights
		vec3 H = normalize( directLight.direction + geometryViewDir );
		vec3 T1 = normalize( gHairT + geometryNormal * 0.12 );
		vec3 T2 = normalize( gHairT - geometryNormal * 0.1 );
		float d1 = dot( T1, H ), d2 = dot( T2, H );
		float s1 = pow( sqrt( max( 0.0, 1.0 - d1 * d1 ) ), 110.0 );
		float s2 = pow( sqrt( max( 0.0, 1.0 - d2 * d2 ) ), 28.0 );
		float wrapL = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
		reflectedLight.directSpecular += directLight.color * wrapL * hairSpec * ( s1 * 0.18 * hairHighlight + s2 * 0.35 * material.diffuseColor );
	}`,
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${KK_COMMON}`)
      .replace('#include <lights_physical_pars_fragment>', chunk)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
	{
		// strand direction = direction of increasing v (cotangent frame from derivatives)
		vec3 dp1 = dFdx( - vViewPosition ), dp2 = dFdy( - vViewPosition );
		vec2 duv1 = dFdx( vMapUv ), duv2 = dFdy( vMapUv );
		vec3 dp2perp = cross( dp2, normal ), dp1perp = cross( normal, dp1 );
		vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
		gHairT = length( B ) > 1e-9 ? normalize( B ) : vec3( 0.0, 1.0, 0.0 );
	}`,
      );
  };
  m.customProgramCacheKey = () => 'kit-hair-v2';
  return m;
}
