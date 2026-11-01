/**
 * Cloth sheets for the elf guards, sculpted to the Mirkwood and Galadhrim turnarounds:
 *   - `elfCloak`: a wide A-line cloak with deep pleats that grow toward the hem, a trimmed hem and
 *     front edge and optional embroidered vertical lines (Galadhrim: gold leaf work on red velvet)
 *   - `leafTassets`: the armour skirt, two staggered rows of long pointed leaf plates hanging from the
 *     belt over the hips (sheet: overlapping gold leaves down to mid-thigh, a gap at the centre front
 *     where the tunic shows)
 * Both are skinned like the kit's own skirt and cloak (hips / thigh / skirt_f,b bones and the cloak
 * spring chains) and carry the kit's surface attributes, so they share the body material.
 * The builder is a copy of the kit's private one in `humanoid/cloth.ts` (not exported there).
 */
import * as THREE from 'three';
import type { RigDef } from '../../../kit/rig';
import { SURFACES, type SurfaceName, type SurfaceSpec } from '../../../kit/surfaces';
import { noise2 } from '../../../../core/rng';
import type { Proportions } from '../../proportions';
import { torsoSection } from './geo';

interface Builder {
  pos: number[];
  col: number[];
  surf: number[];
  pat0: number[];
  pat1: number[];
  ao: number[];
  si: number[];
  sw: number[];
  idx: number[];
  seam: number[];
}
const newBuilder = (): Builder => ({ pos: [], col: [], surf: [], pat0: [], pat1: [], seam: [], ao: [], si: [], sw: [], idx: [] });

function finish(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('surf', new THREE.Float32BufferAttribute(b.surf, 4));
  g.setAttribute('pat0', new THREE.Float32BufferAttribute(b.pat0, 4));
  g.setAttribute('pat1', new THREE.Float32BufferAttribute(b.pat1, 4));
  g.setAttribute('seam', new THREE.Float32BufferAttribute(b.seam, 2));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(b.ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.idx), 1));
  g.computeVertexNormals();
  return g;
}

function pushVertex(b: Builder, p: THREE.Vector3, color: THREE.Color, spec: SurfaceSpec, ao: number, weights: [number, number][], edge = 1) {
  b.pos.push(p.x, p.y, p.z);
  b.seam.push(-Math.min(0.03, edge), 1);
  b.col.push(color.r, color.g, color.b);
  b.surf.push(spec.rough, spec.metal, spec.sheen, spec.skin);
  b.pat0.push(spec.pat[0], spec.pat[1], spec.pat[2], spec.pat[3]);
  b.pat1.push(spec.pat[4], spec.pat[5], spec.pat[6], spec.pat[7]);
  b.ao.push(ao);
  weights.sort((x, y) => y[1] - x[1]);
  let s = 0;
  for (let i = 0; i < 4; i++) s += weights[i]?.[1] ?? 0;
  s = s || 1;
  for (let i = 0; i < 4; i++) {
    b.si.push(weights[i]?.[0] ?? 0);
    b.sw.push((weights[i]?.[1] ?? 0) / s);
  }
}

const specOf = (m: SurfaceName | SurfaceSpec | undefined, d: SurfaceName): SurfaceSpec => (typeof m === 'string' ? SURFACES[m] : (m ?? SURFACES[d]));
const _c = new THREE.Color();
const _t = new THREE.Color();
const _g = new THREE.Color();

export interface ElfCloakOpts {
  color: number;
  /** hem band and front-edge trim */
  trim: number;
  mat?: SurfaceName | SurfaceSpec;
  /** hem height above the ground (m) */
  hem: number;
  /** half width (m) of the hanging cloak at mid height and at the hem (scaled by the figure) */
  rxMid?: number;
  rxHem?: number;
  /** half depth behind the back at the hem */
  rzHem?: number;
  /** number of pleats across the back and how deep they get at the hem (m) */
  pleats?: number;
  pleatDepth?: number;
  /** gold embroidery: vertical lines of colour `embroider` at these fractions across the cloak */
  embroider?: { color: number; at: number[]; from?: number; mix?: number };
  seed?: number;
}

/** the cloak: shoulders to hem, wide and pleated, weighted to the chest and the cloak spring chains */
export function elfCloak(P: Proportions, rig: RigDef, o: ElfCloakOpts): THREE.BufferGeometry {
  const b = newBuilder();
  const spec = specOf(o.mat, 'wool');
  const s = P.s;
  const g = P.build.bulk;
  const top = P.j.neck[1] + 0.005 * s;
  const bottom = o.hem;
  const H = top - bottom;
  const iC = rig.boneIndex('chest');
  const chains = ['l', 'r'].map((sd) => [1, 2, 3].map((k) => rig.boneIndex(`cloak${k}_${sd}`)));
  const ys = [1, 2, 3].map((k) => P.j[`cloak${k}_l`][1]);
  const base = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const trim = new THREE.Color().setHex(o.trim, THREE.SRGBColorSpace);
  const emb = o.embroider ? new THREE.Color().setHex(o.embroider.color, THREE.SRGBColorSpace) : null;
  const n2 = noise2(o.seed ?? 5);
  const a0 = Math.PI * 0.4;
  const a1 = Math.PI * 1.6;
  const nv = Math.max(9, Math.round(H / (0.1 * s)));
  const pleats = o.pleats ?? 7;
  const w: [number, number][] = [];
  const rxTop = P.shoulderX * 0.5 + 0.02 * s; // narrow at the clasp
  const rzTop = 0.105 * s * Math.sqrt(g) * P.build.chest + 0.025 * s;
  const rxMid = (o.rxMid ?? 0.28) * s;
  const rzMid = 0.17 * s * g;
  const rxHem = (o.rxHem ?? 0.43) * s;
  const rzHem = (o.rzHem ?? 0.25) * s;
  // rows: even steps down the cloak, then two close rows at the hem so the trim band has a crisp edge
  const vs: number[] = [];
  for (let i = 0; i < nv - 1; i++) vs.push((i / (nv - 1)) * 0.96);
  vs.push(0.97, 0.976, 1);
  // columns: even steps across, a crisp trim strip at each front edge, and a thin inset line (three
  // close columns) wherever there is embroidery
  const embAt = o.embroider?.at ?? [];
  const us: number[] = [0, 0.03, 0.034, 0.966, 0.97, 1];
  const NU = 22;
  for (let k = 1; k < NU; k++) {
    const u = k / NU;
    if (u > 0.05 && u < 0.95 && !embAt.some((e) => Math.abs(u - e) < 0.03)) us.push(u);
  }
  for (const e of embAt) us.push(e - 0.006, e, e + 0.006);
  us.sort((x, y) => x - y);
  const nu = us.length - 1;
  for (const v of vs) {
    const sh = Math.min(1, v * 3.4); // shoulders -> hanging
    const lo = Math.pow(v, 1.15); // hanging -> flared hem
    const rx = rxTop + (rxMid - rxTop) * Math.sqrt(sh) + (rxHem - rxMid) * lo;
    const rz = rzTop + (rzMid - rzTop) * Math.sqrt(sh) + (rzHem - rzMid) * lo;
    const amp = ((o.pleatDepth ?? 0.03) * Math.min(1, v * 1.6) + 0.005) * s;
    for (let iu = 0; iu <= nu; iu++) {
      const u = us[iu];
      const a = a0 + (a1 - a0) * u;
      const ph = Math.sin(u * Math.PI * pleats);
      const fold = ph * amp * Math.min(1, v * 3);
      let y = top - H * v;
      // the hem rises a little over each pleat crest
      if (v > 0.9) y += (ph * 0.5 + 0.5) * 0.02 * s * ((v - 0.9) / 0.1);
      const p = new THREE.Vector3(Math.sin(a) * (rx + fold), y, Math.cos(a) * (rz + fold) - 0.03 * s);
      _c.copy(base);
      // tone follows the pleat: crests lighter, troughs darker
      _c.multiplyScalar(1 + 0.09 * ph * Math.min(1, v * 2.5) + 0.04 * n2(u * 13, 2.7) + 0.05 * n2(u * 41, v * 7 + 1.3));
      const edge = u <= 0.0301 || u >= 0.9699;
      if (v > 0.9755 || edge) _c.lerp(trim, 0.7);
      if (emb && o.embroider) {
        for (const at of o.embroider.at) {
          if (Math.abs(u - at) < 0.002 && v > (o.embroider.from ?? 0.3) && v < 0.965) _c.lerp(_g.copy(emb), o.embroider.mix ?? 0.5);
        }
      }
      _t.copy(_c);
      w.length = 0;
      const blendLR = 0.5 + 0.5 * Math.max(-1, Math.min(1, -Math.sin(a) * 2.5));
      const chainW = (k: number) => {
        const yk = ys[k];
        const yPrev = k === 0 ? top : ys[k - 1];
        const yNext = k === 2 ? bottom - 0.3 : ys[k + 1];
        if (y >= yk) return Math.max(0, 1 - (y - yk) / Math.max(0.01, yPrev - yk));
        return Math.max(0, 1 - (yk - y) / Math.max(0.01, yk - yNext));
      };
      const topW = Math.max(0, 1 - v * 6);
      w.push([iC, topW + 0.0001]);
      for (let k = 0; k < 3; k++) {
        const cw = chainW(k) * (1 - topW);
        if (chains[0][k] >= 0) w.push([chains[0][k], cw * (1 - blendLR)]);
        if (chains[1][k] >= 0) w.push([chains[1][k], cw * blendLR]);
      }
      const arcC = (a1 - a0) * (rxTop + rxHem) * 0.5;
      pushVertex(b, p, _t, spec, 0.78 + 0.22 * Math.min(1, v * 2) - 0.08 * (0.5 - 0.5 * ph) * Math.min(1, v * 2), w, Math.min(H * (1 - v), arcC * u, arcC * (1 - u)));
    }
  }
  for (let iv = 0; iv < vs.length - 1; iv++)
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * (nu + 1) + iu;
      const c = a + nu + 1;
      b.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  return finish(b);
}

export interface TassetLeaf {
  /** azimuth about the vertical axis (0 = front, + = the character's left, π = back) */
  a: number;
  /** length down from `top` (m) */
  len: number;
  /** width at the shoulder of the leaf (m) */
  w: number;
  /** start height (m); defaults to the plate's `top` */
  top?: number;
  /** outward offset from the skirt (m): staggers overlapping rows */
  off?: number;
  /** tone multiplier */
  tone?: number;
}

export interface TassetOpts {
  /** belt height the plates hang from */
  top: number;
  /** where the tunic's own cloth skirt ends (so the plates clear it): the skirt's hem height */
  skirtBottom: number;
  color: number;
  color2?: number;
  mat?: SurfaceName | SurfaceSpec;
  leaves: TassetLeaf[];
  seed?: number;
}

/**
 * Long pointed leaf plates hanging from the belt: a ridge down the middle (the centre vertex row is
 * pushed out), edges curling back, tips flaring outward. Hung on the same ellipse as the kit's skirt
 * panels so they clear the legs.
 */
export function leafTassets(P: Proportions, rig: RigDef, o: TassetOpts): THREE.BufferGeometry {
  const b = newBuilder();
  const spec = specOf(o.mat, 'gold');
  const s = P.s;
  const g = P.build.bulk;
  const hips = P.build.hips;
  const iH = rig.boneIndex('hips');
  const iTL = rig.boneIndex('thigh_l');
  const iTR = rig.boneIndex('thigh_r');
  const iSF = rig.boneIndex('skirt_f');
  const iSB = rig.boneIndex('skirt_b');
  const hipY = P.j.thigh_l[1];
  const skTop = hipY + 0.035 * s;
  const n2 = noise2(o.seed ?? 4);
  const base = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const c2 = new THREE.Color().setHex(o.color2 ?? o.color, THREE.SRGBColorSpace);
  // the kit skirt's ellipse (rx0 -> rx1), see humanoid/cloth.ts skirtGeometry
  const rx0 = 0.158 * s * hips * Math.sqrt(g) + 0.012 * s;
  const rz0 = 0.112 * s * Math.sqrt(g) + 0.012 * s;
  const legR = 0.08 * s * g;
  const rx1 = Math.max(rx0, P.hipX + legR + 0.03 * s) + 0.04 * s;
  const rz1 = Math.max(rz0, legR + 0.035 * s) + 0.04 * s * 0.8;
  const H = skTop - o.skirtBottom;
  const w: [number, number][] = [];
  const nR = 5; // rows along the leaf
  const lerp = (a: number, bb: number, t: number) => a + (bb - a) * t;
  o.leaves.forEach((lf, li) => {
    const topY = lf.top ?? o.top;
    const start = b.pos.length / 3;
    const tone = lf.tone ?? 1;
    for (let ir = 0; ir <= nR; ir++) {
      const t = ir / nR;
      const y = topY - lf.len * t;
      // ellipse at this height: torso above the skirt top, the kit skirt's flare below it
      const sec = torsoSection(P, Math.min(y, topY));
      const vv = Math.min(1, Math.max(0, (skTop - y) / Math.max(0.05, H)));
      const rx = Math.max(sec.rx + 0.016 * s, lerp(rx0, rx1, Math.sqrt(vv))) + (lf.off ?? 0) + 0.05 * s * t * t;
      const rz = Math.max((sec.zf - sec.zb) / 2 + 0.016 * s, lerp(rz0, rz1, Math.sqrt(vv))) + (lf.off ?? 0) + 0.04 * s * t * t;
      const zc = -0.01 * s;
      // leaf outline: broad shoulders, drawn to a point
      const wid = lf.w * (0.72 + 0.28 * Math.sin(Math.min(1, t * 2) * Math.PI * 0.5)) * (1 - Math.pow(t, 2.8));
      for (let ic = 0; ic < 3; ic++) {
        const cx = ic - 1; // -1 edge, 0 ridge, +1 edge
        const a = lf.a + (cx * wid * 0.5) / ((rx + rz) * 0.5);
        const ridge = (1 - Math.abs(cx)) * 0.011 * s * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.6);
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const p = new THREE.Vector3(sa * (rx + ridge), y, zc + ca * (rz + ridge));
        _c.copy(base);
        _c.lerp(c2, 0.35 * (1 - Math.abs(cx)) + 0.3 * t * n2(li * 3.1, ic));
        _c.multiplyScalar(tone * (0.92 + 0.1 * (1 - Math.abs(cx))));
        w.length = 0;
        const side = sa;
        const front = Math.max(0, ca);
        const back = Math.max(0, -ca);
        const lower = Math.min(1, ((skTop - y) / Math.max(0.05, H)) * 1.25 + 0.15);
        const tl = side > 0 ? side * side * lower : 0;
        const tr = side < 0 ? side * side * lower : 0;
        w.push([iH, Math.max(0.0001, 1 - lower * 0.9)], [iTL, tl], [iTR, tr]);
        if (iSF >= 0) w.push([iSF, front * front * lower * 0.9]);
        if (iSB >= 0) w.push([iSB, back * back * lower * 0.9]);
        pushVertex(b, p, _c, spec, 0.62 + 0.38 * t, w, ic === 1 ? 0.03 : 0.004 + 0.002 * t);
      }
    }
    for (let ir = 0; ir < nR; ir++)
      for (let ic = 0; ic < 2; ic++) {
        const a = start + ir * 3 + ic;
        const c = a + 3;
        // front facing: wind so the outside is the front side (double-sided material anyway)
        b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
  });
  return finish(b);
}
