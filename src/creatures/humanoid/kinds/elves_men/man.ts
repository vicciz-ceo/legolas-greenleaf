/**
 * Men of Lake-town and other townsfolk, four looks across the seed buckets (bucket 0 is the
 * docs/refs/laketown_man sheet):
 *   0  town guard and fisher  brown knit cap with a rolled brim, dull blue quilted jacket open over a
 *                             beige linen tunic, belt with a pouch on the left hip, dark baggy
 *                             trousers, short brown boots, short curls and a full beard; the sheet's
 *                             hands are empty (use the lab's `&weapons=none`: a KindDef cannot give
 *                             one bucket a different weapon, `loadout.ts` picks them per seed)
 *   1  guard      closed quilted slate-blue gambeson, iron cap (helmet flag), moustache
 *   2  soldier    mail shirt under a red-brown leather jerkin, iron cap with nasal, goatee, a facial scar
 *   3  old hand   long tan coat with a cowl worn down, full grey beard, grey shoulder-length hair
 * Armour level adds leather shoulder caps (0.5) and bracers + mail sleeves (0.75), never on bucket 0.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, shade, withHair } from './common';
import { addSkirt } from './cloth';
import { paintScar } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptCowl, sculptPouch, sculptShoulderCap, sculptTorso } from './garments';
import { ironCap, sculptWoolCap } from './headgear';
import { DARK_STEEL, STEEL, limbGuards } from './armor';
import { torsoCentreFront } from './geo';
import { bootCollars, capRoll, jacketBinding } from './man_parts';
import { addHemSkirt, sculptCapCurls, torsoSurface } from './rohirrim_gear';

/** coarse beige linen (tunic) */
const LINEN = surface('cloth', { rough: 0.92, sheen: 0.2, pat: { weave: 1.3, wrinkles: 0.3 } });
/** quilted, padded dull-blue cloth (jacket, gambeson) */
const QUILT = surface('cloth', { rough: 0.9, sheen: 0.25, pat: { weave: 1.2, wrinkles: 0.35 } });
/** dense baggy wool (trousers) */
const WOOL = surface('twill', { rough: 0.92, sheen: 0.15, pat: { weave: -0.5 } });
/** worn, scuffed brown leather (boots, belt, pouch) */
const LEATHER = surface('leather_worn', { rough: 0.74, sheen: 0.06 });
/** dull iron fittings (buckle, rough: no white hot spots) */
const IRON = surface('metal', { rough: 0.55 });

// sRGB from docs/refs/laketown_man/spec.json (design) cross-checked with observed.samples (lit),
// then corrected for how the lab renders colours (skin warmer and deeper, blues greyer)
const PALETTE = {
  skin: 0xb98563, // sheet skin_base #b98f73, lit #b47870 (sun-ruddy)
  skin2: 0xa6704f,
  lips: 0xa4655a,
  brows: 0x33251a, // "natural dark brown brows": ~70 % of the hair
  eyes: 0x62705e, // sheet iris #647467
  hair: 0x4a3524, // root #61452f, lit #2c1e15 (dark): between the two
  hairTip: 0x5c432c,
  beard: 0x4a3a2c, // a fuller dark mass with some grey
  jacket: 0x3a4150, // design #566473 (lit #3c3e45): a greyer, darker slate blue so it does not render royal blue
  binding: 0x4a3a2a, // brown binding on the hem and front edges
  tunic: 0xa89878, // design #b5a58b, lit #c3ab92
  trousers: 0x4a3e32, // design #493f35, lit #382e28
  cap: 0x52402c, // design #685444, a dark wool brown
  capBrim: 0x3e2e1e,
  leather: 0x4a3524, // belt, pouch, boots: design #5c4431, belt lit #674b33
  boots: 0x4e3d2c, // lit #483e34
  buckle: 0x8a8a84, // pouch_fastening_metal, dull iron
};
/** belt at ~1.0 m (the sheet's belt sits at the waist, about 1.0-1.04 m) */
const BELT_RAISE = 0.045;
/** jacket hem (fraction of hip→knee below the hip joint) → ~0.82 m; the tunic skirt ends ~0.07 m lower */
const JACKET_HEM = 0.13;
const TUNIC_LEN = 0.37;
const JACKET_INFLATE = 0.0185;
const TUNIC_INFLATE = 0.0125;
/** boot shaft (fraction of ankle→knee): the collar flares at ~0.40 m */
const BOOT_LEN = 0.75;

interface ManLook {
  hair: HairDef;
  beard?: { color: number; thick: number; cheeks: number; chin?: number; mustache?: boolean; stubble?: boolean };
}

function manExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const b = ctxBucket(ctx);
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const kneeY = j.shin_l[1];
  const wool = surface('wool', { rough: 0.92, pat: { weave: 0.9 } });
  const cloth = surface('cloth', { rough: 0.88, sheen: 0.6 });

  const looks: ManLook[] = [
    { hair: { style: 'shoulder', color: PALETTE.hair, tipColor: PALETTE.hairTip, length: 1, density: 0.7 }, beard: { color: PALETTE.beard, thick: 0.062, cheeks: 0.75, chin: 0.035, mustache: true } },
    { hair: { style: 'short', color: 0x211812, length: 1, density: devNum('density', 0.7) }, beard: { color: 0x1c140e, thick: 0.028, cheeks: 0.2, mustache: true } },
    { hair: { style: 'short', color: 0xa88a52, length: 0.9, density: devNum('density', 0.7) }, beard: { color: 0x9a7e4a, thick: 0.03, cheeks: 0.0, chin: 0.02 } },
    { hair: { style: 'shoulder', color: 0x908c85, length: 0.75, density: devNum('density', 0.6) }, beard: { color: 0x9a968e, thick: 0.075, cheeks: 0.9, chin: 0.05 } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet && (b === 1 || b === 2);

  // ── face: beard, stubble, scars ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: L.beard.stubble ? 0.55 : 0.35, mustache: L.beard.mustache !== false, cheeks: 0.7 });
    // bucket 0: ~25 % grey flecks, but never lighter than the skin (pale facets)
    sculptBeard(ctx, { color: L.beard.color, color2: b === 0 ? 0x5b4f43 : undefined, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.13, -0.02], to: [0.2, -0.3] });

  // ── hair: short curls at the ears and nape under the cap; strand cards otherwise ──
  if (b === 0) sculptCapCurls(ctx, { color: PALETTE.hair, color2: PALETTE.hairTip });
  else
    withHair(ctx, () => {
      addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('man', 'hair', b)), lod: 1, cap: !helmed });
    });

  // ── clothing per bucket ──
  switch (b) {
    case 0: {
      // a crisp jacket layer (flat hem ~0.82 m) over a beige linen tunic with its own straight skirt
      const hemJ = hipY - (hipY - kneeY) * JACKET_HEM - 0.03 * sc;
      sculptTorso(ctx, { color: PALETTE.tunic, mat: LINEN, inflate: TUNIC_INFLATE * sc, hem: 0.23, sleeve: 2, neck: true, thighs: true, seams: true, neckTop: 0.012 * sc });
      addHemSkirt(ctx, { top: hemJ + 0.04 * sc, bottom: hipY - (hipY - kneeY) * TUNIC_LEN * 1.05, color: PALETTE.tunic, color2: shade(PALETTE.tunic, 0.9), mat: LINEN, flare: 0.03 * sc, grow: -0.01 * sc });
      sculptTorso(ctx, { color: PALETTE.jacket, mat: QUILT, inflate: JACKET_INFLATE * sc, hem: JACKET_HEM, sleeve: 2, neck: false, thighs: true, seams: true, frontOpen: { top: 0.034 * sc, bottom: 0.03 * sc, y1: ny - 0.015 * sc, y0: hemJ - 0.02 * sc } });
      jacketBinding(ctx, { color: PALETTE.binding, mat: LEATHER, yTop: ny - 0.03 * sc, yHem: hemJ, slit: [0.034 * sc, 0.03 * sc], inflate: JACKET_INFLATE * sc, toggles: 4, toggleColor: 0x5a4228 });
      sculptWoolCap(ctx, { color: PALETTE.cap, color2: shade(PALETTE.cap, 0.85), pull: 0.1, droop: 0 });
      capRoll(ctx, { color: PALETTE.capBrim, mat: surface('wool', { rough: 0.92 }), radius: 0.11 * P.headH });
      break;
    }
    case 1: {
      sculptTorso(ctx, { color: 0x3b4553, mat: QUILT, inflate: 0.0165 * sc, hem: 0.4, sleeve: 2, neck: true, seams: true, noise: { amp: 0.0032 * sc, freq: 18 / sc, type: 'ridged', octaves: 2 }, color2: 0x2e3744, colorNoise: 0.35 });
      addSkirt(ctx, { color: 0x3b4553, color2: 0x2e3744, mat: QUILT, length: 0.5 });
      break;
    }
    case 2: {
      // mail shirt with a red-brown leather jerkin over it
      sculptTorso(ctx, { color: 0x6f7076, mat: surface('mail', { rough: 0.58 }), inflate: 0.0105 * sc, hem: 0.4, sleeve: 1.0, neck: true, seams: false });
      addSkirt(ctx, { color: 0x6f7076, mat: surface('mail', { rough: 0.58 }), length: 0.5, flare: 0.05 * sc, ragged: 0.004 * sc });
      sculptTorso(ctx, { color: 0x5b3a2a, mat: 'leather_worn', inflate: 0.0175 * sc, hem: 0.15, sleeve: 0, neck: false, shoulders: false, seams: true, frontOpen: { top: 0.04 * sc, bottom: 0.012 * sc, y1: ny - 0.02 * sc } });
      sculptShoulderCap(ctx, { color: 0x3f2a1e, mat: 'leather_worn', side: 'both', inflate: 0.02 * sc, reach: 0.3 });
      break;
    }
    default: {
      // long coat with a cowl
      const coat = 0x5e5442;
      sculptTorso(ctx, { color: 0x3c372c, mat: cloth, inflate: 0.0068 * sc, hem: 0.2, sleeve: 2, neck: true, seams: true });
      sculptTorso(ctx, { color: coat, mat: wool, inflate: 0.0145 * sc, hem: 0.2, sleeve: 2, neck: false, seams: true, frontOpen: { top: 0.055 * sc, bottom: 0.014 * sc, y1: ny - 0.02 * sc } });
      addSkirt(ctx, { color: coat, color2: shade(coat, 0.8), mat: wool, length: 1.25, flare: 0.05 * sc, panels: [[-3.0, -0.32], [0.32, 3.0]], ragged: 0.01 * sc });
      sculptCowl(ctx, { color: shade(coat, 0.9), color2: shade(coat, 0.75), size: 1.1, drape: 0.05 });
      break;
    }
  }

  if (b === 0) {
    // belt buckle (an iron frame with a darker bar) and a flap pouch on the left hip, rigid boxes laid on the jacket
    const beltY = hipY + (0.07 + BELT_RAISE) * sc;
    const zf = torsoCentreFront(P, beltY) + 0.03 * sc;
    ctx.gear(new THREE.BoxGeometry(0.04 * sc, 0.038 * sc, 0.008 * sc).translate(0, beltY, zf), { bone: 'hips', color: PALETTE.buckle, mat: IRON, small: true });
    ctx.gear(new THREE.BoxGeometry(0.024 * sc, 0.022 * sc, 0.01 * sc).translate(0, beltY, zf + 0.001 * sc), { bone: 'hips', color: shade(PALETTE.leather, 0.7), mat: LEATHER, small: true });
    ctx.gear(new THREE.BoxGeometry(0.004 * sc, 0.03 * sc, 0.012 * sc).translate(0, beltY, zf + 0.003 * sc), { bone: 'hips', color: PALETTE.buckle, mat: IRON, small: true });
    const pp = torsoSurface(P, 0.13 * sc, beltY - 0.075 * sc, 1, JACKET_INFLATE * sc + 0.032 * sc);
    const yaw = Math.atan2(pp.n.x, pp.n.z);
    const box = (w: number, h: number, d: number, dy: number, dz: number, color: number) =>
      ctx.gear(new THREE.BoxGeometry(w * sc, h * sc, d * sc).translate(0, dy * sc, dz * sc).rotateY(yaw).translate(pp.p.x, pp.p.y, pp.p.z), { bone: 'hips', color, mat: LEATHER, small: true });
    box(0.13, 0.12, 0.05, 0, 0, PALETTE.leather); // body ~13 x 12 x 5 cm
    box(0.135, 0.065, 0.014, 0.04, 0.03, shade(PALETTE.leather, 1.12)); // flap
    box(0.02, 0.08, 0.01, -0.005, 0.038, shade(PALETTE.leather, 0.8)); // strap
    // short boots with a flared collar
    bootCollars(ctx, { color: PALETTE.boots, mat: LEATHER, y: P.ankleH + (kneeY - P.ankleH) * BOOT_LEN, radius: 0.057 * sc, flare: 0.014 * sc, height: 0.035 * sc });
  } else sculptPouch(ctx, { x: b === 3 ? -0.13 * sc : 0.135 * sc, z: 0.06 * sc, size: 0.9, color: 0x3a2a1c, drop: 0.05 });

  // ── armour by level (the town guard of the sheet wears none) ──
  if (b !== 0) {
    if (A >= 0.5 && b !== 2) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.02 * sc, reach: 0.3 });
    if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: 0x5a4a38, trim: 0x7a6a50, mat: 'leather_worn', trimMat: 'metal', length: 0.5, grow: b === 1 || b === 3 ? 0.011 * sc : 0 });
  }
  if (helmed) ironCap(ctx, { color: b === 1 ? 0x6a6c70 : 0x7a7b7e, trim: 0x8a8b8e, mat: b === 1 ? DARK_STEEL : STEEL, nasal: b === 2, cheeks: b === 1 && A >= 0.5 });
}

export const manDef: KindDef = {
  label: 'Man',
  // 1.77 (not 1.75): the lab's idle pose lifts a foot and bends a knee at some heights (1.74, 1.75, 1.76 seen)
  height: devNum('height', 1.77),
  build: { shoulders: 1.0, bulk: 1.0, muscle: 0.2 },
  face: { jaw: 1.02, chin: 1.0, brow: 1.08, cheekbones: 1.0, nose: { length: 1.04, width: 1.0, bridge: 1.0 }, lips: { fullness: 1.0 }, ears: 'round', eyeOpen: 0.92, foreheadSlope: 0.14, asym: 0.05 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.3, blemish: 0.2, wrinkles: 0.3, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PALETTE.eyes, sclera: 0xe4ddd0 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  outfit: [
    // a little slimmer than stock, so the tunic and jacket stand clear of them (layers closer than ~4 mm blend their colours in the 6 cm mesh)
    { type: 'trousers', color: PALETTE.trousers, thickness: -0.002, mat: WOOL },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.boots, length: BOOT_LEN, thickness: 0.004, mat: LEATHER },
    // a dark brown binding at each jacket cuff
    { type: 'bracers', color: PALETTE.binding, length: 0.12, thickness: 0.008, mat: LEATHER },
    { type: 'belt', color: PALETTE.leather, offset: BELT_RAISE, thickness: 0.011, mat: LEATHER },
    // spring bones only: the hem panels are built per bucket in extras
    { type: 'skirt', color: PALETTE.tunic, chance: 0 },
  ],
  armor: [],
  // the sheet's hands are empty, but a KindDef weapon is per kind: gameplay passes the per-seed loadout
  // (loadout.ts) and the lab takes `&weapons=none`
  weapons: { right: 'sword', left: 'none' },
  palette: PALETTE,
  sfx: { voice: 'man', weight: 0.5 },
  anim: { swagger: 0.2, aggression: 0.35 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.12 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  extras: manExtras,
};
