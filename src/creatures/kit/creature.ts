/**
 * Kit — one-call creature assembly.
 *
 * ```ts
 * const c = buildCreature({
 *   key: 'warg',                    // cache key (+ seed) — geometry is shared between instances
 *   rig,                            // RigDef
 *   sculpt: (s) => { … },           // fill the Sculpt with primitives
 *   mesh: { res: 0.02, regions: [...] },
 *   material: { detailScale: 1.2 },
 *   extra: (ctx) => { ctx.add(sheetGeometry(...)); ctx.gear(new THREE.ConeGeometry(...), {...}) },
 *   hair: (ctx) => hairGeometry(...) // optional strand cards (skinned to the same rig)
 * });
 * scene.add(c.root);
 * c.pose.reset(); …; c.update(dt)   // PoseSolver → bones (+ springs)
 * ```
 */
import * as THREE from 'three';
import { Sculpt } from './sdf';
import type { MeshOpts } from './mesher';
import { meshSculpt, cached } from './cache';
import { meshDataToGeometry, mergeKitGeometries, paintGeometry, triCount } from './geometry';
import { createCreatureMaterial, cloneCreatureMaterial, type CreatureMaterialOpts } from './material';
import { createHairMaterial, type HairMaterialOpts } from './hair';
import { makeSkinnedMesh, type RigDef, type RigInstance } from './rig';
import { PoseSolver, SpringChain } from './anim';
import type { SurfaceName, SurfaceSpec } from './surfaces';

export interface CreatureExtraCtx {
  rig: RigDef;
  /** add any kit geometry (sheets, painted gear) to the body draw call */
  add(geo: THREE.BufferGeometry): void;
  /** add a plain geometry rigidly skinned to a bone, painted with a surface */
  gear(geo: THREE.BufferGeometry, o: { bone: string; color: number; mat?: SurfaceName | SurfaceSpec; matrix?: THREE.Matrix4; ao?: number }): void;
}

export interface CreatureDef {
  key: string;
  seed?: number;
  rig: RigDef;
  sculpt: (s: Sculpt) => void;
  mesh: MeshOpts;
  /** default skin-weight blend radius */
  skinK?: number;
  material?: CreatureMaterialOpts;
  extra?: (ctx: CreatureExtraCtx) => void;
  hair?: (rig: RigDef) => THREE.BufferGeometry | null;
  hairMaterial?: HairMaterialOpts & { color?: number };
  /** bounding sphere radius for culling (default from geometry) */
  bounds?: number;
}

export interface Creature {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  hair: THREE.SkinnedMesh | null;
  rig: RigInstance;
  /** pose solver: write local rotations/offsets, then call update() */
  pose: PoseSolver;
  springs: SpringChain[];
  material: THREE.MeshPhysicalMaterial;
  triangles: number;
  buildMs: number;
  /** springs + write the pose to the bones */
  update(dt: number): void;
  dispose(): void;
}

interface Shared {
  body: THREE.BufferGeometry;
  hair: THREE.BufferGeometry | null;
  mat: THREE.MeshPhysicalMaterial;
  hairMat: THREE.MeshPhysicalMaterial | null;
  radius: number;
  center: THREE.Vector3;
}

export function buildCreature(def: CreatureDef): Creature {
  const t0 = performance.now();
  const shared = cached<Shared>(`creature:${def.key}:${def.seed ?? 0}`, () => {
    const s = new Sculpt(def.rig, { skinK: def.skinK });
    def.sculpt(s);
    const data = meshSculpt(s, def.mesh);
    const parts: THREE.BufferGeometry[] = [meshDataToGeometry(data)];
    def.extra?.({
      rig: def.rig,
      add: (g) => parts.push(g),
      gear: (g, o) => {
        parts.push(paintGeometry(g, { color: o.color, mat: o.mat ?? 'leather', bone: def.rig.boneIndex(o.bone), matrix: o.matrix, ao: o.ao ?? 0.9 }));
        g.dispose();
      },
    });
    const body = parts.length > 1 ? mergeKitGeometries(parts) : parts[0];
    if (parts.length > 1) parts.forEach((p) => p.dispose());
    body.userData.shared = true;
    body.computeBoundingSphere();
    const hair = def.hair ? def.hair(def.rig) : null;
    if (hair) hair.userData.shared = true;
    const mat = createCreatureMaterial({ side: THREE.DoubleSide, ...def.material });
    const hairMat = hair ? createHairMaterial(def.hairMaterial) : null;
    const bs = body.boundingSphere!;
    return { body, hair, mat, hairMat, radius: def.bounds ?? bs.radius * 1.4, center: bs.center.clone() };
  });
  const rig = def.rig.instantiate();
  const root = new THREE.Group();
  root.name = `creature:${def.key}`;
  root.add(rig.root);
  const material = cloneCreatureMaterial(shared.mat);
  const body = makeSkinnedMesh(shared.body, material, rig, shared.radius, [shared.center.x, shared.center.y, shared.center.z]);
  body.name = 'body';
  root.add(body);
  let hair: THREE.SkinnedMesh | null = null;
  if (shared.hair && shared.hairMat) {
    hair = makeSkinnedMesh(shared.hair, shared.hairMat, rig, shared.radius, [shared.center.x, shared.center.y, shared.center.z]);
    hair.name = 'hair';
    root.add(hair);
  }
  const pose = new PoseSolver(def.rig);
  const springs: SpringChain[] = [];
  const c: Creature = {
    root,
    body,
    hair,
    rig,
    pose,
    springs,
    material,
    triangles: triCount(shared.body) + (shared.hair ? triCount(shared.hair) : 0),
    buildMs: performance.now() - t0,
    update(dt: number) {
      if (springs.length) {
        pose.fk();
        root.updateWorldMatrix(true, false);
        for (const sp of springs) sp.update(pose, dt, root.matrixWorld);
      }
      pose.apply(rig.bones);
    },
    dispose() {
      root.parent?.remove(root);
      material.dispose();
      rig.skeleton.dispose();
    },
  };
  return c;
}
