import type { MemoryStatement, PersonInteraction } from "../server/db/types";

export type ProfileTimelineItem =
  | {
      id: string;
      kind: "interaction";
      occurredAt: string | null;
      interaction: PersonInteraction;
      memories: MemoryStatement[];
    }
  | {
      id: string;
      kind: "memory";
      occurredAt: string | null;
      memory: MemoryStatement;
    };

export function buildProfileTimeline(
  interactions: PersonInteraction[],
  memories: MemoryStatement[],
): ProfileTimelineItem[] {
  const memoriesByInteraction = new Map<string, MemoryStatement[]>();

  for (const memory of memories) {
    if (!memory.interactionId) {
      continue;
    }

    const grouped = memoriesByInteraction.get(memory.interactionId) ?? [];
    grouped.push(memory);
    memoriesByInteraction.set(memory.interactionId, grouped);
  }

  const interactionItems: ProfileTimelineItem[] = interactions.map(
    (interaction) => ({
      id: interaction.id,
      kind: "interaction",
      occurredAt: interaction.occurredAt,
      interaction,
      memories: memoriesByInteraction.get(interaction.id) ?? [],
    }),
  );
  const standaloneMemoryItems: ProfileTimelineItem[] = memories
    .filter((memory) => !memory.interactionId)
    .map((memory) => ({
      id: memory.id,
      kind: "memory",
      occurredAt: memory.occurredAt,
      memory,
    }));

  return [...interactionItems, ...standaloneMemoryItems].sort(
    (left, right) =>
      (right.occurredAt ? new Date(right.occurredAt).getTime() : -Infinity) -
      (left.occurredAt ? new Date(left.occurredAt).getTime() : -Infinity),
  );
}
