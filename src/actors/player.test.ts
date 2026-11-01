/**
 * Player feel tests (node, no browser): drives the real Player with a stub context.
 * The player pulls in the humanoid registry (import.meta.glob), so these run through their own
 * runner:  node src/actors/run-player-test.mjs   (also run by `npm run smoke` is NOT assumed)
 */
import * as THREE from 'three';
import type { Combatant, GameContext, InputState, PlayerAPI } from '../core/types';
import { createPhysics } from '../physics/world';
import { createRegistry } from '../combat/registry';
import { createPlayer } from './player';

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

// ── 13. player input feel (sprint, dash buffer, draw cancel, knife targets, assist) ──
interface PlayerHarness {
  player: PlayerAPI;
  ctx: GameContext;
  plays: string[];
  inp: InputState;
  fired: { dir: THREE.Vector3 }[];
  tick: (dt?: number, n?: number) => void;
}
function neutralInput(): InputState {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, aimHeld: false, drawHeld: false, drawReleased: false, melee: false, jump: false, dash: false,
    interact: false, nextArrow: false, pause: false, arrowSlot: 0, focusHeld: false, focusPressed: false, focusReleased: false, sprintHeld: false, device: 'kbm',
  };
}
function playerHarness(): PlayerHarness {
  const physics = createPhysics();
  physics.setTerrain(() => 0, 'stone');
  const noop = new Proxy({}, { get: () => () => {} });
  const plays: string[] = [];
  const audio = new Proxy({}, { get: (_t, k) => (k === 'play' ? (n: string) => plays.push(n) : () => {}) });
  const inp = neutralInput();
  const fired: { dir: THREE.Vector3 }[] = [];
  const time = { scale: 1, real: 0, setScale() {}, hitStop() {} };
  const engine = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    canvas: { clientWidth: 1280, clientHeight: 720 },
    post: { damageFlash: 0, focusTint: 0 },
    shadowFocus: new THREE.Vector3(),
  };
  const ctx = {
    physics, engine, time, combatants: createRegistry(),
    audio, hud: noop, fx: noop,
    input: { state: inp, enabled: true, rumble() {} },
    projectiles: { fire: (s: { dir: THREE.Vector3 }) => fired.push({ dir: s.dir.clone() }) },
    settings: { aimAssist: false }, flags: {}, progression: { unlockedArrows: () => ['standard', 'piercing', 'triple'] },
  } as unknown as GameContext;
  const player = createPlayer(ctx);
  player.teleport(V(0, 0.05, 0), 0);
  const tick = (dt = 1 / 60, n = 1) => {
    for (let i = 0; i < n; i++) {
      time.real += dt;
      player.update(dt);
    }
  };
  tick(1 / 60, 10);
  return { player, ctx, plays, inp, fired, tick };
}

const hspeed = (p: PlayerAPI) => Math.hypot(p.velocity.x, p.velocity.z);

test('sprint: any direction but dominantly backward; latched through a jump', () => {
  const h = playerHarness();
  h.inp.moveX = 1; // pure strafe (moveY 0)
  h.inp.sprintHeld = true;
  h.tick(1 / 60, 90);
  near(hspeed(h.player), 9, 0.2, 'Shift+D sprints at 9 m/s');
  // jump while sprinting: the speed and the camera blend hold through the air
  h.inp.jump = true;
  h.tick(1 / 60, 1);
  h.inp.jump = false;
  let minAir = 99;
  let minBlend = 99;
  for (let i = 0; i < 20 && !h.player.grounded; i++) {
    h.tick(1 / 60, 1);
    if (!h.player.grounded) {
      minAir = Math.min(minAir, hspeed(h.player));
      minBlend = Math.min(minBlend, (h.player as unknown as { sprintBlend: number }).sprintBlend);
    }
  }
  ok(minAir > 8.6, `sprint jump keeps its speed (min ${minAir.toFixed(2)})`);
  ok(minBlend > 0.9, `camera sprint blend holds in the air (min ${minBlend.toFixed(2)})`);
  const b = playerHarness();
  b.inp.moveY = -1;
  b.inp.sprintHeld = true;
  b.tick(1 / 60, 90);
  near(hspeed(b.player), 6.5, 0.2, 'Shift+S does not sprint');
});

test('dash is buffered through the cooldown and the stagger', () => {
  const h = playerHarness();
  h.inp.moveY = 1;
  const dashes = () => h.plays.filter((n) => n === 'dash').length;
  h.inp.dash = true;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  ok(dashes() === 1, 'first dash');
  h.tick(1 / 60, 30); // 0.5 s in: 0.2 s of cooldown left
  h.inp.dash = true;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  ok(dashes() === 1, 'a press in the cooldown does not dash at once');
  h.tick(1 / 60, 14); // the cooldown (0.7 s) ends 0.18 s after the press: outside the 0.15 s buffer
  ok(dashes() === 1, 'a press far out of the window is dropped');
  h.tick(1 / 60, 60);
  h.inp.dash = true;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  ok(dashes() === 2, 'a ready dash fires');
  h.tick(1 / 60, 50); // 0.83 s later: cooldown (0.7 s) is over; arm a fresh one
  h.inp.dash = true;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  h.tick(1 / 60, 35); // 0.6 s: 0.1 s of cooldown left
  h.inp.dash = true;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  h.tick(1 / 60, 10); // cooldown ends within 0.15 s of the press
  ok(dashes() === 4, `a press just before the cooldown ends fires when it does (${dashes()})`);
});

test('a draw cut off by pause or a cinematic is cancelled, not loosed', () => {
  const h = playerHarness();
  h.inp.drawHeld = true;
  h.tick(1 / 60, 20);
  ok(h.player.drawCharge > 0, 'drawing');
  h.player.cancelDraw?.(); // game.pause()
  h.inp.drawHeld = false; // resume: input was zeroed
  h.tick(1 / 60, 5);
  ok(h.fired.length === 0 && h.player.drawCharge === 0, 'pause: no arrow on resume');
  h.inp.drawHeld = true;
  h.tick(1 / 60, 20);
  h.player.controlsEnabled = false; // level.cinematic(true)
  h.tick(1 / 60, 5);
  ok(h.fired.length === 0, 'cinematic start: no arrow');
  h.player.controlsEnabled = true;
  h.inp.drawHeld = false;
  h.tick(1 / 60, 5);
  ok(h.fired.length === 0, 'releasing after the cinematic does not shoot');
  // a normal release still shoots
  h.inp.drawHeld = true;
  h.tick(1 / 60, 20);
  h.inp.drawHeld = false;
  h.inp.drawReleased = true;
  h.tick(1 / 60, 1);
  h.inp.drawReleased = false;
  ok(h.fired.length === 1, 'a real release looses');
});

test('a click inside the nock window still fires', () => {
  const h = playerHarness();
  h.inp.drawHeld = true;
  h.tick(1 / 60, 20);
  h.inp.drawHeld = false;
  h.inp.drawReleased = true;
  h.tick(1 / 60, 1);
  h.inp.drawReleased = false;
  ok(h.fired.length === 1, 'first shot');
  h.tick(1 / 60, 3); // 0.05 s into the 0.16 s nock
  h.inp.drawHeld = true; // a quick click: down and up inside the nock
  h.tick(1 / 60, 2);
  h.inp.drawHeld = false;
  h.tick(1 / 60, 30);
  ok(h.fired.length === 2, `buffered click quick-shoots (${h.fired.length})`);
});

test('prevArrow cycles arrow types backwards', () => {
  const h = playerHarness();
  ok(h.player.arrowType === 'standard', 'starts standard');
  (h.inp as { prevArrow?: boolean }).prevArrow = true;
  h.tick(1 / 60, 1);
  (h.inp as { prevArrow?: boolean }).prevArrow = false;
  ok(h.player.arrowType === 'triple', `back wraps to the last type (${h.player.arrowType})`);
  h.inp.nextArrow = true;
  h.tick(1 / 60, 1);
  h.inp.nextArrow = false;
  ok(h.player.arrowType === 'standard', `forward still works (${h.player.arrowType})`);
});

test('knife swing strikes the nearest foes, not the first three in registry order', () => {
  const h = playerHarness();
  const hurt: string[] = [];
  const mk = (name: string, x: number, z: number): Combatant => {
    const position = V(x, 0, z);
    return {
      id: 900 + hurt.length + Math.floor(Math.random() * 1e6), team: 'enemy', name, object: new THREE.Object3D(), position, velocity: V(0, 0, 0), radius: 0.4, height: 1.8,
      hp: 100, maxHp: 100, alive: true, targetable: true,
      aimPoint: (o: THREE.Vector3) => o.set(x, 1.2, z),
      raycast: () => null,
      takeDamage: () => hurt.push(name),
      update() {}, dispose() {},
    } as unknown as Combatant;
  };
  // registry order: four far-ish foes first, the one right in front last
  for (const [n, x, z] of [['a', -0.9, 1.4], ['b', 0.9, 1.4], ['c', -0.6, 1.8], ['d', 0.6, 1.8], ['front', 0, 1.1]] as [string, number, number][]) h.ctx.combatants.add(mk(n, x, z));
  h.inp.melee = true;
  h.tick(1 / 60, 1);
  h.inp.melee = false;
  h.tick(1 / 60, 40);
  ok(hurt.length === 3, `three struck (${hurt.join(',')})`);
  ok(hurt.includes('front'), `the target in front is struck (${hurt.join(',')})`);
});

test('a jump press with both jumps spent does not cancel an air dash', () => {
  const h = playerHarness();
  h.inp.jump = true;
  h.tick(1 / 60, 1); // jump
  h.inp.jump = false;
  h.tick(1 / 60, 5);
  h.inp.jump = true;
  h.tick(1 / 60, 1); // elven leap: both jumps spent
  h.inp.jump = false;
  h.tick(1 / 60, 8);
  ok(!h.player.grounded, 'airborne with both jumps spent');
  h.inp.moveY = 1;
  h.inp.dash = true;
  const x0 = h.player.position.z;
  h.tick(1 / 60, 1);
  h.inp.dash = false;
  h.tick(1 / 60, 5); // 0.1 s into the dash
  h.inp.jump = true; // a stale / habitual press: no jump is left
  h.tick(1 / 60, 1);
  h.inp.jump = false;
  h.tick(1 / 60, 8);
  ok(h.player.position.z - x0 > 5, `the dash covers its distance (${(h.player.position.z - x0).toFixed(2)} m)`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
