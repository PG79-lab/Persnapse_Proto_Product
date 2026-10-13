import { z } from "zod";

import {
  contactNumberSchema,
  normalizeContactNumbers,
  voicePhoneValues,
} from "../../../card_recognition/contact-numbers";

import {
  captureDraftSchemaVersion,
  captureDraftV1Schema,
  type CaptureDraftV1,
} from "../capture/capture-draft";

export const businessCardExtractionSchemaVersion =
  "business-card-extraction-v1" as const;
export const businessCardDraftSchemaVersion = "business-card-draft-v1" as const;

const nullableText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).nullable();

const uniqueTextArray = (maxLength: number, maxItems: number) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .transform((items) => [...new Set(items)]);

export const businessCardIdentitySchema = z
  .object({
    displayName: nullableText(120),
    organizationName: nullableText(180),
    title: nullableText(180),
    department: nullableText(180),
    emails: uniqueTextArray(320, 3),
    phones: uniqueTextArray(80, 8),
    contactNumbers: z.array(contactNumberSchema).max(8).optional(),
    websites: uniqueTextArray(500, 3),
    address: nullableText(500),
  })
  .strict()
  .transform((identity) => {
    if (identity.contactNumbers === undefined) return identity;
    const contactNumbers = normalizeContactNumbers(identity.contactNumbers);
    return {
      ...identity,
      contactNumbers,
      phones: voicePhoneValues(contactNumbers),
    };
  });

export const businessCardExtractionV1Schema = z
  .object({
    schemaVersion: z.literal(businessCardExtractionSchemaVersion),
    identity: businessCardIdentitySchema,
    observedFields: z.array(z.string().trim().min(1).max(160)).max(32),
  })
  .strict();

export function parseBusinessCardIdentity(value: unknown) {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = businessCardIdentitySchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export type BusinessCardExtractionV1 = z.infer<
  typeof businessCardExtractionV1Schema
>;

export const businessCardDraftV1Schema = z
  .object({
    schemaVersion: z.literal(businessCardDraftSchemaVersion),
    identity: businessCardIdentitySchema,
    interaction: captureDraftV1Schema.shape.interaction,
    topics: captureDraftV1Schema.shape.topics,
    memories: captureDraftV1Schema.shape.memories,
    actions: captureDraftV1Schema.shape.actions,
    observedFields: z.array(z.string().trim().min(1).max(160)).max(32),
    inferredFields: captureDraftV1Schema.shape.inferredFields,
  })
  .strict();

export type BusinessCardDraftV1 = z.infer<typeof businessCardDraftV1Schema>;

export function extractionToBusinessCardDraft(
  extraction: BusinessCardExtractionV1,
  _referenceTime: string,
): BusinessCardDraftV1 {
  // Kept for call-site compatibility; capture time is not encounter time.
  void _referenceTime;
  const name = extraction.identity.displayName ?? "새로운 사람";

  return {
    schemaVersion: businessCardDraftSchemaVersion,
    identity: extraction.identity,
    interaction: {
      interactionType: "meeting",
      occurredAt: null,
      summary: `${name}님과 명함을 교환했다.`,
      location: null,
      eventName: null,
    },
    topics: [],
    memories: [],
    actions: [],
    observedFields: extraction.observedFields,
    inferredFields: [],
  };
}

export function businessCardDraftToExtraction(
  draft: BusinessCardDraftV1,
): BusinessCardExtractionV1 {
  return businessCardExtractionV1Schema.parse({
    schemaVersion: businessCardExtractionSchemaVersion,
    identity: draft.identity,
    observedFields: draft.observedFields,
  });
}

export function mergeBusinessCardContext(
  card: BusinessCardDraftV1,
  context: CaptureDraftV1,
): BusinessCardDraftV1 {
  return businessCardDraftV1Schema.parse({
    ...card,
    interaction: context.interaction,
    topics: context.topics,
    memories: context.memories,
    actions: context.actions,
    inferredFields: context.inferredFields.filter(
      (field) => !field.startsWith("identityHint."),
    ),
  });
}

export function businessCardDraftToCaptureDraft(
  draft: BusinessCardDraftV1,
): CaptureDraftV1 {
  return captureDraftV1Schema.parse({
    schemaVersion: captureDraftSchemaVersion,
    identityHint: {
      displayName: draft.identity.displayName,
      organizationName: draft.identity.organizationName,
      title: draft.identity.title,
    },
    interaction: draft.interaction,
    topics: draft.topics,
    memories: draft.memories,
    actions: draft.actions,
    inferredFields: draft.inferredFields,
  });
}
