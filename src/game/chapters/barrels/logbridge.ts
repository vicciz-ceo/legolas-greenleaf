/**
 * The log bridge: the mini-boss of the rapids.
 *
 * A great fallen beech spans the chute high above the water, lashed to the cliffs at both ends. An
 * orc captain and his archers hold it. The river slows under it (the script eases the convoy), and:
 *
 *   - the archers shoot down at the barrels, the captain hurls axes (a roar, then a spinning axe at
 *     Legolas: hop to dodge);
 *   - the two LASHINGS at the log's ends are shootable (glowing, pitch-soaked rope). The first one
 *     makes the log sag, the second drops it into the river with everybody on it;
 *   - if the convoy reaches the log first, the crew drops onto the barrels beneath;
 *   - the captain survives the fall (a third of his life gone), hauls himself onto a barrel and
 *     fights Legolas there with a telegraphed overhead cleaver.
 */
import * as THREE from 'three';
import type { Combatant, DamageInfo, Enemy, LevelAPI } from '../../../core/types';
import { BaseCombatant } from '../../../actors/combatant';
import { createWeapon } from '../../../creatures/weapons';
import { ballisticDir } from '../../../combat/aim';
import { addColliders, fallenLog, plain } from '../../../world';
import { MeshKit } from '../../../world/util';
import { mat } from '../../../world';
import { clamp, smoothstep } from '../../../core/math';
import type { Gorge } from './world';
import type { BarrelTrain } from './train';
import type { RiverFoes } from './orcs';
import { S, flowSpeedAt, flowYaw, riverPos, tangentAt, waterY, widthAt } from './layout';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** a shootable rope lashing at one end of the log */
class Lashing extends BaseCombatant {
  readonly marker: THREE.Object3D;
  broken = false;
  constructor(pos: THREE.Vector3, readonly onBreak: (l: Lashing) => void, readonly level: LevelAPI) {
    super({ team: 'enemy', name: 'Rope lashing', maxHp: 55, radius: 0.5, height: 1.0, bloodKind: 'dark', countsForRivalry: false });
    this.object.position.copy(pos);
    const helper = new THREE.Object3D();
    helper.position.set(0, 0.5, 0);
    this.object.add(helper);
    this.addZoneSphere(helper, 0.62, 'weakpoint', 1);
    this.aimBone = helper;
    this.marker = helper;
    this.targetable = false;
    this.corpseTime = -1;
  }
  protected onDamaged(d: DamageInfo): void {
    const { fx, audio } = this.level.ctx;
    fx.debris(this.object.position, 5, 0x6a4a2a);
    if (d.point) fx.sparks(d.point, _a.set(0, 1, 0), 4);
    audio.play('arrow_hit_wood', { pos: this.object.position, volume: 0.9 });
  }
  protected onDied(): void {
    this.broken = true;
    this.level.ctx.audio.play('chain_rattle', { pos: this.object.position, volume: 1 });
    this.level.ctx.fx.debris(this.object.position, 14, 0x6a4a2a);
    this.onBreak(this);
  }
  update(dt: number): void {
    if (!this.alive) this.updateDeath(dt);
  }
}

export type LogPhase = 'idle' | 'crew' | 'sagging' | 'falling' | 'fallen' | 'done';

export interface LogBridge {
  readonly sLog: number;
  phase: LogPhase;
  captain: Enemy | null;
  /** 0..1 of the captain's life when alive */
  begin(): void;
  update(dt: number): void;
  /** the crew is dealt with: the log is down and the captain is dead (or never came) */
  readonly resolved: boolean;
  /** true when shooting the lashings is allowed (the convoy is still upstream of the log) */
  readonly lashingsLive: boolean;
}

export function createLogBridge(level: LevelAPI, gorge: Gorge, train: BarrelTrain, foes: RiverFoes): LogBridge {
  const { physics, fx, audio, player } = level.ctx;
  const sLog = S.log;
  const water = waterY(sLog);
  const yaw = flowYaw(sLog);
  const hw = widthAt(sLog) / 2;
  const topY = water + 6.1;

  // ── find where the cliffs reach the log's height on each side ──
  const edge = (side: -1 | 1): number => {
    for (let e = 0.5; e < 16; e += 0.25) {
      const p = riverPos(sLog, side * (hw + e));
      if (gorge.heightAt(p.x, p.z) >= topY - 0.4) return e;
    }
    return 6;
  };
  const eL = edge(-1);
  const eR = edge(1);
  const lL = -(hw + eL) - 0.9;
  const lR = hw + eR + 0.9;
  const length = lR - lL;
  const lMid = (lL + lR) / 2;
  const centre = riverPos(sLog, lMid, 0);
  centre.y = topY - 0.8;

  // ── the log ──
  const log = fallenLog(length, 0.8, 21, { mossy: true });
  const logRoot = new THREE.Group();
  logRoot.position.copy(centre);
  logRoot.rotation.y = yaw + Math.PI / 2;
  logRoot.add(log.object);
  level.root.add(logRoot);
  logRoot.updateMatrixWorld(true);
  // the fallenLog body sits at y = radius*0.9 above its origin: the collider top is ~1.75 r
  const handles = addColliders(physics, log.colliders, log.object);
  const logCol = handles[0];
  const colHalfY = log.colliders[0].kind === 'box' ? log.colliders[0].half[1] : 0.7;
  const colCenterY = log.colliders[0].kind === 'box' ? log.colliders[0].center[1] : 0.7;
  const surfaceY = centre.y + colCenterY + colHalfY;

  // ── lashings: rope bundles around each end, pitch-soaked and glowing once the fight starts ──
  const rope = plain(0x5a4426, { roughness: 1, key: 'lash' });
  const glow = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xff6a22, emissiveIntensity: 0, roughness: 0.8 });
  glow.userData.noAO = true;
  const kit = new MeshKit();
  const wood = mat('old_wood', { key: 'lash-wood', rgb: [0.8, 0.72, 0.6] });
  const ends: THREE.Vector3[] = [riverPos(sLog, lL + 1.4), riverPos(sLog, lR - 1.4)];
  const lashings: Lashing[] = [];
  const lashRoot = new THREE.Group();
  level.root.add(lashRoot);
  for (let i = 0; i < 2; i++) {
    const p = ends[i].clone();
    p.y = surfaceY - 1.0;
    // posts and wedges in the rock, a rope wrapped around the log end
    const g = new THREE.Group();
    g.position.copy(p);
    const k = new MeshKit();
    for (const sgn of [-1, 1]) k.cyl(wood, 0.12, 0.16, 1.7, 7, [sgn * 0.9, -0.35, 0], 1, { tilt: [0, sgn * 0.28] });
    g.add(k.build({ name: 'lash-posts' }));
    for (let r = 0; r < 4; r++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.07, 6, 18), r === 0 || r === 3 ? rope : glow);
      t.rotation.y = Math.PI / 2 + yaw * 0 + 0;
      t.position.set(0, 0.0, (r - 1.5) * 0.28);
      t.rotation.set(0, 0, 0);
      t.castShadow = true;
      g.add(t);
    }
    lashRoot.add(g);
    lashRoot.userData.groups = [...(lashRoot.userData.groups ?? []), g];
    const l = new Lashing(p.clone().setY(surfaceY - 0.9), () => onLashingBroken(), level);
    lashings.push(l);
    level.addCombatant(l);
    // the river's housekeeping sweeps far-away enemies: the lashings sit 100 m+ ahead of the player from the start
    foes.protect(l);
  }
  // orient each end bundle: the torus axis along the log (log axis = across the river)
  lashRoot.children.forEach((c) => (c.rotation.y = yaw));
  void kit;

  // ── state ──
  let phase: LogPhase = 'idle';
  let fallT = 0;
  let vy = 0;
  let sagT = 0;
  let wobble = 0;
  let sunk = 0;
  let drift = 0;
  let throwCd = 5;
  let roarT = -1;
  let captain: Enemy | null = null;
  let boarded = false;
  let boardT = -1;
  let glowT = 0;
  let resolved = false;
  let bossShown = false;
  let windowClosed = false;
  const crew: Enemy[] = [];
  const colPos = new THREE.Vector3();

  function onLashingBroken(): void {
    const broken = lashings.filter((l) => l.broken).length;
    if (broken === 1) {
      phase = 'sagging';
      sagT = 0;
      audio.play('stone_crumble', { pos: logRoot.position, volume: 0.9 });
      player.camera.shake(0.25, 0.5);
      level.ctx.hud.toast('The log is sagging. One more lashing!', 'info');
    } else if (broken >= 2 && phase !== 'falling' && phase !== 'fallen') {
      phase = 'falling';
      fallT = 0;
      vy = 0;
      audio.play('stone_crumble', { pos: logRoot.position, volume: 1 });
      audio.play('chain_rattle', { pos: logRoot.position, volume: 0.9 });
    }
  }

  function setGlow(v: number): void {
    glow.emissiveIntensity = v;
  }

  function spawnCrew(): void {
    // the captain in the middle, archers either side of him, one spare spear-carrier at each end
    const y = surfaceY + 0.02;
    const at = (u: number): THREE.Vector3 => riverPos(sLog, lMid + u, 0).setY(y);
    captain = foes.leaper('log', sLog, 0, { at: at(0), archetype: 'gundabad', boss: true, name: 'Orc Captain', hp: 300, behavior: 'hold', weapon: 'cleaver', waitAi: true, minLeadS: sLog + 3 });
    foes.protect(captain);
    crew.push(captain);
    const slots = [-4.2, -2.1, 2.2, 4.4];
    for (const u of slots) {
      const o = foes.leaper('log', sLog, 0, { at: at(u), archetype: 'orc_archer', behavior: 'hold', waitAi: true, minLeadS: sLog - 2.0 });
      crew.push(o);
    }
  }

  function throwAxe(): void {
    if (!captain || !captain.alive) return;
    const axe = createWeapon('axe', 9);
    axe.scale.setScalar(1.3);
    captain.aimPoint(_a);
    _a.y += 0.2;
    player.aimPoint(_b);
    // lead the player a little (he rides at the convoy's speed)
    _b.addScaledVector(player.velocity, 0.7);
    const dir = ballisticDir(_a, _b, 21, 18, _c);
    level.ctx.projectiles.throwObject({
      object: axe,
      origin: _a.clone(),
      velocity: dir.clone().multiplyScalar(21),
      damage: 20,
      team: 'enemy',
      owner: captain,
      radius: 0.5,
      onImpact: (p) => {
        fx.splash(_a.copy(p), 1.0);
      },
    });
    audio.play('sword_swing', { pos: captain.position, volume: 0.8, pitch: 0.7 });
  }

  function boardCaptain(): void {
    if (!captain || !captain.alive || boarded) return;
    boarded = true;
    // the nearest free barrel to Legolas, close enough to fight
    const b = train.nearest(player.position, (x) => x.rider === null && !x.smashed && Math.hypot(x.stand.x - player.position.x, x.stand.z - player.position.z) > 1.8);
    if (!b) {
      boarded = false;
      boardT = 1;
      return;
    }
    fx.splash(b.stand, 2.4);
    audio.play('splash', { pos: b.stand, volume: 1 });
    captain.hp = Math.max(captain.hp, captain.maxHp * 0.62);
    foes.adopt(captain, b);
    captain.playPose?.('roar', 1.4);
    void level.say('Orc', 'You cannot outrun the river, elf!', 2.4);
  }

  const bridge: LogBridge = {
    sLog,
    get phase() {
      return phase;
    },
    set phase(v) {
      phase = v;
    },
    get captain() {
      return captain;
    },
    get resolved() {
      return resolved;
    },
    get lashingsLive() {
      return phase === 'crew' || phase === 'sagging';
    },
    begin() {
      if (phase !== 'idle') return;
      phase = 'crew';
      spawnCrew();
      for (const l of lashings) l.targetable = true;
      level.objective('Shoot the glowing lashings to drop the log');
    },
    update(dt: number) {
      glowT += dt;
      // lashings only count while the convoy is still upstream (the log must not fall on the barrels)
      const live = phase === 'crew' || phase === 'sagging';
      const safe = train.leader().s < sLog - 4;
      for (const l of lashings) if (!l.broken) l.targetable = live && safe;
      setGlow(live && safe ? 1.2 + Math.sin(glowT * 5) * 0.8 : 0);
      if (live && !safe && !windowClosed) {
        // the convoy is under the log: too late to drop it, the crew will come down onto the barrels instead
        windowClosed = true;
        level.objective('Hold the barrels: the crew is dropping in');
      }
      if (phase === 'idle') return;
      // ── the boss bar: only while the fight is near ──
      if (captain && captain.alive) {
        const lead = train.leader().s;
        const riding = foes.riders().includes(captain);
        if (!bossShown && lead > sLog - 78) {
          bossShown = true;
          level.boss(captain, 'Orc Captain');
        } else if (bossShown && !riding && !boarded && lead > sLog + 62) {
          // the convoy is through and he stayed on his log: he is out of the story
          bossShown = false;
          level.boss(null);
          foes.drop(captain);
          captain = null;
          resolved = true;
        }
      }
      // ── the captain's axe ──
      if (captain && captain.alive && (phase === 'crew' || phase === 'sagging')) {
        throwCd -= dt;
        if (roarT < 0 && throwCd <= 0 && Math.hypot(captain.position.x - player.position.x, captain.position.z - player.position.z) < 34) {
          roarT = 0;
          captain.playPose?.('roar', 0.9);
          audio.play('uruk_roar', { pos: captain.position, volume: 0.9 });
        }
        if (roarT >= 0) {
          roarT += dt;
          if (roarT > 0.85) {
            roarT = -1;
            throwCd = 4.2 + level.rng() * 1.6;
            throwAxe();
          }
        }
      }
      // ── sag ──
      if (phase === 'sagging') {
        sagT += dt;
        const broken = lashings[0].broken ? 0 : 1;
        // the log tilts about the intact end
        const tilt = smoothstep(0, 1.4, sagT) * 0.06;
        logRoot.rotation.z = (broken === 0 ? 1 : -1) * tilt;
        wobble = Math.sin(sagT * 14) * 0.012 * Math.exp(-sagT * 1.5);
        logRoot.position.y = centre.y - smoothstep(0, 1.4, sagT) * 0.25 + wobble;
      }
      // ── the fall ──
      if (phase === 'falling') {
        fallT += dt;
        vy -= 22 * dt;
        logRoot.position.y += vy * dt;
        logRoot.rotation.z += dt * 0.35 * (lashings[0].broken ? 1 : -1);
        colPos.set(logRoot.position.x, logRoot.position.y, logRoot.position.z);
        logCol.setTransform(colPos, yaw + Math.PI / 2);
        logCol.velocity.set(0, vy, 0);
        if (logRoot.position.y <= water - 0.1) {
          phase = 'fallen';
          drift = 0;
          sunk = 0;
          logCol.enabled = false;
          player.camera.shake(0.55, 0.6);
          audio.play('splash', { pos: logRoot.position, volume: 1 });
          audio.play('explosion', { pos: logRoot.position, volume: 0.5, pitch: 0.7 });
          for (let i = -3; i <= 3; i++) fx.splash(riverPos(sLog, lMid + i * 2.4, 0, _a), 3.2);
          fx.debris(logRoot.position, 20, 0x5a4a30);
          boardT = 1.1;
          level.objective('Kill the Orc Captain');
        }
      }
      if (phase === 'fallen') {
        // swept downstream
        drift += dt;
        const v = flowSpeedAt(sLog + drift * 3) * 0.7;
        const along = tangentAt(sLog, _a);
        logRoot.position.x += along.x * v * dt;
        logRoot.position.z += along.z * v * dt;
        logRoot.position.y = water - 0.1 - sunk;
        sunk += dt * 0.12;
        logRoot.rotation.z += dt * 0.25;
        if (drift > 7) logRoot.visible = false;
        if (boardT >= 0) {
          boardT -= dt;
          if (boardT <= 0) boardCaptain();
        }
        void clamp;
      }
      // the crew that reached the barrels is tracked by RiverFoes; the log is resolved when the captain is dead
      if (!resolved && captain && !captain.alive) {
        resolved = true;
        phase = phase === 'fallen' ? 'done' : phase;
        level.boss(null);
      }
    },
  };
  void crew;
  void addColliders;
  void ({} as Combatant);
  return bridge;
}
