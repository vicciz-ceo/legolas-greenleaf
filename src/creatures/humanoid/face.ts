/**
 * Head & face sculpt. Coordinates are in "head units" (u = head height, chin → crown) around the
 * cranium centre (crown − 0.43u): x to the character's left, y up, z forward.
 *
 * Landmarks (average adult, u ≈ 23 cm): eyes at (±0.135, −0.075, 0.29) r 0.052; glabella z 0.395;
 * nose tip (0, −0.27, 0.465); mouth (0, −0.40, 0.385); chin (0, −0.53, 0.36); cheekbones ±0.27;
 * jaw angle (±0.245, −0.40, 0.02). FaceDef multipliers scale these.
 *
 * Eyes are separate meshes sitting in a socket with eyelid shells and an almond slit cut through
 * them, so only the cornea/iris and a little sclera show. Jaw, chin and lower lip skin to `jaw`.
 */
import type { PrimOpts, Sculpt, V3 } from '../kit/sdf';
import type { FaceDef, ResolvedKind } from './types';
import type { Proportions } from './proportions';
import type { Rng } from '../../core/rng';

export interface HeadInfo {
  /** eye centres (model space) and radius */
  eyes: { l: V3; r: V3; radius: number };
  /** face region box (model) for fine meshing */
  faceBox: { min: V3; max: V3 };
  headBox: { min: V3; max: V3 };
}

export const EYE = { x: 0.135, y: -0.075, z: 0.29 };

export function sculptHead(s: Sculpt, P: Proportions, def: ResolvedKind, rng: Rng): HeadInfo {
  const f: FaceDef = def.face;
  const u = P.headH;
  const h = (x: number, y: number, z: number): V3 => P.h(x, y, z);
  const skin = def.skin;
  const sk: PrimOpts = { mat: skin.surface, color: skin.color, color2: skin.color2, colorNoise: skin.blotch * 0.6, colorFreq: 30 / P.s };
  const jw = f.jaw;
  const jl = f.jawLength;
  const nl = f.nose.length;
  const nw = f.nose.width;
  const lw = f.lips.width;
  const lf = f.lips.fullness;
  const brow = f.brow;
  const cb = f.cheekbones;
  const asym = (v: number) => v * (1 + (rng.float() - 0.5) * f.asym * 0.5);
  const ex = EYE.x * f.eyeSpacing;
  const ey = EYE.y;
  const ez = EYE.z;
  const er = P.eyeR / u;
  const slope = f.foreheadSlope;

  s.with({ ...sk, bone: 'head' }, () => {
    // cranium, forehead, mid-face
    s.ellipsoid(h(0, 0.035, -0.05), [0.315 * u, 0.395 * u * f.cranium, 0.425 * u], { k: 0.02 * u });
    s.ellipsoid(h(0, 0.13 - slope * 0.04, 0.13 - slope * 0.1), [0.262 * u, 0.24 * u, 0.245 * u], { k: 0.08 * u });
    // face wedge: wide at the cheekbones, tapering smoothly to the chin (no cheek/jaw ledge)
    s.cone(h(0, -0.1, 0.105), h(0, -0.47 * jl, 0.215), 0.255 * u * (0.88 + 0.12 * jw), 0.118 * u * (0.85 + 0.15 * jw), { k: 0.1 * u });
    // soft cheek pads between nose and cheekbone (youthful fullness)
    s.mirrored(() => s.ellipsoid(h(0.16, -0.215, 0.235), [0.1 * u, 0.1 * u, 0.075 * u], { k: 0.1 * u }));
    // cheekbones: high and lateral
    s.mirrored((side) => s.ellipsoid(h(asym(0.228), -0.11, 0.175), [0.062 * u * cb, 0.044 * u * Math.sqrt(cb), 0.1 * u], { k: 0.075 * u, rot: [0, 0.42 * side, 0.12 * side] }));
    // temples narrow slightly
    s.mirrored(() => s.ellipsoid(h(0.31, 0.08, 0.12), [0.022 * u, 0.08 * u, 0.05 * u], { op: 'subtract', k: 0.08 * u }));
    // dental arch / muzzle
    s.ellipsoid(h(0, -0.37, 0.24 + 0.04 * f.underbite), [0.16 * u * (0.9 + 0.1 * jw), 0.13 * u, 0.15 * u], { k: 0.07 * u });
  });
  // jaw (ramus + mandible body): skin blends head → jaw toward the chin
  s.with({ ...sk, bone: 'head', bone2: 'jaw', blend: [0.25, 0.8] }, () => {
    s.mirrored(() => {
      const ear = h(0.27 * jw, -0.2, -0.04);
      const gon = h(0.245 * jw, -0.4 * jl, 0.02);
      const chinSide = h(0.09 * (0.7 + 0.3 * jw), -0.54 * jl, 0.27);
      s.cone(ear, gon, 0.052 * u, 0.05 * u * jw, { k: 0.09 * u, blendAxis: [ear, chinSide] });
      s.cone(gon, chinSide, 0.05 * u * jw, 0.048 * u, { k: 0.09 * u, blendAxis: [ear, chinSide] });
    });
  });
  s.with({ ...sk, bone: 'jaw' }, () => {
    s.ellipsoid(h(0, -0.52 * jl, 0.29 + 0.03 * (f.chin - 1) + 0.06 * f.underbite), [0.095 * u * (0.8 + 0.2 * jw), 0.074 * u, 0.075 * u * (0.85 + 0.15 * f.chin)], { k: 0.06 * u });
    if (f.underbite > 0) s.ellipsoid(h(0, -0.44 * jl, 0.3 + 0.06 * f.underbite), [0.15 * u * jw, 0.06 * u, 0.08 * u], { k: 0.06 * u });
  });
  s.with({ ...sk, bone: 'head' }, () => {
    // brow ridge
    s.mirrored(() => s.cone(h(asym(0.2), 0.0, 0.29), h(0.05, 0.012, 0.37 + 0.015 * (brow - 1)), 0.034 * u * brow, 0.035 * u * brow, { k: 0.06 * u }));
    // eye socket cavity, eyelid shells, almond slit
    s.mirrored(() => s.ellipsoid(h(ex, ey + 0.022, ez + 0.045), [0.09 * u, 0.056 * u, 0.06 * u], { op: 'subtract', k: 0.035 * u }));
    s.mirrored(() => s.sphere(h(ex, ey, ez), (er * f.eyeSize + 0.012) * u, { k: 0.02 * u }));
    // keep the lower lid / under-eye full (no dark hollow)
    s.mirrored(() => s.ellipsoid(h(ex + 0.005, ey - 0.058, ez + 0.035), [0.07 * u, 0.03 * u, 0.042 * u], { k: 0.035 * u }));
    s.mirrored((side) =>
      s.ellipsoid(h(ex, ey + 0.004, ez + er * f.eyeSize * 0.95), [0.1 * u * f.eyeSize, 0.0235 * u * f.eyeOpen * f.eyeSize, 0.045 * u], {
        op: 'subtract',
        k: 0.005 * u,
        rot: [0, 0, f.eyeTilt * side],
      }),
    );
    // upper-lid fold
    s.mirrored((side) => s.cone(h(ex - 0.06, ey + 0.04, ez + 0.048), h(ex + 0.065, ey + 0.032 + f.eyeTilt * 0.08 * side * side, ez + 0.0), 0.011 * u, 0.009 * u, { k: 0.016 * u }));
    // nose
    const hook = f.nose.hook;
    const flat = f.nose.flat ?? 0;
    const tipZ = 0.465 + 0.035 * (nl - 1) - 0.07 * flat;
    const tipY = -0.27 * nl;
    s.cone(h(0, -0.045, 0.37), h(0, tipY + 0.035, tipZ - 0.012 + 0.02 * hook), 0.025 * u * nw * Math.sqrt(f.nose.bridge), 0.033 * u * nw, { k: 0.035 * u });
    if (hook > 0) s.sphere(h(0, -0.13 * nl, 0.425 + 0.035 * hook), 0.032 * u * nw, { k: 0.03 * u });
    s.sphere(h(0, tipY + 0.006, tipZ - 0.02), 0.041 * u * f.nose.tip * Math.sqrt(nw), { k: 0.028 * u });
    s.mirrored(() => s.sphere(h(0.048 * nw * (1 + flat * 0.5), tipY - 0.012, tipZ - 0.062), 0.031 * u * nw, { k: 0.024 * u }));
    s.mirrored(() => s.ellipsoid(h(0.025 * nw, tipY - 0.033, tipZ - 0.045), [0.013 * u * nw, 0.0075 * u, 0.016 * u], { op: 'subtract', k: 0.005 * u }));
  });
  // lips
  const my = -0.4;
  s.with({ ...sk, bone: 'head' }, () => {
    s.ellipsoid(h(0, my + 0.017, 0.383), [0.094 * u * lw, 0.021 * u * lf, 0.026 * u * lf], { k: 0.012 * u });
  });
  s.with({ ...sk, bone: 'jaw' }, () => {
    s.ellipsoid(h(0, my - 0.024, 0.376), [0.082 * u * lw, 0.024 * u * lf, 0.026 * u * lf], { k: 0.012 * u });
  });
  s.with({ bone: 'head', bone2: 'jaw', blend: [0.3, 0.7], blendAxis: [h(0, my + 0.01, 0), h(0, my - 0.02, 0)] }, () => {
    s.ellipsoid(h(0, my - 0.002, 0.405), [0.098 * u * lw, 0.0045 * u, 0.034 * u], { op: 'subtract', k: 0.004 * u });
    s.mirrored(() => s.sphere(h(0.097 * lw, my - 0.002, 0.368), 0.009 * u, { op: 'subtract', k: 0.009 * u }));
  });
  // lip colour, eyebrows
  s.ellipsoid(h(0, my - 0.002, 0.392), [0.093 * u * lw, 0.04 * u * lf, 0.04 * u], { op: 'paint', k: 0.007 * u, color: skin.lips, mat: 'lips', bone: 'head', strength: 0.85 });
  s.mirrored((side) =>
    s.cone(h(ex - 0.075, ey + 0.088, 0.372), h(ex + 0.075, ey + 0.083 + f.eyeTilt * 0.12 * side * side, 0.31), 0.012 * u, 0.008 * u, { op: 'paint', k: 0.006 * u, color: skin.brows, mat: 'skin', bone: 'head', strength: 0.75 }),
  );
  // tusks
  if (f.tusks > 0) {
    s.mirrored(() =>
      s.cone(h(0.075, my - 0.05, 0.35), h(0.095, my + 0.07 * f.tusks, 0.385), 0.017 * u * f.tusks, 0.005 * u, { bone: 'jaw', color: 0xd8cca8, mat: 'teeth', k: 0.004 * u }),
    );
  }
  sculptEars(s, P, f, sk);
  // scars
  for (let i = 0; i < (skin.scars ?? 0); i++) {
    const x = rng.range(-0.22, 0.22), y = rng.range(-0.35, 0.15);
    const z = 0.36 - Math.abs(x) * 0.5;
    s.cone(h(x, y, z), h(x + rng.range(-0.1, 0.1), y + rng.range(-0.18, -0.06), z), 0.009 * u, 0.006 * u, {
      op: 'subtract',
      k: 0.006 * u,
      color: 0x8a4a40,
      paintCarve: true,
      mat: 'skin_orc',
      bone: 'head',
    });
  }
  const r = P.eyeR * f.eyeSize;
  return {
    eyes: { l: h(ex, ey, ez), r: h(-ex, ey, ez), radius: r },
    faceBox: { min: h(-0.31, -0.62 * Math.max(1, jl), 0.12), max: h(0.31, 0.1, 0.56 + 0.08 * Math.max(0, nl - 1)) },
    headBox: { min: h(-0.5, -0.8 * Math.max(1, jl), -0.56), max: h(0.5, 0.5, 0.62) },
  };
}

function sculptEars(s: Sculpt, P: Proportions, f: FaceDef, sk: PrimOpts) {
  const u = P.headH;
  const h = (x: number, y: number, z: number): V3 => P.h(x, y, z);
  const es = f.earSize;
  const o: PrimOpts = { color: sk.color, mat: sk.mat, color2: sk.color2, colorNoise: sk.colorNoise, colorFreq: sk.colorFreq, bone: 'head' };
  s.mirrored(() => {
    const x0 = 0.31;
    // ear plate tilted back and angled away from the head
    s.ellipsoid(h(x0 + 0.03, -0.11, -0.035), [0.022 * u, 0.125 * u * es, 0.066 * u * es], { ...o, k: 0.025 * u, rot: [-0.22, 0.38, 0] });
    if (f.ears === 'pointed' || f.ears === 'long' || f.ears === 'bat') {
      const len = f.ears === 'long' ? 1.6 : f.ears === 'bat' ? 1.3 : 1;
      s.cone(h(x0 + 0.045, -0.03, -0.065), h(x0 + 0.08 * len, 0.12 + 0.07 * es * len, -0.135 * len), 0.04 * u * es, 0.006 * u, { ...o, k: 0.02 * u });
    } else if (f.ears === 'orc') {
      s.cone(h(x0 + 0.04, -0.05, -0.06), h(x0 + 0.15, 0.04 * es, -0.13), 0.045 * u * es, 0.012 * u, { ...o, k: 0.02 * u });
    }
    // concha hollow and earlobe
    s.ellipsoid(h(x0 + 0.06, -0.115, -0.02), [0.016 * u, 0.065 * u * es, 0.036 * u * es], { op: 'subtract', k: 0.012 * u, rot: [-0.22, 0.38, 0] });
    s.sphere(h(x0 + 0.035, -0.215 * es - 0.01, -0.012), 0.024 * u * es, { ...o, k: 0.02 * u });
  });
}
