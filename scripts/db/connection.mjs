import postgres from "postgres";

export function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Add it to .env.local.");
  }

  const parsed = new URL(databaseUrl);

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }

  return databaseUrl;
}

export function createDatabaseClient() {
  return postgres(requireDatabaseUrl(), {
    ssl: "require",
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 2,
  });
}
