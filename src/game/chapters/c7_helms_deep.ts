/**
 * Chapter 7: Helm's Deep (The Two Towers).
 *
 *   cp0  The Deeping Wall   "Give them a volley": the scripted volley thins the host, then six
 *                           siege ladders rise. Kill the climbers or push the ladders off (interact):
 *                           a toppling ladder carries everyone on it. Crossbowmen in the field.
 *   cp1  The Culvert        Berserker torch-runners make for the culvert: stop three. The fourth
 *                           cannot be stopped (cinematic): the explosion breaches the wall.
 *   cp2  The Shield Stair   Shield-surf down the 60 m stair, bowling and shooting Uruks, a slow-mo
 *                           landing kill at the foot, then the fight in the flooded breach.
 *   cp3  The Hornburg       Hold the causeway gate with Aragorn and Gimli for 150 s against waves
 *                           and a battering ram; dawn breaks, horns, the White Rider's charge routs
 *                           the host. Gimli and Legolas compare the count. complete().
 *
 * Layout and coordinates: helms_deep/layout.ts. Geometry: helms_deep/world.ts. Lighting:
 * helms_deep/env.ts. Ladders, surf and ram: helms_deep/{ladders,surf,ram}.ts.
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Combatant, CrowdHandle, Enemy, FxHandle, LevelAPI } from '../../core/types';
import { createCrowd, setWetness } from '../../world';
import { clamp, yawOf } from '../../core/math';
import { ballisticDir } from '../../combat/aim';
import { numberWord } from '../rivalry';
import { buildWorld } from './helms_deep/world';
import { L, LADDER_SETS, LADDER_X, V, WALL_H, rightToe, stairY, walk, wallAt } from './helms_deep/layout';
import { DAWN, STORM, lerpEnv } from './helms_deep/env';
import { SiegeLadder } from './helms_deep/ladders';
import { makeShieldSurf, type SurfMover } from './helms_deep/surf';
import { RamTeam } from './helms_deep/ram';

const CHECKPOINTS = ['The Deeping Wall', 'The Culvert', 'The Shield Stair', 'The Hornburg'];
/** seconds the gate must hold until dawn */
const HOLD_SECONDS_DEFAULT = 150;
/** the dawn ramp starts this many seconds before the end of the hold */
const DAWN_LEAD = 50;

/**
 * The dawn charge framing: [x, metres above the ground, z]. The riders mass on the shelf ~50 m up
 * the eastern slope (d = 39..61 m out from the gorge toe at z 106), the White Rider at their head.
 */
const DAWN_SHOTS = {
  riderZ: 106,
  riderD: 50,
  /** from the slope's southern flank: the riders massed on the shelf's edge, the dawn beyond */
  ridge: { p: [165, 6, 86], p2: [166, 6.5, 88], l: [189, 4, 107], fov: 42 },
  /** on the shelf, low: the White Rider close, the host of riders behind him against the dawn */
  white: { p: [174, 1.3, 97], l: [187, 4, 111], fov: 44 },
  /** from the slope's southern flank: the charge pours down the slope toward the coomb */
  charge: { p: [150, 8, 84], l: [165, 8, 104], p2: [148, 8, 86], l2: [163, 6, 106], fov: 50 },
  /** over the coomb: the host breaks and flees for the back of the Deep */
  flee: { p: [40, 22, 40], l: [-20, 2, 125], fov: 50 },
};

/** tint a crowd's instances (the masked coat, e.g. a horse) */
function paintCrowd(c: CrowdHandle, hex: number, k: number): void {
  const col = new THREE.Color(hex).multiplyScalar(k);
  c.mesh.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    for (let i = 0; i < m.count; i++) m.setColorAt(i, col);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
}

type Beat =
  | 'intro' | 'volley' | 'ladders' | 'toCulvert' | 'culvert' | 'blast' | 'toStair' | 'surf' | 'breach'
  | 'fallback' | 'gate' | 'dawn' | 'outro';

export const chapter: ChapterDef = {
  id: 'helms_deep',
  number: 7,
  title: "Helm's Deep",
  film: 'The Two Towers',
  blurb: 'Night, storm and ten thousand Uruk-hai against the Deeping Wall. Hold the battlements, stop the torch-bearers, surf the great stair and keep the Hornburg gate until dawn.',
  environment: 'helms_deep_storm',
  checkpoints: CHECKPOINTS,
  parTime: 540,
  rivalry: true,
  preload: ['gimli', 'aragorn', 'elf', 'rohirrim', 'uruk', 'berserker'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1';
    // dev: ?hdHold=<s> shortens the gate hold (to look at the dawn without playing 150 s)
    const HOLD_SECONDS = Number(ctx.flags.hdHold) > 0 ? Number(ctx.flags.hdHold) : HOLD_SECONDS_DEFAULT;
    const DAWN_FROM = Math.max(0, HOLD_SECONDS - DAWN_LEAD);

    level.setEnvironment(STORM);
    setWetness(0.85);
    const world = buildWorld(level, false);
    world.shieldBeacon.visible = false;
    // pre-warm the blast's shaders and pools off-screen (the first explosion otherwise hitches)
    ctx.fx.explosion(V(0, -400, 0), 0.2);
    ctx.fx.debris(V(0, -400, 0), 4, 0x8a8478);
    {
      const dummy = new THREE.Object3D();
      dummy.position.set(0, -400, 0);
      level.root.add(dummy);
      const h = ctx.fx.torch(dummy);
      void level.wait(0.5).then(() => {
        h.stop();
        dummy.removeFromParent();
      });
    }
    const ladders = LADDER_X.map((x, i) => new SiegeLadder(level, x, i < 3 ? { maxAlive: 2, quota: 3, interval: 3.6 } : { maxAlive: 2, quota: 4, interval: 3.2 }));

    // ── script state (read by botHint) ─────────────────────────────────────
    let beat: Beat = 'intro';
    let gimli: Ally | null = null;
    let aragorn: Ally | null = null;
    const elves: Ally[] = [];
    const riders: Ally[] = [];
    let runner: Enemy | null = null;
    let surf: SurfMover | null = null;
    let surfRequested = false;
    let surfDone = false;
    let ram: RamTeam | null = null;
    let holdT = 0;
    let lightningOn = true;
    const crowds: CrowdHandle[] = [];
    const gimliAnchor = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();

    // chapter-local counts for the banter ("Forty-two!"): the totals carried in minus this chapter's start
    const pe = ctx.progression as typeof ctx.progression & { rivalryBaseline?: (id: string) => { legolas: number; gimli: number } };
    const base = pe.rivalryBaseline ? pe.rivalryBaseline('helms_deep') : { ...ctx.progression.data.rivalryTotals };
    const countL = () => Math.max(0, ctx.rivalry.legolas - base.legolas);
    const countG = () => Math.max(0, ctx.rivalry.gimli - base.gimli);

    // ── helpers ──────────────────────────────────────────────────────────
    /** a line of dialogue: awaited normally, fire-and-forget with ?skipIntro=1 */
    const line = async (who: string, text: string, dur?: number) => {
      if (quick) {
        void level.say(who, text, Math.min(dur ?? 2, 1.6));
        return;
      }
      await level.say(who, text, dur);
    };
    const moveNpc = (c: Combatant, p: THREE.Vector3, facing?: number) => {
      c.object.position.copy(p);
      c.velocity.set(0, 0, 0);
      if (facing !== undefined) {
        (c as Combatant & { facing?: number }).facing = facing;
        c.object.rotation.y = facing;
      }
    };
    const outYaw = (x: number) => {
      const w = wallAt(x);
      return yawOf(w.n.x, w.n.z);
    };

    const spawnAllies = (cp: number) => {
      if (cp <= 1) {
        gimliAnchor.copy(walk(-13, -0.6));
        gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: gimliAnchor }, walk(-13.5, -0.6), outYaw(-13));
        // (nobody stands on the culvert section, x -4..14: it is blown away in cp1)
        aragorn = level.spawnAlly({ kind: 'aragorn', anchor: walk(-7.5, -0.4) }, walk(-7.5, -0.4), outYaw(-7.5));
        for (const x of [-27, -36, 19]) elves.push(level.spawnAlly({ kind: 'elf_archer', name: 'Galadhrim archer', anchor: walk(x, 0.9) }, walk(x, 0.9), outYaw(x)));
      } else if (cp === 2) {
        gimliAnchor.copy(walk(-24, -0.8));
        gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: gimliAnchor }, walk(-24.5, -0.8), outYaw(-24));
        aragorn = level.spawnAlly({ kind: 'aragorn', anchor: L.breachFight.clone() }, V(L.breachFight.x - 2, 0, L.breachFight.z - 3), 0);
        for (const x of [-12, 18]) elves.push(level.spawnAlly({ kind: 'elf_archer', name: 'Galadhrim archer', anchor: walk(x, -1.2) }, walk(x, -1.2), Math.PI));
      } else {
        gimliAnchor.copy(L.gimliGate);
        gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: gimliAnchor }, L.gimliGate.clone(), Math.PI);
        aragorn = level.spawnAlly({ kind: 'aragorn', anchor: L.aragornGate.clone() }, L.aragornGate.clone(), Math.PI);
        for (const p of [V(73.2, 5.8, -38.5), V(78.8, 5.8, -41)]) riders.push(level.spawnAlly({ kind: 'rohirrim', name: 'Rider of Rohan', anchor: p.clone() }, p, Math.PI));
      }
      ctx.rivalry.autoGimli = true;
    };

    /** Gimli keeps to the walkway a couple of metres along from the player (never over the inner edge) */
    const followOnWall = () => {
      if (!gimli || gimli.anchor !== gimliAnchor) return;
      const px = clamp(player.position.x, -56, 58);
      const onWall = player.position.y > WALL_H - 1.5;
      if (!onWall) return;
      const x = px + (px > 40 ? -2.6 : 2.6);
      walk(x, -0.7, gimliAnchor);
    };

    /** crossbowmen at these spots, topping the live count up to `max` */
    const spawnArchers = (spots: THREE.Vector3[], max = spots.length) => {
      let alive = level.enemiesAlive((c) => c.name === 'Uruk crossbowman');
      for (const p of spots) if (alive++ < max) level.spawnEnemy({ archetype: 'uruk_archer', behavior: 'hold', name: 'Uruk crossbowman', weapon: 'crossbow' }, p, Math.PI);
    };

    // ── the storm: lightning with thunder a beat later ────────────────────
    let lightningT = quick ? 3 : 5;
    let thunderT = -1;
    let thunderVol = 1;
    level.onUpdate((dt) => {
      if (!lightningOn) return;
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 7 + level.rng() * 11;
        ctx.fx.lightning();
        thunderT = 0.35 + level.rng() * 1.6;
        thunderVol = 1.1 - thunderT * 0.3;
      }
      if (thunderT >= 0) {
        thunderT -= dt;
        if (thunderT < 0) ctx.audio.play('thunder', { volume: thunderVol, pitch: 0.85 + level.rng() * 0.25 });
      }
    });

    // ── per-step upkeep: ladders, Gimli's anchor, splashes in the flood ────
    let splashT = 0;
    level.onUpdate((dt) => {
      for (const l of ladders) l.update(dt);
      world.update(dt);
      followOnWall();
      if (world.breached) {
        world.pool.update(dt);
        splashT -= dt;
        if (splashT <= 0) {
          splashT = 0.22;
          for (const c of ctx.combatants.all()) {
            if (!c.alive || c.position.y > 0.6) continue;
            if (Math.abs(c.position.x - 5) > 11.5 || Math.abs(c.position.z + 15.5) > 8.5) continue;
            if (c.velocity.x * c.velocity.x + c.velocity.z * c.velocity.z < 1.5) continue;
            ctx.fx.splash(tmp.set(c.position.x, 0.18, c.position.z), 3);
          }
        }
      }
      ram?.update(dt);
    });

    /** what keeps burning in the blasted breach */
    const breachFires = () => {
      ctx.fx.smoke(V(5, 1, -6), 2.2);
      ctx.fx.fire(V(3.2, 0.7, -5.5), 1.5);
      ctx.fx.fire(V(8.4, 1.1, -8.2), 1.1);
    };

    // ── surf kills: shield bowls and arrows while surfing count double ─────
    const offKill = ctx.combatants.onKill((victim, killer) => {
      if (!surf || surf.phase === 'done' || killer !== player || victim.team !== 'enemy') return;
      ctx.rivalry.addLegolas(1);
      ctx.hud.toast('Surf kill  +2', 'reward');
    });

    // ── ladder push prompt ───────────────────────────────────────────────
    let promptOwner: string | null = null;
    const setPrompt = (owner: string | null, text?: string, label?: string) => {
      if (owner === null && promptOwner === null) return;
      promptOwner = owner;
      ctx.hud.setPrompt(owner ? 'interact' : null, text);
      ctx.input.setInteractLabel(owner ? label ?? null : null);
    };
    const nearestPushable = (maxD: number): SiegeLadder | null => {
      let best: SiegeLadder | null = null;
      let bd = maxD;
      for (const l of ladders) {
        if (!l.pushable) continue;
        const d = Math.hypot(l.pushPoint.x - player.position.x, l.pushPoint.z - player.position.z);
        if (d < bd && Math.abs(player.position.y - WALL_H) < 1.8) {
          bd = d;
          best = l;
        }
      }
      return best;
    };
    let pushes = 0;
    level.onUpdate(() => {
      if (beat !== 'ladders') return;
      const l = nearestPushable(3.4);
      if (l) {
        setPrompt('ladder', 'Push the ladder off the wall', 'Push');
        if (ctx.input.state.interact) {
          const carried = l.push('player');
          pushes++;
          player.camera.shake(0.15, 0.25);
          if (carried >= 2) ctx.hud.toast(`${carried} Uruks carried off the wall`, 'reward');
          if (pushes === 1) void line('Gimli', 'Oh, showing off now, are we?', 2);
        }
      } else if (promptOwner === 'ladder') setPrompt(null);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Beats
    // ─────────────────────────────────────────────────────────────────────

    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true);
      // behind the host, low over its rear ranks: the sea of torches fills the foreground and runs
      // up to the wall, a dark line in the storm with the Hornburg beyond. The shell's wager line
      // ("A friendly wager, laddie?") speaks over this silent establishing shot, before the two-shot.
      level.cameraShot({ position: V(30, 15, 152), lookAt: V(-4, 8, 0), fov: 42, blend: 0 });
      ctx.audio.play('drums', { volume: 0.9 });
      await level.wait(0.3);
      level.cameraShot({ position: V(16, 17, 108), lookAt: V(-6, 10, 0), fov: 42, blend: 4.4 });
      await level.wait(2.7);
      ctx.fx.lightning();
      await level.wait(0.5);
      ctx.audio.play('thunder', { volume: 1.1 });
      await level.wait(0.9);
      // over the front ranks to the battlements
      level.cameraShot({ position: V(-30, 20, 44), lookAt: V(-10, 13.5, -3), fov: 44, blend: 0 });
      await level.wait(0.1);
      level.cameraShot({ position: V(-25, 18.5, 30), lookAt: V(-11, 14, -3), fov: 44, blend: 2.6 });
      await level.wait(2.4);
      // on the battlements: a two-shot of Gimli and Legolas, the storm and the host's torches beyond
      const cam = walk(-9.6, -1.9);
      const look = walk(-15.2, 0.2);
      level.cameraShot({ position: V(cam.x, WALL_H + 1.55, cam.z), lookAt: V(look.x, WALL_H + 1.25, look.z + 1.2), fov: 44, blend: 0 });
      await line('Gimli', "Bah! I can't see a blessed thing over this wall.", 2.6);
      await line('Legolas', 'Shall I describe it to you? Or would you like me to find you a box?', 3.2);
      gimli?.gesture('roar');
      level.cameraShot(null);
      await level.wait(0.6);
      level.cinematic(false);
    }

    /** "Give them a volley": arrows rain from the whole wall into the front ranks */
    async function volley(): Promise<void> {
      beat = 'volley';
      level.objective('Hold the Deeping Wall');
      level.music?.('tension');
      await line('Aragorn', 'Give them a volley!', 1.8);
      // a short cut over the archers' shoulders: the arrows arc out over the coomb in slow motion
      // and the front ranks go down under them
      level.cinematic(true);
      const cam = walk(-21, -1.7);
      level.cameraShot({ position: V(cam.x, WALL_H + 3.1, cam.z), lookAt: V(4, 1.5, 54), fov: 46, blend: 0 });
      const from = new THREE.Vector3();
      const to = new THREE.Vector3();
      const dir = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        for (let i = 0; i < 14; i++) {
          const x = -56 + level.rng() * 114;
          walk(x, 1.8, from);
          from.y = WALL_H + 1.9;
          to.set(x * 0.9 + (level.rng() - 0.5) * 20, 0, 50 + level.rng() * 22);
          to.y = world.ground(to.x, to.z) + 1;
          ballisticDir(from, to, 52, 9.8, dir);
          ctx.projectiles.fire({ origin: from.clone(), dir: dir.clone(), speed: 52, damage: 0, team: 'ally', owner: null, style: 'elven' });
        }
        ctx.audio.play('bow_release', { volume: 1, pitch: 0.9 + k * 0.05 });
        ctx.audio.play('arrow_whoosh', { volume: 0.8 });
        if (k === 0) ctx.time.setScale(0.45, 0.15);
        await level.wait(0.12);
      }
      level.cameraShot({ position: V(cam.x + 2.5, WALL_H + 2.6, cam.z + 1.5), lookAt: V(6, 0.5, 58), fov: 40, blend: 1.6 });
      await level.wait(1.15);
      // the arrows land: the front ranks fall, the torch sea gutters
      world.front.thin(0.4);
      world.host.thin(0.06);
      world.torchSea.setFraction(0.9);
      ctx.audio.play('orc_die', { pos: V(0, 0, 58), volume: 1, pitch: 0.8 });
      ctx.audio.play('orc_die', { pos: V(-20, 0, 56), volume: 0.9, pitch: 0.95 });
      await level.wait(0.6);
      ctx.time.setScale(1, 0.4);
      await level.wait(0.4);
      level.cameraShot(null);
      level.cinematic(false);
      ctx.audio.play('horn_orc', { volume: 1 });
      ctx.audio.play('uruk_roar', { pos: V(0, 0, 70), volume: 1, pitch: 0.75 });
      await level.wait(quick ? 0.5 : 1.2);
    }

    function laddersDone(): number {
      let n = 0;
      for (const l of ladders) if (l.finished) n++;
      return n;
    }

    async function ladderFight(): Promise<void> {
      beat = 'ladders';
      level.music?.(null);
      await line('Legolas', 'Ladders!', 1.2);
      spawnArchers(L.archerSpots.slice(0, 4));
      ctx.hud.setPrompt('draw', 'Shoot the climbers, or push the ladders off');
      const objective = () => level.objective(`Push the ladders off the wall (${laddersDone()}/6)`);
      objective();
      const stopObj = level.onUpdate(() => objective());
      // the elves heave off any ladder that has stood too long (keeps the battle moving)
      const stopElves = level.onUpdate(() => {
        for (const l of ladders) {
          // a ladder left standing (or one the player cannot get to) is heaved off by the elves
          const far = Math.hypot(l.pushPoint.x - player.position.x, l.pushPoint.z - player.position.z) > 8;
          if (l.pushable && ((l.upTime > 30 && l.liveClimbers() === 0) || (l.upTime > 38 && far) || l.upTime > 55)) {
            l.push('elf');
            ctx.hud.toast('The Galadhrim push a ladder clear', 'info');
          }
        }
      });
      let banter = false;
      for (let set = 0; set < 2; set++) {
        for (const i of LADDER_SETS[set]) {
          ladders[i].raise();
          await level.wait(1.6);
        }
        if (set === 0) {
          await level.wait(2);
          ctx.hud.setPrompt(null);
        }
        await level.waitUntil(() => {
          if (!banter && countG() >= 2 && set === 0) {
            banter = true;
            void (async () => {
              await line('Gimli', `${numberWord(countG())} already!`, 1.8);
              // the real counts, as they stand when he answers
              const l = countL();
              const g = countG();
              if (l === 0) {
                await line('Legolas', 'The night is young, Master Dwarf.', 1.8);
                await line('Gimli', 'Ha! Keep up, laddie!', 1.6);
              } else {
                await line('Legolas', `I'm on ${numberWord(l).toLowerCase()}!`, 1.8);
                if (l > g) await line('Gimli', "I'll have no pointy-eared elf outscoring me!", 2.2);
                else await line('Gimli', `${numberWord(l)}? Ha! You'll have to do better than that.`, 2.2);
              }
            })();
          }
          return LADDER_SETS[set].every((i) => ladders[i].finished);
        }, 95);
        for (const i of LADDER_SETS[set]) if (!ladders[i].finished) ladders[i].push('elf');
      }
      stopElves();
      // mop up the Uruks who made it onto the walkway
      await level.waitUntil(() => level.enemiesAlive((c) => c.position.y > WALL_H - 1.5) === 0, 25);
      stopObj();
      setPrompt(null);
      ctx.hud.setPrompt(null);
    }

    /** a berserker torch-bearer sprinting for the culvert */
    function spawnRunner(at: THREE.Vector3, hp: number, pace = 7.2): { e: Enemy; flame: FxHandle | null } {
      // with the AI off an enemy walks its moveTarget at 0.6 x its top speed: `pace` is the real m/s
      const e = level.spawnEnemy({ archetype: 'berserker', weapon: 'torch', hp, speed: pace / 0.6, name: 'Torch-bearer' }, at, Math.PI);
      e.aiEnabled = false;
      e.moveTarget = L.culvert.clone();
      const anchor = e.humanoid.weaponObject('hand_r')?.userData.fireAnchor as THREE.Object3D | undefined;
      const flame = anchor ? ctx.fx.torch(anchor) : null;
      return { e, flame };
    }

    /** most torch-bearers that come before the blast, stopped or not (the beat cannot stall) */
    const MAX_RUNNERS = 7;
    async function culvert(fromCheckpoint: boolean): Promise<void> {
      beat = 'toCulvert';
      level.objective('Watch the culvert: take the fighting step above it');
      if (!fromCheckpoint) {
        await level.waitUntil(() => Math.hypot(player.position.x - L.culvertWatch.x, player.position.z - L.culvertWatch.z) < 5, 12);
      }
      beat = 'culvert';
      // two crossbowmen out on the flanks keep heads down (well behind the runners' lane)
      spawnArchers([V(-36, 0, 40), V(42, 0, 36)], 2);
      await line('Legolas', 'Torches! They are making for the culvert!', 2.2);
      await line('Aragorn', 'Bring them down! Do not let them reach the wall!', 2.2);
      ctx.hud.setPrompt('focus', 'Hold Focus to slow time and mark the torch-bearers');
      let stopped = 0;
      let through = 0;
      let spawned = 0;
      const objective = () => level.objective(`Stop the torch-bearers (${stopped}/3)`);
      objective();
      while (stopped < 3 && spawned < MAX_RUNNERS) {
        const k = spawned++;
        const at = L.runnerStarts[k % L.runnerStarts.length].clone();
        at.x += (level.rng() - 0.5) * 6;
        // the first comes at a jog; the later ones sprint
        const r = spawnRunner(at, 120, k === 0 ? 6.2 : 7.4);
        runner = r.e;
        ctx.audio.play('uruk_roar', { pos: r.e.position, volume: 1, pitch: 0.7 });
        let reached = false;
        await level.waitUntil(() => {
          if (!r.e.alive) return true;
          if (r.e.position.distanceTo(L.culvert) < 3) {
            reached = true;
            return true;
          }
          return false;
        }, 40);
        r.flame?.stop();
        if (k === 0) ctx.hud.setPrompt(null);
        if (r.e.alive) {
          // he made it to the wall: a Rohan defender drops a block on him at the last moment. It
          // does not count, the grate is scorched, and another runner comes
          through++;
          ctx.fx.debris(r.e.position.clone().setY(1.5), 24, 0x8a8478);
          if (through === 1) ctx.fx.fire(L.culvert.clone().setY(0.4), 0.6);
          ctx.audio.play('stone_crumble', { pos: r.e.position, volume: 1 });
          r.e.takeDamage({ amount: 1e5, type: 'crush', source: null, dir: V(0, -1, 0) });
          ctx.hud.toast(reached ? 'He reached the culvert: a defender crushed him. It does not count' : 'A defender stopped him', 'warning');
          if (through === 1) void line('Aragorn', 'Too close! Do not let them reach the wall!', 2);
          else if (through === 2) void line('Gimli', 'Another one at the wall! Shoot, elf, shoot!', 2);
        } else {
          stopped++;
          ctx.hud.toast(`Torch-bearer down (${stopped}/3)`, 'reward');
        }
        objective();
        runner = null;
        await level.wait(stopped >= 3 ? 1.2 : 1.6);
      }
      if (stopped < 3) ctx.hud.toast('Too many reached the wall', 'warning');
    }

    async function blast(): Promise<void> {
      beat = 'blast';
      level.objective(null);
      ctx.hud.setPrompt(null);
      // the last one: armoured, already close, and he will not fall
      const r = spawnRunner(V(6, 0, 30), 9999);
      runner = r.e;
      const keepAlive = level.onUpdate(() => {
        if (r.e.alive) r.e.hp = r.e.maxHp;
      });
      for (const e of ctx.combatants.byTeam('enemy')) if (e !== r.e && (e as Enemy).aiEnabled !== undefined) (e as Enemy).aiEnabled = false;
      level.cinematic(true);
      // nobody may be standing on the culvert section when it goes up
      if (player.position.y > 8 && player.position.x > -5 && player.position.x < 15) player.teleport(L.culvertWatch.clone(), Math.PI * 0.1);
      for (const a of [gimli, aragorn, ...elves]) if (a && a.position.y > 8 && a.position.x > -5 && a.position.x < 15) moveNpc(a, walk(-10 - level.rng() * 6, -0.8));
      const s = walk(-13, -1.2);
      level.cameraShot({ position: V(s.x - 1.6, WALL_H + 2.2, s.z - 1.8), lookAt: V(5, 1.5, 18), fov: 40, blend: 0.4 });
      await line('Aragorn', 'Bring him down! Legolas, kill him!', 1.8);
      // Legolas looses twice: the arrows strike home, the berserker does not even slow
      for (let k = 0; k < 2; k++) {
        player.aimPoint(tmp);
        r.e.aimPoint(tmp2);
        tmp2.addScaledVector(r.e.velocity, 0.45);
        const dir = tmp2.clone().sub(tmp).normalize();
        ctx.projectiles.fire({ origin: tmp.clone(), dir, speed: 70, damage: 40, team: 'player', owner: player, style: 'elven' });
        ctx.audio.play('bow_release', { volume: 1 });
        await level.wait(0.75);
      }
      // the dive into the culvert: wide from the coomb side, the whole culvert section in frame
      level.cameraShot({ position: V(17, 3.4, 22), lookAt: V(4.5, 4.5, -3), fov: 50, blend: 0 });
      await level.waitUntil(() => r.e.position.distanceTo(L.culvert) < 2.2, 9);
      r.e.playPose?.('crouch', 1);
      await level.wait(0.35);
      // BOOM
      keepAlive();
      r.flame?.stop();
      const c = L.culvert.clone().setY(1.6);
      ctx.fx.explosion(c, 3.6);
      ctx.fx.debris(c, 140, 0x8a8478);
      ctx.fx.dust(c, 70, 0x7a7068);
      ctx.fx.splash(c, 30);
      ctx.audio.play('explosion', { pos: c, volume: 1.2, pitch: 0.8 });
      ctx.audio.play('stone_crumble', { pos: c, volume: 1.2 });
      player.camera.shake(1.3, 1.8);
      ctx.input.rumble(1, 700);
      level.removeCombatant(r.e);
      runner = null;
      ctx.time.setScale(0.3, 0.05);
      // hold on the fireball from outside; the wall section gives way under the flash and the dust
      await level.wait(0.12);
      world.setBreached(true);
      ctx.fx.debris(V(5, 9, -5), 90, 0x8a8478);
      ctx.fx.dust(V(5, 6, -5), 50, 0x7a7068);
      // the crossbowmen in the field have done their work: the fight moves inside
      for (const e of [...ctx.combatants.byTeam('enemy')]) if (e.position.z > 4) level.removeCombatant(e);
      breachFires();
      await level.wait(0.42);
      // from high in the court: the wall is gone, the Deep floods through the gap
      level.cameraShot({ position: V(-17, 13, -42), lookAt: V(5, 3, -6), fov: 48, blend: 0 });
      await level.wait(0.3);
      ctx.time.setScale(1, 0.8);
      ctx.audio.play('uruk_roar', { pos: V(5, 0, 6), volume: 1, pitch: 0.7 });
      ctx.audio.play('horn_orc', { volume: 0.9 });
      await line('Gimli', 'The wall! They have breached the wall!', 2);
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
      for (const e of ctx.combatants.byTeam('enemy')) if ((e as Enemy).aiEnabled !== undefined) (e as Enemy).aiEnabled = true;
    }

    let landing: Enemy | null = null;
    async function shieldStair(): Promise<void> {
      beat = 'toStair';
      level.objective('Take a shield at the head of the great stair');
      // Uruks pour in through the breach and up the stair
      for (const z of [-30, -38, -46, -55]) {
        const x = L.stairBottom.x + (level.rng() - 0.5) * 5;
        level.spawnEnemy({ archetype: 'uruk', name: 'Uruk-hai' }, V(x, stairY(z) + 0.4, z), 0);
      }
      for (const dx of [-3.5, 3.5]) level.spawnEnemy({ archetype: 'uruk_pike', behavior: 'hold', name: 'Uruk pikeman' }, V(L.stairBottom.x + dx, 0, L.stairBottom.z - 7), 0);
      landing = level.spawnEnemy({ archetype: 'uruk', name: 'Uruk-hai', hp: 160 }, L.landingUruk.clone(), 0);
      landing.aiEnabled = false;
      landing.playPose?.('roar', 30);
      // he is the leap's target: not to be shot dead (or locked onto) before the landing kill
      const lander = landing;
      lander.targetable = false;
      const guardLanding = level.onUpdate(() => {
        if (!lander.alive) return;
        if (surf && surf.phase !== 'slide') {
          lander.targetable = true;
          return;
        }
        lander.hp = lander.maxHp;
      });
      world.shieldBeacon.visible = true;
      const stop = level.onUpdate(() => {
        const near = player.position.distanceTo(world.shield.position) < 3.2 && !surfRequested;
        if (near) {
          setPrompt('shield', 'Shield-surf down the stair', 'Shield');
          if (ctx.input.state.interact) surfRequested = true;
        } else if (promptOwner === 'shield') setPrompt(null);
      });
      await level.waitUntil(() => surfRequested);
      stop();
      setPrompt(null);

      beat = 'surf';
      level.objective(null);
      world.shield.visible = false;
      world.shieldBeacon.visible = false;
      level.music?.('epic');
      player.teleport(V(L.stairTop.x, WALL_H, L.stairTop.z - 0.4), Math.PI);
      surf = makeShieldSurf(level, landing, () => (surfDone = true));
      player.mover = surf;
      ctx.audio.play('shield_slide', { volume: 1 });
      await level.waitUntil(() => surfDone, 16);
      player.mover = null; // always release, also on the timeout
      ctx.time.setScale(1, 0.3);
      guardLanding();
      if (landing?.alive) {
        landing.aiEnabled = true;
        landing.targetable = true;
      }
      level.music?.(null);
      const n = surf.bowled.length;
      if (n > 0) await line('Gimli', 'That still only counts as one!', 2.2);
      surf.phase = 'done';
    }

    async function breachFight(): Promise<void> {
      beat = 'breach';
      level.objective('Drive them back from the breach');
      if (aragorn) {
        aragorn.anchor = L.breachFight.clone();
        if (aragorn.position.y > 3) moveNpc(aragorn, V(L.breachFight.x - 2, 0, L.breachFight.z - 3), 0);
      }
      if (gimli) {
        gimli.anchor = 'player';
        if (gimli.position.distanceTo(player.position) > 25) moveNpc(gimli, V(player.position.x + 2, 0, player.position.z - 2));
      }
      const gap = [V(2, 0, -11), V(8, 0, -11), V(5, 0, -6.5)];
      await level.wave({
        groups: [
          { spec: { archetype: 'uruk', target: 'nearest' }, count: 5, at: gap, spread: 2.5 },
          { spec: { archetype: 'uruk_pike', target: 'nearest' }, count: 2, at: gap[2], spread: 2 },
        ],
        stagger: 2.5,
        until: 1,
        timeout: 75,
      });
      await line('Aragorn', 'Hold them! Hold them at the breach!', 2);
      await level.wave({
        groups: [
          { spec: { archetype: 'uruk', target: 'nearest' }, count: 4, at: gap, spread: 2.5 },
          { spec: { archetype: 'berserker', target: 'nearest' }, count: 1, at: gap[2], spread: 1 },
          { spec: { archetype: 'uruk_archer', behavior: 'hold' }, count: 2, at: [V(-2, 0, -9), V(12, 0, -9)], spread: 1 },
        ],
        stagger: 2.5,
        until: 0,
        timeout: 80,
      });
    }

    async function fallBack(): Promise<void> {
      beat = 'fallback';
      level.objective('Fall back to the Hornburg');
      await line('Aragorn', 'Fall back! Fall back to the keep!', 2);
      level.cinematic(true);
      level.cameraShot({ position: V(48, 14, -78), lookAt: V(76, 14, -26), fov: 46, blend: 0 });
      // the survivors of the breach are left behind in the court
      for (const e of [...ctx.combatants.byTeam('enemy')]) level.removeCombatant(e);
      player.teleport(L.gateHold.clone(), Math.PI);
      if (gimli) {
        gimli.anchor = gimliAnchor;
        gimliAnchor.copy(L.gimliGate);
        moveNpc(gimli, L.gimliGate, Math.PI);
      }
      if (aragorn) {
        aragorn.anchor = L.aragornGate.clone();
        moveNpc(aragorn, L.aragornGate, Math.PI);
      }
      for (const e of elves) level.removeCombatant(e);
      elves.length = 0;
      for (const p of [V(73.2, 5.8, -38.5), V(78.8, 5.8, -41)]) riders.push(level.spawnAlly({ kind: 'rohirrim', name: 'Rider of Rohan', anchor: p.clone() }, p, Math.PI));
      level.cameraShot({ position: V(66, 13, -60), lookAt: V(76, 7, -30), fov: 46, blend: 2.5 });
      await level.wait(quick ? 0.6 : 2.2);
      level.cameraShot(null);
      await level.wait(0.4);
      level.cinematic(false);
    }

    /** the host in the coomb and the elves on the far wall: out of sight from the gate (and ~0.3 M triangles) */
    const showArmies = (on: boolean) => {
      world.host.mesh.visible = on;
      world.front.mesh.visible = on;
      world.torchSea.points.visible = on;
      for (const e of world.elves) e.mesh.visible = on;
    };

    async function hornburg(): Promise<void> {
      beat = 'gate';
      showArmies(false);
      level.objective('Hold the Hornburg gate until dawn');
      await line('Aragorn', 'Hold the gate! Hold it until the sun is up!', 2.2);
      spawnArchers([V(66, 0, -58), V(88, 0, -60)]);
      holdT = 0;
      let dawnStep = -1;
      let warned = false;
      let spawnT = 2;
      let ramStarted = false;
      let ramTeam2 = false;
      // each blow on the gate costs time (never more than the blow interval, and capped overall)
      let penalty = 0;
      const onStrike = () => {
        const cost = Math.min(2.2, 30 - penalty);
        if (cost > 0) {
          penalty += cost;
          holdT = Math.max(0, holdT - cost);
        }
        if (!warned) {
          warned = true;
          ctx.hud.toast('The ram is at the gate! Kill the bearers', 'warning');
          void line('Gimli', 'The ram! Get that ram off the gate!', 1.8);
        }
      };
      const stop = level.onUpdate((dt) => {
        holdT += dt;
        ctx.hud.setProgress('Dawn', clamp(holdT / HOLD_SECONDS, 0, 1));
        // waves climb the causeway ramp from the court
        spawnT -= dt;
        const ramN = ram ? ram.alive() : 0;
        if (spawnT <= 0 && holdT < HOLD_SECONDS - 6) {
          spawnT = 3.4;
          if (level.enemiesAlive() - ramN < 9) {
            const n = level.rng() < 0.5 ? 2 : 1;
            for (let i = 0; i < n; i++) {
              const p = V(L.courtRear.x + (level.rng() - 0.5) * 10, 0, L.courtRear.z + (level.rng() - 0.5) * 6);
              const arch = level.rng() < 0.2 ? 'uruk_pike' : level.rng() < 0.12 ? 'berserker' : 'uruk';
              const e = level.spawnEnemy({ archetype: arch, behavior: 'charge', target: 'nearest' }, p, 0);
              e.moveTarget = L.rampFoot.clone();
            }
          }
        }
        // the ram: a first team at 12 s, fresh bearers take it up again if it was stopped
        if (!ramStarted && holdT > 12) {
          ramStarted = true;
          ram = new RamTeam(level, onStrike);
          ram.addBearers(6);
          ctx.audio.play('drums', { volume: 1 });
          ctx.hud.toast('A battering ram on the causeway', 'warning');
        }
        if (ram && ramStarted && !ramTeam2 && ram.stopped && holdT > 60 && holdT < HOLD_SECONDS - 30) {
          ramTeam2 = true;
          ram.addBearers(5);
          ctx.audio.play('drums', { volume: 1 });
          ctx.hud.toast('Fresh Uruks take up the ram', 'warning');
        }
        // dawn creeps in over the last part of the hold (a few re-bakes, not every frame)
        const k = clamp((holdT - DAWN_FROM) / (HOLD_SECONDS - DAWN_FROM), 0, 1);
        const step = Math.floor(k * 8);
        if (step > dawnStep && holdT > DAWN_FROM) {
          dawnStep = step;
          level.setEnvironment(lerpEnv(STORM, DAWN, (step / 8) * 0.55));
          if (step === 4) void line('Legolas', 'The sky is greying. Dawn is near.', 2);
        }
      });
      await level.waitUntil(() => holdT >= HOLD_SECONDS, HOLD_SECONDS + 120);
      stop();
      ctx.hud.setProgress(null);
    }

    async function dawn(): Promise<void> {
      beat = 'dawn';
      level.objective(null);
      lightningOn = false;
      level.music?.('epic');
      // every Uruk breaks and runs
      for (const e of ctx.combatants.byTeam('enemy')) {
        const en = e as Enemy;
        if (en.aiEnabled === undefined) continue;
        en.aiEnabled = false;
        en.moveTarget = L.courtRear.clone();
      }
      ctx.audio.play('horn_rohan', { volume: 1.2 });
      showArmies(true);
      level.cinematic(true);
      // the riders appear on the shelf high on the eastern slope, the White Rider out in front
      const rz = DAWN_SHOTS.riderZ;
      const toe = rightToe(rz);
      const riderC = V(toe + DAWN_SHOTS.riderD, 0, rz);
      const ground = (x: number, z: number) => world.ground(x, z);
      const charge = createCrowd({ center: riderC, halfSize: [11, 14], count: 260, kind: 'rohirrim', facing: -Math.PI / 2, speed: 0, props: true }, ground);
      const whiteC = V(riderC.x - 14, 0, rz - 2);
      const white = createCrowd({ center: whiteC, halfSize: [0.6, 0.6], count: 2, kind: 'rohirrim', facing: -Math.PI / 2, speed: 0 }, ground);
      paintCrowd(white, 0xf6f4ee, 1.9);
      for (const c of [charge, white]) {
        c.mesh.userData.noAO = true;
        level.root.add(c.mesh);
        crowds.push(c);
      }
      level.setEnvironment(lerpEnv(STORM, DAWN, 0.8));
      const at = (x: number, up: number, z: number) => V(x, world.ground(x, z) + up, z);
      // from down the slope: the riders massing on the shelf against the dawn sky
      const A = DAWN_SHOTS.ridge;
      level.cameraShot({ position: at(A.p[0], A.p[1], A.p[2]), lookAt: at(A.l[0], A.l[1], A.l[2]), fov: A.fov, blend: 0 });
      await level.wait(0.1); // let the cut land before the slow push-in starts from it
      level.cameraShot({ position: at(A.p2[0], A.p2[1], A.p2[2]), lookAt: at(A.l[0], A.l[1], A.l[2]), fov: A.fov, blend: 5 });
      await Promise.all([line('Legolas', 'Look to the east. Riders on the ridge!', 2.4), level.wait(2.6)]);
      level.setEnvironment(DAWN);
      // the White Rider, close: the sun at his back
      const W = DAWN_SHOTS.white;
      level.cameraShot({ position: at(W.p[0], W.p[1], W.p[2]), lookAt: at(W.l[0], W.l[1], W.l[2]), fov: W.fov, blend: 0 });
      ctx.audio.play('horn_rohan', { volume: 1.2, pitch: 0.9 });
      await Promise.all([line('Aragorn', 'Gandalf. The White Rider!', 2), level.wait(2.2)]);
      // he spurs off, the host of riders behind him
      charge.setSpeed(11);
      white.setSpeed(11.5);
      ctx.audio.play('horse_neigh', { volume: 1 });
      await level.wait(1.2);
      // the charge pours down the slope past the camera and into the host, which breaks and flees
      const C = DAWN_SHOTS.charge;
      level.cameraShot({ position: at(C.p[0], C.p[1], C.p[2]), lookAt: at(C.l[0], C.l[1], C.l[2]), fov: C.fov, blend: 0 });
      await level.wait(0.1);
      level.cameraShot({ position: at(C.p2[0], C.p2[1], C.p2[2]), lookAt: at(C.l2[0], C.l2[1], C.l2[2]), fov: C.fov, blend: 4 });
      const flee = createCrowd({ center: V(-30, 0, 125), halfSize: [70, 22], count: 700, kind: 'uruk', facing: -Math.PI / 2 - 0.3, speed: 0 }, ground);
      flee.mesh.userData.noAO = true;
      level.root.add(flee.mesh);
      crowds.push(flee);
      let frac = 0.9;
      for (let i = 0; i < 5; i++) {
        await level.wait(1.1);
        world.host.thin(0.28);
        world.front.thin(0.4);
        frac *= 0.6;
        world.torchSea.setFraction(frac);
        if (i === 1) flee.setSpeed(5.5);
        if (i === 2) ctx.audio.play('uruk_roar', { pos: V(60, 0, 100), volume: 1, pitch: 1.2 });
        if (i === 3) {
          // over the host's rear as it breaks toward the far end of the coomb
          const F = DAWN_SHOTS.flee;
          level.cameraShot({ position: V(F.p[0], F.p[1], F.p[2]), lookAt: V(F.l[0], F.l[1], F.l[2]), fov: F.fov, blend: 0 });
        }
      }
      for (const e of [...ctx.combatants.byTeam('enemy')]) level.removeCombatant(e);
      // the abandoned ram is hauled clear of the gate while the camera is on the charge
      if (ram) {
        ram.object.visible = false;
        ram.dispose();
        ram = null;
      }
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
      level.music?.(null);
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.cinematic(true);
      level.cameraShot({ position: V(L.gateHold.x - 3.7, 7.3, L.gateHold.z - 6.1), lookAt: V(L.gateHold.x - 0.8, 6.9, L.gateHold.z - 0.7), fov: 40, blend: 0.6 });
      player.teleport(L.gateHold.clone(), Math.PI + 0.6);
      if (gimli) moveNpc(gimli, V(L.gateHold.x - 1.6, 5.8, L.gateHold.z - 1.4), yawOf(1.6, 1.4));
      const g = countG();
      const l = countL();
      await Promise.all([line('Gimli', `${numberWord(g)}!`, 1.6), level.wait(1.7)]);
      await Promise.all([line('Legolas', `${numberWord(l)}.`, 1.6), level.wait(1.7)]);
      if (l > g) await line('Gimli', 'Bah! The night is not over until I say it is.', 2.4);
      else await line('Legolas', 'The count is not finished yet, Master Dwarf.', 2.4);
      gimli?.gesture('cheer');
      await level.wait(quick ? 0.3 : 1);
      level.complete();
    }

    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await volley();
        await ladderFight();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await culvert(from === 1);
        await blast();
        level.checkpoint(2);
      }
      if (from <= 2) {
        await shieldStair();
        await breachFight();
        await fallBack();
        level.checkpoint(3);
      }
      await hornburg();
      await dawn();
      await outro();
    }

    const hintStairWalk = walk(L.stairTop.x, -0.8);
    const hintStairHead = V(L.stairTop.x, WALL_H, L.stairTop.z + 2);
    const hintStairFoot = V(L.stairBottom.x, 0, L.stairBottom.z - 3);
    const hintBreachTurn = V(-17, 0, -76);

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 3);
        if (c >= 1) {
          for (const l of ladders) l.hide();
          world.front.thin(0.4);
          world.host.thin(0.06);
          world.torchSea.setFraction(0.9);
        }
        if (c >= 2) {
          world.setBreached(true);
          breachFires();
        }
        if (c === 0) player.teleport(L.spawn.clone(), outYaw(L.spawn.x));
        else if (c === 1) player.teleport(L.culvertWatch.clone(), yawOf(5 - L.culvertWatch.x, 30 - L.culvertWatch.z));
        else if (c === 2) player.teleport(walk(-22, -0.6), yawOf(-8, -2));
        else player.teleport(L.gateHold.clone(), Math.PI);
        spawnAllies(c);
        void run(c);
      },
      update(): void {},
      dispose(): void {
        offKill();
        ram?.dispose();
        for (const cr of crowds) cr.dispose();
        world.dispose();
      },
      botHint() {
        /** reach a walkway point: along the wall to the stair head first, and back up the stair if fallen into the court */
        const onWall = (target: THREE.Vector3): THREE.Vector3 => {
          const p = player.position;
          if (p.y > WALL_H - 2) return target;
          const onStair = Math.abs(p.x - L.stairTop.x) < 4.2 && p.z < L.stairTop.z + 0.5 && p.z > L.stairBottom.z - 4.5;
          return onStair ? hintStairHead : hintStairFoot;
        };
        switch (beat) {
          case 'volley':
          case 'intro':
            return { moveTo: L.spawn };
          case 'ladders': {
            // the nearest standing ladder: walk to it and shove it off
            let best: SiegeLadder | null = null;
            let bd = Infinity;
            for (const l of ladders) {
              if (!l.pushable) continue;
              const d = Math.abs(l.pushPoint.x - player.position.x);
              if (d < bd) {
                bd = d;
                best = l;
              }
            }
            if (!best) return { moveTo: onWall(L.wallHold) };
            const near = Math.hypot(best.pushPoint.x - player.position.x, best.pushPoint.z - player.position.z) < 2.6;
            return { moveTo: onWall(best.pushPoint), interact: near };
          }
          case 'toCulvert':
          case 'culvert':
          case 'blast':
            return { moveTo: onWall(L.culvertWatch), lookAt: runner?.position ?? L.culvert };
          case 'toStair': {
            const near = player.position.distanceTo(world.shield.position) < 2.8;
            // along the walkway to the stair head first (a straight line cuts over the inner edge)
            const along = player.position.y > WALL_H - 2 && Math.abs(player.position.x - L.stairTop.x) > 2.5;
            return { moveTo: along ? hintStairWalk : onWall(world.shield.position), interact: near };
          }
          case 'surf':
            return { moveTo: L.landingUruk };
          case 'breach': {
            // from the stair foot, round the east side of the stair (a straight line runs up its cheek)
            const p = player.position;
            if (p.y > 1.2 && Math.abs(p.x - L.stairTop.x) < 6 && p.z > L.stairBottom.z) return { moveTo: hintStairFoot };
            if (p.x < -18.5 && p.z < -48) return { moveTo: hintBreachTurn };
            return { moveTo: L.breachFight };
          }
          case 'gate':
          case 'fallback':
            return { moveTo: L.gateHold, lookAt: L.causewayStart };
          default:
            return null;
        }
      },
    };
  },
};
