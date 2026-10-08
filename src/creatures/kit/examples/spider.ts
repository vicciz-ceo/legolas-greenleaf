/**
 * Kit example — giant Mirkwood spider (~2.5 m leg span). Copy this file to build your own.
 *
 *  - rig: cephalothorax, abdomen, fangs, 8 legs × (femur, tibia, tarsus)
 *  - sculpt: chitin plates + bristly legs, glossy eyes, painted abdomen chevrons, bump noise
 *  - hair: short stiff bristles on the legs and abdomen (strand cards)
 *  - animation: alternating-tetrapod gait (insectGait) with 2-bone IK per leg + tarsus aim,
 *    breathing, rear-up attack, curled death. pose(anim, t) is deterministic.
 */
import * as THREE from 'three';
import { RigDef } from '../rig';
import type { Sculpt, V3 } from '../sdf';
import { buildCreature, type Creature } from '../creature';
import { solveTwoBone, aimBone, insectGait, envelope, type FootSample } from '../anim';
import { growStrands, hairGeometry, type GrowRoot } from '../hair';
import { surface } from '../surfaces';
import { segmentMatrix, limbSegment } from '../geometry';
import { mulberry32 } from '../../../core/rng';

const LEGS = 4; // pairs
const YAW = [0.55, 1.25, 1.95, 2.55]; // leg direction from +Z (radians), left side
const LEN = [1.12, 1.0, 0.95, 1.08]; // leg length multipliers

interface LegRest {
  A: THREE.Vector3; // femur base
  B: THREE.Vector3; // knee
  C: THREE.Vector3; // ankle
  D: THREE.Vector3; // foot tip
  out: THREE.Vector3; // outward direction (xz)
}

export function spiderRig(scale = 1) {
  const s = scale;
  const rig = new RigDef();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [0, 0.62 * s, 0.12 * s]);
  rig.bone('abdomen', 'body', [0, 0.66 * s, -0.16 * s]);
  rig.pair('fang_l', 'body', [0.05 * s, 0.6 * s, 0.38 * s]);
  const legs: Record<string, LegRest> = {};
  for (let i = 0; i < LEGS; i++) {
    for (const sx of [1, -1]) {
      const side = sx > 0 ? 'l' : 'r';
      const L = LEN[i] * s;
      const out = new THREE.Vector3(sx * Math.sin(YAW[i]), 0, Math.cos(YAW[i]));
      const A = new THREE.Vector3(sx * 0.13 * s, 0.6 * s, (0.2 - i * 0.085) * s).addScaledVector(out, 0.04 * s);
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
  return { rig, legs };
}

function sculptSpider(s: Sculpt, legs: Record<string, LegRest>, sc: number) {
  const chitin = surface('chitin', { rough: 0.32 });
  const hairy = surface('chitin', { rough: 0.6, pat: { chitin: 0.5, fur: 1.2 } });
  const dark = 0x1f1a17;
  // cephalothorax + head
  s.with({ bone: 'body', mat: chitin, color: dark, color2: 0x3a2e24, colorNoise: 0.35, colorFreq: 9 / sc }, () => {
    s.ellipsoid([0, 0.62 * sc, 0.13 * sc], [0.2 * sc, 0.12 * sc, 0.25 * sc], { k: 0.02 * sc, noise: { amp: 0.006 * sc, freq: 14 / sc, type: 'cells' } });
    s.ellipsoid([0, 0.665 * sc, 0.31 * sc], [0.125 * sc, 0.1 * sc, 0.11 * sc], { k: 0.06 * sc });
    // radial grooves on the carapace
    for (let a = -2; a <= 2; a++) s.cone([0, 0.745 * sc, 0.14 * sc], [Math.sin(a * 0.6) * 0.19 * sc, 0.68 * sc, 0.13 * sc + Math.cos(a * 0.6) * 0.16 * sc], 0.012 * sc, 0.006 * sc, { op: 'subtract', k: 0.01 * sc });
  });
  // eyes: 2 big + 6 small, glossy black
  s.with({ bone: 'body', mat: surface('eye', { rough: 0.05 }), color: 0x050505 }, () => {
    s.mirrored(() => {
      s.sphere([0.034 * sc, 0.71 * sc, 0.405 * sc], 0.026 * sc, { k: 0.004 * sc });
      s.sphere([0.075 * sc, 0.715 * sc, 0.38 * sc], 0.017 * sc, { k: 0.004 * sc });
      s.sphere([0.03 * sc, 0.745 * sc, 0.385 * sc], 0.014 * sc, { k: 0.004 * sc });
      s.sphere([0.09 * sc, 0.69 * sc, 0.36 * sc], 0.012 * sc, { k: 0.004 * sc });
    });
  });
  // chelicerae and fangs
  s.mirrored(() => {
    s.cone([0.05 * sc, 0.6 * sc, 0.36 * sc], [0.045 * sc, 0.47 * sc, 0.47 * sc], 0.05 * sc, 0.035 * sc, { bone: 'fang_l', mat: hairy, color: 0x2a221c, k: 0.03 * sc });
    s.cone([0.045 * sc, 0.47 * sc, 0.47 * sc], [0.012 * sc, 0.39 * sc, 0.5 * sc], 0.016 * sc, 0.003 * sc, { bone: 'fang_l', mat: 'horn', color: 0x3a1410, k: 0.008 * sc });
  });
  // pedicel + abdomen with chevron markings
  s.cone([0, 0.62 * sc, -0.08 * sc], [0, 0.68 * sc, -0.22 * sc], 0.06 * sc, 0.08 * sc, { bone: 'abdomen', mat: chitin, color: dark, k: 0.04 * sc });
  s.with({ bone: 'abdomen', mat: surface('chitin', { rough: 0.45, pat: { chitin: 0.6, fur: 0.8 } }), color: 0x2a221d, color2: 0x4a3a2c, colorNoise: 0.45, colorFreq: 6 / sc }, () => {
    s.ellipsoid([0, 0.78 * sc, -0.58 * sc], [0.34 * sc, 0.29 * sc, 0.45 * sc], { k: 0.06 * sc, noise: { amp: 0.008 * sc, freq: 9 / sc, type: 'fbm' } });
    s.ellipsoid([0, 0.72 * sc, -0.97 * sc], [0.07 * sc, 0.06 * sc, 0.06 * sc], { k: 0.05 * sc }); // spinnerets
  });
  for (let i = 0; i < 4; i++) {
    const z = (-0.36 - i * 0.14) * sc;
    const w = (0.12 - i * 0.02) * sc;
    s.mirrored(() => s.cone([0.01 * sc, 1.08 * sc, z], [w, 1.02 * sc, z - 0.08 * sc], 0.03 * sc, 0.02 * sc, { op: 'paint', bone: 'abdomen', color: 0x8a7656, k: 0.03 * sc, strength: 0.9 }));
  }
  // coxae ring under the body
  s.ellipsoid([0, 0.55 * sc, 0.1 * sc], [0.16 * sc, 0.07 * sc, 0.2 * sc], { bone: 'body', mat: chitin, color: 0x2a221d, k: 0.05 * sc });
}

function bristles(rig: RigDef, legs: Record<string, LegRest>, sc: number): THREE.BufferGeometry {
  const rnd = mulberry32(31);
  const roots: GrowRoot[] = [];
  for (const key of Object.keys(legs)) {
    const i = Number(key[0]);
    const side = key[1];
    const L = legs[key];
    const segs: [THREE.Vector3, THREE.Vector3, string][] = [
      [L.A, L.B, `leg${i}a_${side}`],
      [L.B, L.C, `leg${i}b_${side}`],
    ];
    for (const [a, b, bone] of segs) {
      for (let k = 0; k < 9; k++) {
        const t = (k + 0.5) / 9;
        const p = a.clone().lerp(b, t);
        const ang = rnd() * Math.PI * 2;
        const axis = b.clone().sub(a).normalize();
        const perp = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
        const dir = perp.clone().applyAxisAngle(axis, ang).multiplyScalar(0.7).addScaledVector(axis, 0.6).normalize();
        p.addScaledVector(dir, 0.025 * sc);
        roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: 0.05 * sc * (0.7 + rnd() * 0.6), width: 0.012 * sc, bone: rig.boneIndex(bone) });
      }
    }
  }
  for (let k = 0; k < 70; k++) {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 1.6 - 0.6);
    const n = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
    const p = new THREE.Vector3(0, 0.78 * sc, -0.58 * sc).add(new THREE.Vector3(n.x * 0.34 * sc, n.y * 0.29 * sc, n.z * 0.45 * sc));
    const dir = n.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0, -0.5)).normalize();
    roots.push({ p: [p.x, p.y, p.z], dir: [dir.x, dir.y, dir.z], length: 0.06 * sc, width: 0.016 * sc, bone: rig.boneIndex('abdomen') });
  }
  const strands = growStrands(roots, { segments: 2, gravity: 1, jitter: 0.1, seed: 5, taper: 0.2 });
  return hairGeometry(strands, [], { color: 0x2a221c, tipColor: 0x6a5a48, curl: 0, weights: (_p, _a, out) => out.push([0, 1]) });
}

export interface SpiderDemo {
  creature: Creature;
  object: THREE.Object3D;
  animations: string[];
  pose(anim: string, t: number): void;
}

/** Build a spider. scale 1 ≈ 2.5 m leg span (brood mother: scale 2.4). */
export function createSpider(seed = 0, scale = 1): SpiderDemo {
  const { rig, legs } = spiderRig(scale);
  const c = buildCreature({
    key: `kit_spider_${scale}`,
    seed,
    rig,
    sculpt: (s) => sculptSpider(s, legs, scale),
    mesh: { res: 0.028 * scale, regions: [{ min: [-0.16 * scale, 0.36 * scale, 0.22 * scale], max: [0.16 * scale, 0.8 * scale, 0.56 * scale], res: 0.01 * scale }], ao: { dist: 0.08 * scale } },
    // legs: rigid tapered segments (crisp articulated joints, far cheaper than meshing thin SDF tubes)
    extra: (ctx) => {
      const hairy = surface('chitin', { rough: 0.55, pat: { chitin: 0.5, fur: 1.4 } });
      for (const key of Object.keys(legs)) {
        const i = Number(key[0]);
        const side = key[1];
        const L = legs[key];
        const up = [0, 1, 0];
        const segs: [THREE.Vector3, THREE.Vector3, string, number, number, number][] = [
          [L.A, L.B, `leg${i}a_${side}`, 0.048, 0.036, 0.25],
          [L.B, L.C, `leg${i}b_${side}`, 0.036, 0.024, 0.3],
          [L.C, L.D, `leg${i}c_${side}`, 0.024, 0.008, 0.25],
        ];
        for (const [a0, b0, bone, r0, r1, bulb] of segs) {
          const len = a0.distanceTo(b0);
          ctx.gear(limbSegment(r0 * scale, r1 * scale, len, bulb), {
            bone,
            color: 0x1e1916,
            mat: hairy,
            matrix: segmentMatrix([a0.x, a0.y, a0.z], [b0.x, b0.y, b0.z], up),
            ao: 0.85,
          });
        }
        // pale bands at the knee and ankle
        for (const [P, bone] of [[L.B, `leg${i}b_${side}`], [L.C, `leg${i}c_${side}`]] as const) {
          ctx.gear(new THREE.SphereGeometry(0.043 * scale, 7, 5), { bone, color: 0x4a3c2e, mat: hairy, matrix: new THREE.Matrix4().makeTranslation(P.x, P.y, P.z) });
        }
      }
    },
    skinK: 0.03 * scale,
    material: { detailScale: 0.8 * scale, clearcoat: 0.35, clearcoatRoughness: 0.35, wrap: 0.2 },
    hair: (r) => bristles(r, legs, scale),
    hairMaterial: { roughness: 0.6, anisotropy: 0.4, sheen: 0.2, alphaTest: 0.35 },
  });
  const ps = c.pose;
  const I = (n: string) => ps.i(n);
  const samples: FootSample[] = [];
  const keys: string[] = [];
  for (let i = 0; i < LEGS; i++) keys.push(`${i}l`, `${i}r`);
  const T = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const UP = new THREE.Vector3(0, 1, 0);

  const pose = (anim: string, t: number) => {
    const speed = anim === 'walk' ? 0.9 * scale : anim === 'run' ? 3.2 * scale : 0;
    ps.reset();
    const body = I('body');
    // breathing / body bob
    const breath = Math.sin(t * 2.2) * 0.008 * scale;
    let bodyPitch = 0;
    let bodyY = breath;
    let fang = Math.sin(t * 1.3) * 0.08;
    let curl = 0;
    let rear = 0;
    if (anim === 'attack') {
      const at = (t % 1.6) / 1.6;
      rear = envelope(at, 0.35, 0.3);
      const strike = at > 0.45 && at < 0.65 ? Math.sin(((at - 0.45) / 0.2) * Math.PI) : 0;
      bodyPitch = -0.45 * rear + 0.5 * strike;
      bodyY += 0.12 * rear * scale;
      fang = 0.5 * rear - 0.6 * strike;
    }
    if (anim === 'death') {
      curl = Math.min(1, t / 1.2);
      bodyY -= 0.42 * curl * scale;
    }
    insectGait(t * (speed > 0 ? 1 : 0) * (0.9 + speed / scale * 0.35), speed, 1.0 * scale, 8, samples, 'tetrapod');
    if (speed > 0) bodyY += Math.abs(Math.sin(t * 9)) * 0.01 * scale;
    ps.offset[body].set(0, bodyY, 0);
    ps.euler(body, bodyPitch, Math.sin(t * 0.7) * 0.03, 0);
    ps.euler(I('abdomen'), Math.sin(t * 2.2) * 0.04 - curl * 0.3, Math.sin(t * 1.1) * 0.05, 0);
    ps.euler(I('fang_l'), fang, 0, 0);
    ps.euler(I('fang_r'), fang, 0, 0);
    ps.fk();
    keys.forEach((key, li) => {
      const i = Number(key[0]);
      const side = key[1];
      const L = legs[key];
      const f = samples[li];
      // foot target in model space: rest tip + travel along +Z + lift
      T.copy(L.D);
      T.z += f.along;
      T.y += f.lift;
      // rear-up raises the front legs; death curls every leg under the body
      if (i < 2 && rear > 0) T.lerp(tmp.copy(L.B).add(new THREE.Vector3(0, 0.25 * scale, 0.25 * scale)), rear * (i === 0 ? 1 : 0.5));
      if (curl > 0) T.lerp(tmp.set(L.A.x * 0.6, L.A.y - 0.3 * scale + 0.25 * scale, L.A.z * 0.8), curl);
      // ankle sits above the foot by the rest tarsus offset
      const ankle = tmp.copy(T).add(L.C).sub(L.D);
      pole.copy(L.A).addScaledVector(UP, 0.8 * scale).addScaledVector(L.out, 0.3 * scale);
      solveTwoBone(ps, I(`leg${i}a_${side}`), I(`leg${i}b_${side}`), I(`leg${i}c_${side}`), ankle, pole, {
        restUp: DOWN,
        maxStretch: 1.08,
      });
      // tarsus points at the foot target
      const ci = I(`leg${i}c_${side}`);
      dir.copy(T).sub(ps.modelP[ci]).normalize();
      aimBone(ps, ci, dir, L.out, L.D.clone().sub(L.C).normalize(), L.out);
    });
    c.update(1 / 60);
  };
  return { creature: c, object: c.root, animations: ['idle', 'walk', 'run', 'attack', 'death'], pose };
}
