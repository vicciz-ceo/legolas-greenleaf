# Rohirrim modelling notes

- Rohirrim human soldier: original weathered bearded face; mail shirt, green tunic, round steel helm with horsehair crest, brown boots; sword in own RIGHT hand, round painted wood shield with horse motif on own LEFT arm.
- Preserve the original face; no actor likeness.
- Keep gear on its own anatomical side under rotation.
- Build surface weave, skin and hair as procedural detail.
- Do not infer 3D dimensions from the image normalization.
- Design palette and roughness are targets; observed pixels are rendered and lit, not albedo.
- Minor seams, buckle shapes, strap count and mild light differences may vary.
- Maintain natural joints and all required limb and digit counts.

All body views and portraits reviewed individually. First front rejected for narrow sword-arm pose; second passes. Sword own RIGHT, round horse shield own LEFT, shield rear wood/straps visible in back view, far-side shield occluded from right profile. Minor horse painting, bronze trim, mail-ring and strap drift tolerated. Skin/hair tiles crop independent portraits; costume/shield separately generated. Fine hair background removed and reviewed. Samples cover lit skin/hair, tunic, trousers, boots, belt, strap, bracers, steel mail/boss and bronze rim; not albedo.

Studio backdrop in costume macro replaced through code segmentation; original appearance pixels and full-resolution source retained. Sampling regions reviewed against visible material boundaries; concealed material exceptions have null values instead of invented colours.
