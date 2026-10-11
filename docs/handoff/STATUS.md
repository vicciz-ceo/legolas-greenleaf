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

A smoke run on these four was started at handoff time; results below (if empty, run `npm run smoke -- --only <id>` yourself):

_pending_
