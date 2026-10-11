# Chapter finisher prompt (Claude Code)

> **Note for Codex (2026-10-11 handoff):** written for Claude Code subagents before the handoff. Read `AGENTS.md` first: every render goes through `scripts/gpu-queue.sh`, shared code is no longer off-limits (see the AGENTS.md guardrails), you do commit on `build/chapters`, and Ravenhill and Pelennor are **not** done visually (`docs/handoff/CODEX_HANDOFF.md` §5.2, §6). The per-chapter technical notes (APIs to migrate to) are still valid.

Paste the block below into Claude Code at the repo root, once per chapter. Replace `<N>`, `<id>` and `<file>`, and add that chapter's notes from the table at the bottom.
Tip: one chapter per session (or per subagent) keeps context small. On a desktop, use `SNAP_GPU=1` for the snapshot and smoke tools.

```text
You are a senior game developer and technical art director on GREENLEAF, a 3D third-person Legolas action game (Vite + TypeScript strict + three 0.185.1) where everything is generated in code. Read CLAUDE.md, HANDOFF.md, ARCHITECTURE.md §4 and docs/CHAPTER_AUTHORING.md (especially §13, "finishing pass APIs").

ROLE: finisher for Chapter <N> (id '<id>'). You own src/game/chapters/<file> and src/game/chapters/<id>/** (plus that chapter's creature files, if any). Do not edit shared code or other chapters; if shared code blocks you, work around it locally and tell me.

The chapter is built, QA'd and fixed. Do three things, in order:

1. FINISH THE ART PASS against docs/refs/scenes/<id>/:
   - Read establishing.jpg, gameplay_view.jpg, gameplay_look.jpg, beats.png, frames/, the set-piece close-ups, current_coded.jpg, lighting.json (EnvironmentPreset-shaped design targets with changes_vs_current), palette.png, layout.json, and notes.md with its "Gaps vs current".
   - If an earlier pass left partial edits, see them with `git log -p -- src/game/chapters/<file> src/game/chapters/<id>/`. Keep what is good and complete the job.
   - Apply the lighting key through the chapter's own environment preset copy, then fix the notes' gaps in impact order: landmark visibility from the gameplay camera, set dressing, material tints, fog layering, fire/light placement, skyline, palette harmony.
   - Budget at high: ≤ 700 draw calls and ≤ 1.5 M triangles (__game.state().perf).
2. MIGRATE TO THE SHARED APIs (CHAPTER_AUTHORING §13) wherever they replace a local workaround in this chapter. Delete the dead workaround code and keep the behaviour identical or better. If a migration is risky or brings no benefit, keep the workaround and say why.
3. VERIFY:
   - npx tsc --noEmit -p . is clean.
   - npm run smoke -- --only <id> passes every checkpoint.
   - A bot play-through from cp0 reaches state().mode === 'complete': load /?chapter=<id>&cp=0&bot=1&god=1&quality=low&skipIntro=1 and advance in 30 s chunks, e.g. node scripts/snap.mjs "<url>" --advance 300 --eval "JSON.stringify(window.__game.state())".
   - Take before/after snaps of each beat at medium, 1280x720, with node scripts/snap.mjs. Read them, and iterate until the after shots are clearly closer to the references.

Report the before/after screenshot paths, what you migrated, and the perf numbers.
```

## Per-chapter notes

| Chapter | State | Notes to add to the prompt |
|---|---|---|
| 1 `mirkwood` (`c1_mirkwood.ts`) | finisher interrupted | Web-spit slow via `player.addModifier?.({id:'web', moveSpeedMul:0.5, duration:2})` (the old stats hack gets wiped every second). Replace the local `softShaft` with the fixed `lightShaft` if it looks as good. Spiders via `preloadCreatures` + `premeshCreatures`. |
| 2 `barrels` (`c2_barrels.ts`) | not started | Replace the local waypoint follower in `barrels/orcs.ts` with `moveTarget` + `moveArrived` if behaviour stays as good: orcs must still reach the walkway in about 6 s, and the saboteur must still reach the lever. |
| 3 `laketown` (`c3_laketown.ts`) | finisher interrupted | Spawn Bolg via `EnemySpec.kind: 'bolg'` and delete the body swap in `laketown/bolg.ts`. Check that faces are lit in cinematics (character light is on by default; tune with `level.characterLight`). The night chimney `fx.smoke` plumes read as near-black puffs: make them lighter or fewer. |
| 5 `moria` (`c5_moria.ts`) | not started | Use `fx.fire(..., {smoke: 0..0.3})` for wall torches instead of the flame-mesh-only hack where it looks better. Consider `'dwarven_stone_weathered'` instead of the local regraded material. Verify the cp2 bot no longer dawdles (shared bot fix). |
| 6 `amon_hen` (`c6_amon_hen.ts`) | finisher interrupted | Canopy sky confetti: try the forest `crown: {density: 1.4–1.8}` (plus `alphaToCoverage` at high), and bring the woods and ruins beats under 1.5 M triangles at high (they were 1.64 M and 1.53 M). Check that rivalry banter no longer plays over the Lurtz finisher. |
| 7 `helms_deep` (`c7_helms_deep.ts`) | finisher interrupted | Use `rivalry.chapterCounts?()` instead of the `progression.rivalryBaseline` arithmetic. Keep the local `fixWalls`/`fixTowers` builder workarounds. Check whether the cp1 torch-runner beat still needs the 7-runner cap now that the bot leads its targets. |
| 9 `black_gate` (`c9_black_gate.ts`) | not started | Crowds are now auto-culled with real bounding spheres: simplify the local `cullStanding` if it is redundant. Move eagles and fell beasts to `preloadCreatures` with `premeshCreatures` (they currently mesh synchronously, 1–2 s each). Check that the final campaign tally uses the rivalry totals. |
| 4 `ravenhill`, 8 `pelennor` | ✅ done | — |
