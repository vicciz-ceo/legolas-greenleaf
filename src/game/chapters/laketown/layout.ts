/**
 * Lake-town layout: every coordinate of the chapter lives here, so the world builder, the script,
 * start(cp), the bot hints and the boss agree.
 *
 *   x east, z north (the player advances along +Z, the moon is behind him, over the water to the south)
 *   water surface y = 0, every deck / walkway surface y = D (1.2 m above the lake)
 *
 *   dock (spawn) -- Main Walk A -- Market -- Walk B -- Bard's quay -- Bard's house
 *        |                |                                   |
 *        +-- side links --+--- West / East walks -------------+
 *   the rooftop chase leaves the quay on its west side and runs north over a row of roofs to the jetty
 */
import * as THREE from 'three';
import { Rng } from '../../../core/rng';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** deck height above the water */
export const D = 1.2;
export const WATER_Y = 0;
export const WALK_W = 3.4;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Platform {
  name: string;
  cx: number;
  cz: number;
  hx: number;
  hz: number;
}

export const PLATFORMS: Record<'dock' | 'market' | 'quay', Platform> = {
  dock: { name: 'dock', cx: 0, cz: -70, hx: 9, hz: 5.5 },
  market: { name: 'market', cx: 0, cz: 0, hx: 15, hz: 13 },
  quay: { name: 'quay', cx: 0, cz: 37.5, hx: 14, hz: 10 },
};

export interface Walk {
  name: string;
  a: [number, number];
  b: [number, number];
  width?: number;
  lamps?: number;
}

/** plank walkways (centre lines). Axis aligned, so the deck rectangles are exact. */
export const WALKS: Walk[] = [
  { name: 'A', a: [0, -64.5], b: [0, -13], lamps: 9 },
  { name: 'B', a: [0, 13], b: [0, 27.5], lamps: 7 },
  { name: 'SW', a: [-27, -40], b: [-27, 37.5], lamps: 11 },
  { name: 'SE', a: [27, -40], b: [27, 37.5], lamps: 11 },
  { name: 'L1w', a: [0, -40], b: [-27, -40], lamps: 9 },
  { name: 'L1e', a: [0, -40], b: [27, -40], lamps: 9 },
  { name: 'L2w', a: [-15, 0], b: [-27, 0], lamps: 0 },
  { name: 'L2e', a: [15, 0], b: [27, 0], lamps: 0 },
  { name: 'L3w', a: [-14, 37.5], b: [-27, 37.5], lamps: 0 },
  { name: 'L3e', a: [14, 37.5], b: [27, 37.5], lamps: 0 },
  // from the west walk to the dock, so the orcs have a way round
  { name: 'L0w', a: [-27, -40], b: [-27, -70], lamps: 10 },
  { name: 'L0e', a: [27, -40], b: [27, -70], lamps: 10 },
  { name: 'D0w', a: [-27, -70], b: [-9, -70], lamps: 0 },
  { name: 'D0e', a: [27, -70], b: [9, -70], lamps: 0 },
];

/** the hand-placed row of roofs the chase runs over (ridge along the travel direction) */
export interface RoofDef {
  x: number;
  z: number;
  /** ridge direction: 'z' = north-south, 'x' = east-west */
  ridge: 'x' | 'z';
  w: number;
  d: number;
  pitch: number;
  floors: number;
  seed: number;
}

const ROOF_OV = 0.55;
/** length of a house roof along its ridge */
export const roofLen = (r: { w: number }) => r.w + ROOF_OV * 1.6;

/**
 * The roof highway: Bolg leaves the quay over the west link, then north across nine roofs to the
 * jetty. Ridges run along the course; the gaps are 2.6 to 3.8 m (a leap).
 */
export const CHASE_GAPS = [2.8, 3.2, 3.6, 2.6, 3.4, 3.8, 3.0, 3.4];
export const CHASE_X = -22;
export const CHASE_ROOFS: RoofDef[] = (() => {
  const dims: [number, number, number][] = [
    [6.6, 5.2, 0.62], [6.2, 5.0, 0.7], [6.8, 5.4, 0.58], [7.0, 5.0, 0.66], [6.0, 5.2, 0.74],
    [6.4, 5.0, 0.6], [6.2, 5.4, 0.68], [6.6, 5.0, 0.62], [6.0, 5.2, 0.7],
  ];
  const out: RoofDef[] = [];
  let z = 45.4;
  dims.forEach(([w, d, pitch], i) => {
    const len = w + ROOF_OV * 1.6;
    z += len / 2;
    out.push({ x: CHASE_X, z, ridge: 'z', w, d, pitch, floors: 1, seed: 31 + i });
    z += len / 2 + (CHASE_GAPS[i] ?? 3);
  });
  return out;
})();

/** scenery houses beside the roof highway (their roofs hold the orcs that cover Bolg's escape) */
export const CHASE_COVER: RoofDef[] = (() => {
  const out: RoofDef[] = [];
  CHASE_ROOFS.forEach((r, i) => {
    out.push({ x: CHASE_X - 11.5 + (i % 3) * 0.6, z: r.z + (i % 2 ? 2 : -2), ridge: 'z', w: 6.2 + (i % 3) * 0.3, d: 5.0, pitch: 0.6 + (i % 4) * 0.04, floors: i % 3 === 1 ? 2 : 1, seed: 60 + i });
    out.push({ x: CHASE_X + 11 - (i % 2) * 0.8, z: r.z + (i % 2 ? -3 : 1), ridge: 'z', w: 6.4, d: 5.0, pitch: 0.62 + (i % 3) * 0.04, floors: i % 4 === 2 ? 2 : 1, seed: 80 + i });
  });
  return out;
})();

/** the northern jetty the chase ends on (and its causeway to the shore) */
const lastRoof = CHASE_ROOFS[CHASE_ROOFS.length - 1];
const jettyStart = lastRoof.z + roofLen(lastRoof) / 2 + 3.2;
export const JETTY = { a: [CHASE_X, jettyStart] as [number, number], b: [CHASE_X, jettyStart + 55] as [number, number], width: 3.0 };

export function walkRect(w: Walk): Rect {
  const width = w.width ?? WALK_W;
  const ext = width / 4; // pier() overhangs its ends by a quarter of its width
  const x0 = Math.min(w.a[0], w.b[0]);
  const x1 = Math.max(w.a[0], w.b[0]);
  const z0 = Math.min(w.a[1], w.b[1]);
  const z1 = Math.max(w.a[1], w.b[1]);
  return x1 - x0 < 1e-6
    ? { x0: x0 - width / 2, x1: x1 + width / 2, z0: z0 - ext, z1: z1 + ext }
    : { x0: x0 - ext, x1: x1 + ext, z0: z0 - width / 2, z1: z1 + width / 2 };
}

export function platformRect(p: Platform): Rect {
  return { x0: p.cx - p.hx, x1: p.cx + p.hx, z0: p.cz - p.hz, z1: p.cz + p.hz };
}

/** the stage the chase starts from, on the west link */
export const STAGE: Platform = { name: 'stage', cx: CHASE_X, cz: 41.4, hx: 3.3, hz: 2.9 };
/** Bard's deck and apron, joined to the quay */
export const BARD_DECK: Rect = { x0: -5.1, x1: 5.1, z0: 46.4, z1: 56 };
/** the shore at the end of the jetty (no rail there) */
const SHORE: Rect = { x0: JETTY.a[0] - 4, x1: JETTY.a[0] + 4, z0: JETTY.b[1] + 0.6, z1: JETTY.b[1] + 12 };

/** every walkable deck rectangle (for the swim respawn, spawn checks and the bot) */
export const DECKS: Rect[] = [
  ...Object.values(PLATFORMS).map(platformRect),
  platformRect(STAGE),
  BARD_DECK,
  ...WALKS.map(walkRect),
  walkRect({ name: 'jetty', a: JETTY.a, b: JETTY.b, width: JETTY.width }),
];

/** a place on a deck edge where a swimmer can haul out: the point, the inward direction, the deck it belongs to */
export interface EdgePoint {
  x: number;
  z: number;
  ix: number;
  iz: number;
  deck: number;
}

/** deck edge points every ~1.6 m (not inside another deck: junction interiors are no way out of the water) */
export function edgePoints(): EdgePoint[] {
  const out: EdgePoint[] = [];
  DECKS.forEach((r, di) => {
    const edges: [number, number, number, 'x' | 'z', number][] = [
      [r.z0, r.x0, r.x1, 'z', 1],
      [r.z1, r.x0, r.x1, 'z', -1],
      [r.x0, r.z0, r.z1, 'x', 1],
      [r.x1, r.z0, r.z1, 'x', -1],
    ];
    for (const [fixed, from, to, axis, inward] of edges) {
      const n = Math.max(1, Math.round((to - from) / 1.6));
      for (let i = 0; i <= n; i++) {
        const t = from + ((to - from) * i) / n;
        const x = axis === 'z' ? t : fixed;
        const z = axis === 'z' ? fixed : t;
        if (DECKS.some((q, qi) => qi !== di && x > q.x0 + 0.05 && x < q.x1 - 0.05 && z > q.z0 + 0.05 && z < q.z1 - 0.05)) continue;
        out.push({ x, z, ix: axis === 'x' ? inward : 0, iz: axis === 'z' ? inward : 0, deck: di });
      }
    }
  });
  return out;
}

/** the deck (and walls) footprint of a house: swimmers cannot pass under it */
export function houseRect(h: { x: number; z: number; yaw: number; w: number; d: number }): Rect {
  const f = footprint(h, 0.0);
  return { x0: f.x0 + 0.5, x1: f.x1 - 0.5, z0: f.z0 + 0.5, z1: f.z1 - 0.5 };
}

/** does the segment (x0,z0)-(x1,z1) cross the rectangle? */
export function segHitsRect(x0: number, z0: number, x1: number, z1: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x0 - r.x0) && clip(dx, r.x1 - x0) && clip(-dz, z0 - r.z0) && clip(dz, r.z1 - z0);
}

export interface RailSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/**
 * Rope railings along the open edges of every deck: the outline of the union of the deck
 * rectangles, minus the stretches where another deck (a junction) or a house porch joins.
 * Falling in is still possible (jump the rope, or lose planks), but never by a stray step.
 */
export function computeRails(cuts: Rect[] = []): RailSeg[] {
  const pieces = [...DECKS, SHORE, ...cuts];
  const tol = 0.04;
  const out: RailSeg[] = [];
  const horizontal: { z: number; a: number; b: number }[] = [];
  const vertical: { x: number; a: number; b: number }[] = [];
  DECKS.forEach((r) => {
    // the four edges: [fixed coordinate, from, to, axis]
    const edges: [number, number, number, 'x' | 'z'][] = [
      [r.z0, r.x0, r.x1, 'z'],
      [r.z1, r.x0, r.x1, 'z'],
      [r.x0, r.z0, r.z1, 'x'],
      [r.x1, r.z0, r.z1, 'x'],
    ];
    for (const [fixed, from, to, axis] of edges) {
      // intervals covered by other pieces
      const cover: [number, number][] = [];
      for (const q of pieces) {
        if (q === r) continue;
        if (axis === 'z') {
          if (q.z0 + tol < fixed && fixed < q.z1 - tol) cover.push([q.x0, q.x1]);
        } else if (q.x0 + tol < fixed && fixed < q.x1 - tol) cover.push([q.z0, q.z1]);
      }
      cover.sort((a, b) => a[0] - b[0]);
      let cur = from;
      const push = (a: number, b: number) => {
        if (b - a < 0.35) return;
        if (axis === 'z') horizontal.push({ z: fixed, a, b });
        else vertical.push({ x: fixed, a, b });
      };
      for (const [c0, c1] of cover) {
        if (c1 <= cur) continue;
        if (c0 > cur) push(cur, Math.min(c0, to));
        cur = Math.max(cur, c1);
        if (cur >= to) break;
      }
      if (cur < to) push(cur, to);
    }
  });
  // merge collinear overlapping runs (adjacent decks share an edge line)
  const merge = <T extends { a: number; b: number }>(list: T[], key: (t: T) => number): T[] => {
    const sorted = [...list].sort((p, q) => key(p) - key(q) || p.a - q.a);
    const res: T[] = [];
    for (const t of sorted) {
      const last = res[res.length - 1];
      if (last && Math.abs(key(last) - key(t)) < 0.02 && t.a <= last.b + 0.02) last.b = Math.max(last.b, t.b);
      else res.push({ ...t });
    }
    return res;
  };
  for (const h of merge(horizontal, (t) => t.z)) out.push({ ax: h.a, az: h.z, bx: h.b, bz: h.z });
  for (const v of merge(vertical, (t) => t.x)) out.push({ ax: v.x, az: v.a, bx: v.x, bz: v.b });
  return out;
}

const inRect = (r: Rect, x: number, z: number, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
export const onDeck = (x: number, z: number): boolean => DECKS.some((r) => inRect(r, x, z));

/** nearest point on any deck, pulled `inset` metres inside it */
export function nearestDeckPoint(x: number, z: number, inset = 0.9, out = new THREE.Vector3()): THREE.Vector3 {
  let best = Infinity;
  for (const r of DECKS) {
    const ins = Math.min(inset, (r.x1 - r.x0) / 2 - 0.1, (r.z1 - r.z0) / 2 - 0.1);
    const px = Math.max(r.x0 + ins, Math.min(r.x1 - ins, x));
    const pz = Math.max(r.z0 + ins, Math.min(r.z1 - ins, z));
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < best) {
      best = d;
      out.set(px, D, pz);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Houses
// ─────────────────────────────────────────────────────────────────────────────

export interface HouseDef {
  x: number;
  z: number;
  /** rotation.y of the house object (its front, local +z, faces (sin yaw, cos yaw)) */
  yaw: number;
  w: number;
  d: number;
  floors: number;
  seed: number;
  lit: boolean;
  /** which walk it fronts (for spawn picking) */
  run: string;
  /** crates against the front so the player can reach the roof */
  steps: boolean;
}

interface Frontage {
  walk: string;
  /** side of the walk: +1 = east/north side, -1 = west/south side */
  side: 1 | -1;
  /** run from..to along the walk axis */
  from: number;
  to: number;
}

const FRONTAGES: Frontage[] = [
  { walk: 'A', side: 1, from: -62, to: -17 },
  { walk: 'A', side: -1, from: -62, to: -17 },
  { walk: 'SW', side: 1, from: -36, to: -3 },
  { walk: 'SE', side: -1, from: -36, to: -3 },
  { walk: 'SW', side: -1, from: -66, to: 34 },
  { walk: 'SE', side: 1, from: -66, to: 34 },
  { walk: 'SW', side: 1, from: 3, to: 34 },
  { walk: 'SE', side: -1, from: 3, to: 34 },
  { walk: 'L1w', side: 1, from: -24, to: -3 },
  { walk: 'L1e', side: 1, from: 3, to: 24 },
  { walk: 'B', side: 1, from: 15, to: 26 },
  { walk: 'B', side: -1, from: 15, to: 26 },
];

export function walkByName(name: string): Walk {
  const w = WALKS.find((q) => q.name === name);
  if (!w) throw new Error('unknown walk ' + name);
  return w;
}

/** footprint rectangle of a house (deck + porch), conservative */
function footprint(h: { x: number; z: number; yaw: number; w: number; d: number }, margin: number): Rect {
  const cs = Math.abs(Math.cos(h.yaw));
  const sn = Math.abs(Math.sin(h.yaw));
  const hx = (h.w / 2 + 0.5) * cs + (h.d / 2 + 1.4) * sn + margin;
  const hz = (h.w / 2 + 0.5) * sn + (h.d / 2 + 1.4) * cs + margin;
  return { x0: h.x - hx, x1: h.x + hx, z0: h.z - hz, z1: h.z + hz };
}

const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/** Bard's house stands here, its front (+z local) rotated to face the south (the approach) */
export const BARD = { x: 0, z: 52, yaw: Math.PI };


export function planHouses(): HouseDef[] {
  const rng = new Rng(0x1a4e70);
  const out: HouseDef[] = [];
  const blocked: { name: string; r: Rect }[] = [
    ...Object.values(PLATFORMS).map((p) => ({ name: 'P' + p.name, r: platformRect(p) })),
    ...WALKS.map((w) => ({ name: w.name, r: walkRect(w) })),
    // Bard's house and the open water in front of it
    { name: 'bard', r: { x0: -8, x1: 8, z0: 46, z1: 60 } },
    // the chase stage and the roof highway start
    { name: 'stage', r: { x0: -26, x1: -18, z0: 36, z1: 46 } },
  ];
  for (const f of FRONTAGES) {
    const walk = walkByName(f.walk);
    const alongZ = Math.abs(walk.a[0] - walk.b[0]) < 1e-6;
    let s = f.from;
    let guard = 0;
    while (s < f.to - 4 && guard++ < 40) {
      const w = 5.4 + rng.float() * 2.0;
      const d = 4.4 + rng.float() * 1.1;
      const floors = rng.chance(0.28) ? 2 : 1;
      const mid = s + w / 2;
      const off = WALK_W / 2 + (d / 2 + 1.3) + 0.1;
      let h: HouseDef;
      if (alongZ) {
        const x = walk.a[0] + f.side * off;
        h = { x, z: mid, yaw: f.side > 0 ? -Math.PI / 2 : Math.PI / 2, w, d, floors, seed: Math.floor(rng.float() * 1000), lit: rng.chance(0.62), run: f.walk, steps: false };
      } else {
        const z = walk.a[1] + f.side * off;
        h = { x: mid, z, yaw: f.side > 0 ? Math.PI : 0, w, d, floors, seed: Math.floor(rng.float() * 1000), lit: rng.chance(0.62), run: f.walk, steps: false };
      }
      s += w + 2.2 + rng.float() * 1.4;
      const fp = footprint(h, 0.6);
      if (blocked.some((b) => b.name !== f.walk && overlap(fp, b.r))) continue;
      if (out.some((o) => overlap(fp, footprint(o, 0.4)))) continue;
      h.steps = floorsOk(h) && !h.run.startsWith('L') && ((h.run === 'A' && Math.abs(h.z + 46) < 15) || rng.chance(0.22));
      out.push(h);
    }
  }
  return out;
}

const floorsOk = (h: HouseDef) => h.floors === 1;

/** a spot on a house roof: along = -1..1 along the ridge, across = -1..1 toward the front (+1) */
export function roofSpot(h: { x: number; z: number; yaw: number; w: number; d: number }, along: number, across: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lx = (along * h.w) / 2;
  const lz = (across * h.d) / 2;
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  // local (x, z) -> world: x' = lx cos + lz sin, z' = -lx sin + lz cos
  return out.set(h.x + lx * c + lz * s, y, h.z - lx * s + lz * c);
}

/** eave height of a one-floor house roof in world y (roof surface near the front edge) */
export const EAVE_Y = D + 2.35;
export const RIDGE_Y_1F = D + 2.7 + 1.55;

// ─────────────────────────────────────────────────────────────────────────────
// Story coordinates
// ─────────────────────────────────────────────────────────────────────────────

export const L = {
  start: V(0, D, -68.5),
  startFacing: 0,
  /** where Bard's house beat starts and the player waits during the intro of beat 2 */
  quayStart: V(0, D, 31),
  /** Bolg's entrance and the duel centre */
  duelCenter: V(0, D, 38),
  bolgFrom: V(0, D, 14),
  /** the open front of Bard's house (door line) */
  houseDoor: V(0, D, 46.2),
  /** Kili lies here, inside the open front room */
  kili: V(2.0, D, 52.4),
  /** dwarves on guard in front of the house */
  dwarves: [V(-4.2, D, 45), V(4.2, D, 45)],
  /** the quay rim waves come from */
  westLink: V(-25, D, 37.5),
  eastLink: V(25, D, 37.5),
  southWalk: V(0, D, 16),
  /** market */
  marketCenter: V(0, D, 0),
  marketSouth: V(0, D, -11),
  marketNorth: V(0, D, 11),
  /** first contact on the main walk */
  ambush: V(0, D, -50),
  /** chase */
  chaseStart: V(-14, D, 38),
  horse: V(CHASE_X, D, jettyStart + 46),
};

/** the waypoints the bot follows through the beats (all on decks, in order) */
export const BOT_ROUTE_1: THREE.Vector3[] = [
  V(0, D, -66),
  V(0, D, -52),
  V(0, D, -36),
  V(0, D, -20),
  V(0, D, -8),
  V(0, D, 0),
  V(0, D, 10),
  V(0, D, 22),
  V(0, D, 31),
];
