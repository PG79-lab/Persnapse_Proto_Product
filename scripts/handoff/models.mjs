import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  await readFile(
    resolve(root, "card_recognition/models/manifest.json"),
    "utf8",
  ),
);
const [mode, source] = process.argv.slice(2);
if (!["check", "restore"].includes(mode) || (mode === "restore" && !source)) {
  throw new Error(
    "Usage: npm run models:check | npm run models:restore -- <extracted-package-directory>",
  );
}
const files = [];
for (const model of manifest.models) {
  const relative = `models/${model.id}/${model.sha256}/model.onnx`;
  const from = resolve(
    mode === "restore" ? source : resolve(root, "public"),
    relative,
  );
  let bytes;
  try {
    bytes = await readFile(from);
  } catch {
    throw new Error(
      `Missing ${model.id}. Extract the model ZIP and run npm run models:restore -- <directory>.`,
    );
  }
  if (
    bytes.length !== model.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== model.sha256
  ) {
    throw new Error(`Model integrity check failed: ${model.id}`);
  }
  files.push({
    model: model.id,
    from,
    to: resolve(root, "public", relative),
    bytes: bytes.length,
    sha256: model.sha256,
  });
}
// Validate the entire package before copying any model into the application.
if (mode === "restore") {
  for (const file of files) {
    await mkdir(dirname(file.to), { recursive: true });
    if (file.from !== file.to) await copyFile(file.from, file.to);
  }
}
console.log(
  JSON.stringify(
    {
      mode,
      verified: files.map(({ model, bytes, sha256 }) => ({
        model,
        bytes,
        sha256,
      })),
    },
    null,
    2,
  ),
);
