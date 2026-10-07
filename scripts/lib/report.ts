// Pure HTML-generation logic for /export-report, deliberately separated
// from export-report.ts's file I/O — no DOM/GPU/timer dependency, so
// this gets direct Lane 1 unit tests instead of a browser-dependent
// Lane 2 one. Mirrors the memory-gate.ts pattern (PR #30's review):
// extract the decision/generation logic from the I/O-heavy caller.

export interface MemoryDelta {
  geometriesDelta: number;
  texturesDelta: number;
}

export interface PerfDelta {
  callsDelta: number;
  trianglesDelta: number;
  pointsDelta: number;
  linesDelta: number;
}

// Everything a report needs to render, fully self-contained — including
// the three images as base64, so export-report.ts never has to go
// looking for separate checkpoint files. Written to disk by
// diff-checkpoints.ts as `.parallax/diffs/<timestamp>-<label>.json`.
export interface DiffRecord {
  timestamp: string;
  label: string;
  compared: { prior: string; fresh: string };
  pixelDiffRatio: number;
  newConsoleMessages: string[];
  sceneObjectCountPrior: number;
  sceneObjectCountFresh: number;
  memory: MemoryDelta | null;
  perf: PerfDelta | null;
  priorScreenshotBase64: string;
  freshScreenshotBase64: string;
  diffOverlayBase64: string;
}

// Console messages, labels, and checkpoint names all come from the
// target project's own runtime output, not something this plugin
// controls — unescaped interpolation into the report would be a real,
// if low-stakes and local-file-only, injection risk.
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDelta(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function renderMemorySection(memory: MemoryDelta | null): string {
  if (!memory) return "";
  return `
    <section>
      <h2>Memory</h2>
      <table>
        <tr><th>Geometries</th><td>${
    formatDelta(memory.geometriesDelta)
  }</td></tr>
        <tr><th>Textures</th><td>${formatDelta(memory.texturesDelta)}</td></tr>
      </table>
    </section>`;
}

function renderPerfSection(perf: PerfDelta | null): string {
  if (!perf) return "";
  return `
    <section>
      <h2>Perf</h2>
      <table>
        <tr><th>Draw calls</th><td>${formatDelta(perf.callsDelta)}</td></tr>
        <tr><th>Triangles</th><td>${formatDelta(perf.trianglesDelta)}</td></tr>
        <tr><th>Points</th><td>${formatDelta(perf.pointsDelta)}</td></tr>
        <tr><th>Lines</th><td>${formatDelta(perf.linesDelta)}</td></tr>
      </table>
    </section>`;
}

function renderConsoleSection(messages: string[]): string {
  if (messages.length === 0) {
    return `<section><h2>Console</h2><p class="muted">No new console messages.</p></section>`;
  }
  const items = messages.map((m) => `<li>${escapeHtml(m)}</li>`).join(
    "\n        ",
  );
  return `
    <section>
      <h2>Console — ${messages.length} new message${
    messages.length === 1 ? "" : "s"
  }</h2>
      <ul class="console">
        ${items}
      </ul>
    </section>`;
}

export function buildReportHtml(record: DiffRecord): string {
  const title = `Parallax report — ${escapeHtml(record.label)}`;
  const pct = (record.pixelDiffRatio * 100).toFixed(2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  .meta { color: #666; font-size: .9rem; }
  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1rem; }
  .shots figure { margin: 0; }
  .shots img { width: 100%; border: 1px solid #ddd; border-radius: 4px; display: block; }
  .shots figcaption { text-align: center; font-size: .85rem; color: #666; margin-top: .25rem; }
  table { border-collapse: collapse; margin-top: .5rem; }
  th, td { text-align: left; padding: .3rem .75rem .3rem 0; }
  th { font-weight: 600; color: #444; }
  .console { font-family: ui-monospace, monospace; font-size: .85rem; background: #f6f6f6; border-radius: 4px; padding: .75rem 1rem; list-style: none; }
  .console li { margin: .15rem 0; }
  .muted { color: #888; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e6e6e6; }
    h2 { border-bottom-color: #333; }
    .meta, th, .muted { color: #999; }
    .shots img { border-color: #333; }
    .console { background: #262626; }
  }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">Prior: ${escapeHtml(record.compared.prior)} &middot; Fresh: ${
    escapeHtml(record.compared.fresh)
  } &middot; Exported ${escapeHtml(record.timestamp)}</p>

<section>
  <h2>Screenshots — ${pct}% pixels changed</h2>
  <div class="shots">
    <figure><img src="data:image/png;base64,${record.priorScreenshotBase64}" alt="Before"><figcaption>Before</figcaption></figure>
    <figure><img src="data:image/png;base64,${record.freshScreenshotBase64}" alt="After"><figcaption>After</figcaption></figure>
    <figure><img src="data:image/png;base64,${record.diffOverlayBase64}" alt="Diff overlay"><figcaption>Diff overlay</figcaption></figure>
  </div>
</section>

<section>
  <h2>Scene graph</h2>
  <table>
    <tr><th>Object count (prior)</th><td>${record.sceneObjectCountPrior}</td></tr>
    <tr><th>Object count (fresh)</th><td>${record.sceneObjectCountFresh}</td></tr>
  </table>
</section>
${renderConsoleSection(record.newConsoleMessages)}
${renderMemorySection(record.memory)}
${renderPerfSection(record.perf)}
</body>
</html>
`;
}
