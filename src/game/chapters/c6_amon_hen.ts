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

/** Lurtz's health: the bow phase takes about a third, the shield phase the rest */
const LURTZ_HP = 1300;

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
    level.setEnvironment({ ...base, sky, exposure: 1.08, hemiIntensity: 0.8, fog: { ...base.fog, density: 0.0105 } });
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
      // the Seat of Seeing in haze above the ruined stair, then down to the fellowship in the woods
      level.cameraShot({ position: V(-9, g(-9, 98) + 2.6, 98), lookAt: V(0, 39, 172), fov: 34, blend: 0 });
      await level.wait(0.4);
      level.cameraShot({ position: V(-4, g(-4, 104) + 3.4, 104), lookAt: V(0, 40, 172), fov: 32, blend: 3.6 });
      await level.wait(3.0);
      level.cameraShot({ position: V(s.x - 16, g(s.x - 16, s.z - 8) + 2.2, s.z - 8), lookAt: V(s.x + 2, g(s.x, s.z) + 3.5, s.z + 14), fov: 40, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: V(s.x - 7, g(s.x, s.z) + 1.9, s.z - 9), lookAt: V(s.x + 0.5, g(s.x, s.z) + 1.5, s.z + 2), fov: 40, blend: 6.5 });
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
      hud.toast('Shields stop frontal arrows: aim for the head, or flank', 'info');
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
        { role: 'archer', x: -22, z: 84 }, { role: 'archer', x: 22, z: 82 },
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
        { role: 'archer', x: -26, z: 76 }, { role: 'archer', x: 26, z: 74 }, { role: 'archer', x: 0, z: 108 },
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
      // the host of Isengard on the far bank of the stream, idle in the haze (it scatters when Lurtz falls)
      host = level.crowd({ center: V(8, 0, -132), halfSize: [58, 14], count: 90, kind: 'uruk', facing: 0, speed: 0, props: true });
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
      await level.waitUntil(() => lz.hpFrac <= 0.685 || !lz.enemy.alive || near > 5 || ctx.time.t - t1 > 85, 200);
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
      hud.toast('His shield stops frontal arrows: aim for the head, or get round him', 'info');
      // two of his guard come down from the woods to keep the others busy
      squad([{ role: 'blade', x: CLEARING.x - 26, z: -62 }, { role: 'shield', x: CLEARING.x + 24, z: -60 }]);
      await level.waitUntil(() => lz.hpFrac <= 0.152 || !e.alive, 400);
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
      // Aragorn crosses the clearing from Boromir's tree
      walkAlly(ar, V(lp.x - 1.7, lp.y, lp.z + 3.0));
      level.cameraShot({ position: V(lp.x + 7, lp.y + 1.2, lp.z + 6), lookAt: V(lp.x, lpy, lp.z), fov: 40, blend: 0 });
      await level.wait(1.5);
      e.playPose?.('kneel', 8);
      await level.say('Lurtz', 'You will not find them. The Halfling is Saruman\'s now.', 3.0);
      level.cameraShot({ position: V(lp.x - 6.5, lp.y + 1.5, lp.z + 6.5), lookAt: V(lp.x - 1, lpy, lp.z + 1), fov: 38, blend: 0 });
      await level.say('Aragorn', 'You have shed enough blood on this hill.', 2.4);

      // Legolas turns and draws
      const pp = player.position;
      const toL = yawOf(lp.x - pp.x, lp.z - pp.z);
      player.facing = toL;
      const hold = holdDraw();
      audio.play('bow_draw', { pos: pp, volume: 0.9 });
      const fwd = V(Math.sin(toL), 0, Math.cos(toL));
      const side = V(fwd.z, 0, -fwd.x);
      level.cameraShot({
        position: V(pp.x - fwd.x * 2.4 + side.x * 0.9, pp.y + 1.85, pp.z - fwd.z * 2.4 + side.z * 0.9),
        lookAt: V(lp.x, lpy, lp.z), fov: 32, blend: 0,
      });
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
      const mid = V((pp.x + lp.x) / 2, (pp.y + lp.y) / 2 + 1.4, (pp.z + lp.z) / 2);
      level.cameraShot({ position: V(mid.x + side.x * 5.5, mid.y + 0.3, mid.z + side.z * 5.5), lookAt: V(mid.x + fwd.x * 3, mid.y - 0.1, mid.z + fwd.z * 3), fov: 36, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: V(lp.x - fwd.x * 4.2 - side.x * 2.5, lp.y + 1.0, lp.z - fwd.z * 4.2 - side.z * 2.5), lookAt: V(lp.x, lpy, lp.z), fov: 34, blend: 0 });
      await level.wait(0.15);
      hold.stop();
      drawHold = null;
      // Aragorn's blade
      e.playPose?.('roar', 1.2);
      ar.aiEnabled = true;
      ar.anchor = lp.clone();
      level.cameraShot({ position: V(lp.x - 3.4, lp.y + 1.3, lp.z + 3.6), lookAt: V(lp.x, lpy + 0.1, lp.z), fov: 34, blend: 0 });
      await level.waitUntil(() => ar.position.distanceTo(e.position) < 2.9, 6);
      ctx.time.setScale(0.45, 0.1);
      // his sword comes down: the blow lands on the strike frame of Aragorn's own swing (or after 2 s regardless)
      const arAtk = (ar as unknown as { atk: { phase: string } }).atk;
      await level.waitUntil(() => arAtk.phase === 'strike', 2.2);
      e.takeDamage({ amount: 9999, type: 'melee', source: ar, point: lp.clone().setY(lpy + 0.3), dir: new THREE.Vector3(1, 0, -1).normalize(), zone: 'head', stagger: true });
      fx.blood(V(lp.x, lpy + 0.3, lp.z), V(0, 0.5, -1), 'black', 1.4);
      audio.play('sword_clash', { pos: lp, volume: 1, pitch: 0.8 });
      player.camera.shake(0.35, 0.5);
      host?.thin(0.85);
      await level.wait(0.7);
      ctx.time.setScale(1, 0.5);
      await level.wait(1.2);
      lz.stop();
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      const ar = cast!.aragorn;
      const gi = cast!.gimli;
      const bm = boromir!;
      level.cinematic(true);
      level.music?.('epic');
      level.objective(null);
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
      // while the camera is on the fallen Lurtz: Legolas and Gimli come to Boromir, Aragorn crosses the clearing
      ar.aiEnabled = false;
      gi.aiEnabled = false;
      setAlly(gi, spot(2.3, 0.6), bp);
      const legolasAt = spot(0.4, 2.7);
      player.teleport(legolasAt, yawOf(bp.x - legolasAt.x, bp.z - legolasAt.z));
      walkAlly(ar, spot(1.0, 0.5));
      const lp = boss!.enemy.position;
      const mid = V((bp.x + lp.x) / 2, 0, (bp.z + lp.z) / 2);
      level.cameraShot({ position: V(CLEARING.x + 18, g(CLEARING.x + 18, -60) + 2.6, -60), lookAt: V(mid.x, g(mid.x, mid.z) + 1.4, mid.z), fov: 40, blend: 0 });
      await level.wait(4.6);
      poseAlly(ar, 'kneel', 1e9);
      ar.object.rotation.y = yawOf(bp.x - ar.position.x, bp.z - ar.position.z);
      // the tableau, from the sunward side: Boromir's face lit gold
      const c1 = spot(7.5, -2.5);
      level.cameraShot({ position: V(c1.x, c1.y + 1.7, c1.z), lookAt: V(bp.x + fw.x * 0.5, bp.y + 1.1, bp.z + fw.z * 0.5), fov: 38, blend: 0 });
      await level.wait(0.4);
      const c2 = spot(4.0, -1.2);
      level.cameraShot({ position: V(c2.x, c2.y + 1.4, c2.z), lookAt: V(bp.x + fw.x * 0.4, bp.y + 1.0, bp.z + fw.z * 0.4), fov: 30, blend: 4.5 });
      await level.say('Boromir', 'They took the little ones. I tried to fight them all... I failed you.', 3.6);
      await level.say('Aragorn', 'No, Boromir. You kept your honour. Be at peace.', 3.2);
      (bm as unknown as { kill(k: null): void }).kill(null);
      audio.play('bell', { volume: 0.5, pitch: 0.7 });
      await level.wait(1.8);
      // Legolas, then the three of them against the low sun
      const lc = spot(0.4, 5.6);
      level.cameraShot({ position: V(lc.x, lc.y + 1.7, lc.z), lookAt: V(legolasAt.x, legolasAt.y + 1.6, legolasAt.z), fov: 30, blend: 1.4 });
      await level.say('Legolas', 'Frodo has gone. And the hobbits are taken.', 2.8);
      const c3 = spot(10, -4);
      level.cameraShot({ position: V(c3.x, c3.y + 1.3, c3.z), lookAt: V(bp.x, bp.y + 1.9, bp.z), fov: 36, blend: 2.0 });
      await level.say('Aragorn', 'We will not abandon Merry and Pippin.', 3.0);
      await level.say('Gimli', 'Not while there is an axe to swing.', 2.4);
      await level.wait(0.8);
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
      trace('finisher');
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
