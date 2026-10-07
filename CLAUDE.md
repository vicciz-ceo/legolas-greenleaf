# Greenleaf — agent instructions

- Product spec: `GOAL.md`. Architecture, ownership, visual standard and rules: `ARCHITECTURE.md`. Contract: `src/core/types.ts`.
- Everything is built in code — no asset files, no runtime network fetches.
- Check visual work with `node scripts/snap.mjs "<url>" --out shots/x.png` and read the PNG; inspect creatures in the Creature Lab (`/lab/`).
- Before pushing: `npm run build` and `npm run smoke` must pass.
