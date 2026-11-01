/**
 * Creature Lab — inspect code-built characters, creatures and props in isolation.
 *
 * Subjects are discovered automatically: any file under src/ named `*.lab.ts` that exports
 * `subjects: LabSubject[]` shows up here.
 *
 * URL params
 *   subject=<name>          subject to show (default: first)
 *   view=orbit|single|quad|turn|sheet
 *        orbit  interactive orbit camera + live animation (for humans)
 *        single one 3/4 view, static (for snapshots)
 *        quad   front / right / back / 3-4-high views of one subject, static
 *        turn   a turnaround strip laid out like the reference sheets (docs/refs/<name>/*_turnaround.jpg):
 *               FRONT, 3/4 FRONT, RIGHT PROFILE, BACK side by side at eye level. Use a wide size
 *               (e.g. --size 1536x1024) and bg=7f7f7f to match the sheets; yaws=0,-35,-90,180 (the default) overrides the angles
 *               ref=<docs/refs id> (or ppm=<px per metre>&base=<baseline px>) makes `turn` orthographic and
 *               calibrated to that sheet: same metres-per-pixel, feet on the sheet's baseline, each view's
 *               silhouette centred on the sheet's panel centre, labels under the figures. Snap it at
 *               --size 1536x1024 and compare with scripts/sheet-compare.py (silhouette IoU, widths, heights).
 *        sheet  contact sheet of every subject (or `subjects=a,b,c`, or `category=enemy`)
 *   anim=<name>&t=<sec>     pose the subject at time t of animation anim (static views)
 *   wire=1                  wireframe overlay
 *   bg=<hex>                background colour (default 1a1c1e)
 *   ground=0                hide the ground disc
 *   zoom=<k>                camera distance multiplier (default 1)
 *   focus=head|feet|center  frame a part of the subject (default whole body)
 *
 * Snapshot examples
 *   node scripts/snap.mjs "/lab/?subject=spider&view=quad&anim=walk&t=0.35" --out shots/spider-quad.png
 *   node scripts/snap.mjs "/lab/?view=sheet&category=enemy" --size 1600x1000 --out shots/enemies.png
 *
 * Test hooks: window.__snapReady, window.__lab = { subjects, pose(anim, t), render() }.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LabInstance, LabSubject } from '../src/core/types';

declare global {
  interface Window {
    __snapReady?: boolean;
    __snapError?: string;
    __lab?: unknown;
    scene?: THREE.Scene;
    __THREE_CAMERA__?: THREE.Camera;
    __renderer__?: THREE.WebGLRenderer;
  }
}

const params = new URLSearchParams(location.search);
const view = (params.get('view') ?? 'orbit') as 'orbit' | 'single' | 'quad' | 'turn' | 'sheet';
const animParam = params.get('anim');
const tParam = Number(params.get('t') ?? '0');
const zoom = Number(params.get('zoom') ?? '1');
const focusPart = params.get('focus') ?? 'body';
const bg = new THREE.Color('#' + (params.get('bg') ?? '1a1c1e'));

// ── discover subjects ───────────────────────────────────────────────────────
// Lazy glob + per-module try/catch: one broken *.lab.ts must not take down the whole lab.
const loaders = import.meta.glob<{ subjects?: LabSubject[] }>('/src/**/*.lab.ts');
const allSubjects: LabSubject[] = [];
const brokenModules: string[] = [];
async function discoverSubjects(): Promise<void> {
  await Promise.all(
    Object.entries(loaders).map(async ([path, load]) => {
      try {
        const mod = await load();
        for (const s of mod.subjects ?? []) {
          if (!s || typeof s.create !== 'function') {
            console.warn(`[lab] invalid subject in ${path}`);
            continue;
          }
          allSubjects.push(s);
        }
      } catch (e) {
        brokenModules.push(path);
        console.warn(`[lab] failed to load ${path}:`, e);
      }
    }),
  );
  allSubjects.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

// ── renderer & scene ────────────────────────────────────────────────────────
const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setScissorTest(false);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = bg;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
key.position.set(4, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 40;
key.shadow.camera.left = key.shadow.camera.bottom = -8;
key.shadow.camera.right = key.shadow.camera.top = 8;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xbcd4ff, 1.2);
rim.position.set(-5, 4, -6);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x3a3226, 0.35));

if (params.get('ground') !== '0') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4740';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30); // 1 grid cell = 1 m on a 240 m disc
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(120, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
}

/** 1.85 m reference pole (Legolas' height) with 0.5 m bands */
function makeReferencePole(): THREE.Object3D {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const h = i < 3 ? 0.5 : 0.35;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, h, 8),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe8e4d8 : 0xc0392b, roughness: 0.6 }),
    );
    m.position.y = i * 0.5 + h / 2;
    m.castShadow = true;
    g.add(m);
  }
  g.name = 'reference_pole_1.85m';
  return g;
}

// ── camera helpers ──────────────────────────────────────────────────────────
type Framing = { center: THREE.Vector3; radius: number; size: THREE.Vector3 };
function frameOf(obj: THREE.Object3D): Framing {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (focusPart === 'head') {
    center.y = box.max.y - size.y * 0.1;
    return { center, radius: Math.max(size.y * 0.16, 0.25), size };
  }
  if (focusPart === 'feet') {
    center.y = box.min.y + size.y * 0.1;
    return { center, radius: Math.max(size.y * 0.18, 0.3), size };
  }
  return { center, radius: Math.max(size.length() * 0.5, 0.3), size };
}

function placeCamera(cam: THREE.PerspectiveCamera, f: Framing, yawDeg: number, pitchDeg: number) {
  const dist = (f.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.05 * zoom;
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  cam.position.set(
    f.center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    f.center.y + Math.sin(pitch) * dist,
    f.center.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  cam.near = Math.max(0.01, dist / 200);
  cam.far = dist * 50 + 200;
  cam.lookAt(f.center);
  cam.updateProjectionMatrix();
}

const labels = document.getElementById('labels')!;
function label(text: string, x: number, y: number) {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.textContent = text;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  labels.appendChild(d);
}

// ── build ───────────────────────────────────────────────────────────────────
type Built = { subject: LabSubject; inst: LabInstance; holder: THREE.Group; ms: number; tris: number };
async function build(s: LabSubject): Promise<Built> {
  const t0 = performance.now();
  const inst = await s.create();
  const ms = performance.now() - t0;
  const holder = new THREE.Group();
  holder.name = `lab:${s.name}`;
  holder.add(inst.object);
  inst.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.castShadow === false && m.receiveShadow === false) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    }
  });
  let tris = 0;
  inst.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry as THREE.BufferGeometry;
      const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      tris += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
    }
  });
  return { subject: s, inst, holder, ms, tris };
}

function applyWire(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const wire = new THREE.Mesh(
      m.geometry,
      new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.25 }),
    );
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) return; // skinned wireframe needs skeleton binding; skip
    m.add(wire);
  });
}

// ── sheet-calibrated turnaround (view=turn&ref=<id>) ────────────────────────
/** The reference sheets are 1536×1024: four views whose silhouette boxes are centred on fixed panel
 *  centres, feet on a baseline, at a per-sheet scale (docs/refs/<id>/spec.json measured.turnaround). */
type SheetCalib = { ref: string | null; ppm: number; base: number; centres: number[]; heightM: number | null };
const SHEET_W = 1536;
const SHEET_CENTRES = [318, 661.5, 1004, 1347.5];

async function loadSheetCalibration(): Promise<SheetCalib | null> {
  const ref = params.get('ref');
  let ppm = Number(params.get('ppm') ?? 0);
  let base = Number(params.get('base') ?? 940);
  let centres = SHEET_CENTRES;
  let heightM: number | null = null;
  if (ref && !(ppm > 0)) {
    try {
      // dev tooling only: the Vite dev server serves the repo root, so the lab can read the sheet's calibration
      const res = await fetch(`/docs/refs/${encodeURIComponent(ref)}/spec.json`);
      const spec = await res.json();
      const m = spec?.measured?.turnaround;
      if (m && m.px_per_m > 0) {
        ppm = m.px_per_m;
        base = m.baseline_y_px ?? 940;
        heightM = m.overall_height_m ?? null;
        if (Array.isArray(m.views) && m.views.length === 4) {
          centres = m.views.map((v: { sheet_bbox_px: number[] }) => (v.sheet_bbox_px[0] + v.sheet_bbox_px[2]) / 2);
        }
      } else console.error(`[lab] docs/refs/${ref}/spec.json has no humanoid turnaround calibration`);
    } catch (e) {
      console.error(`[lab] could not read docs/refs/${ref}/spec.json`, e);
    }
  }
  return ppm > 0 ? { ref, ppm, base, centres, heightM } : null;
}

/** bounds of the visible meshes only (hidden LODs and stowed weapons excluded), with skinned vertex positions */
const _bv = new THREE.Vector3();
const _bb = new THREE.Box3();
function visibleBounds(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  root.updateMatrixWorld(true);
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const im = m as unknown as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      im.computeBoundingBox();
      if (im.boundingBox) out.union(_bb.copy(im.boundingBox).applyMatrix4(im.matrixWorld));
      return;
    }
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, _bv);
      out.expandByPoint(_bv.applyMatrix4(m.matrixWorld));
    }
  });
  if (out.isEmpty()) out.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 1.8, 0.3));
  return out;
}

function renderCalibratedTurn(b: Built, calib: SheetCalib, info: string, animName: () => string): void {
  const yaws = (params.get('yaws') ?? '0,-35,-90,180').split(',').map(Number);
  const names = ['FRONT', '3/4 FRONT', 'RIGHT PROFILE', 'BACK'];
  const k = innerWidth / SHEET_W; // sheet px → canvas px
  const ppm = calib.ppm * k;
  const basePx = calib.base * k;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 200);
  const box = new THREE.Box3();
  const right = new THREE.Vector3();
  const target = new THREE.Vector3();
  renderer.setScissorTest(true);
  const render = () => {
    labels.innerHTML = '';
    const centres = calib.centres.map((c) => c * k);
    const measured: { view: string; heightM: number; widthM: number }[] = [];
    b.holder.rotation.y = 0;
    visibleBounds(b.holder, box).getCenter(target);
    yaws.forEach((yawDeg, i) => {
      const yaw = THREE.MathUtils.degToRad(yawDeg);
      // the exact silhouette extent seen from this yaw: turn the subject by -yaw and take the precise
      // (skinned) bounds, whose x then equals the camera's right-axis coordinate
      b.holder.rotation.y = -yaw;
      visibleBounds(b.holder, box);
      const minS = box.min.x;
      const maxS = box.max.x;
      const minY = box.min.y;
      measured.push({ view: names[i] ?? `yaw ${yawDeg}`, heightM: box.max.y - minY, widthM: maxS - minS });
      b.holder.rotation.y = 0;
      b.holder.updateMatrixWorld(true);
      // level orthographic camera orbiting the subject (lighting stays fixed in the world, as in view=turn)
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      cam.position.set(target.x + Math.sin(yaw) * 20, target.y, target.z + Math.cos(yaw) * 20);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      const c = centres[i] ?? centres[centres.length - 1];
      const m = (minS + maxS) / 2; // silhouette centre on the camera's right axis
      cam.left = -(c / ppm) - (right.dot(target) - m);
      cam.right = cam.left + innerWidth / ppm;
      cam.top = basePx / ppm - (target.y - minY);
      cam.bottom = cam.top - innerHeight / ppm;
      cam.near = 0.05;
      cam.far = 60;
      cam.updateProjectionMatrix();
      const x0 = i === 0 ? 0 : (centres[i - 1] + c) / 2;
      const x1 = i === yaws.length - 1 ? innerWidth : (c + centres[i + 1]) / 2;
      renderer.setViewport(0, 0, innerWidth, innerHeight);
      renderer.setScissor(x0, 0, x1 - x0, innerHeight);
      renderer.render(scene, cam);
      label(names[i] ?? `yaw ${yawDeg}`, c - 40, basePx + 30 * k);
    });
    const h = measured[0]?.heightM ?? 0;
    label(
      `${info}   anim=${animName()} t=${tParam}   calibrated to ${calib.ref ?? 'ppm'} (${calib.ppm.toFixed(1)} px/m, baseline ${calib.base})   height ${h.toFixed(3)} m${calib.heightM ? ` (sheet ${calib.heightM} m)` : ''}`,
      6,
      innerHeight - 24,
    );
    (window as unknown as { __labTurn?: unknown }).__labTurn = measured;
  };
  render();
  requestAnimationFrame(() => {
    render();
    window.__snapReady = true;
  });
}

async function main() {
  await discoverSubjects();
  if (brokenModules.length) label(`broken lab modules (see console): ${brokenModules.join(', ')}`, 6, innerHeight - 48);
  if (allSubjects.length === 0) {
    label('No lab subjects found. Create src/**/<name>.lab.ts exporting `subjects`.', 12, 12);
    window.__snapReady = true;
    return;
  }

  const wanted = params.get('subject');
  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 500);
  window.scene = scene;
  window.__THREE_CAMERA__ = camera;
  window.__renderer__ = renderer;

  if (view === 'sheet') {
    let list = allSubjects;
    const names = params.get('subjects');
    const cat = params.get('category');
    if (names) list = names.split(',').map((n) => allSubjects.find((s) => s.name === n)).filter(Boolean) as LabSubject[];
    if (cat) list = list.filter((s) => s.category === cat);
    const built: Built[] = [];
    for (const s of list) {
      try {
        built.push(await build(s));
      } catch (e) {
        console.error(`[lab] ${s.name} failed:`, e);
      }
    }
    for (const b of built) {
      scene.add(b.holder);
      if (b.inst.pose) b.inst.pose(animParam ?? b.inst.animations?.[0] ?? 'idle', tParam);
    }
    const n = built.length;
    const cols = Math.ceil(Math.sqrt(n * (innerWidth / innerHeight)));
    const rows = Math.ceil(n / cols);
    const cw = innerWidth / cols;
    const ch = innerHeight / rows;
    renderer.setScissorTest(true);
    const renderSheet = () => {
      labels.innerHTML = '';
      built.forEach((b, i) => {
        const cx = (i % cols) * cw;
        const cy = Math.floor(i / cols) * ch;
        for (const o of built) o.holder.visible = o === b;
        camera.aspect = cw / ch;
        placeCamera(camera, frameOf(b.holder), 35, 12);
        renderer.setViewport(cx, innerHeight - cy - ch, cw, ch);
        renderer.setScissor(cx, innerHeight - cy - ch, cw, ch);
        renderer.render(scene, camera);
        label(`${b.subject.name} [${b.subject.category}] ${Math.round(b.tris / 1000)}k tris ${b.ms.toFixed(0)}ms`, cx + 6, cy + 6);
      });
    };
    renderSheet();
    requestAnimationFrame(() => { renderSheet(); window.__snapReady = true; });
    window.__lab = { subjects: allSubjects.map((s) => s.name), render: renderSheet };
    return;
  }

  const subject = (wanted && allSubjects.find((s) => s.name === wanted)) || allSubjects[0];
  if (wanted && subject.name !== wanted) console.error(`[lab] subject "${wanted}" not found; showing ${subject.name}`);
  const b = await build(subject);
  scene.add(b.holder);
  const anims = b.inst.animations ?? [];
  let anim = animParam ?? anims[0] ?? 'idle';
  if (b.inst.pose) b.inst.pose(anim, tParam);
  if (params.get('wire') === '1') applyWire(b.inst.object);

  const f0 = frameOf(b.holder);
  const pole = makeReferencePole();
  pole.position.set(f0.center.x - f0.size.x / 2 - 0.6, 0, f0.center.z);
  scene.add(pole);
  if (view === 'turn') pole.visible = false; // the sheets have a side scale, not a pole in frame

  const info = `${subject.name}  ${Math.round(b.tris).toLocaleString()} tris  build ${b.ms.toFixed(0)} ms  size ${f0.size.x.toFixed(2)}×${f0.size.y.toFixed(2)}×${f0.size.z.toFixed(2)} m`;
  const pose = (a: string, t: number) => b.inst.pose?.(a, t);

  if (view === 'turn') {
    const calib = await loadSheetCalibration();
    if (calib) {
      renderCalibratedTurn(b, calib, info, () => anim);
      window.__lab = { subjects: allSubjects.map((s) => s.name), pose, calib };
      return;
    }
  }

  if (view === 'quad' || view === 'single' || view === 'turn') {
    const f = frameOf(b.holder);
    const turnYaws = (params.get('yaws') ?? '0,-35,-90,180').split(',').map(Number);
    const turnNames = ['FRONT', '3/4 FRONT', 'RIGHT PROFILE', 'BACK'];
    const views =
      view === 'single'
        ? [{ yaw: 35, pitch: 12, name: '3/4' }]
        : view === 'turn'
          ? turnYaws.map((yaw, i) => ({ yaw, pitch: 3, name: turnNames[i] ?? `yaw ${yaw}` }))
          : [
              { yaw: 0, pitch: 6, name: 'front' },
              { yaw: 90, pitch: 6, name: 'right' },
              { yaw: 180, pitch: 6, name: 'back' },
              { yaw: 40, pitch: 35, name: '3/4 high' },
            ];
    const cols = views.length === 1 ? 1 : view === 'turn' ? views.length : 2;
    const rows = Math.ceil(views.length / cols);
    const cw = innerWidth / cols;
    const ch = innerHeight / rows;
    renderer.setScissorTest(true);
    const renderStatic = () => {
      labels.innerHTML = '';
      views.forEach((v, i) => {
        const cx = (i % cols) * cw;
        const cy = Math.floor(i / cols) * ch;
        camera.aspect = cw / ch;
        placeCamera(camera, f, v.yaw, v.pitch);
        renderer.setViewport(cx, innerHeight - cy - ch, cw, ch);
        renderer.setScissor(cx, innerHeight - cy - ch, cw, ch);
        renderer.render(scene, camera);
        label(v.name, cx + 6, cy + 6);
      });
      label(`${info}   anim=${anim} t=${tParam}`, 6, innerHeight - 24);
    };
    renderStatic();
    requestAnimationFrame(() => { renderStatic(); window.__snapReady = true; });
    window.__lab = { subjects: allSubjects.map((s) => s.name), pose, render: renderStatic };
    return;
  }

  // orbit (interactive)
  const panel = document.getElementById('panel')!;
  panel.classList.remove('hidden');
  const selSubject = document.getElementById('subject') as HTMLSelectElement;
  const selAnim = document.getElementById('anim') as HTMLSelectElement;
  const selMode = document.getElementById('mode') as HTMLSelectElement;
  const chkWire = document.getElementById('wire') as HTMLInputElement;
  const chkPaused = document.getElementById('paused') as HTMLInputElement;
  (document.getElementById('info') as HTMLDivElement).textContent = info.replace(/ {2}/g, '\n');
  for (const s of allSubjects) selSubject.add(new Option(`${s.category}/${s.name}`, s.name, false, s === subject));
  for (const a of anims) selAnim.add(new Option(a, a, false, a === anim));
  selMode.value = 'orbit';
  const reload = (patch: Record<string, string>) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    location.search = p.toString();
  };
  selSubject.onchange = () => reload({ subject: selSubject.value });
  selMode.onchange = () => reload({ view: selMode.value });
  chkWire.onchange = () => reload({ wire: chkWire.checked ? '1' : '0' });
  selAnim.onchange = () => (anim = selAnim.value);

  camera.aspect = innerWidth / innerHeight;
  placeCamera(camera, f0, 35, 12);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(f0.center);
  controls.enableDamping = true;
  controls.update();
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  const clock = new THREE.Clock();
  let t = tParam;
  let frames = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!chkPaused.checked) t += dt;
    pose(anim, t);
    controls.update();
    renderer.render(scene, camera);
    if (++frames === 2) window.__snapReady = true;
  });
  window.__lab = { subjects: allSubjects.map((s) => s.name), pose, render: () => renderer.render(scene, camera) };
}

main().catch((e) => {
  console.error(e);
  window.__snapError = String(e?.stack ?? e);
});
