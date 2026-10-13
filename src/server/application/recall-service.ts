import "server-only";
import { getServerEnv } from "../env";
import { executeLiveRecall } from "./live-recall-service";
import { executeAssistantMemory } from "./assistant-memory-service";

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
  let response: RecallResponse;
  if (getServerEnv().ASSISTANT_CONTEXT_ENABLED === "on") {
    const result = await executeAssistantMemory({
      workspaceId: request.workspaceId,
      query: queryText,
      reference: referenceTime,
    });
    response = { ...result.response, warnings: result.coverage.reasons };
  } else if (getServerEnv().AI_ROUTING_MODE === "live") {
    response = await executeLiveRecall(
      request.workspaceId,
      queryText,
      referenceTime,
    );
  } else {
    const parsedQuery = parseRecallQuery(queryText, referenceTime);
    const corpus = await loadRecallCorpus(request.workspaceId);
    response = buildRecallResponse(
      queryText,
      parsedQuery,
      corpus,
      Math.max(1, Math.round(performance.now() - startedAt)),
    );
  }
  response.latencyMs = Math.max(1, Math.round(performance.now() - startedAt));

  if (request.persist !== false) {
    const queryId = await recordRecallResponse({
      workspaceId: request.workspaceId,
      queryText,
      referenceTime,
      evaluationCaseId: request.evaluationCaseId,
      response,
    });
    return {
      ...response,
      queryId,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  }

  return response;
}
