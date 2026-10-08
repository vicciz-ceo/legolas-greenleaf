/**
 * ScenePass renders the scene into its OWN multisampled HalfFloat target (with a depth texture
 * that later passes, such as the light shafts, can read) and then copies the resolved colour into
 * the composer's write buffer. This keeps MSAA confined to the scene render, so every following
 * full-screen pass works on cheap single-sample targets.
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const COPY_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;
/**
 * The copy doubles as the post chain's NaN/Inf guard: a single non-finite scene pixel (a zero
 * normal, a 0/0 in a custom shader) would otherwise be smeared over the whole frame by bloom's blur
 * pyramid and SMAA's neighbourhood blend. Non-finite pixels become black and HDR is clamped to a
 * sane ceiling (well above anything AgX distinguishes) so bloom never accumulates to Inf.
 */
const COPY_FS = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), isnan(c.a) || isinf(c.a));
    if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
    gl_FragColor = min(c, vec4(4096.0));
  }`;

export class ScenePass extends Pass {
  readonly rt: THREE.WebGLRenderTarget;
  readonly depthTexture: THREE.DepthTexture;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private quad: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, samples: number) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.depthTexture = new THREE.DepthTexture(width, height);
    this.depthTexture.type = THREE.UnsignedIntType;
    this.depthTexture.format = THREE.DepthFormat;
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: this.depthTexture,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.rt.texture.name = 'Greenleaf.scene';
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture } },
      vertexShader: COPY_VS,
      fragmentShader: COPY_FS,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.quad = new FullScreenQuad(this.copyMat);
  }

  setSamples(samples: number): void {
    if (this.rt.samples === samples) return;
    this.rt.samples = samples;
    // changing sample count needs the framebuffers rebuilt
    this.rt.dispose();
  }

  override setSize(width: number, height: number): void {
    this.rt.setSize(width, height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.rt.dispose();
    this.depthTexture.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
  }
}
