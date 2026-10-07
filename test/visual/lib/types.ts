export type Step =
  | { action: "wait"; ms: number }
  | { action: "waitForSelector"; selector: string }
  // Waits for window.__renderer__.info.render.frame > 0 -- confirmed
  // empirically (cycle 2's demo-recording work) that waitForSelector
  // alone leaves a variable, CDN/asset-load-dependent blank window
  // before a scene's first real frame. Any scenario whose first
  // keyframe follows close behind waitForSelector without its own
  // generous `wait` risks capturing that blank window instead of real
  // content. Requires window.__renderer__ to be exposed (same
  // prerequisite `/checkpoint`'s memory/perf fields already have) --
  // optional, only use it where that's already true.
  | { action: "waitForFirstRender" }
  | { action: "click"; selector: string }
  | { action: "dragOrbit"; dx: number; dy: number }
  | { action: "evaluate"; script: string }
  | { action: "keyframe"; name: string };

export interface Scenario {
  name: string;
  path: string;
  threshold?: number; // fraction of changed pixels, 0-1. Overrides the global default.
  // Max allowed increase in EITHER geometries OR textures (checked
  // independently, not summed — a geometry leak shouldn't be maskable by
  // unrelated texture disposal in the same run, or vice versa) vs. the
  // last accepted baseline. Unset means no memory check runs for this
  // scenario — not a zero-tolerance default. See scenario-author.md §3a.
  memoryThreshold?: number;
  // Unset means desktop, exactly as before this field existed — every
  // existing scenario with no `device` behaves identically (1280x800,
  // mouse input), zero risk to already-accepted baselines. When set,
  // `click`/`dragOrbit` steps dispatch via real touch input instead of
  // mouse automatically — no separate touch-flavored step verbs to
  // author. See Unit 7's functional design for why this couldn't be
  // chrome-devtools-mcp's `emulate` tool (that operates on a live shared
  // tab, not this pipeline's own isolated headless browser).
  device?: {
    viewport: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
    deviceScaleFactor?: number;
  };
  steps: Step[];
}

export interface HistoryEntry {
  sha: string;
  timestamp: string;
  diffFromPrev: number | null;
  status: "baseline" | "auto-accepted" | "accepted" | "pending-review";
}

// Memory entries need their own shape, not a forced fit into
// HistoryEntry: geometries and textures are gated independently (see
// Scenario.memoryThreshold's doc), so one delta number isn't enough, and
// the absolute counts need to persist so the *next* run can diff against
// them without a stored artifact (pixel entries don't need this — the
// accepted PNG file on disk already serves that purpose).
export interface MemoryHistoryEntry {
  sha: string;
  timestamp: string;
  status: "baseline" | "auto-accepted" | "accepted" | "pending-review";
  geometriesDelta: number | null;
  texturesDelta: number | null;
  value: { geometries: number; textures: number };
}

export interface Manifest {
  scenario: string;
  keyframes: Record<string, { history: HistoryEntry[] }>;
  // Scenario-level, not per-keyframe: renderer memory is a whole-scene
  // cumulative signal, not something that varies meaningfully shot to
  // shot within one run. Absent entirely for scenarios with no
  // memoryThreshold set.
  memory?: { history: MemoryHistoryEntry[] };
}
