/**
 * Humanoid proportions → rest-pose joint positions (A-pose, arms 45° down) and the rig.
 * Canonical reference: a 1.85 m man; every length scales with height and the BodyBuild multipliers.
 */
import * as THREE from 'three';
import { RigDef } from '../kit/rig';
import type { V3 } from '../kit/sdf';
import type { BodyBuild, ResolvedKind } from './types';

export const A_POSE = (45 * Math.PI) / 180;

export interface HandFrame {
  /** long axis (wrist → knuckles) */
  L: THREE.Vector3;
  /** thumb side */
  T: THREE.Vector3;
  /** palm normal (out of the palm) */
  N: THREE.Vector3;
}

export interface Proportions {
  H: number;
  /** H / 1.85 */
  s: number;
  build: BodyBuild;
  headH: number;
  /** cranium centre (head frame origin) */
  headC: V3;
  upperArm: number;
  foreArm: number;
  palm: number;
  finger: number;
  thigh: number;
  shin: number;
  ankleH: number;
  footLen: number;
  hipX: number;
  shoulderX: number;
  /** model-space rest joint positions by bone name */
  j: Record<string, V3>;
  hand: { l: HandFrame; r: HandFrame };
  /** head-frame point: (x right→left +, y up, z forward) in units of headH → model */
  h(x: number, y: number, z: number): V3;
  /** point in a hand frame: wrist + L·a + T·b + N·c (metres) */
  hp(side: 'l' | 'r', a: number, b: number, c: number): V3;
  eyeR: number;
  eye(side: 'l' | 'r'): V3;
  has: { hair: boolean; skirt: boolean; cloak: boolean; beard: boolean; quiver: boolean };
}

export interface ProportionOpts {
  hairChain?: boolean;
  skirt?: boolean;
  cloak?: boolean;
  beard?: boolean;
  quiver?: boolean;
}

export function computeProportions(def: ResolvedKind, height: number, bulkMul: number, o: ProportionOpts): Proportions {
  const b: BodyBuild = { ...def.build, bulk: def.build.bulk * bulkMul };
  const H = height;
  const s = H / 1.85;
  const headH = 0.232 * s * b.headSize;
  const ll = b.legLength;
  const al = b.armLength;

  const crown = H;
  const headJointY = H - headH * 0.93;
  const headC: V3 = [0, H - 0.43 * headH, 0.005 * s];
  const neckBaseY = headJointY - 0.1 * s * b.neck;
  const hipJY = 0.512 * H * ll * Math.min(1.08, 1 / Math.max(0.75, b.headSize * 0.12 + 0.88));
  const shoulderY = neckBaseY - 0.055 * s;
  const chestY = shoulderY - 0.19 * s;
  const spineY = hipJY + 0.13 * s * ll;
  const hipsY = hipJY + 0.045 * s;
  const hipX = 0.088 * s * b.hips;
  const shoulderX = 0.178 * s * b.shoulders;
  const upperArm = 0.3 * s * al;
  const foreArm = 0.262 * s * al;
  const palm = 0.092 * s * b.handSize;
  const finger = 0.088 * s * b.handSize;
  const ankleH = 0.082 * s * b.footSize;
  const kneeY = ankleH + (hipJY - ankleH) * 0.5;
  const footLen = 0.27 * s * b.footSize;

  const j: Record<string, V3> = {};
  j.root = [0, 0, 0];
  j.hips = [0, hipsY, 0];
  j.spine = [0, spineY, -0.005 * s];
  j.chest = [0, chestY, -0.01 * s];
  j.neck = [0, neckBaseY, -0.018 * s];
  j.head = [0, headJointY, -0.012 * s];
  j.jaw = [0, headC[1] - 0.24 * headH, headC[2] + 0.01 * s];
  const hand: Proportions['hand'] = { l: { L: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3() }, r: { L: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3() } };
  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? 1 : -1;
    const L = new THREE.Vector3(sx * Math.sin(A_POSE), -Math.cos(A_POSE), 0);
    const T = new THREE.Vector3(0, 0, 1);
    // palm faces the body (medial) and down: N = L × T for the left hand, T × L mirrored for the right
    const N = side === 'l' ? new THREE.Vector3().crossVectors(L, T) : new THREE.Vector3().crossVectors(T, L);
    hand[side] = { L, T, N };
    const sh: V3 = [sx * shoulderX, shoulderY, -0.012 * s];
    j[`shoulder_${side}`] = [sx * 0.025 * s, neckBaseY - 0.03 * s, 0.012 * s];
    j[`upperarm_${side}`] = sh;
    const el: V3 = [sh[0] + L.x * upperArm, sh[1] + L.y * upperArm, sh[2]];
    j[`forearm_${side}`] = el;
    const wr: V3 = [el[0] + L.x * foreArm, el[1] + L.y * foreArm, el[2]];
    j[`hand_${side}`] = wr;
    const add = (p: V3, a: number, bb: number, c: number): V3 => [p[0] + L.x * a + T.x * bb + N.x * c, p[1] + L.y * a + T.y * bb + N.y * c, p[2] + L.z * a + T.z * bb + N.z * c];
    j[`thumb1_${side}`] = add(wr, 0.022 * s * b.handSize, 0.022 * s * b.handSize, 0.012 * s);
    j[`thumb2_${side}`] = add(wr, 0.045 * s * b.handSize, 0.045 * s * b.handSize, 0.016 * s);
    j[`fing1_${side}`] = add(wr, palm, 0, 0.002 * s);
    j[`fing2_${side}`] = add(wr, palm + finger * 0.48, 0, 0.002 * s);
    const hx = sx * hipX;
    j[`thigh_${side}`] = [hx, hipJY, 0.0];
    j[`shin_${side}`] = [hx * 1.06, kneeY, 0.012 * s];
    j[`foot_${side}`] = [hx * 1.1, ankleH, -0.02 * s];
    j[`toe_${side}`] = [hx * 1.12, 0.024 * s, -0.02 * s + footLen * 0.68];
  }
  // spring chains
  if (o.hairChain) {
    j.hair1 = [0, headC[1] - 0.12 * headH, headC[2] - 0.42 * headH];
    j.hair2 = [0, neckBaseY - 0.03 * s, -0.12 * s * b.chest];
    j.hair3 = [0, shoulderY - 0.17 * s, -0.15 * s * b.chest];
  }
  if (o.skirt) {
    j.skirt_f = [0, hipJY + 0.02 * s, 0.11 * s * b.hips];
    j.skirt_b = [0, hipJY + 0.02 * s, -0.12 * s * b.hips];
  }
  if (o.cloak) {
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      j[`cloak1_${side}`] = [sx * 0.11 * s * b.shoulders, shoulderY + 0.01 * s, -0.13 * s * b.chest];
      j[`cloak2_${side}`] = [sx * 0.14 * s * b.shoulders, shoulderY - 0.42 * s, -0.17 * s * b.chest];
      j[`cloak3_${side}`] = [sx * 0.17 * s * b.shoulders, shoulderY - 0.84 * s, -0.2 * s * b.chest];
    }
  }
  if (o.beard) {
    j.beard1 = [0, headC[1] - 0.6 * headH, headC[2] + 0.3 * headH];
    j.beard2 = [0, headC[1] - 0.6 * headH - 0.12 * s, headC[2] + 0.36 * headH];
  }
  if (o.quiver) j.quiver = [-0.02 * s, chestY + 0.02 * s, -0.16 * s * b.chest];

  const P: Proportions = {
    H,
    s,
    build: b,
    headH,
    headC,
    upperArm,
    foreArm,
    palm,
    finger,
    thigh: hipJY - kneeY,
    shin: kneeY - ankleH,
    ankleH,
    footLen,
    hipX,
    shoulderX,
    j,
    hand,
    h: (x, y, z) => [headC[0] + x * headH, headC[1] + y * headH, headC[2] + z * headH],
    hp: (side, a, bb, c) => {
      const f = hand[side];
      const w = j[`hand_${side}`];
      return [w[0] + f.L.x * a + f.T.x * bb + f.N.x * c, w[1] + f.L.y * a + f.T.y * bb + f.N.y * c, w[2] + f.L.z * a + f.T.z * bb + f.N.z * c];
    },
    eyeR: 0.0118 * s * Math.sqrt(b.headSize),
    eye: (side) => [headC[0] + (side === 'l' ? 1 : -1) * 0.135 * headH, headC[1] - 0.075 * headH, headC[2] + 0.29 * headH],
    has: { hair: !!o.hairChain, skirt: !!o.skirt, cloak: !!o.cloak, beard: !!o.beard, quiver: !!o.quiver },
  };
  void crown;
  return P;
}

/** Build the humanoid rig: the contract's HumanoidBone set + jaw, fingers, toes and spring chains. */
export function buildRig(P: Proportions): RigDef {
  const j = P.j;
  const r = new RigDef();
  r.bone('root', null, j.root);
  r.bone('hips', 'root', j.hips);
  r.bone('spine', 'hips', j.spine);
  r.bone('chest', 'spine', j.chest);
  r.bone('neck', 'chest', j.neck);
  r.bone('head', 'neck', j.head);
  r.bone('jaw', 'head', j.jaw);
  for (const sd of ['l', 'r'] as const) {
    r.bone(`shoulder_${sd}`, 'chest', j[`shoulder_${sd}`]);
    r.bone(`upperarm_${sd}`, `shoulder_${sd}`, j[`upperarm_${sd}`]);
    r.bone(`forearm_${sd}`, `upperarm_${sd}`, j[`forearm_${sd}`]);
    r.bone(`hand_${sd}`, `forearm_${sd}`, j[`hand_${sd}`]);
    r.bone(`thumb1_${sd}`, `hand_${sd}`, j[`thumb1_${sd}`]);
    r.bone(`thumb2_${sd}`, `thumb1_${sd}`, j[`thumb2_${sd}`]);
    r.bone(`fing1_${sd}`, `hand_${sd}`, j[`fing1_${sd}`]);
    r.bone(`fing2_${sd}`, `fing1_${sd}`, j[`fing2_${sd}`]);
  }
  for (const sd of ['l', 'r'] as const) {
    r.bone(`thigh_${sd}`, 'hips', j[`thigh_${sd}`]);
    r.bone(`shin_${sd}`, `thigh_${sd}`, j[`shin_${sd}`]);
    r.bone(`foot_${sd}`, `shin_${sd}`, j[`foot_${sd}`]);
    r.bone(`toe_${sd}`, `foot_${sd}`, j[`toe_${sd}`]);
  }
  if (P.has.hair) {
    r.bone('hair1', 'head', j.hair1);
    r.bone('hair2', 'hair1', j.hair2);
    r.bone('hair3', 'hair2', j.hair3);
  }
  if (P.has.skirt) {
    r.bone('skirt_f', 'hips', j.skirt_f);
    r.bone('skirt_b', 'hips', j.skirt_b);
  }
  if (P.has.cloak) {
    for (const sd of ['l', 'r'] as const) {
      r.bone(`cloak1_${sd}`, 'chest', j[`cloak1_${sd}`]);
      r.bone(`cloak2_${sd}`, `cloak1_${sd}`, j[`cloak2_${sd}`]);
      r.bone(`cloak3_${sd}`, `cloak2_${sd}`, j[`cloak3_${sd}`]);
    }
  }
  if (P.has.beard) {
    r.bone('beard1', 'jaw', j.beard1);
    r.bone('beard2', 'beard1', j.beard2);
  }
  if (P.has.quiver) r.bone('quiver', 'chest', j.quiver);
  return r;
}
