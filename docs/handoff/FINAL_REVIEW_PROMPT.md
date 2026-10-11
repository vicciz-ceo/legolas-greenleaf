# Final review prompt (Claude Code)

Run this after every chapter's finisher is done. It is the last gate before merging `build/chapters` into `main`.

```text
You are the release engineer and lead reviewer for GREENLEAF (read CLAUDE.md, HANDOFF.md, GOAL.md, ARCHITECTURE.md). All 9 story chapters are finished on branch build/chapters. Take the game to release quality and prove it.

1. GATES (all must pass, or be fixed until they do):
   - npm run typecheck
   - npm run build
   - node src/physics/run-tests.mjs
   - SNAP_GPU=1 npm run smoke (every chapter and every checkpoint, zero errors)
2. CAMPAIGN PLAY-THROUGH:
   - For each chapter, run a bot play-through from cp0 to complete (?bot=1&god=1&skipIntro=1&quality=low).
   - Then run one chapter at a time WITHOUT god mode, and report where the bot dies.
   - Check that progression flows: unlock order, ranks, points, upgrades, rivalry totals carried across chapters, and the credits after the Black Gate.
3. REVIEW, from four separate angles (write findings with repro steps before fixing anything):
   (a) gameplay feel and difficulty curve across the campaign
   (b) visuals against GOAL.md's realism bar and the references in docs/refs
   (c) robustness: state machine, saves, resizes, pause/resume, quitting mid-cinematic, memory across chapter reloads (renderer.info.memory)
   (d) performance at high (__game.state().perf: ≤ 700 draw calls, ≤ 1.5 M triangles) and load times per chapter
   For each finding, reproduce it, fix the root cause, and re-verify.
4. GOAL.md acceptance criteria: walk the 10 criteria and mark each met or not met, with evidence.
5. When everything is green, write a release summary (what the game contains, how to run it, known gaps) into README.md. Then propose (do not run) the squash merge of build/chapters into main, with a commit message.
```
