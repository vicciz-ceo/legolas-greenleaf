/**
 * Post-processing pipeline.
 *
 *   ScenePass (MSAA, HalfFloat, depth texture)
 *   -> GTAOPass            (high, ultra)
 *   -> ShaftsPass          (optional light shafts, medium+)
 *   -> BokehPass           (only while post.dof.enabled)
 *   -> UnrealBloomPass     (medium+, subtle)
 *   -> OutputPass          (AgX tone mapping + sRGB)
 *   -> GradePass           (lift/gamma/gain, saturation, vignette, grain, damage, focus, letterbox)
 *   -> FXAA / SMAA         (low, medium; high and ultra use MSAA)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { PostControls, Quality } from '../types';
import { QUALITY, type QualityConfig } from './quality';
import { ScenePass } from './scenePass';
import { ShaftsPass } from './shaftsPass';
import { createGradePass } from './gradePass';

/**
 * AO blend that fades the occlusion out with distance and fog: the scene colour arriving here is
 * already fogged, so multiplying AO into a mostly-fog pixel crushed the haze (distant trunks went
 * dark instead of dissolving into the mist). AO is mixed toward 1 by the FogExp2 factor at the
 * pixel's depth and faded out entirely between AO_FADE_NEAR and AO_FADE_FAR metres.
 */
const AO_FADE_NEAR = 30;
const AO_FADE_FAR = 60;
function fogAwareBlendMaterial(depth: THREE.Texture | null): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Greenleaf.GTAOFogBlend',
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: depth },
      intensity: { value: 1 },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      fogDensity: { value: 0 },
      fade: { value: new THREE.Vector2(AO_FADE_NEAR, AO_FADE_FAR) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float intensity;
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform float fogDensity;
      uniform vec2 fade;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float z = texture2D(tDepth, vUv).x;
        // perspective depth -> view distance (metres)
        float d = (cameraNear * cameraFar) / max(1e-6, cameraFar - z * (cameraFar - cameraNear));
        float fogF = 1.0 - exp(-fogDensity * fogDensity * d * d);
        float keep = (1.0 - fogF) * (1.0 - smoothstep(fade.x, fade.y, d)) * step(z, 0.99999);
        gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, intensity * keep), texel.a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.DstAlphaFactor,
    blendDstAlpha: THREE.ZeroFactor,
    blendEquationAlpha: THREE.AddEquation,
  });
}

/** GTAO that can run at a fraction of the frame resolution and ignores non-depth-writing geometry. */
class ScaledGTAOPass extends GTAOPass {
  scaleFactor = 1;
  hideCache: THREE.Object3D[] = [];
  private fogBlend: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    super(scene, camera, w, h);
    const self = this as unknown as {
      _overrideVisibility: () => void;
      _restoreVisibility: () => void;
      scene: THREE.Scene;
      blendMaterial: THREE.ShaderMaterial;
      depthTexture: THREE.Texture;
    };
    const cache = this.hideCache;
    self._overrideVisibility = function () {
      hideNonDepth(self.scene, cache);
    };
    self._restoreVisibility = function () {
      showNonDepth(cache);
    };
    self.blendMaterial.dispose();
    this.fogBlend = self.blendMaterial = fogAwareBlendMaterial(self.depthTexture);
  }
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const u = this.fogBlend.uniforms;
    const cam = this.camera as THREE.PerspectiveCamera;
    const fog = this.scene.fog;
    // AO is faded out by AO_FADE_FAR, so the normal/depth pre-pass and the AO solve only need what
    // lies within it: a short far plane frustum-culls the distant forest chunks, rocks and props
    // (~100k triangles of the pre-pass on High) and buys depth precision where AO is visible
    const far = cam.far;
    const clip = Math.min(far, AO_FADE_FAR + 20);
    if (clip < far) {
      cam.far = clip;
      cam.updateProjectionMatrix();
    }
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    u.fogDensity.value = fog && (fog as THREE.FogExp2).isFogExp2 ? (fog as THREE.FogExp2).density : 0;
    u.tDepth.value = (this as unknown as { depthTexture: THREE.Texture }).depthTexture;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      if (clip < far) {
        cam.far = far;
        cam.updateProjectionMatrix();
      }
    }
  }
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * this.scaleFactor)), Math.max(1, Math.round(height * this.scaleFactor)));
  }
  override dispose(): void {
    super.dispose();
    this.fogBlend.dispose();
  }
}

/**
 * objects that must not appear in depth/normal pre-passes: lines, points, particle quads, decals,
 * alpha-tested cards flagged `userData.noAO`. They are hidden through their layer mask, not
 * `visible`: THREE.LOD.update() (run inside renderer.render) rewrites `visible` on its levels, which
 * silently put grass and foliage back into the GTAO pass.
 */
let _hideCache: THREE.Object3D[] = [];
let _hideMasks: number[] = [];
function hide(o: THREE.Object3D): void {
  if (o.layers.mask === 0) return; // already hidden (or never rendered): never record a 0 to restore
  _hideCache.push(o);
  _hideMasks.push(o.layers.mask);
  o.layers.mask = 0;
}
function visitHide(o: THREE.Object3D): void {
  const a = o as THREE.Mesh & { isPoints?: boolean; isLine?: boolean };
  if (o.userData.noAO === true) {
    o.traverse(hide); // a flagged group hides its whole subtree (layers are not inherited)
    return;
  }
  if (a.isPoints || a.isLine) {
    hide(o);
    return;
  }
  if (a.isMesh) {
    const m = a.material as THREE.Material | THREE.Material[] | undefined;
    const first = Array.isArray(m) ? m[0] : m;
    if (first && first.transparent && !first.depthWrite) hide(o);
  }
}
const _masks = new WeakMap<THREE.Object3D[], number[]>();
function hideNonDepth(scene: THREE.Object3D, cache: THREE.Object3D[]): void {
  _hideCache = cache;
  let masks = _masks.get(cache);
  if (!masks) _masks.set(cache, (masks = []));
  _hideMasks = masks;
  scene.traverseVisible(visitHide);
}
function showNonDepth(cache: THREE.Object3D[]): void {
  const masks = _masks.get(cache) ?? [];
  for (let i = 0; i < cache.length; i++) cache[i].layers.mask = masks[i];
  cache.length = 0;
  masks.length = 0;
}

/** Bokeh renders its own depth pre-pass; wrap it so particle quads do not leave focus artefacts. */
class SafeBokehPass extends BokehPass {
  private sceneRef: THREE.Scene;
  private cache: THREE.Object3D[] = [];
  constructor(scene: THREE.Scene, camera: THREE.Camera, params: { focus: number; aperture: number; maxblur: number }) {
    super(scene, camera, params);
    this.sceneRef = scene;
  }
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    hideNonDepth(this.sceneRef, this.cache);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    showNonDepth(this.cache);
  }
}

export interface PipelineFrameInfo {
  /** seconds, real time */
  dt: number;
  /** total elapsed real seconds, for grain and drifting effects */
  time: number;
}

export class Pipeline {
  readonly composer: EffectComposer;
  readonly scenePass: ScenePass;
  readonly outputPass: OutputPass;
  readonly gradePass: ReturnType<typeof createGradePass>;
  shafts: ShaftsPass | null = null;
  private gtao: ScaledGTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private bokeh: SafeBokehPass | null = null;
  private fxaa: FXAAPass | null = null;
  private smaa: SMAAPass | null = null;
  private cfg: QualityConfig;
  private width = 1;
  private height = 1;
  private lastShaftSteps = -1;
  private dofOn = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.DirectionalLight,
    private quality: Quality,
  ) {
    this.cfg = QUALITY[quality];
    const size = renderer.getSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.round(this.width * pr));
    const h = Math.max(1, Math.round(this.height * pr));
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    rt.texture.name = 'Greenleaf.composer';
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pr);
    this.scenePass = new ScenePass(scene, camera, w, h, this.cfg.msaa);
    this.outputPass = new OutputPass();
    this.gradePass = createGradePass();
    this.rebuild();
  }

  /** (re)assemble the pass list for the current quality and optional features */
  private rebuild(): void {
    const cfg = this.cfg;
    const c = this.composer;
    c.passes.length = 0;
    const w = Math.max(1, Math.round(this.width * this.renderer.getPixelRatio()));
    const h = Math.max(1, Math.round(this.height * this.renderer.getPixelRatio()));

    this.scenePass.setSamples(cfg.msaa);
    c.addPass(this.scenePass);

    if (cfg.gtao) {
      if (!this.gtao) {
        this.gtao = new ScaledGTAOPass(this.scene, this.camera, w, h);
        this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: cfg.gtaoSamples, distanceFallOff: 1.0 });
        this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        this.gtao.blendIntensity = 1.0;
      }
      this.gtao.scaleFactor = cfg.gtaoScale;
      this.gtao.updateGtaoMaterial({ samples: cfg.gtaoSamples });
      c.addPass(this.gtao);
    }

    if (cfg.shaftSteps > 0) {
      if (!this.shafts || this.lastShaftSteps !== cfg.shaftSteps) {
        this.shafts?.dispose();
        this.shafts = new ShaftsPass(this.camera, this.sun, this.scenePass, w, h, cfg.shaftSteps, 0.5);
        this.lastShaftSteps = cfg.shaftSteps;
      }
      c.addPass(this.shafts);
    }

    if (this.bokeh && this.dofOn) c.addPass(this.bokeh);

    if (cfg.bloom) {
      if (!this.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.6, 0.9);
      }
      this.bloom.resolution.set(w * cfg.bloomScale, h * cfg.bloomScale);
      c.addPass(this.bloom);
    }

    c.addPass(this.outputPass);
    c.addPass(this.gradePass);

    if (cfg.aa === 'fxaa') {
      this.fxaa ??= new FXAAPass();
      c.addPass(this.fxaa);
    } else if (cfg.aa === 'smaa') {
      this.smaa ??= new SMAAPass();
      c.addPass(this.smaa);
    }
    // addPass() sized each pass with the composer's current size; make sure the scale-aware ones agree
    c.setSize(this.width, this.height);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.cfg = QUALITY[q];
    this.rebuild();
  }

  /** css-pixel size; the renderer's pixel ratio must already be set */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.gradePass.uniforms.uAspect.value = width / Math.max(1, height);
  }

  /** enable/disable depth of field; creates the pass lazily */
  private syncDof(post: PostControls): void {
    const want = post.dof.enabled;
    if (want && !this.dofOn) {
      this.bokeh ??= new SafeBokehPass(this.scene, this.camera, { focus: post.dof.focus, aperture: post.dof.aperture, maxblur: 0.012 });
      this.dofOn = true;
      this.rebuild();
    } else if (!want && this.dofOn) {
      this.dofOn = false;
      this.composer.removePass(this.bokeh as Pass);
    }
    if (this.bokeh && want) {
      const u = (this.bokeh as unknown as { uniforms: Record<string, THREE.IUniform> }).uniforms;
      u.focus.value = post.dof.focus;
      u.aperture.value = post.dof.aperture;
      u.maxblur.value = 0.014;
    }
  }

  /**
   * @param lightningBoost 0..1 extra exposure during a lightning flash
   */
  render(info: PipelineFrameInfo, post: PostControls): void {
    this.syncDof(post);
    const g = this.gradePass.uniforms;
    g.uTime.value = info.time;
    g.uVignette.value = post.vignette;
    g.uGrain.value = post.grain;
    g.uSaturation.value = post.saturation;
    g.uDamage.value = post.damageFlash;
    g.uFocus.value = post.focusTint;
    g.uLetterbox.value = post.letterbox;
    g.uAberration.value = this.cfg.aberration;
    if (this.bloom) {
      this.bloom.strength = post.bloomStrength;
      this.bloom.enabled = post.bloomStrength > 0.001;
      this.bloom.threshold = 1.7 / Math.max(0.3, post.exposure);
    }
    // Shadow maps once per frame. three re-renders every shadow map on EVERY renderer.render(scene)
    // while shadowMap.autoUpdate is on, and the GTAO normal pre-pass and the depth-of-field depth
    // pass are full scene renders: on High that drew the whole shadow pass twice (three times with
    // DOF). needsUpdate is consumed by the first render of the frame (the ScenePass).
    const sm = this.renderer.shadowMap;
    sm.autoUpdate = false;
    sm.needsUpdate = true;
    this.composer.render(info.dt);
  }

  dispose(): void {
    this.scenePass.dispose();
    this.gtao?.dispose();
    this.shafts?.dispose();
    this.bloom?.dispose();
    this.bokeh?.dispose();
    this.fxaa?.dispose();
    this.smaa?.dispose();
    this.outputPass.dispose();
    this.gradePass.dispose();
    this.composer.dispose();
  }
}
