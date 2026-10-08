/**
 * Men of Gondor. Seed bucket 0 is the CAPTAIN (Boromir): bare-headed, shoulder-length brown hair,
 * a short full beard, a dark leather doublet over mail, a fur-collared cloak, a baldric with the
 * Horn of Gondor, no helmet whatever the helmet flag says. Buckets 1-3 are soldiers: mail with
 * short sleeves under a black surcoat bearing the white tree and silver trim, the tall winged
 * Minas Tirith helm (helmet flag), and varied hair, beards, scars and armour. Shield and spear/
 * sword are the kit's (`weapons.style: 'gondor'`). Armour level adds pauldrons (0.5), vambraces (0.75).
 */
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, withHair } from './common';
import { addCloak, addSkirt } from './cloth';
import { emblemGeometry, paintScar, type EmblemStroke } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptFurCollar, sculptPouch, sculptStrap, sculptTorso } from './garments';
import { POLISHED, STEEL, limbGuards, pauldrons } from './armor';
import { gondorHelm } from './headgear';
import { put, ring, taperedTube } from './geo';

const BLACK = 0x1c1b1e;
const SILVER = 0xb2b4ba;

/** the White Tree of Gondor as ribbon strokes (emblem space: x right, y up, ~1 wide, 1.5 tall) */
function treeStrokes(): EmblemStroke[] {
  const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [-x, y]);
  const br = (pts: [number, number][], w: number, w1: number): EmblemStroke[] => [
    { pts, w, w1 },
    { pts: mirror(pts), w, w1 },
  ];
  return [
    { pts: [[0, -0.72], [0.0, -0.4], [0.0, -0.05]], w: 0.14, w1: 0.075 },
    ...br([[0, -0.74], [-0.14, -0.66]], 0.07, 0.04),
    ...br([[0, -0.2], [-0.12, -0.02], [-0.3, 0.1], [-0.46, 0.12]], 0.07, 0.032),
    ...br([[-0.12, -0.02], [-0.14, 0.2], [-0.26, 0.34]], 0.05, 0.026),
    ...br([[-0.02, 0.02], [-0.06, 0.24], [-0.12, 0.4]], 0.045, 0.024),
    { pts: [[0, -0.05], [0, 0.3], [0, 0.46]], w: 0.06, w1: 0.03 },
    // the crown above the tree
    { pts: [[-0.2, 0.62], [0.2, 0.62]], w: 0.06 },
    ...br([[0.02, 0.64], [0.1, 0.8]], 0.04, 0.02),
    ...br([[0.18, 0.64], [0.24, 0.76]], 0.035, 0.02),
    { pts: [[0, 0.64], [0, 0.84]], w: 0.045, w1: 0.02 },
  ];
}

interface GonLook {
  hair: HairDef;
  beard?: { color: number; thick: number; cheeks: number; chin?: number; mustache?: boolean; stubble?: boolean };
}

function gondorExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const b = ctxBucket(ctx);
  const captain = b === 0;
  const cy = j.chest[1];
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const cloth = surface('cloth', { rough: 0.86, sheen: 0.5, pat: { weave: 1 } });
  const wool = surface('wool', { rough: 0.92 });
  const mailMat = surface('mail', { rough: 0.58, pat: { scales: 1.5, scratches: 0.5 } });
  const dn = devNum('density', 0.6);
  const looks: GonLook[] = [
    { hair: { style: 'shoulder', color: 0x4a3322, tipColor: 0x5a402c, length: 1.0, density: dn }, beard: { color: 0x3b2a1c, thick: 0.05, cheeks: 0.5, chin: 0.015 } },
    { hair: { style: 'short', color: 0x3e2c1d, length: 1, density: 0.7 } },
    { hair: { style: 'short', color: 0x20170f, length: 1, density: 0.7 }, beard: { color: 0x1d150f, thick: 0.035, cheeks: 0.3, mustache: true } },
    { hair: { style: 'short', color: 0x8b8880, length: 0.9, density: 0.7 }, beard: { color: 0x96938b, thick: 0.03, cheeks: 0, mustache: true } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet && !captain;

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: captain ? 0.45 : 0.3, mustache: L.beard.mustache !== false, cheeks: 0.7 });
    sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [0.12, 0.0], to: [0.19, -0.27] });

  // ── hair ──
  withHair(ctx, () => {
    addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('gondor', 'hair', b)), lod: 1, backClear: captain ? 1.35 : 1.0, cap: !helmed });
  });

  // ── mail ──
  sculptTorso(ctx, { color: 0x6d6e74, mat: mailMat, inflate: 0.0115 * sc, hem: 0.45, sleeve: 1.0, neck: true, seams: false });
  addSkirt(ctx, { color: 0x6d6e74, mat: mailMat, length: captain ? 0.5 : 0.62, flare: captain ? undefined : 0.02 * sc, ragged: 0.004 * sc });

  if (captain) {
    // dark leather doublet over the mail, studded
    sculptTorso(ctx, { color: 0x30251c, mat: 'leather_worn', inflate: 0.0185 * sc, hem: 0.08, sleeve: 0, neck: false, shoulders: false, seams: true, frontOpen: { top: 0.045 * sc, bottom: 0.012 * sc, y1: ny - 0.03 * sc } });
    sculptFurCollar(ctx, { color: 0x6c5640, color2: 0x4b3a2b, thick: 0.03, drop: 0.07, open: 0.6 });
    addCloak(ctx, { color: 0x372c22, color2: 0x241c15, mat: wool, length: 0.82, mantle: false });
    sculptStrap(ctx, { color: 0x3a2a1c, mat: 'leather_worn', width: 0.034 * sc, inflate: 0.026 * sc, sign: 1 });
    // the Horn of Gondor on its baldric, hanging at the hip
    const cx = P.hipX + 0.17 * sc;
    const hy = hipY + 0.02 * sc;
    const pts: V3[] = [[cx - 0.02 * sc, hy + 0.2 * sc, -0.02 * sc], [cx, hy + 0.09 * sc, 0.055 * sc], [cx + 0.01 * sc, hy - 0.07 * sc, 0.085 * sc], [cx + 0.02 * sc, hy - 0.2 * sc, 0.045 * sc]];
    put(ctx, taperedTube(pts, 0.012 * sc, 0.048 * sc, { seg: 10, radial: 7 }), { bone: 'hips', color: 0xcdbf9c, mat: 'bone', small: true });
    for (const t of [0.3, 0.62, 0.98]) {
      const i = Math.min(2, Math.floor(t * 3));
      const a = pts[i];
      const bb = pts[i + 1];
      const f = t * 3 - i;
      const p: V3 = [a[0] + (bb[0] - a[0]) * f, a[1] + (bb[1] - a[1]) * f, a[2] + (bb[2] - a[2]) * f];
      const dir: V3 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
      put(ctx, ring(p, dir, (0.012 + 0.03 * t) * sc, 0.0055 * sc, 10, 3), { bone: 'hips', color: SILVER, mat: POLISHED, small: true });
    }
    sculptPouch(ctx, { x: -0.13 * sc, z: 0.05 * sc, size: 0.9, color: 0x2a1e14, drop: 0.05 });
    if (A >= 0.25) limbGuards(ctx, { kind: 'vambrace', color: 0x3a2c20, trim: 0x8a8a8c, mat: 'leather_worn', trimMat: 'metal', length: 0.5 });
  } else {
    // black surcoat with silver trim and the white tree
    sculptTorso(ctx, { color: BLACK, mat: cloth, inflate: 0.0195 * sc, hem: 0.3, sleeve: 0.55, neck: false, seams: true, color2: 0x2c2b30, colorNoise: 0.2 });
    addSkirt(ctx, { color: BLACK, color2: SILVER, mat: cloth, length: 0.56, flare: 0.058 * sc });
    const g = emblemGeometry(ctx, treeStrokes(), { cy: cy + 0.05 * sc, scale: 0.19 * sc, inflate: 0.0235 * sc });
    put(ctx, g, { bone: 'chest', color: 0xe6e6e0, mat: surface('cloth', { rough: 0.5, sheen: 0.9 }), small: true });
    sculptPouch(ctx, { x: 0.13 * sc, z: 0.06 * sc, size: 0.85, color: 0x2a1e14, drop: 0.05 });
    if (A >= 0.5) pauldrons(ctx, { color: 0x8e9096, trim: SILVER, mat: STEEL, trimMat: POLISHED, lames: 2, size: 0.9, cap: true });
    if (A >= 0.75) limbGuards(ctx, { kind: 'vambrace', color: 0x8e9096, trim: SILVER, mat: STEEL, trimMat: POLISHED, length: 0.55 });
    if (helmed) gondorHelm(ctx, { color: 0xb9bbc0, trim: 0xd2d4d8, mat: POLISHED, trimMat: POLISHED });
  }
}

export const gondorDef: KindDef = {
  label: 'Soldier of Gondor',
  height: 1.83,
  build: { shoulders: 1.03, bulk: 1.02, chest: 1.02, neckThick: 1.08, muscle: 0.5 },
  face: { jaw: 1.04, chin: 1.0, brow: 1.06, cheekbones: 1.03, nose: { length: 1.03, width: 0.97, bridge: 1.05 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.93, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: 0xd8ab8d, color2: 0xc4967a, blotch: 0.25, blemish: 0.12, wrinkles: 0.2, lips: 0xa8685f, brows: 0x3e2c1d, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: 0x5b6b6e, sclera: 0xe6e0d4 },
  hair: noKitHair(0xd8ab8d),
  beard: null,
  outfit: [
    { type: 'trousers', color: 0x232124 },
    { type: 'boots', color: 0x1f1a16, color2: 0x15110e, length: 0.9 },
    { type: 'belt', color: 0x1c1816 },
    // spring bones only: hem panels and the captain's cloak are built in extras
    { type: 'skirt', color: BLACK, chance: 0 },
    { type: 'cloak', color: 0x372c22, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'shield', style: 'gondor' },
  sfx: { voice: 'man', weight: 0.55 },
  anim: { swagger: 0.15, aggression: 0.4, stance: 1.03 },
  variation: { height: 0.035, bulk: 0.07, skin: 0.08 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.015), faceRes: 0 },
  extras: gondorExtras,
};
