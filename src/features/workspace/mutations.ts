import {
  mutationSchema,
  personaSchema,
  type WorkspaceState,
  type WorkspaceOperation,
  type WorkspaceMutation,
  type WorkspacePerson,
  type WorkspaceTask,
  type WorkspaceMeeting,
} from "../../domain/workspace/contracts";

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const nullable = (s: string | null | undefined) => s?.trim() || null;
function personValue(p: WorkspacePerson) {
  return {
    name: p.name,
    company: nullable(p.company),
    job: nullable(p.job),
    email: nullable(p.email),
    phone: nullable(p.phone),
    status: p.status || "unclassified",
    importance: Number(p.importance || 3),
    relationshipCategories: p.relationshipCategories ?? [],
  };
}
export function canonicalClock(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const match = value.match(/^(오전|오후) (\d{1,2}):(\d{2})$/);
  if (!match) throw new Error("시각 형식을 확인해 주세요.");
  return `${String((Number(match[2]) % 12) + (match[1] === "오후" ? 12 : 0)).padStart(2, "0")}:${match[3]}`;
}
function taskValue(t: WorkspaceTask) {
  return {
    text: t.text,
    personId: t.personId || null,
    date: t.date || null,
    time: canonicalClock(t.time),
    done: !!t.done,
    type: t.type || "general",
    importance: Number(t.importance || 3),
  };
}
function meetingValue(m: WorkspaceMeeting, state: WorkspaceState) {
  return {
    name: m.name,
    date: m.date || null,
    placeType: m.placeType || "unclassified",
    personIds: [
      ...new Set(
        state.edges
          .filter(
            (e) =>
              e.meetingId === m.id &&
              !e.deletedAt &&
              state.people.some((p) => p.id === e.personId && !p.deletedAt),
          )
          .map((e) => e.personId),
      ),
    ].sort(),
    guests: m.guests ?? [],
    description: m.description ?? "",
    eventUrl: nullable(m.eventUrl),
    imageUrl: nullable(m.imageUrl),
    imageSourceUrl: nullable(m.imageSourceUrl),
  };
}
export function compileWorkspaceMutation(
  before: WorkspaceState,
  next: WorkspaceState,
  expectedVersions: Record<string, number> = {},
): WorkspaceMutation | null {
  const operations: WorkspaceOperation[] = [];
  const version = (row: { id: string; version: number } | undefined) =>
    row ? (expectedVersions[row.id] ?? row.version) : null;
  for (const p of next.people) {
    const old = before.people.find((row) => row.id === p.id);
    if (old && !!old.deletedAt !== !!p.deletedAt)
      operations.push({
        type: "archive",
        entity: "person",
        id: p.id,
        version: version(old)!,
        archived: !!p.deletedAt,
      });
    else if (!old || !equal(personValue(old), personValue(p)))
      operations.push({
        type: "person.save",
        id: p.id,
        version: version(old),
        value: personValue(p),
      });
    for (const note of p.history ?? []) {
      const previous = old?.history.find((row) => row.id === note.id);
      if (!previous)
        operations.push({
          type: "note.add",
          id: note.id,
          personId: p.id,
          text: note.text,
        });
      else if (!!previous.deletedAt !== !!note.deletedAt)
        operations.push({
          type: "archive",
          entity: "note",
          id: note.id,
          version: previous.version,
          archived: !!note.deletedAt,
        });
    }
  }
  for (const m of next.meetings) {
    const old = before.meetings.find((row) => row.id === m.id);
    if (old && !!old.deletedAt !== !!m.deletedAt)
      operations.push({
        type: "archive",
        entity: "meeting",
        id: m.id,
        version: version(old)!,
        archived: !!m.deletedAt,
      });
    else if (!old || !equal(meetingValue(old, before), meetingValue(m, next)))
      operations.push({
        type: "meeting.save",
        id: m.id,
        version: version(old),
        value: meetingValue(m, next),
      });
  }
  for (const t of next.todos) {
    const old = before.todos.find((row) => row.id === t.id);
    if (old && !!old.deletedAt !== !!t.deletedAt)
      operations.push({
        type: "archive",
        entity: old.source,
        id: t.id,
        version: version(old)!,
        archived: !!t.deletedAt,
      });
    else if (!old || !equal(taskValue(old), taskValue(t)))
      operations.push({
        type: "task.save",
        id: t.id,
        version: version(old),
        source: old?.source ?? "task",
        value: taskValue(t),
      });
  }
  if (!equal(before.persona, next.persona)) {
    const defaults = Object.fromEntries(
      Object.keys(personaSchema.shape).map((key) => [key, ""]),
    );
    operations.push({
      type: "persona.save",
      version: expectedVersions.persona ?? before.personaVersion,
      value: personaSchema.parse({ ...defaults, ...next.persona }),
    });
  }
  for (const mail of next.mailDrafts ?? []) {
    const old = before.mailDrafts.find((row) => row.id === mail.id);
    const value = {
      personId: mail.personId,
      purpose: mail.purpose,
      subject: mail.subject,
      body: mail.body,
      reference: mail.reference || "",
    };
    if (
      !old ||
      ["personId", "purpose", "subject", "body", "reference"].some(
        (key) =>
          old[key as keyof typeof old] !== mail[key as keyof typeof mail],
      )
    )
      operations.push({
        type: "mail.save",
        id: mail.id,
        version: version(old),
        value,
      });
  }
  return operations.length
    ? mutationSchema.parse({ requestId: crypto.randomUUID(), operations })
    : null;
}
