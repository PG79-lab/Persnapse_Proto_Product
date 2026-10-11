// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getByKey: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  execute: vi.fn(),
  getCapture: vi.fn(),
  markFailed: vi.fn(),
  saveReview: vi.fn(),
  saveExtraction: vi.fn(),
}));
vi.mock("../db/business-card-repository", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBusinessCardByIdempotencyKey: mocks.getByKey,
  createBusinessCardCapture: mocks.create,
  getBusinessCardCapture: mocks.getCapture,
  markBusinessCardFailed: mocks.markFailed,
  saveBusinessCardReview: mocks.saveReview,
  saveBusinessCardExtraction: mocks.saveExtraction,
}));
vi.mock("../storage/business-card-storage", () => ({
  uploadBusinessCardAsset: mocks.upload,
  removeBusinessCardAssets: mocks.remove,
  downloadBusinessCardAsset: vi.fn(),
}));
vi.mock("../ai/runtime-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeAiTask: mocks.execute,
}));
vi.mock("../env", () => ({
  getServerEnv: () => ({
    AI_ROUTING_MODE: "mock",
    BUSINESS_CARD_OCR_MODE: "mock",
  }),
}));

import {
  extractionToBusinessCardDraft,
  businessCardDraftToCaptureDraft,
} from "../../domain/business-card/business-card-draft";
import type { BusinessCardSessionView } from "../../domain/business-card/business-card-workflow";
import {
  BusinessCardCostLimitError,
  BusinessCardProcessingError,
  createAndExtractBusinessCard,
  prepareBusinessCardReview,
  searchBusinessCardCandidates,
} from "./business-card-service";
import {
  CaptureNotFoundError,
  CaptureStateConflictError,
} from "../db/capture-repository";

function input() {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  return {
    workspaceId: "verification-workspace",
    idempotencyKey: "request-key",
    referenceTime: "2026-10-08T00:00:00Z",
    originalFile: new File([png], "original.png", { type: "image/png" }),
    displayFile: new File([png], "display.png", { type: "image/png" }),
    originalWidth: 1,
    originalHeight: 1,
    displayWidth: 1,
    displayHeight: 1,
    processingRecipe: "canvas-card-v1" as const,
  };
}
function winner(
  options: { pending?: boolean; failed?: boolean } = {},
): BusinessCardSessionView {
  const draft = options.pending
    ? null
    : extractionToBusinessCardDraft(
        {
          schemaVersion: "business-card-extraction-v1",
          identity: {
            displayName: "검증 인물",
            organizationName: null,
            title: null,
            department: null,
            emails: [],
            phones: [],
            websites: [],
            address: null,
          },
          observedFields: [],
        },
        "2026-10-08T00:00:00Z",
      );
  return {
    captureId: "winning-capture",
    state: options.failed ? "failed" : "draft",
    stage: options.failed
      ? "failed"
      : options.pending
        ? "extracting"
        : "card_review",
    originalAssetId: "winning-original",
    displayAssetId: "winning-display",
    imageUrl: "/api/source-assets/winning-display",
    draft,
    modelDraft: draft,
    contextNote: "",
    identityCandidates: [],
    userCorrectionCount: 0,
    ocrProvider: options.pending ? null : "mock",
    ocrLatencyMs: null,
    lastErrorCode: options.failed ? "CLOVA_NETWORK_ERROR" : null,
    commitResult: null,
    createdAt: "2026-10-08T00:00:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getByKey.mockResolvedValue(null);
  mocks.create.mockResolvedValue(false);
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

describe("business card upload race recovery", () => {
  it("feeds the higher-resolution original asset to OCR", async () => {
    const source = input();
    source.originalFile = new File(
      [Buffer.from("89504e470d0a1a0a01", "hex")],
      "original.png",
      { type: "image/png" },
    );
    mocks.create.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({
      schemaVersion: "business-card-extraction-v1",
      identity: {
        displayName: "검증 인물",
        organizationName: null,
        title: null,
        department: null,
        emails: [],
        phones: [],
        websites: [],
        address: null,
      },
      observedFields: ["identity.displayName"],
    });
    mocks.getCapture.mockResolvedValue(winner());

    await createAndExtractBusinessCard(source);

    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]?.[0].input).toMatchObject({
      filename: "original.png",
      bytes: new Uint8Array(await source.originalFile.arrayBuffer()),
    });
  });
  it("reuses a completed upload without uploading files or calling OCR again", async () => {
    const existing = winner();
    mocks.getByKey.mockResolvedValue(existing);
    expect(await createAndExtractBusinessCard(input())).toEqual(existing);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("removes only the losing request's files before returning another worker's result", async () => {
    const existing = winner();
    mocks.getByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    expect(await createAndExtractBusinessCard(input())).toEqual(existing);
    const paths = mocks.upload.mock.calls.map(([asset]) => asset.path);
    expect(paths).toHaveLength(2);
    expect(
      paths.every(
        (path) =>
          path.startsWith("verification-workspace/") &&
          !path.includes("winning-capture"),
      ),
    ).toBe(true);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(paths);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getByKey.mock.invocationCallOrder[1],
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("returns a bounded retry when the winner is still extracting, without a second OCR request", async () => {
    mocks.getByKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner({ pending: true }));
    await expect(createAndExtractBusinessCard(input())).rejects.toMatchObject({
      name: BusinessCardCostLimitError.name,
      code: "OCR_DUPLICATE_IN_PROGRESS",
      captureId: "winning-capture",
      retryAfterSeconds: 2,
    });
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not hide a failed winner behind an available draft", async () => {
    mocks.getByKey.mockResolvedValue(winner({ failed: true }));
    await expect(createAndExtractBusinessCard(input())).rejects.toBeInstanceOf(
      BusinessCardProcessingError,
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects a key bound to a different capture kind after removing the losing upload", async () => {
    await expect(createAndExtractBusinessCard(input())).rejects.toBeInstanceOf(
      CaptureStateConflictError,
    );
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("preserves an unrelated database error and removes uploaded files", async () => {
    const error = new Error("Database unavailable");
    mocks.create.mockRejectedValue(error);
    await expect(createAndExtractBusinessCard(input())).rejects.toBe(error);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.getByKey).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("cleans the first file when the display upload fails", async () => {
    const error = new Error("Storage unavailable");
    mocks.upload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
    await expect(createAndExtractBusinessCard(input())).rejects.toBe(error);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([
      mocks.upload.mock.calls[0][0].path,
    ]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("cleans a successful display upload when the original upload fails", async () => {
    const error = new Error("Original storage unavailable");
    mocks.upload.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    await expect(createAndExtractBusinessCard(input())).rejects.toBe(error);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([
      mocks.upload.mock.calls[1][0].path,
    ]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not report a successful race recovery when cleanup fails", async () => {
    const error = new Error("Removal unavailable");
    mocks.remove.mockRejectedValue(error);
    await expect(createAndExtractBusinessCard(input())).rejects.toBe(error);
    expect(mocks.getByKey).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("business card review state errors", () => {
  it("reports a missing capture without a provider call", async () => {
    mocks.getCapture.mockResolvedValue(null);
    await expect(
      prepareBusinessCardReview({
        workspaceId: "workspace",
        captureId: "missing",
        cardDraft: winner().draft,
        contextNote: "검증용 만남 맥락",
      }),
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["review", "committed"] as const)(
    "rejects preparation from %s without processing or changing the saved state",
    async (state) => {
      mocks.getCapture.mockResolvedValue({ ...winner(), state });
      await expect(
        prepareBusinessCardReview({
          workspaceId: "workspace",
          captureId: "capture",
          cardDraft: winner().draft,
          contextNote: "검증용 만남 맥락",
        }),
      ).rejects.toBeInstanceOf(CaptureStateConflictError);
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.markFailed).not.toHaveBeenCalled();
    },
  );
  it("reports missing candidates as not found", async () => {
    mocks.getCapture.mockResolvedValue(null);
    await expect(
      searchBusinessCardCandidates("workspace", "missing", winner().draft),
    ).rejects.toBeInstanceOf(CaptureNotFoundError);
  });
  it("rejects candidate search before context review", async () => {
    mocks.getCapture.mockResolvedValue(winner());
    await expect(
      searchBusinessCardCandidates("workspace", "capture", winner().draft),
    ).rejects.toBeInstanceOf(CaptureStateConflictError);
  });
  it("preserves another worker's completed review when the state changes during structuring", async () => {
    const draft = winner().draft!;
    mocks.getCapture.mockResolvedValue(winner());
    mocks.execute.mockResolvedValue(businessCardDraftToCaptureDraft(draft));
    mocks.saveReview.mockRejectedValue(
      new CaptureStateConflictError("Another review completed."),
    );
    await expect(
      prepareBusinessCardReview({
        workspaceId: "workspace",
        captureId: "capture",
        cardDraft: draft,
        contextNote: "검증용 만남 맥락",
      }),
    ).rejects.toBeInstanceOf(CaptureStateConflictError);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});
