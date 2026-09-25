import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getServerEnv } from "../../src/server/env";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { executeRecall } from "../../src/server/application/recall-service";
import { listGoldenQueryCases } from "../../src/server/db/recall-repository";
import { assertSearchReady } from "../../src/server/db/memory-search-repository";

if (!process.argv.includes("--confirm-live"))
  throw new Error("Explicit live approval required.");
const nextActionOnly = process.argv.includes("--only=grounded-next-action");
const callLimit = Number(
  process.argv.find((arg) => arg.startsWith("--call-limit="))?.split("=")[1] ??
    "58",
);
if (![58, 68, 90].includes(callLimit))
  throw new Error("Use the explicitly reviewed call limit.");
const reportTag = process.argv
  .find((arg) => arg.startsWith("--report-tag="))
  ?.slice(13);
if (reportTag && !/^[a-z0-9-]{1,24}$/.test(reportTag))
  throw new Error("Invalid report tag.");
const reportPath = nextActionOnly
  ? `test-results/live-recall-next-action${reportTag ? "-" + reportTag : ""}.json`
  : "test-results/live-recall-verification.json";
if (existsSync(reportPath))
  throw new Error("Report exists; paid rerun refused.");
process.env.AI_ROUTING_MODE = "live";
process.env.AI_LIVE_DAILY_CALL_LIMIT = String(callLimit);
process.env.AI_LIVE_MONTHLY_CALL_LIMIT = String(callLimit);
const env = getServerEnv();
const usage: Record<string, unknown>[] = [];
const results: Record<string, unknown>[] = [];
const originalFetch = globalThis.fetch;
let activeLabel = "";
let lastCaseAt = 0;
// Pace separate paid requests; never retry a failed request.
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const started = performance.now();
  const response = await originalFetch(input, init);
  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  const request = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  usage.push({
    case: activeLabel,
    provider: url.includes("voyageai") ? "voyage" : "openai",
    model: request.model,
    httpStatus: response.status,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: payload?.usage?.input_tokens ?? null,
    outputTokens: payload?.usage?.output_tokens ?? null,
    totalTokens: payload?.usage?.total_tokens ?? null,
  });
  return response;
};
try {
  await assertSearchReady(
    env.APP_DEFAULT_WORKSPACE_ID,
    env.VOYAGE_EMBEDDING_MODEL,
  );
  const golden = await listGoldenQueryCases(env.APP_DEFAULT_WORKSPACE_ID);
  const categories = [
    "identity_ambiguity",
    "place",
    "organization",
    "time",
    "action",
  ];
  const selected = categories.map((category) =>
    golden.find((c) => c.category === category)!,
  );
  const unknown = golden.find((c) => c.expectationStatus === "no_result")!;
  const topic = golden.find(
    (c) => c.category === "topic" && c.expectationStatus === "resolved",
  )!;
  if (selected.some((c) => !c) || !unknown || !topic)
    throw new Error("Required evaluation fixtures missing.");
  const reference = "2026-09-22T02:00:00.000Z";
  const due = await getDatabase()<
    { person_id: string }[]
  >`select distinct person_id from public.action_items where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and status='pending' and verification_status='confirmed' and due_at >= '2026-09-22T00:00:00+09:00'::timestamptz and due_at < '2026-09-23T00:00:00+09:00'::timestamptz`;
  const cases = [
    ...selected.map((c) => ({ ...c, requiresSuggestion: false })),
    { ...unknown, requiresSuggestion: false },
    {
      ...topic,
      label: "paraphrase-investment-criteria",
      queryText:
        "제품을 사람들이 계속 쓰는지, 실제 후속 활동으로 이어지는지를 보고 투자 판단한다던 분은 누구였지?",
      requiresSuggestion: false,
    },
    {
      label: "same-meeting-negative",
      queryText:
        "코엑스에서 만났던 바로 그 자리에서 9월 파일럿 제안서를 보내기로 약속한 사람",
      referenceTime: reference,
      expectationStatus: "no_result",
      expectedPersonIds: [],
      expectedEvidenceIds: [],
      requiresSuggestion: false,
    },
    {
      label: "today-deadline-only",
      queryText:
        "오늘이 기한인 미완료 약속만 알려줘. 미래 기한 약속이나 새로운 제안은 제외해줘.",
      referenceTime: reference,
      expectationStatus: due.length ? "resolved" : "no_result",
      expectedPersonIds: due.map((r) => r.person_id),
      expectedEvidenceIds: [],
      requiresSuggestion: false,
    },
    {
      label: "grounded-next-action",
      queryText:
        "한울 모빌리티 김민준 사업개발 리드와 다음 미팅을 준비하려면 무엇을 확인하면 좋을까? 기록된 약속과 새 제안을 구분해서 알려줘.",
      referenceTime: reference,
      expectationStatus: "resolved",
      expectedPersonIds: selected[4].expectedPersonIds,
      expectedEvidenceIds: [],
      requiresSuggestion: true,
    },
  ];
  for (const item of cases.filter(
    (item) => !nextActionOnly || item.label === "grounded-next-action",
  )) {
    const delay = Math.max(0, lastCaseAt + 26000 - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastCaseAt = Date.now();
    const [budget] = await getDatabase()<
      { day: number; month: number }[]
    >`select count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')::int as day,count(*)::int as month from public.ai_call_reservations where workspace_id=${env.APP_DEFAULT_WORKSPACE_ID} and created_at >= date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'`;
    if (Math.max(budget.day, budget.month) + 4 > callLimit) {
      results.push({
        label: item.label,
        passed: false,
        errorCode: "INSUFFICIENT_BUDGET_FOR_COMPLETE_RECALL",
      });
      break;
    }
    activeLabel = item.label;
    const start = performance.now();
    try {
      const response = await executeRecall({
        workspaceId: env.APP_DEFAULT_WORKSPACE_ID,
        queryText: item.queryText,
        referenceTime: new Date(item.referenceTime),
        persist: false,
      });
      const ids = response.results.map((r) => r.personId);
      const evidenceIds = response.results.flatMap((r) =>
        r.evidence.map((e) => e.id),
      );
      const statusPassed = response.status === item.expectationStatus;
      // Preserve strict Golden expectations; report clarification-only separately.
      const peoplePassed =
        item.expectationStatus === "ambiguous"
          ? item.expectedPersonIds.every((id) => ids.includes(id))
          : item.expectationStatus === "no_result"
            ? ids.length === 0
            : ids.length > 0 &&
              ids.every((id) => item.expectedPersonIds.includes(id)) &&
              item.expectedPersonIds.every((id) => ids.includes(id));
      const evidencePassed = item.expectedEvidenceIds.every((id) =>
        evidenceIds.includes(id),
      );
      const suggestionPassed =
        !item.requiresSuggestion ||
        response.results.some(
          (result) => result.suggestion?.type === "ai_suggestion",
        );
      results.push({
        label: item.label,
        passed:
          statusPassed && peoplePassed && evidencePassed && suggestionPassed,
        suggestionPassed,
        statusPassed,
        peoplePassed,
        evidencePassed,
        requiresSuggestion: item.requiresSuggestion,
        clarificationOnly:
          response.status === "ambiguous" &&
          !!response.clarification &&
          ids.length === 0,
        latencyMs: response.latencyMs,
        response,
      });
      console.log(
        JSON.stringify({
          label: item.label,
          status: response.status,
          statusPassed,
          peoplePassed,
          evidencePassed,
          latencyMs: response.latencyMs,
        }),
      );
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "code" in error
          ? error.code
          : "RECALL_FAILED";
      results.push({
        label: item.label,
        passed: false,
        errorCode,
        latencyMs: Math.round(performance.now() - start),
      });
      console.log(JSON.stringify({ label: item.label, errorCode }));
      if (
        typeof errorCode === "string" &&
        (errorCode.includes("HTTP_") ||
          errorCode.includes("BUDGET") ||
          errorCode === "AI_REQUEST_FAILED")
      )
        break;
    }
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(
        { persist: false, pacedVoyage: true, results, usage },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.log(
    JSON.stringify({
      errorCode:
        error && typeof error === "object" && "code" in error
          ? error.code
          : "PREFLIGHT_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      { persist: false, pacedVoyage: true, results, usage },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      completed: results.length,
      passed: results.filter((r) => r.passed).length,
      providerRequests: usage.length,
    }),
  );
  await closeDatabase();
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
