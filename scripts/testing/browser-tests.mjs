import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnvironment } from "./environment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = { ...process.env, ...isolatedEnvironment };
async function run(args) {
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (status) => resolveCode(status ?? 1));
  });
  if (code) process.exit(code);
}
await run(["scripts/handoff/models.mjs", "check"]);
if (!process.argv.includes("--no-build")) {
  for (const script of ["copy-opencv", "copy-card-runtime", "copy-card-test"])
    await run([`scripts/${script}.mjs`]);
  await run(["node_modules/next/dist/bin/next", "build", "--webpack"]);
}
await run([
  "node_modules/@playwright/test/cli.js",
  "test",
  "--config=playwright.config.ts",
]);
await run([
  "node_modules/@playwright/test/cli.js",
  "test",
  "--config=playwright.graph.config.ts",
]);
