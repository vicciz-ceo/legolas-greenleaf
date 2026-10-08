/** Moria: colossal carved pillars, the Dwarrowdelf hall, and the Chamber of Mazarbul with Balin's tomb. */
import * as THREE from 'three';
import { Rng, hashSeed } from '../core/rng';
import { mat, plain } from './mats';
import { limbGeo, xf } from './geom';
import { MeshKit } from './util';
import type { Built, ColliderDesc } from './colliders';
import { stoneMat, wallWithOpenings, type Opening, type V3 } from './arch_common';
import { skeleton, well } from './props';

/** soft additive light shaft (cone). Origin at the top centre, pointing down -y. */
export function lightShaft(height = 8, topRadius = 0.5, bottomRadius = 2.4, color = 0xcfe0ff, intensity = 0.22): THREE.Mesh {
  const g = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 24, 1, true);
  g.translate(0, -height / 2, 0);
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uI;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fade = smoothstep(0.0, 0.12, 1.0 - vUv.y) * (1.0 - smoothstep(0.55, 1.0, 1.0 - vUv.y));
        float a = edge * (0.35 + 0.65 * (1.0 - vUv.y)) * uI;
        gl_FragColor = vec4(uColor * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.noAO = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.name = 'light_shaft';
  return mesh;
}

export type PillarKind = 'dwarven' | 'round' | 'ionic' | 'broken';

/**
 * Carved pillar. 'dwarven' = octagonal shaft with raised geometric reliefs, banded rings and a stepped
 * capital (colossal in the Dwarrowdelf). Origin at the base centre.
 */
export function pillar(kind: PillarKind = 'dwarven', height = 12, size = 2.4, o: { seed?: number; broken?: number } = {}): Built {
  const rng = new Rng(hashSeed('pillar', kind, o.seed ?? 1));
  const kit = new MeshKit();
  const colliders: ColliderDesc[] = [];
  const stone = kind === 'dwarven' ? stoneMat('dwarven') : kind === 'round' ? stoneMat('light') : stoneMat('marble');
  const trim = kind === 'dwarven' ? mat('dwarven_stone', { key: 'trim', rgb: [1.35, 1.35, 1.4] }) : stoneMat('light');
  const h = kind === 'broken' ? height * (o.broken ?? 0.45) : height;
  if (kind === 'dwarven') {
    // plinth
    kit.box(stone, [size * 1.55, 0.6, size * 1.55], [0, 0.3, 0], 0, { tile: 2 });
    kit.box(trim, [size * 1.35, 0.5, size * 1.35], [0, 0.85, 0], 0, { tile: 2 });
    kit.box(stone, [size * 1.2, 0.4, size * 1.2], [0, 1.3, 0], 0, { tile: 2 });
    // octagonal shaft
    const c = size * 0.2;
    const shape = new THREE.Shape();
    const hs = size / 2;
    shape.moveTo(-hs + c, -hs);
    shape.lineTo(hs - c, -hs);
    shape.lineTo(hs, -hs + c);
    shape.lineTo(hs, hs - c);
    shape.lineTo(hs - c, hs);
    shape.lineTo(-hs + c, hs);
    shape.lineTo(-hs, hs - c);
    shape.lineTo(-hs, -hs + c);
    shape.closePath();
    const shaft = new THREE.ExtrudeGeometry(shape, { depth: h - 3.0, bevelEnabled: false });
    shaft.rotateX(-Math.PI / 2);
    shaft.translate(0, 1.5, 0);
    shaft.deleteAttribute('uv');
    shaft.computeVertexNormals();
    kit.add(stone, shaft, null, { tile: 2.2 });
    // reliefs on the four broad faces: raised vertical strip with diamonds, and inset panels
    const bands = Math.max(2, Math.round(h / 4.5));
    for (let f = 0; f < 4; f++) {
      const yaw = (f * Math.PI) / 2;
      const nx = Math.sin(yaw);
      const nz = Math.cos(yaw);
      const off = size / 2 + 0.05;
      kit.box(trim, [size * 0.36, h - 5.0, 0.16], [nx * off, 1.5 + (h - 3.0) / 2, nz * off], yaw, { tile: 1.5 });
      for (let b = 0; b < bands * 2; b++) {
        const y = 2.4 + ((b + 0.5) / (bands * 2)) * (h - 5.0);
        // diamond: a box rotated 45 degrees about the face normal
        kit.box(stone, [size * 0.22, size * 0.22, 0.2], [nx * (off + 0.08), y, nz * (off + 0.08)], yaw, { tile: 1.0 }, [0, Math.PI / 4]);
        kit.box(plain(0x08080a, { roughness: 1, key: 'inset' }), [size * 0.1, size * 0.1, 0.22], [nx * (off + 0.1), y, nz * (off + 0.1)], yaw, undefined, [0, Math.PI / 4]);
      }
    }
    // banded rings
    for (let b = 1; b <= bands; b++) {
      const y = 1.5 + (b / (bands + 1)) * (h - 3.0);
      kit.box(trim, [size * 1.12, 0.5, size * 1.12], [0, y, 0], 0, { tile: 1.5 });
      kit.box(stone, [size * 1.04, 0.3, size * 1.04], [0, y + 0.35, 0], Math.PI / 4, { tile: 1.5 });
    }
    // capital: stepped inverted pyramid
    if (kind === 'dwarven' && h >= height * 0.99) {
      for (let i = 0; i < 4; i++) {
        const s = size * (1.15 + i * 0.28);
        kit.box(i % 2 ? trim : stone, [s, 0.55, s], [0, h - 2.2 + i * 0.55, 0], 0, { tile: 2 });
      }
    }
    colliders.push({ kind: 'box', center: [0, h / 2, 0], half: [size * 0.55, h / 2, size * 0.55], opts: { material: 'stone', walkable: false, tag: 'pillar' } });
  } else {
    // simple round / marble column: fluted shaft, base and capital
    const r = size / 2;
    kit.add(stone, new THREE.CylinderGeometry(r * 1.35, r * 1.5, 0.5, 20), xf(0, 0.25, 0), { tile: 2 });
    kit.add(stone, new THREE.CylinderGeometry(r * 1.15, r * 1.3, 0.35, 20), xf(0, 0.68, 0), { tile: 2 });
    const flutes = 16;
    const shaft = new THREE.CylinderGeometry(r * 0.88, r, h - 1.6, flutes * 2, 6);
    const pos = shaft.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const k = 1 - 0.035 * (0.5 + 0.5 * Math.cos(a * flutes));
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    shaft.computeVertexNormals();
    shaft.translate(0, (h - 1.6) / 2 + 0.9, 0);
    shaft.deleteAttribute('uv');
    kit.add(stone, shaft, null, { tile: 2 });
    if (kind !== 'broken') {
      kit.add(stone, new THREE.CylinderGeometry(r * 1.3, r * 0.95, 0.4, 20), xf(0, h - 0.5, 0), { tile: 2 });
      kit.box(stone, [r * 3.0, 0.3, r * 3.0], [0, h - 0.15, 0], 0, { tile: 2 });
      if (kind === 'ionic') for (const s of [-1, 1]) kit.add(stone, new THREE.TorusGeometry(r * 0.35, r * 0.12, 6, 12), xf(s * r * 1.15, h - 0.65, 0, 0, 1, 1, 1, 0, 0));
    } else {
      // jagged break
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.float();
        kit.add(stone, new THREE.ConeGeometry(r * 0.5, 0.5 + rng.float() * 0.6, 4), xf(Math.cos(a) * r * 0.45, h + 0.1, Math.sin(a) * r * 0.45, a));
      }
    }
    colliders.push({ kind: 'cyl', x: 0, z: 0, r: r * 1.0, y0: 0, y1: h, opts: { material: 'stone', walkable: false, tag: 'pillar' } });
  }
  return { object: kit.build({ name: `pillar_${kind}` }), colliders };
}

export interface HallOpts {
  cols?: number;
  rows?: number;
  spacing?: number;
  height?: number;
  size?: number;
  /** ceiling slab (default true; Moria is a cave: the ceiling is lost in darkness) */
  ceiling?: boolean;
  /** perimeter wall with carved panels (default true) */
  walls?: boolean;
  seed?: number;
}

/** the great hall of Dwarrowdelf: a grid of colossal carved pillars on a paved floor. Floor top at y = 0, centred on the origin. */
export function dwarvenHall(o: HallOpts = {}): Built & { anchors: { pillars: V3[]; floor: { w: number; d: number } } } {
  const cols = o.cols ?? 5;
  const rows = o.rows ?? 6;
  const sp = o.spacing ?? 13;
  const h = o.height ?? 26;
  const size = o.size ?? 3.4;
  const W = (cols - 1) * sp + sp * 1.4;
  const D = (rows - 1) * sp + sp * 1.4;
  const rng = new Rng(hashSeed('hall', o.seed ?? 1));
  const root = new THREE.Group();
  root.name = 'dwarven_hall';
  const colliders: ColliderDesc[] = [];
  const fk = new MeshKit();
  const floor = stoneMat('dwarven');
  const inlay = mat('dwarven_stone', { key: 'inlay', rgb: [1.5, 1.5, 1.6] });
  fk.box(floor, [W, 2, D], [0, -1, 0], 0, { tile: 2.0 });
  colliders.push({ kind: 'box', center: [0, -1, 0], half: [W / 2, 1, D / 2], opts: { material: 'stone', tag: 'floor' } });
  // inlaid bands between pillar rows (aisles) to break up the floor
  for (let r = 0; r < rows; r++) fk.box(inlay, [W - 6, 0.04, 1.0], [0, 0.02, (r - (rows - 1) / 2) * sp + sp / 2], 0, { tile: 1.0 });
  for (let c = 0; c < cols; c++) fk.box(inlay, [1.0, 0.04, D - 6], [(c - (cols - 1) / 2) * sp + sp / 2, 0.025, 0], 0, { tile: 1.0 });
  root.add(fk.build({ name: 'hall_floor' }));
  const pillars: V3[] = [];
  const proto = pillar('dwarven', h, size, { seed: 1 });
  void proto;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * sp;
      const z = (r - (rows - 1) / 2) * sp;
      const p = pillar('dwarven', h, size, { seed: r * 7 + c });
      p.object.position.set(x, 0, z);
      root.add(p.object);
      for (const cd of p.colliders) if (cd.kind === 'box') colliders.push({ ...cd, center: [cd.center[0] + x, cd.center[1], cd.center[2] + z] });
      pillars.push([x, 0, z]);
    }
  }
  const wk = new MeshKit();
  if (o.ceiling !== false) wk.box(mat('dwarven_stone', { key: 'ceiling', rgb: [0.5, 0.5, 0.55] }), [W + 6, 3, D + 6], [0, h + 1.5, 0], 0, { tile: 4 });
  if (o.walls !== false) {
    const wall = mat('dwarven_stone', { key: 'wall', rgb: [0.85, 0.85, 0.9] });
    wk.box(wall, [W + 4, h + 4, 2], [0, h / 2, -D / 2 - 1], 0, { tile: 3 });
    wk.box(wall, [W + 4, h + 4, 2], [0, h / 2, D / 2 + 1], 0, { tile: 3 });
    wk.box(wall, [2, h + 4, D + 4], [-W / 2 - 1, h / 2, 0], 0, { tile: 3 });
    wk.box(wall, [2, h + 4, D + 4], [W / 2 + 1, h / 2, 0], 0, { tile: 3 });
    colliders.push({ kind: 'box', center: [0, h / 2, -D / 2 - 1], half: [W / 2 + 2, h / 2 + 2, 1], opts: { material: 'stone', tag: 'wall' } });
    colliders.push({ kind: 'box', center: [0, h / 2, D / 2 + 1], half: [W / 2 + 2, h / 2 + 2, 1], opts: { material: 'stone', tag: 'wall' } });
    colliders.push({ kind: 'box', center: [-W / 2 - 1, h / 2, 0], half: [1, h / 2 + 2, D / 2 + 2], opts: { material: 'stone', tag: 'wall' } });
    colliders.push({ kind: 'box', center: [W / 2 + 1, h / 2, 0], half: [1, h / 2 + 2, D / 2 + 2], opts: { material: 'stone', tag: 'wall' } });
  }
  root.add(wk.build({ name: 'hall_shell' }));
  void rng;
  return { object: root, colliders, anchors: { pillars, floor: { w: W, d: D } } };
}

export interface ChamberResult extends Built {
  anchors: {
    tomb: V3;
    well: V3;
    window: V3;
    westDoor: V3;
    eastDoor: V3;
    /** where goblins can crawl in / spawn: door centres and the ceiling hole */
    spawns: V3[];
  };
  shaft: THREE.Mesh;
}

/**
 * The Chamber of Mazarbul: a 16 x 16 m carved hall, 9 m high. Balin's tomb in the centre under the
 * shaft of light from a high window, the well in a corner, a barricaded west door, an open east arch,
 * skeletons and scattered armour. Floor top at y = 0, centred on the origin.
 */
export function chamberOfMazarbul(o: { seed?: number } = {}): ChamberResult {
  const rng = new Rng(hashSeed('mazarbul', o.seed ?? 1));
  const S = 16;
  const H = 9;
  const root = new THREE.Group();
  root.name = 'chamber_of_mazarbul';
  const colliders: ColliderDesc[] = [];
  const kit = new MeshKit();
  const stone = mat('dwarven_stone', { key: 'chamber' });
  const wallStone = mat('dwarven_stone', { key: 'chamberWall', rgb: [0.9, 0.9, 0.95] });
  const marble = stoneMat('marble');
  const dark = plain(0x08090b, { roughness: 1, key: 'inset' });
  const wood = mat('old_wood', { key: 'chamber' });
  const iron = mat('metal_dark', { key: 'chamber' });
  const rusty = mat('metal_dark', { key: 'rustyArmor', rgb: [1.0, 0.8, 0.65] });

  // floor with an inlaid square pattern and a border
  kit.box(stone, [S + 3, 2, S + 3], [0, -1, 0], 0, { tile: 2 });
  colliders.push({ kind: 'box', center: [0, -1, 0], half: [(S + 3) / 2, 1, (S + 3) / 2], opts: { material: 'stone', tag: 'floor' } });
  const inlay = mat('dwarven_stone', { key: 'inlay', rgb: [1.5, 1.5, 1.6] });
  for (const k of [6.5, 4.2]) {
    for (const s of [-1, 1]) {
      kit.box(inlay, [k * 2, 0.03, 0.22], [0, 0.015, s * k], 0, { tile: 1.0 });
      kit.box(inlay, [0.22, 0.03, k * 2], [s * k, 0.015, 0], 0, { tile: 1.0 });
    }
  }
  // walls with openings: west door (z 1.5..4.8, 4.6 high), east arch, north window slit
  const t = 1.4;
  const wm = { opts: { material: 'stone' as const, tag: 'wall' } };
  const wallPieces = (len: number, openings: Opening[], place: { x: number; y: number; z: number; yaw: number }) =>
    colliders.push(...wallWithOpenings(kit, wallStone, len, H, t, openings, 3, place, wm));
  // north wall (z = -S/2) runs along +x
  wallPieces(S + t * 2, [{ x0: S / 2 + t - 0.55, x1: S / 2 + t + 0.55, y0: 5.6, y1: 8.2 }], { x: -S / 2 - t, y: 0, z: -S / 2 - t / 2, yaw: 0 });
  // south wall
  wallPieces(S + t * 2, [], { x: -S / 2 - t, y: 0, z: S / 2 + t / 2, yaw: 0 });
  // west wall (x = -S/2): runs along z (yaw -pi/2: local +x -> world +z)
  wallPieces(S, [{ x0: S / 2 + 1.0, x1: S / 2 + 4.2, y0: 0, y1: 4.8 }], { x: -S / 2 - t / 2, y: 0, z: -S / 2, yaw: -Math.PI / 2 });
  // east wall: wide archway toward the pillared hall
  wallPieces(S, [{ x0: S / 2 - 2.2, x1: S / 2 + 2.2, y0: 0, y1: 6.0 }], { x: S / 2 + t / 2, y: 0, z: -S / 2, yaw: -Math.PI / 2 });
  // ceiling slab with a hole above the window? the room is closed: slab at y = H
  kit.box(wallStone, [S + 6, 2.5, S + 6], [0, H + 1.25, 0], 0, { tile: 4 });
  // carved pilasters along the walls (reliefs)
  const doorC = 1.0 + 1.6;
  const pil = mat('dwarven_stone', { key: 'pilaster', rgb: [1.1, 1.1, 1.15] });
  for (let i = 0; i < 4; i++) {
    const p = -S / 2 + 2 + i * ((S - 4) / 3);
    for (const [px, pz, yaw] of [[p, -S / 2 + 0.1, 0], [p, S / 2 - 0.1, 0], [-S / 2 + 0.1, p, Math.PI / 2], [S / 2 - 0.1, p, Math.PI / 2]] as [number, number, number][]) {
      if ((px === -S / 2 + 0.1 && Math.abs(p - doorC) < 2.4) || (px === S / 2 - 0.1 && Math.abs(p) < 2.8)) continue;
      kit.box(pil, [1.0, H - 0.5, 0.7], [px, (H - 0.5) / 2, pz], yaw, { tile: 1.5 });
      kit.box(pil, [1.4, 0.6, 0.9], [px, H - 0.8, pz], yaw, { tile: 1.5 });
      kit.box(pil, [1.3, 0.8, 0.9], [px, 0.4, pz], yaw, { tile: 1.5 });
      for (let k = 0; k < 4; k++) kit.box(dark, [0.28, 0.28, 0.1], [px, 1.8 + k * 1.6, pz], yaw, undefined, [0, Math.PI / 4]);
    }
  }
  // window slit frame
  kit.box(stoneMat('light'), [1.5, 0.3, 1.6], [0, 5.5, -S / 2 - 0.1], 0, { tile: 1.5 });
  // Balin's tomb: stepped dais, sarcophagus, inscription
  const tx = 0;
  const tz = -3.0;
  kit.box(marble, [6.4, 0.22, 4.4], [tx, 0.11, tz], 0, { tile: 2 });
  kit.box(marble, [5.6, 0.22, 3.6], [tx, 0.33, tz], 0, { tile: 2 });
  kit.box(marble, [4.8, 0.22, 2.8], [tx, 0.55, tz], 0, { tile: 2 });
  kit.box(marble, [3.0, 1.0, 1.4], [tx, 1.16, tz], 0, { tile: 1.5 });
  kit.box(marble, [3.4, 0.28, 1.7], [tx, 1.8, tz], 0, { tile: 1.5 });
  kit.box(stoneMat('white'), [3.0, 0.1, 1.3], [tx, 2.0, tz], 0, { tile: 1.5 });
  for (let i = 0; i < 9; i++) kit.box(dark, [0.12 + (i % 3) * 0.1, 0.02, 0.42], [tx - 1.1 + i * 0.28, 2.06, tz + (i % 2) * 0.08], 0, undefined);
  // rune lines on the front: rows of narrow bars of varying length
  for (let row = 0; row < 3; row++) {
    let x = tx - 1.3;
    while (x < tx + 1.25) {
      const len = 0.08 + rng.float() * 0.3;
      kit.box(dark, [len, 0.035, 0.04], [x + len / 2, 1.1 + row * 0.22, tz + 0.72], 0, undefined);
      x += len + 0.08 + rng.float() * 0.12;
    }
  }
  colliders.push({ kind: 'box', center: [tx, 0.33, tz], half: [3.2, 0.33, 2.2], opts: { material: 'stone', tag: 'tomb_dais' } });
  colliders.push({ kind: 'box', center: [tx, 1.4, tz], half: [1.7, 0.8, 0.85], opts: { material: 'stone', walkable: false, tag: 'tomb' } });
  // the open book on the lid
  kit.box(plain(0x4a3020, { roughness: 0.8, key: 'cover' }), [0.6, 0.04, 0.42], [tx + 0.6, 2.13, tz], 0.3, undefined);
  kit.box(plain(0xcdbf9a, { roughness: 0.9, key: 'page' }), [0.54, 0.05, 0.36], [tx + 0.6, 2.17, tz], 0.3, undefined);

  // barricaded west door: planks and dismantled leaves wedged in the opening
  const doorZ = 1.0 + 1.6;
  for (let i = 0; i < 8; i++) {
    const y = 0.4 + i * 0.52;
    kit.box(wood, [2.6 + rng.float() * 0.4, 0.2, 0.08], [-S / 2 + 0.55 + (rng.float() - 0.5) * 0.2, y, doorZ + (rng.float() - 0.5) * 0.4], Math.PI / 2 + (rng.float() - 0.5) * 0.25, { tile: 1.0 }, [0, (rng.float() - 0.5) * 0.4]);
  }
  for (const s of [-1, 1]) kit.box(wood, [1.4, 4.0, 0.1], [-S / 2 + 1.6, 1.9, doorZ + s * 1.1], Math.PI / 2 + s * 0.35, { tile: 1.2, swap: true }, [0.0, s * 0.18]);
  colliders.push({ kind: 'box', center: [-S / 2 + 0.6, 1.6, doorZ], half: [0.4, 1.6, 1.5], opts: { material: 'wood', tag: 'barricade' } });
  // axes wedged into the barricade
  for (let i = 0; i < 5; i++) {
    const y = 1.0 + rng.float() * 2.4;
    const z = doorZ + (rng.float() - 0.5) * 2.4;
    kit.add(wood, limbGeo([-S / 2 + 1.5, y - 0.2, z], [-S / 2 + 0.8, y, z], 0.025, 0.02, 5, 0.6));
    kit.box(iron, [0.04, 0.2, 0.26], [-S / 2 + 0.78, y, z], 0, { tile: 0.4 });
  }

  // well in the NE corner
  const w = well({ radius: 1.05, roof: false, water: true });
  w.object.position.set(5.4, 0, -5.4);
  root.add(w.object);
  for (const c of w.colliders) if (c.kind === 'box') colliders.push({ ...c, center: [c.center[0] + 5.4, c.center[1], c.center[2] - 5.4] });

  // skeletons: around the well, by the pillars and near the tomb
  const poses: ('lying' | 'sitting' | 'slumped' | 'sprawled')[] = ['sitting', 'lying', 'slumped', 'sprawled', 'sitting', 'lying', 'slumped', 'sitting', 'sprawled', 'lying'];
  const spots: [number, number, number][] = [[-5.8, -6.2, 0.6], [4.2, -3.6, 2.0], [6.0, -4.2, 4.0], [-5.6, 5.5, 0.3], [3.0, 5.4, 3.3], [-2.8, 1.5, 1.2], [7.0, 2.0, 1.6], [-6.4, 0.5, 1.5], [1.8, 3.6, 2.4], [-3.4, -1.0, 0.8]];
  spots.forEach(([x, z, yaw], i) => {
    const sk = skeleton(poses[i % poses.length], i + 3, 0.82);
    sk.object.position.set(x, 0, z);
    sk.object.rotation.y = yaw;
    root.add(sk.object);
  });
  // scattered armour: helmets, shields, blades
  for (let i = 0; i < 16; i++) {
    const x = (rng.float() - 0.5) * 12;
    const z = (rng.float() - 0.5) * 12;
    if (Math.hypot(x - tx, z - tz) < 3.0) continue;
    const k = i % 4;
    if (k === 0) kit.add(rusty, new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), xf(x, 0.0, z, rng.float() * 6, 1, 1, 1, rng.float() * 1.2, 0), { tile: 0.5 });
    else if (k === 1) kit.add(wood, new THREE.CylinderGeometry(0.38, 0.38, 0.05, 14), xf(x, 0.05, z, rng.float() * 6, 1, 1, 1, 0.1 + rng.float() * 0.3, 0.1), { tile: 0.8 });
    else if (k === 2) {
      kit.add(wood, limbGeo([x, 0.04, z], [x + 0.9, 0.05, z + 0.2], 0.025, 0.02, 5, 0.6));
      kit.box(iron, [0.22, 0.04, 0.2], [x + 0.9, 0.06, z + 0.2], 0.2, { tile: 0.4 });
    } else kit.box(iron, [0.9, 0.03, 0.08], [x, 0.03, z], rng.float() * 6, { tile: 0.4 });
  }
  // rubble
  for (let i = 0; i < 18; i++) {
    const x = (rng.float() - 0.5) * 14;
    const z = (rng.float() - 0.5) * 14;
    const s = 0.12 + rng.float() * 0.3;
    kit.box(stone, [s, s * 0.6, s * 0.8], [x, s * 0.3, z], rng.float() * 3, { tile: 1.0 });
  }
  root.add(kit.build({ name: 'chamber_shell' }));
  const shaft = lightShaft(8.6, 0.7, 2.6);
  shaft.position.set(0, 8.2, -S / 2 + 0.6);
  shaft.rotation.x = -0.52;
  root.add(shaft);
  return {
    object: root,
    colliders,
    shaft,
    anchors: {
      tomb: [tx, 2.0, tz],
      well: [5.4, 0, -5.4],
      window: [0, 6.9, -S / 2],
      westDoor: [-S / 2 + 1, 0, doorZ],
      eastDoor: [S / 2 + 1, 0, 0],
      spawns: [[-S / 2 + 1, 0, doorZ], [S / 2 + 2, 0, 0], [0, 8.5, 6]],
    },
  };
}
