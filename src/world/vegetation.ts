/**
 * Vegetation builders: trees (5 kinds, wind in the vertex shader), instanced forests with chunked LOD,
 * grass fields, ferns, mushrooms, web sheets and cocoons.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import type { Vec3Tuple } from '../core/types';
import { getLeafAtlas, LEAF_CELLS, cellRect } from './leafAtlas';
import { applyMacroVariation, applyWind, patchShader, tickWind } from './shader';
import { makeMaterial } from './textures';
import { buildTreeGeometry, sheet, Buf, type TreeKind, type V3 } from './treegeo';
import type { Area, HeightFn } from './util';
import type { ColliderDesc } from './colliders';
import { densityScale } from './quality';

export type { TreeKind };
export const TREE_KINDS: readonly TreeKind[] = ['mirkwood_oak', 'beech', 'pine', 'dead', 'birch'];

// ───────────────────────────────────────────────────────────────────────────────────────────
// Materials (cached per kind, shared by every tree)
// ───────────────────────────────────────────────────────────────────────────────────────────

const matCache = new Map<string, THREE.Material>();

function barkMaterial(kind: TreeKind): THREE.MeshStandardMaterial {
  const key = `bark:${kind}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  switch (kind) {
    case 'mirkwood_oak':
      m = makeMaterial('mossy_bark', { macro: { scale: 0.09, strength: 0.28, tint: 0.05 } }) as THREE.MeshStandardMaterial;
      m.color.setRGB(0.78, 0.8, 0.74);
      applyWind(m, { bend: 1.1, flutter: 0 });
      break;
    case 'beech':
      m = makeMaterial('bark', { macro: { scale: 0.12, strength: 0.2, tint: 0.04 } }) as THREE.MeshStandardMaterial;
      m.color.setRGB(1.5, 1.52, 1.5);
      applyWind(m, { bend: 0.8, flutter: 0 });
      break;
    case 'pine':
      m = makeMaterial('bark', { macro: { scale: 0.12, strength: 0.25, tint: 0.06 } }) as THREE.MeshStandardMaterial;
      m.color.setRGB(1.25, 0.8, 0.62);
      applyWind(m, { bend: 0.7, flutter: 0 });
      break;
    case 'dead':
      m = makeMaterial('bark', { macro: { scale: 0.12, strength: 0.2, tint: 0.02 } }) as THREE.MeshStandardMaterial;
      m.color.setRGB(1.35, 1.32, 1.28);
      applyWind(m, { bend: 0.4, flutter: 0 });
      break;
    case 'birch':
      m = makeMaterial('birch_bark', { macro: { scale: 0.15, strength: 0.12, tint: 0.02 } }) as THREE.MeshStandardMaterial;
      applyWind(m, { bend: 1.0, flutter: 0 });
      break;
  }
  m.name = `tree_bark:${kind}`;
  matCache.set(key, m);
  return m;
}

/** foliage material: atlas sprigs, alpha tested, double sided, vertex colour tint, wind + flutter */
function leafMaterial(key: string, o: { bend: number; flutter: number; emissive?: number; roughness?: number } = { bend: 1, flutter: 0.2 }): THREE.MeshStandardMaterial {
  const k = `leaf:${key}`;
  let m = matCache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: getLeafAtlas(),
    alphaTest: 0.46,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: o.roughness ?? 0.72,
    metalness: 0,
    emissive: new THREE.Color(0x1c2a12),
    emissiveIntensity: o.emissive ?? 0.12,
    envMapIntensity: 0.9,
  });
  m.name = `tree_leaf:${key}`;
  applyWind(m, { bend: o.bend, flutter: o.flutter });
  // light bleeding through the leaf: brighten where the face points away from the camera light
  patchShader(m, 'leafSSS', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (gl_FrontFacing ? 0.0 : 0.05);`,
    );
  });
  matCache.set(k, m);
  return m;
}

function leafMatFor(kind: TreeKind): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'mirkwood_oak': return leafMaterial('mirk', { bend: 1.4, flutter: 0.16, emissive: 0.05 });
    case 'beech': return leafMaterial('beech', { bend: 1.0, flutter: 0.2 });
    case 'pine': return leafMaterial('pine', { bend: 0.8, flutter: 0.08, emissive: 0.08 });
    case 'dead': return leafMaterial('dead', { bend: 0.5, flutter: 0.25, emissive: 0.0 });
    case 'birch': return leafMaterial('birch', { bend: 1.2, flutter: 0.3, emissive: 0.14 });
  }
}

function webMaterial(): THREE.Material {
  let m = matCache.get('web');
  if (!m) {
    const mm = makeMaterial('web', { transparent: true, depthWrite: false, side: THREE.DoubleSide }) as THREE.MeshStandardMaterial;
    mm.alphaTest = 0.04;
    mm.color.setRGB(1.3, 1.3, 1.25);
    mm.emissive = new THREE.Color(0x202020);
    mm.emissiveIntensity = 0.25;
    applyWind(mm, { bend: 0.5, flutter: 0 });
    m = mm;
    matCache.set('web', m);
  }
  return m;
}

const tick = (): void => tickWind();

// ───────────────────────────────────────────────────────────────────────────────────────────
// Single tree
// ───────────────────────────────────────────────────────────────────────────────────────────

export interface TreeResult {
  object: THREE.Group;
  colliders: ColliderDesc[];
  height: number;
  trunkRadius: number;
}

function treeColliders(kind: TreeKind, r: number): ColliderDesc[] {
  return [{ kind: 'cyl', x: 0, z: 0, r, y0: -1, y1: kind === 'mirkwood_oak' ? 18 : 10, opts: { walkable: false, material: 'wood', tag: 'tree' } }];
}

/** one tree (not instanced) built from the shared cached geometry. Origin at the base. */
export function tree(kind: TreeKind, seed = 0): TreeResult {
  const variant = Math.abs(Math.floor(seed)) % 4;
  const g = buildTreeGeometry(kind, variant, 0);
  const group = new THREE.Group();
  group.name = `tree:${kind}`;
  const bark = new THREE.Mesh(g.bark, barkMaterial(kind));
  bark.castShadow = bark.receiveShadow = true;
  bark.onBeforeRender = tick;
  group.add(bark);
  if (g.leaves) {
    const leaves = new THREE.Mesh(g.leaves, leafMatFor(kind));
    leaves.castShadow = leaves.receiveShadow = true;
    leaves.userData.noAO = true;
    leaves.onBeforeRender = tick;
    group.add(leaves);
  }
  if (g.webs) {
    const webs = new THREE.Mesh(g.webs, webMaterial());
    webs.userData.noAO = true;
    webs.renderOrder = 2;
    webs.onBeforeRender = tick;
    group.add(webs);
  }
  return { object: group, colliders: treeColliders(kind, g.colliderR), height: g.height, trunkRadius: g.trunkR };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Forest
// ───────────────────────────────────────────────────────────────────────────────────────────

export interface ForestOpts {
  seed?: number;
  /** scale range (default 0.85..1.2) */
  scale?: [number, number];
  /** extra spacing between trunks (m) */
  spacing?: number;
  /** variants per kind (1..4, default 3) */
  variants?: number;
  /** skip positions: return true to reject */
  exclude?: (x: number, z: number) => boolean;
  /** circular clearings */
  clearings?: { x: number; z: number; r: number }[];
  /** chunk size for culling (m, default 48) */
  chunk?: number;
  /** distance where the full-detail model switches to the simple one (default 70) */
  lodNear?: number;
  /** distance beyond which trees are not drawn (default 280) */
  lodFar?: number;
  /** register trunk colliders (default true) */
  colliders?: boolean;
  /** forest-wide leaf tint multiplier */
  leafTint?: [number, number, number];
}

export interface ForestTree {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  radius: number;
  height: number;
}

export interface ForestResult {
  object: THREE.Group;
  colliders: ColliderDesc[];
  trees: ForestTree[];
}

type KindSpec = TreeKind | { kind: TreeKind; weight?: number };

/** Instanced forest. Colliders are in WORLD space (the object sits at the origin). */
export function forest(area: Area, count: number, kinds: KindSpec[], heightAt: HeightFn, opts: ForestOpts = {}): ForestResult {
  const rng = new Rng(hashSeed('forest', opts.seed ?? 1, count, area.center.x, area.center.z));
  const specs = kinds.map((k) => (typeof k === 'string' ? { kind: k, weight: 1 } : { kind: k.kind, weight: k.weight ?? 1 }));
  const wsum = specs.reduce((s, k) => s + k.weight, 0);
  const nVar = Math.max(1, Math.min(4, opts.variants ?? 3));
  const [smin, smax] = opts.scale ?? [0.85, 1.2];
  const chunk = opts.chunk ?? 48;
  const near = opts.lodNear ?? 70;
  const far = opts.lodFar ?? 280;
  const spacing = opts.spacing ?? 0.8;
  const group = new THREE.Group();
  group.name = 'forest';

  // ── placement (dart throwing with a spatial hash) ──
  const trees: ForestTree[] = [];
  const cell = 8;
  const hash = new Map<string, number[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const maxR = 4;
  let attempts = 0;
  while (trees.length < count && attempts < count * 40) {
    attempts++;
    let pick = rng.float() * wsum;
    let kind = specs[0].kind;
    for (const s of specs) {
      pick -= s.weight;
      if (pick <= 0) { kind = s.kind; break; }
    }
    const x = area.center.x + (rng.float() * 2 - 1) * area.halfSize[0];
    const z = area.center.z + (rng.float() * 2 - 1) * area.halfSize[1];
    if (opts.exclude?.(x, z)) continue;
    if (opts.clearings?.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    const variant = Math.floor(rng.float() * nVar);
    const g = buildTreeGeometry(kind, variant, 0);
    const scale = smin + rng.float() * (smax - smin);
    const r = g.colliderR * scale;
    let ok = true;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const reach = Math.ceil((maxR + 2) / cell);
    for (let dz = -reach; dz <= reach && ok; dz++) {
      for (let dx = -reach; dx <= reach && ok; dx++) {
        const list = hash.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const idx of list) {
          const t = trees[idx];
          if (Math.hypot(t.x - x, t.z - z) < (t.radius + r) * 1.15 + spacing) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const y = heightAt(x, z);
    const id = trees.length;
    trees.push({ kind, x, y, z, scale, radius: r, height: g.height * scale });
    (trees[id] as ForestTree & { variant?: number }).variant = variant;
    const k = key(x, z);
    const l = hash.get(k);
    if (l) l.push(id);
    else hash.set(k, [id]);
  }

  // ── group by chunk / kind / variant ──
  interface Bucket { kind: TreeKind; variant: number; idx: number[] }
  const chunks = new Map<string, { cx: number; cz: number; buckets: Map<string, Bucket> }>();
  trees.forEach((t, i) => {
    const variant = (t as ForestTree & { variant?: number }).variant ?? 0;
    const ccx = Math.floor(t.x / chunk);
    const ccz = Math.floor(t.z / chunk);
    const ck = `${ccx},${ccz}`;
    let c = chunks.get(ck);
    if (!c) chunks.set(ck, (c = { cx: ccx, cz: ccz, buckets: new Map() }));
    const bk = `${t.kind}:${variant}`;
    let b = c.buckets.get(bk);
    if (!b) c.buckets.set(bk, (b = { kind: t.kind, variant, idx: [] }));
    b.idx.push(i);
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  const lt = opts.leafTint ?? [1, 1, 1];
  const crng = new Rng(hashSeed('forest-col', opts.seed ?? 1));

  for (const c of chunks.values()) {
    const center = new THREE.Vector3((c.cx + 0.5) * chunk, 0, (c.cz + 0.5) * chunk);
    for (const b of c.buckets.values()) {
      const lod = new THREE.LOD();
      lod.position.copy(center);
      lod.name = `forest:${b.kind}`;
      const lv: THREE.Object3D[] = [new THREE.Group(), new THREE.Group()];
      for (let li = 0; li < 2; li++) {
        const g = buildTreeGeometry(b.kind, b.variant, li as 0 | 1);
        const n = b.idx.length;
        const barkM = new THREE.InstancedMesh(g.bark, barkMaterial(b.kind), n);
        const leafM = g.leaves ? new THREE.InstancedMesh(g.leaves, leafMatFor(b.kind), n) : null;
        const webM = g.webs && li === 0 ? new THREE.InstancedMesh(g.webs, webMaterial(), n) : null;
        b.idx.forEach((ti, k) => {
          const t = trees[ti];
          e.set((crng.float() - 0.5) * 0.03, crng.float() * Math.PI * 2, (crng.float() - 0.5) * 0.03);
          q.setFromEuler(e);
          sc.set(t.scale, t.scale * (0.96 + crng.float() * 0.08), t.scale);
          pv.set(t.x - center.x, t.y - 0.25 * t.scale, t.z - center.z);
          m.compose(pv, q, sc);
          barkM.setMatrixAt(k, m);
          leafM?.setMatrixAt(k, m);
          webM?.setMatrixAt(k, m);
          const v = 0.82 + crng.float() * 0.3;
          col.setRGB(v, v, v);
          barkM.setColorAt(k, col);
          const hv = 0.85 + crng.float() * 0.3;
          col.setRGB(hv * lt[0] * (0.95 + crng.float() * 0.1), hv * lt[1], hv * lt[2] * (0.92 + crng.float() * 0.12));
          leafM?.setColorAt(k, col);
        });
        for (const mesh of [barkM, leafM, webM]) {
          if (!mesh) continue;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = mesh !== webM;
          mesh.receiveShadow = true;
          mesh.onBeforeRender = tick;
        }
        if (leafM) leafM.userData.noAO = true;
        if (webM) { webM.userData.noAO = true; webM.renderOrder = 2; }
        (lv[li] as THREE.Group).add(barkM);
        if (leafM) (lv[li] as THREE.Group).add(leafM);
        if (webM) (lv[li] as THREE.Group).add(webM);
      }
      lod.addLevel(lv[0], 0);
      lod.addLevel(lv[1], near);
      lod.addLevel(new THREE.Object3D(), far);
      group.add(lod);
    }
  }

  const colliders: ColliderDesc[] = [];
  if (opts.colliders !== false) {
    for (const t of trees) {
      colliders.push({ kind: 'cyl', x: t.x, z: t.z, r: t.radius, y0: t.y - 1, y1: t.y + (t.kind === 'mirkwood_oak' ? 18 : 10), opts: { walkable: false, material: 'wood', tag: 'tree' } });
    }
  }
  return { object: group, colliders, trees };
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Grass
// ───────────────────────────────────────────────────────────────────────────────────────────

export interface GrassOpts {
  seed?: number;
  /** base colour (sRGB hex) of the blades */
  color?: number;
  /** tip colour */
  tipColor?: number;
  /** 0..1 mix of straw-yellow */
  dry?: number;
  /** blade height range (m) */
  height?: [number, number];
  /** distance where blades start to shrink / vanish (m) */
  fade?: [number, number];
  exclude?: (x: number, z: number) => boolean;
  /** density multiplier by position (0..1) e.g. thin out near paths */
  mask?: (x: number, z: number) => number;
}

const grassGeoCache = new Map<number, THREE.BufferGeometry>();

function grassClumpGeometry(blades: number, seedHeight: [number, number]): THREE.BufferGeometry {
  const key = blades * 1000 + seedHeight[0] * 100 + seedHeight[1];
  const cached = grassGeoCache.get(key);
  if (cached) return cached;
  const rng = new Rng(4242 + blades);
  const buf = new Buf();
  const segs = 3;
  for (let b = 0; b < blades; b++) {
    const a = rng.float() * Math.PI * 2;
    const rad = Math.sqrt(rng.float()) * 0.13;
    const ox = Math.cos(a) * rad;
    const oz = Math.sin(a) * rad;
    const yaw = rng.float() * Math.PI;
    const h = seedHeight[0] + rng.float() * (seedHeight[1] - seedHeight[0]);
    const w = 0.008 + rng.float() * 0.008;
    const lean = 0.15 + rng.float() * 0.5;
    const lx = Math.cos(a + rng.float() - 0.5);
    const lz = Math.sin(a + rng.float() - 0.5);
    const sx = Math.cos(yaw);
    const sz = Math.sin(yaw);
    const nx = -sz;
    const nz = sx;
    const base = buf.count;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const curve = lean * t * t * h;
      const width = w * (1 - t * 0.92);
      const cx = ox + lx * curve;
      const cz = oz + lz * curve;
      const y = t * h * (1 - lean * t * 0.18);
      for (const side of [-1, 1]) {
        buf.pos.push(cx + sx * width * side, y, cz + sz * width * side);
        // soft normal: mostly up, a bit outward
        const nn = new THREE.Vector3(nx * 0.5 + lx * 0.2, 1.0, nz * 0.5 + lz * 0.2).normalize();
        buf.nor.push(nn.x, nn.y, nn.z);
        buf.uv.push(side > 0 ? 1 : 0, t);
        buf.wind.push(t, 0);
        const shade = 0.35 + 0.65 * t + (rng.float() - 0.5) * 0.08;
        buf.col.push(shade, shade, shade);
      }
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2;
      buf.idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const g = buf.toGeometry(true);
  g.userData.shared = true;
  grassGeoCache.set(key, g);
  return g;
}

const grassMatCache = new Map<string, THREE.MeshStandardMaterial>();

function grassMaterial(o: GrassOpts): THREE.MeshStandardMaterial {
  const key = `${o.color}:${o.tipColor}:${o.dry}:${(o.fade ?? [0, 0]).join(',')}`;
  let m = grassMatCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, envMapIntensity: 0.8 });
  const base = new THREE.Color(o.color ?? 0x4a6a2a);
  const tip = new THREE.Color(o.tipColor ?? 0x9ab050);
  const dry = o.dry ?? 0.1;
  tip.lerp(new THREE.Color(0xc2b070), dry);
  base.lerp(new THREE.Color(0x7a6a3a), dry * 0.6);
  const fade = o.fade ?? [34, 62];
  m.name = 'grass';
  applyWind(m, { bend: 0.22, flutter: 0 });
  patchShader(m, `grass${key}`, (shader) => {
    shader.uniforms.uGBase = { value: new THREE.Vector3(base.r, base.g, base.b) };
    shader.uniforms.uGTip = { value: new THREE.Vector3(tip.r, tip.g, tip.b) };
    shader.uniforms.uGFade = { value: new THREE.Vector2(fade[0], fade[1]) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGBase; uniform vec3 uGTip; uniform vec2 uGFade;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 gw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float gd = distance(gw, cameraPosition);
          float gf = 1.0 - smoothstep(uGFade.x, uGFade.y, gd);
          transformed *= gf;
        }`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vColor.rgb = mix(uGBase, uGTip, color.r * color.r) * (color.r * 0.55 + 0.45) * instanceColor.rgb;`,
      );
  });
  grassMatCache.set(key, m);
  return m;
}

/**
 * Instanced grass tufts with wind. `density` = tufts per m² (scaled by quality). Chunked 16 m cells
 * with a vanishing distance, so the cost follows the camera, not the field area.
 * Returns the object only (grass has no colliders).
 */
export function grassField(area: Area, density: number, heightAt: HeightFn, opts: GrassOpts = {}): THREE.Group {
  const rng = new Rng(hashSeed('grass', opts.seed ?? 1, density, area.center.x, area.center.z));
  const dens = Math.max(0.02, density * densityScale());
  const geo = grassClumpGeometry(11, opts.height ?? [0.28, 0.58]);
  const mat = grassMaterial(opts);
  const fade = opts.fade ?? [34, 62];
  const chunk = 16;
  const group = new THREE.Group();
  group.name = 'grass';
  const x0 = area.center.x - area.halfSize[0];
  const z0 = area.center.z - area.halfSize[1];
  const nx = Math.ceil((area.halfSize[0] * 2) / chunk);
  const nz = Math.ceil((area.halfSize[1] * 2) / chunk);
  const perChunk = Math.round(dens * chunk * chunk);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + i * chunk;
      const cz = z0 + j * chunk;
      const mats: [number, number, number, number][] = [];
      for (let k = 0; k < perChunk; k++) {
        const x = cx + rng.float() * chunk;
        const z = cz + rng.float() * chunk;
        if (x > area.center.x + area.halfSize[0] || z > area.center.z + area.halfSize[1]) continue;
        if (opts.exclude?.(x, z)) continue;
        if (opts.mask && rng.float() > opts.mask(x, z)) continue;
        mats.push([x, z, rng.float() * Math.PI * 2, 0.7 + rng.float() * 0.7]);
      }
      if (!mats.length) continue;
      const center = new THREE.Vector3(cx + chunk / 2, 0, cz + chunk / 2);
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach(([x, z, yaw, s], k) => {
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        sc.set(s, s * (0.8 + rng.float() * 0.5), s);
        pv.set(x - center.x, heightAt(x, z) - 0.02, z - center.z);
        m.compose(pv, q, sc);
        mesh.setMatrixAt(k, m);
        const v = 0.8 + rng.float() * 0.4;
        col.setRGB(v * (0.95 + rng.float() * 0.1), v, v * (0.9 + rng.float() * 0.15));
        mesh.setColorAt(k, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.noAO = true;
      mesh.onBeforeRender = tick;
      const lod = new THREE.LOD();
      lod.position.copy(center);
      lod.addLevel(mesh, 0);
      lod.addLevel(new THREE.Object3D(), fade[1] + 10);
      group.add(lod);
    }
  }
  return group;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Ferns
// ───────────────────────────────────────────────────────────────────────────────────────────

let fernGeo: THREE.BufferGeometry | null = null;
function fernGeometry(): THREE.BufferGeometry {
  if (fernGeo) return fernGeo;
  const rng = new Rng(9911);
  const buf = new Buf();
  const [u0, v0, u1, v1] = cellRect(LEAF_CELLS.fern);
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + rng.float() * 0.5;
    const L = 0.75 + rng.float() * 0.45;
    const W = L * 0.5;
    const rise = 0.5 + rng.float() * 0.5;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const segs = 5;
    const base = buf.count;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      // arches up then droops
      const along = t * L * 0.9;
      const y = Math.sin(t * Math.PI * 0.8) * L * rise * 0.55 + 0.04;
      const px = cy * along;
      const pz = sy * along;
      const sx = -sy;
      const sz = cy;
      const w = (W / 2) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.15 + 0.1) * Math.PI * 0.9 + 0.2));
      for (const side of [-1, 1]) {
        buf.pos.push(px + sx * w * side, y, pz + sz * w * side);
        buf.nor.push(0, 1, 0);
        buf.uv.push(side > 0 ? u1 : u0, v1 + (v0 - v1) * t);
        buf.wind.push(t, 0.5 * t);
        const sh = 0.75 + 0.35 * t;
        buf.col.push(sh, sh, sh);
      }
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2;
      buf.idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  fernGeo = buf.toGeometry(true);
  fernGeo.userData.shared = true;
  return fernGeo;
}

export interface ScatterOpts {
  seed?: number;
  scale?: [number, number];
  exclude?: (x: number, z: number) => boolean;
  /** 0..1 clustering: higher = tighter clumps */
  clump?: number;
  tint?: [number, number, number];
}

/** instanced ferns (alpha tested frond cards, light wind) */
export function ferns(area: Area, count: number, heightAt: HeightFn, opts: ScatterOpts = {}): THREE.Object3D {
  const n = Math.max(1, Math.round(count * densityScale()));
  const rng = new Rng(hashSeed('ferns', opts.seed ?? 1, count));
  const mat = leafMaterial('fern', { bend: 0.12, flutter: 0.04, emissive: 0.1 });
  const mesh = new THREE.InstancedMesh(fernGeometry(), mat, n);
  const [smin, smax] = opts.scale ?? [0.6, 1.3];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  const tint = opts.tint ?? [0.8, 1, 0.7];
  let k = 0;
  const clumps: [number, number][] = [];
  for (let i = 0; i < Math.max(3, Math.round(n / 6)); i++) clumps.push([area.center.x + (rng.float() * 2 - 1) * area.halfSize[0], area.center.z + (rng.float() * 2 - 1) * area.halfSize[1]]);
  let guard = 0;
  while (k < n && guard++ < n * 20) {
    let x: number;
    let z: number;
    if (rng.float() < (opts.clump ?? 0.6)) {
      const c = clumps[Math.floor(rng.float() * clumps.length)];
      x = c[0] + rng.gauss() * 3;
      z = c[1] + rng.gauss() * 3;
      if (Math.abs(x - area.center.x) > area.halfSize[0] || Math.abs(z - area.center.z) > area.halfSize[1]) continue;
    } else {
      x = area.center.x + (rng.float() * 2 - 1) * area.halfSize[0];
      z = area.center.z + (rng.float() * 2 - 1) * area.halfSize[1];
    }
    if (opts.exclude?.(x, z)) continue;
    e.set((rng.float() - 0.5) * 0.15, rng.float() * Math.PI * 2, (rng.float() - 0.5) * 0.15);
    q.setFromEuler(e);
    const s = smin + rng.float() * (smax - smin);
    sc.set(s, s, s);
    pv.set(x, heightAt(x, z) - 0.03, z);
    m.compose(pv, q, sc);
    mesh.setMatrixAt(k, m);
    const v = 0.75 + rng.float() * 0.5;
    col.setRGB(v * tint[0], v * tint[1], v * tint[2]);
    mesh.setColorAt(k, col);
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.noAO = true;
  mesh.onBeforeRender = tick;
  mesh.name = 'ferns';
  return mesh;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Mushrooms
// ───────────────────────────────────────────────────────────────────────────────────────────

let mushGeo: THREE.BufferGeometry | null = null;
function mushroomGeometry(): THREE.BufferGeometry {
  if (mushGeo) return mushGeo;
  const rng = new Rng(5150);
  const parts: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.05 + rng.float() * 0.1;
    const h = 0.05 + rng.float() * 0.1 + (i === 0 ? 0.04 : 0);
    const capR = 0.03 + rng.float() * 0.045 + (i === 0 ? 0.015 : 0);
    const lean: [number, number] = [(rng.float() - 0.5) * 0.4, (rng.float() - 0.5) * 0.4];
    // stem: slightly flared cylinder
    const stem = new THREE.CylinderGeometry(capR * 0.28, capR * 0.4, h, 7, 2);
    stem.translate(0, h / 2, 0);
    // cap: dome with a lip
    const cap = new THREE.SphereGeometry(capR, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(1, 0.55, 1);
    cap.translate(0, h, 0);
    for (const [g, cr, cg, cb] of [[stem, 0.72, 0.66, 0.56], [cap, 0.46, 0.32, 0.22]] as [THREE.BufferGeometry, number, number, number][]) {
      const col = new Float32Array(g.attributes.position.count * 3);
      const jitter = 0.85 + rng.float() * 0.3;
      for (let k = 0; k < col.length; k += 3) {
        col[k] = cr * jitter;
        col[k + 1] = cg * jitter;
        col[k + 2] = cb * jitter;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      g.rotateX(lean[0]);
      g.rotateZ(lean[1]);
      g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
      parts.push(g);
    }
  }
  // merge manually (attributes position, normal, color)
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const colr = new Float32Array(total * 3);
  const idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, off * 3);
    nor.set(p.attributes.normal.array as Float32Array, off * 3);
    colr.set(p.attributes.color.array as Float32Array, off * 3);
    const pi = p.index!.array;
    for (let i = 0; i < pi.length; i++) idx.push(pi[i] + off);
    off += p.attributes.position.count;
    p.dispose();
  }
  mushGeo = new THREE.BufferGeometry();
  mushGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  mushGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  mushGeo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  mushGeo.setIndex(idx);
  mushGeo.userData.shared = true;
  return mushGeo;
}

export interface MushroomOpts extends ScatterOpts {
  /** bioluminescent (Mirkwood) */
  glow?: boolean;
  /** cap colour tint multiplier */
  capTint?: [number, number, number];
}

/** instanced mushroom clusters (small; detail comes from vertex colour and a soft sheen) */
export function mushrooms(area: Area, count: number, heightAt: HeightFn, opts: MushroomOpts = {}): THREE.Object3D {
  const n = Math.max(1, Math.round(count * densityScale()));
  const rng = new Rng(hashSeed('mush', opts.seed ?? 1, count));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0xd8c8a8) });
  if (opts.glow) {
    mat.emissive = new THREE.Color(0x2affc0);
    mat.emissiveIntensity = 0.5;
  }
  const mesh = new THREE.InstancedMesh(mushroomGeometry(), mat, n);
  const [smin, smax] = opts.scale ?? [0.7, 1.6];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const col = new THREE.Color();
  const ct = opts.capTint ?? [1, 1, 1];
  let k = 0;
  let guard = 0;
  while (k < n && guard++ < n * 20) {
    const x = area.center.x + (rng.float() * 2 - 1) * area.halfSize[0];
    const z = area.center.z + (rng.float() * 2 - 1) * area.halfSize[1];
    if (opts.exclude?.(x, z)) continue;
    e.set(0, rng.float() * Math.PI * 2, 0);
    q.setFromEuler(e);
    const s = smin + rng.float() * (smax - smin);
    sc.set(s, s, s);
    pv.set(x, heightAt(x, z) - 0.01, z);
    m.compose(pv, q, sc);
    mesh.setMatrixAt(k, m);
    const v = 0.8 + rng.float() * 0.4;
    col.setRGB(v * ct[0], v * ct[1], v * ct[2]);
    mesh.setColorAt(k, col);
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'mushrooms';
  return mesh;
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Webs and cocoons
// ───────────────────────────────────────────────────────────────────────────────────────────

/** a sagging sheet of web between four corners (world-space points, clockwise) */
export function webSheet(corners: [Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple], opts: { sag?: number; tile?: number } = {}): THREE.Mesh {
  const buf = new Buf();
  sheet(buf, corners as unknown as [V3, V3, V3, V3], 8, opts.sag ?? 0.6);
  // uv in metres / tile
  const tile = opts.tile ?? 1.2;
  const w = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]);
  const h = Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1], corners[3][2] - corners[0][2]);
  for (let i = 0; i < buf.uv.length; i += 2) {
    buf.uv[i] = (buf.uv[i] / 3) * (w / tile);
    buf.uv[i + 1] = (buf.uv[i + 1] / 3) * (h / tile);
  }
  const g = buf.toGeometry(false);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, webMaterial());
  mesh.userData.noAO = true;
  mesh.renderOrder = 2;
  mesh.name = 'web';
  mesh.onBeforeRender = tick;
  return mesh;
}

/** a webbed dwarf: silk-wrapped body hanging from a thick strand. Origin at the hanging point (top). */
export function cocoon(opts: { length?: number; seed?: number; drop?: number } = {}): THREE.Group {
  const rng = new Rng(hashSeed('cocoon', opts.seed ?? 1));
  const L = opts.length ?? 1.55; // dwarf in a cocoon, slightly taller than Gimli
  const drop = opts.drop ?? 2.2; // strand length above the body
  const g = new THREE.Group();
  g.name = 'cocoon';
  // body profile: radius over normalised height (0 = feet, 1 = head top): feet, calves, hips, shoulders, head
  const prof: [number, number][] = [
    [0.0, 0.06], [0.05, 0.16], [0.18, 0.2], [0.34, 0.27], [0.5, 0.33], [0.62, 0.34], [0.72, 0.3], [0.78, 0.2], [0.84, 0.17], [0.92, 0.19], [0.98, 0.14], [1.0, 0.0],
  ];
  const rows = 40;
  const seg = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const nz = (a: number, b: number) => Math.sin(a * 12.9898 + b * 78.233) * 43758.5453 % 1;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    let r = 0;
    for (let k = 0; k < prof.length - 1; k++) {
      if (t >= prof[k][0] && t <= prof[k + 1][0]) {
        const f = (t - prof[k][0]) / (prof[k + 1][0] - prof[k][0]);
        r = prof[k][1] + (prof[k + 1][1] - prof[k][1]) * (f * f * (3 - 2 * f));
        break;
      }
    }
    // wrapped silk bands
    const band = 1 + 0.07 * Math.sin(t * 70) + 0.04 * Math.sin(t * 23 + 1.3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const lump = 1 + 0.06 * Math.sin(a * 3 + t * 9) + 0.04 * nz(i % seg, j);
      const rr = r * band * lump;
      pos.push(Math.cos(a) * rr * 1.0, -drop - (1 - t) * L, Math.sin(a) * rr * 0.9);
      uv.push((i / seg) * 2.0, t * (L / 0.5));
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const silk = makeMaterial('cloth_linen', { tint: 0xd6d2c4, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.9 });
  const body = new THREE.Mesh(geo, silk);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // strand
  const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, drop + 0.2, 6), silk);
  strand.position.y = -drop / 2 + 0.05;
  g.add(strand);
  // a few loose web sheets draped over the body
  for (let i = 0; i < 3; i++) {
    const a = rng.float() * Math.PI * 2;
    const y0 = -drop - L * (0.2 + rng.float() * 0.6);
    const s = webSheet(
      [
        [Math.cos(a) * 0.15, y0 + 0.5, Math.sin(a) * 0.15],
        [Math.cos(a) * 0.9, y0 + 0.2, Math.sin(a) * 0.9],
        [Math.cos(a + 0.6) * 0.9, y0 - 0.6, Math.sin(a + 0.6) * 0.9],
        [Math.cos(a + 0.3) * 0.15, y0 - 0.5, Math.sin(a + 0.3) * 0.15],
      ],
      { sag: 0.3 },
    );
    g.add(s);
  }
  g.userData.bodyHeight = L;
  g.userData.hangDrop = drop;
  return g;
}
