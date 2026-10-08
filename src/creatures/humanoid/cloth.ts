/**
 * Separate skinned cloth layers: tunic/robe skirt panels and cloaks. They are parametric sheets
 * (rendered double-sided with the creature material) weighted to hips/thighs and spring bones,
 * so they swing instead of stretching like a sculpted skirt would.
 */
import * as THREE from 'three';
import type { RigDef } from '../kit/rig';
import { SURFACES, type SurfaceName, type SurfaceSpec } from '../kit/surfaces';
import type { Proportions } from './proportions';
import { noise2 } from '../../core/rng';

export interface SheetOut {
  geo: THREE.BufferGeometry;
}

interface Builder {
  pos: number[];
  nor: number[];
  col: number[];
  surf: number[];
  pat0: number[];
  pat1: number[];
  ao: number[];
  si: number[];
  sw: number[];
  idx: number[];
}
function newBuilder(): Builder {
  return { pos: [], nor: [], col: [], surf: [], pat0: [], pat1: [], ao: [], si: [], sw: [], idx: [] };
}
function finish(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('surf', new THREE.Float32BufferAttribute(b.surf, 4));
  g.setAttribute('pat0', new THREE.Float32BufferAttribute(b.pat0, 4));
  g.setAttribute('pat1', new THREE.Float32BufferAttribute(b.pat1, 4));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(b.ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(b.idx), 1));
  g.computeVertexNormals();
  return g;
}

const _c = new THREE.Color();

function pushVertex(b: Builder, p: THREE.Vector3, color: THREE.Color, spec: SurfaceSpec, ao: number, weights: [number, number][]) {
  b.pos.push(p.x, p.y, p.z);
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

export interface SkirtOpts {
  /** y of the waist attachment and the hem */
  top: number;
  bottom: number;
  color: number;
  color2?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** panels as angle ranges (radians from +Z toward +X) */
  panels: [number, number][];
  /** extra radius at the hem */
  flare?: number;
  /** ragged hem amplitude (m) */
  ragged?: number;
  seed?: number;
}

/** skirt panels hanging from the waist. Weights: hips at the top, thighs at the sides, skirt_f/skirt_b front/back. */
export function skirtGeometry(P: Proportions, rig: RigDef, o: SkirtOpts): THREE.BufferGeometry {
  const b = newBuilder();
  const spec: SurfaceSpec = typeof o.mat === 'string' ? SURFACES[o.mat] : o.mat ?? SURFACES.cloth;
  const s = P.s;
  const g = P.build.bulk;
  const hips = P.build.hips;
  const iH = rig.boneIndex('hips');
  const iTL = rig.boneIndex('thigh_l');
  const iTR = rig.boneIndex('thigh_r');
  const iSF = rig.boneIndex('skirt_f');
  const iSB = rig.boneIndex('skirt_b');
  const n2 = noise2(o.seed ?? 3);
  const base = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const trim = new THREE.Color().setHex(o.color2 ?? o.color, THREE.SRGBColorSpace);
  const rx0 = 0.158 * s * hips * Math.sqrt(g) + 0.012 * s;
  const rz0 = 0.112 * s * Math.sqrt(g) + 0.012 * s;
  // leg envelope at the hem height: legs at ±hipX with thigh radius
  const legR = 0.08 * s * g;
  const rx1 = Math.max(rx0, P.hipX + legR + 0.03 * s) + (o.flare ?? 0.04 * s);
  const rz1 = Math.max(rz0, legR + 0.035 * s) + (o.flare ?? 0.04 * s) * 0.8;
  const H = o.top - o.bottom;
  const nv = Math.max(4, Math.round(H / (0.045 * s)));
  const w: [number, number][] = [];
  for (const [a0, a1] of o.panels) {
    const nu = Math.max(3, Math.round(((a1 - a0) * (rx0 + rx1) * 0.5) / (0.035 * s)));
    const start = b.pos.length / 3;
    for (let iv = 0; iv <= nv; iv++) {
      const v = iv / nv;
      for (let iu = 0; iu <= nu; iu++) {
        const u = iu / nu;
        const a = a0 + (a1 - a0) * u;
        const ease = v * v * (3 - 2 * v);
        const rx = rx0 + (rx1 - rx0) * Math.sqrt(v);
        const rz = rz0 + (rz1 - rz0) * Math.sqrt(v);
        let y = o.top - H * v;
        // soft folds
        const fold = Math.sin(a * 9 + (o.seed ?? 0)) * 0.006 * s * ease;
        if (o.ragged && v > 0.85) y += n2(a * 6, (o.seed ?? 0) * 1.7) * o.ragged * ((v - 0.85) / 0.15);
        const p = new THREE.Vector3(Math.sin(a) * (rx + fold), y, Math.cos(a) * (rz + fold) - 0.01 * s);
        _c.copy(base);
        if (v > 0.93) _c.lerp(trim, 0.85);
        // weights
        w.length = 0;
        const side = Math.sin(a);
        const front = Math.max(0, Math.cos(a));
        const back = Math.max(0, -Math.cos(a));
        const lower = Math.min(1, v * 1.25);
        const tl = side > 0 ? side * side * lower : 0;
        const tr = side < 0 ? side * side * lower : 0;
        const sf = iSF >= 0 ? front * front * lower * 0.9 : 0;
        const sb = iSB >= 0 ? back * back * lower * 0.9 : 0;
        w.push([iH, Math.max(0.0001, 1 - lower * 0.9)], [iTL, tl], [iTR, tr]);
        if (iSF >= 0) w.push([iSF, sf]);
        if (iSB >= 0) w.push([iSB, sb]);
        pushVertex(b, p, _c, spec, 0.55 + 0.45 * v, w);
      }
    }
    for (let iv = 0; iv < nv; iv++)
      for (let iu = 0; iu < nu; iu++) {
        const a = start + iv * (nu + 1) + iu;
        const c = a + nu + 1;
        b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
  }
  return finish(b);
}

export interface CloakOpts {
  color: number;
  color2?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** 0..1 length: 0.5 = to the knees, 1 = to the ankles */
  length: number;
  ragged?: number;
  seed?: number;
}

/** cloak hanging from the shoulders around the back; weights blend chest → cloak chains. */
export function cloakGeometry(P: Proportions, rig: RigDef, o: CloakOpts): THREE.BufferGeometry {
  const b = newBuilder();
  const spec: SurfaceSpec = typeof o.mat === 'string' ? SURFACES[o.mat] : o.mat ?? SURFACES.wool;
  const s = P.s;
  const g = P.build.bulk;
  const top = P.j.neck[1] + 0.005 * s;
  const bottom = P.ankleH + (1 - o.length) * (P.j.shin_l[1] - P.ankleH) * 1.8;
  const H = top - bottom;
  const iC = rig.boneIndex('chest');
  const chains = ['l', 'r'].map((sd) => [1, 2, 3].map((k) => rig.boneIndex(`cloak${k}_${sd}`)));
  const ys = [1, 2, 3].map((k) => P.j[`cloak${k}_l`][1]);
  const base = new THREE.Color().setHex(o.color, THREE.SRGBColorSpace);
  const trim = new THREE.Color().setHex(o.color2 ?? o.color, THREE.SRGBColorSpace);
  const n2 = noise2(o.seed ?? 5);
  const a0 = Math.PI * 0.42;
  const a1 = Math.PI * 1.58;
  const nv = Math.max(8, Math.round(H / (0.05 * s)));
  const nu = 16;
  const w: [number, number][] = [];
  const rxTop = P.shoulderX * 0.62 + 0.03 * s;
  const rzTop = 0.105 * s * Math.sqrt(g) * P.build.chest + 0.03 * s;
  const rxLow = P.shoulderX + 0.08 * s * g;
  const rzLow = 0.17 * s * g;
  for (let iv = 0; iv <= nv; iv++) {
    const v = iv / nv;
    for (let iu = 0; iu <= nu; iu++) {
      const u = iu / nu;
      const a = a0 + (a1 - a0) * u;
      const sh = Math.min(1, v * 4.5); // shoulders → hanging
      const rx = rxTop + (rxLow - rxTop) * Math.sqrt(sh);
      const rz = rzTop + (rzLow - rzTop) * Math.sqrt(sh);
      let y = top - H * v;
      if (o.ragged && v > 0.9) y += n2(u * 9, o.seed ?? 0) * o.ragged * (v - 0.9) * 10;
      const fold = Math.sin(u * Math.PI * 7) * 0.012 * s * Math.min(1, v * 3);
      const p = new THREE.Vector3(Math.sin(a) * (rx + fold), y, Math.cos(a) * (rz + fold) - 0.03 * s);
      _c.copy(base);
      if (v > 0.96 || u < 0.03 || u > 0.97) _c.lerp(trim, 0.7);
      w.length = 0;
      const side = Math.sin(a) >= 0 ? 0 : 1; // left side of the cloak (x>0) → _l chain
      const blendLR = 0.5 + 0.5 * Math.max(-1, Math.min(1, -Math.sin(a) * 2.5));
      const chainW = (k: number) => {
        // weight for chain level k by height
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
      void side;
      pushVertex(b, p, _c, spec, 0.5 + 0.5 * Math.min(1, v * 2), w);
    }
  }
  for (let iv = 0; iv < nv; iv++)
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * (nu + 1) + iu;
      const c = a + nu + 1;
      b.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  return finish(b);
}
