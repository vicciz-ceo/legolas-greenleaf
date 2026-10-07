// Bundles the mechanical steps of /checkpoint into one atomic call: scene
// summary + a short console capture window + screenshot, written as one
// unit. This does NOT write the human-readable summary (step 5 in
// checkpoint.md) — that still needs the agent's judgment about what
// changed and why, since that's genuinely not scriptable.
import {
  attachToLiveScene,
  collectConsoleMessages,
  getSceneSummary,
} from "./lib/live-scene.ts";
import {
  getRendererMemorySummary,
  getRendererPerfSummary,
} from "../lib/renderer-info.ts";

const label = Deno.args[0] ?? "unlabeled";
const CONSOLE_WINDOW_MS = 300;

const { browser, page } = await attachToLiveScene();

const messages = collectConsoleMessages(page);
await new Promise((r) => setTimeout(r, CONSOLE_WINDOW_MS));

const scene = await getSceneSummary(page);
const memory = await getRendererMemorySummary(page);
const perf = await getRendererPerfSummary(page);
const screenshotBuf = await page.screenshot();

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = ".parallax/checkpoints";
await Deno.mkdir(dir, { recursive: true });

const base = `${timestamp}-${label}`;
await Deno.writeFile(`${dir}/${base}.png`, screenshotBuf);
await Deno.writeTextFile(
  `${dir}/${base}.json`,
  JSON.stringify(
    { timestamp, label, scene, console: messages, memory, perf },
    null,
    2,
  ),
);

console.log(`checkpoint written: ${dir}/${base}.json (+ .png)`);
console.log(
  `scene objects: ${scene.length}, console messages: ${messages.length}`,
);
console.log(
  memory
    ? `memory: ${memory.geometries} geometries, ${memory.textures} textures`
    : `memory: skipped (window.__renderer__ not exposed — optional, see /checkpoint prerequisites)`,
);
console.log(
  perf
    ? `perf: ${perf.calls} draw calls, ${perf.triangles} triangles`
    : `perf: skipped (window.__renderer__ not exposed — optional, see /checkpoint prerequisites)`,
);

await browser.close(); // closes the CDP connection, NOT the actual browser tab
