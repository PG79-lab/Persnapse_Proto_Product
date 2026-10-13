import { describe, expect, it } from "vitest";

import {
  businessCardDraftToCaptureDraft,
  extractionToBusinessCardDraft,
  mergeBusinessCardContext,
  businessCardDraftV1Schema,
  parseBusinessCardIdentity,
} from "./business-card-draft";
import { extractBusinessCardMock } from "./mock-ocr";

describe("business card draft", () => {
  it("persists typed numbers and recomputes the legacy phone list without fax", () => {
    const card = extractionToBusinessCardDraft(
      extractBusinessCardMock({ filename: "card.jpg", sha256: "abc" }),
      "2026-10-12T00:00:00Z",
    );
    const parsed = businessCardDraftV1Schema.parse({
      ...card,
      identity: {
        ...card.identity,
        phones: ["02-999-9999"],
        contactNumbers: [
          { type: "fax", value: "02-999-9999", rawLabel: "Fax" },
          { type: "mobile", value: "010-1234-5678", rawLabel: "HP" },
        ],
      },
    });
    expect(parsed.identity.phones).toEqual(["010-1234-5678"]);
    expect(
      businessCardDraftV1Schema.parse(JSON.parse(JSON.stringify(parsed)))
        .identity.contactNumbers,
    ).toEqual(parsed.identity.contactNumbers);
    expect(parseBusinessCardIdentity(JSON.stringify(parsed.identity))).toEqual(
      parsed.identity,
    );
    expect(parseBusinessCardIdentity("invalid JSON")).toBeNull();
  });
  it("keeps mock extraction deterministic and editable", () => {
    const first = extractBusinessCardMock({
      filename: "card.jpg",
      sha256: "abc",
    });
    const second = extractBusinessCardMock({
      filename: "card.jpg",
      sha256: "abc",
    });

    expect(first).toEqual(second);
    expect(first.identity.emails.length).toBeGreaterThan(0);
  });

  it("combines observed card identity with structured relationship context", () => {
    const extraction = extractBusinessCardMock({
      filename: "card.jpg",
      sha256: "abc",
    });
    const card = extractionToBusinessCardDraft(
      extraction,
      "2026-09-15T12:00:00+09:00",
    );
    const merged = mergeBusinessCardContext(card, {
      schemaVersion: "capture-draft-v1",
      identityHint: {
        displayName: "다른 이름",
        organizationName: null,
        title: null,
      },
      interaction: {
        interactionType: "event",
        occurredAt: "2026-09-15T12:00:00+09:00",
        summary: "AI 행사에서 후속 미팅을 논의했다.",
        location: "코엑스",
        eventName: "AI Summit",
      },
      topics: ["AI Agent"],
      memories: [],
      actions: [],
      inferredFields: ["identityHint.displayName", "topics"],
    });

    expect(merged.identity).toEqual(card.identity);
    expect(merged.interaction.eventName).toBe("AI Summit");
    expect(merged.inferredFields).toEqual(["topics"]);
    expect(
      businessCardDraftToCaptureDraft(merged).identityHint.displayName,
    ).toBe(card.identity.displayName);
  });
});
