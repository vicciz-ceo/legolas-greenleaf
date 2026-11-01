/**
 * Tauriel's hip scabbards. A copy of the shared `sheathed()` (elves_men/detail.ts) with two changes:
 *  - the stowed weapon is created with a weapon style (`'elven'`: brown leather-wrapped hilts, brass guard
 *    and pommel), so the knives on her hips match the ones in her hands;
 *  - the stowed copy is rolled about its own blade axis so the knife's wide axis (its swept leaf-wing guard
 *    is about 12 cm across) lies front-to-back along the hip instead of sticking out sideways, and the
 *    scabbard is flattened the same way. Only the stowed copy is rolled; the knife in hand is untouched.
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
  o: {
    kind: WeaponKind;
    style: WeaponStyle;
    hand: 'hand_r' | 'hand_l';
    bone?: string;
    pos: V3;
    dir: V3;
    len: number;
    r: number;
    color: number;
    trim?: number;
    mat?: SurfaceName | SurfaceSpec;
    seed?: number;
    weaponStart?: number;
    /** cross-section flattening of the scabbard (1 = round) */
    flat?: number;
    /** roll of the stowed knife about its blade axis (radians); 0 = wide axis outward (x) */
    roll?: number;
  },
) {
  const bone = o.bone ?? 'hips';
  const d = new THREE.Vector3(o.dir[0], o.dir[1], o.dir[2]).normalize();
  const start = o.weaponStart ?? 0.09;
  const a: V3 = [o.pos[0] + d.x * start, o.pos[1] + d.y * start, o.pos[2] + d.z * start];
  const b: V3 = [o.pos[0] + d.x * (start + o.len), o.pos[1] + d.y * (start + o.len), o.pos[2] + d.z * (start + o.len)];
  const roll = o.roll ?? Math.PI / 2;
  // scabbard: tapered tube, wide front-to-back (z) once the knife is rolled, thin across the hip (x)
  const wideAxis = new THREE.Vector3(0, 0, 1);
  put(ctx, flatTube(a, b, o.r, o.r * 0.74, o.flat ?? 0.6, roll ? wideAxis : new THREE.Vector3(1, 0, 0)), { bone, color: o.color, mat: o.mat ?? 'leather_worn', small: true });
  // bronze throat cuff and chape
  put(ctx, ring(a, o.dir, o.r * 1.18, o.r * 0.3, 10, 3), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  put(ctx, ring([a[0] + d.x * 0.012, a[1] + d.y * 0.012, a[2] + d.z * 0.012], o.dir, o.r * 1.12, o.r * 0.22, 10, 3), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(o.r * 0.82, 7, 5).translate(b[0], b[1], b[2]), { bone, color: o.trim ?? 0x9a8444, mat: 'gold', small: true });
  ctx.object(
    () => {
      const w = createWeapon(o.kind, o.seed ?? 3, o.style);
      w.position.set(o.pos[0], o.pos[1], o.pos[2]);
      const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      // roll about the blade axis so the guard's wide axis (local x) lies along the target direction (world z,
      // front-to-back); the alignment above leaves it diagonal, so the roll is measured, not a fixed angle
      const wing = new THREE.Vector3(1, 0, 0).applyQuaternion(q0);
      wing.addScaledVector(d, -wing.dot(d)).normalize();
      const target = new THREE.Vector3(0, 0, 1);
      target.addScaledVector(d, -target.dot(d)).normalize();
      const ang = roll ? Math.atan2(d.dot(new THREE.Vector3().crossVectors(wing, target)), wing.dot(target)) : 0;
      w.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(d, ang).multiply(q0));
      w.userData.stowFor = { hand: o.hand, weapon: o.kind };
      return w;
    },
    { bone, small: true },
  );
}

/** a tapered tube flattened across `across` (the scabbard is thin along that axis) */
function flatTube(a: V3, b: V3, r0: number, r1: number, flat: number, wide: THREE.Vector3): THREE.BufferGeometry {
  const g = taperedTube([a, b], r0, r1, { seg: 4, radial: 7 });
  const origin = new THREE.Vector3(a[0], a[1], a[2]);
  const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  // the thin axis: perpendicular to both the blade axis and the wide axis
  const side = new THREE.Vector3().crossVectors(axis, wide).normalize();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(origin);
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
