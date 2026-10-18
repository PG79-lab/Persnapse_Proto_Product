import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir("output", { recursive: true });
await build({
  entryPoints: ["scripts/db/verify-assistant-isolated.ts"],
  outfile: "output/assistant-verify.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  [
    "--max-old-space-size=256",
    "--max-semi-space-size=2",
    "--wasm-num-compilation-tasks=1",
    "--no-wasm-tier-up",
    "--conditions=react-server",
    "output/assistant-verify.mjs",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
