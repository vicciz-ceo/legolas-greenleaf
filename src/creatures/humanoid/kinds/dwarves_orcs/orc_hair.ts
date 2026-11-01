/**
 * Head hair for the orc family: a trimmed copy of `hair.ts` makeHairdo with one extra control,
 * `maxZ`. The shared version also roots strands on the front of the skull, and combed back they
 * fall over the forehead and read as scars or cracks across the brow. Here no strand is rooted in
 * front of `maxZ` (head units), so hair starts at the crown rim, the temples and behind the ears.
 */
import * as THREE from 'three';
import type { Rng } from '../../../../core/rng';
import { growStrands, hairGeometry, type EllipsoidCollider, type GrowRoot, type WeightFn } from '../../../kit/hair';
import type { KindContext } from '../../types';
import { mergeHairGeos } from './common';

export interface OrcHairOpts {
  color: number;
  tip?: number;
  deep?: number;
  /** longest strand (m, already scaled by P.s) */
  length: number;
  count: number;
  width?: number;
  gravity?: number;
  wave?: number;
  /** hairline height (head units) at the front and at the nape */
  front?: number;
  back?: number;
  wild?: number;
  /** sweep: +1 combed back */
  comb?: number;
  segments?: number;
  /** skip roots above this height (head units): a bald crown */
  maxY?: number;
  /** skip roots in front of this z (head units): nothing starts over the brow */
  maxZ?: number;
  /** half-width of a centre part (head units): no roots on the crown line */
  part?: number;
}

export function makeOrcHair(ctx: KindContext, o: OrcHairOpts, rng: Rng): THREE.BufferGeometry | null {
  const { P, rig } = ctx;
  const u = P.headH;
  const s = P.s;
  const h = P.h;
  const bulk = Math.sqrt(P.build.bulk);
  const colliders: EllipsoidCollider[] = [
    { c: h(0, 0.045, -0.055), r: [0.34 * u, 0.41 * u, 0.435 * u] },
    { c: h(0, -0.12, 0.2), r: [0.31 * u, 0.34 * u, 0.36 * u] },
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
  const maxZ = o.maxZ ?? 9;
  const roots: GrowRoot[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = o.count * 40;
  const tmp = new THREE.Color();
  for (let i = 0; i < total && roots.length < o.count; i++) {
    const yy = 1 - (i / (total - 1)) * 1.7;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i;
    const dx = Math.cos(th) * rr, dz = Math.sin(th) * rr, dy = yy;
    const layer = roots.length % 3;
    const lift = 0.004 + layer * 0.005;
    const hx = dx * (0.34 + (lift / u) * s), hy = 0.045 + dy * (0.41 + (lift / u) * s), hz = -0.055 + dz * (0.435 + (lift / u) * s);
    const slope = (front - back) / 0.87;
    if (hy < back + slope * (hz + 0.45)) continue;
    if (Math.abs(hx) > 0.27 && hy < 0.03 && hz > -0.22) continue;
    if (o.maxY !== undefined && hy > o.maxY) continue;
    if (hz > maxZ) continue;
    if (o.part !== undefined && Math.abs(hx) < o.part && hy > 0.1) continue;
    const nrm = new THREE.Vector3(dx / 0.34, dy / 0.41, dz / 0.435).normalize();
    const frontness = Math.max(0, Math.min(1, (hz + 0.1) / 0.5));
    const want = new THREE.Vector3(dx * 0.4 + (rng.float() - 0.5) * (0.2 + wild), 0.25 * frontness - 0.3 * (1 - frontness) - 0.1, -comb + (rng.float() - 0.5) * wild * 0.6);
    want.addScaledVector(nrm, -want.dot(nrm));
    if (want.lengthSq() < 0.05) want.set(0, -1, -0.3);
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
    segments: o.segments ?? 5,
    gravity: ((o.gravity ?? 6) * 3) / s,
    colliders,
    jitter: 0.06 + wild * 0.2,
    seed: rng.int(1, 1e6),
    taper: 0.4,
    wave: o.wave ? { amp: 0.016 * s * o.wave, length: 0.11 * s } : undefined,
    hug: 0,
    hugUntil: -0.3,
  });
  if (!strands.length) return null;
  return mergeHairGeos([hairGeometry(strands, [], { color: o.color, tipColor: o.tip, weights, curl: 0.25 })]);
}
