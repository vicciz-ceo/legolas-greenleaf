/**
 * The game: state machine + chapter manager (owner: shell).
 *
 *   title -> loading -> playing <-> paused -> complete | defeat -> (next chapter | title)
 *
 * One `frame(dtReal)` call advances everything: input-driven bot, time scale, the fixed update
 * order (player -> chapter -> combatants -> projectiles -> fx -> rivalry) and the camera. The
 * browser loop in main.ts and the headless `__game.advance()` test hook both call it, so a
 * smoke-test run exercises exactly the code path a player does.
 *
 * Responsibilities
 *  - chapter load / unload (clean teardown of physics, registry, projectiles, fx, GPU resources),
 *  - checkpoints + full-rebuild respawn, defeat and chapter-complete flows, ranks, unlocks,
 *  - the cinematic menu backdrop (Legolas in a misty forest, slowly orbited),
 *  - adaptive music mood, letterbox easing, pause rules.
 */
import * as THREE from 'three';
import type {
  ChapterDef, ChapterInstance, ChapterResult, GameContext, HumanoidKind, Input, InputState, MenuActions, MusicMood, Progression, Rivalry, Settings,
} from '../core/types';
import type { CameraRigExt } from '../actors/camera';
import type { HudImpl } from '../ui/hud';
import type { AudioSysExt } from '../core/audio';
import { createRivalry, type RivalryExt } from './rivalry';
import { clamp, damp } from '../core/math';
import { fbm2, mulberry32 } from '../core/rng';
import { applyEnvironment, createLevelAPI, createTerrain, loadWorld, type LevelHost, type WorldModules } from './level';
import { buildMenuBackdrop } from './backdrop';
import { preloadHumanoids } from '../creatures/humanoid';
import { seedBucket } from '../creatures/humanoid/build';
import { setWorldQuality } from '../world/quality';
import { setWetness } from '../world/mats';
import { getDevice } from '../ui/bus';
import type { TimeControlExt } from './time';
import type { ProgressionExt } from './progression';
import { MAX_FRAME } from './time';
import type { Bot } from './bot';
import { resetCombatQueues } from '../actors/npc';

export type GameMode = 'boot' | 'title' | 'loading' | 'playing' | 'paused' | 'complete' | 'defeat';

export interface GameDeps {
  /** the real device input (the ctx.input the player sees may be a bot wrapper) */
  realInput: Input;
  bot: Bot;
  /** every registered chapter, including dev ones */
  chapters: () => ChapterDef[];
  /** render one frame (engine.render + hud + audio are handled by the caller) */
  render: (dtReal: number) => void;
}

/**
 * Per-frame CPU timings (ms, exponentially smoothed over ~20 frames) of the update phases plus what
 * the browser loop reports about rendering. Exposed as __game.state().perf.
 */
export interface GamePerf {
  /** JS ms per frame per update phase (all substeps of the frame summed) */
  phases: Record<'bot' | 'player' | 'chapter' | 'combatants' | 'projectiles' | 'fx' | 'rivalry' | 'camera' | 'mood', number>;
  /** whole game.frame() (sum of the phases plus glue) */
  frameMs: number;
  /** engine.render() submission time, hud.update, audio.update (reported by main.ts) */
  renderMs: number;
  hudMs: number;
  audioMs: number;
  /** renderer.info of the last rendered frame, summed over every pass (shadow, scene, post) */
  calls: number;
  triangles: number;
  /** live combatants by team, for context */
  enemies: number;
  /** chapter load breakdown (ms) of the most recent load */
  load: Record<string, number>;
}

export interface Game {
  readonly mode: GameMode;
  readonly chapter: ChapterDef | null;
  readonly checkpoint: number;
  readonly actions: MenuActions;
  /** simulate one real frame */
  frame(dtReal: number): void;
  startChapter(id: string, cp?: number): Promise<void>;
  /** drop whatever is running and show the title menu (unless showMenu is false) over the cinematic backdrop */
  toTitle(showMenu?: boolean): Promise<void>;
  /** what the running chapter wants the autopilot to do this frame */
  botHint(): ReturnType<NonNullable<ChapterInstance['botHint']>>;
  pause(): void;
  /**
   * Fixed-step simulation without real-time rendering (test hook), then one rendered frame.
   * Returns a Promise: chapter scripts are async functions, and their continuations only run when
   * the JS stack unwinds, so whenever a script is waiting to resume (a wait / waitUntil / say
   * resolved) the loop yields to let it run before stepping on. `await` it (page.evaluate does).
   * Without scripts it is purely synchronous, so `advance(1)` followed by a read still works.
   */
  advance(sec: number, step?: number, render?: boolean): Promise<void>;
  /** same as advance() (kept as an explicit name for scripts that want to be clear about awaiting) */
  advanceAsync(sec: number, step?: number, render?: boolean): Promise<void>;
  /** strictly synchronous stepping: chapter scripts only progress one await-hop per call */
  advanceSync(sec: number, step?: number, render?: boolean): void;
  state(): Record<string, unknown>;
  /** most recent fatal error text, if any */
  readonly error: string | null;
  readonly perf: GamePerf;
  /** main.ts reports the rendering side of the frame (ms, renderer.info totals) */
  recordRender(renderMs: number, hudMs: number, audioMs: number, calls: number, triangles: number): void;
}

/**
 * Four spawn seeds that land in the four humanoid variation buckets (seedBucket hashes any seed
 * into 0..3), so preloading them covers every variant a chapter can spawn. Seed 0 is bucket 0.
 */
const BUCKET_SEEDS: number[] = (() => {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let sd = 0; out.length < 4 && sd < 256; sd++) {
    const b = seedBucket(sd);
    if (!seen.has(b)) {
      seen.add(b);
      out.push(sd);
    }
  }
  return out;
})();

const FIXED_STEP = 1 / 60;
/** longest slice handed to gameplay code in one call */
const MAX_SUBSTEP = 1 / 30;
const DEATH_DELAY = 1.9;
const COMPLETE_DELAY = 1.6;

const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** yield to the event loop without the 4 ms clamp of nested setTimeout (flushes all pending microtasks) */
const yieldTask = (): Promise<void> =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });

export function createGame(ctx: GameContext, deps: GameDeps): Game {
  const { engine, hud, menus, audio, fx, physics, combatants, projectiles, input, progression } = ctx;
  const time = ctx.time as TimeControlExt;
  const bot = deps.bot;
  const god = ctx.flags.god === '1';
  const skipIntro = ctx.flags.skipIntro === '1';

  let mode: GameMode = 'boot';
  let chapter: ChapterDef | null = null;
  let instance: ChapterInstance | null = null;
  let level: LevelHost | null = null;
  let checkpoint = 0;
  let loadToken = 0;
  let attemptTime = 0;
  let deathT = 0;
  let completeT = -1;
  let pendingResult = false;
  let error: string | null = null;
  /** set by the level when a script continuation is pending (see advance) */
  let hop = false;
  let lastObjective: string | null = null;
  let mood: MusicMood = 'none';
  let moodHold = 0;
  const cpRivalry = new Map<number, { legolas: number; gimli: number }>();
  /** the player's tally when each checkpoint was reached: a respawn replays that beat, so its kills,
   * shots and hits are rolled back like the rivalry (damage taken and time stay as the penalty) */
  const cpTally = new Map<number, { kills: number; shots: number; hits: number; headshots: number }>();
  const reported = new Set<string>();
  let backdrop: { cam: THREE.Vector3; look: THREE.Vector3; hero: THREE.Vector3; t: number } | null = null;
  let musicIntensity = 0.5;
  let musicIntensityQ = -1;
  let playT = 0;

  // ── per-phase CPU timings ────────────────────────────────────────────────
  const perf: GamePerf = {
    phases: { bot: 0, player: 0, chapter: 0, combatants: 0, projectiles: 0, fx: 0, rivalry: 0, camera: 0, mood: 0 },
    frameMs: 0,
    renderMs: 0,
    hudMs: 0,
    audioMs: 0,
    calls: 0,
    triangles: 0,
    enemies: 0,
    load: {},
  };
  /** this frame's raw phase sums (folded into perf.phases at the end of frame()) */
  const acc: GamePerf['phases'] = { bot: 0, player: 0, chapter: 0, combatants: 0, projectiles: 0, fx: 0, rivalry: 0, camera: 0, mood: 0 };
  const PERF_K = 0.1;
  const now = (): number => performance.now();
  function foldPerf(frameMs: number): void {
    const ph = perf.phases;
    for (const k in acc) {
      const key = k as keyof GamePerf['phases'];
      ph[key] += (acc[key] - ph[key]) * PERF_K;
      acc[key] = 0;
    }
    perf.frameMs += (frameMs - perf.frameMs) * PERF_K;
  }

  // remember the objective text for state()
  const origObjective = hud.setObjective.bind(hud);
  hud.setObjective = (text: string | null) => {
    lastObjective = text;
    origObjective(text);
  };

  const rigOf = (): CameraRigExt => ctx.player.camera as CameraRigExt;
  const setMode = (m: GameMode) => {
    mode = m;
  };
  /** mode check that TypeScript cannot narrow away across awaits / calls that change it */
  const isMode = (...m: GameMode[]): boolean => m.includes(mode);

  /** log a chapter-script error once per message, loudly enough for the smoke test to fail on it */
  function report(where: string, e: unknown): void {
    const msg = `[${where}] ${String((e as Error)?.stack ?? e)}`;
    const key = msg.slice(0, 200);
    if (reported.has(key)) return;
    reported.add(key);
    console.error(msg);
  }

  function fatal(e: unknown): void {
    error = String((e as Error)?.stack ?? e);
    console.error('[game] fatal', e);
    (window as unknown as { __snapError?: string }).__snapError = error;
  }

  // ── settings ──────────────────────────────────────────────────────────────
  /**
   * Push every setting into the systems that use it, live (the settings menu calls this on each
   * change) and once at boot. ctx.settings IS progression.data.settings, so readers that poll it
   * (aim assist in the player, Show FPS in main.ts, subtitles in level.say, difficulty at spawn)
   * see the new values immediately. Persisted to localStorage on every call.
   */
  function applySettings(s: Settings, prev?: Settings): void {
    const cur = progression.data.settings;
    if (s !== cur) Object.assign(cur, s);
    // controls
    input.sensitivity = cur.sensitivity;
    input.invertY = cur.invertY;
    // audio (remembered by the audio system until its context is unlocked by a gesture)
    const a = audio as AudioSysExt;
    a.master = cur.master;
    a.musicVolume = cur.music;
    a.sfxVolume = cur.sfx;
    // hud
    (hud as HudImpl).setSubtitlesEnabled?.(cur.subtitles);
    if (!cur.showFps) hud.setFps(null);
    // quality: a ?quality= URL flag wins at boot; a change made in the menu always applies.
    // The renderer (post chain, shadows, IBL, pixel ratio) switches at once; world builders read
    // setWorldQuality() for their density, which takes effect from the next level build.
    if (!prev || prev.quality !== cur.quality) {
      if (!ctx.flags.quality || prev) engine.setQuality(cur.quality);
      setWorldQuality(engine.quality);
    }
    progression.save();
  }

  // ── adaptive music ────────────────────────────────────────────────────────
  /**
   * explore (no enemies) -> tension (enemies alive but none engaged) -> combat (an enemy within
   * ENGAGE metres) -> boss (a boss bar is bound to a living combatant). Combat and boss linger a few
   * seconds so the score does not flap; victory / defeat are set by the completion and defeat flows.
   * A chapter can pin a mood with level.music(mood) (null hands control back).
   */
  const ENGAGE = 32;
  function updateMood(dtReal: number): void {
    let want: MusicMood = 'explore';
    let engaged = 0;
    let alive = 0;
    const p = ctx.player.position;
    for (const c of combatants.byTeam('enemy')) {
      if (!c.alive) continue;
      alive++;
      const dx = c.position.x - p.x;
      const dz = c.position.z - p.z;
      if (dx * dx + dz * dz < ENGAGE * ENGAGE) engaged++;
    }
    perf.enemies = alive;
    const forced = level?.musicOverride ?? null;
    if (forced) want = forced;
    else if (level?.bossTarget?.alive) want = 'boss';
    else if (engaged > 0) want = 'combat';
    else if (alive > 0) want = 'tension';
    if (want === 'combat' || want === 'boss') moodHold = 4;
    else moodHold -= dtReal;
    if (!forced && (want === 'explore' || want === 'tension') && moodHold > 0 && (mood === 'combat' || mood === 'boss')) want = mood;
    if (want !== mood) {
      mood = want;
      audio.music(mood);
    }
    // more drums and horns the more enemies are on the player
    const target = want === 'boss' ? 0.9 : want === 'combat' ? clamp(0.45 + engaged * 0.06, 0.45, 1) : want === 'tension' ? 0.35 : 0.25;
    musicIntensity = damp(musicIntensity, target, 0.8, dtReal);
    const q = Math.round(musicIntensity * 20) / 20;
    if (q !== musicIntensityQ) {
      musicIntensityQ = q;
      (audio as AudioSysExt).setMusicIntensity?.(q);
    }
  }

  // ── cinematic menu backdrop ───────────────────────────────────────────────
  /** the misty Forest River vista from ./backdrop.ts; a plain stand-in if a world builder fails */
  async function buildBackdrop(): Promise<void> {
    applyEnvironment(ctx, 'menu');
    let hero: THREE.Vector3;
    let facing: number;
    const t0 = now();
    try {
      const b = buildMenuBackdrop();
      perf.load = { backdrop: Math.round(now() - t0) };
      engine.levelRoot.add(b.root);
      physics.setTerrain(b.heightAt, 'grass');
      const fxx = fx as unknown as { groundAt?: unknown };
      if ('groundAt' in fxx) fxx.groundAt = b.heightAt;
      hero = b.hero;
      facing = b.heroFacing;
    } catch (e) {
      console.warn('[game] menu backdrop failed, using the stand-in', e);
      engine.clearLevel();
      const world = await loadWorld();
      const root = new THREE.Group();
      root.name = 'menu-backdrop(standin)';
      engine.levelRoot.add(root);
      const height = (x: number, z: number) => {
        const d = Math.hypot(x, z);
        const clearing = Math.min(1, d / 14);
        return (fbm2(x * 0.02, z * 0.02, 4, 31) * 5.5 + fbm2(x * 0.09, z * 0.09, 2, 5) * 0.5) * clearing * clearing;
      };
      const t = createTerrain(world, { size: 260, segments: 180, height, style: 'forest', material: 'grass' });
      root.add(t.mesh);
      physics.setTerrain(t.heightAt, 'grass');
      scatterForest(root, t.heightAt);
      hero = new THREE.Vector3(0, t.heightAt(0, 0), 0);
      facing = 0.6;
    }
    ctx.player.teleport(hero, facing);
    ctx.player.object.visible = true;
    backdrop = { cam: new THREE.Vector3(), look: new THREE.Vector3(), hero, t: 0 };
    orbit(0);
  }

  /** instanced trunks + canopies: a cheap misty forest used when no world builder is around */
  function scatterForest(root: THREE.Group, h: (x: number, z: number) => number): void {
    const rnd = mulberry32(77);
    const N = 520;
    const trunkG = new THREE.CylinderGeometry(0.22, 0.4, 1, 7).translate(0, 0.5, 0);
    const crownG = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.95 });
    const crownM = new THREE.MeshStandardMaterial({ color: 0x1f3324, roughness: 0.9 });
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, N);
    const crowns = new THREE.InstancedMesh(crownG, crownM, N * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let ci = 0;
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 9 + Math.sqrt(rnd()) * 120;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const th = 7 + rnd() * 11;
      p.set(x, h(x, z) - 0.2, z);
      e.set(0, rnd() * 6.28, 0);
      q.setFromEuler(e);
      s.set(0.8 + rnd() * 0.8, th, 0.8 + rnd() * 0.8);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 2; k++) {
        const cr = 2.6 + rnd() * 1.6 - k * 0.7;
        p.set(x, h(x, z) + th * (0.45 + k * 0.25), z);
        s.set(cr, th * 0.5, cr);
        m.compose(p, q, s);
        crowns.setMatrixAt(ci++, m);
      }
    }
    trunks.castShadow = crowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = true;
    root.add(trunks, crowns);
  }

  /**
   * A slow pendulum around the hero from the landward side, so the river, the far bank and the
   * low sun always fill the background (a full orbit would spend half its time on bare bank).
   */
  function orbit(dtReal: number): void {
    if (!backdrop) return;
    const b = backdrop;
    b.t += dtReal;
    const a = Math.PI - 0.22 + Math.sin(b.t * 0.05) * 0.3;
    const R = 5.2 + Math.sin(b.t * 0.031) * 0.45;
    const hy = b.hero.y;
    b.cam.set(b.hero.x + Math.sin(a) * R, hy + 1.8 + Math.sin(b.t * 0.21) * 0.08, b.hero.z + Math.cos(a) * R);
    // look beside the hero (he sits in the right third), level with his chest, toward the far bank
    b.look.set(b.hero.x - Math.cos(a) * 1.8, hy + 1.5, b.hero.z + Math.sin(a) * 1.8);
    const cam = engine.camera;
    cam.position.copy(b.cam);
    cam.lookAt(b.look);
    cam.fov = 44;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    engine.shadowFocus.copy(b.hero);
    audio.setListener(cam.position, _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion));
    const dof = engine.post.dof;
    dof.enabled = engine.quality === 'high' || engine.quality === 'ultra';
    dof.focus = b.cam.distanceTo(b.hero) ;
  }
  const _fwd = new THREE.Vector3();

  // ── unload / load ─────────────────────────────────────────────────────────
  function unload(): void {
    try {
      instance?.dispose?.();
    } catch (e) {
      report('chapter.dispose', e);
    }
    instance = null;
    level?.dispose();
    level = null;
    bot.reset();
    // a silent stop: stop() would queue a banter line that surfaces over the menu. The same
    // instance is reused (a fresh createRivalry per load stacked one more onKill listener each time)
    const rv = ctx.rivalry as Rivalry & Partial<RivalryExt>;
    if (rv.reset) rv.reset();
    else if (rv.active) {
      hud.setRivalry(null);
      ctx.rivalry = createRivalry(ctx);
    }
    const p = ctx.player;
    p.mover = null;
    p.camera.shot = null;
    p.controlsEnabled = true;
    p.weaponsEnabled = true;
    combatants.clear();
    resetCombatQueues(); // melee slots + attack tokens on the persistent player (time.t restarts at 0)
    try {
      projectiles.clear();
    } catch {
      // compatibility: projectiles.clear() before the first arrow was ever fired used to throw
      // (pools are created lazily); there is nothing to clear in that case
    }
    fx.clear();
    const fxx = fx as unknown as { groundAt?: unknown };
    if ('groundAt' in fxx) fxx.groundAt = null; // the previous terrain's height function
    physics.clear();
    engine.clearLevel();
    audio.stopAllLoops();
    setWetness(0); // shared world materials outlive the level: a storm chapter must not leave them wet
    engine.post.letterbox = 0;
    engine.post.focusTint = 0;
    engine.post.dof.enabled = false;
    audio.setSlowmo(0);
    time.setScale(1, 0);
    hud.setObjective(null);
    hud.setBoss(null);
    hud.setPrompt(null);
    hud.setProgress(null);
    hud.setFocusMarks([]);
    backdrop = null;
    mood = 'none';
    moodHold = 0;
  }

  async function toTitle(showMenu = true): Promise<void> {
    const token = ++loadToken;
    setMode('loading');
    menus.hideAll();
    hud.show(false);
    input.enabled = false;
    input.unlockPointer();
    unload();
    chapter = null;
    checkpoint = 0;
    completeT = -1;
    pendingResult = false;
    try {
      await buildBackdrop();
    } catch (e) {
      console.warn('[game] backdrop failed', e);
      backdrop = null;
    }
    if (token !== loadToken) return;
    setMode('title');
    ctx.player.revive();
    audio.music('menu');
    menus.hideLoading();
    if (showMenu) menus.showTitle();
    warmNextChapter();
  }

  /**
   * While the title is up, mesh the humanoids of the chapter "Continue" would start, in the worker
   * pool, so pressing it skips most of the preload. Purely a cache warm-up: loadChapter still
   * awaits its own preload (instant for whatever is already cached).
   */
  function warmNextChapter(): void {
    if (ctx.flags.preload === '0') return;
    const story = deps.chapters().filter((c) => !c.dev && c.number > 0).sort((a, b) => a.number - b.number);
    const lastId = progression.data.last?.chapterId;
    const def = story.find((c) => c.id === lastId) ?? story.find((c) => progression.data.unlocked.includes(c.id));
    const kinds = (def?.preload ?? []).filter((k) => k !== 'legolas');
    if (!kinds.length) return;
    void preloadHumanoids(kinds, { seeds: BUCKET_SEEDS }).catch(() => {
      /* best effort */
    });
  }

  /** the error of the most recent failed chapter load (startChapter rejects with it) */
  let loadError: unknown = null;

  async function loadChapter(def: ChapterDef, cp: number, respawn: boolean): Promise<void> {
    const token = ++loadToken;
    error = null; // a new attempt: state().error only describes this load (window.__snapError stays)
    loadError = null;
    setMode('loading');
    completeT = -1;
    deathT = 0;
    pendingResult = false;
    menus.hideAll();
    hud.show(false);
    input.enabled = false;
    input.unlockPointer();
    audio.music('none');
    menus.showLoading(def.title, 0.02);
    await nextTask();
    if (token !== loadToken) return;

    // progress: 0..0.1 teardown + world modules, 0.1..0.85 humanoid sculpt + meshing (real progress
    // from the worker pool; the chapter's create() runs meanwhile), 0.95 start(), then 1.
    const tLoad = now();
    const load: Record<string, number> = {};
    let progress = 0.05;
    // between real progress reports, creep forward a little so the bar never looks frozen
    const bump = window.setInterval(() => {
      if (progress >= 0.93) return;
      progress += (0.93 - progress) * 0.015;
      menus.showLoading(def.title, progress);
    }, 90);
    const setProgress = (f: number): void => {
      progress = Math.max(progress, f);
      menus.showLoading(def.title, progress);
    };
    try {
      let t0 = now();
      unload();
      const world: WorldModules = await loadWorld();
      load.unload = now() - t0;
      setProgress(0.1);
      await nextTask();
      if (token !== loadToken) return;

      // Mesh every humanoid kind the chapter will spawn (ChapterDef.preload) in the kit worker
      // pool, so createHumanoid in start() and in later waves is a cache hit instead of a hitch.
      // Seeds are picked to cover every variation bucket (spawn seeds hash into one of four).
      // Sculpting runs here on the main thread; once every meshing job is queued, the chapter's
      // create() builds the world WHILE the workers mesh, and start() waits for both.
      const tPre = now();
      const kinds = ctx.flags.preload === '0' ? [] : [...new Set<HumanoidKind>(def.preload ?? [])].filter((k) => k !== 'legolas');
      let queued: () => void = () => {};
      const allQueued = new Promise<void>((r) => (queued = r));
      const preload = (async () => {
        try {
          await preloadHumanoids(['legolas'], { seeds: [0] }); // a cache hit after boot
          if (kinds.length) {
            await preloadHumanoids(kinds, {
              seeds: BUCKET_SEEDS,
              onProgress: (f) => {
                // prebuildHumanoids reports 1/4 of its ticks for sculpting: past that, all jobs are queued
                if (f >= 0.25) queued();
                if (token === loadToken) setProgress(0.1 + 0.75 * f);
              },
            });
          }
        } catch (e) {
          // never fatal: createHumanoid builds on demand (on the main thread) instead
          console.warn('[game] humanoid preload failed', e);
        } finally {
          queued();
          load.preload = now() - tPre;
        }
      })();
      await allQueued;
      load.sculpt = now() - tPre;
      if (token !== loadToken) return;

      // fresh state
      chapter = def;
      checkpoint = clamp(cp, 0, Math.max(0, def.checkpoints.length - 1));
      const player = ctx.player;
      player.revive();
      player.invulnerable = god;
      player.arrowType = 'standard';
      if (!respawn) {
        player.resetTally();
        attemptTime = 0;
        cpRivalry.clear();
        cpTally.clear();
      } else {
        const t = player.tally;
        const snap = cpTally.get(checkpoint) ?? { kills: 0, shots: 0, hits: 0, headshots: 0 };
        t.kills = snap.kills;
        t.shots = snap.shots;
        t.hits = snap.hits;
        t.headshots = snap.headshots;
      }
      time.resetGame();
      applyEnvironment(ctx, def.environment);
      ctx.rivalry.autoGimli = false;

      level = createLevelAPI(ctx, def, world, {
        onCheckpoint: handleCheckpoint,
        onComplete: handleComplete,
        onFail: (reason) => void defeat(reason),
        onHop: () => {
          hop = true;
        },
      });
      await nextTask();
      t0 = now();
      const made = await def.create(level);
      load.create = now() - t0;
      if (token !== loadToken) {
        made.dispose?.();
        return;
      }
      instance = made;
      t0 = now();
      await preload;
      load.preloadWait = now() - t0;
      if (token !== loadToken) return;
      setProgress(0.95);
      await nextTask();
      if (token !== loadToken) return;
      t0 = now();

      // rivalry carries over between chapters; on respawn it resumes from the checkpoint snapshot
      if (def.rivalry) {
        // a fresh run (first play, Retry, Replay) starts from the chapters before this one, so a
        // replay never counts its own earlier clear twice (progression.rivalryBaseline)
        const pe = progression as Progression & Partial<Pick<ProgressionExt, 'rivalryBaseline'>>;
        const from = (respawn && cpRivalry.get(checkpoint)) || (pe.rivalryBaseline ? pe.rivalryBaseline(def.id) : { ...progression.data.rivalryTotals });
        ctx.rivalry.start(from);
      }
      player.camera.shot = null;
      hud.setObjective(null);
      instance.start(checkpoint);
      rigOf().snap();
      load.start = now() - t0;
      if (!def.dev) {
        progression.data.last = { chapterId: def.id, checkpoint };
        progression.save();
      }
    } catch (e) {
      window.clearInterval(bump);
      fatal(e);
      loadError = e;
      menus.hideLoading();
      setMode('title');
      chapter = null;
      try {
        unload();
        await buildBackdrop();
      } catch {
        /* ignore */
      }
      menus.showTitle();
      hud.toast(`Could not load ${def.title}`, 'warning');
      return;
    } finally {
      window.clearInterval(bump); // every exit path, including a superseded load
    }
    if (token !== loadToken) return;

    // pose everything once (animations, camera) so the first visible frame is not a T-pose
    try {
      step(0.001);
      rigOf().update(FIXED_STEP);
    } catch (e) {
      report('first frame', e);
    }
    menus.showLoading(def.title, 1);
    menus.hideLoading();
    load.total = now() - tLoad;
    for (const k in load) load[k] = Math.round(load[k]);
    perf.load = load;
    // the chapter may already have started a cinematic inside start(): keep the HUD off for it
    hud.show(!(level?.inCinematic ?? false));
    ctx.player.object.visible = true;
    input.enabled = true;
    setMode('playing');
    playT = 0;
    bot.reset();
    audio.music('explore');
    mood = 'explore';
    // keyboard + mouse: grab the pointer right away. The click that started the chapter usually
    // still counts as a user gesture; if the browser refuses, the first click on the canvas locks
    // it (input.ts) and the HUD shows a "Click to focus" hint meanwhile.
    if (!input.isTouch && getDevice() === 'kbm' && !bot.active) input.lockPointer();
    if (!skipIntro && !respawn && checkpoint === 0) {
      void hud.titleCard(def.title, def.number > 0 ? `Chapter ${def.number}` : 'Development arena', def.film);
    }
  }

  // ── checkpoints, defeat, completion ───────────────────────────────────────
  function handleCheckpoint(index: number): void {
    if (!chapter || index <= checkpoint) return;
    checkpoint = Math.min(index, Math.max(0, chapter.checkpoints.length - 1));
    if (ctx.rivalry.active) cpRivalry.set(checkpoint, { legolas: ctx.rivalry.legolas, gimli: ctx.rivalry.gimli });
    const t = ctx.player.tally;
    cpTally.set(checkpoint, { kills: t.kills, shots: t.shots, hits: t.hits, headshots: t.headshots });
    hud.toast(chapter.checkpoints[checkpoint] ?? 'Checkpoint', 'checkpoint');
    audio.play('checkpoint');
    if (!chapter.dev) {
      progression.data.last = { chapterId: chapter.id, checkpoint };
      progression.save();
    }
  }

  async function defeat(reason: string): Promise<void> {
    if (mode !== 'playing' || !chapter) return;
    const def = chapter;
    setMode('defeat');
    input.enabled = false;
    input.unlockPointer();
    hud.setPrompt(null);
    hud.show(false); // the defeat screen stands alone over the scene (toasts/subtitles stay)
    audio.music('defeat');
    // a load / title change while the screen is up supersedes this continuation, even for the same
    // chapter (the next defeat screen resolves this stale promise; it must not drive the new run)
    const token = loadToken;
    const choice = await menus.showDefeat(reason);
    if (!isMode('defeat') || chapter !== def || token !== loadToken) return;
    if (choice === 'checkpoint') await loadChapter(def, checkpoint, true);
    else if (choice === 'restart') await loadChapter(def, 0, false);
    else {
      await toTitle();
      menus.showChapterSelect();
    }
  }

  function handleComplete(): void {
    if (mode !== 'playing' || completeT >= 0) return;
    completeT = 0;
    input.enabled = false;
    hud.setPrompt(null);
    audio.music('victory');
    audio.play('level_complete');
    time.setScale(0.4, 0.5);
  }

  async function showResults(): Promise<void> {
    const def = chapter;
    if (!def || pendingResult) return;
    pendingResult = true;
    setMode('complete');
    input.unlockPointer();
    time.setScale(1, 0.3);
    const t = ctx.player.tally;
    const riv = def.rivalry ? { legolas: ctx.rivalry.legolas, gimli: ctx.rivalry.gimli } : undefined;
    const base = {
      chapterId: def.id,
      title: def.title,
      timeSec: attemptTime,
      kills: t.kills,
      headshots: t.headshots,
      shots: t.shots,
      hits: t.hits,
      damageTaken: Math.round(t.damageTaken),
      rivalry: riv,
    };
    const rank = progression.computeRank(base, def.parTime);
    const result: ChapterResult = {
      ...base,
      score: rank.score,
      rank: rank.rank,
      // the dev arena is never recorded, so it neither awards points nor counts as a first clear
      pointsEarned: def.dev ? 0 : rank.points,
      firstClear: !def.dev && !progression.data.best[def.id],
    };
    if (!def.dev) progression.recordResult(result);
    if (def.rivalry) ctx.rivalry.stop(); // final banter line
    hud.show(false);
    const token = loadToken;
    const choice = await menus.showChapterComplete(result);
    if (!isMode('complete') || chapter !== def || token !== loadToken) return;
    const story = deps.chapters().filter((c) => !c.dev && c.number > 0).sort((a, b) => a.number - b.number);
    const idx = story.findIndex((c) => c.id === def.id);
    if (choice === 'retry') await loadChapter(def, 0, false);
    else if (choice === 'next') {
      const next = idx >= 0 ? story[idx + 1] : undefined;
      if (next) await loadChapter(next, 0, false);
      else {
        if (idx >= 0 && idx === story.length - 1) {
          // the last story chapter: roll the credits over the menu backdrop, then back to the title
          await toTitle(false);
          await menus.showCredits();
          menus.showTitle();
        } else await toTitle();
      }
    } else {
      await toTitle();
      menus.showChapterSelect();
    }
  }

  // ── pause ─────────────────────────────────────────────────────────────────
  function pause(): void {
    if (mode !== 'playing') return;
    setMode('paused');
    input.enabled = false;
    input.unlockPointer();
    menus.showPause();
  }

  function resume(): void {
    if (mode !== 'paused') return;
    setMode('playing');
    input.enabled = true;
    input.lockPointer();
  }

  // ── simulation ────────────────────────────────────────────────────────────
  /** clear the per-frame parts of an input state (edges, look deltas); held buttons and sticks stay */
  function consumeFrameInput(s: InputState): void {
    s.lookX = s.lookY = 0;
    s.drawReleased = s.melee = s.jump = s.dash = s.interact = s.nextArrow = s.pause = false;
    s.arrowSlot = 0;
    s.focusPressed = s.focusReleased = false;
  }

  function step(dt: number): void {
    const player = ctx.player;
    let t = now();
    player.update(dt);
    let t2 = now();
    acc.player += t2 - t;
    t = t2;
    if (level && instance) {
      try {
        level.update(dt);
      } catch (e) {
        report('level.update', e);
      }
      try {
        instance.update(dt);
      } catch (e) {
        report(`chapter ${chapter?.id}.update`, e);
      }
    }
    t2 = now();
    acc.chapter += t2 - t;
    t = t2;
    combatants.update(dt);
    t2 = now();
    acc.combatants += t2 - t;
    t = t2;
    projectiles.update(dt);
    t2 = now();
    acc.projectiles += t2 - t;
    t = t2;
    fx.update(dt, engine.camera);
    t2 = now();
    acc.fx += t2 - t;
    t = t2;
    ctx.rivalry.update(dt);
    acc.rivalry += now() - t;
  }

  function simulate(dtReal: number): void {
    const dt = time.step(dtReal);
    if (dt > 0) {
      const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        step(h);
        // edges and look deltas belong to the FRAME: below 30 fps a frame runs several substeps, and
        // each one re-read them (one Space press burned both jumps, one Tab skipped an arrow type,
        // mouse look turned twice as far)
        if (i === 0 && n > 1) consumeFrameInput(ctx.input.state);
      }
      if (mode === 'playing' || mode === 'defeat') attemptTime += dt;
    } else {
      // frozen by hit-stop: keep the player's real-time systems (camera, HUD) alive
      ctx.player.update(0);
    }
    const t = now();
    rigOf().update(dtReal);
    acc.camera += now() - t;
  }

  function frame(dtReal: number): void {
    const tf = now();
    const dr = clamp(dtReal, 0, MAX_FRAME);
    switch (mode) {
      case 'playing': {
        if (deps.realInput.state.pause) {
          pause();
          break;
        }
        playT += dr;
        let tb = now();
        bot.update(dr);
        acc.bot += now() - tb;
        simulate(dr);
        post(dr);
        if (god && ctx.player.alive) ctx.player.hp = ctx.player.maxHp;
        if (!ctx.player.alive) {
          deathT += dr;
          if (deathT >= DEATH_DELAY) void defeat('Legolas has fallen.');
        } else deathT = 0;
        if (completeT >= 0) {
          completeT += dr;
          if (completeT >= COMPLETE_DELAY) void showResults();
        }
        tb = now();
        updateMood(dr);
        acc.mood += now() - tb;
        break;
      }
      case 'complete':
      case 'defeat':
        simulate(dr);
        post(dr);
        break;
      case 'title':
        orbit(dr);
        ctx.player.update(time.step(dr));
        fx.update(dr, engine.camera);
        break;
      default:
        break;
    }
    updatePointerHint();
    foldPerf(now() - tf);
  }

  /** "Click to focus": keyboard/mouse play without pointer lock (after the start-of-chapter request had its chance) */
  let hintOn = false;
  function updatePointerHint(): void {
    const ri = deps.realInput as Input & { pointerFallback?: boolean };
    const want =
      mode === 'playing' &&
      playT > 1.2 &&
      !ri.pointerLocked &&
      !ri.isTouch &&
      !ri.pointerFallback &&
      !bot.active &&
      !(level?.inCinematic ?? false) &&
      completeT < 0 &&
      getDevice() === 'kbm';
    if (want !== hintOn) {
      hintOn = want;
      (hud as HudImpl).setPointerHint?.(want);
    }
  }

  /** letterbox easing and other real-time presentation state */
  function post(dtReal: number): void {
    const target = level?.letterboxTarget ?? 0;
    const p = engine.post;
    p.letterbox = damp(p.letterbox, target, 5, dtReal);
    if (Math.abs(p.letterbox - target) < 0.002) p.letterbox = target;
  }

  // ── test hooks ────────────────────────────────────────────────────────────
  function advanceSync(sec: number, stepSec = FIXED_STEP, render = true): void {
    const n = Math.max(1, Math.round(sec / stepSec));
    for (let i = 0; i < n; i++) {
      frame(stepSec);
      hud.update(stepSec);
    }
    hop = false;
    if (render) deps.render(stepSec);
  }

  async function advance(sec: number, stepSec = FIXED_STEP, render = true): Promise<void> {
    const n = Math.max(1, Math.round(sec / stepSec));
    for (let i = 0; i < n; i++) {
      frame(stepSec);
      hud.update(stepSec);
      if (hop) {
        // a script continuation is waiting to run: unwind the stack so it does, then carry on
        hop = false;
        await yieldTask();
      }
    }
    if (render) deps.render(stepSec);
  }

  function state(): Record<string, unknown> {
    const p = ctx.player;
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      mode,
      chapter: chapter?.id ?? null,
      checkpoint,
      hp: r(p.hp),
      maxHp: r(p.maxHp),
      alive: p.alive,
      enemies: level ? level.enemiesAlive() : 0,
      kills: p.tally.kills,
      shots: p.tally.shots,
      hits: p.tally.hits,
      headshots: p.tally.headshots,
      damageTaken: r(p.tally.damageTaken),
      playerPos: [r(p.position.x), r(p.position.y), r(p.position.z)],
      t: r(time.t),
      attempt: r(attemptTime),
      timeScale: r(time.scale),
      objective: lastObjective,
      boss: level?.bossTarget ? { name: level.bossTarget.name, hp: Math.round(level.bossTarget.hp), alive: level.bossTarget.alive } : null,
      rivalry: ctx.rivalry.active ? { legolas: ctx.rivalry.legolas, gimli: ctx.rivalry.gimli } : null,
      cinematic: level?.inCinematic ?? false,
      completing: completeT >= 0,
      bot: bot.active,
      allies: combatants.byTeam('ally').filter((a) => a.alive).length,
      music: mood,
      perf: perfSnapshot(),
      error,
    };
  }

  function perfSnapshot(): Record<string, unknown> {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const phases: Record<string, number> = {};
    for (const k in perf.phases) phases[k] = r2(perf.phases[k as keyof GamePerf['phases']]);
    return {
      phases,
      frameMs: r2(perf.frameMs),
      renderMs: r2(perf.renderMs),
      hudMs: r2(perf.hudMs),
      audioMs: r2(perf.audioMs),
      calls: perf.calls,
      triangles: perf.triangles,
      enemies: perf.enemies,
      load: perf.load,
    };
  }

  // ── menu actions ──────────────────────────────────────────────────────────
  const actions: MenuActions = {
    // a failed load already reported itself (fatal + toast) and fell back to the title
    startChapter: (id, cp) => void game.startChapter(id, cp ?? 0).catch((e) => (e === loadError ? undefined : fatal(e))),
    resume,
    restartCheckpoint: () => {
      if (chapter) void loadChapter(chapter, checkpoint, true).catch(fatal);
    },
    restartChapter: () => {
      if (chapter) void loadChapter(chapter, 0, false).catch(fatal);
    },
    quitToTitle: () => void toTitle().catch(fatal),
    applySettings: (s) => applySettings(s, { ...progression.data.settings }),
    buyUpgrade: (id) => progression.buy(id),
  };

  const game: Game = {
    get mode() {
      return mode;
    },
    get chapter() {
      return chapter;
    },
    get checkpoint() {
      return checkpoint;
    },
    get error() {
      return error;
    },
    perf,
    recordRender(renderMs, hudMs, audioMs, calls, triangles) {
      perf.renderMs += (renderMs - perf.renderMs) * PERF_K;
      perf.hudMs += (hudMs - perf.hudMs) * PERF_K;
      perf.audioMs += (audioMs - perf.audioMs) * PERF_K;
      perf.calls = calls;
      perf.triangles = triangles;
    },
    actions,
    frame,
    pause,
    toTitle,
    botHint: () => instance?.botHint?.() ?? null,
    advance,
    advanceAsync: advance,
    advanceSync,
    state,
    async startChapter(id, cp = 0) {
      const def = deps.chapters().find((c) => c.id === id);
      if (!def) {
        const e = new Error(`Unknown chapter "${id}". Known: ${deps.chapters().map((c) => c.id).join(', ')}`);
        fatal(e);
        throw e;
      }
      await loadChapter(def, cp, false);
      if (loadError) throw loadError;
    },
  };

  // settings -> engine/audio/input on boot
  applySettings(progression.data.settings);
  return game;
}
