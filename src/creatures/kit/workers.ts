/**
 * Kit — meshing worker pool.
 *
 * `meshSdfAsync(prog, opts)` runs the mesher (the pure typed-array part: sampling, surface nets,
 * attributes, AO, weight smoothing) in a pool of module workers, so loading screens can build
 * many creature kinds in parallel across cores. Everything around it (sculpting, gear, hair,
 * GPU geometry) stays on the main thread.
 *
 * Fallback: when workers are unavailable (node benchmarks, CSP, a worker that fails to load) the
 * job runs synchronously on the main thread after a macrotask yield, with identical results
 * (the mesher is deterministic and the noise tables are seeded the same way in every realm).
 */
import { meshSdf, type MeshData, type MeshOpts } from './mesher';
import type { SdfProgram } from './sdf';

interface Pending {
  id: number;
  prog: SdfProgram;
  opts: MeshOpts;
  resolve: (d: MeshData) => void;
  reject: (e: unknown) => void;
}

interface Slot {
  w: Worker;
  busy: Pending | null;
}

let pool: Slot[] | null = null;
let disabled = typeof Worker === 'undefined';
let nextId = 1;
const queue: Pending[] = [];

/** number of worker threads the pool uses (0 = synchronous fallback) */
export function meshWorkerCount(): number {
  if (disabled) return 0;
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  // leave one core for the main thread / renderer; at least 2 so builds overlap
  return Math.max(2, Math.min(6, hc - 1));
}

function runSync(p: Pending) {
  setTimeout(() => {
    try {
      p.resolve(meshSdf(p.prog, p.opts));
    } catch (e) {
      p.reject(e);
    }
  }, 0);
}

function fail(reason: unknown) {
  if (disabled) return;
  console.warn('[kit] mesh workers unavailable, meshing on the main thread:', reason);
  disabled = true;
  const orphans: Pending[] = [];
  for (const s of pool ?? []) {
    if (s.busy) orphans.push(s.busy);
    s.w.terminate();
  }
  pool = null;
  orphans.push(...queue.splice(0));
  for (const p of orphans) runSync(p);
}

function ensurePool(): Slot[] | null {
  if (disabled) return null;
  if (pool) return pool;
  try {
    pool = [];
    const n = meshWorkerCount();
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module', name: `kit-mesh-${i}` });
      const slot: Slot = { w, busy: null };
      w.onmessage = (e: MessageEvent<{ id: number; data?: MeshData; error?: string }>) => {
        const job = slot.busy;
        slot.busy = null;
        if (job && job.id === e.data.id) {
          if (e.data.data) job.resolve(e.data.data);
          else {
            // a mesher exception is a real error (same code would throw on the main thread)
            job.reject(new Error(e.data.error ?? 'mesh worker error'));
          }
        }
        pump();
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        fail(e.message || 'worker error');
      };
      pool.push(slot);
    }
    return pool;
  } catch (e) {
    fail(e);
    return null;
  }
}

function pump() {
  const p = pool;
  if (!p) return;
  for (const slot of p) {
    if (slot.busy) continue;
    const job = queue.shift();
    if (!job) return;
    slot.busy = job;
    try {
      slot.w.postMessage({ id: job.id, prog: job.prog.toData(), opts: job.opts });
    } catch (e) {
      slot.busy = null;
      queue.unshift(job);
      fail(e);
      return;
    }
  }
}

/** mesh a compiled program in the worker pool (or synchronously when workers are unavailable) */
export function meshSdfAsync(prog: SdfProgram, opts: MeshOpts): Promise<MeshData> {
  return new Promise<MeshData>((resolve, reject) => {
    const job: Pending = { id: nextId++, prog, opts, resolve, reject };
    if (!ensurePool()) {
      runSync(job);
      return;
    }
    queue.push(job);
    pump();
  });
}

/** stop the workers (they are re-created on demand) */
export function terminateMeshWorkers() {
  const orphans: Pending[] = [];
  for (const s of pool ?? []) {
    if (s.busy) orphans.push(s.busy);
    s.w.terminate();
  }
  pool = null;
  orphans.push(...queue.splice(0));
  for (const p of orphans) runSync(p);
}
