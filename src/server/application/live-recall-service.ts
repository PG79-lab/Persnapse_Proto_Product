import "server-only";
import { koreanOffsetInstant } from "../../domain/recall/date-range";
import { createAiAttemptRecorder } from "../db/ai-run-repository";
import {
  assistantAnswerSchema,
  queryPlanSchema,
  evidenceKey,
  planDateRange,
  validateAssistantAnswer,
} from "../../domain/recall/assistant-contract";
import type { RecallResponse } from "../../domain/recall/types";
import { AssistantProvider } from "../ai/assistant-provider";
import { AiTaskExecutionError } from "../ai/runtime-router";
import { reserveAiCall } from "../db/ai-budget-repository";
import { loadRecallCorpus } from "../db/recall-repository";
import {
  assertSearchReady,
  retrieveMemoryCandidates,
} from "../db/memory-search-repository";
import { getServerEnv } from "../env";

export async function executeLiveRecall(
  workspaceId: string,
  query: string,
  reference: Date,
): Promise<RecallResponse> {
  const env = getServerEnv();
  await assertSearchReady(workspaceId, env.VOYAGE_EMBEDDING_MODEL);
  const provider = new AssistantProvider(
    env,
    (task) => reserveAiCall(workspaceId, task, env),
    createAiAttemptRecorder({ workspaceId, schemaVersion: "assistant-v1" }),
  );
  const plan = await provider.structured(
    "query_understanding",
    env.OPENAI_STRUCTURING_MODEL,
    queryPlanSchema,
    "Set actionKind=commitment for recorded promises (약속, 보내기로/하기로 한), follow_up or suggestion only when that specific kind is requested, otherwise null. A lookup for a person with a promise must retain actionKind even when intent=lookup. " +
      "Interpret the relationship-memory question. Preserve every explicit condition; do not add constraints. Use interaction scope for meeting place/event/topic conditions that must be true of a meeting, person scope for identity/general interests. sameInteraction=true only when the user links conditions to the same meeting. Set timeTarget=action_due for action deadlines, interaction for encounter dates. Use today/yesterday/last_month periods when stated; otherwise range with ISO calendar dates and exclusive end, or none. personName only if explicit. If the meaning or reference cannot be established, return a short clarification question. An action recommendation is not a stored promise.",
    {
      query,
      referenceTime: koreanOffsetInstant(reference.toISOString()),
      timezone: "Asia/Seoul",
    },
  );
  const empty = (
    answer: string,
    clarification: string | null,
    status: "ambiguous" | "no_result",
  ): RecallResponse => ({
    queryId: null,
    status,
    answer,
    clarification,
    analysis: "",
    results: [],
    parsedQuery: {
      normalizedQuery: query,
      terms: [],
      intents: [plan.intent === "action" ? "action" : "person_lookup"],
      dateRange: planDateRange(plan, reference),
      parserVersion: "llm-v1",
    },
    mode: "live",
    model: env.OPENAI_STRUCTURING_MODEL,
    latencyMs: 0,
    metrics: provider.metrics,
  });
  if (plan.clarification)
    return empty(plan.clarification, plan.clarification, "ambiguous");
  const vector = await provider.embed(query, "query");
  const candidates = await retrieveMemoryCandidates(
    workspaceId,
    vector,
    env.VOYAGE_EMBEDDING_MODEL,
    plan,
    reference,
  );
  if (!candidates.length)
    return empty(
      "저장된 기억에서 관련 기록을 찾지 못했습니다.",
      null,
      "no_result",
    );
  if (candidates.some((c) => c.content.length > 24000))
    throw new AiTaskExecutionError(
      "검색 문서가 처리 범위를 넘었습니다.",
      "AI_INPUT_TOO_LONG",
      false,
    );
  const indices = await provider.rerank(
    query,
    candidates.map((c) => c.content),
  );
  const corpus = await loadRecallCorpus(
    workspaceId,
    indices.map((index) => candidates[index].person_id),
  );
  const evidenceInput = corpus.map((person) => ({
    ...person,
    documentContent: undefined,
    actions: person.actions.map((action) => ({
      ...action,
      dueAt: koreanOffsetInstant(action.dueAt),
    })),
    evidence: person.evidence.map((e) => ({
      ...e,
      occurredAt: koreanOffsetInstant(e.occurredAt),
      dueAt: koreanOffsetInstant(e.dueAt),
      key: evidenceKey(e),
    })),
  }));
  if (JSON.stringify(evidenceInput).length > 90000)
    throw new AiTaskExecutionError(
      "관련 기록이 많습니다. 사람이나 기간을 좁혀 주세요.",
      "AI_INPUT_TOO_LONG",
      false,
    );
  const raw = await provider.structured(
    "memory_answer",
    env.OPENAI_MAIN_AGENT_MODEL,
    assistantAnswerSchema,
    "Action kind is authoritative: commitment is a promise, follow_up is a saved task, suggestion is a saved proposal and never a promise. For actionKind questions select the actual matching action_item; a completed action must not substitute for a different requested pending promise. Prefer specific memory_statement and action_item evidence over broad interaction summaries when they substantiate the same facts, and retain encounter evidence if needed for context. " +
      "Answer using only supplied confirmed evidence. Ranking is not proof of relevance. Every required condition needs explicit support from that person's selected evidence: return conditionEvidence for every zero-based condition index. Respect structured location vs places merely mentioned in text, encounter date vs action deadline, and sameInteraction. Never combine unrelated meetings to claim one matching meeting. Return no_result when no person satisfies the question, ambiguous with clarification when identity or meaning is unclear. Select only evidence necessary for the answer and any stored actions shown. Generated suggestions must cite selected evidence and must never be phrased as existing commitments. No invented dates, people, relationships or confidence percentages. analysis explains a grounded recommendation, or is empty. If recommending preparation today for a future deadline, say explicitly that this is a new suggestion, not today's recorded deadline. Keep answer to 1-3 concise plain-text Korean sentences without Markdown headings, lists or emphasis. Keep analysis to at most two short sentences. Put proposed action details in suggestion.title and suggestion.rationale instead of repeating them in answer. Express all dates and times in Asia/Seoul (UTC+09:00). Evidence dates already carry +09:00: use their local calendar date as written, never report a UTC date or time without converting it.",
    {
      query,
      plan,
      dateRange: planDateRange(plan, reference),
      timezone: "Asia/Seoul",
      referenceTime: koreanOffsetInstant(reference.toISOString()),
      people: evidenceInput,
    },
  );
  try {
    return {
      ...validateAssistantAnswer(
        raw,
        plan,
        corpus,
        query,
        reference,
        env.OPENAI_MAIN_AGENT_MODEL,
      ),
      metrics: provider.metrics,
    };
  } catch {
    throw new AiTaskExecutionError(
      "답변과 기록의 연결을 확인하지 못했습니다. 조건을 좁혀 다시 질문해 주세요.",
      "AI_EVIDENCE_INVALID",
      false,
    );
  }
}
