import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  assistantDatabase,
  seedAssistantDatabase,
  ids,
} from "../../tests/assistant/database";
import { executeAssistantTurn } from "../../src/server/application/assistant-service";
import {
  reconcileIndexModel,
  claimIndexJob,
  finishIndexJob,
} from "../../src/server/application/assistant-index-worker";
import { AssistantProvider } from "../../src/server/ai/assistant-provider";
import { getServerEnv } from "../../src/server/env";
import { reserveAiCall } from "../../src/server/db/ai-budget-repository";
if (!process.argv.includes("--confirm-live"))
  throw new Error(
    "Explicit --confirm-live required; budget is at most 20 provider requests.",
  );
process.env.DATABASE_URL = "postgresql://isolated.invalid/never_connect";
process.env.APP_DEFAULT_WORKSPACE_ID = ids.workspace;
process.env.AI_ROUTING_MODE = "live";
process.env.ASSISTANT_CONTEXT_ENABLED = "on";
const env = getServerEnv();
if (!env.OPENAI_API_KEY || !env.VOYAGE_API_KEY)
  throw new Error("Live verification needs both provider credentials.");
const database = await assistantDatabase();
globalThis.persnapseDatabaseClient = database.sql as unknown as Sql;
const originalFetch = globalThis.fetch;
let calls = 0;
const maxCalls = Math.min(
  20,
  Math.max(
    1,
    Number(
      process.argv
        .find((arg) => arg.startsWith("--max-calls="))
        ?.split("=")[1] ?? 20,
    ),
  ),
);
const usage: { provider: string; stage: string }[] = [];
const rawOutputs: Record<string, unknown>[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (!["api.openai.com", "api.voyageai.com"].includes(url.hostname))
    throw new Error("Verification forbids other network destinations.");
  if (calls >= maxCalls) throw new Error("Verification call budget exhausted.");
  calls++;
  const body = JSON.parse(String(init?.body ?? "{}"));
  usage.push({
    provider: url.hostname,
    stage:
      body.text?.format?.name ??
      (url.pathname.includes("rerank") ? "rerank" : "embedding"),
  });
  const response = await originalFetch(input, init);
  if (body.text?.format?.name) {
    const json = await response.clone().json();
    const output = json.output
      ?.flatMap((item: { content?: { text?: string }[] }) => item.content ?? [])
      .map((content: { text?: string }) => content.text ?? "")
      .join("");
    try {
      rawOutputs.push({
        stage: body.text.format.name,
        data: JSON.parse(output),
      });
    } catch {
      /* Error responses carry no output. */
    }
  }
  return response;
};
const results: Record<string, unknown>[] = [];
let version = 0;
const sessionId = randomUUID();
try {
  await seedAssistantDatabase(database.db);
  await database.db
    .exec(`insert into public.interactions(id,workspace_id,interaction_type,occurred_at,summary,location,source_kind,verification_status)
    values('30000000-0000-4000-8000-000000000002','${ids.workspace}','meeting','2026-10-12T10:00:00+09:00','민수가 AI 도입 파일럿 제안을 검토하기로 했다','온라인','manual','confirmed');
    insert into public.interaction_participants(workspace_id,interaction_id,person_id) values('${ids.workspace}','30000000-0000-4000-8000-000000000002','${ids.minsu}');`);
  const messages = process.argv.includes("--final")
    ? ["이번 주 누구에게 먼저 연락하면 좋을까?"]
    : process.argv.includes("--followup")
      ? [
          "민수와 다음 만남을 준비해줘",
          "확인할 질문 세 개로 줄여줘",
          "민수의 이전 AI 관심사와 이번 파일럿 제안이 어떻게 연결돼?",
          "이번 주 누구에게 먼저 연락하면 좋을까?",
        ]
      : [
          "민수와 진행 중인 이야기를 정리해줘",
          "그 사람과 다음 만남을 준비해줘",
          "확인할 질문 세 개로 줄여줘",
          "민수의 이전 AI 관심사와 이번 파일럿 제안이 어떻게 연결돼?",
          "이번 주 누구에게 먼저 연락하면 좋을까?",
        ];
  for (const [index, message] of messages.entries()) {
    const started = Date.now();
    try {
      const result = await executeAssistantTurn(ids.workspace, {
        sessionId,
        requestId: randomUUID(),
        expectedVersion: version,
        message,
      });
      if (!("schemaVersion" in result))
        throw new Error("unexpected pending turn");
      version = result.version;
      results.push({
        case: index + 1,
        message,
        latencyMs: Date.now() - started,
        purpose: result.purpose,
        status: result.status,
        coverage: result.coverage,
        context: result.context,
        answer: result.recall.answer,
        sections: result.sections,
        people: result.recall.results.map((p) => p.personId),
        metrics: result.recall.metrics,
      });
    } catch (error) {
      results.push({
        case: index + 1,
        message,
        error: error instanceof Error ? error.message : String(error),
        code:
          error instanceof Error && "code" in error
            ? String(error.code)
            : "unknown",
        cause:
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : null,
      });
    }
    if (calls >= maxCalls - 1) break;
  }
  if (
    calls < maxCalls &&
    !process.argv.includes("--followup") &&
    !process.argv.includes("--final")
  ) {
    await reconcileIndexModel(ids.workspace, env.VOYAGE_EMBEDDING_MODEL);
    const job = await claimIndexJob(ids.workspace, env.VOYAGE_EMBEDDING_MODEL);
    if (job) {
      const provider = new AssistantProvider(env, () =>
        reserveAiCall(ids.workspace, "assistant_index_embedding", env),
      );
      const completed = await finishIndexJob(
        ids.workspace,
        env.VOYAGE_EMBEDDING_MODEL,
        job,
        await provider.embed(job.content, "document"),
      );
      results.push({ case: "document_embedding", completed, dimensions: 1024 });
    }
  }
  const report = {
    providerCalls: calls,
    remoteDatabaseConnections: 0,
    models: {
      structure: env.OPENAI_STRUCTURING_MODEL,
      answer: env.OPENAI_MAIN_AGENT_MODEL,
      embedding: env.VOYAGE_EMBEDDING_MODEL,
    },
    usage,
    results,
    rawOutputs,
  };
  const reportPath = process.argv.includes("--final")
    ? "output/assistant-live-verification-final.json"
    : process.argv.includes("--followup")
      ? "output/assistant-live-verification-followup.json"
      : "output/assistant-live-verification.json";
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(
    JSON.stringify({
      providerCalls: calls,
      remoteDatabaseConnections: 0,
      cases: results.length,
      errors: results.filter((r) => "error" in r).length,
      report: reportPath,
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  globalThis.persnapseDatabaseClient = undefined;
  await database.db.close();
}
