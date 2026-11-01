/**
 * Hair and beards of the company dwarves (dwarf.ts).
 *   - `HairSet` + `dwarfHairMaterial`: the strand cards of one look go into ONE skinned mesh with a
 *     material of its own (cached per look; the shared hairMaterial() cache is never mutated).
 *   - `ribbonBeard` / `hangLocks`: a few wide, overlapping wavy ribbons laid on the finished sculpt
 *     (snapped to it, so a beard drapes over the chest and hair over the shoulders) instead of
 *     hundreds of thin cards, and `sculptHairDome`: a smooth hair mass under them so no scalp
 *     shows through.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { createHairMaterial, hairGeometry, type Strand, type WeightFn } from '../../../kit/hair';
import type { KindContext } from '../../types';
import { V, snapPoint, type Projector } from '../uruks_bosses/common';
import { attachSkinned, mergeHairGeos, mix } from './common';
import { makeBeard, makeHairdo, type BeardOpts, type HairdoOpts } from './hair';
import { scalpPoint } from './markings';

const hairMats = new Map<string, THREE.MeshPhysicalMaterial>();

/** a hair material owned by one look (key = e.g. 'dwarf0'): matte, little highlight, solid cards */
export function dwarfHairMaterial(key: string, o: { color: number; spec: number; alpha?: number; highlight?: number }): THREE.MeshPhysicalMaterial {
  let m = hairMats.get(key);
  if (!m) {
    m = createHairMaterial({ roughness: 0.9, anisotropy: 0.12 * o.spec, sheen: 0.04, sheenColor: o.color, alphaTest: o.alpha ?? 0.3, highlight: o.highlight });
    m.specularIntensity = 0.04 * o.spec;
    m.userData.shared = true;
    hairMats.set(key, m);
  }
  return m;
}

/** the hair geometry of one look, merged and attached with one material */
export class HairSet {
  private geos: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry | null) {
    if (g) this.geos.push(g);
  }
  beard(ctx: KindContext, o: BeardOpts, rng: Rng) {
    const r = makeBeard(ctx, o, rng);
    this.add(r.geo);
    return r;
  }
  hairdo(ctx: KindContext, o: HairdoOpts, rng: Rng) {
    this.add(makeHairdo(ctx, o, rng));
  }
  attach(ctx: KindContext, mat: THREE.Material) {
    const merged = mergeHairGeos(this.geos);
    this.geos = [];
    if (merged) attachSkinned(ctx, merged, mat);
  }
}

/** skin weights of head hair: the head, and the spring chain behind the neck below the nape */
export function hairWeights(ctx: KindContext): WeightFn {
  const { P, rig } = ctx;
  const s = P.s;
  const u = P.headH;
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
  return (p, _a, out) => {
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
}

/** skin weights of a beard: jaw, then the beard1/beard2 spring chain down its length */
export function beardWeights(ctx: KindContext, length: number): WeightFn {
  const { P, rig } = ctx;
  const iJaw = rig.boneIndex('jaw');
  const iB1 = rig.boneIndex('beard1');
  const iB2 = rig.boneIndex('beard2');
  const chinY = P.headC[1] - 0.6 * P.headH;
  const span = Math.max(0.05, length + 0.1 * P.s);
  return (p, _a, out) => {
    if (iB1 < 0 || p.y > chinY) {
      out.push([iJaw, 1]);
      return;
    }
    const t = Math.min(1, (chinY - p.y) / span);
    out.push([iJaw, Math.max(0, 1 - t * 2)], [iB1, Math.min(1, t * 2) * (1 - t)], [iB2, t * t]);
  };
}

function strandOf(points: THREE.Vector3[], normals: THREE.Vector3[], width: number, tipWidth: number, color: number): Strand {
  return { points, normals, width, tipWidth, color };
}

export interface RibbonBeardOpts {
  color: number;
  tip: number;
  deep: number;
  /** longest lock below the chin (m) */
  length: number;
  /** locks across the jaw per layer */
  locks: number;
  layers?: number;
  /** ribbon width (m) */
  width: number;
  /** half width of the beard across the jaw (head units, 0.27 = the jaw) */
  spread?: number;
  shape?: 'spade' | 'round';
  /** how far the locks gather towards the centre line down their length (0..1) */
  taper?: number;
  /** waves: amplitude and wavelength (m) */
  amp: number;
  waveLen: number;
  /** clearance over the sculpt (m) */
  clear: number;
}

/** a beard of a few wide wavy ribbons draped over the sculpt (head, jaw, chest) */
export function ribbonBeard(ctx: KindContext, proj: Projector, rng: Rng, o: RibbonBeardOpts): THREE.BufferGeometry | null {
  const { P } = ctx;
  const u = P.headH;
  const layers = o.layers ?? 2;
  const spread = o.spread ?? 0.27;
  const shape = o.shape ?? 'spade';
  const taper = o.taper ?? (shape === 'spade' ? 0.6 : 0.25);
  const strands: Strand[] = [];
  const p = V();
  const n = V();
  const N = 11;
  const lengthAt = (a: number): number => {
    const aa = Math.abs(a);
    return shape === 'round' ? 0.55 + 0.45 * Math.cos(aa * 1.2) : 0.3 + 0.7 * Math.pow(Math.max(0, 1 - aa * 0.85), 1.2);
  };
  for (let layer = 0; layer < layers; layer++) {
    for (let i = 0; i < o.locks; i++) {
      const a0 = o.locks === 1 ? 0 : (i / (o.locks - 1)) * 2 - 1;
      const a = a0 + (rng.float() - 0.5) * (1.2 / o.locks) + (layer ? 0.5 / o.locks : 0);
      const x0 = Math.sin(a * 1.25) * spread * u;
      // cheeks to chin; the middle starts under the lip so the mouth stays clear
      const yTopU = Math.abs(a) < 0.45 ? -0.47 : -0.17 - 0.2 * Math.abs(a);
      const yTop = P.h(0, yTopU, 0)[1];
      const L = o.length * lengthAt(a) * (0.88 + 0.14 * rng.float()) + 0.04 * P.s;
      const phase = rng.float() * 6.28;
      const pts: THREE.Vector3[] = [];
      const nrm: THREE.Vector3[] = [];
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        const y = yTop - L * t;
        const x = x0 * (1 - taper * Math.pow(t, 1.3)) + o.amp * Math.sin((2 * Math.PI * L * t) / o.waveLen + phase) * Math.min(1, t * 3);
        if (!snapPoint(proj, [x, y, 0], 'f', p, n)) continue;
        pts.push(p.clone().addScaledVector(n, o.clear * (0.7 + 0.8 * layer) + 0.004 * Math.sin(k + i)));
        nrm.push(n.clone());
      }
      if (pts.length < 4) continue;
      const c = mix(o.color, o.deep, 0.25 * rng.float());
      strands.push(strandOf(pts, nrm, o.width * (0.9 + 0.25 * rng.float()), o.width * 0.55, c));
    }
  }
  if (!strands.length) return null;
  return hairGeometry(strands, [], { color: o.color, tipColor: o.tip, weights: beardWeights(ctx, o.length), curl: 0.2, rootShade: 0.9 });
}

export interface HangLocksOpts {
  color: number;
  tip: number;
  deep: number;
  /** roots on the scalp: azimuth (0 = front, + = left), elevation, and how far the lock falls (m) */
  locks: { az: number; el: number; drop: number }[];
  width: number;
  amp: number;
  waveLen: number;
  clear: number;
  layers?: number;
}

/** wide wavy ribbons from the scalp that fall over the head, shoulders and back, lying on the sculpt */
export function hangLocks(ctx: KindContext, proj: Projector, rng: Rng, o: HangLocksOpts): THREE.BufferGeometry | null {
  const { P } = ctx;
  const strands: Strand[] = [];
  const nn = V();
  const N = 9;
  const layers = o.layers ?? 1;
  const cz = P.headC[2];
  for (let layer = 0; layer < layers; layer++) {
    for (const lk of o.locks) {
      const az = lk.az + (rng.float() - 0.5) * 0.12;
      const root = scalpPoint(ctx, az, lk.el, 0.004 * (layer + 1));
      const r0 = Math.hypot(root[0], root[2] - cz);
      const dx = Math.sin(az);
      const dz = Math.cos(az);
      const phase = rng.float() * 6.28;
      const drop = lk.drop * (0.85 + 0.2 * rng.float());
      // fall to a radius that sits on the shoulders / back
      const rEnd = r0 + (Math.abs(dz) > 0.5 ? 0.04 : 0.07) * P.s / 0.735;
      const pts: THREE.Vector3[] = [];
      const nrm: THREE.Vector3[] = [];
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        const r = r0 + (rEnd - r0) * t;
        const side = o.amp * Math.sin((2 * Math.PI * drop * t) / o.waveLen + phase) * Math.min(1, t * 3);
        const q = new THREE.Vector3(dx * r + dz * side, root[1] - drop * t, cz + dz * r - dx * side);
        if (t > 0.05 && !proj.project(q, nn, 4)) continue;
        if (t > 0.05) q.addScaledVector(nn, o.clear * (1 + 0.6 * layer));
        else nn.set(dx, 0.3, dz).normalize();
        pts.push(q);
        nrm.push(nn.clone());
      }
      if (pts.length < 4) continue;
      strands.push(strandOf(pts, nrm, o.width * (0.9 + 0.25 * rng.float()), o.width * 0.6, mix(o.color, o.deep, 0.3 * rng.float())));
    }
  }
  if (!strands.length) return null;
  return hairGeometry(strands, [], { color: o.color, tipColor: o.tip, weights: hairWeights(ctx), curl: 0.2, rootShade: 0.9 });
}

/**
 * A smooth hair mass over the temples, sides and back of the skull (the crown stays bald and the
 * forehead free), so no scalp shows between the ribbons that lie on top of it.
 */
export function sculptHairDome(ctx: KindContext, o: { color: number; color2?: number; crownY?: number; front?: number }) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const sc = P.s;
  s.with({ color: o.color, color2: o.color2 ?? o.color, colorNoise: 0.5, colorFreq: 40 / sc, mat: 'hair', noise: { amp: 0.0025 * sc, freq: 55 / sc, type: 'ridged', octaves: 2 } }, () => {
    s.group('union', 0.02 * u, () => {
      s.ellipsoid(P.h(0, 0.04, -0.06), [0.356 * u, 0.43 * u, 0.46 * u], { bone: 'head', k: 0.03 * u });
      // below the bald crown, behind the forehead, above the nape
      s.plane([0, 1, 0], P.h(0, o.crownY ?? 0.12, 0)[1], { op: 'intersect', k: 0.03 * u });
      s.plane([0, 0, 1], P.h(0, 0, o.front ?? 0.04)[2], { op: 'intersect', k: 0.03 * u });
      s.plane([0, -1, 0], -P.h(0, -0.28, 0)[1], { op: 'intersect', k: 0.03 * u });
    });
  });
}
