/**
 * c0_arena: the dev arena, and THE REFERENCE CHAPTER for every story chapter author.
 *
 * Read this file top to bottom before writing a chapter. It shows, in the order a real chapter
 * needs them:
 *
 *   1. the ChapterDef (id, number, environment, checkpoints, par time, rivalry flag, preload)
 *   2. building the level      terrain + WORLD BUILDERS (forest, grass, ruins, boulders, banners,
 *                              torches, crates) with their colliders; light comes from the
 *                              environment preset, fire light from fx.fire
 *   3. the script              ONE async function that reads like a screenplay
 *                              intro cinematic -> wave -> checkpoint -> wave -> checkpoint ->
 *                              mini-boss with a boss bar -> set-piece -> complete()
 *   4. start(cp)               how to resume the script from ANY checkpoint
 *   5. a PlayerMover           the 10 s shield-surf slide (same pattern as the barrel ride,
 *                              bat ride, climbs...)
 *   6. botHint()               how the smoke-test autopilot is guided through the beats
 *
 * Ground rules (see ARCHITECTURE.md and docs/CHAPTERS.md):
 *   - Talk to the game ONLY through the `LevelAPI` (`level`) and the `GameContext` (`level.ctx`).
 *     Never import game.ts.
 *   - Everything you create must live under `level.root` (or be registered through
 *     `level.spawnEnemy / spawnAlly / addCombatant / crowd / terrain`). The shell disposes it all
 *     for you when the level ends or the player respawns. A respawn is a FULL REBUILD: `create()`
 *     runs again and then `start(lastCheckpoint)`. Nothing survives, so never keep module-level
 *     mutable state.
 *   - `await level.wait()/waitUntil()/say()/wave()` run on GAME time (slow-mo, pause and hit-stop
 *     aware) and simply never resume after the level is disposed. You do not need to check
 *     `level.disposed` after an await, and you must not use setTimeout / requestAnimationFrame.
 *   - The shell already shows the chapter TITLE CARD (unless ?skipIntro=1) and starts the Gimli
 *     rivalry counter when `rivalry: true`. Do not do either yourself.
 *   - Honour `level.ctx.flags.skipIntro === '1'` for your own cinematic and dialogue, so the smoke
 *     test (which sets it) gets straight to the fight.
 *   - Use `level.rng()` for anything random that affects the level (seeded per chapter), never
 *     `Math.random()`.
 *   - Allocate vectors up front or per event, never per frame inside `update` / `onUpdate`.
 *
 * Scale reference: Legolas 1.85 m, Gimli 1.37 m, orcs 1.6-1.8 m, cave troll 4.5 m.
 *
 * The full handbook (LevelAPI cheat sheet, every world builder, custom creatures, movers, bosses,
 * cinematics, budgets, testing) is docs/CHAPTER_AUTHORING.md.
 */
import * as THREE from 'three';
import type {
  ChapterDef, ChapterInstance, Enemy, LevelAPI, PlayerAPI, PlayerMover, Ally,
} from '../../core/types';
import {
  addColliders, banner, barrel, boulderField, crate, forest, grassField, ruins, torch, type Built,
} from '../../world';
import { createWeapon } from '../../creatures/weapons';
import { clamp, dirFromYaw, lerp, smoothstep, yawOf } from '../../core/math';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Layout. Keep every coordinate in one table so the script, start(cp) and botHint() agree.
//    World axes: +Y up, the arena fight runs along +Z, the slide hill is far down +Z.
// ─────────────────────────────────────────────────────────────────────────────

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const L = {
  /** where Legolas starts (cp0). y = 0 is fine: spawn helpers lift points onto the terrain */
  spawn: V(0, 0, 0),
  /** the bot and the player hold this ground during fights */
  fightCenter: V(0, 0, 8),
  /** orc waves arrive from here (about 30 m from the spawn: room for archery) */
  waveSpots: [V(-9, 0, 30), V(0, 0, 33), V(9, 0, 30)],
  /** the cave troll steps out from here */
  trollSpot: V(0, 0, 46),
  /** top of the slide hill, the shield lies here. y comes from the terrain */
  shieldTop: V(0, 0, 164),
  /** the slide ends when the player passes this z */
  slideEndZ: 72,
};

/** checkpoint labels. Index 0 is always "the start". `level.checkpoint(i)` indexes this array. */
const CHECKPOINTS = ['Arrival', 'Second Wave', 'The Cave Troll', 'The Slide'];

/** terrain: gentle meadow around the fights, a bowl rim to keep the player in, and a long hill for the slide */
function heightAt(x: number, z: number): number {
  const meadow = Math.sin(x * 0.045) * 0.5 + Math.cos(z * 0.05 + 1.3) * 0.45 + Math.sin((x + z) * 0.11) * 0.18;
  // flatten the meadow where the fights happen so arrows and footing are predictable
  const flat = 1 - smoothstep(10, 60, Math.hypot(x, z - 24));
  let h = meadow * (1 - flat * 0.8);
  // the slide hill: z 70 -> 168 rises 14 m (about 8 degrees), a plateau on top
  h += 14 * smoothstep(70, 168, z) * (1 - smoothstep(30, 60, Math.abs(x)));
  // bowl rim
  const d = Math.hypot(x, z - 70);
  if (d > 118) h += (d - 118) * 0.55;
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Building the level with the WORLD BUILDERS (src/world, one import point: '../../world').
//
//    Every builder returns `{ object, colliders }` (a `Built`). The recipe is always the same:
//
//        const b = boulderField(area, count, sizeRange, ground, opts);   // build
//        level.root.add(b.object);                                        // show (auto-disposed)
//        addColliders(physics, b.colliders, b.object);                    // collide (auto-cleared)
//
//    - Scatter builders (forest, boulderField, ruins) place things in WORLD coordinates with the
//      object at the origin: never move their object. Single props (banner, torch, crate, barrel,
//      rock...) are built at the origin: position/rotate the object first, THEN call addColliders
//      with the object so the colliders follow it.
//    - Everything is instanced and uses shared, cached PBR materials (procedural albedo, normal,
//      roughness), so a few hundred trees or rocks cost a handful of draw calls.
//    - Density-scaled builders (forest, grassField, ferns) thin themselves on Low/Medium quality.
//    - Keep gameplay lanes clear with `exclude: (x, z) => boolean` instead of hand-placing.
// ─────────────────────────────────────────────────────────────────────────────

/** the open fighting ground: nothing tall may stand here (arrows need clear lines) */
const inFightZone = (x: number, z: number): boolean => Math.hypot(x, z - 18) < 21;
/** the slide lane down the hill must stay clear of trunks and rocks */
const inSlideLane = (x: number, z: number): boolean => z > 58 && z < 178 && Math.abs(x) < 30;
/** where waves walk in from, and the troll's straight run at the player */
const inSpawnLane = (x: number, z: number): boolean =>
  L.waveSpots.some((p) => Math.hypot(x - p.x, z - p.z) < 6) || (Math.abs(x - L.trollSpot.x) < 5 && z > 4 && z < L.trollSpot.z + 6);

function buildLevel(level: LevelAPI): { shield: THREE.Object3D } {
  const { physics, fx } = level.ctx;

  // Terrain: one call builds the mesh, registers the heightfield with physics (walkable ground,
  // arrow impacts, camera) and tells the FX where the ground is. The returned heightAt is what
  // you use to place everything else.
  // ~2 m cells are plenty for a gentle meadow (the terrain is drawn in the scene AND the GTAO pass:
  // 160 x 160 segments = 51 k triangles per pass; 220 would be 97 k)
  const terrain = level.terrain({ size: 330, segments: 160, height: heightAt, style: 'plains', material: 'grass', center: [0, 60], patchiness: 0.3 });
  const ground = terrain.heightAt;

  // ── vegetation ─────────────────────────────────────────────────────────
  // An instanced, wind-animated forest ringing the bowl. Trunk colliders come back in world space.
  const woods = forest(
    { center: new THREE.Vector3(0, 0, 70), halfSize: [150, 150] },
    260,
    [{ kind: 'beech', weight: 3 }, { kind: 'pine', weight: 2 }, 'birch'],
    ground,
    { seed: 4, exclude: (x, z) => Math.hypot(x, z - 24) < 52 || inSlideLane(x, z), lodNear: 60, lodFar: 260 },
  );
  level.root.add(woods.object);
  addColliders(physics, woods.colliders);

  // Grass blades around the fights (instanced chunks, wind, distance fade). No colliders: it is grass.
  // Grass is the most expensive thing in a meadow: keep the area to where the camera looks, the
  // density moderate (clumps per m², thinned again on Low/Medium) and the fade distance short.
  level.root.add(grassField({ center: new THREE.Vector3(0, 0, 22), halfSize: [40, 40] }, 0.85, ground, { seed: 2, dry: 0.25, fade: [18, 38] }));

  // ── stonework and cover ────────────────────────────────────────────────
  // Ruined Numenorean stonework around the field: wall stubs, columns, arches and rubble, with
  // colliders. `grandeur` trades low stubs for tall columns.
  const stones = ruins({ center: new THREE.Vector3(0, 0, 20), halfSize: [36, 30] }, 16, ground, {
    seed: 6,
    material: 'mossy',
    grandeur: 0.55,
    exclude: (x, z) => Math.hypot(x, z - 18) < 11 || inSpawnLane(x, z) || Math.hypot(x, z) < 6,
  });
  level.root.add(stones.object);
  addColliders(physics, stones.colliders);

  // Boulders to hide behind (the big ones get colliders; `colliderMin` sets the threshold).
  const boulders = boulderField({ center: new THREE.Vector3(0, 0, 24), halfSize: [44, 40] }, 34, [0.4, 1.6], ground, {
    seed: 9,
    moss: 0.5,
    exclude: (x, z) => Math.hypot(x, z - 10) < 7 || inSpawnLane(x, z) || inSlideLane(x, z),
  });
  level.root.add(boulders.object);
  addColliders(physics, boulders.colliders);

  // Single props: build at the origin, place the object, then add colliders WITH the object.
  const place = (b: Built, x: number, z: number, yaw = 0): Built => {
    b.object.position.set(x, ground(x, z), z);
    b.object.rotation.y = yaw;
    level.root.add(b.object);
    addColliders(physics, b.colliders, b.object);
    return b;
  };
  // the elves' little camp at the spawn: crates, a barrel, two banners and two lit torches
  place(crate(0.9, { seed: 1 }), 4.6, -2.2, 0.4);
  place(crate([0.8, 0.6, 0.8], { seed: 2 }), 5.6, -1.1, -0.2);
  place(barrel({ seed: 3 }), 3.6, -3.4);
  place(banner(0x2f5a34, 'none', { height: 3.4 }), -3.2, -3.5, 0.3);
  place(banner(0x2f5a34, 'none', { height: 3.4 }), 3.2, -4.5, -0.3);
  // the orcs' side: a war banner by each spawn lane
  for (const p of [L.waveSpots[0], L.waveSpots[2]]) place(banner(0x5a1a12, 'eye', { height: 3.8 }), p.x * 1.25, p.z + 4, Math.PI);
  // Torches: the prop carries a cheap animated flame mesh; fx.fire adds the flickering point light
  // and embers (the fx module enforces the per-quality light budget, so do not add raw lights).
  for (const [x, z] of [[-1.8, -3.0], [1.8, -3.0]]) {
    const t = place(torch({ lit: true, length: 1.5 }), x, z) as Built & { flameAnchor: THREE.Object3D };
    t.object.updateMatrixWorld(true);
    fx.fire(t.flameAnchor.getWorldPosition(new THREE.Vector3()), 0.35);
  }

  // The shield for the slide, lying face-up on the hilltop: the same model the characters carry
  // (src/creatures/weapons). Its face points along +X, so roll it onto its back. Keep a reference:
  // the script hides it when the player picks it up.
  const shield = createWeapon('shield', 2);
  shield.rotation.set(0, 0.4, Math.PI / 2);
  shield.position.set(L.shieldTop.x, ground(L.shieldTop.x, L.shieldTop.z) + 0.12, L.shieldTop.z);
  shield.traverse((o) => (o.castShadow = true));
  level.root.add(shield);

  return { shield };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The set-piece mover. A PlayerMover REPLACES default locomotion while installed: you write
//    player.position / velocity / facing yourself every frame. The player still handles aiming,
//    shooting, HUD and animation (pose). Return the mover; install it with `player.mover = m`
//    and remove it with `player.mover = null`.
// ─────────────────────────────────────────────────────────────────────────────

const SLIDE_SECONDS = 10;

function makeShieldSurf(level: LevelAPI, onDone: () => void): PlayerMover & { elapsed: number } {
  const { physics } = level.ctx;
  const heading = dirFromYaw(Math.PI); // down the hill: toward -Z
  const right = V(0, 0, 0);
  let finished = false;
  const mover: PlayerMover & { elapsed: number } = {
    elapsed: 0,
    pose: 'surf',
    poseT: () => clamp(mover.elapsed / SLIDE_SECONDS, 0, 1),
    allowShoot: true, // you may shoot while sliding; the arena has nothing to shoot, real chapters will
    allowMelee: false,
    allowJump: false,
    allowDash: false,
    lockCameraYaw: true, // the camera swings behind the slide direction
    camera: { distance: 4.8, height: 1.9, fov: 74 },
    update(dt, player: PlayerAPI, input) {
      mover.elapsed += dt;
      // speed ramps up over the first two seconds, then holds with a gentle surge
      const speed = lerp(2.5, 11, smoothstep(0, 2.2, mover.elapsed)) + Math.sin(mover.elapsed * 1.7) * 0.6;
      // steering: left/right input slides sideways. "right" for a character facing yaw f is (-cos f, 0, sin f)
      right.set(-Math.cos(player.facing), 0, Math.sin(player.facing));
      const lateral = input.moveX * 6.5;
      player.velocity.set(heading.x * speed + right.x * lateral, 0, heading.z * speed + right.z * lateral);
      player.position.x = clamp(player.position.x + player.velocity.x * dt, -26, 26);
      player.position.z += player.velocity.z * dt;
      // follow the terrain exactly (physics.heightAt includes the terrain heightfield)
      const y = physics.heightAt(player.position.x, player.position.z);
      player.velocity.y = (y - player.position.y) / Math.max(dt, 1e-4);
      player.position.y = y;
      player.facing = yawOf(heading.x, heading.z);
      if (!finished && (mover.elapsed >= SLIDE_SECONDS || player.position.z <= L.slideEndZ)) {
        finished = true;
        onDone();
      }
    },
  };
  return mover;
}

// ─────────────────────────────────────────────────────────────────────────────
// The chapter
// ─────────────────────────────────────────────────────────────────────────────

export const chapter: ChapterDef = {
  id: 'arena',
  number: 0, // 0 = dev arena. Story chapters are 1..9
  dev: true, // only listed with ?dev=1 (but ?chapter=arena always works)
  title: 'The Arena',
  film: 'Development',
  blurb: 'A test ground for every system: two waves, a cave troll, an ally, the Gimli wager and a shield slide.',
  environment: 'arena', // an EnvironmentName; pass a tweaked copy to level.setEnvironment() for custom lighting
  checkpoints: CHECKPOINTS,
  parTime: 150, // seconds, used for the rank
  rivalry: true, // the shell starts the Gimli counter (carrying the saved totals) and shows the banter
  // every humanoid kind this chapter spawns: meshed in worker threads behind the loading screen, so
  // spawning a wave mid-fight never hitches. (orc_archer is the 'orc' kind; Legolas is implicit.)
  preload: ['gimli', 'orc', 'goblin', 'troll'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1';

    // create() builds the world. It may be async (big builders) and runs behind the loading screen. Keep it free of gameplay: spawn enemies and run scripts from start().
    const { shield } = buildLevel(level);

    // ── script state, read by botHint() ────────────────────────────────────
    type Beat = 'intro' | 'fight' | 'troll' | 'walk' | 'surf' | 'outro';
    let beat: Beat = 'intro';
    let gimli: Ally | null = null;
    let troll: Enemy | null = null;
    let surfRequested = false;
    let surfDone = false;
    let surf: (PlayerMover & { elapsed: number }) | null = null;

    // ── helpers ──────────────────────────────────────────────────────────
    /** terrain height at a point (physics.heightAt is the one source of truth for ground) */
    const ground = (x: number, z: number) => ctx.physics.heightAt(x, z);
    /** the player's yaw to face a point */
    const faceTowards = (p: THREE.Vector3) => yawOf(p.x - L.spawn.x, p.z - L.spawn.z);

    const spawnGimli = (near: THREE.Vector3) => {
      // `rivalry: true` makes his kills feed the HUD counter. `anchor: 'player'` keeps him close.
      gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: 'player' }, near, faceTowards(L.waveSpots[1]));
    };

    // ── beats ────────────────────────────────────────────────────────────

    /** a cinematic intro with a camera move and a few lines. Skipped when ?skipIntro=1. */
    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true); // letterbox on, player controls and HUD off
      // A scripted shot. position/lookAt are world space; `blend` is the seconds to ease in.
      level.cameraShot({ position: V(18, 9, -16), lookAt: V(0, 1.6, 14), fov: 52, blend: 0 });
      await level.wait(0.4);
      level.cameraShot({ position: V(-7, 2.4, 6), lookAt: V(0, 1.5, 20), fov: 42, blend: 3.2 });
      await level.say('Legolas', 'Orcs on the wind. A score of them, at least.', 2.6);
      await level.say('Gimli', 'A fair wager, then. Let us see whose count is higher, laddie.', 3.2);
      level.cameraShot(null); // hand the camera back to the player (it blends)
      await level.wait(0.7);
      level.cinematic(false);
    }

    /** a wave: groups spawn together, then the promise resolves when the wave is dead */
    async function waveOne(): Promise<void> {
      beat = 'fight';
      level.objective('Defeat the orcs');
      await level.wave({
        groups: [
          { spec: { archetype: 'orc' }, count: 3, at: L.waveSpots, spread: 3 },
          { spec: { archetype: 'goblin' }, count: 2, at: L.waveSpots[1], spread: 4 },
        ],
        stagger: 2.5, // seconds between groups
        timeout: 90, // resolve anyway after this long, so a stuck enemy can never soft-lock the chapter
      });
    }

    async function waveTwo(): Promise<void> {
      beat = 'fight';
      level.objective('Hold the line');
      await level.wave({
        groups: [
          { spec: { archetype: 'orc' }, count: 4, at: L.waveSpots, spread: 4 },
          // archers keep their distance ('hold' behaviour) and need to be shot or flanked
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 2, at: [L.waveSpots[0], L.waveSpots[2]], spread: 2 },
        ],
        stagger: 3,
        timeout: 100,
      });
    }

    /** a mini-boss: spawn, bind the boss bar, wait for the kill, slow-mo flourish */
    async function trollFight(): Promise<void> {
      beat = 'troll';
      level.objective('Bring down the cave troll');
      troll = level.spawnEnemy({ archetype: 'troll', boss: true, name: 'Cave Troll' }, L.trollSpot, Math.PI);
      level.boss(troll, 'Cave Troll'); // the shell keeps the bar in sync with troll.hp every frame
      await level.say('Gimli', 'That one is mine! ...Or perhaps yours. Is it too late to share?', 2.6);
      await level.waitUntil(() => !troll!.alive);
      ctx.time.setScale(0.3, 0.15); // brief slow-mo on the killing blow
      await level.wait(0.35); // game time: this is ~1.2 s of real time at 0.3 scale
      ctx.time.setScale(1, 0.4);
      await level.say('Gimli', 'And that still only counts as one!', 2.4);
    }

    /** the set-piece: walk to the shield, press interact, slide for 10 s with a PlayerMover */
    async function slide(): Promise<void> {
      beat = 'walk';
      level.objective('Climb the hill and take the shield');
      // A repeating check that shows a prompt near the shield and listens for the interact edge.
      // onUpdate callbacks run in game time and are removed for you when the level is disposed.
      const stop = level.onUpdate(() => {
        const near = player.position.distanceTo(shield.position) < 3.2 && !surfRequested;
        ctx.hud.setPrompt(near ? 'interact' : null, 'Grab the shield');
        ctx.input.setInteractLabel(near ? 'Shield' : null); // label for the touch button
        if (near && ctx.input.state.interact) surfRequested = true;
      });
      await level.waitUntil(() => surfRequested);
      stop();
      ctx.hud.setPrompt(null);
      ctx.input.setInteractLabel(null);

      beat = 'surf';
      level.objective(null);
      shield.visible = false; // the player's own pose carries the shield now
      surf = makeShieldSurf(level, () => (surfDone = true));
      player.mover = surf;
      ctx.audio.play('shield_slide', { volume: 0.9 });
      await level.waitUntil(() => surfDone, SLIDE_SECONDS + 3);
      player.mover = null; // always release the mover, also on timeout
      player.camera.shake(0.25, 0.4);
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.objective(null);
      await level.say('Legolas', 'Forty-two, Master Dwarf. Count again.', 2.4);
      level.complete(); // shows the results, computes the rank, unlocks the next chapter
    }

    /**
     * The whole chapter as one readable script. `from` is the checkpoint we resume at, so every
     * beat before it is skipped. Each `level.checkpoint(n)` call is the moment checkpoint n is
     * reached: it autosaves and later respawns restart the script with from = n.
     */
    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await waveOne();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await waveTwo();
        level.checkpoint(2);
      }
      if (from <= 2) {
        await trollFight();
        level.checkpoint(3);
      }
      await slide();
      await outro();
    }

    // ── the instance the shell drives ────────────────────────────────────
    return {
      /**
       * Called once after create() and after the shell reset the player. Place the player for the
       * checkpoint and kick off the script. This MUST work for every checkpoint index: set up
       * allies, props and the player position exactly as the earlier beats would have left them.
       */
      start(cp: number): void {
        const at = [L.spawn, L.fightCenter, L.fightCenter, L.shieldTop][clamp(cp, 0, 3)];
        const facing = cp >= 3 ? Math.PI : 0;
        player.teleport(V(at.x, ground(at.x, at.z), at.z), facing);
        if (cp >= 3) {
          // the troll is "already dead" when resuming at the slide
          shield.visible = true;
          player.teleport(V(L.shieldTop.x, ground(L.shieldTop.x, L.shieldTop.z - 4), L.shieldTop.z - 4), Math.PI);
        }
        spawnGimli(V(at.x - 2.4, at.z, at.z === 0 ? -1.5 : at.z - 2));
        // fire and forget: the promise chain is the script. Errors surface in the console and fail
        // the smoke test, so do not swallow them.
        void run(cp);
      },

      /** per-frame game-time hook, in addition to level.onUpdate(). Usually empty. */
      update(): void {},

      dispose(): void {
        // Only needed for things the level cannot know about (global listeners, timers). Meshes,
        // colliders, enemies, allies, crowds and onUpdate callbacks are cleaned up by the shell.
      },

      /**
       * The smoke test autopilot asks this every frame. Return where to walk, optionally what to
       * look at, and whether to press interact / jump. Return null to let the bot just fight.
       * The bot already turns toward and shoots the nearest enemy by itself.
       */
      botHint() {
        switch (beat) {
          case 'fight':
            return { moveTo: L.fightCenter };
          case 'walk': {
            const near = player.position.distanceTo(shield.position) < 3;
            return { moveTo: shield.position, interact: near };
          }
          default:
            return null;
        }
      },
    };
  },
};
