/**
 * Lab subjects for the elves_men group: tauriel, elf, thranduil, aragorn, man, rohirrim, gondor
 * (each with idle/walk/run/attack/hit/death + kind-specific extras), `<kind>_variants` (the four
 * seed buckets side by side) and `elves_men_lineup` (all kinds at true scale next to Legolas).
 *
 *   /lab/?subject=tauriel&view=quad&anim=idle&t=1
 *   /lab/?subject=elf_variants&view=single&anim=idle
 *   /lab/?subject=elves_men_lineup&view=single&zoom=0.6
 *
 * Seed-varied kinds (elf, man, rohirrim, gondor) take `&seed=N` and `&loadout=1` (apply
 * loadoutFor(kind, seed): weapon, helmet, armour level). Overrides: `&helmet=0|1 &armor=0..1
 * &weapon=<kind> &offhand=<kind> &weapons=none`; `&lod=1|2` previews the reduced geometry.
 */
import * as THREE from 'three';
import type { HumanoidKind, LabInstance, LabSubject, WeaponKind } from '../core/types';
import { createHumanoid, type HumanoidExt } from './humanoid';
import { resolveKind } from './humanoid/registry';
import { seedBucket } from './humanoid/build';
import { poseHumanoid } from './humanoids.lab';
import { loadoutFor, seedForBucket, type Loadout } from './humanoid/kinds/elves_men';

/** the attack animations that suit a weapon (the lab's `attack` cycles through them) */
function attackSet(kind: HumanoidKind, w: WeaponKind, l: WeaponKind): string[] {
  if (kind === 'tauriel') return ['knife_combo'];
  if (l === 'elven_bow' || w === 'elven_bow') return ['shoot'];
  switch (w) {
    case 'spear':
    case 'pike':
      return ['thrust', 'overhead', 'sweep'];
    case 'axe':
    case 'dwarf_axe':
    case 'mace':
    case 'club':
      return ['overhead', 'slash', 'backslash'];
    default:
      return ['slash', 'backslash', 'thrust', 'overhead'];
  }
}

const COMMON = ['idle', 'walk', 'run', 'attack', 'hit', 'death'];
const EXTRA: Partial<Record<HumanoidKind, string[]>> = {
  tauriel: ['aim', 'draw', 'shoot', 'knife_combo', 'jump', 'dash', 'crouch', 'cheer', 'block', 'stagger', 'rest'],
  elf: ['aim', 'draw', 'shoot', 'slash', 'thrust', 'block', 'cheer', 'stagger', 'rest'],
  thranduil: ['slash', 'backslash', 'thrust', 'block', 'cheer', 'stagger', 'rest'],
  aragorn: ['slash', 'backslash', 'thrust', 'overhead', 'block', 'roar', 'cheer', 'kneel', 'stagger', 'rest'],
  man: ['slash', 'overhead', 'thrust', 'block', 'cheer', 'crouch', 'stagger', 'rest'],
  rohirrim: ['slash', 'thrust', 'overhead', 'block', 'cheer', 'ride', 'stagger', 'rest'],
  gondor: ['slash', 'thrust', 'block', 'cheer', 'kneel', 'stagger', 'rest'],
};

interface Entry {
  seed: number;
  h: HumanoidExt;
  d: { r: WeaponKind; l: WeaponKind };
  attacks: string[];
  lift: THREE.Group;
}

/** &loadout=1 applies loadoutFor(kind, seed); overrides: &helmet=0|1 &armor=0..1 &weapon=<kind> &offhand=<kind> &weapons=none */
function urlLoadout(lo: Loadout): Loadout {
  if (typeof location === 'undefined') return lo;
  const q = new URLSearchParams(location.search);
  const out: Loadout = q.get('loadout') === '1' ? { ...lo } : {};
  if (q.has('helmet')) out.helmet = q.get('helmet') !== '0';
  if (q.has('armor')) out.armor = Number(q.get('armor'));
  if (q.get('weapons') === 'none') {
    out.weapon = 'none';
    out.offhand = 'none';
  }
  if (q.has('weapon')) out.weapon = q.get('weapon') as WeaponKind;
  if (q.has('offhand')) out.offhand = q.get('offhand') as WeaponKind;
  return out;
}

function makeEntry(kind: HumanoidKind, seed: number, lo0: Loadout, useUrl = true): Entry {
  const lo = useUrl ? urlLoadout(lo0) : lo0;
  const h = createHumanoid({ kind, seed, weapon: lo.weapon, offhand: lo.offhand, helmet: lo.helmet, armor: lo.armor });
  // &lod=1|2 previews the reduced geometry and the cheap animation path
  const lodQ = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('lod') ?? 0) : 0;
  if (lodQ === 1 || lodQ === 2) h.setLod(lodQ);
  const def = resolveKind(kind);
  const r = (lo.weapon ?? def.weapons.right ?? 'none') as WeaponKind;
  const l = (lo.offhand ?? def.weapons.left ?? 'none') as WeaponKind;
  const lift = new THREE.Group();
  lift.add(h.root);
  return { seed, h, d: { r, l }, attacks: attackSet(kind, r, l), lift };
}

const _seen = new WeakSet<Entry>();

/** triangles of everything visible on a humanoid except its held weapons: body + kit hair + eyes + our skinned extras */
function totalTris(e: Entry): { total: number; body: number; extras: number; parts: Record<string, number> } {
  e.h.root.updateMatrixWorld(true);
  const skip = new Set<THREE.Object3D>();
  for (const hand of ['hand_r', 'hand_l'] as const) {
    const w = e.h.weaponObject(hand);
    if (w) skip.add(w);
  }
  let body = 0;
  let extras = 0;
  const parts: Record<string, number> = {};
  const walk = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry as THREE.BufferGeometry;
      const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      if (m.name === 'body' || m.name === 'hair' || m.name === 'eyes') body += n;
      else extras += n;
      parts[m.name || 'mesh'] = (parts[m.name || 'mesh'] ?? 0) + Math.round(n);
    }
    for (const c of o.children) walk(c);
  };
  walk(e.h.root);
  return { total: body + extras, body, extras, parts };
}

function poseEntry(e: Entry, anim: string, t: number) {
  if (!_seen.has(e)) {
    _seen.add(e);
    queueMicrotask(() => {
      const st = totalTris(e);
      const w = window as unknown as { __emStats?: Record<string, unknown>[] };
      (w.__emStats ??= []).push({ kind: e.h.kind, bucket: seedBucket(e.seed), total: Math.round(st.total), body: Math.round(st.body), extras: Math.round(st.extras), parts: st.parts, lod0: e.h.triangles, buildMs: Math.round(e.h.buildMs) });
    });
  }
  let a = anim;
  let tt = t;
  if (anim === 'attack') {
    // cycle the weapon's attacks, 1.2 s each (the bow and knife combos run their own cycle)
    if (e.attacks.length === 1) a = e.attacks[0];
    else {
      const i = Math.floor(t / 1.2) % e.attacks.length;
      a = e.attacks[i];
      tt = t % 1.2;
    }
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
        const e = makeEntry(kind, seed, loadoutFor(kind, seed), false);
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

/** builds every kind x bucket x armour x helmet combination once and reports failures / timings in window.__emStress */
function stressSubject(): LabSubject {
  return {
    name: 'em_stress',
    category: 'ally',
    create(): LabInstance {
      const g = new THREE.Group();
      const res: { kind: string; bucket: number; armor: number; helmet: boolean; ms: number; tris: number; err?: string }[] = [];
      const kinds: HumanoidKind[] = ['tauriel', 'elf', 'thranduil', 'aragorn', 'man', 'rohirrim', 'gondor'];
      const fixed = new Set<HumanoidKind>(['tauriel', 'thranduil', 'aragorn']);
      for (const kind of kinds) {
        for (let b = 0; b < (fixed.has(kind) ? 1 : 4); b++) {
          for (const armor of fixed.has(kind) ? [0.5] : [0, 0.5, 1]) {
            for (const helmet of [true, false]) {
              const t0 = performance.now();
              try {
                const h = createHumanoid({ kind, seed: seedForBucket(b), armor, helmet });
                h.root.position.set(res.length * 0.2, 0, 0);
                g.add(h.root);
                res.push({ kind, bucket: b, armor, helmet, ms: Math.round(performance.now() - t0), tris: h.triangles });
                h.dispose();
              } catch (e) {
                res.push({ kind, bucket: b, armor, helmet, ms: Math.round(performance.now() - t0), tris: 0, err: String((e as Error).message ?? e) });
              }
            }
          }
        }
      }
      (window as unknown as { __emStress?: unknown }).__emStress = res;
      console.info('[lab] em_stress done', res.filter((r) => r.err).length, 'errors of', res.length);
      return { object: g, height: 2, animations: ['idle'], pose: () => undefined };
    },
  };
}

export const subjects: LabSubject[] = [
  stressSubject(),
  subjectFor('tauriel', 'tauriel', 'ally'),
  subjectFor('elf', 'elf', 'ally'),
  subjectFor('thranduil', 'thranduil', 'ally'),
  subjectFor('aragorn', 'aragorn', 'ally'),
  subjectFor('man', 'man', 'ally'),
  subjectFor('rohirrim', 'rohirrim', 'ally'),
  subjectFor('gondor', 'gondor', 'ally'),
  variantsSubject('elf', 'elf_variants', 'ally'),
  variantsSubject('man', 'man_variants', 'ally'),
  variantsSubject('rohirrim', 'rohirrim_variants', 'ally'),
  variantsSubject('gondor', 'gondor_variants', 'ally'),
  {
    name: 'elves_men_lineup',
    category: 'ally',
    create(): LabInstance {
      const g = new THREE.Group();
      const entries: Entry[] = [];
      const order: [HumanoidKind, number][] = [['legolas', 0], ['tauriel', 0], ['elf', seedForBucket(0)], ['elf', seedForBucket(1)], ['thranduil', 0], ['aragorn', 0], ['man', seedForBucket(0)], ['rohirrim', seedForBucket(0)], ['gondor', 0], ['gondor', seedForBucket(1)]];
      const widths: Partial<Record<HumanoidKind, number>> = { thranduil: 1.1, rohirrim: 1.15, gondor: 1.15, aragorn: 1.0 };
      let x = 0;
      const t0 = performance.now();
      for (const [k, seed] of order) {
        const lo = k === 'legolas' ? ({} as Loadout) : loadoutFor(k, seed);
        const e = makeEntry(k, seed, lo, false);
        const w = widths[k] ?? 0.95;
        x += w / 2;
        e.lift.position.x = x;
        x += w / 2;
        g.add(e.lift);
        entries.push(e);
      }
      g.children.forEach((c) => (c.position.x -= x / 2));
      console.info(`[lab] elves_men_lineup built in ${(performance.now() - t0).toFixed(0)} ms`, entries.map((e) => `${e.h.kind}:${e.h.triangles}`).join(' '));
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
