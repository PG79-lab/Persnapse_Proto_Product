import { z } from "zod";
import { koreanDayRange, withinRange } from "./date-range";
import { parseRecallQuery } from "./query-parser";
import type {
  RecallCorpusEvidence,
  RecallCorpusPerson,
  RecallDateRange,
  RecallResponse,
} from "./types";

export const queryPlanSchema = z
  .object({
    intent: z.enum(["lookup", "action", "analysis"]),
    personName: z.string().max(120).nullable(),
    conditions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(240),
            scope: z.enum(["person", "interaction"]),
          })
          .strict(),
      )
      .max(6),
    sameInteraction: z.boolean(),
    timeTarget: z.enum(["interaction", "action_due"]),
    period: z.enum(["none", "today", "yesterday", "last_month", "range"]),
    fromDate: z.iso.date().nullable(),
    toDateExclusive: z.iso.date().nullable(),
    clarification: z.string().max(500).nullable(),
  })
  .strict();
export type QueryPlan = z.infer<typeof queryPlanSchema>;

const keys = z.array(z.string().min(1).max(120)).min(1).max(12);
export const assistantAnswerSchema = z
  .object({
    status: z.enum(["resolved", "ambiguous", "no_result"]),
    answer: z.string().min(1).max(1600),
    analysis: z.string().max(1600),
    clarification: z.string().max(500).nullable(),
    people: z
      .array(
        z
          .object({
            personId: z.string().min(1),
            reason: z.string().min(1).max(800),
            evidenceKeys: keys,
            conditionEvidence: z
              .array(
                z
                  .object({
                    conditionIndex: z.number().int().min(0).max(5),
                    evidenceKeys: keys,
                  })
                  .strict(),
              )
              .max(6),
            suggestion: z
              .object({
                title: z.string().min(1).max(240),
                rationale: z.string().min(1).max(800),
                evidenceKeys: keys,
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
export function evidenceKey(
  e: Pick<RecallCorpusEvidence, "type" | "id">,
): string {
  return e.type + ":" + e.id;
}

export function planDateRange(
  plan: QueryPlan,
  reference: Date,
): RecallDateRange | null {
  if (plan.period === "today") return koreanDayRange(reference, 0, "오늘");
  if (plan.period === "yesterday") return koreanDayRange(reference, -1, "어제");
  if (plan.period === "last_month")
    return parseRecallQuery("지난달", reference).dateRange;
  if (plan.period === "none") return null;
  if (
    !plan.fromDate ||
    !plan.toDateExclusive ||
    plan.fromDate >= plan.toDateExclusive
  )
    throw new Error("INVALID_QUERY_DATE_RANGE");
  return {
    from: new Date(plan.fromDate + "T00:00:00+09:00").toISOString(),
    to: new Date(plan.toDateExclusive + "T00:00:00+09:00").toISOString(),
    label: plan.fromDate + " 이후 " + plan.toDateExclusive + " 이전",
  };
}

export function validateAssistantAnswer(
  raw: AssistantAnswer,
  plan: QueryPlan,
  corpus: RecallCorpusPerson[],
  query: string,
  reference: Date,
  model: string,
): RecallResponse {
  const dateRange = planDateRange(plan, reference);
  const fail = (): never => {
    throw new Error("UNSUPPORTED_ASSISTANT_EVIDENCE");
  };
  if (new Set(raw.people.map((p) => p.personId)).size !== raw.people.length)
    fail();
  if (raw.status === "no_result" && raw.people.length) fail();
  if (raw.status === "resolved" && !raw.people.length) fail();
  if (raw.status === "ambiguous" && !raw.clarification) fail();
  if (
    plan.personName &&
    (plan.conditions.length === 0 || query.trim() === plan.personName) &&
    corpus.filter((p) => p.displayName === plan.personName).length > 1 &&
    raw.status === "resolved"
  )
    fail();
  const results = raw.people.map((result) => {
    const person = corpus.find((p) => p.id === result.personId);
    if (!person) return fail();
    const byKey = new Map(person.evidence.map((e) => [evidenceKey(e), e]));
    const evidence = result.evidenceKeys.map((key) => byKey.get(key));
    if (evidence.some((e) => !e)) return fail();
    const selected = evidence as RecallCorpusEvidence[];
    if (new Set(result.evidenceKeys).size !== result.evidenceKeys.length)
      fail();
    if (result.conditionEvidence.length !== plan.conditions.length) fail();
    const witnesses: RecallCorpusEvidence[][] = [];
    for (let index = 0; index < plan.conditions.length; index++) {
      const support = result.conditionEvidence.filter(
        (c) => c.conditionIndex === index,
      );
      if (
        support.length !== 1 ||
        support[0].evidenceKeys.some(
          (key) => !result.evidenceKeys.includes(key),
        )
      )
        fail();
      if (plan.conditions[index].scope === "interaction") {
        witnesses.push(support[0].evidenceKeys.map((key) => byKey.get(key)!));
      }
    }
    const dated = selected.filter((e) =>
      plan.timeTarget === "action_due"
        ? e.type === "action_item" &&
          e.actionStatus === "pending" &&
          withinRange(e.dueAt ?? null, dateRange)
        : withinRange(e.occurredAt, dateRange),
    );
    if (dateRange && !dated.length) fail();
    if (plan.sameInteraction && witnesses.length) {
      const groups = witnesses.map(
        (group) =>
          new Set(
            group.flatMap((e) => (e.interactionId ? [e.interactionId] : [])),
          ),
      );
      const common = [...groups[0]].filter((id) =>
        groups.every((group) => group.has(id)),
      );
      if (
        !common.length ||
        (dateRange &&
          !dated.some(
            (e) => e.interactionId && common.includes(e.interactionId),
          ))
      )
        fail();
    }
    if (
      result.suggestion?.evidenceKeys.some(
        (key) => !result.evidenceKeys.includes(key),
      )
    )
      fail();
    return {
      personId: person.id,
      displayName: person.displayName,
      headline: person.headline,
      organizations: person.organizations,
      score: 0,
      reason: result.reason,
      evidence: selected.map((e) => ({
        id: e.id,
        type: e.type,
        excerpt: e.text,
        occurredAt: e.occurredAt,
        verificationStatus: e.verificationStatus,
        score: 0,
        memoryStatementId: e.memoryStatementId,
        memoryDocumentId: e.memoryDocumentId,
      })),
      storedActions: person.actions
        .filter(
          (a) =>
            a.status === "pending" &&
            result.evidenceKeys.includes("action_item:" + a.id) &&
            (plan.timeTarget !== "action_due" ||
              withinRange(a.dueAt, dateRange)),
        )
        .map((a) => ({
          ...a,
          type: "stored" as const,
          executes: false as const,
        })),
      suggestion:
        result.suggestion && raw.status === "resolved"
          ? {
              type: "ai_suggestion" as const,
              title: result.suggestion.title,
              rationale: result.suggestion.rationale,
              executes: false as const,
            }
          : null,
    };
  });
  return {
    queryId: null,
    status: raw.status,
    answer:
      raw.status === "no_result"
        ? "저장된 기억에서 질문 조건을 충족하는 근거를 찾지 못했습니다."
        : raw.answer,
    analysis: raw.status === "resolved" ? raw.analysis : "",
    clarification: raw.clarification,
    results,
    parsedQuery: {
      normalizedQuery: query,
      terms: [],
      intents: [plan.intent === "action" ? "action" : "person_lookup"],
      dateRange,
      parserVersion: "llm-v1",
    },
    latencyMs: 0,
    mode: "live",
    model,
  };
}
