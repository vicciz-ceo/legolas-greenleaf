/**
 * The end of the Black Gate: the Eagles arrive and bring down the Nazgul, Sauron falls (a flash on
 * the horizon, the ground shakes, Barad-dur collapses as a silhouette, the towers of the Gate crack),
 * the hosts break and flee, the sky clears, and Gimli and Legolas settle the count.
 */
import * as THREE from 'three';
import type { Ally, Combatant, Enemy, LevelAPI } from '../../../core/types';
import { clamp, smoothstep } from '../../../core/math';
import { numberWord } from '../../rivalry';
import { FellBeast } from '../../../creatures/fellbeast';
import type { Sky, BeastCtl, EagleCtl } from './air';
import type { BlackGateWorld } from './world';
import { PEACE, WAR, lerpEnv } from './env';
import { FIGHT, V } from './layout';

export interface FinaleCtx {
  level: LevelAPI;
  world: BlackGateWorld;
  sky: Sky;
  quick: boolean;
  gimli: () => Ally | null;
  aragorn: () => Ally | null;
  /** keep the beat name in sync for botHint */
  setBeat: (b: string) => void;
}

const isInfantry = (c: Combatant): boolean => c.team === 'enemy' && !(c instanceof FellBeast);

/** every foe on the field stops and stares (the Eagles, the Nazgul falling) */
function freezeFoes(level: LevelAPI): void {
  for (const c of level.ctx.combatants.byTeam('enemy')) {
    if (!c.alive || !isInfantry(c)) continue;
    const e = c as Enemy;
    if (!('aiEnabled' in e)) continue;
    e.aiEnabled = false;
    e.moveTarget = null;
  }
}

/** the foes break and run from the hill, and are gone a few seconds later */
function foesFlee(level: LevelAPI, from: THREE.Vector3): void {
  for (const c of [...level.ctx.combatants.byTeam('enemy')]) {
    if (!c.alive || !isInfantry(c)) continue;
    const e = c as Enemy;
    if (!('aiEnabled' in e)) continue;
    e.aiEnabled = false;
    const away = new THREE.Vector3(c.position.x - from.x, 0, c.position.z - from.z);
    if (away.lengthSq() < 1) away.set(0, 0, -1);
    away.normalize();
    // north, toward the Gate, whichever side they stand on
    away.z = -Math.abs(away.z) - 0.4;
    away.normalize();
    e.moveTarget = new THREE.Vector3(c.position.x + away.x * 160, 0, c.position.z + away.z * 160);
    const delay = 4 + level.rng() * 5;
    void level.wait(delay).then(() => {
      if (c.alive) {
        level.ctx.fx.dust(c.position, 6, 0x5a4a3c);
        level.removeCombatant(c);
      }
    });
  }
}

/** ground shake for `seconds` (a rolling quake; strength 0..1) */
function quake(level: LevelAPI, seconds: number, strength: number): () => void {
  let t = 0;
  let acc = 0;
  const off = level.onUpdate((dt) => {
    t += dt;
    acc += dt;
    if (acc >= 0.35) {
      acc = 0;
      const k = 1 - smoothstep(seconds * 0.6, seconds, t);
      level.ctx.player.camera.shake(strength * (0.5 + 0.5 * Math.abs(Math.sin(t * 2.3))) * k, 0.5);
    }
    if (t >= seconds) off();
  });
  return off;
}

/** per-frame camera that keeps a fixed eye point and tracks a moving target */
function trackShot(level: LevelAPI, eye: () => THREE.Vector3, target: () => THREE.Vector3, fov: number): () => void {
  const e = new THREE.Vector3();
  const l = new THREE.Vector3();
  let first = true;
  const off = level.onUpdate(() => {
    e.copy(eye());
    l.copy(target());
    level.cameraShot({ position: e, lookAt: l, fov, blend: first ? 1.2 : 0 });
    first = false;
  });
  return off;
}

// ─────────────────────────────────────────────────────────────────────────────
// the Eagles
// ─────────────────────────────────────────────────────────────────────────────

/** leader's path: in from the west, over the hills, on past the Gate */
const LEAD: [number, number, number][] = [
  [-460, 120, 300], [-270, 88, 250], [-110, 62, 214], [10, 46, 168], [60, 62, 70], [34, 110, -120], [0, 160, -420],
];
const OFFS: [number, number, number, number][] = [
  // dx, dy, dz, delay
  [0, 0, 0, 0], [-18, -5, 14, 0.8], [20, -4, 16, 1.1], [-38, -10, 30, 1.9], [40, -8, 32, 2.2],
];

export async function eaglesArrive(f: FinaleCtx): Promise<EagleCtl[]> {
  const { level, sky } = f;
  const { player, audio } = level.ctx;
  f.setBeat('eagles');
  freezeFoes(level);
  level.music?.('epic');
  level.objective(null);
  level.cinematic(true);
  const eye = new THREE.Vector3(player.position.x + 6, player.position.y + 9, player.position.z + 8);
  // the sky to the west: the first speck
  level.cameraShot({ position: eye, lookAt: V(-260, 80, 250), fov: 50, blend: 1.2 });
  await level.say('Gandalf', 'The Eagles are coming!', 2.6);
  audio.play('horn_rohan', { volume: 0.9, pitch: 0.8 });

  const eagles: EagleCtl[] = OFFS.map(([dx, dy, dz, delay], i) => {
    const pts = LEAD.map(([x, y, z], k) => V(x + dx * (k === 0 ? 1.6 : 1), y + dy, z + dz * (k === 0 ? 1.6 : 1)));
    return sky.addEagle(pts, { seed: i === 0 ? 1 : i, scale: i === 0 ? 1.5 : 1.1 + 0.08 * (i % 3), speed: 38 - i * 0.5, delay });
  });
  const lead = eagles[0].eagle.object.position;
  // follow the leader as it comes in, low over the hill
  const stopTrack = trackShot(level, () => eye, () => lead, 46);
  await level.wait(f.quick ? 1.5 : 5.5);
  void level.say('Legolas', 'The Great Eagles! Look, Gimli!', 2.4);
  audio.play('uruk_roar', { volume: 0.5, pitch: 0.55 });
  await level.wait(f.quick ? 1 : 3.5);
  stopTrack();
  return eagles;
}

/** the eagles stoop on the Fell Beasts: two fall, the rest scatter north */
export async function eaglesStrike(f: FinaleCtx, eagles: EagleCtl[], beasts: BeastCtl[]): Promise<void> {
  const { level, sky } = f;
  const { audio } = level.ctx;
  const north = V(0, 150, -420);
  const live = beasts.filter((b) => b.beast.alive);
  const pairs: [number, number][] = [[1, 0], [2, 1], [3, 2]];
  let shown = false;
  for (const [ei, bi] of pairs) {
    const e = eagles[ei];
    const b = live[bi];
    if (!e || !b || e.done) continue;
    sky.strike(e, b, north);
    if (!shown) {
      shown = true;
      // watch the first stoop from the hill: the beast and the eagle in one frame
      const eye = V(level.ctx.player.position.x, level.ctx.player.position.y + 2, level.ctx.player.position.z);
      const mid = new THREE.Vector3();
      const stop = trackShot(level, () => eye, () => mid.copy(b.beast.object.position).lerp(e.eagle.object.position, 0.4), 44);
      await level.waitUntil(() => !b.beast.alive, 12);
      audio.play('explosion', { pos: b.beast.object.position, volume: 0.8, pitch: 0.7 });
      void level.say('Aragorn', 'The Nazgul are falling!', 2.2);
      await level.wait(f.quick ? 0.8 : 3.2);
      stop();
    }
    await level.wait(0.9);
  }
  // the survivors flee for Mordor
  for (const b of live) if (b.beast.alive) sky.leave(b, V(-60 + level.rng() * 120, 140, -500));
  await level.wait(f.quick ? 0.5 : 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// the fall of Sauron
// ─────────────────────────────────────────────────────────────────────────────

export async function sauronFalls(f: FinaleCtx): Promise<void> {
  const { level, world } = f;
  const { player, audio, fx, engine } = level.ctx;
  const lm = world.landmarks;
  f.setBeat('fall');
  level.music?.('tension');

  // 1. the Eye turns on the field and flares: Frodo has reached the Fire
  level.cinematic(true);
  const base = V(player.position.x + 4, player.position.y + 2.6, player.position.z + 14);
  level.cameraShot({ position: base, lookAt: lm.crown.clone().setY(lm.crown.y - 40), fov: 40, blend: f.quick ? 0.2 : 2.6 });
  let flare = 0;
  const flareOff = level.onUpdate((dt) => {
    flare = Math.min(1, flare + dt / 4.5);
    lm.setEyeFlare(flare);
  });
  audio.play('thunder', { volume: 0.9, pitch: 0.55 });
  quake(level, 3.2, 0.12);
  await level.say('Aragorn', 'Frodo...', 2.0);
  await level.wait(f.quick ? 0.2 : 1.2);
  audio.play('thunder', { volume: 1.1, pitch: 0.5 });
  quake(level, 3, 0.22);

  // 2. the flash: the whole horizon goes white
  flareOff();
  lm.setEyeFlare(1);
  lm.flash();
  fx.lightning();
  engine.post.bloomStrength = Math.max(engine.post.bloomStrength, 1.2);
  audio.play('explosion', { volume: 1.5, pitch: 0.45 });
  audio.play('thunder', { volume: 1.4, pitch: 0.42 });
  player.camera.shake(1, 2.6);
  lm.blackout();
  lm.collapse();
  lm.shock();
  quake(level, 14, 0.6);
  void level.say('Legolas', 'The Tower! The Tower is falling!', 2.8);
  freezeFoes(level);
  await level.wait(f.quick ? 0.6 : 2.6);
  world.hosts.rout();
  world.hosts.runAway(7);
  lm.dustWall();

  // 3. the towers of the Gate crack and sink; stone falls from their crowns
  const gateObj = world.gate.object;
  const y0 = gateObj.position.y;
  let gt = 0;
  const gateOff = level.onUpdate((dt) => {
    gt += dt;
    const k = clamp(gt / 12, 0, 1);
    gateObj.position.y = y0 - k * k * 15;
    gateObj.rotation.z = Math.sin(gt * 9) * 0.003 * (1 - k) + k * 0.034;
    gateObj.rotation.x = k * -0.02;
    if (k >= 1) gateOff();
  });
  // dust and smoke pour from the crowns of both towers while they settle
  const plumes = [V(-46, 60, 6), V(48, 62, 6), V(-44, 30, 12), V(46, 32, 12)].map((p) => fx.smoke(p, 5));
  void level.wait(14).then(() => plumes.forEach((h) => h.stop()));
  const bursts: [number, number][] = [[-46, 74], [48, 76], [-40, 52], [44, 58], [-50, 30], [50, 34], [0, 48]];
  void (async () => {
    for (const [x, y] of bursts) {
      fx.explosion(V(x, y, 6), 5 + level.rng() * 2);
      fx.debris(V(x, y - 8, 12), 24, 0x2a2420);
      audio.play('stone_crumble', { pos: V(x * 0.3, 20, 80), volume: 1.2, pitch: 0.55 + level.rng() * 0.2 });
      await level.wait(0.7 + level.rng() * 0.9);
    }
  })();

  // 4. the hosts break: the Orcs scream and run, the Easterlings drop their spears
  foesFlee(level, player.position);
  audio.play('uruk_roar', { volume: 0.9, pitch: 0.6 });
  audio.play('orc_roar', { volume: 0.8, pitch: 0.7 });
  // the camera finds the plain: the host scattering below the hill
  await level.wait(f.quick ? 0.5 : 2.4);
  level.cameraShot({ position: V(FIGHT.x - 10, FIGHT.y + 7, FIGHT.z - 6), lookAt: V(0, FIGHT.y + 1, 60), fov: 52, blend: f.quick ? 0.2 : 2.2 });
  // the sky clears a little at a time (each preset change re-bakes the sky light: five steps)
  void (async () => {
    for (let i = 1; i <= 5; i++) {
      await level.wait(1.8);
      level.setEnvironment(lerpEnv(WAR, PEACE, i / 5));
    }
  })();
  await level.wait(f.quick ? 1 : 6.5);
  world.hosts.thinFleeing(0.5);
  engine.post.bloomStrength = Math.max(0, engine.post.bloomStrength);
}

// ─────────────────────────────────────────────────────────────────────────────
// the count
// ─────────────────────────────────────────────────────────────────────────────

/** the final tally across the whole game (rivalry totals) with banter */
export async function finalTally(f: FinaleCtx): Promise<void> {
  const { level } = f;
  const { player, rivalry, progression, hud } = level.ctx;
  f.setBeat('outro');
  level.music?.('epic');
  const live = rivalry.active ? { legolas: rivalry.legolas, gimli: rivalry.gimli } : progression.data.rivalryTotals;
  const g = live.gimli;
  const l = live.legolas;
  const gimli = f.gimli();
  const aragorn = f.aragorn();
  const at = player.position;
  if (!f.quick) {
    // the three of them on the saddle, the plain empty behind them
    level.cameraShot({ position: V(at.x + 5.5, at.y + 1.7, at.z - 6.5), lookAt: V(at.x - 1.2, at.y + 1.3, at.z + 0.6), fov: 38, blend: 2.2 });
  }
  gimli?.gesture('cheer');
  await level.say('Aragorn', 'It is done. Sauron is no more.', 2.8);
  await level.say('Gimli', 'Now, laddie. The count. The whole war, from the first orc to the last.', 3.4);
  hud.toast(`The count: Gimli ${g}, Legolas ${l}`, 'reward');
  await level.say('Gimli', `${numberWord(g)}! That is my axe's share.`, 2.6);
  await level.say('Legolas', `${numberWord(l)}. Count them again, Master Dwarf.`, 2.8);
  if (l > g) {
    gimli?.gesture('roar');
    await level.say('Gimli', 'Bah! An elf, and a lucky one. We shall settle it over a pint.', 3.2);
  } else if (g > l) {
    aragorn?.gesture('nod');
    await level.say('Legolas', 'The dwarf wins the war. I shall let him have it, this once.', 3.2);
  } else {
    gimli?.gesture('cheer');
    await level.say('Gimli', 'A tie! Then there is only one fair way to settle it: another war!', 3.4);
  }
  await level.say('Aragorn', 'Come. The war is over. Let us go home.', 2.6);
}
