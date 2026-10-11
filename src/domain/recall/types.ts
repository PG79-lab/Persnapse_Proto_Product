export const recallIntentIds = [
  "person_lookup",
  "event",
  "topic",
  "place",
  "time",
  "organization",
  "interaction",
  "action",
  "recent",
] as const;

export type RecallIntent = (typeof recallIntentIds)[number];
export type RecallStatus = "resolved" | "ambiguous" | "no_result";
export type RecallActionKind = "commitment" | "follow_up" | "suggestion";
export type RecallEvidenceType =
  | "person_profile"
  | "affiliation"
  | "event"
  | "interaction"
  | "memory_statement"
  | "action_item";

export interface RecallDateRange {
  from: string;
  to: string;
  label: string;
}

export interface ParsedRecallQuery {
  normalizedQuery: string;
  terms: string[];
  intents: RecallIntent[];
  dateRange: RecallDateRange | null;
  parserVersion: "structured-v1" | "llm-v1";
}

export interface RecallCorpusEvidence {
  actionKind?: RecallActionKind | null;
  interactionId?: string | null;
  location?: string | null;
  eventName?: string | null;
  topics?: string[];
  dueAt?: string | null;
  id: string;
  type: RecallEvidenceType;
  text: string;
  occurredAt: string | null;
  verificationStatus: "confirmed";
  memoryStatementId: string | null;
  memoryDocumentId: string | null;
  actionStatus: "pending" | "completed" | "dismissed" | null;
}

export interface RecallCorpusAction {
  kind: RecallActionKind;
  interactionId?: string | null;
  id: string;
  title: string;
  details: string | null;
  dueAt: string | null;
  status: "pending" | "completed" | "dismissed";
}

export interface RecallCorpusPerson {
  id: string;
  displayName: string;
  normalizedName: string;
  headline: string | null;
  organizations: string[];
  documentId: string | null;
  documentContent: string;
  evidence: RecallCorpusEvidence[];
  actions: RecallCorpusAction[];
}

export interface RecallEvidence {
  id: string;
  type: RecallEvidenceType;
  excerpt: string;
  occurredAt: string | null;
  verificationStatus: "confirmed";
  score: number;
  memoryStatementId: string | null;
  memoryDocumentId: string | null;
}

export interface RecallAction {
  kind: RecallActionKind;
  id: string;
  type: "stored";
  title: string;
  details: string | null;
  dueAt: string | null;
  status: "pending" | "completed" | "dismissed";
  executes: false;
}

export interface RecallSuggestion {
  type: "ai_suggestion" | "guidance";
  title: string;
  rationale: string;
  executes: false;
}

export interface RecallPersonResult {
  personId: string;
  displayName: string;
  headline: string | null;
  organizations: string[];
  score: number;
  reason: string;
  evidence: RecallEvidence[];
  storedActions: RecallAction[];
  suggestion: RecallSuggestion | null;
}

export interface RecallResponse {
  queryId: string | null;
  status: RecallStatus;
  answer: string;
  parsedQuery: ParsedRecallQuery;
  results: RecallPersonResult[];
  latencyMs: number;
  mode: "structured_local_semantic" | "live";
  model: string;
  analysis?: string;
  clarification?: string | null;
  warnings?: string[];
  metrics?: { stage: string; latencyMs: number; totalTokens?: number }[];
}
