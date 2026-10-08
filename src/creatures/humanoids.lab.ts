/**
 * Lab subjects for the humanoid system: 'legolas' (full animation set), 'humanoid_lineup' (every
 * kind side by side at true scale) and one 'humanoid_<kind>' subject per kind for the dressers.
 */
import * as THREE from 'three';
import type { AnimInput, HumanoidKind, LabInstance, LabSubject, SpecialPose, WeaponKind } from '../core/types';
import { createHumanoid, preloadHumanoids, type HumanoidExt } from './humanoid';
import { clearHumanoidCache, prebuildStats } from './humanoid/build';
import { clearKitCache, kitCacheStats } from './kit/cache';
import { meshWorkerCount } from './kit/workers';
import { HumanoidAnimator } from './humanoid/animator';
import { ALL_KINDS, resolveKind, registerKind } from './humanoid/registry';
import { kinds as placeholderKinds } from './humanoid/kinds/_placeholders';

export const LEGOLAS_ANIMS = [
  'idle', 'rest', 'walk', 'run', 'sprint', 'strafe', 'back', 'jump', 'aim', 'draw', 'shoot', 'knife_combo', 'dash', 'hit', 'death',
  'surf', 'climb', 'hang', 'barrel', 'ride', 'swing', 'run_wall', 'crouch', 'kneel', 'sit', 'cheer', 'roar', 'block', 'stagger', 'look',
];
export const NPC_ANIMS = ['idle', 'walk', 'run', 'slash', 'backslash', 'thrust', 'overhead', 'slam', 'sweep', 'shoot', 'throw', 'punch', 'stomp', 'bite', 'hit', 'death', 'block', 'roar', 'cheer', 'stagger', 'crouch'];

const SPECIALS: SpecialPose[] = ['surf', 'climb', 'hang', 'ride', 'sit', 'crouch', 'cheer', 'roar', 'block', 'stagger', 'barrel', 'kneel', 'run_wall', 'swing'];
const ATTACKS = ['slash', 'backslash', 'thrust', 'overhead', 'knife1', 'knife2', 'knife3', 'punch', 'slam', 'sweep', 'throw', 'shoot', 'bite', 'stomp'];

interface Frame {
  input: AnimInput;
  /** root height offset (jumps) */
  y?: number;
  weapons?: { r: WeaponKind; l: WeaponKind };
}

const _look = new THREE.Vector3();

/**
 * `&portrait=1&focus=head`: the lab frames `focus=head` from the bounding box top, which quivers,
 * bows and helmets push off the face. Add an invisible two-point helper that makes the box centre
 * land on the face (zoom ≈ 0.28 fills the frame with the head).
 */
function addPortraitFraming(holder: THREE.Group, h: HumanoidExt) {
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const P = h.assets.P;
  const f = P.h(0, -0.12, 0.2);
  const top = Math.max(box.max.y, P.H) + 0.4; // above anything a pose can raise
  const W = 1.5;
  const lowY = (f[1] - 0.9 * top) / 0.1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([f[0] - W, lowY, f[2] - W, f[0] + W, top, f[2] + W], 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0 }));
  pts.visible = false;
  pts.name = 'portrait-framing';
  holder.add(pts);
}

/** deterministic AnimInput timeline for a lab animation name at time t */
export function labFrame(anim: string, t: number, h: HumanoidExt): Frame {
  const base: AnimInput = { speed: 0, grounded: true };
  switch (anim) {
    case 'walk':
      return { input: { ...base, speed: 1.5 } };
    case 'run':
      return { input: { ...base, speed: 6.5 } };
    case 'sprint':
      return { input: { ...base, speed: 9 } };
    case 'dash':
      return { input: { ...base, speed: 18 } };
    case 'strafe':
      return { input: { ...base, speed: 3.2, moveDir: { x: 1, z: 0 } } };
    case 'back':
      return { input: { ...base, speed: 2.2, moveDir: { x: 0, z: -1 } } };
    case 'jump': {
      // 1.4 s cycle: crouch, take off (v0 7.5 m/s, g 22), land at ~0.78 s, recover
      const c = t % 1.4;
      const tA = 0.1;
      if (c < tA) return { input: { ...base } };
      const ta = c - tA;
      const v0 = 7.5;
      const y = v0 * ta - 11 * ta * ta;
      if (y > 0) return { input: { ...base, grounded: false, vy: v0 - 22 * ta }, y };
      return { input: { ...base } };
    }
    case 'aim': {
      const pitch = Math.sin(t * 0.8) * 0.35;
      return { input: { ...base, aim: 1, draw: 0.85 + 0.15 * Math.sin(t * 2), aimPitch: pitch } };
    }
    case 'draw': {
      const c = t % 2.0;
      const aim = Math.min(1, c / 0.25);
      const draw = Math.min(1, Math.max(0, (c - 0.25) / 0.6));
      return { input: { ...base, aim, draw } };
    }
    case 'shoot': {
      // hold full draw then loose at 0.6 s of each 1.6 s cycle
      const c = t % 1.6;
      const draw = c < 0.5 ? Math.min(1, c / 0.45) : c < 0.6 ? 1 : Math.max(0, 1 - (c - 0.6) / 0.05);
      return { input: { ...base, aim: c < 1.3 ? 1 : 1 - (c - 1.3) / 0.3, draw } };
    }
    case 'knife_combo': {
      const c = t % 1.3;
      const kind = c < 0.32 ? 'knife1' : c < 0.64 ? 'knife2' : 'knife3';
      const at = c < 0.32 ? c / 0.32 : c < 0.64 ? (c - 0.32) / 0.32 : Math.min(1, (c - 0.64) / 0.5);
      return { input: { ...base, attack: { kind, t: at } }, weapons: { r: 'elven_knives', l: 'elven_knives' } };
    }
    case 'hit': {
      const c = t % 1.0;
      return { input: { ...base, hit: c < 0.08 ? c / 0.08 : Math.max(0, 1 - (c - 0.08) / 0.35) } };
    }
    case 'death': {
      const variant = Math.floor(t / 2) % 4;
      return { input: { ...base, dead: Math.min(1, (t % 2) / 1.3), deathVariant: variant } };
    }
    case 'look': {
      const a = t * 0.9;
      h.root.updateWorldMatrix(true, false);
      _look.set(Math.sin(a) * 3, 1.2 + Math.sin(a * 0.7) * 1.2, 3).applyMatrix4(h.root.matrixWorld);
      return { input: { ...base, lookAt: _look } };
    }
    default: {
      if ((SPECIALS as string[]).includes(anim)) {
        const rate = anim === 'climb' ? 0.7 : anim === 'swing' ? 0.45 : anim === 'run_wall' ? 1.55 : 0.5;
        return { input: { ...base, special: anim as SpecialPose, specialT: t * rate, speed: anim === 'run_wall' ? 6.5 : 0 } };
      }
      if (ATTACKS.includes(anim)) {
        const c = t % 1.2;
        return { input: { ...base, attack: { kind: anim as never, t: Math.min(1, c / 0.9) } } };
      }
      return { input: base };
    }
  }
}

/** pose a humanoid deterministically at (anim, t): seek, then pre-roll springs over 1.2 s */
export function poseHumanoid(h: HumanoidExt, anim: string, t: number, defaults: { r: WeaponKind; l: WeaponKind }, lift?: THREE.Object3D) {
  if (anim === 'rest') return; // bind pose (debug skinning)
  const pre = Math.min(t, 1.2);
  const start = t - pre;
  const f0 = labFrame(anim, start, h);
  const speed = f0.input.speed;
  h.resetAnimation(start, h.gaitFrequency(speed) * start);
  const w = f0.weapons ?? defaults;
  if (h.weaponObject('hand_r')?.userData.kind !== w.r && !(w.r === 'none' && !h.weaponObject('hand_r'))) h.setWeapon('hand_r', w.r);
  if (h.weaponObject('hand_l')?.userData.kind !== w.l && !(w.l === 'none' && !h.weaponObject('hand_l'))) h.setWeapon('hand_l', w.l);
  const dt = 1 / 60;
  const steps = Math.max(1, Math.round(pre / dt));
  for (let i = 0; i <= steps; i++) {
    const tt = start + i * dt;
    const f = labFrame(anim, tt, h);
    if (lift) lift.position.y = f.y ?? 0;
    h.animate(i === 0 ? 0 : dt, f.input);
  }
}

function humanoidSubject(name: string, kind: HumanoidKind, category: LabSubject['category'], anims: string[], seed = 0): LabSubject {
  return {
    name,
    category,
    async create(): Promise<LabInstance> {
      // LOD0 + LOD1 meshing run in parallel in the kit worker pool
      await preloadHumanoids([kind], { seeds: [seed] });
      const h = createHumanoid({ kind, seed });
      // &lod=1|2 previews the reduced geometry + cheap animation path
      const lodQ = Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('lod') ?? 0);
      if (lodQ === 1 || lodQ === 2) h.setLod(lodQ);
      const def = resolveKind(kind);
      // &weapons=none hides held weapons (centred head close-ups)
      const noW = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('weapons') === 'none';
      const defaults = noW ? { r: 'none' as WeaponKind, l: 'none' as WeaponKind } : { r: (def.weapons.right ?? 'none') as WeaponKind, l: (def.weapons.left ?? 'none') as WeaponKind };
      // &weapon=<kind> / &offhand=<kind> override the held items (e.g. weapon=crossbow)
      const qs = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
      if (qs.get('weapon')) defaults.r = qs.get('weapon') as WeaponKind;
      if (qs.get('offhand')) defaults.l = qs.get('offhand') as WeaponKind;
      const holder = new THREE.Group();
      holder.add(h.root);
      if (noW) h.socket('back').visible = false;
      if (new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('portrait')) addPortraitFraming(holder, h);
      console.info(`[lab] ${name}: ${h.triangles} tris (LOD0), assets ${h.buildMs.toFixed(0)} ms`, h.assets.lods.map((l) => l.tris));
      return {
        object: holder,
        height: h.height,
        animations: anims,
        pose(anim, t) {
          poseHumanoid(h, anim, t, defaults, h.root);
        },
        dispose: () => h.dispose(),
      };
    },
  };
}

const CATEGORY: Partial<Record<HumanoidKind, LabSubject['category']>> = {
  legolas: 'hero',
  tauriel: 'ally', elf: 'ally', thranduil: 'ally', aragorn: 'ally', man: 'ally', rohirrim: 'ally', gondor: 'ally', gimli: 'ally', dwarf: 'ally',
};

export const subjects: LabSubject[] = [
  humanoidSubject('legolas', 'legolas', 'hero', LEGOLAS_ANIMS),
  ...ALL_KINDS.filter((k) => k !== 'legolas').map((k) => humanoidSubject(`humanoid_${k}`, k, CATEGORY[k] ?? 'enemy', NPC_ANIMS)),
  // the kit's fallback kinds (the dressers' definitions replace them in the game)
  ...(['troll', 'orc', 'gimli'] as HumanoidKind[]).map(
    (k): LabSubject => ({
      name: `kit_placeholder_${k}`,
      category: 'enemy',
      async create(): Promise<LabInstance> {
        registerKind(k, placeholderKinds[k]!);
        return humanoidSubject(`kit_placeholder_${k}`, k, 'enemy', NPC_ANIMS).create();
      },
    }),
  ),
  {
    name: 'humanoid_lineup',
    category: 'hero',
    async create(): Promise<LabInstance> {
      const g = new THREE.Group();
      const hs: { h: HumanoidExt; d: { r: WeaponKind; l: WeaponKind } }[] = [];
      let x = 0;
      const t0 = performance.now();
      await preloadHumanoids(ALL_KINDS);
      ALL_KINDS.forEach((k) => {
        const h = createHumanoid({ kind: k });
        const def = resolveKind(k);
        const w = def.height > 3 ? 2.4 : def.height > 2.3 ? 1.4 : 1.0;
        x += w / 2;
        h.root.position.x = x;
        x += w / 2 + 0.05;
        g.add(h.root);
        hs.push({ h, d: { r: (def.weapons.right ?? 'none') as WeaponKind, l: (def.weapons.left ?? 'none') as WeaponKind } });
      });
      g.children.forEach((c) => (c.position.x -= x / 2));
      console.info(`[lab] lineup built in ${(performance.now() - t0).toFixed(0)} ms`, hs.map((e) => `${e.h.kind}:${e.h.triangles}`).join(' '));
      return {
        object: g,
        height: 4.5,
        animations: ['idle', 'walk', 'run', 'slash', 'hit', 'death', 'cheer'],
        pose(anim, t) {
          for (const e of hs) poseHumanoid(e.h, anim, t, e.d);
        },
        dispose: () => hs.forEach((e) => e.h.dispose()),
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarks (browser): node scripts/snap.mjs "/lab/?subject=humanoid_orc&view=single" --eval "__kitBench.build()"
// ─────────────────────────────────────────────────────────────────────────────

const BENCH_KINDS: HumanoidKind[] = ['legolas', 'orc', 'uruk', 'gimli', 'troll', 'goblin'];

async function benchBuild(kinds: HumanoidKind[] = BENCH_KINDS, rounds = 2) {
  const res: Record<string, unknown> = { workers: meshWorkerCount(), kinds, cores: navigator.hardwareConcurrency };
  const cold = () => {
    clearHumanoidCache();
    clearKitCache();
  };
  const sync: number[] = [];
  const pre: number[] = [];
  const perKind: Record<string, number> = {};
  // alternate sync / worker rounds (the first round of each also warms the JIT)
  for (let r = 0; r < rounds; r++) {
    cold();
    let t0 = performance.now();
    for (const k of kinds) {
      const t1 = performance.now();
      createHumanoid({ kind: k }).assets.ensureLods?.();
      if (r === rounds - 1) perKind[k] = Math.round(performance.now() - t1);
    }
    sync.push(Math.round(performance.now() - t0));
    cold();
    t0 = performance.now();
    Object.assign(prebuildStats, { prepareMs: 0, meshWaitMs: 0, assembleMs: 0, specs: 0 });
    await preloadHumanoids(kinds);
    pre.push(Math.round(performance.now() - t0));
    res.preloadPhases = Object.fromEntries(Object.entries(prebuildStats).map(([k, v]) => [k, Math.round(v)]));
  }
  res.syncMs = sync;
  res.syncPerKindMs = perKind;
  res.preloadMs = pre;
  const t0 = performance.now();
  for (const k of kinds) createHumanoid({ kind: k });
  res.createAfterPreloadMs = Math.round(performance.now() - t0);
  res.cache = kitCacheStats();
  return JSON.stringify(res);
}

function benchAnim(n = 40, steps = 300, kind: HumanoidKind = 'orc') {
  const scene = new THREE.Scene();
  const hs: HumanoidExt[] = [];
  for (let i = 0; i < n; i++) {
    const h = createHumanoid({ kind, seed: i });
    h.assets.ensureLods?.();
    h.root.position.set((i % 8) * 2, 0, Math.floor(i / 8) * 2);
    scene.add(h.root);
    hs.push(h);
  }
  const inputs: AnimInput[] = hs.map(() => ({ speed: 0, grounded: true, moveDir: { x: 0, z: 1 }, attack: null, lookAt: new THREE.Vector3(0, 1.6, 0) }));
  const out: Record<string, number> = {};
  let t = 0;
  const dt = 1 / 60;
  const step = (withMatrices: boolean) => {
    t += dt;
    for (let i = 0; i < hs.length; i++) {
      const inp = inputs[i];
      const c = (t + i * 0.37) % 6;
      inp.speed = c < 2 ? 0 : c < 4 ? 3.5 : 5.5;
      inp.attack = c > 5 ? { kind: 'slash', t: c - 5 } : null;
      hs[i].animate(dt, inp);
    }
    if (withMatrices) scene.updateMatrixWorld();
  };
  const runs: [0 | 1 | 2, boolean][] = [[0, false], [1, true], [2, true], [1, false], [2, false]];
  for (const [lod, full] of runs) {
    HumanoidAnimator.forceFull = full;
    for (const h of hs) h.setLod(lod);
    for (let i = 0; i < 60; i++) step(true);
    let t0 = performance.now();
    for (let i = 0; i < steps; i++) step(false);
    const tag = `lod${lod}${full && lod > 0 ? '_fullpath' : ''}`;
    out[`${tag}_animate`] = +((performance.now() - t0) / steps).toFixed(3);
    t0 = performance.now();
    for (let i = 0; i < steps; i++) step(true);
    out[`${tag}_animate+matrices`] = +((performance.now() - t0) / steps).toFixed(3);
  }
  HumanoidAnimator.forceFull = false;
  hs.forEach((h) => h.dispose());
  return JSON.stringify({ n, kind, msPerStep: out });
}

if (typeof window !== 'undefined') (window as unknown as { __kitBench: unknown }).__kitBench = { build: benchBuild, anim: benchAnim };
