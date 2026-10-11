# Greenleaf — agent instructions

- Product spec: `GOAL.md`. Architecture, ownership, visual standard and rules: `ARCHITECTURE.md`. Contract: `src/core/types.ts`.
- Everything is built in code — no asset files, no runtime network fetches.
- Check visual work with `node scripts/snap.mjs "<url>" --out shots/x.png` and read the PNG; inspect creatures in the Creature Lab (`/lab/`).
- Before pushing: `npm run build` and `npm run smoke` must pass.
- Continuing from the cloud build: start with `HANDOFF.md` and `docs/handoff/`.
- Handed off to Codex on 2026-10-11: see `AGENTS.md` and `docs/handoff/CODEX_HANDOFF.md` (current state, open work, lessons).
