import { createNoise2D, createNoise3D } from 'simplex-noise';

/** Deterministic PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit string/number hash → seed */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return h >>> 0;
}

export class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** [0,1) */
  float(): number {
    return this.next();
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** approx normal distribution (mean 0, sd 1) */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

/** Seeded simplex noise helpers (cached per seed). Output range ≈ [-1, 1]. */
const n2cache = new Map<number, (x: number, y: number) => number>();
const n3cache = new Map<number, (x: number, y: number, z: number) => number>();
export function noise2(seed = 1): (x: number, y: number) => number {
  let f = n2cache.get(seed);
  if (!f) n2cache.set(seed, (f = createNoise2D(mulberry32(seed))));
  return f;
}
export function noise3(seed = 1): (x: number, y: number, z: number) => number {
  let f = n3cache.get(seed);
  if (!f) n3cache.set(seed, (f = createNoise3D(mulberry32(seed))));
  return f;
}

/** fractal Brownian motion over 2D simplex noise */
export function fbm2(x: number, y: number, octaves = 4, seed = 1, lacunarity = 2, gain = 0.5): number {
  const n = noise2(seed);
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function fbm3(x: number, y: number, z: number, octaves = 4, seed = 1): number {
  const n = noise3(seed);
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
