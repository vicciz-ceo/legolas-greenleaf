/**
 * Generative score in D minor / Dorian. A 16th-note sequencer drives seven layered stems
 * (drone, string pad, harp/lute, choir, war drums, staccato strings, horns) whose gains
 * crossfade by MusicMood. Chord progressions, tempo and patterns depend on the mood; victory
 * and defeat have one-shot stingers followed by a quiet bed. Everything is synthesised:
 * detuned saws, Karplus-Strong plucks, formant-filtered saw choir, pitched noise-skin drums.
 */
import type { MusicMood } from '../types';
import { Rng } from '../rng';
import {
  BELL_PARTIALS, Patch, VOWELS, brass, drum, midiHz, perc, sweep, type Ctx,
} from './dsp';

export type Stem = 'drone' | 'pad' | 'harp' | 'choir' | 'drums' | 'ostinato' | 'horns';
const STEMS: Stem[] = ['drone', 'pad', 'harp', 'choir', 'drums', 'ostinato', 'horns'];

interface Chord {
  pc: number;
  ints: number[];
}
const ch = (pc: number, ...ints: number[]): Chord => ({ pc, ints });
const Dm = ch(2, 0, 3, 7), Dm7 = ch(2, 0, 3, 7, 10), Dsus = ch(2, 0, 2, 7), DM = ch(2, 0, 4, 7);
const Bb = ch(10, 0, 4, 7), BbM7 = ch(10, 0, 4, 7, 11), Gm = ch(7, 0, 3, 7), G = ch(7, 0, 4, 7);
const C = ch(0, 0, 4, 7), Cadd9 = ch(0, 0, 4, 7, 14), F = ch(5, 0, 4, 7), A = ch(9, 0, 4, 7);
const Eb = ch(3, 0, 4, 7), Bm = ch(11, 0, 3, 7), Bdim = ch(11, 0, 3, 6), Gsus = ch(7, 0, 2, 7);

interface MoodCfg {
  bpm: number;
  barsPer: number;
  prog: Chord[];
  /** stem targets 0..1 */
  stems: Record<Stem, number>;
  /** fade time constant (s) */
  tc: number;
  /** mood loudness trim in dB (calm moods quieter than action) */
  level: number;
}

const CFG: Record<Exclude<MusicMood, 'none'>, MoodCfg> = {
  menu: {
    bpm: 58, barsPer: 2, tc: 1.6, level: 2,
    prog: [Dm, Bb, F, C, Dm, Gm, A, Dm],
    stems: { drone: 0.5, pad: 0.7, harp: 0.8, choir: 0.22, drums: 0, ostinato: 0, horns: 0 },
  },
  explore: {
    bpm: 68, barsPer: 2, tc: 1.8, level: 2.4,
    prog: [Dm7, G, Dm7, Cadd9, Dm7, BbM7, Cadd9, Dm],
    stems: { drone: 0.5, pad: 0.65, harp: 0.6, choir: 0.12, drums: 0, ostinato: 0, horns: 0 },
  },
  tension: {
    bpm: 80, barsPer: 2, tc: 1.2, level: 2.3,
    prog: [Dsus, Eb, Dm, Bdim, Dsus, Eb, Gm, A],
    stems: { drone: 0.9, pad: 0.5, harp: 0.3, choir: 0.2, drums: 0.8, ostinato: 0.5, horns: 0 },
  },
  combat: {
    bpm: 136, barsPer: 1, tc: 0.6, level: 4.2,
    prog: [Dm, Bb, C, Dm, Dm, Bb, Gm, A],
    stems: { drone: 0.5, pad: 0.5, harp: 0.5, choir: 0, drums: 1, ostinato: 0.9, horns: 0.2 },
  },
  boss: {
    bpm: 108, barsPer: 1, tc: 0.9, level: 2.3,
    prog: [Dm, Dm, Eb, Dm, Dm, Gm, Eb, A],
    stems: { drone: 0.85, pad: 0.55, harp: 0, choir: 0.55, drums: 1, ostinato: 0.75, horns: 0.85 },
  },
  epic: {
    bpm: 94, barsPer: 1, tc: 1.1, level: 2,
    prog: [Dm, Bb, F, C, Dm, Bb, Gm, A],
    stems: { drone: 0.5, pad: 0.8, harp: 0.5, choir: 0.8, drums: 0.75, ostinato: 0.7, horns: 0.95 },
  },
  victory: {
    bpm: 80, barsPer: 2, tc: 2.4, level: 2.2,
    prog: [DM, G, A, DM, Bm, G, A, DM],
    stems: { drone: 0.3, pad: 0.7, harp: 0.55, choir: 0.55, drums: 0, ostinato: 0, horns: 0 },
  },
  defeat: {
    bpm: 52, barsPer: 2, tc: 2.4, level: 2.6,
    prog: [Dm, Gsus, Dm, Eb, Dm, Bb, Gm, Dm],
    stems: { drone: 0.75, pad: 0.35, harp: 0.0, choir: 0.18, drums: 0, ostinato: 0, horns: 0 },
  },
};

/** 16-step drum patterns (velocity 0..1): low taiko, mid tom, hand/rim */
interface DrumPat {
  low: number[];
  mid: number[];
  hi: number[];
  lowHz: number;
  midHz: number;
  boom: number;
}
const DRUMS: Partial<Record<MusicMood, DrumPat>> = {
  combat: {
    low: [1, 0, 0, 0, 0, 0, 0.8, 0, 1, 0, 0, 0, 0, 0.6, 0, 0.7],
    mid: [0, 0, 0.6, 0, 0.7, 0, 0, 0.5, 0, 0, 0.6, 0, 0.7, 0, 0.5, 0],
    hi: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.3],
    lowHz: 62, midHz: 96, boom: 0.4,
  },
  boss: {
    low: [1, 0, 0, 0.4, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 0.5, 0, 0],
    mid: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0.5, 0.5],
    hi: [0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0.3],
    lowHz: 52, midHz: 82, boom: 0.7,
  },
  epic: {
    low: [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0.6, 0],
    mid: [0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0.7, 0, 0.7, 0, 0, 0],
    hi: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    lowHz: 56, midHz: 88, boom: 0.9,
  },
  tension: {
    low: [0.8, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    mid: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hi: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    lowHz: 50, midHz: 80, boom: 0.5,
  },
};

/** horn lines for the 8-bar epic cycle: [step offset, midi, length in steps] */
const EPIC_HORN: [number, number, number][][] = [
  [[0, 62, 16]],
  [[0, 58, 10], [10, 62, 6]],
  [[0, 65, 16]],
  [[0, 64, 8], [8, 67, 8]],
  [[0, 62, 8], [8, 69, 8]],
  [[0, 70, 10], [10, 69, 6]],
  [[0, 67, 12], [12, 65, 4]],
  [[0, 61, 16]],
];

const voiceInto = (root: number, ints: number[], lo: number, hi: number): number[] =>
  ints.map((i) => {
    let m = root + i;
    while (m < lo) m += 12;
    while (m >= hi) m -= 12;
    return m;
  }).sort((a, b) => a - b);

export interface MusicEngine {
  setMood(mood: MusicMood, now: number, instant?: boolean): void;
  /** schedule everything that starts before `until` (audio-clock seconds) */
  pump(until: number, now: number): void;
  /** 0..1: more drums / horns / tempo */
  setIntensity(v: number, now: number): void;
  readonly mood: MusicMood;
  dispose(): void;
}

export function createMusicEngine(ctx: Ctx, out: AudioNode, opts: { detune?: AudioNode | null; hall?: AudioNode | null; seed?: number; /** debug: stems to leave out */ mute?: Stem[] } = {}): MusicEngine {
  const detune = opts.detune ?? null;
  const hall = opts.hall ?? null;
  const rng = new Rng(opts.seed ?? 20241);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(out);

  const stem = {} as Record<Stem, GainNode>;
  const SEND: Record<Stem, number> = { drone: 0.08, pad: 0.45, harp: 0.5, choir: 0.65, drums: 0.3, ostinato: 0.15, horns: 0.55 };
  for (const s of STEMS) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    if (hall) {
      const sg = ctx.createGain();
      sg.gain.value = SEND[s];
      g.connect(sg);
      sg.connect(hall);
    }
    stem[s] = g;
  }
  // stinger bus
  const fx = ctx.createGain();
  fx.gain.value = 0.35;
  fx.connect(master);
  if (hall) {
    const sg = ctx.createGain();
    sg.gain.value = 0.55;
    fx.connect(sg);
    sg.connect(hall);
  }

  const mkPatch = (dest: AudioNode, t: number): Patch => new Patch(ctx, dest, t, { detune, seed: Math.floor(rng.float() * 0xffffffff) });

  // ── drone (continuous) ─────────────────────────────────────────────────────
  const drone = mkPatch(stem.drone, ctx.currentTime);
  {
    const lp = drone.bq('lowpass', 260, 0.7, false);
    const body = drone.gain(0.045);
    for (const c of [-8, 0, 8]) {
      const o = drone.osc('sawtooth', 73.42, drone.t, undefined, false);
      o.detune.value = c;
      o.connect(body);
    }
    body.connect(lp);
    lp.connect(stem.drone);
    // slow filter breathing
    const l = drone.osc('sine', 0.045, drone.t, undefined, false);
    const lg = drone.gain(110);
    l.connect(lg);
    lg.connect(lp.frequency);
    const sub = drone.osc('sine', 36.71, drone.t, undefined, false);
    const sg = drone.gain(0.08);
    sub.connect(sg);
    sg.connect(stem.drone);
    const fifth = drone.osc('sine', 110, drone.t, undefined, false);
    const fg = drone.gain(0.02);
    fifth.connect(fg);
    fg.connect(stem.drone);
    const octave = drone.osc('triangle', 146.83, drone.t, undefined, false);
    const og = drone.gain(0.015);
    octave.connect(og);
    og.connect(stem.drone);
    const lfo2 = drone.osc('sine', 0.08, drone.t, undefined, false);
    const l2g = drone.gain(0.02);
    lfo2.connect(l2g);
    l2g.connect(og.gain);
  }

  const harpLP = ctx.createBiquadFilter();
  harpLP.type = 'lowpass';
  harpLP.frequency.value = 4800;
  harpLP.Q.value = 0.5;
  harpLP.connect(stem.harp);

  // shared string vibrato bus (cents)
  const vib = ctx.createGain();
  vib.gain.value = 1;
  {
    const o = ctx.createOscillator();
    o.frequency.value = 4.9;
    const g = ctx.createGain();
    g.gain.value = 1;
    o.connect(g);
    g.connect(vib);
    o.start();
  }

  const stringVib = ctx.createGain();
  stringVib.gain.value = 5;
  vib.connect(stringVib);
  // choir vibrato (deeper than the strings')
  const choirVib = ctx.createGain();
  choirVib.gain.value = 17;
  vib.connect(choirVib);

  const muted = new Set<Stem>(opts.mute ?? []);

  // ── state ─────────────────────────────────────────────────────────────────
  let mood: MusicMood = 'none';
  let bpm = 70;
  let bpmTarget = 70;
  let intensity = 0.5;
  let nextT = -1;
  let stepI = 0;
  let bar = 0;
  let running = false;
  const target: Record<Stem, number> = { drone: 0, pad: 0, harp: 0, choir: 0, drums: 0, ostinato: 0, horns: 0 };
  const offAt: Record<Stem, number> = { drone: 0, pad: 0, harp: 0, choir: 0, drums: 0, ostinato: 0, horns: 0 };
  let tcNow = 1.5;
  let harpIdx = 8;
  let harpDir = 1;
  let ostiStep = 0;

  const lastV: Record<Stem, number> = { drone: 0, pad: 0, harp: 0, choir: 0, drums: 0, ostinato: 0, horns: 0 };
  const applyTargets = (now: number, instant: boolean): void => {
    for (const s of STEMS) {
      const k = intensityScale(s);
      const v = muted.has(s) || mood === 'none' ? 0 : target[s] * k * Math.pow(10, CFG[mood].level / 20);
      const p = stem[s].gain;
      p.cancelScheduledValues(now);
      if (instant) p.setValueAtTime(v, now);
      else {
        p.setValueAtTime(p.value, now);
        // rhythmic layers leave faster than they arrive, so a fight ending doesn't leave drums hanging
        p.setTargetAtTime(v, now, v < lastV[s] ? tcNow * 0.55 : tcNow);
      }
      lastV[s] = v;
    }
  };
  function intensityScale(s: Stem): number {
    if (s === 'drums' || s === 'ostinato' || s === 'horns') return 0.72 + 0.4 * intensity;
    return 1;
  }

  const stemLive = (s: Stem, now: number): boolean => !muted.has(s) && (target[s] > 0.015 || now < offAt[s] + tcNow * 4.5);

  // ── stem generators ───────────────────────────────────────────────────────
  const stepDur = (): number => 60 / bpm / 4;

  function padChord(t: number, chord: Chord, dur: number, m: MoodCfg): void {
    const bright = mood === 'epic' || mood === 'victory' ? 1.25 : mood === 'boss' || mood === 'defeat' ? 0.7 : 1;
    const atk = Math.min(2.2, Math.max(0.5, dur * 0.4));
    const rel = m.barsPer === 1 ? 1.1 : 1.8;
    const notes = voiceInto(chord.pc, chord.ints, 50, 71);
    if (mood === 'epic' || mood === 'victory') notes.push(notes[0] + 12, notes[1] + 12);
    if (mood === 'tension') notes.push(chord.pc + 1 + 48); // clustery b9 colour
    const bass = voiceInto(chord.pc, [0], 38, 50)[0];
    const lows = [bass, ...(mood === 'boss' || mood === 'epic' ? [bass + 7] : [])];
    // one low-pass + envelope per chord (cheap), 2 detuned saws on the triad and 1 on the rest
    const p = mkPatch(stem.pad, t);
    const cutoff = 2100 * bright * (0.8 + 0.4 * intensity);
    const lp = p.bq('lowpass', cutoff, 0.5, false);
    const g = p.gain(0);
    const end = t + dur + 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + atk);
    g.gain.setValueAtTime(0.16, end);
    g.gain.setTargetAtTime(0, end, rel / 6.9);
    g.gain.setValueAtTime(0, end + rel);
    lp.frequency.setValueAtTime(cutoff * 0.5, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + atk * 1.2);
    lp.connect(g);
    g.connect(stem.pad);
    const voice = (n: number, w: number, detunes: number[]): void => {
      const f = midiHz(n);
      for (const c of detunes) {
        const o = p.osc('sawtooth', f, t, end + rel + 0.05, false);
        o.detune.value = c + rng.range(-3, 3);
        stringVib.connect(o.detune);
        const og = p.gain(w);
        o.connect(og);
        og.connect(lp);
      }
    };
    notes.forEach((n, i) => voice(n, 0.45, i < 3 ? [-8, 9] : [1]));
    lows.forEach((n) => voice(n, 0.4, [0]));
  }

  function choirChord(t: number, chord: Chord, dur: number, vowel: 'ah' | 'oh' | 'oo', amp: number, dest: AudioNode, lo = 55, spread = true): void {
    const p = mkPatch(dest, t);
    const notes = voiceInto(chord.pc, chord.ints.slice(0, 3), lo, lo + 17);
    const tenor = voiceInto(chord.pc, [0], lo - 12, lo)[0];
    const midis = [tenor, ...notes];
    if (spread) midis.push(notes[notes.length - 1] + 12);
    const atk = Math.min(1.6, dur * 0.4);
    const rel = Math.min(1.8, dur * 0.4);
    const end = t + dur;
    const v1 = VOWELS[vowel];
    const v2 = VOWELS[vowel === 'ah' ? 'oh' : vowel === 'oh' ? 'ah' : 'oo'];
    // the shared vowel formants colour every voice (as in a real choir); two banks give a stereo spread
    const env = p.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + atk);
    env.gain.setValueAtTime(0.9, Math.max(t + atk, end - rel));
    env.gain.linearRampToValueAtTime(0, end);
    env.connect(dest);
    const inputs: GainNode[] = [];
    for (const pan of [-0.45, 0.45]) {
      const inp = p.gain(1);
      const pn = p.pan(pan);
      pn.connect(env);
      for (let i = 0; i < 3; i++) {
        const f = p.bq('bandpass', v1[i], [6, 8, 10][i], false);
        sweep(f.frequency, t, v1[i], v2[i], dur, 'exp');
        const fg = p.gain([1, 0.7, 0.35][i]);
        inp.connect(f);
        f.connect(fg);
        fg.connect(pn);
      }
      inputs.push(inp);
    }
    const per = (amp * 6) / Math.sqrt(midis.length);
    midis.forEach((n, i) => {
      const o = p.osc('sawtooth', midiHz(n), t, end + 0.1, false);
      o.detune.value = rng.range(-9, 9);
      choirVib.connect(o.detune);
      const og = p.gain(per);
      o.connect(og);
      og.connect(inputs[i % 2]);
    });
    const nz = p.noise('white', t, end + 0.1);
    const ng = p.gain(0.1 * amp);
    nz.connect(ng);
    ng.connect(inputs[0]);
    ng.connect(inputs[1]);
  }

  function harpNote(t: number, midi: number, vel: number, lute: boolean, pan: number): void {
    const p = mkPatch(stem.harp, t);
    const pn = p.pan(Math.max(-0.8, Math.min(0.8, pan)));
    pn.connect(harpLP);
    const dur = lute ? 0.7 : 1.9;
    p.pluck(midiHz(midi), t, dur, vel * 1.1, lute ? { decay: 0.9925, bright: 0.45, pick: 0.25 } : { decay: 0.9984, bright: 0.6, pick: 0.15 }, pn);
  }

  function stepHarp(t: number, chord: Chord, s: number, m: MoodCfg): void {
    const cfg = HARP[mood];
    if (!cfg) return;
    if (s % cfg.stride !== 0) return;
    const pool: number[] = [];
    for (let o = 0; o < 4; o++) for (const n of voiceInto(chord.pc, chord.ints, 48 + o * 12, 60 + o * 12)) pool.push(n);
    pool.sort((a, b) => a - b);
    const lo = cfg.lo, hi = Math.min(pool.length - 1, cfg.hi);
    // random walk through the pool, mostly stepwise
    const stepSel = rng.pick([1, 1, 1, 2, 2, 3]);
    if (rng.chance(0.18)) harpDir *= -1;
    harpIdx += harpDir * stepSel;
    if (harpIdx > hi) { harpIdx = hi - 1; harpDir = -1; }
    if (harpIdx < lo) { harpIdx = lo + 1; harpDir = 1; }
    const accent = s % 16 === 0 ? 1 : s % 8 === 0 ? 0.85 : 0.65;
    if (!rng.chance(cfg.prob * (s % 16 === 0 ? 1.4 : 1))) return;
    const midi = pool[Math.max(0, Math.min(pool.length - 1, harpIdx))];
    harpNote(t + rng.range(0, 0.012), midi, (0.55 + 0.45 * accent) * cfg.vel, cfg.lute, ((midi - 66) / 40) + rng.range(-0.1, 0.1));
    void m;
  }

  function drumHit(t: number, hz: number, amp: number, boom: number, dur = 0.55): void {
    const p = mkPatch(stem.drums, t);
    drum(p, { at: t, freq: hz * rng.range(0.99, 1.01), amp: amp * 0.5, dur, boom, skin: 0.55, pan: rng.range(-0.1, 0.1) });
  }

  function stepDrums(t: number, s: number, barN: number): void {
    const pat = DRUMS[mood];
    if (!pat) return;
    const k = 0.7 + 0.5 * intensity;
    const fill = (barN % 4 === 3) && s >= 12;
    if (fill && mood !== 'tension') {
      // rolling fill on toms
      const vel = 0.5 + (s - 12) * 0.15;
      drumHit(t, s % 2 ? pat.midHz : pat.lowHz * 1.3, vel * k, 0, 0.3);
      return;
    }
    if (pat.low[s]) drumHit(t, pat.lowHz, pat.low[s] * k, pat.boom);
    if (pat.mid[s]) drumHit(t, pat.midHz, pat.mid[s] * k * 0.8, 0, 0.4);
    if (pat.hi[s]) {
      const p = mkPatch(stem.drums, t);
      p.nb({ at: t, dur: 0.07, kind: 'pink', type: 'bandpass', f0: 1800, q: 1.2, amp: pat.hi[s] * 0.2 * k });
      p.tone({ at: t, f0: 210, f1: 150, dur: 0.1, amp: pat.hi[s] * 0.13 * k, sweepTime: 0.05 });
    }
    // epic: add a big boom with long tail on bar starts
    if (mood === 'epic' && s === 0 && barN % 2 === 0) {
      const p = mkPatch(stem.drums, t);
      p.tone({ at: t, f0: 52, f1: 30, dur: 1.8, amp: 0.35, sweepTime: 0.4 });
      p.nb({ at: t, dur: 1.4, kind: 'brown', type: 'lowpass', f0: 160, amp: 0.2, atk: 0.01 });
    }
  }

  function stepOstinato(t: number, chord: Chord, s: number, barN: number): void {
    const pat = OSTI[mood];
    if (!pat) return;
    const v = pat.vel[s];
    if (!v) return;
    const root = voiceInto(chord.pc, [0], 43, 55)[0];
    const fifth = voiceInto(chord.pc, [chord.ints[2] ?? 7], 50, 62)[0];
    const pick = pat.notes[s % pat.notes.length];
    let m = pick === 0 ? root : pick === 1 ? fifth : pick === 2 ? root + 12 : root + 1; // 3 = b2 tension
    if (mood === 'boss' && barN % 2 === 1 && pick === 3) m = root + 6;
    const p = mkPatch(stem.ostinato, t);
    const f = midiHz(m);
    const lp = p.bq('lowpass', 700 + 900 * intensity, 0.8, false);
    const g = p.gain(0);
    const d = pat.len;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * v, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.012, d / 3.2);
    const o = p.osc('sawtooth', f, t, t + d * 2.2 + 0.05, false);
    o.detune.value = rng.range(-6, 6);
    const og = p.gain(1);
    o.connect(og);
    og.connect(lp);
    lp.connect(g);
    g.connect(stem.ostinato);
    ostiStep++;
  }

  function stepHorns(t: number, chord: Chord, s: number, barN: number): void {
    const sd = stepDur();
    if (mood === 'epic') {
      if (s === 0 || barN % 1 === 0) {
        const line = EPIC_HORN[barN % 8];
        for (const [off, midi, len] of line) {
          if (off !== s) continue;
          const p = mkPatch(stem.horns, t);
          brass(p, { at: t, freq: midiHz(midi), dur: len * sd * 0.98, amp: 0.2, atk: 0.12, rel: 0.5, vibrato: 11, bright: 0.85, scoop: off === 0 ? 1.5 : 0 });
          brass(p, { at: t, freq: midiHz(midi - 12), dur: len * sd * 0.98, amp: 0.1, atk: 0.15, rel: 0.5, vibrato: 9, bright: 0.5 });
        }
      }
    } else if (mood === 'boss') {
      const hits: [number, number, number][] = barN % 2 === 0 ? [[0, 0, 7], [10, 6, 4]] : [[0, 1, 5], [6, 0, 5], [12, 6, 4]];
      for (const [off, kind, len] of hits) {
        if (off !== s) continue;
        const root = voiceInto(chord.pc, [0], 38, 50)[0];
        const m = kind === 0 ? root : kind === 1 ? root + 1 : root + 6; // root, b2, tritone
        const p = mkPatch(stem.horns, t);
        brass(p, { at: t, freq: midiHz(m), dur: len * sd, amp: 0.26, atk: 0.06, rel: 0.2, bright: 0.7, dissonant: true, bend: -20 });
        brass(p, { at: t, freq: midiHz(m + 12), dur: len * sd, amp: 0.12, atk: 0.08, rel: 0.2, bright: 0.5 });
      }
    } else if (mood === 'combat') {
      if (s === 0 && barN % 4 === 0) {
        const root = voiceInto(chord.pc, [0], 50, 62)[0];
        const p = mkPatch(stem.horns, t);
        brass(p, { at: t, freq: midiHz(root), dur: 16 * sd * 0.95, amp: 0.5, atk: 0.1, rel: 0.4, bright: 0.7, vibrato: 8 });
        brass(p, { at: t, freq: midiHz(root + 7), dur: 16 * sd * 0.95, amp: 0.3, atk: 0.12, rel: 0.4, bright: 0.6 });
      }
    }
  }

  function startChord(t: number, chord: Chord, m: MoodCfg): void {
    const dur = m.barsPer * 16 * stepDur();
    if (stemLive('pad', t)) padChord(t, chord, dur, m);
    if (stemLive('choir', t)) {
      const idx = Math.floor(bar / m.barsPer) % m.prog.length;
      const vowel = mood === 'boss' || mood === 'defeat' ? 'oo' : idx % 2 ? 'oh' : 'ah';
      const lo = mood === 'epic' || mood === 'victory' ? 57 : 53;
      choirChord(t, chord, Math.max(2, dur), vowel, mood === 'epic' ? 0.14 : mood === 'boss' ? 0.16 : 0.2, stem.choir, lo, mood === 'epic' || mood === 'victory');
    }
  }

  // ── stingers ──────────────────────────────────────────────────────────────
  function stingerVictory(t: number): number {
    const p = mkPatch(fx, t);
    // timpani roll
    for (let i = 0; i < 12; i++) {
      const at = t + i * 0.075;
      drum(p, { at, freq: 70, amp: 0.1 + 0.4 * (i / 11), dur: 0.3, skin: 0.4 });
    }
    // cymbal swell
    p.nb({ at: t, dur: 1.2, type: 'highpass', f0: 5000, amp: 0.1, swell: true });
    const T = t + 0.9;
    const notes: [number, number, number][] = [[0, 62, 0.34], [0.38, 66, 0.34], [0.76, 69, 0.34]];
    for (const [dt, m, d] of notes) {
      brass(p, { at: T + dt, freq: midiHz(m), dur: d, amp: 0.3, atk: 0.04, rel: 0.1, bright: 1.1 });
      brass(p, { at: T + dt, freq: midiHz(m - 12), dur: d, amp: 0.15, atk: 0.05, rel: 0.1, bright: 0.7 });
    }
    const H = T + 1.2;
    for (const [m, a] of [[74, 0.34], [69, 0.24], [66, 0.2], [62, 0.2], [50, 0.2]] as const) {
      brass(p, { at: H, freq: midiHz(m), dur: 2.8, amp: a, atk: 0.07, rel: 1.2, bright: m > 60 ? 1.1 : 0.6, vibrato: 12 });
    }
    drum(p, { at: H, freq: 62, amp: 0.8, dur: 1.4, boom: 0.8 });
    p.nb({ at: H, dur: 2.4, type: 'highpass', f0: 6000, amp: 0.12 });
    p.modes({ at: H, f: midiHz(86), partials: BELL_PARTIALS.map(([r, a, d]) => [r, a, d * 0.7] as const), amp: 0.12, dest: fx });
    choirChord(H - 0.1, DM, 4.2, 'ah', 0.5, fx, 62, true);
    return 6.2;
  }

  function stingerDefeat(t: number): number {
    const p = mkPatch(fx, t);
    drum(p, { at: t, freq: 44, amp: 0.95, dur: 1.8, boom: 1 });
    p.modes({ at: t, f: 82.4, partials: BELL_PARTIALS.map(([r, a, d]) => [r, a, d * 1.8] as const), amp: 0.3, dest: fx, detuneCents: 6 });
    p.nb({ at: t, dur: 2.5, kind: 'brown', type: 'lowpass', f0: 280, amp: 0.4, atk: 0.02 });
    const line: [number, number, number][] = [[0.25, 57, 1.5], [1.65, 53, 1.5], [3.0, 50, 2.6]];
    for (const [dt, m, d] of line) {
      brass(p, { at: t + dt, freq: midiHz(m), dur: d, amp: 0.26, atk: 0.2, rel: 0.9, bright: 0.45, bend: -25, dissonant: dt > 2 });
      brass(p, { at: t + dt, freq: midiHz(m - 12), dur: d, amp: 0.18, atk: 0.25, rel: 0.9, bright: 0.35 });
    }
    choirChord(t + 0.2, Dm, 5.2, 'oo', 0.4, fx, 53, false);
    drum(p, { at: t + 3.0, freq: 48, amp: 0.55, dur: 1.6, boom: 0.8 });
    return 6.2;
  }

  // ── sequencer ─────────────────────────────────────────────────────────────
  function scheduleStep(t: number): void {
    if (mood === 'none') return;
    const m = CFG[mood];
    const chordIdx = Math.floor(bar / m.barsPer) % m.prog.length;
    const chord = m.prog[chordIdx];
    if (stepI === 0 && bar % m.barsPer === 0) startChord(t, chord, m);
    if (stemLive('harp', t)) stepHarp(t, chord, stepI + 16 * (bar % m.barsPer), m);
    if (stemLive('drums', t)) stepDrums(t, stepI, bar);
    if (stemLive('ostinato', t)) stepOstinato(t, chord, stepI, bar);
    if (stemLive('horns', t)) stepHorns(t, chord, stepI, bar);
  }

  function setMood(next: MusicMood, now: number, instant = false): void {
    if (next === mood && !instant) return;
    const prev = mood;
    mood = next;
    if (next === 'none') {
      tcNow = 0.8;
      for (const s of STEMS) {
        if (target[s] > 0) offAt[s] = now;
        target[s] = 0;
      }
      running = false;
      applyTargets(now, instant);
      return;
    }
    const m = CFG[next];
    tcNow = instant ? 0.01 : m.tc;
    for (const s of STEMS) {
      if (m.stems[s] <= 0.015 && target[s] > 0.015) offAt[s] = now;
      target[s] = m.stems[s];
    }
    bpmTarget = m.bpm * (0.94 + 0.12 * intensity);
    if (prev === 'none' || instant || !running) {
      bpm = bpmTarget;
      nextT = now + 0.08;
      stepI = 0;
      bar = 0;
    } else if (next === 'victory' || next === 'defeat') {
      bpm = bpmTarget;
    }
    running = true;
    applyTargets(now, instant);
    if (next === 'victory' || next === 'defeat') {
      const t0 = now + 0.06;
      const len = next === 'victory' ? stingerVictory(t0) : stingerDefeat(t0);
      // the quiet bed starts as the stinger fades
      nextT = t0 + len * 0.55;
      stepI = 0;
      bar = 0;
    }
  }

  function pump(until: number, now: number): void {
    if (!running || mood === 'none') return;
    if (nextT < now - 0.05) nextT = now + 0.05; // fell behind (tab hidden): resync
    let guard = 0;
    while (nextT < until && guard++ < 256) {
      scheduleStep(nextT);
      // tempo glides toward the mood's target
      bpm += (bpmTarget - bpm) * 0.05;
      nextT += stepDur();
      if (++stepI >= 16) {
        stepI = 0;
        bar++;
      }
    }
  }

  return {
    setMood,
    pump,
    setIntensity(v: number, now: number) {
      intensity = Math.max(0, Math.min(1, v));
      if (mood !== 'none') {
        bpmTarget = CFG[mood].bpm * (0.94 + 0.12 * intensity);
        applyTargets(now, false);
      }
    },
    get mood() {
      return mood;
    },
    dispose() {
      drone.stopAt(ctx.currentTime);
      master.disconnect();
    },
  };
}

interface HarpCfg {
  stride: number;
  prob: number;
  vel: number;
  lute: boolean;
  lo: number;
  hi: number;
}
const HARP: Partial<Record<MusicMood, HarpCfg>> = {
  menu: { stride: 4, prob: 0.9, vel: 0.85, lute: false, lo: 3, hi: 13 },
  explore: { stride: 2, prob: 0.5, vel: 0.8, lute: false, lo: 2, hi: 14 },
  tension: { stride: 4, prob: 0.22, vel: 0.55, lute: false, lo: 7, hi: 15 },
  combat: { stride: 2, prob: 0.3, vel: 0.75, lute: true, lo: 4, hi: 12 },
  epic: { stride: 2, prob: 0.8, vel: 0.85, lute: false, lo: 3, hi: 15 },
  victory: { stride: 2, prob: 0.6, vel: 0.85, lute: false, lo: 5, hi: 15 },
};

interface OstiPat {
  vel: number[];
  /** 0 root, 1 fifth, 2 octave, 3 b2/tritone colour */
  notes: number[];
  len: number;
}
const OSTI: Partial<Record<MusicMood, OstiPat>> = {
  combat: {
    vel: [1, 0, 0.55, 0, 0.8, 0, 0.55, 0, 1, 0, 0.55, 0, 0.8, 0, 0.6, 0.5],
    notes: [0, 0, 1, 0, 0, 0, 2, 0],
    len: 0.14,
  },
  boss: {
    vel: [1, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, 0.5, 0, 0],
    notes: [0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0],
    len: 0.2,
  },
  epic: {
    vel: [0.8, 0, 0.5, 0.5, 0.7, 0, 0.5, 0.5, 0.8, 0, 0.5, 0.5, 0.7, 0, 0.5, 0.5],
    notes: [0, 1, 2, 1, 0, 1, 2, 1],
    len: 0.2,
  },
  tension: {
    vel: [0.5, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0],
    notes: [0, 3],
    len: 0.4,
  },
};
