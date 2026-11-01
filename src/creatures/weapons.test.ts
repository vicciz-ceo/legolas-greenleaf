/**
 * Weapon unit tests (node, no browser). Run with: node src/physics/run-tests.mjs
 *
 * The elven knives are stowed blade-down in Legolas' quiver sheaths (legolas.ts, gear.ts) and Tauriel's
 * hip scabbards (elves_men/detail.ts): the blade must stay short and slim enough to sit inside them.
 */
import * as THREE from 'three';
import { createWeapon, type WeaponStyle } from './weapons';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};

function vertices(o: THREE.Object3D): THREE.Vector3[] {
  o.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
  });
  return out;
}

for (const style of ['default', 'elven'] as WeaponStyle[]) {
  for (let seed = 0; seed < 8; seed++) {
    const knife = createWeapon('elven_knives', seed, style);
    const v = vertices(knife);
    const tip = Math.max(...v.map((p) => p.y));
    // the blade proper: below the guard wings (which sit over the sheath mouth)
    const blade = v.filter((p) => p.y > 0.09);
    const lateral = Math.max(...blade.map((p) => Math.hypot(p.x, p.z)));
    ok(tip <= 0.33, `knife ${style}/${seed}: tip ${tip.toFixed(3)} m from the grip must be <= 0.33`);
    ok(lateral <= 0.015, `knife ${style}/${seed}: blade lateral offset ${lateral.toFixed(4)} m must be <= 0.015`);
    ok(blade.length > 20, `knife ${style}/${seed}: blade vertices found`);
  }
}

// Pike: about 3 m end to end with the tip ~2.8 m ahead of the hand (enemy.ts gives uruk_pike reach 3.2)
{
  const v = vertices(createWeapon('pike', 1));
  const tip = Math.max(...v.map((p) => p.y)), butt = Math.min(...v.map((p) => p.y));
  ok(tip > 2.6 && tip < 2.9, `pike tip ${tip.toFixed(2)} m ahead of the hand`);
  ok(tip - butt > 2.9 && tip - butt < 3.1, `pike length ${(tip - butt).toFixed(2)} m`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
