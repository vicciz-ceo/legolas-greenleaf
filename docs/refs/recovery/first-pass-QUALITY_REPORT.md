# Reference generation quality report

## Outcome

Thirteen candidate PNGs were generated with the image-generation tool. Every candidate was excluded from the reference library. No image has been certified; this report is not a substitute for the requested sheets.

The tool can produce convincing costume, skin and hair images. In this pass, it did not reliably enforce the geometric relationships required for a measured development reference. Targeted edits sometimes corrected one feature while leaving or introducing another inconsistency. Numerical text in the prompt or on a generated ruler did not establish calibration.

## Review method

- Reviewed the generated images at their displayed full resolution for anatomy, character identity, camera view, costume and attachment consistency, ruler placement and labels.
- Read actual PNG dimensions from the files using Pillow.
- Created temporary 64-pixel-high previews for silhouette review; these previews are not deliverables or committed assets.
- Read selected RGB pixels from the source PNGs. These are rendered pixel values, not independently established PBR base colours.
- Used approximate manually located pixel endpoints for the scale diagnostics below. Values are explicitly approximate, rather than measurements suitable for a production character spec.
- Kept failed candidates outside `docs/refs/`; none are committed.

## Candidates and failures

| Candidate | Attempt count | Observed reason for exclusion |
| --- | --- | --- |
| Legolas turnaround | 5 | Bow/quiver handedness and knife placement changed across views in early candidates. A symmetric back rig improved attachment consistency but did not enforce the requested bow extent or approximately 30° A-pose. |
| Legolas face | 3 | Initial exact-profile ear was rounded while the other views had pointed ears. An edit corrected it. The final colour-only edit still did not produce the specified neutral background colour; no complete compatible turnaround/material set was established. |
| Legolas details | 1 | Actual file was 1254×1254 instead of the required 1024×1024. It also could not be certified against a compatible accepted turnaround. |
| Gimli turnaround | 2 | Initial height endpoint aligned with the helmet point rather than the skull crown. The ruler-correction edit changed the composition and still failed to align the anatomical height with the ruler; arms remained insufficiently spread. |
| Great eagle flight silhouette | 1 | Wing tips exceeded the ruler endpoints, and the human comparator did not agree with the labelled wingspan calibration. |
| Fell beast flight silhouette | 1 | Wing tips exceeded the ruler endpoints, and the human comparator did not agree with the labelled wingspan calibration. |

The twelve landscape candidates were 1536×1024. The one square candidate was 1254×1254. Correct canvas dimensions on a landscape candidate did not resolve its other failures.

## Concrete scale diagnostics

All pixel coordinates below refer to the generated 1536×1024 candidates. Coordinates and traced endpoints are approximate. The rejected images are deliberately not included in this branch.

### Legolas, final turnaround candidate

The ruler's 1.85 m endpoint was near y=42 and zero near y=908, approximately 468 pixels per metre. In the back view, the bow extended from approximately y=9 to y=689. That is approximately 1.45 m of vertical extent, despite an edit explicitly requesting a 1.60 m extent and a lower tip near y=755. It is unsafe to put `1.6` in a spec and assert that this candidate verifies it.

Earlier candidates also put the quiver above the image-right shoulder in both front and back views, which reverses its anatomical side. Low white knife grips in the back view became a grip above the shoulder in another view. Those changes are unsuitable for tuning an attachment rig.

### Gimli, revised turnaround candidate

The revised ruler placed its 1.53 m marker near y=42 and zero near y=860. The helmet point was near y=104, rather than the 1.53 m marker. The 1.37 m marker near y=117 was also above the skull crown beneath the helmet. Adding the requested labels did not establish the intended body height.

### Great eagle, flight candidate

In the front panel, wing tips were approximately x=12 and x=879: a span of about 867 pixels. The ruler's 0–10 m endpoints were approximately x=94 and x=833: about 739 pixels. At the ruler's calibration, the depicted wingspan was about 11.7 m. The human silhouette was about 128 pixels high, or about 1.73 m at that calibration, rather than 1.85 m.

### Fell beast, flight candidate

In the front panel, wing tips were approximately x=10 and x=758: about 748 pixels. The 0–12 m ruler endpoints were approximately x=73 and x=742: about 669 pixels. At the ruler's calibration, the depicted wingspan was about 13.4 m. The human silhouette was approximately 91 pixels high, or about 1.63 m at that calibration, rather than 1.85 m.

## Colour evidence

The final Legolas face candidate received an explicit edit requesting a flat neutral `#7f7f7f` background and no colour cast. Actual background samples still differed:

| Pixel (x, y) | RGB | sRGB hex |
| --- | --- | --- |
| (10, 10) | (116, 118, 119) | `#747677` |
| (510, 90) | (116, 117, 119) | `#747577` |
| (600, 20) | (116, 117, 118) | `#747576` |
| (30, 940) | (113, 116, 119) | `#717477` |

These readings show that repeating the desired hex in an edit prompt did not force the output pixels to that value. Skin, hair and leather samples also depend on the rendered lighting, highlight and shadow; a single arbitrary pixel must not be misrepresented as verified material albedo. No PBR material spec was certified from this pass.

## Remaining work

The entire requested library remains unfinished. Most roster members were not attempted once the shared generation method failed the measurement gate; their quality cannot be inferred from these attempts. The complete coverage table is in [README.md](README.md).

A future pass needs a method that preserves one original character and its equipment under camera rotation, controls the physical dimensions independently of generated lettering, and verifies the resulting projections. Any accepted image must still pass the original quality gate. The requirements were not relaxed in this pass.
