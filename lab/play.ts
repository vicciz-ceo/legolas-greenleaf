/**
 * Gameplay Lab — a minimal game loop for the gameplay modules (player, camera, physics,
 * enemies, allies, projectiles, Focus, rivalry), runnable headless.
 *
 * Uses the real engine / fx / HUD / audio when they exist and load, otherwise local stand-ins.
 * Input is local (keyboard + mouse with pointer lock, or a scripted timeline).
 *
 * URL params
 *   script=move|shoot|knives|focus|troll|all   scripted input timeline (sim only runs via __game.advance)
 *   enemies=orc,goblin,...      archetypes to spawn (default: a mixed squad + troll)
 *   ai=0                         freeze enemy AI
 *   gimli=0                      no Gimli
 *   auto=1                       rivalry autoGimli on
 *   quality=low|medium|high      engine quality (default low)
 *   standin=1                    (informational) the capsule stand-ins are used when the kit is missing
 *   difficulty=easy|normal|hard
 *
 * Test hooks: window.__snapReady, window.__game = { advance(sec, step?), state(), startChapter(), bot() }
 *
 *   node scripts/snap.mjs "/lab/play.html?script=shoot" --advance 3 --size 960x540 --out shots/gameplay/shoot.png
 */
import * as THREE from 'three';
import type {
  AudioSys,
  Engine,
  Fx,
  FxHandle,
  GameContext,
  Hud,
  Input,
  InputState,
  Menus,
  Progression,
  Quality,
  Settings,
  TimeControl,
  EnemyArchetype,
  Combatant,
} from '../src/core/types';
import { createPhysics } from '../src/physics/world';
import { createRegistry } from '../src/combat/registry';
import { createProjectiles, type ProjectilesExt } from '../src/combat/projectiles';
import { createPlayer, DEFAULT_STATS } from '../src/actors/player';
import { createEnemy } from '../src/actors/enemy';
import { createAlly } from '../src/actors/ally';
import { createRivalry } from '../src/game/rivalry';
import { usingStandins } from '../src/actors/humanoids';
import type { CameraRigExt } from '../src/actors/camera';
import { fbm2 } from '../src/core/rng';

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

const params = new URLSearchParams(location.search);
const scriptName = params.get('script');
const quality = (params.get('quality') ?? 'low') as Quality;
const STEP = 1 / 60;

// ── optional real modules (lazy, so a broken WIP module cannot take the lab down) ──────────
type Mod<T> = Record<string, () => Promise<T>>;
const engineMods = import.meta.glob('/src/core/engine.ts') as Mod<{ createEngine?: (c: HTMLElement, q: Quality) => Engine }>;
const envMods = import.meta.glob('/src/core/environment.ts') as Mod<{ ENVIRONMENTS?: Record<string, unknown> }>;
const fxMods = import.meta.glob('/src/core/fx.ts') as Mod<{ createFx?: (e: Engine) => Fx }>;
const hudMods = import.meta.glob('/src/ui/hud.ts') as Mod<{ createHud?: (root: HTMLElement) => Hud }>;
const audioMods = import.meta.glob('/src/core/audio.ts') as Mod<{ createAudio?: () => AudioSys }>;
const texMods = import.meta.glob('/src/world/textures.ts') as Mod<{ makeMaterial?: (name: string, o?: unknown) => THREE.Material }>;

async function tryLoad<T>(mods: Mod<T>, label: string): Promise<T | null> {
  const f = Object.values(mods)[0];
  if (!f) return null;
  try {
    return await f();
  } catch (e) {
    console.warn(`[play] ${label} failed to load, using a stand-in`, e);
    return null;
  }
}

// ── stand-ins ─────────────────────────────────────────────────────────────────
function stubEngine(container: HTMLElement): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  scene.fog = new THREE.FogExp2(0x9fb4c8, 0.012);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 600);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(20, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 120 });
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0f0, 0x4a4030, 0.9);
  scene.add(hemi);
  const levelRoot = new THREE.Group();
  scene.add(levelRoot);
  const shadowFocus = new THREE.Vector3();
  const post = { exposure: 1, bloomStrength: 0, vignette: 0, grain: 0, saturation: 1, damageFlash: 0, focusTint: 0, letterbox: 0, dof: { enabled: false, focus: 10, aperture: 0 } };
  const flashEl = document.createElement('div');
  flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 160px 40px rgba(200,0,0,0);';
  document.body.appendChild(flashEl);
  return {
    renderer,
    scene,
    camera,
    canvas: renderer.domElement,
    quality: 'low',
    setQuality() {},
    sun,
    hemi,
    shadowFocus,
    levelRoot,
    env: {} as Engine['env'],
    setEnvironment() {},
    post,
    render() {
      sun.position.copy(shadowFocus).add(new THREE.Vector3(20, 30, 10));
      sun.target.position.copy(shadowFocus);
      flashEl.style.boxShadow = `inset 0 0 160px 40px rgba(200,0,0,${post.damageFlash * 0.6})`;
      renderer.toneMappingExposure = 1;
      if (post.focusTint > 0) {
        scene.background = new THREE.Color(0x9fb4c8).lerp(new THREE.Color(0x6c7a88), post.focusTint);
      }
      renderer.render(scene, camera);
    },
    resize() {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    },
    clearLevel() {},
    fps: 60,
    dispose() {},
  };
}

function stubFx(): Fx {
  const handle = (): FxHandle => ({ position: new THREE.Vector3(), setIntensity() {}, stop() {} });
  return {
    blood() {},
    sparks() {},
    dust() {},
    splash() {},
    debris() {},
    explosion() {},
    fire: handle,
    smoke: handle,
    torch: handle,
    trail: handle,
    setWeather() {},
    lightning() {},
    update() {},
    clear() {},
  };
}

function stubAudio(): AudioSys {
  const log: string[] = [];
  (window as unknown as { __sfx: string[] }).__sfx = log;
  return {
    unlock() {},
    play(name) {
      log.push(name);
      if (log.length > 400) log.splice(0, 100);
    },
    loop() {},
    stopAllLoops() {},
    music() {},
    setListener() {},
    setSlowmo() {},
    master: 1,
    musicVolume: 1,
    sfxVolume: 1,
    update() {},
  };
}

function stubHud(root: HTMLElement): Hud {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:16px;top:12px;font:13px ui-monospace,monospace;color:#eee;text-shadow:0 1px 2px #000;white-space:pre';
  const cross = document.createElement('div');
  cross.style.cssText = 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;opacity:.85';
  const marks = document.createElement('div');
  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute;left:0;right:0;bottom:12%;text-align:center;font:16px Georgia,serif;color:#f0e6c8;text-shadow:0 1px 3px #000';
  root.append(el, cross, marks, sub);
  const s = { hp: '', focus: '', riv: '', arrow: '' };
  const draw = () => (el.textContent = [s.hp, s.focus, s.arrow, s.riv].filter(Boolean).join('\n'));
  return {
    show() {},
    setHealth: (c, m) => ((s.hp = `HP ${Math.round(c)}/${m}`), draw()),
    setFocus: (c, m, a) => ((s.focus = `Focus ${Math.round(c)}/${m}${a ? ' ACTIVE' : ''}`), draw()),
    setArrowType: (t) => ((s.arrow = `Arrow: ${t}`), draw()),
    setCrosshair: (c, aiming, visible) => {
      cross.style.display = visible ? 'block' : 'none';
      cross.style.transform = `scale(${aiming ? 0.7 : 1 + (1 - c)})`;
    },
    hitMarker() {},
    damage() {},
    setObjective() {},
    setRivalry: (l, g) => ((s.riv = l === null ? '' : `Legolas ${l} — Gimli ${g}`), draw()),
    setBoss() {},
    toast() {},
    subtitle: (sp, t) => (sub.textContent = `${sp}: ${t}`),
    titleCard: async () => {},
    setFocusMarks: (pts) => {
      marks.innerHTML = '';
      for (const p of pts) {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${p.x - 10}px;top:${p.y - 10}px;width:20px;height:20px;border:2px solid ${p.locked ? '#ffd27a' : 'rgba(255,255,255,.4)'};border-radius:50%`;
        marks.appendChild(d);
      }
    },
    setPrompt() {},
    setProgress() {},
    setFps() {},
    update() {},
  };
}

// ── input: keyboard/mouse + scripted timeline ──────────────────────────────────
interface Held {
  moveX: number;
  moveY: number;
  lookX: number; // rad per second (script) / per frame accumulated (mouse)
  lookY: number;
  aim: boolean;
  draw: boolean;
  melee: boolean;
  jump: boolean;
  dash: boolean;
  focus: boolean;
  sprint: boolean;
  next: boolean;
  slot: 0 | 1 | 2 | 3;
  device: 'kbm' | 'gamepad' | 'touch';
}
const blankHeld = (): Held => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, aim: false, draw: false, melee: false, jump: false, dash: false, focus: false, sprint: false, next: false, slot: 0, device: 'kbm' });

function createLabInput(canvas: HTMLCanvasElement): Input & { held: Held; scripted: boolean; frameDt: number } {
  const state: InputState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, aimHeld: false, drawHeld: false, drawReleased: false, melee: false, jump: false, dash: false, interact: false, nextArrow: false, pause: false, arrowSlot: 0, focusHeld: false, focusPressed: false, focusReleased: false, sprintHeld: false, device: 'kbm' };
  const keys = new Set<string>();
  const held = blankHeld();
  const prev = blankHeld();
  let mouseDX = 0;
  let mouseDY = 0;
  let lmb = false;
  let rmb = false;
  let locked = false;
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Tab') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  canvas.addEventListener('mousedown', (e) => {
    if (!locked) canvas.requestPointerLock?.();
    if (e.button === 0) lmb = true;
    if (e.button === 2) rmb = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) lmb = false;
    if (e.button === 2) rmb = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => (locked = document.pointerLockElement === canvas));
  addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });
  const api = {
    state,
    held,
    scripted: false,
    frameDt: STEP,
    enabled: true,
    sensitivity: 1,
    invertY: false,
    lockPointer: () => canvas.requestPointerLock?.(),
    unlockPointer: () => document.exitPointerLock?.(),
    get pointerLocked() {
      return locked;
    },
    isTouch: false,
    setTouchVisible() {},
    setInteractLabel() {},
    rumble() {},
    dispose() {},
    poll() {
      if (!api.scripted) {
        const k = (c: string) => keys.has(c);
        held.moveX = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
        held.moveY = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
        held.aim = rmb;
        held.draw = lmb;
        held.melee = k('KeyF') || k('KeyV');
        held.jump = k('Space');
        held.dash = k('KeyC') || k('AltLeft') || k('ControlLeft');
        held.focus = k('KeyQ');
        held.sprint = k('ShiftLeft');
        held.next = k('Tab');
        held.slot = k('Digit1') ? 1 : k('Digit2') ? 2 : k('Digit3') ? 3 : 0;
        held.device = 'kbm';
        state.lookX = mouseDX * 0.0022;
        state.lookY = -mouseDY * 0.0022;
        mouseDX = mouseDY = 0;
      } else {
        state.lookX = held.lookX * api.frameDt;
        state.lookY = held.lookY * api.frameDt;
      }
      const m = Math.hypot(held.moveX, held.moveY);
      state.moveX = m > 1 ? held.moveX / m : held.moveX;
      state.moveY = m > 1 ? held.moveY / m : held.moveY;
      state.aimHeld = held.aim;
      state.drawHeld = held.draw;
      state.drawReleased = prev.draw && !held.draw;
      state.melee = held.melee && !prev.melee;
      state.jump = held.jump && !prev.jump;
      state.dash = held.dash && !prev.dash;
      state.focusHeld = held.focus;
      state.focusPressed = held.focus && !prev.focus;
      state.focusReleased = !held.focus && prev.focus;
      state.sprintHeld = held.sprint;
      state.nextArrow = held.next && !prev.next;
      state.arrowSlot = held.slot !== prev.slot ? held.slot : 0;
      state.device = held.device;
      Object.assign(prev, held);
    },
  };
  return api;
}

// ── time ──────────────────────────────────────────────────────────────────────
function createLabTime(): TimeControl & { step(dtReal: number): number } {
  let scale = 1;
  let target = 1;
  let rate = 1;
  let stop = 0;
  let t = 0;
  let real = 0;
  return {
    get scale() {
      return scale;
    },
    setScale(tg, ease = 0.3) {
      target = tg;
      rate = Math.abs(tg - scale) / Math.max(1e-3, ease);
      if (ease <= 0) scale = tg;
    },
    hitStop(sec) {
      stop = Math.max(stop, sec);
    },
    get t() {
      return t;
    },
    get real() {
      return real;
    },
    step(dtReal) {
      real += dtReal;
      const d = target - scale;
      if (d !== 0) scale += Math.sign(d) * Math.min(Math.abs(d), rate * dtReal);
      if (stop > 0) {
        stop -= dtReal;
        return 0;
      }
      const dt = dtReal * scale;
      t += dt;
      return dt;
    },
  };
}

// ── arena ─────────────────────────────────────────────────────────────────────
function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function speckle(base: string, dots: string[], n: number) {
  return (g: CanvasRenderingContext2D, s: number) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) {
      g.fillStyle = dots[i % dots.length];
      g.globalAlpha = 0.25 + Math.random() * 0.4;
      const r = 1 + Math.random() * 3;
      g.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
    g.globalAlpha = 1;
  };
}

async function buildArena(ctx: GameContext, physicsAddPlatform: (o: THREE.Mesh) => void) {
  const root = ctx.engine.levelRoot;
  const tex = await tryLoad(texMods, 'textures');
  const mat = (name: string, fallback: THREE.Material) => {
    try {
      return tex?.makeMaterial?.(name) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const heightAt = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const bowl = d > 34 ? (d - 34) * 0.35 : 0; // rim so you cannot walk off
    return fbm2(x * 0.03, z * 0.03, 3, 7) * 0.6 + bowl;
  };
  ctx.physics.setTerrain(heightAt, 'grass');
  ctx.physics.killY = -30;
  const geo = new THREE.PlaneGeometry(110, 110, 110, 110).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    mat('grass', new THREE.MeshStandardMaterial({ map: canvasTexture(speckle('#4e5a32', ['#3a4626', '#6a7040', '#5a4a30'], 4000), 256, 40), roughness: 0.95 })),
  );
  ground.receiveShadow = true;
  root.add(ground);

  const stone = mat('stone_blocks', new THREE.MeshStandardMaterial({ map: canvasTexture(speckle('#7a756a', ['#5a564e', '#9a958a'], 2500), 256, 1), roughness: 0.85 }));
  const wood = mat('wood_planks', new THREE.MeshStandardMaterial({ map: canvasTexture(speckle('#6a4a2c', ['#4a321c', '#8a6a44'], 2000), 256, 1), roughness: 0.8 }));
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0, m: THREE.Material = stone, material: 'stone' | 'wood' = 'stone') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return { mesh, h: ctx.physics.addBox(mesh.position, [hx, hy, hz], yaw, { material }) };
  };
  // steps and crates
  box(-3, 0.15, 4, 1, 0.15, 1);
  box(-3, 0.4, 6, 1, 0.4, 1);
  box(4.5, 0.6, 7, 0.6, 0.6, 0.6, 0.4, wood, 'wood');
  box(5.6, 0.45, 8.2, 0.45, 0.45, 0.45, -0.2, wood, 'wood');
  box(-12, 1.5, 12, 0.5, 1.5, 5, 0.2); // wall
  box(12, 1.2, 18, 3, 1.2, 0.5, -0.3); // low wall (cover)
  // ramp (BVH mesh) up to a platform
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 7), stone);
  ramp.position.set(-7, 1.0, 22);
  ramp.rotation.x = -Math.atan2(2.0, 7);
  ramp.castShadow = ramp.receiveShadow = true;
  root.add(ramp);
  ctx.physics.addMesh(ramp, { material: 'stone' });
  box(-7, 1.0, 27.4, 2.2, 1.0, 2.2);
  // pillars
  for (const [x, z] of [[8, 12], [-6, 30], [10, 28], [3, 36]] as [number, number][]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 5, 16), stone);
    p.position.set(x, 2.5, z);
    p.castShadow = p.receiveShadow = true;
    root.add(p);
    ctx.physics.addCylinder(x, z, 0.6, 0, 5, { material: 'stone' });
  }
  // moving platform
  const plat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 3), wood);
  plat.castShadow = plat.receiveShadow = true;
  root.add(plat);
  physicsAddPlatform(plat);
}

// ── scripts ───────────────────────────────────────────────────────────────────
type Patch = Partial<Held>;
type Step = { t0: number; t1: number; set?: Patch; run?: (g: Lab) => void; ran?: boolean };
interface Lab {
  ctx: GameContext;
  aimAt(c: Combatant | THREE.Vector3, part?: 'head' | 'aim'): void;
  find(name: string): Combatant | undefined;
  teleportNear(c: Combatant, dist: number): void;
}

function scripts(name: string): Step[] {
  const tap = (t: number, k: keyof Held): Step => ({ t0: t, t1: t + 0.05, set: { [k]: true } as Patch });
  switch (name) {
    case 'move':
      return [
        { t0: 0, t1: 1.4, set: { moveY: 1 } },
        tap(0.9, 'jump'),
        tap(1.25, 'jump'),
        { t0: 1.4, t1: 2.6, set: { moveY: 1, moveX: 0.6, sprint: true } },
        tap(2.0, 'dash'),
        { t0: 2.6, t1: 4, set: { moveY: 1, lookX: -0.6 } },
      ];
    case 'shoot':
      return [
        { t0: 0, t1: 0.01, run: (g) => g.aimAt(g.find('orc')!, 'aim') },
        { t0: 0.05, t1: 1.0, set: { aim: true, draw: true }, run: (g) => g.aimAt(g.find('orc')!, 'aim') },
        { t0: 1.0, t1: 1.3, set: { aim: true } },
        { t0: 1.3, t1: 1.31, run: (g) => g.aimAt(g.find('goblin')!, 'head') },
        { t0: 1.32, t1: 2.1, set: { aim: true, draw: true }, run: (g) => g.aimAt(g.find('goblin')!, 'head') },
        { t0: 2.1, t1: 2.3, set: { aim: true } },
        // quick hip shots
        { t0: 2.3, t1: 2.36, set: { draw: true }, run: (g) => g.aimAt(g.find('uruk')!, 'aim') },
        { t0: 2.6, t1: 2.66, set: { draw: true } },
        { t0: 2.9, t1: 3.5, set: { aim: true, draw: true } },
      ];
    case 'knives':
      return [
        { t0: 0, t1: 0.01, run: (g) => g.teleportNear(g.find('orc')!, 2.2) },
        tap(0.1, 'melee'),
        tap(0.35, 'melee'),
        tap(0.65, 'melee'),
        tap(1.6, 'melee'),
        tap(1.85, 'melee'),
        tap(2.15, 'melee'),
      ];
    case 'focus':
      return [
        { t0: 0, t1: 0.01, run: (g) => g.aimAt(new THREE.Vector3(-14, 1.2, 18)) },
        { t0: 0.1, t1: 1.9, set: { focus: true, lookX: -0.9 } },
        { t0: 1.9, t1: 4, set: {} },
      ];
    case 'focuspad':
      return [
        { t0: 0, t1: 0.01, run: (g) => g.aimAt(new THREE.Vector3(0, 1.2, 20)) },
        { t0: 0.1, t1: 1.2, set: { focus: true, device: 'gamepad' } },
        { t0: 1.2, t1: 4, set: { device: 'gamepad' } },
      ];
    case 'troll': {
      // repeated full-draw head shots
      const out: Step[] = [];
      for (let i = 0; i < 12; i++) {
        const t = i * 0.85;
        out.push({ t0: t, t1: t + 0.7, set: { aim: true, draw: true }, run: (g) => g.aimAt(g.find('troll')!, 'head') });
        out.push({ t0: t + 0.7, t1: t + 0.85, set: { aim: true } });
      }
      return out;
    }
    case 'pierce':
      return [
        { t0: 0, t1: 0.05, set: { slot: 2 } },
        { t0: 0.1, t1: 0.9, set: { aim: true, draw: true }, run: (g) => g.aimAt(new THREE.Vector3(0, 1.3, 20)) },
        { t0: 0.9, t1: 1.0, set: { slot: 3, aim: true } },
        { t0: 1.1, t1: 1.9, set: { aim: true, draw: true }, run: (g) => g.aimAt(g.find('uruk')!, 'aim') },
        { t0: 1.9, t1: 2.5, set: { aim: true } },
      ];
    case 'platform':
      return [{ t0: 0, t1: 0.01, run: (g) => g.ctx.player.teleport(new THREE.Vector3(9, 1.2, 3), 0) }];
    case 'mover':
      return [
        {
          t0: 0,
          t1: 0.01,
          run: (g) => {
            const p = g.ctx.player;
            let s = 0;
            p.mover = {
              update(dt, pl) {
                s += dt;
                pl.velocity.set(Math.sin(s) * 3, 0, 6);
                pl.position.addScaledVector(pl.velocity, dt);
                pl.facing = Math.atan2(pl.velocity.x, pl.velocity.z);
              },
              pose: 'surf',
              allowShoot: true,
              lockCameraYaw: true,
              camera: { distance: 4.5, fov: 64 },
            };
          },
        },
        { t0: 1.0, t1: 1.8, set: { aim: true, draw: true } },
        { t0: 2.6, t1: 2.61, run: (g) => (g.ctx.player.mover = null) },
      ];
    case 'all':
      return [
        ...scripts('move'),
        ...scripts('shoot').map((s) => ({ ...s, t0: s.t0 + 4.2, t1: s.t1 + 4.2 })),
        ...scripts('focus').map((s) => ({ ...s, t0: s.t0 + 8, t1: s.t1 + 8 })),
      ];
    default:
      return [];
  }
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function main() {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const dbg = document.getElementById('dbg')!;

  const engMod = await tryLoad(engineMods, 'engine');
  let engine: Engine;
  try {
    engine = engMod?.createEngine ? engMod.createEngine(app, quality) : stubEngine(app);
  } catch (e) {
    console.warn('[play] createEngine failed, using a plain renderer', e);
    engine = stubEngine(app);
  }
  const envMod = await tryLoad(envMods, 'environment');
  try {
    if (envMod?.ENVIRONMENTS?.arena) engine.setEnvironment('arena');
  } catch (e) {
    console.warn('[play] setEnvironment failed', e);
  }
  const fxMod = await tryLoad(fxMods, 'fx');
  let fx: Fx;
  try {
    fx = fxMod?.createFx ? fxMod.createFx(engine) : stubFx();
  } catch (e) {
    console.warn('[play] createFx failed', e);
    fx = stubFx();
  }
  const hudMod = await tryLoad(hudMods, 'hud');
  let hud: Hud;
  try {
    hud = hudMod?.createHud ? hudMod.createHud(ui) : stubHud(ui);
  } catch (e) {
    console.warn('[play] createHud failed', e);
    hud = stubHud(ui);
  }
  hud.show(true);
  const audMod = await tryLoad(audioMods, 'audio');
  let audio: AudioSys;
  try {
    audio = audMod?.createAudio ? audMod.createAudio() : stubAudio();
  } catch (e) {
    console.warn('[play] createAudio failed', e);
    audio = stubAudio();
  }
  addEventListener('pointerdown', () => audio.unlock(), { once: true });

  const input = createLabInput(engine.canvas);
  input.scripted = !!scriptName;
  const time = createLabTime();
  const physics = createPhysics();
  const combatants = createRegistry();
  const settings: Settings = {
    difficulty: (params.get('difficulty') as Settings['difficulty']) ?? 'normal',
    quality,
    sensitivity: 1,
    invertY: false,
    master: 1,
    music: 1,
    sfx: 1,
    subtitles: true,
    aimAssist: params.get('assist') === '1',
    showFps: false,
  };
  const progression = {
    data: { settings },
    stats: () => ({ ...DEFAULT_STATS }),
    unlockedArrows: () => ['standard', 'piercing', 'triple'],
  } as unknown as Progression;
  const flags: Record<string, string> = Object.fromEntries(params.entries());
  const ctx = {
    engine,
    input,
    audio,
    fx,
    hud,
    menus: {} as Menus,
    physics,
    combatants,
    time,
    progression,
    settings,
    flags,
  } as unknown as GameContext;

  // moving platform (collider follows, velocity carried)
  let platMesh: THREE.Mesh | null = null;
  let platHandle: ReturnType<typeof physics.addBox> | null = null;
  await buildArena(ctx, (m) => {
    platMesh = m;
    m.position.set(9, 0.9, 3);
    platHandle = physics.addBox(m.position, [1.5, 0.2, 1.5], 0, { material: 'wood', tag: 'platform' });
  });
  const platBase = new THREE.Vector3(9, 0.9, 3);
  let platClock = 0;
  const updatePlatform = (dt: number) => {
    if (!platMesh || !platHandle) return;
    platClock += dt;
    const x = platBase.x + Math.sin(platClock * 0.6) * 4;
    const y = platBase.y + Math.max(0, Math.sin(platClock * 0.3)) * 1.2;
    platMesh.position.set(x, y, platBase.z);
    platHandle.setTransform(platMesh.position, 0);
  };

  const player = createPlayer(ctx);
  ctx.player = player;
  ctx.projectiles = createProjectiles(ctx);
  ctx.rivalry = createRivalry(ctx);
  player.teleport(new THREE.Vector3(0, 0, 0), 0);

  // squad
  let list = (params.get('enemies') ?? 'orc,orc,goblin,uruk,orc_archer,uruk_archer,berserker,troll').split(',') as EnemyArchetype[];
  const count = Number(params.get('n') ?? '0');
  if (count > list.length) list = Array.from({ length: count }, (_, i) => list[i % list.length]);
  const spots: [number, number][] = [
    [-2, 16],
    [2.5, 17],
    [0.5, 20],
    [4.5, 21],
    [-9, 26],
    [9, 30],
    [-5, 23],
    [0, 33],
  ];
  const enemies = list.map((a, i) => {
    const [x, z] = spots[i % spots.length];
    const e = createEnemy(ctx, { archetype: a, seed: 100 + i, behavior: a.includes('archer') ? 'hold' : undefined }, new THREE.Vector3(x, 0, z + Math.floor(i / spots.length) * 4), Math.PI);
    if (params.get('ai') === '0') e.aiEnabled = false;
    combatants.add(e);
    return e;
  });
  if (params.get('gimli') !== '0') {
    const gimli = createAlly(ctx, { kind: 'gimli', rivalry: true, anchor: 'player' }, new THREE.Vector3(-2.2, 0, -1.2), 0);
    if (params.get('ai') === '0') gimli.aiEnabled = false;
    combatants.add(gimli);
  }
  ctx.rivalry.autoGimli = params.get('auto') === '1';
  ctx.rivalry.start({ legolas: 0, gimli: 0 });

  window.scene = engine.scene;
  window.__THREE_CAMERA__ = engine.camera;
  window.__renderer__ = engine.renderer;
  addEventListener('resize', () => engine.resize());

  // ── simulation ──
  const timeline = scriptName ? scripts(scriptName) : [];
  let simReal = 0;
  const lab: Lab = {
    ctx,
    find: (name) => enemies.find((e) => e.alive && (e.name === name || e.spec.archetype === name)) ?? enemies.find((e) => e.name === name),
    aimAt(c, part = 'aim') {
      const p = new THREE.Vector3();
      if (c instanceof THREE.Vector3) p.copy(c);
      else if (part === 'head' && (c as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 }).headPoint) (c as Combatant & { headPoint: (o: THREE.Vector3) => THREE.Vector3 }).headPoint(p);
      else c.aimPoint(p);
      const cam = player.camera as CameraRigExt;
      // iterate: the camera position depends on yaw/pitch (shoulder offset)
      for (let i = 0; i < 4; i++) {
        cam.update(0);
        const from = cam.position;
        const d = p.clone().sub(from);
        cam.yaw = Math.atan2(d.x, d.z);
        cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      }
      cam.update(0);
    },
    teleportNear(c, dist) {
      const dir = new THREE.Vector3().subVectors(player.position, c.position).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
      dir.normalize();
      const at = c.position.clone().addScaledVector(dir, dist + c.radius);
      player.teleport(at, Math.atan2(-dir.x, -dir.z));
    },
  };

  function applyScript() {
    const h = input.held;
    const base = blankHeld();
    Object.assign(h, base);
    for (const s of timeline) {
      if (simReal >= s.t0 && simReal < s.t1) {
        if (s.set) Object.assign(h, s.set);
        if (s.run && (!s.ran || s.t1 - s.t0 > 0.02)) {
          s.run(lab);
          s.ran = true;
        }
      } else if (s.run && !s.ran && simReal >= s.t1) {
        s.run(lab);
        s.ran = true;
      }
    }
  }

  // inspect=<name>&inspectAt=<sec>: close-up scripted camera on a combatant (verifies arrows, poses)
  const inspect = params.get('inspect');
  const inspectAt = Number(params.get('inspectAt') ?? '0');
  const inspectDist = Number(params.get('inspectDist') ?? '2.2');
  const inspectYaw = Number(params.get('inspectYaw') ?? '0.6');
  function applyInspect() {
    if (!inspect || simReal < inspectAt) return;
    const c: Combatant | undefined = inspect === 'player' ? player : enemies.find((e) => e.name === inspect || e.spec.archetype === inspect);
    if (!c) return;
    const look = c.position.clone().setY(c.position.y + c.height * 0.6);
    const toPlayer = new THREE.Vector3().subVectors(player.position, c.position).setY(0).normalize();
    if (c === player) toPlayer.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    toPlayer.applyAxisAngle(new THREE.Vector3(0, 1, 0), inspectYaw);
    const pos = look.clone().addScaledVector(toPlayer, inspectDist * Math.max(1, c.height / 1.9)).setY(look.y + 0.3);
    player.camera.shot = { position: pos, lookAt: look, fov: 50, blend: 0 };
  }

  function step(dtReal: number) {
    if (input.scripted) applyScript();
    applyInspect();
    input.frameDt = dtReal;
    input.poll();
    const dt = time.step(dtReal);
    player.update(dt);
    updatePlatform(dt);
    combatants.update(dt);
    ctx.projectiles.update(dt);
    fx.update(dt, engine.camera);
    ctx.rivalry.update(dt);
    player.camera.update(dtReal);
    hud.update(dtReal);
    audio.update(dtReal);
    simReal += dtReal;
  }

  // zones=1: wireframe overlay of every combatant's hit zones
  const zoneRoot = new THREE.Group();
  engine.scene.add(zoneRoot);
  const zoneMats: Record<string, THREE.LineBasicMaterial> = {
    head: new THREE.LineBasicMaterial({ color: 0xff4040 }),
    weakpoint: new THREE.LineBasicMaterial({ color: 0xff40ff }),
    body: new THREE.LineBasicMaterial({ color: 0xffd040 }),
    limb: new THREE.LineBasicMaterial({ color: 0x40d0ff }),
    armor: new THREE.LineBasicMaterial({ color: 0xa0a0a0 }),
  };
  function drawZones() {
    for (const c of zoneRoot.children.slice()) {
      c.removeFromParent();
      (c as THREE.LineSegments).geometry.dispose();
    }
    for (const c of combatants.all()) {
      const dz = (c as unknown as { debugZones?: () => { a: THREE.Vector3; b: THREE.Vector3; radius: number; zone: string }[] }).debugZones;
      if (!dz || !c.alive) continue;
      for (const z of dz.call(c)) {
        const len = z.a.distanceTo(z.b);
        const geo = new THREE.WireframeGeometry(len > 1e-3 ? new THREE.CapsuleGeometry(z.radius, len, 3, 8) : new THREE.SphereGeometry(z.radius, 8, 6));
        const m = new THREE.LineSegments(geo, zoneMats[z.zone] ?? zoneMats.body);
        m.position.copy(z.a).lerp(z.b, 0.5);
        if (len > 1e-3) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), z.b.clone().sub(z.a).normalize());
        zoneRoot.add(m);
      }
    }
  }

  const state = () => ({
    t: +time.t.toFixed(3),
    real: +simReal.toFixed(3),
    scale: +time.scale.toFixed(3),
    standins: usingStandins(),
    hp: +player.hp.toFixed(1),
    focus: +player.focus.toFixed(1),
    focusActive: player.focusActive,
    grounded: player.grounded,
    playerPos: player.position.toArray().map((v) => +v.toFixed(2)),
    facing: +player.facing.toFixed(2),
    tally: { ...player.tally },
    rivalry: { legolas: ctx.rivalry.legolas, gimli: ctx.rivalry.gimli },
    arrows: { flying: (ctx.projectiles as ProjectilesExt).flying, stuck: (ctx.projectiles as ProjectilesExt).stuck },
    enemies: enemies.map((e) => ({ n: e.name, hp: Math.round(e.hp), alive: e.alive, p: e.position.toArray().map((v) => +v.toFixed(1)) })),
    kills: player.tally.kills,
  });

  window.__game = {
    advance(sec: number, stepSec = STEP) {
      const n = Math.max(1, Math.round(sec / stepSec));
      for (let i = 0; i < n; i++) step(stepSec);
    },
    state,
    startChapter: async () => {},
    bot: () => {},
    ctx,
    /** test helper: spawn an enemy; returns its index in state().enemies */
    spawn(spec: Parameters<typeof createEnemy>[1], at: [number, number, number], moveTarget?: [number, number, number]) {
      const e = createEnemy(ctx, spec, new THREE.Vector3(...at), Math.PI);
      if (moveTarget) e.moveTarget = new THREE.Vector3(...moveTarget);
      enemies.push(e);
      return enemies.length - 1;
    },
    /** test helper: add a visible box collider */
    box(c: [number, number, number], h: [number, number, number]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2), new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.9 }));
      m.position.set(...c);
      m.castShadow = m.receiveShadow = true;
      engine.levelRoot.add(m);
      physics.addBox(m.position, h, 0, { material: 'stone' });
    },
  };

  // ── loop ──
  let last = performance.now();
  let frames = 0;
  const loop = () => {
    const now = performance.now();
    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!input.scripted) step(dtReal);
    if (params.get('zones') === '1') drawZones();
    engine.render(dtReal);
    if (input.scripted) hud.update(dtReal);
    const s = state();
    dbg.textContent = `t=${s.t} hp=${s.hp} focus=${s.focus} kills=${s.kills} shots=${s.tally.shots} hits=${s.tally.hits} arrows=${s.arrows.flying}/${s.arrows.stuck} ${usingStandins() ? '[stand-ins]' : ''}`;
    if (++frames === 2) window.__snapReady = true;
    requestAnimationFrame(loop);
  };
  // settle one step so everything has a pose before the first frame
  step(STEP);
  requestAnimationFrame(loop);
}

main().catch((e) => {
  console.error(e);
  window.__snapError = String((e as Error)?.stack ?? e);
});
