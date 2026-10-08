/**
 * Head & face sculpt. Coordinates are in "head units" (u = head height, chin → crown) around the
 * cranium centre (crown − 0.43u): x to the character's left, y up, z forward.
 *
 * Landmarks (average adult, u ≈ 23 cm): eyes at (±0.135, −0.075, 0.29) r ≈ 0.052; glabella z 0.39;
 * nose tip (0, −0.26, 0.46); mouth (0, −0.40, 0.385); chin (0, −0.53, 0.30); cheekbones ±0.23;
 * jaw angle (±0.24, −0.42, 0.0). FaceDef multipliers scale these.
 *
 * Construction (all smooth unions, so there are no seams or hollows):
 *   cranium + forehead + a full midface mass (cheeks never cave in) + cheekbones + cheek pads +
 *   dental arch; mandible chains (ear → jaw angle → chin) blended head → jaw; brow ridge; a shallow
 *   orbit; eyelids = a thin shell around the eyeball with an almond (two-circle lens) opening cut
 *   through it, plus a soft upper-lid crease; nose = bridge cone, tip, alae, nostrils; lips =
 *   upper/lower vermilion volumes, philtrum groove, mouth slit and corners, labiomental shadow.
 * Colour: lips, soft redness on cheeks / nose / ears, a faint brow base (cards add the hairs).
 * Eyes are separate meshes (build.ts); lashes and brows are hair cards placed from `HeadInfo`.
 */
import type { PrimOpts, Sculpt, V3 } from '../kit/sdf';
import type { FaceDef, ResolvedKind } from './types';
import type { Proportions } from './proportions';
import type { Rng } from '../../core/rng';
import * as THREE from 'three';

export interface HeadInfo {
  /** eye centres (model space) and radius */
  eyes: { l: V3; r: V3; radius: number };
  /** face region box (model) for fine meshing */
  faceBox: { min: V3; max: V3 };
  headBox: { min: V3; max: V3 };
  /** model-space points along each upper-lid margin, inner → outer corner (lash roots) */
  upperLid: { l: V3[]; r: V3[] };
  /** model-space points along each brow, inner → outer (brow hair roots, before surface projection) */
  brow: { l: V3[]; r: V3[] };
  /** forward direction of the face (model) used to orient lashes/brows */
  forward: V3;
}

export const EYE = { x: 0.135, y: -0.075, z: 0.29 };

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
function mixHex(a: number, b: number, t: number): number {
  _c1.setHex(a, THREE.SRGBColorSpace);
  _c2.setHex(b, THREE.SRGBColorSpace);
  return _c1.lerp(_c2, t).getHex(THREE.SRGBColorSpace);
}

export function sculptHead(s: Sculpt, P: Proportions, def: ResolvedKind, rng: Rng): HeadInfo {
  const f: FaceDef = def.face;
  const u = P.headH;
  const h = (x: number, y: number, z: number): V3 => P.h(x, y, z);
  const skin = def.skin;
  // facial skin: blotches toned down (they read as dirt at close range)
  const sk: PrimOpts = { mat: skin.surface, color: skin.color, color2: skin.color2, colorNoise: skin.blotch * 0.45, colorFreq: 22 / P.s };
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
  const er = (P.eyeR / u) * f.eyeSize;
  const slope = f.foreheadSlope;
  const brute = Math.max(0, Math.min(1, (brow - 1) / 0.8)); // 0 elves/men … 1 orcs/trolls

  s.with({ ...sk, bone: 'head' }, () => {
    // cranium and forehead
    s.ellipsoid(h(0, 0.035, -0.05), [0.315 * u, 0.395 * u * f.cranium, 0.425 * u], { k: 0.02 * u });
    s.ellipsoid(h(0, 0.13 - slope * 0.04, 0.13 - slope * 0.1), [0.262 * u, 0.24 * u, 0.245 * u], { k: 0.08 * u });
    // midface mass: cheek to cheek, brow to upper lip — keeps the cheeks full (no gaunt hollows)
    s.ellipsoid(h(0, -0.17, 0.135), [(0.222 + 0.02 * cb) * (0.92 + 0.08 * jw) * u, 0.25 * u, 0.245 * u], { k: 0.1 * u });
    // face wedge toward the chin (narrow, smooth jawline)
    s.cone(h(0, -0.14, 0.12), h(0, -0.43 * jl, 0.2), 0.225 * u * (0.9 + 0.1 * jw), 0.094 * u * (0.85 + 0.15 * jw), { k: 0.1 * u });
    // masseter: fills the side of the face between cheekbone and jaw angle (no hollow cheeks)
    s.mirrored(() => s.ellipsoid(h(0.178 * (0.9 + 0.1 * jw), -0.27, 0.07), [0.05 * u, 0.1 * u, 0.1 * u], { k: 0.1 * u }));
    // cheek pads (youthful fullness under the cheekbones)
    s.mirrored(() => s.ellipsoid(h(0.15, -0.23, 0.215), [0.094 * u, 0.1 * u, 0.084 * u], { k: 0.11 * u }));
    // cheekbones: high and lateral
    s.mirrored((side) => s.ellipsoid(h(asym(0.222), -0.105, 0.19), [0.064 * u * cb, 0.044 * u * Math.sqrt(cb), 0.095 * u], { k: 0.075 * u, rot: [0, 0.42 * side, 0.12 * side] }));
    // temples narrow very slightly
    s.mirrored(() => s.ellipsoid(h(0.315, 0.08, 0.12), [0.02 * u, 0.075 * u, 0.045 * u], { op: 'subtract', k: 0.08 * u }));
    // dental arch / muzzle
    s.ellipsoid(h(0, -0.37, 0.232 + 0.04 * f.underbite), [0.15 * u * (0.9 + 0.1 * jw), 0.125 * u, 0.15 * u], { k: 0.11 * u });
  });
  // mandible (ramus + body): skin blends head → jaw toward the chin
  s.with({ ...sk, bone: 'head', bone2: 'jaw', blend: [0.25, 0.8] }, () => {
    s.mirrored(() => {
      const ear = h(0.265 * jw, -0.2, -0.045);
      const gon = h(0.222 * jw, -0.39 * jl, 0.0);
      const chinSide = h(0.08 * (0.7 + 0.3 * jw), -0.5 * jl, 0.265);
      s.cone(ear, gon, 0.055 * u, 0.052 * u * jw, { k: 0.09 * u, blendAxis: [ear, chinSide] });
      s.cone(gon, chinSide, 0.052 * u * jw, 0.05 * u, { k: 0.1 * u, blendAxis: [ear, chinSide] });
    });
  });
  s.with({ ...sk, bone: 'jaw' }, () => {
    // chin: defined but soft
    s.ellipsoid(h(0, -0.482 * jl, 0.288 + 0.03 * (f.chin - 1) + 0.06 * f.underbite), [0.08 * u * (0.8 + 0.2 * jw), 0.06 * u, 0.066 * u * (0.85 + 0.15 * f.chin)], { k: 0.055 * u });
    if (f.underbite > 0) s.ellipsoid(h(0, -0.44 * jl, 0.3 + 0.06 * f.underbite), [0.15 * u * jw, 0.06 * u, 0.08 * u], { k: 0.06 * u });
  });

  // ── brow & eyes ───────────────────────────────────────────────────────────
  const rs = er + 0.0085 + 0.004 * brute; // eyelid shell radius (thin lids)
  const w = 0.066 * f.eyeSize * (0.95 + 0.05 * f.eyeSpacing); // almond half-width
  const hU = 0.0198 * f.eyeOpen * f.eyeSize; // upper lid height above the eye centre (covers the iris top)
  const hL = 0.0172 * f.eyeOpen * f.eyeSize; // lower lid below
  const cU = (w * w - hU * hU) / (2 * hU);
  const cL = (w * w - hL * hL) / (2 * hL);
  const zc = ez + er * 0.62; // lens plane (through the lid front)
  const tilt = f.eyeTilt;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  /** lens-frame (x right-of-eye outward, y up) → head units around the eye */
  const lens = (lx: number, ly: number, z: number): V3 => h(ex + lx * ct - ly * st, ey + lx * st + ly * ct, z);
  s.with({ ...sk, bone: 'head' }, () => {
    // brow ridge (soft for elves, heavy for orcs)
    s.mirrored(() => s.cone(h(asym(0.2), 0.0, 0.285), h(0.05, 0.01, 0.365 + 0.015 * (brow - 1)), 0.032 * u * brow, 0.034 * u * brow, { k: 0.065 * u }));
    // shallow orbit above the eye (under the brow)
    s.mirrored(() => s.ellipsoid(h(ex, ey + 0.028, ez + 0.05), [0.082 * u, 0.042 * u, 0.045 * u], { op: 'subtract', k: 0.04 * u }));
    // lower lid / under-eye fullness (no dark hollow)
    s.mirrored(() => s.ellipsoid(h(ex + 0.004, ey - 0.062, ez + 0.022), [0.064 * u, 0.026 * u, 0.04 * u], { k: 0.035 * u }));
    // eyelid shell around the eyeball, with the almond opening cut through it
    s.mirrored(() => s.sphere(h(ex, ey + 0.002, ez), rs * u, { k: 0.026 * u }));
    s.mirrored(() =>
      s.group('subtract', 0.0035 * u, () => {
        s.sphere(lens(0, -cU, zc), (cU + hU) * u);
        s.sphere(lens(0, cL, zc), (cL + hL) * u, { op: 'intersect', k: 0.002 * u });
      }),
    );
    // upper-lid crease (soft groove along the orbit)
    {
      const shellZ = (lx: number, ly: number) => ez + Math.sqrt(Math.max(0, rs * rs - lx * lx - ly * ly)) - 0.001;
      const ay = hU + 0.02, by = hU + 0.012;
      s.mirrored(() => s.cone(lens(-w * 0.8, ay, shellZ(-w * 0.8, ay)), lens(w * 0.95, by, shellZ(w * 0.95, by)), 0.0075 * u, 0.006 * u, { op: 'subtract', k: 0.012 * u }));
    }
    // ── nose ──
    const hook = f.nose.hook;
    const flat = f.nose.flat ?? 0;
    const tipZ = 0.462 + 0.035 * (nl - 1) - 0.07 * flat;
    const tipY = -0.262 * nl;
    // radix → dorsum → supratip: a slim straight bridge
    s.cone(h(0, -0.035, 0.368), h(0, tipY + 0.045, tipZ - 0.018 + 0.02 * hook), 0.021 * u * nw * Math.sqrt(f.nose.bridge), 0.027 * u * nw, { k: 0.026 * u });
    if (hook > 0) s.sphere(h(0, -0.13 * nl, 0.42 + 0.035 * hook), 0.03 * u * nw, { k: 0.03 * u });
    // tip (slightly bilobed) and columella
    s.sphere(h(0, tipY + 0.008, tipZ - 0.022), 0.032 * u * f.nose.tip * Math.sqrt(nw), { k: 0.022 * u });
    s.ellipsoid(h(0, tipY - 0.028, tipZ - 0.04), [0.014 * u * nw, 0.016 * u, 0.026 * u], { k: 0.012 * u });
    // alae (nostril wings)
    s.mirrored(() => s.ellipsoid(h(0.04 * nw * (1 + flat * 0.5), tipY - 0.022, tipZ - 0.066), [0.024 * u * nw, 0.021 * u, 0.028 * u], { k: 0.02 * u }));
    // nostrils (angled up into the nose)
    s.mirrored(() => s.ellipsoid(h(0.02 * nw, tipY - 0.043, tipZ - 0.056), [0.0085 * u * nw, 0.0048 * u, 0.014 * u], { op: 'subtract', k: 0.004 * u, rot: [0.5, 0.25, 0], color: mixHex(skin.lips, 0x2a1a16, 0.4), paintCarve: true }));
  });

  // ── mouth ──
  const my = -0.39;
  s.with({ ...sk, bone: 'head' }, () => {
    // upper lip (two halves meet in a soft cupid's bow)
    s.mirrored(() => s.ellipsoid(h(0.03 * lw, my + 0.017, 0.374), [0.064 * u * lw, 0.019 * u * lf, 0.025 * u * lf], { k: 0.012 * u, rot: [0, 0, -0.08] }));
    // philtrum groove
    s.ellipsoid(h(0, my + 0.068, 0.402), [0.011 * u, 0.038 * u, 0.01 * u], { op: 'subtract', k: 0.014 * u });
  });
  s.with({ ...sk, bone: 'jaw' }, () => {
    s.ellipsoid(h(0, my - 0.025, 0.367), [0.076 * u * lw, 0.024 * u * lf, 0.027 * u * lf], { k: 0.013 * u });
    // labiomental groove (soft shadow under the lower lip)
    s.ellipsoid(h(0, my - 0.072, 0.362), [0.055 * u, 0.011 * u, 0.012 * u], { op: 'subtract', k: 0.022 * u });
  });
  // the mouth line is the crease where the two lip volumes meet (a carved slit thinner than a
  // face cell aliases into "teeth"); the corners and the seam are darkened by paint below
  // ── colour ──
  // lips: upper and lower vermilion (soft edge), slightly darker upper lip
  const lipC = skin.lips;
  s.mirrored(() => s.ellipsoid(h(0.03 * lw, my + 0.018, 0.392), [0.063 * u * lw, 0.019 * u * lf, 0.035 * u], { op: 'paint', k: 0.011 * u, color: mixHex(lipC, 0x000000, 0.06), mat: 'lips', bone: 'head', strength: 0.85, rot: [0, 0, -0.08] }));
  s.ellipsoid(h(0, my - 0.024, 0.384), [0.072 * u * lw, 0.021 * u * lf, 0.035 * u], { op: 'paint', k: 0.012 * u, color: lipC, mat: 'lips', bone: 'jaw', strength: 0.85 });
  // the mouth line itself: a soft dark seam between the lips, deeper at the corners
  s.ellipsoid(h(0, my - 0.003, 0.4), [0.086 * u * lw, 0.004 * u, 0.04 * u], { op: 'paint', k: 0.02 * u, color: mixHex(lipC, 0x2a1210, 0.45), mat: 'lips', bone: 'head', strength: 0.55 });
  s.mirrored(() => s.sphere(h(0.09 * lw, my - 0.003, 0.37), 0.008 * u, { op: 'paint', k: 0.01 * u, color: mixHex(skin.color, 0x3a2020, 0.35), mat: skin.surface, bone: 'head', strength: 0.6 }));
  // lid margins: slightly darker, pinker skin right around the opening (reads as the lash line)
  s.mirrored(() => s.ellipsoid(lens(0, (hU - hL) / 2, ez + rs * 0.9), [w * 1.0 * u, ((hU + hL) / 2) * 1.2 * u, rs * 0.6 * u], { op: 'paint', k: 0.014 * u, color: mixHex(skin.color, mixHex(skin.lips, 0x3a2420, 0.35), 0.5), mat: skin.surface, bone: 'head', strength: 0.55, rot: [0, 0, tilt] }));
  // warmth: faint redness on the cheeks, nose and (in sculptEars) the ears
  const blush = mixHex(skin.color, mixHex(skin.lips, 0xd06a5a, 0.5), 0.55);
  const warm = brute < 0.5 ? 1 - brute * 2 : 0;
  if (warm > 0) {
    s.mirrored(() => s.ellipsoid(h(0.17, -0.2, 0.25), [0.07 * u, 0.06 * u, 0.06 * u], { op: 'paint', k: 0.07 * u, color: blush, mat: skin.surface, bone: 'head', strength: 0.32 * warm }));
    s.ellipsoid(h(0, -0.24 * nl, 0.45), [0.04 * u, 0.04 * u, 0.04 * u], { op: 'paint', k: 0.045 * u, color: blush, mat: skin.surface, bone: 'head', strength: 0.38 * warm });
  }
  // brow base tint (the brow hairs themselves are cards)
  s.mirrored((side) =>
    s.cone(h(ex - 0.07, ey + 0.092, 0.37), h(ex + 0.075, ey + 0.088 + tilt * 0.12 * side * side, 0.31), 0.011 * u, 0.007 * u, { op: 'paint', k: 0.016 * u, color: skin.brows, mat: skin.surface, bone: 'head', strength: 0.18 }),
  );
  // tusks
  if (f.tusks > 0) {
    s.mirrored(() =>
      s.cone(h(0.075, my - 0.05, 0.35), h(0.095, my + 0.07 * f.tusks, 0.385), 0.017 * u * f.tusks, 0.005 * u, { bone: 'jaw', color: 0xd8cca8, mat: 'teeth', k: 0.004 * u }),
    );
  }
  sculptEars(s, P, f, sk, warm > 0 ? blush : null);
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

  // ── anchors for lashes and brows (left side; mirrored for the right) ──
  const lidPts: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = -0.92 + (1.84 * i) / 10; // inner (−) → outer (+) along the lens, in units of w
    const lx = t * w;
    const ly = -cU + Math.sqrt(Math.max(0, (cU + hU) * (cU + hU) - lx * lx));
    const gx = lx * ct - ly * st, gy = lx * st + ly * ct;
    const zz = Math.sqrt(Math.max(0, rs * rs - gx * gx - gy * gy));
    lidPts.push(h(ex + gx, ey + 0.002 + gy, ez + zz));
  }
  // inner corner is toward the nose (−x for the left eye): reverse so the list runs inner → outer
  const lidL = lidPts.map((p) => p);
  const browL: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const bx = ex - 0.075 + 0.155 * t;
    const by = ey + 0.09 + 0.012 * Math.sin(t * Math.PI) * 1.2 + (t > 0.5 ? tilt * 0.12 * (t - 0.5) * 2 : 0) - 0.004 * t;
    browL.push(h(bx, by, 0.4));
  }
  const mirror = (p: V3): V3 => [-p[0], p[1], p[2]];
  const r = P.eyeR * f.eyeSize;
  return {
    eyes: { l: h(ex, ey, ez), r: h(-ex, ey, ez), radius: r },
    faceBox: { min: h(-0.31, -0.62 * Math.max(1, jl), 0.12), max: h(0.31, 0.1, 0.56 + 0.08 * Math.max(0, nl - 1)) },
    headBox: { min: h(-0.5, -0.8 * Math.max(1, jl), -0.56), max: h(0.5, 0.5, 0.62) },
    upperLid: { l: lidL, r: lidL.map(mirror) },
    brow: { l: browL, r: browL.map(mirror) },
    forward: [0, 0, 1],
  };
}

function sculptEars(s: Sculpt, P: Proportions, f: FaceDef, sk: PrimOpts, blush: number | null) {
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
      s.cone(h(x0 + 0.045, -0.04, -0.07), h(x0 + 0.075 * len, 0.1 + 0.07 * es * len, -0.14 * len), 0.04 * u * es, 0.005 * u, { ...o, k: 0.02 * u });
    } else if (f.ears === 'orc') {
      s.cone(h(x0 + 0.04, -0.05, -0.06), h(x0 + 0.15, 0.04 * es, -0.13), 0.045 * u * es, 0.012 * u, { ...o, k: 0.02 * u });
    }
    // concha hollow and earlobe
    s.ellipsoid(h(x0 + 0.062, -0.115, -0.02), [0.016 * u, 0.062 * u * es, 0.034 * u * es], { op: 'subtract', k: 0.012 * u, rot: [-0.22, 0.38, 0] });
    s.sphere(h(x0 + 0.035, -0.215 * es - 0.01, -0.012), 0.023 * u * es, { ...o, k: 0.02 * u });
    // the ears are thin and catch light: a little warmer
    if (blush !== null) s.ellipsoid(h(x0 + 0.05, -0.08, -0.06), [0.06 * u, 0.16 * u * es, 0.1 * u], { op: 'paint', k: 0.04 * u, color: blush, mat: sk.mat, bone: 'head', strength: 0.3 });
  });
}
