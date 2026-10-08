/**
 * Humanoid pose vocabulary. A pose is a flat Float32Array of named parameters (pelvis offset,
 * spine/chest/neck/head Euler angles, foot targets, hand targets in CHEST space relative to the
 * shoulder in units of arm reach, hand knuckle/thumb directions, elbow poles, grips…). Poses are
 * blended linearly and solved once per frame (two-bone IK for limbs) by the animator.
 */
import { bipedGait, makeBipedSample, envelope, type BipedGaitSample } from '../kit/anim';
import type { AttackAnim, SpecialPose } from '../../core/types';
import type { AnimStyle } from './types';

export const F = {
  px: 0, py: 1, pz: 2, pp: 3, pyaw: 4, pr: 5,
  sp: 6, sy: 7, sr: 8,
  cp: 9, cy: 10, cr: 11,
  np: 12, ny: 13, nr: 14,
  hp: 15, hy: 16, hr: 17,
  // feet: offsets from the rest ankle (m, model), pitch (+ toe down), yaw, roll
  flx: 18, fly: 19, flz: 20, flp: 21, flyaw: 22,
  frx: 23, fry: 24, frz: 25, frp: 26, fryaw: 27,
  // knee pole outward bias
  kl: 28, kr: 29,
  // hand (wrist) targets in chest space relative to the shoulder joint, units of arm reach
  hlx: 30, hly: 31, hlz: 32, hrx: 33, hry: 34, hrz: 35,
  // knuckle direction and thumb direction (chest space)
  hldx: 36, hldy: 37, hldz: 38, hltx: 39, hlty: 40, hltz: 41,
  hrdx: 42, hrdy: 43, hrdz: 44, hrtx: 45, hrty: 46, hrtz: 47,
  // elbow pole directions (chest space)
  elx: 48, ely: 49, elz: 50, erx: 51, ery: 52, erz: 53,
  gl: 54, gr: 55, cll: 56, clr: 57, jaw: 58, tl: 59, tr: 60,
  // absolute hand pins (model space, m) with weight
  plw: 61, plx: 62, ply: 63, plz: 64, prw: 65, prx: 66, pry: 67, prz: 68,
  COUNT: 69,
} as const;

export type Pose = Float32Array;
export const newPose = () => new Float32Array(F.COUNT);

/** body metrics the pose functions need */
export interface BodyMetrics {
  s: number;
  /** hip joint height */
  hipY: number;
  legLen: number;
  /** arm reach (upper + fore) */
  reach: number;
  hipX: number;
  shoulderY: number;
  shoulderX: number;
  ankleH: number;
  footLen: number;
  height: number;
  style: AnimStyle;
}

export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return out === a ? out : (out.set(a), out);
  if (t >= 1) return out === b ? out : (out.set(b), out);
  for (let i = 0; i < F.COUNT; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
/** blend `src` into `out` by weight (out = lerp(out, src, w)) */
export function mixInto(out: Pose, src: Pose, w: number) {
  if (w <= 0) return;
  if (w >= 1) {
    out.set(src);
    return;
  }
  for (let i = 0; i < F.COUNT; i++) out[i] += (src[i] - out[i]) * w;
}

function setV(p: Pose, i: number, x: number, y: number, z: number) {
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
}

/** hand helpers: left and right mirrored automatically (x is "outward") */
function hands(p: Pose, lx: number, ly: number, lz: number, rx: number, ry: number, rz: number) {
  setV(p, F.hlx, lx, ly, lz);
  setV(p, F.hrx, -rx, ry, rz);
}
function handDirs(p: Pose, side: 'l' | 'r', dx: number, dy: number, dz: number, tx: number, ty: number, tz: number) {
  // x components given as "outward"
  const m = side === 'l' ? 1 : -1;
  if (side === 'l') {
    setV(p, F.hldx, dx * m, dy, dz);
    setV(p, F.hltx, tx * m, ty, tz);
  } else {
    setV(p, F.hrdx, dx * m, dy, dz);
    setV(p, F.hrtx, tx * m, ty, tz);
  }
}
function elbows(p: Pose, lx: number, ly: number, lz: number, rx: number, ry: number, rz: number) {
  setV(p, F.elx, lx, ly, lz);
  setV(p, F.erx, -rx, ry, rz);
}

/** neutral standing pose */
export function neutralPose(B: BodyMetrics, p: Pose): Pose {
  p.fill(0);
  hands(p, 0.13, -0.93, 0.06, 0.13, -0.93, 0.06);
  handDirs(p, 'l', 0.12, -1, 0.12, -0.15, 0.05, 1);
  handDirs(p, 'r', 0.12, -1, 0.12, -0.15, 0.05, 1);
  elbows(p, 0.35, 0, -1, 0.35, 0, -1);
  p[F.gl] = 0.35;
  p[F.gr] = 0.35;
  p[F.kl] = 0.1;
  p[F.kr] = 0.1;
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Idle & locomotion
// ─────────────────────────────────────────────────────────────────────────────

export function idlePose(B: BodyMetrics, t: number, p: Pose): Pose {
  neutralPose(B, p);
  const st = B.style;
  const s = B.s;
  const breath = Math.sin((t * Math.PI * 2) / 4.2);
  const shift = Math.sin(t * 0.37) * 0.7 + Math.sin(t * 0.13 + 1.3) * 0.3;
  p[F.px] = 0.016 * s * shift;
  p[F.pr] = -0.028 * shift;
  p[F.py] = -0.012 * s - 0.03 * s * st.aggression - 0.04 * s * st.hunch;
  p[F.sp] = 0.06 * st.hunch + 0.01 * breath;
  p[F.cp] = -0.018 * breath + 0.18 * st.hunch;
  p[F.cr] = 0.02 * shift;
  p[F.np] = 0.06 * st.hunch - 0.004 * breath;
  p[F.hp] = -0.12 * st.hunch;
  p[F.hy] = Math.sin(t * 0.23) * 0.12 * (1 - st.aggression * 0.5);
  p[F.cll] = p[F.clr] = 0.025 * breath;
  // feet: weight on one leg, other slightly forward and turned out
  const w = 1 + 0.2 * st.aggression + 0.1 * (st.stance - 1);
  p[F.flx] = 0.012 * s * w;
  p[F.frx] = -0.012 * s * w;
  p[F.flz] = 0.045 * s + 0.03 * s * st.aggression;
  p[F.frz] = -0.02 * s;
  p[F.flyaw] = 0.12;
  p[F.fryaw] = -0.22;
  // arms: aggression → arms out and forward; hunch → arms hang forward
  const ao = st.aggression;
  hands(p, 0.12 + 0.12 * ao, -0.9 + 0.12 * ao + 0.01 * breath, 0.08 + 0.12 * ao + 0.2 * st.hunch, 0.12 + 0.12 * ao, -0.9 + 0.12 * ao + 0.01 * breath, 0.08 + 0.12 * ao + 0.2 * st.hunch);
  return p;
}

const _gait: BipedGaitSample = makeBipedSample();

/** walk / run / sprint / dash with planted feet. phase in cycles; moveDir local (x right, z forward). */
export function locomotionPose(B: BodyMetrics, phase: number, speed: number, mdx: number, mdz: number, t: number, p: Pose): Pose {
  idlePose(B, t, p);
  const st = B.style;
  const s = B.s;
  const g = bipedGait(phase, speed, B.legLen, _gait);
  const run = g.run;
  const ml = Math.hypot(mdx, mdz) || 1;
  // moveDir is "x right": local model +X is the character's LEFT, so flip
  const dx = -mdx / ml, dz = mdz / ml;
  const fwd = dz; // + forward, - backward
  const lat = dx;
  const walkW = Math.min(1, speed / 0.6);
  // feet along the move direction
  const width = 1 + Math.abs(lat) * 0.6 + (st.stance - 1) * 0.5;
  for (let side = 0; side < 2; side++) {
    const f = side === 0 ? g.left : g.right;
    const xi = side === 0 ? F.flx : F.frx;
    const sx = side === 0 ? 1 : -1;
    p[xi] = dx * f.along + sx * 0.01 * s * (width - 1) * 3;
    p[xi + 2] = dz * f.along;
    p[xi + 1] = f.lift;
    p[xi + 3] = f.pitch * Math.sign(fwd || 1) * (0.6 + 0.4 * Math.abs(fwd));
    p[xi + 4] = sx * 0.06 + lat * 0.15 * (1 - Math.abs(fwd));
  }
  // blend the idle stance offsets away
  const idleFeet = 1 - walkW;
  p[F.flx] += 0.012 * s * idleFeet;
  p[F.frx] -= 0.012 * s * idleFeet;
  // pelvis & torso
  const sw = 1 + st.swagger * 1.5;
  p[F.px] = 0;
  p[F.py] = g.pelvisY * (1 - st.grace * 0.3) - 0.012 * s - 0.03 * s * st.aggression - 0.05 * s * st.hunch;
  p[F.pr] = g.pelvisRoll * sw;
  p[F.pyaw] = g.pelvisYaw * (0.6 + 0.4 * Math.abs(fwd)) * Math.sign(fwd || 1) * (1 + st.swagger * 0.5);
  const lean = (0.03 + 0.17 * run + 0.06 * Math.max(0, speed - 7) / 2) * fwd;
  p[F.pp] = lean * 0.5;
  p[F.sp] = lean * 0.4 + 0.08 * st.hunch;
  p[F.cp] = lean * 0.3 + 0.18 * st.hunch;
  p[F.cr] = -lat * 0.08 * run - g.pelvisRoll * 0.6 * sw;
  p[F.cy] = -p[F.pyaw] * 1.15;
  p[F.np] = -lean * 0.5 + 0.06 * st.hunch;
  p[F.hp] = -lean * 0.3 - 0.12 * st.hunch;
  p[F.hy] = 0;
  // arms swing opposite to legs
  const a = g.armSwing * st.armSwing * Math.sign(fwd || 1);
  const walkSwing = 0.24 * walkW;
  const runBend = run;
  const lhz = 0.06 + a * (walkSwing * (1 - runBend) + 0.42 * runBend);
  const rhz = 0.06 - a * (walkSwing * (1 - runBend) + 0.42 * runBend);
  const hy = -0.92 + 0.42 * runBend;
  const ao = st.aggression;
  hands(p, 0.11 + 0.06 * runBend + 0.1 * ao, hy + Math.max(0, a) * 0.12 * runBend, lhz + 0.15 * runBend * 0.5 + 0.2 * st.hunch, 0.11 + 0.06 * runBend + 0.1 * ao, hy + Math.max(0, -a) * 0.12 * runBend, rhz + 0.15 * runBend * 0.5 + 0.2 * st.hunch);
  // fists in a run, knuckles forward
  handDirs(p, 'l', 0.12, -1 + runBend * 0.9, 0.12 + runBend * 0.9, -0.2, 0.2 + runBend * 0.6, 1 - runBend * 0.4);
  handDirs(p, 'r', 0.12, -1 + runBend * 0.9, 0.12 + runBend * 0.9, -0.2, 0.2 + runBend * 0.6, 1 - runBend * 0.4);
  elbows(p, 0.3, 0, -1, 0.3, 0, -1);
  p[F.gl] = Math.max(p[F.gl], 0.35 + 0.5 * runBend);
  p[F.gr] = Math.max(p[F.gr], 0.35 + 0.5 * runBend);
  // dash: very fast → low lunge with arms trailing
  const dash = Math.min(1, Math.max(0, (speed - 11) / 3));
  if (dash > 0) {
    p[F.py] -= 0.12 * s * dash;
    p[F.pp] += 0.25 * dash;
    p[F.sp] += 0.2 * dash;
    p[F.cp] += 0.15 * dash;
    p[F.np] -= 0.3 * dash;
    p[F.hp] -= 0.15 * dash;
  }
  return p;
}

/** airborne: tuck on the way up, reach for the ground on the way down */
export function airPose(B: BodyMetrics, vy: number, airTime: number, t: number, p: Pose): Pose {
  idlePose(B, t, p);
  const s = B.s;
  const up = Math.min(1, Math.max(0, (vy + 1) / 6));
  const down = 1 - up;
  const tuck = up * Math.min(1, airTime * 6);
  // legs
  p[F.fly] = (0.3 * tuck + 0.06 * down) * B.legLen;
  p[F.flz] = (0.18 * tuck + 0.08 * down) * B.legLen;
  p[F.fry] = (0.14 * tuck + 0.12 * down) * B.legLen;
  p[F.frz] = (-0.1 * tuck - 0.06 * down) * B.legLen;
  p[F.flp] = 0.35;
  p[F.frp] = 0.5;
  p[F.py] = 0.0;
  p[F.pp] = 0.1 * tuck - 0.04 * down;
  p[F.sp] = 0.08 * tuck;
  p[F.cp] = 0.06 * tuck - 0.05 * down;
  p[F.np] = -0.05;
  // arms: up and forward rising; out to the sides falling
  hands(p, 0.25 + 0.3 * down, -0.55 + 0.25 * up + 0.2 * down, 0.35 * up + 0.05 * down, 0.25 + 0.3 * down, -0.6 + 0.2 * up + 0.2 * down, 0.3 * up);
  elbows(p, 0.6, -0.2, -0.8, 0.6, -0.2, -0.8);
  void s;
  return p;
}

/** landing crouch, k in 0..1 */
export function landOverlay(B: BodyMetrics, k: number, p: Pose) {
  if (k <= 0) return;
  p[F.py] -= 0.14 * B.legLen * k;
  p[F.pp] += 0.12 * k;
  p[F.sp] += 0.12 * k;
  p[F.cp] += 0.08 * k;
  p[F.np] -= 0.12 * k;
  p[F.hly] += 0.15 * k;
  p[F.hry] += 0.15 * k;
  p[F.hlz] += 0.15 * k;
  p[F.hrz] += 0.15 * k;
}

// ─────────────────────────────────────────────────────────────────────────────
// Special poses
// ─────────────────────────────────────────────────────────────────────────────

export function specialPose(B: BodyMetrics, kind: Exclude<SpecialPose, null>, T: number, t: number, p: Pose): Pose {
  const s = B.s;
  const L = B.legLen;
  idlePose(B, t, p);
  const ph = T * Math.PI * 2;
  switch (kind) {
    case 'crouch': {
      p[F.py] = -0.36 * L;
      p[F.pp] = 0.25;
      p[F.sp] = 0.2;
      p[F.cp] = 0.15;
      p[F.np] = -0.25;
      p[F.hp] = -0.15;
      p[F.flz] = 0.12 * L;
      p[F.frz] = -0.1 * L;
      p[F.frp] = 0.5;
      p[F.kl] = 0.35;
      p[F.kr] = 0.35;
      hands(p, 0.18, -0.55, 0.45, 0.18, -0.6, 0.4);
      break;
    }
    case 'kneel': {
      // right knee down, left foot forward
      p[F.py] = -0.42 * L;
      p[F.pz] = -0.02 * s;
      p[F.flz] = 0.32 * L;
      p[F.fly] = 0;
      p[F.frz] = -0.36 * L;
      p[F.fry] = 0.06 * L;
      p[F.frp] = 1.1;
      p[F.kl] = 0.15;
      p[F.sp] = 0.05;
      p[F.cp] = 0.05;
      hands(p, 0.2, -0.5, 0.5, 0.15, -0.85, 0.1);
      break;
    }
    case 'sit': {
      p[F.py] = -(B.hipY - 0.46 * (B.height / 1.85)) - 0.02 * s;
      p[F.pz] = -0.12 * s;
      p[F.pp] = -0.1;
      p[F.sp] = 0.1;
      p[F.flz] = 0.38 * L;
      p[F.frz] = 0.36 * L;
      p[F.flx] = 0.03 * s;
      p[F.frx] = -0.03 * s;
      p[F.kl] = 0.1;
      p[F.kr] = 0.1;
      hands(p, 0.12, -0.6, 0.45, 0.12, -0.6, 0.45);
      handDirs(p, 'l', 0, -0.5, 1, -0.3, 0.6, 0);
      handDirs(p, 'r', 0, -0.5, 1, -0.3, 0.6, 0);
      break;
    }
    case 'ride': {
      // straddling a mount: legs apart and bent, hands forward low (reins)
      const bob = Math.sin(ph * 2) * 0.03 * s;
      p[F.py] = -0.18 * L + bob;
      p[F.pp] = 0.05;
      p[F.sp] = 0.08;
      p[F.cp] = 0.05;
      p[F.flx] = 0.14 * s;
      p[F.frx] = -0.14 * s;
      p[F.flz] = 0.12 * L;
      p[F.frz] = 0.12 * L;
      p[F.fly] = 0.22 * L;
      p[F.fry] = 0.22 * L;
      p[F.kl] = 0.9;
      p[F.kr] = 0.9;
      hands(p, 0.05, -0.55, 0.55, 0.05, -0.55, 0.55);
      handDirs(p, 'l', 0.1, -0.3, 1, -0.6, 0.6, 0);
      handDirs(p, 'r', 0.1, -0.3, 1, -0.6, 0.6, 0);
      p[F.gl] = p[F.gr] = 0.9;
      break;
    }
    case 'surf': {
      // shield surfing: side-on crouched stance, arms out for balance
      const sway = Math.sin(ph) * 0.06;
      p[F.py] = -0.24 * L;
      p[F.pyaw] = -1.1;
      p[F.pr] = sway * 0.5;
      p[F.sp] = 0.12;
      p[F.sy] = 0.25;
      p[F.cy] = 0.35;
      p[F.cr] = -sway;
      p[F.ny] = 0.35;
      p[F.hy] = 0.15;
      p[F.flx] = 0.0;
      p[F.flz] = 0.26 * L;
      p[F.frx] = 0.0;
      p[F.frz] = -0.26 * L;
      p[F.flyaw] = -1.0;
      p[F.fryaw] = -1.2;
      p[F.kl] = 0.4;
      p[F.kr] = 0.4;
      hands(p, 0.75, -0.2 + sway, 0.2, 0.7, -0.3 - sway, 0.1);
      elbows(p, 0.2, -1, -0.3, 0.2, -1, -0.3);
      break;
    }
    case 'barrel': {
      // balancing on rolling barrels: knees soft, arms out, constant small corrections
      const sway = Math.sin(ph) * 0.08 + Math.sin(ph * 2.3) * 0.03;
      p[F.py] = -0.15 * L;
      p[F.px] = sway * 0.4 * s;
      p[F.pr] = sway * 0.6;
      p[F.cr] = -sway * 1.1;
      p[F.sp] = 0.1;
      p[F.cp] = 0.08;
      p[F.flx] = 0.03 * s - sway * 0.2 * s;
      p[F.frx] = -0.03 * s - sway * 0.2 * s;
      p[F.flz] = 0.08 * L;
      p[F.frz] = -0.08 * L;
      hands(p, 0.7, -0.3 + sway * 0.8, 0.15, 0.7, -0.3 - sway * 0.8, 0.15);
      elbows(p, 0.2, -1, -0.2, 0.2, -1, -0.2);
      break;
    }
    case 'climb': {
      // climbing a wall in front (+Z): alternating reach; hands pinned in model space
      const a = Math.sin(ph);
      const reachUp = 0.5 + 0.5 * a;
      p[F.pz] = 0.06 * s;
      p[F.py] = -0.05 * L;
      p[F.pp] = -0.05;
      p[F.cp] = -0.05;
      p[F.np] = -0.25;
      p[F.hp] = -0.15;
      // feet push on the wall alternately
      p[F.flz] = 0.18 * L;
      p[F.fly] = (0.25 + 0.2 * a) * L;
      p[F.frz] = 0.18 * L;
      p[F.fry] = (0.25 - 0.2 * a) * L;
      p[F.flp] = 0.5;
      p[F.frp] = 0.5;
      p[F.kl] = 0.5;
      p[F.kr] = 0.5;
      hands(p, 0.25, 0.35 + 0.45 * reachUp, 0.35, 0.25, 0.35 + 0.45 * (1 - reachUp), 0.35);
      handDirs(p, 'l', 0, 1, 0.3, 0, 0.2, 1);
      handDirs(p, 'r', 0, 1, 0.3, 0, 0.2, 1);
      elbows(p, 0.8, -0.4, -0.4, 0.8, -0.4, -0.4);
      p[F.gl] = p[F.gr] = 1;
      break;
    }
    case 'hang': {
      // hanging from both hands above (ledge, bat feet, chain)
      const sw = Math.sin(ph) * 0.12;
      p[F.pp] = sw;
      p[F.pz] = -sw * 0.15 * s;
      p[F.py] = 0.0;
      p[F.cp] = -0.08;
      p[F.np] = -0.2;
      p[F.hp] = -0.2;
      p[F.cll] = p[F.clr] = 0.35;
      hands(p, 0.1, 0.96, 0.06, 0.1, 0.96, 0.06);
      handDirs(p, 'l', 0, 1, 0, 0, 0, 1);
      handDirs(p, 'r', 0, 1, 0, 0, 0, 1);
      elbows(p, 1, 0, -0.3, 1, 0, -0.3);
      p[F.fly] = 0.04 * L;
      p[F.fry] = 0.02 * L;
      p[F.flz] = 0.06 * L + sw * 0.1;
      p[F.frz] = -0.02 * L + sw * 0.1;
      p[F.flp] = 0.6;
      p[F.frp] = 0.6;
      p[F.gl] = p[F.gr] = 1;
      break;
    }
    case 'swing': {
      // swinging on a rope/chain held above, legs together, big pendulum
      const sw = Math.sin(ph) * 0.55;
      p[F.pp] = -sw * 0.6;
      p[F.cp] = -sw * 0.2 - 0.05;
      p[F.np] = -0.2;
      p[F.cll] = p[F.clr] = 0.3;
      hands(p, 0.02, 0.94, 0.1, 0.02, 0.88, 0.12);
      handDirs(p, 'l', 0, 1, 0, 0, 0, 1);
      handDirs(p, 'r', 0, 1, 0, 0, 0, 1);
      elbows(p, 1, 0, -0.3, 1, 0, -0.3);
      p[F.fly] = (0.1 + Math.max(0, sw) * 0.3) * L;
      p[F.fry] = (0.1 + Math.max(0, sw) * 0.3) * L;
      p[F.flz] = (0.15 + sw * 0.35) * L;
      p[F.frz] = (0.12 + sw * 0.35) * L;
      p[F.flp] = 0.7;
      p[F.frp] = 0.7;
      p[F.gl] = p[F.gr] = 1;
      break;
    }
    case 'run_wall': {
      // wall run (wall on the right): body tilted away from the wall, running legs
      locomotionPose(B, T, 6.5, 0, 1, t, p);
      p[F.pr] -= 0.35;
      p[F.cr] -= 0.15;
      p[F.nr] += 0.25;
      p[F.frx] += 0.12 * s;
      p[F.fry] += 0.08 * L;
      hands(p, 0.5, -0.3, 0.3, 0.25, -0.2, 0.4);
      break;
    }
    case 'cheer': {
      const pump = Math.max(0, Math.sin(ph));
      p[F.cp] = -0.12;
      p[F.np] = -0.2;
      p[F.hp] = -0.15;
      p[F.jaw] = 0.3 * pump;
      hands(p, 0.25, 0.75 + 0.2 * pump, 0.15, 0.2, 0.55 + 0.4 * pump, 0.1);
      handDirs(p, 'l', 0, 1, 0, 0, 0, 1);
      handDirs(p, 'r', 0, 1, 0, 0, 0, 1);
      elbows(p, 1, -0.3, -0.3, 1, -0.3, -0.3);
      p[F.gl] = p[F.gr] = 1;
      break;
    }
    case 'roar': {
      const tr = Math.sin(t * 47) * 0.02;
      p[F.py] = -0.08 * L;
      p[F.cp] = -0.2 + tr;
      p[F.sp] = -0.05;
      p[F.np] = -0.15;
      p[F.hp] = -0.35;
      p[F.jaw] = 0.65;
      p[F.cll] = p[F.clr] = 0.25;
      hands(p, 0.6, -0.1, 0.3, 0.6, -0.1, 0.3);
      elbows(p, 0.5, -1, -0.3, 0.5, -1, -0.3);
      p[F.gl] = p[F.gr] = 0.8;
      p[F.flz] = 0.15 * L;
      p[F.frz] = -0.12 * L;
      p[F.flx] = 0.06 * s;
      p[F.frx] = -0.06 * s;
      break;
    }
    case 'block': {
      // weapon raised across the body (or shield up)
      p[F.py] = -0.07 * L;
      p[F.cp] = 0.08;
      p[F.cy] = 0.1;
      p[F.np] = -0.05;
      hands(p, 0.05, -0.25, 0.65, -0.1, 0.05, 0.62);
      handDirs(p, 'r', 0.7, 0.3, 0.4, -0.95, 0.3, 0);
      handDirs(p, 'l', 0, 0.6, 1, -0.9, 0.3, 0);
      elbows(p, 0.8, -0.7, 0, 0.9, -0.6, 0);
      p[F.flz] = 0.14 * L;
      p[F.frz] = -0.14 * L;
      p[F.gl] = p[F.gr] = 1;
      break;
    }
    case 'stagger': {
      const wob = Math.sin(ph * 2) * 0.1;
      p[F.pz] = -0.05 * s;
      p[F.pp] = -0.12;
      p[F.pr] = wob;
      p[F.cp] = 0.2;
      p[F.cr] = -wob * 1.5;
      p[F.np] = 0.15;
      p[F.hp] = 0.12;
      p[F.flz] = -0.12 * L;
      p[F.frz] = 0.15 * L;
      p[F.fly] = Math.max(0, Math.sin(ph)) * 0.08 * L;
      hands(p, 0.5, -0.45 + wob, 0.2, 0.45, -0.3 - wob, 0.25);
      elbows(p, 0.5, -1, 0, 0.5, -1, 0);
      break;
    }
  }
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attacks (keyframed; t is 0..1 progress). Hands in chest space, reach units.
// ─────────────────────────────────────────────────────────────────────────────

interface Key {
  t: number;
  py?: number; pp?: number; pyaw?: number; sp?: number; sy?: number; cp?: number; cy?: number; cr?: number; np?: number; hp?: number;
  rh?: [number, number, number];
  rd?: [number, number, number];
  rt?: [number, number, number];
  re?: [number, number, number];
  lh?: [number, number, number];
  ld?: [number, number, number];
  lt?: [number, number, number];
  le?: [number, number, number];
  flz?: number; frz?: number; fly?: number; fry?: number;
  jaw?: number;
}

// right-hand coordinates: x "outward" is to the character's right (written as positive)
const ATTACKS: Record<AttackAnim, Key[]> = {
  slash: [
    { t: 0, cy: 0 },
    { t: 0.35, cy: -0.55, pyaw: -0.2, rh: [0.75, 0.2, -0.25], rd: [0.3, 0.6, -0.6], rt: [0.5, 0.5, 0.6], re: [0.6, -0.8, -0.2], lh: [0.25, -0.45, 0.45], cp: 0.02 },
    { t: 0.55, cy: 0.6, pyaw: 0.25, rh: [-0.45, -0.05, 0.75], rd: [-0.5, 0, 0.8], rt: [-0.7, 0.2, 0.3], re: [0.3, -1, 0], cp: 0.12, flz: 0.1 },
    { t: 0.75, cy: 0.5, pyaw: 0.2, rh: [-0.55, -0.3, 0.45], rd: [-0.6, -0.4, 0.6], rt: [-0.6, -0.2, -0.2], cp: 0.1, flz: 0.1 },
    { t: 1, cy: 0 },
  ],
  backslash: [
    { t: 0 },
    { t: 0.35, cy: 0.55, pyaw: 0.2, rh: [-0.35, 0.15, 0.35], rd: [-0.4, 0.5, 0.4], rt: [-0.6, 0.4, -0.5], re: [0.4, -0.8, -0.3] },
    { t: 0.55, cy: -0.55, pyaw: -0.2, rh: [0.75, -0.05, 0.45], rd: [0.6, 0, 0.6], rt: [0.6, 0.1, -0.6], re: [0.6, -0.9, 0], cp: 0.08 },
    { t: 0.8, cy: -0.45, rh: [0.7, -0.35, 0.2], rd: [0.6, -0.5, 0.2], rt: [0.5, -0.3, -0.6] },
    { t: 1 },
  ],
  thrust: [
    { t: 0 },
    { t: 0.4, cy: -0.4, pyaw: -0.2, rh: [0.3, -0.35, -0.15], rd: [0, 0, 1], rt: [0, 1, 0.2], re: [0.5, -0.5, -1], cp: -0.05 },
    { t: 0.58, cy: 0.15, pyaw: 0.15, rh: [0.1, -0.1, 0.98], rd: [0, 0, 1], rt: [0, 0.3, 1], re: [0.4, -1, 0], cp: 0.2, flz: 0.22, frz: -0.1 },
    { t: 0.8, cy: 0.1, rh: [0.15, -0.15, 0.85], rd: [0, 0, 1], rt: [0, 0.3, 1], cp: 0.15, flz: 0.2 },
    { t: 1 },
  ],
  overhead: [
    { t: 0 },
    { t: 0.4, cp: -0.2, sp: -0.05, rh: [0.15, 0.85, -0.2], rd: [0, 0.5, -1], rt: [0, -0.4, -1], re: [0.6, 0.2, -0.6], lh: [0.0, 0.8, -0.15], ld: [0, 0.5, -1], lt: [0, -0.4, -1], le: [0.6, 0.2, -0.6], np: -0.1 },
    { t: 0.58, cp: 0.4, sp: 0.15, rh: [0.05, -0.35, 0.8], rd: [0, -0.3, 1], rt: [0, 0.6, 0.8], re: [0.5, -1, 0], lh: [-0.05, -0.38, 0.78], ld: [0, -0.3, 1], lt: [0, 0.6, 0.8], le: [0.5, -1, 0], py: -0.08, flz: 0.15 },
    { t: 0.8, cp: 0.35, sp: 0.1, rh: [0.05, -0.45, 0.65], rd: [0, -0.5, 0.8], rt: [0, 0.7, 0.6], lh: [-0.05, -0.47, 0.63], ld: [0, -0.5, 0.8], lt: [0, 0.7, 0.6], py: -0.06, flz: 0.15 },
    { t: 1 },
  ],
  knife1: [
    { t: 0 },
    { t: 0.3, cy: -0.4, rh: [0.55, 0.05, 0.1], rd: [0.4, 0.4, -0.5], rt: [0.5, 0.6, 0.4], re: [0.6, -0.7, -0.4], lh: [0.2, -0.2, 0.55], ld: [0, 0.3, 1], lt: [-0.8, 0.5, 0] },
    { t: 0.55, cy: 0.5, pyaw: 0.2, rh: [-0.3, -0.25, 0.75], rd: [-0.4, -0.3, 0.8], rt: [-0.8, -0.2, 0.2], re: [0.4, -1, 0], lh: [0.35, -0.3, 0.35], cp: 0.12, flz: 0.15 },
    { t: 1 },
  ],
  knife2: [
    { t: 0 },
    { t: 0.3, cy: 0.45, lh: [0.6, 0.1, 0.05], ld: [0.4, 0.4, -0.5], lt: [0.5, 0.6, 0.4], le: [0.6, -0.7, -0.4], rh: [0.2, -0.2, 0.55] },
    { t: 0.55, cy: -0.5, pyaw: -0.2, lh: [-0.3, -0.2, 0.75], ld: [-0.4, -0.3, 0.8], lt: [-0.8, -0.2, 0.2], le: [0.4, -1, 0], rh: [0.35, -0.3, 0.35], cp: 0.12, frz: 0.15 },
    { t: 1 },
  ],
  knife3: [
    // spinning double slash finisher
    { t: 0, pyaw: 0 },
    { t: 0.25, pyaw: 0.6, cy: 0.4, py: -0.06, rh: [0.4, 0.1, -0.2], lh: [0.4, 0.1, -0.2], rd: [0.5, 0.4, -0.6], ld: [0.5, 0.4, -0.6] },
    { t: 0.5, pyaw: -1.6, cy: -0.6, py: -0.1, rh: [0.85, -0.1, 0.25], lh: [0.85, 0.05, 0.25], rd: [1, 0, 0.2], ld: [1, 0.1, 0.2], rt: [0.2, 0.2, -1], lt: [0.2, 0.2, -1], cp: 0.15, flz: 0.18 },
    { t: 0.72, pyaw: -3.4, cy: -0.4, py: -0.08, rh: [0.75, -0.25, 0.45], lh: [0.75, -0.15, 0.45], rd: [0.8, -0.4, 0.5], ld: [0.8, -0.3, 0.5], cp: 0.2, flz: 0.18 },
    { t: 0.9, pyaw: -6.28, cy: 0, py: -0.03 },
    { t: 1, pyaw: -6.28 },
  ],
  punch: [
    { t: 0 },
    { t: 0.35, cy: -0.35, rh: [0.25, -0.4, 0.05], rd: [0, 0, 1], rt: [-1, 0.2, 0], re: [0.5, -0.6, -1] },
    { t: 0.55, cy: 0.3, pyaw: 0.2, rh: [0.05, -0.05, 0.98], rd: [0, 0, 1], rt: [-1, 0, 0], re: [0.6, -0.8, 0], cp: 0.1, flz: 0.12 },
    { t: 1 },
  ],
  slam: [
    { t: 0 },
    { t: 0.45, cp: -0.25, rh: [0.3, 0.85, 0.0], lh: [0.3, 0.85, 0.0], rd: [0, 1, 0], ld: [0, 1, 0], re: [1, 0, -0.5], le: [1, 0, -0.5], py: 0.02 },
    { t: 0.62, cp: 0.55, sp: 0.25, rh: [0.15, -0.55, 0.75], lh: [0.15, -0.55, 0.75], rd: [0, -1, 0.5], ld: [0, -1, 0.5], py: -0.14, flz: 0.18, frz: -0.05 },
    { t: 0.85, cp: 0.45, sp: 0.2, rh: [0.15, -0.6, 0.7], lh: [0.15, -0.6, 0.7], py: -0.12, flz: 0.18 },
    { t: 1 },
  ],
  sweep: [
    { t: 0 },
    { t: 0.4, cy: -0.9, pyaw: -0.35, rh: [0.85, -0.3, -0.35], rd: [0.6, -0.2, -0.6], rt: [0.4, 0.8, 0.3], lh: [0.6, -0.3, -0.2], py: -0.06 },
    { t: 0.62, cy: 0.8, pyaw: 0.35, rh: [-0.6, -0.4, 0.65], rd: [-0.7, -0.2, 0.6], rt: [-0.4, 0.8, -0.2], lh: [-0.3, -0.4, 0.7], py: -0.1, cp: 0.15 },
    { t: 0.85, cy: 0.7, pyaw: 0.3, rh: [-0.7, -0.45, 0.35], py: -0.08 },
    { t: 1 },
  ],
  throw: [
    { t: 0 },
    { t: 0.45, cy: -0.6, cp: -0.15, rh: [0.45, 0.55, -0.45], rd: [0, 1, -0.3], rt: [0, 0.3, 1], re: [1, 0, -0.3], lh: [0.3, 0.1, 0.6], flz: 0.18 },
    { t: 0.6, cy: 0.35, cp: 0.2, rh: [0.1, 0.25, 0.9], rd: [0, 0.3, 1], rt: [0, 1, -0.2], re: [0.8, -0.5, 0], lh: [0.4, -0.6, 0.0], flz: 0.18 },
    { t: 1 },
  ],
  shoot: [
    // generic bow shot for NPC archers (draw → hold → release); bow in the left hand
    { t: 0 },
    { t: 1 },
  ],
  bite: [
    { t: 0 },
    { t: 0.4, np: -0.25, hp: -0.25, cp: -0.1, jaw: 0.6 },
    { t: 0.55, np: 0.35, hp: 0.25, cp: 0.25, sp: 0.1, jaw: 0.0, py: -0.04, flz: 0.1 },
    { t: 1 },
  ],
  stomp: [
    { t: 0 },
    { t: 0.45, fly: 0.35, flz: 0.18, cp: -0.1, py: 0.02, lh: [0.5, -0.2, 0.3], rh: [0.5, -0.2, 0.3] },
    { t: 0.6, fly: 0.0, flz: 0.22, cp: 0.2, py: -0.1, lh: [0.4, -0.5, 0.3], rh: [0.4, -0.5, 0.3] },
    { t: 1 },
  ],
};

const _ka: Key = { t: 0 };
const _vecOut: [number, number, number] = [0, 0, 0];
const _sk = { a: _ka, b: _ka, f: 0 };
function sampleKeys(keys: Key[], t: number): { a: Key; b: Key; f: number } {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const span = Math.max(1e-4, b.t - a.t);
  let f = Math.min(1, Math.max(0, (t - a.t) / span));
  f = f * f * (3 - 2 * f);
  _sk.a = a;
  _sk.b = b;
  _sk.f = f;
  return _sk;
}

/** blend an attack (layered over the base pose: upper body + optional foot shifts) */
export function attackOverlay(B: BodyMetrics, kind: AttackAnim, t: number, p: Pose, base: Pose) {
  const keys = ATTACKS[kind];
  if (!keys || keys.length < 2) return;
  const { a, b, f } = sampleKeys(keys, t);
  const w = kind === 'knife3' ? 1 : envelope(t, 0.12, 0.25);
  const st = B.style;
  const ag = 1 + st.aggression * 0.3;
  const num = (k: keyof Key, def: number) => {
    const va = (a[k] as number | undefined) ?? def;
    const vb = (b[k] as number | undefined) ?? def;
    return va + (vb - va) * f;
  };
  const vec = (k: 'rh' | 'rd' | 'rt' | 're' | 'lh' | 'ld' | 'lt' | 'le', d0: number, d1: number, d2: number): [number, number, number] => {
    const va = a[k], vb = b[k];
    const o = _vecOut;
    o[0] = va ? va[0] : d0; o[1] = va ? va[1] : d1; o[2] = va ? va[2] : d2;
    const e0 = vb ? vb[0] : d0, e1 = vb ? vb[1] : d1, e2 = vb ? vb[2] : d2;
    o[0] += (e0 - o[0]) * f; o[1] += (e1 - o[1]) * f; o[2] += (e2 - o[2]) * f;
    return o;
  };
  const blend = (idx: number, v: number) => (p[idx] += (v - p[idx]) * w);
  const add = (idx: number, v: number) => (p[idx] += v * w);
  add(F.pyaw, num('pyaw', 0));
  add(F.cy, num('cy', 0) * ag);
  add(F.cp, num('cp', 0));
  add(F.sp, num('sp', 0));
  add(F.cr, num('cr', 0));
  add(F.np, num('np', 0));
  add(F.hp, num('hp', 0));
  add(F.py, num('py', 0) * B.legLen);
  add(F.flz, num('flz', 0) * B.legLen);
  add(F.frz, num('frz', 0) * B.legLen);
  add(F.fly, num('fly', 0) * B.legLen);
  add(F.fry, num('fry', 0) * B.legLen);
  blend(F.jaw, Math.max(base[F.jaw], num('jaw', 0)));
  // right hand: x written as "outward right" → model chest-space x is negative
  const has = (k: 'rh' | 'lh') => a[k] !== undefined || b[k] !== undefined;
  if (has('rh')) {
    let v = vec('rh', -base[F.hrx], base[F.hry], base[F.hrz]);
    blend(F.hrx, -v[0]); blend(F.hry, v[1]); blend(F.hrz, v[2]);
    v = vec('rd', -base[F.hrdx], base[F.hrdy], base[F.hrdz]);
    blend(F.hrdx, -v[0]); blend(F.hrdy, v[1]); blend(F.hrdz, v[2]);
    v = vec('rt', -base[F.hrtx], base[F.hrty], base[F.hrtz]);
    blend(F.hrtx, -v[0]); blend(F.hrty, v[1]); blend(F.hrtz, v[2]);
    v = vec('re', -base[F.erx], base[F.ery], base[F.erz]);
    blend(F.erx, -v[0]); blend(F.ery, v[1]); blend(F.erz, v[2]);
  }
  if (has('lh')) {
    let v = vec('lh', base[F.hlx], base[F.hly], base[F.hlz]);
    blend(F.hlx, v[0]); blend(F.hly, v[1]); blend(F.hlz, v[2]);
    v = vec('ld', base[F.hldx], base[F.hldy], base[F.hldz]);
    blend(F.hldx, v[0]); blend(F.hldy, v[1]); blend(F.hldz, v[2]);
    v = vec('lt', base[F.hltx], base[F.hlty], base[F.hltz]);
    blend(F.hltx, v[0]); blend(F.hlty, v[1]); blend(F.hltz, v[2]);
    v = vec('le', base[F.elx], base[F.ely], base[F.elz]);
    blend(F.elx, v[0]); blend(F.ely, v[1]); blend(F.elz, v[2]);
  }
  p[F.gr] = Math.max(p[F.gr], w);
  void _ka;
}

/** additive flinch (h 0..1), direction-agnostic */
export function hitOverlay(B: BodyMetrics, h: number, p: Pose) {
  if (h <= 0) return;
  const k = Math.sin(Math.min(1, h) * Math.PI * 0.5);
  p[F.pz] -= 0.03 * B.s * k;
  p[F.sp] -= 0.06 * k;
  p[F.cp] -= 0.2 * k;
  p[F.np] -= 0.12 * k;
  p[F.hp] -= 0.25 * k;
  p[F.cr] += 0.08 * k;
  p[F.hlx] += 0.08 * k;
  p[F.hrx] -= 0.08 * k;
  p[F.hly] += 0.12 * k;
  p[F.hry] += 0.12 * k;
  p[F.jaw] = Math.max(p[F.jaw], 0.25 * k);
}

/** death falls. d: 0..1 progress (1 = lying still) */
export function deathPose(B: BodyMetrics, variant: number, d: number, p: Pose): Pose {
  const s = B.s;
  const L = B.legLen;
  neutralPose(B, p);
  const v = ((variant % 4) + 4) % 4;
  // eased fall with a small settle bounce
  const e = d < 0.75 ? Math.pow(d / 0.75, 1.6) : 1 + Math.sin(((d - 0.75) / 0.25) * Math.PI) * 0.03;
  const knees = Math.min(1, d * 2.5);
  const lie = Math.max(0, Math.min(1, e));
  // lying height of the pelvis
  const lieY = -(B.hipY - 0.13 * s);
  switch (v) {
    case 0: {
      // backward
      p[F.py] = -0.25 * L * knees * (1 - lie) + lieY * lie;
      p[F.pz] = -0.35 * s * lie;
      p[F.pp] = -1.5 * lie;
      p[F.sp] = 0.1 * (1 - lie);
      p[F.cp] = -0.15 * lie;
      p[F.np] = -0.2 * lie;
      p[F.hp] = -0.25 * lie;
      p[F.hy] = 0.5 * lie;
      p[F.flz] = 0.56 * L * lie;
      p[F.frz] = 0.46 * L * lie;
      p[F.fly] = 0.04 * L * lie;
      p[F.fry] = 0.1 * L * lie;
      p[F.flx] = 0.06 * s * lie;
      p[F.frx] = -0.1 * s * lie;
      p[F.flp] = -1.2 * lie;
      p[F.frp] = -1.0 * lie;
      p[F.kr] = 0.6 * lie;
      hands(p, 0.75, 0.25 * lie, -0.1, 0.6, 0.55 * lie, 0.05);
      elbows(p, 0.4, -1, 0, 0.4, -1, 0);
      p[F.jaw] = 0.25 * lie;
      break;
    }
    case 1: {
      // forward, face down
      p[F.py] = -0.3 * L * knees * (1 - lie) + (lieY - 0.0 * s) * lie;
      p[F.pz] = 0.35 * s * lie;
      p[F.pp] = 1.45 * lie;
      p[F.cp] = 0.1 * lie;
      p[F.np] = -0.35 * lie;
      p[F.hy] = 0.9 * lie;
      p[F.flz] = -0.45 * L * lie;
      p[F.frz] = -0.42 * L * lie;
      p[F.fly] = 0.07 * L * lie;
      p[F.fry] = 0.12 * L * lie;
      p[F.flp] = 1.4 * lie;
      p[F.frp] = 1.3 * lie;
      hands(p, 0.45, 0.6 * lie, 0.3, 0.6, -0.2 + 0.3 * lie, 0.2);
      elbows(p, 0.6, 0, 1, 0.6, 0, 1);
      break;
    }
    case 2: {
      // twist and fall onto the right side
      p[F.py] = -0.2 * L * knees * (1 - lie) + (lieY + 0.03 * s) * lie;
      p[F.px] = -0.3 * s * lie;
      p[F.pyaw] = 0.6 * lie;
      p[F.pr] = -1.45 * lie;
      p[F.sp] = 0.25 * lie;
      p[F.cp] = 0.2 * lie;
      p[F.nr] = 0.4 * lie;
      p[F.flz] = 0.25 * L * lie;
      p[F.frz] = 0.05 * L * lie;
      p[F.flx] = -0.4 * s * lie;
      p[F.frx] = -0.6 * s * lie;
      p[F.fly] = 0.2 * L * lie;
      p[F.fry] = 0.05 * L * lie;
      p[F.kl] = 0.8 * lie;
      hands(p, 0.4, 0.0, 0.55 * lie, 0.65, 0.3 * lie, 0.2);
      break;
    }
    default: {
      // knees first, then topple forward
      const k1 = Math.min(1, d / 0.45);
      const k2 = Math.max(0, (d - 0.45) / 0.55);
      const e2 = Math.pow(k2, 1.5);
      p[F.py] = -0.5 * L * k1 * (1 - e2) + lieY * e2;
      p[F.pz] = 0.3 * s * e2;
      p[F.pp] = 0.15 * k1 + 1.25 * e2;
      p[F.flz] = (-0.38 * k1 - 0.1 * e2) * L;
      p[F.frz] = (-0.4 * k1 - 0.08 * e2) * L;
      p[F.fly] = 0.04 * L;
      p[F.fry] = 0.04 * L;
      p[F.flp] = 1.3 * k1;
      p[F.frp] = 1.3 * k1;
      p[F.cp] = 0.25 * k1;
      p[F.np] = 0.3 * k1 - 0.4 * e2;
      p[F.hy] = 0.8 * e2;
      hands(p, 0.25, -0.8 + 0.5 * e2, 0.25 + 0.3 * e2, 0.3, -0.85 + 0.4 * e2, 0.2 + 0.3 * e2);
      break;
    }
  }
  p[F.gl] = p[F.gr] = 0.2;
  return p;
}
