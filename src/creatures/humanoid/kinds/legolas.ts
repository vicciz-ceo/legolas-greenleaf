/**
 * Legolas Greenleaf — hero kind (Fellowship-era look).
 * Tall slender elf (1.85 m), long straight platinum hair with temple braids, pointed ears,
 * sharp elegant face; dark green-grey tunic, brown suede jerkin, leather bracers and boots,
 * quiver of white-fletched arrows on his back with two white-handled knives, Galadhrim longbow.
 */
import * as THREE from 'three';
import type { HumanoidKind } from '../../../core/types';
import type { KindDef, KindContext } from '../types';
import { emitParts, anatomyParts } from '../anatomy';
import { quiverGear, quiverSheathMatrix, type QuiverOpts } from '../gear';
import { createWeapon } from '../../weapons';

// sRGB design colours from docs/refs/legolas/spec.json (outfit_layers, armor, hair, face)
const PALETTE = {
  hair: 0xc9ae80, // between the sheet's root #9f8866 and tip: the crown reads warm platinum
  hairTip: 0xe1d4af,
  brows: 0xa08a64,
  skin: 0xe6c5ac, // #e9c9b1
  skin2: 0xd9b398,
  lips: 0xc58d82,
  eyes: 0x5d8bb5,
  tunic: 0x5f6b55, // wool twill, muted green-grey
  tunicTrim: 0x4c5744,
  leggings: 0x484a3d, // olive charcoal
  jerkin: 0x69513b, // stitched brown leather
  jerkinTrim: 0x7e6044, // lighter tooling / wear mottle
  bracers: 0x49392c, // dark brown leather (bracers, belt, boots)
  bracersTrim: 0x35291f,
  boots: 0x49392c,
  bootsTrim: 0x35291f,
  belt: 0x3f3126,
  buckle: 0x997b4a, // bronze
  quiver: 0x5a4330,
  quiverTrim: 0x8a6a44,
  fletch: 0xf4f2ec,
  knifeHandle: 0xeee8da,
  knifeGuard: 0xd8d4c8,
};
/** belt raised to the waist (sheet: belt at ~1.14 m, jerkin hem ~0.94 m, tunic hem ~0.73 m) */
const BELT_RAISE = 0.055;

function legolasExtras(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const j = P.j;
  // ── baldric: leather strap from the right shoulder across the chest to the left hip ──
  const parts = anatomyParts(P);
  const n = new THREE.Vector3(1.0, 1.25, 0).normalize();
  const mid = new THREE.Vector3(0.02 * sc, j.chest[1] + 0.05 * sc, 0);
  const c = n.dot(mid);
  const hw = 0.022 * sc;
  s.group('union', 0.002 * sc, () => {
    emitParts(s, parts, ['ribs', 'chest', 'pecs', 'back', 'trap', 'waist'], { color: PALETTE.quiver, mat: 'leather_worn', inflate: 0.021 * sc, k: 0.05 * sc });
    s.plane([n.x, n.y, n.z], c + hw, { op: 'intersect', k: 0.003 * sc });
    s.plane([-n.x, -n.y, -n.z], -(c - hw), { op: 'intersect', k: 0.003 * sc });
  });
  // ── the jerkin's skirt: tooled leather from the belt flaring over the hips to mid-hip, split
  // at the back and open at the front over the tunic (sheet back view) ──
  const hipY = j.thigh_l[1];
  const beltY = hipY + (0.07 + BELT_RAISE) * sc;
  const hemY = hipY - 0.045 * sc;
  const g = Math.sqrt(P.build.bulk);
  s.group('union', 0.003 * sc, () => {
    const leather = { color: PALETTE.jerkin, color2: PALETTE.jerkinTrim, colorNoise: 0.4, colorFreq: 34 / sc, mat: 'suede' as const };
    emitParts(s, parts, ['pelvis', 'glutes', 'waist'], { ...leather, inflate: 0.019 * sc, k: 0.05 * sc });
    // hangs straight from the hips (a flat-backed panel, clear of the thighs when they swing)
    const top = hipY + 0.04 * sc;
    s.box([0, (top + hemY) / 2, -0.01 * sc], [P.hipX + 0.088 * sc * g, (top - hemY) / 2 + 0.02 * sc, 0.122 * sc * g], 0.07 * sc, { ...leather, bone: 'hips', k: 0.05 * sc });
    s.plane([0, 1, 0], beltY, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -hemY, { op: 'intersect', k: 0.004 * sc });
    s.plane([0, -1, 0], -hemY, { op: 'paint', seam: 0, k: 0.002 });
    // back split and front opening
    s.box([0, hemY + 0.035 * sc, -0.2 * sc], [0.005 * sc, 0.045 * sc, 0.12 * sc], 0.003 * sc, { op: 'subtract', k: 0.004 * sc });
    s.box([0, hemY + 0.05 * sc, 0.2 * sc], [0.016 * sc, 0.06 * sc, 0.12 * sc], 0.004 * sc, { op: 'subtract', k: 0.005 * sc });
  });
  // ── quiver on the right back (sheet: bottom at the belt just right of the spine, mouth over
  // the right shoulder blade, fletchings above the right shoulder), knives on its spine side ──
  const q: QuiverOpts = {
    center: [-0.135 * sc, j.chest[1] + 0.035 * sc, -0.152 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.3, 1, -0.07).normalize(),
    length: 0.56 * sc,
    radius: 0.046 * sc,
    color: PALETTE.quiver,
    trim: PALETTE.quiverTrim,
    arrows: 16,
    fletch: PALETTE.fletch,
    shaft: 0xc9b38a,
    bone: 'quiver',
    knives: null,
    sheathsOnly: true,
    sheathSide: -1,
    seed: 7,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);
  // ── the twin white-handled knives sit in their sheaths (hidden while held) ──
  for (const side of [1, -1]) {
    ctx.object(
      () => {
        const knife = createWeapon('elven_knives', side > 0 ? 3 : 4);
        const m = quiverSheathMatrix(q, side);
        // grip slightly above the sheath mouth, blade pointing down into the sheath
        const local = new THREE.Matrix4().makeTranslation(0, 0.16 * sc, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI));
        m.multiply(local);
        m.decompose(knife.position, knife.quaternion, knife.scale);
        knife.userData.stowFor = { hand: side > 0 ? 'hand_l' : 'hand_r', weapon: 'elven_knives' };
        return knife;
      },
      { bone: 'quiver', small: true },
    );
  }
}

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  legolas: {
    label: 'Legolas',
    height: 1.85,
    build: {
      shoulders: 0.97,
      hips: 0.94,
      bulk: 0.88,
      chest: 0.94,
      armLength: 1.0,
      legLength: 1.03,
      headSize: 0.96,
      neck: 1.06,
      neckThick: 0.9,
      muscle: 0.45,
      handSize: 0.97,
      footSize: 0.97,
    },
    face: {
      jaw: 0.9,
      jawLength: 1.0,
      chin: 1.12,
      brow: 0.82,
      cheekbones: 1.1,
      nose: { length: 0.94, width: 0.86, bridge: 1.1, hook: 0, tip: 0.8 },
      lips: { width: 0.98, fullness: 0.95 },
      ears: 'pointed',
      earSize: 1.0,
      eyeSize: 1.1,
      eyeSpacing: 1.0,
      eyeTilt: 0.1,
      eyeOpen: 1.08,
      foreheadSlope: 0.08,
      cranium: 1.0,
    },
    skin: {
      color: PALETTE.skin,
      color2: PALETTE.skin2,
      blotch: 0.08,
      blemish: 0.02,
      wrinkles: 0,
      lips: PALETTE.lips,
      brows: PALETTE.brows,
      scatter: 0xc87866,
      surface: 'skin',
    },
    eyes: { color: PALETTE.eyes, sclera: 0xeee9e0 },
    hair: { style: 'long_straight', color: PALETTE.hair, tipColor: PALETTE.hairTip, braids: 'temple', length: 0.88, density: 1.0, bounce: 0.8 },
    beard: null,
    outfit: [
      { type: 'leggings', color: PALETTE.leggings },
      { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.86 },
      { type: 'tunic', color: PALETTE.tunic, color2: PALETTE.tunicTrim, length: 0.5 },
      { type: 'jerkin', color: PALETTE.jerkin, color2: PALETTE.jerkinTrim },
      // bracers from the wrist almost to the elbow
      { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.bracersTrim, length: 0.9 },
      { type: 'belt', color: PALETTE.belt, offset: BELT_RAISE },
    ],
    armor: [],
    weapons: { right: 'none', left: 'elven_bow' },
    palette: PALETTE,
    sfx: { voice: 'elf', hurt: 'hurt', die: 'player_death', footstep: 'footstep', weight: 0.35 },
    anim: { grace: 1, swagger: 0.05, aggression: 0.2, hunch: 0, stance: 0.95, armSwing: 0.85, cadence: 1.0 },
    variation: { height: 0, bulk: 0, skin: 0 },
    detail: { detailScale: 1, faceRes: 0.0048 },
    extras: legolasExtras,
  },
};
