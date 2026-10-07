// Usage: deno task replay -- <scenario-name>
// Runs an existing scenario's steps exactly as captureScenario() would
// for the regression suite — reusing that code rather than having the
// agent re-derive the interaction via raw playwright-mcp calls, which
// risked "replay" and "the regression suite" behaving subtly differently
// for what's supposed to be the same scenario.
//
// Note: unlike checkpoint.ts/sweep-param.ts, this launches its OWN browser
// (matching captureScenario's existing behavior) rather than attaching to
// the shared live tab — that's consistent with how the regression suite
// already runs scenarios headlessly. If the intent is specifically to
// replay something in the shared tab the human is watching, that's a
// different operation than what this script does; say so if that
// distinction matters for what's being asked.
import { captureScenario } from "../test/visual/lib/capture.ts";
import type { Scenario } from "../test/visual/lib/types.ts";

const name = Deno.args[0];
if (!name) {
  console.error("usage: replay.ts <scenario-name>");
  Deno.exit(1);
}

const path = `test/visual/scenarios/${name}.json`;
let scenario: Scenario;
try {
  scenario = JSON.parse(await Deno.readTextFile(path));
} catch {
  console.error(`No scenario found at ${path}.`);
  Deno.exit(1);
}

const baseUrl = Deno.env.get("VISUAL_TEST_BASE_URL") ?? "http://localhost:3000";
const { shots } = await captureScenario(baseUrl, scenario);

const dir = ".parallax/replays";
await Deno.mkdir(dir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const [keyframe, png] of Object.entries(shots)) {
  await Deno.writeFile(`${dir}/${timestamp}-${name}-${keyframe}.png`, png);
}
console.log(
  `replayed "${name}" — ${
    Object.keys(shots).length
  } keyframe(s) written to ${dir}/`,
);
