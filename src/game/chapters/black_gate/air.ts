/**
 * The sky over the Morannon: Fell Beasts wheeling over the hills, diving at Legolas, and the Great
 * Eagles that sweep in at the end. Flight is scripted here (the creatures only animate): circles
 * with banking turns, spline dives with a ground telegraph, eagle formations and the strike that
 * brings a Nazgul down.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { FellBeast } from '../../../creatures/fellbeast';
import { Eagle } from '../../../creatures/eagle';
import { clamp, damp, dampAngle, smoothstep, wrapAngle } from '../../../core/math';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** turns a velocity into yaw, pitch and bank (+ = left turn) with smoothing */
class Pilot {
  yaw = 0;
  pitch = 0;
  roll = 0;
  yawRate = 0;
  bank = 0;
  private started = false;
  face(obj: THREE.Object3D, vel: THREE.Vector3, dt: number, bankGain = 1.4, maxBank = 0.9): void {
    const h = Math.hypot(vel.x, vel.z);
    if (h > 0.5) {
      const target = Math.atan2(vel.x, vel.z);
      if (!this.started) {
        this.yaw = target;
        this.started = true;
      }
      const prev = this.yaw;
      this.yaw = dampAngle(this.yaw, target, 4.5, dt);
      this.yawRate = damp(this.yawRate, wrapAngle(this.yaw - prev) / dt, 5, dt);
    }
    const pitchT = -Math.atan2(vel.y, Math.max(1, h));
    this.pitch = damp(this.pitch, clamp(pitchT, -0.8, 0.9), 3.5, dt);
    this.bank = clamp(this.yawRate * bankGain, -maxBank, maxBank);
    this.roll = damp(this.roll, -this.bank * 0.9, 4, dt);
    obj.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
}

type BeastMode = 'circle' | 'dive' | 'climb' | 'leave' | 'dead';

export interface BeastCtl {
  beast: FellBeast;
  mode: BeastMode;
  /** orbit parameters */
  center: THREE.Vector3;
  radius: number;
  alt: number;
  angle: number;
  dir: number;
  speed: number;
  /** dive */
  curve: THREE.CatmullRomCurve3 | null;
  u: number;
  len: number;
  /** where the dive is aimed (ground), the telegraph ring and whether it has struck */
  target: THREE.Vector3;
  struck: boolean;
  pilot: Pilot;
  prev: THREE.Vector3;
  bob: number;
}

export interface EagleCtl {
  eagle: Eagle;
  curve: THREE.CatmullRomCurve3;
  u: number;
  len: number;
  speed: number;
  delay: number;
  pilot: Pilot;
  prev: THREE.Vector3;
  started: boolean;
  done: boolean;
  /** called when the eagle reaches the end of its path */
  onEnd: (() => void) | null;
  flapT: number;
  anim: 'glide' | 'fly' | 'grab' | 'dive';
}

export class Sky {
  readonly beasts: BeastCtl[] = [];
  readonly eagles: EagleCtl[] = [];
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private ringT = -1;
  private readonly offs: (() => void)[] = [];
  private clock = 0;

  constructor(private readonly level: LevelAPI, private readonly ground: (x: number, z: number) => number) {
    // the dive telegraph: a pulsing ring on the ground where the Fell Beast will pass
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.32, 0.08), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48, 1), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.userData.noAO = true;
    this.ring.frustumCulled = false;
    level.root.add(this.ring);
    this.offs.push(level.onUpdate((dt) => this.update(dt)));
  }

  // ── fell beasts ───────────────────────────────────────────────────────────
  /** a Fell Beast on a circuit around `center` (radius, altitude above the centre's ground) */
  addBeast(center: THREE.Vector3, radius: number, alt: number, angle: number, o: { seed?: number; scale?: number; dir?: number; speed?: number; hp?: number } = {}): BeastCtl {
    const beast = new FellBeast(this.level, { seed: o.seed ?? this.beasts.length, scale: o.scale ?? 0.55, hp: o.hp });
    beast.countsForRivalry = true;
    const ctl: BeastCtl = {
      beast,
      mode: 'circle',
      center: center.clone(),
      radius,
      alt,
      angle,
      dir: o.dir ?? 1,
      speed: o.speed ?? 22,
      curve: null,
      u: 0,
      len: 1,
      target: new THREE.Vector3(),
      struck: false,
      pilot: new Pilot(),
      prev: new THREE.Vector3(),
      bob: this.beasts.length * 1.7,
    };
    this.placeOnCircle(ctl, 0);
    ctl.prev.copy(beast.object.position);
    this.level.addCombatant(beast);
    beast.anim = 'glide';
    beast.clock = (o.seed ?? 0) * 2.3;
    beast.onHurt = () => {
      // a wounded beast breaks off a dive
      if (ctl.mode === 'dive') this.climbAway(ctl);
    };
    this.beasts.push(ctl);
    return ctl;
  }

  private placeOnCircle(c: BeastCtl, t: number): void {
    const a = c.angle;
    const y = this.ground(c.center.x, c.center.z) + c.alt + Math.sin(this.clock * 0.35 + c.bob) * 4;
    c.beast.object.position.set(c.center.x + Math.cos(a) * c.radius, y, c.center.z + Math.sin(a) * c.radius);
    void t;
  }

  /** begin a dive at `target` (ground point); the beast passes ~3 m over it and climbs away */
  dive(c: BeastCtl, target: THREE.Vector3, onPass?: () => void): void {
    if (c.mode === 'dead' || !c.beast.alive) return;
    const p0 = c.beast.object.position.clone();
    // approach from the beast's side of the sky, over the target at ~3 m, then out the far side
    const dir = _v.copy(target).sub(p0).setY(0);
    const dist = dir.length();
    dir.normalize();
    const side = _w.set(-dir.z, 0, dir.x);
    const ground = this.ground(target.x, target.z);
    const pts = [
      p0,
      p0.clone().addScaledVector(dir, dist * 0.18).addScaledVector(side, 14 * c.dir).setY(p0.y + 2),
      target.clone().addScaledVector(dir, -dist * 0.35).setY(ground + Math.max(24, (p0.y - ground) * 0.45)),
      target.clone().addScaledVector(dir, -9).setY(ground + 5.5),
      target.clone().setY(ground + 3.4),
      target.clone().addScaledVector(dir, 14).setY(ground + 5),
      target.clone().addScaledVector(dir, 48).addScaledVector(side, 10 * c.dir).setY(ground + 28),
      target.clone().addScaledVector(dir, 110).addScaledVector(side, 24 * c.dir).setY(ground + c.alt),
    ];
    c.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    c.len = c.curve.getLength();
    c.u = 0;
    c.mode = 'dive';
    c.struck = false;
    c.target.copy(target);
    c.beast.anim = 'swoop';
    this.level.ctx.audio.play('bat_screech', { pos: p0, volume: 1.3, pitch: 0.42 });
    this.ringT = 0;
    this.ring.visible = true;
    this.ring.position.set(target.x, this.ground(target.x, target.z) + 0.25, target.z);
    this.onPass = onPass ?? null;
  }
  private onPass: (() => void) | null = null;

  private climbAway(c: BeastCtl): void {
    if (!c.beast.alive) return;
    const p = c.beast.object.position;
    const away = _v.set(p.x - c.center.x, 0, p.z - c.center.z).normalize();
    c.curve = new THREE.CatmullRomCurve3([p.clone(), p.clone().addScaledVector(away, 20).setY(p.y + 14), p.clone().addScaledVector(away, 60).setY(p.y + 30)], false, 'centripetal');
    c.len = c.curve.getLength();
    c.u = 0;
    c.mode = 'climb';
    c.beast.anim = 'fly';
  }

  /** send a beast flying off to the north, away from the battle */
  leave(c: BeastCtl, to: THREE.Vector3): void {
    if (!c.beast.alive) return;
    const p = c.beast.object.position;
    const mid = p.clone().lerp(to, 0.5).setY(Math.max(p.y, to.y) + 20);
    c.curve = new THREE.CatmullRomCurve3([p.clone(), mid, to.clone()], false, 'centripetal');
    c.len = c.curve.getLength();
    c.u = 0;
    c.mode = 'leave';
    c.beast.anim = 'fly';
  }

  // ── eagles ────────────────────────────────────────────────────────────────
  /** an eagle on a spline (world points); it starts after `delay` seconds */
  addEagle(points: THREE.Vector3[], o: { seed?: number; scale?: number; speed?: number; delay?: number; onEnd?: () => void } = {}): EagleCtl {
    const eagle = new Eagle(o.seed ?? this.eagles.length, o.scale ?? 0.9);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const ctl: EagleCtl = {
      eagle,
      curve,
      u: 0,
      len: curve.getLength(),
      speed: o.speed ?? 34,
      delay: o.delay ?? 0,
      pilot: new Pilot(),
      prev: points[0].clone(),
      started: false,
      done: false,
      onEnd: o.onEnd ?? null,
      flapT: 0,
      anim: 'glide',
    };
    eagle.object.position.copy(points[0]);
    eagle.object.visible = false;
    this.level.addCombatant(eagle);
    this.eagles.push(ctl);
    return ctl;
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  private update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    const player = this.level.ctx.player;
    for (const c of this.beasts) this.updateBeast(c, dt, player.position);
    for (const e of this.eagles) this.updateEagle(e, dt);
    // the telegraph ring
    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT;
      const pulse = 0.55 + 0.45 * Math.sin(k * 9);
      this.ring.scale.setScalar(5.2 - Math.min(1, k / 2.4) * 1.4);
      this.ringMat.opacity = clamp(Math.min(1, k * 3) * pulse * 0.75, 0, 1);
      if (!this.beasts.some((b) => b.mode === 'dive')) {
        this.ringT = -1;
        this.ring.visible = false;
      }
    }
  }

  private updateBeast(c: BeastCtl, dt: number, playerPos: THREE.Vector3): void {
    const b = c.beast;
    if (!b.alive) {
      c.mode = 'dead';
      return;
    }
    const pos = b.object.position;
    if (c.mode === 'circle') {
      c.angle += (c.dir * c.speed * dt) / c.radius;
      this.placeOnCircle(c, dt);
      // wings: mostly gliding, a slow beat now and then
      b.anim = Math.sin(this.clock * 0.18 + c.bob) > 0.55 ? 'fly' : 'glide';
    } else if (c.curve) {
      const speed = c.mode === 'dive' ? 31 : 24;
      c.u = Math.min(1, c.u + (speed * dt) / c.len);
      c.curve.getPointAt(c.u, pos);
      if (c.mode === 'dive') {
        // the pass: damage the player beneath, shake the world, call the callback
        if (!c.struck && c.u > 0.58) {
          const dx = pos.x - playerPos.x;
          const dz = pos.z - playerPos.z;
          if (dx * dx + dz * dz < 22 && Math.abs(pos.y - playerPos.y) < 9) {
            this.level.ctx.player.takeDamage({ amount: 22, type: 'melee', source: b, point: playerPos, dir: _v.set(dx * -1, 0, dz * -1).normalize(), knockback: 6, stagger: true });
          }
          if (dx * dx + dz * dz < 55 * 55) this.level.ctx.player.camera.shake(0.38, 0.7);
          this.level.ctx.fx.dust(_w.set(pos.x, this.ground(pos.x, pos.z) + 0.3, pos.z), 14, 0x6a5848);
          this.level.ctx.audio.play('bat_screech', { pos, volume: 1.2, pitch: 0.45 });
          c.struck = true;
          this.onPass?.();
          this.onPass = null;
        }
        if (c.u > 0.66) b.anim = 'fly';
        if (c.u >= 1) {
          // back on a circuit
          c.mode = 'circle';
          c.angle = Math.atan2(pos.z - c.center.z, pos.x - c.center.x);
          b.anim = 'glide';
        }
      } else if (c.mode === 'climb') {
        if (c.u >= 1) {
          c.mode = 'circle';
          c.angle = Math.atan2(pos.z - c.center.z, pos.x - c.center.x);
          b.anim = 'glide';
        }
      } else if (c.mode === 'leave' && c.u >= 1) {
        b.object.visible = false;
        this.level.removeCombatant(b);
        c.mode = 'dead';
      }
    }
    // orientation from the real motion
    _v.copy(pos).sub(c.prev);
    if (dt > 0) _v.divideScalar(dt);
    c.beast.momentum.copy(_v);
    c.pilot.face(b.object, _v, dt, 1.5, 0.75);
    c.beast.model.bank = c.pilot.bank;
    c.prev.copy(pos);
  }

  private updateEagle(e: EagleCtl, dt: number): void {
    if (e.done) return;
    if (!e.started) {
      e.delay -= dt;
      if (e.delay > 0) return;
      e.started = true;
      e.eagle.object.visible = true;
    }
    const pos = e.eagle.object.position;
    e.u = Math.min(1, e.u + (e.speed * dt) / e.len);
    e.curve.getPointAt(e.u, pos);
    _v.copy(pos).sub(e.prev).divideScalar(dt);
    e.prev.copy(pos);
    e.pilot.face(e.eagle.object, _v, dt, 1.2, 0.8);
    e.eagle.bird.bank = e.pilot.bank;
    // wing beats: a few strokes to climb, long glides between
    e.flapT += dt;
    const climbing = _v.y > 2;
    e.anim = e.anim === 'grab' || e.anim === 'dive' ? e.anim : climbing || Math.sin(e.flapT * 0.28 + e.eagle.id) > 0.5 ? 'fly' : 'glide';
    e.eagle.setPose(e.anim);
    if (e.u >= 1) {
      e.done = true;
      e.eagle.object.visible = false;
      this.level.removeCombatant(e.eagle);
      e.onEnd?.();
    }
  }

  /** an eagle intercepts a Fell Beast: swoops in, the Nazgul falls, the eagle sweeps on */
  strike(e: EagleCtl, c: BeastCtl, then: THREE.Vector3): void {
    if (!c.beast.alive) return;
    const p = e.eagle.object.position.clone();
    const target = c.beast.object.position.clone().addScaledVector(c.beast.momentum, 2.2);
    const out = target.clone().addScaledVector(_v.copy(target).sub(p).setY(0).normalize(), 40).setY(target.y + 12);
    e.curve = new THREE.CatmullRomCurve3([p, p.clone().lerp(target, 0.55).setY(Math.max(p.y, target.y) + 6), target, out, then.clone()], false, 'centripetal');
    e.len = e.curve.getLength();
    e.u = 0;
    e.speed = 40;
    e.anim = 'dive';
    e.eagle.setPose('dive');
    const hit = e.len * 0.46;
    const stop = this.level.onUpdate(() => {
      if (e.u * e.len > hit - 4 && e.anim === 'dive') e.anim = 'grab';
      if (e.u * e.len >= hit) {
        stop();
        if (c.beast.alive) {
          this.level.ctx.audio.play('bat_screech', { pos: target, volume: 1.2, pitch: 0.6 });
          c.beast.countsForRivalry = false;
          c.beast.kill(null);
        }
        e.anim = 'glide';
      }
    });
  }

  dispose(): void {
    for (const f of this.offs) f();
  }
}
