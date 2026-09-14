import { localSemanticSimilarity } from "./local-semantic";
import { normalizeRecallText } from "./query-parser";
import type {
  ParsedRecallQuery,
  RecallCorpusEvidence,
  RecallCorpusPerson,
  RecallEvidence,
  RecallPersonResult,
  RecallResponse,
  RecallStatus,
} from "./types";

interface ScoredEvidence {
  source: RecallCorpusEvidence;
  score: number;
  matchedTerms: string[];
}

function compact(value: string): string {
  return normalizeRecallText(value).replaceAll(" ", "");
}

function inDateRange(value: string | null, query: ParsedRecallQuery): boolean {
  if (!query.dateRange) {
    return true;
  }
  if (!value) {
    return false;
  }

  const occurredAt = new Date(value).getTime();
  return (
    occurredAt >= new Date(query.dateRange.from).getTime() &&
    occurredAt < new Date(query.dateRange.to).getTime()
  );
}

function scoreEvidence(
  evidence: RecallCorpusEvidence,
  queryText: string,
  query: ParsedRecallQuery,
): ScoredEvidence | null {
  if (!inDateRange(evidence.occurredAt, query)) {
    return null;
  }

  const normalizedEvidence = normalizeRecallText(evidence.text);
  const matchedTerms = query.terms.filter(
    (term) =>
      normalizedEvidence.includes(term) ||
      compact(normalizedEvidence).includes(compact(term)),
  );
  const semanticScore = localSemanticSimilarity(queryText, evidence.text);
  let score = matchedTerms.length * 8 + semanticScore * 26;

  if (
    query.intents.includes("action") &&
    evidence.type === "action_item" &&
    evidence.actionStatus === "pending"
  ) {
    score += 28;
  }
  if (
    query.intents.includes("interaction") &&
    ["event", "interaction"].includes(evidence.type)
  ) {
    score += 6;
  }
  if (query.intents.includes("time") && evidence.occurredAt) {
    score += 24;
  }

  return score >= 3 ? { source: evidence, score, matchedTerms } : null;
}

function toEvidence(item: ScoredEvidence): RecallEvidence {
  return {
    id: item.source.id,
    type: item.source.type,
    excerpt: item.source.text,
    occurredAt: item.source.occurredAt,
    verificationStatus: "confirmed",
    score: Number(Math.min(1, item.score / 80).toFixed(3)),
    memoryStatementId: item.source.memoryStatementId,
    memoryDocumentId: item.source.memoryDocumentId,
  };
}

function reasonFor(item: ScoredEvidence | undefined): string {
  if (!item) {
    return "확인된 프로필 정보가 질의와 일치합니다.";
  }

  const labels: Record<RecallCorpusEvidence["type"], string> = {
    action_item: "후속 행동",
    affiliation: "소속",
    event: "행사",
    interaction: "상호작용",
    memory_statement: "관계 기억",
    person_profile: "프로필",
  };
  const matched = item.matchedTerms.slice(0, 3).join(", ");

  return matched
    ? `확인된 ${labels[item.source.type]}에서 “${matched}” 맥락이 일치합니다.`
    : `확인된 ${labels[item.source.type]} 기록이 의미상 가장 가깝습니다.`;
}

function resultFor(
  person: RecallCorpusPerson,
  scoredEvidence: ScoredEvidence[],
  rawScore: number,
): RecallPersonResult {
  const selectedEvidence = scoredEvidence.slice(0, 3);
  const storedActions = person.actions
    .filter((action) => action.status === "pending")
    .slice(0, 3)
    .map((action) => ({
      ...action,
      type: "stored" as const,
      executes: false as const,
    }));

  return {
    personId: person.id,
    displayName: person.displayName,
    headline: person.headline,
    organizations: person.organizations,
    score: Number(Math.min(1, rawScore / 130).toFixed(3)),
    reason: reasonFor(selectedEvidence[0]),
    evidence: selectedEvidence.map(toEvidence),
    storedActions,
    suggestion: {
      type: "ai_suggestion",
      title: `${person.displayName}님에게 확인된 최근 맥락으로 후속 연락 검토`,
      rationale:
        "검색된 근거를 먼저 확인한 뒤 필요할 때만 사용자가 직접 실행하는 제안입니다.",
      executes: false,
    },
  };
}

function ambiguityGroup(
  query: ParsedRecallQuery,
  corpus: RecallCorpusPerson[],
): Set<string> {
  if (query.terms.length !== 1) {
    return new Set();
  }

  const onlyTerm = compact(query.terms[0]);
  const matches = corpus.filter(
    (person) => compact(person.normalizedName) === onlyTerm,
  );

  return matches.length > 1
    ? new Set(matches.map((person) => person.id))
    : new Set();
}

export function rankRecallCandidates(
  queryText: string,
  query: ParsedRecallQuery,
  corpus: RecallCorpusPerson[],
): { status: RecallStatus; results: RecallPersonResult[] } {
  const ambiguousPeople = ambiguityGroup(query, corpus);
  const scored = corpus
    .map((person) => {
      const identityText = [
        person.displayName,
        person.headline,
        ...person.organizations,
      ]
        .filter(Boolean)
        .join(" ");
      const normalizedIdentity = normalizeRecallText(identityText);
      const identityMatches = query.terms.filter((term) =>
        compact(normalizedIdentity).includes(compact(term)),
      );
      const exactNameMatch = query.normalizedQuery.includes(
        normalizeRecallText(person.displayName),
      );
      const documentSemantic = localSemanticSimilarity(
        queryText,
        person.documentContent,
      );
      const evidence = person.evidence
        .map((item) => scoreEvidence(item, queryText, query))
        .filter((item): item is ScoredEvidence => Boolean(item))
        .sort((left, right) => right.score - left.score);

      if (query.dateRange && evidence.length === 0) {
        return null;
      }

      const evidenceScore =
        (evidence[0]?.score ?? 0) +
        (evidence[1]?.score ?? 0) * 0.35 +
        (evidence[2]?.score ?? 0) * 0.15;
      let score =
        identityMatches.length * 10 + documentSemantic * 24 + evidenceScore;

      if (exactNameMatch) {
        score += 42;
      }
      if (
        query.intents.includes("action") &&
        person.actions.some((action) => action.status === "pending")
      ) {
        score += 10;
      }

      return score >= 12
        ? {
            person,
            score,
            evidence,
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        person: RecallCorpusPerson;
        score: number;
        evidence: ScoredEvidence[];
      } => Boolean(item),
    )
    .sort((left, right) => right.score - left.score);

  if (ambiguousPeople.size > 0) {
    const ambiguousResults = scored
      .filter((item) => ambiguousPeople.has(item.person.id))
      .map((item) => resultFor(item.person, item.evidence, item.score));

    return { status: "ambiguous", results: ambiguousResults };
  }

  const results = scored
    .slice(0, 5)
    .map((item) => resultFor(item.person, item.evidence, item.score));

  return {
    status: results.length > 0 ? "resolved" : "no_result",
    results,
  };
}

export function answerFromEvidence(
  status: RecallStatus,
  results: RecallPersonResult[],
): string {
  if (status === "no_result") {
    return "확인된 관계 기억 안에서 조건에 맞는 사람을 찾지 못했습니다. 행사, 장소, 회사 또는 대화 주제를 더해 보세요.";
  }
  if (status === "ambiguous") {
    const names = [...new Set(results.map((result) => result.displayName))];
    return `${names.join(", ")} 이름으로 여러 사람이 있습니다. 소속이나 만남 맥락을 추가하면 안전하게 구분할 수 있습니다.`;
  }

  const first = results[0];
  return first
    ? `가장 관련 있는 사람은 ${first.displayName}님입니다. ${first.reason}`
    : "확인된 근거가 없습니다.";
}

export function buildRecallResponse(
  queryText: string,
  parsedQuery: ParsedRecallQuery,
  corpus: RecallCorpusPerson[],
  latencyMs: number,
): RecallResponse {
  const ranked = rankRecallCandidates(queryText, parsedQuery, corpus);

  return {
    queryId: null,
    status: ranked.status,
    answer: answerFromEvidence(ranked.status, ranked.results),
    parsedQuery,
    results: ranked.results,
    latencyMs,
    mode: "structured_local_semantic",
    model: "local-hash-v1",
  };
}
