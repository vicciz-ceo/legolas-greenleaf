/**
 * Soldiers of Rohan, refined against docs/refs/rohirrim (the sheet is bucket 0):
 * a dark mail hauberk with short sleeves to mid-hip over a green wool under-tunic (long sleeves to
 * the wrist, a skirt below the mail), a thin green mantle on the shoulders with a bronze brooch, a
 * leather strap from the left shoulder to the right hip, a wide belt with a bronze boss and two
 * hanging tails, tooled bracers, tall brown boots with strap bands, and a round steel helm with a
 * brass brow band, nasal bar, cheek plates and a horsehair plume (the shield is the kit's painted
 * round shield, `weapons.style: 'rohan'`). Four looks:
 *   0  green tunic, golden-brown hair and beard, brown crest, green mantle (the sheet)
 *   1  brown tunic, dark hair, moustache, black crest, brown mantle
 *   2  green-grey tunic, long red-auburn hair and beard, rust crest, brown cloak, a scar
 *   3  brown tunic with red trim, grey hair with side braids, grey beard, white crest, green mantle
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
import { sculptShoulderCap, sculptTorso } from './garments';
import { ring, torsoCentreFront } from './geo';
import { rohirrimHelm } from './rohirrim_helm';
import { addHemSkirt, sculptHelmHair, sculptMantle, torsoRibbon, torsoSurface } from './rohirrim_gear';

/** wool twill (tunic, mantle) */
const TWILL = surface('twill', { rough: 0.9, sheen: 0.3 });
/** dense wool (trousers) */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.2, pat: { weave: -0.6 } });
/** stitched, creased brown leather (belt, strap, boots) */
const LEATHER = surface('leather_worn', { rough: 0.7, sheen: 0.08 });
/** tooled leather (bracers) */
const TOOLED = surface('leather_tooled', { rough: 0.66, sheen: 0.1 });
/** bronze fittings: rough enough that they do not throw white specular hot spots */
const BRONZE = surface('metal', { rough: 0.5 });
/** dark mail: a fine ring pattern (a third of the stock cell size), half metal */
const MAIL = surface('mail', { rough: 0.55, metal: 0.75, pat: { scales: 0.9, scratches: 0.25 } });

/** belt raised to the sheet's waist (belt centre ~1.07 m, the hip joint is at 0.93 m) */
const BELT_RAISE = 0.06;
/** mail hem (fraction of hip→knee below the hip joint) → ~0.85 m; skirt hem → ~0.67 m (sheet front view) */
const MAIL_HEM = 0.12;
const SKIRT_LEN = 0.585;
/** the hauberk's inflation over the body; the strap, brooch and belt hardware ride on it */
const MAIL_INFLATE = 0.016;

// sRGB from docs/refs/rohirrim/spec.json, corrected for how the lab renders colours
const PALETTE = {
  // sheet skin_base #b98f73 (lit sample #b06c59, sun-ruddy): a touch deeper so it does not render as pale clay
  skin: 0xbb8d6c,
  skin2: 0xa87b5b,
  lips: 0xa4655a,
  brows: 0x5a4430,
  eyes: 0x77785a, // sheet iris #817454: grey-green hazel, a touch greyer
  // outfit_layers tunic #4d593c (lit #434437): a muted, dark wool so it does not render mint
  tunic: 0x3f4a31,
  trousers: 0x3f352c, // sheet #483d33, lit #3a312d: charcoal brown
  leather: 0x372716, // #67503b design, belt/strap lit #583a2b/#574436
  leatherDark: 0x30231a,
  bracers: 0x47331f,
  boots: 0x5a3f2c, // lit #5d4338
  bootsTrim: 0x5e432f,
  // armor metal #8a8980 / steel_mail lit #413a32: the mail is dark gunmetal-brown with bright rings
  mail: 0x544b41,
  bronze: 0xb08d4e, // shield rim / brooch / belt boss / helm trim, lit #6b584f
  braid: 0x8a6e3a, // the gold-brown braid border
  hair: 0x57402a, // sheet root #614b31, lit #6e462b: dark golden brown, not copper
  hairTip: 0x6b5232,
};

interface RohLook {
  tunic: number;
  trim: number;
  mantle?: number;
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
  const wool = surface('wool', { rough: 0.9 });
  const dn = devNum('density', 0.38);
  const looks: RohLook[] = [
    // the sheet: golden-brown waves, a full beard and a moustache in the hair tint; the plume is the same horsehair
    { tunic: PALETTE.tunic, trim: PALETTE.braid, mantle: 0x3b4630, crest: 0x573720, helm: 0x8a8c8e, hair: { style: 'long_wavy', color: PALETTE.hair, tipColor: PALETTE.hairTip, length: 1.15, density: dn }, beard: { color: 0x5a4430, thick: 0.06, cheeks: 0.7, chin: 0.025, mustache: true } },
    { tunic: 0x6b4a2c, trim: 0x8a6a30, mantle: 0x5a4028, crest: 0x1d1a18, helm: 0x6e7074, hair: { style: 'shoulder', color: 0x3a2a1c, tipColor: 0x4a382a, length: 1.0, density: dn }, beard: { color: 0x2e2016, thick: 0.03, cheeks: 0.1, mustache: true } },
    { tunic: 0x58613f, trim: 0xa07a3c, cloak: 0x5f4528, crest: 0x7c3f1e, helm: 0x8a8a88, hair: { style: 'long_wavy', color: 0x6a3a1c, tipColor: 0x7e4a26, length: 1.1, density: dn }, beard: { color: 0x6e3718, thick: 0.05, cheeks: 0.5, chin: 0.015 } },
    { tunic: 0x6e5030, trim: 0x8e3a26, mantle: 0x3b4630, crest: 0xe0dccf, helm: 0x7a7c7e, hair: { style: 'long_straight', color: 0x8e8a80, tipColor: 0xa29e94, length: 0.95, braids: 'side', density: dn }, beard: { color: 0x9a968c, thick: 0.075, cheeks: 0.7, chin: 0.04 } },
  ];
  const L = looks[b];
  const helmed = ctx.helmet;
  const hipY = P.j.thigh_l[1];
  const kneeY = P.j.shin_l[1];
  const neckY = P.j.neck[1];

  // ── face ──
  if (L.beard) {
    paintStubble(ctx, { color: L.beard.color, paint: 0.3, mustache: L.beard.mustache !== false, cheeks: 0.5 });
    sculptBeard(ctx, { color: L.beard.color, thick: L.beard.thick, cheeks: L.beard.cheeks, chin: L.beard.chin ?? 0, mustache: L.beard.mustache !== false });
  }
  if (b === 2) paintScar(ctx, { from: [-0.15, 0.02], to: [-0.2, -0.28] });

  // ── hair ──
  if (helmed) {
    // under the helm: sculpted nape plus wavy locks over the shoulders (strand cards would poke through the dome)
    sculptHelmHair(ctx, { color: L.hair.color, color2: L.hair.tipColor ?? L.hair.color, length: L.hair.style === 'shoulder' ? 0.6 : 1 });
  } else {
    withHair(ctx, () => {
      addHair(ctx, { hair: L.hair, rng: new Rng(hashSeed('rohirrim', 'hair', b)), lod: 1, backClear: L.cloak ? 1.3 : 1.12, cap: true });
    });
  }

  // ── the under-tunic (long sleeves to the wrist), the mail hauberk over it ──
  sculptTorso(ctx, { color: L.tunic, mat: TWILL, inflate: 0.011 * sc, hem: 0.3, sleeve: 2, neck: false, thighs: true, seams: true, color2: mix(L.tunic, L.trim, 0.3), colorNoise: 0.12 });
  // short mail sleeves to mid-biceps, so the green under-sleeve reads as a band down to the bracer
  sculptTorso(ctx, { color: PALETTE.mail, mat: MAIL, inflate: MAIL_INFLATE * sc, hem: MAIL_HEM, sleeve: 0.5, neck: false, thighs: true, seams: true });
  // the green skirt hangs from the hips under the mail hem to mid-thigh (sheet: mail hem ~0.85 m, skirt hem ~0.67 m);
  // `grow < 0` keeps it inside the hauberk's hips so the mail reads as the outer layer; a darker hem, no tan fade
  addHemSkirt(ctx, { top: hipY + 0.035 * sc, bottom: hipY - (hipY - kneeY) * SKIRT_LEN * 1.05, color: L.tunic, color2: mix(L.tunic, L.trim, 0.22), mat: TWILL, flare: 0.07 * sc, grow: -0.01 * sc });
  if (L.cloak !== undefined) addCloak(ctx, { color: L.cloak, color2: shade(L.cloak, 0.7), mat: wool, length: 0.6, mantle: true });
  // a thin flat mantle (hood worn down) over the shoulder tops, in the tunic family
  const mantleY0 = P.j.upperarm_l[1] - 0.04 * sc;
  if (L.mantle !== undefined) sculptMantle(ctx, { color: L.mantle, color2: shade(L.mantle, 0.8), mat: TWILL, inflate: (MAIL_INFLATE + 0.006) * sc, y0: mantleY0 });
  if (A >= 0.75) sculptShoulderCap(ctx, { color: 0x4a3626, mat: 'leather_worn', side: 'both', inflate: 0.024 * sc, reach: 0.3 });

  // ── rigid leather and bronze on the torso (a 3 cm strap cannot live in the 6 cm body mesh) ──
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;
  const out = MAIL_INFLATE * sc;
  // baldric from the left shoulder (under the mantle edge) across the chest and back to the right hip, ending under the belt
  const sx0 = 0.095 * sc;
  const sy0 = mantleY0 + 0.01 * sc;
  const slope = 1.45;
  const path: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const x = sx0 - (i / 10) * 0.27 * sc;
    const y = sy0 + slope * (x - sx0);
    if (y > beltY - 0.005 * sc) path.push([x, y]);
  }
  for (const side of [1, -1] as const) {
    ctx.gear(torsoRibbon(P, path, side, 0.034 * sc, out + 0.012 * sc), { bone: 'chest', color: PALETTE.leather, mat: LEATHER, small: true });
  }
  // brooch where the strap meets the mantle edge on the left shoulder
  const br = torsoSurface(P, 0.098 * sc, sy0 + 0.012 * sc, 1, out + 0.024 * sc);
  ctx.gear(new THREE.CylinderGeometry(0.024 * sc, 0.024 * sc, 0.007 * sc, 10).rotateX(Math.PI / 2).translate(br.p.x, br.p.y, br.p.z), { bone: 'chest', color: PALETTE.bronze, mat: BRONZE, small: true });
  // belt boss and two hanging tails
  const zb = torsoCentreFront(P, beltY) + 0.027 * sc - (0.0185 - MAIL_INFLATE) * sc;
  ctx.gear(new THREE.CylinderGeometry(0.03 * sc, 0.03 * sc, 0.008 * sc, 12).rotateX(Math.PI / 2).translate(0, beltY, zb + 0.004 * sc), { bone: 'hips', color: PALETTE.bronze, mat: BRONZE, small: true });
  for (const [x, len] of [[0.026, 0.3], [0.056, 0.26]] as [number, number][]) {
    const top = beltY - 0.012 * sc;
    const zTop = zb + 0.002 * sc;
    const zBot = zTop + 0.034 * sc;
    const lean = Math.atan2(zBot - zTop, len * sc);
    const g = new THREE.BoxGeometry(0.02 * sc, len * sc, 0.005 * sc).rotateX(-lean).translate(x * sc, top - (len * sc) / 2, (zTop + zBot) / 2);
    ctx.gear(g, { bone: 'hips', color: PALETTE.leather, mat: LEATHER, small: true });
  }
  // dark strap bands round each boot: the cuff at the top and one below
  const bootTop = P.ankleH + (kneeY - P.ankleH) * BOOT_LEN;
  for (const sd of ['l', 'r'] as const) {
    const knee = P.j[`shin_${sd}`];
    const foot = P.j[`foot_${sd}`];
    const ax: [number, number, number] = [knee[0] - foot[0], knee[1] - foot[1], knee[2] - foot[2]];
    for (const yb of [bootTop - 0.012 * sc]) {
      const t = (yb - foot[1]) / (knee[1] - foot[1]);
      const c: [number, number, number] = [foot[0] + ax[0] * t, yb, foot[2] + ax[2] * t - 0.008 * sc];
      ctx.gear(ring(c, ax, 0.067 * sc * Math.sqrt(P.build.bulk), 0.0045 * sc, 8, 3), { bone: `shin_${sd}`, color: PALETTE.leatherDark, mat: LEATHER, small: true });
    }
  }

  // ── the helm with its horsehair plume ──
  if (helmed) {
    const crestRng = new Rng(hashSeed('rohirrim', 'crest', b));
    rohirrimHelm(ctx, { color: L.helm, trim: PALETTE.bronze, crest: L.crest, rng: () => crestRng.float() });
  }
}

/** boot shaft: fraction of the ankle→knee distance (the stock default is 0.82; the sheet's boots reach the knee) */
const BOOT_LEN = 0.97;

export const rohirrimDef: KindDef = {
  label: 'Rohirrim',
  height: 1.82,
  build: { shoulders: 1.08, bulk: 1.02, chest: 1.0, neckThick: 1.05, muscle: 0.3, handSize: 1.04 },
  face: { jaw: 1.05, chin: 1.0, brow: 1.05, cheekbones: 1.02, nose: { length: 1.0, width: 0.98, bridge: 1.03 }, lips: { fullness: 0.95 }, ears: 'round', eyeOpen: 0.95, foreheadSlope: 0.12, asym: 0.05 },
  skin: { color: PALETTE.skin, color2: PALETTE.skin2, blotch: 0.28, blemish: 0.12, wrinkles: 0.22, lips: PALETTE.lips, brows: PALETTE.brows, scatter: 0xcf7860, surface: 'skin_weathered' },
  eyes: { color: PALETTE.eyes, sclera: 0xe8e2d6 },
  hair: noKitHair(PALETTE.skin),
  beard: null,
  outfit: [
    // trousers a little slimmer so the hauberk and boots stand clear of them
    { type: 'trousers', color: PALETTE.trousers, thickness: -0.003, mat: WOOL },
    { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: BOOT_LEN, thickness: 0.012, mat: LEATHER },
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
  detail: { detailScale: 1, res: devNum('res', 0.06), headRes: devNum('headRes', 0.017), faceRes: 0 },
  extras: rohirrimExtras,
};
