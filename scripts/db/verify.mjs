import { createDatabaseClient } from "./connection.mjs";

const expectedTables = [
  "action_items",
  "affiliations",
  "ai_runs",
  "capture_sessions",
  "events",
  "feedback",
  "golden_query_cases",
  "interaction_participants",
  "interaction_topics",
  "interactions",
  "memory_documents",
  "memory_statements",
  "organizations",
  "person_attributes",
  "persons",
  "provenance_records",
  "queries",
  "query_evidence",
  "source_assets",
  "topics",
  "workspaces",
];

const workspaceId = process.env.APP_DEFAULT_WORKSPACE_ID;

if (!workspaceId) {
  throw new Error("APP_DEFAULT_WORKSPACE_ID is required.");
}

const sql = createDatabaseClient();

function toCount(value) {
  return Number(value ?? 0);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const tables = await sql`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `;
  const tableMap = new Map(
    tables.map((table) => [table.table_name, table.rls_enabled]),
  );

  for (const tableName of expectedTables) {
    assert(tableMap.has(tableName), `Missing table: ${tableName}`);
    assert(tableMap.get(tableName), `RLS is disabled: ${tableName}`);
  }

  const [foundationContracts] = await sql`
    select
      (
        select format_type(attribute.atttypid, attribute.atttypmod)
        from pg_catalog.pg_attribute attribute
        join pg_catalog.pg_class relation
          on relation.oid = attribute.attrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'memory_documents'
          and attribute.attname = 'embedding'
          and attribute.attnum > 0
          and not attribute.attisdropped
      ) as embedding_type,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'capture_sessions'
          and column_name = 'commit_result'
      ) as has_capture_commit_result,
      exists (
        select 1
        from pg_catalog.pg_trigger trigger
        join pg_catalog.pg_class relation
          on relation.oid = trigger.tgrelid
        join pg_catalog.pg_namespace namespace
          on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'capture_sessions'
          and trigger.tgname = 'capture_sessions_enforce_state_transition'
          and not trigger.tgisinternal
      ) as has_capture_state_guard,
      to_regprocedure(
        'app_private.rebuild_person_memory_document(uuid,uuid)'
      ) is not null as has_person_projection_function
  `;

  assert(
    foundationContracts.embedding_type === "vector(1024)",
    `Expected vector(1024), received ${foundationContracts.embedding_type}.`,
  );
  assert(
    foundationContracts.has_capture_commit_result,
    "Capture commit result contract is missing.",
  );
  assert(
    foundationContracts.has_capture_state_guard,
    "Capture state transition guard is missing.",
  );
  assert(
    foundationContracts.has_person_projection_function,
    "Person-scoped projection function is missing.",
  );

  await sql`
    do $guard$
    declare
      committed_capture_id uuid;
    begin
      select id
      into committed_capture_id
      from public.capture_sessions
      where state = 'committed'
      order by created_at
      limit 1;

      if committed_capture_id is not null then
        begin
          update public.capture_sessions
          set state = 'draft'
          where id = committed_capture_id;

          raise exception
            using
              errcode = 'P0001',
              message = 'Capture state guard accepted an invalid transition.';
        exception
          when check_violation then
            null;
        end;
      end if;
    end
    $guard$
  `;

  const [counts] = await sql`
    select
      (select count(*) from public.persons where workspace_id = ${workspaceId}) as people,
      (select count(*) from public.organizations where workspace_id = ${workspaceId}) as organizations,
      (select count(*) from public.interactions where workspace_id = ${workspaceId}) as interactions,
      (select count(*) from public.memory_statements where workspace_id = ${workspaceId}) as memories,
      (select count(*) from public.action_items where workspace_id = ${workspaceId}) as actions,
      (
        select count(*)
        from public.memory_documents
        where workspace_id = ${workspaceId}
          and document_kind = 'person_profile'
      ) as documents,
      (
        select count(*)
        from public.golden_query_cases
        where workspace_id = ${workspaceId}
          and is_active = true
      ) as golden_queries,
      (
        select count(*)
        from public.queries
        where workspace_id = ${workspaceId}
          and status = 'completed'
          and answer_text is not null
          and response_payload <> '{}'::jsonb
      ) as completed_recall_queries,
      (
        select count(*)
        from public.query_evidence
        where workspace_id = ${workspaceId}
          and verification_status = 'confirmed'
          and evidence_excerpt is not null
      ) as evidence_snapshots
  `;
  const [edgeCases] = await sql`
    select
      (
        select count(*)
        from (
          select normalized_name
          from public.persons
          where workspace_id = ${workspaceId}
          group by normalized_name
          having count(*) > 1
        ) duplicates
      ) as duplicate_names,
      (
        select count(*)
        from (
          select ip.person_id
          from public.interaction_participants ip
          where ip.workspace_id = ${workspaceId}
          group by ip.person_id
          having count(*) > 1
        ) repeated_contacts
      ) as repeated_contacts,
      (
        select count(*)
        from public.action_items
        where workspace_id = ${workspaceId} and status = 'pending'
      ) as pending_actions,
      (
        select count(*)
        from public.memory_statements
        where workspace_id = ${workspaceId} and verification_status = 'draft'
      ) as draft_memories
  `;

  assert(
    toCount(counts.people) >= 12,
    "Golden dataset needs at least 12 people.",
  );
  assert(
    toCount(counts.interactions) >= 15,
    "Golden dataset needs at least 15 interactions.",
  );
  assert(
    toCount(edgeCases.duplicate_names) >= 1,
    "Duplicate-name case is missing.",
  );
  assert(
    toCount(edgeCases.repeated_contacts) >= 1,
    "Repeated-contact case is missing.",
  );
  assert(
    toCount(edgeCases.pending_actions) >= 1,
    "Pending-action case is missing.",
  );
  assert(
    toCount(edgeCases.draft_memories) >= 1,
    "Draft-memory case is missing.",
  );
  assert(
    toCount(counts.golden_queries) >= 9,
    "Recall Golden Query suite needs at least 9 active cases.",
  );
  assert(
    toCount(counts.completed_recall_queries) >= 8,
    "Recall evaluation results were not persisted.",
  );
  assert(
    toCount(counts.evidence_snapshots) >= 1,
    "Recall evidence snapshots are missing.",
  );

  const beforeRebuild = await sql`
    select id, content_hash, embedding_status, updated_at
    from public.memory_documents
    where workspace_id = ${workspaceId}
      and document_kind = 'person_profile'
    order by id
  `;

  await sql`select app_private.rebuild_memory_documents(${workspaceId}::uuid)`;

  const [rebuilt] = await sql`
    select count(*) as documents
    from public.memory_documents
    where workspace_id = ${workspaceId}
      and document_kind = 'person_profile'
  `;
  assert(
    toCount(rebuilt.documents) === toCount(counts.people),
    "Derived memory documents were not rebuilt for every person.",
  );

  const afterRebuild = await sql`
    select id, content_hash, embedding_dimensions, embedding_status, updated_at
    from public.memory_documents
    where workspace_id = ${workspaceId}
      and document_kind = 'person_profile'
    order by id
  `;
  const beforeById = new Map(
    beforeRebuild.map((document) => [document.id, document]),
  );

  for (const document of afterRebuild) {
    const before = beforeById.get(document.id);

    assert(before, `Projection identity changed: ${document.id}`);
    assert(
      before.content_hash === document.content_hash,
      `Stable projection content changed: ${document.id}`,
    );
    assert(
      new Date(before.updated_at).getTime() ===
        new Date(document.updated_at).getTime(),
      `Unchanged projection was rewritten: ${document.id}`,
    );
    assert(
      toCount(document.embedding_dimensions) === 1024,
      `Unexpected embedding dimension: ${document.id}`,
    );
    assert(
      ["pending", "processing", "ready", "failed"].includes(
        document.embedding_status,
      ),
      `Unexpected embedding status: ${document.id}`,
    );
  }

  const [draftProjection] = await sql`
    select count(*) as leaked_drafts
    from public.memory_statements draft
    join public.memory_documents document
      on document.workspace_id = draft.workspace_id
     and document.person_id = draft.person_id
     and document.document_kind = 'person_profile'
    where draft.workspace_id = ${workspaceId}
      and draft.verification_status = 'draft'
      and position(draft.body in document.content) > 0
  `;
  assert(
    toCount(draftProjection.leaked_drafts) === 0,
    "Draft memories leaked into a Recall projection.",
  );

  console.log(
    JSON.stringify(
      {
        verified: true,
        tables: expectedTables.length,
        people: toCount(counts.people),
        organizations: toCount(counts.organizations),
        interactions: toCount(counts.interactions),
        memories: toCount(counts.memories),
        actions: toCount(counts.actions),
        derivedDocuments: toCount(rebuilt.documents),
        goldenQueries: toCount(counts.golden_queries),
        completedRecallQueries: toCount(counts.completed_recall_queries),
        evidenceSnapshots: toCount(counts.evidence_snapshots),
        draftProjectionLeaks: toCount(draftProjection.leaked_drafts),
        foundationContracts: {
          embeddingType: foundationContracts.embedding_type,
          captureCommitResult: foundationContracts.has_capture_commit_result,
          captureStateGuard: foundationContracts.has_capture_state_guard,
          personScopedProjection:
            foundationContracts.has_person_projection_function,
        },
        edgeCases: {
          duplicateNames: toCount(edgeCases.duplicate_names),
          repeatedContacts: toCount(edgeCases.repeated_contacts),
          pendingActions: toCount(edgeCases.pending_actions),
          draftMemories: toCount(edgeCases.draft_memories),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
