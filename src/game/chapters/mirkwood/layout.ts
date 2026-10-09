/**
 * Mirkwood layout: every coordinate the world, the script, start(cp) and botHint() share.
 *
 * World axes: +Y up. The chapter runs north along +Z down a dark forest valley:
 *   C1  the Web Clearing (cp0)      Legolas drops in from a branch at the south edge
 *   C2  the Larder (cp1)            four cocooned dwarves hang low between the oaks
 *   C3  the Hollow's mouth (cp2)    the Brood Mother's arena under a canopy of web
 *   HOLLOW                          the dark web-choked hollow at the far north end
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const C1 = V(0, 0, 0);
export const C2 = V(5, 0, 37);
export const C3 = V(0, 0, 74);
export const HOLLOW = V(0, 0, 97);

/** the valley's centre line wanders a little */
export const centerX = (z: number): number => Math.sin(z * 0.035) * 4;

/** play areas: [x, z, radius] (flattened, kept clear of trunks, rocks and ferns) */
export const CLEARINGS: [number, number, number][] = [
  [C1.x, C1.z, 13],
  [C2.x, C2.z, 12],
  [C3.x, C3.z, 15],
  [2, 19, 7], // the path C1 → C2
  [1, 56, 7], // the path C2 → C3
];

export function inClearing(x: number, z: number, pad = 0): boolean {
  for (const [cx, cz, r] of CLEARINGS) if (Math.hypot(x - cx, z - cz) < r + pad) return true;
  return false;
}

/** forest-floor height: undulating, a valley between banks, flattened play areas, the hollow behind */
export function heightAt(x: number, z: number): number {
  let h = fbm2(x * 0.022, z * 0.022, 4, 7) * 2.4 + Math.sin(x * 0.09 + z * 0.05) * 0.35 + fbm2(x * 0.11, z * 0.11, 2, 3) * 0.25;
  // flatten the play areas toward a gentle bowl
  let flat = 0;
  for (const [cx, cz, r] of CLEARINGS) flat = Math.max(flat, 1 - smoothstep(r * 0.55, r * 1.35, Math.hypot(x - cx, z - cz)));
  h *= 1 - flat * 0.8;
  // valley banks
  const d = Math.abs(x - centerX(z));
  h += smoothstep(24, 46, d) * 10 + smoothstep(46, 90, d) * 8;
  // the hollow: ground rises behind it, the south end closes too
  h += smoothstep(98, 124, z) * 14;
  h += smoothstep(-24, -50, z) * 11;
  return h;
}

export interface HeroDef {
  x: number;
  z: number;
  scale: number;
  seed: number;
  rot: number;
}

/** colossal hand-placed oaks (trunks 3–6 m across) ringing the play areas: spiders climb these */
export const HEROES: HeroDef[] = [
  // the Web Clearing
  { x: -18, z: -7, scale: 1.08, seed: 0, rot: 0.3 }, // 0
  { x: 17, z: -10, scale: 1.0, seed: 1, rot: 1.9 }, // 1
  { x: -17, z: 12, scale: 1.12, seed: 2, rot: 4.1 }, // 2
  { x: 19, z: 11, scale: 1.05, seed: 3, rot: 2.6 }, // 3
  { x: -4, z: -20, scale: 1.1, seed: 1, rot: 5.2 }, // 4 the branch Legolas drops from
  // the Larder
  { x: -10, z: 32, scale: 1.0, seed: 0, rot: 2.2 }, // 5
  { x: 21, z: 31, scale: 1.1, seed: 2, rot: 0.9 }, // 6
  { x: -7, z: 50, scale: 1.06, seed: 3, rot: 3.3 }, // 7
  { x: 19, z: 48, scale: 1.0, seed: 1, rot: 5.9 }, // 8
  // the Hollow's mouth (the canopy web hangs between 9..12)
  { x: -18, z: 66, scale: 1.12, seed: 2, rot: 1.2 }, // 9
  { x: 18, z: 64, scale: 1.1, seed: 0, rot: 4.4 }, // 10
  { x: -13, z: 92, scale: 1.18, seed: 3, rot: 0.2 }, // 11
  { x: 13, z: 94, scale: 1.16, seed: 1, rot: 2.9 }, // 12
];

/** silk lines strung between trunks [heroA, heroB, height above ground at A, height at B] */
export const LINES: [number, number, number, number][] = [
  [0, 2, 13, 12], // C1 west
  [1, 3, 12.5, 13.5], // C1 east
  [2, 3, 14, 13], // C1 north (over the path)
  [5, 6, 11.5, 12], // Larder south
  [7, 8, 12, 12.5], // Larder north
  [5, 7, 10.5, 11], // Larder west
  [9, 11, 13, 12], // arena west
  [10, 12, 13, 12.5], // arena east
];

/** decorative cocoons: [line, t along it, hang drop below the line (m)] */
export const DECOR_COCOONS: [number, number, number][] = [
  [0, 0.28, 4.2], [0, 0.55, 6.5], [0, 0.8, 3.6],
  [1, 0.35, 5.5], [1, 0.68, 3.4],
  [2, 0.22, 3.0], [2, 0.5, 6.0], [2, 0.78, 4.4],
  [5, 0.25, 3.5],
  [6, 0.3, 5.0], [6, 0.7, 4.0],
  [7, 0.5, 6.2],
];

/** the four cocoons to cut (Larder): [line, t]. They hang with their feet ~0.35 m off the ground. */
export const CUT_COCOONS: [number, number][] = [
  [3, 0.36],
  [3, 0.66],
  [4, 0.42],
  [5, 0.55],
];

/** spiders drop on silk from these canopy points (x, z), around each play area */
export const DROPS: Record<'c1' | 'c2' | 'c3', [number, number][]> = {
  c1: [[-7, 6], [6, 7], [8, -4], [-8, -3], [0, 10], [-3, -8], [10, 2], [-10, 3]],
  c2: [[0, 30], [12, 33], [9, 44], [-1, 42], [5, 47], [14, 40], [-3, 35]],
  c3: [[-8, 70], [8, 68], [-5, 82], [6, 82], [0, 64], [11, 76], [-11, 77]],
};

/** heroes the spiders crawl down, per play area */
export const CLIMBERS: Record<'c1' | 'c2' | 'c3', number[]> = {
  c1: [0, 1, 2, 3],
  c2: [5, 6, 7, 8],
  c3: [9, 10, 11, 12],
};

/** the canopy web over the arena: its 4 corners are on heroes 9, 10, 12, 11 (clockwise from above) */
export const CANOPY = { heroes: [9, 10, 12, 11], height: 12, anchors: [9, 10, 12] };

/** where Legolas drops in (cp0): the branch end and the landing */
export const BRANCH = { from: V(-2.5, 7.2, -13), to: V(-1.2, 0, -9) };

/** start points per checkpoint */
export const STARTS = [
  { pos: V(-1.2, 0, -9), facing: 0.1 },
  { pos: V(3, 0, 25), facing: 0.15 },
  { pos: V(1, 0, 58), facing: 0 },
];

export const TAURIEL_ENTRY = V(26, 0, 40);
/** where Tauriel holds in the larder (its east side, clear of the cocoons and of the player camera) */
export const TAURIEL_STAND = V(14, 0, 38);
export const BROOD_EMERGE = V(0, 0, 95);
