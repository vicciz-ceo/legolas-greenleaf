import { assertEquals } from "@std/assert";
import { lastAccepted, lastAcceptedMemory } from "./manifest.ts";
import type { HistoryEntry, Manifest, MemoryHistoryEntry } from "./types.ts";

function entry(sha: string, status: HistoryEntry["status"]): HistoryEntry {
  return { sha, timestamp: "2026-01-01T00:00:00Z", diffFromPrev: 0.01, status };
}

function memoryEntry(
  sha: string,
  status: MemoryHistoryEntry["status"],
): MemoryHistoryEntry {
  return {
    sha,
    timestamp: "2026-01-01T00:00:00Z",
    status,
    geometriesDelta: 0,
    texturesDelta: 0,
    value: { geometries: 6, textures: 10 },
  };
}

Deno.test("lastAccepted returns the most recent non-pending-review entry", () => {
  const m: Manifest = {
    scenario: "test",
    keyframes: {
      frame1: {
        history: [
          entry("aaa", "baseline"),
          entry("bbb", "auto-accepted"),
          entry("ccc", "accepted"),
        ],
      },
    },
  };
  assertEquals(lastAccepted(m, "frame1")?.sha, "ccc");
});

Deno.test("lastAccepted skips over trailing pending-review entries", () => {
  const m: Manifest = {
    scenario: "test",
    keyframes: {
      frame1: {
        history: [
          entry("aaa", "baseline"),
          entry("bbb", "accepted"),
          entry("ccc", "pending-review"),
        ],
      },
    },
  };
  assertEquals(lastAccepted(m, "frame1")?.sha, "bbb");
});

Deno.test("lastAccepted returns null when the keyframe has no history", () => {
  const m: Manifest = { scenario: "test", keyframes: {} };
  assertEquals(lastAccepted(m, "frame1"), null);
});

Deno.test("lastAccepted returns null when every entry is pending-review", () => {
  const m: Manifest = {
    scenario: "test",
    keyframes: { frame1: { history: [entry("aaa", "pending-review")] } },
  };
  assertEquals(lastAccepted(m, "frame1"), null);
});

Deno.test("lastAcceptedMemory returns the most recent non-pending-review entry", () => {
  const m: Manifest = {
    scenario: "test",
    keyframes: {},
    memory: {
      history: [
        memoryEntry("aaa", "baseline"),
        memoryEntry("bbb", "auto-accepted"),
        memoryEntry("ccc", "pending-review"),
      ],
    },
  };
  assertEquals(lastAcceptedMemory(m)?.sha, "bbb");
});

Deno.test("lastAcceptedMemory returns null when there's no memory history at all", () => {
  const m: Manifest = { scenario: "test", keyframes: {} };
  assertEquals(lastAcceptedMemory(m), null);
});
