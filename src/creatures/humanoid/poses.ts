/**
 * Humanoid pose vocabulary. A pose is a flat Float32Array of named parameters (pelvis offset,
 * spine/chest/neck/head Euler angles, foot targets, hand targets in CHEST space relative to the
 * shoulder in units of arm reach, hand knuckle/thumb directions, elbow poles, grips…). Poses are
 * blended linearly and solved once per frame (two-bone IK for limbs) by the animator.
 */
import { bipedGait, makeBipedSample, envelope, type BipedGaitSample } from '../kit/anim';
import type { AttackAnim, SpecialPose, WeaponKind } from '../../core/types';
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
  /** true bone lengths of the leg chain (hip joint → knee → ankle); `legLen` is only the vertical span */
  thighLen: number;
  shinLen: number;
  /** rest ankle relative to its hip joint, horizontal (m): outward distance (left leg) and forward offset */
  ankleDX: number;
  ankleDZ: number;
  /** the pelvis pivot (hips bone) above the hip joints (m): pitching the pelvis swings the hip joints about it */
  pelvisUp: number;
  /** rest joints of the trunk chain, model space (the left upper arm stands for both): the carry follows them to find where a hand is */
  trunk: { hips: V3t; spine: V3t; chest: V3t; arm: V3t };
  /** where a held item's origin sits in the hand: this far along the fingers from the wrist, this far out of the palm (m) */
  gripAlong: number;
  gripOut: number;
}

type V3t = readonly [number, number, number];

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

const _hs = new Float32Array(F.hrtz + 1 - F.hldx);
/**
 * `mixInto` with the hands' frames (knuckles and thumbs) turned instead of lerped: a lerp of two frames far apart passes through near-zero
 * vectors and the solved hand whips across the body (a hanging blade and a special pose's or a death pose's hand are nearly opposite:
 * 60-90 deg in one frame as the weight crosses a half). The frames turn the way `turnHand` takes them, by way of the neutral hand, one
 * short leg after the other, and are exact at w = 1. Not for blends of like frames (idle into walk): there the turn only distorts.
 */
export function mixTurning(out: Pose, src: Pose, w: number) {
  if (w <= 0) return;
  if (w >= 1) {
    out.set(src);
    return;
  }
  _hs.set(out.subarray(F.hldx, F.hrtz + 1));
  for (let i = 0; i < F.COUNT; i++) out[i] += (src[i] - out[i]) * w;
  out.set(_hs, F.hldx);
  blendHand(out, F.hldx, F.hltx, src[F.hldx], src[F.hldx + 1], src[F.hldx + 2], src[F.hltx], src[F.hltx + 1], src[F.hltx + 2], w, 1);
  blendHand(out, F.hrdx, F.hrtx, src[F.hrdx], src[F.hrdx + 1], src[F.hrdx + 2], src[F.hrtx], src[F.hrtx + 1], src[F.hrtx + 2], w, -1);
}

/** the angle (rad) of the short way between two unit quaternions */
const quatAngle = (a: Float64Array, b: Float64Array) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const _qd = new Float64Array(4), _qv = new Float64Array(4);
/**
 * Turn the pose's hand frame (slots `dd`, `tt`) to the frame (d, t) by weight `w` (0 = as it is, 1 = the frame), eased, at a steady
 * rate and without a flip. Two frames less than 120 deg apart turn the short way (a slerp). Two frames nearly opposite (a hold turned
 * up and a hand overhead) have no short way: the half revolution flips from one side to the other with the smallest change of either.
 * So the turn is two slerps, to a waypoint and on from it, each between fixed ends, each given its share of the weight by its length:
 * the waypoint is the middle of the short way, and from 120 to 165 deg apart moves over to the neutral hand (the pose a hand always
 * has a short way to), so a hand that starts at the neutral hand turns straight to the frame.
 */
function blendHand(p: Pose, dd: number, tt: number, dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, w: number, sx: number) {
  orthoPair(_fb, dx, dy, dz, tx, ty, tz);
  if (w >= 1) {
    p[dd] = _fb[0]; p[dd + 1] = _fb[1]; p[dd + 2] = _fb[2];
    p[tt] = _fb[3]; p[tt + 1] = _fb[4]; p[tt + 2] = _fb[5];
    return;
  }
  if (!(w > 0)) return;
  orthoPair(_fa, p[dd], p[dd + 1], p[dd + 2], p[tt], p[tt + 1], p[tt + 2]);
  pairQuat(_qa, _fa);
  pairQuat(_qb, _fb);
  slerpQ(_qd, _qa, _qb, 0.5); // the middle of the short way
  const far = (quatAngle(_qa, _qb) - 2.094) / (2.88 - 2.094); // 120 deg .. 165 deg
  if (far > 0) slerpQ(_qd, _qd, _qn[sx > 0 ? 0 : 1], far >= 1 ? 1 : far * far * (3 - 2 * far));
  const l1 = quatAngle(_qa, _qd), l2 = quatAngle(_qd, _qb);
  const d = w * w * (3 - 2 * w) * (l1 + l2);
  if (d <= l1 && l1 > 1e-6) slerpQ(_qv, _qa, _qd, d / l1);
  else slerpQ(_qv, _qd, _qb, l2 > 1e-6 ? Math.min(1, (d - l1) / l2) : 1);
  const x = _qv[0], y = _qv[1], z = _qv[2], q = _qv[3];
  p[dd] = 1 - 2 * (y * y + z * z); p[dd + 1] = 2 * (x * y + z * q); p[dd + 2] = 2 * (x * z - y * q);
  p[tt] = 2 * (x * y - z * q); p[tt + 1] = 1 - 2 * (x * x + z * z); p[tt + 2] = 2 * (y * z + x * q);
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

/**
 * Deepest knee flexion (rad, 0 = straight leg) that a standing stance (idle, the base of the walk)
 * may take at crouch 0. The style terms (hunch, aggression) lower the pelvis by multiples of the BODY
 * SCALE and know nothing of the leg length, so a short-legged or very hunched kind used to fold both
 * knees into a squat (trolls idled at 49-57 deg, goblins 53 deg; a man stands at ~27 deg).
 */
export const MAX_STANCE_FLEX = (40 * Math.PI) / 180;
/** the limit at crouch 1 (deep squats); in between it rises linearly with the `crouch` style */
export const CROUCH_MAX_FLEX = (100 * Math.PI) / 180;
/** pelvis drop of a full crouch (× leg length): the knee then bends ~99 deg (the head ends at ~78 % of the standing height) */
const CROUCH_DEPTH = 0.35;
/** torso pitch (rad) a full crouch adds (pelvis, spine, chest: ~46 deg in all) and a full lean adds (spine, chest: ~15 deg) */
const CROUCH_PITCH = { pp: 0.24, sp: 0.22, cp: 0.34 };
const LEAN_PITCH = { sp: 0.09, cp: 0.17 };
/** the `stance` at which the feet stand as wide as the reference sheets' (shoulder width + 15 %) */
const STANCE_SHEET = 1.4;

/** the idle's weight shift: pelvis sway (× body scale) and roll (rad) at full shift */
const IDLE_SWAY = 0.016;
const IDLE_ROLL = 0.028;

/** a 0..1 style value (missing or NaN = 0) */
const unit = (x: number | undefined) => (x === undefined || !(x > 0) ? 0 : x > 1 ? 1 : x);

/** knee-flexion limit (rad) of a standing stance with this `crouch` style */
export function stanceFlexLimit(crouch: number | undefined): number {
  return MAX_STANCE_FLEX + (CROUCH_MAX_FLEX - MAX_STANCE_FLEX) * unit(crouch);
}

export interface StanceLimit {
  /** how far (m) the hips may drift sideways / drop below the pelvis offset (the idle's weight shift) */
  swayX?: number;
  swayY?: number;
  /** knee-flexion limit (rad), default MAX_STANCE_FLEX */
  flex?: number;
  /** pelvis pitch (rad) the stance applies: it swings the hip joints back / up about the pelvis */
  pelvisPitch?: number;
}

/**
 * Pelvis offset (m, ≤ 0) of a standing stance: the style's wish `want`, but never so low that a knee
 * flexes past the limit. Each leg is a two-bone chain from its hip joint to the ankle target, so the
 * flexion follows from the hip→ankle distance D (law of cosines): D² = thigh² + shin² + 2·thigh·shin·cos(flex).
 * `feet` are the horizontal offsets [dx, dz] (m) of each ankle target from its hip joint; `o.swayX` /
 * `o.swayY` make the limit hold at the worst moment of the idle's weight shift. Exact for any build and
 * height and free of thresholds: the stance changes continuously with the proportions (a kind under the
 * limit is untouched).
 */
export function stanceDrop(B: BodyMetrics, want: number, feet: readonly (readonly [number, number])[], o: StanceLimit = {}): number {
  const swayX = o.swayX ?? 0, swayY = o.swayY ?? 0;
  const pitch = o.pelvisPitch ?? 0;
  const dMin2 = B.thighLen * B.thighLen + B.shinLen * B.shinLen + 2 * B.thighLen * B.shinLen * Math.cos(o.flex ?? MAX_STANCE_FLEX);
  // a forward-pitched pelvis swings its hip joints back (and a hair up) about the pelvis pivot
  const back = B.pelvisUp * Math.sin(pitch);
  const up = B.pelvisUp * (1 - Math.cos(pitch));
  let need = 0;
  for (const [dx, dz] of feet) {
    const h = Math.hypot(Math.max(0, Math.abs(dx) - swayX), dz + back);
    need = Math.max(need, Math.sqrt(Math.max(0, dMin2 - h * h))); // the foot straight below its hip needs the most height
  }
  const floor = Math.min(0, need + swayY - up - (B.hipY - B.ankleH));
  return Math.max(want, floor);
}

/**
 * What `stanceDrop` needs of a style that crouches: its raised knee-flexion limit and the pelvis pitch the
 * crouch applies, on top of `o` (the idle's sway). Shared by every pose that places its own feet (idle, walk,
 * the lab's sheet pose), so a crouching kind is limited the same way everywhere.
 */
export function crouchLimit(st: AnimStyle, o: StanceLimit = {}): StanceLimit {
  return { ...o, flex: stanceFlexLimit(st.crouch), pelvisPitch: CROUCH_PITCH.pp * unit(st.crouch) };
}

/**
 * The style's pelvis wish (m, ≤ 0) of a standing stance: `base` (hunch, aggression) and, with `crouch`,
 * the way down to the crouch depth (never higher than `base`).
 */
export function crouchWish(B: BodyMetrics, base: number, crouch: number | undefined): number {
  const c = unit(crouch);
  if (c <= 0) return base;
  return Math.min(base, base + (-CROUCH_DEPTH * B.legLen - base) * c);
}

/**
 * How far (m) each foot stands further out than `standing` (its lateral distance from the midline) for
 * the style's `stance` > 1: STANCE_SHEET puts it where the reference sheets stand, linear in between.
 * `want` is the narrow stance's pelvis wish and `dx0` its hip joint → ankle lateral offset: the feet never
 * spread further than 90 % of the hip→ankle distance of that stance (a legless build cannot straddle).
 */
export function stanceExtra(B: BodyMetrics, standing: number, want: number, dx0: number): number {
  const stance = B.style.stance;
  if (!(stance > 1)) return 0;
  const sheet = Math.max(B.shoulderX * 1.15 - standing, 0.6 * standing);
  const extra = ((Math.min(stance, 1.8) - 1) / (STANCE_SHEET - 1)) * sheet;
  return Math.min(extra, Math.max(0, 0.9 * Math.hypot(B.hipY - B.ankleH + want, dx0) - dx0));
}

/**
 * The pelvis wish when the feet stand `extra` further out (their hip→ankle lateral offset `dx0` grows
 * by it): the pelvis sinks so each leg keeps the hip→ankle distance of the narrow stance, i.e. the same
 * extension and knee bend; nothing is stretched and no foot leaves the ground.
 */
export function sinkForWidth(B: BodyMetrics, want: number, dx0: number, extra: number): number {
  if (!(extra > 0)) return want;
  const v0 = B.hipY - B.ankleH;
  const V = v0 + want;
  const d1 = dx0 + extra;
  return Math.sqrt(Math.max(V * V + dx0 * dx0 - d1 * d1, 0)) - v0;
}

/**
 * The posture the `crouch` and `lean` styles add on top of a standing pose (idle, walk): the torso
 * pitches forward over the feet, neck and head counter-pitch so the gaze stays level (the head juts
 * forward), the arms hang forward, the knees and toes turn out. Call it after the pose's own torso,
 * arms and feet are set; a no-op for crouch = lean = 0.
 */
export function stylePose(st: AnimStyle, p: Pose) {
  const c = unit(st.crouch), l = unit(st.lean);
  if (c <= 0 && l <= 0) return;
  const pp = CROUCH_PITCH.pp * c;
  const sp = CROUCH_PITCH.sp * c + LEAN_PITCH.sp * l;
  const cp = CROUCH_PITCH.cp * c + LEAN_PITCH.cp * l;
  p[F.pp] += pp;
  p[F.sp] += sp;
  p[F.cp] += cp;
  const tot = pp + sp + cp;
  p[F.np] -= 0.35 * tot;
  p[F.hp] -= 0.65 * tot;
  const arms = 0.1 * l + 0.12 * c;
  p[F.hlz] += arms;
  p[F.hrz] += arms;
  p[F.kl] = p[F.kr] = 0.1 + 0.25 * c;
  p[F.flyaw] += 0.15 * c;
  p[F.fryaw] -= 0.15 * c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Carry: how a hand holds what it holds at rest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A held item's long axis is the hand's thumb axis (weapons.ts: blade along +Y, hand socket Y = thumb) and the
 * neutral hand points the thumb straight ahead, so at rest every blade lay across the body and every shield lay
 * flat like a flag. The carry turns the hand about the wrist so the item sits the way a person carries it:
 *   hang     one-handed blades, axes, maces, clubs and hammers hang point-down beside the thigh, tilted forward
 *            and out (further forward where the point would otherwise reach the ground: a goblin's cleaver at knee
 *            height lies ~60 deg out of the vertical, forward and down)
 *   upright  spears, pikes and torches stand in the fist, head up (a butt may stand in the ground)
 *   shield   a shield stands vertical on the bent forearm, its face turned toward the front-left (HOLDS.shield)
 *   none     empty hands, bows (the animator carries those) and crossbows keep the neutral hand
 * It is part of the rest pose (idle, walking, jumping), so attacks blend from it and keep their own keys. A run
 * takes a hanging blade back to the fist held ahead (a blade hanging from a pumping arm would slap the legs);
 * shields and spears stay up. The lab's reference-sheet stance (sheetPose.ts) has its own, similar holds, with one
 * difference you cannot see: its hanging blades have the fingers forward, a half turn (169 deg) about the blade from
 * the neutral hand; here they point back and down, the roll that turns the hand least (76 deg), which keeps the wrist
 * natural and every blend between the carry and another hand (a run's fist, an attack's keys) well-conditioned.
 */
export type Carry = 'none' | 'hang' | 'upright' | 'shield';

const CARRY_OF: Partial<Record<WeaponKind, Carry>> = {
  sword: 'hang', elven_sword: 'hang', scimitar: 'hang', cleaver: 'hang', axe: 'hang', dwarf_axe: 'hang',
  mace: 'hang', club: 'hang', warhammer: 'hang', elven_knives: 'hang',
  spear: 'upright', pike: 'upright', torch: 'upright',
  shield: 'shield',
};
/** the carry of a weapon kind */
export const carryOf = (kind: string): Carry => CARRY_OF[kind as WeaponKind] ?? 'none';

/** one hand's carry: what it holds and how far the item reaches beyond the grip along its long axis (m, model space) */
export interface HandCarry {
  carry: Carry;
  /** toward the tip (the point of a blade, the head of a haft) and behind the grip */
  up: number;
  down: number;
}
/** what the hands hold: humanoid.ts keeps it current, the rest pose reads it */
export interface HeldCarry {
  l: HandCarry;
  r: HandCarry;
}
export const newHeldCarry = (): HeldCarry => ({ l: { carry: 'none', up: 0, down: 0 }, r: { carry: 'none', up: 0, down: 0 } });

export interface HoldDef {
  /** least angle (deg) of the long axis from straight down / up and the way it leans: 0 = forward, 90 = outward (a negative angle leans it the other way) */
  tilt: number;
  azim: number;
  /** +1 the axis points up (head up), -1 down (point down) */
  dir: 1 | -1;
  /** where the fingers point, x outward (mirrored per side); made perpendicular to the axis */
  knuckle: V3t;
  /** a hold with a face (a shield): the face (the item's +X, T x L) looks this many degrees out of straight ahead toward the outside
   *  (90 = straight out, 0 = forward); the fingers then point where the face needs them (L = N x T), and `knuckle` is not used */
  face?: number;
  /** the wrist hangs at least this far out of the shoulder (units of arm reach) */
  minOut: number;
  /** a forearm held forward (the shield on the arm): the wrist at least this far ahead of the shoulder, and no further than `maxDrop` below it
   *  (units of arm reach), so the elbow bends and the item stands clear of the thigh that swings forward in a stride */
  minFwd?: number;
  maxDrop?: number;
  /** the most the ground clearance may tilt the axis (deg); 0 = no clearance tilt */
  maxTilt: number;
}
/** the holds' tuning table (exported for the tools and tests that preview and sweep it) */
export const HOLDS: Record<Exclude<Carry, 'none'>, HoldDef> = {
  hang: { tilt: 24, azim: 26, dir: -1, knuckle: [0.1, -0.35, -0.93], minOut: 0.16, maxTilt: 75 },
  // no clearance tilt for a haft: its butt may stand in the ground (a planted spear). Lifting a butt by tilting near vertical takes a big turn
  // for a small gain, and a pumping hand (a crouched goblin's run swings 40 cm) then snapped the haft by 35 deg in a frame
  upright: { tilt: 7, azim: 30, dir: 1, knuckle: [-0.2, 0, 1], minOut: 0.16, maxTilt: 0 },
  // the shield rests on the forearm with its face turned toward the front, as every sheet holds it, not straight out (a face-out shield is an
  // edge-on sliver from the front, where the emblem is the identity cue). The sheets disagree on how far: their fronts and backs show the face
  // ~60 deg off the view, their profiles and three-quarters near edge-on. Swept against the calibrated turnarounds (scripts/sheet-compare.py, idle,
  // the five shield bearers): the mean IoU of the four views peaks at 15..30 deg and is no better than the old hold beyond 60. Turned to the
  // front, the shield's front edge swings in toward the body and meets the thigh that swings forward in a stride (a Rohirrim disc cut 5-15 cm
  // into it) unless the elbow is bent: the wrist is held 0.2 ahead of the shoulder and no lower than 0.75 of the arm below it, and the shield
  // then stands in front of the stride, as a person rests it on the arm. 40 deg gives up ~0.01 of the best IoU for margin there (35 clears
  // too, 30 touches an orc's thigh)
  shield: { tilt: -7, azim: 90, dir: 1, knuckle: [0, 0, 1], face: 40, minOut: 0.3, minFwd: 0.2, maxDrop: 0.75, maxTilt: 0 },
};
/** the point of a carried item keeps this far (× body height) above the ground */
const CARRY_CLEAR = 0.025;

// rotation matrices are row-major 3x3 (Float64Array(9)); scratch, since the carry runs once per animated humanoid and frame
const _Rh = new Float64Array(9), _Rs = new Float64Array(9), _Rc = new Float64Array(9), _Rhs = new Float64Array(9), _Rm = new Float64Array(9);
const _Sl = new Float64Array(3), _Sr = new Float64Array(3);
const _T = new Float64Array(3), _L = new Float64Array(3), _W = new Float64Array(3), _V = new Float64Array(3), _cL = new Float64Array(3), _cT = new Float64Array(3);

/** R = Ry(y) · Rx(x) · Rz(z), three.js' 'YXZ' Euler order (how the solver turns the pose's pitch / yaw / roll into a bone rotation) */
function eulerYXZ(o: Float64Array, x: number, y: number, z: number) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  o[0] = c * e + d * b * f; o[1] = -c * f + d * b * e; o[2] = d * a;
  o[3] = a * f;             o[4] = a * e;              o[5] = -b;
  o[6] = -d * e + c * b * f; o[7] = d * f + c * b * e; o[8] = c * a;
}
function mul3(o: Float64Array, a: Float64Array, b: Float64Array) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
}
/** o = R v */
function mulV(o: Float64Array, R: Float64Array, x: number, y: number, z: number) {
  o[0] = R[0] * x + R[1] * y + R[2] * z;
  o[1] = R[3] * x + R[4] * y + R[5] * z;
  o[2] = R[6] * x + R[7] * y + R[8] * z;
}
/** o = Rᵀ v */
function mulVt(o: Float64Array, R: Float64Array, x: number, y: number, z: number) {
  o[0] = R[0] * x + R[3] * y + R[6] * z;
  o[1] = R[1] * x + R[4] * y + R[7] * z;
  o[2] = R[2] * x + R[5] * y + R[8] * z;
}

/**
 * Where the chest and the shoulders stand for this pose (model space), found the way the solver's forward
 * kinematics does: hips → spine → chest, each turned by its own pitch / yaw / roll about its rest joint, the
 * hips moved by the pose's offset. Returns scratch (valid until the next call): `rot` is the chest's rotation
 * (row-major 3x3, chest space → model space), `l` / `r` the shoulder joints.
 */
export function trunkFrames(B: BodyMetrics, p: Pose): { rot: Float64Array; l: Float64Array; r: Float64Array } {
  const T = B.trunk;
  eulerYXZ(_Rh, p[F.pp], p[F.pyaw], p[F.pr]);
  eulerYXZ(_Rs, p[F.sp], p[F.sy], p[F.sr]);
  eulerYXZ(_Rc, p[F.cp], p[F.cy], p[F.cr]);
  mul3(_Rhs, _Rh, _Rs);
  mul3(_Rm, _Rhs, _Rc);
  // hips → spine → chest → shoulder
  const hx = T.hips[0] + p[F.px], hy = T.hips[1] + p[F.py], hz = T.hips[2] + p[F.pz];
  mulV(_V, _Rh, T.spine[0] - T.hips[0], T.spine[1] - T.hips[1], T.spine[2] - T.hips[2]);
  const sx = hx + _V[0], sy = hy + _V[1], sz = hz + _V[2];
  mulV(_V, _Rhs, T.chest[0] - T.spine[0], T.chest[1] - T.spine[1], T.chest[2] - T.spine[2]);
  const cx = sx + _V[0], cy = sy + _V[1], cz = sz + _V[2];
  mulV(_Sl, _Rm, T.arm[0] - T.chest[0], T.arm[1] - T.chest[1], T.arm[2] - T.chest[2]);
  mulV(_Sr, _Rm, -T.arm[0] - T.chest[0], T.arm[1] - T.chest[1], T.arm[2] - T.chest[2]);
  _Sl[0] += cx; _Sl[1] += cy; _Sl[2] += cz;
  _Sr[0] += cx; _Sr[1] += cy; _Sr[2] += cz;
  return { rot: _Rm, l: _Sl, r: _Sr };
}

/**
 * the hand frame of a hold (model space, `sx` +1 left / -1 right): long axis T at `theta` from straight down / up, fingers L perpendicular to it
 * (from the knuckle direction, or from `face`, the deg the item's face looks out of straight ahead, when the hold has one)
 */
function holdAxes(def: HoldDef, face: number | undefined, sx: number, theta: number, flip: boolean, T: Float64Array, L: Float64Array) {
  const az = def.azim * (Math.PI / 180);
  const st = Math.sin(theta), ct = Math.cos(theta);
  T[0] = sx * st * Math.sin(az);
  T[1] = def.dir * ct;
  T[2] = st * Math.cos(az);
  let kx: number, ky: number, kz: number;
  if (face !== undefined) {
    // the face normal N looks `face` deg out of straight ahead toward the outside, made perpendicular to the axis; L = N x T
    const fa = face * (Math.PI / 180), nx = sx * Math.sin(fa), nz = Math.cos(fa);
    const dn = nx * T[0] + nz * T[2];
    const px = nx - dn * T[0], py = -dn * T[1], pz = nz - dn * T[2];
    kx = py * T[2] - pz * T[1]; ky = pz * T[0] - px * T[2]; kz = px * T[1] - py * T[0];
  } else {
    kx = def.knuckle[0] * sx; ky = def.knuckle[1]; kz = flip ? -def.knuckle[2] : def.knuckle[2];
    const d = kx * T[0] + ky * T[1] + kz * T[2];
    kx -= d * T[0]; ky -= d * T[1]; kz -= d * T[2];
  }
  const n = Math.hypot(kx, ky, kz) || 1;
  L[0] = kx / n; L[1] = ky / n; L[2] = kz / n;
}

// unit quaternions as [x, y, z, w]
const _qa = new Float64Array(4), _qb = new Float64Array(4), _qc = new Float64Array(4), _fa = new Float64Array(6), _fb = new Float64Array(6);

/** o[0..2] = the unit knuckle direction (dx, dy, dz), o[3..5] = the thumb (tx, ty, tz) made perpendicular to it: the frame the solver reads from a hand direction pair */
function orthoPair(o: Float64Array, dx: number, dy: number, dz: number, tx: number, ty: number, tz: number) {
  const dn = Math.hypot(dx, dy, dz) || 1;
  dx /= dn; dy /= dn; dz /= dn;
  const k = tx * dx + ty * dy + tz * dz;
  tx -= k * dx; ty -= k * dy; tz -= k * dz;
  let tn = Math.hypot(tx, ty, tz);
  if (tn < 1e-6) {
    // a thumb along the knuckles: any perpendicular will do
    if (Math.abs(dx) < 0.9) { tx = 0; ty = dz; tz = -dy; } else { tx = -dz; ty = 0; tz = dx; }
    tn = Math.hypot(tx, ty, tz) || 1;
  }
  o[0] = dx; o[1] = dy; o[2] = dz;
  o[3] = tx / tn; o[4] = ty / tn; o[5] = tz / tn;
}

/** the unit quaternion of the rotation whose first two columns are the pair `f` from `orthoPair` (the third is their cross product) */
function pairQuat(o: Float64Array, f: Float64Array) {
  const c2x = f[1] * f[5] - f[2] * f[4], c2y = f[2] * f[3] - f[0] * f[5], c2z = f[0] * f[4] - f[1] * f[3];
  const m00 = f[0], m10 = f[1], m20 = f[2], m01 = f[3], m11 = f[4], m21 = f[5], m02 = c2x, m12 = c2y, m22 = c2z;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const k = Math.sqrt(tr + 1) * 2;
    w = k / 4; x = (m21 - m12) / k; y = (m02 - m20) / k; z = (m10 - m01) / k;
  } else if (m00 > m11 && m00 > m22) {
    const k = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / k; x = k / 4; y = (m01 + m10) / k; z = (m02 + m20) / k;
  } else if (m11 > m22) {
    const k = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / k; x = (m01 + m10) / k; y = k / 4; z = (m12 + m21) / k;
  } else {
    const k = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / k; x = (m02 + m20) / k; y = (m12 + m21) / k; z = k / 4;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  o[0] = x / n; o[1] = y / n; o[2] = z / n; o[3] = w / n;
}

const _qn = [new Float64Array(4), new Float64Array(4)], _fn = new Float64Array(6);
// the neutral hand (neutralPose) as a quaternion, left and right: the waypoint of every turn
for (const [i, sx] of [[0, 1], [1, -1]] as const) {
  orthoPair(_fn, sx * 0.12, -1, 0.12, sx * -0.15, 0.05, 1);
  pairQuat(_qn[i], _fn);
}

/** o = the spherical blend of unit quaternions a -> b by w, the short way round (o may be a or b) */
function slerpQ(o: Float64Array, a: Float64Array, b: Float64Array, w: number) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sg = cos < 0 ? -1 : 1;
  cos *= sg;
  let ka: number, kb: number;
  if (cos > 0.9995) {
    ka = 1 - w;
    kb = w * sg;
  } else {
    const om = Math.acos(cos), so = Math.sin(om);
    ka = Math.sin((1 - w) * om) / so;
    kb = (Math.sin(w * om) / so) * sg;
  }
  const x = a[0] * ka + b[0] * kb, y = a[1] * ka + b[1] * kb, z = a[2] * ka + b[2] * kb, q = a[3] * ka + b[3] * kb;
  const n = Math.hypot(x, y, z, q) || 1;
  o[0] = x / n; o[1] = y / n; o[2] = z / n; o[3] = q / n;
}

/**
 * Turn the pose's hand frame (knuckles at slot `dd`, thumb at `tt`: chest-space directions) to the frame (d, t) by `s`
 * (0 = as it is, 1 = the frame); `sx` is +1 for the left hand, -1 for the right. The turn goes by way of the NEUTRAL hand,
 * the pose a hand always has to come from or go to: a hanging blade and a run's fist (or an attack's keys) are about half
 * a revolution apart, and the short way between two such frames is not defined (it flips from one side to the other, a jump of
 * 60+ deg in a frame, as the pose moves through it, and a straight blend of the directions passes through nothing). Both
 * legs of the way are well short of that.
 */
export function turnHand(p: Pose, dd: number, tt: number, dx: number, dy: number, dz: number, tx: number, ty: number, tz: number, s: number, sx: number) {
  orthoPair(_fb, dx, dy, dz, tx, ty, tz);
  if (s >= 1) {
    p[dd] = _fb[0]; p[dd + 1] = _fb[1]; p[dd + 2] = _fb[2];
    p[tt] = _fb[3]; p[tt + 1] = _fb[4]; p[tt + 2] = _fb[5];
    return;
  }
  if (!(s > 0)) return;
  orthoPair(_fa, p[dd], p[dd + 1], p[dd + 2], p[tt], p[tt + 1], p[tt + 2]);
  pairQuat(_qa, _fa);
  pairQuat(_qb, _fb);
  // the pose's own hand toward the neutral hand by s, then from there to the frame by s: s = 0 is the hand as it is, s = 1 the frame
  // (a neutral hand turns straight to the frame)
  slerpQ(_qc, _qa, _qn[sx > 0 ? 0 : 1], s);
  slerpQ(_qc, _qc, _qb, s);
  const x = _qc[0], y = _qc[1], z = _qc[2], q = _qc[3];
  // columns 0 and 1 of its matrix: the knuckles and the thumb
  p[dd] = 1 - 2 * (y * y + z * z); p[dd + 1] = 2 * (x * y + z * q); p[dd + 2] = 2 * (x * z - y * q);
  p[tt] = 2 * (x * y - z * q); p[tt + 1] = 1 - 2 * (x * x + z * z); p[tt + 2] = 2 * (y * z + x * q);
}

function carryHand(B: BodyMetrics, p: Pose, left: boolean, hc: HandCarry, run: number) {
  if (hc.carry === 'none') return;
  const def = HOLDS[hc.carry];
  // a hanging blade gives way to the run's fist
  const r = run <= 0 ? 0 : run >= 1 ? 1 : run * run * (3 - 2 * run);
  const w = hc.carry === 'hang' ? 1 - r : 1;
  if (!(w > 0)) return;
  const sx = left ? 1 : -1;
  const hx = left ? F.hlx : F.hrx;
  // the wrist hangs clear of the hip
  const out = sx * p[hx];
  if (out < def.minOut) p[hx] = sx * (out + (def.minOut - out) * w);
  // a crouched body (the goblin) keeps a shield at its side, face out, as before: its knees stand forward where a shield held up in front
  // and turned to the front would hang, and its shield is as big as it is
  const open = def.face === undefined ? 0 : unit(B.style.crouch);
  const wf = w * (1 - open);
  if (def.minFwd !== undefined && p[hx + 2] < def.minFwd) p[hx + 2] += (def.minFwd - p[hx + 2]) * wf;
  if (def.maxDrop !== undefined && p[hx + 1] < -def.maxDrop) p[hx + 1] += (-def.maxDrop - p[hx + 1]) * wf;
  // the long axis: its least tilt, more where the point would reach the ground. The grip stands at the wrist target
  // (through the solved chest, from the shoulder) plus the hand's own offset along the fingers and out of the palm
  const S = left ? _Sl : _Sr;
  const R = B.reach;
  mulV(_W, _Rm, p[hx] * R, p[hx + 1] * R, p[hx + 2] * R);
  const wristY = _W[1] + S[1];
  const theta0 = def.tilt * (Math.PI / 180);
  let theta = theta0;
  const flip = hc.carry === 'shield' && !left;
  const face = def.face === undefined ? undefined : def.face + (90 - def.face) * open;
  holdAxes(def, face, sx, theta, flip, _T, _L);
  const ext = hc.carry === 'hang' ? hc.up : hc.carry === 'upright' ? hc.down : 0;
  if (ext > 1e-3 && def.maxTilt > 0) {
    const clear = CARRY_CLEAR * B.height;
    for (let it = 0; it < 2; it++) {
      const ny = sx * (_L[2] * _T[0] - _L[0] * _T[2]); // palm normal (up) = L x T on the left, T x L on the right
      const gy = wristY + B.gripAlong * _L[1] + B.gripOut * ny;
      const c = (gy - clear) / ext;
      const need = c >= 1 ? 0 : Math.acos(Math.max(-1, c));
      theta = Math.min(def.maxTilt * (Math.PI / 180), Math.max(theta0, need));
      holdAxes(def, face, sx, theta, flip, _T, _L);
    }
  }
  // into chest space, turned over from the pose's own hand
  const dd = left ? F.hldx : F.hrdx, tt = left ? F.hltx : F.hrtx;
  mulVt(_cL, _Rm, _L[0], _L[1], _L[2]);
  mulVt(_cT, _Rm, _T[0], _T[1], _T[2]);
  if (w >= 1) {
    p[dd] = _cL[0]; p[dd + 1] = _cL[1]; p[dd + 2] = _cL[2];
    p[tt] = _cT[0]; p[tt + 1] = _cT[1]; p[tt + 2] = _cT[2];
  } else {
    turnHand(p, dd, tt, _cL[0], _cL[1], _cL[2], _cT[0], _cT[1], _cT[2], w, sx);
    if (ext > 1e-3 && def.maxTilt > 0) {
      // between the hanging blade and the run's fist the blade has neither the tilt solved above nor the fist's, and the hand's run swing
      // is at its lowest: where the point of what is held would reach the ground, lift the wrist (a goblin's club went 14 cm through the floor at 2.5 m/s)
      const clear = CARRY_CLEAR * B.height;
      for (let it = 0; it < 2; it++) {
        mulV(_W, _Rm, p[hx] * R, p[hx + 1] * R, p[hx + 2] * R);
        mulV(_T, _Rm, p[tt], p[tt + 1], p[tt + 2]);
        mulV(_L, _Rm, p[dd], p[dd + 1], p[dd + 2]);
        const ny = sx * (_L[2] * _T[0] - _L[0] * _T[2]);
        const tip = _W[1] + S[1] + B.gripAlong * _L[1] + B.gripOut * ny + _T[1] * ext;
        if (tip >= clear) break;
        p[hx + 1] += (clear - tip) / (R * Math.max(0.3, _Rm[4]));
      }
    }
  }
}

/**
 * Put what the hands hold into the rest pose `p` (idle, walk, air): the hands' frames and wrist targets, see
 * `Carry`. `run` (0..1) is how far the gait is a run. Call it last, once the torso and arms are set.
 */
export function applyCarry(B: BodyMetrics, p: Pose, held: HeldCarry, run: number) {
  if (held.l.carry === 'none' && held.r.carry === 'none') return;
  trunkFrames(B, p);
  carryHand(B, p, true, held.l, run);
  carryHand(B, p, false, held.r, run);
}

/** the standing pose of the body: the idle without what the hands hold (the walk, jump and special poses start from it) */
function standPose(B: BodyMetrics, t: number, p: Pose): Pose {
  neutralPose(B, p);
  const st = B.style;
  const s = B.s;
  const breath = Math.sin((t * Math.PI * 2) / 4.2);
  const shift = Math.sin(t * 0.37) * 0.7 + Math.sin(t * 0.13 + 1.3) * 0.3;
  p[F.px] = IDLE_SWAY * s * shift;
  p[F.pr] = -IDLE_ROLL * shift;
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
  // pelvis wish of the narrow stance: the style's crouch
  const wish = crouchWish(B, -0.012 * s - 0.03 * s * st.aggression - 0.04 * s * st.hunch, st.crouch);
  // stance > 1: the feet stand further apart (the small hint in `w` above stays); measured from the stance-1 feet
  const dx0 = B.ankleDX + p[F.flx]; // hip joint → ankle target, lateral, before widening
  const extra = stanceExtra(B, B.hipX + B.ankleDX + 0.012 * s * (1 + 0.2 * st.aggression), wish, dx0);
  if (extra > 0) {
    p[F.flx] += extra;
    p[F.frx] -= extra;
  }
  // pelvis drop: the wish (sinking a little for a wide stance), kept inside the knee-flexion limit for
  // these feet, this pelvis pitch and the sway above
  p[F.py] = stanceDrop(B, sinkForWidth(B, wish, dx0, extra), [[B.ankleDX + p[F.flx], B.ankleDZ + p[F.flz]], [B.ankleDX - p[F.frx], B.ankleDZ + p[F.frz]]], crouchLimit(st, { swayX: IDLE_SWAY * s, swayY: IDLE_ROLL * B.hipX }));
  // arms: aggression → arms out and forward; hunch → arms hang forward
  const ao = st.aggression;
  hands(p, 0.12 + 0.12 * ao, -0.9 + 0.12 * ao + 0.01 * breath, 0.08 + 0.12 * ao + 0.2 * st.hunch, 0.12 + 0.12 * ao, -0.9 + 0.12 * ao + 0.01 * breath, 0.08 + 0.12 * ao + 0.2 * st.hunch);
  stylePose(st, p);
  return p;
}

/** the idle; `held` (what the hands hold, see `Carry`) puts the carried items in the hands, without it they keep the neutral hand */
export function idlePose(B: BodyMetrics, t: number, p: Pose, held?: HeldCarry): Pose {
  standPose(B, t, p);
  if (held) applyCarry(B, p, held, 0);
  return p;
}

const _gait: BipedGaitSample = makeBipedSample();

/** how far the gait at `speed` is a run (0 = a walk .. 1 = a run): the weight the carry takes a hanging blade back to the run's fist by */
export function runWeight(B: BodyMetrics, speed: number): number {
  return speed > 0.02 ? bipedGait(0, speed, B.legLen, _gait).run : 0;
}

/** walk / run / sprint / dash with planted feet. phase in cycles; moveDir local (x right, z forward). */
export function locomotionPose(B: BodyMetrics, phase: number, speed: number, mdx: number, mdz: number, t: number, p: Pose, held?: HeldCarry): Pose {
  standPose(B, t, p);
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
  // base crouch of the style
  const wish = crouchWish(B, -0.012 * s - 0.03 * s * st.aggression - 0.05 * s * st.hunch, st.crouch);
  // stance > 1: the feet stand further apart (the gait's stride only adds reach along z). `hint` is the
  // feet's lateral offset from their rest without the stride (the small stance hint above and the idle
  // offsets fading out), `hint1` the same at stance 1: the widening is measured from the latter
  const hint = 0.01 * s * (width - 1) * 3 + 0.012 * s * idleFeet;
  const hint1 = 0.01 * s * (Math.abs(lat) * 0.6) * 3 + 0.012 * s * idleFeet;
  const extra = stanceExtra(B, B.hipX + B.ankleDX + hint1, wish, B.ankleDX + hint);
  if (extra > 0) {
    p[F.flx] += extra;
    p[F.frx] -= extra;
  }
  // pelvis & torso
  const sw = 1 + st.swagger * 1.5;
  p[F.px] = 0;
  // the wish (sinking a little for a wide stance), kept inside the knee-flexion limit for feet under the
  // hips (the gait's stride only adds reach). Only a widened stance counts the hint: stance <= 1 stays as it was
  const under: [number, number] = [B.ankleDX + (extra > 0 ? hint + extra : 0), B.ankleDZ];
  p[F.py] =
    g.pelvisY * (1 - st.grace * 0.3) +
    stanceDrop(B, sinkForWidth(B, wish, B.ankleDX + hint, extra), [under, under], crouchLimit(st));
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
  stylePose(st, p);
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
  if (held) applyCarry(B, p, held, run);
  return p;
}

/**
 * airborne: tuck on the way up, reach for the ground on the way down. `speed` is the horizontal speed (it sets how far the carry has gone
 * from a hanging blade to the run's fist, as on the ground: the hand must not change its frame as the air layer comes and goes)
 */
export function airPose(B: BodyMetrics, vy: number, airTime: number, t: number, p: Pose, held?: HeldCarry, speed = 0): Pose {
  standPose(B, t, p);
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
  // the head keeps its own pitch: standPose counter-pitched it for the crouch and lean it put in the torso, which this pose has just replaced
  p[F.hp] = -0.12 * B.style.hunch;
  // arms: up and forward rising; out to the sides falling
  hands(p, 0.25 + 0.3 * down, -0.55 + 0.25 * up + 0.2 * down, 0.35 * up + 0.05 * down, 0.25 + 0.3 * down, -0.6 + 0.2 * up + 0.2 * down, 0.3 * up);
  elbows(p, 0.6, -0.2, -0.8, 0.6, -0.2, -0.8);
  void s;
  if (held) applyCarry(B, p, held, runWeight(B, speed));
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

export interface Key {
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
export const ATTACKS: Record<AttackAnim, Key[]> = {
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
    // the knuckles are perpendicular to the thumb (the blade, forward and a little up): the pair the solver reads is then the one authored.
    // (They were given forward, parallel to the thumb, and the solver read the blade as straight up.)
    { t: 0.58, cy: 0.15, pyaw: 0.15, rh: [0.1, -0.1, 0.98], rd: [0, -1, 0.3], rt: [0, 0.3, 1], re: [0.4, -1, 0], cp: 0.2, flz: 0.22, frz: -0.1 },
    { t: 0.8, cy: 0.1, rh: [0.15, -0.15, 0.85], rd: [0, -1, 0.3], rt: [0, 0.3, 1], cp: 0.15, flz: 0.2 },
    { t: 1 },
  ],
  // knuckle (d) and thumb/blade (t) directions are authored perpendicular: the blade follows the
  // thumb, and a thumb nearly parallel to the knuckles would be flipped by orthogonalisation
  overhead: [
    { t: 0 },
    // wind-up: fists above the head, wrists cocked, blade raised behind the head pointing back-down
    { t: 0.4, cp: -0.22, sp: -0.06, rh: [0.1, 0.92, -0.22], rd: [0, 0.85, -0.5], rt: [0, -0.5, -0.85], re: [0.7, 0.3, -0.5], lh: [-0.02, 0.9, -0.2], ld: [0, 0.85, -0.5], lt: [0, -0.5, -0.85], le: [0.7, 0.3, -0.5], np: -0.1 },
    // chop: blade sweeping forward over the top
    { t: 0.58, cp: 0.4, sp: 0.15, rh: [0.05, -0.3, 0.82], rd: [0, -0.55, 0.84], rt: [0, 0.84, 0.55], re: [0.5, -1, 0], lh: [-0.05, -0.33, 0.8], ld: [0, -0.55, 0.84], lt: [0, 0.84, 0.55], le: [0.5, -1, 0], py: -0.08, flz: 0.15 },
    // follow-through: blade level, pointing at the target
    { t: 0.8, cp: 0.35, sp: 0.1, rh: [0.05, -0.45, 0.65], rd: [0, -0.9, 0.44], rt: [0, 0.44, 0.9], lh: [-0.05, -0.47, 0.63], ld: [0, -0.9, 0.44], lt: [0, 0.44, 0.9], py: -0.06, flz: 0.15 },
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
    { t: 0.45, cp: -0.25, rh: [0.3, 0.85, 0.0], lh: [0.3, 0.85, 0.0], rd: [0, 1, 0], ld: [0, 1, 0], rt: [0, -0.1, -1], lt: [0, -0.1, -1], re: [1, 0, -0.5], le: [1, 0, -0.5], py: 0.02 },
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

/**
 * Which hands' frames (knuckle and thumb directions) an attack's keys steer. The keys were authored against the neutral hand (a key
 * that gives no thumb gets the neutral one): the overlay reads them that way and turns the hand to them from what the pose has it doing
 * (a carry, a run's fist) and back. A hand the keys leave alone keeps that through the attack: a shield stays on the forearm while the
 * sword swings.
 */
const OWNS = {} as Record<AttackAnim, { l: boolean; r: boolean }>;
for (const k of Object.keys(ATTACKS) as AttackAnim[]) OWNS[k] = { l: ATTACKS[k].some((key) => !!(key.ld || key.lt)), r: ATTACKS[k].some((key) => !!(key.rd || key.rt)) };
export const attackOwns = (kind: AttackAnim): { l: boolean; r: boolean } => OWNS[kind] ?? { l: false, r: false };

const _pa = new Float64Array(6), _pb = new Float64Array(6), _pk = new Float64Array(6), _sd = new Float64Array(3);
/** o[off..off+2] = v turned about the unit axis a by `ang` (Rodrigues) */
function turnAbout(o: Float64Array, off: number, vx: number, vy: number, vz: number, ax: number, ay: number, az: number, ang: number) {
  const c = Math.cos(ang), sn = Math.sin(ang), k = (ax * vx + ay * vy + az * vz) * (1 - c);
  o[off] = vx * c + (ay * vz - az * vy) * sn + ax * k;
  o[off + 1] = vy * c + (az * vx - ax * vz) * sn + ay * k;
  o[off + 2] = vz * c + (ax * vy - ay * vx) * sn + az * k;
}
/** the orthonormal pair [d, t] a key authors for a hand (key coordinates: x outward), the neutral hand for what the key leaves out */
function keyPair(o: Float64Array, key: Key, kd: 'rd' | 'ld', kt: 'rt' | 'lt') {
  const d = key[kd], t = key[kt];
  orthoPair(o, d ? d[0] : 0.12, d ? d[1] : -1, d ? d[2] : 0.12, t ? t[0] : -0.15, t ? t[1] : 0.05, t ? t[2] : 1);
}
/**
 * The hand pair between two orthonormal pairs a = [d, t] and b at f. Consecutive keys are authored 120-180 deg apart in most attacks,
 * and a straight blend of two such pairs passes through "thumb along the knuckles": the thumb the solver reads flips by up to 180 deg
 * in a frame. Here the thumb (the blade's axis, what the eye follows) swings along the shortest arc from a's to b's, the knuckles go
 * with that swing and then turn the rest of the way about the thumb (the twist, the short way): a continuous rotation that passes
 * through the keys' own frames (f = 0 and 1) exactly. o = [d, t].
 */
function swingTwist(o: Float64Array, a: Float64Array, b: Float64Array, f: number) {
  // the swing: a.t -> b.t about a.t x b.t (about a's knuckles when they are opposite)
  let ax = a[4] * b[5] - a[5] * b[4], ay = a[5] * b[3] - a[3] * b[5], az = a[3] * b[4] - a[4] * b[3];
  const sin = Math.hypot(ax, ay, az), cos = a[3] * b[3] + a[4] * b[4] + a[5] * b[5];
  let ang = Math.atan2(sin, cos);
  if (sin < 1e-6) {
    if (cos > 0) { ang = 0; ax = 1; ay = az = 0; } else { ax = a[0]; ay = a[1]; az = a[2]; }
  } else { ax /= sin; ay /= sin; az /= sin; }
  // the twist: how far the swung knuckles still are from b's, about b's thumb
  turnAbout(_sd, 0, a[0], a[1], a[2], ax, ay, az, ang);
  const px = _sd[0], py = _sd[1], pz = _sd[2];
  const cx = py * b[2] - pz * b[1], cy = pz * b[0] - px * b[2], cz = px * b[1] - py * b[0]; // p x b.d
  const twist = Math.atan2(cx * b[3] + cy * b[4] + cz * b[5], px * b[0] + py * b[1] + pz * b[2]);
  // at f: swung part of the way, then twisted part of the way about the swung thumb
  turnAbout(o, 3, a[3], a[4], a[5], ax, ay, az, f * ang);
  turnAbout(_sd, 0, a[0], a[1], a[2], ax, ay, az, f * ang);
  turnAbout(o, 0, _sd[0], _sd[1], _sd[2], o[3], o[4], o[5], f * twist);
}

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

/**
 * Blend an attack (layered over the base pose: upper body + optional foot shifts). The hands the keys steer (`attackOwns`) get their
 * frame from the keys (swing and twist between them, read against the neutral hand the keys were authored for) and turn to it from
 * whatever the pose has them doing, a carried blade or a run's fist, and back, by the envelope; a hand the keys leave alone keeps what
 * the pose has it doing (a shield stays on the forearm while the sword swings).
 */
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
  const vec = (k: 'rh' | 're' | 'lh' | 'le', d0: number, d1: number, d2: number): [number, number, number] => {
    const va = a[k], vb = b[k];
    const o = _vecOut;
    o[0] = va ? va[0] : d0; o[1] = va ? va[1] : d1; o[2] = va ? va[2] : d2;
    const e0 = vb ? vb[0] : d0, e1 = vb ? vb[1] : d1, e2 = vb ? vb[2] : d2;
    o[0] += (e0 - o[0]) * f; o[1] += (e1 - o[1]) * f; o[2] += (e2 - o[2]) * f;
    return o;
  };
  const blend = (idx: number, v: number) => (p[idx] += (v - p[idx]) * w);
  const add = (idx: number, v: number) => (p[idx] += v * w);
  // the steered hand's frame (key coordinates: x outward, so the right hand's x is turned round), by the envelope even in the spin
  // finisher, whose other channels hold their keys from the first instant: a hand must not jump from its carry there
  const own = OWNS[kind];
  const wd = envelope(t, 0.12, 0.25);
  const turnTo = (kd: 'rd' | 'ld', kt: 'rt' | 'lt', dd: number, tt: number, sx: number) => {
    keyPair(_pa, a, kd, kt);
    keyPair(_pb, b, kd, kt);
    swingTwist(_pk, _pa, _pb, f);
    turnHand(p, dd, tt, sx * _pk[0], _pk[1], _pk[2], sx * _pk[3], _pk[4], _pk[5], wd, sx);
  };
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
    v = vec('re', -base[F.erx], base[F.ery], base[F.erz]);
    blend(F.erx, -v[0]); blend(F.ery, v[1]); blend(F.erz, v[2]);
  }
  if (has('lh')) {
    let v = vec('lh', base[F.hlx], base[F.hly], base[F.hlz]);
    blend(F.hlx, v[0]); blend(F.hly, v[1]); blend(F.hlz, v[2]);
    v = vec('le', base[F.elx], base[F.ely], base[F.elz]);
    blend(F.elx, v[0]); blend(F.ely, v[1]); blend(F.elz, v[2]);
  }
  // the steered hands' frames over the whole attack, also where the keys give the hand no position (a hand must not drop out of its turn)
  if (own.r) turnTo('rd', 'rt', F.hrdx, F.hrtx, -1);
  if (own.l) turnTo('ld', 'lt', F.hldx, F.hltx, 1);
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
