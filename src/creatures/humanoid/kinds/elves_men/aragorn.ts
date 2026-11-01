/**
 * Aragorn, the Ranger (~1.88 m): long dark chestnut curls to mid-chest, a weathered face with
 * stubble and a short beard, a dark linen shirt open at the throat under a laced reddish-brown
 * leather vest and a knee-length green-grey wool coat (frayed hems, flat lapels, sleeves bunched
 * over tooled brown leather bracers), a double belt with pouches, tall strapped boots and a sword
 * in a leather scabbard at the left hip. Refined against docs/refs/aragorn.
 */
import * as THREE from 'three';
import { Rng, hashSeed } from '../../../../core/rng';
import { surface } from '../../../kit/surfaces';
import type { V3 } from '../../../kit/sdf';
import { skirtGeometry } from '../../cloth';
import { anatomyParts, emitParts } from '../../anatomy';
import type { KindContext, KindDef } from '../../types';
import { attachSkinned, devNum, devSkip, withHair } from './common';
import { sheathed } from './detail';
import { put, studs, taperedTube, torsoSection, tube } from './geo';
import { addHair, noKitHair, paintStubble, sculptBeard } from './hair';
import { matteHair, tallBoots } from './gondor_parts';
import { sculptBand, sculptTorso } from './garments';
import { limbGuards } from './armor';

// sRGB design colours from docs/refs/aragorn/spec.json (outfit_layers, armor, hair, face), corrected
// against the turnaround's lit samples (observed.samples) for how the lab / AgX render albedos
const PAL = {
  hair: 0x38271c, // sheet root #30261f → tip #49372b; the turnaround's curls read chestnut (lit #37251e), a touch lighter than the root
  hairTip: 0x3d2a1e, // tips ≈ root: the kit's tip lerp otherwise shows pale streaks under the sky light
  // a weathered, sun-browned face: deeper and warmer than the sheet's #b98e73 (that albedo renders pink-clay)
  skin: 0xa4704f,
  skin2: 0x8c5b40,
  lips: 0x95584e,
  brows: 0x33241a,
  eyes: 0x72806f, // sheet #778077, grey-green
  trousers: 0x2b2620, // dark wool breeches (observed #332b20); a distinct value from the boots and the coat
  boots: 0x5a3a28, // warm mid-brown worn leather (observed #524037)
  bootsTrim: 0x3d2a1c,
  shirt: 0x2c2a29, // observed #3c3837 dark charcoal
  jerkin: 0x5c3b2b, // reddish-brown stitched vest (observed #452e22 in shade)
  jerkinTrim: 0x3e281c,
  coat: 0x4f4a3b, // weathered grey-olive/khaki wool (sheet #565b4b, observed #665c4b lit): it renders greener and lighter than the albedo, so warm and dark
  coatTrim: 0x433f31,
  coatFray: 0x6e6347, // tan frayed hem band and lapel cord
  bracers: 0x5d4231, // tooled brown leather (the sheet's bracers are brown, not black; observed #67534e)
  bracersTrim: 0x3a291d,
  belt: 0x4a3322,
  pouch: 0x553a2a, // observed #5a4038
  steel: 0xa2a4a6,
  scabbard: 0x3f2a1e,
};

/** faded green-grey coarse wool twill (coat) */
const COAT = surface('twill', { rough: 0.95, sheen: 0.2, pat: { weave: -1.6, fur: 0.25 } });
/** stitched, creased brown leather (vest, belts, pouches) */
const LEATHER = surface('leather_worn', { rough: 0.66, sheen: 0.1 });
/** embossed brown leather (bracers, boots, scabbard) */
const TOOLED = surface('leather_tooled', { rough: 0.6, sheen: 0.1 });
const LINEN = surface('linen', { rough: 0.9, sheen: 0.12 });

/** coat hem height as a multiple of the body scale (sheet: front ~0.5 m, back ~0.52 m at 1.88 m) */
const COAT_HEM = 0.492;
/** belt height above the kit default (sheet buckle ~1.17 m; measured on the calibrated compare) */
const BELT_UP = 0.15;

/**
 * Extra locks of chestnut wavy hair (rigid, on the chest bone) that carry the kit's shoulder-length hair
 * down behind the trapezius to the shoulder blades: 15 overlapping, staggered-length locks across the
 * back (sheet: the hair ends at ~1.28 m). Nothing hangs in front of the shoulders or across the face.
 */
function hairLocks(ctx: KindContext) {
  const { P } = ctx;
  const sc = P.s;
  const ny = P.j.neck[1];
  const rng = new Rng(hashSeed('aragorn', 'locks'));
  const mat = surface('hair', { rough: 0.85, sheen: 0.08 });
  const sec = (y: number) => torsoSection(P, Math.min(y, ny - 0.01 * sc));
  const top = ny + 0.05 * sc;
  const n = 24;
  // a darker undercoat first: wide, shallow locks hugging the back, so neither skin nor coat shows between the locks
  for (let k = 0; k < 10; k++) {
    const f = k / 9;
    const x0 = (-0.115 + 0.23 * f) * sc;
    const y1 = ny - (0.14 + 0.06 * rng.float()) * sc;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = top + (y1 - top) * t;
      pts.push([x0 * (1 + 0.05 * t), y, sec(y).zb - 0.02 * sc]);
    }
    put(ctx, taperedTube(pts, 0.022 * sc, 0.008 * sc, { seg: 8, radial: 4 }), { bone: 'chest', color: 0x2e1f16, mat, small: true });
  }
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    const x0 = (-0.13 + 0.26 * f) * sc * (1 - 0.1 * Math.abs(f - 0.5));
    const y1 = ny - (0.15 + 0.14 * rng.float()) * sc;
    const phase = k * 1.9;
    const wave = (0.008 + 0.005 * rng.float()) * sc;
    const depth = (0.03 + (k % 3) * 0.008) * sc;
    const pts: V3[] = [];
    const m = 8;
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      const y = top + (y1 - top) * t;
      const x = x0 * (1 + 0.08 * t) + Math.sin(t * 8 + phase) * wave * t;
      pts.push([x, y, sec(y).zb - depth + Math.cos(t * 6 + phase) * 0.005 * sc * t]);
    }
    const root = mix3(0x3d2a1e, 0x4e3524, rng.float());
    const tip = mix3(0x5a402c, 0x6e4e36, rng.float());
    // swells out of the hair above (dark root), then tapers to a lighter tip: two tapered halves
    put(ctx, taperedTube(pts.slice(0, 4), 0.006 * sc, 0.011 * sc, { seg: 6, radial: 5 }), { bone: 'chest', color: root, mat, small: true });
    put(ctx, taperedTube(pts.slice(3), 0.011 * sc, 0.002 * sc, { seg: 10, radial: 5 }), { bone: 'chest', color: tip, mat, small: true });
  }
}

function mix3(a: number, b: number, t: number): number {
  const c = new THREE.Color().setHex(a, THREE.SRGBColorSpace).lerp(new THREE.Color().setHex(b, THREE.SRGBColorSpace), t);
  return c.getHex(THREE.SRGBColorSpace);
}

function aragornExtras(ctx: KindContext) {
  const { P, sculpt: s, rig, spec } = ctx;
  const sc = P.s;
  const j = P.j;
  const cy = j.chest[1];
  const ny = j.neck[1];
  const hipY = j.thigh_l[1];
  const g = Math.sqrt(P.build.bulk);
  const L = P.hand.l.L;
  const parts = anatomyParts(P);
  const beltY = hipY + (0.07 + BELT_UP) * sc;

  // hair: the kit's wavy shoulder-length style (centre part, curls; at length 0.95 no lock falls over the eyes),
  // then extra chestnut locks of our own that carry it down behind the shoulders (the sheet's hair ends at ~1.28 m)
  withHair(ctx, () => {
    if (!devSkip('hair')) addHair(ctx, { hair: { style: 'shoulder', color: PAL.hair, tipColor: PAL.hairTip, length: devNum('hairlen', 0.95), density: devNum('density', 0.7), braids: 'none' }, rng: new Rng(hashSeed('aragorn', 'hair')), backClear: 1.12 });
  });
  matteHair(PAL.hair);
  if (!devSkip('hair')) hairLocks(ctx);

  // short trimmed beard and stubble (sculpted hair volume + skin shadow); the mouth stays clear
  paintStubble(ctx, { color: 0x2a1d15, paint: 0.6, cheeks: 0.9 });
  sculptBeard(ctx, { color: 0x2c1f16, color2: 0x3d2b1e, thick: devNum('beard', 0.022), cheeks: 0.35, chin: 0.01 });

  // ── the shirt: dark linen, long sleeves, open at the throat ──
  sculptTorso(ctx, { color: PAL.shirt, mat: LINEN, inflate: 0.0066 * sc, hem: 0.1, sleeve: 2, neck: true, seams: true });

  // ── the coat: knee-length, open down the front (vest and shirt show), long sleeves ──
  sculptTorso(ctx, { color: PAL.coat, color2: PAL.coatTrim, mat: COAT, inflate: 0.0185 * sc, hem: 0.2, sleeve: 2, neck: false, seams: true, frontOpen: { top: 0.07 * sc, bottom: 0.03 * sc, y1: ny } });
  if (!devSkip('skirt')) {
    const skirtTop = beltY - 0.03 * sc;
    const skirt = { top: skirtTop, bottom: COAT_HEM * sc, color: PAL.coat, color2: PAL.coatFray, mat: COAT, flare: 0.07 * sc, ragged: 0.008 * sc, tatter: 0.011 * sc, seed: spec.seed ?? 0 };
    // two long panels from the belt to the hem, the front open a little, plus a short patch closing the back vent down to 0.75 m
    attachSkinned(ctx, skirtGeometry(P, rig, { ...skirt, panels: [[-3.05, -0.3], [0.3, 3.05]] }), 'body', { small: false, name: 'skirt' });
    attachSkinned(ctx, skirtGeometry(P, rig, { ...skirt, bottom: 0.75 * sc, tatter: 0, panels: [[3.0, 3.28]] }), 'body', { small: false, name: 'skirt-back' });
  }
  // flat folded-back lapels (rolled, frayed edges) and a low collar at the nape
  {
    const zAt = (y: number) => torsoSection(P, y).zf + 0.021 * sc;
    const lap: V3[] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const y = ny + 0.015 * sc - f * (ny - cy + 0.3 * sc);
      lap.push([0.052 * sc + f * 0.095 * sc, y, zAt(y) - 0.004 * sc]);
    }
    s.mirrored(() => s.tube(lap, lap.map(() => 0.0125 * sc), { color: PAL.coatFray, color2: PAL.coat, colorNoise: 0.5, colorFreq: 60 / sc, mat: COAT, bone: 'chest', k: 0.006 * sc }));
    s.group('union', 0.01 * sc, () => {
      s.ellipsoid([0, ny + 0.012 * sc, -0.05 * sc], [0.1 * sc * g, 0.05 * sc, 0.06 * sc], { color: PAL.coat, mat: COAT, bone: 'chest', k: 0.02 * sc });
      s.ellipsoid([0, ny + 0.03 * sc, 0.0], [0.068 * sc * P.build.neckThick, 0.14 * sc, 0.088 * sc], { op: 'subtract', k: 0.014 * sc });
    });
  }
  // stitched back panel seams down the coat (sheet back view: a centre seam and two side seams)
  for (const x of [0, 0.078 * sc, -0.078 * sc]) {
    const seam: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const y = ny - 0.02 * sc - ((ny - beltY - 0.01 * sc) * i) / 6;
      const sec = torsoSection(P, y);
      const z0 = (sec.zf + sec.zb) / 2;
      const rz = (sec.zf - sec.zb) / 2;
      seam.push([x, y, z0 - rz * Math.sqrt(Math.max(0.05, 1 - (x / sec.rx) ** 2)) - 0.0185 * sc]);
    }
    s.tube(seam, seam.map(() => 0.0032 * sc), { color: PAL.coatFray, mat: COAT, bone: 'chest', k: 0.004 * sc });
  }
  // the sleeves bunch up the forearm over the bracers: scrunched rolls
  s.mirrored(() => {
    for (const [t0, t1] of [[0.13, 0.2], [0.26, 0.33], [0.39, 0.46]] as [number, number][])
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: PAL.coat, color2: PAL.coatTrim, colorNoise: 0.5, mat: COAT, inflate: 0.0225 * sc, k: 0.02 * sc, oneSide: true });
        const a0: V3 = [j.forearm_l[0] + L.x * P.foreArm * t0, j.forearm_l[1] + L.y * P.foreArm * t0, j.forearm_l[2]];
        const a1: V3 = [j.forearm_l[0] + L.x * P.foreArm * t1, j.forearm_l[1] + L.y * P.foreArm * t1, j.forearm_l[2]];
        s.plane([-L.x, -L.y, -L.z], -(L.x * a0[0] + L.y * a0[1] + L.z * a0[2]), { op: 'intersect', k: 0.003 * sc });
        s.plane([L.x, L.y, L.z], L.x * a1[0] + L.y * a1[1] + L.z * a1[2], { op: 'intersect', k: 0.003 * sc });
      });
  });
  // tooled brown leather bracers over the sleeves
  limbGuards(ctx, { kind: 'vambrace', color: PAL.bracers, trim: PAL.bracersTrim, mat: TOOLED, trimMat: LEATHER, length: 0.52, grow: 0.0125 * sc });

  // ── the vest: five light-brown lace bars through eyelets down the front (above the jerkin's 0.014 inflate) ──
  {
    const zl = (y: number) => torsoSection(P, y).zf + 0.0178 * sc;
    const eyes: V3[] = [];
    for (let i = 0; i < 5; i++) {
      const y = cy + 0.09 * sc - (i * (cy + 0.09 * sc - beltY - 0.02 * sc)) / 4;
      const w = 0.03 * sc;
      put(ctx, tube([[-w, y + 0.002 * sc, zl(y)], [0, y - 0.0015 * sc, zl(y) + 0.004 * sc], [w, y + 0.002 * sc, zl(y)]], 0.0046 * sc, { seg: 5, radial: 4 }), { bone: 'chest', color: 0xb8935f, mat: LEATHER, small: true });
      eyes.push([-w, y + 0.002 * sc, zl(y)], [w, y + 0.002 * sc, zl(y)]);
    }
    put(ctx, studs(eyes, 0.0048 * sc, 0.6), { bone: 'chest', color: 0x7e7a72, mat: 'metal', small: true });
  }

  // ── belt hardware, pouches and the scabbard ──
  const zf = 0.108 * sc * P.build.bulk * (1 + P.build.belly * 0.4) + 0.034 * sc;
  put(ctx, new THREE.BoxGeometry(0.044 * sc, 0.036 * sc, 0.008 * sc).translate(0, beltY, zf), { bone: 'hips', color: PAL.steel, mat: 'metal', small: true });
  // a second, narrower belt slung below the first
  sculptBand(ctx, { color: PAL.belt, mat: LEATHER, y0: beltY - 0.085 * sc, y1: beltY - 0.045 * sc, inflate: 0.02 * sc, seams: true });
  // pouches: a flapped one at the right front hip and a small one at the right back
  const pouch = (x: number, z: number, size: number) =>
    s.group('union', 0.004 * sc, () => {
      const cyp = beltY - 0.065 * sc;
      s.ellipsoid([x, cyp, z], [0.04 * size * sc, 0.046 * size * sc, 0.028 * size * sc], { color: PAL.pouch, mat: LEATHER, bone: 'hips', k: 0.012 * sc });
      s.box([x, cyp + 0.024 * size * sc, z + 0.004 * sc], [0.043 * size * sc, 0.022 * size * sc, 0.03 * size * sc], 0.006 * sc, { color: PAL.jerkinTrim, mat: LEATHER, bone: 'hips', k: 0.004 * sc });
    });
  {
    const x = -0.125 * sc;
    const sec = torsoSection(P, beltY - 0.065 * sc);
    const z = sec.zf * Math.sqrt(Math.max(0.25, 1 - (x / sec.rx) ** 2)) + 0.036 * sc;
    pouch(x, z, 1.0);
    put(ctx, studs([[x, beltY - 0.043 * sc, z + 0.027 * sc]], 0.0045 * sc), { bone: 'hips', color: PAL.steel, mat: 'metal', small: true });
  }
  pouch(-0.075 * sc, -0.135 * sc, 0.72);
  sheathed(ctx, {
    kind: 'sword',
    hand: 'hand_r',
    pos: [P.hipX + 0.15 * sc, beltY - 0.05 * sc, -0.01 * sc],
    dir: [0.06, -0.94, -0.24],
    len: 0.8,
    r: 0.03 * sc,
    color: PAL.scabbard,
    trim: 0x8a7a58,
    mat: TOOLED,
    seed: 2,
    weaponStart: 0.09,
  });
  // tall boots: warm brown mottled shafts to just under the coat hem, a folded cuff in a lighter tone, two buckled straps,
  // a dark toe cap and a small heel (re-emitted over the kit's boot layer so the shaft colour wins at the shin)
  tallBoots(ctx, { color: PAL.boots, color2: 0x6b4630, cuff: 0x7a5236, strap: PAL.bootsTrim, buckle: PAL.steel, toe: 0x35241a, top: 1.0, mat: LEATHER, metalMat: 'metal' });
}

export const aragornDef: KindDef = {
  label: 'Aragorn',
  height: 1.88,
  build: { shoulders: 1.04, hips: 0.98, bulk: 1.02, chest: 1.0, armLength: 1.01, legLength: 1.0, headSize: 0.98, neck: 1.0, neckThick: 1.12, handSize: 1.05, footSize: 1.03, muscle: 0.15 },
  face: {
    jaw: 1.08,
    jawLength: 1.03,
    chin: 1.0,
    brow: 1.12,
    cheekbones: 1.05,
    nose: { length: 1.08, width: 0.95, bridge: 1.1, hook: 0.05, tip: 0.95 },
    lips: { width: 0.95, fullness: 0.9 },
    ears: 'round',
    earSize: 0.95,
    eyeSize: 0.95,
    eyeSpacing: 1.0,
    eyeTilt: 0.02,
    eyeOpen: 0.88,
    foreheadSlope: 0.12,
    asym: 0.06,
  },
  skin: { color: PAL.skin, color2: PAL.skin2, blotch: 0.3, blemish: 0.15, wrinkles: 0.5, scars: 1, lips: PAL.lips, brows: PAL.brows, scatter: 0xc0603f, surface: 'skin_weathered' },
  eyes: { color: PAL.eyes, sclera: 0xe6e0d4 },
  // the curls are grown in extras (kit hair cards, per-look density and a back clearance for the coat)
  hair: noKitHair(PAL.skin),
  beard: null,
  outfit: [
    { type: 'trousers', color: PAL.trousers },
    { type: 'boots', color: PAL.boots, color2: PAL.bootsTrim, length: 1.0, mat: LEATHER },
    { type: 'jerkin', color: PAL.jerkin, color2: PAL.jerkinTrim, mat: LEATHER, length: -2.3 },
    { type: 'bracers', color: PAL.bracers, color2: PAL.bracersTrim, mat: TOOLED },
    { type: 'belt', color: PAL.belt, offset: BELT_UP, mat: LEATHER },
    // spring bones only: the coat skirt is built in extras
    { type: 'skirt', color: PAL.coat, chance: 0 },
  ],
  armor: [],
  weapons: { right: 'sword', left: 'none' },
  palette: PAL,
  sfx: { voice: 'man', hurt: 'hurt', die: 'orc_die', footstep: 'footstep', weight: 0.55 },
  anim: { grace: 0.35, swagger: 0.15, aggression: 0.45, stance: 1.05, armSwing: 1.0, cadence: 1.0 },
  variation: { height: 0, bulk: 0, skin: 0 },
  // named character: a fine face region within the 45k budget
  detail: { detailScale: 1, res: devNum('res', 0.05), headRes: devNum('headRes', 0.0085), faceRes: devNum('faceRes', 0.0056), refine: 1, hands: false },
  extras: aragornExtras,
};
