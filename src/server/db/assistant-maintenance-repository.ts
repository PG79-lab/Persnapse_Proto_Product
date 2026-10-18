import "server-only";
import { getDatabase } from "./client";
export async function cleanupAssistantHistory(workspaceId: string) {
  return getDatabase().begin(async (sql) => {
    const turns =
      await sql`delete from public.assistant_turns where workspace_id=${workspaceId}
      and created_at<now()-interval '30 days' and status<>'processing' returning id`;
    const sessions =
      await sql`delete from public.assistant_sessions where workspace_id=${workspaceId}
      and updated_at<now()-interval '30 days' and (lease_until is null or lease_until<now()) returning id`;
    return { removedTurns: turns.length, removedSessions: sessions.length };
  });
}
