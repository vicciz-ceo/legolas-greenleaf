/**
 * Mirkwood spiders as Combatants (BaseCombatant + bone hit zones), plus their web-spit projectiles,
 * the "webbed" slow on Legolas, and the glowing web anchors of the Brood Mother fight.
 *
 * A Spider moves in one of four modes:
 *   hang    descending from the canopy on a silk thread (head down), flips onto its feet to land
 *   climb   crawling head-first down (or up) a trunk along probed bark points
 *   ground  hunting: circles its prey, rears up and lunges to bite, or spits web from range
 *   air     falling or leaping (ballistic)
 *
 * The Brood Mother (`BroodMother`) adds a boss brain: leg-stab combo, web-spit volley, telegraphed
 * leap slam, spiderling summons, climbing into the canopy web and being dropped out of it.
 */
import * as THREE from 'three';
import type { Combatant, DamageInfo, LevelAPI } from '../../../core/types';
import { BaseCombatant, ZONE_MULT, hostile } from '../../../actors/combatant';
import { requestAttackToken, releaseAttackToken } from '../../../actors/npc';
import { DIFFICULTY } from '../../../actors/enemy';
import { clamp, damp, dampAngle, wrapAngle, yawOf } from '../../../core/math';
import { Rng, hashSeed } from '../../../core/rng';
import { createSpiderModel, makeSpiderPose, spiderGaitFreq, type SpiderModel, type SpiderPose, type SpiderVariant } from '../../../creatures/spider';

const GRAV = 22;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _cam = new THREE.Vector3();

/** quaternion for a creature whose +Z is `fwd` and +Y is `up` (both world) */
function basis(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _up.copy(up).normalize();
  _fwd.copy(fwd).addScaledVector(_up, -fwd.dot(_up));
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1).addScaledVector(_up, -_up.z);
  _fwd.normalize();
  _left.crossVectors(_up, _fwd);
  _m.makeBasis(_left, _up, _fwd);
  return out.setFromRotationMatrix(_m);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared resources (cached, flagged shared: they outlive a level)
// ─────────────────────────────────────────────────────────────────────────────

let threadGeo: THREE.BufferGeometry | null = null;
let threadMat: THREE.Material | null = null;
let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.Material | null = null;

function threadRes() {
  if (!threadGeo) {
    threadGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    threadGeo.userData.shared = true;
  }
  if (!threadMat) {
    threadMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.4, emissive: 0x202020, transparent: true, opacity: 0.85 });
    threadMat.userData.shared = true;
  }
  return { geo: threadGeo, mat: threadMat };
}

function blobRes() {
  if (!blobGeo) {
    const g = new THREE.IcosahedronGeometry(0.2, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      const n = 1 + 0.22 * Math.sin(_v.x * 31 + _v.y * 17) * Math.cos(_v.z * 23 - _v.x * 11);
      _v.multiplyScalar(n);
      p.setXYZ(i, _v.x, _v.y, _v.z * 1.25);
    }
    g.computeVertexNormals();
    // trailing strands
    const tail = new THREE.ConeGeometry(0.09, 0.9, 6, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.55);
    const merged = mergeTwo(g.toNonIndexed(), tail.toNonIndexed());
    g.dispose();
    tail.dispose();
    blobGeo = merged;
    blobGeo.userData.shared = true;
  }
  if (!blobMat) {
    blobMat = new THREE.MeshPhysicalMaterial({ color: 0xe6e2d6, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0xffffff), transparent: true, opacity: 0.92, emissive: 0x2a2a26 });
    blobMat.userData.shared = true;
  }
  return { geo: blobGeo, mat: blobMat };
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.attributes.position.array as Float32Array;
  const pb = b.attributes.position.array as Float32Array;
  const na = a.attributes.normal.array as Float32Array;
  const nb = b.attributes.normal.array as Float32Array;
  const pos = new Float32Array(pa.length + pb.length);
  const nor = new Float32Array(na.length + nb.length);
  pos.set(pa);
  pos.set(pb, pa.length);
  nor.set(na);
  nor.set(nb, na.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  a.dispose();
  b.dispose();
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Web spit + the "webbed" slow
// ─────────────────────────────────────────────────────────────────────────────

interface Blob {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  owner: Combatant;
}

export class WebSystem {
  private readonly blobs: Blob[] = [];
  private slowT = 0;
  private baseSpeed = 0;
  private slowStats: { moveSpeed: number } | null = null;
  private wrap: THREE.Mesh | null = null;
  private toastT = 0;
  /** total webbed seconds (diagnostics) */
  webbedFor = 0;

  constructor(private readonly level: LevelAPI) {
    level.onUpdate((dt) => this.update(dt));
  }

  get webbed(): boolean {
    return this.slowT > 0;
  }

  /** fire a web blob from `origin` at a target (leads the target a little) */
  spit(owner: Combatant, origin: THREE.Vector3, target: Combatant, speed = 19, spreadYaw = 0, damage = 5): void {
    const { geo, mat } = blobRes();
    const tp = _v.copy(target.position);
    tp.y += Math.min(1.2, target.height * 0.55);
    const dist = origin.distanceTo(tp);
    const T = clamp(dist / speed, 0.25, 1.6);
    tp.addScaledVector(target.velocity, T * 0.6);
    const vel = new THREE.Vector3().subVectors(tp, origin).divideScalar(T);
    vel.y += 0.5 * 12 * T;
    if (spreadYaw) vel.applyAxisAngle(_up.set(0, 1, 0), spreadYaw);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.castShadow = false;
    this.level.root.add(mesh);
    this.blobs.push({ mesh, pos: origin.clone(), vel, life: 0, damage, owner });
    this.level.ctx.audio.play('web_tear', { pos: origin, volume: 0.55, pitch: 1.5 });
  }

  /** web Legolas: 50 % speed for 2 s */
  webPlayer(seconds = 2): void {
    const player = this.level.ctx.player;
    const stats = player.stats as { moveSpeed: number };
    if (this.slowT <= 0 || this.slowStats !== stats) {
      this.restore();
      this.slowStats = stats;
      this.baseSpeed = stats.moveSpeed;
      stats.moveSpeed = this.baseSpeed * 0.5;
    }
    this.slowT = Math.max(this.slowT, seconds);
    if (!this.wrap) {
      const { geo, mat } = blobRes();
      this.wrap = new THREE.Mesh(geo, mat);
      this.wrap.scale.set(2.2, 1.6, 1.4);
      this.wrap.position.set(0, -0.1, 0.12);
      player.humanoid.bones.hips.add(this.wrap);
    }
    this.wrap.visible = true;
    if (this.toastT <= 0) {
      this.level.ctx.hud.toast('Webbed! Slowed', 'warning');
      this.toastT = 5;
    }
  }

  private restore(): void {
    if (this.slowStats && this.slowStats === this.level.ctx.player.stats) this.slowStats.moveSpeed = this.baseSpeed;
    this.slowStats = null;
  }

  private update(dt: number): void {
    const { ctx } = this.level;
    this.toastT -= dt;
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.webbedFor += dt;
      if (this.slowT <= 0) {
        this.restore();
        if (this.wrap) this.wrap.visible = false;
      }
    }
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.life += dt;
      _v2.copy(b.pos);
      b.vel.y -= 12 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.setFromUnitVectors(_up.set(0, 0, 1), _v3.copy(b.vel).normalize());
      b.mesh.scale.setScalar(Math.min(1, 0.4 + b.life * 3));
      let done = b.life > 3;
      // hit a character?
      for (const c of ctx.combatants.all()) {
        if (!c.alive || !hostile(b.owner.team, c.team)) continue;
        const dx = b.pos.x - c.position.x;
        const dz = b.pos.z - c.position.z;
        const dy = b.pos.y - c.position.y;
        if (dx * dx + dz * dz > (c.radius + 0.35) ** 2 || dy < -0.2 || dy > c.height + 0.2) continue;
        c.takeDamage({ amount: b.damage, type: 'blunt', source: b.owner, point: b.pos.clone(), dir: _v3.copy(b.vel).normalize().clone(), knockback: 1.5 });
        if (c === ctx.player) this.webPlayer(2);
        ctx.fx.dust(b.pos, 6, 0xe8e4d8);
        ctx.audio.play('web_tear', { pos: b.pos, volume: 0.8, pitch: 0.9 });
        done = true;
        break;
      }
      if (!done) {
        // world: trunks, rocks, ground
        _v3.subVectors(b.pos, _v2);
        const len = _v3.length();
        if (len > 1e-4) {
          _v3.divideScalar(len);
          const hit = ctx.physics.raycast(_v2, _v3, len, 'arrows');
          if (hit || b.pos.y < ctx.physics.heightAt(b.pos.x, b.pos.z) + 0.05) {
            ctx.fx.dust(hit ? hit.point : b.pos, 5, 0xe0dccf);
            done = true;
          }
        }
      }
      if (done) {
        b.mesh.removeFromParent();
        this.blobs.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.restore();
    this.wrap?.removeFromParent();
    for (const b of this.blobs) b.mesh.removeFromParent();
    this.blobs.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spider
// ─────────────────────────────────────────────────────────────────────────────

export type SpiderMode = 'hang' | 'climb' | 'ground' | 'air' | 'ceiling';
type Act = 'hunt' | 'windup' | 'lunge' | 'recover' | 'spitwind' | 'spitrec' | 'stagger' | 'dart' | 'idle';

export interface SpiderOpts {
  variant?: SpiderVariant;
  /** uniform size on top of the variant (spiderlings 0.55) */
  size?: number;
  seed?: number;
  hp?: number;
  damage?: number;
  speed?: number;
  /** keeps its distance and spits web */
  spitter?: boolean;
  name?: string;
}

export interface ClimbPoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

export class Spider extends BaseCombatant {
  readonly model: SpiderModel;
  readonly level: LevelAPI;
  readonly webs: WebSystem;
  readonly S: number; // world scale of the model
  readonly size: number;
  mode: SpiderMode = 'ground';
  aiEnabled = true;
  protected act: Act = 'hunt';
  protected actT = 0;
  protected readonly pose: SpiderPose = makeSpiderPose();
  protected facing = 0;
  protected readonly upN = new THREE.Vector3(0, 1, 0);
  protected readonly rng: Rng;
  protected readonly diff: (typeof DIFFICULTY)['normal'];
  protected target: Combatant | null = null;
  protected targetT = 0;
  protected speedMax: number;
  protected damage: number;
  readonly spitter: boolean;
  private orbitA = 0;
  private orbitT = 0;
  private orbitR = 2.4;
  private spitCd = 3;
  private token = false;
  protected flashT = 0;
  private sinkY = 0;
  private animSkip = 0;
  // hang
  private anchor = new THREE.Vector3();
  private thread: THREE.Mesh | null = null;
  private threadRetract = -1;
  private hangSpeed = 5;
  private flipT = -1;
  private readonly flipFrom = new THREE.Quaternion();
  // climb
  private path: ClimbPoint[] = [];
  private pathS = 0;
  private pathLen: number[] = [];
  private climbDir = 1;
  private climbWrap = 2.2;
  private climbHold = false;
  private onClimbDone: (() => void) | null = null;
  private landT = -1;
  private readonly landFrom = new THREE.Vector3();
  private readonly landTo = new THREE.Vector3();
  // air
  protected readonly airVel = new THREE.Vector3();
  protected onLand: (() => void) | null = null;
  protected lungeHit = false;

  constructor(level: LevelAPI, webs: WebSystem, o: SpiderOpts = {}) {
    const variant = o.variant ?? 'spider';
    const size = o.size ?? 1;
    const model = createSpiderModel(variant, o.seed ?? 0);
    const S = model.scale * size;
    const diff = DIFFICULTY[level.ctx.settings.difficulty] ?? DIFFICULTY.normal;
    super({
      team: 'enemy',
      name: o.name ?? (size < 0.8 ? 'Spiderling' : 'Spider'),
      maxHp: Math.round((o.hp ?? 70) * diff.hp),
      radius: 0.62 * S,
      height: 0.95 * S,
      bloodKind: 'ichor',
      countsForRivalry: true,
    });
    this.level = level;
    this.webs = webs;
    this.model = model;
    this.S = S;
    this.size = size;
    this.diff = diff;
    this.rng = new Rng(hashSeed('spider', this.id, o.seed ?? 0));
    this.speedMax = (o.speed ?? 5.6) * diff.speed;
    this.damage = (o.damage ?? 13) * diff.dmg;
    this.spitter = !!o.spitter;
    model.object.scale.setScalar(size);
    this.object.add(model.object);
    this.flashColor = 0x8ab060;
    this.corpseTime = 7;
    this.orbitA = this.rng.float() * Math.PI * 2;
    this.orbitR = this.spitter ? 10 + this.rng.float() * 4 : 2.2 + this.rng.float() * 1.2;
    this.spitCd = 2 + this.rng.float() * 3;
    this.buildZones();
  }

  protected buildZones(): void {
    const b = this.model.bones;
    const S = this.S;
    this.addZoneSphere(b.body, 0.25 * S, 'body', 1, new THREE.Vector3(0, 0.03, 0.0).multiplyScalar(S));
    this.addZoneSphere(b.body, 0.11 * S, 'head', ZONE_MULT.head, new THREE.Vector3(0, 0.08, 0.27).multiplyScalar(S / this.size));
    this.addZoneSphere(b.abdomen, 0.36 * S, 'body', 1, new THREE.Vector3(0, 0.14, -0.46).multiplyScalar(S / this.size));
    for (const i of [0, 1, 2, 3]) for (const s of ['l', 'r']) {
      this.addZoneCapsule(b[`leg${i}a_${s}`], b[`leg${i}b_${s}`], 0.06 * S, 'limb', ZONE_MULT.limb);
      this.addZoneCapsule(b[`leg${i}b_${s}`], b[`leg${i}c_${s}`], 0.05 * S, 'limb', ZONE_MULT.limb);
    }
    this.aimBone = b.body;
  }

  // ── spawning ───────────────────────────────────────────────────────────────
  /** start hanging from `anchor` (a canopy point) at `startY`, descending */
  descendFrom(anchor: THREE.Vector3, startY: number, speed = 5): void {
    this.mode = 'hang';
    this.anchor.copy(anchor);
    this.hangSpeed = speed;
    this.object.position.set(anchor.x, startY, anchor.z);
    const { geo, mat } = threadRes();
    this.thread = new THREE.Mesh(geo, mat);
    this.thread.castShadow = false;
    this.thread.name = 'silk_thread';
    this.level.root.add(this.thread);
    this.updateThread();
    this.level.ctx.audio.play('spider_hiss', { pos: this.object.position, volume: 0.5, pitch: 1.2 / Math.sqrt(this.size) });
  }

  /** crawl along trunk points (dir 1: from path[0] to the end), then step down onto the ground */
  climbAlong(path: ClimbPoint[], dir = 1, onDone: (() => void) | null = null, wrap = 2.2): void {
    this.mode = 'climb';
    this.climbWrap = wrap;
    this.climbHold = false;
    this.landT = -1;
    this.path = path;
    this.climbDir = dir;
    this.onClimbDone = onDone;
    this.pathLen = [0];
    for (let i = 1; i < path.length; i++) this.pathLen.push(this.pathLen[i - 1] + path[i].p.distanceTo(path[i - 1].p));
    this.pathS = dir > 0 ? 0 : this.pathLen[this.pathLen.length - 1];
    this.placeOnPath();
  }

  /** ballistic leap to a point (lands with onLand) */
  leapTo(p: THREE.Vector3, T: number, onLand: (() => void) | null = null): void {
    this.mode = 'air';
    const pos = this.object.position;
    this.airVel.set((p.x - pos.x) / T, (p.y - pos.y + 0.5 * GRAV * T * T) / T, (p.z - pos.z) / T);
    this.onLand = onLand;
  }

  // ── damage ─────────────────────────────────────────────────────────────────
  protected onDamaged(d: DamageInfo, amount: number): void {
    this.flashT = 1;
    if (this.mode !== 'ground' || !this.alive) return;
    if ((d.stagger || amount > this.maxHp * 0.4) && this.act !== 'lunge' && this.size >= 0.8) this.setAct('stagger', 0.45);
    else if (this.act === 'hunt' && this.rng.chance(0.3)) this.setAct('dart', 0.35 + this.rng.float() * 0.2);
  }

  protected onDied(): void {
    const { ctx } = this.level;
    this.releaseToken();
    ctx.audio.play('spider_die', { pos: this.object.position, volume: 0.9, pitch: 1 / Math.sqrt(this.size) });
    this.aimPoint(_v);
    ctx.fx.blood(_v, _up.set(0, 1, 0), 'ichor', 2.2 * this.size);
    if (this.mode === 'hang' || this.mode === 'climb' || this.mode === 'ceiling') {
      this.mode = 'air';
      this.airVel.set(0, 0, 0);
      if (this.thread) this.threadRetract = 0;
    }
  }

  // ── per frame ──────────────────────────────────────────────────────────────
  update(dt: number): void {
    const { ctx } = this.level;
    const p = this.pose;
    p.t += dt;
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 8);
      const m = this.model.creature.material;
      m.emissive.setHex(this.flashColor);
      m.emissiveIntensity = this.flashT * 0.22;
    }
    this.hitReact = Math.max(0, this.hitReact - dt * 4);
    p.hit = this.hitReact;
    if (this.thread) this.updateThread(dt);

    switch (this.mode) {
      case 'hang': this.updateHang(dt); break;
      case 'climb': this.updateClimb(dt); break;
      case 'air': this.updateAir(dt); break;
      case 'ceiling': this.updateCeiling(dt); break;
      default: this.updateGround(dt); break;
    }

    if (!this.alive) {
      p.curl = Math.min(1, p.curl + dt / 0.9);
      p.rear = damp(p.rear, 0, 8, dt);
      p.strike = 0;
      p.hang = damp(p.hang, 0, 5, dt);
      p.speed = 0;
      p.turn = 0;
      this.updateDeath(dt);
      if (this.deathTime > this.corpseTime) {
        this.sinkY += dt * 0.5;
        this.model.object.position.y = -this.sinkY * this.S;
        if (this.sinkY > 0.05) this.model.setShadows(false);
      }
    }
    this.animate(dt);
  }

  private animate(dt: number): void {
    // cheaper animation far away / off screen
    const cam = this.level.ctx.engine.camera;
    cam.getWorldPosition(_cam);
    const d2 = _cam.distanceToSquared(this.object.position);
    this.animSkip++;
    let every = d2 > 45 * 45 ? 3 : d2 > 28 * 28 ? 2 : 1;
    _v.copy(this.object.position).sub(_cam);
    cam.getWorldDirection(_v2);
    if (_v.dot(_v2) < -2) every = Math.max(every, 4);
    this.model.setShadows(this.sinkY <= 0.05 && d2 < 34 * 34);
    this.model.setDetail(d2 < (this.size < 0.8 ? 8 * 8 : 22 * 22));
    if (this.animSkip % every !== 0) return;
    this.model.apply(this.pose, dt * every);
    this.afterAnimate();
  }

  // ── hang ──────────────────────────────────────────────────────────────────
  private updateThread(dt = 0): void {
    const th = this.thread!;
    // spinneret in world space
    this.object.updateMatrixWorld(true);
    _v.copy(this.model.spinneret).multiplyScalar(this.size).applyMatrix4(this.object.matrixWorld);
    if (this.threadRetract >= 0) {
      this.threadRetract += dt;
      _v.lerp(this.anchor, Math.min(1, this.threadRetract * 1.4));
      if (this.threadRetract > 0.75) {
        th.removeFromParent();
        this.thread = null;
        return;
      }
    }
    const len = Math.max(0.01, this.anchor.distanceTo(_v));
    th.position.copy(_v);
    th.quaternion.setFromUnitVectors(_up.set(0, 1, 0), _v2.copy(this.anchor).sub(_v).normalize());
    const r = 0.012 * this.S;
    th.scale.set(r, len, r);
  }

  private updateHang(dt: number): void {
    const pos = this.object.position;
    const p = this.pose;
    const g = this.level.ctx.physics.heightAt(pos.x, pos.z);
    const above = pos.y - g;
    const player = this.level.ctx.player;
    if (this.flipT < 0) {
      const sp = above > 4 ? this.hangSpeed : Math.max(1.5, this.hangSpeed * (above / 4));
      pos.y -= sp * dt;
      // swing a little and slowly turn toward the player
      const sway = Math.sin(p.t * 1.7 + this.id) * 0.02;
      const toP = _v.copy(player.position).sub(pos).setY(0);
      if (toP.lengthSq() < 1e-4) toP.set(0, 0, 1);
      toP.normalize();
      // head down, back toward the player
      basis(_v2.set(sway, -1, 0), toP, _q);
      this.object.quaternion.slerp(_q, 1 - Math.exp(-6 * dt));
      p.hang = damp(p.hang, 1, 6, dt);
      p.phase += dt * 0.6;
      if (above < 1.15 * this.S) {
        this.flipT = 0;
        this.flipFrom.copy(this.object.quaternion);
        this.facing = yawOf(player.position.x - pos.x, player.position.z - pos.z);
        this.threadRetract = 0;
      }
    } else {
      this.flipT += dt;
      const u = Math.min(1, this.flipT / 0.32);
      basis(_v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)), _up.set(0, 1, 0), _q);
      this.object.quaternion.slerpQuaternions(this.flipFrom, _q, u * u * (3 - 2 * u));
      pos.y = Math.max(g, pos.y - 5 * dt);
      p.hang = 1 - u;
      if (u >= 1) {
        pos.y = g;
        this.level.ctx.fx.dust(pos, 4 * this.size);
        this.mode = 'ground';
        this.upN.set(0, 1, 0);
        this.setAct('hunt', 0);
        this.flipT = -1;
      }
    }
  }

  // ── climb ─────────────────────────────────────────────────────────────────
  private placeOnPath(): void {
    const n = this.path.length;
    let i = 0;
    while (i < n - 2 && this.pathLen[i + 1] < this.pathS) i++;
    const seg = Math.max(1e-6, this.pathLen[i + 1] - this.pathLen[i]);
    const u = clamp((this.pathS - this.pathLen[i]) / seg, 0, 1);
    const a = this.path[i];
    const b = this.path[i + 1];
    const pos = this.object.position;
    pos.lerpVectors(a.p, b.p, u);
    _up.lerpVectors(a.n, b.n, u).normalize();
    pos.addScaledVector(_up, 0.05 * this.S);
    this.upN.copy(_up);
    // head along the travel direction
    _fwd.subVectors(b.p, a.p).multiplyScalar(this.climbDir);
    basis(_fwd, this.upN, _q);
    this.object.quaternion.copy(_q);
  }

  private updateClimb(dt: number): void {
    const p = this.pose;
    if (this.climbHold) {
      p.speed = 0;
      return;
    }
    const total = this.pathLen[this.pathLen.length - 1];
    if (this.landT < 0) {
      const sp = 3.2 * Math.sqrt(this.size) * (this.size > 1.5 ? 0.8 : 1);
      this.pathS = clamp(this.pathS + this.climbDir * sp * dt, 0, total);
      this.placeOnPath();
      p.speed = sp / this.size;
      p.phase += spiderGaitFreq(p.speed, this.model.scale) * dt;
      p.wrapR = this.climbWrap * this.model.scale;
      const end = this.climbDir > 0 ? this.pathS >= total - 1e-3 : this.pathS <= 1e-3;
      if (end) {
        if (this.onClimbDone) {
          const cb = this.onClimbDone;
          this.onClimbDone = null;
          p.speed = 0;
          this.climbHold = true;
          cb();
          return;
        }
        // step off onto the ground
        this.landT = 0;
        this.landFrom.copy(this.object.position);
        const last = this.path[this.climbDir > 0 ? this.path.length - 1 : 0];
        _v.set(last.n.x, 0, last.n.z).normalize();
        this.landTo.copy(last.p).addScaledVector(_v, 1.1 * this.S);
        this.landTo.y = this.level.ctx.physics.heightAt(this.landTo.x, this.landTo.z);
        this.flipFrom.copy(this.object.quaternion);
        this.facing = yawOf(_v.x, _v.z);
      }
    } else {
      this.landT += dt;
      const u = Math.min(1, this.landT / 0.45);
      const e = u * u * (3 - 2 * u);
      this.object.position.lerpVectors(this.landFrom, this.landTo, e);
      basis(_v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)), _up.set(0, 1, 0), _q);
      this.object.quaternion.slerpQuaternions(this.flipFrom, _q, e);
      p.wrapR = this.climbWrap * this.model.scale * (1 - e);
      p.phase += dt * 2;
      p.speed = 0.8;
      if (u >= 1) {
        p.wrapR = 0;
        this.mode = 'ground';
        this.upN.set(0, 1, 0);
        this.landT = -1;
        this.setAct('hunt', 0);
      }
    }
  }

  // ── ceiling (Brood Mother hanging under the canopy web) ────────────────────
  protected updateCeiling(_dt: number): void {}

  // ── air ───────────────────────────────────────────────────────────────────
  protected updateAir(dt: number): void {
    const pos = this.object.position;
    const p = this.pose;
    this.airVel.y -= GRAV * dt;
    pos.addScaledVector(this.airVel, dt);
    p.air = damp(p.air, this.alive ? 1 : 0.3, 8, dt);
    p.hang = damp(p.hang, 0, 6, dt);
    // right itself while falling
    const yaw = this.alive && (this.airVel.x * this.airVel.x + this.airVel.z * this.airVel.z > 1) ? yawOf(this.airVel.x, this.airVel.z) : this.facing;
    this.facing = dampAngle(this.facing, yaw, 6, dt);
    basis(_v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)), _up.set(0, 1, 0), _q);
    this.object.quaternion.slerp(_q, 1 - Math.exp(-5 * dt));
    const g = this.level.ctx.physics.heightAt(pos.x, pos.z);
    if (pos.y <= g && this.airVel.y < 0) {
      pos.y = g;
      const impact = -this.airVel.y;
      this.airVel.set(0, 0, 0);
      this.level.ctx.fx.dust(pos, Math.min(14, 3 + impact * 0.5) * this.size);
      this.mode = 'ground';
      this.upN.set(0, 1, 0);
      p.air = 0;
      this.object.quaternion.copy(_q);
      const cb = this.onLand;
      this.onLand = null;
      if (this.alive) this.setAct('recover', 0.35);
      cb?.();
    }
  }

  // ── ground AI ─────────────────────────────────────────────────────────────
  protected setAct(a: Act, t: number): void {
    this.act = a;
    this.actT = t;
  }

  protected releaseToken(): void {
    if (this.token) releaseAttackToken(this.target, this);
    this.token = false;
  }

  protected pickTarget(): Combatant | null {
    const { ctx } = this.level;
    const player = ctx.player;
    let best: Combatant | null = player.alive ? player : null;
    let bd = best ? best.position.distanceTo(this.object.position) : Infinity;
    // sometimes go for an ally that is closer (Tauriel, the elves, the dwarves)
    if (this.rng.chance(0.3)) {
      for (const c of ctx.combatants.byTeam('ally')) {
        if (!c.alive) continue;
        const d = c.position.distanceTo(this.object.position);
        if (d < bd - 3 && d < 12) {
          best = c;
          bd = d;
        }
      }
    }
    return best;
  }

  /** the brain on the ground: returns desired velocity in `out` (world, y = 0) */
  protected think(dt: number, out: THREE.Vector3): void {
    const pos = this.object.position;
    const p = this.pose;
    this.targetT -= dt;
    if (!this.target || !this.target.alive || this.targetT <= 0) {
      const nt = this.pickTarget();
      if (nt !== this.target) this.releaseToken();
      this.target = nt;
      this.targetT = 2.5 + this.rng.float() * 2;
    }
    out.set(0, 0, 0);
    const t = this.target;
    if (!t || !this.aiEnabled) {
      p.rear = damp(p.rear, 0, 6, dt);
      return;
    }
    _v.copy(t.position).sub(pos).setY(0);
    const dist = _v.length();
    const dirX = dist > 1e-4 ? _v.x / dist : 0;
    const dirZ = dist > 1e-4 ? _v.z / dist : 1;
    const now = this.level.ctx.time.t;
    this.actT -= dt;
    switch (this.act) {
      case 'idle':
      case 'hunt': {
        p.rear = damp(p.rear, 0, 6, dt);
        p.strike = damp(p.strike, 0, 8, dt);
        p.crouch = damp(p.crouch, 0, 6, dt);
        p.spit = damp(p.spit, 0, 6, dt);
        // orbit point around the target, drifting
        this.orbitT -= dt;
        if (this.orbitT <= 0) {
          this.orbitT = 0.8 + this.rng.float() * 1.4;
          this.orbitA += (this.rng.float() - 0.5) * 1.8;
        }
        const baseA = Math.atan2(-dirZ, -dirX); // from target toward us
        const a = baseA + Math.sin(this.orbitA) * 0.9;
        const gx = t.position.x + Math.cos(a) * this.orbitR;
        const gz = t.position.z + Math.sin(a) * this.orbitR;
        _v2.set(gx - pos.x, 0, gz - pos.z);
        const gd = _v2.length();
        const sp = this.speedMax * (dist > 14 ? 1.15 : 1);
        if (gd > 0.4) out.copy(_v2).multiplyScalar(Math.min(sp, gd * 2.5 + 0.5) / gd);
        this.faceTarget = true;
        // attacks
        this.spitCd -= dt;
        if (this.spitter && dist > 6 && dist < 24 && this.spitCd <= 0) {
          this.spitCd = 4 + this.rng.float() * 3;
          this.setAct('spitwind', 0.65);
        } else if (!this.spitter && dist > 9 && dist < 22 && this.spitCd <= 0) {
          // the odd melee spider spits too
          if (this.rng.chance(0.35)) {
            this.spitCd = 7 + this.rng.float() * 4;
            this.setAct('spitwind', 0.65);
          } else this.spitCd = 3;
        } else if ((!this.spitter || dist < 5) && dist < 4.6 * Math.max(0.7, this.size) && this.actT <= 0) {
          if (requestAttackToken(t, now, this.diff.tokenGap * 0.8, this.diff.concurrent + 1, this)) {
            this.token = true;
            this.setAct('windup', 0.55 * this.diff.windup);
            this.level.ctx.audio.play('spider_hiss', { pos, volume: 0.75, pitch: (0.95 + this.rng.float() * 0.2) / Math.sqrt(this.size) });
          } else this.actT = 0.3;
        }
        break;
      }
      case 'windup': {
        p.rear = damp(p.rear, 1, 10, dt);
        out.set(-dirX, 0, -dirZ).multiplyScalar(0.6);
        this.faceTarget = true;
        if (this.actT <= 0) {
          this.setAct('lunge', 0.3);
          this.lungeHit = false;
          this.facing = yawOf(dirX, dirZ);
        }
        break;
      }
      case 'lunge': {
        p.rear = damp(p.rear, 0, 14, dt);
        p.strike = damp(p.strike, 1, 16, dt);
        const sp = Math.min(11 * Math.sqrt(this.size), (dist - 0.6 * this.S) / Math.max(0.05, this.actT));
        out.set(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(Math.max(2, sp));
        this.faceTarget = false;
        if (!this.lungeHit && (dist < this.radius + t.radius + 0.55 * this.S || this.actT <= 0)) {
          this.lungeHit = true;
          this.bite(t, dist);
        }
        if (this.actT <= 0) {
          this.releaseToken();
          this.setAct('recover', 0.55 + this.rng.float() * 0.3);
        }
        break;
      }
      case 'recover': {
        p.strike = damp(p.strike, 0, 6, dt);
        out.set(-dirX, 0, -dirZ).multiplyScalar(1.5);
        this.faceTarget = true;
        if (this.actT <= 0) this.setAct('hunt', 0.4 + this.rng.float() * 0.6);
        break;
      }
      case 'spitwind': {
        p.crouch = damp(p.crouch, 0.7, 8, dt);
        p.spit = damp(p.spit, 1, 8, dt);
        p.rear = damp(p.rear, 0.3, 6, dt);
        this.faceTarget = true;
        if (this.actT <= 0) {
          this.spitAt(t);
          this.setAct('spitrec', 0.45);
        }
        break;
      }
      case 'spitrec': {
        p.spit = damp(p.spit, 0, 6, dt);
        p.crouch = damp(p.crouch, 0, 6, dt);
        p.rear = damp(p.rear, 0, 6, dt);
        if (this.actT <= 0) this.setAct('hunt', 0);
        break;
      }
      case 'stagger': {
        p.rear = damp(p.rear, 0, 10, dt);
        p.strike = 0;
        out.set(-dirX, 0, -dirZ).multiplyScalar(2);
        this.releaseToken();
        if (this.actT <= 0) this.setAct('hunt', 0.3);
        break;
      }
      case 'dart': {
        // a quick skitter sideways
        const side = (this.id & 1) ? 1 : -1;
        out.set(-dirZ * side, 0, dirX * side).multiplyScalar(this.speedMax * 1.5);
        this.faceTarget = true;
        if (this.actT <= 0) this.setAct('hunt', 0.2);
        break;
      }
    }
  }

  protected faceTarget = true;

  protected bite(t: Combatant, dist: number): void {
    const { ctx } = this.level;
    const pos = this.object.position;
    _v.copy(t.position).sub(pos).setY(0);
    const ang = Math.abs(wrapAngle(yawOf(_v.x, _v.z) - this.facing));
    if (dist < this.radius + t.radius + 0.9 * this.S && ang < 0.9 && Math.abs(t.position.y - pos.y) < 1.6 * this.S) {
      _v.normalize();
      t.takeDamage({ amount: this.damage, type: 'melee', source: this, point: t.position.clone().setY(t.position.y + 1), dir: _v.clone(), knockback: 2.5 * this.size, stagger: this.size > 1.5 });
      ctx.audio.play('knife_hit', { pos, volume: 0.6, pitch: 0.7 });
    }
    ctx.audio.play('spider_hiss', { pos, volume: 0.5, pitch: 1.4 / Math.sqrt(this.size) });
  }

  protected spitAt(t: Combatant, spread = 0): void {
    this.mouthWorld(_v3);
    this.webs.spit(this, _v3.clone(), t, 19, spread, 5 * this.diff.dmg);
  }

  mouthWorld(out: THREE.Vector3): THREE.Vector3 {
    this.object.updateMatrixWorld(true);
    return out.copy(this.model.mouth).multiplyScalar(this.size).applyMatrix4(this.object.matrixWorld);
  }

  private readonly desired = new THREE.Vector3();

  dispose(): void {
    if (this.disposed) return;
    this.releaseToken();
    this.thread?.removeFromParent();
    this.thread = null;
    this.model.dispose();
    super.dispose();
  }

  protected updateGround(dt: number): void {
    const { physics } = this.level.ctx;
    const pos = this.object.position;
    const p = this.pose;
    const v = this.velocity;
    if (this.alive) this.think(dt, this.desired);
    else this.desired.set(0, 0, 0);
    // separation from other living combatants
    let sx = 0;
    let sz = 0;
    if (this.alive) {
      for (const c of this.level.ctx.combatants.all()) {
        if (c === this || !c.alive) continue;
        const dx = pos.x - c.position.x;
        const dz = pos.z - c.position.z;
        if (Math.abs(dx) > 5 || Math.abs(dz) > 5 || Math.abs(pos.y - c.position.y) > 3) continue;
        const minD = (this.radius + c.radius) * 1.15 + 0.2;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (minD - d) / minD;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
    }
    this.desired.x += sx * 4;
    this.desired.z += sz * 4;
    const acc = (this.act === 'lunge' || this.act === 'dart' ? 60 : 22) * dt;
    _v.copy(this.desired).sub(v).setY(0);
    const l = _v.length();
    if (l > acc) _v.multiplyScalar(acc / l);
    v.x += _v.x;
    v.z += _v.z;
    v.y = 0;
    pos.x += v.x * dt;
    pos.z += v.z * dt;
    if (this.alive) physics.collide(pos, this.radius * 0.85, this.height, 0.9 * this.S);
    // ground (logs and rocks are walkable)
    const g = physics.ground(pos.x, pos.z, pos.y, 0.8 * this.S);
    const gy = g ? g.y : physics.heightAt(pos.x, pos.z);
    pos.y = gy > pos.y ? damp(pos.y, gy, 18, dt) : damp(pos.y, gy, 12, dt);
    // facing
    const sp = Math.hypot(v.x, v.z);
    const prevYaw = this.facing;
    if (this.faceTarget && this.target && this.alive) {
      const ty = yawOf(this.target.position.x - pos.x, this.target.position.z - pos.z);
      this.facing = dampAngle(this.facing, ty, this.act === 'windup' || this.act === 'spitwind' ? 9 : 6, dt);
    } else if (sp > 0.5) this.facing = dampAngle(this.facing, yawOf(v.x, v.z), 7, dt);
    const yawRate = wrapAngle(this.facing - prevYaw) / Math.max(dt, 1e-4);
    // ground normal from the terrain under the legs
    const e = 0.9 * this.S;
    const hx = physics.heightAt(pos.x + e, pos.z) - physics.heightAt(pos.x - e, pos.z);
    const hz = physics.heightAt(pos.x, pos.z + e) - physics.heightAt(pos.x, pos.z - e);
    _up.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
    this.upN.lerp(_up, 1 - Math.exp(-6 * dt)).normalize();
    basis(_v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)), this.upN, _q);
    this.object.quaternion.slerp(_q, 1 - Math.exp(-14 * dt));
    // gait from the local velocity
    const cf = Math.cos(this.facing);
    const sf = Math.sin(this.facing);
    const fwd = (v.x * sf + v.z * cf) / this.size;
    p.speed = fwd;
    p.turn = clamp(yawRate, -4, 4);
    const gs = Math.max(Math.abs(fwd), Math.abs(p.turn) * 0.75 * this.model.scale, Math.abs(v.x * cf - v.z * sf) / this.size);
    p.phase += spiderGaitFreq(gs, this.model.scale) * dt;
    p.lean = damp(p.lean, clamp(-p.turn * 0.04, -0.12, 0.12), 6, dt);
    p.wrapR = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Web anchor (Brood Mother fight): a glowing knot of silk, a small weak-point combatant
// ─────────────────────────────────────────────────────────────────────────────

let anchorGeo: THREE.BufferGeometry | null = null;
let haloGeo: THREE.BufferGeometry | null = null;

export class WebAnchor extends BaseCombatant {
  private readonly knot: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly knotMat: THREE.MeshStandardMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private t = 0;
  private readonly helper = new THREE.Object3D();
  active = false;

  constructor(private readonly level: LevelAPI, at: THREE.Vector3) {
    super({ team: 'enemy', name: 'Web anchor', maxHp: 45, radius: 0.55, height: 1.1, bloodKind: 'ichor', countsForRivalry: false });
    if (!anchorGeo) {
      const g = new THREE.IcosahedronGeometry(0.55, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i);
        _v.multiplyScalar(1 + 0.3 * Math.sin(_v.x * 13 + _v.y * 7) * Math.cos(_v.z * 11));
        p.setXYZ(i, _v.x, _v.y, _v.z);
      }
      g.computeVertexNormals();
      anchorGeo = g;
      anchorGeo.userData.shared = true;
      haloGeo = new THREE.SphereGeometry(1.25, 16, 12);
      haloGeo.userData.shared = true;
    }
    this.knotMat = new THREE.MeshStandardMaterial({ color: 0xe8e8d0, roughness: 0.5, emissive: 0xc8f080, emissiveIntensity: 0.4 });
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xbfe890, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.knot = new THREE.Mesh(anchorGeo, this.knotMat);
    this.halo = new THREE.Mesh(haloGeo!, this.haloMat);
    this.halo.userData.noAO = true;
    this.knot.castShadow = false;
    this.object.position.copy(at).setY(at.y - 0.55);
    this.helper.position.set(0, 0.55, 0);
    this.object.add(this.helper, this.knot, this.halo);
    this.knot.position.y = 0.55;
    this.halo.position.y = 0.55;
    this.addZoneSphere(this.helper, 0.75, 'weakpoint', 1);
    this.aimBone = this.helper;
    this.targetable = false;
    this.corpseTime = -1;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.targetable = on && this.alive;
  }

  protected filterDamage(d: DamageInfo): number {
    return this.active ? d.amount : 0;
  }

  protected onDamaged(): void {
    this.knotMat.emissiveIntensity = 2;
    this.level.ctx.fx.dust(this.helper.getWorldPosition(_v), 3, 0xeeeedd);
  }

  protected onDied(): void {
    const { ctx } = this.level;
    this.helper.getWorldPosition(_v);
    ctx.fx.debris(_v, 10, 0xe6e2d0);
    ctx.fx.dust(_v, 12, 0xe6e2d0);
    ctx.audio.play('web_tear', { pos: _v, volume: 1, pitch: 0.7 });
    this.knot.visible = false;
    this.halo.visible = false;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.alive) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
      const k = this.active ? 1 : 0.15;
      this.knotMat.emissiveIntensity = damp(this.knotMat.emissiveIntensity, (0.6 + pulse * 1.1) * k, 6, dt);
      this.haloMat.opacity = (0.1 + pulse * 0.14) * k;
      this.halo.scale.setScalar(0.85 + pulse * 0.25);
    }
    this.afterAnimate();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The Brood Mother
// ─────────────────────────────────────────────────────────────────────────────

type BossMove = 'none' | 'stab' | 'volley' | 'leap' | 'summon' | 'stun' | 'roar';

export interface BroodHooks {
  /** she screeches for her brood: the chapter drops spiderlings */
  onSummon(): void;
}

export class BroodMother extends Spider {
  invulnerable = false;
  /** 1 = first ground phase, 2 = in the canopy, 3 = enraged ground phase */
  phase = 1;
  move: BossMove = 'none';
  private moveT = 0;
  private stabN = 0;
  private stabHit = [false, false, false];
  private cd = { stab: 0, volley: 3, leap: 6, summon: 0 };
  private readonly leapTarget = new THREE.Vector3();
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private summoned75 = false;
  private summoned25 = false;
  private ceilingSpitT = 2;
  private readonly hooks: BroodHooks;
  /** set while scripted (climbing up, hanging, falling): the brain is off */
  scripted = false;
  /** scripted run target (the brain steers her there while scripted) */
  goal: THREE.Vector3 | null = null;

  constructor(level: LevelAPI, webs: WebSystem, hooks: BroodHooks) {
    super(level, webs, { variant: 'brood', hp: 760, damage: 18, speed: 4.6, name: 'The Brood Mother' });
    this.hooks = hooks;
    this.isBoss = true;
    this.corpseTime = -1;
    this.radius = 1.5;
    this.height = 2.6;
  }

  protected buildZones(): void {
    const b = this.model.bones;
    const S = this.S;
    this.addZoneSphere(b.body, 0.26 * S, 'armor', 0.6, new THREE.Vector3(0, 0.03, 0).multiplyScalar(S));
    // the eye cluster: the weak point (×3)
    this.addZoneSphere(b.body, 0.12 * S, 'weakpoint', 3, new THREE.Vector3(0, 0.09, 0.27).multiplyScalar(S));
    this.addZoneSphere(b.abdomen, 0.4 * S, 'body', 0.85, new THREE.Vector3(0, 0.14, -0.46).multiplyScalar(S));
    for (const i of [0, 1, 2, 3]) for (const s of ['l', 'r']) {
      this.addZoneCapsule(b[`leg${i}a_${s}`], b[`leg${i}b_${s}`], 0.07 * S, 'limb', 0.35);
      this.addZoneCapsule(b[`leg${i}b_${s}`], b[`leg${i}c_${s}`], 0.055 * S, 'limb', 0.35);
    }
    this.aimBone = b.body;
  }

  protected filterDamage(d: DamageInfo): number {
    if (this.invulnerable) return 0;
    // the stunned mother takes more
    const a = d.amount * (this.move === 'stun' ? 1.5 : 1);
    // phase 1 ends at exactly 50 %: a big volley cannot skip the canopy phase
    if (this.phase === 1) return Math.min(a, Math.max(0, this.hp - this.maxHp * 0.5));
    return a;
  }

  protected onDamaged(d: DamageInfo, amount: number): void {
    void d;
    void amount;
    // no stagger on her; just the flash
    this.flashT = 1;
  }

  /** knock her down: fall from the canopy, stunned for `sec` */
  stun(sec: number): void {
    this.move = 'stun';
    this.moveT = sec;
    this.releaseMoveVisuals();
  }

  /** hang upside down under the canopy at `p` */
  hangUnder(p: THREE.Vector3): void {
    this.mode = 'ceiling';
    this.object.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.ceilingSpitT = 2.5;
  }

  /** drop out of the canopy (the web gave way) */
  fall(onLand: () => void): void {
    this.mode = 'air';
    this.airVel.set(0, -2, 0);
    this.onLand = () => {
      this.level.ctx.player.camera.shake(0.7, 0.9);
      this.level.ctx.audio.play('troll_hit', { pos: this.object.position, volume: 1, pitch: 0.6 });
      this.level.ctx.fx.debris(this.object.position, 18, 0x3a3226);
      onLand();
    };
  }

  protected updateCeiling(dt: number): void {
    const p = this.pose;
    const pos = this.object.position;
    const player = this.level.ctx.player;
    // upside down under the web, turning to watch Legolas
    const yaw = yawOf(player.position.x - pos.x, player.position.z - pos.z);
    this.facing = dampAngle(this.facing, yaw, 2.5, dt);
    basis(_v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)), _up.set(0, -1, 0), _q);
    this.object.quaternion.slerp(_q, 1 - Math.exp(-4 * dt));
    pos.y += Math.sin(p.t * 1.3) * 0.15 * dt;
    p.speed = 0;
    p.turn = clamp(wrapAngle(yaw - this.facing) * 2, -2, 2);
    p.phase += spiderGaitFreq(Math.abs(p.turn) * 2, this.model.scale) * dt;
    p.rear = damp(p.rear, 0.2, 3, dt);
    if (!this.alive || this.scripted) return;
    this.ceilingSpitT -= dt;
    p.spit = damp(p.spit, this.ceilingSpitT < 0.7 ? 1 : 0, 6, dt);
    if (this.ceilingSpitT <= 0) {
      this.ceilingSpitT = 3.2 + this.rng.float() * 1.5;
      this.spitAt(player, -0.12);
      this.spitAt(player, 0.12);
      if (this.rng.chance(0.5)) this.spitAt(player, 0);
    }
  }

  private releaseMoveVisuals(): void {
    if (this.ring) this.ring.visible = false;
    const p = this.pose;
    p.stabL = p.stabR = 0;
  }

  private showRing(at: THREE.Vector3, r: number): void {
    if (!this.ring) {
      this.ringMat = new THREE.MeshBasicMaterial({ color: 0xd8e6b0, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
      this.ring.userData.noAO = true;
      this.ring.renderOrder = 3;
      this.level.root.add(this.ring);
    }
    this.ring.visible = true;
    this.ring.position.set(at.x, this.level.ctx.physics.heightAt(at.x, at.z) + 0.06, at.z);
    this.ring.scale.setScalar(r);
  }

  protected think(dt: number, out: THREE.Vector3): void {
    const p = this.pose;
    const pos = this.object.position;
    const { ctx } = this.level;
    out.set(0, 0, 0);
    if (this.scripted) {
      p.rear = damp(p.rear, 0, 4, dt);
      if (this.goal) {
        _v2.set(this.goal.x - pos.x, 0, this.goal.z - pos.z);
        const gd = _v2.length();
        if (gd > 0.3) out.copy(_v2).multiplyScalar(Math.min(7.5, gd * 3) / gd);
        this.faceTarget = false;
      }
      return;
    }
    const t = ctx.player;
    this.target = t;
    _v.copy(t.position).sub(pos).setY(0);
    const dist = _v.length();
    const dx = dist > 1e-3 ? _v.x / dist : 0;
    const dz = dist > 1e-3 ? _v.z / dist : 1;
    const enraged = this.phase >= 3;
    const cdt = dt * (enraged ? 1.35 : 1);
    this.cd.stab -= cdt;
    this.cd.volley -= cdt;
    this.cd.leap -= cdt;
    this.cd.summon -= cdt;
    this.moveT -= dt;
    this.faceTarget = true;
    switch (this.move) {
      case 'none': {
        p.rear = damp(p.rear, 0, 5, dt);
        p.strike = damp(p.strike, 0, 6, dt);
        p.crouch = damp(p.crouch, 0, 5, dt);
        p.spit = damp(p.spit, 0, 5, dt);
        p.stun = damp(p.stun, 0, 4, dt);
        if (!this.aiEnabled) return;
        // summons at 75 % and (enraged) 25 %
        const frac = this.hp / this.maxHp;
        if (!this.summoned75 && frac < 0.78 && this.phase === 1) {
          this.summoned75 = true;
          this.startMove('summon', 1.4);
          return;
        }
        if (!this.summoned25 && frac < 0.28 && this.phase >= 3) {
          this.summoned25 = true;
          this.startMove('summon', 1.4);
          return;
        }
        if (dist < 5.6 && this.cd.stab <= 0) {
          this.startMove('stab', 0.75);
          return;
        }
        if (dist > 7 && this.cd.leap <= 0 && (dist > 11 || this.rng.chance(0.5))) {
          this.startMove('leap', 0.95);
          return;
        }
        if (dist > 6 && dist < 26 && this.cd.volley <= 0) {
          this.startMove('volley', 0.85);
          return;
        }
        // stalk: approach to ~4 m, circling
        const want = 4.2;
        const a = Math.atan2(-dz, -dx) + Math.sin(p.t * 0.4) * 0.6;
        const gx = t.position.x + Math.cos(a) * want;
        const gz = t.position.z + Math.sin(a) * want;
        _v2.set(gx - pos.x, 0, gz - pos.z);
        const gd = _v2.length();
        const sp = this.speedMax * (enraged ? 1.25 : 1);
        if (gd > 0.5) out.copy(_v2).multiplyScalar(Math.min(sp, gd * 2) / gd);
        break;
      }
      case 'stab': {
        // rear (telegraph), then three stabs L R L
        p.rear = damp(p.rear, 0.55, 8, dt);
        const tt = -this.moveT; // time since the wind-up ended
        if (this.moveT > 0) {
          p.stabL = damp(p.stabL, 0.6, 8, dt);
          p.stabR = damp(p.stabR, 0.45, 8, dt);
          out.set(dx, 0, dz).multiplyScalar(0.8);
        } else {
          const gap = enraged ? 0.28 : 0.36;
          const k = Math.min(2, Math.floor(tt / gap));
          const u = (tt - k * gap) / gap;
          const left = k !== 1;
          const stab = u < 0.45 ? 0.6 + 0.4 * (u / 0.45) : 1 - 0.4 * Math.min(1, (u - 0.45) / 0.55);
          if (left) {
            p.stabL = stab;
            p.stabR = damp(p.stabR, 0.6, 10, dt);
          } else {
            p.stabR = stab;
            p.stabL = damp(p.stabL, 0.6, 10, dt);
          }
          out.set(dx, 0, dz).multiplyScalar(1.5);
          this.faceTarget = true;
          if (u >= 0.45 && !this.stabHit[k]) {
            this.stabHit[k] = true;
            this.stabStrike(left);
          }
          if (tt > gap * 3 + 0.25) {
            this.endMove();
            this.cd.stab = 2.4 + this.rng.float();
          }
        }
        break;
      }
      case 'volley': {
        p.crouch = damp(p.crouch, 0.6, 6, dt);
        p.spit = damp(p.spit, 1, 6, dt);
        p.rear = damp(p.rear, 0.35, 6, dt);
        if (this.moveT <= 0) {
          const n = enraged ? 5 : 3;
          for (let i = 0; i < n; i++) this.spitAt(t, (i - (n - 1) / 2) * 0.16);
          this.endMove();
          this.cd.volley = 5 + this.rng.float() * 2;
        }
        break;
      }
      case 'leap': {
        // crouch with the landing ring showing, then jump
        if (this.mode === 'ground' && this.moveT > 0) {
          p.crouch = damp(p.crouch, 1, 6, dt);
          this.leapTarget.copy(t.position);
          this.showRing(this.leapTarget, 4.5);
          if (this.ringMat) this.ringMat.opacity = 0.35 + 0.3 * Math.abs(Math.sin(p.t * 9));
        } else if (this.moveT < -3) {
          this.endMove();
        } else if (this.mode === 'ground' && this.moveT <= 0 && this.moveT > -0.1) {
          p.crouch = 0;
          this.moveT = -0.2;
          ctx.audio.play('spider_hiss', { pos, volume: 1, pitch: 0.55 });
          this.leapTo(this.leapTarget, 0.95, () => this.slam());
        }
        break;
      }
      case 'summon': {
        p.rear = damp(p.rear, 1, 6, dt);
        p.spit = damp(p.spit, 0.5, 6, dt);
        if (this.moveT <= 0) {
          this.hooks.onSummon();
          this.endMove();
        }
        break;
      }
      case 'stun': {
        p.stun = damp(p.stun, 1, 8, dt);
        p.rear = 0;
        p.crouch = 0;
        p.spit = 0;
        if (this.moveT <= 0) {
          this.endMove();
          this.cd.stab = 0.5;
          this.cd.leap = 4;
        }
        break;
      }
      case 'roar': {
        p.rear = damp(p.rear, 1, 6, dt);
        if (this.moveT <= 0) this.endMove();
        break;
      }
    }
  }

  private startMove(m: BossMove, t: number): void {
    this.move = m;
    this.moveT = t;
    this.stabHit[0] = this.stabHit[1] = this.stabHit[2] = false;
    const pos = this.object.position;
    const a = this.level.ctx.audio;
    if (m === 'stab' || m === 'volley') a.play('spider_hiss', { pos, volume: 1, pitch: 0.6 });
    if (m === 'summon' || m === 'roar') {
      a.play('spider_hiss', { pos, volume: 1, pitch: 0.45 });
      a.play('bat_screech', { pos, volume: 0.6, pitch: 0.5 });
      this.level.ctx.player.camera.shake(0.25, 0.8);
    }
  }

  private endMove(): void {
    this.move = 'none';
    this.moveT = 0;
    this.releaseMoveVisuals();
  }

  /** a scripted roar (phase changes) */
  roar(sec = 1.4): void {
    this.startMove('roar', sec);
  }

  private stabStrike(left: boolean): void {
    const { ctx } = this.level;
    // the leg tip lands ~4 m ahead, slightly to its side
    const pos = this.object.position;
    const f = this.facing;
    const side = left ? 1 : -1;
    const hx = pos.x + Math.sin(f) * 3.6 + Math.cos(f) * side * 0.9;
    const hz = pos.z + Math.cos(f) * 3.6 - Math.sin(f) * side * 0.9;
    _v.set(hx, ctx.physics.heightAt(hx, hz), hz);
    ctx.fx.dust(_v, 5);
    ctx.audio.play('arrow_hit_wood', { pos: _v, volume: 0.9, pitch: 0.5 });
    for (const c of ctx.combatants.query(_v, 2.2)) {
      if (!c.alive || !hostile(this.team, c.team)) continue;
      _v2.copy(c.position).sub(pos).setY(0).normalize();
      c.takeDamage({ amount: this.damage * 0.9, type: 'melee', source: this, point: c.position.clone().setY(c.position.y + 1), dir: _v2.clone(), knockback: 4, stagger: true });
    }
    ctx.player.camera.shake(0.12, 0.2);
  }

  private slam(): void {
    const { ctx } = this.level;
    const pos = this.object.position;
    if (this.ring) this.ring.visible = false;
    ctx.fx.dust(pos, 16);
    ctx.fx.debris(pos, 10, 0x3a3226);
    ctx.audio.play('troll_hit', { pos, volume: 1, pitch: 0.7 });
    const pd = ctx.player.position.distanceTo(pos);
    if (pd < 18) ctx.player.camera.shake(0.5 * (1 - pd / 18), 0.5);
    for (const c of ctx.combatants.query(pos, 4.6)) {
      if (!c.alive || !hostile(this.team, c.team)) continue;
      const d = c.position.distanceTo(pos);
      _v2.copy(c.position).sub(pos).setY(0.4).normalize();
      c.takeDamage({ amount: this.damage * 1.4 * (1 - 0.5 * (d / 4.6)), type: 'crush', source: this, point: c.position.clone(), dir: _v2.clone(), knockback: 9, stagger: true });
    }
    this.move = 'none';
    this.cd.leap = 7 + this.rng.float() * 3;
    this.cd.stab = 0.8;
    this.setAct('recover', 0.9);
  }

  protected bite(t: Combatant, dist: number): void {
    super.bite(t, dist);
  }

  update(dt: number): void {
    super.update(dt);
    if (this.ring && this.move !== 'leap') this.ring.visible = false;
  }

  dispose(): void {
    this.ring?.geometry.dispose();
    this.ringMat?.dispose();
    this.ring?.removeFromParent();
    super.dispose();
  }
}
