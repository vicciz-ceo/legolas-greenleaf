# Scenes / graphics quality report

Based on foundation commit `7ab3afd`. Final required coverage: **160 output reference images**, plus **181 retained unlabelled look inputs**, **10 labelled palette-region images**, and **19 current-render captures** (370 raster files total). No requested section or final reference was skipped. Originals and discarded attempts remain outside the committed library.

## Validation and visual review

- Script validation: **1107 checks, zero errors** at the report run. See [machine results](tools/validation-scenes.json); final total bytes are recorded there after this report is written.
- Library size at this report run: **110.80 MB**, below the 120,000,000-byte cap. Photographic art and browser screenshots use JPEG quality 88; explicitly named diagram outputs retain PNG.
- All 160 final outputs and their retained look inputs were checked using labelled contact sheets. Anatomy/action details, suspicious generated marks and corrective prop/effect looks received full-size review. The [image audit](tools/visual-review-scenes.json) records hashes and dimensions of the accepted files.
- Exact resolutions, lighting field names/sky discriminants/weather values, recommended/current comparisons, palette medians, material boundary errors, two prop views, touch sizes/safe bounds/non-overlap and CSS/JSON geometry pass code validation.
- Thirteen native HTML/CSS/SVG mockups rendered in Playwright/system Chromium, with no browser or missing-resource errors. Font and DOM rectangle measurements are saved in [the UI measurement file](ui/mockup-measurements.json). All nine touch actions are at least 56 px.
- Ten lighting fixtures and nine available vignettes were captured from the base code with no recorded browser errors. Current captures are labelled as lab fixtures/static builder views, not full chapter validation. Every scene note lists five visible differences, ordered by impact.

## Rejected, replaced and superseded work

The production cap is four attempts per image. No final look exhausted that cap. Corrective unlabelled looks used at most two attempts; where an older pre-amendment generated sheet existed, the replacement path stayed within three model calls for that effect. Code composition changes are not model attempts.

| Asset / family | Failure or amendment conflict | Resolution |
|---|---|---|
| Initial generated gameplay views | Foreground player occupied roughly 60–70% of frame height; Helm’s Deep read as dawn and the Black Gate showed relief imagery too early. | Fresh player-level backgrounds; exact camera projects a code-drawn 1.85 m schematic player. Main siege is storm night; eagles remain late. |
| Original generated storyboard grids | Captions and grid geometry came from the image model. | Discarded after amendment; six individually generated unlabelled looks per scene, with grid/captions composed in PIL. |
| Initial Amon Hen storyboard request | Image generation rejected the first request; the non-graphic revision succeeded. | That whole-sheet output was subsequently superseded by individual unlabelled beat frames. No rejected output is retained. |
| Mirkwood intro frame | Initial batch did not deliver the expected local input. | Second request delivered the accepted intro look. |
| Mirkwood rescue frame | Ambiguous extra cocoons conflicted with the four-dwarf rescue target. | Second look has four distinct cocoons; the plan also marks the four rescue positions. |
| Amon Hen Lurtz close-up | An early look included a generated grey calibration figure, ruler and stray numeric marks. | Second look removed every calibration mark; only the script draws the final legend. |
| Menu vista | Initial hero had a dominant building inconsistent with the calm woodland-river background. | Replaced by the accepted quiet river look; native menu mockups use the unlabelled source. |
| Helm’s Deep chapter card | Initial banner showed the dawn transition. | Replaced with a storm-night crop and code-controlled dark left region. |
| Earlier VFX sheets | Model-drawn rulers/labels violated the amendment. | Removed; code creates headers, timestamps, metre legends and six target-integration frames. |
| VFX `blood_red`, `ash`, `dust_motes`, `embers`, `rain`, `snow`, `storm_lightning` | Several outputs prioritised architecture rather than the isolated effect. | Second unlabelled looks isolate each effect on a dark neutral background. |
| VFX `blood_black` | Fluid was red-brown instead of black. | Second look uses black fluid with grey reflected highlights. |
| Generated Focus/damage/letterbox looks | Redundant with exact code-produced screen effects. | Discarded; CPU filters apply the design parameters to the unlabelled Mirkwood look. |
| Well | Outdoor roof/winch did not match the low chamber well and would distort at the target height. | Second look is a roofless circular stone curb and open shaft. |
| Dwarf hammer banner | Physical hammer replaced the requested cloth emblem. | Second look is embroidered hammer heraldry on wool. |
| Web sheet | Bundled cocoon obscured the required open silk sheet. | Second look is a wide web with open holes and fine fibres. |
| Siege ladder | Generated rung count was not a reliable construction measurement. | Two look attempts; final binding 72-rung geometry is rendered by code at 0.30 m spacing, with generated timber supplying its surface look. |
| Black Gate detail | Initial look represented two doors as one leaf and used an overly elaborate tower crown. | Second looks use a single braced iron leaf and an original square basalt tower with simple iron teeth. |
| Prop-sheet composition | Adjacent views/figures and labels overlapped in several panels. | Code reserves a complete silhouette-width gutter and fits both views within each panel. |
| Plan geometry | Draft generic structure placement did not consistently connect checkpoints and set-pieces. | Gate/bridge/house positions, curved wall, chamber pillar grid, falling blocks and explicit climb/flight/chase routes reconciled in JSON and re-rendered. |
| HUD | Health wording crowded the objective; touch ARROW grazed DASH; rotated Focus bounds needed explicit semantics. | Compact single-line status, separate objective, 6 px button gap and measured rotated rectangles. |

## Measurement limits

All lighting intensities, particle budgets, real dimensions, material properties and prop construction values are **design targets**, not surveyed or inferred from generated perspective art. Palette observations are encoded-sRGB pixel medians from labelled rectangles; absent/unambiguous sky, sun or emissive samples are null rather than guessed.

The gameplay image model supplies background appearance. The code-calibrated player is deliberately a schematic original silhouette; the parallel character sheets remain the character-look authority. Hero scale figures are separate legends, not photogrammetric anchors for the perspective scene. Prop views are fitted orthographic target presentations. VFX timelines are illustrative seeded CPU integration rather than captures of actual game emitters. Weather hero looks are close appearance studies; use the numeric size/rate targets for gameplay density.

The burning-house effect is a prototype and does not change the intact Lake-town raid into the later destruction. No visible Balrog is introduced in Moria. Eagle arrival and dawn relief remain in their late story beats.

All work is development-only and stays inside the authorised reference directories, tools directory and scene quality/index files. Game code, character references and `docs/refs/README.md` are untouched.
