/**
 * Pelennor Fields: every coordinate the script, start(cp) and botHint() share.
 *
 * World axes: +X is east (toward the Anduin and the morning sun, where the host of Harad and Mordor
 * stands), -X is west (Minas Tirith on its hill ~1 km away), +Z south (the Harad road), -Z north
 * (where the Rohirrim rode in). The battle is fought around the origin.
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import { Path } from '../../../world';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const L = {
  /** cp0: Legolas, Gimli and Aragorn among the Rohirrim, facing east */
  spawn: V(-6, 0, 2),
  /** the bot and the player hold this ground during the field fight */
  fight: V(8, 0, 0),
  /** enemy companies arrive from here (35–50 m east/south-east of the fight) */
  waveE: [V(46, 0, -10), V(50, 0, 6), V(44, 0, 18)],
  waveSE: [V(32, 0, 38), V(18, 0, 44)],
  waveNE: [V(36, 0, -34)],
  /** cp1 start */
  cp1: V(-4, 0, -6),
  /** cp2 start */
  cp2: V(0, 0, -12),
  /** where the first mûmak lies in cp2 (if the chapter was resumed there) */
  deadMumak: V(-38, 0, 30),
  deadYaw: 2.2,
  /** Rohirrim on foot holding the line (anchors) */
  riders: [V(-2, 0, -9), V(-9, 0, 9), V(4, 0, 12), V(-12, 0, -3)],
  /** Minas Tirith, far to the west */
  city: V(-1080, 0, -140),
};

/** the battlefield heightfield: broad gentle swells, churned ruts and catapult craters, rising to the city */
const CRATERS: [number, number, number][] = [
  [-26, -40, 4.5], [34, 52, 5.5], [-58, 18, 4], [72, -46, 6], [10, -70, 3.5], [-90, -60, 5], [96, 30, 4.5], [-14, 64, 3.2],
];
export function pelennorHeight(x: number, z: number): number {
  let h = fbm2(x * 0.0035, z * 0.0035, 3, 21) * 5 + fbm2(x * 0.018, z * 0.018, 3, 22) * 0.9 + fbm2(x * 0.09, z * 0.09, 2, 23) * 0.12;
  // the main battleground is flatter (arrows and footing stay predictable)
  const d = Math.hypot(x - 10, z);
  h *= 1 - 0.7 * (1 - smoothstep(80, 220, d));
  // shallow ruts churned by hooves and wheels, running roughly east-west
  const rut = Math.sin(z * 0.21 + Math.sin(x * 0.03) * 2.2) * Math.sin(z * 0.047 + 1.1);
  h -= Math.max(0, rut - 0.55) * 0.5;
  // catapult-stone craters with a raised lip
  for (const [cx, cz, r] of CRATERS) {
    const q = ((x - cx) * (x - cx) + (z - cz) * (z - cz)) / (r * r);
    if (q < 4) h += -0.9 * Math.exp(-q * 1.6) + 0.25 * Math.exp(-Math.pow(q - 1.1, 2) * 3);
  }
  // the land rises toward the Rammas and the city in the west, and to the river downs in the east
  h += smoothstep(-260, -900, x) * 26 + smoothstep(420, 1100, x) * 30;
  return h;
}

/** cp0: the first mûmak tramples straight through the fight from the south-east (over L.fight),
 *  then joins its loop on the north-west */
export function tramplePath(): Path {
  return new Path([[150, 120], [92, 70], [48, 32], [20, 8], [-10, -12], [-44, -24], [-80, -46]], { step: 2 });
}

/** cp1: the first mûmak circles the battleground (clockwise seen from above, left flank inward) */
export function loopPath(cx = 6, cz = -6, rx = 62, rz = 46): Path {
  const pts: [number, number][] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = -(i / n) * Math.PI * 2; // decreasing angle: the left flank faces the centre
    pts.push([cx + Math.cos(a) * rx + Math.sin(a * 3) * 4, cz + Math.sin(a) * rz]);
  }
  return new Path(pts, { closed: true, step: 2 });
}

/** cp2: the second mûmak arrives from the east and circles closer in */
export function charge2Entry(): Path {
  return new Path([[175, -16], [125, -4], [90, 6], [66, 10]], { step: 2 });
}
export function charge2Loop(): Path {
  return loopPath(16, 2, 50, 38);
}

/** far mûmakil roaming with the hosts (big slow loops 250–500 m out) */
export const HERD: { cx: number; cz: number; rx: number; rz: number; phase: number; speed: number }[] = [
  { cx: 200, cz: 120, rx: 50, rz: 32, phase: 0.1, speed: 2.1 },
  { cx: 250, cz: -100, rx: 60, rz: 36, phase: 0.55, speed: 1.8 },
  { cx: 70, cz: 240, rx: 70, rz: 30, phase: 0.3, speed: 2.3 },
];

/**
 * Distance (m) from (x, z) to the nearest route any mûmak walks (cp0 trample, cp1 loop, cp2 entry and
 * loop). Wrecks, crates and rubble keep out of this corridor so the beasts never walk through them.
 */
export function beastCorridor(): (x: number, z: number) => number {
  const paths = [tramplePath(), loopPath(), charge2Entry(), charge2Loop()];
  return (x, z) => {
    let d = Infinity;
    for (const p of paths) d = Math.min(d, p.nearest(x, z).dist);
    return d;
  };
}
