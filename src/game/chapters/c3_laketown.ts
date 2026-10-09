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
 * Falling in the lake is not death: Legolas swims back (swim.ts), or hauls himself up through a hole in the
 * planks. The world is built in laketown/world.ts, the boss in laketown/bolg.ts, the chase in
 * laketown/chase.ts, the horse of the outro in laketown/horse.ts.
 *
 * Lighting note: the moon is to the south, so the cinematics put the camera on the moon side of the actors and
 * let the quay-mouth torches, the dock braziers and the jetty torches (fx.fire lights, nearest to the camera)
 * model the faces; an actor seen against the moon is a silhouette.
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
  BARD, BOT_ROUTE_1, CHASE_COVER, CHASE_LANE, CHASE_ROOFS, CHASE_X, D, JETTY, L, PLATFORMS, V, nearestDeckPoint, platformRect, roofSpot, type HouseDef,
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
    // (fewer drifting embers than the preset: one big ember next to the camera read as a floating orange orb;
    // a slightly deeper fog colour so the far lake is not a milky plane)
    level.setEnvironment({ ...ENVIRONMENTS.laketown_night, sunIntensity: 1.5, hemiIntensity: 1.0, envIntensity: 0.9, exposure: 1.4, weatherIntensity: 0.3, fog: { color: 0x0d1727, density: 0.0115 } });
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
    /** the market fight is over (what is left is out of reach on the roofs): the autopilot moves on */
    let marketDone = false;

    // water lapping at the piles under the wind of the preset
    ctx.audio.loop('river', 0.09);
    const swim = createSwim(level, { enabled: () => !cineOn, allies: () => (tauriel ? [tauriel] : []), obstacles: world.houseRects, quay: world.quay });
    level.onUpdate((dt) => {
      world.update(dt);
      swim.update();
    });

    // ── helpers ────────────────────────────────────────────────────────────
    /** top surface (deck or roof) at x, z */
    const topY = (x: number, z: number): number => ctx.physics.ground(x, z, D + 10, 0)?.y ?? D;

    const botGoal = new THREE.Vector3();
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
      // spawning settles onto the highest floor in reach (the upper storey): put him back on the ground floor
      kili.object.position.set(L.kili.x - 0.6, D + 0.3, L.kili.z);
      kili.velocity.set(0, 0, 0);
      // he lies on his back on the sickbed, head toward +x (the humanoid root is laid flat; the
      // ally AI turns the object toward the player each step, so the root cancels that turn)
      const lying = kili;
      const root = lying.humanoid.root;
      root.rotation.order = 'YXZ';
      level.onUpdate(() => {
        root.rotation.set(-Math.PI / 2, -Math.PI / 2 - lying.object.rotation.y, 0);
        root.position.set(0, 0.14, 0);
      });
      const names = ['Fíli', 'Óin'];
      L.dwarves.forEach((p, i) => {
        const d = level.spawnAlly({ kind: 'dwarf', name: names[i], anchor: p.clone() }, p.clone(), Math.PI);
        d.object.position.y = D;
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
      ctx.fx.setWeather('none'); // no stray ember in the first frames
      // 1. the town from the water, the moon behind us: the title card plays over this shot
      level.cameraShot({ position: V(-34, 9.5, -92), lookAt: V(0, 3, -48), fov: 52, blend: 0 });
      await level.wait(0.4);
      // 2. then up the main walk, low between the rows of houses: the lookouts creeping along the ridges ahead
      level.cameraShot({ position: V(-1.4, D + 3.2, -68), lookAt: V(2.5, 7.4, -32), fov: 44, blend: 4.6 });
      await level.wait(4.0);
      ctx.fx.setWeather('embers', 0.3);
      void level.say('Legolas', 'The orcs have crossed the water. They are already on the rooftops.', 3.2);
      level.cameraShot({ position: V(0.4, D + 2.7, -57), lookAt: V(-2.5, 7.6, -30), fov: 36, blend: 3.4 });
      await level.wait(3.4);
      // 3. close-ups, faces lit by the dock braziers (Tauriel is framed relative to herself: she moves about)
      if (tauriel) level.cameraShot({ position: V(0.5, 1.6, 2.1), lookAt: V(0, 1.62, 0), fov: 30, follow: tauriel.object, blend: 0 });
      await cinematicLine('Tauriel', "They will go for Bard's house. Kíli is lying there.", 3.0);
      level.cameraShot({ position: V(-1.3, D + 1.72, -64.9), lookAt: V(0, D + 1.68, -68.5), fov: 30, blend: 0 });
      await cinematicLine('Legolas', 'Then we reach it first.', 2.0);
      level.cameraShot(null);
      await level.wait(0.8);
      cine(false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // beat 1: the walkways
    // ═══════════════════════════════════════════════════════════════════════
    /** orcs creeping along the ridges toward Bard's house; they drop in when the player draws near */
    const lookouts: Enemy[] = [];
    function spawnLookouts(): void {
      // the two nearest houses either side of the main walk, just beyond the dock: close enough to read in the intro shots
      const hs = housesWhere((h) => h.run === 'A' && h.z > -62 && h.z < -34).sort((a, b) => a.z - b.z);
      const east = hs.filter((h) => h.x > 0);
      const west = hs.filter((h) => h.x < 0);
      const picks = [east[0], west[0], east[1], west[1]].filter((h): h is HouseDef => !!h);
      picks.forEach((h, i) => {
        // walk the ridge toward the front of the town (north): along the ridge direction
        const a = roofAt(h, -0.95, 0);
        const b = roofAt(h, 0.95, 0);
        const e = level.spawnEnemy({ archetype: i % 3 === 0 ? 'orc' : 'goblin', countsForRivalry: false }, a, yawOf(b.x - a.x, b.z - a.z));
        e.aiEnabled = false;
        (e as unknown as { speedMax: number }).speedMax = 0.8;
        e.moveTarget = b.clone();
        lookouts.push(e);
      });
    }
    function releaseLookouts(): void {
      for (const e of lookouts) {
        if (!e.alive) continue;
        e.aiEnabled = true;
        e.moveTarget = null;
        (e as unknown as { speedMax: number }).speedMax = 5.4;
      }
      lookouts.length = 0;
    }

    async function beatWalkways(): Promise<void> {
      beat = 'walk';
      level.objective('Follow the main walkway north');
      await level.waitUntil(() => player.position.z > -57, 60);
      releaseLookouts();
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
      // groups are placed relative to where the player is NOW: a player who ran ahead of the beat must not have a wave
      // land on top of him, so what normally comes from ahead (the south walk) comes from behind instead
      const pz = player.position.z;
      const centre = (h: HouseDef) => Math.hypot(h.x, h.z);
      const corners = housesWhere((h) => (h.run === 'SW' || h.run === 'SE') && Math.abs(h.z) < 26).sort((a, b) => centre(a) - centre(b));
      const archers = corners.slice(0, 5).map((h) => roofAt(h, 0, 0.5));
      const droppers = housesWhere((h) => h.run === 'A' && h.z > -34 && h.z < -16).slice(0, 4).map((h) => roofAt(h, 0, 0.9));
      const flank = [V(-24.5, D, 0), V(24.5, D, 0)];
      const goblinSpot = pz < 6 ? V(0, D, 24) : V(0, D, -14);
      await fight(
        [
          { spec: ARCHER, count: Math.min(4, archers.length), at: archers, spread: 0.4 },
          { spec: GUNDABAD, count: 4, at: flank, spread: 1.6 },
          { spec: ORC, count: 3, at: droppers.length ? droppers : [V(0, D, -16)], spread: 1 },
          { spec: GOBLIN, count: 3, at: goblinSpot, spread: 2 },
        ],
        { stagger: 3, until: 2, timeout: 75 },
      );
      marketDone = true;
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
          { spec: ARCHER, count: 2, at: roofsFor(2, 0.3).reverse(), spread: 0.5 },
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
          { spec: ARCHER, count: 2, at: roofsFor(2, 0.3), spread: 0.5 },
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
      bolg.moveTarget = V(0, D, 27.3);
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
        // from the quay mouth, low, the torches at the mouth lighting his face as he comes up the walk
        level.cameraShot({ position: V(-3.9, D + 1.0, 31.6), lookAt: V(0.2, D + 2.4, 23.5), fov: 40, blend: 0.0 });
        await level.wait(0.4);
        level.cameraShot({ position: V(-2.3, D + 1.3, 30.4), lookAt: V(0.2, D + 2.2, 27.0), fov: 32, blend: 4.0 });
        await level.wait(3.2);
        await cinematicLine('Bolg', "The dwarf's blood is mine. Stand aside, elf.", 3.0);
        // over his shoulder: Legolas, facing him, the quay and the house glow behind
        level.cameraShot({ position: V(1.6, D + 2.15, 25.2), lookAt: V(-0.1, D + 1.65, 33), fov: 34, blend: 0.0 });
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
      // let the last hit's flash clear before the first cinematic frame (it showed him flat orange)
      await level.wait(0.45);
      const at = bolg.position.clone();
      // clear the quay so nothing else interrupts the moment
      for (const c of ctx.combatants.byTeam('enemy')) if (c !== bolg && c.alive) c.takeDamage({ amount: 1e5, type: 'scripted', source: null });
      if (!quick) {
        // from the front and a little to the side: his face, the elf behind
        const f = (bolg as unknown as { facing: number }).facing;
        const fxd = Math.sin(f);
        const fzd = Math.cos(f);
        level.cameraShot({ position: V(at.x + fxd * 5.0 + fzd * 2.4, 1.9, at.z + fzd * 5.0 - fxd * 2.4), lookAt: V(at.x, 2.5, at.z), fov: 38, blend: 0.5 });
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
      runner = makeBolgRunner(level, course, course.zStart + 0.5, CHASE_LANE);
      runner.body.root.position.set(pos.x, D, pos.z);
      // run him along the west link to the stage: a short scripted dash
      await runPuppetTo(pos, V(CHASE_X, D, 37.5));
      await runPuppetTo(V(CHASE_X, D, 37.5), V(CHASE_X, D, 44));
      // Legolas is already at the foot of the stage: both in one wide shot from the water side
      player.teleport(V(CHASE_LANE, D, course.zStart), 0);
      if (!quick) {
        level.cameraShot({ position: V(CHASE_X + 11.5, D + 2.3, 37.8), lookAt: V(CHASE_X, D + 1.6, 37.8), fov: 46, blend: 0.8 });
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
      player.teleport(V(CHASE_LANE, D, course.zStart), 0);
      let ended = false;
      chase = makeChaseMover(level, course, { onEnd: () => (ended = true) });
      player.mover = chase;
      // the puppet already stands a dozen metres ahead, on the stage
      if (runner) runner.z = course.zStart + 12.5;
      let warned = false;
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
        if (runner) {
          runner.update(dt, chase.z);
          // he does not wait: every stumble shows as ground lost
          if (!warned && runner.z - chase.z > 26) {
            warned = true;
            ctx.hud.toast('Bolg is pulling away!', 'warning');
          }
        }
        const span = course.zEnd - course.zStart;
        ctx.hud.setProgress('Chase Bolg', clamp((chase.z - course.zStart) / span, 0, 1));
      });
      await level.waitUntil(() => ended, 150);
      stop();
      const stumbles = chase?.stumbles ?? 0;
      ctx.hud.setProgress(null);
      ctx.hud.setPrompt(null);
      await outro(stumbles);
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
    async function outro(stumbles = 0): Promise<void> {
      beat = 'outro';
      player.mover = null;
      chase = null;
      level.objective(null);
      ctx.hud.setPrompt(null);
      cine(true);
      const jz = JETTY.b[1];
      player.teleport(V(CHASE_X, D, jz - 8), 0);
      // a horse waits at the shore end of the jetty between the two torches; Bolg is already on his way to it
      horse = createHorse(level, V(CHASE_X, D, jz - 1.2));
      if (runner) runner.update(0.016, jz);
      // too many stumbles: he is already in the saddle when Legolas arrives
      const early = stumbles >= 3;
      // from the shore, low, looking back down the jetty: the torches on his face, the moon rim on his armour
      level.cameraShot({ position: V(CHASE_X - 2.6, D + 1.35, jz + 6.5), lookAt: V(CHASE_X, D + 1.9, jz - 3.5), fov: 40, blend: 0 });
      await level.wait(0.8);
      if (runner) {
        const body = runner.body;
        if (early) {
          horse.mount(body);
        } else {
          // Bolg reaches the horse and mounts
          runner.z = jz - 7;
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
        }
        ctx.audio.play('horse_neigh', { pos: horse.object.position, volume: 1 });
      }
      await level.wait(0.6);
      horse.gallop(V(CHASE_X, D, jz + 120), 13);
      // ride along behind him as he rears and sets off: the moon is at our back
      level.cameraShot({ position: V(3.1, 1.7, -5.4), lookAt: V(0, 2.2, 1.6), fov: 44, follow: horse.object, blend: 0.7 });
      ctx.audio.play('horse_neigh', { pos: horse.object.position, volume: 1, pitch: 0.9 });
      await level.wait(3.0);
      // and let him go: a wide, static view north, the rider small against the dark
      level.cameraShot({ position: V(CHASE_X + 6, D + 3.0, jz + 8), lookAt: V(CHASE_X, D + 2.4, jz + 80), fov: 40, blend: 1.6 });
      await level.wait(1.6);
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
        spawnLookouts();
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
    const hook = {
      get beat() {
        return beat;
      },
      get boss() {
        return boss;
      },
      get chase() {
        return chase;
      },
      get runnerZ() {
        return runner ? runner.z : null;
      },
      world,
      swim,
      level,
    };
    (globalThis as unknown as { __laketown?: unknown }).__laketown = hook;

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        if (c === 0) {
          player.teleport(L.start.clone(), 0);
          spawnTauriel(V(2.2, D, -66.5), 0);
          // the dock fires (set in the world) light the moment: nothing else to place
        } else {
          setupHouse();
          // (before Bolg he faces south, toward the walk the boss comes up)
          player.teleport(V(0, D, c === 1 ? 31 : 33), c === 1 ? 0 : Math.PI);
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
        // the debug hook must not keep the level, the world and the boss alive after the chapter ends
        const g = globalThis as unknown as { __laketown?: unknown };
        if (g.__laketown === hook) delete g.__laketown;
        // the player outlives the level: never leave him invulnerable, riding a mover or filmed
        player.mover = null;
        player.invulnerable = false;
        ctx.time.setScale(1, 0.1);
      },

      botHint() {
        const p = player.position;
        switch (beat) {
          case 'market': {
            if (marketDone) return { moveTo: V(0, D, 31) };
            // hunt down what is left (archers on the rooftops): walk to the deck nearest the closest foe
            let best: THREE.Vector3 | null = null;
            let bd = 1e9;
            for (const c of ctx.combatants.byTeam('enemy')) {
              if (!c.alive) continue;
              const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
              if (d < bd) {
                bd = d;
                best = c.position;
              }
            }
            if (best && bd > 13) return { moveTo: nearestDeckPoint(best.x, best.z, 1.2, botGoal) };
            for (const w of BOT_ROUTE_1) if (w.z > p.z + 4) return { moveTo: w };
            return { moveTo: V(0, D, 31) };
          }
          case 'walk':
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
            if (chase) return { moveTo: V(CHASE_LANE, D, p.z + 12), jump: chase.toEdge < 5.5 };
            return null;
          default:
            return null;
        }
      },
    };
  },
};

