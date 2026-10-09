/**
 * The Moria set: the Chamber of Mazarbul (Balin's tomb under its shaft of light, the well, the
 * barricaded door, skeletons), the antechamber and the great pillared hall of Dwarrowdelf (colossal
 * carved pillars, braziers, rubble and bones), the east gate and the corridor to the Bridge with the
 * Balrog's glow beyond. Geometry, colliders and fire only: no gameplay.
 */
import * as THREE from 'three';
import type { FxHandle, LevelAPI } from '../../../core/types';
import { Rng } from '../../../core/rng';
import {
  addColliders, banner, boulderField, brazier, chain, chamberOfMazarbul, crate, dwarvenHall, mat, plain,
  skeleton, stoneBlock, torch, weaponRack, type Built, type ColliderDesc,
} from '../../../world';
import { MeshKit } from '../../../world/util';
import { dustMotes, glowDisc, runeTexture, tickLook, volumeShaft, weatherStone } from './look';
import { CH, HALL, HALL_CX, HALL_D, HALL_HZ, HALL_W, HALL_X0, HALL_X1, L, PILLARS } from './layout';

export interface MoriaWorld {
  /** 0..1: how awake the Balrog's glow beyond the east corridor is */
  setBalrog(v: number): void;
  /** every fire emitter of the set (braziers, torches, the chasm fires) */
  fires: FxHandle[];
  /** stop the world's own per-frame callbacks (the shell frees everything else) */
  dispose(): void;
}

type Lit = Built & { flameAnchor: THREE.Object3D };

const _v = new THREE.Vector3();

/**
 * The Balrog's light: a tall curtain of fire seen far off, never its body. A noise-driven flame
 * gradient (dark red embers at the top, orange and a white-hot core at the bottom), additive.
 * `uI` is its strength (0 = out).
 */
function glowPlane(color: number, w: number, h: number, intensity: number): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uT: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; uniform vec3 uColor; uniform float uI; uniform float uT;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      void main(){
        float x = (vUv.x - 0.5) * 2.0;
        float y = vUv.y;
        float n = fbm(vec2(x * 3.2, y * 2.4 - uT * 0.35));
        float n2 = fbm(vec2(x * 7.0 + 3.1, y * 5.0 - uT * 0.8));
        float body = pow(clamp(1.0 - y, 0.0, 1.0), 1.8) * smoothstep(0.18, 0.85, n + 0.35 * n2) * 1.6;
        float side = 1.0 - smoothstep(0.35, 1.0, abs(x));
        float f = body * side;
        vec3 ember = vec3(0.42, 0.04, 0.01);
        vec3 fire = uColor;
        vec3 hot = vec3(1.0, 0.82, 0.4);
        vec3 c = mix(ember, fire, smoothstep(0.1, 0.55, f)) + hot * pow(f, 3.2) * 0.55;
        float a = f * uI;
        gl_FragColor = vec4(c * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function buildMoria(level: LevelAPI): MoriaWorld {
  const { physics, fx } = level.ctx;
  const rng = new Rng(0x6d6f72);
  const fires: FxHandle[] = [];
  const root = level.root;
  let chasmDepth: THREE.Mesh | null = null;
  const curtains: THREE.Mesh[] = [];

  // ── the Chamber of Mazarbul ─────────────────────────────────────────────
  const chamber = chamberOfMazarbul({ seed: 3 });
  root.add(chamber.object);
  addColliders(physics, chamber.colliders);

  // ── the antechamber and the great hall ──────────────────────────────────
  const hall = dwarvenHall({ cols: HALL.cols, rows: HALL.rows, spacing: HALL.spacing, height: HALL.height, size: HALL.size, seed: 2, walls: false });
  hall.object.position.set(HALL_CX, 0, 0);
  root.add(hall.object);
  addColliders(physics, hall.colliders, hall.object);
  // swap the 28 separate pillar objects for instanced meshes (identical carved pillars, a few draw calls)
  swapPillarsForInstances(hall.object);

  const stone = mat('dwarven_stone', { key: 'moriaFloor' });
  const wallM = mat('dwarven_stone', { key: 'moriaWall', rgb: [0.9, 0.9, 0.95] });
  const trimM = mat('dwarven_stone', { key: 'moriaTrim', rgb: [1.25, 1.25, 1.3] });
  const cols: ColliderDesc[] = [];
  const kit = new MeshKit();
  const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material = wallM, collide = true) => {
    kit.box(m, [x1 - x0, y1 - y0, z1 - z0], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0, { tile: 3 });
    if (collide) cols.push({ kind: 'box', center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], opts: { material: 'stone', tag: 'wall' } });
  };
  const floor = (x0: number, x1: number, z0: number, z1: number) => {
    kit.box(stone, [x1 - x0, 2, z1 - z0], [(x0 + x1) / 2, -1, (z0 + z1) / 2], 0, { tile: 2 });
    cols.push({ kind: 'box', center: [(x0 + x1) / 2, -1, (z0 + z1) / 2], half: [(x1 - x0) / 2, 1, (z1 - z0) / 2], opts: { material: 'stone', tag: 'floor' } });
  };
  const WH = 28;
  // antechamber floor, between the chamber's arch and the hall proper
  floor(8, HALL_X0 + 0.6, -HALL_HZ, HALL_HZ);
  // north and south walls of the whole complex, and the hall's west wall beside the chamber
  wall(8, HALL_X1 + 2, 0, WH, -HALL_HZ - 2, -HALL_HZ);
  wall(8, HALL_X1 + 2, 0, WH, HALL_HZ, HALL_HZ + 2);
  wall(8, 9.4, 0, WH, -HALL_HZ, -9.4);
  wall(8, 9.4, 0, WH, 9.4, HALL_HZ);
  // rubble packed behind the barricaded west door, so the gap between the planks is solid dark rock
  wall(-10.4, -9.35, 0, 5.2, 0.8, 4.4, mat('rock', { key: 'moriaRubble', rgb: [0.42, 0.42, 0.46] }), false);
  // the east gate: a 10 m wide, 13 m high opening in the east wall
  const GW = 5;
  wall(HALL_X1, HALL_X1 + 2, 0, WH, -HALL_HZ, -GW);
  wall(HALL_X1, HALL_X1 + 2, 0, WH, GW, HALL_HZ);
  wall(HALL_X1, HALL_X1 + 2, 13, WH, -GW, GW);
  // gate jambs: carved trim blocks flanking the opening
  for (const s of [-1, 1]) {
    wall(HALL_X1 - 0.5, HALL_X1 + 2.5, 0, 14, s > 0 ? GW : -GW - 1.6, s > 0 ? GW + 1.6 : -GW, trimM, false);
  }
  wall(HALL_X1 - 0.5, HALL_X1 + 2.5, 12.6, 14.2, -GW - 1.6, GW + 1.6, trimM, false);
  // the corridor to the Bridge: floor, walls, ceiling; it ends at the chasm
  const CL = 24;
  floor(HALL_X1, HALL_X1 + CL, -GW, GW);
  wall(HALL_X1 + 2, HALL_X1 + CL, 0, 16, -GW - 2, -GW);
  wall(HALL_X1 + 2, HALL_X1 + CL, 0, 16, GW, GW + 2);
  wall(HALL_X1 + 2, HALL_X1 + CL, 16, 18, -GW - 2, GW + 2, wallM, false);
  // an invisible stop before the edge
  cols.push({ kind: 'box', center: [HALL_X1 + CL - 1, 3, 0], half: [0.6, 6, GW], opts: { material: 'stone', tag: 'chasm_stop', walkable: false } });
  // the chasm cavern: a roof and side walls continue the corridor past the lip. They cast shadows, so the
  // sun's volumetric shafts do not light the haze beyond the end (it would show as a flat grey-blue panel),
  // and a black far wall stands behind the Balrog's glow
  {
    const ex0 = HALL_X1 + CL;
    const far = 56;
    wall(ex0, ex0 + far, 44, 48, -22, 22, wallM, false);
    wall(ex0, ex0 + far, -34, 44, -22, -20, wallM, false);
    wall(ex0, ex0 + far, -34, 44, 20, 22, wallM, false);
    wall(ex0 + far - 1, ex0 + far, -34, 44, -22, 22, plain(0x040302, { roughness: 1, key: 'chasmFar' }), false);
  }
  // low carved parapet along the corridor sides (lit by the glow)
  const built = kit.build({ name: 'moria_shell' });
  root.add(built);
  addColliders(physics, cols);

  // ── the ledge along the chamber's south wall (the archers' perch) ────────
  {
    const k = new MeshKit();
    const lm = mat('dwarven_stone', { key: 'chamber', rgb: [1.1, 1.1, 1.15] });
    const [x0, x1] = L.ledgeX;
    const cx = (x0 + x1) / 2;
    const w = x1 - x0;
    k.box(lm, [w, 0.34, 1.5], [cx, L.ledgeY - 0.17, L.ledgeZ], 0, { tile: 1.6 });
    k.box(trimM, [w + 0.2, 0.18, 0.3], [cx, L.ledgeY - 0.43, L.ledgeZ - 0.62], 0, { tile: 1.2 });
    for (let x = x0 + 0.6; x < x1; x += 2.2) {
      k.box(lm, [0.5, 0.9, 0.9], [x, L.ledgeY - 0.75, L.ledgeZ + 0.3], 0, { tile: 1.2 });
      k.box(lm, [0.34, 0.5, 0.5], [x, L.ledgeY - 1.45, L.ledgeZ + 0.5], 0, { tile: 1.0 });
    }
    // a broken balustrade
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.7) {
      if (rng.float() < 0.35) continue;
      k.box(lm, [0.2, 0.55 + rng.float() * 0.2, 0.2], [x, L.ledgeY + 0.3, L.ledgeZ - 0.62], 0, { tile: 1.0 });
    }
    root.add(k.build({ name: 'chamber_ledge' }));
    // walkable but not solid: goblins climb up through it, archers stand on it
    physics.addBox(new THREE.Vector3(cx, L.ledgeY - 0.17, L.ledgeZ), [w / 2, 0.17, 0.75], 0, { material: 'stone', solid: false, tag: 'ledge' });
  }

  // ── the hole in the chamber ceiling (goblins drop through it) ────────────
  {
    const holeM = new THREE.MeshBasicMaterial({ color: 0x03050a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.35, 14), holeM);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(L.ceilingHole.x, 8.97, L.ceilingHole.z - 0.9);
    hole.scale.set(1, 1.15, 1);
    root.add(hole);
    // a faint cold light falls through it: the hole reads as an opening to the dark above
    const hs = volumeShaft(8.5, 1.0, 2.5, 0x9db6e0, 0.34);
    hs.position.set(L.ceilingHole.x, 8.95, L.ceilingHole.z - 0.9);
    root.add(hs);
    // the opening itself is a faint pale glow in the dark, not a flat disc
    const hg = glowDisc(2.0, 0x7f93b8, 0.32, 'down');
    hg.position.set(L.ceilingHole.x, 8.93, L.ceilingHole.z - 0.9);
    root.add(hg);
    const k = new MeshKit();
    const rm = mat('dwarven_stone', { key: 'rubbleHole', rgb: [0.75, 0.75, 0.8] });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rng.float() * 0.3;
      const r = 1.35 + rng.float() * 0.25;
      k.box(rm, [0.35 + rng.float() * 0.3, 0.3 + rng.float() * 0.5, 0.3 + rng.float() * 0.3], [L.ceilingHole.x + Math.cos(a) * r, 8.75 - rng.float() * 0.2, L.ceilingHole.z - 0.9 + Math.sin(a) * r * 1.15], rng.float() * 3, { tile: 1 }, [rng.float() * 0.6, rng.float() * 0.6]);
    }
    root.add(k.build({ name: 'ceiling_hole_rubble' }));
  }

  // ── placing helpers ─────────────────────────────────────────────────────
  const place = <T extends Built>(b: T, x: number, y: number, z: number, yaw = 0): T => {
    b.object.position.set(x, y, z);
    b.object.rotation.y = yaw;
    root.add(b.object);
    addColliders(physics, b.colliders, b.object);
    return b;
  };
  const lightFlame = (b: Lit, scale: number): FxHandle => {
    b.object.updateMatrixWorld(true);
    const h = fx.fire(b.flameAnchor.getWorldPosition(new THREE.Vector3()), scale);
    fires.push(h);
    return h;
  };
  /**
   * `lit` torches carry a fire emitter (a point light from the pool, flame sprites and a smoke plume);
   * the rest burn as the builder's animated flame mesh alone: no smoke cotton, and nothing is lost in the
   * dark far from the player, where the pool lights would not be assigned anyway.
   */
  const wallTorch = (x: number, y: number, z: number, yaw: number, scale = 0.5, lit = false) => {
    const t = torch({ lit: true, wall: true, length: 0.9 }) as Lit;
    place(t, x, y, z, yaw);
    t.object.updateMatrixWorld(true);
    // the flame anchor of a wall torch is already positioned out from the wall by the builder
    if (lit) lightFlame(t, scale);
  };
  const stand = (x: number, z: number, scale: number, fire: number) => {
    const b = brazier({ lit: true, scale }) as Lit;
    place(b, x, 0, z, rng.float() * 6);
    b.object.updateMatrixWorld(true);
    lightFlame(b, fire);
  };

  // ── chamber dressing ────────────────────────────────────────────────────
  // wall torches: north wall flanking the window, west and east walls, south wall under the ledge
  wallTorch(-4.6, 2.5, -7.92, 0, 0.55);
  wallTorch(4.6, 2.5, -7.92, 0, 0.55);
  wallTorch(-7.92, 2.5, -3.6, Math.PI / 2, 0.5);
  wallTorch(-7.92, 2.5, 6.2, Math.PI / 2, 0.45);
  wallTorch(7.92, 2.5, 4.2, -Math.PI / 2, 0.5);
  wallTorch(7.92, 2.5, -4.2, -Math.PI / 2, 0.5);
  wallTorch(-3.8, 2.4, 7.92, Math.PI, 0.5);
  // braziers either side of the tomb dais
  stand(-3.9, -6.0, 1.0, 0.9);
  stand(3.9, -6.0, 1.0, 0.9);
  // the dwarves' last stand: crates, barrels of arrows, racks by the door
  place(crate([1.1, 0.8, 0.8], { seed: 4 }), -6.4, 0, -1.6, 0.3);
  place(crate(0.8, { seed: 5 }), -6.5, 0, 6.4, 0.9);
  place(crate([0.9, 0.7, 0.9], { seed: 6 }), -5.5, 0.0, 6.9, 0.2);
  place(weaponRack({ width: 2.0, seed: 3 }), 5.6, 0, 7.2, Math.PI);
  // a toppled skeleton that fell in the well, more by the arch
  for (const [x, z, pose, yaw] of [[6.2, -6.6, 'sprawled', 0.8], [-2.2, 4.6, 'lying', 2.1], [5.4, 5.0, 'sitting', 3.4]] as [number, number, 'sprawled' | 'lying' | 'sitting', number][]) {
    place(skeleton(pose, (x * 3 + z) | 0, 0.85), x, 0, z, yaw);
  }
  // banners of Durin's folk, tattered, on the long walls
  place(banner(0x2a3f66, 'hammer', { height: 4.2, clothW: 1.4, clothH: 2.8 }), -7.2, 0, -5.8, Math.PI / 2);
  place(banner(0x2a3f66, 'hammer', { height: 4.2, clothW: 1.4, clothH: 2.8 }), 7.2, 0, 6.0, -Math.PI / 2 + Math.PI);

  // ── antechamber and hall dressing ───────────────────────────────────────
  // braziers flanking the arch on the hall side and down the central aisle
  stand(12.2, -5.2, 1.3, 1.1);
  stand(12.2, 5.2, 1.3, 1.1);
  for (const x of [33, 61, 89]) {
    stand(x, -8.6, 1.5, 1.2);
    stand(x, 8.6, 1.5, 1.2);
  }
  // great braziers at the east gate
  for (const s of [-1, 1]) {
    const b = brazier({ lit: true, scale: 3.0 }) as Lit;
    place(b, HALL_X1 - 3.4, 0, s * 8.5, 0);
    b.object.updateMatrixWorld(true);
    lightFlame(b, 2.2);
  }
  // wall torches along the hall's north and south walls, in the dark beyond the pillars
  for (let x = 24; x < HALL_X1 - 6; x += 22) {
    wallTorch(x, 3.4, -HALL_HZ + 0.1, 0, 0.7);
    wallTorch(x + 11, 3.4, HALL_HZ - 0.1, Math.PI, 0.7);
    // a second, brighter pair every other bay: these two carry the real fires
    if (((x - 24) / 22) % 2 === 0) wallTorch(x + 5.5, 3.4, -HALL_HZ + 0.1, 0, 0.8, true);
  }
  // banners hanging among the pillars
  for (const [x, z] of [[19, -12], [47, 13], [75, -14], [103, 12]] as [number, number][]) {
    place(banner(rng.float() < 0.5 ? 0x2a3f66 : 0x5a2a1a, 'hammer', { height: 5.4, clothW: 1.6, clothH: 3.4 }), x, 0, z, rng.float() * 6);
  }
  // fallen masonry and rubble outside the central aisle
  for (let i = 0; i < 7; i++) {
    const x = 20 + rng.float() * 92;
    const side = rng.float() < 0.5 ? -1 : 1;
    const z = side * (13 + rng.float() * 14);
    if (PILLARS.some((p) => Math.hypot(p.x - x, p.z - z) < 4.6)) continue;
    place(stoneBlock([2 + rng.float() * 2.4, 0.9 + rng.float() * 1.2, 1.6 + rng.float() * 1.6], i + 3, { kind: 'dark' }), x, 0, z, rng.float() * 6);
  }
  const rubble = boulderField({ center: new THREE.Vector3(HALL_CX, 0, 0), halfSize: [HALL_W / 2 - 4, HALL_D / 2 - 3] }, 46, [0.3, 1.1], () => 0, {
    seed: 11, kind: 'dark', clump: 0.7,
    exclude: (x, z) => Math.abs(z) < 7 || PILLARS.some((p) => Math.abs(p.x - x) < 3.6 && Math.abs(p.z - z) < 3.6) || x < 18 || x > HALL_X1 - 8,
  });
  root.add(rubble.object);
  addColliders(physics, rubble.colliders);
  // bones: dwarves who never made it out
  for (let i = 0; i < 9; i++) {
    const x = 18 + rng.float() * 98;
    const z = (rng.float() - 0.5) * 50;
    if (PILLARS.some((p) => Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3)) continue;
    const poses = ['lying', 'sprawled', 'slumped', 'sitting'] as const;
    place(skeleton(poses[i % 4], 20 + i, 0.85), x, 0, z, rng.float() * 6);
  }
  // heavy chains hanging out of the dark above the aisle, thick enough to read in the haze
  for (const [x, z, len] of [[40, -4.5, 15], [54, 4.5, 17], [68, -4, 14], [82, 4, 18], [96, -4.5, 13], [108, 4.5, 16]] as [number, number, number][]) {
    const c = chain(len, { link: 0.5, thick: 0.085 });
    c.object.position.set(x, HALL.height + 1, z);
    root.add(c.object);
  }
  // shafts of cold light through cracks in the roof, close enough to the aisle to be walked through
  const shaftSpots: [number, number][] = [[33, 6.5], [47, -6], [61, 6], [75, -6.5], [89, 6], [103, -6]];
  for (const [x, z] of shaftSpots) {
    const h = 26.5;
    const sh = volumeShaft(h, 1.3, 5.0, 0xb4cbf0, 0.5);
    sh.position.set(x, h, z);
    root.add(sh);
    const pool = glowDisc(4.4, 0xaec4e8, 0.34, 'up');
    pool.position.set(x, 0.05, z);
    root.add(pool);
    root.add(dustMotes(new THREE.Vector3(x, 0.5, z), 3.6, 11, 70, 0xdde8ff, 0.055));
  }
  // dust in the firelight along the aisle
  root.add(dustMotes(new THREE.Vector3(HALL_CX, 0.5, 0), 40, 7, 240, 0xd8c8a8, 0.045));

  // ── Balin's tomb: carved rune panel (the stock rune bars are dashes) and the lid's inscription ──
  {
    const k = new MeshKit();
    const pm = mat('marble', { key: 'tombPanel', rgb: [0.95, 0.93, 0.9] });
    // a proud panel over the front, a slab over the lid (covering the stock black dashes)
    k.box(pm, [3.02, 0.82, 0.05], [CH.tomb.x, 1.3, CH.tomb.z + 0.745], 0, { tile: 1.5 });
    k.box(pm, [3.0, 0.045, 1.32], [CH.tomb.x, 2.085, CH.tomb.z], 0, { tile: 1.5 });
    root.add(k.build({ name: 'tomb_panels' }));
    const frontTex = runeTexture(768, 192, 14, 3, 77);
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.7),
      new THREE.MeshStandardMaterial({ map: frontTex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    front.position.set(CH.tomb.x, 1.3, CH.tomb.z + 0.775);
    root.add(front);
    const lidTex = runeTexture(768, 288, 12, 4, 211);
    const lid = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.78),
      new THREE.MeshStandardMaterial({ map: lidTex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    lid.rotation.x = -Math.PI / 2;
    lid.position.set(CH.tomb.x - 0.45, 2.112, CH.tomb.z);
    root.add(lid);
    // the shaft's light lands on the lid
    const spot = glowDisc(1.9, 0xe6eeff, 0.34, 'up');
    spot.position.set(CH.tomb.x, 2.125, CH.tomb.z - 0.5);
    spot.scale.set(1.1, 1.0, 0.8);
    root.add(spot);
    // a stronger shaft than the builder's faint cone: same pose, dusty streaks
    chamber.shaft.visible = false;
    const sh = volumeShaft(8.8, 0.62, 2.2, 0xd4e4ff, 0.7);
    sh.position.copy(chamber.shaft.position);
    sh.rotation.copy(chamber.shaft.rotation);
    root.add(sh);
    root.add(dustMotes(new THREE.Vector3(0, 0.6, -4.6), 2.2, 7.4, 90, 0xeaf0ff, 0.05));
  }

  // ── chamber ceiling: coffering ribs and a cornice, so it is not a flat black slab ──
  {
    const k = new MeshKit();
    const cm = mat('dwarven_stone', { key: 'chamberRib', rgb: [1.0, 1.0, 1.05] });
    const y = 8.55;
    for (const x of [-5.3, -1.8, 1.8, 5.3]) k.box(cm, [0.7, 0.6, 16], [x, y, 0], 0, { tile: 1.5 });
    for (const z of [-5.3, -1.8, 1.8, 5.3]) k.box(cm, [16, 0.6, 0.7], [0, y + 0.02, z], 0, { tile: 1.5 });
    for (const s of [-1, 1]) {
      k.box(trimM, [16.2, 0.55, 0.45], [0, 8.7, s * 7.78], 0, { tile: 1.2 });
      k.box(trimM, [0.45, 0.55, 16.2], [s * 7.78, 8.7, 0], 0, { tile: 1.2 });
    }
    root.add(k.build({ name: 'chamber_ribs' }));
  }

  // ── the Balrog's glow beyond the corridor ───────────────────────────────
  const glowA = glowPlane(0xff3a08, 150, 60, 0);
  glowA.position.set(HALL_X1 + CL + 46, 18, 0);
  glowA.rotation.y = -Math.PI / 2;
  root.add(glowA);
  const glowB = glowPlane(0xff6a18, 60, 34, 0);
  glowB.position.set(HALL_X1 + CL + 24, 9, 0);
  glowB.rotation.y = -Math.PI / 2;
  root.add(glowB);
  // a roof over the great hall: black rock high above the pillars (otherwise the open top shows the sky colour as a lit panel)
  {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(HALL_X1 + 2 - 8, HALL_HZ * 2 + 4), new THREE.MeshBasicMaterial({ color: 0x030304 }));
    roof.rotation.x = Math.PI / 2;
    roof.position.set((HALL_X1 + 2 + 8) / 2, HALL.height + 1.2, 0);
    roof.castShadow = false;
    roof.userData.noAO = true;
    root.add(roof);
  }
  // the chasm itself: a broken stone lip, a wall of glowing depth below it, and tongues of flame
  {
    const k = new MeshKit();
    const lipM = mat('rock', { key: 'chasmLip', rgb: [0.45, 0.4, 0.38] });
    const ex = HALL_X1 + CL;
    for (let i = 0; i < 9; i++) {
      const z = -GW + 0.6 + i * ((GW * 2 - 1.2) / 8);
      const w = 0.9 + rng.float() * 1.1;
      const dx = rng.float() * 1.2;
      k.box(lipM, [w + 0.8, 0.55 + rng.float() * 0.5, 0.9 + rng.float() * 0.7], [ex - 0.6 + dx * 0.5, -0.2 - rng.float() * 0.2, z], rng.float() * 0.6, { tile: 1.2 }, [rng.float() * 0.25, rng.float() * 0.25]);
    }
    root.add(k.build({ name: 'chasm_lip' }));
    const depth = new THREE.Mesh(
      new THREE.PlaneGeometry(GW * 2 + 6, 40),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { uI: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec2 vUv; uniform float uI;
          void main(){
            float y = vUv.y;                                  // 1 at the lip, 0 far below
            float g = pow(y, 3.2);
            vec3 c = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.5, 0.12), pow(y, 6.0));
            float side = 1.0 - smoothstep(0.55, 1.0, abs(vUv.x - 0.5) * 2.0);
            float a = g * side * uI;
            gl_FragColor = vec4(c * a, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    depth.rotation.y = -Math.PI / 2;
    depth.position.set(ex + 0.3, -20, 0);
    depth.userData.noAO = true;
    depth.renderOrder = 3;
    depth.frustumCulled = false;
    root.add(depth);
    chasmDepth = depth;
    // curtains of fire rising out of the dark (the same noisy flame shader as the far glow, closer and lower)
    for (const [dx, w, h, dz, col] of [[3.5, 12, 18, -3, 0xff4a0a], [6.5, 10, 22, 4, 0xff6a14], [10, 15, 16, 0, 0xff3a06], [13.5, 9, 20, -5, 0xff7a1c], [8, 8, 14, 6, 0xff5a10]] as [number, number, number, number, number][]) {
      const c = glowPlane(col, w, h, 0);
      c.position.set(ex + dx, -7 + h / 2, dz);
      c.rotation.y = -Math.PI / 2;
      root.add(c);
      curtains.push(c);
    }
  }
  // distant fires in the chasm (their point lights tint the corridor red when they are the nearest)
  const chasmFires: FxHandle[] = [];
  for (const [dx, y, z, s] of [[8, -1, -5, 1.8], [12, -2, 5, 2.2], [18, -2, 0, 2.6]] as [number, number, number, number][]) {
    const f = fx.fire(new THREE.Vector3(HALL_X1 + CL + dx, y, z), s);
    f.setIntensity(0);
    chasmFires.push(f);
    fires.push(f);
  }
  let balrog = 0;
  let t = 0;
  const stopTick = level.onUpdate((dt) => {
    t += dt;
    tickLook(dt);
    (glowA.material as THREE.ShaderMaterial).uniforms.uT.value = t;
    (glowB.material as THREE.ShaderMaterial).uniforms.uT.value = t;
    for (const c of curtains) (c.material as THREE.ShaderMaterial).uniforms.uT.value = t;
  });
  const setBalrog = (v: number) => {
    balrog = v;
    (glowA.material as THREE.ShaderMaterial).uniforms.uI.value = 0.08 + v * 0.3;
    (glowB.material as THREE.ShaderMaterial).uniforms.uI.value = 0.03 + v * 0.26;
    for (const f of chasmFires) f.setIntensity(v * 1.1);
    if (chasmDepth) (chasmDepth.material as THREE.ShaderMaterial).uniforms.uI.value = 0.25 + v * 0.9;
    for (const c of curtains) (c.material as THREE.ShaderMaterial).uniforms.uI.value = v < 0.02 ? 0 : 0.18 + v * 0.55;
  };
  setBalrog(0);
  // finally: re-grade every dwarven stone material of the set (walls, floors, pillars, ledge, ribs)
  if (level.ctx.flags.noweather !== '1') weatherStone([root]);
  void balrog;
  void _v;

  return {
    setBalrog,
    fires,
    dispose() {
      stopTick();
    },
  };
}

/** replace the hall's per-pillar groups by instanced meshes (all dwarven pillars are identical) */
function swapPillarsForInstances(hallObject: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  hallObject.traverse((o) => {
    if (o.name === 'pillar_dwarven') groups.push(o);
  });
  if (!groups.length) return;
  const proto = groups[0];
  const centers = groups.map((g) => g.position.clone());
  const m = new THREE.Matrix4();
  const inst: THREE.InstancedMesh[] = [];
  proto.updateMatrixWorld(true);
  proto.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, centers.length);
    centers.forEach((c, i) => im.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = mesh.castShadow;
    im.receiveShadow = mesh.receiveShadow;
    im.frustumCulled = false;
    im.name = 'pillars:' + mesh.name;
    inst.push(im);
  });
  for (const g of groups) g.removeFromParent();
  for (const im of inst) hallObject.add(im);
}
