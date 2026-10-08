/**
 * Focus: hold to ease time to 0.2, sweep the crosshair over enemies to mark them (KB+M:
 * within ~70 px of the target's aim point; gamepad/touch: auto-mark the nearest N in view),
 * release to loose homing arrows at each mark, 0.07 s apart in REAL time, with glowing trails.
 * Slow-mo is held through the volley and eased out after the last arrow.
 *
 * The meter drains while active (real time). Refill (+12 per kill) is done by the player's
 * onKill handler. Drives engine.post.focusTint, audio.setSlowmo and hud.setFocusMarks.
 */
import * as THREE from 'three';
import type { Combatant, CombatRayHit, GameContext, InputState, PlayerStats } from '../core/types';
import { clamp, damp } from '../core/math';
import { hostile } from '../actors/combatant';
import type { ArrowShotExt } from './projectiles';

export interface FocusHost {
  readonly self: Combatant;
  focus: number;
  readonly stats: PlayerStats;
  /** world position where arrows leave the bow */
  bowOrigin(out: THREE.Vector3): THREE.Vector3;
  /** a volley arrow was loosed (tally) */
  onShot(): void;
  onArrowHit(target: Combatant, hit: CombatRayHit): void;
}

export type FocusState = 'idle' | 'active' | 'volley';

export interface FocusController {
  readonly state: FocusState;
  /** active or loosing the volley */
  readonly engaged: boolean;
  readonly marks: readonly Combatant[];
  /** 0..1 eased tint/slowmo amount */
  readonly blend: number;
  /** 0..1 bow-draw pulse during the volley (animation) */
  readonly drawPulse: number;
  update(dtReal: number, input: InputState, canUse: boolean): void;
  /** abort without firing; restores time */
  cancel(): void;
  /** was c a target of a Focus volley (kills by the volley refill the meter at a quarter of the rate) */
  wasVolleyTarget(c: Combatant): boolean;
}

export const FOCUS_SCALE = 0.2;
export const FOCUS_MARK_PX = 70;
export const FOCUS_INTERVAL = 0.07;
const FOCUS_DRAIN_SECONDS = 3.4; // full meter lasts this long in real time
const MIN_TO_START = 8;
const TRAIL_COLOR = 0xcfeeff;

const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createFocus(ctx: GameContext, host: FocusHost): FocusController {
  let state: FocusState = 'idle';
  const marks: Combatant[] = [];
  let volleyIdx = 0;
  let volleyT = 0;
  let blend = 0;
  let drawPulse = 0;
  let autoT = 0;
  let cooldown = 0;
  const points: { x: number; y: number; locked: boolean }[] = [];
  const pointPool: { x: number; y: number; locked: boolean }[] = [];
  let shownMarks = 0;
  /** meter drained since entering (refunded when a stagger interrupts Focus before the volley) */
  let spent = 0;
  /** "not enough Focus" feedback throttle (real seconds) */
  let deniedT = 0;
  const volleyTargets = new WeakSet<Combatant>();

  function screenOf(c: Combatant, out: { x: number; y: number }): boolean {
    const cam = ctx.engine.camera;
    c.aimPoint(_v);
    _d.copy(_v).sub(cam.position);
    // behind the camera?
    _o.set(0, 0, -1).applyQuaternion(cam.quaternion);
    if (_d.dot(_o) <= 0.5) return false;
    _v.project(cam);
    if (_v.z > 1 || Math.abs(_v.x) > 1.02 || Math.abs(_v.y) > 1.02) return false;
    const el = ctx.engine.canvas;
    const w = el.clientWidth || innerWidth;
    const h = el.clientHeight || innerHeight;
    out.x = ((_v.x + 1) / 2) * w;
    out.y = ((1 - _v.y) / 2) * h;
    return true;
  }

  function hasLos(c: Combatant): boolean {
    const cam = ctx.engine.camera;
    c.aimPoint(_v);
    _d.copy(_v).sub(cam.position);
    const dist = _d.length();
    if (dist < 1e-3) return true;
    _d.divideScalar(dist);
    return ctx.physics.raycast(cam.position, _d, dist - 0.4, 'arrows') === null;
  }

  function candidates(): Combatant[] {
    const out = candList;
    out.length = 0;
    const me = host.self;
    for (const c of ctx.combatants.all()) {
      if (!c.alive || !c.targetable || !hostile(me.team, c.team)) continue;
      if (c.position.distanceToSquared(me.position) > 90 * 90) continue;
      out.push(c);
    }
    return out;
  }
  const candList: Combatant[] = [];
  const scr = { x: 0, y: 0 };

  function enter() {
    state = 'active';
    spent = 0;
    marks.length = 0;
    autoT = 0;
    ctx.time.setScale(FOCUS_SCALE, 0.25);
    ctx.audio.play('focus_in', { volume: 0.9 });
  }

  function exitNoFire() {
    state = 'idle';
    marks.length = 0;
    ctx.time.setScale(1, 0.3);
    ctx.audio.play('focus_out', { volume: 0.7 });
    cooldown = 0.35;
  }

  function startVolley() {
    state = 'volley';
    for (const m of marks) volleyTargets.add(m);
    volleyIdx = 0;
    volleyT = 0; // first arrow immediately
  }

  function fireAt(target: Combatant) {
    const t = target as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 };
    if (t.headPoint) t.headPoint(_v);
    else t.aimPoint(_v);
    host.bowOrigin(_o);
    _d.copy(_v).sub(_o).normalize();
    const shot: ArrowShotExt = {
      origin: _o.clone(),
      dir: _d.clone(),
      speed: 78,
      damage: host.stats.arrowDamage * 2,
      team: host.self.team,
      owner: host.self,
      type: 'standard',
      homing: target,
      gravity: 0,
      style: 'elven',
      trail: TRAIL_COLOR,
      homingRate: 14,
      onHit: (c, hit) => host.onArrowHit(c, hit),
    };
    ctx.projectiles.fire(shot);
    ctx.audio.play('focus_fire', { volume: 0.8, pitch: 1 + volleyIdx * 0.04 });
    ctx.audio.play('bow_release', { volume: 0.7 });
    host.onShot();
    drawPulse = 1;
  }

  function pushPoint(x: number, y: number, locked: boolean) {
    const p = pointPool[points.length] ?? (pointPool[points.length] = { x: 0, y: 0, locked: false });
    p.x = x;
    p.y = y;
    p.locked = locked;
    points.push(p);
  }

  function publishMarks(showCandidates: boolean) {
    points.length = 0;
    const el = ctx.engine.canvas;
    const w = el.clientWidth || innerWidth;
    const h = el.clientHeight || innerHeight;
    for (let i = state === 'volley' ? volleyIdx : 0; i < marks.length; i++) {
      const c = marks[i];
      if (c.alive && screenOf(c, scr)) pushPoint(scr.x, scr.y, true);
    }
    if (showCandidates) {
      const r = markRadius(h) * 3.5;
      for (const c of candList) {
        if (marks.includes(c) || points.length >= 16) continue;
        if (!screenOf(c, scr)) continue;
        if (Math.hypot(scr.x - w / 2, scr.y - h / 2) < r) pushPoint(scr.x, scr.y, false);
      }
    }
    if (points.length || shownMarks) ctx.hud.setFocusMarks(points);
    shownMarks = points.length;
  }

  const markRadius = (h: number) => FOCUS_MARK_PX * clamp(h / 800, 0.8, 1.6);

  const api: FocusController = {
    get state() {
      return state;
    },
    get engaged() {
      return state !== 'idle';
    },
    marks,
    get blend() {
      return blend;
    },
    get drawPulse() {
      return drawPulse;
    },
    update(dtReal, input, canUse) {
      const dt = Math.min(dtReal, 0.1);
      cooldown = Math.max(0, cooldown - dt);
      drawPulse = Math.max(0, drawPulse - dt / 0.07);
      deniedT = Math.max(0, deniedT - dt);
      if (state === 'idle') {
        if (canUse && input.focusPressed && cooldown <= 0) {
          if (host.focus >= MIN_TO_START) enter();
          else if (deniedT <= 0) {
            // tell the player why nothing happened
            deniedT = 1.2;
            ctx.audio.play('ui_back', { volume: 0.6, pitch: 0.7 });
            ctx.hud.toast('Not enough Focus', 'warning');
          }
        }
      } else if (state === 'active') {
        if (!canUse) {
          // interrupted (stagger, stun, weapons off) before the volley: give the drained meter back
          host.focus = Math.min(host.stats.focusMax, host.focus + spent);
          api.cancel();
        } else {
          const drain = Math.min(host.focus, (host.stats.focusMax / FOCUS_DRAIN_SECONDS) * dt);
          host.focus -= drain;
          spent += drain;
          const max = Math.max(1, host.stats.focusTargets);
          const list = candidates();
          if (marks.length < max) {
            if (input.device === 'kbm') {
              const el = ctx.engine.canvas;
              const w = el.clientWidth || innerWidth;
              const h = el.clientHeight || innerHeight;
              const r = markRadius(h);
              for (const c of list) {
                if (marks.length >= max) break;
                if (marks.includes(c) || !screenOf(c, scr)) continue;
                if (Math.hypot(scr.x - w / 2, scr.y - h / 2) > r) continue;
                if (!hasLos(c)) continue;
                marks.push(c);
                ctx.audio.play('focus_mark', { pitch: 1 + marks.length * 0.06 });
              }
            } else {
              autoT -= dt;
              if (autoT <= 0) {
                // nearest unmarked target in view
                let best: Combatant | null = null;
                let bd = Infinity;
                for (const c of list) {
                  if (marks.includes(c) || !screenOf(c, scr)) continue;
                  const d = c.position.distanceToSquared(host.self.position);
                  if (d < bd && hasLos(c)) {
                    bd = d;
                    best = c;
                  }
                }
                if (best) {
                  marks.push(best);
                  ctx.audio.play('focus_mark', { pitch: 1 + marks.length * 0.06 });
                  autoT = 0.12;
                }
              }
            }
          }
          // drop marks that died meanwhile
          for (let i = marks.length - 1; i >= 0; i--) if (!marks[i].alive) marks.splice(i, 1);
          const release = input.focusReleased || !input.focusHeld || host.focus <= 0;
          if (release) {
            if (marks.length) startVolley();
            else exitNoFire();
          }
        }
      }
      if (state === 'volley') {
        volleyT -= dt;
        while (state === 'volley' && volleyT <= 0) {
          // skip targets that died before their arrow
          while (volleyIdx < marks.length && !marks[volleyIdx].alive) volleyIdx++;
          if (volleyIdx >= marks.length) {
            state = 'idle';
            marks.length = 0;
            ctx.time.setScale(1, 0.45);
            ctx.audio.play('focus_out', { volume: 0.8 });
            cooldown = 0.5;
            break;
          }
          fireAt(marks[volleyIdx++]);
          volleyT += FOCUS_INTERVAL;
        }
      }
      if (state !== 'idle') publishMarks(state === 'active');
      else if (shownMarks) publishMarks(false);

      const prev = blend;
      blend = damp(blend, state === 'idle' ? 0 : 1, state === 'idle' ? 6 : 9, dt);
      if (blend < 0.002) blend = 0;
      // only drive tint/slow-mo while Focus owns them (leave cinematics alone otherwise)
      if (blend > 0 || prev > 0) {
        ctx.engine.post.focusTint = blend;
        ctx.audio.setSlowmo(blend);
      }
    },
    wasVolleyTarget(c) {
      return volleyTargets.has(c);
    },
    cancel() {
      if (state === 'idle') return;
      state = 'idle';
      marks.length = 0;
      ctx.time.setScale(1, 0.2);
      cooldown = 0.3;
      publishMarks(false);
    },
  };
  return api;
}
