/**
 * Chapter 5: Balin's Tomb (The Fellowship of the Ring).
 *
 *   cp0  The Chamber of Mazarbul   drums in the deep; goblins through the arch, down the wall onto the
 *                                  ledge, out of a hole in the ceiling; archers on the ledge.
 *   cp1  The Cave Troll            boss: chained troll, charge / throw / stun / chain climb / skull /
 *                                  final mouth shot in slow-mo (moria/troll.ts)
 *   cp2  Flight to the Bridge      a timed run through the pillared hall as the ring of goblins closes in;
 *                                  at the end the Balrog's glow, never its body.
 *
 * The world is built in moria/world.ts, the boss in moria/troll.ts, the leash/climb chains in
 * moria/chain.ts, Boromir's spawn trick in moria/cast.ts and every coordinate in moria/layout.ts.
 */
import * as THREE from 'three';
import type { ChapterDef, ChapterInstance, Enemy, EnemySpec, LevelAPI } from '../../core/types';
import { ENVIRONMENTS } from '../../core/environment';
import { clamp, lerp, smoothstep } from '../../core/math';
import { buildMoria } from './moria/world';
import { spawnCast, type Cast } from './moria/cast';
import { createTrollFight, type TrollFight } from './moria/troll';
import { CHECKPOINTS, HALL_HZ, HALL_X1, L, V, inHall, nearPillar } from './moria/layout';

export const chapter: ChapterDef = {
  id: 'moria',
  number: 5,
  title: "Balin's Tomb",
  film: 'The Fellowship of the Ring',
  blurb: 'The Chamber of Mazarbul. Drums in the deep, goblins from the walls, a cave troll in chains, and a long run through the halls of Dwarrowdelf toward the Bridge.',
  environment: 'moria',
  checkpoints: CHECKPOINTS,
  parTime: 380,
  rivalry: true,
  // every humanoid kind this chapter spawns ('orc' = the goblin archers on the ledge, scaled down)
  preload: ['gimli', 'aragorn', 'gondor', 'goblin', 'orc', 'troll'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const { player, audio, fx, hud } = ctx;
    const quick = ctx.flags.skipIntro === '1';

    // the Moria preset, a touch brighter so the carved pillars and the goblins read beyond the firelight
    // (and a less violet grade: neutral cold stone, with the fires as the warm accents)
    const E = ENVIRONMENTS.moria;
    level.setEnvironment({
      ...E,
      exposure: 2.15,
      hemiIntensity: 3.7,
      hemiSky: 0x8a93a2,
      hemiGround: 0x3e3226,
      fog: { color: 0x0b0b0d, density: E.fog.density },
      grade: { ...E.grade, lift: [0.006, 0.005, 0.006], gamma: [1.0, 1.0, 1.0], gain: [1.03, 1.0, 0.97], saturation: 0.95 },
    });
    const world = buildMoria(level);
    /** ?balrog=0..1 pre-sets the glow (look-dev only) */
    if (ctx.flags.balrog) world.setBalrog(clamp(Number(ctx.flags.balrog) || 0, 0, 1));
    /** ?trace=1 logs the script's beats to the console (debugging only) */
    const trace = (msg: string): void => {
      if (ctx.flags.trace === '1') console.log(`[moria] t=${ctx.time.t.toFixed(1)} ${msg}`);
    };

    // ── script state, read by botHint() ────────────────────────────────────
    type Beat = 'intro' | 'chamber' | 'leave' | 'troll' | 'flight' | 'balrog' | 'outro';
    let beat: Beat = 'intro';
    let cast: Cast | null = null;
    let fight: TrollFight | null = null;
    let runStart = 0;

    // ── helpers ──────────────────────────────────────────────────────────
    /** a line of dialogue: awaited normally, fire-and-forget when the intro is skipped (smoke test / bot) */
    const talk = async (speaker: string, text: string, secs?: number): Promise<void> => {
      if (quick) {
        void level.say(speaker, text, secs);
        return;
      }
      await level.say(speaker, text, secs);
    };
    const wait = async (s: number): Promise<void> => {
      if (!quick) await level.wait(s);
    };
    const jitter = (r: number) => (level.rng() * 2 - 1) * r;

    // the drums in the deep: a slow boom that quickens with the chapter
    let drumGap = 0;
    let drumT = 1.5;
    level.onUpdate((dt) => {
      if (drumGap <= 0) return;
      drumT -= dt;
      if (drumT <= 0) {
        drumT = drumGap;
        audio.play('drums', { volume: 0.5 });
        player.camera.shake(0.06, 0.5);
      }
    });

    /** Moria goblins: a little tougher and quicker than the stock goblin (the allies would otherwise clear the room alone) */
    const goblin = (pos: THREE.Vector3, spec: Partial<EnemySpec> = {}): Enemy =>
      level.spawnEnemy({ archetype: 'goblin', name: 'Goblin', hp: 48, damage: 10, speed: 5.9, ...spec }, pos);

    /** goblins pouring through the east arch out of the dark */
    function archRush(n: number): Enemy[] {
      const out: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const s = L.archSpawns[i % L.archSpawns.length];
        out.push(goblin(V(s.x + jitter(2.4), 0, s.z + jitter(1.8))));
      }
      return out;
    }
    /** goblins that scuttle up the south wall and onto the ledge, then leap down at you */
    function climbers(n: number): Enemy[] {
      const out: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const g = goblin(V(L.climbFoot.x + 0.4 + i * 0.5, 0, L.climbFoot.z - 0.3 + jitter(0.4)), { behavior: 'climb' });
        g.moveTarget = V(L.climbTop.x - i * 0.9, L.climbTop.y, L.climbTop.z);
        out.push(g);
      }
      return out;
    }
    /** goblins that drop through the hole in the ceiling */
    function ceilingDrop(n: number): Enemy[] {
      const out: Enemy[] = [];
      const h = L.ceilingHole;
      fx.dust(V(h.x, h.y, h.z - 0.9), 22, 0x4a4540);
      fx.debris(V(h.x, h.y, h.z - 0.9), 10, 0x5a5550);
      audio.play('stone_crumble', { pos: V(h.x, 6, h.z), volume: 0.7 });
      for (let i = 0; i < n; i++) {
        const g = goblin(V(h.x + jitter(0.8), 0, h.z - 0.9 + jitter(0.8)));
        g.position.y = h.y - i * 0.9;
        g.velocity.set(jitter(1.5), -1, jitter(1.5));
        out.push(g);
      }
      audio.play('goblin_screech', { pos: V(h.x, 6, h.z), volume: 0.9 });
      return out;
    }
    /** goblin archers on the ledge (orc archers made goblin-sized) */
    function ledgeArchers(n: number): Enemy[] {
      const out: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const x = lerp(L.ledgeX[0] + 1.0, L.ledgeX[1] - 0.8, n === 1 ? 0.5 : i / (n - 1));
        out.push(
          level.spawnEnemy({ archetype: 'orc_archer', behavior: 'hold', scale: 0.86, name: 'Goblin archer', target: 'player' }, V(x, L.ledgeY + 0.05, L.ledgeZ), Math.PI),
        );
      }
      return out;
    }
    const allDead = (list: Enemy[], until = 0) => () => list.filter((e) => e.alive).length <= until;

    // ── the cast ──────────────────────────────────────────────────────────
    function spawnChamberCast(): void {
      cast = spawnCast(
        level,
        { gimli: V(-0.6, 0, -1.9), aragorn: V(-3.4, 0, 2.6), boromir: V(6.4, 0, 1.6), aragornAnchor: V(-2.4, 0, 2.4), boromirAnchor: V(5.6, 0, 0.4) },
        Math.PI / 2,
      );
    }
    function spawnHallCast(near: THREE.Vector3): void {
      cast = spawnCast(
        level,
        { gimli: V(near.x - 2.6, 0, near.z - 2), aragorn: V(near.x - 3.2, 0, near.z + 2.4), boromir: V(near.x - 4.6, 0, near.z - 0.4), aragornAnchor: undefined, boromirAnchor: undefined },
        Math.PI / 2,
      );
      // in the hall everyone sticks with Legolas
      cast.aragorn.anchor = 'player';
      cast.boromir.anchor = 'player';
    }

    // ── beat 0: the Chamber of Mazarbul ───────────────────────────────────
    async function intro(): Promise<void> {
      beat = 'intro';
      drumGap = 0;
      if (quick) return;
      level.cinematic(true);
      level.music?.('tension');
      level.cameraShot({ position: V(-6.9, 2.1, 5.8), lookAt: V(0.4, 1.9, -3.4), fov: 52, blend: 0 });
      // a silent establishing push-in: the shell's rivalry line ("A friendly wager, laddie?") speaks at
      // 1.2 s for 2 s, and the scripted dialogue must not queue behind it
      await level.wait(0.5);
      level.cameraShot({ position: V(-4.4, 1.7, 3.0), lookAt: V(0.3, 2.0, -3.4), fov: 42, blend: 7.5 });
      await level.wait(3.1);
      await level.say('Gimli', 'Balin, son of Fundin... Lord of Moria. Then it is true.', 3.4);
      await level.say('Legolas', 'This is no mine. It is a tomb.', 2.6);
      audio.play('drums', { volume: 0.8 });
      player.camera.shake(0.18, 0.8);
      drumGap = 4.6;
      drumT = 4.6;
      level.cameraShot({ position: V(-1.2, 1.7, 2.6), lookAt: V(9.5, 2.4, 0), fov: 52, blend: 1.4 });
      await level.say('Legolas', 'Drums. Deep in the halls. They are coming.', 2.8);
      await level.say('Boromir', 'They have a cave troll.', 2.4);
      level.cameraShot(null);
      await level.wait(0.6);
      level.cinematic(false);
      level.music?.(null);
    }

    async function chamberBeat(): Promise<void> {
      beat = 'chamber';
      drumGap = 4.6;
      level.objective('Hold the Chamber of Mazarbul');
      void talk('Aragorn', 'Hold the arch! Legolas, the high ground is yours.', 2.8);
      ctx.hud.toast('Headshots do triple damage', 'info');

      // wave 1: a rush through the arch and three scuttlers on the south wall
      const w1 = [...archRush(6), ...climbers(3)];
      await level.waitUntil(allDead(w1), 80);

      // wave 2: more through the arch, goblins dropping out of the ceiling, three archers take the ledge
      level.objective('More are coming: hold the chamber');
      void talk('Gimli', 'Let them come! I have an axe for every one!', 2.4);
      const w2 = [...archRush(5), ...ceilingDrop(4), ...ledgeArchers(3)];
      await level.waitUntil(allDead(w2, 1), 90);
      // stragglers pour in behind them: there is no breather
      const w2b = [...archRush(3), ...climbers(2)];
      await level.waitUntil(allDead([...w2, ...w2b]), 60);

      // wave 3: the biggest rush, with scuttlers, two drops and a pair of heavies at the arch
      void talk('Boromir', 'They keep coming!', 1.8);
      const w3 = [
        ...archRush(7), ...climbers(3), ...ceilingDrop(3), ...ledgeArchers(2),
        ...[0, 1].map((i) => level.spawnEnemy({ archetype: 'orc', name: 'Moria orc', hp: 120, damage: 14 }, V(16 + i * 1.4, 0, -1.2 + i * 2.4))),
      ];
      await level.waitUntil(allDead(w3, 1), 100);
      // a last drop out of the dark as the room goes quiet
      const w3b = ceilingDrop(3);
      await level.waitUntil(allDead([...w3, ...w3b]), 40);

      drumGap = 3.2;
      level.checkpoint(1);
    }

    /** the walk out of the chamber, through the arch, into the great hall */
    async function leaveBeat(): Promise<void> {
      beat = 'leave';
      level.objective('Through the arch into the great hall');
      void talk('Aragorn', 'The drums are louder now. Into the hall!', 2.8);
      if (cast) {
        cast.aragorn.anchor = 'player';
        cast.boromir.anchor = 'player';
      }
      await level.waitUntil(() => player.position.x > 17.5, 120);
    }

    // ── beat 1: the Cave Troll ────────────────────────────────────────────
    let trollGoblins = 0;
    /** goblins that run in from the dark while the troll fights: ammunition for its throws */
    function trickle(): void {
      let cd = 6;
      level.onUpdate((dt) => {
        if (!fight || beat !== 'troll' || fight.mode !== 'fight' || trollGoblins >= 16) return;
        cd -= dt;
        if (cd > 0) return;
        const alive = level.enemiesAlive((c) => c !== fight!.enemy);
        if (alive >= 3) {
          cd = 2;
          return;
        }
        cd = 12;
        const base = fight.enemy.position;
        for (let i = 0; i < 3; i++) {
          const a = level.rng() * Math.PI * 2;
          let x = clamp(base.x + Math.cos(a) * 12, 22, HALL_X1 - 8);
          let z = clamp(base.z + Math.sin(a) * 12, -HALL_HZ + 4, HALL_HZ - 4);
          if (nearPillar(x, z, 1.4)) {
            x += 4;
            z += 4;
          }
          const g = goblin(V(x, 0, z));
          trollGoblins++;
          void g;
        }
        audio.play('goblin_screech', { pos: base, volume: 0.8 });
      });
    }

    async function trollBeat(): Promise<void> {
      beat = 'troll';
      // the drums go on through the fight (a restart at cp1 comes here with drumGap still 0)
      drumGap = 3.2;
      level.objective(null);
      const frozen = new Set<Enemy>();
      fight = createTrollFight(level, {
        spawn: V(L.trollSpawn.x, 0, L.trollSpawn.z),
        stage: V(44, 0, 1.5),
        onStun: (on) => {
          // while the troll is down the goblins stand back, out of the bot's and the aim assist's way
          if (on) {
            for (const c of ctx.combatants.byTeam('enemy')) {
              const e = c as Enemy;
              if (c === fight!.enemy || !c.alive) continue;
              e.aiEnabled = false;
              e.targetable = false;
              frozen.add(e);
            }
          } else {
            for (const e of frozen) {
              if (e.alive) {
                e.aiEnabled = true;
                e.targetable = true;
              }
            }
            frozen.clear();
          }
        },
        say: (s, t, secs) => talk(s, t, secs),
      });
      const troll = fight.enemy;
      const stageSpot = V(44, 0, 1.5);

      // handlers: two goblins hold the leash chains
      const handlers: Enemy[] = [
        goblin(V(L.trollSpawn.x + 3.0, 0, L.trollSpawn.z - 2.6), { name: 'Goblin handler' }),
        goblin(V(L.trollSpawn.x + 3.0, 0, L.trollSpawn.z + 2.6), { name: 'Goblin handler' }),
      ];
      for (const h of handlers) {
        h.aiEnabled = false;
        h.targetable = false;
      }
      fight.attachLeash(handlers[0], 'foot_r');
      fight.attachLeash(handlers[1], 'hand_l');
      troll.moveTarget = stageSpot;
      let walking = true;
      const stopFollow = level.onUpdate(() => {
        if (!walking) return;
        handlers[0].moveTarget = V(troll.position.x + 3.0, 0, troll.position.z - 2.6);
        handlers[1].moveTarget = V(troll.position.x + 3.0, 0, troll.position.z + 2.6);
      });

      if (quick) {
        // skipIntro: it is already in the hall
        troll.position.set(stageSpot.x, 0, stageSpot.z);
        handlers[0].position.set(stageSpot.x + 3, 0, stageSpot.z - 2.6);
        handlers[1].position.set(stageSpot.x + 3, 0, stageSpot.z + 2.6);
      } else {
        level.cinematic(true);
        audio.play('drums', { volume: 0.9 });
        level.cameraShot({ position: V(26.5, 1.9, 4.5), lookAt: V(52, 3.0, 1.5), fov: 46, blend: 0 });
        await level.wait(1.0);
        audio.play('troll_roar', { pos: troll.position, volume: 1, pitch: 0.85 });
        player.camera.shake(0.25, 1.2);
        level.cameraShot({ position: V(27.5, 1.5, -2.5), lookAt: V(46, 3.0, 1.5), fov: 40, blend: 7.5 });
        // the shell's rivalry line is still on screen: let it finish (a cp1 restart speaks it at 1.2 s)
        await level.wait(2.4);
        await level.say('Boromir', 'A cave troll.', 2.0);
        await level.say('Legolas', 'It is bound. Goblins have it on chains.', 2.6);
      }
      await level.waitUntil(() => troll.position.distanceTo(stageSpot) < 3.2 || ctx.time.t > 600, 25);
      walking = false;
      stopFollow();
      // the handlers let go and run for their lives
      fight.releaseLeashes();
      audio.play('chain_rattle', { pos: troll.position, volume: 1 });
      for (const h of handlers) {
        h.moveTarget = V(86, 0, h.position.z < troll.position.z ? -14 : 14);
      }
      troll.moveTarget = null;
      troll.playPose?.('roar', 1.8);
      audio.play('troll_roar', { pos: troll.position, volume: 1 });
      player.camera.shake(0.5, 1.2);
      if (!quick) {
        await level.say('Legolas', 'The chains are loose!', 1.8);
        level.cameraShot(null);
        await level.wait(0.6);
        level.cinematic(false);
      }
      level.boss(troll, 'Cave Troll');
      level.objective('Bring down the cave troll');
      ctx.hud.toast('Aim for its head, or lure it into a pillar', 'info');
      void talk('Gimli', 'Two of us, laddie. One of it!', 2.2);
      fight.begin();
      trickle();
      // the handlers vanish into the dark
      void level.wait(5).then(() => {
        for (const h of handlers) if (h.alive) level.removeCombatant(h);
      });
      await fight.done;

      level.objective(null);
      ctx.hud.setPrompt(null);
      await talk('Gimli', 'That counts as mine... well, half.', 2.6);
      void talk('Aragorn', 'There will be more. The Bridge! Run!', 2.4);
      level.checkpoint(2);
    }

    // ── beat 2: flight to the Bridge ──────────────────────────────────────
    /** the horde's clock (s): the Balrog cannot stir before it runs out */
    const RUN_SECONDS = 60;
    /** the player counts as "at the gate" east of this x; there the horde presses in from every side */
    const GATE_X = HALL_X1 - 10;
    /** seconds the player must hold the gate (the clock must also have run out) */
    const HOLD_SECONDS = 14;
    const _spot = new THREE.Vector3();
    /** a free floor point in a belt around the player, ahead, behind or on the flanks: valid anywhere in the hall, gate included */
    function beltSpot(out: THREE.Vector3): boolean {
      for (let tries = 0; tries < 16; tries++) {
        const a = level.rng() * Math.PI * 2;
        const r = 14 + level.rng() * 16;
        const x = player.position.x + Math.cos(a) * r;
        const z = player.position.z + Math.sin(a) * r;
        if (inHall(x, z, 4) && x < HALL_X1 - 3 && x > 20 && !nearPillar(x, z, 2)) {
          out.set(x, 0, z);
          return true;
        }
      }
      return false;
    }
    async function flightBeat(): Promise<void> {
      beat = 'flight';
      drumGap = 2.6;
      level.music?.('combat');
      level.objective('Run for the Bridge of Khazad-dum');
      // the horde gathers on both flanks of the hall; as the player passes, each pack surges in to the
      // edge of the aisle and holds there, a wall of torches and blades (instanced, so cheap)
      const north = level.crowd({ center: V(84, 0, -30), halfSize: [30, 2.5], count: 110, kind: 'goblin', facing: 0, speed: 0, props: true });
      const south = level.crowd({ center: V(84, 0, 30), halfSize: [30, 2.5], count: 110, kind: 'goblin', facing: Math.PI, speed: 0, props: true });
      let marchT = -1;
      runStart = ctx.time.t;
      let waveCd = 2;
      let spawned = 0;
      let surged = false;
      let gateT = 0;
      let atGate = false;
      const stopWaves = level.onUpdate((dt) => {
        if (beat !== 'flight') return;
        const t = ctx.time.t - runStart;
        // the packs close in once the player is past the first third of the hall
        if (marchT < 0 && player.position.x > 56) {
          marchT = 0;
          north.setSpeed(2.6);
          south.setSpeed(2.6);
          audio.play('goblin_screech', { pos: V(player.position.x + 20, 4, 0), volume: 0.9, pitch: 0.9 });
        }
        if (marchT >= 0 && marchT < 5) {
          marchT += dt;
          if (marchT >= 5) {
            north.setSpeed(0);
            south.setSpeed(0);
          }
        }
        if (player.position.x > GATE_X) {
          if (!atGate) {
            atGate = true;
            level.objective('Hold the gate!');
            void talk('Aragorn', 'Hold them here! Gandalf is coming!', 2.4);
          }
          gateT += dt;
        }
        const frac = clamp(1 - t / RUN_SECONDS, 0, 1);
        hud.setProgress(atGate ? 'Hold the gate' : 'The horde closes in', atGate ? clamp(1 - gateT / HOLD_SECONDS, 0, 1) * 0.5 + frac * 0.5 : frac);
        waveCd -= dt;
        if (waveCd > 0 || spawned > 160) return;
        const alive = level.enemiesAlive();
        const cap = atGate ? 28 : 10;
        if (alive >= cap) {
          waveCd = 1.2;
          return;
        }
        waveCd = atGate ? 3.0 : lerp(5.5, 3.5, clamp(t / RUN_SECONDS, 0, 1));
        const n = atGate ? 8 : 3 + Math.floor(clamp(t / 25, 0, 2));
        if (t > RUN_SECONDS && !surged) {
          surged = true;
          void talk('Aragorn', 'They are on us! To the gate!', 2.2);
        }
        for (let i = 0; i < n; i++) {
          if (!beltSpot(_spot)) continue;
          spawned++;
          const drop = level.rng() < (atGate ? 0.5 : 0.35);
          const roll = level.rng();
          let g: Enemy;
          if (atGate && roll < 0.2) {
            // archers on the flanks: pressure at range
            g = level.spawnEnemy({ archetype: 'orc_archer', behavior: 'hold', scale: 0.86, name: 'Goblin archer', target: 'player' }, V(_spot.x, 0, _spot.z));
          } else if (roll < (atGate ? 0.32 : 0.2)) {
            g = goblin(V(_spot.x, 0, _spot.z), { archetype: 'orc', name: 'Moria orc', hp: 100, damage: 12, speed: undefined });
          } else {
            g = goblin(V(_spot.x, 0, _spot.z));
          }
          if (drop && g.spec?.behavior !== 'hold') {
            g.position.y = 9 + level.rng() * 4;
            g.velocity.set(0, -1, 0);
            fx.dust(V(_spot.x, 8, _spot.z), 6, 0x4a4540);
          }
        }
        audio.play('goblin_screech', { pos: player.position, volume: 0.7, pitch: 1.1 });
      });
      // run until the Balrog stirs: the clock has run out and the player has held the gate for a while
      // (or, if the player dawdles, a generous limit)
      await level.waitUntil(
        () => (ctx.time.t - runStart >= RUN_SECONDS && gateT >= HOLD_SECONDS) || ctx.time.t - runStart > RUN_SECONDS + 120,
        600,
      );
      stopWaves();
      hud.setProgress(null);
      north.setSpeed(0);
      south.setSpeed(0);
      await balrogEvent(north, south);
    }

    /** the Balrog: only the glow, the roar and the fleeing goblins */
    async function balrogEvent(a: { thin(f: number): void }, b: { thin(f: number): void }): Promise<void> {
      beat = 'balrog';
      level.music?.('epic');
      level.objective(null);
      drumGap = 0;
      audio.play('troll_roar', { volume: 1, pitch: 0.38 });
      audio.play('explosion', { volume: 0.8, pitch: 0.4 });
      player.camera.shake(0.7, 3.0);
      ctx.fx.setWeather('embers', 0.5);
      // every goblin loses its nerve
      for (const c of ctx.combatants.byTeam('enemy')) {
        const e = c as Enemy;
        if (!c.alive) continue;
        e.aiEnabled = false;
        e.moveTarget = V(player.position.x - 50, 0, c.position.z);
        void level.wait(4.5).then(() => {
          if (c.alive) level.removeCombatant(c);
        });
      }
      a.thin(0.9);
      b.thin(0.9);
      // the glow swells over three seconds
      let g = 0;
      const stop = level.onUpdate((dt) => {
        g = Math.min(1, g + dt / 3);
        world.setBalrog(smoothstep(0, 1, g));
      });
      await level.say('Gimli', "Durin's Bane!", 2.0);
      void level.say('Legolas', 'A Balrog. A demon of the ancient world.', 3.0);
      await level.wait(2.0);
      level.objective('Run! To the Bridge!');
      void stop;
      await level.say('Aragorn', 'Go! Do not look back!', 2.2);
      await level.waitUntil(() => player.position.x > HALL_X1 + 1.5 || ctx.time.t > 2000, 90);
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.objective(null);
      level.cinematic(true);
      level.cameraShot({ position: V(HALL_X1 - 6, 2.2, 3.5), lookAt: V(HALL_X1 + 30, 1.0, 0), fov: 40, blend: 1.2 });
      player.camera.shake(0.5, 2.5);
      await level.wait(2.4);
      level.complete();
    }

    /**
     * The whole chapter as one script. `from` is the checkpoint we resume at.
     */
    async function run(from: number): Promise<void> {
      trace(`run from cp${from}`);
      if (from <= 0) {
        await intro();
        trace('chamber');
        await chamberBeat();
      }
      if (from <= 1) {
        if (from === 0) {
          trace('leave');
          await leaveBeat();
        }
        trace('troll');
        await trollBeat();
      }
      trace('flight');
      await flightBeat();
      trace('outro');
      await outro();
    }

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        if (c === 0) {
          player.teleport(V(L.spawn.x, 0, L.spawn.z), Math.PI / 2);
          spawnChamberCast();
        } else if (c === 1) {
          player.teleport(V(20, 0, 0), Math.PI / 2);
          spawnHallCast(V(20, 0, 0));
        } else {
          player.teleport(V(36, 0, 0), Math.PI / 2);
          spawnHallCast(V(36, 0, 0));
        }
        void run(c);
      },

      update(): void {},

      dispose(): void {
        world.dispose();
        fight?.dispose();
      },

      botHint() {
        switch (beat) {
          case 'chamber':
            return { moveTo: L.hold };
          case 'leave':
            return { moveTo: V(19, 0, 0) };
          case 'troll': {
            if (!fight) return null;
            if (fight.mode === 'stunned') {
              const base = fight.chainBase(_bot);
              if (!base) return null;
              const near = Math.hypot(player.position.x - base.x, player.position.z - base.z) < 3.4;
              return { moveTo: base, interact: near };
            }
            if (fight.mode === 'skull') return { interact: true };
            return null;
          }
          case 'flight':
          case 'balrog': {
            // the next waypoint down the aisle
            let target = beat === 'balrog' ? L.beyondGate : L.exit;
            if (beat === 'flight') {
              for (const w of L.run) {
                if (w.x > player.position.x + 6) {
                  target = w;
                  break;
                }
              }
            }
            return { moveTo: target };
          }
          default:
            return null;
        }
      },
    };
  },
};

const _bot = new THREE.Vector3();
