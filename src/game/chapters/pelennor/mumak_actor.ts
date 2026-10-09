/**
 * The mûmak in play: a walking, trampling, trumpeting 14 m war beast.
 *
 *  - MumakActor (team 'neutral': arrows stick in its hide, allies and enemies never "fight" it)
 *    walks a route of Paths, plants its feet with a ground-shaking thud (oliphaunt_step, camera shake
 *    within ~70 m, dust, trample damage), telegraphs each footfall with a ring on the ground, and
 *    attacks whoever stands in front of it: trunk sweep, tusk gore and a rearing stomp, each with a
 *    ground decal during the wind-up. Moving cylinder colliders keep you out of its legs.
 *  - WeakPoint combatants (team 'enemy'): the four girth buckles and the skull. Each arrow that hits
 *    an ARMED weak point counts as one hit (girths 2, skull 3). Girths are only targetable from the
 *    side they are on, so aim assist and the bot pick the reachable ones.
 *  - The howdah crew (crew.ts), the rope ladder, the howdah slide-off and the two-stage collapse.
 *  - FarMumak: the distant herd (low LOD, no gameplay).
 */
import * as THREE from 'three';
import type { ColliderHandle, Combatant, CombatRayHit, DamageInfo, LevelAPI } from '../../../core/types';
import { BaseCombatant } from '../../../actors/combatant';
import { createMumak, GIRTHS, MUMAK_ACTION_TIME, MUMAK_STRIKE, type MumakAction, type MumakModel } from '../../../creatures/mumak';
import type { Path } from '../../../world';
import { clamp, damp, dampAngle, wrapAngle, yawOf } from '../../../core/math';
import { mulberry32 } from '../../../core/rng';
import { CrewMember, type CrewHost } from './crew';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

/** a route leg: follow `path` (looping when closed) */
export interface RouteLeg {
  path: Path;
  loop: boolean;
}

function wrapS(path: Path, s: number, loop: boolean): number {
  if (!loop) return clamp(s, 0, path.length);
  const L = path.length;
  return ((s % L) + L) % L;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weak points and the boss-bar proxy
// ─────────────────────────────────────────────────────────────────────────────

let markTex: THREE.CanvasTexture | null = null;
/** a reticle: ring, four ticks and a centre dot, with a dark rim so it reads on pale hide and sky */
function markTexture(): THREE.CanvasTexture {
  if (markTex) return markTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  for (const [w, col] of [[11, 'rgba(20,8,0,0.55)'], [5, 'rgba(255,255,255,1)']] as [number, string][]) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(64, 64, 38, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
      g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.arc(64, 64, 7, 0, Math.PI * 2);
  g.fill();
  markTex = new THREE.CanvasTexture(c);
  markTex.colorSpace = THREE.SRGBColorSpace;
  markTex.userData.shared = true;
  return markTex;
}

export class WeakPoint extends BaseCombatant {
  /** hits only count while armed */
  armed = false;
  /** girth side (+1 left, -1 right) for the "can I see it" test; 0 = always */
  side = 0;
  onHit: ((wp: WeakPoint) => void) | null = null;
  /** the pulsing reticle shown while armed (girths: on the near flank only; skull: through the hide) */
  private readonly mark: THREE.Sprite;
  private markT = 0;
  private flash = 0;
  constructor(
    private readonly level: LevelAPI,
    readonly anchor: THREE.Object3D,
    private readonly owner: MumakActor,
    name: string,
    hits: number,
    zoneR: number,
  ) {
    super({ team: 'enemy', name, maxHp: hits, radius: 0.6, height: 1.2, bloodKind: 'dark', countsForRivalry: false });
    this.addZoneSphere(anchor, zoneR, 'weakpoint', 1);
    this.aimBone = anchor;
    this.targetable = false;
    this.corpseTime = -1;
    const skull = hits >= 3;
    this.mark = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: markTexture(), color: skull ? 0xffb43c : 0xffd060, transparent: true, depthTest: !skull, depthWrite: false, fog: false, opacity: 0 }),
    );
    this.mark.name = `mark:${name}`;
    this.mark.renderOrder = 6;
    this.mark.visible = false;
    this.mark.userData.noAO = true;
    this.markSize = skull ? 2.4 : 1.25;
    level.root.add(this.mark);
  }
  private readonly markSize: number;
  protected filterDamage(d: DamageInfo): number {
    if (!this.armed || d.type !== 'arrow') return 0;
    return 1;
  }
  protected onDamaged(d: DamageInfo): void {
    const fx = this.level.ctx.fx;
    if (d.point) {
      fx.sparks(d.point, _v.set(0, 1, 0), 6);
      fx.dust(d.point, 2, 0x6a5040);
    }
    this.level.ctx.audio.play('arrow_hit_wood', { pos: d.point ?? this.position, volume: 1, pitch: 0.8 });
    this.flash = 1;
    this.onHit?.(this);
  }
  update(dt = 0): void {
    this.anchor.getWorldPosition(this.object.position);
    this.object.position.y -= 0.6;
    let see = false;
    if (this.alive) {
      see = this.armed;
      if (see && this.side !== 0) {
        // left of the beast in world = its +X axis
        _v.set(this.side, 0, 0).applyQuaternion(this.owner.object.quaternion);
        _a.copy(this.level.ctx.player.position).sub(this.object.position);
        see = _v.dot(_a) > 2;
      }
      this.targetable = see;
    }
    // the reticle: pulses while armed, flares on a hit
    const mk = this.mark;
    mk.visible = see && !this.owner.dead;
    if (mk.visible) {
      this.markT += dt;
      this.flash = Math.max(0, this.flash - dt * 2.5);
      this.anchor.getWorldPosition(mk.position);
      if (this.side !== 0) {
        // just proud of the strap, on the flank it is seen from
        _v.set(this.side * 0.45, 0, 0).applyQuaternion(this.owner.object.quaternion);
        mk.position.add(_v);
      } else mk.position.y += 0.9;
      const pulse = 0.5 + 0.5 * Math.sin(this.markT * 5.5);
      mk.scale.setScalar(this.markSize * (1 + 0.12 * pulse + 0.5 * this.flash));
      (mk.material as THREE.SpriteMaterial).opacity = 0.55 + 0.3 * pulse + 0.15 * this.flash;
    }
    this.afterAnimate();
  }
  protected onDied(): void {
    this.mark.visible = false;
  }
  dispose(): void {
    this.mark.removeFromParent();
    this.mark.material.dispose();
    super.dispose();
  }
}

/** a combatant-shaped stand-in for the boss bar: never registered, so it never counts as a kill */
export class BossProxy extends BaseCombatant {
  constructor(name: string, maxHp: number) {
    super({ team: 'neutral', name, maxHp, radius: 0.1, height: 0.1 });
    this.targetable = false;
  }
  update(): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground decals (telegraphs)
// ─────────────────────────────────────────────────────────────────────────────

let ringTex: THREE.CanvasTexture | null = null;
function decalTexture(): THREE.CanvasTexture {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  // a broad, solid band (it is seen at a grazing angle from 40 m+) around a faint fill
  grad.addColorStop(0, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  grad.addColorStop(0.62, 'rgba(255,255,255,1)');
  grad.addColorStop(0.9, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  ringTex = new THREE.CanvasTexture(c);
  ringTex.colorSpace = THREE.SRGBColorSpace;
  ringTex.userData.shared = true;
  return ringTex;
}

function decalMesh(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: decalTexture(), color, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true }),
  );
  m.renderOrder = 3;
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noAO = true;
  m.visible = false;
  m.frustumCulled = false;
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// The mûmak
// ─────────────────────────────────────────────────────────────────────────────

export interface MumakActorOpts {
  level: LevelAPI;
  name: string;
  seed: number;
  ground: (x: number, z: number) => number;
  crew?: boolean;
  /** walking speed (m/s) */
  cruise?: number;
}

const _cam = new THREE.Vector3();

export class MumakActor extends BaseCombatant implements CrewHost {
  readonly model: MumakModel;
  readonly girths: WeakPoint[] = [];
  readonly skull: WeakPoint;
  readonly crew: CrewMember[] = [];
  readonly level: LevelAPI;
  private readonly ground: (x: number, z: number) => number;
  // ── route ──
  private route: RouteLeg[] = [];
  private leg = 0;
  s = 0;
  cruise: number;
  /** multiplier on cruise (slowed by cut girths) */
  speedMul = 1;
  speed = 0;
  yaw = 0;
  /** stop walking (scripted) */
  halted = false;
  // ── state flags the chapter sets ──
  /** the player is on the beast (no trample, no attacks, crew fight on the deck) */
  mounted = false;
  /** the player is on the deck */
  onDeck = false;
  /** crew shoot */
  crewAlert = false;
  /** attacks enabled */
  aggressive = true;
  // ── action ──
  private action: MumakAction = 'none';
  private actionT = 0;
  private struck = false;
  private attackCd = 3;
  private trumpetT = 6;
  // ── collapse ──
  private collapseTarget = 0;
  private collapseRate = 0.15;
  private impactKnees = false;
  private impactBody = false;
  dead = false;
  // ── howdah ──
  howdahState: 'on' | 'sliding' | 'gone' = 'on';
  private howdahT = 0;
  private readonly howdahVel = new THREE.Vector3();
  private readonly howdahSpin = new THREE.Vector3();
  private fallKiller: Combatant | null = null;
  private readonly girthDone = [false, false, false, false];
  // ── physics / fx ──
  private readonly legCols: ColliderHandle[] = [];
  private bodyCol: ColliderHandle | null = null;
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringFlash = [0, 0, 0, 0];
  private readonly zoneDecals: Record<'sweep' | 'gore' | 'stomp', THREE.Mesh>;
  private readonly rnd: () => number;
  private passT = 0;
  /** added to the level (the level then owns its disposal) */
  registered = false;
  private castsShadow = true;
  /** the meshes that cast a shadow by design (toggled together by distance) */
  private readonly casters: THREE.Object3D[] = [];
  /** called on every footfall (world position, foot index) */
  onFootfall: ((pos: THREE.Vector3, i: number) => void) | null = null;
  /** called when a girth is cut */
  onGirthCut: ((i: number) => void) | null = null;

  constructor(o: MumakActorOpts) {
    super({ team: 'neutral', name: o.name, maxHp: 1, radius: 3.2, height: 3, bloodKind: 'red', countsForRivalry: false });
    this.level = o.level;
    this.ground = o.ground;
    this.cruise = o.cruise ?? 2.6;
    this.rnd = mulberry32(o.seed * 31 + 7);
    this.corpseTime = -1;
    this.targetable = false;
    this.model = createMumak({ seed: o.seed, lod: 'hero', howdah: true });
    this.object.add(this.model.object);
    const b = this.model.bones;
    // the hide: arrows stick, nothing is hurt
    this.addZoneCapsule(b.pelvis, b.chest, 3.5, 'body', 1, new THREE.Vector3(0, -2.4, 1.5), new THREE.Vector3(0, -2.6, 0.6));
    this.addZoneSphere(b.head, 1.7, 'body', 1, new THREE.Vector3(0, 0.2, 0.4));
    this.addZoneCapsule(b.neck, b.head, 2.2, 'body', 1, new THREE.Vector3(0, -0.6, -0.8));
    for (const [u, m, e] of [['humer_l', 'radius_l', 'fpaw_l'], ['humer_r', 'radius_r', 'fpaw_r'], ['femur_l', 'tibia_l', 'hpaw_l'], ['femur_r', 'tibia_r', 'hpaw_r']]) {
      this.addZoneCapsule(b[u], b[m], 1.15, 'body');
      this.addZoneCapsule(b[m], b[e], 0.95, 'body');
    }
    this.addZoneCapsule(b.trunk1, b.trunk3, 0.75, 'body');
    this.addZoneCapsule(b.trunk3, b.trunk6, 0.5, 'body');
    this.aimBone = b.chest;
    // weak points
    GIRTHS.forEach((g, i) => {
      const wp = new WeakPoint(this.level, this.model.buckleAnchors[i], this, 'Girth strap', 2, 0.8);
      wp.side = g.side;
      wp.onDeath = null;
      this.girths.push(wp);
    });
    this.skull = new WeakPoint(this.level, this.model.skullAnchor, this, 'Mûmak', 3, 2.4);
    // leg colliders and decals
    const physics = this.level.ctx.physics;
    for (let i = 0; i < 4; i++) {
      this.legCols.push(physics.addCylinder(0, 0, 1.15, -50, -44, { walkable: false, blocksArrows: false, blocksCamera: false, solid: true, material: 'dirt', tag: 'mumak_leg' }));
      const ring = decalMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 0xff6a2a);
      this.rings.push(ring);
      this.level.root.add(ring);
    }
    this.zoneDecals = {
      sweep: decalMesh(new THREE.RingGeometry(3, 15, 40, 1, Math.PI * 0.12, Math.PI * 0.76).rotateX(-Math.PI / 2), 0xff4a1a),
      gore: decalMesh(new THREE.PlaneGeometry(9, 13).rotateX(-Math.PI / 2), 0xff4a1a),
      stomp: decalMesh(new THREE.CircleGeometry(10, 40).rotateX(-Math.PI / 2), 0xff4a1a),
    };
    for (const d of Object.values(this.zoneDecals)) this.level.root.add(d);
    this.model.object.traverse((ob) => {
      if ((ob as THREE.Mesh).isMesh && ob.castShadow) this.casters.push(ob);
    });
    if (o.crew !== false) this.spawnCrew();
  }

  /** register with the level: the beast, its weak points and its crew */
  register(): void {
    this.registered = true;
    this.level.addCombatant(this);
    for (const g of this.girths) this.level.addCombatant(g);
    this.level.addCombatant(this.skull);
    for (const c of this.crew) this.level.addCombatant(c);
  }

  /** man the howdah (once): built at start() so the crew humanoids are cache hits after preload */
  spawnCrew(): void {
    if (this.crew.length) return;
    const h = this.model.howdah!;
    const roles: ('archer' | 'spear')[] = ['archer', 'archer', 'archer', 'spear'];
    h.slots.forEach((slot, i) => {
      const c = new CrewMember(this.level, h.object, this, roles[i], slot, 40 + i * 7 + (this.rnd() * 5) | 0);
      c.half = h.half;
      c.deckY = h.deckY;
      this.crew.push(c);
    });
    const drv = new CrewMember(this.level, this.model.driverSeat, this, 'driver', new THREE.Vector3(0, 0, 0), 77);
    this.crew.push(drv);
  }

  // ── CrewHost ──
  playerAboard(): boolean {
    return this.onDeck || this.mounted;
  }
  alert(): boolean {
    return this.crewAlert;
  }
  climbing(): boolean {
    return this.mounted && !this.onDeck && this.howdahState === 'on';
  }
  groundAt(x: number, z: number): number {
    return this.ground(x, z);
  }

  crewAlive(): number {
    let n = 0;
    for (const c of this.crew) if (c.alive) n++;
    return n;
  }
  girthsCut(): number {
    let n = 0;
    for (const g of this.girths) if (!g.alive) n++;
    return n;
  }

  // ── route ──
  setRoute(route: RouteLeg[], s0 = 0): void {
    this.route = route;
    this.leg = 0;
    this.s = s0;
    const r = route[0];
    r.path.at(wrapS(r.path, s0, r.loop), _p);
    this.object.position.set(_p.x, this.ground(_p.x, _p.z), _p.z);
    this.tangent(r, s0, _v);
    this.yaw = yawOf(_v.x, _v.z);
    this.object.rotation.set(0, this.yaw, 0);
    this.object.updateMatrixWorld(true);
  }
  /** jump the current route leg to the point nearest (x, z) */
  snapRoute(route: RouteLeg[]): void {
    const n = route[0].path.nearest(this.object.position.x, this.object.position.z);
    this.route = route;
    this.leg = 0;
    this.s = n.s;
  }
  private tangent(r: RouteLeg, s: number, out: THREE.Vector3): THREE.Vector3 {
    r.path.at(wrapS(r.path, s - 3, r.loop), _a);
    r.path.at(wrapS(r.path, s + 6, r.loop), _b);
    return out.subVectors(_b, _a).setY(0).normalize();
  }
  /** index of the route leg being walked */
  get legIndex(): number {
    return this.leg;
  }
  /** the end of a non-looping leg was reached */
  get routeDone(): boolean {
    const r = this.route[this.leg];
    return !!r && !r.loop && this.leg === this.route.length - 1 && this.s >= r.path.length - 0.5;
  }

  // ── scripted actions ──
  startAction(a: MumakAction, dir = 1): void {
    if (this.dead) return;
    this.action = a;
    this.actionT = 0;
    this.struck = false;
    this.model.animator.actionDir = dir;
    if (a !== 'none' && a !== 'thrash') this.level.ctx.audio.play('oliphaunt_trumpet', { pos: this.model.skullAnchor.getWorldPosition(_v), volume: 1.2 });
  }
  get busy(): boolean {
    return this.action !== 'none';
  }
  /** animate the collapse toward t (0.5 = knelt forward, 1 = on its side) over `seconds` */
  collapseTo(t: number, seconds: number): void {
    this.dead = true;
    this.collapseTarget = t;
    this.collapseRate = Math.abs(t - this.model.animator.collapse) / Math.max(0.1, seconds);
    this.action = 'none';
    this.model.animator.action = 'none';
  }
  /** pose instantly at a collapse state (cp restore) */
  setCollapsed(t: number): void {
    this.dead = true;
    this.collapseTarget = t;
    this.model.animator.collapse = t;
    this.impactKnees = this.impactBody = true;
    if (t >= 1) this.becomeCorpse();
  }

  attackCdReset(s: number): void {
    this.attackCd = s;
  }

  // ── howdah ──
  /** a fallen beast's howdah, smashed on the ground beside it (checkpoint restore) */
  placeHowdahWreck(): void {
    const h = this.model.howdah;
    if (!h || this.howdahState !== 'on') return;
    this.level.root.attach(h.object);
    _p.set(-8, 0, -2.5);
    this.object.updateMatrixWorld(true);
    this.object.localToWorld(_p);
    h.object.position.set(_p.x, this.ground(_p.x, _p.z) + 2.4, _p.z);
    h.object.rotation.set(0.12, this.yaw + 0.5, 1.35, 'YXZ');
    this.howdahState = 'gone';
    if (this.model.ladder) {
      this.model.ladder.upper.visible = false;
      this.model.ladder.pivot.visible = false;
    }
  }

  /** cut loose: the howdah slides off the back and crashes to the ground; crew still on it fall */
  dropHowdah(killer: Combatant | null): void {
    if (this.howdahState !== 'on' || !this.model.howdah) return;
    const h = this.model.howdah;
    this.howdahState = 'sliding';
    this.howdahT = 0;
    this.fallKiller = killer;
    this.level.root.attach(h.object);
    // slide back and to the right (the ladder side is left), tumbling
    _v.set(-0.45, 0, -1).applyQuaternion(this.object.quaternion).normalize();
    this.howdahVel.set(_v.x * 3.4, 0.6, _v.z * 3.4);
    this.howdahSpin.set(-0.5, 0.25, 0.9);
    if (this.model.ladder) {
      this.model.ladder.upper.visible = false;
      this.model.ladder.pivot.visible = false;
    }
    this.level.ctx.audio.play('web_tear', { pos: h.object.getWorldPosition(_v), volume: 1.2, pitch: 0.5 });
    for (const c of this.crew) {
      if (c.role === 'driver') continue;
      if (c.alive) {
        c.lastDamage = { amount: 999, type: 'fall', source: killer };
        c.detach(null);
      }
    }
  }

  private updateHowdah(dt: number): void {
    if (this.howdahState !== 'sliding' || !this.model.howdah) return;
    const o = this.model.howdah.object;
    this.howdahT += dt;
    if (this.howdahT < 0.7) {
      // sliding along the back first
      o.position.addScaledVector(this.howdahVel, dt * 0.6);
      o.rotateX(-0.35 * dt);
    } else {
      this.howdahVel.y -= 22 * dt;
      o.position.addScaledVector(this.howdahVel, dt);
      o.rotation.x += this.howdahSpin.x * dt;
      o.rotation.z += this.howdahSpin.z * dt;
    }
    const g = this.ground(o.position.x, o.position.z);
    if (o.position.y <= g + 0.4 && this.howdahT > 0.7) {
      o.position.y = g + 0.4;
      this.howdahState = 'gone';
      const ctx = this.level.ctx;
      _p.copy(o.position);
      ctx.fx.debris(_p, 12, 0x5a4030);
      ctx.fx.dust(_p, 50, 0x9a8a70);
      ctx.audio.play('stone_crumble', { pos: _p, volume: 1.2, pitch: 0.7 });
      ctx.audio.play('explosion', { pos: _p, volume: 0.6, pitch: 0.6 });
      const d = ctx.player.position.distanceTo(_p);
      if (d < 60) ctx.player.camera.shake(0.5 * (1 - d / 60), 0.6);
      // settle on its side
      o.rotation.set(o.rotation.x * 0.3, o.rotation.y, Math.sign(o.rotation.z || 1) * 1.35);
      o.position.y = g + 2.4;
      for (const c of this.crew) if (c.alive && c.role !== 'driver' && c.attached) c.kill(this.fallKiller);
    }
  }

  // ── combatant ──
  protected filterDamage(): number {
    return 0;
  }
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CombatRayHit | null {
    // the coarse test uses the radius: widen it for the ray test only (the body is ~24 m long)
    const r = this.radius;
    this.radius = 6;
    const h = super.raycast(origin, dir, maxDist);
    this.radius = r;
    return h;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const ctx = this.level.ctx;
    const an = this.model.animator;
    const player = ctx.player;

    // ── locomotion along the route ──
    const leg = this.route[this.leg];
    let want = this.dead || this.halted ? 0 : this.cruise * this.speedMul;
    if (this.action !== 'none' && this.action !== 'thrash') want *= 0.15;
    this.speed = damp(this.speed, want, this.dead ? 3 : 0.9, dt);
    let turn = 0;
    if (leg && !this.dead) {
      this.s += this.speed * dt;
      if (!leg.loop && this.s >= leg.path.length && this.leg < this.route.length - 1) {
        // hand over to the next leg where it is nearest
        this.leg++;
        const nx = this.route[this.leg];
        this.s = nx.path.nearest(this.object.position.x, this.object.position.z).s;
      }
      const cur = this.route[this.leg];
      this.s = wrapS(cur.path, this.s, cur.loop);
      cur.path.at(this.s, _p);
      this.tangent(cur, this.s, _v);
      const prev = this.yaw;
      this.yaw = dampAngle(this.yaw, yawOf(_v.x, _v.z), 0.9, dt);
      turn = wrapAngle(this.yaw - prev) / dt;
      // drift onto the path (the body lags in the turns instead of snapping)
      this.object.position.x = damp(this.object.position.x, _p.x, 3, dt);
      this.object.position.z = damp(this.object.position.z, _p.z, 3, dt);
    }
    const ox = this.object.position.x;
    const oz = this.object.position.z;
    this.object.position.y = this.ground(ox, oz);
    this.object.rotation.set(0, this.yaw, 0);
    this.velocity.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);

    // ── AI: attack whoever stands in front ──
    if (!this.dead && this.aggressive && !this.mounted && player.alive) this.think(dt);
    if (this.action !== 'none') {
      const dur = MUMAK_ACTION_TIME[this.action];
      this.actionT += dt / dur;
      if (!this.struck && this.actionT >= MUMAK_STRIKE[this.action]) {
        this.struck = true;
        this.strike(this.action);
      }
      if (this.actionT >= 1) {
        if (this.action === 'thrash') this.actionT = 0;
        else this.action = 'none';
      }
    }
    if (!this.dead && this.action === 'none') {
      this.trumpetT -= dt;
      if (this.trumpetT <= 0) {
        this.trumpetT = 14 + this.rnd() * 12;
        if (this.speed > 0.5) this.startAction('trumpet');
      }
    }

    // ── render passes: the hero mesh (~65 k triangles) only casts into the shadow box and joins
    // the ambient-occlusion pre-pass when it is close enough for either to show ──
    this.passT -= dt;
    if (this.passT <= 0) {
      this.passT = 0.25;
      const dp = Math.hypot(player.position.x - this.object.position.x, player.position.z - this.object.position.z);
      const dc = ctx.engine.camera.getWorldPosition(_cam).distanceTo(this.object.position);
      const cast = dp < 60;
      if (cast !== this.castsShadow) {
        this.castsShadow = cast;
        for (const o of this.casters) o.castShadow = cast;
      }
      this.model.object.userData.noAO = dc > 70;
    }
    // ── animate ──
    an.speed = this.speed;
    an.turn = clamp(turn, -0.3, 0.3);
    an.action = this.action;
    an.actionT = this.action === 'none' ? 0 : clamp(this.actionT, 0, 1);
    if (an.collapse !== this.collapseTarget) {
      const prevC = an.collapse;
      an.collapse = an.collapse < this.collapseTarget ? Math.min(this.collapseTarget, an.collapse + this.collapseRate * dt) : Math.max(this.collapseTarget, an.collapse - this.collapseRate * dt);
      if (!this.impactKnees && prevC < 0.33 && an.collapse >= 0.33) {
        this.impactKnees = true;
        this.impact(1.0, this.model.bones.fpaw_l.getWorldPosition(_p).lerp(this.model.bones.fpaw_r.getWorldPosition(_a), 0.5));
      }
      if (!this.impactBody && prevC < 0.93 && an.collapse >= 0.93) {
        this.impactBody = true;
        this.impact(1.6, this.model.bones.spine.getWorldPosition(_p));
        this.becomeCorpse();
      }
    }
    // look at the player when he is around and close to the front
    if (!this.dead && player.alive && !this.mounted) {
      _v.copy(player.position);
      this.object.worldToLocal(_v);
      const yawTo = Math.atan2(_v.x, _v.z - 8);
      const near = _v.z > 0 && Math.hypot(_v.x, _v.z) < 40 ? 1 : 0;
      an.lookYaw = damp(an.lookYaw, clamp(yawTo, -0.5, 0.5) * near, 1.5, dt);
      an.lookPitch = damp(an.lookPitch, near * 0.12, 1.5, dt);
    } else {
      an.lookYaw = damp(an.lookYaw, 0, 1.5, dt);
      an.lookPitch = damp(an.lookPitch, 0, 1.5, dt);
    }
    // ground under each foot (feet IK)
    for (let i = 0; i < 4; i++) {
      an.feet[i].getWorldPosition(_a);
      an.footDy[i] = clamp(this.ground(_a.x, _a.z) - this.object.position.y, -1.5, 1.5);
    }
    an.update(dt);
    this.object.updateMatrixWorld(true);

    // ── footfalls ──
    for (let i = 0; i < 4; i++) if (an.stepped[i]) this.footfall(i);
    this.updateRings(dt);
    this.updateZoneDecal();
    // ── legs block the way ──
    for (let i = 0; i < 4; i++) {
      const c = this.legCols[i];
      if (!c.enabled) continue;
      an.feet[i].getWorldPosition(_a);
      const knee = an.feet[i].parent as THREE.Object3D;
      knee.getWorldPosition(_b);
      _a.lerp(_b, 0.5);
      _a.y = this.ground(_a.x, _a.z) - 0.5;
      c.setTransform(_a);
    }
    // ── rope ladder swings with the gait ──
    if (this.model.ladder) {
      const t = an.t;
      const sw = Math.min(1, this.speed / 2);
      this.model.ladder.swing(Math.sin(t * 1.4) * 0.06 * sw - this.speed * 0.02, Math.sin(t * 0.9 + 1) * 0.05 * sw + (this.mounted ? 0 : 0.02));
    }
    this.updateHowdah(dt);
    // crew and weak points only join the fight when they are live (otherwise they would count as
    // living foes: music, Gimli's pace, the bot)
    for (const c of this.crew) if (c.alive) c.team = this.crewAlert ? 'enemy' : 'neutral';
    for (const g of this.girths) if (g.alive) g.team = g.armed ? 'enemy' : 'neutral';
    if (this.skull.alive) this.skull.team = this.skull.armed ? 'enemy' : 'neutral';
    // girths cut by arrows: the strap swings loose, the beast falters
    for (let i = 0; i < 4; i++) {
      if (this.girthDone[i] || this.girths[i].alive) continue;
      this.girthDone[i] = true;
      this.model.cutGirth(i);
      this.model.buckleAnchors[i].getWorldPosition(_p);
      ctx.fx.sparks(_p, _v.set(0, 1, 0), 14);
      ctx.fx.dust(_p, 8, 0x6a5040);
      ctx.audio.play('web_tear', { pos: _p, volume: 1.3, pitch: 0.55 });
      ctx.audio.play('oliphaunt_trumpet', { pos: _p, volume: 1.0, pitch: 1.1 });
      this.onGirthCut?.(i);
    }
    this.afterAnimate();
  }

  private becomeCorpse(): void {
    for (const c of this.legCols) c.enabled = false;
    if (!this.bodyCol) {
      this.object.updateMatrixWorld(true);
      this.model.bones.spine.getWorldPosition(_p);
      _p.y = this.ground(_p.x, _p.z) + 3.6;
      this.bodyCol = this.level.ctx.physics.addBox(_p.clone(), [4.2, 3.6, 9], this.yaw, { walkable: false, material: 'dirt', tag: 'mumak_body', blocksCamera: false });
    }
  }

  /** knees or body hitting the ground */
  private impact(scale: number, at: THREE.Vector3): void {
    const ctx = this.level.ctx;
    at.y = this.ground(at.x, at.z) + 0.3;
    ctx.fx.dust(at, 50 * scale, 0x9a8a70);
    ctx.fx.debris(at, 10 * scale, 0x5a4a38);
    ctx.audio.play('oliphaunt_step', { pos: at, volume: 1.6, pitch: 0.7 });
    ctx.audio.play('explosion', { pos: at, volume: 0.5 * scale, pitch: 0.5 });
    const d = ctx.player.position.distanceTo(at);
    ctx.player.camera.shake(Math.max(0.15, 0.7 * scale * (1 - d / 120)), 1.0);
    ctx.input.rumble(0.6, 300);
  }

  private footfall(i: number): void {
    const ctx = this.level.ctx;
    const foot = this.model.animator.feet[i];
    foot.getWorldPosition(_p);
    _p.y = this.ground(_p.x, _p.z);
    ctx.fx.dust(_p, 9, 0x8f8068);
    ctx.audio.play('oliphaunt_step', { pos: _p, volume: 1.1, pitch: 0.9 + this.rnd() * 0.15 });
    const player = ctx.player;
    const d = Math.hypot(player.position.x - _p.x, player.position.z - _p.z);
    if (!this.mounted && d < 70) player.camera.shake(0.32 * Math.pow(1 - d / 70, 2) + 0.03, 0.35);
    else if (this.mounted) player.camera.shake(0.08, 0.25);
    if (d < 40 && !this.mounted) ctx.input.rumble(0.3 * (1 - d / 40), 120);
    this.ringFlash[i] = 1;
    this.trample(_p, 2.7, 45);
    this.onFootfall?.(_p, i);
  }

  /** crush everything under a foot / in a blast */
  private trample(at: THREE.Vector3, r: number, dmg: number): void {
    const ctx = this.level.ctx;
    const player = ctx.player;
    if (!this.mounted && player.alive) {
      const dx = player.position.x - at.x;
      const dz = player.position.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d < r && player.position.y < at.y + 2.5) {
        player.takeDamage({ amount: dmg, type: 'crush', source: this, dir: _v.set(dx, 0, dz).normalize().clone(), knockback: 10, stagger: true });
      }
    }
    for (const c of ctx.combatants.query(at, r + 0.5, 'enemy')) {
      if (!c.alive || c instanceof WeakPoint || c instanceof CrewMember) continue;
      if (Math.abs(c.position.y - at.y) > 2.5) continue;
      c.takeDamage({ amount: 9999, type: 'crush', source: this, dir: _v.set(c.position.x - at.x, 0.4, c.position.z - at.z).normalize().clone(), knockback: 8 });
    }
  }

  private think(dt: number): void {
    this.attackCd -= dt;
    if (this.action !== 'none' || this.attackCd > 0) return;
    const player = this.level.ctx.player;
    _v.copy(player.position);
    this.object.worldToLocal(_v);
    if (_v.y > 4) return;
    const x = _v.x;
    const z = _v.z;
    if (z > 8 && z < 23 && Math.abs(x) < 10) {
      if (Math.abs(x) < 3.8 && z < 19) this.startAction('gore');
      else this.startAction('sweep', x > 0 ? -1 : 1);
      this.attackCd = 4.5 + this.rnd() * 2.5;
    } else if (z > 0 && z <= 8 && Math.abs(x) < 4.3) {
      this.startAction('stomp');
      this.attackCd = 6 + this.rnd() * 2;
    }
  }

  private strike(a: MumakAction): void {
    const ctx = this.level.ctx;
    const player = ctx.player;
    _v.copy(player.position);
    this.object.worldToLocal(_v);
    const x = _v.x;
    const z = _v.z;
    let hit = false;
    if (a === 'sweep') {
      const d = Math.hypot(x, z - 11);
      const ang = Math.atan2(x, z - 11);
      hit = d < 15.5 && d > 2 && Math.abs(ang) < 1.25 && _v.y < 6;
      ctx.audio.play('arrow_whoosh', { pos: this.model.bones.trunk4.getWorldPosition(_a), volume: 1.4, pitch: 0.35 });
    } else if (a === 'gore') {
      hit = Math.abs(x) < 4.8 && z > 9 && z < 23 && _v.y < 6;
      this.model.bones.head.getWorldPosition(_a);
      _a.y = this.ground(_a.x, _a.z);
      ctx.fx.dust(_a.addScaledVector(_b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 6), 20, 0x8f8068);
    } else if (a === 'stomp') {
      this.model.bones.fpaw_l.getWorldPosition(_a).lerp(this.model.bones.fpaw_r.getWorldPosition(_b), 0.5);
      _a.y = this.ground(_a.x, _a.z);
      ctx.fx.dust(_a, 60, 0x9a8a70);
      ctx.fx.debris(_a, 12, 0x5a4a38);
      ctx.audio.play('oliphaunt_step', { pos: _a, volume: 1.8, pitch: 0.65 });
      ctx.audio.play('explosion', { pos: _a, volume: 0.5, pitch: 0.45 });
      const d = player.position.distanceTo(_a);
      player.camera.shake(Math.max(0.12, 0.8 * (1 - d / 60)), 0.8);
      this.trample(_a, 9.5, 0);
      hit = Math.hypot(player.position.x - _a.x, player.position.z - _a.z) < 9.5 && player.position.y < _a.y + 3;
    }
    if (hit && player.alive && !this.mounted) {
      _b.copy(player.position).sub(this.object.position).setY(0).normalize();
      const dmg = a === 'gore' ? 40 : a === 'stomp' ? 34 : 28;
      player.takeDamage({ amount: dmg, type: a === 'stomp' ? 'crush' : 'blunt', source: this, dir: _b.clone(), knockback: a === 'sweep' ? 14 : 10, stagger: true });
    }
  }

  // ── decals ──
  private updateRings(dt: number): void {
    const an = this.model.animator;
    const g = an.gait;
    const show = !this.dead && !this.mounted && this.speed > 0.2;
    const player = this.level.ctx.player;
    const pd = player.position.distanceTo(this.object.position);
    const near = pd < 110;
    for (let i = 0; i < 4; i++) {
      const ring = this.rings[i];
      const f = g.legs[i];
      this.ringFlash[i] = Math.max(0, this.ringFlash[i] - dt * 1.6);
      const mat = ring.material as THREE.MeshBasicMaterial;
      if (!show || !near) {
        ring.visible = false;
        continue;
      }
      if (f.planted < 0.5) {
        // swinging: predict the landing spot
        const ps = this.model.creature.pose;
        const end = [ps.i('fpaw_l'), ps.i('fpaw_r'), ps.i('hpaw_l'), ps.i('hpaw_r')][i];
        const rest = ps.restModel[end];
        const duty = 0.68;
        const half = (g.stride * duty) / 2;
        const remain = ((1 - f.u) * (1 - duty)) / Math.max(g.freq, 1e-3);
        _a.set(rest.x, 0, rest.z + half + this.speed * remain);
        this.object.localToWorld(_a);
        _a.y = this.ground(_a.x, _a.z) + 0.25;
        ring.position.copy(_a);
        const k = THREE.MathUtils.smoothstep(f.u, 0.1, 0.85);
        // a little larger with distance so the ring still reads from across the field
        ring.scale.setScalar((6 - k * 0.9) * (1 + clamp((pd - 30) / 60, 0, 1) * 0.35));
        mat.opacity = 0.4 + k * 0.55;
        ring.visible = true;
      } else if (this.ringFlash[i] > 0) {
        ring.scale.setScalar(5 + (1 - this.ringFlash[i]) * 3);
        mat.opacity = this.ringFlash[i] * 0.9;
        ring.visible = true;
      } else ring.visible = false;
    }
  }

  private updateZoneDecal(): void {
    const kinds = ['sweep', 'gore', 'stomp'] as const;
    for (const k of kinds) {
      const d = this.zoneDecals[k];
      const on = this.action === k && this.actionT < MUMAK_STRIKE[k] + 0.04;
      d.visible = on;
      if (!on) continue;
      const u = clamp(this.actionT / MUMAK_STRIKE[k], 0, 1);
      if (k === 'stomp') {
        this.model.bones.fpaw_l.getWorldPosition(_a).lerp(this.model.bones.fpaw_r.getWorldPosition(_b), 0.5);
        _a.y = 0;
        _a.addScaledVector(_b.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 1.5);
      } else {
        _a.set(0, 0, k === 'gore' ? 15.5 : 11);
        this.object.localToWorld(_a);
      }
      _a.y = this.ground(_a.x, _a.z) + 0.3;
      d.position.copy(_a);
      d.rotation.set(0, this.yaw + (k === 'sweep' ? Math.PI : 0), 0);
      (d.material as THREE.MeshBasicMaterial).opacity = (0.25 + 0.45 * u) * (0.75 + 0.25 * Math.sin(this.actionT * 60));
    }
  }

  dispose(): void {
    const physics = this.level.ctx.physics;
    try {
      for (const c of this.legCols) physics.remove(c);
      if (this.bodyCol) physics.remove(this.bodyCol);
    } catch {
      /* the level already cleared the physics world */
    }
    this.model.dispose();
    super.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The far herd
// ─────────────────────────────────────────────────────────────────────────────

export class FarMumak {
  readonly model: MumakModel;
  private s: number;
  private yaw = 0;
  private acc = 0;
  private frame = 0;
  constructor(
    private readonly level: LevelAPI,
    private readonly path: Path,
    private readonly speed: number,
    phase: number,
    seed: number,
    private readonly ground: (x: number, z: number) => number,
  ) {
    this.model = createMumak({ seed, lod: 'far', howdah: true });
    this.s = phase * path.length;
    path.at(this.s, _p);
    path.at((this.s + 8) % path.length, _a);
    this.yaw = yawOf(_a.x - _p.x, _a.z - _p.z);
    level.root.add(this.model.object);
    this.model.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.userData.noAO = true;
      }
    });
    this.step(0.016);
  }
  update(dt: number): void {
    this.acc += dt;
    // far away: animate at 20 Hz
    if (++this.frame % 3 !== 0) return;
    this.step(this.acc);
    this.acc = 0;
  }
  private step(dt: number): void {
    const L = this.path.length;
    this.s = (this.s + this.speed * dt) % L;
    this.path.at(this.s, _p);
    this.path.at((this.s + 8) % L, _a);
    const o = this.model.object;
    o.position.set(_p.x, this.ground(_p.x, _p.z), _p.z);
    this.yaw = dampAngle(this.yaw, yawOf(_a.x - _p.x, _a.z - _p.z), 1, dt);
    o.rotation.y = this.yaw;
    this.model.animator.speed = this.speed;
    this.model.animator.update(dt);
  }
}
