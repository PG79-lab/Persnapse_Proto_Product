import { describe, expect, it } from "vitest";
import { matchesInferredField } from "./inferred-fields";

describe("live inferred-field labels", () => {
  it("recognizes the explanatory date path observed in a real response", () => {
    expect(
      matchesInferredField(
        "interaction.occurredAt: 날짜만 알려져 Asia/Seoul 자정으로 해석",
        "interaction.occurredAt",
      ),
    ).toBe(true);
  });
  it("recognizes indexed action deadlines in the actions review section", () => {
    expect(
      matchesInferredField("actions[0].dueAt: 내일로 해석", "actions"),
    ).toBe(true);
  });
  it("does not mark unrelated fields as inferred", () => {
    expect(
      matchesInferredField(
        "interaction.occurredAt: 어제로 해석",
        "interaction.location",
      ),
    ).toBe(false);
    expect(
      matchesInferredField(
        "interaction.occurredAtOther",
        "interaction.occurredAt",
      ),
    ).toBe(false);
  });
});
