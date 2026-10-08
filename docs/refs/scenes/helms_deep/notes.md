# Helm’s Deep

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Stormy night, curved crenellated Deeping Wall, six ladder points, wall walk, Hornburg causeway, culvert, 60 m broad stair run, thousands of Uruks and torches, flooded breach; final dawn cavalry charge.

Enemy silhouettes: Uruk climbers, crossbowmen, three stoppable berserkers plus scripted final runner, ram team.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Deeping wall | 160 | 20 | 6 |
| Wall walk slab (top elevation 20 m) | 160 | 0.65 | 6 |
| Culvert | 3 | 2.4 | 6 |
| Shield stair | 6 | 20 | 60 |
| Hornburg keep | 42 | 58 | 38 |

Bare rocky coomb, <5% hardy grass; rain puddles in churned mud and flooded Deep 0.1–0.4 m.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunColor`: `#7391cf` → `#9baecb`. Neutralise excessive orange/blue cast so fire, hide and wet stone keep distinguishable hues.
- `sunIntensity`: `0.95` → `1.1`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `0.6` → `0.7`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `fog.density`: `0.0165` → `0.01`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.3` → `0.18`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.56` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. Stair route is explicitly 60 m; do not make it a ten-step ramp.
2. Exactly six readable ladder sockets along the assault segment.
3. A final scripted runner causes the breach even if three are stopped.
4. Night storm must transition to dawn in the outro.
5. Keep the causeway defence distinct from flooded breach combat.

## Ladder Assault

Helm Deep storm-night wall walk 6 m wide at 20 m height, six wooden 22 m ladders rising at six distinct wall sockets, Galadhrim archers and Uruk climbers as distant natural silhouettes, rain on crenellations, blue-grey fill and warm torches below. Player-height view along walkway.

Binding measurements: `wall_height_m` = 20, `walk_width_m` = 6, `ladder_count` = 6, `ladder_length_m` = 22, `socket_spacing_m` = 12. Consult the matching image and layout route before tuning movement or collisions.

## Culvert Breach

Storm-night culvert explosion at original curved fortress base, initial 3 x2.4 m drain becomes 18 m breach; fireball radius 7 m, large stone blocks 0.5–1.2 m fly outward into muddy field, broad stone wall 20 m tall, smoke and shockwave; 1.85 m scale silhouette sheltered 35 m away.

Binding measurements: `culvert_m` = [3, 2.4], `breach_width_m` = 18, `fireball_radius_m` = 7, `debris_m` = [0.5, 1.2]. Consult the matching image and layout route before tuning movement or collisions.

## Shield Stair

Side-wide cinematic reference of anonymous 1.85 m blond elf shield-surfing original broad stone stairs 60 m long and 6 m wide, total 20 m descent, 111 risers of 0.18 m and treads 0.54 m. Wall walk at top and flooded breach at bottom, storm night, Uruk silhouettes down sides, no impossible steep staircase.

Binding measurements: `run_m` = 60, `width_m` = 6, `rise_m` = 20, `riser_m` = 0.18018018018018017, `tread_m` = 0.5405405405405406, `risers` = 111. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=helms_deep_storm&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The storm environment test rain streaks cover nearly the whole image. Reduce streak opacity and preserve the crosshair zone.
2. Dark test objects lose silhouette detail. Target key 1.1 and hemisphere 0.7 retain wall-walk enemies against cool storm fill.
3. The deeping_wall vignette has a readable fortress silhouette but largely uniform pale walls. Add wet joints, buttress shadows and rough upper stone.
4. The target wall follows a shallow curve with a 6 m walk; six ladder sockets and a central culvert should read as distinct local landmarks.
5. Use local fire and the later dawn transition sparingly. The opening and main siege stay at storm night, rather than broad warm illumination.
