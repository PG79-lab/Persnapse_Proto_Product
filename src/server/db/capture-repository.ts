import "server-only";

import type { TransactionSql } from "postgres";

import {
  captureDraftV1Schema,
  type CaptureDraftV1,
} from "../../domain/capture/capture-draft";
import type {
  CaptureCommitResult,
  CaptureIdentityChoice,
  IdentityCandidate,
} from "../../domain/capture/capture-workflow";
import { captureCommitResultSchema } from "../../domain/capture/capture-workflow";
import type { CaptureSessionState } from "../../domain/capture/capture-state";
import { getDatabase } from "./client";

interface CaptureSessionRow {
  id: string;
  state: CaptureSessionState;
  raw_text: string | null;
  model_draft: unknown;
  structured_draft: unknown;
  ai_run_id: string | null;
  user_correction_count: number | string;
  last_error_code: string | null;
  commit_result: unknown;
  created_at: Date | string;
}

export interface StoredCaptureSession {
  id: string;
  state: CaptureSessionState;
  rawText: string;
  modelDraft: CaptureDraftV1 | null;
  structuredDraft: CaptureDraftV1 | null;
  aiRunId: string | null;
  userCorrectionCount: number;
  lastErrorCode: string | null;
  commitResult: CaptureCommitResult | null;
  createdAt: string;
}

export class CaptureNotFoundError extends Error {
  constructor() {
    super("Capture session was not found.");
    this.name = "CaptureNotFoundError";
  }
}

export class CaptureStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureStateConflictError";
  }
}

export class CaptureIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureIdentityConflictError";
  }
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

function optionalDraft(value: unknown): CaptureDraftV1 | null {
  const parsed = captureDraftV1Schema.safeParse(parsedJsonValue(value));
  return parsed.success ? parsed.data : null;
}

function optionalCommitResult(value: unknown): CaptureCommitResult | null {
  const parsed = captureCommitResultSchema.safeParse(parsedJsonValue(value));
  return parsed.success ? parsed.data : null;
}

function mapCaptureRow(row: CaptureSessionRow): StoredCaptureSession {
  return {
    id: row.id,
    state: row.state,
    rawText: row.raw_text ?? "",
    modelDraft: optionalDraft(row.model_draft),
    structuredDraft: optionalDraft(row.structured_draft),
    aiRunId: row.ai_run_id,
    userCorrectionCount: Number(row.user_correction_count),
    lastErrorCode: row.last_error_code,
    commitResult: optionalCommitResult(row.commit_result),
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

async function requireCapture(
  transaction: TransactionSql,
  workspaceId: string,
  captureId: string,
): Promise<CaptureSessionRow> {
  const rows = await transaction<CaptureSessionRow[]>`
    select
      id,
      state,
      raw_text,
      model_draft,
      structured_draft,
      ai_run_id,
      user_correction_count,
      last_error_code,
      commit_result,
      created_at
    from public.capture_sessions
    where workspace_id = ${workspaceId}
      and id = ${captureId}
    for update
  `;

  if (!rows[0]) {
    throw new CaptureNotFoundError();
  }

  return rows[0];
}

export async function createCaptureSession(input: {
  workspaceId: string;
  rawText: string;
  idempotencyKey: string;
}): Promise<{ capture: StoredCaptureSession; created: boolean }> {
  const sql = getDatabase();
  const inserted = await sql<CaptureSessionRow[]>`
    insert into public.capture_sessions (
      workspace_id,
      state,
      input_kind,
      raw_text,
      structured_draft,
      model_draft,
      draft_schema_version,
      idempotency_key
    )
    values (
      ${input.workspaceId},
      'draft',
      'note',
      ${input.rawText},
      '{}'::jsonb,
      '{}'::jsonb,
      'capture-draft-v1',
      ${input.idempotencyKey}
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning
      id,
      state,
      raw_text,
      model_draft,
      structured_draft,
      ai_run_id,
      user_correction_count,
      last_error_code,
      commit_result,
      created_at
  `;
  const created = Boolean(inserted[0]);
  const rows = created
    ? inserted
    : await sql<CaptureSessionRow[]>`
        select
          id,
          state,
          raw_text,
          model_draft,
          structured_draft,
          ai_run_id,
          user_correction_count,
          last_error_code,
          commit_result,
          created_at
        from public.capture_sessions
        where workspace_id = ${input.workspaceId}
          and idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
  const row = rows[0];

  if (!row) {
    throw new CaptureNotFoundError();
  }

  if (!created && row.raw_text?.trim() !== input.rawText.trim()) {
    throw new CaptureStateConflictError(
      "Idempotency key is already bound to different capture text.",
    );
  }

  return {
    capture: mapCaptureRow(row),
    created,
  };
}

export async function getCaptureSession(
  workspaceId: string,
  captureId: string,
): Promise<StoredCaptureSession | null> {
  const sql = getDatabase();
  const rows = await sql<CaptureSessionRow[]>`
    select
      id,
      state,
      raw_text,
      model_draft,
      structured_draft,
      ai_run_id,
      user_correction_count,
      last_error_code,
      commit_result,
      created_at
    from public.capture_sessions
    where workspace_id = ${workspaceId}
      and id = ${captureId}
    limit 1
  `;

  return rows[0] ? mapCaptureRow(rows[0]) : null;
}

export async function prepareCaptureForStructuring(
  workspaceId: string,
  captureId: string,
): Promise<StoredCaptureSession> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const row = await requireCapture(transaction, workspaceId, captureId);

    if (row.state === "failed") {
      const rows = await transaction<CaptureSessionRow[]>`
        update public.capture_sessions
        set
          state = 'draft',
          last_error_code = null,
          last_error_at = null
        where workspace_id = ${workspaceId}
          and id = ${captureId}
        returning
          id,
          state,
          raw_text,
          model_draft,
          structured_draft,
          ai_run_id,
          user_correction_count,
          last_error_code,
          commit_result,
          created_at
      `;
      return mapCaptureRow(rows[0]);
    }

    if (row.state !== "draft") {
      throw new CaptureStateConflictError(
        "Only draft or failed captures can be structured.",
      );
    }

    return mapCaptureRow(row);
  });
}

export async function saveStructuredCapture(
  workspaceId: string,
  captureId: string,
  draft: CaptureDraftV1,
): Promise<StoredCaptureSession> {
  const sql = getDatabase();
  const rows = await sql<CaptureSessionRow[]>`
    update public.capture_sessions
    set
      state = 'review',
      model_draft = ${JSON.stringify(draft)}::jsonb,
      structured_draft = ${JSON.stringify(draft)}::jsonb,
      last_error_code = null,
      last_error_at = null
    where workspace_id = ${workspaceId}
      and id = ${captureId}
      and state = 'draft'
    returning
      id,
      state,
      raw_text,
      model_draft,
      structured_draft,
      ai_run_id,
      user_correction_count,
      last_error_code,
      commit_result,
      created_at
  `;

  if (!rows[0]) {
    throw new CaptureStateConflictError(
      "Capture left draft state before structuring completed.",
    );
  }

  return mapCaptureRow(rows[0]);
}

export async function markCaptureFailed(
  workspaceId: string,
  captureId: string,
  errorCode: string,
): Promise<void> {
  const sql = getDatabase();

  await sql`
    update public.capture_sessions
    set
      state = 'failed',
      last_error_code = ${errorCode},
      last_error_at = now()
    where workspace_id = ${workspaceId}
      and id = ${captureId}
      and state = 'draft'
  `;
}

export async function findIdentityCandidates(
  workspaceId: string,
  draft: CaptureDraftV1,
): Promise<IdentityCandidate[]> {
  const sql = getDatabase();
  const normalizedName = draft.identityHint.displayName
    ? normalizeIdentityValue(draft.identityHint.displayName)
    : "";
  const normalizedOrganization = draft.identityHint.organizationName
    ? normalizeIdentityValue(draft.identityHint.organizationName)
    : "";
  const rows = await sql<
    Array<{
      person_id: string;
      display_name: string;
      headline: string | null;
      organization_name: string | null;
      organization_title: string | null;
      name_match: boolean;
      organization_match: boolean;
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
        as organization_match
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
        or (
          ${normalizedOrganization} <> ''
          and affiliation.normalized_organization_name = ${normalizedOrganization}
        )
      )
    order by
      (person.normalized_name = ${normalizedName}) desc,
      (affiliation.normalized_organization_name = ${normalizedOrganization}) desc,
      person.updated_at desc
    limit 8
  `;

  return rows.map((row) => ({
    personId: row.person_id,
    displayName: row.display_name,
    headline: row.headline,
    organizationName: row.organization_name,
    organizationTitle: row.organization_title,
    signals: [
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
      | "affiliation"
      | "event"
      | "interaction"
      | "memory_statement"
      | "action_item";
    entityId: string;
    fieldName: string | null;
    sourceKind: "note" | "ai_inference";
    captureId: string;
    aiRunId: string | null;
  },
): Promise<void> {
  await transaction`
    insert into public.provenance_records (
      workspace_id,
      entity_type,
      entity_id,
      field_name,
      source_kind,
      source_ref,
      ai_run_id,
      verification_status
    )
    values (
      ${input.workspaceId},
      ${input.entityType},
      ${input.entityId},
      ${input.fieldName},
      ${input.sourceKind},
      ${`capture_session:${input.captureId}`},
      ${input.aiRunId},
      'confirmed'
    )
  `;
}

export async function commitTextCapture(input: {
  workspaceId: string;
  captureId: string;
  draft: CaptureDraftV1;
  identity: CaptureIdentityChoice;
}): Promise<{ result: CaptureCommitResult; alreadyCommitted: boolean }> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const session = await requireCapture(
      transaction,
      input.workspaceId,
      input.captureId,
    );
    const priorResult = optionalCommitResult(session.commit_result);

    if (session.state === "committed" && priorResult) {
      return { result: priorResult, alreadyCommitted: true };
    }

    if (session.state !== "review") {
      throw new CaptureStateConflictError(
        "Capture must be reviewed before it can be committed.",
      );
    }

    const correctionIncrement =
      JSON.stringify(optionalDraft(session.model_draft)) ===
      JSON.stringify(input.draft)
        ? 0
        : 1;

    await transaction`
      update public.capture_sessions
      set
        structured_draft = ${JSON.stringify(input.draft)}::jsonb,
        user_correction_count = user_correction_count + ${correctionIncrement}
      where workspace_id = ${input.workspaceId}
        and id = ${input.captureId}
    `;

    let personId: string;
    let createdPerson = false;

    if (input.identity.mode === "existing") {
      // Lock identity and advance the UI revision before appending profile facts.
      // An already-open workspace editor must not overwrite this reviewed capture.
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
          workspace_id,
          display_name,
          normalized_name,
          headline
        )
        values (
          ${input.workspaceId},
          ${displayName},
          ${normalizeIdentityValue(displayName)},
          ${input.draft.identityHint.title}
        )
        returning id
      `;
      personId = people[0].id;
      createdPerson = true;
    }

    let organizationId: string | null = null;
    const organizationName = input.draft.identityHint.organizationName;

    if (organizationName) {
      const normalizedOrganization = normalizeIdentityValue(organizationName);
      const organizations = await transaction<Array<{ id: string }>>`
        select id
        from public.organizations
        where workspace_id = ${input.workspaceId}
          and normalized_name = ${normalizedOrganization}
        order by created_at
        limit 1
      `;

      if (organizations[0]) {
        organizationId = organizations[0].id;
      } else {
        const insertedOrganizations = await transaction<Array<{ id: string }>>`
          insert into public.organizations (
            workspace_id,
            name,
            normalized_name
          )
          values (
            ${input.workspaceId},
            ${organizationName},
            ${normalizedOrganization}
          )
          returning id
        `;
        organizationId = insertedOrganizations[0].id;
      }

      const existingAffiliations = await transaction<Array<{ id: string }>>`
        select id
        from public.affiliations
        where workspace_id = ${input.workspaceId}
          and person_id = ${personId}
          and organization_id = ${organizationId}
          and title is not distinct from ${input.draft.identityHint.title}
          and is_current = true
        limit 1
      `;

      if (!existingAffiliations[0]) {
        const affiliations = await transaction<Array<{ id: string }>>`
          insert into public.affiliations (
            workspace_id,
            person_id,
            organization_id,
            title,
            is_current,
            source_kind,
            verification_status
          )
          values (
            ${input.workspaceId},
            ${personId},
            ${organizationId},
            ${input.draft.identityHint.title},
            true,
            'ai_inference',
            'confirmed'
          )
          returning id
        `;
        await addProvenance(transaction, {
          workspaceId: input.workspaceId,
          entityType: "affiliation",
          entityId: affiliations[0].id,
          fieldName: null,
          sourceKind: "ai_inference",
          captureId: input.captureId,
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
        sourceKind: "ai_inference",
        captureId: input.captureId,
        aiRunId: session.ai_run_id,
      });
    }

    return commitTextCaptureDetails(transaction, {
      ...input,
      session,
      personId,
      organizationId,
    });
  });
}

async function commitTextCaptureDetails(
  transaction: TransactionSql,
  input: {
    workspaceId: string;
    captureId: string;
    draft: CaptureDraftV1;
    identity: CaptureIdentityChoice;
    session: CaptureSessionRow;
    personId: string;
    organizationId: string | null;
  },
): Promise<{ result: CaptureCommitResult; alreadyCommitted: false }> {
  const occurredAt = input.draft.interaction.occurredAt;
  let eventId: string | null = null;

  if (input.draft.interaction.eventName) {
    const events = await transaction<Array<{ id: string }>>`
      select id
      from public.events
      where workspace_id = ${input.workspaceId}
        and lower(name) = lower(${input.draft.interaction.eventName})
        and starts_at::date = ${occurredAt}::timestamptz::date
      order by created_at
      limit 1
    `;

    if (events[0]) {
      eventId = events[0].id;
    } else {
      const insertedEvents = await transaction<Array<{ id: string }>>`
        insert into public.events (
          workspace_id,
          name,
          location,
          starts_at
        )
        values (
          ${input.workspaceId},
          ${input.draft.interaction.eventName},
          ${input.draft.interaction.location},
          ${occurredAt}
        )
        returning id
      `;
      eventId = insertedEvents[0].id;
      await addProvenance(transaction, {
        workspaceId: input.workspaceId,
        entityType: "event",
        entityId: eventId,
        fieldName: null,
        sourceKind: "ai_inference",
        captureId: input.captureId,
        aiRunId: input.session.ai_run_id,
      });
    }
  }

  const interactions = await transaction<Array<{ id: string }>>`
    insert into public.interactions (
      workspace_id,
      event_id,
      interaction_type,
      occurred_at,
      location,
      summary,
      source_kind,
      verification_status
    )
    values (
      ${input.workspaceId},
      ${eventId},
      ${input.draft.interaction.interactionType},
      ${occurredAt},
      ${input.draft.interaction.location},
      ${input.draft.interaction.summary},
      'note',
      'confirmed'
    )
    returning id
  `;
  const interactionId = interactions[0].id;

  await transaction`
    insert into public.interaction_participants (
      workspace_id,
      interaction_id,
      person_id,
      role
    )
    values (
      ${input.workspaceId},
      ${interactionId},
      ${input.personId},
      'contact'
    )
  `;
  await addProvenance(transaction, {
    workspaceId: input.workspaceId,
    entityType: "interaction",
    entityId: interactionId,
    fieldName: "summary",
    sourceKind: "note",
    captureId: input.captureId,
    aiRunId: input.session.ai_run_id,
  });

  const topicIds: string[] = [];

  for (const topicName of input.draft.topics) {
    const normalizedTopic = normalizeIdentityValue(topicName);
    const topics = await transaction<Array<{ id: string }>>`
      insert into public.topics (
        workspace_id,
        name,
        normalized_name
      )
      values (
        ${input.workspaceId},
        ${topicName},
        ${normalizedTopic}
      )
      on conflict (workspace_id, normalized_name)
      do update set name = excluded.name
      returning id
    `;
    const topicId = topics[0].id;
    topicIds.push(topicId);

    await transaction`
      insert into public.interaction_topics (
        workspace_id,
        interaction_id,
        topic_id,
        source_kind,
        verification_status
      )
      values (
        ${input.workspaceId},
        ${interactionId},
        ${topicId},
        'ai_inference',
        'confirmed'
      )
      on conflict (workspace_id, interaction_id, topic_id) do nothing
    `;
  }

  const memoryIds: string[] = [];

  for (const memory of input.draft.memories) {
    const memories = await transaction<Array<{ id: string }>>`
      insert into public.memory_statements (
        workspace_id,
        person_id,
        interaction_id,
        statement_type,
        body,
        occurred_at,
        source_kind,
        verification_status
      )
      values (
        ${input.workspaceId},
        ${input.personId},
        ${interactionId},
        ${memory.statementType},
        ${memory.body},
        ${memory.occurredAt},
        'ai_inference',
        'confirmed'
      )
      returning id
    `;
    memoryIds.push(memories[0].id);
    await addProvenance(transaction, {
      workspaceId: input.workspaceId,
      entityType: "memory_statement",
      entityId: memories[0].id,
      fieldName: "body",
      sourceKind: "ai_inference",
      captureId: input.captureId,
      aiRunId: input.session.ai_run_id,
    });
  }

  const actionIds: string[] = [];

  for (const action of input.draft.actions) {
    const actions = await transaction<Array<{ id: string }>>`
      insert into public.action_items (
        workspace_id,
        person_id,
        interaction_id,
        kind,
        title,
        details,
        due_at,
        source_kind,
        verification_status
      )
      values (
        ${input.workspaceId},
        ${input.personId},
        ${interactionId},
        ${action.kind},
        ${action.title},
        ${action.details},
        ${action.dueAt},
        'ai_inference',
        'confirmed'
      )
      returning id
    `;
    actionIds.push(actions[0].id);
    await addProvenance(transaction, {
      workspaceId: input.workspaceId,
      entityType: "action_item",
      entityId: actions[0].id,
      fieldName: "title",
      sourceKind: "ai_inference",
      captureId: input.captureId,
      aiRunId: input.session.ai_run_id,
    });
  }

  const committedAt = new Date().toISOString();
  const result: CaptureCommitResult = {
    kind: "text_capture_v1",
    personId: input.personId,
    interactionId,
    organizationId: input.organizationId,
    eventId,
    topicIds,
    memoryIds,
    actionIds,
    committedAt,
  };

  const updated = await transaction<Array<{ id: string }>>`
    update public.capture_sessions
    set
      state = 'committed',
      committed_at = ${committedAt},
      committed_person_id = ${input.personId},
      committed_interaction_id = ${interactionId},
      commit_result = ${JSON.stringify(result)}::jsonb
    where workspace_id = ${input.workspaceId}
      and id = ${input.captureId}
      and state = 'review'
    returning id
  `;

  if (!updated[0]) {
    throw new CaptureStateConflictError(
      "Capture commit lost its review-state lock.",
    );
  }

  return { result, alreadyCommitted: false };
}

export async function rebuildPersonMemoryDocument(
  workspaceId: string,
  personId: string,
): Promise<void> {
  const sql = getDatabase();

  await sql`
    select app_private.rebuild_person_memory_document(
      ${workspaceId}::uuid,
      ${personId}::uuid
    )
  `;
}
