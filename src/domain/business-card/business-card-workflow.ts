import { z } from "zod";

import type {
  CaptureIdentityChoice,
  IdentityCandidate,
} from "../capture/capture-workflow";
import { captureIdentityChoiceSchema } from "../capture/capture-workflow";
import {
  businessCardDraftV1Schema,
  type BusinessCardDraftV1,
} from "./business-card-draft";

export const businessCardUploadMetadataSchema = z
  .object({
    idempotencyKey: z.uuid(),
    referenceTime: z.iso.datetime({ offset: true }),
    originalWidth: z.coerce.number().int().positive().max(20_000),
    originalHeight: z.coerce.number().int().positive().max(20_000),
    displayWidth: z.coerce.number().int().positive().max(4_000),
    displayHeight: z.coerce.number().int().positive().max(4_000),
    processingRecipe: z.enum([
      "canvas-card-v1",
      "docaligner-lc100-card-v1",
      "manual-card-v1",
    ]),
  })
  .strict();

export const businessCardOcrRetryRequestSchema = z
  .object({ requestKey: z.uuid() })
  .strict();

export const prepareBusinessCardReviewRequestSchema = z
  .object({
    draft: businessCardDraftV1Schema,
    contextNote: z.string().trim().min(5).max(5_000),
    referenceTime: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const commitBusinessCardRequestSchema = z
  .object({
    draft: businessCardDraftV1Schema,
    identity: captureIdentityChoiceSchema,
  })
  .strict();

export type BusinessCardStage =
  | "extracting"
  | "card_review"
  | "card_result"
  | "memory_review"
  | "committed"
  | "failed";

export const businessCardCommitResultSchema = z
  .object({
    kind: z.literal("business_card_capture_v1"),
    personId: z.uuid(),
    interactionId: z.uuid(),
    organizationId: z.uuid().nullable(),
    eventId: z.uuid().nullable(),
    topicIds: z.array(z.uuid()),
    memoryIds: z.array(z.uuid()),
    actionIds: z.array(z.uuid()),
    personAttributeIds: z.array(z.uuid()),
    businessCardId: z.uuid(),
    originalAssetId: z.uuid(),
    displayAssetId: z.uuid(),
    committedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BusinessCardCommitResult = z.infer<
  typeof businessCardCommitResultSchema
>;

export interface BusinessCardSessionView {
  captureId: string;
  state: "draft" | "review" | "failed" | "committed";
  stage: BusinessCardStage;
  originalAssetId: string;
  displayAssetId: string;
  imageUrl: string;
  draft: BusinessCardDraftV1 | null;
  modelDraft: BusinessCardDraftV1 | null;
  fieldsConfirmedAt?: string | null;
  contextNote: string;
  identityCandidates: IdentityCandidate[];
  userCorrectionCount: number;
  ocrProvider: string | null;
  ocrLatencyMs: number | null;
  lastErrorCode: string | null;
  commitResult: BusinessCardCommitResult | null;
  createdAt: string;
}

export interface BusinessCardCommitResponse {
  card: BusinessCardSessionView;
  memoryDocumentStatus: "updated" | "failed";
  recallQuery: string;
}

export type { CaptureIdentityChoice };
