/**
 * Environment Lab: showcase every environment preset through createEngine + createFx.
 *
 *   /lab/env.html?env=<name>&q=<quality>
 *
 * URL params
 *   env=mirkwood|forest_river|laketown_night|ravenhill_winter|moria|amon_hen|helms_deep_storm|
 *       pelennor|black_gate|menu|lab|arena            (default arena)
 *   q=low|medium|high|ultra                           (default medium)
 *   view=hero|wide|sky|low|top                        camera preset (default hero)
 *   yaw=<deg>                                         rotate the camera around the hero (to face the sun)
 *   pitch=<deg>  fov=<deg>  dist=<m>                  camera tweaks
 *   warm=<sec>                                        pre-simulate particles/weather (default 5)
 *   weather=<kind>|off                                override the preset's weather
 *   fire=0                                            hide the test fire
 *   props=0                                           hide spheres/boxes
 *   trees=0|1                                         canopy/pillars (default: on where shafts are used)
 *   still=0                                           keep animating after ready (default 1: freeze for snapshots)
 *   hud=1                                             show an info overlay
 *   lightning=1                                       trigger lightning shortly after load
 *   explode=1 | blood=1 | sparks=1 | splash=1         spawn a one-off effect in front of the camera
 *
 * Test hooks: window.__snapReady, window.scene, window.__THREE_CAMERA__, window.__renderer__,
 * window.__env = { engine, fx, setEnv(name), step(sec) }.
 */
import * as THREE from 'three';
import { createEngine, getEngineInternals } from '../src/core/engine';
import { createFx } from '../src/core/fx';
import { ENVIRONMENTS } from '../src/core/environment';
import { fbm2, hashSeed, mulberry32, noise2 } from '../src/core/rng';
import type { EnvironmentName, Quality, WeatherKind } from '../src/core/types';

const params = new URLSearchParams(location.search);
const envName = (params.get('env') ?? 'arena') as EnvironmentName;
const quality = (params.get('q') ?? 'medium') as Quality;
const view = params.get('view') ?? 'hero';
const yawDeg = Number(params.get('yaw') ?? '0');
const warm = Number(params.get('warm') ?? '5');
const still = params.get('still') !== '0';
const w = window as unknown as Record<string, unknown>;

const host = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
if (params.get('hud') === '1') hud.classList.remove('hidden');

if (!(envName in ENVIRONMENTS)) {
  w.__snapError = `unknown env "${envName}"`;
  throw new Error(`unknown env ${envName}`);
}

const engine = createEngine(host, quality);
const fx = createFx(engine);
engine.setEnvironment(envName);
const preset = engine.env;
// quick look-dev overrides
{
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const p = engine.post;
  p.bloomStrength = num('bloom') ?? p.bloomStrength;
  p.exposure = num('exposure') ?? p.exposure;
  p.vignette = num('vig') ?? p.vignette;
  p.grain = num('grain') ?? p.grain;
  p.saturation = num('sat') ?? p.saturation;
  p.letterbox = num('letterbox') ?? p.letterbox;
  p.damageFlash = num('damage') ?? p.damageFlash;
  p.focusTint = num('focus') ?? p.focusTint;
  const fd = num('fogd');
  if (fd !== undefined && engine.scene.fog) (engine.scene.fog as THREE.FogExp2).density = fd;
  const it = getEngineInternals(engine);
  const du = it ? (it.sky as unknown as { domeMat: THREE.ShaderMaterial }).domeMat.uniforms : null;
  if (du) {
    if (params.has('cover')) du.uCover.value = Number(params.get('cover'));
    if (params.has('soft')) du.uSoft.value = Number(params.get('soft'));
    if (params.has('cscale')) du.uCloudScale.value = Number(params.get('cscale'));
  }
  if (params.get('dof') === '1') p.dof = { enabled: true, focus: num('dofd') ?? 6, aperture: num('aperture') ?? 0.0003 };
}
w.scene = engine.scene;
w.__THREE_CAMERA__ = engine.camera;
w.__renderer__ = engine.renderer;

// ── procedural textures ─────────────────────────────────────────────────────
type Palette = { a: string; b: string; c: string; rough: number; scale: number };
const GROUND: Record<string, Palette> = {
  mirkwood: { a: '#1b2618', b: '#2c3b20', c: '#0f140c', rough: 0.95, scale: 1 },
  forest_river: { a: '#3f5a2a', b: '#586e34', c: '#2b3a1c', rough: 0.95, scale: 1 },
  laketown_night: { a: '#4a3b2b', b: '#5b4a35', c: '#2a2118', rough: 0.7, scale: 0.6 },
  ravenhill_winter: { a: '#dfe6ee', b: '#f4f8fc', c: '#aab5c2', rough: 0.85, scale: 1.4 },
  moria: { a: '#35332f', b: '#4a4741', c: '#1c1b19', rough: 0.8, scale: 0.7 },
  amon_hen: { a: '#5c4a2a', b: '#78602f', c: '#3b3320', rough: 0.95, scale: 1 },
  helms_deep_storm: { a: '#3a3d40', b: '#52565a', c: '#23262a', rough: 0.55, scale: 0.7 },
  pelennor: { a: '#6b6a3a', b: '#8a8447', c: '#4a4a28', rough: 0.95, scale: 1.2 },
  black_gate: { a: '#2b2420', b: '#413630', c: '#14100e', rough: 0.9, scale: 1 },
  menu: { a: '#4d4538', b: '#6a5d4a', c: '#2f2a22', rough: 0.9, scale: 1 },
  lab: { a: '#4a4740', b: '#5a564d', c: '#34322d', rough: 0.9, scale: 1 },
  arena: { a: '#6a7a52', b: '#889468', c: '#505f3c', rough: 0.92, scale: 1 },
};

function makeGroundTextures(p: Palette): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const S = 512;
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const cg = col.getContext('2d')!;
  const img = cg.createImageData(S, S);
  const hmap = new Float32Array(S * S);
  const A = new THREE.Color(p.a), B = new THREE.Color(p.b), C = new THREE.Color(p.c);
  const tmp = new THREE.Color();
  const n = noise2(7);
  // tileable fbm: sample a torus so the texture wraps seamlessly
  const tor = (u: number, v: number, k: number, o: number) => {
    const a1 = u * Math.PI * 2, a2 = v * Math.PI * 2;
    return n(Math.cos(a1) * k + o, Math.sin(a1) * k + Math.cos(a2) * k) * 0.5 + n(Math.sin(a2) * k + o + 9.1, Math.cos(a1) * k + Math.sin(a2) * k + 3.3) * 0.5;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const h = 0.5 + 0.5 * (tor(u, v, 1.6, 0) * 0.45 + tor(u, v, 4.2, 3) * 0.3 + tor(u, v, 11, 7) * 0.17 + tor(u, v, 26, 11) * 0.08);
      const grain = tor(u, v, 55, 21) * 0.5 + 0.5;
      hmap[y * S + x] = h;
      tmp.copy(A).lerp(B, THREE.MathUtils.smoothstep(h, 0.38, 0.72));
      tmp.lerp(C, THREE.MathUtils.smoothstep(0.46 - h, 0.0, 0.22) * 0.75);
      tmp.multiplyScalar(0.86 + grain * 0.28);
      const o = (y * S + x) * 4;
      const s = tmp.clone().convertLinearToSRGB();
      img.data[o] = Math.round(s.r * 255);
      img.data[o + 1] = Math.round(s.g * 255);
      img.data[o + 2] = Math.round(s.b * 255);
      img.data[o + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);

  const nrm = document.createElement('canvas');
  nrm.width = nrm.height = S;
  const ng = nrm.getContext('2d')!;
  const nimg = ng.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hL = hmap[y * S + ((x + S - 2) % S)], hR = hmap[y * S + ((x + 2) % S)];
      const hD = hmap[((y + S - 2) % S) * S + x], hU = hmap[((y + 2) % S) * S + x];
      const nx = (hL - hR) * 1.1, ny = (hD - hU) * 1.1;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const o = (y * S + x) * 4;
      nimg.data[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      nimg.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nimg.data[o + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);

  const rc = document.createElement('canvas');
  rc.width = rc.height = S;
  const rg = rc.getContext('2d')!;
  const rimg = rg.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const r = THREE.MathUtils.clamp(p.rough + (hmap[i] - 0.5) * 0.25, 0.1, 1);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.round(r * 255);
    rimg.data[i * 4 + 3] = 255;
  }
  rg.putImageData(rimg, 0, 0);

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(col, true), normal: mk(nrm, false), rough: mk(rc, false) };
}

const gp = GROUND[envName] ?? GROUND.arena;
const gt = makeGroundTextures(gp);
const repeat = 240 / gp.scale;
for (const t of [gt.map, gt.normal, gt.rough]) t.repeat.set(repeat, repeat);

const level = engine.levelRoot;
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(600, 96).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, roughnessMap: gt.rough, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }),
);
ground.name = 'ground';
ground.receiveShadow = true;
level.add(ground);

// ── props ───────────────────────────────────────────────────────────────────
const rng = mulberry32(hashSeed('env-lab', envName));
const show = params.get('props') !== '0';
if (show) {
  const mats: [number, number, number][] = [
    [0xb02a22, 0.0, 0.55], // red dielectric
    [0xe8e6e0, 0.0, 0.25], // white plastic
    [0xd9b04c, 1.0, 0.22], // gold
    [0xb9bcc0, 1.0, 0.45], // steel
    [0x2d3a52, 0.0, 0.85], // rough blue stone
  ];
  mats.forEach(([color, metal, rough], i) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 48, 24),
      new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }),
    );
    m.position.set(-4 + i * 2, 0.55, 5.5);
    m.castShadow = m.receiveShadow = true;
    level.add(m);
  });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.8, map: gt.map, normalMap: gt.normal });
  for (let i = 0; i < 4; i++) {
    const s = 0.7 + rng() * 1.1;
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), boxMat);
    b.position.set(-6 + i * 3.8 + rng(), s / 2, 9.5 + rng() * 2);
    b.rotation.y = rng() * 3;
    b.castShadow = b.receiveShadow = true;
    level.add(b);
  }
  // stone wall segment (large occluder / receiver)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.9, map: gt.map, normalMap: gt.normal }));
  wall.position.set(-3, 1.6, 16);
  wall.castShadow = wall.receiveShadow = true;
  level.add(wall);
}

// capsule figure (Legolas-sized)
const figure = new THREE.Group();
figure.name = 'figure';
{
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 1.0, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.85 }),
  );
  body.position.y = 0.74;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe6c3a5, roughness: 0.6 }));
  head.position.y = 1.7;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0xcdb27a, roughness: 0.5 }));
  hair.position.y = 1.72;
  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 }));
  quiver.position.set(0.12, 1.15, -0.28);
  quiver.rotation.z = -0.25;
  for (const m of [body, head, hair, quiver]) {
    m.castShadow = m.receiveShadow = true;
    figure.add(m);
  }
}
if (params.get('figure') !== '0' && view !== 'fx') level.add(figure);

// ── canopy / pillars (shadow casters for the light shafts) ──────────────────
const treesParam = params.get('trees');
const wantTrees = treesParam !== null ? treesParam === '1' : ['mirkwood', 'amon_hen', 'moria', 'forest_river'].includes(envName);
if (wantTrees) {
  const dark = new THREE.MeshStandardMaterial({ color: envName === 'moria' ? 0x2a2824 : 0x2b2418, roughness: 0.95, map: gt.map, normalMap: gt.normal });
  if (envName === 'moria') {
    // carved pillars + a ceiling made of slabs with gaps
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3;
      const rad = 7 + (i % 3) * 5;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 16, 16), dark);
      p.position.set(Math.cos(a) * rad, 8, 6 + Math.sin(a) * rad);
      p.castShadow = p.receiveShadow = true;
      level.add(p);
    }
    for (let ix = -4; ix <= 4; ix++) {
      for (let iz = -2; iz <= 5; iz++) {
        if (rng() < 0.18) continue; // gap -> shaft
        const s = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.5, 5.4), dark);
        s.position.set(ix * 6, 17, iz * 6 + 4);
        s.castShadow = s.receiveShadow = true;
        level.add(s);
      }
    }
  } else {
    const bark = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.95, map: gt.map, normalMap: gt.normal });
    const leaf = new THREE.MeshStandardMaterial({ color: envName === 'mirkwood' ? 0x16251a : 0x2e4a24, roughness: 0.9 });
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rad = 4 + rng() * 38;
      const x = Math.cos(a) * rad, z = 6 + Math.sin(a) * rad;
      if (Math.hypot(x, z - 3) < 3) continue;
      const h = 17 + rng() * 9;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.35 + rng() * 0.2, 0.7 + rng() * 0.3, h, 10), bark);
      t.position.set(x, h / 2, z);
      t.castShadow = t.receiveShadow = true;
      level.add(t);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(3.2 + rng() * 2.6, 12, 8), leaf);
        c.scale.y = 0.38;
        c.position.set(x + (rng() - 0.5) * 5, h - 0.5 + rng() * 2.5, z + (rng() - 0.5) * 5);
        c.castShadow = true;
        level.add(c);
      }
    }
  }
}

// ── camera ──────────────────────────────────────────────────────────────────
const cam = engine.camera;
cam.fov = Number(params.get('fov') ?? (view === 'wide' ? 70 : 58));
const camDist = Number(params.get('dist') ?? (view === 'top' ? 24 : 5.2));
const camPitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? (view === 'sky' ? 22 : view === 'low' ? 8 : view === 'top' ? -55 : -5)));
const yaw = THREE.MathUtils.degToRad(yawDeg);
const target = new THREE.Vector3(0.3, view === 'sky' ? 2.5 : 1.45, 4.5);
const behind = new THREE.Vector3(Math.sin(yaw + Math.PI), 0, Math.cos(yaw + Math.PI));
cam.position.set(target.x + behind.x * camDist + 0.0, view === 'low' ? 0.8 : view === 'top' ? 20 : 1.85, 0.0 + behind.z * camDist + 2.2);
const aim = new THREE.Vector3(
  cam.position.x - behind.x * 20,
  cam.position.y + Math.tan(camPitch) * 20,
  cam.position.z - behind.z * 20,
);
if (view === 'top') aim.set(0, 0, 8);
if (view === 'fx') {
  cam.position.set(0, 1.5, 1.0);
  aim.set(0, 1.25, 6);
  cam.fov = Number(params.get('fov') ?? 50);
}
cam.lookAt(aim);
engine.shadowFocus.set(0, 0, 4);

// ── fire + weather ─────────────────────────────────────────────────────────
if (params.get('fire') !== '0') {
  const fp = (params.get('firepos') ?? '3.6,0.05,3.2').split(',').map(Number);
  fx.fire(new THREE.Vector3(fp[0], fp[1], fp[2]), Number(params.get('firescale') ?? 1));
  // a small brazier base so the fire sits on something
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.7, metalness: 0.5 }));
  base.position.set(fp[0], fp[1] + 0.1, fp[2]);
  base.castShadow = true;
  level.add(base);
}
const weatherParam = params.get('weather');
const weather: WeatherKind = weatherParam === 'off' ? 'none' : ((weatherParam as WeatherKind | null) ?? preset.weather ?? 'none');
fx.setWeather(weather, preset.weatherIntensity ?? 1);
if (params.get('smoke') === '1') fx.smoke(new THREE.Vector3(-6, 0, 14), 2.0);

// one-off effects for testing
const front = new THREE.Vector3(0.4, 1.0, 5.5);
if (params.get('explode') === '1') fx.explosion(new THREE.Vector3(0, 0.3, 9), 1.5);
if (params.get('blood')) {
  const kind = (params.get('blood') === '1' ? 'red' : params.get('blood')) as 'red' | 'dark' | 'black' | 'ichor';
  const bp = (params.get('bpos') ?? '0.3,1.3,3').split(',').map(Number);
  fx.blood(new THREE.Vector3(bp[0], bp[1], bp[2]), new THREE.Vector3(0.3, 0.2, 1).normalize(), kind, 2);
  fx.blood(new THREE.Vector3(bp[0] - 1.7, bp[1] - 0.1, bp[2] - 0.8), new THREE.Vector3(-0.5, 0.3, 1).normalize(), kind, 1.5);
}
if (params.get('sparks') === '1') fx.sparks(front, new THREE.Vector3(0, 0.5, -1).normalize(), 2);
if (params.get('splash') === '1') fx.splash(new THREE.Vector3(0.5, 0.0, 5), 1.5);
if (params.get('debris') === '1') fx.debris(new THREE.Vector3(0.5, 0.5, 7), 1.5);
if (params.get('dust') === '1') fx.dust(new THREE.Vector3(0.5, 0.2, 6), 1.5);
if (params.get('torch') === '1') {
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9 }));
  stick.position.set(-0.6, 0.5, 5);
  level.add(stick);
  fx.torch(stick, new THREE.Vector3(0, 0.55, 0));
}

// moving test projectile with a trail (arrows in Focus mode)
let arrow: THREE.Mesh | null = null;
let arrowT = 0;
if (params.get('trail') === '1') {
  arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0xcfc6a8, roughness: 0.5 }));
  arrow.rotation.z = Math.PI / 2;
  level.add(arrow);
  fx.trail(arrow, 0xffe2a0);
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now();
let frames = 0;
let ready = false;
let stopped = false;

function step(dt: number): void {
  if (arrow) {
    arrowT += dt;
    const k = (arrowT % 1.2) / 1.2;
    arrow.position.set(-7 + k * 14, 1.6 + Math.sin(k * 3) * 0.6, 7 + k * 3);
  }
  fx.update(dt, engine.camera);
}
function warmup(sec: number): void {
  const dt = 1 / 30;
  for (let t = 0; t < sec; t += dt) step(dt);
}
if (params.get('lightning') === '1') fx.lightning();
warmup(warm);

function frame(): void {
  if (stopped) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!still) step(dt);
  engine.render(dt);
  frames++;
  if (hud.classList.contains('hidden') === false && frames % 15 === 0) {
    hud.textContent = `${preset.name}  [${engine.quality}]  ${engine.fps.toFixed(0)} fps\ncalls ${engine.renderer.info.render.calls}  tris ${engine.renderer.info.render.triangles}`;
  }
  if (!ready && frames >= 4) {
    ready = true;
    w.__snapReady = true;
  }
  if (!stopped) {
    // after the first frames only keep the picture alive (screenshots) without burning CPU
    if (ready && still) setTimeout(() => requestAnimationFrame(frame), 400);
    else requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);

/** read the HDR scene buffer (linear, pre-exposure) at normalised screen coords */
function probe(nx: number, ny: number): number[] | null {
  const it = getEngineInternals(engine);
  if (!it) return null;
  const rt = it.pipeline.scenePass.rt;
  const x = Math.floor(nx * (rt.width - 1));
  const y = Math.floor((1 - ny) * (rt.height - 1));
  const out = new Uint16Array(4);
  // resolve MSAA by reading the (resolved) texture through a temp 1px read
  engine.renderer.readRenderTargetPixels(rt, x, y, 1, 1, out);
  const f = (h: number) => {
    const e = (h >> 10) & 31, m = h & 1023, sgn = h >> 15 ? -1 : 1;
    return e === 0 ? sgn * Math.pow(2, -14) * (m / 1024) : sgn * Math.pow(2, e - 15) * (1 + m / 1024);
  };
  return [f(out[0]), f(out[1]), f(out[2]), f(out[3])];
}

/** names of the active post passes + scene draw stats, for performance checks */
function passInfo(): string {
  const it = getEngineInternals(engine);
  if (!it) return 'n/a';
  const names = it.pipeline.composer.passes.filter((p) => p.enabled).map((p) => p.constructor.name);
  const r = engine.renderer;
  r.info.autoReset = false;
  r.info.reset();
  engine.render(0.016);
  const calls = r.info.render.calls;
  const tris = r.info.render.triangles;
  r.info.autoReset = true;
  return JSON.stringify({ quality: engine.quality, passes: names, calls, tris });
}

w.__env = {
  engine,
  fx,
  probe,
  passInfo,
  setEnv(name: EnvironmentName) {
    engine.setEnvironment(name);
  },
  /** switch environment in place (ground palette + weather follow) and return a PNG data URL of the result */
  grab(name: EnvironmentName, opts: { warm?: number; weather?: string; yaw?: number; pitch?: number; fov?: number; hero?: boolean; post?: Record<string, unknown>; q?: Quality } = {}): string {
    if (opts.q) engine.setQuality(opts.q);
    engine.setEnvironment(name);
    if (opts.post) Object.assign(engine.post, opts.post);
    const pr = GROUND[name] ?? GROUND.arena;
    const tx = makeGroundTextures(pr);
    const gm = ground.material as THREE.MeshStandardMaterial;
    gm.map?.dispose(); gm.normalMap?.dispose(); gm.roughnessMap?.dispose();
    gm.map = tx.map; gm.normalMap = tx.normal; gm.roughnessMap = tx.rough;
    for (const t of [tx.map, tx.normal, tx.rough]) t.repeat.set(240 / pr.scale, 240 / pr.scale);
    gm.needsUpdate = true;
    const e = ENVIRONMENTS[name];
    fx.setWeather((opts.weather as WeatherKind) ?? e.weather ?? 'none', e.weatherIntensity ?? 1);
    if (opts.yaw !== undefined) {
      const y = THREE.MathUtils.degToRad(opts.yaw);
      const p = THREE.MathUtils.degToRad(opts.pitch ?? -5);
      engine.camera.position.set(0.3 + Math.sin(y + Math.PI) * 5.2, 1.85, 2.2 + Math.cos(y + Math.PI) * 5.2);
      engine.camera.lookAt(engine.camera.position.x + Math.sin(y) * 20, engine.camera.position.y + Math.tan(p) * 20, engine.camera.position.z + Math.cos(y) * 20);
    }
    if (opts.fov) { engine.camera.fov = opts.fov; engine.camera.updateProjectionMatrix(); }
    const dt = 1 / 30;
    for (let t = 0; t < (opts.warm ?? 4); t += dt) fx.update(dt, engine.camera);
    engine.render(0.016);
    engine.render(0.016);
    return engine.canvas.toDataURL('image/png');
  },
  step,
  resume() {
    stopped = false;
    last = performance.now();
    requestAnimationFrame(frame);
  },
};
void fbm2;
