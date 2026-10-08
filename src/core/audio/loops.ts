/**
 * Ambience loops. Each loop is a continuous graph of filtered noise + LFOs/wanderers, plus an
 * event scheduler for discrete sounds (birds, drips, crackles, clashes). Nothing is a sample.
 * The same builders run in realtime (events pumped by a timer) and offline (pumped once).
 */
import type { LoopName } from '../types';
import { Rng } from '../rng';
import { BELL_PARTIALS, Patch, brass, drum, expLine, formantVoice, line, lfo, perc, sweep, wander, type NoiseKind } from './dsp';
import { thunder } from './sfx';

/** random-interval event generator, pumped up to a look-ahead horizon */
export class Events {
  private gens: { next: number; min: number; max: number; fn: (t: number) => void }[] = [];
  constructor(private rng: Rng, private t0: number) {}
  every(min: number, max: number, fn: (t: number) => void, firstDelay?: number): void {
    this.gens.push({ next: this.t0 + (firstDelay ?? this.rng.range(0, max)), min, max, fn });
  }
  /** schedule events up to `until`; events that fell behind `now` (a stalled main thread) are skipped */
  pump(until: number, now = -Infinity): void {
    for (const g of this.gens) {
      let guard = 0;
      if (g.next < now) g.next = now + this.rng.range(0, g.max);
      while (g.next < until && guard++ < 400) {
        g.fn(g.next);
        g.next += this.rng.range(g.min, g.max);
      }
    }
  }
}

export interface LoopBuild {
  events: Events;
}
type Builder = (p: Patch) => Events;

// ── building blocks ──────────────────────────────────────────────────────────

/** slow control signal (roughly -1..1): a few drifting sines plus wandering noise */
function modSig(p: Patch, rates: number[], noise = 0.35): GainNode {
  const s = p.gain(1 / (rates.length + noise));
  for (const r of rates) {
    const o = p.osc('sine', r * p.rng.range(0.8, 1.25), p.t, undefined, false);
    o.connect(s);
  }
  if (noise > 0) {
    const n = p.noise('pink', p.t);
    const lp = p.bq('lowpass', rates[0] * 2.5, 0.5, false);
    const g = p.gain(noise * 3);
    n.connect(lp);
    lp.connect(g);
    g.connect(s);
  }
  return s;
}
function mod(p: Patch, sig: AudioNode, param: AudioParam, depth: number): void {
  const g = p.gain(depth);
  sig.connect(g);
  g.connect(param);
}

interface Bed {
  src: AudioBufferSourceNode;
  filt: BiquadFilterNode;
  gain: GainNode;
}
/** noise → biquad → (optional second biquad) → gain → dest */
function bed(p: Patch, o: {
  kind?: NoiseKind; type: BiquadFilterType; f: number; q?: number; gain: number; type2?: BiquadFilterType; f2?: number; q2?: number;
  dest?: AudioNode;
}): Bed {
  const src = p.noise(o.kind ?? 'white');
  const filt = p.bq(o.type, o.f, o.q ?? 0.7, false);
  const gain = p.gain(o.gain);
  src.connect(filt);
  if (o.type2) {
    const f2 = p.bq(o.type2, o.f2 ?? 1000, o.q2 ?? 0.7, false);
    filt.connect(f2);
    f2.connect(gain);
  } else filt.connect(gain);
  gain.connect(o.dest ?? p.out);
  return { src, filt, gain };
}

// ── wind ─────────────────────────────────────────────────────────────────────

function windBeds(p: Patch, k: number, high = false): GainNode {
  const gust = modSig(p, [0.06, 0.11, 0.29], 0.5);
  const body = bed(p, { kind: 'pink', type: 'bandpass', f: high ? 650 : 360, q: 0.5, gain: 0.28 * k });
  mod(p, gust, body.filt.frequency, high ? 380 : 170);
  mod(p, gust, body.gain.gain, 0.2 * k);
  const low = bed(p, { kind: 'brown', type: 'lowpass', f: 170, q: 0.7, gain: 0.1 * k });
  mod(p, gust, low.gain.gain, 0.06 * k);
  const wh = bed(p, { type: 'bandpass', f: high ? 1500 : 880, q: 12, gain: 0.02 * k });
  mod(p, gust, wh.filt.frequency, high ? 500 : 330);
  mod(p, gust, wh.gain.gain, 0.05 * k);
  const wh2 = bed(p, { type: 'bandpass', f: high ? 2300 : 1250, q: 16, gain: 0.01 * k });
  mod(p, gust, wh2.filt.frequency, high ? 600 : 280);
  mod(p, gust, wh2.gain.gain, 0.03 * k);
  return gust;
}

const wind: Builder = (p) => {
  windBeds(p, 1.4);
  return new Events(p.rng, p.t);
};

const snowWind: Builder = (p) => {
  const gust = windBeds(p, 1.2, true);
  const ice = bed(p, { type: 'highpass', f: 2600, q: 0.6, gain: 0.015, type2: 'lowpass', f2: 8000 });
  mod(p, gust, ice.gain.gain, 0.045);
  const ev = new Events(p.rng, p.t);
  // blowing snow: soft grainy gusts
  ev.every(1.5, 4, (t) => {
    const c = p.child(t);
    c.nb({ dur: c.rng.range(0.6, 1.4), type: 'bandpass', f0: c.rng.range(1800, 3200), q: 0.8, amp: 0.05, atk: 0.3 });
  });
  return ev;
};

// ── forest ───────────────────────────────────────────────────────────────────

function bird(p: Patch, t: number): void {
  const c = p.child(t);
  const r = c.rng;
  const pan = c.pan(r.range(-0.9, 0.9));
  const air = c.bq('lowpass', r.range(4500, 7000), 0.5, false);
  pan.connect(air);
  air.connect(p.out);
  const vol = r.range(0.4, 1) * 1.5;
  const kind = r.int(0, 4);
  const base = r.range(2400, 4200);
  if (kind === 0) {
    // two-or-three-note tweet
    const n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const f = base * (1 + i * r.range(-0.08, 0.12));
      c.tone({ at: t + i * 0.105, f0: f, f1: f * r.range(0.8, 1.35), dur: 0.075, amp: 0.1 * vol, atk: 0.006, dest: pan, sweepTime: 0.06 });
    }
  } else if (kind === 1) {
    // trill
    const n = r.int(8, 14);
    const f2 = base * 1.12;
    for (let i = 0; i < n; i++) {
      const sh = 1 - Math.abs(i / (n - 1) - 0.5) * 1.2;
      c.tone({ at: t + i * 0.042, f0: i % 2 ? base : f2, dur: 0.03, amp: 0.07 * vol * sh, atk: 0.004, dest: pan });
    }
  } else if (kind === 2) {
    // long falling whistle with vibrato
    const d = r.range(0.35, 0.6);
    const { osc } = c.tone({ at: t, f0: base * 0.9, f1: base * 0.65, dur: d, amp: 0.1 * vol, atk: 0.05, dest: pan, sweepTime: d });
    osc.frequency.setValueAtTime(c.hz(base * 0.75), t);
    osc.frequency.linearRampToValueAtTime(c.hz(base * 1.05), t + d * 0.25);
    osc.frequency.exponentialRampToValueAtTime(c.hz(base * 0.62), t + d);
    lfo(c, osc.detune, 22, 60, 'sine', t, t + d + 0.1);
  } else if (kind === 3) {
    // chirp pair, rising
    for (let i = 0; i < 2; i++) {
      c.tone({ at: t + i * 0.14, f0: base * 0.7, f1: base * 1.2, dur: 0.09, amp: 0.11 * vol, atk: 0.008, dest: pan, sweepTime: 0.07 });
    }
  } else {
    // soft low coo
    const f = r.range(430, 560);
    for (let i = 0; i < 3; i++) c.tone({ at: t + i * 0.26, f0: f * (i === 0 ? 1.1 : 1), f1: f * 0.92, dur: 0.2, amp: 0.1 * vol, atk: 0.04, dest: pan, sweepTime: 0.2 });
  }
}

const forest: Builder = (p) => {
  const gust = modSig(p, [0.05, 0.09, 0.2], 0.5);
  const soft = bed(p, { kind: 'pink', type: 'bandpass', f: 380, q: 0.6, gain: 0.05 });
  mod(p, gust, soft.gain.gain, 0.05);
  mod(p, gust, soft.filt.frequency, 100);
  const leaves = bed(p, { type: 'bandpass', f: 3600, q: 0.55, gain: 0.012 });
  mod(p, gust, leaves.gain.gain, 0.03);
  const leaves2 = bed(p, { type: 'highpass', f: 6500, q: 0.5, gain: 0.004 });
  mod(p, gust, leaves2.gain.gain, 0.01);
  const room = bed(p, { kind: 'brown', type: 'lowpass', f: 230, gain: 0.03 });
  mod(p, gust, room.gain.gain, 0.012);
  // insects: faint high shimmer with fast AM
  const bug = bed(p, { type: 'bandpass', f: 5200, q: 14, gain: 0.0 });
  lfo(p, bug.gain.gain, 0.17, 0.012, 'sine');
  const bugAm = p.osc('square', 38, p.t, undefined, false);
  const bugG = p.gain(0.006);
  bugAm.connect(bugG);
  bugG.connect(bug.gain.gain);
  const ev = new Events(p.rng, p.t);
  ev.every(0.35, 1.7, (t) => bird(p, t), 0.3);
  ev.every(3, 8, (t) => {
    // distant twig crack / branch creak
    const c = p.child(t);
    c.nb({ dur: 0.02, type: 'bandpass', f0: c.rng.range(700, 1500), q: 5, amp: 0.05 });
    c.modes({ f: c.rng.range(300, 520), partials: [[1, 1, 0.07], [2.4, 0.4, 0.04]], amp: 0.025 });
  });
  return ev;
};

// ── rain / storm ─────────────────────────────────────────────────────────────

function rainBeds(p: Patch, k: number): void {
  bed(p, { type: 'highpass', f: 1100, q: 0.5, gain: 0.05 * k, type2: 'lowpass', f2: 9500 });
  const patter = bed(p, { type: 'bandpass', f: 3800, q: 0.45, gain: 0.025 * k });
  // crackle: gain modulated by lowpassed noise
  const mn = p.noise('white');
  const ml = p.bq('lowpass', 45, 0.7, false);
  const mg = p.gain(0.09 * k);
  mn.connect(ml);
  ml.connect(mg);
  mg.connect(patter.gain.gain);
  const wash = bed(p, { kind: 'pink', type: 'lowpass', f: 900, gain: 0.12 * k });
  const roof = bed(p, { kind: 'pink', type: 'bandpass', f: 1700, q: 0.6, gain: 0.04 * k });
  const slow = modSig(p, [0.12, 0.31], 0.6);
  mod(p, slow, wash.gain.gain, 0.04 * k);
  mod(p, slow, roof.gain.gain, 0.02 * k);
}

function rainEvents(p: Patch, ev: Events, k: number): void {
  ev.every(0.03, 0.12 / k, (t) => {
    const c = p.child(t);
    const f = c.rng.range(2500, 7000);
    c.nb({ dur: c.rng.range(0.008, 0.02), type: 'bandpass', f0: f, q: 4, amp: c.rng.range(0.012, 0.045) * k, dest: undefined, pan: c.rng.range(-0.8, 0.8) });
  });
  ev.every(0.25, 0.9 / k, (t) => {
    // heavier drops on leaves / puddles
    const c = p.child(t);
    const f = c.rng.range(700, 2200);
    c.tone({ f0: f, f1: f * 1.6, dur: 0.04, amp: 0.02 * k, atk: 0.003, sweepTime: 0.03, pan: c.rng.range(-0.8, 0.8) });
  });
}

const rain: Builder = (p) => {
  rainBeds(p, 1.35);
  const ev = new Events(p.rng, p.t);
  rainEvents(p, ev, 1.35);
  return ev;
};

const storm: Builder = (p) => {
  rainBeds(p, 2.1);
  windBeds(p, 1.0);
  const ev = new Events(p.rng, p.t);
  rainEvents(p, ev, 2.0);
  ev.every(8, 19, (t) => {
    const c = p.child(t, p.out);
    thunder(c, { close: c.rng.range(0.3, 0.8), dur: c.rng.range(4, 5.6) });
  }, 1.8);
  return ev;
};

// ── fire ─────────────────────────────────────────────────────────────────────

const fire: Builder = (p) => {
  const flick = modSig(p, [0.7, 1.3, 2.9, 5.1], 0.8);
  const low = bed(p, { kind: 'brown', type: 'lowpass', f: 230, gain: 0.06 });
  mod(p, flick, low.gain.gain, 0.03);
  const hiss = bed(p, { type: 'bandpass', f: 2600, q: 0.5, gain: 0.02 });
  mod(p, flick, hiss.gain.gain, 0.02);
  const body = bed(p, { kind: 'pink', type: 'bandpass', f: 750, q: 0.8, gain: 0.07 });
  mod(p, flick, body.gain.gain, 0.05);
  mod(p, flick, body.filt.frequency, 250);
  const ev = new Events(p.rng, p.t);
  ev.every(0.02, 0.14, (t) => {
    const c = p.child(t);
    const big = c.rng.chance(0.12);
    c.nb({
      dur: big ? c.rng.range(0.02, 0.05) : c.rng.range(0.006, 0.02), type: 'bandpass',
      f0: c.rng.range(900, big ? 3000 : 5500), q: c.rng.range(1.5, 5), amp: big ? c.rng.range(0.15, 0.3) : c.rng.range(0.03, 0.12),
      pan: c.rng.range(-0.5, 0.5),
    });
  });
  ev.every(1.2, 4.5, (t) => {
    const c = p.child(t);
    c.nb({ dur: 0.06, type: 'bandpass', f0: 700, q: 1.2, amp: 0.3 });
    c.tone({ f0: 210, f1: 90, dur: 0.07, amp: 0.2, sweepTime: 0.05 });
    c.nb({ at: t + 0.01, dur: 0.1, kind: 'pink', type: 'lowpass', f0: 1200, amp: 0.15 });
  });
  ev.every(2.5, 7, (t) => {
    const c = p.child(t);
    const d = c.rng.range(0.5, 1.1);
    c.nb({ dur: d, kind: 'pink', type: 'bandpass', f0: 500, f1: 900, q: 0.8, amp: 0.1, atk: d * 0.4 });
  });
  return ev;
};

// ── water ────────────────────────────────────────────────────────────────────

const river: Builder = (p) => {
  const slow = modSig(p, [0.21, 0.47, 0.9], 0.6);
  const a = bed(p, { kind: 'pink', type: 'bandpass', f: 650, q: 0.4, gain: 0.18 });
  mod(p, slow, a.gain.gain, 0.05);
  const b = bed(p, { type: 'bandpass', f: 1900, q: 0.6, gain: 0.03 });
  mod(p, slow, b.gain.gain, 0.012);
  mod(p, slow, b.filt.frequency, 500);
  bed(p, { type: 'highpass', f: 4800, q: 0.5, gain: 0.0075 });
  bed(p, { kind: 'brown', type: 'lowpass', f: 150, gain: 0.05 });
  const ev = new Events(p.rng, p.t);
  ev.every(0.05, 0.22, (t) => {
    const c = p.child(t);
    const f = c.rng.range(280, 1500);
    c.tone({ f0: f, f1: f * c.rng.range(1.4, 2), dur: c.rng.range(0.03, 0.09), amp: c.rng.range(0.012, 0.03), atk: 0.006, sweepTime: 0.05, pan: c.rng.range(-0.8, 0.8) });
  });
  return ev;
};

const rapids: Builder = (p) => {
  const turb = modSig(p, [0.8, 1.9, 3.1, 5.3], 0.9);
  const a = bed(p, { type: 'bandpass', f: 1250, q: 0.35, gain: 0.07 });
  mod(p, turb, a.gain.gain, 0.025);
  mod(p, turb, a.filt.frequency, 300);
  const b = bed(p, { kind: 'pink', type: 'lowpass', f: 380, gain: 0.16 });
  mod(p, turb, b.gain.gain, 0.06);
  const c = bed(p, { type: 'highpass', f: 3200, q: 0.5, gain: 0.015 });
  mod(p, turb, c.gain.gain, 0.012);
  const d = bed(p, { kind: 'brown', type: 'lowpass', f: 110, gain: 0.1 });
  mod(p, turb, d.gain.gain, 0.04);
  const ev = new Events(p.rng, p.t);
  ev.every(0.06, 0.28, (t) => {
    const cc = p.child(t);
    cc.nb({ dur: cc.rng.range(0.07, 0.18), kind: 'pink', type: 'bandpass', f0: cc.rng.range(900, 3200), q: 0.8, amp: cc.rng.range(0.04, 0.1), pan: cc.rng.range(-0.8, 0.8), atk: 0.02 });
  });
  ev.every(0.5, 1.8, (t) => {
    const cc = p.child(t);
    cc.tone({ f0: cc.rng.range(110, 180), f1: 55, dur: 0.14, amp: 0.1, sweepTime: 0.1, atk: 0.01 });
    cc.nb({ dur: 0.2, kind: 'pink', type: 'lowpass', f0: 700, amp: 0.12, atk: 0.02 });
  });
  return ev;
};

// ── cave ─────────────────────────────────────────────────────────────────────

const cave: Builder = (p) => {
  const slow = modSig(p, [0.04, 0.09, 0.17], 0.5);
  const rumble = bed(p, { kind: 'brown', type: 'lowpass', f: 120, gain: 0.1 });
  mod(p, slow, rumble.gain.gain, 0.04);
  // standing drone: close, slowly beating sines
  for (const [f, g] of [[55, 0.012], [82.4, 0.03], [82.9, 0.025], [110.3, 0.028], [165.2, 0.02], [220.6, 0.012]] as const) {
    const o = p.osc('sine', f, p.t, undefined, false);
    const og = p.gain(g);
    o.connect(og);
    og.connect(p.out);
    mod(p, slow, og.gain, g * 0.5);
  }
  // wind in the tunnels
  const air = bed(p, { kind: 'pink', type: 'bandpass', f: 300, q: 5, gain: 0.14 });
  bed(p, { kind: 'pink', type: 'bandpass', f: 520, q: 1.2, gain: 0.025 });
  mod(p, slow, air.filt.frequency, 120);
  mod(p, slow, air.gain.gain, 0.04);
  const air2 = bed(p, { type: 'bandpass', f: 640, q: 10, gain: 0.012 });
  mod(p, slow, air2.filt.frequency, 200);
  mod(p, slow, air2.gain.gain, 0.015);
  // cave echo bus for drips
  const echoIn = p.gain(1);
  const dl = p.delay(0.25);
  dl.delayTime.value = 0.23;
  const dl2 = p.delay(0.4);
  dl2.delayTime.value = 0.41;
  const lp = p.bq('lowpass', 2600, 0.5, false);
  const fb = p.gain(0.5);
  echoIn.connect(dl);
  dl.connect(lp);
  lp.connect(fb);
  fb.connect(dl);
  lp.connect(p.out);
  echoIn.connect(dl2);
  const eg = p.gain(0.35);
  dl2.connect(eg);
  eg.connect(p.out);
  const ev = new Events(p.rng, p.t);
  ev.every(0.5, 2.6, (t) => {
    const c = p.child(t, echoIn);
    const f = c.rng.range(1000, 2800);
    c.tone({ f0: f * 0.9, f1: f * 1.35, dur: 0.09, amp: 0.2, atk: 0.003, sweepTime: 0.025 });
    c.tone({ f0: f * 2.1, f1: f * 2.5, dur: 0.04, amp: 0.05, atk: 0.002, sweepTime: 0.02 });
    // dry copy slightly louder
    const d = p.child(t);
    d.tone({ f0: f * 0.9, f1: f * 1.35, dur: 0.08, amp: 0.1, atk: 0.003, sweepTime: 0.025, pan: c.rng.range(-0.6, 0.6) });
  }, 0.2);
  ev.every(9, 22, (t) => {
    const c = p.child(t, echoIn);
    c.nb({ dur: 0.9, kind: 'brown', type: 'lowpass', f0: 220, amp: 0.3, atk: 0.2 });
    for (let i = 0; i < 6; i++) {
      c.modes({ at: t + 0.2 + c.rng.range(0, 0.9), f: c.rng.range(150, 500), partials: [[1, 1, 0.06], [2.3, 0.4, 0.04]], amp: 0.05 });
    }
  }, 3);
  return ev;
};

// ── battle / army ────────────────────────────────────────────────────────────

const battle: Builder = (p) => {
  const swell = modSig(p, [0.13, 0.27, 0.6], 0.7);
  // crowd murmur: three formant bands
  for (const [f, q, g] of [[520, 3, 0.1], [1100, 3, 0.08], [2300, 3, 0.05]] as const) {
    const b = bed(p, { kind: 'pink', type: 'bandpass', f, q, gain: g });
    mod(p, swell, b.gain.gain, g * 0.8);
    mod(p, swell, b.filt.frequency, f * 0.25);
  }
  bed(p, { kind: 'brown', type: 'lowpass', f: 140, gain: 0.05 });
  const air = p.bq('lowpass', 4200, 0.5, false);
  air.connect(p.out);
  const ev = new Events(p.rng, p.t);
  ev.every(0.1, 0.5, (t) => {
    const c = p.child(t, air);
    const r = c.rng;
    const f = r.range(800, 3500);
    c.modes({ f, partials: [[1, 1, 0.12], [2.4, 0.45, 0.07], [4.1, 0.2, 0.04]], amp: r.range(0.03, 0.12), pan: r.range(-0.9, 0.9) });
    c.nb({ dur: 0.012, type: 'bandpass', f0: r.range(2500, 5000), q: 1.5, amp: 0.05 });
    if (r.chance(0.35)) c.tone({ f0: r.range(160, 280), f1: 80, dur: 0.06, amp: 0.07, sweepTime: 0.04 });
  });
  ev.every(0.4, 1.5, (t) => {
    const c = p.child(t, air);
    const r = c.rng;
    const hi = r.chance(0.2);
    const f = hi ? r.range(280, 400) : r.range(90, 200);
    formantVoice(c, {
      dur: r.range(0.3, 0.8), f0: [[0, f * r.range(1, 1.15)], [0.25, f * 1.2], [0.7, f * 0.8]], vowel: r.pick(['aw', 'ah', 'oh', 'uh'] as const),
      size: hi ? 1 : 0.85, amp: r.range(0.04, 0.1), growlHz: 40, growl: 0.5, drive: 2.5, breath: 0.25, pan: r.range(-0.9, 0.9), atk: 0.04,
    });
  });
  ev.every(1.2, 4, (t) => {
    const c = p.child(t, air);
    const f = c.rng.range(1200, 3000);
    c.nb({ dur: 0.35, type: 'bandpass', f0: f * 0.7, f1: f * 1.1, q: 2, amp: 0.045, pan: c.rng.range(-0.9, 0.9) });
  });
  ev.every(14, 30, (t) => {
    const c = p.child(t, air);
    brass(c, { at: t, freq: 73.4, dur: 1.7, amp: 0.05, atk: 0.25, rel: 0.5, bright: 0.35, bend: -40, dissonant: true });
    brass(c, { at: t + 0.04, freq: 103.8, dur: 1.7, amp: 0.04, atk: 0.28, rel: 0.5, bright: 0.35, bend: -50 });
  }, 5);
  return ev;
};

const army: Builder = (p) => {
  const dist = p.bq('lowpass', 1800, 0.5, false);
  dist.connect(p.out);
  const swell = modSig(p, [0.1, 0.23], 0.6);
  const mum = bed(p, { kind: 'pink', type: 'bandpass', f: 420, q: 0.7, gain: 0.04 });
  mod(p, swell, mum.gain.gain, 0.025);
  const rum = bed(p, { kind: 'brown', type: 'lowpass', f: 130, gain: 0.05 });
  const pulse = p.osc('sine', 2, p.t, undefined, false);
  const pg = p.gain(0.05);
  pulse.connect(pg);
  pg.connect(rum.gain.gain);
  const jingle = bed(p, { type: 'bandpass', f: 4300, q: 2, gain: 0.0 });
  const jam = modSig(p, [7, 11], 0.9);
  mod(p, jam, jingle.gain.gain, 0.006);
  const ev = new Events(p.rng, p.t);
  const STEP = 0.5;
  let step = 0;
  ev.every(STEP, STEP, (t) => {
    step++;
    const accent = step % 4 === 1 ? 1 : 0.75;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const c = p.child(t + p.rng.range(-0.045, 0.045), dist);
      const r = c.rng;
      const at = c.t;
      c.tone({ at, f0: r.range(95, 140), f1: 52, dur: 0.1, amp: 0.05 * accent, sweepTime: 0.06, pan: r.range(-0.8, 0.8) });
      c.nb({ at, dur: 0.1, kind: 'pink', type: 'bandpass', f0: r.range(500, 900), q: 0.7, amp: 0.2 * accent, pan: r.range(-0.8, 0.8) });
      if (r.chance(0.5)) c.modes({ at: at + 0.01, f: r.range(2200, 5200), partials: [[1, 1, 0.05], [2.1, 0.4, 0.03]], amp: 0.05, pan: r.range(-0.7, 0.7) });
    }
  });
  // distant war drum on the downbeat
  let bar = 0;
  ev.every(STEP * 4, STEP * 4, (t) => {
    const c = p.child(t, dist);
    drum(c, { at: t, freq: bar++ % 2 ? 70 : 58, amp: 0.22, dur: 0.5, boom: 0.4, skin: 0.4 });
  }, STEP * 4);
  // shouted orders / far horn
  ev.every(7, 16, (t) => {
    const c = p.child(t, dist);
    formantVoice(c, { dur: 0.6, f0: [[0, 120], [0.2, 140], [0.55, 100]], vowel: 'aw', size: 0.85, amp: 0.06, growlHz: 35, growl: 0.5, drive: 3, breath: 0.25 });
  }, 3);
  return ev;
};

export const LOOPS: Record<LoopName, { build: Builder; /** typical output ceiling (linear) used to normalise */ trim: number }> = {
  wind: { build: wind, trim: 0.977 },
  forest: { build: forest, trim: 2.318 },
  rain: { build: rain, trim: 1.109 },
  storm: { build: storm, trim: 0.733 },
  fire: { build: fire, trim: 2.917 },
  river: { build: river, trim: 2.089 },
  rapids: { build: rapids, trim: 1.698 },
  cave: { build: cave, trim: 0.813 },
  battle: { build: battle, trim: 2.427 },
  army: { build: army, trim: 1.622 },
  snow_wind: { build: snowWind, trim: 1.259 },
};
