import { readFile } from "node:fs/promises";

import { createDatabaseClient } from "./connection.mjs";

const seedPath = new URL("../../supabase/seed.sql", import.meta.url);
const seedSql = await readFile(seedPath, "utf8");
const sql = createDatabaseClient();

try {
  await sql.unsafe(seedSql);
  console.log(
    JSON.stringify(
      {
        seeded: true,
        source: "supabase/seed.sql",
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
