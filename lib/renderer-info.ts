// Shared by both scripts/ (checkpoint.ts, the interactive path) and
// test/visual/lib/ (capture.ts, the regression-suite path) — lives here
// rather than in either directory's own lib/ so the two don't end up
// importing across each other (PR #30 review finding #4: scripts/ and
// test/visual/lib/ were already coupled one direction via diff.ts;
// adding this the other way would have made them mutually dependent).
//
// Renamed from renderer-memory.ts (Unit 1) once this file grew to cover
// WebGLRenderer.info more broadly, not just .memory — see Unit 2's
// functional-design.md. Template-repo-only rename: /init never
// overwrites, so a project that already scaffolded the old filename
// keeps its own consistent copy; only a fresh /init run picks this up.
import type { Page } from "playwright";

// Minimal shape of WebGLRenderer.info.memory — the built-in three.js
// counters a leak actually shows up in (a geometry/texture count that
// climbs and never comes back down). Deliberately not dispose_check/
// memory_stats (threejs-devtools-mcp): those are MCP-bridged tools
// neither caller has access to outside a live chat session — see
// aidlc-docs/construction/unit-1-memcheck-routing/nfr-requirements/
// tech-stack-decisions.md, Decision 1.
export interface RendererMemory {
  geometries: number;
  textures: number;
}

// Optional, not a hard prerequisite like window.scene — returns null
// rather than throwing when window.__renderer__ isn't exposed, so every
// caller degrades gracefully (a checkpoint without a memory field, a
// scenario that never registers a memory expectation) instead of
// breaking existing setups that predate this.
//
// Kept exactly as shipped in Unit 1 (v0.3.41) — Unit 2 adds a sibling
// function below rather than reshaping this one, so nothing that
// already imports it needs to change.
export async function getRendererMemorySummary(
  page: Page,
): Promise<RendererMemory | null> {
  return await page.evaluate(() => {
    // @ts-ignore - browser global, optional prerequisite
    const renderer = globalThis.__renderer__ as
      | { info?: { memory?: RendererMemory } }
      | undefined;
    return renderer?.info?.memory ?? null;
  });
}

// Minimal shape of WebGLRenderer.info.render — the CPU-side submission
// counts for the most recently rendered frame. Deliberately CPU-side
// counts, not a timing/rate measurement: unlike FPS or frame-timing,
// these don't depend on how fast the GPU actually executed anything, so
// AGENTS.md §7a's Pi-hardware timing caveat does not apply to them (same
// reasoning already established for RendererMemory's counts). `frame` —
// a running total since the renderer was constructed — is omitted; it's
// a housekeeping counter, not a perf signal on its own.
export interface RendererPerf {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

// Same optional/graceful-null pattern as getRendererMemorySummary, same
// window.__renderer__ prerequisite — no new global to expose. A separate
// page.evaluate() round-trip rather than combining with the memory read
// above, specifically to leave that already-shipped function's signature
// untouched (see functional-design.md's noted trade-off).
export async function getRendererPerfSummary(
  page: Page,
): Promise<RendererPerf | null> {
  return await page.evaluate(() => {
    // @ts-ignore - browser global, optional prerequisite
    const renderer = globalThis.__renderer__ as
      | { info?: { render?: RendererPerf & { frame?: number } } }
      | undefined;
    const render = renderer?.info?.render;
    if (!render) return null;
    // Explicit pick, not a passthrough of the raw object — real
    // WebGLRenderer.info.render also carries `frame` (deliberately
    // omitted from RendererPerf, see above). Picking guarantees the
    // returned shape actually matches RendererPerf, rather than relying
    // on callers/tests never noticing an extra field tagging along.
    return {
      calls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
    };
  });
}
