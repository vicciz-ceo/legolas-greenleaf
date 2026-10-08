/**
 * One-shot sound effects. Every builder takes a Patch (a scheduling scope bound to a
 * BaseAudioContext + output node + start time) and returns the sound's length in seconds.
 * Nothing is sampled: noise, oscillators, formant filters, modal resonators and Karplus-Strong.
 */
import type { SfxName } from '../types';
import {
  BELL_PARTIALS, Patch, brass, drum, expLine, formantVoice, line, lfo, perc, sweep, swellEnv,
} from './dsp';

export interface SfxDef {
  build: (p: Patch) => number;
  /** mix trim (linear) */
  gain: number;
  /** random pitch variation, fraction (0.05 = ±5%) */
  vary: number;
  /** reverb send 0..1 */
  verb: number;
  /** max simultaneous voices of this sound */
  poly: number;
  /** minimum seconds between retriggers */
  gap: number;
}

type Build = (p: Patch) => number;
const def = (build: Build, o: Partial<Omit<SfxDef, 'build'>> = {}): SfxDef => ({
  build, gain: 1, vary: 0.04, verb: 0.25, poly: 6, gap: 0.015, ...o,
});

const rr = (p: Patch, a: number, b: number): number => p.rng.range(a, b);

// ─────────────────────────────────────────────────────────────────────────────
// Weapons
// ─────────────────────────────────────────────────────────────────────────────

const bowDraw: Build = (p) => {
  const t = p.t;
  const D = 0.8;
  // stick-slip creak: resonant noise, gated irregularly, rising as the limbs load
  const n = p.noise('pink', t, t + D + 0.1);
  const f = p.bq('bandpass', 240, 11);
  expLine(f.frequency, t, [[0, p.hz(240)], [D * 0.55, p.hz(520)], [D, p.hz(840)]]);
  const gate = p.gain(0.5);
  lfo(p, gate.gain, 13, 0.5, 'triangle', t, t + D + 0.1);
  const wob = p.gain(0.3);
  const wn = p.noise('white', t, t + D + 0.1);
  const wl = p.bq('lowpass', 30, 0.5, false);
  wn.connect(wl);
  wl.connect(wob);
  wob.connect(gate.gain);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.06, 0.9], [D * 0.75, 1.3], [D, 0]]);
  n.connect(f);
  f.connect(gate);
  gate.connect(g);
  g.connect(p.out);
  // wood groan + rubbing
  p.nb({ at: t, dur: D, kind: 'pink', type: 'bandpass', f0: 260, f1: 480, q: 4, amp: 0.2, swell: true });
  p.nb({ at: t, dur: D, kind: 'pink', type: 'bandpass', f0: 1500, f1: 2600, q: 2.5, amp: 0.05, atk: 0.2 });
  // string tension
  const { osc } = p.tone({ type: 'triangle', f0: 130, f1: 290, dur: D, amp: 0.08, atk: 0.2, sweepTime: D });
  lfo(p, osc.detune, 7, 14, 'sine', t, t + D);
  // fingers on leather
  p.nb({ at: t, dur: 0.05, type: 'bandpass', f0: 1800, q: 1.2, amp: 0.12 });
  return D + 0.15;
};

const bowRelease: Build = (p) => {
  const t = p.t;
  p.pluck(148, t, 0.55, 0.85, { decay: 0.9955, bright: 0.52, pick: 0.12 });
  p.pluck(298, t, 0.25, 0.14, { decay: 0.992, bright: 0.55 });
  p.tone({ f0: 150, f1: 52, dur: 0.14, amp: 0.5, sweepTime: 0.08 });
  p.nb({ dur: 0.045, type: 'highpass', f0: 3200, amp: 0.3 });
  p.modes({ f: 520, partials: [[1, 1, 0.07], [2.2, 0.4, 0.04]], amp: 0.12 });
  // limb knock
  p.nb({ dur: 0.12, kind: 'pink', type: 'lowpass', f0: 500, amp: 0.3 });
  return 0.6;
};

const arrowWhoosh: Build = (p) => {
  const t = p.t;
  const D = 0.6;
  const n = p.noise('white', t, t + D + 0.1);
  const f = p.bq('bandpass', 1900, 2.4);
  expLine(f.frequency, t, [[0, p.hz(1500)], [0.2, p.hz(2700)], [0.28, p.hz(2100)], [D, p.hz(850)]]);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.19, 0.55], [0.3, 0.55], [D, 0]]);
  n.connect(f);
  f.connect(g);
  g.connect(p.out);
  const n2 = p.noise('white', t, t + D + 0.1);
  const f2 = p.bq('bandpass', 3200, 16);
  expLine(f2.frequency, t, [[0, p.hz(2600)], [0.2, p.hz(4200)], [0.28, p.hz(3300)], [D, p.hz(1500)]]);
  const g2 = p.gain(0);
  line(g2.gain, t, [[0, 0], [0.19, 0.18], [0.3, 0.16], [D, 0]]);
  n2.connect(f2);
  f2.connect(g2);
  g2.connect(p.out);
  return D + 0.1;
};

const arrowHitFlesh: Build = (p) => {
  p.tone({ f0: 180, f1: 55, dur: 0.14, amp: 0.5, sweepTime: 0.09, sat: 2 });
  p.nb({ dur: 0.13, kind: 'pink', type: 'lowpass', f0: 900, amp: 0.7 });
  p.nb({ dur: 0.022, type: 'bandpass', f0: 2400, q: 2, amp: 0.5 });
  p.nb({ at: p.t + 0.012, dur: 0.14, kind: 'pink', type: 'bandpass', f0: 1100, f1: 380, q: 4, amp: 0.4 });
  p.tone({ at: p.t + 0.01, type: 'triangle', f0: 240, dur: 0.22, amp: 0.07 }); // shaft thrum
  return 0.38;
};

const arrowHitWood: Build = (p) => {
  const f = rr(p, 300, 350);
  p.modes({ f, partials: [[1, 1, 0.11], [1.9, 0.55, 0.07], [3.3, 0.3, 0.045], [5.1, 0.12, 0.03]], amp: 0.65, detuneCents: 12 });
  p.nb({ dur: 0.018, type: 'bandpass', f0: 1600, q: 1.5, amp: 0.4 });
  p.tone({ f0: 220, f1: 110, dur: 0.07, amp: 0.45, sweepTime: 0.05 });
  p.tone({ at: p.t + 0.005, type: 'triangle', f0: 700, dur: 0.16, amp: 0.06 });
  return 0.34;
};

const arrowHitStone: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.01, type: 'highpass', f0: 4200, amp: 0.65 });
  for (let i = 0; i < 5; i++) {
    p.nb({ at: t + 0.004 + rr(p, 0, 0.045), dur: 0.012, type: 'bandpass', f0: rr(p, 2200, 5200), q: 3, amp: rr(p, 0.12, 0.3) });
  }
  p.modes({ f: rr(p, 1700, 2000), partials: [[1, 0.8, 0.055], [1.7, 0.5, 0.04], [2.6, 0.3, 0.03]], amp: 0.4 });
  p.tone({ f0: 320, f1: 120, dur: 0.06, amp: 0.4, sweepTime: 0.04 });
  p.nb({ dur: 0.07, kind: 'pink', type: 'lowpass', f0: 1400, amp: 0.2 });
  return 0.3;
};

const arrowHitMetal: Build = (p) => {
  p.modes({
    f: 1240,
    partials: [[0.52, 0.35, 0.55], [1, 1, 0.7], [2.76, 0.7, 0.42], [5.4, 0.45, 0.28], [8.93, 0.25, 0.16], [11.3, 0.12, 0.1]],
    amp: 0.5, detuneCents: 8,
  });
  p.nb({ dur: 0.012, type: 'highpass', f0: 5200, amp: 0.55 });
  p.nb({ dur: 0.03, type: 'bandpass', f0: 3000, q: 1, amp: 0.3 });
  p.tone({ f0: 400, f1: 200, dur: 0.05, amp: 0.25, sweepTime: 0.03 });
  return 1.0;
};

const knifeSlash: Build = (p) => {
  const t = p.t;
  const n = p.noise('white', t, t + 0.3);
  const f = p.bq('bandpass', 1800, 1.3);
  expLine(f.frequency, t, [[0, p.hz(1600)], [0.12, p.hz(5200)], [0.24, p.hz(7500)]]);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.06, 0.55], [0.14, 0.4], [0.25, 0]]);
  n.connect(f);
  f.connect(g);
  g.connect(p.out);
  p.nb({ at: t + 0.02, dur: 0.18, type: 'highpass', f0: 5500, amp: 0.1 });
  p.modes({ at: t + 0.035, f: 4300, partials: [[1, 1, 0.14], [1.5, 0.5, 0.1], [2.3, 0.3, 0.07]], amp: 0.07 });
  p.tone({ at: t + 0.02, f0: 3600, f1: 5400, dur: 0.1, amp: 0.04, type: 'triangle' });
  return 0.3;
};

const knifeHit: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.1, type: 'bandpass', f0: 3800, f1: 1500, q: 1, amp: 0.4 });
  p.tone({ f0: 240, f1: 90, dur: 0.1, amp: 0.65, sweepTime: 0.07 });
  p.nb({ at: t + 0.015, dur: 0.12, kind: 'pink', type: 'bandpass', f0: 1300, f1: 500, q: 3, amp: 0.3 });
  p.nb({ dur: 0.012, type: 'highpass', f0: 4000, amp: 0.3 });
  p.modes({ at: t + 0.005, f: 3300, partials: [[1, 1, 0.2], [1.58, 0.6, 0.14], [2.4, 0.4, 0.09]], amp: 0.15 });
  p.nb({ dur: 0.08, kind: 'pink', type: 'lowpass', f0: 450, amp: 0.4 });
  return 0.4;
};

const swordClash: Build = (p) => {
  const t = p.t;
  p.modes({
    f: 1320,
    partials: [[1, 1, 0.9], [2.32, 0.7, 0.6], [4.1, 0.55, 0.4], [6.7, 0.35, 0.25], [9.8, 0.2, 0.15], [0.51, 0.4, 0.7]],
    amp: 0.38, detuneCents: 14,
  });
  p.modes({ at: t + 0.004, f: 1710, partials: [[1, 0.9, 0.7], [2.7, 0.6, 0.45], [5.2, 0.4, 0.3], [8.3, 0.22, 0.18]], amp: 0.3, detuneCents: 14 });
  p.nb({ dur: 0.06, type: 'bandpass', f0: 3600, q: 0.8, amp: 0.55 });
  p.nb({ at: t + 0.01, dur: 0.28, type: 'highpass', f0: 3200, f1: 7500, amp: 0.15 });
  p.tone({ f0: 300, f1: 120, dur: 0.07, amp: 0.3, sweepTime: 0.05 });
  return 1.2;
};

const swordSwing: Build = (p) => {
  const t = p.t;
  const n = p.noise('pink', t, t + 0.55);
  const f = p.bq('bandpass', 400, 0.9);
  expLine(f.frequency, t, [[0, p.hz(300)], [0.18, p.hz(1500)], [0.4, p.hz(900)]]);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.14, 0.7], [0.22, 0.6], [0.42, 0]]);
  n.connect(f);
  f.connect(g);
  g.connect(p.out);
  p.nb({ at: t + 0.03, dur: 0.3, type: 'bandpass', f0: 900, f1: 3000, q: 1.3, amp: 0.2, swell: true });
  p.tone({ f0: 220, f1: 130, dur: 0.35, amp: 0.1, type: 'triangle', atk: 0.12 });
  return 0.5;
};

// ─────────────────────────────────────────────────────────────────────────────
// Movement
// ─────────────────────────────────────────────────────────────────────────────

const footstep: Build = (p) => {
  const t = p.t;
  const k = rr(p, 0.85, 1.2);
  p.tone({ f0: 115 * k, f1: 58 * k, dur: 0.11, amp: 0.55, sweepTime: 0.07, sat: 3 });
  p.nb({ dur: 0.09, kind: 'pink', type: 'bandpass', f0: 700 * k, q: 0.9, amp: 0.4 });
  p.nb({ dur: 0.14, kind: 'pink', type: 'lowpass', f0: 650 * k, f1: 220, amp: 0.75 });
  p.nb({ at: t + 0.004, dur: 0.07, type: 'bandpass', f0: 1800 * k, q: 0.8, amp: 0.2 });
  p.nb({ at: t + rr(p, 0.025, 0.05), dur: 0.05, type: 'bandpass', f0: 2600 * k, q: 1, amp: rr(p, 0.04, 0.1) });
  return 0.22;
};

const footstepStone: Build = (p) => {
  const t = p.t;
  const k = rr(p, 0.9, 1.15);
  p.nb({ dur: 0.016, type: 'bandpass', f0: 2600 * k, q: 1.5, amp: 0.5 });
  p.tone({ f0: 150 * k, f1: 80 * k, dur: 0.09, amp: 0.5, sweepTime: 0.06, sat: 2.5 });
  p.modes({ f: 640 * k, partials: [[1, 1, 0.12], [2.3, 0.4, 0.07]], amp: 0.12 });
  p.nb({ at: t + 0.006, dur: 0.03, type: 'highpass', f0: 5000, amp: 0.12 });
  p.nb({ dur: 0.08, kind: 'pink', type: 'lowpass', f0: 900, amp: 0.3 });
  return 0.25;
};

const footstepWater: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.24, type: 'bandpass', f0: 1400, f1: 3000, q: 0.7, amp: 0.4, swell: false, atk: 0.02 });
  p.nb({ dur: 0.32, kind: 'pink', type: 'lowpass', f0: 800, amp: 0.4, atk: 0.015 });
  p.tone({ f0: 105, f1: 62, dur: 0.1, amp: 0.3, sweepTime: 0.07 });
  const nb = 3 + Math.floor(rr(p, 0, 3));
  for (let i = 0; i < nb; i++) {
    const at = t + rr(p, 0.03, 0.26);
    const f = rr(p, 450, 1200);
    p.tone({ at, f0: f, f1: f * 1.9, dur: rr(p, 0.04, 0.08), amp: rr(p, 0.08, 0.14), sweepTime: 0.05 });
  }
  return 0.42;
};

const jump: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.24, type: 'bandpass', f0: 500, f1: 1700, q: 0.8, amp: 0.22, atk: 0.03 });
  p.nb({ at: t + 0.02, dur: 0.1, kind: 'pink', type: 'bandpass', f0: 2400, q: 0.7, amp: 0.07 });
  formantVoice(p, { dur: 0.2, f0: [[0, 150], [0.15, 195]], vowel: 'ah', vowel2: 'aw', amp: 0.16, breath: 0.35, atk: 0.02, rel: 0.1 });
  return 0.38;
};

const land: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 105, f1: 44, dur: 0.22, amp: 0.7, sweepTime: 0.12, sat: 3 });
  p.nb({ dur: 0.14, kind: 'pink', type: 'bandpass', f0: 600, q: 0.8, amp: 0.4 });
  p.nb({ dur: 0.22, kind: 'pink', type: 'lowpass', f0: 700, f1: 200, amp: 0.6 });
  p.nb({ at: t + 0.01, dur: 0.09, type: 'bandpass', f0: 2200, q: 0.8, amp: 0.1 });
  p.nb({ at: t, dur: 0.01, type: 'highpass', f0: 3000, amp: 0.08 });
  return 0.4;
};

const dash: Build = (p) => {
  const t = p.t;
  const n = p.noise('white', t, t + 0.5);
  const f = p.bq('bandpass', 350, 1.1);
  expLine(f.frequency, t, [[0, p.hz(350)], [0.17, p.hz(3200)], [0.42, p.hz(700)]]);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.14, 0.6], [0.2, 0.55], [0.45, 0]]);
  n.connect(f);
  f.connect(g);
  g.connect(p.out);
  p.nb({ at: t + 0.1, dur: 0.12, type: 'bandpass', f0: 2000, q: 0.7, amp: 0.1 });
  p.tone({ f0: 190, f1: 110, dur: 0.3, amp: 0.1, atk: 0.06, type: 'triangle' });
  return 0.5;
};

// ─────────────────────────────────────────────────────────────────────────────
// Player voice
// ─────────────────────────────────────────────────────────────────────────────

const hurt: Build = (p) => {
  formantVoice(p, {
    dur: 0.42, f0: [[0, 175], [0.12, 205], [0.42, 120]], vowel: 'aw', vowel2: 'uh', amp: 0.55,
    breath: 0.18, vibHz: 7, vibCents: 20, drive: 2, atk: 0.015, rel: 0.2, detune: 9,
  });
  p.nb({ dur: 0.25, type: 'bandpass', f0: 1500, q: 0.6, amp: 0.05, atk: 0.04 });
  return 0.5;
};

const playerDeath: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 1.1, f0: [[0, 215], [0.25, 240], [0.95, 92]], vowel: 'ah', vowel2: 'oo', amp: 0.5,
    breath: 0.14, vibHz: 6, vibCents: 28, drive: 1.6, detune: 8,
    env: [[0, 0], [0.04, 1], [0.7, 0.8], [1.1, 0]],
  });
  p.nb({ at: t + 0.1, dur: 0.9, type: 'bandpass', f0: 1800, f1: 600, q: 0.8, amp: 0.05, atk: 0.1 });
  p.tone({ at: t + 1.0, f0: 95, f1: 42, dur: 0.28, amp: 0.45, sweepTime: 0.14 });
  p.nb({ at: t + 1.0, dur: 0.25, kind: 'pink', type: 'lowpass', f0: 500, amp: 0.35 });
  return 1.45;
};

// ─────────────────────────────────────────────────────────────────────────────
// Creatures
// ─────────────────────────────────────────────────────────────────────────────

const orcGrunt: Build = (p) => {
  formantVoice(p, {
    dur: 0.48, f0: [[0, 112], [0.1, 128], [0.45, 78]], vowel: 'uh', vowel2: 'aw', size: 0.85, amp: 0.6,
    detune: 25, growlHz: 38, growl: 0.55, drive: 3, breath: 0.22, atk: 0.02, rel: 0.2,
  });
  p.nb({ dur: 0.3, kind: 'pink', type: 'bandpass', f0: 600, q: 0.9, amp: 0.1, atk: 0.03 });
  return 0.55;
};

const orcDie: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 1.0, f0: [[0, 150], [0.15, 172], [0.9, 52]], vowel: 'aw', vowel2: 'oo', size: 0.85, amp: 0.6,
    detune: 30, growlHz: 28, growl: 0.65, drive: 3, breath: 0.25, vibHz: 6, vibCents: 22,
    env: [[0, 0], [0.04, 1], [0.6, 0.75], [1.0, 0]],
  });
  // gurgle
  const n = p.noise('pink', t + 0.25, t + 1.0);
  const f = p.bq('bandpass', 500, 5);
  const g = p.gain(0);
  lfo(p, f.frequency, 14, 220, 'sine', t + 0.25, t + 1.0);
  line(g.gain, t, [[0.25, 0], [0.4, 0.22], [0.9, 0]]);
  n.connect(f);
  f.connect(g);
  g.connect(p.out);
  p.tone({ at: t + 0.95, f0: 85, f1: 38, dur: 0.3, amp: 0.55, sweepTime: 0.15 });
  p.nb({ at: t + 0.95, dur: 0.25, kind: 'pink', type: 'lowpass', f0: 500, amp: 0.4 });
  return 1.35;
};

const orcRoar: Build = (p) => {
  formantVoice(p, {
    dur: 1.45, f0: [[0, 92], [0.25, 142], [1.0, 122], [1.4, 68]], vowel: 'aw', vowel2: 'ah', size: 0.8, amp: 0.6,
    detune: 40, growlHz: 45, growl: 0.6, drive: 4, breath: 0.3, vibHz: 7, vibCents: 30,
    env: [[0, 0], [0.1, 1], [1.0, 0.9], [1.45, 0]],
  });
  p.nb({ dur: 1.3, kind: 'pink', type: 'bandpass', f0: 900, q: 0.7, amp: 0.1, atk: 0.1 });
  return 1.55;
};

const urukRoar: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 1.8, f0: [[0, 75], [0.3, 112], [1.2, 96], [1.75, 55]], vowel: 'aw', vowel2: 'oo', size: 0.72, amp: 0.62,
    detune: 35, growlHz: 55, growl: 0.7, drive: 5, breath: 0.35, vibHz: 6, vibCents: 26,
    env: [[0, 0], [0.12, 1], [1.3, 0.9], [1.8, 0]],
  });
  formantVoice(p, {
    at: t + 0.05, dur: 1.6, f0: [[0, 150], [0.3, 220], [1.2, 190], [1.55, 110]], vowel: 'ah', size: 0.9, amp: 0.15,
    growlHz: 40, growl: 0.5, drive: 2, breath: 0.4, env: [[0, 0], [0.1, 1], [1.2, 0.8], [1.6, 0]],
  });
  p.nb({ dur: 1.5, kind: 'pink', type: 'lowpass', f0: 700, amp: 0.15, atk: 0.1 });
  return 1.95;
};

const goblinScreech: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 0.72, f0: [[0, 690], [0.12, 1450], [0.35, 1120], [0.7, 600]], vowel: 'ee', vowel2: 'ah', size: 1.05, amp: 0.4,
    vibHz: 14, vibCents: 90, growlHz: 62, growl: 0.5, drive: 5, breath: 0.35, detune: 18,
    env: [[0, 0], [0.03, 1], [0.5, 0.85], [0.72, 0]],
  });
  p.nb({ at: t + 0.02, dur: 0.6, type: 'highpass', f0: 3200, amp: 0.07 });
  return 0.8;
};

const spiderHiss: Build = (p) => {
  const t = p.t;
  const D = 0.95;
  const n = p.noise('white', t, t + D + 0.1);
  const f = p.bq('bandpass', 5500, 0.8);
  expLine(f.frequency, t, [[0, p.hz(4200)], [0.25, p.hz(6200)], [D, p.hz(5000)]]);
  const am = p.gain(0.75);
  lfo(p, am.gain, 29, 0.25, 'square', t, t + D + 0.1);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.06, 0.55], [0.6, 0.5], [D, 0]]);
  n.connect(f);
  f.connect(am);
  am.connect(g);
  g.connect(p.out);
  p.nb({ dur: D, kind: 'pink', type: 'bandpass', f0: 1900, q: 1, amp: 0.22, atk: 0.08 });
  for (let i = 0; i < 7; i++) {
    p.nb({ at: t + rr(p, 0.05, 0.8), dur: 0.014, type: 'bandpass', f0: rr(p, 1800, 2800), q: 8, amp: rr(p, 0.2, 0.4) });
  }
  return D + 0.1;
};

const spiderDie: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 0.95, f0: [[0, 1100], [0.18, 1650], [0.9, 340]], vowel: 'ee', vowel2: 'eh', size: 1.1, amp: 0.32,
    wave: 'sawtooth', vibHz: 22, vibCents: 120, breath: 0.45, drive: 3, growlHz: 45, growl: 0.4,
    env: [[0, 0], [0.03, 1], [0.6, 0.7], [0.95, 0]],
  });
  p.nb({ dur: 0.8, type: 'bandpass', f0: 5500, f1: 3000, q: 0.8, amp: 0.2, atk: 0.04 });
  for (let i = 0; i < 12; i++) {
    p.nb({ at: t + rr(p, 0.02, 1.0), dur: 0.015, type: 'bandpass', f0: rr(p, 1600, 3200), q: 8, amp: rr(p, 0.15, 0.35) });
  }
  p.tone({ at: t + 0.95, f0: 120, f1: 50, dur: 0.18, amp: 0.4, sweepTime: 0.1 });
  p.nb({ at: t + 0.95, dur: 0.16, kind: 'pink', type: 'lowpass', f0: 700, amp: 0.3 });
  return 1.2;
};

const trollRoar: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 2.0, f0: [[0, 58], [0.3, 96], [1.3, 82], [1.95, 42]], vowel: 'aw', vowel2: 'oo', size: 0.55, amp: 0.7,
    detune: 20, growlHz: 24, growl: 0.75, drive: 6, breath: 0.3, vibHz: 5, vibCents: 22,
    env: [[0, 0], [0.15, 1], [1.5, 0.9], [2.0, 0]],
  });
  p.tone({ f0: 46, f1: 36, dur: 1.9, amp: 0.4, atk: 0.12 });
  p.nb({ dur: 1.8, kind: 'brown', type: 'lowpass', f0: 600, amp: 0.4, atk: 0.12 });
  p.nb({ at: t + 0.02, dur: 1.5, kind: 'pink', type: 'bandpass', f0: 500, q: 0.6, amp: 0.1, atk: 0.1 });
  return 2.2;
};

const trollHit: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 88, f1: 34, dur: 0.38, amp: 0.8, sweepTime: 0.2, sat: 3 });
  p.nb({ dur: 0.26, kind: 'pink', type: 'lowpass', f0: 420, amp: 0.8 });
  formantVoice(p, {
    at: t + 0.02, dur: 0.36, f0: [[0, 72], [0.3, 48]], vowel: 'uh', size: 0.55, amp: 0.45, growlHz: 30, growl: 0.6, drive: 4,
    breath: 0.2,
  });
  p.modes({ at: t + 0.005, f: 210, partials: [[1, 1, 0.14], [2.4, 0.4, 0.08], [3.9, 0.2, 0.05]], amp: 0.2 });
  p.nb({ dur: 0.02, type: 'bandpass', f0: 1600, amp: 0.3 });
  return 0.6;
};

const trollStep: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 62, f1: 27, dur: 0.55, amp: 0.6, sweepTime: 0.25, sat: 3.5 });
  p.nb({ dur: 0.3, kind: 'pink', type: 'bandpass', f0: 520, q: 0.8, amp: 0.9, atk: 0.01 });
  p.nb({ dur: 0.5, kind: 'brown', type: 'lowpass', f0: 320, f1: 110, amp: 0.8 });
  p.nb({ at: t + 0.015, dur: 0.14, type: 'bandpass', f0: 900, q: 1, amp: 0.14 });
  p.nb({ at: t, dur: 0.015, type: 'lowpass', f0: 3000, amp: 0.25 });
  return 0.7;
};

const oliphauntTrumpet: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 2.1, f0: [[0, 250], [0.16, 520], [0.38, 650], [1.25, 610], [1.5, 720], [2.0, 320]],
    vowel: 'ah', vowel2: 'aw', size: 1.25, amp: 0.45, detune: 14, vibHz: 9, vibCents: 42, growlHz: 17, growl: 0.28,
    drive: 3, breath: 0.12,
    env: [[0, 0], [0.06, 1], [1.5, 0.85], [2.1, 0]],
  });
  formantVoice(p, {
    at: t + 0.02, dur: 2.0, f0: [[0, 505], [0.16, 1040], [0.38, 1300], [1.25, 1220], [1.5, 1440], [1.95, 640]],
    wave: 'square', vowel: 'eh', size: 1.4, amp: 0.1, vibHz: 9, vibCents: 42,
    env: [[0, 0], [0.06, 1], [1.5, 0.8], [2.0, 0]],
  });
  p.tone({ f0: 85, f1: 62, dur: 2.0, amp: 0.2, atk: 0.1 });
  p.nb({ dur: 0.22, type: 'bandpass', f0: 1800, q: 0.8, amp: 0.2 });
  return 2.3;
};

const oliphauntStep: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 40, f1: 22, dur: 0.85, amp: 0.6, sweepTime: 0.4, atk: 0.006, sat: 3.5 });
  p.nb({ dur: 0.5, kind: 'pink', type: 'bandpass', f0: 380, q: 0.8, amp: 1.0, atk: 0.01 });
  p.nb({ dur: 0.8, kind: 'brown', type: 'lowpass', f0: 160, amp: 0.5, atk: 0.01 });
  p.nb({ at: t + 0.01, dur: 0.22, kind: 'pink', type: 'lowpass', f0: 520, amp: 0.3 });
  p.nb({ at: t + 0.03, dur: 0.3, type: 'bandpass', f0: 1100, q: 0.9, amp: 0.05 });
  return 1.0;
};

const batScreech: Build = (p) => {
  const t = p.t;
  const chirps = [0, 0.16, 0.31];
  chirps.forEach((c, i) => {
    const at = t + c + rr(p, 0, 0.02);
    const d = 0.12 + i * 0.02;
    const car = p.osc('sine', 5400 - i * 400, at, at + d + 0.05);
    sweep(car.frequency, at, p.hz(5600 - i * 300), p.hz(3000 + i * 200), d, 'exp');
    const mod = p.osc('sine', 1500, at, at + d + 0.05);
    const mg = p.gain(1300);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = p.gain(0);
    perc(g.gain, at, 0.008, d, 0.3, 'exp');
    car.connect(g);
    g.connect(p.out);
    p.nb({ at, dur: d, type: 'bandpass', f0: 4800, f1: 3200, q: 4, amp: 0.15 });
  });
  formantVoice(p, {
    at: t, dur: 0.45, f0: [[0, 2300], [0.12, 3100], [0.45, 1700]], vowel: 'ee', size: 1.2, amp: 0.1, breath: 0.4,
    growlHz: 60, growl: 0.5,
  });
  return 0.6;
};

const wargHowl: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 2.7, f0: [[0, 190], [0.5, 330], [1.5, 385], [2.3, 250], [2.7, 195]], vowel: 'uh', vowel2: 'oo', size: 0.95, amp: 0.42,
    wave: 'sawtooth', detune: 12, vibHz: 5.5, vibCents: 38, growlHz: 30, growl: 0.3, drive: 2, breath: 0.16,
    env: [[0, 0], [0.25, 0.8], [1.2, 1], [2.1, 0.75], [2.7, 0]],
  });
  formantVoice(p, {
    at: t, dur: 0.9, f0: [[0, 68], [0.8, 82]], vowel: 'uh', size: 0.7, amp: 0.3, growlHz: 40, growl: 0.8, drive: 4, breath: 0.3,
  });
  return 2.9;
};

const horseNeigh: Build = (p) => {
  const t = p.t;
  formantVoice(p, {
    dur: 1.55, f0: [[0, 520], [0.12, 880], [0.35, 1180], [0.5, 1010], [0.65, 1120], [0.95, 640], [1.5, 320]],
    vowel: 'ee', vowel2: 'eh', size: 1.05, amp: 0.45, detune: 10, vibHz: 12, vibCents: 70, growlHz: 24, growl: 0.4,
    drive: 2, breath: 0.28,
    env: [[0, 0], [0.04, 1], [0.8, 0.8], [1.5, 0.15], [1.55, 0]],
  });
  p.nb({ at: t + 1.15, dur: 0.3, type: 'bandpass', f0: 1200, f1: 700, q: 0.7, amp: 0.15, atk: 0.04 });
  p.nb({ at: t + 1.45, dur: 0.25, type: 'bandpass', f0: 900, f1: 500, q: 0.8, amp: 0.1, atk: 0.04 });
  return 1.8;
};

// ─────────────────────────────────────────────────────────────────────────────
// Environment / big events
// ─────────────────────────────────────────────────────────────────────────────

const explosion: Build = (p) => {
  const t = p.t;
  const bus = p.gain(0.8);
  const sh = p.shaper(1.8);
  bus.connect(sh);
  sh.connect(p.out);
  p.nb({ dur: 0.07, type: 'highpass', f0: 1500, amp: 0.8, dest: bus });
  p.tone({ f0: 88, f1: 28, dur: 1.7, amp: 0.8, sweepTime: 0.6, atk: 0.006, dest: bus, sat: 2 });
  // body: noise through a closing lowpass
  const n = p.noise('pink', t, t + 2.4);
  const f = p.bq('lowpass', 7000, 0.7);
  expLine(f.frequency, t, [[0, p.hz(8000)], [0.3, p.hz(1800)], [2.0, p.hz(130)]]);
  const g = p.gain(0);
  perc(g.gain, t, 0.004, 2.0, 1.1, 'exp');
  n.connect(f);
  f.connect(g);
  g.connect(bus);
  p.nb({ dur: 2.8, kind: 'brown', type: 'lowpass', f0: 220, amp: 0.9, atk: 0.04, dest: bus });
  // debris rattle
  for (let i = 0; i < 26; i++) {
    const at = t + 0.12 + Math.pow(rr(p, 0, 1), 1.6) * 2.1;
    p.nb({ at, dur: rr(p, 0.01, 0.03), type: 'bandpass', f0: rr(p, 900, 5000), q: 2, amp: rr(p, 0.08, 0.25) * (1 - (at - t) / 2.6), dest: bus });
  }
  return 3.1;
};

const stoneCrumble: Build = (p) => {
  const t = p.t;
  const D = 2.0;
  p.nb({ dur: 1.7, kind: 'brown', type: 'lowpass', f0: 380, amp: 0.85, atk: 0.12 });
  p.nb({ dur: 1.4, kind: 'pink', type: 'bandpass', f0: 750, f1: 380, q: 2, amp: 0.3, swell: false, atk: 0.2 });
  p.nb({ dur: 0.05, type: 'bandpass', f0: 1500, q: 1, amp: 0.4 });
  for (let i = 0; i < 34; i++) {
    const at = t + 0.03 + Math.pow(rr(p, 0, 1), 1.5) * 1.8;
    const k = 1 - (at - t) / 2.2;
    p.modes({ at, f: rr(p, 140, 620), partials: [[1, 1, 0.06], [2.3, 0.5, 0.035]], amp: rr(p, 0.06, 0.18) * k });
    p.nb({ at, dur: 0.012, type: 'bandpass', f0: rr(p, 1200, 3600), q: 2, amp: rr(p, 0.08, 0.25) * k });
  }
  return D + 0.3;
};

const splash: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.55, type: 'bandpass', f0: 3200, f1: 900, q: 0.7, amp: 0.55, atk: 0.012 });
  p.tone({ f0: 190, f1: 70, dur: 0.28, amp: 0.45, sweepTime: 0.15 });
  p.nb({ dur: 0.45, kind: 'pink', type: 'lowpass', f0: 950, amp: 0.45, atk: 0.01 });
  p.nb({ at: t + 0.03, dur: 0.5, type: 'highpass', f0: 6000, amp: 0.1, atk: 0.03 });
  for (let i = 0; i < 6; i++) {
    const at = t + rr(p, 0.06, 0.55);
    const f = rr(p, 500, 1500);
    p.tone({ at, f0: f, f1: f * 1.8, dur: rr(p, 0.04, 0.08), amp: rr(p, 0.08, 0.15), sweepTime: 0.05 });
  }
  return 0.9;
};

/** rolling thunder; exported so the storm loop can reuse it */
export function thunder(p: Patch, o: { close?: number; dur?: number } = {}): number {
  const t = p.t;
  const close = o.close ?? 0.7;
  const D = o.dur ?? 5.4;
  // the crack (loud when close)
  p.nb({ dur: 0.1, type: 'highpass', f0: 1800, amp: 0.55 * close, atk: 0.002 });
  p.nb({ at: t + 0.01, dur: 0.35, type: 'bandpass', f0: 1000, f1: 400, q: 0.7, amp: 0.5 * close, atk: 0.003 });
  p.nb({ at: t + 0.02, dur: 0.9, kind: 'pink', type: 'lowpass', f0: 1400, f1: 200, amp: 0.4 * close, atk: 0.005 });
  // rumble: overlapping swells of brown noise
  const swells = 6;
  for (let i = 0; i < swells; i++) {
    const at = t + 0.08 + i * rr(p, 0.35, 0.65) * (0.7 + (1 - close));
    const atk = rr(p, 0.12, 0.4);
    const dec = rr(p, 1.1, 2.6);
    const amp = (1 - i * 0.1) * rr(p, 0.5, 0.9);
    p.nb({ at, dur: atk + dec, kind: 'brown', type: 'lowpass', f0: rr(p, 110, 230), q: 0.9, amp, atk });
  }
  p.nb({ dur: D, kind: 'brown', type: 'lowpass', f0: 320, f1: 55, amp: 0.8, atk: 0.12 });
  p.tone({ f0: 52, f1: 33, dur: D * 0.7, amp: 0.38, atk: 0.2 });
  return D + 0.4;
}

const thunderSfx: Build = (p) => thunder(p);

const hornRohan: Build = (p) => {
  const t = p.t;
  const bus = p.gain(1);
  bus.connect(p.out);
  const echo = p.delay(0.36);
  echo.delayTime.value = 0.36;
  const lp = p.bq('lowpass', 2400, 0.5, false);
  const fb = p.gain(0.38);
  const ret = p.gain(0.4);
  bus.connect(echo);
  echo.connect(lp);
  lp.connect(fb);
  fb.connect(echo);
  lp.connect(ret);
  ret.connect(p.out);
  brass(p, { at: t, freq: 146.8, dur: 0.62, amp: 0.42, atk: 0.07, rel: 0.12, scoop: 2, dest: bus });
  brass(p, { at: t + 0.55, freq: 220, dur: 0.7, amp: 0.45, atk: 0.06, rel: 0.12, dest: bus });
  brass(p, { at: t + 1.2, freq: 293.7, dur: 1.9, amp: 0.5, atk: 0.1, rel: 0.55, vibrato: 12, dest: bus });
  brass(p, { at: t + 1.2, freq: 146.8, dur: 1.9, amp: 0.2, atk: 0.12, rel: 0.55, vibrato: 10, bright: 0.6, dest: bus });
  return 4.4;
};

const hornOrc: Build = (p) => {
  const t = p.t;
  const D = 2.3;
  const bus = p.gain(1);
  const sh = p.shaper(2.2);
  bus.connect(sh);
  sh.connect(p.out);
  brass(p, { at: t, freq: 73.4, dur: D, amp: 0.45, atk: 0.28, rel: 0.5, bright: 0.45, bend: -45, dissonant: true, dest: bus });
  brass(p, { at: t + 0.04, freq: 103.8, dur: D, amp: 0.38, atk: 0.3, rel: 0.5, bright: 0.45, bend: -60, dissonant: true, dest: bus });
  brass(p, { at: t + 0.1, freq: 77.8, dur: D * 0.9, amp: 0.25, atk: 0.3, rel: 0.5, bright: 0.4, bend: -30, dest: bus });
  p.tone({ f0: 36.7, dur: D, amp: 0.3, atk: 0.2, curve: 'lin', dest: bus });
  p.nb({ dur: D, kind: 'pink', type: 'bandpass', f0: 380, q: 1, amp: 0.14, atk: 0.3, dest: bus });
  return D + 0.7;
};

const drums: Build = (p) => {
  const t = p.t;
  const hits: [number, number, number, number][] = [
    [0, 62, 1.0, 0.6], [0.5, 62, 0.85, 0.5], [1.0, 82, 0.6, 0], [1.25, 82, 0.5, 0], [1.5, 62, 1.0, 0.6],
    [2.0, 62, 0.85, 0.5], [2.25, 98, 0.5, 0], [2.5, 82, 0.6, 0], [3.0, 62, 1.0, 0.7],
  ];
  for (const [dt, f, a, b] of hits) {
    drum(p, { at: t + dt, freq: f * rr(p, 0.98, 1.02), amp: a * 0.8, dur: 0.7, boom: b, skin: 0.6 });
  }
  return 4.2;
};

const shieldSlide: Build = (p) => {
  const t = p.t;
  const D = 1.6;
  // grit: band-limited noise gated by low-passed noise (random scrape stick-slip)
  const n = p.noise('white', t, t + D + 0.1);
  const f = p.bq('bandpass', 950, 1.5);
  const am = p.gain(0.25);
  const mn = p.noise('white', t, t + D + 0.1);
  const ml = p.bq('lowpass', 70, 0.7, false);
  const mg = p.gain(1.6);
  mn.connect(ml);
  ml.connect(mg);
  mg.connect(am.gain);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.12, 0.9], [D - 0.25, 0.9], [D, 0]]);
  const wf = p.gain(1);
  lfo(p, f.frequency, 3.1, 220, 'sine', t, t + D + 0.1);
  n.connect(f);
  f.connect(am);
  am.connect(wf);
  wf.connect(g);
  g.connect(p.out);
  // metallic scrape
  const n2 = p.noise('white', t, t + D + 0.1);
  const hp = p.bq('bandpass', 3800, 2.5);
  const am2 = p.gain(0.4);
  lfo(p, am2.gain, 23, 0.3, 'triangle', t, t + D + 0.1);
  const g2 = p.gain(0);
  line(g2.gain, t, [[0, 0], [0.15, 0.22], [D - 0.25, 0.2], [D, 0]]);
  n2.connect(hp);
  hp.connect(am2);
  am2.connect(g2);
  g2.connect(p.out);
  // rumble of the board on stone
  p.nb({ dur: D, kind: 'brown', type: 'lowpass', f0: 170, amp: 0.55, atk: 0.12 });
  return D + 0.15;
};

const killCount: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 2100, f1: 1500, dur: 0.06, amp: 0.4, sweepTime: 0.03 });
  p.modes({ f: 1250, partials: [[1, 1, 0.11], [2.76, 0.4, 0.05]], amp: 0.28 });
  p.nb({ dur: 0.01, type: 'bandpass', f0: 4000, q: 1, amp: 0.2 });
  p.tone({ at: t, f0: 300, f1: 210, dur: 0.05, amp: 0.15, sweepTime: 0.03 });
  return 0.2;
};

const checkpoint: Build = (p) => {
  const t = p.t;
  const s = BELL_PARTIALS.map(([r, a, d]) => [r, a, d * 0.6] as const);
  p.modes({ at: t, f: 587.3, partials: s, amp: 0.3, detuneCents: 4 });
  p.modes({ at: t + 0.15, f: 880, partials: s, amp: 0.3, detuneCents: 4 });
  const { osc } = p.tone({ at: t, type: 'triangle', f0: 293.7, dur: 1.9, amp: 0.08, atk: 0.4 });
  lfo(p, osc.detune, 5, 10, 'sine', t, t + 2);
  p.tone({ at: t + 0.15, type: 'triangle', f0: 440, dur: 1.8, amp: 0.07, atk: 0.4 });
  p.nb({ at: t, dur: 0.02, type: 'highpass', f0: 5000, amp: 0.1 });
  return 2.1;
};

const focusIn: Build = (p) => {
  const t = p.t;
  p.tone({ f0: 230, f1: 38, dur: 0.95, amp: 0.55, sweepTime: 0.8, atk: 0.01 });
  p.nb({ dur: 0.6, kind: 'white', type: 'bandpass', f0: 350, f1: 5200, q: 1.1, amp: 0.4, swell: true });
  p.tone({ at: t + 0.6, f0: 72, f1: 40, dur: 0.25, amp: 0.7, sweepTime: 0.1 });
  p.tone({ at: t + 0.84, f0: 65, f1: 38, dur: 0.22, amp: 0.45, sweepTime: 0.1 });
  const { osc } = p.tone({ type: 'sine', f0: 1900, f1: 800, dur: 0.9, amp: 0.05, atk: 0.2, sweepTime: 0.8 });
  lfo(p, osc.detune, 6, 25, 'sine', t, t + 1);
  p.nb({ at: t + 0.1, dur: 0.8, kind: 'brown', type: 'lowpass', f0: 420, f1: 90, amp: 0.4, atk: 0.1 });
  return 1.1;
};

const focusOut: Build = (p) => {
  const t = p.t;
  p.nb({ dur: 0.55, type: 'bandpass', f0: 300, f1: 4800, q: 1, amp: 0.45, atk: 0.06 });
  p.tone({ f0: 80, f1: 360, dur: 0.38, amp: 0.1, sweepTime: 0.3, atk: 0.02 });
  p.nb({ dur: 0.04, type: 'highpass', f0: 5000, amp: 0.3 });
  p.nb({ at: t + 0.08, dur: 0.4, kind: 'pink', type: 'bandpass', f0: 1000, f1: 2800, q: 0.9, amp: 0.2, atk: 0.1 });
  return 0.7;
};

const focusMark: Build = (p) => {
  const t = p.t;
  const { osc } = p.tone({ f0: 1250, dur: 0.2, amp: 0.3, atk: 0.003 });
  osc.frequency.setValueAtTime(p.hz(1250), t);
  osc.frequency.exponentialRampToValueAtTime(p.hz(1330), t + 0.02);
  p.modes({ f: 2650, partials: [[1, 0.5, 0.14]], amp: 0.3 });
  p.nb({ dur: 0.01, type: 'bandpass', f0: 5000, q: 1, amp: 0.15 });
  return 0.28;
};

const focusFire: Build = (p) => {
  const t = p.t;
  p.pluck(300, t, 0.5, 0.45, { decay: 0.998, bright: 0.7 });
  p.nb({ dur: 0.32, type: 'bandpass', f0: 700, f1: 4200, q: 1.1, amp: 0.4, atk: 0.03 });
  p.tone({ f0: 1800, f1: 2500, dur: 0.12, amp: 0.1, sweepTime: 0.08 });
  p.tone({ f0: 160, f1: 70, dur: 0.1, amp: 0.4, sweepTime: 0.06 });
  return 0.55;
};

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

const uiClick: Build = (p) => {
  p.tone({ type: 'triangle', f0: 1150, f1: 720, dur: 0.06, amp: 0.4, sweepTime: 0.04 });
  p.nb({ dur: 0.01, type: 'bandpass', f0: 3200, q: 1, amp: 0.15 });
  p.tone({ f0: 260, f1: 150, dur: 0.05, amp: 0.2, sweepTime: 0.03 });
  return 0.12;
};

const uiHover: Build = (p) => {
  p.tone({ f0: 1500, dur: 0.045, amp: 0.2, atk: 0.006 });
  p.nb({ dur: 0.008, type: 'bandpass', f0: 4000, q: 1, amp: 0.05 });
  return 0.09;
};

const uiConfirm: Build = (p) => {
  const t = p.t;
  const part = [[1, 1, 0.38], [2, 0.35, 0.25], [3, 0.15, 0.15]] as const;
  p.modes({ at: t, f: 587.3, partials: part, amp: 0.38 });
  p.modes({ at: t + 0.085, f: 880, partials: part, amp: 0.4 });
  p.nb({ dur: 0.01, type: 'bandpass', f0: 4500, q: 1, amp: 0.08 });
  return 0.65;
};

const uiBack: Build = (p) => {
  const t = p.t;
  const part = [[1, 1, 0.2], [2, 0.3, 0.12]] as const;
  p.modes({ at: t, f: 523.3, partials: part, amp: 0.35 });
  p.modes({ at: t + 0.075, f: 392, partials: part, amp: 0.35 });
  return 0.4;
};

const levelComplete: Build = (p) => {
  const t = p.t;
  const bus = p.gain(1);
  bus.connect(p.out);
  const notes: [number, number, number][] = [[0, 293.7, 0.3], [0.28, 370, 0.3], [0.56, 440, 0.3]];
  for (const [dt, f, d] of notes) brass(p, { at: t + dt, freq: f, dur: d, amp: 0.34, atk: 0.04, rel: 0.1, dest: bus });
  brass(p, { at: t + 0.88, freq: 587.3, dur: 1.9, amp: 0.4, atk: 0.07, rel: 0.7, vibrato: 12, dest: bus });
  brass(p, { at: t + 0.88, freq: 293.7, dur: 1.9, amp: 0.22, atk: 0.1, rel: 0.7, bright: 0.6, dest: bus });
  [293.7, 370, 440].forEach((f, i) =>
    formantVoice(p, {
      at: t + 0.85, dur: 2.3, f0: [[0, f * 2], [2.3, f * 2]], vowel: 'ah', amp: 0.08, vibHz: 5.5, vibCents: 12, breath: 0.1,
      env: [[0, 0], [0.7, 1], [1.7, 0.8], [2.3, 0], ], pan: (i - 1) * 0.4,
    }),
  );
  drum(p, { at: t, freq: 74, amp: 0.55, dur: 0.6, boom: 0.5 });
  drum(p, { at: t + 0.86, freq: 66, amp: 0.7, dur: 1.0, boom: 0.7 });
  p.modes({ at: t + 0.88, f: 1175, partials: BELL_PARTIALS.map(([r, a, d]) => [r, a, d * 0.5] as const), amp: 0.16 });
  p.nb({ at: t + 0.86, dur: 1.4, type: 'highpass', f0: 5000, amp: 0.05, atk: 0.2 });
  return 3.2;
};

const reward: Build = (p) => {
  const t = p.t;
  const f = [587.3, 698.5, 880, 1174.7, 1760];
  f.forEach((hz, i) => p.pluck(hz, t + i * 0.075, 0.9, 0.34, { decay: 0.9985, bright: 0.85, pick: 0.1 }));
  p.modes({ at: t + 0.3, f: 1760, partials: [[1, 1, 0.9], [2.0, 0.3, 0.6], [3.0, 0.15, 0.4]], amp: 0.14 });
  const { osc } = p.tone({ at: t + 0.28, f0: 2637, dur: 0.9, amp: 0.045, atk: 0.1 });
  lfo(p, osc.detune, 7, 20, 'sine', t, t + 1.5);
  return 1.5;
};

const webTear: Build = (p) => {
  const t = p.t;
  const D = 0.6;
  const n = p.noise('white', t, t + D + 0.1);
  const hp = p.bq('highpass', 2400, 0.7);
  const am = p.gain(0.25);
  const mn = p.noise('white', t, t + D + 0.1);
  const ml = p.bq('lowpass', 90, 0.7, false);
  const mg = p.gain(1.8);
  mn.connect(ml);
  ml.connect(mg);
  mg.connect(am.gain);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.03, 0.6], [0.35, 0.5], [D, 0]]);
  n.connect(hp);
  hp.connect(am);
  am.connect(g);
  g.connect(p.out);
  for (let i = 0; i < 8; i++) {
    p.nb({ at: t + rr(p, 0, 0.45), dur: 0.01, type: 'bandpass', f0: rr(p, 2800, 4800), q: 6, amp: rr(p, 0.15, 0.35) });
  }
  p.nb({ dur: 0.09, kind: 'pink', type: 'lowpass', f0: 650, amp: 0.28 });
  p.nb({ at: t + 0.05, dur: 0.4, kind: 'pink', type: 'bandpass', f0: 1400, f1: 700, q: 1, amp: 0.1 });
  return D + 0.1;
};

const barrelBump: Build = (p) => {
  const t = p.t;
  p.modes({
    f: 165, partials: [[1, 1, 0.22], [1.5, 0.5, 0.16], [2.3, 0.35, 0.11], [3.7, 0.15, 0.07]], amp: 0.7, detuneCents: 10,
  });
  p.tone({ f0: 135, f1: 68, dur: 0.12, amp: 0.55, sweepTime: 0.08, sat: 2 });
  p.nb({ dur: 0.025, type: 'bandpass', f0: 1000, q: 2, amp: 0.3 });
  p.nb({ at: t + 0.05, dur: 0.22, kind: 'pink', type: 'bandpass', f0: 500, f1: 900, q: 1.2, amp: 0.12, atk: 0.03 });
  return 0.6;
};

const chainRattle: Build = (p) => {
  const t = p.t;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(i / n, 0.9) * 0.75 + rr(p, 0, 0.03);
    const k = 1 - (at - t) * 0.7;
    p.modes({
      at, f: rr(p, 2200, 4200), partials: [[1, 1, 0.07], [2.1, 0.5, 0.05], [3.4, 0.25, 0.035]], amp: 0.16 * k, pan: rr(p, -0.2, 0.2),
    });
    p.modes({ at, f: rr(p, 420, 700), partials: [[1, 1, 0.05], [2.7, 0.3, 0.03]], amp: 0.09 * k });
  }
  const nz = p.noise('white', t, t + 0.95);
  const bp = p.bq('bandpass', 3200, 1);
  const g = p.gain(0);
  line(g.gain, t, [[0, 0], [0.05, 0.05], [0.7, 0.04], [0.95, 0]]);
  lfo(p, g.gain, 17, 0.025, 'triangle', t, t + 1);
  nz.connect(bp);
  bp.connect(g);
  g.connect(p.out);
  return 1.1;
};

const bell: Build = (p) => {
  const t = p.t;
  const s = BELL_PARTIALS.map(([r, a, d]) => [r, a, d * 1.35] as const);
  p.modes({ at: t, f: 220, partials: s, amp: 0.5, detuneCents: 5 });
  p.nb({ dur: 0.025, type: 'bandpass', f0: 2500, q: 2, amp: 0.2 });
  p.modes({ at: t, f: 1400, partials: [[1, 0.6, 0.08]], amp: 0.1 });
  p.tone({ f0: 110, dur: 3.5, amp: 0.1, atk: 0.01 });
  return 5.2;
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry. Record<SfxName, …> makes TypeScript enforce that every name is synthesised.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<SfxName, SfxDef> = {
  bow_draw: def(bowDraw, { vary: 0.03, verb: 0.15, poly: 3, gain: 1 }),
  bow_release: def(bowRelease, { vary: 0.04, verb: 0.3 }),
  arrow_whoosh: def(arrowWhoosh, { vary: 0.08, verb: 0.2, gap: 0.05 }),
  arrow_hit_flesh: def(arrowHitFlesh, { vary: 0.08, verb: 0.15 }),
  arrow_hit_wood: def(arrowHitWood, { vary: 0.07, verb: 0.2 }),
  arrow_hit_stone: def(arrowHitStone, { vary: 0.06, verb: 0.3 }),
  arrow_hit_metal: def(arrowHitMetal, { vary: 0.05, verb: 0.3 }),
  knife_slash: def(knifeSlash, { vary: 0.06, verb: 0.15 }),
  knife_hit: def(knifeHit, { vary: 0.05, verb: 0.15 }),
  sword_clash: def(swordClash, { vary: 0.05, verb: 0.3 }),
  sword_swing: def(swordSwing, { vary: 0.07, verb: 0.15 }),
  footstep: def(footstep, { vary: 0.08, verb: 0.08, gap: 0.04, poly: 8 }),
  footstep_stone: def(footstepStone, { vary: 0.08, verb: 0.35, gap: 0.04, poly: 8 }),
  footstep_water: def(footstepWater, { vary: 0.08, verb: 0.2, gap: 0.04, poly: 6 }),
  jump: def(jump, { vary: 0.05, verb: 0.1, poly: 3 }),
  land: def(land, { vary: 0.06, verb: 0.15, poly: 3 }),
  dash: def(dash, { vary: 0.05, verb: 0.15, poly: 3 }),
  hurt: def(hurt, { vary: 0.05, verb: 0.15, poly: 2 }),
  player_death: def(playerDeath, { vary: 0, verb: 0.3, poly: 1 }),
  orc_grunt: def(orcGrunt, { vary: 0.1, verb: 0.15, poly: 5, gap: 0.05 }),
  orc_die: def(orcDie, { vary: 0.1, verb: 0.2, poly: 4 }),
  orc_roar: def(orcRoar, { vary: 0.08, verb: 0.25, poly: 3 }),
  uruk_roar: def(urukRoar, { vary: 0.07, verb: 0.3, poly: 3 }),
  goblin_screech: def(goblinScreech, { vary: 0.12, verb: 0.25, poly: 4 }),
  spider_hiss: def(spiderHiss, { vary: 0.08, verb: 0.2, poly: 4 }),
  spider_die: def(spiderDie, { vary: 0.08, verb: 0.25, poly: 3 }),
  troll_roar: def(trollRoar, { vary: 0.05, verb: 0.35, poly: 2 }),
  troll_hit: def(trollHit, { vary: 0.05, verb: 0.3, poly: 3 }),
  troll_step: def(trollStep, { vary: 0.05, verb: 0.3, poly: 3 }),
  oliphaunt_trumpet: def(oliphauntTrumpet, { vary: 0.04, verb: 0.4, poly: 2 }),
  oliphaunt_step: def(oliphauntStep, { vary: 0.04, verb: 0.35, poly: 3 }),
  bat_screech: def(batScreech, { vary: 0.1, verb: 0.3, poly: 4 }),
  warg_howl: def(wargHowl, { vary: 0.07, verb: 0.45, poly: 2 }),
  horse_neigh: def(horseNeigh, { vary: 0.06, verb: 0.3, poly: 2 }),
  explosion: def(explosion, { vary: 0.05, verb: 0.4, poly: 3 }),
  stone_crumble: def(stoneCrumble, { vary: 0.05, verb: 0.35, poly: 3 }),
  splash: def(splash, { vary: 0.07, verb: 0.2, poly: 4 }),
  thunder: def(thunderSfx, { vary: 0.06, verb: 0.55, poly: 2 }),
  horn_rohan: def(hornRohan, { vary: 0, verb: 0.5, poly: 1 }),
  horn_orc: def(hornOrc, { vary: 0.02, verb: 0.45, poly: 1 }),
  drums: def(drums, { vary: 0, verb: 0.5, poly: 1 }),
  shield_slide: def(shieldSlide, { vary: 0.03, verb: 0.1, poly: 2, gap: 0.4 }),
  kill_count: def(killCount, { vary: 0, verb: 0.1, poly: 4, gap: 0.03 }),
  checkpoint: def(checkpoint, { vary: 0, verb: 0.4, poly: 1 }),
  focus_in: def(focusIn, { vary: 0, verb: 0.3, poly: 1 }),
  focus_out: def(focusOut, { vary: 0, verb: 0.3, poly: 1 }),
  focus_mark: def(focusMark, { vary: 0, verb: 0.1, poly: 6, gap: 0.03 }),
  focus_fire: def(focusFire, { vary: 0.02, verb: 0.2, poly: 8, gap: 0.03 }),
  ui_click: def(uiClick, { vary: 0, verb: 0.05, poly: 3 }),
  ui_hover: def(uiHover, { vary: 0, verb: 0.03, poly: 2, gap: 0.04 }),
  ui_confirm: def(uiConfirm, { vary: 0, verb: 0.15, poly: 2 }),
  ui_back: def(uiBack, { vary: 0, verb: 0.15, poly: 2 }),
  level_complete: def(levelComplete, { vary: 0, verb: 0.5, poly: 1 }),
  reward: def(reward, { vary: 0, verb: 0.35, poly: 2 }),
  web_tear: def(webTear, { vary: 0.07, verb: 0.15, poly: 3 }),
  barrel_bump: def(barrelBump, { vary: 0.08, verb: 0.25, poly: 4 }),
  chain_rattle: def(chainRattle, { vary: 0.05, verb: 0.2, poly: 3 }),
  bell: def(bell, { vary: 0, verb: 0.55, poly: 2 }),
};

/**
 * Per-sound level trim in dB so every sound peaks at a sensible level at volume 1
 * (generated from the lab's dry peak measurements; transients ~-5, sustained/big sounds lower).
 */
export const LEVEL_DB: Partial<Record<SfxName, number>> = {
  bow_draw: 7.4,
  bow_release: -6.0,
  arrow_whoosh: -0.4,
  arrow_hit_flesh: -1.3,
  arrow_hit_wood: -6.4,
  arrow_hit_stone: -9.0,
  arrow_hit_metal: -9.2,
  knife_slash: -1.3,
  knife_hit: -6.9,
  sword_clash: -8.5,
  sword_swing: 3.1,
  footstep: -9.7,
  footstep_stone: -7.3,
  footstep_water: -1.1,
  jump: 7.8,
  land: -7.2,
  dash: -1.4,
  hurt: -2.3,
  player_death: 0.6,
  orc_grunt: -3.5,
  orc_die: -2.7,
  orc_roar: -3.0,
  uruk_roar: -4.3,
  goblin_screech: -1.8,
  spider_hiss: -5.4,
  spider_die: -0.5,
  troll_roar: -7.0,
  troll_hit: -5.4,
  troll_step: -3.7,
  oliphaunt_trumpet: -3.1,
  oliphaunt_step: -1.6,
  bat_screech: -2.6,
  warg_howl: -2.6,
  horse_neigh: 0.9,
  explosion: -3.8,
  stone_crumble: 0.0,
  splash: -2.6,
  thunder: 0.3,
  horn_rohan: -6.1,
  horn_orc: -9.0,
  drums: -4.3,
  shield_slide: 2.4,
  kill_count: -7.3,
  checkpoint: -8.7,
  focus_in: -2.7,
  focus_out: 1.3,
  focus_mark: -3.7,
  focus_fire: -1.7,
  ui_click: -5.9,
  ui_hover: -2.8,
  ui_confirm: -3.5,
  ui_back: -1.9,
  level_complete: -8.3,
  reward: -0.8,
  web_tear: -0.9,
  barrel_bump: -6.2,
  chain_rattle: 3.9,
  bell: -9.1,
};

export const SFX: Record<SfxName, SfxDef> = Object.fromEntries(
  (Object.entries(RAW) as [SfxName, SfxDef][]).map(([k, v]) => [k, { ...v, gain: v.gain * Math.pow(10, (LEVEL_DB[k] ?? 0) / 20) }]),
) as Record<SfxName, SfxDef>;
