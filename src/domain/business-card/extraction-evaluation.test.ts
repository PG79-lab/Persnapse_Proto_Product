import { describe, expect, it } from "vitest";

import { evaluateBusinessCardExtraction } from "./extraction-evaluation";

const expected = {
  displayName: "김하늘",
  organizationName: "Persnapse Labs",
  title: "Product Lead",
  department: null,
  emails: ["haneul@example.com"],
  phones: ["010-1234-5678"],
  websites: [],
  address: null,
};

describe("business card extraction evaluation", () => {
  it("counts changed critical fields and invented contact details", () => {
    const result = evaluateBusinessCardExtraction(expected, {
      ...expected,
      displayName: "김하늘님",
      emails: ["haneul@example.com", "other@example.com"],
      phones: ["01012345678"],
    });

    expect(result.presentFields).toBe(5);
    expect(result.matchedPresentFields).toBe(3);
    expect(result.correctionFields).toBe(2);
    expect(result.falsePositiveFields).toBe(0);
  });

  it("counts a value invented for a field absent from the card", () => {
    const result = evaluateBusinessCardExtraction(
      { ...expected, title: null },
      expected,
    );
    expect(result.falsePositiveFields).toBe(1);
    expect(result.correctionFields).toBe(1);
  });
});
