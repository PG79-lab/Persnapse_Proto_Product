import { expect, it } from "vitest";
import { structureTextCaptureMock } from "./mock-structurer";
it("resolves yesterday against Korean calendar and marks interpretation", () => {
  const result = structureTextCaptureMock({
    rawText: "어제 대전에서 만났다. 양자컴퓨팅에 관심이 있다고 했다.",
    referenceTime: "2026-09-22T03:00:00Z",
  });
  expect(result.interaction.occurredAt).toBe("2026-09-20T15:00:00.000Z");
  expect(result.inferredFields).toContain("interaction.occurredAt");
  // Free-place/topic understanding belongs to the live model; mock remains limited.
  expect(result.interaction.summary).toContain("양자컴퓨팅");
});
it("keeps an unspecified encounter date unknown", () => {
  expect(
    structureTextCaptureMock({
      rawText: "담당자와 프로젝트를 논의했다.",
      referenceTime: "2026-09-22T03:00:00Z",
    }).interaction.occurredAt,
  ).toBeNull();
});
