import { getServerEnv } from "../../src/server/env";
import { closeDatabase, getDatabase } from "../../src/server/db/client";
import { runAssistantIndexBatch } from "../../src/server/application/assistant-index-worker";
const env = getServerEnv();
if (
  !process.argv.includes("--confirm-live") &&
  !process.argv.includes("--backfill")
)
  throw new Error(
    "Use --backfill for projection only or --confirm-live for paid indexing.",
  );
try {
  if (process.argv.includes("--backfill")) {
    // One selected workspace; transactional, no canonical fact rewrite or provider call.
    await getDatabase()`select app_private.refresh_assistant_units(${env.APP_DEFAULT_WORKSPACE_ID}::uuid)`;
    console.log(JSON.stringify({ backfill: "completed", providerCalls: 0 }));
  }
  if (process.argv.includes("--confirm-live")) {
    let stopping = false;
    process.on("SIGINT", () => {
      stopping = true;
    });
    process.on("SIGTERM", () => {
      stopping = true;
    });
    do {
      const batch = await runAssistantIndexBatch(env.APP_DEFAULT_WORKSPACE_ID);
      console.log(JSON.stringify(batch));
      if (!process.argv.includes("--watch") || stopping) break;
      const delay = "failed" in batch && batch.failed > 0 ? 60_000 : 10_000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } while (!stopping);
  }
} finally {
  await closeDatabase();
}
