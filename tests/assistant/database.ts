import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
/** Isolated actual PostgreSQL. Supabase auth/storage shells only; never connects to remote data. */
export async function assistantDatabase() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.query("select 1");
  if (process.env.ASSISTANT_TEST_TRACE) console.error("PG init");
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const dir = "supabase/migrations";
  for (const file of (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (process.env.ASSISTANT_TEST_TRACE) console.error(file);
    try {
      await db.exec(await readFile(`${dir}/${file}`, "utf8"));
    } catch (error) {
      throw new Error(
        `Migration ${file}: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    }
  }
  const makeSql = (executor: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  }) => {
    const sql = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const params = values.map((value) =>
          Array.isArray(value)
            ? "{" +
              value
                .map((v) => '"' + String(v).replaceAll('"', '\\"') + '"')
                .join(",") +
              "}"
            : value,
        );
        return (
          await executor.query(
            strings.reduce(
              (text, part, index) =>
                text + part + (index < values.length ? `$${index + 1}` : ""),
              "",
            ),
            params,
          )
        ).rows;
      },
      {
        json: (value: unknown) => JSON.stringify(value),
        begin: async <T>(
          fn: (sql: ReturnType<typeof makeSql>) => Promise<T>,
        ): Promise<T> => db.transaction(async (tx) => fn(makeSql(tx))),
      },
    );
    return sql;
  };
  return { db, sql: makeSql(db) };
}
export const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  other: "10000000-0000-4000-8000-000000000002",
  minsu: "20000000-0000-4000-8000-000000000001",
  jisu: "20000000-0000-4000-8000-000000000002",
  meeting: "30000000-0000-4000-8000-000000000001",
  memory: "40000000-0000-4000-8000-000000000001",
  action: "50000000-0000-4000-8000-000000000001",
};
export async function seedAssistantDatabase(db: PGlite) {
  await db.exec(`insert into public.workspaces(id,name)values('${ids.workspace}','합성 테스트'),('${ids.other}','다른 작업공간');
    insert into public.persons(id,workspace_id,display_name,normalized_name) values
      ('${ids.minsu}','${ids.workspace}','민수','민수'),('${ids.jisu}','${ids.workspace}','지수','지수');
    insert into public.interactions(id,workspace_id,interaction_type,occurred_at,summary,location,source_kind,verification_status)
      values('${ids.meeting}','${ids.workspace}','meeting','2026-10-09T10:00:00+09:00','전시회에서 AI 도입 논의','서울','manual','confirmed');
    insert into public.interaction_participants(workspace_id,interaction_id,person_id) values
      ('${ids.workspace}','${ids.meeting}','${ids.minsu}'),('${ids.workspace}','${ids.meeting}','${ids.jisu}');
    insert into public.memory_statements(id,workspace_id,person_id,interaction_id,statement_type,body,occurred_at,source_kind,verification_status)
      values('${ids.memory}','${ids.workspace}','${ids.minsu}','${ids.meeting}','interest','양자컴퓨팅과 AI 도입에 관심','2026-10-09T10:00:00+09:00','manual','confirmed');
    insert into public.action_items(id,workspace_id,person_id,interaction_id,kind,title,due_at,source_kind,verification_status)
      values('${ids.action}','${ids.workspace}','${ids.minsu}','${ids.meeting}','commitment','소개서 보내기','2026-10-16T09:00:00+09:00','manual','confirmed');`);
}
