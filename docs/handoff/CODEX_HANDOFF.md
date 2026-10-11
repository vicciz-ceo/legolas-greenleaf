# Handoff to Codex (2026-10-11)

This is the honest state of GREENLEAF at the end of the Claude Code sessions, written for the next
agent. Read `AGENTS.md` (repo root) first. It has the rules, the commands, and which older docs are now
obsolete. This file covers context, state, what went wrong, where the code limits are, and a plan with owner
checkpoints.

## 1. Summary

The game **works**. Branch `build/chapters` has all 9 story chapters, the shell, combat, progression,
audio and UI. It typechecks and builds, and all 359 unit tests pass. A full headless smoke run passed 33/33 checkpoints
(29 story + 4 in the dev arena) with 0 errors on the real GPU (`d1d50a3`, 2026-10-11). What does **not** work
is the **look**. The repo owner rejected the characters ("nothing like the references") and the environments
("awful"), and rejected each incremental attempt to fix them. Closing the fidelity gap with the reference
library in `docs/refs/` is the main open problem. The original release plan is **not finished** (§6):
chapter finishers, a final review, then a squash-merge to `main`.

## 2. Repository and branch state

| Thing | State |
|---|---|
| Local clone | `/Users/nerya/legolas-greenleaf`. Older docs say `/home/user/legolas-greenleaf`, which was the cloud box. |
| Working branch | `build/chapters`, pushed to `origin`. The handoff files (this file, `AGENTS.md`, `scripts/gpu-queue.sh`, banners on older docs) are in the commit titled "Handoff to Codex", right after `09f093e`. |
| `main` | The earlier foundation milestone. **Never push or merge to `main` without the owner's explicit OK.** The plan is a squash-merge of `build/chapters` once everything is green. |
| Git identity | The repo-local `user.email` is the owner's GitHub no-reply address. Keep it: GitHub rejects pushes that expose the private address. Never rewrite pushed history. |
| Local-only | The 30 worktrees under `/Users/nerya/greenleaf-wt/<name>` and their `art/<name>` branches exist **only on this Mac**. They are not pushed. A cloud agent cloned from GitHub will not see them. |

### 2.1 WIP branches (local only)
These come from the stopped per-asset art pass (§5.1). All 5 typecheck. None was smoke-tested, reviewed or
merged. **Use them as sources of techniques, not as bases**, because some regressed: the first dwarf
iteration made the silhouette worse.

| Branch | Commit | Touches | What it was doing |
|---|---|---|---|
| `art/dwarves` | `04d3a97` | `src/creatures/humanoid/kinds/dwarves_orcs/dwarf.ts` (+580/−71) | Re-modelling dwarf bucket 0 (bald, tattooed warrior) against `docs/refs/dwarf_bald/` |
| `art/materials` | `8c35c2f` | `src/world/texgen.ts` (+584/−316) | Matching `rock`/`cliff` and other sets to `docs/refs/materials/*.jpg`. Cliff generation went from ~211 ms to ~547 ms, which is a load-time risk |
| `art/props` | `e1e5fb0` | `src/world/geom.ts` (+375) | Prop geometry against `docs/refs/props/` |
| `art/terrain_water` | `85f8b99` | `src/world/terrain.ts`, `water.ts`, `water.lab.ts` | Terrain layering and water against the scene references |
| `art/vegetation` | `92d59f4` | `src/world/leafAtlas.ts`, `shader.ts`, `vegetation.lab.ts` | Tree crowns and leaf atlas against the Mirkwood/Amon Hen references |

The worktrees' gitignored `shots/` folders hold their before images and material comparisons. Removing a worktree
deletes them. Clean-up, when wanted:
```bash
cd /Users/nerya/legolas-greenleaf
mkdir -p shots/wip && for w in dwarves materials crowds vegetation props terrain_water; do cp -R /Users/nerya/greenleaf-wt/$w/shots shots/wip/$w 2>/dev/null; done   # keep the evidence first
# the 5 WIP commits exist only locally: push or tag them first if they may still be wanted
for w in /Users/nerya/greenleaf-wt/*/; do git worktree remove --force "$w"; done
git worktree prune
git for-each-ref --format='%(refname:short)' 'refs/heads/art/*' | xargs -n1 git branch -D
```

## 3. Commits from the Claude Code sessions on this machine (oldest first)

| Commit | What |
|---|---|
| `c493a42` | WIP from the first phase-1 run (stopped early): Mirkwood canopy dressing and lighter fog, small Helm's Deep tweaks |
| `0c13d10` | Shared character pass.<br>Kit shader: skin detail and scars, twill, tooled leather, hammered metal, rust, albedo-tinted cloth sheen.<br>Strand hair texture and parallax eyes.<br>Legolas re-dressed; Bolg re-sculpted (42.7k tris); palette passes for the named cast |
| `8135d74` | Shared environment pass.<br>Materials and weather: `stone_blocks` without ink mortar, unstretched cliffs, snow with occlusion and rock breaks, small depth-faded snow and thin rain.<br>Lighting: night floor and height fog, with new optional preset fields `fogHeight`, `fogFloor`, `nightFloor`, `groundShade` (`docs/CHAPTER_AUTHORING.md` §14) |
| `2b02487`, `26ba67f` | Merges of the two shared passes |
| `d1d50a3` | `rock()` keeps its texture at world scale on big crags; STATUS update |
| `09f093e` | Creature Lab `view=turn`: the reference sheets' four angles in their column order (§4.3) |
| "Handoff to Codex" | This file, `AGENTS.md`, `scripts/gpu-queue.sh`, a `CLAUDE.md` pointer, banners on `HANDOFF.md`, `FINISHER_PROMPT.md` and `FINAL_REVIEW_PROMPT.md`, STATUS update |

## 4. Tools that work (and how to use them)

All commands run from the repo root. Node 24 and Playwright's Chromium are already installed on this Mac.

### 4.1 Checks
```bash
npm run typecheck                    # tsc --noEmit, strict
npm run build                        # tsc + vite build
node src/physics/run-tests.mjs       # 4 suites: physics 61, combat 54, shell 208, finishing 36 (359 total)
```
**The unit tests do not cover the creature kit or the world builders.** After changing characters, the kit or
world code, use the lab checks in §4.6 and smoke.

### 4.2 Headless snapshots and smoke (real GPU, through the queue)
`scripts/snap.mjs` and `scripts/smoke.mjs` each start their own Vite server (127.0.0.1) and headless Chromium.
**Always run them through `scripts/gpu-queue.sh`.** It sets `SNAP_GPU=1` (the real GPU; without it they fall back
to SwiftShader, which is 5-10× slower), and it never lets more than 2 renders run at once on this 8 GB M3.
```bash
export GPU_QUEUE_DIR=/tmp/greenleaf-gpu-queue          # so every session on this Mac shares the same 2 slots
scripts/gpu-queue.sh node scripts/snap.mjs "/?chapter=ravenhill&cp=0&quality=medium&skipIntro=1&god=1&bot=1" --advance 6 --timeout 180000 --out shots/ravenhill-cp0.png
scripts/gpu-queue.sh npm run smoke -- --only ravenhill        # every checkpoint of one chapter (or --cp N)
scripts/gpu-queue.sh npm run smoke                            # all 33 checkpoints, ~35-40 min
```
- Timings: lab snaps take about 10 s; chapter snaps take 30 s to 2.5 min, depending on load.
- Snap's default load timeout is 60 s. Always pass `--timeout 180000`. A `timeout: window.__snapReady` error is almost always machine load.
- `--pre "<js>"` runs before `--advance` and the shots; `--eval` runs after. Both are awaited, and their results are printed as `preResult` and `evalResult`.
- Don't pass `--jobs > 1` to smoke: it takes one queue slot but renders several pages.
- `shots/` is gitignored. Open every PNG and look at it: a smoke run passes on a black screen.

### 4.3 Comparing characters against their sheets
`view=turn` renders the sheets' four angles in their column order (FRONT, 3/4 FRONT, RIGHT PROFILE, BACK):
```bash
scripts/gpu-queue.sh node scripts/snap.mjs "/lab/?subject=legolas&view=turn&anim=idle&t=0.5&bg=7f7f7f&ground=0" --size 1536x1024 --timeout 180000 --out shots/legolas-turn.png
python3 -c "
from PIL import Image
a=Image.open('docs/refs/legolas/legolas_turnaround.jpg').convert('RGB').resize((1536,1024))
b=Image.open('shots/legolas-turn.png').convert('RGB').resize((1536,1024))
im=Image.new('RGB',(1536,2048)); im.paste(a,(0,0)); im.paste(b,(0,1024)); im.save('shots/legolas-compare.png')"
```
**It is not to scale yet.** Proportion judgements made by lining up the rows will be wrong:
- **Camera:** it uses a 32° perspective camera framed on each subject's bounding box, and that box includes the bow and quiver. Legolas comes out about 790 px tall where the sheet has 681 px, the feet sit on different lines, and the panel centres differ (lab x = 192/576/960/1344, sheet x = 318/661/1004/1347). Never draw the sheet's height lines across the lab row.
- **Pose:** `anim=idle` holds the bow raised, and `anim=rest` is the 45° A-pose. The sheets have arms hanging 15-20° out and the bow vertical and low beside the left leg.
- **Labels:** the labels and info line are always drawn, so crop them before taking pixel masks.

To make comparisons objective (the first job of §7), use the calibration the reference library already ships. In
`docs/refs/<id>/spec.json`, `measured.turnaround` holds:
- `px_per_m`, which differs per sheet (legolas 368.1, gimli 286.9, bolg 174.6);
- `baseline_y_px` (940);
- `views[i].sheet_bbox_px`;
- `overall_height_m`. This is measured to the top of helmets and raised gear (gimli 1.53 m, gondor 2.04 m, thranduil 2.08 m), not to the KindDef height.

The library also has per-view RGBA cutouts, `sampling[].rect_px` with `observed.samples` colours (lit sRGB, not
albedo), and design proportions.

Building on that, add an orthographic, sheet-calibrated mode to `view=turn` in `lab/main.ts` and a lab-only
`sheet` pose (wire it into `labFrame` in `src/creatures/humanoids.lab.ts`, backed by a pose in
`src/creatures/humanoid/poses.ts`). With both in place, a proposed acceptance bar is below; **the owner has to confirm the thresholds**:
1. Silhouette IoU per view against the sheet's cutout: at least 0.85 for front and back.
2. Landmark heights within ±3 cm. For Legolas: belt 1.14 m, jerkin hem 0.94-0.96, tunic hem 0.73-0.75, boot tops 0.50, hair tips about 1.16-1.18 (back view), crown 1.85.
3. Widths at chest, waist, thigh and calf within ±10 %.
4. Colour medians in the sampling rectangles.

The numbers gate the work, but the owner's eye decides.

Other lab views:
- **Faces:** `/lab/?subject=<legolas|humanoid_<kind>>&view=single&focus=head&portrait=1&zoom=0.15`. `portrait` only works in `humanoids.lab.ts`.
- **LODs:** `&lod=1` / `&lod=2` work only on `legolas`, `humanoid_<kind>` and the `elves_men` group subjects.
- **Back view:** the player mostly sees Legolas from behind (`/lab/?subject=legolas_shoulder&view=single`), so weight the back view, hair and quiver highest.
- **Animation:** `&anim=walk&t=0.4`.
- **Other options:** `&weapons=none`, `&kitdebug=…` (see `src/creatures/humanoid/KINDS.md`).

### 4.4 Comparing environments and materials
- **Environments:** capture at `--size 1536x1024`, because the references are 3:2 and a 16:9 frame changes the horizontal FOV. Use the same URL before and after. Iterate at `quality=medium`, but take sign-off shots at `quality=high` (medium has no GTAO or MSAA). Place them side by side with `docs/refs/scenes/<id>/gameplay_view.jpg`.
- **Facing a landmark:** `--pre "__game.ctx.player.teleport(new (__game.ctx.player.position.constructor)(x,y,z), yaw)"`.
- **Camera framing:** the game camera's shoulder offset (0.62 m) is not the reference's (1.2 m). Don't change the gameplay camera without the owner.
- **Stale scene notes:** each scene's `notes.md` "Gaps vs current", plus `current_coded.jpg` and `current_vignette.jpg`, were captured from base `7ab3afd`, before the chapters existed. Ignore those three and capture the real chapter instead.
- **`lighting.json`** is a target look, not a delta. Do not apply `changes_vs_current` on top of a chapter's own preset.
- **`layout.json`** is advisory. Keep the existing checkpoint positions, routes and bot hints, and add landmarks (for example Erebor visible from Ravenhill) without moving gameplay.
- **Materials** need no GPU and no queue: `node src/world/tools/texdump.mjs rock,cliff --mode all --size 512 --out shots/world/tex.png`. The targets are in `docs/refs/materials/materials.json` (tile size in metres, albedo and roughness ranges, observed statistics). For the in-engine look, use `/lab/?subject=texture_swatches`. Textures are generated at load, so watch the generation time.

### 4.5 Bot play-through and per-checkpoint performance
```bash
# bot from cp0 until mode 'complete' (one snap; preResult holds the per-30 s log; drop god=1 to see where it dies)
scripts/gpu-queue.sh node scripts/snap.mjs "/?chapter=mirkwood&cp=0&bot=1&god=1&quality=low&skipIntro=1" --size 960x540 --timeout 180000 --out shots/bot.png --pre "(async()=>{const log=[];for(let i=0;i<40;i++){await __game.advance(30);const s=__game.state();log.push({t:(i+1)*30,mode:s.mode,cp:s.checkpoint,obj:s.objective,hp:s.hp,enemies:s.enemies,kills:s.kills});if(s.mode==='complete')break;}return JSON.stringify(log)})()"
# perf at High for every checkpoint (one snap; the first load just boots the engine)
scripts/gpu-queue.sh node scripts/snap.mjs "/?chapter=helms_deep&cp=0&quality=high&skipIntro=1&god=1&bot=1" --timeout 180000 --out shots/perf.png --pre "(async()=>{const r=[];for(const cp of [0,1,2,3]){await __game.startChapter('helms_deep',cp);await __game.advance(10);const p=__game.state().perf;r.push({cp,calls:p.calls,triangles:p.triangles,load:p.load});}return JSON.stringify(r)})()"
```
- **Timing:** 60 game seconds take 40-70 s real, so a full 40-chunk bot loop can hold a GPU slot for 15-25 minutes.
- **Budget at High:** ≤ 700 draw calls and ≤ 1.5 M triangles per beat.
- **What `perf.triangles` counts:** it sums the shadow, scene and GTAO passes. Adding 10k triangles to Legolas therefore costs up to about 30k of the frame budget.

### 4.6 Checks after character, kit or world changes
- **Variant stress tests:** `scripts/gpu-queue.sh node scripts/snap.mjs "/lab/?subject=dwo_stress" --timeout 180000 --eval "JSON.stringify(__dwoStress.filter(r=>r.err))"`, and the same for `em_stress` with `__emStress`. These cover every dwarves/orcs and elves/men variant. Uruks, bosses and trolls have no stress subject, so snap them individually.
- **Cast at true scale:** `/lab/?subject=humanoid_lineup&view=single&zoom=0.55` at `--size 1600x700`.
- **Build times:** `__kitBench.build()` in the lab.
- **Gameplay:** smoke the chapters that show what you changed, or run the full smoke after shared changes.
- **Performance:** the per-checkpoint table (§4.5).

## 5. What happened in these sessions, and why the look is still wrong

### 5.1 Timeline
1. Cloned the repo to this Mac and started the planned **chapter finishers** (Sonnet subagents) on the 4 interrupted
   chapters. The owner then reviewed **Ravenhill** (marked "done" in HANDOFF.md) and the cast, found both
   far from the references, and the finisher phase was stopped.
2. **Shared rendering pass** (two Opus agents): the character kit and humanoids, plus environment materials,
   weather and lighting. Merged, full smoke 33/33. It was a real improvement, most of all for Bolg. The owner still
   judged both "awful / nothing like the references".
3. **Per-asset art pass.** The work was split across 30 worktrees: 24 for characters (the 32 character sheets, with characters that share a code file
   worked one after another) and 6 for shared assets. Each had an Opus agent and an independent art-director review. It was stopped
   about 50 minutes in, before any item finished, for this handoff (WIP in §2.1).

### 5.2 The gap, concretely
The owner's complaints, traced to code where known:
- **Legolas** (`kinds/legolas.ts` vs `docs/refs/legolas/`). The colours are close since `0c13d10`.
  - **Proportions:** "stubby", with thick limbs and big boots. The bone lengths already roughly match `spec.json`; the bulk comes from:
    - limb radii (`anatomyParts` in `humanoid/anatomy.ts`);
    - garment inflation stacked on top (about 2-3 cm on the torso and limbs);
    - coarse 2.4 cm body cells (`detail.res`).

    Boots: drop the torus cuff (the `boots` layer in `humanoid/outfit.ts`) for Legolas and slim the shaft.
  - **Garment:** the lab shows a closed, round-necked leather tunic with a box peplum. The sheet has an open V-neck vest over the green tunic, tooled with leaves, down to the hips, with front edges that part below the belt. In `humanoid/outfit.ts` the `jerkin` layer builds a crew neckline and a closed front (§5.3).
  - **Hair:** strand cards ending at the upper back, with small temple braids. The sheet has fuller hair to mid-back, with ends nearly level.
    - The cause is a one-line setting: `legolas.ts` has `hair.length: 0.88`, and **values below 1 raise the tips** (`hairstyles.ts` ≈ line 234; each 0.1 moves the end by 0.045 × the scale). Use about 1.1-1.15 and check the back view against tips at about 1.17 m.
    - The V-hem (`STYLES.long_straight.hem.v`, 0.07) is shared with Tauriel and the Rohirrim, so make it a per-kind field before changing it.
  - **Face:** reads as a mannequin. `sculptHead` in `humanoid/face.ts` is one parametric template for every kind.
  - **In-game:** he bleaches in Ravenhill's bright snow (chapter exposure).
- **Bolg** (`kinds/uruks_bosses/bolg.ts`): re-sculpted in `0c13d10` and much closer in the lab. He reads pink and doll-like under Lake-town's lanterns, and near-white under the lab's bright key.
- **Dwarves** (`kinds/dwarves_orcs/dwarf.ts`, `docs/refs/dwarf_*`):
  - The beards are grey and bushy. The sheets have dark braided beards.
  - The bald dwarf has none of the sheet's head and arm tattoos.
  - The bodies are pot-bellied leather sacks. The sheets have a leather vest over mail, with crossed straps.
  - Some carry a spear. The sheets show axes.
- **Environments**:
  - **Ravenhill:**
    - From the gameplay camera, Erebor, the valley, the burning Dale and the tower are not visible: the player is walled in.
    - Rock slabs float in mid-air in cp1.
    - The tower interior and the falling stones read as cartoon boxes, although the shared stone is better now.
  - **Helm's Deep:**
    - The Hornburg keep, the 60 m stair and the lightning don't read.
    - cp2 floats in a void.
    - **cp0 measures 1.52 M triangles at High, over budget, and cp1 is at 1.46 M** (§4.5 recipe at `09f093e`). An earlier reading of 1.64 M came from a different measurement.
  - **Mirkwood:** a flat green fog wash, pale blotches on the floor, thin pole-like trees, and webs that are straight lines.
  - **Amon Hen:** pole-like trees under an even warm wash.
  - **Lake-town:** the sky is too bright and busy after the shared night-floor change.
  - **Pelennor:** marked done by the cloud session but never re-reviewed against the references.
- **Crowds** look toy-like close up. They were built to be seen from 40 m.

### 5.3 Why repeated agent passes did not close the gap, and where the kit's limits are
1. **The ceiling is the tech, not the tuning.** Characters are signed-distance-field sculptures, meshed and auto-skinned. The output is soft clay forms, with detail only from procedural shader patterns. The sheets are photoreal renders. The places to work on:
   - **Meshing** (`src/creatures/kit/mesher.ts`, `meshSdf`/`runPass`): surface nets, one vertex per cell, no crease or feature preservation. Detail regions are AABBs, and `refine` only splits colour/material edges.
     - Cheap levers that need no kit change: `KindDef.detail.res` (hero body 2.4 cm), extra regions in `prepareHumanoid` (`humanoid/build.ts`) around the torso and garment edges, and the projection iterations (`project`; the code default is 1, the docs say 2).
     - The real fix is feature-preserving vertex placement (dual contouring / QEF) in `runPass`.
     - Cache: `kit/cache.ts`. Workers: `kit/workers.ts`, `kit/mesh.worker.ts`.
   - **Garments** (`humanoid/outfit.ts`, `sculptOutfit`): these re-emit the body's anatomy parts inflated (`emitParts` in `anatomy.ts`) into one closed SDF, cut by planes. So a garment can never stand off the body, overlap with a gap, or open at the front.
     - Open cloth exists only as the skirt and cloak sheets in `humanoid/cloth.ts`. There is a single skirt slot with one `skirt_f`/`skirt_b` bone pair (`proportions.ts`).
     - Vest flaps, collars and lapels need either a new open-sheet builder next to `cloth.ts` (added to the `cloth` list in `build.ts`, so LOD1 and LOD2 get it), or a shell op (|d|−t) in the `Sculpt` of `kit/sdf.ts`.
   - **Hair:**
     - `kit/hair.ts`: `growStrands`, `clumpStrands`, `hairGeometry`, `strandTexture`, `createHairMaterial`.
     - `humanoid/hairstyles.ts`: `STYLES`, `buildHair`, and `sculptHairCap`, the dark SDF cap baked into the body mesh that reads as a "shell".
     - Elves and Thranduil use `addHair` in `kinds/elves_men/hair.ts` instead.
   - **Face:** `sculptHead`/`sculptEars` in `humanoid/face.ts`, a single template; `facehair.ts` for brows and lashes; `eyesGeometry`/`eyeTextures` in `build.ts`.
   - **Shading:** `createCreatureMaterial` in `kit/material.ts` (onBeforeCompile) and `SURFACES` in `kit/surfaces.ts`. All detail is procedural per-vertex patterns in rest pose. There are no UVs and no texture maps, so authored motifs (leaf tooling, tattoos) can only be SDF paint primitives or the fixed pattern set.
   - **Poses and LOD:** `humanoid/poses.ts`; LOD in `opts1` of `build.ts` (resolution ×1.5).
2. **Agents grade themselves too kindly.** Only an independent, calibrated side-by-side with numbers (§4.3) gives a reliable verdict.
3. **Shared code caps chapter work.** Materials, vegetation, crowds and the kit are shared, and chapter passes that could not touch them produced tint tweaks. Fix shared things first, then compose chapters on top.
4. **The machine is the bottleneck.** On an 8 GB M3, more than 2 concurrent GPU snapshots push the load average past 20, and snaps time out. Use the queue.
5. **"Done" in older docs** means "passed smoke and an agent liked its own screenshot". Re-verify visuals before trusting any ✅.

## 6. What is left from the original release plan

| Step | State |
|---|---|
| Chapter finishers: mirkwood, helms_deep, laketown, amon_hen (bot to `complete`, art pass, §13 migrations) | **Not done.** Only partial edits (`c493a42`). Per-chapter technical notes (APIs to migrate to): `docs/handoff/FINISHER_PROMPT.md` |
| Chapter finishers: barrels, moria, black_gate | **Not done.** Notes in FINISHER_PROMPT.md |
| Ravenhill | Marked done by the cloud session and **rejected on review** (§5.2). Re-finish it. |
| Pelennor | Marked done by the cloud session and **never re-reviewed** against the references. Verify before trusting. |
| Character fidelity (32 character sheets + 4 supplements: weapons, orc_variants, dwarf_company, mumak_howdah) and shared assets (materials, vegetation, props, terrain/water, crowds, weapons) | **Not done.** WIP in §2.1 |
| Final review (`docs/handoff/FINAL_REVIEW_PROMPT.md`): gates, campaign play-through with and without god mode, progression, 4 review angles, GOAL.md acceptance criteria, README release summary | **Not done** |
| Squash-merge `build/chapters` → `main` | **Not done. Needs the owner's explicit OK.** |

GOAL.md acceptance criteria, as last verified:
1. The build passes. ✅
2. Every chapter playable start to end. ⚠️ The cloud session verified the bot reaching `complete` for ravenhill and pelennor only. Mirkwood reached cp2 here.
3. Set-pieces and bosses exist. ✅ They exist; quality varies.
4. Every character in the lab. ✅ They exist, but don't match the references.
5. Visual pipeline features. ✅ All present.
6. Input. Not re-verified.
7. Audio. Not re-verified; no human has listened.
8. Saves. Not re-verified.
9. Smoke. ✅ 33/33.
10. 60 fps at High on mid-range hardware. ⚠️ Unmeasured on real hardware; Helm's Deep cp0 is over the triangle budget.

## 7. Recommended plan, with owner checkpoints

1. **Baselines (no art yet).**
   - Run the §4.5 perf recipe for all 9 chapters at High, one snap per chapter.
   - Write a table into STATUS.md: chapter / cp / calls / triangles / `perf.load` / smoke ready time.
   - Any checkpoint over 700 calls or 1.5 M triangles blocks adding detail to characters that appear there. Fix Helm's Deep cp0 first.
2. **Measurement tools.** Build the calibrated orthographic `view=turn` and the `sheet` pose (§4.3), and a small script that computes the acceptance numbers.
3. **One hero, all the way: Legolas.** Start with the cheap levers (§5.2 hair length, the boots, `detail.res` and regions, the garment neckline), then the kit upgrades (§5.3) where the kit is the limit.
   - Put kit and humanoid-base upgrades behind **opt-in KindDef fields** (for example `detail.mesher: 'v2'`, a garment `shell` option, a new hair style). Other kinds then keep their geometry until each is migrated and checked. Run §4.6 after every base change.
   - Budgets (owner to confirm): Legolas LOD0 ≤ 80k, LOD1 ≤ 15k, lab build ≤ 1 s; named NPCs ≤ 45k; enemy kinds ≤ 12k, since up to about 30 are on screen.
   - Don't let load time (`perf.load`) or smoke ready time regress by more than 10 % without saying so.
4. **OWNER CHECKPOINT 1: stop and ask in chat.** Deliver:
   - `shots/legolas-compare.png` and the metrics table;
   - the `legolas_shoulder` back view;
   - in-game shots at `quality=high` in one bright and one night chapter (ravenhill cp0, laketown cp1).

   Don't start a second character before sign-off.
5. **Decision point.** If Legolas still misses the bar after the meshing, garment and hair upgrades, **propose (do not start)** an alternative for heroes: explicit polygon garments and hair built in code, such as parametric or lofted meshes with generated normal maps, skinned to the same rig with LOD0, LOD1 and LOD2 kept. Give its cost and triangle numbers. It must still respect "everything in code" and GOAL #4.
   **OWNER CHECKPOINT 2:** before replacing the SDF pipeline for any character, or adding any npm dependency.
6. Scale the proven method to the other characters, bosses first. Then shared materials and vegetation, which decide every chapter's look; keep generation time in check. Then the environments, one chapter at a time, within budget, passing smoke, with the bot reaching `complete`.
7. Final review (FINAL_REVIEW_PROMPT.md, as amended by AGENTS.md), then **propose** the squash-merge message. Never merge without the owner.

Pushing `build/chapters` after the gates pass is allowed. `art/*` stays local unless the owner asks.

## 8. Maps you will need

### 8.1 Character references → code
Humanoid kinds live in `src/creatures/humanoid/kinds/`. Variants are seed buckets 0-3 inside one kind file.
The group lab subjects (`dwarf`, `orc`, `elf`, `gondor`, …) take **`&seed=`**: seeds **0, 2, 3, 4** give buckets **0, 1, 2, 3**
(the console prints the bucket). `humanoid_<kind>` is fixed at seed 0, and the uruks/bosses subjects ignore
`&seed`. Prefer the group subject (`gimli`, `orc`, `tauriel`, …) over `humanoid_<kind>`: it uses the in-game loadout.
`<kind>_variants` shows all 4 buckets side by side, but it is useless in `view=turn`, where every panel has 4 figures.

| Reference `docs/refs/…` | Code | Lab subject(s) | Appears in |
|---|---|---|---|
| `legolas` | `kinds/legolas.ts` | `legolas`, `legolas_shoulder` | every chapter (player) |
| `gimli` | `kinds/dwarves_orcs/gimli.ts` | `gimli`, `humanoid_gimli` | moria, amon_hen, helms_deep, pelennor, black_gate, arena |
| `aragorn` | `kinds/elves_men/aragorn.ts` | `aragorn`, `humanoid_aragorn` | moria, amon_hen, helms_deep, pelennor, black_gate |
| `tauriel` | `kinds/elves_men/tauriel.ts` | `tauriel`, `humanoid_tauriel` | mirkwood, barrels, laketown, ravenhill |
| `thranduil` | `kinds/elves_men/thranduil.ts` | `thranduil`, `humanoid_thranduil` | no chapter (lab only) |
| `elf_mirkwood` / `elf_galadhrim` | `kinds/elves_men/elf.ts` buckets 0,2 / 1,3 | `elf&seed=0` and `&seed=3` / `elf&seed=2` and `&seed=4`; `elf_variants`, `humanoid_elf` | mirkwood, ravenhill / helms_deep |
| `gondor` / `boromir` | `kinds/elves_men/gondor.ts` buckets 1-3 / 0 | `gondor&seed=2\|3\|4` / `gondor` (seed 0), `amon_boromir`; `gondor_variants`, `humanoid_gondor` | black_gate, pelennor / moria, amon_hen |
| `rohirrim` | `kinds/elves_men/rohirrim.ts` | `rohirrim`, `rohirrim_variants`, `humanoid_rohirrim` | helms_deep, pelennor, black_gate |
| `laketown_man` | `kinds/elves_men/man.ts` | `man`, `man_variants`, `humanoid_man` | no chapter (the AllyKind `man` preset in `src/actors/ally.ts` is unused; Lake-town has no townsfolk) |
| `orc` (+ `orc_variants`) | `kinds/dwarves_orcs/orc.ts` | `orc`, `orc_variants`, `humanoid_orc` | barrels, laketown, ravenhill, moria, pelennor, black_gate, arena |
| `goblin` | `kinds/dwarves_orcs/goblin.ts` | `goblin`, `goblin_variants`, `humanoid_goblin` | moria, laketown, arena |
| `gundabad` | `kinds/dwarves_orcs/gundabad.ts` | `gundabad`, `gundabad_variants`, `humanoid_gundabad` | ravenhill, laketown, barrels |
| `easterling` | `kinds/dwarves_orcs/easterling.ts` | `easterling`, `easterling_variants`, `humanoid_easterling` | black_gate, pelennor |
| `haradrim` | `kinds/dwarves_orcs/haradrim.ts` | `haradrim`, `haradrim_variants`, `humanoid_haradrim` | pelennor |
| `dwarf_bald` / `dwarf_hat` / `dwarf_elder` / `dwarf_redbeard` (+ `dwarf_company`) | `kinds/dwarves_orcs/dwarf.ts` buckets 0/1/2/3 | `dwarf&seed=0` / `&seed=2` / `&seed=3` / `&seed=4`; `dwarf_variants`, `humanoid_dwarf`; barrel riders `barrel_dwarf_a..d` | barrels, mirkwood, laketown |
| `uruk` / `berserker` | `kinds/uruks_bosses/uruk.ts` | `uruk`, `uruk_archer`, `uruk_pike`, `uruk_bare`, `uruk_v1..3`, `humanoid_uruk` / `berserker`, `berserker_v1..3`, `humanoid_berserker` | amon_hen, helms_deep / helms_deep |
| `lurtz` | `kinds/uruks_bosses/lurtz.ts` | `lurtz`, `lurtz_blade`, `lurtz_bow`, `humanoid_lurtz` | amon_hen cp2 |
| `bolg` | `kinds/uruks_bosses/bolg.ts` | `bolg`, `humanoid_bolg` | laketown cp2, ravenhill cp2-3 |
| `cave_troll` / `war_troll` | `kinds/uruks_bosses/troll.ts` buckets 0-1 / 2-3 | `troll_cave`, `troll_cave_b` / `troll_war`, `troll_war_b`; `humanoid_troll` | moria cp1, ravenhill cp0 (the "Gundabad Troll" boss, seed 41 = bucket 0 cave look), arena (dev) / black_gate cp1 |
| `mirkwood_spider` / `brood_mother` | `src/creatures/spider.ts` | `spider`, `spider_b`, `spider_lineup` / `brood_mother` | mirkwood |
| `mumak` (+ `mumak_howdah`) | `src/creatures/mumak.ts` | `mumak`, `mumak_bare`, `mumak_far`, `howdah` | pelennor |
| `gundabad_bat` | `src/creatures/bat.ts` | `gundabad_bat`, `gundabad_bat_rider` | ravenhill cp1 |
| `great_eagle` | `src/creatures/eagle.ts` | `great_eagle`, `great_eagle_windlord` | black_gate |
| `fell_beast` | `src/creatures/fellbeast.ts` | `fell_beast`, `fell_beast_bare` | black_gate |
| `weapons` | `src/creatures/weapons.ts` | `weapons`, `weapons_blades`, `weapons_ranged` | everywhere |

The shared base (`src/creatures/kit/**` and the files directly in `src/creatures/humanoid/`) changes every
character: see the guardrails in §7.3 and the checks in §4.6.

### 8.2 Environments → code
| Environment | Code | References |
|---|---|---|
| Title backdrop | `src/game/backdrop.ts`, `ENVIRONMENTS.menu` in `src/core/environment.ts` | `docs/refs/scenes/menu/` |
| Chapter `<id>` | `src/game/chapters/cN_<id>.ts`, `src/game/chapters/<id>/**` (chapters keep their own environment preset copies) | `docs/refs/scenes/<id>/` |
| Chapter-specific builders | `src/world/arch_laketown.ts`, `arch_ravenhill.ts`, `arch_moria.ts`, `arch_amonhen.ts`, `arch_helms.ts` (its generic `stoneWall`/`stairs`/`tower`/`gate` are used elsewhere), `arch_minas.ts`, `arch_blackgate.ts` | same |
| Shared world | Materials: `src/world/texgen.ts`, `textures.ts`. Trees: `vegetation.ts`, `treegeo.ts`, `leafAtlas.ts`. Also `props*.ts`, `terrain.ts`, `water.ts`, `crowd.ts`. In `src/core/`: `fx.ts` (weather/fire), `environment.ts`, `post/` | `docs/refs/materials/`, `docs/refs/props/`, scenes |

Chapter ids in story order: `mirkwood`, `barrels`, `laketown`, `ravenhill`, `moria`, `amon_hen`, `helms_deep`,
`pelennor`, `black_gate` (dev arena: `arena`). Checkpoints: 3 each, except ravenhill and helms_deep, which have 4 (29 total; the arena has 4).

## 9. Things the owner will want to test by hand
Difficulty and pacing per chapter. It was tuned only by a bot, mostly in god mode. Also:
- the audio mix;
- frame rate and load times at High on a real GPU;
- touch controls on a phone;
- whether each character and scene now reads as its reference.
