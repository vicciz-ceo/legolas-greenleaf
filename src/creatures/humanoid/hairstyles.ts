/**
 * Hairstyles & beards: a sculpted hair cap (so gaps never show scalp) + strand cards grown over
 * the head and down the back, plus braids. Weighted to the head and the hair spring chain.
 */
import * as THREE from 'three';
import type { Sculpt, V3 } from '../kit/sdf';
import type { RigDef } from '../kit/rig';
import { growStrands, hairGeometry, type BraidDef, type EllipsoidCollider, type GrowRoot, type Strand, type WeightFn } from '../kit/hair';
import type { Proportions } from './proportions';
import type { BeardDef, HairDef, HairStyle } from './types';
import type { Rng } from '../../core/rng';

interface StyleCfg {
  /** strand tip height as a function of P (model y), or a length */
  endY?: (P: Proportions) => number;
  length: number; // max strand length (× s)
  count: number;
  gravity: number;
  jitter: number;
  width: number;
  wave?: { amp: number; length: number };
  /** sculpted cap only (no cards) */
  capOnly?: boolean;
  /** hairline: y (head units) at the front and the back */
  front: number;
  back: number;
  /** comb direction bias (z: -1 back) */
  comb: number;
  mohawk?: boolean;
  topknot?: boolean;
  ponytail?: boolean;
  /** cap thickness (head units) */
  cap: number;
}

const hc0 = new THREE.Color();
function shade(hex: number, k: number): number {
  return hc0.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(k).getHex(THREE.SRGBColorSpace);
}
const LONG: HairStyle[] = ['long_straight', 'long_wavy', 'shoulder', 'mane', 'wild', 'stringy'];

const STYLES: Record<HairStyle, StyleCfg> = {
  long_straight: { endY: (P) => P.j.chest[1] - 0.04 * P.s, length: 0.82, count: 300, gravity: 7, jitter: 0.02, width: 0.03, front: 0.17, back: -0.42, comb: -1, cap: 0.022 },
  long_wavy: { endY: (P) => P.j.chest[1] + 0.05 * P.s, length: 0.7, count: 260, gravity: 6.5, jitter: 0.06, width: 0.028, wave: { amp: 0.02, length: 0.12 }, front: 0.22, back: -0.4, comb: -0.8, cap: 0.025 },
  shoulder: { endY: (P) => P.j.upperarm_l[1] + 0.02 * P.s, length: 0.42, count: 170, gravity: 8, jitter: 0.06, width: 0.026, front: 0.22, back: -0.38, comb: -0.6, cap: 0.025 },
  tied_back: { length: 0.12, count: 120, gravity: 2, jitter: 0.02, width: 0.022, front: 0.24, back: -0.36, comb: -1, ponytail: true, cap: 0.018 },
  short: { length: 0.085, count: 120, gravity: 3, jitter: 0.12, width: 0.02, front: 0.26, back: -0.32, comb: -0.5, cap: 0.022 },
  cropped: { length: 0.03, count: 0, gravity: 0, jitter: 0, width: 0.02, capOnly: true, front: 0.28, back: -0.3, comb: 0, cap: 0.012 },
  mohawk: { length: 0.16, count: 70, gravity: 1.5, jitter: 0.15, width: 0.024, front: 0.26, back: -0.3, comb: -0.4, mohawk: true, cap: 0.012 },
  topknot: { length: 0.08, count: 90, gravity: 0.5, jitter: 0.03, width: 0.02, front: 0.26, back: -0.34, comb: 0.2, topknot: true, cap: 0.018 },
  bald: { length: 0, count: 0, gravity: 0, jitter: 0, width: 0, capOnly: true, front: 9, back: 9, comb: 0, cap: 0 },
  mane: { endY: (P) => P.j.upperarm_l[1] - 0.12 * P.s, length: 0.6, count: 200, gravity: 5, jitter: 0.25, width: 0.034, front: 0.2, back: -0.42, comb: -0.6, cap: 0.035 },
  wild: { endY: (P) => P.j.upperarm_l[1] - 0.02 * P.s, length: 0.4, count: 120, gravity: 4.5, jitter: 0.35, width: 0.028, front: 0.18, back: -0.38, comb: -0.5, cap: 0.025 },
  stringy: { endY: (P) => P.j.upperarm_l[1] + 0.02 * P.s, length: 0.35, count: 45, gravity: 7, jitter: 0.12, width: 0.016, front: 0.3, back: -0.3, comb: -0.7, cap: 0.004 },
};

/** scalp hair cap sculpted into the body (hair surface, coloured) */
export function sculptHairCap(s: Sculpt, P: Proportions, hair: HairDef, hooded = false) {
  void hooded;
  const cfg = STYLES[hair.style];
  if (cfg.cap <= 0) return;
  const u = P.headH;
  const h = P.h;
  s.group('union', 0.018 * u, () => {
    s.ellipsoid(h(0, 0.045, -0.055), [(0.325 + cfg.cap) * u, (0.4 + cfg.cap) * u, (0.425 + cfg.cap) * u], {
      // the cap reads as the hair's shadowed depth between strands: darker than the strands
      color: shade(hair.color, 0.86),
      mat: 'hair',
      bone: 'head',
      k: 0.02 * u,
    });
    // hairline: higher at the front, lower at the back (plane through the two heights)
    const zf = 0.42, zb = -0.45;
    const slope = (cfg.front - cfg.back) / (zf - zb);
    // keep y_head > cfg.back + slope (z_head - zb)  →  -y + slope z <= -(cfg.back - slope zb)  in head units
    const hc = P.headC;
    const n = new THREE.Vector3(0, -1, slope).normalize();
    const pnt = h(0, cfg.back, zb);
    s.plane([n.x, n.y, n.z], n.x * pnt[0] + n.y * pnt[1] + n.z * pnt[2], { op: 'intersect', k: 0.055 * u });
    void hc;
    if (cfg.mohawk) s.mirrored(() => s.plane([1, 0, 0], 0.06 * u, { op: 'intersect', k: 0.02 * u }));
    // keep the ears clear (only the ear: the temples above and in front stay covered)
    s.mirrored(() => s.ellipsoid(h(0.335, -0.135, -0.03), [0.065 * u, 0.12 * u, 0.088 * u], { op: 'subtract', k: 0.025 * u }));
  });
  if (cfg.topknot) s.sphere(h(0, 0.42, -0.12), 0.11 * u, { color: hair.color, mat: 'hair', bone: 'head', k: 0.03 * u, noise: { amp: 0.004 * P.s, freq: 60 / P.s, type: 'ridged' } });
}

export interface HairBuild {
  geo: THREE.BufferGeometry | null;
  strands: number;
}

export function buildHair(P: Proportions, rig: RigDef, hair: HairDef | null, beard: BeardDef | null, rng: Rng, lod: 0 | 1, hooded: boolean): HairBuild {
  const strands: Strand[] = [];
  const braids: BraidDef[] = [];
  const u = P.headH;
  const s = P.s;
  const h = P.h;
  const hc = P.headC;
  const capT = hair && !hooded ? STYLES[hair.style].cap : 0.01;
  const colliders: EllipsoidCollider[] = [
    { c: h(0, 0.045, -0.055), r: [(0.325 + capT) * u, (0.4 + capT) * u, (0.425 + capT) * u] },
    { c: h(0, -0.25, 0.12), r: [0.25 * u, 0.25 * u, 0.25 * u] },
    { c: [0, P.j.neck[1] + 0.02 * s, -0.03 * s], r: [0.075 * s * P.build.neckThick, 0.12 * s, 0.075 * s] },
    { c: [0, P.j.upperarm_l[1] - 0.12 * s, -0.015 * s], r: [P.shoulderX + 0.04 * s, 0.24 * s, 0.13 * s * P.build.chest * Math.sqrt(P.build.bulk)] },
    { c: [0, P.j.chest[1] - 0.05 * s, -0.01 * s], r: [0.16 * s * P.build.shoulders, 0.25 * s, 0.13 * s * P.build.chest * Math.sqrt(P.build.bulk)] },
    // ears: keep strands behind them
    { c: h(0.36, -0.08, -0.04), r: [0.06 * u, 0.16 * u, 0.1 * u] },
    { c: h(-0.36, -0.08, -0.04), r: [0.06 * u, 0.16 * u, 0.1 * u] },
  ];
  const hasChain = rig.has('hair1');
  const iHead = rig.boneIndex('head');
  const iH1 = rig.boneIndex('hair1');
  const iH2 = rig.boneIndex('hair2');
  const iH3 = rig.boneIndex('hair3');
  const y1 = hasChain ? P.j.hair1[1] : 0;
  const y2 = hasChain ? P.j.hair2[1] : 0;
  const y3 = hasChain ? P.j.hair3[1] : 0;
  const napeY = hc[1] - 0.32 * u;
  const weights: WeightFn = (p, _along, out) => {
    // behind & below the skull → spring chain
    const behind = p.z < hc[2] - 0.1 * u;
    if (!hasChain || !behind || p.y > napeY + 0.04 * s) {
      out.push([iHead, 1]);
      return;
    }
    const tHead = Math.max(0, Math.min(1, (napeY + 0.04 * s - p.y) / (0.08 * s)));
    out.push([iHead, 1 - tHead]);
    const y = p.y;
    let a1 = 0, a2 = 0, a3 = 0;
    if (y >= y2) {
      const t = Math.max(0, Math.min(1, (y1 - y) / Math.max(0.01, y1 - y2)));
      a1 = 1 - t;
      a2 = t;
    } else {
      const t = Math.max(0, Math.min(1, (y2 - y) / Math.max(0.01, y2 - y3)));
      a2 = 1 - t;
      a3 = t;
    }
    out.push([iH1, a1 * tHead], [iH2, a2 * tHead], [iH3, a3 * tHead]);
  };

  if (hair && !hooded) {
    const cfg = STYLES[hair.style];
    const long = LONG.includes(hair.style);
    const count = Math.round(cfg.count * (hair.density ?? 1) * (lod === 0 ? 1 : 0.45));
    if (count > 0) {
      const roots: GrowRoot[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      const total = count * 3;
      const slope = (cfg.front - cfg.back) / (0.42 + 0.45);
      const capT = cfg.cap;
      const pushRoot = (dx: number, dy: number, dz: number, layer: number, hairline: boolean) => {
        // head-unit position on the cap surface, lifted per layer so layers stack outward
        const liftU = ((0.003 + layer * 0.0045) * s) / u;
        const hx = dx * (0.325 + capT + liftU), hy = 0.045 + dy * (0.4 + capT + liftU), hz = -0.055 + dz * (0.425 + capT + liftU);
        const p: V3 = h(hx, hy, hz);
        const nrm = new THREE.Vector3(dx / 0.325, dy / 0.4, dz / 0.425).normalize();
        // comb: everything flows back toward the nape; sides sweep back above and behind the ears
        const side = Math.abs(dx);
        const want = new THREE.Vector3((rng.float() - 0.5) * 0.12 + dx * (long ? 0.18 : 0.3), hairline ? 0.25 : -0.3 - 0.4 * side, cfg.comb);
        if (cfg.mohawk) want.set(0, 0.5, -0.8);
        want.addScaledVector(nrm, -want.dot(nrm)).normalize();
        if (want.lengthSq() < 0.1) want.set(0, -1, 0);
        // ragged, tapered ends: lengths vary a lot more than the cut line
        const endY = cfg.endY ? cfg.endY(P) - rng.range(-0.02, 0.13) * s : undefined;
        // depth: inner layers and roots darker; outer layer brightest
        const tone = (0.7 + 0.13 * layer) * rng.range(0.9, 1.07);
        hc0.setHex(hair.color, THREE.SRGBColorSpace).multiplyScalar(tone);
        roots.push({
          p,
          dir: [want.x, want.y, want.z],
          length: cfg.length * s * (hair.length ?? 1) * rng.range(0.82, 1.08),
          lift: (0.003 + layer * 0.0045) * s,
          width: cfg.width * s * (layer === 0 ? 1.35 : 1) * (hairline ? 0.7 : 1) * rng.range(0.85, 1.15),
          minY: endY,
          color: hc0.getHex(THREE.SRGBColorSpace),
        });
      };
      for (let i = 0; i < total && roots.length < count; i++) {
        // fibonacci sphere over the upper head
        const yy = 1 - (i / (total - 1)) * 1.6;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        const th = golden * i;
        const dx = Math.cos(th) * rr, dz = Math.sin(th) * rr;
        const hx = dx * 0.34, hy = 0.045 + yy * 0.41, hz = -0.055 + dz * 0.44;
        // hairline test (same plane as the cap), ears, mohawk strip
        if (hy < cfg.back + slope * (hz + 0.45) + 0.025) continue;
        if (Math.abs(hx) > 0.27 && hy < -0.01 && hz > -0.13 && hz < 0.08) continue; // over the ears
        if (cfg.mohawk && Math.abs(hx) > 0.07) continue;
        pushRoot(dx, yy, dz, roots.length % 3, false);
      }
      // a clean hairline: one row of short-rooted strands right on the hairline, combed back
      if (long && lod === 0) {
        const nH = Math.round(36 * (hair.density ?? 1));
        for (let i = 0; i < nH; i++) {
          const a = -1.25 + (2.5 * i) / (nH - 1); // azimuth from the front, radians
          const dz0 = Math.cos(a), dx0 = Math.sin(a);
          const zU = -0.055 + dz0 * 0.44;
          const yH = cfg.back + slope * (zU + 0.45) + 0.055;
          const dy = Math.max(-0.4, Math.min(0.95, (yH - 0.045) / 0.41));
          const rr = Math.sqrt(Math.max(0, 1 - dy * dy));
          pushRoot(dx0 * rr, dy, dz0 * rr, 1, true);
        }
      }
      const segs = cfg.length > 0.3 ? (lod === 0 ? 12 : 7) : 4;
      strands.push(
        ...growStrands(roots, {
          segments: segs,
          gravity: (cfg.gravity * 3.2) / s,
          colliders,
          jitter: cfg.jitter,
          seed: rng.int(1, 1e6),
          taper: 0.42,
          wave: cfg.wave ? { amp: cfg.wave.amp * s, length: cfg.wave.length * s } : undefined,
          hug: cfg.mohawk ? undefined : 0,
          hugUntil: long ? -0.32 : -0.25,
          normalColliders: [0, 2, 3, 4],
        }),
      );
    }
    if (hair.braids === 'temple') {
      for (const sx of [1, -1]) {
        // from the temple hairline back over the hair, meeting behind the head; each point is
        // pushed out onto the outer hair layer so the braid lies on top of the strands
        const onTop = (x: number, y: number, z: number, out: number): V3 => {
          const dx = x / 0.325, dy = (y - 0.045) / 0.4, dz = (z + 0.055) / 0.425;
          const L = Math.hypot(dx, dy, dz) || 1;
          return h((dx / L) * (0.325 + capT + out), 0.045 + (dy / L) * (0.4 + capT + out), -0.055 + (dz / L) * (0.425 + capT + out));
        };
        const lay = (0.011 * s) / u; // half-embedded in the outer strand layer
        const pts: V3[] = [onTop(0.262 * sx, 0.13, 0.27, lay * 0.3), onTop(0.335 * sx, 0.11, 0.12, lay * 0.8), onTop(0.37 * sx, 0.06, -0.06, lay), onTop(0.31 * sx, 0.0, -0.3, lay), onTop(0.12 * sx, -0.04, -0.47, lay), onTop(0.02 * sx, -0.06, -0.5, lay)];
        braids.push({ points: pts, radius: 0.0045 * s, color: shade(hair.color, 0.9), twist: 90 });
      }
      const back0 = h(0, -0.06, -0.5 - (0.016 * s) / u);
      braids.push({ points: [back0, h(0, -0.22, -0.53 - (0.016 * s) / u), [0, P.j.neck[1] - 0.02 * s, -0.14 * s * P.build.chest]], radius: 0.0068 * s, color: shade(hair.color, 0.92) });
    }
    if (hair.braids === 'side' || hair.braids === 'many') {
      const n = hair.braids === 'many' ? 6 : 2;
      for (let i = 0; i < n; i++) {
        const sx = i % 2 ? -1 : 1;
        const z = -0.05 - Math.floor(i / 2) * 0.12;
        braids.push({ points: [h(0.3 * sx, -0.05, z), h(0.32 * sx, -0.3, z - 0.05), [0.13 * s * sx, P.j.upperarm_l[1] - 0.05 * s, (z - 0.15) * u]], radius: 0.008 * s, color: hair.color });
      }
    }
    if (STYLES[hair.style].ponytail) braids.push({ points: [h(0, 0.05, -0.45), h(0, -0.2, -0.55), [0, P.j.upperarm_l[1] - 0.12 * s, -0.16 * s]], radius: 0.022 * s, color: hair.color, twist: 25 });
  }
  const beardStrands: Strand[] = [];
  const beardBraids: BraidDef[] = [];
  if (beard) {
    const bl = beard.length;
    const roots: GrowRoot[] = [];
    if (beard.style !== 'stubble') {
      const n = lod === 0 ? 90 : 45;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1)) * 2 - 1; // -1..1 across the jaw
        const yy = -0.28 - 0.3 * (1 - Math.abs(a) * 0.7) - rng.range(0, 0.06);
        const xx = a * 0.27;
        const zz = 0.2 + 0.18 * (1 - Math.abs(a)) ** 0.7;
        if (beard.style === 'goatee' && Math.abs(a) > 0.35) continue;
        if (beard.style === 'mustache' && (yy < -0.45 || Math.abs(a) > 0.5)) continue;
        roots.push({ p: h(xx, yy, zz), dir: [a * 0.2, -1, 0.35], length: (bl + 0.06 * s) * rng.range(0.8, 1.05), lift: 0.005 * s * (1 + (i % 3)), width: 0.03 * s });
      }
      const chin: EllipsoidCollider[] = [
        { c: h(0, -0.3, 0.12), r: [0.27 * u, 0.32 * u, 0.3 * u] },
        { c: [0, P.j.chest[1] + 0.05 * s, 0.0], r: [0.17 * s * P.build.shoulders, 0.25 * s, 0.125 * s * P.build.chest * Math.sqrt(P.build.bulk)] },
      ];
      beardStrands.push(...growStrands(roots, { segments: lod === 0 ? 8 : 5, gravity: 7 / s, colliders: chin, jitter: 0.15, seed: rng.int(1, 1e6), taper: 0.35 }));
      if (beard.style === 'braided' || beard.style === 'forked') {
        for (const sx of beard.style === 'forked' ? [1, -1] : [0]) {
          beardBraids.push({ points: [h(0.06 * sx, -0.62, 0.3), h(0.08 * sx, -0.75, 0.32), [0.04 * sx * s, P.headC[1] - 0.6 * u - bl * 0.9, 0.12 * s]], radius: 0.016 * s, color: beard.color });
        }
      }
    }
    const iJaw = rig.boneIndex('jaw');
    const iB1 = rig.boneIndex('beard1');
    const iB2 = rig.boneIndex('beard2');
    const chinY = P.headC[1] - 0.6 * u;
    const beardW: WeightFn = (p, along, out) => {
      if (iB1 < 0 || p.y > chinY) {
        out.push([iJaw >= 0 ? iJaw : iHead, 1]);
        return;
      }
      const t = Math.min(1, (chinY - p.y) / Math.max(0.05, bl));
      out.push([iJaw, Math.max(0, 1 - t * 2)], [iB1, Math.min(1, t * 2) * (1 - t)], [iB2, t * t]);
      void along;
    };
    const g1 = strands.length || braids.length ? hairGeometry(strands, braids, { color: hair?.color ?? beard.color, tipColor: hair?.tipColor, weights }) : null;
    if (!beardStrands.length && !beardBraids.length) return { geo: g1, strands: strands.length };
    const g2 = hairGeometry(beardStrands, beardBraids, { color: beard.color, weights: beardW });
    const merged = g1 ? mergeHair([g1, g2]) : g2;
    return { geo: merged, strands: strands.length + beardStrands.length };
  }
  if (!strands.length && !braids.length) return { geo: null, strands: 0 };
  return { geo: hairGeometry(strands, braids, { color: hair?.color ?? 0x302010, tipColor: hair?.tipColor, weights }), strands: strands.length };
}

export function mergeHair(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].attributes[n].itemSize;
    const total = list.reduce((a, g) => a + g.attributes[n].count, 0);
    const arr = n === 'skinIndex' ? new Uint16Array(total * size) : new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[n].array as ArrayLike<number>, o);
      o += g.attributes[n].count * size;
    }
    out.setAttribute(n, n === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr, size) : new THREE.BufferAttribute(arr, size));
  }
  const idx: number[] = [];
  let vo = 0;
  for (const g of list) {
    const a = g.index!.array;
    for (let i = 0; i < a.length; i++) idx.push(a[i] + vo);
    vo += g.attributes.position.count;
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
