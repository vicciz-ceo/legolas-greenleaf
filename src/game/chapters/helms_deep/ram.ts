/**
 * The battering ram on the Hornburg causeway: a covered ram (world batteringRam prop) rolled up
 * the ramp and along the causeway by a team of Uruk-hai. It only moves while bearers live (slower
 * with fewer); kill them all and it stops. At the gate it batters every few seconds (onStrike).
 */
import * as THREE from 'three';
import type { ColliderHandle, Enemy, LevelAPI } from '../../../core/types';
import { batteringRam } from '../../../world';
import { L } from './layout';

const START_Z = -106;
const RAMP_Z0 = L.rampFoot.z + 0.5;
const RAMP_Z1 = L.causewayStart.z + 0.4;
const TOP_Y = 5.82;
/** the ram's centre stops here: its iron head (local z +4.6) against the gate */
const STOP_Z = L.gate.z - 5.4;
const SLOPE = Math.atan2(TOP_Y, RAMP_Z1 - RAMP_Z0);
const SLOTS: [number, number][] = [[-2.05, -2.6], [2.05, -2.6], [-2.05, 0.2], [2.05, 0.2], [-2.05, 2.8], [2.05, 2.8]];

function deckY(z: number): number {
  if (z <= RAMP_Z0) return 0;
  if (z >= RAMP_Z1) return TOP_Y;
  return (TOP_Y * (z - RAMP_Z0)) / (RAMP_Z1 - RAMP_Z0);
}

export class RamTeam {
  readonly object: THREE.Object3D;
  readonly bearers: Enemy[] = [];
  z = START_Z;
  arrived = false;
  stopped = false;
  private strikeT = 1.5;
  private jolt = 0;
  private readonly col: ColliderHandle;
  private readonly c = new THREE.Vector3();
  private readonly slotTargets: THREE.Vector3[] = SLOTS.map(() => new THREE.Vector3());

  constructor(private readonly level: LevelAPI, private readonly onStrike: () => void) {
    const b = batteringRam({ seed: 3 });
    this.object = b.object;
    this.object.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    level.root.add(this.object);
    this.col = level.ctx.physics.addBox(this.c.set(L.gate.x, 1.7, START_Z), [1.7, 1.7, 3.9], 0, { material: 'wood', tag: 'ram', walkable: true });
    this.place();
  }

  /** a fresh team of bearers takes up the ram (the first team, or one replacing the dead) */
  addBearers(n: number): void {
    const { x } = L.gate;
    for (let i = 0; i < n; i++) {
      const [sx, sz] = SLOTS[i % SLOTS.length];
      const p = new THREE.Vector3(x + sx, deckY(this.z + sz) + 0.2, this.z + sz - 9);
      const e = this.level.spawnEnemy({ archetype: 'uruk', name: 'Ram bearer', weapon: 'axe', hp: 95 }, p, 0);
      e.aiEnabled = false;
      e.moveTarget = this.slotTargets[i % SLOTS.length];
      this.bearers.push(e);
    }
    this.stopped = false;
  }

  alive(): number {
    let n = 0;
    for (const e of this.bearers) if (e.alive) n++;
    return n;
  }

  private place(): void {
    const y = deckY(this.z);
    const onRamp = this.z > RAMP_Z0 && this.z < RAMP_Z1;
    this.object.position.set(L.gate.x, y, this.z + this.jolt);
    this.object.rotation.x = onRamp ? -SLOPE : 0;
    this.col.setTransform(this.c.set(L.gate.x, y + 1.7, this.z + this.jolt));
  }

  update(dt: number): void {
    const n = this.alive();
    if (!this.arrived) {
      if (n > 0) {
        // the team must close up before it heaves; slower when shorthanded
        this.z = Math.min(STOP_Z, this.z + 1.55 * Math.min(1, n / 3) * dt);
        this.stopped = false;
        if (this.z >= STOP_Z) this.arrived = true;
      } else this.stopped = true;
    } else if (n > 0) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = 2.8;
        this.jolt = 0.45;
        const { ctx } = this.level;
        const head = this.c.set(L.gate.x, TOP_Y + 1.9, L.gate.z - 0.4);
        ctx.audio.play('explosion', { pos: head, volume: 0.55, pitch: 0.45 });
        ctx.audio.play('arrow_hit_wood', { pos: head, volume: 1, pitch: 0.35 });
        ctx.fx.debris(head, 10, 0x5a4634);
        ctx.fx.dust(head, 8, 0x6a5e50);
        const d = ctx.player.position.distanceTo(head);
        if (d < 30) ctx.player.camera.shake(0.35 * (1 - d / 30), 0.4);
        this.onStrike();
      }
    } else this.stopped = true;
    this.jolt = Math.max(0, this.jolt - dt * 2.2);
    this.place();
    // bearers walk at their slots beside the ram
    for (let i = 0; i < SLOTS.length; i++) {
      const [sx, sz] = SLOTS[i];
      this.slotTargets[i].set(L.gate.x + sx, deckY(this.z + sz), this.z + sz + 0.6);
    }
  }

  dispose(): void {
    this.level.ctx.physics.remove(this.col);
  }
}
