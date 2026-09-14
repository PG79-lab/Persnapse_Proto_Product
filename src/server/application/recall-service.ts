import "server-only";

import { parseRecallQuery } from "../../domain/recall/query-parser";
import { buildRecallResponse } from "../../domain/recall/ranker";
import type { RecallResponse } from "../../domain/recall/types";
import {
  loadRecallCorpus,
  recordRecallResponse,
} from "../db/recall-repository";

export interface RecallRequest {
  workspaceId: string;
  queryText: string;
  referenceTime?: Date;
  evaluationCaseId?: string;
  persist?: boolean;
}

export async function executeRecall(
  request: RecallRequest,
): Promise<RecallResponse> {
  const queryText = request.queryText.trim();

  if (queryText.length < 2 || queryText.length > 500) {
    throw new Error("Recall query must contain between 2 and 500 characters.");
  }

  const referenceTime = request.referenceTime ?? new Date();
  const startedAt = performance.now();
  const parsedQuery = parseRecallQuery(queryText, referenceTime);
  const corpus = await loadRecallCorpus(request.workspaceId);
  const response = buildRecallResponse(
    queryText,
    parsedQuery,
    corpus,
    Math.max(1, Math.round(performance.now() - startedAt)),
  );

  if (request.persist !== false) {
    const queryId = await recordRecallResponse({
      workspaceId: request.workspaceId,
      queryText,
      referenceTime,
      evaluationCaseId: request.evaluationCaseId,
      response,
    });
    return { ...response, queryId };
  }

  return response;
}
