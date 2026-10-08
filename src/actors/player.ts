/**
 * Legolas: the player controller (owner: gameplay).
 *
 * Movement  run 6.5 / sprint 9 m/s, weighty-but-responsive acceleration, coyote time + jump
 *           buffer, double jump (elven leap), dash 6 m with 0.3 s i-frames (also in the air),
 *           slopes/steps/platform carry via the shared motor, landing dust + sound, footsteps by
 *           surface at stride cadence.
 * Bow       hold to draw (stats.drawTime), release to loose; charge scales damage, speed and
 *           accuracy; min charge 0.2 (quick shot). Aim mode zooms (FOV 70→48) and slows turning.
 *           Arrows are ballistic-compensated toward the crosshair point; aim assist bends ≤ 4°.
 * Knives    3-hit combo (0.32 s per hit, 0.5 s window), lunge to the nearest enemy within 3 m,
 *           cone hit test, the 3rd hit staggers. Hit-stop, shake and rumble on contact.
 * Focus     see src/combat/focus.ts.
 * Damage    i-frames, damage flash + direction, rumble, stagger, regen after 4 s, death/revive.
 * Movers    PlayerMover overrides locomotion for set-pieces (pose, camera, allow* gates).
 */
import * as THREE from 'three';
import type {
  AnimInput,
  ArrowType,
  CombatRayHit,
  Combatant,
  DamageInfo,
  GameContext,
  Humanoid,
  InputState,
  PlayerAPI,
  PlayerMover,
  PlayerStats,
} from '../core/types';
import { clamp, damp, dampAngle, lerp, wrapAngle, yawOf } from '../core/math';
import { BaseCombatant, hostile, meleeLineClear } from './combatant';
import { createCameraRig, type CameraRigExt, type CameraSubject } from './camera';
import { makeHumanoid } from './humanoids';
import { createMotor, launch, settle, stepMotor, type Motor } from '../physics/motor';
import { ARROW_GRAVITY, angleBetween, ballisticDir, leadTarget, rotateToward, spreadDir } from '../combat/aim';
import { createFocus, type FocusController } from '../combat/focus';

export const DEFAULT_STATS: PlayerStats = {
  maxHp: 100,
  drawTime: 0.55,
  arrowDamage: 34,
  knifeDamage: 22,
  moveSpeed: 6.5,
  dashCooldown: 0.7,
  focusMax: 100,
  focusTargets: 4,
  damageTakenMul: 1,
  regen: 3,
};

// ── tuning ───────────────────────────────────────────────────────────────────
const SPRINT_MUL = 9 / 6.5;
const AIM_MOVE_SPEED = 3.3;
const ACCEL = 46;
const DECEL = 34;
const REVERSE_ACCEL = 60;
const AIR_ACCEL = 13;
const JUMP_V = 7.6; // ≈1.3 m
const LEAP_V = 7.9; // elven leap (second jump)
const LEAP_BOOST = 1.6;
const COYOTE = 0.12;
const JUMP_BUFFER = 0.15;
const DASH_DIST = 6;
const DASH_TIME = 0.24;
const DASH_IFRAMES = 0.3;
const MIN_CHARGE = 0.2;
const NOCK_TIME = 0.16;
const KNIFE_HIT_TIME = 0.32;
const COMBO_WINDOW = 0.5;
const FINISHER_RECOVERY = 0.22;
/** camera-to-head distance over which the body dithers out (m) */
const FADE_NEAR = 0.55;
const FADE_FAR = 1.35;
const LUNGE_RANGE = 3;
const LUNGE_TIME = 0.13;
const KNIFE_RANGE = 2.1;
const KNIFE_CONE = THREE.MathUtils.degToRad(65);
const AIM_ASSIST_MAX = THREE.MathUtils.degToRad(4);
const REGEN_DELAY = 4;
const FOCUS_PER_KILL = 12;

const ZERO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  aimHeld: false,
  drawHeld: false,
  drawReleased: false,
  melee: false,
  jump: false,
  dash: false,
  interact: false,
  nextArrow: false,
  pause: false,
  arrowSlot: 0,
  focusHeld: false,
  focusPressed: false,
  focusReleased: false,
  sprintHeld: false,
  device: 'kbm',
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _o = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lc = new THREE.Vector3();
const _ld = new THREE.Vector3();

type Tally = { kills: number; shots: number; hits: number; headshots: number; damageTaken: number };

class Player extends BaseCombatant implements PlayerAPI, CameraSubject {
  readonly camera: CameraRigExt;
  facing = 0;
  mover: PlayerMover | null = null;
  controlsEnabled = true;
  weaponsEnabled = true;
  invulnerable = false;
  arrowType: ArrowType = 'standard';
  focus = 0;
  readonly tally: Tally = { kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };

  private readonly ctx: GameContext;
  private _stats: PlayerStats = { ...DEFAULT_STATS };
  private statsT = 0;
  private readonly motor: Motor;
  private readonly focusCtl: FocusController;
  private readonly anim: AnimInput = { speed: 0, moveDir: { x: 0, z: 1 }, grounded: true, vy: 0, aim: 0, draw: 0, aimPitch: 0, attack: null, hit: 0, dead: 0, deathVariant: 0, special: null, specialT: 0, lookAt: null };
  private readonly attackAnim = { kind: 'knife1' as 'knife1' | 'knife2' | 'knife3', t: 0 };

  // timers / state
  private lastReal = -1;
  private jumpBuffer = 0;
  private jumpsUsed = 0;
  private airDashUsed = false;
  private dashT = -1;
  private dashCd = 0;
  private iframes = 0;
  private readonly dashDir = new THREE.Vector3();
  private stun = 0;
  private sinceHurt = 99;
  private hurtSfxT = 0;
  private drawing = false;
  private charge = 0;
  private nock = 0;
  private aimHeld = false;
  /** throttle for the "arrow type locked" hint (real-ish seconds) */
  private lockedHintT = 0;
  /** recovery after the combo finisher: the next combo cannot start until it runs out */
  private meleeRecover = 0;
  private meleeHit = 0; // 0 none, 1..3
  private meleeT = 0;
  private meleeQueued = false;
  private meleeDidHit = false;
  private comboWindow = 0;
  private lastMeleeHit = 0;
  private lungeT = 0;
  private readonly lungeVel = new THREE.Vector3();
  private knivesOut = false;
  private knivesTimer = 0;
  private strideAcc = 0;
  private sprint = 0;
  private visualY = 0;
  private flash = 0;
  private lastHud = { hp: -1, max: -1, focus: -1, fmax: -1, factive: false, charge: -1, aiming: false, visible: false, arrow: '' as string, arrows: 0 };
  private readonly safePos = new THREE.Vector3();
  private safeT = 0;
  private assistTarget: Combatant | null = null;
  private assistAngle = Infinity;

  constructor(ctx: GameContext) {
    const humanoid = makeHumanoid({ kind: 'legolas', seed: 1, weapon: 'none', offhand: 'elven_bow' });
    super({ team: 'player', name: 'Legolas', maxHp: DEFAULT_STATS.maxHp, humanoid, radius: 0.34, height: humanoid.height, bloodKind: 'red' });
    this.ctx = ctx;
    this.object.name = 'player';
    this.buildHumanoidZones(humanoid);
    this.flashColor = 0xff2a1a;
    this.corpseTime = -1; // never sink
    this.motor = createMotor(this.object.position, this.velocity, this.radius, this.height * 0.95);
    this.motor.fallMul = 1.2;
    this.refreshStats(true);
    this.focus = this._stats.focusMax * 0.5;
    this.camera = createCameraRig(ctx, this);
    const self = this;
    this.focusCtl = createFocus(ctx, {
      self: this,
      get focus() {
        return self.focus;
      },
      set focus(v: number) {
        self.focus = v;
      },
      get stats() {
        return self._stats;
      },
      bowOrigin: (out) => this.bowOrigin(out),
      onShot: () => {
        this.tally.shots++;
      },
      onArrowHit: (c, hit) => this.onArrowHit(c, hit),
    });
    humanoid.setCastShadow(true);
    // the player persists across levels: parent to the scene, not levelRoot
    ctx.engine.scene.add(this.object);
    ctx.combatants.add(this);
    ctx.combatants.onKill((victim, killer, info) => this.onKill(victim, killer, info));
    settle(ctx.physics, this.motor, 50);
    this.safePos.copy(this.position);
  }

  // ── PlayerAPI ──────────────────────────────────────────────────────────────
  get humanoid(): Humanoid {
    return this.body!;
  }
  get stats(): PlayerStats {
    return this._stats;
  }
  get grounded(): boolean {
    return this.motor.grounded;
  }
  get aiming(): boolean {
    return this.aimHeld || this.drawing;
  }
  get drawCharge(): number {
    return this.drawing ? this.charge : 0;
  }
  get focusActive(): boolean {
    return this.focusCtl.engaged;
  }
  // CameraSubject
  get aimZoom(): number {
    if (!this.alive) return 0;
    if (this.mover && !this.mover.allowShoot) return 0;
    return this.aimHeld ? 1 : this.drawing ? 0.42 * clamp(this.charge * 2, 0, 1) : 0;
  }
  get sprintBlend(): number {
    return this.sprint;
  }
  get visualYOffset(): number {
    return this.visualY;
  }
  get self(): Combatant {
    return this;
  }

  heal(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  resetTally(): void {
    this.tally.kills = 0;
    this.tally.shots = 0;
    this.tally.hits = 0;
    this.tally.headshots = 0;
    this.tally.damageTaken = 0;
    this.refreshStats(true);
  }

  revive(): void {
    this.refreshStats(true);
    this.resurrect();
    this.hp = this.maxHp;
    this.focus = Math.max(this.focus, this._stats.focusMax * 0.5);
    this.resetActionState();
    this.velocity.set(0, 0, 0);
    this.stun = 0;
    this.sinceHurt = 99;
    this.iframes = 1;
    this.anim.dead = 0;
    this.ctx.engine.post.damageFlash = 0;
    settle(this.ctx.physics, this.motor, 2);
    this.camera.snap();
  }

  teleport(pos: THREE.Vector3, facing?: number): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    settle(this.ctx.physics, this.motor, 1);
    if (facing !== undefined) {
      this.facing = facing;
      this.camera.yaw = facing;
      this.camera.pitch = -0.12;
    }
    this.safePos.copy(this.position);
    this.visualY = 0;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.facing;
    this.camera.snap();
  }

  // ── stats ──────────────────────────────────────────────────────────────────
  private refreshStats(force = false) {
    let s: PlayerStats | null = null;
    try {
      s = this.ctx.progression?.stats?.() ?? null;
    } catch {
      s = null;
    }
    const n = { ...DEFAULT_STATS, ...(s ?? {}) };
    const hpFrac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this._stats = n;
    if (n.maxHp !== this.maxHp) {
      this.maxHp = n.maxHp;
      this.hp = force ? n.maxHp : Math.max(1, Math.round(hpFrac * n.maxHp));
    }
    this.focus = Math.min(this.focus, n.focusMax);
  }

  private resetActionState() {
    this.drawing = false;
    this.charge = 0;
    this.nock = 0;
    this.meleeHit = 0;
    this.meleeQueued = false;
    this.comboWindow = 0;
    this.dashT = -1;
    this.lungeT = 0;
    this.focusCtl.cancel();
    this.ctx.time.setScale(1, 0.1);
  }

  // ── damage ─────────────────────────────────────────────────────────────────
  /** hp just before the hit being filtered (the tally counts HP actually lost, not overkill) */
  private hpBeforeHit = 0;
  protected filterDamage(d: DamageInfo): number {
    this.hpBeforeHit = this.hp;
    if (d.type === 'scripted' || d.type === 'fall') return d.amount;
    if (this.invulnerable || this.iframes > 0) return 0;
    if (this.ctx.flags?.god === '1') return 0;
    return d.amount * this._stats.damageTakenMul;
  }

  protected onDamaged(d: DamageInfo, amount: number): void {
    this.tally.damageTaken += Math.min(amount, this.hpBeforeHit);
    this.sinceHurt = 0;
    const post = this.ctx.engine.post;
    post.damageFlash = Math.min(1, Math.max(post.damageFlash, 0.35 + (amount / this.maxHp) * 2.2));
    // direction indicator, relative to the camera
    let ang: number | undefined;
    if (d.source && d.source !== this) ang = yawOf(d.source.position.x - this.position.x, d.source.position.z - this.position.z);
    else if (d.dir) ang = yawOf(-d.dir.x, -d.dir.z);
    this.ctx.hud.damage(ang === undefined ? undefined : wrapAngle(this.camera.yaw - ang));
    this.ctx.input.rumble(Math.min(1, 0.35 + amount / 40), 140 + Math.min(200, amount * 6));
    this.camera.shake(Math.min(0.55, 0.15 + amount / 60), 0.3);
    if (this.hurtSfxT <= 0 && this.alive && this.hp > 0) {
      this.ctx.audio.play('hurt', { volume: 0.9, pitch: 0.95 + Math.random() * 0.1 });
      this.hurtSfxT = 0.3;
    }
    if (d.knockback && d.dir) {
      _v.copy(d.dir).setY(0);
      if (_v.lengthSq() > 1e-6) {
        _v.normalize().multiplyScalar(d.knockback);
        this.velocity.x += _v.x;
        this.velocity.z += _v.z;
      }
    }
    if (d.stagger || amount >= this.maxHp * 0.22) {
      this.stun = Math.max(this.stun, d.stagger ? 0.45 : 0.25);
      this.drawing = false;
      this.charge = 0;
      this.meleeHit = 0;
    }
  }

  protected onDied(): void {
    this.ctx.audio.play('player_death', { volume: 1 });
    this.ctx.engine.post.damageFlash = 1;
    this.resetActionState();
    this.camera.shake(0.5, 0.6);
    this.ctx.input.rumble(1, 500);
  }

  private onKill(victim: Combatant, killer: Combatant | null, info: DamageInfo) {
    if (victim === this) return;
    if (killer !== this && info.source !== this) return;
    this.tally.kills++;
    // a kill by the Focus volley itself refills a quarter, so marking and loosing cannot pay for
    // itself (4 volley kills used to refund 48 for a 13-25 sweep: Focus was effectively free)
    const refill = this.focusCtl.wasVolleyTarget(victim) ? FOCUS_PER_KILL * 0.25 : FOCUS_PER_KILL;
    this.focus = Math.min(this._stats.focusMax, this.focus + refill);
    this.ctx.hud.hitMarker('kill');
    // a beat of impact on kills (not during the Focus volley, which is already slowed)
    if (!this.focusCtl.engaged && info.type !== 'melee') {
      this.ctx.time.hitStop(victim.maxHp >= 400 ? 0.09 : 0.035);
      this.camera.shake(victim.maxHp >= 400 ? 0.3 : 0.07, 0.15);
    }
    const v = victim as Combatant & { countsForRivalry?: boolean; spec?: { countsForRivalry?: boolean } };
    const counts = victim.team === 'enemy' && v.countsForRivalry !== false && v.spec?.countsForRivalry !== false;
    if (counts && this.ctx.rivalry?.active) this.ctx.rivalry.addLegolas(1);
  }

  private onArrowHit(c: Combatant, hit: CombatRayHit, count = true) {
    if (count) {
      this.tally.hits++;
      if (hit.zone === 'head') this.tally.headshots++;
    }
    if (c.alive) this.ctx.hud.hitMarker(hit.zone === 'head' || hit.zone === 'weakpoint' ? 'head' : hit.zone === 'armor' ? 'armor' : 'hit');
    if ((hit.zone === 'head' || hit.zone === 'weakpoint') && count) {
      // the ×2.5 payoff gets its own sting: a crisp high crack, a beat of hit-stop and a kick
      this.ctx.audio.play('knife_hit', { pos: hit.point, volume: 0.6, pitch: 1.55 });
      if (!this.focusCtl.engaged) this.ctx.time.hitStop(0.03);
      this.camera.shake(0.06, 0.1);
      this.ctx.input.rumble(0.45, 70);
    } else this.ctx.input.rumble(0.25, 60);
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  bowOrigin(out: THREE.Vector3): THREE.Vector3 {
    const cy = Math.cos(this.camera.yaw);
    const sy = Math.sin(this.camera.yaw);
    // fallback: shoulder height, slightly right of centre and in front (where a drawn arrow sits)
    out.set(this.position.x, this.position.y + this.height * 0.76 + this.visualY, this.position.z);
    out.x += -cy * 0.18 + sy * 0.45;
    out.z += sy * 0.18 + cy * 0.45;
    // with the aim pose up, the arrow rests on the bow hand: use it
    const w = clamp(((this.anim.aim ?? 0) - 0.3) / 0.6, 0, 1);
    if (w > 0) {
      const hand = this.humanoid.bones.hand_l;
      hand.updateWorldMatrix(true, false);
      _v2.setFromMatrixPosition(hand.matrixWorld);
      if (_v2.distanceToSquared(out) < 1.2 * 1.2) out.lerp(_v2, w);
    }
    return out;
  }

  /** would a straight shot from the bow reach the crosshair point (same target zone, no wall)? */
  private bowLineClear(from: THREE.Vector3, to: THREE.Vector3, assist?: Combatant): boolean {
    _lc.copy(to).sub(from);
    const dist = _lc.length();
    if (dist < 0.5) return true;
    _lc.divideScalar(dist);
    if (assist) return this.ctx.physics.raycast(from, _lc, Math.max(0, dist - 0.4), 'arrows') === null;
    const target = this.camera.aimCombatant;
    if (target) {
      const h = target.raycast(from, _lc, dist + 0.6);
      if (!h || h.zone !== this.camera.aimZone) return false;
      return this.ctx.physics.raycast(from, _lc, h.t, 'arrows') === null;
    }
    return this.ctx.physics.raycast(from, _lc, Math.max(0, dist - 0.3), 'arrows') === null;
  }

  private assistEnabled(device: InputState['device']): boolean {
    return !!this.ctx.settings?.aimAssist || device !== 'kbm';
  }

  /** hostile target closest to the crosshair (angle from camera forward), for aim assist */
  private findAssistTarget() {
    this.assistTarget = null;
    this.assistAngle = Infinity;
    const cam = this.camera.position;
    const fwd = this.camera.forward;
    for (const c of this.ctx.combatants.all()) {
      if (!c.alive || !c.targetable || !hostile(this.team, c.team)) continue;
      c.aimPoint(_v);
      _v.sub(cam);
      const dist = _v.length();
      if (dist > 70 || dist < 0.5) continue;
      _v.divideScalar(dist);
      const a = angleBetween(fwd, _v);
      if (a < this.assistAngle) {
        this.assistAngle = a;
        this.assistTarget = c;
      }
    }
    // an occluded enemy must neither slow the reticle nor pull it
    const t = this.assistTarget;
    if (t && this.assistAngle < THREE.MathUtils.degToRad(6)) {
      t.aimPoint(_v);
      _lc.copy(_v).sub(cam);
      const d = _lc.length();
      _lc.divideScalar(d);
      if (this.ctx.physics.raycast(cam, _lc, Math.max(0, d - 0.4), 'arrows') !== null) {
        this.assistTarget = null;
        this.assistAngle = Infinity;
      }
    }
  }

  // ── update ─────────────────────────────────────────────────────────────────
  update(dt: number): void {
    const ctx = this.ctx;
    // real (unscaled) frame time for UI/Focus; fall back to dt/scale if time.real does not advance
    const real = ctx.time.real;
    let dtReal = this.lastReal < 0 ? dt : real - this.lastReal;
    // a later substep of the same frame (the real clock has not moved since the first one) gets no
    // extra real time; only a context whose real clock never runs (tests) falls back to dt/scale
    if (!(dtReal > 0)) dtReal = real > 0 && this.lastReal >= 0 ? 0 : dt / Math.max(0.05, ctx.time.scale || 1);
    dtReal = clamp(dtReal, 0, 0.1);
    this.lastReal = real;

    this.statsT -= dtReal;
    if (this.statsT <= 0) {
      this.statsT = 1;
      this.refreshStats();
    }

    const live = this.alive;
    const inp = live && this.controlsEnabled && ctx.input.enabled !== false ? ctx.input.state : ZERO_INPUT;
    const mover = this.mover;
    const canShoot = live && this.weaponsEnabled && this.stun <= 0 && (!mover || !!mover.allowShoot);
    const canMelee = live && this.weaponsEnabled && this.stun <= 0 && (!mover || !!mover.allowMelee);
    const canDash = live && this.stun <= 0 && (!mover || !!mover.allowDash);
    const canJump = live && this.stun <= 0 && (!mover || !!mover.allowJump);

    // timers (game time unless noted)
    this.hurtSfxT -= dt;
    this.sinceHurt += dt;
    this.dashCd -= dt;
    this.iframes -= dt;
    this.stun = Math.max(0, this.stun - dt);
    this.jumpBuffer -= dt;
    this.nock -= dt;
    this.comboWindow -= dt;
    this.meleeRecover -= dt;
    this.lockedHintT -= dtReal;
    this.hitReact = Math.max(0, this.hitReact - dt * 4);
    if (inp.jump) this.jumpBuffer = JUMP_BUFFER;

    // ── look (real-time deltas) ──
    const assist = this.assistEnabled(inp.device);
    if (assist) this.findAssistTarget();
    else this.assistTarget = null;
    let lookMul = lerp(1, 0.6, this.camera.aimBlend);
    if (assist && this.assistAngle < THREE.MathUtils.degToRad(3.5)) lookMul *= inp.device === 'kbm' ? 0.75 : 0.5;
    if (!(mover && mover.lockCameraYaw)) this.camera.yaw -= inp.lookX * lookMul;
    this.camera.pitch = clamp(this.camera.pitch + inp.lookY * lookMul, -1.2, 1.05);
    // gentle magnetism for sticks/touch while the player is steering
    if (assist && inp.device !== 'kbm' && this.assistTarget && this.assistAngle < THREE.MathUtils.degToRad(5) && (Math.abs(inp.lookX) + Math.abs(inp.lookY) > 1e-4 || Math.abs(inp.moveX) > 0.1)) {
      this.assistTarget.aimPoint(_v).sub(this.camera.position);
      const ty = yawOf(_v.x, _v.z);
      const tp = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      const k = Math.min(1, dtReal * 3);
      this.camera.yaw += wrapAngle(ty - this.camera.yaw) * k * 0.6;
      this.camera.pitch += (tp - this.camera.pitch) * k * 0.4;
    }

    // ── arrow type ──
    if (inp.arrowSlot || inp.nextArrow) this.switchArrow(inp);

    // ── focus ──
    this.focusCtl.update(dtReal, inp, canShoot && this.meleeHit === 0);

    // ── dash ──
    if (inp.dash && canDash && this.dashCd <= 0 && this.dashT < 0 && (this.motor.grounded || !this.airDashUsed)) this.startDash(inp);

    // ── jump (also cancels a dash after its first frames: dash-jump keeps the momentum) ──
    if (this.jumpBuffer > 0 && canJump && this.dashT >= 0.08 && !mover) {
      this.dashT = -1;
      const carry = this._stats.moveSpeed * 1.35;
      this.velocity.x = this.dashDir.x * carry;
      this.velocity.z = this.dashDir.z * carry;
    }
    if (this.jumpBuffer > 0 && canJump && this.dashT < 0) this.tryJump(inp);

    // ── knives ──
    if (inp.melee && canMelee && !this.focusCtl.engaged) this.pressMelee();
    this.updateMelee(dt);
    if (this.knivesOut) {
      this.knivesTimer -= dt;
      if (this.knivesTimer <= 0 || (inp.drawHeld && this.meleeHit === 0)) this.holsterKnives();
    }

    // ── bow ──
    this.aimHeld = canShoot && inp.aimHeld && !this.focusCtl.engaged;
    this.updateBow(dt, inp, canShoot && this.meleeHit === 0 && this.dashT < 0 && !this.focusCtl.engaged);

    // ── locomotion ──
    let speedH = 0;
    if (mover) {
      // timers that default locomotion would otherwise advance
      if (this.dashT >= 0) {
        this.dashT += dt;
        if (this.dashT >= DASH_TIME) this.dashT = -1;
      }
      this.lungeT = 0;
      try {
        mover.update(dt, this, inp);
      } catch (e) {
        console.warn('[player] mover failed', e);
      }
      speedH = Math.hypot(this.velocity.x, this.velocity.z);
      this.sprint = damp(this.sprint, 0, 6, dtReal);
    } else {
      speedH = this.locomotion(dt, inp);
    }

    // fell out of the world
    if (this.position.y < ctx.physics.killY) {
      if (this.invulnerable || ctx.flags?.god === '1') this.teleport(this.safePos, this.facing);
      else if (this.alive) this.takeDamage({ amount: this.hp + 1000, type: 'fall', source: null });
    }

    // regen
    if (live && this.sinceHurt > REGEN_DELAY && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this._stats.regen * dt);

    // death timer (no corpse removal for the player)
    if (!this.alive) this.deathTime += dt;

    this.animateBody(dt, speedH);
    this.updatePostAndHud(dtReal);
    this.updateCameraFade();
  }

  /**
   * Backed against a wall the camera boom collapses to well under a metre: dither the body out
   * instead of filling the screen with the inside of Legolas' head. Scripted shots (close-ups)
   * always show him fully.
   */
  private updateCameraFade() {
    const h = this.humanoid as Humanoid & { setFade?: (a: number) => void };
    if (!h.setFade) return;
    let a = 1;
    if (this.camera.shot === null) {
      _lc.copy(this.position);
      _lc.y += this.height * 0.85 + this.visualY;
      const d = this.camera.position.distanceTo(_lc);
      a = clamp((d - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0, 1);
    }
    h.setFade(a);
  }

  private switchArrow(inp: InputState) {
    let unlocked: ArrowType[] = ['standard'];
    try {
      unlocked = this.ctx.progression?.unlockedArrows?.() ?? unlocked;
    } catch {
      /* keep standard */
    }
    if (!unlocked.length) unlocked = ['standard'];
    const before = this.arrowType;
    if (inp.arrowSlot) {
      const want = (['standard', 'piercing', 'triple'] as ArrowType[])[inp.arrowSlot - 1];
      if (unlocked.includes(want)) this.arrowType = want;
      else {
        // a locked slot: say so instead of a click that changes nothing
        this.ctx.audio.play('ui_back', { volume: 0.45, pitch: 0.8 });
        if (this.lockedHintT <= 0) {
          this.lockedHintT = 2;
          this.ctx.hud.toast(`${want === 'piercing' ? 'Piercing arrows' : 'Triple Shot'}: unlock it in Upgrades`, 'info');
        }
        return;
      }
    } else {
      const i = unlocked.indexOf(this.arrowType);
      this.arrowType = unlocked[(i + 1) % unlocked.length];
    }
    if (this.arrowType !== before) this.ctx.audio.play('ui_click', { volume: 0.5 });
  }

  // ── movement ───────────────────────────────────────────────────────────────
  private wishDir(inp: InputState, out: THREE.Vector3): number {
    const cy = Math.cos(this.camera.yaw);
    const sy = Math.sin(this.camera.yaw);
    // forward (sy, cy), right (-cy, sy)
    out.set(sy * inp.moveY - cy * inp.moveX, 0, cy * inp.moveY + sy * inp.moveX);
    const mag = Math.min(1, out.length());
    if (mag > 1e-4) out.normalize();
    return mag;
  }

  private startDash(inp: InputState) {
    const mag = this.wishDir(inp, this.dashDir);
    if (mag < 0.2) this.dashDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.dashT = 0;
    this.iframes = DASH_IFRAMES;
    this.dashCd = this._stats.dashCooldown;
    if (!this.motor.grounded) this.airDashUsed = true;
    this.drawing = false;
    this.charge = 0;
    this.meleeHit = 0;
    this.meleeQueued = false;
    this.ctx.audio.play('dash', { pos: this.position, volume: 0.9 });
    // movers integrate velocity themselves: give them the burst as an impulse
    if (this.mover) this.velocity.addScaledVector(this.dashDir, DASH_DIST / DASH_TIME);
    if (this.motor.grounded) this.ctx.fx.dust(this.position, 6, this.dustColor());
    this.camera.punch(4);
    this.ctx.input.rumble(0.2, 80);
  }

  private tryJump(inp: InputState) {
    const m = this.motor;
    if ((m.grounded || m.airTime < COYOTE) && this.jumpsUsed === 0) {
      launch(m, JUMP_V);
      this.jumpsUsed = 1;
      this.jumpBuffer = 0;
      this.ctx.audio.play('jump', { pos: this.position, volume: 0.8 });
    } else if (!m.grounded && this.jumpsUsed < 2) {
      // elven leap: a lighter, longer second jump with a push in the input direction
      const mag = this.wishDir(inp, _wish);
      m.vel.y = LEAP_V;
      if (mag > 0.1) {
        const sp = Math.hypot(m.vel.x, m.vel.z);
        const target = Math.max(sp, this._stats.moveSpeed) + LEAP_BOOST;
        m.vel.x = _wish.x * target;
        m.vel.z = _wish.z * target;
      }
      this.jumpsUsed = 2;
      this.jumpBuffer = 0;
      this.ctx.audio.play('jump', { pos: this.position, volume: 0.7, pitch: 1.25 });
    }
  }

  private locomotion(dt: number, inp: InputState): number {
    const m = this.motor;
    const v = this.velocity;
    const stats = this._stats;
    const wasGrounded = m.grounded;
    let dashEnded = false;

    if (this.dashT >= 0) {
      // dash: fast burst along dashDir with a quadratic ease-out, floats in the air
      // the speed peak·(1-u²) integrated exactly over this step, so the dash covers DASH_DIST at any
      // frame rate (sampling it at the step end came up short at 30 Hz and long at 240 Hz)
      const T = DASH_TIME;
      const peak = DASH_DIST / (T * (2 / 3));
      const t0 = this.dashT;
      this.dashT += dt;
      const t1 = Math.min(this.dashT, T);
      let d = peak * (t1 - t0 - (t1 * t1 * t1 - t0 * t0 * t0) / (3 * T * T));
      const done = this.dashT >= T;
      if (done) d += stats.moveSpeed * (this.dashT - T); // the rest of the step at run speed
      const sp = d / Math.max(1e-6, dt);
      v.x = this.dashDir.x * sp;
      v.z = this.dashDir.z * sp;
      v.y = Math.max(v.y, 0) * 0.5;
      this.facing = dampAngle(this.facing, yawOf(this.dashDir.x, this.dashDir.z), 30, dt);
      if (done) {
        this.dashT = -1;
        dashEnded = true;
      }
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      v.x = this.lungeVel.x;
      v.z = this.lungeVel.z;
      if (this.lungeT <= 0) {
        // plant the feet: keep only a little momentum
        v.x *= 0.15;
        v.z *= 0.15;
      }
    } else {
      const mag = this.stun > 0 ? 0 : this.wishDir(inp, _wish);
      const aimingMove = this.aimHeld || this.drawing || this.focusCtl.engaged;
      const wantSprint = inp.sprintHeld && inp.moveY > 0.35 && !aimingMove && m.grounded && this.meleeHit === 0;
      this.sprint = damp(this.sprint, wantSprint && mag > 0.5 ? 1 : 0, 5, dt);
      let speed = aimingMove ? AIM_MOVE_SPEED : lerp(stats.moveSpeed, stats.moveSpeed * SPRINT_MUL, this.sprint);
      if (this.meleeHit > 0) speed *= 0.35;
      const tx = _wish.x * speed * mag;
      const tz = _wish.z * speed * mag;
      let dx = tx - v.x;
      let dz = tz - v.z;
      let accel: number;
      if (!m.grounded) accel = AIR_ACCEL;
      else if (tx * v.x + tz * v.z < 0) accel = REVERSE_ACCEL;
      else accel = tx * tx + tz * tz >= v.x * v.x + v.z * v.z ? ACCEL : DECEL;
      const dl = Math.hypot(dx, dz);
      const maxD = accel * dt;
      if (dl > maxD) {
        dx *= maxD / dl;
        dz *= maxD / dl;
      }
      v.x += dx;
      v.z += dz;
      // facing
      if (aimingMove || this.meleeHit > 0) {
        if (this.meleeHit === 0) this.facing = dampAngle(this.facing, this.camera.yaw, 18, dt);
      } else if (mag > 0.1) {
        const turn = m.grounded ? lerp(14, 7, this.sprint) : 6;
        this.facing = dampAngle(this.facing, yawOf(_wish.x, _wish.z), turn, dt);
      }
    }

    this.facing = wrapAngle(this.facing + m.platformYaw);
    this.pushOutOfBodies();
    const r = stepMotor(this.ctx.physics, m, dt, this.dashT >= 0);
    if (dashEnded && !r.hitWall) {
      // hand over to running at full speed (the last step's average speed is near zero)
      v.x = this.dashDir.x * stats.moveSpeed;
      v.z = this.dashDir.z * stats.moveSpeed;
    }
    if (r.stepped > 0) this.visualY -= r.stepped;
    this.visualY = damp(this.visualY, 0, 14, dt);

    if (m.grounded) {
      this.jumpsUsed = 0;
      this.airDashUsed = false;
      this.safeT += dt;
      if (this.safeT > 0.5 && m.groundNormal.y > 0.8) {
        this.safePos.copy(this.position);
        this.safeT = 0;
      }
    } else {
      this.safeT = 0;
      if (this.jumpsUsed === 0 && m.airTime > COYOTE) this.jumpsUsed = 1; // walked off a ledge: one leap left
    }

    if (r.landed) this.onLand(r.landSpeed);

    const speedH = Math.hypot(v.x, v.z);
    // footsteps at stride cadence
    if (m.grounded && speedH > 0.6 && this.dashT < 0) {
      const stepLen = 0.6 + speedH * 0.22;
      this.strideAcc += speedH * dt;
      if (this.strideAcc >= stepLen) {
        this.strideAcc -= stepLen;
        this.footstep(speedH);
      }
    } else this.strideAcc = Math.min(this.strideAcc, 0.3);
    return speedH;
  }

  /** characters are solid to each other: never walk or lunge through a body (the dash slips past) */
  private pushOutOfBodies() {
    if (this.dashT >= 0) return;
    const p = this.position;
    for (const c of this.ctx.combatants.all()) {
      if (c === this || !c.alive) continue;
      if (c.position.y > p.y + this.height * 0.8 || c.position.y + c.height < p.y + 0.3) continue;
      const dx = p.x - c.position.x;
      const dz = p.z - c.position.z;
      const rr = this.radius + c.radius * 0.9;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        p.x += rr;
        continue;
      }
      const push = rr - d;
      p.x += (dx / d) * push;
      p.z += (dz / d) * push;
      // lose the velocity into the body
      const vn = (this.velocity.x * dx + this.velocity.z * dz) / d;
      if (vn < 0) {
        this.velocity.x -= (dx / d) * vn;
        this.velocity.z -= (dz / d) * vn;
      }
    }
  }

  private dustColor(): number {
    switch (this.motor.groundMaterial) {
      case 'snow':
        return 0xe8eef2;
      case 'stone':
        return 0x8a8478;
      case 'grass':
      case 'leaves':
        return 0x5a5a3a;
      case 'wood':
        return 0x7a6a50;
      default:
        return 0x6a5a44;
    }
  }

  private footstep(speed: number) {
    const mat = this.motor.groundMaterial;
    const name = mat === 'water' ? 'footstep_water' : mat === 'stone' || mat === 'metal' || mat === 'ice' || mat === 'wood' ? 'footstep_stone' : 'footstep';
    const pitch = (mat === 'wood' ? 0.8 : mat === 'snow' ? 0.85 : 1) * (0.92 + Math.random() * 0.16);
    this.ctx.audio.play(name, { pos: this.position, volume: clamp(0.25 + speed / 12, 0.25, 0.85), pitch });
    if (mat === 'water') this.ctx.fx.splash(this.position, 0.25);
  }

  private onLand(speed: number) {
    if (speed < 3) return;
    const k = clamp((speed - 3) / 14, 0, 1);
    this.ctx.audio.play(this.motor.groundMaterial === 'water' ? 'splash' : 'land', { pos: this.position, volume: 0.4 + k * 0.6, pitch: 1.05 - k * 0.2 });
    if (this.motor.groundMaterial === 'water') this.ctx.fx.splash(this.position, 0.5 + k);
    else this.ctx.fx.dust(this.position, Math.round(3 + k * 10), this.dustColor());
    if (k > 0.35) {
      this.camera.shake(0.12 + k * 0.25, 0.25);
      this.ctx.input.rumble(0.2 + k * 0.4, 90);
    }
    this.visualY -= 0.06 * k;
  }

  // ── bow ────────────────────────────────────────────────────────────────────
  private updateBow(dt: number, inp: InputState, can: boolean) {
    if (!can) {
      if (this.drawing && !this.alive) this.drawing = false;
      if (this.drawing && this.stun > 0) this.drawing = false;
      if (this.drawing && (this.meleeHit > 0 || this.dashT >= 0 || this.focusCtl.engaged)) {
        this.drawing = false;
        this.charge = 0;
      }
      if (this.drawing && !this.weaponsEnabled) {
        this.drawing = false;
        this.charge = 0;
      }
      return;
    }
    if (!this.drawing && inp.drawHeld && this.nock <= 0) {
      this.drawing = true;
      this.charge = 0;
      if (this.knivesOut) this.holsterKnives();
      this.ctx.audio.play('bow_draw', { pos: this.position, volume: 0.7 });
    }
    if (this.drawing) {
      this.charge = Math.min(1, this.charge + dt / Math.max(0.1, this._stats.drawTime));
      if (inp.drawReleased || !inp.drawHeld) this.loose(inp);
    }
  }

  private loose(inp: InputState) {
    const ctx = this.ctx;
    const c = Math.max(MIN_CHARGE, this.charge);
    this.drawing = false;
    this.charge = 0;
    this.nock = NOCK_TIME;
    const speed = lerp(30, 72, c);
    const damage = this._stats.arrowDamage * (0.3 + 0.7 * Math.pow(c, 1.2));
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 1.5 ? 1.35 : 1;
    const spread = THREE.MathUtils.degToRad(lerp(3.2, 0.2, c)) * (this.aimHeld ? 0.45 : 1) * moving * (this.motor.grounded ? 1 : 1.4);

    this.bowOrigin(_o);
    _aim.copy(this.camera.aimTarget);
    const fwd = this.camera.forward;
    // how far the aim point lies ahead of the bow hand along the view (metres, not a cosine)
    const ahead = _v.copy(_aim).sub(_o).dot(fwd);
    const close = this.camera.aimCombatant;
    if (close && close.alive && ahead < 1.5) {
      // point blank: the bow hand is level with (or past) the target, so launch from the crosshair
      // ray just in front of what it hits; the segment of that ray before the hit is clear
      const hitDepth = _v2.copy(_aim).sub(this.camera.aimOrigin).dot(fwd);
      _o.copy(this.camera.aimOrigin).addScaledVector(fwd, Math.max(0, hitDepth - 0.6));
    } else if (ahead < 0.3) {
      // never shoot backwards when the aim point is behind the bow (very close geometry)
      _aim.copy(_o).addScaledVector(fwd, 30);
    } else if (!this.bowLineClear(_o, _aim)) {
      // what you aim at is what you hit: launch from the crosshair ray at the bow's depth
      const depth = _v2.copy(_o).sub(this.camera.aimOrigin).dot(fwd);
      _o.copy(this.camera.aimOrigin).addScaledVector(fwd, Math.max(0, depth));
    }
    ballisticDir(_o, _aim, speed, ARROW_GRAVITY, _dir);
    let counted = false;

    // aim assist: bend toward a target within 4°, leading a moving one, never into a wall
    if (this.assistEnabled(inp.device)) {
      let best: Combatant | null = null;
      let bestA = AIM_ASSIST_MAX;
      for (const t of ctx.combatants.all()) {
        if (!t.alive || !t.targetable || !hostile(this.team, t.team)) continue;
        t.aimPoint(_v);
        if (_v.distanceToSquared(_o) > 80 * 80) continue;
        leadTarget(_o, _v, t.velocity, speed, _ld, 1);
        ballisticDir(_o, _ld, speed, ARROW_GRAVITY, _v2);
        const a = angleBetween(_dir, _v2);
        if (a < bestA && this.bowLineClear(_o, _ld, t)) {
          bestA = a;
          best = t;
        }
      }
      if (best) {
        best.aimPoint(_v);
        leadTarget(_o, _v, best.velocity, speed, _ld, 1);
        ballisticDir(_o, _ld, speed, ARROW_GRAVITY, _v2);
        rotateToward(_dir, _v2, AIM_ASSIST_MAX, _dir);
      }
    }
    spreadDir(_dir, spread, Math.random(), Math.random(), _dir);

    ctx.projectiles.fire({
      origin: _o.clone(),
      dir: _dir.clone(),
      speed,
      damage,
      team: 'player',
      owner: this,
      type: this.arrowType,
      style: 'elven',
      // accuracy counts a shot as hit once, however many bodies a piercing arrow or a triple
      // volley strikes (hits never exceed shots)
      onHit: (t, hit) => {
        this.onArrowHit(t, hit, !counted);
        counted = true;
      },
    });
    this.tally.shots++;
    ctx.audio.play('bow_release', { pos: this.position, volume: 0.6 + c * 0.4, pitch: 0.95 + c * 0.1 });
    ctx.audio.play('arrow_whoosh', { pos: _o, volume: 0.25 + c * 0.25 });
    this.camera.recoil(0.006 + c * 0.01);
    this.camera.shake(0.05 + c * 0.06, 0.12);
    ctx.input.rumble(0.15 + c * 0.25, 60);
  }

  // ── knives ─────────────────────────────────────────────────────────────────
  private pressMelee() {
    if (this.dashT >= 0) return;
    if (this.meleeHit === 0 && this.meleeRecover > 0) return; // still recovering from the finisher
    if (this.drawing) {
      this.drawing = false;
      this.charge = 0;
    }
    if (this.meleeHit === 0) {
      const next = this.comboWindow > 0 && this.lastMeleeHit > 0 && this.lastMeleeHit < 3 ? this.lastMeleeHit + 1 : 1;
      this.startMeleeHit(next);
    } else if (this.meleeT > KNIFE_HIT_TIME * 0.3) {
      this.meleeQueued = true;
    }
  }

  private startMeleeHit(n: number) {
    this.meleeHit = n;
    this.meleeT = 0;
    this.meleeQueued = false;
    this.meleeDidHit = false;
    if (!this.knivesOut) {
      this.knivesOut = true;
      this.humanoid.setWeapon('hand_r', 'elven_knives');
      this.humanoid.setWeapon('hand_l', 'elven_knives');
    }
    this.knivesTimer = 1.8;
    // lunge to the nearest enemy within 3 m, preferring what is in front / under the stick
    const ctx = this.ctx;
    const inp = ctx.input.state;
    const mag = this.wishDir(inp, _wish);
    const pref = mag > 0.2 ? yawOf(_wish.x, _wish.z) : this.camera.yaw;
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const c of ctx.combatants.all()) {
      if (!c.alive || !hostile(this.team, c.team)) continue;
      const dx = c.position.x - this.position.x;
      const dz = c.position.z - this.position.z;
      const d = Math.hypot(dx, dz) - c.radius;
      if (d > LUNGE_RANGE || Math.abs(c.position.y - this.position.y) > 1.6) continue;
      if (!meleeLineClear(ctx.physics, this, c)) continue; // never lunge at a foe behind a wall
      const ang = Math.abs(wrapAngle(yawOf(dx, dz) - pref));
      const score = d + ang * 1.2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.lungeT = 0;
    if (best) {
      const dx = best.position.x - this.position.x;
      const dz = best.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      this.facing = yawOf(dx, dz);
      // close enough for the blades to visibly connect
      const stop = best.radius + this.radius + 0.3;
      if (dist > stop + 0.05) {
        const sp = Math.min(16, (dist - stop) / LUNGE_TIME);
        this.lungeVel.set((dx / dist) * sp, 0, (dz / dist) * sp);
        this.lungeT = LUNGE_TIME;
      }
    } else {
      if (mag > 0.2) this.facing = pref;
      // small forward step
      this.lungeVel.set(Math.sin(this.facing) * 5, 0, Math.cos(this.facing) * 5);
      this.lungeT = 0.08;
    }
    ctx.audio.play('knife_slash', { pos: this.position, volume: 0.8, pitch: 0.95 + n * 0.06 });
  }

  private updateMelee(dt: number) {
    if (this.meleeHit === 0) {
      if (this.comboWindow <= 0) this.lastMeleeHit = 0;
      return;
    }
    this.meleeT += dt;
    if (!this.meleeDidHit && this.meleeT >= KNIFE_HIT_TIME * 0.4) {
      this.meleeDidHit = true;
      this.applyKnifeHit(this.meleeHit);
    }
    if (this.meleeT >= KNIFE_HIT_TIME) {
      const n = this.meleeHit;
      if (this.meleeQueued && n < 3) this.startMeleeHit(n + 1);
      else {
        this.meleeHit = 0;
        this.lastMeleeHit = n;
        this.comboWindow = n < 3 ? COMBO_WINDOW : 0;
        this.meleeQueued = false;
        // the finisher commits: a short recovery before the next combo, so mashing cannot chain
        // 1-2-3-1-2-3 at full rate (knives out-damaged the bow two to one)
        if (n === 3) this.meleeRecover = FINISHER_RECOVERY;
      }
    }
  }

  private applyKnifeHit(n: number) {
    const ctx = this.ctx;
    const dmgMul = n === 3 ? 1.8 : n === 2 ? 1.1 : 1;
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    let hits = 0;
    let killed = false;
    for (const c of ctx.combatants.all()) {
      if (!c.alive || !hostile(this.team, c.team)) continue;
      const dx = c.position.x - this.position.x;
      const dz = c.position.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d - c.radius > KNIFE_RANGE) continue;
      if (c.position.y > this.position.y + this.height || c.position.y + c.height < this.position.y + 0.2) continue;
      if (d > 0.3) {
        const cos = (dx * fx + dz * fz) / d;
        if (cos < Math.cos(KNIFE_CONE)) continue;
      }
      if (!meleeLineClear(ctx.physics, this, c)) continue;
      c.aimPoint(_v);
      _dir.set(dx, 0, dz).normalize();
      c.takeDamage({
        amount: this._stats.knifeDamage * dmgMul,
        type: 'melee',
        source: this,
        point: _v,
        dir: _dir,
        zone: 'body',
        knockback: n === 3 ? 5 : 1.2,
        stagger: n === 3,
      });
      const bk = (c as Combatant & { bloodKind?: 'red' | 'dark' | 'black' | 'ichor' }).bloodKind ?? 'dark';
      ctx.fx.blood(_v, _dir, bk, n === 3 ? 1.2 : 0.7);
      if (!c.alive) killed = true;
      hits++;
      if (hits >= 3) break;
    }
    if (hits) {
      ctx.audio.play('knife_hit', { pos: this.position, volume: 1, pitch: 0.95 + n * 0.05 });
      ctx.time.hitStop(n === 3 ? 0.085 : 0.045);
      this.camera.shake(n === 3 ? 0.32 : 0.16, 0.18);
      ctx.input.rumble(n === 3 ? 0.7 : 0.4, n === 3 ? 140 : 80);
      if (!killed) ctx.hud.hitMarker('hit');
    }
  }

  private holsterKnives() {
    if (!this.knivesOut) return;
    this.knivesOut = false;
    this.humanoid.setWeapon('hand_r', 'none');
    this.humanoid.setWeapon('hand_l', 'elven_bow');
  }

  // ── animation, post, HUD ───────────────────────────────────────────────────
  private animateBody(dt: number, speedH: number) {
    const a = this.anim;
    const m = this.motor;
    a.speed = speedH;
    // local move direction (x right, z forward)
    const cf = Math.cos(this.facing);
    const sf = Math.sin(this.facing);
    const vx = this.velocity.x;
    const vz = this.velocity.z;
    if (speedH > 0.05) {
      a.moveDir!.x = (-vx * cf + vz * sf) / speedH;
      a.moveDir!.z = (vx * sf + vz * cf) / speedH;
    } else {
      a.moveDir!.x = 0;
      a.moveDir!.z = 1;
    }
    a.grounded = this.mover ? true : m.grounded;
    a.vy = this.velocity.y;
    const focusDraw = this.focusCtl.engaged ? (this.focusCtl.state === 'volley' ? 1 - this.focusCtl.drawPulse : 0.6) : 0;
    const aimTarget = this.alive && (this.aimHeld || this.drawing || this.focusCtl.engaged || this.nock > 0) ? 1 : 0;
    a.aim = damp(a.aim ?? 0, aimTarget, 14, dt);
    a.draw = this.drawing ? this.charge : focusDraw;
    a.aimPitch = this.camera.pitch;
    if (this.meleeHit > 0) {
      this.attackAnim.kind = this.meleeHit === 1 ? 'knife1' : this.meleeHit === 2 ? 'knife2' : 'knife3';
      this.attackAnim.t = clamp(this.meleeT / KNIFE_HIT_TIME, 0, 1);
      a.attack = this.attackAnim;
    } else a.attack = null;
    a.hit = this.hitReact;
    a.dead = this.deadProgress;
    a.deathVariant = 0;
    if (this.mover) {
      a.special = this.mover.pose ?? null;
      a.specialT = this.mover.poseT ? this.mover.poseT() : 0;
    } else {
      a.special = this.stun > 0.1 && this.alive ? 'stagger' : null;
      a.specialT = 0;
    }
    a.lookAt = null;
    this.humanoid.animate(dt, a);

    this.object.rotation.y = this.facing;
    this.body!.root.position.y = this.visualY;
    this.afterAnimate();
  }

  private updatePostAndHud(dtReal: number) {
    const ctx = this.ctx;
    const post = ctx.engine.post;
    // damage flash decays (the engine never decays it); low health pulses
    const low = this.alive && this.hp < this.maxHp * 0.25 ? 0.1 + Math.sin(ctx.time.real * 5) * 0.05 : 0;
    this.flash = Math.max(low, post.damageFlash - dtReal * 1.6);
    post.damageFlash = this.alive ? this.flash : Math.max(0.3, this.flash);

    const hud = ctx.hud;
    const L = this.lastHud;
    const hp = Math.ceil(this.hp);
    if (hp !== L.hp || this.maxHp !== L.max) {
      hud.setHealth(hp, this.maxHp);
      L.hp = hp;
      L.max = this.maxHp;
    }
    const f = Math.round(this.focus * 2) / 2;
    if (f !== L.focus || this._stats.focusMax !== L.fmax || this.focusCtl.engaged !== L.factive) {
      hud.setFocus(f, this._stats.focusMax, this.focusCtl.engaged);
      L.focus = f;
      L.fmax = this._stats.focusMax;
      L.factive = this.focusCtl.engaged;
    }
    const visible = this.alive && this.controlsEnabled && this.weaponsEnabled && (!this.mover || !!this.mover.allowShoot) && !this.camera.shot;
    const charge = Math.round((this.drawing ? this.charge : 0) * 50) / 50;
    const aiming = this.aiming || this.focusCtl.engaged;
    if (charge !== L.charge || aiming !== L.aiming || visible !== L.visible) {
      hud.setCrosshair(charge, aiming, visible);
      L.charge = charge;
      L.aiming = aiming;
      L.visible = visible;
    }
    let unlocked: ArrowType[] = ['standard'];
    if (this.arrowType !== L.arrow || L.arrows === 0) {
      try {
        unlocked = ctx.progression?.unlockedArrows?.() ?? unlocked;
      } catch {
        /* default */
      }
      if (!unlocked.includes(this.arrowType)) this.arrowType = 'standard';
      hud.setArrowType(this.arrowType, unlocked);
      L.arrow = this.arrowType;
      L.arrows = unlocked.length;
    }
  }

  dispose(): void {
    this.focusCtl.cancel();
    super.dispose();
  }
}

export function createPlayer(ctx: GameContext): PlayerAPI {
  return new Player(ctx);
}
