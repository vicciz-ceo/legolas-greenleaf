/**
 * Men of Lake-town and other townsfolk soldiers, four looks across the seed buckets:
 *   0  fisherman  faded brown wool tunic with rolled sleeves, leather vest, scarf, wool cap, stubble
 *   1  guard      quilted slate-blue gambeson, iron cap (helmet flag), leather bracers, moustache
 *   2  soldier    mail shirt under a red-brown leather jerkin, iron cap with nasal, goatee, a facial scar
 *   3  old hand   long tan coat with a cowl worn down, full grey beard, grey shoulder-length hair
 * Armour level adds leather shoulder caps (0.5) and bracers + mail sleeves (0.75).
 */
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, shade, withHair } from './common';
import { addSkirt } from './cloth';
import { laceFront, paintScar } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptCowl, sculptPouch, sculptShoulderCap, sculptTorso } from './garments';
import { ironCap, sculptWoolCap } from './headgear';
import { DARK_STEEL, STEEL, limbGuards } from './armor';
import type { HairDef } from '../../types';

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
  const wool = surface('wool', { rough: 0.92, pat: { weave: 0.9 } });
  const cloth = surface('cloth', { rough: 0.88, sheen: 0.6 });
  const quilt = surface('cloth', { rough: 0.9, sheen: 0.4, pat: { weave: 1.2, wrinkles: 0.4 } });
  const hairRng = new Rng(hashSeed('man', 'hair', b));

  const looks: ManLook[] = [
    { hair: { style: 'short', color: 0x4c3622, length: 1, density: devNum('density', 0.7) }, beard: { color: 0x3a2818, thick: 0.02, cheeks: 0.5, stubble: true } },
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
    if (!L.beard.stubble) sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.13, -0.02], to: [0.2, -0.3] });
  if (b === 0) paintScar(ctx, { from: [-0.1, 0.18], to: [-0.2, 0.06], width: 0.008 });

  // ── hair (under the cap or helm the cap is not needed) ──
  withHair(ctx, () => {
    addHair(ctx, { hair: L.hair, rng: hairRng, lod: 1, hooded: capped, cap: !capped && !helmed });
  });

  // ── clothing per bucket ──
  switch (b) {
    case 0: {
      const tunic = 0x6d5b3f;
      sculptTorso(ctx, { color: tunic, mat: wool, inflate: 0.008 * sc, hem: 0.3, sleeve: 1.0, neck: true, seams: true, color2: 0x5a4a32, colorNoise: 0.4 });
      addSkirt(ctx, { color: tunic, color2: 0x5a4a32, mat: wool, length: 0.45, ragged: 0.006 * sc });
      // leather vest, laced
      sculptTorso(ctx, { color: 0x4a3626, mat: 'leather_worn', inflate: 0.0165 * sc, hem: 0.05, sleeve: 0, neck: false, shoulders: false, seams: true, frontOpen: { top: 0.04 * sc, bottom: 0.012 * sc, y1: ny - 0.02 * sc } });
      laceFront(ctx, { y0: cy - 0.06 * sc, y1: ny - 0.03 * sc, inflate: 0.0125 * sc, color: 0x2a1e14, rows: 4, spread: 0.018 });
      sculptCowl(ctx, { color: 0x7c4c3a, color2: 0x5a3426, size: 0.8 });
      sculptWoolCap(ctx, { color: 0x4f5b66, color2: 0x3e4852, pull: 0.12, droop: 0 });
      break;
    }
    case 1: {
      sculptTorso(ctx, { color: 0x3b4553, mat: quilt, inflate: 0.0165 * sc, hem: 0.4, sleeve: 2, neck: true, seams: true, noise: { amp: 0.0032 * sc, freq: 18 / sc, type: 'ridged', octaves: 2 }, color2: 0x2e3744, colorNoise: 0.35 });
      addSkirt(ctx, { color: 0x3b4553, color2: 0x2e3744, mat: quilt, length: 0.5 });
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
  sculptPouch(ctx, { x: b === 3 ? -0.13 * sc : 0.135 * sc, z: 0.06 * sc, size: 0.9, color: 0x3a2a1c, drop: 0.05 });

  // ── armour by level ──
  if (A >= 0.5 && b !== 2) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.02 * sc, reach: 0.3 });
  if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: 0x5a4a38, trim: 0x7a6a50, mat: 'leather_worn', trimMat: 'metal', length: 0.5, grow: b === 1 || b === 3 ? 0.011 * sc : 0 });
  if (helmed) ironCap(ctx, { color: b === 1 ? 0x6a6c70 : 0x7a7b7e, trim: 0x8a8b8e, mat: b === 1 ? DARK_STEEL : STEEL, nasal: b === 2, cheeks: b === 1 && A >= 0.5 });
}

export const manDef: KindDef = {
  label: 'Man',
  height: 1.78,
  build: { shoulders: 1.0, bulk: 1.0, muscle: 0.4 },
  face: { jaw: 1.02, chin: 1.0, brow: 1.08, cheekbones: 1.0, nose: { length: 1.04, width: 1.0, bridge: 1.0 }, lips: { fullness: 1.0 }, ears: 'round', eyeOpen: 0.92, foreheadSlope: 0.14, asym: 0.05 },
  skin: { color: 0xd1a487, color2: 0xb98568, blotch: 0.3, blemish: 0.2, wrinkles: 0.3, lips: 0xa7685f, brows: 0x4a3626, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: 0x5a4a32, sclera: 0xe4ddd0 },
  hair: noKitHair(0xd1a487),
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x4a4034 },
    { type: 'boots', color: 0x3a2a1c, color2: 0x2a1e14, length: 0.85 },
    { type: 'belt', color: 0x2a1e14 },
    // spring bones only: the hem panels are built per bucket in extras
    { type: 'skirt', color: 0x6d5b3f, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'none' },
  sfx: { voice: 'man', weight: 0.5 },
  anim: { swagger: 0.2, aggression: 0.35 },
  variation: { height: 0.04, bulk: 0.08, skin: 0.12 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  extras: manExtras,
};
