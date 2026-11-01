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

---

# Cloud session, 2026-11-01 (branch `claude/fervent-archimedes-2puz7y`)

Based on `build/chapters` at `0ffa041`, and not merged into `build/chapters` or `main`.

The owner asked for three things:
- fix mouse look, since the aim indicator only moved while the left button was held;
- make the gameplay better;
- give every character the refinement Legolas got, with the work run in parallel.

How the work was run:
- One orchestrator ran one agent per character group, each in its own worktree.
- After every pass, an independent review panel looked at silhouette, surface, identity and code, then decided whether to merge.
- A regression means further from the sheet than before, not just different from the previous pass.
- Only the orchestrator merged.

The method is written up in `src/creatures/humanoid/KINDS.md` ("Refining a kind against its reference sheet").

## Gates on the final tree (`6155829`)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `node src/physics/run-tests.mjs` | ✅ 13 suites, 0 failed: physics 61, combat 67, shell 216, finishing 36, player 27, weapons 117, stance 38,089, carry 47,075, attack 1,348, mesher 57, input 43, victory 28, boromir 13 |
| `npm run build` | ✅ |
| `npm run smoke` (cloud, SwiftShader; no GPU here) | ✅ 33/33 checkpoints, 0 errors, all ten chapters including the arena (`--jobs 3` on `6155829`) |

The new suites cover:
- `stance`: knee caps, every kind, height, LOD and gait;
- `carry`: the idle weapon and shield holds on the real kinds and props, the special-pose, landing and run blends, and prop clearance;
- `attack`: hand-frame continuity through every attack;
- `input`: mouse look and edge turning;
- `victory`: no pause during the victory beat;
- `boromir`: captain look and seed buckets.

The `mesher` suite gained a test for the old hole bug.

## Input and gameplay

- **Mouse look without buttons** (`94ada1d`).
  - Mouse movement turns the camera, with or without pointer lock.
  - With the pointer unlocked, a cursor parked at the canvas edge keeps turning the view. That edge turning applies to keyboard and mouse only (`e7a54b9`).
  - The cursor is hidden over the canvas during play.
- **Keyboard and mouse audit** (`021ed7b`, `c9b90bb`, `7d74f75`, `14bdc41`, follow-ups `d747e7a`), adversarially verified:
  - Pointer re-grab after Esc.
  - Wheel normalised, one step per gesture; wheel up selects the previous arrow.
  - Dash moved off Ctrl, with a 0.15 s buffer.
  - Pause on blur, but not during the victory beat (`e7a54b9`). The results screen also cuts input.
  - A standard-mapping gamepad is preferred.
  - Camera:
    - shake envelope;
    - capped hand-back glide;
    - eased exits.
  - Movement and bow:
    - sprint in any direction except backward, latched through jumps;
    - head-first aim assist;
    - draw cancel;
    - nock buffering.
  - Knife multi-hit.
  - Focus buffering, with credit counted per volley arrow.
  - Arrows absorbed by i-frames show no blood.
- **Amon Hen Boromir** is built from the captain spec. Before this he had seed 11, which is a soldier bucket.

## Creature Lab tooling

- **Calibrated turnaround:** `view=turn&ref=<sheet id>` draws a turnaround at the sheet's own scale. `scripts/sheet-compare.py` prints silhouette IoU and widths per view.
- **Sheet pose:** `anim=sheet` (honours `crouch` and `lean`).
- **Head-bone portraits:** `view=single&focus=head&portrait=1&zoom=0.15`.
- **Visible-triangle count:** `__lab.tris`.

## Characters: every humanoid against its sheet

Measured with the calibrated idle compare, in the game's idle pose with the gameplay weapon:
- **Before** is `0ffa041` plus only the compare tool.
- **Final** is this branch.

The sheets are relaxed A-poses, so about 0.8 is the practical ceiling. A hanging blade where the sheet is unarmed costs a few points; this explains the flat Lake-town man.

Mean IoU over 25 characters: **0.561 → 0.667**. Legolas was the reference, refined before this session.

| Character | Before (front/¾/side/back) | Final | Δ mean |
|---|---|---|---|
| legolas | — | .62/.64/.60/.60 | — |
| tauriel | .63/.65/.63/.64 | .62/.67/.64/.64 | +0.00 |
| thranduil | .65/.66/.68/.64 | .70/.74/.71/.72 | +0.06 |
| elf_galadhrim | .72/.72/.63/.72 | .72/.75/.65/.70 | +0.01 |
| elf_mirkwood | .67/.65/.22/.67 | .66/.68/.73/.68 | +0.13 |
| aragorn | .64/.67/.69/.66 | .67/.74/.75/.67 | +0.04 |
| boromir | .67/.61/.64/.65 | .80/.75/.79/.79 | +0.14 |
| gondor | .52/.62/.53/.51 | .69/.70/.70/.66 | +0.15 |
| rohirrim | .49/.69/.57/.53 | .61/.70/.60/.61 | +0.06 |
| laketown_man | .60/.66/.66/.60 | .58/.71/.67/.57 | +0.00 |
| gimli | .47/.54/.52/.47 | .71/.75/.70/.71 | +0.22 |
| dwarf_bald | .51/.58/.62/.51 | .68/.71/.71/.67 | +0.13 |
| dwarf_hat | .51/.59/.59/.51 | .64/.69/.66/.65 | +0.11 |
| dwarf_elder | .61/.66/.63/.60 | .70/.73/.76/.70 | +0.10 |
| dwarf_redbeard | .53/.61/.64/.53 | .66/.69/.71/.64 | +0.09 |
| lurtz | .61/.60/.67/.59 | .71/.66/.61/.70 | +0.06 |
| bolg | .59/.61/.65/.60 | .68/.70/.76/.70 | +0.10 |
| uruk | .46/.56/.58/.45 | .69/.68/.66/.68 | +0.17 |
| berserker | .54/.58/.14/.53 | .64/.60/.63/.69 | +0.19 |
| orc | .52/.52/.49/.49 | .59/.61/.56/.57 | +0.08 |
| gundabad | .52/.54/.64/.50 | .68/.67/.67/.68 | +0.12 |
| goblin | .33/.36/.31/.34 | .48/.48/.45/.48 | +0.14 |
| easterling | .51/.60/.53/.49 | .69/.64/.63/.65 | +0.12 |
| haradrim | .49/.50/.57/.50 | .71/.69/.72/.72 | +0.19 |
| cave_troll | .51/.52/.53/.51 | .61/.66/.66/.61 | +0.12 |
| war_troll | .44/.41/.55/.43 | .57/.54/.67/.55 | +0.12 |

Every group had 3 to 7 passes, each reviewed. Visible LOD0 triangles stay within budget:
- **Heroes and bosses:** ≤45k. Gimli 43.6k, Thranduil 44.8k, Bolg 44.7k.
- **Trolls:** ≤35k. 29.9–33k.
- **Crowd:** ≤12k, or no worse than before and never above 15k. Exceptions near the line:
  - helmeted orc and Gundabad combos at 12.0–12.2k;
  - Easterling at 12.8k;
  - dwarves at 11.9–12.9k.

## Shared fixes (base)

- **Weapons, five passes.**
  - Every prop is built at the weapons sheet's size. Sizes, grip and tip are asserted in `weapons.test.ts`.
  - Styles: `uruk`, `orc`, `berserker`, `gimli`, `elven`, `haradrim`, `rohan`, `gondor`, `dwarf`, `easterling`.
  - Each kind scales its props with `scaleHeldWeapon`. The scales are mirrored in `carry.test.ts` `KIND_SCALE`.
- **Stance.**
  - Standing knee flex is capped at 40° (`stanceDrop`).
  - `anim.crouch` (raises the cap to 100°), `anim.lean` and `anim.stance` (foot width) give the goblin its squat and the orc its lean.
- **Mesher.** `kit/mesher.ts` `evalBlock` no longer seeds a Lipschitz skip from a neighbour-cached sample. That bug left leg holes at some heights.
- **Idle carry.**
  - Blades, axes, maces and clubs hang point-down, tilting only to clear the ground.
  - Spears, pikes and torches stand upright.
  - Shields rest on the bent forearm with the face turned 40° to the front-left, as on the sheets, so the emblems read from the front. The crouched goblin keeps a face-out hold.
  - Run, attack, special-pose, death and landing blends turn the hands rather than lerping them, with no flips.
  - The landing re-solves blade clearance.
- **Attack frames.** Swing-and-twist interpolation between keys; the worst per-step turn dropped from 75–180° to under 9°. The thrust blade points forward. Strike keys and hit timing are unchanged.
- **`KindDef.bucketDetail`** (Gondor captain).

## Known gaps and follow-ups

- **Shared skin material.** It renders pale or pinkish; the kinds compensate in albedo.
- **KindDef overrides.** There are no per-bucket overrides (outfit, build, skin), so variant kinds work around them.
- **Helmets.** There is no hair-under-helmet mode in `buildHair`.
- **Bolg's kilt.** It needs a different length per strip.
- **Lurtz's mane.** It needs a kit hair style.
- **Aragorn and Boromir scabbards.** The length needs a sword-length option in `createWeapon`.
- **Boromir's sheet** is empty-handed with a sheathed sword. In gameplay he fights with sword and shield (`loadout.ts`); that is a design call.
- **Lake-town man.** He carries a crowd-loadout sword; the sheet is unarmed.
- **Goblin special poses.** Some special poses (ride, swing, sit) keep the style's head counter-pitch after overwriting the torso; deciding which should keep it is a design call.
- **Gundabad shield.** A Gundabad with a shield (12% of them) clips the shield into its body.
- **War troll.** Its legs are still shorter than the sheet's. One kind height serves both troll looks.
- **Non-humanoid creatures** (spider, mûmak, bat, eagle, fell beast) were not part of this pass.
- **GPU smoke.** A real-GPU smoke (`SNAP_GPU=1 npm run smoke`) has not been run on this branch.
