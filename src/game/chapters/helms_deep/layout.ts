/**
 * Helm's Deep layout: every coordinate the world, the script, start(cp) and botHint() share.
 *
 * World frame = the helmsDeep() builder's local frame (its object sits at the origin):
 *   - the Deeping Wall runs along x (left end x = -60 at the cliff, right end x = 62 at the Hornburg),
 *   - the enemy (the Deeping Coomb) is at +z, the fortress court at -z,
 *   - y = 0 is the ground at the foot of the wall, the walkway is at y = 14.
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { Path } from '../../../world';
import type { PathPoint } from '../../../world';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const WALL_H = 14;
export const WALL_T = 5;

/** the same control points the helmsDeep() builder uses (wall A = left, B = culvert section, C = right) */
export const WALL_A_PTS: PathPoint[] = [[-60, 0, 3], [-42, 0, 1], [-26, 0, -1], [-14, 0, -4], [-4, 0, -6]];
export const WALL_B_PTS: PathPoint[] = [[-4, 0, -6], [14, 0, -7]];
export const WALL_C_PTS: PathPoint[] = [[14, 0, -7], [32, 0, -8], [50, 0, -10], [62, 0, -12]];

const pathA = new Path(WALL_A_PTS, { smooth: true, step: 2.5 });
const pathB = new Path(WALL_B_PTS, { smooth: false, step: 1e9 });
const pathC = new Path(WALL_C_PTS, { smooth: true, step: 2.5 });

export interface WallPoint {
  /** walkway centre (y = WALL_H) */
  c: THREE.Vector3;
  /** outward unit normal (toward the coomb, +z-ish) */
  n: THREE.Vector3;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n2 = new THREE.Vector3();

/**
 * the wall walkway centre (y = WALL_H) and outward normal at a given x (anywhere from -59 to 61).
 * Pass `c` / `n` to write into your own vectors (no allocation, safe per frame).
 */
export function wallAt(x: number, c = new THREE.Vector3(), n = new THREE.Vector3()): WallPoint {
  const path = x < -4 ? pathA : x < 14 ? pathB : pathC;
  // the paths run toward +x: bisect on s for the point with this x
  let lo = 0;
  let hi = path.length;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    path.at(mid, _p);
    if (_p.x < x) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  path.at(s, _p);
  path.tangent(s, _t);
  // outward = right-hand normal of +x travel = (-tz, tx)
  n.set(-_t.z, 0, _t.x).normalize();
  if (n.z < 0) n.negate();
  c.set(_p.x, WALL_H, _p.z);
  return { c, n };
}

/** a point on the walkway at x, `inset` metres from the centre toward the outside (negative = inside) */
export function walk(x: number, inset = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const w = wallAt(x, out, _n2);
  return out.addScaledVector(w.n, inset);
}

/** height of the shield stair's ramp at z (bottom z -67.5 -> 0, top z -8.6 -> 14) */
export function stairY(z: number): number {
  return Math.max(0, Math.min(WALL_H, (WALL_H * (z + 67.5)) / 58.9));
}

/** the six siege-ladder points (x along the wall), clear of the projecting towers (x -42, -18, 30) */
export const LADDER_X = [-31, -24, -11, -1, 10, 21];
/** the ladders rise in two sets of three */
export const LADDER_SETS = [[1, 3, 4], [0, 2, 5]];

export const L = {
  /** cp0: Legolas on the wall above the coomb, between Gimli and Aragorn */
  spawn: walk(-16, -0.6),
  /** where the bot holds between ladders */
  wallHold: walk(-9, -0.5),
  /** cp1: watch spot on wall A, left of the culvert section that will blow */
  culvertWatch: walk(-13, 0.4),
  /** the culvert mouth (outer face of the middle wall, the ground) */
  culvert: V(5, 0, -2.2),
  /** the torch-runners start among the front ranks */
  runnerStarts: [V(-22, 0, 58), V(30, 0, 60), V(-4, 0, 64), V(6, 0, 70)],
  /** crossbowmen positions in the field */
  archerSpots: [V(-30, 0, 24), V(-12, 0, 28), V(18, 0, 26), V(34, 0, 22), V(4, 0, 32)],
  /** the shield stair: top on wall A (inside), bottom in the court */
  stairTop: V(-30, WALL_H, -8.6),
  stairBottom: V(-30, 0, -67.5),
  /** the shield lies at the head of the stair */
  shield: V(-30, WALL_H, -9.4),
  /** the Uruk the landing kills */
  landingUruk: V(-30, 0, -73.5),
  /** the flooded breach (inside the wall) */
  breachFight: V(4, 0, -17),
  breachGap: V(5, 0, -4),
  breachOutside: V(5, 0, 8),
  /** the Hornburg: gate on the causeway, the ramp foot in the court */
  gate: V(76, 5.8, -27.5),
  gateHold: V(78.9, 5.8, -31.5),
  aragornGate: V(73.1, 5.8, -32),
  gimliGate: V(78.7, 5.8, -36),
  causewayStart: V(76, 5.8, -66.5),
  rampFoot: V(76, 0, -93),
  courtRear: V(76, 0, -110),
  /** the Uruk host fills the coomb */
  armyCenter: V(4, 0, 100),
};

// ─────────────────────────────────────────────────────────────────────────────
// Terrain: the coomb floor is flat at the wall and in the court, rises gently out into the coomb,
// and is closed by the Deep's cliffs (left of the wall, behind the Hornburg, at the back of the Deep).
// ─────────────────────────────────────────────────────────────────────────────

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** left gorge side (x of the cliff toe) at z */
export function leftToe(z: number): number {
  if (z <= 8) return -63;
  const k = z - 8;
  return -63 - k * 0.42 - k * k * 0.00045 + fbm2(z * 0.015, 3.1, 3, 41) * 10 * smooth(8, 60, z);
}
/** right gorge side (x of the cliff toe) at z */
export function rightToe(z: number): number {
  if (z <= 0) return 97;
  return 97 + z * 0.36 + z * z * 0.0005 + fbm2(z * 0.015, 7.7, 3, 42) * 10 * smooth(0, 60, z);
}

function cliff(d: number, x: number, z: number, height: number, fall: number): number {
  if (d <= 0) return 0;
  const crag = Math.abs(fbm2(x * 0.045, z * 0.045, 3, 43)) * 9 + fbm2(x * 0.012, z * 0.012, 3, 44) * 22;
  return height * (1 - Math.exp(-d / fall)) + d * 0.3 + crag * smooth(0, 14, d);
}

export function terrainHeight(x: number, z: number): number {
  let h = 0;
  // the coomb rises gently away from the wall, with low folds and a few hummocks
  const field = smooth(10, 70, z);
  h += 18 * smooth(30, 420, z);
  h += (fbm2(x * 0.011, z * 0.011, 3, 45) * 3.4 + fbm2(x * 0.05, z * 0.05, 2, 46) * 0.6) * field;
  // a slight drainage dip running from the culvert out into the coomb
  h -= 0.8 * Math.exp(-((x - 5) * (x - 5)) / 60) * smooth(4, 20, z);
  // the gorge walls
  const dl = leftToe(z) - x;
  const dr = x - rightToe(z);
  const db = -128 - z;
  // the right side in front of the wall is the long slope the Rohirrim ride down at dawn
  const gentle = smooth(30, 110, z);
  h += cliff(dl, x, z, 110, 16);
  h += cliff(dr, x, z, 120 - gentle * 50, 16 + gentle * 40);
  h += cliff(db, x, z, 130, 18);
  return h;
}

/** points on the right-hand slope the Rohirrim charge down (x of the crowd centre at z) */
export function riderSlope(z: number, along: number): THREE.Vector3 {
  return V(rightToe(z) + along, 0, z);
}
