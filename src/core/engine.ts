/**
 * Rendering engine: renderer + quality presets, sun with a texel-snapped shadow frustum that follows
 * `shadowFocus`, environment application (sky, IBL, fog, lights, exposure, grade) and the post pipeline.
 *
 * Integration notes for the shell
 *  - `engine.setEnvironment()` does NOT touch weather or audio. After calling it, apply
 *    `env.weather` / `env.weatherIntensity` with `fx.setWeather(...)` and `env.ambience` with the audio system.
 *  - `engine.shadowFocus` must be set every frame (the camera rig does it): the sun shadow frustum (+-35 m)
 *    is centred on it. For decals / splashes / debris to land on real terrain set `fx.groundAt = physics.heightAt`.
 *  - `engine.post.damageFlash` is not decayed here; the owner (player) decays it.
 *  - Objects that must not appear in the GTAO / depth-of-field depth pre-passes (particles, decals, sprites)
 *    either use a transparent material with `depthWrite: false` (detected automatically) or set
 *    `object.userData.noAO = true`.
 *  - Quality: setQuality() rebuilds the post chain, shadow map and IBL bake. See ./post/quality.ts for the table.
 *
 * Engine.setEnvironment does NOT touch weather or audio. The shell applies env.weather via fx.setWeather and
 * env.ambience via audio.
 */
import * as THREE from 'three';
import type { Engine, EnvironmentName, EnvironmentPreset, PostControls, Quality } from './types';
import { disposeObject } from './math';
import { lightDirectionOf, resolvePreset, SkyRig, type EnvironmentPresetEx } from './environment';
import { Pipeline } from './post/pipeline';
import { QUALITY, type QualityConfig } from './post/quality';

/** Non-contract hooks used by createFx (lightning flash, ambient colour for lit particles ...). */
export interface EngineInternals {
  readonly pipeline: Pipeline;
  readonly sky: SkyRig;
  readonly config: QualityConfig;
  /** 0..1 lightning flash: brightens sky, sun, hemisphere and IBL for this frame */
  setFlash(v: number, dirX?: number, dirY?: number, dirZ?: number): void;
  /** colour (already scaled by exposure) that diffusely lit particles such as smoke should be tinted with */
  readonly ambientTint: THREE.Color;
  /** accumulated real time */
  readonly time: number;
}

const internalsMap = new WeakMap<object, EngineInternals>();
export function getEngineInternals(engine: Engine): EngineInternals | undefined {
  return internalsMap.get(engine);
}

const SUN_DISTANCE = 90;
const SHADOW_HALF = 35;

class EngineImpl implements Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly levelRoot = new THREE.Group();
  readonly post: PostControls;
  shadowFocus = new THREE.Vector3();

  private _quality: Quality;
  private cfg: QualityConfig;
  private _env: EnvironmentPresetEx;
  private container: HTMLElement;
  private pipeline: Pipeline;
  private sky = new SkyRig();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private fog = new THREE.FogExp2(0x888888, 0.01);
  private ro: ResizeObserver | null = null;
  private onWinResize = () => this.resize();
  private _fps = 60;
  private time = 0;
  private disposed = false;
  private ambient = new THREE.Color(0.3, 0.3, 0.3);
  private frameInfo = { dt: 0, time: 0 };

  // lighting bases (flash multiplies these)
  private baseSun = 1;
  private baseHemi = 1;
  private baseEnv = 1;
  private flash = 0;
  private flashApplied = false;

  // shadow frustum
  private lightDir = new THREE.Vector3(0.3, 0.8, 0.4).normalize();
  private lightRight = new THREE.Vector3(1, 0, 0);
  private lightUp = new THREE.Vector3(0, 1, 0);
  private _t1 = new THREE.Vector3();

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this._quality = quality;
    this.cfg = QUALITY[quality];

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const r = this.renderer;
    this.canvas = r.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping; // applied by OutputPass
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = true;
    r.setPixelRatio(this.pixelRatio());
    container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1200);
    this.camera.position.set(0, 2, 6);

    this.scene.name = 'greenleaf-scene';
    this.scene.fog = this.fog;
    this.levelRoot.name = 'levelRoot';
    this.scene.add(this.levelRoot);

    // key light
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_HALF;
    sc.right = SHADOW_HALF;
    sc.top = SHADOW_HALF;
    sc.bottom = -SHADOW_HALF;
    sc.near = 1;
    sc.far = SUN_DISTANCE * 2 + 20;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.09;
    this.sun.shadow.radius = 2;
    this.sun.shadow.mapSize.set(this.cfg.shadowSize, this.cfg.shadowSize);
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    this.hemi.name = 'hemi';
    this.scene.add(this.hemi);

    this.scene.add(this.sky.group);

    this.pmrem = new THREE.PMREMGenerator(r);

    this._env = resolvePreset('arena');
    this.post = {
      exposure: 1,
      bloomStrength: 0.2,
      vignette: 0.3,
      grain: 0.022,
      saturation: 1,
      damageFlash: 0,
      focusTint: 0,
      letterbox: 0,
      dof: { enabled: false, focus: 10, aperture: 0.00015 },
    };

    this.syncSize();
    this.pipeline = new Pipeline(r, this.scene, this.camera, this.sun, quality);
    this.pipeline.setSize(this.w, this.h);

    this.setEnvironment('arena');

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(container);
    }
    window.addEventListener('resize', this.onWinResize);

    internalsMap.set(this, this.makeInternals());
  }

  // ── size ────────────────────────────────────────────────────────────────
  private w = 1;
  private h = 1;
  private pixelRatio(): number {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return Math.max(0.5, Math.min(dpr, this.cfg.pixelRatioCap));
  }
  private syncSize(): void {
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;
    if (!w || !h) {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    this.w = Math.max(1, Math.floor(w));
    this.h = Math.max(1, Math.floor(h));
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }
  resize(): void {
    if (this.disposed) return;
    this.syncSize();
    this.pipeline?.setSize(this.w, this.h);
  }

  // ── quality ─────────────────────────────────────────────────────────────
  get quality(): Quality {
    return this._quality;
  }
  setQuality(q: Quality): void {
    if (q === this._quality) return;
    const prev = this.cfg;
    this._quality = q;
    this.cfg = QUALITY[q];
    if (prev.shadowSize !== this.cfg.shadowSize) {
      const sh = this.sun.shadow;
      if (sh.map) {
        sh.map.depthTexture?.dispose();
        sh.map.dispose();
        sh.map = null;
      }
      sh.mapSize.set(this.cfg.shadowSize, this.cfg.shadowSize);
    }
    this.syncSize();
    this.pipeline.setQuality(q);
    this.pipeline.setSize(this.w, this.h);
    if (prev.envSize !== this.cfg.envSize) this.bakeEnvironment();
    this.applyShaftSettings();
  }

  // ── environment ─────────────────────────────────────────────────────────
  get env(): EnvironmentPreset {
    return this._env;
  }

  setEnvironment(preset: EnvironmentName | EnvironmentPreset): void {
    const env = resolvePreset(preset);
    this._env = env;

    lightDirectionOf(env, this.lightDir);
    // keep the shadow caster above the horizon (a shadow map cannot look from below the ground)
    if (this.lightDir.y < 0.12) {
      this.lightDir.y = 0.12;
      this.lightDir.normalize();
    }
    this.computeLightBasis();

    // sky + image based lighting
    this.sky.apply(env, this.lightDir);
    this.bakeEnvironment();

    // lights
    this.sun.color.setHex(env.sunColor);
    this.baseSun = env.sunIntensity;
    this.sun.intensity = env.sunIntensity;
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.baseHemi = env.hemiIntensity;
    this.hemi.intensity = env.hemiIntensity;
    this.baseEnv = env.envIntensity;
    this.scene.environmentIntensity = env.envIntensity;
    this.flash = 0;
    this.sky.setFlash(0);

    // fog + clear colour match the horizon
    this.fog.color.setHex(env.fog.color);
    this.fog.density = env.fog.density;
    this.renderer.setClearColor(this.fog.color, 1);

    // post
    const p = this.post;
    p.exposure = env.exposure;
    p.bloomStrength = env.bloom;
    p.vignette = env.grade.vignette;
    p.saturation = env.grade.saturation;
    const g = this.pipeline.gradePass.uniforms;
    (g.uLift.value as THREE.Vector3).set(env.grade.lift[0], env.grade.lift[1], env.grade.lift[2]);
    (g.uGamma.value as THREE.Vector3).set(env.grade.gamma[0], env.grade.gamma[1], env.grade.gamma[2]);
    (g.uGain.value as THREE.Vector3).set(env.grade.gain[0], env.grade.gain[1], env.grade.gain[2]);
    g.uContrast.value = env.contrast ?? 1.12;

    // ambient colour for lit particles
    const a = this.ambient;
    const sky = new THREE.Color(env.hemiSky).multiplyScalar(env.hemiIntensity * 0.55 + env.envIntensity * 0.45);
    const sun = new THREE.Color(env.sunColor).multiplyScalar(env.sunIntensity * 0.09);
    a.copy(sky).add(sun).multiplyScalar(env.exposure * 0.85);
    const m = Math.max(a.r, a.g, a.b, 1e-4);
    if (m > 1.1) a.multiplyScalar(1.1 / m);
    a.r = Math.max(a.r, 0.035);
    a.g = Math.max(a.g, 0.035);
    a.b = Math.max(a.b, 0.035);

    this.applyShaftSettings();
    this.updateShadowFrustum();
  }

  private applyShaftSettings(): void {
    const sh = this.pipeline.shafts;
    if (!sh) return;
    const env = this._env;
    const k = env.shafts ?? 0;
    sh.density = k * 0.011;
    sh.maxDist = 70;
    // radiance: sun colour * intensity, softened so HDR stays sane
    sh.radiance.setHex(env.sunColor).multiplyScalar(Math.min(env.sunIntensity, 5) * 0.9);
    sh.enabled = k > 0.001;
  }

  private bakeEnvironment(): void {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.sky.bakeScene, 0, 0.1, 10, { size: this.cfg.envSize });
    this.scene.environment = this.envRT.texture;
    old?.dispose();
  }

  // ── shadow frustum ──────────────────────────────────────────────────────
  private computeLightBasis(): void {
    const d = this.lightDir;
    // THREE.Object3D.lookAt for lights: z = position - target (= d), x = up x z
    const upRef = Math.abs(d.y) > 0.999 ? this._t1.set(0, 0, 1) : this._t1.set(0, 1, 0);
    this.lightRight.crossVectors(upRef, d).normalize();
    this.lightUp.crossVectors(d, this.lightRight).normalize();
  }

  private updateShadowFrustum(): void {
    const f = this.shadowFocus;
    const texel = (SHADOW_HALF * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(f.dot(this.lightRight) / texel) * texel;
    const y = Math.round(f.dot(this.lightUp) / texel) * texel;
    const z = f.dot(this.lightDir);
    const t = this.sun.target.position;
    t.copy(this.lightRight).multiplyScalar(x).addScaledVector(this.lightUp, y).addScaledVector(this.lightDir, z);
    this.sun.position.copy(t).addScaledVector(this.lightDir, SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  // ── lightning / flash ──────────────────────────────────────────────────
  private setFlash(v: number, dx = 0, dy = 0.25, dz = 1): void {
    this.flash = v;
    if (v > 0.001) this.sky.setFlashDirection(dx, dy, dz);
  }

  // ── frame ───────────────────────────────────────────────────────────────
  render(dtReal: number): void {
    if (this.disposed) return;
    const dt = Math.min(Math.max(dtReal, 0), 0.25);
    this.time += dt;
    if (dt > 0) {
      const inst = 1 / dt;
      this._fps += (Math.min(inst, 240) - this._fps) * Math.min(1, dt * 2);
    }

    this.sky.update(dt, this.camera);
    this.updateShadowFrustum();

    const fl = this.flash;
    if (fl > 0.001 || this.flashApplied) {
      this.sun.intensity = this.baseSun * (1 + fl * 2.2);
      this.hemi.intensity = this.baseHemi + fl * 1.6;
      this.scene.environmentIntensity = this.baseEnv * (1 + fl * 2.5);
      this.sky.setFlash(fl);
      this.flashApplied = fl > 0.001;
    }

    this.renderer.toneMappingExposure = this.post.exposure;
    this.frameInfo.dt = dt;
    this.frameInfo.time = this.time;
    this.pipeline.render(this.frameInfo, this.post);
  }

  get fps(): number {
    return this._fps;
  }

  // ── level content ───────────────────────────────────────────────────────
  clearLevel(): void {
    const root = this.levelRoot;
    for (let i = root.children.length - 1; i >= 0; i--) {
      const child = root.children[i];
      root.remove(child);
      child.traverse((o) => {
        const a = o as THREE.InstancedMesh & THREE.SkinnedMesh;
        if (a.isInstancedMesh) a.dispose();
        if (a.isSkinnedMesh && a.skeleton) a.skeleton.dispose();
      });
      disposeObject(child);
    }
    this.renderer.renderLists.dispose();
  }

  // ── teardown ────────────────────────────────────────────────────────────
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onWinResize);
    this.clearLevel();
    this.pipeline.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sky.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    internalsMap.delete(this);
  }

  private makeInternals(): EngineInternals {
    const self = this;
    return {
      get pipeline() {
        return self.pipeline;
      },
      get sky() {
        return self.sky;
      },
      get config() {
        return self.cfg;
      },
      setFlash: (v, x, y, z) => self.setFlash(v, x, y, z),
      get ambientTint() {
        return self.ambient;
      },
      get time() {
        return self.time;
      },
    };
  }
}

export function createEngine(container: HTMLElement, quality: Quality): Engine {
  return new EngineImpl(container, quality);
}
