/**
 * The barrel train: a convoy of floating barrels, each with a dwarf waist-deep in it, riding the
 * river spline. Barrels are driven in river coordinates (s downstream, l lateral): they share the
 * flow speed, keep their lanes, steer around the rocks standing in the rapids, bob, roll and bump.
 *
 * Each barrel owns a thin walkable collider at head height (a moving ColliderHandle moved with
 * setTransform + velocity every step), so enemies that leap onto a barrel stand on it and are
 * carried downstream by the physics motor. The player does not use the colliders: the barrel mover
 * (riders.ts) places Legolas on the barrel directly.
 */
import * as THREE from 'three';
import type { ColliderHandle, Humanoid, LevelAPI } from '../../../core/types';
import { damp, smoothstep } from '../../../core/math';
import { makeHumanoid } from '../../../actors/humanoids';
import { barrel } from '../../../world';
import { RIVER_LEN, RIVER_ROCKS, flowSpeedAt, flowYaw, riverPos, waterY, widthAt } from './layout';

/** height of the dwarf's head above the water: where a rider's feet are */
export const STAND_H = 1.52;
/** half-size of the head-top platform collider (m) */
const PLATFORM_HALF = 0.62;
/** barrel dimensions */
const BARREL_H = 1.2;
const BARREL_DRAFT = 0.36;

export interface Barrel {
  readonly idx: number;
  /** arc position (m) and lateral offset (+ = right of the flow) */
  s: number;
  l: number;
  /** lane offset in the formation */
  lane: number;
  /** longitudinal offset from the head of the train */
  off: number;
  phase: number;
  /** world point at head height (where a rider stands), updated every step */
  readonly stand: THREE.Vector3;
  /** world velocity (m/s) */
  readonly vel: THREE.Vector3;
  /** 0..1 transient jolt from a bump */
  bump: number;
  /** who stands on it right now */
  rider: 'player' | 'enemy' | 'ally' | null;
  readonly collider: ColliderHandle;
  readonly dwarf: Humanoid;
  readonly holder: THREE.Group;
  /** spin about the vertical axis */
  spin: number;
  /** a splash/jolt from landing */
  dip: number;
  /** set by the log bridge etc. to remove the barrel from play */
  smashed: boolean;
}

interface InstanceBase {
  mesh: THREE.InstancedMesh;
  base: THREE.Matrix4;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s1 = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _pp = new THREE.Vector3();

export interface TrainOpts {
  count?: number;
  /** s of the head of the convoy at the start */
  headS: number;
  /** barrels wait here (behind the gate) until release() */
  holdS?: number;
}

const LANES = [0, -2.5, 2.5, 0.3, 2.3, -2.2, 0, -2.6, 2.6, 0.2, -2.3, 2.2, 0, -2.5];

export class BarrelTrain {
  readonly barrels: Barrel[] = [];
  /** the s of the head of the convoy */
  sLead: number;
  /** script-controlled multiplier on the flow speed (log bridge slows the convoy, the pool eases it) */
  speedMul = 1;
  /** true once the gate is open and the convoy moves */
  running = false;
  /** 0..1 how strongly the convoy leans to the left bank (the shingle bank at the end) */
  endBias = 0;
  /** the convoy's current speed (m/s) */
  speed = 0;
  /** extra lateral room scale (the chute squeezes the formation) */
  private readonly instances: InstanceBase[] = [];
  private t = 0;
  private readonly holdS: number;
  private bumpCd = 0;
  private lastWorld: THREE.Vector3[] = [];

  constructor(private readonly level: LevelAPI, opts: TrainOpts) {
    this.sLead = opts.headS;
    this.holdS = opts.holdS ?? opts.headS;
    const count = opts.count ?? 12;
    const { physics } = level.ctx;

    // ── instanced barrel bodies: one InstancedMesh per material of the barrel prop ──
    const proto = barrel({ height: BARREL_H, open: true, seed: 5 });
    proto.object.updateMatrixWorld(true);
    proto.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      inst.name = 'barrels';
      level.root.add(inst);
      this.instances.push({ mesh: inst, base: mesh.matrixWorld.clone() });
    });

    // ── dwarves: four looks (seed buckets), cycled ──
    for (let i = 0; i < count; i++) {
      const holder = new THREE.Group();
      holder.name = `barrel-dwarf-${i}`;
      const dwarf = makeHumanoid({ kind: 'dwarf', seed: i % 4 === 0 ? 0 : (i % 4) * 7 + i, weapon: 'none', offhand: 'none' });
      // hips sit just below the rim: the legs are inside the barrel
      dwarf.root.position.set(0, BARREL_H - 0.12 - dwarf.height * 0.5, 0);
      holder.add(dwarf.root);
      dwarf.setLod(0);
      level.root.add(holder);
      const col = physics.addBox(new THREE.Vector3(0, -50, 0), [PLATFORM_HALF, 0.1, PLATFORM_HALF], 0, {
        walkable: true, solid: false, blocksArrows: false, blocksCamera: false, material: 'wood', tag: 'barrel',
      });
      const b: Barrel = {
        idx: i,
        s: opts.headS - i * 3.1,
        l: 0,
        lane: LANES[i % LANES.length],
        off: i * 3.1,
        phase: i * 2.17,
        stand: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        bump: 0,
        rider: null,
        collider: col,
        dwarf,
        holder,
        spin: i * 1.3,
        dip: 0,
        smashed: false,
      };
      this.barrels.push(b);
      this.lastWorld.push(new THREE.Vector3());
    }
    // initial placement: a loose cluster in the pool, then settle
    this.layout(0, true);
    this.update(0.001);
  }

  /** open the gate: the convoy starts to move */
  release(): void {
    this.running = true;
  }

  /** put the convoy straight into the ride (checkpoint resume): head at s, already moving */
  jumpTo(headS: number): void {
    this.sLead = headS;
    this.running = true;
    this.layout(0, true);
    this.update(0.001);
  }

  /** target s of barrel i */
  private targetS(b: Barrel): number {
    return this.sLead - b.off + Math.sin(this.t * 0.9 + b.phase) * 0.35;
  }

  private layout(dt: number, snap: boolean): void {
    for (const b of this.barrels) {
      b.s = this.targetS(b);
      if (snap) b.l = this.targetL(b, 0);
    }
    void dt;
  }

  /** where the barrel wants to be laterally: its lane scaled to the local width, rocks pushing it aside */
  private targetL(b: Barrel, dt: number): number {
    void dt;
    const hw = widthAt(b.s) / 2;
    const room = Math.max(0.5, hw - 1.5);
    let l = b.lane * Math.min(1, room / 3.0) + Math.sin(this.t * 0.55 + b.phase * 1.7) * Math.min(1.1, room * 0.35);
    // the convoy drifts to the left bank when it reaches the shingle
    l -= this.endBias * room * 0.75;
    // the cellar pool: spread out like a milling shoal before the gate opens
    if (!this.running) l = b.lane * 2.1 + Math.sin(this.t * 0.4 + b.phase) * 1.2;
    // rocks
    for (const r of RIVER_ROCKS) {
      const ds = r.s - b.s;
      if (ds < -(r.r + 2) || ds > r.r + 6) continue;
      const clear = r.r + 1.05;
      const d = l - r.l;
      // push away from the rock before reaching it (ds > 0), hold the offset while beside it
      const reach = smoothstep(r.r + 6, r.r + 0.5, ds) * (1 - smoothstep(-r.r - 0.5, -r.r - 2, ds));
      if (Math.abs(d) < clear && reach > 0) {
        const dir = d === 0 ? (b.lane >= r.l ? 1 : -1) : Math.sign(d);
        l += dir * (clear - Math.abs(d)) * reach;
      }
    }
    return Math.max(-room - 0.3, Math.min(room + 0.3, l));
  }

  /** nearest live barrel to a world point (optionally filtered) */
  nearest(p: THREE.Vector3, filter?: (b: Barrel) => boolean): Barrel | null {
    let best: Barrel | null = null;
    let bd = Infinity;
    for (const b of this.barrels) {
      if (b.smashed || (filter && !filter(b))) continue;
      const d = (b.stand.x - p.x) ** 2 + (b.stand.y - p.y) ** 2 * 0.3 + (b.stand.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** the barrel with the largest s (the leader) that is not smashed */
  leader(): Barrel {
    return this.barrels.reduce((a, b) => (b.s > a.s ? b : a));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    this.bumpCd -= dt;
    const { fx, audio, player } = this.level.ctx;
    // speed
    if (this.running) {
      const v = flowSpeedAt(this.sLead) * this.speedMul;
      this.speed = damp(this.speed, v, 1.6, dt);
      this.sLead = Math.min(RIVER_LEN - 6, this.sLead + this.speed * dt);
    } else {
      this.speed = damp(this.speed, 0.25, 1.5, dt);
      this.sLead = Math.min(this.holdS, this.sLead + 0.0 * dt);
    }
    const cam = this.level.ctx.engine.camera.position;
    for (const b of this.barrels) {
      const prevS = b.s;
      // while waiting behind the gate the barrels mill about
      if (!this.running) {
        const sWait = this.holdS - 2 - (b.idx % 4) * 3.4 - Math.floor(b.idx / 4) * 0.8 + Math.sin(this.t * 0.35 + b.phase) * 0.6;
        b.s = damp(b.s, sWait, 1.4, dt);
      } else b.s = this.targetS(b);
      const wantL = this.targetL(b, dt);
      const lPrev = b.l;
      b.l = damp(b.l, wantL, 2.6, dt);
      // rock bumps: close pass -> jolt, splash, thump
      if (this.running && b.bump < 0.2) {
        for (const r of RIVER_ROCKS) {
          if (Math.abs(r.s - b.s) < r.r + 0.7 && Math.abs(b.l - r.l) < r.r + 0.95) {
            b.bump = 1;
            if (this.bumpCd <= 0) {
              this.bumpCd = 0.35;
              riverPos(b.s, b.l, 0, _pp);
              fx.splash(_pp, 1.1);
              audio.play('barrel_bump', { pos: _pp, volume: 0.7, pitch: 0.9 + b.idx * 0.02 });
              if (b.rider === 'player') player.camera.shake(0.12, 0.25);
            }
            break;
          }
        }
      }
      b.bump = Math.max(0, b.bump - dt * 2.2);
      b.dip = damp(b.dip, 0, 6, dt);
      b.spin += dt * (0.35 + 0.3 * Math.sin(b.phase)) * (this.running ? 1 : 0.4);

      // pose in the world
      const water = waterY(b.s);
      const bob = Math.sin(this.t * 1.7 + b.phase * 1.3) * 0.09 + Math.sin(this.t * 3.1 + b.phase) * 0.04;
      const yawFlow = flowYaw(b.s);
      const pitch = Math.sin(this.t * 1.4 + b.phase) * 0.05 + b.bump * 0.28 * Math.sin(this.t * 22);
      const roll = Math.sin(this.t * 1.1 + b.phase * 2) * 0.06 + (b.l - lPrev) * 0.9 + b.bump * 0.2 * Math.sin(this.t * 17 + 1);
      const baseY = water - BARREL_DRAFT + bob - b.dip * 0.25 + b.bump * 0.12;
      riverPos(b.s, b.l, 0, _p);
      // barrel transform: origin at the foot of the barrel
      _e.set(pitch, yawFlow + b.spin, roll, 'YXZ');
      _q.setFromEuler(_e);
      b.holder.position.set(_p.x, baseY, _p.z);
      b.holder.quaternion.copy(_q);
      b.holder.updateMatrixWorld(true);
      for (const inst of this.instances) {
        _m.compose(b.holder.position, _q, _s1).multiply(inst.base);
        inst.mesh.setMatrixAt(b.idx, _m);
      }
      // head-top stand point (follows the bob and tilt a little)
      const sx = _p.x;
      const sz = _p.z;
      const sy = water + STAND_H + bob - b.dip * 0.25 + b.bump * 0.12;
      const lw = this.lastWorld[b.idx];
      b.vel.set((sx - lw.x) / dt, (sy - lw.y) / dt, (sz - lw.z) / dt);
      if (lw.lengthSq() === 0) b.vel.set(0, 0, 0);
      if (b.vel.lengthSq() > 900) b.vel.set(0, 0, 0);
      lw.set(sx, sy, sz);
      b.stand.set(sx, sy, sz);
      // collider: the platform's top face is the stand height
      _pp.set(sx, sy - 0.1, sz);
      b.collider.setTransform(_pp, yawFlow);
      b.collider.velocity.copy(b.vel);
      b.collider.enabled = !b.smashed;
      void prevS;
      // dwarf level of detail by distance to the camera
      const dx = sx - cam.x;
      const dz = sz - cam.z;
      const d2 = dx * dx + dz * dz;
      b.holder.visible = d2 < 260 * 260;
      if (d2 > 0) {
        const lod = d2 < 10 * 10 ? 0 : d2 < 26 * 26 ? 1 : 2;
        (b.dwarf as Humanoid & { _lod?: number })._lod ??= -1;
        const dw = b.dwarf as Humanoid & { _lod?: number };
        if (dw._lod !== lod) {
          dw._lod = lod;
          b.dwarf.setLod(lod as 0 | 1 | 2);
          b.dwarf.setCastShadow(lod < 2);
        }
        // far dwarves animate at a lower rate
        const every = lod === 0 ? 1 : lod === 1 ? 2 : 4;
        if ((Math.floor(this.t * 60) + b.idx) % every === 0) {
          b.dwarf.animate(dt * every, {
            speed: 0, grounded: true, special: 'barrel', specialT: this.t * 0.22 + b.phase,
            hit: b.rider === 'player' ? Math.max(0, 0.45 - b.dip * 0.2) : 0,
          });
        }
      }
    }
    for (const inst of this.instances) inst.mesh.instanceMatrix.needsUpdate = true;
  }

  /** a rider lands on a barrel: it dips, the dwarf grumbles with a flinch */
  landOn(b: Barrel, impact = 1): void {
    b.dip = Math.min(1, b.dip + 0.6 * impact);
    b.bump = Math.max(b.bump, 0.4 * impact);
    this.level.ctx.fx.splash(_pp.set(b.stand.x, b.stand.y - STAND_H + 0.1, b.stand.z), 0.7);
    this.level.ctx.audio.play('barrel_bump', { pos: b.stand, volume: 0.6, pitch: 1.1 });
  }
}
