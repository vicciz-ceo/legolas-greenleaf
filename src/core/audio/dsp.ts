/**
 * Procedural-audio toolkit. Everything here targets any BaseAudioContext, so the same synthesis
 * code runs on a realtime AudioContext in the game and on an OfflineAudioContext in the lab.
 *
 * The central type is `Patch`: a scheduling scope that remembers every source node it creates
 * (so a voice can be stopped / stolen), applies a per-play pitch multiplier to oscillators and
 * filters, and hooks a global "detune" signal (slow-motion pitch drop) into every source.
 */
import { Rng } from '../rng';

export type Ctx = BaseAudioContext;

export const MIN_GAIN = 1e-4;
export const TAU = Math.PI * 2;

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));

// ─────────────────────────────────────────────────────────────────────────────
// Shared buffers (noise, curves, karplus-strong); keyed by sample rate, not context
// ─────────────────────────────────────────────────────────────────────────────

export type NoiseKind = 'white' | 'pink' | 'brown';
const noiseCache = new Map<string, AudioBuffer>();

/** 4 s of looping noise. The loop point is cross-faded so it is click-free. */
export function noiseBuffer(ctx: Ctx, kind: NoiseKind): AudioBuffer {
  const key = `${kind}@${ctx.sampleRate}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 4);
  const fade = Math.floor(sr * 0.05);
  const buf = ctx.createBuffer(1, len + fade, sr);
  const d = buf.getChannelData(0);
  const rng = new Rng(kind === 'white' ? 1337 : kind === 'pink' ? 4242 : 9001);
  if (kind === 'white') {
    for (let i = 0; i < d.length; i++) d[i] = rng.float() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rng.float() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rng.float() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  // fold the tail over the head so the loop is seamless
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[len + i] * (1 - t);
  }
  const out = ctx.createBuffer(1, len, sr);
  out.copyToChannel(d.subarray(0, len), 0);
  noiseCache.set(key, out);
  return out;
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();
/** soft saturation curve; drive 1 = mild, 8 = heavy */
export function satCurve(drive: number, asym = 0): Float32Array<ArrayBuffer> {
  const key = `${drive}/${asym}`;
  let c = curveCache.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(new ArrayBuffer(n * 4));
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
  }
  curveCache.set(key, c);
  return c;
}

/** Karplus-Strong plucked string rendered into a Float32Array. */
export interface PluckOpts {
  /** loop gain per cycle, 0.99 = short, 0.9995 = ringing */
  decay?: number;
  /** 0.5 = classic averaging lowpass (dark), 1 = very bright */
  bright?: number;
  /** excitation position along the string 0..0.5 (comb filtering) */
  pick?: number;
  seed?: number;
}
export function pluckSamples(sr: number, freq: number, dur: number, o: PluckOpts = {}): Float32Array {
  const decay = o.decay ?? 0.997;
  const bright = o.bright ?? 0.55;
  const pick = o.pick ?? 0.18;
  const fr = Math.round(freq * 2) / 2;
  const key = `${sr}|${fr}|${dur.toFixed(2)}|${decay}|${bright}|${pick}`;
  const len = Math.max(64, Math.floor(sr * dur));
  const out = new Float32Array(len);
  let P = sr / fr - (1 - bright);
  let N = Math.floor(P);
  let frac = P - N;
  if (frac < 0.5) {
    N -= 1;
    frac += 1;
  }
  N = Math.max(4, N);
  const C = (1 - frac) / (1 + frac);
  const ring = new Float32Array(N);
  const rng = new Rng(o.seed ?? Math.floor(fr * 7) + 17);
  // excitation: noise, one-pole lowpassed, then comb for pick position
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += (rng.float() * 2 - 1 - lp) * 0.7;
    ring[i] = lp;
  }
  const pk = Math.max(1, Math.round(pick * N));
  for (let i = N - 1; i >= pk; i--) ring[i] -= ring[i - pk] * 0.8;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += ring[i];
  mean /= N;
  let mx = 1e-6;
  for (let i = 0; i < N; i++) {
    ring[i] -= mean;
    mx = Math.max(mx, Math.abs(ring[i]));
  }
  for (let i = 0; i < N; i++) ring[i] /= mx;
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  const b = bright;
  let peak = 1e-6;
  for (let n = 0; n < len; n++) {
    const cur = ring[idx];
    out[n] = cur;
    const filt = decay * (b * cur + (1 - b) * prev);
    prev = cur;
    const ap = C * filt + apX - C * apY;
    apX = filt;
    apY = ap;
    ring[idx] = ap;
    if (++idx >= N) idx = 0;
    const a = Math.abs(cur);
    if (a > peak) peak = a;
  }
  const s = 0.85 / peak;
  const fadeN = Math.min(len >> 2, Math.floor(sr * 0.04));
  for (let n = 0; n < len; n++) {
    let g = s;
    const rem = len - n;
    if (rem < fadeN) g *= rem / fadeN;
    out[n] *= g;
  }
  return out;
}

const pluckBufCache = new Map<string, AudioBuffer>();
export function pluckBuffer(ctx: Ctx, freq: number, dur: number, o: PluckOpts = {}): AudioBuffer {
  const key = `${ctx.sampleRate}|${Math.round(freq * 2) / 2}|${dur.toFixed(2)}|${o.decay ?? 0.997}|${o.bright ?? 0.55}|${o.pick ?? 0.18}`;
  const hit = pluckBufCache.get(key);
  if (hit) return hit;
  const s = pluckSamples(ctx.sampleRate, freq, dur, o);
  const b = ctx.createBuffer(1, s.length, ctx.sampleRate);
  b.copyToChannel(s as Float32Array<ArrayBuffer>, 0);
  if (pluckBufCache.size > 56) pluckBufCache.delete(pluckBufCache.keys().next().value as string);
  pluckBufCache.set(key, b);
  // the raw samples are no longer needed once the AudioBuffer exists
  return b;
}

/** Procedural impulse response: early reflections + exponentially decaying, progressively darker tail. */
export function makeImpulse(ctx: Ctx, decay: number, opts: { predelay?: number; dark?: number; seed?: number; early?: number } = {}): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1024, Math.floor(sr * Math.min(10, decay * 1.15)));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * (opts.predelay ?? 0.012));
  const dark = opts.dark ?? 0.5;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rng = new Rng((opts.seed ?? 7) + ch * 101);
    let lp = 0;
    // exponential decay: -60 dB at `decay` seconds
    const k = Math.log(1000) / (decay * sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-k * (i - pre));
      // tail gets darker with time: one-pole lowpass coefficient shrinks
      const a = Math.max(0.04, 1 - dark * Math.min(1, t / (decay * 0.8)) * 0.96);
      lp += ((rng.float() * 2 - 1) - lp) * a;
      // density ramps up over the first 60 ms
      const dens = Math.min(1, t / 0.06);
      d[i] = lp * env * (0.25 + 0.75 * dens);
    }
    // discrete early reflections
    const er = opts.early ?? 7;
    for (let e = 0; e < er; e++) {
      const at = pre + Math.floor(sr * (0.008 + rng.float() * 0.07));
      if (at < len) d[at] += (rng.float() < 0.5 ? -1 : 1) * (0.9 - e * 0.08) * (0.5 + 0.5 * rng.float());
    }
  }
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch: a scheduling scope for one voice / one loop / one music event
// ─────────────────────────────────────────────────────────────────────────────

export interface PatchOpts {
  /** pitch multiplier applied to oscillators and filters created through the patch */
  rate?: number;
  /** signal (cents) added to every source's detune, used for the slow-motion pitch drop */
  detune?: AudioNode | null;
  seed?: number;
}

export class Patch {
  readonly srcs: AudioScheduledSourceNode[] = [];
  readonly rng: Rng;
  rate: number;
  detuneIn: AudioNode | null;
  stopped = false;

  constructor(readonly ctx: Ctx, readonly out: AudioNode, readonly t: number, o: PatchOpts = {}) {
    this.rate = o.rate ?? 1;
    this.detuneIn = o.detune ?? null;
    this.rng = new Rng(o.seed ?? Math.floor(Math.random() * 0xffffffff));
  }

  /** a sibling patch at another start time (sources are not tracked: use for short events) */
  child(at: number, dest: AudioNode = this.out, rate = 1): Patch {
    return new Patch(this.ctx, dest, at, { rate, detune: this.detuneIn, seed: Math.floor(this.rng.float() * 0xffffffff) });
  }

  /** pitch-scaled, Nyquist-safe frequency */
  hz(f: number): number {
    return Math.min(f * this.rate, this.ctx.sampleRate * 0.45);
  }

  private reg<T extends AudioScheduledSourceNode>(n: T): T {
    this.srcs.push(n);
    return n;
  }

  /** oscillator (frequency is pitch-scaled). stop=undefined leaves it running until stopAt(). */
  osc(type: OscillatorType, freq: number, start = this.t, stop?: number, scaled = true): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = scaled ? this.hz(freq) : freq;
    if (this.detuneIn) this.detuneIn.connect(o.detune);
    o.start(start);
    if (stop !== undefined) o.stop(stop);
    return this.reg(o);
  }

  /** looping noise source with a random start offset */
  noise(kind: NoiseKind = 'white', start = this.t, stop?: number, playbackRate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx, kind);
    s.loop = true;
    s.playbackRate.value = playbackRate;
    if (this.detuneIn) this.detuneIn.connect(s.detune);
    s.start(start, this.rng.float() * 3.5);
    if (stop !== undefined) s.stop(stop);
    return this.reg(s);
  }

  /** one-shot sample playback */
  sample(buf: AudioBuffer, start = this.t, playbackRate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = playbackRate;
    if (this.detuneIn) this.detuneIn.connect(s.detune);
    s.start(start);
    return this.reg(s);
  }

  /** Karplus-Strong pluck at `freq` (pitch-scaled) */
  pluck(freq: number, start: number, dur: number, vol: number, o: PluckOpts = {}, dest: AudioNode = this.out): GainNode {
    const s = this.sample(pluckBuffer(this.ctx, this.hz(freq), dur, o), start);
    const g = this.gain(vol);
    s.connect(g);
    g.connect(dest);
    return g;
  }

  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** biquad (frequency is pitch-scaled unless scaled=false) */
  bq(type: BiquadFilterType, freq: number, q = 1, scaled = true, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = scaled ? this.hz(freq) : Math.min(freq, this.ctx.sampleRate * 0.45);
    f.Q.value = q;
    if (gainDb) f.gain.value = gainDb;
    return f;
  }

  pan(v: number): AudioNode {
    if (typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, v));
      return p;
    }
    return this.gain(1);
  }

  shaper(drive: number, asym = 0): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = satCurve(drive, asym);
    w.oversample = '2x';
    return w;
  }

  delay(sec: number): DelayNode {
    return this.ctx.createDelay(Math.max(1, sec + 0.5));
  }

  /** connect nodes in series, return the last */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  /** noise → filter → gain envelope → dest. Returns the gain node. */
  nb(o: {
    at?: number; dur: number; kind?: NoiseKind; type?: BiquadFilterType; f0: number; f1?: number; q?: number;
    amp: number; atk?: number; curve?: 'exp' | 'lin'; dest?: AudioNode; pan?: number; swell?: boolean;
  }): GainNode {
    const t = o.at ?? this.t;
    const src = this.noise(o.kind ?? 'white', t, t + o.dur + 0.05);
    const f = this.bq(o.type ?? 'bandpass', o.f0, o.q ?? 1);
    if (o.f1 !== undefined) sweep(f.frequency, t, this.hz(o.f0), this.hz(o.f1), o.dur, 'exp');
    const g = this.gain(0);
    if (o.swell) swellEnv(g.gain, t, o.dur, o.amp);
    else perc(g.gain, t, o.atk ?? 0.004, o.dur - (o.atk ?? 0.004), o.amp, o.curve ?? 'exp');
    src.connect(f);
    f.connect(g);
    const dest = o.dest ?? this.out;
    if (o.pan !== undefined) {
      const p = this.pan(o.pan);
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    return g;
  }

  /** oscillator with pitch sweep and percussive envelope */
  tone(o: {
    at?: number; type?: OscillatorType; f0: number; f1?: number; dur: number; amp: number; atk?: number;
    curve?: 'exp' | 'lin'; dest?: AudioNode; pan?: number; sweepTime?: number;
    /** soft-saturate (adds harmonics so low thumps stay audible on small speakers) */
    sat?: number;
  }): { osc: OscillatorNode; gain: GainNode } {
    const t = o.at ?? this.t;
    const osc = this.osc(o.type ?? 'sine', o.f0, t, t + o.dur + 0.05);
    if (o.f1 !== undefined) sweep(osc.frequency, t, this.hz(o.f0), this.hz(o.f1), o.sweepTime ?? o.dur, 'exp');
    const g = this.gain(0);
    perc(g.gain, t, o.atk ?? 0.003, o.dur - (o.atk ?? 0.003), o.amp, o.curve ?? 'exp');
    osc.connect(g);
    const dest = o.dest ?? this.out;
    let tail: AudioNode = g;
    if (o.sat) {
      // saturate before the envelope so the harmonics decay with the tone: osc → shaper → gain
      osc.disconnect();
      const pre = this.gain(0.9);
      const w = this.shaper(o.sat);
      osc.connect(pre);
      pre.connect(w);
      w.connect(g);
    }
    if (o.pan !== undefined) {
      const p = this.pan(o.pan);
      tail.connect(p);
      p.connect(dest);
    } else tail.connect(dest);
    return { osc, gain: g };
  }

  /** modal / inharmonic resonator: a sum of exponentially decaying sine partials */
  modes(o: {
    at?: number; f: number; partials: readonly (readonly [ratio: number, amp: number, decay: number])[];
    amp: number; dest?: AudioNode; pan?: number; atk?: number; detuneCents?: number;
  }): void {
    const t = o.at ?? this.t;
    const dest = o.dest ?? this.out;
    const bus = this.gain(o.amp);
    if (o.pan !== undefined) {
      const p = this.pan(o.pan);
      bus.connect(p);
      p.connect(dest);
    } else bus.connect(dest);
    for (const [ratio, a, dec] of o.partials) {
      const fr = o.f * ratio;
      if (fr * this.rate > this.ctx.sampleRate * 0.45) continue;
      const osc = this.osc('sine', fr, t, t + dec * 1.4 + 0.1);
      if (o.detuneCents) osc.detune.value = (this.rng.float() - 0.5) * o.detuneCents;
      const g = this.gain(0);
      perc(g.gain, t, o.atk ?? 0.0015, dec, a, 'exp');
      osc.connect(g);
      g.connect(bus);
    }
  }

  /** stop every source (voice steal / loop teardown) */
  stopAt(when: number): void {
    this.stopped = true;
    for (const s of this.srcs) {
      try {
        s.stop(when);
      } catch {
        /* never started or already stopped */
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope / automation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** attack then exponential (or linear) decay to silence */
export function perc(p: AudioParam, t: number, atk: number, dec: number, peak: number, curve: 'exp' | 'lin' = 'exp'): void {
  atk = Math.max(0.0005, atk);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + atk);
  if (curve === 'exp') {
    // reaches -60 dB at `dec` seconds after the attack, then is cut to exact silence
    p.setTargetAtTime(0, t + atk, Math.max(0.002, dec / 6.9));
    p.setValueAtTime(0, t + atk + dec);
  } else {
    p.linearRampToValueAtTime(0, t + atk + dec);
  }
}

/** swell up (exponential-ish) then hard cut: reverse-cymbal feel */
export function swellEnv(p: AudioParam, t: number, dur: number, peak: number): void {
  p.setValueAtTime(MIN_GAIN, t);
  p.exponentialRampToValueAtTime(peak, t + dur * 0.96);
  p.linearRampToValueAtTime(0, t + dur);
}

/** attack / sustain / release gain envelope; returns the end time */
export function asr(p: AudioParam, t: number, atk: number, hold: number, rel: number, peak: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + atk);
  p.setValueAtTime(peak, t + atk + hold);
  p.setTargetAtTime(0, t + atk + hold, rel / 4.6);
  p.setValueAtTime(0, t + atk + hold + rel * 1.4);
  return t + atk + hold + rel * 1.4;
}

export function sweep(p: AudioParam, t: number, f0: number, f1: number, dur: number, mode: 'exp' | 'lin' = 'exp'): void {
  p.setValueAtTime(Math.max(MIN_GAIN, f0), t);
  if (mode === 'exp') p.exponentialRampToValueAtTime(Math.max(MIN_GAIN, f1), t + dur);
  else p.linearRampToValueAtTime(f1, t + dur);
}

/** piecewise-linear automation through [time offset, value] points */
export function line(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
  p.setValueAtTime(pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
}

/** piecewise-exponential automation (values must be > 0) */
export function expLine(p: AudioParam, t: number, pts: readonly (readonly [number, number])[]): void {
  p.setValueAtTime(Math.max(MIN_GAIN, pts[0][1]), t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(Math.max(MIN_GAIN, pts[i][1]), t + pts[i][0]);
}

/** an LFO that modulates a param: osc → gain(depth) → param */
export function lfo(p: Patch, param: AudioParam, freq: number, depth: number, type: OscillatorType = 'sine', start = p.t, stop?: number): OscillatorNode {
  const o = p.osc(type, freq, start, stop, false);
  const g = p.gain(depth);
  o.connect(g);
  g.connect(param);
  return o;
}

/** slow random wander: lowpassed noise scaled to `depth`, added onto `param` */
export function wander(p: Patch, param: AudioParam, rateHz: number, depth: number, kind: NoiseKind = 'pink', start = p.t, stop?: number): void {
  const n = p.noise(kind, start, stop);
  const lpf = p.bq('lowpass', rateHz, 0.5, false);
  const g = p.gain(depth * 3);
  n.connect(lpf);
  lpf.connect(g);
  g.connect(param);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formant voices
// ─────────────────────────────────────────────────────────────────────────────

/** [F1, F2, F3, F4] centre frequencies in Hz */
export const VOWELS = {
  ah: [800, 1150, 2800, 3500],
  aw: [600, 900, 2700, 3400],
  oh: [500, 850, 2600, 3400],
  oo: [320, 800, 2550, 3300],
  eh: [550, 1800, 2600, 3300],
  ee: [290, 2250, 2900, 3500],
  uh: [640, 1190, 2400, 3300],
} as const;
export type Vowel = keyof typeof VOWELS;

const FORMANT_Q = [6, 8, 10, 12];
const FORMANT_AMP = [1, 0.7, 0.35, 0.2];

export interface VoiceOpts {
  at?: number;
  dur: number;
  /** fundamental frequency keyframes [time offset, Hz] (exponential interpolation) */
  f0: readonly (readonly [number, number])[];
  /** source waveform */
  wave?: OscillatorType;
  /** second, detuned oscillator mixed in (cents); 0 disables */
  detune?: number;
  vowel: Vowel;
  /** vowel to glide to at the end */
  vowel2?: Vowel;
  /** formant frequency scale (bigger creature = lower) */
  size?: number;
  amp: number;
  atk?: number;
  rel?: number;
  /** breath/noise mixed into the formant bank */
  breath?: number;
  /** vibrato Hz / depth in cents */
  vibHz?: number;
  vibCents?: number;
  /** growl: amplitude modulation Hz / depth 0..1 */
  growlHz?: number;
  growl?: number;
  /** waveshaper drive (0 = none) */
  drive?: number;
  /** cheaper variants: number of formant filters (default 4), shared vibrato bus (cents) */
  formants?: 2 | 3 | 4;
  vibBus?: AudioNode;
  /** amplitude keyframes [time offset, gain 0..1]; overrides atk/rel envelope */
  env?: readonly (readonly [number, number])[];
  dest?: AudioNode;
  pan?: number;
}

/** Source-filter voice: saw (+ noise) through a parallel formant bank. Returns the output gain. */
export function formantVoice(p: Patch, o: VoiceOpts): GainNode {
  const t = o.at ?? p.t;
  const end = t + o.dur;
  const size = o.size ?? 1;
  const dest = o.dest ?? p.out;
  const out = p.gain(0);
  const shaped = o.drive ? p.shaper(o.drive) : null;

  const src = p.gain(1);
  const f0 = o.f0;
  const mkOsc = (cents: number): OscillatorNode => {
    const osc = p.osc(o.wave ?? 'sawtooth', f0[0][1], t, end + 0.1);
    osc.detune.value = cents;
    osc.frequency.cancelScheduledValues(0);
    osc.frequency.setValueAtTime(p.hz(f0[0][1]), t);
    for (let i = 1; i < f0.length; i++) osc.frequency.exponentialRampToValueAtTime(p.hz(f0[i][1]), t + f0[i][0]);
    if (o.vibBus) o.vibBus.connect(osc.detune);
    else if (o.vibHz && o.vibCents) {
      const v = p.osc('sine', o.vibHz, t, end + 0.1, false);
      const vg = p.gain(o.vibCents);
      v.connect(vg);
      vg.connect(osc.detune);
    }
    osc.connect(src);
    return osc;
  };
  mkOsc(0);
  if (o.detune) mkOsc(o.detune);

  if (o.breath) {
    const n = p.noise('white', t, end + 0.1);
    const g = p.gain(o.breath);
    n.connect(g);
    g.connect(src);
  }

  const v1 = VOWELS[o.vowel];
  const v2 = VOWELS[o.vowel2 ?? o.vowel];
  const bank = p.gain(1);
  const nf = o.formants ?? 4;
  for (let i = 0; i < nf; i++) {
    const f = p.bq('bandpass', v1[i] * size, FORMANT_Q[i], true);
    if (o.vowel2 && o.vowel2 !== o.vowel) sweep(f.frequency, t, p.hz(v1[i] * size), p.hz(v2[i] * size), o.dur, 'exp');
    const g = p.gain(FORMANT_AMP[i]);
    src.connect(f);
    f.connect(g);
    g.connect(bank);
  }
  let node: AudioNode = bank;
  if (shaped) {
    bank.connect(shaped);
    node = shaped;
  }
  node.connect(out);

  if (o.env) line(out.gain, t, o.env.map(([dt, v]) => [dt, v * o.amp] as const));
  else {
    const atk = o.atk ?? 0.03;
    const rel = o.rel ?? Math.min(0.2, o.dur * 0.4);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(o.amp, t + atk);
    out.gain.setValueAtTime(o.amp, Math.max(t + atk, end - rel));
    out.gain.linearRampToValueAtTime(0, end);
  }
  if (o.growl && o.growlHz) {
    // amplitude modulation: gain = (1 - growl) + growl * (0.5+0.5 sin)  → implemented through a second gain stage
    const am = p.gain(1 - o.growl);
    const l = p.osc('sine', o.growlHz, t, end + 0.1, false);
    const lg = p.gain(o.growl * 0.5);
    l.connect(lg);
    lg.connect(am.gain);
    // dc offset for the modulated half
    const dc = p.ctx.createConstantSource();
    dc.offset.value = o.growl * 0.5;
    dc.start(t);
    dc.stop(end + 0.1);
    p.srcs.push(dc);
    dc.connect(am.gain);
    out.connect(am);
    if (o.pan !== undefined) {
      const pn = p.pan(o.pan);
      am.connect(pn);
      pn.connect(dest);
    } else am.connect(dest);
    return am;
  }
  if (o.pan !== undefined) {
    const pn = p.pan(o.pan);
    out.connect(pn);
    pn.connect(dest);
  } else out.connect(dest);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brass, bells, drums: shared by sfx and music
// ─────────────────────────────────────────────────────────────────────────────

/** Synth brass: two detuned saws through an opening lowpass plus a formant bump. */
export function brass(p: Patch, o: {
  at: number; freq: number; dur: number; amp: number; atk?: number; rel?: number; bright?: number;
  dest?: AudioNode; vibrato?: number; scoop?: number; bend?: number; dissonant?: boolean;
}): GainNode {
  const t = o.at;
  const end = t + o.dur;
  const atk = o.atk ?? 0.09;
  const rel = o.rel ?? 0.35;
  const bright = o.bright ?? 1;
  const dest = o.dest ?? p.out;
  const out = p.gain(0);
  const lp = p.bq('lowpass', 500, 0.8, false);
  const cut = (o.freq * (2.2 + 4 * bright));
  lp.frequency.setValueAtTime(Math.min(cut * 0.35, 18000), t);
  lp.frequency.linearRampToValueAtTime(Math.min(cut, 18000), t + atk + 0.12);
  lp.frequency.linearRampToValueAtTime(Math.min(cut * 0.7, 18000), end);
  const bump = p.bq('peaking', 1100, 1.1, false, 5);
  const mix = p.gain(1);
  const mkOsc = (cents: number, type: OscillatorType, g: number): void => {
    const osc = p.osc(type, o.freq, t, end + rel + 0.1);
    osc.detune.setValueAtTime(cents, t);
    if (o.bend) osc.detune.linearRampToValueAtTime(cents + o.bend, end);
    if (o.scoop) {
      // slide up into the note from below (lip bend)
      osc.frequency.setValueAtTime(p.hz(o.freq) * Math.pow(2, -o.scoop / 12), t);
      osc.frequency.exponentialRampToValueAtTime(p.hz(o.freq), t + atk + 0.06);
    }
    if (o.vibrato) {
      const v = p.osc('sine', 5.2, t + atk, end + rel + 0.1, false);
      const vg = p.gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(o.vibrato, t + atk + 0.5);
      v.connect(vg);
      vg.connect(osc.detune);
    }
    const gg = p.gain(g);
    osc.connect(gg);
    gg.connect(mix);
  };
  mkOsc(-6, 'sawtooth', 0.6);
  mkOsc(7, 'sawtooth', 0.6);
  if (o.dissonant) mkOsc(33, 'sawtooth', 0.3);
  // breath at the attack
  const n = p.noise('white', t, t + 0.25);
  const nf = p.bq('bandpass', o.freq * 3, 1.2, false);
  const ng = p.gain(0);
  perc(ng.gain, t, 0.02, 0.12, 0.08 * bright, 'exp');
  n.connect(nf);
  nf.connect(ng);
  ng.connect(lp);
  mix.connect(lp);
  lp.connect(bump);
  bump.connect(out);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(o.amp, t + atk);
  out.gain.setValueAtTime(o.amp * 0.9, Math.max(t + atk, end - 0.01));
  out.gain.setTargetAtTime(0, end, rel / 4.6);
  out.gain.setValueAtTime(0, end + rel * 1.4);
  out.connect(dest);
  return out;
}

/** large struck skin: pitched body, noise pop and a sub boom */
export function drum(p: Patch, o: {
  at: number; freq: number; amp: number; dur?: number; dest?: AudioNode; pan?: number; skin?: number; boom?: number;
}): void {
  const dur = o.dur ?? 0.5;
  const dest = o.dest ?? p.out;
  const t = o.at;
  p.tone({ at: t, f0: o.freq * 2.2, f1: o.freq, dur, amp: o.amp, sweepTime: 0.06, dest, pan: o.pan, sat: 1.6 });
  p.nb({ at: t, dur: 0.06 + (o.skin ?? 0.5) * 0.06, type: 'bandpass', f0: 1400, q: 0.6, amp: o.amp * 1.1 * (o.skin ?? 0.5), dest, pan: o.pan, kind: 'pink' });
  if (o.boom) p.tone({ at: t, f0: o.freq * 0.55, f1: o.freq * 0.4, dur: dur * 1.6, amp: o.amp * o.boom, atk: 0.01, dest, pan: o.pan });
}

/** inharmonic bell: partial ratios from a church-bell strike spectrum */
export const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [0.5, 0.55, 3.2],
  [1.0, 1.0, 2.8],
  [1.19, 0.6, 2.2],
  [1.5, 0.45, 1.8],
  [2.0, 0.55, 1.5],
  [2.54, 0.3, 1.0],
  [3.0, 0.25, 0.8],
  [4.07, 0.18, 0.55],
  [5.43, 0.1, 0.35],
];
