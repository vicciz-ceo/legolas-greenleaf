# Scene and graphics references

Development-only appearance and engineering targets for Greenleaf, based on `origin/build/foundation` at `7ab3afd` and `docs/CHAPTERS.md`. Never import or ship these files. Original compositions, faces, costume details, structures and wordmark; no copied film frames, official typography or actor likenesses.

Generated images supply the **look**. Code supplies all labels, measurements, maps, palette samples, calibrated silhouettes and UI. JSON roots marked `source: design_target` are recommended settings, not measured runtime values. Nested `source: measured_script` records identify actual pixel/DOM measurements. Perspective art is not a geometric survey.

Art and screenshots use JPEG quality 88. Explicit PNG diagrams (`layout`, `beats`, `palette`, colour script and material overview) retain their requested names. All files, including retained source looks, count against the 120 MB limit. [Quality report](QUALITY_REPORT-scenes.md) · [Composition tools](tools/README-scenes.md) · [Validation results](tools/validation-scenes.json)

## Journey and scenes

![Colour script](scenes/color_script.png)

Each chapter folder contains a hero, player view, six individually generated storyboard frames composed with code captions, JSON-rendered plan, lighting key, sampled palette, notes, and baseline captures. Checkpoint labels and zero-based numbering follow the chapter list.

| Chapter | Establishing look | Player view | Story beats | Numeric plan and palette |
|---|---|---|---|---|
| [menu — notes](scenes/menu/notes.md) | [![Hero](scenes/menu/establishing.jpg)](scenes/menu/establishing.jpg) | [![Player](scenes/menu/gameplay_view.jpg)](scenes/menu/gameplay_view.jpg) | [![Beats](scenes/menu/beats.png)](scenes/menu/beats.png) | [Plan](scenes/menu/layout.png) · [JSON](scenes/menu/layout.json) · [Palette](scenes/menu/palette.png) · [Regions](scenes/menu/palette_regions.jpg) · [Lighting](scenes/menu/lighting.json) |
| [mirkwood — notes](scenes/mirkwood/notes.md) | [![Hero](scenes/mirkwood/establishing.jpg)](scenes/mirkwood/establishing.jpg) | [![Player](scenes/mirkwood/gameplay_view.jpg)](scenes/mirkwood/gameplay_view.jpg) | [![Beats](scenes/mirkwood/beats.png)](scenes/mirkwood/beats.png) | [Plan](scenes/mirkwood/layout.png) · [JSON](scenes/mirkwood/layout.json) · [Palette](scenes/mirkwood/palette.png) · [Regions](scenes/mirkwood/palette_regions.jpg) · [Lighting](scenes/mirkwood/lighting.json) |
| [barrels — notes](scenes/barrels/notes.md) | [![Hero](scenes/barrels/establishing.jpg)](scenes/barrels/establishing.jpg) | [![Player](scenes/barrels/gameplay_view.jpg)](scenes/barrels/gameplay_view.jpg) | [![Beats](scenes/barrels/beats.png)](scenes/barrels/beats.png) | [Plan](scenes/barrels/layout.png) · [JSON](scenes/barrels/layout.json) · [Palette](scenes/barrels/palette.png) · [Regions](scenes/barrels/palette_regions.jpg) · [Lighting](scenes/barrels/lighting.json) |
| [laketown — notes](scenes/laketown/notes.md) | [![Hero](scenes/laketown/establishing.jpg)](scenes/laketown/establishing.jpg) | [![Player](scenes/laketown/gameplay_view.jpg)](scenes/laketown/gameplay_view.jpg) | [![Beats](scenes/laketown/beats.png)](scenes/laketown/beats.png) | [Plan](scenes/laketown/layout.png) · [JSON](scenes/laketown/layout.json) · [Palette](scenes/laketown/palette.png) · [Regions](scenes/laketown/palette_regions.jpg) · [Lighting](scenes/laketown/lighting.json) |
| [ravenhill — notes](scenes/ravenhill/notes.md) | [![Hero](scenes/ravenhill/establishing.jpg)](scenes/ravenhill/establishing.jpg) | [![Player](scenes/ravenhill/gameplay_view.jpg)](scenes/ravenhill/gameplay_view.jpg) | [![Beats](scenes/ravenhill/beats.png)](scenes/ravenhill/beats.png) | [Plan](scenes/ravenhill/layout.png) · [JSON](scenes/ravenhill/layout.json) · [Palette](scenes/ravenhill/palette.png) · [Regions](scenes/ravenhill/palette_regions.jpg) · [Lighting](scenes/ravenhill/lighting.json) |
| [moria — notes](scenes/moria/notes.md) | [![Hero](scenes/moria/establishing.jpg)](scenes/moria/establishing.jpg) | [![Player](scenes/moria/gameplay_view.jpg)](scenes/moria/gameplay_view.jpg) | [![Beats](scenes/moria/beats.png)](scenes/moria/beats.png) | [Plan](scenes/moria/layout.png) · [JSON](scenes/moria/layout.json) · [Palette](scenes/moria/palette.png) · [Regions](scenes/moria/palette_regions.jpg) · [Lighting](scenes/moria/lighting.json) |
| [amon hen — notes](scenes/amon_hen/notes.md) | [![Hero](scenes/amon_hen/establishing.jpg)](scenes/amon_hen/establishing.jpg) | [![Player](scenes/amon_hen/gameplay_view.jpg)](scenes/amon_hen/gameplay_view.jpg) | [![Beats](scenes/amon_hen/beats.png)](scenes/amon_hen/beats.png) | [Plan](scenes/amon_hen/layout.png) · [JSON](scenes/amon_hen/layout.json) · [Palette](scenes/amon_hen/palette.png) · [Regions](scenes/amon_hen/palette_regions.jpg) · [Lighting](scenes/amon_hen/lighting.json) |
| [helms deep — notes](scenes/helms_deep/notes.md) | [![Hero](scenes/helms_deep/establishing.jpg)](scenes/helms_deep/establishing.jpg) | [![Player](scenes/helms_deep/gameplay_view.jpg)](scenes/helms_deep/gameplay_view.jpg) | [![Beats](scenes/helms_deep/beats.png)](scenes/helms_deep/beats.png) | [Plan](scenes/helms_deep/layout.png) · [JSON](scenes/helms_deep/layout.json) · [Palette](scenes/helms_deep/palette.png) · [Regions](scenes/helms_deep/palette_regions.jpg) · [Lighting](scenes/helms_deep/lighting.json) |
| [pelennor — notes](scenes/pelennor/notes.md) | [![Hero](scenes/pelennor/establishing.jpg)](scenes/pelennor/establishing.jpg) | [![Player](scenes/pelennor/gameplay_view.jpg)](scenes/pelennor/gameplay_view.jpg) | [![Beats](scenes/pelennor/beats.png)](scenes/pelennor/beats.png) | [Plan](scenes/pelennor/layout.png) · [JSON](scenes/pelennor/layout.json) · [Palette](scenes/pelennor/palette.png) · [Regions](scenes/pelennor/palette_regions.jpg) · [Lighting](scenes/pelennor/lighting.json) |
| [black gate — notes](scenes/black_gate/notes.md) | [![Hero](scenes/black_gate/establishing.jpg)](scenes/black_gate/establishing.jpg) | [![Player](scenes/black_gate/gameplay_view.jpg)](scenes/black_gate/gameplay_view.jpg) | [![Beats](scenes/black_gate/beats.png)](scenes/black_gate/beats.png) | [Plan](scenes/black_gate/layout.png) · [JSON](scenes/black_gate/layout.json) · [Palette](scenes/black_gate/palette.png) · [Regions](scenes/black_gate/palette_regions.jpg) · [Lighting](scenes/black_gate/lighting.json) |

### Set-piece close-ups

| Chapter | References |
|---|---|
| barrels | [barrel rapids](scenes/barrels/barrel_rapids.jpg) |
| ravenhill | [bat flight](scenes/ravenhill/bat_flight.jpg) · [tower duel](scenes/ravenhill/tower_duel.jpg) · [falling stones](scenes/ravenhill/falling_stones.jpg) |
| moria | [mazarbul tomb](scenes/moria/mazarbul_tomb.jpg) · [troll chain climb](scenes/moria/troll_chain_climb.jpg) |
| amon_hen | [lurtz clearing](scenes/amon_hen/lurtz_clearing.jpg) |
| helms_deep | [ladder assault](scenes/helms_deep/ladder_assault.jpg) · [culvert breach](scenes/helms_deep/culvert_breach.jpg) · [shield stair](scenes/helms_deep/shield_stair.jpg) |
| pelennor | [mumak climb](scenes/pelennor/mumak_climb.jpg) |
| black_gate | [hill last stand](scenes/black_gate/hill_last_stand.jpg) · [eagles arrival](scenes/black_gate/eagles_arrival.jpg) |

### Lighting recommendations

Values are engine-relative design targets. Full before/after comparisons and reasons are in each `lighting.json`. Lower vignette and bloom preserve aiming and peripheral silhouettes.

| Environment | Recommended key / fill / fog | Purpose |
|---|---|---|
| menu | Key #ffbf7a × 2.4; hemi 0.75; fog 0.0085 | Calm river dawn and layered mist. |
| mirkwood | Key #cfe8a6 × 2.8; hemi 0.55; fog 0.018 | Dark oak masses with restrained green fill. |
| forest_river | Key #fff1da × 2.2; hemi 0.6; fog 0.0075 | Bright readable rapids and distinct banks. |
| laketown_night | Key #a2b7da × 0.9; hemi 0.65; fog 0.008 | Cool intact stilt town with warm local lantern pools. |
| ravenhill_winter | Key #dbe7f7 × 1.55; hemi 0.7; fog 0.009 | Protect snow highlights; reduce flake coverage. |
| moria | Key #9db6d6 × 1.75; hemi 0.42; fog 0.012 | Pale tomb shaft against dark columns; readable combat edges. |
| amon_hen | Key #ffc684 × 3.4; hemi 0.5; fog 0.0075 | Warm late afternoon against cool shaded ruins. |
| helms_deep_storm | Key #9baecb × 1.1; hemi 0.7; fog 0.01 | Storm night, local torches; separate dawn transition. |
| pelennor | Key #f1cba1 × 3.2; hemi 0.62; fog 0.0045 | Morning key and clear distant creature silhouettes. |
| black_gate | Key #dca081 × 1.5; hemi 0.8; fog 0.0075 | Muted ash-brown dread, late horizon relief only. |

## UI, HUD, icons and logo

[Tokens and design geometry](ui/ui-spec.json) · [Measured DOM rectangles](ui/mockup-measurements.json) · [Native HTML/CSS/SVG mockups](ui/mockups/) · [Implementation notes](ui/notes.md)

| Reference | Preview | Reference | Preview |
|---|---|---|---|
| [hud desktop](ui/mockups/hud_desktop.html) | ![hud_desktop](ui/hud_desktop.jpg) | [hud touch](ui/mockups/hud_touch.html) | ![hud_touch](ui/hud_touch.jpg) |
| [title](ui/mockups/title.html) | ![title](ui/title.jpg) | [chapter select](ui/mockups/chapter_select.html) | ![chapter_select](ui/chapter_select.jpg) |
| [upgrades](ui/mockups/upgrades.html) | ![upgrades](ui/upgrades.jpg) | [settings](ui/mockups/settings.html) | ![settings](ui/settings.jpg) |
| [pause](ui/mockups/pause.html) | ![pause](ui/pause.jpg) | [chapter complete](ui/mockups/chapter_complete.html) | ![chapter_complete](ui/chapter_complete.jpg) |
| [defeat](ui/mockups/defeat.html) | ![defeat](ui/defeat.jpg) | [loading](ui/mockups/loading.html) | ![loading](ui/loading.jpg) |
| [credits](ui/mockups/credits.html) | ![credits](ui/credits.jpg) |  |  |

![Icons](ui/icons/icons_preview.jpg)

[33 hand-written icons](ui/icons/) · [Original SVG wordmark](ui/logo/logo.svg)

![Wordmark](ui/logo/logo_preview.jpg)

[All nine chapter banners](ui/chapter_cards/) are 1024×512, with the left 40% reserved for dark text backing. The mockups use existing procedural scenes as a runtime background; reference JPEGs only provide the development backdrop.

## Materials

![Material grid](materials/materials_overview.png)

[37 texture targets](materials/materials.json) · [Material notes](materials/notes.md). Includes every requested material plus generator sets `birch_bark`, `shingles`, and `bone`. Flat 1024² photographic looks are half-offset and blended by script; tile sizes match the generator contract.

## VFX

[28 effect targets](vfx/vfx.json) · [Effect notes](vfx/notes.md). Each sheet contains a look hero plus six code-simulated sequence frames and timestamps. Simulation parameters are targets, not measurements of the renderer.

| Effect | Preview | Effect | Preview |
|---|---|---|---|
| normal arrow | ![normal_arrow](vfx/normal_arrow.jpg) | focus volley | ![focus_volley](vfx/focus_volley.jpg) |
| impact flesh | ![impact_flesh](vfx/impact_flesh.jpg) | impact ichor | ![impact_ichor](vfx/impact_ichor.jpg) |
| impact stone | ![impact_stone](vfx/impact_stone.jpg) | impact wood | ![impact_wood](vfx/impact_wood.jpg) |
| impact metal | ![impact_metal](vfx/impact_metal.jpg) | blood red | ![blood_red](vfx/blood_red.jpg) |
| blood dark | ![blood_dark](vfx/blood_dark.jpg) | blood black | ![blood_black](vfx/blood_black.jpg) |
| blood ichor | ![blood_ichor](vfx/blood_ichor.jpg) | torch | ![torch](vfx/torch.jpg) |
| brazier | ![brazier](vfx/brazier.jpg) | burning house | ![burning_house](vfx/burning_house.jpg) |
| smoke column | ![smoke_column](vfx/smoke_column.jpg) | culvert explosion | ![culvert_explosion](vfx/culvert_explosion.jpg) |
| rain | ![rain](vfx/rain.jpg) | storm lightning | ![storm_lightning](vfx/storm_lightning.jpg) |
| snow | ![snow](vfx/snow.jpg) | embers | ![embers](vfx/embers.jpg) |
| ash | ![ash](vfx/ash.jpg) | mirkwood spores | ![mirkwood_spores](vfx/mirkwood_spores.jpg) |
| dust motes | ![dust_motes](vfx/dust_motes.jpg) | barrel splash | ![barrel_splash](vfx/barrel_splash.jpg) |
| rapids foam | ![rapids_foam](vfx/rapids_foam.jpg) | focus screen | ![focus_screen](vfx/focus_screen.jpg) |
| damage vignette | ![damage_vignette](vfx/damage_vignette.jpg) | cinematic letterbox | ![cinematic_letterbox](vfx/cinematic_letterbox.jpg) |

## Props

[26 prop targets](props/props.json) · [Prop notes](props/notes.md). Six sheets with front and three-quarter looks, target dimensions and script-drawn 1.85 m silhouettes. Each panel uses its own explicit metre scale.

| Sheet | Preview |
|---|---|
| containers lights | ![containers_lights](props/containers_lights.jpg) |
| banners | ![banners](props/banners.jpg) |
| siege | ![siege](props/siege.jpg) |
| moria tomb debris | ![moria_tomb_debris](props/moria_tomb_debris.jpg) |
| laketown mirkwood | ![laketown_mirkwood](props/laketown_mirkwood.jpg) |
| black gate | ![black_gate](props/black_gate.jpg) |

## Key art

[Composition targets](key-art/key-art-spec.json)

![Journey poster](key-art/poster.jpg)

![Repository banner](key-art/readme_banner.jpg)

## Current-render comparisons

Ten lighting fixtures and nine available vignettes were captured with headless Chromium; capture logs are [here](scenes/current-capture-results.json) and [here](scenes/current-vignette-results.json). Each chapter has five visually ordered gaps in its notes. Static lab views and whole-world fitted cameras do not establish missing gameplay features. The barrel chapter uses the `woods` vignette as a foliage proxy.
