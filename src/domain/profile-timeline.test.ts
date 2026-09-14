import { describe, expect, it } from "vitest";

import type { MemoryStatement, PersonInteraction } from "../server/db/types";
import { buildProfileTimeline } from "./profile-timeline";

const interaction: PersonInteraction = {
  id: "interaction-1",
  interactionType: "meeting",
  occurredAt: "2026-09-01T00:00:00.000Z",
  location: null,
  summary: "미팅",
  sourceKind: "manual",
  verificationStatus: "confirmed",
  eventName: null,
  topics: [],
};

function memory(
  id: string,
  occurredAt: string,
  interactionId: string | null,
): MemoryStatement {
  return {
    id,
    interactionId,
    statementType: "context",
    body: id,
    occurredAt,
    sourceKind: "manual",
    verificationStatus: "confirmed",
    sourceRef: null,
    confidence: null,
  };
}

describe("profile timeline", () => {
  it("groups interaction evidence and sorts standalone memories newest first", () => {
    const timeline = buildProfileTimeline(
      [interaction],
      [
        memory("linked", "2026-09-01T00:00:00.000Z", "interaction-1"),
        memory("standalone", "2026-09-02T00:00:00.000Z", null),
      ],
    );

    expect(timeline.map((item) => item.id)).toEqual([
      "standalone",
      "interaction-1",
    ]);
    expect(timeline[1]?.kind).toBe("interaction");

    if (timeline[1]?.kind === "interaction") {
      expect(timeline[1].memories.map((item) => item.id)).toEqual(["linked"]);
    }
  });
});
