/**
 * Tauriel's hip scabbards. A copy of the shared `sheathed()` (elves_men/detail.ts) that creates the
 * stowed weapon with a weapon style (`'elven'`: brown leather-wrapped hilts with brass guard and
 * pommel), so the knives on her hips match the ones in her hands.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { WeaponKind } from '../../../../core/types';
import { createWeapon, type WeaponStyle } from '../../../weapons';
import type { KindContext } from '../../types';
import { put, ring, taperedTube } from './geo';

export function sheathedStyled(
  ctx: KindContext,
  o: { kind: WeaponKind; style: WeaponStyle; hand: 'hand_r' | 'hand_l'; bone?: string; pos: V3; dir: V3; len: number; r: number; color: number; trim?: number; mat?: SurfaceName | SurfaceSpec; seed?: number; weaponStart?: number; flat?: number },
) {
  const bone = o.bone ?? 'hips';
  const d = new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]).normalize();
  const start = o.weaponStart ?? 0.09;
  const a: V3 = [o.pos[0] + d.x * start, o.pos[1] + d.y * start, o.pos[2] + d.z * start];
  const b: V3 = [o.pos[0] + d.x * (start + o.len), o.pos[1] + d.y * (start + o.len), o.pos[2] + d.z * (start + o.len)];
  // scabbard: slightly flattened tapered tube
  put(ctx, flatTube(a, b, o.r, o.r * 0.78, o.flat ?? 0.55), { bone, color: o.color, mat: o.mat ?? 'leather_worn', small: true });
  // locket at the mouth and chape at the tip
  put(ctx, ring(a, o.dir, o.r * 1.12, o.r * 0.28, 10, 3), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(o.r * 0.82, 7, 5).translate(b[0], b[1], b[2]), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  ctx.object(
    () => {
      const w = createWeapon(o.kind, o.seed ?? 3, o.style);
      w.position.set(o.pos[0], o.pos[1], o.pos[2]);
      w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      w.userData.stowFor = { hand: o.hand, weapon: o.kind };
      return w;
    },
    { bone, small: true },
  );
}

/** a tapered tube flattened across the blade width */
function flatTube(a: V3, b: V3, r0: number, r1: number, flat: number): THREE.BufferGeometry {
  const g = taperedTube([a, b], r0, r1, { seg: 4, radial: 7 });
  const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(new THREE.Vector3(...a));
    const t = v.dot(axis);
    c.copy(axis).multiplyScalar(t);
    v.sub(c);
    const sd = v.dot(side);
    v.addScaledVector(side, -sd * (1 - flat));
    pos.setXYZ(i, a[0] + c.x + v.x, a[1] + c.y + v.y, a[2] + c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}
