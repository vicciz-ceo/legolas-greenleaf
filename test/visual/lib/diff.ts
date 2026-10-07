import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";

export function diffPngs(a: Uint8Array, b: Uint8Array) {
  const imgA = PNG.sync.read(Buffer.from(a));
  const imgB = PNG.sync.read(Buffer.from(b));

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `screenshot size mismatch: baseline ${imgA.width}x${imgA.height} ` +
        `vs new ${imgB.width}x${imgB.height} — check viewport config, ` +
        `not a rendering diff`,
    );
  }

  const { width, height } = imgA;
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(
    imgA.data,
    imgB.data,
    out.data,
    width,
    height,
    { threshold: 0.1 },
  );

  return { ratio: diffPixels / (width * height), diffPng: PNG.sync.write(out) };
}
