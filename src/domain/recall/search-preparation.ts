export interface SearchPreparationStatus {
  mode: "mock" | "live";
  ready: boolean;
  total: number;
  prepared: number;
  remaining: number;
  retryable: number;
  processing: number;
}

export interface SearchPreparationResult {
  status: SearchPreparationStatus;
  attemptedCount: number;
  completedCount: number;
  failureCount: number;
  retryAfterSeconds: number | null;
}
