/**
 * Troll palette and surfaces (docs/refs/cave_troll, docs/refs/war_troll). Albedos are chosen so that the
 * lab/AgX render lands on the sheets' lit sRGB medians (`spec.json` observed.samples); each entry says where
 * it comes from.
 */
import { surface } from '../../../kit/surfaces';

export const TROLL_PAL = {
  // ── cave troll ─────────────────────────────────────────────────────────────
  // hide: design #717866 reads grey-green in the lab; the sheet image and the lit skin sample (#87725c) are a
  // warm olive tan, so the albedo leans yellow-brown and quite dark (lit renders ~1.5x lighter)
  skin: 0x5c5038,
  skin2: 0x453d2c,
  // belly and chest skin is a little paler and pinker than the back (turnaround, front view)
  belly: 0x6d5f48,
  lips: 0x6a463c,
  scatter: 0x8a5a40,
  // iris #6a6445 (design); nose, ears and wart tips are pink-brown in the face sheet
  eyes: 0x9a8238,
  nose: 0x7a5646,
  wart: 0x6a5842,
  // ── war troll ──────────────────────────────────────────────────────────────
  // the war sheet's hide is a warm dark brown (lit skin sample #4a3424), not the "soot grey" of the spec text
  warSkin: 0x3f2e22,
  warSkin2: 0x2d221a,
  // ── shared gear ────────────────────────────────────────────────────────────
  // kilt: cave cloth #605044 (lit sample #463023), war leather #4b392b (lit #4a3527): one brown covers both
  kilt: 0x4a3828,
  kilt2: 0x382a1e,
  // the war kilt is smooth coarse leather (#4b392b, lit #4a3527)
  kiltLeather: 0x5a4430,
  // belts and straps: cave #503c2a (lit #46342b), war #46382c (lit #402b1e)
  leather: 0x41301f,
  leatherDark: 0x2e2218,
  // battered iron: design #57594e (sunlit highlights #978b84), the shader rusts it toward the sheet's brown
  iron: 0x5a4c40,
  // the breast and back plates read much lighter and greyer in the sheet (lit harness sample #978b84)
  plate: 0x8c867c,
  // vambraces: lit #655d55
  bracer: 0x6a6258,
  // pauldrons: lit #5f4d42, a brown-grey iron; the sheet's rust sits along the lame edges
  pauldron: 0x7a6e60,
  ironDark: 0x3a3028,
  rust: 0x6a4a34,
  // cave shackle: rusted #665b4d design, lit sample #685043
  shackle: 0x6a5240,
  chain: 0x4a4038,
  // war foot wraps #3b362a (lit #3f3028)
  wrap: 0x3a3028,
  tusk: 0xd8cca8,
  // belt buckle ring: dark battered iron
  buckle: 0x5e5446,
  bristle: 0x4e5144,
  mane: 0x2a2620,
};

export const IRON = surface('iron_rusty', { rough: 0.55, pat: { pores: 0.7 } });
export const IRON_RUSTY = surface('iron_rusty', { rough: 0.68 });
export const IRON_DARK = surface('metal_dark', { rough: 0.6 });
export const LEATHER = surface('leather_worn', { rough: 0.74 });
export const STRAP = surface('leather_worn', { rough: 0.8, pat: { scratches: 0.6 } });
export const WRAP = surface('rags', { rough: 0.9 });
export const HIDE = surface('hide', { rough: 0.8 });
