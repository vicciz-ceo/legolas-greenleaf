/**
 * Soldiers of Rohan, refined against docs/refs/rohirrim (the sheet is bucket 0):
 * a dark mail hauberk with short sleeves to mid-hip over a green wool under-tunic (long sleeves to
 * the wrist, a braid-bordered skirt below the mail), a thick green wool cowl on the shoulders with
 * a bronze brooch, a leather strap from the left shoulder to the right hip, a wide belt with a
 * bronze boss and two hanging tails, tooled bracers, tall brown boots, and a round steel helm with
 * a brow band, nasal bar, cheek plates and a horsehair plume (the shield is the kit's painted round
 * shield, `weapons.style: 'rohan'`). Four looks:
 *   0  green tunic, auburn hair and beard, chestnut crest, green cowl (the sheet)
 *   1  brown tunic, dark hair, moustache, black crest, brown cowl
 *   2  green-grey tunic, long red-auburn hair and beard, rust crest, brown cloak, a scar
 *   3  brown tunic with red trim, grey hair with side braids, grey beard, white crest
 * Armour level adds leather shoulder caps (0.75).
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { HairDef, KindContext, KindDef } from '../../types';
import { ctxBucket, devNum, mix, shade, withHair } from './common';
import { addCloak } from './cloth';
import { paintScar } from './detail';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { sculptCowl, sculptShoulderCap, sculptTorso } from './garments';
import { torsoCentreFront } from './geo';
import { rohirrimHelm } from './rohirrim_helm';
import { addHemSkirt, sculptHelmHair, torsoRibbon, torsoSurface } from './rohirrim_gear';

/** wool twill (tunic, cowl) */
const TWILL = surface('twill', { rough: 0.85, sheen: 0.3 });
/** dense wool (trousers) */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.2, pat: { weave: -0.6 } });
/** stitched, creased brown leather (belt, strap, boots) */
const LEATHER = surface('leather_worn', { rough: 0.7, sheen: 0.08 });
/** tooled leather (bracers) */
const TOOLED = surface('leather_tooled', { rough: 0.66, sheen: 0.1 });

/** belt raised to the sheet's waist (belt centre ~1.07 m, the hip joint is at 0.93 m) */
const BELT_RAISE = 0.06;
/** mail hem (fraction of hip→knee below the hip joint) → ~0.85 m; skirt hem → ~0.67 m (sheet front view) */
const MAIL_HEM = 0.12;
const SKIRT_LEN = 0.585;

// sRGB from docs/refs/rohirrim/spec.json, corrected for how the lab renders colours
const PALETTE = {
  // sheet skin_base #b98f73 (lit sample #b06c59, sun-ruddy): a little warmer and deeper than the hex
  skin: 0xb98563,
  skin2: 0xa6704f,
  lips: 0xa4655a,
  brows: 0x6a4a2c,
  eyes: 0x77785a, // sheet iris #817454: grey-green hazel, a touch greyer
  // outfit_layers tunic #4d593c (lit #434437): a muted, darker wool so it does not render mint
  tunic: 0x35402f,
  trousers: 0x372e27, // sheet #483d33, lit #3a312d
  leather: 0x372716, // #67503b design, belt/strap lit #583a2b/#574436
  leatherDark: 0x30231a,
  bracers: 0x47331f,
  boots: 0x4a3828, // lit #5d4338
  bootsTrim: 0x4e3a28,
  // armor metal #8a8980 / steel_mail lit #413a32: the mail is dark with bright rings
  mail: 0x68655e,
  bronze: 0xb08d4e, // shield rim / brooch / belt boss / helm trim, lit #6b584f
  braid: 0x7a5f2e, // the gold-brown braid border on hem and sleeves
};

interface RohLook {
  tunic: number;
  trim: number;
  cowl?: number;
  cloak?: number;
  crest: number;
  helm: number;
  hair: HairDef;
  beard?: { color: number; thick: number; cheeks: number; chin?: number; mustache?: boolean };
}

function rohirrimExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const A = ctx.armor;
  const b = ctxBucket(ctx);
  const wool = surface('wool', { rough: 0.9 });
  const dn = devNum('density', 0.38);
  const looks: RohLook[] = [
    // the sheet: sheet hair root #614b31 / lit #6e462b, a warm chestnut with sandy waves; plume the same horsehair
    { tunic: PALETTE.tunic, trim: PALETTE.braid, cowl: 0x3b4a35, crest: 0x573720, helm: 0x8a8c8e, hair: { style: 'long_wavy', color: 0x62401f, tipColor: 0x7a5129, length: 1.15, density: dn }, beard: { color: 0x5a3a20, thick: 0.045, cheeks: 0.6, chin: 0.02 } },
    { tunic: 0x6b4a2c, trim: 0x8a6a30, cowl: 0x5a4028, crest: 0x1d1a18, helm: 0x6e7074, hair: { style: 'shoulder', color: 0x3a2a1c, tipColor: 0x4a382a, length: 1.0, density: dn }, beard: { color: 0x2e2016, thick: 0.03, cheeks: 0.1, mustache: true } },
    { tunic: 0x58613f, trim: 0xa07a3c, cloak: 0x5f4528, crest: 0x7c3f1e, helm: 0x8a8a88, hair: { style: 'long_wavy', color: 0x7a3d1d, tipColor: 0x90502a, length: 1.1, density: dn }, beard: { color: 0x6e3718, thick: 0.05, cheeks: 0.5, chin: 0.015 } },
    { tunic: 0x6e5030, trim: 0x8e3a26, cowl: 0x3b4a35, crest: 0xe0dccf, helm: 0x7a7c7e, hair: { style: 'long_straight', color: 0x8e8a80, tipColor: 0xa29e94, length: 0.95, density: dn }, beard: { color: 0x9a968c, thick: 0.075, cheeks: 0.7, chin: 0.04 } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet;
  const mailMat = surface('mail', { rough: 0.55, pat: { scales: 1.6, scratches: 0.5 } });
  const hipY = P.j.thigh_l[1];

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: 0.3, mustache: L.beard.mustache !== false, cheeks: 0.5 });
    sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [-0.15, 0.02], to: [-0.2, -0.28] });

  // ── hair ──
  if (helmed) {
    // under the helm: sculpted locks (strand cards would poke through the dome)
    sculptHelmHair(ctx, { color: L.hair.color, color2: L.hair.tipColor ?? L.hair.color, length: L.hair.style === 'shoulder' ? 0.7 : 1 });
  } else {
    withHair(ctx, () => {
      addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('rohirrim', 'hair', b)), lod: 1, backClear: L.cloak ? 1.3 : 1.12, cap: true });
    });
  }

  // ── the under-tunic (long sleeves to the wrist), the mail hauberk over it ──
  sculptTorso(ctx, { color: L.tunic, mat: TWILL, inflate: 0.0125 * sc, hem: 0.3, sleeve: 2, neck: false, thighs: true, seams: true, color2: mix(L.tunic, L.trim, 0.45), colorNoise: 0.15 });
  sculptTorso(ctx, { color: PALETTE.mail, mat: mailMat, inflate: 0.0185 * sc, hem: MAIL_HEM, sleeve: 0.85, neck: false, thighs: true, seams: true });
  // the green skirt hangs from the hips under the mail hem to mid-thigh (sheet: mail hem ~0.85 m, skirt hem ~0.67 m);
  // `grow < 0` keeps it inside the hauberk's hips so the mail reads as the outer layer
  const kneeY = P.j.shin_l[1];
  addHemSkirt(ctx, { top: hipY + 0.035 * sc, bottom: hipY - (hipY - kneeY) * SKIRT_LEN * 1.05, color: L.tunic, color2: L.trim, mat: TWILL, flare: 0.05 * sc, grow: -0.012 * sc });
  if (L.cloak !== undefined) addCloak(ctx, { color: L.cloak, color2: shade(L.cloak, 0.7), mat: wool, length: 0.6, mantle: true });
  if (L.cowl !== undefined) sculptCowl(ctx, { color: L.cowl, color2: shade(L.cowl, 0.8), mat: TWILL, size: 1.9, drape: 0.03 });
  if (A >= 0.75) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.024 * sc, reach: 0.3 });

  // ── rigid leather and bronze on the torso (a 3 cm strap cannot live in the 6 cm body mesh) ──
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;
  const out = 0.0185 * sc; // the mail's inflation
  // baldric from the left shoulder across the chest and back to the right hip, ending under the belt
  const sx0 = 0.1 * sc;
  const sy0 = P.j.neck[1] - 0.05 * sc;
  const slope = 1.45;
  const path: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const x = sx0 - (i / 10) * 0.29 * sc;
    const y = sy0 + slope * (x - sx0);
    if (y > beltY - 0.005 * sc) path.push([x, y]);
  }
  for (const side of [1, -1] as const) {
    ctx.gear(torsoRibbon(P, path, side, 0.034 * sc, out + 0.012 * sc), { bone: 'chest', color: PALETTE.leather, mat: LEATHER, small: true });
  }
  // brooch on the left shoulder
  const br = torsoSurface(P, 0.088 * sc, P.j.neck[1] - 0.07 * sc, 1, out + 0.018 * sc);
  ctx.gear(new THREE.CylinderGeometry(0.025 * sc, 0.025 * sc, 0.007 * sc, 12).rotateX(Math.PI / 2).translate(br.p.x, br.p.y, br.p.z), { bone: 'chest', color: PALETTE.bronze, mat: 'metal', small: true });
  // belt boss and two hanging tails with bronze tips
  const zb = torsoCentreFront(P, beltY) + 0.027 * sc;
  ctx.gear(new THREE.CylinderGeometry(0.03 * sc, 0.03 * sc, 0.008 * sc, 14).rotateX(Math.PI / 2).translate(0, beltY, zb + 0.004 * sc), { bone: 'hips', color: PALETTE.bronze, mat: 'metal', small: true });
  ctx.gear(new THREE.SphereGeometry(0.014 * sc, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, beltY, zb + 0.008 * sc), { bone: 'hips', color: shade(PALETTE.bronze, 1.2), mat: 'metal', small: true });
  for (const [x, len] of [[0.026, 0.3], [0.056, 0.26]] as [number, number][]) {
    const top = beltY - 0.012 * sc;
    const zTop = zb + 0.002 * sc;
    const zBot = zTop + 0.034 * sc;
    const lean = Math.atan2(zBot - zTop, len * sc);
    const g = new THREE.BoxGeometry(0.02 * sc, len * sc, 0.005 * sc).rotateX(-lean).translate(x * sc, top - (len * sc) / 2, (zTop + zBot) / 2);
    ctx.gear(g, { bone: 'hips', color: PALETTE.leather, mat: LEATHER, small: true });
    const tip = new THREE.BoxGeometry(0.02 * sc, 0.016 * sc, 0.007 * sc).rotateX(-lean).translate(x * sc, top - len * sc + 0.008 * sc, zBot);
    ctx.gear(tip, { bone: 'hips', color: PALETTE.bronze, mat: 'metal', small: true });
  }

  // ── the helm with its horsehair plume ──
  if (helmed) {
    const crestRng = new Rng(hashSeed('rohirrim', 'crest', b));
    rohirrimHelm(ctx, { color: L.helm, trim: PALETTE.bronze, crest: L.crest, rng: () => crestRng.float() });
  }
}

export const rohirrimDef: KindDef = {
  label: 'Rohirrim',
  height: 1.82,
  build: { shoulders: 1.1, bulk: 1.05, chest: 1.03, neckThick: 1.1, muscle: 0.5, handSize: 1.04 },
  face: { jaw: 1.05, chin: 1.0, brow: 1.05, cheekbones: 1.02, nose: { length: 1.0, width: 0.98, bridge: 1.03 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.95, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.28, blemish: 0.12, wrinkles: 0.22, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xc87055, surface: 'skin_weathered' },
  eyes: { color: PALETTE.eyes, sclera: 0xe8e2d6 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  outfit: [
    { type: 'trousers', color: PALETTE.trousers, mat: WOOL },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.88, thickness: 0.004, mat: LEATHER },
    // leather bracers from the wrist to the elbow, a wide belt
    { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.leatherDark, length: 0.62, thickness: 0.003, mat: TOOLED },
    { type: 'belt', color: PALETTE.leather, offset: BELT_RAISE, thickness: 0.006, mat: LEATHER },
    // spring bones only: hem panels and cloaks are built per bucket in extras
    { type: 'skirt', color: PALETTE.tunic, chance: 0 },
    { type: 'cloak', color: 0x39502d, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'shield', style: 'rohan' },
  palette: PALETTE,
  sfx: { voice: 'man', weight: 0.55 },
  anim: { swagger: 0.2, aggression: 0.4, stance: 1.04 },
  variation: { height: 0.04, bulk: 0.07, skin: 0.08 },
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.0165), faceRes: 0 },
  extras: rohirrimExtras,
};
