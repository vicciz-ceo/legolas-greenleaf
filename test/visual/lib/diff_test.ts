import { assertEquals, assertThrows } from "@std/assert";
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";
import { diffPngs } from "./diff.ts";

// Builds a tiny solid-color PNG entirely in memory — no fixture files,
// no disk I/O, matching the "zero new infrastructure" bar for this tier.
function solidPng(
  width: number,
  height: number,
  [r, g, b, a]: [number, number, number, number],
): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return new Uint8Array(PNG.sync.write(png));
}

Deno.test("diffPngs: identical images produce a zero diff ratio", () => {
  const a = solidPng(4, 4, [255, 0, 0, 255]);
  const b = solidPng(4, 4, [255, 0, 0, 255]);
  const { ratio } = diffPngs(a, b);
  assertEquals(ratio, 0);
});

Deno.test("diffPngs: fully different images produce a nonzero diff ratio", () => {
  const a = solidPng(4, 4, [255, 0, 0, 255]);
  const b = solidPng(4, 4, [0, 255, 0, 255]);
  const { ratio } = diffPngs(a, b);
  assertEquals(ratio > 0, true);
});

Deno.test("diffPngs: mismatched dimensions throw a size-mismatch error, not a silent/garbage result", () => {
  const a = solidPng(4, 4, [255, 0, 0, 255]);
  const b = solidPng(8, 8, [255, 0, 0, 255]);
  assertThrows(
    () => diffPngs(a, b),
    Error,
    "screenshot size mismatch",
  );
});

Deno.test("diffPngs: returns a diffPng buffer the same dimensions as the input", () => {
  const a = solidPng(4, 4, [255, 0, 0, 255]);
  const b = solidPng(4, 4, [0, 255, 0, 255]);
  const { diffPng } = diffPngs(a, b);
  const parsed = PNG.sync.read(Buffer.from(diffPng));
  assertEquals([parsed.width, parsed.height], [4, 4]);
});
