# Elf Galadhrim modelling notes

- Galadhrim male elf of Lothlorien: original face, pointed ears, long warm blond hair; ornate fluted golden armour, deep red cloak, dark leggings and boots; longbow held low in own LEFT hand, back quiver, right hand empty.
- Preserve the original face; no actor likeness.
- Keep gear on its own anatomical side under rotation.
- Build surface weave, skin and hair as procedural detail.
- Do not infer 3D dimensions from the image normalization.
- Design palette and roughness are targets; observed pixels are rendered and lit, not albedo.
- Minor seams, buckle shapes, strap count and mild light differences may vary.
- Maintain natural joints and all required limb and digit counts.

All four body views, three portraits and detail sources reviewed individually. Bow stays in own LEFT hand; quiver fixed on back own RIGHT. Minor gold engraving, hair braiding and cloak fold drift tolerated. Left body profile and right face profile are labelled separately by code. First costume detail rejected for changing leather bracer to gold; replacement accepted. Skin/hair detail tiles crop independent portrait generations. Material samples are rendered and lit, not albedo.

Bow detail cutout refined using visually reviewed corner-distance fallback; unlike the rembg mask, it preserves the complete fine bowstring. No new appearance generation or attempt reset.

Studio backdrop in costume macro replaced through code segmentation; original appearance pixels and full-resolution source retained. Sampling regions reviewed against visible material boundaries; concealed material exceptions have null values instead of invented colours.
