/**
 * The Black Gate: coordinates, terrain height and the crowd table. One place for every number the
 * world, the script, start(cp) and botHint() have to agree on.
 *
 * Axes: the Morannon stands at the origin and faces +Z (its outside); Mordor lies to -Z. The Army
 * of the West holds two rocky hills about 180 m south of the gate, so Legolas looks NORTH (-Z, yaw
 * PI) at the towers, with Mount Doom burning on the right horizon and Barad-dur dead ahead.
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';
import type { HordeDef } from './horde';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** yaw that faces the gate (north, -Z) */
export const NORTH = Math.PI;

// ─────────────────────────────────────────────────────────────────────────────
// terrain
// ─────────────────────────────────────────────────────────────────────────────

interface Dome {
  x: number;
  z: number;
  r: number;
  h: number;
}
/** the two hills of the Army of the West */
export const HILL_W: Dome = { x: -37, z: 186, r: 54, h: 14 };
export const HILL_E: Dome = { x: 39, z: 172, r: 52, h: 12.5 };

function dome(x: number, z: number, d: Dome): number {
  const r = Math.hypot(x - d.x, z - d.z);
  if (r >= d.r) return 0;
  const s = 0.5 + 0.5 * Math.cos((Math.PI * r) / d.r);
  return d.h * Math.pow(s, 1.25);
}

/** where the last stand is held: the saddle between the two summits */
const FIGHT_X = 1;
const FIGHT_Z = 180;

const rawHeight = (x: number, z: number): number => {
  // gentle ash dunes and slag ridges
  let h = fbm2(x * 0.011, z * 0.011, 3, 41) * 3.2 + fbm2(x * 0.045, z * 0.045, 3, 42) * 0.9;
  // slag ridges: long low crests
  h += Math.abs(fbm2(x * 0.02 + 8, z * 0.02, 2, 43)) * 2.6;
  // flat apron in front of the Gate (the Morannon is built on a slab at y = 0)
  const apron = 1 - smoothstep(55, 150, Math.hypot(x * 0.6, z + 10));
  h *= 1 - apron * 0.85;
  // the hills, rocky and broken
  const hills = dome(x, z, HILL_W) + dome(x, z, HILL_E);
  const hillMask = smoothstep(0.5, 3, hills);
  h += hills + hillMask * (fbm2(x * 0.07, z * 0.07, 4, 44) * 3.0 + Math.abs(fbm2(x * 0.13, z * 0.13, 2, 45)) * 1.6);
  return h;
};

/** the saddle's height, kept level so the fight is on firm footing */
const FIGHT_Y = rawHeight(FIGHT_X, FIGHT_Z);

export function blackGateHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
  // a level plateau for the fight (blend out over 14 m)
  const d = Math.hypot((x - FIGHT_X) * 0.85, z - FIGHT_Z);
  const flat = 1 - smoothstep(15, 30, d);
  h += (FIGHT_Y - h) * flat;
  return h;
}

export const FIGHT = V(FIGHT_X, FIGHT_Y, FIGHT_Z);

// ─────────────────────────────────────────────────────────────────────────────
// layout
// ─────────────────────────────────────────────────────────────────────────────

export const L = {
  /** the gate leaves' pivot line */
  gate: V(0, 0, 0),
  /** Legolas starts here, Aragorn and Gimli beside him */
  spawn: V(FIGHT_X + 2, 0, FIGHT_Z + 7),
  fight: V(FIGHT_X, 0, FIGHT_Z),
  /** both summits, where the banners fly */
  summitW: V(HILL_W.x + 6, 0, HILL_W.z - 4),
  summitE: V(HILL_E.x - 6, 0, HILL_E.z - 2),
  aragorn: V(FIGHT_X + 7, 0, FIGHT_Z - 4),
  gimli: V(FIGHT_X - 6, 0, FIGHT_Z - 4),
  /** Gimli is pinned here, on the saddle's north rim */
  pin: V(-11, 0, 150),
  /** where the pinning troll walks in from */
  pinTroll: V(-32, 0, 100),
  /** the war trolls come out of the gate and wade south */
  trollA: V(-24, 0, 96),
  trollB: V(26, 0, 100),
  trollC: V(2, 0, 88),
  /** the allies' stands (Gondor and Rohan soldiers) */
  gondor: [V(-14, 0, 176), V(-10, 0, 184), V(16, 0, 174), V(12, 0, 186)],
  rohan: [V(0, 0, 166), V(-4, 0, 192), V(8, 0, 194)],
  /** enemy entry arcs (about 55 m out, inside the standing host) */
  arcN: [V(-30, 0, 124), V(-8, 0, 118), V(14, 0, 118), V(34, 0, 124)],
  arcNW: [V(-62, 0, 142), V(-78, 0, 164)],
  arcNE: [V(66, 0, 138), V(80, 0, 160)],
  arcW: [V(-98, 0, 186), V(-94, 0, 208)],
  arcE: [V(100, 0, 176), V(96, 0, 200)],
  arcS: [V(-30, 0, 244), V(0, 0, 250), V(30, 0, 244)],
  /** the shield-wall of archers keeps back here */
  archers: [V(-38, 0, 148), V(38, 0, 150), V(0, 0, 138)],
};

// ─────────────────────────────────────────────────────────────────────────────
// the hosts of Mordor (crowds). `end` = where the rank centre comes to rest.
// ─────────────────────────────────────────────────────────────────────────────

export interface HostDef {
  id: string;
  kind: 'orc' | 'easterling' | 'goblin';
  count: number;
  center: [number, number];
  half: [number, number];
  /** facing yaw; they march along it */
  facing: number;
  /** distance to march (m); 0 = standing from the start */
  march: number;
  /** seconds after the gate begins to open before the host starts to move */
  delay: number;
}

/**
 * The host stands massed on the plain before the Gate; when the leaves open it surges toward the
 * hills while a column pours out of the gate behind it, and the flank and rear hosts close the ring.
 * (A crowd's area is axis aligned and it marches along `facing`.) The three front hosts are thin on purpose:
 * they stand 80+ m out, where the silhouette hordes right behind them carry the mass at a fraction of the
 * triangles (a detailed figure is ~540 triangles, a horde figure 29). Rest positions are chosen so the
 * nearest figure stays at least ~52 m from the fight (crowds never mingle with the action).
 */
export const HOSTS: HostDef[] = [
  { id: 'colG', kind: 'orc', count: 44, center: [0, -42], half: [6.5, 14], facing: 0, march: 84, delay: 11 },
  { id: 'hostL', kind: 'orc', count: 56, center: [-76, 60], half: [26, 12], facing: 0.255, march: 42, delay: 4 },
  { id: 'hostM', kind: 'orc', count: 84, center: [0, 56], half: [30, 12], facing: 0, march: 40, delay: 3 },
  { id: 'hostR', kind: 'easterling', count: 56, center: [76, 60], half: [26, 12], facing: -0.255, march: 42, delay: 5 },
  { id: 'west', kind: 'orc', count: 96, center: [-210, 150], half: [13, 30], facing: 1.254, march: 128, delay: 6 },
  { id: 'east', kind: 'easterling', count: 96, center: [214, 152], half: [13, 30], facing: -1.31, march: 126, delay: 7 },
  { id: 'rear', kind: 'orc', count: 96, center: [0, 350], half: [44, 11], facing: Math.PI, march: 92, delay: 12 },
];

/** the far ranks: thousands of silhouette figures (see horde.ts), counts at High quality */
export const HORDES: HordeDef[] = [
  { id: 'plain', center: [0, 54], half: [118, 30], count: 2500, facing: 0, march: 8, delay: 4, tint: 'orc' },
  { id: 'gateflow', center: [0, -70], half: [6.5, 40], count: 300, facing: 0, march: 130, delay: 11.5, tint: 'orc', speed: 4.6 },
  { id: 'flankW', center: [-236, 176], half: [30, 58], count: 1100, facing: 1.4, march: 78, delay: 7, tint: 'orc' },
  { id: 'flankE', center: [238, 178], half: [30, 58], count: 1100, facing: -1.4, march: 78, delay: 8, tint: 'easterling' },
  { id: 'rearAll', center: [0, 408], half: [110, 34], count: 700, facing: Math.PI, march: 72, delay: 12, tint: 'orc' },
  { id: 'nw', center: [-165, 66], half: [48, 38], count: 450, facing: 0.9, march: 0, delay: 0, tint: 'orc' },
  { id: 'ne', center: [165, 68], half: [48, 38], count: 450, facing: -0.9, march: 0, delay: 0, tint: 'easterling' },
];

/** where a host's rank centre comes to rest */
export function hostEnd(h: HostDef): [number, number] {
  return [h.center[0] + Math.sin(h.facing) * h.march, h.center[1] + Math.cos(h.facing) * h.march];
}

/** the Army of the West: soldiers of Gondor and Rohan on the hills, facing outward */
export interface LineDef {
  id: string;
  kind: 'gondor' | 'rohirrim';
  count: number;
  center: [number, number];
  half: [number, number];
  facing: number;
}
export const ARMY: LineDef[] = [
  { id: 'wN', kind: 'gondor', count: 28, center: [-48, 168], half: [16, 6], facing: NORTH },
  { id: 'wW', kind: 'gondor', count: 22, center: [-70, 192], half: [5, 14], facing: -Math.PI / 2 },
  { id: 'eN', kind: 'gondor', count: 26, center: [50, 154], half: [16, 6], facing: NORTH },
  { id: 'eE', kind: 'rohirrim', count: 16, center: [66, 176], half: [5, 14], facing: Math.PI / 2 },
  { id: 'rS', kind: 'gondor', count: 20, center: [2, 214], half: [24, 5], facing: 0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// far landmarks (all within the camera's 1200 m)
// ─────────────────────────────────────────────────────────────────────────────

export const FAR = {
  /** Barad-dur, dead ahead behind the Gate */
  tower: V(-20, 0, -880),
  /** Orodruin, on the right horizon */
  doom: V(560, 0, -640),
};
