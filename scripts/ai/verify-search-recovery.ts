import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  prepareSearch,
  inspectSearchPreparation,
} from "../../src/server/application/search-preparation-service";
import { assertSearchReady } from "../../src/server/db/memory-search-repository";
import { closeDatabase, getDatabase } from "../../src/server/db/client";
import { getServerEnv } from "../../src/server/env";

if (!process.argv.includes("--confirm-live")) {
  console.error(
    "Pass --confirm-live: prepares at most three pending documents with paid embeddings.",
  );
  process.exit(2);
}
const reportPath = "test-results/search-recovery-20261008.json";
if (existsSync(reportPath)) {
  console.error("Report exists; inspect it before another paid run.");
  process.exit(2);
}
process.env.AI_ROUTING_MODE = "live";
const env = getServerEnv();
const sql = getDatabase();
const nativeFetch = globalThis.fetch;
const usage: Array<{
  model: string;
  httpStatus: number;
  latencyMs: number;
  totalTokens: number | null;
}> = [];
const batches: unknown[] = [];
let before: Awaited<ReturnType<typeof inspectSearchPreparation>> | undefined;
let after: Awaited<ReturnType<typeof inspectSearchPreparation>> | undefined;
let blockedBeforePreparation = false;
let canonicalUnchanged = false;
let preparedDocumentsUnchanged = false;
let failure: string | null = null;
let canonicalTables: string[] = [];
let canonicalBefore: Awaited<ReturnType<typeof snapshotCanonical>> | undefined;
let readyIds: string[] = [];
let readyBefore: unknown;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  assert.equal(url, "https://api.voyageai.com/v1/embeddings");
  assert(usage.length < 3, "Three-request verification cap reached.");
  const body = JSON.parse(String(init?.body)) as {
    model: string;
    input_type: string;
  };
  assert.equal(body.input_type, "document");
  const item = {
    model: body.model,
    httpStatus: 0,
    latencyMs: 0,
    totalTokens: null as number | null,
  };
  usage.push(item);
  const start = performance.now();
  const response = await nativeFetch(input, init);
  item.httpStatus = response.status;
  item.latencyMs = Math.round(performance.now() - start);
  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  item.totalTokens = payload?.usage?.total_tokens ?? null;
  return response;
};

async function snapshotCanonical() {
  const snapshot: Record<string, { count: number; digest: string }> = {};
  for (const table of canonicalTables) {
    const [row] = await sql<Array<{ count: number; digest: string }>>`
      select count(*)::integer as count,
        md5(coalesce(string_agg(to_jsonb(entry)::text, '' order by to_jsonb(entry)::text), '')) as digest
      from ${sql(`public.${table}`)} entry where workspace_id = ${env.APP_DEFAULT_WORKSPACE_ID}
    `;
    snapshot[table] = row;
  }
  return snapshot;
}
async function snapshotReady() {
  const [row] = await sql`
    select count(*)::integer as count,
      md5(coalesce(string_agg(to_jsonb(entry)::text, '' order by entry.id), '')) as digest
    from public.memory_documents entry where workspace_id = ${env.APP_DEFAULT_WORKSPACE_ID}
      and id = any(${readyIds}::uuid[])
  `;
  return row;
}

try {
  const tables = await sql<Array<{ table_name: string }>>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'workspace_id'
      and table_name not in ('memory_documents', 'ai_runs', 'ai_call_reservations')
    order by table_name
  `;
  canonicalTables = tables.map((row) => row.table_name);
  canonicalBefore = await snapshotCanonical();
  const ready = await sql<Array<{ id: string }>>`
    select id from public.memory_documents where workspace_id = ${env.APP_DEFAULT_WORKSPACE_ID}
      and document_kind = 'person_profile' and embedding_status = 'ready'
      and embedding is not null and embedding_model = ${env.VOYAGE_EMBEDDING_MODEL}
  `;
  readyIds = ready.map((row) => row.id);
  readyBefore = await snapshotReady();
  before = await inspectSearchPreparation(env.APP_DEFAULT_WORKSPACE_ID);
  assert(
    before.remaining <= 3,
    "Unexpected corpus changes; inspect before indexing.",
  );
  if (before.remaining) {
    await assert.rejects(
      assertSearchReady(
        env.APP_DEFAULT_WORKSPACE_ID,
        env.VOYAGE_EMBEDDING_MODEL,
      ),
      { code: "SEARCH_NOT_READY" },
    );
    assert.equal(usage.length, 0);
    blockedBeforePreparation = true;
  }
  console.log(
    JSON.stringify({ phase: "before", ...before, paidCalls: usage.length }),
  );
  // Two explicitly bounded submissions (2 + 1); no retry of failed providers.
  for (let batch = 0; batch < 2; batch++) {
    const status = await inspectSearchPreparation(env.APP_DEFAULT_WORKSPACE_ID);
    if (status.ready) break;
    const result = await prepareSearch(env.APP_DEFAULT_WORKSPACE_ID);
    batches.push(result);
    console.log(
      JSON.stringify({
        phase: "batch",
        number: batch + 1,
        ...result,
        paidCalls: usage.length,
      }),
    );
    assert.equal(result.failureCount, 0);
    assert.equal(result.retryAfterSeconds, null);
  }
  after = await inspectSearchPreparation(env.APP_DEFAULT_WORKSPACE_ID);
  await assertSearchReady(
    env.APP_DEFAULT_WORKSPACE_ID,
    env.VOYAGE_EMBEDDING_MODEL,
  );
  assert.equal(after.remaining, 0);
  assert.equal(usage.length, before.remaining);
} catch (error) {
  failure =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "VERIFICATION_FAILED";
  process.exitCode = 1;
} finally {
  try {
    if (canonicalBefore) {
      assert.deepEqual(await snapshotCanonical(), canonicalBefore);
      canonicalUnchanged = true;
      assert.deepEqual(await snapshotReady(), readyBefore);
      preparedDocumentsUnchanged = true;
    }
    after = await inspectSearchPreparation(env.APP_DEFAULT_WORKSPACE_ID);
  } catch {
    failure ??= "DATA_CHECK_FAILED";
    process.exitCode = 1;
  }
  globalThis.fetch = nativeFetch;
  await closeDatabase();
  const report = {
    checkedAt: new Date().toISOString(),
    verified:
      failure === null && canonicalUnchanged && preparedDocumentsUnchanged,
    before,
    after,
    batches,
    blockedBeforePreparation,
    canonicalUnchanged,
    canonicalTableCount: canonicalTables.length,
    previouslyPreparedUnchanged: preparedDocumentsUnchanged,
    previouslyPreparedCount: readyIds.length,
    paidCalls: usage.length,
    usage,
    failure,
    modeOverride: "process-only",
    deploymentChanged: false,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
