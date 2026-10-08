# Character-sheet recovery — 2026-10-08

Source: **Create Greenleaf character sheets**, chat `01a11a67-ad85-74c3-a837-4e2921fbf042`, failed continuation turn `01a11a85-22a1-70a6-b5bc-e76a42b2af20`.

The continuation failed during image-history compaction. Its completed image-generation calls remain recorded. The failure did not cancel those earlier completed calls. This audit distinguishes recorded generation completion, recorded visual acceptance, and files actually available in this new workspace.

## What finished in the old session

- The revised compositor and six synthetic tests were completed. The last test run passed all six tests.
- Legolas's turnaround, face and material sheets were composed and reported as visually accepted. The final construction check passed at **2,317,607 bytes**, with **295.1351351351351 pixels/metre**. Preserve that accepted set rather than starting it over.
- All six Batch 1 design specs and modelling notes were authored. Five characters besides Legolas still needed final sheet composition and validation.
- The revised pass made **37 image-generation calls: 36 completed, one failed**. These are separate from the earlier 13 rejected candidates described in the existing README and quality report.

## The two requested corrections

| Correction | Recorded call result | Saved output in the old workspace | Next action |
| --- | --- | --- | --- |
| Gimli rear view: remove misplaced beard braids and clasps; show loose wavy red-brown back hair | Completed | `/workspace/generated_images/exec-56a6abc4-7e96-49b5-ad75-d20bed1d9e8a.png` | Inspect a small preview against the accepted front and side; generation completion alone does not prove visual correctness |
| Cave Troll front: wider framing, full hands/club/feet, opaque knee-length cloth kilt | Completed | `/workspace/generated_images/exec-3254d4c6-e0bd-4cda-914f-dd882267caf9.png` | Inspect framing, five fingers and coverage; if accepted, condition the other views on this corrected outfit |

The earlier troll framing call `exec-9ace492e-a014-40cb-9171-0e57f3bacd3d` failed. The opaque-kilt replacement succeeded. Neither corrected output has a subsequent recorded visual review or composition step. Neither image is available in the current workspace, so this recovery has not inspected their pixels.

The session continued after those corrections: Tauriel's back view and Bolg's three-quarter, side and back views all completed. Bolg's back (`exec-ddcdc838-f236-4947-a562-f42e8e7f16b3`) is the last recorded generated output.

## Remaining work, in order

| Character/group | Latest recorded state | Remaining work |
| --- | --- | --- |
| Legolas | Complete, reviewed and checked in old workspace | Restore accepted files and rerun construction check; preserve original full-resolution sources |
| Gimli | Front, three-quarter, side and corrected back generated | Review corrected back; segment and compose body views; generate face views/detail tiles; sample, check and record quality |
| Aragorn | Four body views generated | Review/segment/compose; generate face views/detail tiles; sample and check |
| Tauriel | Four body views generated | Review/segment/compose; generate face views/detail tiles; sample and check |
| Bolg | Four body views generated | Review/segment/compose; generate face views/detail tiles; sample and check |
| Cave Troll | Corrected front generated; rotations not yet generated | Review corrected front; align design notes with accepted kilt; generate the other body views, face views and detail tiles; compose/sample/check |
| Other heroes/allies | No revised-pass images recorded | Thranduil, Mirkwood guard, Galadhrim guard, Boromir, Gondor soldier, Rohirrim, Lake-town man |
| Other enemies | No revised-pass images recorded | Orc, goblin, Gundabad orc, Uruk, berserker, Lurtz, Easterling, Haradrim, War Troll |
| Creatures | No accepted revised-pass images recorded | Mirkwood spider, Brood Mother, mûmak plus howdah, Gundabad bat (spread/folded), eagle and fell-beast flight silhouettes |
| Additional sheets | Not generated in revised pass | True-scale weapons lineup, four orc variants, four distinct company dwarves |
| PR checkpoint | Not reached | Complete Batch 1; update README thumbnails and QUALITY_REPORT with attempt counts/check output; push `reference/character-sheets` and update draft PR #1 into `build/foundation` |

## Files recovered here

The existing draft branch was recovered into `/workspace/greenleaf-character-refs` without modifying the scaffold checkout. Original README and quality report are retained as historical first-pass reports; their statements that the whole roster is unfinished predate the successful revised Legolas set.

Recovered from the recorded file-writing commands and successive patches:

- `tools/compose.py`, `tools/test_compose.py`, `tools/README.md`, `tools/.gitignore`;
- `spec.json` and `notes.md` for Legolas, Gimli, Aragorn, Tauriel, Bolg and Cave Troll;
- Legolas's final recorded sampling rectangles;
- `recovery/original-brief.txt` and `recovery/generated-image-manifest.json`, including the exact generation prompts and original saved paths.

Recovered specs contain **design targets only**. Legolas's old measured/observed values cannot be fully recovered from the available outputs and must be restored from the original `spec.json` or recomputed from the original images. No measured or observed result was invented. No character is certified as a complete reference set in this new workspace.

Validation here: all six recovered compositor tests passed; recovered Python source compiles; all six specs parse as JSON. No image-generation calls were made during recovery. No image previews were loaded. No recovery changes have been committed or pushed.

## Missing files required for continuation

The old workspace directories `/workspace/greenleaf-character-refs/docs/refs` and `/workspace/generated_images` were not carried into this chat. GitHub branch `reference/character-sheets` still points to `47ceb55` and contains only the earlier two report files. The old session's final `git status` lists the revised character and tooling directories as untracked, and there is no later commit or push in its history.

The chat-reading tool provides generation status, prompts and saved paths; it does not provide the PNG/JPEG bytes or access to the old filesystem. Restore the old folders (or a backup/archive) before reviewing the corrections or replacing accepted work. If restoring over this recovery, preserve the originals and their measured/observed metadata; treat the newly recovered specs as fallback drafts.

After restoration, keep generated originals at full resolution outside the budgeted reference library. Create and inspect **one small preview at a time**. Store attempt decisions and paths in text immediately after each review; do not load full-resolution images or broad contact sheets into the chat. Keep per-view attempt counts across sessions, with at most four attempts per view.
