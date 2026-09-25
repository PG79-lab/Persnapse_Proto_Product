import "server-only";
import { getDatabase } from "./client";
import type { ServerEnv } from "../env";
import { AiTaskExecutionError } from "../ai/runtime-router";

export const aiBurstPolicy = Object.freeze({ windowSeconds: 60, maxCalls: 60 });

export async function reserveAiCall(
  workspaceId: string,
  task: string,
  env: ServerEnv,
): Promise<void> {
  if (env.AI_ROUTING_MODE !== "live")
    throw new AiTaskExecutionError(
      "실제 AI 모드가 활성화되지 않았습니다.",
      "AI_LIVE_DISABLED",
      false,
    );
  await getDatabase().begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${"assistant-budget:" + workspaceId}, 0))`;
    const [usage] = await sql<{ recent: number; retry_after: number }[]>`
      select count(*)::int as recent,
        greatest(1, ceil(extract(epoch from (min(created_at) + interval '60 seconds' - clock_timestamp()))))::int as retry_after
      from public.ai_call_reservations
      where workspace_id = ${workspaceId}
        and created_at > clock_timestamp() - interval '60 seconds'
    `;
    if (usage.recent >= aiBurstPolicy.maxCalls)
      throw new AiTaskExecutionError(
        "짧은 시간에 AI 요청이 몰렸습니다. 잠시 후 다시 시도해 주세요.",
        "AI_RATE_LIMITED",
        false,
        Math.min(aiBurstPolicy.windowSeconds, Math.max(1, usage.retry_after)),
      );
    await sql`insert into public.ai_call_reservations(workspace_id, task, created_at) values (${workspaceId}, ${task}, clock_timestamp())`;
  });
}
