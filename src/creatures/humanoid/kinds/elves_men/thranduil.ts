/**
 * Thranduil, the Elvenking (~1.9 m): long platinum hair, a cold severe face, a crown of dark twigs
 * hung with autumn leaves and berries, a silver brocade robe under a floor-length wine-red coat
 * with a high flared collar, silver pauldrons, a broad filigree belt and an elven sword.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import type { KindContext, KindDef } from '../../types';
import { anatomyParts, emitParts } from '../../anatomy';
import { devNum, mix, shade } from './common';
import { sheathed } from './detail';
import { put, ring, tube, leaf, instances, along, studs, lathe } from './geo';
import { pauldrons, POLISHED } from './armor';
import { twigCrown } from './headgear';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';

const PAL = {
  hair: 0xe5dcc4,
  hairTip: 0xf2ece0,
  skin: 0xe9d3c1,
  skin2: 0xdcc0ac,
  lips: 0xa9706a,
  brows: 0x8b7b64,
  eyes: 0x93b3cf,
  leggings: 0x34343a,
  boots: 0x2b2825,
  robe: 0xa3a3b0,
  robeTrim: 0xc9bfa6,
  cloak: 0x5d1f2e,
  cloakTrim: 0xa3844c,
  belt: 0x8d7a54,
  silver: 0xc4c4cc,
  gold: 0xc8a860,
  collar: 0x6a2433,
};

function thranduilExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const cy = j.chest[1];
  const ny = j.neck[1];
  const parts = anatomyParts(P);
  const rng = new Rng(hashSeed('thranduil', 'crown'));

  // ── the crown ──
  twigCrown(ctx, { rng, branches: 9, height: 1.05 });

  // ── stiff high collar of the coat, flaring up behind the neck ──
  const g = Math.sqrt(P.build.bulk);
  s.group('union', 0.012 * sc, () => {
    s.ellipsoid([0, ny + 0.065 * sc, -0.045 * sc], [0.125 * sc * g, 0.115 * sc, 0.088 * sc], { color: PAL.collar, mat: 'wool', bone: 'chest', k: 0.02 * sc, noise: { amp: 0.002 * sc, freq: 40 / sc, type: 'ridged', octaves: 2 } });
    s.mirrored(() => s.ellipsoid([0.1 * sc * g, ny + 0.04 * sc, 0.0], [0.045 * sc, 0.1 * sc, 0.07 * sc], { color: PAL.collar, mat: 'wool', bone: 'chest', k: 0.02 * sc }));
    // hollow for the neck, open at the front
    s.ellipsoid([0, ny + 0.07 * sc, 0.0], [0.074 * sc * P.build.neckThick, 0.15 * sc, 0.092 * sc], { op: 'subtract', k: 0.014 * sc });
    s.ellipsoid([0, ny + 0.05 * sc, 0.11 * sc], [0.06 * sc, 0.11 * sc, 0.075 * sc], { op: 'subtract', k: 0.02 * sc });
    s.plane([0, 1, 0], ny + 0.15 * sc, { op: 'intersect', k: 0.01 * sc });
    s.plane([0, 1, 0], ny + 0.15 * sc, { op: 'paint', seam: 0, k: 0.002 });
  });
  // gold-silver embroidery band along the collar top
  {
    const pts: V3[] = [];
    for (let i = 0; i <= 22; i++) {
      const a = -Math.PI * 0.82 + (i / 22) * Math.PI * 1.64;
      pts.push([Math.sin(a) * 0.088 * sc * g * 1.2, ny + 0.142 * sc, -0.045 * sc + Math.cos(a) * 0.07 * sc * 1.1]);
    }
    put(ctx, tube(pts, 0.0028 * sc, { seg: 30, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: 'gold', small: true });
  }

  // ── sculpted shoulder yoke / chest panel of the coat in wine red with a gold-silver front line ──
  s.group('union', 0.003 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'deltoid'], { color: PAL.collar, mat: surface('cloth', { sheen: 1, rough: 0.7 }), inflate: 0.0105 * sc });
    s.plane([0, -1, 0], -(cy - 0.12 * sc), { op: 'intersect', k: 0.006 * sc });
    s.plane([0, -1, 0], -(cy - 0.12 * sc), { op: 'paint', seam: 0, k: 0.002 });
    // open at the front: a V showing the silver robe
    s.ellipsoid([0, cy + 0.08 * sc, 0.13 * sc], [0.034 * sc, 0.2 * sc, 0.05 * sc], { op: 'subtract', k: 0.012 * sc });
  });

  // ── silver pauldrons with gold trim ──
  pauldrons(ctx, { color: PAL.silver, trim: PAL.gold, mat: POLISHED, trimMat: 'gold', lames: 3, size: 1.02, cap: true });

  // ── filigree belt: a broad silver-gold band with a leaf medallion ──
  const hipY = j.thigh_l[1];
  const by = hipY + 0.075 * sc;
  const zf = 0.108 * sc * P.build.bulk + 0.026 * sc;
  const medal = new THREE.CircleGeometry(0.03 * sc, 16);
  put(ctx, medal, { bone: 'hips', color: PAL.gold, mat: 'gold', matrix: new THREE.Matrix4().makeTranslation(0, by, zf), small: true });
  put(ctx, ring([0, by, zf + 0.001 * sc], [0, 0, 1], 0.031 * sc, 0.0035 * sc, 18, 3), { bone: 'hips', color: PAL.silver, mat: POLISHED, small: true });
  const lf = leaf(0.03 * sc, 0.011 * sc, { droop: 0, cup: 0.3, rows: 3, rib: 0.5 });
  put(ctx, instances(lf, [along([0, by - 0.002 * sc, zf + 0.004 * sc], [0, 1, 0], [0, 0, 1]), along([0, by + 0.002 * sc, zf + 0.004 * sc], [0, -1, 0], [0, 0, 1])]), { bone: 'hips', color: PAL.silver, mat: POLISHED, small: true });
  // a chain of leaves hanging from the belt on each hip
  const chain: THREE.BufferGeometry[] = [];
  void chain;
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
    pos: [P.hipX + 0.13 * sc, hipY + 0.045 * sc, -0.015 * sc],
    dir: [0.1, -0.62, -0.78],
    len: 0.84,
    r: 0.028 * sc,
    color: 0x2e2622,
    trim: PAL.gold,
    seed: 4,
    weaponStart: 0.09,
  });
  void mix;
  void shade;
  void lathe;
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
  hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, braids: 'none', length: 1.12, density: devNum('density', 0.42), bounce: 0.8 },
  beard: null,
  outfit: [
    { type: 'leggings', color: PAL.leggings },
    { type: 'boots', color: PAL.boots, color2: 0x1e1b19, length: 0.9 },
    { type: 'robe', color: PAL.robe, color2: PAL.robeTrim },
    { type: 'belt', color: PAL.belt },
    { type: 'cloak', color: PAL.cloak, color2: PAL.cloakTrim, length: 1.0 },
  ],
  armor: [],
  weapons: { right: 'elven_sword', left: 'none' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.4 },
  anim: { grace: 1, swagger: 0.12, aggression: 0.2, stance: 1.0, armSwing: 0.7, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  detail: { detailScale: 1, res: devNum('res', 0.034), headRes: devNum('headRes', 0.0068), faceRes: 0 },
  extras: thranduilExtras,
};
