# Thranduil modelling notes

- Elvenking: long platinum-silver hair; dark twig crown with autumn leaves and berries; silver brocade robe under a floor-length wine-red embroidered coat; regal cold original elf face.
- Preserve the original face; no actor likeness.
- Keep gear on its own anatomical side under rotation.
- Build surface weave, skin and hair as procedural detail.
- Do not infer 3D dimensions from the image normalization.
- Design palette and roughness are targets; observed pixels are rendered and lit, not albedo.
- Minor seams, buckle shapes, strap count and mild light differences may vary.
- Maintain natural joints and all required limb and digit counts.

Tolerated drift: small embroidery and twig arrangements, gathered back hair, mild lighting. Portrait shoulder cropping is intentional; crowns remain complete. Skin and hair detail tiles use separately generated portrait/detail images with recorded crops. No metal armour or weapon is prescribed for this character; the signature-gear tile shows the crown.

Studio backdrop in costume macro replaced through code segmentation; original appearance pixels and full-resolution source retained. Sampling regions reviewed against visible material boundaries; concealed material exceptions have null values instead of invented colours.
