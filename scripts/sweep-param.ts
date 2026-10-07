// Usage: deno task sweep -- <ObjectName> <property.path> <min> <max> <steps>
// Example: deno task sweep -- PointLight intensity 0.2 2.0 8
//
// Runs the entire set→wait→screenshot→restore loop atomically. The agent's
// job is parsing the natural-language request into these five arguments
// (and asking if anything's ambiguous) — everything after that is
// mechanical and shouldn't be re-derived by hand each time.
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";
import {
  attachToLiveScene,
  getProperty,
  setProperty,
} from "./lib/live-scene.ts";

const [objectName, path, minStr, maxStr, stepsStr] = Deno.args;
if (!objectName || !path || !minStr || !maxStr || !stepsStr) {
  console.error(
    "usage: sweep-param.ts <ObjectName> <property.path> <min> <max> <steps>",
  );
  Deno.exit(1);
}
const min = Number(minStr), max = Number(maxStr), steps = Number(stepsStr);
const RENDER_WAIT_MS = 150;

const { browser, page } = await attachToLiveScene();

const original = await getProperty(page, objectName, path);
const shots: { value: number; png: InstanceType<typeof PNG> }[] = [];

try {
  for (let i = 0; i < steps; i++) {
    const value = min + ((max - min) * i) / (steps - 1);
    await setProperty(page, objectName, path, value);
    await new Promise((r) => setTimeout(r, RENDER_WAIT_MS));
    const buf = await page.screenshot();
    shots.push({ value, png: PNG.sync.read(Buffer.from(buf)) });
  }
} finally {
  // Restore original value even if something above threw — a sweep that
  // silently leaves the scene in an altered state is worse than one that
  // fails loudly.
  await setProperty(page, objectName, path, original);
}

// Tile into a grid contact sheet, labeled by value under each frame.
const cols = Math.ceil(Math.sqrt(shots.length));
const rows = Math.ceil(shots.length / cols);
const { width, height } = shots[0].png;
const labelHeight = 20;
const sheet = new PNG({
  width: width * cols,
  height: (height + labelHeight) * rows,
});
sheet.data.fill(255);

for (let i = 0; i < shots.length; i++) {
  const col = i % cols, row = Math.floor(i / cols);
  const ox = col * width, oy = row * (height + labelHeight);
  const src = shots[i].png;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4,
        di = ((oy + y) * sheet.width + (ox + x)) * 4;
      sheet.data[di] = src.data[si];
      sheet.data[di + 1] = src.data[si + 1];
      sheet.data[di + 2] = src.data[si + 2];
      sheet.data[di + 3] = src.data[si + 3];
    }
  }
  // Value labels aren't rendered as pixel text here (no font rasterizer
  // dependency pulled in for this) — the sidecar JSON below maps each grid
  // position to its value instead. A text label baked into the image is a
  // reasonable future improvement if reading the JSON alongside the image
  // proves annoying in practice.
}

const dir = ".parallax/sweeps";
await Deno.mkdir(dir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const base = `${timestamp}-${objectName}.${path}`;
await Deno.writeFile(`${dir}/${base}.png`, PNG.sync.write(sheet));
await Deno.writeTextFile(
  `${dir}/${base}.json`,
  JSON.stringify(
    {
      objectName,
      path,
      min,
      max,
      steps,
      cols,
      rows,
      values: shots.map((s) => s.value),
    },
    null,
    2,
  ),
);

console.log(
  `sweep contact sheet: ${dir}/${base}.png (grid position → value in ${base}.json)`,
);
await browser.close();
