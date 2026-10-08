/**
 * Humanoid anatomy as reusable SDF "parts". Clothing re-emits the same parts inflated, so
 * garments follow the body exactly and get the same skin weights.
 */
import * as THREE from 'three';
import type { PrimOpts, Sculpt, V3 } from '../kit/sdf';
import type { Proportions } from './proportions';

export type PartTag =
  | 'pelvis' | 'waist' | 'ribs' | 'chest' | 'pecs' | 'back' | 'trap' | 'neck' | 'glutes' | 'belly'
  | 'deltoid' | 'upperarm' | 'forearm' | 'hand' | 'fingers' | 'thumb'
  | 'thigh' | 'knee' | 'shin' | 'calf' | 'foot' | 'toes';

export type Part =
  | { tag: PartTag; side?: 'l' | 'r'; t: 'cone'; a: V3; b: V3; ra: number; rb: number; o: PrimOpts }
  | { tag: PartTag; side?: 'l' | 'r'; t: 'ell'; c: V3; r: V3; o: PrimOpts }
  | { tag: PartTag; side?: 'l' | 'r'; t: 'box'; c: V3; half: V3; round: number; o: PrimOpts };

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

/** quaternion whose local X→T, Y→L (Z = X×Y) for oriented hand/foot boxes */
function basisQuat(T: THREE.Vector3, L: THREE.Vector3): THREE.Quaternion {
  const x = T.clone().normalize();
  const y = L.clone().addScaledVector(x, -L.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Build the anatomy part list for the LEFT side + centre (right side via mirroring). */
export function anatomyParts(P: Proportions): Part[] {
  const b = P.build;
  const s = P.s;
  const g = b.bulk;
  const gm = Math.sqrt(g);
  const j = P.j;
  const parts: Part[] = [];
  const sh = b.shoulders;
  const ch = b.chest;
  const hips = b.hips;
  const mus = b.muscle;

  // ── torso ──
  const hipY = j.thigh_l[1];
  const chestY = j.chest[1];
  const shY = j.upperarm_l[1];
  const neckY = j.neck[1];
  parts.push({ tag: 'pelvis', t: 'ell', c: [0, hipY + 0.035 * s, -0.008 * s], r: [0.148 * s * hips * gm, 0.105 * s, 0.1 * s * gm], o: { bone: 'hips', k: 0.05 * s } });
  parts.push({ tag: 'glutes', side: 'l', t: 'ell', c: [0.062 * s * hips, hipY - 0.0 * s, -0.055 * s * gm], r: [0.075 * s * gm, 0.085 * s, 0.065 * s * gm], o: { bone: 'hips', k: 0.05 * s } });
  const bel = b.belly;
  parts.push({ tag: 'waist', t: 'ell', c: [0, (hipY + chestY) / 2 + 0.01 * s, 0.01 * s * bel], r: [0.128 * s * g * (0.9 + 0.1 * hips) * (1 + 0.15 * bel), 0.13 * s * (1 + 0.15 * bel), 0.092 * s * g * (1 + 0.25 * bel)], o: { bone: 'spine', k: 0.07 * s, bone2: 'chest', blend: [0.55, 1.0] } });
  // belly: a broad forward swell that blends into the waist and ribs (no separate ball)
  if (bel > 0) parts.push({ tag: 'belly', t: 'ell', c: [0, (hipY + chestY) / 2 - 0.01 * s, 0.025 * s * g * bel], r: [0.14 * s * g * (1 + 0.1 * bel), 0.17 * s * (1 + 0.2 * bel), 0.095 * s * g * (1 + 0.45 * bel)], o: { bone: 'spine', k: 0.14 * s } });
  parts.push({ tag: 'ribs', t: 'ell', c: [0, chestY + 0.075 * s, 0.004 * s], r: [0.142 * s * sh * g, 0.165 * s, 0.103 * s * ch * g], o: { bone: 'chest', k: 0.07 * s } });
  parts.push({ tag: 'chest', t: 'ell', c: [0, shY - 0.055 * s, 0.006 * s], r: [0.158 * s * sh * g, 0.085 * s, 0.092 * s * ch * g], o: { bone: 'chest', k: 0.06 * s } });
  parts.push({ tag: 'pecs', side: 'l', t: 'ell', c: [0.062 * s * sh, shY - 0.088 * s, 0.062 * s * ch * g], r: [0.068 * s * sh * g, 0.048 * s, 0.032 * s * (0.6 + mus)], o: { bone: 'chest', k: 0.04 * s } });
  parts.push({ tag: 'back', side: 'l', t: 'ell', c: [0.065 * s * sh, shY - 0.075 * s, -0.052 * s * ch * g], r: [0.07 * s * sh * g, 0.095 * s, 0.045 * s * g], o: { bone: 'chest', k: 0.05 * s } });
  parts.push({ tag: 'trap', side: 'l', t: 'cone', a: [0.035 * s, neckY + 0.015 * s, -0.025 * s], b: [0.14 * s * sh, shY + 0.022 * s, -0.018 * s], ra: 0.045 * s * gm * b.neckThick, rb: 0.034 * s * gm, o: { bone: 'chest', k: 0.05 * s, bone2: 'shoulder_l', blend: [0.5, 1] } });
  parts.push({ tag: 'neck', t: 'cone', a: [0, neckY - 0.03 * s, -0.018 * s], b: [0, j.head[1] + 0.035 * s, -0.004 * s], ra: 0.058 * s * b.neckThick * gm, rb: 0.049 * s * b.neckThick * gm, o: { bone: 'neck', bone2: 'head', blend: [0.6, 1.0], k: 0.05 * s } });

  // ── arm (left; mirrored) ──
  const fl = P.hand.l;
  const shJ = j.upperarm_l;
  const el = j.forearm_l;
  const wr = j.hand_l;
  parts.push({ tag: 'deltoid', side: 'l', t: 'ell', c: add(shJ, v3(fl.L), 0.035 * s), r: [0.056 * s * g, 0.064 * s, 0.056 * s * g], o: { bone: 'upperarm_l', k: 0.04 * s, rot: [0, 0, 0.6], skinK: 0.05 * s } });
  parts.push({ tag: 'upperarm', side: 'l', t: 'cone', a: add(shJ, v3(fl.L), 0.04 * s), b: el, ra: 0.046 * s * g, rb: 0.036 * s * g, o: { bone: 'upperarm_l', k: 0.035 * s } });
  // biceps / triceps bulk
  parts.push({ tag: 'upperarm', side: 'l', t: 'ell', c: add(add(shJ, v3(fl.L), P.upperArm * 0.55), v3(fl.T), 0.012 * s), r: [0.037 * s * g * (0.8 + 0.3 * mus), 0.08 * s, 0.035 * s * g], o: { bone: 'upperarm_l', k: 0.03 * s, rot: [0, 0, Math.PI / 4] } });
  parts.push({ tag: 'forearm', side: 'l', t: 'cone', a: el, b: add(wr, v3(fl.L), -0.01 * s), ra: 0.039 * s * g, rb: 0.026 * s * gm, o: { bone: 'forearm_l', k: 0.03 * s } });
  parts.push({ tag: 'forearm', side: 'l', t: 'ell', c: add(add(el, v3(fl.L), P.foreArm * 0.28), v3(fl.N), -0.006 * s), r: [0.036 * s * g, 0.075 * s, 0.03 * s * g], o: { bone: 'forearm_l', k: 0.03 * s, rot: [0, 0, Math.PI / 4] } });

  // ── hand ──
  const hs = b.handSize * s;
  const handRot = basisQuat(fl.T, fl.L);
  parts.push({ tag: 'hand', side: 'l', t: 'box', c: P.hp('l', P.palm * 0.5, 0.002 * hs, 0), half: [0.04 * hs * gm, P.palm * 0.52, 0.0145 * hs * gm], round: 0.012 * hs, o: { bone: 'hand_l', k: 0.015 * s, rot: handRot } });
  // mitten fingers: proximal + distal in one box blended fing1 → fing2
  const f0 = P.hp('l', P.palm + P.finger * 0.48, -0.004 * hs, 0.001 * hs);
  parts.push({ tag: 'fingers', side: 'l', t: 'box', c: f0, half: [0.038 * hs * gm, P.finger * 0.5, 0.0105 * hs * gm], round: 0.0095 * hs, o: { bone: 'fing1_l', bone2: 'fing2_l', blend: [0.35, 0.65], blendAxis: [P.hp('l', P.palm, 0, 0), P.hp('l', P.palm + P.finger, 0, 0)], k: 0.008 * s, rot: handRot } });
  // thumb
  parts.push({ tag: 'thumb', side: 'l', t: 'cone', a: P.hp('l', 0.012 * hs, 0.018 * hs, 0.004 * hs), b: j.thumb2_l, ra: 0.016 * hs, rb: 0.012 * hs, o: { bone: 'thumb1_l', k: 0.012 * s } });
  const tdir = new THREE.Vector3(...j.thumb2_l).sub(new THREE.Vector3(...j.thumb1_l)).normalize();
  parts.push({ tag: 'thumb', side: 'l', t: 'cone', a: j.thumb2_l, b: add(j.thumb2_l, v3(tdir), 0.032 * hs), ra: 0.012 * hs, rb: 0.0095 * hs, o: { bone: 'thumb2_l', k: 0.006 * s } });

  // ── leg ──
  const hipJ = j.thigh_l;
  const knee = j.shin_l;
  const ank = j.foot_l;
  parts.push({ tag: 'thigh', side: 'l', t: 'cone', a: add(hipJ, [0.004 * s, 0.02 * s, 0]), b: knee, ra: 0.083 * s * g, rb: 0.05 * s * g, o: { bone: 'thigh_l', k: 0.05 * s, skinK: 0.06 * s } });
  parts.push({ tag: 'thigh', side: 'l', t: 'ell', c: [hipJ[0] + 0.006 * s, (hipJ[1] + knee[1]) / 2 + 0.03 * s, 0.022 * s], r: [0.06 * s * g, 0.16 * s, 0.06 * s * g * (0.85 + 0.25 * mus)], o: { bone: 'thigh_l', k: 0.04 * s } });
  parts.push({ tag: 'knee', side: 'l', t: 'ell', c: add(knee, [0, 0.005 * s, 0.012 * s]), r: [0.047 * s * gm, 0.05 * s, 0.045 * s * gm], o: { bone: 'shin_l', k: 0.03 * s, skinK: 0.05 * s } });
  parts.push({ tag: 'shin', side: 'l', t: 'cone', a: knee, b: add(ank, [0, 0.03 * s, 0]), ra: 0.047 * s * g, rb: 0.03 * s * gm, o: { bone: 'shin_l', k: 0.03 * s } });
  parts.push({ tag: 'calf', side: 'l', t: 'ell', c: [knee[0] + 0.004 * s, knee[1] - 0.13 * s, knee[2] - 0.032 * s], r: [0.043 * s * g, 0.1 * s, 0.045 * s * g], o: { bone: 'shin_l', k: 0.04 * s } });
  // ── foot ──
  const fs = b.footSize * s;
  const toe = j.toe_l;
  parts.push({ tag: 'foot', side: 'l', t: 'box', c: [ank[0] + 0.003 * s, ank[1] * 0.55, ank[2] + P.footLen * 0.2], half: [0.04 * fs * gm, ank[1] * 0.52, P.footLen * 0.36], round: 0.028 * fs, o: { bone: 'foot_l', k: 0.03 * s, skinK: 0.03 * s } });
  parts.push({ tag: 'foot', side: 'l', t: 'cone', a: [ank[0], ank[1] * 0.9, ank[2] - 0.015 * s], b: [ank[0], ank[1] * 0.5, ank[2] - 0.045 * s], ra: 0.036 * fs, rb: 0.032 * fs, o: { bone: 'foot_l', k: 0.03 * s } });
  parts.push({ tag: 'toes', side: 'l', t: 'box', c: [toe[0] + 0.004 * s, toe[1] * 0.85, toe[2] + 0.035 * fs], half: [0.042 * fs * gm, toe[1] * 0.9, 0.045 * fs], round: 0.02 * fs, o: { bone: 'toe_l', k: 0.02 * s, skinK: 0.02 * s } });
  return parts;
}

export interface EmitOpts extends PrimOpts {
  /** grow every part by this much (m) */
  inflate?: number;
  /** scale radii (on top of inflate) */
  scale?: number;
  /** emit side parts once in the sculpt's CURRENT mirror state (use inside s.mirrored) and skip centre parts */
  oneSide?: boolean;
}

/** emit a filtered set of parts (left parts are mirrored to the right automatically) */
export function emitParts(s: Sculpt, parts: Part[], tags: PartTag[] | ((p: Part) => boolean), o: EmitOpts = {}) {
  const want = typeof tags === 'function' ? tags : (p: Part) => (tags as PartTag[]).includes(p.tag);
  const inf = o.inflate ?? 0;
  const sc = o.scale ?? 1;
  const { inflate: _i, scale: _s, oneSide, ...prim } = o;
  void _i;
  void _s;
  const emit = (p: Part) => {
    const po: PrimOpts = { ...p.o, ...prim, bone: p.o.bone, bone2: p.o.bone2, blend: p.o.blend, blendAxis: p.o.blendAxis, rot: p.o.rot };
    if (prim.k !== undefined) po.k = prim.k;
    if (p.t === 'cone') s.cone(p.a, p.b, p.ra * sc + inf, p.rb * sc + inf, po);
    else if (p.t === 'ell') s.ellipsoid(p.c, [p.r[0] * sc + inf, p.r[1] * sc + inf, p.r[2] * sc + inf], po);
    else s.box(p.c, [p.half[0] * sc + inf, p.half[1] * sc + inf, p.half[2] * sc + inf], p.round * sc + inf, po);
  };
  for (const p of parts) {
    if (!want(p)) continue;
    if (oneSide) {
      if (p.side === 'l') emit(p);
    } else if (p.side === 'l') s.mirrored(() => emit(p));
    else emit(p);
  }
}
