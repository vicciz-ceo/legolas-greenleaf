import type { Quality } from '../types';

export interface QualityConfig {
  /** upper bound for devicePixelRatio */
  pixelRatioCap: number;
  /** sun shadow map resolution */
  shadowSize: number;
  /** MSAA samples for the scene render (0 = none) */
  msaa: number;
  gtao: boolean;
  /** GTAO render-target scale (1 = full resolution) */
  gtaoScale: number;
  gtaoSamples: number;
  bloom: boolean;
  /** bloom render scale relative to the frame */
  bloomScale: number;
  /** ray-march steps for light shafts (0 = off) */
  shaftSteps: number;
  /** anti-aliasing after the grade, for qualities without MSAA */
  aa: 'none' | 'fxaa' | 'smaa';
  /** multiplier on particle counts and emission rates */
  particleMul: number;
  /** max simultaneous point lights spent on fires */
  fireLights: number;
  /** chromatic aberration amount for the grade pass */
  aberration: number;
  /** size of the cube map used for the image-based lighting bake */
  envSize: number;
  /** ground blood decals kept alive */
  decals: number;
  /** debris chunks kept alive */
  debris: number;
}

export const QUALITY: Record<Quality, QualityConfig> = {
  low: {
    pixelRatioCap: 1, shadowSize: 1024, msaa: 0, gtao: false, gtaoScale: 0.5, gtaoSamples: 8,
    bloom: false, bloomScale: 0.5, shaftSteps: 0, aa: 'fxaa', particleMul: 0.5, fireLights: 2,
    aberration: 0, envSize: 128, decals: 24, debris: 48,
  },
  medium: {
    pixelRatioCap: 1.5, shadowSize: 2048, msaa: 0, gtao: false, gtaoScale: 0.5, gtaoSamples: 8,
    bloom: true, bloomScale: 0.5, shaftSteps: 12, aa: 'smaa', particleMul: 0.75, fireLights: 4,
    aberration: 0.5, envSize: 256, decals: 48, debris: 96,
  },
  high: {
    pixelRatioCap: 2, shadowSize: 2048, msaa: 4, gtao: true, gtaoScale: 0.5, gtaoSamples: 12,
    bloom: true, bloomScale: 0.75, shaftSteps: 20, aa: 'none', particleMul: 1, fireLights: 6,
    aberration: 0.8, envSize: 256, decals: 96, debris: 192,
  },
  ultra: {
    pixelRatioCap: 2, shadowSize: 4096, msaa: 4, gtao: true, gtaoScale: 1, gtaoSamples: 16,
    bloom: true, bloomScale: 1, shaftSteps: 32, aa: 'none', particleMul: 1.5, fireLights: 8,
    aberration: 1, envSize: 512, decals: 160, debris: 320,
  },
};
