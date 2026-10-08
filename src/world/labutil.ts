/** Lab helpers for world subjects: collider wireframes (?colliders=1) and scene dressing. */
import * as THREE from 'three';
import type { Built, ColliderDesc } from './colliders';

export function wantColliders(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('colliders') === '1';
}

/** wireframe visualisation of collider descriptions (local space of `parent`) */
export function colliderDebug(descs: readonly ColliderDesc[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'collider_debug';
  const mat = new THREE.LineBasicMaterial({ color: 0x00ffaa, depthTest: false, transparent: true, opacity: 0.8 });
  for (const d of descs) {
    if (d.kind === 'box') {
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(d.half[0] * 2, d.half[1] * 2, d.half[2] * 2));
      const l = new THREE.LineSegments(geo, mat);
      l.position.set(d.center[0], d.center[1], d.center[2]);
      l.rotation.y = d.yaw ?? 0;
      l.renderOrder = 10;
      g.add(l);
    } else if (d.kind === 'cyl') {
      const geo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(d.r, d.r, d.y1 - d.y0, 16));
      const l = new THREE.LineSegments(geo, mat);
      l.position.set(d.x, (d.y0 + d.y1) / 2, d.z);
      l.renderOrder = 10;
      g.add(l);
    } else {
      const geo = new THREE.WireframeGeometry(d.mesh.geometry);
      const l = new THREE.LineSegments(geo, mat);
      l.applyMatrix4(d.mesh.matrix);
      l.renderOrder = 10;
      g.add(l);
    }
  }
  return g;
}

/** add collider debug lines to a built object when ?colliders=1 */
export function withDebug<T extends Built>(b: T): T {
  if (wantColliders()) b.object.add(colliderDebug(b.colliders));
  return b;
}
