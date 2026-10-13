import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const ortRoot = resolve("node_modules/onnxruntime-web");
const { version } = JSON.parse(
  await readFile(resolve(ortRoot, "package.json"), "utf8"),
);
if (version !== "1.30.0")
  throw new Error("Card runtime version must remain pinned");
const dest = resolve(`public/vendor/ort/${version}`);
await mkdir(dest, { recursive: true });
for (const name of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
])
  await copyFile(resolve(ortRoot, "dist", name), resolve(dest, name));
await copyFile(
  resolve("card_recognition/models/LICENSE-ONNX-Runtime.txt"),
  resolve(dest, "LICENSE.txt"),
);
await build({
  entryPoints: ["card_recognition/runtime/inference-worker.ts"],
  outfile: "public/vendor/card-inference-worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["onnxruntime-web-use-extern-wasm"],
  minify: true,
});
// An absent local model repository is valid for the legacy product path.
// Never download during dev/build and never deploy an unverified hash.
let manifest;
try {
  manifest = JSON.parse(
    await readFile("card_recognition/models/manifest.json", "utf8"),
  );
} catch (error) {
  if (error.code === "ENOENT") process.exit(0);
  throw error;
}
for (const model of manifest.models) {
  let bytes;
  try {
    bytes = await readFile(
      resolve("output/card-rectification/models", model.localFile),
    );
  } catch (error) {
    if (
      error.code === "ENOENT" &&
      process.env.NEXT_PUBLIC_CARD_RECTIFICATION_MODE !== "learned"
    )
      continue;
    throw error;
  }
  if (
    bytes.length !== model.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== model.sha256
  )
    throw new Error(`Model hash mismatch: ${model.id}`);
  const path = resolve("public/models", model.id, model.sha256);
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, "model.onnx"), bytes);
}
