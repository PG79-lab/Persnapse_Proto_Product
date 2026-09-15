import { z } from "zod";

export const captureDraftSchemaVersion = "capture-draft-v1" as const;

const nullableText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength).nullable();

const optionalInstant = z.iso.datetime({ offset: true }).nullable();

export const captureDraftV1Schema = z
  .object({
    schemaVersion: z.literal(captureDraftSchemaVersion),
    identityHint: z
      .object({
        displayName: nullableText(120),
        organizationName: nullableText(180),
        title: nullableText(180),
      })
      .strict(),
    interaction: z
      .object({
        interactionType: z.enum([
          "meeting",
          "call",
          "email",
          "message",
          "event",
          "note",
        ]),
        occurredAt: optionalInstant,
        summary: z.string().trim().min(1).max(2_000),
        location: nullableText(240),
        eventName: nullableText(240),
      })
      .strict(),
    topics: z.array(z.string().trim().min(1).max(100)).max(12),
    memories: z
      .array(
        z
          .object({
            statementType: z.enum([
              "fact",
              "preference",
              "interest",
              "need",
              "relationship",
              "context",
            ]),
            body: z.string().trim().min(1).max(1_000),
            occurredAt: optionalInstant,
          })
          .strict(),
      )
      .max(12),
    actions: z
      .array(
        z
          .object({
            kind: z.enum(["commitment", "follow_up", "suggestion"]),
            title: z.string().trim().min(1).max(240),
            details: nullableText(1_000),
            dueAt: optionalInstant,
          })
          .strict(),
      )
      .max(8),
    inferredFields: z.array(z.string().trim().min(1).max(160)).max(32),
  })
  .strict();

export type CaptureDraftV1 = z.infer<typeof captureDraftV1Schema>;
