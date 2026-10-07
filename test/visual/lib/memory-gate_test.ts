import { assertEquals } from "@std/assert";
import { decideMemoryGate } from "./memory-gate.ts";

Deno.test("decideMemoryGate: growth within threshold on both dimensions is auto-accepted", () => {
  const result = decideMemoryGate(
    { geometries: 6, textures: 10 },
    { geometries: 6, textures: 9 },
    2,
  );
  assertEquals(result, {
    geometriesDelta: 0,
    texturesDelta: 1,
    status: "auto-accepted",
  });
});

Deno.test("decideMemoryGate: geometries alone exceeding threshold flags pending-review", () => {
  const result = decideMemoryGate(
    { geometries: 10, textures: 10 },
    { geometries: 6, textures: 10 },
    2,
  );
  assertEquals(result.status, "pending-review");
  assertEquals(result.geometriesDelta, 4);
});

Deno.test("decideMemoryGate: textures alone exceeding threshold flags pending-review", () => {
  const result = decideMemoryGate(
    { geometries: 6, textures: 20 },
    { geometries: 6, textures: 10 },
    2,
  );
  assertEquals(result.status, "pending-review");
  assertEquals(result.texturesDelta, 10);
});

Deno.test("decideMemoryGate: a geometry leak isn't masked by texture disposal in the same run (regression test for review finding #1)", () => {
  // Geometries grew by 5 (a real leak), textures shrank by 5 in the same
  // run. Summed, that's a net delta of 0 — exactly the failure mode the
  // original combined-delta design had. Checked independently, the
  // geometries growth alone must still trip the threshold.
  const result = decideMemoryGate(
    { geometries: 11, textures: 5 },
    { geometries: 6, textures: 10 },
    0,
  );
  assertEquals(result.geometriesDelta, 5);
  assertEquals(result.texturesDelta, -5);
  assertEquals(result.status, "pending-review");
});

Deno.test("decideMemoryGate: shrinkage on both dimensions is never flagged, regardless of threshold", () => {
  const result = decideMemoryGate(
    { geometries: 2, textures: 3 },
    { geometries: 6, textures: 10 },
    0,
  );
  assertEquals(result.status, "auto-accepted");
});

Deno.test("decideMemoryGate: a delta exactly equal to threshold is not flagged (boundary is exclusive)", () => {
  const result = decideMemoryGate(
    { geometries: 8, textures: 10 },
    { geometries: 6, textures: 10 },
    2,
  );
  assertEquals(result.geometriesDelta, 2);
  assertEquals(result.status, "auto-accepted");
});

Deno.test("decideMemoryGate: threshold of 0 flags any growth at all", () => {
  const result = decideMemoryGate(
    { geometries: 6, textures: 11 },
    { geometries: 6, textures: 10 },
    0,
  );
  assertEquals(result.status, "pending-review");
});
