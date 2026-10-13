import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const local = resolve(
  "output/card-rectification/python",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(local))
  throw new Error(
    "Create the local card benchmark Python environment first; see scripts/card_recognition/README.md",
  );
const result = spawnSync(local, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
