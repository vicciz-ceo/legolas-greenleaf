/**
 * Autopilot for smoke tests (?bot=1 or __game.bot(true)). Owner: shell.
 *
 * The bot never touches the player directly. It writes a synthetic InputState each frame; the game
 * hands that state to the player (through the wrapped `ctx.input`) instead of the real device state.
 * What it does:
 *   - follows ChapterInstance.botHint(): walks toward `moveTo`, faces `lookAt`, pulses `interact`
 *     and `jump` when asked,
 *   - turns toward and shoots the nearest visible enemy (draw -> release, with the right draw time),
 *   - knifes anything that gets close,
 *   - spends Focus now and then (hold, sweep across targets, release for a volley),
 *   - jumps / side-steps when it notices it is stuck.
 */
import * as THREE from 'three';
import type { Combatant, GameContext, InputState } from '../core/types';
import type { ChapterInstance } from '../core/types';
import { clamp, wrapAngle, yawOf } from '../core/math';
import { mulberry32 } from '../core/rng';
import type { CameraRigExt } from '../actors/camera';

export type BotHint = ReturnType<NonNullable<ChapterInstance['botHint']>>;

export interface Bot {
  active: boolean;
  /** the synthetic input; valid every frame, edges are cleared on the next update() */
  readonly state: InputState;
  /** current target, for diagnostics */
  readonly target: Combatant | null;
  /** compute this frame's input. Call once per frame before the simulation step. */
  update(dtReal: number): void;
  /** forget transient state (new chapter, respawn) */
  reset(): void;
}

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _aim = new THREE.Vector3();

function blank(): InputState {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    aimHeld: false, drawHeld: false, drawReleased: false,
    melee: false, jump: false, dash: false, interact: false, nextArrow: false, pause: false,
    arrowSlot: 0, focusHeld: false, focusPressed: false, focusReleased: false, sprintHeld: false,
    device: 'kbm',
  };
}

const SEE_RANGE = 55;
const MELEE_RANGE = 2.7;
const HOLD_GROUND_RANGE = 11;
const LOOK_GAIN = 0.7;
const ALIGN_TOL = 0.07;

export function createBot(ctx: GameContext, getHint: () => BotHint): Bot {
  const state = blank();
  const rnd = mulberry32(0xb07);

  let target: Combatant | null = null;
  let retargetT = 0;
  let headShot = false;

  type Draw = 'idle' | 'drawing' | 'cooldown';
  let draw: Draw = 'idle';
  let drawT = 0;
  let cooldown = 0;
  let meleeT = 0;

  let focusHold = 0; // > 0 while we hold Focus
  let focusCd = 8;
  let focusSweepT = 0;
  let focusIdx = 0;

  let interactT = 0;
  let jumpT = 0;

  const lastPos = new THREE.Vector3(1e9, 0, 0);
  let stuckT = 0;
  let strafeBias = 0;
  let strafeT = 0;

  const bot: Bot = {
    active: false,
    state,
    get target() {
      return target;
    },
    reset() {
      target = null;
      draw = 'idle';
      drawT = 0;
      cooldown = 0;
      focusHold = 0;
      focusCd = 8;
      stuckT = 0;
      strafeBias = 0;
      lastPos.set(1e9, 0, 0);
      clearEdges();
      state.drawHeld = state.aimHeld = state.focusHeld = state.sprintHeld = false;
      state.moveX = state.moveY = state.lookX = state.lookY = 0;
    },
    update(dtReal) {
      const dt = clamp(dtReal, 0, 0.1);
      clearEdges();
      const player = ctx.player;
      if (!bot.active || !player || !player.alive) {
        state.moveX = state.moveY = state.lookX = state.lookY = 0;
        state.aimHeld = state.drawHeld = state.focusHeld = state.sprintHeld = false;
        draw = 'idle';
        return;
      }

      const rig = player.camera as CameraRigExt;
      const camPos = rig.position ?? ctx.engine.camera.position;
      const hint = safeHint();

      // ── target selection ─────────────────────────────────────────────
      retargetT -= dt;
      if (!target || !target.alive || retargetT <= 0) {
        retargetT = 0.3;
        target = pickTarget(camPos, player.position);
        headShot = rnd() < 0.3;
      }

      let tDist = Infinity;
      let haveShot = false;
      if (target) {
        tDist = flatDist(target.position, player.position);
        haveShot = Math.abs(target.position.y - player.position.y) < 40;
      }

      // ── aim / look ───────────────────────────────────────────────────
      let desYaw = rig.yaw;
      let desPitch = -0.1;
      let aimingAtTarget = false;
      const focusing = focusHold > 0;
      if (focusing && focusSweepT <= 0) {
        // sweep the crosshair across the nearest few enemies so Focus marks them
        const list = nearestEnemies(player.position, 35, 6);
        if (list.length) {
          focusIdx = (focusIdx + 1) % list.length;
          target = list[focusIdx];
        }
        focusSweepT = 0.22;
      }
      focusSweepT -= dt;

      if (target && haveShot && tDist < SEE_RANGE) {
        aimPointOf(target, headShot && tDist < 30 && !focusing, _aim);
        _d.copy(_aim).sub(camPos);
        desYaw = yawOf(_d.x, _d.z);
        desPitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
        aimingAtTarget = true;
      } else if (hint?.lookAt) {
        _d.copy(hint.lookAt).sub(player.position);
        desYaw = yawOf(_d.x, _d.z);
        desPitch = -0.12;
      } else if (hint?.moveTo) {
        _d.copy(hint.moveTo).sub(player.position);
        if (_d.x * _d.x + _d.z * _d.z > 1) desYaw = yawOf(_d.x, _d.z);
        desPitch = -0.12;
      } else if (target) {
        _d.copy(target.position).sub(player.position);
        desYaw = yawOf(_d.x, _d.z);
      }
      const yawErr = wrapAngle(desYaw - rig.yaw);
      const pitchErr = desPitch - rig.pitch;
      state.lookX = clamp(-yawErr * LOOK_GAIN, -0.6, 0.6); // + = turn right = yaw decreases
      state.lookY = clamp(pitchErr * LOOK_GAIN, -0.4, 0.4);
      const aligned = Math.abs(yawErr) < ALIGN_TOL && Math.abs(pitchErr) < ALIGN_TOL * 1.4;

      // ── bow ──────────────────────────────────────────────────────────
      cooldown -= dt;
      meleeT -= dt;
      const drawTime = Math.max(0.2, player.stats?.drawTime ?? 0.55);
      const engaged = player.focusActive;
      const wantDraw = aimingAtTarget && !focusing && !engaged && tDist >= 3.2 && tDist < SEE_RANGE;
      if (draw === 'cooldown' && cooldown <= 0) draw = 'idle';
      state.aimHeld = aimingAtTarget && !focusing && !engaged;
      state.drawHeld = false;
      if (draw === 'drawing') {
        if (!wantDraw) {
          // lost the target while drawing: loose anyway so the state machine recovers
          draw = 'cooldown';
          cooldown = 0.12;
          state.drawReleased = true;
        } else {
          drawT += dt;
          state.drawHeld = true;
          if (drawT >= drawTime * 1.08 && (aligned || drawT > drawTime * 3)) {
            state.drawHeld = false;
            state.drawReleased = true;
            draw = 'cooldown';
            cooldown = 0.16;
          }
        }
      } else if (draw === 'idle' && wantDraw && aligned) {
        draw = 'drawing';
        drawT = 0;
        state.drawHeld = true;
      }

      // ── knives ───────────────────────────────────────────────────────
      const close = nearestEnemies(player.position, MELEE_RANGE + 0.6, 1)[0];
      if (close && draw !== 'drawing' && !focusing && !engaged && meleeT <= 0) {
        state.melee = true;
        meleeT = 0.36;
        // face the attacker: the lunge heads to the nearest enemy, camera yaw drives facing in melee
        _d.copy(close.position).sub(player.position);
        state.lookX = clamp(-wrapAngle(yawOf(_d.x, _d.z) - rig.yaw) * LOOK_GAIN, -0.6, 0.6);
      }

      // ── focus ────────────────────────────────────────────────────────
      focusCd -= dt;
      if (focusHold > 0) {
        focusHold -= dt;
        state.focusHeld = true;
        if (focusHold <= 0) {
          state.focusHeld = false;
          state.focusReleased = true;
          focusCd = 12 + rnd() * 10;
        }
      } else if (
        focusCd <= 0 && !engaged && draw === 'idle' &&
        player.focus >= Math.max(40, (player.stats?.focusMax ?? 100) * 0.6) &&
        nearestEnemies(player.position, 35, 3).length >= 3
      ) {
        focusHold = 0.8 + rnd() * 0.5;
        focusSweepT = 0;
        state.focusHeld = true;
        state.focusPressed = true;
      } else state.focusHeld = false;

      // ── movement ─────────────────────────────────────────────────────
      let mx = 0;
      let my = 0;
      let moving = false;
      let wantMove = false;
      const hold = target && haveShot && tDist < HOLD_GROUND_RANGE && target.alive;
      if (!focusing && !engaged) {
        let goal: THREE.Vector3 | null = null;
        if (hint?.moveTo) goal = hint.moveTo;
        else if (target && tDist > 16 && tDist < SEE_RANGE) goal = target.position; // walk toward the fight
        if (goal && !hold) {
          _v.copy(goal).sub(player.position).setY(0);
          const dist = _v.length();
          if (dist > 1.2) {
            _v.divideScalar(dist);
            const cy = Math.cos(rig.yaw);
            const sy = Math.sin(rig.yaw);
            my = _v.x * sy + _v.z * cy;
            mx = -_v.x * cy + _v.z * sy;
            wantMove = true;
            moving = true;
            state.sprintHeld = dist > 8 && !aimingAtTarget && my > 0.35;
          }
        } else if (hold) {
          // fighting from a spot: circle-strafe a little so ranged enemies miss
          strafeT -= dt;
          if (strafeT <= 0) {
            strafeT = 0.8 + rnd() * 0.8;
            strafeBias = rnd() < 0.5 ? -1 : 1;
          }
          mx = strafeBias * 0.5;
          // back off from melee brutes if they are on top of us and we are drawing the bow
          if (tDist < 3.5 && !state.melee) my = -0.6;
        }
      }
      if (!moving) state.sprintHeld = false;

      // stuck detection: wanted to move, did not get anywhere
      if (wantMove) {
        if (lastPos.x > 1e8) lastPos.copy(player.position);
        stuckT += dt;
        if (stuckT >= 0.7) {
          const moved = Math.hypot(player.position.x - lastPos.x, player.position.z - lastPos.z);
          if (moved < 0.7) {
            state.jump = true;
            strafeBias = rnd() < 0.5 ? -1 : 1;
            strafeT = 0.7;
            if (rnd() < 0.4) state.dash = true;
          }
          stuckT = 0;
          lastPos.copy(player.position);
        }
        if (strafeT > 0) {
          strafeT -= dt;
          mx = clamp(mx + strafeBias * 0.8, -1, 1);
        }
      } else {
        stuckT = 0;
        lastPos.set(1e9, 0, 0);
      }
      state.moveX = clamp(mx, -1, 1);
      state.moveY = clamp(my, -1, 1);

      // ── chapter requests ─────────────────────────────────────────────
      interactT -= dt;
      jumpT -= dt;
      if (hint?.interact && interactT <= 0) {
        state.interact = true;
        interactT = 0.25;
      }
      if (hint?.jump && jumpT <= 0 && player.grounded) {
        state.jump = true;
        jumpT = 0.55;
      }
    },
  };

  function clearEdges(): void {
    state.melee = state.jump = state.dash = state.interact = state.nextArrow = state.pause = false;
    state.drawReleased = state.focusPressed = state.focusReleased = false;
    state.arrowSlot = 0;
  }

  function safeHint(): BotHint {
    try {
      return getHint();
    } catch {
      return null;
    }
  }

  function flatDist(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function aimPointOf(c: Combatant, head: boolean, out: THREE.Vector3): THREE.Vector3 {
    const h = (c as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 }).headPoint;
    if (head && h) return h.call(c, out);
    return c.aimPoint(out);
  }

  function isHostile(c: Combatant): boolean {
    return c.alive && c.team === 'enemy' && c.targetable;
  }

  /** nearest hostile that is not behind a wall; falls back to the nearest one if all are hidden */
  function pickTarget(camPos: THREE.Vector3, from: THREE.Vector3): Combatant | null {
    let best: Combatant | null = null;
    let bd = Infinity;
    let hidden: Combatant | null = null;
    let hd = Infinity;
    for (const c of ctx.combatants.byTeam('enemy')) {
      if (!isHostile(c)) continue;
      const d = flatDist(c.position, from);
      if (d > SEE_RANGE) continue;
      c.aimPoint(_o);
      _d.copy(_o).sub(camPos);
      const len = _d.length();
      if (len < 0.5) continue;
      _d.divideScalar(len);
      const wall = ctx.physics.raycast(camPos, _d, len - 0.5, 'arrows');
      if (!wall) {
        if (d < bd) {
          bd = d;
          best = c;
        }
      } else if (d < hd) {
        hd = d;
        hidden = c;
      }
    }
    return best ?? (hd < 18 ? hidden : null);
  }

  const _list: Combatant[] = [];
  function nearestEnemies(from: THREE.Vector3, range: number, max: number): Combatant[] {
    _list.length = 0;
    for (const c of ctx.combatants.byTeam('enemy')) {
      if (!isHostile(c)) continue;
      if (flatDist(c.position, from) > range) continue;
      _list.push(c);
    }
    _list.sort((a, b) => flatDist(a.position, from) - flatDist(b.position, from));
    if (_list.length > max) _list.length = max;
    return _list;
  }

  return bot;
}
