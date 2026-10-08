/**
 * Kit — rig builder.
 *
 * Declare bones with their rest-pose joint positions in MODEL space (metres, feet at y=0, facing
 * +Z, the creature's left at +X). Rest rotations are identity, so an animation rotation on a bone
 * is expressed in model axes at rest (rotate a thigh about X to swing it forward, etc.).
 *
 * ```ts
 * const rig = new RigDef()
 *   .bone('root', null, [0, 0, 0])
 *   .bone('body', 'root', [0, 0.8, 0])
 *   .bone('tail1', 'body', [0, 0.8, -0.5]);
 * const inst = rig.instantiate();  // fresh THREE.Bones + Skeleton (shares bone inverses)
 * ```
 */
import * as THREE from 'three';
import type { V3 } from './sdf';

export interface BoneDef {
  name: string;
  parent: string | null;
  head: V3;
  /** optional tail (for documentation / IK lengths); defaults to the first child's head */
  tail?: V3;
}

export interface RigInstance {
  root: THREE.Bone;
  bones: THREE.Bone[];
  byName: Record<string, THREE.Bone>;
  skeleton: THREE.Skeleton;
}

export class RigDef {
  readonly defs: BoneDef[] = [];
  private index = new Map<string, number>();
  private _inverses: THREE.Matrix4[] | null = null;

  bone(name: string, parent: string | null, head: V3, tail?: V3): this {
    if (this.index.has(name)) throw new Error(`[kit] duplicate bone ${name}`);
    if (parent !== null && !this.index.has(parent)) throw new Error(`[kit] bone ${name}: unknown parent ${parent}`);
    if (parent === null && this.defs.length > 0) throw new Error('[kit] only the first bone may be the root');
    this.index.set(name, this.defs.length);
    this.defs.push({ name, parent, head: [head[0], head[1], head[2]], tail });
    this._inverses = null;
    return this;
  }
  /** add a left bone (+X) and its mirrored right twin. Names must end in _l; parents ending in _l are mirrored too. */
  pair(nameL: string, parentL: string | null, head: V3, tail?: V3): this {
    this.bone(nameL, parentL, head, tail);
    const nameR = nameL.replace(/_l$/, '_r');
    const parentR = parentL && parentL.endsWith('_l') ? parentL.replace(/_l$/, '_r') : parentL;
    this.bone(nameR, parentR, [-head[0], head[1], head[2]], tail ? [-tail[0], tail[1], tail[2]] : undefined);
    return this;
  }

  has(name: string) {
    return this.index.has(name);
  }
  boneIndex(name: string): number {
    return this.index.get(name) ?? -1;
  }
  get boneNames(): string[] {
    return this.defs.map((d) => d.name);
  }
  get count() {
    return this.defs.length;
  }
  /** rest position of a bone's joint */
  pos(name: string): V3 {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[kit] unknown bone ${name}`);
    return this.defs[i].head;
  }
  /** rest joint position + offset (model axes) */
  at(name: string, dx = 0, dy = 0, dz = 0): V3 {
    const p = this.pos(name);
    return [p[0] + dx, p[1] + dy, p[2] + dz];
  }
  /** point along the segment between two joints (t=0 → a, t=1 → b) plus an offset */
  lerp(a: string, b: string, t: number, dx = 0, dy = 0, dz = 0): V3 {
    const pa = this.pos(a);
    const pb = this.pos(b);
    return [pa[0] + (pb[0] - pa[0]) * t + dx, pa[1] + (pb[1] - pa[1]) * t + dy, pa[2] + (pb[2] - pa[2]) * t + dz];
  }
  parentIndex(i: number): number {
    const p = this.defs[i].parent;
    return p === null ? -1 : this.index.get(p)!;
  }
  /** distance between two joints */
  length(a: string, b: string): number {
    const pa = this.pos(a);
    const pb = this.pos(b);
    return Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  }

  /** shared inverse bind matrices (rest model transforms inverted) */
  get inverses(): THREE.Matrix4[] {
    if (!this._inverses) this._inverses = this.defs.map((d) => new THREE.Matrix4().makeTranslation(-d.head[0], -d.head[1], -d.head[2]));
    return this._inverses;
  }

  /** create fresh bones in the rest pose */
  instantiate(): RigInstance {
    const bones: THREE.Bone[] = [];
    const byName: Record<string, THREE.Bone> = {};
    this.defs.forEach((d, i) => {
      const b = new THREE.Bone();
      b.name = d.name;
      const pi = this.parentIndex(i);
      if (pi >= 0) {
        const ph = this.defs[pi].head;
        b.position.set(d.head[0] - ph[0], d.head[1] - ph[1], d.head[2] - ph[2]);
        bones[pi].add(b);
      } else b.position.set(d.head[0], d.head[1], d.head[2]);
      bones.push(b);
      byName[d.name] = b;
    });
    const skeleton = new THREE.Skeleton(bones, this.inverses.map((m) => m.clone()));
    return { root: bones[0], bones, byName, skeleton };
  }
}

/**
 * Bind a geometry (with skinIndex/skinWeight) to a rig instance. The mesh and the root bone must
 * share the same parent (the creature's root group) so the bind matrix is identity.
 */
export function makeSkinnedMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], rig: RigInstance, boundsRadius = 2, boundsCenter?: V3): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  // generous static bounds so frustum culling never needs a per-vertex skinned recompute
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(...(boundsCenter ?? [0, boundsRadius * 0.5, 0])), boundsRadius);
  mesh.boundingBox = new THREE.Box3().setFromCenterAndSize(mesh.boundingSphere.center, new THREE.Vector3(1, 1, 1).multiplyScalar(boundsRadius * 2));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
