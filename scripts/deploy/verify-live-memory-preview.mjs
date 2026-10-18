import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { getDatabase, closeDatabase } from "../../src/server/db/client.ts";
import { getServerEnv } from "../../src/server/env.ts";
import {
  createVercelCommand,
  createVercelCurlEnvironment,
} from "./vercel-cli-environment.mjs";
import {
  assertAllDeploymentsProtected,
  inspectReviewedPreviewDeployment,
  readLinkedVercelProject,
} from "./vercel-project-guard.mjs";

const deployment = process.argv
  .find((a) => a.startsWith("--deployment="))
  ?.slice(13);
const confirmation = process.argv
  .find((a) => a.startsWith("--confirm-live-memory="))
  ?.slice(22);
const link = readLinkedVercelProject("verify the live memory flow");
assertAllDeploymentsProtected(link, "verify the live memory flow");
const target = inspectReviewedPreviewDeployment(link, deployment);
if (confirmation !== target.id)
  throw new Error(
    `DRY RUN: rerun with --confirm-live-memory=${target.id}. No paid request was sent.`,
  );
const reportTag = process.argv
  .find((a) => a.startsWith("--report-tag="))
  ?.slice(13);
if (reportTag && !/^[a-z0-9-]{1,24}$/.test(reportTag))
  throw new Error("Invalid report tag.");
const callLimit = Number(
  process.argv.find((a) => a.startsWith("--call-limit="))?.slice(13) ?? "68",
);
// This is a one-run verification budget, not the web application policy.
if (![68, 90, 100].includes(callLimit))
  throw new Error("Use the reviewed verification call limit.");
const reportPath = `test-results/live-preview-memory${reportTag ? "-" + reportTag : ""}.json`;
const resumeCapture = process.argv
  .find((a) => a.startsWith("--resume-reviewed-capture="))
  ?.slice("--resume-reviewed-capture=".length);
const previousReport = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : null;
if (
  previousReport &&
  (!resumeCapture ||
    previousReport.reconciliation?.captures?.[0]?.id !== resumeCapture ||
    previousReport.reconciliation.captures[0].state !== "review")
)
  throw new Error(
    "Existing request must be reconciled before an explicit resume.",
  );
if (resumeCapture && !previousReport)
  throw new Error("Resume requires its original report.");
mkdirSync("test-results", { recursive: true });
mkdirSync("tmp/live-preview-memory", { recursive: true });
const env = getServerEnv();
const sql = getDatabase();
const idempotencyKey = previousReport?.idempotencyKey ?? randomUUID();
const marker = idempotencyKey.slice(0, 8);
const displayName = `검증용한가람${marker}`;
const topicName = `검증포장재${marker}`;
const report = {
  target: target.url,
  idempotencyKey,
  syntheticOnly: true,
  resumedCapture: resumeCapture ?? null,
  previousInterruption: previousReport?.errorCode ?? null,
  steps: [],
};
let captureId, commitResult, queryId;
function save() {
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
function request(path, body) {
  const args = ["--silent", "--show-error", "--max-time", "45"];
  if (body) {
    const file = `tmp/live-preview-memory/request-${report.steps.length}.json`;
    writeFileSync(file, JSON.stringify(body));
    args.push(
      "--request",
      "POST",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      `@${file}`,
    );
  }
  const command = createVercelCommand([
    "curl",
    path,
    "--deployment",
    target.url,
    "--",
    ...args,
    "--write-out",
    "\\n__PERSNAPSE_STATUS__:%{http_code}",
  ]);
  const result = spawnSync(command.executable, command.arguments, {
    cwd: process.cwd(),
    env: createVercelCurlEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error("PREVIEW_REQUEST_UNCERTAIN_DO_NOT_RETRY");
  const split = result.stdout.lastIndexOf("__PERSNAPSE_STATUS__:");
  if (split < 0) throw new Error("PREVIEW_RESPONSE_UNCERTAIN_DO_NOT_RETRY");
  const status = Number(
    result.stdout.slice(split + "__PERSNAPSE_STATUS__:".length),
  );
  const text = result.stdout.slice(0, split).trim();
  report.steps.push({ path: path.replace(/[0-9a-f-]{36}/g, "[id]"), status });
  save();
  if (status < 200 || status >= 300) throw new Error(`PREVIEW_HTTP_${status}`);
  return { text, json: () => JSON.parse(text) };
}
async function cleanup() {
  const [capture] =
    await sql`select id,commit_result from public.capture_sessions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and idempotency_key=${idempotencyKey}`;
  if (!capture) return;
  const owned = capture.commit_result?.personId
    ? capture.commit_result
    : commitResult;
  await sql.begin(async (tx) => {
    if (owned) {
      const [p] =
        await tx`select display_name from public.persons where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${owned.personId}`;
      assert.equal(p?.display_name, displayName);
    }
    if (queryId)
      await tx`delete from public.queries where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${queryId} and query_text like ${"%" + displayName + "%"}`;
    await tx`delete from public.provenance_records where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and source_ref=${"capture_session:" + capture.id}`;
    await tx`delete from public.capture_sessions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${capture.id} and idempotency_key=${idempotencyKey}`;
    if (owned) {
      await tx`delete from public.persons where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${owned.personId} and display_name=${displayName}`;
      await tx`delete from public.interactions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${owned.interactionId}`;
      for (const topicId of owned.topicIds)
        await tx`delete from public.topics t where t.workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and t.id=${topicId} and t.name=${topicName} and not exists(select 1 from public.interaction_topics it where it.workspace_id=t.workspace_id and it.topic_id=t.id)`;
    }
  });
  const [remaining] =
    await sql`select (select count(*) from public.capture_sessions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and idempotency_key=${idempotencyKey}) + (select count(*) from public.persons where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and display_name=${displayName}) as count`;
  assert.equal(Number(remaining.count), 0);
  report.cleanup = "synthetic rows removed; cost reservations retained";
}
try {
  const [budget] =
    await sql`select count(*)::int as used from public.ai_call_reservations where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and created_at >= date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'`;
  assert.ok(
    budget.used <= callLimit - (resumeCapture ? 5 : 6),
    "Six approved calls must remain before creating test memory.",
  );
  const unauth = await fetch(target.url, { redirect: "manual" });
  assert.ok([301, 302, 303, 307, 308, 401, 403].includes(unauth.status));
  report.unauthenticatedStatus = unauth.status;
  save();
  if (resumeCapture) {
    const [owned] =
      await sql`select id,state from public.capture_sessions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${resumeCapture} and idempotency_key=${idempotencyKey}`;
    assert.equal(owned?.state, "review");
  }
  const capture = resumeCapture
    ? request(`/api/captures/${resumeCapture}`).json()
    : request("/api/captures", {
        rawText: `합성 검증 기록입니다. 이름은 ${displayName}입니다. 세종에서 재활용 포장재를 논의했다. 만난 날짜는 기억나지 않는다. 내가 2026년 10월 5일까지 샘플 소개서를 보내기로 약속했다.`,
        idempotencyKey,
        referenceTime: "2026-09-22T02:00:00.000Z",
      }).json();
  captureId = capture.captureId;
  assert.equal(capture.state, "review");
  assert.equal(capture.draft.interaction.occurredAt, null);
  report.unknownDatePreserved = true;
  report.inferredPathsOnly = capture.draft.inferredFields.every((field) =>
    /^(identityHint|interaction|topics|memories|actions)(\.[a-zA-Z]+|\[\d+\])*$/u.test(
      field,
    ),
  );
  const draft = capture.draft;
  draft.identityHint = { displayName, organizationName: null, title: null };
  draft.interaction.eventName = null;
  draft.interaction.location = "세종 검증센터";
  draft.topics = [topicName];
  const committed = request(`/api/captures/${captureId}/commit`, {
    draft,
    identity: { mode: "new", displayName },
  }).json();
  commitResult = committed.capture.commitResult;
  assert.equal(committed.capture.state, "committed");
  assert.equal(committed.memoryDocumentStatus, "updated");
  const [stored] =
    await sql`select occurred_at,location from public.interactions where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and id=${commitResult.interactionId}`;
  assert.equal(stored.occurred_at, null);
  assert.equal(stored.location, "세종 검증센터");
  report.reviewCorrectionSaved = true;
  report.userCorrectionCount = committed.capture.userCorrectionCount;
  // Let the provider window cool without changing application timeouts.
  await new Promise((resolve) => setTimeout(resolve, 22000));
  const response = request("/api/recall", {
    query: `${displayName}과 다음 대화를 준비하려면 무엇을 하면 좋을까? 기록된 약속과 새로운 제안을 구분하고, 기한은 한국 날짜로 알려줘.`,
  }).json();
  queryId = response.queryId;
  report.recallDiagnostic = {
    status: response.status,
    mode: response.mode,
    answer: response.answer,
    clarification: response.clarification,
    latencyMs: response.latencyMs,
    metrics: response.metrics,
    peopleMatch: response.results.map(
      (r) => r.personId === commitResult.personId,
    ),
    evidenceCounts: response.results.map((r) => r.evidence.length),
    storedActionCounts: response.results.map((r) => r.storedActions.length),
    suggestions: response.results.map((r) => r.suggestion?.type ?? null),
    extractedActionDeadlines: draft.actions.map((a) => a.dueAt),
  };
  save();
  assert.equal(response.status, "resolved", "RECALL_STATUS");
  assert.equal(response.mode, "live");
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].personId, commitResult.personId);
  assert.ok(response.results[0].evidence.length > 0);
  assert.ok(
    response.results[0].storedActions.length > 0,
    "STORED_ACTION_MISSING",
  );
  assert.equal(
    response.results[0].suggestion?.type,
    "ai_suggestion",
    "SUGGESTION_MISSING",
  );
  report.koreanDeadlineInAnswer =
    /10\s*월\s*5\s*일|2026[-./]10[-./]05/u.test(response.answer) &&
    !/10\s*월\s*4\s*일/u.test(response.answer);
  assert.ok(report.koreanDeadlineInAnswer, "KOREAN_DATE_MISMATCH");
  report.recall = {
    mode: response.mode,
    latencyMs: response.latencyMs,
    metrics: response.metrics,
    storedActionCount: response.results[0].storedActions.length,
    suggestionPresent: true,
    answer: response.answer,
    analysis: response.analysis,
    suggestion: response.results[0].suggestion,
  };
  const workspace = request("/api/workspace").json().state;
  assert.ok(
    workspace.people.some((person) => person.id === commitResult.personId),
  );
  const meetingIds = new Set(
    workspace.edges
      .filter((edge) => edge.personId === commitResult.personId)
      .map((edge) => edge.meetingId),
  );
  assert.ok(
    workspace.meetings.some(
      (meeting) => meetingIds.has(meeting.id) && meeting.occurredAt === null,
    ),
  );
  report.workspaceUnknownDate = true;
  const feedback = request("/api/feedback", {
    queryId,
    kind: "helpful",
    comment: "합성 입력에 대한 자동 검증이며 실제 사용자 평가가 아닙니다.",
    elapsedMs: null,
  }).json();
  assert.equal(feedback.saved, true);
  report.feedbackSaved = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  if (error instanceof assert.AssertionError)
    report.assertion = { message: error.message, operator: error.operator };
  report.errorCode =
    error instanceof assert.AssertionError
      ? "ASSERTION_FAILED"
      : error instanceof Error &&
          /^(PREVIEW_|Six approved)/u.test(error.message)
        ? error.message
        : "VERIFICATION_FAILED";
  process.exitCode = 1;
} finally {
  try {
    if (report.errorCode?.includes("UNCERTAIN")) {
      report.cleanup = "RECONCILIATION_REQUIRED_DO_NOT_RERUN";
    } else {
      await cleanup();
    }
  } catch {
    report.cleanup = "RECONCILIATION_REQUIRED_DO_NOT_RERUN";
    process.exitCode = 1;
  }
  save();
  console.log(
    JSON.stringify({
      passed: report.passed,
      steps: report.steps,
      unknownDatePreserved: report.unknownDatePreserved,
      reviewCorrectionSaved: report.reviewCorrectionSaved,
      inferredPathsOnly: report.inferredPathsOnly,
      recallLatencyMs: report.recall?.latencyMs,
      feedbackSaved: report.feedbackSaved,
      cleanup: report.cleanup,
      errorCode: report.errorCode,
    }),
  );
  await closeDatabase();
}
