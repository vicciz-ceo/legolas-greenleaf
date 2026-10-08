/**
 * Combat unit tests (node, no browser): aim math, combatant zone raycasts, registry kill
 * reporting, projectiles (hits, piercing, homing, sticking), rivalry rubber band.
 * Run with: node src/physics/run-tests.mjs
 */
import * as THREE from 'three';
import type { AudioSys, Combatant, Fx, FxHandle, GameContext, Hud, Team } from '../core/types';
import { ARROW_GRAVITY, ballisticDir, leadTarget, spreadDir, angleBetween } from './aim';
import { BaseCombatant, rayCapsule, rayDisc, raySphere } from '../actors/combatant';
import { createRegistry } from './registry';
import { createProjectiles, type ProjectilesExt } from './projectiles';
import { createPhysics } from '../physics/world';
import { createRivalry, gimliTarget, numberWord } from '../game/rivalry';
import { attackTokenCount, releaseAttackToken, requestAttackToken, resetCombatQueues } from '../actors/npc';

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

/** a 1.8 m dummy with a "head" bone sphere and a torso capsule */
class Dummy extends BaseCombatant {
  headBone = new THREE.Object3D();
  hips = new THREE.Object3D();
  neck = new THREE.Object3D();
  constructor(team: Team, pos: THREE.Vector3, hp = 100) {
    super({ team, name: 'dummy', maxHp: hp, height: 1.8, radius: 0.3 });
    this.object.position.copy(pos);
    this.hips.position.set(0, 0.95, 0);
    this.neck.position.set(0, 1.5, 0);
    this.headBone.position.set(0, 1.62, 0);
    this.object.add(this.hips, this.neck, this.headBone);
    this.addZoneSphere(this.headBone, 0.12, 'head');
    this.addZoneCapsule(this.hips, this.neck, 0.17, 'body');
    this.aimBone = this.neck;
  }
  update(dt: number) {
    this.afterAnimate();
    this.updateDeath(dt);
  }
}

function fakeCtx(): GameContext {
  const handle = (): FxHandle => ({ position: new THREE.Vector3(), setIntensity() {}, stop() {} });
  const fx = new Proxy({}, { get: (_t, k) => (k === 'trail' || k === 'fire' || k === 'smoke' || k === 'torch' ? handle : () => {}) }) as Fx;
  const audio = new Proxy({}, { get: () => () => {} }) as AudioSys;
  const hud = new Proxy({}, { get: () => () => {} }) as Hud;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, -3);
  const ctx = {
    engine: { scene, camera, levelRoot: new THREE.Group(), canvas: { clientWidth: 1280, clientHeight: 720 }, post: { focusTint: 0, damageFlash: 0 } },
    fx,
    audio,
    hud,
    physics: createPhysics(),
    combatants: createRegistry(),
    time: { t: 0, real: 0, scale: 1, setScale() {}, hitStop() {} },
  } as unknown as GameContext;
  return ctx;
}

test('ballisticDir hits the target point', () => {
  const from = V(0, 1.5, 0);
  const to = V(3, 2, 40);
  const d = ballisticDir(from, to, 60, ARROW_GRAVITY, new THREE.Vector3());
  // integrate
  const p = from.clone();
  const v = d.clone().multiplyScalar(60);
  let best = Infinity;
  for (let i = 0; i < 2000; i++) {
    v.y -= ARROW_GRAVITY / 1000;
    p.addScaledVector(v, 1 / 1000);
    best = Math.min(best, p.distanceTo(to));
  }
  ok(best < 0.05, `passes within 5 cm (${best.toFixed(3)})`);
  ok(d.y > (to.y - from.y) / from.distanceTo(to), 'lofted above the straight line');
});

test('leadTarget predicts intercept', () => {
  const from = V(0, 0, 0);
  const pos = V(0, 0, 30);
  const vel = V(5, 0, 0);
  const out = leadTarget(from, pos, vel, 35, new THREE.Vector3());
  // arrow reaches out at t = |out|/35, the target is there at the same t
  const t = out.length() / 35;
  near(out.x, 5 * t, 0.05, 'lead x');
});

test('spreadDir stays inside the cone', () => {
  const d = V(0, 0, 1);
  let max = 0;
  for (let i = 0; i < 200; i++) max = Math.max(max, angleBetween(d, spreadDir(d, 0.05, Math.random(), Math.random(), new THREE.Vector3())));
  ok(max <= 0.0501 && max > 0.03, `max angle ${max.toFixed(4)}`);
});

test('ray primitives', () => {
  near(raySphere(V(0, 0, -5), V(0, 0, 1), V(0, 0, 0), 1), 4, 1e-9, 'sphere');
  ok(raySphere(V(0, 2, -5), V(0, 0, 1), V(0, 0, 0), 1) < 0, 'sphere miss');
  near(rayCapsule(V(-5, 1, 0), V(1, 0, 0), V(0, 0, 0), V(0, 2, 0), 0.5), 4.5, 1e-9, 'capsule side');
  near(rayCapsule(V(0, 5, 0), V(0, -1, 0), V(0, 0, 0), V(0, 2, 0), 0.5), 2.5, 1e-9, 'capsule cap (parallel)');
  ok(rayCapsule(V(-5, 3, 0), V(1, 0, 0), V(0, 0, 0), V(0, 2, 0), 0.5) < 0, 'capsule miss above');
  near(rayDisc(V(0, 0, -5), V(0, 0, 1), V(0, 0, 0), V(0, 0, 1), 0.4), 5, 1e-9, 'disc face-on');
  near(rayDisc(V(0, 0, 5), V(0, 0, -1), V(0, 0, 0), V(0, 0, 1), 0.4), 5, 1e-9, 'disc from behind');
  ok(rayDisc(V(0.5, 0, -5), V(0, 0, 1), V(0, 0, 0), V(0, 0, 1), 0.4) < 0, 'disc miss outside radius');
  ok(rayDisc(V(0, 0, -5), V(1, 0, 0), V(0, 0, 0), V(0, 0, 1), 0.4) < 0, 'disc edge-on parallel');
});

test('combatant zones: head vs body multiplier, attach bone', () => {
  const d = new Dummy('enemy', V(0, 0, 10));
  const head = d.raycast(V(0, 1.7, 0), V(0, 0, 1), 50)!;
  ok(head && head.zone === 'head' && head.multiplier === 2.5, 'head zone x2.5');
  ok(head.attach === d.headBone, 'attach head bone');
  const body = d.raycast(V(0, 1.2, 0), V(0, 0, 1), 50)!;
  ok(body && body.zone === 'body' && body.multiplier === 1, 'body zone');
  near(body.t, 10 - 0.17, 1e-6, 'body t');
  ok(d.raycast(V(1, 1.2, 0), V(0, 0, 1), 50) === null, 'miss to the side');
});

test('shield disc zone blocks and returns armour', () => {
  const d = new Dummy('enemy', V(0, 0, 10));
  const shield = new THREE.Object3D();
  shield.position.set(0, 1.2, -0.4); // in front of the chest (dummy faces -Z toward the shooter)
  d.object.add(shield);
  d.addZoneDisc(shield, 0.35, new THREE.Vector3(0, 0, 1), 'armor');
  const h = d.raycast(V(0, 1.2, 0), V(0, 0, 1), 50)!;
  ok(h.zone === 'armor' && Math.abs(h.multiplier - 0.3) < 1e-9, 'armour x0.3');
  near(h.t, 9.6, 1e-6, 'hits the disc first');
  ok(h.normal!.z < -0.99, 'normal faces the shooter');
  const head = d.raycast(V(0, 1.7, 0), V(0, 0, 1), 50)!;
  ok(head.zone === 'head', 'head above the shield');
});

test('registry: onKill once, tally of dead, expiry removes', () => {
  const reg = createRegistry();
  const a = new Dummy('enemy', V(0, 0, 0), 10);
  const killer = new Dummy('player', V(0, 0, -5));
  reg.add(a);
  reg.add(killer);
  let kills = 0;
  let who: Combatant | null = null;
  reg.onKill((v, k) => {
    kills++;
    who = k;
  });
  a.takeDamage({ amount: 50, type: 'arrow', source: killer });
  a.takeDamage({ amount: 50, type: 'arrow', source: killer });
  reg.update(0.016);
  ok(kills === 1 && who === killer, 'reported once with killer');
  ok(reg.byTeam('enemy').length === 1, 'corpse still registered');
  for (let i = 0; i < 600; i++) reg.update(1 / 60);
  ok(!reg.all().includes(a), 'expired corpse removed');
  ok(a.disposed, 'disposed');
  ok(reg.all().includes(killer), 'player kept');
  // onDeath overwritten after add → polling fallback
  const b = new Dummy('enemy', V(0, 0, 0), 10);
  reg.add(b);
  b.onDeath = null;
  b.takeDamage({ amount: 50, type: 'melee', source: killer });
  reg.update(0.016);
  ok(kills === 2, 'polling fallback reports');
});

test('projectiles: hit, headshot multiplier, stick', () => {
  const ctx = fakeCtx();
  const p = createProjectiles(ctx) as ProjectilesExt;
  const t = new Dummy('enemy', V(0, 0, 20), 1000);
  ctx.combatants.add(t);
  let hits = 0;
  let zone = '';
  p.fire({ origin: V(0, 1.7, 0), dir: V(0, 0, 1), speed: 70, damage: 10, team: 'player', owner: null, gravity: 0, onHit: (_c, h) => ((hits += 1), (zone = h.zone)) });
  for (let i = 0; i < 60; i++) {
    t.update(1 / 60);
    p.update(1 / 60);
  }
  ok(hits === 1 && zone === 'head', `head hit (${zone})`);
  near(t.hp, 1000 - 25, 1e-6, 'damage x2.5');
  ok(p.stuck === 1 && p.flying === 0, 'stuck in target');
});

test('projectiles: friendly fire ignored, piercing passes through 3', () => {
  const ctx = fakeCtx();
  const p = createProjectiles(ctx) as ProjectilesExt;
  const ally = new Dummy('ally', V(0, 0, 5), 100);
  const e = [10, 14, 18, 22, 26].map((z) => new Dummy('enemy', V(0, 0, z), 1000));
  ctx.combatants.add(ally);
  for (const d of e) ctx.combatants.add(d);
  let hits = 0;
  p.fire({ origin: V(0, 1.2, 0), dir: V(0, 0, 1), speed: 80, damage: 10, team: 'player', owner: null, type: 'piercing', gravity: 0, onHit: () => hits++ });
  for (let i = 0; i < 60; i++) {
    for (const d of e) d.update(1 / 60);
    p.update(1 / 60);
  }
  ok(ally.hp === 100, 'ally untouched');
  ok(hits === 4, `pierced 3 and stopped in the 4th (${hits} hits)`);
  ok(e[4].hp === 1000, 'fifth untouched');
});

test('projectiles: homing arrow curves into a target', () => {
  const ctx = fakeCtx();
  const p = createProjectiles(ctx) as ProjectilesExt;
  const t = new Dummy('enemy', V(6, 0, 25), 1000);
  ctx.combatants.add(t);
  let hit = false;
  // fired straight ahead, target is off to the side
  p.fire({ origin: V(0, 1.5, 0), dir: V(0, 0, 1), speed: 75, damage: 10, team: 'player', owner: null, homing: t, gravity: 0, onHit: () => (hit = true) });
  for (let i = 0; i < 90; i++) {
    t.update(1 / 60);
    p.update(1 / 60);
  }
  ok(hit, 'homing hit');
});

test('projectiles: world stick + max stuck cap', () => {
  const ctx = fakeCtx();
  ctx.physics.addBox(V(0, 1, 10), [5, 1, 0.5], 0, { material: 'wood' });
  const p = createProjectiles(ctx) as ProjectilesExt;
  for (let k = 0; k < 130; k++) {
    p.fire({ origin: V(-4 + (k % 9), 1, 0), dir: V(0, 0, 1), speed: 70, damage: 1, team: 'player', owner: null, gravity: 0 });
    p.update(1 / 60);
  }
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  ok(p.stuck <= 120, `≤120 stuck (${p.stuck})`);
  ok(p.flying === 0, 'none flying');
});

test('throwObject: rock hits an enemy, spear lands in the ground, firebomb calls onImpact', () => {
  const ctx = fakeCtx();
  ctx.physics.setTerrain(() => 0, 'dirt');
  const p = createProjectiles(ctx);
  const target = new Dummy('player', V(0, 0, 10), 100);
  ctx.combatants.add(target);
  const rock = new THREE.Mesh(new THREE.SphereGeometry(0.3));
  // aim the rock: flat-ish throw from 1.6 m high, 10 m away
  p.throwObject({ object: rock, origin: V(0, 1.6, 0), velocity: V(0, 3, 16), damage: 30, team: 'enemy', owner: null, radius: 0.3 });
  for (let i = 0; i < 90; i++) p.update(1 / 60);
  ok(target.hp === 70, `rock dealt 30 (hp ${target.hp})`);
  const spear = new THREE.Group();
  spear.userData.throwKind = 'spear';
  p.throwObject({ object: spear, origin: V(5, 1.6, 0), velocity: V(0, 4, 8), damage: 20, team: 'enemy', owner: null, radius: 0.08 });
  for (let i = 0; i < 120; i++) p.update(1 / 60);
  ok(spear.parent !== null && spear.position.y < 0.1 && spear.position.y > -0.5, `spear stuck in the ground (y=${spear.position.y.toFixed(2)})`);
  let boom: THREE.Vector3 | null = null;
  const bomb = new THREE.Group();
  p.throwObject({ object: bomb, origin: V(-5, 1.6, 0), velocity: V(0, 5, 5), damage: 0, team: 'enemy', owner: null, radius: 0.15, onImpact: (pt) => (boom = pt.clone()) });
  for (let i = 0; i < 120; i++) p.update(1 / 60);
  ok(boom !== null && Math.abs((boom as THREE.Vector3).y) < 0.3, 'firebomb impact callback');
  ok(bomb.parent === null, 'firebomb removed after impact');
});

test('rivalry: numbers, rubber band within ±3', () => {
  ok(numberWord(42) === 'Forty-two' && numberWord(17) === 'Seventeen' && numberWord(1) === 'One', 'number words');
  for (let t = 0; t < 100; t += 0.7) for (let l = 0; l < 40; l += 3) {
    const g = gimliTarget(l, t);
    if (g < l - 3 || g > l + 3) ok(false, `target ${g} for ${l}`);
  }
  let sum = 0;
  let n = 0;
  for (let t = 0; t < 90; t += 0.5) {
    sum += gimliTarget(10, t) - 10;
    n++;
  }
  ok(sum / n > 0.3 && sum / n < 1.6, `slightly ahead on average (${(sum / n).toFixed(2)})`);
  const ctx = fakeCtx();
  const r = createRivalry(ctx);
  // simulate: player kills every 3 s for 60 s, an enemy is alive
  ctx.combatants.add(new Dummy('enemy', V(0, 0, 50), 100));
  r.start();
  r.autoGimli = true;
  let maxGap = 0;
  for (let i = 0; i < 3600; i++) {
    if (i % 180 === 0 && i > 0) r.addLegolas(1);
    r.update(1 / 60);
    maxGap = Math.max(maxGap, Math.abs(r.gimli - r.legolas));
  }
  ok(maxGap <= 3, `gap stayed ≤ 3 (max ${maxGap}); L=${r.legolas} G=${r.gimli}`);
  ok(r.gimli >= r.legolas - 1, 'Gimli keeps pace');
});

test('attack tokens: survive a clock reset, never leak through dead/disposed holders', () => {
  const P = new Dummy('player', V(0, 0, 0));
  const a = new Dummy('enemy', V(1, 0, 0));
  const b = new Dummy('enemy', V(-1, 0, 0));
  const c = new Dummy('enemy', V(0, 0, 1));
  ok(requestAttackToken(P, 100, 0.65, 2, a), 'first token at t=100');
  ok(!requestAttackToken(P, 100.2, 0.65, 2, b), 'gap enforced');
  releaseAttackToken(P, a);
  // new attempt: time.resetGame() puts the clock back to 0
  ok(requestAttackToken(P, 0, 0.65, 2, a), 'token granted at t=0 after the clock restarted');
  ok(requestAttackToken(P, 0.7, 0.65, 2, b), 'second concurrent token');
  ok(!requestAttackToken(P, 1.5, 0.65, 2, c), 'max concurrent enforced');
  a.takeDamage({ amount: 1e6, type: 'arrow', source: null });
  ok(requestAttackToken(P, 1.6, 0.65, 2, c), "a dead holder's token is reclaimed");
  ok(attackTokenCount(P) === 2, `two holders (${attackTokenCount(P)})`);
  resetCombatQueues();
  ok(attackTokenCount(P) === 0, 'level unload clears every token');
  ok(requestAttackToken(P, 0, 0.65, 2, b) && requestAttackToken(P, 0.7, 0.65, 2, c), 'both slots free again');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
