/**
 * The falling stones: a chain of masonry blocks hanging in mid-air as the bridge and tower come
 * down, each a moving box collider. Land on one and it shudders, then drops out from under you
 * (`DROP_DELAY` s): keep climbing. Normal locomotion with the (double) jump: no mover.
 *
 * reset() puts every stone back (after a fall), `next` is the stone to jump to (bot + HUD), and
 * `reachedTop` turns true once Legolas stands on the summit.
 */
import * as THREE from 'three';
import type { ColliderHandle, LevelAPI } from '../../../core/types';
import { mat, stoneBlock } from '../../../world';
import { GAP_X0, BRIDGE, PINNACLE } from './layout';

export const STONE_COUNT = 10;
const SIZE_Y = 1.05;
const DROP_DELAY = 1.45;
const RISE = (PINNACLE.y - BRIDGE.y) / STONE_COUNT;

interface Stone {
  object: THREE.Object3D;
  /** footprint (x, z) */
  w: number;
  d: number;
  /** grit trickling off the underside (s until the next puff) */
  grit: number;
  col: ColliderHandle;
  /** home position (bottom centre) */
  home: THREE.Vector3;
  /** top surface centre at home */
  top: THREE.Vector3;
  phase: number;
  state: 'hover' | 'shake' | 'fall' | 'gone';
  t: number;
  vy: number;
  spin: THREE.Vector3;
}

export interface FallingStones {
  readonly stones: readonly Stone[];
  /** index of the highest stone the player has landed on (-1 = none yet) */
  readonly reached: number;
  /** the next stone to jump to (top centre), or null at the top */
  next(): THREE.Vector3 | null;
  /** the stone under the player (index) or -1 */
  readonly standing: number;
  /** true once any stone has been stood on (the clock runs) */
  readonly started: boolean;
  reset(): void;
  /** the collapse: the stones tumble down into their places in mid-air (hidden until then) */
  reveal(instant?: boolean): void;
  /** drop everything that is left (time ran out) */
  collapse(): void;
  update(dt: number): void;
  dispose(): void;
}

export function createFallingStones(level: LevelAPI): FallingStones {
  const { physics, player, fx, audio } = level.ctx;
  const stones: Stone[] = [];
  const masonry = mat('stone_blocks', { key: 'rh_falling', rgb: [0.64, 0.62, 0.59] });
  const x0 = GAP_X0 + 1.4;
  const x1 = PINNACLE.x - PINNACLE.r - 1.9;
  for (let i = 0; i < STONE_COUNT; i++) {
    const f = i / (STONE_COUNT - 1);
    // irregular debris, not a stair: the stones zig-zag across the line of the old deck with real gaps
    // between them (~1.2 m edge to edge), vary in size and sit a little askew
    const x = x0 + (x1 - x0) * f + Math.sin(i * 2.9) * 0.25;
    const z = BRIDGE.z + (i % 2 === 0 ? -1 : 1) * (0.7 + 0.25 * Math.abs(Math.sin(i * 1.7)));
    const topY = BRIDGE.y + RISE * (i + 1);
    const w = 1.95 + 0.3 * Math.abs(Math.sin(i * 3.1));
    const d = 2.0 + 0.3 * Math.abs(Math.cos(i * 2.2));
    const b = stoneBlock([w, SIZE_Y + 0.25 * Math.abs(Math.sin(i * 1.3)), d], 300 + i, { kind: 'dark' });
    // dressed masonry of the tower and the bridge (not the pinnacle's natural rock), a dark grey
    (b.object.children[0] as THREE.Mesh).material = masonry;
    // the block is a little deeper than the collider: the extra hangs below (a broken underside)
    b.object.children[0].position.y -= 0.25 * Math.abs(Math.sin(i * 1.3));
    const home = new THREE.Vector3(x, topY - SIZE_Y, z);
    b.object.position.copy(home);
    b.object.rotation.y = Math.sin(i * 2.3) * 0.45;
    level.root.add(b.object);
    const col = physics.addBox(new THREE.Vector3(x, topY - SIZE_Y / 2, z), [(w / 2) * 0.95, SIZE_Y / 2, (d / 2) * 0.95], b.object.rotation.y, { material: 'stone', tag: 'falling_stone' });
    stones.push({ object: b.object, w, d, grit: (i % 5) * 0.23, col, home, top: new THREE.Vector3(x, topY, z), phase: i * 0.9, state: 'hover', t: 0, vy: 0, spin: new THREE.Vector3() });
    b.object.visible = false;
    col.enabled = false;
  }
  let revealed = false;
  /** seconds since reveal: the stones settle from above for the first 1.6 s */
  let settleT = 99;
  let reached = -1;
  let standing = -1;
  let started = false;
  const tmp = new THREE.Vector3();

  function onStone(s: Stone): boolean {
    if (!player.grounded || s.state === 'fall' || s.state === 'gone') return false;
    const p = player.position;
    const dx = p.x - s.object.position.x;
    const dz = p.z - s.object.position.z;
    const yTop = s.object.position.y + SIZE_Y;
    // footprint test in the stone's own frame
    const c = Math.cos(s.object.rotation.y);
    const sn = Math.sin(s.object.rotation.y);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    return Math.abs(lx) < s.w * 0.62 && Math.abs(lz) < s.d * 0.62 && Math.abs(p.y - yTop) < 0.35;
  }

  const api: FallingStones = {
    stones,
    get reached() {
      return reached;
    },
    get standing() {
      return standing;
    },
    get started() {
      return started;
    },
    next() {
      const i = Math.max(reached, standing) + 1;
      return i < stones.length ? stones[i].top : null;
    },
    reveal(instant = false) {
      revealed = true;
      settleT = instant ? 99 : 0;
      api.reset();
    },
    reset() {
      if (!revealed) return;
      reached = -1;
      standing = -1;
      started = false;
      for (const s of stones) {
        s.state = 'hover';
        s.t = 0;
        s.vy = 0;
        s.object.visible = true;
        s.object.position.copy(s.home);
        s.object.rotation.x = Math.sin(s.phase * 3.7) * 0.05;
        s.object.rotation.z = Math.cos(s.phase * 2.9) * 0.05;
        s.col.enabled = true;
        s.col.velocity.set(0, 0, 0);
        tmp.copy(s.home).setY(s.home.y + SIZE_Y / 2);
        s.col.setTransform(tmp, s.object.rotation.y);
      }
    },
    collapse() {
      for (const s of stones) if (s.state === 'hover' || s.state === 'shake') {
        s.state = 'fall';
        s.vy = -1;
      }
    },
    update(dt) {
      standing = -1;
      if (!revealed) return;
      settleT += dt;
      // tumbling down into place (debris of the collapse, caught mid-fall)
      const drop = settleT < 1.6 ? Math.pow(1 - settleT / 1.6, 2) * 14 : 0;
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i];
        s.t += dt;
        if (s.state === 'hover' || s.state === 'shake') {
          if (onStone(s)) {
            standing = i;
            if (i > reached) reached = i;
            if (s.state === 'hover') {
              s.state = 'shake';
              s.t = 0;
              started = true;
              audio.play('stone_crumble', { pos: s.object.position, volume: 0.7, pitch: 1.1 + Math.random() * 0.2 });
              fx.dust(tmp.copy(s.object.position).setY(s.object.position.y + SIZE_Y), 5, 0xc8ccd0);
            }
          }
          // hovering debris bobs a little in the collapse; a stood-on stone shudders, then drops
          const bob = Math.sin(s.t * 1.3 + s.phase) * 0.06;
          // grit and dust trickle off the underside: these are blocks of a falling tower, not steps
          s.grit -= dt;
          if (s.grit <= 0 && settleT > 1.6) {
            s.grit = 0.9 + ((s.phase * 7.3) % 1) * 1.1;
            fx.debris(tmp.copy(s.object.position).setY(s.object.position.y - 0.3), 2, 0x4a4844);
          }
          let jitter = 0;
          if (s.state === 'shake') {
            jitter = Math.sin(s.t * 60) * 0.03 * Math.min(1, s.t / 0.5);
            if (s.t > DROP_DELAY * 0.55 && Math.random() < dt * 8) fx.debris(s.object.position, 2, 0x6a6862);
            if (s.t >= DROP_DELAY) {
              s.state = 'fall';
              s.vy = -0.5;
              s.spin.set((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
              audio.play('stone_crumble', { pos: s.object.position, volume: 0.9, pitch: 0.8 });
            }
          }
          const y = s.home.y + bob + drop * (1 + (i % 3) * 0.3);
          const vy = (y - s.object.position.y) / Math.max(dt, 1e-4);
          s.object.position.set(s.home.x + jitter, y, s.home.z);
          tmp.copy(s.object.position).setY(y + SIZE_Y / 2);
          s.col.velocity.set(0, vy, 0);
          s.col.setTransform(tmp, s.object.rotation.y);
        } else if (s.state === 'fall') {
          s.vy -= 20 * dt;
          s.object.position.y += s.vy * dt;
          s.object.rotation.x += s.spin.x * dt;
          s.object.rotation.z += s.spin.z * dt;
          tmp.copy(s.object.position).setY(s.object.position.y + SIZE_Y / 2);
          s.col.velocity.set(0, s.vy, 0);
          if (Math.random() < dt * 10) fx.dust(s.object.position, 2, 0xb8bcc0);
          s.col.setTransform(tmp, s.object.rotation.y);
          if (s.object.position.y < s.home.y - 3) s.col.enabled = false;
          if (s.object.position.y < BRIDGE.y - 40) {
            s.state = 'gone';
            s.object.visible = false;
          }
        }
      }
    },
    dispose() {
      for (const s of stones) physics.remove(s.col);
    },
  };
  return api;
}
