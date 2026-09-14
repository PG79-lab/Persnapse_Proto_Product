import "server-only";

import { getDatabase } from "./client";
import type {
  MemoryStatement,
  PersonActionItem,
  PersonAffiliation,
  PersonAttribute,
  PersonInteraction,
  PersonProfile,
  PersonSummary,
  VerificationStatus,
} from "./types";

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNumber(value: number | string | null): number {
  return Number(value ?? 0);
}

export async function listPeople(
  workspaceId: string,
): Promise<PersonSummary[]> {
  const sql = getDatabase();
  const rows = await sql<
    Array<{
      id: string;
      display_name: string;
      headline: string | null;
      organization_name: string | null;
      organization_title: string | null;
      interaction_count: number | string;
      pending_action_count: number | string;
      last_interaction_at: Date | string | null;
      matching_name_count: number | string;
    }>
  >`
    select
      p.id,
      p.display_name,
      p.headline,
      current_affiliation.organization_name,
      current_affiliation.organization_title,
      coalesce(interaction_stats.interaction_count, 0) as interaction_count,
      coalesce(action_stats.pending_action_count, 0) as pending_action_count,
      interaction_stats.last_interaction_at,
      count(*) over (partition by p.normalized_name) as matching_name_count
    from public.persons p
    left join lateral (
      select
        o.name as organization_name,
        a.title as organization_title
      from public.affiliations a
      join public.organizations o
        on o.workspace_id = a.workspace_id
       and o.id = a.organization_id
      where a.workspace_id = p.workspace_id
        and a.person_id = p.id
      order by a.is_current desc, a.valid_from desc nulls last
      limit 1
    ) current_affiliation on true
    left join lateral (
      select
        count(*) as interaction_count,
        max(i.occurred_at) as last_interaction_at
      from public.interaction_participants ip
      join public.interactions i
        on i.workspace_id = ip.workspace_id
       and i.id = ip.interaction_id
      where ip.workspace_id = p.workspace_id
        and ip.person_id = p.id
    ) interaction_stats on true
    left join lateral (
      select count(*) as pending_action_count
      from public.action_items action
      where action.workspace_id = p.workspace_id
        and action.person_id = p.id
        and action.status = 'pending'
    ) action_stats on true
    where p.workspace_id = ${workspaceId}
    order by interaction_stats.last_interaction_at desc nulls last, p.display_name
  `;

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    headline: row.headline,
    organizationName: row.organization_name,
    organizationTitle: row.organization_title,
    interactionCount: toNumber(row.interaction_count),
    pendingActionCount: toNumber(row.pending_action_count),
    lastInteractionAt: toIsoString(row.last_interaction_at),
    hasDuplicateName: toNumber(row.matching_name_count) > 1,
  }));
}

export async function getPersonProfile(
  workspaceId: string,
  personId: string,
): Promise<PersonProfile | null> {
  const sql = getDatabase();
  const people = await sql<
    Array<{
      id: string;
      display_name: string;
      headline: string | null;
      notes: string | null;
      matching_name_count: number | string;
    }>
  >`
    select
      p.id,
      p.display_name,
      p.headline,
      p.notes,
      (
        select count(*)
        from public.persons matching
        where matching.workspace_id = p.workspace_id
          and matching.normalized_name = p.normalized_name
      ) as matching_name_count
    from public.persons p
    where p.workspace_id = ${workspaceId}
      and p.id = ${personId}
    limit 1
  `;
  const person = people[0];

  if (!person) {
    return null;
  }

  const [
    affiliationRows,
    attributeRows,
    memoryRows,
    interactionRows,
    actionRows,
  ] = await Promise.all([
    sql<
      Array<{
        id: string;
        organization_name: string;
        title: string | null;
        is_current: boolean;
        verification_status: VerificationStatus;
      }>
    >`
        select a.id, o.name as organization_name, a.title, a.is_current, a.verification_status
        from public.affiliations a
        join public.organizations o
          on o.workspace_id = a.workspace_id
         and o.id = a.organization_id
        where a.workspace_id = ${workspaceId}
          and a.person_id = ${personId}
        order by a.is_current desc, a.valid_from desc nulls last
      `,
    sql<
      Array<{
        id: string;
        kind: string;
        value: string;
        verification_status: VerificationStatus;
      }>
    >`
        select id, kind, value, verification_status
        from public.person_attributes
        where workspace_id = ${workspaceId}
          and person_id = ${personId}
        order by kind, created_at
      `,
    sql<
      Array<{
        id: string;
        interaction_id: string | null;
        statement_type: string;
        body: string;
        occurred_at: Date | string | null;
        source_kind: string;
        verification_status: VerificationStatus;
        source_ref: string | null;
        confidence: number | string | null;
      }>
    >`
        select
          memory.id,
          memory.interaction_id,
          memory.statement_type,
          memory.body,
          memory.occurred_at,
          memory.source_kind,
          memory.verification_status,
          provenance.source_ref,
          provenance.confidence
        from public.memory_statements memory
        left join lateral (
          select source_ref, confidence
          from public.provenance_records provenance
          where provenance.workspace_id = memory.workspace_id
            and provenance.entity_type = 'memory_statement'
            and provenance.entity_id = memory.id
          order by provenance.captured_at desc
          limit 1
        ) provenance on true
        where memory.workspace_id = ${workspaceId}
          and memory.person_id = ${personId}
          and memory.verification_status <> 'rejected'
        order by memory.occurred_at desc nulls last, memory.created_at desc
      `,
    sql<
      Array<{
        id: string;
        interaction_type: string;
        occurred_at: Date | string;
        location: string | null;
        summary: string;
        source_kind: string;
        verification_status: VerificationStatus;
        event_name: string | null;
        topics: string[] | null;
      }>
    >`
        select
          interaction.id,
          interaction.interaction_type,
          interaction.occurred_at,
          interaction.location,
          interaction.summary,
          interaction.source_kind,
          interaction.verification_status,
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
        ) topic_list on true
        where participant.workspace_id = ${workspaceId}
          and participant.person_id = ${personId}
          and interaction.verification_status <> 'rejected'
        order by interaction.occurred_at desc
      `,
    sql<
      Array<{
        id: string;
        interaction_id: string | null;
        kind: string;
        title: string;
        details: string | null;
        status: "pending" | "completed" | "dismissed";
        due_at: Date | string | null;
        completed_at: Date | string | null;
        source_kind: string;
        verification_status: VerificationStatus;
      }>
    >`
        select
          id,
          interaction_id,
          kind,
          title,
          details,
          status,
          due_at,
          completed_at,
          source_kind,
          verification_status
        from public.action_items
        where workspace_id = ${workspaceId}
          and person_id = ${personId}
        order by (status = 'pending') desc, due_at asc nulls last, created_at desc
      `,
  ]);

  const affiliations: PersonAffiliation[] = affiliationRows.map((row) => ({
    id: row.id,
    organizationName: row.organization_name,
    title: row.title,
    isCurrent: row.is_current,
    verificationStatus: row.verification_status,
  }));
  const attributes: PersonAttribute[] = attributeRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: row.value,
    verificationStatus: row.verification_status,
  }));
  const memories: MemoryStatement[] = memoryRows.map((row) => ({
    id: row.id,
    interactionId: row.interaction_id,
    statementType: row.statement_type,
    body: row.body,
    occurredAt: toIsoString(row.occurred_at),
    sourceKind: row.source_kind,
    verificationStatus: row.verification_status,
    sourceRef: row.source_ref,
    confidence: row.confidence === null ? null : toNumber(row.confidence),
  }));
  const interactions: PersonInteraction[] = interactionRows.map((row) => ({
    id: row.id,
    interactionType: row.interaction_type,
    occurredAt: toIsoString(row.occurred_at)!,
    location: row.location,
    summary: row.summary,
    sourceKind: row.source_kind,
    verificationStatus: row.verification_status,
    eventName: row.event_name,
    topics: row.topics ?? [],
  }));
  const actions: PersonActionItem[] = actionRows.map((row) => ({
    id: row.id,
    interactionId: row.interaction_id,
    kind: row.kind,
    title: row.title,
    details: row.details,
    status: row.status,
    dueAt: toIsoString(row.due_at),
    completedAt: toIsoString(row.completed_at),
    sourceKind: row.source_kind,
    verificationStatus: row.verification_status,
  }));

  return {
    id: person.id,
    displayName: person.display_name,
    headline: person.headline,
    notes: person.notes,
    hasDuplicateName: toNumber(person.matching_name_count) > 1,
    affiliations,
    attributes,
    memories,
    interactions,
    actions,
  };
}
