/**
 * Capsule stand-in implementing the Humanoid interface, used only while the kit's
 * `createHumanoid` (src/creatures/humanoid.ts) is missing or fails. Real bone hierarchy
 * (all HumanoidBone names), simple procedural poses, sockets and weapon sticks, so hit
 * zones, attachments and gameplay can be exercised before the real characters land.
 */
import * as THREE from 'three';
import type { AnimInput, Humanoid, HumanoidBone, HumanoidKind, HumanoidSpec, SocketName, WeaponKind } from '../core/types';
import { clamp, damp, lerp } from '../core/math';

const KIND_INFO: Record<HumanoidKind, { h: number; w: number; color: number; skin: number }> = {
  legolas: { h: 1.85, w: 0.9, color: 0x55663a, skin: 0xe8cdb0 },
  tauriel: { h: 1.75, w: 0.85, color: 0x4b5d2e, skin: 0xe8cdb0 },
  elf: { h: 1.85, w: 0.9, color: 0x8a7a4a, skin: 0xe8cdb0 },
  thranduil: { h: 1.9, w: 0.9, color: 0x7a6f5a, skin: 0xe8cdb0 },
  aragorn: { h: 1.88, w: 1, color: 0x4a3f33, skin: 0xd8b494 },
  man: { h: 1.78, w: 1, color: 0x6a5a48, skin: 0xd8b494 },
  rohirrim: { h: 1.8, w: 1.05, color: 0x5a5040, skin: 0xd8b494 },
  gondor: { h: 1.8, w: 1.05, color: 0x2e3238, skin: 0xd8b494 },
  gimli: { h: 1.37, w: 1.45, color: 0x6a3a28, skin: 0xd8a080 },
  dwarf: { h: 1.37, w: 1.4, color: 0x5a4a3a, skin: 0xd8a080 },
  orc: { h: 1.7, w: 1.05, color: 0x3a3428, skin: 0x7a7a5a },
  goblin: { h: 1.45, w: 0.85, color: 0x3a3028, skin: 0x8a8a70 },
  gundabad: { h: 1.95, w: 1.15, color: 0x2a2a2a, skin: 0xb0aca0 },
  uruk: { h: 2.0, w: 1.15, color: 0x1e1e1e, skin: 0x5a4a3a },
  berserker: { h: 2.05, w: 1.2, color: 0x2a1a14, skin: 0x5a4a3a },
  lurtz: { h: 2.1, w: 1.2, color: 0x1e1e1e, skin: 0x5a3a2a },
  bolg: { h: 2.6, w: 1.2, color: 0x3a3a38, skin: 0xc8c4b8 },
  easterling: { h: 1.8, w: 1, color: 0x6a5020, skin: 0xc09070 },
  haradrim: { h: 1.8, w: 1, color: 0x7a2020, skin: 0x8a6040 },
  troll: { h: 4.5, w: 1.5, color: 0x5a5448, skin: 0x7a7468 },
};

const DEFAULT_WEAPON: Partial<Record<HumanoidKind, [WeaponKind, WeaponKind]>> = {
  legolas: ['none', 'elven_bow'],
  tauriel: ['none', 'elven_bow'],
  elf: ['none', 'elven_bow'],
  aragorn: ['sword', 'none'],
  gimli: ['dwarf_axe', 'none'],
  dwarf: ['axe', 'none'],
  orc: ['scimitar', 'none'],
  goblin: ['scimitar', 'none'],
  uruk: ['sword', 'none'],
  troll: ['club', 'none'],
};

function stick(kind: WeaponKind, scale: number): THREE.Object3D | null {
  if (kind === 'none') return null;
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.35 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3e24, roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
  };
  switch (kind) {
    case 'elven_bow':
    case 'orc_bow':
    case 'uruk_bow': {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 6, 24, Math.PI * 0.7), wood);
      bow.rotation.z = Math.PI / 2 + Math.PI * 0.35 - Math.PI / 2;
      bow.rotation.y = Math.PI / 2;
      bow.position.z = -0.5;
      g.add(bow);
      break;
    }
    case 'pike':
    case 'spear':
      add(new THREE.CylinderGeometry(0.015, 0.015, kind === 'pike' ? 3 : 2, 6), wood, kind === 'pike' ? 1 : 0.6);
      break;
    case 'club':
    case 'mace':
    case 'warhammer':
      add(new THREE.CylinderGeometry(0.06, 0.03, 0.9, 6), wood, 0.4);
      break;
    case 'axe':
    case 'dwarf_axe':
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), wood, 0.3);
      add(new THREE.BoxGeometry(0.02, 0.18, 0.2), metal, 0.62);
      break;
    case 'elven_knives':
      add(new THREE.BoxGeometry(0.01, 0.4, 0.035), metal, 0.2);
      break;
    case 'shield':
      add(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 16).rotateX(Math.PI / 2), wood, 0);
      break;
    case 'torch':
      add(new THREE.CylinderGeometry(0.025, 0.02, 0.6, 6), wood, 0.25);
      break;
    default:
      add(new THREE.BoxGeometry(0.012, 0.8, 0.05), metal, 0.45);
  }
  g.scale.setScalar(scale);
  return g;
}

export function createStandinHumanoid(spec: HumanoidSpec): Humanoid {
  const info = KIND_INFO[spec.kind] ?? KIND_INFO.man;
  const H = info.h * (spec.scale ?? 1);
  const W = info.w;
  const root = new THREE.Group();
  root.name = `standin:${spec.kind}`;
  const cloth = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: info.skin, roughness: 0.6 });
  const mats = [cloth, skin];

  const bones = {} as Record<HumanoidBone, THREE.Bone>;
  const mk = (name: HumanoidBone, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x * H, y * H, z * H);
    parent.add(b);
    bones[name] = b;
    return b;
  };
  mk('root', root, 0, 0, 0);
  mk('hips', bones.root, 0, 0.53, 0);
  mk('spine', bones.hips, 0, 0.08, 0);
  mk('chest', bones.spine, 0, 0.12, 0);
  mk('neck', bones.chest, 0, 0.13, 0);
  mk('head', bones.neck, 0, 0.05, 0);
  for (const s of ['l', 'r'] as const) {
    const sx = s === 'l' ? 1 : -1; // +X is the character's left (facing +Z)
    mk(`shoulder_${s}`, bones.chest, sx * 0.05 * W, 0.1, 0);
    mk(`upperarm_${s}`, bones[`shoulder_${s}`], sx * 0.06 * W, 0, 0);
    mk(`forearm_${s}`, bones[`upperarm_${s}`], 0, -0.17, 0);
    mk(`hand_${s}`, bones[`forearm_${s}`], 0, -0.15, 0);
    mk(`thigh_${s}`, bones.hips, sx * 0.055 * W, -0.02, 0);
    mk(`shin_${s}`, bones[`thigh_${s}`], 0, -0.245, 0);
    mk(`foot_${s}`, bones[`shin_${s}`], 0, -0.24, 0);
  }

  const capsule = (from: THREE.Bone, to: THREE.Vector3, r: number, mat: THREE.Material) => {
    const len = to.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 0.5), 4, 10);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().normalize());
    m.castShadow = true;
    from.add(m);
    return m;
  };
  capsule(bones.hips, new THREE.Vector3(0, 0.2 * H, 0), 0.085 * H * W * 0.9, cloth);
  capsule(bones.chest, new THREE.Vector3(0, 0.12 * H, 0), 0.095 * H * W, cloth);
  capsule(bones.neck, new THREE.Vector3(0, 0.05 * H, 0), 0.03 * H, skin);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.065 * H, 16, 12), skin);
  head.position.y = 0.06 * H;
  head.scale.set(0.9, 1.1, 1);
  head.castShadow = true;
  bones.head.add(head);
  for (const s of ['l', 'r'] as const) {
    capsule(bones[`upperarm_${s}`], bones[`forearm_${s}`].position, 0.03 * H * W, cloth);
    capsule(bones[`forearm_${s}`], bones[`hand_${s}`].position, 0.026 * H * W, cloth);
    capsule(bones[`thigh_${s}`], bones[`shin_${s}`].position, 0.045 * H * W, cloth);
    capsule(bones[`shin_${s}`], bones[`foot_${s}`].position, 0.035 * H * W, cloth);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06 * H, 0.03 * H, 0.14 * H), skin);
    foot.position.set(0, -0.01 * H, 0.04 * H);
    foot.castShadow = true;
    bones[`foot_${s}`].add(foot);
  }

  const sockets: Record<SocketName, THREE.Object3D> = {
    hand_r: new THREE.Object3D(),
    hand_l: new THREE.Object3D(),
    back: new THREE.Object3D(),
    hip_l: new THREE.Object3D(),
    hip_r: new THREE.Object3D(),
    head: new THREE.Object3D(),
    chest: new THREE.Object3D(),
  };
  bones.hand_r.add(sockets.hand_r);
  bones.hand_l.add(sockets.hand_l);
  sockets.hand_r.position.y = -0.03 * H;
  sockets.hand_l.position.y = -0.03 * H;
  // weapons point along the hand's forward (+Z) once the grip turns; keep +Y = blade
  sockets.hand_r.rotation.x = Math.PI / 2;
  sockets.hand_l.rotation.x = Math.PI / 2;
  bones.chest.add(sockets.back, sockets.chest);
  sockets.back.position.set(0, 0.06 * H, -0.09 * H);
  sockets.chest.position.set(0, 0.04 * H, 0.09 * H);
  bones.hips.add(sockets.hip_l, sockets.hip_r);
  sockets.hip_l.position.set(0.1 * H, 0, 0);
  sockets.hip_r.position.set(-0.1 * H, 0, 0);
  bones.head.add(sockets.head);
  sockets.head.position.y = 0.12 * H;

  const held: Record<'hand_r' | 'hand_l', THREE.Object3D | null> = { hand_r: null, hand_l: null };
  const wScale = spec.kind === 'troll' ? 2.2 : H / 1.85;
  const setWeapon = (hand: 'hand_r' | 'hand_l', w: WeaponKind) => {
    const old = held[hand];
    if (old) {
      old.removeFromParent();
      old.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
    held[hand] = stick(w, wScale);
    if (held[hand]) sockets[hand].add(held[hand]!);
  };
  const def = DEFAULT_WEAPON[spec.kind] ?? ['none', 'none'];
  setWeapon('hand_r', spec.weapon ?? def[0]);
  setWeapon('hand_l', spec.offhand ?? def[1]);

  // ── animation state ───────────────────────────────────────────────────────
  let phase = 0;
  let flashT = 0;
  let flashColor = new THREE.Color(1, 1, 1);
  const emissive = new THREE.Color();
  let aimS = 0;

  function animate(dt: number, a: AnimInput) {
    const speed = a.speed;
    const stride = 0.55 + speed * 0.12;
    phase += (dt * speed) / Math.max(0.5, stride);
    const run = clamp(speed / 6, 0, 1.3);
    const sw = Math.sin(phase * Math.PI);
    const air = a.grounded ? 0 : 1;
    aimS = damp(aimS, a.aim ?? 0, 12, dt);
    const dead = a.dead ?? 0;

    // legs
    const legA = sw * 0.6 * run;
    bones.thigh_l.rotation.x = lerp(-legA, -0.9, air * 0.6);
    bones.thigh_r.rotation.x = lerp(legA, -0.3, air * 0.6);
    bones.shin_l.rotation.x = lerp(Math.max(0, -sw) * 1.1 * run, 1.3, air * 0.6);
    bones.shin_r.rotation.x = lerp(Math.max(0, sw) * 1.1 * run, 0.6, air * 0.6);
    bones.hips.position.y = 0.53 * H + Math.abs(sw) * 0.03 * H * run;
    bones.spine.rotation.x = 0.12 * run;
    bones.spine.rotation.y = 0;

    // arms: swing, overridden by aim / attack / specials
    let ulx = sw * 0.5 * run;
    let urx = -sw * 0.5 * run;
    let ulz = 0.12;
    let urz = -0.12;
    let flx = -0.3 * run;
    let frx = -0.3 * run;
    if (aimS > 0.01) {
      const pitch = a.aimPitch ?? 0;
      ulx = lerp(ulx, -Math.PI / 2 - pitch, aimS);
      ulz = lerp(ulz, -0.1, aimS);
      flx = lerp(flx, 0, aimS);
      const draw = a.draw ?? 0;
      urx = lerp(urx, -Math.PI / 2 - pitch, aimS);
      urz = lerp(urz, 0.3 + draw * 0.4, aimS);
      frx = lerp(frx, -1.6 * draw - 0.6, aimS);
      bones.spine.rotation.y = 0.5 * aimS;
    }
    if (a.attack) {
      const t = clamp(a.attack.t, 0, 1);
      const k = a.attack.kind;
      const wind = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      if (k === 'slam' || k === 'overhead') {
        urx = -2.8 * wind + (t > 0.4 ? -0.6 : 0);
        ulx = -2.4 * wind;
      } else if (k === 'sweep' || k === 'slash' || k === 'backslash' || k === 'knife1' || k === 'knife2' || k === 'knife3') {
        urx = -1.4;
        urz = t < 0.4 ? -1.2 * wind : 1.2 * (1 - wind);
        bones.spine.rotation.y = (t < 0.4 ? 0.6 * wind : -0.6 * (1 - wind)) * (k === 'backslash' ? -1 : 1);
      } else {
        urx = -1.6 * (t < 0.4 ? wind * 0.5 : 1 - wind * 0.5);
        frx = t < 0.4 ? -1.4 : 0;
      }
    }
    switch (a.special) {
      case 'climb':
      case 'hang': {
        const c = Math.sin((a.specialT ?? 0) * Math.PI * 2);
        ulx = -2.8 + c * 0.3;
        urx = -2.8 - c * 0.3;
        bones.thigh_l.rotation.x = -0.6 + c * 0.4;
        bones.thigh_r.rotation.x = -0.6 - c * 0.4;
        break;
      }
      case 'cheer':
      case 'roar':
        ulx = -2.6;
        urx = -2.6;
        ulz = 0.5;
        urz = -0.5;
        break;
      case 'stagger':
        bones.spine.rotation.x = -0.4;
        ulz = 0.8;
        urz = -0.8;
        break;
      case 'crouch':
      case 'surf':
      case 'barrel':
        bones.thigh_l.rotation.x = -1.0;
        bones.thigh_r.rotation.x = -1.0;
        bones.shin_l.rotation.x = 1.6;
        bones.shin_r.rotation.x = 1.6;
        bones.hips.position.y = 0.36 * H;
        break;
      default:
        break;
    }
    bones.upperarm_l.rotation.set(ulx, 0, ulz);
    bones.upperarm_r.rotation.set(urx, 0, urz);
    bones.forearm_l.rotation.x = flx;
    bones.forearm_r.rotation.x = frx;
    const hit = a.hit ?? 0;
    bones.chest.rotation.x = -hit * 0.35;
    // death: fall backwards (variant 1 = forwards)
    const fwd = (a.deathVariant ?? 0) % 2 === 1 ? 1 : -1;
    const fall = Math.min(1, dead * dead * 1.4);
    bones.root.rotation.x = fwd * fall * (Math.PI / 2 - 0.08);
    bones.root.position.y = fall * 0.12 * H;

    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      emissive.copy(flashColor).multiplyScalar(flashT / 0.15);
      for (const m of mats) m.emissive.copy(emissive);
    }
  }

  return {
    root,
    kind: spec.kind,
    height: H,
    bones,
    socket: (n) => sockets[n],
    setWeapon,
    weaponObject: (hand) => held[hand],
    animate,
    flash(color = 0xffffff) {
      flashColor = new THREE.Color(color).multiplyScalar(0.6);
      flashT = 0.15;
    },
    setCastShadow(v) {
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = v;
      });
    },
    setLod() {},
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of mats) m.dispose();
    },
  };
}
