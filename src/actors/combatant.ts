/**
 * BaseCombatant: shared base for the player, enemies, allies and custom creatures.
 *
 * - Hit zones built from bones: spheres and capsules that follow the skeleton
 *   (`buildHumanoidZones` for humanoids; `addZoneSphere` / `addZoneCapsule` for creatures).
 *   Raycasts return the zone, its damage multiplier and the bone to stick arrows into.
 * - takeDamage → hit flash + flinch → death: `onDeath` fires exactly once, the body lies
 *   for `corpseTime` seconds (default 6), sinks into the ground, then `expired` is set and
 *   the registry removes and disposes it.
 *
 * Subclasses implement `update(dt)` and call `afterAnimate()` after posing the skeleton and
 * `updateDeath(dt)` while dead.
 */
import * as THREE from 'three';
import type { BloodKind, CombatRayHit, Combatant, DamageInfo, HitZone, Humanoid, HumanoidBone, Team } from '../core/types';
import { disposeObject } from '../core/math';

/** contract zone multipliers (weakpoint is per creature; this is the default) */
export const ZONE_MULT: Record<HitZone, number> = { head: 2.5, body: 1, limb: 0.75, armor: 0.3, weakpoint: 3 };

interface Zone {
  zone: HitZone;
  mult: number;
  radius: number;
  a: THREE.Object3D;
  b: THREE.Object3D | null;
  /** disc zones (shields): local normal of the disc face; world normal is kept in nw */
  disc?: { n: THREE.Vector3; nw: THREE.Vector3 };
  offA: THREE.Vector3;
  offB: THREE.Vector3;
  attach: THREE.Object3D;
  pa: THREE.Vector3;
  pb: THREE.Vector3;
}

export interface CombatantOpts {
  team: Team;
  name: string;
  maxHp: number;
  humanoid?: Humanoid | null;
  /** root object; defaults to a new Group (the humanoid root is added under it) */
  object?: THREE.Object3D;
  radius?: number;
  height?: number;
  bloodKind?: BloodKind;
  isBoss?: boolean;
  countsForRivalry?: boolean;
}

const _oa = new THREE.Vector3();
const _ba = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _cs = new THREE.Vector3();
let nextId = 1;
let zoneStamp = 0;

export abstract class BaseCombatant implements Combatant {
  readonly id: number;
  team: Team;
  name: string;
  readonly object: THREE.Object3D;
  velocity = new THREE.Vector3();
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive = true;
  isBoss?: boolean;
  targetable = true;
  onDeath: ((self: Combatant, killer: Combatant | null) => void) | null = null;

  /** humanoid body if any (added under `object`) */
  readonly body: Humanoid | null;
  bloodKind: BloodKind;
  /** counts toward the Gimli rivalry when killed by Legolas/Gimli */
  countsForRivalry: boolean;
  /** last damage received (for kill info) */
  lastDamage: DamageInfo | null = null;
  /** seconds since death, -1 while alive */
  deathTime = -1;
  /** seconds a corpse lies before sinking; < 0 keeps it forever */
  corpseTime = 6;
  /** body has sunk: the registry removes and disposes it */
  expired = false;
  disposed = false;
  /** 0..1 flinch, decays */
  hitReact = 0;
  deathVariant = 0;
  /** bone used by aimPoint (defaults to chest, or centre mass without a humanoid) */
  aimBone: THREE.Object3D | null = null;
  /** colour of the emissive hit flash */
  flashColor = 0xff6a4a;

  protected zones: Zone[] = [];
  private poseVersion = 0;
  private zonesVersion = -1;
  private readonly rayHit: CombatRayHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), zone: 'body', multiplier: 1 };
  private sinkT = 0;
  private bound = 0;

  constructor(o: CombatantOpts) {
    this.id = nextId++;
    this.team = o.team;
    this.name = o.name;
    this.maxHp = o.maxHp;
    this.hp = o.maxHp;
    this.body = o.humanoid ?? null;
    this.object = o.object ?? new THREE.Group();
    this.object.name = this.object.name || `combatant:${o.name}`;
    if (this.body && this.body.root.parent !== this.object) this.object.add(this.body.root);
    this.height = o.height ?? this.body?.height ?? 1.8;
    this.radius = o.radius ?? Math.max(0.3, this.height * 0.19);
    this.bloodKind = o.bloodKind ?? 'red';
    this.isBoss = o.isBoss;
    this.countsForRivalry = o.countsForRivalry ?? true;
    this.deathVariant = this.id % 4;
    this.object.userData.combatant = this;
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  // ── zones ──────────────────────────────────────────────────────────────────
  addZoneSphere(obj: THREE.Object3D, radius: number, zone: HitZone, mult = ZONE_MULT[zone], offset?: THREE.Vector3): void {
    this.zones.push({
      zone,
      mult,
      radius,
      a: obj,
      b: null,
      offA: offset?.clone() ?? new THREE.Vector3(),
      offB: new THREE.Vector3(),
      attach: obj,
      pa: new THREE.Vector3(),
      pb: new THREE.Vector3(),
    });
    this.zonesVersion = -1;
  }

  /** flat disc (shield face): centre = obj origin + offset, face normal along `normal` in obj space */
  addZoneDisc(obj: THREE.Object3D, radius: number, normal: THREE.Vector3, zone: HitZone = 'armor', mult = ZONE_MULT[zone], offset?: THREE.Vector3): void {
    this.zones.push({
      zone,
      mult,
      radius,
      a: obj,
      b: null,
      disc: { n: normal.clone().normalize(), nw: new THREE.Vector3() },
      offA: offset?.clone() ?? new THREE.Vector3(),
      offB: new THREE.Vector3(),
      attach: obj,
      pa: new THREE.Vector3(),
      pb: new THREE.Vector3(),
    });
    this.zonesVersion = -1;
  }

  /** remove zones attached to an object (e.g. a dropped shield) */
  removeZonesOf(obj: THREE.Object3D): void {
    this.zones = this.zones.filter((z) => z.a !== obj);
  }

  addZoneCapsule(
    a: THREE.Object3D,
    b: THREE.Object3D,
    radius: number,
    zone: HitZone,
    mult = ZONE_MULT[zone],
    offA?: THREE.Vector3,
    offB?: THREE.Vector3,
  ): void {
    this.zones.push({
      zone,
      mult,
      radius,
      a,
      b,
      offA: offA?.clone() ?? new THREE.Vector3(),
      offB: offB?.clone() ?? new THREE.Vector3(),
      attach: a,
      pa: new THREE.Vector3(),
      pb: new THREE.Vector3(),
    });
    this.zonesVersion = -1;
  }

  /** world-space zone shapes (debug overlays); refreshed for the current pose */
  debugZones(): { a: THREE.Vector3; b: THREE.Vector3; radius: number; zone: HitZone }[] {
    this.refreshZones();
    return this.zones.map((z) => ({ a: z.pa.clone(), b: z.pb.clone(), radius: z.radius, zone: z.zone }));
  }

  clearZones(): void {
    this.zones.length = 0;
  }

  /**
   * Standard humanoid zones: head sphere, torso capsule hips→neck, limb capsules.
   * girth scales torso/limb radii (dwarves, trolls); head/body zone and multiplier overridable.
   */
  buildHumanoidZones(
    h: Humanoid,
    o: { girth?: number; headZone?: HitZone; headMult?: number; bodyZone?: HitZone; bodyMult?: number; limbMult?: number } = {},
  ): void {
    const s = h.height / 1.85;
    const g = o.girth ?? 1;
    const B = h.bones;
    const headZone = o.headZone ?? 'head';
    const bodyZone = o.bodyZone ?? 'body';
    const limb = o.limbMult ?? ZONE_MULT.limb;
    const headR = 0.12 * s * (headZone === 'weakpoint' ? 1.25 : 1);
    this.addZoneSphere(B.head, headR, headZone, o.headMult ?? ZONE_MULT[headZone], new THREE.Vector3(0, 0.07 * s, 0.01 * s));
    // torso: hips → neck, with the top cap ending at about neck height whatever the girth
    // (so it never swallows the lower head and headshots from below still count)
    const torsoR = 0.18 * s * g;
    this.addZoneCapsule(B.hips, B.neck, torsoR, bodyZone, o.bodyMult ?? ZONE_MULT[bodyZone], new THREE.Vector3(0, -0.04 * s, 0), new THREE.Vector3(0, -(torsoR - 0.04 * s), 0));
    const limbs: [HumanoidBone, HumanoidBone, number][] = [
      ['upperarm_l', 'forearm_l', 0.055],
      ['forearm_l', 'hand_l', 0.05],
      ['upperarm_r', 'forearm_r', 0.055],
      ['forearm_r', 'hand_r', 0.05],
      ['thigh_l', 'shin_l', 0.08],
      ['shin_l', 'foot_l', 0.065],
      ['thigh_r', 'shin_r', 0.08],
      ['shin_r', 'foot_r', 0.065],
    ];
    for (const [a, b, r] of limbs) this.addZoneCapsule(B[a], B[b], r * s * g, 'limb', limb);
    this.aimBone = B.chest;
  }

  /** call after the skeleton was posed this frame (zones refresh lazily on the next query) */
  protected afterAnimate(): void {
    this.poseVersion++;
  }

  /** bring o.matrixWorld up to date by walking up to the first object already current */
  private updateChain(o: THREE.Object3D, stamp: number): void {
    const ud = o.userData as { _zs?: number };
    if (ud._zs === stamp) return;
    const parent = o.parent;
    if (o !== this.object && parent) this.updateChain(parent, stamp);
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o === this.object || !parent) {
      if (parent) o.matrixWorld.multiplyMatrices(parent.matrixWorld, o.matrix);
      else o.matrixWorld.copy(o.matrix);
    } else o.matrixWorld.multiplyMatrices(parent.matrixWorld, o.matrix);
    ud._zs = stamp;
  }

  private refreshZones(): void {
    if (this.zonesVersion === this.poseVersion) return;
    this.zonesVersion = this.poseVersion;
    const stamp = ++zoneStamp;
    for (const z of this.zones) {
      this.updateChain(z.a, stamp);
      if (z.b) this.updateChain(z.b, stamp);
    }
    if (this.aimBone) this.updateChain(this.aimBone, stamp);
    let bound = 0;
    const px = this.object.position.x;
    const pz = this.object.position.z;
    for (const z of this.zones) {
      z.pa.copy(z.offA).applyMatrix4(z.a.matrixWorld);
      if (z.b) z.pb.copy(z.offB).applyMatrix4(z.b.matrixWorld);
      else z.pb.copy(z.pa);
      if (z.disc) z.disc.nw.copy(z.disc.n).transformDirection(z.a.matrixWorld);
      bound = Math.max(bound, Math.hypot(z.pa.x - px, z.pa.z - pz) + z.radius, Math.hypot(z.pb.x - px, z.pb.z - pz) + z.radius);
    }
    this.bound = bound;
  }

  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.aimBone) {
      this.refreshZones();
      return this.aimBone.getWorldPosition(out);
    }
    return out.copy(this.object.position).setY(this.object.position.y + this.height * 0.6);
  }

  /** world position of the head zone (or aimPoint) — Focus volleys and headshot aim */
  headPoint(out: THREE.Vector3): THREE.Vector3 {
    this.refreshZones();
    for (const z of this.zones) if (z.zone === 'head' || z.zone === 'weakpoint') return out.copy(z.pa);
    return this.aimPoint(out);
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CombatRayHit | null {
    if (!this.alive) return null;
    // coarse: vertical capsule around the body (rays starting inside it always pass)
    const p = this.object.position;
    const coarseR = Math.max(this.radius * 2.6, this.height * 0.45);
    _p.set(p.x, p.y, p.z);
    _q.set(p.x, p.y + this.height * 1.05, p.z);
    if (!insideCapsule(origin, _p, _q, coarseR) && rayCapsule(origin, dir, _p, _q, coarseR) < 0) return null;
    if (this.zones.length === 0) {
      const t = rayCapsule(origin, dir, _p.set(p.x, p.y + this.radius, p.z), _q.set(p.x, p.y + this.height - this.radius, p.z), this.radius);
      if (t < 0 || t > maxDist) return null;
      return this.fillHit(origin, dir, t, 'body', 1, this.object, _p, _q);
    }
    this.refreshZones();
    if (this.bound > coarseR) {
      // limbs reach outside the coarse capsule (big swings): recheck with the real bound
      _p.set(p.x, p.y - 0.5, p.z);
      _q.set(p.x, p.y + this.height * 1.3, p.z);
      if (!insideCapsule(origin, _p, _q, this.bound) && rayCapsule(origin, dir, _p, _q, this.bound) < 0) return null;
    }
    let best = maxDist;
    let bz: Zone | null = null;
    for (const z of this.zones) {
      const t = z.disc ? rayDisc(origin, dir, z.pa, z.disc.nw, z.radius) : z.b ? rayCapsule(origin, dir, z.pa, z.pb, z.radius) : raySphere(origin, dir, z.pa, z.radius);
      if (t >= 0 && t < best) {
        best = t;
        bz = z;
      }
    }
    if (!bz) return null;
    const hit = this.fillHit(origin, dir, best, bz.zone, bz.mult, bz.attach, bz.pa, bz.pb);
    if (bz.disc) {
      hit.normal!.copy(bz.disc.nw);
      if (hit.normal!.dot(dir) > 0) hit.normal!.negate();
    }
    return hit;
  }

  private fillHit(o: THREE.Vector3, d: THREE.Vector3, t: number, zone: HitZone, mult: number, attach: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
    const h = this.rayHit;
    h.t = t;
    h.point.copy(o).addScaledVector(d, t);
    closestOnSegment(h.point, a, b, _oa);
    h.normal!.copy(h.point).sub(_oa);
    if (h.normal!.lengthSq() < 1e-10) h.normal!.copy(d).negate();
    h.normal!.normalize();
    h.zone = zone;
    h.multiplier = mult;
    h.attach = attach;
    return h;
  }

  // ── damage & death ─────────────────────────────────────────────────────────
  /** override to filter (invulnerability, i-frames, armour). Return the damage to apply. */
  protected filterDamage(d: DamageInfo): number {
    return d.amount;
  }
  /** hook: damage applied (hp already reduced) */
  protected onDamaged(_d: DamageInfo, _amount: number): void {}
  /** hook: just died (before onDeath fires) */
  protected onDied(_killer: Combatant | null, _d: DamageInfo | null): void {}

  takeDamage(d: DamageInfo): void {
    if (!this.alive) return;
    const amount = this.filterDamage(d);
    if (!(amount > 0)) return;
    this.lastDamage = d;
    this.hp = Math.max(0, this.hp - amount);
    this.body?.flash(this.flashColor);
    this.hitReact = 1;
    this.onDamaged(d, amount);
    if (this.hp <= 0 && this.alive) this.die(d.source, d);
  }

  /** kill immediately (scripted) */
  kill(killer: Combatant | null = null): void {
    if (!this.alive) return;
    this.hp = 0;
    this.lastDamage = this.lastDamage ?? { amount: this.maxHp, type: 'scripted', source: killer };
    this.die(killer, this.lastDamage);
  }

  protected die(killer: Combatant | null, d: DamageInfo | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.targetable = false;
    this.hp = 0;
    this.deathTime = 0;
    this.sinkT = 0;
    this.velocity.set(0, 0, 0);
    this.onDied(killer, d);
    const cb = this.onDeath;
    cb?.(this, killer);
  }

  /** bring back to life (player revive, scripted) */
  protected resurrect(): void {
    this.alive = true;
    this.targetable = true;
    this.hp = this.maxHp;
    this.deathTime = -1;
    this.expired = false;
    this.sinkT = 0;
    this.hitReact = 0;
    if (this.body) this.body.root.position.y = 0;
  }

  /** advance corpse timers: lie → sink → expire */
  protected updateDeath(dt: number): void {
    if (this.alive) return;
    this.deathTime += dt;
    if (this.corpseTime < 0 || this.deathTime < this.corpseTime || this.expired) return;
    if (this.sinkT === 0) this.body?.setCastShadow(false);
    this.sinkT += dt;
    if (this.body) this.body.root.position.y = -this.sinkT * this.sinkT * 0.35 - this.sinkT * 0.25;
    if (this.sinkT > 1.8) this.expired = true;
  }

  /** death animation progress 0..1 */
  get deadProgress(): number {
    return this.alive ? 0 : Math.min(1, this.deathTime / 1.1);
  }

  abstract update(dt: number): void;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    if (this.body) this.body.dispose();
    else disposeObject(this.object);
  }
}

// ── ray helpers ──────────────────────────────────────────────────────────────

/** ray vs flat disc (centre c, unit normal n, radius r), either face. Returns t ≥ 0 or -1. */
export function rayDisc(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3, r: number): number {
  const den = d.x * n.x + d.y * n.y + d.z * n.z;
  if (Math.abs(den) < 1e-5) return -1;
  const t = ((c.x - o.x) * n.x + (c.y - o.y) * n.y + (c.z - o.z) * n.z) / den;
  if (t < 0) return -1;
  const px = o.x + d.x * t - c.x;
  const py = o.y + d.y * t - c.y;
  const pz = o.z + d.z * t - c.z;
  return px * px + py * py + pz * pz <= r * r ? t : -1;
}

/** ray vs sphere, returns t ≥ 0 or -1 (origin inside → -1) */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc < 0) return -1;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

/** ray vs capsule (segment pa→pb, radius r), d normalised. Returns t ≥ 0 or -1. (after iq) */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, pa: THREE.Vector3, pb: THREE.Vector3, r: number): number {
  const bax = pb.x - pa.x;
  const bay = pb.y - pa.y;
  const baz = pb.z - pa.z;
  const oax = o.x - pa.x;
  const oay = o.y - pa.y;
  const oaz = o.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  // caps (also handles degenerate a≈0: ray parallel to the axis)
  let best = -1;
  for (let i = 0; i < 2; i++) {
    const cx = i === 0 ? pa.x : pb.x;
    const cy = i === 0 ? pa.y : pb.y;
    const cz = i === 0 ? pa.z : pb.z;
    const ocx = o.x - cx;
    const ocy = o.y - cy;
    const ocz = o.z - cz;
    b = d.x * ocx + d.y * ocy + d.z * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h < 0 || c < 0) continue;
    const t = -b - Math.sqrt(h);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** is p within distance r of segment a-b */
export function insideCapsule(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): boolean {
  closestOnSegment(p, a, b, _in);
  return _in.distanceToSquared(p) <= r * r;
}
const _in = new THREE.Vector3();

export function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _ba.copy(b).sub(a);
  const l2 = _ba.lengthSq();
  if (l2 < 1e-12) return out.copy(a);
  const t = Math.max(0, Math.min(1, _cs.copy(p).sub(a).dot(_ba) / l2));
  return out.copy(a).addScaledVector(_ba, t);
}

/** squared distance between segments p1-q1 and p2-q2 (for melee and thrown objects) */
export function segSegDist2(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) return rx * rx + ry * ry + rz * rz;
  if (a <= 1e-12) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = a * e - b * b;
      s = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const x = rx + d1x * s - d2x * t;
  const y = ry + d1y * s - d2y * t;
  const z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}

/** friendly-fire rule: player and allies never hurt each other; neutral can be hit by anyone */
export function hostile(a: Team, b: Team): boolean {
  if (a === b) return false;
  const fa = a === 'player' || a === 'ally';
  const fb = b === 'player' || b === 'ally';
  return !(fa && fb);
}
