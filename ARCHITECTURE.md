# Greenleaf: Architecture & Build Rules

Read this file and `src/core/types.ts` (**the contract**) before writing code. `GOAL.md` is the product spec.

Project root: `/home/user/legolas-greenleaf`. Always use absolute paths. Your shell may start in a different directory.

## 1. Hard rules

1. **Everything is built in code.** No image, model, audio or font files and no network fetches at runtime. Textures are generated on canvases or in data arrays, meshes from geometry code, sounds from WebAudio graphs. The only static file is `public/favicon.svg`.
2. **Code against `src/core/types.ts`.** Do not change the meaning of an existing member. If you need more, add an *optional* member (and say so in your report) or solve it locally in your own files.
3. **Stay in your files.** Every module has one owner (section 3). Do not edit files you don't own. If you are blocked on another module, write a minimal local shim *inside your own file*, and report it.
4. **TypeScript strict and zero type errors in your files.** Check them with
   `cd /home/user/legolas-greenleaf && npx tsc --noEmit -p . 2>&1 | grep -E "src/(your/paths)"`.
   Other modules may be mid-construction, so ignore errors outside your paths.
5. **Do not commit, push, or run `git` commands that change state.** The orchestrator commits.
6. **No per-frame allocations in hot paths.** Reuse vectors (see `src/core/math.ts` scratch vectors). Dispose GPU resources in `dispose()` (see `disposeObject`).
7. **Deterministic randomness.** Use `src/core/rng.ts` (`Rng`, `mulberry32`, `noise2/3`, `fbm2/3`) instead of `Math.random()` for anything visual or level-related. (`Math.random` is fine for cosmetic particles.)
8. **Three.js version is 0.185.1.** Import addons from `three/addons/...`. `PCFSoftShadowMap` is deprecated in r185, so use `PCFShadowMap` (soft in r185) or `VSMShadowMap`. Check APIs against `node_modules/three/src` and `node_modules/@types/three` when unsure. Do not guess.
9. If something blocks you, don't stall. Make the best local decision, keep going, and list it under `blockers` in your final report so the orchestrator can rule on it.

## 2. Tools for seeing what you build

### Snapshot CLI (use it; screenshots are how you check visual work)
```
cd /home/user/legolas-greenleaf
node scripts/snap.mjs "/lab/?subject=<name>&view=quad&anim=walk&t=0.4" --out shots/<name>.png
node scripts/snap.mjs "/lab/?view=sheet&category=enemy" --size 1600x1000 --out shots/enemies.png
node scripts/snap.mjs "/?chapter=<id>&cp=0&quality=medium" --advance 5 --frames 3 --interval 2 --out shots/<id>.png
```
`--pre "<js>"` runs an expression before `--advance` and the shots (stage a moment); `--eval` runs after them. Each run starts its own Vite server and headless Chromium (SwiftShader WebGL2), so parallel runs are safe. It prints JSON with `ok`, `errors` (console errors, page errors, 4xx responses) and the shot paths. **Open the PNGs with the Read tool and look at them critically.** Rendering is software, so expect 2–15 s per shot. Use `--size 960x540` for faster iteration.

### Creature Lab: `/lab/`
Any file under `src/` named `*.lab.ts` that exports `subjects: LabSubject[]` is auto-discovered. Views: `orbit` (interactive), `single`, `quad` (front/right/back/high), `sheet` (contact sheet). Use `anim=<name>&t=<sec>` to freeze a pose, `focus=head` for close-ups, `zoom=1.5` for more context, and `wire=1` for wireframe. The lab has neutral studio lighting plus a 1 m grid and a 1.85 m red/white reference pole (Legolas' height).

Every character, creature, weapon and notable prop must have a lab subject with its animations.

### Parallax three.js devtools (orchestrator)
`window.scene`, `window.__THREE_CAMERA__` and `window.__renderer__` are exposed by `main.ts` and the lab, and the Vite dev server runs on port 3000, so the threejs-devtools / playwright / chrome-devtools MCP servers and `deno task checkpoint|sweep|diff-checkpoints|visual:run` can inspect a running page.

## 3. Module map and ownership

| Path | Owner | Exports (must match) |
|---|---|---|
| `src/core/types.ts`, `rng.ts`, `math.ts`, `ARCHITECTURE.md`, `GOAL.md`, `scripts/snap.mjs`, `lab/*`, `src/game/chapters/index.ts` | orchestrator | n/a |
| `src/core/engine.ts`, `src/core/environment.ts`, `src/core/fx.ts`, `src/core/post/*` | **render** | `createEngine(container: HTMLElement, quality: Quality): Engine`; `ENVIRONMENTS: Record<EnvironmentName, EnvironmentPreset>`; `createFx(engine: Engine): Fx` |
| `src/world/textures.ts` | **world** | `getTextureSet(name: TextureSetName, opts?) → { map, normalMap, roughnessMap, aoMap? }` (cached, shared); `makeMaterial(name, overrides?) → THREE.MeshStandardMaterial \| MeshPhysicalMaterial`; `type TextureSetName` |
| `src/world/terrain.ts` | **world** | `buildTerrain(opts: TerrainOpts): { mesh: THREE.Mesh; heightAt(x,z): number }` |
| `src/world/props.ts`, `src/world/vegetation.ts`, `src/world/water.ts`, `src/world/architecture.ts` | **world** | prop builders (see section 6) |
| `src/world/crowd.ts` | **world** | `createCrowd(def: CrowdDef, heightAt: (x,z)=>number): CrowdHandle` |
| `src/creatures/kit/*` | **kit** | the creature construction kit (section 5) + `src/creatures/kit/README.md` usage guide |
| `src/creatures/humanoid.ts`, `src/creatures/humanoid/*` | **kit** | `createHumanoid(spec: HumanoidSpec): Humanoid` |
| `src/creatures/weapons.ts` | **kit** | `createWeapon(kind: WeaponKind, seed?: number): THREE.Object3D` (grip at origin, blade/tip along +Y) |
| `src/creatures/*.lab.ts` (humanoids, weapons) | **kit** | lab subjects |
| `src/physics/world.ts` | **gameplay** | `createPhysics(): PhysicsWorld` (uses three-mesh-bvh for `addMesh`) |
| `src/actors/combatant.ts` | **gameplay** | `abstract class BaseCombatant implements Combatant` (capsule raycast with head/body/limb zones, hit flash, death) |
| `src/actors/player.ts`, `src/actors/camera.ts` | **gameplay** | `createPlayer(ctx: GameContext): PlayerAPI` |
| `src/actors/enemy.ts`, `src/actors/ally.ts` | **gameplay** | `createEnemy(ctx, spec, pos, facing?): Enemy`; `createAlly(ctx, spec, pos, facing?): Ally` |
| `src/combat/projectiles.ts`, `src/combat/registry.ts`, `src/combat/focus.ts` | **gameplay** | `createProjectiles(ctx): Projectiles`; `createRegistry(): CombatantRegistry` |
| `src/game/rivalry.ts` | **gameplay** | `createRivalry(ctx): Rivalry` |
| `src/game/game.ts`, `src/game/level.ts`, `src/game/time.ts`, `src/game/progression.ts`, `src/game/bot.ts`, `src/main.ts` | **shell** | the game loop and state machine, `createLevelAPI`, `createTime(): TimeControl`, `createProgression(): Progression`, test hooks, autopilot |
| `src/game/chapters/c0_arena.ts` | **shell** | dev test arena chapter (number 0, `dev: true`), the reference chapter for the chapter authors |
| `scripts/smoke.mjs` | **shell** | loads every chapter headless, advances 20 s with the bot, screenshots, fails on errors |
| `src/core/input.ts` | **ui** | `createInput(canvas: HTMLElement, uiRoot: HTMLElement): Input` |
| `src/ui/*` | **ui** | `createHud(root: HTMLElement): Hud`; `createMenus(root: HTMLElement, deps: MenuDeps): Menus`; `src/ui/styles.ts` (CSS injected from code) |
| `src/core/audio.ts`, `src/core/audio/*` | **audio** | `createAudio(): AudioSys` |
| `src/game/chapters/cN_<id>.ts`, `src/creatures/<creature>.ts`, `src/creatures/<creature>.lab.ts`, `src/game/chapters/<id>/*` | **chapter authors** | `export const chapter: ChapterDef` |

`MenuDeps` (defined in `src/ui/menus.ts`):
```ts
export interface MenuDeps {
  actions: MenuActions;
  progression: Progression;
  chapters: () => ChapterDef[];
  audio: AudioSys;
  input: Input;
  /** true when a chapter is running (pause menu shows Resume) */
  inChapter: () => boolean;
}
```

### Boot order (`src/main.ts`, shell)
1. Parse the URL flags. `createProgression()` loads the save. Settings decide quality.
2. `createEngine(#app, quality)`, `createInput(canvas, #ui)`, `createAudio()`, `createFx(engine)`, `createHud(#ui)`, `createPhysics()`, `createRegistry()`, `createTime()`.
3. Build the `GameContext` object. `player` is assigned after `createPlayer(ctx)` (two-phase init), then `projectiles`, then `rivalry`.
4. `createMenus(#ui, deps)`, then show the title screen (or jump straight to `?chapter=`).
5. Loop with `requestAnimationFrame`: `input.poll()` → `time` → `game.update(dtGame)` (player, chapter, combatants, projectiles, fx, rivalry) → camera → `engine.render(dtReal)` → `hud.update` and `audio.update`.
6. Expose the test hooks (see the bottom of `types.ts`) and `window.scene` / `__THREE_CAMERA__` / `__renderer__`.

## 4. Visual standard: realistic, all built in code

The bar is **film-like realism**, not stylised low-poly. Use every technique that is cheap enough:

- **Renderer**: `WebGLRenderer`, `outputColorSpace = SRGBColorSpace`, `AgXToneMapping` (applied by `OutputPass`), physically based lights, shadows (`PCFShadowMap`). Shadow map 1024/2048/2048/4096 for Low/Medium/High/Ultra, with a tight shadow frustum that follows `shadowFocus` (±35 m) and texel snapping to avoid shimmer.
- **Post** (`EffectComposer`, HalfFloat targets, MSAA ×4 on High and Ultra): RenderPass → GTAOPass (High and Ultra) → UnrealBloomPass (subtle, threshold ~0.9) → OutputPass → grade pass (lift/gamma/gain, saturation, vignette, film grain, damage flash, focus tint with radial blur, letterbox) → SMAA/FXAA on Low and Medium.
- **Image-based lighting**: build a PMREM from the procedural sky scene (`Sky` addon or the gradient dome) every time the environment changes, and set `scene.environment`. Fog is `FogExp2` with the colour matched to the sky horizon.
- **Materials**: `MeshStandardMaterial`, or `MeshPhysicalMaterial` with `sheen` for cloth, `clearcoat` for wet surfaces and `anisotropy` for hair. Every surface gets procedural **albedo + normal + roughness** (and AO where it helps), with anisotropic filtering, mipmaps and sensible texel density (about 256 px per metre for props, detail-tiled on terrain). No flat-coloured untextured surfaces on anything larger than a hand.
- **Characters**: smooth organic skinned meshes (no visible primitive seams), skin with subtle subsurface-style warmth (wrap lighting or a sheen tint), cloth with sheen and a weave normal, leather and metal with wear in the roughness. Hair is strands, cards or ribbons with an anisotropic highlight. Faces get readable features: brow, nose, eye sockets, ears (pointed for elves).
- **Atmosphere**: fog and haze layers, weather particles (rain streaks, snow, embers, ash, spores), soft particles, light shafts where the scene suits them (Mirkwood canopy, Moria), flickering fire lights with a light budget per quality level.
- **Animation**: procedural, layered, physically plausible: weight shift, foot plant without sliding (cadence matched to speed), secondary motion on hair, cloaks and quivers. Hit reactions and death falls.
- **Scale**: Legolas 1.85 m, Gimli 1.37 m, orcs 1.6–1.8 m, Uruk-hai 2.0 m, Bolg 2.6 m, Cave Troll 4.5 m, mûmak ~14 m tall at the shoulder, giant spiders ~2.5 m leg span (brood mother ~6 m).

Performance budgets (High preset, mid-range desktop GPU, 1080p, 60 fps): about 700 draw calls, 1.5 M triangles, 4 shadow-casting dynamic lights max (fire lights don't cast shadows). Low preset (mobile): pixel ratio 1, no GTAO/bloom, 1024 shadows, half the particles, crowd density ×0.4, and far enemies at reduced LOD.

## 5. Creature construction kit (`src/creatures/kit/`, owner: kit)

The tool for building every character and creature in code. Required capabilities:

1. **Rig builder**: declare a bone hierarchy with rest positions, which yields `THREE.Bone`s and a `THREE.Skeleton`.
2. **SDF sculpting**: signed-distance primitives (capsule/round cone between two points, ellipsoid, rounded box, torus) with smooth union / subtraction / intersection (blend radius `k`). Primitives are attached to bones, with per-primitive colour/material region and noise displacement (wrinkles, scales, muscle, fur clumps).
3. **Meshing**: polygonise the SDF (surface nets or dual contouring preferred, marching cubes acceptable) at a configurable resolution, using sparse/narrow-band evaluation so it stays fast (a humanoid body at ~1 cm detail in under ~150 ms). Normals come from the SDF gradient. Optional simplification. Results are **cached per definition + seed**, so 40 orcs reuse geometry.
4. **Auto-skinning**: weights from primitive ownership and distance (top-4 bones, normalised, smoothed across blend zones), which yields a `SkinnedMesh` that bends cleanly at elbows and knees.
5. **Surface detail**: vertex colour regions + triplanar procedural detail normal/roughness in the shader (skin pores, scales, chitin, fur, leather, cloth weave). Supports wet/sheen/clearcoat via material choice.
6. **Rigid attachments**: weapons, armour plates, helmets, quivers and jewellery parented to bones or sockets. **Hair/fur** via strand ribbons or cards with an anisotropic highlight, skinned or bone-parented, with simple spring secondary motion.
7. **Procedural animation library**: biped locomotion (walk/run/sprint with stride from speed), quadruped gait, multi-leg gait for spiders (alternating tetrapod), wing flap, two-bone IK (feet and hands), look-at, spring bones (hair, cloak, tail, trunk), and a layering/blending helper. All functions are deterministic for a given time `t` (the lab poses subjects at fixed `t`).
8. A **`README.md`** with copy-paste examples, so chapter authors can build spiders, trolls, bats and the mûmak with it.

Use a **web worker** for meshing if a single build exceeds ~100 ms. Otherwise build on the main thread during level load.

## 6. World builders (owner: world)

`textures.ts` names at minimum: `bark`, `mossy_bark`, `leaves`, `grass`, `forest_floor`, `mud`, `dirt`, `rock`, `cliff`, `cobble`, `stone_blocks`, `dwarven_stone` (Moria, carved), `marble`, `wood_planks`, `old_wood`, `thatch`, `snow`, `ice`, `sand`, `ash`, `metal_dark`, `metal_bright`, `gold`, `leather`, `cloth_linen`, `cloth_wool`, `web`, `water_normal`, `chitin`, `scales_rough`, `hide`, `skin_human`, `skin_orc`, `skin_troll`.

`props.ts` / `vegetation.ts` / `water.ts` / `architecture.ts` builders (each returns `{ object: THREE.Object3D; colliders?: ColliderDesc[] }` or just the Object3D where noted). Instanced where repeated: `tree(kind: 'mirkwood_oak' | 'beech' | 'pine' | 'dead' | 'birch', seed)`, `forest(area, count, kinds, heightAt)` (instanced), `rock(size, seed)`, `boulderField(...)`, `grassField(area, density, heightAt)` (instanced blades with wind), `ferns`, `mushrooms`, `webSheet`, `cocoon` (webbed dwarf), `river(path, width)` (flowing water with normal-map flow, foam), `lake(...)`, `woodenHouse(...)` (Lake-town stilt houses), `pier`, `stoneWall(path, height, thickness)` (crenellated option), `tower`, `stairs`, `pillar(kind)`, `ruins`, `gate`, `barrel`, `crate`, `torch`, `brazier`, `banner(color, emblem)`, `tomb` (Balin's), `well`, `ladder`, `bridge`, `chain`, `skeleton`, `weaponRack`, `iceSheet` (Ravenhill frozen falls), `bat` (simple, for distant flocks). `ColliderDesc` is defined in `props.ts` as `{ kind: 'box'; center; half; yaw? } | { kind: 'cyl'; x; z; r; y0; y1 } | { kind: 'mesh'; mesh }` plus `ColliderOpts`, and helper `addColliders(physics, descs)`.

## 7. Gameplay feel (owner: gameplay)

- **Movement**: run 6.5 m/s (sprint 9), acceleration that feels responsive but weighty, double jump (elven leap), dash 6 m with 0.3 s i-frames, slope and step handling, coyote time and jump buffering, landing dust.
- **Bow**: hold to draw (draw time from stats, ~0.55 s), release to loose. Damage, speed and accuracy scale with charge; minimum charge 0.2 so tapping still fires a weak quick shot. Aim mode: FOV 70→48, shoulder camera, slower turn, steadier reticle. Arrows are physical projectiles with slight drop, stick into targets and world (pooled, max ~120 stuck), and kill with satisfying feedback (hit marker, sound, blood/ichor, ragdoll-like fall). Headshots ×2.5.
- **Knives**: 3-hit combo (0.32 s per hit, combo window 0.5 s), forward lunge to the nearest enemy within 3 m, cone hit test; the 3rd hit staggers.
- **Focus**: hold to slow time to 0.2 (eased); marks lock as the crosshair passes within ~70 px of target aim points (gamepad/touch: auto-mark nearest N in view); release looses homing arrows at each marked target, 0.07 s apart in real time. The meter drains while active and refills +12 per kill.
- **Enemies**: telegraphed attacks (wind-up pose 0.4–0.7 s), flanking, surrounding with spacing (no clumping), archers that lead their shots, stagger on heavy hits. Difficulty scales HP, damage and aggression.
- **Aim assist** (gamepad/touch; optional on KB+M): slow the reticle over targets plus a slight magnetism, applied to arrow direction within 4°.
- **Camera**: smoothed third-person over the right shoulder, collision pull-in, shake, scripted shots with blending.

## 8. Chapters (owner: chapter authors)

One file `src/game/chapters/cN_<id>.ts` exporting `chapter: ChapterDef`, plus helper files in `src/game/chapters/<id>/` and creatures in `src/creatures/<name>.ts` (+ `.lab.ts`). Use the `LevelAPI` exclusively for game interaction; never reach into `game.ts`. Study `c0_arena.ts` first, then the handbook `docs/CHAPTER_AUTHORING.md` (LevelAPI cheat sheet, every world builder, custom creatures, movers, bosses, budgets, testing). Each chapter needs:

- A detailed, realistic environment built with the world builders and terrain, at real scale, with lighting from an `ENVIRONMENTS` preset (you can tweak a copy).
- A scripted structure: intro (title card, short cinematic camera, 1–3 lines of dialogue), 2–4 combat beats, the set-piece/boss, an outro, then `complete()`. Checkpoints between beats, and `start(cp)` must work for every checkpoint index.
- Paraphrased dialogue in the films' spirit. Short iconic lines are OK ("That still only counts as one!"); no long verbatim script quotes.
- `botHint()` so the smoke-test autopilot can progress.
- Lab subjects for every new creature.

## 9. Testing

- `npm run typecheck` / `npm run build`
- `node scripts/snap.mjs …` for visual checks, then read the PNGs.
- `npm run smoke`: every chapter loads, the bot plays 20 s, and there are zero page errors.
