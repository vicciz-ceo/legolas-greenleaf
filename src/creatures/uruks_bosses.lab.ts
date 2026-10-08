/**
 * Lab subjects for the group `uruks_bosses`: uruk (+4 seed variants, archer, pikeman), berserker,
 * lurtz, bolg, troll_cave, troll_war and `uruks_bosses_lineup` (all at true scale next to Legolas).
 */
import * as THREE from 'three';
import type { AnimInput, HumanoidKind, LabInstance, LabSubject, WeaponKind } from '../core/types';
import { createHumanoid, type HumanoidExt } from './humanoid';
import { resolveKind } from './humanoid/registry';
import { seedForBucket } from './humanoid/kinds/uruks_bosses';

const ATTACKS = ['slash', 'backslash', 'thrust', 'overhead', 'slam', 'sweep', 'shoot', 'punch', 'stomp'];
const SPECIAL = ['block', 'roar', 'cheer', 'stagger', 'crouch'];

function frame(anim: string, t: number, attackAlias: string): AnimInput {
  const base: AnimInput = { speed: 0, grounded: true };
  switch (anim) {
    case 'walk':
      return { ...base, speed: 1.6 };
    case 'run':
      return { ...base, speed: 6 };
    case 'attack':
      return { ...base, attack: { kind: attackAlias as never, t: Math.min(1, (t % 1.4) / 0.9) } };
    case 'hit': {
      const c = t % 1.0;
      return { ...base, hit: c < 0.08 ? c / 0.08 : Math.max(0, 1 - (c - 0.08) / 0.35) };
    }
    case 'death':
      return { ...base, dead: Math.min(1, (t % 2.4) / 1.4), deathVariant: Math.floor(t / 2.4) % 4 };
    default:
      if (ATTACKS.includes(anim)) return { ...base, attack: { kind: anim as never, t: Math.min(1, (t % 1.4) / 0.9) } };
      if (SPECIAL.includes(anim)) return { ...base, special: anim as never, specialT: t * 0.5 };
      return base;
  }
}

/** deterministic pose at (anim, t): seek, then pre-roll the springs for 1.2 s */
function poseAt(h: HumanoidExt, anim: string, t: number, alias: string) {
  const pre = Math.min(t, 1.2);
  const start = t - pre;
  const f0 = frame(anim, start, alias);
  h.resetAnimation(start, h.gaitFrequency(f0.speed) * start);
  const dt = 1 / 60;
  const steps = Math.max(1, Math.round(pre / dt));
  for (let i = 0; i <= steps; i++) h.animate(i === 0 ? 0 : dt, frame(anim, start + i * dt, alias));
}

export const ANIMS = ['idle', 'walk', 'run', 'attack', 'hit', 'death', 'slash', 'overhead', 'slam', 'sweep', 'thrust', 'shoot', 'stomp', 'block', 'roar', 'cheer', 'stagger'];

interface SubjOpts {
  kind: HumanoidKind;
  seed?: number;
  weapon?: WeaponKind;
  offhand?: WeaponKind;
  attack?: string;
  helmet?: boolean;
  armor?: number;
  category?: LabSubject['category'];
}

function subject(name: string, o: SubjOpts): LabSubject {
  return {
    name,
    category: o.category ?? 'enemy',
    create(): LabInstance {
      const h = createHumanoid({ kind: o.kind, seed: o.seed, weapon: o.weapon, offhand: o.offhand, helmet: o.helmet, armor: o.armor });
      const holder = new THREE.Group();
      holder.add(h.root);
      console.info(`[lab] ${name}: ${h.triangles} tris (LOD0), assets ${h.buildMs.toFixed(0)} ms`, h.assets.lods.map((l) => l.tris));
      return {
        object: holder,
        height: h.height,
        animations: ANIMS,
        pose: (anim, t) => poseAt(h, anim, t, o.attack ?? 'slash'),
        dispose: () => h.dispose(),
      };
    },
  };
}

export const subjects: LabSubject[] = [
  subject('uruk', { kind: 'uruk', attack: 'slash' }),
  subject('uruk_v1', { kind: 'uruk', seed: seedForBucket(1), attack: 'slash' }),
  subject('uruk_v2', { kind: 'uruk', seed: seedForBucket(2), attack: 'overhead' }),
  subject('uruk_v3', { kind: 'uruk', seed: seedForBucket(3), attack: 'slash' }),
  subject('uruk_archer', { kind: 'uruk', weapon: 'uruk_bow', offhand: 'none', attack: 'shoot' }),
  subject('uruk_pike', { kind: 'uruk', weapon: 'pike', offhand: 'none', attack: 'thrust' }),
  subject('uruk_bare', { kind: 'uruk', helmet: false, attack: 'slash' }),
  subject('berserker', { kind: 'berserker', attack: 'overhead' }),
  subject('lurtz', { kind: 'lurtz', attack: 'slash' }),
  subject('bolg', { kind: 'bolg', attack: 'overhead' }),
  subject('troll_cave', { kind: 'troll', seed: seedForBucket(0), attack: 'slam' }),
  subject('troll_cave_b', { kind: 'troll', seed: seedForBucket(1), attack: 'sweep' }),
  subject('troll_war', { kind: 'troll', seed: seedForBucket(2), weapon: 'warhammer', attack: 'overhead' }),
  subject('troll_war_b', { kind: 'troll', seed: seedForBucket(3), weapon: 'warhammer', attack: 'slam' }),
];
