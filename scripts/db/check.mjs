import { createDatabaseClient } from "./connection.mjs";

const sql = createDatabaseClient();

try {
  const [database] = await sql`
    select
      current_database() as database_name,
      current_setting('server_version') as server_version
  `;

  console.log(
    JSON.stringify(
      {
        connected: true,
        database: database.database_name,
        serverVersion: database.server_version,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
