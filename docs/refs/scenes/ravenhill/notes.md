# Ravenhill

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Snowy crag under pale winter overcast, ruined dwarven watchtower, frozen waterfall and ice river, broken bridges, Erebor mountain and valley battle smoke, falling snow.

Enemy silhouettes: Gundabad orcs, slab-armoured troll, 6–8 m-wing bats, Bolg tower duel phases.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Watchtower | 18 | 28 | 18 |
| Frozen waterfall | 16 | 24 | 4 |
| Broken bridge | 30 | 7 | 5 |
| Falling block | 2.4 | 0.9 | 2 |

10–15 sparse pine/dead trunks/ha below cliff; snow depth 0.15–0.5 m, exposed ice patches 5–8 m.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `1.9` → `1.55`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `1` → `0.7`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `fog.density`: `0.0145` → `0.009`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.2` → `0.12`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.42` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.
- `weatherIntensity`: `0.85` → `0.7`. Reduce distractors across reticles and preserve night silhouettes.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. Keep the ice river below the tower, not at its roof.
2. Bat span 6–8 m must visibly support a 1.85 m hanging elf.
3. Bolg has two duels separated by collapse, not a single arena.
4. Falling blocks must form an upward chain with 1–2.2 m horizontal gaps.
5. Snow needs blue-grey occlusion and rock breaks, not featureless white.

## Bat Flight

Legolas hanging from the claws of a 7 m-wing leathery bat, ascending snowy cliffs along an unobstructed route 12 m clear width from ice river to tower 45 m higher. Other distant bats and orc archers on stone ledges. Side-wide framing preserves silhouette and wing anatomy.

Binding measurements: `wingspan_m` = 7, `climb_m` = 41, `route_clear_width_m` = 12, `speed_m_s` = 10. Consult the matching image and layout route before tuning movement or collisions.

## Tower Duel

Original upper dwarven watchtower duel floor 16 x 16 m, broken parapet 1.1 m high, 1.5 m corner pillars, Bolg 2.6 m and elf 1.85 m as distant combat silhouettes, snowy overcast light, visible geometric stone and stair exit.

Binding measurements: `floor_m` = [16, 16], `parapet_m` = 1.1, `pillar_m` = 1.5. Consult the matching image and layout route before tuning movement or collisions.

## Falling Stones

Snowy ruined bridge collapsing beneath an upward chain-jump path. Six individual 2.4 x 2 x 0.9 m masonry blocks, horizontal gaps 1–2.2 m and vertical rises 0.7–1.4 m, visually distinct from rubble, 1.85 m anonymous elf jumping with natural limb anatomy. Tower above and valley below, side-wide view.

Binding measurements: `block_m` = [2.4, 0.9, 2], `horizontal_gaps_m` = [1, 2.2], `vertical_rises_m` = [0.7, 1.4], `release_delay_s` = 1.8. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=ravenhill_winter&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test snow consists of large bright dots close to the camera. Reduce visual coverage and use smaller depth-dependent flakes.
2. The high white exposure softens ground edges. Protect ice highlights while separating grey rock from snow.
3. The vignette fit shows a long cliff strip with very little vertical silhouette at this angle. The hero target prioritises the 24 m falls and tower height.
4. Maintain blue-grey shadow fissures in the frozen waterfall, with rough snow only on upward surfaces.
5. The ascent needs distinct bat, tower and falling-block routes; use labelled plan paths rather than a uniformly snow-covered slope.
