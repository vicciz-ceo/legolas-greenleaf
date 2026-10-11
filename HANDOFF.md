# Handoff: continuing Greenleaf on your machine

> **Superseded on 2026-10-11 by [`docs/handoff/CODEX_HANDOFF.md`](docs/handoff/CODEX_HANDOFF.md)** (handoff to Codex). This file is kept for its quick start, URLs and history. Its "✅ done" art rows did not hold up to the owner's review: re-verify any visual claim against `docs/refs/`.

Snapshot taken 2026-10-11, when the cloud build session was stopped.

## TL;DR

- **Work on branch `build/chapters`.** It has everything: all 9 chapters, the cast and UI polish, the shared-system fixes, and art passes started on 6 chapters (none accepted on the owner's review; see `docs/handoff/CODEX_HANDOFF.md` §5). `main` is the earlier verified milestone (the foundation only).
- The game builds, typechecks and passes all 359 unit tests on `build/chapters`.
- What's left is listed in [What's left](#whats-left), in order. The prompts for continuing with Claude Code are in `docs/handoff/`.

## Branches

| Branch | What it is |
|---|---|
| `main` | Foundation milestone (engine, kit, cast, world, gameplay, UI, audio, shell, arena). Verified: build, smoke, tests. |
| **`build/chapters`** | **Current work.** Everything since the foundation: 9 story chapters, reference library, cast and UI polish, shared fixes, chapter finishers. Its "WIP" commits get squashed into `main` once everything is green. |
| `build/foundation` | Historical; superseded by `main`. The reference PRs #1/#2 were merged here and copied to `build/chapters`. |
| `reference/character-sheets`, `reference/scenes-graphics` | Codex reference-library branches (already merged). |

## Quick start

Requires Node **22.12+** (Vite 7) and npm.

```bash
git clone https://github.com/vicciz-ceo/legolas-greenleaf
cd legolas-greenleaf
git checkout build/chapters
npm ci
npm run dev            # http://127.0.0.1:3000
```

Useful URLs on the dev server:

| URL | What |
|---|---|
| `/` | Title screen, then chapter select |
| `/?chapter=<id>&cp=<n>` | Jump straight into a chapter checkpoint |
| `&quality=low\|medium\|high\|ultra` | Quality preset |
| `&skipIntro=1 &god=1 &bot=1 &touch=1` | Debug flags. Available in dev builds, or in a production build with `&debug=1` |
| `/lab/` | **Creature Lab**: every character, creature, weapon and prop (`?subject=<name>&view=orbit\|quad\|sheet&anim=<a>&t=<s>`) |
| `/lab/env.html?env=<name>&q=high` | Environment and lighting showcase |
| `/lab/ui.html?screen=hud\|title\|chapters\|…` | HUD and menu harness |
| `/lab/audio.html?view=ui` | Audio playground (listen to every SFX, loop and music mood) |
| `/src/world/tools/view.html` | World vignettes under real environments |

Chapter ids, in story order: `mirkwood`, `barrels`, `laketown`, `ravenhill`, `moria`, `amon_hen`, `helms_deep`, `pelennor`, `black_gate`. The dev test arena is `arena`.

## Checks

```bash
npm run typecheck
npm run build
node src/physics/run-tests.mjs      # physics 61, combat 54, shell 208, finishing 36: all must pass
```

Headless snapshots and the smoke test need Chromium:

```bash
npx playwright@1.56.1 install chromium   # once (or point SNAP_CHROME=/path/to/chrome)
SNAP_GPU=1 npm run smoke                  # every chapter and checkpoint: bot plus god mode for 20 s; fails on any console/page error
SNAP_GPU=1 npm run smoke -- --only helms_deep
SNAP_GPU=1 node scripts/snap.mjs "/?chapter=moria&cp=1&quality=high&skipIntro=1&god=1&bot=1" --advance 8 --out shots/moria.png
```

`SNAP_GPU=1` renders on your GPU. Without it, the tools use SwiftShader software rendering, like the cloud did: it's deterministic but slow (loads took 45–220 s per checkpoint on the cloud box). `shots/` is gitignored.

The parallax-threejs debug harness is scaffolded (`deno.json` tasks such as `checkpoint`, `sweep` and `visual:run`, plus `.mcp.json`). Its three.js-devtools MCP expects the dev server on port 3000.

## Status per chapter

| # | Chapter | Built + independent QA + fixes | Finisher pass (art vs refs + move to shared APIs) | Last verified |
|---|---|---|---|---|
| 1 | `mirkwood` | ✅ | ⚠️ interrupted part-way (edits committed) | smoke ✅ (handoff run) |
| 2 | `barrels` | ✅ | ⏳ not started (an earlier interrupted art pass left partial edits) | smoke ✅ (11 Oct baseline, before shared fixes) |
| 3 | `laketown` | ✅ | ⚠️ interrupted part-way (edits committed) | smoke ✅ (handoff run) |
| 4 | `ravenhill` | ✅ | ⚠️ marked done, rejected on visual review (no vista, floating rocks, cartoon stone) | smoke 4/4, bot reaches complete (11 Oct) |
| 5 | `moria` | ✅ | ⏳ not started (partial art edits from earlier) | smoke 3/3 after shared fixes |
| 6 | `amon_hen` | ✅ | ⚠️ interrupted part-way (edits committed) | smoke ✅ (handoff run) |
| 7 | `helms_deep` | ✅ | ⚠️ interrupted part-way (edits committed) | smoke ✅ (handoff run) |
| 8 | `pelennor` | ✅ | ⚠️ marked done; visuals not re-reviewed against the refs | smoke 3/3, bot reaches complete at Low and High (11 Oct) |
| 9 | `black_gate` | ✅ | ⏳ not started | smoke 3/3 after shared fixes |

The "interrupted" finishers stopped mid-task when the session ended. Their edits typecheck and the unit tests pass, but their art passes and migrations may be incomplete.

## What's left

1. **Finish the 4 interrupted chapters** (`mirkwood`, `laketown`, `amon_hen`, `helms_deep`). Their smoke already passes (13/13 at handoff). Still to do: a bot play-through to `complete` (`/?chapter=<id>&cp=0&bot=1&god=1&quality=low&skipIntro=1`), then finish their art pass and migration with FINISHER_PROMPT.md.
2. **Run the finisher on `barrels`, `moria`, `black_gate`**, using `docs/handoff/FINISHER_PROMPT.md`.
3. **Final review**, using `docs/handoff/FINAL_REVIEW_PROMPT.md`: full smoke, build and tests, a campaign play-through, a review across several angles, fixes.
4. **Play it yourself.** Difficulty and pacing were tuned with a bot (often in god mode), the audio mix has only been checked numerically (no human has listened), and all perf numbers come from software rendering. A real-GPU, human pass is the most valuable thing left.
5. **Merge** `build/chapters` → `main` (squash) once everything is green.

## Known gaps

These are pooled from the agents' reports. Most are polish, not blockers.

- **Look:** the cast is stylised-realistic, not photoreal. Rank-and-file faces are coarse, and crowds look toy-like up close (built to be seen from 40 m and beyond). Minas Tirith is a blocky silhouette. Tree crowns let sky "confetti" through at some angles; a crown density option exists.
- **Perf:** the triangle margin at High is tight in some beats (≈1.4 M against a 1.5 M budget). Real GPU frame times and load times are unmeasured. Hero characters are meshed in a worker pool during loading; creatures can be too, via `ChapterDef.preloadCreatures`.
- **Gameplay:** the camera boom pulls in close against walls (the body fades out, but there is no shoulder swap). Lake-town beats can be skipped by sprinting. Helm's Deep keeps its local fixes for the `helmsDeep()` builder (inner battlements, tower placement).
- **UI:** the HUD is not scaled up on 1080p+ screens. On phone portrait, the worst-case toast stack touches the crosshair.
- **Repo size:** `docs/refs/` (the reference library) is about 180 MB. Consider Git LFS if cloning is slow.

## Where to read

| File | What |
|---|---|
| `GOAL.md` | Product spec and acceptance criteria |
| `ARCHITECTURE.md` | Module map, ownership, visual standard, tuning decisions |
| `docs/CHAPTER_AUTHORING.md` | Practical handbook: LevelAPI, world API, creature kit, mover recipes, §13 finishing-pass APIs |
| `docs/CHAPTERS.md` | Per-chapter design brief |
| `src/core/types.ts` | The contract |
| `src/creatures/kit/README.md`, `src/creatures/humanoid/KINDS.md` | Creature kit and character kinds |
| `docs/refs/README.md`, `docs/refs/INDEX-scenes-graphics.md` | Reference library (characters, scenes, UI, VFX, materials) |
| `docs/handoff/` | Prompts and status for continuing |
