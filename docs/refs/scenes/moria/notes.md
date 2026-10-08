# Balin’s Tomb

Development reference only. Source: `docs/CHAPTERS.md`, base commit `7ab3afd`. Original compositions and designs; no runtime assets. Dimensions below are recommended production design targets, not Tolkien canon measurements or surveys of film sets.

## Instant recognition

Square Chamber of Mazarbul, 32 m stone hall with geometric dwarven carving, white Balin tomb in a single high-window shaft, corner well, skeletons and armour, barricaded door, dust, later Dwarrowdelf monumental pillared hall and distant fire glow; no visible Balrog.

Enemy silhouettes: Moria goblins from doors and wall ledges; 4.5 m cave troll with ankle chain.

## Dimensions and density

| Element | Width (m) | Height (m) | Depth / length (m) |
|---|---:|---:|---:|
| Mazarbul chamber | 32 | 14 | 32 |
| Balin tomb | 2.4 | 1 | 1.2 |
| Well | 2.2 | 1.1 | 2.2 |
| Hall pillar | 6 | 42 | 6 |

No living vegetation; 24 hall pillars at 18 m centres; thin dust at 0.05–0.15 visible motes/m³.

`layout.json` is the numeric authority: +Y up, +Z forward; checkpoint numbering is zero-based, exactly matching the chapter array. Bounds and all positions are metres. Some distant structures lie beyond playable bounds. Dimensions describe geometry, not collision tolerances. The map is a flat design diagram, intentionally different from the cinematic art.

## Camera and reading

Third person: camera 1.6 m above local ground, 3.2 m behind Legolas, 1.2 m toward his right, vertical FOV 70° (horizontal 92.81° at 3:2). At that distance a 1.85 m body occupies about 42% of frame height, so “small” is interpreted as confined to the lower-left region without a close-up. Exact camera and luminance acceptance are in `image-spec.json`. Hide faces in small scale cues; test silhouette clarity at 10, 20 and 35 m.

## Lighting recommendations

- `sunIntensity`: `1.5` → `1.75`. Reduce broad key wash while preserving local contrast; Moria shaft and storm key use stronger directional separation.
- `hemiIntensity`: `0.85` → `0.42`. Balance readable shadow silhouettes with directional depth; avoid uniformly filled interiors.
- `envIntensity`: `0.42` → `0.28`. Keep PBR reflections without making all occluded surfaces self-lit.
- `fog.density`: `0.021` → `0.012`. Extend silhouette visibility across the combat and set-piece routes; horizon colour remains matched.
- `exposure`: `1.9` → `1.65`. Protect shafts and marble highlights while retaining the dark setting.
- `bloom`: `0.36` → `0.18`. Restrict bloom to flames and hot glints; prevent haze from obscuring aiming targets.
- `grade.vignette`: `0.62` → `0.32`. Lower edge darkening and oversaturation to preserve peripheral enemy and traversal readability.

`lighting.json` keeps the EnvironmentPreset field names, `kind` discriminants and numeric grading vectors. The user requested sRGB hex serialization; runtime types use numeric colours. Strip reference metadata (`source`, `schema_version`, `environment_name`, `palette`, `observed_palette`, `changes_vs_current`), convert hex fields with `parseInt(value.slice(1),16)`, and keep grade lift/gamma/gain as linear numeric triples. Compare image colour after AgX/output conversion; do not treat a sampled concept pixel as a linear light intensity. Extended renderer-only fields (mist, shafts, glow, cloudSoft) are outside the contract and not copied here.

## Top mistakes to avoid

1. One dominant light shaft on a white tomb, not dozens of blue spotlights.
2. Keep well in a corner with open path around tomb.
3. Cave Troll is 4.5 m, not mumak-sized.
4. Show ankle chain routed over stunned troll shoulder for climb.
5. Only distant Balrog fire glow is allowed; never show the creature.

## Mazarbul Tomb

Chamber of Mazarbul: single slanted cool high-window shaft striking plain white 2.4 x 1.2 x 1 m Balin tomb with no text, 32 x 32 x14 m hall, corner well, axes at splintered doorway, armour and skeleton debris, dwarven pillars with original geometric carving, 1.85 m scale silhouette.

Binding measurements: `chamber_m` = [32, 14, 32], `tomb_m` = [2.4, 1, 1.2], `window_m` = [1.2, 2.4], `shaft_beam_m` = 2.5. Consult the matching image and layout route before tuning movement or collisions.

## Troll Chain Climb

Stunned 4.5 m Cave Troll braced by a pillar in dark Moria chamber, anonymous 1.85 m elf climbing an iron ankle chain draped from hand over shoulder, 0.14 m chain links, 0.35 m shoulder ledge for feet, natural anatomy, non-graphic, shaft and torch rim light.

Binding measurements: `troll_m` = 4.5, `chain_link_m` = 0.14, `chain_length_m` = 7, `shoulder_footing_m` = 0.35. Consult the matching image and layout route before tuning movement or collisions.

## Provenance and reproduction

The image model supplies unlabelled appearance only. `layout.png`, `beats.png`, `palette.png`, scale legends and the gameplay player silhouette are composed by `../../tools/compose_scenes.py`. Narrative people in look art are uncalibrated. The separate 1.85 m silhouette is a design scale legend, not a survey of perspective art. The gameplay background is an appearance reference; only the code-projected schematic player uses the specified camera. Character design is owned by the parallel character sheets.

`lighting.json` and `layout.json` are design targets. `observed_palette` contains script-measured per-channel sRGB medians from rectangles labelled in `palette_regions.jpg`; these are appearance samples, not material albedo or linear light measurements. JPEG art uses quality 88; explicitly named PNG diagrams use lossless storage. Individual six-frame source looks live in `frames/`; captions are drawn by PIL.

## Gaps vs current

Captured from base `7ab3afd`: `current_coded.jpg` uses `/lab/env.html?env=moria&q=high`. These are lighting fixtures, not the chapter. `current_vignette.jpg` is the available static builder sample; whole-world fitted views do not prove missing chapter gameplay. The following differences are ordered by visual impact.

1. The environment test has a central shaft but near-black peripheral test geometry. Target fill 0.42 and exposure 1.65 retain edge readability.
2. The moria_hall vignette appears as a simple closed rectangular hall at its fitted outside camera. Evaluate the chamber from inside at player height.
3. The tomb shaft must isolate pale marble against black stone; avoid lighting every floor block equally.
4. Columns need fine worn block edges and low-reflectance mortar, not a repetitive flat checker appearance.
5. The route should carry warm distant fire only at the final bridge approach. No visible Balrog belongs in these references.
