/**
 * Builds Lake-town by night: the lake and its bed, the plank platforms and walkways, the stilt
 * houses, Bard's house, the roof highway, the props, the lamps and fires, and the far town.
 * Geometry and colliders only: no gameplay.
 */
import * as THREE from 'three';
import type { LevelAPI, FxHandle } from '../../../core/types';
import {
  addColliders, barrel, boat, brazier, crate, forest, lake, lantern, pier, torch, woodenHouse, bardsHouse,
  type Built, type ColliderDesc, type WaterBody,
} from '../../../world';
import { smoothstep } from '../../../core/math';
import { MeshKit } from '../../../world/util';
import { mat } from '../../../world';
import { Rng, fbm2 } from '../../../core/rng';
import { bakeStatic, warmGlass, farTown, lampPost, lanternString, lightPools, mistLayers, netSheet, platform, railing, waterGlints, type Glint } from './build';
import { lightDirectionOf } from '../../../core/environment';
import {
  BARD, CHASE_COVER, CHASE_ROOFS, D, JETTY, L, PLATFORMS, STAGE, WALKS, WALK_W, WATER_Y, computeRails, houseRect, onDeck, planHouses, walkByName,
  type HouseDef, type RoofDef, type Rect,
} from './layout';
import { QuayDeck } from './quay';

export interface TownWorld {
  ground: (x: number, z: number) => number;
  water: WaterBody;
  houses: HouseDef[];
  /** deck footprints of every house (swimmers cannot pass under them) */
  houseRects: Rect[];
  quay: QuayDeck;
  bardAnchors: { door: THREE.Vector3; table: THREE.Vector3 };
  /** brazier / torch flame positions (fx.fire handles are kept so scripts can dim them) */
  fires: FxHandle[];
  /** called every game step */
  update(dt: number): void;
}

/** the lake bed and its shores: a shallow bowl, land beyond an ellipse around the town */
export function bedHeight(x: number, z: number): number {
  const ex = x / 235;
  const ez = (z - 18) / 166;
  const e = Math.sqrt(ex * ex + ez * ez);
  const noise = fbm2(x * 0.02, z * 0.02, 3, 11) - 0.5;
  const bowl = -5.2 + noise * 1.2 + smoothstep(0.55, 0.94, e) * 3.4;
  const shore = smoothstep(0.94, 1.0, e);
  const land = 1.7 + Math.max(0, e - 1.0) * 6 + noise * 7 * smoothstep(1.1, 1.6, e) + Math.max(0, e - 1.5) * 70;
  return THREE.MathUtils.lerp(bowl, Math.max(bowl, land), shore);
}

export function buildTown(level: LevelAPI): TownWorld {
  const { physics, fx } = level.ctx;
  const root = level.root;
  const rng = new Rng(0x7a4e);
  const quality = level.ctx.engine.quality;
  const high = quality === 'high' || quality === 'ultra';

  // ── ground and water ───────────────────────────────────────────────────────
  const terrain = level.terrain({ size: 640, segments: high ? 144 : 112, height: bedHeight, style: 'mud', material: 'dirt', center: [0, 18], theme: 'wet', tint: 0x3a4048, patchiness: 0.5, cavity: 0.3 });
  const ground = terrain.heightAt;
  physics.killY = WATER_Y - 1.1;

  const water = lake({ center: [0, 18], halfSize: [300, 230], y: WATER_Y, color: 0x070e16, shallow: 0x142228, depth: 7, speed: 0.04, wave: 0.06, ripple: 1.5, foam: 0.5, terrain: ground, opacity: 0.97 });
  root.add(water.object);

  const bake: THREE.Object3D[] = [];
  const pools: { x: number; z: number; r: number; a?: number }[] = [];
  /** wooden-walkway colliders without the (invisible to gameplay) piles */
  const noPiles = (cs: ColliderDesc[]) => cs.filter((c) => !(c.kind === 'cyl' && c.opts?.tag === 'pile'));
  const placeBuilt = (b: Built, x: number, y: number, z: number, yaw = 0, colliders = true): Built => {
    b.object.position.set(x, y, z);
    b.object.rotation.y = yaw;
    b.object.updateMatrixWorld(true);
    if (colliders) addColliders(physics, noPiles(b.colliders), b.object);
    bake.push(b.object);
    return b;
  };

  // ── platforms ──────────────────────────────────────────────────────────────
  const noRails = { n: false, s: false, e: false, w: false } as const;
  const dock = platform(PLATFORMS.dock, { seed: 1, rails: noRails });
  const market = platform(PLATFORMS.market, { seed: 2, rails: noRails });
  const qd = PLATFORMS.quay;
  const quayBreak = (cx: number, cz: number) => {
    const dx = cx - L.duelCenter.x;
    const dz = cz - L.duelCenter.z;
    const r = Math.hypot(dx, dz);
    // an annulus around the duel centre; the corridors to the walks and the house apron stay solid
    const lane = Math.abs(cx) < 2.6 && cz < 31.5;
    const links = Math.abs(cz - 37.5) < 1.9 && Math.abs(cx) > 9;
    const apron = cz > 44.3;
    return r > 3.2 && r < 9.8 && !lane && !links && !apron;
  };
  const quay = platform(qd, { seed: 3, rails: noRails, panels: { nx: 10, nz: 8, breakable: quayBreak } });
  for (const pf of [dock, market]) {
    addColliders(physics, noPiles(pf.colliders));
    bake.push(pf.object);
  }
  const quayHandles = addColliders(physics, noPiles(quay.colliders));
  bake.push(quay.object);
  const quayDeck = new QuayDeck(level, quay.breakables);
  quayDeck.bind(quay.breakables.map((b) => quayHandles[quay.panels.indexOf(b)] ?? null));
  root.add(quayDeck.mesh);

  // ── walkways ───────────────────────────────────────────────────────────────
  for (const w of WALKS) {
    const p = pier([[w.a[0], w.a[1]], [w.b[0], w.b[1]]], w.width ?? WALK_W, { y: D, lamps: 0, lit: true, seed: w.name.length * 7 + w.a[0], rails: false });
    addColliders(physics, noPiles(p.colliders));
    bake.push(p.object);
    // lamp posts on the walkway edge, alternating sides
    if (w.lamps) {
      const alongZ = Math.abs(w.a[0] - w.b[0]) < 1e-6;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const dir = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      let k = 0;
      for (let s = w.lamps / 2; s < len; s += w.lamps, k++) {
        const side = k % 2 ? 1 : -1;
        const x = w.a[0] + dir[0] * s + (alongZ ? side * ((w.width ?? WALK_W) / 2 - 0.18) : 0);
        const z = w.a[1] + dir[1] * s + (alongZ ? 0 : side * ((w.width ?? WALK_W) / 2 - 0.18));
        bake.push(lampPost(x, z, side, alongZ));
        pools.push({ x, z, r: 3.0, a: 0.9 });
      }
    }
  }
  const jetty = pier([[JETTY.a[0], JETTY.a[1]], [JETTY.b[0], JETTY.b[1]]], JETTY.width, { y: D, lamps: 0, lit: true, seed: 99, rails: false });
  addColliders(physics, noPiles(jetty.colliders));
  bake.push(jetty.object);
  // the shore end of the jetty: a lamp post on each side and two torches (their fire lights the outro: Bolg and his horse)
  for (const [k, sd] of [[0, -1], [1, 1]] as const) {
    const z = JETTY.b[1] - 3 - k * 6.5;
    bake.push(lampPost(JETTY.a[0] + sd * (JETTY.width / 2 - 0.18), z, sd, true));
    pools.push({ x: JETTY.a[0] + sd * (JETTY.width / 2 - 0.18), z, r: 3.0, a: 0.9 });
  }
  const jettyTorches: THREE.Vector3[] = [];
  for (const sd of [-1, 1]) {
    const x = JETTY.a[0] + sd * (JETTY.width / 2 - 0.25);
    const z = JETTY.b[1] - 0.9;
    const t = torch({ lit: true, length: 1.7 });
    placeBuilt(t, x, D, z, 0);
    jettyTorches.push(new THREE.Vector3(x, D + 1.75, z));
    pools.push({ x, z: z - 1.2, r: 3.6, a: 1 });
  }
  // the stage the chase starts from, joined to the west link
  const stage = platform(STAGE, { seed: 4, rails: noRails });
  addColliders(physics, noPiles(stage.colliders));
  bake.push(stage.object);

  // ── houses ─────────────────────────────────────────────────────────────────
  const houses = planHouses();
  const crateAt = (h: HouseDef) => {
    // a stack of two crates on the walkway edge in front of the house: the way up to its roof
    // (a double jump from the top reaches the eave) and a bit of cover in the fights
    const walk = walkByName(h.run);
    const alongZ = Math.abs(walk.a[0] - walk.b[0]) < 1e-6;
    const half = (walk.width ?? WALK_W) / 2;
    const side = alongZ ? Math.sign(h.x - walk.a[0]) : Math.sign(h.z - walk.a[1]);
    const x = alongZ ? walk.a[0] + side * (half - 0.62) : h.x;
    const z = alongZ ? h.z : walk.a[1] + side * (half - 0.62);
    placeBuilt(crate(1.05, { seed: h.seed }), x, D, z, h.yaw + 0.15);
    placeBuilt(crate([0.85, 0.8, 0.85], { seed: h.seed + 1 }), x, D + 1.05, z, h.yaw - 0.1);
  };
  const houseDoors: THREE.Vector3[] = [];
  const chimneys: THREE.Vector3[] = [];
  for (const h of houses) {
    const hb = woodenHouse({ w: h.w, d: h.d, floors: h.floors, lit: h.lit, seed: h.seed, doorOpen: rng.chance(0.3) });
    placeBuilt(hb, h.x, D, h.z, h.yaw);
    houseDoors.push(hb.object.localToWorld(new THREE.Vector3(...hb.anchors.door)));
    if (h.lit) chimneys.push(hb.object.localToWorld(new THREE.Vector3(h.w / 2 - 1.1, hb.anchors.ridge[1] + 1.1, -h.d * 0.12)));
    if (h.steps) crateAt(h);
  }
  // smoke from the chimneys of the houses along the main walk and the market
  chimneys.sort((a, b) => Math.hypot(a.x, a.z + 24) - Math.hypot(b.x, b.z + 24));
  for (const c of chimneys.slice(0, high ? 9 : 5)) fx.smoke(c, 0.55);
  const roofHouses: { def: RoofDef; built: Built }[] = [];
  for (const def of [...CHASE_ROOFS, ...CHASE_COVER]) {
    const hb = woodenHouse({ w: def.w, d: def.d, floors: def.floors, pitch: def.pitch, lit: def.seed % 3 !== 0, seed: def.seed });
    placeBuilt(hb, def.x, D, def.z, def.ridge === 'z' ? -Math.PI / 2 : 0);
    roofHouses.push({ def, built: hb });
  }

  // ── rope railings along the open deck edges, open at junctions and house porches ──
  const porchCuts: Rect[] = houseDoors.map((d) => ({ x0: d.x - 1.4, x1: d.x + 1.4, z0: d.z - 1.4, z1: d.z + 1.4 }));
  const rails = computeRails(porchCuts);
  bake.push(railing(rails));
  for (const r of rails) {
    const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
    if (len < 0.3) continue;
    const yaw = Math.atan2(-(r.bz - r.az), r.bx - r.ax);
    physics.addBox(new THREE.Vector3((r.ax + r.bx) / 2, D + 0.52, (r.az + r.bz) / 2), [len / 2, 0.52, 0.06], yaw, { walkable: false, blocksArrows: false, blocksCamera: false, material: 'wood', tag: 'rail' });
  }

  // ── Bard's house ───────────────────────────────────────────────────────────
  const bh = bardsHouse({ lit: true, seed: 3 });
  placeBuilt(bh, BARD.x, D, BARD.z, BARD.yaw);
  bh.object.updateMatrixWorld(true);
  const bardAnchors = {
    door: bh.object.localToWorld(new THREE.Vector3(...bh.anchors.door)),
    table: bh.object.localToWorld(new THREE.Vector3(...bh.anchors.table)),
  };

  // ── props: cargo, barrels, boats, nets ─────────────────────────────────────
  const cargo = (x: number, z: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const px = x + (rng.float() - 0.5) * spread;
      const pz = z + (rng.float() - 0.5) * spread;
      if (!onDeck(px, pz)) continue;
      if (rng.chance(0.5)) placeBuilt(barrel({ seed: Math.floor(rng.float() * 99), height: 0.95 }), px, D - 0.02, pz, rng.float() * 6);
      else placeBuilt(crate([0.7 + rng.float() * 0.5, 0.6 + rng.float() * 0.4, 0.7 + rng.float() * 0.4], { seed: Math.floor(rng.float() * 99) }), px, D - 0.02, pz, rng.float() * 6);
    }
  };
  // market stalls of crates and barrels around the square, clear lanes through the middle
  for (const [x, z] of [[-12.2, -9], [-12.2, 8.5], [12.2, -9], [12.2, 8.6], [-9, 11.2], [9, 11.2], [-9, -11.2], [9, -11.2]]) cargo(x, z, 4, 2.4);
  // heaped at the dock and along the quay rim
  cargo(-6.8, -73.4, 5, 2.4);
  cargo(6.8, -73.4, 5, 2.4);
  cargo(-12.2, 29.6, 3, 1.4);
  cargo(12.2, 29.6, 3, 1.4);
  cargo(-12.4, 45.4, 3, 1.4);
  cargo(12.4, 45.4, 3, 1.4);
  // a long gangway of stacked crates beside walkway A (cover for the fights)
  [-56, -47, -29, -23].forEach((z, i) => cargo(i % 2 ? 1.2 : -1.2, z, 1, 0.4));

  // boats tied up between the houses and along the open water
  const boats: [number, number, number][] = [[-12, -26, 0.3], [11.5, -52, -1.2], [-8.5, 20.5, 1.8], [9.5, 19, -0.4], [-18, -14, 0.1], [16, -22, 1.4], [-13, -57, 2.2], [14, 8, 0.9], [-21, 28, -0.7], [20, 30, 0.2]];
  for (const [x, z, yaw] of boats) {
    if (onDeck(x, z)) continue;
    const b = boat({ length: 3.8 + rng.float() * 1.8, seed: Math.floor(x + z) });
    placeBuilt(b, x, WATER_Y + 0.18, z, yaw, false);
  }

  // braziers: the market corners and the quay, a pair at the dock
  const fires: FxHandle[] = [];
  const brazierSpots: [number, number][] = [[-13.2, -11.6], [13.2, -11.6], [-13.2, 11.6], [13.2, 11.6], [-12.4, 29.4], [12.4, 29.4], [-5.6, -66.5], [5.6, -66.5], [-12.6, 45.6], [12.6, 45.6]];
  for (const [x, z] of brazierSpots) {
    const b = brazier({ lit: true, scale: 1.05 });
    placeBuilt(b, x, D, z, rng.float() * 3);
    b.object.updateMatrixWorld(true);
    fires.push(fx.fire(new THREE.Vector3(x, D + 1.0, z), 0.8));
    pools.push({ x, z, r: 5.2, a: 1 });
  }
  for (const p of jettyTorches) fires.push(fx.fire(p, 0.5));
  // torches where the main walk meets the quay: they light Bolg's entrance and the start of the duel
  for (const sx of [-1, 1]) {
    const t = torch({ lit: true, length: 1.7 });
    placeBuilt(t, sx * 3.1, D, 28.3, 0);
    fires.push(fx.fire(new THREE.Vector3(sx * 3.1, D + 1.75, 28.3), 0.45));
    pools.push({ x: sx * 3.1, z: 27.3, r: 3.8, a: 1 });
  }
  // torches at Bard's door
  for (const sx of [-1, 1]) {
    const t = torch({ lit: true, length: 1.7 });
    placeBuilt(t, sx * 4.9, D, 47.4, 0);
    fires.push(fx.fire(new THREE.Vector3(sx * 4.9, D + 1.75, 47.4), 0.4));
    pools.push({ x: sx * 4.9, z: 46.2, r: 3.6, a: 0.9 });
  }
  // a sickbed by the hearth for Kili: a low wooden frame, a wool blanket and a bolster
  {
    const kit = new MeshKit();
    const wood = mat('old_wood', { key: 'ltBeam', rgb: [0.78, 0.75, 0.7] });
    const wool = mat('cloth_wool', { key: 'sickbed', rgb: [0.62, 0.34, 0.26] });
    const linen = mat('cloth_linen', { key: 'sickbed', rgb: [0.85, 0.8, 0.7] });
    const bx = L.kili.x;
    const bz = L.kili.z;
    kit.box(wood, [1.9, 0.16, 0.95], [bx, D + 0.08, bz], 0, { tile: 0.8 });
    kit.box(wool, [1.78, 0.14, 0.86], [bx, D + 0.23, bz], 0, { tile: 0.5 });
    kit.box(linen, [0.5, 0.16, 0.7], [bx + 0.62, D + 0.38, bz], 0, { tile: 0.4 });
    const g = kit.build({ name: 'sickbed' });
    g.updateMatrixWorld(true);
    physics.addBox(new THREE.Vector3(bx, D + 0.15, bz), [0.95, 0.15, 0.48], 0, { material: 'wood', tag: 'bed' });
    bake.push(g);
  }
  // the hearth in Bard's front room, and the glow that spills out of the open front
  fires.push(fx.fire(new THREE.Vector3(3.0, D + 0.5, 54.2), 0.5));
  pools.push({ x: 0, z: 49.6, r: 5.5, a: 0.8 }, { x: 0.4, z: 52.6, r: 4, a: 0.7 }, { x: L.kili.x, z: L.kili.z, r: 2.8, a: 1.0 });

  // lantern posts at the platform corners (the platform builder hands back their positions)
  for (const pf of [dock, market, quay, stage]) {
    for (const p of pf.lanterns) {
      const l = lantern({ lit: true });
      placeBuilt(l, p.x, p.y, p.z, 0, false);
    }
  }

  // strings of lanterns across the main walk and over the market
  const strings: [THREE.Vector3, THREE.Vector3, number][] = [];
  for (let z = -58; z <= -20; z += 9.5) strings.push([new THREE.Vector3(-6.0, D + 4.1, z), new THREE.Vector3(6.0, D + 4.1, z + 1.5), 5]);
  strings.push([new THREE.Vector3(-14.5, D + 4.4, -12.5), new THREE.Vector3(14.5, D + 4.4, 12.5), 8]);
  strings.push([new THREE.Vector3(14.5, D + 4.4, -12.5), new THREE.Vector3(-14.5, D + 4.4, 12.5), 8]);
  strings.push([new THREE.Vector3(-13.5, D + 4.2, 29), new THREE.Vector3(13.5, D + 4.2, 45.5), 8]);
  strings.push([new THREE.Vector3(13.5, D + 4.2, 29), new THREE.Vector3(-13.5, D + 4.2, 45.5), 8]);
  let si = 0;
  for (const [a, b, n] of strings) {
    const g = lanternString(a, b, n, 0.9, 5 + si++);
    bake.push(g);
  }

  // light pools under the strings of lanterns
  for (const [a, b] of strings) pools.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: 4.4, a: 0.55 });
  root.add(lightPools(pools));

  // nets on poles at the market's edge and the dock
  const netObjs: THREE.Object3D[] = [];
  for (const [ax, az, bx, bz] of [[-14.6, -4, -14.6, 4], [14.6, -5, 14.6, 3], [-8, -74.4, 0, -74.4], [3, -74.4, 8.4, -74.4]] as const) {
    const n = netSheet(new THREE.Vector3(ax, D + 2.5, az), new THREE.Vector3(bx, D + 2.5, bz), 1.7, 0.3);
    netObjs.push(n);
    root.add(n);
  }

  // ── reflections on the lake: warm streaks behind the lit houses and under the jetty torches, a cold glitter toward the moon
  const glints: Glint[] = [];
  for (const h of houses) {
    if (!h.lit) continue;
    const fxd = Math.sin(h.yaw);
    const fzd = Math.cos(h.yaw);
    // the back of the house (away from its walkway) is open water
    const off = h.d / 2 + 1.6;
    glints.push({ x: h.x - fxd * off, z: h.z - fzd * off + 0.5, w: 1.5 + rng.float() * 1.2, l: 4.5 + rng.float() * 2.5, yaw: Math.PI, a: 0.55, color: 0xff9a50 });
  }
  for (const p of jettyTorches) glints.push({ x: p.x, z: p.z - 0.5, w: 1.1, l: 4.5, yaw: Math.PI, a: 0.7, color: 0xff9448 });
  const moon = lightDirectionOf(level.ctx.engine.env as Parameters<typeof lightDirectionOf>[0], new THREE.Vector3());
  const moonYaw = Math.atan2(moon.x, moon.z);
  glints.push({ x: -2, z: -12, w: 16, l: 110, yaw: moonYaw, a: 0.5, color: 0x9fbaf0 }, { x: -2 + moon.x * 100, z: -12 + moon.z * 100, w: 34, l: 140, yaw: moonYaw, a: 0.38, color: 0x8fb0ec });
  root.add(waterGlints(glints));

  // ── bake everything static into a few merged meshes ───────────────────────
  const glass = warmGlass();
  const baked = bakeStatic(bake, {
    name: 'lt',
    cell: 60,
    // lantern glass: the builders' transparent pale-amber cylinders become one warm emissive material
    replace: (m) => {
      const s = m as THREE.MeshStandardMaterial;
      return s.transparent && s.emissive && s.emissive.getHex() === 0xffa94a ? glass : null;
    },
  });
  root.add(baked.group);
  for (const k of baked.left) root.add(k);

  // ── the far town, the shore and its trees ─────────────────────────────────
  root.add(farTown((x, z) => Math.abs(x) < 58 && z > -92 && z < 150, 5, high ? 90 : 60));
  const shoreWoods = forest(
    { center: new THREE.Vector3(0, 0, 215), halfSize: [230, 70] },
    high ? 150 : 90,
    [{ kind: 'pine', weight: 3 }, { kind: 'dead', weight: 1 }],
    ground,
    { seed: 7, scale: [0.9, 1.5], exclude: (x, z) => ground(x, z) < 0.4 || (Math.abs(x - JETTY.a[0]) < 12 && z < 215), lodNear: 50, lodFar: 190, variants: 2 },
  );
  root.add(shoreWoods.object);
  addColliders(physics, shoreWoods.colliders);

  const mist = mistLayers(new THREE.Vector3(0, 0, 40), 380, high ? 3 : 2);
  root.add(mist.group);

  // ── per-step: bobbing, lantern flicker ────────────────────────────────────
  let t = 0;
  const update = (dt: number) => {
    t += dt;
    quayDeck.update(dt);
    mist.update(dt, level.ctx.engine.camera.position.y);
    for (const n of netObjs) n.position.y = Math.sin(t * 0.7 + n.id) * 0.015;
  };
  const houseRects: Rect[] = [...houses.map((h) => houseRect(h)), houseRect({ x: BARD.x, z: BARD.z, yaw: BARD.yaw, w: 9, d: 6.6 })];
  return { ground, water, houses, houseRects, quay: quayDeck, bardAnchors, fires, update };
}
