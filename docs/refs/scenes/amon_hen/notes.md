# Amon Hen

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Wooded hill in golden afternoon haze, tall trunks, fallen leaves, mossy Numenorean ruins, broken summit stairs, Seat of Seeing, toppled statues, stream at foot and Lurtz clearing.

Enemy silhouettes: 2 m Uruk scouts, archers, shield and pike waves; Lurtz at stream clearing.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Seat summit | 18 | 2.6 | 18 |
| Broken stairs | 4 | 12 | 38 |
| Lurtz clearing | 28 | 0 | 24 |
| Stream | 4 | 0.6 | 110 |

80–110 mature trunks/ha outside clearing; 55% canopy; ground leaf cover 65%, fern cover 20%.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `4` → `3.4`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `0.62` → `0.5`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `fog.density`: `0.0115` → `0.0075`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.38` → `0.2`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.saturation`: `1.12` → `1.04`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `grade.vignette`: `0.42` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. Place the Lurtz fight by the stream at the hill foot.
2. Warm sun must leave cool shadows readable.
3. Seat of Seeing belongs on summit, not in stream arena.
4. Shield waves need lateral flanking lanes 4 m wide.
5. Ruins are weathered human stonework, not dwarven geometric halls.

## Lurtz Clearing

Original Lurtz stream-side clearing at Amon Hen foot, 28 x24 m arena with shallow 4 m stream, warm afternoon rays through beeches and mossy stone ruins uphill; dark 2 m uruk captain with bow and shield versus anonymous 1.85 m blond elf and human ranger as small silhouettes, clear flanking paths.

Binding measurements: `arena_m` = [28, 24], `stream_width_m` = 4, `stream_depth_m` = 0.6, `flank_lane_m` = 4. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=amon_hen&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test reads evenly warm across trees and ground. Preserve directional late-afternoon light with cooler occluded masonry.
2. Tree silhouettes in the test are straight trunks and uniform canopy blobs. Use irregular oak silhouettes and sparse golden leaves.
3. The vignette fitted snapshot shows mostly a ground slab. Use the 12 m summit and separate stair route to evaluate recognisable ruin composition.
4. Seat and broken walls require moss concentrated in joints, with pale weathered stone still visible.
5. Place the Lurtz clearing directly beside its stream; water must remain a secondary cool strip instead of dominating the duel background.
