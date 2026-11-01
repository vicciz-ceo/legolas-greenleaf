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


// Held-prop sizes are tuned per kind (scaleHeldWeapon, sockets): shapes and materials may change, the grip
// origin, end-to-end length, tip and long axis may not. Boxes recorded from the shipped props.
{
  const near = (a: number, b: number, e: number, m: string) => ok(Math.abs(a - b) <= e, `${m} (got ${a.toFixed(3)}, want ${b.toFixed(3)} +-${e})`);
  const check = (name: string, kind: Parameters<typeof createWeapon>[0], style: WeaponStyle, min: number[], max: number[], tip: number) => {
    const w = createWeapon(kind, 1, style);
    const box = new THREE.Box3();
    for (const v of vertices(w)) box.expandByPoint(v);
    const t = w.userData.tip as THREE.Object3D | undefined;
    near(box.min.y, min[1], 0.02, `${name} butt y`);
    near(box.max.y, max[1], 0.025, `${name} top y`);
    near(box.max.x, max[0], 0.03, `${name} +x`);
    near(box.min.x, min[0], 0.03, `${name} -x`);
    ok(box.max.z <= max[2] + 0.03 && box.min.z >= min[2] - 0.03, `${name} depth ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}`);
    ok(!!t, `${name} has a tip object`);
    if (t) near(t.position.y, tip, 0.012, `${name} tip y`);
  };
  check('club', 'club', 'default', [-0.23, -0.24, -0.23], [0.23, 0.88, 0.23], 0.87);
  check('warhammer', 'warhammer', 'default', [-0.315, -0.17, -0.182], [0.315, 0.84, 0.182], 0.85);
  check('cleaver', 'cleaver', 'orc', [-0.119, -0.19, -0.027], [0.115, 0.66, 0.028], 0.66);
  check('gimli axe', 'dwarf_axe', 'gimli', [-0.301, -0.425, -0.047], [0.301, 0.762, 0.047], 0.74);
  check('rohan shield', 'shield', 'rohan', [-0.014, -0.463, -0.463], [0.143, 0.463, 0.463], 0.45);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
