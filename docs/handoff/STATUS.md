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
