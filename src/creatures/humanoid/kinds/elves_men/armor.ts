/**
 * Rigid armour for the elves_men kinds: leaf-scale and fluted elven cuirasses, lamed pauldrons and
 * vambraces, helmets (Galadhrim, Rohan, Gondor, iron caps), crowns, plumes. Everything is plain
 * geometry in model space handed to the kit's gear sink (merged into the body draw call).
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import { surface, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import type { Proportions } from '../../proportions';
import type { KindContext } from '../../types';
import { along, arcPlate, instances, lathe, leaf, mat4, mergeAll, put, ring, shell, spike, studs, taperedTube, torsoPoint, torsoSection, torsoShell, tube } from './geo';
import { mix, shade } from './common';

export const GOLD_LEAF = surface('gold', { rough: 0.36, pat: { scales: 1.5, scratches: 0.35 } });
export const BRONZE_LEAF = surface('gold', { rough: 0.45, pat: { scales: 1.6, scratches: 0.5 } });
export const POLISHED = surface('metal', { rough: 0.26, pat: { scratches: 0.7 } });
export const STEEL = surface('metal', { rough: 0.34, pat: { scratches: 1.1 } });
export const DARK_STEEL = surface('metal_dark', { rough: 0.42, pat: { scratches: 1.1 } });

// ─────────────────────────────────────────────────────────────────────────────
// Limb plates: lames wrapped round an arm or leg
// ─────────────────────────────────────────────────────────────────────────────

/** a curved plate wrapped round an axis: radius r, height h along `axis`, covering `arc` radians centred on `facing` */
export function lame(pos: V3, axis: V3, facing: V3, r: number, h: number, arc: number, seg = 8, flare = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * (1 + flare), r, h, seg, 1, true, -arc / 2, arc);
  g.applyMatrix4(along(pos, axis, facing));
  return g;
}

/** layered shoulder lames sliding down the upper arm, with a rounded cap; leafy = pointed lames */
export function pauldrons(ctx: KindContext, o: { color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; lames?: number; size?: number; cap?: boolean; sides?: ('l' | 'r')[]; spikeLen?: number; scale?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  const n = o.lames ?? 3;
  const trim = o.trim ?? o.color;
  const L = P.hand.l.L;
  for (const side of o.sides ?? (['l', 'r'] as const)) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    const axis: V3 = [sx * L.x, L.y, L.z];
    const bone = `upperarm_${side}`;
    // facing: up and outward from the arm
    const facing: V3 = [sx * 0.85, 0.75, 0.0];
    for (let k = 0; k < n; k++) {
      const t = 0.02 + k * 0.058;
      const rr = (0.062 + 0.002 * k) * s * g * (o.size ?? 1) + 0.014 * s;
      const pos: V3 = [sh[0] + axis[0] * t * s * 1.0, sh[1] + axis[1] * t * s * 1.0 + 0.004 * s, sh[2]];
      const lm = lame(pos, axis, facing, rr, 0.085 * s * (o.size ?? 1), Math.PI * (1.15 - k * 0.04), 9, 0.04);
      put(ctx, lm, { bone, color: o.color, mat: o.mat ?? 'metal', ao: 0.95 });
      // bright edge trim along the lower rim of the outermost lame
      if (k === n - 1) {
        const rim = new THREE.TorusGeometry(rr * 1.02, 0.0042 * s, 3, 8, Math.PI * (1.15 - k * 0.04)).rotateX(Math.PI / 2).rotateY(Math.PI / 2 + Math.PI * (1.15 - k * 0.04) / 2);
        rim.applyMatrix4(along([pos[0] + axis[0] * 0.04 * s, pos[1] + axis[1] * 0.04 * s, pos[2]], axis, facing));
        put(ctx, rim, { bone, color: trim, mat: o.trimMat ?? 'gold', small: true });
      }
    }
    if (o.cap !== false) {
      const R = 0.066 * s * g * (o.size ?? 1) + 0.012 * s;
      const cap = shell(R, R * 0.8, R * 1.05, { th0: 0, th1: Math.PI * 0.48, w: 10, h: 4 });
      const m = new THREE.Matrix4().makeTranslation(sh[0] + sx * 0.008 * s, sh[1] + 0.02 * s, sh[2]).multiply(new THREE.Matrix4().makeRotationZ(-sx * 0.45));
      put(ctx, cap, { bone, color: o.color, mat: o.mat ?? 'metal', matrix: m });
    }
    if (o.spikeLen) put(ctx, spike([sh[0] + sx * 0.05 * s, sh[1] + 0.07 * s, sh[2]], [sx * 0.4, 1, 0], o.spikeLen * s, 0.012 * s, 6), { bone, color: trim, mat: o.trimMat ?? 'gold', small: true });
  }
}

/** a vambrace (forearm) or greave (shin): two plates wrapped round the limb with a flared cuff and trim rings */
export function limbGuards(ctx: KindContext, o: { kind: 'vambrace' | 'greave'; color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; length?: number; leafy?: boolean; /** extra radius (m, scaled) when worn over thick sleeves */ grow?: number }) {
  const { P } = ctx;
  const s = P.s;
  const g = P.build.bulk;
  const trim = o.trim ?? o.color;
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const a = o.kind === 'vambrace' ? P.j[`forearm_${side}`] : P.j[`shin_${side}`];
    const b = o.kind === 'vambrace' ? P.j[`hand_${side}`] : P.j[`foot_${side}`];
    const dir: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...dir);
    const bone = o.kind === 'vambrace' ? `forearm_${side}` : `shin_${side}`;
    const facing: V3 = o.kind === 'vambrace' ? [sx * 0.2, 0.2, 0.95] : [0, 0, 1];
    const r0 = (o.kind === 'vambrace' ? 0.04 : 0.056) * s * g + (o.grow ?? 0);
    const l = (o.length ?? 0.62) * len;
    const mid: V3 = [a[0] + dir[0] * 0.55, a[1] + dir[1] * 0.55, a[2] + dir[2] * 0.55];
    const up: V3 = [-dir[0], -dir[1], -dir[2]];
    const lm = lame(mid, up, facing, r0 + 0.011 * s, l, Math.PI * 1.25, 9, 0.0);
    // taper: wider at the elbow/knee end
    const pos = lm.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).sub(new THREE.Vector3(...mid));
      const t = v.dot(new THREE.Vector3(...up).normalize()) / l + 0.5; // 0 at wrist/ankle, 1 at elbow/knee
      const f = 0.84 + 0.2 * t;
      const c = new THREE.Vector3(...mid).addScaledVector(new THREE.Vector3(...up).normalize(), (t - 0.5) * l);
      const w = new THREE.Vector3().fromBufferAttribute(pos, i).sub(c).multiplyScalar(f).add(c);
      pos.setXYZ(i, w.x, w.y, w.z);
    }
    lm.computeVertexNormals();
    put(ctx, lm, { bone, color: o.color, mat: o.mat ?? 'metal' });
    for (const t of [0.12]) {
      const p: V3 = [a[0] + dir[0] * (0.55 + (t - 0.5) * (o.length ?? 0.62)), a[1] + dir[1] * (0.55 + (t - 0.5) * (o.length ?? 0.62)), a[2] + dir[2] * (0.55 + (t - 0.5) * (o.length ?? 0.62))];
      const rr = (r0 + 0.011 * s) * (0.84 + 0.2 * (1 - t));
      put(ctx, ring(p, up, rr, 0.0036 * s, 9, 3), { bone, color: trim, mat: o.trimMat ?? 'gold', small: true });
    }
    if (o.leafy) {
      // leaf motif on the outer face
      const lf = leaf(0.05 * s, 0.014 * s, { droop: 0.05, cup: 0.4 });
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < 2; i++) {
        const tt = 0.5 + (i - 0.5) * 0.28;
        const pp: V3 = [a[0] + dir[0] * tt, a[1] + dir[1] * tt, a[2] + dir[2] * tt];
        const fw = new THREE.Vector3(...facing).normalize();
        mats.push(along([pp[0] + fw.x * (r0 + 0.012 * s), pp[1] + fw.y * (r0 + 0.012 * s), pp[2] + fw.z * (r0 + 0.012 * s)], [-up[0], -up[1], -up[2]], facing));
      }
      put(ctx, instances(lf, mats), { bone, color: trim, mat: o.trimMat ?? 'gold', small: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Elven body armour
// ─────────────────────────────────────────────────────────────────────────────

export interface CuirassOpts {
  color: number;
  trim: number;
  mat?: SurfaceName | SurfaceSpec;
  trimMat?: SurfaceName | SurfaceSpec;
  /** include the back plate */
  back?: boolean;
  /** waist and chest heights (m above the chest joint): defaults suit a standing torso */
  y0?: number;
  y1?: number;
}

/** Mirkwood guard armour: a smooth gold-bronze breastplate patterned with overlapping leaves, a fringe of hanging leaves at the hips and a leaf collar */
export function leafCuirass(ctx: KindContext, o: CuirassOpts) {
  const { P } = ctx;
  const s = P.s;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const y0 = j.chest[1] - 0.055 * s + (o.y0 ?? 0);
  const y1 = j.neck[1] - 0.012 * s + (o.y1 ?? 0);
  const mat = o.mat ?? GOLD_LEAF;
  const tm = o.trimMat ?? 'gold';
  // breastplate: a V-edged shell over the ribs and chest
  const front = torsoShell(P, {
    y0,
    y1,
    a0: -1.28,
    a1: 1.28,
    off: 0.024 * s,
    nA: 16,
    nY: 6,
    edge0: (f) => 0.05 * s * Math.pow(Math.abs(f - 0.5) * 2, 1.4) * -1 - 0.01 * s,
    edge1: (f) => -0.008 * s * Math.abs(f - 0.5) * 2,
    power: 2.6,
  });
  put(ctx, front, { bone: 'chest', color: o.color, mat });
  if (o.back !== false) put(ctx, torsoShell(P, { y0, y1: y1 - 0.01 * s, a0: Math.PI - 1.15, a1: Math.PI + 1.15, off: 0.022 * s, nA: 8, nY: 4, power: 2.6 }), { bone: 'chest', color: shade(o.color, 0.92), mat, small: true });
  // overlapping leaves: rows hanging from a central spine, fanning outward (pattern of the Mirkwood guard)
  const lf = leaf(0.07 * s, 0.021 * s, { droop: 0.2, cup: 0.3, rows: 3 });
  const mats: THREE.Matrix4[] = [];
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = y1 - 0.045 * s - r * 0.052 * s;
    const n = r === 0 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      const a = f * 1.7;
      const p = torsoPoint(P, a, y, 0.027 * s);
      const nrm = torsoNormal2(P, a, y);
      // leaf points down and slightly outward
      mats.push(along(p, [f * 0.5, -1, 0.05], [nrm[0], 0.2, nrm[2]], 1));
    }
  }
  put(ctx, instances(lf, mats), { bone: 'chest', color: o.trim, mat: tm, small: true });
  // central ridge
  const ridge: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const y = y1 - 0.005 * s - ((y1 - y0) * i) / 8;
    ridge.push(torsoPoint(P, 0, y, 0.027 * s));
  }
  put(ctx, tube(ridge, 0.0034 * s, { seg: 8, radial: 3 }), { bone: 'chest', color: o.trim, mat: tm, small: true });
  // hanging leaves over the hips (a fringe of lames)
  const fringe = leaf(0.115 * s, 0.032 * s, { droop: 0.12, cup: 0.35, rows: 3 });
  const fm: THREE.Matrix4[] = [];
  const nF = 10;
  const yF = hipY + 0.095 * s;
  for (let i = 0; i < nF; i++) {
    const a = -Math.PI * 0.92 + (i / (nF - 1)) * Math.PI * 1.84 + Math.PI / nF * 0;
    // skip a gap at the very back (the cloak/quiver hang there)
    const p = torsoPoint(P, a, yF, 0.034 * s);
    const nrm = torsoNormal2(P, a, yF);
    fm.push(along(p, [nrm[0] * 0.16, -1, nrm[2] * 0.16], [nrm[0], 0.1, nrm[2]], 1));
  }
  put(ctx, instances(fringe, fm), { bone: 'hips', color: o.color, mat });
  // belt line
  const bandPts: V3[] = [];
  for (let i = 0; i <= 28; i++) bandPts.push(torsoPoint(P, -Math.PI + (i / 28) * Math.PI * 2, yF + 0.004 * s, 0.03 * s));
  put(ctx, tube(bandPts, 0.0055 * s, { seg: 20, radial: 3, closed: true }), { bone: 'hips', color: o.trim, mat: tm, small: true });
  // collar of leaves around the neck base
  const col = leaf(0.06 * s, 0.022 * s, { droop: 0.55, cup: 0.4, rows: 2 });
  const cm: THREE.Matrix4[] = [];
  const nC = 11;
  for (let i = 0; i < nC; i++) {
    const a = -Math.PI * 0.82 + (i / (nC - 1)) * Math.PI * 1.64;
    const ny = j.neck[1] - 0.024 * s;
    const rx = (0.074 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.032) * s;
    const p: V3 = [Math.sin(a) * rx * 1.12, ny, -0.012 * s + Math.cos(a) * rx * 1.05];
    cm.push(along(p, [Math.sin(a) * 0.95, 0.35, Math.cos(a) * 0.95], [Math.sin(a) * 0.3, 1, Math.cos(a) * 0.3], 1));
  }
  put(ctx, instances(col, cm), { bone: 'chest', color: o.color, mat, small: true });
}

/** outward horizontal normal of the torso at (angle, y) */
function torsoNormal2(P: Proportions, a: number, y: number): V3 {
  const p0 = torsoPoint(P, a, y, 0);
  const p1 = torsoPoint(P, a, y, 0.05);
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, 0, dz / l];
}

/** Galadhrim armour: a fluted golden cuirass with a raised centre ridge, laminated waist and flared collar */
export function flutedCuirass(ctx: KindContext, o: CuirassOpts & { flutes?: number }) {
  const { P } = ctx;
  const s = P.s;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const y0 = j.chest[1] - 0.075 * s;
  const y1 = j.neck[1] - 0.012 * s;
  const mat = o.mat ?? POLISHED;
  const tm = o.trimMat ?? 'gold';
  const flutes = o.flutes ?? 9;
  const front = torsoShell(P, {
    y0,
    y1,
    a0: -1.32,
    a1: 1.32,
    off: 0.024 * s,
    nA: 24,
    nY: 6,
    edge0: (f) => -0.045 * s * Math.pow(1 - Math.abs(f - 0.5) * 2, 1.5),
    power: 2.7,
    ripple: (a) => 0.0034 * s * Math.cos(a * flutes * 1.1),
  });
  put(ctx, front, { bone: 'chest', color: o.color, mat });
  put(ctx, torsoShell(P, { y0, y1: y1 - 0.012 * s, a0: Math.PI - 1.2, a1: Math.PI + 1.2, off: 0.022 * s, nA: 10, nY: 4, power: 2.7 }), { bone: 'chest', color: shade(o.color, 0.94), mat, small: true });
  // raised centre ridge and trim lines along the plate edge
  const ridge: V3[] = [];
  for (let i = 0; i <= 10; i++) ridge.push(torsoPoint(P, 0, y1 - 0.01 * s - ((y1 - y0) * i) / 10, 0.03 * s));
  put(ctx, tube(ridge, 0.0042 * s, { seg: 10, radial: 3 }), { bone: 'chest', color: o.trim, mat: tm, small: true });
  const edge: V3[] = [];
  for (let i = 0; i <= 22; i++) {
    const f = i / 22;
    const a = -1.3 + f * 2.6;
    const y = y0 - 0.0 - 0.045 * s * Math.pow(1 - Math.abs(f - 0.5) * 2, 1.5);
    edge.push(torsoPoint(P, a, y + 0.002 * s, 0.027 * s));
  }
  put(ctx, tube(edge, 0.0034 * s, { seg: 18, radial: 3 }), { bone: 'chest', color: o.trim, mat: tm, small: true });
  // laminated waist: stacked bands (a "plate skirt")
  for (let k = 0; k < 2; k++) {
    const y = hipY + (0.15 - k * 0.055) * s;
    const band = torsoShell(P, { y0: y - 0.035 * s, y1: y + 0.01 * s, a0: -Math.PI, a1: Math.PI, off: (0.028 + k * 0.007) * s, nA: 20, nY: 1, power: 2.4, flare: (f) => 1 + (1 - f) * 0.04 + k * 0.01 });
    put(ctx, band, { bone: k === 0 ? 'spine' : 'hips', color: k % 2 ? o.color : shade(o.color, 0.96), mat, small: k > 0 });
    const lip: V3[] = [];
    for (let i = 0; i <= 28; i++) lip.push(torsoPoint(P, -Math.PI + (i / 28) * Math.PI * 2, y - 0.034 * s, (0.029 + k * 0.007) * s));
    if (k === 1) put(ctx, tube(lip, 0.0028 * s, { seg: 20, radial: 3, closed: true }), { bone: 'hips', color: o.trim, mat: tm, small: true });
  }
  // flared collar (gorget)
  const R = (0.072 * P.build.neckThick * Math.sqrt(P.build.bulk) + 0.022) * s;
  const gorget = lathe([[R, 0.05 * s], [R * 1.04, 0.025 * s], [R * 1.3, -0.012 * s], [R * 1.55, -0.03 * s]], 14).scale(1.12, 1, 1.0);
  put(ctx, gorget, { bone: 'chest', color: o.color, mat, matrix: new THREE.Matrix4().makeTranslation(0, j.neck[1] - 0.006 * s, -0.012 * s) });
  put(ctx, ring([0, j.neck[1] - 0.04 * s, -0.012 * s], [0, 1, 0], R * 1.5, 0.0045 * s, 14, 3), { bone: 'chest', color: o.trim, mat: tm, small: true });
}

/** a belt hardware buckle plate with a leaf motif */
export function leafBuckle(ctx: KindContext, o: { y: number; color: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const s = P.s;
  const z = torsoSection(P, o.y).zf + 0.02 * s;
  const lf = leaf(0.045 * s, 0.016 * s, { droop: 0, cup: 0.2, rib: 0.4 });
  const m1 = along([-0.0, o.y - 0.02 * s, z], [0, 1, 0], [0, 0, 1]);
  const m2 = along([0, o.y + 0.02 * s, z], [0, -1, 0], [0, 0, 1]);
  put(ctx, instances(lf, [m1, m2]), { bone: 'hips', color: o.color, mat: o.mat ?? 'gold', small: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helmets, crowns and plumes
// ─────────────────────────────────────────────────────────────────────────────

/** head half-width (head units) at height y, for plates that follow the skull and cheeks */
function headHalfWidth(y: number): number {
  if (y >= 0) return 0.33 - 0.12 * Math.min(1, y / 0.45) ** 2;
  if (y > -0.15) return 0.33 - (0.02 * -y) / 0.15;
  if (y > -0.3) return 0.31 - 0.05 * ((-y - 0.15) / 0.15);
  return Math.max(0.12, 0.26 - 0.2 * ((-y - 0.3) / 0.2));
}

/**
 * A plate on the side of the head (cheek guards, ear flaps): grid over (y, z) in head units, x
 * from the skull surface plus `off`. `outline` shapes the plate: returns [zmin, zmax] for each y fraction.
 */
export function sidePlate(P: Proportions, sx: 1 | -1, o: { y0: number; y1: number; z0: number; z1: number; off: number; nY?: number; nZ?: number; outline?: (fy: number) => [number, number]; flare?: number }): THREE.BufferGeometry {
  const nY = o.nY ?? 5;
  const nZ = o.nZ ?? 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nY; j++) {
    const fy = j / nY;
    const y = o.y0 + (o.y1 - o.y0) * fy;
    const [zmin, zmax] = o.outline ? o.outline(fy) : [o.z0, o.z1];
    for (let i = 0; i <= nZ; i++) {
      const z = zmin + (zmax - zmin) * (i / nZ);
      const k = Math.sqrt(Math.max(0.2, 1 - ((z + 0.02) / 0.52) ** 2));
      const x = sx * (headHalfWidth(y) * k + o.off + (o.flare ?? 0) * (1 - fy));
      const p = P.h(x, y, z);
      pos.push(p[0], p[1], p[2]);
    }
  }
  for (let j = 0; j < nY; j++)
    for (let i = 0; i < nZ; i++) {
      const a = j * (nZ + 1) + i;
      const b = a + nZ + 1;
      if (sx > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface DomeOpts {
  color: number;
  trim?: number;
  mat?: SurfaceName | SurfaceSpec;
  trimMat?: SurfaceName | SurfaceSpec;
  /** dome height multiplier (1 = round skull cap) */
  tall?: number;
  /** rim height at the brow (head units, 0 = brow level) */
  rim?: number;
  /** extra tilt: positive lifts the front */
  tilt?: number;
  /** dome shape: 0 round … 1 pointed */
  point?: number;
  /** radial clearance beyond the skull (head units) */
  clear?: number;
  /** nape drop (head units): the back of the rim hangs lower */
  nape?: number;
  segs?: number;
}

const DOME_BASE = { cx: 0, cy: 0.05, cz: -0.06, rx: 0.322, ry: 0.4, rz: 0.43 };

/** the helmet dome (and rim band): an ellipsoid shell over the skull cut at the rim, in model space */
export function helmDome(ctx: KindContext, o: DomeOpts) {
  const { P } = ctx;
  const u = P.headH;
  const clear = o.clear ?? 0.045;
  const tall = o.tall ?? 1;
  const point = o.point ?? 0;
  const rim = o.rim ?? 0.08;
  const nape = o.nape ?? 0.2;
  const rx = DOME_BASE.rx + clear;
  const rz = DOME_BASE.rz + clear;
  const ry = (DOME_BASE.ry + clear) * tall;
  const segs = o.segs ?? 16;
  // build as a lathe-like grid so the rim can slope (high at the brow, low at the nape)
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const cy = DOME_BASE.cy;
  const tilt = o.tilt ?? 0;
  for (let j = 0; j <= rows; j++) {
    const fj = j / rows;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2; // 0 = front, π = back
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      // rim height at this azimuth: brow height in front, lower toward the back
      const back = (1 - ca) / 2;
      const rimY = rim - nape * back - tilt * ca * 0.2;
      // polar angle from the crown down to the rim
      const cosRim = Math.max(-0.95, Math.min(0.999, (rimY - cy) / ry));
      const thMax = Math.acos(cosRim);
      const th = fj * thMax;
      let rr = Math.sin(th);
      let yy = Math.cos(th);
      // pointed crown: pull the top into a point
      const pk = point * Math.pow(Math.max(0, 1 - th / 0.9), 2);
      yy += pk * 0.35;
      rr *= 1 - pk * 0.15;
      const x = sa * rx * rr;
      const z = DOME_BASE.cz + ca * rz * rr;
      const y = cy + ry * yy;
      const q = P.h(x, y, z);
      pos.push(q[0], q[1], q[2]);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? 'metal', ao: 0.95 });
  // rim band: a thin torus-like strip following the sloped rim
  const band: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const back = (1 - ca) / 2;
    const rimY = rim - nape * back - tilt * ca * 0.2;
    const cosRim = Math.max(-0.95, Math.min(0.999, (rimY - cy) / ry));
    const rr = Math.sin(Math.acos(cosRim));
    band.push(P.h(sa * rx * rr * 1.01, rimY - 0.003, DOME_BASE.cz + ca * rz * rr * 1.01));
  }
  put(ctx, tube(band, 0.0075 * u, { seg: segs, radial: 3, closed: true }), { bone: 'head', color: o.trim ?? o.color, mat: o.trimMat ?? o.mat ?? 'metal', small: true });
  return { rx, rz, ry, rim, nape };
}

/** crown point of the dome at azimuth a (0 front), height fraction along the meridian, in head units (for attaching crests) */
export function domePoint(o: { tall?: number; clear?: number; point?: number }, a: number, th: number): V3 {
  const clear = o.clear ?? 0.045;
  const ry = (DOME_BASE.ry + clear) * (o.tall ?? 1);
  const rr = Math.sin(th);
  return [Math.sin(a) * (DOME_BASE.rx + clear) * rr, DOME_BASE.cy + ry * Math.cos(th) + (o.point ?? 0) * Math.pow(Math.max(0, 1 - th / 0.9), 2) * 0.35, DOME_BASE.cz + Math.cos(a) * (DOME_BASE.rz + clear) * rr];
}

/** a nasal bar: from the brow down the nose */
export function nasalGuard(ctx: KindContext, o: { color: number; mat?: SurfaceName | SurfaceSpec; width?: number; length?: number; wide?: number; z?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const len = o.length ?? 0.34;
  const w = (o.width ?? 0.028) * u;
  const z = o.z ?? 0.485;
  const pts: V3[] = [P.h(0, 0.1, 0.45), P.h(0, -0.02, z - 0.02), P.h(0, -0.14, z), P.h(0, 0.1 - len, z - 0.01 + 0.0)];
  const g = taperedTube(pts, w, w * (o.wide ?? 0.8), { seg: 10, radial: 3 });
  g.scale(1, 1, 1);
  put(ctx, g, { bone: 'head', color: o.color, mat: o.mat ?? 'metal', small: true });
}

/** a horsehair / feather plume streaming back from a crest */
export function plume(ctx: KindContext, o: { color: number; color2?: number; from: V3; length?: number; spread?: number; n?: number; droop?: number; mat?: SurfaceName | SurfaceSpec; thick?: number; rng?: () => number }) {
  const { P } = ctx;
  const u = P.headH;
  const n = o.n ?? 9;
  const len = (o.length ?? 0.9) * u;
  const rnd = o.rng ?? (() => 0.5);
  const list: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const base: V3 = [o.from[0] + f * 0.1 * u * (o.spread ?? 1), o.from[1] - Math.abs(f) * 0.03 * u, o.from[2]];
    const wob = (rnd() - 0.5) * 0.12 * u;
    const pts: V3[] = [
      base,
      [base[0] + f * 0.12 * u + wob * 0.3, base[1] + 0.07 * u, base[2] - 0.2 * u],
      [base[0] + f * 0.26 * u + wob, base[1] + 0.03 * u - (o.droop ?? 0.1) * u * 0.4, base[2] - 0.5 * u],
      [base[0] + f * 0.36 * u + wob * 1.4, base[1] - len * 0.6, base[2] - 0.66 * u],
      [base[0] + f * 0.4 * u + wob * 1.6, base[1] - len, base[2] - 0.7 * u],
    ];
    list.push(taperedTube(pts, 0.045 * u * (o.thick ?? 1), 0.008 * u, { seg: 12, radial: 4 }));
  }
  put(ctx, mergeAll(list), { bone: 'head', color: o.color, mat: o.mat ?? surface('wool', { rough: 0.8 }), small: true });
}

/** a studded band of rivets */
export function rivetRing(ctx: KindContext, pts: V3[], r: number, color: number, mat: SurfaceName | SurfaceSpec = 'gold', bone = 'head') {
  put(ctx, studs(pts, r, 0.7), { bone, color, mat, small: true });
}

export { mat4, arcPlate, mix };

/** low-profile shoulder plates: a flat rounded cap with a bright rim (epaulettes) */
export function epaulettes(ctx: KindContext, o: { color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; trimMat?: SurfaceName | SurfaceSpec; size?: number; flat?: number; sides?: ('l' | 'r')[] }) {
  const { P } = ctx;
  const s = P.s;
  const g = Math.sqrt(P.build.bulk);
  for (const side of o.sides ?? (['l', 'r'] as const)) {
    const sx = side === 'l' ? 1 : -1;
    const sh = P.j[`upperarm_${side}`];
    const R = (0.07 * (o.size ?? 1) * g + 0.01) * s;
    const cap = shell(R, R * (o.flat ?? 0.42), R * 1.1, { th0: 0, th1: Math.PI * 0.5, w: 14, h: 4 });
    const m = new THREE.Matrix4().makeTranslation(sh[0] + sx * 0.014 * s, sh[1] + 0.036 * s, sh[2]).multiply(new THREE.Matrix4().makeRotationZ(-sx * 0.38));
    put(ctx, cap, { bone: `upperarm_${side}`, color: o.color, mat: o.mat ?? 'metal', matrix: m });
    const rim = new THREE.TorusGeometry(1, 0.045, 3, 20).rotateX(Math.PI / 2).scale(R, R * 0.5, R * 1.1);
    put(ctx, rim, { bone: `upperarm_${side}`, color: o.trim ?? o.color, mat: o.trimMat ?? 'gold', matrix: m, small: true });
  }
}
