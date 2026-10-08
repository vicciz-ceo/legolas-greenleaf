# Pelennor Fields

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Morning vast grass plain churned to mud, smoke columns, wrecked siege equipment and banners, distant white Minas Tirith on hill with fires, Haradrim/orc crowds, mumak herds.

Enemy silhouettes: Haradrim crew and infantry, orcs, first climb mumak and second range-kill mumak.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Mumak shoulder | 9 | 14 | 19 |
| Howdah | 7 | 7 | 5 |
| Rope ladder | 0.8 | 12 | 0.12 |
| Minas Tirith distant | 480 | 320 | 440 |

Grass 0.15–0.35 m, 40% ground intact and 60% muddy churn in combat footprint; 500–1200 m city distance.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunColor`: `#ffb878` → `#f1cba1`. Neutralise excessive orange/blue cast so fire, hide and wet stone keep distinguishable hues.
- `sunIntensity`: `3.8` → `3.2`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `fog.density`: `0.0078` → `0.0045`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.42` → `0.22`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.saturation`: `1.1` → `1.04`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `grade.vignette`: `0.46` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. 14 m is shoulder height, excluding 7 m howdah.
2. Four tusks in two pairs, not standard two-tusk elephant.
3. Cutting girths needs visible straps and rope clearance.
4. Crew dead before head can take three arrows.
5. A second mumak is fought at range in the final checkpoint.

## Mumak Climb

Full side three-quarter of original four-tusk war mumak 14 m shoulder height, 19 m body length, 7 m-high wooden howdah, red/gold cloth, TWO prominent 0.25 m-wide leather girths and 0.08 m ropes, dangling 0.8 m-wide 12 m rope ladder on flank, 1.85 m blond elf climbing as scale cue. Show stable neck-run 1.2 m-wide and long trunk descent route; morning Pelennor battlefield, no cropped feet.

Binding measurements: `shoulder_height_m` = 14, `body_length_m` = 19, `howdah_m` = [7, 7, 5], `rope_ladder_m` = [0.8, 12], `girth_width_m` = 0.25, `neck_run_width_m` = 1.2. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=pelennor&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test is evenly golden. The target separates warm morning key from muted blue-grey distance and dark siege silhouettes.
2. Visible test embers are prominent across the sky. Keep particles local to burning siege areas and preserve the morning sky.
3. The vignette shows a single distant creature/tower silhouette at its whole-world fit. Use the close-up to judge four tusks, rope ladder, girths and neck access.
4. Grass should show churned mud lanes and scattered worn stems rather than uniformly mottled ground.
5. Keep bright bloom at 0.22 and fog at 0.0045 so the 14 m shoulder and second ranged creature remain distinct.
