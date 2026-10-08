# Elf Mirkwood modelling notes

- Mirkwood male elf guard: original face, pointed ears, dark brown long hair; gold-bronze leaf-pattern cuirass, green cloak, leaf-crested helmet, green tunic, brown boots; elegant glaive held low in own RIGHT hand, own left hand empty.
- Preserve the original face; no actor likeness.
- Keep gear on its own anatomical side under rotation.
- Build surface weave, skin and hair as procedural detail.
- Do not infer 3D dimensions from the image normalization.
- Design palette and roughness are targets; observed pixels are rendered and lit, not albedo.
- Minor seams, buckle shapes, strap count and mild light differences may vary.
- Maintain natural joints and all required limb and digit counts.

Reviewed four body views and three portraits individually. Own RIGHT glaive remains fixed through rotation. Minor leaf engraving, belt and cloak fold drift is tolerated; portraits deliberately crop shoulders. A-pose angles remain within 20–40 degrees where projected. Skin and hair tiles are crops of separately generated portrait sources; costume and glaive are independent detail generations. Fine hair and crest segmentation reviewed; material samples are rendered and lit, not albedo.

Studio backdrop in costume macro replaced through code segmentation; original appearance pixels and full-resolution source retained. Sampling regions reviewed against visible material boundaries; concealed material exceptions have null values instead of invented colours.
