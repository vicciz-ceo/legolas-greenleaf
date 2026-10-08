/**
 * Kit — meshing worker. Receives a compiled SdfProgram (plain typed arrays) + MeshOpts, runs the
 * pure typed-array mesher and transfers the MeshData buffers back. Spawned by `workers.ts`.
 */
import { SdfProgram, type SdfProgramData } from './sdf';
import { meshSdf, type MeshOpts } from './mesher';

interface Job {
  id: number;
  prog: SdfProgramData;
  opts: MeshOpts;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, prog, opts } = e.data;
  try {
    const d = meshSdf(SdfProgram.fromData(prog), opts);
    const transfer: Transferable[] = [d.position.buffer, d.normal.buffer, d.color.buffer, d.surf.buffer, d.pat0.buffer, d.pat1.buffer, d.ao.buffer, d.skinIndex.buffer, d.skinWeight.buffer, d.index.buffer];
    ctx.postMessage({ id, data: d }, transfer);
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
};
