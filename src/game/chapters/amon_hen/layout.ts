/**
 * Amon Hen layout: every coordinate the world builder, the script, start(cp) and botHint() share,
 * and the terrain height function.
 *
 * Geography (metres, +Y up, +Z = uphill / north). The film's Amon Hen is the wooded hill on the
 * west bank of the Anduin, with the Seat of Seeing on its summit.
 *
 *   z  172 ........ the Seat of Seeing on the summit plateau (y 34), a ring of broken columns
 *   z  140 ........ the plateau edge; the ruined stairs climb to it from the terrace
 *   z   66 ........ the RUINS terrace (y ~20): wall stubs, columns, a toppled statue, broken stairs
 *   z  -45 .. 44 .. the WOODS: the ascent, tall beech and birch in golden haze
 *   z  -76 ........ the CLEARING by the stream where Lurtz waits (y ~2), Boromir's tree
 *   z -100 ........ the stream, running west -> east along the foot of the hill
 *
 * The sun sits low in the west-south-west, so the long shadows fall to the east.
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { clamp, lerp, smoothstep } from '../../../core/math';
import { Path, carveRiver } from '../../../world';

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export const CHECKPOINTS = ['The Woods', 'The Ruins', 'Lurtz'];

/** monotone cubic interpolation through control points (Fritsch-Carlson): no overshoot, C1 */
function monotone(pts: [number, number][]): (x: number) => number {
  const n = pts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0];
    const t = (x - pts[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[i][1] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * pts[i + 1][1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/** the hill's long profile, south (stream) to north (summit plateau) */
const profile = monotone([
  [-160, 5.5], [-135, 2.4], [-112, 0.9], [-100, 0.6], [-88, 1.2], [-62, 3.3], [-22, 8.2], [20, 14.0], [60, 20.2], [100, 26.6], [124, 31.0], [144, 33.8], [166, 34], [260, 34],
]);

export const SUMMIT_Y = 34;
export const SEAT = { x: 0, z: 172, y: SUMMIT_Y };
/** the ruined terrace the second beat is fought on */
export const RUINS = { x: 2, z: 66, r: 27, y: profile(66) };
/** the clearing by the stream: Lurtz's ground */
export const CLEARING = { x: -14, z: -74, r: 22, y: profile(-74) + 0.05 };

/** the stream's centre line z at x, its water level and width */
export const streamZ = (x: number): number => -101 + 6.0 * Math.sin(x * 0.035 + 0.5) + 2.4 * Math.sin(x * 0.09 + 1.0);
export const streamY = (x: number): number => 0.35 - x * 0.0055;
export const STREAM_W = 7.5;
export const STREAM_PTS: [number, number, number][] = [];
for (let x = -180; x <= 180; x += 12) STREAM_PTS.push([x, streamY(x), streamZ(x)]);

/** terrain before the stairs' lanes and the stream are applied */
function hillNoLane(x: number, z: number): number {
  let h = profile(z);
  // the banks follow the stream's own gradient so the water never floats or sinks
  const sz = streamZ(x);
  const w = 1 - smoothstep(8, 46, Math.abs(z - sz));
  h += (streamY(x) + 0.55 - profile(sz)) * w;
  // valley walls: the hill closes in east and west so the woods feel enclosed
  const ax = Math.abs(x);
  const wall = Math.max(0, ax - 84) * Math.max(0, ax - 84) * 0.013 + Math.max(0, ax - 126) * 0.35;
  h += wall * (1 + fbm2(x * 0.045, z * 0.045, 3, 21) * 0.9);
  // rolling ground
  const rough = smoothstep(-100, -70, z) * (1 - smoothstep(130, 150, z));
  h += (fbm2(x * 0.013, z * 0.013, 3, 11) * 4.6 + fbm2(x * 0.055, z * 0.055, 2, 12) * 1.1) * rough;
  // level the ruins terrace and the clearing
  const dr = Math.hypot((x - RUINS.x) * 0.9, z - RUINS.z);
  h = lerp(RUINS.y + fbm2(x * 0.1, z * 0.1, 2, 31) * 0.18, h, smoothstep(RUINS.r, RUINS.r + 18, dr));
  const dc = Math.hypot(x - CLEARING.x, (z - CLEARING.z) * 0.9);
  h = lerp(CLEARING.y + fbm2(x * 0.12, z * 0.12, 2, 32) * 0.12, h, smoothstep(CLEARING.r, CLEARING.r + 16, dc));
  // the summit plateau stays dead flat under the Seat
  const dsp = Math.hypot(x - SEAT.x, (z - SEAT.z) * 0.8);
  h = lerp(SUMMIT_Y, h, smoothstep(34, 58, dsp));
  return h;
}

/**
 * Broken flights of stairs set into the hill: the great stair above the terrace and two on the way up.
 * The terrain follows each flight's slope across its width, so the treads sit flush.
 */
export interface Flight {
  from: [number, number];
  to: [number, number];
  width: number;
  /** ground height at both ends (filled in below) */
  y0: number;
  y1: number;
}
const flight = (from: [number, number], to: [number, number], width: number): Flight => ({
  from, to, width, y0: hillNoLane(from[0], from[1]), y1: hillNoLane(to[0], to[1]),
});
export const FLIGHTS: Flight[] = [flight([2, 90], [2, 124], 7.2), flight([8, -22], [13, -7], 4.6), flight([-9, 22], [-6, 37], 4.6)];

function hillBase(x: number, z: number): number {
  let h = hillNoLane(x, z);
  for (const f of FLIGHTS) {
    const dx = f.to[0] - f.from[0];
    const dz = f.to[1] - f.from[1];
    const l2 = dx * dx + dz * dz;
    const t = clamp(((x - f.from[0]) * dx + (z - f.from[1]) * dz) / l2, 0, 1);
    const d = Math.hypot(x - (f.from[0] + dx * t), z - (f.from[1] + dz * t));
    if (d > f.width / 2 + 3.2) continue;
    h = lerp(lerp(f.y0, f.y1, t), h, smoothstep(f.width / 2 - 0.2, f.width / 2 + 3.2, d));
  }
  return h;
}

/** the final ground height function: terrain with the stream carved in */
export const ground: (x: number, z: number) => number = carveRiver(hillBase, STREAM_PTS, STREAM_W, { depth: 0.75, bank: 4.5 });

// ─────────────────────────────────────────────────────────────────────────────
// routes and spots
// ─────────────────────────────────────────────────────────────────────────────

/** the climb through the woods (beat 1): from the foot of the wood to the ruins */
export const ASCENT: THREE.Vector3[] = [V(-6, 0, -48), V(8, 0, -26), V(14, 0, -6), V(2, 0, 12), V(-10, 0, 28), V(-4, 0, 44), V(2, 0, 56)];
/** the run back down to the stream (beat 3), through the east woods */
export const DESCENT: THREE.Vector3[] = [V(12, 0, 46), V(26, 0, 24), V(30, 0, 0), V(20, 0, -24), V(4, 0, -44), V(-8, 0, -56)];

/** the routes as smooth paths: the bot (and the script) look ahead along them */
export const ASCENT_PATH = new Path(ASCENT, { step: 1 });
export const DESCENT_PATH = new Path(DESCENT, { step: 1 });

export const L = {
  /** cp0: Legolas at the foot of the wood */
  spawn: V(-6, 0, -50),
  /** cp1: the gate of the ruins; the bot holds the middle of the terrace */
  ruinsGate: V(0, 0, 50),
  ruinsHold: V(2, 0, 62),
  /** cp2: where the run to the clearing begins */
  descentStart: V(10, 0, 46),
  /** the clearing: where the path enters, Lurtz's mark, Boromir's tree, the bot's hold */
  clearingEntry: V(-8, 0, -56),
  lurtzMark: V(-6, 0, -80),
  boromirTree: V(-24, 0, -90.4),
  /** where Boromir kneels, a little out from his tree, facing Lurtz */
  boromir: V(-22, 0, -92),
  clearingHold: V(-10, 0, -70),
  /** the Seat of Seeing, for the intro shot */
  seat: V(SEAT.x, SEAT.y, SEAT.z),
};

/** all waypoints as flat segments for "near a route" tests (trees keep clear of them) */
const ROUTES: THREE.Vector3[][] = [ASCENT, DESCENT];

function distToSeg(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

/** within `r` metres of a walking route */
export function nearRoute(x: number, z: number, r: number): boolean {
  for (const route of ROUTES) for (let i = 0; i < route.length - 1; i++) if (distToSeg(x, z, route[i], route[i + 1]) < r) return true;
  return false;
}

/** distance from the stream's centre line (z only: the stream runs west-east) */
export const streamDist = (x: number, z: number): number => Math.abs(z - streamZ(x));
export const inClearing = (x: number, z: number, pad = 0): boolean => Math.hypot(x - CLEARING.x, (z - CLEARING.z) * 0.9) < CLEARING.r + pad;
export const inRuins = (x: number, z: number, pad = 0): boolean => Math.hypot((x - RUINS.x) * 0.9, z - RUINS.z) < RUINS.r + pad;
