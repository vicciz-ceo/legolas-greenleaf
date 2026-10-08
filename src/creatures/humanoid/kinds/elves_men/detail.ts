/**
 * Small rigid details on the garments: lacing, buttons, stitched trims, tree emblems, belt
 * hardware. All of these are merged into the body draw call as `small` gear.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { createWeapon } from '../../../weapons';
import { mergeAll, put, ring, studs, taperedTube, tube, torsoSection } from './geo';

/** lacing down the chest front: criss-cross cords between two rows of eyelets, ending in a bow */
export function laceFront(ctx: KindContext, o: { y0: number; y1: number; inflate: number; color: number; rows?: number; spread?: number; mat?: SurfaceName | SurfaceSpec; eyelets?: number }) {
  const { P } = ctx;
  const s = P.s;
  const zAt = (y: number) => torsoSection(P, y).zf + o.inflate;
  const m = o.rows ?? 5;
  const sp = (o.spread ?? 0.02) * s;
  const list: THREE.BufferGeometry[] = [];
  for (let i = 0; i < m; i++) {
    const ya = o.y1 + (o.y0 - o.y1) * (i / m);
    const yb = o.y1 + (o.y0 - o.y1) * ((i + 1) / m);
    for (const sg of [1, -1]) {
      const a: V3 = [-sg * sp, ya, zAt(ya) + 0.0015 * s];
      const b: V3 = [sg * sp, yb, zAt(yb) + 0.0015 * s];
      const mid: V3 = [0, (ya + yb) / 2, zAt((ya + yb) / 2) + 0.004 * s];
      list.push(tube([a, mid, b], 0.0026 * s, { seg: 3, radial: 3 }));
    }
  }
  // eyelet studs on both sides
  const pts: V3[] = [];
  for (let i = 0; i <= m; i++) {
    const y = o.y1 + (o.y0 - o.y1) * (i / m);
    pts.push([-sp, y, zAt(y)], [sp, y, zAt(y)]);
  }
  put(ctx, mergeAll(list), { bone: 'chest', color: o.color, mat: o.mat ?? 'leather_worn', small: true });
  put(ctx, studs(pts, 0.0034 * s, 0.6), { bone: 'chest', color: 0x8a7442, mat: 'gold', small: true });
}

/** a row of buttons / toggles down the front */
export function buttons(ctx: KindContext, o: { y0: number; y1: number; n: number; inflate: number; color: number; r?: number; x?: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const s = P.s;
  const pts: V3[] = [];
  for (let i = 0; i < o.n; i++) {
    const y = o.y1 + (o.y0 - o.y1) * (o.n === 1 ? 0.5 : i / (o.n - 1));
    pts.push([o.x ?? 0, y, torsoSection(P, y).zf + o.inflate]);
  }
  put(ctx, studs(pts, (o.r ?? 0.0075) * s, 0.8), { bone: 'chest', color: o.color, mat: o.mat ?? 'gold', small: true });
}

/** a vertical seam / placket line down the front (a thin raised cord) */
export function placketLine(ctx: KindContext, o: { y0: number; y1: number; inflate: number; color: number; x?: number; width?: number; mat?: SurfaceName | SurfaceSpec }) {
  const { P } = ctx;
  const s = P.s;
  const pts: V3[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const y = o.y1 + (o.y0 - o.y1) * (i / n);
    pts.push([o.x ?? 0, y, torsoSection(P, y).zf + o.inflate]);
  }
  put(ctx, tube(pts, (o.width ?? 0.0045) * s, { seg: 12, radial: 4 }), { bone: 'chest', color: o.color, mat: o.mat ?? 'leather_worn', small: true });
}

/**
 * A flat emblem built from ribbon strokes, hung on the chest front (the White Tree of Gondor, a
 * horse, a leaf sprig). `strokes` are polylines in emblem space (x right, y up; origin = centre)
 * with a width each; the ribbons follow the torso surface at (cx, cy).
 */
export interface EmblemStroke {
  pts: [number, number][];
  w: number;
  /** width at the end (taper) */
  w1?: number;
}

export function emblemGeometry(ctx: KindContext, strokes: EmblemStroke[], o: { cx?: number; cy: number; scale: number; inflate: number; bone?: 'chest' | 'hips' }): THREE.BufferGeometry | null {
  const { P } = ctx;
  const pos: number[] = [];
  const idx: number[] = [];
  const cx = o.cx ?? 0;
  const surface = (ex: number, ey: number): THREE.Vector3 => {
    const y = o.cy + ey * o.scale;
    const sec = torsoSection(P, y);
    const x = cx + ex * o.scale;
    // front surface z at x: ellipse of the section
    const z0 = (sec.zf + sec.zb) / 2;
    const rz = (sec.zf - sec.zb) / 2;
    const fx = Math.min(0.97, Math.abs(x) / sec.rx);
    const z = z0 + rz * Math.sqrt(1 - fx * fx) * (1 + 0.0);
    return new THREE.Vector3(x, y, z + o.inflate);
  };
  for (const st of strokes) {
    const base = pos.length / 3;
    const n = st.pts.length;
    // densify
    const dense: [number, number][] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = st.pts[i];
      const b = st.pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.12));
      for (let k = 0; k < steps; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
    }
    dense.push(st.pts[n - 1]);
    const m = dense.length;
    for (let i = 0; i < m; i++) {
      const p = surface(dense[i][0], dense[i][1]);
      const pa = surface(dense[Math.max(0, i - 1)][0], dense[Math.max(0, i - 1)][1]);
      const pb = surface(dense[Math.min(m - 1, i + 1)][0], dense[Math.min(m - 1, i + 1)][1]);
      const t = pb.clone().sub(pa).normalize();
      // side vector tangent to the torso surface: perpendicular to the stroke within the emblem plane
      const side = new THREE.Vector3(t.y, -t.x, 0);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const f = i / Math.max(1, m - 1);
      const w = ((st.w + ((st.w1 ?? st.w) - st.w) * f) * o.scale) / 2;
      const a = p.clone().addScaledVector(side, w);
      const b = p.clone().addScaledVector(side, -w);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i + 1 < m; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A sheathed weapon at the hip: a leather scabbard (with locket and chape) merged into the body,
 * plus the weapon itself as a separate object hidden while the named hand holds that weapon.
 * `dir` points from the hilt toward the tip (model space); `pos` is the hilt position.
 */
export function sheathed(
  ctx: KindContext,
  o: { kind: import('../../../../core/types').WeaponKind; hand: 'hand_r' | 'hand_l'; bone?: string; pos: V3; dir: V3; len: number; r: number; color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; seed?: number; weaponStart?: number; flat?: number },
) {
  const bone = o.bone ?? 'hips';
  const d = new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]).normalize();
  const start = o.weaponStart ?? 0.09;
  const a: V3 = [o.pos[0] + d.x * start, o.pos[1] + d.y * start, o.pos[2] + d.z * start];
  const b: V3 = [o.pos[0] + d.x * (start + o.len), o.pos[1] + d.y * (start + o.len), o.pos[2] + d.z * (start + o.len)];
  // scabbard: slightly flattened tapered tube
  const geo = taperedTubeFlat(a, b, o.r, o.r * 0.78, o.flat ?? 0.55);
  put(ctx, geo, { bone, color: o.color, mat: o.mat ?? 'leather_worn', small: true });
  // locket at the mouth and chape at the tip
  put(ctx, ring(a, o.dir, o.r * 1.12, o.r * 0.28, 10, 3), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(o.r * 0.82, 7, 5).translate(b[0], b[1], b[2]), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  ctx.object(
    () => {
      const w = createWeapon(o.kind, o.seed ?? 3);
      w.position.set(o.pos[0], o.pos[1], o.pos[2]);
      w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      w.userData.stowFor = { hand: o.hand, weapon: o.kind };
      return w;
    },
    { bone, small: true },
  );
}

function taperedTubeFlat(a: V3, b: V3, r0: number, r1: number, flat: number): THREE.BufferGeometry {
  const g = taperedTube([a, b], r0, r1, { seg: 4, radial: 7 });
  // flatten across the blade width: scale the cross-section along the local side axis
  const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(new THREE.Vector3(...a));
    const t = v.dot(axis);
    c.copy(axis).multiplyScalar(t);
    v.sub(c);
    const sd = v.dot(side);
    v.addScaledVector(side, -sd * (1 - flat));
    pos.setXYZ(i, a[0] + c.x + v.x, a[1] + c.y + v.y, a[2] + c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** a healed scar painted on the face: a thin pale-pink line from (x0, y0) to (x1, y1) in head units on the surface */
export function paintScar(ctx: KindContext, o: { from: [number, number]; to: [number, number]; color?: number; width?: number; strength?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const zAt = (x: number, y: number) => 0.4 - 0.5 * Math.min(1, Math.abs(x) / 0.34) ** 2 - (y < -0.15 ? 0.1 * Math.min(1, (-y - 0.15) / 0.3) : 0) - (y > 0.15 ? 0.2 * Math.min(1, (y - 0.15) / 0.3) : 0);
  const a = P.h(o.from[0], o.from[1], zAt(o.from[0], o.from[1]));
  const b = P.h(o.to[0], o.to[1], zAt(o.to[0], o.to[1]));
  const skin = ctx.def.skin.color;
  const col = o.color ?? mixHexLocal(skin, 0x9a4a44, 0.5);
  s.cone(a, b, (o.width ?? 0.011) * u, (o.width ?? 0.011) * u * 0.7, { op: 'paint', color: col, mat: 'skin_weathered', bone: 'head', k: 0.007 * u, strength: o.strength ?? 0.85 });
}

function mixHexLocal(a: number, b: number, t: number): number {
  const c1 = new THREE.Color().setHex(a, THREE.SRGBColorSpace);
  const c2 = new THREE.Color().setHex(b, THREE.SRGBColorSpace);
  return c1.lerp(c2, t).getHex(THREE.SRGBColorSpace);
}
