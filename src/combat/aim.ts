/** Pure aiming math (ballistics, leading, spread). Unit-tested in combat.test.ts. */
import * as THREE from 'three';

/** gravity applied to arrows (× ArrowShot.gravity). Lower than the world's 22 so arrows only drop slightly. */
export const ARROW_GRAVITY = 9.8;

const _d = new THREE.Vector3();

/**
 * Direction to launch a projectile at `speed` under gravity `g` so it passes through `to`
 * (low arc). Falls back to a 45° shot when out of range. Writes into `out` (normalised).
 */
export function ballisticDir(from: THREE.Vector3, to: THREE.Vector3, speed: number, g: number, out: THREE.Vector3): THREE.Vector3 {
  _d.copy(to).sub(from);
  const x = Math.hypot(_d.x, _d.z);
  const y = _d.y;
  if (g <= 1e-6 || x < 1e-4) return out.copy(_d).normalize();
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  let angle: number;
  if (disc < 0) angle = Math.PI / 4;
  else angle = Math.atan2(v2 - Math.sqrt(disc), g * x);
  const c = Math.cos(angle);
  out.set((_d.x / x) * c, Math.sin(angle), (_d.z / x) * c);
  return out.normalize();
}

/** flight time of a low-arc shot over horizontal distance (approx) */
export function flightTime(from: THREE.Vector3, to: THREE.Vector3, speed: number): number {
  return from.distanceTo(to) / Math.max(1, speed);
}

/**
 * Predict where a target moving at `vel` will be when a projectile of `speed` reaches it.
 * Iterative (3 passes), writes the intercept point into `out`.
 */
export function leadTarget(from: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3, speed: number, out: THREE.Vector3, maxLead = 2): THREE.Vector3 {
  out.copy(pos);
  for (let i = 0; i < 3; i++) {
    const t = Math.min(maxLead, from.distanceTo(out) / Math.max(1, speed));
    out.copy(pos).addScaledVector(vel, t);
  }
  return out;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
/**
 * Randomly perturb a unit direction inside a cone of half-angle `rad` (uniform over the disc).
 * `r1`, `r2` are random numbers in [0,1).
 */
export function spreadDir(dir: THREE.Vector3, rad: number, r1: number, r2: number, out: THREE.Vector3): THREE.Vector3 {
  if (rad <= 0) return out.copy(dir);
  _a.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.95) _a.set(1, 0, 0);
  _a.cross(dir).normalize(); // perpendicular 1
  _b.copy(dir).cross(_a).normalize(); // perpendicular 2
  const r = Math.sqrt(r1) * Math.tan(rad);
  const th = r2 * Math.PI * 2;
  out.copy(dir).addScaledVector(_a, Math.cos(th) * r).addScaledVector(_b, Math.sin(th) * r);
  return out.normalize();
}

/** angle (rad) between two unit vectors */
export function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
}

/** rotate unit vector `from` toward unit vector `to` by at most `maxRad` (writes out) */
export function rotateToward(from: THREE.Vector3, to: THREE.Vector3, maxRad: number, out: THREE.Vector3): THREE.Vector3 {
  const ang = angleBetween(from, to);
  if (ang <= maxRad || ang < 1e-6) return out.copy(to);
  const k = maxRad / ang;
  // slerp approximation for small angles: lerp + normalise
  return out.copy(from).lerp(to, k).normalize();
}
