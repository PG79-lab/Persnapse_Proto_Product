import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requireDatabaseUrl } from "./connection.mjs";

const cliPath = fileURLToPath(
  new URL("../../node_modules/supabase/dist/supabase.js", import.meta.url),
);
const databaseUrl = requireDatabaseUrl();
const result = spawnSync(
  process.execPath,
  [cliPath, "db", "push", "--db-url", databaseUrl, ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
