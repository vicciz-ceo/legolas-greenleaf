/**
 * Chapter 8: Pelennor Fields (The Return of the King).
 *
 * Morning on the Pelennor. The White City burns on its hill, the Rohirrim have ridden in, and the
 * host of Harad marches with its mûmakil.
 *
 *   cp0 The Field       fight Haradrim and orcs among the Rohirrim; a mûmak tramples through (its
 *                       footfalls are telegraphed by rings on the ground and shake the camera)
 *   cp1 The Mûmak       the oliphaunt climb: shoot two girth straps to slow it, leap onto the rope
 *                       ladder and climb its flank as it walks, knife the howdah crew, cut the
 *                       howdah ropes (it slides off), run up the neck, three arrows into the skull,
 *                       a slow earth-shaking collapse, the slide down the trunk. "That still only
 *                       counts as one!"
 *   cp2 The Last Charge a second mûmak and Haradrim reinforcements: bring it down from range (four
 *                       girths, then the head), then the Rohirrim sweep the field.
 *
 * Helpers: pelennor/layout.ts (coordinates), world.ts (the level), mumak_actor.ts (the beast, its
 * weak points, decals and the far herd), crew.ts (the howdah crew), movers.ts (the climb).
 * The creature itself: src/creatures/mumak.ts (+ mumak.lab.ts).
 */
import * as THREE from 'three';
import type { Ally, ChapterDef, ChapterInstance, Combatant, Enemy, LevelAPI } from '../../core/types';
import { clamp } from '../../core/math';
import { ENVIRONMENTS } from '../../core/environment';
import { premeshMumak, GIRTHS, HOWDAH_SEAT } from '../../creatures/mumak';
import { L, V, HERD, charge2Entry, charge2Loop, loopPath, tramplePath } from './pelennor/layout';
import { buildPelennor } from './pelennor/world';
import { BossProxy, FarMumak, MumakActor, WeakPoint } from './pelennor/mumak_actor';
import { CrewMember } from './pelennor/crew';
import { climbMover, deckMover, neckStandMover, pathMover, trunkSlideMover, type DeckState } from './pelennor/movers';

const CHECKPOINTS = ['The Field', 'The Mûmak', 'The Last Charge'];
const EAST = Math.PI / 2;

export const chapter: ChapterDef = {
  id: 'pelennor',
  number: 8,
  title: 'Pelennor Fields',
  film: 'The Return of the King',
  blurb: 'Morning before the White City. The host of Harad marches with its mûmakil: climb one, bring it down, and see the field won.',
  environment: 'pelennor',
  checkpoints: CHECKPOINTS,
  parTime: 480,
  rivalry: true,
  preload: ['gimli', 'aragorn', 'rohirrim', 'haradrim', 'orc'],

  async create(level: LevelAPI): Promise<ChapterInstance> {
    const { ctx } = level;
    const player = ctx.player;
    const quick = ctx.flags.skipIntro === '1';

    // the beasts are meshed in the kit worker pool while the loading screen is up
    await Promise.all([premeshMumak('hero'), premeshMumak('far')]);
    // the preset, with the battlefield haze thinned a little so the hosts and the herd read at range
    level.setEnvironment({ ...ENVIRONMENTS.pelennor, fog: { color: 0xc8a68c, density: 0.0027 } });
    const world = buildPelennor(level);
    const ground = world.ground;
    const herd = HERD.map((h, i) => new FarMumak(level, loopPath(h.cx, h.cz, h.rx, h.rz), h.speed, h.phase, 11 + i, ground));
    level.onUpdate((dt) => {
      for (const f of herd) f.update(dt);
    });
    const trample = tramplePath();
    const loop1 = loopPath();
    const entry2 = charge2Entry();
    const loop2 = charge2Loop();

    // ── script state, read by botHint() ──
    type Beat = 'intro' | 'fight' | 'girths' | 'rope' | 'climb' | 'deck' | 'ropes' | 'neck' | 'skull' | 'fall' | 'charge' | 'outro';
    let beat: Beat = 'intro';
    let m1: MumakActor | null = null;
    let m2: MumakActor | null = null;
    let gimli: Ally | null = null;
    let aragorn: Ally | null = null;
    const riders: Ally[] = [];
    const deck: DeckState = { local: new THREE.Vector3() };
    const ropeCut = [false, false];
    const hint = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    const G = (p: THREE.Vector3) => V(p.x, ground(p.x, p.z), p.z);
    const infantry = (c: Combatant) => !(c instanceof WeakPoint) && !(c instanceof CrewMember);

    function spawnAllies(at: THREE.Vector3): void {
      gimli = level.spawnAlly({ kind: 'gimli', rivalry: true, anchor: 'player' }, G(V(at.x - 2.5, 0, at.z + 2)), EAST);
      aragorn = level.spawnAlly({ kind: 'aragorn', name: 'Aragorn', anchor: 'player' }, G(V(at.x - 2, 0, at.z - 2.5)), EAST);
      ctx.rivalry.autoGimli = true;
      for (const p of L.riders) riders.push(level.spawnAlly({ kind: 'rohirrim', name: 'Rider of Rohan', anchor: p.clone() }, G(p), EAST));
    }
    function alliesHold(p: THREE.Vector3 | 'player'): void {
      if (gimli) gimli.anchor = p === 'player' ? 'player' : p.clone();
      if (aragorn) aragorn.anchor = p === 'player' ? 'player' : V(p.x + 3, 0, p.z - 2);
    }
    function makeMumak(seed: number, crew: boolean): MumakActor {
      const m = new MumakActor({ level, name: 'Mûmak', seed, ground, crew });
      return m;
    }
    /** infantry nearby scatter from the beast (keeps the climb about the climb) */
    function scatterInfantry(): void {
      for (const c of ctx.combatants.byTeam('enemy')) {
        if (!c.alive || !infantry(c)) continue;
        const e = c as Enemy;
        if (!('aiEnabled' in e)) continue;
        e.aiEnabled = false;
        e.moveTarget = V(c.position.x + 60, 0, c.position.z + (c.position.z > 0 ? 40 : -40));
        level.wait(6).then(() => {
          if (c.alive) level.removeCombatant(c);
        });
      }
    }
    /** show an interact prompt while the player is within r of p; resolves on interact */
    async function interactAt(where: () => THREE.Vector3, r: number, label: string, touch: string, timeout: number): Promise<boolean> {
      let hit = false;
      const stop = level.onUpdate(() => {
        const near = player.position.distanceTo(where()) < r;
        ctx.hud.setPrompt(near ? 'interact' : null, label);
        ctx.input.setInteractLabel(near ? touch : null);
        if (near && ctx.input.state.interact) hit = true;
      });
      await level.waitUntil(() => hit, timeout);
      stop();
      ctx.hud.setPrompt(null);
      ctx.input.setInteractLabel(null);
      return hit;
    }

    // ── beats ───────────────────────────────────────────────────────────

    async function intro(): Promise<void> {
      beat = 'intro';
      if (quick) return;
      level.cinematic(true);
      // the herd lumbering toward the field behind the host of Harad
      const beast = herd[0].model.object.position;
      level.cameraShot({ position: V(-30, 2.2, 26), lookAt: V(beast.x, 14, beast.z), fov: 34, blend: 0 });
      await level.wait(0.3);
      level.cameraShot({ position: V(-22, 1.9, 18), lookAt: V(beast.x, 16, beast.z), fov: 28, blend: 5.5 });
      await level.say('Legolas', 'Mûmakil. A whole herd of them.', 2.8);
      level.cameraShot({ position: V(-1.5, 1.7, 3.5), lookAt: V(-8, 1.3, 2), fov: 40, blend: 2.4 });
      await level.say('Gimli', "Don't think the count stops for the big ones, Master Elf.", 3.0);
      await level.say('Aragorn', 'Hold together! And keep clear of their feet!', 2.6);
      level.cameraShot(null);
      await level.wait(0.6);
      level.cinematic(false);
    }

    async function theField(): Promise<void> {
      beat = 'fight';
      level.objective('Fight alongside the Rohirrim');
      await level.wave({
        groups: [
          { spec: { archetype: 'haradrim' }, count: 5, at: L.waveE, spread: 4 },
          { spec: { archetype: 'orc' }, count: 3, at: L.waveNE, spread: 4 },
        ],
        stagger: 2.5,
        until: 2,
        timeout: 70,
      });
      // the trample: a mûmak comes through the fight from the south-east
      const m = m1!;
      m.halted = false;
      m.cruise = 4.2;
      ctx.hud.toast('A mûmak! Keep clear of its feet!', 'warning');
      level.objective('A mûmak tramples the field: stay out of its path!');
      void level.say('Aragorn', 'Mûmak! Clear the way!', 2.4);
      await level.wave({
        groups: [
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 3, at: L.waveSE, spread: 3 },
          { spec: { archetype: 'haradrim' }, count: 5, at: L.waveE, spread: 4 },
        ],
        stagger: 3,
        until: 2,
        timeout: 80,
      });
      level.objective('Drive back the Haradrim');
      await level.wave({
        groups: [
          { spec: { archetype: 'haradrim' }, count: 4, at: L.waveNE, spread: 4 },
          { spec: { archetype: 'orc_archer', behavior: 'hold' }, count: 2, at: L.waveE, spread: 3 },
          { spec: { archetype: 'orc' }, count: 4, at: L.waveSE, spread: 4 },
        ],
        stagger: 2.5,
        until: 2,
        timeout: 80,
      });
      await level.wave({
        groups: [
          { spec: { archetype: 'haradrim' }, count: 6, at: L.waveE, spread: 5 },
          { spec: { archetype: 'orc' }, count: 3, at: L.waveSE, spread: 4 },
        ],
        stagger: 2.5,
        timeout: 90,
      });
      await level.waitUntil(() => level.enemiesAlive(infantry) === 0, 25);
      // by now the beast has gone round onto its loop
      m.cruise = 2.6;
    }

    async function theMumak(): Promise<void> {
      const m = m1!;
      const h = m.model.howdah!;
      const ladder = m.model.ladder!;
      // ── 1. two girths on its left flank ──
      beat = 'girths';
      m.halted = false;
      m.aggressive = true;
      m.crewAlert = true;
      const proxy = new BossProxy('Mûmak', 5);
      level.boss(proxy, 'Mûmak');
      const left = [0, 2];
      for (const i of left) m.girths[i].armed = true;
      const girthText = () => `Shoot the girth straps on its left flank (${m.girthsCut()}/2)`;
      level.objective(girthText());
      m.onGirthCut = () => {
        proxy.hp = Math.max(0, 5 - m.girthsCut());
        if (beat === 'girths') level.objective(girthText());
      };
      ctx.hud.setPrompt('draw', 'Shoot the girth buckles to slow it');
      void level.say('Aragorn', 'Legolas! Bring that beast down!', 2.6);
      void level.wave({ groups: [{ spec: { archetype: 'haradrim' }, count: 4, at: L.waveE, spread: 4 }], timeout: 60 });
      level.wait(5).then(() => {
        if (beat === 'girths') ctx.hud.setPrompt(null);
      });
      await level.waitUntil(() => m.girthsCut() >= 2, 150);
      for (const i of left) if (m.girths[i].alive) m.girths[i].kill(player);
      ctx.hud.setPrompt(null);
      m.speedMul = 0.5;
      m.attackCdReset(6);
      m.startAction('trumpet');
      ctx.hud.toast('The mûmak falters!', 'info');

      // ── 2. the rope ladder ──
      beat = 'rope';
      m.aggressive = false; // it staggers on, too hurt to turn on you
      level.objective('Leap onto the rope ladder on its flank');
      void level.say('Gimli', "You're not going up there? Of course you are.", 2.6);
      const ladderFoot = () => ladder.pointAt(0.8, tmp);
      await interactAt(ladderFoot, 2.7, 'Climb the rope ladder', 'Climb', 140);

      // ── 3. the climb ──
      beat = 'climb';
      scatterInfantry();
      alliesHold(L.fight);
      m.mounted = true;
      for (const c of m.crew) c.targetable = true;
      let top = false;
      const climb = climbMover(m, () => (top = true));
      player.mover = climb;
      ctx.audio.play('chain_rattle', { pos: player.position, volume: 0.6, pitch: 0.6 });
      level.objective('Climb! Move left and right to dodge the arrows');
      await level.waitUntil(() => top, 45);
      // ── 4. the howdah crew ──
      beat = 'deck';
      deck.local.set(h.ladderTop.x - 0.5, h.deckY, h.ladderTop.z);
      player.mover = deckMover(m, deck);
      m.onDeck = true;
      const crewN = m.crew.length;
      const crewText = () => `Kill the howdah crew (${crewN - m.crewAlive()}/${crewN})`;
      level.objective(crewText());
      ctx.hud.setPrompt('melee', 'Knives');
      level.wait(4).then(() => {
        if (beat === 'deck') ctx.hud.setPrompt(null);
      });
      const stopCrew = level.onUpdate(() => {
        if (beat === 'deck') level.objective(crewText());
      });
      await level.waitUntil(() => m.crewAlive() === 0, 110);
      stopCrew();
      for (const c of m.crew) if (c.alive) c.kill(player);
      ctx.hud.setPrompt(null);

      // ── 5. cut the howdah ropes ──
      beat = 'ropes';
      level.objective('Cut the howdah ropes (0/2)');
      void level.say('Legolas', 'Now the tower.', 1.8);
      for (let k = 0; k < 2; k++) {
        const i = ropeCut[0] ? 1 : ropeCut[1] ? 0 : nearestRope(h);
        const spot = () => tmp.copy(h.ropeSpots[i]).applyMatrix4(h.object.matrixWorld);
        await interactAt(spot, 1.5, 'Cut the howdah rope', 'Cut', 45);
        ropeCut[i] = true;
        h.ropes[i].visible = false;
        ctx.audio.play('knife_slash', { pos: player.position, volume: 1 });
        ctx.audio.play('web_tear', { pos: player.position, volume: 1.1, pitch: 0.7 });
        tmp.copy(player.position).setY(player.position.y + 0.8);
        ctx.fx.sparks(tmp, V(0, 1, 0), 6);
        ctx.fx.dust(tmp, 4, 0x8a7a60);
        level.objective(`Cut the howdah ropes (${ropeCut.filter(Boolean).length}/2)`);
      }

      // ── 6. the howdah slides off, run up the neck ──
      beat = 'neck';
      m.onDeck = false;
      const b = m.model.bones;
      const spine = b.spine;
      spine.updateWorldMatrix(true, false);
      const startLocal = spine.worldToLocal(player.position.clone());
      const sp = (mx: number, my: number, mz: number, bone: THREE.Object3D, head: [number, number, number]) => ({ bone, off: V(mx - head[0], my - head[1], mz - head[2]) });
      const gateY = HOWDAH_SEAT[1] + h.deckY;
      let atNeck = false;
      player.mover = pathMover(
        [
          { bone: spine, off: startLocal },
          sp(0, gateY, HOWDAH_SEAT[2] + h.frontGate.z - 0.6, spine, [0, 13.4, -2.4]),
          sp(0, 14.5, 4.4, b.chest, [0, 13.2, 2.8]),
          sp(0, 14.1, 6.4, b.neck, [0, 12.2, 6.4]),
        ],
        4.2,
        () => (atNeck = true),
      );
      ctx.time.setScale(0.45, 0.2);
      await level.wait(0.3);
      m.dropHowdah(player);
      m.startAction('trumpet');
      await level.waitUntil(() => atNeck, 8);
      ctx.time.setScale(1, 0.5);

      // ── 7. three arrows into the skull ──
      beat = 'skull';
      player.mover = neckStandMover(m, { bone: b.neck, off: V(0, 1.9, 0) });
      m.skull.armed = true;
      m.startAction('thrash');
      const skullText = () => `Shoot it in the skull (${3 - m.skull.hp}/3)`;
      level.objective(skullText());
      ctx.hud.setPrompt('draw', 'Shoot down into its skull');
      m.skull.onHit = () => {
        proxy.hp = Math.max(0, m.skull.hp);
        level.objective(skullText());
      };
      await level.waitUntil(() => !m.skull.alive, 70);
      if (m.skull.alive) m.skull.kill(player);
      ctx.hud.setPrompt(null);
      level.objective(null);
      ctx.rivalry.addLegolas(1);
      proxy.kill(null);

      // ── 8. the collapse and the slide down the trunk ──
      beat = 'fall';
      ctx.time.setScale(0.3, 0.1);
      await level.wait(0.35);
      ctx.time.setScale(1, 0.5);
      level.cinematic(true);
      m.collapseTo(0.5, 3.0);
      ctx.audio.play('oliphaunt_trumpet', { pos: m.model.skullAnchor.getWorldPosition(tmp), volume: 1.4, pitch: 0.8 });
      const side = V(26, 5, 10);
      level.cameraShot({ position: side.applyMatrix4(m.object.matrixWorld), lookAt: m.model.skullAnchor.getWorldPosition(V(0, 0, 0)).setY(8), fov: 44, blend: 0.6 });
      await level.wait(3.2);
      let slid = false;
      player.mover = trunkSlideMover(m, ground, () => (slid = true));
      ctx.audio.play('shield_slide', { pos: player.position, volume: 0.8, pitch: 0.8 });
      const front = V(14, 2.2, 32).applyMatrix4(m.object.matrixWorld);
      level.cameraShot({ position: front, lookAt: m.model.bones.trunk4.getWorldPosition(V(0, 0, 0)), fov: 46, blend: 0.8 });
      await level.waitUntil(() => slid, 8);
      player.mover = null;
      player.teleport(G(player.position), player.facing);
      m.mounted = false;
      m.collapseTo(1, 2.6);
      // Legolas lands in front as the beast rolls over behind him
      m.model.skullAnchor.getWorldPosition(tmp);
      tmp.sub(player.position).setY(0).normalize();
      level.cameraShot({
        position: V(player.position.x - tmp.x * 7 + tmp.z * 2.5, player.position.y + 1.5, player.position.z - tmp.z * 7 - tmp.x * 2.5),
        lookAt: V(player.position.x + tmp.x * 6, player.position.y + 4.5, player.position.z + tmp.z * 6),
        fov: 52,
        blend: 0.5,
      });
      await level.wait(2.9);
      level.cameraShot(null);
      await level.wait(0.5);
      level.cinematic(false);
      alliesHold('player');
      gimli?.gesture('roar');
      await level.say('Gimli', 'That still only counts as one!', 2.8);
    }

    function nearestRope(h: NonNullable<MumakActor['model']['howdah']>): number {
      return Math.abs(deck.local.x - h.ropeSpots[0].x) <= Math.abs(deck.local.x - h.ropeSpots[1].x) ? 0 : 1;
    }

    async function theLastCharge(): Promise<void> {
      beat = 'charge';
      const m = (m2 = makeMumak(2, true));
      m.setRoute([{ path: entry2, loop: false }, { path: loop2, loop: true }], 0);
      m.cruise = 3.0;
      m.crewAlert = true;
      m.register();
      for (const g of m.girths) g.armed = true;
      for (const c of m.crew) c.targetable = true;
      const proxy = new BossProxy('Mûmak', 7);
      level.boss(proxy, 'Mûmak');
      const text = () => `A second mûmak! Cut its girths (${m.girthsCut()}/4)`;
      level.objective(text());
      m.onGirthCut = () => {
        proxy.hp = 7 - m.girthsCut();
        level.objective(text());
        m.speedMul = 1 - m.girthsCut() * 0.1;
      };
      void level.say('Aragorn', 'Another one! And Harad comes behind it!', 2.8);
      // Haradrim reinforcements keep coming while the beast stands
      let reinforcing = true;
      void (async () => {
        const waves = [
          { groups: [{ spec: { archetype: 'haradrim' as const }, count: 5, at: L.waveE, spread: 5 }, { spec: { archetype: 'orc_archer' as const, behavior: 'hold' as const }, count: 2, at: L.waveSE, spread: 3 }], stagger: 2, timeout: 60, until: 2 },
          { groups: [{ spec: { archetype: 'haradrim' as const }, count: 6, at: L.waveSE, spread: 5 }, { spec: { archetype: 'orc' as const }, count: 3, at: L.waveNE, spread: 4 }], stagger: 2, timeout: 60, until: 2 },
        ];
        // a handful of companies, not an endless stream: the beast is the fight
        for (let k = 0; k < 5 && reinforcing; ) {
          if (level.enemiesAlive(infantry) < (m.skull.armed ? 3 : 5)) {
            await level.wave(waves[k++ % waves.length]);
            await level.wait(8);
          } else await level.wait(3);
        }
      })();
      await level.waitUntil(() => m.girthsCut() >= 4, 200);
      for (const g of m.girths) if (g.alive) g.kill(player);
      // the howdah comes down with its crew
      m.dropHowdah(player);
      for (const c of m.crew) if (c.role === 'driver' && c.alive) c.kill(player);
      m.startAction('trumpet');
      ctx.hud.toast('Its howdah comes crashing down!', 'info');
      m.skull.armed = true;
      const headText = () => `Shoot the mûmak in the head (${3 - m.skull.hp}/3)`;
      level.objective(headText());
      m.skull.onHit = () => {
        proxy.hp = Math.max(0, m.skull.hp);
        level.objective(headText());
      };
      await level.waitUntil(() => !m.skull.alive, 120);
      if (m.skull.alive) m.skull.kill(player);
      ctx.rivalry.addLegolas(1);
      proxy.kill(null);
      level.objective(null);
      ctx.time.setScale(0.3, 0.1);
      await level.wait(0.4);
      ctx.time.setScale(1, 0.5);
      m.collapseTo(0.5, 2.2);
      await level.wait(2.4);
      m.collapseTo(1, 2.4);
      void level.say('Legolas', 'And that one counts as one too.', 2.4);
      await level.wait(2.6);
      reinforcing = false;
    }

    async function outro(): Promise<void> {
      beat = 'outro';
      level.objective(null);
      // the field is won: the Rohirrim sweep east, the hosts of Mordor and Harad break
      const cr = world.crowds;
      cr.rohirrim.setSpeed(9);
      cr.gondor.setSpeed(2.5);
      ctx.audio.play('horn_rohan', { volume: 1 });
      cr.orcs.thin(0.5);
      cr.harad.thin(0.55);
      cr.orcsNorth.thin(0.5);
      for (const c of ctx.combatants.byTeam('enemy')) {
        if (!c.alive || !infantry(c)) continue;
        const e = c as Enemy;
        if ('aiEnabled' in e) {
          e.aiEnabled = false;
          e.moveTarget = V(c.position.x + 80, 0, c.position.z);
          level.wait(5 + level.rng() * 3).then(() => {
            if (c.alive) level.removeCombatant(c);
          });
        }
      }
      level.music?.('epic');
      if (!quick) {
        level.cinematic(true);
        level.cameraShot({ position: V(-20, 6, -60), lookAt: V(60, 4, -150), fov: 50, blend: 0 });
        await level.wait(0.3);
        level.cameraShot({ position: V(10, 4, -70), lookAt: V(120, 4, -140), fov: 46, blend: 4 });
      }
      await level.wait(1.5);
      cr.orcs.thin(0.6);
      cr.harad.thin(0.6);
      await level.say('Aragorn', 'The field is won.', 2.2);
      const g = ctx.rivalry.gimli;
      const l = ctx.rivalry.legolas;
      await level.say('Gimli', `${g}! Beat that, laddie.`, 2.4);
      await level.say('Legolas', `${l}. And two of them were mûmakil.`, 2.6);
      if (!quick) {
        level.cameraShot(null);
        await level.wait(0.4);
        level.cinematic(false);
      }
      level.complete();
    }

    async function run(from: number): Promise<void> {
      if (from <= 0) {
        await intro();
        await theField();
        level.checkpoint(1);
      }
      if (from <= 1) {
        await theMumak();
        level.checkpoint(2);
      }
      await theLastCharge();
      await outro();
    }

    return {
      start(cp: number): void {
        const c = clamp(cp, 0, 2);
        const at = [L.spawn, L.cp1, L.cp2][c];
        player.teleport(G(at), EAST);
        spawnAllies(at);
        if (c === 0) {
          m1 = makeMumak(1, true);
          m1.setRoute([{ path: trample, loop: false }, { path: loop1, loop: true }], 40);
          m1.halted = true;
          m1.register();
        } else if (c === 1) {
          m1 = makeMumak(1, true);
          // join the loop ~60 m from the player, coming toward him
          m1.setRoute([{ path: loop1, loop: true }], loop1.length * 0.12);
          m1.register();
        } else {
          // the first mûmak lies where it fell, its howdah smashed beside it
          m1 = makeMumak(1, false);
          m1.setRoute([{ path: loop1, loop: true }], 0);
          m1.object.position.copy(G(L.deadMumak));
          m1.yaw = L.deadYaw;
          m1.object.rotation.y = L.deadYaw;
          m1.register();
          m1.setCollapsed(1);
          m1.placeHowdahWreck();
        }
        void run(c);
      },
      update(): void {},
      botHint() {
        const m = m1;
        switch (beat) {
          case 'fight':
            return { moveTo: L.fight };
          case 'girths': {
            if (!m) return null;
            hint.set(24, 0, -1.2).applyMatrix4(m.object.matrixWorld);
            return { moveTo: hint };
          }
          case 'rope': {
            if (!m?.model.ladder) return null;
            m.model.ladder.pointAt(0.8, hint);
            const near = player.position.distanceTo(hint) < 2.4;
            tmp.set(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
            hint.addScaledVector(tmp, 0.8);
            hint.y = ground(hint.x, hint.z);
            return { moveTo: hint, interact: near };
          }
          case 'deck': {
            if (!m) return null;
            let best: CrewMember | null = null;
            let bd = Infinity;
            for (const c of m.crew) {
              if (!c.alive) continue;
              const d = c.object.position.distanceTo(player.position);
              if (d < bd) {
                bd = d;
                best = c;
              }
            }
            return best ? { moveTo: hint.copy(best.object.position) } : null;
          }
          case 'ropes': {
            const h = m?.model.howdah;
            if (!h) return null;
            const i = ropeCut[0] ? 1 : ropeCut[1] ? 0 : nearestRope(h);
            hint.copy(h.ropeSpots[i]).applyMatrix4(h.object.matrixWorld);
            return { moveTo: hint, interact: player.position.distanceTo(hint) < 1.3 };
          }
          case 'charge': {
            const n = m2;
            if (!n) return { moveTo: L.fight };
            const left = GIRTHS.findIndex((g, i) => g.side > 0 && n.girths[i].alive) >= 0;
            const right = GIRTHS.findIndex((g, i) => g.side < 0 && n.girths[i].alive) >= 0;
            const sx = left ? 24 : right ? -24 : 20;
            hint.set(sx, 0, left || right ? -1 : 12).applyMatrix4(n.object.matrixWorld);
            hint.y = ground(hint.x, hint.z);
            return { moveTo: hint };
          }
          default:
            return null;
        }
      },
    };
  },
};
