/**
 * The end of the Black Gate: the Eagles arrive and bring down the Nazgul, Sauron falls (a flash on
 * the horizon, the ground shakes, Barad-dur collapses as a silhouette, the towers of the Gate crack),
 * the hosts break and flee, the sky clears, and Gimli and Legolas settle the count.
 */
import * as THREE from 'three';
import type { Ally, Combatant, Enemy, LevelAPI } from '../../../core/types';
import { clamp, smoothstep } from '../../../core/math';
import { numberWord } from '../../rivalry';
import { rock } from '../../../world';
import { Rng } from '../../../core/rng';
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

/** "A hundred and two": numberWord() falls back to digits from 100 */
function spell(n: number): string {
  if (n < 100 || n >= 1000 || !Number.isInteger(n)) return numberWord(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h === 1 ? 'A hundred' : `${numberWord(h)} hundred`;
  return rest ? `${head} and ${numberWord(rest).toLowerCase()}` : head;
}

/**
 * A long lens that keeps two flying things in frame: the eye stays put, the field of view closes as
 * they converge (the hit fills the screen) and opens again as they part.
 */
function pairShot(level: LevelAPI, eye: THREE.Vector3, a: () => THREE.Vector3, b: () => THREE.Vector3): () => void {
  const mid = new THREE.Vector3();
  let first = true;
  return level.onUpdate(() => {
    const pa = a();
    const pb = b();
    mid.copy(pa).lerp(pb, 0.5);
    const span = Math.max(30, pa.distanceTo(pb) * 1.15);
    const dist = Math.max(25, eye.distanceTo(mid));
    // vertical fov that makes `span` fill ~55 % of a 16:9 frame
    const fov = clamp((2 * Math.atan(span / 0.55 / 2 / dist / 1.78) * 180) / Math.PI, 11, 46);
    level.cameraShot({ position: eye, lookAt: mid, fov, blend: first ? 0.9 : 0 });
    first = false;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// the Eagles
// ─────────────────────────────────────────────────────────────────────────────

/** leader's path: in from the west, over the hills, on past the Gate */
const LEAD: [number, number, number][] = [
  [-460, 120, 300], [-270, 88, 250], [-110, 62, 214], [10, 46, 168], [60, 62, 70], [34, 110, -120], [0, 160, -420],
];
/** seeds pick the palette (seed % 3): the grey-white Windlord leads, golden hosts follow, one dark */
const EAGLE_SEEDS = [1, 3, 6, 2, 9];
const OFFS: [number, number, number, number][] = [
  // dx, dy, dz, delay
  [0, 0, 0, 0], [-18, -5, 14, 0.8], [20, -4, 16, 1.1], [-38, -10, 30, 1.9], [40, -8, 32, 2.2],
];

export async function eaglesArrive(f: FinaleCtx): Promise<EagleCtl[]> {
  const { level, sky } = f;
  const { player, audio, rivalry } = level.ctx;
  f.setBeat('eagles');
  // the stand is over: no more counting or banter over the cinematics, nothing can hurt Legolas now
  rivalry.autoGimli = false;
  player.invulnerable = true;
  player.weaponsEnabled = false;
  freezeFoes(level);
  level.objective(null);
  // a beat for the last arrows to land (the shell's kill banter, if one is queued, plays on the open
  // field and not over the cinematic)
  if (!f.quick) await level.wait(0.9);
  level.music?.('epic');
  level.cinematic(true);
  const eye = new THREE.Vector3(player.position.x + 6, player.position.y + 9, player.position.z + 8);
  // the sky to the west: the first speck
  level.cameraShot({ position: eye, lookAt: V(-260, 80, 250), fov: 50, blend: 1.2 });
  await level.say('Gandalf', 'The Eagles are coming!', 2.6);
  audio.play('horn_rohan', { volume: 0.9, pitch: 0.8 });

  const eagles: EagleCtl[] = OFFS.map(([dx, dy, dz, delay], i) => {
    const pts = LEAD.map(([x, y, z], k) => V(x + dx * (k === 0 ? 1.6 : 1), y + dy, z + dz * (k === 0 ? 1.6 : 1)));
    return sky.addEagle(pts, { seed: EAGLE_SEEDS[i], scale: i === 0 ? 1.5 : 1.15, speed: 38 - i * 0.5, delay });
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

/**
 * The eagles stoop on the Fell Beasts. Each stoop gets its own long-lens shot that closes on the hit;
 * the first one in slow motion. The next strike is already under way while the camera is still on the
 * first, and the beat does not end until every struck beast is down. Survivors flee for Mordor.
 */
export async function eaglesStrike(f: FinaleCtx, eagles: EagleCtl[], beasts: BeastCtl[]): Promise<void> {
  const { level, sky } = f;
  const { audio, player, time } = level.ctx;
  const north = V(0, 150, -420);
  const live = beasts.filter((b) => b.beast.alive);
  const struck: BeastCtl[] = [];
  const eye = new THREE.Vector3();
  let slowed = false;
  const launch = (ei: number, bi: number): { e: EagleCtl; b: BeastCtl } | null => {
    const e = eagles[ei];
    const b = live[bi];
    if (!e || !b || e.done || !b.beast.alive) return null;
    struck.push(b);
    sky.strike(e, b, north, () => {
      audio.play('explosion', { pos: b.beast.object.position, volume: 0.8, pitch: 0.7 });
      if (!slowed && !f.quick) {
        slowed = true;
        time.setScale(0.35, 0.08);
        void level.wait(0.5).then(() => time.setScale(1, 0.5));
      }
    });
    return { e, b };
  };
  const first = launch(1, 0);
  void level.wait(f.quick ? 0.3 : 1.6).then(() => launch(2, 1));
  void level.wait(f.quick ? 0.6 : 3.2).then(() => launch(3, 2));
  if (first) {
    // the eye sits between the player and the strike, high enough to clear the hills
    const m = first.b.beast.object.position;
    eye.set(player.position.x + (m.x - player.position.x) * 0.35, Math.max(player.position.y + 6, m.y - 28), player.position.z + (m.z - player.position.z) * 0.35);
    const stop = pairShot(level, eye, () => first.b.beast.object.position, () => first.e.eagle.object.position);
    await level.waitUntil(() => !first.b.beast.alive, 14);
    void level.say('Aragorn', 'The Nazgul are falling!', 2.2);
    await level.wait(f.quick ? 0.6 : 2.6);
    stop();
  }
  // the others: cut to the second beast (if it is still in the air), then wait out the rest
  const second = live[1];
  if (second && second.beast.alive && eagles[2] && !f.quick) {
    const m = second.beast.object.position;
    eye.set(player.position.x + (m.x - player.position.x) * 0.3, Math.max(player.position.y + 6, m.y - 28), player.position.z + (m.z - player.position.z) * 0.3);
    const stop = pairShot(level, eye, () => second.beast.object.position, () => eagles[2].eagle.object.position);
    await level.waitUntil(() => !second.beast.alive, 10);
    await level.wait(1.6);
    stop();
  }
  await level.waitUntil(() => struck.every((b) => !b.beast.alive), 10);
  // the survivors flee for Mordor
  for (const b of live) if (b.beast.alive) sky.leave(b, V(-60 + level.rng() * 120, 140, -500));
  await level.wait(f.quick ? 0.5 : 1.2);
}

// ─────────────────────────────────────────────────────────────────────────────
// the fall of Sauron
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Glowing fissures that open across the fronts of the two Gate towers (additive ribbons parented to
 * the Gate, so they sink and tilt with it). `set(k)` runs 0..1.
 */
function gateCracks(world: BlackGateWorld, seed: number): (k: number) => void {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const idx: number[] = [];
  const side: number[] = [];
  let base = 0;
  for (const s of [-1, 1]) {
    for (let c = 0; c < 5; c++) {
      let x = s * 30 + (rng.float() - 0.5) * 16;
      let y = 66 - rng.float() * 8;
      const n = 9 + Math.floor(rng.float() * 5);
      for (let k = 0; k < n; k++) {
        const w = 0.55 * Math.sin((Math.PI * (k + 0.5)) / n) + 0.12;
        // the tower front leans back as it rises: keep the ribbon just proud of it
        const z = 17.6 - 6 * Math.max(0, (y - 16) / 60);
        pos.push(x - w, y, z, x + w, y, z);
        side.push(k / n, k / n);
        if (k > 0) {
          const i = base + (k - 1) * 2;
          idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        }
        y -= 3.2 + rng.float() * 3.4;
        x += (rng.float() - 0.5) * 5.5;
        if (y < 14) break;
      }
      base = pos.length / 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.1, 0.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'gate_cracks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.userData.noAO = true;
  mesh.visible = false;
  world.gate.object.add(mesh);
  return (k: number) => {
    mesh.visible = k > 0.01;
    m.opacity = clamp(k * 1.1, 0, 1);
    mesh.scale.set(1, 1, 1);
  };
}

/** a few great blocks break from the tower crowns and fall to the plain (ballistic, one bounce, then they settle) */
function fallingBlocks(level: LevelAPI, world: BlackGateWorld): void {
  const { fx, audio, player } = level.ctx;
  const rng = new Rng(4242);
  interface Block { o: THREE.Object3D; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; at: number; bounced: boolean; rest: number }
  const blocks: Block[] = [];
  for (let i = 0; i < 12; i++) {
    const s = i % 2 ? 1 : -1;
    const b = rock(2.2 + rng.float() * 2.6, 60 + i, { kind: 'dark', flat: 1.2, rough: 1 });
    const o = b.object;
    o.visible = false;
    o.traverse((c) => {
      c.castShadow = false;
      c.userData.noAO = true;
    });
    level.root.add(o);
    blocks.push({ o, vx: s * (3 + rng.float() * 8), vy: 1 + rng.float() * 7, vz: 2 + rng.float() * 14, sx: (rng.float() - 0.5) * 3, sy: (rng.float() - 0.5) * 3, sz: (rng.float() - 0.5) * 3, at: 0.4 + i * 0.55 + rng.float() * 0.4, bounced: false, rest: -1 });
    o.position.set(s * (24 + rng.float() * 14), 74 + rng.float() * 8, 4 + rng.float() * 10);
  }
  let t = 0;
  const off = level.onUpdate((dt) => {
    t += dt;
    let live = 0;
    for (const b of blocks) {
      if (b.rest > 4) {
        b.o.visible = false;
        continue;
      }
      live++;
      if (t < b.at) continue;
      b.o.visible = true;
      const p = b.o.position;
      if (b.rest >= 0) {
        b.rest += dt;
        p.y -= dt * 0.5;
        continue;
      }
      b.vy -= 26 * dt;
      p.x += b.vx * dt;
      p.y += b.vy * dt;
      p.z += b.vz * dt;
      b.o.rotation.x += b.sx * dt;
      b.o.rotation.y += b.sy * dt;
      b.o.rotation.z += b.sz * dt;
      const gy = world.ground(p.x, p.z) + 1;
      if (p.y <= gy) {
        p.y = gy;
        fx.dust(p, 14, 0x6a5848);
        audio.play('stone_crumble', { pos: p, volume: 1, pitch: 0.55 + rng.float() * 0.2 });
        const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
        if (d < 260) player.camera.shake(0.12, 0.4);
        if (!b.bounced && b.vy < -6) {
          b.bounced = true;
          b.vy *= -0.22;
          b.vx *= 0.5;
          b.vz *= 0.5;
        } else b.rest = 0;
      }
    }
    if (live === 0 || t > 40) {
      for (const b of blocks) b.o.visible = false;
      off();
    }
  });
}

export async function sauronFalls(f: FinaleCtx): Promise<void> {
  const { level, world } = f;
  const { player, audio, fx, engine } = level.ctx;
  const lm = world.landmarks;
  f.setBeat('fall');
  level.music?.('tension');
  const setCracks = gateCracks(world, 31);

  // 1. the Eye turns on the field and flares: Frodo has reached the Fire. The camera takes in the whole
  //    of Barad-dur, and the first cracks run through the towers of the Gate.
  level.cinematic(true);
  // a crane over the saddle: from a hundred metres up the Gate drops below the horizon and the whole of
  // Barad-dur stands above it (from the ground the Gate hides everything but the crown)
  const crane = V(player.position.x + 4, player.position.y + 100, player.position.z + 22);
  const tower = V(lm.crown.x, 250, lm.crown.z);
  level.cameraShot({ position: crane, lookAt: tower, fov: 58, blend: f.quick ? 0.2 : 3.2 });
  let flare = 0;
  const flareOff = level.onUpdate((dt) => {
    flare = Math.min(1, flare + dt / 4.5);
    lm.setEyeFlare(flare);
    setCracks(smoothstep(0.35, 1, flare) * 0.55);
  });
  audio.play('thunder', { volume: 0.9, pitch: 0.55 });
  quake(level, 3.2, 0.12);
  await level.say('Aragorn', 'Frodo...', 2.0);
  await level.wait(f.quick ? 0.2 : 1.2);
  audio.play('thunder', { volume: 1.1, pitch: 0.5 });
  quake(level, 3, 0.22);

  // 2. the flash: the horizon goes white for a moment (a short, tight burst), the Eye goes out, and as it
  //    fades the Tower begins to come down tier by tier, in full view
  flareOff();
  lm.setEyeFlare(1);
  lm.flash();
  fx.lightning();
  engine.post.bloomStrength = Math.max(engine.post.bloomStrength, 1.2);
  audio.play('explosion', { volume: 1.5, pitch: 0.45 });
  audio.play('thunder', { volume: 1.4, pitch: 0.42 });
  player.camera.shake(0.6, 1.8);
  lm.blackout();
  lm.shock();
  quake(level, 14, 0.4);
  freezeFoes(level);
  let crackK = 0.55;
  const crackOff = level.onUpdate((dt) => {
    crackK = Math.min(1, crackK + dt / 5);
    setCracks(crackK);
  });
  await level.wait(f.quick ? 0.3 : 1.3);
  lm.collapse();
  void level.say('Legolas', 'The Tower! The Tower is falling!', 2.8);
  // hold the long view while the tiers fall (the crown first, then every tier from the top down)
  if (!f.quick) level.cameraShot({ position: V(crane.x, crane.y + 14, crane.z + 12), lookAt: V(lm.crown.x, 235, lm.crown.z), fov: 62, blend: 6 });
  await level.wait(f.quick ? 0.5 : 3.4);
  world.hosts.rout();
  world.hosts.runAway(7);
  lm.dustWall();
  audio.play('uruk_roar', { volume: 0.9, pitch: 0.6 });
  audio.play('orc_roar', { volume: 0.8, pitch: 0.7 });
  await level.wait(f.quick ? 0.4 : 3.6);

  // 3. back to the plain: the towers of the Gate crack open, great blocks fall from the crowns, and the
  //    whole Gate sinks and leans as the hosts break below it
  const gateObj = world.gate.object;
  const y0 = gateObj.position.y;
  let gt = 0;
  const gateOff = level.onUpdate((dt) => {
    gt += dt;
    const k = clamp(gt / 12, 0, 1);
    gateObj.position.y = y0 - k * k * 15;
    gateObj.rotation.z = Math.sin(gt * 9) * 0.004 * (1 - k) + k * 0.05;
    gateObj.rotation.x = k * -0.025;
    if (k >= 1) {
      gateOff();
      crackOff();
      setCracks(0);
    }
  });
  fallingBlocks(level, world);
  // dust and smoke pour from the crowns of both towers while they settle
  const plumes = [V(-30, 78, 8), V(30, 78, 8), V(-30, 40, 16), V(30, 42, 16)].map((p) => fx.smoke(p, 6));
  void level.wait(16).then(() => plumes.forEach((h) => h.stop()));
  const bursts: [number, number][] = [[-30, 80], [31, 82], [-36, 56], [36, 60], [-26, 36]];
  void (async () => {
    for (const [x, y] of bursts) {
      fx.explosion(V(x, y, 12), 3.2 + level.rng() * 1.5);
      fx.debris(V(x, y - 6, 14), 30, 0x2a2420);
      audio.play('stone_crumble', { pos: V(x * 0.3, 20, 80), volume: 1.2, pitch: 0.55 + level.rng() * 0.2 });
      await level.wait(0.7 + level.rng() * 0.9);
    }
  })();
  foesFlee(level, player.position);
  level.cameraShot({ position: V(FIGHT.x - 14, FIGHT.y + 8, FIGHT.z - 8), lookAt: V(0, 36, 30), fov: 56, blend: f.quick ? 0.2 : 2.2 });
  // the sky clears a little at a time (each preset change re-bakes the sky light: five steps)
  void (async () => {
    for (let i = 1; i <= 5; i++) {
      await level.wait(1.8);
      level.setEnvironment(lerpEnv(WAR, PEACE, i / 5));
    }
  })();
  await level.wait(f.quick ? 1 : 7);
  world.hosts.thinFleeing(0.5);
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
  await level.say('Gimli', `${spell(g)}! That is my axe's share.`, 2.6);
  await level.say('Legolas', `${spell(l)}. Count them again, Master Dwarf.`, 2.8);
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
