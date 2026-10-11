/**
 * Art-pass dressing for Amon Hen, after the scene reference (docs/refs/scenes/amon_hen): golden shafts through
 * the beeches, statues and columns flanking the broken stairs (so the way up reads as a ruined processional way
 * from the trail), dense leaf litter and bracken round the ruins and the clearing, and mossy stones along and in
 * the stream (water stays a secondary cool strip behind the duel).
 *
 * Everything is instanced or merged: a handful of draw calls and no new textures.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { dirFromAngles } from '../../../core/environment';
import { addColliders, boulderField, ferns, lightShaft, pillar, statue, worldQuality, type Built } from '../../../world';
import { CLEARING, FLIGHTS, L, RUINS, SEAT, streamDist, ground } from './layout';
import { fallenLeaves } from './leaves';
import { groundCover } from './cover';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';

type Place = (b: Built, x: number, z: number, yaw?: number, y?: number) => Built;
type Tint = (obj: THREE.Object3D, rgb: [number, number, number]) => void;

const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * Golden shafts: cones along the sun's direction (a touch steeper than the real 12 degrees, so they read as
 * rays and not as a haze bank), planted at the edges of the play areas. They fade near the camera and
 * toward the ground (lightShaft's nearFade / groundFade), so they never become flat panels.
 */
export function sunShafts(level: LevelAPI): void {
  const q = worldQuality();
  const sun = dirFromAngles(21, 250, new THREE.Vector3());
  // [x, z, radius, strength]: along the climb, the terrace, the descent and the clearing
  const spots: [number, number, number, number][] = [
    [-13, -34, 2.2, 0.26], [3, -16, 1.8, 0.2], [-8, 3, 2.1, 0.24], [14, 14, 2.0, 0.22], [-15, 33, 2.4, 0.26], [9, 44, 1.8, 0.2],
    [-12, 76, 2.4, 0.28], [16, 80, 2.0, 0.24], [-30, 62, 2.2, 0.22],
    [33, 16, 2.2, 0.22], [27, -14, 1.9, 0.2],
    [-34, -64, 2.4, 0.26], [-3, -60, 2.0, 0.22], [-22, -84, 2.2, 0.26], [8, -88, 2.4, 0.24],
  ];
  const n = q === 'low' ? 8 : spots.length;
  for (let i = 0; i < n; i++) {
    const [x, z, r, k] = spots[i];
    const len = 38;
    const s = lightShaft(len, r * 0.3, r, 0xffd9a0, k, { groundFade: 0.3, nearFade: [3, 12] });
    s.position.set(x, ground(x, z) + 0.2, z).addScaledVector(sun, len);
    s.quaternion.setFromUnitVectors(V3(0, 1, 0), sun);
    s.name = 'sun_shaft';
    level.root.add(s);
  }
}

/** a standing statue (or column) on each side of a flight of stairs, a few metres past its top end */
function flankFlight(place: Place, tint: Tint, f: (typeof FLIGHTS)[number], at: 'top' | 'bottom', height: number, seed: number): void {
  const dx = f.to[0] - f.from[0];
  const dz = f.to[1] - f.from[1];
  const l = Math.hypot(dx, dz);
  const px = dz / l;
  const pz = -dx / l;
  const [bx, bz] = at === 'top' ? f.to : f.from;
  const off = f.width / 2 + 2.7;
  for (const s of [-1, 1]) {
    const x = bx + px * off * s;
    const z = bz + pz * off * s;
    const st = statue(s < 0 ? 'standing' : seed % 2 ? 'headless' : 'standing', { height, seed: seed + s * 3 });
    tint(st.object, [0.7, 0.67, 0.62]);
    // the figures face the stair
    place(st, x, z, Math.atan2(-px * s, -pz * s));
  }
}

/** the ruined processional way and the litter and stone round it */
export function dressRuinedWay(level: LevelAPI, h: (x: number, z: number) => number, place: Place, tint: Tint, inPlaza: (x: number, z: number) => boolean): void {
  const { physics } = level.ctx;
  // FLIGHTS: [0] the great stair above the terrace, [1] and [2] the two on the way up
  const great = FLIGHTS[0];
  // statues at the heads of the two mid-hill flights (the first landmarks from the trail) and the first one's foot
  flankFlight(place, tint, FLIGHTS[1], 'top', 6.2, 21);
  flankFlight(place, tint, FLIGHTS[2], 'top', 6.8, 25);
  flankFlight(place, tint, FLIGHTS[1], 'bottom', 5.0, 31);
  // a tall column and a broken one at the foot of each mid flight: a gate of old stone the trail runs through
  FLIGHTS.slice(1).forEach((f, i) => {
    const dx = f.to[0] - f.from[0];
    const dz = f.to[1] - f.from[1];
    const l = Math.hypot(dx, dz);
    const px = dz / l;
    const pz = -dx / l;
    const bx = f.from[0] - (dx / l) * 2.5;
    const bz = f.from[1] - (dz / l) * 2.5;
    const kinds: ['ionic' | 'round' | 'broken', number][] = i === 0 ? [['ionic', 9.0], ['broken', 5.5]] : [['round', 8.0], ['ionic', 6.0]];
    kinds.forEach(([kind, hh], k) => {
      const sd = 40 + i * 2 + k;
      const side = k === 0 ? -1 : 1;
      const col = pillar(kind, hh, 1.5, { seed: sd, broken: 0.4 });
      tint(col.object, [0.74, 0.72, 0.68]);
      place(col, bx + px * 7 * side, bz + pz * 7 * side, sd * 0.7);
    });
  });
  // statues along the great stair, between its colonnade and the treads
  for (const [z, hgt, sd] of [[98, 6.6, 51], [108, 7.0, 52]] as [number, number, number][]) {
    for (const s of [-1, 1]) {
      const x = great.from[0] + s * (great.width / 2 + 3.6);
      const st = statue(sd % 2 ? 'standing' : 'headless', { height: hgt, seed: sd + s });
      tint(st.object, [0.7, 0.67, 0.62]);
      // facing the stair
      place(st, x, z, s < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  // leaf litter and bracken over the terrace and its approaches (the terrain shader alone leaves the terrace bare)
  const onFlight = (x: number, z: number): boolean => FLIGHTS.some((f) => {
    const dx = f.to[0] - f.from[0];
    const dz = f.to[1] - f.from[1];
    const l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - f.from[0]) * dx + (z - f.from[1]) * dz) / l2));
    return Math.hypot(x - (f.from[0] + dx * t), z - (f.from[1] + dz * t)) < f.width / 2 + 0.3;
  });
  // on the paving the leaves ride a hand's breadth higher
  const litterH = (x: number, z: number): number => h(x, z) + (inPlaza(x, z) ? 0.17 : 0);
  fallenLeaves(level, { x: RUINS.x, z: RUINS.z + 4, hx: 36, hz: 34 }, 1500, litterH, (x, z) => onFlight(x, z) || z > 112, 3);
  fallenLeaves(level, { x: CLEARING.x, z: CLEARING.z - 6, hx: 34, hz: 30 }, 1100, h, (x, z) => streamDist(x, z) < 3.2, 4);
  fallenLeaves(level, { x: 6, z: -4, hx: 26, hz: 52 }, 800, h, (x, z) => onFlight(x, z) || streamDist(x, z) < 4, 5);

  // the paved plaza is overgrown: moss and grass in broken patches (thick at its rim) so the flagstones show through in places,
  // not as one clean disc
  const pcx = RUINS.x;
  const pcz = RUINS.z + 2;
  const padY = RUINS.y + 0.16;
  groundCover(level, {
    x0: pcx - 15, x1: pcx + 15, z0: pcz - 15, z1: pcz + 15, step: 1.25, name: 'plaza_moss',
    heightAt: (x, z) => (inPlaza(x, z) ? Math.max(h(x, z), padY) : h(x, z)),
    tint: [0.82, 0.78, 0.46],
    alpha: (x, z) => {
      const r = Math.hypot(x - pcx, z - pcz);
      const n = fbm2(x * 0.32 + 4, z * 0.32 + 9, 3, 17) * 0.5 + 0.5;
      const patch = smoothstep(0.42, 0.7, n);
      const rim = smoothstep(6.5, 10.5, r) * 0.7;
      const fade = 1 - smoothstep(11.5, 14.5, r);
      return Math.min(0.95, patch * 0.85 + rim) * fade;
    },
  });

  // bracken: round the terrace, along the lower flights and on the clearing's banks
  const keepOff = (x: number, z: number): boolean => onFlight(x, z) || inPlaza(x, z) || streamDist(x, z) < 3.4 || Math.hypot(x - L.spawn.x, z - L.spawn.z) < 4;
  level.root.add(ferns({ center: V3(RUINS.x, 0, RUINS.z + 2), halfSize: [38, 36] }, 260, h, { seed: 11, scale: [0.8, 1.5], clump: 0.75, exclude: keepOff, tint: [0.85, 0.82, 0.45] }));
  level.root.add(ferns({ center: V3(CLEARING.x, 0, CLEARING.z - 8), halfSize: [34, 24] }, 170, h, { seed: 12, scale: [0.7, 1.3], clump: 0.7, exclude: (x, z) => keepOff(x, z) || Math.hypot(x - L.lurtzMark.x, z - L.lurtzMark.z) < 5, tint: [0.8, 0.88, 0.45] }));

  // mossy stones on the banks and in the shallows: the stream reads as a cool strip with stepping stones, not a plain ribbon
  const bank = boulderField({ center: V3(0, 0, -101), halfSize: [92, 14] }, 46, [0.35, 1.0], h, {
    seed: 14, moss: 0.85, clump: 0.5, sink: 0.25,
    exclude: (x, z) => streamDist(x, z) > 7.5 || streamDist(x, z) < 2.4 || Math.hypot(x - L.lurtzMark.x, z - L.lurtzMark.z) < 6 || Math.hypot(x - L.boromir.x, z - L.boromir.z) < 7,
  });
  level.root.add(bank.object);
  addColliders(physics, bank.colliders);
  const shallows = boulderField({ center: V3(0, 0, -101), halfSize: [92, 12] }, 34, [0.25, 0.6], h, {
    seed: 15, moss: 0.7, clump: 0.4, sink: 0.45, colliderMin: 5,
    exclude: (x, z) => streamDist(x, z) > 2.8 || Math.abs(x - L.lurtzMark.x) < 7,
  });
  level.root.add(shallows.object);
  void SEAT;
}
