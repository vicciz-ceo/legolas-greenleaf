/**
 * Procedural PBR texture sets (albedo + normal + roughness [+ AO]), all tileable and generated
 * lazily in code. Cached and marked `userData.shared` so engine.clearLevel() does not dispose them.
 *
 * Channel layout
 *   map            sRGB albedo (alpha = coverage for `web`)
 *   normalMap      tangent-space normal (OpenGL convention) in RGB, ROUGHNESS in A (terrain splat reads it)
 *   roughnessMap   G = roughness, B = metalness mask (use it as metalnessMap for metals)
 *   aoMap          R = ambient occlusion (only for sets where it helps)
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { TileNoise } from './noise';
import { GENERATORS, Surf } from './texgen';
import { applyMacroVariation, type MacroOpts } from './shader';

export type TextureSetName =
  | 'bark' | 'mossy_bark' | 'leaves' | 'grass' | 'forest_floor' | 'mud' | 'dirt' | 'rock' | 'cliff'
  | 'cobble' | 'stone_blocks' | 'dwarven_stone' | 'marble' | 'wood_planks' | 'old_wood' | 'thatch'
  | 'snow' | 'ice' | 'sand' | 'ash' | 'metal_dark' | 'metal_bright' | 'gold' | 'leather' | 'cloth_linen'
  | 'cloth_wool' | 'web' | 'water_normal' | 'chitin' | 'scales_rough' | 'hide' | 'skin_human' | 'skin_orc'
  | 'skin_troll'
  // extras beyond the contract list
  | 'birch_bark' | 'shingles' | 'bone';

export const ALL_TEXTURE_SETS: readonly TextureSetName[] = [
  'bark', 'mossy_bark', 'leaves', 'grass', 'forest_floor', 'mud', 'dirt', 'rock', 'cliff', 'cobble',
  'stone_blocks', 'dwarven_stone', 'marble', 'wood_planks', 'old_wood', 'thatch', 'snow', 'ice', 'sand',
  'ash', 'metal_dark', 'metal_bright', 'gold', 'leather', 'cloth_linen', 'cloth_wool', 'web', 'water_normal',
  'chitin', 'scales_rough', 'hide', 'skin_human', 'skin_orc', 'skin_troll', 'birch_bark', 'shingles', 'bone',
];

/** Real-world size of one texture tile in metres: use it to bake world UVs (uv = metres / tile). */
export const TILE_METERS: Record<TextureSetName, number> = {
  bark: 2.4, mossy_bark: 2.4, birch_bark: 2.2, leaves: 1.5, grass: 1.6, forest_floor: 2.5, mud: 2.5, dirt: 2.5,
  rock: 3.0, cliff: 4.0, cobble: 2.0, stone_blocks: 3.0, dwarven_stone: 2.0, marble: 2.0, wood_planks: 1.2,
  old_wood: 1.2, shingles: 1.0, thatch: 1.5, snow: 3.0, ice: 2.0, sand: 2.0, ash: 2.5, metal_dark: 1.0,
  metal_bright: 1.0, gold: 0.6, leather: 0.5, cloth_linen: 0.25, cloth_wool: 0.3, web: 1.0, water_normal: 6,
  chitin: 0.8, scales_rough: 0.6, hide: 0.8, skin_human: 0.5, skin_orc: 0.8, skin_troll: 1.5, bone: 0.4,
};

export interface TextureSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  aoMap?: THREE.DataTexture;
}
export interface TextureSetOpts {
  /** 512 (default) or 1024 */
  size?: number;
}

const cache = new Map<string, TextureSet>();
const stats = new Map<string, number>();

function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

function makeTex(data: Uint8ClampedArray, n: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  t.userData.shared = true;
  return t;
}

/** Sobel normal from the height field with wraparound. Roughness goes into alpha. */
function buildNormal(s: Surf, strength: number): Uint8ClampedArray {
  const n = s.n;
  const h = s.h;
  const out = new Uint8ClampedArray(n * n * 4);
  const k = strength * (n / 512);
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n;
    const y0 = y * n;
    const yp = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n;
      const xp = (x + 1) % n;
      const dx = h[ym + xp] + 2 * h[y0 + xp] + h[yp + xp] - (h[ym + xm] + 2 * h[y0 + xm] + h[yp + xm]);
      const dy = h[yp + xm] + 2 * h[yp + x] + h[yp + xp] - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
      let nx = (-dx / 8) * k;
      let ny = (-dy / 8) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const nz = inv;
      const o = (y0 + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255;
      out[o + 3] = s.rough[y0 + x] * 255;
    }
  }
  return out;
}

function generate(name: TextureSetName, n: number): TextureSet {
  const spec = GENERATORS[name];
  if (!spec) throw new Error(`[textures] unknown texture set "${name}"`);
  const seed = nameSeed(name);
  const surf = new Surf(n, !!spec.ao, !!spec.metal);
  spec.fn(surf, new TileNoise(seed), new Rng(seed ^ 0x5bd1e995));
  const normal = buildNormal(surf, spec.normal);
  const rough = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const o = i * 4;
    const r = surf.rough[i] * 255;
    rough[o] = 255;
    rough[o + 1] = r;
    rough[o + 2] = surf.metal ? surf.metal[i] * 255 : 0;
    rough[o + 3] = 255;
  }
  if (!spec.alpha) for (let i = 0; i < n * n; i++) surf.rgba[i * 4 + 3] = 255;
  const set: TextureSet = {
    map: makeTex(surf.rgba, n, true),
    normalMap: makeTex(normal, n, false),
    roughnessMap: makeTex(rough, n, false),
  };
  if (surf.ao) {
    const ao = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      const v = surf.ao[i] * 255;
      const o = i * 4;
      ao[o] = v;
      ao[o + 1] = v;
      ao[o + 2] = v;
      ao[o + 3] = 255;
    }
    set.aoMap = makeTex(ao, n, false);
  }
  for (const [k, t] of Object.entries(set)) t.name = `${name}:${k}`;
  return set;
}

/** Tileable albedo/normal/roughness(/AO) for a named surface. Generated lazily, cached, shared. */
export function getTextureSet(name: TextureSetName, opts: TextureSetOpts = {}): TextureSet {
  const n = opts.size === 1024 ? 1024 : opts.size === 256 ? 256 : 512;
  const key = `${name}@${n}`;
  let set = cache.get(key);
  if (!set) {
    const t0 = performance.now();
    set = generate(name, n);
    stats.set(key, performance.now() - t0);
    cache.set(key, set);
  }
  return set;
}

/**
 * Generate several sets while yielding to the event loop between sets (loading screens stay alive).
 * Call it with the names a chapter needs before building its level.
 */
export async function preloadTextureSets(names: readonly TextureSetName[], onProgress?: (frac: number, name: string) => void): Promise<void> {
  for (let i = 0; i < names.length; i++) {
    getTextureSet(names[i]);
    onProgress?.((i + 1) / names.length, names[i]);
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** generation time in ms of already generated sets (diagnostics / lab) */
export function textureTimings(): Record<string, number> {
  return Object.fromEntries(stats);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Materials
// ───────────────────────────────────────────────────────────────────────────────────────────

interface MatDef {
  physical?: boolean;
  metalness?: number;
  /** multiplier on the roughness map */
  roughness?: number;
  normalScale?: number;
  sheen?: number;
  sheenColor?: number;
  sheenRoughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transparent?: boolean;
  alphaTest?: number;
  side?: THREE.Side;
  envMapIntensity?: number;
  color?: number;
  aoIntensity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  iridescence?: number;
  specularIntensity?: number;
}
const MAT: Partial<Record<TextureSetName, MatDef>> = {
  marble: { physical: true, clearcoat: 0.35, clearcoatRoughness: 0.12, normalScale: 0.6 },
  dwarven_stone: { physical: true, clearcoat: 0.2, clearcoatRoughness: 0.35 },
  mud: { physical: true, clearcoat: 0.25, clearcoatRoughness: 0.3 },
  ice: { physical: true, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1, envMapIntensity: 1.3, normalScale: 0.7 },
  snow: { physical: true, sheen: 0.5, sheenColor: 0xaac4ff, sheenRoughness: 0.4, roughness: 1 },
  metal_dark: { metalness: 1 },
  metal_bright: { metalness: 1 },
  gold: { metalness: 1 },
  cloth_linen: { physical: true, sheen: 0.8, sheenColor: 0xffffff, sheenRoughness: 0.55 },
  cloth_wool: { physical: true, sheen: 0.6, sheenColor: 0xd8d0c0, sheenRoughness: 0.7 },
  leather: { physical: true, sheen: 0.25, sheenColor: 0x8a6a4a, sheenRoughness: 0.5, normalScale: 0.9 },
  skin_human: { physical: true, sheen: 0.6, sheenColor: 0xff8a6a, sheenRoughness: 0.6, normalScale: 0.5 },
  skin_orc: { physical: true, sheen: 0.3, sheenColor: 0x9ab070, sheenRoughness: 0.6 },
  skin_troll: { physical: true, sheen: 0.15, sheenColor: 0x90a090, sheenRoughness: 0.7 },
  chitin: { physical: true, clearcoat: 0.6, clearcoatRoughness: 0.25 },
  hide: { physical: true, sheen: 0.3, sheenColor: 0x7a5a3a, sheenRoughness: 0.6 },
  web: { physical: false, transparent: true, side: THREE.DoubleSide, roughness: 1 },
  water_normal: { physical: true, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true },
  wood_planks: { normalScale: 1.0 },
  leaves: { side: THREE.FrontSide },
};

export interface MakeMaterialOverrides extends THREE.MeshPhysicalMaterialParameters {
  /** texture repeat (clones the shared textures, GPU memory is shared) */
  repeat?: [number, number];
  /** 512 | 1024 */
  size?: number;
  /** world-space macro variation (anti-tiling); true = defaults */
  macro?: boolean | MacroOpts;
  /** tint multiplier (sRGB hex) applied on top of the albedo */
  tint?: number;
}

function cloneRepeat(t: THREE.DataTexture, rx: number, ry: number): THREE.DataTexture {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.userData.shared = true;
  c.needsUpdate = false;
  return c;
}

/**
 * Ready-to-use PBR material for a texture set. Standard by default; Physical (sheen / clearcoat)
 * where the surface needs it. Geometry should carry world-scale UVs (uv = metres / TILE_METERS[name]),
 * or pass `repeat`.
 */
export function makeMaterial(
  name: TextureSetName,
  overrides: MakeMaterialOverrides = {},
): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const def = MAT[name] ?? {};
  const { repeat, size, macro, tint, ...rest } = overrides;
  let set = getTextureSet(name, { size });
  if (repeat) {
    set = {
      map: cloneRepeat(set.map, repeat[0], repeat[1]),
      normalMap: cloneRepeat(set.normalMap, repeat[0], repeat[1]),
      roughnessMap: cloneRepeat(set.roughnessMap, repeat[0], repeat[1]),
      aoMap: set.aoMap ? cloneRepeat(set.aoMap, repeat[0], repeat[1]) : undefined,
    };
  }
  const params: THREE.MeshPhysicalMaterialParameters = {
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: def.roughness ?? 1,
    metalness: def.metalness ?? 0,
    side: def.side ?? THREE.FrontSide,
    envMapIntensity: def.envMapIntensity ?? 1,
  };
  if (def.metalness) params.metalnessMap = set.roughnessMap;
  if (set.aoMap) {
    params.aoMap = set.aoMap;
    params.aoMapIntensity = def.aoIntensity ?? 1;
  }
  const ns = def.normalScale ?? 1;
  params.normalScale = new THREE.Vector2(ns, ns);
  if (def.color !== undefined) params.color = def.color;
  if (def.transparent) {
    params.transparent = true;
    if (name === 'web') params.depthWrite = false;
  }
  if (def.alphaTest) params.alphaTest = def.alphaTest;
  if (def.emissive !== undefined) {
    params.emissive = def.emissive;
    params.emissiveIntensity = def.emissiveIntensity ?? 1;
  }
  let mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  if (def.physical) {
    const p = { ...params } as THREE.MeshPhysicalMaterialParameters;
    if (def.sheen) {
      p.sheen = def.sheen;
      p.sheenColor = new THREE.Color(def.sheenColor ?? 0xffffff);
      p.sheenRoughness = def.sheenRoughness ?? 0.5;
    }
    if (def.clearcoat) {
      p.clearcoat = def.clearcoat;
      p.clearcoatRoughness = def.clearcoatRoughness ?? 0.2;
    }
    if (def.specularIntensity !== undefined) p.specularIntensity = def.specularIntensity;
    mat = new THREE.MeshPhysicalMaterial(p);
  } else mat = new THREE.MeshStandardMaterial(params);
  mat.name = `pbr:${name}`;
  if (tint !== undefined) mat.color.set(tint);
  mat.setValues(rest as THREE.MeshPhysicalMaterialParameters);
  if (macro) applyMacroVariation(mat, macro === true ? {} : macro);
  return mat;
}
