/**
 * Thranduil, the Elvenking (~1.9 m): long platinum hair over a floor-length wine-red cloak, a cold
 * severe face, a crown of dark twigs hung with autumn leaves and berries, a silver brocade robe
 * with wine-red sleeves and yoke, a high flared collar, silver epaulettes, a broad filigree belt
 * and an elven sword in a scabbard.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import type { KindContext, KindDef } from '../../types';
import { devNum, withHair } from './common';
import { addSkirt } from './cloth';
import { sheathed } from './detail';
import { along, instances, leaf, put, ring, studs, torsoSection, tube } from './geo';
import { epaulettes, POLISHED } from './armor';
import { addHair, noKitHair } from './hair';
import { sculptTorso } from './garments';
import { twigCrown } from './headgear';

const PAL = {
  hair: 0xcfcdc3, // sheet: platinum-silver, root #bdbcb4 → tip #e1e0d8
  hairTip: 0xe6e4dc,
  skin: 0xe8cbbb, // #e7c7b7
  skin2: 0xdbb8a6,
  lips: 0xa9706a,
  brows: 0x8b7b64,
  eyes: 0x5d8bb5,
  leggings: 0x34343a,
  boots: 0x5a4a3e, // worn brown leather #665447
  robe: 0xb0aca2, // silver brocade #c2beb4
  robeTrim: 0xb9ad92,
  cloak: 0x58141f, // wine-red velvet #6c192e (velvet sheen lifts it)
  cloakTrim: 0x9d7f48,
  belt: 0x6e5d3c,
  silver: 0xc4c4cc,
  gold: 0xc8a860,
  collar: 0x3f1320,
};

function thranduilExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const g = Math.sqrt(P.build.bulk);
  const wine = surface('cloth', { sheen: 0.18, rough: 0.8, pat: { weave: 0.8 } });
  const brocade = surface('linen', { sheen: 0.9, rough: 0.55, pat: { weave: 1.2 } });

  withHair(ctx, () => {
    // long hair that hangs over the cloak
    addHair(ctx, { hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, length: 1.14, density: devNum('density', 0.55), braids: 'none' }, rng: new Rng(hashSeed('thranduil', 'hair')), backClear: 1.45 });
  });

  // ── the crown ──
  twigCrown(ctx, { rng: new Rng(hashSeed('thranduil', 'crown')), branches: 11, height: 1.6, thick: 2.1, leaves: 1.5 });

  // ── silver brocade under-robe: a close tunic and hem panels to the floor ──
  sculptTorso(ctx, { color: PAL.robe, mat: brocade, inflate: 0.0068 * sc, hem: 0.3, sleeve: 0, neck: true, seams: true, color2: PAL.robeTrim, colorNoise: 0.2 });
  addSkirt(ctx, { color: PAL.robe, color2: PAL.robeTrim, mat: brocade, length: 1, bottom: P.ankleH + 0.07 * sc, flare: 0.02 * sc, panels: [[-0.62, 0.62]] });

  // ── the wine-red coat: sleeves to the wrist, open down the front, floor-length skirts ──
  sculptTorso(ctx, { color: PAL.collar, mat: wine, inflate: 0.0125 * sc, hem: 0.3, sleeve: 2, neck: false, seams: true, frontOpen: { top: 0.07 * sc, bottom: 0.022 * sc, y1: ny + 0.0 * sc } });
  // gold-silver embroidery along both edges of the opening
  {
    const yTop = ny - 0.02 * sc;
    const yBot = hipY - 0.1 * sc;
    for (const sg of [1, -1]) {
      const pts: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const y = yTop + (yBot - yTop) * f;
        const w = (0.07 - 0.0422 * f) * sc * 0.97;
        pts.push([sg * w, y, torsoSection(P, y).zf + 0.0135 * sc]);
      }
      put(ctx, tube(pts, 0.0032 * sc, { seg: 14, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: 'gold', small: true });
    }
  }
  addSkirt(ctx, { color: PAL.collar, color2: PAL.cloakTrim, mat: wine, length: 1, bottom: P.ankleH + 0.025 * sc, flare: 0.1 * sc, panels: [[-3.05, -0.34], [0.34, 3.05]] });

  // ── stiff high collar of the coat, flaring up behind the neck ──
  s.group('union', 0.012 * sc, () => {
    s.ellipsoid([0, ny + 0.065 * sc, -0.045 * sc], [0.125 * sc * g, 0.115 * sc, 0.088 * sc], { color: PAL.collar, mat: wine, bone: 'chest', k: 0.02 * sc });
    s.mirrored(() => s.ellipsoid([0.1 * sc * g, ny + 0.04 * sc, 0.0], [0.045 * sc, 0.1 * sc, 0.07 * sc], { color: PAL.collar, mat: wine, bone: 'chest', k: 0.02 * sc }));
    s.ellipsoid([0, ny + 0.07 * sc, 0.0], [0.074 * sc * P.build.neckThick, 0.15 * sc, 0.092 * sc], { op: 'subtract', k: 0.014 * sc });
    s.ellipsoid([0, ny + 0.05 * sc, 0.11 * sc], [0.06 * sc, 0.11 * sc, 0.075 * sc], { op: 'subtract', k: 0.02 * sc });
    s.plane([0, 1, 0], ny + 0.15 * sc, { op: 'intersect', k: 0.01 * sc });
    s.plane([0, 1, 0], ny + 0.15 * sc, { op: 'paint', seam: 0, k: 0.002 });
  });
  {
    const pts: V3[] = [];
    for (let i = 0; i <= 22; i++) {
      const a = -Math.PI * 0.82 + (i / 22) * Math.PI * 1.64;
      pts.push([Math.sin(a) * 0.088 * sc * g * 1.2, ny + 0.145 * sc, -0.045 * sc + Math.cos(a) * 0.07 * sc * 1.1]);
    }
    put(ctx, tube(pts, 0.0028 * sc, { seg: 30, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: 'gold', small: true });
  }

  // ── silver epaulettes ──
  epaulettes(ctx, { color: 0x9c9ca6, trim: PAL.gold, mat: surface('metal', { rough: 0.5, pat: { scratches: 0.8 } }), size: 0.72, flat: 0.3 });

  // ── filigree belt: a silver-gold band with a leaf medallion ──
  const by = hipY + 0.075 * sc;
  const zf = 0.108 * sc * P.build.bulk + 0.026 * sc;
  put(ctx, new THREE.CircleGeometry(0.03 * sc, 16), { bone: 'hips', color: PAL.gold, mat: 'gold', matrix: new THREE.Matrix4().makeTranslation(0, by, zf), small: true });
  put(ctx, ring([0, by, zf + 0.001 * sc], [0, 0, 1], 0.031 * sc, 0.0035 * sc, 18, 3), { bone: 'hips', color: PAL.silver, mat: POLISHED, small: true });
  const lf = leaf(0.03 * sc, 0.011 * sc, { droop: 0, cup: 0.3, rows: 3, rib: 0.5 });
  put(ctx, instances(lf, [along([0, by - 0.002 * sc, zf + 0.004 * sc], [0, 1, 0], [0, 0, 1]), along([0, by + 0.002 * sc, zf + 0.004 * sc], [0, -1, 0], [0, 0, 1])]), { bone: 'hips', color: PAL.silver, mat: POLISHED, small: true });
  const studPts: V3[] = [];
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.5 + (i / 8) * Math.PI;
    if (Math.abs(a) < 0.12) continue;
    studPts.push([Math.sin(a) * (0.158 * sc * Math.sqrt(P.build.bulk) + 0.021 * sc), by, Math.cos(a) * (0.11 * sc * Math.sqrt(P.build.bulk) + 0.021 * sc) - 0.004 * sc]);
  }
  put(ctx, studs(studPts, 0.0055 * sc, 0.7), { bone: 'hips', color: PAL.gold, mat: 'gold', small: true });

  // ── brooch holding the cloak at the throat ──
  put(ctx, new THREE.SphereGeometry(0.015 * sc, 8, 5).scale(1, 1, 0.5).translate(0, ny - 0.045 * sc, 0.084 * sc), { bone: 'chest', color: PAL.gold, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(0.007 * sc, 6, 4).translate(0, ny - 0.045 * sc, 0.092 * sc), { bone: 'chest', color: 0xb02828, mat: surface('lips', { rough: 0.2 }), small: true });

  // ── the sword in its scabbard (hidden while drawn) ──
  sheathed(ctx, {
    kind: 'elven_sword',
    hand: 'hand_r',
    pos: [P.hipX + 0.14 * sc, hipY + 0.05 * sc, -0.02 * sc],
    dir: [0.1, -0.88, -0.46],
    len: 0.84,
    r: 0.028 * sc,
    color: 0x2e2622,
    trim: PAL.gold,
    seed: 4,
  });
}

export const thranduilDef: KindDef = {
  label: 'Thranduil',
  height: 1.9,
  build: { shoulders: 1.0, hips: 0.94, bulk: 0.9, chest: 0.95, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.1, neckThick: 0.88, handSize: 0.98, footSize: 0.98, muscle: 0.3 },
  face: {
    jaw: 0.88,
    jawLength: 1.06,
    chin: 1.1,
    brow: 0.95,
    cheekbones: 1.25,
    nose: { length: 1.08, width: 0.8, bridge: 1.15, hook: 0.05, tip: 0.8 },
    lips: { width: 0.9, fullness: 0.82 },
    ears: 'pointed',
    earSize: 1.05,
    eyeSize: 1.0,
    eyeSpacing: 1.0,
    eyeTilt: 0.13,
    eyeOpen: 0.82,
    foreheadSlope: 0.1,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.06, blemish: 0.0, wrinkles: 0, lips: PAL.lips, brows: PAL.brows, scatter: 0xc88a78, surface: 'skin' },
  eyes: { color: PAL.eyes, sclera: 0xf0ece4 },
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.robe },
    { type: 'boots', color: PAL.boots, color2: 0x1e1b19, length: 0.9 },
    { type: 'belt', color: PAL.belt },
    // spring bones only: the skirt and cloak sheets are built in extras
    { type: 'skirt', color: PAL.robe, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'elven_sword', left: 'none' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.4 },
  anim: { grace: 1, swagger: 0.12, aggression: 0.2, stance: 1.0, armSwing: 0.7, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.05), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: thranduilExtras,
};
