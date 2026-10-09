/**
 * LevelAPI implementation (owner: shell).
 *
 * `createLevelAPI(ctx, chapter, world, hooks)` builds the object a chapter script talks to. It owns
 * everything a chapter spawns or schedules, so that disposing the level (checkpoint respawn, quit,
 * next chapter) leaves nothing behind: timers never resolve, updaters stop, crowds and combatants
 * are freed, cinematic state is reset.
 *
 * All time here is GAME time (scaled by Focus slow-mo, frozen by hit-stop and pause). Promises
 * returned by wait / waitUntil / say / wave never resolve after dispose(), so a chapter script that
 * is still `await`ing simply stays suspended forever and gets garbage collected.
 */
import * as THREE from 'three';
import type {
  AllySpec, CameraShot, Combatant, CrowdDef, CrowdHandle, EnemySpec, EnvironmentName, EnvironmentPreset,
  GameContext, LevelAPI, MusicMood, Speaker, TerrainOpts, WaveDef, ChapterDef,
} from '../core/types';
import type { Enemy, Ally } from '../core/types';
import { fbm2, hashSeed, Rng } from '../core/rng';
import { ENVIRONMENTS } from '../core/environment';
import type { FxExtras } from '../core/fx';
import { createEnemy } from '../actors/enemy';
import { createAlly } from '../actors/ally';
import { disposeObject } from '../core/math';

// ─────────────────────────────────────────────────────────────────────────────
// Optional world modules (owner: world). Loaded lazily and defensively so a missing or broken
// module degrades to a plain stand-in instead of taking the whole game down.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldModules {
  terrain?: { buildTerrain(opts: TerrainOpts): { mesh: THREE.Mesh; heightAt(x: number, z: number): number } };
  crowd?: { createCrowd(def: CrowdDef, heightAt: (x: number, z: number) => number): CrowdHandle };
  /** names of modules that failed to load (diagnostics) */
  failed: string[];
}

const worldGlobs = {
  terrain: import.meta.glob('../world/terrain.ts') as Record<string, () => Promise<unknown>>,
  crowd: import.meta.glob('../world/crowd.ts') as Record<string, () => Promise<unknown>>,
};

let worldPromise: Promise<WorldModules> | null = null;

export function loadWorld(): Promise<WorldModules> {
  worldPromise ??= (async () => {
    const out: WorldModules = { failed: [] };
    for (const key of ['terrain', 'crowd'] as const) {
      const loader = Object.values(worldGlobs[key])[0];
      if (!loader) continue;
      try {
        const mod = await loader();
        if (key === 'terrain' && typeof (mod as { buildTerrain?: unknown }).buildTerrain === 'function') out.terrain = mod as WorldModules['terrain'];
        else if (key === 'crowd' && typeof (mod as { createCrowd?: unknown }).createCrowd === 'function') out.crowd = mod as WorldModules['crowd'];
        else out.failed.push(`${key}: missing export`);
      } catch (e) {
        out.failed.push(`${key}: ${String((e as Error)?.message ?? e)}`);
        console.warn(`[level] world/${key} failed to load, using a stand-in`, e);
      }
    }
    return out;
  })();
  return worldPromise;
}

// ── stand-ins used only when the world module is missing ─────────────────────

const STYLE_COLORS: Record<TerrainOpts['style'], [number, number, number]> = {
  forest: [0x2f3b22, 0x4a4630, 0x5b5a52],
  riverbank: [0x3c4a2a, 0x6a5a3e, 0x6e6a5e],
  snow: [0xdfe6ee, 0xaab4c0, 0x6c7480],
  rock: [0x6a645a, 0x57524a, 0x3e3a34],
  plains: [0x6f7a3c, 0x8a7a48, 0x6a6048],
  ash: [0x3a3633, 0x2a2624, 0x4a4440],
  cave: [0x3a3430, 0x2a2622, 0x4a443c],
  mud: [0x4a3a28, 0x3a2e20, 0x5a4a34],
};

function standinTerrain(opts: TerrainOpts): { mesh: THREE.Mesh; heightAt: (x: number, z: number) => number } {
  const [cx, cz] = opts.center ?? [0, 0];
  const seg = Math.max(2, Math.min(256, Math.floor(opts.segments)));
  const geo = new THREE.PlaneGeometry(opts.size, opts.size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const [flat, mid, steep] = STYLE_COLORS[opts.style].map((h) => new THREE.Color(h));
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setY(i, opts.height(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const slope = 1 - nrm.getY(i);
    const n = fbm2(x * 0.08, z * 0.08, 3, 11) * 0.5 + 0.5;
    c.copy(flat).lerp(mid, n);
    c.lerp(steep, Math.min(1, slope * 3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.name = 'terrain(standin)';
  return { mesh, heightAt: (x, z) => opts.height(x, z) };
}

/** build terrain with the world builder, or a plain stand-in when it is missing / fails */
export function createTerrain(world: WorldModules, opts: TerrainOpts): { mesh: THREE.Mesh; heightAt: (x: number, z: number) => number } {
  try {
    if (world.terrain) return world.terrain.buildTerrain(opts);
  } catch (e) {
    console.warn('[level] buildTerrain failed, using a stand-in', e);
  }
  return standinTerrain(opts);
}

function standinCrowd(def: CrowdDef, heightAt: (x: number, z: number) => number): CrowdHandle {
  const n = Math.max(0, Math.min(400, Math.floor(def.count)));
  const geo = new THREE.CapsuleGeometry(0.28, 1.2, 3, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const rng = new Rng(hashSeed('crowd', def.kind, n));
  const m = new THREE.Matrix4();
  const base: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = def.center.x + (rng.float() * 2 - 1) * def.halfSize[0];
    const z = def.center.z + (rng.float() * 2 - 1) * def.halfSize[1];
    base.push([x, heightAt(x, z) + 0.9, z]);
    m.makeTranslation(x, heightAt(x, z) + 0.9, z);
    mesh.setMatrixAt(i, m);
  }
  mesh.castShadow = true;
  mesh.name = `crowd(standin ${def.kind})`;
  let alive = n;
  return {
    mesh,
    setSpeed() {},
    thin(frac) {
      const kill = Math.floor(alive * Math.max(0, Math.min(1, frac)));
      for (let i = 0; i < kill; i++) {
        alive--;
        m.makeScale(0, 0, 0);
        mesh.setMatrixAt(alive, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
      mesh.removeFromParent();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment helper (shared with game.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Room reverb per environment: [amount 0..1, decay seconds]. Caves ring for seconds, open
 * country barely at all. A tweaked copy of a preset keeps its `name`, so it keeps its reverb; a
 * custom preset can also carry its own `reverb: [amount, decay]` (EnvironmentPresetEx).
 */
export const REVERB: Partial<Record<EnvironmentName, [number, number]>> = {
  moria: [0.9, 5.5],
  laketown_night: [0.5, 2.2],
  helms_deep_storm: [0.45, 2.6],
  black_gate: [0.5, 3],
};
const DEFAULT_REVERB: [number, number] = [0.35, 1.6];

export function reverbFor(env: EnvironmentName | EnvironmentPreset): [number, number] {
  if (typeof env === 'string') return REVERB[env] ?? DEFAULT_REVERB;
  const own = (env as EnvironmentPreset & { reverb?: [number, number] }).reverb;
  if (own) return own;
  for (const key of Object.keys(ENVIRONMENTS) as EnvironmentName[]) {
    const p = ENVIRONMENTS[key];
    if (p === env || p.name === env.name) return REVERB[key] ?? DEFAULT_REVERB;
  }
  return DEFAULT_REVERB;
}

/** apply an environment preset: lighting + sky, weather particles, the ambience loop and the room reverb */
export function applyEnvironment(ctx: GameContext, env: EnvironmentName | EnvironmentPreset, prevAmbience?: string): EnvironmentPreset {
  const eng = ctx.engine;
  eng.setEnvironment(env);
  const p = eng.env;
  ctx.fx.setWeather(p.weather ?? 'none', p.weatherIntensity ?? 1);
  if (prevAmbience && prevAmbience !== p.ambience) ctx.audio.loop(prevAmbience as never, 0);
  if (p.ambience) ctx.audio.loop(p.ambience, 0.6);
  const [amount, decay] = reverbFor(env);
  ctx.audio.setReverb?.(amount, decay);
  return p;
}

export function presetOf(env: EnvironmentName | EnvironmentPreset): EnvironmentPreset {
  return typeof env === 'string' ? ENVIRONMENTS[env] : env;
}

// ─────────────────────────────────────────────────────────────────────────────
// LevelAPI
// ─────────────────────────────────────────────────────────────────────────────

export interface LevelHooks {
  onCheckpoint(index: number): void;
  onComplete(): void;
  onFail(reason: string): void;
  /** called when a wait / waitUntil / say / wave promise resolves (a script continuation is now pending) */
  onHop?(): void;
}

export interface LevelHost extends LevelAPI {
  /** advance timers, waits, boss bar and chapter updaters by one game-time step */
  update(dt: number): void;
  /** stop everything the chapter started. Idempotent. */
  dispose(): void;
  /** 0 or 1: where the letterbox should be (the game eases engine.post.letterbox toward it) */
  readonly letterboxTarget: number;
  /** true while cinematic(true) is active */
  readonly inCinematic: boolean;
  /** the boss bar's combatant, if any */
  readonly bossTarget: Combatant | null;
  /** mood pinned by the chapter with music(), or null for the adaptive score */
  readonly musicOverride: MusicMood | null;
}

interface Waiter {
  left: number;
  pred: (() => boolean) | null;
  resolve: () => void;
}

const defaultSubtitleSeconds = (text: string): number => Math.max(2.4, 1.3 + text.length * 0.052);

export function createLevelAPI(ctx: GameContext, chapter: ChapterDef, world: WorldModules, hooks: LevelHooks): LevelHost {
  const root = new THREE.Group();
  root.name = `level:${chapter.id}`;
  ctx.engine.levelRoot.add(root);

  const rng = new Rng(hashSeed(chapter.id, ctx.flags.seed ?? ''));
  const waiters: Waiter[] = [];
  const updaters: ((dt: number) => void)[] = [];
  const crowds: CrowdHandle[] = [];
  const spawned = new Set<Combatant>();
  let disposed = false;
  let cinematic = false;
  let boss: Combatant | null = null;
  let bossName = '';
  let bossDeadT = 0;
  let clock = 0;
  let musicOverride: MusicMood | null = null;
  let ambience: string | undefined = ctx.engine.env.ambience;

  function waitFor(left: number, pred: (() => boolean) | null): Promise<void> {
    if (disposed) return new Promise<void>(() => {});
    return new Promise<void>((resolve) => {
      waiters.push({ left, pred, resolve });
    });
  }

  function facingToPlayer(p: THREE.Vector3): number {
    const t = ctx.player.position;
    return Math.atan2(t.x - p.x, t.z - p.z);
  }

  /** lift a spawn point onto the ground if it was given at or below it */
  function groundPoint(p: THREE.Vector3): THREE.Vector3 {
    const h = ctx.physics.heightAt(p.x, p.z);
    return Number.isFinite(h) && p.y < h ? new THREE.Vector3(p.x, h, p.z) : p.clone();
  }

  function enemyAlive(c: Combatant): boolean {
    return c.alive;
  }

  const api: LevelHost = {
    root,
    ctx,
    get disposed() {
      return disposed;
    },
    get letterboxTarget() {
      return cinematic ? 1 : 0;
    },
    get inCinematic() {
      return cinematic;
    },
    get bossTarget() {
      return boss;
    },
    get musicOverride() {
      return musicOverride;
    },
    music(mood) {
      if (!disposed) musicOverride = mood;
    },

    objective(text) {
      if (!disposed) ctx.hud.setObjective(text);
    },
    checkpoint(index) {
      if (!disposed) hooks.onCheckpoint(index);
    },
    complete() {
      if (!disposed) hooks.onComplete();
    },
    fail(reason) {
      if (!disposed) hooks.onFail(reason);
    },

    wait(seconds) {
      if (seconds <= 0 && !disposed) return Promise.resolve();
      return waitFor(seconds, null);
    },
    waitUntil(pred, timeoutSec) {
      if (disposed) return new Promise<void>(() => {});
      try {
        if (pred()) return Promise.resolve();
      } catch (e) {
        console.warn('[level] waitUntil predicate threw', e);
      }
      return waitFor(timeoutSec ?? Infinity, pred);
    },
    say(speaker: Speaker, text: string, duration?: number) {
      const dur = duration ?? defaultSubtitleSeconds(text);
      let total = dur;
      if (!disposed && ctx.settings.subtitles) {
        // lines are shown strictly one after another (HUD queue): a line that has to wait behind the
        // one on screen (chapter dialogue, rivalry banter) resolves after its own turn, not before it
        total += ctx.hud.subtitleBacklog?.() ?? 0;
        ctx.hud.subtitle(speaker, text, dur);
      }
      return waitFor(total, null);
    },

    spawnEnemy(spec: EnemySpec, pos: THREE.Vector3, facing?: number): Enemy {
      const p = groundPoint(pos);
      const e = createEnemy(ctx, spec, p, facing ?? facingToPlayer(p));
      ctx.combatants.add(e);
      if (!e.object.parent) root.add(e.object);
      spawned.add(e);
      return e;
    },
    spawnAlly(spec: AllySpec, pos: THREE.Vector3, facing?: number): Ally {
      const p = groundPoint(pos);
      const a = createAlly(ctx, spec, p, facing ?? facingToPlayer(p));
      ctx.combatants.add(a);
      if (!a.object.parent) root.add(a.object);
      spawned.add(a);
      return a;
    },
    addCombatant(c) {
      ctx.combatants.add(c);
      if (!c.object.parent) root.add(c.object);
      spawned.add(c);
    },
    removeCombatant(c) {
      ctx.combatants.remove(c);
      spawned.delete(c);
      if (boss === c) api.boss(null);
      c.dispose();
      c.object.removeFromParent();
    },
    enemiesAlive(filter) {
      let n = 0;
      for (const c of ctx.combatants.byTeam('enemy')) if (c.alive && (!filter || filter(c))) n++;
      return n;
    },

    async wave(def: WaveDef) {
      const members: Combatant[] = [];
      const t0 = clock;
      for (let gi = 0; gi < def.groups.length; gi++) {
        const g = def.groups[gi];
        const spots = Array.isArray(g.at) ? g.at : [g.at];
        for (let i = 0; i < g.count; i++) {
          if (disposed) return;
          const base = spots[i % spots.length];
          const spread = g.spread ?? 0;
          const pos = base.clone();
          if (spread > 0) {
            const a = rng.float() * Math.PI * 2;
            const r = Math.sqrt(rng.float()) * spread;
            pos.x += Math.cos(a) * r;
            pos.z += Math.sin(a) * r;
          }
          members.push(api.spawnEnemy(g.spec, pos));
        }
        if (def.stagger && gi < def.groups.length - 1) await api.wait(def.stagger);
        if (disposed) return;
      }
      const until = def.until ?? 0;
      const left = def.timeout !== undefined ? Math.max(0, def.timeout - (clock - t0)) : undefined;
      await api.waitUntil(() => {
        let n = 0;
        for (const m of members) if (enemyAlive(m)) n++;
        return n <= until;
      }, left);
    },

    boss(c, name) {
      boss = c;
      bossDeadT = 0;
      if (!c) {
        ctx.hud.setBoss(null);
        return;
      }
      bossName = name ?? c.name;
      c.isBoss = true;
      ctx.hud.setBoss(bossName, Math.max(0, c.hp / Math.max(1, c.maxHp)));
    },

    cinematic(on) {
      if (disposed) return;
      cinematic = on;
      ctx.player.controlsEnabled = !on;
      ctx.hud.show(!on);
      ctx.input.setTouchVisible(!on);
      if (on) {
        ctx.hud.setPrompt(null);
        ctx.hud.setCrosshair(0, false, false);
      }
    },
    cameraShot(shot: CameraShot | null) {
      if (!disposed) ctx.player.camera.shot = shot;
    },
    setEnvironment(env) {
      if (disposed) return;
      ambience = applyEnvironment(ctx, env, ambience).ambience;
    },
    onUpdate(fn) {
      updaters.push(fn);
      return () => {
        const i = updaters.indexOf(fn);
        if (i >= 0) updaters.splice(i, 1);
      };
    },
    crowd(def: CrowdDef): CrowdHandle {
      const hAt = (x: number, z: number) => ctx.physics.heightAt(x, z);
      let h: CrowdHandle;
      try {
        h = world.crowd ? world.crowd.createCrowd(def, hAt) : standinCrowd(def, hAt);
      } catch (e) {
        console.warn('[level] createCrowd failed, using a stand-in', e);
        h = standinCrowd(def, hAt);
      }
      if (!h.mesh.parent) root.add(h.mesh);
      crowds.push(h);
      return h;
    },
    rng: () => rng.float(),
    terrain(opts: TerrainOpts) {
      const t = createTerrain(world, opts);
      root.add(t.mesh);
      ctx.physics.setTerrain(t.heightAt, opts.material ?? 'dirt');
      const fx = ctx.fx as unknown as Partial<FxExtras>;
      if ('groundAt' in fx) fx.groundAt = t.heightAt;
      return t;
    },

    update(dt) {
      if (disposed) return;
      clock += dt;
      // waits / waitUntil, in registration order
      for (let i = 0; i < waiters.length; ) {
        const w = waiters[i];
        w.left -= dt;
        let done = w.left <= 0;
        if (!done && w.pred) {
          try {
            done = w.pred();
          } catch (e) {
            console.warn('[level] waitUntil predicate threw; resolving', e);
            done = true;
          }
        }
        if (done) {
          waiters.splice(i, 1);
          w.resolve();
          hooks.onHop?.();
        } else i++;
      }
      // chapter per-frame callbacks (copy: a callback may remove itself)
      for (const fn of updaters.slice()) {
        try {
          fn(dt);
        } catch (e) {
          console.warn('[level] onUpdate callback threw', e);
        }
      }
      // boss bar tracks the bound combatant
      if (boss) {
        ctx.hud.setBoss(bossName, Math.max(0, boss.hp / Math.max(1, boss.maxHp)));
        if (!boss.alive) {
          bossDeadT += dt;
          if (bossDeadT > 2.2) api.boss(null);
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      waiters.length = 0; // pending promises stay pending forever, by design
      updaters.length = 0;
      for (const c of crowds) {
        try {
          c.dispose();
        } catch {
          /* already gone */
        }
      }
      crowds.length = 0;
      spawned.clear();
      boss = null;
      cinematic = false;
      musicOverride = null;
      const p = ctx.player;
      if (p) {
        p.controlsEnabled = true;
        p.weaponsEnabled = true;
        p.mover = null;
        p.camera.shot = null;
      }
      ctx.hud.setBoss(null);
      ctx.hud.setObjective(null);
      ctx.hud.setPrompt(null);
      ctx.hud.setProgress(null);
      ctx.hud.setFocusMarks([]);
      ctx.hud.clearSubtitles?.(); // a stale line must not survive into the next chapter
      ctx.hud.clearToasts?.();
      ctx.hud.show(true);
      ctx.input.setTouchVisible(true);
      ctx.input.setInteractLabel(null);
      root.removeFromParent();
      disposeObject(root);
    },
  };
  return api;
}
