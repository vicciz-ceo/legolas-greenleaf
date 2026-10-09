/**
 * Chapter 2: The Barrel Escape (The Hobbit: The Desolation of Smaug).
 *
 *   cp0  The River Gate   Hold the water-gate walkway against Bolg's hunters, stop the saboteur
 *                         at the lever, pull it: the gate opens and the barrels are flushed out.
 *   cp1  Along the Banks  An auto-forward run down the left bank (8 m/s): jump the side-stream
 *                         clefts and boulders, shoot across the river, leap onto the barrels.
 *   cp2  Riding the Rapids Barrel hopping down ~600 m of white water under escalating ambushes, a
 *                         low-log obstacle course and the log-bridge captain; it ends in the calm
 *                         pool, where the last orc has something to say.
 *
 * File map: barrels/layout.ts (the whole course in river coordinates), world.ts (terrain, water,
 * forest, rocks), gate.ts (the water-gate), train.ts (barrels + dwarves), riders.ts (the bank-run
 * and barrel-ride PlayerMovers), orcs.ts (archers, leapers, the water's housekeeping),
 * logbridge.ts (the mini-boss).
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Enemy, EnvironmentPreset, LevelAPI } from '../../core/types';
import { ENVIRONMENTS } from '../../core/environment';
import { clamp, smoothstep, yawOf } from '../../core/math';
import { buildGorge } from './barrels/world';
import {
  CLEFTS, RUN_OFFSET, S, TRAIN_START_S, V, bankPos, flowSpeedAt, flowYaw, riverPos, shelfLeft, shelfRight, waterY, widthAt,
} from './barrels/layout';
import { BarrelTrain, STAND_H } from './barrels/train';
import { RiverFoes } from './barrels/orcs';
import { makeBankRun, makeBarrelRide, type BankRun, type BarrelRide } from './barrels/riders';
import { createLogBridge } from './barrels/logbridge';

const CHECKPOINTS = ['The River Gate', 'Along the Banks', 'Riding the Rapids'];

/** the gorge's mist: thick enough to read as a misty morning, thin enough that the far bank and the log bridge are seen */
const FOG_BASE = 0.0086;
/** at the log bridge the mist lifts a little more so the captain and his crew can be read from 90 m */
const FOG_LOG = 0.0066;

type Beat = 'intro' | 'gate' | 'saboteur' | 'lever' | 'cinema' | 'run' | 'leap' | 'ride' | 'pool' | 'outro';

/** the forest river on a bright, misty overcast morning, with the sun low ahead of the camera for rim light */
function riverEnvironment(): EnvironmentPreset {
  const base = ENVIRONMENTS.forest_river;
  return {
    ...base,
    sky: base.sky.kind === 'physical' ? { ...base.sky, elevation: 27, azimuth: 28, clouds: 0.9 } : base.sky,
    sunIntensity: 2.9,
    fog: { color: 0xb6cdc6, density: FOG_BASE },
    weather: 'dust',
    weatherIntensity: 0.35,
  };
}

export const chapter: ChapterDef = {
  id: 'barrels',
  number: 2,
  title: 'The Barrel Escape',
  film: 'The Hobbit: The Desolation of Smaug',
  blurb: 'Bolg\'s hunters have found the Forest River. Hold the Elvenking\'s water-gate, run the bank beside the barrels, then hop the dwarves\' heads down the white water with orcs on both banks.',
  environment: 'forest_river',
  checkpoints: CHECKPOINTS,
  parTime: 300,
  // every humanoid kind this chapter spawns: tauriel (ally), dwarf (the barrel passengers), orc (+ archers), gundabad (the captain, the saboteur)
  preload: ['tauriel', 'dwarf', 'orc', 'gundabad'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const { player, audio, hud, input, fx } = ctx;
    const quick = ctx.flags.skipIntro === '1';
    const bot = ctx.flags.bot === '1';

    level.setEnvironment(riverEnvironment());

    // ── the world and the actors that live in it ──
    const gorge = buildGorge(level);
    const gate = gorge.gate;
    const train = new BarrelTrain(level, { headS: TRAIN_START_S, holdS: S.gate - 5, count: 12 });
    const foes = new RiverFoes(level, gorge, train);
    const logBridge = createLogBridge(level, gorge, train, foes);
    const h = gorge.heightAt;

    // ── script state, read by botHint() ──
    let beat: Beat = 'intro';
    let run: BankRun | null = null;
    let ride: BarrelRide | null = null;
    let tauriel: Ally | null = null;
    let tauriBarrel = -1;
    const tauriAnchor = new THREE.Vector3();
    let leverPulled = false;
    let leverRequested = false;
    let saboteur: Enemy | null = null;
    let saboProgress = 0;
    let rideT = 0;
    let slowLog = 0;
    let logStarted = false;
    let taughtHop = false;
    let taughtBoarder = false;
    let finishing = false;
    let lastQuip = -99;

    const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const worldAtGate = (u: number, v: number, y = gate.topY) => gate.at(u, v, y);

    // ─────────────────────────────────────────────────────────────────────────
    // always-on per-frame work
    // ─────────────────────────────────────────────────────────────────────────
    level.onUpdate((dt) => {
      train.update(dt);
      foes.update(dt);
      easeFog(dt);
      logBridge.update(dt);
      controlConvoy(dt);
      updateTauriel();
      // nobody gets lost beneath the gate: the walkway is rail-fenced, but a hard fall puts him back
      if ((beat === 'gate' || beat === 'saboteur' || beat === 'lever') && !player.mover && player.position.y < gate.topY - 3.5 && Math.hypot(player.position.x - gate.centre.x, player.position.z - gate.centre.z) < 14) {
        player.teleport(V3(gate.leverStand.x, gate.topY, gate.leverStand.z), gate.yaw);
      }
      if (beat === 'ride') {
        rideT += dt;
        runEvents();
        ridePrompts();
      }
      if (run && (beat === 'run' || beat === 'leap')) runPrompts();
    });

    // the mist lifts toward the log bridge (the engine's exponential fog is read every frame by the post and fx passes)
    let fogNow = FOG_BASE;
    function easeFog(dt: number): void {
      const f = ctx.engine.scene.fog as THREE.FogExp2 | null;
      if (!f || !f.isFogExp2) return;
      const lead = train.sLead;
      const k = train.running ? smoothstep(S.log - 150, S.log - 100, lead) * (1 - smoothstep(S.log + 30, S.log + 90, lead)) : 0;
      const want = beat === 'outro' ? 0.0052 : beat === 'pool' ? 0.0066 : FOG_BASE + (FOG_LOG - FOG_BASE) * k;
      fogNow += (want - fogNow) * Math.min(1, dt * 1.5);
      f.density = fogNow;
    }

    /** the convoy follows the runner on the bank, the log bridge slows it, the pool eases it */
    function controlConvoy(dt: number): void {
      void dt;
      if (!train.running) return;
      const v0 = Math.max(1, flowSpeedAt(train.sLead));
      if (beat === 'run' && run) {
        const want = v0 + (run.s + 8 - train.sLead) * 0.9;
        train.speedMul = clamp(want / v0, 0.3, 2.1);
      } else if (beat === 'leap') {
        train.endBias = 0.7; // the barrels hug the left bank under the launch rock
        const want = v0 + (S.runEnd + 5 - train.sLead) * 1.1;
        train.speedMul = clamp(want / v0, 0.12, 1.4);
      } else if (beat === 'ride') {
        // the chute under the log bridge: the river slows so the fight has room, then runs again
        const lead = train.sLead;
        train.endBias = 0;
        let k = logStarted ? smoothstep(S.log - 110, S.log - 70, lead) * (1 - smoothstep(S.log + 4, S.log + 30, lead)) : 0;
        if (logBridge.resolved) k *= 0.3;
        slowLog = k;
        train.speedMul = 1 - k * 0.48;
      } else if (beat === 'pool') {
        const ease = smoothstep(S.pool - 20, S.end - 20, train.sLead);
        train.speedMul = 1 - ease * 0.3;
        train.endBias = smoothstep(S.pool, S.end - 30, train.sLead);
      }
    }

    function updateTauriel(): void {
      if (!tauriel || tauriBarrel < 0) return;
      const b = train.barrels[tauriBarrel];
      tauriAnchor.copy(b.stand);
      tauriel.anchor = tauriAnchor;
      b.rider = 'ally';
      if (tauriel.position.y < b.stand.y - 1.1 || Math.hypot(tauriel.position.x - b.stand.x, tauriel.position.z - b.stand.z) > 2.6) {
        tauriel.position.copy(b.stand);
        tauriel.velocity.set(0, 0, 0);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** place the player at the top of the gate stairs facing downstream */
    function atGateTop(): void {
      const p = gate.stairTop;
      player.teleport(V3(p.x, gate.topY, p.z + 0.4), gate.yaw);
      player.camera.yaw = gate.yaw;
    }

    function animate(seconds: number, fn: (t: number) => void): Promise<void> {
      let t = 0;
      const stop = level.onUpdate((dt) => {
        t = Math.min(1, t + dt / seconds);
        fn(t);
      });
      return level.wait(seconds).then(() => {
        stop();
        fn(1);
      });
    }

    function spawnTauriel(near: THREE.Vector3, facing: number): void {
      tauriel = level.spawnAlly({ kind: 'tauriel', name: 'Tauriel', anchor: 'player' }, near, facing);
    }

    /** a toast-sized hint line with a prompt glyph */
    function hint(action: 'interact' | 'jump' | 'melee' | 'focus' | 'draw' | null, text?: string): void {
      hud.setPrompt(action, text);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // cp0: the river gate
    // ─────────────────────────────────────────────────────────────────────────

    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true);
      // above the pool, looking at the closed gate; a slow dolly in
      const wl = waterY(S.gate);
      level.cameraShot({ position: worldAtGate(0, -38, wl + 6.8), lookAt: worldAtGate(0, -4, gate.topY - 1.2), fov: 56, blend: 0 });
      await level.wait(0.4);
      await level.wait(0.08);
      level.cameraShot({ position: worldAtGate(0, -29, wl + 5.6), lookAt: worldAtGate(0, -4, gate.topY - 1.2), fov: 54, blend: 3.2 });
      await level.wait(2.4);
      // cut: among the barrels, the dwarves bobbing in their barrels
      // (seen from the closed doors, looking back up the line of barrels: heads and hats, the cellar arch beyond)
      level.cameraShot({ position: worldAtGate(1.4, -3.4, wl + 2.2), lookAt: worldAtGate(-0.6, -15, wl + 1.0), fov: 48, blend: 0 });
      await level.wait(0.08);
      level.cameraShot({ position: worldAtGate(0.4, -4.6, wl + 1.9), lookAt: worldAtGate(-0.6, -15, wl + 1.1), fov: 42, blend: 4 });
      await level.say('Legolas', 'Bolg\'s hunters have found the river. The dwarves are in the barrels, below the gate.', 3.6);
      // cut: Tauriel on the walkway, seen from the stairs
      level.cameraShot({ position: worldAtGate(9.6, 11.5, gate.topY - 2.2), lookAt: worldAtGate(3.2, 0.3, gate.topY + 1.4), fov: 42, blend: 0 });
      await level.wait(0.08);
      level.cameraShot({ position: worldAtGate(9.2, 10.5, gate.topY - 1.8), lookAt: worldAtGate(3.6, 0.3, gate.topY + 1.5), fov: 40, blend: 4 });
      await level.say('Tauriel', 'Then we hold the walkway until the water takes them clear. Nothing reaches that lever.', 3.6);
      level.cameraShot(null);
      await level.wait(0.7);
      level.cinematic(false);
    }

    /** an orc that has to climb the stairs: walk to the stair head first, then fight */
    function stairOrc(e: Enemy): Enemy {
      return foes.route(e, gate.stairRoute);
    }

    async function gateWaves(): Promise<void> {
      beat = 'gate';
      level.objective('Hold the walkway');
      level.music?.('tension');
      const foot = (k: number) => ({ s: 100 + k * 2.2, e: 3.4 + (k % 2) * 1.6 });
      // wave 1: three orcs up the stairs, two archers on the far ledge
      const first: Enemy[] = [];
      void (async () => {
        for (let k = 0; k < 3; k++) {
          if (k) await level.wait(2.4);
          const f = foot(k);
          first.push(stairOrc(foes.bankOrc('L', f.s, f.e, 'orc')));
        }
      })();
      // the archers across the water keep shooting; the stair orcs are what has to fall
      for (let i = 0; i < 2; i++) foes.archer('R', 94 + i * 5, 2.6 + i, {});
      await level.waitUntil(() => first.length === 3 && first.every((e) => !e.alive), 70);
      // the saboteur
      beat = 'saboteur';
      level.objective('Stop the orc at the lever');
      await level.say('Tauriel', 'That one means to cut the chain! Stop him!', 2.4);
      const sab = foes.bankOrc('L', 100, 4.2, 'gundabad', { name: 'Chain-cutter', hp: 170, target: gate.leverStand.clone() });
      saboteur = sab;
      // a hovering red diamond over his head, so he can be picked out among the crowd on the stairs
      const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0xff4b2a, fog: false, depthTest: false, transparent: true, opacity: 0.9 }));
      mark.scale.y = 1.6;
      mark.renderOrder = 6;
      mark.userData.noAO = true;
      sab.object.add(mark);
      foes.route(sab, [...gate.stairRoute, gate.leverStand.clone().add(V3(0.4, 0, 0.6))]);
      for (let i = 0; i < 2; i++) {
        const e = foes.bankOrc('L', 104 + i * 2.4, 3.2 + i * 1.4, 'orc');
        stairOrc(e);
      }
      foes.archer('R', 100, 3, {});
      // march him: stair head, then the lever
      const stop = level.onUpdate((dt) => {
        mark.visible = sab.alive;
        mark.position.set(0, sab.height + 0.55 + Math.sin(ctx.time.t * 4) * 0.06, 0);
        mark.rotation.y += dt * 2.2;
        if (!sab.alive) return;
        // once up the stairs he goes for the chain and stays on it; only a foe within arm's reach (the engine's own rule) draws him off
        if (!foes.onRoute(sab) && !sab.moveTarget && Math.hypot(sab.position.x - gate.leverPos.x, sab.position.z - gate.leverPos.z) > 1.6) {
          sab.moveTarget = gate.leverStand.clone().add(V3(0.4, 0, 0.5));
        }
        // sabotage progress while he stands at the lever
        const d = Math.hypot(sab.position.x - gate.leverPos.x, sab.position.z - gate.leverPos.z);
        if (d < 3.2 && Math.abs(sab.position.y - gate.topY) < 1.2) saboteurNear += dt;
        else saboteurNear = Math.max(0, saboteurNear - dt * 0.8);
        saboProgress = clamp(saboteurNear / 14, 0, 1);
        hud.setProgress(saboProgress > 0.02 ? 'The chain is being cut' : null, saboProgress);
        if (saboProgress >= 1) {
          if (ctx.flags.god !== '1') level.fail('The chain was cut. The gate would not open.');
          else saboteurNear = 0;
        }
      });
      await level.waitUntil(() => !sab.alive, 90);
      stop();
      sab.object.remove(mark);
      mark.geometry.dispose();
      (mark.material as THREE.Material).dispose();
      hud.setProgress(null);
      saboteurNear = 0;
      // anyone left on the walkway or the stairs
      const near = () => level.enemiesAlive((c) => Math.hypot(c.position.x - gate.leverStand.x, c.position.z - gate.leverStand.z) < 15 && c.position.y > gate.topY - 4.5);
      await level.waitUntil(() => near() === 0, 30);
    }
    let saboteurNear = 0;

    async function leverBeat(): Promise<void> {
      beat = 'lever';
      level.objective('Pull the lever');
      level.music?.(null);
      const stop = level.onUpdate(() => {
        const near = Math.hypot(player.position.x - gate.leverStand.x, player.position.z - gate.leverStand.z) < 3.4 && Math.abs(player.position.y - gate.topY) < 1.5;
        hint(near && !leverRequested ? 'interact' : null, 'Pull the lever');
        input.setInteractLabel(near && !leverRequested ? 'Lever' : null);
        if (near && input.state.interact) leverRequested = true;
      });
      await level.waitUntil(() => leverRequested);
      stop();
      hint(null);
      input.setInteractLabel(null);
      await openGate();
    }

    async function openGate(): Promise<void> {
      beat = 'cinema';
      leverPulled = true;
      level.objective(null);
      level.cinematic(true);
      const stand = gate.leverStand;
      player.teleport(V3(stand.x, gate.topY, stand.z), gate.yaw + Math.PI);
      level.cameraShot({ position: worldAtGate(0.4, -6.5, gate.topY + 1.9), lookAt: worldAtGate(-2.6, -0.1, gate.topY + 1.5), fov: 44, blend: 0.9 });
      await level.wait(0.8);
      audio.play('chain_rattle', { pos: gate.leverPos, volume: 1 });
      await animate(1.3, (t) => gate.setLever(smoothstep(0, 1, t)));
      // the doors: a long groan, then the water takes the dwarves
      level.cameraShot({ position: worldAtGate(-9, 15, waterY(S.gate) + 2.2), lookAt: worldAtGate(0, -3, waterY(S.gate) + 2.0), fov: 54, blend: 1.4 });
      audio.play('stone_crumble', { pos: gate.centre, volume: 0.7, pitch: 0.6 });
      player.camera.shake(0.2, 1.4);
      await animate(2.8, (t) => gate.setOpen(smoothstep(0, 1, t)));
      train.release();
      audio.loop('rapids', 0.45);
      await level.say('Tauriel', 'Go, Legolas! Run the bank beside them. I will be right behind you.', 3.0);
      await level.wait(1.0);
      level.cameraShot(null);
      level.cinematic(false);
      tauriel?.gesture('point');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // cp1: along the banks
    // ─────────────────────────────────────────────────────────────────────────

    function runEnemies(): void {
      // watch for the run's s and spawn the gauntlet ahead of the runner
      const fired = new Set<string>();
      level.onUpdate(() => {
        if (beat !== 'run' || !run) return;
        const s = run.s;
        const once = (key: string, at: number, fn: () => void) => {
          if (s >= at && !fired.has(key)) {
            fired.add(key);
            fn();
          }
        };
        once('a1', 96, () => {
          foes.archer('R', 108, 3, {});
          foes.archer('R', 114, 5, {});
        });
        once('a2', 112, () => {
          for (let i = 0; i < 3; i++) foes.bankOrc('L', 152 + i * 3, 3 + (i % 2) * 2, 'orc');
        });
        once('a3', 140, () => {
          for (let i = 0; i < 3; i++) foes.archer('R', 188 + i * 4, 2.5 + i * 1.2, {});
        });
        once('a4', 170, () => {
          for (let i = 0; i < 2; i++) foes.bankOrc('L', 214 + i * 4, 3.4 + i, 'orc');
          foes.archer('R', 234, 3, {});
        });
        once('a5', 196, () => {
          foes.archer('L', 250, 2, {});
        });
      });
    }

    function runPrompts(): void {
      if (!run) return;
      if (run.cleftSoon) hint('jump', run.falls >= 2 ? 'Jump now: over the cleft!' : 'Jump the cleft!');
      else if (run.state === 'wait') hint('jump', 'Leap onto a barrel!');
      else if (beat === 'run') hint(null);
    }

    async function bankRun(): Promise<void> {
      beat = 'run';
      level.objective('Follow the barrels along the bank');
      hud.toast('Run the bank. Jump the clefts.', 'info');
      atGateTop();
      run = makeBankRun(level, S.gate);
      player.mover = run;
      runEnemies();
      // (no timeout: a runner who keeps dropping into a cleft is helped over it, see riders.ts; he must never be skipped ahead)
      await level.waitUntil(() => run!.state === 'wait', 900);
      // at the launch rock
      beat = 'leap';
      level.objective('Leap onto the barrels');
      // the bot and the impatient: a prompt, then the leap
      await level.waitUntil(() => run!.leapRequested || (bot && run!.waited > 2.2), 40);
      hint(null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // cp2: riding the rapids
    // ─────────────────────────────────────────────────────────────────────────

    /** the barrel the leap from the rock targets: a free barrel about to pass the ledge */
    function leapTarget(from: THREE.Vector3) {
      return train.nearest(from, (b) => b.rider === null && !b.smashed) ?? train.barrels[0];
    }

    function beginRide(b = leapTarget(player.position), fromBank = true): BarrelRide {
      const r = makeBarrelRide(level, train, { barrel: b, pos: fromBank ? player.position.clone() : undefined });
      level.root.add(r.ring);
      r.setHooks({
        onLand: () => {
          if (!taughtHop) {
            taughtHop = true;
            hud.toast('Left/right + Jump hops to that barrel. Jump alone: ahead, or in place', 'info');
            return;
          }
          // the dwarves have opinions about being used as stepping stones (rarely, so it stays a joke)
          if (ctx.time.t - lastQuip > 22 && level.rng() < 0.35) {
            lastQuip = ctx.time.t;
            const lines = ['Mind the hat, elf!', 'Boots off the beard!', 'Is that an elf on my head?', 'I can float perfectly well without a footman!'];
            void level.say('Dwarf', lines[Math.floor(level.rng() * lines.length)], 2.0);
          }
        },
        onSplash: (reason) => {
          hud.toast(reason === 'log' ? 'Knocked off by the log! Jump when it comes.' : 'Into the river!', 'warning');
        },
      });
      ride = r;
      player.mover = r;
      return r;
    }

    // ambushes, triggered by the barrel the player rides
    interface Ev {
      at: number;
      done: boolean;
      fn: () => void;
    }
    const events: Ev[] = [];
    const ev = (at: number, fn: () => void) => events.push({ at, done: false, fn });

    function archersRight(sC: number, n: number): void {
      for (let i = 0; i < n; i++) {
        const s = sC + (i - (n - 1) / 2) * 3.4;
        const w = Math.max(1.2, shelfRight(s) - 0.9);
        foes.archer('R', s, 0.8 + (i % 2) * Math.min(2.5, w), {});
      }
    }
    function archersLeft(sC: number, n: number): void {
      for (let i = 0; i < n; i++) {
        const s = sC + (i - (n - 1) / 2) * 3.8;
        const w = Math.max(1.4, shelfLeft(s) - 0.9);
        foes.archer('L', s, 0.9 + (i % 2) * Math.min(2.2, w), {});
      }
    }
    function leapers(sC: number, n: number, side: 'L' | 'R' | 'both'): void {
      for (let i = 0; i < n; i++) {
        const sd = side === 'both' ? (i % 2 ? 'R' : 'L') : side;
        const s = sC + i * 4.4;
        const w = sd === 'L' ? shelfLeft(s) : shelfRight(s);
        foes.leaper(sd, s, 0.8 + Math.min(1.8, Math.max(0, w - 1.2)) * 0.5, {});
      }
    }

    function buildEvents(): void {
      // the first ambush: archers on the left shelf and the far ledge, then two boarders
      ev(240, () => {
        archersRight(268, 3);
        archersLeft(282, 2);
        void level.say('Legolas', 'Archers on both banks! Keep moving!', 2.2);
      });
      ev(262, () => leapers(300, 2, 'L'));
      ev(290, () => {
        leapers(322, 2, 'R');
        void level.say('Tauriel', 'They are jumping for the barrels!', 2.0);
      });
      ev(318, () => {
        archersRight(352, 3);
        leapers(344, 2, 'L');
      });
      ev(352, () => {
        archersRight(392, 3);
        for (let i = 0; i < 2; i++) foes.bankOrc('L', 400 + i * 4, 1.6, 'orc');
        leapers(386, 2, 'both');
      });
      ev(S.log - 92, () => {
        logStarted = true;
        logBridge.begin();
        void level.say('Tauriel', 'The bridge! Cut its lashings before we pass beneath it!', 3.0);
      });
      ev(S.log + 40, () => {
        archersRight(520, 3);
        archersLeft(530, 2);
        leapers(548, 3, 'both');
      });
      ev(S.log + 112, () => {
        leapers(566, 2, 'L');
        archersRight(592, 3);
        archersLeft(604, 2);
      });
      ev(S.log + 170, () => {
        for (let i = 0; i < 3; i++) foes.bankOrc('R', 640 + i * 4, 0.8, 'orc');
        leapers(636, 3, 'both');
        archersRight(668, 3);
      });
      ev(S.pool - 24, () => {
        archersRight(692, 2);
        void level.say('Legolas', 'The river widens. Nearly through.', 2.4);
      });
      // the pool is not a rest: the last of the hunters have run the shingle to catch the convoy
      ev(S.pool + 4, () => {
        archersLeft(726, 3);
        for (let i = 0; i < 2; i++) foes.bankOrc('L', 736 + i * 5, 0.9 + i, 'orc');
        void level.say('Tauriel', 'More of them on the shingle. Do not slow down.', 2.4);
      });
    }

    function runEvents(): void {
      if (!ride) return;
      const s = ride.cur.s;
      for (const e of events) {
        if (!e.done && s >= e.at) {
          e.done = true;
          e.fn();
        }
      }
    }

    function ridePrompts(): void {
      if (!ride) return;
      if (ride.state === 'on' && ride.wantsJump) {
        hint('jump', 'Jump the log!');
        return;
      }
      // a boarder next to him
      const boarder = foes.riders().find((r) => Math.hypot(r.position.x - player.position.x, r.position.z - player.position.z) < 3.4);
      if (boarder && ride.state === 'on') {
        if (!taughtBoarder) {
          taughtBoarder = true;
          hud.toast('A boarder! Knife him or shoot him down.', 'info');
        }
        hint('melee', 'Knife the boarder');
        return;
      }
      if (logBridge.lashingsLive && logBridge.phase !== 'idle' && !logBridge.resolved) {
        hint(null);
        return;
      }
      hint(null);
    }

    async function rideBeat(): Promise<void> {
      beat = 'ride';
      level.objective('Stay on the barrels. Left/right + Jump to hop');
      level.music?.(null);
      audio.loop('rapids', 0.8);
      await level.say('Legolas', 'Keep your heads down, Master Dwarves!', 2.0);
      await level.say('Dwarf', 'We are in barrels, elf. Where else would they be?', 2.6);
      level.objective('Ride the rapids');
      await level.waitUntil(() => train.sLead >= S.log - 90, 160);
      // the chute: wait for the captain to be dealt with or passed
      await level.waitUntil(() => logBridge.resolved || train.sLead >= S.log + 34, 120);
      level.objective('Ride the rapids');
      await level.waitUntil(() => train.sLead >= S.pool, 200);
    }

    async function poolBeat(): Promise<void> {
      beat = 'pool';
      level.objective('Reach the shingle bank');
      audio.loop('rapids', 0.2);
      await level.waitUntil(() => train.sLead >= S.end - 50, 70);
      // the last hunters on the strand are dealt with before the barrels touch the shingle (but he is never held up for long)
      await level.waitUntil(() => level.enemiesAlive((c) => c.name !== 'Rope lashing') === 0, 6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // the outro on the shingle
    // ─────────────────────────────────────────────────────────────────────────

    async function outro(): Promise<void> {
      beat = 'outro';
      finishing = true;
      audio.loop('rapids', 0);
      level.objective(null);
      hint(null);
      level.cinematic(true);
      level.boss(null);
      // nothing left of the fight follows him ashore
      for (const c of Array.from(ctx.combatants.byTeam('enemy'))) if (c.alive) foes.drop(c as Enemy);
      // ashore: Legolas and Tauriel on the wet shingle, the survivor dragging himself out of the shallows
      const at = (s: number, e: number): THREE.Vector3 => {
        const p = bankPos(s, e);
        p.y = h(p.x, p.z);
        return p;
      };
      const SC = S.end - 24; // the scene's s
      const shore = at(SC - 6, 6.2);
      const sv = at(SC + 4, 0.9);
      const tpos = at(SC - 8.5, 8.0);
      player.mover = null;
      if (ride) ride.ring.visible = false;
      const faceSv = yawOf(sv.x - shore.x, sv.z - shore.z);
      player.teleport(shore, faceSv);
      const survivor = level.spawnEnemy({ archetype: 'orc', name: 'Orc survivor', hp: 30, weapon: 'none' }, sv, yawOf(shore.x - sv.x, shore.z - sv.z));
      survivor.aiEnabled = false;
      survivor.team = 'neutral';
      survivor.targetable = false;
      survivor.hp = 12;
      survivor.playPose?.('kneel', 90);
      if (!tauriel) spawnTauriel(tpos, faceSv);
      else {
        tauriBarrel = -1;
        tauriel.anchor = tpos.clone();
        tauriel.position.copy(tpos);
        tauriel.velocity.set(0, 0, 0);
      }
      tauriel!.aiEnabled = false;
      const wl = waterY(SC);
      // the camera works from the water: wet gravel in the foreground, the group on the strand, the forest behind
      const cam = (s: number, e: number, dy: number): THREE.Vector3 => {
        const p = bankPos(s, e);
        p.y = Math.max(h(p.x, p.z), wl) + dy;
        return p;
      };
      const look = (v: THREE.Vector3, dy: number): THREE.Vector3 => v.clone().add(V3(0, dy, 0));
      const mid = at(SC - 1, 4);
      level.cameraShot({ position: cam(SC - 2, -12, 2.1), lookAt: look(mid, 0.9), fov: 36, blend: 0 });
      await level.wait(0.8);
      level.cameraShot({ position: cam(SC - 1, -8.5, 1.6), lookAt: look(mid, 1.0), fov: 34, blend: 3.0 });
      await level.wait(0.9);
      // the survivor: from over Legolas' shoulder, the water at his back
      level.cameraShot({ position: cam(SC - 3.4, 7.6, 1.3), lookAt: look(sv, 0.85), fov: 33, blend: 1.2 });
      await level.say('Orc', 'Run, elf. The mountain wakes, and the war comes down with it.', 3.4);
      // Legolas: low from the water, the trees and Tauriel behind him
      level.cameraShot({ position: cam(SC + 0.4, 2.0, 1.45), lookAt: look(shore, 1.5), fov: 32, blend: 1.0 });
      await level.say('Legolas', 'Then it will find us on the lake, and not on the road.', 3.0);
      level.cameraShot({ position: cam(SC - 2, -13, 2.8), lookAt: look(mid, 1.3), fov: 42, blend: 1.4 });
      await level.say('Tauriel', 'The dwarves go to Lake-town. So do we.', 2.6);
      level.cameraShot(null);
      level.cinematic(false);
      level.complete();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // the screenplay
    // ─────────────────────────────────────────────────────────────────────────

    async function runScript(from: number): Promise<void> {
      buildEvents();
      // dev shortcut: ?cp=2&outro=1 jumps straight to the shingle bank
      if (from >= 2 && ctx.flags.outro === '1') {
        train.jumpTo(S.end - 40);
        await outro();
        return;
      }
      if (from <= 0) {
        await intro();
        await gateWaves();
        await leverBeat();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await bankRun();
        // the leap
        const b = leapTarget(player.position);
        beginRide(b, true);
        await level.waitUntil(() => ride!.state === 'on', 4);
        level.checkpoint(2);
        spawnTaurielOnBarrel();
      } else beginRideAtCheckpoint();
      await rideBeat();
      await poolBeat();
      await outro();
    }

    function spawnTaurielOnBarrel(): void {
      if (tauriel && tauriBarrel >= 0) return;
      if (tauriel) {
        // she covered the stairs while he ran: now she joins him on the water
        level.removeCombatant(tauriel);
        tauriel = null;
      }
      // the barrel behind Legolas
      const mine = ride!.cur;
      let best = -1;
      let bd = 1e9;
      for (const b of train.barrels) {
        if (b === mine || b.rider !== null) continue;
        const d = Math.hypot(b.stand.x - mine.stand.x, b.stand.z - mine.stand.z);
        if (d > 1.8 && d < bd) {
          bd = d;
          best = b.idx;
        }
      }
      if (best < 0) return;
      tauriBarrel = best;
      const b = train.barrels[best];
      tauriel = level.spawnAlly({ kind: 'tauriel', name: 'Tauriel', anchor: b.stand.clone() }, b.stand.clone(), flowYaw(b.s));
      fx.splash(b.stand, 1.2);
      void level.say('Tauriel', 'Behind you, Legolas!', 1.8);
    }

    function beginRideAtCheckpoint(): void {
      // resume in the rapids: the convoy is already running with its head at the launch rock
      train.jumpTo(S.runEnd + 6);
      const mid = train.barrels[Math.min(train.barrels.length - 1, 4)];
      beginRide(mid, false);
      spawnTaurielOnBarrel();
      hud.toast('Left/right + Jump hops to that barrel. Jump alone: ahead, or in place', 'info');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // the instance
    // ─────────────────────────────────────────────────────────────────────────
    return {
      start(cp: number): void {
        if (cp <= 0) {
          // on the walkway over the gate, looking down the gorge; Tauriel covers the stair head
          const p = worldAtGate(1.6, 0.2);
          player.teleport(V3(p.x, gate.topY, p.z), gate.yaw);
          player.camera.yaw = gate.yaw;
          const tp = worldAtGate(5.0, 0.4);
          spawnTauriel(V3(tp.x, gate.topY, tp.z), gate.yaw + Math.PI / 2);
        } else {
          gate.setOpen(1);
          gate.setLever(1);
          leverPulled = true;
          audio.loop('rapids', 0.45);
          if (cp === 1) {
            train.release();
            const tp = worldAtGate(4.4, 0.8);
            spawnTauriel(V3(tp.x, gate.topY, tp.z), gate.yaw);
            atGateTop();
          }
        }
        void leverPulled;
        void finishing;
        void waterY;
        void widthAt;
        void CLEFTS;
        void RUN_OFFSET;
        void STAND_H;
        void V;
        void riverPos;
        void saboteur;
        void gate;
        void shelfLeft;
        void shelfRight;
        void bot;
        void fx;
        void h;
        void run;
        void tauriBarrel;
        void rideT;
        void slowLog;
        void logStarted;
        void saboProgress;
        void leverRequested;
        void yawOf;
        void quick;
        void runScript(cp);
      },

      update(): void {},

      botHint() {
        switch (beat) {
          case 'gate':
          case 'saboteur':
            return { moveTo: worldAtGate(1.6, 0.4) };
          case 'lever': {
            const d = Math.hypot(player.position.x - gate.leverStand.x, player.position.z - gate.leverStand.z);
            return { moveTo: gate.leverStand, interact: d < 3.0 };
          }
          case 'run': {
            if (!run) return null;
            const p = bankPos(run.s + 24, RUN_OFFSET);
            return { moveTo: p, jump: run.wantsJump };
          }
          case 'leap': {
            const p = bankPos(S.runEnd + 10, RUN_OFFSET);
            return { moveTo: p, jump: true };
          }
          case 'ride':
          case 'pool': {
            if (!ride) return null;
            const p = riverPos(ride.cur.s + 24, 0, STAND_H);
            return { moveTo: p, jump: ride.wantsJump };
          }
          default:
            return null;
        }
      },
    };
  },
};
