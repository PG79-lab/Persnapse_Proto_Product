import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=512",
};
if (!env.PLAYWRIGHT_CHANNEL && process.platform === "win32") {
  if (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))
    env.PLAYWRIGHT_CHANNEL = "chrome";
  else if (
    existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")
  )
    env.PLAYWRIGHT_CHANNEL = "msedge";
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/capture.spec.ts",
    "tests/e2e/card-runtime.spec.ts",
    "tests/e2e/card-test-lab.spec.ts",
    "tests/e2e/card-pipeline.spec.ts",
    "--workers=1",
  ],
  { stdio: "inherit", env },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
