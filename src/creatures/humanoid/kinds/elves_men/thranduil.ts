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
import type { SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext, KindDef } from '../../types';
import { devNum, devSkip, attachSkinned, withHair } from './common';
import { skirtGeometry } from '../../cloth';
import { along, instances, leaf, mergeAll, put, ring, studs, taperedTube, torsoSection, tube } from './geo';
import { POLISHED } from './armor';
import { addHair, noKitHair } from './hair';
import { sculptShoulderCap, sculptTorso } from './garments';

const PAL = {
  hair: 0xcfcdc3, // sheet: platinum-silver, root #bdbcb4 → tip #e1e0d8
  hairTip: 0xe6e4dc,
  // sheet skin #e7c7b7 (observed lit #e8bcae): warmer and a little deeper (a pale albedo renders as clay)
  skin: 0xdcb199,
  skin2: 0xcd9f87,
  lips: 0xa4665f,
  brows: 0x8b7b64,
  eyes: 0x7f8f9c, // spec #5d8bb5, but the sheet's iris reads grey-blue (#8a9aa6 in the skin tile)
  leggings: 0x34343a,
  boots: 0x5a4a3e, // worn brown leather #665447
  robe: 0xa39b8f, // silver brocade: design #c2beb4, observed #998a81
  robeTrim: 0xb9ad92,
  cloak: 0x5a1422, // wine-red velvet #6c192e (velvet sheen lifts it)
  cloakTrim: 0x9d7f48,
  belt: 0x6e5d3c,
  silver: 0xc4c4cc,
  gold: 0xc8a860,
  collar: 0x4e1120, // coat velvet (observed #65433b is lit and embroidered)
  embroidery: 0x9a8a68, // silver-gold vine work
  hemTrim: 0x6e5a3a, // dark gold hem band
  twig: 0x3a2a1e, // crown wood (observed #382219)
};

/** hem panels like the shared addSkirt, widened into the coat's wide A-line (sheet: hem ~1.1 m across
 *  but only ~0.8 m deep): the kit's ring skirt is stretched sideways towards the hem */
function wideSkirt(ctx: KindContext, o: { color: number; color2?: number; mat: SurfaceSpec; panels: [number, number][]; bottom: number; flare: number; widen?: number; deep?: number }) {
  const { P, rig, spec } = ctx;
  const sc = P.s;
  if (devSkip('skirt')) return;
  const top = P.j.thigh_l[1] + 0.035 * sc;
  const geo = skirtGeometry(P, rig, { top, bottom: o.bottom, color: o.color, color2: o.color2, mat: o.mat, panels: o.panels, flare: o.flare, seed: spec.seed ?? 0 });
  const pos = geo.attributes.position;
  const widen = o.widen ?? 0;
  const deep = o.deep ?? 0;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (top - pos.getY(i)) / (top - o.bottom)));
    const f = Math.pow(t, 1.2);
    pos.setX(i, pos.getX(i) * (1 + widen * f));
    pos.setZ(i, (pos.getZ(i) + 0.01 * sc) * (1 + deep * f) - 0.01 * sc);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  attachSkinned(ctx, geo, 'body', { small: false, name: 'skirt' });
}

/** the Elvenking's crown: a woven twig band with two tall clusters of forked twigs, autumn leaves and
 *  red berries rising at the temples (sheet), low sprigs at the front and back */
function elvenCrown(ctx: KindContext, rng: Rng) {
  const { P } = ctx;
  const u = P.headH;
  const bandR = 0.35;
  const wood = PAL.twig;
  const woodMat = surface('wood', { rough: 0.7, pat: { wrinkles: 1.3 } });
  const woven: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const pts: V3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const wob = Math.sin(a * 7 + k * 2.1) * 0.012 + (k - 1) * 0.012;
      const y = 0.185 - 0.05 * Math.max(0, -Math.cos(a)) + wob;
      pts.push(P.h(Math.sin(a) * (bandR + 0.01 * Math.cos(a * 7 + k)), y, -0.055 + Math.cos(a) * 0.455));
    }
    woven.push(tube(pts, 0.0085 * u, { seg: 60, radial: 4, closed: true }));
  }
  put(ctx, mergeAll(woven), { bone: 'head', color: wood, mat: woodMat, small: true });
  const twigs: THREE.BufferGeometry[] = [];
  const twigs2: THREE.BufferGeometry[] = [];
  const leaves: THREE.Matrix4[] = [];
  const berries: V3[] = [];
  const leafGeo = leaf(0.1 * u, 0.04 * u, { droop: 0.3, cup: 0.4, rows: 3, rib: 0.3 });
  const addLeaf = (p: V3, dir: V3) => leaves.push(along(p, dir, [rng.range(-1, 1), 0.3, rng.range(-1, 1)], rng.range(0.8, 1.35)));
  // azimuth a from the front: clusters sit at the temples, a few short sprigs front and back
  const specs: { a: number; h: number }[] = [];
  for (const sd of [1, -1]) for (let k = 0; k < 6; k++) specs.push({ a: sd * (0.95 + k * 0.17 + rng.range(-0.04, 0.04)), h: (0.8 - Math.abs(k - 2.4) * 0.07) * (0.9 + 0.2 * rng.float()) });
  for (const a of [0.15, -0.2, Math.PI - 0.3, Math.PI + 0.35]) specs.push({ a, h: 0.17 });
  for (const sp of specs) {
    const sx = Math.sin(sp.a);
    const cz = Math.cos(sp.a);
    const root: V3 = P.h(sx * bandR, 0.19, -0.055 + cz * 0.455);
    const out = sp.h > 0.3 ? 0.22 : 0.05;
    const mid: V3 = [root[0] + sx * out * 0.55 * u, root[1] + sp.h * u * 0.5, root[2] - 0.07 * u];
    const tip: V3 = [root[0] + sx * out * u, root[1] + sp.h * u, root[2] - 0.13 * u];
    twigs.push(taperedTube([root, mid, tip], 0.0115 * u, 0.0035 * u, { seg: 10, radial: 4 }));
    const forks = sp.h > 0.3 ? 4 : 1;
    for (let f = 0; f < forks; f++) {
      const t = 0.2 + f * 0.19;
      const base: V3 = [root[0] + (tip[0] - root[0]) * t, root[1] + (tip[1] - root[1]) * t, root[2] + (tip[2] - root[2]) * t];
      const side = f % 2 ? -1 : 1;
      const end: V3 = [base[0] + (side * 0.17 + sx * 0.1) * u, base[1] + 0.15 * u, base[2] - 0.05 * u];
      twigs2.push(taperedTube([base, [(base[0] + end[0]) / 2 + side * 0.02 * u, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2], end], 0.0058 * u, 0.0024 * u, { seg: 6, radial: 3 }));
      addLeaf(end, [end[0] - base[0], end[1] - base[1], end[2] - base[2]]);
      addLeaf([(base[0] + end[0]) / 2, (base[1] + end[1]) / 2, (base[2] + end[2]) / 2], [side * 0.8, 0.5, 0.3]);
      if (rng.float() < 0.8) berries.push([end[0] + 0.004 * u, end[1] - 0.012 * u, end[2]]);
      if (rng.float() < 0.7) berries.push([base[0] + side * 0.02 * u, base[1], base[2] + 0.01 * u]);
    }
    addLeaf(tip, [tip[0] - mid[0], tip[1] - mid[1], tip[2] - mid[2]]);
    addLeaf(mid, [sx * 0.7, 0.5, 0.2]);
    berries.push([tip[0], tip[1] - 0.014 * u, tip[2]]);
    if (sp.h > 0.3) berries.push([mid[0] + 0.01 * u, mid[1], mid[2]]);
  }
  put(ctx, mergeAll(twigs), { bone: 'head', color: wood, mat: woodMat, small: true });
  put(ctx, mergeAll(twigs2), { bone: 'head', color: 0x5a4632, mat: woodMat, small: true });
  [0xb8481c, 0xd9702a, 0x9a2e18, 0xc65a22].forEach((c, ci, all) => {
    const sub = leaves.filter((_, i) => i % all.length === ci);
    if (sub.length) put(ctx, instances(leafGeo, sub), { bone: 'head', color: c, mat: surface('cloth', { rough: 0.7, sheen: 0.2, pat: { weave: 0 } }), small: true });
  });
  if (berries.length) put(ctx, studs(berries, 0.0105 * u, 1), { bone: 'head', color: 0xa31f1f, mat: surface('lips', { rough: 0.3 }), small: true });
}

function thranduilExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const g = Math.sqrt(P.build.bulk);
  // velvet: a soft, albedo-tinted sheen over a fine nap
  const wine = surface('cloth', { sheen: 0.7, rough: 0.78, pat: { weave: 0.35 } });
  const brocade = surface('linen', { sheen: 0.75, rough: 0.5, pat: { weave: 1.2 } });

  withHair(ctx, () => {
    // long hair that hangs over the cloak
    addHair(ctx, { hair: { style: 'long_straight', color: PAL.hair, tipColor: PAL.hairTip, length: 1.14, density: devNum('density', 0.55), braids: 'none' }, rng: new Rng(hashSeed('thranduil', 'hair')), backClear: 1.45 });
  });

  // ── the crown ──
  elvenCrown(ctx, new Rng(hashSeed('thranduil', 'crown')));

  // ── silver brocade under-robe: a close tunic and hem panels to the floor ──
  sculptTorso(ctx, { color: PAL.robe, mat: brocade, inflate: 0.0045 * sc, hem: 0.3, sleeve: 0, neck: true, seams: true, color2: PAL.robeTrim, colorNoise: 0.2 });
  wideSkirt(ctx, { color: PAL.robe, color2: PAL.robeTrim, mat: brocade, bottom: P.ankleH + 0.07 * sc, flare: 0.02 * sc, panels: [[-0.62, 0.62]], widen: 0.35 });

  // ── the wine-red coat: sleeves to the wrist, open down the front, floor-length skirts ──
  sculptTorso(ctx, { color: PAL.collar, mat: wine, inflate: 0.0088 * sc, hem: 0.3, sleeve: 2, neck: false, seams: true, frontOpen: { top: 0.07 * sc, bottom: 0.022 * sc, y1: ny + 0.0 * sc } });
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
        pts.push([sg * w, y, torsoSection(P, y).zf + 0.0098 * sc]);
      }
      put(ctx, tube(pts, 0.0032 * sc, { seg: 14, radial: 3 }), { bone: 'chest', color: PAL.cloakTrim, mat: 'gold', small: true });
    }
  }
  // the coat's skirts: an A-line from the waist, ~1.1 m across the hem and ~0.8 m deep
  wideSkirt(ctx, { color: PAL.collar, color2: PAL.hemTrim, mat: wine, bottom: P.ankleH + 0.025 * sc, flare: 0.075 * sc, panels: [[-3.05, -0.34], [0.34, 3.05]], widen: 0.5, deep: 0 });

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

  // ── embroidered shoulder yokes (sheet: square, embroidered velvet, no metal) ──
  sculptShoulderCap(ctx, { color: PAL.collar, mat: wine, side: 'both', inflate: 0.022 * sc, reach: 0.3 });
  s.mirrored(() => {
    s.ellipsoid([P.shoulderX * 0.78, j.upperarm_l[1] + 0.032 * sc, -0.012 * sc], [0.07 * sc, 0.03 * sc, 0.075 * sc], { op: 'paint', color: PAL.embroidery, mat: brocade, bone: 'chest', k: 0.012 * sc });
  });

  // ── filigree belt: a small silver leaf plate at the waist (sheet: ~1.27 m, just under the ribs) ──
  const by = j.chest[1] - 0.045 * sc;
  const zf = torsoSection(P, by).zf + 0.012 * sc;
  put(ctx, new THREE.CircleGeometry(0.014 * sc, 14), { bone: 'chest', color: PAL.gold, mat: 'gold', matrix: new THREE.Matrix4().makeTranslation(0, by, zf), small: true });
  put(ctx, ring([0, by, zf + 0.001 * sc], [0, 0, 1], 0.0155 * sc, 0.0025 * sc, 16, 3), { bone: 'chest', color: PAL.silver, mat: POLISHED, small: true });
  const lf = leaf(0.05 * sc, 0.013 * sc, { droop: 0, cup: 0.3, rows: 3, rib: 0.5 });
  const fan: THREE.Matrix4[] = [];
  for (const sg of [1, -1]) {
    for (const ang of [0.15, 0.55, 0.95]) {
      fan.push(along([sg * 0.012 * sc, by, zf + 0.003 * sc], [sg * Math.cos(ang), Math.sin(ang) * 0.6, 0], [0, 0, 1], 1));
      fan.push(along([sg * 0.012 * sc, by, zf + 0.003 * sc], [sg * Math.cos(ang), -Math.sin(ang) * 0.6, 0], [0, 0, 1], 1));
    }
  }
  put(ctx, instances(lf, fan), { bone: 'chest', color: PAL.silver, mat: POLISHED, small: true });

  // ── the two long front locks of platinum hair falling over the collar to the belt (sheet) ──
  {
    const by0 = j.chest[1] - 0.045 * sc;
    const lock = (sg: number, dx: number, dz: number, len: number) => {
      const pts: V3[] = [
        [sg * (0.078 + dx) * sc, ny + 0.13 * sc, 0.0 * sc],
        [sg * (0.108 + dx) * sc, ny + 0.03 * sc, (0.052 + dz) * sc],
        [sg * (0.118 + dx * 1.2) * sc, ny - 0.1 * sc, (0.09 + dz) * sc],
        [sg * (0.106 + dx * 1.4) * sc, by0 + 0.2 * len * sc, (0.1 + dz) * sc],
        [sg * (0.098 + dx * 1.5) * sc, by0 - 0.02 * sc + (1 - len) * 0.2 * sc, (0.102 + dz) * sc],
      ];
      return taperedTube(pts, 0.0105 * sc, 0.0018 * sc, { seg: 22, radial: 4 });
    };
    const list: THREE.BufferGeometry[] = [];
    for (const sg of [1, -1]) {
      list.push(lock(sg, 0, 0, 1), lock(sg, 0.012, -0.004, 0.85), lock(sg, -0.012, 0.004, 0.7));
    }
    put(ctx, mergeAll(list), { bone: 'chest', color: PAL.hair, mat: 'hair', small: true });
  }

  // ── brooch holding the cloak at the throat ──
  put(ctx, new THREE.SphereGeometry(0.015 * sc, 8, 5).scale(1, 1, 0.5).translate(0, ny - 0.045 * sc, 0.084 * sc), { bone: 'chest', color: PAL.gold, mat: 'gold', small: true });
  put(ctx, new THREE.SphereGeometry(0.007 * sc, 6, 4).translate(0, ny - 0.045 * sc, 0.092 * sc), { bone: 'chest', color: 0xb02828, mat: surface('lips', { rough: 0.2 }), small: true });
}

export const thranduilDef: KindDef = {
  label: 'Thranduil',
  height: 1.9,
  build: { shoulders: 1.0, hips: 0.94, bulk: 0.9, chest: 0.95, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.1, neckThick: 0.88, handSize: 0.98, footSize: 0.98, muscle: 0.12 },
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
    { type: 'leggings', color: 0x2c1a1c }, // hidden under the floor-length coat
    { type: 'boots', color: PAL.boots, color2: 0x1e1b19, length: 0.9 },
    // spring bones only: the skirt and cloak sheets are built in extras
    { type: 'skirt', color: PAL.robe, chance: 0 },
  ],
  armor: [],
  // the sheet prescribes no weapon (notes.md); he is lab-only
  weapons: { right: 'none', left: 'none' },
  palette: PAL,
  sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.4 },
  anim: { grace: 1, swagger: 0.12, aggression: 0.2, stance: 1.0, armSwing: 0.7, cadence: 0.95 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.05), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: thranduilExtras,
};
