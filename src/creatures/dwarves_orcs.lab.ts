/**
 * Lab subjects for the dwarves_orcs group: gimli, dwarf, orc, goblin, gundabad, easterling,
 * haradrim (each with idle/walk/run/attack/hit/death + kind-specific extras), `<kind>_variants`
 * (the four seed buckets side by side) and `dwarves_orcs_lineup` (all kinds at true scale next
 * to Legolas).
 *
 *   /lab/?subject=orc&view=quad&anim=idle&t=1
 *   /lab/?subject=orc_variants&view=single&anim=idle
 *   /lab/?subject=dwarves_orcs_lineup&view=single&zoom=0.6
 */
import * as THREE from 'three';
import type { HumanoidKind, LabInstance, LabSubject, WeaponKind } from '../core/types';
import { createHumanoid, type HumanoidExt } from './humanoid';
import { resolveKind } from './humanoid/registry';
import { seedBucket } from './humanoid/build';
import { poseHumanoid } from './humanoids.lab';
import { loadoutFor, seedForBucket, type Loadout } from './humanoid/kinds/dwarves_orcs';

type LabAnim = string;

/** the attack animations that suit a weapon (the lab's `attack` cycles through them) */
function attackSet(w: WeaponKind): string[] {
  switch (w) {
    case 'spear':
    case 'pike':
      return ['thrust', 'overhead', 'sweep'];
    case 'warhammer':
    case 'mace':
    case 'club':
      return ['overhead', 'slam', 'backslash'];
    case 'dwarf_axe':
    case 'axe':
      return ['overhead', 'slash', 'backslash'];
    default:
      return ['slash', 'overhead', 'backslash', 'thrust'];
  }
}

const COMMON: LabAnim[] = ['idle', 'walk', 'run', 'attack', 'hit', 'death'];
const EXTRA: Partial<Record<HumanoidKind, LabAnim[]>> = {
  gimli: ['overhead', 'slash', 'backslash', 'block', 'roar', 'cheer', 'crouch', 'stagger', 'sit', 'kneel', 'rest'],
  dwarf: ['barrel', 'overhead', 'slash', 'block', 'roar', 'cheer', 'crouch', 'sit', 'rest'],
  orc: ['slash', 'overhead', 'thrust', 'throw', 'shoot', 'block', 'roar', 'cheer', 'crouch', 'stagger', 'rest'],
  goblin: ['slash', 'thrust', 'crouch', 'climb', 'roar', 'stagger', 'rest'],
  gundabad: ['overhead', 'slam', 'sweep', 'roar', 'stagger', 'block', 'rest'],
  easterling: ['thrust', 'slash', 'block', 'overhead', 'cheer', 'stagger', 'rest'],
  haradrim: ['thrust', 'slash', 'backslash', 'block', 'cheer', 'stagger', 'ride', 'rest'],
};

interface Entry {
  seed: number;
  h: HumanoidExt;
  d: { r: WeaponKind; l: WeaponKind };
  attacks: string[];
  lift: THREE.Group;
}

/** URL overrides for inspection: &helmet=0|1 &armor=0..1 &weapon=<kind> &offhand=<kind> */
function urlLoadout(lo: Loadout): Loadout {
  if (typeof location === 'undefined') return lo;
  const q = new URLSearchParams(location.search);
  const out = { ...lo };
  if (q.has('helmet')) out.helmet = q.get('helmet') !== '0';
  if (q.has('armor')) out.armor = Number(q.get('armor'));
  if (q.has('weapon')) out.weapon = q.get('weapon') as WeaponKind;
  if (q.has('offhand')) out.offhand = q.get('offhand') as WeaponKind;
  return out;
}

function makeEntry(kind: HumanoidKind, seed: number, lo0: Loadout): Entry {
  const lo = urlLoadout(lo0);
  const h = createHumanoid({ kind, seed, weapon: lo.weapon, offhand: lo.offhand, helmet: lo.helmet, armor: lo.armor });
  const def = resolveKind(kind);
  const r = (lo.weapon ?? def.weapons.right ?? 'none') as WeaponKind;
  const l = (lo.offhand ?? def.weapons.left ?? 'none') as WeaponKind;
  const lift = new THREE.Group();
  lift.add(h.root);
  return { seed, h, d: { r, l }, attacks: attackSet(r), lift };
}

const _seen = new WeakSet<Entry>();

/** triangles of everything visible on a humanoid except its held weapons: body + kit hair + eyes + our skinned extras */
function totalTris(e: Entry): { total: number; body: number; extras: number } {
  e.h.root.updateMatrixWorld(true);
  const skip = new Set<THREE.Object3D>();
  for (const hand of ['hand_r', 'hand_l'] as const) {
    const w = e.h.weaponObject(hand);
    if (w) skip.add(w);
  }
  let body = 0;
  let extras = 0;
  const walk = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry as THREE.BufferGeometry;
      const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      if (m.name === 'body' || m.name === 'hair' || m.name === 'eyes') body += n;
      else extras += n;
    }
    for (const c of o.children) walk(c);
  };
  walk(e.h.root);
  return { total: body + extras, body, extras };
}

function poseEntry(e: Entry, anim: string, t: number) {
  if (!_seen.has(e)) {
    _seen.add(e);
    queueMicrotask(() => {
      const st = totalTris(e);
      const w = window as unknown as { __dwoStats?: Record<string, unknown>[] };
      (w.__dwoStats ??= []).push({ kind: e.h.kind, bucket: seedBucket(e.seed), total: Math.round(st.total), body: Math.round(st.body), extras: Math.round(st.extras), lod0: e.h.triangles });
    });
  }
  let a = anim;
  let tt = t;
  if (anim === 'attack') {
    // cycle the weapon's attacks, 1.2 s each
    const i = Math.floor(t / 1.2) % e.attacks.length;
    a = e.attacks[i];
    tt = t % 1.2;
  }
  poseHumanoid(e.h, a, tt, e.d, e.h.root);
}

/** with focus=head the lab frames the bounding box of the subject; an invisible symmetric box keeps the head centred */
function addFramer(holder: THREE.Object3D, height: number, halfWidth = 0.7) {
  if (typeof location === 'undefined' || new URLSearchParams(location.search).get('focus') !== 'head') return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2, height, halfWidth * 2), new THREE.MeshBasicMaterial());
  m.position.y = height / 2;
  m.visible = false;
  holder.add(m);
}

function subjectFor(kind: HumanoidKind, name: string, category: LabSubject['category'], seed = 0): LabSubject {
  return {
    name,
    category,
    create(): LabInstance {
      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
      const sd = q?.has('seed') ? Number(q.get('seed')) : seed;
      const lo = loadoutFor(kind, sd);
      const e = makeEntry(kind, sd, lo);
      const holder = new THREE.Group();
      holder.add(e.lift);
      addFramer(holder, e.h.height);
      const bucket = seedBucket(sd);
      console.info(`[lab] ${name}: ${e.h.triangles} tris (LOD0), assets ${e.h.buildMs.toFixed(0)} ms, bucket ${bucket}`, e.h.assets.lods.map((l) => l.tris));
      return {
        object: holder,
        height: e.h.height,
        animations: [...COMMON, ...(EXTRA[kind] ?? [])],
        pose: (anim, t) => poseEntry(e, anim, t),
        dispose: () => e.h.dispose(),
      };
    },
  };
}

/** the four geometry buckets of a kind side by side (seeds chosen so each bucket appears once) */
function variantsSubject(kind: HumanoidKind, name: string, category: LabSubject['category']): LabSubject {
  return {
    name,
    category,
    create(): LabInstance {
      const def = resolveKind(kind);
      const g = new THREE.Group();
      const entries: Entry[] = [];
      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
      const w = q?.has('gap') ? Number(q.get('gap')) : Math.max(1.0, def.height * 0.62);
      for (let b = 0; b < 4; b++) {
        const seed = seedForBucket(b);
        const e = makeEntry(kind, seed, loadoutFor(kind, seed));
        e.lift.position.x = (b - 1.5) * w;
        g.add(e.lift);
        entries.push(e);
      }
      addFramer(g, def.height, 0.3);
      console.info(`[lab] ${name}:`, entries.map((e) => `${e.h.triangles}t/${e.h.buildMs.toFixed(0)}ms`).join(' '));
      return {
        object: g,
        height: def.height + 0.1,
        animations: [...COMMON, ...(EXTRA[kind] ?? [])],
        pose: (anim, t) => entries.forEach((e) => poseEntry(e, anim, t)),
        dispose: () => entries.forEach((e) => e.h.dispose()),
      };
    },
  };
}

const GROUP: HumanoidKind[] = ['gimli', 'dwarf', 'orc', 'goblin', 'gundabad', 'easterling', 'haradrim'];

export const subjects: LabSubject[] = [
  subjectFor('gimli', 'gimli', 'ally'),
  subjectFor('dwarf', 'dwarf', 'ally'),
  subjectFor('orc', 'orc', 'enemy'),
  subjectFor('goblin', 'goblin', 'enemy'),
  subjectFor('gundabad', 'gundabad', 'enemy'),
  subjectFor('easterling', 'easterling', 'enemy'),
  subjectFor('haradrim', 'haradrim', 'enemy'),
  variantsSubject('dwarf', 'dwarf_variants', 'ally'),
  variantsSubject('orc', 'orc_variants', 'enemy'),
  variantsSubject('goblin', 'goblin_variants', 'enemy'),
  variantsSubject('gundabad', 'gundabad_variants', 'enemy'),
  variantsSubject('easterling', 'easterling_variants', 'enemy'),
  variantsSubject('haradrim', 'haradrim_variants', 'enemy'),
  {
    name: 'dwarves_orcs_lineup',
    category: 'enemy',
    create(): LabInstance {
      const g = new THREE.Group();
      const entries: Entry[] = [];
      const order: HumanoidKind[] = ['legolas', 'gimli', 'dwarf', 'goblin', 'orc', 'haradrim', 'easterling', 'gundabad'];
      const widths: Partial<Record<HumanoidKind, number>> = { gundabad: 1.2, easterling: 1.2, haradrim: 1.15, legolas: 0.95, gimli: 0.95, dwarf: 0.9, goblin: 0.95, orc: 1.0 };
      let x = 0;
      const t0 = performance.now();
      for (const k of order) {
        const lo = k === 'legolas' ? ({} as Loadout) : loadoutFor(k, 0);
        const e = makeEntry(k, 0, lo);
        const w = widths[k] ?? 1;
        x += w / 2;
        e.lift.position.x = x;
        x += w / 2;
        g.add(e.lift);
        entries.push(e);
      }
      g.children.forEach((c) => (c.position.x -= x / 2));
      console.info(`[lab] dwarves_orcs_lineup built in ${(performance.now() - t0).toFixed(0)} ms`, entries.map((e) => `${e.h.kind}:${e.h.triangles}`).join(' '));
      return {
        object: g,
        height: 2.2,
        animations: ['idle', 'walk', 'run', 'attack', 'hit', 'death', 'cheer'],
        pose: (anim, t) => entries.forEach((e) => poseEntry(e, e.h.kind === 'legolas' && anim === 'attack' ? 'slash' : anim, t)),
        dispose: () => entries.forEach((e) => e.h.dispose()),
      };
    },
  },
];

void GROUP;
