/**
 * Projectiles: physical arrows (pooled, instanced per style) and thrown objects.
 *
 * Arrows fly with slight drop (ARROW_GRAVITY × shot.gravity), hit combatants through their
 * zone raycasts and the world through physics.raycast('arrows'), and stick into bones,
 * mesh colliders or the static world (max 120 stuck; the oldest shrink away). Piercing
 * arrows pass through up to 3 enemies; 'triple' fires a 3-arrow spread; armour deflects.
 * Homing (Focus) arrows steer toward their target and may carry a glowing fx.trail.
 *
 * Rendering: one InstancedMesh pair (shaft+fletching, metal head) per style → ~8 draw calls
 * for every arrow in the game. Pooled geometries/materials are shared and never disposed.
 * Arrows live directly under engine.scene so clearLevel() does not dispose them.
 */
import * as THREE from 'three';
import type {
  ArrowShot,
  BloodKind,
  CombatRayHit,
  Combatant,
  FxHandle,
  GameContext,
  Projectiles,
  SfxName,
  SurfaceMaterial,
  Team,
} from '../core/types';
import { disposeObject } from '../core/math';
import { ARROW_GRAVITY, rotateToward } from './aim';
import { hostile, segSegDist2 } from '../actors/combatant';

export type ArrowStyle = 'elven' | 'orc' | 'uruk' | 'bolt';

/** ArrowShot plus gameplay-internal extras */
export interface ArrowShotExt extends ArrowShot {
  /** fx.trail colour (Focus volley) */
  trail?: number;
  /** homing turn rate rad/s (default 9) */
  homingRate?: number;
}

export interface ProjectilesExt extends Projectiles {
  /** arrows currently flying */
  readonly flying: number;
  /** arrows currently stuck */
  readonly stuck: number;
  /** debug snapshot of flying arrows */
  debug(): { pos: number[]; vel: number[]; homing: string | null; state: string; life: number }[];
}

const MAX_STUCK = 120;
const CAPACITY = 200;
const WORLD_STUCK_LIFE = 30;
const PLAYER_STUCK_LIFE = 3;
const FADE_TIME = 0.35;

// ── geometry ─────────────────────────────────────────────────────────────────
interface StyleDef {
  length: number;
  shaftR: number;
  shaft: number;
  band: number;
  fletch: number;
  fletchTip: number;
  nock: number;
  vaneLen: number;
  vaneH: number;
  vanes: number;
  head: number;
  headLen: number;
  headW: number;
  barbed: boolean;
  metalness: number;
  roughness: number;
}
const STYLES: Record<ArrowStyle, StyleDef> = {
  elven: { length: 0.78, shaftR: 0.0042, shaft: 0xc8ab78, band: 0x5a7a3a, fletch: 0xf4f1e8, fletchTip: 0xb8b4a8, nock: 0x2a3a22, vaneLen: 0.13, vaneH: 0.016, vanes: 3, head: 0xd8dde2, headLen: 0.065, headW: 0.013, barbed: false, metalness: 0.95, roughness: 0.25 },
  orc: { length: 0.72, shaftR: 0.0058, shaft: 0x2a241e, band: 0x14100c, fletch: 0x141414, fletchTip: 0x2a2620, nock: 0x0e0c0a, vaneLen: 0.09, vaneH: 0.022, vanes: 3, head: 0x4a443c, headLen: 0.07, headW: 0.018, barbed: true, metalness: 0.7, roughness: 0.7 },
  uruk: { length: 0.84, shaftR: 0.0068, shaft: 0x3a2c22, band: 0x1a1410, fletch: 0x2a2826, fletchTip: 0x3a3632, nock: 0x1a1410, vaneLen: 0.12, vaneH: 0.02, vanes: 3, head: 0x55504a, headLen: 0.095, headW: 0.02, barbed: true, metalness: 0.8, roughness: 0.55 },
  bolt: { length: 0.42, shaftR: 0.0085, shaft: 0x6e5236, band: 0x3a2a1a, fletch: 0x5a4030, fletchTip: 0x4a3426, nock: 0x3a2a1a, vaneLen: 0.08, vaneH: 0.014, vanes: 2, head: 0x6a6a6a, headLen: 0.05, headW: 0.014, barbed: false, metalness: 0.85, roughness: 0.45 },
};

const STYLE_KEYS = Object.keys(STYLES) as ArrowStyle[];

function colorize(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** a single fletching vane in the (y,z) plane at x=0, radial along +y */
function vane(z0: number, len: number, h: number, ragged: boolean): THREE.BufferGeometry {
  const r0 = 0.002;
  const pts: number[] = [];
  const seg = 5;
  const top: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    // feather profile: rises quickly at the back, slopes toward the front
    let hh = h * (t < 0.25 ? 0.55 + t * 1.8 : 1 - (t - 0.25) * 0.9);
    if (ragged && i % 2 === 1) hh *= 0.75;
    top.push([z0 + t * len, r0 + hh]);
  }
  for (let i = 0; i < seg; i++) {
    const [za, ya] = top[i];
    const [zb, yb] = top[i + 1];
    pts.push(0, r0, za, 0, ya, za, 0, yb, zb);
    pts.push(0, r0, za, 0, yb, zb, 0, r0, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

function buildArrowGeometry(s: StyleDef): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const shaftLen = s.length - s.headLen * 0.6;
  const zBack = -s.length;
  // shaft (tip side starts inside the head socket)
  const shaft = new THREE.CylinderGeometry(s.shaftR, s.shaftR * 1.05, shaftLen, 6, 1, true).rotateX(Math.PI / 2);
  shaft.translate(0, 0, -s.headLen * 0.6 - shaftLen / 2);
  parts.push(colorize(shaft, s.shaft));
  // decorative band below the fletching
  const band = new THREE.CylinderGeometry(s.shaftR * 1.15, s.shaftR * 1.15, 0.02, 6, 1, true).rotateX(Math.PI / 2);
  band.translate(0, 0, zBack + s.vaneLen + 0.045);
  parts.push(colorize(band, s.band));
  // nock
  const nock = new THREE.CylinderGeometry(s.shaftR * 1.25, s.shaftR * 0.9, 0.018, 6).rotateX(Math.PI / 2);
  nock.translate(0, 0, zBack + 0.006);
  parts.push(colorize(nock, s.nock));
  // vanes
  for (let i = 0; i < s.vanes; i++) {
    const v = vane(zBack + 0.02, s.vaneLen, s.vaneH, s.barbed);
    v.rotateZ((i / s.vanes) * Math.PI * 2 + Math.PI / 2);
    // fade the colour toward the tip: two-tone by splitting is overkill; tint the back half
    const geo = colorize(v, s.fletch);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const tip = new THREE.Color(s.fletchTip);
    for (let k = 0; k < pos.count; k++) {
      const r = Math.hypot(pos.getX(k), pos.getY(k));
      if (r > s.vaneH * 0.75) col.setXYZ(k, tip.r, tip.g, tip.b);
    }
    parts.push(geo);
  }
  const body = mergeSimple(parts);
  body.computeBoundingSphere();
  // head: leaf (elven) or barbed wedge, flattened lathe, tip at origin pointing +Z
  const prof: THREE.Vector2[] = s.barbed
    ? [new THREE.Vector2(0, 0), new THREE.Vector2(s.headW * 0.5, 0.004), new THREE.Vector2(s.headW * 1.05, 0.012), new THREE.Vector2(s.headW * 0.35, s.headLen * 0.45), new THREE.Vector2(0, s.headLen)]
    : [new THREE.Vector2(0, 0), new THREE.Vector2(s.shaftR * 1.3, 0.004), new THREE.Vector2(s.headW * 0.85, s.headLen * 0.35), new THREE.Vector2(s.headW, s.headLen * 0.55), new THREE.Vector2(s.headW * 0.45, s.headLen * 0.85), new THREE.Vector2(0, s.headLen)];
  const head = new THREE.LatheGeometry(prof, 4).rotateX(Math.PI / 2);
  head.translate(0, 0, -s.headLen);
  head.scale(1, 0.28, 1);
  head.computeVertexNormals();
  head.deleteAttribute('uv');
  return { body, head };
}

/** concatenate non-indexed geometries with position/normal/color (avoids importing three/addons) */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.attributes.normal) p.computeVertexNormals();
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    if (p.attributes.color) col.set(p.attributes.color.array as Float32Array, o * 3);
    o += c;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** a standalone arrow (tip at origin, pointing +Z) for labs and props; caller owns/disposes it */
export function buildArrowMesh(style: ArrowStyle): THREE.Group {
  const s = STYLES[style];
  const g = buildArrowGeometry(s);
  const group = new THREE.Group();
  group.name = `arrow:${style}`;
  const body = new THREE.Mesh(g.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  const head = new THREE.Mesh(g.head, new THREE.MeshStandardMaterial({ color: s.head, roughness: s.roughness, metalness: s.metalness }));
  body.castShadow = head.castShadow = true;
  group.add(body, head);
  return group;
}

function permanent<T extends { dispose(): void }>(o: T): T {
  // shared pooled resources: other modules' disposeObject() must not free them
  o.dispose = () => {};
  return o;
}

// ── arrows ───────────────────────────────────────────────────────────────────
type ArrowState = 'fly' | 'stuck' | 'fade' | 'deflect';
interface Arrow {
  style: ArrowStyle;
  slot: number;
  state: ArrowState;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  speed: number;
  gravity: number;
  damage: number;
  team: Team;
  owner: Combatant | null;
  type: 'standard' | 'piercing' | 'triple';
  homing: Combatant | null;
  homingRate: number;
  onHit: ((target: Combatant, hit: CombatRayHit) => void) | null;
  pierceLeft: number;
  hitIds: number[];
  life: number;
  age: number;
  fade: number;
  maxAge: number;
  attach: THREE.Object3D | null;
  attachOwner: Combatant | null;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
  proxy: THREE.Object3D | null;
  trail: FxHandle | null;
  whooshed: boolean;
  checkT: number;
}

function newArrow(): Arrow {
  return {
    style: 'elven',
    slot: -1,
    state: 'fly',
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    speed: 0,
    gravity: 1,
    damage: 0,
    team: 'neutral',
    owner: null,
    type: 'standard',
    homing: null,
    homingRate: 9,
    onHit: null,
    pierceLeft: 0,
    hitIds: [],
    life: 0,
    age: 0,
    fade: 0,
    maxAge: WORLD_STUCK_LIFE,
    attach: null,
    attachOwner: null,
    localPos: new THREE.Vector3(),
    localQuat: new THREE.Quaternion(),
    proxy: null,
    trail: null,
    whooshed: false,
    checkT: 0,
  };
}

interface Thrown {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  team: Team;
  owner: Combatant | null;
  radius: number;
  onImpact?: (p: THREE.Vector3) => void;
  life: number;
  landed: boolean;
  restT: number;
  kind: 'spear' | 'rock' | 'other';
  spin: THREE.Vector3;
}

const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _base = new THREE.Vector3();
const _top = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
const _tp = new THREE.Vector3();
const _tq = new THREE.Quaternion();
const _ts = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _aim = new THREE.Vector3();

function sfxForSurface(m: SurfaceMaterial): { name: SfxName; pitch: number; volume: number } {
  switch (m) {
    case 'stone':
    case 'ice':
      return { name: 'arrow_hit_stone', pitch: m === 'ice' ? 1.2 : 1, volume: 0.8 };
    case 'metal':
      return { name: 'arrow_hit_metal', pitch: 1, volume: 0.9 };
    case 'wood':
    case 'leaves':
    case 'web':
      return { name: 'arrow_hit_wood', pitch: 1, volume: 0.8 };
    case 'water':
      return { name: 'splash', pitch: 1.4, volume: 0.5 };
    case 'flesh':
      return { name: 'arrow_hit_flesh', pitch: 1, volume: 0.9 };
    default:
      return { name: 'arrow_hit_wood', pitch: 0.6, volume: 0.55 };
  }
}
const DUST_COLOR: Partial<Record<SurfaceMaterial, number>> = { dirt: 0x6a5a44, grass: 0x5a5a3a, snow: 0xe8eef2, leaves: 0x4a4a2a, web: 0xdedad0 };

export function createProjectiles(ctx: GameContext): ProjectilesExt {
  const pools = {} as Record<ArrowStyle, { body: THREE.InstancedMesh; head: THREE.InstancedMesh; active: Arrow[] }>;
  let root: THREE.Group | null = null;
  const free: Arrow[] = [];
  const flying: Arrow[] = [];
  const stuckList: Arrow[] = [];
  const fading: Arrow[] = [];
  const thrown: Thrown[] = [];
  const proxies: THREE.Object3D[] = [];

  function ensureRoot(): THREE.Group {
    if (root && root.parent) return root;
    if (!root) {
      root = new THREE.Group();
      root.name = 'projectiles';
      for (const k of Object.keys(STYLES) as ArrowStyle[]) {
        const s = STYLES[k];
        const g = buildArrowGeometry(s);
        const bodyMat = permanent(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
        const headMat = permanent(new THREE.MeshStandardMaterial({ color: s.head, roughness: s.roughness, metalness: s.metalness }));
        const body = new THREE.InstancedMesh(permanent(g.body), bodyMat, CAPACITY);
        const head = new THREE.InstancedMesh(permanent(g.head), headMat, CAPACITY);
        for (const m of [body, head]) {
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          m.count = 0;
          m.frustumCulled = false;
          m.castShadow = true;
          m.receiveShadow = false;
          m.name = `arrows:${k}`;
          root.add(m);
        }
        pools[k] = { body, head, active: [] };
      }
    }
    ctx.engine.scene.add(root);
    return root;
  }

  function alloc(style: ArrowStyle): Arrow | null {
    const pool = pools[style];
    if (pool.active.length >= CAPACITY) {
      // recycle the oldest stuck arrow of this style
      const victim = stuckList.find((a) => a.style === style) ?? fading.find((a) => a.style === style);
      if (!victim) return null;
      release(victim);
    }
    const a = free.pop() ?? newArrow();
    a.style = style;
    a.slot = pool.active.length;
    pool.active.push(a);
    return a;
  }

  function removeFrom(list: Arrow[], a: Arrow) {
    const i = list.indexOf(a);
    if (i >= 0) list.splice(i, 1);
  }

  function release(a: Arrow) {
    const pool = pools[a.style];
    const last = pool.active.pop()!;
    if (last !== a) {
      pool.active[a.slot] = last;
      last.slot = a.slot;
    }
    a.slot = -1;
    removeFrom(flying, a);
    removeFrom(stuckList, a);
    removeFrom(fading, a);
    stopTrail(a);
    a.attach = null;
    a.attachOwner = null;
    a.owner = null;
    a.homing = null;
    a.onHit = null;
    free.push(a);
  }

  function stopTrail(a: Arrow) {
    if (a.trail) {
      a.trail.stop();
      a.trail = null;
    }
    if (a.proxy) {
      const p = a.proxy;
      a.proxy = null;
      // keep the proxy in place briefly so the trail can fade at the impact point
      setTimeout(() => {
        p.removeFromParent();
        proxies.push(p);
      }, 600);
    }
  }

  function spawn(shot: ArrowShotExt, dir: THREE.Vector3, damage: number) {
    ensureRoot();
    const style = shot.style ?? (shot.team === 'enemy' ? 'orc' : 'elven');
    const a = alloc(style);
    if (!a) return;
    a.state = 'fly';
    a.pos.copy(shot.origin);
    a.speed = shot.speed;
    a.vel.copy(dir).multiplyScalar(shot.speed);
    a.quat.setFromUnitVectors(FWD, dir);
    a.gravity = shot.gravity ?? 1;
    a.damage = damage;
    a.team = shot.team;
    a.owner = shot.owner;
    a.type = shot.type ?? 'standard';
    a.homing = shot.homing ?? null;
    a.homingRate = shot.homingRate ?? 9;
    a.onHit = shot.onHit ?? null;
    a.pierceLeft = a.type === 'piercing' ? 3 : 0;
    a.hitIds.length = 0;
    a.life = 0;
    a.age = 0;
    a.fade = 0;
    a.whooshed = shot.team === 'player';
    a.checkT = 0;
    flying.push(a);
    if (shot.trail !== undefined) {
      const p = proxies.pop() ?? new THREE.Object3D();
      p.position.copy(a.pos);
      ctx.engine.scene.add(p);
      a.proxy = p;
      try {
        a.trail = ctx.fx.trail(p, shot.trail);
      } catch {
        a.trail = null;
      }
    }
  }

  const _sd = new THREE.Vector3();
  function fire(shot: ArrowShot) {
    const s = shot as ArrowShotExt;
    _sd.copy(shot.dir).normalize();
    if (shot.type === 'triple') {
      const dmg = shot.damage * 0.75;
      spawn(s, _sd, dmg);
      for (const ang of [-0.075, 0.075]) {
        _q.setFromAxisAngle(UP, ang);
        _v2.copy(_sd).applyQuaternion(_q);
        spawn(s, _v2, dmg);
      }
    } else spawn(s, _sd, shot.damage);
  }

  // ── sticking ──────────────────────────────────────────────────────────────
  function stick(a: Arrow, point: THREE.Vector3, dir: THREE.Vector3, attach: THREE.Object3D | null, owner: Combatant | null, depth: number) {
    a.state = 'stuck';
    a.pos.copy(point).addScaledVector(dir, depth);
    a.quat.setFromUnitVectors(FWD, dir);
    a.vel.set(0, 0, 0);
    a.age = 0;
    a.attach = attach;
    a.attachOwner = owner;
    a.maxAge = owner && owner.team === 'player' ? PLAYER_STUCK_LIFE : WORLD_STUCK_LIFE;
    if (attach) {
      attach.updateWorldMatrix(true, false);
      attach.matrixWorld.decompose(_tp, _tq, _ts);
      _mInv.copy(attach.matrixWorld).invert();
      a.localPos.copy(a.pos).applyMatrix4(_mInv);
      a.localQuat.copy(_tq).invert().multiply(a.quat);
    }
    removeFrom(flying, a);
    stuckList.push(a);
    stopTrail(a);
    if (stuckList.length > MAX_STUCK) beginFade(stuckList[0]);
  }

  function beginFade(a: Arrow) {
    removeFrom(stuckList, a);
    removeFrom(flying, a);
    a.state = 'fade';
    a.fade = 0;
    fading.push(a);
  }

  function attachAlive(a: Arrow): boolean {
    const o = a.attachOwner as (Combatant & { expired?: boolean; disposed?: boolean }) | null;
    if (o) return !o.expired && !o.disposed;
    if (!a.attach) return true;
    // mesh collider objects: still in a scene?
    let p: THREE.Object3D | null = a.attach;
    while (p.parent) p = p.parent;
    return (p as THREE.Scene).isScene === true;
  }

  // ── impacts ───────────────────────────────────────────────────────────────
  function worldImpact(a: Arrow, point: THREE.Vector3, normal: THREE.Vector3, mat: SurfaceMaterial, obj: THREE.Object3D | undefined) {
    const s = sfxForSurface(mat);
    ctx.audio.play(s.name, { pos: point, volume: s.volume * (a.team === 'player' ? 1 : 0.7), pitch: s.pitch * (0.92 + Math.random() * 0.16) });
    const fx = ctx.fx;
    switch (mat) {
      case 'stone':
      case 'metal':
      case 'ice':
        fx.sparks(point, normal, mat === 'metal' ? 10 : 5);
        fx.dust(point, 2, mat === 'ice' ? 0xdde8f0 : 0x8a8478);
        break;
      case 'wood':
        fx.debris(point, 3, 0x6a4a2a);
        break;
      case 'water':
        fx.splash(point, 0.6);
        break;
      case 'flesh':
        fx.blood(point, normal, 'red', 0.6);
        break;
      default:
        fx.dust(point, 4, DUST_COLOR[mat] ?? 0x6a5a44);
    }
    if (mat === 'water' || a.state === 'deflect') {
      release(a);
      return;
    }
    // penetration: softer surfaces take the arrow deeper
    const depth = mat === 'stone' || mat === 'metal' || mat === 'ice' ? 0.03 : mat === 'wood' ? 0.07 : 0.12;
    _dir.copy(a.vel).normalize();
    stick(a, point, _dir, obj ?? null, null, depth);
  }

  function combatantImpact(a: Arrow, c: Combatant, hit: CombatRayHit): boolean {
    a.hitIds.push(c.id);
    _dir.copy(a.vel).normalize();
    const amount = a.damage * hit.multiplier;
    const armor = hit.zone === 'armor';
    c.takeDamage({
      amount,
      type: 'arrow',
      source: a.owner,
      point: hit.point,
      dir: _dir,
      zone: hit.zone,
      knockback: a.speed * 0.02,
      stagger: hit.zone === 'head' && amount > c.maxHp * 0.3,
    });
    const blood = ((c as Combatant & { bloodKind?: BloodKind }).bloodKind ?? 'red') as BloodKind;
    if (armor) {
      ctx.fx.sparks(hit.point, hit.normal ?? _v.copy(_dir).negate(), 8);
      ctx.audio.play('arrow_hit_metal', { pos: hit.point, volume: 0.9 });
    } else {
      ctx.fx.blood(hit.point, _dir, blood, Math.min(1.5, 0.4 + amount / 60));
      ctx.audio.play('arrow_hit_flesh', { pos: hit.point, volume: a.team === 'player' ? 1 : 0.8, pitch: 0.9 + Math.random() * 0.2 });
    }
    try {
      a.onHit?.(c, hit);
    } catch (e) {
      console.warn('[projectiles] onHit failed', e);
    }
    if (armor) {
      // glance off
      a.state = 'deflect';
      const n = hit.normal ?? _v.copy(_dir).negate();
      a.vel.reflect(n).multiplyScalar(0.3);
      a.vel.y += 2;
      a.homing = null;
      a.life = Math.max(a.life, 5);
      return true;
    }
    if (a.pierceLeft > 0) {
      a.pierceLeft--;
      a.vel.multiplyScalar(0.85);
      a.speed *= 0.85;
      a.damage *= 0.85;
      a.pos.copy(hit.point).addScaledVector(_dir, 0.05);
      return false; // keep flying
    }
    const depth = 0.1 + Math.min(0.12, a.speed * 0.0015);
    stick(a, hit.point, _dir, hit.attach ?? c.object, c, depth);
    return true;
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  function updateFlying(dt: number) {
    const physics = ctx.physics;
    const list = ctx.combatants.all();
    const listener = ctx.engine.camera.position;
    for (let i = flying.length - 1; i >= 0; i--) {
      const a = flying[i];
      if (!a || a.state === 'stuck') continue;
      a.life += dt;
      // homing
      if (a.homing && a.state === 'fly') {
        if (!a.homing.alive) a.homing = null;
        else {
          const h = a.homing as Combatant & { headPoint?: (o: THREE.Vector3) => THREE.Vector3 };
          if (h.headPoint) h.headPoint(_aim);
          else h.aimPoint(_aim);
          _v.copy(_aim).sub(a.pos);
          const dist = _v.length();
          if (dist > 1e-3) {
            _v.divideScalar(dist);
            _v2.copy(a.vel).normalize();
            // overshot (target dodged): give up instead of orbiting
            if (_v.dot(_v2) < 0 && dist < 4) a.homing = null;
            const rate = a.homing ? a.homingRate * (dist < 6 ? 2.5 : 1) : 0;
            rotateToward(_v2, _v, rate * dt, _dir);
            a.vel.copy(_dir).multiplyScalar(a.speed);
          }
        }
      } else {
        a.vel.y -= ARROW_GRAVITY * a.gravity * dt * (a.state === 'deflect' ? 2.2 : 1);
      }
      _next.copy(a.pos).addScaledVector(a.vel, dt);
      _dir.copy(_next).sub(a.pos);
      let segLen = _dir.length();
      if (segLen < 1e-6) continue;
      _dir.divideScalar(segLen);

      let consumed = false;
      // combatants (may pierce several in one step)
      if (a.state === 'fly') {
        for (let guard = 0; guard < 4 && !consumed; guard++) {
          let best: Combatant | null = null;
          let bt = segLen;
          let bh: CombatRayHit | null = null;
          for (const c of list) {
            if (!c.alive || c === a.owner || !hostile(a.team, c.team) || a.hitIds.includes(c.id)) continue;
            _base.copy(c.position);
            _top.copy(c.position);
            _top.y += c.height;
            const br = Math.max(c.radius * 2.6, c.height * 0.45) + 0.3;
            if (segSegDist2(a.pos, _next, _base, _top) > br * br) continue;
            const h = c.raycast(a.pos, _dir, bt);
            if (h && h.t <= bt) {
              bt = h.t;
              best = c;
              bh = h;
            }
          }
          if (!best || !bh) break;
          // world in front of it?
          const w = physics.raycast(a.pos, _dir, bt, 'arrows');
          if (w) break;
          consumed = combatantImpact(a, best, bh);
          if (!consumed) {
            // pierced: continue from just behind the hit
            _dir.copy(_next).sub(a.pos);
            segLen = _dir.length();
            if (segLen < 1e-5) {
              consumed = true;
              break;
            }
            _dir.divideScalar(segLen);
          } else if ((a.state as ArrowState) === 'deflect') {
            consumed = true;
          }
        }
        if (consumed) {
          if ((a.state as ArrowState) === 'deflect') a.pos.addScaledVector(a.vel, dt);
          continue;
        }
      }
      // world
      const w = physics.raycast(a.pos, _dir, segLen, 'arrows');
      if (w) {
        worldImpact(a, w.point, w.normal, w.material, w.object);
        continue;
      }
      a.pos.copy(_next);
      if (a.vel.lengthSq() > 1e-6) a.quat.setFromUnitVectors(FWD, _v.copy(a.vel).normalize());
      if (a.proxy) a.proxy.position.copy(a.pos);
      // whoosh past the listener
      if (!a.whooshed && a.pos.distanceToSquared(listener) < 16) {
        a.whooshed = true;
        ctx.audio.play('arrow_whoosh', { pos: a.pos, volume: 0.8 });
      }
      if (a.life > 8 || a.pos.y < physics.killY) release(a);
    }
  }

  /** upload only the live part of an instance buffer */
  function upload(m: THREE.InstancedMesh, n: number) {
    m.instanceMatrix.clearUpdateRanges();
    if (n > 0) m.instanceMatrix.addUpdateRange(0, n * 16);
    m.instanceMatrix.needsUpdate = n > 0;
  }

  function writeMatrices() {
    for (const k of STYLE_KEYS) {
      const pool = pools[k];
      const n = pool.active.length;
      for (let i = 0; i < n; i++) {
        const a = pool.active[i];
        let s = 1;
        if (a.state === 'fade') s = Math.max(0.001, 1 - a.fade / FADE_TIME);
        if (a.attach && (a.state === 'stuck' || a.state === 'fade')) {
          a.attach.updateWorldMatrix(true, false);
          a.attach.matrixWorld.decompose(_tp, _tq, _ts);
          _v.copy(a.localPos).applyMatrix4(a.attach.matrixWorld);
          _q.copy(_tq).multiply(a.localQuat);
          _m.compose(_v, _q, _scale.setScalar(s));
        } else {
          _m.compose(a.pos, a.quat, _scale.setScalar(s));
        }
        pool.body.setMatrixAt(i, _m);
        pool.head.setMatrixAt(i, _m);
      }
      const was = pool.body.count;
      pool.body.count = n;
      pool.head.count = n;
      if (n === 0 && was === 0) continue;
      upload(pool.body, n);
      upload(pool.head, n);
    }
  }

  // ── thrown objects ────────────────────────────────────────────────────────
  function updateThrown(dt: number) {
    for (let i = thrown.length - 1; i >= 0; i--) {
      const t = thrown[i];
      t.life += dt;
      if (t.landed) {
        t.restT += dt;
        if (t.restT > 5) t.obj.position.y -= dt * 0.4;
        if (t.restT > 6.5) {
          t.obj.removeFromParent();
          disposeObject(t.obj);
          thrown.splice(i, 1);
        }
        continue;
      }
      t.vel.y -= 18 * dt;
      _next.copy(t.pos).addScaledVector(t.vel, dt);
      _dir.copy(_next).sub(t.pos);
      const segLen = _dir.length();
      if (segLen > 1e-6) _dir.divideScalar(segLen);
      let hitC: Combatant | null = null;
      for (const c of ctx.combatants.all()) {
        if (!c.alive || c === t.owner || !hostile(t.team, c.team)) continue;
        _base.copy(c.position);
        _base.y += c.radius;
        _top.copy(c.position);
        _top.y += c.height - c.radius * 0.5;
        const rr = t.radius + c.radius;
        if (segSegDist2(t.pos, _next, _base, _top) < rr * rr) {
          hitC = c;
          break;
        }
      }
      const w = segLen > 1e-6 ? ctx.physics.raycast(t.pos, _dir, segLen + t.radius * 0.5, 'arrows') : null;
      if (hitC) {
        hitC.takeDamage({ amount: t.damage, type: t.kind === 'spear' ? 'melee' : 'blunt', source: t.owner, point: t.pos.clone(), dir: _dir.clone(), knockback: t.kind === 'rock' ? 6 : 3, stagger: true });
        const blood = ((hitC as Combatant & { bloodKind?: BloodKind }).bloodKind ?? 'red') as BloodKind;
        if (t.kind === 'spear') ctx.fx.blood(t.pos, _dir, blood, 0.8);
        else ctx.fx.debris(t.pos, 6, 0x6a6258);
        ctx.audio.play(t.kind === 'rock' ? 'stone_crumble' : 'arrow_hit_flesh', { pos: t.pos, volume: 0.9 });
        impact(t, i, t.pos);
        continue;
      }
      if (w) {
        t.pos.copy(w.point);
        if (t.kind === 'spear') {
          ctx.audio.play('arrow_hit_wood', { pos: w.point, pitch: 0.7 });
          ctx.fx.dust(w.point, 4, DUST_COLOR[w.material] ?? 0x6a5a44);
          t.pos.addScaledVector(_dir, 0.25);
        } else {
          ctx.audio.play('stone_crumble', { pos: w.point, volume: 0.8 });
          ctx.fx.debris(w.point, 8, 0x6a6258);
          ctx.fx.dust(w.point, 6, DUST_COLOR[w.material] ?? 0x7a7060);
          t.pos.addScaledVector(w.normal, t.radius * 0.6);
        }
        impact(t, i, w.point);
        continue;
      }
      t.pos.copy(_next);
      t.obj.position.copy(t.pos);
      if (t.kind === 'spear') {
        _v.copy(t.vel).normalize();
        t.obj.quaternion.setFromUnitVectors(UP, _v);
      } else {
        t.obj.rotation.x += t.spin.x * dt;
        t.obj.rotation.y += t.spin.y * dt;
        t.obj.rotation.z += t.spin.z * dt;
      }
      if (t.life > 12 || t.pos.y < ctx.physics.killY) {
        t.obj.removeFromParent();
        disposeObject(t.obj);
        thrown.splice(i, 1);
      }
    }
  }
  function impact(t: Thrown, i: number, p: THREE.Vector3) {
    t.obj.position.copy(t.pos);
    try {
      t.onImpact?.(p);
    } catch (e) {
      console.warn('[projectiles] onImpact failed', e);
    }
    if (t.kind === 'other' && t.onImpact) {
      // firebombs etc.: the callback owns the effect; remove the object
      t.obj.removeFromParent();
      disposeObject(t.obj);
      thrown.splice(i, 1);
      return;
    }
    t.landed = true;
    t.restT = 0;
  }

  const api: ProjectilesExt = {
    get flying() {
      return flying.length;
    },
    get stuck() {
      return stuckList.length;
    },
    debug() {
      return flying.map((a) => ({
        pos: a.pos.toArray().map((v) => +v.toFixed(2)),
        vel: a.vel.toArray().map((v) => +v.toFixed(1)),
        homing: a.homing ? a.homing.name : null,
        state: a.state,
        life: +a.life.toFixed(3),
      }));
    },
    fire,
    throwObject(o) {
      ensureRoot();
      const ud = o.object.userData as { throwKind?: string };
      const kind: Thrown['kind'] =
        ud.throwKind === 'spear' || ud.throwKind === 'rock' ? ud.throwKind : ud.throwKind ? 'other' : o.onImpact ? 'other' : o.radius >= 0.25 ? 'rock' : 'spear';
      o.object.position.copy(o.origin);
      ctx.engine.scene.add(o.object);
      o.object.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.castShadow = true;
      });
      thrown.push({
        obj: o.object,
        pos: o.origin.clone(),
        vel: o.velocity.clone(),
        damage: o.damage,
        team: o.team,
        owner: o.owner,
        radius: o.radius,
        onImpact: o.onImpact,
        life: 0,
        landed: false,
        restT: 0,
        kind,
        spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8),
      });
    },
    update(dt) {
      if (!root) {
        if (thrown.length === 0) return;
        ensureRoot();
      } else if (!root.parent) ctx.engine.scene.add(root);
      if (dt > 0) {
        updateFlying(dt);
        // stuck arrows: lifetime + owner checks
        for (let i = stuckList.length - 1; i >= 0; i--) {
          const a = stuckList[i];
          a.age += dt;
          a.checkT += dt;
          if (a.age > a.maxAge) beginFade(a);
          else if (a.attach && a.checkT > 0.25) {
            a.checkT = 0;
            if (!attachAlive(a)) release(a);
          }
        }
        for (let i = fading.length - 1; i >= 0; i--) {
          const a = fading[i];
          a.fade += dt;
          if (a.fade >= FADE_TIME || (a.attach && !attachAlive(a))) release(a);
        }
        updateThrown(dt);
      }
      writeMatrices();
    },
    clear() {
      for (const k of STYLE_KEYS) {
        const pool = pools[k];
        while (pool.active.length) release(pool.active[pool.active.length - 1]);
      }
      flying.length = 0;
      stuckList.length = 0;
      fading.length = 0;
      for (const t of thrown) {
        t.obj.removeFromParent();
        disposeObject(t.obj);
      }
      thrown.length = 0;
      if (root) writeMatrices();
    },
  };
  return api;
}
