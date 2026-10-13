import "server-only";
import { indexPersonMemory } from "../db/memory-search-repository";
import { reserveAiCall } from "../db/ai-budget-repository";

import { createHash, randomUUID } from "node:crypto";

import { jpegDimensions } from "../../../card_recognition/jpeg-dimensions";
import type { CardCorners } from "../../../card_recognition/geometry";

import {
  businessCardDraftV1Schema,
  businessCardExtractionV1Schema,
  extractionToBusinessCardDraft,
  mergeBusinessCardContext,
} from "../../domain/business-card/business-card-draft";
import type {
  BusinessCardCommitResponse,
  BusinessCardSessionView,
  CaptureIdentityChoice,
} from "../../domain/business-card/business-card-workflow";
import { extractBusinessCardMock } from "../../domain/business-card/mock-ocr";
import { captureDraftV1Schema } from "../../domain/capture/capture-draft";
import { structureTextCaptureMock } from "../../domain/capture/mock-structurer";
import {
  createClovaBusinessCardAdapter,
  type BusinessCardOcrInput,
} from "../ai/clova-business-card-adapter";
import { createOpenAiCaptureAdapter } from "../ai/openai-capture-adapter";
import { createOpenAiBusinessCardAdapter } from "../ai/openai-business-card-adapter";
import {
  AiTaskExecutionError,
  executeAiTask,
  type AiTaskAdapter,
} from "../ai/runtime-router";
import { createAiAttemptRecorder } from "../db/ai-run-repository";
import {
  commitBusinessCard,
  createBusinessCardCapture,
  deleteUncommittedBusinessCardCapture,
  findReusableBusinessCardExtraction,
  findBusinessCardIdentityCandidates,
  getBusinessCardByIdempotencyKey,
  getBusinessCardCapture,
  listUncommittedBusinessCards,
  getBusinessCardOcrInput,
  getOriginalAssetForDeletion,
  getSourceAsset,
  markBusinessCardFailed,
  markOriginalAssetDeleted,
  resetBusinessCardForRetry,
  saveBusinessCardExtraction,
  saveConfirmedBusinessCardFields,
  saveBusinessCardReview,
  saveRestoredBusinessCardDisplay,
} from "../db/business-card-repository";
import {
  CaptureNotFoundError,
  CaptureStateConflictError,
  rebuildPersonMemoryDocument,
} from "../db/capture-repository";
import {
  clovaBusinessCardProviderScope,
  completeOcrProviderCall,
  markOcrProviderCallStarted,
  OcrCostGuardUnavailableError,
  OcrCostLimitError,
  openAiBusinessCardProviderScope,
  reserveOcrProviderCall,
  type OcrProviderReservation,
} from "../db/ocr-cost-guard-repository";
import { getServerEnv } from "../env";
import {
  downloadBusinessCardAsset,
  removeBusinessCardAssets,
  uploadBusinessCardAsset,
} from "../storage/business-card-storage";

const allowedMimeTypes = new Set(["image/jpeg", "image/png"]);
const maxOriginalBytes = 2_300_000;
const maxDisplayBytes = 1_500_000;
const maxCombinedUploadBytes = 4 * 1024 * 1024;

export class BusinessCardImageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BusinessCardImageError";
  }
}

export class BusinessCardProcessingError extends Error {
  constructor(
    public readonly captureId: string,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super("Business card processing failed.");
    this.name = "BusinessCardProcessingError";
  }
}

export class BusinessCardCostLimitError extends Error {
  constructor(
    public readonly captureId: string,
    public readonly code: OcrCostLimitError["code"],
    public readonly retryAfterSeconds: number,
  ) {
    super("Business card OCR was blocked by the application cost guard.");
    this.name = "BusinessCardCostLimitError";
  }
}

function reusableUploadResult(
  existing: BusinessCardSessionView,
): BusinessCardSessionView {
  if (existing.state === "failed") {
    throw new BusinessCardProcessingError(
      existing.captureId,
      existing.lastErrorCode ?? "CARD_OCR_FAILED",
    );
  }
  if (existing.draft) return existing;
  throw new BusinessCardCostLimitError(
    existing.captureId,
    "OCR_DUPLICATE_IN_PROGRESS",
    2,
  );
}

function detectedMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function validatedImage(
  file: File,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mimeType: string; sha256: string }> {
  if (!allowedMimeTypes.has(file.type)) {
    throw new BusinessCardImageError(
      "JPEG, PNG 또는 WebP 명함 이미지만 사용할 수 있습니다.",
      "CARD_IMAGE_TYPE_UNSUPPORTED",
    );
  }
  if (file.size <= 0 || file.size > maxBytes) {
    throw new BusinessCardImageError(
      "명함 이미지 크기를 다시 확인해 주세요.",
      "CARD_IMAGE_SIZE_INVALID",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectedMimeType(bytes);
  if (!detected || detected !== file.type) {
    throw new BusinessCardImageError(
      "파일 내용과 이미지 형식이 일치하지 않습니다.",
      "CARD_IMAGE_SIGNATURE_INVALID",
    );
  }
  return {
    bytes,
    mimeType: detected,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function runBusinessCardOcr(input: {
  workspaceId: string;
  captureId: string;
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  sha256: string;
  referenceTime: string;
  operationKey: string;
}): Promise<BusinessCardSessionView> {
  const environment = getServerEnv();
  const selectedProvider =
    environment.BUSINESS_CARD_OCR_PROVIDER ?? "naver_clova";
  const providerScope =
    selectedProvider === "openai"
      ? openAiBusinessCardProviderScope
      : clovaBusinessCardProviderScope;
  const ocrEnvironment = {
    ...environment,
    AI_ROUTING_MODE: environment.BUSINESS_CARD_OCR_MODE,
  };
  const startedAt = performance.now();
  const mockAdapter: AiTaskAdapter<BusinessCardOcrInput> = {
    async execute({ input: ocrInput }) {
      return extractBusinessCardMock(ocrInput);
    },
  };
  const recordAttempt = createAiAttemptRecorder({
    workspaceId: input.workspaceId,
    captureSessionId: input.captureId,
    schemaVersion: "business-card-extraction-v1",
  });
  let successfulProvider: string | null = null;
  let reservation: OcrProviderReservation | undefined;

  try {
    if (environment.BUSINESS_CARD_OCR_MODE === "live") {
      const reusableExtraction = await findReusableBusinessCardExtraction({
        workspaceId: input.workspaceId,
        captureId: input.captureId,
        imageSha256: input.sha256,
        provider: selectedProvider,
      });
      if (reusableExtraction) {
        const draft = extractionToBusinessCardDraft(
          reusableExtraction,
          input.referenceTime,
        );
        await saveBusinessCardExtraction({
          workspaceId: input.workspaceId,
          captureId: input.captureId,
          draft,
          provider: `${selectedProvider}_cache`,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        const capture = await getBusinessCardCapture(
          input.workspaceId,
          input.captureId,
        );
        if (!capture) {
          throw new Error("Cached business card could not be reloaded.");
        }
        return capture;
      }

      reservation = await reserveOcrProviderCall({
        workspaceId: input.workspaceId,
        captureId: input.captureId,
        operationKey: input.operationKey,
        imageSha256: input.sha256,
        providerScope,
      });
    }

    const activeReservation = reservation;
    const clovaAdapter =
      environment.CLOVA_OCR_INVOKE_URL && environment.CLOVA_OCR_SECRET
        ? createClovaBusinessCardAdapter({
            invokeUrl: environment.CLOVA_OCR_INVOKE_URL,
            secret: environment.CLOVA_OCR_SECRET,
            beforeRequest: activeReservation
              ? () =>
                  markOcrProviderCallStarted(
                    activeReservation.id,
                    activeReservation.providerScope,
                  )
              : undefined,
          })
        : undefined;
    const openAiAdapter = environment.OPENAI_API_KEY
      ? createOpenAiBusinessCardAdapter(
          environment.OPENAI_API_KEY,
          activeReservation && selectedProvider === "openai"
            ? () =>
                markOcrProviderCallStarted(
                  activeReservation.id,
                  activeReservation.providerScope,
                )
            : undefined,
        )
      : undefined;
    const extraction = await executeAiTask({
      task: "businessCardOcr",
      environment: ocrEnvironment,
      input: {
        filename: input.filename,
        bytes: input.bytes,
        mimeType: input.mimeType,
        sha256: input.sha256,
      },
      outputSchema: businessCardExtractionV1Schema,
      mockAdapter,
      liveAdapters: {
        ...(clovaAdapter ? { naver_clova: clovaAdapter } : {}),
        ...(openAiAdapter ? { openai: openAiAdapter } : {}),
      },
      timeoutMs: 12_000,
      maxAttemptsPerRoute: 1,
      async onAttempt(event) {
        if (event.status === "mocked") successfulProvider = "mock";
        if (event.status === "succeeded") {
          successfulProvider = event.provider;
        }
        await recordAttempt(event);
      },
    });
    const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    const draft = extractionToBusinessCardDraft(
      extraction,
      input.referenceTime,
    );
    await saveBusinessCardExtraction({
      workspaceId: input.workspaceId,
      captureId: input.captureId,
      draft,
      provider:
        successfulProvider ??
        (environment.BUSINESS_CARD_OCR_MODE === "mock"
          ? "mock"
          : selectedProvider),
      latencyMs: elapsedMs,
      ocrReservationId: reservation?.id,
    });
    const capture = await getBusinessCardCapture(
      input.workspaceId,
      input.captureId,
    );
    if (!capture)
      throw new Error("Business card Capture could not be reloaded.");
    return capture;
  } catch (error) {
    const code =
      error instanceof AiTaskExecutionError
        ? error.code
        : error instanceof OcrCostGuardUnavailableError
          ? "OCR_GUARD_UNAVAILABLE"
          : error instanceof OcrCostLimitError
            ? error.code
            : "CARD_OCR_FAILED";
    if (reservation) {
      await completeOcrProviderCall({
        reservationId: reservation.id,
        providerScope: reservation.providerScope,
        status: "failed",
        errorCode: code,
      }).catch(() => undefined);
    }
    const duplicateRequestInProgress =
      error instanceof OcrCostLimitError &&
      (error.code === "OCR_DUPLICATE_IN_PROGRESS" ||
        error.code === "OCR_DUPLICATE_REQUEST");
    if (!duplicateRequestInProgress) {
      await markBusinessCardFailed(input.workspaceId, input.captureId, code);
    }
    if (error instanceof OcrCostLimitError) {
      throw new BusinessCardCostLimitError(
        input.captureId,
        error.code,
        error.retryAfterSeconds,
      );
    }
    throw new BusinessCardProcessingError(
      input.captureId,
      code,
      error instanceof AiTaskExecutionError
        ? error.retryAfterSeconds
        : undefined,
    );
  }
}

export async function createAndExtractBusinessCard(input: {
  workspaceId: string;
  idempotencyKey: string;
  referenceTime: string;
  originalFile: File;
  displayFile: File;
  originalWidth: number;
  originalHeight: number;
  displayWidth: number;
  displayHeight: number;
  processingRecipe:
    "canvas-card-v1" | "docaligner-lc100-card-v1" | "manual-card-v1";
}): Promise<BusinessCardSessionView> {
  const existing = await getBusinessCardByIdempotencyKey(
    input.workspaceId,
    input.idempotencyKey,
  );
  if (existing) return reusableUploadResult(existing);

  if (
    input.originalFile.size + input.displayFile.size >=
    maxCombinedUploadBytes
  ) {
    throw new BusinessCardImageError(
      "명함 이미지의 전송 크기가 너무 큽니다. 다시 촬영하거나 선택해 주세요.",
      "CARD_IMAGE_PAYLOAD_TOO_LARGE",
    );
  }

  const [originalImage, displayImage] = await Promise.all([
    validatedImage(input.originalFile, maxOriginalBytes),
    validatedImage(input.displayFile, maxDisplayBytes),
  ]);
  const captureId = randomUUID();
  const originalAssetId = randomUUID();
  const displayAssetId = randomUUID();
  const originalPath = `${input.workspaceId}/${captureId}/${originalAssetId}-original.${extensionForMime(originalImage.mimeType)}`;
  const displayPath = `${input.workspaceId}/${captureId}/${displayAssetId}-display.${extensionForMime(displayImage.mimeType)}`;
  const uploadedPaths: string[] = [];
  let captureCreated = false;

  try {
    const uploadResults = await Promise.allSettled([
      uploadBusinessCardAsset({
        path: originalPath,
        bytes: originalImage.bytes,
        contentType: originalImage.mimeType,
      }),
      uploadBusinessCardAsset({
        path: displayPath,
        bytes: displayImage.bytes,
        contentType: displayImage.mimeType,
      }),
    ]);
    for (const [index, result] of uploadResults.entries()) {
      if (result.status === "fulfilled") {
        uploadedPaths.push(index === 0 ? originalPath : displayPath);
      }
    }
    const failedUpload = uploadResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedUpload) throw failedUpload.reason;
    captureCreated = await createBusinessCardCapture({
      workspaceId: input.workspaceId,
      captureId,
      idempotencyKey: input.idempotencyKey,
      original: {
        id: originalAssetId,
        path: originalPath,
        mimeType: originalImage.mimeType,
        sha256: originalImage.sha256,
        filename: input.originalFile.name,
        byteSize: input.originalFile.size,
        width: input.originalWidth,
        height: input.originalHeight,
        variant: "original",
        processingMetadata: {},
      },
      display: {
        id: displayAssetId,
        path: displayPath,
        mimeType: displayImage.mimeType,
        sha256: displayImage.sha256,
        filename: input.displayFile.name,
        byteSize: input.displayFile.size,
        width: input.displayWidth,
        height: input.displayHeight,
        variant: "display",
        processingMetadata: {
          recipe: input.processingRecipe,
          maxUpscale: 2,
          maxLongEdge: 1960,
          generative: false,
        },
      },
    });
  } catch (error) {
    await removeBusinessCardAssets(uploadedPaths).catch(() => undefined);
    throw error;
  }

  if (!captureCreated) {
    // A different worker won the DB idempotency key while files were uploading.
    // Remove only this request's files before returning the winner's state.
    await removeBusinessCardAssets(uploadedPaths);
    const winner = await getBusinessCardByIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey,
    );
    if (winner) return reusableUploadResult(winner);
    throw new CaptureStateConflictError(
      "Idempotency key is already bound to a different capture.",
    );
  }

  return runBusinessCardOcr({
    workspaceId: input.workspaceId,
    captureId,
    filename: input.originalFile.name,
    bytes:
      input.processingRecipe === "canvas-card-v1"
        ? originalImage.bytes
        : displayImage.bytes,
    mimeType:
      input.processingRecipe === "canvas-card-v1"
        ? originalImage.mimeType
        : displayImage.mimeType,
    sha256:
      input.processingRecipe === "canvas-card-v1"
        ? originalImage.sha256
        : displayImage.sha256,
    referenceTime: input.referenceTime,
    operationKey: input.idempotencyKey,
  });
}

export async function retryBusinessCardExtraction(
  workspaceId: string,
  captureId: string,
  requestKey: string,
): Promise<BusinessCardSessionView> {
  const capture = await getBusinessCardCapture(workspaceId, captureId);
  if (!capture) {
    throw new BusinessCardImageError(
      "재시도할 명함 Capture를 찾을 수 없습니다.",
      "CARD_SOURCE_NOT_FOUND",
    );
  }
  if (capture.state !== "failed") {
    throw new CaptureStateConflictError(
      "Only a failed business card Capture can be retried.",
    );
  }
  if (capture.fieldsConfirmedAt) {
    throw new CaptureStateConflictError(
      "Confirmed business card fields cannot be replaced by an OCR retry.",
    );
  }
  const source = await getBusinessCardOcrInput(workspaceId, captureId);
  if (!source) {
    throw new BusinessCardImageError(
      "재시도할 원본 명함을 찾을 수 없습니다.",
      "CARD_SOURCE_NOT_FOUND",
    );
  }
  await resetBusinessCardForRetry(workspaceId, captureId);
  const storedImage = await downloadBusinessCardAsset(source.path);
  return runBusinessCardOcr({
    workspaceId,
    captureId,
    filename: source.filename,
    bytes: new Uint8Array(await storedImage.arrayBuffer()),
    mimeType: source.mimeType,
    sha256: source.sha256,
    referenceTime: new Date().toISOString(),
    operationKey: requestKey,
  });
}

export async function confirmBusinessCardFields(input: {
  workspaceId: string;
  captureId: string;
  draft: unknown;
}): Promise<BusinessCardSessionView> {
  const draft = businessCardDraftV1Schema.parse(input.draft);
  await saveConfirmedBusinessCardFields({ ...input, draft });
  const card = await getBusinessCardCapture(input.workspaceId, input.captureId);
  if (!card) throw new CaptureNotFoundError();
  return card;
}

export async function replaceBusinessCardDisplay(input: {
  workspaceId: string;
  captureId: string;
  file: File;
  corners: CardCorners;
  coverage: number;
}): Promise<BusinessCardSessionView> {
  const card = await getBusinessCardCapture(input.workspaceId, input.captureId);
  if (!card) throw new CaptureNotFoundError();
  if (
    !card.fieldsConfirmedAt ||
    !["draft", "review", "failed", "committed"].includes(card.state)
  ) {
    throw new CaptureStateConflictError(
      "Business card fields must be confirmed before restoration.",
    );
  }
  const display = await getSourceAsset(input.workspaceId, card.displayAssetId);
  if (!display || display.mimeType !== "image/jpeg") {
    throw new BusinessCardImageError(
      "복원할 명함 이미지를 찾지 못했습니다.",
      "CARD_SOURCE_NOT_FOUND",
    );
  }
  const image = await validatedImage(input.file, 3_200_000);
  if (image.mimeType !== "image/jpeg") {
    throw new BusinessCardImageError(
      "복원 이미지는 JPEG 형식이어야 합니다.",
      "CARD_IMAGE_TYPE_UNSUPPORTED",
    );
  }
  const dimensions = jpegDimensions(image.bytes);
  if (
    !dimensions ||
    dimensions.width > 4000 ||
    dimensions.height > 4000 ||
    dimensions.width < 160 ||
    dimensions.height < 80
  ) {
    throw new BusinessCardImageError(
      "복원 이미지의 크기를 확인할 수 없습니다.",
      "CARD_IMAGE_SIZE_INVALID",
    );
  }
  const newPath = `${input.workspaceId}/${input.captureId}/${card.displayAssetId}-display-${randomUUID()}.jpg`;
  await uploadBusinessCardAsset({
    path: newPath,
    bytes: image.bytes,
    contentType: image.mimeType,
  });
  try {
    await saveRestoredBusinessCardDisplay({
      workspaceId: input.workspaceId,
      captureId: input.captureId,
      assetId: card.displayAssetId,
      previousPath: display.path,
      newPath,
      sha256: image.sha256,
      byteSize: image.bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      corners: input.corners,
      coverage: input.coverage,
    });
  } catch (error) {
    await removeBusinessCardAssets([newPath]).catch(() => undefined);
    throw error;
  }
  await removeBusinessCardAssets([display.path]).catch(() => undefined);
  const restored = await getBusinessCardCapture(
    input.workspaceId,
    input.captureId,
  );
  if (!restored) throw new CaptureNotFoundError();
  return restored;
}

export async function prepareBusinessCardReview(input: {
  workspaceId: string;
  captureId: string;
  cardDraft: unknown;
  contextNote: string;
  referenceTime?: string;
}): Promise<BusinessCardSessionView> {
  const environment = getServerEnv();
  const cardDraft = businessCardDraftV1Schema.parse(input.cardDraft);
  const capture = await getBusinessCardCapture(
    input.workspaceId,
    input.captureId,
  );
  if (!capture) throw new CaptureNotFoundError();
  if (capture.state === "review" || capture.state === "committed") {
    throw new CaptureStateConflictError(
      "Business card must be in draft or failed before context review.",
    );
  }
  if (!capture.fieldsConfirmedAt || !capture.draft) {
    throw new CaptureStateConflictError(
      "Business card fields must be confirmed before context review.",
    );
  }
  if (
    JSON.stringify(capture.draft.identity) !==
    JSON.stringify(cardDraft.identity)
  ) {
    throw new CaptureStateConflictError(
      "Confirmed business card fields cannot be changed during context review.",
    );
  }
  if (capture.state === "failed") {
    await resetBusinessCardForRetry(input.workspaceId, input.captureId);
  }

  const structuringInput = {
    rawText: input.contextNote,
    referenceTime: input.referenceTime ?? capture.createdAt,
  };
  const mockAdapter: AiTaskAdapter<typeof structuringInput> = {
    async execute({ input: textInput }) {
      return structureTextCaptureMock(textInput);
    },
  };
  const openAiAdapter = environment.OPENAI_API_KEY
    ? createOpenAiCaptureAdapter(environment.OPENAI_API_KEY)
    : undefined;

  try {
    const context = await executeAiTask({
      task: "informationStructuring",
      environment,
      input: structuringInput,
      outputSchema: captureDraftV1Schema,
      mockAdapter,
      liveAdapters: openAiAdapter ? { openai: openAiAdapter } : undefined,
      timeoutMs: 15_000,
      maxAttemptsPerRoute: 1,
      beforeLiveAttempt: (task) =>
        reserveAiCall(input.workspaceId, task, environment),
      onAttempt: createAiAttemptRecorder({
        workspaceId: input.workspaceId,
        captureSessionId: input.captureId,
        schemaVersion: "capture-draft-v1",
      }),
    });
    const merged = mergeBusinessCardContext(capture.draft, context);
    await saveBusinessCardReview({
      workspaceId: input.workspaceId,
      captureId: input.captureId,
      draft: merged,
      contextNote: input.contextNote,
    });
    const reviewed = await getBusinessCardCapture(
      input.workspaceId,
      input.captureId,
    );
    if (!reviewed)
      throw new Error("Reviewed business card could not be reloaded.");
    reviewed.identityCandidates = await findBusinessCardIdentityCandidates(
      input.workspaceId,
      merged,
    );
    return reviewed;
  } catch (error) {
    if (
      error instanceof CaptureNotFoundError ||
      error instanceof CaptureStateConflictError
    ) {
      // A competing review/commit must not be turned into an OCR failure.
      throw error;
    }
    const code =
      error instanceof AiTaskExecutionError
        ? error.code
        : "CARD_CONTEXT_STRUCTURING_FAILED";
    await markBusinessCardFailed(input.workspaceId, input.captureId, code);
    throw new BusinessCardProcessingError(input.captureId, code);
  }
}

export async function listResumableBusinessCards(
  workspaceId: string,
): Promise<BusinessCardSessionView[]> {
  const cards = await listUncommittedBusinessCards(workspaceId);
  return Promise.all(
    cards.map(async (card) => {
      if (card.state === "review" && card.draft) {
        card.identityCandidates = await findBusinessCardIdentityCandidates(
          workspaceId,
          card.draft,
        );
      }
      return card;
    }),
  );
}

export async function searchBusinessCardCandidates(
  workspaceId: string,
  captureId: string,
  draft: unknown,
) {
  const capture = await getBusinessCardCapture(workspaceId, captureId);
  if (!capture) throw new CaptureNotFoundError();
  if (capture.state !== "review") {
    throw new CaptureStateConflictError(
      "Business card must be in review before candidate search.",
    );
  }
  return findBusinessCardIdentityCandidates(
    workspaceId,
    businessCardDraftV1Schema.parse(draft),
  );
}

export async function commitReviewedBusinessCard(input: {
  workspaceId: string;
  captureId: string;
  draft: unknown;
  identity: CaptureIdentityChoice;
}): Promise<BusinessCardCommitResponse> {
  const draft = businessCardDraftV1Schema.parse(input.draft);
  const result = await commitBusinessCard({ ...input, draft });
  let memoryDocumentStatus: "updated" | "failed" = "updated";
  try {
    await rebuildPersonMemoryDocument(input.workspaceId, result.personId);
    await indexPersonMemory(input.workspaceId, result.personId);
  } catch {
    memoryDocumentStatus = "failed";
  }
  const card = await getBusinessCardCapture(input.workspaceId, input.captureId);
  if (!card) throw new Error("Committed business card could not be reloaded.");
  const recallQuery =
    draft.topics[0] ??
    draft.interaction.eventName ??
    draft.interaction.location ??
    draft.identity.organizationName ??
    draft.identity.displayName ??
    "최근 만난 사람";
  return { card, memoryDocumentStatus, recallQuery };
}

export async function discardBusinessCardCapture(
  workspaceId: string,
  captureId: string,
): Promise<void> {
  const paths = await deleteUncommittedBusinessCardCapture(
    workspaceId,
    captureId,
  );
  await removeBusinessCardAssets(paths);
}

export async function deleteBusinessCardOriginal(
  workspaceId: string,
  businessCardId: string,
): Promise<"deleted" | "already_deleted"> {
  const asset = await getOriginalAssetForDeletion(workspaceId, businessCardId);
  if (!asset) return "already_deleted";
  await removeBusinessCardAssets([asset.path]);
  await markOriginalAssetDeleted(workspaceId, businessCardId, asset.assetId);
  return "deleted";
}
