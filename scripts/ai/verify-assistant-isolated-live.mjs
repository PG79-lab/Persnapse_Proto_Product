import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir("output", { recursive: true });
await build({
  entryPoints: ["scripts/ai/verify-assistant-isolated-live.ts"],
  outfile: "output/assistant-live-verify.mjs",
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
    ...process.argv.slice(2).filter((arg) => arg.startsWith("--env-file=")),
    "output/assistant-live-verify.mjs",
    ...process.argv.slice(2).filter((arg) => !arg.startsWith("--env-file=")),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
