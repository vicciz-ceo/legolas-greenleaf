import type { RendererMemory } from "../../../lib/renderer-info.ts";

export interface MemoryGateResult {
  geometriesDelta: number;
  texturesDelta: number;
  status: "pending-review" | "auto-accepted";
}

// The actual decision behind run.ts's memory check, pulled out as pure
// logic specifically so it's unit-testable (see PR #30 review finding
// #3) — no DOM/GPU/timer dependency, matches code-generation.md's Test
// Scope Policy for what should get direct coverage.
//
// geometries and textures are checked INDEPENDENTLY against threshold,
// not summed first (PR #30 review finding #1) — summing them would let
// a geometry leak hide behind unrelated texture disposal in the same
// run, or vice versa. Either dimension alone exceeding threshold is
// enough to flag pending-review.
export function decideMemoryGate(
  current: RendererMemory,
  priorValue: RendererMemory,
  threshold: number,
): MemoryGateResult {
  const geometriesDelta = current.geometries - priorValue.geometries;
  const texturesDelta = current.textures - priorValue.textures;
  const exceeded = geometriesDelta > threshold || texturesDelta > threshold;
  return {
    geometriesDelta,
    texturesDelta,
    status: exceeded ? "pending-review" : "auto-accepted",
  };
}
