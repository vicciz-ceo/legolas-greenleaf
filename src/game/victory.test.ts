/**
 * Victory-beat tests (node, no browser): drives the real createGame with a stub context and a one-line chapter.
 *
 * After the last kill handleComplete() cuts input and the results screen follows COMPLETE_DELAY later. A window blur
 * or a hidden tab in between (main.ts calls game.pause() for both) used to open the pause menu; Resume then switched
 * input back on and grabbed the pointer, and showResults() only unlocked the pointer, so the results menu sat over
 * live input: movement, shots, mouse look, edge turning, and pointer-lock requests on key presses.
 *
 * game.ts reaches the world through ./level (import.meta.glob) and the humanoid kit (a preload of seconds of meshing):
 * the runner shims the glob and swaps the preload for a no-op (src/physics/run-tests.mjs).
 * Run with: node src/physics/run-tests.mjs
 */
import * as THREE from 'three';
import type { ChapterDef, GameContext, InputState, LevelAPI } from '../core/types';
import { createGame, type Game, type GameDeps } from './game';
import { createTime } from './time';

let failed = 0;
let passed = 0;
const ok = (c: boolean, m: string) => {
  if (c) passed++;
  else {
    failed++;
    console.log('  FAIL:', m);
  }
};
const test = async (n: string, f: () => Promise<void>) => {
  const b = failed;
  try {
    await f();
  } catch (e) {
    failed++;
    console.log('  THROW', (e as Error).stack);
  }
  console.log(failed === b ? 'ok   ' + n : 'FAIL ' + n);
};

/** an object that answers any call with nothing: the subsystems this test does not care about */
function stub<T = unknown>(own: Record<string, unknown> = {}): T {
  return new Proxy(own, {
    get: (t, k) => (k in t ? t[k as string] : typeof k === 'symbol' || k === 'then' ? undefined : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as T;
}

function neutralInput(): InputState {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, aimHeld: false, drawHeld: false, drawReleased: false, melee: false, jump: false, dash: false,
    interact: false, nextArrow: false, pause: false, arrowSlot: 0, focusHeld: false, focusPressed: false, focusReleased: false, sprintHeld: false, device: 'kbm',
  };
}

interface Rig {
  game: Game;
  input: { enabled: boolean; state: InputState };
  /** the running chapter's level API (the chapter calls complete() on its last kill) */
  level: LevelAPI;
  count(entry: string): number;
  /** real-time frames of 1/60 s until `done()` (or `max` of them) */
  runUntil(done: () => boolean, max?: number): void;
}

/** a game with one chapter loaded and playing: input on, pointer lock requested, as after a real chapter start */
async function rig(): Promise<Rig> {
  const log: string[] = [];
  const input = {
    state: neutralInput(),
    sensitivity: 1,
    invertY: false,
    pointerLocked: false,
    isTouch: false,
    _enabled: true,
    get enabled() {
      return this._enabled;
    },
    set enabled(v: boolean) {
      this._enabled = v;
    },
    poll() {},
    lockPointer() {
      log.push('lock');
    },
    unlockPointer() {
      log.push('unlock');
    },
    setTouchVisible() {},
    setInteractLabel() {},
    rumble() {},
    dispose() {},
  };
  let level: LevelAPI | null = null;
  const def: ChapterDef = {
    id: 'victory_test', number: 1, title: 'Victory test', film: '', blurb: '', environment: 'arena', checkpoints: ['Start'], parTime: 60, dev: true,
    create: async (l) => {
      level = l;
      return { start() {}, update() {} };
    },
  };
  const menus = stub({
    showPause: () => log.push('menu:pause'),
    showChapterComplete: () => {
      log.push('menu:results');
      return new Promise(() => {}); // the player never answers: the game stays on the results screen
    },
    showDefeat: () => new Promise(() => {}),
  });
  const player = {
    position: new THREE.Vector3(),
    object: new THREE.Object3D(),
    alive: true, hp: 100, maxHp: 100, invulnerable: false, arrowType: 'standard', controlsEnabled: true, weaponsEnabled: true, mover: null,
    tally: { kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 },
    camera: { shot: null, snap() {}, update() {} },
    revive() {}, resetTally() {}, teleport() {}, update() {},
    cancelDraw() {
      log.push('player.cancelDraw');
    },
  };
  const settings = { sensitivity: 1, invertY: false, master: 1, music: 1, sfx: 1, subtitles: true, showFps: false, quality: 'high', difficulty: 'normal' };
  const ctx = {
    engine: stub({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), levelRoot: new THREE.Group(), shadowFocus: new THREE.Vector3(), quality: 'high', env: {}, post: { letterbox: 0, focusTint: 0, dof: { enabled: false, focus: 0 } } }),
    hud: stub(), audio: stub(), fx: stub(), physics: stub(), projectiles: stub(),
    combatants: stub({ byTeam: () => [] }),
    rivalry: stub({ active: false, hold: false, autoGimli: false, legolas: 0, gimli: 0 }),
    progression: stub({ data: { settings, best: {}, last: null, unlocked: ['victory_test'], rivalryTotals: { legolas: 0, gimli: 0 } }, computeRank: () => ({ score: 500, rank: 'A', points: 3 }) }),
    time: createTime(),
    menus, input, player, settings,
    flags: { preload: '0' },
  } as unknown as GameContext;
  const deps: GameDeps = { realInput: input as never, bot: stub({ active: false }), chapters: () => [def], render() {} };
  const game = createGame(ctx, deps);
  await game.startChapter(def.id);
  if (!level) throw new Error('the chapter never got its level API');
  return {
    game,
    input,
    level,
    count: (entry) => log.filter((e) => e === entry).length,
    runUntil(done, max = 600) {
      for (let i = 0; i < max && !done(); i++) game.frame(1 / 60);
    },
  };
}

// createGame times its load with a window interval and reports fatal errors on window
const g = globalThis as unknown as Record<string, unknown>;
g.window = { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) };
try {
  await test('pausing while playing still works, and Resume gives input and the pointer back', async () => {
    const r = await rig();
    ok(r.game.mode === 'playing' && r.input.enabled, 'the chapter is playing with input on');
    ok(r.count('lock') === 1, 'the pointer was requested at the start');
    const unlocks = r.count('unlock');

    r.game.pause();
    ok(r.game.mode === 'paused', 'paused');
    ok(!r.input.enabled, 'input is cut');
    ok(r.count('menu:pause') === 1, 'the pause menu is up');
    ok(r.count('player.cancelDraw') === 1, 'a draw in progress is abandoned');
    ok(r.count('unlock') === unlocks + 1, 'the pointer was handed back');

    r.game.actions.resume();
    ok(r.game.mode === 'playing' && r.input.enabled, 'Resume plays on with input on');
    ok(r.count('lock') === 2, 'and takes the pointer again');
  });

  await test('a blur or hidden tab during the victory beat does not pause: no menu, input stays cut', async () => {
    const r = await rig();
    r.level.complete(); // the last kill
    ok(r.game.mode === 'playing' && !r.input.enabled, 'the victory beat runs in mode playing, input already cut');
    ok(r.game.state().completing === true, 'and the game reports it');
    const locks = r.count('lock');

    r.game.pause(); // main.ts: window blur / visibilitychange
    ok(r.game.mode === 'playing', 'the game is not paused');
    ok(r.count('menu:pause') === 0, 'no pause menu opened');
    ok(r.count('player.cancelDraw') === 0, 'nothing was abandoned');
    ok(!r.input.enabled, 'input is still cut');

    r.game.actions.resume(); // a Resume that arrives anyway has nothing to resume
    ok(!r.input.enabled, 'Resume cannot switch input back on');
    ok(r.count('lock') === locks, 'and cannot grab the pointer');

    r.runUntil(() => r.game.mode === 'complete');
    ok(r.game.mode === 'complete', 'the beat carried on to the results screen');
    ok(r.count('menu:results') === 1, 'the results menu is up once');
    ok(!r.input.enabled, 'with input cut under it');
    ok(r.count('lock') === locks, 'and no pointer grab on the way');

    r.game.pause();
    ok(r.game.mode === 'complete' && r.count('menu:pause') === 0, 'the results screen cannot be paused either');
  });

  await test('the results screen cuts input whichever route led to it', async () => {
    const r = await rig();
    r.level.complete();
    r.input.enabled = true; // any route that switched input back on during the beat (a resume, a script, a bot)
    const unlocks = r.count('unlock');
    r.runUntil(() => r.game.mode === 'complete');
    ok(r.game.mode === 'complete', 'the results screen is up');
    ok(!r.input.enabled, 'input is cut under the results menu');
    ok(r.count('unlock') === unlocks + 1, 'and the pointer was handed back');
  });

  await test('a pause before the last kill still plays out normally: resume, win, results', async () => {
    const r = await rig();
    r.game.pause();
    r.game.actions.resume();
    ok(r.game.mode === 'playing' && r.input.enabled, 'back in play');
    r.level.complete();
    ok(!r.input.enabled, 'the kill cuts input');
    r.runUntil(() => r.game.mode === 'complete');
    ok(r.game.mode === 'complete' && !r.input.enabled && r.count('menu:results') === 1, 'results up, input cut');
  });
} finally {
  delete g.window;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
