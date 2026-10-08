/**
 * GREENLEAF audio: fully procedural WebAudio (SFX, ambience, adaptive music). No files, no fetches.
 *
 *   const audio = createAudio();
 *   audio.unlock();                      // first user gesture (also auto-hooked to pointer/key/touch)
 *   audio.play('bow_release', { pos, volume: 0.8 });
 *   audio.loop('forest', 0.6);           // 0 fades it out
 *   audio.music('explore');
 *
 * If AudioContext is unavailable (or construction throws) every method degrades to a no-op.
 * Synthesis lives in src/core/audio/* and is written against BaseAudioContext so the lab
 * (lab/audio.html) can render it offline.
 */
import type * as THREE from 'three';
import type { AudioSys, LoopName, MusicMood, SfxName } from './types';
import { buildGraph, LoopPlayer, MusicPlayer, SfxPlayer, type Graph } from './audio/graph';

/** AudioSys plus the optional extras the shell may use */
export interface AudioSysExt extends AudioSys {
  /** room reverb: amount 0..1 (0 = dry), decay in seconds. Caves: setReverb(0.9, 5.5). Default (0.4, 1.7). */
  setReverb(amount: number, decaySec?: number): void;
  /** 0..1: more drums/horns and a faster tempo for the current mood */
  setMusicIntensity(v: number): void;
  /** true once the context is running (after a user gesture) */
  readonly ready: boolean;
  /** diagnostics for tests / the lab */
  readonly stats: { state: string; voices: number; played: number; stolen: number; loops: string[]; mood: MusicMood; time: number; slow: number };
}

const DEFAULTS = { master: 0.8, music: 0.7, sfx: 0.9 };

type ACCtor = typeof AudioContext;

export function createAudio(): AudioSysExt {
  const AC: ACCtor | undefined =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: ACCtor }).webkitAudioContext)
      : undefined;

  let ctx: AudioContext | null = null;
  let g: Graph | null = null;
  let sfx: SfxPlayer | null = null;
  let loops: LoopPlayer | null = null;
  let music: MusicPlayer | null = null;
  let dead = !AC;
  let timer: ReturnType<typeof setInterval> | null = null;

  // desired state, remembered before the context exists / is running
  let masterV = DEFAULTS.master;
  let musicV = DEFAULTS.music;
  let sfxV = DEFAULTS.sfx;
  let wantMood: MusicMood = 'none';
  let intensity = 0.5;
  const wantLoops = new Map<LoopName, number>();
  // sounds requested in the instant between unlock() and the context actually running
  const pending: { name: SfxName; opts?: Parameters<AudioSys['play']>[1]; at: number }[] = [];
  let reverbAmount = 0.4;
  let reverbDecay = 1.7;
  let slowTarget = 0;
  let slow = 0;
  let slowApplied = -1;
  let listenerPos: THREE.Vector3 | null = null;
  let listenerFwd: THREE.Vector3 | null = null;

  const running = (): boolean => !!ctx && ctx.state === 'running' && !!g;

  function applyVolumes(): void {
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    g.master.gain.setTargetAtTime(masterV, t, 0.04);
    g.musicBus.gain.setTargetAtTime(0.62 * musicV, t, 0.05);
    g.sfxBus.gain.setTargetAtTime(0.9 * sfxV, t, 0.05);
    g.ambBus.gain.setTargetAtTime(0.7 * sfxV, t, 0.05);
  }

  function applyReverb(): void {
    if (!g || !ctx) return;
    g.spaceReturn.gain.setTargetAtTime(Math.max(0, reverbAmount) * 2, ctx.currentTime, 0.1);
    g.space.setDecay(reverbDecay);
  }

  function applySlow(): void {
    if (!g || !ctx) return;
    if (Math.abs(slow - slowApplied) < 0.003) return;
    slowApplied = slow;
    const t = ctx.currentTime;
    // log-interpolated low-pass cutoffs and cents of pitch drop
    const lp = (hi: number, lo: number): number => hi * Math.pow(lo / hi, slow);
    g.sfxLP.frequency.setTargetAtTime(lp(22000, 750), t, 0.04);
    g.ambLP.frequency.setTargetAtTime(lp(22000, 2200), t, 0.04);
    g.musicLP.frequency.setTargetAtTime(lp(22000, 1500), t, 0.04);
    g.sfxDetune?.offset.setTargetAtTime(-slow * 900, t, 0.04);
    g.ambDetune?.offset.setTargetAtTime(-slow * 300, t, 0.04);
    g.musicDetune?.offset.setTargetAtTime(-slow * 420, t, 0.04);
  }

  function tick(): void {
    if (!running()) return;
    try {
      loops?.pump();
      music?.pump();
    } catch (e) {
      console.warn('[audio] tick failed', e);
    }
  }

  /** apply everything that was requested before the context was running */
  function onRunning(): void {
    if (!g || !ctx) return;
    applyVolumes();
    applyReverb();
    slowApplied = -1;
    applySlow();
    if (listenerPos && listenerFwd) sfx?.setListener(listenerPos, listenerFwd);
    for (const [n, v] of wantLoops) loops?.set(n, v);
    music?.engine.setIntensity(intensity, ctx.currentTime);
    if (wantMood !== 'none') music?.set(wantMood);
    const now = performance.now();
    for (const q of pending.splice(0)) if (now - q.at < 450) sfx?.play(q.name, q.opts);
    tick();
  }

  function ensure(): boolean {
    if (dead) return false;
    if (ctx) return true;
    try {
      ctx = new AC!({ latencyHint: 'interactive' });
      g = buildGraph(ctx);
      sfx = new SfxPlayer(g);
      loops = new LoopPlayer(g);
      music = new MusicPlayer(g);
      ctx.onstatechange = () => {
        if (ctx?.state === 'running') onRunning();
      };
      timer = setInterval(tick, 45);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!ctx) return;
          if (document.hidden) void ctx.suspend().catch(() => {});
          else if (unlocked) void ctx.resume().catch(() => {});
        });
      }
      return true;
    } catch (e) {
      console.warn('[audio] WebAudio unavailable, audio disabled', e);
      dead = true;
      ctx = null;
      g = null;
      if (timer) clearInterval(timer);
      return false;
    }
  }

  let unlocked = false;
  function unlock(): void {
    if (dead) return;
    if (!ensure() || !ctx) return;
    unlocked = true;
    if (ctx.state !== 'running') {
      ctx.resume().then(() => {
        if (ctx?.state === 'running') onRunning();
      }).catch(() => {});
    } else onRunning();
  }

  // first gesture anywhere unlocks audio, even if the shell forgets to call unlock()
  if (!dead && typeof window !== 'undefined') {
    const evs = ['pointerdown', 'keydown', 'touchend', 'mousedown', 'click'] as const;
    const hook = (): void => {
      unlock();
      if (running()) for (const e of evs) window.removeEventListener(e, hook, true);
    };
    for (const e of evs) window.addEventListener(e, hook, { capture: true, passive: true });
  }

  const api: AudioSysExt = {
    unlock,

    play(name, opts) {
      if (!running() || !sfx) {
        if (unlocked && ctx && !dead && pending.length < 8) pending.push({ name, opts, at: performance.now() });
        return;
      }
      try {
        sfx.play(name as SfxName, opts);
      } catch (e) {
        console.warn('[audio] play failed', name, e);
      }
    },

    loop(name, volume) {
      const v = Math.max(0, Math.min(1.5, volume));
      if (v <= 0.002) wantLoops.delete(name);
      else wantLoops.set(name, v);
      if (!running() || !loops) return;
      try {
        loops.set(name, v);
      } catch (e) {
        console.warn('[audio] loop failed', name, e);
      }
    },

    stopAllLoops() {
      wantLoops.clear();
      loops?.stopAll();
    },

    music(mood) {
      wantMood = mood;
      if (!running() || !music) return;
      try {
        music.set(mood);
      } catch (e) {
        console.warn('[audio] music failed', mood, e);
      }
    },

    setListener(pos, forward) {
      listenerPos = pos;
      listenerFwd = forward;
      if (running()) sfx?.setListener(pos, forward);
    },

    setSlowmo(amount) {
      slowTarget = Math.max(0, Math.min(1, amount));
    },

    setReverb(amount, decaySec) {
      reverbAmount = Math.max(0, Math.min(1.5, amount));
      if (decaySec !== undefined) reverbDecay = Math.max(0.3, Math.min(9, decaySec));
      if (running()) applyReverb();
    },

    setMusicIntensity(v) {
      intensity = Math.max(0, Math.min(1, v));
      if (running() && ctx) music?.engine.setIntensity(intensity, ctx.currentTime);
    },

    get ready() {
      return running();
    },

    get stats() {
      return {
        state: ctx?.state ?? (dead ? 'unavailable' : 'none'),
        voices: sfx?.voices.length ?? 0,
        played: sfx?.played ?? 0,
        stolen: sfx?.stolen ?? 0,
        loops: loops ? [...loops.active.keys()] : [],
        mood: music?.engine.mood ?? 'none',
        time: ctx?.currentTime ?? 0,
        slow,
      };
    },

    get master() {
      return masterV;
    },
    set master(v: number) {
      masterV = Math.max(0, Math.min(1, v));
      applyVolumes();
    },
    get musicVolume() {
      return musicV;
    },
    set musicVolume(v: number) {
      musicV = Math.max(0, Math.min(1, v));
      applyVolumes();
    },
    get sfxVolume() {
      return sfxV;
    },
    set sfxVolume(v: number) {
      sfxV = Math.max(0, Math.min(1, v));
      applyVolumes();
    },

    update(dtReal) {
      if (!running()) return;
      // smooth the slow-motion amount (frame-rate independent)
      const k = 1 - Math.exp(-9 * Math.max(0, Math.min(0.2, dtReal)));
      slow += (slowTarget - slow) * k;
      if (Math.abs(slow - slowTarget) < 0.001) slow = slowTarget;
      applySlow();
      sfx?.prune();
    },
  };
  return api;
}
