import "server-only";

import type {
  RecallCorpusAction,
  RecallCorpusEvidence,
  RecallCorpusPerson,
  RecallResponse,
} from "../../domain/recall/types";
import { getDatabase } from "./client";

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export async function loadRecallCorpus(
  workspaceId: string,
  personIds?: string[],
): Promise<RecallCorpusPerson[]> {
  const sql = getDatabase();
  const [peopleRows, memoryRows, interactionRows, actionRows] =
    await Promise.all([
      sql<
        Array<{
          id: string;
          display_name: string;
          normalized_name: string;
          headline: string | null;
          organizations: string[] | null;
          document_id: string | null;
          document_content: string | null;
        }>
      >`
        select
          person.id,
          person.display_name,
          person.normalized_name,
          person.headline,
          coalesce(affiliation_list.organizations, array[]::text[]) as organizations,
          document.id as document_id,
          document.content as document_content
        from public.persons person
        left join lateral (
          select array_agg(
            organization.name || coalesce(' · ' || affiliation.title, '')
            order by affiliation.is_current desc, organization.name
          ) as organizations
          from public.affiliations affiliation
          join public.organizations organization
            on organization.workspace_id = affiliation.workspace_id
           and organization.id = affiliation.organization_id
          where affiliation.workspace_id = person.workspace_id
            and affiliation.person_id = person.id
            and affiliation.verification_status = 'confirmed'
        ) affiliation_list on true
        left join public.memory_documents document
          on document.workspace_id = person.workspace_id
         and document.person_id = person.id
         and document.document_kind = 'person_profile'
        where person.workspace_id = ${workspaceId}
          and (${personIds === undefined} or person.id = any(${personIds ?? []}::uuid[]))
        order by person.display_name, person.id
      `,
      sql<
        Array<{
          id: string;
          person_id: string;
          body: string;
          interaction_id: string | null;
          occurred_at: Date | string | null;
        }>
      >`
        select id, person_id, body, occurred_at, interaction_id
        from public.memory_statements
        where workspace_id = ${workspaceId}
          and person_id is not null
          and (${personIds === undefined} or person_id = any(${personIds ?? []}::uuid[]))
          and verification_status = 'confirmed'
        order by occurred_at desc nulls last
      `,
      sql<
        Array<{
          id: string;
          person_id: string;
          occurred_at: Date | string | null;
          summary: string;
          location: string | null;
          event_name: string | null;
          topics: string[] | null;
        }>
      >`
        select
          interaction.id,
          participant.person_id,
          interaction.occurred_at,
          interaction.summary,
          interaction.location,
          event.name as event_name,
          coalesce(topic_list.topics, array[]::text[]) as topics
        from public.interaction_participants participant
        join public.interactions interaction
          on interaction.workspace_id = participant.workspace_id
         and interaction.id = participant.interaction_id
        left join public.events event
          on event.workspace_id = interaction.workspace_id
         and event.id = interaction.event_id
        left join lateral (
          select array_agg(topic.name order by topic.name) as topics
          from public.interaction_topics interaction_topic
          join public.topics topic
            on topic.workspace_id = interaction_topic.workspace_id
           and topic.id = interaction_topic.topic_id
          where interaction_topic.workspace_id = interaction.workspace_id
            and interaction_topic.interaction_id = interaction.id
            and interaction_topic.verification_status = 'confirmed'
        ) topic_list on true
        where participant.workspace_id = ${workspaceId}
          and (${personIds === undefined} or participant.person_id = any(${personIds ?? []}::uuid[]))
          and interaction.verification_status = 'confirmed'
        order by interaction.occurred_at desc
      `,
      sql<
        Array<{
          id: string;
          person_id: string;
          title: string;
          details: string | null;
          status: "pending" | "completed" | "dismissed";
          due_at: Date | string | null;
          interaction_id: string | null;
          occurred_at: Date | string | null;
        }>
      >`
        select
          action.id,
          action.person_id,
          action.title,
          action.details,
          action.status,
          action.due_at,
          action.interaction_id,
          interaction.occurred_at
        from public.action_items action
        left join public.interactions interaction
          on interaction.workspace_id = action.workspace_id
         and interaction.id = action.interaction_id
        where action.workspace_id = ${workspaceId}
          and (${personIds === undefined} or action.person_id = any(${personIds ?? []}::uuid[]))
          and action.verification_status = 'confirmed'
          and action.status <> 'dismissed'
        order by (action.status = 'pending') desc, action.due_at asc nulls last
      `,
    ]);

  const corpus = new Map<string, RecallCorpusPerson>();

  for (const row of peopleRows) {
    const identityText = [
      row.display_name,
      row.headline,
      ...(row.organizations ?? []),
    ]
      .filter(Boolean)
      .join(" · ");
    const identityEvidence: RecallCorpusEvidence = {
      id: row.document_id ?? row.id,
      type: "person_profile",
      text: identityText,
      occurredAt: null,
      verificationStatus: "confirmed",
      memoryStatementId: null,
      memoryDocumentId: row.document_id,
      actionStatus: null,
    };

    corpus.set(row.id, {
      id: row.id,
      displayName: row.display_name,
      normalizedName: row.normalized_name,
      headline: row.headline,
      organizations: row.organizations ?? [],
      documentId: row.document_id,
      documentContent: row.document_content ?? identityText,
      evidence: [identityEvidence],
      actions: [],
    });
  }

  for (const row of memoryRows) {
    corpus.get(row.person_id)?.evidence.push({
      id: row.id,
      type: "memory_statement",
      interactionId: row.interaction_id,
      text: row.body,
      occurredAt: toIsoString(row.occurred_at),
      verificationStatus: "confirmed",
      memoryStatementId: row.id,
      memoryDocumentId: null,
      actionStatus: null,
    });
  }

  for (const row of interactionRows) {
    const context = [
      row.event_name,
      row.location,
      row.summary,
      ...(row.topics ?? []).map((topic) => `#${topic}`),
    ]
      .filter(Boolean)
      .join(" · ");

    corpus.get(row.person_id)?.evidence.push({
      id: row.id,
      type: "interaction",
      interactionId: row.id,
      location: row.location,
      eventName: row.event_name,
      topics: row.topics ?? [],
      text: context,
      occurredAt: toIsoString(row.occurred_at),
      verificationStatus: "confirmed",
      memoryStatementId: null,
      memoryDocumentId: null,
      actionStatus: null,
    });
  }

  for (const row of actionRows) {
    const action: RecallCorpusAction = {
      id: row.id,
      title: row.title,
      interactionId: row.interaction_id,
      details: row.details,
      dueAt: toIsoString(row.due_at),
      status: row.status,
    };
    const person = corpus.get(row.person_id);

    person?.actions.push(action);
    person?.evidence.push({
      id: row.id,
      type: "action_item",
      interactionId: row.interaction_id,
      dueAt: toIsoString(row.due_at),
      text: [row.title, row.details].filter(Boolean).join(" · "),
      occurredAt: toIsoString(row.occurred_at),
      verificationStatus: "confirmed",
      memoryStatementId: null,
      memoryDocumentId: null,
      actionStatus: row.status,
    });
  }

  return [...corpus.values()];
}

export interface GoldenQueryCase {
  id: string;
  category: string;
  label: string;
  queryText: string;
  referenceTime: string;
  expectationStatus: "resolved" | "ambiguous" | "no_result";
  expectedPersonIds: string[];
  expectedEvidenceIds: string[];
}

export async function listGoldenQueryCases(
  workspaceId: string,
): Promise<GoldenQueryCase[]> {
  const sql = getDatabase();
  const rows = await sql<
    Array<{
      id: string;
      category: string;
      label: string;
      query_text: string;
      reference_time: Date | string;
      expectation_status: "resolved" | "ambiguous" | "no_result";
      expected_person_ids: string[];
      expected_evidence_ids: string[];
    }>
  >`
    select
      id,
      category,
      label,
      query_text,
      reference_time,
      expectation_status,
      expected_person_ids,
      expected_evidence_ids
    from public.golden_query_cases
    where workspace_id = ${workspaceId}
      and is_active = true
    order by category, label
  `;

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    label: row.label,
    queryText: row.query_text,
    referenceTime: toIsoString(row.reference_time)!,
    expectationStatus: row.expectation_status,
    expectedPersonIds: row.expected_person_ids,
    expectedEvidenceIds: row.expected_evidence_ids,
  }));
}

export async function recordRecallResponse(input: {
  workspaceId: string;
  queryText: string;
  referenceTime: Date;
  evaluationCaseId?: string;
  response: RecallResponse;
}): Promise<string> {
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const [aiRun] = await transaction<Array<{ id: string }>>`
      insert into public.ai_runs (
        workspace_id,
        task,
        provider,
        model,
        status,
        schema_version,
        latency_ms,
        completed_at
      )
      values (
        ${input.workspaceId},
        'recall',
        ${input.response.mode === "live" ? "openai" : "local"},
        ${input.response.model},
        ${input.response.mode === "live" ? "succeeded" : "mocked"},
        'recall-response-v1',
        ${input.response.latencyMs},
        now()
      )
      returning id
    `;
    const [query] = await transaction<Array<{ id: string }>>`
      insert into public.queries (
        workspace_id,
        query_text,
        parsed_query,
        status,
        latency_ms,
        reference_time,
        parser_version,
        retrieval_version,
        evaluation_case_id,
        ai_run_id,
        answer_status,
        answer_text,
        response_payload,
        retrieval_trace,
        completed_at
      )
      values (
        ${input.workspaceId},
        ${input.queryText},
        ${JSON.stringify(input.response.parsedQuery)}::jsonb,
        'completed',
        ${input.response.latencyMs},
        ${input.referenceTime.toISOString()},
        ${input.response.parsedQuery.parserVersion},
        ${input.response.mode === "live" ? "voyage-grounded-v1" : "hybrid-v1"},
        ${input.evaluationCaseId ?? null},
        ${aiRun.id},
        ${input.response.status},
        ${input.response.answer},
        ${JSON.stringify(input.response)}::jsonb,
        ${JSON.stringify({
          candidateLimit: 5,
          confirmedOnly: true,
          mode: input.response.mode,
          model: input.response.model,
        })}::jsonb,
        now()
      )
      returning id
    `;

    for (const [index, result] of input.response.results.entries()) {
      const evidence = result.evidence[0];

      if (!evidence) {
        continue;
      }

      await transaction`
        insert into public.query_evidence (
          workspace_id,
          query_id,
          person_id,
          memory_statement_id,
          memory_document_id,
          rank,
          score,
          reason,
          source_entity_type,
          source_entity_id,
          evidence_excerpt,
          source_occurred_at,
          verification_status
        )
        values (
          ${input.workspaceId},
          ${query.id},
          ${result.personId},
          ${evidence.memoryStatementId},
          ${evidence.memoryDocumentId},
          ${index + 1},
          ${result.score},
          ${result.reason},
          ${evidence.type},
          ${evidence.id},
          ${evidence.excerpt},
          ${evidence.occurredAt},
          'confirmed'
        )
      `;
    }

    return query.id;
  });
}
