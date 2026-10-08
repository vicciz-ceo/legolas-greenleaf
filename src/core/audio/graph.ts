/**
 * Mixer graph + players, all written against BaseAudioContext so the game (AudioContext) and
 * the lab (OfflineAudioContext) share one implementation.
 *
 *   sfx voices  → sfxLP → sfxBus ─┐
 *   ambience    → ambLP → ambBus ─┼→ master → compressor → soft-clip → destination
 *   music       → musicLP → musicBus ┘     ▲
 *   space reverb (dynamic IR) ────────────┘ (sfx + ambience sends)
 *   hall reverb  (fixed IR, music only) → musicLP
 */
import type * as THREE from 'three';
import type { LoopName, MusicMood, SfxName } from '../types';
import { Patch, makeImpulse, noiseBuffer, type Ctx } from './dsp';
import { SFX } from './sfx';
import { LOOPS, type Events } from './loops';
import { createMusicEngine, type MusicEngine } from './music';

export const MAX_VOICES = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Reverb
// ─────────────────────────────────────────────────────────────────────────────

/** Convolution reverb with a generated impulse response; the IR can be swapped with a crossfade. */
export class ReverbUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  private pre: BiquadFilterNode;
  private pre2: BiquadFilterNode;
  private cur: { conv: ConvolverNode; gain: GainNode } | null = null;
  private decay = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private ctx: Ctx, decay: number, private opts: { dark?: number; predelay?: number } = {}) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.pre = ctx.createBiquadFilter();
    this.pre.type = 'highpass';
    this.pre.frequency.value = 160;
    this.pre2 = ctx.createBiquadFilter();
    this.pre2.type = 'lowpass';
    this.pre2.frequency.value = 7500;
    this.input.connect(this.pre);
    this.pre.connect(this.pre2);
    this.swap(decay, true);
  }

  get decaySec(): number {
    return this.decay;
  }

  private swap(decay: number, immediate: boolean): void {
    this.decay = decay;
    const conv = this.ctx.createConvolver();
    conv.buffer = makeImpulse(this.ctx, decay, { dark: this.opts.dark ?? 0.55, predelay: this.opts.predelay ?? 0.012, seed: Math.floor(decay * 100) + 3 });
    const gain = this.ctx.createGain();
    this.pre2.connect(conv);
    conv.connect(gain);
    gain.connect(this.output);
    const old = this.cur;
    this.cur = { conv, gain };
    const now = this.ctx.currentTime;
    if (immediate || !old) {
      gain.gain.value = 1;
      return;
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.5);
    old.gain.gain.setValueAtTime(1, now);
    old.gain.gain.linearRampToValueAtTime(0, now + 0.5);
    setTimeout(() => {
      try {
        this.pre2.disconnect(old.conv);
        old.conv.disconnect();
        old.gain.disconnect();
      } catch {
        /* already gone */
      }
    }, 800);
  }

  /** change the decay time (debounced; the IR is regenerated and crossfaded) */
  setDecay(decay: number): void {
    decay = Math.max(0.3, Math.min(9, decay));
    if (Math.abs(decay - this.decay) < 0.12) return;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      this.swap(decay, false);
    }, 120);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph
// ─────────────────────────────────────────────────────────────────────────────

export interface Graph {
  ctx: Ctx;
  /** user master gain */
  master: GainNode;
  musicBus: GainNode;
  sfxBus: GainNode;
  ambBus: GainNode;
  sfxIn: GainNode;
  sfxLP: BiquadFilterNode;
  ambIn: GainNode;
  ambLP: BiquadFilterNode;
  musicIn: GainNode;
  musicLP: BiquadFilterNode;
  space: ReverbUnit;
  spaceReturn: GainNode;
  hall: ReverbUnit;
  /** constant sources whose offset (cents) is added to every source's detune */
  sfxDetune: ConstantSourceNode | null;
  ambDetune: ConstantSourceNode | null;
  musicDetune: ConstantSourceNode | null;
  comp: DynamicsCompressorNode;
  /** kept alive so the HRTF database stays loaded */
  warm: PannerNode;
}

const TRIM = { music: 0.62, sfx: 0.9, amb: 0.7 };

function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export function buildGraph(ctx: Ctx, o: { /** debug: skip compressor + soft clip */ bypass?: boolean } = {}): Graph {
  // generate the shared noise buffers up front so the first sound doesn't stall
  noiseBuffer(ctx, 'white');
  noiseBuffer(ctx, 'pink');
  noiseBuffer(ctx, 'brown');
  const mk = (): ConstantSourceNode | null => {
    try {
      const c = ctx.createConstantSource();
      c.offset.value = 0;
      c.start();
      return c;
    } catch {
      return null;
    }
  };
  // constructing one HRTF panner starts the async load of the HRTF database (avoids a hitch on the first positional sound)
  const warm = ctx.createPanner();
  warm.panningModel = 'HRTF';
  const master = ctx.createGain();
  master.gain.value = 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -9;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  if (o.bypass) master.connect(ctx.destination);
  else {
    master.connect(comp);
    comp.connect(clip);
    clip.connect(ctx.destination);
  }

  const bus = (trim: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = trim;
    g.connect(master);
    return g;
  };
  const musicBus = bus(TRIM.music);
  const sfxBus = bus(TRIM.sfx);
  const ambBus = bus(TRIM.amb);
  const lpf = (dest: AudioNode): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 22000;
    f.Q.value = 0.5;
    f.connect(dest);
    return f;
  };
  const sfxLP = lpf(sfxBus);
  const ambLP = lpf(ambBus);
  const musicLP = lpf(musicBus);
  const sfxIn = ctx.createGain();
  sfxIn.connect(sfxLP);
  const ambIn = ctx.createGain();
  ambIn.connect(ambLP);
  const musicIn = ctx.createGain();
  musicIn.connect(musicLP);

  const space = new ReverbUnit(ctx, 1.7, { dark: 0.55 });
  const spaceReturn = ctx.createGain();
  spaceReturn.gain.value = 0.8;
  space.output.connect(spaceReturn);
  // the room is heard through the same slow-motion filters as the dry sound
  spaceReturn.connect(sfxLP);

  const hall = new ReverbUnit(ctx, 3.4, { dark: 0.6, predelay: 0.025 });
  hall.output.connect(musicIn);

  return {
    ctx, master, musicBus, sfxBus, ambBus, sfxIn, sfxLP, ambIn, ambLP, musicIn, musicLP, space, spaceReturn, hall,
    sfxDetune: mk(), ambDetune: mk(), musicDetune: mk(), comp, warm,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SFX player (voice limiting, HRTF panning, distance, random pitch)
// ─────────────────────────────────────────────────────────────────────────────

interface Voice {
  name: SfxName;
  start: number;
  end: number;
  patch: Patch;
  out: GainNode;
  nodes: AudioNode[];
}

export interface PlayOpts {
  pos?: THREE.Vector3;
  volume?: number;
  pitch?: number;
}

export class SfxPlayer {
  voices: Voice[] = [];
  private last: Partial<Record<SfxName, number>> = {};
  private lx = 0;
  private ly = 0;
  private lz = 0;
  /** diagnostic counters */
  stolen = 0;
  played = 0;

  constructor(private g: Graph) {}

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3): void {
    const l = this.g.ctx.listener;
    const t = this.g.ctx.currentTime;
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      const old = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(...a: number[]): void };
      old.setPosition(pos.x, pos.y, pos.z);
      old.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** drop finished voices */
  prune(): void {
    const now = this.g.ctx.currentTime;
    let w = 0;
    for (const v of this.voices) {
      if (now > v.end) this.kill(v, false);
      else this.voices[w++] = v;
    }
    this.voices.length = w;
  }

  private kill(v: Voice, fade: boolean): void {
    const now = this.g.ctx.currentTime;
    if (fade) {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, 0.008);
      v.patch.stopAt(now + 0.08);
      const nodes = v.nodes;
      setTimeout(() => nodes.forEach((n) => safeDisconnect(n)), 160);
    } else {
      for (const n of v.nodes) safeDisconnect(n);
    }
  }

  play(name: SfxName, opts: PlayOpts = {}, rand: () => number = Math.random): Voice | null {
    const def = SFX[name];
    const g = this.g;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    if (!def) return null;
    const last = this.last[name];
    if (last !== undefined && now - last < def.gap) return null;
    this.prune();
    // per-sound polyphony
    let same = 0;
    let oldestSame: Voice | null = null;
    for (const v of this.voices) {
      if (v.name === name) {
        same++;
        if (!oldestSame) oldestSame = v;
      }
    }
    if (same >= def.poly && oldestSame) this.steal(oldestSame);
    // global voice limit: steal the oldest
    while (this.voices.length >= MAX_VOICES) this.steal(this.voices[0]);

    const vol = Math.max(0, opts.volume ?? 1) * def.gain;
    if (vol <= 0.0005) return null;
    const pitch = Math.max(0.25, Math.min(4, (opts.pitch ?? 1) * (1 + (rand() * 2 - 1) * def.vary)));

    const t = now + 0.006;
    const out = ctx.createGain();
    out.gain.value = vol;
    const nodes: AudioNode[] = [out];
    let send = def.verb * vol;
    if (opts.pos) {
      const dx = opts.pos.x - this.lx;
      const dy = opts.pos.y - this.ly;
      const dz = opts.pos.z - this.lz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const REF = 4;
      const ROLL = 1.25;
      const att = REF / (REF + ROLL * (Math.max(REF, Math.min(dist, 160)) - REF));
      let node: AudioNode = out;
      if (dist > 10) {
        // air absorption
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(1200, 16000 / (1 + (dist - 10) / 22));
        lp.Q.value = 0.4;
        out.connect(lp);
        nodes.push(lp);
        node = lp;
      }
      const pan = ctx.createPanner();
      pan.panningModel = dist > 35 ? 'equalpower' : 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = REF;
      pan.maxDistance = 160;
      pan.rolloffFactor = ROLL;
      if (pan.positionX) {
        pan.positionX.value = opts.pos.x;
        pan.positionY.value = opts.pos.y;
        pan.positionZ.value = opts.pos.z;
      } else (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
      node.connect(pan);
      pan.connect(g.sfxIn);
      nodes.push(pan);
      // far sounds are mostly room: keep the send from dropping as fast as the dry signal
      send *= 0.3 + 0.7 * att + Math.min(0.5, dist / 80) * 0.4;
    } else {
      out.connect(g.sfxIn);
    }
    if (send > 0.002) {
      const s = ctx.createGain();
      s.gain.value = send;
      out.connect(s);
      s.connect(g.space.input);
      nodes.push(s);
    }
    const patch = new Patch(ctx, out, t, { rate: pitch, detune: g.sfxDetune, seed: Math.floor(rand() * 0xffffffff) });
    let dur = 0.5;
    try {
      dur = def.build(patch);
    } catch (e) {
      console.warn('[audio] failed to build', name, e);
      for (const n of nodes) safeDisconnect(n);
      return null;
    }
    const v: Voice = { name, start: now, end: t + dur + 0.15, patch, out, nodes };
    this.voices.push(v);
    this.last[name] = now;
    this.played++;
    return v;
  }

  private steal(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this.kill(v, true);
    this.stolen++;
  }

  stopAll(): void {
    for (const v of this.voices) this.kill(v, true);
    this.voices.length = 0;
  }
}

function safeDisconnect(n: AudioNode): void {
  try {
    n.disconnect();
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop player
// ─────────────────────────────────────────────────────────────────────────────

interface LoopInst {
  name: LoopName;
  out: GainNode;
  patch: Patch;
  events: Events;
  target: number;
  dyingAt: number;
}

export class LoopPlayer {
  active = new Map<LoopName, LoopInst>();
  constructor(private g: Graph) {}

  set(name: LoopName, volume: number): void {
    const ctx = this.g.ctx;
    const now = ctx.currentTime;
    let inst = this.active.get(name);
    if (volume <= 0.002) {
      if (inst && inst.dyingAt === 0) {
        inst.target = 0;
        inst.out.gain.cancelScheduledValues(now);
        inst.out.gain.setTargetAtTime(0, now, 0.35);
        inst.dyingAt = now + 2.2;
      }
      return;
    }
    if (!inst) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.g.ambIn);
      const send = ctx.createGain();
      send.gain.value = 0.18;
      out.connect(send);
      send.connect(this.g.space.input);
      const patch = new Patch(ctx, out, now + 0.02, { detune: this.g.ambDetune });
      const events = LOOPS[name].build(patch);
      inst = { name, out, patch, events, target: volume, dyingAt: 0 };
      this.active.set(name, inst);
      events.pump(now + 0.6, now);
    }
    inst.dyingAt = 0;
    inst.target = volume;
    inst.out.gain.cancelScheduledValues(now);
    inst.out.gain.setTargetAtTime(volume * LOOPS[name].trim, now, 0.6);
  }

  stopAll(): void {
    for (const name of [...this.active.keys()]) this.set(name, 0);
  }

  /** schedule discrete events and tear down faded-out loops */
  pump(): void {
    const now = this.g.ctx.currentTime;
    for (const [name, inst] of this.active) {
      if (inst.dyingAt && now > inst.dyingAt) {
        inst.patch.stopAt(now);
        safeDisconnect(inst.out);
        this.active.delete(name);
        continue;
      }
      inst.events.pump(now + 0.6, now - 0.05);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Music player
// ─────────────────────────────────────────────────────────────────────────────

export class MusicPlayer {
  engine: MusicEngine;
  constructor(private g: Graph, seed?: number) {
    this.engine = createMusicEngine(g.ctx, g.musicIn, { detune: g.musicDetune, hall: g.hall.input, seed });
  }
  set(mood: MusicMood, instant = false): void {
    this.engine.setMood(mood, this.g.ctx.currentTime, instant);
  }
  pump(): void {
    const now = this.g.ctx.currentTime;
    this.engine.pump(now + 0.4, now);
  }
}

export { type Ctx };
