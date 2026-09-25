// Bounded live evaluation; summaries contain no credentials or private records.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { getServerEnv } from "../../src/server/env";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { reserveAiCall } from "../../src/server/db/ai-budget-repository";
import { createAiAttemptRecorder } from "../../src/server/db/ai-run-repository";
import { createOpenAiCaptureAdapter } from "../../src/server/ai/openai-capture-adapter";
import { executeAiTask } from "../../src/server/ai/runtime-router";
import { captureDraftV1Schema } from "../../src/domain/capture/capture-draft";

if (!process.argv.includes("--confirm-live"))
  throw new Error("Explicit live approval required.");
const reportPath = "test-results/live-context-verification.json";
if (existsSync(reportPath))
  throw new Error(
    "Report already exists; inspect it before considering another paid run.",
  );
process.env.AI_ROUTING_MODE = "live";
process.env.AI_LIVE_DAILY_CALL_LIMIT = "52";
process.env.AI_LIVE_MONTHLY_CALL_LIMIT = "52";
const env = getServerEnv();
if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");
const referenceTime = "2026-09-22T02:00:00.000Z";
const cases = [
  {
    label: "unknown-encounter-date",
    rawText:
      "합성 검증 기록: 김검증과 포장재 재활용에 관해 이야기했다. 만난 날짜는 기억나지 않는다.",
    date: null,
    due: null,
  },
  {
    label: "yesterday-and-tomorrow",
    rawText:
      "합성 검증 기록: 어제 김검증을 대전 컨벤션센터에서 만났다. 포장재 재활용을 논의했고, 내가 내일까지 샘플 소개서를 보내기로 했다.",
    date: "2026-09-20T15:00:00.000Z",
    due: "2026-09-23",
  },
  {
    label: "encounter-vs-action",
    rawText:
      "합성 검증 기록: 2026년 9월 3일 김검증과 서울에서 식품 포장 공정을 논의했다. 내가 2026년 10월 5일까지 포장 샘플을 보내기로 약속했다.",
    date: "2026-09-02T15:00:00.000Z",
    due: "2026-10-05",
  },
  {
    label: "suggestion-is-not-promise",
    rawText:
      "합성 검증 기록: 김검증과 재활용 포장재를 논의했다. 추후 샘플을 보내면 좋겠다는 내 생각일 뿐, 전달하기로 약속한 것은 아니다. 만난 날짜는 모른다.",
    date: null,
    due: null,
  },
];
const nativeFetch = globalThis.fetch;
const usage: Record<string, unknown>[] = [];
globalThis.fetch = async (input, init) => {
  const started = performance.now();
  const response = await nativeFetch(input, init);
  const payload = await response
    .clone()
    .json()
    .catch(() => null);
  usage.push({
    httpStatus: response.status,
    latencyMs: Math.round(performance.now() - started),
    model: payload?.model ?? null,
    inputTokens: payload?.usage?.input_tokens ?? null,
    outputTokens: payload?.usage?.output_tokens ?? null,
    totalTokens: payload?.usage?.total_tokens ?? null,
  });
  return response;
};
const results: Record<string, unknown>[] = [];
try {
  const [schema] =
    await getDatabase()`select exists(select 1 from supabase_migrations.schema_migrations where version='20260922100000') as ready`;
  if (!schema.ready) throw new Error("Migration is required.");
  for (const item of cases) {
    const started = performance.now();
    try {
      const draft = await executeAiTask({
        task: "informationStructuring",
        environment: env,
        input: { rawText: item.rawText, referenceTime },
        outputSchema: captureDraftV1Schema,
        mockAdapter: {
          async execute() {
            throw new Error("Mock forbidden.");
          },
        },
        liveAdapters: {
          openai: createOpenAiCaptureAdapter(env.OPENAI_API_KEY),
        },
        timeoutMs: 15000,
        maxAttemptsPerRoute: 1,
        beforeLiveAttempt: (task) =>
          reserveAiCall(env.APP_DEFAULT_WORKSPACE_ID, task, env),
        onAttempt: createAiAttemptRecorder({
          workspaceId: env.APP_DEFAULT_WORKSPACE_ID,
          schemaVersion: "live-context-verification-v1",
        }),
      });
      const datePassed =
        item.date === null
          ? draft.interaction.occurredAt === null
          : !!draft.interaction.occurredAt &&
            new Date(draft.interaction.occurredAt).toISOString() === item.date;
      const duePassed =
        item.due === null
          ? draft.actions.every((a) => a.dueAt === null)
          : draft.actions.some(
              (a) =>
                a.dueAt &&
                new Intl.DateTimeFormat("sv-SE", {
                  timeZone: "Asia/Seoul",
                }).format(new Date(a.dueAt)) === item.due,
            );
      const promisePassed =
        item.label !== "suggestion-is-not-promise" ||
        draft.actions.every((a) => a.kind !== "commitment");
      const identityPassed = draft.identityHint.displayName === "김검증";
      results.push({
        label: item.label,
        passed: datePassed && duePassed && promisePassed && identityPassed,
        datePassed,
        duePassed,
        promisePassed,
        identityPassed,
        latencyMs: Math.round(performance.now() - started),
        draft,
      });
    } catch (error) {
      results.push({
        label: item.label,
        passed: false,
        errorCode:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "VERIFICATION_FAILED",
        latencyMs: Math.round(performance.now() - started),
      });
      // Configuration/provider failures stop the batch without retries.
      break;
    }
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify({ syntheticOnly: true, results, usage }, null, 2),
    );
  }
} finally {
  globalThis.fetch = nativeFetch;
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({ syntheticOnly: true, results, usage }, null, 2),
  );
  console.log(
    JSON.stringify({
      results: results.map((result) =>
        Object.fromEntries(
          Object.entries(result).filter(([key]) => key !== "draft"),
        ),
      ),
      usage,
    }),
  );
  await closeDatabase();
}

if (results.length !== cases.length || results.some((result) => !result.passed))
  process.exitCode = 1;
