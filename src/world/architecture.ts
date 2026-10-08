/**
 * Architecture builders (owner: world). Everything returns `{ object, colliders }` (+ extras such as
 * anchors). See colliders.ts for the collider conventions and addColliders().
 *
 *   Lake-town   woodenHouse, bardsHouse, pier
 *   Fortress    stoneWall, stairs, tower, gate, helmsDeep (Deeping Wall + Hornburg + causeway)
 *   Moria       pillar, dwarvenHall, chamberOfMazarbul, lightShaft
 *   Ravenhill   ruinedWatchtower, brokenBridge, frozenWaterfall
 *   Mordor      blackGate
 *   Amon Hen    statue, seatOfSeeing, amonHenSummit, ruins
 *   Gondor      minasTirith
 *   Generic     bridge
 */
export { woodenHouse, bardsHouse, pier } from './arch_laketown';
export type { HouseOpts, HouseResult, PierOpts } from './arch_laketown';
export { stoneWall, stairs, tower, gate, helmsDeep } from './arch_helms';
export type { WallOpts, WallResult, WallAnchor, StairsOpts, TowerOpts, GateOpts, GateResult, HelmsDeepOpts, HelmsDeepResult, StoneKind } from './arch_helms';
export { pillar, dwarvenHall, chamberOfMazarbul, lightShaft } from './arch_moria';
export type { PillarKind, HallOpts, ChamberResult } from './arch_moria';
export { ruinedWatchtower, brokenBridge, frozenWaterfall } from './arch_ravenhill';
export type { TowerRuinOpts, TowerRuinResult, BridgeResult } from './arch_ravenhill';
export { blackGate } from './arch_blackgate';
export type { BlackGateResult } from './arch_blackgate';
export { statue, seatOfSeeing, amonHenSummit, ruins } from './arch_amonhen';
export type { StatuePose, SeatResult, RuinsOpts } from './arch_amonhen';
export { minasTirith } from './arch_minas';
export { bridge } from './arch_bridge';
export type { BridgeOpts } from './arch_bridge';
export { addColliders, removeColliders } from './colliders';
export type { ColliderDesc, Built } from './colliders';
