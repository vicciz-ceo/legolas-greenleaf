/**
 * The far landmarks of Mordor, built in code and kept inside the camera's 1200 m:
 *
 *  - Orodruin (Mount Doom): a displaced cone with a glowing caldera, lava flows and a smoke plume.
 *  - Barad-dur: a tapering fortress of tiers with a spiked crown and the burning Eye, dead ahead
 *    behind the Black Gate. `collapse()` brings it down tier by tier as a silhouette.
 *  - Mountain walls (Ered Lithui, the Ash Mountains) that close the horizon.
 *  - Sky effects for the fall of Sauron: a flash, a shock ring and rolling dust.
 *
 * Everything uses fog-capped materials so the far shapes keep their own colour inside the haze.
 */
import * as THREE from 'three';
import type { LevelAPI } from '../../../core/types';
import { mat, plain } from '../../../world';
import { applyFogCap } from '../../../world/shader';
import { cliffGeometry, limbGeo, xf } from '../../../world/geom';
import { MeshKit, bakeFaceBoxUV } from '../../../world/util';
import { fbm2, Rng } from '../../../core/rng';
import { clamp, easeInOutSine, smoothstep } from '../../../core/math';
import { FAR } from './layout';

// ─────────────────────────────────────────────────────────────────────────────
// shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // a little turbulence so the puffs do not look like discs
  const img = g.getImageData(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const n = 0.72 + 0.28 * (fbm2(x * 0.08, y * 0.08, 3, 91) * 0.5 + 0.5);
      img.data[(y * 128 + x) * 4 + 3] *= n;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const farMat = (key: string, rgb: [number, number, number], cap = 0.85): THREE.Material => {
  const m = mat('cliff', { key, rgb });
  applyFogCap(m, cap);
  return m;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mount Doom
// ─────────────────────────────────────────────────────────────────────────────

const DOOM_R = 470;
const DOOM_H = 330;
const DOOM_CRATER = 46;

/** surface point of the volcano at angle u (0..2pi) and height fraction t (0..1) */
function doomPoint(u: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  const rim = smoothstep(0.86, 1, t);
  let r = DOOM_CRATER + (DOOM_R - DOOM_CRATER) * Math.pow(1 - t, 1.55);
  const n = fbm2(Math.cos(u) * 2.2 + t * 1.4, Math.sin(u) * 2.2 + t * 1.4, 4, 31);
  const ravine = Math.abs(fbm2(Math.cos(u) * 4.5, Math.sin(u) * 4.5 + t * 0.6, 3, 32));
  r *= 1 + 0.2 * n - 0.14 * ravine;
  let y = DOOM_H * Math.pow(t, 0.9) * (1 + 0.06 * n);
  // the caldera lip is a little raised, the inside falls away
  y += rim * 6 * (0.5 + 0.5 * Math.sin(u * 3 + 1));
  return out.set(Math.cos(u) * r, y, Math.sin(u) * r);
}

function volcanoGeometry(): THREE.BufferGeometry {
  const NA = 84;
  const NH = 30;
  const pos: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= NH; j++) {
    for (let i = 0; i <= NA; i++) {
      doomPoint(((i % NA) / NA) * Math.PI * 2, j / NH, v);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let j = 0; j < NH; j++) {
    for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i;
      const b = a + 1;
      const c = a + NA + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return bakeFaceBoxUV(g, 140);
}

/** a lava flow: a ribbon hugging the slope from the crater down, bright at the top */
function lavaFlowGeometry(u0: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const rows = 26;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  let u = u0;
  const base = 0.12 + rng.float() * 0.18;
  for (let j = 0; j <= rows; j++) {
    const t = 0.985 - (j / rows) * (0.985 - base);
    u += (rng.float() - 0.5) * 0.045;
    doomPoint(u, t, p);
    doomPoint(u + 0.012, t, q);
    const w = (3 + (j / rows) * 12) * (0.7 + 0.6 * rng.float());
    const side = new THREE.Vector3().subVectors(q, p).normalize().multiplyScalar(w);
    const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(2.5);
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * s + out.x, p.y + 2.5, p.z + side.z * s + out.z);
      const k = 1 - j / rows;
      const heat = 0.25 + 0.75 * Math.pow(k, 1.2);
      col.push(1.9 * heat, 0.62 * heat, 0.1 * heat);
    }
    if (j < rows) {
      const a = j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Barad-dur
// ─────────────────────────────────────────────────────────────────────────────

interface Tier {
  group: THREE.Group;
  /** rest height of the tier's base */
  y0: number;
  h: number;
  /** collapse delay (s), tilt axis and amount */
  delay: number;
  tiltX: number;
  tiltZ: number;
}

export interface Landmarks {
  update(dt: number): void;
  /** the Eye flares (0 = normal burning, 1 = blinding) */
  setEyeFlare(k: number): void;
  /** begin the collapse of Barad-dur (takes about 9 s) */
  collapse(): void;
  readonly collapsed: boolean;
  /** extinguish the Eye and the windows */
  blackout(): void;
  /** a white-orange flash on the horizon (decays over ~2.5 s) */
  flash(): void;
  /** an expanding shock ring across the plain (toward the player) */
  shock(): void;
  /** a bank of dust rolling in from the horizon */
  dustWall(): void;
  /** position of the tower's crown (for camera aims) */
  readonly crown: THREE.Vector3;
  readonly doom: THREE.Vector3;
}

export function buildLandmarks(level: LevelAPI, ground: (x: number, z: number) => number): Landmarks {
  const root = new THREE.Group();
  root.name = 'landmarks';
  level.root.add(root);
  const puff = puffTexture();

  // ── mountain walls closing the horizon ──────────────────────────────────
  const rockA = farMat('bgRidgeA', [0.2, 0.18, 0.19], 0.8);
  const rockB = farMat('bgRidgeB', [0.15, 0.13, 0.14], 0.88);
  const ridge = (x: number, z: number, w: number, h: number, d: number, yaw: number, seed: number, m: THREE.Material, taper = 0.55) => {
    const g = cliffGeometry(w, h, d, seed, { rough: 1.1, taper, strata: 0.2, cell: Math.max(14, w / 14), tile: 120 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, h * 0.32 - 6, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noAO = true;
    root.add(mesh);
  };
  // the mountains the Gate is cut into (the wing walls run into them): low enough to leave Orodruin visible
  ridge(-290, -10, 250, 118, 150, 0.1, 3, rockA, 0.6);
  ridge(290, -10, 250, 126, 150, -0.1, 4, rockA, 0.6);
  ridge(-420, 80, 220, 96, 170, 0.35, 5, rockA, 0.55);
  ridge(420, 80, 220, 104, 170, -0.35, 6, rockA, 0.55);
  // Ered Lithui and the Ash Mountains: a broken rim on every side
  ridge(-760, -420, 520, 190, 200, 0.5, 7, rockB);
  ridge(-300, -560, 460, 130, 160, 0.1, 8, rockB);
  ridge(250, -760, 520, 150, 180, -0.2, 9, rockB);
  ridge(800, -250, 480, 170, 200, -0.7, 10, rockB);
  ridge(-900, 120, 460, 150, 220, 1.1, 11, rockB);
  ridge(900, 160, 460, 160, 220, -1.1, 12, rockB);
  ridge(-820, 600, 520, 120, 200, 0.9, 13, rockB);
  ridge(820, 620, 520, 130, 200, -0.9, 14, rockB);
  ridge(-300, 940, 600, 110, 180, 0.2, 15, rockB);
  ridge(380, 960, 600, 120, 180, -0.15, 16, rockB);

  // ── Mount Doom ──────────────────────────────────────────────────────────
  const doom = new THREE.Group();
  doom.position.set(FAR.doom.x, ground(FAR.doom.x, FAR.doom.z) - 12, FAR.doom.z);
  doom.name = 'orodruin';
  const doomRock = mat('rock', { key: 'orodruin', rgb: [0.17, 0.13, 0.12] });
  applyFogCap(doomRock, 0.78);
  const cone = new THREE.Mesh(volcanoGeometry(), doomRock);
  cone.castShadow = false;
  cone.receiveShadow = false;
  cone.userData.noAO = true;
  doom.add(cone);
  const lavaMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(lavaFlowGeometry((i / 9) * Math.PI * 2 + 0.3, 400 + i), lavaMat);
    m.userData.noAO = true;
    m.castShadow = false;
    doom.add(m);
  }
  // the caldera: a molten lake and a glow that bleeds into the clouds
  const lake = new THREE.Mesh(new THREE.CircleGeometry(DOOM_CRATER * 0.95, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.85, 0.16), fog: false }));
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = DOOM_H * 0.985;
  lake.userData.noAO = true;
  doom.add(lake);
  const glowMat = new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(1.9, 0.55, 0.12), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.9 });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(380, 260, 1);
  glow.position.y = DOOM_H + 30;
  glow.userData.noAO = true;
  doom.add(glow);
  const glow2 = new THREE.Sprite(glowMat.clone());
  glow2.scale.set(900, 520, 1);
  glow2.position.y = DOOM_H + 120;
  (glow2.material as THREE.SpriteMaterial).opacity = 0.34;
  glow2.userData.noAO = true;
  doom.add(glow2);
  // the plume: puffs rise out of the crater, lean east on the wind and spread into the cloud deck
  const plumeMat = new THREE.SpriteMaterial({ map: puff, color: 0x3a2018, depthWrite: false, fog: false, transparent: true, opacity: 0.8 });
  const plumeLit = new THREE.SpriteMaterial({ map: puff, color: 0x9a3a18, depthWrite: false, fog: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
  const plume: { s: THREE.Sprite; phase: number; lit: boolean }[] = [];
  const PUFFS = 22;
  for (let i = 0; i < PUFFS; i++) {
    const lit = i % 3 === 0;
    const s = new THREE.Sprite((lit ? plumeLit : plumeMat).clone());
    s.userData.noAO = true;
    doom.add(s);
    plume.push({ s, phase: i / PUFFS, lit });
  }
  root.add(doom);
  const doomTop = new THREE.Vector3(doom.position.x, doom.position.y + DOOM_H, doom.position.z);

  // ── Barad-dur ───────────────────────────────────────────────────────────
  const tower = new THREE.Group();
  tower.name = 'barad_dur';
  tower.position.set(FAR.tower.x, ground(FAR.tower.x, FAR.tower.z) - 4, FAR.tower.z);
  root.add(tower);
  const stone = farMat('baraddur', [0.11, 0.1, 0.11], 0.86);
  const glass = plain(0xff7a22, { emissive: 0xff6a18, emissiveIntensity: 2.4, roughness: 1, key: 'bdwin' });
  const tiers: Tier[] = [];
  const rng = new Rng(77);
  const tierDefs: { w: number; h: number; d: number; taper: number; delay: number }[] = [
    { w: 330, h: 120, d: 240, taper: 0.3, delay: 5.2 },
    { w: 190, h: 150, d: 150, taper: 0.26, delay: 3.9 },
    { w: 130, h: 130, d: 110, taper: 0.28, delay: 2.7 },
    { w: 92, h: 100, d: 80, taper: 0.3, delay: 1.5 },
  ];
  let y = 0;
  tierDefs.forEach((td, i) => {
    const kit = new MeshKit();
    kit.add(stone, cliffGeometry(td.w, td.h, td.d, 20 + i, { rough: 0.8, taper: td.taper, strata: 0.7, cell: Math.max(9, td.w / 16), tile: 60 }), xf(0, td.h / 2, 0));
    // buttresses and bastions
    const nb = i === 0 ? 4 : 6;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2 + 0.4 + i;
      const bw = td.w * (i === 0 ? 0.2 : 0.12);
      const bh = td.h * (0.8 + 0.4 * rng.float());
      kit.add(stone, cliffGeometry(bw, bh, bw, 40 + i * 7 + k, { rough: 0.9, taper: 0.4, cell: 8, tile: 50 }), xf(Math.cos(a) * td.w * 0.42, bh / 2, Math.sin(a) * td.d * 0.42, a));
    }
    // jagged spikes along the shoulder of every tier
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const len = (12 + rng.float() * 20) * (1 - i * 0.12);
      const x0 = Math.cos(a) * td.w * 0.36;
      const z0 = Math.sin(a) * td.d * 0.36;
      kit.add(stone, limbGeo([x0, td.h * 0.96, z0], [x0 * 1.1, td.h * 0.96 + len, z0 * 1.1], 3.2, 0.2, 5, 30));
    }
    // a scatter of fire-lit windows on the face toward the player (+Z) and the sides
    for (let k = 0; k < 16 + (3 - i) * 4; k++) {
      const wy = td.h * (0.1 + 0.8 * rng.float());
      const wx = (rng.float() - 0.5) * td.w * 0.55;
      kit.box(glass, [2.4, 5.5 + rng.float() * 3, 1.2], [wx, wy, td.d * 0.5 * (1 - td.taper * (wy / td.h) * 0.6) + 0.4]);
    }
    const group = kit.build({ name: `tier${i}`, castShadow: false, receiveShadow: false });
    group.position.y = y;
    group.traverse((o) => (o.userData.noAO = true));
    tower.add(group);
    tiers.push({ group, y0: y, h: td.h, delay: td.delay, tiltX: (rng.float() - 0.5) * 0.7, tiltZ: (rng.float() - 0.5) * 0.7 });
    y += td.h * 0.94;
  });
  // the crown: a great forked head and the Eye
  const crown = new THREE.Group();
  crown.name = 'crown';
  {
    const kit = new MeshKit();
    kit.add(stone, cliffGeometry(60, 50, 52, 61, { rough: 0.7, taper: 0.35, cell: 7, tile: 40 }), xf(0, 25, 0));
    for (const s of [-1, 1]) {
      kit.add(stone, limbGeo([s * 16, 46, 0], [s * 30, 100, 4], 9, 2.4, 7, 30));
      kit.add(stone, limbGeo([s * 30, 100, 4], [s * 24, 150, 10], 2.6, 0.2, 6, 30));
      kit.add(stone, limbGeo([s * 8, 46, 0], [s * 6, 120, -3], 5, 0.4, 6, 30));
    }
    kit.add(stone, limbGeo([0, 46, 0], [0, 168, 0], 6, 0.3, 6, 30));
    for (let k = 0; k < 7; k++) kit.add(stone, limbGeo([Math.cos(k) * 22, 44, Math.sin(k) * 18], [Math.cos(k) * 30, 70 + k * 4, Math.sin(k) * 24], 2.4, 0.2, 5, 30));
    const g = kit.build({ name: 'crown_mesh', castShadow: false, receiveShadow: false });
    crown.add(g);
  }
  crown.position.y = y - 6;
  crown.traverse((o) => (o.userData.noAO = true));
  tower.add(crown);
  // the Eye: a burning lens with a black slit, set in the crown's fork and facing the plain
  const eye = new THREE.Group();
  eye.position.set(0, 82, 14);
  const eyeBody = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 0.1), fog: false }));
  eyeBody.scale.set(9, 26, 5);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0x050202, fog: false }));
  pupil.scale.set(1.5, 22, 5.4);
  pupil.position.z = 0.5;
  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(2.2, 0.7, 0.12), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.85 }));
  eyeGlow.scale.set(200, 240, 1);
  const eyeHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(1.4, 0.36, 0.06), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.4 }));
  eyeHalo.scale.set(620, 640, 1);
  eye.add(eyeHalo, eyeGlow, eyeBody, pupil);
  for (const o of [eyeBody, pupil, eyeGlow, eyeHalo]) o.userData.noAO = true;
  crown.add(eye);
  const crownWorld = new THREE.Vector3();
  crown.getWorldPosition(crownWorld);
  crownWorld.y += 70;

  // ── sky effects ─────────────────────────────────────────────────────────
  const flashMat = new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(4, 3.1, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0 });
  const flashSprite = new THREE.Sprite(flashMat);
  flashSprite.position.copy(crownWorld);
  flashSprite.scale.set(10, 10, 1);
  flashSprite.userData.noAO = true;
  flashSprite.visible = false;
  root.add(flashSprite);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.userData.noAO = true;
  ring.frustumCulled = false;
  root.add(ring);
  const dust: { s: THREE.Sprite; x: number; z: number; v: number; life: number; t: number; size: number }[] = [];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.SpriteMaterial({ map: puff, color: i % 4 === 0 ? 0x8a3a1a : 0x3a2418, depthWrite: false, fog: false, transparent: true, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.visible = false;
    s.userData.noAO = true;
    root.add(s);
    dust.push({ s, x: 0, z: 0, v: 0, life: 1, t: 99, size: 100 });
  }

  // ── state ────────────────────────────────────────────────────────────────
  let clock = 0;
  let eyeFlare = 0;
  let collapsing = false;
  let collapseT = 0;
  let collapsed = false;
  let flashT = 99;
  let shockT = 99;
  let dustT = 99;
  let dark = false;
  const tmp = new THREE.Vector3();

  const L: Landmarks = {
    crown: crownWorld,
    doom: doomTop,
    get collapsed() {
      return collapsed;
    },
    setEyeFlare(k) {
      eyeFlare = k;
    },
    collapse() {
      if (collapsing) return;
      collapsing = true;
      collapseT = 0;
      // the crown breaks from the tower and the dust starts to roll
      for (let i = 0; i < 18; i++) {
        const d = dust[i];
        d.t = -rng.float() * 3;
        d.x = FAR.tower.x + (rng.float() - 0.5) * 220;
        d.z = FAR.tower.z + (rng.float() - 0.5) * 140;
        d.v = 6 + rng.float() * 18;
        d.life = 7 + rng.float() * 4;
        d.size = 120 + rng.float() * 200;
      }
    },
    blackout() {
      dark = true;
    },
    flash() {
      flashT = 0;
      flashSprite.visible = true;
    },
    shock() {
      shockT = 0;
      ring.visible = true;
      ring.position.set(FAR.tower.x, tower.position.y + 6, FAR.tower.z);
    },
    dustWall() {
      dustT = 0;
      for (let i = 18; i < dust.length; i++) {
        const d = dust[i];
        const a = (i - 18) / (dust.length - 18);
        d.x = FAR.tower.x + (a - 0.5) * 900;
        d.z = FAR.tower.z + 120 + rng.float() * 60;
        d.v = 70 + rng.float() * 40;
        d.t = -rng.float() * 1.2;
        d.life = 9 + rng.float() * 3;
        d.size = 160 + rng.float() * 220;
      }
    },
    update(dt) {
      clock += dt;
      // Doom's plume: puffs rise and spread
      for (const p of plume) {
        const k = (clock * 0.018 + p.phase) % 1;
        const h = 20 + k * 520;
        const s = 70 + k * 330;
        p.s.position.set(Math.sin(k * 2.2 + p.phase * 9) * 24 + k * 170, DOOM_H + h, Math.cos(k * 1.7 + p.phase * 7) * 18 - k * 40);
        p.s.scale.set(s, s * 0.8, 1);
        (p.s.material as THREE.SpriteMaterial).opacity = (p.lit ? 0.55 : 0.78) * smoothstep(0, 0.1, k) * (1 - smoothstep(0.62, 1, k)) * (p.lit ? 1 - k : 1);
      }
      glowMat.opacity = 0.82 + 0.1 * Math.sin(clock * 1.7) + 0.05 * Math.sin(clock * 4.3);
      // the Eye
      const flick = 0.85 + 0.12 * Math.sin(clock * 3.1) + 0.06 * Math.sin(clock * 7.9);
      const live = dark ? 0 : 1;
      (eyeGlow.material as THREE.SpriteMaterial).opacity = live * clamp((0.7 + 0.5 * eyeFlare) * flick, 0, 1);
      (eyeHalo.material as THREE.SpriteMaterial).opacity = live * (0.34 + 0.4 * eyeFlare) * flick;
      eyeBody.visible = pupil.visible = !dark;
      eyeBody.scale.set(9 + 5 * eyeFlare, 26 + 14 * eyeFlare, 5);
      eyeGlow.scale.set(200 + 380 * eyeFlare, 240 + 440 * eyeFlare, 1);
      glass.emissiveIntensity = dark ? 0 : 2.4 + eyeFlare * 3;

      // the collapse
      if (collapsing && !collapsed) {
        collapseT += dt;
        // crown first: it tilts, breaks away and sinks
        const kc = clamp(collapseT / 3.4, 0, 1);
        crown.rotation.z = easeInOutSine(kc) * 0.55;
        crown.rotation.x = easeInOutSine(kc) * -0.2;
        crown.position.y = tiers[tiers.length - 1].y0 + tiers[tiers.length - 1].h * 0.94 - 6 - easeInOutSine(kc) * 40 - kc * kc * 120 * smoothstep(0.55, 1, kc);
        for (let i = tiers.length - 1; i >= 0; i--) {
          const T = tiers[i];
          const k = clamp((collapseT - T.delay) / 4.6, 0, 1);
          if (k <= 0) continue;
          const e = k * k * (3 - 2 * k);
          T.group.rotation.x = T.tiltX * e;
          T.group.rotation.z = T.tiltZ * e;
          T.group.scale.y = 1 - 0.78 * e * (i === 0 ? 0.7 : 1);
          T.group.position.y = T.y0 - e * T.h * 0.35 - (i > 0 ? e * T.h * 0.2 : 0);
        }
        // keep the stack together: each tier rides on the one below
        for (let i = 1; i < tiers.length; i++) {
          const below = tiers[i - 1];
          const top = below.group.position.y + below.h * 0.94 * below.group.scale.y;
          tiers[i].group.position.y = Math.min(tiers[i].group.position.y, top);
        }
        if (collapseT > 11) collapsed = true;
      }

      // flash
      if (flashT < 4) {
        flashT += dt;
        const k = flashT;
        const a = k < 0.12 ? k / 0.12 : Math.exp(-(k - 0.12) * 1.15);
        flashMat.opacity = clamp(a, 0, 1);
        const s = 160 + k * 900;
        flashSprite.scale.set(s * 1.5, s, 1);
        if (flashT >= 4) flashSprite.visible = false;
      }
      // shock ring: expands over the plain
      if (shockT < 5) {
        shockT += dt;
        const r = 30 + shockT * 330;
        ring.scale.set(r, r, 1);
        ringMat.opacity = 0.7 * (1 - smoothstep(0.2, 5, shockT)) * smoothstep(0, 0.25, shockT);
        if (shockT >= 5) ring.visible = false;
      }
      // dust
      void dustT;
      for (const d of dust) {
        if (d.t >= d.life) continue;
        d.t += dt;
        if (d.t < 0) continue;
        const k = d.t / d.life;
        d.s.visible = true;
        const sz = d.size * (0.5 + k * 1.6);
        d.s.scale.set(sz * 1.6, sz, 1);
        tmp.set(d.x, 0, d.z);
        const dz = d.v * d.t;
        d.s.position.set(d.x, ground(d.x, d.z + dz) + sz * 0.32, d.z + dz);
        (d.s.material as THREE.SpriteMaterial).opacity = 0.62 * smoothstep(0, 0.08, k) * (1 - smoothstep(0.6, 1, k));
        if (k >= 1) d.s.visible = false;
      }
    },
  };
  return L;
}
