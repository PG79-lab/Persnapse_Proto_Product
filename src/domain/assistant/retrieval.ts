import type { RecallCorpusPerson, RecallCorpusEvidence } from "../recall/types";
import { evidenceKey } from "../recall/assistant-contract";
import type { AssistantPlan } from "./contracts";

export type MemoryCandidate = {
  key: string;
  personIds: string[];
  content: string;
  sourceKeys: string[];
};
export function fuseCandidates(
  lists: MemoryCandidate[][],
  limit = 48,
): MemoryCandidate[] {
  const scores = new Map<
    string,
    { candidate: MemoryCandidate; score: number }
  >();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((candidate, index) => {
      if (seen.has(candidate.key)) return;
      seen.add(candidate.key);
      const prior = scores.get(candidate.key);
      scores.set(candidate.key, {
        candidate,
        score: (prior?.score ?? 0) + 1 / (60 + index + 1),
      });
    });
  }
  return [...scores.values()]
    .sort(
      (a, b) =>
        b.score - a.score || a.candidate.key.localeCompare(b.candidate.key),
    )
    .slice(0, limit)
    .map((r) => r.candidate);
}
function inRange(
  date: string | null | undefined,
  range: AssistantPlan["meetingRange"],
): boolean {
  if (!range) return true;
  if (!date) return false;
  const time = Date.parse(date);
  return (
    time >= Date.parse(range.from + "T00:00:00+09:00") &&
    time < Date.parse(range.toExclusive + "T00:00:00+09:00")
  );
}
export function filterEvidence(
  e: RecallCorpusEvidence,
  plan: AssistantPlan,
): boolean {
  if (
    plan.interactionId &&
    e.interactionId !== plan.interactionId &&
    !(e.type === "interaction" && e.id === plan.interactionId)
  )
    return false;
  if (
    plan.meetingRange &&
    !inRange(e.interactionOccurredAt ?? e.occurredAt, plan.meetingRange)
  )
    return false;
  if (
    plan.actionKind &&
    ((e.type !== "action_item" && e.type !== "workspace_task") ||
      e.actionKind !== plan.actionKind)
  )
    return false;
  if (
    plan.dueRange &&
    ((e.type !== "action_item" && e.type !== "workspace_task") ||
      e.actionStatus !== "pending" ||
      !inRange(e.dueAt, plan.dueRange))
  )
    return false;
  return true;
}
/** Bound evidence, retaining selected sources and at most one directly connected meeting. */
export function buildContextPack(
  corpus: RecallCorpusPerson[],
  candidates: MemoryCandidate[],
  plan: AssistantPlan,
  max = 24,
) {
  const keys = new Set(candidates.flatMap((c) => c.sourceKeys));
  const meetings = new Set(
    corpus.flatMap((p) =>
      p.evidence
        .filter((e) => keys.has(evidenceKey(e)))
        .flatMap((e) => (e.interactionId ? [e.interactionId] : [])),
    ),
  );
  let remaining = max;
  let truncated = false;
  const order = [...new Set(candidates.flatMap((c) => c.personIds))];
  const scoped = corpus
    .filter((p) => !plan.personIds.length || plan.personIds.includes(p.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const people = scoped
    .map((p, personIndex) => {
      const eligible = p.evidence.filter(
        (e) =>
          filterEvidence(e, plan) ||
          (e.type !== "action_item" &&
            e.type !== "workspace_task" &&
            !!e.interactionId &&
            meetings.has(e.interactionId) &&
            filterEvidence(e, { ...plan, dueRange: null, actionKind: null })),
      );
      const sorted = eligible
        .map((e, index) => ({
          e,
          index,
          priority: keys.has(evidenceKey(e))
            ? 0
            : e.interactionId && meetings.has(e.interactionId)
              ? 1
              : 2,
        }))
        .sort((a, b) => a.priority - b.priority || a.index - b.index);
      const perPerson = Math.min(
        12,
        Math.floor(remaining / (scoped.length - personIndex)),
      );
      const evidence = sorted.slice(0, perPerson).map((r) => r.e);
      truncated ||= sorted.length > perPerson;
      remaining -= evidence.length;
      const selected = new Set(
        evidence
          .filter(
            (e) => e.type === "action_item" || e.type === "workspace_task",
          )
          .map((e) => e.id),
      );
      return {
        ...p,
        documentContent: "",
        evidence,
        actions: p.actions.filter((a) => selected.has(a.id)),
      };
    })
    .filter((p) => p.evidence.length);
  return { people, truncated };
}
