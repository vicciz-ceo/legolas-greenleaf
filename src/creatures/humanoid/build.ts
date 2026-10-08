/**
 * Builds & caches the shared assets of a humanoid kind for a seed bucket (≤4 per kind) and armour
 * configuration: rig, sculpted body+clothing+gear geometry per LOD, hair cards per LOD, eyes.
 * Instances (createHumanoid) only create bones, SkinnedMeshes and cloned materials.
 */
import * as THREE from 'three';
import type { HumanoidKind, HumanoidSpec } from '../../core/types';
import { Rng, hashSeed } from '../../core/rng';
import { Sculpt } from '../kit/sdf';
import { meshSculpt } from '../kit/cache';
import { meshDataToGeometry, mergeKitGeometries, paintGeometry, triCount } from '../kit/geometry';
import { createCreatureMaterial } from '../kit/material';
import { createHairMaterial } from '../kit/hair';
import type { RigDef } from '../kit/rig';
import type { SurfaceName, SurfaceSpec } from '../kit/surfaces';
import { resolveKind } from './registry';
import { computeProportions, buildRig, type Proportions } from './proportions';
import { anatomyParts, emitParts } from './anatomy';
import { sculptHead, type HeadInfo } from './face';
import { sculptOutfit } from './outfit';
import { skirtGeometry, cloakGeometry } from './cloth';
import { sculptHairCap, buildHair } from './hairstyles';
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

export function getHumanoidAssets(spec: HumanoidSpec): HumanoidAssets {
  const def = resolveKind(spec.kind);
  const bucket = seedBucket(spec.seed);
  const armor = Math.round((spec.armor ?? 0.5) * 4) / 4;
  const helmet = spec.helmet !== false;
  const key = `${spec.kind}|${bucket}|${armor}|${helmet ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t0 = performance.now();
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
  if (def.hair && !out.hood) sculptHairCap(sc, P, def.hair);
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

  // ── mesh (LOD0 now; LOD1/LOD2 deferred) ──
  // heroes (with a face region) get finer defaults; crowds/enemies are coarser (≤ ~12k tris)
  const faceRes = def.detail.faceRes < 0 ? 0 : def.detail.faceRes;
  const hero = faceRes > 0;
  const res = def.detail.res || (hero ? 0.024 : 0.03) * s;
  const headRes = def.detail.headRes || (hero ? 0.0085 : 0.0115) * s * Math.sqrt(def.build.headSize);
  const longHair = !!def.hair && !hooded && ['long_straight', 'long_wavy', 'shoulder', 'mane', 'wild', 'tied_back'].includes(def.hair.style);
  const u = P.headH;
  // the back of a long-haired head is covered by hair: keep it at body resolution
  const headMin: [number, number, number] = [head.headBox.min[0], P.h(0, -0.68, 0)[1], longHair ? P.h(0, 0, -0.2)[2] : head.headBox.min[2]];
  const headMax: [number, number, number] = [head.headBox.max[0], head.headBox.max[1], head.headBox.max[2]];
  const regions = [
    { min: headMin, max: headMax, res: headRes, band: res * 1.5 },
    ...(faceRes > 0 ? [{ min: P.h(-0.27, -0.6, 0.14), max: P.h(0.27, 0.06, 0.56), res: faceRes, band: headRes * 3 }] : []),
    ...(hero ? (['l', 'r'] as const) : []).map((sd) => {
      const w = P.j[`hand_${sd}`];
      const r = (P.palm + P.finger) * 1.15;
      const x0 = sd === 'l' ? w[0] - 0.03 * s : w[0] - r;
      const x1 = sd === 'l' ? w[0] + r : w[0] + 0.03 * s;
      return { min: [x0, w[1] - r, w[2] - 0.06 * s] as [number, number, number], max: [x1, w[1] + 0.03 * s, w[2] + 0.07 * s] as [number, number, number], res: Math.max(headRes * 1.2, 0.0105 * s), band: res * 1.5 };
    }),
  ];
  void u;
  const ao = DEBUG.has('noao') ? (false as const) : { dist: 0.07 * s, strength: 1 };
  const m0 = DEBUG.has('uniform')
    ? meshSculpt(sc, { res: headRes, ao })
    : meshSculpt(sc, { res, regions: DEBUG.has('noregions') ? [] : regions, ao });
  (globalThis as { __kitDebug?: Record<string, unknown> }).__kitDebug ??= {};
  (globalThis as { __kitDebug?: Record<string, unknown> }).__kitDebug![key] = { lod0Passes: m0.passTris, gear: gear.length, gearTris: gear.reduce((a, g) => a + triCount(g.geo), 0), meshMs: m0.ms };
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
    const m1 = meshSculpt(sc, { res: res * 1.5, regions: [{ min: headMin, max: headMax, res: headRes * 1.9, band: res * 2.2 }], ao: ao ? { dist: ao.dist, strength: 1 } : false, smooth: 2 });
    const g1 = meshDataToGeometry(m1);
    const body1 = mergeKitGeometries([g1, ...cloth, ...bigGear, ...smallGear]);
    const body2 = mergeKitGeometries([g1, ...cloth, ...bigGear]);
    g1.dispose();
    for (const g of [...cloth, ...bigGear, ...smallGear]) g.dispose();
    body1.userData.shared = true;
    body2.userData.shared = true;
    const hair1 = buildHair(P, rig, def.hair, def.beard, new Rng(hashSeed(spec.kind, bucket, 'hair')), 1, hooded);
    if (hair1.geo) hair1.geo.userData.shared = true;
    return { body1, body2, hair1: hair1.geo };
  };

  const hair0 = buildHair(P, rig, def.hair, def.beard, new Rng(hashSeed(spec.kind, bucket, 'hair')), 0, hooded);
  if (hair0.geo) hair0.geo.userData.shared = true;

  // ── eyes: two spheres rigid to the head ──
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
  const hcl = new THREE.Color().setHex(hairCol, THREE.SRGBColorSpace);
  const hairLum = hcl.r * 0.3 + hcl.g * 0.59 + hcl.b * 0.11;
  const hairMat = createHairMaterial({ roughness: 0.6, anisotropy: 0.5 + 0.7 * Math.min(1, hairLum * 2), sheen: 0.25, sheenColor: hairCol });
  hairMat.specularIntensity = 0.12 + 0.25 * Math.min(1, hairLum * 1.5);
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
    helmet: arm.helmet,
    buildMs: performance.now() - t0,
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
  scheduleLowLod(finishLods);
  cache.set(key, assets);
  return assets;
}

function eyesGeometry(rig: RigDef, head: HeadInfo): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hb = rig.boneIndex('head');
  for (const sd of ['l', 'r'] as const) {
    const c = head.eyes[sd];
    const g = new THREE.SphereGeometry(head.eyes.radius, 14, 10).rotateX(Math.PI / 2);
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
  const W = 128, H = 64;
  const data = new Uint8Array(W * H * 4);
  const glow = new Uint8Array(W * H * 4);
  const ci = new THREE.Color().setHex(iris, THREE.SRGBColorSpace);
  const cs = new THREE.Color().setHex(sclera, THREE.SRGBColorSpace);
  const rnd = new Rng(hashSeed('eye', iris));
  const streak = Array.from({ length: W }, () => 0.75 + rnd.float() * 0.5);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 bottom … 1 top (pole = front of the eye)
    const th = (1 - v) * Math.PI; // angle from the front pole
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r: number, g: number, b: number, gl = 0;
      const pupil = 0.075 * Math.PI;
      const irisR = 0.2 * Math.PI;
      if (th < pupil) {
        r = g = b = 0.015;
      } else if (th < irisR) {
        const f = (th - pupil) / (irisR - pupil);
        const k = streak[x] * (0.55 + 0.6 * f) * (f > 0.86 ? 0.45 : 1);
        const inner = f < 0.3 ? 0.75 + f : 1;
        r = ci.r * k * inner;
        g = ci.g * k * inner;
        b = ci.b * k * inner;
        gl = f > 0.86 ? 0.2 : 1;
      } else {
        const back = Math.min(1, (th - irisR) / (0.6 * Math.PI));
        const vein = Math.max(0, Math.sin(x * 0.9 + y * 0.3) * Math.sin(x * 0.23) - 0.6) * back;
        r = cs.r * (1 - 0.12 * back) + vein * 0.25;
        g = cs.g * (1 - 0.18 * back) - vein * 0.1;
        b = cs.b * (1 - 0.2 * back) - vein * 0.1;
        // limbal shadow ring
        if (th < irisR + 0.03 * Math.PI) {
          r *= 0.7;
          g *= 0.7;
          b *= 0.7;
        }
      }
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
