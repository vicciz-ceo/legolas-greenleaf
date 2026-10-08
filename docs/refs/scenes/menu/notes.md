# Menu: Forest River Dawn

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Slow calm misty Forest River and distant Mirkwood at golden dawn, layered oak/beech silhouettes, quiet water, no battle, restrained drifting dust.

Enemy silhouettes: None.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| River bend | 28 | 2 | 180 |
| Oak | 4 | 30 | 4 |

60 trunks/ha at banks; dawn mist concentrated 0–4 m above water.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `3` → `2.4`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `fog.density`: `0.0115` → `0.0085`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.32` → `0.18`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.saturation`: `1.05` → `1.04`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `grade.vignette`: `0.5` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `weatherIntensity`: `0.35` → `0.12`. Reduce distractors across reticles and preserve night silhouettes.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. No battle or threatening silhouettes on title background.
2. Do not overexpose horizon where menu labels sit.
3. Motion takes 30–60 s cycles and stays calm.
4. Leave left 40% darker and uncluttered.
5. No title or text baked into this environmental image.

## Menu-only interpretation

This is not a playable chapter and has no checkpoints, enemies or boss. Its six storyboard panels specify slow ambience states, and its gameplay camera is a scale/readability study only.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=menu&q=high`. These are lighting fixtures, not the chapter. There is no separate menu vignette. The following differences are ordered by visual impact.

1. The environment test is a neutral lighting fixture, without the title vista composition. Use the calm river opening as the visual target.
2. Its warm flat ground fills much of the frame; replace that composition with quiet river reflections and layered woodland banks.
3. Reduce bloom from 0.3 to 0.18 to retain fine mist layers and foliage edges.
4. Fog should be a distant low layer, not a uniform foreground wash; target density 0.0085.
5. Keep dust/spores at low intensity 0.12 and avoid combat, crowds or a dominant palace silhouette.
