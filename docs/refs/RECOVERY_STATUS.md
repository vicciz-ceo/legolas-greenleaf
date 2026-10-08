# Character-sheet recovery — current continuation, 2026-10-08

Latest fetched draft head at recovery start: `5107b510cf78c4bf6d5cfb91112f984642666321`, branch `reference/character-sheets`, base `build/foundation`, [draft PR #1](https://github.com/vicciz-ceo/legolas-greenleaf/pull/1). Worktree: `/workspace/greenleaf-refs`; the original checkout is preserved.

The previous version described the earlier `47ceb55` recovery. Its branch inventory and six-test result are historical. Current delivery state is recorded in progress.json, CHECKLIST.md, QUALITY_REPORT.md and validation/.

## Durable inventory verified

- 22 accepted character sets are retained, including all creature/flight sets, and preserved without reopening their images.
- All 14 weapon sources, including accepted pike and torch, match provenance hashes. Both weapons.png and weapons.jpg are retained.
- All four orc sources and the required orc_variants.png comparison are retained with matching hashes.
- The separate mûmak howdah supplement is retained.
- Initial reconstruction checks passed for these 25 entries. Initial 20 regression tests passed; current tests include separate recovery-series coverage.
- Bald dwarf has two historical accepted view records, but neither original nor optimized source was retained in the fetched Git tree.

## Bounded lost-file search

One search covered accessible worktrees, workspace generated-image directories, image/archive files, the saved manifest paths and Git history for Legolas, Gimli, Aragorn, Tauriel, Bolg, cave troll and bald dwarf. No historical image bytes were available. Git history retained specifications and notes only. No old chats or image history were retrieved. validation/source-audit.json records the initial inventory of 246 verified retained sources.

Lost files are eligible for newly authored replacements, not a permanent blocker. Progress schema version 2 preserves every original attempt and acceptance record, and identifies replacement calls in a separate recovery series capped at four attempts per required view. Provenance must distinguish newly authored assets from recovered originals. Tool failures and exhausted visual attempts must be reported honestly.

Gimli rear must show loose wavy red-brown back hair without misplaced beard braids. Cave troll must have complete hands, club and feet with opaque lower-body coverage. All other design and attachment rules remain in the revised brief.

## Execution and storage

The text-only supervisor owns progress, composition, validation and Git. Short-lived image workers use fresh contexts and at most two generation/edit calls each, saving originals, optimized sources, provenance and text receipts before handoff. Receipts live outside the library at /workspace/greenleaf-receipts/.

Initial retained size: 46,905,585 bytes. Reserve approximately 20,000,000 bytes for ten full sets (target 2,000,000 each), 1,000,000 for reused-source dwarf comparison, and remaining headroom for documentation/validation. Hard caps remain 2,500,000 per set and 70,000,000 overall. Retain all reconstruction sources and count all retained files.

Continue through character checkpoints and the same draft PR. Exact remaining deliverables and review/tool blockers are in the ledger; this document does not certify incomplete sets.
