/**
 * Chapter 3: Lake-town by Night (The Hobbit: The Desolation of Smaug).
 *
 * Esgaroth at night: stilt houses on the black lake, plank walkways and canals, lanterns and
 * braziers, mist on the water. Orc raiders creep over the rooftops toward Bard's house, where the
 * wounded Kili lies.
 *
 *   cp0 The Walkways   the main walk and the market: fights on the planks and from the roofs (Tauriel)
 *   cp1 Bard's House   defend the house in three waves (the dwarves help a little)
 *   cp2 Bolg           the duel on the quay (combo, grab, slam that breaks planks, charge); at 35 %
 *                      he breaks away: a cinematic, then the rooftop chase and the horse
 *
 * Falling in the lake is not death: Legolas swims back (swim.ts). The world is built in
 * laketown/world.ts, the boss in laketown/bolg.ts, the chase in laketown/chase.ts.
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Enemy, EnemySpec, LevelAPI } from '../../core/types';
import { clamp, yawOf } from '../../core/math';
import { ENVIRONMENTS } from '../../core/environment';
import { buildTown, type TownWorld } from './laketown/world';
import { createSwim } from './laketown/swim';
import { spawnBolg, type BolgBoss } from './laketown/bolg';
import { buildCourse, makeBolgRunner, makeChaseMover, type BolgRunner, type ChaseMover } from './laketown/chase';
import { createHorse, type HorseRig } from './laketown/horse';
import {
  BARD, BOT_ROUTE_1, CHASE_COVER, CHASE_ROOFS, CHASE_X, D, JETTY, L, PLATFORMS, V, platformRect, roofSpot, type HouseDef,
} from './laketown/layout';

const CHECKPOINTS = ['The Walkways', "Bard's House", 'Bolg'];

type Beat = 'intro' | 'walk' | 'market' | 'quay' | 'defend' | 'bolgIntro' | 'duel' | 'flee' | 'chase' | 'outro';

const ORC: EnemySpec = { archetype: 'orc' };
const GUNDABAD: EnemySpec = { archetype: 'gundabad' };
const GOBLIN: EnemySpec = { archetype: 'goblin' };
const ARCHER: EnemySpec = { archetype: 'orc_archer', behavior: 'hold' };

export const chapter: ChapterDef = {
  id: 'laketown',
  number: 3,
  title: 'Lake-town by Night',
  film: 'The Hobbit: The Desolation of Smaug',
  blurb: "Orcs crawl over the rooftops of Esgaroth toward Bard's house, where Kili lies wounded. Fight across the walkways, hold the house, and face Bolg on the quay before he flees across the roofs.",
  environment: 'laketown_night',
  checkpoints: CHECKPOINTS,
  parTime: 360,
  preload: ['tauriel', 'dwarf', 'gundabad', 'orc', 'goblin', 'bolg'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1';
    // the preset, a little brighter: the moon and sky fill so the planks read
    level.setEnvironment({ ...ENVIRONMENTS.laketown_night, sunIntensity: 1.5, hemiIntensity: 0.9, envIntensity: 0.9, exposure: 1.4 });
    const world: TownWorld = buildTown(level);
    const course = buildCourse();

    // ── state read by botHint() ─────────────────────────────────────────────
    let beat: Beat = 'intro';
    let tauriel: Ally | null = null;
    const dwarves: Ally[] = [];
    let kili: Ally | null = null;
    let boss: BolgBoss | null = null;
    let chase: ChaseMover | null = null;
    let runner: BolgRunner | null = null;
    let horse: HorseRig | null = null;
    let cineOn = false;

    // water lapping at the piles under the wind of the preset
    ctx.audio.loop('river', 0.09);
    const swim = createSwim(level, { enabled: () => !cineOn, allies: () => (tauriel ? [tauriel] : []), obstacles: world.houseRects });
    level.onUpdate((dt) => {
      world.update(dt);
      swim.update();
    });

    // ── helpers ────────────────────────────────────────────────────────────
    const groundY = (x: number, z: number) => ctx.physics.heightAt(x, z);
    void groundY;
    /** top surface (deck or roof) at x, z */
    const topY = (x: number, z: number): number => ctx.physics.ground(x, z, D + 10, 0)?.y ?? D;

    const cine = (on: boolean) => {
      cineOn = on;
      if (!quick || !on) level.cinematic(on);
    };

    const housesWhere = (pred: (h: HouseDef) => boolean): HouseDef[] => world.houses.filter(pred);
    const near = (x: number, z: number, r: number) => (h: HouseDef) => Math.hypot(h.x - x, h.z - z) < r;
    /** a spot on a house's roof: along the ridge, across (+1 = front edge toward the walkway) */
    const roofAt = (h: HouseDef, along: number, across: number): THREE.Vector3 => {
      const p = roofSpot(h, along, across, 0);
      p.y = topY(p.x, p.z) + 0.25;
      return p;
    };
    const cycle = <T,>(list: T[], n: number): T[] => Array.from({ length: n }, (_, i) => list[i % list.length]);

    const cinematicLine = async (who: string, text: string, secs?: number) => {
      await level.say(who, text, secs);
    };

    function spawnTauriel(near_: THREE.Vector3, facing = 0): void {
      tauriel = level.spawnAlly({ kind: 'tauriel', anchor: 'player' }, near_, facing);
    }

    /** Kili lies wounded in the open front room; Fili and Oin watch the door */
    function setupHouse(): void {
      if (kili) return;
      kili = level.spawnAlly({ kind: 'dwarf', name: 'Kíli', anchor: L.kili.clone() }, L.kili.clone(), Math.PI);
      kili.aiEnabled = false;
      (kili as unknown as { playSpecial(p: string, s: number): void }).playSpecial('sit', 1e9);
      const names = ['Fíli', 'Óin'];
      L.dwarves.forEach((p, i) => {
        const d = level.spawnAlly({ kind: 'dwarf', name: names[i], anchor: p.clone() }, p.clone(), Math.PI);
        dwarves.push(d);
      });
    }

    /** a fight: spawn the groups, wait until at most `until` remain (or the timeout) */
    async function fight(groups: { spec: EnemySpec; count: number; at: THREE.Vector3 | THREE.Vector3[]; spread?: number }[], o: { stagger?: number; until?: number; timeout?: number } = {}): Promise<void> {
      await level.wave({ groups, stagger: o.stagger ?? 2.5, until: o.until ?? 0, timeout: o.timeout ?? 75 });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // intro
    // ═══════════════════════════════════════════════════════════════════════
    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      cine(true);
      // the town from the water, the moon behind us
      level.cameraShot({ position: V(-34, 9.5, -92), lookAt: V(0, 3, -48), fov: 52, blend: 0 });
      await level.wait(0.5);
      level.cameraShot({ position: V(-16, 5.2, -80), lookAt: V(0, 2.4, -56), fov: 44, blend: 4.2 });
      await cinematicLine('Legolas', 'The orcs have crossed the water. They are already on the rooftops.', 3.4);
      level.cameraShot({ position: V(3.4, 2.1, -64), lookAt: V(0, 1.7, -70), fov: 40, blend: 1.4 });
      await cinematicLine('Tauriel', "They will go for Bard's house. Kíli is lying there.", 3.0);
      await cinematicLine('Legolas', 'Then we reach it first.', 2.0);
      level.cameraShot(null);
      await level.wait(0.8);
      cine(false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // beat 1: the walkways
    // ═══════════════════════════════════════════════════════════════════════
    async function beatWalkways(): Promise<void> {
      beat = 'walk';
      level.objective('Follow the main walkway north');
      await level.waitUntil(() => player.position.z > -57, 60);
      level.objective('Clear the walkway');
      ctx.hud.toast('Orcs on the rooftops', 'warning');
      // first contact: archers on the roofs either side, raiders dropping onto the planks
      const roofA = housesWhere((h) => h.run === 'A' && Math.abs(h.z + 46) < 12);
      const east = roofA.filter((h) => h.x > 0);
      const west = roofA.filter((h) => h.x < 0);
      const archerSpots = [...cycle(east, 1), ...cycle(west, 1)].map((h) => roofAt(h, 0.1, 0.4));
      const dropSpots = [...east.slice(0, 2), ...west.slice(0, 2)].map((h) => roofAt(h, -0.3, 0.9));
      void fight(
        [
          { spec: ARCHER, count: archerSpots.length, at: archerSpots, spread: 0.6 },
          { spec: ORC, count: 4, at: dropSpots, spread: 0.8 },
        ],
        { stagger: 1.2, timeout: 70 },
      );
      await level.wait(2.5);
      level.say('Tauriel', 'Above us. On the roofs!', 2.4);
      ctx.hud.setPrompt('jump', 'Double-jump from the crates to reach a roof');
      await level.wait(5);
      ctx.hud.setPrompt(null);
      await level.waitUntil(() => level.enemiesAlive() <= 1, 70);
      level.objective('Push on to the market');
      await level.waitUntil(() => player.position.z > -38, 90);

      // the side links: goblins scurry in from the west and east walks
      level.say('Legolas', 'They are coming along the side walks.', 2.4);
      await fight(
        [
          { spec: GOBLIN, count: 3, at: V(-22, D, -40), spread: 2 },
          { spec: GOBLIN, count: 3, at: V(22, D, -40), spread: 2 },
          { spec: GUNDABAD, count: 2, at: V(0, D, -58), spread: 1 },
        ],
        { stagger: 2, until: 1, timeout: 60 },
      );
      level.objective('Reach the market square');
      await level.waitUntil(() => player.position.z > -16, 90);
      await beatMarket();
    }

    async function beatMarket(): Promise<void> {
      beat = 'market';
      level.objective('Clear the market square');
      level.say('Tauriel', 'Take the high ground, I will cover you.', 2.6);
      const corners = housesWhere((h) => (h.run === 'SW' || h.run === 'SE') && Math.abs(h.z) < 26);
      const archers = corners.slice(0, 5).map((h) => roofAt(h, 0, 0.5));
      const droppers = housesWhere((h) => h.run === 'A' && h.z > -34 && h.z < -16).slice(0, 4).map((h) => roofAt(h, 0, 0.9));
      const flank = [V(-24.5, D, 0), V(24.5, D, 0)];
      await fight(
        [
          { spec: ARCHER, count: Math.min(4, archers.length), at: archers, spread: 0.4 },
          { spec: GUNDABAD, count: 4, at: flank, spread: 1.6 },
          { spec: ORC, count: 3, at: droppers.length ? droppers : [V(0, D, -16)], spread: 1 },
          { spec: GOBLIN, count: 3, at: V(0, D, 24), spread: 2 },
        ],
        { stagger: 3, until: 1, timeout: 95 },
      );
      level.objective("Reach Bard's house");
      await level.waitUntil(() => player.position.z > 25, 120);
      await level.say('Bard', 'Over here! The dwarves are inside. Hold the door!', 2.8);
      level.checkpoint(1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // beat 2: Bard's house
    // ═══════════════════════════════════════════════════════════════════════
    async function beatBard(first: boolean): Promise<void> {
      beat = 'defend';
      level.objective("Defend Bard's house");
      ctx.hud.setProgress("Bard's house", 0);
      if (!first) await level.say('Bard', 'They are on the roofs again! Hold the door!', 2.4);
      const rim = housesWhere((h) => h.run === 'SW' || h.run === 'SE' || h.run === 'B').filter((h) => h.z > 8).sort((a, b) => Math.hypot(a.x, a.z - 37.5) - Math.hypot(b.x, b.z - 37.5));
      const roofsFor = (n: number, across: number) => rim.slice(0, n).map((h) => roofAt(h, 0, across));

      // wave 1: along the side links and across the canal roofs
      await level.wait(1.5);
      level.say('Fíli', 'Stand clear of the door!', 2);
      await fight(
        [
          { spec: ORC, count: 4, at: L.westLink, spread: 1.4 },
          { spec: ORC, count: 4, at: L.eastLink, spread: 1.4 },
          { spec: ARCHER, count: 2, at: roofsFor(2, 0.4), spread: 0.5 },
        ],
        { stagger: 3.5, until: 1, timeout: 80 },
      );
      ctx.hud.setProgress("Bard's house", 0.34);
      level.say('Óin', 'The lad is burning up! Keep them off him!', 2.6);
      await level.wait(3.5);

      // wave 2: up the south walk and down from the roofs
      await fight(
        [
          { spec: GUNDABAD, count: 3, at: L.southWalk, spread: 1.4 },
          { spec: GOBLIN, count: 4, at: roofsFor(4, 0.95), spread: 0.8 },
          { spec: ARCHER, count: 3, at: roofsFor(3, 0.3).reverse(), spread: 0.5 },
        ],
        { stagger: 3.5, until: 1, timeout: 85 },
      );
      ctx.hud.setProgress("Bard's house", 0.67);
      level.say('Tauriel', 'Kíli stirs. The leaf is working.', 2.4);
      await level.wait(3.5);

      // wave 3: everything at once
      await fight(
        [
          { spec: GUNDABAD, count: 3, at: [L.westLink, L.eastLink], spread: 1.6 },
          { spec: ORC, count: 4, at: L.southWalk, spread: 2 },
          { spec: GOBLIN, count: 3, at: roofsFor(3, 0.95).reverse(), spread: 0.8 },
          { spec: ARCHER, count: 3, at: roofsFor(3, 0.3), spread: 0.5 },
        ],
        { stagger: 3, until: 0, timeout: 100 },
      );
      ctx.hud.setProgress(null);
      level.objective(null);
      await level.wait(1.2);
      level.checkpoint(2);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // beat 3: Bolg
    // ═══════════════════════════════════════════════════════════════════════
    const arena = platformRect(PLATFORMS.quay);

    async function beatBolg(): Promise<void> {
      beat = 'bolgIntro';
      level.objective(null);
      level.music?.('tension');
      // a drum from the south, then the shape of Bolg coming up the walk
      ctx.audio.play('horn_orc', { volume: 0.9 });
      ctx.audio.play('drums', { volume: 0.6 });
      boss = spawnBolg(level, L.bolgFrom, 0, { maxHp: 3400, quay: world.quay, arena: { x0: arena.x0 + 0.4, x1: arena.x1 - 0.4, z0: arena.z0 + 0.4, z1: arena.z1 - 0.4 } });
      boss.freeze();
      const bolg = boss.enemy;
      bolg.moveTarget = V(0, D, 27);
      bolg.aiEnabled = false;
      boss.onPhase2 = () => {
        void level.say('Bolg', 'Kill them! Kill them all!', 2.4);
        // archers on the rooftops open fire
        const rim = housesWhere((h) => h.run === 'SW' || h.run === 'SE').filter((h) => h.z > 14).sort((a, b) => Math.hypot(a.x, a.z - 37.5) - Math.hypot(b.x, b.z - 37.5));
        void fight(
          [
            { spec: ARCHER, count: 2, at: rim.slice(0, 2).map((h) => roofAt(h, 0, 0.4)), spread: 0.4 },
            { spec: GOBLIN, count: 2, at: rim.slice(2, 4).map((h) => roofAt(h, 0, 0.95)), spread: 0.4 },
          ],
          { stagger: 2.5, timeout: 60 },
        );
      };
      if (!quick) {
        cine(true);
        level.cameraShot({ position: V(-5, 2.6, 25), lookAt: V(0, 2.2, 16), fov: 46, blend: 0.0 });
        await level.wait(0.4);
        level.cameraShot({ position: V(-3.2, 1.7, 27.5), lookAt: V(0, 2.6, 22), fov: 36, blend: 4.5 });
        await level.wait(3.2);
        await cinematicLine('Bolg', "The dwarf's blood is mine. Stand aside, elf.", 3.0);
        await cinematicLine('Legolas', 'You will have to come through me.', 2.4);
        level.cameraShot(null);
        await level.wait(0.6);
        cine(false);
      } else {
        await level.wait(0.5);
      }
      bolg.moveTarget = null;
      level.music?.(null);
      beat = 'duel';
      level.objective('Defeat Bolg');
      level.boss(bolg, 'Bolg');
      boss.resume();
      // the fight is won at 35 %: floor his HP there
      boss.floor = 0.35;
      await level.waitUntil(() => !bolg.alive || bolg.hp <= bolg.maxHp * 0.355, 420);
      await flee();
    }

    // ── Bolg breaks away ──────────────────────────────────────────────────
    async function flee(): Promise<void> {
      beat = 'flee';
      if (!boss) return;
      const bolg = boss.enemy;
      boss.freeze();
      level.objective(null);
      ctx.hud.setPrompt(null);
      ctx.hud.setProgress(null);
      player.invulnerable = true;
      cine(true);
      const at = bolg.position.clone();
      // clear the quay so nothing else interrupts the moment
      for (const c of ctx.combatants.byTeam('enemy')) if (c !== bolg && c.alive) c.takeDamage({ amount: 1e5, type: 'scripted', source: null });
      if (!quick) {
        level.cameraShot({ position: V(at.x + 4.5, 2.2, at.z - 5.5), lookAt: V(at.x, 2.3, at.z), fov: 40, blend: 0.5 });
      }
      bolg.playPose?.('kneel', 1.6);
      await level.wait(1.0);
      ctx.audio.play('uruk_roar', { pos: bolg.position, volume: 1, pitch: 0.6 });
      player.camera.shake(0.4, 0.8);
      await cinematicLine('Bolg', 'This is not over, elf. Durin\'s line ends at dawn.', 3.2);
      // he turns, hurls the brazier at the house roofline and bolts for the rooftops
      bolg.playPose?.('roar', 1.2);
      await level.wait(0.9);
      await cinematicLine('Tauriel', 'He is running! Go, I will stay with Kíli.', 2.6);
      // swap the real Bolg for the runner puppet at the same place
      const pos = bolg.position.clone();
      level.boss(null);
      boss.stop();
      level.removeCombatant(bolg);
      boss = null;
      runner = makeBolgRunner(level, course, course.zStart + 0.5, CHASE_X);
      runner.body.root.position.set(pos.x, D, pos.z);
      // run him along the west link to the stage: a short scripted dash
      await runPuppetTo(pos, V(CHASE_X, D, 37.5));
      await runPuppetTo(V(CHASE_X, D, 37.5), V(CHASE_X, D, course.zStart + 4));
      if (!quick) {
        level.cameraShot({ position: V(CHASE_X + 3, D + 2.6, 34), lookAt: V(CHASE_X, D + 1.6, 44), fov: 48, blend: 0.8 });
      }
      await cinematicLine('Legolas', 'Not this time.', 1.8);
      level.cameraShot(null);
      player.invulnerable = false;
      await beatChase();
    }

    /** dash the runner puppet between two points (cinematic) */
    async function runPuppetTo(a: THREE.Vector3, b: THREE.Vector3): Promise<void> {
      if (!runner) return;
      const body = runner.body;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dur = len / 8.2;
      let t = 0;
      const anim = { speed: 8, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null, specialT: 0, lookAt: null } as Parameters<typeof body.animate>[1];
      const yaw = yawOf(b.x - a.x, b.z - a.z);
      let done = false;
      const stop = level.onUpdate((dt) => {
        t += dt;
        const k = clamp(t / dur, 0, 1);
        body.root.position.set(THREE.MathUtils.lerp(a.x, b.x, k), D, THREE.MathUtils.lerp(a.z, b.z, k));
        body.root.rotation.y = yaw;
        body.animate(dt, anim);
        if (k >= 1) done = true;
      });
      await level.waitUntil(() => done, dur + 3);
      stop();
    }

    // ── the rooftop chase ─────────────────────────────────────────────────
    async function beatChase(): Promise<void> {
      beat = 'chase';
      cine(false);
      level.music?.('combat');
      level.objective('Chase Bolg across the rooftops');
      player.teleport(V(CHASE_X, D, course.zStart), 0);
      let ended = false;
      chase = makeChaseMover(level, course, { onEnd: () => (ended = true) });
      player.mover = chase;
      // the puppet already stands a few metres ahead
      if (runner) runner.z = course.zStart + 5;
      player.camera.yaw = 0;
      level.cameraShot(null);

      const cover = CHASE_ROOFS;
      // orc groups appear as he reaches each stretch
      const waves: { at: number; groups: { spec: EnemySpec; count: number; at: THREE.Vector3[]; spread?: number }[] }[] = [
        { at: 1, groups: [{ spec: ARCHER, count: 3, at: coverSpots(-1, 2) }] },
        { at: 3, groups: [{ spec: GOBLIN, count: 2, at: [routeSpot(4, 0)] }, { spec: ARCHER, count: 2, at: coverSpots(1, 4) }] },
        { at: 5, groups: [{ spec: GUNDABAD, count: 2, at: [routeSpot(6, 0)] }, { spec: ARCHER, count: 3, at: coverSpots(-1, 6) }] },
        { at: 7, groups: [{ spec: GOBLIN, count: 3, at: [routeSpot(8, 0)] }, { spec: ARCHER, count: 3, at: coverSpots(1, 8) }] },
      ];
      let next = 0;
      const stop = level.onUpdate((dt) => {
        void dt;
        if (!chase) return;
        // mercy: the chase cannot kill him
        if (player.hp < 14) player.heal(14 - player.hp);
        const idx = cover.findIndex((r) => chase!.z < r.z + 4);
        const stretch = idx < 0 ? cover.length : idx;
        while (next < waves.length && stretch + 1 >= waves[next].at) {
          const w = waves[next++];
          void level.wave({ groups: w.groups.map((g) => ({ ...g })), stagger: 0.8, timeout: 40 });
        }
        if (runner) runner.update(dt, chase.z);
        const span = course.zEnd - course.zStart;
        ctx.hud.setProgress('Chase Bolg', clamp((chase.z - course.zStart) / span, 0, 1));
      });
      await level.waitUntil(() => ended, 150);
      stop();
      ctx.hud.setProgress(null);
      ctx.hud.setPrompt(null);
      await outro();
    }

    function routeSpot(i: number, across: number): THREE.Vector3 {
      const r = CHASE_ROOFS[Math.min(i, CHASE_ROOFS.length - 1)];
      return V(CHASE_X + across, topY(CHASE_X, r.z) + 0.3, r.z);
    }
    /** spots on the cover houses left (-1) or right (+1) of the course, near roof index i */
    function coverSpots(side: number, i: number): THREE.Vector3[] {
      const r = CHASE_ROOFS[Math.min(CHASE_ROOFS.length - 1, i)];
      const defs = CHASE_COVER.filter((c) => Math.sign(c.x - CHASE_X) === side && c.floors === 1)
        .sort((a, b) => Math.abs(a.z - r.z) - Math.abs(b.z - r.z))
        .slice(0, 3);
      const out: THREE.Vector3[] = [];
      defs.forEach((c, k) => {
        const z = c.z + (k - 1) * 1.4;
        const y = topY(c.x, z);
        out.push(V(c.x, Math.max(y, D + 2.4) + 0.3, z));
      });
      return out.length ? out : [V(CHASE_X + side * 11.5, D + 3, r.z)];
    }

    // ── outro: the horse ──────────────────────────────────────────────────
    async function outro(): Promise<void> {
      beat = 'outro';
      player.mover = null;
      chase = null;
      cine(true);
      player.teleport(V(CHASE_X, D, JETTY.b[1] - 8), 0);
      const jz = JETTY.b[1];
      // a horse waits at the shore end of the jetty; Bolg is already there
      horse = createHorse(level, V(CHASE_X, D, jz - 1.2));
      if (runner) runner.update(0.016, jz);
      level.cameraShot({ position: V(CHASE_X + 3.4, D + 1.7, jz - 11), lookAt: V(CHASE_X, D + 1.8, jz - 1), fov: 40, blend: 0.7 });
      await level.wait(0.8);
      if (runner) {
        // Bolg reaches the horse and mounts
        runner.z = jz - 7;
        const body = runner.body;
        const anim = { speed: 8, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null, specialT: 0, lookAt: null } as Parameters<typeof body.animate>[1];
        let t = 0;
        const stop = level.onUpdate((dt) => {
          t += dt;
          if (t < 1.4) {
            body.root.position.set(CHASE_X, D, THREE.MathUtils.lerp(jz - 7, jz - 1.8, t / 1.4));
            body.root.rotation.y = 0;
            body.animate(dt, anim);
          }
        });
        await level.wait(1.5);
        stop();
        horse.mount(body);
        ctx.audio.play('horse_neigh', { pos: horse.object.position, volume: 1 });
      }
      await level.wait(0.6);
      horse.gallop(V(CHASE_X, D, jz + 120), 13);
      level.cameraShot({ position: V(CHASE_X + 2.6, D + 1.5, jz - 6), lookAt: V(CHASE_X, D + 1.6, jz + 6), fov: 44, blend: 0.6 });
      ctx.audio.play('horse_neigh', { pos: horse.object.position, volume: 1, pitch: 0.9 });
      await level.wait(2.4);
      level.cameraShot({ position: V(CHASE_X + 2.2, D + 1.7, jz - 3.5), lookAt: V(CHASE_X, D + 1.6, jz + 12), fov: 48, blend: 2.4 });
      await level.wait(2.2);
      await cinematicLine('Legolas', "He's going north. I'll follow.", 3.0);
      level.cameraShot(null);
      await level.wait(0.4);
      cine(false);
      level.objective(null);
      level.music?.('epic');
      level.complete();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // the script
    // ═══════════════════════════════════════════════════════════════════════
    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await beatWalkways();
      }
      if (from <= 1) {
        if (from === 1) await level.wait(0.5);
        await beatBard(from === 0);
      }
      await beatBolg();
    }

    // debug hook for the test drivers (state of the script and the boss)
    (globalThis as unknown as { __laketown?: unknown }).__laketown = {
      get beat() {
        return beat;
      },
      get boss() {
        return boss;
      },
      get chase() {
        return chase;
      },
      world,
      swim,
    };

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        if (c === 0) {
          player.teleport(L.start.clone(), 0);
          spawnTauriel(V(2.2, D, -66.5), 0);
          // the dock fires (set in the world) light the moment: nothing else to place
        } else {
          setupHouse();
          player.teleport(V(0, D, c === 1 ? 31 : 33), 0);
          spawnTauriel(V(-2.4, D, c === 1 ? 29.4 : 31.4), 0);
        }
        if (c === 0) {
          // the house stands ready from the start, the dwarves arrive with the first beat
          setupHouse();
        }
        void run(c);
      },

      update(): void {},

      dispose(): void {
        // the player outlives the level: never leave him invulnerable, riding a mover or filmed
        player.mover = null;
        player.invulnerable = false;
        ctx.time.setScale(1, 0.1);
      },

      botHint() {
        const p = player.position;
        switch (beat) {
          case 'walk':
          case 'market':
          case 'quay': {
            // follow the centre line of the walkways
            for (const w of BOT_ROUTE_1) if (w.z > p.z + 4) return { moveTo: w };
            return { moveTo: V(0, D, 31) };
          }
          case 'defend':
          case 'duel':
          case 'bolgIntro':
            return { moveTo: V(0, D, 33.5) };
          case 'chase':
            if (chase) return { moveTo: V(CHASE_X, D, p.z + 12), jump: chase.toEdge < 5.5 };
            return null;
          default:
            return null;
        }
      },
    };
  },
};

void BARD;
void yawOf;
