/**
 * Siege ladders on the Deeping Wall. Each ladder lies in the mud in front of the wall, is heaved up
 * against the battlements, feeds Uruk climbers (enemy behaviour 'climb'), and can be pushed off
 * from the walkway (interact). A pushed ladder topples outward and takes every climber still on it.
 */
import * as THREE from 'three';
import type { Enemy, LevelAPI } from '../../../core/types';
import { ladder } from '../../../world';
import { clamp } from '../../../core/math';
import { WALL_H, WALL_T, wallAt } from './layout';

export type LadderState = 'down' | 'rising' | 'up' | 'falling' | 'gone';

/** distance of the foot from the outer face of the wall (clears the battered plinth) */
const FOOT_OUT = 2.3;
/** the ladder top rests just under the merlons */
const TOP_Y = WALL_H + 1.05;
const LEN = Math.hypot(TOP_Y, FOOT_OUT) + 0.05;
/** lying in the mud, top pointing away from the wall */
const LYING = 1.5;

let template: THREE.Object3D | null = null;
function ladderMesh(): THREE.Object3D {
  // one heavy 15 m siege ladder (the prop at x2: 14 cm rails, 1.3 m wide); clones share geometry
  if (!template) {
    const b = ladder(LEN / 2, { width: 0.66, hooks: true, rungGap: 0.23 });
    b.object.scale.setScalar(2);
    // raw, pale-hewn timber (lighter than the prop's weathered wood) with a faint warm sheen, so the
    // ladder reads against the dark, wet wall at night
    const lit = new Map<THREE.Material, THREE.Material>();
    b.object.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let nm = lit.get(m.material);
      if (!nm) {
        const c = (m.material as THREE.MeshStandardMaterial).clone();
        if (c.color) c.color.multiplyScalar(1.9);
        if (c.emissive) c.emissive.setHex(0x2a1a0c);
        c.emissiveIntensity = 0.55;
        nm = c;
        lit.set(m.material, c);
      }
      m.material = nm;
    });
    template = b.object;
  }
  return template.clone();
}

export interface LadderOpts {
  /** max climbers alive on this ladder at once */
  maxAlive: number;
  /** climbers this ladder sends in total */
  quota: number;
  /** seconds between climbers */
  interval: number;
}

const _w = new THREE.Vector3();

export class SiegeLadder {
  readonly pivot = new THREE.Group();
  /** wall-top contact on the outer face */
  readonly top: THREE.Vector3;
  readonly foot: THREE.Vector3;
  /** where Legolas stands to push it (walkway, behind the parapet) */
  readonly pushPoint: THREE.Vector3;
  /** where climbers haul themselves over */
  readonly climbTarget: THREE.Vector3;
  readonly out: THREE.Vector3;
  state: LadderState = 'down';
  /** tilt about the wall-parallel axis: + = top away from the wall */
  private theta = LYING;
  private omega = 0;
  private readonly lean: number;
  private t = 0;
  private spawnT = 0;
  readonly climbers: Enemy[] = [];
  spawned = 0;
  upTime = 0;
  /** who pushed it ('player', 'elf', ...) */
  pushedBy: string | null = null;
  private readonly mesh: THREE.Object3D;

  constructor(private readonly level: LevelAPI, x: number, private readonly opts: LadderOpts) {
    const w = wallAt(x);
    this.out = w.n.clone();
    this.top = w.c.clone().addScaledVector(w.n, WALL_T / 2);
    this.top.y = TOP_Y;
    this.foot = this.top.clone().addScaledVector(w.n, FOOT_OUT);
    this.foot.y = level.ctx.physics.heightAt(this.foot.x, this.foot.z) - 0.1;
    this.pushPoint = w.c.clone().addScaledVector(w.n, 1.1);
    this.climbTarget = w.c.clone().addScaledVector(w.n, 0.6);
    // the enemy climb ends when it reaches target y - 0.15; the parapet stops a climber at ~13.7,
    // so aim a little under the walkway and let the motor step him up onto it
    this.climbTarget.y = WALL_H - 0.3;
    this.lean = -Math.atan2(FOOT_OUT, TOP_Y - this.foot.y);
    this.mesh = ladderMesh();
    this.pivot.add(this.mesh);
    this.pivot.position.copy(this.foot);
    this.pivot.rotation.order = 'YXZ';
    this.pivot.rotation.y = Math.atan2(w.n.x, w.n.z);
    this.apply();
    level.root.add(this.pivot);
  }

  private apply(): void {
    this.pivot.rotation.x = this.theta;
  }

  /** heave it up against the wall (3 s) */
  raise(): void {
    if (this.state !== 'down') return;
    this.state = 'rising';
    this.t = 0;
    this.level.ctx.audio.play('uruk_roar', { pos: this.foot, volume: 0.6, pitch: 0.9 });
  }

  /** stand it against the wall at once (checkpoint restores) */
  setUp(): void {
    this.state = 'up';
    this.theta = this.lean;
    this.apply();
  }

  /** remove it entirely (already dealt with before this checkpoint) */
  hide(): void {
    this.state = 'gone';
    this.pivot.visible = false;
  }

  get pushable(): boolean {
    return this.state === 'up';
  }

  /** the ladder's world point at height fraction f (0 foot, 1 top) */
  pointAt(f: number, out: THREE.Vector3): THREE.Vector3 {
    _w.set(0, LEN * f, 0);
    this.pivot.updateMatrixWorld(true);
    return out.copy(_w).applyMatrix4(this.pivot.matrixWorld);
  }

  /** shove it off the wall: it topples outward and carries every climber still on it */
  push(by: string): number {
    if (this.state !== 'up') return 0;
    const { ctx } = this.level;
    this.state = 'falling';
    this.pushedBy = by;
    this.omega = 0.35;
    ctx.audio.play('arrow_hit_wood', { pos: this.top, volume: 1, pitch: 0.55 });
    ctx.audio.play('uruk_roar', { pos: this.top, volume: 0.7, pitch: 1.15 });
    let carried = 0;
    const dir = this.out.clone().setY(0.25).normalize();
    for (const e of this.climbers) {
      if (!e.alive || e.behavior !== 'climb' || e.position.y < 0.9) continue;
      e.takeDamage({ amount: 1e5, type: 'scripted', source: by === 'player' ? ctx.player : null, dir, knockback: 9, point: e.position.clone() });
      carried++;
    }
    return carried;
  }

  /** the climbers still on the rungs or waiting at the foot */
  liveClimbers(): number {
    let n = 0;
    for (const e of this.climbers) if (e.alive) n++;
    return n;
  }

  /** all done: down and no more climbers due */
  get finished(): boolean {
    return this.state === 'falling' || this.state === 'gone';
  }

  update(dt: number): void {
    const { ctx } = this.level;
    this.t += dt;
    // climbers low on the wall face are hidden by the parapet: keep aim assist / Focus (and the
    // autopilot) from locking onto them until they are near the top
    for (const e of this.climbers) e.targetable = e.alive && !(e.behavior === 'climb' && e.position.y < WALL_H - 3.2);
    switch (this.state) {
      case 'rising': {
        // a heave in two pushes, then it slams against the merlons
        const k = clamp(this.t / 3.0, 0, 1);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.theta = LYING + (this.lean - LYING) * e;
        this.apply();
        if (k >= 1) {
          this.state = 'up';
          this.spawnT = 0.6;
          ctx.audio.play('arrow_hit_wood', { pos: this.top, volume: 1, pitch: 0.4 });
          ctx.fx.dust(this.top, 6, 0x8a8478);
          const d = ctx.player.position.distanceTo(this.top);
          if (d < 16) ctx.player.camera.shake(0.12 * (1 - d / 16), 0.25);
        }
        break;
      }
      case 'up': {
        this.upTime += dt;
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.spawned < this.opts.quota && this.liveClimbers() < this.opts.maxAlive) {
          this.spawnT = this.opts.interval;
          this.spawnClimber();
        }
        break;
      }
      case 'falling': {
        // topple: gravity torque grows as it passes vertical
        this.omega += (2.6 * Math.sin(Math.max(0.05, this.theta)) + 0.5) * dt;
        this.theta += this.omega * dt;
        if (this.theta >= LYING) {
          this.theta = LYING;
          this.state = 'gone';
          this.t = 0;
          const tip = this.pointAt(0.85, new THREE.Vector3());
          ctx.fx.dust(tip, 18, 0x5a5048);
          ctx.fx.splash(tip, 10);
          ctx.audio.play('barrel_bump', { pos: tip, volume: 1, pitch: 0.5 });
          // the climbers still waiting at the foot are under it when it comes down
          const dir = this.out.clone().setY(0.4).normalize();
          for (const e of this.climbers) {
            if (!e.alive || e.position.y > 3) continue;
            const along = (e.position.x - this.foot.x) * this.out.x + (e.position.z - this.foot.z) * this.out.z;
            const side = (e.position.x - this.foot.x) * this.out.z - (e.position.z - this.foot.z) * this.out.x;
            if (along < -1.5 || along > LEN + 1 || Math.abs(side) > 2.6) continue;
            e.takeDamage({ amount: 1e5, type: 'crush', source: this.pushedBy === 'player' ? ctx.player : null, dir, knockback: 4, point: e.position.clone().setY(e.position.y + 1) });
          }
        }
        this.apply();
        break;
      }
      case 'gone': {
        // sink into the mud and out of sight after a while (keeps the coomb readable)
        if (this.pivot.visible && this.t > 6) {
          this.pivot.position.y -= dt * 0.6;
          if (this.t > 9) this.pivot.visible = false;
        }
        break;
      }
      default:
        break;
    }
  }

  private spawnClimber(): void {
    const k = this.spawned++;
    const p = this.foot.clone().addScaledVector(this.out, 2.2 + (k % 3) * 1.1);
    p.x += ((k % 2) - 0.5) * 0.6;
    const e = this.level.spawnEnemy({ archetype: 'uruk', behavior: 'climb', weapon: k % 3 === 2 ? 'axe' : 'sword', name: 'Uruk-hai' }, p, Math.atan2(-this.out.x, -this.out.z));
    e.moveTarget = this.climbTarget.clone();
    this.climbers.push(e);
  }
}
