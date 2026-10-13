import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  assistantDatabase,
  seedAssistantDatabase,
  ids,
} from "../../tests/assistant/database";
import {
  emptyContext,
  type AssistantResponse,
} from "../../src/domain/assistant/contracts";
import {
  reserveAssistantTurn,
  completeAssistantTurn,
  loadAssistantSession,
} from "../../src/server/db/assistant-session-repository";
import {
  reconcileIndexModel,
  claimIndexJob,
  finishIndexJob,
} from "../../src/server/application/assistant-index-worker";
import {
  retrieveCanonicalCandidates,
  validateContextSelection,
} from "../../src/server/db/assistant-search-repository";
import { localAssistantPlan } from "../../src/server/application/assistant-memory-service";
import { executeAssistantTurn } from "../../src/server/application/assistant-service";
import { loadRecallCorpus } from "../../src/server/db/recall-repository";
const instance = await assistantDatabase();
globalThis.persnapseDatabaseClient = instance.sql as unknown as Sql;
let passed = 0;
try {
  await seedAssistantDatabase(instance.db);
  const counts = await instance.db.query<{ kind: string; count: number }>(
    "select kind,count(*)::int as count from public.memory_search_units group by kind order by kind",
  );
  assert.deepEqual(counts.rows, [
    { kind: "action_item", count: 1 },
    { kind: "interaction", count: 1 },
    { kind: "memory_statement", count: 1 },
    { kind: "person_profile", count: 2 },
  ]);
  assert.equal(
    (await instance.db.query("select id from public.memory_index_jobs")).rows
      .length,
    5,
  );
  passed++;

  const plan = localAssistantPlan("민수와 진행 상황", emptyContext(), [
    { id: ids.minsu, name: "민수" },
  ]);
  const found = await retrieveCanonicalCandidates(
    ids.workspace,
    "민수와 진행 상황",
    plan,
  );
  assert.ok(
    found.candidates.some((c) => c.key === `action_item:${ids.action}`),
  );
  assert.equal(
    (await retrieveCanonicalCandidates(ids.other, "민수", plan)).candidates
      .length,
    0,
  );
  assert.equal(
    await validateContextSelection(ids.other, [ids.minsu], null),
    false,
  );
  passed++;

  await reconcileIndexModel(ids.workspace, "test-vector");
  let job = await claimIndexJob(ids.workspace, "test-vector");
  assert.ok(job);
  await instance.db.query(
    "update public.persons set display_name=display_name where id=$1",
    [ids.minsu],
  );
  const leases = await instance.db.query<{ lease_token: string }>(
    "select lease_token from public.memory_index_jobs where id=$1",
    [job.id],
  );
  assert.equal(leases.rows[0].lease_token, job.lease_token);
  const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
  assert.equal(
    await finishIndexJob(ids.workspace, "test-vector", job, vector),
    true,
  );
  assert.equal(
    await finishIndexJob(ids.workspace, "test-vector", job, vector),
    false,
  );
  passed++;

  await reconcileIndexModel(ids.workspace, "test-vector");
  // The first claim may have been this source; enqueue a new generation explicitly.
  await instance.db.query(
    "update public.memory_statements set body=body||' (수정전)' where id=$1",
    [ids.memory],
  );
  await instance.db.query(
    "update public.memory_index_jobs set next_attempt_at='2000-01-01' where unit_id in (select id from public.memory_search_units where source_id=$1)",
    [ids.memory],
  );
  job = await claimIndexJob(ids.workspace, "test-vector");
  assert.ok(job);
  await instance.db.query(
    "update public.memory_statements set body='AI 도입에 관심 없음' where id=$1",
    [ids.memory],
  );
  assert.equal(
    await finishIndexJob(ids.workspace, "test-vector", job, vector),
    false,
  );
  const changed = await instance.db.query<{
    content: string;
    embedding_status: string;
  }>(
    "select content,embedding_status from public.memory_search_units where source_id=$1",
    [ids.memory],
  );
  assert.ok(changed.rows[0].content.includes("관심 없음"));
  assert.equal(changed.rows[0].embedding_status, "pending");
  passed++;

  await instance.db.query(
    "update public.persons set archived_at=now() where id=$1",
    [ids.jisu],
  );
  const participants = await instance.db.query<{ person_id: string }>(
    "select person_id from public.memory_search_unit_people where unit_id in(select id from public.memory_search_units where source_id=$1)",
    [ids.meeting],
  );
  assert.deepEqual(
    participants.rows.map((r) => r.person_id),
    [ids.minsu],
  );
  assert.equal(
    (
      await instance.db.query(
        "select id from public.memory_search_units where source_id=$1",
        [ids.meeting],
      )
    ).rows.length,
    1,
  );
  passed++;

  const input = {
    sessionId: randomUUID(),
    requestId: randomUUID(),
    expectedVersion: 0,
    message: "민수와 최근 이야기",
  };
  const reserved = await reserveAssistantTurn(ids.workspace, input);
  assert.equal(reserved.kind, "reserved");
  assert.equal(
    (await reserveAssistantTurn(ids.workspace, input)).kind,
    "existing",
  );
  await assert.rejects(
    () =>
      reserveAssistantTurn(ids.workspace, { ...input, message: "다른 내용" }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  await assert.rejects(
    () =>
      reserveAssistantTurn(ids.workspace, {
        ...input,
        requestId: randomUUID(),
      }),
    { code: "SESSION_BUSY" },
  );
  await assert.rejects(() => reserveAssistantTurn(ids.other, input), {
    code: "SESSION_NOT_FOUND",
  });
  if (reserved.kind !== "reserved") throw new Error("reservation expected");
  await completeAssistantTurn(ids.workspace, {
    sessionId: input.sessionId,
    turnId: reserved.turnId,
    version: 1,
    context: { ...emptyContext(), personIds: [ids.minsu] },
  } as AssistantResponse);
  const restored = await loadAssistantSession(ids.workspace, input.sessionId);
  assert.equal(restored.version, 1);
  assert.deepEqual(restored.context.personIds, [ids.minsu]);
  assert.equal(
    (await reserveAssistantTurn(ids.workspace, input)).kind,
    "existing",
  );
  await assert.rejects(
    () =>
      reserveAssistantTurn(ids.workspace, {
        ...input,
        requestId: randomUUID(),
      }),
    { code: "SESSION_VERSION_CONFLICT" },
  );
  passed++;

  const expired = {
    sessionId: randomUUID(),
    requestId: randomUUID(),
    expectedVersion: 0,
    message: "그때 이야기",
  };
  const expiredReservation = await reserveAssistantTurn(ids.workspace, expired);
  await instance.db.query(
    "update public.assistant_sessions set lease_until=now()-interval '1 minute' where id=$1",
    [expired.sessionId],
  );
  const duplicate = await reserveAssistantTurn(ids.workspace, expired);
  assert.equal(duplicate.kind, "existing");
  if (duplicate.kind === "existing")
    assert.equal(duplicate.turn.status, "unknown");
  if (expiredReservation.kind === "reserved")
    await assert.rejects(
      () =>
        completeAssistantTurn(ids.workspace, {
          sessionId: expired.sessionId,
          turnId: expiredReservation.turnId,
          version: 1,
          context: emptyContext(),
        } as AssistantResponse),
      { code: "TURN_RESULT_UNKNOWN" },
    );
  passed++;
  const task = "80000000-0000-4000-8000-000000000001";
  await instance.db.query(
    "insert into public.workspace_tasks(id,workspace_id,person_id,title,due_date) values($1,$2,$3,'사용자 후속 업무','2026-10-16')",
    [task, ids.workspace, ids.minsu],
  );
  const taskCorpus = await loadRecallCorpus(ids.workspace, [ids.minsu]);
  assert.ok(
    taskCorpus[0].evidence.some(
      (e) =>
        e.type === "workspace_task" &&
        e.id === task &&
        e.actionKind === "follow_up" &&
        !e.dueHasTime,
    ),
  );
  assert.equal(
    (
      await instance.db.query(
        "select id from public.memory_search_units where source_id=$1",
        [task],
      )
    ).rows.length,
    1,
  );
  const taskPlan = {
    ...plan,
    personIds: [ids.minsu],
    purpose: "prioritize" as const,
    dueRange: { from: "2026-10-16", toExclusive: "2026-10-17" },
  };
  assert.ok(
    (
      await retrieveCanonicalCandidates(
        ids.workspace,
        "이번 주 할 일",
        taskPlan,
      )
    ).candidates.some((c) => c.key === `workspace_task:${task}`),
  );
  await instance.db.query(
    "update public.workspace_tasks set done=true where id=$1",
    [task],
  );
  assert.ok(
    !(
      await retrieveCanonicalCandidates(
        ids.workspace,
        "이번 주 할 일",
        taskPlan,
      )
    ).candidates.some((c) => c.key === `workspace_task:${task}`),
  );
  const shared = "40000000-0000-4000-8000-000000000099";
  await instance.db.query(
    `insert into public.memory_statements(id,workspace_id,interaction_id,statement_type,body,source_kind,verification_status)
    values($1,$2,$3,'context','공동 만남의 기록','manual','confirmed')`,
    [shared, ids.workspace, ids.meeting],
  );
  const sharedCorpus = await loadRecallCorpus(ids.workspace, [ids.minsu]);
  assert.ok(sharedCorpus[0].evidence.some((e) => e.id === shared));
  await assert.rejects(() =>
    instance.db.transaction(async (tx) => {
      await tx.query(
        "update public.memory_statements set body='롤백되어야 할 변경' where id=$1",
        [shared],
      );
      throw new Error("rollback fixture");
    }),
  );
  const sharedUnits = await instance.db.query<{ content: string }>(
    "select content from public.memory_search_units where source_id=$1",
    [shared],
  );
  assert.ok(sharedUnits.rows[0].content.includes("공동 만남의 기록"));
  passed++;

  process.env.DATABASE_URL = "postgresql://isolated.invalid/never_connect";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "synthetic-test-key";
  process.env.APP_DEFAULT_WORKSPACE_ID = ids.workspace;
  process.env.AI_ROUTING_MODE = "mock";
  process.env.ASSISTANT_CONTEXT_ENABLED = "on";
  const conversation = {
    sessionId: randomUUID(),
    requestId: randomUUID(),
    expectedVersion: 0,
    message: "민수와 진행 중인 이야기 정리",
  };
  const first = await executeAssistantTurn(ids.workspace, conversation);
  assert.ok("schemaVersion" in first);
  if (!("schemaVersion" in first)) throw new Error("response expected");
  assert.equal(first.version, 1);
  assert.equal(first.recall.status, "resolved");
  const second = await executeAssistantTurn(ids.workspace, {
    ...conversation,
    requestId: randomUUID(),
    expectedVersion: 1,
    message: "그 사람과 다음 만남 준비",
  });
  assert.ok(
    "schemaVersion" in second && second.context.personIds.includes(ids.minsu),
  );
  const replay = await executeAssistantTurn(ids.workspace, conversation);
  assert.ok("schemaVersion" in replay && replay.turnId === first.turnId);
  assert.equal(
    (await loadAssistantSession(ids.workspace, conversation.sessionId)).turns
      .length,
    2,
  );
  passed++;

  await instance.db.exec("set role anon");
  await assert.rejects(
    () => instance.db.query("select id from public.assistant_sessions"),
    /permission denied/,
  );
  await instance.db.exec("reset role");
  passed++;
  console.log(
    JSON.stringify({ passed, remoteConnections: 0, providerCalls: 0 }),
  );
} finally {
  globalThis.persnapseDatabaseClient = undefined;
  await instance.db.close();
}
