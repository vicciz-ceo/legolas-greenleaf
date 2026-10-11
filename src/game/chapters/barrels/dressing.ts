/**
 * Art-direction dressing for the Forest River gorge (docs/refs/scenes/barrels): the things the stock
 * builders do not give us.
 *
 *   buildWhitewater   scrolling lacy foam sheets over the rapids and the gate cascade, thickest around the
 *                     rocks and along the banks (the river shader's own foam is too thin to read as white water)
 *   buildSpray        a drifting veil of spray particles over the cascade and the rapids
 *   buildRidges       the far skyline: two layers of misty forested ridges and a snow-capped peak or two, which
 *                     follow the camera so they sit at infinity and shut the horizon between the gorge walls
 *
 * Everything is generated here in code (canvas textures, vertex colours); no assets, no network.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { Rng, fbm2 } from '../../../core/rng';
import { clamp, lerp, smoothstep } from '../../../core/math';
import { RIVER_LEN, RIVER_ROCKS, S, flowSpeedAt, riverPos, waterY, widthAt } from './layout';

// ─────────────────────────────────────────────────────────────────────────────
// Whitewater
// ─────────────────────────────────────────────────────────────────────────────

/** a tileable lacy-foam texture: white clumps with torn holes and fine speckle, alpha carries the shape */
function foamTexture(seed: number): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(N, N);
  const hash = (ix: number, iy: number, px: number, py: number, sd: number): number => {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(sd, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  // periodic value noise: lattice of px x py cells wraps at the texture edge
  const vn = (u: number, v: number, px: number, py: number, sd: number): number => {
    const x = u * px;
    const y = v * py;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, px, py, sd);
    const b = hash(ix + 1, iy, px, py, sd);
    const c = hash(ix, iy + 1, px, py, sd);
    const d = hash(ix + 1, iy + 1, px, py, sd);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // streaks run along v (the flow): fewer cells that way
      let f = 0;
      let a = 0.5;
      let nrm = 0;
      for (let o = 0; o < 5; o++) {
        const p = 3 << o;
        f += a * vn(u, v, p, Math.max(2, p >> 1), seed + o * 17);
        nrm += a;
        a *= 0.55;
      }
      f /= nrm;
      const lace = smoothstep(0.46, 0.7, f);
      const speck = smoothstep(0.66, 0.9, vn(u, v, 48, 32, seed + 301)) * 0.55;
      const al = clamp(lace * (0.75 + 0.25 * vn(u, v, 24, 24, seed + 77)) + speck * (1 - lace * 0.6), 0, 1);
      const i = (y * N + x) * 4;
      const sh = 0.9 + 0.1 * f;
      img.data[i] = 255 * sh * 0.97;
      img.data[i + 1] = 255 * sh;
      img.data[i + 2] = 255 * sh;
      img.data[i + 3] = 255 * al;
    }
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = false;
  return t;
}

/** how white the water is at river distance s (0 calm .. 1 cascade) */
function whiteness(s: number): number {
  const cascade = (1 - smoothstep(S.gate + 24, S.gate + 70, s)) * smoothstep(S.gate - 5, S.gate + 1, s);
  const early = 0.42 * smoothstep(S.gate + 24, S.gate + 80, s) * (1 - smoothstep(160, 176, s));
  const rapids1 = 0.78 * smoothstep(164, 190, s) * (1 - smoothstep(414, 436, s));
  const rapids2 = 0.78 * smoothstep(500, 524, s) * (1 - smoothstep(690, 712, s));
  return clamp(cascade + early + rapids1 + rapids2, 0, 1);
}

interface FoamLayer {
  tile: [number, number];
  speed: number;
  seed: number;
  alpha: number;
  lift: number;
}

/** white-water sheets along the river, over the water mesh. Scrolls with the flow. */
export function buildWhitewater(level: LevelAPI, heightAt: (x: number, z: number) => number): void {
  const layers: FoamLayer[] = [
    { tile: [8, 11], speed: 0.95, seed: 5, alpha: 0.95, lift: 0.1 },
    { tile: [3.6, 5.0], speed: 1.35, seed: 29, alpha: 0.75, lift: 0.13 },
  ];
  const STEP = 1.5;
  const NA = 22;
  const s0 = S.gate - 6;
  const s1 = 712;
  const ns = Math.ceil((s1 - s0) / STEP);
  const rocks = RIVER_ROCKS;
  const textures: { t: THREE.CanvasTexture; rate: number }[] = [];
  const _p = new THREE.Vector3();
  for (const L of layers) {
    const tex = foamTexture(L.seed);
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= ns; i++) {
      const s = s0 + i * STEP;
      const w = widthAt(s) / 2 + 0.9;
      const wh = whiteness(s);
      for (let k = 0; k <= NA; k++) {
        const t = -1 + (2 * k) / NA;
        const l = t * w;
        riverPos(s, l, L.lift, _p);
        // rapids are not uniformly white: low-frequency gaps of dark teal, pale lanes down the middle
        const gap = 0.45 + 1.1 * (fbm2(s * 0.05 + L.seed, t * 2.3, 3, 101) * 0.5 + 0.5);
        let a = wh * gap * lerp(1.0, 0.8, Math.abs(t) * Math.abs(t)) * (0.7 + 0.5 * smoothstep(0.6, 1.0, Math.abs(t)));
        // thicker around every rock and in its wake
        for (const r of rocks) {
          const ds = s - r.s;
          if (ds < -r.r * 2.4 || ds > 12) continue;
          const d = Math.hypot(ds, l - r.l);
          a += 0.95 * (1 - smoothstep(r.r * 1.0, r.r * 1.0 + 2.6, d));
          if (ds > 0) a += 0.7 * (1 - smoothstep(1, 11, ds)) * (1 - smoothstep(r.r * 0.3, r.r * 1.3 + 0.6, Math.abs(l - r.l)));
        }
        // gone where the ground is above the water (the water mesh feathers its own bank foam)
        const depth = waterY(s) - heightAt(_p.x, _p.z);
        a *= smoothstep(0.02, 0.45, depth);
        a = clamp(a, 0, 1) * L.alpha;
        pos.push(_p.x, _p.y, _p.z);
        col.push(1, 1, 1, a);
        uv.push(l / L.tile[0] + 0.5, s / L.tile[1]);
      }
    }
    const row = NA + 1;
    for (let i = 0; i < ns; i++) {
      for (let k = 0; k < NA; k++) {
        const a = i * row + k;
        const b = (i + 1) * row + k;
        // the river's right-hand side is +l; wind so the sheet faces up
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // some bends wind the sheet the other way: flip to face up
    const nrm = geo.getAttribute('normal');
    let up = 0;
    for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
    if (up < 0) {
      const ix = geo.getIndex()!;
      for (let k = 0; k < ix.count; k += 3) {
        const t = ix.getX(k + 1);
        ix.setX(k + 1, ix.getX(k + 2));
        ix.setX(k + 2, t);
      }
      geo.computeVertexNormals();
    }
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.55,
      color: 0xf4f8f8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'whitewater';
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    level.root.add(mesh);
    textures.push({ t: tex, rate: (L.speed * 6.5) / L.tile[1] });
  }
  // flow: the foam pattern slides downstream (v grows with s) at the rapids' speed
  level.onUpdate((dt) => {
    for (const x of textures) x.t.offset.y -= dt * x.rate * (0.6 + flowSpeedAt(330) * 0.07);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Spray
// ─────────────────────────────────────────────────────────────────────────────

function softDot(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const cx = cv.getContext('2d')!;
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** drifting spray over the gate cascade and the rapids: slow soft puffs that rise, spread and fade */
export function buildSpray(level: LevelAPI): void {
  const N = 520;
  const rng = new Rng(8821);
  const pos = new Float32Array(N * 3);
  const seedS = new Float32Array(N);
  const seedL = new Float32Array(N);
  const age = new Float32Array(N);
  const life = new Float32Array(N);
  const spots: { s0: number; s1: number; w: number }[] = [
    { s0: S.gate - 2, s1: S.gate + 34, w: 0.34 },
    { s0: 176, s1: 424, w: 0.34 },
    { s0: 520, s1: 700, w: 0.32 },
  ];
  const tmp = new THREE.Vector3();
  const place = (i: number) => {
    const r = rng.float();
    let acc = 0;
    let z = spots[0];
    for (const sp of spots) {
      acc += sp.w;
      z = sp;
      if (r < acc) break;
    }
    seedS[i] = lerp(z.s0, z.s1, rng.float());
    seedL[i] = (rng.float() * 2 - 1) * 0.55;
    life[i] = 3.2 + rng.float() * 3;
    age[i] = rng.float() * life[i];
  };
  for (let i = 0; i < N; i++) place(i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: softDot(),
    size: 4.2,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    opacity: 0.2,
    color: 0xeef4f4,
    fog: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.name = 'spray';
  level.root.add(pts);
  level.onUpdate((dt) => {
    for (let i = 0; i < N; i++) {
      age[i] += dt;
      if (age[i] > life[i]) {
        place(i);
        age[i] = 0;
      }
      const t = age[i] / life[i];
      const s = seedS[i];
      const hw = widthAt(s) / 2;
      riverPos(s + t * 3, seedL[i] * hw, 0.4 + t * 2.4 + 0.5 * Math.sin(i), tmp);
      pos[i * 3] = tmp.x;
      pos[i * 3 + 1] = tmp.y;
      pos[i * 3 + 2] = tmp.z;
    }
    geo.attributes.position.needsUpdate = true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skyline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Misty ridges all round the horizon, drawn without fog (their own colours fade into the haze at the
 * foot). The ring follows the camera in x/z, so it is always "very far away": it fills the gaps between
 * the gorge walls and the rim trees with layered silhouettes instead of bare sky-colour.
 */
export function buildRidges(level: LevelAPI): void {
  const group = new THREE.Group();
  group.name = 'ridges';
  const haze = new THREE.Color(0xbdd0d0);
  const rngA = new Rng(4040);
  const layers = [
    // radius, base height, ridge height, colour at the crest, noise seed, snow line (m)
    { r: 1020, h0: 70, amp: 150, snow: 215, crest: 0x8fa2b4, seed: 11 },
    { r: 880, h0: 38, amp: 92, snow: 9999, crest: 0x7d96a1, seed: 23 },
    { r: 760, h0: 22, amp: 54, snow: 9999, crest: 0x6f8a86, seed: 37 },
  ];
  const SEG = 180;
  for (const L of layers) {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const crest = new THREE.Color(L.crest);
    const snow = new THREE.Color(0xeef3f6);
    const c = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.sin(a) * L.r;
      const z = Math.cos(a) * L.r;
      // periodic in angle: sample noise on a circle
      const nx = Math.cos(a) * 2.2;
      const nz = Math.sin(a) * 2.2;
      const big = fbm2(nx, nz, 4, L.seed) * 0.5 + 0.5;
      const ridge = 1 - Math.abs(fbm2(nx * 2.1 + 5, nz * 2.1, 3, L.seed + 3));
      const hgt = L.h0 + L.amp * (0.25 + 0.75 * big) * (0.55 + 0.6 * ridge);
      // a few tall peaks
      const peak = L.snow < 9999 ? Math.pow(Math.max(0, fbm2(nx * 0.9, nz * 0.9, 2, L.seed + 9)), 2) * 260 : 0;
      const top = hgt + peak;
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const y = -30 + (top + 30) * t;
        pos.push(x, y, z);
        // fog-coloured foot, ridge colour at the crest, snow above the line
        const k1 = smoothstep(0.0, 0.85, t);
        c.copy(haze).lerp(crest, k1 * 0.85);
        if (y > L.snow) c.lerp(snow, smoothstep(L.snow, L.snow + 40, y) * 0.85 * t);
        // the crest itself is a touch lighter (backlit haze)
        c.lerp(haze, t > 0.92 ? 0.18 : 0);
        col.push(c.r, c.g, c.b);
      }
    }
    const per = 7;
    for (let i = 0; i < SEG; i++) {
      for (let k = 0; k < per - 1; k++) {
        const a = i * per + k;
        const b = (i + 1) * per + k;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.frustumCulled = false;
    m.renderOrder = -1;
    group.add(m);
  }
  void rngA;
  level.root.add(group);
  const cam = level.ctx.engine.camera;
  const follow = () => {
    group.position.set(cam.position.x, riverPos(S.gate + 200, 0).y - 8, cam.position.z);
  };
  follow();
  level.onUpdate(follow);
  void RIVER_LEN;
}
