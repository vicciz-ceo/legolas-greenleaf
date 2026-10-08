/**
 * Bucket-specific hair and beards. The kit grows hair from the static `KindDef`; the dwarves and
 * orcs need a different look per seed bucket, so the kinds here define `hair: stringy (no
 * strands)` / `beard: stubble` (which only creates the spring-bone chains) and everything visible
 * is grown here from the kit's own strand API and attached as a skinned extra (see common.ts).
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { growStrands, hairGeometry, createHairMaterial, type BraidDef, type EllipsoidCollider, type GrowRoot, type Strand, type WeightFn } from '../../../kit/hair';
import type { V3 } from '../../../kit/sdf';
import { buildHair } from '../../hairstyles';
import type { HairDef, KindContext } from '../../types';
import { attachSkinned, luminance, mergeHairGeos } from './common';

const matCache = new Map<number, THREE.MeshPhysicalMaterial>();

/** the hair material the kit uses for a given hair colour (shared between instances) */
export function hairMaterial(color: number, opts: { rough?: number } = {}): THREE.MeshPhysicalMaterial {
  const key = color * 8 + (opts.rough ? 1 : 0);
  let m = matCache.get(key);
  if (!m) {
    const lum = luminance(color);
    m = createHairMaterial({ roughness: opts.rough ?? 0.6, anisotropy: 0.5 + 0.7 * Math.min(1, lum * 2), sheen: 0.25, sheenColor: color });
    m.specularIntensity = 0.12 + 0.25 * Math.min(1, lum * 1.5);
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/**
 * A braid as a tapered tube with a twisted three-strand colour pattern (about 1/4 of the triangles
 * of the kit's braid tubes). Carries the same attributes as hairGeometry (uv, colour, skin weights).
 */
export function braidGeometry(points: V3[], radius: number, color: number, weights: WeightFn, o: { seg?: number; radial?: number; taper?: number; twist?: number } = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 10;
  const radial = o.radial ?? 5;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.3);
  const len = curve.getLength();
  const frames = curve.computeFrenetFrames(seg, false);
  const base = new THREE.Color().setHex(color, THREE.SRGBColorSpace);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
  const wtmp: [number, number][] = [];
  const c = new THREE.Color();
  const q = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radius * (1 - (o.taper ?? 0.4) * t * t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const lump = 0.78 + 0.22 * Math.abs(Math.sin(a * 1.5 + t * len * (o.twist ?? 40)));
      nrm.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      q.copy(p).addScaledVector(nrm, r * lump);
      pos.push(q.x, q.y, q.z);
      nor.push(nrm.x, nrm.y, nrm.z);
      uv.push(j / radial, t);
      c.copy(base).multiplyScalar(0.72 + 0.28 * lump);
      col.push(c.r, c.g, c.b);
      wtmp.length = 0;
      weights(q, t, wtmp);
      wtmp.sort((x, y) => y[1] - x[1]);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += wtmp[k]?.[1] ?? 0;
      sum = sum || 1;
      for (let k = 0; k < 4; k++) {
        si.push(wtmp[k]?.[0] ?? 0);
        sw.push((wtmp[k]?.[1] ?? 0) / sum);
      }
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const pendingHair = new WeakMap<object, { geos: THREE.BufferGeometry[]; color: number }>();

/** collect a hair geometry; `flushHair` merges everything queued for this build into ONE skinned mesh (one draw call) */
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
  if (merged) attachSkinned(ctx, merged, hairMaterial(e.color));
}

/** run a kind's extras and merge all the hair/beard geometry it queued into one skinned mesh */
export function withHair(ctx: KindContext, fn: () => void) {
  fn();
  flushHair(ctx);
}

/** hair of the head via the kit's own styles (cap + cards + braids), as a skinned extra */
export function addHeadHair(ctx: KindContext, hair: HairDef, rng: Rng, o: { hooded?: boolean; cap?: boolean } = {}) {
  const geo = buildHair(ctx.P, ctx.rig, hair, null, rng, 0, !!o.hooded).geo;
  if (geo) queueHair(ctx, geo, hair.color);
  return geo;
}

export interface HairdoOpts {
  color: number;
  tip?: number;
  deep?: number;
  /** longest strand (m, already scaled by P.s) */
  length: number;
  /** number of cards at LOD0 */
  count: number;
  /** card width (m, scaled) */
  width?: number;
  gravity?: number;
  wave?: number;
  /** hairline height (head units) at the forehead and at the nape */
  front?: number;
  back?: number;
  /** 0 = lies on the scalp, 1 = wild and standing */
  wild?: number;
  /** sweep: +1 combed back, 0 falls straight, -1 forward */
  comb?: number;
  segments?: number;
  /** tie the hair at the nape into a tail of this length (m); 0 = loose */
  tail?: number;
  /** keep hair off the face and shoulders with bigger colliders */
  faceClear?: number;
  /** skip roots above this height (head units): hair that must stay under a hat */
  maxY?: number;
  /** only a ridge along the centre line, standing up (mohawk) */
  mohawk?: boolean;
  /** half-width of the mohawk ridge (head units) */
  ridge?: number;
}

/**
 * Head hair grown from the scalp: swept back from the forehead, over and behind the ears, down
 * the back. The colliders include the whole face (brow, nose) so strands never cross it.
 */
export function makeHairdo(ctx: KindContext, o: HairdoOpts, rng: Rng): THREE.BufferGeometry | null {
  const { P, rig } = ctx;
  const u = P.headH;
  const s = P.s;
  const h = P.h;
  const bulk = Math.sqrt(P.build.bulk);
  const fc = o.faceClear ?? 1;
  const colliders: EllipsoidCollider[] = [
    { c: h(0, 0.045, -0.055), r: [0.34 * u, 0.41 * u, 0.435 * u] },
    { c: h(0, -0.12, 0.2), r: [0.31 * u * fc, 0.34 * u, 0.36 * u * fc] },
    { c: h(0, -0.3, 0.12), r: [0.28 * u, 0.34 * u, 0.3 * u] },
    { c: [0, P.j.neck[1] + 0.02 * s, -0.02 * s], r: [0.085 * s * P.build.neckThick, 0.13 * s, 0.085 * s] },
    { c: [0, P.j.upperarm_l[1] - 0.1 * s, -0.015 * s], r: [P.shoulderX + 0.045 * s, 0.24 * s, 0.135 * s * P.build.chest * bulk] },
    { c: [0, P.j.chest[1] - 0.03 * s, -0.01 * s], r: [0.165 * s * P.build.shoulders * bulk, 0.26 * s, 0.135 * s * P.build.chest * bulk] },
    { c: h(0.36, -0.08, -0.04), r: [0.06 * u, 0.16 * u, 0.1 * u] },
    { c: h(-0.36, -0.08, -0.04), r: [0.06 * u, 0.16 * u, 0.1 * u] },
  ];
  const hasChain = rig.has('hair1');
  const iHead = rig.boneIndex('head');
  const iH1 = rig.boneIndex('hair1');
  const iH2 = rig.boneIndex('hair2');
  const iH3 = rig.boneIndex('hair3');
  const hc = P.headC;
  const napeY = hc[1] - 0.32 * u;
  const y1 = hasChain ? P.j.hair1[1] : 0;
  const y2 = hasChain ? P.j.hair2[1] : 0;
  const y3 = hasChain ? P.j.hair3[1] : 0;
  const weights: WeightFn = (p, _a, out) => {
    const behind = p.z < hc[2] - 0.1 * u;
    if (!hasChain || !behind || p.y > napeY + 0.04 * s) {
      out.push([iHead, 1]);
      return;
    }
    const tHead = Math.max(0, Math.min(1, (napeY + 0.04 * s - p.y) / (0.08 * s)));
    out.push([iHead, 1 - tHead]);
    let a1 = 0, a2 = 0, a3 = 0;
    if (p.y >= y2) {
      const t = Math.max(0, Math.min(1, (y1 - p.y) / Math.max(0.01, y1 - y2)));
      a1 = 1 - t;
      a2 = t;
    } else {
      const t = Math.max(0, Math.min(1, (y2 - p.y) / Math.max(0.01, y2 - y3)));
      a2 = 1 - t;
      a3 = t;
    }
    out.push([iH1, a1 * tHead], [iH2, a2 * tHead], [iH3, a3 * tHead]);
  };
  const front = o.front ?? 0.2;
  const back = o.back ?? -0.38;
  const wild = o.wild ?? 0.2;
  const comb = o.comb ?? 1;
  const roots: GrowRoot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = o.count * 5;
  const tmp = new THREE.Color();
  for (let i = 0; i < total && roots.length < o.count; i++) {
    const yy = 1 - (i / (total - 1)) * 1.7;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i;
    const dx = Math.cos(th) * rr, dz = Math.sin(th) * rr, dy = yy;
    const layer = roots.length % 3;
    const lift = 0.004 + layer * 0.005;
    const hx = dx * (0.34 + lift / u * s), hy = 0.045 + dy * (0.41 + lift / u * s), hz = -0.055 + dz * (0.435 + lift / u * s);
    const slope = (front - back) / 0.87;
    if (hy < back + slope * (hz + 0.45)) continue;
    if (Math.abs(hx) > 0.27 && hy < 0.03 && hz > -0.22) continue;
    if (o.mohawk && Math.abs(hx) > (o.ridge ?? 0.06)) continue;
    if (o.maxY !== undefined && hy > o.maxY) continue;
    const nrm = new THREE.Vector3(dx / 0.34, dy / 0.41, dz / 0.435).normalize();
    const frontness = Math.max(0, Math.min(1, (hz + 0.1) / 0.5));
    // combed back; the front strands first lift over the forehead
    const want = new THREE.Vector3(dx * 0.4 + (rng.float() - 0.5) * (0.2 + wild), 0.25 * frontness - 0.3 * (1 - frontness) - 0.1, -comb - 0.2 * (1 - comb) * 0 + (rng.float() - 0.5) * wild * 0.6);
    want.addScaledVector(nrm, -want.dot(nrm));
    if (want.lengthSq() < 0.05) want.set(0, -1, -0.3);
    if (o.mohawk) want.set((rng.float() - 0.5) * 0.3, 0.9, -0.35 - 0.5 * frontness * 0);
    want.normalize();
    const f = Math.min(1, Math.max(0, (hy - back) / (front - back + 0.6)));
    tmp.setHex(layer === 2 ? (o.deep ?? o.color) : layer === 1 ? (o.tip ?? o.color) : o.color, THREE.SRGBColorSpace);
    roots.push({
      p: h(hx, hy, hz),
      dir: [want.x, want.y, want.z],
      length: o.length * (0.72 + 0.3 * rng.float()) * (1 - 0.18 * f),
      lift: lift * s,
      width: (o.width ?? 0.035) * s * (0.8 + rng.float() * 0.45),
      color: tmp.getHex(THREE.SRGBColorSpace),
    });
  }
  const strands = growStrands(roots, {
    segments: o.segments ?? 7,
    gravity: ((o.gravity ?? 6) * 3) / s,
    colliders,
    jitter: 0.06 + wild * 0.2,
    seed: rng.int(1, 1e6),
    taper: 0.4,
    wave: o.wave ? { amp: 0.016 * s * o.wave, length: 0.11 * s } : undefined,
    hug: o.mohawk ? undefined : 0,
    hugUntil: -0.3,
  });
  const braids: BraidDef[] = [];
  if (o.tail && o.tail > 0) {
    braids.push({ points: [h(0, -0.1, -0.5), h(0, -0.3, -0.58), [0, hc[1] - 0.5 * u - o.tail * 0.5, -0.1 * s * P.build.chest * bulk - 0.05 * s], [0, hc[1] - 0.5 * u - o.tail, -0.115 * s * P.build.chest * bulk - 0.06 * s]], radius: 0.02 * s, color: o.color, twist: 25 });
  }
  if (!strands.length && !braids.length) return null;
  const sGeo = strands.length ? hairGeometry(strands, [], { color: o.color, tipColor: o.tip, weights }) : null;
  const bGeos = braids.map((b) => braidGeometry(b.points, b.radius, o.color, weights, { seg: 9, radial: 5 }));
  return mergeHairGeos([...(sGeo ? [sGeo] : []), ...bGeos]);
}

export function addHairdo(ctx: KindContext, o: HairdoOpts, rng: Rng) {
  const geo = makeHairdo(ctx, o, rng);
  if (geo) queueHair(ctx, geo, o.color);
  return geo;
}

export interface BeardOpts {
  color: number;
  tip?: number;
  /** darker colour of the inner strands and the sculpted mass underneath */
  deep?: number;
  /** length of the longest lock below the chin (m, already scaled by P.s) */
  length: number;
  /** locks across the face (default 15) */
  locks?: number;
  /** strands per lock (default 9) */
  perLock?: number;
  /** extra width of the beard mass across the jaw (1 = follows the jaw) */
  spread?: number;
  /** length profile across the jaw: 'spade' = longest in the middle, 'forked' = two points, 'even' */
  shape?: 'spade' | 'forked' | 'even' | 'goatee' | 'round';
  /** hair on the cheeks up to the cheekbones and in front of the ears */
  cheeks?: boolean;
  moustache?: { length: number; droop?: number; curl?: number } | null;
  /** how much the locks wave (0..1) */
  wave?: number;
  /** braids hanging from the chin: x (head units, 0 = centre), length (m) */
  braids?: { x: number; length: number; radius?: number; y?: number }[];
  /** card width (m, already scaled) */
  width?: number;
  gravity?: number;
  segments?: number;
  /** sculpted hair volume under the cards: 0 = none */
  mass?: number;
  /** extra clearance over the chest for thick garments (m, already scaled) */
  clear?: number;
}

export interface BeardResult {
  geo: THREE.BufferGeometry | null;
  /** points along each braid (model space) so callers can place clasps and beads */
  braidPaths: V3[][];
}

/** surface of the lower face used to root the strands (head units) */
function facePoint(x: number, y: number): [number, number, number] {
  const cx = 0, cy = -0.3, cz = 0.12, rx = 0.265, ry = 0.33, rz = 0.3;
  const k = 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2;
  return [x, y, cz + rz * Math.sqrt(Math.max(0.02, k))];
}

/**
 * A beard grown as clumped locks over the lower face: every lock is a column of roots from the
 * cheek down to the chin whose strands share the same random bend (so they run parallel and read as
 * a lock of hair), with lengths following `shape`. Heads units are P.h(): x left+, y up, z forward.
 */
export function makeBeard(ctx: KindContext, o: BeardOpts, rng: Rng): BeardResult {
  const { P, rig } = ctx;
  const u = P.headH;
  const s = P.s;
  const h = P.h;
  const bl = o.length;
  const clr = o.clear ?? 0.02 * s;
  const spread = o.spread ?? 1;
  const shape = o.shape ?? 'spade';
  const colliders: EllipsoidCollider[] = [
    { c: h(0, -0.3, 0.12), r: [0.265 * u, 0.33 * u, 0.3 * u] },
    { c: h(0, -0.56, 0.2), r: [0.2 * u, 0.12 * u, 0.2 * u] },
    { c: [0, P.j.neck[1] + 0.0 * s, -0.01 * s], r: [0.08 * s * P.build.neckThick, 0.14 * s, 0.085 * s] },
    { c: [0, P.j.chest[1] + 0.07 * s, 0.0], r: [0.165 * s * P.build.shoulders * Math.sqrt(P.build.bulk) + clr, 0.24 * s + clr, 0.125 * s * P.build.chest * Math.sqrt(P.build.bulk) + clr] },
    { c: [0, (P.j.chest[1] + P.j.spine[1]) / 2, 0.012 * s], r: [0.15 * s * Math.sqrt(P.build.bulk) + clr, 0.2 * s + clr, 0.12 * s * Math.sqrt(P.build.bulk) * (1 + P.build.belly * 0.5) + clr] },
  ];
  const strands: Strand[] = [];
  const nLocks = o.locks ?? 15;
  const per = o.perLock ?? 9;
  const segs = o.segments ?? 7;
  const deep = o.deep ?? o.color;
  const lengthAt = (a: number): number => {
    const aa = Math.abs(a);
    switch (shape) {
      case 'forked': return 0.35 + 0.65 * Math.sin(Math.min(1, aa * 1.5) * Math.PI * 0.5) * (aa > 0.75 ? 1 - (aa - 0.75) * 2.2 : 1);
      case 'even': return 0.7 + 0.3 * (1 - aa);
      case 'goatee': return aa > 0.5 ? 0 : 1 - aa;
      case 'round': return 0.55 + 0.45 * Math.cos(aa * 1.2);
      default: return 0.28 + 0.72 * Math.pow(Math.max(0, 1 - aa * 0.9), 1.3);
    }
  };
  for (let li = 0; li < nLocks; li++) {
    const a = nLocks === 1 ? 0 : (li / (nLocks - 1)) * 2 - 1;
    const aj = a + (rng.float() - 0.5) * (1.5 / nLocks);
    const lf = lengthAt(aj);
    if (lf <= 0.02) continue;
    const x = Math.sin(aj * 1.25) * 0.27 * spread;
    const yBot = -0.2 - 0.4 * Math.pow(1 - Math.abs(aj) * 0.75, 1.2) * 1 - 0.0;
    const yTop = o.cheeks === false ? yBot + 0.08 : -0.17 + (Math.abs(aj) > 0.7 ? 0.05 : 0);
    const roots: GrowRoot[] = [];
    for (let k = 0; k < per; k++) {
      const t = per === 1 ? 0 : k / (per - 1);
      let y = yTop + (yBot - yTop) * t;
      // keep the mouth clear: strands from above the lip start below it in the middle
      if (Math.abs(x) < 0.12 && y > -0.31 && y < -0.2) y = -0.47;
      const lat = (rng.float() - 0.5) * 0.055;
      const xx = x + lat;
      const [fx, fy, fz] = facePoint(xx, y);
      if (Math.abs(xx) < 0.11 && fy > -0.46 && fy < -0.3) continue;
      const layer = k % 3;
      const colr = layer === 2 ? deep : layer === 1 ? (o.tip ?? o.color) : o.color;
      roots.push({
        p: h(fx, fy, fz),
        dir: [-xx * 0.5 + (aj * 0.15), -1, 0.4],
        length: (bl + 0.03 * s) * lf * (0.92 + rng.float() * 0.12) * (0.55 + 0.45 * (1 - t * 0.0)) * (0.7 + 0.3 * Math.min(1, (-y - 0.17) / 0.3)) + 0.02 * s,
        lift: (0.003 + layer * 0.005) * s,
        width: (o.width ?? 0.04) * s * (0.85 + rng.float() * 0.4),
        color: colr,
      });
    }
    strands.push(
      ...growStrands(roots, {
        segments: segs,
        gravity: ((o.gravity ?? 7) * 3) / s,
        colliders,
        jitter: 0.05 + (o.wave ?? 0.3) * 0.12,
        seed: 1000 + li * 37 + rng.int(0, 9999),
        taper: 0.28,
        wave: o.wave ? { amp: 0.013 * s * o.wave, length: (0.07 + 0.04 * ((li * 7) % 3)) * s } : undefined,
      }),
    );
  }
  // moustache: sweeps out from under the nose, drooping past the mouth corners
  if (o.moustache) {
    const m = o.moustache;
    const mr: GrowRoot[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const sd = i % 2 ? -1 : 1;
      const f = Math.floor(i / 2) / (n / 2 - 1);
      const x = sd * (0.012 + f * 0.1);
      const y = -0.325 - rng.float() * 0.03;
      const z = 0.43 - f * 0.05;
      mr.push({
        p: h(x, y, z),
        dir: [sd * (0.8 + f * 0.6), -0.2 - (m.droop ?? 0.4), 0.15],
        length: m.length * (0.65 + f * 0.45) * (0.85 + rng.float() * 0.3),
        lift: 0.003 * s,
        width: 0.03 * s,
        color: o.color,
      });
    }
    strands.push(
      ...growStrands(mr, {
        segments: 5,
        gravity: (4 * 3) / s,
        colliders: [{ c: h(0, -0.3, 0.12), r: [0.265 * u, 0.33 * u, 0.3 * u] }, { c: h(0, -0.38, 0.3), r: [0.13 * u, 0.1 * u, 0.12 * u] }],
        jitter: 0.04,
        seed: rng.int(1, 1e6),
        taper: 0.4,
        wave: m.curl ? { amp: 0.01 * s * m.curl, length: 0.08 * s } : undefined,
      }),
    );
  }
  // braids hanging from the chin
  const braids: BraidDef[] = [];
  const braidPaths: V3[][] = [];
  const chestZ = 0.125 * s * P.build.chest * Math.sqrt(P.build.bulk) + clr + 0.012 * s;
  for (const b of o.braids ?? []) {
    const x = b.x;
    const y0 = b.y ?? -0.6;
    const p0 = h(x, y0, 0.3 - Math.abs(x) * 0.4);
    const yEnd = P.headC[1] - 0.6 * u - b.length;
    const pts: V3[] = [
      p0,
      [p0[0] * 1.1, p0[1] - 0.14 * u, p0[2] + 0.08 * u],
      [p0[0] * 1.25, (p0[1] + yEnd) / 2, Math.max(0.1 * s, chestZ * 0.95)],
      [p0[0] * 1.3, yEnd, Math.max(0.1 * s, chestZ * 0.97)],
    ];
    braids.push({ points: pts, radius: (b.radius ?? 0.014) * s, color: o.color, twist: 30 });
    braidPaths.push(pts);
  }
  const iJaw = rig.boneIndex('jaw');
  const iB1 = rig.boneIndex('beard1');
  const iB2 = rig.boneIndex('beard2');
  const chinY = P.headC[1] - 0.6 * u;
  const span = Math.max(0.05, bl + 0.1 * s);
  const w: WeightFn = (p, _along, out) => {
    if (iB1 < 0 || p.y > chinY) {
      out.push([iJaw, 1]);
      return;
    }
    const t = Math.min(1, (chinY - p.y) / span);
    out.push([iJaw, Math.max(0, 1 - t * 2)], [iB1, Math.min(1, t * 2) * (1 - t)], [iB2, t * t]);
  };
  const sGeo = strands.length ? hairGeometry(strands, [], { color: o.color, tipColor: o.tip, weights: w }) : null;
  const bGeos = braids.map((b) => braidGeometry(b.points, b.radius, o.color, w, { seg: 9, radial: 5 }));
  const geo = mergeHairGeos([...(sGeo ? [sGeo] : []), ...bGeos]);
  return { geo, braidPaths };
}

/**
 * Sculpted hair volume under the beard cards (so gaps never show skin and the beard has body).
 * Skinned jaw → beard1 → beard2 down its length.
 */
export function sculptBeardMass(ctx: KindContext, o: { color: number; color2?: number; length: number; width?: number; fork?: number; fullness?: number; top?: number; clear?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const sc = P.s;
  const h = P.h;
  const full = o.fullness ?? 1;
  const bone = P.has.beard ? 'beard2' : 'jaw';
  const chin = h(0, -0.5, 0.26);
  const bot: V3 = [0, P.headC[1] - 0.6 * u - o.length * 0.82, 0.075 * sc + 0.05 * u + (o.clear ?? 0.0)];
  const fork = o.fork ?? 0;
  s.with({ color: o.color, color2: o.color2 ?? o.color, colorNoise: 0.6, colorFreq: 40 / sc, mat: 'hair', noise: { amp: 0.0035 * sc, freq: 55 / sc, type: 'ridged', octaves: 2 } }, () => {
    // jaw covering: a shell over the lower face from the cheeks to the chin
    s.group('union', 0.03 * u, () => {
      s.ellipsoid(h(0, -0.36, 0.17), [0.292 * u * (o.width ?? 1), 0.24 * u, 0.3 * u], { bone: 'jaw', k: 0.04 * u });
      s.ellipsoid(h(0, -0.18, 0.09), [0.285 * u * (o.width ?? 1), 0.1 * u, 0.28 * u], { bone: 'head', k: 0.04 * u, noise: null });
      // the mouth stays visible a little: cut a shallow notch under the nose
      s.ellipsoid(h(0, -0.385, 0.405), [0.075 * u, 0.028 * u, 0.06 * u], { op: 'subtract', k: 0.02 * u });
      s.plane([0, 1, 0], P.headC[1] - 0.12 * u, { op: 'intersect', k: 0.03 * u });
    });
    // the mass hanging from the chin, wider at the top and tapering
    const dir = (f: number): V3 => [chin[0] * (1 - f) + bot[0] * f, chin[1] * (1 - f) + bot[1] * f, chin[2] * (1 - f) + bot[2] * f];
    const A = dir(0);
    const B = dir(0.55);
    const C = dir(1);
    if (fork > 0) {
      for (const sd of [1, -1]) {
        s.cone(A, [sd * fork * 0.05 * sc + B[0], B[1], B[2]], 0.17 * u * full, 0.1 * u * full, { bone: 'jaw', bone2: bone, blend: [0.05, 0.9], k: 0.06 * u });
        s.cone([sd * fork * 0.05 * sc + B[0], B[1], B[2]], [sd * fork * 0.07 * sc, C[1], C[2]], 0.1 * u * full, 0.025 * u, { bone: 'jaw', bone2: bone, blend: [0.05, 0.9], k: 0.05 * u });
      }
    } else {
      s.cone(A, B, 0.2 * u * full, 0.14 * u * full, { bone: 'jaw', bone2: bone, blend: [0.0, 0.9], k: 0.08 * u });
      s.cone(B, C, 0.14 * u * full, 0.03 * u, { bone: 'jaw', bone2: bone, blend: [0.0, 1.0], k: 0.06 * u });
    }
  });
}

/** bushy eyebrows as short strand cards along the brow ridge */
export function addBrows(ctx: KindContext, o: { color: number; length?: number; count?: number; width?: number; y?: number; z?: number; x0?: number; x1?: number; lift?: number }, rng: Rng) {
  const { P, rig } = ctx;
  const u = P.headH;
  const h = P.h;
  const n = o.count ?? 9;
  const x0 = o.x0 ?? 0.05;
  const x1 = o.x1 ?? 0.24;
  const roots: GrowRoot[] = [];
  for (const sd of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const x = sd * (x0 + (x1 - x0) * f);
      // brow ridge surface: bulges at the middle, slopes back at the outer end
      const y = (o.y ?? 0.075) + 0.012 * Math.sin(f * Math.PI) - 0.02 * f * f;
      const z = (o.z ?? 0.4) - 0.1 * f * f;
      roots.push({
        p: h(x, y, z),
        dir: [sd * (0.25 + 0.5 * f), 0.35 + 0.2 * (1 - f), 0.7],
        length: (o.length ?? 0.07) * u * (0.8 + rng.float() * 0.4) * (1 - 0.3 * f),
        lift: (o.lift ?? 0.004) * P.s,
        width: (o.width ?? 0.016) * P.s,
        color: o.color,
      });
    }
  }
  const strands = growStrands(roots, {
    segments: 3,
    gravity: 2,
    colliders: [{ c: h(0, 0.02, 0.1), r: [0.33 * u, 0.4 * u, 0.4 * u] }],
    jitter: 0.1,
    seed: rng.int(1, 1e6),
    taper: 0.3,
  });
  const iHead = rig.boneIndex('head');
  const geo = hairGeometry(strands, [], { color: o.color, weights: (_p, _a, out) => out.push([iHead, 1]) });
  queueHair(ctx, geo, o.color);
}

export function addBeard(ctx: KindContext, o: BeardOpts, rng: Rng): BeardResult {
  const r = makeBeard(ctx, o, rng);
  if (r.geo) queueHair(ctx, r.geo, o.color);
  return r;
}

export { mergeHairGeos };
