/**
 * The Cave Troll of Moria: boss logic on top of createEnemy archetype 'troll' (cave variant).
 *
 * The base AI gives the troll its sweeps, slams and stomps. This module layers the set-piece:
 *
 *   ENTRANCE   it lumbers in on leash chains held by two goblin handlers, who let go and run.
 *   FIGHT 1    specials on a timer: CHARGE (telegraphed roar, then a straight run: dodge it, or let it
 *              run into a pillar) and THROW (it grabs a goblin and hurls it at you).
 *   STUN       after three headshots, a pillar slam, or at half health it drops to a knee; the chain
 *              on its collar hangs to the floor and glows. Interact at the chain to climb.
 *   CLIMB      a PlayerMover rides the swaying chain up to its shoulders.
 *   SKULL      forced aim: two point-blank arrows into the skull (interact / melee / fire).
 *   FIGHT 2    it throws you off, enraged: faster, more throws.
 *   FINAL      at low health it staggers back, roaring, mouth open, in slow motion: any arrow into
 *              the face kills it (cinematic slow-mo). Health is clamped so only that shot ends it.
 *
 * Everything goes through the public Enemy surface (aiEnabled, moveTarget, attack, playPose) and
 * wraps takeDamage on the instance. The few NpcBase fields that are not on the Enemy interface
 * (facing, speedMax) are touched through a guarded cast, see `setFacing` / `setSpeed`.
 */
import * as THREE from 'three';
import type { Combatant, DamageInfo, Enemy, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import { clamp, dirFromYaw, smoothstep, wrapAngle, yawOf } from '../../../core/math';
import { seedForBucket } from '../../../creatures/humanoid/kinds/uruks_bosses';
import { PILLARS, PILLAR_HALF } from './layout';
import { RopeChain } from './chain';

export type TrollMode = 'idle' | 'fight' | 'stunned' | 'climb' | 'skull' | 'final' | 'dying' | 'dead';

export interface TrollFight {
  readonly enemy: Enemy;
  readonly mode: TrollMode;
  /** 1 before the climb, 2 after */
  readonly stage: 1 | 2;
  /** when stunned: the point on the floor under the chain's end */
  chainBase(out: THREE.Vector3): THREE.Vector3 | null;
  /** can the player interact with the chain right now? */
  readonly chainReady: boolean;
  /** the skull phase wants an interact press */
  readonly wantsShot: boolean;
  /** unleash it: AI on, specials start */
  begin(): void;
  /** resolves when the troll is dead and the kill cinematic is over */
  readonly done: Promise<void>;
  /** enter the stun now (testing / scripted) */
  stun(reason: 'pillar' | 'hits' | 'health'): void;
  /** a leash chain from a troll bone to a goblin handler's fist */
  attachLeash(handler: Enemy, bone: 'foot_r' | 'hand_l'): void;
  /** the handlers let go: the chains fall and are cleared a moment later */
  releaseLeashes(): void;
  dispose(): void;
}

export interface TrollOpts {
  /** where it appears */
  spawn: THREE.Vector3;
  /** where it walks to during the entrance */
  stage: THREE.Vector3;
  /** HP before difficulty */
  hp?: number;
  /** called when the stun starts / ends so the script can freeze or free the goblins */
  onStun?: (on: boolean) => void;
  /** subtitle hooks */
  say?: (speaker: string, text: string, secs: number) => Promise<void>;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hand = new THREE.Vector3();

/** NpcBase keeps `facing` and `speedMax` as public fields that the Enemy interface does not list */
function setFacing(e: Enemy, yaw: number): void {
  const x = e as unknown as { facing?: number };
  if (typeof x.facing === 'number') x.facing = yaw;
  e.object.rotation.y = yaw;
}
function getSpeed(e: Enemy): number {
  const x = e as unknown as { speedMax?: number };
  return typeof x.speedMax === 'number' ? x.speedMax : 3;
}
function setSpeed(e: Enemy, v: number): void {
  const x = e as unknown as { speedMax?: number };
  if (typeof x.speedMax === 'number') x.speedMax = v;
}
function headOf(c: Combatant, out: THREE.Vector3): THREE.Vector3 {
  const h = (c as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 }).headPoint;
  return h ? h.call(c, out) : c.aimPoint(out);
}

interface ChargeAct {
  kind: 'charge';
  t: number;
  stage: 'tele' | 'run' | 'recover';
  dir: THREE.Vector3;
  travelled: number;
  hitPlayer: boolean;
  slowT: number;
}
interface ThrowAct {
  kind: 'throw';
  t: number;
  stage: 'walk' | 'grab' | 'wind' | 'fly' | 'recover';
  goblin: Enemy;
  from: THREE.Vector3;
  vel: THREE.Vector3;
  fly: number;
}
type Act = ChargeAct | ThrowAct | null;

const THROW_FLY = 0.9;
const GRAVITY = 22;

export function createTrollFight(level: LevelAPI, opts: TrollOpts): TrollFight {
  const ctx = level.ctx;
  const player: PlayerAPI = ctx.player;
  const { fx, audio } = ctx;

  const enemy = level.spawnEnemy(
    { archetype: 'troll', boss: true, name: 'Cave Troll', hp: opts.hp ?? 1400, seed: seedForBucket(0), countsForRivalry: true },
    opts.spawn,
    Math.PI * 1.5,
  );
  enemy.aiEnabled = false;
  const B = enemy.humanoid.bones;
  const baseSpeed = getSpeed(enemy);

  const log = (m: string): void => {
    if (ctx.flags.trace === '1') console.log(`[moria] t=${ctx.time.t.toFixed(1)} troll: ${m} hp=${Math.round(enemy.hp)}/${enemy.maxHp}`);
  };
  let mode: TrollMode = 'idle';
  let stage: 1 | 2 = 1;
  let act: Act = null;
  let specialCd = 7;
  let headHits = 0;
  /** seconds of open fight so far: the head-hit stun only arms after it has shown its charge and throw */
  let fightT = 0;
  let pendingStun: 'pillar' | 'hits' | 'health' | null = null;
  let pendingFinal = false;
  let stunT = 0;
  let finalWindow = false;
  let finalT = 0;
  let finalCd = 0;
  let skullShots = 0;
  let skullDone = false;
  let shotCd = 0;
  let pendingShot = -1;
  let killed = false;
  let enraged = false;
  let hintedCharge = false;
  let hintedChain = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

  // ── the chain on its collar: always dangling, climbable when it is down ──
  const collar = new RopeChain(11, 0.3);
  level.root.add(collar.object);
  const collarMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.06, 7, 18),
    new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.8 }),
  );
  collarMesh.rotation.x = Math.PI / 2;
  collarMesh.position.set(0, 0.02, 0.02);
  collarMesh.castShadow = true;
  B.neck.add(collarMesh);
  /** the glow that marks the chain tip while it can be climbed */
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  marker.userData.noAO = true;
  marker.visible = false;
  level.root.add(marker);

  // ── leash chains and handlers (the entrance) ──
  const leashes: { chain: RopeChain; handler: Enemy; anchor: THREE.Object3D }[] = [];

  function forward(out: THREE.Vector3): THREE.Vector3 {
    return dirFromYaw(enemy.object.rotation.y, out);
  }

  /** the point on the floor under the chain's end */
  function chainBase(out: THREE.Vector3): THREE.Vector3 | null {
    collar.tip(out);
    out.y = enemy.position.y;
    return out;
  }

  // ── damage wrapper ──
  const origTake = enemy.takeDamage.bind(enemy);
  enemy.takeDamage = (d: DamageInfo): void => {
    if (!enemy.alive || killed) return;
    // while it is down or being climbed nothing scratches it (no flinch to break the pose)
    if (mode === 'stunned' || mode === 'climb' || mode === 'idle') return;
    const isHead = d.zone === 'head' || d.zone === 'weakpoint';
    const fromPlayer = d.source === player || (d.source !== null && d.source.team === 'ally');
    if (mode === 'skull') {
      // point-blank arrows: the damage lands without breaking its kneeling pose
      if (isHead && d.type === 'arrow' && d.source === player) {
        enemy.hp = Math.max(enemy.maxHp * 0.12, enemy.hp - d.amount);
        enemy.humanoid.flash(0xffb070);
        audio.play('troll_hit', { pos: enemy.position, volume: 0.9, pitch: 0.8 });
        _a.copy(d.point ?? enemy.position);
        fx.blood(_a, _b.set(0, 1, 0), 'dark', 2.2);
      }
      return;
    }
    // the final shot: an arrow into the open mouth
    if (finalWindow && isHead && d.type === 'arrow' && fromPlayer && frontal(d)) {
      killed = true;
      finalWindow = false;
      origTake({ ...d, amount: enemy.maxHp * 2, zone: 'weakpoint' });
      void killCinematic();
      return;
    }
    let amount = d.amount;
    const floor = stage === 1 ? 0.5 : 0.1;
    amount = Math.min(amount, Math.max(0, enemy.hp - floor * enemy.maxHp));
    if (mode === 'fight' && stage === 1 && isHead && d.type === 'arrow' && d.source === player) {
      headHits++;
    }
    if (amount <= 0.01) return;
    origTake({ ...d, amount });
  };
  /** arrows that struck the front of the face (where the mouth is) */
  function frontal(d: DamageInfo): boolean {
    if (!d.point) return true;
    headOf(enemy, _a);
    forward(_b);
    _c.copy(d.point).sub(_a);
    return _c.dot(_b) > -0.12;
  }

  // ── helpers ──
  const playerDist = () => Math.hypot(player.position.x - enemy.position.x, player.position.z - enemy.position.z);
  function faceTowards(p: THREE.Vector3, rate = 1): void {
    const want = yawOf(p.x - enemy.position.x, p.z - enemy.position.z);
    const cur = enemy.object.rotation.y;
    setFacing(enemy, cur + wrapAngle(want - cur) * rate);
  }
  function freeze(): void {
    enemy.velocity.x = 0;
    enemy.velocity.z = 0;
  }
  function goblinsNear(r: number): Enemy[] {
    const out: Enemy[] = [];
    for (const c of ctx.combatants.byTeam('enemy')) {
      const e = c as Enemy;
      if (c === enemy || !c.alive || e.spec?.archetype !== 'goblin') continue;
      if (Math.hypot(c.position.x - enemy.position.x, c.position.z - enemy.position.z) < r) out.push(e);
    }
    return out;
  }
  const trollRadius = () => enemy.radius;

  // ── specials ────────────────────────────────────────────────────────────
  function startCharge(): void {
    log('charge');
    const a: ChargeAct = { kind: 'charge', t: 0, stage: 'tele', dir: new THREE.Vector3(), travelled: 0, hitPlayer: false, slowT: 0 };
    act = a;
    enemy.aiEnabled = false;
    enemy.playPose?.('roar', 1.5);
    audio.play('troll_roar', { pos: enemy.position, volume: 1, pitch: 0.9 });
    player.camera.shake(0.25, 0.9);
    if (!hintedCharge) {
      hintedCharge = true;
      ctx.hud.toast('It charges: sidestep, or let it hit a pillar', 'warning');
    }
  }

  function updateCharge(a: ChargeAct, dt: number): void {
    a.t += dt;
    if (a.stage === 'tele') {
      freeze();
      faceTowards(player.position, clamp(dt * 5, 0, 1));
      if (a.t > 1.3) {
        a.stage = 'run';
        a.t = 0;
        a.dir.set(player.position.x - enemy.position.x, 0, player.position.z - enemy.position.z).normalize();
        enemy.playPose?.('roar', 0.01);
      }
      return;
    }
    if (a.stage === 'run') {
      const speed = (7.2 + (enraged ? 1.4 : 0)) * smoothstep(0, 0.45, a.t);
      // what the motor made of last frame's velocity
      const moved = Math.hypot(enemy.position.x - lastX, enemy.position.z - lastZ);
      a.travelled += moved;
      enemy.velocity.x = a.dir.x * speed;
      enemy.velocity.z = a.dir.z * speed;
      setFacing(enemy, yawOf(a.dir.x, a.dir.z));
      // contact with the player
      if (!a.hitPlayer && player.alive) {
        const d = Math.hypot(player.position.x - enemy.position.x, player.position.z - enemy.position.z);
        if (d < trollRadius() + player.radius + 0.7 && Math.abs(player.position.y - enemy.position.y) < 2.2) {
          a.hitPlayer = true;
          _a.set(a.dir.x, 0.35, a.dir.z);
          player.takeDamage({ amount: 34, type: 'blunt', source: enemy, point: player.position, dir: _a.clone(), knockback: 12, stagger: true });
          audio.play('troll_hit', { pos: player.position, volume: 1 });
          player.camera.shake(0.6, 0.4);
        }
      }
      // blocked? (the motor stops it against a pillar or a wall)
      if (a.t > 0.6 && moved < speed * dt * 0.3) {
        const pillar = nearestPillar(enemy.position.x + a.dir.x * 1.6, enemy.position.z + a.dir.z * 1.6);
        if (pillar && Math.hypot(pillar.x - enemy.position.x, pillar.z - enemy.position.z) < PILLAR_HALF + trollRadius() + 1.6) {
          pillarSlam(pillar);
          return;
        }
        a.stage = 'recover';
        a.t = 0;
        enemy.velocity.set(0, 0, 0);
        enemy.playPose?.('stagger', 1.2);
        return;
      }
      if (a.t > 2.7 || a.travelled > 30) {
        a.stage = 'recover';
        a.t = 0;
        enemy.playPose?.('stagger', 1.0);
      }
      return;
    }
    // recover: a breather the player can use
    enemy.velocity.x *= 1 - clamp(dt * 6, 0, 1);
    enemy.velocity.z *= 1 - clamp(dt * 6, 0, 1);
    if (a.t > 1.1) endAct();
  }

  let lastX = 0;
  let lastZ = 0;
  function nearestPillar(x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bd = 99;
    for (const p of PILLARS) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return bd < 6 ? best : null;
  }

  function pillarSlam(p: { x: number; z: number }): void {
    log('pillar slam');
    enemy.velocity.set(0, 0, 0);
    act = null;
    audio.play('stone_crumble', { pos: enemy.position, volume: 1 });
    audio.play('troll_hit', { pos: enemy.position, volume: 1 });
    player.camera.shake(0.8, 0.9);
    _a.set(p.x, 3.2, p.z);
    fx.debris(_a, 26, 0x6a645a);
    _a.set(p.x, 0.3, p.z);
    fx.dust(_a, 30, 0x6a5a44);
    ctx.time.hitStop(0.09);
    pendingStun = 'pillar';
  }

  function endAct(): void {
    if (act?.kind === 'throw') {
      const g = act.goblin;
      if (g.alive) {
        g.aiEnabled = true;
        g.object.rotation.x = 0;
      }
    }
    act = null;
    if (mode === 'fight') enemy.aiEnabled = true;
    specialCd = (enraged ? 5.5 : 8.5) + level.rng() * 3;
  }

  function startThrow(g: Enemy): void {
    log('throw');
    const a: ThrowAct = { kind: 'throw', t: 0, stage: 'walk', goblin: g, from: new THREE.Vector3(), vel: new THREE.Vector3(), fly: 0 };
    act = a;
    enemy.aiEnabled = false;
    g.aiEnabled = false;
    g.moveTarget = null;
  }

  function updateThrow(a: ThrowAct, dt: number): void {
    const g = a.goblin;
    a.t += dt;
    if (!g.alive) {
      endAct();
      return;
    }
    const hand = B.hand_l.getWorldPosition(_hand);
    if (a.stage === 'walk') {
      // step toward the goblin until it is within reach, then grab
      const gap = Math.hypot(g.position.x - enemy.position.x, g.position.z - enemy.position.z);
      faceTowards(g.position, clamp(dt * 6, 0, 1));
      g.velocity.x = 0;
      g.velocity.z = 0;
      if (gap > 2.4 && a.t < 1.6) {
        enemy.moveTarget = g.position;
        enemy.aiEnabled = false;
      } else {
        enemy.moveTarget = null;
        a.stage = 'grab';
        a.t = 0;
        a.from.copy(g.position);
        enemy.playPose?.('roar', 0.6);
        g.playPose?.('hang', 3);
        audio.play('goblin_screech', { pos: g.position, volume: 0.9, pitch: 1.2 });
      }
      return;
    }
    if (a.stage === 'grab') {
      // the goblin is hauled up into its fist
      const k = smoothstep(0, 0.5, a.t);
      g.position.lerpVectors(a.from, _b.copy(hand).setY(hand.y - 1.0), k);
      g.velocity.set(0, 0, 0);
      faceTowards(player.position, clamp(dt * 6, 0, 1));
      if (a.t >= 0.6) {
        a.stage = 'wind';
        a.t = 0;
        enemy.attack?.('throw', { windup: 0.85, target: null });
      }
      return;
    }
    if (a.stage === 'wind') {
      g.position.copy(hand).y -= 1.0;
      g.velocity.set(0, 0, 0);
      faceTowards(player.position, clamp(dt * 8, 0, 1));
      if (a.t >= 0.95) {
        // release: a ballistic arc to where the player will be
        a.stage = 'fly';
        a.t = 0;
        a.fly = 0;
        a.from.copy(g.position);
        _b.copy(player.position).addScaledVector(player.velocity, THROW_FLY * 0.7);
        a.vel.set((_b.x - a.from.x) / THROW_FLY, (_b.y + 0.9 - a.from.y + 0.5 * GRAVITY * THROW_FLY * THROW_FLY) / THROW_FLY, (_b.z - a.from.z) / THROW_FLY);
        audio.play('arrow_whoosh', { pos: g.position, volume: 0.8, pitch: 0.6 });
        audio.play('goblin_screech', { pos: g.position, volume: 0.9, pitch: 1.35 });
      }
      return;
    }
    if (a.stage === 'fly') {
      a.fly += dt;
      const t = a.fly;
      g.position.set(a.from.x + a.vel.x * t, a.from.y + a.vel.y * t - 0.5 * GRAVITY * t * t, a.from.z + a.vel.z * t);
      g.velocity.set(0, 0, 0);
      g.object.rotation.x += dt * 9;
      const floorY = ctx.physics.heightAt(g.position.x, g.position.z);
      const dp = Math.hypot(g.position.x - player.position.x, g.position.z - player.position.z);
      const hitPlayer = dp < g.radius + player.radius + 0.5 && Math.abs(g.position.y - (player.position.y + 1)) < 1.3;
      if (t >= THROW_FLY || g.position.y <= floorY + 0.2 || hitPlayer) {
        // impact
        g.object.rotation.x = 0;
        fx.dust(g.position, 3);
        fx.blood(_c.copy(g.position).setY(g.position.y + 0.4), _d.set(0, 1, 0), 'dark', 1.2);
        audio.play('troll_hit', { pos: g.position, volume: 0.6, pitch: 1.4 });
        if (player.alive && dp < 2.4 + g.radius) {
          _a.set(a.vel.x, 0.3, a.vel.z).normalize();
          player.takeDamage({ amount: 16, type: 'blunt', source: enemy, point: player.position, dir: _a.clone(), knockback: 6, stagger: true });
        }
        g.takeDamage({ amount: 1e5, type: 'crush', source: enemy });
        a.stage = 'recover';
        a.t = 0;
      }
      return;
    }
    if (a.t > 0.5) endAct();
  }

  // ── stun, climb, skull ──────────────────────────────────────────────────
  function startStun(reason: 'pillar' | 'hits' | 'health'): void {
    log(`stun (${reason})`);
    mode = 'stunned';
    act = null;
    pendingStun = null;
    stunT = 0;
    headHits = 0;
    enemy.aiEnabled = false;
    enemy.moveTarget = null;
    enemy.velocity.set(0, 0, 0);
    enemy.playPose?.('kneel', 60);
    enemy.targetable = false;
    audio.play('troll_roar', { pos: enemy.position, volume: 1, pitch: 0.75 });
    audio.play('chain_rattle', { pos: enemy.position, volume: 0.9 });
    player.camera.shake(0.45, 0.6);
    opts.onStun?.(true);
    marker.visible = true;
    level.objective('The troll is down: climb the chain onto its shoulders');
    if (!hintedChain) {
      hintedChain = true;
      ctx.hud.toast(reason === 'pillar' ? 'It hit the pillar! Grab the collar chain' : 'It is dazed! Grab the collar chain', 'info');
    }
    void opts.say?.('Gimli', 'Now, laddie! Get on its back!', 2.4);
  }

  function endStun(): void {
    enemy.playPose?.('roar', 0.01);
    marker.visible = false;
    enemy.targetable = true;
    opts.onStun?.(false);
    ctx.hud.setPrompt(null);
    ctx.input.setInteractLabel(null);
  }

  /** the climb + skull mover (one PlayerMover, three stages) */
  function makeClimb(): PlayerMover {
    let s = 0;
    let st: 'approach' | 'climb' | 'mount' | 'aim' = 'approach';
    let t = 0;
    const from = new THREE.Vector3();
    const stand = new THREE.Vector3();
    const w = new THREE.Vector3();
    const target = new THREE.Vector3();
    const mover: PlayerMover = {
      pose: 'climb',
      poseT: () => (st === 'aim' ? 0.5 : (s * 3) % 1),
      allowShoot: false,
      allowMelee: false,
      allowDash: false,
      allowJump: false,
      camera: { distance: 3.3, height: 1.5, shoulder: 0.55 },
      update(dt, p, input) {
        t += dt;
        chainBase(target);
        standPoint(stand);
        if (st === 'approach') {
          // slide to the foot of the chain
          from.copy(p.position);
          const d = Math.hypot(target.x - p.position.x, target.z - p.position.z);
          const step = Math.min(d, 8 * dt);
          if (d > 0.05) {
            p.position.x += ((target.x - p.position.x) / d) * step;
            p.position.z += ((target.z - p.position.z) / d) * step;
          }
          p.position.y = ctx.physics.heightAt(p.position.x, p.position.z);
          p.velocity.set(0, 0, 0);
          p.facing = yawOf(enemy.position.x - p.position.x, enemy.position.z - p.position.z);
          if (d < 0.2 || t > 0.9) {
            st = 'climb';
            t = 0;
          }
          return;
        }
        if (st === 'climb') {
          s = clamp(t / 2.4, 0, 1);
          // along the chain: index n = the floor end, 0 = the collar
          const idx = (1 - s) * collar.n;
          const i0 = Math.floor(idx);
          collar.point(i0, _a);
          collar.point(i0 + 1, _b);
          w.lerpVectors(_a, _b, idx - i0);
          _c.set(enemy.position.x - w.x, 0, enemy.position.z - w.z).normalize();
          // hands on the chain, body toward the troll
          const px = w.x - _c.x * 0.28;
          const pz = w.z - _c.z * 0.28;
          const py = Math.max(enemy.position.y, w.y - 1.35);
          p.velocity.set((px - p.position.x) / Math.max(dt, 1e-4), (py - p.position.y) / Math.max(dt, 1e-4), (pz - p.position.z) / Math.max(dt, 1e-4)).multiplyScalar(0.35);
          p.position.set(px, py, pz);
          p.facing = yawOf(_c.x, _c.z);
          if (s >= 1) {
            st = 'mount';
            t = 0;
            from.copy(p.position);
          }
          return;
        }
        if (st === 'mount') {
          const k = smoothstep(0, 0.55, t);
          p.position.lerpVectors(from, stand, k);
          p.velocity.set(0, 0, 0);
          if (t >= 0.6) {
            st = 'aim';
            t = 0;
            mover.pose = 'crouch';
            mover.allowShoot = false;
            mover.camera = { distance: 3.4, height: 1.9, shoulder: 1.25, fov: 58 };
            mode = 'skull';
            log('skull');
            level.objective('Two arrows into the skull');
            ctx.hud.setPrompt('interact', 'Loose an arrow into its skull');
            ctx.input.setInteractLabel('Shoot');
          }
          return;
        }
        // aim: stay on the shoulders, forced aim at the skull
        p.position.copy(stand);
        p.velocity.set(0, 0, 0);
        headOf(enemy, _a);
        _b.set(_a.x - p.position.x, _a.y - (p.position.y + 1.45), _a.z - p.position.z);
        const h = Math.hypot(_b.x, _b.z);
        p.facing = yawOf(_b.x, _b.z);
        p.camera.yaw = p.facing;
        p.camera.pitch = clamp(Math.atan2(_b.y, Math.max(h, 0.3)), -1.1, 1.0);
        shotCd -= dt;
        if (pendingShot >= 0) {
          pendingShot -= dt;
          if (pendingShot < 0) loosePointBlank();
        } else if (shotCd <= 0 && (input.interact || input.melee || input.drawReleased)) {
          pendingShot = 0.32;
          audio.play('bow_draw', { pos: p.position, volume: 0.5 });
        }
      },
    };
    return mover;
  }

  function standPoint(out: THREE.Vector3): THREE.Vector3 {
    B.neck.getWorldPosition(out);
    forward(_d);
    out.addScaledVector(_d, -0.32);
    out.y += 0.06;
    return out;
  }

  function loosePointBlank(): void {
    pendingShot = -1;
    shotCd = 0.5;
    headOf(enemy, _a);
    player.humanoid.root.getWorldPosition(_b);
    _b.y += 1.6;
    _c.copy(_a).sub(_b).normalize();
    // spawn the arrow a little way out so its ray starts outside the skull zone
    _b.addScaledVector(_c, 0.2);
    audio.play('bow_release', { pos: player.position, volume: 0.9 });
    const dmg = (enemy.maxHp * 0.07) / 3;
    skullShots++;
    ctx.projectiles.fire({ origin: _b.clone(), dir: _c.clone(), speed: 55, damage: dmg, team: 'player', owner: player, style: 'elven', gravity: 0 });
    player.camera.shake(0.35, 0.3);
    ctx.time.hitStop(0.05);
    if (skullShots >= 2) skullDone = true;
  }

  async function shakeOff(): Promise<void> {
    log('shake off');
    mode = 'fight';
    act = null;
    ctx.hud.setPrompt(null);
    ctx.input.setInteractLabel(null);
    level.objective('The troll is enraged: bring it down');
    enemy.aiEnabled = false;
    endStun();
    specialCd = 6;
    enemy.playPose?.('roar', 1.6);
    audio.play('troll_roar', { pos: enemy.position, volume: 1, pitch: 0.8 });
    player.camera.shake(0.7, 0.8);
    // thrown clear: land a few metres away, facing it
    forward(_a);
    _b.copy(enemy.position).addScaledVector(_a, 5.5);
    if (!clearFloor(_b)) _b.copy(enemy.position).addScaledVector(_a, -5.5);
    if (!clearFloor(_b)) _b.set(enemy.position.x, 0, enemy.position.z + 6);
    player.mover = null;
    player.teleport(new THREE.Vector3(_b.x, ctx.physics.heightAt(_b.x, _b.z), _b.z), yawOf(enemy.position.x - _b.x, enemy.position.z - _b.z));
    fx.dust(_b, 14);
    ctx.time.hitStop(0.1);
    stage = 2;
    enraged = true;
    setSpeed(enemy, baseSpeed * 1.25);
    await level.wait(1.7);
    if (mode === 'fight' && !act) enemy.aiEnabled = true;
  }

  function clearFloor(p: THREE.Vector3): boolean {
    for (const q of PILLARS) if (Math.abs(q.x - p.x) < PILLAR_HALF + 1 && Math.abs(q.z - p.z) < PILLAR_HALF + 1) return false;
    return Math.abs(p.z) < 28 && p.x > 14 && p.x < 116;
  }

  // ── final phase and the kill ────────────────────────────────────────────
  function startFinal(): void {
    log('final window');
    mode = 'final';
    pendingFinal = false;
    act = null;
    enemy.aiEnabled = false;
    enemy.moveTarget = null;
    freeze();
    finalWindow = true;
    finalT = 0;
    enemy.playPose?.('roar', 12);
    audio.play('troll_roar', { pos: enemy.position, volume: 1, pitch: 0.7 });
    ctx.time.setScale(0.4, 0.35);
    ctx.hud.setPrompt('draw', 'Loose an arrow into its mouth');
    level.objective('Its mouth is open: shoot it');
    void opts.say?.('Aragorn', 'Now, Legolas!', 1.8);
  }
  function endFinalWindow(): void {
    finalWindow = false;
    mode = 'fight';
    ctx.time.setScale(1, 0.5);
    ctx.hud.setPrompt(null);
    level.objective('The troll is enraged: bring it down');
    enemy.playPose?.('roar', 0.01);
    enemy.aiEnabled = true;
    finalCd = 8;
    specialCd = 3;
  }

  async function killCinematic(): Promise<void> {
    log('killed');
    mode = 'dying';
    ctx.hud.setPrompt(null);
    ctx.time.setScale(0.22, 0.08);
    audio.play('troll_roar', { pos: enemy.position, volume: 1, pitch: 0.6 });
    level.cinematic(true);
    level.cameraShot({ position: new THREE.Vector3(1.9, 3.1, 3.3), lookAt: new THREE.Vector3(0, 3.3, 0.1), fov: 38, blend: 0.15, follow: enemy.object });
    await level.wait(0.42);
    level.cameraShot({ position: new THREE.Vector3(5.5, 2.2, 7.5), lookAt: new THREE.Vector3(0, 1.8, 0), fov: 48, blend: 0.9, follow: enemy.object });
    await level.wait(0.5);
    ctx.time.setScale(1, 0.5);
    level.cameraShot(null);
    await level.wait(0.7);
    level.cinematic(false);
    mode = 'dead';
    resolveDone();
  }

  // ── main tick ───────────────────────────────────────────────────────────
  const stopTick = level.onUpdate((dt) => {
    // chains
    B.neck.getWorldPosition(collar.pinA);
    forward(_a);
    collar.pinA.addScaledVector(_a, -0.3);
    collar.pinA.y += 0.12;
    collar.floorY = enemy.position.y;
    collar.update(dt);
    for (const l of leashes) {
      l.anchor.getWorldPosition(l.chain.pinA);
      l.handler.humanoid.bones.hand_r.getWorldPosition(l.chain.pinB);
      l.chain.floorY = enemy.position.y;
      l.chain.update(dt);
    }
    if (marker.visible) {
      collar.tip(marker.position);
      marker.position.y = enemy.position.y + 0.55 + Math.sin(ctx.time.t * 4) * 0.08;
      (marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(ctx.time.t * 6);
      marker.scale.setScalar(1.0 + 0.25 * Math.sin(ctx.time.t * 6));
    }
    if (!enemy.alive && mode !== 'dying' && mode !== 'dead' && !killed) {
      // killed by something unexpected (a scripted kill): still finish cleanly
      killed = true;
      void killCinematic();
    }
    if (mode === 'idle' || mode === 'dying' || mode === 'dead') {
      lastX = enemy.position.x;
      lastZ = enemy.position.z;
      return;
    }

    if (mode === 'fight') {
      if (act?.kind === 'charge') updateCharge(act, dt);
      else if (act?.kind === 'throw') updateThrow(act, dt);
      if (pendingStun && !act) startStun(pendingStun);
      else if (pendingStun && act) {
        // a throw in progress finishes first; a charge hands over at once (the slam itself asked for it)
        if (act.kind === 'charge' && act.stage === 'recover') startStun(pendingStun);
      }
      // half health forces the stun if the player never gave it a reason
      fightT += dt;
      if (stage === 1 && !pendingStun && headHits >= 3 && fightT > 16) pendingStun = 'hits';
      if (stage === 1 && !pendingStun && mode === 'fight' && fightT > 8 && enemy.hp <= enemy.maxHp * 0.52) pendingStun = 'health';
      if (stage === 2 && !pendingFinal && enemy.hp <= enemy.maxHp * 0.14 && finalCd <= 0) pendingFinal = true;
      if (pendingFinal && !act && mode === 'fight') startFinal();
      finalCd -= dt;
      if (mode === 'fight' && !act) {
        specialCd -= dt;
        if (specialCd <= 0 && enemy.alive) {
          const d = playerDist();
          const g = goblinsNear(9).filter((x) => x.behavior !== 'hold')[0];
          if (g && (level.rng() < 0.5 || d < 9)) startThrow(g);
          else if (d > 8 && d < 28) startCharge();
          else specialCd = 1.5;
        }
      }
    } else if (mode === 'stunned') {
      stunT += dt;
      enemy.velocity.x = 0;
      enemy.velocity.z = 0;
      chainBase(_a);
      const near = Math.hypot(player.position.x - _a.x, player.position.z - _a.z) < 5.5 && !player.mover;
      ctx.hud.setPrompt(near ? 'interact' : null, 'Climb the chain');
      ctx.input.setInteractLabel(near ? 'Climb' : null);
      if (near && ctx.input.state.interact) {
        mode = 'climb';
        ctx.hud.setPrompt(null);
        ctx.input.setInteractLabel(null);
        skullShots = 0;
        log('climb');
        player.mover = makeClimb();
        audio.play('chain_rattle', { pos: _a, volume: 0.8, pitch: 1.2 });
      } else if (stunT > 20) {
        // too slow: it shakes itself awake
        endStun();
        mode = 'fight';
        headHits = 0;
        enemy.playPose?.('roar', 1.2);
        player.camera.shake(0.4, 0.6);
        audio.play('troll_roar', { pos: enemy.position, volume: 1 });
        enemy.aiEnabled = true;
        specialCd = 4;
        pendingStun = null;
        // it is still half health: it will fall again at the next pillar or three headshots
        level.objective('Bring down the cave troll');
        if (stage === 1) {
          enemy.hp = Math.max(enemy.hp, enemy.maxHp * 0.6);
        }
      }
    } else if (mode === 'climb' || mode === 'skull') {
      enemy.velocity.x = 0;
      enemy.velocity.z = 0;
      if (skullDone && shotCd < 0.1 && pendingShot < 0 && mode === 'skull') void shakeOff();
      if (!player.mover && mode === 'skull') {
        // the mover was replaced (a respawn rebuilds everything, so this is only a safety net)
        mode = 'fight';
        endStun();
        enemy.aiEnabled = true;
      }
    } else if (mode === 'final') {
      finalT += dt;
      freeze();
      faceTowards(player.position, clamp(dt * 3, 0, 1));
      enemy.playPose?.('roar', 1.0);
      if (finalT > 3.2 && finalWindow) endFinalWindow();
    }
    lastX = enemy.position.x;
    lastZ = enemy.position.z;
  });

  return {
    enemy,
    get mode() {
      return mode;
    },
    get stage() {
      return stage;
    },
    chainBase: (out) => (mode === 'stunned' || mode === 'climb' ? chainBase(out) : null),
    get chainReady() {
      return mode === 'stunned';
    },
    get wantsShot() {
      return mode === 'skull';
    },
    begin() {
      mode = 'fight';
      enemy.aiEnabled = true;
      specialCd = 6;
    },
    done,
    stun(reason) {
      if (mode === 'fight') pendingStun = reason;
    },
    attachLeash(handler, bone) {
      const chain = new RopeChain(12, 0.34);
      level.root.add(chain.object);
      B[bone].getWorldPosition(chain.pinA);
      handler.humanoid.bones.hand_r.getWorldPosition(chain.pinB);
      chain.usePinA = true;
      chain.usePinB = true;
      chain.reset();
      leashes.push({ chain, handler, anchor: B[bone] });
    },
    releaseLeashes() {
      const gone = leashes.splice(0, leashes.length);
      for (const l of gone) l.chain.usePinB = false;
      // keep updating the falling chains for a moment (they trail from the ankle), then clear them
      const stop = level.onUpdate((dt) => {
        for (const l of gone) {
          l.anchor.getWorldPosition(l.chain.pinA);
          l.chain.floorY = enemy.position.y;
          l.chain.update(dt);
        }
      });
      void level.wait(3.5).then(() => {
        stop();
        for (const l of gone) l.chain.dispose();
      });
    },
    dispose() {
      stopTick();
      collar.dispose();
      for (const l of leashes) l.chain.dispose();
    },
  };
}
