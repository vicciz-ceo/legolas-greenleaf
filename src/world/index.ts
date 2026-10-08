/**
 * World builders: one import point for chapter authors.
 *
 *   import { buildTerrain, forest, river, woodenHouse, addColliders, ... } from '../../world';
 *
 * Terrain / crowds       buildTerrain(opts), createCrowd(def, heightAt)   (the LevelAPI wraps both: level.terrain / level.crowd)
 * Textures / materials   getTextureSet(name), makeMaterial(name, overrides), mat(name, opts), TILE_METERS
 * Vegetation             tree(kind, seed), forest(area, count, kinds, heightAt, opts), grassField(area, density, heightAt, opts),
 *                        ferns(...), mushrooms(...), webSheet(corners), cocoon(opts)
 * Water                  river(path, width, style), lake(opts), carveRiver(height, path, width), setWaterTime(t)
 * Props                  rock, boulderField, barrel, crate, torch, brazier, banner, well, ladder, chain, skeleton, weaponRack,
 *                        iceSheet, bat, batFlock, fallenLog, lantern, boat
 * Architecture           woodenHouse, bardsHouse, pier, stoneWall, stairs, tower, gate, helmsDeep, pillar, dwarvenHall,
 *                        chamberOfMazarbul, lightShaft, ruinedWatchtower, brokenBridge, frozenWaterfall, blackGate, statue,
 *                        seatOfSeeing, amonHenSummit, ruins, minasTirith, bridge
 * Colliders              every builder returns { object, colliders }; addColliders(physics, built.colliders, built.object)
 * Paths                  new Path(points, opts)  arc-length path with at / tangent / nearest
 */
export * from './terrain';
export * from './crowd';
export * from './textures';
export { mat, plain, setWetness } from './mats';
export * from './vegetation';
export * from './water';
export * from './props';
export * from './architecture';
export { Path } from './path';
export type { PathOpts, NearestResult } from './path';
export { setWindTime, windUniforms } from './shader';
export { setWorldQuality, worldQuality } from './quality';
export { setFlameTime, flame } from './fire';
export type { Area, HeightFn, PathPoint } from './util';
