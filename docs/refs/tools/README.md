# Reference compositor

`compose.py` requires Python 3, Pillow and numpy. The optional rembg CPU package is used automatically when installed; otherwise segmentation uses the corner-median colour-distance threshold, morphology and optional scipy component cleanup. Segmentation always needs visual review, particularly for similar-coloured metal and background or thin bowstrings. No command mirrors a source image.

```sh
python -m pip install Pillow numpy
# Optional, used for the current generated sources:
python -m pip install 'rembg[cpu]'
python docs/refs/tools/compose.py segment source.png docs/refs/legolas/views/front.png --max-height 640
python docs/refs/tools/compose.py turnaround legolas
python docs/refs/tools/compose.py face legolas
python docs/refs/tools/compose.py grid legolas
python docs/refs/tools/compose.py sample legolas
python docs/refs/tools/compose.py preview64 legolas
python docs/refs/tools/compose.py check legolas
python -m unittest discover -s docs/refs/tools -p 'test_*.py' -v
```

Run from any working directory; the library root is resolved relative to the script. `segment` accepts `--threshold`, `--max-height`, and `--backend auto|threshold|rembg`. It trims transparent margins, downsizes uniformly, adds a four-pixel transparent safety border, and writes optimized RGBA PNG. Height including padding must not exceed 1024 px.

A character has `spec.json` with top-level `id`, `design`, `composition` and optional `sampling`. Every design value is intent, marked `design.source: "design_target"`. Unspecified proportions and materials are authored targets, not measured anatomy. `measured` is written only by composition commands; `observed` is written by `sample`. Both include source or sheet hashes so `check` rejects stale files.

Humanoid sources are `views/{front,three_quarter,side,back}.png`. The alpha > 127 bounding box is the silhouette datum. All views receive the same silhouette height and foot baseline. The ruler measures **overall height including hair, ears and headgear**, not necessarily bare crown height. Nothing held or mounted may extend above the headgear or below the feet.

The height cap is 85% of 1024 px. `composition.fit_policy: "fit"` selects the largest uniform scale that also fits all four widths without overlaps. Broad A-pose figures cannot all occupy 85% height on a 1536-pixel-wide sheet. The actual fill fraction and pixels/metre are recorded. `"strict_85_percent"` instead exits with an error if the requested layout is physically impossible. Horizontal warping is never used.

Face sources are `face_views/{front,three_quarter,side}.png`. Face sheets have no metric scale claim. Four or nine entries in `composition.detail_tiles` specify `name`, `label` and relative `source`; tiles are fitted whole without mirroring. Text and rulers are drawn by Pillow; no generated lettering is accepted.

For creatures, set `composition.creature: true`, `views` (four names), `reference_view`, `scale_axis` (`width` or `height`), `scale_extent_m`, and `projected_extents_m` for each view. Different projections cannot be assigned the same wingspan or body-length number indiscriminately. Those extents are explicitly authored design targets; the cutout supplies the image bounds. A code-drawn 1.85 m human uses the same scene scale. Distant eagle/fell-beast sheets set `silhouette_only: true` and do not require face/material sheets or colour sampling.

`sampling` is an array of author-reviewed rectangles: `{"name":"skin","sheet":"face","rect_px":[x0,y0,x1,y1]}`. Coordinates are half-open rectangles in the final JPEG. Per-channel median sRGB, rectangle, sheet hash and the statement **rendered and lit, not albedo** are stored under `observed`. The design palette is preserved.

All three output canvases begin at exact RGB (127,127,127). JPEG quality is 88 with no chroma subsampling. JPEG is lossy: ringing immediately beside a subject or label can perturb background pixels. `check` reconstructs the lossless canvas from retained sources and compares its raw-pixel hash and exact safe background patch. The decoded JPEG patch uses a maximum per-channel tolerance of 3; metadata records the exact pre-encoding canvas colour. It does not falsely claim that every decoded edge pixel is lossless.

Budgets use decimal bytes: 2,500,000 per character and 70,000,000 for the whole library, including source images, JSON, notes and tooling. Previews go to the operating system's temporary directory and are never committed. A passing `check` certifies construction and freshness, **not** anatomy, identity, gear sides or artistic quality; those receive a separate by-eye review.

Creature `scale_axes` can override the projected axis by view. `landmark_regions_px` holds reviewed rectangles in retained-cutout coordinates, for example the mumak body region below its shoulder and excluding the howdah. Code computes half-open alpha extrema, source and sheet endpoints and effective scale. The reference view extent must equal `scale_extent_m`; other projected extents are explicitly authored design targets, never inferred anatomy.

`turnaround_labels` overrides body-view labels where a character uses a left profile. Face labels are independent.

`compose.py supplement <id>` composes supplemental object lineups and comparison sources. Specify `composition.supplement: true`, `columns`, `rows`, `items` (name, label, relative source), and optional `metric`, per-item `extent_m`, `canvas_px` and `png_name`. Metric extents are projected vertical end-to-end spans of reviewed upright objects. One common scale fits every item; code draws quarter-metre rulers. Nonmetric howdah close-ups and dwarf upper-body comparisons explicitly record their original-brief exceptions. `check <id>` and `check --all` validate actual sources, reconstructed canvas, PNG/JPEG, layout and budgets; an accepted ledger alone never certifies a supplement.

Current regression suite: sixteen tests. For fine crowns and hair, the current intake uses `GREENLEAF_REMBG_MODEL=bria-rmbg`. Run only one segmentation worker and reuse its rembg session to avoid excess memory. Full-resolution originals remain under `/workspace/generated_images`, and `sources.json` records their paths, hashes and retained crop coordinates.

For a material fully hidden by a prescribed outfit, add its name/reason to `design.concealed_materials` and a sampling item with the same name, sheet and `not_visible` reason. `sample` records the source hash and explicit null colour/rectangle fields. It never invents pixels for hidden cloth, hair or skin. Those records are validated separately from actual median samples. At small creature scales, quarter-metre ticks remain, while numeric tick labels use a recorded stride to stay readable.

`intake.py --remove-background` removes detail studio backdrop before cropping, reuses the process rembg session, and saves RGBA detail sources. Full-image hashes and original crop coordinates remain in `sources.json`.

Humanoid normalization measures alpha >127 after uniform resampling. If downsampling fades an extremal thin tip below that threshold, it preserves one source-coloured edge pixel at half opacity; no axis is stretched independently. `resampled_alpha_bbox_px` records the actual bounds used for calibrated height and baseline.

Sampling can use final-sheet `sheet` rectangles or a `source_image` rectangle in a retained `views/`, `face_views/` or `details/` file. Source cutout rectangles must be at least95% opaque; transparent padding is never treated as a material colour. Coordinates and source hashes are recorded. `check` requires skin, hair and every named outfit/armor material to have a sample, with explicit `design.sample_aliases` for legacy material-family names and documented null observations for concealed surfaces.

Additional creature poses: configure composition.pose_targets with an explicit projected axis, extent_m and optional reviewed region_px, then run `compose.py poses <id>`. The additional pose uses the main turnaround scale, a code-drawn 1.85 m human and ruler; reconstruction checks detect scale/source changes. Gundabad bat requires a folded pose. Creature turnaround_labels can name flight poses without generated text.
