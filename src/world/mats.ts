/**
 * Shared material cache for the world builders. Materials are keyed by texture set + options so every
 * barrel / wall / roof in a level shares one shader program and one set of textures.
 */
import * as THREE from 'three';
import { makeMaterial, type MakeMaterialOverrides, type TextureSetName } from './textures';

const cache = new Map<string, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>();

export interface MatOpts extends MakeMaterialOverrides {
  /** extra cache key to separate variants that differ by function-valued options */
  key?: string;
  /** multiply colour with rgb floats (values above 1 allowed) */
  rgb?: [number, number, number];
  /** per-vertex colours on the geometry */
  vertexColors?: boolean;
}

/** cached PBR material for a texture set. The cache key ignores function values; pass `key` to split. */
export function mat(name: TextureSetName, o: MatOpts = {}): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const { key, rgb, ...rest } = o;
  const k = `${name}|${key ?? ''}|${rgb?.join(',') ?? ''}|${JSON.stringify(rest, (_k, v) => (typeof v === 'function' ? 'fn' : v))}`;
  let m = cache.get(k);
  if (!m) {
    m = makeMaterial(name, { macro: true, ...rest });
    if (rgb) m.color.setRGB(rgb[0], rgb[1], rgb[2]);
    cache.set(k, m);
  }
  return m;
}

/** plain coloured PBR material (small parts only: lamp glass, flames, rope ends) */
export function plain(color: number, o: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number; key?: string } = {}): THREE.MeshStandardMaterial {
  const k = `plain|${color}|${o.roughness}|${o.metalness}|${o.emissive}|${o.emissiveIntensity}|${o.key ?? ''}`;
  let m = cache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.8, metalness: o.metalness ?? 0 });
    if (o.emissive !== undefined) {
      m.emissive = new THREE.Color(o.emissive);
      m.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    cache.set(k, m);
  }
  return m;
}
