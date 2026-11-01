/**
 * Men of Lake-town and other townsfolk, four looks across the seed buckets (bucket 0 is the
 * docs/refs/laketown_man sheet):
 *   0  town guard and fisher  brown knit cap, dull blue quilted jacket open over a beige linen tunic,
 *                             belt with a pouch on the left hip, dark baggy trousers, short brown
 *                             boots, shoulder-length brown curls and a full beard; both hands empty
 *   1  guard      closed quilted slate-blue gambeson, iron cap (helmet flag), moustache
 *   2  soldier    mail shirt under a red-brown leather jerkin, iron cap with nasal, goatee, a facial scar
 *   3  old hand   long tan coat with a cowl worn down, full grey beard, grey shoulder-length hair
 * Armour level adds leather shoulder caps (0.5) and bracers + mail sleeves (0.75), never on bucket 0.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, mix, shade, withHair } from './common';
import { addSkirt } from './cloth';
import { laceFront, paintScar } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptCowl, sculptPouch, sculptShoulderCap, sculptTorso } from './garments';
import { ironCap, sculptWoolCap } from './headgear';
import { DARK_STEEL, STEEL, limbGuards } from './armor';
import { torsoCentreFront } from './geo';
import { addHemSkirt, sculptHelmHair, torsoSurface } from './rohirrim_gear';
import type { HairDef } from '../../types';

/** coarse beige linen (tunic) */
const LINEN = surface('cloth', { rough: 0.92, sheen: 0.2, pat: { weave: 1.3, wrinkles: 0.3 } });
/** quilted, padded dull-blue cloth (jacket, gambeson) */
const QUILT = surface('cloth', { rough: 0.9, sheen: 0.3, pat: { weave: 1.3, wrinkles: 0.5 } });
/** dense baggy wool (trousers) */
const WOOL = surface('twill', { rough: 0.92, sheen: 0.15, pat: { weave: -0.5 } });
/** worn, scuffed brown leather (boots, belt, pouch) */
const LEATHER = surface('leather_worn', { rough: 0.74, sheen: 0.06 });

// sRGB from docs/refs/laketown_man/spec.json (design) cross-checked with observed.samples (lit),
// then corrected for how the lab renders colours (skin warmer and deeper, blues greyer)
const PALETTE = {
  skin: 0xb98563, // sheet skin_base #b98f73, lit #b47870 (sun-ruddy)
  skin2: 0xa6704f,
  lips: 0xa4655a,
  brows: 0x3f2c1d, // "natural dark brown brows"
  eyes: 0x62705e, // sheet iris #647467
  hair: 0x4a3524, // root #61452f, lit #2c1e15 (dark): between the two
  hairTip: 0x5c432c,
  beard: 0x45301f,
  jacket: 0x3a4150, // design #566473 (lit #3c3e45): a greyer, darker slate blue so it does not render royal blue
  jacketTrim: 0x362d25, // brown binding on the hem and front edges
  tunic: 0xa89878, // design #b5a58b, lit #c3ab92
  trousers: 0x4a3e32, // design #493f35, lit #382e28
  cap: 0x5e4c3b, // design #685444
  leather: 0x4a3524, // belt, pouch, boots: design #5c4431, belt lit #674b33
  boots: 0x4e3d2c, // lit #483e34
  buckle: 0x8a8a84, // pouch_fastening_metal, dull iron
};
/** belt raised to the sheet's waist (belt ~1.04 m on a 1.75 m figure) */
const BELT_RAISE = 0.09;

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
  const cy = j.chest[1];
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const kneeY = j.shin_l[1];
  const wool = surface('wool', { rough: 0.92, pat: { weave: 0.9 } });
  const cloth = surface('cloth', { rough: 0.88, sheen: 0.6 });
  const hairRng = new Rng(hashSeed('man', 'hair', b));

  const looks: ManLook[] = [
    { hair: { style: 'shoulder', color: PALETTE.hair, tipColor: PALETTE.hairTip, length: 1, density: devNum('density', 0.7) }, beard: { color: PALETTE.beard, thick: 0.05, cheeks: 0.7, chin: 0.03 } },
    { hair: { style: 'short', color: 0x211812, length: 1, density: devNum('density', 0.7) }, beard: { color: 0x1c140e, thick: 0.028, cheeks: 0.2, mustache: true } },
    { hair: { style: 'short', color: 0xa88a52, length: 0.9, density: devNum('density', 0.7) }, beard: { color: 0x9a7e4a, thick: 0.03, cheeks: 0.0, chin: 0.02 } },
    { hair: { style: 'shoulder', color: 0x908c85, length: 0.75, density: devNum('density', 0.6) }, beard: { color: 0x9a968e, thick: 0.075, cheeks: 0.9, chin: 0.05 } },
  ];
  const L = looks[b];
  const capped = b === 0;
  const helmed = ctx.helmet && (b === 1 || b === 2);

  // ── face: beard, stubble, scars ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: L.beard.stubble ? 0.55 : 0.35, mustache: L.beard.mustache !== false, cheeks: 0.7 });
    if (!L.beard.stubble) sculptBeard(ctx, { color: L.beard.color, color2: b === 0 ? 0x8a8277 : undefined, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.13, -0.02], to: [0.2, -0.3] });

  // ── hair (under the cap or helm the strand cards would poke through: sculpted curls there) ──
  if (capped) sculptHelmHair(ctx, { color: PALETTE.hair, color2: PALETTE.hairTip, length: 1.1 });
  else if (!capped)
    withHair(ctx, () => {
      addHair(ctx, { hair: L.hair, rng: hairRng, lod: 1, cap: !helmed });
    });

  // ── clothing per bucket ──
  switch (b) {
    case 0: {
      // beige linen tunic to mid-thigh under a quilted jacket that hangs open at the front
      sculptTorso(ctx, { color: PALETTE.tunic, mat: LINEN, inflate: 0.0125 * sc, hem: 0.3, sleeve: 2, neck: true, thighs: true, seams: true, color2: shade(PALETTE.tunic, 0.88), colorNoise: 0.35, neckTop: 0.012 * sc });
      addHemSkirt(ctx, { top: hipY + 0.035 * sc, bottom: hipY - (hipY - kneeY) * 0.38 * 1.05, color: PALETTE.tunic, color2: shade(PALETTE.tunic, 0.85), mat: LINEN, flare: 0.035 * sc, grow: -0.006 * sc, ragged: 0.004 * sc });
      sculptTorso(ctx, { color: PALETTE.jacket, mat: QUILT, inflate: 0.0195 * sc, hem: 0.13, sleeve: 2, neck: false, thighs: true, seams: true, noise: { amp: 0.0028 * sc, freq: 16 / sc, type: 'ridged', octaves: 2 }, color2: shade(PALETTE.jacket, 0.82), colorNoise: 0.3, frontOpen: { top: 0.052 * sc, bottom: 0.05 * sc, y1: ny - 0.015 * sc, y0: hipY - 0.04 * sc } });
      laceFront(ctx, { y0: cy - 0.1 * sc, y1: ny - 0.04 * sc, inflate: 0.0165 * sc, color: PALETTE.jacketTrim, rows: 4, spread: 0.03 });
      sculptWoolCap(ctx, { color: PALETTE.cap, color2: shade(PALETTE.cap, 0.8), pull: 0.1, droop: 0 });
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

  // belt pouch on the left hip (bucket 0: boxy flap pouch with a strap, an iron belt buckle at the front)
  if (b === 0) {
    const beltY = hipY + (0.07 + BELT_RAISE) * sc;
    // flap pouch on the left hip: rigid boxes laid on the jacket (a sculpted pouch would sink into it)
    const pp = torsoSurface(P, 0.135 * sc, beltY - 0.06 * sc, 1, 0.0195 * sc + 0.02 * sc);
    const yaw = Math.atan2(pp.n.x, pp.n.z);
    const pouch = (w: number, h: number, d: number, dy: number, dz: number, color: number) =>
      ctx.gear(new THREE.BoxGeometry(w * sc, h * sc, d * sc).translate(0, dy * sc, dz * sc).rotateY(yaw).translate(pp.p.x, pp.p.y, pp.p.z), { bone: 'hips', color, mat: LEATHER, small: true });
    pouch(0.078, 0.085, 0.036, 0, 0, PALETTE.leather);
    pouch(0.082, 0.05, 0.012, 0.03, 0.02, shade(PALETTE.leather, 1.12));
    pouch(0.016, 0.07, 0.008, -0.005, 0.027, shade(PALETTE.leather, 0.85));
    const zf = torsoCentreFront(P, beltY) + 0.02 * sc;
    ctx.gear(new THREE.BoxGeometry(0.032 * sc, 0.034 * sc, 0.008 * sc).translate(0, beltY, zf + 0.004 * sc), { bone: 'hips', color: PALETTE.buckle, mat: 'metal', small: true });
    ctx.gear(new THREE.BoxGeometry(0.018 * sc, 0.02 * sc, 0.01 * sc).translate(0, beltY, zf + 0.006 * sc), { bone: 'hips', color: PALETTE.leather, mat: LEATHER, small: true });
  } else sculptPouch(ctx, { x: b === 3 ? -0.13 * sc : 0.135 * sc, z: 0.06 * sc, size: 0.9, color: 0x3a2a1c, drop: 0.05 });

  // ── armour by level (the town guard of the sheet wears none) ──
  if (b !== 0) {
    if (A >= 0.5 && b !== 2) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.02 * sc, reach: 0.3 });
    if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: 0x5a4a38, trim: 0x7a6a50, mat: 'leather_worn', trimMat: 'metal', length: 0.5, grow: b === 1 || b === 3 ? 0.011 * sc : 0 });
  }
  if (helmed) ironCap(ctx, { color: b === 1 ? 0x6a6c70 : 0x7a7b7e, trim: 0x8a8b8e, mat: b === 1 ? DARK_STEEL : STEEL, nasal: b === 2, cheeks: b === 1 && A >= 0.5 });
  void mix;
}

export const manDef: KindDef = {
  label: 'Man',
  // 1.77 (not 1.75): the lab's idle pose lifts a foot and bends a knee at some heights (1.74, 1.75, 1.76 seen)
  height: devNum('height', 1.77),
  build: { shoulders: 1.0, bulk: 1.0, muscle: 0.4 },
  face: { jaw: 1.02, chin: 1.0, brow: 1.08, cheekbones: 1.0, nose: { length: 1.04, width: 1.0, bridge: 1.0 }, lips: { fullness: 1.0 }, ears: 'round', eyeOpen: 0.92, foreheadSlope: 0.14, asym: 0.05 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.3, blemish: 0.2, wrinkles: 0.3, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PALETTE.eyes, sclera: 0xe4ddd0 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  outfit: [
    { type: 'trousers', color: PALETTE.trousers, mat: WOOL },
    // short worn boots (sheet: tops at ~0.3 m)
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.boots, length: 0.5, thickness: 0.004, mat: LEATHER },
    { type: 'belt', color: PALETTE.leather, offset: BELT_RAISE, thickness: 0.011, mat: LEATHER },
    // spring bones only: the hem panels are built per bucket in extras
    { type: 'skirt', color: PALETTE.tunic, chance: 0 },
  ],
  armor: [],
  // the sheet: both hands empty (the group loadout may still hand out a weapon)
  weapons: { right: 'none', left: 'none' },
  palette: PALETTE,
  sfx: { voice: 'man', weight: 0.5 },
  anim: { swagger: 0.2, aggression: 0.35 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.12 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  extras: manExtras,
};
