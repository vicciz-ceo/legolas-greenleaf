/**
 * c0_arena: the dev arena, and THE REFERENCE CHAPTER for every story chapter author.
 *
 * Read this file top to bottom before writing a chapter. It shows, in the order a real chapter
 * needs them:
 *
 *   1. the ChapterDef (id, number, environment, checkpoints, par time, rivalry flag)
 *   2. building the level      terrain, props with colliders, lights come from the environment
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
 */
import * as THREE from 'three';
import type {
  ChapterDef, ChapterInstance, Enemy, LevelAPI, PlayerAPI, PlayerMover, Ally,
} from '../../core/types';
import { Rng } from '../../core/rng';
import { makeMaterial, TILE_METERS, type TextureSetName } from '../../world/textures';
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
// Materials. The world module gives ready-made PBR materials (procedural albedo + normal +
// roughness). Their textures are shared and cached, so call makeMaterial freely. Geometry should
// carry WORLD-SCALE UVs (uv = metres / TILE_METERS[name]) so texel density is the same everywhere:
// `boxUV` / `scaleUV` below bake that for the primitives this file builds. Prop builders from
// world/props already do it for you.
// ─────────────────────────────────────────────────────────────────────────────

/** world-scale UVs for a BoxGeometry(w, h, d): faces are px, nx, py, ny, pz, nz, 4 vertices each */
function boxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, name: TextureSetName): THREE.BoxGeometry {
  const t = TILE_METERS[name];
  const uv = geo.attributes.uv;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / t, (uv.getY(k) * dims[f][1]) / t);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** multiply every UV by (su, sv) tiles: for cylinders su = circumference / tile, sv = height / tile */
function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Building the level. Everything goes under level.root; colliders go to the shared physics.
// ─────────────────────────────────────────────────────────────────────────────

function buildLevel(level: LevelAPI): { shield: THREE.Object3D } {
  const { physics } = level.ctx;
  const rng = new Rng(2024);

  // Terrain: one call builds the mesh, registers the heightfield with physics (walkable ground,
  // arrow impacts, camera) and tells the FX where the ground is. The returned heightAt is what
  // you use to place props.
  const terrain = level.terrain({ size: 330, segments: 220, height: heightAt, style: 'plains', material: 'grass', center: [0, 60] });
  const ground = terrain.heightAt;

  // A prop that blocks movement and arrows: visible mesh + collider, built once, in one place.
  const stone = makeMaterial('stone_blocks');
  const wood = makeMaterial('wood_planks');
  const addBox = (x: number, z: number, hx: number, hy: number, hz: number, yaw: number, m: THREE.Material, surface: 'stone' | 'wood') => {
    const y = ground(x, z) + hy; // sit on the terrain
    const tex: TextureSetName = surface === 'stone' ? 'stone_blocks' : 'wood_planks';
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), hx * 2, hy * 2, hz * 2, tex), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    level.root.add(mesh);
    physics.addBox(mesh.position, [hx, hy, hz], yaw, { material: surface });
  };

  // Cover for the fights: a broken wall, a few crates and a ring of pillars.
  addBox(-14, 20, 3.2, 1.1, 0.5, 0.25, stone, 'stone');
  addBox(13, 24, 2.6, 0.9, 0.5, -0.3, stone, 'stone');
  addBox(5, 12, 0.6, 0.6, 0.6, 0.4, wood, 'wood');
  addBox(6.3, 13.1, 0.5, 0.5, 0.5, -0.2, wood, 'wood');
  const pillarGeo = scaleUV(new THREE.CylinderGeometry(0.55, 0.65, 5.5, 14), (Math.PI * 1.2) / TILE_METERS.stone_blocks, 5.5 / TILE_METERS.stone_blocks);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 34;
    const z = 22 + Math.sin(a) * 34;
    const p = new THREE.Mesh(pillarGeo, stone);
    p.position.set(x, ground(x, z) + 2.75, z);
    p.castShadow = p.receiveShadow = true;
    level.root.add(p);
    physics.addCylinder(x, z, 0.62, p.position.y - 2.75, p.position.y + 2.75, { material: 'stone' });
  }

  // A scattering of trees for scale. Shared geometry/material keeps the draw calls and memory low.
  // (Real chapters: use world/vegetation `forest()`, which is instanced and wind-animated.)
  const trunkGeo = scaleUV(new THREE.CylinderGeometry(0.28, 0.42, 6, 8), 2.2 / TILE_METERS.bark, 6 / TILE_METERS.bark);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 1);
  const bark = makeMaterial('bark');
  const leaves = makeMaterial('leaves', { repeat: [3, 3], tint: 0x9cc46a });
  for (let i = 0; i < 26; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = 52 + rng.float() * 40;
    const x = Math.cos(a) * r;
    const z = 40 + Math.sin(a) * r * 0.8;
    if (z > 62 && z < 175 && Math.abs(x) < 36) continue; // keep the slide lane clear
    const y = ground(x, z);
    const t = new THREE.Mesh(trunkGeo, bark);
    t.position.set(x, y + 3, z);
    const c = new THREE.Mesh(crownGeo, leaves);
    c.position.set(x, y + 7, z);
    c.scale.set(1 + rng.float() * 0.4, 0.9 + rng.float() * 0.5, 1 + rng.float() * 0.4);
    t.castShadow = c.castShadow = true;
    level.root.add(t, c);
    physics.addCylinder(x, z, 0.4, y, y + 6, { material: 'wood' });
  }

  // The shield for the slide, lying on the hilltop. A plain disc here; a real chapter would use a
  // prop builder. Keep a reference: the script rotates/hides it.
  const shield = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 28), makeMaterial('metal_dark'));
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: 0xb9a35a, metalness: 0.9, roughness: 0.35 }));
  boss.position.y = 0.06;
  disc.castShadow = true;
  shield.add(disc, boss);
  shield.position.set(L.shieldTop.x, ground(L.shieldTop.x, L.shieldTop.z) + 0.2, L.shieldTop.z);
  shield.rotation.z = 0.12;
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
