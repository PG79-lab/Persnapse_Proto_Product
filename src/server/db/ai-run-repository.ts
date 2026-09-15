import "server-only";

import type { AiAttemptEvent } from "../ai/runtime-router";
import { getDatabase } from "./client";

export interface AiAttemptRecorderContext {
  workspaceId: string;
  captureSessionId?: string;
  schemaVersion: string;
}

export function createAiAttemptRecorder(context: AiAttemptRecorderContext) {
  let previousRunId: string | undefined;

  return async function recordAiAttempt(event: AiAttemptEvent): Promise<void> {
    const sql = getDatabase();

    await sql.begin(async (transaction) => {
      const [run] = await transaction<Array<{ id: string }>>`
        insert into public.ai_runs (
          workspace_id,
          capture_session_id,
          task,
          provider,
          model,
          status,
          schema_version,
          latency_ms,
          error_code,
          attempt,
          retry_of_ai_run_id,
          metadata,
          completed_at
        )
        values (
          ${context.workspaceId},
          ${context.captureSessionId ?? null},
          ${event.task},
          ${event.provider},
          ${event.model},
          ${event.status},
          ${context.schemaVersion},
          ${event.latencyMs},
          ${event.errorCode ?? null},
          ${event.attempt},
          ${previousRunId ?? null},
          ${JSON.stringify({
            mode: event.mode,
            lane: event.lane,
          })}::jsonb,
          now()
        )
        returning id
      `;

      if (context.captureSessionId) {
        await transaction`
          update public.capture_sessions
          set ai_run_id = ${run.id}
          where workspace_id = ${context.workspaceId}
            and id = ${context.captureSessionId}
            and state <> 'committed'
        `;
      }

      previousRunId = run.id;
    });
  };
}
