/**
 * Collider descriptions returned by every world builder, and the helper that registers them with the
 * physics world.
 *
 * Coordinates are in the LOCAL space of the object the builder returned. If you move / rotate that
 * object (position, yaw, scale), pass it to `addColliders(physics, descs, object)` and the colliders
 * follow. Builders that scatter things over a world area (forests, boulder fields) return world
 * coordinates directly (their object sits at the origin), so `addColliders(physics, descs)` is enough.
 * 'mesh' colliders reference a (usually invisible) Mesh that is a child of the object.
 */
import * as THREE from 'three';
import type { ColliderHandle, ColliderOpts, PhysicsWorld, Vec3Tuple } from '../core/types';

export type { ColliderOpts };

export type ColliderDesc =
  | { kind: 'box'; center: Vec3Tuple; half: Vec3Tuple; yaw?: number; opts?: ColliderOpts }
  | { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; opts?: ColliderOpts }
  | { kind: 'mesh'; mesh: THREE.Mesh; opts?: ColliderOpts };

/** result of a prop / architecture builder */
export interface Built {
  object: THREE.Object3D;
  colliders: ColliderDesc[];
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** register colliders with the physics world. Returns the handles (same order, boxes/cylinders/meshes). */
export function addColliders(physics: PhysicsWorld, descs: readonly ColliderDesc[], object?: THREE.Object3D): ColliderHandle[] {
  const out: ColliderHandle[] = [];
  let m: THREE.Matrix4 | null = null;
  let yawObj = 0;
  let scale = 1;
  if (object) {
    object.updateWorldMatrix(true, true);
    m = object.matrixWorld;
    m.decompose(_p, _q, _s);
    _e.setFromQuaternion(_q, 'YXZ');
    yawObj = _e.y;
    scale = _s.x;
  }
  for (const d of descs) {
    if (d.kind === 'box') {
      const c = new THREE.Vector3(d.center[0], d.center[1], d.center[2]);
      if (m) c.applyMatrix4(m);
      out.push(physics.addBox(c, [d.half[0] * scale, d.half[1] * scale, d.half[2] * scale], (d.yaw ?? 0) + yawObj, d.opts));
    } else if (d.kind === 'cyl') {
      const c = new THREE.Vector3(d.x, 0, d.z);
      if (m) c.applyMatrix4(m);
      const y0 = m ? m.elements[13] + d.y0 * scale : d.y0;
      const y1 = m ? m.elements[13] + d.y1 * scale : d.y1;
      out.push(physics.addCylinder(c.x, c.z, d.r * scale, y0, y1, d.opts));
    } else {
      d.mesh.updateWorldMatrix(true, false);
      out.push(physics.addMesh(d.mesh, d.opts));
    }
  }
  return out;
}

/** remove colliders added with addColliders */
export function removeColliders(physics: PhysicsWorld, handles: readonly ColliderHandle[]): void {
  for (const h of handles) physics.remove(h);
}

/** helper: invisible mesh from a geometry, used as a 'mesh' collider (child it to the builder object) */
export function colliderMesh(geo: THREE.BufferGeometry, name = 'collider'): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.visible = false;
  mesh.name = name;
  mesh.userData.collider = true;
  return mesh;
}
