# Spiders of Mirkwood

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Black depths of Mirkwood, colossal gnarled 3–6 m oak trunks, roots, webs, four cocooned dwarves, green-gold canopy shafts, drifting spores, dark web hollow.

Enemy silhouettes: Eight-legged spiders 2.5–3 m span; Brood Mother 6 m span.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Ancient oak | 5 | 32 | 5 |
| Web hollow | 20 | 10 | 16 |
| Fallen log | 12 | 1.5 | 1.5 |
| Cocoon | 0.8 | 1.5 | 0.8 |

50–75 mature trunks/ha; 80% overhead canopy, 40% fern cover outside combat lanes; 4 m path and 20 m combat clearings.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `3.4` → `2.8`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `1.1` → `0.55`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `envIntensity`: `1` → `0.65`. Keep PBR reflections without making all occluded surfaces self-lit.
- `fog.density`: `0.03` → `0.018`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `exposure`: `1.3` → `1.15`. Protect shafts and marble highlights while retaining the dark setting.
- `bloom`: `0.32` → `0.18`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.55` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. Do not make trunks ordinary saplings: 3–6 m diameter.
2. Keep the 4 m traversal lane free of collision roots.
3. Spider silk is fibrous and translucent, never solid white sheets.
4. Do not flood the shadows with green light; preserve near-black chitin.
5. Four rescue cocoons and three boss anchors must read separately.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=mirkwood&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test has a broad green wash. Reduce hemisphere intensity from 1.1 to 0.55 and keep dark trunks neutral.
2. Fog currently merges nearby trunks into one green plane. Reduce density 0.03 to 0.018 and separate the 10–35 m aiming depth.
3. Canopy-test cylinders have uniform vertical silhouettes; the target needs 3–6 m gnarled bases, lateral roots and irregular branch occlusion.
4. The vignette snapshot shows a terrain slab with sparse detail at its fitted camera. Use the 4 m lane and web hollow plan to judge local framing rather than that whole-world view.
5. Spores are bright isolated dots in the test. Keep the target particles sparse, smaller and below the brightness of the principal shaft.
