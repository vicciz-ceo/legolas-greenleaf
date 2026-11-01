/**
 * The orc family's own garment and gear helpers (orc, Gundabad orc, goblin): the sheet's ragged
 * brown rag tunic with a cowl neck, long wrapped leather bracers, shin wraps with criss-crossing
 * cord, a double belt with iron rings and a hanging plate, a leather baldric with ring buckles.
 * Sculpted garments are added in `extras` AFTER the skin tint so they keep their own colours;
 * the small rigid pieces are placed on the finished sculpt with the uruks' projector.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import type { Sculpt, V3 } from '../../../kit/sdf';
import { surface, type SurfaceSpec } from '../../../kit/surfaces';
import { anatomyParts, emitParts, type PartTag } from '../../anatomy';
import type { KindContext } from '../../types';
import { makeProjector, snapPoint, placeAlong, frameAt, V, type Projector } from '../uruks_bosses/common';
import { put, spike, studs } from './armor';
import { shade } from './common';

/** woven rag cloth (tunic, kilt, wraps): coarse weave, matte, a little sheen from the albedo */
export const RAGS = surface('rags', { rough: 0.95, sheen: 0.3, pat: { weave: 1.2, wrinkles: 0.55 } });
/** stitched, worn leather (straps, bracers, belts) */
export const STRAP = surface('leather_worn', { rough: 0.72, sheen: 0.08 });
/** pitted, rusted plate (sheet: rusty iron with orange rust blooms) */
export const RUST = surface('iron_rusty', { rough: 0.7, metal: 0.8 });

export function slab(s: Sculpt, y0: number | null, y1: number | null, k: number) {
  if (y1 !== null) s.plane([0, 1, 0], y1, { op: 'intersect', k });
  if (y0 !== null) s.plane([0, -1, 0], -y0, { op: 'intersect', k });
}

function limbPlane(s: Sculpt, L: THREE.Vector3, at: V3, keepBeyond: boolean, k: number) {
  const n = keepBeyond ? L.clone().multiplyScalar(-1) : L.clone();
  s.plane([n.x, n.y, n.z], n.x * at[0] + n.y * at[1] + n.z * at[2], { op: 'intersect', k });
}

const TORSO: PartTag[] = ['pelvis', 'waist', 'belly', 'ribs', 'chest', 'pecs', 'back', 'trap', 'glutes'];

export interface TunicOpts {
  color: number;
  color2: number;
  mat?: SurfaceSpec;
  /** outward offset (m at s = 1) */
  inflate: number;
  /** sleeve length as a fraction of the upper arm (0.5 = to mid upper arm) */
  sleeve: number;
  /** hem height (m above the ground) */
  hemY: number;
  /** the bunched cowl ring at the throat (default on) */
  cowl?: boolean;
}

/**
 * The rag tunic: one smooth garment over torso, shoulders and short sleeves, open at the throat
 * with a bunched cowl ring (sheet: sagging cloth roll round the neck, torn short sleeves).
 */
export function ragTunic(ctx: KindContext, o: TunicOpts) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  const mat = o.mat ?? RAGS;
  const base = { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 20 / sc, mat, noise: { amp: 0.004 * sc, freq: 24 / sc, type: 'ridged' as const, octaves: 2 } };
  const neckTop = P.j.neck[1] - 0.012 * sc;
  s.group('union', 0.0035 * sc, () => {
    s.group('union', 0, () => {
      emitParts(s, parts, o.sleeve > 0 ? [...TORSO, 'deltoid'] : TORSO, { ...base, inflate: o.inflate });
      slab(s, o.hemY, neckTop, 0.01 * sc);
    });
    if (o.sleeve > 0)
    s.mirrored(() =>
      s.group('union', 0.004 * sc, () => {
        emitParts(s, parts, ['upperarm'], { ...base, inflate: o.inflate * 0.9, oneSide: true });
        const sh = P.j.upperarm_l;
        const t = P.upperArm * o.sleeve;
        limbPlane(s, L, [sh[0] + L.x * t, sh[1] + L.y * t, sh[2]], false, 0.006 * sc);
        limbPlane(s, L, [sh[0] - L.x * 0.03 * sc, sh[1] - L.y * 0.03 * sc, sh[2]], true, 0.01 * sc);
      }),
    );
  });
  // trapezius mass: the sinewy slope from the neck to the shoulders reads under the cloth
  s.mirrored(() => s.ellipsoid([0.075 * sc * P.build.shoulders, P.j.neck[1] - 0.012 * sc, -0.022 * sc], [0.066 * sc, 0.04 * sc, 0.058 * sc], { ...base, bone: 'chest', k: 0.02 * sc }));
  // cowl: a bunched roll of cloth round the base of the neck, sagging in front
  const ny = P.j.neck[1];
  if (o.cowl ?? true) s.group('union', 0.012 * sc, () => {
    s.torus([0, ny + 0.002 * sc, 0.008 * sc], 0.088 * sc * Math.sqrt(P.build.bulk) * P.build.neckThick, 0.026 * sc, { ...base, bone: 'chest', rot: [0.34, 0, 0], k: 0.012 * sc });
  });
}

/** a horizontal strap band round the torso/hips between two heights */
export function beltBand(ctx: KindContext, o: { y: number; hw: number; color: number; color2?: number; mat?: SurfaceSpec; inflate: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['pelvis', 'waist', 'belly', 'glutes'], { color: o.color, color2: o.color2, colorNoise: 0.4, colorFreq: 30 / sc, mat: o.mat ?? STRAP, inflate: o.inflate });
    slab(s, o.y - o.hw, o.y + o.hw, 0.003 * sc);
    s.plane([0, 1, 0], o.y + o.hw, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([0, -1, 0], -(o.y - o.hw), { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** a diagonal leather strap over the chest (sign -1: character's left shoulder to right hip) */
export function strapBand(ctx: KindContext, o: { color: number; color2?: number; mat?: SurfaceSpec; width: number; inflate: number; sign: 1 | -1; tilt?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const n = new THREE.Vector3(o.sign * (o.tilt ?? 1), 1.25, 0).normalize();
  const mid = new THREE.Vector3(0, P.j.chest[1] + 0.05 * sc, 0);
  const c = n.dot(mid);
  const hw = o.width * 0.5;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist', 'belly'], { color: o.color, color2: o.color2, colorNoise: 0.4, colorFreq: 30 / sc, mat: o.mat ?? STRAP, inflate: o.inflate });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'paint', seam: 0, k: 0.002 });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'paint', seam: 0, k: 0.002 });
  });
  return { n, c };
}

/** leather bracers from the wrist up the forearm; `length` is the fraction of the forearm from the wrist */
export function longBracers(ctx: KindContext, o: { color: number; color2: number; length: number; inflate: number; mat?: SurfaceSpec }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  const L = P.hand.l.L;
  s.mirrored(() =>
    s.group('union', 0.002 * sc, () => {
      emitParts(s, parts, ['forearm'], { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 26 / sc, mat: o.mat ?? STRAP, k: 0.02 * sc, inflate: o.inflate, oneSide: true });
      const wr = P.j.hand_l;
      limbPlane(s, L, [wr[0] - L.x * 0.008 * sc, wr[1] - L.y * 0.008 * sc, wr[2]], false, 0.004 * sc);
      const from = 1 - o.length;
      const el = P.j.forearm_l;
      const at: V3 = [el[0] + L.x * P.foreArm * from, el[1] + L.y * P.foreArm * from, el[2]];
      limbPlane(s, L, at, true, 0.004 * sc);
      const d = L.x * wr[0] + L.y * wr[1] + L.z * wr[2];
      s.plane([L.x, L.y, L.z], d - 0.008 * sc, { op: 'paint', seam: 0, k: 0.002 });
      s.plane([-L.x, -L.y, -L.z], -(L.x * at[0] + L.y * at[1] + L.z * at[2]), { op: 'paint', seam: 0, k: 0.002 });
    }),
  );
}

/** bunched cloth wraps on the shins (sheet: wrapped to just under the knee, ragged top and bottom) */
export function shinWraps(ctx: KindContext, o: { color: number; color2: number; top: number; bottom: number; inflate: number; mat?: SurfaceSpec; /** wrap the feet too (boots of wraps) */ feet?: boolean; /** foot wrap thickness (default: same as the shin) */ footInflate?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.004 * sc, () => {
    if (o.feet) emitParts(s, parts, ['foot', 'toes'], { color: o.color, color2: o.color2, colorNoise: 0.55, colorFreq: 22 / sc, mat: o.mat ?? RAGS, k: 0.02 * sc, inflate: o.footInflate ?? o.inflate });
    emitParts(s, parts, ['shin', 'calf'], { color: o.color, color2: o.color2, colorNoise: 0.55, colorFreq: 22 / sc, mat: o.mat ?? RAGS, k: 0.02 * sc, inflate: o.inflate, noise: { amp: 0.003 * sc, freq: 40 / sc, type: 'ridged' } });
    slab(s, o.feet ? null : o.bottom, o.top, 0.006 * sc);
    s.plane([0, 1, 0], o.top, { op: 'paint', seam: 0, k: 0.002 });
  });
}

/** a tube along a helix around the axis a→b, riding on the sculpt surface (cords of wraps and bracers) */
function helixCord(proj: Projector, a: V3, b: V3, o: { turns: number; t0?: number; t1?: number; per?: number; radius: number; lift: number; phase?: number; rad: number }): THREE.BufferGeometry | null {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const axis = B.clone().sub(A);
  const len = axis.length();
  axis.normalize();
  let u = new THREE.Vector3(1, 0, 0);
  u.addScaledVector(axis, -u.dot(axis)).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  const pts: THREE.Vector3[] = [];
  const t0 = o.t0 ?? 0, t1 = o.t1 ?? 1;
  const n = Math.max(6, Math.round(o.turns * (o.per ?? 10)));
  const org = new THREE.Vector3(), dir = new THREE.Vector3(), hp = new THREE.Vector3(), hn = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n);
    const ang = (o.phase ?? 0) + (i / n) * o.turns * Math.PI * 2;
    const c = A.clone().addScaledVector(axis, len * t);
    dir.set(0, 0, 0).addScaledVector(u, Math.cos(ang)).addScaledVector(w, Math.sin(ang));
    org.copy(c).addScaledVector(dir, o.radius * 1.35);
    const inward = dir.clone().multiplyScalar(-1);
    // keep only hits near the expected surface (a ray that starts inside the other leg would snap there)
    if (proj.cast(org, inward, o.radius * 1.35, hp, hn) && hp.distanceTo(c) > o.radius * 0.45 && hp.distanceTo(c) < o.radius * 1.2) pts.push(hp.clone().addScaledVector(hn, o.lift));
  }
  if (pts.length < 4) return null;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  return new THREE.TubeGeometry(curve, Math.max(8, pts.length), o.rad, 3, false);
}


/** a ring of ragged hanging points round a limb at `centre` (torn sleeve ends); hits the sculpt surface for the base */
function fringe(proj: Projector, centre: V3, axis: THREE.Vector3, o: { radius: number; count: number; len: number; lift: number; rng: Rng }): THREE.BufferGeometry | null {
  const C = new THREE.Vector3(...centre);
  let u = new THREE.Vector3(0, 0, 1);
  u.addScaledVector(axis, -u.dot(axis)).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  const pos: number[] = [];
  const org = new THREE.Vector3(), dir = new THREE.Vector3(), hp = new THREE.Vector3(), hn = new THREE.Vector3();
  const ring: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  const n = o.count;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    dir.set(0, 0, 0).addScaledVector(u, Math.cos(a)).addScaledVector(w, Math.sin(a));
    org.copy(C).addScaledVector(dir, o.radius * 1.4).addScaledVector(axis, -0.004);
    if (proj.cast(org, dir.clone().multiplyScalar(-1), o.radius * 1.4, hp, hn) && hp.distanceTo(C) < o.radius * 1.3) {
      ring.push(hp.clone().addScaledVector(hn, o.lift));
      nrm.push(hn.clone());
    } else {
      ring.push(C.clone().addScaledVector(dir, o.radius));
      nrm.push(dir.clone());
    }
  }
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const nm = nrm[i].clone().add(nrm[(i + 1) % n]).normalize();
    const len = o.len * (0.45 + 0.9 * o.rng.float());
    const tip = mid.addScaledVector(axis, len).addScaledVector(nm, 0.004 + 0.006 * o.rng.float());
    // shift the tip sideways a little so the points are not a regular zig-zag
    tip.addScaledVector(b.clone().sub(a), (o.rng.float() - 0.5) * 0.6);
    pos.push(a.x, a.y, a.z, tip.x, tip.y, tip.z, b.x, b.y, b.z);
    // back face so the point is visible from inside the sleeve too
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** colour a rusted plate by position: iron, orange rust blooms, pale worn edges */
function rustFn(iron: number, rust: number, hi: number, rustThresh = 0.38) {
  const a = new THREE.Color(), b = new THREE.Color(), h = new THREE.Color();
  a.setHex(iron, THREE.SRGBColorSpace);
  b.setHex(rust, THREE.SRGBColorSpace);
  h.setHex(hi, THREE.SRGBColorSpace);
  const hash = (x: number, y: number, z: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const vnoise = (p: THREE.Vector3, f: number) => {
    const x = p.x * f, y = p.y * f, z = p.z * f;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const l = (a0: number, b0: number, t: number) => a0 + (b0 - a0) * t;
    return l(l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy), l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  };
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const n1 = vnoise(p, 55) * 0.65 + vnoise(p, 140) * 0.35;
    c.copy(a).lerp(b, Math.min(1, Math.max(0, (n1 - rustThresh) * 3.2)));
    const w = vnoise(p, 260);
    if (w > 0.82) c.lerp(h, 0.45);
  };
}

/** a curved rectangular plate: an arc of angle [t0, t1] and radius R over the shoulder, extruded along z */
function arcSheet(R: number, t0: number, t1: number, len: number, thick: number, sx: number, nu = 6, nv = 2, jag = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [r, flip] of [[R + thick, false], [R, true]] as [number, boolean][]) {
    const base = pos.length / 3;
    for (let iv = 0; iv <= nv; iv++)
      for (let iu = 0; iu <= nu; iu++) {
        // `jag` drops every other column of the free edge into a leaf point
        const th = t0 + (t1 - t0) * (iu / nu) + (iu === nu ? jag * (iv % 2 ? 1 : -0.3) : 0);
        pos.push(sx * r * Math.sin(th), r * Math.cos(th), -len / 2 + len * (iv / nv));
      }
    for (let iv = 0; iv < nv; iv++)
      for (let iu = 0; iu < nu; iu++) {
        const a = base + iv * (nu + 1) + iu, b = a + 1, c = a + nu + 1, d = c + 1;
        if (flip !== (sx < 0)) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ni = g.toNonIndexed();
  // orient every triangle: the outer layer faces away from the arc's axis, the inner layer toward it
  const pa = ni.attributes.position as THREE.BufferAttribute;
  const half = pa.count / 2;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < pa.count; i += 3) {
    A.fromBufferAttribute(pa, i);
    B.fromBufferAttribute(pa, i + 1);
    C.fromBufferAttribute(pa, i + 2);
    N.crossVectors(B.clone().sub(A), C.clone().sub(A));
    const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3;
    const out = N.x * cx + N.y * cy;
    const wantOut = i < half;
    if (out > 0 !== wantOut) {
      pa.setXYZ(i + 1, C.x, C.y, C.z);
      pa.setXYZ(i + 2, B.x, B.y, B.z);
    }
  }
  ni.computeVertexNormals();
  return ni;
}

/**
 * The sheet's shoulder plate, seated on the deltoid: two overlapping rusty lames in a curved shell
 * that hugs the shoulder cap (its arc is centred on the deltoid, so it cannot float off the back).
 */
export function rustPauldron(ctx: KindContext, side: 'l' | 'r', o: { iron: number; rust: number; size?: number; rng: Rng; lames?: number }) {
  const { P } = ctx;
  const sc = P.s;
  const sx = side === 'l' ? 1 : -1;
  const sh = P.j[`upperarm_${side}`];
  const L = P.hand.l.L;
  const size = o.size ?? 1;
  const g = Math.sqrt(P.build.bulk);
  // arc centre on the deltoid, a little down the arm; radius clears the (inflated) deltoid
  const cx = sh[0] + sx * L.x * 0.025 * sc;
  const cy = sh[1] + L.y * 0.025 * sc;
  const R = (0.05 * g * size + 0.024) * sc;
  const col = rustFn(o.iron, o.rust, 0xa89a82);
  const lames = o.lames ?? 2;
  const pts: V3[] = [];
  for (let k = 0; k < lames; k++) {
    const rr = R + k * 0.009 * sc;
    const t0 = k === 0 ? -0.45 : 0.75;
    const t1 = k === 0 ? 0.95 : 1.65;
    const len = (0.12 - k * 0.015) * sc * size;
    const geo = arcSheet(rr, t0, t1, len, 0.006 * sc, sx, 6, 2, 0.1);
    const m = new THREE.Matrix4().makeTranslation(cx, cy - k * 0.012 * sc, sh[2] - 0.006 * sc);
    put(ctx, geo, { bone: `upperarm_${side}`, color: o.iron, mat: RUST, matrix: m, colorFn: col });
    const th = k === 0 ? [-0.15, 0.4, 0.85] : [1.0, 1.45];
    for (const tt of th) for (const zz of [-0.04, 0.04]) pts.push([cx + sx * (rr + 0.007 * sc) * Math.sin(tt), cy - k * 0.012 * sc + (rr + 0.007 * sc) * Math.cos(tt), sh[2] - 0.006 * sc + zz * sc * size * 1.2]);
  }
  const st = studs(pts, 0.0052 * sc);
  if (st) put(ctx, st, { bone: `upperarm_${side}`, color: 0x9a8a72, mat: RUST, small: true });
}

/**
 * Gundabad's shoulder armour: four or five overlapping flat leaf layers with jagged free edges
 * stepping down the arm over the deltoid, dark grey-brown iron with rust only in patches, and a
 * crown of spikes. Seated on top of and slightly behind the shoulder joint, so in profile it stays
 * behind the jaw line.
 */
const IRON_DARK = surface('iron_rusty', { rough: 0.9, metal: 0.55 });
export function leafPauldron(ctx: KindContext, side: 'l' | 'r', o: { iron: number; rust: number; rng: Rng; size?: number; layers?: number; spikes?: number }) {
  const { P } = ctx;
  const sc = P.s;
  const sx = side === 'l' ? 1 : -1;
  const sh = P.j[`upperarm_${side}`];
  const L = P.hand.l.L;
  const size = o.size ?? 1;
  const g = Math.sqrt(P.build.bulk);
  const cx = sh[0] + sx * (L.x * 0.03 + 0.05 * size) * sc;
  const cy = sh[1] + L.y * 0.03 * sc - 0.022 * sc;
  const zc = sh[2] - 0.022 * sc;
  const R = (0.052 * g * size + 0.026) * sc;
  const col = rustFn(o.iron, o.rust, 0x8a7a64, 0.62);
  const layers = o.layers ?? 5;
  const spikeN = o.spikes ?? 7;
  const rimPts: V3[] = [];
  for (let k = 0; k < layers; k++) {
    const rr = R + k * 0.011 * sc;
    const t0 = -0.55 + k * 0.62;
    const t1 = t0 + 1.0 + k * 0.05;
    const len = (0.19 - k * 0.012) * sc * size;
    const geo = arcSheet(rr, t0, t1, len, 0.008 * sc, sx, 5, 4, 0.28);
    const m = new THREE.Matrix4().makeTranslation(cx, cy - k * 0.026 * sc, zc);
    put(ctx, geo, { bone: `upperarm_${side}`, color: o.iron, mat: IRON_DARK, matrix: m, colorFn: col });
    if (k < 3) for (const tt of [t0 + 0.25, t0 + 0.7]) for (const zz of [-0.07, 0.0, 0.07]) rimPts.push([cx + sx * (rr + 0.009 * sc) * Math.sin(tt), cy - k * 0.026 * sc + (rr + 0.009 * sc) * Math.cos(tt), zc + zz * sc * size]);
  }
  const st = studs(rimPts, 0.0058 * sc);
  if (st) put(ctx, st, { bone: `upperarm_${side}`, color: 0x7a6a56, mat: RUST, small: true });
  // crown of spikes along the top ridge and the outer shoulder
  for (let i = 0; i < spikeN; i++) {
    const f = spikeN === 1 ? 0.5 : i / (spikeN - 1);
    const zz = (f - 0.5) * 0.17 * sc * size;
    const th = 0.05 + 0.6 * ((i % 3) / 2) + (i % 2 ? 0.2 : 0);
    const rb = R + 0.006 * sc;
    const nx = sx * Math.sin(th), ny = Math.cos(th);
    put(ctx, spike([cx + nx * rb, cy + ny * rb, zc + zz], [nx * 0.9, ny + 0.4, (f - 0.5) * 0.5], (0.05 + o.rng.float() * 0.035) * sc * size, 0.0125 * sc, 4), { bone: `upperarm_${side}`, color: shade(o.iron, 0.9), mat: IRON_DARK, small: true });
  }
}

/** a snapshot of the sculpt for placing rigid fittings (build it at the END of the extras) */
export function orcProjector(ctx: KindContext, wide = 0.45): Projector | null {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  return makeProjector(s, { min: [-wide * sc, 0.0, -0.4 * sc], max: [wide * sc, P.j.neck[1] + 0.12 * sc, 0.45 * sc] });
}

/** spiked iron greaves strapped over the shin wraps: a curved front plate, a rim and leafy spikes */
export function greaves(ctx: KindContext, proj: Projector, o: { iron: number; rust: number; rng: Rng; top: number; bottom: number; spikes?: number; size?: number; knee?: boolean }) {
  const { P } = ctx;
  const sc = P.s;
  const hp = V(), hn = V();
  const col = rustFn(o.iron, o.rust, 0xa89a82);
  for (const sd of ['l', 'r'] as const) {
    const k = P.j[`shin_${sd}`];
    const f = P.j[`foot_${sd}`];
    const ymid = (o.top + o.bottom) / 2;
    const cx = k[0] + (f[0] - k[0]) * ((k[1] - ymid) / Math.max(0.01, k[1] - f[1]));
    if (!snapPoint(proj, [cx, ymid, 0.5 * sc], 'f', hp, hn)) continue;
    const R = 0.066 * sc * (o.size ?? 1);
    // dark kneepad with a spike over the knee joint
    if (o.knee) {
      const kp = V(), kn = V();
      if (snapPoint(proj, [k[0], k[1] + 0.005 * sc, 0.5 * sc], 'f', kp, kn)) {
        const dome = new THREE.SphereGeometry(0.052 * sc * (o.size ?? 1), 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
        put(ctx, dome, { bone: `shin_${sd}`, color: shade(o.iron, 0.8), mat: IRON_DARK, matrix: new THREE.Matrix4().makeTranslation(kp.x, kp.y, kp.z - 0.012 * sc), colorFn: col });
        put(ctx, spike([kp.x, kp.y, kp.z + 0.032 * sc * (o.size ?? 1)], [0, 0.15, 1], 0.055 * sc, 0.013 * sc, 4), { bone: `shin_${sd}`, color: shade(o.iron, 0.9), mat: IRON_DARK, small: true });
      }
    }
    const h = o.top - o.bottom;
    const geo = new THREE.CylinderGeometry(R * 1.12, R * 0.86, h, 9, 1, true, -1.05, 2.1);
    // two layers (outer facing out, inner facing in)
    const inner = geo.clone();
    const ia = inner.index!;
    for (let i = 0; i < ia.count; i += 3) {
      const b = ia.getY(i);
      ia.setY(i, ia.getZ(i));
      ia.setZ(i, b);
    }
    const plate = mergeLayers([geo, scaleGeo(inner, 0.94)]);
    const m = new THREE.Matrix4().makeTranslation(hp.x + hn.x * 0.004 * sc, ymid, hp.z - R * 0.95 + hn.z * 0.004 * sc);
    put(ctx, plate, { bone: `shin_${sd}`, color: o.iron, mat: IRON_DARK, matrix: m, colorFn: col });
    // rim and leaf spikes down the front
    const n = o.spikes ?? 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = o.top - h * t;
      const ang = (i % 2 ? 0.45 : -0.45) * (o.size ?? 1);
      const base: V3 = [hp.x + Math.sin(ang) * R * 0.9, y, hp.z - R * 0.95 + Math.cos(ang) * R * 1.0 + 0.004 * sc];
      put(ctx, spike(base, [Math.sin(ang) * 0.8, 0.35, 1.0], (0.04 + o.rng.float() * 0.025) * sc, 0.011 * sc, 4), { bone: `shin_${sd}`, color: shade(o.iron, 0.8), mat: RUST, small: true });
    }
  }
}

function scaleGeo(g: THREE.BufferGeometry, k: number) {
  return g.scale(k, 1, k);
}
function mergeLayers(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = list.map((g) => g.toNonIndexed());
  const pos: number[] = [];
  for (const g of ni) pos.push(...Array.from(g.attributes.position.array as ArrayLike<number>));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/** short leather-and-iron spikes along the outside of each forearm (spiked bracers) */
export function armSpikes(ctx: KindContext, proj: Projector, o: { iron: number; count: number; from: number; to: number; len: number }) {
  const { P } = ctx;
  const sc = P.s;
  const hp = V(), hn = V();
  for (const sd of ['l', 'r'] as const) {
    const el = P.j[`forearm_${sd}`];
    const wr = P.j[`hand_${sd}`];
    for (let i = 0; i < o.count; i++) {
      const t = o.from + (o.to - o.from) * (o.count === 1 ? 0.5 : i / (o.count - 1));
      const q: V3 = [el[0] + (wr[0] - el[0]) * t, el[1] + (wr[1] - el[1]) * t, el[2]];
      if (!snapPoint(proj, q, sd === 'l' ? 'l' : 'r', hp, hn)) continue;
      put(ctx, spike([hp.x, hp.y, hp.z], [hn.x, hn.y + 0.15, hn.z], o.len * sc * (0.8 + 0.4 * ((i * 7) % 3) / 2), 0.0085 * sc, 4), { bone: `forearm_${sd}`, color: o.iron, mat: RUST, small: true });
    }
  }
}

export interface GearOpts {
  rng: Rng;
  /** belt heights (m): the upper wide belt and the lower belt that hides the kilt's top edge */
  beltY: number;
  lowerBeltY: number;
  /** rigid pieces use these colours */
  cord: number;
  leather: number;
  iron: number;
  rust: number;
  shinTop: number;
  shinBottom: number;
  bracerLen: number;
  /** baldric centre line (from strapBand) */
  strap?: { n: THREE.Vector3; c: number };
  plate?: boolean;
  proj?: Projector | null;
  /** hanging plate: x position (m at s=1) and size multiplier */
  plateX?: number;
  plateScale?: number;
  /** skip the shin cords / sleeve fringe (gundabad has greaves and bare arms) */
  noCords?: boolean;
  noFringe?: boolean;
  /** the tunic's sleeve length (fraction of the upper arm) and the colour of its torn edges */
  sleeve: number;
  tunicEdge: number;
  /** a third, middle belt band with its own hanging rings (height m) */
  midBeltY?: number;
  /** a torn fringe hanging from the cowl ring at the throat */
  collar?: boolean;
  /** expected surface radius of the shin wraps (m at s=1) and cord turns */
  shinR?: number;
  shinTurns?: number;
}

/**
 * Rigid details placed on the finished sculpt: cord spirals round the shin wraps and bracers, the
 * baldric's ring buckles and keeper, belt rings, and an iron plate hanging from the lower belt.
 * Build it at the END of the extras (the projector snapshots everything sculpted so far).
 */
export function orcFittings(ctx: KindContext, o: GearOpts) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const proj = o.proj ?? orcProjector(ctx);
  if (!proj) return;
  // ── cord spirals on the shin wraps
  for (const sd of o.noCords ? [] : (['l', 'r'] as const)) {
    const k = j[`shin_${sd}`];
    const f = j[`foot_${sd}`];
    const a: V3 = [f[0], o.shinBottom, f[2] + 0.004 * sc];
    const b: V3 = [k[0], o.shinTop, k[2] - 0.01 * sc];
    const g1 = helixCord(proj, a, b, { turns: o.shinTurns ?? 3.5, per: 8, radius: (o.shinR ?? 0.062) * sc, lift: 0.001 * sc, rad: 0.0058 * sc, phase: sd === 'l' ? 0.4 : 2.7 });
    if (g1) put(ctx, g1, { bone: `shin_${sd}`, color: o.cord, mat: STRAP, small: true });
  }
  // ── torn sleeve ends
  const Lh = P.hand.l.L;
  for (const sd of o.noFringe ? [] : (['l', 'r'] as const)) {
    const sx = sd === 'l' ? 1 : -1;
    const sh = j[`upperarm_${sd}`];
    const tt = P.upperArm * o.sleeve;
    const c: V3 = [sh[0] + sx * Lh.x * tt, sh[1] + Lh.y * tt, sh[2]];
    const ax = V(sx * Lh.x, Lh.y, 0).normalize();
    const g = fringe(proj, c, ax, { radius: 0.058 * sc, count: 11, len: 0.045 * sc, lift: 0.002 * sc, rng: o.rng });
    if (g) put(ctx, g, { bone: `upperarm_${sd}`, color: o.tunicEdge, mat: RAGS, small: true });
  }
  // ── torn fringe hanging from the cowl ring
  if (o.collar) {
    const g = fringe(proj, [0, j.neck[1] + 0.0, 0.008 * sc], V(0, -1, 0), { radius: 0.125 * sc * P.build.neckThick, count: 14, len: 0.034 * sc, lift: 0.002 * sc, rng: o.rng });
    if (g) put(ctx, g, { bone: 'chest', color: o.tunicEdge, mat: RAGS, small: true });
  }
  // ── ring buckles where the baldric crosses the chest and on the belts
  const hp = V(), hn = V();
  const ringAt = (x: number, y: number, r: number, tube: number, bone: string, along: THREE.Vector3, col: number) => {
    if (!snapPoint(proj, [x, y, 0.4 * sc], 'f', hp, hn)) return false;
    const m = placeAlong(hp.clone().addScaledVector(hn, tube * 0.8), hn, along);
    // torus lies in local XY by default; rotate so its face points along the surface normal
    const g = new THREE.TorusGeometry(r, tube, 5, 14).rotateX(Math.PI / 2);
    put(ctx, g, { bone, color: col, mat: RUST, matrix: m, small: true });
    return true;
  };
  if (o.strap) {
    const { n, c } = o.strap;
    const along = V(-n.y, n.x, 0).normalize();
    for (const [bx, r] of [[0.05, 0.0165], [-0.005, 0.0125]] as [number, number][]) {
      const x = bx * sc;
      const y = (c - n.x * x) / n.y;
      if (!snapPoint(proj, [x, y, 0.4 * sc], 'f', hp, hn)) continue;
      const m = placeAlong(hp.clone().addScaledVector(hn, 0.002 * sc), hn, along);
      const g = new THREE.TorusGeometry(r * sc, 0.0036 * sc, 5, 14).rotateX(Math.PI / 2);
      put(ctx, g, { bone: 'chest', color: o.iron, mat: RUST, matrix: m, small: true });
      const bar = new THREE.CylinderGeometry(0.0026 * sc, 0.0026 * sc, r * 1.9 * sc, 5).rotateZ(Math.PI / 2);
      put(ctx, bar, { bone: 'chest', color: o.iron, mat: RUST, matrix: m, small: true });
      const keeper = new THREE.BoxGeometry(0.05 * sc, 0.004 * sc, 0.016 * sc).translate(0, 0.002 * sc, 0.03 * sc);
      put(ctx, keeper, { bone: 'chest', color: shade(o.leather, 0.75), mat: STRAP, matrix: m, small: true });
    }
  }
  // belt rings (centre-left and a hanging one on the character's left)
  ringAt(-0.045 * sc, o.lowerBeltY, 0.02 * sc, 0.0036 * sc, 'hips', V(1, 0, 0), o.iron);
  if (o.midBeltY !== undefined) {
    ringAt(0.07 * sc, o.midBeltY, 0.016 * sc, 0.003 * sc, 'hips', V(1, 0, 0), o.iron);
    ringAt(-0.11 * sc, o.midBeltY, 0.014 * sc, 0.003 * sc, 'hips', V(1, 0, 0), o.iron);
  }
  if (o.plate) {
    // an iron plate hanging from the lower belt at the front left, on a ring
    const px = (o.plateX ?? 0.12) * sc;
    const ps = o.plateScale ?? 1;
    if (snapPoint(proj, [px, o.lowerBeltY, 0.5 * sc], 'f', hp, hn)) {
      const nrm = hn.clone();
      const base = hp.clone().addScaledVector(nrm, 0.016 * sc);
      base.y -= 0.045 * sc * ps;
      const m = frameAt(base, nrm, V(0, 1, 0));
      const plate = new THREE.BoxGeometry(0.07 * sc * ps, 0.09 * sc * ps, 0.007 * sc);
      // a clipped lower corner
      const pos = plate.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0 && pos.getX(i) < 0) pos.setY(i, pos.getY(i) + 0.03 * sc);
      plate.computeVertexNormals();
      put(ctx, plate, { bone: 'hips', color: o.rust, mat: RUST, matrix: m, small: true });
      const pts: V3[] = [];
      for (const [px, py] of [[-0.024, 0.026], [0.024, 0.026], [0.024, -0.03], [-0.024, -0.01]] as [number, number][]) pts.push([px * sc, py * sc, 0.006 * sc]);
      const st = studs(pts, 0.0048 * sc);
      if (st) put(ctx, st, { bone: 'hips', color: o.iron, mat: RUST, matrix: m, small: true });
      ringAt(px, o.lowerBeltY - 0.005 * sc, 0.018 * sc, 0.0034 * sc, 'hips', V(1, 0, 0), o.iron);
    }
  }
}

/**
 * A dark under-layer of cloth over the thighs and hips (the inner layer of a two-layer kilt): the
 * kilt's panels leave gaps and the hem lifts when the legs swing, and this stops pale skin showing
 * through. It follows the thigh bones, so it moves with the legs.
 */
export function thighCloth(ctx: KindContext, o: { color: number; color2: number; bottom: number; top: number; inflate: number; mat?: SurfaceSpec }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const parts = anatomyParts(P);
  s.group('union', 0.004 * sc, () => {
    emitParts(s, parts, ['pelvis', 'glutes', 'thigh'], { color: o.color, color2: o.color2, colorNoise: 0.5, colorFreq: 22 / sc, mat: o.mat ?? RAGS, inflate: o.inflate, noise: { amp: 0.003 * sc, freq: 30 / sc, type: 'ridged' } });
    slab(s, o.bottom, o.top, 0.008 * sc);
  });
}
