// Usage: deno task diff-checkpoints -- [label]
// Mechanical half of /diff: finds the most recent checkpoint matching
// `label`, runs a fresh one, and diffs both (scene JSON, console, pixels).
// Does NOT decide what the diff *means* or write the human-readable
// report — that's still the agent's job per diff.md steps 4-6.
import { Buffer } from "node:buffer";
import { diffPngs } from "../test/visual/lib/diff.ts";
import type { DiffRecord } from "./lib/report.ts";

const label = Deno.args[0];
const dir = ".parallax/checkpoints";

async function findLatest(matchLabel?: string): Promise<string | null> {
  const entries: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (
      e.name.endsWith(".json") &&
      (!matchLabel || e.name.includes(`-${matchLabel}.json`))
    ) {
      entries.push(e.name);
    }
  }
  entries.sort(); // ISO timestamps in the filename sort chronologically
  return entries.length ? entries[entries.length - 1] : null;
}

const priorName = await findLatest(label);
if (!priorName) {
  console.log(
    `No prior checkpoint found${
      label ? ` for label "${label}"` : ""
    } — nothing to diff against.`,
  );
  Deno.exit(0);
}

// Run a fresh checkpoint via the same script diff.md's step 2 already calls.
// --allow-all, not a scoped flag: playwright-core's internal isWsl() check
// does existsSync() on /proc/sys/fs/binfmt_misc/..., which Deno only
// satisfies via unscoped --allow-all — confirmed empirically that no
// combination of scoped flags (including --allow-read targeted at the
// exact paths named in the error) works around it, same conclusion
// extended-tests.yml/release.yml's Lane 2 invocation already reached.
// Found by actually running this against a real project during Unit 2's
// live smoke test; the previously scoped flag list (--allow-net/
// --allow-read/--allow-write/--allow-env) failed with a NotCapable error
// before ever reaching checkpoint.ts's own logic — a pre-existing gap
// this fixes, not a Unit 2 regression. Not a real privilege widening in
// practice: scaffold/deno-tasks.json's "diff-checkpoints" task already
// runs this whole script with --allow-all, so this subprocess's flags
// were never the actual boundary — the parent already had full access.
const fresh = await new Deno.Command("deno", {
  args: [
    "run",
    "--allow-all",
    "scripts/checkpoint.ts",
    label ?? "diff-current",
  ],
}).output();
if (!fresh.success) {
  console.error(
    "checkpoint.ts failed while capturing the fresh state for comparison.",
  );
  Deno.exit(1);
}

const priorBase = priorName.replace(/\.json$/, "");
const priorData = JSON.parse(await Deno.readTextFile(`${dir}/${priorName}`));
const priorPng = await Deno.readFile(`${dir}/${priorBase}.png`);

const freshName = await findLatest(label);
const freshBase = freshName!.replace(/\.json$/, "");
const freshData = JSON.parse(await Deno.readTextFile(`${dir}/${freshName}`));
const freshPng = await Deno.readFile(`${dir}/${freshBase}.png`);

const { ratio, diffPng } = diffPngs(priorPng, freshPng);

const newConsoleMessages = freshData.console.filter((m: string) =>
  !priorData.console.includes(m)
);

// Both sides need a memory field for a delta to mean anything — an older
// checkpoint predating this feature, or a project that's never exposed
// window.__renderer__, simply omits `memory` here rather than reporting
// a misleading delta against a missing baseline.
const memory = (priorData.memory && freshData.memory)
  ? {
    geometriesDelta: freshData.memory.geometries - priorData.memory.geometries,
    texturesDelta: freshData.memory.textures - priorData.memory.textures,
  }
  : null;

// Same graceful-absence handling as memory above — an older checkpoint
// predating Unit 2 simply omits `perf` here.
const perf = (priorData.perf && freshData.perf)
  ? {
    callsDelta: freshData.perf.calls - priorData.perf.calls,
    trianglesDelta: freshData.perf.triangles - priorData.perf.triangles,
    pointsDelta: freshData.perf.points - priorData.perf.points,
    linesDelta: freshData.perf.lines - priorData.perf.lines,
  }
  : null;

const summary = {
  compared: { prior: priorBase, fresh: freshBase },
  pixelDiffRatio: ratio,
  newConsoleMessages,
  sceneObjectCountPrior: priorData.scene.length,
  sceneObjectCountFresh: freshData.scene.length,
  memory,
  perf,
};

console.log(JSON.stringify(summary, null, 2));

// Persist a fully self-contained record so /export-report has something
// durable to render later without re-deriving anything — see Unit 6's
// functional design. Base64-embeds all three images so the diff record
// itself never needs to go looking for the checkpoint PNGs again.
const diffsDir = ".parallax/diffs";
await Deno.mkdir(diffsDir, { recursive: true });

const timestamp = new Date().toISOString();
const diffLabel = label ?? "diff-current";
const record: DiffRecord = {
  timestamp,
  label: diffLabel,
  ...summary,
  priorScreenshotBase64: Buffer.from(priorPng).toString("base64"),
  freshScreenshotBase64: Buffer.from(freshPng).toString("base64"),
  diffOverlayBase64: Buffer.from(diffPng).toString("base64"),
};

const safeStamp = timestamp.replace(/[:.]/g, "-");
const recordPath = `${diffsDir}/${safeStamp}-${diffLabel}.json`;
await Deno.writeTextFile(recordPath, JSON.stringify(record, null, 2));

console.log(`diff record written: ${recordPath}`);
