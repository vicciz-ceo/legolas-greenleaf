# Lake-town by Night

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Intact wooden stilt houses on black lake at blue moonlit night, plank walkways, canals, steep shingled roofs, warm lanterns and braziers, nets, boats, water mist, two-storey Bard house with open front room.

Enemy silhouettes: Orc raiders across canal, roof and walkway; Bolg 2.6 m mace wielder.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Bard house | 9 | 8 | 7 |
| Stilt house | 7 | 7 | 6 |
| Walkway | 3 | 2 | 35 |
| Canal | 8 | 3 | 70 |

No vegetation in town; 35% lake gaps between clusters; roofs 4–8 m high with 1.5–3 m jump gaps.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunColor`: `#86a4e6` → `#a2b7da`. Neutralise excessive orange/blue cast so fire, hide and wet stone keep distinguishable hues.
- `sunIntensity`: `1.15` → `0.9`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `0.55` → `0.65`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `fog.density`: `0.0115` → `0.008`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.5` → `0.24`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.5` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `weatherIntensity`: `0.5` → `0.15`. Reduce distractors across reticles and preserve night silhouettes.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. This chapter is a raid before the town burns: no dragon or city-wide inferno.
2. Expose the front room, not a sealed house cube.
3. Walkways need rails only at edges that do not block combat jumps.
4. Water falls lead to swim-back, not death pits.
5. Keep Bolg readable without flattening blue night into daylight.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=laketown_night&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test star field is conspicuous. The target uses a quieter night sky so lanterns and roof silhouettes lead the eye.
2. Blue test fill dominates shadow surfaces. Use warm lantern pools against muted blue-grey ambient light, without burning the town.
3. The vignette whole-world fit makes stilt buildings tiny. Frame at the walkway level to evaluate 3 m planks and the Bard house landmark.
4. Walkway reflections need broken plank-scale streaks rather than uniform gloss; roughness must rise on dry timber.
5. Keep bloom at 0.24 so lantern points remain readable while the aiming centre retains dark gaps.
