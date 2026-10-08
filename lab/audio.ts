/**
 * Audio Lab.
 *
 *   /lab/audio.html                      render every SfxName, LoopName and MusicMood offline, compute
 *                                        peak / RMS / spectrum, publish window.__audioReport
 *   /lab/audio.html?only=sfx|loop|music  restrict the report;  &mode=dry|mix|both  &names=a,b  &full=1 (mix every mood)
 *   /lab/audio.html?view=spec&sfx=bow_draw,thunder&loop=rain&music=combat&len=16
 *                                        draw waveform + log-frequency spectrogram (screenshot it)
 *   /lab/audio.html?view=ui              realtime playground (click to hear everything)
 *
 * "dry"  = the raw synthesis (voice trim only), "mix" = through the real bus graph
 *          (reverb sends, sfx/ambience/music buses, compressor, soft clip, default volumes).
 * Pass criteria: RMS > -45 dBFS and peak < 0 dBFS.
 *
 * Test hooks: window.__snapReady, window.__audioReport, window.__audioLab.
 */
import type { LoopName, MusicMood, SfxName } from '../src/core/types';
import { createAudio } from '../src/core/audio';
import { Patch } from '../src/core/audio/dsp';
import { SFX } from '../src/core/audio/sfx';
import { LOOPS } from '../src/core/audio/loops';
import { createMusicEngine } from '../src/core/audio/music';
import { LoopPlayer, MAX_VOICES, MusicPlayer, ReverbUnit, SfxPlayer, buildGraph } from '../src/core/audio/graph';
import { mulberry32, hashSeed } from '../src/core/rng';
import * as THREE from 'three';

declare global {
  interface Window {
    __snapReady?: boolean;
    __snapError?: string;
    __audioReport?: unknown;
    __audioLab?: unknown;
  }
}

const SR = 44100;
const LOOP_LEN = 8;
const MUSIC_LEN = 13;

// completeness is enforced by the types: a missing key is a compile error
const MOODS: Record<MusicMood, true> = {
  none: true, menu: true, explore: true, tension: true, combat: true, boss: true, epic: true, victory: true, defeat: true,
};
const SFX_NAMES = Object.keys(SFX) as SfxName[];
const LOOP_NAMES = Object.keys(LOOPS) as LoopName[];
const MOOD_NAMES = Object.keys(MOODS) as MusicMood[];

const params = new URLSearchParams(location.search);
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const status = (s: string): void => {
  $('status').textContent = s;
};

const mkCtx = (seconds: number, channels = 2): OfflineAudioContext =>
  new OfflineAudioContext(channels, Math.max(128, Math.ceil(seconds * SR)), SR);

// ── analysis ─────────────────────────────────────────────────────────────────

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));
const r1 = (x: number): number => Math.round(x * 10) / 10;

interface Stats {
  dur: number;
  pk: number;
  rms: number;
  rmsFull: number;
  cen: number;
  bands: number[];
  nan: boolean;
  region: [number, number];
}

function analyze(buf: AudioBuffer, o: { from?: number; region?: [number, number] } = {}): Stats {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  let pk = 0;
  let nan = false;
  let i0 = -1;
  let i1 = 0;
  let sumAll = 0;
  const thr = 0.001;
  for (let i = 0; i < n; i++) {
    const a = L[i];
    const b = R[i];
    if (a !== a || b !== b || !isFinite(a) || !isFinite(b)) {
      nan = true;
      continue;
    }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > pk) pk = m;
    sumAll += a * a + b * b;
    if (m > thr) {
      if (i0 < 0) i0 = i;
      i1 = i;
    }
  }
  if (i0 < 0) {
    i0 = 0;
    i1 = n - 1;
  }
  let region: [number, number] = o.region ?? [i0, i1 + 1];
  if (o.from !== undefined) region = [Math.min(n - 1, Math.floor(o.from * SR)), n];
  region = [Math.max(0, region[0]), Math.min(n, Math.max(region[0] + 1, region[1]))];
  let s = 0;
  for (let i = region[0]; i < region[1]; i++) s += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(s / (2 * (region[1] - region[0])));
  const rmsFull = Math.sqrt(sumAll / (2 * n));

  // spectrum: average magnitude² over up to 10 Hann windows across the region
  const N = 4096;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const acc = new Float64Array(N / 2);
  const span = region[1] - region[0];
  const wins = Math.max(1, Math.min(10, Math.floor(span / (N / 2))));
  for (let w = 0; w < wins; w++) {
    const start = region[0] + Math.floor(((span - Math.min(N, span)) * (wins === 1 ? 0 : w)) / Math.max(1, wins - 1));
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      const v = idx < region[1] && idx < n ? (L[idx] + R[idx]) * 0.5 : 0;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  let tot = 0;
  let wsum = 0;
  const bandE = [0, 0, 0, 0];
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N;
    tot += acc[k];
    wsum += acc[k] * f;
    bandE[f < 200 ? 0 : f < 1000 ? 1 : f < 4000 ? 2 : 3] += acc[k];
  }
  return {
    dur: (i1 - i0) / SR,
    pk,
    rms,
    rmsFull,
    cen: tot > 0 ? wsum / tot : 0,
    bands: bandE.map((e) => Math.round((e / Math.max(tot, 1e-30)) * 100)),
    nan,
    region,
  };
}

// ── renderers ────────────────────────────────────────────────────────────────

const seededRand = (name: string): (() => number) => mulberry32(hashSeed('audiolab', name));

function probeSfx(name: SfxName): number {
  const c = mkCtx(0.01, 1);
  return SFX[name].build(new Patch(c, c.destination, 0.01, { seed: hashSeed(name) }));
}

async function renderSfxDry(name: SfxName): Promise<AudioBuffer> {
  const dur = probeSfx(name) + 0.3;
  const ctx = mkCtx(dur + 0.01);
  const out = ctx.createGain();
  out.gain.value = SFX[name].gain;
  out.connect(ctx.destination);
  SFX[name].build(new Patch(ctx, out, 0.01, { seed: hashSeed(name) }));
  return ctx.startRendering();
}

/** the voice starts at WARM seconds: Chrome's compressor needs a moment before it is transparent */
const WARM = 0.5;

async function renderSfxMix(name: SfxName, extra?: { pos?: THREE.Vector3; pitch?: number; slow?: number; tail?: number }): Promise<AudioBuffer> {
  const dur = probeSfx(name) + 0.3 + (extra?.tail ?? 1.2) + WARM;
  const ctx = mkCtx(dur);
  const g = buildGraph(ctx);
  g.master.gain.value = 0.8;
  if (extra?.slow) {
    g.sfxLP.frequency.value = 750;
    g.sfxDetune?.offset.setValueAtTime(-900, 0);
  }
  const player = new SfxPlayer(g);
  player.setListener(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  void ctx.suspend(WARM).then(() => {
    player.play(name, { pos: extra?.pos, pitch: extra?.pitch }, seededRand(name));
    void ctx.resume();
  });
  return ctx.startRendering();
}

async function renderLoopDry(name: LoopName, len = LOOP_LEN): Promise<AudioBuffer> {
  const ctx = mkCtx(len);
  const out = ctx.createGain();
  out.gain.value = LOOPS[name].trim;
  out.connect(ctx.destination);
  const p = new Patch(ctx, out, 0, { seed: hashSeed(name) });
  const ev = LOOPS[name].build(p);
  ev.pump(len + 0.5);
  return ctx.startRendering();
}

async function renderLoopMix(name: LoopName, len = LOOP_LEN): Promise<AudioBuffer> {
  const ctx = mkCtx(len);
  const g = buildGraph(ctx);
  g.master.gain.value = 0.8;
  const lp = new LoopPlayer(g);
  lp.set(name, 1);
  lp.active.get(name)!.events.pump(len + 0.5);
  return ctx.startRendering();
}

async function renderMusicDry(mood: MusicMood, len = MUSIC_LEN): Promise<AudioBuffer> {
  const ctx = mkCtx(len);
  const out = ctx.createGain();
  out.gain.value = 0.62;
  out.connect(ctx.destination);
  const eng = createMusicEngine(ctx, out, { hall: null, seed: hashSeed(mood) });
  eng.setMood(mood, 0, true);
  eng.pump(len + 0.5, 0);
  return ctx.startRendering();
}

async function renderMusicMix(mood: MusicMood, len = MUSIC_LEN): Promise<AudioBuffer> {
  const ctx = mkCtx(len);
  const g = buildGraph(ctx);
  g.master.gain.value = 0.8;
  g.musicBus.gain.value = 0.62 * 0.7;
  const m = new MusicPlayer(g, hashSeed(mood));
  m.set(mood, true);
  m.engine.pump(len + 0.5, 0);
  return ctx.startRendering();
}

// ── report ───────────────────────────────────────────────────────────────────

interface Row {
  k: 'sfx' | 'loop' | 'music';
  n: string;
  m: 'dry' | 'mix';
  dur: number;
  pk: number;
  rms: number;
  rmsFull: number;
  cen: number;
  bands: number[];
  ok: boolean;
  why: string;
  /** JS time to construct the voice's node graph (sfx only), ms */
  bms?: number;
}

function judge(k: Row['k'], n: string, s: Stats): { ok: boolean; why: string } {
  const why: string[] = [];
  const pkDb = db(s.pk);
  const rmsDb = db(s.rms);
  const silentOk = k === 'music' && n === 'none';
  if (s.nan) why.push('NaN/Inf samples');
  if (silentOk) {
    if (db(s.rmsFull) > -80) why.push('mood none should be silent');
  } else {
    if (rmsDb <= -45) why.push(`silent (rms ${r1(rmsDb)} dBFS)`);
    if (pkDb >= -0.05) why.push(`clipping (peak ${r1(pkDb)} dBFS)`);
  }
  return { ok: why.length === 0, why: why.join('; ') };
}

function toRow(k: Row['k'], n: string, m: Row['m'], s: Stats): Row {
  const j = judge(k, n, s);
  return {
    k, n, m, dur: r1(s.dur), pk: r1(db(s.pk)), rms: r1(db(s.rms)), rmsFull: r1(db(s.rmsFull)), cen: Math.round(s.cen),
    bands: s.bands, ok: j.ok, why: j.why,
  };
}

async function runReport(): Promise<unknown> {
  const only = params.get('only');
  const mode = params.get('mode') ?? 'both';
  const names = params.get('names')?.split(',').filter(Boolean);
  const want = (n: string): boolean => !names || names.includes(n);
  const full = params.get('full') === '1' || !!names;
  const MIX_SUBSET: MusicMood[] = ['none', 'explore', 'combat', 'victory'];
  const t0 = performance.now();
  const dry = mode === 'both' || mode === 'dry';
  const mix = mode === 'both' || mode === 'mix';

  // jobs run a few at a time: OfflineAudioContexts render off the main thread
  const jobs: (() => Promise<Row[]>)[] = [];
  if (!only || only === 'sfx') {
    for (const n of SFX_NAMES) {
      if (!want(n)) continue;
      jobs.push(async () => {
        const out: Row[] = [];
        let region: [number, number] | undefined;
        if (dry) {
          const tb = performance.now();
          for (let i = 0; i < 5; i++) probeSfx(n);
          const bms = r1((performance.now() - tb) / 5);
          const s = analyze(await renderSfxDry(n));
          region = s.region;
          out.push({ ...toRow('sfx', n, 'dry', s), bms });
        }
        const shift = Math.round((WARM - 0.004) * SR);
        if (mix) out.push(toRow('sfx', n, 'mix', analyze(await renderSfxMix(n), { region: region && [region[0] + shift, region[1] + shift] })));
        return out;
      });
    }
  }
  if (!only || only === 'loop') {
    for (const n of LOOP_NAMES) {
      if (!want(n)) continue;
      jobs.push(async () => {
        const out: Row[] = [];
        if (dry) out.push(toRow('loop', n, 'dry', analyze(await renderLoopDry(n), { from: 1 })));
        if (mix) out.push(toRow('loop', n, 'mix', analyze(await renderLoopMix(n), { from: 3 })));
        return out;
      });
    }
  }
  if (!only || only === 'music') {
    for (const n of MOOD_NAMES) {
      if (!want(n)) continue;
      jobs.push(async () => {
        const out: Row[] = [];
        if (dry) out.push(toRow('music', n, 'dry', analyze(await renderMusicDry(n), { from: 0.5 })));
        // the full bus mix of every mood is slow: by default only a representative subset (?full=1 for all)
        if (mix && (full || MIX_SUBSET.includes(n))) out.push(toRow('music', n, 'mix', analyze(await renderMusicMix(n), { from: 0.5 })));
        return out;
      });
    }
  }
  const results: Row[][] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
      status(`rendered ${++done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  const rows: Row[] = results.flat();

  const tests = only || names ? {} : await runTests();
  const failures = rows.filter((r) => !r.ok).map((r) => `${r.k}:${r.n}:${r.m} ${r.why}`);
  const coverage = {
    sfx: SFX_NAMES.length,
    loops: LOOP_NAMES.length,
    moods: MOOD_NAMES.length,
  };
  const report = {
    summary: {
      total: rows.length, failed: failures.length, failures, coverage, maxVoices: MAX_VOICES, renderSec: r1((performance.now() - t0) / 1000),
      testsOk: Object.values(tests as Record<string, { ok: boolean }>).every((t) => t.ok),
    },
    tests,
    rows,
  };
  window.__audioReport = report;
  renderTable(rows);
  return report;
}

async function runTests(): Promise<Record<string, { ok: boolean; info: unknown }>> {
  const out: Record<string, { ok: boolean; info: unknown }> = {};
  status('tests');

  // 1. voice limiting: 60 different sounds at once never exceed 24 voices, the oldest are stolen
  {
    const ctx = mkCtx(2);
    const g = buildGraph(ctx);
    const pl = new SfxPlayer(g);
    let maxSeen = 0;
    const rand = seededRand('limit');
    for (let i = 0; i < 60; i++) {
      pl.play(SFX_NAMES[i % SFX_NAMES.length], {}, rand);
      maxSeen = Math.max(maxSeen, pl.voices.length);
    }
    out.voiceLimit = { ok: maxSeen <= MAX_VOICES && pl.stolen > 0, info: { maxSeen, stolen: pl.stolen, limit: MAX_VOICES } };
  }

  // 2. positional: a source on the listener's right is louder in the right channel; far is quieter
  {
    const near = analyze(await renderSfxMix('orc_roar', { pos: new THREE.Vector3(6, 0, 0) }));
    const l = await renderSfxMix('orc_roar', { pos: new THREE.Vector3(6, 0, 0) });
    const chRms = (b: AudioBuffer, c: number): number => {
      const d = b.getChannelData(c);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    };
    const far = analyze(await renderSfxMix('orc_roar', { pos: new THREE.Vector3(60, 0, 0) }));
    const unp = analyze(await renderSfxMix('orc_roar'));
    const rightDb = db(chRms(l, 1));
    const leftDb = db(chRms(l, 0));
    out.positional = {
      ok: rightDb > leftDb + 1 && db(far.rms) < db(near.rms) - 6 && !near.nan && db(far.rms) > -80 && db(near.rms) > -45,
      info: { leftDb: r1(leftDb), rightDb: r1(rightDb), nearRms: r1(db(near.rms)), farRms: r1(db(far.rms)), unpositionedRms: r1(db(unp.rms)), farCentroid: Math.round(far.cen), nearCentroid: Math.round(near.cen) },
    };
  }

  // 3. slow motion: darker (lower centroid) and quieter-top, still audible
  {
    const a = analyze(await renderSfxMix('sword_clash'));
    const b = analyze(await renderSfxMix('sword_clash', { slow: 1 }));
    out.slowmo = { ok: b.cen < a.cen * 0.7 && db(b.rms) > -60, info: { normalCentroid: Math.round(a.cen), slowCentroid: Math.round(b.cen), slowRms: r1(db(b.rms)) } };
  }

  // 4. reverb unit: longer decay → longer tail
  {
    const tail = async (decay: number): Promise<number> => {
      const ctx = mkCtx(decay * 1.3 + 0.5, 2);
      const rv = new ReverbUnit(ctx, decay);
      rv.output.connect(ctx.destination);
      const src = ctx.createBufferSource();
      const imp = ctx.createBuffer(1, 64, SR);
      imp.getChannelData(0)[0] = 1;
      src.buffer = imp;
      src.connect(rv.input);
      src.start(0);
      const b = await ctx.startRendering();
      return analyze(b).dur;
    };
    const short = await tail(1.2);
    const long = await tail(5.5);
    out.reverb = { ok: long > short * 2.2 && short > 0.3, info: { tail1p2: r1(short), tail5p5: r1(long) } };
  }

  // 5. determinism: two renders of the same patch are identical
  {
    const a = (await renderSfxDry('explosion')).getChannelData(0);
    const b = (await renderSfxDry('explosion')).getChannelData(0);
    let same = a.length === b.length;
    for (let i = 0; same && i < a.length; i += 31) if (Math.abs(a[i] - b[i]) > 1e-4) same = false;
    out.deterministic = { ok: same, info: {} };
  }
  return out;
}

// ── table / spectrograms ─────────────────────────────────────────────────────

function renderTable(rows: Row[]): void {
  const t = document.createElement('table');
  t.innerHTML =
    '<tr><th>sound</th><th>mode</th><th>dur s</th><th>peak dB</th><th>rms dB</th><th>centroid Hz</th><th>&lt;200</th><th>&lt;1k</th><th>&lt;4k</th><th>&gt;4k</th><th></th></tr>' +
    rows
      .map(
        (r) =>
          `<tr class="${r.ok ? '' : 'fail'}"><td>${r.k}:${r.n}</td><td>${r.m}</td><td>${r.dur}</td><td>${r.pk}</td><td>${r.rms}</td><td>${r.cen}</td>` +
          r.bands.map((b) => `<td>${b}</td>`).join('') +
          `<td>${r.ok ? 'ok' : r.why}</td></tr>`,
      )
      .join('');
  $('table').replaceChildren(t);
}

const HEAT: [number, number, number][] = [
  [0, 0, 0], [20, 10, 60], [70, 10, 110], [140, 30, 100], [210, 70, 50], [250, 150, 20], [255, 230, 120], [255, 255, 255],
];
const heat = (v: number): [number, number, number] => {
  const x = Math.max(0, Math.min(0.9999, v)) * (HEAT.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = HEAT[i];
  const b = HEAT[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};

function drawSpec(buf: AudioBuffer, title: string, stats: Stats): void {
  const W = 960;
  const WH = 44;
  const SH = 170;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = WH + SH + 16;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, cv.width, cv.height);
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  // waveform (max abs per column)
  c.fillStyle = '#7fbf5f';
  for (let x = 0; x < W; x++) {
    const a = Math.floor((x / W) * n);
    const b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
    let m = 0;
    for (let i = a; i < b; i += Math.max(1, (b - a) >> 6)) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
    const h = Math.max(1, m * (WH / 2 - 2));
    c.fillRect(x, WH / 2 - h, 1, h * 2);
  }
  // spectrogram
  const N = 1024;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const img = c.createImageData(W, SH);
  const fmin = 40;
  const fmax = 16000;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  for (let x = 0; x < W; x++) {
    const centre = Math.floor(((x + 0.5) / W) * n);
    for (let i = 0; i < N; i++) {
      const idx = centre - N / 2 + i;
      re[i] = idx >= 0 && idx < n ? (L[idx] + R[idx]) * 0.5 * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < SH; y++) {
      const f = fmin * Math.pow(fmax / fmin, 1 - y / (SH - 1));
      const kf = (f * N) / SR;
      const k0 = Math.min(N / 2 - 2, Math.floor(kf));
      const fr = kf - k0;
      const m0 = Math.hypot(re[k0], im[k0]);
      const m1 = Math.hypot(re[k0 + 1], im[k0 + 1]);
      const mag = (m0 * (1 - fr) + m1 * fr) / (N / 4);
      const d = db(mag);
      const v = (d + 96) / 86; // -96 .. -10 dBFS
      const [r, g, b] = heat(v);
      const o = (y * W + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, WH);
  // frequency ticks
  c.fillStyle = 'rgba(255,255,255,.55)';
  c.font = '10px monospace';
  for (const f of [100, 1000, 10000]) {
    const y = WH + (1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (SH - 1);
    c.fillRect(0, y, 6, 1);
    c.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 8, y + 3);
  }
  const secs = n / SR;
  for (let s = 0; s <= secs; s += secs > 10 ? 2 : secs > 4 ? 1 : 0.5) {
    const x = (s / secs) * W;
    c.fillRect(x, WH + SH, 1, 5);
    c.fillText(`${s}s`, x + 2, WH + SH + 14);
  }
  c.fillStyle = '#fff';
  c.fillText(`${title}   peak ${r1(db(stats.pk))} dB  rms ${r1(db(stats.rms))} dB  centroid ${Math.round(stats.cen)} Hz  bands ${stats.bands.join('/')}`, 60, 11);
  $('specs').appendChild(cv);
}

async function runSpec(): Promise<void> {
  const list = (k: string): string[] => params.get(k)?.split(',').filter(Boolean) ?? [];
  const len = Number(params.get('len') ?? 0);
  const mixed = params.get('mode') === 'mix';
  for (const n of list('sfx') as SfxName[]) {
    status(`spec sfx ${n}`);
    const b = mixed ? await renderSfxMix(n) : await renderSfxDry(n);
    drawSpec(b, `sfx:${n}`, analyze(b));
  }
  for (const n of list('loop') as LoopName[]) {
    status(`spec loop ${n}`);
    const b = mixed ? await renderLoopMix(n, len || 10) : await renderLoopDry(n, len || 10);
    drawSpec(b, `loop:${n}`, analyze(b, { from: 1 }));
  }
  for (const n of list('music') as MusicMood[]) {
    status(`spec music ${n}`);
    const b = mixed ? await renderMusicMix(n, len || 20) : await renderMusicDry(n, len || 20);
    drawSpec(b, `music:${n}`, analyze(b, { from: 0.5 }));
  }
  status('spectrograms done');
}

// ── realtime playground ──────────────────────────────────────────────────────

function buildUi(): void {
  const audio = createAudio();
  const ui = $('ui');
  const mkBtn = (label: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      audio.unlock();
      fn(b);
    };
    return b;
  };
  const section = (title: string, items: HTMLElement[]): void => {
    const h = document.createElement('h2');
    h.textContent = title;
    const row = document.createElement('div');
    row.className = 'row';
    row.append(...items);
    ui.append(h, row);
  };
  const rv = { amount: 0.4, decay: 1.7 };
  const ctl = document.createElement('div');
  ctl.className = 'ctl';
  const slider = (label: string, min: number, max: number, step: number, val: number, fn: (v: number) => void): HTMLElement => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(val);
    i.oninput = () => {
      audio.unlock();
      fn(Number(i.value));
    };
    l.append(`${label} `, i);
    return l;
  };
  ctl.append(
    slider('master', 0, 1, 0.01, audio.master, (v) => (audio.master = v)),
    slider('music', 0, 1, 0.01, audio.musicVolume, (v) => (audio.musicVolume = v)),
    slider('sfx', 0, 1, 0.01, audio.sfxVolume, (v) => (audio.sfxVolume = v)),
    slider('slowmo', 0, 1, 0.01, 0, (v) => audio.setSlowmo(v)),
    slider('reverb', 0, 1, 0.01, 0.4, (v) => audio.setReverb((rv.amount = v), rv.decay)),
    slider('decay s', 0.4, 8, 0.1, 1.7, (v) => audio.setReverb(rv.amount, (rv.decay = v))),
    slider('intensity', 0, 1, 0.01, 0.5, (v) => audio.setMusicIntensity(v)),
  );
  ui.append(ctl);
  const pos = new THREE.Vector3(8, 0, -4);
  audio.setListener(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  section('SFX (click = 2D, shift-click = positional at +8,-4)', SFX_NAMES.map((n) => {
    const b = mkBtn(n, () => audio.play(n, { volume: 1 }));
    b.onclick = (e) => {
      audio.unlock();
      audio.play(n, e.shiftKey ? { pos } : {});
    };
    return b;
  }));
  const on = new Set<LoopName>();
  section('Loops (toggle)', LOOP_NAMES.map((n) => mkBtn(n, (b) => {
    if (on.has(n)) on.delete(n);
    else on.add(n);
    b.classList.toggle('on', on.has(n));
    audio.loop(n, on.has(n) ? 0.8 : 0);
  })));
  section('Music', MOOD_NAMES.map((n) => mkBtn(n, (b) => {
    audio.music(n);
    ui.querySelectorAll('.mood').forEach((e) => e.classList.remove('on'));
    b.classList.add('on');
  })));
  ui.querySelectorAll('h2')[2].nextElementSibling!.querySelectorAll('button').forEach((b) => b.classList.add('mood'));
  (window as unknown as { __audioSys: unknown; __THREE: unknown }).__audioSys = audio;
  (window as unknown as { __THREE: unknown }).__THREE = THREE;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const view = params.get('view') ?? 'report';
  window.__audioLab = { SFX_NAMES, LOOP_NAMES, MOOD_NAMES, analyze, renderSfxDry, renderSfxMix, renderLoopDry, renderLoopMix, renderMusicDry, renderMusicMix };
  if (view === 'ui') {
    buildUi();
    status('realtime playground: click anything (first click unlocks audio)');
  } else if (view === 'spec') {
    await runSpec();
  } else {
    if (typeof OfflineAudioContext === 'undefined') throw new Error('OfflineAudioContext unavailable');
    const rep = (await runReport()) as { summary: { total: number; failed: number; renderSec: number } };
    status(`report: ${rep.summary.total} renders, ${rep.summary.failed} failed, ${rep.summary.renderSec}s`);
  }
  window.__snapReady = true;
}

main().catch((e) => {
  console.error(e);
  window.__snapError = String(e?.stack || e);
});
