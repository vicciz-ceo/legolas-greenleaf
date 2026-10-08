/**
 * Moria layout: every coordinate of the chapter in one table, so the world builder, the script,
 * start(cp) and botHint() agree.
 *
 *   x  west -> east.  The Chamber of Mazarbul sits at the origin (interior -8..8), its barricaded
 *   door in the west wall, its open arch in the east wall. East of the arch lies the antechamber
 *   and the great pillared hall of Dwarrowdelf (the troll arena and the run), ending in the east
 *   gate and the corridor to the Bridge (Balrog glow beyond).
 */
import * as THREE from 'three';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the pillar grid of the hall (see dwarvenHall) */
export const HALL = {
  cols: 7,
  rows: 4,
  spacing: 14,
  height: 26,
  size: 3.4,
  /** x of the first pillar column */
  firstX: 26,
};

export const HALL_W = (HALL.cols - 1) * HALL.spacing + HALL.spacing * 1.4;
export const HALL_D = (HALL.rows - 1) * HALL.spacing + HALL.spacing * 1.4;
/** x of the hall's centre */
export const HALL_CX = HALL.firstX + ((HALL.cols - 1) / 2) * HALL.spacing;
export const HALL_X0 = HALL_CX - HALL_W / 2;
/** the hall's east wall (inner face) and the half width of the hall */
export const HALL_X1 = HALL_CX + HALL_W / 2;
export const HALL_HZ = HALL_D / 2;

/** pillar centres */
export const PILLARS: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  for (let r = 0; r < HALL.rows; r++) {
    for (let c = 0; c < HALL.cols; c++) {
      out.push({ x: HALL.firstX + c * HALL.spacing, z: (r - (HALL.rows - 1) / 2) * HALL.spacing });
    }
  }
  return out;
})();
/** half extent of a pillar's collider (see pillar(): size * 0.55) */
export const PILLAR_HALF = HALL.size * 0.55;

export const CH = {
  /** the tomb (dais centre) */
  tomb: V(0, 0, -3),
  well: V(5.4, 0, -5.4),
  westDoor: V(-7, 0, 2.6),
  eastArch: V(8.7, 0, 0),
  /** the shaft of light lands here */
  shaftFloor: V(0, 0, -4.2),
};

export const L = {
  /** Legolas starts here (cp0): by the tomb, facing the door */
  spawn: V(-1.4, 0, -0.6),
  /** holding ground of the chamber fight */
  hold: V(-1.2, 0, 0.8),
  /** where goblins pour in: beyond the east arch, in the dark */
  archSpawns: [V(15, 0, -3.2), V(16.5, 0, 0), V(15, 0, 3.2)],
  /** the ceiling hole of the chamber (goblins drop here) */
  ceilingHole: V(-2.4, 8.4, 4.4),
  /** the ledge along the south wall: archers stand here (top y) */
  ledgeY: 4.25,
  ledgeX: [-6.4, 2.2] as [number, number],
  ledgeZ: 7.05,
  /** foot of the wall below the ledge's open end: goblins start their climb here */
  climbFoot: V(4.2, 0, 6.9),
  climbTop: V(1.6, 4.3, 7.0),
  /** the troll arena: the hall west end */
  arenaCenter: V(38, 0, 0),
  /** where the troll comes in */
  trollSpawn: V(58, 0, 3),
  /** the party's place when the troll fight begins */
  arenaStart: V(21, 0, 0),
  /** the flight: waypoints down the central aisle to the east gate */
  run: [V(30, 0, 0), V(47, 0, 0), V(61, 0, 0), V(75, 0, 0), V(89, 0, 0), V(103, 0, 0), V(114, 0, 0)],
  exit: V(HALL_X1 - 2, 0, 0),
  /** the bot's goal once the Balrog has stirred: through the gate */
  beyondGate: V(HALL_X1 + 8, 0, 0),
  /** the corridor beyond the gate and the chasm edge */
  corridorEnd: V(HALL_X1 + 24, 0, 0),
};

export const CHECKPOINTS = ['The Chamber of Mazarbul', 'The Cave Troll', 'Flight to the Bridge'];

/** true when (x, z) is inside a pillar's footprint (plus a margin) */
export function nearPillar(x: number, z: number, margin = 0): boolean {
  for (const p of PILLARS) if (Math.abs(x - p.x) < PILLAR_HALF + margin && Math.abs(z - p.z) < PILLAR_HALF + margin) return true;
  return false;
}

/** inside the walkable floor of chamber + antechamber + hall (with a margin from the walls) */
export function inHall(x: number, z: number, margin = 2): boolean {
  return x > HALL_X0 - 8 + margin && x < HALL_X1 - margin && Math.abs(z) < HALL_HZ - margin;
}
