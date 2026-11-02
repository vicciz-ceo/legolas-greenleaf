/**
 * Mesher regression tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * The narrow-band surface-nets mesher skips lattice samples it can prove are far from the surface (a
 * Lipschitz row skip). The skip is only an optimisation: the mesh must come out IDENTICAL to the one made
 * with every sample evaluated (`MeshOpts.exact`). It used to seed a skip from a sample cached by the
 * neighbouring block (block faces are shared); that sample's distance came from the neighbour's culled
 * primitive list and could be far too large, so the skip jumped across a leg and left a hole whose place
 * depended on the lattice phase, i.e. on the character's height:
 *   - the Lake-town man's right leg had a ~10 cm gap through the knee at 1.73-1.76 m (fine at 1.70, 1.72 and
 *     1.77-1.82), seen in the lab as "the idle lifts a foot and bends a knee" (the pose solve was never at fault),
 *   - smaller patches went missing in the knee/thigh band of man 1.72, elf 1.84 / 1.86 and rohirrim 1.77.
 *
 * The man can only be prepared once at a given height per process (`prepareHumanoid` caches by kind / bucket /
 * armour and its sculpt is seeded by the kind name), so the height sweep meshes ONE man sculpt on lattices of
 * resolution `res * 1.75 / H`: by scale invariance that is exactly the lattice phase a man of height H gets.
 */
import { prepareHumanoid } from '../humanoid/build';
import { kindDef, registerKind } from '../humanoid/registry';
import type { Proportions } from '../humanoid/proportions';
import type { HumanoidKind } from '../../core/types';
import { meshSdf, type MeshData } from './mesher';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const test = (n: string, f: () => void) => {
  const b = failed;
  try {
    f();
  } catch (e) {
    failed++;
    console.log('  THROW', (e as Error).stack);
  }
  console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n);
};

/** the first difference between two meshes, or null when they are identical */
function firstDiff(a: MeshData, b: MeshData): string | null {
  if (a.triCount !== b.triCount) return `${a.triCount} vs ${b.triCount} triangles`;
  if (a.vertexCount !== b.vertexCount) return `${a.vertexCount} vs ${b.vertexCount} vertices`;
  for (let i = 0; i < a.index.length; i++) if (a.index[i] !== b.index[i]) return `index ${i}`;
  for (let i = 0; i < a.position.length; i++) if (a.position[i] !== b.position[i]) return `position ${i}`;
  return null;
}

/** y ranges (m) between the ankle and the hip where no triangle crosses a leg: a hole through the leg */
function emptyLegSlabs(m: MeshData, P: Proportions): string[] {
  const pos = m.position;
  const idx = m.index;
  const STEP = 0.005;
  const y0 = P.ankleH + 0.02;
  const y1 = P.j.thigh_l[1] - 0.05;
  const n = Math.floor((y1 - y0) / STEP);
  const out: string[] = [];
  for (const sd of [1, -1]) {
    const cnt = new Int32Array(n + 1);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const cx = (pos[a] + pos[b] + pos[c]) / 3;
      if (cx * sd < 0.01 || cx * sd > 0.25) continue;
      const ymin = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]);
      const ymax = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
      for (let k = Math.max(0, Math.ceil((ymin - y0) / STEP)); k <= n && y0 + k * STEP <= ymax; k++) cnt[k]++;
    }
    let s = -1;
    for (let k = 0; k <= n + 1; k++) {
      const empty = k <= n && cnt[k] === 0;
      if (empty && s < 0) s = k;
      if (!empty && s >= 0) {
        out.push(`${sd > 0 ? 'left' : 'right'} leg y ${(y0 + s * STEP).toFixed(3)}..${(y0 + (k - 1) * STEP).toFixed(3)}`);
        s = -1;
      }
    }
  }
  return out;
}

const CAL = !!(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.MESHER_CAL;
const cal = (m: string) => CAL && console.log('  [cal]', m);

// ── the Lake-town man: the reported 1.75 m, then the heights around it ───────
{
  // the man exactly as the lab showed it at 1.75 m (the first and only man prepared at this height here)
  const base = kindDef('man')!;
  registerKind('man', { ...base, height: 1.75 });
  const prep = prepareHumanoid({ kind: 'man', seed: 0, armor: 0.5, helmet: true });
  registerKind('man', base); // the other cases below want the real definition back
  const prog = prep.sc.compile();
  const P = prep.P;

  test('man 1.75 m (the reported case): no hole through a leg, the mesh equals the exact one', () => {
    const fast = meshSdf(prog, prep.opts0);
    const exact = meshSdf(prog, { ...prep.opts0, exact: true });
    const holes = emptyLegSlabs(fast, P);
    ok(holes.length === 0, `a leg has an empty slab (a hole): ${holes.join(', ')}`);
    const d = firstDiff(fast, exact);
    ok(d === null, `the mesh must equal the one with every sample evaluated, first difference: ${d}`);
  });

  test('man 1.70-1.82 m in 5 mm steps: no empty leg slab, the mesh equals the exact one', () => {
    for (let h = 1.7; h <= 1.82 + 1e-9; h += 0.005) {
      // lattice phase of a man of height h (see the header); coarse pass only, no AO / attributes: 4x cheaper
      const opts = { res: prep.opts0.res * (1.75 / h), ao: false as const };
      const fast = meshSdf(prog, opts);
      const holes = emptyLegSlabs(fast, P);
      ok(holes.length === 0, `man ${h.toFixed(3)} m: a leg has an empty slab: ${holes.join(', ')}`);
      const d = firstDiff(fast, meshSdf(prog, { ...opts, exact: true }));
      ok(d === null, `man ${h.toFixed(3)} m: the mesh must equal the exact one, first difference: ${d}`);
      cal(`h=${h.toFixed(3)} tris=${fast.triCount} holes=${holes.length} diff=${d}`);
    }
  });
}

// ── the other meshes that came out wrong (partial patches in the knee / thigh band) ──
test('man 1.72, elf 1.84 / 1.86, rohirrim 1.77 / seed 2: the mesh equals the exact one', () => {
  const cases: { kind: HumanoidKind; seed: number }[] = [
    { kind: 'man', seed: 2 }, // 1.72 m
    { kind: 'elf', seed: 0 }, // 1.86 m, the canonical elf
    { kind: 'elf', seed: 3 }, // 1.84 m
    { kind: 'rohirrim', seed: 3 }, // 1.77 m
    // the one of these kinds that the old neighbour seeding (a cached sample of the NEXT block seeding a skip) really got wrong: 6000 triangles
    // against the exact mesh's 5996. The cases above have the right heights but their lattice phases happened to miss it, so only the two man
    // tests above caught a reintroduction (mutation-checked: put `m = floor((ad - skipMargin) / (h * 1.3))` back without the `cached ? 0 :`)
    { kind: 'rohirrim', seed: 2 },
  ];
  for (const c of cases) {
    const prep = prepareHumanoid({ kind: c.kind, seed: c.seed, armor: 0.5, helmet: true });
    const prog = prep.sc.compile();
    const fast = meshSdf(prog, prep.opts0);
    const d = firstDiff(fast, meshSdf(prog, { ...prep.opts0, exact: true }));
    ok(d === null, `${c.kind} seed ${c.seed} (${prep.P.H.toFixed(3)} m): the mesh must equal the exact one, first difference: ${d}`);
    cal(`${c.kind} seed ${c.seed} H=${prep.P.H.toFixed(3)} tris=${fast.triCount} diff=${d}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
