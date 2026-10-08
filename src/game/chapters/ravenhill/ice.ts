/**
 * Slippery ice on the frozen river (a LOCAL WORKAROUND: the physics motor has no per-material
 * friction, and chapters must not edit it).
 *
 * The player's locomotion runs before the level's per-step callbacks and shares its velocity
 * vector with the motor, so blending this step's velocity back toward last step's (only while
 * grounded on the ice) turns the crisp run into a skating one: slow to get going, slow to stop,
 * slow to turn. Jumps, dashes and movers are untouched (dashes keep their burst: they overwrite
 * the velocity every step anyway).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { onIce } from './layout';

/** how fast the velocity may follow the input on ice (1/s; lower = slipperier). 12 ≈ a fifth of the normal grip */
const GRIP = 12;

export function installIce(level: LevelAPI): { enabled: boolean } {
  const { player } = level.ctx;
  const prev = new THREE.Vector3();
  let had = false;
  const state = { enabled: true };
  level.onUpdate((dt) => {
    const p = player.position;
    const on = state.enabled && !player.mover && player.grounded && player.alive && onIce(p.x, p.z, p.y);
    if (on && had && dt > 0) {
      const v = player.velocity;
      const k = 1 - Math.exp(-GRIP * dt);
      // keep most of last step's horizontal momentum, but never exceed the run speed
      const nx = prev.x + (v.x - prev.x) * k;
      const nz = prev.z + (v.z - prev.z) * k;
      // a dash (fast burst) is never damped
      if (Math.hypot(v.x, v.z) < 10) {
        v.x = nx;
        v.z = nz;
      }
    }
    had = on;
    prev.copy(player.velocity);
  });
  return state;
}
