/**
 * World viewer (dev tool, owner: world). Real engine + environment preset + any lab subject, with an
 * explicit camera. For judging world builders under production lighting.
 *
 *   /src/world/tools/view.html?subject=<lab subject>&env=<EnvironmentName>&cam=x,y,z&look=x,y,z
 *       &fov=55 &q=low|medium|high &ground=<terrain style|0> &warm=<sec> &wind=<t> &pos=x,y,z &yaw=<deg>
 *       &anim=<name>&t=<sec>  &hud=0  &fog=<density override>  &sun=<intensity mult>
 */
import * as THREE from 'three';
import { createEngine } from '../../core/engine';
import { createFx } from '../../core/fx';
import type { EnvironmentName, LabSubject, Quality } from '../../core/types';
import { setWindTime } from '../shader';
import { setWorldQuality } from '../quality';
import { buildTerrain } from '../terrain';
import { fbm2 } from '../../core/rng';

const params = new URLSearchParams(location.search);
const w = window as unknown as Record<string, unknown>;
const q = (params.get('q') ?? 'medium') as Quality;
setWorldQuality(q);
const envName = (params.get('env') ?? 'arena') as EnvironmentName;
const host = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
if (params.get('hud') === '0') hud.style.display = 'none';

const modules = import.meta.glob<{ subjects?: LabSubject[] }>('/src/**/*.lab.ts', { eager: true });
const subjects = new Map<string, LabSubject>();
for (const mod of Object.values(modules)) for (const s of mod.subjects ?? []) subjects.set(s.name, s);

const engine = createEngine(host, q);
const fx = createFx(engine);
engine.setEnvironment(envName);
if (params.has('fog') && engine.scene.fog) (engine.scene.fog as THREE.FogExp2).density = Number(params.get('fog'));
if (params.has('sun')) engine.sun.intensity *= Number(params.get('sun'));
if (params.has('wind')) setWindTime(Number(params.get('wind')));
w.scene = engine.scene;
w.__THREE_CAMERA__ = engine.camera;
w.__renderer__ = engine.renderer;

const num3 = (s: string | null, d: [number, number, number]): [number, number, number] => {
  if (!s) return d;
  const p = s.split(',').map(Number);
  return [p[0] ?? d[0], p[1] ?? d[1], p[2] ?? d[2]];
};

async function main(): Promise<void> {
  const ground = params.get('ground') ?? '0';
  let groundH: ((x: number, z: number) => number) | null = null;
  if (ground !== '0') {
    const h = (x: number, z: number) => fbm2(x * 0.02, z * 0.02, 4, 5) * 3 + Math.sin(x * 0.07) * 0.4;
    const flat = ground.endsWith('flat');
    const style = ground.replace('flat', '') as 'forest';
    const t = buildTerrain({ size: 400, segments: 256, height: flat ? () => 0 : h, style: (style || 'forest') as 'forest' });
    engine.levelRoot.add(t.mesh);
    groundH = t.heightAt;
  }
  const name = params.get('subject');
  let info = '';
  if (name) {
    const s = subjects.get(name);
    if (!s) throw new Error(`unknown subject ${name}; have: ${[...subjects.keys()].join(', ')}`);
    const t0 = performance.now();
    const inst = await s.create();
    const ms = performance.now() - t0;
    const p = num3(params.get('pos'), [0, 0, 0]);
    inst.object.position.set(p[0], p[1] + (groundH ? groundH(p[0], p[2]) : 0), p[2]);
    inst.object.rotation.y = THREE.MathUtils.degToRad(Number(params.get('yaw') ?? 0));
    inst.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.castShadow === false && m.receiveShadow === false) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    engine.levelRoot.add(inst.object);
    const anim = params.get('anim');
    if (anim && inst.pose) inst.pose(anim, Number(params.get('t') ?? 0));
    info = `${name} built in ${ms.toFixed(0)} ms`;
  }
  const cam = engine.camera;
  cam.fov = Number(params.get('fov') ?? 55);
  const c = num3(params.get('cam'), [0, 1.7, 8]);
  const l = num3(params.get('look'), [0, 1.5, 0]);
  cam.position.set(c[0], c[1], c[2]);
  cam.lookAt(l[0], l[1], l[2]);
  cam.near = 0.1;
  cam.far = 4000;
  cam.updateProjectionMatrix();
  engine.shadowFocus.set(l[0], l[1], l[2]);
  const warm = Number(params.get('warm') ?? 2);
  for (let t = 0; t < warm; t += 1 / 30) fx.update(1 / 30, cam);
  let frames = 0;
  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    engine.shadowFocus.set(l[0], l[1], l[2]);
    engine.render(dt);
    frames++;
    if (frames % 20 === 0) {
      hud.textContent = `${info}\n${envName} [${q}]  calls ${engine.renderer.info.render.calls}  tris ${engine.renderer.info.render.triangles}`;
    }
    if (frames === 6) w.__snapReady = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  w.__snapError = String((e as Error)?.message ?? e);
});
