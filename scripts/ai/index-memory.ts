import { indexPersonMemory } from "../../src/server/db/memory-search-repository";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { getServerEnv } from "../../src/server/env";
const args = process.argv.slice(2);
if (!args.includes("--confirm-live"))
  throw new Error(
    "Requires explicit --confirm-live approval; creates embeddings and updates the selected workspace.",
  );
const limit = Number(
  args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "0",
);
if (!Number.isInteger(limit) || limit < 1 || limit > 20)
  throw new Error("Provide --limit=1..20.");
const env = getServerEnv();
if (env.AI_ROUTING_MODE !== "live")
  throw new Error("AI_ROUTING_MODE must be live.");
try {
  const rows = await getDatabase()<
    { person_id: string }[]
  >`select person_id from public.memory_documents
   where workspace_id = ${env.APP_DEFAULT_WORKSPACE_ID} and document_kind = 'person_profile'
     and (embedding_status in ('pending','failed') or embedding_model is distinct from ${env.VOYAGE_EMBEDDING_MODEL})
   order by updated_at limit ${limit}`;
  let completed = 0;
  for (const row of rows) {
    await indexPersonMemory(env.APP_DEFAULT_WORKSPACE_ID, row.person_id);
    completed++;
  }
  console.log(JSON.stringify({ selected: rows.length, completed }));
} catch {
  console.error(
    "Indexing stopped. Existing memory is preserved. Check call limits, schema and provider availability.",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
