/**
 * Soldiers of Rohan: a mail hauberk under a short green or brown tunic, leather belt and bracers,
 * a round steel helm with a gilt rim, nasal bar, cheek plates and a horsehair crest (the shield is
 * the kit's painted sun-ray round shield, `weapons.style: 'rohan'`). Four looks:
 *   0  green tunic, long straight blond hair and beard, white crest, green cloak
 *   1  brown tunic, dark hair, moustache, black crest, no cloak
 *   2  green-grey tunic, long auburn hair and beard, chestnut crest, brown cloak, a scar
 *   3  brown tunic with red trim, grey hair with side braids, grey beard, white crest, no cloak
 * Armour level adds leather shoulder caps (0.5) and bracer guards (0.75).
 */
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, mix, shade, withHair } from './common';
import { addCloak, addSkirt } from './cloth';
import { paintScar } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptPouch, sculptShoulderCap, sculptTorso } from './garments';
import { STEEL, limbGuards } from './armor';
import { rohanHelm } from './headgear';

interface RohLook {
  tunic: number;
  trim: number;
  cloak?: number;
  crest: number;
  helm: number;
  hair: HairDef;
  beard?: { color: number; thick: number; cheeks: number; chin?: number; mustache?: boolean };
}

function rohirrimExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const b = ctxBucket(ctx);
  const cloth = surface('cloth', { rough: 0.86, sheen: 0.55, pat: { weave: 1 } });
  const wool = surface('wool', { rough: 0.9 });
  const dn = devNum('density', 0.38);
  const looks: RohLook[] = [
    { tunic: 0x405a31, trim: 0xb08a48, cloak: 0x39502d, crest: 0xe6e2d6, helm: 0x8a8c8e, hair: { style: 'long_straight', color: 0xb9985a, tipColor: 0xcdb178, length: 0.8, density: dn }, beard: { color: 0xa88a4e, thick: 0.06, cheeks: 0.6, chin: 0.02 } },
    { tunic: 0x6b4a2c, trim: 0x8a6a30, crest: 0x1d1a18, helm: 0x6e7074, hair: { style: 'shoulder', color: 0x3a2a1c, tipColor: 0x4a382a, length: 0.9, density: dn }, beard: { color: 0x2e2016, thick: 0.03, cheeks: 0.1, mustache: true } },
    { tunic: 0x58613f, trim: 0xa07a3c, cloak: 0x5f4528, crest: 0x7c3f1e, helm: 0x8a8a88, hair: { style: 'long_straight', color: 0x7a3d1d, tipColor: 0x90502a, length: 0.85, density: dn }, beard: { color: 0x6e3718, thick: 0.05, cheeks: 0.5, chin: 0.015 } },
    { tunic: 0x6e5030, trim: 0x8e3a26, crest: 0xe0dccf, helm: 0x7a7c7e, hair: { style: 'long_straight', color: 0x8e8a80, tipColor: 0xa29e94, length: 0.75, density: dn }, beard: { color: 0x9a968c, thick: 0.075, cheeks: 0.7, chin: 0.04 } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet;
  const mailMat = surface('mail', { rough: 0.58, pat: { scales: 1.5, scratches: 0.5 } });

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: 0.3, mustache: L.beard.mustache !== false, cheeks: 0.5 });
    sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [-0.15, 0.02], to: [-0.2, -0.28] });

  // ── hair ──
  withHair(ctx, () => {
    addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('rohirrim', 'hair', b)), lod: 1, backClear: L.cloak ? 1.3 : 1.0, cap: !helmed });
  });

  // ── mail hauberk and the tunic over it ──
  sculptTorso(ctx, { color: 0x6d6e74, mat: mailMat, inflate: 0.0115 * sc, hem: 0.42, sleeve: 1.0, neck: true, seams: false });
  addSkirt(ctx, { color: 0x6d6e74, mat: mailMat, length: 0.56, flare: 0.02 * sc, ragged: 0.004 * sc });
  sculptTorso(ctx, { color: L.tunic, mat: cloth, inflate: 0.0195 * sc, hem: 0.18, sleeve: 0, neck: false, shoulders: false, seams: true, color2: mix(L.tunic, L.trim, 0.5), colorNoise: 0.15 });
  addSkirt(ctx, { color: L.tunic, color2: L.trim, mat: cloth, length: 0.4, flare: 0.058 * sc });
  if (L.cloak !== undefined) addCloak(ctx, { color: L.cloak, color2: shade(L.cloak, 0.7), mat: wool, length: 0.8, mantle: true });
  sculptPouch(ctx, { x: 0.13 * sc, z: 0.06 * sc, size: 0.9, color: 0x3a2a1c, drop: 0.05 });
  if (A >= 0.5) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.021 * sc, reach: 0.3 });
  if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: 0x5a4632, trim: 0x8a7a5a, mat: 'leather_worn', trimMat: 'metal', length: 0.5 });

  // ── the helm with its horsehair crest ──
  if (helmed) rohanHelm(ctx, { color: L.helm, trim: L.trim, mat: STEEL, trimMat: 'gold', crest: L.crest, rng: new Rng(hashSeed('rohirrim', 'crest', b)), plumeLen: 1.2 });
}

export const rohirrimDef: KindDef = {
  label: 'Rohirrim',
  height: 1.82,
  build: { shoulders: 1.05, bulk: 1.05, chest: 1.03, neckThick: 1.1, muscle: 0.5, handSize: 1.04 },
  face: { jaw: 1.05, chin: 1.0, brow: 1.05, cheekbones: 1.02, nose: { length: 1.0, width: 0.98, bridge: 1.03 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.95, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: 0xdbb093, color2: 0xc79a7c, blotch: 0.28, blemish: 0.12, wrinkles: 0.22, lips: 0xaa6d64, brows: 0x6a5232, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: 0x6f8896, sclera: 0xe8e2d6 },
  hair: noKitHair(0xdbb093),
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x4a3e2c },
    { type: 'boots', color: 0x3a2a1c, color2: 0x2a1e14, length: 0.9 },
    { type: 'belt', color: 0x3a2a1c },
    // spring bones only: hem panels and cloaks are built per bucket in extras
    { type: 'skirt', color: 0x405a31, chance: 0 },
    { type: 'cloak', color: 0x39502d, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'shield', style: 'rohan' },
  sfx: { voice: 'man', weight: 0.55 },
  anim: { swagger: 0.2, aggression: 0.4, stance: 1.04 },
  variation: { height: 0.04, bulk: 0.07, skin: 0.08 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  extras: rohirrimExtras,
};
