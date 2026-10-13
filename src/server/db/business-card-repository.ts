import "server-only";

import type { TransactionSql } from "postgres";

import {
  getContactNumbers,
  voicePhoneValues,
} from "../../../card_recognition/contact-numbers";

import {
  businessCardDraftToExtraction,
  businessCardDraftToCaptureDraft,
  businessCardDraftV1Schema,
  type BusinessCardExtractionV1,
  type BusinessCardDraftV1,
} from "../../domain/business-card/business-card-draft";
import {
  businessCardCommitResultSchema,
  type BusinessCardCommitResult,
  type BusinessCardSessionView,
} from "../../domain/business-card/business-card-workflow";
import type {
  CaptureIdentityChoice,
  IdentityCandidate,
} from "../../domain/capture/capture-workflow";
import {
  CaptureIdentityConflictError,
  CaptureNotFoundError,
  CaptureStateConflictError,
} from "./capture-repository";
import { getDatabase } from "./client";

interface BusinessCardRow {
  capture_id: string;
  state: "draft" | "review" | "failed" | "committed";
  original_asset_id: string;
  display_asset_id: string;
  model_draft: unknown;
  structured_draft: unknown;
  fields_confirmed_at: Date | string | null;
  context_note: string | null;
  ocr_provider: string | null;
  ocr_latency_ms: number | string | null;
  user_correction_count: number | string;
  last_error_code: string | null;
  commit_result: unknown;
  created_at: Date | string;
}

export interface BusinessCardAssetInput {
  id: string;
  path: string;
  mimeType: string;
  sha256: string;
  filename: string;
  byteSize: number;
  width: number;
  height: number;
  variant: "original" | "display";
  processingMetadata: Record<string, unknown>;
}

function parsedJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function optionalDraft(value: unknown): BusinessCardDraftV1 | null {
  const parsed = businessCardDraftV1Schema.safeParse(parsedJsonValue(value));
  return parsed.success ? parsed.data : null;
}

function optionalCommitResult(value: unknown): BusinessCardCommitResult | null {
  const parsed = businessCardCommitResultSchema.safeParse(
    parsedJsonValue(value),
  );
  return parsed.success ? parsed.data : null;
}

function mapBusinessCardRow(row: BusinessCardRow): BusinessCardSessionView {
  const commitResult = optionalCommitResult(row.commit_result);
  const draft = optionalDraft(row.structured_draft);
  const modelDraft = optionalDraft(row.model_draft);
  const stage =
    row.state === "committed"
      ? "committed"
      : row.state === "failed"
        ? "failed"
        : row.state === "review"
          ? "memory_review"
          : row.fields_confirmed_at
            ? "card_result"
            : draft || modelDraft
              ? "card_review"
              : "extracting";

  return {
    captureId: row.capture_id,
    state: row.state,
    stage,
    originalAssetId: row.original_asset_id,
    displayAssetId: row.display_asset_id,
    imageUrl: `/api/source-assets/${row.display_asset_id}`,
    draft: draft ?? modelDraft,
    modelDraft,
    fieldsConfirmedAt: row.fields_confirmed_at
      ? new Date(row.fields_confirmed_at).toISOString()
      : null,
    contextNote: row.context_note ?? "",
    identityCandidates: [],
    userCorrectionCount: Number(row.user_correction_count),
    ocrProvider: row.ocr_provider,
    ocrLatencyMs:
      row.ocr_latency_ms === null ? null : Number(row.ocr_latency_ms),
    lastErrorCode: row.last_error_code,
    commitResult,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function normalizeIdentityValue(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeContact(kind: "email" | "phone" | "website", value: string) {
  if (kind === "phone") {
    return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  }

  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

const businessCardSelect = `
  select
    session.id as capture_id,
    session.state,
    draft.original_asset_id,
    draft.display_asset_id,
    draft.model_draft,
    draft.structured_draft,
    draft.fields_confirmed_at,
    draft.context_note,
    draft.ocr_provider,
    draft.ocr_latency_ms,
    session.user_correction_count,
    session.last_error_code,
    session.commit_result,
    session.created_at
  from public.capture_sessions session
  join public.business_card_drafts draft
    on draft.workspace_id = session.workspace_id
   and draft.capture_session_id = session.id
`;

export async function getBusinessCardByIdempotencyKey(
  workspaceId: string,
  idempotencyKey: string,
): Promise<BusinessCardSessionView | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe<BusinessCardRow[]>(
    `${businessCardSelect} where session.workspace_id = $1 and session.idempotency_key = $2 limit 1`,
    [workspaceId, idempotencyKey],
  );
  return rows[0] ? mapBusinessCardRow(rows[0]) : null;
}

export async function getBusinessCardCapture(
  workspaceId: string,
  captureId: string,
): Promise<BusinessCardSessionView | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe<BusinessCardRow[]>(
    `${businessCardSelect} where session.workspace_id = $1 and session.id = $2 limit 1`,
    [workspaceId, captureId],
  );
  return rows[0] ? mapBusinessCardRow(rows[0]) : null;
}

export async function listUncommittedBusinessCards(
  workspaceId: string,
): Promise<BusinessCardSessionView[]> {
  const sql = getDatabase();
  const rows = await sql.unsafe<BusinessCardRow[]>(
    `${businessCardSelect} where session.workspace_id = $1 and session.state in ('draft', 'review', 'failed') and draft.fields_confirmed_at is not null order by session.created_at desc limit 20`,
    [workspaceId],
  );
  return rows.map(mapBusinessCardRow);
}

export async function findReusableBusinessCardExtraction(input: {
  workspaceId: string;
  captureId: string;
  imageSha256: string;
  provider?: "naver_clova" | "openai";
}): Promise<BusinessCardExtractionV1 | null> {
  const sql = getDatabase();
  const provider = input.provider ?? "naver_clova";
  const rows = await sql<Array<{ model_draft: unknown }>>`
    select draft.model_draft
    from public.business_card_drafts draft
    join public.source_assets asset
      on asset.workspace_id = draft.workspace_id
     and asset.id = draft.original_asset_id
    where draft.workspace_id = ${input.workspaceId}
      and draft.capture_session_id <> ${input.captureId}
      and asset.sha256 = ${input.imageSha256}
      and asset.deleted_at is null
      and draft.ocr_provider in (${provider}, ${`${provider}_cache`})
      and draft.model_draft <> '{}'::jsonb
    order by draft.updated_at desc
    limit 1
  `;
  const draft = rows[0] ? optionalDraft(rows[0].model_draft) : null;
  return draft?.identity.contactNumbers !== undefined
    ? businessCardDraftToExtraction(draft)
    : null;
}

export async function createBusinessCardCapture(input: {
  workspaceId: string;
  captureId: string;
  idempotencyKey: string;
  original: BusinessCardAssetInput;
  display: BusinessCardAssetInput;
}): Promise<boolean> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const inserted = await transaction<Array<{ id: string }>>`
      insert into public.capture_sessions (
        id, workspace_id, state, input_kind, structured_draft, model_draft,
        draft_schema_version, idempotency_key
      )
      values (
        ${input.captureId}, ${input.workspaceId}, 'draft', 'business_card',
        '{}'::jsonb, '{}'::jsonb, 'business-card-draft-v1',
        ${input.idempotencyKey}
      )
      on conflict (workspace_id, idempotency_key) do nothing
      returning id
    `;
    if (!inserted[0]) return false;

    for (const asset of [input.original, input.display]) {
      await transaction`
        insert into public.source_assets (
          id, workspace_id, capture_session_id, asset_kind, storage_path,
          mime_type, sha256, original_filename, variant, byte_size,
          pixel_width, pixel_height, processing_metadata
        )
        values (
          ${asset.id}, ${input.workspaceId}, ${input.captureId}, 'image',
          ${asset.path}, ${asset.mimeType}, ${asset.sha256}, ${asset.filename},
          ${asset.variant}, ${asset.byteSize}, ${asset.width}, ${asset.height},
          ${JSON.stringify(asset.processingMetadata)}::jsonb
        )
      `;
    }

    await transaction`
      insert into public.business_card_drafts (
        capture_session_id, workspace_id, original_asset_id, display_asset_id
      )
      values (
        ${input.captureId}, ${input.workspaceId}, ${input.original.id},
        ${input.display.id}
      )
    `;
    return true;
  });
}

export async function saveBusinessCardExtraction(input: {
  workspaceId: string;
  captureId: string;
  draft: BusinessCardDraftV1;
  provider: string;
  latencyMs: number;
  ocrReservationId?: string;
}): Promise<void> {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const saved = await transaction<Array<{ capture_session_id: string }>>`
      update public.business_card_drafts
      set
        model_draft = ${JSON.stringify(input.draft)}::jsonb,
        structured_draft = ${JSON.stringify(input.draft)}::jsonb,
        ocr_provider = ${input.provider},
        ocr_latency_ms = ${input.latencyMs}
      where workspace_id = ${input.workspaceId}
        and capture_session_id = ${input.captureId}
      returning capture_session_id
    `;
    if (!saved[0]) {
      throw new CaptureNotFoundError();
    }

    if (input.ocrReservationId) {
      const completed = await transaction<Array<{ id: string }>>`
        update public.ocr_provider_calls
        set status = 'succeeded', completed_at = clock_timestamp(), error_code = null
        where id = ${input.ocrReservationId}
          and workspace_id = ${input.workspaceId}
          and capture_session_id = ${input.captureId}
          and status = 'started'
        returning id
      `;
      if (!completed[0]) {
        throw new Error("OCR cost reservation could not be completed.");
      }
    }
  });
}

export async function saveConfirmedBusinessCardFields(input: {
  workspaceId: string;
  captureId: string;
  draft: BusinessCardDraftV1;
}): Promise<void> {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{
        state: string;
        model_draft: unknown;
        structured_draft: unknown;
        fields_confirmed_at: Date | string | null;
      }>
    >`
      select session.state, draft.model_draft, draft.structured_draft, draft.fields_confirmed_at
      from public.capture_sessions session
      join public.business_card_drafts draft
        on draft.workspace_id = session.workspace_id
       and draft.capture_session_id = session.id
      where session.workspace_id = ${input.workspaceId}
        and session.id = ${input.captureId}
      for update of session, draft
    `;
    if (!rows[0]) throw new CaptureNotFoundError();
    if (rows[0].state !== "draft" || !optionalDraft(rows[0].model_draft)) {
      throw new CaptureStateConflictError(
        "Business card extraction must finish before fields are confirmed.",
      );
    }
    if (rows[0].fields_confirmed_at) {
      if (
        JSON.stringify(optionalDraft(rows[0].structured_draft)) ===
        JSON.stringify(input.draft)
      )
        return;
      throw new CaptureStateConflictError(
        "Confirmed business card fields cannot be changed.",
      );
    }
    await transaction`
      update public.business_card_drafts
      set structured_draft = ${JSON.stringify(input.draft)}::jsonb,
          fields_confirmed_at = coalesce(fields_confirmed_at, now())
      where workspace_id = ${input.workspaceId}
        and capture_session_id = ${input.captureId}
    `;
  });
}

export async function saveRestoredBusinessCardDisplay(input: {
  workspaceId: string;
  captureId: string;
  assetId: string;
  previousPath: string;
  newPath: string;
  sha256: string;
  byteSize: number;
  width: number;
  height: number;
  corners: Array<{ x: number; y: number }>;
  coverage: number;
}): Promise<void> {
  const sql = getDatabase();
  const rows = await sql<Array<{ id: string }>>`
    update public.source_assets asset
    set storage_path = ${input.newPath},
        sha256 = ${input.sha256},
        byte_size = ${input.byteSize},
        pixel_width = ${input.width},
        pixel_height = ${input.height},
        processing_metadata = ${JSON.stringify({
          recipe: "opencv-card-v1",
          corners: input.corners,
          coverage: input.coverage,
          generative: false,
        })}::jsonb
    from public.business_card_drafts draft,
         public.capture_sessions session
    where asset.workspace_id = ${input.workspaceId}
      and asset.id = ${input.assetId}
      and asset.storage_path = ${input.previousPath}
      and asset.deleted_at is null
      and draft.workspace_id = asset.workspace_id
      and draft.capture_session_id = ${input.captureId}
      and draft.display_asset_id = asset.id
      and draft.fields_confirmed_at is not null
      and session.workspace_id = draft.workspace_id
      and session.id = draft.capture_session_id
      and session.state in ('draft', 'review', 'failed', 'committed')
    returning asset.id
  `;
  if (!rows[0]) {
    throw new CaptureStateConflictError(
      "Confirmed business card display is no longer available.",
    );
  }
}

export async function markBusinessCardFailed(
  workspaceId: string,
  captureId: string,
  errorCode: string,
): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.capture_sessions
    set state = 'failed', last_error_code = ${errorCode}, last_error_at = now()
    where workspace_id = ${workspaceId}
      and id = ${captureId}
      and state in ('draft', 'review')
  `;
}

export async function resetBusinessCardForRetry(
  workspaceId: string,
  captureId: string,
): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.capture_sessions
    set state = 'draft', last_error_code = null, last_error_at = null
    where workspace_id = ${workspaceId}
      and id = ${captureId}
      and state = 'failed'
  `;
}

export async function saveBusinessCardReview(input: {
  workspaceId: string;
  captureId: string;
  draft: BusinessCardDraftV1;
  contextNote: string;
}): Promise<void> {
  const sql = getDatabase();
  const contextDraft = businessCardDraftToCaptureDraft(input.draft);

  await sql.begin(async (transaction) => {
    const rows = await transaction<
      Array<{
        state: string;
        fields_confirmed_at: Date | string | null;
        structured_draft: unknown;
      }>
    >`
      select session.state, draft.fields_confirmed_at, draft.structured_draft
      from public.capture_sessions session
      join public.business_card_drafts draft
        on draft.workspace_id = session.workspace_id
       and draft.capture_session_id = session.id
      where session.workspace_id = ${input.workspaceId}
        and session.id = ${input.captureId}
      for update of session, draft
    `;

    if (!rows[0]) {
      throw new CaptureNotFoundError();
    }

    if (rows[0].state !== "draft") {
      throw new CaptureStateConflictError(
        "Business card must be in draft before review.",
      );
    }
    const confirmed = optionalDraft(rows[0].structured_draft);
    if (
      !rows[0].fields_confirmed_at ||
      !confirmed ||
      JSON.stringify(confirmed.identity) !==
        JSON.stringify(input.draft.identity)
    ) {
      throw new CaptureStateConflictError(
        "Confirmed business card fields are required before context review.",
      );
    }

    await transaction`
      update public.business_card_drafts
      set
        structured_draft = ${JSON.stringify(input.draft)}::jsonb,
        context_note = ${input.contextNote}
      where workspace_id = ${input.workspaceId}
        and capture_session_id = ${input.captureId}
    `;
    await transaction`
      update public.capture_sessions
      set
        state = 'review',
        model_draft = ${JSON.stringify(contextDraft)}::jsonb,
        structured_draft = ${JSON.stringify(contextDraft)}::jsonb,
        last_error_code = null,
        last_error_at = null
      where workspace_id = ${input.workspaceId}
        and id = ${input.captureId}
    `;
  });
}

export async function findBusinessCardIdentityCandidates(
  workspaceId: string,
  draft: BusinessCardDraftV1,
): Promise<IdentityCandidate[]> {
  const sql = getDatabase();
  const normalizedName = draft.identity.displayName
    ? normalizeIdentityValue(draft.identity.displayName)
    : "";
  const normalizedOrganization = draft.identity.organizationName
    ? normalizeIdentityValue(draft.identity.organizationName)
    : "";
  const emails = draft.identity.emails.map((value) =>
    normalizeContact("email", value),
  );
  const phones = voicePhoneValues(getContactNumbers(draft.identity)).map(
    (value) => normalizeContact("phone", value),
  );
  const rows = await sql<
    Array<{
      person_id: string;
      display_name: string;
      headline: string | null;
      organization_name: string | null;
      organization_title: string | null;
      name_match: boolean;
      organization_match: boolean;
      email_match: boolean;
      phone_match: boolean;
    }>
  >`
    select
      person.id as person_id,
      person.display_name,
      person.headline,
      affiliation.organization_name,
      affiliation.organization_title,
      person.normalized_name = ${normalizedName} as name_match,
      coalesce(affiliation.normalized_organization_name = ${normalizedOrganization}, false)
        as organization_match,
      exists (
        select 1 from public.person_attributes attribute
        where attribute.workspace_id = person.workspace_id
          and attribute.person_id = person.id
          and attribute.kind = 'email'
          and attribute.normalized_value = any(${emails}::text[])
      ) as email_match,
      exists (
        select 1 from public.person_attributes attribute
        where attribute.workspace_id = person.workspace_id
          and attribute.person_id = person.id
          and attribute.kind = 'phone'
          and attribute.normalized_value = any(${phones}::text[])
      ) as phone_match
    from public.persons person
    left join lateral (
      select
        organization.name as organization_name,
        organization.normalized_name as normalized_organization_name,
        candidate_affiliation.title as organization_title
      from public.affiliations candidate_affiliation
      join public.organizations organization
        on organization.workspace_id = candidate_affiliation.workspace_id
       and organization.id = candidate_affiliation.organization_id
      where candidate_affiliation.workspace_id = person.workspace_id
        and candidate_affiliation.person_id = person.id
      order by candidate_affiliation.is_current desc, candidate_affiliation.created_at desc
      limit 1
    ) affiliation on true
    where person.workspace_id = ${workspaceId} and person.archived_at is null
      and (
        (${normalizedName} <> '' and person.normalized_name = ${normalizedName})
        or (${normalizedOrganization} <> '' and affiliation.normalized_organization_name = ${normalizedOrganization})
        or (cardinality(${emails}::text[]) > 0 and exists (
          select 1 from public.person_attributes attribute
          where attribute.workspace_id = person.workspace_id
            and attribute.person_id = person.id
            and attribute.kind = 'email'
            and attribute.normalized_value = any(${emails}::text[])
        ))
        or (cardinality(${phones}::text[]) > 0 and exists (
          select 1 from public.person_attributes attribute
          where attribute.workspace_id = person.workspace_id
            and attribute.person_id = person.id
            and attribute.kind = 'phone'
            and attribute.normalized_value = any(${phones}::text[])
        ))
      )
    order by email_match desc, phone_match desc, name_match desc,
      organization_match desc, person.updated_at desc
    limit 8
  `;

  return rows.map((row) => ({
    personId: row.person_id,
    displayName: row.display_name,
    headline: row.headline,
    organizationName: row.organization_name,
    organizationTitle: row.organization_title,
    signals: [
      ...(row.email_match ? ["이메일 정확 일치"] : []),
      ...(row.phone_match ? ["전화 정확 일치"] : []),
      ...(row.name_match ? ["이름 일치"] : []),
      ...(row.organization_match ? ["소속 일치"] : []),
    ],
  }));
}

async function addProvenance(
  transaction: TransactionSql,
  input: {
    workspaceId: string;
    entityType:
      | "person"
      | "person_attribute"
      | "affiliation"
      | "event"
      | "interaction"
      | "memory_statement"
      | "action_item";
    entityId: string;
    fieldName: string | null;
    sourceKind: "business_card" | "note" | "ai_inference";
    captureId: string;
    sourceAssetId?: string;
    aiRunId?: string | null;
  },
) {
  await transaction`
    insert into public.provenance_records (
      workspace_id, entity_type, entity_id, field_name, source_kind,
      source_ref, source_asset_id, ai_run_id, verification_status
    )
    values (
      ${input.workspaceId}, ${input.entityType}, ${input.entityId},
      ${input.fieldName}, ${input.sourceKind},
      ${`capture_session:${input.captureId}`},
      ${input.sourceAssetId ?? null}, ${input.aiRunId ?? null}, 'confirmed'
    )
  `;
}

// Canonical commit is intentionally kept in this repository so the Capture row,
// contact facts, relationship Memory, provenance, and Digital Card share one transaction.
export async function commitBusinessCard(input: {
  workspaceId: string;
  captureId: string;
  draft: BusinessCardDraftV1;
  identity: CaptureIdentityChoice;
}): Promise<BusinessCardCommitResult> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const sessions = await transaction<
      Array<{
        state: string;
        ai_run_id: string | null;
        commit_result: unknown;
        created_at: Date | string;
      }>
    >`
      select state, ai_run_id, commit_result, created_at
      from public.capture_sessions
      where workspace_id = ${input.workspaceId} and id = ${input.captureId}
      for update
    `;
    const session = sessions[0];

    if (!session) {
      throw new CaptureNotFoundError();
    }

    const prior = optionalCommitResult(session.commit_result);
    if (session.state === "committed" && prior) {
      return prior;
    }
    if (session.state !== "review") {
      throw new CaptureStateConflictError(
        "Business card must be reviewed before commit.",
      );
    }

    const cardDraftRows = await transaction<
      Array<{
        original_asset_id: string;
        display_asset_id: string;
        model_draft: unknown;
        structured_draft: unknown;
        fields_confirmed_at: Date | string | null;
      }>
    >`
      select original_asset_id, display_asset_id, model_draft, structured_draft, fields_confirmed_at
      from public.business_card_drafts
      where workspace_id = ${input.workspaceId}
        and capture_session_id = ${input.captureId}
      for update
    `;
    const cardDraftRow = cardDraftRows[0];
    if (!cardDraftRow) {
      throw new CaptureNotFoundError();
    }
    const reviewedDraft = optionalDraft(cardDraftRow.structured_draft);
    if (
      !cardDraftRow.fields_confirmed_at ||
      !reviewedDraft ||
      JSON.stringify(reviewedDraft.identity) !==
        JSON.stringify(input.draft.identity)
    ) {
      throw new CaptureStateConflictError(
        "Confirmed business card fields cannot be changed during commit.",
      );
    }

    const correctionIncrement =
      JSON.stringify(optionalDraft(cardDraftRow.model_draft)) ===
      JSON.stringify(input.draft)
        ? 0
        : 1;
    const contextDraft = businessCardDraftToCaptureDraft(input.draft);

    await transaction`
      update public.business_card_drafts
      set structured_draft = ${JSON.stringify(input.draft)}::jsonb
      where workspace_id = ${input.workspaceId}
        and capture_session_id = ${input.captureId}
    `;
    await transaction`
      update public.capture_sessions
      set
        structured_draft = ${JSON.stringify(contextDraft)}::jsonb,
        user_correction_count = user_correction_count + ${correctionIncrement}
      where workspace_id = ${input.workspaceId} and id = ${input.captureId}
    `;

    let personId: string;
    let createdPerson = false;
    if (input.identity.mode === "existing") {
      // Share the workspace editor revision/lock when OCR adds contact facts.
      const people = await transaction<Array<{ id: string }>>`
        update public.persons set updated_at = now()
        where workspace_id = ${input.workspaceId}
          and id = ${input.identity.personId} and archived_at is null
        returning id
      `;
      if (!people[0]) {
        throw new CaptureIdentityConflictError(
          "Selected Person is not available in this workspace.",
        );
      }
      personId = people[0].id;
    } else {
      const displayName = input.identity.displayName.trim();
      const people = await transaction<Array<{ id: string }>>`
        insert into public.persons (
          workspace_id, display_name, normalized_name, headline
        )
        values (
          ${input.workspaceId}, ${displayName},
          ${normalizeIdentityValue(displayName)}, ${input.draft.identity.title}
        )
        returning id
      `;
      personId = people[0].id;
      createdPerson = true;
    }

    let organizationId: string | null = null;
    if (input.draft.identity.organizationName) {
      const organizationName = input.draft.identity.organizationName;
      const normalizedOrganization = normalizeIdentityValue(organizationName);
      const organizations = await transaction<Array<{ id: string }>>`
        select id from public.organizations
        where workspace_id = ${input.workspaceId}
          and normalized_name = ${normalizedOrganization}
        order by created_at limit 1
      `;
      if (organizations[0]) {
        organizationId = organizations[0].id;
      } else {
        const inserted = await transaction<Array<{ id: string }>>`
          insert into public.organizations (workspace_id, name, normalized_name)
          values (
            ${input.workspaceId}, ${organizationName}, ${normalizedOrganization}
          )
          returning id
        `;
        organizationId = inserted[0].id;
      }

      const existing = await transaction<Array<{ id: string }>>`
        select id from public.affiliations
        where workspace_id = ${input.workspaceId}
          and person_id = ${personId}
          and organization_id = ${organizationId}
          and title is not distinct from ${input.draft.identity.title}
          and is_current = true
        limit 1
      `;
      if (!existing[0]) {
        const inserted = await transaction<Array<{ id: string }>>`
          insert into public.affiliations (
            workspace_id, person_id, organization_id, title, is_current,
            source_kind, verification_status
          )
          values (
            ${input.workspaceId}, ${personId}, ${organizationId},
            ${input.draft.identity.title}, true, 'business_card', 'confirmed'
          ) returning id
        `;
        await addProvenance(transaction, {
          workspaceId: input.workspaceId,
          entityType: "affiliation",
          entityId: inserted[0].id,
          fieldName: null,
          sourceKind: "business_card",
          captureId: input.captureId,
          sourceAssetId: cardDraftRow.original_asset_id,
          aiRunId: session.ai_run_id,
        });
      }
    }

    if (createdPerson) {
      await addProvenance(transaction, {
        workspaceId: input.workspaceId,
        entityType: "person",
        entityId: personId,
        fieldName: "display_name",
        sourceKind: "business_card",
        captureId: input.captureId,
        sourceAssetId: cardDraftRow.original_asset_id,
        aiRunId: session.ai_run_id,
      });
    }

    const personAttributeIds: string[] = [];
    const contactGroups = [
      ["email", input.draft.identity.emails],
      ["phone", voicePhoneValues(getContactNumbers(input.draft.identity))],
      ["website", input.draft.identity.websites],
    ] as const;

    for (const [kind, values] of contactGroups) {
      for (const value of values) {
        const normalizedValue = normalizeContact(kind, value);
        const existing = await transaction<Array<{ id: string }>>`
          select id from public.person_attributes
          where workspace_id = ${input.workspaceId}
            and person_id = ${personId}
            and kind = ${kind}
            and normalized_value = ${normalizedValue}
          order by created_at limit 1
        `;
        if (existing[0]) {
          personAttributeIds.push(existing[0].id);
          continue;
        }
        const inserted = await transaction<Array<{ id: string }>>`
          insert into public.person_attributes (
            workspace_id, person_id, kind, value, normalized_value,
            source_kind, verification_status
          ) values (
            ${input.workspaceId}, ${personId}, ${kind}, ${value},
            ${normalizedValue}, 'business_card', 'confirmed'
          ) returning id
        `;
        personAttributeIds.push(inserted[0].id);
        await addProvenance(transaction, {
          workspaceId: input.workspaceId,
          entityType: "person_attribute",
          entityId: inserted[0].id,
          fieldName: "value",
          sourceKind: "business_card",
          captureId: input.captureId,
          sourceAssetId: cardDraftRow.original_asset_id,
          aiRunId: session.ai_run_id,
        });
      }
    }

    const occurredAt = input.draft.interaction.occurredAt;
    let eventId: string | null = null;
    if (input.draft.interaction.eventName) {
      const events = await transaction<Array<{ id: string }>>`
        select id from public.events
        where workspace_id = ${input.workspaceId}
          and lower(name) = lower(${input.draft.interaction.eventName})
          and starts_at::date = ${occurredAt}::timestamptz::date
        order by created_at limit 1
      `;
      if (events[0]) {
        eventId = events[0].id;
      } else {
        const inserted = await transaction<Array<{ id: string }>>`
          insert into public.events (workspace_id, name, location, starts_at)
          values (
            ${input.workspaceId}, ${input.draft.interaction.eventName},
            ${input.draft.interaction.location}, ${occurredAt}
          )
          returning id
        `;
        eventId = inserted[0].id;
        await addProvenance(transaction, {
          workspaceId: input.workspaceId,
          entityType: "event",
          entityId: eventId,
          fieldName: null,
          sourceKind: "ai_inference",
          captureId: input.captureId,
          aiRunId: session.ai_run_id,
        });
      }
    }

    const interactions = await transaction<Array<{ id: string }>>`
      insert into public.interactions (
        workspace_id, event_id, interaction_type, occurred_at, location,
        summary, source_kind, verification_status
      ) values (
        ${input.workspaceId}, ${eventId},
        ${input.draft.interaction.interactionType}, ${occurredAt},
        ${input.draft.interaction.location}, ${input.draft.interaction.summary},
        'note', 'confirmed'
      ) returning id
    `;
    const interactionId = interactions[0].id;
    await transaction`
      insert into public.interaction_participants (
        workspace_id, interaction_id, person_id, role
      )
      values (${input.workspaceId}, ${interactionId}, ${personId}, 'contact')
    `;
    await addProvenance(transaction, {
      workspaceId: input.workspaceId,
      entityType: "interaction",
      entityId: interactionId,
      fieldName: "summary",
      sourceKind: "note",
      captureId: input.captureId,
      aiRunId: session.ai_run_id,
    });

    const topicIds: string[] = [];
    for (const topicName of input.draft.topics) {
      const topics = await transaction<Array<{ id: string }>>`
        insert into public.topics (workspace_id, name, normalized_name)
        values (
          ${input.workspaceId}, ${topicName},
          ${normalizeIdentityValue(topicName)}
        )
        on conflict (workspace_id, normalized_name)
        do update set name = excluded.name
        returning id
      `;
      topicIds.push(topics[0].id);
      await transaction`
        insert into public.interaction_topics (
          workspace_id, interaction_id, topic_id,
          source_kind, verification_status
        ) values (
          ${input.workspaceId}, ${interactionId}, ${topics[0].id},
          'ai_inference', 'confirmed'
        )
        on conflict (workspace_id, interaction_id, topic_id) do nothing
      `;
    }

    const memoryIds: string[] = [];
    for (const memory of input.draft.memories) {
      const inserted = await transaction<Array<{ id: string }>>`
        insert into public.memory_statements (
          workspace_id, person_id, interaction_id, statement_type, body,
          occurred_at, source_kind, verification_status
        ) values (
          ${input.workspaceId}, ${personId}, ${interactionId},
          ${memory.statementType}, ${memory.body}, ${memory.occurredAt},
          'ai_inference', 'confirmed'
        ) returning id
      `;
      memoryIds.push(inserted[0].id);
      await addProvenance(transaction, {
        workspaceId: input.workspaceId,
        entityType: "memory_statement",
        entityId: inserted[0].id,
        fieldName: "body",
        sourceKind: "ai_inference",
        captureId: input.captureId,
        aiRunId: session.ai_run_id,
      });
    }

    const actionIds: string[] = [];
    for (const action of input.draft.actions) {
      const inserted = await transaction<Array<{ id: string }>>`
        insert into public.action_items (
          workspace_id, person_id, interaction_id, kind, title, details,
          due_at, source_kind, verification_status
        ) values (
          ${input.workspaceId}, ${personId}, ${interactionId}, ${action.kind},
          ${action.title}, ${action.details}, ${action.dueAt},
          'ai_inference', 'confirmed'
        ) returning id
      `;
      actionIds.push(inserted[0].id);
      await addProvenance(transaction, {
        workspaceId: input.workspaceId,
        entityType: "action_item",
        entityId: inserted[0].id,
        fieldName: "title",
        sourceKind: "ai_inference",
        captureId: input.captureId,
        aiRunId: session.ai_run_id,
      });
    }

    const cards = await transaction<Array<{ id: string }>>`
      insert into public.business_cards (
        workspace_id, person_id, capture_session_id, original_asset_id,
        display_asset_id, card_data
      ) values (
        ${input.workspaceId}, ${personId}, ${input.captureId},
        ${cardDraftRow.original_asset_id}, ${cardDraftRow.display_asset_id},
        ${JSON.stringify(input.draft.identity)}::jsonb
      ) returning id
    `;

    const committedAt = new Date().toISOString();
    const result: BusinessCardCommitResult = {
      kind: "business_card_capture_v1",
      personId,
      interactionId,
      organizationId,
      eventId,
      topicIds,
      memoryIds,
      actionIds,
      personAttributeIds,
      businessCardId: cards[0].id,
      originalAssetId: cardDraftRow.original_asset_id,
      displayAssetId: cardDraftRow.display_asset_id,
      committedAt,
    };

    const updated = await transaction<Array<{ id: string }>>`
      update public.capture_sessions
      set
        state = 'committed',
        committed_at = ${committedAt},
        committed_person_id = ${personId},
        committed_interaction_id = ${interactionId},
        commit_result = ${JSON.stringify(result)}::jsonb
      where workspace_id = ${input.workspaceId}
        and id = ${input.captureId}
        and state = 'review'
      returning id
    `;
    if (!updated[0]) {
      throw new CaptureStateConflictError(
        "Business card commit lost its review-state lock.",
      );
    }

    return result;
  });
}

export async function getSourceAsset(
  workspaceId: string,
  assetId: string,
): Promise<{ path: string; mimeType: string; filename: string | null } | null> {
  const sql = getDatabase();
  const rows = await sql<
    Array<{
      storage_path: string;
      mime_type: string;
      original_filename: string | null;
    }>
  >`
    select storage_path, mime_type, original_filename
    from public.source_assets
    where workspace_id = ${workspaceId}
      and id = ${assetId}
      and asset_kind = 'image'
      and deleted_at is null
    limit 1
  `;
  return rows[0]
    ? {
        path: rows[0].storage_path,
        mimeType: rows[0].mime_type,
        filename: rows[0].original_filename,
      }
    : null;
}

export async function getBusinessCardOcrInput(
  workspaceId: string,
  captureId: string,
): Promise<{
  path: string;
  mimeType: string;
  filename: string;
  sha256: string;
} | null> {
  const sql = getDatabase();
  const rows = await sql<
    Array<{
      path: string;
      mimeType: string;
      filename: string;
      sha256: string;
    }>
  >`
    select
      asset.storage_path as "path",
      asset.mime_type as "mimeType",
      coalesce(asset.original_filename, 'business-card') as filename,
      asset.sha256
    from public.business_card_drafts draft
    join public.source_assets asset
      on asset.workspace_id = draft.workspace_id
     and asset.id = case
       when (select processing_metadata->>'recipe' from public.source_assets
             where id = draft.display_asset_id and workspace_id = draft.workspace_id)
            in ('docaligner-lc100-card-v1', 'manual-card-v1')
       then draft.display_asset_id else draft.original_asset_id end
    where draft.workspace_id = ${workspaceId}
      and draft.capture_session_id = ${captureId}
      and asset.deleted_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export async function deleteUncommittedBusinessCardCapture(
  workspaceId: string,
  captureId: string,
): Promise<string[]> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const sessions = await transaction<Array<{ state: string }>>`
      select state from public.capture_sessions
      where workspace_id = ${workspaceId} and id = ${captureId}
      for update
    `;
    if (!sessions[0]) {
      return [];
    }
    if (sessions[0].state === "committed") {
      throw new CaptureStateConflictError(
        "Committed business cards cannot be discarded.",
      );
    }
    const assets = await transaction<
      Array<{ id: string; storage_path: string }>
    >`
      select id, storage_path from public.source_assets
      where workspace_id = ${workspaceId}
        and capture_session_id = ${captureId}
        and asset_kind = 'image'
    `;
    await transaction`
      delete from public.business_card_drafts
      where workspace_id = ${workspaceId}
        and capture_session_id = ${captureId}
    `;
    await transaction`
      delete from public.source_assets
      where workspace_id = ${workspaceId}
        and capture_session_id = ${captureId}
    `;
    await transaction`
      delete from public.capture_sessions
      where workspace_id = ${workspaceId} and id = ${captureId}
    `;
    return assets.map((asset) => asset.storage_path);
  });
}

export async function getOriginalAssetForDeletion(
  workspaceId: string,
  businessCardId: string,
): Promise<{ assetId: string; path: string } | null> {
  const sql = getDatabase();
  const rows = await sql<Array<{ asset_id: string; storage_path: string }>>`
    select asset.id as asset_id, asset.storage_path
    from public.business_cards card
    join public.source_assets asset
      on asset.workspace_id = card.workspace_id
     and asset.id = card.original_asset_id
    where card.workspace_id = ${workspaceId}
      and card.id = ${businessCardId}
      and card.original_retained = true
      and asset.deleted_at is null
    limit 1
  `;
  return rows[0]
    ? { assetId: rows[0].asset_id, path: rows[0].storage_path }
    : null;
}

export async function markOriginalAssetDeleted(
  workspaceId: string,
  businessCardId: string,
  assetId: string,
): Promise<void> {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    await transaction`
      update public.source_assets set deleted_at = now()
      where workspace_id = ${workspaceId} and id = ${assetId}
    `;
    await transaction`
      update public.business_cards set original_retained = false
      where workspace_id = ${workspaceId}
        and id = ${businessCardId}
        and original_asset_id = ${assetId}
    `;
  });
}
