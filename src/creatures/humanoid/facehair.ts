/**
 * Face hair cards: eyelashes along the upper-lid margins and eyebrow hairs lying on the brow,
 * both rigid to the head bone and rendered with the hair material (alpha strands + strand
 * highlight). Roots come from the face sculpt (`HeadInfo`) and are projected onto the actual
 * sculpted surface with an SDF probe, so they sit exactly on the skin.
 */
import * as THREE from 'three';
import type { V3 } from '../kit/sdf';
import type { SdfProbe } from '../kit/sdf';
import { hairGeometry, type Strand } from '../kit/hair';
import type { HeadInfo } from './face';
import type { Proportions } from './proportions';

export interface FaceHairOpts {
  browColor: number;
  lashColor: number;
  /** 0 = no brows (orcs with bare brow ridges still get some), 1 = normal */
  brows?: number;
  lashes?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();

export function faceHairGeometry(P: Proportions, head: HeadInfo, probe: SdfProbe | null, headBone: number, o: FaceHairOpts, lod: 0 | 1): THREE.BufferGeometry | null {
  const strands: Strand[] = [];
  const s = P.s;
  const u = P.headH;
  // ── eyelashes: a fringe of short cards along each upper lid, curling up and out ──
  if (o.lashes !== false && lod === 0) {
    for (const sd of ['l', 'r'] as const) {
      const lid = head.upperLid[sd];
      const ec = head.eyes[sd];
      const sx = sd === 'l' ? 1 : -1;
      const n = lid.length;
      for (let i = 0; i < n - 1; i++) {
        const a = lid[i], b = lid[i + 1];
        const t = (i + 0.5) / (n - 1); // inner → outer
        const root = _a.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        const along = _t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const segW = along.length();
        along.normalize();
        // outward from the eyeball centre
        const out = _n.set(root.x - ec[0], root.y - ec[1], root.z - ec[2]).normalize();
        // lashes: longer and more lifted toward the outer corner
        const len = (0.0042 + 0.0026 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * s;
        const pts: THREE.Vector3[] = [];
        const nrm: THREE.Vector3[] = [];
        const dir = new THREE.Vector3().copy(out).multiplyScalar(0.8).add(new THREE.Vector3(0.3 * sx * (t - 0.35), 0.12, 0.55)).normalize();
        const p = root.clone().addScaledVector(out, 0.0004 * s);
        for (let k = 0; k <= 3; k++) {
          pts.push(p.clone());
          // card normal: perpendicular to the lid tangent and the lash direction
          const cn = new THREE.Vector3().crossVectors(along, dir).normalize();
          if (cn.dot(out) < 0) cn.multiplyScalar(-1);
          nrm.push(cn);
          p.addScaledVector(dir, len / 3);
          dir.y += 0.32; // curl upward
          dir.normalize();
        }
        strands.push({ points: pts, normals: nrm, width: segW * 1.2, tipWidth: segW * 0.9, color: o.lashColor, bone: headBone });
      }
    }
  }
  // ── eyebrows: many fine hairs lying on the brow, combed outward (upward at the inner end) ──
  const bw = o.brows ?? 1;
  if (bw > 0) {
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cBase = new THREE.Color().setHex(o.browColor, THREE.SRGBColorSpace);
    const cTmp = new THREE.Color();
    for (const sd of ['l', 'r'] as const) {
      const brow = head.brow[sd];
      const n = brow.length;
      const count = Math.round((lod === 0 ? 70 : 24) * bw);
      for (let k = 0; k < count; k++) {
        const t = Math.pow(rnd(), 0.85); // denser toward the head of the brow
        const fi = t * (n - 1);
        const i0 = Math.min(n - 2, Math.floor(fi));
        const ft = fi - i0;
        const a = brow[i0], b = brow[i0 + 1];
        // band height tapers from the head (≈ 1.1 cm) to the tail
        const band = (0.05 - 0.032 * t) * u * bw;
        const off = (rnd() - 0.5) * band;
        const root: V3 = [a[0] + (b[0] - a[0]) * ft, a[1] + (b[1] - a[1]) * ft + off, a[2]];
        const ax = b[0] - a[0], ay = b[1] - a[1];
        const al = Math.hypot(ax, ay) || 1;
        // direction: along the brow, rotated upward at the head, slightly downward at the tail
        const up = t < 0.2 ? 1.1 - t * 3 : 0.12 - 0.25 * (t - 0.2);
        const dir = _b.set(ax / al, ay / al + up, 0).normalize();
        const len = (0.0065 + 0.003 * rnd()) * s;
        const pts: THREE.Vector3[] = [];
        const nrm: THREE.Vector3[] = [];
        for (let q = 0; q <= 2; q++) {
          const p0: V3 = [root[0] + dir.x * len * (q / 2), root[1] + dir.y * len * (q / 2), root[2]];
          let pp: V3 = p0;
          let nn: V3 = [0, 0, 1];
          if (probe) {
            pp = probe.project([p0[0], p0[1], p0[2] + 0.01]);
            nn = probe.normal(pp);
          }
          const lift = (0.0003 + 0.0002 * q + 0.0002 * rnd()) * s;
          pts.push(new THREE.Vector3(pp[0] + nn[0] * lift, pp[1] + nn[1] * lift, pp[2] + nn[2] * lift));
          nrm.push(new THREE.Vector3(nn[0], nn[1], nn[2]));
        }
        const wdt = (0.0013 + 0.0007 * (1 - t)) * s;
        cTmp.copy(cBase).multiplyScalar(0.8 + 0.4 * rnd());
        strands.push({ points: pts, normals: nrm, width: wdt, tipWidth: wdt * 0.4, color: cTmp.getHex(THREE.SRGBColorSpace), bone: headBone });
      }
    }
  }
  if (!strands.length) return null;
  // flat cards (curl 0) so lashes/brows do not bulge off the skin
  return hairGeometry(strands, [], { color: o.browColor, weights: (_p, _a2, out) => out.push([headBone, 1]), curl: 0 });
}
