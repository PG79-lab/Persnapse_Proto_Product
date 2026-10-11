import "server-only";
import type { SearchPreparationResult } from "../../domain/recall/search-preparation";
import { AiTaskExecutionError } from "../ai/runtime-router";
import { rebuildPersonMemoryDocument } from "../db/capture-repository";
import {
  getSearchPreparationStatus,
  indexPersonMemory,
  listRetryableMemoryPeople,
} from "../db/memory-search-repository";
import { getServerEnv } from "../env";

// Bound each submission to two sequential provider requests. More work needs
// another explicit submission, rather than a background billable loop.
export const searchPreparationBatchSize = 2;

export async function inspectSearchPreparation(workspaceId: string) {
  const env = getServerEnv();
  return getSearchPreparationStatus(
    workspaceId,
    env.VOYAGE_EMBEDDING_MODEL,
    env.AI_ROUTING_MODE,
  );
}

export async function prepareSearch(
  workspaceId: string,
): Promise<SearchPreparationResult> {
  const env = getServerEnv();
  if (env.AI_ROUTING_MODE !== "live")
    return {
      status: await inspectSearchPreparation(workspaceId),
      attemptedCount: 0,
      completedCount: 0,
      failureCount: 0,
      retryAfterSeconds: null,
    };

  const people = await listRetryableMemoryPeople(
    workspaceId,
    env.VOYAGE_EMBEDDING_MODEL,
    searchPreparationBatchSize,
  );
  let attemptedCount = 0,
    completedCount = 0,
    failureCount = 0;
  let retryAfterSeconds: number | null = null;
  for (const personId of people) {
    attemptedCount++;
    try {
      await rebuildPersonMemoryDocument(workspaceId, personId);
      await indexPersonMemory(workspaceId, personId);
      completedCount++;
    } catch (error) {
      failureCount++;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["AI_RATE_LIMITED", "AI_PROVIDER_RATE_LIMITED"].includes(
          String(error.code),
        )
      ) {
        const delay =
          "retryAfterSeconds" in error ? Number(error.retryAfterSeconds) : 60;
        retryAfterSeconds = Number.isFinite(delay)
          ? Math.max(
              1,
              Math.min(
                error.code === "AI_PROVIDER_RATE_LIMITED" ? 3600 : 60,
                Math.ceil(delay),
              ),
            )
          : 60;
        break;
      }
      // A concurrent worker's lease needs time to complete, not another request.
      if (
        error instanceof AiTaskExecutionError &&
        error.code === "SEARCH_NOT_READY"
      ) {
        retryAfterSeconds = 2;
        break;
      }
    }
  }
  return {
    status: await inspectSearchPreparation(workspaceId),
    attemptedCount,
    completedCount,
    failureCount,
    retryAfterSeconds,
  };
}
