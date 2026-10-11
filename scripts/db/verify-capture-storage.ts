import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { POST as createText } from "../../src/app/api/captures/route";
import { POST as commitText } from "../../src/app/api/captures/[captureId]/commit/route";
import { POST as textCandidates } from "../../src/app/api/captures/[captureId]/candidates/route";
import { POST as createCard } from "../../src/app/api/business-cards/route";
import { POST as reviewCard } from "../../src/app/api/business-cards/[captureId]/prepare-review/route";
import { POST as commitCard } from "../../src/app/api/business-cards/[captureId]/commit/route";
import { POST as cardCandidates } from "../../src/app/api/business-cards/[captureId]/candidates/route";
import { POST as retryCard } from "../../src/app/api/business-cards/[captureId]/retry/route";
import type { CaptureDraftV1 } from "../../src/domain/capture/capture-draft";
import type {
  CaptureSessionView,
  CaptureCommitResponse,
} from "../../src/domain/capture/capture-workflow";
import type {
  BusinessCardSessionView,
  BusinessCardCommitResponse,
} from "../../src/domain/business-card/business-card-workflow";
import type { BusinessCardDraftV1 } from "../../src/domain/business-card/business-card-draft";
import {
  deleteBusinessCardOriginal,
  discardBusinessCardCapture,
} from "../../src/server/application/business-card-service";
import {
  createCaptureSession,
  markCaptureFailed,
} from "../../src/server/db/capture-repository";
import { closeDatabase, getDatabase } from "../../src/server/db/client";
import { markBusinessCardFailed } from "../../src/server/db/business-card-repository";
import {
  downloadBusinessCardAsset,
  removeBusinessCardAssets,
} from "../../src/server/storage/business-card-storage";

// No seed/reset/migration, real people, or paid AI calls. All mutations belong
// to two uniquely named disposable workspaces; env overrides are process-only.
if (!process.argv.includes("--confirm-test-writes")) {
  console.error(
    "Pass --confirm-test-writes to create and remove isolated test fixtures.",
  );
  process.exit(2);
}
const existingWorkspaceId = process.env.APP_DEFAULT_WORKSPACE_ID;
assert(existingWorkspaceId, "APP_DEFAULT_WORKSPACE_ID is required.");
const testWorkspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const runId = randomUUID();
const testWorkspaceName = `Capture storage verification ${runId}`;
const foreignWorkspaceName = `Capture storage foreign verification ${runId}`;
process.env.APP_DEFAULT_WORKSPACE_ID = testWorkspaceId;
process.env.AI_ROUTING_MODE = "mock";
process.env.BUSINESS_CARD_OCR_MODE = "mock";
process.env.APP_REMOTE_PROTOTYPE_ACCESS = "off";
const originalFetch = globalThis.fetch;
const supabaseHostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  .hostname;
let blockedExternalRequests = 0;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== supabaseHostname) {
    blockedExternalRequests += 1;
    return Promise.reject(
      new Error("External provider calls are disabled in this verifier."),
    );
  }
  return originalFetch(input, init);
};
const sql = getDatabase();
const referenceTime = "2026-10-08T10:00:00+09:00";
const displayName = `검증 인물 ${runId.slice(0, 8)}`;
const organizationName = `검증 조직 ${runId.slice(0, 8)}`;
const checks: Array<{ name: string; passed: boolean }> = [];
const observations: Record<string, unknown> = {};
let currentCheck = "setup";
let failure: { check: string; kind: string } | null = null;
let cleanupVerified = false;
let existingDataUnchanged = false;
let existingSnapshot: Awaited<ReturnType<typeof snapshot>> | undefined;
let snapshotTables: string[] = [];
const workspaceNames = new Map([
  [testWorkspaceId, testWorkspaceName],
  [foreignWorkspaceId, foreignWorkspaceName],
]);

type JsonHandler = (
  request: Request,
  context: { params: Promise<{ captureId: string }> },
) => Promise<Response>;

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonCall<T>(
  handler: JsonHandler,
  captureId: string,
  body: unknown,
  expectedStatus = 200,
): Promise<T> {
  const response = await handler(jsonRequest(`/api/test/${captureId}`, body), {
    params: Promise.resolve({ captureId }),
  });
  assert.equal(response.status, expectedStatus);
  return (await response.json()) as T;
}

async function check(
  name: string,
  operation: () => Promise<void>,
): Promise<void> {
  currentCheck = name;
  await operation();
  checks.push({ name, passed: true });
  console.log(JSON.stringify({ check: name, passed: true }));
}

async function snapshot(workspaceId: string) {
  const rows: Record<string, { count: number; digest: string }> = {};
  for (const table of snapshotTables) {
    const [row] = await sql<Array<{ count: number; digest: string }>>`
      select count(*)::integer as count,
        md5(coalesce(string_agg(to_jsonb(entry)::text, '' order by to_jsonb(entry)::text), '')) as digest
      from ${sql(`public.${table}`)} entry where workspace_id = ${workspaceId}
    `;
    rows[table] = row;
  }
  return rows;
}

async function canonicalCounts() {
  const [row] = await sql`
    select
      (select count(*)::integer from public.persons where workspace_id = ${testWorkspaceId}) as people,
      (select count(*)::integer from public.interactions where workspace_id = ${testWorkspaceId}) as interactions,
      (select count(*)::integer from public.memory_statements where workspace_id = ${testWorkspaceId}) as memories,
      (select count(*)::integer from public.action_items where workspace_id = ${testWorkspaceId}) as actions,
      (select count(*)::integer from public.business_cards where workspace_id = ${testWorkspaceId}) as cards,
      (select count(*)::integer from public.memory_documents where workspace_id = ${testWorkspaceId}) as documents,
      (select count(*)::integer from public.provenance_records where workspace_id = ${testWorkspaceId}) as provenance
  `;
  return row;
}

async function createTextSession(key = randomUUID(), rawText?: string) {
  const input = {
    rawText:
      rawText ??
      `이름: ${displayName}, 회사: ${organizationName}. 검증 행사에서 물류 실증을 논의하고 후속 자료 전달을 약속했다.`,
    idempotencyKey: key,
    referenceTime,
  };
  const response = await createText(jsonRequest("/api/captures", input));
  assert.equal(response.status, 201);
  return { session: (await response.json()) as CaptureSessionView, input };
}

function textDraft(session: Pick<CaptureSessionView, "draft">): CaptureDraftV1 {
  assert(session.draft);
  return {
    ...session.draft,
    identityHint: { displayName, organizationName, title: "사용자 수정 직책" },
    interaction: {
      interactionType: "meeting",
      occurredAt: referenceTime,
      eventName: `검증 행사 ${runId}`,
      location: "검증 장소",
      summary: "사용자가 수정한 물류 파일럿 논의 내용",
    },
    topics: ["검증 물류 파일럿"],
    memories: [
      {
        statementType: "context",
        body: "사용자 확인 파일럿 맥락",
        occurredAt: referenceTime,
      },
    ],
    actions: [
      {
        kind: "commitment",
        title: "약속한 검증 자료 전달",
        details: null,
        dueAt: null,
      },
      {
        kind: "suggestion",
        title: "검토할 후속 연락 제안",
        details: null,
        dueAt: null,
      },
    ],
    inferredFields: [],
  };
}

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z+XcAAAAASUVORK5CYII=",
  "base64",
);
function cardRequest(
  key: string,
  image = new File([pngBytes], "synthetic-card.png", { type: "image/png" }),
) {
  const form = new FormData();
  form.set("idempotencyKey", key);
  form.set("referenceTime", referenceTime);
  for (const field of [
    "originalWidth",
    "originalHeight",
    "displayWidth",
    "displayHeight",
  ])
    form.set(field, "1");
  form.set("processingRecipe", "canvas-card-v1");
  form.set("original", image);
  form.set("display", image);
  return new Request("http://localhost/api/business-cards", {
    method: "POST",
    body: form,
  });
}

async function createCardSession(key = randomUUID()) {
  const response = await createCard(cardRequest(key));
  assert.equal(response.status, 201);
  return (await response.json()) as BusinessCardSessionView;
}

async function preparedCard(
  card: BusinessCardSessionView,
): Promise<BusinessCardSessionView> {
  assert(card.draft);
  return jsonCall<BusinessCardSessionView>(reviewCard, card.captureId, {
    draft: {
      ...card.draft,
      identity: {
        ...card.draft.identity,
        displayName,
        organizationName,
        emails: ["verification@example.invalid"],
        phones: ["010-0000-0000"],
        websites: ["https://example.invalid"],
      },
    },
    contextNote:
      "검증 행사에서 물류 파일럿을 논의하고 후속 자료를 전달하기로 했다.",
    referenceTime,
  });
}

function reviewedCardDraft(card: BusinessCardSessionView): BusinessCardDraftV1 {
  assert(card.draft);
  const context = textDraft({
    draft: {
      schemaVersion: "capture-draft-v1",
      identityHint: { displayName, organizationName, title: null },
      interaction: card.draft.interaction,
      topics: card.draft.topics,
      memories: card.draft.memories,
      actions: card.draft.actions,
      inferredFields: card.draft.inferredFields,
    },
  });
  return {
    ...card.draft,
    interaction: context.interaction,
    topics: context.topics,
    memories: context.memories,
    actions: context.actions,
    inferredFields: [],
  };
}

async function main() {
  assert.notEqual(testWorkspaceId, existingWorkspaceId);
  const tables = await sql<Array<{ table_name: string }>>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'workspace_id' order by table_name
  `;
  snapshotTables = tables.map((row) => row.table_name);
  existingSnapshot = await snapshot(existingWorkspaceId!);
  await sql`
    insert into public.workspaces (id, name)
    values (${testWorkspaceId}, ${testWorkspaceName}), (${foreignWorkspaceId}, ${foreignWorkspaceName})
  `;
  const [foreignPerson] = await sql<Array<{ id: string }>>`
    insert into public.persons (workspace_id, display_name, normalized_name)
    values (${foreignWorkspaceId}, '외부 검증 인물', '외부 검증 인물') returning id
  `;
  let text!: CaptureSessionView;
  let draft!: CaptureDraftV1;
  let firstCommit!: CaptureCommitResponse;
  await check("text_draft_isolated_and_create_idempotent", async () => {
    const created = await createTextSession();
    text = created.session;
    draft = textDraft(text);
    assert.equal(text.state, "review");
    assert.deepEqual(await canonicalCounts(), {
      people: 0,
      interactions: 0,
      memories: 0,
      actions: 0,
      cards: 0,
      documents: 0,
      provenance: 0,
    });
    const repeat = await createText(
      jsonRequest("/api/captures", created.input),
    );
    assert.equal(repeat.status, 201);
    assert.equal(
      ((await repeat.json()) as CaptureSessionView).captureId,
      text.captureId,
    );
    const conflicting = await createText(
      jsonRequest("/api/captures", {
        ...created.input,
        rawText: "다른 원문으로 같은 요청 키를 재사용하는 검증",
      }),
    );
    assert.equal(conflicting.status, 409);
  });
  await check("text_identity_failure_rolls_back", async () => {
    const before = await snapshot(testWorkspaceId);
    await jsonCall(
      commitText,
      text.captureId,
      { draft, identity: { mode: "existing", personId: foreignPerson.id } },
      409,
    );
    assert.deepEqual(await snapshot(testWorkspaceId), before);
    await jsonCall(
      commitText,
      randomUUID(),
      { draft, identity: { mode: "new", displayName } },
      404,
    );
  });
  await check(
    "text_atomic_commit_corrections_provenance_and_actions",
    async () => {
      firstCommit = await jsonCall<CaptureCommitResponse>(
        commitText,
        text.captureId,
        { draft, identity: { mode: "new", displayName } },
      );
      const result = firstCommit.capture.commitResult;
      assert(result);
      assert.equal(firstCommit.memoryDocumentStatus, "updated");
      assert.equal(firstCommit.capture.userCorrectionCount, 1);
      assert.deepEqual(firstCommit.capture.draft, draft);
      const counts = await canonicalCounts();
      assert.equal(counts.people, 1);
      assert.equal(counts.interactions, 1);
      assert.equal(counts.memories, 1);
      assert.equal(counts.actions, 2);
      assert.equal(counts.documents, 1);
      const [links] = await sql`
      select
        exists(select 1 from public.interaction_participants where workspace_id = ${testWorkspaceId} and interaction_id = ${result.interactionId} and person_id = ${result.personId}) as participant,
        exists(select 1 from public.memory_documents where workspace_id = ${testWorkspaceId} and person_id = ${result.personId} and content like '%사용자 확인 파일럿 맥락%' and embedding_status = 'pending') as document,
        (select count(*)::integer from public.provenance_records where workspace_id = ${testWorkspaceId} and source_ref = ${`capture_session:${text.captureId}`} and verification_status = 'confirmed') as provenance
    `;
      assert.equal(links.participant, true);
      assert.equal(links.document, true);
      assert(links.provenance >= 5);
      const actions = await sql<
        Array<{ kind: string }>
      >`select kind from public.action_items where workspace_id = ${testWorkspaceId} order by kind`;
      assert.deepEqual(
        actions.map((action) => action.kind),
        ["commitment", "suggestion"],
      );
    },
  );
  await check(
    "text_sequential_and_concurrent_commit_no_duplicates",
    async () => {
      const before = await canonicalCounts();
      const commits = await Promise.all(
        Array.from({ length: 3 }, () =>
          jsonCall<CaptureCommitResponse>(commitText, text.captureId, {
            draft,
            identity: { mode: "new", displayName },
          }),
        ),
      );
      for (const committed of commits)
        assert.deepEqual(
          committed.capture.commitResult,
          firstCommit.capture.commitResult,
        );
      assert.deepEqual(await canonicalCounts(), before);
      const fresh = (await createTextSession()).session;
      const commitsFresh = await Promise.all(
        Array.from({ length: 2 }, () =>
          jsonCall<CaptureCommitResponse>(commitText, fresh.captureId, {
            draft: textDraft(fresh),
            identity: {
              mode: "existing",
              personId: firstCommit.capture.commitResult!.personId,
            },
          }),
        ),
      );
      assert.deepEqual(
        commitsFresh[0].capture.commitResult,
        commitsFresh[1].capture.commitResult,
      );
      assert.equal((await canonicalCounts()).people, 1);
      assert.equal((await canonicalCounts()).interactions, 2);
    },
  );
  await check("text_explicit_new_same_name_does_not_merge", async () => {
    const fresh = (await createTextSession()).session;
    const candidates = await jsonCall<{
      identityCandidates: CaptureSessionView["identityCandidates"];
    }>(textCandidates, fresh.captureId, { draft: textDraft(fresh) });
    assert(
      candidates.identityCandidates.some(
        (candidate) =>
          candidate.personId === firstCommit.capture.commitResult!.personId,
      ),
    );
    const result = await jsonCall<CaptureCommitResponse>(
      commitText,
      fresh.captureId,
      { draft: textDraft(fresh), identity: { mode: "new", displayName } },
    );
    assert.notEqual(
      result.capture.commitResult!.personId,
      firstCommit.capture.commitResult!.personId,
    );
    assert.equal((await canonicalCounts()).people, 2);
  });
  await check("text_state_error_failure_isolation_and_retry", async () => {
    const input = {
      workspaceId: testWorkspaceId,
      idempotencyKey: randomUUID(),
      rawText: "검증용 미구조화 원문을 저장하고 실패 후 다시 시도한다.",
    };
    const created = await createCaptureSession(input);
    const before = await canonicalCounts();
    await jsonCall(
      commitText,
      created.capture.id,
      { draft, identity: { mode: "new", displayName } },
      409,
    );
    await markCaptureFailed(
      testWorkspaceId,
      created.capture.id,
      "VERIFICATION_PROVIDER_FAILURE",
    );
    assert.deepEqual(await canonicalCounts(), before);
    const retry = await createTextSession(input.idempotencyKey, input.rawText);
    assert.equal(retry.session.captureId, created.capture.id);
    assert.equal(retry.session.state, "review");
    assert.equal(retry.session.rawText, input.rawText);
    assert.deepEqual(await canonicalCounts(), before);
  });
  await check(
    "card_invalid_image_has_no_database_or_storage_side_effects",
    async () => {
      const before = await snapshot(testWorkspaceId);
      const invalid = new File(["not a PNG image"], "invalid.png", {
        type: "image/png",
      });
      assert.equal(
        (await createCard(cardRequest(randomUUID(), invalid))).status,
        400,
      );
      const [objects] =
        await sql`select count(*)::integer as count from storage.objects where bucket_id = 'business-card-assets' and name like ${`${testWorkspaceId}/%`}`;
      assert.equal(objects.count, 0);
      assert.deepEqual(await snapshot(testWorkspaceId), before);
    },
  );
  let card!: BusinessCardSessionView;
  let cardDraft!: BusinessCardDraftV1;
  let cardCommit!: BusinessCardCommitResponse;
  await check(
    "card_upload_private_storage_draft_isolation_and_idempotency",
    async () => {
      const before = await canonicalCounts();
      const key = randomUUID();
      card = await createCardSession(key);
      assert.equal(card.stage, "card_review");
      assert.equal(card.ocrProvider, "mock");
      assert.deepEqual(await canonicalCounts(), before);
      const repeated = await createCardSession(key);
      assert.equal(repeated.captureId, card.captureId);
      const [assets] =
        await sql`select count(*)::integer as count from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${card.captureId}`;
      assert.equal(assets.count, 2);
      await jsonCall(
        commitCard,
        card.captureId,
        { draft: card.draft, identity: { mode: "new", displayName } },
        409,
      );
      const reviewed = await preparedCard(card);
      assert.equal(reviewed.stage, "memory_review");
      cardDraft = reviewedCardDraft(reviewed);
      assert(
        reviewed.identityCandidates.some(
          (candidate) =>
            candidate.personId === firstCommit.capture.commitResult!.personId,
        ),
      );
      assert.deepEqual(await canonicalCounts(), before);
    },
  );
  await check("card_identity_failure_rolls_back", async () => {
    const before = await snapshot(testWorkspaceId);
    await jsonCall(
      commitCard,
      card.captureId,
      {
        draft: cardDraft,
        identity: { mode: "existing", personId: foreignPerson.id },
      },
      409,
    );
    assert.deepEqual(await snapshot(testWorkspaceId), before);
  });
  await check("card_commit_existing_person_attributes_and_memory", async () => {
    const before = await canonicalCounts();
    cardCommit = await jsonCall<BusinessCardCommitResponse>(
      commitCard,
      card.captureId,
      {
        draft: cardDraft,
        identity: {
          mode: "existing",
          personId: firstCommit.capture.commitResult!.personId,
        },
      },
    );
    const result = cardCommit.card.commitResult;
    assert(result);
    assert.equal(cardCommit.memoryDocumentStatus, "updated");
    assert.equal(result.personId, firstCommit.capture.commitResult!.personId);
    assert.deepEqual(cardCommit.card.draft, cardDraft);
    assert.equal(result.personAttributeIds.length, 3);
    const counts = await canonicalCounts();
    assert.equal(counts.people, before.people);
    assert.equal(counts.cards, before.cards + 1);
    assert.equal(counts.interactions, before.interactions + 1);
    const attributes = await sql<
      Array<{ kind: string; verification_status: string }>
    >`select kind, verification_status from public.person_attributes where workspace_id = ${testWorkspaceId} and person_id = ${result.personId} order by kind`;
    assert.deepEqual(
      attributes.map((attribute) => attribute.kind),
      ["email", "phone", "website"],
    );
    assert(
      attributes.every(
        (attribute) => attribute.verification_status === "confirmed",
      ),
    );
  });
  await check(
    "card_missing_or_committed_review_returns_404_409_without_mutation",
    async () => {
      const before = await snapshot(testWorkspaceId);
      const reviewBody = {
        draft: cardDraft,
        contextNote: "검증용 만남 맥락",
        referenceTime,
      };
      const cases = [
        {
          handler: reviewCard,
          id: randomUUID(),
          body: reviewBody,
          expected: 404,
        },
        {
          handler: cardCandidates,
          id: randomUUID(),
          body: { draft: cardDraft },
          expected: 404,
        },
        {
          handler: reviewCard,
          id: card.captureId,
          body: reviewBody,
          expected: 409,
        },
        {
          handler: cardCandidates,
          id: card.captureId,
          body: { draft: cardDraft },
          expected: 409,
        },
      ];
      const statuses: number[] = [];
      for (const entry of cases) {
        const response = await entry.handler(
          jsonRequest(`/api/test/${entry.id}`, entry.body),
          { params: Promise.resolve({ captureId: entry.id }) },
        );
        statuses.push(response.status);
      }
      observations.invalidReviewStatuses = statuses;
      console.log(JSON.stringify({ invalidReviewStatuses: statuses }));
      assert.deepEqual(
        statuses,
        cases.map((entry) => entry.expected),
      );
      assert.deepEqual(await snapshot(testWorkspaceId), before);
    },
  );
  await check("card_concurrent_commit_no_duplicates", async () => {
    const before = await canonicalCounts();
    const commits = await Promise.all(
      Array.from({ length: 3 }, () =>
        jsonCall<BusinessCardCommitResponse>(commitCard, card.captureId, {
          draft: cardDraft,
          identity: {
            mode: "existing",
            personId: firstCommit.capture.commitResult!.personId,
          },
        }),
      ),
    );
    for (const committed of commits)
      assert.deepEqual(
        committed.card.commitResult,
        cardCommit.card.commitResult,
      );
    assert.deepEqual(await canonicalCounts(), before);
    const fresh = await preparedCard(await createCardSession());
    const commitsFresh = await Promise.all(
      Array.from({ length: 2 }, () =>
        jsonCall<BusinessCardCommitResponse>(commitCard, fresh.captureId, {
          draft: reviewedCardDraft(fresh),
          identity: {
            mode: "existing",
            personId: firstCommit.capture.commitResult!.personId,
          },
        }),
      ),
    );
    assert.deepEqual(
      commitsFresh[0].card.commitResult,
      commitsFresh[1].card.commitResult,
    );
    const [attributes] =
      await sql`select count(*)::integer as count from public.person_attributes where workspace_id = ${testWorkspaceId} and person_id = ${firstCommit.capture.commitResult!.personId}`;
    assert.equal(attributes.count, 3);
    assert.equal((await canonicalCounts()).cards, before.cards + 1);
  });
  await check(
    "card_original_delete_preserves_display_and_confirmed_memory",
    async () => {
      const result = cardCommit.card.commitResult!;
      const assets = await sql<
        Array<{ id: string; storage_path: string }>
      >`select id, storage_path from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${card.captureId}`;
      const original = assets.find(
        (asset) => asset.id === result.originalAssetId,
      )!;
      const display = assets.find(
        (asset) => asset.id === result.displayAssetId,
      )!;
      assert.deepEqual(
        Buffer.from(
          await (
            await downloadBusinessCardAsset(original.storage_path)
          ).arrayBuffer(),
        ),
        pngBytes,
      );
      assert.deepEqual(
        Buffer.from(
          await (
            await downloadBusinessCardAsset(display.storage_path)
          ).arrayBuffer(),
        ),
        pngBytes,
      );
      assert.equal(
        await deleteBusinessCardOriginal(
          testWorkspaceId,
          result.businessCardId,
        ),
        "deleted",
      );
      assert.equal(
        await deleteBusinessCardOriginal(
          testWorkspaceId,
          result.businessCardId,
        ),
        "already_deleted",
      );
      const [stored] =
        await sql`select original_retained from public.business_cards where workspace_id = ${testWorkspaceId} and id = ${result.businessCardId}`;
      assert.equal(stored.original_retained, false);
      const [objects] =
        await sql`select count(*)::integer as count from storage.objects where bucket_id = 'business-card-assets' and name = ${original.storage_path}`;
      assert.equal(objects.count, 0);
      assert.deepEqual(
        Buffer.from(
          await (
            await downloadBusinessCardAsset(display.storage_path)
          ).arrayBuffer(),
        ),
        pngBytes,
      );
      assert.equal((await canonicalCounts()).cards, 2);
    },
  );
  await check(
    "card_discard_removes_unconfirmed_database_and_storage_assets",
    async () => {
      const before = await canonicalCounts();
      const fresh = await createCardSession();
      const paths = await sql<
        Array<{ storage_path: string }>
      >`select storage_path from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${fresh.captureId}`;
      await discardBusinessCardCapture(testWorkspaceId, fresh.captureId);
      const [residue] = await sql`
      select
        (select count(*)::integer from public.capture_sessions where workspace_id = ${testWorkspaceId} and id = ${fresh.captureId}) as captures,
        (select count(*)::integer from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${fresh.captureId}) as assets,
        (select count(*)::integer from storage.objects where bucket_id = 'business-card-assets' and name = any(${paths.map((path) => path.storage_path)}::text[])) as objects
    `;
      assert.deepEqual(residue, { captures: 0, assets: 0, objects: 0 });
      assert.deepEqual(await canonicalCounts(), before);
    },
  );
  await check(
    "card_concurrent_upload_returns_reusable_result_or_retry",
    async () => {
      const key = randomUUID();
      const responses = await Promise.all([
        createCard(cardRequest(key)),
        createCard(cardRequest(key)),
      ]);
      observations.concurrentUploadStatuses = responses.map(
        (response) => response.status,
      );
      console.log(
        JSON.stringify({
          concurrentUploadStatuses: observations.concurrentUploadStatuses,
        }),
      );
      assert(responses.some((response) => response.status === 201));
      assert(
        responses.every(
          (response) => response.status === 201 || response.status === 429,
        ),
      );
      const [captures] =
        await sql`select count(*)::integer as count from public.capture_sessions where workspace_id = ${testWorkspaceId} and idempotency_key = ${key}`;
      assert.equal(captures.count, 1);
      const result = await createCardSession(key);
      const [assets] =
        await sql`select count(*)::integer as count from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${result.captureId}`;
      assert.equal(assets.count, 2);
    },
  );
  await check(
    "card_injected_failure_is_recoverable_without_new_upload_or_memory",
    async () => {
      const before = await canonicalCounts();
      const key = randomUUID();
      const fresh = await createCardSession(key);
      const assetsBefore =
        await sql`select id, storage_path from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${fresh.captureId} order by id`;
      await markBusinessCardFailed(
        testWorkspaceId,
        fresh.captureId,
        "CLOVA_NETWORK_ERROR",
      );
      const failedResponse = await createCard(cardRequest(key));
      assert.equal(failedResponse.status, 502);
      const failedBody = await failedResponse.json();
      assert.equal(failedBody.recoverable, true);
      assert.equal(failedBody.captureId, fresh.captureId);
      const retry = await jsonCall<BusinessCardSessionView>(
        retryCard,
        fresh.captureId,
        { requestKey: randomUUID() },
      );
      assert.equal(retry.captureId, fresh.captureId);
      assert.equal(retry.stage, "card_review");
      assert.equal(retry.lastErrorCode, null);
      assert.deepEqual(
        await sql`select id, storage_path from public.source_assets where workspace_id = ${testWorkspaceId} and capture_session_id = ${fresh.captureId} order by id`,
        assetsBefore,
      );
      assert.deepEqual(await canonicalCounts(), before);
      await discardBusinessCardCapture(testWorkspaceId, fresh.captureId);
    },
  );
  await check("paid_calls_disabled", async () => {
    const [runs] =
      await sql`select count(*)::integer as count from public.ai_runs where workspace_id = ${testWorkspaceId} and status <> 'mocked'`;
    assert.equal(runs.count, 0);
    assert.equal(blockedExternalRequests, 0);
  });
}

async function cleanup() {
  const ids = [...workspaceNames.keys()];
  const objects = await sql<Array<{ name: string }>>`
    select name from storage.objects where bucket_id = 'business-card-assets'
      and (name like ${`${testWorkspaceId}/%`} or name like ${`${foreignWorkspaceId}/%`})
  `;
  assert(
    objects.every((object) =>
      ids.some((id) => object.name.startsWith(`${id}/`)),
    ),
  );
  await removeBusinessCardAssets(objects.map((object) => object.name));
  await sql.begin(async (transaction) => {
    for (const [id, name] of workspaceNames) {
      assert.notEqual(id, existingWorkspaceId);
      await transaction`delete from public.workspaces where id = ${id} and name = ${name}`;
    }
  });
  for (const table of snapshotTables) {
    const [row] =
      await sql`select count(*)::integer as count from ${sql(`public.${table}`)} where workspace_id = any(${ids}::uuid[])`;
    assert.equal(row.count, 0);
  }
  const [residue] = await sql`
    select
      (select count(*)::integer from public.workspaces where id = any(${ids}::uuid[])) as workspaces,
      (select count(*)::integer from storage.objects where bucket_id = 'business-card-assets' and (name like ${`${testWorkspaceId}/%`} or name like ${`${foreignWorkspaceId}/%`})) as objects
  `;
  assert.deepEqual(residue, { workspaces: 0, objects: 0 });
  cleanupVerified = true;
  if (existingSnapshot) {
    assert.deepEqual(await snapshot(existingWorkspaceId!), existingSnapshot);
    existingDataUnchanged = true;
  }
}

try {
  await main();
} catch (error) {
  // No provider response, DB URI, credentials, or record content in output.
  failure = {
    check: currentCheck,
    kind:
      error instanceof assert.AssertionError
        ? "ASSERTION_FAILED"
        : "EXECUTION_FAILED",
  };
  checks.push({ name: currentCheck, passed: false });
} finally {
  try {
    await cleanup();
  } catch {
    failure ??= { check: "cleanup", kind: "CLEANUP_FAILED" };
  } finally {
    globalThis.fetch = originalFetch;
    await closeDatabase();
  }
  const report = {
    checkedAt: new Date().toISOString(),
    verified: failure === null && cleanupVerified && existingDataUnchanged,
    execution: "actual-route-handlers-and-remote-db-storage",
    isolatedWorkspaces: true,
    aiMode: "mock",
    ocrMode: "mock",
    paidCalls: 0,
    checks,
    observations,
    failure,
    cleanupVerified,
    databaseFixtureRows: cleanupVerified ? 0 : null,
    storageFixtureObjects: cleanupVerified ? 0 : null,
    existingDataUnchanged,
    existingTableCount: snapshotTables.length,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    `test-results/capture-storage-${runId}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.verified) process.exitCode = 1;
}
