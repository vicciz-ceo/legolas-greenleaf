/**
 * Boromir tests (node, no browser). The captain look of the 'gondor' kind (hair, beard, cloak, Horn, and the fine
 * face region of KindDef.bucketDetail) belongs to seed bucket 0, so a named Boromir has to be built there, and no
 * crowd soldier should be.
 * Run with: node src/physics/run-tests.mjs
 */
import * as THREE from 'three';
import { hashSeed } from '../../core/rng';
import { createHumanoid, type HumanoidExt } from '../../creatures/humanoid';
import { humanoidKey } from '../../creatures/humanoid/build';
import { BOROMIR, soldierSeed } from '../../creatures/humanoid/kinds/elves_men';
import { bucketOf } from '../../creatures/humanoid/kinds/elves_men/common';
import { subjects } from './amon_hen/amon_hen.lab';
import { makeBoromirBody } from './amon_hen/cast';
import { L as BLACK_GATE } from './black_gate/layout';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const test = async (n: string, f: () => void | Promise<void>) => {
  const b = failed;
  try {
    await f();
  } catch (e) {
    failed++;
    console.log('  THROW', (e as Error).stack);
  }
  console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n);
};

/** the first mesh called 'body' under a humanoid: its geometry is the shared, cached LOD0 asset */
function bodyGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!found && m.isMesh && m.name === 'body') found = m.geometry;
  });
  return found;
}

await test('Amon Hen: the chapter builds Boromir as the bucket-0 captain, not the old seed-11 soldier', () => {
  ok(bucketOf(BOROMIR.seed) === 0, 'BOROMIR itself is seed bucket 0');
  const oldSeed11 = { kind: 'gondor', seed: 11, weapon: 'sword', offhand: 'shield', helmet: false } as const;
  ok(bucketOf(oldSeed11.seed) === 1, 'the seed 11 this used to pass hashes into bucket 1 (a soldier)');

  const h = makeBoromirBody() as HumanoidExt;
  ok(h.assets.key === humanoidKey(BOROMIR), `the body is the BOROMIR asset (key ${h.assets.key})`);
  ok(h.assets.key.split('|')[1] === '0', `seed bucket 0 (key ${h.assets.key})`);
  ok(h.assets.key !== humanoidKey(oldSeed11), 'not the asset the seed-11 build used');

  // the fine face region (bucketDetail) is what a named hero gets and a crowd soldier does not
  const soldier = createHumanoid({ kind: 'gondor', seed: soldierSeed(0), weapon: 'sword', offhand: 'shield', helmet: false }) as HumanoidExt;
  ok(bucketOf(soldierSeed(0)) !== 0, 'soldierSeed avoids the captain bucket');
  ok(h.triangles > soldier.triangles * 1.5, `the captain carries the face detail (${h.triangles} vs ${soldier.triangles} triangles)`);
  h.dispose();
  soldier.dispose();
});

await test("Amon Hen lab: 'amon_boromir' shows the same build as the chapter", async () => {
  const subject = subjects.find((s) => s.name === 'amon_boromir');
  ok(!!subject, "the subject 'amon_boromir' exists");
  if (!subject) return;
  const inst = await subject.create();
  const chapter = makeBoromirBody();
  const labGeo = bodyGeometry(inst.object);
  ok(labGeo !== null && labGeo === bodyGeometry(chapter.root), 'the lab body is the chapter body (one cached asset)');
  inst.dispose?.();
  chapter.dispose();
});

await test('Black Gate: none of the Gondor allies is a seed-bucket-0 captain', () => {
  // spawnSoldiers spawns them hash-seeded by kind and position (src/actors/ally.ts: hashSeed('ally', kind, x, z) at
  // 0.1 m): one that lands in bucket 0 would wear Boromir's face and carry his heavier mesh. If a stand moves and
  // this fails, nudge it a decimetre or two.
  for (const p of BLACK_GATE.gondor) {
    const seed = hashSeed('ally', 'gondor', p.x.toFixed(1), p.z.toFixed(1));
    ok(bucketOf(seed) !== 0, `the Gondor stand at (${p.x}, ${p.z}) is bucket ${bucketOf(seed)}, not the captain's`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
