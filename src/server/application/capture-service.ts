import "server-only";
import { indexPersonMemory } from "../db/memory-search-repository";
import { reserveAiCall } from "../db/ai-budget-repository";

import { captureDraftV1Schema } from "../../domain/capture/capture-draft";
import { structureTextCaptureMock } from "../../domain/capture/mock-structurer";
import type {
  CaptureCommitResponse,
  CaptureIdentityChoice,
  CaptureSessionView,
  CaptureStructuringInput,
} from "../../domain/capture/capture-workflow";
import { createOpenAiCaptureAdapter } from "../ai/openai-capture-adapter";
import {
  AiTaskExecutionError,
  executeAiTask,
  type AiTaskAdapter,
} from "../ai/runtime-router";
import { createAiAttemptRecorder } from "../db/ai-run-repository";
import {
  CaptureNotFoundError,
  CaptureStateConflictError,
  commitTextCapture,
  createCaptureSession,
  findIdentityCandidates,
  getCaptureSession,
  markCaptureFailed,
  prepareCaptureForStructuring,
  rebuildPersonMemoryDocument,
  saveStructuredCapture,
  type StoredCaptureSession,
} from "../db/capture-repository";
import { getServerEnv } from "../env";

const inFlightStructuring = new Map<string, Promise<CaptureSessionView>>();

export class CaptureStructuringError extends Error {
  constructor(
    public readonly captureId: string,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super("Capture structuring failed.");
    this.name = "CaptureStructuringError";
  }
}

async function captureView(
  workspaceId: string,
  capture: StoredCaptureSession,
): Promise<CaptureSessionView> {
  const draft = capture.structuredDraft;
  const identityCandidates =
    capture.state === "review" && draft
      ? await findIdentityCandidates(workspaceId, draft)
      : [];

  return {
    captureId: capture.id,
    state: capture.state,
    rawText: capture.rawText,
    modelDraft: capture.modelDraft,
    draft,
    identityCandidates,
    userCorrectionCount: capture.userCorrectionCount,
    lastErrorCode: capture.lastErrorCode,
    commitResult: capture.commitResult,
    createdAt: capture.createdAt,
  };
}

async function runStructuring(
  workspaceId: string,
  captureId: string,
  referenceTime?: string,
): Promise<CaptureSessionView> {
  const environment = getServerEnv();
  const capture = await prepareCaptureForStructuring(workspaceId, captureId);
  const input: CaptureStructuringInput = {
    rawText: capture.rawText,
    referenceTime: referenceTime ?? capture.createdAt,
  };
  const mockAdapter: AiTaskAdapter<CaptureStructuringInput> = {
    async execute({ input: structuringInput }) {
      return structureTextCaptureMock(structuringInput);
    },
  };
  const openAiAdapter = environment.OPENAI_API_KEY
    ? createOpenAiCaptureAdapter(environment.OPENAI_API_KEY)
    : undefined;

  try {
    const draft = await executeAiTask({
      task: "informationStructuring",
      environment,
      input,
      outputSchema: captureDraftV1Schema,
      mockAdapter,
      liveAdapters: openAiAdapter
        ? {
            openai: openAiAdapter,
          }
        : undefined,
      timeoutMs: 15_000,
      maxAttemptsPerRoute: 1,
      beforeLiveAttempt: (task) =>
        reserveAiCall(workspaceId, task, environment),
      onAttempt: createAiAttemptRecorder({
        workspaceId,
        captureSessionId: captureId,
        schemaVersion: "capture-draft-v1",
      }),
    });
    const saved = await saveStructuredCapture(workspaceId, captureId, draft);
    return captureView(workspaceId, saved);
  } catch (error) {
    const code =
      error instanceof AiTaskExecutionError
        ? error.code
        : "CAPTURE_STRUCTURING_FAILED";
    await markCaptureFailed(workspaceId, captureId, code);
    throw new CaptureStructuringError(
      captureId,
      code,
      error instanceof AiTaskExecutionError
        ? error.retryAfterSeconds
        : undefined,
    );
  }
}

export async function structureTextCapture(input: {
  workspaceId: string;
  captureId: string;
  referenceTime?: string;
}): Promise<CaptureSessionView> {
  const active = inFlightStructuring.get(input.captureId);

  if (active) {
    return active;
  }

  const execution = runStructuring(
    input.workspaceId,
    input.captureId,
    input.referenceTime,
  ).finally(() => {
    inFlightStructuring.delete(input.captureId);
  });
  inFlightStructuring.set(input.captureId, execution);
  return execution;
}

export async function createAndStructureTextCapture(input: {
  workspaceId: string;
  rawText: string;
  idempotencyKey: string;
  referenceTime?: string;
}): Promise<CaptureSessionView> {
  const { capture } = await createCaptureSession(input);

  if (capture.state === "review" || capture.state === "committed") {
    return captureView(input.workspaceId, capture);
  }

  return structureTextCapture({
    workspaceId: input.workspaceId,
    captureId: capture.id,
    referenceTime: input.referenceTime,
  });
}

export async function getTextCapture(
  workspaceId: string,
  captureId: string,
): Promise<CaptureSessionView | null> {
  const capture = await getCaptureSession(workspaceId, captureId);
  return capture ? captureView(workspaceId, capture) : null;
}

export async function searchCaptureIdentityCandidates(
  workspaceId: string,
  captureId: string,
  draft: unknown,
) {
  const capture = await getCaptureSession(workspaceId, captureId);

  if (!capture) {
    throw new CaptureNotFoundError();
  }

  if (capture.state !== "review") {
    throw new CaptureStateConflictError(
      "Capture must be in review before candidate search.",
    );
  }

  return findIdentityCandidates(workspaceId, captureDraftV1Schema.parse(draft));
}

export async function commitReviewedTextCapture(input: {
  workspaceId: string;
  captureId: string;
  draft: unknown;
  identity: CaptureIdentityChoice;
}): Promise<CaptureCommitResponse> {
  const draft = captureDraftV1Schema.parse(input.draft);
  const { result } = await commitTextCapture({
    workspaceId: input.workspaceId,
    captureId: input.captureId,
    draft,
    identity: input.identity,
  });
  let memoryDocumentStatus: "updated" | "failed" = "updated";

  try {
    await rebuildPersonMemoryDocument(input.workspaceId, result.personId);
    await indexPersonMemory(input.workspaceId, result.personId);
  } catch {
    memoryDocumentStatus = "failed";
  }

  const capture = await getCaptureSession(input.workspaceId, input.captureId);

  if (!capture) {
    throw new Error("Committed Capture could not be reloaded.");
  }

  const committedDraft = capture.structuredDraft ?? draft;
  const fallbackIdentity =
    input.identity.mode === "new"
      ? input.identity.displayName
      : "최근 만난 사람";
  const recallQuery =
    committedDraft.topics[0] ??
    committedDraft.interaction.eventName ??
    committedDraft.interaction.location ??
    committedDraft.identityHint.organizationName ??
    committedDraft.identityHint.displayName ??
    fallbackIdentity;

  return {
    capture: await captureView(input.workspaceId, capture),
    memoryDocumentStatus,
    recallQuery,
  };
}
