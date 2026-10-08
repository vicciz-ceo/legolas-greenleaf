/**
 * Ravenhill layout: every coordinate the world builder, the script, start(cp) and botHint() share,
 * and the terrain height function.
 *
 * Geography (metres, +Y up). The film's Ravenhill is a ruined dwarven watchtower on a crag of a
 * southern spur of Erebor, above a frozen waterfall and an ice river, with the battle of Dale far
 * below in the valley.
 *
 *   -Z (south) ........ the valley where the five armies fight (crowds, smoke), z < -100
 *   z -60 .. 72 ....... the gorge: a frozen river (flat ice, y = 0) between snow banks and 25 m cliffs
 *   z ≈ 74 ............ the frozen waterfall (24 m), the upper river continues north at y = 24
 *   C (-62, 58, 112) .. the Ravenhill crag: a 58 m high plateau with the ruined watchtower
 *   bridge ............ a stone bridge along +x from the crag (x -40) to the east pinnacle (x 16), deck y = 58
 *   E (24, 67, 112) ... the east pinnacle: a small summit 9 m above the deck (the final duel)
 *   +Z far ............ Erebor's flank looming through the snow (a hazy backdrop mesh)
 */
import * as THREE from 'three';
import { fbm2 } from '../../../core/rng';
import { smoothstep } from '../../../core/math';

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** the ice river's centre line (a gentle meander) */
export const riverX = (z: number): number => 4.5 * Math.sin(z * 0.021 + 0.4) + 1.6 * Math.sin(z * 0.053 + 1.1);
/** half-width of the flat ice */
export const ICE_HALF = 10.5;
/** the ice runs from the gorge mouth to the foot of the falls */
export const ICE_Z: [number, number] = [-70, 68];

export const FALLS_Z = 74;
export const FALLS_H = 24;
export const UPPER_Y = 24;

export const CRAG = { x: -62, z: 112, y: 58, r: 22 };
export const PINNACLE = { x: 24, z: 112, y: 67, r: 8 };
/** the bridge: deck top y, from x0 (crag edge) to x1 (pinnacle foot), at z */
export const BRIDGE = { x0: -40, x1: 16, z: 112, y: 58, width: 5.5, gap: [0.42, 0.6] as [number, number] };
export const BRIDGE_LEN = BRIDGE.x1 - BRIDGE.x0;
export const BRIDGE_CX = (BRIDGE.x0 + BRIDGE.x1) / 2;
/** world x where the deck breaks (start and end of the gap) */
export const GAP_X0 = BRIDGE.x0 + BRIDGE.gap[0] * BRIDGE_LEN;
export const GAP_X1 = BRIDGE.x0 + BRIDGE.gap[1] * BRIDGE_LEN;

/** the watchtower: radius, height and the yaw that turns its door (+z local) toward the bridge (+x) */
export const TOWER = { r: 7.5, h: 30, yaw: Math.PI / 2, floorTop: 15.8 };
/** world point inside the tower at local offset (lx, lz) (local frame of the builder, before the yaw) */
export function towerLocal(lx: number, y: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
  // rotation about Y by TOWER.yaw: x' = x cos + z sin, z' = -x sin + z cos
  const c = Math.cos(TOWER.yaw);
  const s = Math.sin(TOWER.yaw);
  return out.set(CRAG.x + lx * c + lz * s, y, CRAG.z - lx * s + lz * c);
}
/** the top floor's hole (builder: local (1.2, -0.8), r 2.4): keep scripted spots away from it */
export const TOP_FLOOR_Y = CRAG.y + TOWER.floorTop;
export const TOP_HOLE = towerLocal(1.2, TOP_FLOOR_Y, -0.8);
export const TOP_HOLE_R = 2.4;

export const L = {
  /** cp0: Legolas and Tauriel arrive at the gorge mouth, on the ice */
  spawn: V(riverX(-34), 0, -34),
  tauriel: V(riverX(-34) - 2.4, 0, -36),
  /** where the bot holds the ice during the waves */
  iceHold: V(riverX(4), 0, 4),
  /** enemy entries: from the falls, and down the banks from the ruins */
  fallsSpawn: [V(riverX(56) - 6, 0, 56), V(riverX(58), 0, 60), V(riverX(56) + 6, 0, 56)],
  bankSpawnW: [V(riverX(20) - 17, 0, 20), V(riverX(36) - 18, 0, 36)],
  bankSpawnE: [V(riverX(18) + 17, 0, 18), V(riverX(34) + 18, 0, 34)],
  /** archers on the ruined stonework above the banks */
  archerSpots: [V(riverX(26) - 21, 0, 26), V(riverX(40) + 21, 0, 40), V(riverX(48) - 20, 0, 48)],
  /** the troll bursts out of the ice-fall base */
  trollSpot: V(riverX(62), 0, 62),
  /** cp1: the bat comes down here, near the falls */
  pickup: V(riverX(44), 0, 44),
  cp1Spawn: V(riverX(30), 0, 30),
  /** cp2: Legolas drops into the top floor of the tower; Bolg waits across the floor */
  towerDrop: towerLocal(-2.0, TOP_FLOOR_Y, -3.0),
  towerCenter: towerLocal(-2.5, TOP_FLOOR_Y, 1.5),
  bolgTower: towerLocal(-3.2, TOP_FLOOR_Y, 2.6),
  /** cp3: the bridge's near end, the summit of the pinnacle, Bolg's last stand */
  bridgeStart: V(BRIDGE.x0 + 3, BRIDGE.y, BRIDGE.z),
  summit: V(PINNACLE.x - 1, PINNACLE.y, PINNACLE.z),
  bolgSummit: V(PINNACLE.x + 3, PINNACLE.y, PINNACLE.z + 0.5),
  summitArchers: [V(PINNACLE.x + 5.5, PINNACLE.y, PINNACLE.z - 4.5), V(PINNACLE.x + 6, PINNACLE.y, PINNACLE.z + 4)],
  /** distant battle in the valley */
  battle: V(30, 0, -135),
};

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

export const TERRAIN = { size: 440, segments: 160, center: [0, 60] as [number, number] };

/** high snow country around the gorge (before the crags) */
function highCountry(x: number, z: number, n1: number, n2: number): number {
  // descend toward the open valley in the south
  const open = smoothstep(-45, -135, z);
  const high = 29 + n1 * 7 + n2 * 1.4;
  const valley = 3 + n1 * 3 + n2 * 0.6;
  return high + (valley - high) * open;
}

export function heightAt(x: number, z: number): number {
  const n1 = fbm2(x * 0.011, z * 0.011, 4, 41);
  const n2 = fbm2(x * 0.05, z * 0.05, 3, 42);
  const hc = highCountry(x, z, n1, n2);

  // ── the lower gorge (south of the falls) ──
  const rx = riverX(z);
  const dx = Math.abs(x - rx);
  const open = smoothstep(-45, -135, z);
  const wallIn = 22 + n1 * 3 + open * 60; // the gorge walls recede into the valley
  const bank = 3.4 * smoothstep(ICE_HALF + 0.3, 21, dx) + n2 * 0.7 * smoothstep(13, 22, dx);
  const wall = smoothstep(wallIn, wallIn + 13 + n2 * 2, dx);
  let lower = bank + wall * Math.max(0, hc - 3.4);
  // bed flat ice
  if (dx < ICE_HALF) lower = 0;

  // ── the upper level (north of the falls): high country with the upper river at y = 24 ──
  const dxu = Math.abs(x - riverX(z) * 0.5);
  let upper = Math.max(hc, UPPER_Y + 3);
  const uBank = smoothstep(7, 16, dxu);
  upper = UPPER_Y + (upper - UPPER_Y) * uBank + (dxu < 7 ? 0 : n2 * 0.3);

  // blend across the falls step (hidden behind the waterfall's cliff mesh)
  const k = smoothstep(FALLS_Z + 0.5, FALLS_Z + 6, z);
  let h = lower + (upper - lower) * k;
  // the falls' side walls: the gorge walls close in around the curtain
  if (z > FALLS_Z - 14 && z < FALLS_Z + 8 && dx > 9) h = Math.max(h, (UPPER_Y + 4) * smoothstep(FALLS_Z - 14, FALLS_Z - 4, z) * smoothstep(9, 13, dx));

  // ── the Ravenhill crag ──
  const dc = Math.hypot(x - CRAG.x, z - CRAG.z);
  if (dc < CRAG.r + 30) {
    const top = CRAG.y + n2 * 0.25 - (dc > CRAG.r - 6 ? (dc - (CRAG.r - 6)) * 0.05 : 0);
    const crag = dc < CRAG.r ? top : top - (dc - CRAG.r) * (2.3 + n2 * 0.6) - Math.max(0, dc - CRAG.r - 6) * 0.6;
    h = Math.max(h, crag);
  }
  // ── the east pinnacle ──
  const dp = Math.hypot(x - PINNACLE.x, z - PINNACLE.z);
  if (dp < PINNACLE.r + 22) {
    const pin = dp < PINNACLE.r ? PINNACLE.y + n2 * 0.15 : PINNACLE.y - (dp - PINNACLE.r) * (3.0 + n2 * 0.5);
    h = Math.max(h, pin);
  }
  return h;
}

/** true where the frozen river is (the slippery ice) */
export function onIce(x: number, z: number, y: number): boolean {
  return z > ICE_Z[0] && z < ICE_Z[1] && Math.abs(x - riverX(z)) < ICE_HALF - 0.2 && y < 0.8;
}
