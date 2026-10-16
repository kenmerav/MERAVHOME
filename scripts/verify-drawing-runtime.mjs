// Verify deployed files, not the source checkout's node_modules. This prevents
// a successful cloud build from shipping without PDF/OCR runtime dependencies.
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import assert from "node:assert/strict";

const candidates = process.env.VERCEL
  ? [".vercel/output/functions/__server.func", ".output/server"]
  : [".output/server", ".vercel/output/functions/__server.func"];
const directory = candidates.find((path) => existsSync(resolve(path, "index.mjs")));
assert(directory, "The built PDF server output is missing.");
const root = realpathSync(resolve(directory));
const builtRequire = createRequire(resolve(root, "index.mjs"));
const inOutput = (path) => realpathSync(path).startsWith(root + sep);
for (const dependency of [
  "@napi-rs/canvas",
  "tesseract.js/src/worker-script/node/index.js",
  "tesseract.js-core/tesseract-core.wasm.js",
  "tesseract.js-core/tesseract-core.wasm",
]) {
  assert(inOutput(builtRequire.resolve(dependency)), `${dependency} was not packaged in the server output.`);
}
const canvas = builtRequire("@napi-rs/canvas");
assert(new canvas.DOMMatrix().isIdentity);
assert.equal(new canvas.ImageData(new Uint8ClampedArray(4), 1, 1).width, 1);
const sample = canvas.createCanvas(8, 8);
sample.getContext("2d").fillRect(0, 0, 8, 8);
assert(sample.toBuffer("image/png").length > 50, "The packaged PDF image renderer could not run.");
const binary = Object.keys(builtRequire.cache).find((path) => /skia.*\.node$/.test(path));
assert(binary && inOutput(binary), "The native canvas binary was not packaged in the server output.");
console.log(`Packaged PDF renderer and OCR assets verified (${process.platform}-${process.arch}).`);
