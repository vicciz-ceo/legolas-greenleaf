# Greenleaf character reference sheets

**Status: blocked; no reference sheets are certified or included.** This is a documentation-only record of an unsuccessful generation and validation pass, not a completed reference library. Do not use it as evidence that any character has an approved visual reference.

These references are intended solely for development. The game continues to generate its meshes, textures and audio in code. This branch was created from `origin/build/foundation` at `7ab3afd`; its changes are confined to new files in `docs/refs/`.

The requested local branch is `refs/character-sheets`. GitHub rejected that remote branch name with `GH014` because names beginning with `refs/` are forbidden. The remote branch used for the draft PR is therefore `reference/character-sheets`.

The required context was read: `GOAL.md`, `ARCHITECTURE.md` (including §4 and the scale list), and `docs/CHAPTERS.md`. Original character designs were requested throughout, with explicit exclusion of actor likenesses and copied film frames.

Thirteen image candidates were generated and reviewed, including targeted regenerations. None passed the complete applicable quality gate. They are excluded from this branch, in accordance with the instruction not to keep flawed sheets. See [the quality report](QUALITY_REPORT.md) for observed failures and measurement evidence.

No `spec.json` files are included: proposed measurements must not be presented as measurements verified against images. No per-character modelling notes, coded-model comparisons, material palettes or approved thumbnails are included.

## Roster coverage

An em dash indicates an absent deliverable, rather than a link to a nonexistent file. Heights and spans below are the requested design targets, not measurements of accepted images.

| ID | Requested height or span | Thumbnail | Spec | Notes | Result |
| --- | --- | --- | --- | --- | --- |
| legolas | 1.85 m | — | — | — | 5 turnaround, 3 face and 1 details candidates rejected |
| gimli | 1.37 m | — | — | — | 2 turnaround candidates rejected |
| aragorn | 1.88 m | — | — | — | Not attempted after generation method failed validation |
| tauriel | 1.78 m | — | — | — | Not attempted |
| thranduil | 1.90 m | — | — | — | Not attempted |
| elf_mirkwood | 1.85 m | — | — | — | Not attempted |
| elf_galadhrim | 1.85 m | — | — | — | Not attempted |
| boromir | 1.85 m | — | — | — | Not attempted |
| gondor | 1.82 m | — | — | — | Not attempted |
| rohirrim | 1.80 m | — | — | — | Not attempted |
| laketown_man | 1.75 m | — | — | — | Not attempted |
| dwarf_company | 1.30–1.40 m; four distinct dwarves | — | — | — | All four variants not attempted |
| orc | 1.70 m | — | — | — | Base sheets and extra four-variant sheet not attempted |
| goblin | 1.48 m | — | — | — | Not attempted |
| gundabad | 2.10 m | — | — | — | Not attempted |
| uruk | 2.00 m | — | — | — | Not attempted |
| berserker | 2.10 m | — | — | — | Not attempted |
| lurtz | 2.10 m | — | — | — | Not attempted |
| bolg | 2.60 m | — | — | — | Not attempted |
| easterling | 1.80 m | — | — | — | Not attempted |
| haradrim | 1.80 m | — | — | — | Not attempted |
| cave_troll | 4.50 m | — | — | — | Not attempted |
| war_troll | 4.50 m | — | — | — | Not attempted |
| mirkwood_spider | 2.5–3 m leg span; approximately 1.2 m body height | — | — | — | Not attempted |
| brood_mother | 6 m leg span | — | — | — | Not attempted |
| mumak | Approximately 14 m at shoulder | — | — | — | Base sheets and howdah close-up not attempted |
| gundabad_bat | 6–8 m wingspan | — | — | — | Spread and folded wings not attempted |
| great_eagle | Approximately 10 m wingspan | — | — | — | 1 flight silhouette candidate rejected |
| fell_beast | Approximately 12 m wingspan | — | — | — | 1 flight silhouette candidate rejected |
| weapons | True-scale lineup; individual dimensions required | — | — | — | All 14 requested gear categories not attempted |

## Requirements for a future accepted set

Each humanoid needs a four-view 1536×1024 turnaround, a three-view 1536×1024 face sheet, a labelled 1024×1024 material grid, its image-verified `spec.json`, and 5–10 modelling notes. Creature views and the two distant silhouette exceptions follow the original brief. Orc variants, the mûmak howdah and the weapons lineup remain required.

Before accepting any image, check actual PNG dimensions, projected anatomy and gear consistency, ruler calibration and anatomical endpoints, five-digit hands where applicable, original faces, neutral studio presentation, and readability at 64 px. Sample material colours and retain the sampling locations when writing the spec. Do not infer calibrated body or weapon dimensions merely because the image contains the requested number as text.

The optional Node/Chromium comparison was skipped because there was no accepted reference against which to compare the coded model.
