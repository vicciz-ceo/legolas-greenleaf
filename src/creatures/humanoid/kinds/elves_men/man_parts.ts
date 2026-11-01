/**
 * Rigid trim for the Lake-town man (docs/refs/laketown_man): the dark binding on the jacket's
 * front edges and hem with a few toggles, the rolled brim of the knit cap, and the flared boot
 * collars. Placed from the anatomy section ellipses, not the 6 cm body mesh.
 */
import * as THREE from 'three';
import type { V3 } from '../../../kit/sdf';
import type { SurfaceName, SurfaceSpec } from '../../../kit/surfaces';
import type { KindContext } from '../../types';
import { put, torsoCentreFront, torsoSection, tube } from './geo';
import { torsoRibbon, torsoSurface } from './rohirrim_gear';

interface Mat {
  color: number;
  mat: SurfaceName | SurfaceSpec;
}

/**
 * Binding along both front edges of an open jacket and round its hem, plus `toggles` small
 * toggle bars across the slit. `slit` is the half-width of the opening (m) at the neck and at the hem.
 */
export function jacketBinding(ctx: KindContext, o: Mat & { yTop: number; yHem: number; slit: [number, number]; inflate: number; toggles?: number; toggleColor?: number }) {
  const { P } = ctx;
  const sc = P.s;
  const wid = 0.011 * sc;
  // front edges
  const path = (sx: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const f = i / 6;
      const y = o.yTop + (o.yHem - o.yTop) * f;
      pts.push([sx * (o.slit[0] + (o.slit[1] - o.slit[0]) * f + wid * 0.6), y]);
    }
    return pts;
  };
  for (const sx of [1, -1]) put(ctx, torsoRibbon(P, path(sx), 1, wid, o.inflate + 0.003 * sc), { bone: 'chest', color: o.color, mat: o.mat, small: true });
  // hem, front and back (a little proud: the jacket's skirt part is wider than the torso section)
  const sec = torsoSection(P, o.yHem + 0.01 * sc);
  const hem: [number, number][] = [];
  for (let i = 0; i <= 8; i++) hem.push([(-0.94 + (1.88 * i) / 8) * sec.rx, o.yHem + 0.011 * sc]);
  for (const side of [1, -1] as const) put(ctx, torsoRibbon(P, hem, side, 0.022 * sc, o.inflate + 0.012 * sc), { bone: 'hips', color: o.color, mat: o.mat, small: true });
  // toggles bridging the slit
  const n = o.toggles ?? 4;
  for (let i = 0; i < n; i++) {
    const y = o.yTop - 0.045 * sc - ((o.yTop - o.yHem - 0.16 * sc) * i) / Math.max(1, n - 1);
    const w = o.slit[0] + (o.slit[1] - o.slit[0]) * ((o.yTop - y) / (o.yTop - o.yHem));
    const z = torsoCentreFront(P, y) + o.inflate + 0.005 * sc;
    put(ctx, new THREE.BoxGeometry((w * 2 + 0.014 * sc), 0.007 * sc, 0.006 * sc).translate(0, y, z), { bone: 'chest', color: o.toggleColor ?? o.color, mat: o.mat, small: true });
  }
}

/** the rolled brim of a knit cap: a thick tube round the head just above the brow */
export function capRoll(ctx: KindContext, o: Mat & { radius?: number }) {
  const { P } = ctx;
  const u = P.headH;
  const pts: V3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2; // 0 = front
    const rimY = 0.095 - 0.2 * ((1 - Math.cos(a)) / 2);
    pts.push(P.h(Math.sin(a) * 0.372, rimY, -0.06 + Math.cos(a) * 0.482));
  }
  put(ctx, tube(pts, o.radius ?? 0.1 * u, { seg: 20, radial: 3, closed: true }), { bone: 'head', color: o.color, mat: o.mat, small: true });
}

/** a flared collar (open cone) round each boot top, `y` metres above the ground */
export function bootCollars(ctx: KindContext, o: Mat & { y: number; radius: number; flare: number; height: number }) {
  const { P } = ctx;
  const sc = P.s;
  for (const sd of ['l', 'r'] as const) {
    const knee = P.j[`shin_${sd}`];
    const foot = P.j[`foot_${sd}`];
    const t = (o.y - foot[1]) / (knee[1] - foot[1]);
    const c = new THREE.Vector3(foot[0] + (knee[0] - foot[0]) * t, o.y, foot[2] + (knee[2] - foot[2]) * t - 0.006 * sc);
    const g = new THREE.CylinderGeometry(o.radius + o.flare, o.radius, o.height, 10, 1, true).translate(c.x, c.y, c.z);
    put(ctx, g, { bone: `shin_${sd}`, color: o.color, mat: o.mat, small: true });
  }
}

export { torsoSurface };
