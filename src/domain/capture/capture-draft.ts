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

export const captureDraftV1JsonSchema = {
  type: "object",
  properties: {
    schemaVersion: {
      type: "string",
      enum: [captureDraftSchemaVersion],
    },
    identityHint: {
      type: "object",
      properties: {
        displayName: { type: ["string", "null"], maxLength: 120 },
        organizationName: { type: ["string", "null"], maxLength: 180 },
        title: { type: ["string", "null"], maxLength: 180 },
      },
      required: ["displayName", "organizationName", "title"],
      additionalProperties: false,
    },
    interaction: {
      type: "object",
      properties: {
        interactionType: {
          type: "string",
          enum: ["meeting", "call", "email", "message", "event", "note"],
        },
        occurredAt: {
          type: ["string", "null"],
          format: "date-time",
        },
        summary: { type: "string", minLength: 1, maxLength: 2_000 },
        location: { type: ["string", "null"], maxLength: 240 },
        eventName: { type: ["string", "null"], maxLength: 240 },
      },
      required: [
        "interactionType",
        "occurredAt",
        "summary",
        "location",
        "eventName",
      ],
      additionalProperties: false,
    },
    topics: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 100 },
      maxItems: 12,
    },
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          statementType: {
            type: "string",
            enum: [
              "fact",
              "preference",
              "interest",
              "need",
              "relationship",
              "context",
            ],
          },
          body: { type: "string", minLength: 1, maxLength: 1_000 },
          occurredAt: {
            type: ["string", "null"],
            format: "date-time",
          },
        },
        required: ["statementType", "body", "occurredAt"],
        additionalProperties: false,
      },
      maxItems: 12,
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["commitment", "follow_up", "suggestion"],
          },
          title: { type: "string", minLength: 1, maxLength: 240 },
          details: { type: ["string", "null"], maxLength: 1_000 },
          dueAt: {
            type: ["string", "null"],
            format: "date-time",
          },
        },
        required: ["kind", "title", "details", "dueAt"],
        additionalProperties: false,
      },
      maxItems: 8,
    },
    inferredFields: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 160 },
      maxItems: 32,
    },
  },
  required: [
    "schemaVersion",
    "identityHint",
    "interaction",
    "topics",
    "memories",
    "actions",
    "inferredFields",
  ],
  additionalProperties: false,
} as const;
