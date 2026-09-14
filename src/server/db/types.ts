export type VerificationStatus = "confirmed" | "draft" | "rejected";

export interface PersonSummary {
  id: string;
  displayName: string;
  headline: string | null;
  organizationName: string | null;
  organizationTitle: string | null;
  interactionCount: number;
  pendingActionCount: number;
  lastInteractionAt: string | null;
  hasDuplicateName: boolean;
}

export interface PersonAffiliation {
  id: string;
  organizationName: string;
  title: string | null;
  isCurrent: boolean;
  verificationStatus: VerificationStatus;
}

export interface PersonAttribute {
  id: string;
  kind: string;
  value: string;
  verificationStatus: VerificationStatus;
}

export interface MemoryStatement {
  id: string;
  interactionId: string | null;
  statementType: string;
  body: string;
  occurredAt: string | null;
  sourceKind: string;
  verificationStatus: VerificationStatus;
  sourceRef: string | null;
  confidence: number | null;
}

export interface PersonInteraction {
  id: string;
  interactionType: string;
  occurredAt: string;
  location: string | null;
  summary: string;
  sourceKind: string;
  verificationStatus: VerificationStatus;
  eventName: string | null;
  topics: string[];
}

export interface PersonActionItem {
  id: string;
  interactionId: string | null;
  kind: string;
  title: string;
  details: string | null;
  status: "pending" | "completed" | "dismissed";
  dueAt: string | null;
  completedAt: string | null;
  sourceKind: string;
  verificationStatus: VerificationStatus;
}

export interface PersonProfile {
  id: string;
  displayName: string;
  headline: string | null;
  notes: string | null;
  hasDuplicateName: boolean;
  affiliations: PersonAffiliation[];
  attributes: PersonAttribute[];
  memories: MemoryStatement[];
  interactions: PersonInteraction[];
  actions: PersonActionItem[];
}
