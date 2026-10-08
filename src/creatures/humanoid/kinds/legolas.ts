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

const PALETTE = {
  hair: 0xd9c89c,
  hairTip: 0xe8dbb6,
  brows: 0x8f7650,
  skin: 0xe2b99c,
  skin2: 0xd6a88c,
  lips: 0xc58d82,
  eyes: 0x4f7fae,
  tunic: 0x4b5546,
  tunicTrim: 0x3c4638,
  leggings: 0x5b5446,
  jerkin: 0x6e4c32,
  jerkinTrim: 0x5a3c26,
  bracers: 0x5c4129,
  bracersTrim: 0x3e2c1c,
  boots: 0x4a3626,
  bootsTrim: 0x3a2a1c,
  belt: 0x3a2a1c,
  quiver: 0x5a3e28,
  quiverTrim: 0x8a6a44,
  fletch: 0xf4f2ec,
  knifeHandle: 0xeee8da,
  knifeGuard: 0xd8d4c8,
};

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
  // ── quiver on the back, top over the right shoulder ──
  const q: QuiverOpts = {
    center: [-0.035 * sc, j.chest[1] + 0.09 * sc, -0.165 * sc * P.build.chest],
    axis: new THREE.Vector3(-0.34, 1, -0.06).normalize(),
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
      jaw: 0.95,
      jawLength: 1.05,
      chin: 1.12,
      brow: 0.82,
      cheekbones: 1.1,
      nose: { length: 0.98, width: 0.84, bridge: 1.1, hook: 0, tip: 0.86 },
      lips: { width: 0.9, fullness: 0.86 },
      ears: 'pointed',
      earSize: 1.0,
      eyeSize: 1.06,
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
    hair: { style: 'long_straight', color: PALETTE.hair, tipColor: PALETTE.hairTip, braids: 'temple', length: 1.0, density: 1.0, bounce: 0.8 },
    beard: null,
    outfit: [
      { type: 'leggings', color: PALETTE.leggings },
      { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.86 },
      { type: 'tunic', color: PALETTE.tunic, color2: PALETTE.tunicTrim, length: 0.5 },
      { type: 'jerkin', color: PALETTE.jerkin, color2: PALETTE.jerkinTrim },
      { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.bracersTrim },
      { type: 'belt', color: PALETTE.belt },
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
