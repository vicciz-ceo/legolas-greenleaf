import * as THREE from 'three';
import type { LabSubject } from '../core/types';
import { fbm2, Rng } from '../core/rng';
import { smoothstep } from '../core/math';
import { buildTerrain } from './terrain';
import { createCrowd } from './crowd';
import { forest, grassField, ferns } from './vegetation';
import { setWindTime } from './shader';
import { setFlameTime } from './fire';
import { blackGate } from './arch_blackgate';
import { amonHenSummit, ruins } from './arch_amonhen';
import { minasTirith } from './arch_minas';
import { brokenBridge, frozenWaterfall, ruinedWatchtower } from './arch_ravenhill';
import { boulderField, banner, brazier, iceSheet, rock } from './props';
import { withDebug } from './labutil';

const q = (k: string, d: number) => Number(new URLSearchParams(location.search).get(k) ?? d);

export const subjects: LabSubject[] = [
  {
    name: 'vignette_black_gate',
    category: 'environment',
    create() {
      setFlameTime(1.0);
      const g = new THREE.Group();
      const h = (x: number, z: number) => fbm2(x * 0.012, z * 0.012, 4, 3) * 5 + fbm2(x * 0.06, z * 0.06, 2, 4) * 1.2 - Math.max(0, 40 - Math.abs(x)) * 0.0;
      const t = buildTerrain({ size: 600, segments: 300, height: h, style: 'ash' });
      g.add(t.mesh);
      const gate = withDebug(blackGate());
      gate.object.position.set(0, h(0, 0), -50);
      g.add(gate.object);
      for (const [cx, cz, kind, n] of [[0, 120, 'orc', q('orcs', 700)], [-60, 100, 'easterling', q('east', 300)], [70, 110, 'uruk', 250]] as [number, number, 'orc' | 'easterling' | 'uruk', number][]) {
        const c = createCrowd({ center: new THREE.Vector3(cx, h(cx, cz), cz), halfSize: [45, 45], count: n, kind, facing: Math.PI, speed: 0, props: true }, t.heightAt);
        g.add(c.mesh);
      }
      g.add(boulderField({ center: new THREE.Vector3(0, 0, 40), halfSize: [200, 150] }, 60, [0.8, 4], t.heightAt, { kind: 'dark', seed: 5 }).object);
      return { object: g, height: 80 };
    },
  },
  {
    name: 'vignette_ravenhill',
    category: 'environment',
    create() {
      setWindTime(1);
      const g = new THREE.Group();
      const h = (x: number, z: number) => {
        const base = fbm2(x * 0.02, z * 0.02, 4, 8) * 8 + Math.max(0, z - 20) * 0.55;
        return base + 6 * smoothstep(-40, 0, -Math.abs(x + 20));
      };
      const t = buildTerrain({ size: 320, segments: 220, height: h, style: 'snow', center: [0, 20] });
      g.add(t.mesh);
      const tw = withDebug(ruinedWatchtower());
      tw.object.position.set(-15, h(-15, 30), 30);
      g.add(tw.object);
      const wf = withDebug(frozenWaterfall(16, 24));
      wf.object.position.set(40, h(40, 60) - 1, 62);
      wf.object.rotation.y = Math.PI;
      g.add(wf.object);
      const br = withDebug(brokenBridge(30, 5, { gap: [0.38, 0.62] }));
      br.object.position.set(15, h(15, 0) + 7, 5);
      g.add(br.object);
      const rng = new Rng(4);
      for (let i = 0; i < 6; i++) {
        const sx = -10 + rng.float() * 40;
        const sz = -20 + rng.float() * 30;
        const ic = iceSheet(4 + rng.float() * 4, i + 1);
        ic.object.position.set(sx, h(sx, sz) + 0.05, sz);
        ic.object.rotation.y = rng.float() * 3;
        g.add(ic.object);
      }
      g.add(boulderField({ center: new THREE.Vector3(0, 0, 20), halfSize: [120, 100] }, 40, [0.6, 3], t.heightAt, { kind: 'cliff', seed: 2 }).object);
      g.add(forest({ center: new THREE.Vector3(0, 0, 20), halfSize: [140, 100] }, 40, ['pine', 'dead'], t.heightAt, { seed: 5, exclude: (x, z) => Math.hypot(x + 15, z - 30) < 20 }).object);
      return { object: g, height: 40 };
    },
  },
  {
    name: 'vignette_amon_hen',
    category: 'environment',
    create() {
      setWindTime(1);
      const g = new THREE.Group();
      const h = (x: number, z: number) => fbm2(x * 0.02, z * 0.02, 4, 6) * 5 + 14 * (1 - smoothstep(0, 70, Math.hypot(x, z)));
      const t = buildTerrain({ size: 300, segments: 220, height: h, style: 'forest', tint: 0xe8d0a0, patchiness: 0.7 });
      g.add(t.mesh);
      const summit = withDebug(amonHenSummit());
      summit.object.position.set(0, h(0, 0), 0);
      g.add(summit.object);
      g.add(forest({ center: new THREE.Vector3(0, 0, 0), halfSize: [110, 110] }, q('trees', 90), [{ kind: 'beech', weight: 3 }, { kind: 'birch', weight: 2 }, { kind: 'pine', weight: 0.5 }], t.heightAt, { seed: 11, exclude: (x, z) => Math.hypot(x, z) < 34, leafTint: [1.05, 0.95, 0.75] }).object);
      g.add(ruins({ center: new THREE.Vector3(0, 0, 0), halfSize: [60, 60] }, 20, t.heightAt, { exclude: (x, z) => Math.hypot(x, z) < 26, seed: 3 }).object);
      g.add(grassField({ center: new THREE.Vector3(0, 0, 0), halfSize: [50, 50] }, 1.6, t.heightAt, { dry: 0.35 }));
      g.add(ferns({ center: new THREE.Vector3(0, 0, 0), halfSize: [80, 80] }, q('ferns', 400), t.heightAt, { seed: 4 }));
      return { object: g, height: 30 };
    },
  },
  {
    name: 'vignette_pelennor',
    category: 'environment',
    create() {
      const g = new THREE.Group();
      const h = (x: number, z: number) => fbm2(x * 0.01, z * 0.01, 3, 12) * 4;
      const t = buildTerrain({ size: 1600, segments: 320, height: h, style: 'plains', tint: 0xd8c8a0, patchiness: 0.8 });
      g.add(t.mesh);
      const mt = minasTirith({ scale: 1.1 });
      mt.object.position.set(0, h(0, 0), -1200);
      g.add(mt.object);
      for (const [cx, cz, kind, n] of [[-80, -100, 'gondor', 400], [80, -60, 'rohirrim', 200], [0, 80, 'easterling', 500]] as [number, number, 'gondor' | 'rohirrim' | 'easterling', number][]) {
        g.add(createCrowd({ center: new THREE.Vector3(cx, h(cx, cz), cz), halfSize: [50, 35], count: n, kind, facing: kind === 'easterling' ? Math.PI : 0, speed: 0, props: true }, t.heightAt).mesh);
      }
      const b = banner(0x111114, 'white_tree');
      b.object.position.set(0, h(0, -10), -10);
      g.add(b.object);
      const br = brazier();
      br.object.position.set(6, h(6, -8), -8);
      g.add(br.object);
      void rock;
      return { object: g, height: 40 };
    },
  },
];
