/**
 * GREENLEAF entry point (owner: shell).
 *
 * Boot order (ARCHITECTURE.md section 3):
 *   flags + save -> engine, input, audio, fx, hud, physics, registry, time -> GameContext
 *   -> player, projectiles, rivalry (two-phase init) -> menus -> game -> title (or ?chapter=)
 *   -> requestAnimationFrame loop: input.poll -> game.frame -> engine.render -> hud / audio.
 *
 * URL flags: ?chapter=<id> &cp=<n> &quality=low|medium|high|ultra &bot=1 &dev=1 &skipIntro=1
 *            &god=1 &seed=<n> &menu=0 &difficulty=easy|normal|hard &freeze=1 (render only; the
 *            simulation moves only through __game.advance, for deterministic screenshots)
 *
 * Test hooks: window.__snapReady, window.__snapError, window.__game (see GameTestHooks in
 * core/types.ts), window.scene / __THREE_CAMERA__ / __renderer__.
 */
import type * as THREE from 'three';
import type {
  Difficulty, GameContext, Input, Menus, MenuActions, Progression, Quality,
} from './core/types';
import { createEngine } from './core/engine';
import { createInput } from './core/input';
import { createAudio } from './core/audio';
import { createFx } from './core/fx';
import { createHud } from './ui/hud';
import { createMenus } from './ui/menus';
import { createPhysics } from './physics/world';
import { createRegistry } from './combat/registry';
import { createProjectiles } from './combat/projectiles';
import { createPlayer } from './actors/player';
import { createRivalry } from './game/rivalry';
import { CHAPTERS } from './game/chapters';
import { createTime } from './game/time';
import { createProgression } from './game/progression';
import { createBot } from './game/bot';
import { createGame, type Game } from './game/game';

declare global {
  interface Window {
    __snapReady?: boolean;
    __snapError?: string;
    __game?: unknown;
    scene?: THREE.Scene;
    __THREE_CAMERA__?: THREE.Camera;
    __renderer__?: THREE.WebGLRenderer;
  }
}

const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

function fail(e: unknown): void {
  const text = String((e as Error)?.stack ?? e);
  console.error('[boot] fatal', e);
  window.__snapError ??= text;
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:auto 12px 12px 12px;max-height:40%;overflow:auto;margin:0;padding:12px;background:#220d0d;color:#ffb4a8;font:12px ui-monospace,monospace;z-index:99;pointer-events:auto;white-space:pre-wrap';
  box.textContent = `Greenleaf failed to start\n\n${text}`;
  document.body.appendChild(box);
}

const afterFrames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const tick = (): void => (--n <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

async function boot(): Promise<void> {
  const flags: Record<string, string> = Object.fromEntries(new URLSearchParams(location.search).entries());
  const app = document.getElementById('app');
  const ui = document.getElementById('ui');
  if (!app || !ui) throw new Error('index.html must contain #app and #ui');

  // 1. flags + save
  const story = CHAPTERS.filter((c) => !c.dev && c.number > 0).sort((a, b) => a.number - b.number);
  const progression = createProgression(story.length ? story.map((c) => c.id) : undefined);
  const settings = progression.data.settings;
  // ?difficulty= applies to this session only (like ?quality=): the save keeps the player's own
  // choice unless they change the difficulty in the settings menu meanwhile
  if (DIFFICULTIES.includes(flags.difficulty as Difficulty)) {
    const flagDiff = flags.difficulty as Difficulty;
    const savedDiff = settings.difficulty;
    settings.difficulty = flagDiff;
    const save = progression.save.bind(progression);
    progression.save = () => {
      if (settings.difficulty !== flagDiff) return save();
      settings.difficulty = savedDiff;
      try {
        save();
      } finally {
        settings.difficulty = flagDiff;
      }
    };
  }
  const quality: Quality = QUALITIES.includes(flags.quality as Quality) ? (flags.quality as Quality) : settings.quality;
  // dev chapters show with ?dev=1 / ?chapter=, and whenever no story chapter is registered yet (else
  // the shipped title would have nothing to Continue into)
  const devVisible = flags.dev === '1' || flags.chapter !== undefined || story.length === 0;
  const menuChapters = () => CHAPTERS.filter((c) => !c.dev || devVisible);

  // 2. core systems
  const engine = createEngine(app, quality);
  const input = createInput(engine.canvas, ui);
  const audio = createAudio();
  const fx = createFx(engine);
  const hud = createHud(ui);
  hud.show(false);
  const physics = createPhysics();
  const combatants = createRegistry();
  const time = createTime();

  // 3. context. The player sees `gameInput`: the real device state, or the autopilot's when the bot is on.
  let botRef: ReturnType<typeof createBot> | null = null;
  const gameInput: Input = {
    get state() {
      return botRef && botRef.active ? botRef.state : input.state;
    },
    poll: () => input.poll(),
    get enabled() {
      return input.enabled;
    },
    set enabled(v: boolean) {
      input.enabled = v;
    },
    get sensitivity() {
      return input.sensitivity;
    },
    set sensitivity(v: number) {
      input.sensitivity = v;
    },
    get invertY() {
      return input.invertY;
    },
    set invertY(v: boolean) {
      input.invertY = v;
    },
    lockPointer: () => input.lockPointer(),
    unlockPointer: () => input.unlockPointer(),
    get pointerLocked() {
      return input.pointerLocked;
    },
    get isTouch() {
      return input.isTouch;
    },
    setTouchVisible: (v) => input.setTouchVisible(v),
    setInteractLabel: (l) => input.setInteractLabel(l),
    rumble: (s, ms) => input.rumble(s, ms),
    dispose: () => input.dispose(),
  };

  const ctx = {
    engine,
    input: gameInput,
    audio,
    fx,
    hud,
    menus: {} as Menus,
    physics,
    combatants,
    projectiles: {} as GameContext['projectiles'],
    player: {} as GameContext['player'],
    time,
    progression: progression as Progression,
    rivalry: {} as GameContext['rivalry'],
    settings,
    flags,
  } as GameContext;
  ctx.player = createPlayer(ctx);
  ctx.projectiles = createProjectiles(ctx);
  ctx.rivalry = createRivalry(ctx);

  // 4. menus (actions are forwarded to the game, which is created right after)
  let game: Game | null = null;
  const actions: MenuActions = {
    startChapter: (id, cp) => game!.actions.startChapter(id, cp),
    resume: () => game!.actions.resume(),
    restartCheckpoint: () => game!.actions.restartCheckpoint(),
    restartChapter: () => game!.actions.restartChapter(),
    quitToTitle: () => game!.actions.quitToTitle(),
    applySettings: (s) => game!.actions.applySettings(s),
    buyUpgrade: (id) => game!.actions.buyUpgrade(id),
  };
  ctx.menus = createMenus(ui, {
    actions,
    progression,
    chapters: menuChapters,
    audio,
    input,
    inChapter: () => !!game && game.chapter !== null && game.mode !== 'title' && game.mode !== 'boot',
  });

  const bot = createBot(ctx, () => game?.botHint() ?? null);
  botRef = bot;
  bot.active = flags.bot === '1';
  const renderOnce = (dt: number): void => {
    // used by __game.advance(): one rendered frame after a headless simulation burst
    const inf = engine.renderer.info;
    inf.autoReset = false;
    inf.reset();
    const t0 = performance.now();
    engine.render(dt);
    game?.recordRender(performance.now() - t0, 0, 0, inf.render.calls, inf.render.triangles);
  };
  game = createGame(ctx, { realInput: input, bot, chapters: () => CHAPTERS, render: renderOnce });
  const g = game;

  // 5. loop
  // renderer.info counts every pass of a frame (shadow map, scene, post) when reset once per frame
  // here instead of on every renderer.render() call; __game.state().perf reports the totals.
  const info = engine.renderer.info;
  info.autoReset = false;
  const freeze = flags.freeze === '1';
  const logged = new Set<string>();
  let last = performance.now();
  let lastRender = -1e9;
  const loop = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if (!freeze) {
        input.poll();
        g.frame(dt);
        const t0 = performance.now();
        hud.update(dt);
        const t1 = performance.now();
        audio.update(dt);
        const t2 = performance.now();
        // the loading screen is opaque: rendering the half-built level behind it only steals time
        // from the load (seconds per frame on software GL and weak phones)
        if (g.mode !== 'loading') {
          info.reset();
          engine.render(dt);
          g.recordRender(performance.now() - t2, t1 - t0, t2 - t1, info.render.calls, info.render.triangles);
        }
      } else {
        // frozen: time only moves through __game.advance(). Keep the picture alive at a low rate so a
        // software-rendered GPU queue (headless tests) is never flooded.
        input.poll();
        if (input.state.pause) g.pause(); // the edge only lives for this poll
        if (now - lastRender > 250) {
          lastRender = now;
          info.reset();
          engine.render(0);
        }
      }
      hud.setFps(settings.showFps ? Math.round(engine.fps) : null);
    } catch (e) {
      const key = String((e as Error)?.message ?? e);
      if (!logged.has(key)) {
        logged.add(key);
        console.error('[loop]', e);
      }
    }
    requestAnimationFrame(loop);
  };

  // window plumbing: resize, pause when hidden, audio unlock on the first gesture
  window.addEventListener('resize', () => engine.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) g.pause();
  });
  const unlock = (): void => audio.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { once: true, capture: true });

  // test hooks
  window.scene = engine.scene;
  window.__THREE_CAMERA__ = engine.camera;
  window.__renderer__ = engine.renderer;
  window.__game = {
    advance: (sec: number, step?: number, render?: boolean) => g.advance(sec, step, render),
    advanceAsync: (sec: number, step?: number, render?: boolean) => g.advance(sec, step, render),
    advanceSync: (sec: number, step?: number, render?: boolean) => g.advanceSync(sec, step, render),
    startChapter: (id: string, cp?: number) => g.startChapter(id, cp ?? 0),
    state: () => g.state(),
    bot: (on: boolean) => {
      bot.active = !!on;
      bot.reset();
    },
    chapters: () => CHAPTERS.map((c) => c.id),
    chapterInfo: () => CHAPTERS.map((c) => ({ id: c.id, number: c.number, title: c.title, checkpoints: c.checkpoints.length, dev: !!c.dev })),
    ctx,
    game: g,
  };

  requestAnimationFrame(loop);

  // 6. first screen
  if (flags.chapter && !CHAPTERS.some((c) => c.id === flags.chapter)) {
    // a stale bookmark / deep link: land on the title instead of a dead black screen
    console.warn(`[boot] unknown chapter "${flags.chapter}" (known: ${CHAPTERS.map((c) => c.id).join(', ')})`);
    await g.toTitle(true);
    hud.toast(`Chapter "${flags.chapter}" was not found`, 'warning');
  } else if (flags.chapter) {
    try {
      await g.startChapter(flags.chapter, Math.max(0, parseInt(flags.cp ?? '0', 10) || 0));
    } catch {
      return; // the load fell back to the title with a toast; __snapError is set for the tools
    }
    if (g.error) return; // __snapError already set
  } else {
    await g.toTitle(flags.menu !== '0');
  }
  await afterFrames(2);
  window.__snapReady = true;
}

boot().catch(fail);
