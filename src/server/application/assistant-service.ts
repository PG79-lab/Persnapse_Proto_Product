import "server-only";
import {
  AssistantError,
  nextContext,
  type TurnRequest,
  type AssistantResponse,
} from "../../domain/assistant/contracts";
import {
  reserveAssistantTurn,
  completeAssistantTurn,
  failAssistantTurn,
} from "../db/assistant-session-repository";
import { recordRecallResponse } from "../db/recall-repository";
import { getServerEnv } from "../env";
import { executeAssistantMemory } from "./assistant-memory-service";

export async function executeAssistantTurn(
  workspaceId: string,
  input: TurnRequest,
): Promise<
  | AssistantResponse
  | { status: "processing"; turnId: string; sessionId: string }
> {
  if (getServerEnv().ASSISTANT_CONTEXT_ENABLED !== "on")
    throw new AssistantError(
      "ASSISTANT_DISABLED",
      "맥락 어시스턴트가 아직 활성화되지 않았습니다.",
      503,
    );
  const reserved = await reserveAssistantTurn(workspaceId, input);
  if (reserved.kind === "existing") {
    if (reserved.turn.status === "succeeded" && reserved.turn.response)
      return reserved.turn.response;
    if (reserved.turn.status === "processing")
      return {
        status: "processing",
        turnId: reserved.turn.id,
        sessionId: input.sessionId,
      };
    throw new AssistantError(
      reserved.turn.error_code ?? "TURN_FAILED",
      reserved.turn.error_message ??
        "이 요청은 완료되지 않았습니다. 새 요청으로 다시 시도해 주세요.",
      409,
    );
  }
  try {
    const result = await executeAssistantMemory({
      workspaceId,
      query: input.message,
      context: reserved.context,
      selection: input.contextSelection,
      recent: reserved.recent.map((t) => ({
        message: t.message,
        answer: [
          t.response?.recall.answer ?? "",
          ...(t.response?.sections
            .slice(0, 3)
            .map((s) => s.title + ": " + s.text.slice(0, 400)) ?? []),
        ].join("\n"),
      })),
    });
    const identityOnly =
      result.response.status === "resolved" &&
      result.response.results.every((p) =>
        p.evidence.every((e) => e.type === "person_profile"),
      );
    if (identityOnly && result.plan.purpose !== "lookup") {
      result.response.answer =
        "인물 정보는 확인했지만, 정리·판단·준비에 필요한 만남이나 주요 기록이 부족합니다. 관련 기록을 추가해 주세요.";
      result.sections = [];
    }
    // Persist existing query/evidence/feedback contracts; never promote interpretation to canonical facts.
    result.response.queryId = await recordRecallResponse({
      workspaceId,
      queryText: input.message,
      referenceTime: new Date(),
      response: result.response,
    });
    const response: AssistantResponse = {
      schemaVersion: "assistant-v1",
      status:
        (identityOnly && result.plan.purpose !== "lookup") ||
        ("insufficientContext" in result && result.insufficientContext)
          ? "insufficient_context"
          : result.response.status,
      sessionId: input.sessionId,
      turnId: reserved.turnId,
      version: reserved.version + 1,
      purpose: result.plan.purpose,
      context: nextContext(result.plan, result.response),
      sections: result.sections,
      coverage: result.coverage,
      recall: result.response,
    };
    await completeAssistantTurn(workspaceId, response);
    return response;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : "ASSISTANT_FAILED";
    const message =
      error instanceof AssistantError ||
      (error instanceof Error && "code" in error)
        ? (error as Error).message
        : "응답을 완료하지 못했습니다. 다시 시도해 주세요.";
    await failAssistantTurn(
      workspaceId,
      input.sessionId,
      reserved.turnId,
      code,
      message,
    ).catch(() => {});
    throw error;
  }
}
