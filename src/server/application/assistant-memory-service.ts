import "server-only";
import {
  assistantPlanSchema,
  AssistantError,
  emptyContext,
  sectionSchema,
  validateSections,
  includeSectionEvidence,
  type AssistantPlan,
  type AssistantContext,
  type AssistantSection,
  type ContextSelection,
  type SearchCoverage,
} from "../../domain/assistant/contracts";
import {
  buildContextPack,
  fuseCandidates,
} from "../../domain/assistant/retrieval";
import {
  assistantAnswerSchema,
  evidenceKey,
  planDateRange,
  validateAssistantAnswer,
} from "../../domain/recall/assistant-contract";
import { koreanOffsetInstant } from "../../domain/recall/date-range";
import { parseRecallQuery } from "../../domain/recall/query-parser";
import type {
  RecallResponse,
  RecallCorpusPerson,
} from "../../domain/recall/types";
import { AssistantProvider } from "../ai/assistant-provider";
import { getServerEnv } from "../env";
import { reserveAiCall } from "../db/ai-budget-repository";
import { createAiAttemptRecorder } from "../db/ai-run-repository";
import { loadRecallCorpus } from "../db/recall-repository";
import {
  listAssistantPeople,
  validateContextSelection,
  retrieveCanonicalCandidates,
  retrieveUnitVectors,
  inspectUnitReadiness,
  attachAssistantProvenance,
} from "../db/assistant-search-repository";

const answerSchema = assistantAnswerSchema
  .extend({ sections: sectionSchema.array().max(8) })
  .strict();
const referencePattern =
  /그\s*(사람|분|때|만남|이야기)|그에게|이어서|앞서|방금|다시|줄여|늘려/;
const widerPattern = /전체|모든|다른 사람|새로운 주제/;
function namedPeople(query: string, people: { id: string; name: string }[]) {
  return people.filter(
    (p) =>
      query.includes(p.name) &&
      !people.some(
        (other) =>
          other.name.length > p.name.length &&
          other.name.includes(p.name) &&
          query.includes(other.name),
      ),
  );
}
export function localAssistantPlan(
  query: string,
  context: AssistantContext,
  people: { id: string; name: string }[],
  selection?: ContextSelection,
  reference = new Date(),
): AssistantPlan {
  const parsed = parseRecallQuery(query, reference);
  const named = namedPeople(query, people);
  const duplicateNames = new Set(named.map((p) => p.name)).size < named.length;
  const followup = referencePattern.test(query);
  const personIds =
    selection?.personIds ??
    (named.length === 1
      ? [named[0].id]
      : named.length > 1
        ? duplicateNames
          ? []
          : named.slice(0, 5).map((p) => p.id)
        : widerPattern.test(query)
          ? []
          : context.personIds);
  const purpose = /준비|초안|질문\s*\d|줄여/.test(query)
    ? "prepare"
    : /먼저|우선|추천/.test(query)
      ? "prioritize"
      : /연결|비교|차이/.test(query)
        ? "connect"
        : /정리|요약|진행/.test(query)
          ? "summarize"
          : "lookup";
  const target = parsed.intents.includes("action")
    ? "action_due"
    : "interaction";
  const calendar = (date: string) =>
    new Date(Date.parse(date) + 9 * 3600000).toISOString().slice(0, 10);
  const range = parsed.dateRange
    ? {
        from: calendar(parsed.dateRange.from),
        toExclusive: calendar(parsed.dateRange.to),
      }
    : null;
  return {
    intent:
      purpose === "prioritize"
        ? "action"
        : purpose === "lookup"
          ? "lookup"
          : "analysis",
    personName: named.length === 1 ? named[0].name : null,
    personIds,
    interactionId:
      selection?.interactionId !== undefined
        ? selection.interactionId
        : followup && !named.length
          ? context.interactionId
          : null,
    meetingRange:
      selection?.meetingRange !== undefined
        ? selection.meetingRange
        : target === "interaction" && range
          ? range
          : followup
            ? context.meetingRange
            : null,
    dueRange:
      selection?.dueRange !== undefined
        ? selection.dueRange
        : target === "action_due" && range
          ? range
          : followup
            ? context.dueRange
            : null,
    conditions: [],
    sameInteraction: /그때|그 만남/.test(query),
    timeTarget: target,
    actionKind: /약속|보내기로|하기로/.test(query) ? "commitment" : null,
    period: "none",
    fromDate: null,
    toDateExclusive: null,
    clarification:
      duplicateNames && !selection?.personIds?.length
        ? "동명이인이 있습니다. 어느 인물인지 선택해 주세요."
        : followup && !personIds.length && !selection?.interactionId
          ? "어느 인물이나 만남을 말씀하시나요?"
          : null,
    purpose,
    goal: query,
  };
}

export async function executeAssistantMemory(input: {
  workspaceId: string;
  query: string;
  context?: AssistantContext;
  selection?: ContextSelection;
  recent?: { message: string; answer: string }[];
  reference?: Date;
}) {
  const started = performance.now();
  const env = getServerEnv();
  const reference = input.reference ?? new Date();
  let context = input.context ?? emptyContext();
  if (
    !(await validateContextSelection(
      input.workspaceId,
      context.personIds,
      context.interactionId,
    ))
  )
    context = emptyContext();
  if (
    input.selection &&
    !(await validateContextSelection(
      input.workspaceId,
      input.selection.personIds ?? [],
      input.selection.interactionId ?? null,
    ))
  )
    throw new AssistantError(
      "CONTEXT_NOT_FOUND",
      "선택한 인물 또는 만남이 현재 기록에 없습니다.",
      400,
    );
  const people = await listAssistantPeople(input.workspaceId);
  const provider = new AssistantProvider(
    env,
    (task) => reserveAiCall(input.workspaceId, task, env),
    createAiAttemptRecorder({
      workspaceId: input.workspaceId,
      schemaVersion: "assistant-v1",
    }),
    { deadline: Date.now() + 60000, rerankLimit: 12 },
  );
  let plan: AssistantPlan;
  if (env.AI_ROUTING_MODE === "live") {
    plan = await provider.structured(
      "query_understanding",
      env.OPENAI_STRUCTURING_MODEL,
      assistantPlanSchema,
      "Understand the CURRENT user request for a relationship memory assistant. Select purpose lookup/summarize/connect/prioritize/prepare. " +
        "Use latest explicit user instructions over explicit selection over an unambiguous prior subject. Never choose the first of several people/meetings. " +
        "Resolve IDs only from knownPeople/context; explicit new names replace prior targets, a general new topic drops irrelevant constraints. " +
        "For follow-ups retain relevant goal/person/time; for a new question do not carry stale constraints. If reference is ambiguous ask clarification before search. " +
        "Resolve relative dates using current referenceTime Asia/Seoul. Separate meetingRange and dueRange. Range end is exclusive. " +
        "A preparation for the NEXT meeting uses PAST evidence; it must not filter records to a future meeting unless the user explicitly asks to retrieve a scheduled meeting. " +
        "A planning horizon such as THIS WEEK when prioritizing contacts refers to action deadlines (dueRange), not dates of past meetings. " +
        "Do not turn task goals or desired output format into evidence conditions. Do not infer saved actionKind from a recommendation request. " +
        "Conditions retain every explicit restriction, sameInteraction only when required, actionKind commitment for recorded promises, not generated recommendations. " +
        "personName is explicit name only. Prior assistant answers are context about conversation, not verified facts. Never infer closeness, priority or missing facts from them.",
      {
        query: input.query,
        context,
        selection: input.selection ?? null,
        recent:
          input.recent?.slice(-6).map((t) => ({
            message: t.message,
            answer: t.answer.slice(0, 1000),
          })) ?? [],
        knownPeople: people.slice(0, 100),
        referenceTime: koreanOffsetInstant(reference.toISOString()),
        timezone: "Asia/Seoul",
      },
    );
  } else
    plan = localAssistantPlan(
      input.query,
      context,
      people,
      input.selection,
      reference,
    );
  // Explicit selection is authoritative, but a new explicit name can replace it.
  const named = namedPeople(input.query, people);
  const duplicateNames = new Set(named.map((p) => p.name)).size < named.length;
  if (named.length === 1) {
    plan.personIds = [named[0].id];
    plan.personName = named[0].name;
  }
  if (named.length > 1 && !duplicateNames)
    plan.personIds = named.slice(0, 5).map((p) => p.id);
  if (
    duplicateNames &&
    input.selection?.personIds?.length &&
    input.selection.personIds.every((id) => named.some((p) => p.id === id))
  ) {
    plan.personIds = input.selection.personIds;
  }
  const compatibleSelection =
    !named.length ||
    !input.selection?.personIds?.length ||
    named.some((p) => input.selection?.personIds?.includes(p.id));
  if (input.selection?.personIds && !named.length)
    plan.personIds = input.selection.personIds;
  if (
    input.selection?.personIds?.length &&
    compatibleSelection &&
    plan.clarification &&
    /동명이인|같은 이름|이름.*(두|여러|같)|어느.*(인물|사람)|인물.*선택/.test(
      plan.clarification,
    )
  )
    plan.clarification = null;
  if (input.selection?.interactionId !== undefined && compatibleSelection)
    plan.interactionId = input.selection.interactionId;
  if (!compatibleSelection) plan.interactionId = null;
  if (input.selection?.meetingRange !== undefined)
    plan.meetingRange = input.selection.meetingRange;
  if (input.selection?.dueRange !== undefined)
    plan.dueRange = input.selection.dueRange;
  if (
    input.selection?.meetingRange !== undefined ||
    input.selection?.dueRange !== undefined
  ) {
    plan.period = "none";
    plan.fromDate = null;
    plan.toDateExclusive = null;
  }
  if (
    referencePattern.test(input.query) &&
    !named.length &&
    context.personIds.length === 1 &&
    input.selection?.personIds === undefined
  )
    plan.personIds = context.personIds;
  const explicitlyPastMeeting =
    /만난|만났|지난.*만남|만남.*기준|만남 기록|미팅 기록|어제|작년/.test(
      input.query,
    );
  if (
    plan.purpose === "prepare" &&
    !explicitlyPastMeeting &&
    input.selection?.meetingRange === undefined
  ) {
    plan.meetingRange = context.meetingRange;
    if (plan.timeTarget === "interaction") {
      plan.period = "none";
      plan.fromDate = null;
      plan.toDateExclusive = null;
    }
  }
  if (plan.purpose === "prioritize" && !explicitlyPastMeeting) {
    plan.dueRange ??= plan.meetingRange;
    plan.meetingRange = null;
    plan.timeTarget = "action_due";
    if (!/약속|보내기로|하기로|후속 업무|저장된 제안/.test(input.query))
      plan.actionKind = null;
    if (
      !named.length &&
      /누구|어떤 사람|전체|모든/.test(input.query) &&
      input.selection?.personIds === undefined
    )
      plan.personIds = [];
  }
  if (
    /그때|그\s*만남|그\s*미팅/.test(input.query) &&
    !context.interactionId &&
    !input.selection?.interactionId
  )
    plan.clarification =
      "어느 만남을 말씀하시나요? 만남을 선택하거나 날짜·행사를 알려 주세요.";
  if (
    /줄여|늘려|개로|간단히/.test(input.query) &&
    !named.length &&
    context.personIds.length
  ) {
    plan.personIds = context.personIds;
    plan.conditions = [];
    plan.sameInteraction = false;
    plan.actionKind = null;
    plan.period = "none";
    plan.fromDate = null;
    plan.toDateExclusive = null;
    plan.meetingRange = context.meetingRange;
    plan.dueRange = context.dueRange;
    plan.interactionId = context.interactionId;
    plan.purpose = "prepare";
    plan.intent = "analysis";
  }
  if (
    plan.personIds.some((id) => !people.some((p) => p.id === id)) ||
    !(await validateContextSelection(
      input.workspaceId,
      plan.personIds,
      plan.interactionId,
    ))
  )
    throw new AssistantError(
      "AI_CONTEXT_INVALID",
      "대화의 인물·만남을 확인하지 못했습니다. 대상을 다시 선택해 주세요.",
      503,
    );
  if (duplicateNames && !input.selection?.personIds?.length) {
    plan.personIds = [];
    plan.clarification = "동명이인이 있습니다. 어느 인물인지 선택해 주세요.";
  }
  if (named.length > 5 && !duplicateNames)
    plan.clarification =
      "한 번에 최대 5명까지 비교할 수 있습니다. 대상을 좁혀 주세요.";
  const range = planDateRange(plan, reference);
  if (range) {
    const convert = (date: string) =>
      new Date(Date.parse(date) + 9 * 3600000).toISOString().slice(0, 10);
    const normalized = {
      from: convert(range.from),
      toExclusive: convert(range.to),
    };
    if (plan.timeTarget === "action_due") plan.dueRange ??= normalized;
    else plan.meetingRange ??= normalized;
  }
  for (const r of [plan.meetingRange, plan.dueRange])
    if (r && r.from >= r.toExclusive)
      throw new AssistantError(
        "AI_CONTEXT_INVALID",
        "검색 기간이 올바르지 않습니다.",
        503,
      );
  const coverage: SearchCoverage = {
    status: "normal",
    paths: [],
    reasons: [],
    prepared: 0,
    total: 0,
    asOf: reference.toISOString(),
  };
  const empty = (
    status: "ambiguous" | "no_result",
    answer: string,
  ): RecallResponse => ({
    queryId: null,
    status,
    answer,
    clarification: status === "ambiguous" ? answer : null,
    analysis: "",
    results: [],
    parsedQuery: {
      normalizedQuery: input.query,
      terms: [],
      intents: [plan.intent === "action" ? "action" : "person_lookup"],
      dateRange: range,
      parserVersion:
        env.AI_ROUTING_MODE === "live" ? "llm-v1" : "structured-v1",
    },
    mode: env.AI_ROUTING_MODE === "live" ? "live" : "structured_local_semantic",
    model:
      env.AI_ROUTING_MODE === "live"
        ? env.OPENAI_MAIN_AGENT_MODEL
        : "local-context-v1",
    latencyMs: Math.round(performance.now() - started),
    metrics: provider.metrics,
  });
  if (plan.clarification) {
    const response = empty("ambiguous", plan.clarification);
    // Identity candidates are choices, not claimed factual answers.
    response.results = named.slice(0, 5).map((p) => ({
      personId: p.id,
      displayName: p.name,
      headline: null,
      organizations: [],
      score: 0,
      reason: "인물 확인 필요",
      evidence: [],
      storedActions: [],
      suggestion: null,
    }));
    return { plan, response, sections: [] as AssistantSection[], coverage };
  }
  const canonical = await retrieveCanonicalCandidates(
    input.workspaceId,
    input.query,
    plan,
  );
  coverage.paths.push("structured", "keyword");
  if (canonical.truncated) {
    coverage.status = "limited";
    coverage.reasons.push(
      "관련 기록이 많아 일부 후보만 검토했습니다. 기간이나 인물을 좁혀 주세요.",
    );
  }
  let vectors: Awaited<ReturnType<typeof retrieveUnitVectors>> = [];
  if (env.AI_ROUTING_MODE === "live") {
    const readiness = await inspectUnitReadiness(
      input.workspaceId,
      env.VOYAGE_EMBEDDING_MODEL,
    );
    coverage.prepared = readiness.prepared;
    coverage.total = readiness.total;
    if (
      readiness.prepared < readiness.total ||
      readiness.missingProjection ||
      !readiness.prepared
    ) {
      coverage.status = "limited";
      coverage.reasons.push(
        "의미 검색은 준비된 기록에 한해 사용했습니다. 최신 기록은 이름·조건·키워드로 확인했습니다.",
      );
    }
    if (readiness.prepared) {
      try {
        vectors = await retrieveUnitVectors(
          input.workspaceId,
          await provider.embed(input.query, "query"),
          env.VOYAGE_EMBEDDING_MODEL,
          plan,
        );
        coverage.paths.push("vector");
      } catch (error) {
        if (!isRetrievalFailure(error)) throw error;
        coverage.status = "limited";
        coverage.reasons.push(
          "의미 검색 연결이 지연돼 이름·조건·키워드 검색을 사용했습니다.",
        );
      }
    }
  }
  const candidates = fuseCandidates([canonical.candidates, vectors]);
  if (!candidates.length)
    return {
      plan,
      response: empty(
        "no_result",
        coverage.status === "limited"
          ? "확인 가능한 검색 범위에서 관련 근거를 찾지 못했습니다."
          : "저장된 기록에서 관련 근거를 찾지 못했습니다.",
      ),
      sections: [],
      coverage,
    };
  let selected = candidates.slice(0, 12);
  if (
    env.AI_ROUTING_MODE === "live" &&
    candidates.length > 1 &&
    !(plan.personIds.length === 1 && candidates.length <= 12)
  ) {
    try {
      const indices = await provider.rerank(
        input.query,
        candidates.map((c) => c.content.slice(0, 3000)),
      );
      selected = indices.slice(0, 12).map((i) => candidates[i]);
    } catch (error) {
      if (!isRetrievalFailure(error)) throw error;
      coverage.status = "limited";
      coverage.reasons.push(
        "재정렬을 사용할 수 없어 검색 순서로 근거를 확인했습니다.",
      );
    }
  }
  const ids = [...new Set(selected.flatMap((c) => c.personIds))].slice(0, 8);
  const corpus = await loadRecallCorpus(input.workspaceId, ids);
  const pack = buildContextPack(corpus, selected, plan);
  await attachAssistantProvenance(input.workspaceId, pack.people);
  if (
    plan.purpose === "connect" &&
    plan.personIds.length > 1 &&
    plan.personIds.some((id) => !pack.people.some((p) => p.id === id))
  )
    return {
      plan,
      response: empty(
        "no_result",
        "일부 대상의 관련 기록이 부족해 비교·연결을 설명하기 어렵습니다. 해당 인물의 기록을 추가하거나 대상을 좁혀 주세요.",
      ),
      sections: [],
      coverage,
      insufficientContext: true,
    };
  if (
    pack.truncated ||
    ids.length < new Set(selected.flatMap((c) => c.personIds)).size
  ) {
    coverage.status = "limited";
    coverage.reasons.push(
      "답변에 필요한 기록 일부를 검토했습니다. 전체 목록이나 전체 최우선으로 해석하지 마세요.",
    );
  }
  if (!pack.people.length)
    return {
      plan,
      response: empty(
        "no_result",
        "현재 조건을 충족하는 확정 근거를 찾지 못했습니다.",
      ),
      sections: [],
      coverage,
    };
  if (env.AI_ROUTING_MODE !== "live")
    return {
      ...localAnswer(input.query, plan, pack.people, empty),
      plan,
      coverage,
    };
  const evidenceInput = pack.people.map((p) => ({
    ...p,
    documentContent: undefined,
    actions: p.actions.map((action) => ({
      ...action,
      dueAt: koreanOffsetInstant(action.dueAt),
    })),
    evidence: p.evidence.map((e) => ({
      ...e,
      key: evidenceKey(e),
      occurredAt: koreanOffsetInstant(e.occurredAt),
      dueAt: koreanOffsetInstant(e.dueAt),
    })),
  }));
  if (JSON.stringify(evidenceInput).length > 90000)
    throw new AssistantError(
      "AI_INPUT_TOO_LONG",
      "기록이 많습니다. 대상이나 기간을 좁혀 주세요.",
      503,
    );
  try {
    const raw = await provider.structured(
      "memory_answer",
      env.OPENAI_MAIN_AGENT_MODEL,
      answerSchema,
      "Answer using ONLY supplied current confirmed evidence. Every explicit condition needs conditionEvidence; sameInteraction requires one common meeting. " +
        "A candidate ranking is not proof. Action kind and pending/completed status are authoritative. A suggestion is never a recorded promise. " +
        "workspace_task is user-created work, never a commitment. dueHasTime=false means the calendar date is known but a clock time is NOT known; never invent midnight as a promised time. " +
        "Respect meeting dates vs action deadlines. participantRole mentioned means only mentioned, never an attendee. Ambiguous identities require clarification. Contradictory sources must be disclosed, not silently resolved. " +
        "Return a short main answer and sections chosen for purpose: facts for summaries, interpretations for connections, grounded priority rationale, suggestions/drafts for preparation. " +
        "Each section must cite keys selected in people.evidenceKeys, including all sources needed for each claim. An interpretation is not a fact. " +
        "Resolved must include at least one supplied person with evidence, even when rewriting preparation questions. conditionEvidence must have exactly one entry for each plan condition, and none if conditions is empty. " +
        "For prioritization explain criteria (pending commitments/deadlines/user goal), do not invent relationship strength. With limited coverage do not claim exhaustive or global best. " +
        "Preparation can propose questions or a contact draft but cannot claim unrecorded events, execute, send or save anything. " +
        "Return no_result if no evidence satisfies conditions. All time references are Asia/Seoul, use evidence +09:00 local dates. Keep at most 5 people and 8 concise sections.",
      {
        query: input.query,
        plan,
        coverage,
        referenceTime: koreanOffsetInstant(reference.toISOString()),
        people: evidenceInput,
      },
    );
    let response: RecallResponse;
    try {
      response = validateAssistantAnswer(
        includeSectionEvidence(raw, pack.people),
        plan,
        pack.people,
        input.query,
        reference,
        env.OPENAI_MAIN_AGENT_MODEL,
      );
    } catch (cause) {
      const error = new AssistantError(
        "AI_EVIDENCE_INVALID",
        "답변의 조건과 근거 연결을 확인하지 못했습니다.",
        503,
      );
      error.cause = cause;
      throw error;
    }
    const latest = await loadRecallCorpus(
      input.workspaceId,
      pack.people.map((p) => p.id),
    );
    const fingerprint = (e: RecallCorpusPerson["evidence"][number]) =>
      JSON.stringify([
        e.text,
        e.occurredAt,
        e.dueAt ?? null,
        e.actionStatus,
        e.interactionId ?? null,
      ]);
    for (const person of response.results) {
      const current = latest.find((p) => p.id === person.personId);
      const original = pack.people.find((p) => p.id === person.personId)!;
      if (
        !current ||
        person.evidence.some((selected) => {
          const key = evidenceKey(selected);
          const old = original.evidence.find((e) => evidenceKey(e) === key);
          const fresh = current.evidence.find((e) => evidenceKey(e) === key);
          return !old || !fresh || fingerprint(old) !== fingerprint(fresh);
        })
      )
        throw new AssistantError(
          "AI_EVIDENCE_STALE",
          "답변을 준비하는 동안 기록이 변경됐습니다. 최신 기록으로 다시 질문해 주세요.",
          409,
        );
    }
    // Existing validator does not enforce all independent date constraints; pack already does.
    response.latencyMs = Math.round(performance.now() - started);
    response.metrics = provider.metrics;
    return {
      plan,
      response,
      sections: validateSections(raw.sections, pack.people, response),
      coverage,
    };
  } catch (error) {
    if (!isRetrievalFailure(error)) throw error;
    const result = localAnswer(
      input.query,
      { ...plan, purpose: "lookup" },
      pack.people,
      empty,
    );
    result.response.answer =
      "AI 답변 연결을 사용할 수 없어 현재 확인된 근거 목록을 보여드립니다.";
    result.sections = [];
    coverage.status = "limited";
    coverage.reasons.push("생성 답변 없이 근거 목록만 제공했습니다.");
    return { ...result, plan, coverage };
  }
}
function isRetrievalFailure(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    ([
      "AI_REQUEST_FAILED",
      "AI_RATE_LIMITED",
      "AI_PROVIDER_RATE_LIMITED",
      "AI_CONFIGURATION_ERROR",
      "AI_DEADLINE_EXCEEDED",
    ].includes(String(error.code)) ||
      /^AI_HTTP_5\d\d$/.test(String(error.code)))
  );
}
function localAnswer(
  query: string,
  plan: AssistantPlan,
  corpus: RecallCorpusPerson[],
  empty: (status: "no_result", answer: string) => RecallResponse,
) {
  const response = empty("no_result", "");
  response.status = "resolved";
  response.results = corpus.slice(0, 5).map((p) => ({
    personId: p.id,
    displayName: p.displayName,
    headline: p.headline,
    organizations: p.organizations,
    score: 0,
    reason: "현재 확인된 기록",
    evidence: p.evidence.map((e) => ({
      id: e.id,
      type: e.type,
      excerpt: e.text,
      occurredAt: e.occurredAt,
      verificationStatus: e.verificationStatus,
      score: 0,
      memoryStatementId: e.memoryStatementId,
      memoryDocumentId: e.memoryDocumentId,
      provenance: e.provenance,
      interactionId: e.interactionId,
    })),
    storedActions: p.actions
      .filter(
        (a) =>
          a.status === "pending" &&
          (!plan.actionKind || a.kind === plan.actionKind),
      )
      .map((a) => ({
        ...a,
        type: "stored" as const,
        executes: false as const,
      })),
    suggestion: null,
  }));
  response.answer = `${response.results.map((p) => p.displayName).join(", ")}의 확인된 기록입니다. 기본 모드에서는 AI 해석을 생성하지 않습니다.`;
  const sections: AssistantSection[] =
    plan.purpose === "lookup"
      ? []
      : response.results.slice(0, 3).map((p) => ({
          type: "fact",
          title: `${p.displayName} · 기록 정리`,
          text: p.evidence
            .slice(0, 3)
            .map((e) => e.excerpt)
            .join("\n")
            .slice(0, 1200),
          evidenceKeys: p.evidence.slice(0, 3).map(evidenceKey),
        }));
  void query;
  return { response, sections };
}
