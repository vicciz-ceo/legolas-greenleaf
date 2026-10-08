/**
 * Bolg, son of Azog: the Lake-town boss.
 *
 * EnemySpec has no way to ask for the 'bolg' humanoid kind (the 'gundabad' archetype builds a
 * Gundabad orc), so Bolg is spawned as a 'gundabad' boss and his body is swapped for the real 'bolg'
 * humanoid right after (local workaround, reported as a blocker: an optional `EnemySpec.kind` would
 * remove it). The stock AI is switched OFF and this controller drives him with the scripting surface
 * (`attack`, `playPose`, `moveTarget`), so every move is telegraphed and readable:
 *
 *   mace combo     three swings (overhead, slash, backslash), the first one slow and heavy
 *   ground slam    mace raised ~1.2 s, a red ring on the planks, then a shockwave: jump it.
 *                  Planks near the impact are knocked loose (the player may fall in and swim)
 *   grab           he lunges and seizes you by the throat: mash melee to break free
 *   charge (2nd)   a roar and a red lane, then a rush along it. Sidestep: if he hits a post he is
 *                  stunned and takes extra damage
 *
 * `floor` is an HP fraction he cannot be taken below (the script ends the fight at 35 % with the
 * escape cinematic), and a fallen Bolg is hauled back onto the deck (he never drowns).
 */
import * as THREE from 'three';
import type { DamageInfo, Enemy, Humanoid, LevelAPI, PlayerAPI, PlayerMover } from '../../../core/types';
import type { BaseCombatant } from '../../../actors/combatant';
import { createHumanoid } from '../../../creatures/humanoid';
import { clamp, dirFromYaw, smoothstep, yawOf } from '../../../core/math';
import { D, DECKS, PLATFORMS, platformRect } from './layout';
import type { QuayDeck } from './quay';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

type Swappable = BaseCombatant & {
  body: Humanoid;
  motor?: { height: number; radius: number };
  facing: number;
  speedMax: number;
  wallT: number;
  atk: { phase: 'none' | 'windup' | 'strike' | 'recover' };
  faceToward(p: THREE.Vector3 | null): void;
};

export type BolgState = 'idle' | 'approach' | 'combo' | 'slam' | 'grabWind' | 'grabbed' | 'chargeWind' | 'charge' | 'stunned' | 'recover' | 'roar' | 'frozen';

export interface BolgBoss {
  readonly enemy: Enemy;
  /** HP fraction Bolg cannot be taken below */
  floor: number;
  readonly state: BolgState;
  readonly hpFrac: number;
  /** 1 (default), 2 below 66 % */
  readonly phase: 1 | 2;
  /** fires once when phase 2 begins */
  onPhase2: (() => void) | null;
  /** the grab mover is installed on the player */
  readonly grabbing: boolean;
  /** start a move now (test drivers and scripted moments); ignored while he is busy */
  force(move: 'combo' | 'slam' | 'grab' | 'charge'): void;
  /** stop attacking and stand still (cinematics) */
  freeze(): void;
  resume(): void;
  /** forget everything, hide the telegraphs */
  stop(): void;
}

export interface BolgOpts {
  maxHp: number;
  quay: QuayDeck;
  /** deck rectangle he must stay on (the quay) */
  arena: { x0: number; x1: number; z0: number; z1: number };
}

export function spawnBolg(level: LevelAPI, pos: THREE.Vector3, facing: number, o: BolgOpts): BolgBoss {
  const { ctx } = level;
  const player = ctx.player;
  const e = level.spawnEnemy(
    { archetype: 'gundabad', boss: true, name: 'Bolg', hp: o.maxHp, damage: 17, speed: 4.5, weapon: 'mace', scale: 1.3, countsForRivalry: false, seed: 77 },
    pos,
    facing,
  );
  const sw = e as unknown as Swappable;
  try {
    const bolg = createHumanoid({ kind: 'bolg', seed: 3, weapon: 'mace' });
    const old = sw.body;
    old.root.removeFromParent();
    old.dispose();
    sw.body = bolg;
    sw.object.add(bolg.root);
    sw.height = bolg.height;
    sw.radius = Math.max(0.5, bolg.height * 0.2);
    if (sw.motor) {
      sw.motor.height = bolg.height * 0.95;
      sw.motor.radius = sw.radius;
    }
    sw.clearZones();
    sw.buildHumanoidZones(bolg, { girth: 1.2 });
  } catch (err) {
    console.warn('[laketown] Bolg body swap failed, keeping the Gundabad body', err);
  }
  e.aiEnabled = false;
  (e as unknown as { countsForRivalry: boolean }).countsForRivalry = false;

  const baseSpeed = 4.6;
  sw.speedMax = baseSpeed;

  // ── telegraph decals: a ring for the slam, a lane for the charge ─────────
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4a24, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40, 1), ringMat);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 40), ringMat.clone());
  ring.rotation.x = disc.rotation.x = -Math.PI / 2;
  ring.visible = disc.visible = false;
  ring.userData.noAO = disc.userData.noAO = true;
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xff3a1c, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.visible = false;
  lane.userData.noAO = true;
  level.root.add(ring, disc, lane);

  const boss: BolgBoss = {
    enemy: e,
    floor: 0,
    get state() {
      return state;
    },
    get hpFrac() {
      return e.hp / e.maxHp;
    },
    get phase() {
      return phase;
    },
    onPhase2: null,
    get grabbing() {
      return grab !== null;
    },
    force(move) {
      if (state !== 'approach' && state !== 'recover' && state !== 'stunned') return;
      cancelAll();
      if (move === 'combo') beginCombo();
      else if (move === 'slam') beginSlam();
      else if (move === 'grab') beginGrab();
      else beginCharge();
    },
    freeze() {
      cancelAll();
      state = 'frozen';
    },
    resume() {
      if (state === 'frozen') {
        state = 'approach';
        t = 0;
        cd = 1.2;
      }
    },
    stop() {
      cancelAll();
      state = 'frozen';
      stopUpdate();
    },
  };

  let state: BolgState = 'approach';
  let phase: 1 | 2 = 1;
  let t = 0;
  let cd = 2.2;
  let comboIdx = 0;
  let swung = false;
  let prevAtkPhase: 'none' | 'windup' | 'strike' | 'recover' = 'none';
  let struck = false;
  let stunMul = 1;
  let hitPlayerThisCharge = false;
  let grab: (PlayerMover & { t: number; breaks: number; ticks: number }) | null = null;
  const impact = new THREE.Vector3();
  const chargeDir = new THREE.Vector3();
  const chargeEnd = new THREE.Vector3();
  let chargeLen = 0;
  let chargeBlocked = false;
  let roarT = 0;

  const arena = o.arena;
  const inArena = (x: number, z: number, m = 0) => x > arena.x0 + m && x < arena.x1 - m && z > arena.z0 + m && z < arena.z1 - m;

  // ── damage: the HP floor, and more damage while he is stunned ───────────
  const takeDamage = e.takeDamage.bind(e);
  e.takeDamage = (d: DamageInfo) => {
    if (e.alive && d.type !== 'scripted') {
      if (state === 'stunned') d = { ...d, amount: d.amount * 1.5 };
      if (boss.floor > 0) {
        const min = boss.floor * e.maxHp;
        const room = e.hp - min;
        if (room <= 0.5) {
          if (d.point) ctx.fx.sparks(d.point, _d.set(0, 1, 0), 3);
          return;
        }
        if (d.amount > room) d = { ...d, amount: room };
      }
    }
    takeDamage(d);
  };
  void stunMul;

  function flat(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function face(p: THREE.Vector3 | null): void {
    sw.faceToward(p);
  }

  function setRing(on: boolean, k = 0, x = 0, z = 0, radius = 4.2): void {
    ring.visible = disc.visible = on;
    if (!on) return;
    ring.position.set(x, D + 0.04, z);
    disc.position.set(x, D + 0.035, z);
    ring.scale.set(radius, radius, 1);
    disc.scale.set(radius * k, radius * k, 1);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 22);
    (disc.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.3 * k;
  }

  function setLane(on: boolean, k = 0): void {
    lane.visible = on;
    if (!on) return;
    lane.position.set((e.position.x + chargeEnd.x) / 2, D + 0.04, (e.position.z + chargeEnd.z) / 2);
    lane.rotation.set(-Math.PI / 2, 0, 0);
    lane.rotateZ(Math.atan2(chargeDir.x, chargeDir.z) + Math.PI);
    lane.scale.set(2.2, Math.max(0.5, chargeLen), 1);
    laneMat.opacity = 0.14 + 0.32 * k + 0.1 * Math.sin(t * 24);
  }

  function cancelAll(): void {
    setRing(false);
    setLane(false);
    ctx.hud.setPrompt(null);
    ctx.hud.setProgress(null);
    sw.faceToward(null);
    e.moveTarget = null;
    sw.speedMax = baseSpeed;
    if (grab && player.mover === grab) player.mover = null;
    grab = null;
    (e as unknown as { cancelAttack?: () => void }).cancelAttack?.();
  }

  // ── the grab ────────────────────────────────────────────────────────────
  function startGrab(): void {
    const breaksNeeded = 7;
    const g: PlayerMover & { t: number; breaks: number; ticks: number } = {
      t: 0,
      breaks: 0,
      ticks: 0,
      pose: 'hang',
      poseT: () => (g.t * 0.5) % 1,
      allowShoot: false,
      allowMelee: false,
      allowJump: false,
      allowDash: false,
      lockCameraYaw: false,
      camera: { distance: 4.6, height: 2.0, fov: 60 },
      update(dt, p, input) {
        g.t += dt;
        if (input.melee) g.breaks += 1;
        g.breaks = Math.max(0, g.breaks - dt * 0.9);
        // dangling in his fist, in front of him
        const f = dirFromYaw(sw.facing, _a);
        _b.set(e.position.x + f.x * 1.15, e.position.y + 0.55 + Math.sin(g.t * 9) * 0.04, e.position.z + f.z * 1.15);
        p.velocity.set(0, 0, 0);
        p.position.copy(_b);
        p.facing = sw.facing + Math.PI;
        // the squeeze
        g.ticks += dt;
        if (g.ticks > 0.7) {
          g.ticks = 0;
          p.takeDamage({ amount: 3, type: 'melee', source: e, point: _c.copy(p.position).setY(p.position.y + 1.4), dir: f.clone() });
        }
        ctx.hud.setProgress('Break free!', clamp(g.breaks / breaksNeeded, 0, 1));
        if (g.breaks >= breaksNeeded) endGrab(true);
        else if (g.t > 3.6) endGrab(false);
      },
    };
    grab = g;
    state = 'grabbed';
    t = 0;
    ctx.hud.setPrompt('melee', 'Mash to break free!');
    ctx.audio.play('orc_roar', { pos: e.position, volume: 1, pitch: 0.7 });
    ctx.audio.play('chain_rattle', { pos: player.position, volume: 0.6 });
    player.camera.shake(0.3, 0.4);
    player.mover = g;
  }

  function endGrab(freed: boolean): void {
    if (!grab) return;
    ctx.hud.setPrompt(null);
    ctx.hud.setProgress(null);
    const f = dirFromYaw(sw.facing, _a);
    if (player.mover === grab) player.mover = null;
    grab = null;
    // drop the player a step away from him
    _b.set(e.position.x + f.x * 2.6, D, e.position.z + f.z * 2.6);
    if (!inArena(_b.x, _b.z, 1.2)) _b.set(e.position.x - f.x * 2.6, D, e.position.z - f.z * 2.6);
    player.teleport(_b, sw.facing + Math.PI);
    if (freed) {
      // the knife in his wrist: he reels
      ctx.audio.play('knife_hit', { pos: e.position, volume: 1 });
      ctx.fx.blood(_c.copy(e.position).setY(e.position.y + 1.6), f, 'dark', 1.4);
      takeDamage({ amount: 40, type: 'melee', source: player, point: _c, dir: f.clone(), zone: 'limb' });
      e.playPose?.('stagger', 1.5);
      state = 'stunned';
      t = 0;
      ctx.hud.toast('Broke free!', 'info');
    } else {
      // thrown down hard
      player.takeDamage({ amount: 24, type: 'blunt', source: e, point: player.position, dir: f.clone(), knockback: 7, stagger: true });
      player.camera.shake(0.5, 0.5);
      ctx.audio.play('troll_hit', { pos: player.position, volume: 0.9 });
      state = 'recover';
      t = 0;
    }
    cd = 1.4;
  }

  // ── decisions ───────────────────────────────────────────────────────────
  function chooseAction(dist: number): void {
    const r = level.rng();
    if (dist > 6.5 && phase === 2 && r < 0.6) return beginCharge();
    if (dist > 5.4) return; // walk closer first
    if (dist > 3.6) {
      return r < 0.55 ? beginSlam() : void 0;
    }
    if (r < (phase === 1 ? 0.62 : 0.46)) return beginCombo();
    if (r < (phase === 1 ? 0.84 : 0.7)) return beginSlam();
    return beginGrab();
  }

  function beginCombo(): void {
    state = 'combo';
    comboIdx = 0;
    swung = false;
    t = 0;
  }

  function beginSlam(): void {
    state = 'slam';
    t = 0;
    struck = false;
    e.moveTarget = null;
    // the impact point is locked at the end of the wind-up from where he faces; track the player meanwhile
    e.attack?.('overhead', { windup: phase === 1 ? 1.25 : 1.0, target: null });
    ctx.hud.setPrompt('jump', 'Jump the shockwave!');
    ctx.audio.play('orc_roar', { pos: e.position, volume: 1, pitch: 0.62 });
  }

  function beginGrab(): void {
    state = 'grabWind';
    t = 0;
    struck = false;
    e.moveTarget = null;
    e.attack?.('thrust', { windup: 0.8, target: null });
    ctx.hud.setPrompt('jump', 'He reaches for you: leap clear!');
    ctx.audio.play('orc_roar', { pos: e.position, volume: 0.9, pitch: 0.8 });
  }

  function beginCharge(): void {
    state = 'chargeWind';
    t = 0;
    hitPlayerThisCharge = false;
    e.moveTarget = null;
    e.playPose?.('roar', 1.2);
    ctx.audio.play('uruk_roar', { pos: e.position, volume: 1, pitch: 0.6 });
    ctx.hud.setPrompt('jump', 'He charges: sidestep!');
    aimCharge();
  }

  /** lock the lane toward the player, stopping at a solid obstacle or the arena edge */
  function aimCharge(): void {
    chargeDir.set(player.position.x - e.position.x, 0, player.position.z - e.position.z).normalize();
    // how far can he run? first obstacle along the lane, or the arena rim
    _a.set(e.position.x, e.position.y + 1.0, e.position.z);
    const hit = ctx.physics.raycast(_a, chargeDir, 16, 'all');
    let len = 16;
    chargeBlocked = false;
    if (hit && hit.normal.y < 0.6) {
      len = Math.max(2, hit.t - 1.0);
      chargeBlocked = true;
    }
    // keep the end inside the arena
    for (let s = len; s > 2; s -= 0.5) {
      if (inArena(e.position.x + chargeDir.x * s, e.position.z + chargeDir.z * s, 1.6)) {
        if (s < len) chargeBlocked = false;
        len = s;
        break;
      }
      len = s - 0.5;
    }
    chargeLen = Math.max(2, len);
    chargeEnd.set(e.position.x + chargeDir.x * chargeLen, D, e.position.z + chargeDir.z * chargeLen);
  }

  // ── per-step ────────────────────────────────────────────────────────────
  const stopUpdate = level.onUpdate((dt) => {
    if (!e.alive) {
      cancelAll();
      return;
    }
    // he never drowns: back onto the planks
    if (e.position.y < D - 0.9) {
      e.object.position.set(clamp(e.position.x, arena.x0 + 3, arena.x1 - 3), D + 0.1, clamp(e.position.z, arena.z0 + 3, arena.z1 - 3));
      e.velocity.set(0, 0, 0);
      ctx.fx.splash(_a.set(e.position.x, 0, e.position.z), 1.6);
    }
    if (boss.floor > 0 && e.hp < boss.floor * e.maxHp) e.hp = boss.floor * e.maxHp;
    // phase 2
    if (phase === 1 && e.hp < e.maxHp * 0.66 && state !== 'frozen' && state !== 'grabbed') {
      phase = 2;
      cancelAll();
      state = 'roar';
      t = 0;
      roarT = 1.8;
      e.playPose?.('roar', 1.8);
      ctx.audio.play('uruk_roar', { pos: e.position, volume: 1.1, pitch: 0.55 });
      ctx.audio.play('horn_orc', { volume: 0.7 });
      player.camera.shake(0.35, 0.8);
      boss.onPhase2?.();
    }
    t += dt;
    const atkPhase = sw.atk.phase;
    const strikeNow = atkPhase === 'strike' && prevAtkPhase !== 'strike';
    prevAtkPhase = atkPhase;
    const dist = flat(e.position, player.position);
    const rate = phase === 2 ? 1.15 : 1;
    const alive = player.alive;
    if (!alive && state !== 'frozen') {
      // the player is down: stand and wait
      e.moveTarget = null;
      return;
    }
    switch (state) {
      case 'frozen':
      case 'idle':
        break;
      case 'roar':
        face(player.position);
        if (t >= roarT) {
          state = 'approach';
          t = 0;
          cd = 0.6;
        }
        break;
      case 'approach': {
        sw.speedMax = baseSpeed * (phase === 2 ? 1.18 : 1);
        face(null);
        // stop at mace range from the player
        _a.set(player.position.x - e.position.x, 0, player.position.z - e.position.z).normalize();
        e.moveTarget = _b.set(player.position.x - _a.x * 2.3, e.position.y, player.position.z - _a.z * 2.3);
        if (!inArena(_b.x, _b.z, 1.0)) e.moveTarget = null;
        cd -= dt * rate;
        if (cd <= 0 && !e.attacking && player.mover === null) {
          chooseAction(dist);
          if (state === 'approach') cd = 0.35;
        }
        break;
      }
      case 'combo': {
        e.moveTarget = _b.set(player.position.x, e.position.y, player.position.z);
        sw.speedMax = baseSpeed * 0.9;
        const kinds = ['overhead', 'slash', 'backslash'] as const;
        const wind = [phase === 1 ? 0.95 : 0.8, phase === 1 ? 0.6 : 0.5, phase === 1 ? 0.6 : 0.48];
        if (!swung && !e.attacking && t > 0.08) {
          if (comboIdx >= kinds.length) {
            state = 'recover';
            t = 0;
            e.moveTarget = null;
            cd = phase === 1 ? 1.5 : 1.0;
            break;
          }
          if (dist > 4.6) {
            // too far: the combo fizzles into a lunge
            state = 'approach';
            cd = 0.2;
            break;
          }
          e.attack?.(kinds[comboIdx], { windup: wind[comboIdx] });
          swung = true;
          if (comboIdx === 0) ctx.audio.play('orc_roar', { pos: e.position, volume: 0.8, pitch: 0.7 });
        }
        if (swung && !e.attacking) {
          swung = false;
          comboIdx++;
          t = 0;
        }
        break;
      }
      case 'recover':
        e.moveTarget = null;
        face(player.position);
        if (t > 0.9) {
          state = 'approach';
          t = 0;
        }
        break;
      case 'slam': {
        // aim: the impact point is ahead of him, locked at the last 0.35 s
        const wind = phase === 1 ? 1.25 : 1.0;
        if (!struck && t < wind - 0.35) face(player.position);
        dirFromYaw(sw.facing, _a);
        impact.set(e.position.x + _a.x * 2.6, D, e.position.z + _a.z * 2.6);
        if (!struck) setRing(true, clamp(t / wind, 0, 1), impact.x, impact.z, 4.4);
        if (strikeNow && !struck) {
          struck = true;
          slamHit();
        }
        if (struck && !e.attacking) {
          state = 'recover';
          t = 0;
          cd = 1.2;
          setRing(false);
          ctx.hud.setPrompt(null);
        }
        break;
      }
      case 'grabWind': {
        if (t < 0.5) face(player.position);
        if (strikeNow && !struck) {
          struck = true;
          dirFromYaw(sw.facing, _a);
          _b.set(player.position.x - e.position.x, 0, player.position.z - e.position.z);
          const reach = _b.length();
          const cone = Math.abs(Math.atan2(_b.x * _a.z - _b.z * _a.x, _b.x * _a.x + _b.z * _a.z));
          const airborne = player.position.y > e.position.y + 0.7;
          ctx.hud.setPrompt(null);
          if (reach < 3.6 && cone < 0.9 && !airborne && player.alive && !player.mover) startGrab();
        }
        if (struck && !e.attacking && state === 'grabWind') {
          // missed: he overreaches, a free opening
          state = 'recover';
          t = 0;
          cd = 1.3;
          e.playPose?.('stagger', 0.9);
        }
        break;
      }
      case 'grabbed':
        // frozen in place while the player's mover runs
        e.moveTarget = null;
        break;
      case 'chargeWind': {
        face(null);
        // track for the first 0.7 s, then the lane is locked
        if (t < 0.7) aimCharge();
        setLane(true, smoothstep(0, 1.1, t));
        sw.faceToward(_b.copy(e.position).addScaledVector(chargeDir, 3));
        if (t >= 1.15) {
          state = 'charge';
          t = 0;
          sw.faceToward(null);
          ctx.hud.setPrompt(null);
          ctx.audio.play('orc_roar', { pos: e.position, volume: 1, pitch: 0.9 });
          e.moveTarget = chargeEnd;
          sw.speedMax = 18;
        }
        break;
      }
      case 'charge': {
        setLane(true, 1);
        e.moveTarget = chargeEnd;
        // trample
        if (!hitPlayerThisCharge && player.alive && !player.mover && flat(e.position, player.position) < 1.7 && Math.abs(player.position.y - e.position.y) < 1.4) {
          hitPlayerThisCharge = true;
          _a.copy(chargeDir);
          player.takeDamage({ amount: 28, type: 'blunt', source: e, point: player.position, dir: _a.clone(), knockback: 10, stagger: true });
          player.camera.shake(0.5, 0.5);
        }
        const arrived = flat(e.position, chargeEnd) < 0.9;
        const crashed = chargeBlocked && sw.wallT < 0.12 && t > 0.3;
        if (crashed || arrived || t > 2.2) {
          sw.speedMax = baseSpeed;
          e.moveTarget = null;
          setLane(false);
          if (crashed || (chargeBlocked && flat(e.position, chargeEnd) < 2.5)) {
            // into the post: stunned
            state = 'stunned';
            t = 0;
            e.playPose?.('stagger', 2.6);
            ctx.audio.play('troll_hit', { pos: e.position, volume: 1, pitch: 0.7 });
            ctx.audio.play('stone_crumble', { pos: e.position, volume: 0.8 });
            ctx.fx.debris(_a.copy(e.position).setY(e.position.y + 1.4), 12, 0x7a6a58);
            player.camera.shake(0.45, 0.6);
            ctx.hud.toast('He is stunned: shoot him!', 'info');
          } else {
            state = 'recover';
            t = 0;
          }
          cd = 1.2;
        }
        break;
      }
      case 'stunned':
        e.moveTarget = null;
        if (t > 2.6) {
          state = 'approach';
          t = 0;
          cd = 0.5;
        }
        break;
    }
  });

  function slamHit(): void {
    ring.visible = disc.visible = false;
    ctx.hud.setPrompt(null);
    ctx.audio.play('troll_hit', { pos: impact, volume: 1, pitch: 0.75 });
    ctx.audio.play('stone_crumble', { pos: impact, volume: 1 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.fx.dust(_a.set(impact.x + Math.cos(a) * 2.6, D + 0.1, impact.z + Math.sin(a) * 2.6), 4, 0x8a8a90);
    }
    ctx.fx.debris(impact, 14, 0x6a5848);
    const pd = flat(player.position, impact);
    player.camera.shake(0.3 + 0.5 * Math.max(0, 1 - pd / 14), 0.55);
    if (pd < 4.4 && player.alive && !player.mover && player.position.y < D + 0.55) {
      _a.set(player.position.x - impact.x, 0, player.position.z - impact.z).normalize();
      player.takeDamage({ amount: 24, type: 'blunt', source: e, point: player.position, dir: _a.clone(), knockback: 7, stagger: true });
    }
    // planks knocked loose around the impact (never under Bolg himself)
    o.quay.breakAt(impact.x, impact.z, 4.6, phase === 1 ? 2 : 3, { x: e.position.x, z: e.position.z, r: 2.6 });
  }

  return boss;
}

void DECKS;
void PLATFORMS;
void platformRect;
void yawOf;
