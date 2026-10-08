/**
 * Kinematic character motor shared by the player, enemies and allies.
 *
 * Handles gravity, ground snapping, step-up, walkable-slope limits (normal.y > 0.6) and
 * sliding on steeper ground, wall push-out via `physics.collide`, head bumps, and carrying
 * characters on moving colliders (platform `velocity`, or the transform delta when the
 * velocity is zero).
 */
import * as THREE from 'three';
import type { ColliderHandle, PhysicsWorld, SurfaceMaterial } from '../core/types';
import { DEFAULT_STEP_UP, WALKABLE_NORMAL_Y, type PhysicsWorldExt } from './world';

export const GRAVITY = 22;

export interface Motor {
  /** feet position (usually the combatant's object.position) */
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  radius: number;
  height: number;
  stepUp: number;
  /** extra gravity multiplier while falling (snappier arcs) */
  fallMul: number;
  gravity: number;
  /** keep feet glued to the ground when walking down slopes/steps up to this drop */
  snapDown: number;
  grounded: boolean;
  /** ground below the feet (valid when grounded or sliding) */
  groundY: number;
  readonly groundNormal: THREE.Vector3;
  groundMaterial: SurfaceMaterial;
  groundCollider: ColliderHandle | null;
  /** on ground steeper than the walkable limit */
  sliding: boolean;
  /** seconds since last grounded (coyote time) */
  airTime: number;
  /** last frame's platform carry velocity (inherited on jump) */
  readonly platformVel: THREE.Vector3;
  /** yaw rotation carried this step by a rotating platform (add to facing) */
  platformYaw: number;
  // platform tracking
  platId: number;
  platX: number;
  platY: number;
  platZ: number;
  platR: number;
}

export function createMotor(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, height: number): Motor {
  return {
    pos,
    vel,
    radius,
    height,
    stepUp: DEFAULT_STEP_UP,
    fallMul: 1,
    gravity: GRAVITY,
    snapDown: 0.4,
    grounded: false,
    groundY: -Infinity,
    groundNormal: new THREE.Vector3(0, 1, 0),
    groundMaterial: 'dirt',
    groundCollider: null,
    sliding: false,
    airTime: 0,
    platformVel: new THREE.Vector3(),
    platformYaw: 0,
    platId: -1,
    platX: 0,
    platY: 0,
    platZ: 0,
    platR: 0,
  };
}

export interface MotorResult {
  landed: boolean;
  /** downward speed at landing (m/s, positive) */
  landSpeed: number;
  /** vertical distance stepped up this frame (for visual smoothing) */
  stepped: number;
  hitWall: boolean;
}
const result: MotorResult = { landed: false, landSpeed: 0, stepped: 0, hitWall: false };
const _prev = new THREE.Vector3();
const _push = new THREE.Vector3();

function isExt(p: PhysicsWorld): p is PhysicsWorldExt {
  return typeof (p as PhysicsWorldExt).ceiling === 'function';
}

/**
 * Advance the motor by dt (game seconds). Velocity is in world space; vel.y is integrated with
 * gravity unless `noGravity`. Returns a shared result object.
 */
export function stepMotor(physics: PhysicsWorld, m: Motor, dt: number, noGravity = false): MotorResult {
  result.landed = false;
  result.landSpeed = 0;
  result.stepped = 0;
  result.hitWall = false;
  m.platformYaw = 0;
  if (dt <= 0) return result;

  // ── platform carry ────────────────────────────────────────────────────────
  m.platformVel.set(0, 0, 0);
  if (m.grounded && m.groundCollider && m.groundCollider.enabled) {
    const c = m.groundCollider;
    if (c.velocity.lengthSq() > 1e-8) {
      m.pos.addScaledVector(c.velocity, dt);
      m.platformVel.copy(c.velocity);
    } else if (isExt(physics)) {
      const pose = physics.colliderPose(c);
      if (pose && m.platId === c.id) {
        const dx = pose.x - m.platX;
        const dy = pose.y - m.platY;
        const dz = pose.z - m.platZ;
        const dYaw = pose.yaw - m.platR;
        if (dYaw !== 0) {
          // rotate the character around the platform centre (old centre → new centre)
          const rx = m.pos.x - m.platX;
          const rz = m.pos.z - m.platZ;
          const cs = Math.cos(dYaw);
          const sn = Math.sin(dYaw);
          m.pos.x = pose.x + rx * cs + rz * sn;
          m.pos.z = pose.z - rx * sn + rz * cs;
          m.platformYaw = dYaw;
        } else {
          m.pos.x += dx;
          m.pos.z += dz;
        }
        m.pos.y += dy;
        m.platformVel.set(dx / dt, dy / dt, dz / dt);
      }
    }
  }

  const speed = Math.hypot(m.vel.x, m.vel.y, m.vel.z);
  const steps = Math.min(5, Math.max(1, Math.ceil((speed * dt) / 0.3)));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) subStep(physics, m, h, noGravity);

  // remember the platform pose for next frame
  if (m.grounded && m.groundCollider && isExt(physics)) {
    const pose = physics.colliderPose(m.groundCollider);
    if (pose) {
      m.platId = m.groundCollider.id;
      m.platX = pose.x;
      m.platY = pose.y;
      m.platZ = pose.z;
      m.platR = pose.yaw;
    }
  } else m.platId = -1;
  if (m.grounded) m.airTime = 0;
  else m.airTime += dt;
  return result;
}

function subStep(physics: PhysicsWorld, m: Motor, dt: number, noGravity: boolean) {
  const pos = m.pos;
  const vel = m.vel;
  _prev.copy(pos);
  const wasGrounded = m.grounded;

  if (!noGravity && !m.grounded) vel.y -= m.gravity * (vel.y < 0 ? m.fallMul : 1) * dt;
  if (m.grounded && vel.y < 0) vel.y = 0;

  // ── horizontal ───────────────────────────────────────────────────────────
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;

  // steep-slope blocking: cannot walk up ground steeper than the walkable limit
  const ahead = physics.ground(pos.x, pos.z, _prev.y, m.stepUp);
  if (ahead && ahead.normal.y < WALKABLE_NORMAL_Y && ahead.y > _prev.y + 0.02) {
    const nx = ahead.normal.x;
    const nz = ahead.normal.z;
    const nl = Math.hypot(nx, nz);
    if (nl > 1e-5) {
      const ux = nx / nl;
      const uz = nz / nl;
      const into = vel.x * ux + vel.z * uz; // normal points downhill → negative = uphill
      if (into < 0) {
        vel.x -= ux * into;
        vel.z -= uz * into;
      }
      pos.x = _prev.x + vel.x * dt;
      pos.z = _prev.z + vel.z * dt;
    }
  }

  // walls
  _push.set(pos.x, 0, pos.z);
  if (physics.collide(pos, m.radius, m.height, m.stepUp)) {
    _push.set(pos.x - _push.x, 0, pos.z - _push.z);
    const l = _push.length();
    if (l > 1e-6) {
      _push.divideScalar(l);
      const d = vel.x * _push.x + vel.z * _push.z;
      if (d < 0) {
        vel.x -= _push.x * d;
        vel.z -= _push.z * d;
      }
      result.hitWall = true;
    }
  }

  // ── vertical ─────────────────────────────────────────────────────────────
  pos.y += vel.y * dt;
  if (vel.y > 0 && isExt(physics)) {
    const ceil = physics.ceiling(pos.x, pos.z, _prev.y + m.height * 0.5, m.radius * 0.7);
    if (pos.y + m.height > ceil) {
      pos.y = Math.max(_prev.y, ceil - m.height);
      vel.y = 0;
    }
  }

  const g = physics.ground(pos.x, pos.z, Math.max(_prev.y, pos.y), m.stepUp);
  m.sliding = false;
  if (!g) {
    m.grounded = false;
    m.groundCollider = null;
    m.groundY = -Infinity;
    return;
  }
  m.groundY = g.y;
  m.groundNormal.copy(g.normal);
  m.groundMaterial = g.material;
  const walkable = g.normal.y >= WALKABLE_NORMAL_Y;

  if (!walkable) {
    m.grounded = false;
    m.groundCollider = g.collider;
    if (pos.y <= g.y + 0.05) {
      // slide: stay on the surface, lose velocity into it, gravity pulls downhill
      m.sliding = true;
      pos.y = g.y;
      const n = g.normal;
      const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
      if (vn < 0) {
        vel.x -= n.x * vn;
        vel.y -= n.y * vn;
        vel.z -= n.z * vn;
      }
    }
    return;
  }

  if (wasGrounded && vel.y <= 0.01 && pos.y - g.y <= m.snapDown) {
    // stay glued (walk down slopes and steps, step up onto ledges)
    if (g.y > pos.y + 0.02) result.stepped += g.y - pos.y;
    pos.y = g.y;
    vel.y = 0;
    m.grounded = true;
    m.groundCollider = g.collider;
    return;
  }
  if (vel.y <= 0 && pos.y <= g.y + 1e-3) {
    if (!wasGrounded) {
      result.landed = true;
      result.landSpeed = Math.max(result.landSpeed, -vel.y);
    }
    if (g.y > pos.y + 0.02 && wasGrounded) result.stepped += g.y - pos.y;
    pos.y = g.y;
    vel.y = 0;
    m.grounded = true;
    m.groundCollider = g.collider;
    return;
  }
  m.grounded = false;
  m.groundCollider = null;
}

/** force the motor airborne (jump) */
export function launch(m: Motor, vy: number, inheritPlatform = true) {
  if (inheritPlatform) {
    m.vel.x += m.platformVel.x;
    m.vel.z += m.platformVel.z;
    vy += Math.max(0, m.platformVel.y);
  }
  m.vel.y = vy;
  m.grounded = false;
  m.groundCollider = null;
  m.platId = -1;
}

/** place the motor on the ground at its current x/z (spawn, teleport) */
export function settle(physics: PhysicsWorld, m: Motor, searchUp = 2) {
  const g = physics.ground(m.pos.x, m.pos.z, m.pos.y + searchUp, 0);
  if (g) {
    m.pos.y = g.y;
    m.grounded = g.normal.y >= WALKABLE_NORMAL_Y;
    m.groundY = g.y;
    m.groundNormal.copy(g.normal);
    m.groundMaterial = g.material;
    m.groundCollider = g.collider;
  } else {
    m.grounded = false;
  }
  m.vel.set(0, 0, 0);
  m.platId = -1;
}
