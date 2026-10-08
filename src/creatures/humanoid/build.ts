/**
 * Builds & caches the shared assets of a humanoid kind for a seed bucket (≤4 per kind) and armour
 * configuration: rig, sculpted body+clothing+gear geometry per LOD, hair cards per LOD, eyes.
 * Instances (createHumanoid) only create bones, SkinnedMeshes and cloned materials.
 */
import * as THREE from 'three';
import type { HumanoidKind, HumanoidSpec } from '../../core/types';
import { Rng, hashSeed } from '../../core/rng';
import { Sculpt } from '../kit/sdf';
import { meshSculpt, meshSculptAsync, hasMesh } from '../kit/cache';
import type { MeshOpts, MeshRegion } from '../kit/mesher';
import { meshDataToGeometry, mergeKitGeometries, paintGeometry, triCount } from '../kit/geometry';
import { createCreatureMaterial } from '../kit/material';
import { createHairMaterial } from '../kit/hair';
import type { RigDef } from '../kit/rig';
import type { SurfaceName, SurfaceSpec } from '../kit/surfaces';
import { resolveKind } from './registry';
import { computeProportions, buildRig, type Proportions } from './proportions';
import { anatomyParts, emitParts } from './anatomy';
import { sculptHead, type HeadInfo } from './face';
import { sculptOutfit, type OutfitResult } from './outfit';
import { skirtGeometry, cloakGeometry } from './cloth';
import { sculptHairCap, buildHair, mergeHair } from './hairstyles';
import { faceHairGeometry } from './facehair';
import { sdfProbe } from '../kit/sdf';
import { makeGearSink, armorGear, buckleGear, type GearPiece } from './gear';
import type { KindContext, ResolvedKind } from './types';

export interface LodAssets {
  body: THREE.BufferGeometry;
  hair: THREE.BufferGeometry | null;
  tris: number;
}

export interface ExtraObject {
  make: () => THREE.Object3D;
  bone?: string;
  socket?: string;
  small?: boolean;
}

export interface HumanoidAssets {
  key: string;
  /** bumps when the deferred LOD1/LOD2 geometry is ready */
  lodVersion: number;
  /** build LOD1/LOD2 now if they are still pending */
  ensureLods?: () => void;
  lowLodMs?: number;
  kind: HumanoidKind;
  def: ResolvedKind;
  P: Proportions;
  rig: RigDef;
  head: HeadInfo;
  lods: [LodAssets, LodAssets, LodAssets];
  eyes: THREE.BufferGeometry;
  bodyMat: THREE.MeshPhysicalMaterial;
  hairMat: THREE.MeshPhysicalMaterial;
  eyeMat: THREE.MeshPhysicalMaterial;
  objects: ExtraObject[];
  helmet: boolean;
  buildMs: number;
}

const cache = new Map<string, HumanoidAssets>();

/** debug flags from the URL (?kitdebug=noao,noregions,nodetail,uniform) — lab diagnostics only */
const DEBUG = new Set(
  typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('kitdebug') ?? '').split(',').filter(Boolean) : [],
);

// deferred low-LOD builds: one job per macrotask after the current frame
const lowLodQueue: (() => void)[] = [];
let lowLodTimer: ReturnType<typeof setTimeout> | null = null;
function pumpLowLods() {
  lowLodTimer = null;
  const job = lowLodQueue.shift();
  if (job) job();
  if (lowLodQueue.length) lowLodTimer = setTimeout(pumpLowLods, 16);
}
function scheduleLowLod(job: () => void) {
  lowLodQueue.push(job);
  if (!lowLodTimer) lowLodTimer = setTimeout(pumpLowLods, 50);
}
/** synchronously finish every pending LOD build (tests, loading screens) */
export function flushHumanoidLods() {
  while (lowLodQueue.length) lowLodQueue.shift()!();
}

export function seedBucket(seed: number | undefined): number {
  if (!seed) return 0;
  return hashSeed('bucket', seed) % 4;
}

function needsHairChain(def: ResolvedKind) {
  const h = def.hair;
  return !!h && ['long_straight', 'long_wavy', 'shoulder', 'mane', 'wild', 'stringy', 'tied_back'].includes(h.style);
}

/** humanoid asset cache key: (kind, seed bucket, quantised armour, helmet) */
export function humanoidKey(spec: HumanoidSpec): string {
  const bucket = seedBucket(spec.seed);
  const armor = Math.round((spec.armor ?? 0.5) * 4) / 4;
  const helmet = spec.helmet !== false;
  return `${spec.kind}|${bucket}|${armor}|${helmet ? 1 : 0}`;
}

/** everything sculpted on the main thread before meshing (meshing may run in workers) */
export interface Prepared {
  key: string;
  spec: HumanoidSpec;
  def: ResolvedKind;
  vdef: ResolvedKind;
  bucket: number;
  P: Proportions;
  rig: RigDef;
  sc: Sculpt;
  head: HeadInfo;
  out: OutfitResult;
  gear: GearPiece[];
  objects: ExtraObject[];
  helmet: boolean;
  hooded: boolean;
  armor: number;
  opts0: MeshOpts;
  opts1: MeshOpts;
  ms: number;
}

const prepCache = new Map<string, Prepared>();

/** phase 1: resolve the kind, compute proportions/rig and sculpt body, face, outfit, armour and gear */
export function prepareHumanoid(spec: HumanoidSpec): Prepared {
  const key = humanoidKey(spec);
  const hitP = prepCache.get(key);
  if (hitP) return hitP;
  const t0 = performance.now();
  const def = resolveKind(spec.kind);
  const bucket = seedBucket(spec.seed);
  const armor = Math.round((spec.armor ?? 0.5) * 4) / 4;
  const helmet = spec.helmet !== false;
  const rng = new Rng(hashSeed(spec.kind, bucket, 'humanoid'));
  // seed-bucket variation (bucket 0 is the canonical look)
  const vary = (amt: number) => (bucket === 0 ? 0 : (rng.float() * 2 - 1) * amt);
  const height = def.height * (1 + vary(def.variation.height));
  const bulkMul = 1 + vary(def.variation.bulk);
  const skirtLayer = def.outfit.some((l) => ['tunic', 'robe', 'rags', 'mail_shirt', 'gambeson', 'skirt', 'loincloth'].includes(l.type) && (l.length ?? 0.4) > 0.05);
  const P = computeProportions(def, height, bulkMul, {
    hairChain: needsHairChain(def),
    skirt: skirtLayer,
    cloak: def.outfit.some((l) => l.type === 'cloak'),
    beard: !!def.beard && def.beard.length > 0.06,
    quiver: true,
  });
  const rig = buildRig(P);
  const s = P.s;

  // ── skin tone variation ──
  const skin = { ...def.skin };
  if (bucket !== 0 && def.variation.skin > 0) {
    const c = new THREE.Color().setHex(skin.color, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h + vary(def.variation.skin) * 0.1, hsl.s, Math.max(0.03, hsl.l * (1 + vary(def.variation.skin))));
    skin.color = c.getHex(THREE.SRGBColorSpace);
  }
  const vdef: ResolvedKind = { ...def, skin, outfit: def.outfit.filter((l) => !DEBUG.has('no-' + l.type)) };

  // ── sculpt ──
  const sc = new Sculpt(rig, { skinK: 0.035 * s });
  const parts = anatomyParts(P);
  const skinOpts = {
    color: skin.color,
    color2: skin.color2,
    colorNoise: skin.blotch,
    colorFreq: 14 / s,
    mat: skin.surface as SurfaceName,
    noise: skin.warts > 0 ? { amp: 0.0025 * s * skin.warts, freq: 60 / s, type: 'cells' as const, seed: bucket } : undefined,
  };
  sc.with(skinOpts, () => emitParts(sc, parts, () => true));
  const head = sculptHead(sc, P, vdef, rng);
  const out = sculptOutfit(sc, P, parts, vdef, rng);
  const gear: GearPiece[] = [];
  const sink = makeGearSink(rig, gear);
  const arm = armorGear(sink, P, vdef, def.armor.filter((a) => armor >= (a.minArmor ?? 0) && (a.chance === undefined || rng.float() < a.chance)), rng, helmet);
  const hooded = !!out.hood || arm.helmet;
  if (def.hair && !out.hood) sculptHairCap(sc, P, def.hair, hooded);
  if (out.beltY !== undefined) buckleGear(sink, P, out.beltY, 0xb0a080);
  const objects: ExtraObject[] = [];
  const ctx: KindContext = {
    kind: spec.kind,
    def: vdef,
    spec,
    P,
    rig,
    sculpt: sc,
    rng,
    gear: (geo, o) => sink.add(geo, o as { bone: string; color: number; mat?: SurfaceName | SurfaceSpec; matrix?: THREE.Matrix4; small?: boolean }),
    object: (make, o) => objects.push({ make, ...o }),
    armor,
    helmet,
  };
  for (const fn of def.extras) fn(ctx);

  // ── mesh options (LOD0 + LOD1) ──
  // heroes (with a face region) get finer defaults; crowds/enemies are coarser (≤ ~12k tris)
  const faceRes = def.detail.faceRes < 0 ? 0 : def.detail.faceRes;
  const hero = faceRes > 0;
  const res = def.detail.res || (hero ? 0.024 : 0.03) * s;
  const headRes = def.detail.headRes || (hero ? 0.0085 : 0.0115) * s * Math.sqrt(def.build.headSize);
  const longHair = !!def.hair && !hooded && ['long_straight', 'long_wavy', 'shoulder', 'mane', 'wild', 'tied_back'].includes(def.hair.style);
  // the back of a long-haired head is covered by hair: keep it at body resolution
  const headMin: [number, number, number] = [head.headBox.min[0], P.h(0, -0.68, 0)[1], longHair ? P.h(0, 0, -0.2)[2] : head.headBox.min[2]];
  const headMax: [number, number, number] = [head.headBox.max[0], head.headBox.max[1], head.headBox.max[2]];
  const regions: MeshRegion[] = [
    { min: headMin, max: headMax, res: headRes, band: res * 1.5, aoScale: 0.6 },
    ...(faceRes > 0 ? [{ min: P.h(-0.27, -0.6, 0.14), max: P.h(0.27, 0.06, 0.56), res: faceRes, band: headRes * 3, aoScale: 0.3 }] : []),
    // ears are thin plates: give heroes a finer region so the rim and point stay clean
    ...(faceRes > 0
      ? ([1, -1] as const).map((sx) => {
          const a = P.h(sx * 0.285, -0.27, -0.19), b = P.h(sx * 0.44, 0.22, 0.05);
          return { min: [Math.min(a[0], b[0]), a[1], a[2]] as [number, number, number], max: [Math.max(a[0], b[0]), b[1], b[2]] as [number, number, number], res: faceRes * 1.2, band: headRes * 2, aoScale: 0.4 };
        })
      : []),
    ...(hero ? (['l', 'r'] as const) : []).map((sd) => {
      const w = P.j[`hand_${sd}`];
      const r = (P.palm + P.finger) * 1.15;
      // starts just past the wrist so the region seam never crosses a bracer/glove/sleeve edge
      const x0 = sd === 'l' ? w[0] + 0.004 * s : w[0] - r;
      const x1 = sd === 'l' ? w[0] + r : w[0] - 0.004 * s;
      return { min: [x0, w[1] - r, w[2] - 0.06 * s] as [number, number, number], max: [x1, w[1] - 0.004 * s, w[2] + 0.07 * s] as [number, number, number], res: Math.max(headRes * 0.72, 0.0062 * s), band: res * 1.5, aoScale: 0.45 };
    }),
  ];
  const ao = DEBUG.has('noao') ? (false as const) : { dist: 0.07 * s, strength: 1 };
  // heroes: the face cells (≈ 5 mm) are refined too, so lips/brows/lid colour edges stay clean
  const refine = DEBUG.has('norefine') ? undefined : { levels: hero ? 2 : 1, threshold: 0.07, minEdge: (hero ? 0.0038 : 0.0065) * s };
  const opts0: MeshOpts = DEBUG.has('uniform') ? { res: headRes, ao } : { res, regions: DEBUG.has('noregions') ? [] : regions, ao, refine };
  const opts1: MeshOpts = { res: res * 1.5, regions: [{ min: headMin, max: headMax, res: headRes * 1.9, band: res * 2.2, aoScale: 0.7 }], ao: ao ? { dist: ao.dist, strength: 1 } : false, smooth: 2 };
  const prep: Prepared = { key, spec, def, vdef, bucket, P, rig, sc, head, out, gear, objects, helmet: arm.helmet, hooded, armor, opts0, opts1, ms: performance.now() - t0 };
  prepCache.set(key, prep);
  return prep;
}

/** phase 2: mesh (cache hit when preloaded by the worker pool), merge gear/cloth, hair, eyes, materials */
function assembleHumanoid(prep: Prepared): HumanoidAssets {
  const t0 = performance.now();
  const { key, spec, def, vdef, bucket, P, rig, sc, head, out, gear, objects, hooded } = prep;
  const skin = vdef.skin;
  const m0 = meshSculpt(sc, prep.opts0);
  (globalThis as { __kitDebug?: Record<string, unknown> }).__kitDebug ??= {};
  (globalThis as { __kitDebug?: Record<string, unknown> }).__kitDebug![key] = { lod0Passes: m0.passTris, lod0Tris: m0.triCount, gear: gear.length, gearTris: gear.reduce((a, g) => a + triCount(g.geo), 0), meshMs: m0.ms };
  const cloth: THREE.BufferGeometry[] = [];
  if (out.skirt) cloth.push(skirtGeometry(P, rig, { ...out.skirt, seed: bucket }));
  if (out.cloak) cloth.push(cloakGeometry(P, rig, { ...out.cloak, seed: bucket }));
  const bigGear = gear.filter((g) => !g.small).map((g) => g.geo);
  const smallGear = gear.filter((g) => g.small).map((g) => g.geo);
  const g0 = meshDataToGeometry(m0);
  const body0 = mergeKitGeometries([g0, ...cloth, ...bigGear, ...smallGear]);
  g0.dispose();
  body0.userData.shared = true;
  /** LOD1/LOD2: coarser sculpt + same gear (LOD2 drops small gear and hair). Built later. */
  const buildLowLods = () => {
    const m1 = meshSculpt(sc, prep.opts1);
    const g1 = meshDataToGeometry(m1);
    const body1 = mergeKitGeometries([g1, ...cloth, ...bigGear, ...smallGear]);
    const body2 = mergeKitGeometries([g1, ...cloth, ...bigGear]);
    g1.dispose();
    for (const g of [...cloth, ...bigGear, ...smallGear]) g.dispose();
    body1.userData.shared = true;
    body2.userData.shared = true;
    const hair1 = withFaceHair(buildHair(P, rig, def.hair, def.beard, new Rng(hashSeed(spec.kind, bucket, 'hair')), 1, hooded).geo, 1);
    if (hair1) hair1.userData.shared = true;
    prepCache.delete(key);
    return { body1, body2, hair1 };
  };

  // eyelashes + eyebrow cards placed on the sculpted surface
  const probe = sdfProbe(sc.compile(), head.faceBox.min, head.faceBox.max);
  const browCol = skin.brows;
  const lashCol = mixHexB(skin.brows, 0x140e0a, 0.62);
  const withFaceHair = (g: THREE.BufferGeometry | null, lod: 0 | 1) => {
    if (def.face.brow > 1.5 && skin.surface !== 'skin') return g; // brutes: bare brow ridges
    const fh = faceHairGeometry(P, head, probe, rig.boneIndex('head'), { browColor: browCol, lashColor: lashCol, brows: def.face.brow > 1.3 ? 0.6 : 1 }, lod);
    if (!fh) return g;
    if (!g) return fh;
    const m = mergeHair([g, fh]);
    g.dispose();
    fh.dispose();
    return m;
  };
  const hair0 = { geo: withFaceHair(buildHair(P, rig, def.hair, def.beard, new Rng(hashSeed(spec.kind, bucket, 'hair')), 0, hooded).geo, 0) };
  if (hair0.geo) hair0.geo.userData.shared = true;

  // ── eyes: eyeballs + lashes rigid to the head ──
  const eyeGeo = eyesGeometry(rig, head);
  eyeGeo.userData.shared = true;

  const bodyMat = createCreatureMaterial({
    detailScale: def.detail.detailScale,
    scatterColor: skin.scatter,
    side: THREE.DoubleSide,
    wrap: skin.surface === 'skin' ? 0.6 : 0.4,
    detailStrength: DEBUG.has('nodetail') ? 0 : 1,
  });
  const hairCol = def.hair?.color ?? def.beard?.color ?? 0x302010;
  const hairMat = hairMaterialFor(hairCol);
  const eyeMat = eyeMaterial(def.eyes.color, def.eyes.glow, def.eyes.sclera);

  const lod0: LodAssets = { body: body0, hair: hair0.geo, tris: triCount(body0) + (hair0.geo ? triCount(hair0.geo) : 0) + triCount(eyeGeo) };
  const assets: HumanoidAssets = {
    key,
    kind: spec.kind,
    def: vdef,
    P,
    rig,
    head,
    // LOD1/LOD2 start as LOD0 and are replaced when the deferred build finishes
    lods: [lod0, lod0, lod0],
    lodVersion: 0,
    eyes: eyeGeo,
    bodyMat,
    hairMat,
    eyeMat,
    objects,
    helmet: prep.helmet,
    buildMs: prep.ms + performance.now() - t0,
  };
  const finishLods = () => {
    if (assets.lodVersion > 0) return;
    const t1 = performance.now();
    const r = buildLowLods();
    assets.lods[1] = { body: r.body1, hair: r.hair1, tris: triCount(r.body1) + (r.hair1 ? triCount(r.hair1) : 0) + triCount(eyeGeo) };
    assets.lods[2] = { body: r.body2, hair: null, tris: triCount(r.body2) };
    assets.lodVersion = 1;
    assets.lowLodMs = performance.now() - t1;
  };
  assets.ensureLods = finishLods;
  // preloaded (LOD1 mesh already in the cache): finish now; otherwise defer off the current frame
  if (hasMesh(sc, prep.opts1)) finishLods();
  else scheduleLowLod(finishLods);
  cache.set(key, assets);
  return assets;
}

export function getHumanoidAssets(spec: HumanoidSpec): HumanoidAssets {
  const hit = cache.get(humanoidKey(spec));
  if (hit) return hit;
  return assembleHumanoid(prepareHumanoid(spec));
}

/**
 * Build the shared assets of several humanoid specs in parallel: sculpting runs on the main
 * thread (one spec per macrotask), the LOD0 + LOD1 meshing of every spec runs in the kit worker
 * pool at the same time, then geometry is assembled (cache hits). Already-built specs are skipped.
 */
export const prebuildStats = { prepareMs: 0, meshWaitMs: 0, assembleMs: 0, specs: 0 };
export async function prebuildHumanoids(specs: HumanoidSpec[], onProgress?: (frac: number) => void): Promise<void> {
  const seen = new Set<string>();
  const todo: HumanoidSpec[] = [];
  for (const sp of specs) {
    const k = humanoidKey(sp);
    if (seen.has(k) || cache.has(k)) continue;
    seen.add(k);
    todo.push(sp);
  }
  if (!todo.length) {
    onProgress?.(1);
    return;
  }
  const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
  const total = todo.length * 4;
  let done = 0;
  const tick = () => onProgress?.(Math.min(1, ++done / total));
  const preps: Prepared[] = [];
  const jobs: Promise<unknown>[] = [];
  prebuildStats.specs += todo.length;
  for (const sp of todo) {
    await yieldTask();
    const t0 = performance.now();
    const prep = prepareHumanoid(sp);
    preps.push(prep);
    tick();
    // LOD0 first for every spec, LOD1 jobs queue behind them
    jobs.push(meshSculptAsync(prep.sc, prep.opts0).then(tick));
    prebuildStats.prepareMs += performance.now() - t0;
  }
  for (const prep of preps) jobs.push(meshSculptAsync(prep.sc, prep.opts1).then(tick));
  const tw = performance.now();
  await Promise.all(jobs);
  prebuildStats.meshWaitMs += performance.now() - tw;
  for (const prep of preps) {
    await yieldTask();
    const t0 = performance.now();
    if (!cache.has(prep.key)) assembleHumanoid(prep).ensureLods?.();
    prebuildStats.assembleMs += performance.now() - t0;
    tick();
  }
}

function mixHexB(a: number, b: number, t: number): number {
  const c1 = new THREE.Color().setHex(a, THREE.SRGBColorSpace);
  const c2 = new THREE.Color().setHex(b, THREE.SRGBColorSpace);
  return c1.lerp(c2, t).getHex(THREE.SRGBColorSpace);
}

function hairMaterialFor(hairCol: number): THREE.MeshPhysicalMaterial {
  const hcl = new THREE.Color().setHex(hairCol, THREE.SRGBColorSpace);
  const hairLum = hcl.r * 0.3 + hcl.g * 0.59 + hcl.b * 0.11;
  const hairMat = createHairMaterial({ roughness: 0.6, anisotropy: 0.5 + 0.7 * Math.min(1, hairLum * 2), sheen: 0.25, sheenColor: hairCol });
  hairMat.specularIntensity = 0.12 + 0.25 * Math.min(1, hairLum * 1.5);
  return hairMat;
}

function eyesGeometry(rig: RigDef, head: HeadInfo): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hb = rig.boneIndex('head');
  for (const sd of ['l', 'r'] as const) {
    const c = head.eyes[sd];
    const g = new THREE.SphereGeometry(head.eyes.radius, 24, 16).rotateX(Math.PI / 2);
    // the eye opening is wider than a sphere's silhouette: widen slightly so no corner shows a gap
    g.scale(1.08, 1, 1);
    // slight outward gaze for a natural look
    g.rotateY(sd === 'l' ? 0.05 : -0.05);
    g.translate(c[0], c[1], c[2]);
    parts.push(g);
  }
  // merge with uv + skinning to the head bone
  const out = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let vo = 0;
  for (const g of parts) {
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
    const ia = g.index!.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + vo);
    vo += g.attributes.position.count;
    g.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const n = vo;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = hb;
    sw[i * 4] = 1;
  }
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(idx);
  void paintGeometry;
  return out;
}

const eyeTexCache = new Map<string, { map: THREE.DataTexture; glow: THREE.DataTexture }>();
function eyeTextures(iris: number, sclera: number) {
  const key = `${iris}|${sclera}`;
  const hit = eyeTexCache.get(key);
  if (hit) return hit;
  // equirectangular around the eyeball; the +Y pole of the sphere (v = 1) is the front (pupil)
  const W = 512, H = 256;
  const data = new Uint8Array(W * H * 4);
  const glow = new Uint8Array(W * H * 4);
  const ci = new THREE.Color().setHex(iris, THREE.SRGBColorSpace);
  const cs = new THREE.Color().setHex(sclera, THREE.SRGBColorSpace);
  const rnd = new Rng(hashSeed('eye', iris));
  // radial iris fibres: a smooth random profile around the circumference
  const fib = Array.from({ length: W }, () => rnd.float());
  const fibS = fib.map((_, x) => {
    let a = 0;
    for (let k = -2; k <= 2; k++) a += fib[(x + k + W) % W] * (k === 0 ? 0.4 : 0.15);
    return a;
  });
  const crypt = Array.from({ length: W }, () => (rnd.float() < 0.12 ? rnd.range(0.35, 0.75) : -1));
  const pupil = 0.058 * Math.PI;
  const irisR = 0.168 * Math.PI;
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const th = (1 - v) * Math.PI; // angle from the front pole
    const sth = Math.sin(th);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const phi = (x / W) * Math.PI * 2;
      // direction on the eyeball (after the sphere is rotated so +Y → +Z): dx lateral, dy up
      const dx = -Math.cos(phi) * sth;
      const dy = -Math.sin(phi) * sth;
      let r: number, g: number, b: number, gl = 0;
      if (th < pupil * 0.92) {
        r = g = b = 0.012;
      } else if (th < irisR) {
        const f = (th - pupil) / (irisR - pupil); // 0 pupil edge … 1 limbus
        const fibre = 0.72 + 0.5 * fibS[x] + 0.12 * Math.sin(x * 0.9 + f * 9);
        // collarette (lighter ring) and darker limbal ring
        const coll = 1 + 0.35 * Math.exp(-Math.pow((f - 0.32) * 7, 2));
        const limb = f > 0.82 ? 1 - 0.65 * Math.min(1, (f - 0.82) / 0.18) : 1;
        const inner = 0.75 + 0.25 * Math.min(1, f * 3);
        const cr = crypt[x] > 0 && Math.abs(f - crypt[x]) < 0.06 ? 0.7 : 1;
        const pe = th < pupil ? (th - pupil * 0.92) / (pupil * 0.08) : 1; // soft pupil edge
        const k = fibre * coll * limb * inner * cr * Math.max(0, Math.min(1, pe));
        r = ci.r * k + 0.012 * (1 - pe);
        g = ci.g * k + 0.012 * (1 - pe);
        b = ci.b * k + 0.012 * (1 - pe);
        gl = f > 0.85 ? 0.2 : 1;
      } else {
        const back = Math.min(1, (th - irisR) / (0.5 * Math.PI));
        const corner = Math.min(1, Math.max(0, (Math.abs(dx) - 0.35) / 0.4));
        const vein = Math.max(0, Math.sin(x * 0.45 + y * 0.31) * Math.sin(x * 0.11 + 1.7) - 0.75) * corner * 2;
        r = cs.r * (1 - 0.08 * back) + vein * 0.12 + corner * 0.05;
        g = cs.g * (1 - 0.14 * back) - vein * 0.06 - corner * 0.03;
        b = cs.b * (1 - 0.16 * back) - vein * 0.06 - corner * 0.03;
        // soft limbal shadow just outside the iris
        const lr = Math.max(0, 1 - (th - irisR) / (0.035 * Math.PI));
        r *= 1 - 0.35 * lr;
        g *= 1 - 0.35 * lr;
        b *= 1 - 0.35 * lr;
      }
      // the upper lid and lashes shade the top of the eyeball; the corners are in shadow too
      const lid = 1 - 0.5 * Math.min(1, Math.max(0, (dy - 0.12) / 0.32)) - 0.15 * Math.min(1, Math.max(0, (-dy - 0.3) / 0.3));
      const side = 1 - 0.25 * Math.min(1, Math.max(0, (Math.abs(dx) - 0.45) / 0.35));
      r *= lid * side;
      g *= lid * side;
      b *= lid * side;
      const toS = (c: number) => Math.round(Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2) * 255);
      data[i] = toS(r);
      data[i + 1] = toS(g);
      data[i + 2] = toS(b);
      data[i + 3] = 255;
      glow[i] = glow[i + 1] = glow[i + 2] = Math.round(gl * 255);
      glow[i + 3] = 255;
    }
  }
  const mk = (d: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    t.userData.shared = true;
    return t;
  };
  const res = { map: mk(data, true), glow: mk(glow, false) };
  eyeTexCache.set(key, res);
  return res;
}

function eyeMaterial(iris: number, glowAmt: number, sclera: number): THREE.MeshPhysicalMaterial {
  const tex = eyeTextures(iris, sclera);
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.map,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    metalness: 0,
    specularIntensity: 0.6,
  });
  if (glowAmt > 0) {
    m.emissive = new THREE.Color().setHex(iris, THREE.SRGBColorSpace);
    m.emissiveMap = tex.glow;
    m.emissiveIntensity = glowAmt;
  }
  return m;
}

export function humanoidAssetStats() {
  return [...cache.values()].map((a) => ({ key: a.key, ms: Math.round(a.buildMs), tris: a.lods.map((l) => l.tris) }));
}

/** drop cached humanoid assets (benchmarks / hot reload). Shared geometry is disposed. */
export function clearHumanoidCache() {
  for (const a of cache.values()) {
    for (const l of a.lods) {
      l.body.dispose();
      l.hair?.dispose();
    }
    a.eyes.dispose();
  }
  cache.clear();
  lowLodQueue.length = 0;
}
