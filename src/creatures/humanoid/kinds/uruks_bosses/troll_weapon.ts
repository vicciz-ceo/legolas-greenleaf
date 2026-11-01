/**
 * Troll weapon carry. The shared props are modelled along +Y from the grip and sit in the hand socket with +Y
 * forward (socket axes: X = T × L, Y = T = forward, Z = L = down the arm), so a club held in the relaxed hand lies
 * across the thighs. The sheets let it hang: shaft about 20-25° off vertical, outboard, head near the ground.
 * A marker object in the hand socket finds the held prop of the given kind the first time it updates and
 * scales and re-orients it (once; weapons swapped later are handled the same way).
 */
import * as THREE from 'three';
import type { KindContext } from '../../types';

export interface HeldFit {
  /** x, y, z scale on top of the hand scale (y = along the shaft) */
  scale: [number, number, number];
  /** degrees the shaft leans away from straight down, toward outboard */
  out: number;
  /** degrees the shaft leans forward from straight down */
  fwd: number;
}

export function fitHeldWeapon(ctx: KindContext, hand: 'hand_r' | 'hand_l', kinds: string[], fit: HeldFit) {
  const outSign = hand === 'hand_r' ? -1 : 1;
  const o = THREE.MathUtils.degToRad(fit.out);
  const f = THREE.MathUtils.degToRad(fit.fwd);
  // the shaft direction in socket space: +Z is down the arm, +Y forward, X toward the body for the right hand
  const dir = new THREE.Vector3(outSign * Math.sin(o), Math.sin(f), Math.cos(o) * Math.cos(f)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  ctx.object(
    () => {
      const g = new THREE.Group();
      g.name = 'weapon_fit';
      g.updateMatrixWorld = function (force?: boolean) {
        const par = this.parent;
        if (par) {
          for (const c of par.children) {
            if (c !== this && typeof c.userData.kind === 'string' && kinds.includes(c.userData.kind) && !c.userData.fitBy) {
              c.scale.set(c.scale.x * fit.scale[0], c.scale.y * fit.scale[1], c.scale.z * fit.scale[2]);
              c.quaternion.copy(q);
              c.userData.fitBy = 'troll';
            }
          }
        }
        THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
      };
      return g;
    },
    { socket: hand },
  );
}
