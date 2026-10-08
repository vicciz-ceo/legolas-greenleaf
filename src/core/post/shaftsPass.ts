/**
 * ShaftsPass: volumetric light shafts (god rays) by ray-marching the sun's shadow map.
 *
 * For every pixel the pass reconstructs the world position from the scene depth, marches from the
 * camera toward it and accumulates in-scattered sun light wherever the shadow map says the sun is
 * visible. Canopies, pillars and cave ceilings therefore carve real shafts out of the haze, from any
 * view direction. Runs at half resolution, jittered with interleaved gradient noise, then is
 * composited additively (before bloom, in HDR).
 *
 * Optional feature: only presets with `shafts > 0` enable it. Needs sun.castShadow and the depth
 * texture of ScenePass.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const MARCH_FS = /* glsl */ `
  precision highp float;
  precision highp sampler2DShadow;
  uniform sampler2D tDepth;
  uniform sampler2DShadow tShadow;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform mat4 uShadowMatrix;
  uniform vec3 uSunDir;      // toward the light
  uniform vec3 uRadiance;    // sun colour * intensity * strength
  uniform float uDensity;
  uniform float uMaxDist;
  uniform float uTime;
  uniform float uFrame;
  uniform vec3 uFocus;
  uniform float uShadowRange;
  varying vec2 vUv;

  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                   mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                   mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    float depth = texture2D(tDepth, vUv).x;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc;
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 ro = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 ray = wp - ro;
    float len = length(ray);
    vec3 rd = ray / max(len, 1e-4);
    float maxLen = min(len, uMaxDist * (depth >= 0.9999 ? 0.6 : 1.0));

    float jitter = ign(gl_FragCoord.xy + uFrame * 5.588238);
    float stepLen = maxLen / float(STEPS);
    float cosT = dot(rd, uSunDir);
    // forward-scattering lobe + isotropic floor, so shafts show from every direction
    float g = 0.55;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.0796 + 0.12;

    float acc = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float t = (float(i) + jitter) * stepLen;
      vec3 p = ro + rd * t;
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      vec3 sp = sc.xyz / sc.w;
      float vis = 0.0;
      float inside = step(0.0, sp.x) * step(sp.x, 1.0) * step(0.0, sp.y) * step(sp.y, 1.0) * step(sp.z, 1.0);
      if (inside > 0.5) {
        vis = texture(tShadow, vec3(sp.xy, sp.z - 0.0015));
        // fade out near the edge of the shadow volume
        vec2 e = min(sp.xy, 1.0 - sp.xy);
        vis *= smoothstep(0.0, 0.08, min(e.x, e.y));
      }
      // drifting dust / mist modulation
      float n = vnoise3(p * 0.35 + vec3(uTime * 0.05, uTime * 0.02, 0.0));
      float n2 = vnoise3(p * 0.9 - vec3(0.0, uTime * 0.04, uTime * 0.03));
      float dens = (0.45 + 0.9 * n) * (0.7 + 0.6 * n2);
      acc += vis * dens;
    }
    acc *= stepLen * uDensity;
    gl_FragColor = vec4(uRadiance * acc * phase, 1.0);
  }`;

const BLUR_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uDir; // texel step
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
    c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

const COMPOSITE_FS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tShafts;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    vec3 base = texture2D(tDiffuse, vUv).rgb;
    vec3 sh = uAmount > 0.5 ? texture2D(tShafts, vUv).rgb : vec3(0.0);
    gl_FragColor = vec4(base + sh, 1.0);
  }`;

export class ShaftsPass extends Pass {
  /** world->shadow uv matrix of the sun */
  readonly shadowMatrix = new THREE.Matrix4();
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly radiance = new THREE.Color(1, 1, 1);
  density = 0.02;
  maxDist = 60;
  private scenePass: { depthTexture: THREE.DepthTexture };
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private marchMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private rt: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private blurMat: THREE.ShaderMaterial;
  private frame = 0;
  private time = 0;
  private scale: number;
  private steps: number;

  constructor(
    camera: THREE.PerspectiveCamera,
    sun: THREE.DirectionalLight,
    scenePass: { depthTexture: THREE.DepthTexture },
    width: number,
    height: number,
    steps: number,
    scale = 0.5,
  ) {
    super();
    this.camera = camera;
    this.sun = sun;
    this.scenePass = scenePass;
    this.needsSwap = true;
    this.scale = scale;
    this.steps = steps;
    this.rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.rtB = this.rt.clone();
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: BLUR_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.marchMat = new THREE.ShaderMaterial({
      defines: { STEPS: steps },
      uniforms: {
        tDepth: { value: null },
        tShadow: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uShadowMatrix: { value: this.shadowMatrix },
        uSunDir: { value: this.sunDir },
        uRadiance: { value: new THREE.Vector3() },
        uDensity: { value: 0.02 },
        uMaxDist: { value: 60 },
        uTime: { value: 0 },
        uFrame: { value: 0 },
        uFocus: { value: new THREE.Vector3() },
        uShadowRange: { value: 35 },
      },
      vertexShader: VS,
      fragmentShader: MARCH_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tShafts: { value: this.rt.texture }, uAmount: { value: 1 } },
      vertexShader: VS,
      fragmentShader: COMPOSITE_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.marchMat);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    this.rt.setSize(w, h);
    this.rtB.setSize(w, h);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
  ): void {
    const shadowTex = this.sun.shadow.map?.depthTexture ?? null;
    const active = !!shadowTex && this.density > 0 && this.sun.castShadow;
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    (this.compMat.uniforms.uAmount as THREE.IUniform<number>).value = active ? 1 : 0;
    if (active) {
      this.time += deltaTime;
      this.frame = (this.frame + 1) % 16;
      this.shadowMatrix.copy(this.sun.shadow.matrix);
      this.sunDir.copy(this.sun.position).sub(this.sun.target.position).normalize();
      const u = this.marchMat.uniforms;
      u.tDepth.value = this.scenePass.depthTexture;
      u.tShadow.value = shadowTex;
      (u.uInvProj.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
      (u.uCamWorld.value as THREE.Matrix4).copy(this.camera.matrixWorld);
      (u.uRadiance.value as THREE.Vector3).set(this.radiance.r, this.radiance.g, this.radiance.b);
      u.uDensity.value = this.density;
      u.uMaxDist.value = this.maxDist;
      u.uTime.value = this.time;
      u.uFrame.value = this.frame;
      this.quad.material = this.marchMat;
      renderer.setRenderTarget(this.rt);
      this.quad.render(renderer);
      // denoise the jittered march with a separable blur (shafts are low-frequency)
      const bu = this.blurMat.uniforms;
      this.quad.material = this.blurMat;
      bu.tSrc.value = this.rt.texture;
      (bu.uDir.value as THREE.Vector2).set(1 / this.rt.width, 0);
      renderer.setRenderTarget(this.rtB);
      this.quad.render(renderer);
      bu.tSrc.value = this.rtB.texture;
      (bu.uDir.value as THREE.Vector2).set(0, 1 / this.rt.height);
      renderer.setRenderTarget(this.rt);
      this.quad.render(renderer);
    }
    this.quad.material = this.compMat;
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }

  get stepCount(): number {
    return this.steps;
  }

  override dispose(): void {
    this.rt.dispose();
    this.rtB.dispose();
    this.blurMat.dispose();
    this.marchMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}
