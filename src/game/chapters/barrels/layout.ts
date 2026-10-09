/**
 * The Barrel Escape: the whole map in one table.
 *
 * The Forest River gorge is one centre-line spline (`riverPath`). Everything else (banks, the
 * water-gate, the bank run, the barrel train, ambushes, the log bridge, the pool) is placed in RIVER
 * COORDINATES: `s` = metres downstream along the spline, `l` = lateral metres from the centre line
 * (+ = right of the direction of travel, - = left). `riverPos()` turns those into world points.
 *
 * World axes: +Y up, the river flows toward +Z overall (with a long S-bend), the water falls about
 * 13 m over its 813 m. Facing downstream, the LEFT bank is the walkable one (the bank run), the RIGHT
 * bank is the cliffy one with the archers' ledges.
 */
import * as THREE from 'three';
import { Path } from '../../../world';
import { clamp, lerp, smoothstep } from '../../../core/math';

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** river centre line control points (x, water y, z) */
export const RIVER_PTS: [number, number, number][] = [
  [22, 13.4, -26], [22, 13.2, 20], [22, 13.0, 52], [21, 12.4, 105], [8, 11.2, 160], [-30, 9.8, 208],
  [-78, 8.2, 252], [-112, 6.6, 306], [-104, 5.4, 362], [-62, 4.4, 408], [-8, 3.7, 446], [48, 3.0, 486],
  [96, 2.2, 534], [116, 1.4, 585], [110, 0.7, 640],
];

/** fine path: ride physics, positions, tangents (step 1 m) */
export const riverPath = new Path(RIVER_PTS, { step: 1 });
/** coarse path for terrain generation (nearest() is a linear scan) */
export const terrainPath = new Path(RIVER_PTS, { step: 3 });
export const RIVER_LEN = riverPath.length;

/** terrain extent */
// (reaches well past the river's end at z=640: the shingle bank must not sit on the terrain's edge)
export const TERRAIN = { size: 780, segments: 276, center: [0, 336] as [number, number] };

/** landmarks, metres downstream */
export const S = {
  /** dammed pool, the Elvenking's cellar outlet at the upstream end */
  poolStart: 0,
  /** the water-gate */
  gate: 76,
  /** foot of the gate stairs: the bank run begins here */
  runStart: 92,
  /** the bank run ends at the launch rock */
  runEnd: 236,
  /** first rapids */
  rapids1: 168,
  /** the log bridge */
  log: 440,
  /** calm pool and shingle bank */
  pool: 706,
  end: RIVER_LEN - 4,
};

/** water-surface widths (m) at (s, width) anchors; the gate opening is 8 m */
const WIDTH: [number, number][] = [
  [0, 17], [34, 18], [62, 11], [76, 8], [92, 9], [112, 13], [170, 15], [230, 13], [300, 12.5], [372, 14],
  [405, 11.5], [430, 9.5], [470, 10], [500, 13], [560, 12], [640, 15], [700, 22], [740, 32], [813, 38],
];

export function widthAt(s: number): number {
  if (s <= WIDTH[0][0]) return WIDTH[0][1];
  for (let i = 1; i < WIDTH.length; i++) {
    if (s <= WIDTH[i][0]) {
      const [s0, w0] = WIDTH[i - 1];
      const [s1, w1] = WIDTH[i];
      return lerp(w0, w1, smoothstep(s0, s1, s));
    }
  }
  return WIDTH[WIDTH.length - 1][1];
}

/** how fast the water (and the barrels) run, m/s, along the course */
const SPEED: [number, number][] = [
  [0, 3], [76, 5], [100, 6.5], [168, 7.2], [200, 7.4], [330, 8.0], [380, 8.4], [410, 7.2], [440, 6.2], [520, 6.4], [560, 7.5],
  [650, 8.0], [690, 7.2], [720, 5.6], [770, 3.8], [813, 1.4],
];

export function flowSpeedAt(s: number): number {
  if (s <= SPEED[0][0]) return SPEED[0][1];
  for (let i = 1; i < SPEED.length; i++) {
    if (s <= SPEED[i][0]) {
      const [s0, v0] = SPEED[i - 1];
      const [s1, v1] = SPEED[i];
      return lerp(v0, v1, smoothstep(s0, s1, s));
    }
  }
  return SPEED[SPEED.length - 1][1];
}

/** water level at s */
const _wp = new THREE.Vector3();
export function waterY(s: number): number {
  return riverPath.at(s, _wp).y;
}

/** unit tangent (XZ) at s */
const _tt = new THREE.Vector3();
export function tangentAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
  riverPath.tangent(s, _tt);
  return out.set(_tt.x, 0, _tt.z).normalize();
}

/** yaw of the flow at s (0 = +Z) */
export function flowYaw(s: number): number {
  riverPath.tangent(s, _tt);
  return Math.atan2(_tt.x, _tt.z);
}

const _rp = new THREE.Vector3();
const _rt = new THREE.Vector3();
/** world point at river coordinates (s, l); y is the WATER level there plus `dy` */
export function riverPos(s: number, l: number, dy = 0, out = new THREE.Vector3()): THREE.Vector3 {
  riverPath.at(clamp(s, 0, RIVER_LEN), _rp);
  riverPath.tangent(clamp(s, 0, RIVER_LEN), _rt);
  const tl = Math.hypot(_rt.x, _rt.z) || 1;
  // right of travel = (-t.z, t.x)
  return out.set(_rp.x - (_rt.z / tl) * l, _rp.y + dy, _rp.z + (_rt.x / tl) * l);
}

/** the left bank: walkable shelf, `e` metres from the waterline (0 = water's edge) */
export function bankPos(s: number, e: number, out = new THREE.Vector3()): THREE.Vector3 {
  return riverPos(s, -(widthAt(s) / 2 + e), 0, out);
}

/** the shelf the bank run follows, e = distance from the water's edge */
export const RUN_OFFSET = 4.4;

/** side-stream clefts cut across the left shelf: the run has to jump them (s positions) */
export const CLEFTS = [124, 166, 207];
export const CLEFT_WIDTH = 4.0;

/** left shelf width (m) at s */
export function shelfLeft(s: number): number {
  const w = (a: number, b: number, v: number) => smoothstep(a, b, v);
  let sw = 0;
  // below the gate the shelf opens into a landing, then a long run
  sw += 9.5 * w(62, 82, s) * (1 - w(240, 262, s));
  sw += 3.6 * w(236, 262, s) * (1 - w(400, 412, s));
  sw += 1.0 * w(400, 412, s) * (1 - w(470, 490, s));
  sw += 4.4 * w(470, 492, s) * (1 - w(690, 712, s));
  // the shingle bank in the pool
  sw += 34 * w(700, 770, s);
  // gentle waviness
  return sw * (0.86 + 0.14 * Math.sin(s * 0.09 + 1.3));
}

/** right shelf width (m) at s: ledges for the archers at the ambush spots */
export const LEDGES_RIGHT = [96, 190, 268, 352, 392, 520, 592, 668];
export function shelfRight(s: number): number {
  let sw = 1.6 + 1.0 * Math.sin(s * 0.06);
  for (const c of LEDGES_RIGHT) sw += 6.5 * (1 - smoothstep(6, 17, Math.abs(s - c)));
  sw *= 1 - smoothstep(698, 740, s) * 0.2;
  return sw * (1 - smoothstep(420, 436, s) * (1 - smoothstep(470, 482, s)) * 0.7);
}

/** where the barrel train sits when the chapter begins (the head of the convoy, in the pool) */
export const TRAIN_START_S = 62;

// ─────────────────────────────────────────────────────────────────────────────
// River obstacles
// ─────────────────────────────────────────────────────────────────────────────

export interface RiverRock {
  s: number;
  /** lateral offset from the centre line (+ = right) */
  l: number;
  /** radius (m) */
  r: number;
}

/** deterministic scatter of boulders standing in the rapids (barrels steer around them) */
function makeRiverRocks(): RiverRock[] {
  // tiny local LCG so the layout is identical on every load without touching the level RNG
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: RiverRock[] = [];
  const zones: [number, number, number][] = [[176, 424, 15], [492, 700, 15]];
  for (const [a, b, gap] of zones) {
    for (let s = a; s < b; s += gap * (0.7 + rnd() * 0.7)) {
      // keep the log-bridge reach and the cliff chute clean
      const hw = widthAt(s) / 2;
      const r = 0.7 + rnd() * 1.15;
      const l = (rnd() * 2 - 1) * Math.max(0.5, hw - r - 1.6);
      out.push({ s, l, r });
      // now and then a second one, on the other side, so the line is a slalom rather than a wall
      if (rnd() < 0.35) out.push({ s: s + 4 + rnd() * 4, l: -Math.sign(l || 1) * (0.4 + rnd() * 0.5) * Math.max(0.5, hw - 2.2), r: 0.6 + rnd() * 0.8 });
    }
  }
  return out;
}
export const RIVER_ROCKS: RiverRock[] = makeRiverRocks();

/** low floating logs across the water: the rider must be airborne when his barrel crosses */
export const LOW_LOGS: { s: number }[] = [{ s: 356 }, { s: 586 }];
