/**
 * Geometry builders for rigid armour and gear (helmets, plates, spikes, rivets…). Everything here
 * returns plain THREE geometry in model space; `put()` hands it to the kit's gear sink (merged into
 * the body draw call, skinned to one bone).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';

export interface PutOpts {
  bone: string;
  color: number;
  mat?: SurfaceName | SurfaceSpec;
  matrix?: THREE.Matrix4;
  small?: boolean;
  colorFn?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void;
  ao?: number;
}

/** add rigid gear to the body draw call */
export function put(ctx: KindContext, geo: THREE.BufferGeometry, o: PutOpts) {
  ctx.gear(geo, o as Parameters<KindContext['gear']>[1]);
}

/** a partial ellipsoid shell (helmet domes, pauldrons, plates) */
export function shell(rx: number, ry: number, rz: number, o: { phi0?: number; phiLen?: number; th0?: number; th1?: number; w?: number; h?: number } = {}): THREE.BufferGeometry {
  const th0 = o.th0 ?? 0;
  const th1 = o.th1 ?? Math.PI / 2;
  const g = new THREE.SphereGeometry(1, o.w ?? 14, o.h ?? 8, o.phi0 ?? 0, o.phiLen ?? Math.PI * 2, th0, th1 - th0);
  g.scale(rx, ry, rz);
  return g;
}

/** lathe around +Y from (radius, y) pairs */
export function lathe(profile: [number, number][], seg = 16, phi0 = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)),
    seg,
    phi0,
    phiLen,
  );
}

/** a tube along a smooth path */
export function tube(points: V3[], radius: number, o: { seg?: number; radial?: number; closed?: boolean; taper?: number } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), o.closed ?? false, 'catmullrom', 0.3);
  const g = new THREE.TubeGeometry(curve, o.seg ?? 16, radius, o.radial ?? 5, o.closed ?? false);
  return g;
}

/** a cone spike from `base` along `dir` */
export function spike(base: V3, dir: V3, len: number, r: number, seg = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg).translate(0, len / 2, 0);
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(base[0], base[1], base[2]), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** many small domed rivets/studs at the given points (one geometry) */
export function studs(points: V3[], r: number, flat = 0.7): THREE.BufferGeometry | null {
  if (!points.length) return null;
  const list: THREE.BufferGeometry[] = [];
  for (const p of points) {
    const g = new THREE.SphereGeometry(r, 5, 3).scale(1, flat, 1).translate(p[0], p[1], p[2]);
    list.push(g.toNonIndexed());
  }
  return mergeAll(list);
}

/** merge plain geometries (position+normal only) */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const clean = list
    .filter(Boolean)
    .map((g) => {
      const c = g.index ? g.toNonIndexed() : g.clone();
      for (const n of Object.keys(c.attributes)) if (n !== 'position' && n !== 'normal') c.deleteAttribute(n);
      return c;
    });
  if (!clean.length) return null;
  const m = mergeGeometries(clean, false);
  for (const c of clean) c.dispose();
  return m;
}

/** a model-space matrix: translate then rotate (Euler XYZ) then scale */
export function mat4(pos: V3, rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.Matrix4 {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), s);
}

/** a curved rectangular plate wrapped around a vertical axis (arc of a cylinder), for cheek guards, tassets, bracers */
export function arcPlate(radius: number, height: number, arc: number, centre = 0, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, seg, 1, true, centre - arc / 2 + Math.PI / 2, arc);
}

/**
 * Overlapping scale rows over a cylindrical/elliptical torso band — used for scale armour where a
 * shader pattern is not enough. Rows go from `y0` (bottom) up to `y1`; each scale is a small curved
 * quad hanging downward. Returns null when empty.
 */
export function scaleBand(opts: { cy: number; rx: number; rz: number; y0: number; y1: number; rows: number; perRow: number; w: number; h: number; phi0?: number; phiLen?: number; zOff?: number; taper?: (y01: number) => number; tilt?: number }): THREE.BufferGeometry | null {
  const list: THREE.BufferGeometry[] = [];
  const { rows, perRow } = opts;
  const phi0 = opts.phi0 ?? 0;
  const phiLen = opts.phiLen ?? Math.PI * 2;
  for (let r = 0; r < rows; r++) {
    const f = rows > 1 ? r / (rows - 1) : 0;
    const y = opts.y0 + (opts.y1 - opts.y0) * f;
    const tp = opts.taper ? opts.taper(f) : 1;
    const n = perRow;
    for (let i = 0; i < n; i++) {
      const a = phi0 + ((i + (r % 2 ? 0.5 : 0)) / n) * phiLen;
      if (a > phi0 + phiLen + 1e-6 && phiLen < Math.PI * 2 - 1e-3) continue;
      const x = Math.sin(a) * opts.rx * tp;
      const z = Math.cos(a) * opts.rz * tp + (opts.zOff ?? 0);
      const g = new THREE.PlaneGeometry(opts.w, opts.h, 1, 2);
      // bend the scale so its lower edge flares out slightly and the centre bulges
      const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const px = pos.getX(k);
        const py = pos.getY(k);
        const bulge = (1 - (px / (opts.w / 2)) ** 2) * 0.35 * opts.w * 0.2;
        pos.setZ(k, bulge + (-py / opts.h) * (opts.tilt ?? 0.012));
        // pointed tip on the lowest vertices
        if (py < -opts.h * 0.45) pos.setX(k, px * 0.35);
      }
      g.computeVertexNormals();
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      list.push(g.toNonIndexed());
    }
  }
  const m = mergeAll(list);
  return m;
}
