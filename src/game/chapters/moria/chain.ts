/**
 * A hanging, swinging iron chain: a verlet rope drawn as ONE instanced mesh of links (a draw call
 * per chain). Either end can be pinned to a moving point (the troll's ankle, a goblin's fist, the
 * collar on its neck); a free end hangs and drags on the floor. Used for the leash chains in the
 * troll's entrance and the chain that dangles from its collar when it is stunned.
 */
import * as THREE from 'three';
import { mat } from '../../../world';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _d = new THREE.Vector3();

let linkGeo: THREE.TorusGeometry | null = null;

export class RopeChain {
  readonly object = new THREE.Group();
  /** pinned end points (world), updated by the owner every frame; null = that end is free */
  readonly pinA = new THREE.Vector3();
  readonly pinB = new THREE.Vector3();
  usePinA = true;
  usePinB = false;
  readonly n: number;
  readonly segLen: number;
  /** length of the hanging part (m) */
  readonly length: number;
  floorY = 0;
  gravity = 16;
  private readonly p: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private primed = false;

  constructor(segments: number, segLen: number, thick = 1) {
    this.n = segments;
    this.segLen = segLen;
    this.length = segments * segLen;
    for (let i = 0; i <= segments; i++) {
      this.p.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    if (!linkGeo) {
      linkGeo = new THREE.TorusGeometry(0.5, 0.14, 6, 12);
      linkGeo.userData.shared = true;
    }
    const m = mat('metal_dark', { key: 'moriaChain', rgb: [1.0, 0.9, 0.8] });
    this.mesh = new THREE.InstancedMesh(linkGeo, m, segments);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'rope_chain';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.thick = thick;
    this.object.add(this.mesh);
  }
  private thick: number;

  /** (re)start the rope hanging straight down from pinA */
  reset(): void {
    for (let i = 0; i <= this.n; i++) {
      this.p[i].copy(this.pinA).y -= i * this.segLen;
      this.prev[i].copy(this.p[i]);
    }
    this.primed = true;
    this.writeLinks();
  }

  /** world position of the point at index i (0 = pinA end) */
  point(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.p[Math.max(0, Math.min(this.n, i))]);
  }

  /** the lowest point of the rope (for the climb prompt) */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.p[this.n]);
  }

  update(dt: number): void {
    if (!this.primed) this.reset();
    const h = Math.min(dt, 1 / 30);
    if (h <= 0) return;
    const g = this.gravity * h * h;
    const damp = 0.992;
    for (let i = 0; i <= this.n; i++) {
      const p = this.p[i];
      const q = this.prev[i];
      _a.copy(p).sub(q).multiplyScalar(damp);
      q.copy(p);
      p.add(_a);
      p.y -= g;
    }
    for (let it = 0; it < 7; it++) {
      if (this.usePinA) this.p[0].copy(this.pinA);
      if (this.usePinB) this.p[this.n].copy(this.pinB);
      for (let i = 0; i < this.n; i++) {
        const a = this.p[i];
        const b = this.p[i + 1];
        _d.copy(b).sub(a);
        const l = _d.length() || 1e-5;
        const diff = (l - this.segLen) / l;
        const wa = i === 0 && this.usePinA ? 0 : 1;
        const wb = i + 1 === this.n && this.usePinB ? 0 : 1;
        const w = wa + wb;
        if (w === 0) continue;
        a.addScaledVector(_d, (diff * wa) / w);
        b.addScaledVector(_d, -(diff * wb) / w);
      }
      for (let i = 1; i <= this.n; i++) {
        if (this.p[i].y < this.floorY + 0.04) {
          this.p[i].y = this.floorY + 0.04;
          // floor friction
          this.prev[i].x += (this.p[i].x - this.prev[i].x) * 0.3;
          this.prev[i].z += (this.p[i].z - this.prev[i].z) * 0.3;
        }
      }
    }
    if (this.usePinA) this.p[0].copy(this.pinA);
    if (this.usePinB) this.p[this.n].copy(this.pinB);
    this.writeLinks();
  }

  private writeLinks(): void {
    const sc = this.segLen * 0.62;
    for (let i = 0; i < this.n; i++) {
      const a = this.p[i];
      const b = this.p[i + 1];
      _d.copy(b).sub(a);
      const l = _d.length() || 1e-5;
      _d.divideScalar(l);
      _q.setFromUnitVectors(UP, _d);
      // alternate links are rolled a quarter turn about the rope axis
      _q2.setFromAxisAngle(UP, i % 2 ? Math.PI / 2 : 0);
      _q.multiply(_q2);
      _s.set(sc * 0.78 * this.thick, Math.max(this.segLen * 1.35, l * 1.2), sc * 0.78 * this.thick);
      _m.compose(_a.copy(a).add(b).multiplyScalar(0.5), _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.object.removeFromParent();
  }
}
