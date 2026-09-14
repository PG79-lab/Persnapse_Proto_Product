import { createDatabaseClient } from "./connection.mjs";

const expectedTables = [
  "action_items",
  "affiliations",
  "ai_runs",
  "capture_sessions",
  "events",
  "feedback",
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

  const [counts] = await sql`
    select
      (select count(*) from public.persons where workspace_id = ${workspaceId}) as people,
      (select count(*) from public.organizations where workspace_id = ${workspaceId}) as organizations,
      (select count(*) from public.interactions where workspace_id = ${workspaceId}) as interactions,
      (select count(*) from public.memory_statements where workspace_id = ${workspaceId}) as memories,
      (select count(*) from public.action_items where workspace_id = ${workspaceId}) as actions,
      (select count(*) from public.memory_documents where workspace_id = ${workspaceId}) as documents
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

  await sql`select app_private.rebuild_memory_documents(${workspaceId}::uuid)`;

  const [rebuilt] = await sql`
    select count(*) as documents
    from public.memory_documents
    where workspace_id = ${workspaceId}
  `;
  assert(
    toCount(rebuilt.documents) === toCount(counts.people),
    "Derived memory documents were not rebuilt for every person.",
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
