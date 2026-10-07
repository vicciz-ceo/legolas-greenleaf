// Mechanical half of /export-report: finds the most recently persisted
// diff record for `label` (written by diff-checkpoints.ts) and renders it
// to a self-contained HTML file. Deliberately does NOT trigger a fresh
// checkpoint/diff itself — single responsibility, matches every other
// command doing exactly one thing. Run /diff <label> first if nothing's
// there yet.
import type { DiffRecord } from "./lib/report.ts";
import { buildReportHtml } from "./lib/report.ts";

const label = Deno.args[0];
const diffsDir = ".parallax/diffs";
const reportsDir = ".parallax/reports";

async function findLatestDiff(matchLabel?: string): Promise<string | null> {
  const entries: string[] = [];
  try {
    for await (const e of Deno.readDir(diffsDir)) {
      if (
        e.name.endsWith(".json") &&
        (!matchLabel || e.name.includes(`-${matchLabel}.json`))
      ) {
        entries.push(e.name);
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    return null;
  }
  entries.sort(); // ISO timestamps in the filename sort chronologically
  return entries.length ? entries[entries.length - 1] : null;
}

const diffName = await findLatestDiff(label);
if (!diffName) {
  console.log(
    `No persisted diff found${
      label ? ` for label "${label}"` : ""
    } — run \`/diff${label ? ` ${label}` : ""}\` first.`,
  );
  Deno.exit(0);
}

const record: DiffRecord = JSON.parse(
  await Deno.readTextFile(`${diffsDir}/${diffName}`),
);

const html = buildReportHtml(record);

await Deno.mkdir(reportsDir, { recursive: true });
const base = diffName.replace(/\.json$/, "");
const reportPath = `${reportsDir}/${base}.html`;
await Deno.writeTextFile(reportPath, html);

console.log(`report written: ${reportPath}`);
