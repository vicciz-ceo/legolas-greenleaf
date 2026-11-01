/**
 * Troll palette and surfaces (docs/refs/cave_troll, docs/refs/war_troll). Albedos are chosen so that the
 * lab/AgX render lands on the sheets' lit sRGB medians (`spec.json` observed.samples); each entry says where
 * it comes from.
 */
import { surface } from '../../../kit/surfaces';

export const TROLL_PAL = {
  // ── cave troll ─────────────────────────────────────────────────────────────
  // hide: the design hex #717866 and the sheet image are an olive grey-tan; the lit skin sample (#87725c) is warmer.
  // The albedo sits between them, leaning olive (lit renders ~1.5x lighter and warmer than the albedo)
  skin: 0x5a5638,
  skin2: 0x474532,
  // belly and chest skin is paler and pinker than the back (turnaround, front view)
  belly: 0x6d5a48,
  lips: 0x6a463c,
  scatter: 0x8a5a40,
  // iris #6a6445 (design); ears and wart tips are pink-brown in the face sheet, the nose is nearly skin colour
  eyes: 0x9a8238,
  nose: 0x6e5a48,
  ear: 0x7a5646,
  wart: 0x625a40,
  // ── war troll ──────────────────────────────────────────────────────────────
  // the war sheet's hide is a warm dark brown (lit skin sample #4a3424), not the "soot grey" of the spec text
  warSkin: 0x3f2e22,
  warSkin2: 0x2d221a,
  // ── shared gear ────────────────────────────────────────────────────────────
  // kilt: cave cloth #605044 (lit sample #463023), war leather #4b392b (lit #4a3527): one brown covers both,
  // a little lighter because the cave kilt is burlap
  kilt: 0x54402e,
  kilt2: 0x3e3022,
  // the war kilt apron is smooth coarse leather (#4b392b, lit #4a3527)
  kiltLeather: 0x5a4430,
  // belts and straps: cave #503c2a (lit #46342b), war #46382c (lit #402b1e)
  leather: 0x41301f,
  leatherDark: 0x2e2218,
  // war iron: the sheet reads as dark cool gunmetal with orange rust only along edges and streaks
  // (design #57594e, lit pauldron #5f4d42, bracer #655d55, helm #513f35, shins #2e241b)
  iron: 0x42403c,
  plate: 0x4a443e,
  bracer: 0x46423c,
  pauldron: 0x44403a,
  ironDark: 0x36322e,
  rust: 0x7a4a2c,
  // cave shackle: rusted iron (design #665b4d, lit sample #685043), pushed to a rust orange-brown
  shackle: 0x7a4c30,
  chain: 0x4a3a30,
  // war foot wraps #3b362a (lit #3f3028)
  wrap: 0x3a3028,
  tusk: 0xd2c6a0,
  // belt buckle ring: dark battered iron
  buckle: 0x5e5446,
  bristle: 0x3c352c,
  mane: 0x2a2620,
};

/** gunmetal: dark, cool, hammered (metalness ~0.9, roughness ~0.5); rust is added separately as edge/streak accents */
export const IRON = surface('metal_dark', { rough: 0.5, pat: { scratches: 1.3, pores: 0.5 } });
export const IRON_RUSTY = surface('iron_rusty', { rough: 0.66 });
export const IRON_DARK = surface('metal_dark', { rough: 0.55 });
export const LEATHER = surface('leather_worn', { rough: 0.74 });
export const STRAP = surface('leather_worn', { rough: 0.8, pat: { scratches: 0.6 } });
export const WRAP = surface('rags', { rough: 0.9 });
export const HIDE = surface('hide', { rough: 0.8 });
/** head hide: finer pores and shallow wrinkles instead of the body's mud-crack pattern */
export const HEAD_SKIN = surface('skin_troll', { rough: 0.7, pat: { wrinkles: 0.55, leather: 0.1, pores: 1.5 } });
