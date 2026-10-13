import { z } from "zod";
import { queryPlanSchema, evidenceKey } from "../recall/assistant-contract";
import type { RecallResponse, RecallCorpusPerson } from "../recall/types";

export const purposeSchema = z.enum([
  "lookup",
  "summarize",
  "connect",
  "prioritize",
  "prepare",
]);
export type AssistantPurpose = z.infer<typeof purposeSchema>;
const rangeSchema = z
  .object({ from: z.iso.date(), toExclusive: z.iso.date() })
  .strict();
export const selectionSchema = z
  .object({
    personIds: z.array(z.uuid()).max(5).optional(),
    interactionId: z.uuid().nullable().optional(),
    meetingRange: rangeSchema.nullable().optional(),
    dueRange: rangeSchema.nullable().optional(),
  })
  .strict();
export type ContextSelection = z.infer<typeof selectionSchema>;
export const contextSchema = z
  .object({
    personIds: z.array(z.uuid()).max(5),
    interactionId: z.uuid().nullable(),
    meetingRange: rangeSchema.nullable(),
    dueRange: rangeSchema.nullable(),
    purpose: purposeSchema,
    goal: z.string().max(500),
    choices: z
      .array(z.object({ id: z.string(), name: z.string() }).strict())
      .max(5),
  })
  .strict();
export type AssistantContext = z.infer<typeof contextSchema>;
export const emptyContext = (): AssistantContext => ({
  personIds: [],
  interactionId: null,
  meetingRange: null,
  dueRange: null,
  purpose: "lookup",
  goal: "",
  choices: [],
});
export const assistantPlanSchema = queryPlanSchema
  .extend({
    purpose: purposeSchema,
    personIds: z.array(z.uuid()).max(5),
    interactionId: z.uuid().nullable(),
    meetingRange: rangeSchema.nullable(),
    dueRange: rangeSchema.nullable(),
    goal: z.string().max(500),
  })
  .strict();
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
export const sectionSchema = z
  .object({
    type: z.enum(["fact", "interpretation", "suggestion", "draft"]),
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(1200),
    evidenceKeys: z.array(z.string().min(1)).min(1).max(12),
  })
  .strict();
export type AssistantSection = z.infer<typeof sectionSchema>;
export type SearchCoverage = {
  status: "normal" | "limited" | "unavailable";
  paths: string[];
  reasons: string[];
  prepared: number;
  total: number;
  asOf: string;
};
export type AssistantResponse = {
  schemaVersion: "assistant-v1";
  status: "resolved" | "ambiguous" | "no_result" | "insufficient_context";
  sessionId: string;
  version: number;
  turnId: string;
  purpose: AssistantPurpose;
  context: AssistantContext;
  sections: AssistantSection[];
  coverage: SearchCoverage;
  recall: RecallResponse;
};
export const turnRequestSchema = z
  .object({
    sessionId: z.uuid(),
    requestId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    message: z.string().trim().min(2).max(500),
    contextSelection: selectionSchema.optional(),
  })
  .strict();
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export class AssistantError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

/** Never promote a ranked list to a single selected person. */
export function nextContext(
  plan: AssistantPlan,
  response: RecallResponse,
): AssistantContext {
  const validIds = response.results.map((p) => p.personId);
  const resolved = response.status === "resolved";
  const ids =
    resolved && validIds.length === 1
      ? validIds
      : response.status !== "resolved"
        ? plan.personIds
        : plan.personIds.filter((id) => validIds.includes(id));
  const meetings = new Set(
    response.results.flatMap((p) =>
      p.evidence.flatMap((e) =>
        e.interactionId
          ? [e.interactionId]
          : e.type === "interaction"
            ? [e.id]
            : [],
      ),
    ),
  );
  return {
    personIds: ids,
    interactionId: resolved
      ? (plan.interactionId ?? (meetings.size === 1 ? [...meetings][0] : null))
      : plan.interactionId,
    meetingRange: plan.meetingRange,
    dueRange: plan.dueRange,
    purpose: plan.purpose,
    goal: plan.goal,
    choices:
      validIds.length > 1
        ? response.results.map((p) => ({ id: p.personId, name: p.displayName }))
        : [],
  };
}

/** Sections can reference multiple people. Promote only verified pack keys to their existing owners. */
export function includeSectionEvidence<
  T extends {
    people: { personId: string; evidenceKeys: string[] }[];
    sections: AssistantSection[];
  },
>(raw: T, corpus: RecallCorpusPerson[]): T {
  const people = raw.people.map((p) => ({
    ...p,
    evidenceKeys: [...p.evidenceKeys],
  }));
  for (const section of raw.sections)
    for (const key of section.evidenceKeys) {
      const owners = people.filter((p) =>
        corpus
          .find((person) => person.id === p.personId)
          ?.evidence.some((e) => evidenceKey(e) === key),
      );
      if (!owners.length)
        throw new AssistantError(
          "AI_EVIDENCE_INVALID",
          "현재 근거에 없는 내용을 답변에 연결할 수 없습니다.",
          503,
        );
      for (const owner of owners)
        if (!owner.evidenceKeys.includes(key)) owner.evidenceKeys.push(key);
    }
  if (people.some((p) => p.evidenceKeys.length > 12))
    throw new AssistantError(
      "AI_INPUT_TOO_LONG",
      "연결할 근거가 많습니다. 대상을 좁혀 주세요.",
      503,
    );
  return { ...raw, people };
}

export function validateSections(
  sections: AssistantSection[],
  corpus: RecallCorpusPerson[],
  response: RecallResponse,
) {
  const allowed = new Set(
    response.results.flatMap((p) => p.evidence.map(evidenceKey)),
  );
  const current = new Set(corpus.flatMap((p) => p.evidence.map(evidenceKey)));
  if (
    sections.some((s) =>
      s.evidenceKeys.some((key) => !allowed.has(key) || !current.has(key)),
    )
  )
    throw new AssistantError(
      "AI_EVIDENCE_INVALID",
      "답변과 현재 기록의 연결을 확인하지 못했습니다.",
      503,
    );
  if (response.status !== "resolved" && sections.length)
    throw new AssistantError(
      "AI_EVIDENCE_INVALID",
      "확인되지 않은 결과에 해석을 붙일 수 없습니다.",
      503,
    );
  return sections;
}
