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
  addColliders, banner, boulderField, brazier, chain, chamberOfMazarbul, crate, dwarvenHall, lightShaft, mat, plain,
  skeleton, stoneBlock, torch, weaponRack, type Built, type ColliderDesc,
} from '../../../world';
import { MeshKit } from '../../../world/util';
import { HALL, HALL_CX, HALL_D, HALL_HZ, HALL_W, HALL_X0, HALL_X1, L, PILLARS } from './layout';

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
    const holeM = new THREE.MeshBasicMaterial({ color: 0x1c2638, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.35, 14), holeM);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(L.ceilingHole.x, 8.97, L.ceilingHole.z - 0.9);
    hole.scale.set(1, 1.15, 1);
    root.add(hole);
    // a faint cold light falls through it: the hole reads as an opening to the dark above
    const hs = lightShaft(8.5, 1.1, 2.6, 0x9db6e0, 0.1);
    hs.position.set(L.ceilingHole.x, 8.95, L.ceilingHole.z - 0.9);
    root.add(hs);
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
  const wallTorch = (x: number, y: number, z: number, yaw: number, scale = 0.5) => {
    const t = torch({ lit: true, wall: true, length: 0.9 }) as Lit;
    place(t, x, y, z, yaw);
    t.object.updateMatrixWorld(true);
    // the flame anchor of a wall torch is already positioned out from the wall by the builder
    lightFlame(t, scale);
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
  // chains hanging out of the dark above the aisle
  for (const [x, z, len] of [[44, -3, 14], [72, 4, 18], [97, -5, 12]] as [number, number, number][]) {
    const c = chain(len, { link: 0.24, thick: 0.04 });
    c.object.position.set(x, HALL.height + 1, z);
    root.add(c.object);
  }
  // shafts of cold light through cracks in the roof
  for (const [x, z, h] of [[33, 11, 26.5], [54, -12, 26.5], [89, 10, 26.5]] as [number, number, number][]) {
    const s = lightShaft(h, 1.2, 5.2, 0xa9c2ea, 0.11);
    s.position.set(x, h, z);
    root.add(s);
  }

  // ── the Balrog's glow beyond the corridor ───────────────────────────────
  const glowA = glowPlane(0xff3a08, 150, 90, 0);
  glowA.position.set(HALL_X1 + CL + 46, 33, 0);
  glowA.rotation.y = -Math.PI / 2;
  root.add(glowA);
  const glowB = glowPlane(0xff6a18, 60, 34, 0);
  glowB.position.set(HALL_X1 + CL + 24, 9, 0);
  glowB.rotation.y = -Math.PI / 2;
  root.add(glowB);
  // distant fires in the chasm (their point lights tint the corridor red when they are the nearest)
  const chasmFires: FxHandle[] = [];
  for (const [dx, y, z, s] of [[10, -3, -6, 4.0], [14, -4, 7, 5.0], [22, -5, 0, 7.0], [7, -2, 2, 3.0]] as [number, number, number, number][]) {
    const f = fx.fire(new THREE.Vector3(HALL_X1 + CL + dx, y, z), s);
    f.setIntensity(0);
    chasmFires.push(f);
    fires.push(f);
  }
  let balrog = 0;
  let t = 0;
  const stopTick = level.onUpdate((dt) => {
    t += dt;
    (glowA.material as THREE.ShaderMaterial).uniforms.uT.value = t;
    (glowB.material as THREE.ShaderMaterial).uniforms.uT.value = t;
  });
  const setBalrog = (v: number) => {
    balrog = v;
    (glowA.material as THREE.ShaderMaterial).uniforms.uI.value = 0.08 + v * 0.3;
    (glowB.material as THREE.ShaderMaterial).uniforms.uI.value = 0.03 + v * 0.26;
    for (const f of chasmFires) f.setIntensity(0.3 + v * 0.9);
  };
  setBalrog(0);
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
