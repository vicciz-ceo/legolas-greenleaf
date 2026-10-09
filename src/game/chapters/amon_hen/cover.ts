/**
 * Ground cover for the parts of the hill the shared terrain shader leaves bare: a thin sheet of mossy
 * grass laid a hand's breadth over the heightfield, fading out at its edges (per-vertex alpha), so the flat
 * summit plateau and the far bank read as woodland floor instead of a smooth orange slab.
 *
 * One mesh per patch, one draw call, no colliders (purely visual).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { TILE_METERS, mat } from '../../../world';

export interface CoverOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** grid step in metres */
  step: number;
  heightAt: (x: number, z: number) => number;
  /** 0..1 opacity of the sheet at a point (the fade-out edges, holes for stairs, water and stonework) */
  alpha: (x: number, z: number) => number;
  /** albedo multiplier of the grass texture */
  tint: [number, number, number];
  name?: string;
}

export function groundCover(level: LevelAPI, o: CoverOpts): THREE.Mesh {
  const nx = Math.round((o.x1 - o.x0) / o.step);
  const nz = Math.round((o.z1 - o.z0) / o.step);
  const tile = TILE_METERS.grass;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const alpha: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = o.x0 + (i * (o.x1 - o.x0)) / nx;
      const z = o.z0 + (j * (o.z1 - o.z0)) / nz;
      const y = o.heightAt(x, z);
      pos.push(x, y + 0.05, z);
      const e = 0.6;
      const gx = o.heightAt(x + e, z) - o.heightAt(x - e, z);
      const gz = o.heightAt(x, z + e) - o.heightAt(x, z - e);
      const l = Math.hypot(gx, 2 * e, gz);
      nor.push(-gx / l, (2 * e) / l, -gz / l);
      uv.push(x / tile, z / tile);
      const a = Math.max(0, Math.min(1, o.alpha(x, z)));
      alpha.push(a);
      col.push(o.tint[0], o.tint[1], o.tint[2], a);
    }
  }
  const idx: number[] = [];
  const stride = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (alpha[a] + alpha[b] + alpha[c] + alpha[d] <= 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  const m = mat('grass', { key: 'amonCover' }).clone();
  m.userData = { ...m.userData, shared: false };
  m.vertexColors = true;
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = o.name ?? 'ground_cover';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noAO = true;
  level.root.add(mesh);
  return mesh;
}

/**
 * A far wooded ridge round the whole world: a ragged band of olive woodland that fog turns to haze. It sits
 * behind the far wood, so the gaps in the canopies show hill and not saturated sky (the alpha-tested crowns
 * otherwise cut hard blue pixels out of the horizon).
 */
export function distantRidge(level: LevelAPI, center: THREE.Vector3, radius: number, baseY: number, noise: (a: number) => number): THREE.Mesh {
  const SEG = 180;
  const ROWS = 6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color(0x76764a);
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const top = 34 + noise(a) * 22;
    for (let j = 0; j <= ROWS; j++) {
      const f = j / ROWS;
      pos.push(center.x + Math.cos(a) * radius, baseY + f * top, center.z + Math.sin(a) * radius);
      // opaque for the lower two thirds, a soft ragged fade at the crest
      col.push(c.r, c.g, c.b, 1 - Math.max(0, Math.min(1, (f - 0.55) / 0.45)));
    }
  }
  const stride = ROWS + 1;
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < ROWS; j++) {
      const a = i * stride + j;
      const b = a + stride;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'distant_ridge';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  mesh.userData.noAO = true;
  level.root.add(mesh);
  return mesh;
}
