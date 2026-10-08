/**
 * Arc-length parameterised paths (rivers, walls, piers, bridges, roads). Accepts [x,z] / [x,y,z]
 * pairs, Vector2s and Vector3s. Smooth (Catmull-Rom) or polyline.
 */
import * as THREE from 'three';
import { pathXZ, type PathPoint } from './util';

export interface PathOpts {
  /** Catmull-Rom smoothing (default true). false keeps sharp corners (walls) */
  smooth?: boolean;
  closed?: boolean;
  /** sample spacing for the dense polyline (m, default 0.5) */
  step?: number;
  /** y for points that have none */
  y?: number | ((x: number, z: number) => number);
}

export interface NearestResult {
  /** distance along the path (m) */
  s: number;
  /** distance from the path (m) */
  dist: number;
  /** + to the right of the travel direction (looking along +tangent, right = +side) */
  signed: number;
  x: number;
  y: number;
  z: number;
}

export class Path {
  readonly length: number;
  readonly closed: boolean;
  /** dense samples */
  readonly pts: THREE.Vector3[] = [];
  private cum: number[] = [];

  constructor(points: readonly PathPoint[], opts: PathOpts = {}) {
    this.closed = opts.closed ?? false;
    const raw = points.map((p) => {
      const q = pathXZ(p);
      let y = q.y;
      if (!Array.isArray(p) && !(p as THREE.Vector3).isVector3) y = typeof opts.y === 'function' ? opts.y(q.x, q.z) : (opts.y ?? 0);
      else if (Array.isArray(p) && p.length === 2) y = typeof opts.y === 'function' ? opts.y(q.x, q.z) : (opts.y ?? 0);
      return new THREE.Vector3(q.x, y, q.z);
    });
    const step = opts.step ?? 0.5;
    if (opts.smooth === false || raw.length < 3) {
      // polyline with sharp corners: keep vertices, subdivide for sampling
      const list = this.closed ? [...raw, raw[0]] : raw;
      this.pts.push(list[0].clone());
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
        for (let k = 1; k <= n; k++) this.pts.push(a.clone().lerp(b, k / n));
      }
    } else {
      const curve = new THREE.CatmullRomCurve3(raw, this.closed, 'centripetal');
      const len = curve.getLength();
      const n = Math.max(2, Math.ceil(len / step));
      for (let i = 0; i <= n; i++) this.pts.push(curve.getPointAt(i / n));
    }
    this.cum.push(0);
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  private index(s: number): number {
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** point at distance s along the path */
  at(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const i = this.index(s);
    const j = Math.min(this.pts.length - 1, i + 1);
    const span = this.cum[j] - this.cum[i];
    const f = span > 1e-6 ? (Math.max(0, Math.min(this.length, s)) - this.cum[i]) / span : 0;
    return out.copy(this.pts[i]).lerp(this.pts[j], f);
  }

  /** unit tangent (horizontal component kept, y included) at distance s */
  tangent(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.at(s - 0.6, new THREE.Vector3());
    const b = this.at(s + 0.6, out);
    return b.sub(a).normalize();
  }

  /** closest point on the path to (x, z) on the XZ plane */
  nearest(x: number, z: number): NearestResult {
    let best = Infinity;
    let bs = 0;
    let bx = 0;
    let by = 0;
    let bz = 0;
    let sign = 1;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 1e-9 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        bs = this.cum[i] + t * (this.cum[i + 1] - this.cum[i]);
        bx = px;
        by = a.y + (b.y - a.y) * t;
        bz = pz;
        // right of travel direction = (-dz, dx)
        sign = dx * (z - a.z) - dz * (x - a.x) > 0 ? 1 : -1;
      }
    }
    const dist = Math.sqrt(best);
    return { s: bs, dist, signed: dist * sign, x: bx, y: by, z: bz };
  }

  /** evenly spaced frames along the path */
  frames(step: number): { p: THREE.Vector3; t: THREE.Vector3; s: number }[] {
    const n = Math.max(1, Math.round(this.length / step));
    const out: { p: THREE.Vector3; t: THREE.Vector3; s: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * this.length;
      out.push({ p: this.at(s), t: this.tangent(s), s });
    }
    return out;
  }
}
