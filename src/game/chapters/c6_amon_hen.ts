/**
 * Chapter 6: Amon Hen (The Fellowship of the Ring).
 *
 *   cp0  The Woods    Uruk-hai scouts sweep through the golden beechwood: three running fights up the
 *                     hill, archers posted among the trunks, shield-bearers that shrug off frontal arrows.
 *   cp1  The Ruins    the mossy Numenorean terrace below the Seat of Seeing: a shield wall with pikes, then
 *                     a flanking wave. Boromir's horn sounds from the river: "Reach Boromir", a run down
 *                     through the east woods with two ambushes.
 *   cp2  Lurtz        the clearing by the stream. Lurtz shoots Boromir, then fights: his bow at range
 *                     (leads his shots), then sword and shield (frontal arrows glance off, a shield bash and
 *                     a thrown knife), and at 15 % HP a cinematic in which Aragorn and Legolas finish him.
 *                     Boromir's farewell; "We will not abandon Merry and Pippin."
 *
 * The world is built in amon_hen/world.ts, Lurtz in amon_hen/lurtz.ts, the Uruk roles in uruks.ts, the
 * cast in cast.ts and every coordinate in layout.ts.
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Enemy, EnemyBehavior, Humanoid, LevelAPI } from '../../core/types';
import { ENVIRONMENTS, type EnvironmentPresetEx } from '../../core/environment';
import { clamp, yawOf } from '../../core/math';
import { buildAmonHen } from './amon_hen/world';
import { ASCENT_PATH, CHECKPOINTS, CLEARING, DESCENT_PATH, L, V, ground } from './amon_hen/layout';
import type { Path } from '../../world';
import { SeedPicker, spawnUruk, type UrukRole } from './amon_hen/uruks';
import { makeBoromirBody, poseAlly, setAlly, spawnBoromir, spawnCast, walkAlly, type Cast } from './amon_hen/cast';
import { spawnLurtz, type LurtzBoss } from './amon_hen/lurtz';

/** Lurtz's health: the bow phase takes about a third (he holds at 68 % until the script moves on), the shield phase the rest */
const LURTZ_HP = 1800;

export const chapter: ChapterDef = {
  id: 'amon_hen',
  number: 6,
  title: 'Amon Hen',
  film: 'The Fellowship of the Ring',
  blurb: 'The wooded hill above the Anduin. Uruk-hai in the golden beechwood, a stand among the ruins below the Seat of Seeing, Boromir\'s horn, and Lurtz, the first of the Uruk-hai.',
  environment: 'amon_hen',
  checkpoints: CHECKPOINTS,
  parTime: 420,
  rivalry: true,
  // every humanoid kind this chapter spawns ('uruk' = swordsmen, pikemen and archers; 'gondor' = Boromir)
  preload: ['gimli', 'aragorn', 'uruk', 'lurtz', 'gondor'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const { player, audio, fx, hud } = ctx;
    // ?skipIntro=1 skips the cinematics and plays the lines fire-and-forget (the smoke test and the bot);
    // ?cine=1 keeps them even then (QA: look at the cinematics without the shell's title card)
    const quick = ctx.flags.skipIntro === '1' && ctx.flags.cine !== '1';

    // golden afternoon: the stock preset with more cloud (less bare blue through the canopy), a touch more
    // exposure and fill so the shadowed ground keeps its colour, and a slightly clearer haze
    const base = ENVIRONMENTS.amon_hen as EnvironmentPresetEx;
    const sky = base.sky.kind === 'physical' ? { ...base.sky, clouds: 0.62 } : base.sky;
    level.setEnvironment({ ...base, sky, exposure: 1.0, hemiIntensity: 0.72, fog: { color: 0xcdb99a, density: 0.0068 } });
    const world = buildAmonHen(level);
    // Boromir's helmetless body is not in the preload list: build it now, behind the loading screen
    let boromirBody: Humanoid | null = makeBoromirBody();
    const seeds = new SeedPicker(1);
    const trace = (msg: string): void => {
      if (ctx.flags.trace === '1') console.log(`[amon_hen] t=${ctx.time.t.toFixed(1)} ${msg}`);
    };

    // ── script state, read by botHint() ────────────────────────────────────
    type Beat = 'intro' | 'woods' | 'ruins' | 'run' | 'clearing' | 'lurtz' | 'finish' | 'outro';
    let beat: Beat = 'intro';
    let cast: Cast | null = null;
    let boromir: Ally | null = null;
    let boss: LurtzBoss | null = null;
    let host: { thin(frac: number): void } | null = null;

    // ── helpers ──────────────────────────────────────────────────────────
    /** a line of dialogue: awaited normally, fire-and-forget when the intro is skipped (smoke test / bot) */
    const talk = async (speaker: string, text: string, secs?: number): Promise<void> => {
      if (quick) {
        void level.say(speaker, text, secs);
        return;
      }
      await level.say(speaker, text, secs);
    };
    const g = (x: number, z: number): number => ground(x, z);
    const at = (x: number, z: number): THREE.Vector3 => V(x, g(x, z), z);

    /** nudge a spawn point out of any trunk or big prop */
    const safe = (x: number, z: number): THREE.Vector3 => {
      for (let pass = 0; pass < 3; pass++) {
        for (const t of world.trunks) {
          const dx = x - t.x;
          const dz = z - t.z;
          const min = t.r + 1.0;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 0.01;
            x = t.x + (dx / d) * min;
            z = t.z + (dz / d) * min;
          }
        }
      }
      return at(x, z);
    };

    interface Spawn {
      role: UrukRole;
      x: number;
      z: number;
      behavior?: EnemyBehavior;
    }
    /** spawn a squad; returns the living list the script waits on */
    const squad = (list: Spawn[]): Enemy[] =>
      list.map((s) => {
        const e = spawnUruk(level, seeds, s.role, safe(s.x, s.z), { behavior: s.behavior });
        // archers keep their post at first; if nobody comes for them they start moving, so a wave never stalls
        if (s.role === 'archer' && !s.behavior) {
          void level.wait(22 + level.rng() * 8).then(() => {
            if (e.alive) e.behavior = 'archer';
          });
        }
        return e;
      });
    const left = (list: Enemy[]): number => list.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    /** wait until at most `until` of the squad live (or the timeout passes) */
    const clear = (list: Enemy[], until: number, timeout: number): Promise<void> => level.waitUntil(() => left(list) <= until, timeout);

    /** Aragorn goes ahead along a route, so the way is never in doubt (and he fights what he meets); returns the stop function */
    function guide(route: Path, ahead: number): () => void {
      const anchor = new THREE.Vector3();
      const stop = level.onUpdate(() => {
        if (!cast) return;
        const n = route.nearest(player.position.x, player.position.z);
        route.at(Math.min(route.length, n.s + ahead), anchor);
        cast.aragorn.anchor = anchor;
      });
      return () => {
        stop();
        if (cast) cast.aragorn.anchor = 'player';
      };
    }

    // ── beat 0: the woods ─────────────────────────────────────────────────
    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true);
      level.music?.('tension');
      const s = L.spawn;
      // the Seat of Seeing in the golden haze, from the top of the ruined stair; then down to the fellowship
      level.cameraShot({ position: V(-14, g(-14, 134) + 2.2, 134), lookAt: V(0, 40.5, 172), fov: 38, blend: 0 });
      await level.wait(0.4);
      level.cameraShot({ position: V(-7, g(-7, 141) + 2.6, 141), lookAt: V(0, 41, 172), fov: 34, blend: 3.8 });
      await level.wait(3.2);
      level.cameraShot({ position: V(s.x - 4.2, g(s.x - 4.2, s.z - 5.0) + 1.5, s.z - 5.0), lookAt: V(s.x + 0.5, g(s.x, s.z) + 1.55, s.z + 0.8), fov: 36, blend: 0 });
      await level.wait(0.2);
      level.cameraShot({ position: V(s.x - 3.0, g(s.x - 3.0, s.z - 3.2) + 1.5, s.z - 3.2), lookAt: V(s.x + 0.5, g(s.x, s.z) + 1.55, s.z + 0.8), fov: 36, blend: 7.0 });
      await level.say('Aragorn', 'Frodo has gone up to the Seat of Seeing. Boromir is somewhere in these woods.', 3.6);
      await level.say('Legolas', 'The birds have fallen silent. Something comes up the hill, Aragorn. Many of them.', 3.4);
      level.cameraShot({ position: V(s.x + 4.5, g(s.x + 4.5, s.z - 3) + 1.5, s.z - 3), lookAt: V(s.x + 2, g(s.x, s.z) + 1.3, s.z + 14), fov: 46, blend: 1.6 });
      await level.say('Gimli', 'Then we shall see whose count is higher, laddie.', 2.6);
      level.cameraShot(null);
      await level.wait(0.6);
      level.cinematic(false);
      level.music?.(null);
    }

    async function woodsBeat(): Promise<void> {
      beat = 'woods';
      const stopGuide = guide(ASCENT_PATH, 13);
      level.objective('Climb through the woods to the ruins');
      hud.toast('Hold to draw, release to loose', 'info');
      void talk('Aragorn', 'Uruk-hai! Keep moving, and keep to the trees!', 2.6);

      // first sweep: scouts out of the trunks on both flanks, two archers posted ahead
      const a = squad([
        { role: 'blade', x: -22, z: -24 }, { role: 'blade', x: 26, z: -26 }, { role: 'blade', x: 5, z: -4 },
        { role: 'archer', x: -9, z: -10 }, { role: 'archer', x: 22, z: -6 },
      ]);
      await level.waitUntil(() => player.position.z > -18, 90);
      await clear(a, 1, 50);

      // second sweep: shield-bearers, shooting from the front is wasted: flank them or aim high
      void talk('Legolas', 'Shields. Their arrows are not the only thing that glances off.', 2.6);
      hud.toast('Shields block arrows: aim high or flank', 'info');
      const b = squad([
        { role: 'shield', x: -22, z: 14 }, { role: 'shield', x: -8, z: 18 }, { role: 'shield', x: 22, z: 16 },
        { role: 'blade', x: 32, z: -2 }, { role: 'blade', x: -32, z: 0 },
        { role: 'archer', x: -18, z: 10 }, { role: 'archer', x: 18, z: 6 },
      ]);
      await level.waitUntil(() => player.position.z > 12, 90);
      await clear(b, 1, 60);

      // third sweep, right below the ruins: a pikeman among them
      void talk('Gimli', 'More! They grow on these trees!', 2.2);
      const c = squad([
        { role: 'shield', x: -16, z: 40 }, { role: 'shield', x: 14, z: 42 },
        { role: 'blade', x: -30, z: 28 }, { role: 'blade', x: 28, z: 30 }, { role: 'blade', x: 0, z: 52 },
        { role: 'pike', x: 4, z: 38 },
        { role: 'archer', x: -22, z: 34 }, { role: 'archer', x: 20, z: 38 },
      ]);
      await level.waitUntil(() => player.position.z > 34, 90);
      await clear(c, 0, 70);
      level.objective('Reach the ruins');
      await level.waitUntil(() => player.position.z > L.ruinsGate.z - 4 && Math.hypot(player.position.x - L.ruinsGate.x, player.position.z - L.ruinsGate.z) < 14, 90);
      stopGuide();
    }

    // ── beat 1: the ruins ─────────────────────────────────────────────────
    function horn(): void {
      audio.play('horn_rohan', { volume: 0.9, pitch: 0.58 });
      player.camera.shake(0.08, 0.6);
    }

    async function ruinsBeat(): Promise<void> {
      beat = 'ruins';
      level.objective('Defend the ruins');
      void talk('Aragorn', 'Hold the ruins! They must not reach the Seat!', 2.6);

      // wave 1: a shield wall with pikes behind it, and two archers on the old walls
      const w1 = squad([
        { role: 'shield', x: -9, z: 96 }, { role: 'shield', x: -3, z: 98 }, { role: 'shield', x: 4, z: 98 }, { role: 'shield', x: 10, z: 96 },
        { role: 'pike', x: -5, z: 104 }, { role: 'pike', x: 6, z: 104 },
        { role: 'archer', x: -14, z: 84 }, { role: 'archer', x: 17, z: 83 },
      ]);
      await clear(w1, 1, 85);

      // the horn of Gondor, far below, from the river
      horn();
      void talk('Aragorn', 'The horn of Gondor! Boromir is in trouble!', 2.6);
      void talk('Legolas', 'It came from the river. It is far, and the Uruk-hai are between.', 3.2);

      // wave 2: flankers from east and west, more shields from the front, archers on the walls
      audio.play('horn_orc', { volume: 0.7, pitch: 0.75 });
      const w2 = squad([
        { role: 'blade', x: 40, z: 62 }, { role: 'blade', x: 40, z: 70 }, { role: 'blade', x: -40, z: 64 }, { role: 'blade', x: -40, z: 72 },
        { role: 'shield', x: -4, z: 100 }, { role: 'shield', x: 6, z: 100 }, { role: 'shield', x: 0, z: 104 },
        { role: 'pike', x: -12, z: 100 }, { role: 'pike', x: 14, z: 98 },
        { role: 'archer', x: -19, z: 75 }, { role: 'archer', x: 21, z: 73 }, { role: 'archer', x: 0, z: 108 },
      ]);
      void talk('Gimli', 'They come at us from every side!', 2.2);
      await clear(w2, 0, 95);

      // the horn again, nearer: the way to Boromir
      horn();
      void talk('Aragorn', 'Boromir! Legolas, go to him! We will follow!', 2.6);
      level.objective('Reach Boromir');
    }

    /** the run down through the east woods: two ambushes, then the clearing's edge */
    async function descentBeat(): Promise<void> {
      beat = 'run';
      level.objective('Reach Boromir');
      const stopGuide = guide(DESCENT_PATH, 14);
      const a1 = squad([
        { role: 'blade', x: 44, z: 22 }, { role: 'blade', x: 8, z: 12 }, { role: 'shield', x: 40, z: 30 },
        { role: 'archer', x: 38, z: 8 },
      ]);
      await level.waitUntil(() => player.position.z < 26, 120);
      await clear(a1, 1, 50);
      const a2 = squad([
        { role: 'shield', x: 36, z: -18 }, { role: 'blade', x: 8, z: -14 }, { role: 'blade', x: 40, z: -6 },
        { role: 'pike', x: 14, z: -40 }, { role: 'archer', x: 30, z: -34 },
      ]);
      await level.waitUntil(() => player.position.z < -8, 120);
      void talk('Gimli', 'Run, lad! We are right behind you!', 2.2);
      await clear(a2, 1, 50);
      await level.waitUntil(() => Math.hypot(player.position.x - L.clearingEntry.x, player.position.z - L.clearingEntry.z) < 12, 120);
      if (level.enemiesAlive() > 1) level.objective('Clear the way to Boromir');
      await level.waitUntil(() => level.enemiesAlive() <= 1, 40);
      stopGuide();
    }

    // ── beat 2: Lurtz ─────────────────────────────────────────────────────
    const markPos = (): THREE.Vector3 => at(L.lurtzMark.x, L.lurtzMark.z);

    async function lurtzIntro(): Promise<void> {
      beat = 'clearing';
      level.objective(null);
      // the run down the hill must not decide the boss fight: Legolas reaches the stream with at least three quarters of his health
      if (player.hp < player.maxHp * 0.75) player.heal(player.maxHp * 0.75 - player.hp);
      // the stream murmurs; across it the host of Isengard waits, a low murmur of its own (both stop with the level)
      audio.loop('river', 0.3);
      audio.loop('army', 0.14);
      // the host of Isengard on the far bank of the stream, idle in the haze (it scatters when Lurtz falls)
      host = level.crowd({ center: V(8, 0, -126), halfSize: [58, 9], count: 90, kind: 'uruk', facing: 0, speed: 0, props: true });
      const mark = markPos();
      const bPos = at(L.boromir.x, L.boromir.z);
      boromir = spawnBoromir(level, bPos, yawOf(mark.x - bPos.x, mark.z - bPos.z), boromirBody ?? undefined);
      boromirBody = null;
      boss = spawnLurtz(level, mark, yawOf(boromir.position.x - mark.x, boromir.position.z - mark.z), { maxHp: LURTZ_HP });
      const lz = boss;
      lz.enemy.aiEnabled = false;
      lz.enemy.targetable = false;
      if (cast) {
        cast.aragorn.aiEnabled = false;
        cast.gimli.aiEnabled = false;
      }
      const bp = boromir.position;
      if (!quick) {
        level.cinematic(true);
        level.music?.('tension');
        // the sun is low in the west-south-west: the cameras sit with it behind them where the faces matter
        // establishing: from the north-east edge of the clearing, into the glare, a silhouette in the haze
        const cx = CLEARING.x + 19;
        level.cameraShot({ position: V(cx, g(cx, -46) + 2.4, -46), lookAt: V(mark.x - 2, mark.y + 1.6, mark.z), fov: 42, blend: 0 });
        await level.wait(0.7);
        // over Boromir's shoulder: Lurtz draws, the sun behind the camera lights his face and bow
        const L2 = Math.hypot(bp.x - mark.x, bp.z - mark.z);
        const dx = (bp.x - mark.x) / L2;
        const dz = (bp.z - mark.z) / L2;
        const ox = bp.x + dx * 3.2;
        const oz = bp.z + dz * 3.2;
        level.cameraShot({ position: V(ox, g(ox, oz) + 1.9, oz), lookAt: V(mark.x, mark.y + 1.7, mark.z), fov: 26, blend: 0 });
        lz.aim(V(bp.x, bp.y + 1.1, bp.z), 0.4);
        await level.wait(0.2);
        const ox2 = bp.x + dx * 1.7;
        const oz2 = bp.z + dz * 1.7;
        level.cameraShot({ position: V(ox2, g(ox2, oz2) + 1.7, oz2), lookAt: V(mark.x, mark.y + 1.7, mark.z), fov: 26, blend: 4.0 });
        await level.wait(0.8);
        // the profile of the draw, from Lurtz's right (the string hand), the arrows crossing the frame
        const rx = -dz;
        const rz = dx;
        const px = mark.x + rx * 6.5 + dx * 1.5;
        const pz = mark.z + rz * 6.5 + dz * 1.5;
        for (let i = 0; i < 3; i++) {
          if (i === 1) level.cameraShot({ position: V(px, g(px, pz) + 1.5, pz), lookAt: V(mark.x + dx * 2.5, mark.y + 1.5, mark.z + dz * 2.5), fov: 36, blend: 0.5 });
          // he draws, holds, looses: Boromir takes each arrow without a sound
          const target = V(bp.x, bp.y + 1.0 + i * 0.12, bp.z);
          for (let t = 0; t <= 1.0; t += 0.1) {
            lz.aim(target, t);
            await level.wait(0.07);
          }
          lz.shoot(target, { damage: 0 });
          lz.aim(target, 0);
          audio.play('arrow_hit_flesh', { pos: bp, volume: 0.8, pitch: 0.8 });
          await level.wait(0.5);
        }
        lz.aim(null, 0);
        // Boromir, close, from the south-east
        level.cameraShot({ position: V(bp.x + 3.2, bp.y + 1.1, bp.z - 3.0), lookAt: V(bp.x, bp.y + 0.9, bp.z), fov: 38, blend: 0 });
        await level.say('Boromir', '...Frodo...', 1.8);
        // Lurtz turns to the player; the camera takes the sunlit side of his face
        lz.face(player.position);
        audio.play('uruk_roar', { pos: mark, volume: 1, pitch: 0.75 });
        level.cameraShot({ position: V(mark.x - 4.6, mark.y + 1.9, mark.z + 3.6), lookAt: V(mark.x, mark.y + 1.85, mark.z), fov: 32, blend: 0 });
        await level.say('Lurtz', 'Where is the Halfling? Bring me the Halfling!', 2.8);
        // over Legolas's shoulder
        const pp = player.position;
        const toL = yawOf(mark.x - pp.x, mark.z - pp.z);
        const fx = Math.sin(toL);
        const fz = Math.cos(toL);
        level.cameraShot({ position: V(pp.x - fx * 2.6 + fz * 0.9, pp.y + 1.9, pp.z - fz * 2.6 - fx * 0.9), lookAt: V(mark.x, mark.y + 1.6, mark.z), fov: 40, blend: 0 });
        await level.say('Legolas', 'Lurtz of Isengard. He ends here.', 2.2);
        level.cameraShot(null);
        await level.wait(0.6);
        level.cinematic(false);
      } else {
        // skipIntro: the arrows are already in him
        for (let i = 0; i < 3; i++) lz.shoot(V(bp.x, bp.y + 1.0 + i * 0.12, bp.z), { damage: 0 });
      }
      lz.enemy.targetable = true;
      lz.enemy.aiEnabled = true;
      // QA: ?lurtz=blade starts him in the shield phase, ?lurtz=finish at the finisher
      if (ctx.flags.lurtz === 'blade') lz.enemy.hp = lz.enemy.maxHp * 0.68;
      else if (ctx.flags.lurtz === 'finish') lz.enemy.hp = lz.enemy.maxHp * 0.15;
      if (cast) {
        cast.gimli.aiEnabled = true;
        cast.aragorn.aiEnabled = true;
        cast.aragorn.anchor = bp.clone().setX(bp.x + 3);
      }
    }

    async function lurtzFight(): Promise<void> {
      beat = 'lurtz';
      const lz = boss!;
      level.boss(lz.enemy, 'Lurtz');
      level.objective('Defeat Lurtz');
      level.music?.(null);
      hud.toast('Lurtz leads his shots: keep moving', 'info');

      // phase 1: the bow. The floor holds him at 68 % so the phase ends on the script's terms.
      lz.floor = ctx.flags.lurtz ? 0.145 : 0.68;
      let near = 0;
      const t1 = ctx.time.t;
      const stopNear = level.onUpdate((dt) => {
        const d = Math.hypot(player.position.x - lz.enemy.position.x, player.position.z - lz.enemy.position.z);
        near = d < 6.5 ? near + dt : Math.max(0, near - dt * 0.5);
      });
      // (he holds at the floor and keeps shooting until the phase has lasted a while: a fast archer cannot skip it)
      const minPhase = ctx.flags.lurtz ? 0 : 16;
      await level.waitUntil(() => !lz.enemy.alive || (ctx.time.t - t1 >= minPhase && (lz.hpFrac <= 0.685 || near > 5)) || ctx.time.t - t1 > 85, 200);
      stopNear();

      // phase 2: sword and shield
      const e = lz.enemy;
      e.aiEnabled = false;
      e.moveTarget = null;
      lz.cancel();
      e.playPose?.('roar', 1.6);
      audio.play('uruk_roar', { pos: e.position, volume: 1, pitch: 0.7 });
      player.camera.shake(0.3, 0.7);
      void talk('Lurtz', 'You cannot stop the Uruk-hai!', 2.4);
      await level.wait(1.1);
      lz.toBlade();
      lz.floor = 0.145;
      e.aiEnabled = true;
      hud.toast('Shield blocks arrows: aim high or flank', 'info');
      // two of his guard come down from the woods to keep the others busy
      squad([{ role: 'blade', x: CLEARING.x - 26, z: -62 }, { role: 'shield', x: CLEARING.x + 24, z: -60 }]);
      // an idle or evasive player cannot stall the fight: after 90 s of phase 2 Aragorn and Gimli press him harder (a slow
      // drain), so the finisher only ever comes at 15 %, never at 70 %
      const t2 = ctx.time.t;
      const stopDrain = level.onUpdate((dt) => {
        if (e.alive && ctx.time.t - t2 > 90 && lz.hpFrac > 0.16) e.hp = Math.max(e.maxHp * 0.15, e.hp - e.maxHp * 0.0035 * dt);
      });
      await level.waitUntil(() => lz.hpFrac <= 0.152 || !e.alive, 600);
      stopDrain();
    }

    /**
     * Legolas draws his bow for the cinematic. The player's humanoid is animated by the player every frame,
     * so its `animate` is wrapped for the duration of the shot (and restored in `drawHold.stop()`, which
     * dispose() also calls: the player outlives the level).
     */
    let drawHold: { set(draw: number): void; stop(): void } | null = null;
    function holdDraw(): { set(draw: number): void; stop(): void } {
      const hum = player.humanoid;
      const orig = hum.animate.bind(hum);
      let d = 0;
      let on = true;
      hum.animate = (dt, a) => {
        if (on) {
          a.aim = 1;
          a.draw = d;
          a.aimPitch = 0.04;
        }
        orig(dt, a);
      };
      const h = {
        set(v: number) {
          d = v;
        },
        stop() {
          if (!on) return;
          on = false;
          hum.animate = orig;
        },
      };
      drawHold = h;
      return h;
    }

    // ── camera staging ─────────────────────────────────────────────────────
    // Every cinematic camera is a list of candidate eyes. The first with a clear line to the subject (no trunk,
    // boulder or hillside in between: a physics ray against everything that blocks the camera) wins; if none is
    // clear the best one is pulled in along its ray. Aim points sit a little below the subject, so the figures
    // ride in the upper two thirds of the frame and the subtitle bar never covers them.
    const _cd = new THREE.Vector3();
    const freeFrac = (eye: THREE.Vector3, target: THREE.Vector3): number => {
      _cd.subVectors(eye, target);
      const d = _cd.length();
      if (d < 0.01) return 1;
      _cd.divideScalar(d);
      const hit = ctx.physics.raycast(target, _cd, d, 'camera');
      return hit ? hit.t / d : 1;
    };
    /** eyes on a ring round `c` at `dist` and height `h` above the ground, at each yaw (radians, 0 = +z) */
    const ring = (c: THREE.Vector3, dist: number, h: number, yaws: number[]): THREE.Vector3[] =>
      yaws.map((a) => {
        const x = c.x + Math.sin(a) * dist;
        const z = c.z + Math.cos(a) * dist;
        return V(x, g(x, z) + h, z);
      });
    function shotFrom(label: string, eyes: THREE.Vector3[], subject: THREE.Vector3, aim: THREE.Vector3, fov: number, blend = 0): void {
      let best = eyes[0];
      let bf = -1;
      for (const e of eyes) {
        const f = freeFrac(e, subject);
        if (f > 0.97) {
          best = e;
          bf = 1;
          break;
        }
        if (f > bf) {
          bf = f;
          best = e;
        }
      }
      const eye = best.clone();
      if (bf < 0.97) eye.copy(subject).lerp(best, Math.max(0.4, bf - 0.1));
      const floor = g(eye.x, eye.z) + 0.55;
      if (eye.y < floor) eye.y = floor;
      trace(`cam ${label} free=${bf.toFixed(2)} eye=${eye.x.toFixed(1)},${eye.y.toFixed(1)},${eye.z.toFixed(1)}`);
      level.cameraShot({ position: eye, lookAt: aim, fov, blend });
    }
    const yawFrom = (from: THREE.Vector3, to: THREE.Vector3): number => Math.atan2(to.x - from.x, to.z - from.z);

    /** Gimli's banter must not run over a set-piece: the counter keeps counting, the lines are dropped */
    let hushed: (() => void) | null = null;
    function hushRivalry(): void {
      if (hushed) return;
      const rv = ctx.rivalry;
      const was = { auto: rv.autoGimli, g: rv.addGimli, l: rv.addLegolas };
      rv.autoGimli = false;
      rv.addGimli = () => {};
      rv.addLegolas = () => {};
      hushed = () => {
        rv.autoGimli = was.auto;
        rv.addGimli = was.g;
        rv.addLegolas = was.l;
      };
    }

    async function finisher(): Promise<void> {
      beat = 'finish';
      const lz = boss!;
      const e = lz.enemy;
      const ar = cast!.aragorn;
      const gi = cast!.gimli;
      lz.floor = 0.145;
      lz.cancel();
      lz.specials = false;
      level.objective(null);
      hud.setPrompt(null);
      level.cinematic(true);
      level.music?.('epic');
      hushRivalry();
      player.invulnerable = true; // nothing may touch Legolas until the clearing is quiet again
      // everyone stops: the rest of the Uruk-hai lose their nerve and run
      for (const c of ctx.combatants.byTeam('enemy')) {
        if (c === e || !c.alive) continue;
        (c as Enemy).aiEnabled = false;
        (c as Enemy).moveTarget = V(c.position.x + (c.position.x < e.position.x ? -40 : 40), 0, c.position.z - 20);
        void level.wait(4).then(() => c.alive && level.removeCombatant(c));
      }
      e.aiEnabled = false;
      e.moveTarget = null;
      e.velocity.set(0, 0, 0);
      e.playPose?.('stagger', 1.4);
      audio.play('uruk_roar', { pos: e.position, volume: 1, pitch: 0.65 });
      gi.aiEnabled = false;
      ar.aiEnabled = false;
      const lp = e.position.clone();
      const lpy = lp.y + 1.2;
      const chest = V(lp.x, lpy, lp.z);
      // Aragorn crosses the clearing from Boromir's tree to a spot just short of Lurtz, on the side he comes from
      const bmp = boromir ? boromir.position : lp;
      const comeFrom = yawFrom(lp, bmp);
      const stand = V(lp.x + Math.sin(comeFrom + 0.5) * 2.6, lp.y, lp.z + Math.cos(comeFrom + 0.5) * 2.6);
      walkAlly(ar, stand);
      shotFrom('fin_wide', ring(lp, 8, 1.4, [comeFrom + 1.6, comeFrom - 1.6, comeFrom + 2.4, comeFrom - 2.4, comeFrom + 0.8, comeFrom - 0.8]), chest, V(lp.x, lp.y + 0.9, lp.z), 40);
      await level.wait(1.5);
      e.playPose?.('kneel', 8);
      // Lurtz on his knees, from the front (he turns to Legolas); Aragorn is out of the frame, behind the camera's shoulder
      const toLegolas = yawFrom(lp, player.position);
      shotFrom('fin_lurtz_face', ring(lp, 4.2, 1.45, [toLegolas + 0.5, toLegolas - 0.5, toLegolas + 1.1, toLegolas - 1.1]), chest, V(lp.x, lp.y + 1.0, lp.z), 34);
      await level.say('Lurtz', 'You will not find them. The Halfling is Saruman\'s now.', 3.0);
      // Aragorn and Lurtz in profile: the camera on the perpendicular of the line between them, not behind either
      profile(6.2, 36);
      await level.say('Aragorn', 'You have shed enough blood on this hill.', 2.4);

      // Legolas turns and draws
      const pp = player.position;
      const toL = yawOf(lp.x - pp.x, lp.z - pp.z);
      player.facing = toL;
      const hold = holdDraw();
      audio.play('bow_draw', { pos: pp, volume: 0.9 });
      const fwd = V(Math.sin(toL), 0, Math.cos(toL));
      const side = V(fwd.z, 0, -fwd.x);
      shotFrom('fin_draw', 
        [
          V(pp.x - fwd.x * 2.4 + side.x * 0.9, pp.y + 1.85, pp.z - fwd.z * 2.4 + side.z * 0.9),
          V(pp.x - fwd.x * 2.4 - side.x * 0.9, pp.y + 1.85, pp.z - fwd.z * 2.4 - side.z * 0.9),
          V(pp.x - fwd.x * 1.4 + side.x * 1.4, pp.y + 1.7, pp.z - fwd.z * 1.4 + side.z * 1.4),
        ],
        V(pp.x, pp.y + 1.5, pp.z),
        V(lp.x, lpy, lp.z),
        32,
      );
      for (let t = 0; t <= 1; t += 0.1) {
        hold.set(t);
        await level.wait(0.09);
      }
      // the arrow crosses the clearing in slow motion
      ctx.time.setScale(0.3, 0.2);
      lz.floor = 0;
      const bow = player.humanoid.weaponObject('hand_l')?.getWorldPosition(new THREE.Vector3()) ?? player.aimPoint(new THREE.Vector3());
      const dirTo = new THREE.Vector3(lp.x - bow.x, lpy - bow.y, lp.z - bow.z).normalize();
      // enough to leave him on his knees: ~4 % even if it lands in the head
      ctx.projectiles.fire({ origin: bow.clone().addScaledVector(dirTo, 0.3), dir: dirTo, speed: 58, damage: Math.max(1, e.hp - e.maxHp * 0.04) / 2.6, team: 'player', owner: player, style: 'elven' });
      audio.play('bow_release', { pos: bow, volume: 1 });
      hold.set(0);
      // the arrow leaves the string on the same camera (behind Legolas's shoulder, down the line to Lurtz): it flies away from the lens
      await level.wait(0.3);
      // the arrow's end, from beside and ahead of Lurtz
      shotFrom('fin_arrow_end', ring(lp, 4.6, 0.9, [toL + Math.PI - 0.9, toL + Math.PI + 0.9, toL + Math.PI / 2, toL - Math.PI / 2]), chest, V(lp.x, lp.y + 1.0, lp.z), 34);
      await level.wait(0.15);
      hold.stop();
      drawHold = null;
      // Aragorn's blade
      e.playPose?.('roar', 1.2);
      ar.aiEnabled = true;
      ar.anchor = lp.clone();
      await level.waitUntil(() => ar.position.distanceTo(e.position) < 2.9, 6);
      ctx.time.setScale(0.45, 0.1);
      // the blow, in profile: the camera stands on the perpendicular to the line from Aragorn to Lurtz, wherever he stopped,
      // so neither back covers the other and the sword's whole arc is in the frame
      profile(4.4, 36);
      // his sword comes down: the blow lands on the strike frame of Aragorn's own swing (or after 2 s regardless)
      const arAtk = (ar as unknown as { atk: { phase: string } }).atk;
      await level.waitUntil(() => arAtk.phase === 'strike', 2.2);
      e.takeDamage({ amount: 9999, type: 'melee', source: ar, point: lp.clone().setY(lpy + 0.3), dir: new THREE.Vector3(1, 0, -1).normalize(), zone: 'head', stagger: true });
      fx.blood(V(lp.x, lpy + 0.3, lp.z), V(0, 0.5, -1), 'black', 1.4);
      audio.play('sword_clash', { pos: lp, volume: 1, pitch: 0.8 });
      player.camera.shake(0.35, 0.5);
      host?.thin(0.85);
      audio.loop('army', 0);
      await level.wait(0.7);
      ctx.time.setScale(1, 0.5);
      await level.wait(1.2);
      lz.stop();

      /** Aragorn and Lurtz in profile, wherever Aragorn stands now */
      function profile(dist: number, fov: number): void {
        const dxa = ar.position.x - lp.x;
        const dza = ar.position.z - lp.z;
        const pa = Math.atan2(dxa, dza) + Math.PI / 2;
        const midp = V((ar.position.x + lp.x) / 2, lp.y + 1.2, (ar.position.z + lp.z) / 2);
        const eyes = ring(midp, dist, 0, [pa, pa + Math.PI, pa + 0.6, pa + Math.PI - 0.6]).map((c) => c.setY(lp.y + 1.45));
        shotFrom(`profile${Math.round(dist)}`, eyes, midp, V(midp.x, lp.y + 1.0, midp.z), fov);
      }
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      const ar = cast!.aragorn;
      const gi = cast!.gimli;
      const bm = boromir!;
      level.cinematic(true);
      level.music?.('epic');
      level.objective(null);
      hushRivalry();
      const bp = bm.position.clone();
      // fixed axes (Boromir's live facing follows the player): "forward" is toward where Lurtz stood
      const mk = markPos();
      const fl = Math.hypot(mk.x - bp.x, mk.z - bp.z);
      const fw = V((mk.x - bp.x) / fl, 0, (mk.z - bp.z) / fl);
      const lf = V(fw.z, 0, -fw.x); // Boromir's left, toward the stream
      const spot = (a: number, b: number): THREE.Vector3 => {
        const x = bp.x + fw.x * a + lf.x * b;
        const z = bp.z + fw.z * a + lf.z * b;
        return V(x, g(x, z), z);
      };
      const fwYaw = Math.atan2(fw.x, fw.z);
      // the stage: Aragorn kneels at Boromir's left hand, Gimli stands at his right, Legolas a step behind Aragorn; the
      // camera works from the front (Boromir faces Lurtz's ground), so all four are in view with the body in the middle
      const arAt = spot(0.5, 1.05);
      const giAt = spot(0.7, -1.35);
      const legolasAt = spot(-0.2, 2.5);
      ar.aiEnabled = false;
      gi.aiEnabled = false;
      setAlly(gi, giAt, bp);
      player.teleport(legolasAt, yawOf(bp.x - legolasAt.x, bp.z - legolasAt.z));
      walkAlly(ar, arAt);
      const lp = boss!.enemy.position;
      const mid = V((bp.x + lp.x) / 2, 0, (bp.z + lp.z) / 2);
      // the clearing in one frame: Lurtz fallen, the four of them at the tree (17 m out, a little above the grass)
      shotFrom('out_wide', ring(mid, 17, 3.4, [0.5, -0.5, 1.2, -1.2, 0, 1.9]), V(mid.x, g(mid.x, mid.z) + 1.4, mid.z), V(mid.x, g(mid.x, mid.z) + 0.8, mid.z), 40);
      await level.wait(4.6);
      poseAlly(ar, 'kneel', 1e9);
      ar.object.rotation.y = yawOf(bp.x - ar.position.x, bp.z - ar.position.z);
      // the tableau: from the front, a low camera, Boromir's face and the three round him
      const head = V(bp.x, bp.y + 0.9, bp.z);
      const low = V(bp.x, bp.y + 0.45, bp.z);
      shotFrom('out_tab_far', ring(bp, 7.5, 1.35, [fwYaw - 0.3, fwYaw + 0.3, fwYaw - 0.8, fwYaw + 0.8]), head, low, 36);
      await level.wait(0.4);
      shotFrom('out_tab_near', ring(bp, 5.4, 1.15, [fwYaw - 0.3, fwYaw + 0.3, fwYaw - 0.9, fwYaw + 0.9]), head, V(bp.x, bp.y + 0.8, bp.z), 32, 4.5);
      await level.say('Boromir', 'They took the little ones. I tried to fight them all... I failed you.', 3.6);
      await level.say('Aragorn', 'No, Boromir. You kept your honour. Be at peace.', 3.2);
      // his body stays where he fell for the rest of the scene (the stock corpse sinks away after six seconds)
      (bm as unknown as { corpseTime: number }).corpseTime = -1;
      (bm as unknown as { kill(k: null): void }).kill(null);
      audio.play('bell', { volume: 0.5, pitch: 0.7 });
      await level.wait(1.8);
      // Legolas, in the light, the stream behind him; then the four of them
      const lface = V(legolasAt.x, legolasAt.y + 1.6, legolasAt.z);
      shotFrom('out_legolas', ring(legolasAt, 4.4, 1.55, [fwYaw + 0.5, fwYaw - 0.3, fwYaw + 1.0, fwYaw + 1.6, fwYaw - 1.0]), lface, V(legolasAt.x, legolasAt.y + 1.25, legolasAt.z), 30, 1.4);
      await level.say('Legolas', 'Frodo has gone. And the hobbits are taken.', 2.8);
      const group = V(bp.x + lf.x * 0.5, bp.y + 0.8, bp.z + lf.z * 0.5);
      shotFrom('out_group', ring(bp, 10.5, 1.45, [fwYaw - 0.15, fwYaw + 0.25, fwYaw - 0.6, fwYaw + 0.7, fwYaw - 1.1]), group, V(group.x, bp.y + 0.35, group.z), 36, 2.0);
      await level.say('Aragorn', 'We will not abandon Merry and Pippin.', 3.0);
      await level.say('Gimli', 'Not while there is an axe to swing.', 2.4);
      await level.wait(0.8);
      hushed?.();
      hushed = null;
      level.complete();
    }

    /** the whole chapter as one script; `from` is the checkpoint we resume at */
    async function run(from: number): Promise<void> {
      trace(`run from cp${from}`);
      if (from <= 0) {
        await intro();
        trace('woods');
        await woodsBeat();
        level.checkpoint(1);
      }
      if (from <= 1) {
        trace('ruins');
        await ruinsBeat();
        trace('descent');
        await descentBeat();
        level.checkpoint(2);
      }
      trace('lurtz intro');
      await lurtzIntro();
      trace('lurtz fight');
      await lurtzFight();
      trace(`finisher hp=${Math.round((boss?.hpFrac ?? 0) * 100)}%`);
      await finisher();
      trace('outro');
      await outro();
    }

    // ── the instance the shell drives ────────────────────────────────────
    const place = (p: THREE.Vector3, yaw: number): void => player.teleport(V(p.x, g(p.x, p.z), p.z), yaw);
    /** a point `ahead` metres further along a route than the player's nearest point on it */
    const _lead = new THREE.Vector3();
    const lookAhead = (route: Path, ahead: number): THREE.Vector3 => {
      const n = route.nearest(player.position.x, player.position.z);
      return route.at(Math.min(route.length, n.s + ahead), _lead);
    };

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        if (c === 0) place(L.spawn, 0);
        else if (c === 1) place(L.ruinsGate, 0);
        else place(L.clearingEntry, yawOf(L.lurtzMark.x - L.clearingEntry.x, L.lurtzMark.z - L.clearingEntry.z));
        const p = player.position;
        cast = spawnCast(level, p.clone().setY(0), c === 2 ? yawOf(L.lurtzMark.x - p.x, L.lurtzMark.z - p.z) : 0);
        void run(c);
      },

      update(): void {},

      dispose(): void {
        boromirBody?.dispose();
        boromirBody = null;
        drawHold?.stop();
        drawHold = null;
        hushed?.();
        hushed = null;
        player.invulnerable = false;
        ctx.time.setScale(1, 0.1);
      },

      botHint() {
        switch (beat) {
          case 'woods':
            return { moveTo: lookAhead(ASCENT_PATH, 9) };
          case 'ruins': {
            // a few stragglers left: go and find them, as a player would
            if (level.enemiesAlive() <= 3) {
              const foe = ctx.combatants.nearest('enemy', player.position, 80);
              if (foe) return { moveTo: foe.position };
            }
            return { moveTo: L.ruinsHold };
          }
          case 'run':
            return { moveTo: lookAhead(DESCENT_PATH, 9) };
          case 'clearing':
            return { moveTo: L.clearingEntry };
          case 'lurtz':
            return { moveTo: L.clearingHold };
          default:
            return null;
        }
      },
    };
  },
};
