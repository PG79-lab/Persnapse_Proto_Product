/** Network downloads are an explicit command; dev/build only copy verified local assets. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./dataset";

const root = resolve("output/card-rectification/models");
await mkdir(root, { recursive: true });
const headers = { "User-Agent": "Persnapse-card-rectification-evaluation" };
async function fetchBytes(url: string) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const commitResponse = await fetch(
  "https://api.github.com/repos/DocsaidLab/DocAligner/commits/main",
  { headers },
);
if (!commitResponse.ok) throw new Error("Cannot resolve upstream commit");
const commit = ((await commitResponse.json()) as { sha: string }).sha;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid upstream commit");
const base = `https://raw.githubusercontent.com/DocsaidLab/DocAligner/${commit}`;
const upstream = await fetchBytes(`${base}/docaligner/heatmap_reg/infer.py`);
const license = await fetchBytes(`${base}/LICENSE`);
await writeFile(resolve(root, "upstream-infer.py"), upstream);
await writeFile(resolve(root, "LICENSE-DocAligner.txt"), license);
const expectedNames = [
  "lcnet100_h_e_bifpn_256_fp32.onnx",
  "fastvit_t8_h_e_bifpn_256_fp32.onnx",
];
const entries = [];
for (const filename of expectedNames) {
  const configs = upstream
    .toString()
    .match(
      new RegExp(
        `'model_path': '${filename.replaceAll(".", "\\.")}',\\s*'file_id': '([^']+)'`,
      ),
    );
  if (!configs) throw new Error(`Official model mapping changed: ${filename}`);
  const url = `https://drive.usercontent.google.com/download?id=${configs[1]}&export=download&confirm=t`;
  const bytes = await fetchBytes(url);
  if (
    bytes.length < 1_000_000 ||
    bytes.subarray(0, 200).toString().toLowerCase().includes("<!doctype html")
  )
    throw new Error(`Not an ONNX binary: ${filename}`);
  const hash = sha256(bytes);
  await writeFile(resolve(root, `${hash}.onnx`), bytes);
  entries.push({
    id: filename.startsWith("fastvit") ? "docaligner-t8" : "docaligner-lc100",
    repository: "https://github.com/DocsaidLab/DocAligner",
    repositoryCommit: commit,
    url,
    filename,
    bytes: bytes.length,
    sha256: hash,
    localFile: `${hash}.onnx`,
    upstreamInferSha256: sha256(upstream),
    license: "Apache-2.0 (upstream repository)",
    licenseSha256: sha256(license),
    preprocessingVersion: "docaligner-official-v1",
    input: {
      name: "img",
      shape: [1, 3, 256, 256],
      color: "BGR",
      range: [0, 1],
    },
    output: { name: "heatmap", shape: "NOT_INSPECTED" },
    status: "DOWNLOADED_NOT_VALIDATED",
  });
  console.log(`${filename}: ${bytes.length} bytes SHA-256 ${hash}`);
}
const manifest = {
  schemaVersion: "card-model-manifest-v1",
  runtimeVersion: "NOT_VALIDATED",
  models: entries,
  comparison: {
    id: "docquadnet-256",
    status: "NOT_RUN",
    reason: "public ONNX vs current ORT version must be checked independently",
  },
};
await writeFile(
  resolve(root, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
// Keep an immutable copy of exactly what was downloaded; promotion into tracked
// application manifest is separate from obtaining or running unvalidated weights.
console.log(`Downloaded manifest: ${resolve(root, "manifest.json")}`);
await readFile(resolve(root, "manifest.json"));
