# The Black Gate

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Red-brown ash sky, colossal black iron gates and Towers of the Teeth, slag plain, TWO rocky hills of Army of West, surrounding Mordor hosts, Mount Doom glow, distant fell-beast silhouettes; eagles arrive then horizon flash and cracked towers.

Enemy silhouettes: Orc/Easterling ring, 2–3 armoured war trolls; distant fell-beast silhouettes.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Gate leaves combined | 70 | 30 | 5 |
| Teeth tower | 24 | 55 | 24 |
| West hill | 72 | 10 | 64 |
| East hill | 65 | 8 | 60 |

No living vegetation; 15% angular slag/boulders, 85% ash and cracked dirt; 360° enemy ring beyond 35 m.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunColor`: `#ff7a3d` → `#dca081`. Neutralise excessive orange/blue cast so fire, hide and wet stone keep distinguishable hues.
- `sunIntensity`: `1.8` → `1.5`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiSky`: `#5a2f24` → `#73635e`. Add neutral ash fill so Mordor troops do not merge into the red horizon.
- `hemiIntensity`: `0.65` → `0.8`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `fog.density`: `0.0125` → `0.0075`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `bloom`: `0.46` → `0.22`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.56` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. Two rocky defensive hills are essential, not one city plaza.
2. Ash sky stays red-brown, foreground silhouette grey-black.
3. Gimli rescue occurs before the timed last stand.
4. Eagles appear late as distant identifiable wing silhouettes.
5. Victory is horizon flash and cracks, not a visible Eye logo.

## Hill Last Stand

Army of West encircled on TWO rocky 10 and 8 m hills under red-brown ash sky, 360-degree Mordor ring 35 m beyond friendly lines, giant black gates and jagged towers behind. Legolas Gimli Aragorn anonymous small natural silhouettes, foreground rocks 1–2 m cover, readable four approach sectors and allied centre. No logos.

Binding measurements: `hill_heights_m` = [10, 8], `ring_min_distance_m` = 35, `cover_height_m` = [1, 2], `approach_sectors` = 4. Consult the matching image and layout route before tuning movement or collisions.

## Eagles Arrival

Black Gate last stand climax under red-brown ash sky: several great eagles clearly avian feathered wings 12–16 m span fly over distant black fell-beast silhouettes, TWO rocky hills below with small 1.85 m allied scale silhouettes, far horizon soft white-gold flash, gate towers beginning to crack. Original designs, no Eye or lettering.

Binding measurements: `eagle_wingspan_m` = [12, 16], `flight_height_m` = [90, 160], `horizon_flash_s` = 1.2. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=black_gate&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test is strongly orange/red from horizon to ground. Use muted ash-brown ground and a less saturated key #dca081.
2. The test foreground is nearly black. Target hemisphere 0.8 preserves weapon and enemy silhouettes during encirclement.
3. The vignette gate is small in a large fitted ground slab. Player-level framing needs the 30 m gate and 55 m tower masses anchoring the horizon.
4. Ash particles should be sparse grey flakes; reserve orange emissives for local fire rather than the whole sky.
5. Late eagles and the horizon flash are an outro change. Keep the initial gate and last-stand setup ominous without early relief lighting.
