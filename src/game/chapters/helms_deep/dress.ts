/**
 * Helm's Deep art dressing: everything that makes the level read like its reference pack
 * (docs/refs/scenes/helms_deep) without touching gameplay. Visual only: no colliders.
 *
 *   - stone tint: the wall, tower and court stone a touch lighter and cooler than the mud, so the
 *     structure reads against the ground (palette: structure #64717b over ground #333e47)
 *   - outer pilasters on the wall face: vertical shadow lines every ~10 m, the wall stops reading as
 *     one flat plane (notes gap 3)
 *   - parapet torches + warm pools on the wet walkway: the torch rhythm along the battlements
 *   - Hornburg: the builder's cone-roofed towers become crenellated drums, and the keep gets lit windows
 *   - culvert outflow: a white cascade at the mouth of the culvert while the wall is intact
 *   - siege towers in the coomb, far ridge silhouettes ringing the sky
 *
 * Everything is generated here (no asset files). dispose() restores the shared stone materials.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2 } from '../../../core/rng';
import { getTextureSet, mat, tower, type HelmsDeepResult } from '../../../world';
import type { Fx, FxHandle } from '../../../core/types';
import { L, WALL_H, WALL_T, stairY, wallAt } from './layout';

/** radial glow (hot core, soft halo) as RGBA data; shared by the flame sprites and the floor pools */
function glowTexture(size: number, core: number, halo: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const v = Math.max(0, 1 - d);
    const a = Math.min(1, Math.pow(v, halo) * 1.2 + Math.pow(v, 9) * core);
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a box with world-scale UVs (`tile` metres per texture repeat), baked to (x, y, z) with a yaw */
function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, tile = 3, tiltX = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const ext: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * ext[f][0]) / tile, (uv.getY(k) * ext[f][1]) / tile);
  }
  if (tiltX) g.rotateX(tiltX);
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

function merge(geos: THREE.BufferGeometry[], name: string, material: THREE.Material, shadows = true): THREE.Mesh | null {
  if (!geos.length) return null;
  const g = mergeGeometries(geos, false);
  for (const o of geos) o.dispose();
  if (!g) return null;
  const m = new THREE.Mesh(g, material);
  m.name = name;
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

export interface Dress {
  object: THREE.Group;
  /** the culvert cascade lives in the intact wall group (hidden once the wall is breached) */
  update(dt: number): void;
  dispose(): void;
}

export interface DressOpts {
  hd: HelmsDeepResult;
  /** real flames (pooled GPU particles, the nearest ones take a point light) for the torches */
  fx: Fx;
  ground: (x: number, z: number) => number;
  rng: () => number;
  /** floor positions that should glow warm (braziers, torches): [x, y, z, radius] */
  pools: [number, number, number, number][];
}

/** shared stone materials tinted for the night, restored on dispose */
function tintStone(root: THREE.Object3D): () => void {
  const stone = new Set<THREE.Texture>();
  for (const n of ['stone_blocks', 'cobble'] as const) stone.add(getTextureSet(n).map);
  const seen = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.map || !stone.has(m.map) || seen.has(m)) return;
    seen.set(m, m.color.clone());
  });
  for (const [m] of seen) {
    // cooler, a touch lighter: moonlit wet stone, not a dark-blue slab (and not a pale one)
    m.color.multiply(new THREE.Color(0.86, 0.93, 1.04));
  }
  return () => {
    for (const [m, c] of seen) m.color.copy(c);
  };
}

export function dressHelmsDeep(o: DressOpts): Dress {
  const { hd, ground, rng } = o;
  const root = new THREE.Group();
  root.name = 'hd_dress';
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposers.push(() => x.dispose());
    return x;
  };
  const restoreStone = tintStone(hd.object);

  // the court paving: the builder's cobbles are lit like a pale slab. Rain-black, glossy flagstones
  // (own clone: the builder's material is shared across levels), the torches then pool on them
  const courtSwap: [THREE.Mesh, THREE.Material, THREE.Material][] = [];
  hd.object.traverse((ob) => {
    const m = ob as THREE.Mesh;
    const g = m.geometry as THREE.PlaneGeometry | undefined;
    if (!m.isMesh || Array.isArray(m.material) || g?.type !== 'PlaneGeometry' || g.parameters.width !== 150) return;
    const c = (m.material as THREE.MeshStandardMaterial).clone();
    c.color.multiplyScalar(0.26);
    c.roughness = Math.min(c.roughness, 0.5);
    courtSwap.push([m, m.material, c]);
    m.material = c;
  });

  const wallStone = mat('stone_blocks', { key: 'base' });
  const timber = mat('old_wood', { key: 'siege' });

  // ── outer pilasters: vertical shadow lines on the wall face ────────────────
  {
    const geos: THREE.BufferGeometry[] = [];
    // clear of the ladders (-31 -24 -11 -1 10 21), the towers (-42 -18 30), the culvert (x 5)
    for (const x of [-54, -47.5, -36.5, -27.5, -14.5, -6.5, 16, 25.5, 36, 44, 52, 58]) {
      const w = wallAt(x);
      const yaw = Math.atan2(w.n.x, w.n.z);
      const c = w.c.clone().addScaledVector(w.n, WALL_T / 2 + 0.45);
      geos.push(boxGeo(1.7, WALL_H + 0.6, 1.1, c.x, (WALL_H + 0.6) / 2 - 0.8, c.z, yaw));
      // the battered foot and a shoulder under the cornice
      const f = w.c.clone().addScaledVector(w.n, WALL_T / 2 + 0.85);
      geos.push(boxGeo(2.3, 3.2, 1.6, f.x, 0.6, f.z, yaw));
      const sh = w.c.clone().addScaledVector(w.n, WALL_T / 2 + 0.8);
      geos.push(boxGeo(2.1, 0.7, 1.5, sh.x, WALL_H - 1.5, sh.z, yaw));
    }
    const m = merge(geos, 'hd_pilasters', wallStone);
    if (m) {
      root.add(m);
      own(m.geometry);
    }
  }

  // ── parapet torches and the warm pools they throw on the wet walkway ────────
  const flames: THREE.Vector3[] = [];
  {
    const sticks: THREE.BufferGeometry[] = [];
    const poolPts: [number, number, number, number][] = [...o.pools];
    for (let x = -57.5; x < 61; x += 5.9 + rng() * 1.6) {
      // the culvert section is blown away in cp1: nothing hangs in the air over the breach
      if (x > -5.5 && x < 15.5) continue;
      const w = wallAt(x);
      const p = w.c.clone().addScaledVector(w.n, WALL_T / 2 - 0.3);
      // an iron-shod torch standing in the parapet's crenel
      sticks.push(boxGeo(0.07, 1.0, 0.07, p.x, WALL_H + 1.1 + 0.5, p.z, 0, 0.5));
      sticks.push(boxGeo(0.2, 0.18, 0.2, p.x, WALL_H + 2.15, p.z, 0, 0.5));
      flames.push(new THREE.Vector3(p.x, WALL_H + 2.4, p.z));
      const q = w.c.clone().addScaledVector(w.n, 0.7);
      poolPts.push([q.x, WALL_H + 0.02, q.z, 3.0]);
    }
    // torches down both cheeks of the great stair (shield_stair.jpg): a rhythm of flames leading the eye
    // from the wall walk to the flooded breach
    for (let z = -16; z > -66; z -= 8.5) for (const sx of [-1, 1]) {
      const x = L.stairTop.x + sx * 4.8;
      const y0 = stairY(z) + 0.9;
      sticks.push(boxGeo(0.09, 1.7, 0.09, x, y0 + 0.85, z, 0, 0.5));
      sticks.push(boxGeo(0.24, 0.2, 0.24, x, y0 + 1.75, z, 0, 0.5));
      flames.push(new THREE.Vector3(x, y0 + 2.05, z));
    }
    const sm = merge(sticks, 'hd_parapet_torches', mat('old_wood', { key: 'torchstick' }), false);
    if (sm) {
      root.add(sm);
      own(sm.geometry);
    }
    // pools: flat additive quads
    const geos: THREE.BufferGeometry[] = [];
    for (const [x, y, z, r] of poolPts) {
      const g = new THREE.PlaneGeometry(r * 2, r * 2);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y + 0.015, z);
      geos.push(g);
    }
    const pg = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (pg) {
      const tex = own(glowTexture(64, 0.0, 2.0));
      const pm = own(new THREE.MeshBasicMaterial({
        map: tex, color: new THREE.Color(1.0, 0.5, 0.2), transparent: true, opacity: 0.2, depthWrite: false,
        blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      const pools = new THREE.Mesh(own(pg), pm);
      pools.name = 'hd_torch_pools';
      pools.userData.noAO = true;
      pools.renderOrder = 2;
      root.add(pools);
    }
  }
  // real flames on the parapet and stair torches: the nearest few take a pooled point light, so the
  // wet walkway and the merlons pick up a living orange (a billboard glow read as a pearl, not a flame)
  const flameHandles: FxHandle[] = flames.map((f, i) => o.fx.fire(f, 0.34, { smoke: i % 3 === 0 ? 0.12 : 0, light: i % 2 === 0 }));
  disposers.push(() => { for (const h of flameHandles) h.stop(); });

  // ── Hornburg: crenellated drums for the cone-roofed towers, lit windows ─────
  {
    const hx = 76;
    const hz = -14;
    const drop: THREE.Object3D[] = [];
    for (const c of hd.object.children) {
      for (const [dx, dz] of [[-14, -11], [14, -11], [-14, 11], [14, 11]]) {
        if (Math.abs(c.position.x - (hx + dx)) < 0.05 && Math.abs(c.position.z - (hz + dz)) < 0.05 && c.position.y === 0) drop.push(c);
      }
    }
    for (const c of drop) {
      c.removeFromParent();
      c.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry && !mesh.geometry.userData?.shared) mesh.geometry.dispose();
      });
    }
    for (const [dx, dz] of [[-14, -11], [14, -11], [-14, 11], [14, 11]]) {
      const t = tower(4.4, 40, { slits: 5, seed: dx * 3 + dz, crenellated: true });
      t.object.position.set(hx + dx, 0, hz + dz);
      root.add(t.object);
      // a taller turret on the keep's front corners breaks the skyline
      const tt = tower(2.2, 9, { slits: 1, seed: dx + dz, crenellated: true });
      tt.object.position.set(hx + dx, 40, hz + dz);
      root.add(tt.object);
    }
    // lit windows (keep faces: +z toward the coomb and the wall, -z toward the court)
    const win: THREE.BufferGeometry[] = [];
    const add = (x: number, y: number, z: number, nz: number) => {
      const g = new THREE.PlaneGeometry(0.75, 1.55);
      if (nz < 0) g.rotateY(Math.PI);
      g.translate(x, y, z + nz * 0.04);
      win.push(g);
      // a stone sill under it so it is not just a sticker
    };
    for (const x of [64.5, 69, 73.5, 78.5, 83, 87.5]) for (const y of [9, 15, 21]) {
      if (rng() < 0.18) continue;
      add(x, y, hz + 12, 1);
    }
    for (const x of [68, 72, 76, 80, 84]) for (const y of [11, 17, 22]) {
      if (rng() < 0.2) continue;
      add(x, y, hz - 12, -1);
    }
    for (const x of [72, 76, 80]) for (const y of [34, 38.5]) {
      add(x, y, hz - 2 + 6, 1);
      add(x, y, hz - 2 - 6, -1);
    }
    const wm = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.82, 0.26) }));
    const m = merge(win, 'hd_keep_windows', wm, false);
    if (m) {
      m.userData.noAO = true;
      root.add(m);
      own(m.geometry);
    }
  }

  // ── culvert outflow: a white cascade out of the culvert mouth (intact wall only) ──
  let cascadeTex: THREE.CanvasTexture | null = null;
  {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, S, S);
    // a sheet of falling water: a soft white body with many fine, fast streaks (a few thick streaks read as
    // a barcode), brighter toward the middle and fading out at both sides
    const body = g.createLinearGradient(0, 0, S, 0);
    body.addColorStop(0, 'rgba(225,238,255,0)');
    body.addColorStop(0.25, 'rgba(225,238,255,0.22)');
    body.addColorStop(0.5, 'rgba(235,245,255,0.34)');
    body.addColorStop(0.75, 'rgba(225,238,255,0.22)');
    body.addColorStop(1, 'rgba(225,238,255,0)');
    g.fillStyle = body;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = rng() * S;
      const edge = 1 - Math.abs(x / S - 0.5) * 1.6;
      const w = 0.7 + rng() * 1.6;
      const y0 = rng() * S;
      const len = 20 + rng() * 70;
      const grd = g.createLinearGradient(0, y0, 0, y0 + len);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, `rgba(240,248,255,${(0.2 + rng() * 0.45) * Math.max(0.15, edge)})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x, y0, w, len);
      g.fillRect(x, y0 - S, w, len);
    }
    cascadeTex = own(new THREE.CanvasTexture(cv));
    cascadeTex.wrapS = cascadeTex.wrapT = THREE.RepeatWrapping;
    cascadeTex.colorSpace = THREE.SRGBColorSpace;
    cascadeTex.repeat.set(1, 1.6);
    const pg = own(new THREE.PlaneGeometry(2.3, 3.4, 1, 1));
    const pm = own(new THREE.MeshBasicMaterial({
      map: cascadeTex, color: new THREE.Color(0.75, 0.88, 1.1), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide,
    }));
    const sheet = new THREE.Mesh(pg, pm);
    sheet.name = 'hd_culvert_cascade';
    // from the culvert mouth (y 1.5) leaning out over the plinth to the mud
    sheet.position.set(5, 0.9, -1.55);
    sheet.rotation.x = -Math.PI / 2 + 0.78;
    sheet.userData.noAO = true;
    hd.breach.intact.add(sheet);
    // the foam where it lands
    const fm = own(new THREE.SpriteMaterial({ map: own(glowTexture(32, 0, 1.4)), color: new THREE.Color(0.8, 0.9, 1.05), transparent: true, opacity: 0.3, depthWrite: false, fog: true }));
    const foam = new THREE.Sprite(fm);
    foam.position.set(5, 0.4, 0.9);
    foam.scale.set(5.5, 1.8, 1);
    foam.userData.noAO = true;
    hd.breach.intact.add(foam);
    disposers.push(() => {
      sheet.removeFromParent();
      foam.removeFromParent();
    });
  }

  // ── the wall face: torchlight from the host washes the foot of the wall, rain streaks weep from
  //    the cornice (notes gap 3: wet joints, rough upper stone). Two thin ribbons hugging the face. ──
  {
    const ribbon = (x0: number, x1: number, yLo: number, yHi: number, off: number, uPer: number): THREE.BufferGeometry => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const n = Math.max(2, Math.ceil((x1 - x0) / 1.5));
      const c = new THREE.Vector3();
      const nn = new THREE.Vector3();
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        wallAt(x, c, nn);
        const px = c.x + nn.x * (WALL_T / 2 + off);
        const pz = c.z + nn.z * (WALL_T / 2 + off);
        pos.push(px, yLo, pz, px, yHi, pz);
        uv.push(x / uPer, 0, x / uPer, 1);
        if (i < n) {
          const k = i * 2;
          // the outer normal faces +z: wind so the front face looks outward
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    };
    // textures
    const mk = (w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, rep: boolean): THREE.CanvasTexture => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d')!;
      paint(g);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      if (rep) t.wrapS = THREE.RepeatWrapping;
      return t;
    };
    const spillTex = own(mk(256, 64, (g) => {
      const img = g.createImageData(256, 64);
      for (let x = 0; x < 256; x++) {
        // discrete torch clusters: soft pools of light along the foot of the wall with dark gaps between
        // them (a continuous band read as a lit billboard)
        const c = Math.max(0, 0.5 + 0.9 * fbm2(x / 256 * 7, 3.3, 3, 91));
        const k = Math.pow(c, 2.4);
        for (let y = 0; y < 64; y++) {
          const v = 1 - y / 63; // canvas y 0 = top of the ribbon (v = 1)
          const a = Math.pow(1 - v, 2.4) * k;
          const o = (y * 256 + x) * 4;
          img.data[o] = 255;
          img.data[o + 1] = 255;
          img.data[o + 2] = 255;
          img.data[o + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      g.putImageData(img, 0, 0);
    }, true));
    const streakTex = own(mk(256, 256, (g) => {
      g.clearRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const x = rng() * 256;
        const w = 1.5 + rng() * 5;
        const len = 40 + rng() * 200;
        const grd = g.createLinearGradient(0, 0, 0, len);
        const a = 0.25 + rng() * 0.5;
        grd.addColorStop(0, `rgba(255,255,255,${a})`);
        grd.addColorStop(0.7, `rgba(255,255,255,${a * 0.5})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x, 0, w, len);
        g.fillRect(x - 256, 0, w, len);
        g.fillRect(x + 256, 0, w, len);
      }
    }, true));
    streakTex.repeat.set(1, 1);
    const spillMat = own(new THREE.MeshBasicMaterial({
      map: spillTex, color: new THREE.Color(1.0, 0.42, 0.13), transparent: true, opacity: 0.34, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    const streakMat = own(new THREE.MeshBasicMaterial({
      map: streakTex, color: new THREE.Color(0.012, 0.02, 0.03), transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const add = (x0: number, x1: number, parent: THREE.Object3D) => {
      const spill = new THREE.Mesh(own(ribbon(x0, x1, 0.4, 10.5, 0.03, 20)), spillMat);
      spill.name = 'hd_wall_spill';
      // the streaks run from the cornice down: the texture's top (canvas y 0) is v = 1
      const st = new THREE.Mesh(own(ribbon(x0, x1, 3.05, WALL_H - 0.5, 0.05, 18)), streakMat);
      st.name = 'hd_wall_streaks';
      for (const m of [spill, st]) {
        m.userData.noAO = true;
        m.renderOrder = 1;
        parent.add(m);
      }
    };
    // the same torchlight on the keep's front, low down: the Hornburg picks up the host's glow
    const keepSpill = new THREE.Mesh(own(new THREE.PlaneGeometry(30, 15)), spillMat);
    keepSpill.name = 'hd_keep_spill';
    keepSpill.position.set(76, 0.3 + 7.5, -14 + 12 + 0.05);
    keepSpill.userData.noAO = true;
    keepSpill.renderOrder = 1;
    root.add(keepSpill);
    add(-59, -4, root);
    add(14, 61, root);
    add(-4, 14, hd.breach.intact);
  }

  // ── siege towers in the coomb ───────────────────────────────────────────────
  {
    const geos: THREE.BufferGeometry[] = [];
    const flameTop: THREE.Vector3[] = [];
    const tower3 = (cx: number, cz: number, h: number, yaw: number) => {
      const gy = ground(cx, cz);
      const half = 2.6;
      const loc = (lx: number, ly: number, lz: number) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        return new THREE.Vector3(cx + lx * c + lz * s, gy + ly, cz - lx * s + lz * c);
      };
      // four slightly splayed posts
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const base = loc(sx * (half + 0.6), 0, sz * (half + 0.6));
        geos.push(boxGeo(0.45, h, 0.45, base.x, base.y + h / 2, base.z, yaw, 2));
      }
      // floors, rails and cross braces
      for (const fy of [h * 0.3, h * 0.62, h]) {
        const p = loc(0, fy, 0);
        geos.push(boxGeo(half * 2 + 1.1, 0.35, half * 2 + 1.1, p.x, p.y, p.z, yaw, 2));
      }
      for (const fy of [h * 0.3, h * 0.62]) for (const sz of [-1, 1]) {
        const p = loc(0, fy + h * 0.16, sz * (half + 0.55));
        geos.push(boxGeo(half * 2 + 1.0, h * 0.32, 0.2, p.x, p.y, p.z, yaw, 2));
      }
      const front = loc(0, h * 0.5, -(half + 0.7));
      geos.push(boxGeo(half * 2 + 0.9, h * 0.95, 0.3, front.x, front.y, front.z, yaw, 2));
      for (const sx of [-1, 1]) {
        const p = loc(sx * (half + 0.55), h * 0.5, 0);
        geos.push(boxGeo(0.25, h * 0.9, 0.25, p.x, p.y, p.z, yaw, 2, 0.0));
      }
      // wheels
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const w = loc(sx * (half + 0.9), 0.65, sz * (half * 0.9));
        geos.push(boxGeo(0.3, 1.3, 1.3, w.x, w.y, w.z, yaw, 1));
      }
      // a top rail with merlon-like shields
      for (let k = 0; k < 5; k++) {
        const p = loc(-half + 0.5 + k * ((half * 2 - 1) / 4), h + 0.9, -(half + 0.45));
        geos.push(boxGeo(0.9, 1.4, 0.18, p.x, p.y, p.z, yaw, 1));
      }
      flameTop.push(loc(-half - 0.3, h + 1.9, 0), loc(half + 0.3, h + 1.9, 0), loc(0, h * 0.62 + 1.8, -(half + 0.9)));
    };
    // the towers face the wall: the front (-z local) toward -z world
    tower3(-60, 72, 15.5, Math.PI);
    tower3(50, 68, 16.5, Math.PI);
    tower3(-14, 98, 15.5, Math.PI);
    tower3(86, 112, 14, Math.PI);
    const m = merge(geos, 'hd_siege_towers', timber);
    if (m) {
      root.add(m);
      own(m.geometry);
    }
    const pos = new Float32Array(flameTop.length * 3);
    flameTop.forEach((f, i) => f.toArray(pos, i * 3));
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = own(new THREE.PointsMaterial({
      size: 1.6, map: own(glowTexture(32, 2.2, 2.4)), color: new THREE.Color(1.0, 0.5, 0.16), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    const pts = new THREE.Points(g, pm);
    pts.name = 'hd_siege_flames';
    pts.frustumCulled = false;
    pts.userData.noAO = true;
    root.add(pts);
  }

  // ── far ridges: dark silhouettes ringing the sky (the fog would swallow real distance) ──
  {
    const rings: { r: number; base: number; amp: number; peak: number; top: number; bot: number; seed: number }[] = [
      { r: 520, base: 52, amp: 50, peak: 60, top: 0x0b111a, bot: 0x16202e, seed: 71 },
      { r: 610, base: 95, amp: 70, peak: 80, top: 0x101823, bot: 0x1a2636, seed: 72 },
    ];
    // 480 segments (7 m a step at the near ring): massifs from low-frequency noise, crags from a finer
    // octave. (The first version used |noise| for the peaks, whose creases read as toy pyramids.)
    const SEG = 480;
    for (const ring of rings) {
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const ct = new THREE.Color(ring.top);
      const cb = new THREE.Color(ring.bot);
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = 20 + ca * ring.r;
        const z = 120 + sa * ring.r;
        const massif = 0.5 + 0.5 * fbm2(ca * 1.3, sa * 1.3, 3, ring.seed);
        const saddle = 0.5 + 0.5 * fbm2(ca * 3.4, sa * 3.4, 3, ring.seed + 5);
        const crag = fbm2(ca * 16, sa * 16, 3, ring.seed + 9);
        const h = ring.base + massif * ring.amp + saddle * saddle * ring.peak + crag * ring.peak * 0.12;
        pos.push(x, h, z, x, -50, z);
        col.push(ct.r, ct.g, ct.b, cb.r, cb.g, cb.b);
        if (i < SEG) {
          const k = i * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const g = own(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: true }));
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'hd_ridge';
      mesh.frustumCulled = false;
      mesh.userData.noAO = true;
      root.add(mesh);
    }
  }

  let t = 0;
  return {
    object: root,
    update(dt: number) {
      t += dt;
      if (cascadeTex) cascadeTex.offset.y -= dt * 1.8;
    },
    dispose() {
      restoreStone();
      for (const [m, orig, clone] of courtSwap) {
        m.material = orig;
        clone.dispose();
      }
      for (const d of disposers) d();
      root.removeFromParent();
    },
  };
}
