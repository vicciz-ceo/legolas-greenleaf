/**
 * Shared helpers for the dwarves_orcs kinds: seed buckets, colour maths, painted markings and
 * the "skinned extra" mechanism (a hair/cloth mesh weighted to the humanoid skeleton).
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { makeSkinnedMesh } from '../../../kit/rig';
import type { V3 } from '../../../kit/sdf';
import type { KindContext } from '../../types';
import { placeAlong } from '../../gear';

/** same formula as the kit's `seedBucket` (build.ts); the lab checks they agree */
export function bucketOf(seed: number | undefined): number {
  if (!seed) return 0;
  return hashSeed('bucket', seed) % 4;
}

/** the seed bucket this build is for */
export function ctxBucket(ctx: KindContext): number {
  return bucketOf(ctx.spec.seed);
}

/** a deterministic stream per (kind, bucket, tag) that does not depend on the kit's own rng use */
export function recipeRng(ctx: KindContext, tag: string): Rng {
  return new Rng(hashSeed('dwo', ctx.kind, ctxBucket(ctx), tag));
}

const _a = new THREE.Color();
const _b = new THREE.Color();

/** mix two sRGB hex colours in sRGB space */
export function mix(a: number, b: number, t: number): number {
  _a.setHex(a, THREE.SRGBColorSpace);
  _b.setHex(b, THREE.SRGBColorSpace);
  return _a.lerp(_b, t).getHex(THREE.SRGBColorSpace);
}

/** brighten (>1) or darken (<1) an sRGB hex colour */
export function shade(hex: number, f: number): number {
  _a.setHex(hex, THREE.SRGBColorSpace);
  _a.r = Math.min(1, _a.r * f);
  _a.g = Math.min(1, _a.g * f);
  _a.b = Math.min(1, _a.b * f);
  return _a.getHex(THREE.SRGBColorSpace);
}

export function luminance(hex: number): number {
  _a.setHex(hex, THREE.SRGBColorSpace);
  return _a.r * 0.3 + _a.g * 0.59 + _a.b * 0.11;
}

/** v3 helpers */
export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const addv = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** matrix placing local +Y along `dir` at `pos` with local +Z toward `fwd` (see kit gear.placeAlong) */
export function frame(pos: V3, dir: V3, fwd: V3 = [0, 0, 1], scale = 1): THREE.Matrix4 {
  return placeAlong(pos, new THREE.Vector3(dir[0], dir[1], dir[2]), new THREE.Vector3(fwd[0], fwd[1], fwd[2]), scale);
}

/**
 * Attach a skinned mesh (hair, beard, cloth…) whose geometry carries kit skin weights (skinIndex /
 * skinWeight in the rig's bone indices). `KindContext.object` can only add rigid objects, so the
 * object we hand back is an empty holder that, the first time it is updated, finds the body's
 * skeleton among its ancestors and adds a SkinnedMesh bound to it next to the body. The mesh
 * follows the holder's visibility (LOD2 hides `small` extras).
 */
export function attachSkinned(ctx: KindContext, geo: THREE.BufferGeometry, mat: THREE.Material, o: { small?: boolean; castShadow?: boolean } = {}) {
  geo.userData.shared = true;
  ctx.object(
    () => {
      const holder = new THREE.Group();
      holder.name = 'skinned-extra';
      let mesh: THREE.SkinnedMesh | null = null;
      let tried = false;
      const base = holder.updateMatrixWorld;
      holder.updateMatrixWorld = function (this: THREE.Group, force?: boolean) {
        if (!mesh && !tried && this.parent) {
          let p: THREE.Object3D | null = this.parent;
          while (p && !mesh) {
            const body = p.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
            if (body) {
              mesh = makeSkinnedMesh(geo, mat, { skeleton: body.skeleton } as never, body.boundingSphere?.radius ?? 2, body.boundingSphere ? ([body.boundingSphere.center.x, body.boundingSphere.center.y, body.boundingSphere.center.z] as V3) : undefined);
              mesh.name = 'skinned-extra-mesh';
              mesh.castShadow = o.castShadow ?? true;
              mesh.receiveShadow = true;
              p.add(mesh);
            }
            p = p.parent;
          }
          if (!mesh) tried = true;
        }
        if (mesh) mesh.visible = this.visible;
        base.call(this, force);
      };
      return holder;
    },
    { bone: 'head', small: o.small ?? true },
  );
}

/** merge hair-style geometries (position, normal, uv, color, skinIndex, skinWeight) */
export function mergeHairGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const valid = list.filter((g) => g && g.attributes.position);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];
  const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = valid[0].attributes[n].itemSize;
    const total = valid.reduce((a, g) => a + g.attributes[n].count, 0);
    const arr = n === 'skinIndex' ? new Uint16Array(total * size) : new Float32Array(total * size);
    let o = 0;
    for (const g of valid) {
      arr.set(g.attributes[n].array as ArrayLike<number>, o);
      o += g.attributes[n].count * size;
    }
    out.setAttribute(n, n === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr as Uint16Array, size) : new THREE.BufferAttribute(arr, size));
  }
  const idx: number[] = [];
  let vo = 0;
  for (const g of valid) {
    const a = g.index!.array;
    for (let i = 0; i < a.length; i++) idx.push(a[i] + vo);
    vo += g.attributes.position.count;
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** dev-only: read a numeric override from the URL (?dwo_<name>=…), used while tuning in the lab */
export function devNum(name: string, def: number): number {
  if (typeof location === 'undefined') return def;
  const v = new URLSearchParams(location.search).get('dwo_' + name);
  return v === null || v === '' || Number.isNaN(Number(v)) ? def : Number(v);
}
