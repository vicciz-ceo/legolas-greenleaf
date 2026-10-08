/**
 * The rooftop chase: Legolas runs on rails north over the roofs of Lake-town after the fleeing Bolg.
 * A PlayerMover moves him along a straight course (x = CHASE_X) over nine roofs and a jetty: he
 * follows the roof surface (physics.ground), steers a little (left/right), shoots, and must press
 * Jump before each gap to leap it (a late press stumbles: lost speed and a few HP, never a fall).
 * Orcs standing in his path slow him until they are cut down. Bolg runs ahead as a puppet.
 */
import * as THREE from 'three';
import type { Humanoid, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { createHumanoid } from '../../../creatures/humanoid';
import { clamp, damp, smoothstep } from '../../../core/math';
import { CHASE_ROOFS, CHASE_X, D, JETTY, roofLen } from './layout';

export interface Seg {
  kind: 'run' | 'leap';
  /** along-course coordinate (z) at both ends */
  z0: number;
  z1: number;
}

export interface Course {
  segs: Seg[];
  zStart: number;
  zEnd: number;
  /** z of every leap edge (where the run ends) */
  edges: number[];
}

/** build the course from the roof list: stage, nine roofs, the jetty */
export function buildCourse(): Course {
  const segs: Seg[] = [];
  const zStart = 40.2;
  let z = zStart;
  // the stage deck, then a short hop to the first roof
  const first = CHASE_ROOFS[0];
  segs.push({ kind: 'run', z0: z, z1: first.z - roofLen(first) / 2 - 0.55 });
  z = first.z - roofLen(first) / 2 - 0.55;
  CHASE_ROOFS.forEach((r, i) => {
    const a = r.z - roofLen(r) / 2 + 0.3;
    const b = r.z + roofLen(r) / 2 - 0.3;
    segs.push({ kind: 'leap', z0: z, z1: a });
    segs.push({ kind: 'run', z0: a, z1: b });
    z = b;
    if (i === CHASE_ROOFS.length - 1) {
      const j = JETTY.a[1] + 0.8;
      segs.push({ kind: 'leap', z0: z, z1: j });
      segs.push({ kind: 'run', z0: j, z1: JETTY.b[1] - 6 });
      z = JETTY.b[1] - 6;
    }
  });
  const edges = segs.filter((s) => s.kind === 'run').map((s) => s.z1);
  edges.pop(); // the last run ends the course
  return { segs, zStart, zEnd: z, edges };
}

export interface ChaseMover extends PlayerMover {
  /** metres along the course (z - zStart) */
  readonly z: number;
  readonly done: boolean;
  readonly stumbles: number;
  /** speed multiplier from blockers and stumbles (diagnostics) */
  readonly slow: number;
  /** distance to the next leap edge (m), Infinity on the last run */
  readonly toEdge: number;
}

const _g = new THREE.Vector3();

export function makeChaseMover(level: LevelAPI, course: Course, o: { speed?: number; onEnd: () => void }): ChaseMover {
  const { ctx } = level;
  const physics = ctx.physics;
  const speed = o.speed ?? 7.6;
  let z = course.zStart;
  let lateral = 0;
  let y = D;
  let jumpBuf = 0;
  let leapT = -1;
  let leapDur = 1;
  let leapH = 1.4;
  let leapFromY = D;
  let leapToY = D;
  let leapFromZ = 0;
  let leapToZ = 0;
  let stumble = 0;
  let stumbleT = 0;
  let slow = 1;
  let doneFlag = false;
  let hint = false;
  let segIndex = 0;
  let stepT = 0;
  const m: ChaseMover = {
    pose: undefined,
    allowShoot: true,
    allowMelee: true,
    allowJump: false,
    allowDash: false,
    // the camera stays free so he can turn and shoot the archers on the roofs either side
    lockCameraYaw: false,
    camera: { distance: 5.2, height: 1.9, shoulder: 0.55, fov: 72 },
    get z() {
      return z;
    },
    get done() {
      return doneFlag;
    },
    get stumbles() {
      return stumble;
    },
    get slow() {
      return slow;
    },
    get toEdge() {
      const seg = course.segs[segIndex];
      return seg && seg.kind === 'run' && course.edges.includes(seg.z1) ? seg.z1 - z : Infinity;
    },
    update(dt, player: PlayerAPI, input) {
      if (input.jump) jumpBuf = 0.7;
      jumpBuf = Math.max(0, jumpBuf - dt);
      stumbleT = Math.max(0, stumbleT - dt);
      lateral = clamp(lateral + input.moveX * -4.2 * dt, -1.7, 1.7);
      // `moveX` > 0 is the player's right; heading north (+z) that is -x, hence the sign above
      const x = CHASE_X + lateral;

      if (doneFlag) {
        player.velocity.set(0, 0, 0);
        return;
      }

      if (leapT >= 0) {
        // airborne: a parabola from the roof edge to the next roof
        leapT += dt;
        const k = clamp(leapT / leapDur, 0, 1);
        z = THREE.MathUtils.lerp(leapFromZ, leapToZ, k);
        y = THREE.MathUtils.lerp(leapFromY, leapToY, k) + 4 * leapH * k * (1 - k);
        if (k >= 1) {
          leapT = -1;
          segIndex = Math.min(course.segs.length - 1, segIndex + 2);
          ctx.fx.dust(_g.set(x, y, z), 5, 0x6a6a6e);
          ctx.audio.play('land', { pos: player.position, volume: 0.6 });
          player.camera.shake(0.08, 0.15);
        }
      } else {
        // blockers: an orc in the way slows him to a walk until it is cut down
        slow = 1;
        let blocked = false;
        for (const c of ctx.combatants.byTeam('enemy')) {
          if (!c.alive) continue;
          const dz = c.position.z - z;
          if (dz > -0.3 && dz < 2.6 && Math.abs(c.position.x - x) < 1.7 && Math.abs(c.position.y - y) < 2.4) {
            blocked = true;
            break;
          }
        }
        if (blocked) slow = 0.3;
        if (stumbleT > 0) slow = Math.min(slow, 0.6);
        const seg = course.segs[segIndex];
        const v = speed * slow;
        z += v * dt;
        if (seg.kind === 'run') {
          if (z >= seg.z1) {
            z = seg.z1;
            if (segIndex < course.segs.length - 1) startLeap(player, x);
            else {
              doneFlag = true;
              o.onEnd();
            }
          } else {
            // the roof surface under his feet (the jetty deck on the last run)
            const g = physics.ground(x, z, y + 0.6, 1.0);
            const ty = segIndex + 1 < course.segs.length ? (g ? g.y : D) : D;
            y = damp(y, ty, 30, dt);
          }
        }
        // prompt before each gap
        const te = m.toEdge;
        const want = te < 6.5 && te > 0.4 && leapT < 0;
        if (want !== hint) {
          hint = want;
          ctx.hud.setPrompt(want ? 'jump' : null, 'Leap the gap!');
        }
        stepT -= dt * (v / 2.4);
        if (stepT <= 0 && leapT < 0) {
          stepT = 1;
          ctx.audio.play('footstep', { pos: player.position, volume: 0.35, pitch: 0.9 });
        }
      }
      player.velocity.set((x - player.position.x) / Math.max(dt, 1e-4), (y - player.position.y) / Math.max(dt, 1e-4), (z - player.position.z) / Math.max(dt, 1e-4));
      player.position.set(x, y, z);
      // run facing north; turn toward the aim while the bow is out
      const want = player.aiming ? player.camera.yaw : input.moveX * -0.12;
      let dy = want - player.facing;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.facing += dy * Math.min(1, dt * 12);
    },
  };

  function startLeap(player: PlayerAPI, x: number): void {
    const next = course.segs[segIndex + 1];
    leapFromZ = z;
    leapToZ = next.z1 + 0.5;
    leapFromY = y;
    const g = physics.ground(x, leapToZ, y + 3, 6);
    leapToY = g ? g.y : D;
    const gap = leapToZ - leapFromZ;
    const good = jumpBuf > 0;
    hint = false;
    ctx.hud.setPrompt(null);
    if (good) {
      leapDur = Math.max(0.55, gap / 8.2 + 0.18);
      leapH = 1.1 + gap * 0.12;
      ctx.audio.play('jump', { pos: player.position, volume: 0.7 });
    } else {
      // mistimed: a scrambling hop, hurt and slowed
      stumble++;
      stumbleT = 1.6;
      leapDur = Math.max(0.75, gap / 5 + 0.25);
      leapH = 0.45;
      ctx.audio.play('hurt', { volume: 0.5 });
      ctx.hud.toast('Mistimed! Press Jump before the edge', 'warning');
      player.camera.shake(0.2, 0.3);
      if (player.hp > 24) player.takeDamage({ amount: 6, type: 'fall', source: null });
    }
    leapT = 0;
    jumpBuf = 0;
    void smoothstep;
  }

  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bolg, running ahead
// ─────────────────────────────────────────────────────────────────────────────

export interface BolgRunner {
  readonly body: Humanoid;
  /** metres along the course */
  z: number;
  update(dt: number, playerZ: number): void;
  /** put him on a mount (the 'ride' pose) at a world position; null to hop off */
  dispose(): void;
}

export function makeBolgRunner(level: LevelAPI, course: Course, startZ: number, startX: number): BolgRunner {
  const { physics } = level.ctx;
  const body = createHumanoid({ kind: 'bolg', seed: 3, weapon: 'mace' });
  body.root.name = 'bolg_runner';
  level.root.add(body.root);
  body.setCastShadow(true);
  let z = startZ;
  let y = D;
  let leapT = -1;
  let leapDur = 0.8;
  let fromY = D;
  let toY = D;
  let fromZ = 0;
  let toZ = 0;
  let segIndex = 0;
  let x = startX;
  let vyNow = 0;
  const anim = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null as null | 'ride', specialT: 0, lookAt: null } as Parameters<Humanoid['animate']>[1];
  const r: BolgRunner = {
    body,
    get z() {
      return z;
    },
    set z(v: number) {
      z = v;
    },
    update(dt, playerZ) {
      // run at a pace that keeps him ~15 m ahead
      const lead = z - playerZ;
      const pace = 7.6 * clamp(1 + (15 - lead) * 0.05, 0.75, 1.3);
      let vy = 0;
      if (leapT >= 0) {
        leapT += dt;
        const k = clamp(leapT / leapDur, 0, 1);
        z = THREE.MathUtils.lerp(fromZ, toZ, k);
        const h = 1.6;
        const yy = THREE.MathUtils.lerp(fromY, toY, k) + 4 * h * k * (1 - k);
        vy = (yy - y) / Math.max(dt, 1e-4);
        y = yy;
        if (k >= 1) {
          leapT = -1;
          segIndex = Math.min(course.segs.length - 1, segIndex + 2);
        }
      } else {
        const seg = course.segs[segIndex];
        z += pace * dt;
        if (seg.kind === 'run') {
          if (z >= seg.z1 && segIndex < course.segs.length - 1) {
            z = seg.z1;
            const next = course.segs[segIndex + 1];
            fromZ = z;
            toZ = next.z1 + 0.6;
            fromY = y;
            const g = physics.ground(x, toZ, y + 3, 6);
            toY = g ? g.y : D;
            leapDur = Math.max(0.6, (toZ - fromZ) / 8.5 + 0.2);
            leapT = 0;
          } else if (segIndex < course.segs.length - 1) {
            const g = physics.ground(x, z, y + 0.6, 1.0);
            y = damp(y, g ? g.y : D, 30, dt);
          } else {
            // the last run: the jetty
            y = D;
          }
        }
      }
      vyNow = vy;
      body.root.position.set(x, y, z);
      body.root.rotation.y = 0;
      anim.speed = pace;
      anim.grounded = leapT < 0;
      anim.vy = vyNow;
      anim.special = null;
      body.animate(dt, anim);
    },
    dispose() {
      body.root.removeFromParent();
      body.dispose();
    },
  };
  void anim;
  return r;
}
