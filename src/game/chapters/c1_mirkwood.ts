/**
 * Chapter 1 — Spiders of Mirkwood (The Hobbit: The Desolation of Smaug).
 *
 *   cp0  The Web Clearing   Legolas drops from a bough as spiders close on the cocoons; three waves
 *                           (3, 4, 5) dropping on silk and crawling down the trunks. Draw/loose,
 *                           knives, dash and Focus are taught on the way.
 *   cp1  Free the Dwarves   cut four cocooned dwarves down (1.5 s knife cut, interrupted by damage)
 *                           while spiders keep coming; Tauriel and two archers arrive halfway.
 *   cp2  The Brood Mother   she bursts from the web hollow: leg-stab combo, web volley, leap slam,
 *                           spiderlings; eyes are the weak point (×3). At 50 % she climbs into the
 *                           canopy web: shoot its three glowing anchors to bring her down (fall
 *                           damage, stunned 4 s). Kill → slow-mo.
 *   outro                   Thranduil's guard surrounds the freed dwarves: "Search them."
 *
 * World: mirkwood/world.ts. Creatures: src/creatures/spider.ts (model), mirkwood/spiders.ts (AI).
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, EnvironmentPreset, LevelAPI, PlayerMover } from '../../core/types';
import { ENVIRONMENTS } from '../../core/environment';
import { clamp, yawOf } from '../../core/math';
import { Rng } from '../../core/rng';
import { buildWorld, type CutCocoon } from './mirkwood/world';
import {
  BRANCH, BROOD_EMERGE, C1, C2, C3, CANOPY, CLIMBERS, DROPS, HOLLOW, STARTS, TAURIEL_ENTRY, V,
} from './mirkwood/layout';
import { BroodMother, Spider, WebAnchor, WebSystem, type ClimbPoint, type SpiderOpts } from './mirkwood/spiders';
import { createSpiderModel, preloadSpiders } from '../../creatures/spider';

type Area = 'c1' | 'c2' | 'c3';
type Beat = 'intro' | 'fight' | 'travel' | 'cocoons' | 'boss' | 'outro';

const CUT_TIME = 1.5;

export const chapter: ChapterDef = {
  id: 'mirkwood',
  number: 1,
  title: 'Spiders of Mirkwood',
  film: 'The Hobbit: The Desolation of Smaug',
  blurb: 'The black depths of Mirkwood. Giant spiders have webbed Thorin\'s company: cut the dwarves free and face the Brood Mother in her hollow.',
  environment: 'mirkwood',
  checkpoints: ['The Web Clearing', 'Free the Dwarves', 'The Brood Mother'],
  parTime: 360,
  preload: ['tauriel', 'elf', 'dwarf'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1';

    // a darker, less milky Mirkwood: deep green-grey gloom, the shafts doing the lighting
    const base = ENVIRONMENTS.mirkwood as EnvironmentPreset & Record<string, unknown>;
    level.setEnvironment({
      ...base,
      fog: { color: 0x1f2f26, density: 0.026 },
      exposure: 1.22,
      hemiIntensity: 0.95,
      mist: 0.55,
      grade: { ...base.grade, saturation: 0.84, gain: [0.97, 1.03, 0.94] },
    } as EnvironmentPreset);

    // mesh the spider sculpts in the worker pool while the world is built, then warm the creature cache
    const meshing = preloadSpiders([['spider', 0], ['spider', 1], ['brood', 0]]);
    const world = buildWorld(level);
    await meshing;
    for (const [v, s] of [['spider', 0], ['spider', 1], ['brood', 0]] as const) createSpiderModel(v, s).dispose();

    const webs = new WebSystem(level);
    const rng = new Rng(1717 + (Number(ctx.flags.seed) || 0));
    const ground = (x: number, z: number) => ctx.physics.heightAt(x, z);
    const centers: Record<Area, THREE.Vector3> = { c1: C1, c2: C2, c3: C3 };

    // climb paths: bark points from 11 m down to the roots, facing each area's centre
    const climbPaths = new Map<number, ClimbPoint[][]>();
    for (const area of ['c1', 'c2', 'c3'] as Area[]) {
      for (const hi of CLIMBERS[area]) {
        const h = world.heroes[hi];
        const c = centers[area];
        const a0 = Math.atan2(c.z - h.z, c.x - h.x);
        const list: ClimbPoint[][] = [];
        for (const off of [-0.45, 0, 0.45]) {
          const pts: ClimbPoint[] = [];
          for (let y = 11; y >= 0.5; y -= 0.75) {
            const s = world.probe(hi, a0 + off + Math.sin(y * 0.4) * 0.12, y);
            pts.push({ p: s.point, n: s.normal });
          }
          list.push(pts);
        }
        climbPaths.set(hi, list);
      }
    }

    // ── state ───────────────────────────────────────────────────────────
    let beat: Beat = 'intro';
    const spiders: Spider[] = [];
    let brood: BroodMother | null = null;
    const anchors: WebAnchor[] = [];
    const dwarves: Ally[] = [];
    const elves: Ally[] = [];
    let tauriel: Ally | null = null;
    let cutting: CutCocoon | null = null;
    let cutT = 0;
    let travelTo: THREE.Vector3 | null = null;
    let lastDrop = -1;

    const alive = () => spiders.filter((s) => s.alive).length;

    const LINES_OF: Record<Area, number[]> = { c1: [0, 1, 2], c2: [3, 4, 5], c3: [6, 7] };
    function spawnSpider(area: Area, how: 'drop' | 'climb' | 'line', o: SpiderOpts = {}): Spider {
      const s = new Spider(level, webs, { seed: spiders.length % 2, ...o });
      if (how === 'line') {
        // crawl out along a silk line strung between two trunks, upside down, then drop on a thread
        const li = LINES_OF[area][Math.floor(rng.float() * LINES_OF[area].length)];
        const fromA = rng.chance(0.5);
        const stop = 0.3 + rng.float() * 0.4;
        const path: ClimbPoint[] = [];
        for (let k = 0; k <= 10; k++) {
          const f = fromA ? (k / 10) * stop : 1 - (k / 10) * (1 - stop);
          path.push({ p: world.linePoint(li, f), n: V(0, -1, 0) });
        }
        s.climbAlong(path, 1, () => {
          const at = s.position.clone();
          s.descendFrom(at.clone().add(V(0, 0.2, 0)), at.y - 0.6, 5);
        }, 0.35);
      } else if (how === 'climb') {
        const hi = CLIMBERS[area][Math.floor(rng.float() * CLIMBERS[area].length)];
        const paths = climbPaths.get(hi)!;
        s.climbAlong(paths[Math.floor(rng.float() * paths.length)]);
      } else {
        const pts = DROPS[area];
        let k = Math.floor(rng.float() * pts.length);
        for (let tries = 0; tries < pts.length; tries++) {
          const [x, z] = pts[k];
          if (k !== lastDrop && Math.hypot(x - player.position.x, z - player.position.z) > 4.5) break;
          k = (k + 1) % pts.length;
        }
        lastDrop = k;
        const [x, z] = pts[k];
        const g = ground(x, z);
        s.descendFrom(V(x, g + 19, z), g + 13 + rng.float() * 3, 5 + rng.float() * 1.5);
      }
      level.addCombatant(s);
      spiders.push(s);
      return s;
    }

    /** a group of spiders arriving a beat apart; resolves when `until` remain (or on timeout) */
    async function spiderWave(area: Area, list: { how: 'drop' | 'climb' | 'line'; o?: SpiderOpts }[], until: number, timeout: number): Promise<void> {
      const mine: Spider[] = [];
      for (const it of list) {
        mine.push(spawnSpider(area, it.how, it.o));
        await level.wait(0.7 + rng.float() * 0.6);
      }
      await level.waitUntil(() => mine.filter((s) => s.alive).length <= until, timeout);
    }

    const say = (who: string, text: string, sec?: number) => (quick ? Promise.resolve() : level.say(who, text, sec));
    const prompt = async (action: 'interact' | 'jump' | 'melee' | 'focus' | 'draw', text: string, sec: number) => {
      ctx.hud.setPrompt(action, text);
      await level.wait(sec);
      ctx.hud.setPrompt(null);
    };

    // ── allies ──────────────────────────────────────────────────────────
    function spawnTauriel(at: THREE.Vector3, withElves = true): void {
      if (tauriel) return;
      tauriel = level.spawnAlly({ kind: 'tauriel', name: 'Tauriel', anchor: 'player' }, at);
      if (withElves) {
        for (let i = 0; i < 2; i++) elves.push(level.spawnAlly({ kind: 'elf_archer', name: 'Elf of the Woodland Realm', anchor: 'player' }, at.clone().add(V(-1.5 + i * 3, 0, 2))));
      }
    }

    function freeDwarf(c: CutCocoon, instant: boolean): void {
      c.cut = true;
      const obj = c.object;
      const strand = obj.children[1];
      strand?.removeFromParent();
      const L = (obj.userData.bodyHeight as number) ?? 1.5;
      const drop = (obj.userData.hangDrop as number) ?? 2;
      const g = ground(c.hang.x, c.hang.z);
      const reach = drop + L; // from the hang point to the feet
      const fall = c.hang.y - reach - g; // how far the feet are off the ground
      let t = instant ? 10 : 0;
      const done = () => {
        const side = V(Math.cos(c.index * 1.7 + 0.4), 0, -Math.sin(c.index * 1.7 + 0.4));
        const at = c.spot.clone().addScaledVector(side, 1.3);
        dwarves.push(level.spawnAlly({ kind: 'dwarf', name: 'Dwarf', anchor: at.clone() }, at, yawOf(player.position.x - at.x, player.position.z - at.z)));
      };
      const step = (dt: number) => {
        t += dt;
        // fall onto the feet, then topple over (rotating about the feet)
        const fu = clamp(t / 0.3, 0, 1);
        const tu = clamp((t - 0.3) / 0.55, 0, 1);
        const th = 1.42 * tu * tu;
        const fy = g + fall * (1 - fu * fu);
        obj.position.set(c.hang.x, fy + reach * Math.cos(th), c.hang.z + reach * Math.sin(th));
        obj.rotation.set(th, 0, 0);
        return t >= 0.9;
      };
      if (instant) {
        step(0);
        done();
        return;
      }
      ctx.audio.play('web_tear', { pos: c.spot, volume: 1 });
      ctx.fx.dust(c.spot, 8, 0xe0dccc);
      const stop = level.onUpdate((dt) => {
        if (step(dt)) {
          stop();
          ctx.fx.dust(c.spot, 10);
          done();
        }
      });
    }

    // ── the cocoon cut (an interaction with a hold) ─────────────────────
    let cutFace = 0;
    const holdMover: PlayerMover = {
      pose: 'crouch',
      camera: { distance: 3.2, height: 1.5 },
      allowShoot: false,
      allowMelee: false,
      allowJump: false,
      allowDash: false,
      update(_dt, p) {
        p.velocity.set(0, 0, 0);
        p.facing = cutFace;
      },
    };
    let cutDamage0 = 0;
    let cutHp0 = 0;
    function updateCutting(dt: number): void {
      if (beat !== 'cocoons') return;
      if (cutting) {
        cutT += dt;
        ctx.hud.setProgress('Cutting the web', cutT / CUT_TIME);
        const hurt = player.tally.damageTaken > cutDamage0 + 0.01 || player.hp < cutHp0 - 0.01;
        if (hurt) {
          ctx.hud.toast('Interrupted!', 'warning');
          endCut();
          return;
        }
        if (cutT >= CUT_TIME) {
          const c = cutting;
          endCut();
          freeDwarf(c, false);
          const n = world.cocoons.filter((k) => k.cut).length;
          level.objective(n < 4 ? `Cut the dwarves free (${n}/4)` : 'Clear the spiders from the larder');
          ctx.audio.play('reward', { volume: 0.5 });
        }
        return;
      }
      const near = nearestCocoon();
      const ok = near && near.d < 2.4;
      ctx.hud.setPrompt(ok ? 'interact' : null, 'Cut the cocoon');
      ctx.input.setInteractLabel(ok ? 'Cut' : null);
      if (ok && ctx.input.state.interact && player.grounded !== false) {
        cutting = near!.c;
        cutT = 0;
        cutDamage0 = player.tally.damageTaken;
        cutHp0 = player.hp;
        cutFace = yawOf(cutting.spot.x - player.position.x, cutting.spot.z - player.position.z);
        player.mover = holdMover;
        ctx.hud.setPrompt(null);
        ctx.audio.play('knife_slash', { pos: player.position, volume: 0.7 });
      }
    }
    function endCut(): void {
      cutting = null;
      cutT = 0;
      if (player.mover === holdMover) player.mover = null;
      ctx.hud.setProgress(null);
    }
    function nearestCocoon(): { c: CutCocoon; d: number } | null {
      let best: CutCocoon | null = null;
      let bd = Infinity;
      for (const c of world.cocoons) {
        if (c.cut) continue;
        const d = Math.hypot(c.spot.x - player.position.x, c.spot.z - player.position.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best ? { c: best, d: bd } : null;
    }
    level.onUpdate(updateCutting);

    // ── beats ───────────────────────────────────────────────────────────

    /** Legolas on the bough, an arrow for the spider on the cocoon, the drop into the clearing */
    async function intro(): Promise<void> {
      beat = 'intro';
      const gB = ground(BRANCH.from.x, BRANCH.from.z);
      const top = V(BRANCH.from.x, gB + BRANCH.from.y, BRANCH.from.z);
      const land = V(BRANCH.to.x, ground(BRANCH.to.x, BRANCH.to.z), BRANCH.to.z);
      const face = yawOf(land.x - top.x, land.z - top.z);
      if (quick) {
        player.teleport(land, 0.1);
        return;
      }
      level.cinematic(true);
      // hold Legolas on the bough
      let dropT = -1;
      const bough: PlayerMover = {
        pose: 'crouch',
        allowShoot: false,
        update(dt, p) {
          if (dropT < 0) {
            p.position.copy(top);
            p.velocity.set(0, 0, 0);
          } else {
            dropT += dt;
            const u = Math.min(1, dropT / 0.85);
            const prevY = p.position.y;
            p.position.lerpVectors(top, land, u);
            p.position.y = top.y + (land.y - top.y) * u * u + Math.sin(u * Math.PI) * 0.6;
            p.velocity.set((land.x - top.x) / 0.85, (p.position.y - prevY) / Math.max(dt, 1e-4), (land.z - top.z) / 0.85);
          }
          p.facing = face;
        },
      };
      player.mover = bough;
      // a spider lowers itself onto a cocoon in the clearing
      const sp = new Spider(level, webs, { seed: 1 });
      const sx = -6.5;
      const sz = 7;
      sp.descendFrom(V(sx, ground(sx, sz) + 19, sz), ground(sx, sz) + 9.5, 1.3);
      sp.aiEnabled = false;
      level.addCombatant(sp);
      spiders.push(sp);
      level.cameraShot({ position: top.clone().add(V(3.4, 0.9, 2.2)), lookAt: top.clone().add(V(0, 1.2, 0)), fov: 46, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: top.clone().add(V(2.6, 0.5, 2.6)), lookAt: top.clone().add(V(0, 1.3, 0.4)), fov: 42, blend: 1.4 });
      await level.wait(1.4);
      level.cameraShot({ position: top.clone().add(V(1.6, 1.9, -2.4)), lookAt: V(sx, ground(sx, sz) + 5.5, sz), fov: 40, blend: 1.8 });
      await level.wait(1.9);
      // loose
      const from = top.clone().add(V(0.2, 1.55, 0.2));
      const aim = sp.aimPoint(new THREE.Vector3());
      const dir = aim.sub(from).normalize();
      sp.hp = Math.min(sp.hp, 20);
      ctx.audio.play('bow_release', { pos: from, volume: 0.9 });
      ctx.projectiles.fire({ origin: from, dir, speed: 75, damage: 60, team: 'player', owner: player, style: 'elven', gravity: 0.3 });
      await level.wait(0.9);
      await level.say('Legolas', 'Easy, dwarf. I would not miss.', 2.4);
      if (sp.alive) sp.kill(player);
      // drop into the clearing
      level.cameraShot({ position: V(-4.5, ground(-4.5, -3) + 1.6, -3), lookAt: land.clone().add(V(0, 1.4, 0)), fov: 50, blend: 0.5 });
      dropT = 0;
      await level.wait(0.95);
      player.mover = null;
      player.teleport(land, 0.1);
      ctx.fx.dust(land, 5);
      ctx.audio.play('land', { pos: land, volume: 0.8 });
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
    }

    async function ambush(): Promise<void> {
      beat = 'fight';
      level.objective('Drive off the spiders');
      void prompt('draw', 'Hold to draw the bow, release to loose', 7);
      await spiderWave('c1', [{ how: 'drop' }, { how: 'drop' }, { how: 'drop' }], 0, 75);
      await say('Legolas', 'More in the branches.', 1.8);
      void prompt('melee', 'Close in? Use your knives', 7);
      await spiderWave('c1', [{ how: 'climb' }, { how: 'line' }, { how: 'climb' }, { how: 'drop' }], 0, 85);
      ctx.hud.toast('Dash to slip a spider\'s lunge', 'info');
      void prompt('focus', 'Focus: slow time and mark several spiders', 8);
      await spiderWave('c1', [{ how: 'climb' }, { how: 'drop', o: { spitter: true } }, { how: 'line' }, { how: 'climb' }, { how: 'drop' }], 0, 95);
      ctx.hud.setPrompt(null);
    }

    async function travel(to: THREE.Vector3, text: string, r: number): Promise<void> {
      beat = 'travel';
      travelTo = to;
      level.objective(text);
      await level.waitUntil(() => Math.hypot(player.position.x - to.x, player.position.z - to.z) < r, 60);
      travelTo = null;
    }

    async function freeTheDwarves(): Promise<void> {
      beat = 'cocoons';
      level.objective('Cut the dwarves free (0/4)');
      void prompt('interact', 'Stand under a cocoon to cut it down', 5);
      let spawned = 0;
      let nextSpawn = 2;
      const t0 = ctx.time.t;
      const stopSpawner = level.onUpdate((dt) => {
        nextSpawn -= dt;
        const n = alive();
        const want = world.cocoons.every((c) => c.cut) ? 0 : 5;
        if (n < want && nextSpawn <= 0 && spawned < 22) {
          spawned++;
          nextSpawn = 2.6 + rng.float() * 1.5;
          spawnSpider('c2', rng.chance(0.4) ? 'climb' : rng.chance(0.4) ? 'line' : 'drop', { spitter: spawned % 5 === 3 });
        }
      });
      // Tauriel arrives halfway (after two cuts, or a minute in)
      void (async () => {
        await level.waitUntil(() => world.cocoons.filter((c) => c.cut).length >= 2 || ctx.time.t - t0 > 60, 120);
        spawnTauriel(TAURIEL_ENTRY);
        await level.wait(1.2);
        await level.say('Legolas', 'Tauriel.', 1.4);
        await level.say('Tauriel', 'Lord Legolas, the nest is beyond the hollow.', 2.8);
      })();
      await level.waitUntil(() => world.cocoons.every((c) => c.cut), 260);
      // a stuck cut must never block the chapter
      for (const c of world.cocoons) if (!c.cut) freeDwarf(c, true);
      endCut();
      ctx.hud.setPrompt(null);
      ctx.input.setInteractLabel(null);
      stopSpawner();
      level.objective('Clear the spiders from the larder');
      await level.waitUntil(() => alive() === 0, 45);
      await say('Legolas', 'They came from the hollow. We end this there.', 2.6);
    }

    async function broodMother(): Promise<void> {
      beat = 'boss';
      // the freed dwarves wait out of sight at the larder until it is over
      for (const d of dwarves) {
        d.aiEnabled = false;
        d.object.visible = false;
      }
      level.objective('Kill the Brood Mother');
      const b = new BroodMother(level, webs, {
        onSummon: () => {
          // three spiderlings drop around her
          for (let i = 0; i < 3; i++) spawnLing(b.position);
        },
      });
      brood = b;
      const emerge = V(BROOD_EMERGE.x, ground(BROOD_EMERGE.x, BROOD_EMERGE.z), BROOD_EMERGE.z);
      b.object.position.copy(emerge);
      b.aiEnabled = false;
      level.addCombatant(b);
      // she bursts out of the web hollow
      const out = V(C3.x, ground(C3.x, C3.z + 9), C3.z + 9);
      if (!quick) {
        level.cinematic(true);
        level.cameraShot({ position: V(-5, ground(-5, 64) + 1.4, 64), lookAt: V(0, ground(0, 88) + 2.5, 88), fov: 44, blend: 0 });
      }
      ctx.audio.play('web_tear', { pos: emerge, volume: 1, pitch: 0.5 });
      ctx.fx.dust(emerge, 16, 0xd8d4c4);
      ctx.player.camera.shake(0.35, 1);
      b.leapTo(out, 1.1, () => b.roar(1.6));
      await level.wait(quick ? 1.2 : 2.0);
      if (!quick) {
        level.cameraShot({ position: V(3, ground(3, 70) + 0.9, 70), lookAt: out.clone().add(V(0, 2.2, 0)), fov: 40, blend: 0.8 });
        await level.say('Tauriel', 'The mother of the brood. Mind her legs!', 2.4);
        await level.say('Legolas', 'Her eyes. Aim for her eyes.', 2.0);
        level.cameraShot(null);
        await level.wait(0.5);
        level.cinematic(false);
      }
      level.boss(b, 'The Brood Mother');
      b.aiEnabled = true;
      void prompt('draw', 'Her eyes are the weak point', 6);

      // phase 1 → 50 %
      await level.waitUntil(() => b.hp <= b.maxHp * 0.5 || !b.alive);
      if (b.alive) {
        await canopyPhase(b);
        await level.waitUntil(() => b.move !== 'stun' || !b.alive, 6);
      }
      b.phase = 3;
      level.objective('Kill the Brood Mother — she is enraged');
      await level.waitUntil(() => !b.alive);
      ctx.time.setScale(0.25, 0.12);
      await level.wait(0.4);
      ctx.time.setScale(1, 0.5);
      for (const s of spiders) if (s.alive) s.kill(null);
      await level.wait(1.2);
    }

    function spawnLing(near: THREE.Vector3): Spider {
      const s = new Spider(level, webs, { size: 0.5, hp: 24, damage: 6, speed: 7, seed: spiders.length % 2, name: 'Spiderling' });
      const a = rng.float() * Math.PI * 2;
      const r = 4 + rng.float() * 4;
      const x = clamp(near.x + Math.cos(a) * r, C3.x - 12, C3.x + 12);
      const z = clamp(near.z + Math.sin(a) * r, C3.z - 11, C3.z + 11);
      const g = ground(x, z);
      s.descendFrom(V(x, g + 15, z), g + 9 + rng.float() * 3, 6);
      level.addCombatant(s);
      spiders.push(s);
      return s;
    }

    async function canopyPhase(b: BroodMother): Promise<void> {
      b.phase = 2;
      b.invulnerable = true;
      b.scripted = true;
      b.aiEnabled = false;
      b.roar(1.2);
      ctx.audio.play('spider_hiss', { pos: b.position, volume: 1, pitch: 0.4 });
      // up the nearest canopy trunk...
      const hi = [11, 12].sort((x, y) => world.heroes[x].z - b.position.z - (world.heroes[y].z - b.position.z) + Math.abs(world.heroes[x].x - b.position.x) - Math.abs(world.heroes[y].x - b.position.x))[0];
      const h = world.heroes[hi];
      const a = Math.atan2(C3.z - h.z, C3.x - h.x);
      const up: ClimbPoint[] = [];
      for (let y = CANOPY.height - 1.2; y >= 0.5; y -= 0.8) {
        const s = world.probe(hi, a, y);
        up.push({ p: s.point, n: s.normal });
      }
      const foot = up[up.length - 1].p.clone().add(V(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5));
      foot.y = ground(foot.x, foot.z);
      level.objective('She is climbing into the web!');
      // run to the trunk's foot, then climb
      b.goal = foot;
      await level.waitUntil(() => Math.hypot(foot.x - b.position.x, foot.z - b.position.z) < 1.5, 5);
      b.goal = null;
      b.velocity.set(0, 0, 0);
      // (level waits, not bare promises: the script resumes on the same step in headless runs too)
      let climbed = false;
      b.climbAlong(up, -1, () => (climbed = true));
      await level.waitUntil(() => climbed || !b.alive, 20);
      // ...then under the web to its centre
      const from = b.position.clone();
      const to = world.canopy.center.clone().add(V(0, -0.4, 0));
      let tt = 0;
      let crawled = false;
      const stopCrawl = level.onUpdate((dt) => {
        tt += dt;
        const u = Math.min(1, tt / 2.2);
        b.object.position.lerpVectors(from, to, u * u * (3 - 2 * u));
        b.object.position.y += Math.sin(u * Math.PI) * 0.6;
        if (u >= 1) crawled = true;
      });
      b.hangUnder(from);
      await level.waitUntil(() => crawled, 5);
      stopCrawl();
      b.hangUnder(to);
      b.targetable = false;
      b.scripted = false;
      // the anchors glow
      for (const an of anchors) an.setActive(true);
      level.objective('Shoot the glowing web anchors (0/3)');
      void prompt('draw', 'Shoot the three glowing anchors holding the web', 7);
      const stopLings = (() => {
        let tl = 4;
        return level.onUpdate((dt) => {
          tl -= dt;
          if (tl <= 0 && alive() < 5) {
            tl = 8 + rng.float() * 3;
            spawnLing(C3);
            spawnLing(C3);
          }
        });
      })();
      const stopCount = level.onUpdate(() => {
        const n = anchors.filter((x) => !x.alive).length;
        level.objective(n < 3 ? `Shoot the glowing web anchors (${n}/3)` : 'The web is falling!');
      });
      await level.waitUntil(() => anchors.every((x) => !x.alive), 130);
      stopCount();
      stopLings();
      for (const an of anchors) if (an.alive) an.kill(null);
      // the canopy gives way: she falls
      ctx.audio.play('web_tear', { pos: world.canopy.center, volume: 1, pitch: 0.45 });
      ctx.audio.play('stone_crumble', { pos: world.canopy.center, volume: 0.5, pitch: 1.6 });
      dropCanopy();
      b.scripted = true;
      let landed = false;
      b.fall(() => {
        b.invulnerable = false;
        b.takeDamage({ amount: b.maxHp * 0.12, type: 'fall', source: null });
        b.stun(4);
        landed = true;
      });
      await level.waitUntil(() => landed || !b.alive, 8);
      if (!landed) {
        // safety: never leave her hanging
        b.invulnerable = false;
        b.stun(4);
      }
      b.scripted = false;
      b.targetable = true;
      b.aiEnabled = true;
      level.objective('She is stunned — strike her eyes!');
      void prompt('draw', 'Stunned! Strike her eyes', 4);
    }

    function dropCanopy(): void {
      const sheet = world.canopy.sheet;
      const lines = world.canopy.lines;
      let vy = 0;
      let y = 0;
      const stop = level.onUpdate((dt) => {
        vy -= 18 * dt;
        y += vy * dt;
        sheet.position.y = y;
        lines.position.y = y;
        if (y < -world.canopy.center.y + ground(C3.x, C3.z) - 1.5) {
          stop();
          sheet.visible = false;
          lines.visible = false;
          ctx.fx.dust(V(C3.x, ground(C3.x, C3.z), C3.z), 20, 0xd8d4c4);
        }
      });
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.objective(null);
      ctx.hud.setPrompt(null);
      level.boss(null);
      // gather the freed dwarves at the hollow's mouth, Thranduil's guard closes around them
      const gp = V(C3.x - 2, 0, C3.z - 6);
      gp.y = ground(gp.x, gp.z);
      dwarves.forEach((d, i) => {
        const a = i * (Math.PI * 2 / Math.max(1, dwarves.length));
        const p = V(gp.x + Math.cos(a) * 1.3, 0, gp.z + Math.sin(a) * 1.3);
        p.y = ground(p.x, p.z);
        d.position.copy(p);
        d.anchor = p.clone();
        d.aiEnabled = false;
        d.object.visible = true;
      });
      const guard: Ally[] = [...elves];
      while (guard.length < 6) guard.push(level.spawnAlly({ kind: 'elf_archer', name: 'Elf of the Woodland Realm', anchor: gp.clone() }, gp.clone().add(V(8, 0, -3))));
      guard.forEach((e, i) => {
        const a = (i / guard.length) * Math.PI * 2 + 0.3;
        const p = V(gp.x + Math.cos(a) * 4.2, 0, gp.z + Math.sin(a) * 4.2);
        p.y = ground(p.x, p.z);
        e.position.copy(p);
        e.anchor = p.clone();
        e.aiEnabled = false;
        e.object.rotation.y = yawOf(gp.x - p.x, gp.z - p.z);
      });
      if (!tauriel) spawnTauriel(gp.clone().add(V(3, 0, 3)), false);
      if (tauriel) {
        const tp = gp.clone().add(V(2.6, 0, -3.4));
        tp.y = ground(tp.x, tp.z);
        tauriel.position.copy(tp);
        tauriel.anchor = tp.clone();
        tauriel.aiEnabled = false;
      }
      const lp = gp.clone().add(V(-1.5, 0, -5.2));
      lp.y = ground(lp.x, lp.z);
      player.teleport(lp, yawOf(gp.x - lp.x, gp.z - lp.z));
      level.cinematic(true);
      level.cameraShot({ position: gp.clone().add(V(6.5, 2.4, 6)), lookAt: gp.clone().add(V(0, 1.0, 0)), fov: 42, blend: 0 });
      await level.wait(1.0);
      level.cameraShot({ position: gp.clone().add(V(-4.5, 1.8, -8.5)), lookAt: gp.clone().add(V(0, 1.1, 0)), fov: 38, blend: 3 });
      await level.say('Tauriel', 'Dwarves, in the Elvenking\'s wood.', 2.4);
      await level.say('Legolas', 'Search them.', 1.8);
      await level.wait(1.0);
      level.cameraShot(null);
      level.cinematic(false);
      level.complete();
    }

    /** the screenplay, resumable from any checkpoint */
    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await ambush();
        level.checkpoint(1);
        await say('Legolas', 'They have taken more of them. North, into the dark.', 2.6);
        await travel(C2, 'Follow the webs north to the larder', 13);
      }
      if (from <= 1) {
        if (from === 1 && !quick) await level.say('Legolas', 'The larder. They keep their prey alive.', 2.4);
        await freeTheDwarves();
        level.checkpoint(2);
        await travel(V(C3.x, 0, C3.z - 12), 'Go into the hollow', 8);
      }
      await broodMother();
      await outro();
    }

    // ── canopy anchors (inactive until the canopy phase) ────────────────
    function placeAnchors(): void {
      CANOPY.anchors.forEach((hi) => {
        const h = world.heroes[hi];
        const a = Math.atan2(world.canopy.center.z - h.z, world.canopy.center.x - h.x);
        const s = world.probe(hi, a, CANOPY.height);
        const an = new WebAnchor(level, s.point.clone().addScaledVector(s.normal, 0.35));
        level.addCombatant(an);
        anchors.push(an);
      });
    }

    // diagnostics for the headless tools (bot runs only)
    if (ctx.flags.bot === '1') {
      (window as unknown as { __mirk: unknown }).__mirk = () => ({
        beat,
        alive: alive(),
        brood: brood ? { mode: brood.mode, move: brood.move, phase: brood.phase, hp: Math.round(brood.hp), scripted: brood.scripted, pos: brood.position.toArray().map(Math.round) } : null,
        anchors: anchors.map((a) => a.alive),
        cocoons: world.cocoons.map((c) => c.cut),
      });
    }

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        const s = STARTS[c];
        player.teleport(V(s.pos.x, ground(s.pos.x, s.pos.z), s.pos.z), s.facing);
        placeAnchors();
        if (c >= 2) {
          // the dwarves are free, Tauriel and her archers are with us
          for (const k of world.cocoons) freeDwarf(k, true);
          spawnTauriel(V(s.pos.x + 2.5, 0, s.pos.z - 2.5));
        }
        void run(c);
      },

      update(): void {},

      dispose(): void {
        webs.dispose();
        if (player.mover === holdMover) player.mover = null;
      },

      botHint() {
        switch (beat) {
          case 'fight':
            return { moveTo: C1 };
          case 'travel':
            return travelTo ? { moveTo: travelTo } : null;
          case 'cocoons': {
            if (cutting) return { moveTo: player.position };
            const n = nearestCocoon();
            if (!n) return { moveTo: C2 };
            return { moveTo: n.c.spot, interact: n.d < 2.0 };
          }
          case 'boss':
            return { moveTo: brood && brood.mode === 'ceiling' ? V(C3.x, 0, C3.z - 3) : V(C3.x, 0, C3.z - 6) };
          default:
            return null;
        }
      },
    };
  },
};

void HOLLOW;
