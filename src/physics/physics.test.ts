/**
 * Physics + motor unit tests. Run with:
 *   node src/physics/run-tests.mjs
 * (bundles this file with esbuild and runs it in node — no browser needed)
 */
import * as THREE from 'three';
import { createPhysics } from './world';
import { createMotor, stepMotor, launch, settle } from './motor';

let failed = 0;
let passed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.log('  FAIL:', msg);
  }
}
function near(a: number, b: number, eps: number, msg: string) {
  ok(Math.abs(a - b) <= eps, `${msg} (got ${a.toFixed(4)}, want ${b.toFixed(4)} ±${eps})`);
}
function test(name: string, fn: () => void) {
  const before = failed;
  try {
    fn();
  } catch (e) {
    failed++;
    console.log('  THROW:', (e as Error).stack);
  }
  console.log(failed === before ? `ok   ${name}` : `FAIL ${name}`);
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

test('terrain ground + normal', () => {
  const p = createPhysics();
  p.setTerrain((x) => x * 0.5, 'grass');
  const g = p.ground(2, 0, 10)!;
  near(g.y, 1, 1e-6, 'terrain height');
  ok(g.material === 'grass', 'terrain material');
  near(g.normal.y, 2 / Math.sqrt(5), 1e-3, 'terrain normal y');
  ok(g.normal.x < 0, 'normal leans downhill (-x)');
});

test('box ground respects step-up', () => {
  const p = createPhysics();
  p.addBox(V(0, 0.5, 0), [1, 0.5, 1], 0, { material: 'wood' });
  ok(p.ground(0, 0, 0.2) === null, 'top above step limit is not ground (no terrain)');
  const g = p.ground(0, 0, 0.7)!;
  near(g.y, 1, 1e-6, 'box top');
  ok(g.material === 'wood', 'box material');
  ok(p.ground(1.2, 0, 2) === null, 'outside footprint');
});

test('yawed box footprint', () => {
  const p = createPhysics();
  p.addBox(V(0, 0.5, 0), [2, 0.5, 0.25], Math.PI / 2);
  ok(p.ground(0, 1.8, 2) !== null, 'rotated long axis along z');
  ok(p.ground(1.8, 0, 2) === null, 'short axis along x');
});

test('collide pushes capsule out of box and cylinder', () => {
  const p = createPhysics();
  p.addBox(V(0, 1, 0), [1, 1, 1]);
  const pos = V(1.2, 0, 0);
  ok(p.collide(pos, 0.35, 1.8), 'collided');
  near(pos.x, 1.35, 1e-6, 'pushed to radius');
  const p2 = createPhysics();
  p2.addCylinder(0, 0, 0.5, 0, 3);
  const q = V(0.6, 0, 0);
  p2.collide(q, 0.3, 1.8);
  near(q.x, 0.8, 1e-6, 'cylinder push');
  // step: low box is ignored by collide
  const p3 = createPhysics();
  p3.addBox(V(0, 0.15, 0), [1, 0.15, 1]);
  const r = V(1.1, 0, 0);
  ok(!p3.collide(r, 0.35, 1.8), 'low step not a wall');
  // overhead box ignored
  const p4 = createPhysics();
  p4.addBox(V(0, 3, 0), [1, 0.2, 1]);
  ok(!p4.collide(V(0.5, 0, 0), 0.35, 1.8), 'overhead box not a wall');
});

test('collide with yawed box', () => {
  const p = createPhysics();
  p.addBox(V(0, 1, 0), [1, 1, 1], Math.PI / 4);
  const pos = V(1.3, 0, 0); // corner of a diamond reaches x=1.414
  ok(p.collide(pos, 0.3, 1.8), 'hits rotated box');
  // pushed along the face normal (1,0,1)/√2 or (1,0,-1)/√2; distance from centre along x grows
  ok(Math.hypot(pos.x, pos.z) > 1.3, 'pushed outward');
});

test('raycast box/cyl/terrain with filters', () => {
  const p = createPhysics();
  p.addBox(V(0, 0.5, 0), [1, 0.5, 1], 0, { material: 'wood' });
  const h = p.raycast(V(-5, 0.5, 0), V(1, 0, 0), 100)!;
  near(h.t, 4, 1e-6, 'box t');
  near(h.normal.x, -1, 1e-6, 'box normal');
  ok(h.material === 'wood', 'box material');
  const p2 = createPhysics();
  p2.addBox(V(0, 0.5, 0), [1, 0.5, 1], 0, { blocksArrows: false, blocksCamera: true });
  ok(p2.raycast(V(-5, 0.5, 0), V(1, 0, 0), 100, 'arrows') === null, 'arrows pass');
  ok(p2.raycast(V(-5, 0.5, 0), V(1, 0, 0), 100, 'camera') !== null, 'camera blocked');
  const p3 = createPhysics();
  p3.addCylinder(3, 0, 0.5, 0, 2);
  const c = p3.raycast(V(0, 1, 0), V(1, 0, 0), 10)!;
  near(c.t, 2.5, 1e-6, 'cyl side t');
  const cap = p3.raycast(V(3, 5, 0), V(0, -1, 0), 10)!;
  near(cap.t, 3, 1e-6, 'cyl cap t');
  near(cap.normal.y, 1, 1e-6, 'cap normal');
  const p4 = createPhysics();
  p4.setTerrain(() => 0);
  const d = V(1, -1, 0).normalize();
  const t = p4.raycast(V(0, 10, 0), d, 100)!;
  near(t.point.y, 0, 1e-3, 'terrain hit y');
  near(t.point.x, 10, 1e-2, 'terrain hit x');
  ok(p4.raycast(V(0, 10, 0), d, 5) === null, 'terrain beyond maxDist');
});

test('raycast yawed box normal', () => {
  const p = createPhysics();
  p.addBox(V(0, 1, 0), [2, 1, 0.5], Math.PI / 2); // long axis now along z, thin along x
  const h = p.raycast(V(-5, 1, 0), V(1, 0, 0), 100)!;
  near(h.t, 4.5, 1e-6, 'thin face');
  near(h.normal.x, -1, 1e-6, 'normal -x');
});

test('mesh collider: ground, ramp, walls, raycast', () => {
  const p = createPhysics();
  // floor at y=2 (10×10)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2));
  floor.position.set(0, 2, 0);
  p.addMesh(floor, { material: 'wood' });
  const g = p.ground(1, 1, 2.1)!;
  near(g.y, 2, 1e-4, 'mesh floor');
  ok(g.material === 'wood', 'mesh material');
  ok(p.ground(1, 1, 1.0) === null, 'floor above step from below');
  // wall: vertical plane facing +x at x=8
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 4).rotateY(Math.PI / 2));
  wall.position.set(8, 2, 0);
  p.addMesh(wall);
  const pos = V(7.8, 0, 0);
  ok(p.collide(pos, 0.35, 1.8), 'mesh wall collide');
  ok(Math.abs(pos.x - 8) >= 0.34, `pushed off wall (x=${pos.x.toFixed(3)})`);
  const r = p.raycast(V(0, 1, 0), V(1, 0, 0), 20)!;
  near(r.t, 8, 1e-4, 'mesh raycast t');
  ok(r.object === wall, 'mesh object returned');
  // steep mesh is not ground
  const steep = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2).rotateZ(1.2));
  steep.position.set(-20, 1, 0);
  const p2 = createPhysics();
  p2.addMesh(steep);
  ok(p2.ground(-20, 0, 5) === null, 'steep mesh not walkable');
  // gentle ramp (20°) walkable
  const ramp = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2).rotateZ(0.35));
  const p3 = createPhysics();
  p3.addMesh(ramp);
  const rg = p3.ground(1, 0, 5)!;
  ok(rg !== null && rg.normal.y > 0.9, 'ramp walkable');
});

test('mesh collider setTransform', () => {
  const p = createPhysics();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2));
  floor.position.set(0, 1, 0);
  const h = p.addMesh(floor);
  h.setTransform(V(10, 3, 0), 0);
  ok(p.ground(0, 0, 2) === null, 'moved away from old spot');
  const g = p.ground(10, 0, 3.5)!;
  near(g.y, 3.1, 1e-4, 'new top');
});

test('ceiling', () => {
  const p = createPhysics() as ReturnType<typeof createPhysics>;
  p.addBox(V(0, 3, 0), [1, 0.2, 1]);
  near(p.ceiling(0, 0, 1), 2.8, 1e-6, 'box underside');
  ok(p.ceiling(5, 0, 1) === Infinity, 'open sky');
});

test('motor: fall, land, walk, step up, wall', () => {
  const p = createPhysics();
  p.setTerrain(() => 0);
  p.addBox(V(3, 0.15, 0), [0.5, 0.15, 2]); // 0.3 m step
  p.addBox(V(6, 0.5, 0), [0.5, 0.5, 2]); // 1 m wall (top at 1)
  const pos = V(0, 3, 0);
  const vel = V(0, 0, 0);
  const m = createMotor(pos, vel, 0.35, 1.8);
  let landed = false;
  for (let i = 0; i < 120; i++) if (stepMotor(p, m, 1 / 60).landed) landed = true;
  ok(landed, 'landed');
  ok(m.grounded, 'grounded after fall');
  near(pos.y, 0, 1e-6, 'on terrain');
  vel.set(4, 0, 0);
  for (let i = 0; i < 45; i++) {
    vel.x = 4;
    stepMotor(p, m, 1 / 60);
  }
  // 4 m/s for 0.75 s → x≈3 (on the step: y = 0.3)
  near(pos.x, 3, 0.05, 'walked');
  near(pos.y, 0.3, 1e-6, 'stepped up');
  for (let i = 0; i < 60; i++) {
    vel.x = 4;
    stepMotor(p, m, 1 / 60);
  }
  near(pos.x, 5.5 - 0.35, 1e-3, 'stopped at 1 m wall');
  // jump onto it
  launch(m, 7.5);
  for (let i = 0; i < 60; i++) {
    vel.x = pos.x < 6 ? 3 : 0;
    stepMotor(p, m, 1 / 60);
  }
  near(pos.y, 1, 1e-6, 'jumped onto the wall top');
  ok(m.grounded, 'grounded on wall top');
});

test('motor: steep terrain blocks walking uphill', () => {
  const p = createPhysics();
  p.setTerrain((x) => (x > 2 ? (x - 2) * 2 : 0)); // 63° slope after x=2
  const pos = V(0, 0, 0);
  const vel = V(0, 0, 0);
  const m = createMotor(pos, vel, 0.35, 1.8);
  settle(p, m);
  for (let i = 0; i < 120; i++) {
    vel.x = 5;
    stepMotor(p, m, 1 / 60);
  }
  ok(pos.x < 2.3, `blocked by steep slope (x=${pos.x.toFixed(2)})`);
  ok(pos.y < 0.6, `did not climb (y=${pos.y.toFixed(2)})`);
  // gentle slope is fine
  const p2 = createPhysics();
  p2.setTerrain((x) => x * 0.4);
  const pos2 = V(0, 0, 0);
  const m2 = createMotor(pos2, V(0, 0, 0), 0.35, 1.8);
  settle(p2, m2);
  for (let i = 0; i < 60; i++) {
    m2.vel.x = 5;
    stepMotor(p2, m2, 1 / 60);
  }
  ok(pos2.x > 4.5 && m2.grounded, `walked up gentle slope (x=${pos2.x.toFixed(2)})`);
  near(pos2.y, pos2.x * 0.4, 1e-3, 'glued to slope');
});

test('motor: moving platform carry (velocity and transform delta)', () => {
  const p = createPhysics();
  const plat = p.addBox(V(0, 0.5, 0), [2, 0.5, 2]);
  const pos = V(0, 1, 0);
  const m = createMotor(pos, V(0, 0, 0), 0.35, 1.8);
  settle(p, m);
  ok(m.grounded, 'on platform');
  plat.velocity.set(2, 0, 0);
  const c = V(0, 0.5, 0);
  for (let i = 0; i < 30; i++) {
    c.x += 2 / 60;
    plat.setTransform(c);
    m.vel.x = 0;
    m.vel.z = 0;
    stepMotor(p, m, 1 / 60);
  }
  near(pos.x, 1, 0.05, 'carried by velocity');
  plat.velocity.set(0, 0, 0);
  const x0 = pos.x;
  for (let i = 0; i < 30; i++) {
    c.x += 2 / 60;
    c.y += 0.5 / 60;
    plat.setTransform(c);
    m.vel.x = 0;
    m.vel.z = 0;
    stepMotor(p, m, 1 / 60);
  }
  near(pos.x - x0, 1, 0.05, 'carried by transform delta');
  near(pos.y, c.y + 0.5, 0.02, 'rode up');
  ok(m.grounded, 'still grounded');
});

test('raycast perf sanity (500 colliders)', () => {
  const p = createPhysics();
  p.setTerrain((x, z) => Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2);
  for (let i = 0; i < 500; i++) p.addCylinder((i % 25) * 6 - 75, Math.floor(i / 25) * 6 - 60, 0.4, -1, 8);
  const t0 = performance.now();
  let hits = 0;
  const d = V(0, 0, 0);
  for (let i = 0; i < 2000; i++) {
    d.set(Math.cos(i), -0.05, Math.sin(i)).normalize();
    if (p.raycast(V(0, 1.6, 0), d, 80, 'arrows')) hits++;
  }
  const ms = performance.now() - t0;
  console.log(`     2000 rays: ${ms.toFixed(1)} ms, ${hits} hits`);
  ok(ms < 1500, 'fast enough');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
