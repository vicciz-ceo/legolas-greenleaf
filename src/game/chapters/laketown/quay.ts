/**
 * Bard's quay deck: the breakable planks. The panels that Bolg's ground slam can knock loose are
 * ONE instanced mesh (one draw call) with one box collider each; breaking a panel disables its
 * collider, tumbles the planks into the lake and leaves a hole the player can fall through (and
 * swim back from). Panels that are not breakable are part of the merged town mesh.
 */
import * as THREE from 'three';
import type { ColliderHandle, LevelAPI } from '../../../core/types';
import { mat } from '../../../world';
import { bakeBoxUV } from '../../../world/util';
import { D, WATER_Y } from './layout';

interface Panel {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  handle: ColliderHandle | null;
  broken: boolean;
  /** fall animation */
  y: number;
  vy: number;
  rx: number;
  rz: number;
  wx: number;
  wz: number;
  splashed: boolean;
  gone: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0);

export class QuayDeck {
  readonly mesh: THREE.InstancedMesh;
  private readonly panels: Panel[] = [];
  private readonly level: LevelAPI;
  private falling = 0;
  /** how many panels are gone */
  broken = 0;

  constructor(level: LevelAPI, items: { cx: number; cz: number; hx: number; hz: number }[]) {
    this.level = level;
    const w = items[0] ? items[0].hx * 2 : 2.8;
    const d = items[0] ? items[0].hz * 2 : 2.5;
    const geo = new THREE.BoxGeometry(w + 0.02, 0.2, d + 0.02);
    bakeBoxUV(geo, 1.25);
    const material = mat('wood_planks', { key: 'ltDeck', rgb: [0.66, 0.54, 0.43] });
    this.mesh = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
    this.mesh.name = 'quay_breakables';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    items.forEach((it, i) => {
      this.panels.push({ ...it, handle: null, broken: false, y: D - 0.1, vy: 0, rx: 0, rz: 0, wx: 0, wz: 0, splashed: false, gone: false });
      this.setMatrix(i, 0, 0);
    });
    this.mesh.count = items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** the physics handles, parallel to the panel list */
  bind(handles: (ColliderHandle | null)[]): void {
    handles.forEach((h, i) => {
      if (this.panels[i]) this.panels[i].handle = h;
    });
  }

  get count(): number {
    return this.panels.length;
  }

  get intact(): number {
    return this.panels.length - this.broken;
  }

  private setMatrix(i: number, rx: number, rz: number): void {
    const p = this.panels[i];
    _e.set(rx, 0, rz);
    _q.setFromEuler(_e);
    _p.set(p.cx, p.y, p.cz);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
  }

  /** knock loose up to `max` intact panels whose centre is within `radius` of (x, z), nearest first */
  breakAt(x: number, z: number, radius: number, max: number, keep?: { x: number; z: number; r: number }): number {
    const cand = this.panels
      .map((p, i) => ({ p, i, d: Math.hypot(p.cx - x, p.cz - z) }))
      .filter((c) => !c.p.broken && c.d < radius && !(keep && Math.hypot(c.p.cx - keep.x, c.p.cz - keep.z) < keep.r))
      .sort((a, b) => a.d - b.d);
    let n = 0;
    for (const c of cand) {
      if (n >= max) break;
      this.breakPanel(c.i);
      n++;
    }
    return n;
  }

  private breakPanel(i: number): void {
    const p = this.panels[i];
    p.broken = true;
    this.broken++;
    this.falling++;
    if (p.handle) p.handle.enabled = false;
    p.vy = 1.5 + Math.random() * 2.2;
    p.wx = (Math.random() - 0.5) * 3.2;
    p.wz = (Math.random() - 0.5) * 3.2;
    const { fx, audio } = this.level.ctx;
    _p.set(p.cx, D, p.cz);
    fx.debris(_p, 8, 0x6a5a48);
    fx.dust(_p, 6, 0x8a8478);
    if (i % 2 === 0) audio.play('stone_crumble', { pos: _p, volume: 0.55, pitch: 1.4 });
  }

  /** put every plank back (a respawn builds the chapter again anyway; this is for scripted resets) */
  restoreAll(): void {
    this.panels.forEach((p, i) => {
      if (!p.broken) return;
      p.broken = false;
      p.gone = false;
      p.y = D - 0.1;
      p.rx = p.rz = 0;
      if (p.handle) p.handle.enabled = true;
      this.setMatrix(i, 0, 0);
    });
    this.broken = 0;
    this.falling = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.falling <= 0) return;
    let dirty = false;
    this.panels.forEach((p, i) => {
      if (!p.broken || p.gone) return;
      p.vy -= 22 * dt;
      p.y += p.vy * dt;
      p.rx += p.wx * dt;
      p.rz += p.wz * dt;
      if (!p.splashed && p.y < WATER_Y + 0.1) {
        p.splashed = true;
        _p.set(p.cx, WATER_Y, p.cz);
        this.level.ctx.fx.splash(_p, 1.2);
        this.level.ctx.audio.play('splash', { pos: _p, volume: 0.5, pitch: 0.9 });
      }
      if (p.y < WATER_Y - 3.5) {
        p.gone = true;
        this.falling--;
        this.mesh.setMatrixAt(i, _hide);
      } else {
        // the plank floats a little once it hits the water
        if (p.splashed && p.y < WATER_Y - 0.1) {
          p.vy = Math.max(p.vy, -1.2) * 0.9;
          p.wx *= 0.9;
          p.wz *= 0.9;
        }
        this.setMatrix(i, p.rx, p.rz);
      }
      dirty = true;
    });
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
