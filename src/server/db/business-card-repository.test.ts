// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("./client", () => ({ getDatabase: () => mocks.sql }));

import { extractionToBusinessCardDraft } from "../../domain/business-card/business-card-draft";
import { extractBusinessCardMock } from "../../domain/business-card/mock-ocr";
import { findReusableBusinessCardExtraction } from "./business-card-repository";

const input = {
  workspaceId: "test-workspace",
  captureId: "test-capture",
  imageSha256: "test-hash",
  provider: "openai" as const,
};
const draft = extractionToBusinessCardDraft(
  extractBusinessCardMock({ filename: "synthetic.png", sha256: "test-hash" }),
  "2026-10-12T00:00:00Z",
);
beforeEach(() => vi.resetAllMocks());

describe("business card OCR extraction cache", () => {
  it.each([draft, JSON.stringify(draft)])(
    "reuses a typed extraction stored as JSON or an encoded JSON string",
    async (modelDraft) => {
      mocks.sql.mockResolvedValue([{ model_draft: modelDraft }]);
      const result = await findReusableBusinessCardExtraction(input);
      expect(result?.identity.contactNumbers).toEqual(
        draft.identity.contactNumbers,
      );
    },
  );

  it("does not reuse an old extraction which discarded number types", async () => {
    const legacyIdentity = { ...draft.identity };
    delete legacyIdentity.contactNumbers;
    mocks.sql.mockResolvedValue([
      { model_draft: JSON.stringify({ ...draft, identity: legacyIdentity }) },
    ]);
    expect(await findReusableBusinessCardExtraction(input)).toBeNull();
  });
});
