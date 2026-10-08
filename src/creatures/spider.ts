/**
 * Mirkwood spider + the Brood Mother — built with the creature kit (src/creatures/kit).
 *
 *  - rig: cephalothorax (`body`), `abdomen`, chelicerae (`fang_l/r`), pedipalps (`palp{a,b}_l/r`),
 *    8 legs × (femur `leg{i}a`, tibia `leg{i}b`, tarsus `leg{i}c`).
 *  - sculpt: glossy chitin carapace with radial grooves, fovea and ocular tubercle, hairy bulbous
 *    chelicerae with curved fangs, a big mottled abdomen with a pale folium + chevrons + lateral
 *    spots (the Brood Mother: pale skull-like markings and old scars), spinnerets.
 *  - legs/palps: rigid tapered segments (crisp joints) with pale joint bands and macrosetae spines.
 *  - hair: coarse bristle cards on legs, abdomen and carapace rim.
 *  - eyes: eight glossy black eyes in two rows in a separate tiny mesh with a faint ember glow
 *    (they glint in the dark; the body material stays non-emissive).
 *  - animation: alternating-tetrapod gait (insectGait) with per-leg two-bone IK + tarsus aim,
 *    turning in place, trunk-wrap for climbing, rear-up threat, lunge-bite, web spit, hanging on
 *    silk, leap, Brood Mother leg stabs / summon, stunned twitching, curled death.
 *
 * `createSpiderModel(variant, seed)` → `{ object, creature, pose(anim, t), apply(params) }`.
 * `pose(anim, t)` is deterministic (lab); gameplay drives `apply(params)` every frame.
 * `preloadSpiders()` meshes both sculpts in the worker pool (call it in a chapter's create()).
 */
import * as THREE from 'three';
import { RigDef } from './kit/rig';
import { Sculpt, type V3 } from './kit/sdf';
import { buildCreature, type Creature } from './kit/creature';
import { solveTwoBone, aimBone, insectGait, envelope, gaitFrequency, type FootSample } from './kit/anim';
import { growStrands, hairGeometry, type GrowRoot } from './kit/hair';
import { surface } from './kit/surfaces';
import { segmentMatrix, limbSegment } from './kit/geometry';
import { meshSculptAsync } from './kit/cache';
import type { MeshOpts } from './kit/mesher';
import { mulberry32 } from '../core/rng';

export type SpiderVariant = 'spider' | 'brood';

const LEGS = 4; // pairs
const YAW = [0.5, 1.22, 1.95, 2.6]; // leg direction from +Z (radians), left side
const LEN = [1.16, 1.0, 0.95, 1.1]; // leg length multipliers

interface LegRest {
  A: THREE.Vector3; // femur base
  B: THREE.Vector3; // knee
  C: THREE.Vector3; // ankle
  D: THREE.Vector3; // foot tip
  out: THREE.Vector3; // outward direction (xz)
}

interface VariantDef {
  /** overall scale (1 = the kit example, ~2.2 m span) */
  scale: number;
  base: number;
  base2: number;
  /** abdomen pattern colour */
  mark: number;
  markStrength: number;
  /** pale skull mark + scars (Brood Mother) */
  brood: boolean;
  hairTip: number;
  eyeGlow: number;
  res: number;
}

const VARIANTS: Record<SpiderVariant, VariantDef> = {
  // ~1.3 m tall, ~2.6 m leg span
  spider: { scale: 1.15, base: 0x1a1512, base2: 0x3a2d22, mark: 0x7e6c52, markStrength: 0.85, brood: false, hairTip: 0x6a5844, eyeGlow: 0x3c0c04, res: 0.032 },
  // ~3.1 m tall, ~6 m leg span, pale markings, scarred
  brood: { scale: 2.7, base: 0x16120f, base2: 0x34291f, mark: 0xb9ad98, markStrength: 1, brood: true, hairTip: 0x8a7a66, eyeGlow: 0x4a1006, res: 0.027 },
};

export function spiderRig(scale = 1) {
  const s = scale;
  const rig = new RigDef();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [0, 0.62 * s, 0.12 * s]);
  rig.bone('abdomen', 'body', [0, 0.66 * s, -0.16 * s]);
  rig.pair('fang_l', 'body', [0.05 * s, 0.6 * s, 0.38 * s]);
  // pedipalps: base → knee → tip
  const pa: V3 = [0.075 * s, 0.56 * s, 0.4 * s];
  const pb: V3 = [0.12 * s, 0.66 * s, 0.52 * s];
  const pc: V3 = [0.13 * s, 0.5 * s, 0.6 * s];
  rig.pair('palpa_l', 'body', pa);
  rig.pair('palpb_l', 'palpa_l', pb);
  rig.pair('palpc_l', 'palpb_l', pc);
  const legs: Record<string, LegRest> = {};
  for (let i = 0; i < LEGS; i++) {
    for (const sx of [1, -1]) {
      const side = sx > 0 ? 'l' : 'r';
      const L = LEN[i] * s;
      const out = new THREE.Vector3(sx * Math.sin(YAW[i]), 0, Math.cos(YAW[i]));
      const A = new THREE.Vector3(sx * 0.13 * s, 0.6 * s, (0.2 - i * 0.085) * s).addScaledVector(out, 0.05 * s);
      const B = A.clone().addScaledVector(out, 0.33 * L).add(new THREE.Vector3(0, 0.42 * L, 0));
      const C = B.clone().addScaledVector(out, 0.46 * L).add(new THREE.Vector3(0, -0.56 * L, 0));
      const D = C.clone().addScaledVector(out, 0.2 * L);
      D.y = 0.02 * s;
      legs[`${i}${side}`] = { A, B, C, D, out };
      if (sx > 0) {
        rig.pair(`leg${i}a_l`, 'body', [A.x, A.y, A.z]);
        rig.pair(`leg${i}b_l`, `leg${i}a_l`, [B.x, B.y, B.z]);
        rig.pair(`leg${i}c_l`, `leg${i}b_l`, [C.x, C.y, C.z]);
      }
    }
  }
  const palp = { A: new THREE.Vector3(...pa), B: new THREE.Vector3(...pb), C: new THREE.Vector3(...pc) };
  return { rig, legs, palp };
}

/** eye layout (left side, model space at scale 1): [x, y, z, radius] */
const EYES: [number, number, number, number][] = [
  [0.034, 0.712, 0.41, 0.03], // anterior median (the big pair)
  [0.082, 0.7, 0.385, 0.019], // anterior lateral
  [0.03, 0.752, 0.388, 0.017], // posterior median
  [0.098, 0.73, 0.35, 0.015], // posterior lateral
];

function sculptSpider(s: Sculpt, v: VariantDef, seed: number) {
  const sc = v.scale;
  const P = (x: number, y: number, z: number): V3 => [x * sc, y * sc, z * sc];
  const rnd = mulberry32(1000 + seed * 7 + (v.brood ? 99 : 0));
  const chitin = surface('chitin', { rough: 0.26 });
  const hairy = surface('chitin', { rough: 0.58, pat: { chitin: 0.45, fur: 1.3 } });
  const abdMat = surface('chitin', { rough: 0.42, pat: { chitin: 0.5, fur: 1.0 } });
  const dark = v.base;
  // ── cephalothorax ──────────────────────────────────────────────────────
  s.with({ bone: 'body', mat: chitin, color: dark, color2: v.base2, colorNoise: 0.35, colorFreq: 9 / sc }, () => {
    s.ellipsoid(P(0, 0.62, 0.13), P(0.215, 0.12, 0.26), { k: 0.02 * sc, noise: { amp: 0.005 * sc, freq: 14 / sc, type: 'cells' } });
    s.ellipsoid(P(0, 0.665, 0.31), P(0.13, 0.105, 0.115), { k: 0.06 * sc });
    // ocular tubercle (the raised eye mound)
    s.ellipsoid(P(0, 0.728, 0.37), P(0.075, 0.04, 0.055), { k: 0.03 * sc });
    // radial grooves and the central fovea
    for (let a = -2; a <= 2; a++) s.cone(P(0, 0.745, 0.12), [Math.sin(a * 0.62) * 0.2 * sc, 0.68 * sc, 0.12 * sc + Math.cos(a * 0.62) * 0.17 * sc], 0.012 * sc, 0.006 * sc, { op: 'subtract', k: 0.01 * sc });
    for (let a = 0; a < 4; a++) {
      const ang = Math.PI * 0.62 + a * 0.32;
      s.mirrored(() => s.cone(P(0.02, 0.745, 0.1), [Math.sin(ang) * 0.2 * sc, 0.67 * sc, 0.1 * sc + Math.cos(ang) * 0.2 * sc], 0.01 * sc, 0.005 * sc, { op: 'subtract', k: 0.01 * sc }));
    }
    s.sphere(P(0, 0.75, 0.08), 0.022 * sc, { op: 'subtract', k: 0.012 * sc });
  });
  // eye sockets (the glossy eyes are a separate mesh sitting in them)
  s.mirrored(() => {
    for (const [x, y, z, r] of EYES) s.sphere(P(x, y, z + 0.004), r * sc * 0.92, { op: 'subtract', k: 0.004 * sc, bone: 'body' });
  });
  // ── chelicerae and fangs ───────────────────────────────────────────────
  s.mirrored(() => {
    s.cone(P(0.05, 0.62, 0.36), P(0.046, 0.47, 0.47), 0.058 * sc, 0.038 * sc, { bone: 'fang_l', mat: hairy, color: 0x241c17, color2: 0x3a2c22, colorNoise: 0.3, k: 0.03 * sc, noise: { amp: 0.003 * sc, freq: 40 / sc, type: 'fbm' } });
    s.tube([P(0.046, 0.47, 0.47), P(0.036, 0.42, 0.5), P(0.02, 0.39, 0.505), P(0.006, 0.385, 0.49)], [0.018 * sc, 0.013 * sc, 0.008 * sc, 0.002 * sc], { bone: 'fang_l', mat: surface('horn', { rough: 0.18 }), color: 0x3a1610, k: 0.008 * sc });
  });
  // ── pedicel + abdomen ──────────────────────────────────────────────────
  s.cone(P(0, 0.62, -0.08), P(0, 0.68, -0.22), 0.06 * sc, 0.08 * sc, { bone: 'abdomen', mat: chitin, color: dark, k: 0.04 * sc });
  const abdC = P(0, 0.8, -0.62);
  const abdR = P(v.brood ? 0.4 : 0.37, v.brood ? 0.33 : 0.31, v.brood ? 0.54 : 0.5);
  s.with({ bone: 'abdomen', mat: abdMat, color: 0x231c17, color2: v.base2, colorNoise: 0.5, colorFreq: 6 / sc }, () => {
    s.ellipsoid(abdC, abdR, { k: 0.06 * sc, noise: { amp: 0.009 * sc, freq: 8 / sc, type: 'fbm' } });
    // dorsal ridges (muscle attachment dimples)
    s.mirrored(() => {
      for (let i = 0; i < 4; i++) s.sphere(P(0.08, 1.09 - i * 0.02, -0.42 - i * 0.14), 0.022 * sc, { op: 'subtract', k: 0.02 * sc });
    });
    s.ellipsoid(P(0, 0.72, -1.1), P(0.075, 0.065, 0.07), { k: 0.05 * sc }); // spinnerets
    s.mirrored(() => s.cone(P(0.03, 0.71, -1.14), P(0.045, 0.68, -1.2), 0.025 * sc, 0.012 * sc, { k: 0.015 * sc }));
  });
  // ── abdomen markings ───────────────────────────────────────────────────
  const top = abdC[1] + abdR[1]; // dorsal apex
  const mark = { op: 'paint' as const, bone: 'abdomen', color: v.mark, strength: v.markStrength };
  // folium: a pale dorsal band that narrows backward, edged by chevrons
  s.ellipsoid([0, top - 0.02 * sc, -0.5 * sc], [0.05 * sc, 0.06 * sc, 0.26 * sc], { ...mark, k: 0.035 * sc, strength: v.markStrength * 0.7 });
  for (let i = 0; i < 6; i++) {
    const z = (-0.34 - i * 0.12) * sc;
    const yy = top - (0.01 + i * i * 0.006) * sc;
    const w = (0.17 - i * 0.022) * sc;
    s.mirrored(() => s.cone([0.012 * sc, yy, z], [w, yy - 0.05 * sc, z - 0.09 * sc], 0.026 * sc, 0.016 * sc, { ...mark, k: 0.026 * sc }));
  }
  // lateral spots and mottling
  for (let i = 0; i < (v.brood ? 22 : 14); i++) {
    const u = rnd() * 2 - 1;
    const ang = 0.4 + rnd() * 1.0;
    const sx = rnd() < 0.5 ? 1 : -1;
    const p: V3 = [abdC[0] + sx * Math.sin(ang) * abdR[0], abdC[1] + Math.cos(ang) * abdR[1], abdC[2] + u * abdR[2] * 0.8];
    s.sphere(p, (0.02 + rnd() * 0.025) * sc, { ...mark, k: 0.02 * sc, strength: 0.5 + rnd() * 0.4 });
  }
  if (v.brood) {
    // the pale skull-like mark at the front of the abdomen
    s.mirrored(() => s.ellipsoid([0.09 * sc, top - 0.03 * sc, -0.3 * sc], [0.07 * sc, 0.05 * sc, 0.08 * sc], { ...mark, k: 0.03 * sc }));
    s.ellipsoid([0, top - 0.02 * sc, -0.28 * sc], [0.16 * sc, 0.05 * sc, 0.12 * sc], { ...mark, k: 0.03 * sc, strength: 0.55 });
    s.mirrored(() => s.ellipsoid([0.06 * sc, top, -0.29 * sc], [0.035 * sc, 0.04 * sc, 0.035 * sc], { op: 'paint', bone: 'abdomen', color: 0x14100d, k: 0.012 * sc }));
    // old scars: pale gouges across carapace and abdomen
    const scars: [V3, V3, string][] = [
      [P(-0.16, 0.7, 0.24), P(0.05, 0.74, 0.0), 'body'],
      [P(0.2, 1.0, -0.4), P(0.3, 0.82, -0.75), 'abdomen'],
      [P(-0.12, 1.06, -0.62), P(-0.33, 0.86, -0.82), 'abdomen'],
      [P(0.02, 1.09, -0.7), P(0.17, 1.02, -0.95), 'abdomen'],
    ];
    for (const [a, b, bone] of scars) {
      s.cone(a, b, 0.008 * sc, 0.005 * sc, { op: 'subtract', k: 0.006 * sc, bone, paintCarve: true, color: 0x9a8a76, mat: surface('horn', { rough: 0.7 }) });
      s.cone(a, b, 0.018 * sc, 0.012 * sc, { op: 'paint', k: 0.012 * sc, bone, color: 0x6e6050, strength: 0.6 });
    }
  }
  // sternum + coxae ring under the body
  s.ellipsoid(P(0, 0.55, 0.1), P(0.165, 0.07, 0.2), { bone: 'body', mat: chitin, color: 0x241d18, k: 0.05 * sc });
  s.mirrored(() => {
    for (let i = 0; i < 4; i++) s.ellipsoid(P(0.13 + (i === 1 || i === 2 ? 0.015 : 0), 0.585, 0.2 - i * 0.085), P(0.045, 0.04, 0.04), { bone: 'body', mat: chitin, color: 0x2a221c, k: 0.025 * sc });
  });
}

function bristles(rig: RigDef, legs: Record<string, LegRest>, palp: { A: THREE.Vector3; B: THREE.Vector3; C: THREE.Vector3 }, v: VariantDef, seed: number): THREE.BufferGeometry {
  const sc = v.scale;
  const rnd = mulberry32(31 + seed);
  const roots: GrowRoot[] = [];
  const along = (a: THREE.Vector3, b: THREE.Vector3, bone: string, n: number, len: number, rad: number, width: number) => {
    const axis = b.clone().sub(a).normalize();
    const perp = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
    for (let k = 0; k < n; k++) {
      const t = (k + rnd()) / n;
      const p = a.clone().lerp(b, t);
      const ang = rnd() * Math.PI * 2;
      const dir = perp.clone().applyAxisAngle(axis, ang).multiplyScalar(0.55).addScaledVector(axis, 0.8).normalize();
      p.addScaledVector(dir, rad * (1 - t * 0.3));
      roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: len * (0.6 + rnd() * 0.7), width, bone: rig.boneIndex(bone) });
    }
  };
  for (const key of Object.keys(legs)) {
    const i = Number(key[0]);
    const side = key[1];
    const L = legs[key];
    along(L.A, L.B, `leg${i}a_${side}`, 42, 0.08 * sc, 0.045 * sc, 0.016 * sc);
    along(L.B, L.C, `leg${i}b_${side}`, 42, 0.075 * sc, 0.034 * sc, 0.015 * sc);
    along(L.C, L.D, `leg${i}c_${side}`, 14, 0.045 * sc, 0.02 * sc, 0.011 * sc);
  }
  for (const side of ['l', 'r']) {
    const m = side === 'l' ? 1 : -1;
    const A = palp.A.clone().setX(palp.A.x * m);
    const B = palp.B.clone().setX(palp.B.x * m);
    const C = palp.C.clone().setX(palp.C.x * m);
    along(A, B, `palpb_${side}`, 6, 0.05 * sc, 0.025 * sc, 0.01 * sc);
    along(B, C, `palpc_${side}`, 8, 0.05 * sc, 0.022 * sc, 0.01 * sc);
  }
  // abdomen: coarse hair lying backward
  const abdC = new THREE.Vector3(0, 0.8 * sc, -0.62 * sc);
  const ar = v.brood ? [0.4, 0.33, 0.54] : [0.37, 0.31, 0.5];
  const nAbd = v.brood ? 360 : 220;
  for (let k = 0; k < nAbd; k++) {
    const u = rnd() * Math.PI * 2;
    const vv = Math.acos(rnd() * 1.7 - 0.7);
    const n = new THREE.Vector3(Math.sin(vv) * Math.cos(u), Math.cos(vv), Math.sin(vv) * Math.sin(u));
    const p = abdC.clone().add(new THREE.Vector3(n.x * ar[0] * sc, n.y * ar[1] * sc, n.z * ar[2] * sc));
    const dir = n.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -0.15, -0.75)).normalize();
    roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: (0.04 + rnd() * 0.04) * sc, width: 0.012 * sc, bone: rig.boneIndex('abdomen') });
  }
  // carapace rim and chelicerae
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const p = new THREE.Vector3(Math.sin(a) * 0.2 * sc, 0.6 * sc, 0.13 * sc + Math.cos(a) * 0.24 * sc);
    const dir = new THREE.Vector3(Math.sin(a), 0.5, Math.cos(a)).normalize();
    roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: 0.035 * sc, width: 0.01 * sc, bone: rig.boneIndex('body') });
  }
  for (const side of ['l', 'r']) {
    const m = side === 'l' ? 1 : -1;
    for (let k = 0; k < 14; k++) {
      const t = rnd();
      const p = new THREE.Vector3(m * 0.05, 0.62 - t * 0.15, 0.36 + t * 0.11).multiplyScalar(sc);
      const dir = new THREE.Vector3(m * (0.4 + rnd() * 0.6), rnd() - 0.3, 0.6).normalize();
      p.addScaledVector(dir, 0.045 * sc);
      roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: 0.04 * sc, width: 0.01 * sc, bone: rig.boneIndex(`fang_${side}`) });
    }
  }
  const strands = growStrands(roots, { segments: 2, gravity: 1.5, jitter: 0.15, seed: 5 + seed, taper: 0.15 });
  return hairGeometry(strands, [], { color: 0x231b16, tipColor: v.hairTip, curl: 0, weights: (_p, _a, out) => out.push([0, 1]) });
}

function meshOpts(v: VariantDef): MeshOpts {
  const sc = v.scale;
  return {
    res: v.res * sc,
    regions: [{ min: [-0.17 * sc, 0.36 * sc, 0.22 * sc], max: [0.17 * sc, 0.82 * sc, 0.58 * sc], res: 0.009 * sc }],
    ao: { dist: 0.08 * sc },
  };
}

function sculptFor(variant: SpiderVariant, seed: number): { sculpt: Sculpt; opts: MeshOpts } {
  const v = VARIANTS[variant];
  const { rig } = spiderRig(v.scale);
  const s = new Sculpt(rig, { skinK: 0.03 * v.scale });
  sculptSpider(s, v, seed);
  return { sculpt: s, opts: meshOpts(v) };
}

/** mesh the spider sculpts in the worker pool (fills the kit cache: later builds are instant) */
export function preloadSpiders(list: [SpiderVariant, number][] = [['spider', 0], ['spider', 1], ['brood', 0]]): Promise<unknown> {
  return Promise.all(list.map(([v, seed]) => {
    const { sculpt, opts } = sculptFor(v, seed);
    return meshSculptAsync(sculpt, opts).catch(() => null);
  }));
}

// ── shared eye geometry/material ─────────────────────────────────────────────
const eyeGeoCache = new Map<string, THREE.BufferGeometry>();
const eyeMatCache = new Map<number, THREE.MeshPhysicalMaterial>();

function eyeGeometry(sc: number, center: THREE.Vector3): THREE.BufferGeometry {
  const key = `${sc}:${center.x},${center.y},${center.z}`;
  let g = eyeGeoCache.get(key);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  for (const m of [1, -1]) {
    for (const [x, y, z, r] of EYES) {
      const e = new THREE.SphereGeometry(r * sc, 12, 8);
      e.scale(1, 1, 0.85);
      // each eye looks out along its own direction from the head centre
      const dir = new THREE.Vector3(m * x * 1.6, (y - 0.7) * 2.2, 0.6).normalize();
      e.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
      e.translate(m * x * sc - center.x, y * sc - center.y, z * sc - center.z);
      parts.push(e);
    }
  }
  // merge
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, off * 3);
    nor.set(p.attributes.normal.array as Float32Array, off * 3);
    const pi = p.index!.array;
    for (let i = 0; i < pi.length; i++) idx.push(pi[i] + off);
    off += p.attributes.position.count;
    p.dispose();
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.userData.shared = true;
  eyeGeoCache.set(key, g);
  return g;
}

function eyeMaterial(glow: number): THREE.MeshPhysicalMaterial {
  let m = eyeMatCache.get(glow);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color: 0x030202, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    emissive: new THREE.Color(glow), emissiveIntensity: 0.55, specularIntensity: 1, ior: 1.6,
  });
  m.userData.shared = true;
  m.name = 'spider_eyes';
  eyeMatCache.set(glow, m);
  return m;
}

// ── pose parameters ──────────────────────────────────────────────────────────

export interface SpiderPose {
  /** gait phase (cycles); advance with `spiderGaitFreq(speed, variant) * dt` */
  phase: number;
  /** forward speed (m/s, model scale) driving the stride */
  speed: number;
  /** yaw rate (rad/s): feet step around when turning on the spot */
  turn: number;
  /** clock for idle motion (breathing, palps) */
  t: number;
  /** 0..1 rear-up threat: front legs raised, fangs spread */
  rear: number;
  /** 0..1 bite strike: body lunges down/forward, fangs close */
  strike: number;
  /** 0..1 crouch (pre-leap, spit wind-up) */
  crouch: number;
  /** 0..1 abdomen pump (web spit) */
  spit: number;
  /** 0..1 hanging on silk: legs drawn up, pedalling */
  hang: number;
  /** 0..1 airborne leap: legs flung out */
  air: number;
  /** 0..1 front-leg stabs (0..0.6 raise, 0.6..1 stab down) */
  stabL: number;
  stabR: number;
  /** trunk radius when climbing (0 = flat ground): outer feet wrap around the curve */
  wrapR: number;
  /** 0..1 stunned: flattened, legs splayed and twitching */
  stun: number;
  /** 0..1 flinch */
  hit: number;
  /** 0..1 death curl */
  curl: number;
  /** body roll into turns (radians) */
  lean: number;
}

export function makeSpiderPose(): SpiderPose {
  return { phase: 0, speed: 0, turn: 0, t: 0, rear: 0, strike: 0, crouch: 0, spit: 0, hang: 0, air: 0, stabL: 0, stabR: 0, wrapR: 0, stun: 0, hit: 0, curl: 0, lean: 0 };
}

export function spiderGaitFreq(speed: number, variant: SpiderVariant | number): number {
  const sc = typeof variant === 'number' ? variant : VARIANTS[variant].scale;
  return gaitFrequency(Math.abs(speed) * 0.7, sc * 0.8) * 1.2;
}

export interface SpiderModel {
  variant: SpiderVariant;
  scale: number;
  creature: Creature;
  object: THREE.Object3D;
  eyes: THREE.Mesh;
  animations: string[];
  /** body bone, abdomen bone, the eye-cluster helper (for hit zones / aim) */
  bones: Record<string, THREE.Bone>;
  /** model-space spinneret position (silk thread anchor) */
  spinneret: THREE.Vector3;
  /** model-space mouth position (web spit origin) */
  mouth: THREE.Vector3;
  apply(p: SpiderPose, dt?: number): void;
  pose(anim: string, t: number): void;
  setShadows(on: boolean): void;
  /** fine detail (bristle cards) on/off: off for distant spiders and spiderlings */
  setDetail(on: boolean): void;
  dispose(): void;
}

export const SPIDER_ANIMS = ['idle', 'walk', 'run', 'turn', 'attack', 'spit', 'climb', 'descend', 'leap', 'stab', 'summon', 'stunned', 'hit', 'death'];

/** Build a spider. 'spider' ≈ 2.6 m leg span, 'brood' ≈ 6 m. `seed` picks a variation (0..3). */
export function createSpiderModel(variant: SpiderVariant = 'spider', seed = 0): SpiderModel {
  const v = VARIANTS[variant];
  const scale = v.scale;
  const { rig, legs, palp } = spiderRig(scale);
  const c = buildCreature({
    key: `mirk_spider_${variant}`,
    seed,
    rig,
    sculpt: (s) => sculptSpider(s, v, seed),
    mesh: meshOpts(v),
    extra: (ctx) => {
      const hairy = surface('chitin', { rough: 0.66, pat: { chitin: 0.35, fur: 1.8 } });
      const band = surface('chitin', { rough: 0.6, pat: { chitin: 0.3, fur: 1.6 } });
      const spineMat = surface('horn', { rough: 0.35 });
      const up = [0, 1, 0];
      const R = mulberry32(77 + seed);
      for (const key of Object.keys(legs)) {
        const i = Number(key[0]);
        const side = key[1];
        const L = legs[key];
        const segs: [THREE.Vector3, THREE.Vector3, string, number, number, number][] = [
          [L.A, L.B, `leg${i}a_${side}`, 0.056, 0.042, 0.28],
          [L.B, L.C, `leg${i}b_${side}`, 0.042, 0.028, 0.3],
          [L.C, L.D, `leg${i}c_${side}`, 0.028, 0.009, 0.22],
        ];
        for (const [a0, b0, bone, r0, r1, bulb] of segs) {
          const len = a0.distanceTo(b0);
          ctx.gear(limbSegment(r0 * scale, r1 * scale, len, bulb), {
            bone,
            color: 0x1c1714,
            mat: hairy,
            matrix: segmentMatrix([a0.x, a0.y, a0.z], [b0.x, b0.y, b0.z], up),
            ao: 0.85,
          });
          // macrosetae: stiff dark spines along the underside
          const axis = b0.clone().sub(a0).normalize();
          const nSp = bone.endsWith(`c_${side}`) ? 2 : 5;
          for (let k = 0; k < nSp; k++) {
            const t = 0.2 + (k / nSp) * 0.7;
            const p = a0.clone().lerp(b0, t);
            const ang = (R() - 0.5) * 2.2 + Math.PI; // underside
            const perp = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
            const d = perp.clone().applyAxisAngle(axis, ang).addScaledVector(axis, 0.8).normalize();
            const sp = new THREE.ConeGeometry(0.005 * scale, 0.038 * scale, 4);
            sp.translate(0, 0.019 * scale, 0);
            const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
            m.setPosition(p.addScaledVector(d, r0 * scale * 0.6));
            ctx.gear(sp, { bone, color: 0x120e0b, mat: spineMat, matrix: m });
          }
        }
        // pale bands at the knee and ankle (the Mirkwood spiders' banded legs)
        for (const [P, bone, r] of [[L.B, `leg${i}b_${side}`, 0.046], [L.C, `leg${i}c_${side}`, 0.031]] as const) {
          ctx.gear(new THREE.SphereGeometry(r * scale, 9, 6), { bone, color: v.brood ? 0x5e5244 : 0x3c3026, mat: band, matrix: new THREE.Matrix4().makeTranslation(P.x, P.y, P.z) });
        }
        // a short claw tuft at the foot tip
        const tip = new THREE.ConeGeometry(0.01 * scale, 0.05 * scale, 5);
        tip.translate(0, -0.02 * scale, 0);
        ctx.gear(tip, { bone: `leg${i}c_${side}`, color: 0x0c0a08, mat: spineMat, matrix: new THREE.Matrix4().makeTranslation(L.D.x, L.D.y + 0.01 * scale, L.D.z) });
      }
      // pedipalps
      for (const side of ['l', 'r']) {
        const m = side === 'l' ? 1 : -1;
        const A = palp.A.clone().setX(palp.A.x * m);
        const B = palp.B.clone().setX(palp.B.x * m);
        const C2 = palp.C.clone().setX(palp.C.x * m);
        ctx.gear(limbSegment(0.026 * scale, 0.02 * scale, A.distanceTo(B), 0.3), { bone: `palpb_${side}`, color: 0x1e1814, mat: hairy, matrix: segmentMatrix([A.x, A.y, A.z], [B.x, B.y, B.z], up) });
        ctx.gear(limbSegment(0.02 * scale, 0.014 * scale, B.distanceTo(C2), 0.35), { bone: `palpc_${side}`, color: 0x1e1814, mat: hairy, matrix: segmentMatrix([B.x, B.y, B.z], [C2.x, C2.y, C2.z], up) });
        ctx.gear(new THREE.SphereGeometry(0.024 * scale, 8, 6), { bone: `palpc_${side}`, color: 0x3e3226, mat: band, matrix: new THREE.Matrix4().makeTranslation(B.x, B.y, B.z) });
      }
    },
    skinK: 0.03 * scale,
    material: { detailScale: 0.8 * scale, detailStrength: 1.3, clearcoat: 0.42, clearcoatRoughness: 0.3, wrap: 0.18 },
    hair: (r) => bristles(r, legs, palp, v, seed),
    hairMaterial: { roughness: 0.62, anisotropy: 0.4, sheen: 0.2, alphaTest: 0.35 },
  });
  if (c.hair) (c.hair.material as THREE.Material).userData.shared = true;
  c.body.castShadow = true;
  c.body.receiveShadow = true;
  if (c.hair) {
    c.hair.castShadow = false;
    c.hair.userData.noAO = true; // alpha-tested cards: skip the GTAO / DOF pre-passes
  }
  const byName = c.rig.byName;
  // eyes, rigidly on the cephalothorax bone
  const bodyRest = new THREE.Vector3(0, 0.62 * scale, 0.12 * scale);
  const eyes = new THREE.Mesh(eyeGeometry(scale, bodyRest), eyeMaterial(v.eyeGlow));
  eyes.name = 'spider_eyes';
  eyes.castShadow = false;
  byName.body.add(eyes);

  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  const samples: FootSample[] = [];
  const keys: string[] = [];
  for (let i = 0; i < LEGS; i++) keys.push(`${i}l`, `${i}r`);
  const legIdx = keys.map((k) => [I(`leg${k[0]}a_${k[1]}`), I(`leg${k[0]}b_${k[1]}`), I(`leg${k[0]}c_${k[1]}`)]);
  const legRest = keys.map((k) => legs[k]);
  const restTarsus = legRest.map((L) => L.D.clone().sub(L.C).normalize());
  const iBody = I('body');
  const iAbd = I('abdomen');
  const iFl = I('fang_l');
  const iFr = I('fang_r');
  const iPa = [I('palpa_l'), I('palpa_r')];
  const iPb = [I('palpb_l'), I('palpb_r')];
  const T = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const reach = 1.0 * scale;

  const apply = (p: SpiderPose, dt = 1 / 60) => {
    ps.reset();
    const t = p.t;
    const sc = scale;
    const breath = Math.sin(t * 2.2) * 0.008 * sc;
    const turnSpeed = Math.abs(p.turn) * 0.75 * sc;
    const gaitSpeed = Math.max(Math.abs(p.speed), turnSpeed);
    insectGait(p.phase, gaitSpeed, reach, 8, samples, 'tetrapod');
    // body: bob, rear, strike, crouch
    let bodyY = breath - 0.1 * p.crouch * sc - 0.16 * p.stun * sc + 0.13 * p.rear * sc - 0.05 * p.strike * sc + 0.1 * p.hang * sc;
    if (gaitSpeed > 0.05) {
      // two support tetrapods alternate: a small double bob per cycle
      bodyY += Math.abs(Math.sin(p.phase * Math.PI * 2)) * Math.min(0.012, gaitSpeed * 0.004) * sc;
    }
    bodyY -= 0.42 * p.curl * sc;
    if (p.wrapR > 0) bodyY -= 0.06 * sc;
    const stabAny = Math.max(p.stabL, p.stabR);
    const bodyPitch = -0.48 * p.rear + 0.42 * p.strike + 0.12 * p.crouch - 0.18 * p.spit - 0.2 * stabAny * (stabAny < 0.6 ? 1 : 0.4) + 0.08 * p.hit;
    const twitch = p.stun > 0 ? Math.sin(t * 31) * Math.sin(t * 7.3) * 0.03 * p.stun : 0;
    ps.offset[iBody].set(0, bodyY, -0.04 * p.hit * sc + 0.12 * p.strike * sc);
    ps.euler(iBody, bodyPitch + twitch, Math.sin(t * 0.7) * 0.03 * (1 - p.curl), p.lean + Math.sin(t * 0.9) * 0.015 * p.stun);
    const pump = p.spit > 0 ? Math.sin(t * 18) * 0.06 * p.spit : 0;
    ps.euler(iAbd, Math.sin(t * 2.2) * 0.04 - p.curl * 0.3 + 0.35 * p.spit + pump + 0.25 * p.hang - 0.1 * p.rear, Math.sin(t * 1.1) * 0.05, 0);
    const fang = Math.sin(t * 1.3) * 0.08 + 0.55 * p.rear - 0.7 * p.strike + 0.35 * p.spit + 0.3 * p.stun * Math.abs(Math.sin(t * 9));
    ps.euler(iFl, fang, 0, -0.12 * p.rear);
    ps.euler(iFr, fang, 0, 0.12 * p.rear);
    for (let k = 0; k < 2; k++) {
      const m = k === 0 ? 1 : -1;
      const pal = Math.sin(t * 3.1 + k * 1.7) * 0.15;
      ps.euler(iPa[k], -0.3 * p.rear + pal * 0.5 + 0.3 * p.strike, m * 0.1 * p.rear, 0);
      ps.euler(iPb[k], 0.4 * p.rear + pal + 0.6 * p.curl, 0, 0);
    }
    ps.fk();
    for (let li = 0; li < 8; li++) {
      const key = keys[li];
      const i = Number(key[0]);
      const left = key[1] === 'l';
      const L = legRest[li];
      const f = samples[li];
      const [ia, ib, ic] = legIdx[li];
      // travel direction of this foot: forward motion + rotation about the body centre
      dir.set(p.turn * L.D.z, 0, p.speed - p.turn * L.D.x);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
      dir.normalize();
      T.copy(L.D).addScaledVector(dir, f.along);
      T.y += f.lift;
      // stunned: legs splayed out, feet sliding a little
      if (p.stun > 0) {
        tmp.copy(L.D).addScaledVector(L.out, 0.18 * sc);
        tmp.y = 0.02 * sc + Math.max(0, Math.sin(t * (13 + li * 3.1) + li)) * 0.12 * sc;
        T.lerp(tmp, p.stun);
      }
      // rear-up raises the front legs (threat display)
      if (p.rear > 0 && i < 2) {
        tmp.copy(L.B).add(tmp2.set(0, 0.28 * sc, 0.3 * sc)).addScaledVector(L.out, 0.05 * sc);
        tmp.y += Math.sin(t * 6 + li) * 0.03 * sc;
        T.lerp(tmp, p.rear * (i === 0 ? 1 : 0.55));
      }
      // bite strike: front legs reach forward and down
      if (p.strike > 0 && i === 0) {
        tmp.copy(L.D).add(tmp2.set(0, 0.04 * sc, 0.35 * sc));
        T.lerp(tmp, p.strike);
      }
      // leg stabs (Brood Mother)
      const stab = i === 0 ? (left ? p.stabL : p.stabR) : 0;
      if (stab > 0) {
        const raised = tmp.copy(L.B).add(tmp2.set(0, 0.42 * sc, 0.22 * sc));
        if (stab < 0.6) T.lerp(raised, stab / 0.6);
        else {
          const hitP = tmp2.copy(L.A).addScaledVector(L.out, 0.25 * sc);
          hitP.z += 1.1 * sc;
          hitP.y = 0.0;
          T.copy(raised).lerp(hitP, (stab - 0.6) / 0.4);
        }
      }
      // hanging on silk: legs drawn in, slowly pedalling
      if (p.hang > 0) {
        tmp.copy(L.A).addScaledVector(L.out, 0.42 * LEN[i] * sc);
        tmp.y = L.A.y - (0.25 + 0.1 * Math.sin(t * 2.6 + li * 1.3)) * sc;
        tmp.z += (i < 2 ? 0.2 : -0.15) * sc + Math.sin(t * 3 + li) * 0.05 * sc;
        T.lerp(tmp, p.hang);
      }
      // airborne leap: front legs flung forward, back legs trailing
      if (p.air > 0) {
        tmp.copy(L.A).addScaledVector(L.out, 0.55 * LEN[i] * sc);
        tmp.y = L.A.y - 0.25 * sc;
        tmp.z += (i === 0 ? 0.7 : i === 1 ? 0.3 : i === 2 ? -0.3 : -0.7) * sc;
        T.lerp(tmp, p.air);
      }
      // death: every leg curls under the body
      if (p.curl > 0) T.lerp(tmp.set(L.A.x * 0.6, L.A.y - 0.05 * sc, L.A.z * 0.8 + (i < 2 ? 0.1 : -0.05) * sc), p.curl);
      // climbing: outer feet wrap around the trunk
      if (p.wrapR > 0) T.y -= Math.min(0.6 * sc, (T.x * T.x) / (2 * p.wrapR));
      // ankle sits above the foot by the rest tarsus offset
      const ankle = tmp.copy(T).add(L.C).sub(L.D);
      pole.copy(L.A).addScaledVector(UP, 0.8 * sc).addScaledVector(L.out, 0.3 * sc);
      solveTwoBone(ps, ia, ib, ic, ankle, pole, { restUp: DOWN, maxStretch: 1.1 });
      dir.copy(T).sub(ps.modelP[ic]);
      if (dir.lengthSq() > 1e-10) {
        dir.normalize();
        aimBone(ps, ic, dir, L.out, restTarsus[li], L.out);
      }
    }
    c.update(dt);
  };

  const P = makeSpiderPose();
  const pose = (anim: string, t: number) => {
    Object.assign(P, makeSpiderPose());
    P.t = t;
    switch (anim) {
      case 'walk': P.speed = 1.1 * scale; break;
      case 'run': P.speed = 3.6 * scale; break;
      case 'turn': P.turn = 1.6; break;
      case 'climb': P.speed = 1.0 * scale; P.wrapR = 1.6 * scale; break;
      case 'attack': {
        const at = (t % 1.6) / 1.6;
        P.rear = envelope(at, 0.35, 0.25) * (at < 0.5 ? 1 : 0);
        P.strike = at > 0.42 && at < 0.75 ? Math.sin(((at - 0.42) / 0.33) * Math.PI) : 0;
        break;
      }
      case 'spit': {
        const at = (t % 1.8) / 1.8;
        P.crouch = envelope(at, 0.3, 0.3) * 0.6;
        P.spit = at < 0.55 ? Math.min(1, at / 0.3) : Math.max(0, 1 - (at - 0.55) / 0.2);
        P.rear = at > 0.45 && at < 0.7 ? 0.3 : 0;
        break;
      }
      case 'descend': P.hang = 1; break;
      case 'leap': P.air = 1; break;
      case 'stab': {
        const at = (t % 1.4) / 1.4;
        P.rear = 0.4;
        P.stabL = at < 0.5 ? Math.min(1, at / 0.4) : Math.max(0, 1 - (at - 0.5) / 0.15);
        P.stabR = at >= 0.45 ? Math.min(1, (at - 0.45) / 0.4) : 0;
        break;
      }
      case 'summon': P.rear = 0.8 + Math.sin(t * 20) * 0.05; P.spit = 0.4; break;
      case 'stunned': P.stun = 1; break;
      case 'hit': { const ht = t % 1; P.hit = ht < 0.08 ? ht / 0.08 : Math.max(0, 1 - (ht - 0.08) / 0.35); break; }
      case 'death': P.curl = Math.min(1, t / 1.2); break;
      default: break;
    }
    const sp = Math.max(Math.abs(P.speed), Math.abs(P.turn) * 0.75 * scale);
    P.phase = t * spiderGaitFreq(sp, scale);
    apply(P);
  };

  return {
    variant,
    scale,
    creature: c,
    object: c.root,
    eyes,
    animations: SPIDER_ANIMS,
    bones: byName,
    spinneret: new THREE.Vector3(0, 0.72 * scale, -1.16 * scale),
    mouth: new THREE.Vector3(0, 0.45 * scale, 0.5 * scale),
    apply,
    pose,
    setShadows(on: boolean) {
      c.body.castShadow = on;
    },
    setDetail(on: boolean) {
      if (c.hair) c.hair.visible = on;
    },
    dispose() {
      eyes.removeFromParent();
      c.dispose();
    },
  };
}
