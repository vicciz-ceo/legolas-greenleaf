/**
 * The two PlayerMovers of the chapter.
 *
 *   makeBankRun   cp1: an auto-forward run along the left bank (8 m/s, stronger or slower with the
 *                 forward stick), steering left/right on the shelf, jumping the side-stream clefts
 *                 and the boulders, shooting across the river. It ends at the launch rock, where the
 *                 runner waits for the barrels and leaps onto one.
 *   makeBarrelRide cp2: the barrel ride. Legolas stands on the dwarves' heads. Left/right + Jump hops
 *                 to the barrel in that direction (a ring marks the target), Jump alone hops in place
 *                 (a low log is cleared that way). A miss, a log or a shove splashes him into the
 *                 river: 10 HP, a moment adrift, then he is back on the nearest barrel.
 */
import * as THREE from 'three';
import type { LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle, yawOf } from '../../../core/math';
import { CLEFTS, CLEFT_WIDTH, LOW_LOGS, S, RIVER_LEN, flowSpeedAt, flowYaw, riverPath, shelfLeft, tangentAt, waterY, widthAt, RUN_OFFSET } from './layout';
import { STAND_H, type Barrel, type BarrelTrain } from './train';

const GRAVITY = 22;
const _t = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// Bank run
// ─────────────────────────────────────────────────────────────────────────────

export interface BankRun extends PlayerMover {
  /** river s of the runner */
  s: number;
  /** 'run' while auto-forward, 'wait' once he reached the launch rock */
  state: 'run' | 'wait';
  /** seconds spent waiting at the launch rock */
  waited: number;
  grounded: boolean;
  /** consumed by the script: set when the player pressed jump at the rock */
  leapRequested: boolean;
  /** a cleft is coming up within this many metres (for the bot and the prompt), else -1 */
  nextCleft: number;
  /** true while the next obstacle ahead wants a jump (bot hint) */
  wantsJump: boolean;
  /** a cleft is coming within about 1.2 s: the prompt shows (earlier than wantsJump, which is the jump window) */
  cleftSoon: boolean;
  /** how many times the runner has dropped into a cleft */
  falls: number;
}

export function makeBankRun(level: LevelAPI, startS: number): BankRun {
  const { physics, fx, audio } = level.ctx;
  // the smoke-test autopilot cannot time a jump reliably: it gets a nudge (real players never do)
  const assist = level.ctx.flags.bot === '1';
  let vy = 0;
  let jumps = 0;
  let coyote = 0;
  let stumble = 0;
  let hsx = 0;
  let hsz = 0;
  let safeT = 0;
  let splashCd = 0;
  let lookIdle = 0;
  const safe = new THREE.Vector3();
  let safeSet = false;
  let initDone = false;
  const run: BankRun = {
    s: startS,
    state: 'run',
    waited: 0,
    grounded: true,
    leapRequested: false,
    nextCleft: -1,
    wantsJump: false,
    cleftSoon: false,
    falls: 0,
    pose: null,
    allowShoot: true,
    allowMelee: true,
    allowDash: false,
    allowJump: false,
    lockCameraYaw: false,
    camera: { distance: 3.8, height: 1.7, shoulder: 0.7, fov: 72 },
    update(dt: number, player: PlayerAPI, input) {
      if (!initDone) {
        initDone = true;
        player.camera.yaw = flowYaw(startS);
        safe.copy(player.position);
        safeSet = true;
      }
      const pos = player.position;
      const nr = riverPath.nearest(pos.x, pos.z);
      run.s = nr.s;
      // on the stairs the camera rides high and dead-centre (the cheek walls would swallow a shoulder camera), then settles over his shoulder
      const cam = run.camera!;
      const settle = smoothstep(S.runStart + 3, S.runStart + 14, nr.s);
      cam.shoulder = 0.7 * settle;
      cam.height = lerp(2.5, 1.7, settle);
      cam.distance = lerp(3.0, 3.8, settle);
      const hw = widthAt(nr.s) / 2;
      tangentAt(nr.s, _t);
      _r.set(-_t.z, 0, _t.x); // right of travel = toward the water on the left bank
      const waiting = run.state === 'wait';
      // ── horizontal ──
      const fwd = waiting ? 0 : 8.2 + 1.9 * clamp(input.moveY, -1, 1);
      const speed = fwd * (stumble > 0 ? 0.55 : 1);
      const lat = input.moveX * 5.2;
      const wvx = _t.x * speed + _r.x * lat;
      const wvz = _t.z * speed + _r.z * lat;
      hsx = damp(hsx, wvx, 14, dt);
      hsz = damp(hsz, wvz, 14, dt);
      stumble = Math.max(0, stumble - dt);
      const x0 = pos.x;
      const z0 = pos.z;
      pos.x += hsx * dt;
      pos.z += hsz * dt;
      // stay on the shelf: not into the water, not up the cliff
      const nr2 = riverPath.nearest(pos.x, pos.z);
      const e = -nr2.signed - widthAt(nr2.s) / 2;
      const eMax = Math.max(2.0, Math.min(8.5, shelfLeft(nr2.s) - 0.9));
      const eMin = 1.1;
      tangentAt(nr2.s, _t);
      _r.set(-_t.z, 0, _t.x);
      if (e < eMin) {
        pos.x -= _r.x * (eMin - e);
        pos.z -= _r.z * (eMin - e);
      } else if (e > eMax) {
        pos.x += _r.x * (e - eMax);
        pos.z += _r.z * (e - eMax);
      }
      // boulders, logs, trunks, stair cheeks push him aside (hop them to clear)
      if (physics.collide(pos, 0.34, 1.75, 0.5)) {
        if (stumble <= 0 && Math.hypot(hsx, hsz) > 4) {
          stumble = 0.35;
          audio.play('footstep_stone', { pos, volume: 0.6 });
        }
      }
      void hw;
      // ── vertical: gravity over the terrain and anything walkable ──
      coyote -= dt;
      // after a few drops into the same cleft the runner is helped over it (a real player's way out of a fall loop)
      const helped = run.falls >= 3 && run.wantsJump && run.grounded;
      const wantJump = input.jump || ((assist || helped) && run.wantsJump && run.grounded);
      if (wantJump && (run.grounded || coyote > 0 || jumps < 2)) {
        const second = !(run.grounded || coyote > 0);
        if (!second || jumps < 2) {
          vy = second ? 7.6 : 8.6;
          jumps = second ? 2 : 1;
          run.grounded = false;
          coyote = 0;
          audio.play('jump', { pos, volume: 0.8 });
        }
      }
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      const g = physics.ground(pos.x, pos.z, pos.y + 0.1, 0.55);
      const gy = g ? g.y : -50;
      if (pos.y <= gy + 0.001) {
        if (!run.grounded && vy < -6) fx.dust(pos, 4, 0x6a6a52);
        pos.y = gy;
        vy = 0;
        run.grounded = true;
        coyote = 0.1;
        jumps = 0;
      } else if (run.grounded && pos.y - gy > 0.3) {
        run.grounded = false;
        coyote = 0.1;
      }
      // ── fell into a cleft: back to the last good footing ──
      const water = waterY(nr2.s);
      splashCd -= dt;
      if (run.grounded && gy < water - 0.12 && splashCd <= 0) {
        splashCd = 1.0;
        fx.splash(pos, 1.6);
        audio.play('splash', { pos, volume: 0.9 });
        run.falls++;
        player.takeDamage({ amount: 8, type: 'fall', source: null });
        player.camera.shake(0.2, 0.3);
        if (safeSet) pos.copy(safe);
        hsx = _t.x * 5;
        hsz = _t.z * 5;
        vy = 0;
      }
      // remember good footing, never right at a cleft's lip
      safeT -= dt;
      if (run.grounded && safeT <= 0 && gy > water + 0.2) {
        const nearCleft = CLEFTS.some((c) => Math.abs(nr2.s - c) < CLEFT_WIDTH / 2 + 3.2);
        if (!nearCleft) {
          safe.copy(pos);
          safeSet = true;
          safeT = 0.25;
        }
      }
      // ── the end of the run ──
      if (!waiting && run.s >= S.runEnd - 2) run.state = 'wait';
      if (waiting) {
        run.waited += dt;
        if (input.jump) run.leapRequested = true;
      }
      // what is ahead (bot and prompts)
      run.nextCleft = -1;
      run.wantsJump = false;
      run.cleftSoon = false;
      for (const c of CLEFTS) {
        const ahead = c - run.s;
        if (ahead > -1 && ahead < 40) {
          run.nextCleft = ahead;
          if (ahead < 4.6 && ahead > 0.4) run.wantsJump = true;
          if (ahead < 11 && ahead > 0.4) run.cleftSoon = true;
          break;
        }
      }
      // ── facing and camera ──
      player.velocity.set(hsx, vy, hsz);
      const sp = Math.hypot(hsx, hsz);
      const yawMove = sp > 0.5 ? yawOf(hsx, hsz) : player.facing;
      const rig = player.camera;
      if (player.aiming) player.facing = dampAngle(player.facing, rig.yaw, 14, dt);
      else {
        player.facing = dampAngle(player.facing, yawMove, 10, dt);
        // the view drifts back behind him unless he is looking around
        lookIdle = Math.abs(input.lookX) > 1e-4 || Math.abs(input.lookY) > 1e-4 ? 0 : lookIdle + dt;
        if (lookIdle > 1.2) rig.yaw = dampAngle(rig.yaw, yawMove, 1.6, dt);
      }
      void x0;
      void z0;
      void lerp;
      void wrapAngle;
      void RIVER_LEN;
      void RUN_OFFSET;
    },
  };
  return run;
}

// ─────────────────────────────────────────────────────────────────────────────
// Barrel ride
// ─────────────────────────────────────────────────────────────────────────────

export interface RideHooks {
  /** called when Legolas lands on a barrel after a hop (not on the first landing) */
  onLand?(b: Barrel): void;
  /** called when he falls in */
  onSplash?(reason: 'miss' | 'log' | 'knocked'): void;
}

export interface BarrelRide extends PlayerMover {
  state: 'on' | 'hop' | 'swim';
  cur: Barrel;
  /** the barrel the hop ring currently marks (or null) */
  target: Barrel | null;
  /** true while Legolas is in the air (a log passing under him is harmless) */
  airborne: boolean;
  /** seconds until the next low log reaches HIS barrel, or -1 */
  logIn: number;
  /** distance in metres to the next low log ahead of the convoy lead, -1 if none near */
  nextLogS: number;
  /** a hop is wanted by the autopilot to clear a log */
  wantsJump: boolean;
  /** set to force a swim (script: knocked off) */
  knockOff(reason: 'log' | 'knocked'): void;
  /** the marker ring mesh (add it to the level root) */
  ring: THREE.Object3D;
  /** total hop count (stats) */
  hops: number;
  setHooks(h: RideHooks): void;
}

/** Where a barrel will be `t` seconds from now (stand point) */
function predictStand(b: Barrel, t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(b.stand).addScaledVector(b.vel, t);
}

export function makeBarrelRide(level: LevelAPI, train: BarrelTrain, from: { barrel: Barrel; pos?: THREE.Vector3 }): BarrelRide {
  const { audio, fx } = level.ctx;
  const assist = level.ctx.flags.bot === '1';
  let hooks: RideHooks = {};
  let HOP_T = 0.62;
  let t = 0;
  let hopT = 0;
  let hopFrom = new THREE.Vector3();
  let hopTo: Barrel = from.barrel;
  let hopHeight = 1.1;
  let swimT = 0;
  let lookIdle = 0;
  let lastTrainS = from.barrel.s;
  let airT = 0;
  const startPos = from.pos ? from.pos.clone() : null;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.045, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xcff7c8, transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 5;
  ring.userData.noAO = true;
  const ringGroup = new THREE.Group();
  ringGroup.add(ring);
  ringGroup.visible = false;

  const ride: BarrelRide = {
    state: startPos ? 'hop' : 'on',
    cur: from.barrel,
    target: null,
    airborne: false,
    logIn: -1,
    nextLogS: -1,
    wantsJump: false,
    ring: ringGroup,
    hops: 0,
    pose: 'barrel',
    poseT: () => (t * 0.35) % 1,
    allowShoot: true,
    allowMelee: true,
    allowDash: false,
    allowJump: false,
    lockCameraYaw: false,
    camera: { distance: 4.3, height: 1.85, shoulder: 0.55, fov: 70 },
    setHooks(h) {
      hooks = h;
    },
    knockOff(reason) {
      if (ride.state === 'swim') return;
      splash(reason);
    },
    update(dt: number, player: PlayerAPI, input) {
      t += dt;
      const pos = player.position;
      const rig = player.camera;
      const cur = ride.cur;
      // ── hop target: the barrel in the stick direction (or ahead when the stick is idle) ──
      if (ride.state === 'on') {
        ride.target = pickTarget(input.moveX, input.moveY);
      } else if (ride.state === 'swim') ride.target = null;
      // ── state machine ──
      if (ride.state === 'on') {
        cur.rider = 'player';
        pos.copy(cur.stand);
        // a little sway so he reads as balancing
        pos.x += Math.sin(t * 2.3) * 0.02;
        player.velocity.copy(cur.vel);
        ride.airborne = false;
        airT = 0;
        if (input.jump || (assist && ride.wantsJump)) {
          if (input.jump && ride.target) startHop(ride.target, 1.1, 0.62);
          else startHop(cur, 1.3, 0.8); // a bounce in place: clears a log
        }
      } else if (ride.state === 'hop') {
        hopT += dt;
        const u = clamp(hopT / HOP_T, 0, 1);
        predictStand(hopTo, HOP_T * (1 - u), _p);
        const e = u * u * (3 - 2 * u);
        pos.lerpVectors(hopFrom, _p, e);
        pos.y += 4 * hopHeight * u * (1 - u);
        player.velocity.set((_p.x - hopFrom.x) / HOP_T, (u < 0.5 ? 5 : -5), (_p.z - hopFrom.z) / HOP_T);
        ride.airborne = u > 0.04 && u < 0.96;
        if (u >= 1) land();
      } else {
        // adrift: the current carries him, then back onto the nearest barrel
        swimT += dt;
        const n = riverPath.nearest(pos.x, pos.z);
        const sp = flowSpeedAt(n.s) * 0.8;
        tangentAt(n.s, _t);
        pos.x += _t.x * sp * dt;
        pos.z += _t.z * sp * dt;
        pos.y = damp(pos.y, waterY(n.s) - 0.75, 6, dt);
        player.velocity.set(_t.x * sp, 0, _t.z * sp);
        ride.airborne = false;
        if (swimT > 1.1) {
          const b = nearestFree(pos);
          ride.cur.rider = null;
          hopFrom.copy(pos);
          hopTo = b;
          hopT = 0;
          HOP_T = 0.7;
          hopHeight = 1.6;
          ride.state = 'hop';
          ride.pose = 'barrel';
          audio.play('jump', { pos, volume: 0.8 });
        }
      }
      // ── low logs: passing under a rider who is on the barrel knocks him in ──
      const sNow = ride.cur.s;
      ride.logIn = -1;
      ride.nextLogS = -1;
      ride.wantsJump = false;
      for (const ll of LOW_LOGS) {
        const ahead = ll.s - sNow;
        if (ahead > -2 && ahead < 40) {
          ride.nextLogS = ahead;
          const spd = Math.max(2, ride.cur.vel.length());
          ride.logIn = ahead / spd;
          if (ahead > 2.2 && ahead < Math.max(5.4, spd * 0.55)) ride.wantsJump = true;
        }
        if (ride.state === 'on' && lastTrainS < ll.s && sNow >= ll.s && !ride.airborne) {
          splash('log');
        }
      }
      lastTrainS = sNow;
      // ── marker ring over the hop target ──
      if (ride.state === 'on' && ride.target && ride.target !== ride.cur) {
        ringGroup.visible = ring.visible = true;
        ringGroup.position.copy(ride.target.stand);
        ringGroup.position.y += 0.1;
        const k = 1 + Math.sin(t * 8) * 0.06;
        ring.scale.setScalar(k);
      } else ringGroup.visible = ring.visible = false;
      // ── facing and camera ──
      const yawFlow = flowYaw(ride.cur.s);
      if (player.aiming) player.facing = dampAngle(player.facing, rig.yaw, 14, dt);
      else {
        player.facing = dampAngle(player.facing, yawFlow, 8, dt);
        lookIdle = Math.abs(input.lookX) > 1e-4 || Math.abs(input.lookY) > 1e-4 ? 0 : lookIdle + dt;
        if (lookIdle > 1.4) rig.yaw = dampAngle(rig.yaw, yawFlow, 1.4, dt);
      }
      void airT;
      void lerp;
      void wrapAngle;
      void fx;
    },
  };

  function barrelsOk(b: Barrel): boolean {
    return !b.smashed && b.rider === null;
  }

  /** the barrel to hop to for a stick direction (x right, y forward) or null */
  function pickTarget(mx: number, my: number): Barrel | null {
    const cur = ride.cur;
    const right = _q.set(0, 0, 0);
    tangentAt(cur.s, _t);
    right.set(-_t.z, 0, _t.x);
    let dx = mx;
    let dz = my;
    if (Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2) {
      dx = 0;
      dz = 1;
    }
    const dl = Math.hypot(dx, dz);
    dx /= dl;
    dz /= dl;
    let best: Barrel | null = null;
    let bs = 0.28;
    for (const b of train.barrels) {
      if (b === cur || !barrelsOk(b)) continue;
      // river-space offset
      const ds = b.s - cur.s;
      const dlat = b.l - cur.l;
      const d = Math.hypot(ds, dlat);
      if (d > 6.2 || d < 0.6) continue;
      const dot = (dlat * dx + ds * dz) / d;
      if (dot < 0.35) continue;
      const score = dot / (0.5 + d * 0.22);
      if (score > bs) {
        bs = score;
        best = b;
      }
    }
    return best;
  }

  function nearestFree(p: THREE.Vector3): Barrel {
    return train.nearest(p, (b) => barrelsOk(b)) ?? ride.cur;
  }

  function startHop(b: Barrel, height: number, dur: number) {
    HOP_T = dur;
    if (b !== ride.cur) ride.cur.rider = null;
    hopFrom.copy(level.ctx.player.position);
    hopTo = b;
    hopT = 0;
    hopHeight = height;
    ride.state = 'hop';
    audio.play('jump', { pos: hopFrom, volume: 0.75 });
    ride.hops++;
  }

  function land() {
    const b = hopTo;
    // a hop is missed when the barrel is no longer under him
    const player = level.ctx.player;
    predictStand(b, 0, _p);
    const dist = Math.hypot(player.position.x - _p.x, player.position.z - _p.z);
    if (dist > 1.35 || b.smashed) {
      splash('miss');
      return;
    }
    ride.cur = b;
    b.rider = 'player';
    ride.state = 'on';
    train.landOn(b, 1);
    hooks.onLand?.(b);
  }

  function splash(reason: 'miss' | 'log' | 'knocked') {
    const player = level.ctx.player;
    ride.cur.rider = null;
    ride.state = 'swim';
    swimT = 0;
    ride.airborne = false;
    ride.pose = 'crouch';
    fx.splash(player.position, 2.2);
    fx.splash(_p.copy(player.position).setY(player.position.y - 0.5), 1.5);
    audio.play('splash', { pos: player.position, volume: 1 });
    player.camera.shake(0.3, 0.35);
    player.takeDamage({ amount: 10, type: 'fall', source: null });
    hooks.onSplash?.(reason);
  }

  // an arrival from the bank: a hop from the ledge onto a chosen barrel
  if (startPos) {
    hopFrom.copy(startPos);
    hopTo = from.barrel;
    hopT = 0;
    HOP_T = 0.8;
    hopHeight = 1.7;
    ride.state = 'hop';
  }
  void RIVER_LEN;
  void STAND_H;
  return ride;
}
