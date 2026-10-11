/**
 * Finishing-pass unit tests (node, no browser): shared-code fixes the chapters worked around.
 * Run with: node src/physics/run-tests.mjs
 */
import * as THREE from 'three';
import type { AudioSys, GameContext, Hud, PlayerStats, Speaker } from '../core/types';
import { moveArrived } from '../actors/npc';
import { applyModifiers } from '../actors/modifiers';
import { createPhysics, surfaceFriction } from '../physics/world';
import { createMotor, settle, stepMotor } from '../physics/motor';
import { banterFor, createRivalry } from './rivalry';
import { createRegistry } from '../combat/registry';
import { leadAim } from './bot';
import { characterLightIntensity } from './cinelight';
import { createCrowd, tickCrowds } from '../world/crowd';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const near = (a: number, b: number, e: number, m: string) => ok(Math.abs(a - b) <= e, `${m} (got ${a.toFixed(4)}, want ${b.toFixed(4)} ±${e})`);
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
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ── 2. moveTarget arrival ─────────────────────────────────────────────────────
test('moveArrived: horizontal radius with a stair tolerance', () => {
  ok(moveArrived(V(0, 1.4, 0.5), V(0, 0, 0)), 'on a tread 1.4 m above a floor-level waypoint counts as arrived');
  ok(!moveArrived(V(0, 0, 1.2), V(0, 0, 0)), '1.2 m away horizontally is not arrived');
  ok(!moveArrived(V(0, 3, 0), V(0, 0, 0)), 'a floor above is not arrived');
  ok(moveArrived(V(1.4, 0, 0), V(0, 0, 0), 1.5), 'custom radius');
});

// ── 3. stat modifiers ─────────────────────────────────────────────────────────
test('applyModifiers stacks multiplicatively and leaves the base alone', () => {
  const base: PlayerStats = { maxHp: 100, drawTime: 0.55, arrowDamage: 34, knifeDamage: 22, moveSpeed: 6.5, dashCooldown: 0.7, focusMax: 100, focusTargets: 4, damageTakenMul: 1, regen: 3 };
  const s = applyModifiers(base, [{ moveSpeedMul: 0.5, duration: 2 }, { moveSpeedMul: 0.8, damageTakenMul: 1.5, duration: 1 }]);
  near(s.moveSpeed, 6.5 * 0.4, 1e-9, 'move speed');
  near(s.damageTakenMul, 1.5, 1e-9, 'damage taken');
  near(base.moveSpeed, 6.5, 1e-9, 'base untouched');
  ok(applyModifiers(base, []) === base, 'no modifiers: same object');
});

// ── 6. friction ───────────────────────────────────────────────────────────────
test('friction: ice colliders and terrain report low grip, explicit friction wins', () => {
  ok(surfaceFriction('ice') < 0.5 && surfaceFriction('stone') === 1, 'material defaults');
  const p = createPhysics();
  p.setTerrain(() => 0, 'grass');
  near(p.ground(0, 0, 1)!.friction ?? 1, 1, 1e-9, 'grass terrain grips');
  p.addBox(V(5, 0.5, 0), [1, 0.5, 1], 0, { material: 'ice' });
  near(p.ground(5, 0, 2)!.friction ?? 1, 0.3, 1e-9, 'ice box defaults to 0.3');
  p.addBox(V(10, 0.5, 0), [1, 0.5, 1], 0, { material: 'ice', friction: 0.8 });
  near(p.ground(10, 0, 2)!.friction ?? 1, 0.8, 1e-9, 'explicit friction');
  p.setTerrain(() => 0, 'ice');
  near(p.ground(0, 0, 1)!.friction ?? 1, 0.3, 1e-9, 'ice terrain');
  p.setTerrain(() => 0, 'ice', 0.6);
  near(p.ground(0, 0, 1)!.friction ?? 1, 0.6, 1e-9, 'terrain friction override');
  const pos = V(5, 1, 0);
  const m = createMotor(pos, new THREE.Vector3(), 0.3, 1.8);
  settle(p, m, 2);
  stepMotor(p, m, 1 / 60);
  near(m.groundFriction, 0.3, 1e-9, 'motor carries the ground friction');
});

// ── 10. rivalry ───────────────────────────────────────────────────────────────
function rivalryCtx(lines: { who: Speaker; text: string }[]): GameContext {
  const audio = new Proxy({}, { get: () => () => {} }) as AudioSys;
  const hud = new Proxy({}, { get: (_t, k) => (k === 'subtitle' ? (who: Speaker, text: string) => lines.push({ who, text }) : () => {}) }) as Hud;
  return { audio, hud, combatants: createRegistry() } as unknown as GameContext;
}

test('banterFor: spoken numbers match the HUD, first-kill lines use chapter counts', () => {
  const a = banterFor('gimli', { legolas: 30, gimli: 31 }, { legolas: 0, gimli: 1 }, 'legolas', false);
  ok(!!a && a.text.startsWith('Thirty-one'), `lead change speaks the HUD count (${a?.text})`);
  const b = banterFor('gimli', { legolas: 30, gimli: 37 }, { legolas: 0, gimli: 1 }, 'gimli', true);
  ok(!!b && b.text === `Thirty-seven! That's one more for the count!`, `first chapter kill on a carried count (${b?.text})`);
  const c = banterFor('legolas', { legolas: 32, gimli: 33 }, { legolas: 2, gimli: 1 }, 'gimli', false);
  ok(!!c && c.text === 'Thirty-two already, Gimli.', `"already" uses the HUD number (${c?.text})`);
  const d = banterFor('legolas', { legolas: 2, gimli: 31 }, { legolas: 2, gimli: 1 }, 'gimli', false);
  ok(!!d && d.text === 'Two already, Gimli.', `fresh save keeps the classic line (${d?.text})`);
});

test('rivalry: opening wager waits for the first scripted line, banter waits for cinematics', () => {
  const lines: { who: Speaker; text: string }[] = [];
  const r = createRivalry(rivalryCtx(lines));
  r.start({ legolas: 10, gimli: 12 });
  for (let i = 0; i < 60; i++) r.update(1 / 60); // 1 s: the old 1.2 s delay has not passed yet
  r.noteScriptLine(3); // the chapter's first line ends in 3 s
  for (let i = 0; i < 150; i++) r.update(1 / 60); // 3.5 s total
  ok(lines.length === 0, 'opening held until the chapter line is over');
  for (let i = 0; i < 90; i++) r.update(1 / 60);
  ok(lines.length === 1 && lines[0].text.startsWith(`I'm on Twelve`), `opening after the line (${lines[0]?.text})`);
  ok(r.chapterCounts().legolas === 0 && r.chapterCounts().gimli === 0, 'chapter counts start at 0');

  // a lead change during a cinematic is delivered after it
  r.hold = true;
  for (let i = 0; i < 400; i++) r.update(1 / 60); // banter gap
  r.addLegolas(3);
  for (let i = 0; i < 300; i++) r.update(1 / 60);
  ok(lines.length === 1, 'nothing said during the cinematic');
  r.hold = false;
  for (let i = 0; i < 60; i++) r.update(1 / 60);
  ok(lines.length === 2, `held line delivered after the cinematic (${lines[1]?.text})`);
  ok(r.chapterCounts().legolas === 3, 'chapter-local count');
});

test('rivalry: the opening plays anyway when the chapter says nothing', () => {
  const lines: { who: Speaker; text: string }[] = [];
  const r = createRivalry(rivalryCtx(lines));
  r.start();
  for (let i = 0; i < 60 * 8; i++) r.update(1 / 60);
  ok(lines.length === 1 && lines[0].text.startsWith('A friendly wager'), 'opening after the max wait');
});

// ── 12. bot lead ──────────────────────────────────────────────────────────────
test('leadAim: aims ahead of a moving target', () => {
  const out = new THREE.Vector3();
  leadAim(V(0, 1.5, 0), V(0, 1.5, 36), V(6, 0, 0), 72, out);
  near(out.x, 3, 0.1, 'leads by ~0.5 s of flight');
  near(out.y, 1.5, 1e-9, 'no vertical lead');
});

// ── 11. character light ───────────────────────────────────────────────────────
test('characterLightIntensity follows the environment and clamps', () => {
  const day = characterLightIntensity({ sunIntensity: 3.6, hemiIntensity: 0.2 });
  const night = characterLightIntensity({ sunIntensity: 1.0, hemiIntensity: 0.5 });
  ok(day > night && night >= 2 && day <= 16, `day ${day.toFixed(2)} > night ${night.toFixed(2)}`);
  ok(characterLightIntensity({ sunIntensity: 3, hemiIntensity: 1 }, 0) === 0, 'intensity 0 = off');
});

// ── 8. crowds ─────────────────────────────────────────────────────────────────
test('crowd: real bounds, culled, game-time clock, hand-set spheres respected', () => {
  const scene = new THREE.Scene();
  const c = createCrowd({ center: V(100, 0, 50), halfSize: [20, 10], count: 120, kind: 'orc', speed: 0 }, () => 2);
  scene.add(c.mesh);
  const meshes: THREE.InstancedMesh[] = [];
  c.mesh.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh);
  });
  ok(meshes.length > 0, 'has instanced meshes');
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let inside = true;
  for (const m of meshes) {
    ok(m.frustumCulled, `${m.name} culled`);
    const s = m.boundingSphere!;
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, m4);
      p.setFromMatrixPosition(m4);
      if (s.center.distanceTo(p) > s.radius - 1) inside = false;
    }
  }
  ok(inside, 'every figure inside its sphere');
  // marching: the sphere follows, a hand-set sphere is left alone
  const hand = new THREE.Sphere(V(0, 0, 0), 5);
  meshes[0].boundingSphere = hand;
  const auto = meshes[meshes.length - 1];
  const before = auto.boundingSphere!.center.clone();
  c.setSpeed(4);
  for (let i = 0; i < 300; i++) tickCrowds(1 / 60); // 5 s at 4 m/s (facing +z)
  ok(meshes[0].boundingSphere === hand && hand.radius === 5 && hand.center.lengthSq() === 0, 'hand-set sphere untouched');
  if (auto !== meshes[0]) ok(auto.boundingSphere!.center.z - before.z > 15, `auto sphere followed the march (${(auto.boundingSphere!.center.z - before.z).toFixed(1)} m)`);
  c.dispose();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
