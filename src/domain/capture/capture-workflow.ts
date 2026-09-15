import { z } from "zod";

import { captureDraftV1Schema, type CaptureDraftV1 } from "./capture-draft";

export const createTextCaptureRequestSchema = z
  .object({
    rawText: z.string().trim().min(10).max(5_000),
    idempotencyKey: z.uuid(),
    referenceTime: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const captureIdentityChoiceSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("existing"),
      personId: z.uuid(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("new"),
      displayName: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

export const commitTextCaptureRequestSchema = z
  .object({
    draft: captureDraftV1Schema,
    identity: captureIdentityChoiceSchema,
  })
  .strict();

export type CaptureIdentityChoice = z.infer<typeof captureIdentityChoiceSchema>;

export interface CaptureStructuringInput {
  rawText: string;
  referenceTime: string;
}

export interface IdentityCandidate {
  personId: string;
  displayName: string;
  headline: string | null;
  organizationName: string | null;
  organizationTitle: string | null;
  signals: string[];
}

export const captureCommitResultSchema = z
  .object({
    kind: z.literal("text_capture_v1"),
    personId: z.uuid(),
    interactionId: z.uuid(),
    organizationId: z.uuid().nullable(),
    eventId: z.uuid().nullable(),
    topicIds: z.array(z.uuid()),
    memoryIds: z.array(z.uuid()),
    actionIds: z.array(z.uuid()),
    committedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CaptureCommitResult = z.infer<typeof captureCommitResultSchema>;

export interface CaptureSessionView {
  captureId: string;
  state: "draft" | "review" | "failed" | "committed";
  rawText: string;
  modelDraft: CaptureDraftV1 | null;
  draft: CaptureDraftV1 | null;
  identityCandidates: IdentityCandidate[];
  userCorrectionCount: number;
  lastErrorCode: string | null;
  commitResult: CaptureCommitResult | null;
  createdAt: string;
}

export interface CaptureCommitResponse {
  capture: CaptureSessionView;
  memoryDocumentStatus: "updated" | "failed";
  recallQuery: string;
}
