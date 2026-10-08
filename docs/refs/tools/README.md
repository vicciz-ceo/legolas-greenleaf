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

A character has `spec.json` with top-level `id`, `design`, `composition` and optional `sampling`. Every design value is intent, marked `design.source: "design_target"`. Unspecified proportions and materials are authored targets, not measured anatomy. `measured` is written by the three composition commands; `observed` is written by `sample`. Both include source or sheet hashes so `check` rejects stale files.

Humanoid sources are `views/{front,three_quarter,side,back}.png`. The alpha > 127 bounding box is the silhouette datum. All views receive the same silhouette height and foot baseline. The ruler measures **overall height including hair, ears and headgear**, not necessarily bare crown height. Nothing held or mounted may extend above the headgear or below the feet.

The height cap is 85% of 1024 px. `composition.fit_policy: "fit"` selects the largest uniform scale that also fits all four widths without overlaps. Broad A-pose figures cannot all occupy 85% height on a 1536-pixel-wide sheet. The actual fill fraction and pixels/metre are recorded. `"strict_85_percent"` instead exits with an error if the requested layout is physically impossible. Horizontal warping is never used.

Face sources are `face_views/{front,three_quarter,side}.png`. Face sheets have no metric scale claim. Four or nine entries in `composition.detail_tiles` specify `name`, `label` and relative `source`; tiles are fitted whole without mirroring. Text and rulers are drawn by Pillow; no generated lettering is accepted.

For creatures, set `composition.creature: true`, `views` (four names), `reference_view`, `scale_axis` (`width` or `height`), `scale_extent_m`, and `projected_extents_m` for each view. Different projections cannot be assigned the same wingspan or body-length number indiscriminately. Those extents are explicitly authored design targets; the cutout supplies the image bounds. A code-drawn 1.85 m human uses the same scene scale. Distant eagle/fell-beast sheets set `silhouette_only: true` and do not require face/material sheets or colour sampling.

`sampling` is an array of author-reviewed rectangles: `{"name":"skin","sheet":"face","rect_px":[x0,y0,x1,y1]}`. Coordinates are half-open rectangles in the final JPEG. Per-channel median sRGB, rectangle, sheet hash and the statement **rendered and lit, not albedo** are stored under `observed`. The design palette is preserved.

All three output canvases begin at exact RGB (127,127,127). JPEG quality is 88 with no chroma subsampling. JPEG is lossy: ringing immediately beside a subject or label can perturb background pixels. `check` asserts the exact safe 16×16 background patch in the decoded JPEG; metadata records the exact pre-encoding canvas colour. It does not falsely claim that every decoded edge pixel is lossless.

Budgets use decimal bytes: 2,500,000 per character and 70,000,000 for the whole library, including source images, JSON, notes and tooling. Previews go to the operating system's temporary directory and are never committed. A passing `check` certifies construction and freshness, **not** anatomy, identity, gear sides or artistic quality; those receive a separate by-eye review.
