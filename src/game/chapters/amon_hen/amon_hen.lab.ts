/**
 * Lab subjects for the Amon Hen cast as the chapter dresses them: Lurtz in his two phases (bow, then
 * sword and shield), and the Uruk-hai roles (shield-bearer, pikeman, archer).
 *
 *   /lab/?subject=lurtz_bow&view=quad&anim=shoot
 *   /lab/?subject=lurtz_blade&view=quad&anim=block
 */
import * as THREE from 'three';
import type { AnimInput, HumanoidKind, LabInstance, LabSubject, WeaponKind } from '../../../core/types';
import { createHumanoid, type HumanoidExt } from '../../../creatures/humanoid';
import { seedForBucket } from '../../../creatures/humanoid/kinds/uruks_bosses';

const ANIMS = ['idle', 'walk', 'run', 'slash', 'overhead', 'thrust', 'throw', 'punch', 'shoot', 'block', 'roar', 'stagger', 'kneel', 'sit', 'crouch', 'hit', 'death'];
const SPECIAL = ['block', 'roar', 'stagger', 'kneel', 'sit', 'crouch', 'cheer'];

function frame(anim: string, t: number, bow: boolean): AnimInput {
  const base: AnimInput = { speed: 0, grounded: true };
  switch (anim) {
    case 'walk':
      return { ...base, speed: 1.6 };
    case 'run':
      return { ...base, speed: 6 };
    case 'shoot':
      // draw, hold, loose: 1.6 s loop
      return { ...base, aim: 1, draw: bow ? Math.min(1, (t % 1.6) / 1.0) : 0, aimPitch: 0.02 };
    case 'hit': {
      const c = t % 1.0;
      return { ...base, hit: c < 0.08 ? c / 0.08 : Math.max(0, 1 - (c - 0.08) / 0.35) };
    }
    case 'death':
      return { ...base, dead: Math.min(1, (t % 2.4) / 1.4), deathVariant: Math.floor(t / 2.4) % 4 };
    default:
      if (SPECIAL.includes(anim)) return { ...base, special: anim as never, specialT: t * 0.5 };
      if (['slash', 'overhead', 'thrust', 'throw', 'punch'].includes(anim)) return { ...base, attack: { kind: anim as never, t: Math.min(1, (t % 1.4) / 0.9) } };
      return base;
  }
}

function pose(h: HumanoidExt, anim: string, t: number, bow: boolean): void {
  const pre = Math.min(t, 1.2);
  const start = t - pre;
  const f0 = frame(anim, start, bow);
  h.resetAnimation(start, h.gaitFrequency(f0.speed) * start);
  const dt = 1 / 60;
  const steps = Math.max(1, Math.round(pre / dt));
  for (let i = 0; i <= steps; i++) h.animate(i === 0 ? 0 : dt, frame(anim, start + i * dt, bow));
}

function subject(name: string, kind: HumanoidKind, o: { seed?: number; weapon: WeaponKind; offhand: WeaponKind; helmet?: boolean }): LabSubject {
  const bow = o.offhand === 'uruk_bow' || o.weapon === 'uruk_bow';
  return {
    name,
    category: 'enemy',
    create(): LabInstance {
      const h = createHumanoid({ kind, seed: o.seed, weapon: o.weapon, offhand: o.offhand, ...(o.helmet === undefined ? {} : { helmet: o.helmet }) }) as HumanoidExt;
      const holder = new THREE.Group();
      holder.add(h.root);
      return { object: holder, height: h.height, animations: ANIMS, pose: (a, t) => pose(h, a, t, bow), dispose: () => h.dispose() };
    },
  };
}

export const subjects: LabSubject[] = [
  subject('lurtz_bow', 'lurtz', { seed: 2, weapon: 'none', offhand: 'uruk_bow' }),
  subject('lurtz_blade', 'lurtz', { seed: 2, weapon: 'sword', offhand: 'shield' }),
  subject('amon_uruk_shield', 'uruk', { seed: seedForBucket(1), weapon: 'sword', offhand: 'shield' }),
  subject('amon_uruk_pike', 'uruk', { seed: seedForBucket(2), weapon: 'pike', offhand: 'none' }),
  // exactly the chapter's Boromir (cast.ts makeBoromirBody): seed 11, bareheaded
  subject('amon_boromir', 'gondor', { seed: 11, weapon: 'sword', offhand: 'shield', helmet: false }),
  subject('amon_uruk_archer', 'uruk', { seed: seedForBucket(3), weapon: 'uruk_bow', offhand: 'none' }),
];
