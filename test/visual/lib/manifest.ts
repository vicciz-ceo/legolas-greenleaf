import type { HistoryEntry, Manifest, MemoryHistoryEntry } from "./types.ts";

const ROOT = ".parallax/visual-history";
const manifestPath = (scenario: string) => `${ROOT}/${scenario}/manifest.json`;

export async function loadManifest(scenario: string): Promise<Manifest> {
  try {
    return JSON.parse(await Deno.readTextFile(manifestPath(scenario)));
  } catch {
    return { scenario, keyframes: {} };
  }
}

export async function saveManifest(m: Manifest) {
  await Deno.mkdir(`${ROOT}/${m.scenario}`, { recursive: true });
  await Deno.writeTextFile(
    manifestPath(m.scenario),
    JSON.stringify(m, null, 2),
  );
}

function lastAcceptedIn<T extends { status: HistoryEntry["status"] }>(
  history: T[],
): T | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status !== "pending-review") return history[i];
  }
  return null;
}

export function lastAccepted(
  m: Manifest,
  keyframe: string,
): HistoryEntry | null {
  return lastAcceptedIn(m.keyframes[keyframe]?.history ?? []);
}

// Mirrors lastAccepted, for the scenario-level memory history (see
// types.ts's Manifest.memory) rather than a per-keyframe one.
export function lastAcceptedMemory(m: Manifest): MemoryHistoryEntry | null {
  return lastAcceptedIn(m.memory?.history ?? []);
}

export const keyframeDir = (scenario: string, keyframe: string) =>
  `${ROOT}/${scenario}/${keyframe}`;
