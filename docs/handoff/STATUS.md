# Verification status at handoff (2026-10-11)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `node src/physics/run-tests.mjs` | ✅ 359 passed (physics 61, combat 54, shell 208, finishing 36) |
| `npm run build` | ✅ (last run after the shared fixes) |
| Full smoke, 11 Oct morning (before shared fixes) | 31/33 checkpoints ✅. The 2 failures were a dev-server collision with a file being edited (HTTP 500 on crowd.ts), not chapter bugs |
| Smoke after shared fixes | arena 4/4, ravenhill 4/4, laketown 3/3, black_gate 3/3, moria 3/3 ✅ |
| Finisher-verified chapters | ravenhill (smoke 4/4, bot reaches complete), pelennor (smoke 3/3, bot reaches complete at Low and High) ✅ |

## Interrupted chapters (mirkwood, helms_deep, laketown, amon_hen)

Smoke run at handoff, on the final committed state (`cd88dc4`, SwiftShader, idle machine): **13/13 checkpoints pass, 0 errors.**

| Chapter | cp | Ready | Mode after 20 s bot | Kills | Errors | Objective |
|---|---|---|---|---|---|---|
| mirkwood | 0 | 46.7 s | playing | 10 | 0 | Drive off the spiders |
| mirkwood | 1 | 42.6 s | playing | 2 | 0 | Go into the hollow |
| mirkwood | 2 | 38.8 s | playing | 3 | 0 | Kill the Brood Mother |
| helms_deep | 0 | 57.4 s | playing | 3 | 0 | Push the ladders off the wall (2/6) |
| helms_deep | 1 | 50.0 s | playing | 0 | 0 | Stop the torch-bearers (0/3) |
| helms_deep | 2 | 58.6 s | playing | 5 | 0 | Drive them back from the breach |
| helms_deep | 3 | 37.7 s | playing | 3 | 0 | Hold the Hornburg gate until dawn |
| laketown | 0 | 58.6 s | playing | 8 | 0 | Push on to the market |
| laketown | 1 | 47.7 s | playing | 11 | 0 | Defend Bard's house |
| laketown | 2 | 54.7 s | playing | 0 | 0 | Defeat Bolg |
| amon_hen | 0 | 70.5 s | playing | 1 | 0 | Climb through the woods to the ruins |
| amon_hen | 1 | 65.3 s | playing | 4 | 0 | Defend the ruins |
| amon_hen | 2 | 70.4 s | playing | 0 | 0 | Defeat Lurtz |

Not yet re-done for these four: a full bot play-through to `complete`, and finishing their art passes and migrations (see FINISHER_PROMPT.md).

---

# Local session, 2026-10-11 (M3, real GPU via `SNAP_GPU=1`)

## Phase 1, first run: stopped early (by decision)

Started the 4 interrupted finishers (2 at a time). A director review of Ravenhill (marked done) and of the
characters showed the look was well below the references: Ravenhill had no vista, floating rock slabs,
cartoon brick stone and featureless snow; Legolas read as clay, Bolg as a grey toy. Helm's Deep's
in-progress "after" shots barely differed from "before". The common cause was shared code (stone texture,
cliff mapping, snow, weather sprites, character materials), which chapter finishers may not touch.
Decision: stop phase 1, run a shared rendering pass first, then re-finish all 9 chapters on top of it
(32 snaps per chapter). The partial phase 1 edits were kept (`c493a42`).

## Shared rendering pass (two Opus agents, separate worktrees)

| Area | Commit | Result |
|---|---|---|
| Characters (kit + humanoid) | `0c13d10` | Kit shader: skin detail and scars, twill, tooled leather, hammered metal, rust, albedo-tinted cloth sheen (no more mint wash); strand hair; parallax eyes. Legolas re-dressed per spec; Bolg re-sculpted (42.7k tris); palette passes for the named cast. Arena High 382 calls / 849k tris. |
| Environment (world + fx + lighting) | `8135d74` | Realistic `stone_blocks`, unstretched cliffs/rock, snow with occlusion and rock breaks, de-cartooned wood/bark/floor; small depth-faded snow and thin rain; night floor, height fog, ground-shade IBL (new optional preset fields, CHAPTER_AUTHORING §14). Calls/tris unchanged, load +7–18 %. |
| Orchestrator fix | `d1d50a3` | `rock()` keeps its texture at world scale on big crags (tile divided by the quantised size). |

Gates on the merged tree: typecheck ✅, unit tests ✅ 359/359, **full smoke `SNAP_GPU=1 npm run smoke`: 33/33 checkpoints, 0 errors.**

Known after the shared pass (handed to the chapter re-finishers): Helm's Deep cp0 is over the triangle budget at
High (re-measured at `09f093e`: 1.52 M, cp1 1.46 M; an earlier reading said 1.64 M); Legolas still bleaches in Ravenhill's bright snow (chapter
exposure); Lake-town's Bolg reads pink under lantern light; Mirkwood floor has pale decal blotches.

## Per-asset art pass (stopped) and handoff to Codex

The owner judged the shared pass still far from the references ("characters nothing like the references,
environments awful") and asked for one agent per character and per environment. Set-up:
- `view=turn` in the Creature Lab (`09f093e`), laid out like the reference turnarounds.
- A GPU queue (now `scripts/gpu-queue.sh`).
- 30 worktrees `/Users/nerya/greenleaf-wt/<name>` (branches `art/<name>`, local only).
- One Opus agent per character (32 character sheets, in 24 worktrees) and per shared asset (6), each with an independent art-director review.

It was stopped about 50 minutes in for a **handoff to Codex**, before any item finished. Five branches hold
unreviewed WIP commits (`art/dwarves` `04d3a97`, `art/materials` `8c35c2f`, `art/props` `e1e5fb0`,
`art/terrain_water` `85f8b99`, `art/vegetation` `92d59f4`). They typecheck; none is smoke-tested or merged.
The full state, lessons and plan are in `docs/handoff/CODEX_HANDOFF.md`.

Last verified gates on `build/chapters`: typecheck ✅, unit tests ✅ 359/359, full GPU smoke ✅ 33/33 (`d1d50a3`).
