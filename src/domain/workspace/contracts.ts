import { z } from "zod";

import type { BusinessCardExtractionV1 } from "../business-card/business-card-draft";

export const uuidSchema = z.uuid();
export const dateSchema = z.iso
  .date()
  .refine((v) => v >= "1900-01-01" && v <= "2199-12-31");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable();
const version = z.number().int().positive().nullable();
const categories = z
  .array(z.enum(["project", "work", "networking", "customer"]))
  .max(4);
const taskType = z.enum([
  "general",
  "mail",
  "call",
  "coffee",
  "meeting",
  "material",
]);
const importance = z.number().int().min(1).max(5);
const webUrl = optionalText(2048).refine((v) => {
  if (!v) return true;
  try {
    const url = new URL(v);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
}, "https 주소를 확인해 주세요.");

export const personInputSchema = z
  .object({
    name: text(150).min(1),
    company: optionalText(200),
    job: optionalText(200),
    email: z.union([z.email().max(320), z.literal(""), z.null()]),
    phone: optionalText(80),
    status: z.enum(["pending", "success", "failed", "unclassified"]),
    importance,
    relationshipCategories: categories,
  })
  .strict();
export const meetingInputSchema = z
  .object({
    name: text(150).min(1),
    date: dateSchema.nullable(),
    placeType: z.enum(["expo", "industrial", "client_site", "unclassified"]),
    personIds: z.array(uuidSchema).max(100),
    guests: z.array(text(100).min(1)).max(50),
    description: text(6000),
    eventUrl: webUrl,
    imageUrl: webUrl,
    imageSourceUrl: webUrl,
  })
  .strict()
  .refine(
    (v) => v.personIds.length + v.guests.length > 0,
    "참석자 또는 게스트를 입력해 주세요.",
  );
export const taskInputSchema = z
  .object({
    text: text(1000).min(1),
    personId: uuidSchema.nullable(),
    date: dateSchema.nullable(),
    time: timeSchema.nullable(),
    done: z.boolean(),
    type: taskType,
    importance,
  })
  .strict()
  .refine((v) => !v.time || !!v.date, "시각을 입력하려면 날짜가 필요합니다.");
export const personaSchema = z
  .object({
    name: text(100),
    role: text(200),
    company: text(200),
    email: text(320),
    tone: text(100),
    goal: text(2000),
    signature: text(2000),
    department: text(200),
    phone: text(80),
    bio: text(2000),
  })
  .strict();
export const mailInputSchema = z
  .object({
    personId: uuidSchema,
    purpose: text(100),
    subject: text(300).min(1),
    body: text(12000).min(1),
    reference: text(4000),
  })
  .strict();
export const operationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("person.save"),
      id: uuidSchema,
      version,
      value: personInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("meeting.save"),
      id: uuidSchema,
      version,
      value: meetingInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("task.save"),
      id: uuidSchema,
      version,
      source: z.enum(["task", "action"]),
      value: taskInputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("note.add"),
      id: uuidSchema,
      personId: uuidSchema,
      text: text(6000).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("archive"),
      entity: z.enum(["person", "meeting", "task", "action", "note"]),
      id: uuidSchema,
      version: z.number().int().positive(),
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("persona.save"),
      version: z.number().int().nonnegative(),
      value: personaSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("mail.save"),
      id: uuidSchema,
      version,
      value: mailInputSchema,
    })
    .strict(),
]);
export const mutationSchema = z
  .object({
    requestId: uuidSchema,
    operations: z.array(operationSchema).min(1).max(30),
  })
  .strict();
export type WorkspaceMutation = z.infer<typeof mutationSchema>;
export type WorkspaceOperation = z.infer<typeof operationSchema>;
export type PersonInput = z.infer<typeof personInputSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type Persona = z.infer<typeof personaSchema>;
export interface Versioned {
  id: string;
  version: number;
  deletedAt: string | null;
}
export interface WorkspaceNote extends Versioned {
  text: string;
  date: string | null;
}
export interface WorkspacePerson extends PersonInput, Versioned {
  createdAt: string;
  history: WorkspaceNote[];
  businessCards?: {
    id: string;
    displayAssetId: string;
    originalRetained: boolean;
    identity?: BusinessCardExtractionV1["identity"];
  }[];
}
export interface WorkspaceMeeting
  extends Omit<MeetingInput, "personIds">, Versioned {
  occurredAt: string | null;
}
export interface WorkspaceTask extends TaskInput, Versioned {
  source: "task" | "action";
  kind: "commitment" | "follow_up" | "suggestion" | null;
  personName: string | null;
  createdAt: string;
}
export interface WorkspaceState {
  people: WorkspacePerson[];
  meetings: WorkspaceMeeting[];
  todos: WorkspaceTask[];
  edges: { id: string; meetingId: string; personId: string; deletedAt: null }[];
  personLinks: { id: string; aId: string; bId: string; direction: "a-to-b" }[];
  persona?: Persona;
  personaVersion: number;
  mailDrafts: (z.infer<typeof mailInputSchema> &
    Versioned & { updatedAt: string })[];
  messages: never[];
  appliedRequestIds: string[];
  conflicts: never[];
}
export interface WorkspaceSnapshot {
  state: WorkspaceState;
  loadedAt: string;
  capabilities: {
    aiMode: "mock" | "live";
    ocrMode: "mock" | "live";
    storage: "server";
  };
}
