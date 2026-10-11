import { lookup } from "node:dns/promises";
import { readdirSync } from "node:fs";
import { createDatabaseClient } from "./connection.mjs";

// Read-only connectivity/schema checks. No seed, migration, indexing or AI calls.
const report = {
  checkedAt: new Date().toISOString(),
  ready: false,
  readOnly: true,
  paidCalls: 0,
};
let sql;
function failureCode(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (/tenant[ /]user.*not found|tenant or user not found/.test(message))
    return "SUPABASE_TENANT_NOT_FOUND";
  if (error?.code === "ENOTFOUND") return "DNS_NOT_FOUND";
  if (error?.code === "28P01") return "DATABASE_AUTHENTICATION_FAILED";
  if (/timeout/.test(message)) return "CONNECTION_TIMEOUT";
  return "DATABASE_CHECK_FAILED";
}
try {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const database = new URL(process.env.DATABASE_URL);
  const ref = project.hostname.split(".")[0];
  const managed = project.hostname.endsWith(".supabase.co");
  report.configuration = {
    projectReferenceConsistent: managed
      ? database.username.endsWith(`.${ref}`) ||
        database.hostname === `db.${project.hostname}`
      : null,
    credentialsPresent: Object.fromEntries(
      [
        "SUPABASE_SECRET_KEY",
        "OPENAI_API_KEY",
        "VOYAGE_API_KEY",
        "CLOVA_OCR_SECRET",
      ].map((name) => [name, Boolean(process.env[name])]),
    ),
    aiMode: process.env.AI_ROUTING_MODE || "mock",
    ocrMode: process.env.BUSINESS_CARD_OCR_MODE || "mock",
  };
  report.dns = {};
  await Promise.all(
    [
      ["project", project.hostname],
      ["database", database.hostname],
    ].map(async ([name, host]) => {
      try {
        await lookup(host);
        report.dns[name] = "resolved";
      } catch (error) {
        report.dns[name] =
          error.code === "ENOTFOUND" ? "DNS_NOT_FOUND" : "DNS_FAILED";
      }
    }),
  );
  sql = createDatabaseClient();
  await sql`select 1`;
  report.database = { connected: true };
  await sql.begin(async (transaction) => {
    await transaction`set transaction read only`;
    await transaction`set local statement_timeout = '10000ms'`;
    const tables =
      await transaction`select c.relname as name, c.relrowsecurity as rls from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`;
    const required = [
      "workspaces",
      "persons",
      "interactions",
      "memory_statements",
      "action_items",
      "memory_documents",
      "capture_sessions",
      "business_cards",
      "ai_call_reservations",
      "ocr_provider_calls",
    ];
    report.schema = {
      missingTables: required.filter(
        (name) => !tables.some((table) => table.name === name),
      ),
      rlsDisabled: tables
        .filter((table) => !table.rls)
        .map((table) => table.name),
    };
    if (report.schema.missingTables.length) return;
    const workspaceId = process.env.APP_DEFAULT_WORKSPACE_ID;
    const [workspace] =
      await transaction`select exists(select 1 from public.workspaces where id=${workspaceId}::uuid) as present`;
    report.database.workspacePresent = workspace.present;
    const [counts] = await transaction`select
      (select count(*)::int from public.persons where workspace_id=${workspaceId}::uuid) as people,
      (select count(*)::int from public.interactions where workspace_id=${workspaceId}::uuid) as interactions,
      (select count(*)::int from public.business_cards where workspace_id=${workspaceId}::uuid) as businessCards`;
    report.database.counts = counts;
    const [preparation] = await transaction`select count(*)::int as total,
      count(*) filter (where doc.embedding_status='ready' and doc.embedding is not null and doc.embedding_model=${process.env.VOYAGE_EMBEDDING_MODEL || "voyage-4"})::int as prepared
      from public.persons person left join public.memory_documents doc on doc.workspace_id=person.workspace_id and doc.person_id=person.id and doc.document_kind='person_profile' where person.workspace_id=${workspaceId}::uuid`;
    report.search = {
      ...preparation,
      remaining: preparation.total - preparation.prepared,
    };
    const migrations =
      await transaction`select version from supabase_migrations.schema_migrations`;
    report.schema.pendingMigrations = readdirSync("supabase/migrations").filter(
      (name) =>
        name.endsWith(".sql") &&
        !migrations.some((row) => row.version === name.split("_")[0]),
    );
    const buckets =
      await transaction`select public from storage.buckets where id='business-card-assets'`;
    report.storage = {
      businessCardBucketPrivate:
        buckets.length === 1 && buckets[0].public === false,
    };
    report.ready =
      report.dns.project === "resolved" &&
      report.database.workspacePresent &&
      report.configuration.projectReferenceConsistent !== false &&
      !report.schema.rlsDisabled.length &&
      !report.schema.pendingMigrations.length &&
      report.storage.businessCardBucketPrivate;
  });
} catch (error) {
  report.error = failureCode(error);
  report.database ??= { connected: false };
} finally {
  await sql?.end({ timeout: 2 }).catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
