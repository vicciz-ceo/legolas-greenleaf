/**
 * Chapter 4: Ravenhill (The Hobbit: The Battle of the Five Armies).
 *
 *   cp0 The Frozen Falls     Gundabad orcs on the ice river and the ruins, Tauriel at Legolas' side;
 *                            the ice is slippery; a Gundabad troll with a stone slab on its head charges.
 *   cp1 The Bat Ride         Legolas grabs the talons of a giant bat and is carried up the cliffs to the
 *                            tower, shooting bats and orc archers on the ledges.
 *   cp2 The Tower            Bolg, phase 1, on the watchtower's top floor: mace, chain lash, ground slam.
 *   cp3 The Falling Stones   The tower crown and the bridge come down. Climb the falling stones to the
 *                            east pinnacle; Bolg, phase 2; the knife finisher; the battle turns.
 *
 * Helpers: ./ravenhill/ (layout + terrain, world, bats + bat ride, Bolg, falling stones, ice), the bat
 * creature in src/creatures/bat.ts (lab: gundabad_bat, gundabad_bat_rider).
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ColliderHandle, Combatant, ChapterInstance, Enemy, EnvironmentPreset, LevelAPI } from '../../core/types';
import { ENVIRONMENTS } from '../../core/environment';
import { Path, addColliders, ringColliders, stoneBlock } from '../../world';
import { clamp, yawOf } from '../../core/math';
import { BRIDGE, BRIDGE_CX, CRAG, GAP_X0, L, PINNACLE, TOP_FLOOR_Y, TOP_HOLE, TOP_HOLE_R, TOWER, V, riverX } from './ravenhill/layout';
import { preloadHumanoids } from '../../creatures/humanoid';
import { buildRavenhill } from './ravenhill/world';
import { GiantBat, MountBat, batRide, type BatRide } from './ravenhill/bats';
import { spawnBolg, type BolgBoss } from './ravenhill/bolg';
import { createFallingStones } from './ravenhill/stones';
import { installIce } from './ravenhill/ice';

const CHECKPOINTS = ['The Frozen Falls', 'The Bat Ride', 'The Tower', 'The Falling Stones'];
const BOLG_HP = 3200;
/** Bolg's HP fraction at the end of the tower duel (phase 1 → 2) and when the finisher opens */
const PHASE1_END = 0.55;
const FINISHER_AT = 0.15;
const CLIMB_TIME = 42;
const TROLL_HP = 1800;

/** kill a combatant outright (BaseCombatant.kill; scripted damage as a fallback) */
function slay(c: Combatant, killer: Combatant | null): void {
  const k = c as Combatant & { kill?: (by: Combatant | null) => void };
  if (k.kill) k.kill(killer);
  else c.takeDamage({ amount: c.hp + 1e4, type: 'scripted', source: killer });
}

/** the gorge keeps the preset's thick snow haze; up on the heights the air clears a little */
const BASE = ENVIRONMENTS.ravenhill_winter;
/** a touch more depth in the shadows than the stock preset: dark rock against the snow, as in the film */
const GRADE = { ...BASE.grade, lift: [-0.012, -0.008, -0.002] as [number, number, number], saturation: 0.8 };
const ENV_GORGE: EnvironmentPreset = { ...BASE, fog: { color: 0xbac7d2, density: 0.0068 }, weatherIntensity: 0.7, exposure: 0.97, grade: GRADE };
const ENV_HEIGHTS: EnvironmentPreset = { ...BASE, fog: { color: 0xbcc8d3, density: 0.0056 }, weatherIntensity: 0.8, sunIntensity: 2.05, exposure: 0.97, grade: GRADE };
/** the establishing shot: a lull in the snow, so the tower on its crag reads from the gorge */
const ENV_CLEAR: EnvironmentPreset = { ...BASE, fog: { color: 0xb6c3cf, density: 0.0034 }, weatherIntensity: 0.4, sunIntensity: 2.1, exposure: 0.96, grade: GRADE };
/** the falling stones: the storm thins on the heights so the blocks hang dark against the abyss */
const ENV_SUMMIT: EnvironmentPreset = { ...BASE, fog: { color: 0xb8c5d1, density: 0.0036 }, weatherIntensity: 0.55, sunIntensity: 2.1, exposure: 0.96, grade: GRADE };
/** the outro over the valley: clearer still, the armies visible below */
const ENV_VALLEY: EnvironmentPreset = { ...BASE, fog: { color: 0xb4c0cc, density: 0.0022 }, weatherIntensity: 0.35, sunIntensity: 2.15, exposure: 0.96, grade: GRADE };

/**
 * The giant bat's root positions for the ride: from the falls up past the frozen curtain, over the
 * bridge, low over the high snowfields north of Ravenhill (where the orc archers hold the ledges,
 * 15–25 m below), round past the pinnacle and in to the tower. Legolas hangs ~3.3 m below the root.
 */
const HOVER = V(L.pickup.x, 2.6, L.pickup.z);
const RELEASE = V(CRAG.x + 5.2, TOP_FLOOR_Y + 3.6, CRAG.z - 0.6);
const RIDE_PTS: THREE.Vector3[] = [
  HOVER,
  V(riverX(54) + 1, 7.5, 54),
  V(2, 21, 62),
  V(2, 36, 71),
  V(2, 43, 84),
  V(-10, 52, 96),
  V(-11, 68, 106),
  V(-8, 64, 122),
  V(-2, 52, 142),
  V(14, 48, 162),
  V(34, 54, 162),
  V(44, 60, 140),
  V(24, 80, 124),
  V(-20, 83, 115),
  V(-46, 80, 112),
  RELEASE,
];
/** after the drop the bat climbs straight away from the camera, then off into the snow */
const EXIT_PTS: THREE.Vector3[] = [RELEASE, V(RELEASE.x - 1, RELEASE.y + 10, RELEASE.z - 5), V(CRAG.x + 4, TOP_FLOOR_Y + 26, CRAG.z - 24), V(-40, 100, 70), V(10, 120, 20)];
const APPROACH_PTS: THREE.Vector3[] = [V(-6, 48, 128), V(-2, 34, 96), V(riverX(64) + 2, 12, 64), HOVER];
/** orc archers on the ledges along the ride: 8–12 m off the flight line, 15–25 m below it (in range) */
const RIDE_ARCHERS: [number, number][] = [[-6, 80], [8, 100], [-23, 103], [11, 149], [12, 173], [39, 155], [54, 144], [32, 117], [-47, 120]];
/** the escort: hostile bats keep station around Legolas (lateral, up, ahead of him) and dive in turn */
const ESCORT: [number, number, number][] = [[-9, 5, 18], [10, 7, 24], [1, 10, 34]];
const ESCORT_LATE: [number, number, number][] = [[-12, 8, 30], [12, 4, 20]];

export const chapter: ChapterDef = {
  id: 'ravenhill',
  number: 4,
  title: 'Ravenhill',
  film: 'The Hobbit: The Battle of the Five Armies',
  blurb: 'A ruined watchtower above the frozen falls. Gundabad orcs on the ice, giant bats in the snow, and Bolg waiting at the top.',
  environment: 'ravenhill_winter',
  checkpoints: CHECKPOINTS,
  parTime: 420,
  rivalry: false,
  // the waves need every variation of the Gundabad orc and the orc; the one troll and Bolg are a
  // single body each, preloaded below (one bucket instead of four: a third less loading)
  preload: ['tauriel', 'gundabad', 'orc'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const { player, hud, audio, fx, physics } = ctx;
    const quick = ctx.flags.skipIntro === '1';
    const singles = ctx.flags.preload === '0' ? Promise.resolve() : Promise.all([preloadHumanoids(['troll'], { seeds: [41] }), preloadHumanoids(['bolg'], { seeds: [3] })]).then(() => undefined, (e) => console.warn('[ravenhill] preload', e));
    level.setEnvironment(ENV_GORGE);
    const camBase = { ...player.camera.params };
    const world = buildRavenhill(level);
    const ground = world.ground;
    const ice = installIce(level);

    let summitGate: ColliderHandle[] = [];
    // keep the duel arenas: an invisible rim round the tower's top floor (its east wall is lower
    // than the floor) and round the pinnacle summit (open where the stones arrive)
    {
      const tw = ringColliders(CRAG.x, CRAG.z, TOWER.r - 1.0, TOWER.r - 0.7, TOP_FLOOR_Y, TOP_FLOOR_Y + 1.6, 28, { blocksArrows: false, blocksCamera: false, walkable: false, tag: 'tower_rim' });
      addColliders(physics, tw);
      const sm = ringColliders(PINNACLE.x, PINNACLE.z, PINNACLE.r + 0.2, PINNACLE.r + 0.6, PINNACLE.y - 0.5, PINNACLE.y + 1.6, 26, { blocksArrows: false, blocksCamera: false, walkable: false, tag: 'summit_rim' });
      const westGap = (d: (typeof sm)[number]) => {
        if (d.kind !== 'box') return false;
        const a = Math.atan2(d.center[2] - PINNACLE.z, d.center[0] - PINNACLE.x);
        return Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) <= 0.42;
      };
      addColliders(physics, sm.filter((d) => !westGap(d)));
      summitGate = addColliders(physics, sm.filter(westGap));
      for (const h of summitGate) h.enabled = false;
    }

    type Beat = 'intro' | 'falls' | 'troll' | 'grab' | 'ride' | 'tower' | 'collapse' | 'climb' | 'summit' | 'finish' | 'outro';
    let beat: Beat = 'intro';
    let beatSeen: Beat | null = null;
    // arena recovery: a knock-back off the tower floor or the pinnacle never strands Legolas (or Bolg)
    let lowT = 0;
    level.onUpdate((dt) => {
      if (beat !== beatSeen) {
        beatSeen = beat;
        if (ctx.flags.bot === '1') console.info(`[ravenhill] beat ${beat} t=${ctx.time.t.toFixed(1)}`);
      }
      const arena = beat === 'tower' ? { y: TOP_FLOOR_Y, safe: L.towerDrop, boss: L.bolgTower } : beat === 'summit' || beat === 'finish' ? { y: PINNACLE.y, safe: L.summit, boss: L.bolgSummit } : null;
      if (!arena) {
        lowT = 0;
        return;
      }
      lowT = player.position.y < arena.y - 3 && !player.mover ? lowT + dt : 0;
      if (lowT > 1.5) {
        lowT = 0;
        player.teleport(arena.safe, faceTo(arena.safe, arena.boss));
        hud.toast('Legolas leaps back up', 'info');
      }
      const e = bolg?.enemy;
      if (e && e.alive && e.position.y < arena.y - 3) {
        e.object.position.copy(arena.boss);
        e.velocity.set(0, 0, 0);
      }
    });
    let tauriel: Ally | null = null;
    let mount: MountBat | null = null;
    let ride: BatRide | null = null;
    let bolg: BolgBoss | null = null;
    let grabbed = false;
    let finisherGo = false;
    const stones = createFallingStones(level);
    level.onUpdate((dt) => stones.update(dt));
    const rideFoes: (Enemy | GiantBat)[] = [];
    const tmp = new THREE.Vector3();

    const faceTo = (from: THREE.Vector3, to: THREE.Vector3) => yawOf(to.x - from.x, to.z - from.z);

    // ── falling debris (crown blocks, gap chunks) ─────────────────────────
    const debris: { object: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; floorY: number }[] = [];
    level.onUpdate((dt) => {
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.vel.y -= 20 * dt;
        d.object.position.addScaledVector(d.vel, dt);
        d.object.rotation.x += d.spin.x * dt;
        d.object.rotation.z += d.spin.z * dt;
        if (d.object.position.y < d.floorY) {
          fx.dust(d.object.position, 8, 0xd8dde2);
          audio.play('stone_crumble', { pos: d.object.position, volume: 0.6, pitch: 0.7 + Math.random() * 0.3 });
          d.object.visible = false;
          debris.splice(i, 1);
        }
      }
    });
    const drop = (o: THREE.Object3D, vx: number, vz: number) => {
      o.visible = true;
      debris.push({ object: o, vel: V(vx, 1 + Math.random() * 2, vz), spin: V((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3), floorY: ground(o.position.x, o.position.z) });
    };

    // ── Tauriel ───────────────────────────────────────────────────────────
    const spawnTauriel = (at: THREE.Vector3, facing: number) => {
      tauriel = level.spawnAlly({ kind: 'tauriel', name: 'Tauriel', anchor: 'player' }, at, facing);
    };

    // ─────────────────────────────────────────────────────────────────────
    // cp0: The Frozen Falls
    // ─────────────────────────────────────────────────────────────────────
    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true);
      // establishing: a lull in the snow. From above the frozen falls, ~60 m out, the ruined tower on
      // its crag and the bridge to the pinnacle, the camera drifting in
      level.setEnvironment(ENV_CLEAR);
      level.cameraShot({ position: V(8, 47, 58), lookAt: V(CRAG.x + 6, CRAG.y + 12, CRAG.z), fov: 44, blend: 0 });
      await level.wait(0.4);
      level.cameraShot({ position: V(-6, 50, 70), lookAt: V(CRAG.x + 2, CRAG.y + 14, CRAG.z), fov: 40, blend: 4.2 });
      await level.say('Tauriel', 'Gundabad orcs. They have taken the old watchtower.', 3.2);
      // down on the ice: the two elves at the mouth of the gorge, face on (Legolas left, Tauriel right)
      level.setEnvironment(ENV_GORGE);
      const mid = V(L.spawn.x - 1.2, 1.5, L.spawn.z - 1);
      const tz = tauriel as Ally | null;
      if (tz) {
        // she holds her mark for the shot
        tz.aiEnabled = false;
        tz.object.position.set(L.spawn.x - 2.2, tz.position.y, L.spawn.z - 0.8);
        tz.velocity.set(0, 0, 0);
        (tz as Ally & { facing?: number }).facing = 0;
      }
      player.facing = 0;
      level.cameraShot({ position: V(mid.x + 0.6, 1.62, mid.z + 5.2), lookAt: mid, fov: 40, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: V(mid.x + 1.1, 1.7, mid.z + 4.2), lookAt: V(mid.x, 1.55, mid.z), fov: 37, blend: 2.6 });
      await level.say('Legolas', 'Bolg is up there. We go through them, across the ice.', 3);
      if (tz) tz.aiEnabled = true;
      level.cameraShot(null);
      await level.wait(0.6);
      level.cinematic(false);
    }

    async function iceFight(): Promise<void> {
      beat = 'falls';
      // the hint first, then the objective (both sit in the top band: never at the same time)
      level.objective(null);
      hud.toast('Slippery ice: you slide when you stop or turn', 'info');
      void level.wait(3.3).then(() => {
        if (beat === 'falls') level.objective('Cross the frozen river');
      });
      await level.wave({
        groups: [
          { spec: { archetype: 'gundabad' }, count: 3, at: L.fallsSpawn, spread: 3 },
          { spec: { archetype: 'orc' }, count: 3, at: [...L.bankSpawnW, ...L.bankSpawnE], spread: 2 },
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 2, at: [L.archerSpots[0], L.archerSpots[1]], spread: 1 },
        ],
        stagger: 2,
        until: 2,
        timeout: 80,
      });
      if (!quick) void level.say('Tauriel', 'More of them, from the falls!', 2.2);
      level.objective('Hold the ice');
      await level.wave({
        groups: [
          { spec: { archetype: 'gundabad' }, count: 4, at: L.fallsSpawn, spread: 3 },
          { spec: { archetype: 'orc' }, count: 4, at: [...L.bankSpawnE, ...L.bankSpawnW], spread: 2.5 },
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 2, at: [L.archerSpots[2], L.archerSpots[0]], spread: 1 },
        ],
        stagger: 2.5,
        until: 2,
        timeout: 95,
      });
      // the last of them come down off the ruins on both banks at once
      if (!quick) void level.say('Legolas', 'On the banks! Above you!', 2);
      level.objective('Clear the banks');
      await level.wave({
        groups: [
          { spec: { archetype: 'gundabad', behavior: 'flank' }, count: 3, at: [...L.bankSpawnW, ...L.bankSpawnE], spread: 2 },
          { spec: { archetype: 'orc' }, count: 3, at: L.fallsSpawn, spread: 3 },
          { spec: { archetype: 'gundabad' }, count: 2, at: L.fallsSpawn, spread: 2 },
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 2, at: [L.archerSpots[1], L.archerSpots[2]], spread: 1 },
        ],
        stagger: 2,
        until: 0,
        timeout: 100,
      });
    }

    async function trollFight(): Promise<void> {
      beat = 'troll';
      level.objective('Bring down the Gundabad troll');
      audio.play('troll_roar', { pos: L.trollSpot, volume: 1, pitch: 0.85 });
      player.camera.shake(0.3, 0.8);
      const troll = level.spawnEnemy({ archetype: 'troll', boss: true, name: 'Gundabad Troll', hp: TROLL_HP, seed: 41 }, L.trollSpot, Math.PI);
      level.boss(troll, 'Gundabad Troll');
      // the slab of stone strapped to its head (a living battering ram)
      const slab = stoneBlock([1.25, 0.42, 0.95], 9, { kind: 'dark' });
      slab.object.position.set(0, 0.32, 0.02);
      slab.object.traverse((o) => (o.castShadow = true));
      troll.humanoid.bones.head.add(slab.object);
      if (!quick) void level.say('Legolas', 'Troll! Stay clear of its charge!', 2.2);
      // the charge: lower the slab, thunder across the ice, stagger when it misses
      type Charge = 'idle' | 'wind' | 'run' | 'stun';
      let cs: Charge = 'idle';
      let ct = 0;
      let next = 3.5;
      let hit = false;
      const dest = new THREE.Vector3();
      const tr = troll as Enemy & { speedMax: number };
      const baseSpeed = tr.speedMax;
      let warned = false;
      const stop = level.onUpdate((dt) => {
        if (!troll.alive) return;
        ct += dt;
        const d = Math.hypot(player.position.x - troll.position.x, player.position.z - troll.position.z);
        switch (cs) {
          case 'idle':
            next -= dt;
            if (next <= 0 && d > 7 && d < 34 && !troll.attacking && player.alive) {
              cs = 'wind';
              ct = 0;
              troll.aiEnabled = false;
              troll.moveTarget = null;
              troll.playPose?.('roar', 1.1);
              audio.play('troll_roar', { pos: troll.position, volume: 1, pitch: 0.75 });
              if (!warned) {
                warned = true;
                hud.toast('The troll lowers its head: dash aside!', 'warning');
              }
            }
            break;
          case 'wind':
            if (ct > 1.1) {
              cs = 'run';
              ct = 0;
              hit = false;
              tmp.copy(player.position).sub(troll.position).setY(0).normalize();
              dest.copy(player.position).addScaledVector(tmp, 9);
              dest.x = clamp(dest.x, riverX(dest.z) - 10, riverX(dest.z) + 10);
              troll.moveTarget = dest;
              tr.speedMax = 17;
            }
            break;
          case 'run': {
            if (ct % 0.3 < dt) {
              fx.dust(troll.position, 6, 0xe8eef2);
              audio.play('troll_step', { pos: troll.position, volume: 1 });
            }
            if (d < 2.9 && !hit && player.alive) {
              hit = true;
              tmp.copy(player.position).sub(troll.position).setY(0).normalize();
              player.takeDamage({ amount: 28, type: 'blunt', source: troll, point: player.position.clone().setY(player.position.y + 1), dir: tmp.clone(), knockback: 9, stagger: true });
              player.camera.shake(0.6, 0.5);
            }
            const speed = Math.hypot(troll.velocity.x, troll.velocity.z);
            if (ct > 3.2 || troll.position.distanceTo(dest) < 1.6 || (ct > 0.8 && speed < 1.5) || hit) {
              cs = 'stun';
              ct = 0;
              tr.speedMax = baseSpeed;
              troll.moveTarget = null;
              troll.playPose?.('stagger', 2.2);
              audio.play('troll_hit', { pos: troll.position, volume: 1 });
              fx.debris(troll.position, 10, 0xc8d0d8);
              fx.dust(troll.position, 14, 0xe8eef2);
              player.camera.shake(0.35, 0.4);
            }
            break;
          }
          case 'stun':
            if (ct > 2.2) {
              cs = 'idle';
              next = 4.5 + level.rng() * 3;
              troll.aiEnabled = true;
            }
            break;
        }
      });
      await level.waitUntil(() => !troll.alive, 240);
      stop();
      if (troll.alive) slay(troll, player);
      tr.speedMax = baseSpeed;
      ctx.time.setScale(0.3, 0.15);
      await level.wait(0.35);
      ctx.time.setScale(1, 0.4);
      player.camera.shake(0.5, 0.8);
      if (!quick) await level.say('Tauriel', 'Legolas, the tower! Bolg is there, above the falls.', 2.8);
    }

    // ─────────────────────────────────────────────────────────────────────
    // cp1: The Bat Ride
    // ─────────────────────────────────────────────────────────────────────
    function spawnMount(arrived: boolean): MountBat {
      const m = new MountBat(level, 7);
      if (arrived) m.fly(HOVER, V(0, 0, -1), 0, 'fly');
      return m;
    }

    async function batArrives(m: MountBat): Promise<void> {
      // the bat swoops down from above the falls and hovers over the ice
      const path = new Path(APPROACH_PTS);
      let s = 0;
      const p = new THREE.Vector3();
      const t = new THREE.Vector3();
      audio.play('bat_screech', { pos: APPROACH_PTS[0], volume: 1, pitch: 0.8 });
      await new Promise<void>((resolve) => {
        const stop = level.onUpdate((dt) => {
          s = Math.min(path.length, s + dt * (6 + 14 * Math.min(1, (path.length - s) / 20)));
          path.at(s, p);
          path.tangent(s, t);
          m.fly(p, t, dt, s < path.length * 0.6 ? 'glide' : 'fly');
          if (s >= path.length) {
            stop();
            resolve();
          }
        });
      });
    }

    async function batRideBeat(): Promise<void> {
      beat = 'grab';
      if (!mount) {
        mount = spawnMount(false);
        level.objective('Get under the giant bat');
        await batArrives(mount);
      }
      const m = mount;
      level.objective('Grab the bat');
      if (tauriel) tauriel.anchor = V(L.pickup.x - 3, 0, L.pickup.z - 6);
      if (!quick) void level.say('Tauriel', 'Go! I will hold the ice.', 2);
      // hover until Legolas leaps for the talons
      let t = 0;
      const p = new THREE.Vector3();
      const stopHover = level.onUpdate((dt) => {
        t += dt;
        p.copy(HOVER);
        p.y += Math.sin(t * 1.8) * 0.25;
        p.x += Math.sin(t * 0.7) * 0.4;
        m.fly(p, tmp.set(Math.sin(t * 0.3) * 0.3, 0, -1), dt, 'fly');
        if (Math.floor(t / 3.2) !== Math.floor((t - dt) / 3.2)) audio.play('bat_screech', { pos: p, volume: 0.6, pitch: 0.9 });
        const near = Math.hypot(player.position.x - HOVER.x, player.position.z - HOVER.z) < 3.4 && player.alive;
        hud.setPrompt(near ? 'interact' : null, 'Leap for the talons');
        ctx.input.setInteractLabel(near ? 'Grab' : null);
        if (near && ctx.input.state.interact) grabbed = true;
      });
      await level.waitUntil(() => grabbed);
      stopHover();
      hud.setPrompt(null);
      ctx.input.setInteractLabel(null);

      // ── the ride ──
      beat = 'ride';
      level.objective('Shoot bats and archers');
      level.setEnvironment(ENV_HEIGHTS);
      level.music?.('epic');
      ice.enabled = false;
      audio.play('jump', { pos: player.position, volume: 0.9 });
      audio.play('bat_screech', { pos: player.position, volume: 1, pitch: 0.85 });
      for (const [x, z] of RIDE_ARCHERS) rideFoes.push(level.spawnEnemy({ archetype: 'orc_archer', behavior: 'hold', hp: 40 }, V(x, ground(x, z), z)));
      const path = new Path(RIDE_PTS, { step: 0.5 });
      // the escort: hostile bats keep station around him (ahead, to the sides, above) and dive in turn;
      // a screech and, the first time, a warning say when one comes in
      let cued = false;
      const onSwoop = () => {
        if (cued) return;
        cued = true;
        hud.toast('A bat dives at you: shoot it!', 'warning');
      };
      const escorts: { bat: GiantBat; off: [number, number, number] }[] = [];
      const fwd = new THREE.Vector3();
      const at = new THREE.Vector3();
      const stationOf = (off: [number, number, number], s: number, out: THREE.Vector3) => {
        path.tangent(Math.min(path.length - 0.1, s), fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
        fwd.normalize();
        // right of travel = (-f.z, 0, f.x)
        return out.copy(player.position).addScaledVector(fwd, off[2]).add(tmp.set(-fwd.z * off[0], off[1], fwd.x * off[0]));
      };
      const addEscort = (off: [number, number, number], seed: number) => {
        const b = new GiantBat(level, { center: stationOf(off, ride?.s ?? 0, at), radius: 8, seed, scale: 0.78, hp: 45, swoopEvery: [3.5, 6], swoopRange: 60, damage: 9, onSwoop });
        level.addCombatant(b);
        rideFoes.push(b);
        escorts.push({ bat: b, off });
      };
      ESCORT.forEach((o, i) => addEscort(o, 11 + i));
      let late = false;
      let ended = false;
      const r = batRide(level, m, path, 11, () => (ended = true));
      ride = r;
      player.mover = r;
      const stopEscort = level.onUpdate(() => {
        const left = path.length - r.s;
        // a second pair comes screeching out of the snow ahead, half way along
        if (!late && r.s > path.length * 0.42) {
          late = true;
          ESCORT_LATE.forEach((o, i) => addEscort(o, 21 + i));
          audio.play('bat_screech', { pos: stationOf(ESCORT_LATE[0], r.s, at), volume: 1, pitch: 0.8 });
        }
        for (const e of escorts) {
          if (!e.bat.alive) continue;
          if (left < 30) {
            // the tower: they break off and circle where they are
            e.bat.centerVel.set(0, 0, 0);
            continue;
          }
          stationOf(e.off, r.s, e.bat.center);
          e.bat.centerVel.copy(player.velocity);
        }
      });
      await level.waitUntil(() => ended, path.length / 5 + 20);
      stopEscort();
      player.mover = null;
      ride = null;
      // let go: drop into the tower with a little forward momentum
      tmp.set(Math.sin(m.heading), 0, Math.cos(m.heading));
      player.velocity.set(tmp.x * 2.5, -1, tmp.z * 2.5);
      player.facing = m.heading;
      level.music?.(null);
      audio.play('bat_screech', { pos: player.position, volume: 0.9, pitch: 1.1 });
      // the bat climbs away and off into the snow; while its wings are within a few metres of the
      // camera it is not drawn (a wing membrane filling the whole frame reads as a black screen)
      const exit = new Path(EXIT_PTS);
      let s = 0;
      const ep = new THREE.Vector3();
      const et = new THREE.Vector3();
      const cam = ctx.engine.camera;
      const stopExit = level.onUpdate((dt) => {
        s = Math.min(exit.length, s + dt * (10 + Math.min(s, 20) * 0.5));
        exit.at(s, ep);
        exit.tangent(s, et);
        m.fly(ep, et, dt, 'fly');
        m.object.visible = cam.position.distanceTo(m.object.position) > 8.5;
        if (s >= exit.length) {
          stopExit();
          m.object.visible = false;
        }
      });
      // the tower beat (boss bar, objective) waits until he is down and the bat is clear
      await level.waitUntil(() => player.grounded && s > 14, 5);
      // what is left of the ledge archers and bats stays behind
      for (const f of rideFoes) if (f.alive) level.removeCombatant(f);
      rideFoes.length = 0;
    }

    // ─────────────────────────────────────────────────────────────────────
    // cp2: The Tower (Bolg, phase 1)
    // ─────────────────────────────────────────────────────────────────────
    function bolgAt(pos: THREE.Vector3, hpFrac: number): BolgBoss {
      const b = spawnBolg(level, pos, faceTo(pos, player.position), { maxHp: BOLG_HP, hpFrac });
      bolg = b;
      return b;
    }

    /** the top floor: the snow caps go (white slabs at eye level) and the camera tucks in a little */
    function towerView(on: boolean): void {
      for (const o of world.towerSnow) o.visible = !on;
      Object.assign(player.camera.params, on ? { ...camBase, distance: 3.0, height: 1.72 } : camBase);
    }

    async function towerDuel(): Promise<void> {
      beat = 'tower';
      towerView(true);
      const b = bolg ?? bolgAt(L.bolgTower, 1);
      b.floor = 0.8;
      level.boss(b.enemy, 'Bolg');
      level.objective('Defeat Bolg');
      // a beat to land: he roars across the floor before he comes (no attacks for ~2.5 s)
      b.enemy.aiEnabled = false;
      b.enemy.moveTarget = null;
      b.specials = false;
      b.enemy.playPose?.('roar', 1.6);
      audio.play('orc_roar', { pos: b.enemy.position, volume: 1, pitch: 0.65 });
      player.camera.shake(0.2, 0.6);
      if (!quick) void level.say('Bolg', 'The elf comes to die in the high places.', 2.6);
      await level.wait(2.5);
      b.enemy.aiEnabled = true;
      b.specials = true;
      // at four fifths he falls back behind his guard: three Gundabad orcs leap in over the wall,
      // and while they live he will not go down further (the floor holds)
      await level.waitUntil(() => b.hpFrac <= 0.8 + 0.002 || !b.enemy.alive, 300);
      // round the inside of the wall, away from the stair hole, on the far side from Legolas
      const spots: THREE.Vector3[] = [];
      const away = Math.atan2(player.position.z - CRAG.z, player.position.x - CRAG.x) + Math.PI;
      for (const da of [-1.0, 0, 1.0]) {
        let a = away + da;
        let at = V(CRAG.x + Math.cos(a) * 5.2, TOP_FLOOR_Y + 2.6, CRAG.z + Math.sin(a) * 5.2);
        if (Math.hypot(at.x - TOP_HOLE.x, at.z - TOP_HOLE.z) < TOP_HOLE_R + 0.9) {
          a += 0.9;
          at = V(CRAG.x + Math.cos(a) * 5.2, TOP_FLOOR_Y + 2.6, CRAG.z + Math.sin(a) * 5.2);
        }
        spots.push(at);
      }
      await guardBreak(b, 0.8, spots, 'Cut down Bolg\'s guard', 'To me! Kill the elf!', 'leap', TOP_FLOOR_Y);
      level.objective('Defeat Bolg');
      b.floor = PHASE1_END;
      await level.waitUntil(() => b.hpFrac <= PHASE1_END + 0.002 || !b.enemy.alive, 300);
    }

    /**
     * Bolg falls back behind fresh guards: the HP floor holds at `frac` until they are dead, he
     * roars, and the objective says what to do. Resolves when the guards are down (or after 90 s).
     */
    async function guardBreak(b: BolgBoss, frac: number, spots: THREE.Vector3[], objective: string, line: string, entry: 'leap' | 'climb', floorY = spots[0].y): Promise<void> {
      b.floor = frac;
      b.cancel();
      b.enemy.playPose?.('roar', 1.3);
      audio.play('horn_orc', { volume: 0.7 });
      audio.play('orc_roar', { pos: b.enemy.position, volume: 1, pitch: 0.6 });
      player.camera.shake(0.25, 0.6);
      if (!quick) void level.say('Bolg', line, 2.2);
      level.objective(objective);
      const guards: Enemy[] = [];
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i];
        if (entry === 'leap') {
          // they vault in over the wall: spawned on the rim above the floor, falling inward
          const g = level.spawnEnemy({ archetype: 'gundabad', hp: 90 }, p, faceTo(p, player.position));
          tmp.set(CRAG.x - p.x, 0, CRAG.z - p.z).normalize();
          g.velocity.set(tmp.x * 3.2, 3.5, tmp.z * 3.2);
          audio.play('jump', { pos: p, volume: 0.8, pitch: 0.7 });
          guards.push(g);
        } else {
          // they climb up the summit's face from below the rim and haul themselves over
          const g = level.spawnEnemy({ archetype: 'gundabad', hp: 90, behavior: 'climb' }, p, faceTo(p, V(PINNACLE.x, 0, PINNACLE.z)));
          tmp.set(PINNACLE.x - p.x, 0, PINNACLE.z - p.z).normalize();
          g.moveTarget = V(p.x + tmp.x * 1.25, floorY + 0.05, p.z + tmp.z * 1.25);
          guards.push(g);
        }
        await level.wait(0.35);
      }
      // a guard knocked off the floor (or down the stair hole) no longer holds Bolg's line; a climber
      // only counts once he has made it up (or after 10 s on the face)
      const up = guards.map(() => false);
      const t0 = ctx.time.t;
      await level.waitUntil(
        () =>
          guards.every((g, i) => {
            if (!g.alive) return true;
            if (g.position.y > floorY - 1) up[i] = true;
            return (up[i] || ctx.time.t - t0 > 10) && g.position.y < floorY - 3;
          }),
        60,
      );
      guards.forEach((g, i) => {
        if (g.alive && !up[i]) slay(g, null);
      });
    }

    async function collapse(): Promise<void> {
      beat = 'collapse';
      const b = bolg!;
      b.cancel();
      b.specials = false;
      b.enemy.aiEnabled = false;
      // his guard dies in the fall
      for (const c of ctx.combatants.byTeam('enemy')) if (c !== b.enemy && c.alive) slay(c, null);
      level.cinematic(true);
      level.objective(null);
      towerView(false);
      level.setEnvironment(ENV_SUMMIT);
      b.enemy.playPose?.('roar', 1.6);
      audio.play('orc_roar', { pos: b.enemy.position, volume: 1, pitch: 0.6 });
      level.cameraShot({ position: V(BRIDGE.x0 + 14, BRIDGE.y + 6, BRIDGE.z + 22), lookAt: V(CRAG.x, CRAG.y + 20, CRAG.z), fov: 50, blend: 0.5 });
      await level.wait(0.9);
      // the crown gives way
      audio.play('explosion', { volume: 0.9, pitch: 0.6 });
      audio.play('stone_crumble', { volume: 1 });
      player.camera.shake(1, 2.2);
      for (let i = 0; i < 3; i++) fx.explosion(V(CRAG.x - TOWER.r + i * 1.5, CRAG.y + TOWER.h * 0.85, CRAG.z - 2 + i * 2), 1.2);
      for (const c of world.crown) drop(c.object, (Math.random() - 0.5) * 3 - 2, (Math.random() - 0.5) * 3);
      fx.dust(V(CRAG.x, TOP_FLOOR_Y, CRAG.z), 30, 0xd8dde2);
      await level.wait(1.1);
      // and the bridge breaks
      level.cameraShot({ position: V((BRIDGE.x0 + BRIDGE.x1) / 2, BRIDGE.y + 5, BRIDGE.z - 26), lookAt: V((BRIDGE.x0 + BRIDGE.x1) / 2 - 4, BRIDGE.y - 2, BRIDGE.z), fov: 52, blend: 0.6 });
      await level.wait(0.5);
      world.breakBridge();
      for (const c of world.gapChunks) drop(c.object, 0, (Math.random() - 0.5) * 2);
      stones.reveal();
      audio.play('explosion', { volume: 0.8, pitch: 0.5 });
      fx.explosion(V((BRIDGE.x0 + BRIDGE.x1) / 2 - 6, BRIDGE.y - 0.5, BRIDGE.z), 1.4);
      fx.explosion(V(GAP_X0 + 12, BRIDGE.y - 0.5, BRIDGE.z), 1.1);
      player.camera.shake(0.8, 1.4);
      await level.wait(1.0);
      // the stones from the side: a broken chain of masonry hanging over the abyss, the pinnacle beyond
      level.cameraShot({ position: V(BRIDGE_CX - 2, BRIDGE.y + 9, BRIDGE.z - 30), lookAt: V(BRIDGE_CX + 6, BRIDGE.y + 3, BRIDGE.z), fov: 50, blend: 0 });
      await level.wait(0.2);
      level.cameraShot({ position: V(BRIDGE_CX + 3, BRIDGE.y + 7, BRIDGE.z - 27), lookAt: V(BRIDGE_CX + 8, BRIDGE.y + 4, BRIDGE.z), fov: 46, blend: 2.4 });
      await level.wait(quick ? 0.8 : 2.4);
      // Bolg leaps the gap to the east pinnacle; Legolas takes the falling stones
      b.enemy.object.position.copy(L.bolgSummit);
      b.enemy.velocity.set(0, 0, 0);
      player.teleport(L.bridgeStart, Math.PI / 2);
      level.cameraShot({ position: V(L.bridgeStart.x - 3.5, BRIDGE.y + 2.6, BRIDGE.z - 3), lookAt: V(PINNACLE.x, PINNACLE.y + 2, PINNACLE.z), fov: 44, blend: 0 });
      if (!quick) await level.say('Legolas', 'The stones are falling. I climb.', 2.4);
      else await level.wait(0.3);
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // cp3: The Falling Stones, Bolg phase 2, the finisher
    // ─────────────────────────────────────────────────────────────────────
    async function climb(): Promise<void> {
      beat = 'climb';
      const b = bolg!;
      b.enemy.aiEnabled = false;
      b.enemy.targetable = false;
      b.specials = false;
      b.floor = PHASE1_END;
      level.objective('Climb the falling stones');
      hud.setPrompt('jump', 'Jump from stone to stone (double jump)');
      const archers = L.summitArchers.map((p) => level.spawnEnemy({ archetype: 'orc_archer', behavior: 'hold', hp: 40 }, p));
      // frame the line of stones over the abyss: the camera looks along the bridge, a little down
      const aimCamera = () => {
        player.camera.yaw = Math.PI / 2;
        player.camera.pitch = -0.2;
      };
      aimCamera();
      let clock = CLIMB_TIME;
      let falls = 0;
      let resetT = -1;
      /** seconds grounded on anything that is not a stone, the summit or the near deck (the far stub, a ledge) */
      let offT = 0;
      // the test bot (?bot=1) has no feel for a jump: when it takes off for the next stone, its arc is
      // solved to land on the middle of it (motor gravity 22 m/s²). Players are never touched.
      const botAssist = ctx.flags.bot === '1';
      let wasGrounded = true;
      const onSummit = () => Math.hypot(player.position.x - PINNACLE.x, player.position.z - PINNACLE.z) < PINNACLE.r + 0.6 && player.position.y > PINNACLE.y - 0.6;
      const stop = level.onUpdate((dt) => {
        if (stones.started && resetT < 0) {
          clock -= dt;
          hud.setProgress('The stones are falling', clamp(clock / CLIMB_TIME, 0, 1));
          if (clock <= 0) {
            // out of time: everything left gives way
            stones.collapse();
            resetT = 2.5;
          }
        }
        if (stones.started && stones.standing >= 0) hud.setPrompt(null);
        if (botAssist) {
          const n = stones.next() ?? (stones.standing >= 0 ? L.summit : null);
          const v = player.velocity;
          if (n && wasGrounded && !player.grounded && v.y > 3 && !player.mover) {
            const dy = n.y + 0.05 - player.position.y;
            const disc = v.y * v.y - 2 * 22 * dy;
            if (disc > 0) {
              const tl = (v.y + Math.sqrt(disc)) / 22;
              // aim a little short of the middle: its air control keeps pushing toward the target
              const hx = n.x - player.position.x;
              const hz = n.z - player.position.z;
              const k = Math.max(0, Math.hypot(hx, hz) - 0.4) / Math.max(Math.hypot(hx, hz), 1e-3);
              v.x = (hx * k) / tl;
              v.z = (hz * k) / tl;
            }
          }
          wasGrounded = player.grounded;
        }
        // fell: into the abyss, or down onto anything that is not a stone (the far stub of the deck,
        // a ledge of the pinnacle's face) — the stones above are out of reach from there
        const p = player.position;
        const nearDeck = p.x < GAP_X0 - 0.2 && p.y > BRIDGE.y - 1.5;
        offT = player.grounded && stones.standing < 0 && !nearDeck && !onSummit() ? offT + dt : 0;
        let again = p.y < BRIDGE.y - 6 || offT > 0.6;
        if (resetT >= 0) {
          resetT -= dt;
          if (resetT < 0 && !onSummit()) again = true;
        }
        if (again) {
          // back to the bridge: the stones settle again
          resetT = -1;
          offT = 0;
          falls++;
          if (ctx.flags.god !== '1' && player.hp > 20) player.takeDamage({ amount: 12, type: 'fall', source: null });
          player.teleport(L.bridgeStart, Math.PI / 2);
          aimCamera();
          stones.reset();
          clock = CLIMB_TIME;
          hud.setProgress(null);
          hud.toast(falls === 1 ? 'The stones settle: try again, faster' : 'Again!', 'info');
        }
      });
      await level.waitUntil(onSummit);
      stop();
      hud.setProgress(null);
      hud.setPrompt(null);
      stones.collapse();
      beat = 'summit';
      void archers;
    }

    async function finalDuel(): Promise<void> {
      beat = 'summit';
      const b = bolg!;
      b.floor = 0.38;
      b.enemy.targetable = true;
      b.enemy.aiEnabled = true;
      b.specials = true;
      b.specialEvery = [4.5, 7];
      for (const h of summitGate) h.enabled = true;
      level.boss(b.enemy, 'Bolg');
      level.objective('Defeat Bolg');
      audio.play('orc_roar', { pos: b.enemy.position, volume: 1, pitch: 0.6 });
      if (!quick) void level.say('Bolg', 'No more running, elf!', 2.2);
      // at two fifths: two of his last guard climb up the far face, and he fights enraged
      await level.waitUntil(() => b.hpFrac <= 0.38 + 0.002 || !b.enemy.alive, 300);
      const climbFrom = (a: number) => {
        const x = PINNACLE.x + Math.cos(a) * (PINNACLE.r + 1.25);
        const z = PINNACLE.z + Math.sin(a) * (PINNACLE.r + 1.25);
        return V(x, ground(x, z), z);
      };
      await guardBreak(b, 0.38, [climbFrom(-0.45), climbFrom(0.5)], 'Kill Bolg\'s last guard', 'To me! Cut him down!', 'climb', PINNACLE.y);
      level.objective('Defeat Bolg');
      // enraged: a roar, faster, more specials, steaming breath
      b.cancel();
      b.enemy.playPose?.('roar', 1.5);
      audio.play('orc_roar', { pos: b.enemy.position, volume: 1, pitch: 0.55 });
      player.camera.shake(0.45, 0.9);
      hud.toast('Bolg is enraged', 'warning');
      b.enrage();
      b.floor = FINISHER_AT;
      await level.waitUntil(() => b.hpFrac <= FINISHER_AT + 0.002 || !b.enemy.alive, 300);

      // he goes down on one knee: finish him with the knife
      beat = 'finish';
      b.specials = false;
      b.cancel();
      b.enemy.aiEnabled = false;
      b.enemy.moveTarget = null;
      b.enemy.targetable = false;
      b.enemy.playPose?.('kneel', 120);
      audio.play('orc_roar', { pos: b.enemy.position, volume: 0.8, pitch: 0.5 });
      // any archers left flee down the far side
      for (const c of ctx.combatants.byTeam('enemy')) if (c !== b.enemy && c.alive) slay(c, null);
      level.objective('Finish Bolg');
      const stop = level.onUpdate(() => {
        const near = Math.hypot(player.position.x - b.enemy.position.x, player.position.z - b.enemy.position.z) < 3.4 && player.alive;
        hud.setPrompt(near ? 'melee' : null, 'Finish him');
        ctx.input.setInteractLabel(near ? 'Finish' : null);
        if (near && (ctx.input.state.melee || ctx.input.state.interact)) finisherGo = true;
      });
      await level.waitUntil(() => finisherGo, 120);
      stop();
      hud.setPrompt(null);
      ctx.input.setInteractLabel(null);
      await finisher(b);
    }

    async function finisher(b: BolgBoss): Promise<void> {
      const e = b.enemy;
      level.cinematic(true);
      // staged on a fixed, clear mark in the middle of the summit (wherever he went down, the cut
      // hides the step): Bolg on one knee facing west, Legolas squared up in front of him, the
      // camera side-on from the south at chest height, both of them in frame
      const kb = V(L.finBolg.x, ground(L.finBolg.x, L.finBolg.z), L.finBolg.z);
      const yaw = -Math.PI / 2; // facing -x
      tmp.set(Math.sin(yaw), 0, Math.cos(yaw));
      e.object.position.copy(kb);
      e.velocity.set(0, 0, 0);
      (e as Enemy & { facing: number }).facing = yaw;
      e.object.rotation.y = yaw;
      e.playPose?.('kneel', 120);
      const at = V(kb.x + tmp.x * 1.55, ground(kb.x + tmp.x * 1.55, kb.z), kb.z + tmp.z * 1.55);
      player.teleport(at, faceTo(at, kb));
      const midX = (at.x + kb.x) / 2;
      const midZ = (at.z + kb.z) / 2;
      const camY = Math.max(at.y, kb.y) + 1.55;
      level.cameraShot({ position: V(midX - 0.5, camY, midZ - 3.6), lookAt: V(midX, camY - 0.3, midZ), fov: 42, blend: 0 });
      await level.wait(0.45);
      ctx.time.setScale(0.32, 0.12);
      // the knife: the player's own finisher stroke (no public API: call it if present)
      (player as unknown as { startMeleeHit?: (n: number) => void }).startMeleeHit?.(3);
      audio.play('knife_slash', { pos: player.position, volume: 1, pitch: 0.9 });
      await level.wait(0.12);
      b.floor = 0;
      e.takeDamage({ amount: e.hp + 50, type: 'melee', source: player, point: e.position.clone().setY(e.position.y + e.height * 0.86), dir: tmp.clone().negate(), zone: 'head', stagger: true });
      if (e.alive) slay(e, player);
      audio.play('knife_hit', { pos: e.position, volume: 1, pitch: 0.8 });
      fx.blood(e.position.clone().setY(e.position.y + e.height * 0.86), tmp.clone().negate(), 'dark', 2);
      ctx.time.hitStop(0.12);
      await level.wait(0.4);
      ctx.time.setScale(1, 0.5);
      b.stop();
      level.cameraShot({ position: V(at.x + tmp.x * 4.5, at.y + 2.3, at.z - 2.5), lookAt: V(kb.x, kb.y + 0.7, kb.z), fov: 46, blend: 1.6 });
      await level.wait(1.8);
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.objective(null);
      level.cinematic(true);
      level.setEnvironment(ENV_VALLEY);
      // Legolas at the summit's southern edge, looking out over the valley
      const look = V(PINNACLE.x - 1, ground(PINNACLE.x - 1, PINNACLE.z - 5), PINNACLE.z - 5);
      player.teleport(look, Math.PI);
      level.cameraShot({ position: V(look.x + 2.4, look.y + 2.1, look.z + 3.2), lookAt: V(look.x - 6, look.y - 4, look.z - 30), fov: 46, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: V(look.x + 1.8, look.y + 2.0, look.z + 2.6), lookAt: V(look.x - 6, look.y - 5, look.z - 30), fov: 44, blend: 2.4 });
      if (!quick) await level.say('Legolas', 'Bolg is dead.', 2);
      else await level.wait(0.8);
      // the valley mouth: the horns, and the orc host breaking against the dwarves and the elves
      level.cameraShot({ position: V(10, 25, -80), lookAt: V(L.battle.x - 6, 3, L.battle.z), fov: 42, blend: 0 });
      audio.play('horn_rohan', { volume: 0.6, pitch: 1.25 });
      world.armies.orcs.thin(0.45);
      world.armies.elves.setSpeed(2.2);
      world.armies.dwarves.setSpeed(1.4);
      await level.wait(0.2);
      level.cameraShot({ position: V(13, 22, -88), lookAt: V(L.battle.x - 4, 3, L.battle.z), fov: 40, blend: 3.5 });
      if (!quick) await level.say('Legolas', 'The orcs are breaking. The battle is turning.', 3);
      else await level.wait(1.7);
      level.cameraShot(null);
      level.cinematic(false);
      level.complete();
    }

    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await iceFight();
        await trollFight();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await batRideBeat();
        level.checkpoint(2);
      }
      if (from <= 2) {
        await towerDuel();
        await collapse();
        level.checkpoint(3);
      }
      await climb();
      await finalDuel();
      await outro();
    }

    /** the bot holds `home` unless every enemy is far away (an archer tucked in the ruins): then it goes after the nearest */
    const huntAt = new THREE.Vector3();
    function hunt(home: THREE.Vector3): THREE.Vector3 {
      let best: Combatant | null = null;
      let bd = Infinity;
      for (const c of ctx.combatants.byTeam('enemy')) {
        if (!c.alive || !c.targetable) continue;
        const d = c.position.distanceTo(player.position);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best || bd < 22) return home;
      return huntAt.copy(best.position);
    }

    // the troll and Bolg (one body each) finish meshing behind the loading screen
    await singles;

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 3);
        if (c <= 1) {
          level.setEnvironment(ENV_GORGE);
          const at = c === 0 ? L.spawn : L.cp1Spawn;
          player.teleport(V(at.x, ground(at.x, at.z), at.z), 0);
          spawnTauriel(c === 0 ? L.tauriel : V(at.x - 2.5, 0, at.z - 2), 0);
          if (c === 1) {
            // the bat is already circling down
            mount = null;
          }
        } else {
          level.setEnvironment(c === 2 ? ENV_HEIGHTS : ENV_SUMMIT);
          ice.enabled = false;
          if (c === 2) {
            player.teleport(L.towerDrop, faceTo(L.towerDrop, L.bolgTower));
            bolgAt(L.bolgTower, 1);
          } else {
            world.breakBridge();
            for (const ch of world.gapChunks) ch.object.visible = false;
            stones.reveal(true);
            for (const cr of world.crown) cr.object.visible = false;
            player.teleport(L.bridgeStart, Math.PI / 2);
            bolgAt(L.bolgSummit, PHASE1_END);
          }
        }
        void run(c);
      },
      update(): void {},
      botHint() {
        switch (beat) {
          case 'falls':
          case 'troll':
            return { moveTo: hunt(L.iceHold) };
          case 'grab': {
            const d = Math.hypot(player.position.x - HOVER.x, player.position.z - HOVER.z);
            return { moveTo: HOVER, interact: d < 3 };
          }
          case 'tower':
            return { moveTo: L.towerCenter };
          case 'climb': {
            const n = stones.next();
            // the last stone: hop across onto the summit
            if (!n) return { moveTo: L.summit, jump: player.grounded && stones.standing >= 0 && player.position.x > PINNACLE.x - PINNACLE.r - 1.6 };
            // the stones are ~3.4 m apart (centre to centre): take off at a run, near the edge of this one
            const dx = n.x - player.position.x;
            const dz = n.z - player.position.z;
            const d = Math.hypot(dx, dz);
            const run = (player.velocity.x * dx + player.velocity.z * dz) / Math.max(d, 1e-3);
            // never straight off a landing on the near edge: first get past this stone's middle
            const cur = stones.standing >= 0 ? stones.stones[stones.standing].top : null;
            const along = cur ? ((player.position.x - cur.x) * dx + (player.position.z - cur.z) * dz) / Math.max(d, 1e-3) : 0;
            const go = cur ? along > 0.35 && d < 4.2 : d < 2.75 && (run > 3.5 || d < 1.6);
            return { moveTo: n, jump: player.grounded && go && player.position.y < n.y - 0.2 };
          }
          case 'summit':
            return { moveTo: L.summit };
          case 'finish': {
            const e = bolg?.enemy;
            if (!e) return null;
            const d = Math.hypot(player.position.x - e.position.x, player.position.z - e.position.z);
            return { moveTo: e.position, interact: d < 3 };
          }
          default:
            return null;
        }
      },
      dispose(): void {
        stones.dispose();
        Object.assign(player.camera.params, camBase);
      },
    };
  },
};

