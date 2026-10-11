# GREENLEAF — instructions for coding agents (Codex)

A 3D third-person Legolas action game in Vite + TypeScript (strict) + three.js 0.185.1, where **every**
mesh, texture and sound is generated in code. Start with **`docs/handoff/CODEX_HANDOFF.md`**. It covers the current
state, what is broken and why, where the code's limits are, and a plan with owner checkpoints.

## Read before changing anything
- `docs/handoff/CODEX_HANDOFF.md`: state, open work, lessons, the reference → code maps (§8)
- `GOAL.md`: product spec and the 10 acceptance criteria
- `ARCHITECTURE.md`: hard rules (§1, but see "Where older docs disagree" below), the visual standard and budgets (§4)
- `docs/CHAPTER_AUTHORING.md`: LevelAPI, world builders, creature kit, budgets (§10), pitfalls (§12), finishing-pass APIs (§13), shared rendering pass preset fields `fogHeight`/`fogFloor`/`nightFloor`/`groundShade` (§14)
- `src/core/types.ts`: the contract. Do not change the meaning of existing members; add optional ones.
- `src/creatures/humanoid/KINDS.md`, `src/creatures/kit/README.md`: how characters are built
- `docs/refs/`: the reference library (character sheets with calibration data in `spec.json`, scenes, materials, props). It is the visual target.

## Hard rules
- Work on branch **`build/chapters`**. Commit with clear messages; pushing `build/chapters` after the gates pass is fine.
  **Never push or merge to `main`** without the repo owner's explicit OK. The `art/*` branches stay local unless the owner asks.
- Everything is built in code: no image, model, audio or font files, no runtime network fetches. Do not add npm
  dependencies without asking the owner.
- **`docs/refs/` is read-only.** It is at its size caps and has validation records. Keep every screenshot and
  comparison image under `shots/` (gitignored).
- TypeScript strict, zero type errors.
- Use deterministic randomness from `src/core/rng.ts` for anything that shapes a level.
- No per-frame allocations in hot paths. Dispose GPU resources.
- Check three r185 APIs in `node_modules/three` instead of guessing (`PCFSoftShadowMap` is deprecated; use `PCFShadowMap`).
- Budgets at High (`__game.state().perf`, which sums the shadow, scene and GTAO passes): **≤ 700 draw calls, ≤ 1.5 M
  triangles** per beat. Fire lights only through `fx.fire` / `fx.torch`.
- Keep the repo-local git `user.email` (the owner's GitHub no-reply address). GitHub rejects pushes that expose the
  private address. Never rewrite pushed history.
- **Owner checkpoints: stop and ask in chat** (details in CODEX_HANDOFF §7):
  - after the first character (Legolas) reaches the bar;
  - before replacing the SDF character pipeline for any character, or adding a dependency;
  - before any merge to `main`.

## Where older docs disagree, this file wins
Most of the older docs were written for parallel Claude Code subagents.
- **Committing:** you DO commit, on `build/chapters`. "Do not commit" in ARCHITECTURE.md §1.5 is obsolete.
- **Shared code:** you own the whole repo. "Stay in your files" / "never edit the humanoid base files" (ARCHITECTURE §1.3 and §3, KINDS.md, FINISHER_PROMPT.md) is obsolete. Guardrails instead:
  - put kit and humanoid-base upgrades behind **opt-in** KindDef or builder options, so the other ~30 kinds keep their geometry until each one is migrated and checked;
  - after any change under `src/creatures/kit/`, `src/creatures/humanoid/*.ts` or `src/world/`, run the checks in CODEX_HANDOFF §4.6. **The unit tests do not cover the creature kit or the world builders.**
- **Snapshots:** every render, snap and smoke goes through `scripts/gpu-queue.sh`. "SwiftShader, parallel runs are safe" (ARCHITECTURE §2) and "one at a time" (CHAPTER_AUTHORING §11) are obsolete.
- **Paths:** the repo root is `/Users/nerya/legolas-greenleaf`. Read every `/home/user/legolas-greenleaf` path in older docs as that.
- **Scene notes:** each `docs/refs/scenes/*/notes.md` "Gaps vs current", plus `current_coded.jpg` and `current_vignette.jpg`, describe a base from before the chapters existed. Ignore them.
- **Lighting and layout:** `lighting.json` is a target look, not a delta to apply. `layout.json` is advisory: keep checkpoint positions, routes and bot hints.
- **"Done" markers:** a "✅ done" art status in HANDOFF.md or STATUS.md means an agent liked its own screenshot. Re-verify against `docs/refs/`.

## Commands
```bash
npm run dev                         # http://127.0.0.1:3000  (/?chapter=<id>&cp=<n>&skipIntro=1&god=1&bot=1, /lab/)
npm run typecheck
npm run build
node src/physics/run-tests.mjs      # 359 unit tests, all must pass
```
`node_modules` and Playwright's Chromium are already installed. Do **not** run `npm ci` unless `package-lock.json`
changed and you have network, because it deletes `node_modules` first. On a fresh machine:
`npm ci && npx playwright@1.56.1 install chromium`.

Headless visuals and smoke run on the real GPU through the queue: at most 2 renders at once on this 8 GB Mac. The queue sets `SNAP_GPU=1`.
```bash
export GPU_QUEUE_DIR=/tmp/greenleaf-gpu-queue              # same 2 slots for every session on this Mac
scripts/gpu-queue.sh node scripts/snap.mjs "<path?query>" --timeout 180000 [--advance s] [--size WxH] [--pre js] [--eval js] --out shots/x.png
scripts/gpu-queue.sh npm run smoke -- --only <chapter>     # every checkpoint (or --cp N); fails on any page/console error
scripts/gpu-queue.sh npm run smoke                         # all 33 checkpoints (29 story + 4 arena), ~35-40 min
```
- The snap and smoke tools start a Vite server on 127.0.0.1 and launch Chromium on the GPU. If your sandbox blocks that, ask for an unsandboxed run. Don't fall back to SwiftShader.
- Never pass `--jobs > 1` to smoke.
- Open every PNG you produce and look at it. A smoke run passes on a black screen.
- Characters: `/lab/?subject=<lab subject>&view=turn&anim=idle&t=0.5&bg=7f7f7f&ground=0` at `--size 1536x1024` renders the
  four angles of `docs/refs/<ref>/<ref>_turnaround.jpg` in the same order. **It is not to scale yet**, and the pose differs from the sheet (CODEX_HANDOFF §4.3).
  Lab subject ↔ reference map: CODEX_HANDOFF §8.1.
- Recipes for the bot play-through, per-checkpoint performance, materials (no GPU) and post-change checks: CODEX_HANDOFF §4.4–§4.6.

## Before you push
Run `npm run typecheck` and `node src/physics/run-tests.mjs`. Run the smoke for every chapter you touched (the full smoke if you changed shared code), plus the §4.6 checks for character or world code. Look at the screenshots you took. Then append results to `docs/handoff/STATUS.md`.
