/**
 * Kit — parametric skinned sheets: wing membranes, sails, banners, cloaks, ears.
 * A sheet is a grid of points (rows × cols, rest model space) with a weight function; it renders
 * double-sided with the creature material (kit attributes), so it merges into the body draw call.
 */
import * as THREE from 'three';
import { SURFACES, type SurfaceName, type SurfaceSpec } from './surfaces';
import type { V3 } from './sdf';

export interface SheetOpts {
  /** grid of rest positions: grid[row][col] */
  grid: V3[][];
  color: number;
  /** optional colour function per (u along cols, v along rows) → sRGB hex */
  colorAt?: (u: number, v: number) => number;
  mat?: SurfaceName | SurfaceSpec;
  /** skin weights for a grid point: [[boneIndex, weight], …] */
  weights: (row: number, col: number, p: V3, out: [number, number][]) => void;
  /** AO per point (0..1), default 1 */
  ao?: (u: number, v: number) => number;
}

const _c = new THREE.Color();

export function sheetGeometry(o: SheetOpts): THREE.BufferGeometry {
  const rows = o.grid.length;
  const cols = o.grid[0].length;
  const n = rows * cols;
  const spec: SurfaceSpec = typeof o.mat === 'string' ? SURFACES[o.mat] : o.mat ?? SURFACES.membrane;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  const pat0 = new Float32Array(n * 4);
  const pat1 = new Float32Array(n * 4);
  const ao = new Float32Array(n);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const w: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const p = o.grid[r][c];
      pos.set(p, i * 3);
      _c.setHex(o.colorAt ? o.colorAt(c / (cols - 1), r / (rows - 1)) : o.color, THREE.SRGBColorSpace);
      col.set([_c.r, _c.g, _c.b], i * 3);
      surf.set([spec.rough, spec.metal, spec.sheen, spec.skin], i * 4);
      pat0.set(spec.pat.slice(0, 4), i * 4);
      pat1.set(spec.pat.slice(4, 8), i * 4);
      ao[i] = o.ao ? o.ao(c / (cols - 1), r / (rows - 1)) : 1;
      w.length = 0;
      o.weights(r, c, p, w);
      w.sort((a, b) => b[1] - a[1]);
      let s = 0;
      for (let k = 0; k < 4; k++) s += w[k]?.[1] ?? 0;
      s = s || 1;
      for (let k = 0; k < 4; k++) {
        si[i * 4 + k] = w[k]?.[0] ?? 0;
        sw[i * 4 + k] = (w[k]?.[1] ?? 0) / s;
      }
    }
  const idx: number[] = [];
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  g.setAttribute('pat0', new THREE.BufferAttribute(pat0, 4));
  g.setAttribute('pat1', new THREE.BufferAttribute(pat1, 4));
  g.setAttribute('seam', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  g.computeVertexNormals();
  return g;
}

/** bilinear patch helper: grid from 4 corners (a b / d c), optional sag along the middle */
export function quadGrid(a: V3, b: V3, c: V3, d: V3, rows: number, cols: number, sag: V3 = [0, 0, 0]): V3[][] {
  const g: V3[][] = [];
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    const row: V3[] = [];
    for (let k = 0; k < cols; k++) {
      const u = k / (cols - 1);
      const s = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      row.push([
        a[0] * (1 - u) * (1 - v) + b[0] * u * (1 - v) + c[0] * u * v + d[0] * (1 - u) * v + sag[0] * s,
        a[1] * (1 - u) * (1 - v) + b[1] * u * (1 - v) + c[1] * u * v + d[1] * (1 - u) * v + sag[1] * s,
        a[2] * (1 - u) * (1 - v) + b[2] * u * (1 - v) + c[2] * u * v + d[2] * (1 - u) * v + sag[2] * s,
      ]);
    }
    g.push(row);
  }
  return g;
}
