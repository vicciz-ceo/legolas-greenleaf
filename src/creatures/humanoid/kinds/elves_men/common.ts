/**
 * Shared helpers for the elves_men kinds: seed buckets, colour maths, hair materials and the
 * "skinned extra" mechanism (a hair/cloth mesh weighted to the humanoid skeleton).
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { makeSkinnedMesh } from '../../../kit/rig';
import { createHairMaterial } from '../../../kit/hair';
import type { V3 } from '../../../kit/sdf';
import type { KindContext } from '../../types';

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
  return new Rng(hashSeed('elmen', ctx.kind, ctxBucket(ctx), tag));
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

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];

const matCache = new Map<number, THREE.MeshPhysicalMaterial>();

/** the hair material for a given hair colour (shared between instances) */
export function hairMaterial(color: number, opts: { rough?: number } = {}): THREE.MeshPhysicalMaterial {
  const key = color * 8 + (opts.rough ? 1 : 0);
  let m = matCache.get(key);
  if (!m) {
    const lum = luminance(color);
    m = createHairMaterial({ roughness: opts.rough ?? 0.62, anisotropy: 0.5 + 0.7 * Math.min(1, lum * 2), sheen: 0.25, sheenColor: color });
    m.specularIntensity = 0.12 + 0.25 * Math.min(1, lum * 1.5);
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/**
 * Attach a skinned mesh (hair, beard, cloth…) whose geometry carries kit skin weights (skinIndex /
 * skinWeight in the rig's bone indices). `KindContext.object` can only add rigid objects, so the
 * object handed back is an empty holder that, the first time it is updated, finds the body's
 * skeleton among its ancestors and adds a SkinnedMesh bound to it next to the body. The mesh
 * follows the holder's visibility (LOD2 hides `small` extras). Pass `'body'` as the material to
 * share the instance's own body material (kit-attribute geometry such as cloth sheets, hit flash included).
 */
export function attachSkinned(ctx: KindContext, geo: THREE.BufferGeometry, mat: THREE.Material | 'body', o: { small?: boolean; castShadow?: boolean; name?: string } = {}) {
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
              mesh = makeSkinnedMesh(geo, mat === 'body' ? (body.material as THREE.Material) : mat, { skeleton: body.skeleton } as never, body.boundingSphere?.radius ?? 2, body.boundingSphere ? ([body.boundingSphere.center.x, body.boundingSphere.center.y, body.boundingSphere.center.z] as V3) : undefined);
              mesh.name = o.name ?? 'skinned-extra-mesh';
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

const pendingHair = new WeakMap<object, { geos: THREE.BufferGeometry[]; color: number }>();

/** collect a hair/beard geometry; `flushHair` merges everything queued for this build into ONE skinned mesh (one draw call) */
export function queueHair(ctx: KindContext, geo: THREE.BufferGeometry, color: number) {
  let e = pendingHair.get(ctx);
  if (!e) pendingHair.set(ctx, (e = { geos: [], color }));
  e.geos.push(geo);
}

export function flushHair(ctx: KindContext) {
  const e = pendingHair.get(ctx);
  if (!e) return;
  pendingHair.delete(ctx);
  const merged = mergeHairGeos(e.geos);
  if (merged) attachSkinned(ctx, merged, hairMaterial(e.color), { name: 'hair2' });
}

/** run a kind's extras and merge all the hair/beard geometry it queued into one skinned mesh */
export function withHair(ctx: KindContext, fn: () => void) {
  fn();
  flushHair(ctx);
}

/** dev-only: read a numeric override from the URL (?em_<name>=…), used while tuning in the lab */
export function devNum(name: string, def: number): number {
  if (typeof location === 'undefined') return def;
  const v = new URLSearchParams(location.search).get('em_' + name);
  return v === null || v === '' || Number.isNaN(Number(v)) ? def : Number(v);
}

/** dev-only: ?em_skip=armor,hair,… switches features off while measuring triangle cost */
export function devSkip(name: string): boolean {
  if (typeof location === 'undefined') return false;
  const v = new URLSearchParams(location.search).get('em_skip');
  return !!v && v.split(',').includes(name);
}
