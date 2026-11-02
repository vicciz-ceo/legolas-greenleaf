/**
 * Troll palette and surfaces (docs/refs/cave_troll, docs/refs/war_troll). Albedos are chosen so that the
 * lab/AgX render lands on the sheets' lit sRGB medians (`spec.json` observed.samples); each entry says where
 * it comes from.
 */
import * as THREE from 'three';
import { surface } from '../../../kit/surfaces';

export const TROLL_PAL = {
  // ── cave troll ─────────────────────────────────────────────────────────────
  // hide: the design hex #717866 and the sheet image are an olive grey-tan; the lit skin sample (#87725c) is warmer.
  // The albedo is a desaturated tan-olive khaki (greens render minty under sky light); the shoulders and back get a darker olive mottle
  skin: 0x52452c,
  skin2: 0x3e3826,
  // belly and chest skin is paler and pinker than the back (turnaround, front view)
  belly: 0x5f5238,
  /** darker olive mottle over the shoulders and back */
  back: 0x403e2a,
  lips: 0x6a463c,
  scatter: 0x8a5a40,
  // iris #6a6445 (design); ears and wart tips are pink-brown in the face sheet, the nose is nearly skin colour
  eyes: 0x9a8238,
  nose: 0x74684a,
  ear: 0x75684a,
  wart: 0x5e5438,
  // ── war troll ──────────────────────────────────────────────────────────────
  // the war sheet's hide is a warm dark brown (lit skin sample #4a3424), not the "soot grey" of the spec text
  warSkin: 0x3f2e22,
  warSkin2: 0x2d221a,
  // ── shared gear ────────────────────────────────────────────────────────────
  // kilt: cave cloth #605044 (lit sample #463023), war leather #4b392b (lit #4a3527): one brown covers both,
  // a little lighter because the cave kilt is burlap
  kilt: 0x483323,
  kilt2: 0x5a3a24,
  // the war kilt apron is smooth coarse leather (#4b392b, lit #4a3527)
  kiltLeather: 0x5a4430,
  // belts and straps: cave #503c2a (lit #46342b), war #46382c (lit #402b1e)
  leather: 0x41301f,
  leatherDark: 0x2e2218,
  // war iron: the sheet reads as dark cool gunmetal with orange rust only along edges and streaks
  // (design #57594e, lit pauldron #5f4d42, bracer #655d55, helm #513f35, shins #2e241b)
  // one value family for every plate (lit samples: harness #978b84, pauldron #5f4d42, bracer #655d55, helm #513f35)
  iron: 0x6a6560,
  plate: 0x6a6560,
  bracer: 0x625d58,
  pauldron: 0x645f5a,
  ironDark: 0x4a4640,
  /** bright worn edges */
  edge: 0x9a948a,
  rust: 0x8a4e28,
  // cave shackle: rusted iron (design #665b4d, lit sample #685043), pushed to a rust orange-brown
  shackle: 0x7a4c30,
  chain: 0x4a3a30,
  // war foot wraps #3b362a (lit #3f3028)
  wrap: 0x4a3a2a,
  tusk: 0xd2c6a0,
  // belt buckle ring: dark battered iron
  buckle: 0x5e5446,
  bristle: 0x3a3028,
  mane: 0x2a2620,
};

/** mid-grey gunmetal (metalness 0.7, roughness 0.55 so it does not mirror the sky); rust is added per vertex by `rustPatches` */
export const IRON = surface('metal_dark', { rough: 0.55, metal: 0.7, pat: { scratches: 1.1, pores: 0.6 } });
export const IRON_RUSTY = surface('iron_rusty', { rough: 0.66 });
export const IRON_DARK = surface('metal_dark', { rough: 0.58, metal: 0.65 });
export const LEATHER = surface('leather_worn', { rough: 0.74 });
export const STRAP = surface('leather_worn', { rough: 0.8, pat: { scratches: 0.6 } });
export const WRAP = surface('rags', { rough: 0.9 });
export const HIDE = surface('hide', { rough: 0.8 });
/** head hide: finer pores and shallow wrinkles instead of the body's mud-crack pattern */
export const HEAD_SKIN = surface('skin_troll', { rough: 0.72, pat: { wrinkles: 0.6, leather: 0.22, pores: 1.4 } });

/** rust-orange patches on gunmetal: a cheap 3-d value noise tints the vertex colour toward `rust` in blotches */
export function rustPatches(rust: number, amount = 0.5, freq = 4.2) {
  const rc = new THREE.Color().setHex(rust, THREE.SRGBColorSpace);
  const h = (x: number, y: number, z: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const noise = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sm = (t: number) => t * t * (3 - 2 * t);
    const u = sm(fx), v = sm(fy), w = sm(fz);
    let acc = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      acc += h(ix + dx, iy + dy, iz + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return acc;
  };
  return (p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color) => {
    const t = noise(p.x * freq, p.y * freq, p.z * freq) * 0.75 + noise(p.x * freq * 3, p.y * freq * 3, p.z * freq * 3) * 0.25;
    const k = Math.min(1, Math.max(0, (t - 0.58) / 0.16)) * amount;
    c.lerp(rc, k);
  };
}
