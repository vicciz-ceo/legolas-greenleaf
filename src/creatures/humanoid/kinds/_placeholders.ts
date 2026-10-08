/**
 * Placeholder kinds so the game is playable before the dressers finish. Each is a sensible,
 * readable silhouette at true scale. Dressers replace these by defining the same kind in their
 * own kinds file (applied after this one); see KINDS.md.
 */
import type { HumanoidKind } from '../../../core/types';
import type { KindContext, KindDef } from '../types';

/** white hand of Saruman painted on a face (Uruk-hai) */
function whiteHand(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  const o = { op: 'paint' as const, color: 0xe8e4dc, mat: 'skin_orc' as const, bone: 'head', k: 0.008 * u, strength: 0.92 };
  // palm on the right cheek/forehead, fingers spread up over the face
  s.ellipsoid(P.h(-0.06, -0.12, 0.38), [0.09 * u, 0.1 * u, 0.12 * u], o);
  const fingers: [number, number][] = [[-0.2, 0.1], [-0.11, 0.2], [-0.01, 0.23], [0.09, 0.19], [0.13, -0.05]];
  for (const [x, y] of fingers) s.cone(P.h(-0.06 + x * 0.3, -0.06 + y * 0.2, 0.4), P.h(-0.06 + x, -0.06 + y, 0.36), 0.025 * u, 0.02 * u, o);
}

/** Bolg's metal brace and bolted plates */
function bolgPlates(ctx: KindContext) {
  const { P, sculpt: s } = ctx;
  const u = P.headH;
  s.with({ color: 0x5a554e, mat: 'metal_dark', bone: 'head', k: 0.004 * u }, () => {
    s.box(P.h(0.0, 0.3, 0.05), [0.28 * u, 0.04 * u, 0.3 * u], 0.02 * u, { rot: [0.25, 0, 0] });
    s.mirrored(() => s.cone(P.h(0.3, -0.05, 0.05), P.h(0.18, -0.55, 0.22), 0.03 * u, 0.025 * u, { bone: 'jaw' }));
  });
}

/**
 * Troll torso: one massive barrel chest flowing into a hanging belly (the standard ribs + waist +
 * belly ellipsoids read as stacked balls at this bulk). Skinned spine → chest.
 */
function trollTorso(ctx: KindContext) {
  const { P, sculpt: s, def } = ctx;
  const sc = P.s;
  const b = P.build;
  const j = P.j;
  const skin = { color: def.skin.color, color2: def.skin.color2, colorNoise: def.skin.blotch, colorFreq: 14 / sc, mat: def.skin.surface };
  const hipY = j.thigh_l[1];
  const shY = j.upperarm_l[1];
  // barrel: from the pelvis to the shoulders, widest at the lower ribs
  s.ellipsoid([0, hipY + (shY - hipY) * 0.46, 0.02 * sc], [0.18 * sc * b.shoulders * Math.sqrt(b.bulk), (shY - hipY) * 0.47, 0.145 * sc * b.chest * Math.sqrt(b.bulk)], { ...skin, bone: 'spine', bone2: 'chest', blend: [0.35, 0.85], k: 0.1 * sc });
  // hanging belly: low and forward, blended broadly into the barrel
  s.ellipsoid([0, hipY + 0.17 * sc, 0.075 * sc * b.bulk], [0.17 * sc * Math.sqrt(b.bulk), 0.17 * sc, 0.13 * sc * b.bulk * (0.8 + 0.4 * b.belly)], { ...skin, bone: 'spine', bone2: 'hips', blend: [0.3, 0.9], blendAxis: [[0, hipY + 0.32 * sc, 0], [0, hipY, 0]], k: 0.16 * sc });
}

const ORC_FACE = {
  jaw: 1.2, jawLength: 1.05, chin: 0.8, brow: 1.6, cheekbones: 1.2,
  nose: { length: 0.8, width: 1.35, bridge: 0.6, hook: 0, tip: 1.1, flat: 0.7 },
  lips: { width: 1.1, fullness: 0.8 }, ears: 'orc' as const, earSize: 1.1, eyeSize: 0.9, eyeSpacing: 1.0, eyeTilt: -0.05,
  eyeOpen: 0.75, tusks: 0.35, underbite: 0.45, foreheadSlope: 0.6, asym: 0.7, cranium: 0.92,
};

export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  // ── elves ────────────────────────────────────────────────────────────────
  tauriel: {
    label: 'Tauriel',
    height: 1.75,
    build: { shoulders: 0.86, hips: 1.08, bulk: 0.8, chest: 0.92, neck: 1.05, neckThick: 0.82, headSize: 0.95, handSize: 0.9, footSize: 0.9, muscle: 0.3 },
    face: { jaw: 0.82, chin: 0.95, brow: 0.65, cheekbones: 1.15, nose: { length: 0.92, width: 0.8, bridge: 0.95, tip: 0.85 }, lips: { width: 0.95, fullness: 1.2 }, ears: 'pointed', eyeSize: 1.05, eyeTilt: 0.1 },
    skin: { color: 0xeacbb4, color2: 0xe0b49c, blotch: 0.1, lips: 0xb8706a, brows: 0x7a2a18 },
    eyes: { color: 0x4a6a3a },
    hair: { style: 'long_straight', color: 0x8a2c16, tipColor: 0x9a3a1e, braids: 'temple' },
    outfit: [
      { type: 'leggings', color: 0x3a3a2c },
      { type: 'boots', color: 0x4a3626, length: 0.9 },
      { type: 'tunic', color: 0x3e5a36, color2: 0x324a2c, length: 0.55 },
      { type: 'jerkin', color: 0x4a3a26 },
      { type: 'bracers', color: 0x4a3828 },
      { type: 'belt', color: 0x2e2218 },
    ],
    weapons: { left: 'elven_bow', back: ['elven_knives'] },
    anim: { grace: 1, aggression: 0.3 },
    sfx: { voice: 'elf', weight: 0.3 },
  },
  elf: {
    label: 'Elf warrior',
    height: 1.86,
    build: { shoulders: 0.98, bulk: 0.9, neck: 1.05, headSize: 0.96 },
    face: { jaw: 0.92, chin: 1.05, brow: 0.85, cheekbones: 1.12, nose: { length: 1.02, width: 0.86, bridge: 1.08 }, ears: 'pointed', eyeTilt: 0.08 },
    skin: { color: 0xe6c8b0, blotch: 0.1 },
    eyes: { color: 0x5a6a7a },
    hair: { style: 'long_straight', color: 0x3a2a1e, braids: 'temple' },
    outfit: [
      { type: 'leggings', color: 0x4a4a3e },
      { type: 'boots', color: 0x3e3022 },
      { type: 'tunic', color: 0x5a5a46, length: 0.55 },
      { type: 'cloak', color: 0x5a5e48, length: 0.7 },
      { type: 'belt', color: 0x3a2a1c },
    ],
    armor: [
      { type: 'helmet', style: 'elven', minArmor: 0.5 },
      { type: 'breastplate', style: 'elven', minArmor: 0.25 },
      { type: 'pauldrons', style: 'elven', minArmor: 0.5 },
      { type: 'vambraces', style: 'elven', minArmor: 0.25 },
    ],
    weapons: { left: 'elven_bow', back: ['elven_sword'] },
    anim: { grace: 0.9, aggression: 0.3 },
    sfx: { voice: 'elf', weight: 0.4 },
  },
  thranduil: {
    label: 'Thranduil',
    height: 1.92,
    build: { shoulders: 1.0, bulk: 0.92, neck: 1.08, headSize: 0.96 },
    face: { jaw: 0.95, chin: 1.1, brow: 1.0, cheekbones: 1.2, nose: { length: 1.05, width: 0.85, bridge: 1.15 }, lips: { width: 0.92, fullness: 0.9 }, ears: 'pointed', eyeTilt: 0.12, eyeOpen: 0.85 },
    skin: { color: 0xead0bc, blotch: 0.08, brows: 0x6a5a40 },
    eyes: { color: 0x7a9ab8 },
    hair: { style: 'long_straight', color: 0xeee6d2, tipColor: 0xf6f0e0, length: 1.1 },
    outfit: [
      { type: 'leggings', color: 0x3a3a40 },
      { type: 'boots', color: 0x2e2a26 },
      { type: 'robe', color: 0x8e8e98, color2: 0xb8b0a0 },
      { type: 'cloak', color: 0x4a1e2a, color2: 0x8a6a40, length: 0.95 },
      { type: 'belt', color: 0x8a6a40 },
    ],
    armor: [{ type: 'crown', style: 'king' }],
    weapons: { right: 'elven_sword' },
    anim: { grace: 1, aggression: 0.2, swagger: 0.1 },
    sfx: { voice: 'elf', weight: 0.45 },
  },
  // ── men ──────────────────────────────────────────────────────────────────
  aragorn: {
    label: 'Aragorn',
    height: 1.88,
    build: { shoulders: 1.04, bulk: 1.0, muscle: 0.5 },
    face: { jaw: 1.05, chin: 1.0, brow: 1.1, cheekbones: 1.05, nose: { length: 1.08, width: 0.95, bridge: 1.1 }, eyeOpen: 0.9 },
    skin: { color: 0xd2a888, color2: 0xb8866a, blotch: 0.3, wrinkles: 0.3, surface: 'skin_weathered' },
    eyes: { color: 0x5a6a5a },
    hair: { style: 'shoulder', color: 0x2e2218 },
    beard: { style: 'stubble', color: 0x2a2018, length: 0.02 },
    outfit: [
      { type: 'trousers', color: 0x3a3028 },
      { type: 'boots', color: 0x2e2218, length: 0.92 },
      { type: 'tunic', color: 0x3a3a34, length: 0.55 },
      { type: 'vest', color: 0x4a3626 },
      { type: 'bracers', color: 0x3a2a1c },
      { type: 'belt', color: 0x2a1e14 },
      { type: 'cloak', color: 0x3e4232, length: 0.8 },
    ],
    weapons: { right: 'sword' },
    anim: { aggression: 0.4, swagger: 0.15 },
    sfx: { voice: 'man', weight: 0.55 },
  },
  man: {
    label: 'Man',
    height: 1.78,
    build: { bulk: 1.0 },
    skin: { color: 0xd4a88a, blotch: 0.25, wrinkles: 0.2, surface: 'skin_weathered' },
    hair: { style: 'short', color: 0x4a3420 },
    beard: { style: 'stubble', color: 0x3a2818, length: 0.02 },
    outfit: [
      { type: 'trousers', color: 0x4a3e30 },
      { type: 'boots', color: 0x3a2a1c },
      { type: 'tunic', color: 0x6a5238, length: 0.45 },
      { type: 'belt', color: 0x2a1e14 },
    ],
    weapons: { right: 'sword' },
    sfx: { voice: 'man', weight: 0.5 },
  },
  rohirrim: {
    label: 'Rohirrim',
    height: 1.82,
    build: { shoulders: 1.05, bulk: 1.05 },
    skin: { color: 0xdcae90, blotch: 0.25, wrinkles: 0.2, surface: 'skin_weathered' },
    eyes: { color: 0x5a7a8a },
    hair: { style: 'long_wavy', color: 0xb89a5a },
    beard: { style: 'full', color: 0xa08048, length: 0.06 },
    outfit: [
      { type: 'trousers', color: 0x4a3e2c },
      { type: 'boots', color: 0x3a2a1c },
      { type: 'mail_shirt', color: 0x7a7870, length: 0.5 },
      { type: 'cloak', color: 0x3e5a32, length: 0.7 },
      { type: 'belt', color: 0x3a2a1c },
    ],
    armor: [
      { type: 'helmet', style: 'rohan', minArmor: 0.25 },
      { type: 'pauldrons', style: 'rohan', minArmor: 0.5 },
      { type: 'vambraces', style: 'rohan', minArmor: 0.5 },
    ],
    weapons: { right: 'sword', left: 'shield' },
    sfx: { voice: 'man', weight: 0.55 },
  },
  gondor: {
    label: 'Soldier of Gondor',
    height: 1.83,
    build: { shoulders: 1.03, bulk: 1.02 },
    skin: { color: 0xd8ac8e, blotch: 0.2, surface: 'skin_weathered' },
    hair: { style: 'short', color: 0x2a1e16 },
    outfit: [
      { type: 'trousers', color: 0x22201e },
      { type: 'boots', color: 0x1e1a16 },
      { type: 'gambeson', color: 0x262422, length: 0.55 },
      { type: 'belt', color: 0x1e1a16 },
    ],
    armor: [
      { type: 'helmet', style: 'gondor' },
      { type: 'breastplate', style: 'gondor', minArmor: 0.25 },
      { type: 'pauldrons', style: 'gondor', minArmor: 0.5 },
      { type: 'vambraces', style: 'gondor', minArmor: 0.5 },
      { type: 'greaves', style: 'gondor', minArmor: 0.75 },
    ],
    weapons: { right: 'spear', left: 'shield', style: 'gondor' },
    sfx: { voice: 'man', weight: 0.55 },
  },
  // ── dwarves ──────────────────────────────────────────────────────────────
  gimli: {
    label: 'Gimli',
    height: 1.37,
    build: { shoulders: 1.32, hips: 1.25, bulk: 1.38, belly: 0.45, chest: 1.3, armLength: 0.92, legLength: 0.8, headSize: 1.32, neck: 0.45, neckThick: 1.35, handSize: 1.3, footSize: 1.15, muscle: 0.5 },
    face: { jaw: 1.2, chin: 0.9, brow: 1.45, cheekbones: 1.1, nose: { length: 1.25, width: 1.45, bridge: 1.1, hook: 0.2, tip: 1.35 }, lips: { width: 1.0, fullness: 1.0 }, ears: 'round', earSize: 1.05, eyeOpen: 0.85 },
    skin: { color: 0xd8a080, color2: 0xc07a60, blotch: 0.4, wrinkles: 0.45, surface: 'skin_weathered' },
    eyes: { color: 0x4a3a28 },
    hair: { style: 'long_wavy', color: 0x8a4a26, length: 0.75 },
    beard: { style: 'braided', color: 0x8a4a26, length: 0.3 },
    outfit: [
      { type: 'trousers', color: 0x4a3626 },
      { type: 'boots', color: 0x3a2a1c, length: 0.95 },
      { type: 'mail_shirt', color: 0x6a6660, length: 0.6 },
      { type: 'jerkin', color: 0x5a3a24 },
      { type: 'belt', color: 0x3a2618 },
      { type: 'bracers', color: 0x4a3626 },
    ],
    armor: [
      { type: 'helmet', style: 'dwarf' },
      { type: 'pauldrons', style: 'dwarf', minArmor: 0.5 },
      { type: 'gauntlets', style: 'dwarf', minArmor: 0.5 },
    ],
    weapons: { right: 'dwarf_axe' },
    anim: { swagger: 0.5, aggression: 0.55, stance: 1.2, cadence: 1.05 },
    variation: { height: 0, bulk: 0, skin: 0 },
    sfx: { voice: 'dwarf', weight: 0.7 },
  },
  dwarf: {
    label: 'Dwarf',
    extends: 'gimli',
    height: 1.4,
    skin: { color: 0xd0a080, blotch: 0.35, wrinkles: 0.4, surface: 'skin_weathered' },
    hair: { style: 'long_wavy', color: 0x3a2a1c, length: 0.6 },
    beard: { style: 'forked', color: 0x3a2a1c, length: 0.24 },
    weapons: { right: 'axe', left: 'shield', style: 'dwarf' },
    variation: { height: 0.03, bulk: 0.08, skin: 0.08 },
  },
  // ── orcs & goblins ───────────────────────────────────────────────────────
  orc: {
    label: 'Orc',
    height: 1.68,
    build: { shoulders: 1.05, bulk: 1.0, hunch: 0.25, armLength: 1.08, legLength: 0.95, headSize: 1.05, neck: 0.85, neckThick: 1.15, muscle: 0.6 },
    face: ORC_FACE,
    skin: { color: 0x6e6a52, color2: 0x4e4a3a, blotch: 0.55, blemish: 0.5, scars: 3, warts: 0.35, wrinkles: 0.6, lips: 0x4a3a34, brows: 0x1e1a16, surface: 'skin_orc', scatter: 0x8a6a40 },
    eyes: { color: 0xc89a30, glow: 0.4, sclera: 0xb0a080 },
    hair: { style: 'stringy', color: 0x16120e },
    outfit: [
      { type: 'trousers', color: 0x2e2a24, mat: 'rags' },
      { type: 'wraps', color: 0x4a4234 },
      { type: 'shoes', color: 0x2a221a },
      { type: 'rags', color: 0x3a3428, length: 0.45 },
      { type: 'belt', color: 0x241e18 },
    ],
    armor: [
      { type: 'helmet', style: 'orc', minArmor: 0.5, chance: 0.6 },
      { type: 'plates', style: 'orc', minArmor: 0.25 },
      { type: 'pauldrons', style: 'orc', minArmor: 0.5, chance: 0.6 },
    ],
    weapons: { right: 'scimitar' },
    anim: { hunch: 0.35, swagger: 0.6, aggression: 0.75, stance: 1.15, cadence: 1.1 },
    variation: { height: 0.05, bulk: 0.1, skin: 0.12 },
    detail: { faceRes: 0 },
    sfx: { voice: 'orc', grunt: 'orc_grunt', die: 'orc_die', roar: 'orc_roar', weight: 0.5 },
  },
  goblin: {
    label: 'Moria goblin',
    height: 1.5,
    build: { shoulders: 0.9, hips: 0.85, bulk: 0.72, hunch: 0.6, armLength: 1.2, legLength: 0.9, headSize: 1.15, neck: 0.9, neckThick: 0.8, handSize: 1.15, muscle: 0.7 },
    face: { ...ORC_FACE, ears: 'bat', earSize: 1.3, eyeSize: 1.25, eyeOpen: 1.1, tusks: 0.15, nose: { length: 0.9, width: 1.1, bridge: 0.5, hook: 0.3, tip: 0.9, flat: 0.4 } },
    skin: { color: 0xb8b2a0, color2: 0x8a8678, blotch: 0.5, blemish: 0.6, scars: 2, warts: 0.6, wrinkles: 0.7, lips: 0x6a5a54, surface: 'skin_orc', scatter: 0x9a8a70 },
    eyes: { color: 0xd8c070, glow: 0.8, sclera: 0xc8c0a0 },
    hair: { style: 'stringy', color: 0x2a2620, density: 0.6 },
    outfit: [
      { type: 'loincloth', color: 0x3a3428 },
      { type: 'wraps', color: 0x4a4436 },
      { type: 'belt', color: 0x2a2218 },
    ],
    armor: [{ type: 'helmet', style: 'goblin', minArmor: 0.75, chance: 0.4 }],
    weapons: { right: 'cleaver' },
    anim: { hunch: 0.65, swagger: 0.3, aggression: 0.9, stance: 1.25, cadence: 1.2, armSwing: 1.3 },
    variation: { height: 0.06, bulk: 0.1, skin: 0.1 },
    detail: { faceRes: 0 },
    sfx: { voice: 'goblin', grunt: 'goblin_screech', die: 'orc_die', roar: 'goblin_screech', weight: 0.35 },
  },
  gundabad: {
    label: 'Gundabad orc',
    extends: 'orc',
    height: 1.95,
    build: { shoulders: 1.2, bulk: 1.25, hunch: 0.2, headSize: 1.0, neckThick: 1.3, muscle: 0.8 },
    skin: { color: 0x9a968a, color2: 0x6a665c, blotch: 0.5, blemish: 0.5, scars: 4, warts: 0.2, wrinkles: 0.6, surface: 'skin_orc', scatter: 0x8a7a6a },
    hair: { style: 'bald', color: 0x1a1612 },
    outfit: [
      { type: 'trousers', color: 0x2a2622, mat: 'leather_worn' },
      { type: 'boots', color: 0x221e1a },
      { type: 'fur_mantle', color: 0x4a3e30 },
      { type: 'belt', color: 0x221e1a },
    ],
    armor: [
      { type: 'helmet', style: 'gundabad', minArmor: 0.25 },
      { type: 'pauldrons', style: 'gundabad' },
      { type: 'plates', style: 'gundabad' },
      { type: 'shoulder_spikes', style: 'gundabad', minArmor: 0.5 },
    ],
    weapons: { right: 'warhammer' },
    anim: { hunch: 0.2, swagger: 0.5, aggression: 0.85, stance: 1.2 },
  },
  uruk: {
    label: 'Uruk-hai',
    height: 2.0,
    build: { shoulders: 1.22, hips: 1.05, bulk: 1.22, chest: 1.12, armLength: 1.05, headSize: 0.98, neck: 0.85, neckThick: 1.35, muscle: 0.9 },
    face: { ...ORC_FACE, brow: 1.45, asym: 0.25, tusks: 0.1, ears: 'orc', foreheadSlope: 0.4, eyeOpen: 0.8 },
    skin: { color: 0x4e4236, color2: 0x3a3028, blotch: 0.45, blemish: 0.4, scars: 2, warts: 0.15, wrinkles: 0.45, lips: 0x2e2420, surface: 'skin_orc', scatter: 0x6a4a30 },
    eyes: { color: 0xb08a30, glow: 0.3 },
    hair: { style: 'wild', color: 0x0e0c0a },
    outfit: [
      { type: 'trousers', color: 0x22201c, mat: 'leather_worn' },
      { type: 'boots', color: 0x1a1816 },
      { type: 'vest', color: 0x2a2420, mat: 'leather_worn' },
      { type: 'belt', color: 0x1a1816 },
    ],
    armor: [
      { type: 'helmet', style: 'uruk', minArmor: 0.5 },
      { type: 'breastplate', style: 'uruk', minArmor: 0.25 },
      { type: 'pauldrons', style: 'uruk', minArmor: 0.5 },
      { type: 'vambraces', style: 'uruk', minArmor: 0.25 },
    ],
    weapons: { right: 'sword', left: 'shield', style: 'uruk' },
    anim: { hunch: 0.1, swagger: 0.35, aggression: 0.8, stance: 1.15 },
    variation: { height: 0.03, bulk: 0.08, skin: 0.1 },
    detail: { faceRes: 0 },
    extras: whiteHand,
    sfx: { voice: 'uruk', grunt: 'orc_grunt', die: 'orc_die', roar: 'uruk_roar', weight: 0.7 },
  },
  berserker: {
    label: 'Uruk berserker',
    extends: 'uruk',
    height: 2.05,
    build: { bulk: 1.35, muscle: 1.0, shoulders: 1.28 },
    hair: { style: 'bald', color: 0x0e0c0a },
    outfit: [
      { type: 'loincloth', color: 0x1e1a16 },
      { type: 'wraps', color: 0x2a2420 },
      { type: 'boots', color: 0x1a1816 },
      { type: 'belt', color: 0x1a1816 },
    ],
    armor: [{ type: 'helmet', style: 'uruk', minArmor: 0.25 }],
    weapons: { right: 'torch' },
    anim: { aggression: 1, swagger: 0.5 },
  },
  lurtz: {
    label: 'Lurtz',
    extends: 'uruk',
    height: 2.1,
    build: { bulk: 1.32, shoulders: 1.3, muscle: 1.0 },
    hair: { style: 'bald', color: 0x0e0c0a },
    outfit: [
      { type: 'trousers', color: 0x1e1c18, mat: 'leather_worn' },
      { type: 'boots', color: 0x161412 },
      { type: 'belt', color: 0x161412 },
      { type: 'collar', color: 0x1e1c18 },
    ],
    armor: [{ type: 'vambraces', style: 'uruk' }],
    weapons: { right: 'sword', left: 'uruk_bow', style: 'uruk' },
    anim: { aggression: 1, swagger: 0.45 },
    variation: { height: 0, bulk: 0, skin: 0 },
  },
  bolg: {
    label: 'Bolg',
    height: 2.6,
    build: { shoulders: 1.25, hips: 1.05, bulk: 1.3, chest: 1.15, armLength: 1.05, headSize: 0.92, neck: 0.8, neckThick: 1.4, muscle: 1.0, handSize: 1.1 },
    face: { ...ORC_FACE, brow: 1.7, asym: 0.5, tusks: 0.2, ears: 'small', eyeOpen: 0.7 },
    skin: { color: 0xc8c0b0, color2: 0x9a9284, blotch: 0.5, blemish: 0.5, scars: 5, warts: 0.25, wrinkles: 0.7, lips: 0x6a5a54, surface: 'skin_orc', scatter: 0xa08a78 },
    eyes: { color: 0xa8b0b8, glow: 0.2 },
    hair: { style: 'bald', color: 0x1a1612 },
    outfit: [
      { type: 'trousers', color: 0x2a2622, mat: 'leather_worn' },
      { type: 'boots', color: 0x1e1a16 },
      { type: 'belt', color: 0x1e1a16 },
      { type: 'fur_mantle', color: 0x3a3028 },
    ],
    armor: [
      { type: 'pauldrons', style: 'gundabad' },
      { type: 'plates', style: 'gundabad' },
      { type: 'vambraces', style: 'gundabad' },
    ],
    weapons: { right: 'mace' },
    anim: { hunch: 0.15, swagger: 0.5, aggression: 1, stance: 1.2 },
    variation: { height: 0, bulk: 0, skin: 0 },
    detail: { faceRes: 0 },
    extras: bolgPlates,
    sfx: { voice: 'orc', roar: 'orc_roar', weight: 0.85 },
  },
  // ── men of the east and south ────────────────────────────────────────────
  easterling: {
    label: 'Easterling',
    height: 1.8,
    skin: { color: 0xc89a78, blotch: 0.2 },
    hair: { style: 'tied_back', color: 0x161210 },
    outfit: [
      { type: 'trousers', color: 0x3a1e18 },
      { type: 'boots', color: 0x2a1a14 },
      { type: 'mail_shirt', color: 0x9a7a38, length: 0.6 },
      { type: 'cloak', color: 0x5a1a14, length: 0.6 },
      { type: 'belt', color: 0x2a1a14 },
    ],
    armor: [
      { type: 'helmet', style: 'easterling' },
      { type: 'mask', style: 'easterling', minArmor: 0.5 },
      { type: 'pauldrons', style: 'easterling', minArmor: 0.5 },
    ],
    weapons: { right: 'spear', left: 'shield', style: 'easterling' },
    sfx: { voice: 'man', weight: 0.55 },
  },
  haradrim: {
    label: 'Haradrim',
    height: 1.78,
    build: { bulk: 0.95 },
    skin: { color: 0x7a5238, color2: 0x5a3a28, blotch: 0.3, surface: 'skin_weathered', scatter: 0xa04a30 },
    eyes: { color: 0x2a1e14 },
    hair: { style: 'cropped', color: 0x0e0a08 },
    outfit: [
      { type: 'trousers', color: 0x6a1a14 },
      { type: 'shoes', color: 0x3a2418 },
      { type: 'robe', color: 0x8a2018, color2: 0xb08040 },
      { type: 'hood', color: 0x7a1a12 },
      { type: 'sash', color: 0xb08040 },
    ],
    armor: [{ type: 'breastplate', style: 'haradrim', minArmor: 0.5 }],
    weapons: { right: 'scimitar' },
    sfx: { voice: 'man', weight: 0.5 },
  },
  // ── trolls ───────────────────────────────────────────────────────────────
  troll: {
    label: 'Cave troll',
    height: 4.5,
    build: { shoulders: 1.45, hips: 1.2, bulk: 1.55, belly: 0.75, chest: 1.3, armLength: 1.3, legLength: 0.8, headSize: 0.8, neck: 0.6, neckThick: 1.6, hunch: 0.45, handSize: 1.5, footSize: 1.3, muscle: 0.6 },
    face: { ...ORC_FACE, brow: 2.0, jaw: 1.45, underbite: 0.7, tusks: 0.45, ears: 'small', earSize: 0.8, eyeSize: 0.75, nose: { length: 0.9, width: 1.7, bridge: 0.5, hook: 0, tip: 1.4, flat: 0.9 }, asym: 0.5 },
    skin: { color: 0x6c7660, color2: 0x4e5644, blotch: 0.6, blemish: 0.6, scars: 3, warts: 0.65, wrinkles: 1.0, lips: 0x4a4a3e, surface: 'skin_troll', scatter: 0x6a7a5a },
    eyes: { color: 0xb0a060, glow: 0.2 },
    hair: { style: 'bald', color: 0x1a1a14 },
    outfit: [
      { type: 'loincloth', color: 0x3a3226, length: 0.7 },
      { type: 'belt', color: 0x2a241c },
    ],
    weapons: { right: 'club' },
    anim: { hunch: 0.55, swagger: 0.7, aggression: 0.8, stance: 1.3, cadence: 0.9, armSwing: 1.2 },
    variation: { height: 0.04, bulk: 0.08, skin: 0.1 },
    detail: { faceRes: 0, detailScale: 2.4 },
    sfx: { voice: 'troll', roar: 'troll_roar', grunt: 'troll_hit', footstep: 'troll_step', weight: 1 },
    extras: trollTorso,
  },
};
