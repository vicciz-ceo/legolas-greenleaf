/**
 * The hosts of Mordor and the Army of the West as instanced crowds.
 *
 * - `HostSystem.begin()` starts the march: every host waits its `delay` (game seconds), then walks
 *   along its facing until a sampled figure has covered `march` metres, then stands (idle sway).
 *   Crowds animate on the real-time clock, so the stop test reads a figure's actual position
 *   instead of integrating game time (slow-mo and pause cannot make a host overshoot).
 * - Each Mordor host has a twin at its resting place facing away, built when the host breaks (not at
 *   load). `rout()` swaps it in (half of it falls on the spot, the rest runs): crowds cannot turn
 *   around, so this is how the host breaks and flees when Sauron falls.
 */
import * as THREE from 'three';
import type { CrowdHandle, LevelAPI } from '../../../core/types';
import { ARMY, HORDES, HOSTS, hostEnd, type HostDef } from './layout';
import { HordeSystem } from './horde';

interface Marcher {
  def: HostDef;
  crowd: CrowdHandle;
  twin: CrowdHandle | null;
  sample: THREE.InstancedMesh | null;
  startX: number;
  startZ: number;
  state: 'wait' | 'march' | 'stand';
  t: number;
}

const noShadow = (c: CrowdHandle): void => {
  c.mesh.traverse((o) => {
    o.castShadow = false;
    o.userData.noAO = true; // far crowds: skip the GTAO pre-pass
  });
};

/**
 * Frustum-cull a standing crowd with a hand-set sphere (the world crowd module never culls: its
 * instance matrices move, and its animation clock ticks from onBeforeRender, so a crowd must only be
 * culled while it stands still). Without this every figure of every host is drawn from every view.
 */
export function cullStanding(c: CrowdHandle, cx: number, cz: number, half: [number, number]): void {
  const sphere = new THREE.Sphere(new THREE.Vector3(cx, 6, cz), Math.hypot(half[0], half[1]) + 14);
  c.mesh.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    im.boundingSphere = sphere.clone();
    im.frustumCulled = true;
  });
}

/**
 * Orc hosts are the darkest thing on a dark plain: lift their cloth tint so a host reads as a mass of
 * figures (not as ground) from the hills. (The crowd module multiplies this tint into the cloth only.)
 */
function liftTint(c: CrowdHandle, k: number): void {
  c.mesh.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || !im.instanceColor) return;
    const a = im.instanceColor.array as Float32Array;
    for (let i = 0; i < a.length; i++) a[i] *= k;
    im.instanceColor.needsUpdate = true;
  });
}

function firstInstanced(c: CrowdHandle): THREE.InstancedMesh | null {
  let found: THREE.InstancedMesh | null = null;
  c.mesh.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!found && m.isInstancedMesh && m.count > 0) found = m;
  });
  return found;
}

export class HostSystem {
  readonly marchers: Marcher[] = [];
  readonly army: CrowdHandle[] = [];
  private begun = false;
  private routed = false;
  private clock = 0;
  private readonly fleeing: CrowdHandle[] = [];
  readonly hordes: HordeSystem;

  private constructor(private readonly level: LevelAPI, private readonly ground: (x: number, z: number) => number, hordes: HordeSystem) {
    this.hordes = hordes;
  }

  /**
   * Build every host (detailed crowds in front, silhouette hordes behind, the Army of the West). The
   * hidden twins are NOT built here: they are made when the host breaks (see rout()), so the loading
   * screen does not pay for crowds that are only needed at the very end. `yieldFn` lets the loading UI
   * repaint between hosts.
   */
  static async create(level: LevelAPI, ground: (x: number, z: number) => number, yieldFn: () => Promise<void>): Promise<HostSystem> {
    const hs = new HostSystem(level, ground, new HordeSystem(level, ground, HORDES));
    await yieldFn();
    for (const def of HOSTS) {
      const crowd = level.crowd({ center: new THREE.Vector3(def.center[0], 0, def.center[1]), halfSize: def.half, count: def.count, kind: def.kind, facing: def.facing, speed: 0, props: true });
      noShadow(crowd);
      if (def.kind === 'orc') liftTint(crowd, 1.5);
      const sample = firstInstanced(crowd);
      const arr = sample?.instanceMatrix.array as Float32Array | undefined;
      hs.marchers.push({ def, crowd, twin: null, sample, startX: arr ? arr[12] : def.center[0], startZ: arr ? arr[14] : def.center[1], state: def.march > 0 ? 'wait' : 'stand', t: 0 });
      if (def.march <= 0) cullStanding(crowd, def.center[0], def.center[1], def.half);
      await yieldFn();
    }
    for (const l of ARMY) {
      const c = level.crowd({ center: new THREE.Vector3(l.center[0], 0, l.center[1]), halfSize: l.half, count: l.count, kind: l.kind, facing: l.facing, speed: 0, props: true });
      noShadow(c);
      cullStanding(c, l.center[0], l.center[1], l.half);
      hs.army.push(c);
    }
    return hs;
  }

  /** the host's twin: a crowd at its resting place facing away (crowds cannot turn around) */
  private makeTwin(m: Marcher): CrowdHandle {
    const [ex, ez] = hostEnd(m.def);
    const twin = this.level.crowd({ center: new THREE.Vector3(ex, 0, ez), halfSize: m.def.half, count: m.def.count, kind: m.def.kind, facing: m.def.facing + Math.PI, speed: 0, props: false });
    noShadow(twin);
    if (m.def.kind === 'orc') liftTint(twin, 1.5);
    return twin;
  }

  /** the gate opens: the hosts begin to move after their delays */
  begin(): void {
    this.begun = true;
    this.clock = 0;
    this.hordes.begin();
  }

  /**
   * Every host is standing where it was meant to be (checkpoint resume): the figures are shifted by
   * the march vector by hand (a standing crowd never rewrites its matrices).
   */
  snapToRest(): void {
    for (const m of this.marchers) {
      if (m.def.march <= 0 || m.state === 'stand') continue;
      m.state = 'stand';
      const [rx, rz] = hostEnd(m.def);
      cullStanding(m.crowd, rx, rz, m.def.half);
      const dx = Math.sin(m.def.facing) * m.def.march;
      const dz = Math.cos(m.def.facing) * m.def.march;
      m.crowd.mesh.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (!im.isInstancedMesh) return;
        const arr = im.instanceMatrix.array as Float32Array;
        for (let i = 0; i < im.count; i++) {
          arr[i * 16 + 12] += dx;
          arr[i * 16 + 14] += dz;
          arr[i * 16 + 13] = this.ground(arr[i * 16 + 12], arr[i * 16 + 14]);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    }
    this.begun = true;
    this.clock = 99;
    this.hordes.snapToRest();
  }

  /** frame update (game time) */
  update(dt: number): void {
    this.hordes.update(dt);
    if (!this.begun || this.routed) return;
    this.clock += dt;
    for (const m of this.marchers) {
      if (m.state === 'wait' && this.clock >= m.def.delay) {
        m.state = 'march';
        m.crowd.setSpeed(m.def.id === 'colG' ? 4.6 : m.def.id === 'rear' ? 3.6 : 4.2);
      }
      if (m.state === 'march' && m.sample) {
        const arr = m.sample.instanceMatrix.array as Float32Array;
        const d = Math.hypot(arr[12] - m.startX, arr[14] - m.startZ);
        if (d >= m.def.march) {
          m.state = 'stand';
          m.crowd.setSpeed(0);
          const [rx, rz] = hostEnd(m.def);
          cullStanding(m.crowd, rx, rz, m.def.half);
        }
      }
    }
  }

  get marching(): boolean {
    return this.marchers.some((m) => m.state === 'march' || m.state === 'wait');
  }

  /** some of every host falls (the battle's toll); the figures that are left keep standing */
  attrition(frac: number): void {
    for (const m of this.marchers) if (m.state === 'stand') m.crowd.thin(frac);
    this.hordes.thin(frac);
  }

  /**
   * Sauron falls: the hosts break. Half of every host drops where it stands, the rest turns and runs
   * (a twin that faces away). The Army of the West cheers where it is.
   */
  rout(): void {
    if (this.routed) return;
    this.routed = true;
    this.hordes.rout();
    for (const m of this.marchers) {
      m.crowd.mesh.visible = false;
      m.twin ??= this.makeTwin(m);
      m.twin.mesh.visible = true;
      m.twin.thin(0.45);
      m.twin.setSpeed(0);
      this.fleeing.push(m.twin);
    }
  }

  /** the broken host runs (call after rout(); speeds up over a few seconds) */
  runAway(speed: number): void {
    for (const t of this.fleeing) t.setSpeed(speed);
  }

  /** the broken host thins further */
  thinFleeing(frac: number): void {
    for (const t of this.fleeing) t.thin(frac);
  }
}
