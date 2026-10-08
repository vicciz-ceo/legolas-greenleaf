/**
 * Kit — surface presets.
 *
 * Every SDF primitive (and every rigid attachment built with `paintGeometry`) carries one of
 * these. They become per-vertex attributes read by the creature detail shader (material.ts):
 *   surf = (roughness, metalness, sheen, skin-scatter)
 *   pat0 = (pores, weave, leather, scales)        — detail pattern weights (may exceed 1)
 *   pat1 = (chitin, fur, scratches, wrinkles)
 */
export interface SurfaceSpec {
  rough: number;
  metal: number;
  /** cloth sheen amount 0..1 */
  sheen: number;
  /** subsurface-style wrap lighting 0..1 */
  skin: number;
  /** pattern weights [pores, weave, leather, scales, chitin, fur, scratches, wrinkles] */
  pat: number[];
}

export const PATTERNS = ['pores', 'weave', 'leather', 'scales', 'chitin', 'fur', 'scratches', 'wrinkles'] as const;
export type PatternName = (typeof PATTERNS)[number];

const S = (rough: number, metal: number, sheen: number, skin: number, pat: Partial<Record<PatternName, number>>): SurfaceSpec => ({
  rough,
  metal,
  sheen,
  skin,
  pat: PATTERNS.map((p) => pat[p] ?? 0),
});

export const SURFACES = {
  /** smooth human/elf skin with pores (a faint velvet sheen for peach fuzz) */
  skin: S(0.5, 0, 0.12, 1, { pores: 1, wrinkles: 0.06 }),
  /** weathered human skin (dwarves, rangers) */
  skin_weathered: S(0.56, 0, 0, 0.9, { pores: 1.3, wrinkles: 0.35 }),
  /** orc/goblin skin: coarse, scarred */
  skin_orc: S(0.62, 0, 0, 0.55, { pores: 1.5, wrinkles: 0.7, leather: 0.2 }),
  /** troll hide: thick, deeply wrinkled */
  skin_troll: S(0.78, 0, 0, 0.3, { pores: 1.0, wrinkles: 1.3, leather: 0.5 }),
  lips: S(0.38, 0, 0.05, 1, { pores: 0.25, wrinkles: 0.05 }),
  /** finger/toe nails, claws, horns */
  nail: S(0.38, 0, 0, 0.1, { wrinkles: 0.25 }),
  horn: S(0.55, 0, 0, 0, { wrinkles: 0.8, scratches: 0.3 }),
  bone: S(0.6, 0, 0, 0.15, { pores: 0.4, wrinkles: 0.25 }),
  teeth: S(0.32, 0, 0, 0.3, { pores: 0.2 }),
  /** wet eye surface (for sculpted eyes; separate eye meshes use their own material) */
  eye: S(0.08, 0, 0, 0, {}),
  /** woven cloth (tunics, leggings) */
  cloth: S(0.86, 0, 1, 0, { weave: 1 }),
  /** fine linen/silk */
  linen: S(0.74, 0, 0.7, 0, { weave: 0.7 }),
  /** heavy wool (cloaks) */
  wool: S(0.94, 0, 1, 0, { weave: 0.6, fur: 0.35 }),
  /** rough sack/rags (goblins) */
  rags: S(0.95, 0, 0.6, 0, { weave: 1.2, wrinkles: 0.4 }),
  leather: S(0.6, 0, 0.12, 0, { leather: 1, scratches: 0.15 }),
  /** soft suede (Legolas' jerkin) */
  suede: S(0.82, 0, 0.45, 0, { leather: 0.55, fur: 0.15 }),
  /** dark worn leather (orc armour straps) */
  leather_worn: S(0.68, 0, 0.08, 0, { leather: 1.2, scratches: 0.4, wrinkles: 0.3 }),
  metal: S(0.32, 1, 0, 0, { scratches: 1 }),
  metal_dark: S(0.5, 1, 0, 0, { scratches: 1.2, pores: 0.3 }),
  /** rusty crude orc iron */
  metal_rusty: S(0.72, 0.75, 0, 0, { scratches: 1.0, pores: 1.2, wrinkles: 0.3 }),
  gold: S(0.24, 1, 0, 0, { scratches: 0.5 }),
  mail: S(0.42, 1, 0, 0, { scales: 1.4, scratches: 0.5 }),
  wood: S(0.66, 0, 0, 0, { fur: 0.9, wrinkles: 0.3 }),
  chitin: S(0.3, 0, 0, 0.05, { chitin: 1 }),
  scales: S(0.55, 0, 0, 0.2, { scales: 1 }),
  /** short fur (sculpted pelts; use strand ribbons for long fur) */
  fur: S(0.92, 0, 0.7, 0, { fur: 1.3 }),
  /** sculpted hair volume under hair cards */
  hair: S(0.55, 0, 0.35, 0, { fur: 0.55 }),
  /** thick animal hide (wargs, mûmak) */
  hide: S(0.78, 0, 0.1, 0.25, { leather: 0.5, wrinkles: 0.9, pores: 0.5 }),
  /** bat-wing membrane */
  membrane: S(0.58, 0, 0.1, 0.8, { wrinkles: 0.7, pores: 0.4 }),
  stone: S(0.85, 0, 0, 0, { pores: 1.5, wrinkles: 0.8 }),
} satisfies Record<string, SurfaceSpec>;

export type SurfaceName = keyof typeof SURFACES;

/** derive a surface with overrides, e.g. surface('leather', { rough: 0.8 }) */
export function surface(base: SurfaceName, o: Partial<Omit<SurfaceSpec, 'pat'>> & { pat?: Partial<Record<PatternName, number>> } = {}): SurfaceSpec {
  const b = SURFACES[base];
  const pat = b.pat.slice();
  if (o.pat) PATTERNS.forEach((p, i) => (o.pat![p] !== undefined ? (pat[i] = o.pat![p]!) : 0));
  return { rough: o.rough ?? b.rough, metal: o.metal ?? b.metal, sheen: o.sheen ?? b.sheen, skin: o.skin ?? b.skin, pat };
}
