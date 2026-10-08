/**
 * Chapter 9: The Black Gate (The Return of the King).
 *
 * The last army of the West holds two bare hills before the Morannon while the Ring-bearer goes on
 * alone. The hosts of Mordor pour out of the gate and close the ring.
 *
 *   cp0 The Gate Opens  the Black Gate grinds open (shake, sound, dust), the hosts surge out and
 *                       encircle the hills (thousands: detailed crowds in front, silhouette hordes
 *                       behind). "For Frodo." Four waves of orcs and Easterlings (spears, shields).
 *   cp1 The Trolls      three armoured war trolls wade in. One pins Gimli: bring it down within 30 s
 *                       or Gimli is wounded and the bonus is lost.
 *   cp2 The Last Stand  hold the hill for 120 s against escalating waves while Fell Beasts wheel
 *                       overhead and dive. "The Eagles are coming!": the Great Eagles bring down the
 *                       Nazgul, Sauron falls (a flash on the horizon, the ground shakes, Barad-dur
 *                       collapses, the towers of the Gate crack), the hosts break and flee. The
 *                       whole-war count with banter, then complete() (the shell rolls the credits).
 *
 * Helpers (black_gate/): layout (coordinates, terrain), world (the level), hosts + horde (the armies),
 * landmarks (Orodruin, Barad-dur, the sky effects), env (lighting), air (Fell Beasts and Eagles in
 * flight), cast (spec factories), finale (the ending). Creatures: src/creatures/eagle.ts and
 * fellbeast.ts (+ .lab.ts).
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Combatant, Enemy, EnemySpec, LevelAPI } from '../../core/types';
import { clamp, dirFromYaw, smoothstep } from '../../core/math';
import { FellBeast } from '../../creatures/fellbeast';
import { WAR } from './black_gate/env';
import { buildBlackGate } from './black_gate/world';
import { Sky, type BeastCtl } from './black_gate/air';
import { easterling, orc, orcArcher, spawnSoldiers, warTroll } from './black_gate/cast';
import { eaglesArrive, eaglesStrike, finalTally, sauronFalls, type FinaleCtx } from './black_gate/finale';
import { FIGHT, L, NORTH, V } from './black_gate/layout';

const CHECKPOINTS = ['The Gate Opens', 'The Trolls', 'The Last Stand'];
/** seconds to hold the hill in the last stand */
const STAND_SECONDS = 120;
/** seconds to free Gimli from the pinning troll */
const PIN_SECONDS = 30;

export const chapter: ChapterDef = {
  id: 'black_gate',
  number: 9,
  title: 'The Black Gate',
  film: 'The Return of the King',
  blurb: 'Before the Morannon the last army of the West stands on two bare hills. The Gate opens, the hosts of Mordor close the ring, and the Ring-bearer must be given time.',
  environment: 'black_gate',
  checkpoints: CHECKPOINTS,
  parTime: 480,
  rivalry: true,
  preload: ['gimli', 'aragorn', 'gondor', 'rohirrim', 'orc', 'easterling', 'troll'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1' && ctx.flags.bgslow !== '1';

    level.setEnvironment(WAR);
    const world = buildBlackGate(level);
    const ground = world.ground;
    const sky = new Sky(level, ground);
    if (ctx.flags.bgdebug) (globalThis as unknown as { __bg: unknown }).__bg = { world, level, sky, beat: () => beat };

    // ── script state, read by botHint() ──
    type Beat = 'intro' | 'gate' | 'waves' | 'trolls' | 'pin' | 'stand' | 'eagles' | 'fall' | 'outro';
    let beat: Beat = 'intro';
    let gimli: Ally | null = null;
    let aragorn: Ally | null = null;
    let soldiers: Ally[] = [];
    let pinTroll: Enemy | null = null;
    const hint = new THREE.Vector3();
    const G = (p: THREE.Vector3) => V(p.x, ground(p.x, p.z), p.z);
    const infantry = (c: Combatant): boolean => c.team === 'enemy' && !(c instanceof FellBeast);
    const alive = () => level.enemiesAlive(infantry);

    // ── helpers ──────────────────────────────────────────────────────────

    function spawnAllies(cp: number): void {
      const at = L.spawn;
      gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: 'player' }, G(V(at.x - 3, 0, at.z - 2)), NORTH);
      ctx.rivalry.autoGimli = true;
      aragorn = level.spawnAlly({ kind: 'aragorn', name: 'Aragorn', anchor: cp === 0 ? G(L.aragorn) : 'player' }, G(V(at.x + 3.5, 0, at.z - 2.5)), NORTH);
      soldiers = spawnSoldiers(level, ground, NORTH);
    }

    /** teleport an NPC (they have no public warp) */
    const warp = (c: Combatant, p: THREE.Vector3, facing?: number) => {
      c.object.position.copy(p);
      c.velocity.set(0, 0, 0);
      if (facing !== undefined) {
        (c as Combatant & { facing?: number }).facing = facing;
        c.object.rotation.y = facing;
      }
    };
    /** hold an ally in a pose (Ally has only gesture(); the NPC base class plays specials) */
    const hold = (a: Ally, pose: 'kneel' | 'stagger' | null, seconds: number): void => {
      (a as unknown as { playSpecial?: (p: string | null, s: number) => void }).playSpecial?.(pose, seconds);
    };

    /** show an interact-free hint line for a few seconds */
    function hintFor(action: 'draw' | 'focus' | 'melee' | 'jump', text: string, seconds: number): void {
      ctx.hud.setPrompt(action, text);
      void level.wait(seconds).then(() => ctx.hud.setPrompt(null));
    }

    /** a clump of enemies from named spawn arcs, staggered */
    async function wave(groups: { spec: EnemySpec; count: number; at: THREE.Vector3[]; spread?: number }[], until: number, timeout: number, stagger = 2): Promise<void> {
      await level.wave({ groups: groups.map((g) => ({ ...g, spread: g.spread ?? 3 })), stagger, until, timeout });
    }

    // ── cp0: the gate ────────────────────────────────────────────────────

    /** the leaves grind open over `seconds`: stone dust, shake, drums, and the hosts begin to move */
    async function openGate(seconds: number): Promise<void> {
      beat = 'gate';
      level.music?.('tension');
      ctx.audio.play('drums', { volume: 1 });
      ctx.audio.play('chain_rattle', { volume: 0.9, pitch: 0.5 });
      world.hosts.begin();
      let k = 0;
      let dustT = 0;
      const base = [V(-15, 0.5, 14), V(15, 0.5, 14)];
      const off = level.onUpdate((dt) => {
        k = Math.min(1, k + dt / seconds);
        world.setGateOpen(k * k * (3 - 2 * k));
        dustT -= dt;
        if (dustT <= 0) {
          dustT = 0.9;
          ctx.audio.play('stone_crumble', { pos: V(0, 10, 60), volume: 0.9, pitch: 0.45 });
          for (const b of base) ctx.fx.dust(b, 8, 0x6a5a4a);
          ctx.player.camera.shake(0.12 + 0.12 * Math.sin(k * 3), 0.9);
        }
      });
      await level.wait(seconds);
      off();
      world.setGateOpen(1);
      // the leaves slam against the walls
      ctx.audio.play('explosion', { volume: 1.2, pitch: 0.5 });
      ctx.player.camera.shake(0.7, 1.6);
      for (const b of base) ctx.fx.explosion(b, 1.6);
      ctx.audio.play('horn_orc', { volume: 1, pitch: 0.7 });
    }

    async function intro(): Promise<void> {
      beat = 'intro';
      world.setGateOpen(0);
      if (quick) {
        void openGate(6);
        await level.wait(1);
        return;
      }
      const fy = FIGHT.y;
      level.cinematic(true);
      // the Army of the West before the closed Gate: Orodruin burning, the Tower behind
      level.cameraShot({ position: V(26, fy + 16, 232), lookAt: V(0, 44, 0), fov: 40, blend: 0 });
      await level.wait(0.8);
      level.cameraShot({ position: V(12, fy + 6, 214), lookAt: V(0, 34, 0), fov: 34, blend: 9 });
      const opening = openGate(14);
      await level.wait(1.5);
      await level.say('Legolas', 'The Gate. They are opening the Gate.', 2.8);
      // low among the soldiers: the leaves swing back
      level.cameraShot({ position: V(-14, ground(-14, 150) + 2.4, 150), lookAt: V(0, 12, 0), fov: 42, blend: 2.4 });
      await level.say('Gimli', 'Certain death, small chance of success... what are we waiting for?', 3.4);
      await opening;
      // Aragorn before the host
      const a = aragorn ? aragorn.position : G(L.aragorn);
      level.cameraShot({ position: V(a.x - 3.6, a.y + 1.5, a.z - 7.5), lookAt: V(a.x, a.y + 1.6, a.z), fov: 34, blend: 1.6 });
      await level.say('Aragorn', 'For Frodo.', 2.2);
      ctx.audio.play('horn_rohan', { volume: 1.1 });
      level.music?.('combat');
      level.cameraShot(null);
      await level.wait(0.8);
      level.cinematic(false);
    }

    /** four waves: orcs and Easterlings (shields and spears), archers behind them */
    async function gateWaves(): Promise<void> {
      beat = 'waves';
      level.music?.(null);
      level.objective('Hold the hill');
      hintFor('draw', 'Hold to draw, release to loose', 6);
      await wave(
        [
          { spec: orc(), count: 4, at: L.arcN },
          { spec: easterling(true), count: 3, at: [L.arcN[1], L.arcN[2]] },
        ],
        2, 70, 2.2,
      );
      world.hosts.attrition(0.03);
      void level.say('Aragorn', 'Hold! Let them break on us!', 2.2);
      await wave(
        [
          { spec: orc(), count: 5, at: [...L.arcNW, ...L.arcNE] },
          { spec: easterling(), count: 4, at: [...L.arcNW, ...L.arcNE] },
          { spec: orcArcher(), count: 2, at: L.archers },
        ],
        2, 80, 2.4,
      );
      world.hosts.attrition(0.04);
      await wave(
        [
          { spec: orc(), count: 5, at: [...L.arcW, ...L.arcE] },
          { spec: easterling(true), count: 4, at: [...L.arcW, ...L.arcE] },
          { spec: orcArcher(), count: 2, at: [L.archers[0], L.archers[1]] },
        ],
        2, 80, 2.4,
      );
      void level.say('Gimli', 'They are coming from every side!', 2);
      world.hosts.attrition(0.04);
      await wave(
        [
          { spec: orc(), count: 6, at: [...L.arcN, ...L.arcS] },
          { spec: easterling(), count: 5, at: [...L.arcNW, ...L.arcNE, ...L.arcS] },
          { spec: orcArcher(), count: 2, at: L.archers },
        ],
        1, 90, 2.6,
      );
      await level.waitUntil(() => alive() === 0, 25);
    }

    // ── cp1: the war trolls ──────────────────────────────────────────────

    /** Gimli is pinned under a war troll; returns true when it falls in time */
    async function pinFight(troll: Enemy): Promise<boolean> {
      const g = gimli;
      if (!g) return true;
      beat = 'pin';
      // Gimli has run on ahead to meet it
      g.anchor = G(L.pin);
      level.objective('Free Gimli: kill the war troll');
      await level.waitUntil(() => !troll.alive || troll.position.distanceTo(g.position) < 8, 70);
      if (!troll.alive) return true;
      // the troll stands over him
      const pinPos = g.position.clone();
      g.aiEnabled = false;
      troll.aiEnabled = false;
      troll.moveTarget = pinPos.clone().add(V(1.2, 0, 1.4));
      hold(g, 'kneel', PIN_SECONDS + 2);
      void level.say('Gimli', 'Legolas! A little help here, elf!', 2.4);
      if (!quick) {
        // a short cut so the moment is seen
        ctx.player.controlsEnabled = true;
        level.cameraShot({ position: V(pinPos.x + 9, pinPos.y + 4.5, pinPos.z + 12), lookAt: V(pinPos.x, pinPos.y + 1.8, pinPos.z), fov: 42, blend: 0.7 });
        await level.wait(2.2);
        level.cameraShot(null);
      }
      hintFor('draw', 'Shoot the troll: aim for its head', 7);
      let t = PIN_SECONDS;
      let nextSwing = 1.2;
      const stop = level.onUpdate((dt) => {
        t -= dt;
        nextSwing -= dt;
        ctx.hud.setProgress('Gimli is pinned!', clamp(t / PIN_SECONDS, 0, 1));
        // the troll hammers at Gimli's raised axe
        if (nextSwing <= 0 && troll.alive && !troll.attacking) {
          nextSwing = 3.6;
          troll.attack?.('overhead', { windup: 1.0, target: g });
        }
        if (troll.alive) g.object.position.copy(pinPos);
      });
      await level.waitUntil(() => !troll.alive || t <= 0, PIN_SECONDS + 4);
      stop();
      ctx.hud.setProgress(null);
      ctx.hud.setPrompt(null);
      if (!troll.alive) {
        hold(g, null, 0);
        g.aiEnabled = true;
        g.gesture('roar');
        ctx.rivalry.addLegolas(2);
        ctx.hud.toast('Gimli is free (+2 Legolas)', 'reward');
        await level.say('Gimli', 'I had him exactly where I wanted him!', 2.6);
        return true;
      }
      // too late: Gimli is hurt and out of the fight for a while
      troll.aiEnabled = true;
      troll.moveTarget = null;
      ctx.hud.toast('Gimli is wounded', 'warning');
      ctx.rivalry.autoGimli = false;
      hold(g, 'stagger', 3);
      void level.say('Gimli', 'Argh... my leg. Just a scratch...', 2.4);
      void level.wait(16).then(() => {
        g.aiEnabled = true;
        g.anchor = 'player';
        hold(g, null, 0);
        ctx.rivalry.autoGimli = true;
      });
      return false;
    }

    async function trollsBeat(): Promise<void> {
      beat = 'trolls';
      level.objective('War trolls are wading in');
      level.music?.('tension');
      ctx.audio.play('drums', { volume: 1 });
      ctx.audio.play('horn_orc', { volume: 1, pitch: 0.65 });
      ctx.hud.toast('War trolls!', 'warning');
      void level.say('Aragorn', 'Trolls! Stand together!', 2.2);
      level.music?.(null);
      // the one that goes for Gimli (lighter, so the 30 s are fair), and two that come for the line
      pinTroll = level.spawnEnemy({ ...warTroll(0, 560, 'War Troll'), target: G(L.pin) }, G(L.pinTroll), 0);
      const trollB = level.spawnEnemy({ ...warTroll(1, 760, 'War Troll'), target: 'nearest' }, G(L.trollB), 0);
      level.boss(pinTroll, 'War Troll');
      void level.wave({
        groups: [
          { spec: orc(), count: 4, at: [L.arcN[0], L.arcN[1]], spread: 3 },
          { spec: easterling(true), count: 3, at: [L.arcNE[0]], spread: 3 },
        ],
        stagger: 2, until: 2, timeout: 60,
      });
      const freed = pinFight(pinTroll);
      await level.wait(14);
      void level.say('Gimli', 'Come on then, you great lump!', 2);
      const trollC = level.spawnEnemy({ ...warTroll(2, 760, 'War Troll'), target: 'nearest' }, G(L.trollC), 0);
      void level.wave({
        groups: [
          { spec: orcArcher(), count: 2, at: L.archers.slice(0, 2), spread: 2 },
          { spec: orc(), count: 4, at: [L.arcNW[0], L.arcNW[1]], spread: 3 },
        ],
        stagger: 2.5, until: 2, timeout: 60,
      });
      await freed;
      level.boss(trollB, 'War Troll');
      level.objective('Bring down the war trolls');
      beat = 'trolls';
      await level.waitUntil(() => !trollB.alive && !trollC.alive, 130);
      // a stubborn troll falls to the line if the player cannot finish it (never soft-lock)
      for (const t of [trollB, trollC]) if (t.alive) t.takeDamage({ amount: 1e6, type: 'scripted', source: aragorn });
      level.boss(null);
      await level.waitUntil(() => alive() <= 3, 30);
      ctx.time.setScale(0.35, 0.15);
      await level.wait(0.3);
      ctx.time.setScale(1, 0.4);
      void level.say('Gimli', 'And that still only counts as one each!', 2.6);
      await level.wait(2);
    }

    // ── cp2: the last stand ──────────────────────────────────────────────

    const beasts: BeastCtl[] = [];
    function ensureBeasts(n: number): void {
      while (beasts.length < n) {
        const i = beasts.length;
        beasts.push(sky.addBeast(FIGHT, 120 + i * 34, 62 + i * 10, (i / 4) * Math.PI * 2 + 0.6, { seed: i, scale: 0.7, dir: i % 2 ? -1 : 1, speed: 20 + i }));
      }
    }

    /** a Fell Beast dives at the player: telegraph ring, shriek, shake */
    function diveAtPlayer(): void {
      const free = beasts.find((b) => b.mode === 'circle' && b.beast.alive);
      if (!free) return;
      const ahead = dirFromYaw(player.facing, new THREE.Vector3()).multiplyScalar(2);
      const target = V(player.position.x + ahead.x, ground(player.position.x, player.position.z), player.position.z + ahead.z);
      ctx.hud.toast('A Nazgul dives! Get out from under it!', 'warning');
      sky.dive(free, target);
    }

    /** escalating waves: a cap on live infantry that rises through the stand, mixed by phase */
    async function lastStand(): Promise<void> {
      beat = 'stand';
      level.objective('Hold the hill');
      level.music?.('combat');
      ensureBeasts(3);
      let t = 0;
      let spawnT = 1.5;
      let trollDone = false;
      const dives = [28, 58, 86, 108];
      const diveDone = [false, false, false, false];
      let shriek = false;
      const stop = level.onUpdate((dt) => {
        t += dt;
        ctx.hud.setProgress('Hold the line', clamp(t / STAND_SECONDS, 0, 1));
        const phase = t / STAND_SECONDS;
        if (!shriek && t > 3) {
          shriek = true;
          ctx.audio.play('bat_screech', { volume: 1, pitch: 0.42 });
          ctx.hud.toast('The Nazgul wheel overhead', 'warning');
          void level.say('Aragorn', 'Fell beasts! Keep your shields up!', 2.4);
        }
        // spawn waves while the cap allows
        spawnT -= dt;
        const cap = Math.round(12 + phase * 12);
        if (spawnT <= 0 && t < STAND_SECONDS - 4) {
          spawnT = 3.2 - phase * 1.2;
          if (alive() < cap) {
            const n = 2 + (phase > 0.4 ? 1 : 0) + (phase > 0.75 ? 1 : 0);
            const arcs = [L.arcN, L.arcNW, L.arcNE, L.arcW, L.arcE, L.arcS];
            for (let i = 0; i < n; i++) {
              const arc = arcs[Math.floor(level.rng() * arcs.length)];
              const p = arc[Math.floor(level.rng() * arc.length)];
              const roll = level.rng();
              const spec = roll < 0.45 ? orc() : roll < 0.72 ? easterling(level.rng() < 0.4) : roll < 0.86 ? orcArcher() : easterling();
              const e = level.spawnEnemy(spec, G(V(p.x + (level.rng() - 0.5) * 8, 0, p.z + (level.rng() - 0.5) * 6)));
              if (spec.archetype === 'orc_archer') e.moveTarget = null;
            }
          }
        }
        // a war troll breaks in at the two-thirds mark
        if (!trollDone && t > STAND_SECONDS * 0.62) {
          trollDone = true;
          const p = L.arcN[Math.floor(level.rng() * L.arcN.length)];
          const tr = level.spawnEnemy({ ...warTroll(3, 620, 'War Troll'), target: 'player' }, G(p), 0);
          void tr;
          ctx.audio.play('troll_roar', { volume: 1, pitch: 0.8 });
          ctx.hud.toast('Another war troll!', 'warning');
        }
        // the Nazgul stoop
        dives.forEach((at, i) => {
          if (!diveDone[i] && t > at) {
            diveDone[i] = true;
            diveAtPlayer();
          }
        });
      });
      await level.waitUntil(() => t >= STAND_SECONDS, STAND_SECONDS + 30);
      stop();
      ctx.hud.setProgress(null);
    }

    const fin: FinaleCtx = {
      level,
      world,
      sky,
      quick,
      gimli: () => gimli,
      aragorn: () => aragorn,
      setBeat: (b) => (beat = b as Beat),
    };

    async function ending(): Promise<void> {
      ensureBeasts(3);
      const eagles = await eaglesArrive(fin);
      await eaglesStrike(fin, eagles, beasts);
      await sauronFalls(fin);
      await finalTally(fin);
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
      level.complete();
    }

    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await gateWaves();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await trollsBeat();
        level.checkpoint(2);
      }
      if (ctx.flags.bgfinale !== '1') await lastStand();
      await ending();
    }

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        if (c >= 1) {
          world.setGateOpen(1);
          world.hosts.snapToRest();
          world.hosts.attrition(0.1 + 0.08 * (c - 1));
        }
        const p = c === 0 ? L.spawn : L.fight;
        player.teleport(V(p.x, ground(p.x, p.z), p.z), NORTH);
        spawnAllies(c);
        if (c === 0) beat = 'intro';
        void run(c);
      },

      update(): void {},

      dispose(): void {
        sky.dispose();
      },

      botHint() {
        switch (beat) {
          case 'gate':
          case 'waves':
          case 'trolls':
          case 'stand':
            return { moveTo: L.fight };
          case 'pin': {
            // stand about 16 m from the pinning troll, on the fight side, and look at it
            const t = pinTroll;
            if (!t || !t.alive) return { moveTo: L.fight };
            hint.set(FIGHT.x - t.position.x, 0, FIGHT.z - t.position.z).normalize().multiplyScalar(15).add(t.position);
            hint.y = ground(hint.x, hint.z);
            return { moveTo: hint, lookAt: t.position };
          }
          default:
            return null;
        }
      },
    };
  },
};

void smoothstep;
