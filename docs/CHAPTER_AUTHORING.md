# Chapter authoring handbook

The practical guide for the nine chapter authors. Read it with three files open:
`src/core/types.ts` (the contract), `src/game/chapters/c0_arena.ts` (the reference chapter, heavily
commented) and `docs/CHAPTERS.md` (what your chapter must contain). Every signature below was
checked against the code; when in doubt, the code wins, so tell the orchestrator.

Contents

1. [The shape of a chapter](#1-the-shape-of-a-chapter)
2. [LevelAPI cheat sheet](#2-levelapi-cheat-sheet)
3. [GameContext: what else you can touch](#3-gamecontext-what-else-you-can-touch)
4. [World builders: the full API](#4-world-builders-the-full-api)
5. [Custom creatures as Combatants](#5-custom-creatures-as-combatants)
6. [PlayerMover recipes](#6-playermover-recipes)
7. [Bosses](#7-bosses)
8. [Cinematics](#8-cinematics)
9. [Crowds, preload, weather, reverb, music](#9-crowds-preload-weather-reverb-music)
10. [Performance budgets](#10-performance-budgets)
11. [Testing](#11-testing)
12. [Common pitfalls](#12-common-pitfalls)

---

## 1. The shape of a chapter

One file `src/game/chapters/cN_<id>.ts` (N = 1..9) exporting `chapter: ChapterDef`. The registry
finds it automatically (`import.meta.glob('./c[0-9]_*.ts')`); never edit `chapters/index.ts`.
Helpers go in `src/game/chapters/<id>/`, new creatures in `src/creatures/<name>.ts` with a
`<name>.lab.ts` next to them.

```ts
import * as THREE from 'three';
import type { ChapterDef, ChapterInstance, LevelAPI } from '../../core/types';
import { addColliders, forest, grassField } from '../../world';

export const chapter: ChapterDef = {
  id: 'amon_hen',
  number: 6,
  title: 'Amon Hen',
  film: 'The Fellowship of the Ring',
  blurb: 'Uruk-hai in the woods below the Seat of Seeing.',
  environment: 'amon_hen',
  checkpoints: ['The Woods', 'The Ruins', 'Lurtz'],
  parTime: 360,
  rivalry: true,                          // the shell starts/stops Gimli's counter
  preload: ['uruk', 'lurtz', 'aragorn', 'gimli'], // meshed in workers behind the loading screen
  async create(level: LevelAPI): Promise<ChapterInstance> {
    const world = buildWorld(level);      // geometry + colliders only, no gameplay
    let beat = 'intro';
    async function run(from: number) { /* the screenplay, see c0_arena run() */ }
    return {
      start(cp) { /* place player + allies for checkpoint cp */ void run(cp); },
      update(dt) {},
      botHint: () => (beat === 'fight' ? { moveTo: world.hold } : null),
    };
  },
};
```

Lifecycle, exactly as the shell runs it (`src/game/game.ts` `loadChapter`):

1. Loading screen. The previous level is disposed. `preloadHumanoids(['legolas', ...preload])`
   starts meshing every listed kind (four variation buckets each) in the worker pool.
2. Environment preset applied (`environment`): sky, IBL, fog, lights, grade, weather, ambience
   loop, room reverb.
3. `create(level)` runs WHILE the workers mesh. Build the world here. It may be async.
4. The shell waits for the preload, starts the rivalry if `rivalry: true`, then calls
   `start(checkpoint)`. Spawn enemies/allies and kick off the script here.
5. Play. `update(dt)` and every `level.onUpdate` callback run each step in GAME time.
6. `level.complete()` -> slow-mo, results screen, rank, unlock. `level.fail(reason)` or death ->
   defeat screen. A respawn at a checkpoint is a **full rebuild**: dispose, `create()` again,
   `start(lastCheckpoint)`.

## 2. LevelAPI cheat sheet

`level` is the only object your chapter talks to (plus `level.ctx`, section 3). Everything it
creates is cleaned up when the level ends.

| Member | Use |
|---|---|
| `root: THREE.Group` | parent of all level geometry; auto-disposed |
| `ctx: GameContext` | engine, player, fx, audio, physics... (section 3) |
| `objective(text \| null)` | HUD objective line |
| `checkpoint(index)` | checkpoint `index` (into `ChapterDef.checkpoints`) reached: toast + autosave. Call it when the beat BEFORE it is done |
| `complete()` | chapter won |
| `fail(reason)` | chapter lost (defeat screen with `reason`) |
| `wait(seconds): Promise` | game-time wait (slow-mo / pause / hit-stop aware) |
| `waitUntil(pred, timeoutSec?): Promise` | resolves when `pred()` is true (checked every step) or after the timeout |
| `say(speaker, text, duration?): Promise` | subtitle (honours the subtitle setting); resolves after `duration` (default from the text length) |
| `spawnEnemy(spec, pos, facing?): Enemy` | spawn + register; `pos.y` below the ground is lifted onto it; facing defaults to toward the player |
| `spawnAlly(spec, pos, facing?): Ally` | same for allies (invulnerable by default) |
| `addCombatant(c)` / `removeCombatant(c)` | register a custom creature / weak point (section 5). `removeCombatant` also disposes it |
| `enemiesAlive(filter?): number` | living enemies (optionally filtered) |
| `wave(def): Promise` | spawn groups (optionally staggered) and resolve when `until` (default 0) of them remain, or after `timeout` |
| `boss(c \| null, name?)` | bind the boss bar to a combatant (kept in sync every step; hides 2.2 s after its death) |
| `cinematic(on)` | letterbox + player controls, HUD and touch controls off |
| `cameraShot(shot \| null)` | scripted camera (section 8) |
| `setEnvironment(env)` | switch preset mid-chapter (name or a tweaked copy); also switches weather, ambience loop and reverb |
| `onUpdate(fn): () => void` | per-step callback in game time; returns its remover |
| `crowd(def): CrowdHandle` | instanced background army (section 9) |
| `rng(): number` | deterministic 0..1 for this chapter (seeded by id and `?seed=`) |
| `terrain(opts)` | heightfield mesh + physics ground + fx ground in one call; returns `{ mesh, heightAt }` |
| `disposed: boolean` | true once the level is gone |
| `music?(mood \| null)` | pin a music mood (`'epic'`, `'tension'`...); `null` returns to the adaptive score |

`WaveDef`: `{ groups: { spec, count, at: Vector3 | Vector3[], spread? }[], stagger?, until?, timeout? }`.
Always give a `timeout` so a stuck enemy can never soft-lock the chapter.

`EnemySpec`: `{ archetype, hp?, damage?, speed?, weapon?, behavior?, name?, boss?, target?, scale?, seed?, countsForRivalry? }`.
Archetypes: `orc goblin gundabad uruk uruk_archer uruk_pike berserker orc_archer easterling haradrim troll`.
Behaviours: `charge hold archer guard flank climb`. `target` is `'player'` (default), `'nearest'`
or a `Vector3` to advance on (a gate, a culvert).

`Enemy` adds `spec`, `humanoid`, `behavior`, `aiEnabled`, `moveTarget` and, for boss scripting,
`attack?(kind, { windup?, target? })`, `playPose?(pose, seconds)`, `attacking?` (section 7).

`AllySpec`: `{ kind: 'gimli' | 'aragorn' | 'tauriel' | 'elf_archer' | 'rohirrim' | 'dwarf' | 'gondor' | 'man', name?, invulnerable?, anchor?: Vector3 | 'player', rivalry? }`.
`Ally` adds `anchor`, `aiEnabled`, `gesture('cheer' | 'roar' | 'point' | 'nod')`. Give Gimli `rivalry: true`.

All waits never resolve after the level is disposed, so a script that is still awaiting simply
stops. You never need to check `level.disposed` after an `await`.

## 3. GameContext: what else you can touch

`level.ctx` (`GameContext`). Allowed and useful:

| Member | Typical use |
|---|---|
| `player: PlayerAPI` | `teleport(pos, facing)`, `mover`, `controlsEnabled`, `weaponsEnabled`, `invulnerable`, `heal(n)`, `camera` (`shake(amount, sec)`, `shot`, `yaw`, `pitch`, `params`), `grounded`, `facing`, `tally` |
| `fx: Fx` | `blood dust sparks splash debris explosion(pos, scale)`, `fire(pos, scale)` / `smoke` / `torch(obj, offset)` (lights within the quality budget), `trail(obj, color)`, `setWeather(kind, intensity)`, `lightning()` |
| `audio: AudioSys` | `play(sfx, { pos, volume, pitch })`, `loop(name, volume)` (0 fades out), `setReverb?(amount, decay)` |
| `physics: PhysicsWorld` | `heightAt`, `addBox / addCylinder / addMesh` (or `addColliders`), `ground`, `raycast`, `killY` |
| `hud: Hud` | `setPrompt(action, text)`, `setProgress(label, frac)`, `toast(text, kind)`, `setRivalry` (the shell manages it) |
| `input: Input` | `state` (read-only edges: `interact`, `jump`...), `setInteractLabel(label)` for the touch button |
| `time: TimeControl` | `setScale(s, easeSec)` (slow-mo flourishes; always restore to 1), `hitStop(sec)`, `t` |
| `rivalry: Rivalry` | `addLegolas(n)`, `addGimli(n)`, `autoGimli` |
| `progression.data.rivalryTotals` | the saved running tally (the shell already starts the counter from it) |
| `flags` | URL flags; honour `flags.skipIntro === '1'` (skip your own intro and dialogue) |
| `engine` | `scene` (rarely), `post.letterbox` (prefer `cinematic()`), `shadowFocus` (the camera rig sets it) |

Off limits: `game.ts`, `level.ts` internals, `engine.levelRoot` (use `level.root`), creating your
own `THREE.PointLight`s for fire (use `fx.fire` / `fx.torch`: they respect the light budget).

## 4. World builders: the full API

One import point: `import { ... } from '../../world'` (`src/world/index.ts`). Lab subjects for all
of them: `/lab/?view=sheet&category=prop` and `category=environment`; under the real environment
presets: `/src/world/tools/view.html?subject=<name>&env=<env>`.

**The recipe.** Builders return a `Built` = `{ object: THREE.Object3D; colliders: ColliderDesc[] }`
(some add anchors).

```ts
// scatter builders work in WORLD coordinates with the object at the origin: don't move the object
const rocks = boulderField({ center: new THREE.Vector3(0, 0, 20), halfSize: [40, 30] }, 30, [0.4, 1.6], ground, { moss: 0.5 });
level.root.add(rocks.object);
addColliders(physics, rocks.colliders);

// single props are built at the origin: place the object FIRST, then add colliders WITH the object
const b = banner(0x2f5a34, 'none');
b.object.position.set(3, ground(3, -4), -4);
b.object.rotation.y = 0.3;
level.root.add(b.object);
addColliders(physics, b.colliders, b.object);
```

`Area` = `{ center: THREE.Vector3; halfSize: [number, number] }` (axis-aligned, y ignored).
`HeightFn` = `(x, z) => number` (use the `heightAt` returned by `level.terrain`).
`PathPoint` = `THREE.Vector3 | THREE.Vector2 | [x, z] | [x, y, z]`.
`ColliderDesc` = `{ kind: 'box', center, half, yaw?, opts? } | { kind: 'cyl', x, z, r, y0, y1, opts? } | { kind: 'mesh', mesh, opts? }`.

### Terrain, crowds, materials

```ts
buildTerrain(opts: TerrainOpts & TerrainExtras): { mesh; heightAt(x, z): number }   // prefer level.terrain(opts)
createCrowd(def: CrowdDef, heightAt): CrowdHandle                                    // prefer level.crowd(def)
getTextureSet(name: TextureSetName, opts?: TextureSetOpts): TextureSet              // { map, normalMap, roughnessMap, aoMap? }, cached
preloadTextureSets(names: readonly TextureSetName[], onProgress?: (frac, name) => void): Promise<void>
textureTimings(): Record<string, number>
makeMaterial(name: TextureSetName, overrides?: MakeMaterialOverrides): MeshStandardMaterial | MeshPhysicalMaterial
mat(name: TextureSetName, o?: MatOpts): MeshStandardMaterial | MeshPhysicalMaterial  // cached by o.key; rgb tint, vertexColors...
plain(color: number, o?: { roughness?, metalness?, emissive?, emissiveIntensity?, key? }): MeshStandardMaterial
setWetness(v: number): void                     // 0..1 wet look on registered materials (rain chapters)
TILE_METERS: Record<TextureSetName, number>    // metres per texture tile: uv = metres / TILE_METERS[name]
ALL_TEXTURE_SETS: readonly TextureSetName[]
```

`TerrainOpts`: `size, segments, height, style ('forest' | 'riverbank' | 'snow' | 'rock' | 'plains' | 'ash' | 'cave' | 'mud'), material?, center?, theme? ('mirkwood' | 'autumn' | 'wet' | 'dry'), tint?, layers?, patchiness?, skirt?, cavity?`.
Texture sets: `bark mossy_bark leaves grass forest_floor mud dirt rock cliff cobble stone_blocks dwarven_stone marble wood_planks old_wood thatch snow ice sand ash metal_dark metal_bright gold leather cloth_linen cloth_wool web water_normal chitin scales_rough hide skin_human skin_orc skin_troll`.

### Vegetation

```ts
tree(kind: TreeKind, seed?: number): TreeResult                  // { object, colliders, height, trunkRadius }; one tree, origin at the base
forest(area: Area, requested: number, kinds: KindSpec[], heightAt, opts?: ForestOpts): ForestResult  // { object, colliders, trees }
grassField(area: Area, density: number, heightAt, opts?: GrassOpts): THREE.Group   // density = clumps per m² (before quality scaling)
ferns(area: Area, count: number, heightAt, opts?: ScatterOpts): THREE.Object3D
mushrooms(area: Area, count: number, heightAt, opts?: MushroomOpts): THREE.Object3D // opts.glow for Mirkwood
webSheet(corners: [Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple], opts?: { sag?, tile? }): THREE.Mesh
cocoon(opts?: { length?, seed?, drop? }): THREE.Group             // a webbed dwarf
webCluster(center: Vec3Tuple, half: Vec3Tuple, sheets?: number, seed?: number): THREE.Mesh
TREE_KINDS = ['mirkwood_oak', 'beech', 'pine', 'dead', 'birch']
```

`KindSpec` = a `TreeKind` or `{ kind, weight? }`. `ForestOpts`: `seed, scale: [min, max],
spacing, variants (1..4), exclude(x, z), clearings: {x, z, r}[], chunk (m, default 48), lodNear
(default 70), lodFar (default 280), colliders (default true), noQualityScale, leafTint`.
`GrassOpts`: `seed, color, tipColor, dry, height: [min, max], fade: [start, end], exclude, mask(x, z)`.
`ScatterOpts`: `seed, scale, exclude, clump, tint`.

### Water

```ts
river(path: PathPoint[], width: number | ((s) => number), st?: WaterStyle & { y?: number | HeightFn; step? }): WaterBody
lake(o: LakeOpts): WaterBody
carveRiver(height: HeightFn, path: PathPoint[] | Path, width, o?: { depth?, bank?, level? }): HeightFn  // wrap your terrain height
setWaterTime(t: number | null): void      // freeze (deterministic shots); null resumes
updateWater(dt: number): void
```

`WaterStyle`: `speed, color, shallow, depth, foam, rapids, ripple, terrain (HeightFn: shorelines
foam and shallows fade), rocks: {x, z, r}[] (foam rings), opacity, wave`.
`WaterBody`: `{ object, update(dt), path?, flowAt(x, z, out): boolean, levelAt(x, z): number }`
(barrel rides: sample `flowAt` for drift and `levelAt` for bobbing).
Pattern (see `src/game/backdrop.ts`): one `Path`, `carveRiver(base, path, width)` as the terrain
height, the same path/width to `river(...)` with `terrain: heightAt`.

### Props

```ts
rock(size?: number, seed?: number, o?: RockOpts & { kind?: 'rock' | 'cliff' | 'ice' | 'dark' }): Built
boulderField(area, count, size: [min, max], heightAt, o?: BoulderOpts): Built    // world coords; colliders for size >= o.colliderMin (0.55)
barrel(o?: { height?, open?, seed?, lying? }): Built
crate(size?: number | [w, h, d], o?: { seed? }): Built
torch(o?: { lit?, wall?, length? }): Built & { flameAnchor }                       // lit: animated flame mesh, no light
brazier(o?: { lit?, scale? }): Built & { flameAnchor }
banner(color?: number, emblem?: Emblem, o?: { height?, clothW?, clothH? }): Built  // Emblem: none white_hand eye white_tree horse hammer wolf
lantern(o?: { lit? }): Built
well(o?: { radius?, roof?, water? }): Built
ladder(height?: number, o?: { width?, hooks?, rungGap? }): Built
chain(length?: number, o?: { link?, thick? }): Built
skeleton(pose?: 'lying' | 'sitting' | 'slumped' | 'sprawled', seed?, scale?): Built
weaponRack(o?: { width?, seed? }): Built
iceSheet(size?: number | [w, d], seed?, o?: { thickness? }): Built
bat(o?: { size?, radius?, seed? }): Built                 // cheap distant bat
batFlock(count, center: THREE.Vector3, radius?, o?: { size?, seed?, height? }): Built
fallenLog(length?, radius?, seed?, o?: { mossy? }): Built
boat(o?: { length?, seed? }): Built
catapult(o?: { broken?, seed? }): Built
siegeTower(o?: { height?, burnt?, seed? }): Built
batteringRam(o?: { seed? }): Built
stoneBlock(size?: [w, h, d], seed?, o?: { kind?: 'ice' | 'dark' | 'light' }): Built   // falling-stones climb
ringColliders(cx, cz, rIn, rOut, y0, y1, n?, opts?): ColliderDesc[]                  // a ring wall of boxes
addColliders(physics, descs, object?): ColliderHandle[]
removeColliders(physics, handles): void
colliderMesh(geo, name?): THREE.Mesh                                                  // an invisible mesh collider
```

### Architecture

Single-object builders are centred at their origin and their `anchors` are in the object's LOCAL
space: place the object, then `object.localToWorld(new THREE.Vector3(...anchor))`. Path-based
builders (`stoneWall`, `stairs`, `pier`, `bridge`) and `ruins` work in world coordinates.

```ts
woodenHouse(o?: HouseOpts): HouseResult                  // Lake-town stilt house; anchors { door, ridge, deckCorners, eaveY }
bardsHouse(o?: { lit?, seed? }): HouseResult & { anchors: { ...; stairBottom, stairTop, table } }
pier(path: PathPoint[], width?: number, o?: PierOpts): Built & { path: Path }
stoneWall(points: PathPoint[], height: number, thickness: number, o?: WallOpts): WallResult  // { path, anchors: WallAnchor[], topY }
stairs(from: V3, to: V3, width: number, o?: StairsOpts): Built & { steps: number }
tower(radius: number, height: number, o?: TowerOpts): Built
gate(o?: GateOpts): GateResult                           // { left, right, setOpen(t) }
helmsDeep(o?: HelmsDeepOpts): HelmsDeepResult            // anchors { walkway, ladders, fires, culvert, stairTop, ... }
pillar(kind?: PillarKind, height?, size?, o?: { seed?, broken? }): Built
dwarvenHall(o?: HallOpts): Built & { anchors: { pillars: V3[]; floor: { w, d } } }
chamberOfMazarbul(o?: { seed? }): ChamberResult          // anchors { tomb, well, window, westDoor, eastDoor, spawns, ... }
lightShaft(height?, topRadius?, bottomRadius?, color?, intensity?): THREE.Mesh   // a fake volumetric beam (cheap)
ruinedWatchtower(o?: TowerRuinOpts): TowerRuinResult     // anchors { door, floors, stairBottom, stairTop, top, ... }
brokenBridge(length?, width?, o?: { gap?, seed?, snow?, depth? }): BridgeResult // anchors { start, end, gapStart, gapEnd }
frozenWaterfall(width?, height?, o?: { seed? }): Built
blackGate(o?: { scale?, seed? }): BlackGateResult         // { left, right, setOpen(t), anchors { front, opening, leftTower, ... } }
statue(pose?: StatuePose, o?: { height?, seed?, mossy? }): Built
seatOfSeeing(o?: { seed? }): SeatResult                  // anchors { top, seat, stairsBottom, ring }
amonHenSummit(o?: { seed? }): SeatResult & { statues: THREE.Object3D[] }
ruins(area: Area, count: number, heightAt, o?: RuinsOpts): Built   // world coords; material mossy | blocks | dark | white | light, grandeur 0..1
minasTirith(o?: { scale?, tiers?, fires?, seed? }): Built
bridge(points: PathPoint[], width?, o?: BridgeOpts): Built & { path: Path }
```

### Paths, wind, fire, quality

```ts
new Path(points: readonly PathPoint[], opts?: PathOpts)   // PathOpts { smooth? (default true), closed?, step? (0.5 m), y? }
path.length; path.at(s, out?); path.tangent(s, out?); path.nearest(x, z) // -> { s, dist, signed (+ = right of travel), x, y, z }
setWindTime(t: number | null); windUniforms               // wind runs off the clock by itself; freeze only for deterministic shots
setFlameTime(t: number | null); flame(height?, width?, seed?): THREE.Mesh
setWorldQuality(q: Quality | null); worldQuality(): Quality // the shell sets it from the settings; builders read it
```

`path.nearest` is a linear scan over the samples: pass `step: 2` (or more) to a `Path` you query
for every terrain vertex.

## 5. Custom creatures as Combatants

Spiders, bats, the mûmak and weak points (girths, web anchors) are `Combatant`s. Extend
`BaseCombatant` (`src/actors/combatant.ts`): it gives you hit zones that follow bones, ray tests
with zone multipliers, hit flash, `onDeath`, the corpse timer and disposal. You write `update`.

```ts
import { BaseCombatant, ZONE_MULT } from '../../actors/combatant';
import { createSpider } from '../../creatures/kit/examples/spider';

export class Spider extends BaseCombatant {
  private readonly demo = createSpider(7, 1);   // kit example; copy it into src/creatures/spider.ts
  private t = 0;
  constructor(private level: LevelAPI, pos: THREE.Vector3) {
    super({ team: 'enemy', name: 'Spider', maxHp: 80, radius: 0.9, height: 1.2, bloodKind: 'ichor' });
    this.object.add(this.demo.object);
    this.object.position.copy(pos);
    const b = this.demo.creature.rig.byName;      // bones by name
    this.addZoneSphere(b.body, 0.42, 'body');
    this.addZoneSphere(b.abdomen, 0.55, 'body', 0.9, new THREE.Vector3(0, 0, -0.35));
    this.addZoneSphere(b.body, 0.16, 'weakpoint', 3, new THREE.Vector3(0, 0.05, 0.4)); // eye cluster x3
    for (const i of [0, 1, 2, 3]) for (const s of ['l', 'r'])
      this.addZoneCapsule(b[`leg${i}a_${s}`], b[`leg${i}b_${s}`], 0.07, 'limb', ZONE_MULT.limb);
    this.aimBone = b.body;                          // aim assist / Focus marks aim here
  }
  update(dt: number): void {
    this.t += dt;
    if (!this.alive) {
      this.demo.pose('death', Math.min(this.deathTime, 1.5));
      this.updateDeath(dt);                         // lie, sink, expire (the registry removes it)
      return;
    }
    // ... steer, attack (deal damage with target.takeDamage({ amount, type: 'melee', source: this, ... }))
    this.demo.pose(this.velocity.lengthSq() > 0.1 ? 'walk' : 'idle', this.t);
    this.afterAnimate();                            // REQUIRED after posing: zones refresh lazily
  }
}
// in start() or a beat:
const s = new Spider(level, new THREE.Vector3(0, 0, 20));
level.addCombatant(s);                              // registry + level.root, cleaned up for you
```

API you get from `BaseCombatant`:

- Zones: `addZoneSphere(obj, radius, zone, mult?, offset?)`,
  `addZoneCapsule(a, b, radius, zone, mult?, offA?, offB?)`,
  `addZoneDisc(obj, radius, normal, zone = 'armor', mult?, offset?)` (shield faces),
  `removeZonesOf(obj)`, `clearZones()`, `debugZones()`. `zone` is `'head' | 'body' | 'limb' | 'weakpoint' | 'armor'`;
  default multipliers `ZONE_MULT` = head 2.5, body 1, limb 0.75, armor 0.3, weakpoint 3.
  Without zones the combatant is a plain capsule (`radius`, `height`).
- Damage: `takeDamage(d)` (public), override `filterDamage(d): number` (armour, invulnerable
  phases), hooks `onDamaged(d, amount)` and `onDied(killer, d)`, `kill(killer?)`.
- Death: `alive`, `deathTime`, `deadProgress`, `corpseTime` (seconds; `< 0` keeps the body),
  `updateDeath(dt)`, `expired`.
- Misc: `aimBone`, `headPoint(out)`, `aimPoint(out)`, `flashColor`, `bloodKind`, `countsForRivalry`,
  `targetable` (set false for parts that must not be marked), `team`, `isBoss`.

The creature itself comes from the kit (`src/creatures/kit/README.md`): `buildCreature`
(rig + SDF sculpt + mesh + skin + material) and the gaits (`insectGait`, `quadGait`, `wingFlap`,
`bipedGait`) with `solveTwoBone` IK. Start from `examples/spider.ts`, `examples/quadruped.ts`
(warg, the mûmak base) or `examples/bat.ts`, and add a `.lab.ts` with every animation.

Weak points on a big creature (mûmak girths, web anchors) are separate small combatants: a
`BaseCombatant` subclass with its own `maxHp`, `team: 'enemy'`, small `radius`/`height`, and one
`addZoneSphere(girthBone, r, 'weakpoint', mult)` on the creature's bone (or on a helper `Object3D`
parented to it). Its own `object` stays a free group under `level.root`: in `update`, copy the
bone's WORLD position into `this.object.position` (the coarse ray test, aim assist and Focus
marks use it), then call `afterAnimate()`. Their `onDeath` drives your script.

```ts
class Girth extends BaseCombatant {
  constructor(private bone: THREE.Object3D) {
    super({ team: 'enemy', name: 'Girth strap', maxHp: 60, radius: 0.4, height: 0.8, bloodKind: 'dark' });
    this.addZoneSphere(bone, 0.35, 'weakpoint', 1);
    this.aimBone = bone;
  }
  update(): void {
    this.bone.getWorldPosition(this.object.position);
    this.object.position.y -= 0.4;               // object.position is the "feet"
    this.afterAnimate();
  }
}
```

## 6. PlayerMover recipes

A `PlayerMover` REPLACES default locomotion while installed (`player.mover = m`; remove with
`player.mover = null`, always, also on timeouts). Each step you write `player.position`,
`player.velocity` and `player.facing`; there is no gravity or collision unless you do it. The
player still aims, shoots (if `allowShoot`), animates (`pose`, `poseT`) and runs the camera
(`camera` overrides, `lockCameraYaw`). Velocity matters: it drives the animation speed and is
inherited when the mover is removed. Fields:
`update(dt, player, input)`, `pose?`, `poseT?()`, `allowShoot?`, `allowMelee?`, `allowDash?`,
`allowJump?`, `camera?: Partial<CameraParams>`, `lockCameraYaw?`. The shield slide in
`c0_arena.ts` (`makeShieldSurf`) is the complete reference.

**On-rails path ride** (barrel ride, bank run, rooftop chase):

```ts
function railRide(level: LevelAPI, path: Path, speed: number, onEnd: () => void): PlayerMover {
  let s = 0, lateral = 0;
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  return {
    pose: 'barrel', allowShoot: true, allowJump: false, lockCameraYaw: true,
    camera: { distance: 4.2, height: 1.8 },
    update(dt, player, input) {
      s = Math.min(path.length, s + speed * dt);
      lateral = clamp(lateral + input.moveX * 4 * dt, -2.5, 2.5);
      path.at(s, p); path.tangent(s, t);
      // right of the travel direction = (-t.z, 0, t.x)
      player.position.set(p.x - t.z * lateral, level.ctx.physics.heightAt(p.x, p.z), p.z + t.x * lateral);
      player.velocity.copy(t).multiplyScalar(speed);
      player.facing = yawOf(t.x, t.z);
      if (s >= path.length) onEnd();
    },
  };
}
```
For barrels, take `y` from `water.levelAt(x, z)` plus a bob, and hop lanes on `input.jump`.

**Slope surf** (Helm's Deep shield stair): speed from the terrain gradient, steer with `moveX`.

```ts
update(dt, player, input) {
  const { physics } = level.ctx, x = player.position.x, z = player.position.z, e = 0.5;
  const gx = (physics.heightAt(x + e, z) - physics.heightAt(x - e, z)) / (2 * e);
  const gz = (physics.heightAt(x, z + e) - physics.heightAt(x, z - e)) / (2 * e);
  speed = clamp(speed + (Math.hypot(gx, gz) * 22 - 0.6) * dt, 2, 16);
  player.facing = damp(player.facing, yawOf(-gx, -gz) - input.moveX * 0.5, 3, dt);
  player.velocity.set(Math.sin(player.facing) * speed, 0, Math.cos(player.facing) * speed);
  player.position.addScaledVector(player.velocity, dt);
  player.position.y = physics.heightAt(player.position.x, player.position.z);
}
```
Stairs built with `stairs()` are colliders, not terrain: use `physics.ground(x, z, y + 1)?.y`.

**Climbing a moving creature** (mûmak flank, troll chain): keep the player in the creature's
LOCAL space, so the creature can walk, sway and turn underneath.

```ts
function climbOn(creature: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, onTop: () => void): PlayerMover {
  const local = from.clone(), world = new THREE.Vector3();
  return {
    pose: 'climb', poseT: () => (local.y - from.y) / (to.y - from.y), camera: { distance: 3.2, height: 1.2 },
    update(dt, player, input) {
      local.y = clamp(local.y + input.moveY * 1.6 * dt, from.y, to.y);
      local.x = clamp(local.x + input.moveX * 1.2 * dt, from.x - 1, from.x + 1);
      creature.updateWorldMatrix(true, false);
      world.copy(local).applyMatrix4(creature.matrixWorld);
      player.velocity.subVectors(world, player.position).divideScalar(Math.max(dt, 1e-4));
      player.position.copy(world);
      player.facing = creature.rotation.y + Math.PI;   // face the flank
      if (local.y >= to.y - 0.05) onTop();
    },
  };
}
```
Walking ON the creature afterwards (the howdah, the neck): give it a box collider and move that
with `collider.setTransform(pos, yaw)` every step. The motor carries a grounded player by the
transform delta, rotation included, so default locomotion just works on a walking platform.

**Hanging from a flying creature** (Ravenhill bat): parent a grip helper to a bone, follow it.

```ts
const bat = createBat(3, 1.4);                          // kit example, ~6.4 m span at scale 1.4
level.root.add(bat.object);
const grip = new THREE.Object3D();
grip.position.set(0, -0.15, 0);
bat.creature.rig.byName.foot_l.add(grip);
const w = new THREE.Vector3();
player.mover = {
  pose: 'hang', allowShoot: true,
  update(dt, player) {
    grip.getWorldPosition(w);
    player.velocity.subVectors(w, player.position).divideScalar(Math.max(dt, 1e-4));
    player.position.set(w.x, w.y - 1.95, w.z);          // hands at the grip
    player.facing = bat.object.rotation.y;
  },
};
// fly the bat along a Path in level.onUpdate; bat.pose('fly', t) each step
```

**Falling-platform jumps** (falling stones): NO mover. Normal locomotion with the double jump on
moving box colliders. Set `collider.velocity` (carried exactly) or just `setTransform` each step.

```ts
const b = stoneBlock([2.4, 0.8, 2.4], i);
b.object.position.set(x, y, z);
level.root.add(b.object);
const col = physics.addBox(b.object.position.clone(), [1.2, 0.4, 1.2], 0, { material: 'stone' });
level.onUpdate((dt) => {
  if (falling) {
    vy -= 22 * dt;
    b.object.position.y += vy * dt;
    col.velocity.set(0, vy, 0);                 // the player standing on it is carried
    col.setTransform(b.object.position);
  }
});
```
Detect "the player landed on it" with `player.grounded` and a footprint test (or
`physics.ground(px, pz, py + 0.2)?.collider === col`), then start a 1–2 s timer before it drops.

## 7. Bosses

A boss is usually a humanoid enemy (`spawnEnemy({ ..., boss: true })`) or a custom
`BaseCombatant`, bound to the boss bar, with a script that watches its HP and switches phases.

```ts
const bolg = level.spawnEnemy({ archetype: 'gundabad', boss: true, name: 'Bolg', hp: 1400, weapon: 'mace' }, spot);
level.boss(bolg, 'Bolg');
let phase = 1;
const stop = level.onUpdate(() => {
  if (phase === 1 && bolg.hp < bolg.maxHp * 0.5) { phase = 2; void enrage(); }
});
async function enrage() {
  bolg.aiEnabled = false;                 // freeze the AI for the scripted moment
  bolg.playPose?.('roar', 1.6);
  level.ctx.player.camera.shake(0.4, 0.8);
  await level.say('Bolg', 'You will die screaming, elf!', 2.2);
  bolg.aiEnabled = true;
  bolg.attack?.('overhead', { windup: 0.9 });   // a telegraphed scripted attack
}
await level.waitUntil(() => !bolg.alive);
stop();
```

- `enemy.attack?(kind, { windup?, target? })` starts a telegraphed attack now (returns false
  while busy); it plays out even with `aiEnabled = false`. `AttackAnim`: `slash backslash thrust
  overhead knife1 knife2 knife3 punch slam sweep throw shoot bite stomp`. Troll `slam` / `stomp`
  are area attacks with shake and debris.
- `enemy.playPose?(pose, seconds)`: `roar stagger kneel block cheer crouch`...
- `aiEnabled = false` + `moveTarget = point` walks the enemy somewhere (a flee, a charge lane).
- Invulnerable phases: for a custom combatant override `filterDamage`; for a spawned enemy,
  restore HP in `onUpdate` (`bolg.hp = Math.max(bolg.hp, bolg.maxHp * 0.35)` until the phase ends).
- Weak points that only count in a phase: separate weak-point combatants with
  `targetable = false` until the phase opens.
- Flourish on the kill: `ctx.time.setScale(0.3, 0.15)`, `await level.wait(0.35)`,
  `ctx.time.setScale(1, 0.4)` (c0_arena `trollFight`).
- The music switches to `boss` automatically while the boss bar is bound to a living combatant.

## 8. Cinematics

```ts
async function intro() {
  if (level.ctx.flags.skipIntro === '1') return;          // the smoke test skips it
  level.cinematic(true);                                   // letterbox, no controls, no HUD
  level.cameraShot({ position: V(18, 9, -16), lookAt: V(0, 1.6, 14), fov: 52, blend: 0 }); // cut
  await level.wait(0.4);
  level.cameraShot({ position: V(-7, 2.4, 6), lookAt: V(0, 1.5, 20), fov: 42, blend: 3.2 }); // 3.2 s move
  await level.say('Legolas', 'Orcs on the wind.', 2.6);
  level.cameraShot(null);                                  // blend back to the player camera
  await level.wait(0.7);
  level.cinematic(false);
}
```

`CameraShot`: `{ position, lookAt, fov?, follow?: Object3D, blend? (s, default 0.6) }`. With
`follow`, `position` and `lookAt` are in that object's local space every frame (ride along with a
mûmak, frame a falling troll). Letterbox easing, HUD and touch controls are handled by
`cinematic()`; do not touch `engine.post.letterbox` yourself. Keep cinematics short (2–8 s) and
always end with `cameraShot(null)` + `cinematic(false)`. Enemies keep fighting during a
cinematic unless you set `aiEnabled = false` on them (or have not spawned them yet).

## 9. Crowds, preload, weather, reverb, music

**Crowds** (background armies; not combatants, no AI):

```ts
const host = level.crowd({ center: V(0, 0, 160), halfSize: [80, 40], count: 1500, kind: 'uruk', facing: Math.PI, speed: 0, props: true });
host.setSpeed(2.5);      // march / charge
host.thin(0.4);          // 40 % of the remaining figures fall (scripted battle progress)
```
Kinds: `orc uruk rohirrim gondor easterling elf dwarf goblin`. `props: true` adds torches,
spears and banners. Density scales with quality. Keep crowds at least ~25 m from the action.

**Preload.** List every `HumanoidKind` your chapter spawns in `ChapterDef.preload` (enemy
archetypes map to kinds: `orc_archer` -> `orc`, `uruk_archer`/`uruk_pike` -> `uruk`). The loading
screen meshes them in the worker pool (4 variation buckets per kind, LOD0 + LOD1) while your
`create()` builds the world; anything missing is meshed on the main thread when first spawned,
which hitches mid-fight (measured in the arena: a 280–560 ms freeze when the first wave spawns
without preload, 18 ms with it). It is not free: each listed kind costs about as much loading as
four characters, so list what spawns, not every kind in the book. While the title screen is up
the shell already warms the "Continue" chapter's list. `?preload=0` disables it (A/B the hitch).

**Weather** comes from the environment preset (`weather`, `weatherIntensity`). Override with
`level.ctx.fx.setWeather('rain', 0.8)` (kinds `none rain storm snow embers ash spores dust`);
`fx.lightning()` flashes the sky (play `'thunder'` yourself, a beat later). For a rainy look on
stone, `setWetness(0.8)` from the world module (the shell resets it to 0 when the level ends).
Tweak a preset by copying it:

```ts
import { ENVIRONMENTS } from '../../core/environment';
level.setEnvironment({ ...ENVIRONMENTS.helms_deep_storm, fog: { color: 0x2a3340, density: 0.03 } });
```

**Reverb** follows the environment automatically (`REVERB` in `src/game/level.ts`): moria
(0.9, 5.5 s), laketown_night (0.5, 2.2), helms_deep_storm (0.45, 2.6), black_gate (0.5, 3), all
others (0.35, 1.6). A tweaked copy keeps its preset's reverb (matched by `name`); a custom
preset can carry `reverb: [amount, decay]`; or call `ctx.audio.setReverb?.(amount, decay)` when
the player walks into a hall.

**Music** is adaptive: explore (no enemies), tension (enemies alive, none within 32 m), combat
(an enemy within 32 m; lingers 4 s), boss (boss bar bound), victory on `complete()`, defeat on
death. Intensity rises with the number of engaged enemies. Pin a mood for a scripted moment with
`level.music?.('epic')`, release with `level.music?.(null)`.

## 10. Performance budgets

High preset target: 60 fps at 1080p on a mid-range desktop GPU. Per frame, everything included
(shadow pass + scene + post):

| | Budget | The arena (High, 22 enemies + Gimli + Legolas all within 20 m) |
|---|---|---|
| Draw calls | ≤ 700 | 527 (shadow 185, scene 209, GTAO 147) — `__game.state().perf.calls` |
| Triangles | ≤ 1.5 M | 1.25 M (characters ≈ 60 %) — `perf.triangles` |
| Live AI enemies | 12–30 | 22 |
| Shadow-casting lights | the sun only (fire lights never cast) | sun |
| Fire lights | through `fx.fire` / `fx.torch` only (2/4/6/8 by quality) | 2 torches |
| JS per frame | ≤ 6 ms for game update | ≈ 1–2 ms (combatants 0.7–1.8 ms) — `perf.frameMs`, `perf.phases` |

Rules of thumb:
- Instance everything repeated (the builders do). One `THREE.Mesh` per prop placed 200 times is
  200 draw calls; a scatter builder is a handful.
- Use `exclude` and `lodNear` / `lodFar` on forests; trees within `lodNear` are full detail.
- Far set dressing does not need shadows: `obj.traverse(o => (o.castShadow = false))`. The shadow
  map only covers ±35 m around the player, but a low sun drags long strips of casters into it,
  and every caster in that box is drawn, including the ones behind the camera.
- Characters are the biggest cost (LOD0 within 18 m, ~20–25 k triangles each, drawn in the shadow,
  scene and, on High, GTAO passes). 20 enemies close to the player is the ceiling; park the rest
  of the army in a crowd.
- Alpha-tested cards (leaves, hair, webs) should carry `userData.noAO = true` so the GTAO/DOF
  pre-passes skip them (forest leaves and webs, grass and humanoid hair already do).
- No allocations in `update` / `onUpdate` (preallocate vectors at module or closure scope).
- Crowds for armies, not combatants. Enemies beyond 35 m already drop to cheap LODs.
- Measure: `node scripts/snap.mjs "/?chapter=<id>&cp=N&quality=high&skipIntro=1&god=1&bot=1" --advance 10 --eval "JSON.stringify(__game.state().perf)"`.

## 11. Testing

```bash
cd /home/user/legolas-greenleaf
npx tsc --noEmit -p . 2>&1 | grep -E "src/game/chapters/c6_|src/creatures/<yours>"   # your files only
node scripts/snap.mjs "/?chapter=amon_hen&cp=1&quality=medium&skipIntro=1&god=1" --size 960x540 --advance 6 --frames 3 --interval 2 --out shots/amon/cp1.png
node scripts/snap.mjs "/?chapter=amon_hen&cp=2&bot=1&god=1&skipIntro=1" --advance 20 --eval "JSON.stringify(__game.state())"
node scripts/snap.mjs "/?chapter=amon_hen&cp=0" --pre "__game.ctx.player.teleport(new (__game.ctx.player.position.constructor)(10,0,40), 0)" --advance 1 --out shots/amon/spot.png
npm run smoke -- --only amon_hen            # every checkpoint, bot + god mode, fails on any page error
npm run smoke -- --only amon_hen --cp 2     # one checkpoint
node scripts/snap.mjs "/lab/?subject=spider&view=quad&anim=walk&t=0.4" --out shots/spider.png
npm run build                               # before you hand in
```

- URL flags: `chapter`, `cp`, `quality=low|medium|high|ultra`, `skipIntro=1`, `god=1`, `bot=1`,
  `seed=N`, `difficulty=easy|normal|hard`, `dev=1` (dev chapters in the menu), `touch=1`,
  `freeze=1` (simulation only through `__game.advance`), `preload=0`, `menu=0`.
- `--pre "<js>"` runs before `--advance` and the shots (stage a moment); `--eval` runs after.
- Hooks: `__game.state()` (mode, checkpoint, hp, enemies, objective, boss, rivalry, music,
  `perf`), `__game.advance(sec)` (fixed-step simulation, awaits script continuations),
  `__game.startChapter(id, cp)`, `__game.bot(on)`, `__game.ctx` (the GameContext).
- Run at most ONE snap or smoke at a time on the shared machine, prefer `--size 960x540`, read
  every PNG you produce.
- The smoke test runs each checkpoint for 20 s with the bot. Your `botHint()` must lead it
  through every beat: `{ moveTo, lookAt?, interact?, jump? }`. It already shoots the nearest
  enemy and uses Focus by itself.

## 12. Common pitfalls

- **Module-level mutable state.** A respawn rebuilds the chapter by calling `create()` again.
  Anything at module scope survives and leaks between attempts. Keep state inside `create()`.
- **`setTimeout` / `requestAnimationFrame` / `Date.now()` in scripts.** They ignore pause and
  slow-mo and fire after the level is gone. Use `level.wait`, `waitUntil`, `onUpdate`.
- **`Math.random()` for anything that shapes the level.** Use `level.rng()` or `new Rng(seed)`
  from `src/core/rng.ts`.
- **Forgetting `start(cp)` for later checkpoints.** Every index must rebuild its state: player
  position, allies, open gates, dead bosses, objectives. Test each with `?cp=N`.
- **Leaving a mover installed.** Always `player.mover = null` after the set-piece, including the
  timeout path of your `waitUntil`.
- **Colliders in the wrong space.** Scatter builders: `addColliders(physics, b.colliders)` with
  no object. Single props: position first, then `addColliders(physics, b.colliders, b.object)`.
  Moving the object afterwards does not move static colliders.
- **Mutating shared materials.** `mat()`, `plain()` and the builders' materials are cached and
  flagged `userData.shared`: they outlive your level (the shell does not dispose them, so their
  shaders stay compiled for the next respawn). Never change their colour or maps in place; ask
  for a variant with `mat(name, { key: 'mine', rgb: [...] })` or `.clone()` it.
- **Raw lights.** A `THREE.PointLight` per torch blows the light budget and recompiles every
  material when the count changes. Use `fx.fire(pos, scale)` / `fx.torch(obj)`.
- **Zero-length vectors in shaders and geometry.** A degenerate normal (`normalize(vec3(0))`)
  is NaN, and one NaN pixel is smeared over the whole frame by bloom. The post chain now clamps
  non-finite pixels, but fix the source: give dynamic geometry valid normals.
- **Forgetting `afterAnimate()`** in a custom combatant: hit zones then lag a frame behind (or
  never update), and arrows pass through limbs.
- **Restoring time.** Every `time.setScale(x)` needs a matching `time.setScale(1, ease)`.
- **Spawning before `start()`.** `create()` builds the world only; enemies spawned there exist
  before the rivalry starts and before the player is placed.
- **Unawaited script errors.** `void run(cp)` is fine (errors reach the console and fail the
  smoke test), but never wrap the script in an empty `catch`.
- **Huge single meshes far away.** Distant mountains and walls should be low-poly with fog doing
  the work; check `perf.triangles` at your widest shot.
- **Not reading the PNGs.** The smoke test passes on a black screen. Look at your shots.
