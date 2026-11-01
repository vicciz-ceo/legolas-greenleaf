/**
 * Elven warriors, four looks across the seed buckets (refined against docs/refs/elf_mirkwood and
 * docs/refs/elf_galadhrim, the same pass as Legolas):
 *   0  Mirkwood guard  deep-green wool tunic with gold line work, gold-bronze leaf armour with a
 *                      skirt of long leaf plates, wide green cloak, tooled brown boots and bracers,
 *                      dark wavy hair, glaive (right hand) or bow
 *   1  Galadhrim       fluted gold armour and leaf plates over a dark olive tunic, deep red velvet
 *                      cloak with gold leaf work, blond hair with temple braids, longbow
 *   2  Mirkwood guard  the amber-brown variant: auburn hair, darker bronze, amber cloak with green trim
 *   3  Galadhrim       the dark-haired variant: slate tunic, black hair, deep red cloak
 * Armour level (spec.armor) adds the cuirass and leaf-plate skirt (0.5) and pauldrons (0.75); the
 * leather bracers are worn at every level; the helmet flag shows the helm (a leaf circlet stands in
 * for it on the Mirkwood guard).
 *
 * Landmarks from the calibrated sheets: belt 1.16 m, cuirass point just above it, leaf plates down to
 * ~0.72 m, tunic hem ~0.7 m, boot tops 0.5 m, cloak hem 0.15 m above the ground.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { mergeKitGeometries } from '../../../kit/geometry';
import { createHairMaterial } from '../../../kit/hair';
import { surface } from '../../../kit/surfaces';
import { skirtGeometry } from '../../cloth';
import { quiverGear, type QuiverOpts } from '../../gear';
import type { KindContext, KindDef } from '../../types';
import { devNum, devSkip, ctxBucket, attachSkinned, mix } from './common';
import { SKIRT_PANELS } from './cloth';
import { leafBuckle } from './armor';
import { elfCrest, elfCuirass, elfPauldrons } from './elf_armor';
import type { V3 } from '../../../kit/sdf';
import { put, taperedTube } from './geo';
import { elfCloak, leafTassets, type TassetLeaf } from './elf_cloth';
import { elvenHelm, leafCirclet } from './headgear';
import { noKitHair } from './hair';
import { buildHair, sculptHairCap } from '../../hairstyles';
import { sculptTorso } from './garments';
import { addGlaiveHead } from './glaive';

/** stitched leather tooled with leaf work (boots, bracers, belt) */
const TOOLED = surface('leather_tooled', { rough: 0.62, sheen: 0.1 });
/** fitted wool (trousers) */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.25, pat: { weave: -0.6 } });
/** dense wool twill (tunic): sheen tinted by the albedo, so the green stays deep instead of minty */
const TWILL = surface('twill', { rough: 0.85, sheen: 0.4 });
/** heavy wool cloak */
const CLOAK_WOOL = surface('wool', { rough: 1, sheen: 0, pat: { weave: 1, fur: 0.5 } });
/** crushed red velvet (Galadhrim cloak) */
const VELVET = surface('wool', { rough: 0.9, sheen: 0.35, pat: { fur: 0.25 } });
/** antique bronze (Mirkwood) and gold (Galadhrim) leaf plate: shallow dents, a little less metal so the
 *  sky reflection does not turn it into yellow chrome */
const ELF_BRONZE = surface('gold', { rough: 0.52, metal: 0.78, pat: { scales: -0.5, scratches: 0.7, pores: 0.25 } });
/** the dark vein grooves of the cuirass */
const VEIN = surface('gold', { rough: 0.62, metal: 0.45, pat: { scratches: 0.3 } });
const ELF_GOLD = surface('gold', { rough: 0.52, metal: 0.7, pat: { scales: -0.3, scratches: 0.5 } });

/** belt raised from the hips to the natural waist (sheets: belt ≈ 1.16 m on a 1.85 m figure) */
const BELT_RAISE = 0.13;

interface ElfLook {
  galadhrim: boolean;
  tunic: number;
  tunicTrim: number;
  metal: number;
  trim: number;
  /** vein groove colour of the cuirass */
  vein: number;
  cloak: number;
  cloakTrim: number;
  /** colour in the cloak's pleat troughs (the lining) */
  cloakFold: number;
  /** gold embroidery on the cloak (Galadhrim) */
  cloakGold?: number;
  hair: number;
  hairTip: number;
  braids: boolean;
  hairLen: number;
}

// Colours: sRGB design values from the spec.json outfit_layers / armor / hair, cross-checked against
// the lit `observed.samples` and the turnarounds. Greens are desaturated and darkened (they render
// mint under the lab's sky light), the sheen follows the albedo.
const LOOKS: ElfLook[] = [
  // Mirkwood: tunic #4c6137 (lit #534e3f incl. gold), cloak #4c6137 (lit #303427: dark grey-green felted wool), metal #a07e39, hair #493728 (lit #2c1f18)
  { galadhrim: false, tunic: 0x253019, tunicTrim: 0x8c7236, metal: 0x84652f, trim: 0x7d6530, vein: 0x3a2b12, cloak: 0x364830, cloakTrim: 0x34452e, cloakFold: 0x1c261a, hair: 0x4a3728, hairTip: 0x5a4432, braids: false, hairLen: 1.35 },
  // Galadhrim: tunic dark olive #424832 (lit #322416), cloak deep red #74242c (lit #531216), metal #ae8c4b, hair #c7b18a (lit #c5945b)
  { galadhrim: true, tunic: 0x343822, tunicTrim: 0x9a7a38, metal: 0xb4893a, trim: 0x9a8040, vein: 0x6a4a1c, cloak: 0x5a1019, cloakTrim: 0x4a0c14, cloakFold: 0x3c0910, cloakGold: 0xb89448, hair: 0xc09a58, hairTip: 0xd8b878, braids: true, hairLen: 1.35 },
  // Mirkwood variant: amber-brown tunic with green trim, auburn hair
  { galadhrim: false, tunic: 0x4a351b, tunicTrim: 0x7a8a3c, metal: 0x735628, trim: 0x7d6530, vein: 0x45321a, cloak: 0x6a4a1f, cloakTrim: 0x35452a, cloakFold: 0x3e2a12, hair: 0x6b3419, hairTip: 0x844626, braids: false, hairLen: 1.3 },
  // Galadhrim variant: slate tunic, black hair
  { galadhrim: true, tunic: 0x3a4650, tunicTrim: 0x9a7a38, metal: 0xb4893a, trim: 0x9a8040, vein: 0x6a4a1c, cloak: 0x540f18, cloakTrim: 0x44090f, cloakFold: 0x38080e, cloakGold: 0xb89448, hair: 0x1d1814, hairTip: 0x2c241d, braids: true, hairLen: 1.35 },
];

const hairMats = new Map<number, THREE.MeshPhysicalMaterial>();
/** hair material: dark hair gets a brown (not white-blue) strand highlight, little sheen and spec */
function elfHairMaterial(color: number): THREE.MeshPhysicalMaterial {
  let m = hairMats.get(color);
  if (!m) {
    const dark = ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255) < 330;
    m = createHairMaterial({ roughness: dark ? 0.78 : 0.62, anisotropy: dark ? 0.3 : 0.6, sheen: dark ? 0.04 : 0.2, sheenColor: color, highlight: dark ? mix(color, 0x806040, 0.45) : 0xf0dcb0 });
    m.specularIntensity = dark ? 0.08 : 0.2;
    m.userData.shared = true;
    hairMats.set(color, m);
  }
  return m;
}

const PALETTE = {
  skin: 0xd8b294, // sheet #e0baa0 / #e2c3a9, a little warmer and deeper (a pale albedo renders as clay)
  skin2: 0xb98466,
  lips: 0xae7c70,
  brows: 0x5b4330,
  eyes: 0x6188a8, // sheet iris #5d8bb5, a touch greyer
  boots: 0x4a3522, // sheet leather #62462e / #584231
  bootsTrim: 0x3b2a1b,
  bracers: 0x57402a,
  bracersTrim: 0x3a2a1c,
  belt: 0x4c3524,
  leggings: 0x363a28, // sheet trousers #383d30 / #424832
  quiver: 0x6a4a2c,
  quiverTrim: 0x8c6a3c,
  fletch: 0xece8de,
  shaft: 0xb9a37b,
  buckle: 0xd2ad58,
};

/**
 * Drop the hair cards that lie inside the Mirkwood helm dome above its rim (they only poke through
 * the dome and rim at the temples and the back); what hangs below the rim stays: the fringe at the
 * ears and the long fall down the back.
 */
function cullUnderHelm(geo: THREE.BufferGeometry, P: KindContext['P']): THREE.BufferGeometry {
  const o = P.h(0, 0, 0);
  const sx = P.h(1, 0, 0)[0] - o[0];
  const sy = P.h(0, 1, 0)[1] - o[1];
  const sz = P.h(0, 0, 1)[2] - o[2];
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!idx) return geo;
  const m = 1.12;
  const rx = (0.322 + 0.045) * m;
  const ry = (0.4 + 0.045) * 1.22 * m;
  const rz = (0.43 + 0.045) * m;
  const out: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(i + k);
      cx += pos.getX(v) / 3;
      cy += pos.getY(v) / 3;
      cz += pos.getZ(v) / 3;
    }
    const xh = (cx - o[0]) / sx;
    const yh = (cy - o[1]) / sy;
    const zh = (cz - o[2]) / sz;
    const inside = (xh / rx) ** 2 + ((yh - 0.05) / ry) ** 2 + ((zh + 0.06) / rz) ** 2 < 1;
    const cosA = (zh + 0.06) / (Math.hypot(xh, zh + 0.06) || 1e-6);
    const rimY = 0.13 - (0.18 * (1 - cosA)) / 2 + 0.025;
    if (inside && yh > rimY) continue;
    out.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  geo.setIndex(out);
  return geo;
}

/**
 * The Galadhrim temple braids as two slim tapered plaits lying on the hair (the kit's own braids use
 * ~1.9k triangles of tight rings): from the temple hairline back over the head, ending at the back of
 * the crown. Rigid gear on the head bone, banded with a plait-like colour modulation.
 */
function templeBraids(ctx: KindContext, color: number) {
  const { P } = ctx;
  const s = P.s;
  const u = P.headH;
  const capT = 0.022;
  const lay = (0.0175 * s) / u;
  const onTop = (x: number, y: number, z: number, out: number): V3 => {
    const dx = x / 0.325;
    const dy = (y - 0.045) / 0.4;
    const dz = (z + 0.055) / 0.425;
    const l = Math.hypot(dx, dy, dz) || 1;
    return P.h((dx / l) * (0.325 + capT + out), 0.045 + (dy / l) * (0.4 + capT + out), -0.055 + (dz / l) * (0.425 + capT + out));
  };
  for (const sx of [1, -1]) {
    const pts = [onTop(0.262 * sx, 0.13, 0.27, lay * 0.3), onTop(0.335 * sx, 0.11, 0.12, lay * 0.8), onTop(0.37 * sx, 0.06, -0.06, lay), onTop(0.31 * sx, 0.0, -0.3, lay), onTop(0.12 * sx, -0.04, -0.47, lay), onTop(0.02 * sx, -0.06, -0.5, lay)];
    const g = taperedTube(pts, 0.0072 * s, 0.0042 * s, { seg: 16, radial: 5, tension: 0.5 });
    put(ctx, g, {
      bone: 'head',
      color: mix(color, 0x000000, 0.12),
      mat: surface('hair', { rough: 0.6, sheen: 0.25 }),
      small: true,
      colorFn: (p, _n, c) => c.multiplyScalar(0.78 + 0.26 * (0.5 + 0.5 * Math.sin((p.y * 0.8 + p.z * 0.6 + p.x * 0.4) * 320))),
    });
  }
}

/** dev: ?em_gear=1 records the triangles of this kind's own sheets in window.__elfTris (cost breakdown) */
function note(bucket: number, name: string, make: () => THREE.BufferGeometry | null) {
  if (typeof location === 'undefined' || new URLSearchParams(location.search).get('em_gear') !== '1') return;
  const geo = make();
  if (!geo) return;
  const t = ((window as unknown as { __elfTris?: Record<string, number> }).__elfTris ??= {});
  t[`${bucket}:${name}`] = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

function elfExtras(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const j = P.j;
  const A = ctx.armor;
  const bucket = ctxBucket(ctx);
  const L = LOOKS[bucket];
  const hipY = j.thigh_l[1];
  const cy = j.chest[1];
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;

  // ── hair: long (Mirkwood loose, Galadhrim with temple braids meeting at the back), lying over the cloak ──
  if (!devSkip('hair')) {
    const hair = { style: 'long_straight' as const, color: L.hair, tipColor: L.hairTip, length: L.hairLen, density: devNum('density', L.galadhrim ? 0.38 : 0.46), braids: 'none' as const };
    // the sculpted scalp cap is lit like the 'hair' surface (a cool sheen): give dark hair a warm cap colour
    sculptHairCap(ctx.sculpt, P, { ...hair, color: L.galadhrim ? hair.color : mix(hair.color, 0x6a4326, 0.25) }, false);
    const Pm = { ...P, build: { ...P.build, chest: P.build.chest * (L.galadhrim ? 1.9 : 1.8) } } as typeof P;
    let geo = buildHair(Pm, ctx.rig, hair, null, new Rng(hashSeed('elf', 'hair', bucket)), 1, false).geo;
    if (geo && ctx.helmet && !L.galadhrim) geo = cullUnderHelm(geo, P);
    note(bucket, 'hair2', () => geo);
    if (L.braids) templeBraids(ctx, hair.color);
    if (geo) attachSkinned(ctx, geo, elfHairMaterial(L.hair), { name: 'hair2' });
  }

  // ── tunic: long sleeves, high stand collar, hem to mid thigh ──
  sculptTorso(ctx, { color: L.tunic, mat: TWILL, inflate: 0.0066 * sc, hem: 0.5, sleeve: 2, neck: true, neckTop: 0.05 * sc, seams: true, color2: L.tunicTrim, colorNoise: 0.12 });

  // ── cloth sheets, one skinned mesh: tunic skirt panels, the cloak, the leaf-plate skirt ──
  const skirtTop = hipY + 0.035 * sc;
  const skirtBottom = hipY - (hipY - j.shin_l[1]) * 0.58 * 1.05;
  const cloth: THREE.BufferGeometry[] = [];
  // tunic skirt: a longer centre-front panel, side panels 8 cm higher, the back a little shorter
  SKIRT_PANELS.forEach((pn, i) => {
    const bottom = skirtBottom + [L.galadhrim ? -0.04 : -0.11, 0.08, 0.02, 0.08][i] * sc;
    cloth.push(skirtGeometry(P, ctx.rig, { top: skirtTop, bottom, color: L.tunic, color2: L.tunicTrim, mat: TWILL, panels: [pn], flare: 0.035 * sc, seed: hashSeed('elf', 'skirt', bucket, i) }));
  });
  note(bucket, 'skirt', () => mergeKitGeometries(cloth.slice()));
  cloth.push(
    elfCloak(P, ctx.rig, {
      color: L.cloak,
      trim: L.cloakTrim,
      fold: L.cloakFold,
      mat: L.galadhrim ? VELVET : CLOAK_WOOL,
      hem: L.galadhrim ? 0.12 : 0.14,
      rxHem: L.galadhrim ? 0.4 : 0.385,
      rzHem: L.galadhrim ? 0.26 : 0.28,
      backFlare: L.galadhrim ? 0.02 : 0.05,
      pleats: L.galadhrim ? 7 : 7,
      pleatDepth: L.galadhrim ? 0.03 : 0.05,
      aoFloor: L.galadhrim ? 0.7 : 0.72,
      tweed: L.galadhrim ? 0.04 : 0.08,
      mottle: L.galadhrim ? 0 : 0.12,
      vine: L.cloakGold,
      seed: bucket,
    }),
  );
  note(bucket, 'cloak+skirt', () => mergeKitGeometries(cloth.slice()));
  if (A >= 0.5) {
    // long leaf plates from the belt over the hips: a gap at the centre front (tunic shows), none at the back
    const plates: TassetLeaf[] = [];
    // three wide blades per side hanging to about 0.65 m, and a shorter one behind the hip
    const spec: [number, number, number][] = [
      [0.55, 0.5, 0.115],
      [0.98, 0.5, 0.12],
      [1.42, 0.44, 0.115],
      [1.85, 0.3, 0.1],
    ];
    for (const sd of [1, -1]) spec.forEach(([a, len, w], i) => plates.push({ a: a * sd, len: len * sc, w: w * sc, off: (i % 2) * 0.008 * sc, tone: i % 2 ? 0.93 : 1 }));
    cloth.push(leafTassets(P, ctx.rig, { top: beltY - 0.012 * sc, skirtBottom, color: L.metal, color2: L.trim, mat: L.galadhrim ? ELF_GOLD : ELF_BRONZE, leaves: plates, seed: bucket }));
  }
  const merged = mergeKitGeometries(cloth);
  note(bucket, 'cloth(all)', () => merged);
  for (const g of cloth) g.dispose();
  attachSkinned(ctx, merged, 'body', { small: false, name: 'cloth' });

  // ── armour by level ──
  const metalMat = L.galadhrim ? ELF_GOLD : ELF_BRONZE;
  if (A >= 0.5) {
    elfCuirass(ctx, { color: L.metal, trim: L.trim, mat: metalMat, veinColor: L.vein, veinMat: VEIN, beltY, bottom: L.galadhrim ? 0.0 : 0.025, fluted: L.galadhrim, chevron: !L.galadhrim, half: L.galadhrim ? 1.3 : 1.42 });
    leafBuckle(ctx, { y: beltY, color: L.trim, mat: metalMat });
  }
  if (A >= 0.75) elfPauldrons(ctx, { color: L.metal, mat: metalMat });

  // ── head: the Mirkwood helm with a tall crest of stacked leaf blades; the Galadhrim go bare-headed ──
  if (!L.galadhrim) {
    if (ctx.helmet) {
      elvenHelm(ctx, { color: L.metal, trim: L.trim, mat: ELF_BRONZE, trimMat: 'gold', crest: 0.01, wings: false });
      elfCrest(ctx, { color: L.metal, mat: ELF_BRONZE });
    } else leafCirclet(ctx, { color: L.trim });
  }

  // ── the Mirkwood guard's glaive: a curved leaf blade over the spear head (only while a spear is held) ──
  if (!L.galadhrim) addGlaiveHead(ctx, { blade: 0xd8dce0, trim: L.trim });

  // ── quiver on the right back, mouth over the shoulder blade (Galadhrim only: the Mirkwood sheet has none) ──
  if (!L.galadhrim) return;
  const q: QuiverOpts = {
    center: [-0.085 * sc, cy + 0.075 * sc, -0.2 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.28, 1, -0.04).normalize(),
    length: 0.48 * sc,
    radius: 0.034 * sc,
    color: PALETTE.quiver,
    trim: PALETTE.quiverTrim,
    mat: TOOLED,
    arrows: 6,
    fletch: PALETTE.fletch,
    shaft: PALETTE.shaft,
    bone: 'quiver',
    knives: null,
    seed: 3 + bucket,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);
}

export const elfDef: KindDef = {
  label: 'Elf warrior',
  height: 1.86,
  build: { shoulders: 0.98, hips: 0.95, bulk: 0.9, chest: 1.04, armLength: 1.0, legLength: 1.03, headSize: 0.96, neck: 1.05, neckThick: 0.9, muscle: 0.4, handSize: 0.97, footSize: 0.97 },
  face: {
    jaw: 0.9,
    chin: 0.95,
    jawLength: 0.95,
    brow: 0.85,
    cheekbones: 1.12,
    nose: { length: 0.8, width: 0.84, bridge: 1.05, tip: 0.85 },
    lips: { width: 0.9, fullness: 0.8 },
    ears: 'pointed',
    eyeSize: 1.08,
    eyeTilt: 0.1,
    eyeOpen: 1.0,
    foreheadSlope: 0.08,
  },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.04, blemish: 0.01, wrinkles: 0, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xc87866, surface: 'skin' },
  eyes: { color: PALETTE.eyes, sclera: 0xeee9e0 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  palette: { buckle: PALETTE.buckle },
  outfit: [
    { type: 'leggings', color: PALETTE.leggings, mat: WOOL },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.95, thickness: 0.004, mat: TOOLED },
    // stiff tooled bracers from the wrist almost to the elbow (sheets: leather at every armour level)
    { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.bracersTrim, length: 0.88, thickness: 0.003, mat: TOOLED },
    { type: 'belt', color: PALETTE.belt, offset: BELT_RAISE, mat: TOOLED },
    // spring bones only: the hem panels and the cloak are built per bucket in extras
    { type: 'skirt', color: 0x4a5a34, chance: 0 },
    { type: 'cloak', color: 0x36482b, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'none', left: 'elven_bow' },
  sfx: { voice: 'elf', weight: 0.4 },
  anim: { grace: 0.9, aggression: 0.3, stance: 0.97, armSwing: 0.9 },
  variation: { height: 0.025, bulk: 0.05, skin: 0.05 },
  detail: { detailScale: 1, res: devNum('res', 0.068), headRes: devNum('headRes', 0.016), faceRes: 0 },
  extras: elfExtras,
};
