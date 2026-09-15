import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  captureCommitResultSchema,
  type CaptureCommitResult,
} from "../../src/domain/capture/capture-workflow";
import {
  commitReviewedTextCapture,
  createAndStructureTextCapture,
} from "../../src/server/application/capture-service";
import { executeRecall } from "../../src/server/application/recall-service";
import { closeDatabase, getDatabase } from "../../src/server/db/client";
import { getServerEnv } from "../../src/server/env";

const liveMode = process.argv.includes("--live");

if (liveMode) {
  process.env.AI_ROUTING_MODE = "live";
}

const environment = getServerEnv();
const sql = getDatabase();
const runId = randomUUID().slice(0, 8);
const idempotencyKey = randomUUID();
const displayName = `Phase4검증${runId}`;
const organizationName = `Phase4검증조직${runId}`;
const eventName = `Phase4 검증 포럼 ${runId}`;
const topicName = `phase4검증물류${runId}`;
let captureId: string | null = null;
let commitResult: CaptureCommitResult | null = null;

function persistedCommitResult(value: unknown): CaptureCommitResult | null {
  let parsedValue = value;

  if (typeof parsedValue === "string") {
    try {
      parsedValue = JSON.parse(parsedValue) as unknown;
    } catch {
      return null;
    }
  }

  const parsed = captureCommitResultSchema.safeParse(parsedValue);
  return parsed.success ? parsed.data : null;
}

async function cleanup(): Promise<void> {
  const captures = captureId
    ? await sql<
        Array<{
          id: string;
          commit_result: CaptureCommitResult | null;
        }>
      >`
        select id, nullif(commit_result, '{}'::jsonb) as commit_result
        from public.capture_sessions
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${captureId}
      `
    : await sql<
        Array<{
          id: string;
          commit_result: CaptureCommitResult | null;
        }>
      >`
        select id, nullif(commit_result, '{}'::jsonb) as commit_result
        from public.capture_sessions
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and idempotency_key = ${idempotencyKey}
      `;
  const storedCapture = captures[0];
  const storedResult = persistedCommitResult(
    commitResult ?? storedCapture?.commit_result ?? null,
  );
  const storedCaptureId = storedCapture?.id ?? captureId;
  const aiRuns = storedCaptureId
    ? await sql<Array<{ id: string }>>`
        select id
        from public.ai_runs
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and capture_session_id = ${storedCaptureId}
      `
    : [];

  if (storedCaptureId) {
    await sql`
      delete from public.provenance_records
      where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
        and source_ref = ${`capture_session:${storedCaptureId}`}
    `;
    await sql`
      delete from public.capture_sessions
      where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
        and id = ${storedCaptureId}
    `;
  }

  if (storedResult) {
    await sql`
      delete from public.persons
      where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
        and id = ${storedResult.personId}
        and display_name = ${displayName}
    `;
    await sql`
      delete from public.interactions
      where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
        and id = ${storedResult.interactionId}
    `;

    if (storedResult.eventId) {
      await sql`
        delete from public.events
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${storedResult.eventId}
          and not exists (
            select 1
            from public.interactions
            where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
              and event_id = ${storedResult.eventId}
          )
      `;
    }

    if (storedResult.organizationId) {
      await sql`
        delete from public.organizations
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${storedResult.organizationId}
          and not exists (
            select 1
            from public.affiliations
            where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
              and organization_id = ${storedResult.organizationId}
          )
      `;
    }

    for (const topicId of storedResult.topicIds) {
      await sql`
        delete from public.topics
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${topicId}
          and not exists (
            select 1
            from public.interaction_topics
            where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
              and topic_id = ${topicId}
          )
      `;
    }
  }

  for (const run of aiRuns) {
    await sql`
      delete from public.ai_runs
      where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
        and id = ${run.id}
    `;
  }
}

try {
  assert.equal(environment.AI_ROUTING_MODE, liveMode ? "live" : "mock");

  const capture = await createAndStructureTextCapture({
    workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
    rawText: `이름: ${displayName}, 회사: ${organizationName}. ${eventName}에서 물류 실증을 논의했고 후속 자료를 보내기로 했다.`,
    idempotencyKey,
    referenceTime: "2026-09-15T12:00:00+09:00",
  });
  captureId = capture.captureId;
  assert.equal(capture.state, "review");
  assert.ok(capture.draft);

  const beforeCommit = await sql<Array<{ people: number; documents: number }>>`
    select
      (
        select count(*)::integer
        from public.persons
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and display_name = ${displayName}
      ) as people,
      (
        select count(*)::integer
        from public.memory_documents
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and content ilike ${`%${topicName}%`}
      ) as documents
  `;
  assert.equal(beforeCommit[0].people, 0);
  assert.equal(beforeCommit[0].documents, 0);

  const reviewedDraft = {
    ...capture.draft,
    identityHint: {
      displayName,
      organizationName,
      title: "검증 리드",
    },
    interaction: {
      ...capture.draft.interaction,
      occurredAt: "2026-09-15T12:00:00+09:00",
      eventName,
      location: "코엑스",
      summary: `${topicName}를 논의하고 후속 자료 전달을 약속했다.`,
    },
    topics: [topicName],
    memories: [
      {
        statementType: "context" as const,
        body: `${topicName} 파트너를 찾고 있다.`,
        occurredAt: "2026-09-15T12:00:00+09:00",
      },
    ],
    actions: [
      {
        kind: "commitment" as const,
        title: `${topicName} 후속 자료 전달`,
        details: null,
        dueAt: null,
      },
    ],
    inferredFields: [],
  };
  const firstCommit = await commitReviewedTextCapture({
    workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
    captureId,
    draft: reviewedDraft,
    identity: { mode: "new", displayName },
  });
  commitResult = firstCommit.capture.commitResult;
  assert.ok(commitResult);
  assert.equal(firstCommit.memoryDocumentStatus, "updated");

  const secondCommit = await commitReviewedTextCapture({
    workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
    captureId,
    draft: reviewedDraft,
    identity: { mode: "new", displayName },
  });
  assert.equal(
    secondCommit.capture.commitResult?.personId,
    commitResult.personId,
  );
  assert.equal(
    secondCommit.capture.commitResult?.interactionId,
    commitResult.interactionId,
  );

  const committedRows = await sql<
    Array<{
      people: number;
      interactions: number;
      corrections: number;
      draft: unknown;
      documents: number;
    }>
  >`
    select
      (
        select count(*)::integer
        from public.persons
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${commitResult.personId}
      ) as people,
      (
        select count(*)::integer
        from public.interactions
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and id = ${commitResult.interactionId}
      ) as interactions,
      capture.user_correction_count::integer as corrections,
      capture.structured_draft as draft,
      (
        select count(*)::integer
        from public.memory_documents
        where workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
          and person_id = ${commitResult.personId}
          and content ilike ${`%${topicName}%`}
          and embedding_status = 'pending'
      ) as documents
    from public.capture_sessions capture
    where capture.workspace_id = ${environment.APP_DEFAULT_WORKSPACE_ID}
      and capture.id = ${captureId}
  `;
  assert.equal(committedRows[0].people, 1);
  assert.equal(committedRows[0].interactions, 1);
  assert.equal(committedRows[0].corrections, 1);
  const persistedDraft =
    typeof committedRows[0].draft === "string"
      ? (JSON.parse(committedRows[0].draft) as unknown)
      : committedRows[0].draft;
  assert.deepEqual(persistedDraft, reviewedDraft);
  assert.equal(committedRows[0].documents, 1);

  const recall = await executeRecall({
    workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
    queryText: `${topicName} 이야기한 사람`,
    referenceTime: new Date("2026-09-15T12:00:00+09:00"),
    persist: false,
  });
  assert.equal(recall.status, "resolved");
  assert.equal(recall.results[0]?.personId, commitResult.personId);
  assert.ok(recall.results[0]?.evidence.length);

  console.log(
    JSON.stringify(
      {
        verified: true,
        routingMode: environment.AI_ROUTING_MODE,
        draftIsolation: true,
        explicitIdentity: true,
        atomicCommit: true,
        idempotentCommit: true,
        correctionPreserved: true,
        memoryDocumentUpdated: true,
        immediateRecall: true,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await cleanup();
  } finally {
    await closeDatabase();
  }
}
