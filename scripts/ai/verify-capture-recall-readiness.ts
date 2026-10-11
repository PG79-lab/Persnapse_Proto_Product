import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { POST as capture } from "../../src/app/api/captures/route";
import { POST as commit } from "../../src/app/api/captures/[captureId]/commit/route";
import { POST as recall } from "../../src/app/api/recall/route";
import { POST as observation } from "../../src/app/api/recall/observation/route";
import { POST as feedback } from "../../src/app/api/feedback/route";
import type { CaptureDraftV1 } from "../../src/domain/capture/capture-draft";
import type {
  CaptureSessionView,
  CaptureCommitResponse,
} from "../../src/domain/capture/capture-workflow";
import type { RecallResponse } from "../../src/domain/recall/types";
import { loadRecallCorpus } from "../../src/server/db/recall-repository";
import { getDatabase, closeDatabase } from "../../src/server/db/client";

// Mutations are restricted to a newly created disposable workspace. Original
// records and env files are untouched. Route invocation is not a browser E2E.
if (
  !process.argv.includes("--confirm-live") ||
  !process.argv.includes("--confirm-test-writes")
) {
  console.error(
    "Pass --confirm-live --confirm-test-writes: six provider requests maximum, isolated fixtures only.",
  );
  process.exit(2);
}
const reportTag = process.argv
  .find((arg) => arg.startsWith("--report-tag="))
  ?.slice(13);
assert(
  !reportTag || /^[a-z0-9-]{1,24}$/.test(reportTag),
  "Invalid report tag.",
);
const reportPath = `test-results/capture-recall-readiness-20261008${reportTag ? `-${reportTag}` : ""}.json`;
assert(
  !existsSync(reportPath),
  "Inspect the existing report before another paid run.",
);
const originalWorkspace = process.env.APP_DEFAULT_WORKSPACE_ID ?? "";
assert(originalWorkspace);
const workspaceId = randomUUID();
const workspaceName = `Capture Recall readiness ${workspaceId}`;
assert.notEqual(workspaceId, originalWorkspace);
process.env.APP_DEFAULT_WORKSPACE_ID = workspaceId;
process.env.AI_ROUTING_MODE = "live";
process.env.APP_REMOTE_PROTOTYPE_ACCESS = "off";
const sql = getDatabase();
const originalFetch = globalThis.fetch;
const usage: Array<{
  stage: string;
  model: string;
  httpStatus: number;
  totalTokens: number | null;
}> = [];
const checks: Array<{ name: string; passed: boolean }> = [];
let stage = "setup";
let failure: string | null = null;
let tables: string[] = [];
let before: Record<string, unknown> | undefined;
let existingDataUnchanged = false;
let cleanupVerified = false;
let latencyMs: number | null = null;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  assert(
    [
      "https://api.openai.com/v1/responses",
      "https://api.voyageai.com/v1/embeddings",
      "https://api.voyageai.com/v1/rerank",
    ].includes(url),
  );
  assert(usage.length < 6, "Six-request cap reached; no retry.");
  const body = JSON.parse(String(init?.body)) as { model: string };
  const item = {
    stage,
    model: body.model,
    httpStatus: 0,
    totalTokens: null as number | null,
  };
  usage.push(item);
  const response = await originalFetch(input, init);
  item.httpStatus = response.status;
  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  item.totalTokens = payload?.usage?.total_tokens ?? null;
  return response;
};
function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function body<T>(response: Response, status = 200): Promise<T> {
  if (response.status !== status) {
    const payload = await response.json().catch(() => ({}));
    const code =
      typeof payload.code === "string" && /^[A-Z0-9_]{1,64}$/.test(payload.code)
        ? payload.code
        : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return response.json() as Promise<T>;
}
async function snapshot() {
  const rows: Record<string, unknown> = {};
  for (const table of tables) {
    const [row] =
      await sql`select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(entry)::text, '' order by to_jsonb(entry)::text), '')) as digest
      from ${sql(`public.${table}`)} entry where workspace_id = ${originalWorkspace}`;
    rows[table] = row;
  }
  return rows;
}
function passed(name: string) {
  checks.push({ name, passed: true });
  console.log(JSON.stringify({ name, passed: true }));
}
try {
  const rows = await sql<
    { table_name: string }[]
  >`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' order by table_name`;
  tables = rows.map((row) => row.table_name);
  before = await snapshot();
  await sql`insert into public.workspaces(id, name) values (${workspaceId}, ${workspaceName})`;
  const referenceTime = "2026-10-08T10:00:00+09:00";
  const displayName = `합성검증 ${workspaceId.slice(0, 8)}`;
  stage = "live-capture";
  const session = await body<CaptureSessionView>(
    await capture(
      request("/api/captures", {
        rawText: `이름: ${displayName}, 회사: 검증제조사, 직책: 프로젝트 담당. 날짜는 기억나지 않지만 서울 검증 공간에서 포장 샘플을 논의했다. 내가 2026년 10월 10일 오후 6시까지 검증 제안서를 전달하기로 약속했다. 연락 방식을 검토하는 것은 제안일 뿐 약속은 아니다.`,
        referenceTime,
        idempotencyKey: randomUUID(),
      }),
    ),
    201,
  );
  assert.equal(session.state, "review");
  assert(session.modelDraft && session.draft);
  const [unconfirmed] =
    await sql`select count(*)::int as count from public.persons where workspace_id = ${workspaceId}`;
  assert.equal(unconfirmed.count, 0);
  passed("live-structure-stays-draft-until-confirmed");
  const draft: CaptureDraftV1 = {
    ...session.draft,
    identityHint: {
      displayName,
      organizationName: "검증제조사",
      title: "사용자 확인 담당자",
    },
    interaction: {
      interactionType: "meeting",
      occurredAt: null,
      eventName: null,
      location: "대전 검증 공간",
      summary: "포장 샘플 논의 후 검증 제안서 전달을 약속했다.",
    },
    topics: ["포장 샘플"],
    memories: [
      {
        statementType: "context",
        body: "포장 샘플 논의. 만남 날짜는 미상이고 실제 장소는 대전 검증 공간이다.",
        occurredAt: null,
      },
    ],
    actions: [
      {
        kind: "commitment",
        title: "검증 제안서 전달",
        details: "포장 샘플 검토 내용을 담는다.",
        dueAt: "2026-10-10T18:00:00+09:00",
      },
      {
        kind: "suggestion",
        title: "연락 방식 검토",
        details: "약속이 아닌 사용자 확인 제안",
        dueAt: "2026-10-09T18:00:00+09:00",
      },
    ],
    inferredFields: [],
  };
  stage = "confirmed-commit-and-embedding";
  const saved = await body<CaptureCommitResponse>(
    await commit(
      request(`/api/captures/${session.captureId}/commit`, {
        draft,
        identity: { mode: "new", displayName },
      }),
      { params: Promise.resolve({ captureId: session.captureId }) },
    ),
  );
  assert.equal(saved.capture.state, "committed");
  assert.equal(saved.memoryDocumentStatus, "updated");
  assert(saved.capture.commitResult);
  const personId = saved.capture.commitResult.personId;
  const corpus = await loadRecallCorpus(workspaceId, [personId]);
  assert.equal(corpus.length, 1);
  assert(
    corpus[0].evidence.some(
      (e) =>
        e.type === "interaction" &&
        e.location === "대전 검증 공간" &&
        e.occurredAt === null,
    ),
  );
  const promise = corpus[0].actions.find((a) => a.kind === "commitment")!;
  assert(promise);
  assert.equal(promise.dueAt, "2026-10-10T09:00:00.000Z");
  assert.equal(
    corpus[0].actions.filter((a) => a.kind === "suggestion").length,
    1,
  );
  passed("confirmed-corrections-unknown-date-and-action-kinds-preserved");
  await delay(22000); // Outside model timeout/latency, not an automatic retry.
  stage = "live-persisted-recall";
  const answer = await body<RecallResponse>(
    await recall(
      request("/api/recall", {
        query: `${displayName}와 내가 약속한 업무와 기한을 알려줘`,
        referenceTime,
      }),
    ),
  );
  assert.equal(answer.mode, "live");
  assert.equal(answer.status, "resolved");
  assert(answer.queryId);
  assert.deepEqual(
    answer.results.map((r) => r.personId),
    [personId],
  );
  assert(
    answer.results[0].evidence.some(
      (e) => e.type === "action_item" && e.id === promise.id,
    ),
  );
  assert.deepEqual(
    answer.results[0].storedActions.map((a) => [a.id, a.kind, a.executes]),
    [[promise.id, "commitment", false]],
  );
  assert(
    answer.results[0].evidence.every((e) =>
      corpus[0].evidence.some(
        (stored) =>
          stored.type === e.type &&
          stored.id === e.id &&
          stored.text === e.excerpt,
      ),
    ),
  );
  const [query] =
    await sql`select id, jsonb_typeof(parsed_query) as parsed_type, jsonb_typeof(response_payload) as response_type,
      jsonb_typeof(retrieval_trace) as trace_type from public.queries where workspace_id = ${workspaceId} and id = ${answer.queryId}`;
  assert(query);
  assert.equal(query.parsed_type, "object");
  assert.equal(query.response_type, "object");
  assert.equal(query.trace_type, "object");
  latencyMs = answer.latencyMs;
  passed("live-recall-cites-actual-promise-and-persists-query");
  stage = "observation-and-feedback";
  assert.equal(
    (
      await observation(
        request("/api/recall/observation", {
          queryId: randomUUID(),
          elapsedMs: 100,
        }),
      )
    ).status,
    404,
  );
  await body(
    await observation(
      request("/api/recall/observation", {
        queryId: answer.queryId,
        elapsedMs: 12345,
      }),
    ),
  );
  assert.equal(
    (
      await feedback(
        request("/api/feedback", {
          queryId: randomUUID(),
          kind: "helpful",
          comment: null,
          elapsedMs: null,
        }),
      )
    ).status,
    404,
  );
  await body(
    await feedback(
      request("/api/feedback", {
        queryId: answer.queryId,
        kind: "helpful",
        comment: "합성 연결 검증 — 실제 사용자 만족도에서 제외",
        elapsedMs: null,
      }),
    ),
  );
  const [recorded] =
    await sql`select (retrieval_trace->>'clientElapsedMs')::int as elapsed from public.queries where workspace_id = ${workspaceId} and id = ${answer.queryId}`;
  assert.equal(recorded.elapsed, 12345);
  const [evaluations] =
    await sql`select count(*)::int as count from public.feedback where workspace_id = ${workspaceId} and query_id = ${answer.queryId}`;
  assert.equal(evaluations.count, 1);
  passed("observation-and-feedback-404-and-success-contracts");
  const [reservations] =
    await sql`select count(*)::int as count from public.ai_call_reservations where workspace_id = ${workspaceId}`;
  assert.equal(reservations.count, usage.length);
  assert.equal(usage.length, 6);
  assert(usage.every((item) => item.httpStatus === 200));
  passed("six-provider-requests-no-retry-and-reservation-accounting");
} catch (error) {
  failure =
    error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message)
      ? error.message
      : "VERIFICATION_FAILED";
  checks.push({ name: stage, passed: false });
} finally {
  try {
    assert.notEqual(workspaceId, originalWorkspace);
    await sql`delete from public.ai_call_reservations where workspace_id = ${workspaceId}
      and exists (select 1 from public.workspaces where id = ${workspaceId} and name = ${workspaceName})`;
    await sql`delete from public.workspaces where id = ${workspaceId} and name = ${workspaceName}`;
    for (const table of tables) {
      const [row] =
        await sql`select count(*)::int as count from ${sql(`public.${table}`)} where workspace_id = ${workspaceId}`;
      assert.equal(row.count, 0);
    }
    const [residue] =
      await sql`select count(*)::int as count from public.workspaces where id = ${workspaceId}`;
    assert.equal(residue.count, 0);
    cleanupVerified = true;
    if (before) {
      assert.deepEqual(await snapshot(), before);
      existingDataUnchanged = true;
    }
  } catch {
    failure ??= "CLEANUP_OR_DATA_CHECK_FAILED";
  }
  globalThis.fetch = originalFetch;
  await closeDatabase();
  const report = {
    checkedAt: new Date().toISOString(),
    verified: !failure && cleanupVerified && existingDataUnchanged,
    execution: "actual-route-handlers-remote-db-live-providers",
    isolatedWorkspace: true,
    modeOverride: "process-only",
    checks,
    providerRequests: usage.length,
    maxProviderRequests: 6,
    usage,
    latencyMs,
    failure,
    failedStage: failure ? stage : null,
    cleanupVerified,
    fixtureRows: cleanupVerified ? 0 : null,
    existingDataUnchanged,
    checkedTables: tables.length,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.verified) process.exitCode = 1;
}
