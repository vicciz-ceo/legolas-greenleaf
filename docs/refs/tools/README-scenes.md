# Reference production tools

These tools only write development references below `docs/refs/`. They do not alter or import game code. The image model supplies unlabelled appearance; Python and native browser rendering supply all measurable and textual content. Scene/graphics primitives live in `scene_composition.py`; the independent character CLI remains in `compose.py`, preserving its background and encoding rules.

Requirements: Python 3 with Pillow and NumPy, Node with the repository's `playwright-core`, and system Chromium. Engineering captions use local DejaVu Sans; product UI uses only the system serif stack in `ui-spec.json`. No web font or image-based UI decoration is used.

From the repository root:

```sh
python docs/refs/tools/compose_scenes.py
python docs/refs/tools/compose_effects_props.py
SNAP_CHROME=/usr/bin/chromium node docs/refs/tools/render_ui.mjs
python docs/refs/tools/validate_refs.py
python docs/refs/tools/qa_sheet.py --mode final
```

`--partial` on `compose_scenes.py` is useful while looks are still arriving. Final validation requires all assets. The QA tool creates temporary contact sheets outside the repository by default; it never changes inputs.

## Inputs and authority

- `scenes/*/layout.json`: metre-space plans, starts, checkpoint lists, routes, structures, allies, enemies, cover and high ground. Plan images are always rendered from these targets with the same X/Z scale. Platform/foot and structure-base anchor semantics are stated in each file.
- `scenes/*/looks/`, `frames/`, and `gameplay_look.jpg`: unlabelled generated appearance inputs. Storyboard frames are stored at 768×512 because the composed grid uses smaller cells. Heroes and set-pieces retain 1536×1024. Native originals are not committed.
- `scenes/*/lighting.json`: EnvironmentPreset fields plus reference metadata. `name` preserves the preset's display name; `environment_name` identifies its environment selector. Whitelist the actual TypeScript contract fields, convert hex colours to numbers, and preserve numeric lift/gamma/gain triples. Reference metadata is never a runtime preset extension.
- `materials/looks/`: evenly lit original photographic inputs. `compose_scenes.py` offsets each axis by half a tile, blends with a raised-cosine weight, matches outer boundaries and saves exact 1024×1024 JPEG quality 88. These are look references, not normal maps or shippable texture assets.
- `vfx/looks/`: isolated effect appearance. Six timeline frames are illustrative seeded CPU integration from the target lifetime, velocity, gravity, size and colour. Screen effects are applied by code to a scene look; no generated screen filter is used.
- `props/looks/`: isolated front and three-quarter appearances. Alpha/background-difference bounds are measured in pixels. The compositor fits each view to its target bounding box and draws the 1.85 m silhouette at that panel's metre scale. This is an orthographic design presentation, not reconstruction of a photographed 3D object.
- `ui/mockups/*.html`: the exact DOM/CSS/SVG sources of all UI screenshots. The browser waits for local fonts and records CSS rectangles and percentages in `mockup-measurements.json`. Reference background photos support review; the game uses its procedural renderer instead.

Generated inputs must contain no typography, labels, rulers, scale bars, calibration people or logos. Narrative actors can remain in scene art but carry no measurement authority. Corrective look requests are limited to four attempts per image. The retained wordmark and icons are hand-written SVG.

## Palette measurements

`palette_regions.jpg` labels the rectangles sampled from the unlabelled hero. `observed_palette` stores the per-channel median of encoded sRGB pixels and the exact source rectangle; it is not a physical albedo or linear illumination measurement. A null sample means no unambiguous region is visible. Each palette pairs intent and observed values. The colour script uses these observations and explicitly records any design fallback.

`materials.json` likewise separates design albedo/roughness targets from actual image median, percentiles and JPEG boundary error. Targets for real tile size, roughness, metalness and depth cannot be inferred from a generated image.

## Encoding and validation

Photographic inputs, art sheets and browser screenshots use JPEG quality 88 with chroma subsampling. Explicitly requested diagrams retain PNG (`layout`, `beats`, palettes, colour script, material overview). The scene/graphics library, including its tools, retained inputs and shared accounting files, must remain at or below 120,000,000 bytes. The character library keeps its separate 70,000,000-byte cap. [Combined inventory](../reference-inventory.json) lists every retained file and reports both scoped totals and the combined size; no retained file escapes accounting.

`validate_refs.py` checks asset coverage, exact output resolutions, EnvironmentPreset serialization, source markers, palette medians, material seam errors, prop view counts, browser errors, touch targets/safe areas and the byte budget. Visual QA is separate and documented in `../QUALITY_REPORT-scenes.md`; a passing schema check is not a claim of photogrammetric accuracy.

`generation-requests-scenes.json` records the amendment-compatible initial look prompts. `scene-production.jsonl` records delivered generated inputs and corrective attempts. Final accepted inputs, changed requests and rejected looks are recorded in the quality report; discarded originals remain outside the committed library.
