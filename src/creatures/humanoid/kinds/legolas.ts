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
import { surface } from '../../kit/surfaces';
import { makeProjector, snapPoint, placeAlong as placeOn, V } from './uruks_bosses/common';

/** stitched brown leather tooled with leaf work (jerkin, bracers, boots, quiver) */
const TOOLED = surface('leather_tooled', { rough: 0.62, sheen: 0.1 });
/** dense wool twill (tunic) */
const TWILL = surface('twill', { rough: 0.85, sheen: 0.45 });
/** fitted dense wool (leggings) */
const WOOL = surface('twill', { rough: 0.9, sheen: 0.25, pat: { weave: -0.6 } });

// sRGB design colours from docs/refs/legolas/spec.json (outfit_layers, armor, hair, face)
const PALETTE = {
  hair: 0xc9ae80, // between the sheet's root #9f8866 and tip: the crown reads warm platinum
  hairTip: 0xe1d4af,
  brows: 0xa08a64,
  // a little warmer and deeper than the sheet's #e9c9b1 (that albedo rendered as pale clay; the
  // turnaround's lit face is a warm #bc8f72)
  skin: 0xd9ab8c,
  skin2: 0xc8977a,
  lips: 0xbf8377,
  eyes: 0x6188a8, // sheet #5d8bb5, a touch greyer (the iris read as painted-on saturated blue)
  // (the sheet's #5f6b55 rendered mint under bright sky light; the turnaround reads as a warm
  // olive grey-green, so the albedo is less saturated and the sheen is albedo-tinted)
  tunic: 0x5a5a48, // wool twill, muted olive grey
  tunicTrim: 0x4a4a3b,
  leggings: 0x45382c, // dark brown fitted wool (turnaround)
  jerkin: 0x69513b, // stitched brown leather
  jerkinTrim: 0x7e6044, // lighter tooling / wear mottle
  bracers: 0x4f3c2c, // dark brown tooled leather (bracers, belt, boots)
  bracersTrim: 0x35291f,
  boots: 0x4c3a2b,
  bootsTrim: 0x33271d,
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
    const leather = { color: PALETTE.jerkin, color2: PALETTE.jerkinTrim, colorNoise: 0.4, colorFreq: 34 / sc, mat: TOOLED };
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
    mat: TOOLED,
    knives: null,
    sheathsOnly: true,
    sheathSide: -1,
    seed: 7,
  };
  quiverGear({ add: (geo, o) => ctx.gear(geo, o) }, q);
  // ── bracers: raised, burnished rolls at the wrist and elbow ends (the bracer reads as a
  // separate stiff cuff, not a sleeve) ──
  const L = P.hand.l.L;
  const fromB = 1 - 0.9; // bracers cover 0.9 of the forearm from the wrist (outfit layer)
  const roll = (t0: number, t1: number) =>
    s.mirrored(() =>
      s.group('union', 0.0015 * sc, () => {
        emitParts(s, parts, ['forearm'], { color: PALETTE.bracersTrim, mat: 'leather_worn', inflate: 0.0158 * sc, k: 0.02 * sc, oneSide: true });
        const a0: [number, number, number] = [j.forearm_l[0] + L.x * P.foreArm * t0, j.forearm_l[1] + L.y * P.foreArm * t0, j.forearm_l[2]];
        const a1: [number, number, number] = [j.forearm_l[0] + L.x * P.foreArm * t1, j.forearm_l[1] + L.y * P.foreArm * t1, j.forearm_l[2]];
        s.plane([-L.x, -L.y, -L.z], -(L.x * a0[0] + L.y * a0[1] + L.z * a0[2]), { op: 'intersect', k: 0.003 * sc });
        s.plane([L.x, L.y, L.z], L.x * a1[0] + L.y * a1[1] + L.z * a1[2], { op: 'intersect', k: 0.003 * sc });
      }),
    );
  roll(fromB + 0.005, fromB + 0.05);
  const wristT = 1 - 0.008 * sc / P.foreArm;
  roll(wristT - 0.06, wristT - 0.012);
  // ── bronze buckle where the baldric crosses the right breast (turnaround) ──
  const proj = makeProjector(s, { min: [-0.4 * sc, j.chest[1] - 0.3 * sc, -0.3 * sc], max: [0.4 * sc, j.neck[1] + 0.1 * sc, 0.4 * sc] });
  if (proj) {
    const bx = -0.085 * sc;
    const by = (c - n.x * bx) / n.y;
    const hp = V(), hn = V();
    if (snapPoint(proj, [bx, by, 0.3 * sc], 'f', hp, hn)) {
      const along = V(-n.y, n.x, 0); // strap direction (in the strap plane, roughly down-left)
      const m = placeOn(hp.addScaledVector(hn, 0.002 * sc), hn, along);
      const ring = new THREE.TorusGeometry(0.0155 * sc, 0.0034 * sc, 6, 18).rotateX(Math.PI / 2);
      ctx.gear(ring, { bone: 'chest', color: PALETTE.buckle, mat: 'metal', matrix: m, small: true });
      const bar = new THREE.CylinderGeometry(0.0023 * sc, 0.0023 * sc, 0.031 * sc, 5).rotateZ(Math.PI / 2);
      ctx.gear(bar, { bone: 'chest', color: PALETTE.buckle, mat: 'metal', matrix: m, small: true });
      const keeper = new THREE.BoxGeometry(0.05 * sc, 0.003 * sc, 0.011 * sc).translate(0, 0.0005 * sc, 0.022 * sc);
      ctx.gear(keeper, { bone: 'chest', color: PALETTE.belt, mat: 'leather_worn', matrix: m, small: true });
    }
  }
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
      eyeOpen: 0.95,
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
      { type: 'leggings', color: PALETTE.leggings, mat: WOOL },
      { type: 'boots', color: PALETTE.boots, color2: PALETTE.bootsTrim, length: 0.86, mat: TOOLED },
      { type: 'tunic', color: PALETTE.tunic, color2: PALETTE.tunicTrim, length: 0.5, mat: TWILL },
      { type: 'jerkin', color: PALETTE.jerkin, color2: PALETTE.jerkinTrim, mat: TOOLED },
      // stiff tooled bracers from the wrist almost to the elbow (rolled ends in extras)
      { type: 'bracers', color: PALETTE.bracers, color2: PALETTE.bracersTrim, length: 0.9, thickness: 0.003, mat: TOOLED },
      { type: 'belt', color: PALETTE.belt, offset: BELT_RAISE, mat: 'leather_worn' },
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
