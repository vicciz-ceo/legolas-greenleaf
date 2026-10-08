/**
 * Creature construction kit — public API. See README.md in this folder for a guide and
 * copy-paste examples (giant spider, quadruped, bat, troll).
 */
export { RigDef, makeSkinnedMesh, type BoneDef, type RigInstance } from './rig';
export { Sculpt, SdfProgram, makeEvaluator, cellular3, type PrimOpts, type NoiseDef, type SdfOp, type V3 } from './sdf';
export { meshSdf, type MeshOpts, type MeshData, type MeshRegion } from './mesher';
export { meshSculpt, sculptGeometry, cached, kitCacheStats, clearKitCache } from './cache';
export { meshDataToGeometry, paintGeometry, mergeKitGeometries, triCount, type PaintOpts } from './geometry';
export { createCreatureMaterial, cloneCreatureMaterial, type CreatureMaterialOpts } from './material';
export { SURFACES, PATTERNS, surface, type SurfaceName, type SurfaceSpec, type PatternName } from './surfaces';
export { growStrands, hairGeometry, createHairMaterial, strandTexture, type Strand, type GrowRoot, type GrowOpts, type BraidDef, type EllipsoidCollider, type WeightFn } from './hair';
export { sheetGeometry, quadGrid, type SheetOpts } from './sheet';
export {
  PoseSolver, PoseBuffer, SpringChain, aimBone, frameRotation, solveTwoBone, lookAt, footCycle, gaitFrequency, bipedGait,
  makeBipedSample, quadGait, insectGait, wingFlap, boneMask, envelope,
  type FootSample, type BipedGaitSample, type QuadGaitSample, type QuadGaitKind, type WingSample, type TwoBoneOpts, type SpringCollider, type SpringOpts,
} from './anim';
export { buildCreature, type Creature, type CreatureDef, type CreatureExtraCtx } from './creature';
