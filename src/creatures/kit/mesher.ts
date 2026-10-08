/**
 * Kit — narrow-band surface nets.
 *
 * Polygonises an `SdfProgram`:
 *   1. the bounds are split into 8³-cell blocks; each block gets a culled instruction list
 *      (only primitives whose bounds touch it) and is classified from its centre distance,
 *   2. only blocks near the surface are sampled (flood-filled across faces so nothing is missed),
 *   3. one vertex per sign-changing cell (surface nets), projected onto the surface with Newton
 *      steps along the SDF gradient; normals are the SDF gradient,
 *   4. per-vertex colour / surface / pattern attributes and skin weights come from a full
 *      evaluation at the vertex; weights are smoothed across the mesh and reduced to the top 4,
 *   5. per-vertex ambient occlusion is computed from the SDF (cheap and good for crevices).
 *
 * Detail regions (`regions`) are meshed at a finer resolution inside their box; the coarse mesh is
 * clipped away inside and pushed under the fine one so the seam is invisible.
 */
import { makeEvaluator, ATTR_COUNT, type SdfProgram, type V3 } from './sdf';

export interface MeshRegion {
  min: V3;
  max: V3;
  /** cell size inside the region (m) */
  res: number;
  /** overlap band (m), default 3 × the coarse cell size */
  band?: number;
  /** multiplier on the AO reach for vertices of this region (faces: ~0.35, so features do not smear dark) */
  aoScale?: number;
}

/** boundary refinement: split triangle edges that cross a colour/material boundary (crisp seams) */
export interface RefineOpts {
  /** refinement passes (each halves the blur width of a seam), default 1 */
  levels?: number;
  /** attribute difference that marks an edge (sqrt-colour L1 + 0.5 × surface L1), default 0.07 */
  threshold?: number;
  /** never split edges shorter than this (m), default 0.006 */
  minEdge?: number;
}

export interface MeshOpts {
  /** cell size (m). ~0.012–0.02 for a humanoid body */
  res: number;
  regions?: MeshRegion[];
  /** SDF ambient occlusion: max sample distance (m) and strength. false disables. */
  ao?: { dist: number; strength?: number } | false;
  /** skin weight smoothing iterations (default 2) */
  smooth?: number;
  /** Newton projection iterations (default 2) */
  project?: number;
  /** restrict meshing to this box */
  clip?: { min: V3; max: V3 };
  /** split edges across material boundaries so seams (hems, belts, hairlines, lips) stay crisp */
  refine?: RefineOpts;
}

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  surf: Float32Array;
  pat0: Float32Array;
  pat1: Float32Array;
  /** (signed distance to a seam paint, seam weight) — stitches / edge wear in the shader */
  seam: Float32Array;
  ao: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
  vertexCount: number;
  triCount: number;
  /** triangles per pass: [coarse, region0, region1, …] */
  passTris: number[];
  ms: number;
}

const BLOCK = 8;

interface PassResult {
  pos: number[];
  /** SDF gradient (normal) at each vertex from the last Newton step */
  nrm: number[];
  /** cull-list offset per vertex (index into lists) */
  vlist: number[];
  tri: number[];
}

/** signed distance to an axis-aligned box (negative inside) */
function boxSd(x: number, y: number, z: number, mn: V3, mx: V3): number {
  const cx = (mn[0] + mx[0]) / 2, cy = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
  const qx = Math.abs(x - cx) - (mx[0] - mn[0]) / 2;
  const qy = Math.abs(y - cy) - (mx[1] - mn[1]) / 2;
  const qz = Math.abs(z - cz) - (mx[2] - mn[2]) / 2;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

export function meshSdf(prog: SdfProgram, opts: MeshOpts): MeshData {
  const t0 = performance.now();
  const ev = makeEvaluator(prog);
  const nb = prog.boneCount;
  const regions = opts.regions ?? [];
  const projectIters = opts.project ?? 1;

  // shared list storage for culled instruction lists (one growable Int32Array → monomorphic eval)
  const store = { arr: new Int32Array(4096), len: 0 };
  const listStart: number[] = [];
  const listEnd: number[] = [];
  const listBox: number[] = [];
  const tmp: number[] = [];
  const pushList = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number => {
    prog.cull(x0, y0, z0, x1, y1, z1, tmp);
    const id = listStart.length;
    listBox.push(x0, y0, z0, x1, y1, z1);
    if (store.len + tmp.length > store.arr.length) {
      const na = new Int32Array(Math.max(store.arr.length * 2, store.len + tmp.length + 1024));
      na.set(store.arr.subarray(0, store.len));
      store.arr = na;
    }
    listStart.push(store.len);
    for (let i = 0; i < tmp.length; i++) store.arr[store.len++] = tmp[i];
    listEnd.push(store.len);
    return id;
  };

  const passes: { res: PassResult; insetOf: (x: number, y: number, z: number) => number }[] = [];
  const sb = opts.clip ? [...opts.clip.min, ...opts.clip.max] : prog.solidBounds;

  // level 0: coarse mesh, clipped out of every region interior; deeper regions nest naturally
  const levels: { res: number; clipMin: V3; clipMax: V3; excl: MeshRegion[]; insetBoxes: MeshRegion[]; aoScale?: number }[] = [];
  levels.push({ res: opts.res, clipMin: [sb[0], sb[1], sb[2]], clipMax: [sb[3], sb[4], sb[5]], excl: regions, insetBoxes: regions });
  regions.forEach((r, i) => {
    // regions nested inside this one with a finer resolution
    const inner = regions.filter((q, j) => j !== i && q.res < r.res && q.min[0] >= r.min[0] && q.min[1] >= r.min[1] && q.min[2] >= r.min[2] && q.max[0] <= r.max[0] && q.max[1] <= r.max[1] && q.max[2] <= r.max[2]);
    levels.push({
      res: r.res,
      clipMin: [Math.max(r.min[0], sb[0]), Math.max(r.min[1], sb[1]), Math.max(r.min[2], sb[2])],
      clipMax: [Math.min(r.max[0], sb[3]), Math.min(r.max[1], sb[4]), Math.min(r.max[2], sb[5])],
      excl: inner,
      insetBoxes: inner,
      aoScale: r.aoScale,
    });
  });

  for (const L of levels) {
    const insetAmt = L.res * 0.12 + 0.0004;
    const ramp = L.res * 3;
    const boxes = L.insetBoxes;
    const insetOf = boxes.length
      ? (x: number, y: number, z: number) => {
          let m = 0;
          for (const b of boxes) {
            const sd = boxSd(x, y, z, b.min, b.max);
            const w = sd <= 0 ? 1 : sd >= ramp ? 0 : 1 - (sd / ramp) * (sd / ramp) * (3 - 2 * (sd / ramp));
            if (w > m) m = w;
          }
          return m * insetAmt;
        }
      : null;
    const res = runPass(prog, ev, L.res, L.clipMin, L.clipMax, L.excl.map((r) => {
      const band = r.band ?? L.res * 3;
      return { min: [r.min[0] + band, r.min[1] + band, r.min[2] + band] as V3, max: [r.max[0] - band, r.max[1] - band, r.max[2] - band] as V3 };
    }), insetOf, pushList, store, listStart, listEnd, projectIters);
    passes.push({ res, insetOf: insetOf ?? (() => 0) });
  }

  const tPass = performance.now();
  // ── merge passes ─────────────────────────────────────────────────────────
  let nv = 0;
  let nt = 0;
  for (const p of passes) {
    nv += p.res.pos.length / 3;
    nt += p.res.tri.length / 3;
  }
  let position = new Float32Array(nv * 3);
  let normal = new Float32Array(nv * 3);
  let color = new Float32Array(nv * 3);
  let surf = new Float32Array(nv * 4);
  let pat0 = new Float32Array(nv * 4);
  let pat1 = new Float32Array(nv * 4);
  let seam = new Float32Array(nv * 2);
  let index = new Uint32Array(nt * 3);
  const K = 6;
  let wIdx = new Int32Array(nv * K).fill(-1);
  let wVal = new Float32Array(nv * K);
  let vlist = new Int32Array(nv);
  let vpass = new Uint8Array(nv);
  const attr = new Float64Array(ATTR_COUNT);
  const bw = new Float64Array(Math.max(1, nb));
  const codeArr = store.arr;

  let vo = 0;
  let to = 0;
  passes.forEach((p, pi) => {
    const r = p.res;
    const n = r.pos.length / 3;
    for (let i = 0; i < n; i++) {
      position[(vo + i) * 3] = r.pos[i * 3];
      position[(vo + i) * 3 + 1] = r.pos[i * 3 + 1];
      position[(vo + i) * 3 + 2] = r.pos[i * 3 + 2];
      normal[(vo + i) * 3] = r.nrm[i * 3];
      normal[(vo + i) * 3 + 1] = r.nrm[i * 3 + 1];
      normal[(vo + i) * 3 + 2] = r.nrm[i * 3 + 2];
      vlist[vo + i] = r.vlist[i];
      vpass[vo + i] = pi;
    }
    for (let i = 0; i < r.tri.length; i++) index[to + i] = r.tri[i] + vo;
    vo += n;
    to += r.tri.length;
  });

  // ── per-vertex attributes, normals, skin weights ─────────────────────────
  const evalAttrs = (v: number) => {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    const li = vlist[v];
    ev.full(x, y, z, codeArr, listStart[li], listEnd[li], attr, bw);
    color[v * 3] = attr[0]; color[v * 3 + 1] = attr[1]; color[v * 3 + 2] = attr[2];
    surf[v * 4] = attr[3]; surf[v * 4 + 1] = attr[4]; surf[v * 4 + 2] = attr[5]; surf[v * 4 + 3] = attr[6];
    for (let j = 0; j < 4; j++) {
      pat0[v * 4 + j] = attr[7 + j];
      pat1[v * 4 + j] = attr[11 + j];
    }
    seam[v * 2] = attr[15];
    seam[v * 2 + 1] = attr[16];
    topK(bw, nb, wIdx, wVal, v * K, K);
  };
  for (let v = 0; v < nv; v++) evalAttrs(v);

  // ── crisp material seams: split edges that cross a colour/material boundary ──
  const rf = opts.refine;
  let refined = 0;
  /** crisp-seam vertex pairs (same position): their skin weights must stay identical */
  const twins: number[] = [];
  if (rf && (rf.levels ?? 1) > 0) {
    const thr = rf.threshold ?? 0.07;
    const minEdge2 = (rf.minEdge ?? 0.006) ** 2;
    const diffAt = (a: number, b: number) => {
      let d = 0;
      for (let j = 0; j < 3; j++) d += Math.abs(Math.sqrt(color[a * 3 + j]) - Math.sqrt(color[b * 3 + j]));
      let m = 0;
      for (let j = 0; j < 4; j++) m += Math.abs(surf[a * 4 + j] - surf[b * 4 + j]);
      for (let j = 0; j < 4; j++) m += 0.25 * (Math.abs(pat0[a * 4 + j] - pat0[b * 4 + j]) + Math.abs(pat1[a * 4 + j] - pat1[b * 4 + j]));
      return d + 0.5 * m;
    };
    const levels = rf.levels ?? 1;
    const attrDiff = (v: number, a: number) => {
      let d = 0;
      for (let j = 0; j < 3; j++) d += Math.abs(Math.sqrt(Math.max(0, attr[j])) - Math.sqrt(color[a * 3 + j]));
      for (let j = 0; j < 4; j++) d += 0.5 * Math.abs(attr[3 + j] - surf[a * 4 + j]);
      void v;
      return d;
    };
    for (let level = 0; level < levels; level++) {
      // the last level splits AT the boundary and duplicates the split vertex into two attribute
      // copies (same position/normal/weights/AO), so colour changes exactly along a smooth line
      const crisp = level === levels - 1;
      const per = crisp ? 2 : 1;
      const nt0 = index.length / 3;
      const mid = new Map<number, number>();
      const mids: number[] = []; // edge endpoints a, b per split edge (in order)
      const KEY = 4194304; // 2^22 vertices max per mesh
      for (let t = 0; t < nt0; t++) {
        for (let e = 0; e < 3; e++) {
          const a = index[t * 3 + e], b = index[t * 3 + ((e + 1) % 3)];
          const key = a < b ? a * KEY + b : b * KEY + a;
          if (mid.has(key)) continue;
          let split = -1;
          const dx = position[a * 3] - position[b * 3], dy = position[a * 3 + 1] - position[b * 3 + 1], dz = position[a * 3 + 2] - position[b * 3 + 2];
          if (dx * dx + dy * dy + dz * dz > minEdge2 && vpass[a] === vpass[b] && diffAt(a, b) > thr) {
            split = mids.length / 2;
            mids.push(a, b);
          }
          mid.set(key, split);
        }
      }
      const add = mids.length / 2;
      if (add === 0) break;
      const nv2 = nv + add * per;
      const grow = <T extends Float32Array | Int32Array | Uint8Array>(arr: T, per2: number, fill?: number): T => {
        const out = new (arr.constructor as { new (n: number): T })(nv2 * per2);
        out.set(arr);
        if (fill !== undefined) out.fill(fill as never, nv * per2);
        return out;
      };
      position = grow(position, 3);
      normal = grow(normal, 3);
      color = grow(color, 3);
      surf = grow(surf, 4);
      pat0 = grow(pat0, 4);
      pat1 = grow(pat1, 4);
      seam = grow(seam, 2);
      wIdx = grow(wIdx, K, -1);
      wVal = grow(wVal, K);
      vlist = grow(vlist, 1);
      vpass = grow(vpass, 1);
      for (let q = 0; q < add; q++) {
        const a = mids[q * 2], b = mids[q * 2 + 1];
        const v = nv + q * per;
        const li = vlist[a];
        const s0 = listStart[li], e0 = listEnd[li];
        const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
        const bx = position[b * 3], by = position[b * 3 + 1], bz = position[b * 3 + 2];
        let t = 0.5;
        if (crisp) {
          // bisection for the attribute switch along the edge
          let lo = 0, hi = 1;
          for (let it = 0; it < 5; it++) {
            const tm = (lo + hi) / 2;
            ev.full(ax + (bx - ax) * tm, ay + (by - ay) * tm, az + (bz - az) * tm, codeArr, s0, e0, attr, bw);
            if (attrDiff(v, a) < attrDiff(v, b)) lo = tm;
            else hi = tm;
          }
          t = Math.min(0.85, Math.max(0.15, (lo + hi) / 2));
        }
        let px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
        const el = Math.hypot(ax - bx, ay - by, az - bz);
        const inset = passes[vpass[a]].insetOf;
        // Newton projection onto the (inset) surface along the SDF gradient
        let gx = normal[a * 3] + normal[b * 3], gy = normal[a * 3 + 1] + normal[b * 3 + 1], gz = normal[a * 3 + 2] + normal[b * 3 + 2];
        for (let it = 0; it < 3; it++) {
          const E = Math.max(1e-4, el * 0.15);
          const f = (x: number, y: number, z: number) => ev.dist(x, y, z, codeArr, s0, e0) + inset(x, y, z);
          const d1 = f(px + E, py - E, pz - E), d2 = f(px - E, py - E, pz + E), d3 = f(px - E, py + E, pz - E), d4 = f(px + E, py + E, pz + E);
          const d0 = (d1 + d2 + d3 + d4) * 0.25;
          let hx = d1 - d2 - d3 + d4, hy = -d1 - d2 + d3 + d4, hz = -d1 + d2 - d3 + d4;
          const g2 = hx * hx + hy * hy + hz * hz;
          if (g2 < 1e-16) break;
          const sc = 1 / Math.sqrt(g2);
          hx *= sc; hy *= sc; hz *= sc;
          gx = hx; gy = hy; gz = hz;
          const st = Math.max(-el * 0.5, Math.min(el * 0.5, d0));
          px -= hx * st; py -= hy * st; pz -= hz * st;
        }
        const gl = Math.hypot(gx, gy, gz) || 1;
        for (let c = 0; c < per; c++) {
          const w = v + c;
          position[w * 3] = px; position[w * 3 + 1] = py; position[w * 3 + 2] = pz;
          normal[w * 3] = gx / gl; normal[w * 3 + 1] = gy / gl; normal[w * 3 + 2] = gz / gl;
          vlist[w] = li;
          vpass[w] = vpass[a];
        }
        evalAttrs(v);
        if (crisp) {
          // copy B shares the evaluated seam distance and skin weights; colour/material per side
          const vb = v + 1;
          seam[vb * 2] = seam[v * 2];
          seam[vb * 2 + 1] = seam[v * 2 + 1];
          for (let k = 0; k < K; k++) {
            wIdx[vb * K + k] = wIdx[v * K + k];
            wVal[vb * K + k] = wVal[v * K + k];
          }
          for (const [dst, src] of [[v, a], [vb, b]]) {
            for (let j = 0; j < 3; j++) color[dst * 3 + j] = color[src * 3 + j];
            for (let j = 0; j < 4; j++) {
              surf[dst * 4 + j] = surf[src * 4 + j];
              pat0[dst * 4 + j] = pat0[src * 4 + j];
              pat1[dst * 4 + j] = pat1[src * 4 + j];
            }
          }
          twins.push(v, vb);
        }
      }
      // conforming split of every triangle touching a split edge; with crisp splits each
      // sub-triangle takes the copy of the split vertex that faces its own corner
      const out: number[] = [];
      const pick = (q: number, toward: number) => (q < 0 ? -1 : nv + q * per + (per === 2 && mids[q * 2] !== toward ? 1 : 0));
      for (let t = 0; t < nt0; t++) {
        const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
        const kAB = a < b ? a * KEY + b : b * KEY + a;
        const kBC = b < c ? b * KEY + c : c * KEY + b;
        const kCA = c < a ? c * KEY + a : a * KEY + c;
        const qab = mid.get(kAB)!, qbc = mid.get(kBC)!, qca = mid.get(kCA)!;
        const n = (qab >= 0 ? 1 : 0) + (qbc >= 0 ? 1 : 0) + (qca >= 0 ? 1 : 0);
        if (n === 0) out.push(a, b, c);
        else if (n === 3) {
          out.push(a, pick(qab, a), pick(qca, a), b, pick(qbc, b), pick(qab, b), c, pick(qca, c), pick(qbc, c));
          out.push(pick(qab, a), pick(qbc, b), pick(qca, c));
        } else if (n === 1) {
          if (qab >= 0) out.push(a, pick(qab, a), c, pick(qab, b), b, c);
          else if (qbc >= 0) out.push(b, pick(qbc, b), a, pick(qbc, c), c, a);
          else out.push(c, pick(qca, c), b, pick(qca, a), a, b);
        } else {
          // two split edges: rotate so they are (x→y) and (y→z) around the shared corner y
          let x = a, y = b, z = c, q1 = qab, q2 = qbc;
          if (qab < 0) { x = b; y = c; z = a; q1 = qbc; q2 = qca; }
          else if (qbc < 0) { x = c; y = a; z = b; q1 = qca; q2 = qab; }
          out.push(pick(q1, y), y, pick(q2, y));
          // quad x, m1, m2, z: split along the shorter diagonal
          const m1 = pick(q1, x), m2 = pick(q2, z);
          const d1 = (position[x * 3] - position[m2 * 3]) ** 2 + (position[x * 3 + 1] - position[m2 * 3 + 1]) ** 2 + (position[x * 3 + 2] - position[m2 * 3 + 2]) ** 2;
          const d2 = (position[m1 * 3] - position[z * 3]) ** 2 + (position[m1 * 3 + 1] - position[z * 3 + 1]) ** 2 + (position[m1 * 3 + 2] - position[z * 3 + 2]) ** 2;
          if (d1 <= d2) out.push(x, m1, m2, x, m2, z);
          else out.push(x, m1, z, m1, m2, z);
        }
      }
      index = Uint32Array.from(out);
      refined += add * per;
      nv = nv2;
    }
  }
  const ao = new Float32Array(nv);

  const tAttr = performance.now();
  // ── ambient occlusion from the SDF ───────────────────────────────────────
  if (opts.ao !== false) {
    const aoDist = opts.ao?.dist ?? 0.08;
    const aoStr = opts.ao?.strength ?? 1;
    // wide lists per block list (block AABB grown by the AO reach)
    const wide = new Map<number, [number, number]>();
    const wideData: number[] = [];
    const wl: number[] = [];
    // per-pass AO reach (detail regions such as faces use a shorter reach: no dark smears)
    const passAo = levels.map((L) => aoDist * (L.aoScale ?? 1));
    const reach = Math.max(...passAo) * 1.2;
    for (let v = 0; v < nv; v++) {
      const key = vlist[v];
      if (wide.has(key)) continue;
      const b = key * 6;
      prog.cull(listBox[b] - reach, listBox[b + 1] - reach, listBox[b + 2] - reach, listBox[b + 3] + reach, listBox[b + 4] + reach, listBox[b + 5] + reach, wl);
      wide.set(key, [wideData.length, wideData.length + wl.length]);
      for (const c of wl) wideData.push(c);
    }
    const wideArr = Int32Array.from(wideData);
    void wl;
    for (let v = 0; v < nv; v++) {
      const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
      const nx = normal[v * 3], ny = normal[v * 3 + 1], nz = normal[v * 3 + 2];
      const [s, e] = wide.get(vlist[v])!;
      let occ = 0;
      let sca = 1;
      const ad = passAo[vpass[v]];
      for (let i = 1; i <= 2; i++) {
        const hh = ad * (i === 1 ? 0.35 : 1);
        const d = ev.dist(x + nx * hh, y + ny * hh, z + nz * hh, wideArr, s, e);
        occ += Math.max(0, hh - d) * sca;
        sca *= 0.6;
      }
      ao[v] = Math.max(0.45, Math.min(1, 1 - (aoStr * 1.25 * occ) / ad));
    }
  } else ao.fill(1);

  const tAO = performance.now();
  // ── smooth skin weights over the mesh (sparse), keep top 4 ─────────────────
  const iters = opts.smooth ?? 2;
  if (iters > 0 && nb > 1) {
    const adjStart = new Int32Array(nv + 1);
    for (let t = 0; t < index.length; t++) adjStart[index[t] + 1] += 2;
    for (let i = 0; i < nv; i++) adjStart[i + 1] += adjStart[i];
    const adj = new Int32Array(adjStart[nv]);
    const fill = adjStart.slice(0, nv);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      adj[fill[a]++] = b; adj[fill[a]++] = c;
      adj[fill[b]++] = a; adj[fill[b]++] = c;
      adj[fill[c]++] = a; adj[fill[c]++] = b;
    }
    const acc = new Float64Array(nb);
    const touched: number[] = [];
    let nIdx = new Int32Array(nv * K);
    let nVal = new Float32Array(nv * K);
    for (let it = 0; it < iters; it++) {
      for (let v = 0; v < nv; v++) {
        const a0 = adjStart[v], a1 = adjStart[v + 1];
        const cnt = a1 - a0;
        touched.length = 0;
        const self = cnt === 0 ? 1 : 0.5;
        for (let q = 0; q < K; q++) {
          const bi = wIdx[v * K + q];
          if (bi < 0) continue;
          if (acc[bi] === 0) touched.push(bi);
          acc[bi] += wVal[v * K + q] * self;
        }
        if (cnt > 0) {
          const w = 0.5 / cnt;
          for (let e = a0; e < a1; e++) {
            const o = adj[e] * K;
            for (let q = 0; q < K; q++) {
              const bi = wIdx[o + q];
              if (bi < 0) continue;
              if (acc[bi] === 0) touched.push(bi);
              acc[bi] += wVal[o + q] * w;
            }
          }
        }
        topKSparse(acc, touched, nIdx, nVal, v * K, K);
        for (let q = 0; q < touched.length; q++) acc[touched[q]] = 0;
      }
      let t1 = wIdx; wIdx = nIdx; nIdx = t1;
      let t2 = wVal; wVal = nVal; nVal = t2;
      void t1; void t2;
    }
  }
  for (let i = 0; i < twins.length; i += 2) {
    const a = twins[i], b = twins[i + 1];
    for (let k = 0; k < K; k++) {
      wIdx[b * K + k] = wIdx[a * K + k];
      wVal[b * K + k] = wVal[a * K + k];
    }
  }
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    // entries are sorted descending; keep 4, drop tiny, renormalise
    let s = 0;
    for (let q = 0; q < 4; q++) {
      const w = wIdx[v * K + q] >= 0 ? wVal[v * K + q] : 0;
      const keep = w >= 0.02 ? w : 0;
      skinIndex[v * 4 + q] = Math.max(0, wIdx[v * K + q]);
      skinWeight[v * 4 + q] = keep;
      s += keep;
    }
    if (s <= 0) {
      skinWeight[v * 4] = 1;
      s = 1;
    }
    for (let q = 0; q < 4; q++) skinWeight[v * 4 + q] /= s;
  }

  const tEnd = performance.now();
  if ((globalThis as { __kitProfile?: boolean }).__kitProfile) console.log(`[kit] mesh passes ${(tPass - t0).toFixed(1)} attr+refine(${refined}v) ${(tAttr - tPass).toFixed(1)} ao ${(tAO - tAttr).toFixed(1)} weights ${(tEnd - tAO).toFixed(1)} ms`);
  return {
    position,
    normal,
    color,
    surf,
    pat0,
    pat1,
    seam,
    ao,
    skinIndex,
    skinWeight,
    index,
    vertexCount: nv,
    triCount: index.length / 3,
    passTris: passes.map((p) => p.res.tri.length / 3),
    ms: performance.now() - t0,
  };
}

function runPass(
  prog: SdfProgram,
  ev: ReturnType<typeof makeEvaluator>,
  h: number,
  clipMin: V3,
  clipMax: V3,
  excl: { min: V3; max: V3 }[],
  insetOf: ((x: number, y: number, z: number) => number) | null,
  pushList: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => number,
  store: { arr: Int32Array; len: number },
  listStart: number[],
  listEnd: number[],
  projectIters: number,
): PassResult {
  const pad = 2 * h;
  const ox = clipMin[0] - pad, oy = clipMin[1] - pad, oz = clipMin[2] - pad;
  const nx = Math.max(2, Math.ceil((clipMax[0] - clipMin[0] + 2 * pad) / h));
  const ny = Math.max(2, Math.ceil((clipMax[1] - clipMin[1] + 2 * pad) / h));
  const nz = Math.max(2, Math.ceil((clipMax[2] - clipMin[2] + 2 * pad) / h));
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const vals = new Float32Array(NX * NY * NZ);
  const done = new Uint8Array(NX * NY * NZ);
  const bnx = Math.ceil(nx / BLOCK), bny = Math.ceil(ny / BLOCK), bnz = Math.ceil(nz / BLOCK);
  const state = new Int8Array(bnx * bny * bnz); // 0 unknown, 1 active(queued), 2 far
  const blockList = new Int32Array(bnx * bny * bnz).fill(-1);
  const halfDiag = (Math.sqrt(3) * BLOCK * h) / 2;
  const margin = halfDiag * 1.35 + prog.maxNoise * 1.5 + h;
  const queue: number[] = [];
  const codeView = () => store.arr; // live (may be reallocated as lists are added)

  const ensureList = (bi: number, bx: number, by: number, bz: number) => {
    if (blockList[bi] >= 0) return blockList[bi];
    const x0 = ox + bx * BLOCK * h, y0 = oy + by * BLOCK * h, z0 = oz + bz * BLOCK * h;
    const x1 = x0 + BLOCK * h, y1 = y0 + BLOCK * h, z1 = z0 + BLOCK * h;
    const m = 1.6 * h;
    blockList[bi] = pushList(x0 - m, y0 - m, z0 - m, x1 + m, y1 + m, z1 + m);
    return blockList[bi];
  };

  // classify blocks
  const tmp: number[] = [];
  let tmpI = new Int32Array(256);
  for (let bz = 0; bz < bnz; bz++)
    for (let by = 0; by < bny; by++)
      for (let bx = 0; bx < bnx; bx++) {
        const bi = bx + bnx * (by + bny * bz);
        const x0 = ox + bx * BLOCK * h, y0 = oy + by * BLOCK * h, z0 = oz + bz * BLOCK * h;
        const x1 = x0 + BLOCK * h, y1 = y0 + BLOCK * h, z1 = z0 + BLOCK * h;
        const unions = prog.cull(x0 - h, y0 - h, z0 - h, x1 + h, y1 + h, z1 + h, tmp);
        if (unions === 0) {
          state[bi] = 2;
          continue;
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
        if (tmp.length > tmpI.length) tmpI = new Int32Array(tmp.length * 2);
        for (let q = 0; q < tmp.length; q++) tmpI[q] = tmp[q];
        let d = ev.dist(cx, cy, cz, tmpI, 0, tmp.length);
        if (insetOf) d += insetOf(cx, cy, cz);
        if (Math.abs(d) > margin) state[bi] = 2;
        else {
          state[bi] = 1;
          queue.push(bi);
        }
      }

  // Lipschitz-safe row skipping: a sample with |d| = D proves every sample within
  // (D - √3·h - noise)/1.3 has the same sign and no crossing in its cells, so we only need its sign.
  const skipMargin = Math.sqrt(3) * h + prog.maxNoise * 1.5;
  const evalBlock = (bx: number, by: number, bz: number, li: number) => {
    const code = codeView();
    const s = listStart[li], e = listEnd[li];
    const i0 = bx * BLOCK, j0 = by * BLOCK, k0 = bz * BLOCK;
    const i1 = Math.min(i0 + BLOCK, nx), j1 = Math.min(j0 + BLOCK, ny), k1 = Math.min(k0 + BLOCK, nz);
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++) {
        const row = NX * (j + NY * k);
        const y = oy + j * h, z = oz + k * h;
        let i = i0;
        while (i <= i1) {
          const si = i + row;
          let d: number;
          if (done[si] === 1) d = vals[si];
          else {
            const x = ox + i * h;
            d = ev.dist(x, y, z, code, s, e);
            if (insetOf) d += insetOf(x, y, z);
            vals[si] = d;
            done[si] = 1;
          }
          const ad = d < 0 ? -d : d;
          const m = Math.floor((ad - skipMargin) / (h * 1.3));
          if (m >= 1) {
            const sg = d < 0 ? -1 : 1;
            const last = Math.min(i + m, i1);
            for (let q = i + 1; q <= last; q++) {
              const sq = q + row;
              if (done[sq] === 0) {
                vals[sq] = sg * (ad - (q - i) * h * 1.3);
                done[sq] = 2; // estimated (sign-safe)
              }
            }
            i = last + 1;
          } else i++;
        }
      }
    return [i0, j0, k0, i1, j1, k1];
  };

  const active: number[] = [];
  while (queue.length) {
    const bi = queue.pop()!;
    active.push(bi);
    const bx = bi % bnx, by = Math.floor(bi / bnx) % bny, bz = Math.floor(bi / (bnx * bny));
    const li = ensureList(bi, bx, by, bz);
    const [i0, j0, k0, i1, j1, k1] = evalBlock(bx, by, bz, li);
    // flood: if the surface touches a face, activate the neighbour across it
    for (let fi = 0; fi < 6; fi++) {
      const axis = fi >> 1;
      const fixed = axis === 0 ? (fi & 1 ? i1 : i0) : axis === 1 ? (fi & 1 ? j1 : j0) : fi & 1 ? k1 : k0;
      const dir = fi & 1 ? 1 : -1;
      let neg = false, posi = false, near = false;
      if (axis === 0) {
        for (let k = k0; k <= k1 && !near && !(neg && posi); k++)
          for (let j = j0; j <= j1; j++) {
            const v = vals[fixed + NX * (j + NY * k)];
            if (v < 0) neg = true; else posi = true;
            if (Math.abs(v) < h * 1.5) near = true;
          }
      } else if (axis === 1) {
        for (let k = k0; k <= k1 && !near && !(neg && posi); k++)
          for (let i = i0; i <= i1; i++) {
            const v = vals[i + NX * (fixed + NY * k)];
            if (v < 0) neg = true; else posi = true;
            if (Math.abs(v) < h * 1.5) near = true;
          }
      } else {
        for (let j = j0; j <= j1 && !near && !(neg && posi); j++)
          for (let i = i0; i <= i1; i++) {
            const v = vals[i + NX * (j + NY * fixed)];
            if (v < 0) neg = true; else posi = true;
            if (Math.abs(v) < h * 1.5) near = true;
          }
      }
      if (!(near || (neg && posi))) continue;
      let nbx = bx, nby = by, nbz = bz;
      const sgn = axis === 0 ? (fixed === i0 ? -1 : 1) : axis === 1 ? (fixed === j0 ? -1 : 1) : fixed === k0 ? -1 : 1;
      void dir;
      if (axis === 0) nbx += sgn;
      else if (axis === 1) nby += sgn;
      else nbz += sgn;
      if (nbx < 0 || nby < 0 || nbz < 0 || nbx >= bnx || nby >= bny || nbz >= bnz) continue;
      const nbi = nbx + bnx * (nby + bny * nbz);
      if (state[nbi] !== 1) {
        state[nbi] = 1;
        queue.push(nbi);
      }
    }
  }

  // ── surface nets vertices ────────────────────────────────────────────────
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const nrm: number[] = [];
  const vlist: number[] = [];
  const cornerOff = [0, 1, NX, NX + 1, NX * NY, NX * NY + 1, NX * NY + NX, NX * NY + NX + 1];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cornerXYZ = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const cv = new Float64Array(8);
  const EF = Int32Array.from(EDGES.flat());
  const CX = Int32Array.from(cornerXYZ.map((c) => c[0]));
  const CY = Int32Array.from(cornerXYZ.map((c) => c[1]));
  const CZ = Int32Array.from(cornerXYZ.map((c) => c[2]));
  const isExcluded = (x: number, y: number, z: number) => {
    for (const b of excl) if (x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]) return true;
    return false;
  };
  const inClip = (x: number, y: number, z: number) =>
    x >= clipMin[0] && x <= clipMax[0] && y >= clipMin[1] && y <= clipMax[1] && z >= clipMin[2] && z <= clipMax[2];

  for (const bi of active) {
    const bx = bi % bnx, by = Math.floor(bi / bnx) % bny, bz = Math.floor(bi / (bnx * bny));
    const li = blockList[bi];
    const i0 = bx * BLOCK, j0 = by * BLOCK, k0 = bz * BLOCK;
    const i1 = Math.min(i0 + BLOCK, nx), j1 = Math.min(j0 + BLOCK, ny), k1 = Math.min(k0 + BLOCK, nz);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const base = i + NX * (j + NY * k);
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const v = vals[base + cornerOff[c]];
            cv[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          const cx = ox + (i + 0.5) * h, cy = oy + (j + 0.5) * h, cz = oz + (k + 0.5) * h;
          if (!inClip(cx, cy, cz) || isExcluded(cx, cy, cz)) continue;
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (let ei = 0; ei < 24; ei += 2) {
            const a = EF[ei], b = EF[ei + 1];
            const va = cv[a], vb = cv[b];
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            sx += CX[a] + (CX[b] - CX[a]) * t;
            sy += CY[a] + (CY[b] - CY[a]) * t;
            sz += CZ[a] + (CZ[b] - CZ[a]) * t;
            cnt++;
          }
          let px = ox + (i + sx / cnt) * h, py = oy + (j + sy / cnt) * h, pz = oz + (k + sz / cnt) * h;
          // Newton projection onto the (inset) surface
          const s = listStart[li], e = listEnd[li];
          const code = store.arr;
          let ngx = 0, ngy = 1, ngz = 0;
          for (let it = 0; it < Math.max(1, projectIters); it++) {
            const E = h * 0.2;
            const d1 = ev.dist(px + E, py - E, pz - E, code, s, e) + (insetOf ? insetOf(px + E, py - E, pz - E) : 0);
            const d2 = ev.dist(px - E, py - E, pz + E, code, s, e) + (insetOf ? insetOf(px - E, py - E, pz + E) : 0);
            const d3 = ev.dist(px - E, py + E, pz - E, code, s, e) + (insetOf ? insetOf(px - E, py + E, pz - E) : 0);
            const d4 = ev.dist(px + E, py + E, pz + E, code, s, e) + (insetOf ? insetOf(px + E, py + E, pz + E) : 0);
            const d0 = (d1 + d2 + d3 + d4) * 0.25;
            let gx = d1 - d2 - d3 + d4, gy = -d1 - d2 + d3 + d4, gz = -d1 + d2 - d3 + d4;
            const g2 = gx * gx + gy * gy + gz * gz;
            if (g2 < 1e-14) break;
            const sc = 1 / Math.sqrt(g2);
            gx *= sc; gy *= sc; gz *= sc;
            ngx = gx; ngy = gy; ngz = gz;
            if (projectIters === 0) break;
            let step = d0;
            const maxStep = h * 0.6;
            if (step > maxStep) step = maxStep;
            else if (step < -maxStep) step = -maxStep;
            px -= gx * step;
            py -= gy * step;
            pz -= gz * step;
          }
          cellVert[i + nx * (j + ny * k)] = pos.length / 3;
          pos.push(px, py, pz);
          nrm.push(ngx, ngy, ngz);
          vlist.push(li);
        }
  }

  // ── quads ────────────────────────────────────────────────────────────────
  const tri: number[] = [];
  const P = pos;
  const emit = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (!flip) {
      if (dac <= dbd) tri.push(a, b, c, a, c, d);
      else tri.push(a, b, d, b, c, d);
    } else {
      if (dac <= dbd) tri.push(a, c, b, a, d, c);
      else tri.push(a, d, b, b, d, c);
    }
  };
  const cell = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : cellVert[i + nx * (j + ny * k)]);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v0 = cellVert[i + nx * (j + ny * k)];
        if (v0 < 0) continue;
        const s0 = vals[i + NX * (j + NY * k)] < 0;
        // edge along +X from sample (i,j,k)... uses cells sharing the edge at sample (i+1, j, k)?
        // Standard: the edge from sample (i+1,j+1,k+1) towards -axis is shared by this cell and the
        // three cells at -1 offsets. We use the cell's max corner sample.
        const sx = i + 1, sy = j + 1, sz = k + 1;
        if (sx >= NX || sy >= NY || sz >= NZ) continue;
        const sMax = vals[sx + NX * (sy + NY * sz)] < 0;
        void s0;
        // edge along X: samples (i, sy, sz) → (sx, sy, sz); cells (i,j,k),(i,j+1,k),(i,j+1,k+1),(i,j,k+1)
        {
          const sA = vals[i + NX * (sy + NY * sz)] < 0;
          if (sA !== sMax) emit(v0, cell(i, j + 1, k), cell(i, j + 1, k + 1), cell(i, j, k + 1), !sA);
        }
        // edge along Y: samples (sx, j, sz) → (sx, sy, sz); cells (i,j,k),(i,j,k+1),(i+1,j,k+1),(i+1,j,k)
        {
          const sA = vals[sx + NX * (j + NY * sz)] < 0;
          if (sA !== sMax) emit(v0, cell(i, j, k + 1), cell(i + 1, j, k + 1), cell(i + 1, j, k), !sA);
        }
        // edge along Z: samples (sx, sy, k) → (sx, sy, sz); cells (i,j,k),(i+1,j,k),(i+1,j+1,k),(i,j+1,k)
        {
          const sA = vals[sx + NX * (sy + NY * k)] < 0;
          if (sA !== sMax) emit(v0, cell(i + 1, j, k), cell(i + 1, j + 1, k), cell(i, j + 1, k), !sA);
        }
      }
  return { pos, nrm, vlist, tri };
}

/** write the K largest entries of a dense weight vector (sorted, descending) */
function topK(w: Float64Array, n: number, idx: Int32Array, val: Float32Array, o: number, K: number) {
  for (let q = 0; q < K; q++) {
    idx[o + q] = -1;
    val[o + q] = 0;
  }
  let sum = 0;
  for (let j = 0; j < n; j++) sum += w[j];
  if (sum <= 1e-9) {
    idx[o] = 0;
    val[o] = 1;
    return;
  }
  for (let j = 0; j < n; j++) {
    const x = w[j] / sum;
    if (x <= 1e-4 || x <= val[o + K - 1]) continue;
    let p = K - 1;
    while (p > 0 && x > val[o + p - 1]) {
      val[o + p] = val[o + p - 1];
      idx[o + p] = idx[o + p - 1];
      p--;
    }
    val[o + p] = x;
    idx[o + p] = j;
  }
}
function topKSparse(acc: Float64Array, touched: number[], idx: Int32Array, val: Float32Array, o: number, K: number) {
  for (let q = 0; q < K; q++) {
    idx[o + q] = -1;
    val[o + q] = 0;
  }
  let sum = 0;
  for (let t = 0; t < touched.length; t++) sum += acc[touched[t]];
  if (sum <= 1e-9) {
    idx[o] = 0;
    val[o] = 1;
    return;
  }
  for (let t = 0; t < touched.length; t++) {
    const j = touched[t];
    const x = acc[j] / sum;
    if (x <= 1e-4 || x <= val[o + K - 1]) continue;
    let p = K - 1;
    while (p > 0 && x > val[o + p - 1]) {
      val[o + p] = val[o + p - 1];
      idx[o + p] = idx[o + p - 1];
      p--;
    }
    val[o + p] = x;
    idx[o + p] = j;
  }
}
