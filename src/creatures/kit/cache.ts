/**
 * Kit — mesh cache. Sculpt results are cached per (definition hash + mesh options), so a crowd of
 * 40 orcs built from the same definition and seed bucket reuses one geometry.
 *
 * `meshSculpt` is synchronous (main thread). `meshSculptAsync` meshes in the worker pool
 * (`workers.ts`) and fills the same cache, so a later `meshSculpt` with the same sculpt + options
 * is a cache hit — use it on loading screens to build many creatures in parallel.
 */
import type * as THREE from 'three';
import { meshSdf, type MeshData, type MeshOpts } from './mesher';
import type { Sculpt } from './sdf';
import { meshDataToGeometry } from './geometry';
import { meshSdfAsync } from './workers';

const dataCache = new Map<string, MeshData>();
const inflight = new Map<string, Promise<MeshData>>();
const geoCache = new Map<string, THREE.BufferGeometry>();
let stats = { hits: 0, misses: 0, ms: 0, async: 0 };

function optsKey(o: MeshOpts): string {
  return JSON.stringify([o.res, o.regions ?? [], o.ao ?? null, o.smooth ?? 2, o.project ?? 2, o.clip ?? null, o.refine ?? null]);
}

/** cache key of a sculpt meshed with options */
export function meshKey(s: Sculpt, opts: MeshOpts): string {
  return s.hash() + '|' + optsKey(opts);
}

/** true when `meshSculpt(s, opts)` would be a cache hit */
export function hasMesh(s: Sculpt, opts: MeshOpts): boolean {
  return dataCache.has(meshKey(s, opts));
}

/** mesh a sculpt, cached by content hash */
export function meshSculpt(s: Sculpt, opts: MeshOpts): MeshData {
  const key = meshKey(s, opts);
  const hit = dataCache.get(key);
  if (hit) {
    stats.hits++;
    return hit;
  }
  const d = meshSdf(s.compile(), opts);
  stats.misses++;
  stats.ms += d.ms;
  dataCache.set(key, d);
  return d;
}

/** mesh a sculpt in the worker pool (deduplicated, cached like `meshSculpt`) */
export function meshSculptAsync(s: Sculpt, opts: MeshOpts): Promise<MeshData> {
  const key = meshKey(s, opts);
  const hit = dataCache.get(key);
  if (hit) {
    stats.hits++;
    return Promise.resolve(hit);
  }
  let p = inflight.get(key);
  if (!p) {
    p = meshSdfAsync(s.compile(), opts).then(
      (d) => {
        inflight.delete(key);
        stats.misses++;
        stats.async++;
        stats.ms += d.ms;
        dataCache.set(key, d);
        return d;
      },
      (e) => {
        inflight.delete(key);
        throw e;
      },
    );
    inflight.set(key, p);
  }
  return p;
}

/** mesh a sculpt straight to a shared BufferGeometry (cached; do not dispose shared geometries) */
export function sculptGeometry(s: Sculpt, opts: MeshOpts): THREE.BufferGeometry {
  const key = meshKey(s, opts);
  let g = geoCache.get(key);
  if (!g) {
    g = meshDataToGeometry(meshSculpt(s, opts));
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

/** generic keyed cache for anything expensive (geometries built from several sculpts, textures…) */
const anyCache = new Map<string, unknown>();
export function cached<T>(key: string, make: () => T): T {
  if (anyCache.has(key)) return anyCache.get(key) as T;
  const v = make();
  anyCache.set(key, v);
  return v;
}

export function kitCacheStats() {
  return { ...stats, entries: dataCache.size + geoCache.size + anyCache.size };
}
export function clearKitCache() {
  dataCache.clear();
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
  anyCache.clear();
  stats = { hits: 0, misses: 0, ms: 0, async: 0 };
}
