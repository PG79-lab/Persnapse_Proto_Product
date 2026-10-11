import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { POST as observe } from "../../src/app/api/recall/observation/route";
import { POST as feedback } from "../../src/app/api/feedback/route";
import { recordRecallResponse } from "../../src/server/db/recall-repository";
import { createAiAttemptRecorder } from "../../src/server/db/ai-run-repository";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import type { RecallResponse } from "../../src/domain/recall/types";

if (!process.argv.includes("--confirm-test-writes")) {
  console.error(
    "Pass --confirm-test-writes: isolated DB fixtures, no provider calls.",
  );
  process.exit(2);
}
const originalWorkspace = process.env.APP_DEFAULT_WORKSPACE_ID ?? "";
assert(originalWorkspace);
const workspaceId = randomUUID();
const foreignId = randomUUID();
const workspaceNames = new Map([
  [workspaceId, `Recall storage verification ${workspaceId}`],
  [foreignId, `Recall storage foreign verification ${foreignId}`],
]);
process.env.APP_DEFAULT_WORKSPACE_ID = workspaceId;
process.env.AI_ROUTING_MODE = "mock";
process.env.APP_REMOTE_PROTOTYPE_ACCESS = "off";
const sql = getDatabase();
const nativeFetch = globalThis.fetch;
let blockedProviderCalls = 0;
globalThis.fetch = async () => {
  blockedProviderCalls++;
  throw new Error("Provider requests are disabled in this verifier.");
};
const response: RecallResponse = {
  queryId: null,
  status: "no_result",
  answer: "합성 검증 답변",
  parsedQuery: {
    normalizedQuery: "합성 검증 질문",
    terms: [],
    intents: ["person_lookup"],
    dateRange: null,
    parserVersion: "structured-v1",
  },
  results: [],
  latencyMs: 1,
  mode: "structured_local_semantic",
  model: "synthetic",
};
const checks: string[] = [];
let tables: string[] = [];
let before: Record<string, unknown> | undefined;
let verified = false;
let cleanupVerified = false;
let existingDataUnchanged = false;
let failure: string | null = null;
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const [row] =
      await sql`select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(entry)::text, '' order by to_jsonb(entry)::text), '')) as digest
      from ${sql(`public.${table}`)} entry where workspace_id = ${originalWorkspace}`;
    result[table] = row;
  }
  return result;
}
function request(path: string, input: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
try {
  const rows = await sql<
    { table_name: string }[]
  >`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' order by table_name`;
  tables = rows.map((r) => r.table_name);
  before = await snapshot();
  for (const [id, name] of workspaceNames) {
    assert.notEqual(id, originalWorkspace);
    await sql`insert into public.workspaces(id, name) values (${id}, ${name})`;
  }
  const queryId = await recordRecallResponse({
    workspaceId,
    queryText: "합성 검증 질문",
    referenceTime: new Date(),
    response,
  });
  const foreignQuery = await recordRecallResponse({
    workspaceId: foreignId,
    queryText: "격리 검증 질문",
    referenceTime: new Date(),
    response,
  });
  const [stored] =
    await sql`select jsonb_typeof(parsed_query) as parsed, jsonb_typeof(response_payload) as payload, jsonb_typeof(retrieval_trace) as trace from public.queries where workspace_id = ${workspaceId} and id = ${queryId}`;
  assert.deepEqual(stored, {
    parsed: "object",
    payload: "object",
    trace: "object",
  });
  checks.push("parsed-query-response-trace-are-json-objects");
  await createAiAttemptRecorder({
    workspaceId,
    schemaVersion: "synthetic-verification",
  })({
    task: "informationStructuring",
    mode: "mock",
    lane: "mock",
    provider: "local",
    model: "synthetic",
    attempt: 1,
    status: "mocked",
    latencyMs: 1,
    totalTokens: 0,
  });
  const [metadata] =
    await sql`select jsonb_typeof(metadata) as type from public.ai_runs where workspace_id = ${workspaceId} and schema_version = 'synthetic-verification'`;
  assert.equal(metadata.type, "object");
  checks.push("attempt-usage-metadata-is-json-object");
  assert.equal(
    (
      await observe(
        request("/api/recall/observation", {
          queryId: foreignQuery,
          elapsedMs: 1,
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await feedback(
        request("/api/feedback", {
          queryId: foreignQuery,
          kind: "helpful",
          comment: null,
          elapsedMs: null,
        }),
      )
    ).status,
    404,
  );
  checks.push("foreign-workspace-query-cannot-be-observed-or-rated");
  // Reproduce the old writer's double-encoded value only in this fixture.
  const legacyTrace = JSON.stringify({
    confirmedOnly: true,
    model: "synthetic",
  });
  await sql`update public.queries set retrieval_trace = ${sql.json(legacyTrace)} where workspace_id = ${workspaceId} and id = ${queryId}`;
  assert.equal(
    (
      await observe(
        request("/api/recall/observation", { queryId, elapsedMs: 120 }),
      )
    ).status,
    200,
  );
  const [observed] =
    await sql`select jsonb_typeof(retrieval_trace) as type, (retrieval_trace->>'clientElapsedMs')::int as elapsed, retrieval_trace->>'legacyTrace' as legacy from public.queries where workspace_id = ${workspaceId} and id = ${queryId}`;
  assert.deepEqual(observed, {
    type: "object",
    elapsed: 120,
    legacy: legacyTrace,
  });
  checks.push("legacy-trace-is-preserved-and-latency-becomes-readable");
  assert.equal(
    (
      await feedback(
        request("/api/feedback", {
          queryId,
          kind: "helpful",
          comment: "합성 저장 검증",
          elapsedMs: 135,
        }),
      )
    ).status,
    200,
  );
  const [rated] =
    await sql`select (retrieval_trace->>'clientElapsedMs')::int as elapsed, retrieval_trace->>'legacyTrace' as legacy from public.queries where workspace_id = ${workspaceId} and id = ${queryId}`;
  assert.deepEqual(rated, { elapsed: 135, legacy: legacyTrace });
  const [foreign] =
    await sql`select retrieval_trace ? 'clientElapsedMs' as observed from public.queries where workspace_id = ${foreignId} and id = ${foreignQuery}`;
  assert.equal(foreign.observed, false);
  checks.push(
    "feedback-latency-keeps-legacy-trace-and-foreign-query-unchanged",
  );
  assert.equal(blockedProviderCalls, 0);
  verified = true;
} catch {
  failure = "VERIFICATION_FAILED";
} finally {
  try {
    for (const [id, name] of workspaceNames) {
      assert.notEqual(id, originalWorkspace);
      await sql`delete from public.workspaces where id = ${id} and name = ${name}`;
    }
    for (const table of tables) {
      const [row] =
        await sql`select count(*)::int as count from ${sql(`public.${table}`)} where workspace_id = any(${[...workspaceNames.keys()]}::uuid[])`;
      assert.equal(row.count, 0);
    }
    cleanupVerified = true;
    if (before) {
      assert.deepEqual(await snapshot(), before);
      existingDataUnchanged = true;
    }
  } catch {
    failure ??= "CLEANUP_OR_DATA_CHECK_FAILED";
  }
  globalThis.fetch = nativeFetch;
  await closeDatabase();
  const report = {
    checkedAt: new Date().toISOString(),
    verified: verified && cleanupVerified && existingDataUnchanged,
    checks,
    providerRequests: 0,
    blockedProviderCalls,
    cleanupVerified,
    fixtureRows: cleanupVerified ? 0 : null,
    existingDataUnchanged,
    checkedTables: tables.length,
    failure,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    `test-results/recall-storage-${workspaceId}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.verified) process.exitCode = 1;
}
