# The Barrel Escape

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Bright overcast Forest River gorge, stone water-gate with lever, mossy boulders, beech and oak, log bridges, white-water rapids and final calm shingle pool.

Enemy silhouettes: Orcs on both banks and log bridges; Gundabad log-bridge captain with four guards.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Water gate | 24 | 9 | 5 |
| Barrel | 1 | 1.25 | 1 |
| Log bridge | 22 | 1.5 | 2 |
| Calm pool | 46 | 3 | 60 |

40–60 beech/oak trunks/ha on banks, 55% canopy; river width 18–24 m, narrows to 9 m at chute.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `2.6` → `2.2`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `0.95` → `0.6`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `envIntensity`: `1` → `0.85`. Keep PBR reflections without making all occluded surfaces self-lit.
- `fog.density`: `0.0125` → `0.0075`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.16` → `0.12`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.saturation`: `1.12` → `1.04`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `grade.vignette`: `0.38` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `weather`: `dust` → `none`. River foam and mist should provide the atmosphere; dust is not the correct surface weather.
- `weatherIntensity`: `0.25` → `0`. Reduce distractors across reticles and preserve night silhouettes.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. The 90 s ride at 7–11 m/s needs 630–990 m of navigable course.
2. Use three 3 m clear lanes; never an impassable rock fence.
3. Keep both-bank orcs silhouetted against foam and pale rock.
4. Low logs are jumpable, not waterfalls.
5. Water-gate lever and supports must read at player height.

## Barrel Rapids

Ride down a 20 m gorge river in three 3 m lanes, 9 m pinch chute, mossy rock obstacles 1–3 m, low logs 0.6 m above water, orcs on bank ledges 2–4 m above water. Legolas original anonymous blond elf with sage green tunic and bow balanced on a 1 m barrel; dwarves waist-deep in neighbouring barrels, no close faces.

Binding measurements: `lanes` = 3, `lane_width_m` = 3, `river_width_m` = [9, 24], `rocks_m` = [1, 3], `low_log_clearance_m` = 0.6, `speed_m_s` = [7, 11]. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=forest_river&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The forest_river environment test is cool green throughout. Introduce warm directional edges and keep water highlights brighter than shaded banks.
2. Fog and fill flatten the tree layers; target density 0.0075 and hemisphere 0.6 give clearer aiming depth.
3. The woods vignette is a terrain/vegetation proxy, with no readable river channel in this capture. Compare the proposed 12–24 m course using the plan, not that proxy.
4. River rocks need exposed wet dark bases and pale foam edges; the reference keeps their silhouettes separate from both banks.
5. Bank foliage should stop short of the traversable lane: preserve continuous 4 m clearance and the separate 903 m ride segment.
