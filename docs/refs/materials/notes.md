# Material references

37 flat appearance studies cover the 34 requested sets and the current generator’s additional birch_bark, shingles and bone sets. All images are 1024 × 1024; the JSON is the numeric authority for metre-scale tiling and procedural microfeatures. These are reference photographs, never runtime maps.

Roughness is linear [0,1]. Normal strength is a detail category; macro relief belongs in mesh geometry. Metal albedo describes conductor F0; dirt/rust areas need a separate metalness mask. Transparency for web/water/ice comes from code, not the photographed background. Water is a visual wave-frequency reference, not an encoded tangent-space normal map. Albedo ranges are design targets, not measured extrema of the concept pixels. Avoid baking shadows, large folds or reflections into generated albedo.

`../tools/compose_scenes.py` half-offsets and blends both axes, matches outer pixel boundaries, and encodes JPEG quality 88 at exactly 1024². `observed_statistics` records actual medians, percentiles and encoded edge error, separately from design targets. The overview labels and tile sizes are drawn by code.
