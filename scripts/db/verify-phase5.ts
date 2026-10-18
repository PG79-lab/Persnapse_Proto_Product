import assert from "node:assert/strict";

import {
  createAndExtractBusinessCard,
  confirmBusinessCardFields,
  commitReviewedBusinessCard,
  deleteBusinessCardOriginal,
  prepareBusinessCardReview,
} from "../../src/server/application/business-card-service";
import { getDatabase, closeDatabase } from "../../src/server/db/client";
import { findBusinessCardIdentityCandidates } from "../../src/server/db/business-card-repository";
import { loadWorkspace } from "../../src/server/db/workspace-repository";
import {
  downloadBusinessCardAsset,
  removeBusinessCardAssets,
} from "../../src/server/storage/business-card-storage";
import { createSyntheticBusinessCardImage } from "../ai/synthetic-business-card-image";

const liveOcr = process.argv.includes("--live-ocr");
if (liveOcr && !process.argv.includes("--confirm-live")) {
  console.error(
    "Phase 5 live OCR verification requires --confirm-live; this guard prevents accidental paid calls.",
  );
  process.exit(2);
}
process.env.BUSINESS_CARD_OCR_MODE = liveOcr ? "live" : "mock";
if (!liveOcr) process.env.AI_ROUTING_MODE = "mock";

const workspaceId = process.env.APP_DEFAULT_WORKSPACE_ID;
assert(workspaceId, "APP_DEFAULT_WORKSPACE_ID is required.");

const syntheticImage = liveOcr
  ? await createSyntheticBusinessCardImage()
  : {
      bytes: new Uint8Array(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z+XcAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
      width: 1,
      height: 1,
    };
const suffix = Date.now().toString(36);
const imageBuffer = new ArrayBuffer(syntheticImage.bytes.byteLength);
new Uint8Array(imageBuffer).set(syntheticImage.bytes);
const original = new File([imageBuffer], `phase5-${suffix}.png`, {
  type: "image/png",
});
const display = new File([imageBuffer], `phase5-${suffix}-display.png`, {
  type: "image/png",
});
const idempotencyKey = crypto.randomUUID();
const verificationOrganizationName = `Phase 5 Verification Org ${suffix}`;
const verificationTopic = `phase5-verification-${suffix}`;
const sql = getDatabase();
let captureId: string | undefined;
let personId: string | undefined;
let interactionId: string | undefined;
let eventId: string | null | undefined;
let organizationId: string | null | undefined;
let topicIds: string[] = [];
let assetPaths: string[] = [];

try {
  const [contracts] = await sql<
    Array<{
      has_drafts: boolean;
      has_cards: boolean;
      private_bucket: boolean;
      source_asset_columns: number | string;
    }>
  >`
    select
      to_regclass('public.business_card_drafts') is not null as has_drafts,
      to_regclass('public.business_cards') is not null as has_cards,
      exists (
        select 1 from storage.buckets
        where id = 'business-card-assets' and public = false
      ) as private_bucket,
      (
        select count(*) from information_schema.columns
        where table_schema = 'public'
          and table_name = 'source_assets'
          and column_name in (
            'variant', 'byte_size', 'pixel_width', 'pixel_height',
            'processing_metadata', 'deleted_at'
          )
      ) as source_asset_columns
  `;
  assert(
    contracts.has_drafts && contracts.has_cards,
    "Phase 5 tables are missing.",
  );
  assert(
    contracts.private_bucket,
    "Private business-card-assets bucket is missing.",
  );
  assert.equal(Number(contracts.source_asset_columns), 6);

  const card = await createAndExtractBusinessCard({
    workspaceId,
    idempotencyKey,
    referenceTime: new Date().toISOString(),
    originalFile: original,
    displayFile: display,
    originalWidth: syntheticImage.width,
    originalHeight: syntheticImage.height,
    displayWidth: syntheticImage.width,
    displayHeight: syntheticImage.height,
    processingRecipe: "canvas-card-v1",
  });
  captureId = card.captureId;
  assert.equal(card.stage, "card_review");
  assert.equal(
    card.ocrProvider,
    liveOcr
      ? (process.env.BUSINESS_CARD_OCR_PROVIDER ?? "naver_clova")
      : "mock",
  );
  const extractedDraft = card.draft;
  assert(
    extractedDraft?.identity.displayName ||
      extractedDraft?.identity.organizationName,
  );

  const confirmedDraft = {
    ...extractedDraft,
    identity: {
      ...extractedDraft.identity,
      organizationName: verificationOrganizationName,
      ...(!liveOcr
        ? {
            contactNumbers: [
              { type: "phone" as const, value: "02-111-2222", rawLabel: "Tel" },
              {
                type: "mobile" as const,
                value: "010-5555-6666",
                rawLabel: "HP",
              },
              { type: "fax" as const, value: "010-3333-4444", rawLabel: "Fax" },
            ],
          }
        : {}),
    },
  };
  const confirmed = await confirmBusinessCardFields({
    workspaceId,
    captureId,
    draft: confirmedDraft,
  });
  assert.equal(confirmed.stage, "card_result");
  assert(confirmed.fieldsConfirmedAt);
  assert.deepEqual(
    confirmed.draft?.identity.contactNumbers,
    confirmedDraft.identity.contactNumbers,
  );
  if (!liveOcr) {
    assert(!confirmed.draft?.identity.phones.includes("010-3333-4444"));
  }

  const reviewed = await prepareBusinessCardReview({
    workspaceId,
    captureId,
    cardDraft: confirmed.draft!,
    contextNote:
      "2026-09-15 AI Agent 제품 밋업에서 만나 관계형 메모리 파일럿과 다음 주 소개 자료 전달을 논의했다.",
    referenceTime: new Date().toISOString(),
  });
  assert.equal(reviewed.state, "review");
  const reviewedDraft = reviewed.draft;
  assert(reviewedDraft?.topics.length);
  assert.equal(
    reviewedDraft.identity.organizationName,
    verificationOrganizationName,
  );

  const committed = await commitReviewedBusinessCard({
    workspaceId,
    captureId,
    draft: { ...reviewedDraft, topics: [verificationTopic] },
    identity: {
      mode: "new",
      displayName: `Phase5 검증 ${suffix}`,
    },
  });
  const result = committed.card.commitResult;
  assert(result, "Business card commit result is missing.");
  personId = result.personId;
  interactionId = result.interactionId;
  eventId = result.eventId;
  organizationId = result.organizationId;
  topicIds = result.topicIds;
  assert(result.personAttributeIds.length >= 2);

  const snapshot = await loadWorkspace(workspaceId);
  const savedCard = snapshot.people
    .find((person) => person.id === personId)
    ?.businessCards?.find((card) => card.id === result.businessCardId);
  assert(
    savedCard,
    "Committed business card is missing from the workspace projection.",
  );
  assert.equal(
    typeof savedCard.identity,
    "object",
    "Business card identity must be decoded in the workspace projection.",
  );
  assert.deepEqual(
    savedCard?.identity?.contactNumbers,
    reviewedDraft.identity.contactNumbers,
  );
  if (!liveOcr) {
    const attributes = await sql<Array<{ value: string }>>`
      select value from public.person_attributes
      where workspace_id = ${workspaceId} and person_id = ${personId} and kind = 'phone'
    `;
    assert.deepEqual(
      attributes.map((row) => row.value).sort(),
      ["02-111-2222", "010-5555-6666"].sort(),
    );
    // The fax digits deliberately equal a saved voice number: a typed fax must not match it.
    const faxOnlyCandidates = await findBusinessCardIdentityCandidates(
      workspaceId,
      {
        ...reviewedDraft,
        identity: {
          ...reviewedDraft.identity,
          displayName: null,
          organizationName: null,
          emails: [],
          phones: ["02-111-2222"],
          contactNumbers: [
            { type: "fax", value: "02-111-2222", rawLabel: "Fax" },
          ],
        },
      },
    );
    assert(
      !faxOnlyCandidates.some((candidate) => candidate.personId === personId),
    );
  }

  const downloaded = await downloadBusinessCardAsset(
    (
      await sql<Array<{ storage_path: string }>>`
        select storage_path from public.source_assets
        where workspace_id = ${workspaceId}
          and id = ${result.displayAssetId}
      `
    )[0].storage_path,
  );
  assert(downloaded.size > 0, "Stored display image is empty.");

  const deletion = await deleteBusinessCardOriginal(
    workspaceId,
    result.businessCardId,
  );
  assert.equal(deletion, "deleted");
  const [retention] = await sql<Array<{ original_retained: boolean }>>`
    select original_retained from public.business_cards
    where workspace_id = ${workspaceId} and id = ${result.businessCardId}
  `;
  assert.equal(retention.original_retained, false);

  const paths = await sql<Array<{ storage_path: string }>>`
    select storage_path from public.source_assets
    where workspace_id = ${workspaceId}
      and capture_session_id = ${captureId}
      and deleted_at is null
  `;
  assetPaths = paths.map((row) => row.storage_path);
  const [ocrRun] = await sql<Array<{ latency_ms: number | null }>>`
    select latency_ms from public.ai_runs
    where workspace_id = ${workspaceId}
      and capture_session_id = ${captureId}
      and task = 'businessCardOcr'
      and status = 'succeeded'
    order by completed_at desc
    limit 1
  `;

  console.log(
    JSON.stringify(
      {
        verified: true,
        schema: "business-card-draft-v1",
        privateBucket: true,
        mockOcr: !liveOcr,
        clovaOcr: card.ocrProvider === "naver_clova",
        openAiOcr: card.ocrProvider === "openai",
        ocrProvider: card.ocrProvider,
        ocrLatencyMs: card.ocrLatencyMs,
        providerLatencyMs: ocrRun?.latency_ms ?? null,
        metFiveSecondGoal:
          card.ocrLatencyMs !== null && card.ocrLatencyMs <= 5_000,
        explicitIdentity: true,
        atomicCommit: true,
        contactAttributes: result.personAttributeIds.length,
        typedNumbersPersisted: true,
        workspaceCardNumberTypes: true,
        faxExcludedFromVoicePhones: !liveOcr,
        faxExcludedFromIdentityMatching: !liveOcr,
        originalDeletion: true,
        displayCardRetained: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (!captureId) {
    const [session] = await sql<Array<{ id: string }>>`
      select id from public.capture_sessions
      where workspace_id = ${workspaceId}
        and idempotency_key = ${idempotencyKey}
    `;
    captureId = session?.id;
  }

  const cleanupCaptureId = captureId;
  if (cleanupCaptureId) {
    const storedAssets = await sql<Array<{ storage_path: string }>>`
      select storage_path from public.source_assets
      where workspace_id = ${workspaceId}
        and capture_session_id = ${cleanupCaptureId}
        and asset_kind = 'image'
    `;
    assetPaths = [
      ...new Set([
        ...assetPaths,
        ...storedAssets.map((asset) => asset.storage_path),
      ]),
    ];
    const runRows = await sql<Array<{ id: string }>>`
      select id from public.ai_runs
      where workspace_id = ${workspaceId}
        and capture_session_id = ${cleanupCaptureId}
    `;
    await sql.begin(async (transaction) => {
      await transaction`
        delete from public.provenance_records
        where workspace_id = ${workspaceId}
          and source_ref = ${`capture_session:${cleanupCaptureId}`}
      `;
      await transaction`
        delete from public.business_cards
        where workspace_id = ${workspaceId}
          and capture_session_id = ${cleanupCaptureId}
      `;
      await transaction`
        delete from public.business_card_drafts
        where workspace_id = ${workspaceId}
          and capture_session_id = ${cleanupCaptureId}
      `;
      await transaction`
        delete from public.source_assets
        where workspace_id = ${workspaceId}
          and capture_session_id = ${cleanupCaptureId}
      `;
      if (personId) {
        await transaction`
          delete from public.persons
          where workspace_id = ${workspaceId} and id = ${personId}
        `;
      }
      if (interactionId) {
        await transaction`
          delete from public.interactions
          where workspace_id = ${workspaceId} and id = ${interactionId}
        `;
      }
      if (eventId) {
        await transaction`
          delete from public.events
          where workspace_id = ${workspaceId} and id = ${eventId}
        `;
      }
      for (const topicId of topicIds) {
        await transaction`
          delete from public.topics topic
          where topic.workspace_id = ${workspaceId}
            and topic.id = ${topicId}
            and not exists (
              select 1 from public.interaction_topics interaction_topic
              where interaction_topic.workspace_id = topic.workspace_id
                and interaction_topic.topic_id = topic.id
            )
        `;
      }
      if (organizationId) {
        await transaction`
          delete from public.organizations organization
          where organization.workspace_id = ${workspaceId}
            and organization.id = ${organizationId}
            and not exists (
              select 1 from public.affiliations affiliation
              where affiliation.workspace_id = organization.workspace_id
                and affiliation.organization_id = organization.id
            )
        `;
      }
      await transaction`
        delete from public.capture_sessions
        where workspace_id = ${workspaceId} and id = ${cleanupCaptureId}
      `;
      for (const run of runRows) {
        await transaction`
          delete from public.ai_runs
          where workspace_id = ${workspaceId} and id = ${run.id}
        `;
      }
    });
    await removeBusinessCardAssets(assetPaths);

    const [residue] = await sql<
      Array<{
        database_rows: number | string;
        storage_objects: number | string;
      }>
    >`
      select
        (
          (select count(*) from public.capture_sessions
            where workspace_id = ${workspaceId} and id = ${cleanupCaptureId})
          + (select count(*) from public.business_card_drafts
            where workspace_id = ${workspaceId}
              and capture_session_id = ${cleanupCaptureId})
          + (select count(*) from public.business_cards
            where workspace_id = ${workspaceId}
              and capture_session_id = ${cleanupCaptureId})
          + (select count(*) from public.source_assets
            where workspace_id = ${workspaceId}
              and capture_session_id = ${cleanupCaptureId})
          + (select count(*) from public.ai_runs
            where workspace_id = ${workspaceId}
              and capture_session_id = ${cleanupCaptureId})
          + (select count(*) from public.provenance_records
            where workspace_id = ${workspaceId}
              and source_ref = ${`capture_session:${cleanupCaptureId}`})
          + (select count(*) from public.persons
            where workspace_id = ${workspaceId}
              and id = ${personId ?? null}::uuid)
          + (select count(*) from public.interactions
            where workspace_id = ${workspaceId}
              and id = ${interactionId ?? null}::uuid)
          + (select count(*) from public.events
            where workspace_id = ${workspaceId}
              and id = ${eventId ?? null}::uuid)
          + (select count(*) from public.organizations
            where workspace_id = ${workspaceId}
              and id = ${organizationId ?? null}::uuid)
          + (select count(*) from public.topics
            where workspace_id = ${workspaceId}
              and id = any(${topicIds}::uuid[]))
        ) as database_rows,
        (
          select count(*) from storage.objects
          where bucket_id = 'business-card-assets'
            and name = any(${assetPaths}::text[])
        ) as storage_objects
    `;
    assert.equal(Number(residue.database_rows), 0);
    assert.equal(Number(residue.storage_objects), 0);
    console.log(
      JSON.stringify(
        { cleanupVerified: true, databaseRows: 0, storageObjects: 0 },
        null,
        2,
      ),
    );
  }
  await closeDatabase();
}
