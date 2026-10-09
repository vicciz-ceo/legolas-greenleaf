/**
 * Silhouette hordes: thousands of cheap instanced figures for the far ranks of Mordor (100 m and
 * beyond), where the detailed crowds of the world module would cost too many triangles.
 *
 * Every horde is one InstancedMesh (a ~29 triangle orc: a tapering body, a head, a spear and a round
 * shield) with a hand-set bounding sphere, so a horde behind the camera is frustum culled and costs
 * nothing; one more InstancedMesh holds the torch glints. Figures bob in the vertex shader while a
 * horde marches; positions are rewritten on the CPU only for hordes that are moving.
 * A horde can march (`begin`), stand, fall (`thin`), and turn and run (`rout`).
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { worldQuality } from '../../../world';
import { Rng } from '../../../core/rng';

export interface HordeDef {
  id: string;
  center: [number, number];
  half: [number, number];
  /** figures at High quality (scaled 0.3 / 0.6 / 1 / 1 for low / medium / high / ultra) */
  count: number;
  facing: number;
  /** metres to march after `begin` + delay (0 = stands) */
  march: number;
  delay: number;
  /** cloak tint: 'orc' dark grey-brown, 'easterling' dark red */
  tint: 'orc' | 'easterling';
  speed?: number;
}

interface Group {
  def: HordeDef;
  first: number;
  n: number;
  mesh: THREE.InstancedMesh;
  dirX: number;
  dirZ: number;
  dist: number;
  state: 'wait' | 'march' | 'stand' | 'rout';
  speed: number;
  /** flat arrays, group-local */
  bx: Float32Array;
  bz: Float32Array;
  y0: Float32Array;
  y1: Float32Array;
}

const SCALE = { low: 0.3, medium: 0.6, high: 1, ultra: 1 } as const;

function figureGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const push = (x: number, y: number, z: number, hex: number, shade = 1): number => {
    c.setHex(hex).multiplyScalar(shade);
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  // body: a five-sided tapering robe/armour, wider at the hips
  const N = 5;
  const bot: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    bot.push(push(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.22, 0x4a4038, 0.62));
    top.push(push(Math.cos(a) * 0.25, 1.38, Math.sin(a) * 0.18, 0x5a4c42, 1));
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(bot[i], bot[j], top[j], bot[i], top[j], top[i]);
  }
  // shoulders: a short wide wedge so the silhouette has a yoke
  const sh = [push(-0.36, 1.2, 0, 0x4e443c), push(0.36, 1.2, 0, 0x4e443c), push(0, 1.46, 0.0, 0x4a4038)];
  idx.push(sh[0], sh[1], sh[2]);
  // head: a square bipyramid with a sloped brow
  const hc = 1.62;
  const h = [push(-0.14, hc, -0.12, 0x52483c), push(0.14, hc, -0.12, 0x52483c), push(0.14, hc, 0.14, 0x52483c), push(-0.14, hc, 0.14, 0x52483c)];
  const ht = push(0, hc + 0.2, -0.02, 0x2a2420);
  const hb = push(0, hc - 0.16, 0.02, 0x3a3028);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(h[i], h[j], ht, h[j], h[i], hb);
  }
  // spear: two thin crossed quads, held upright in the right hand
  const sp = (x: number, z: number) => {
    const a = push(x - 0.012, 0.2, z, 0x6a5a48);
    const b = push(x + 0.012, 0.2, z, 0x6a5a48);
    const c2 = push(x + 0.012, 2.3, z, 0x6a5a48);
    const d = push(x - 0.012, 2.3, z, 0x6a5a48);
    idx.push(a, b, c2, a, c2, d);
  };
  sp(-0.4, 0.08);
  // spear head
  const t0 = push(-0.43, 2.3, 0.08, 0x9a9a98);
  const t1 = push(-0.37, 2.3, 0.08, 0x9a9a98);
  const t2 = push(-0.4, 2.58, 0.08, 0xb8b8b4);
  idx.push(t0, t1, t2);
  // shield: a round disc on the left arm, facing forward (+z)
  const sc = push(0.4, 0.95, 0.2, 0x3a2a24);
  const ring: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ring.push(push(0.4 + Math.cos(a) * 0.3, 0.95 + Math.sin(a) * 0.3, 0.24, 0x2a2018));
  }
  for (let i = 0; i < 7; i++) idx.push(sc, ring[i], ring[(i + 1) % 7]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function figureMaterial(uniforms: { uTime: { value: number }; uMove: { value: number } }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uMove = uniforms.uMove;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uMove;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.51;
          float stepk = abs(sin(uTime * 6.2 + ph));
          float up = smoothstep(0.3, 1.2, transformed.y);
          transformed.y += stepk * 0.085 * uMove * up;
          transformed.x += sin(uTime * 3.1 + ph) * 0.05 * (uMove * 0.7 + 0.3) * up;
          transformed.z += sin(uTime * 2.3 + ph * 1.7) * 0.03 * up;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'bg-horde-v1';
  return m;
}

export class HordeSystem {
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly torches: THREE.InstancedMesh;
  private readonly groups: Group[] = [];
  private readonly total: number;
  private readonly gOf: Uint8Array; // instance -> group index
  private readonly yaw: Float32Array;
  private readonly scl: Float32Array;
  private readonly cur: Float32Array; // current x,y,z per instance
  private readonly state: Uint8Array; // 0 alive, 1 dying, 2 gone
  private readonly dieT: Float32Array;
  private readonly torchOf: Int32Array; // instance -> torch index or -1
  private readonly torchIdx: number[] = [];
  private readonly uniforms = { uTime: { value: 0 }, uMove: { value: 0 } };
  private clock = 0;
  private realClock = 0;
  private begun = false;
  private routed = false;
  private readonly rng: Rng;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private dying = 0;
  private fleeSpeed = 0;
  private move = 0;

  constructor(private readonly level: LevelAPI, ground: (x: number, z: number) => number, defs: HordeDef[], seed = 5) {
    this.rng = new Rng(seed);
    const q = SCALE[worldQuality()];
    const counts = defs.map((d) => Math.max(0, Math.floor(d.count * q)));
    this.total = counts.reduce((a, b) => a + b, 0);
    const geo = figureGeometry();
    const mat = figureMaterial(this.uniforms);
    this.gOf = new Uint8Array(Math.max(1, this.total));
    this.yaw = new Float32Array(this.total);
    this.scl = new Float32Array(this.total);
    this.cur = new Float32Array(this.total * 3);
    this.state = new Uint8Array(this.total);
    this.dieT = new Float32Array(this.total);
    this.torchOf = new Int32Array(this.total).fill(-1);

    // torches: a few percent of every horde carry one
    const tg = new THREE.IcosahedronGeometry(0.17, 0);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.25, 0.28), fog: true });
    const hasTorch: number[] = [];

    const heightCache = new Map<number, number>();
    const hAt = (x: number, z: number): number => {
      const k = Math.round(x / 4) * 100003 + Math.round(z / 4);
      let h = heightCache.get(k);
      if (h === undefined) {
        h = ground(Math.round(x / 4) * 4, Math.round(z / 4) * 4);
        heightCache.set(k, h);
      }
      return h;
    };

    let first = 0;
    const color = new THREE.Color();
    defs.forEach((d, gi) => {
      const n = counts[gi];
      const dirX = Math.sin(d.facing);
      const dirZ = Math.cos(d.facing);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      mesh.name = `horde:${d.id}`;
      mesh.count = n;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.noAO = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // culled by a hand-set sphere that covers the whole march (the figures move, so the default
      // sphere from the first matrices would be wrong)
      const mx = d.center[0] + (dirX * d.march) / 2;
      const mz = d.center[1] + (dirZ * d.march) / 2;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(mx, 8, mz), Math.hypot(d.half[0], d.half[1]) + d.march / 2 + 16);
      mesh.frustumCulled = true;
      this.meshes.push(mesh);
      const g: Group = { def: d, first, n, mesh, dirX, dirZ, dist: 0, state: d.march > 0 ? 'wait' : 'stand', speed: d.speed ?? 3.6, bx: new Float32Array(n), bz: new Float32Array(n), y0: new Float32Array(n), y1: new Float32Array(n) };
      // ranks: a jittered grid inside the rectangle, rows facing the march direction
      const [hx, hz] = d.half;
      const area = 4 * hx * hz;
      const sp = Math.sqrt(area / Math.max(1, n));
      const cols = Math.max(1, Math.floor((2 * hx) / sp));
      const rows = Math.ceil(n / cols);
      const slots: [number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          slots.push([-hx + (c + 0.5) * ((2 * hx) / cols) + (this.rng.float() - 0.5) * sp * 0.7, -hz + (r + 0.5) * ((2 * hz) / rows) + (this.rng.float() - 0.5) * sp * 0.7]);
        }
      }
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.float() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      for (let i = 0; i < n; i++) {
        const k = first + i;
        const [lx, lz] = slots[i % slots.length];
        g.bx[i] = d.center[0] + lx;
        g.bz[i] = d.center[1] + lz;
        g.y0[i] = hAt(g.bx[i], g.bz[i]);
        g.y1[i] = d.march > 0 ? hAt(g.bx[i] + dirX * d.march, g.bz[i] + dirZ * d.march) : g.y0[i];
        this.yaw[k] = d.facing + (this.rng.float() - 0.5) * 0.5;
        this.scl[k] = 0.92 + this.rng.float() * 0.2;
        const b = 0.7 + this.rng.float() * 0.5;
        if (d.tint === 'easterling') color.setRGB(b * 1.25, b * 0.78, b * 0.7);
        else color.setRGB(b * 0.95, b * 0.92, b * 0.9);
        mesh.setColorAt(i, color);
        this.gOf[k] = gi;
        if (this.rng.float() < 0.09) hasTorch.push(k);
      }
      this.groups.push(g);
      first += n;
    });
    this.torches = new THREE.InstancedMesh(tg, tm, Math.max(1, hasTorch.length));
    this.torches.count = hasTorch.length;
    this.torches.name = 'horde_torches';
    this.torches.frustumCulled = false;
    this.torches.castShadow = false;
    this.torches.userData.noAO = true;
    this.torches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hasTorch.forEach((k, ti) => {
      this.torchOf[k] = ti;
      this.torchIdx.push(k);
    });
    for (const g of this.groups) this.writeGroup(g);
    for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    level.root.add(...this.meshes, this.torches);
  }

  get count(): number {
    return this.total;
  }

  private writeOne(k: number, x: number, y: number, z: number): void {
    const gi = this.gOf[k];
    const arr = this.meshes[gi].instanceMatrix.array as Float32Array;
    const sc = this.scl[k];
    const yaw = this.yaw[k];
    const c = Math.cos(yaw) * sc;
    const s = Math.sin(yaw) * sc;
    const o = (k - this.groups[gi].first) * 16;
    arr[o] = c;
    arr[o + 1] = 0;
    arr[o + 2] = -s;
    arr[o + 3] = 0;
    arr[o + 4] = 0;
    arr[o + 5] = sc;
    arr[o + 6] = 0;
    arr[o + 7] = 0;
    arr[o + 8] = s;
    arr[o + 9] = 0;
    arr[o + 10] = c;
    arr[o + 11] = 0;
    arr[o + 12] = x;
    arr[o + 13] = y;
    arr[o + 14] = z;
    arr[o + 15] = 1;
    this.cur[k * 3] = x;
    this.cur[k * 3 + 1] = y;
    this.cur[k * 3 + 2] = z;
    const ti = this.torchOf[k];
    if (ti >= 0) {
      const ta = this.torches.instanceMatrix.array as Float32Array;
      const lx = -0.4;
      const lz = 0.08;
      const co = Math.cos(yaw);
      const si = Math.sin(yaw);
      const to = ti * 16;
      ta[to] = 1;
      ta[to + 1] = 0;
      ta[to + 2] = 0;
      ta[to + 3] = 0;
      ta[to + 4] = 0;
      ta[to + 5] = 1;
      ta[to + 6] = 0;
      ta[to + 7] = 0;
      ta[to + 8] = 0;
      ta[to + 9] = 0;
      ta[to + 10] = 1;
      ta[to + 11] = 0;
      ta[to + 12] = x + (lx * co + lz * si) * sc;
      ta[to + 13] = y + 2.05 * sc;
      ta[to + 14] = z + (-lx * si + lz * co) * sc;
      ta[to + 15] = 1;
    }
  }

  private writeGroup(g: Group): void {
    const k = g.def.march > 0 ? Math.min(1, g.dist / g.def.march) : 0;
    for (let i = 0; i < g.n; i++) {
      const id = g.first + i;
      if (this.state[id] !== 0) continue;
      const x = g.bx[i] + g.dirX * g.dist;
      const z = g.bz[i] + g.dirZ * g.dist;
      this.writeOne(id, x, g.y0[i] + (g.y1[i] - g.y0[i]) * k, z);
    }
    g.mesh.instanceMatrix.needsUpdate = true;
    this.torches.instanceMatrix.needsUpdate = true;
  }

  /** the gate opens: hordes start after their delays */
  begin(): void {
    this.begun = true;
    this.clock = 0;
  }

  /** resume at a checkpoint: every horde is standing at the end of its march */
  snapToRest(): void {
    for (const g of this.groups) {
      if (g.state === 'stand' || g.state === 'rout') continue;
      g.dist = g.def.march;
      g.state = 'stand';
      this.writeGroup(g);
    }
    this.begun = true;
  }

  /** a fraction of the standing hordes falls (the toll of the battle) */
  thin(frac: number): void {
    for (let k = 0; k < this.total; k++) {
      if (this.state[k] === 0 && this.rng.float() < frac) {
        this.state[k] = 1;
        this.dieT[k] = -this.rng.float() * 0.8;
        this.dying++;
      }
    }
  }

  /** Sauron falls: a share drop where they stand, the rest turn and run */
  rout(speed = 6.5, fallFrac = 0.35): void {
    if (this.routed) return;
    this.routed = true;
    // the routed figures run far outside their march spheres: stop culling
    for (const m of this.meshes) m.frustumCulled = false;
    this.fleeSpeed = speed;
    this.thin(fallFrac);
    for (const g of this.groups) {
      g.state = 'rout';
      // freeze the current spot as the new base and flee along the reversed march direction
      for (let i = 0; i < g.n; i++) {
        const id = g.first + i;
        g.bx[i] = this.cur[id * 3];
        g.bz[i] = this.cur[id * 3 + 2];
        g.y0[i] = g.y1[i] = this.cur[id * 3 + 1];
        this.yaw[id] += Math.PI + (this.rng.float() - 0.5) * 0.8;
      }
      // run away from the hill (south hordes run south, the rest north-ish away from the fight)
      const toward = Math.atan2(g.dirX, g.dirZ);
      const away = toward + Math.PI;
      g.dirX = Math.sin(away);
      g.dirZ = Math.cos(away);
      g.dist = 0;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    this.realClock += dt;
    this.uniforms.uTime.value = this.realClock;
    let moving = false;
    for (const g of this.groups) {
      if (g.state === 'wait' && this.begun && this.clock >= g.def.delay) g.state = 'march';
      if (g.state === 'march') {
        moving = true;
        g.dist = Math.min(g.def.march, g.dist + g.speed * dt);
        this.writeGroup(g);
        if (g.dist >= g.def.march) g.state = 'stand';
      } else if (g.state === 'rout') {
        moving = true;
        g.dist += this.fleeSpeed * dt * (0.8 + 0.2 * Math.min(1, this.clock * 0.3));
        for (let i = 0; i < g.n; i++) {
          const id = g.first + i;
          if (this.state[id] !== 0) continue;
          this.writeOne(id, g.bx[i] + g.dirX * g.dist, g.y0[i], g.bz[i] + g.dirZ * g.dist);
        }
        g.mesh.instanceMatrix.needsUpdate = true;
        this.torches.instanceMatrix.needsUpdate = true;
      }
    }
    this.move += ((moving ? 1 : 0) - this.move) * Math.min(1, dt * 2);
    this.uniforms.uMove.value = this.move;
    if (this.dying > 0) this.updateDying(dt);
  }

  private updateDying(dt: number): void {
    let left = 0;
    for (let k = 0; k < this.total; k++) {
      if (this.state[k] !== 1) continue;
      this.dieT[k] += dt;
      const t = this.dieT[k];
      if (t < 0) {
        left++;
        continue;
      }
      const gi = this.gOf[k];
      const arr = this.meshes[gi].instanceMatrix.array as Float32Array;
      const lo = (k - this.groups[gi].first) * 16;
      const tilt = Math.min(1, t / 0.55);
      const ang = tilt * tilt * 1.5;
      const sc = this.scl[k] * (t > 5 ? Math.max(0, 1 - (t - 5) / 1.2) : 1);
      this.tmpE.set(-ang, this.yaw[k], 0, 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      this.tmpV.set(this.cur[k * 3], this.cur[k * 3 + 1] - tilt * 0.12, this.cur[k * 3 + 2]);
      this.tmpS.set(sc, sc, sc);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.tmpM.toArray(arr, lo);
      const ti = this.torchOf[k];
      if (ti >= 0) {
        const ta = this.torches.instanceMatrix.array as Float32Array;
        // a dropped torch lies on the ground and burns down
        const burn = Math.max(0, 1 - Math.max(0, t - 1.5) / 2.5);
        ta[ti * 16] = ta[ti * 16 + 5] = ta[ti * 16 + 10] = burn;
        ta[ti * 16 + 13] = this.cur[k * 3 + 1] + 0.1 + (1 - tilt) * 1.9;
      }
      if (t > 6.2) {
        this.state[k] = 2;
        this.dying--;
        const ta = this.torches.instanceMatrix.array as Float32Array;
        if (ti >= 0) ta[ti * 16] = ta[ti * 16 + 5] = ta[ti * 16 + 10] = 0;
        arr.fill(0, lo, lo + 12);
      } else left++;
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.torches.instanceMatrix.needsUpdate = true;
    this.dying = left;
  }
}
