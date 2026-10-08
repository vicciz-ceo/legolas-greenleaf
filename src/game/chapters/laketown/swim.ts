/**
 * The lake: falling off a walkway is not death. Legolas drops into the water, swims (slowly, with a
 * gentle pull toward the nearest deck after a moment), then hauls himself up onto the walkway. Allies
 * that fall in are put back on the deck; enemies that fall in drown (splash, then the kill plane).
 */
import * as THREE from 'three';
import type { Combatant, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { clamp, damp, smoothstep, yawOf } from '../../../core/math';
import { D, DECKS, WATER_Y, edgePoints, segHitsRect, type EdgePoint, type Rect } from './layout';

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _in = new THREE.Vector3();

/** minimum time in the water before climbing out (the "slow respawn") */
const MIN_SWIM = 2.8;
const SWIM_SPEED = 2.9;
const CLIMB_TIME = 0.9;
const WATERLINE = -0.88;

const EDGES: EdgePoint[] = edgePoints();

/**
 * The best place to haul out from (x, z): the nearest deck edge whose approach over the water is
 * clear (no deck or house in the way), else simply the nearest. Fills `outEdge` (on the deck
 * boundary) and `outInward` (unit, pointing onto the deck).
 */
export function nearestEdge(x: number, z: number, outEdge: THREE.Vector3, outInward: THREE.Vector3, obstacles: Rect[] = []): boolean {
  let best = Infinity;
  let bestAny = Infinity;
  let any: EdgePoint | null = null;
  let pick: EdgePoint | null = null;
  for (const e of EDGES) {
    const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
    if (d < bestAny) {
      bestAny = d;
      any = e;
    }
    if (d >= best) continue;
    // the swimmer ends 0.55 m outside the edge
    const ox = e.x - e.ix * 0.55;
    const oz = e.z - e.iz * 0.55;
    let blocked = false;
    for (let i = 0; i < DECKS.length && !blocked; i++) if (i !== e.deck && segHitsRect(x, z, ox, oz, DECKS[i])) blocked = true;
    for (let i = 0; i < obstacles.length && !blocked; i++) if (segHitsRect(x, z, ox, oz, obstacles[i])) blocked = true;
    if (blocked) continue;
    best = d;
    pick = e;
  }
  const e = pick ?? any;
  if (!e) return false;
  outEdge.set(e.x, D, e.z);
  outInward.set(e.ix, 0, e.iz);
  return true;
}

export interface Swim {
  readonly swimming: boolean;
  /** swims since the chapter began */
  readonly dunks: number;
  update(): void;
}

export function createSwim(level: LevelAPI, o: { enabled: () => boolean; allies: () => Combatant[]; obstacles?: Rect[] }): Swim {
  const { ctx } = level;
  const player: PlayerAPI = ctx.player;
  let mover: (PlayerMover & { t: number }) | null = null;
  let dunks = 0;
  const splashed = new WeakSet<Combatant>();

  function makeMover(): PlayerMover & { t: number } {
    const edge = new THREE.Vector3();
    const inward = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const want = new THREE.Vector3();
    let climbT = -1;
    let splashT = 0;
    const climbFrom = new THREE.Vector3();
    const climbTo = new THREE.Vector3();
    const m: PlayerMover & { t: number } = {
      t: 0,
      pose: 'barrel',
      poseT: () => (m.t * 0.35) % 1,
      allowShoot: false,
      allowMelee: false,
      allowJump: false,
      allowDash: false,
      camera: { distance: 3.3, height: 1.3, fov: 68 },
      update(dt, p, input) {
        m.t += dt;
        splashT -= dt;
        if (climbT >= 0) {
          // hauling out onto the planks
          climbT += dt;
          const k = clamp(climbT / CLIMB_TIME, 0, 1);
          _v.lerpVectors(climbFrom, climbTo, smoothstep(0, 1, k));
          // up first, then over the lip
          _v.y = THREE.MathUtils.lerp(climbFrom.y, climbTo.y, smoothstep(0, 0.7, k));
          p.velocity.subVectors(_v, p.position).divideScalar(Math.max(dt, 1e-4));
          p.position.copy(_v);
          if (k >= 1) finish(p);
          return;
        }
        // free swim, then more and more help toward the nearest edge
        const yaw = p.camera.yaw;
        const fx_ = Math.sin(yaw);
        const fz_ = Math.cos(yaw);
        const rx = -Math.cos(yaw);
        const rz = Math.sin(yaw);
        want.set(fx_ * input.moveY + rx * input.moveX, 0, fz_ * input.moveY + rz * input.moveX);
        if (want.lengthSq() > 1) want.normalize();
        want.multiplyScalar(SWIM_SPEED);
        nearestEdge(p.position.x, p.position.z, edge, inward, o.obstacles ?? []);
        // the point just outside the deck edge, where a swimmer can reach the planks
        _e.copy(edge).addScaledVector(inward, -0.55);
        const toX = _e.x - p.position.x;
        const toZ = _e.z - p.position.z;
        const dist = Math.hypot(toX, toZ);
        const assist = smoothstep(MIN_SWIM * 0.4, MIN_SWIM + 1.4, m.t);
        if (dist > 0.05) {
          want.x = THREE.MathUtils.lerp(want.x, (toX / dist) * SWIM_SPEED * 0.8, assist);
          want.z = THREE.MathUtils.lerp(want.z, (toZ / dist) * SWIM_SPEED * 0.8, assist);
        }
        vel.x = damp(vel.x, want.x, 5, dt);
        vel.z = damp(vel.z, want.z, 5, dt);
        p.position.x += vel.x * dt;
        p.position.z += vel.z * dt;
        p.position.y = WATER_Y + WATERLINE + Math.sin(m.t * 2.6) * 0.04;
        p.velocity.set(vel.x, 0, vel.z);
        if (vel.lengthSq() > 0.15) p.facing = yawOf(vel.x, vel.z);
        if (splashT <= 0 && vel.lengthSq() > 0.3) {
          splashT = 0.45;
          _v.set(p.position.x, WATER_Y, p.position.z);
          ctx.fx.splash(_v, 0.35);
        }
        ctx.hud.setProgress('Swim for the walkway', clamp(m.t / (MIN_SWIM + 1.2), 0, 1));
        // reached the edge (and had a proper swim): climb out
        if ((m.t >= MIN_SWIM && dist < 0.7) || m.t > 9) {
          climbT = 0;
          climbFrom.copy(p.position);
          climbTo.set(edge.x + inward.x * 0.9, D, edge.z + inward.z * 0.9);
          p.facing = yawOf(inward.x, inward.z);
          m.pose = 'climb';
          m.poseT = () => clamp(climbT / CLIMB_TIME, 0, 1);
          ctx.audio.play('splash', { pos: p.position, volume: 0.6, pitch: 1.1 });
        }
      },
    };
    return m;
  }

  function finish(p: PlayerAPI): void {
    ctx.hud.setProgress(null);
    p.mover = null;
    mover = null;
    p.teleport(_in.copy(p.position), p.facing);
    p.camera.shake(0.1, 0.2);
  }

  function dunk(): void {
    dunks++;
    mover = makeMover();
    ctx.hud.setPrompt(null);
    _v.set(player.position.x, WATER_Y, player.position.z);
    ctx.fx.splash(_v, 1.6);
    ctx.audio.play('splash', { pos: _v, volume: 1, pitch: 0.8 });
    ctx.hud.toast('Overboard! Swim back to the walkway', 'warning');
    player.mover = mover;
  }

  return {
    get swimming() {
      return mover !== null;
    },
    get dunks() {
      return dunks;
    },
    update() {
      // the player
      if (!mover && player.alive && !player.mover && o.enabled() && player.position.y < WATER_Y - 0.12 && player.velocity.y <= 0.5) dunk();
      // a mover that was replaced from outside (cinematic reset, chase) must not leave us "swimming"
      if (mover && player.mover !== mover) {
        mover = null;
        ctx.hud.setProgress(null);
      }
      // allies and enemies
      for (const c of ctx.combatants.all()) {
        if (!c.alive || c === (player as Combatant)) continue;
        if (c.team === 'ally') {
          if (c.position.y < WATER_Y - 0.35) {
            const ref = player.position;
            const spot = nearestDeckNear(ref.x, ref.z, c.position.x, c.position.z);
            c.object.position.copy(spot);
            c.velocity.set(0, 0, 0);
            _v.set(c.position.x, WATER_Y, c.position.z);
            ctx.fx.splash(_v, 0.8);
          }
        } else if (c.team === 'enemy') {
          if (c.position.y < WATER_Y + 0.05 && !splashed.has(c)) {
            splashed.add(c);
            _v.set(c.position.x, WATER_Y, c.position.z);
            ctx.fx.splash(_v, 1.0);
            ctx.audio.play('splash', { pos: _v, volume: 0.7, pitch: 0.9 + Math.random() * 0.3 });
          }
        }
      }
    },
  };
}

const _best = new THREE.Vector3();
/** a deck point near where an ally fell, preferring the deck the player stands on */
function nearestDeckNear(px: number, pz: number, ax: number, az: number): THREE.Vector3 {
  let best = Infinity;
  let bestRect: Rect | null = null;
  for (const r of DECKS) {
    const cx = clamp(px, r.x0, r.x1);
    const cz = clamp(pz, r.z0, r.z1);
    if (Math.hypot(cx - px, cz - pz) > 0.5) continue; // only decks the player is on
    const d = Math.hypot(clamp(ax, r.x0, r.x1) - ax, clamp(az, r.z0, r.z1) - az);
    if (d < best) {
      best = d;
      bestRect = r;
    }
  }
  if (bestRect) {
    const r = bestRect;
    return _best.set(clamp(ax, r.x0 + 1, r.x1 - 1), D + 0.05, clamp(az, r.z0 + 1, r.z1 - 1));
  }
  return _best.set(px + 1.5, D + 0.05, pz);
}
