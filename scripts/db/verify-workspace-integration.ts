import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import {
  loadWorkspace,
  mutateWorkspace,
} from "../../src/server/db/workspace-repository";
import { loadRecallCorpus } from "../../src/server/db/recall-repository";
import { GET, POST } from "../../src/app/api/workspace/route";
import {
  createAndStructureTextCapture,
  commitReviewedTextCapture,
} from "../../src/server/application/capture-service";
import type {
  WorkspaceOperation,
  WorkspaceState,
} from "../../src/domain/workspace/contracts";

if (!process.argv.includes("--confirm-test-writes"))
  throw new Error("Explicit isolated test writes are required.");
const originalWorkspace = process.env.APP_DEFAULT_WORKSPACE_ID!;
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const marker = `integration-verification-${workspaceId}`;
process.env.APP_DEFAULT_WORKSPACE_ID = workspaceId;
process.env.AI_ROUTING_MODE = "mock";
process.env.BUSINESS_CARD_OCR_MODE = "mock";
let externalCalls = 0;
globalThis.fetch = async () => {
  externalCalls++;
  throw new Error("External requests are forbidden in this verifier.");
};
const sql = getDatabase();
const checks: string[] = [];
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  verified: false,
  checks,
};
const baselinePath = "tmp/backups/workspace-integration-baseline-20261008.json";
async function assertBaseline() {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
    tables: {
      table: string;
      columns: string[];
      count: number;
      digest: string;
    }[];
  };
  for (const table of baseline.tables) {
    const [row] =
      await sql`select count(*)::int as count,md5(coalesce(string_agg(data::text,'' order by data::text),'')) as digest from
      (select (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(t)) where key=any(${table.columns}::text[])) as data
      from ${sql(`public.${table.table}`)} t where workspace_id=${originalWorkspace}) original_rows`;
    assert.equal(row.count, table.count, `${table.table}: original row count`);
    assert.equal(
      row.digest,
      table.digest,
      `${table.table}: original data digest`,
    );
  }
  report.originalTablesUnchanged = baseline.tables.length;
}
const personValue = {
  name: "Integration Synthetic",
  company: "Synthetic Studio",
  job: "Research",
  email: null,
  phone: null,
  status: "pending" as const,
  importance: 3,
  relationshipCategories: ["work" as const],
};
const taskValue = {
  text: "Synthetic independent task",
  personId: null,
  date: null,
  time: null,
  done: false,
  type: "general" as const,
  importance: 3,
};
const meetingValue = {
  name: "Synthetic meeting",
  date: null,
  placeType: "unclassified" as const,
  personIds: [] as string[],
  guests: ["Unconfirmed guest"],
  description: "Original confirmed context",
  eventUrl: null,
  imageUrl: null,
  imageSourceUrl: null,
};
const apply = (operations: WorkspaceOperation[], requestId = randomUUID()) =>
  mutateWorkspace(workspaceId, { requestId, operations });
const http = (body: unknown) =>
  POST(
    new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
let state: WorkspaceState;
try {
  assert(originalWorkspace && originalWorkspace !== workspaceId);
  await assertBaseline();
  await sql`insert into public.workspaces(id,name) values(${workspaceId},${marker}),(${otherWorkspaceId},${marker + "-other"})`;
  const taskId = randomUUID(),
    personId = randomUUID(),
    duplicateNameId = randomUUID(),
    meetingId = randomUUID(),
    guestMeetingId = randomUUID(),
    noteId = randomUUID(),
    actionId = randomUUID(),
    foreignPersonId = randomUUID();
  const requestId = randomUUID();
  const createTask: WorkspaceOperation = {
    type: "task.save",
    id: taskId,
    version: null,
    source: "task",
    value: taskValue,
  };
  state = await apply([createTask], requestId);
  assert.equal(state.people.length, 0);
  assert.equal(state.todos[0].personId, null);
  assert.equal(state.todos[0].date, null);
  state = await apply([createTask], requestId);
  assert.equal(state.todos.length, 1);
  await assert.rejects(
    apply(
      [{ ...createTask, value: { ...taskValue, text: "Changed request" } }],
      requestId,
    ),
    /내용이 다릅니다/,
  );
  checks.push("independent task + exact retry idempotency");
  state = await apply([
    { type: "person.save", id: personId, version: null, value: personValue },
    {
      type: "person.save",
      id: duplicateNameId,
      version: null,
      value: personValue,
    },
  ]);
  assert.equal(state.people.length, 2);
  assert.notEqual(state.people[0].id, state.people[1].id);
  checks.push("same-name people remain separate identities");
  state = await apply([
    {
      type: "meeting.save",
      id: guestMeetingId,
      version: null,
      value: meetingValue,
    },
    {
      type: "meeting.save",
      id: meetingId,
      version: null,
      value: {
        ...meetingValue,
        personIds: [personId, duplicateNameId],
        date: "2026-10-08",
      },
    },
  ]);
  assert.equal(state.people.length, 2);
  assert.equal(state.edges.filter((e) => e.meetingId === meetingId).length, 2);
  assert.equal(state.meetings.find((m) => m.id === guestMeetingId)?.date, null);
  assert.equal(
    state.meetings.find((m) => m.id === meetingId)?.occurredAt,
    "2026-10-07T15:00:00.000Z",
  );
  checks.push(
    "multiple attendees, guest-only meeting, unknown date and KST conversion",
  );
  state = await apply([
    {
      type: "note.add",
      id: noteId,
      personId,
      text: "Synthetic confirmed note",
    },
  ]);
  assert.equal(
    state.people.find((p) => p.id === personId)?.history[0].id,
    noteId,
  );
  assert(
    (await loadRecallCorpus(workspaceId))
      .find((p) => p.id === personId)
      ?.evidence.some((e) => e.id === noteId),
  );
  checks.push("manual notes reach confirmed Recall evidence");
  const version = state.todos.find((t) => t.id === taskId)!.version;
  const concurrent = await Promise.allSettled([
    apply([
      {
        type: "task.save",
        id: taskId,
        version,
        source: "task",
        value: { ...taskValue, done: true },
      },
    ]),
    apply([
      {
        type: "task.save",
        id: taskId,
        version,
        source: "task",
        value: { ...taskValue, text: "Concurrent replacement" },
      },
    ]),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((r) => r.status === "rejected").length, 1);
  checks.push("concurrent edits reject stale versions");
  await sql`insert into public.persons(id,workspace_id,display_name,normalized_name) values(${foreignPersonId},${otherWorkspaceId},'Foreign synthetic','foreign synthetic')`;
  await assert.rejects(
    apply([
      {
        type: "task.save",
        id: randomUUID(),
        version: null,
        source: "task",
        value: { ...taskValue, personId: foreignPersonId },
      },
    ]),
  );
  const rollbackId = randomUUID();
  await assert.rejects(
    apply([
      {
        type: "task.save",
        id: rollbackId,
        version: null,
        source: "task",
        value: taskValue,
      },
      {
        type: "note.add",
        id: randomUUID(),
        personId: foreignPersonId,
        text: "Must not persist",
      },
    ]),
  );
  assert(
    !(await loadWorkspace(workspaceId)).todos.some((t) => t.id === rollbackId),
  );
  checks.push(
    "foreign workspace references rejected and batch failure is atomic",
  );
  assert.equal(
    (
      await http({
        requestId: randomUUID(),
        workspaceId: otherWorkspaceId,
        operations: [createTask],
      })
    ).status,
    400,
  );
  assert.equal(
    (await http({ requestId: "task_legacy", operations: [createTask] })).status,
    400,
  );
  checks.push(
    "HTTP request rejects client workspace and legacy IDs before mutation",
  );
  await sql`insert into public.action_items(id,workspace_id,person_id,interaction_id,kind,title,source_kind,verification_status) values(${actionId},${workspaceId},${personId},${meetingId},'commitment','Synthetic promised action','manual','confirmed')`;
  state = await apply([
    {
      type: "task.save",
      id: actionId,
      version: 1,
      source: "action",
      value: {
        ...taskValue,
        personId,
        text: "Synthetic promised action",
        date: "2026-10-10",
        time: "18:00",
        done: true,
      },
    },
  ]);
  assert.equal(state.todos.find((t) => t.id === actionId)?.kind, "commitment");
  const [savedAction] =
    await sql`select due_at,kind,status,completed_at from public.action_items where id=${actionId}`;
  assert.equal(savedAction.due_at.toISOString(), "2026-10-10T09:00:00.000Z");
  assert.equal(savedAction.status, "completed");
  assert(savedAction.completed_at);
  checks.push(
    "relationship commitments retain kind, completion and KST deadline",
  );
  state = await apply([
    {
      type: "archive",
      entity: "person",
      id: personId,
      version: state.people.find((p) => p.id === personId)!.version,
      archived: true,
    },
  ]);
  assert(!(await loadRecallCorpus(workspaceId)).some((p) => p.id === personId));
  const [removedDoc] =
    await sql`select count(*)::int as count from public.memory_documents where workspace_id=${workspaceId} and person_id=${personId}`;
  assert.equal(removedDoc.count, 0);
  state = await apply([
    {
      type: "archive",
      entity: "person",
      id: personId,
      version: state.people.find((p) => p.id === personId)!.version,
      archived: false,
    },
  ]);
  assert((await loadRecallCorpus(workspaceId)).some((p) => p.id === personId));
  checks.push(
    "archive excludes person from search; restore preserves original identity",
  );
  const derivedId = randomUUID();
  await sql`insert into public.memory_statements(id,workspace_id,person_id,interaction_id,statement_type,body,source_kind,verification_status) values(${derivedId},${workspaceId},${personId},${meetingId},'context','Old inferred summary','ai_inference','confirmed')`;
  state = await apply([
    {
      type: "meeting.save",
      id: meetingId,
      version: state.meetings.find((m) => m.id === meetingId)!.version,
      value: {
        ...meetingValue,
        personIds: [personId, duplicateNameId],
        date: "2026-10-08",
        description: "User corrected context",
      },
    },
  ]);
  assert(
    !(await loadRecallCorpus(workspaceId))
      .find((p) => p.id === personId)
      ?.evidence.some((e) => e.id === derivedId),
  );
  // Removing attendance must also remove that meeting's linked facts and promises
  // from the person's Recall, task list and embedding projection, without deleting them.
  state = await apply([
    {
      type: "meeting.save",
      id: meetingId,
      version: state.meetings.find((m) => m.id === meetingId)!.version,
      value: {
        ...meetingValue,
        personIds: [duplicateNameId],
        date: "2026-10-08",
        description: "User corrected context",
      },
    },
  ]);
  assert(!state.todos.some((t) => t.id === actionId));
  assert(
    !(await loadRecallCorpus(workspaceId))
      .find((p) => p.id === personId)
      ?.evidence.some((e) => e.id === actionId || e.id === meetingId),
  );
  const [detachedProjection] =
    await sql`select content from public.memory_documents where workspace_id=${workspaceId} and person_id=${personId}`;
  assert(!detachedProjection.content.includes("Synthetic promised action"));
  state = await apply([
    {
      type: "meeting.save",
      id: meetingId,
      version: state.meetings.find((m) => m.id === meetingId)!.version,
      value: {
        ...meetingValue,
        personIds: [personId, duplicateNameId],
        date: "2026-10-08",
        description: "User corrected context",
      },
    },
  ]);
  assert(state.todos.some((t) => t.id === actionId));
  checks.push(
    "attendance removal/restoration consistently scopes Recall, actions and embeddings",
  );
  state = await apply([
    {
      type: "archive",
      entity: "meeting",
      id: meetingId,
      version: state.meetings.find((m) => m.id === meetingId)!.version,
      archived: true,
    },
  ]);
  const corpus = await loadRecallCorpus(workspaceId);
  assert(
    !corpus
      .find((p) => p.id === personId)
      ?.evidence.some((e) => e.id === meetingId || e.id === actionId),
  );
  checks.push("corrected/archived meeting cannot expose old model evidence");
  state = await apply([
    {
      type: "persona.save",
      version: 0,
      value: {
        name: "Synthetic",
        role: "Developer",
        company: "Test",
        email: "",
        tone: "formal",
        goal: "",
        signature: "",
        department: "",
        phone: "",
        bio: "Synthetic profile",
      },
    },
    {
      type: "mail.save",
      id: randomUUID(),
      version: null,
      value: {
        personId,
        purpose: "hello",
        subject: "Draft only",
        body: "No email is sent",
        reference: "",
      },
    },
  ]);
  assert.equal(state.personaVersion, 1);
  assert.equal(state.mailDrafts.length, 1);
  const get = await GET(new Request("http://localhost/api/workspace"));
  assert.equal(get.status, 200);
  const reloaded = await get.json();
  assert.deepEqual(reloaded.state, state);
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  checks.push(
    "persona/mail draft persisted; independent HTTP reload matches server state",
  );
  const revisionBeforeCapture = state.people.find(
    (p) => p.id === personId,
  )!.version;
  const capture = await createAndStructureTextCapture({
    workspaceId,
    idempotencyKey: randomUUID(),
    rawText: "합성 검증 기록: 검증하늘과 새 물류 포장재를 논의했다.",
    referenceTime: "2026-10-08T00:00:00Z",
  });
  assert(capture.draft);
  const reviewed = {
    workspaceId,
    captureId: capture.captureId,
    draft: {
      ...capture.draft,
      identityHint: {
        ...capture.draft.identityHint,
        organizationName: "Reviewed new affiliation",
      },
    },
    identity: { mode: "existing" as const, personId },
  };
  await commitReviewedTextCapture(reviewed);
  state = await loadWorkspace(workspaceId);
  const committedVersion = state.people.find((p) => p.id === personId)!.version;
  assert(committedVersion > revisionBeforeCapture);
  await assert.rejects(
    apply([
      {
        type: "person.save",
        id: personId,
        version: revisionBeforeCapture,
        value: { ...personValue, name: "Stale profile edit" },
      },
    ]),
    /다른 기기/,
  );
  await commitReviewedTextCapture(reviewed);
  assert.equal(
    (await loadWorkspace(workspaceId)).people.find((p) => p.id === personId)!
      .version,
    committedVersion,
  );
  checks.push(
    "reviewed Capture invalidates stale profile edits; repeated commit does not bump revision",
  );
  await assertBaseline();
  assert.equal(externalCalls, 0);
  report.verified = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : "Verification failed";
  process.exitCode = 1;
} finally {
  try {
    const removed =
      await sql`delete from public.workspaces where id=any(${[workspaceId, otherWorkspaceId]}::uuid[]) and name in (${marker},${marker + "-other"}) returning id`;
    assert(removed.length <= 2);
    const tables =
      await sql`select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id'`;
    let residual = 0;
    for (const table of tables) {
      const [row] =
        await sql`select count(*)::int as count from ${sql(`public.${table.table_name}`)} where workspace_id=any(${[workspaceId, otherWorkspaceId]}::uuid[])`;
      residual += row.count;
    }
    report.fixtureRowsRemaining = residual;
    assert.equal(residual, 0);
    await assertBaseline();
  } catch (error) {
    report.cleanupError =
      error instanceof Error ? error.message : "Cleanup failed";
    report.verified = false;
    process.exitCode = 1;
  }
  report.externalCalls = externalCalls;
  await mkdir("test-results", { recursive: true });
  const path = `test-results/workspace-integration-${workspaceId}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath: path }, null, 2));
  await closeDatabase();
}
