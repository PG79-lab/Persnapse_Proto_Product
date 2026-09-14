import "server-only";

import postgres, { type Sql } from "postgres";

import { getServerEnv } from "../env";

declare global {
  var persnapseDatabaseClient: Sql | undefined;
}

export function getDatabase(): Sql {
  if (!globalThis.persnapseDatabaseClient) {
    globalThis.persnapseDatabaseClient = postgres(getServerEnv().DATABASE_URL, {
      ssl: "require",
      max: 5,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
  }

  return globalThis.persnapseDatabaseClient;
}
