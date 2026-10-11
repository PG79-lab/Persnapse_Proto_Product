import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { mutateWorkspace } from "../../src/server/db/workspace-repository";
import { indexPersonMemory } from "../../src/server/db/memory-search-repository";
import { POST as briefing } from "../../src/app/api/briefing/route";
import { POST as recall } from "../../src/app/api/recall/route";
import type { RecallResponse } from "../../src/domain/recall/types";

if (!process.argv.includes("--confirm-live"))
  throw Error("Explicit live verification is required.");
const workspaceId = randomUUID(),
  personId = randomUUID(),
  taskId = randomUUID(),
  noteId = randomUUID();
assert.notEqual(workspaceId, process.env.APP_DEFAULT_WORKSPACE_ID);
const marker = `live-workspace-${workspaceId}`;
process.env.APP_DEFAULT_WORKSPACE_ID = workspaceId;
process.env.AI_ROUTING_MODE = "live";
process.env.BUSINESS_CARD_OCR_MODE = "mock";
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (...args) => {
  if (++providerCalls > 8)
    throw Error("Verification call budget exhausted; no automatic retry.");
  return originalFetch(...args);
};
const sql = getDatabase();
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  verified: false,
  syntheticOnly: true,
};
const request = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
try {
  await sql`insert into public.workspaces(id,name) values(${workspaceId},${marker})`;
  await mutateWorkspace(workspaceId, {
    requestId: randomUUID(),
    operations: [
      {
        type: "person.save",
        id: personId,
        version: null,
        value: {
          name: "검증하늘",
          company: "합성물류연구소",
          job: "연구원",
          email: null,
          phone: null,
          status: "pending",
          importance: 3,
          relationshipCategories: ["work"],
        },
      },
      {
        type: "note.add",
        id: noteId,
        personId,
        text: "검증하늘은 물류 포장재 실증을 담당한다. 친환경 포장재 샘플을 검토하고 있다.",
      },
      {
        type: "task.save",
        id: taskId,
        version: null,
        source: "task",
        value: {
          text: "검증하늘에게 친환경 포장재 샘플 제안서 초안 검토",
          personId,
          date: "2026-10-09",
          time: null,
          done: false,
          type: "material",
          importance: 4,
        },
      },
    ],
  });
  const started = performance.now();
  const briefingResponse = await briefing(
    request("/api/briefing", {
      note: "오늘 우선 확인할 업무를 간결하게 정리해줘.",
    }),
  );
  assert.equal(briefingResponse.status, 200, "Live briefing HTTP status");
  const result = await briefingResponse.json();
  assert.equal(result.mode, "live");
  assert(result.result.summary.length > 0);
  assert(
    result.result.priorities.length > 0 &&
      result.result.priorities.every(
        (p: { todoId: string }) => p.todoId === taskId,
      ),
  );
  report.briefing = {
    verified: true,
    elapsedMs: Math.round(performance.now() - started),
    validTaskReferences: true,
  };
  console.log("[live-workspace] briefing references the stored synthetic task");
  await indexPersonMemory(workspaceId, personId);
  const recalled = await recall(
    request("/api/recall", {
      query: "검증하늘은 어떤 일을 하고 있어?",
      referenceTime: new Date().toISOString(),
    }),
  );
  assert.equal(recalled.status, 200, "Live Recall HTTP status");
  const answer = (await recalled.json()) as RecallResponse;
  assert.equal(answer.mode, "live");
  assert(
    answer.results.some(
      (p) => p.personId === personId && p.evidence.some((e) => e.id === noteId),
    ),
  );
  assert(answer.results.every((p) => p.personId === personId));
  report.recall = {
    verified: true,
    elapsedMs: answer.latencyMs,
    status: answer.status,
    actualStoredEvidence: true,
  };
  const runs =
    await sql`select task,provider,status,count(*)::int as count from public.ai_runs where workspace_id=${workspaceId} group by task,provider,status`;
  report.providerRuns = runs;
  report.verified = true;
} catch (error) {
  report.error =
    error instanceof Error ? error.message : "Live verification failed";
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  report.providerRequests = providerCalls;
  await sql`delete from public.ai_call_reservations where workspace_id=${workspaceId}`;
  await sql`delete from public.workspaces where id=${workspaceId} and name=${marker}`;
  const tables =
    await sql`select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id'`;
  let remaining = 0;
  for (const table of tables) {
    const [r] =
      await sql`select count(*)::int as count from ${sql(`public.${table.table_name}`)} where workspace_id=${workspaceId}`;
    remaining += r.count;
  }
  report.fixtureRowsRemaining = remaining;
  if (remaining) {
    report.verified = false;
    process.exitCode = 1;
  }
  const path = `test-results/workspace-live-${workspaceId}.json`;
  await mkdir("test-results", { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath: path }, null, 2));
  await closeDatabase();
}
