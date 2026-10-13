import { describe, expect, it } from "vitest";

import {
  classifyContactNumberLabel,
  extractContactNumbersFromLines,
  getContactNumbers,
  normalizeContactNumbers,
  voicePhoneValues,
} from "./contact-numbers";

describe("business card contact number classification", () => {
  it.each([
    ["Tel.", "phone"],
    ["T:", "phone"],
    ["Phone", "phone"],
    ["직통", "phone"],
    ["Mobile", "mobile"],
    ["M.", "mobile"],
    ["HP", "mobile"],
    ["H.P.", "mobile"],
    ["H/P", "mobile"],
    ["Cell", "mobile"],
    ["휴대폰", "mobile"],
    ["ＨＰ", "mobile"],
    ["Fax", "fax"],
    ["F.", "fax"],
    ["팩스", "fax"],
    [null, "unknown"],
    ["Tel/Fax", "unknown"],
    ["T/F", "unknown"],
    ["전화/팩스", "unknown"],
    ["SMS", "unknown"],
  ])("classifies the printed label %s as %s", (label, type) => {
    expect(classifyContactNumberLabel(label)).toBe(type);
  });

  it("uses the label instead of the number prefix, including fax and international extensions", () => {
    expect(
      extractContactNumbersFromLines([
        "Tel: 010-1111-2222 | Fax: 010-3333-4444",
        "HP. 02-555-6666",
        "Mobile: +82 10 7777 8888 ext. 123",
        "010-9999-0000",
      ]),
    ).toEqual([
      { type: "phone", value: "010-1111-2222", rawLabel: "Tel" },
      { type: "fax", value: "010-3333-4444", rawLabel: "Fax" },
      { type: "mobile", value: "02-555-6666", rawLabel: "HP" },
      {
        type: "mobile",
        value: "+82 10 7777 8888 ext. 123",
        rawLabel: "Mobile",
      },
      { type: "unknown", value: "010-9999-0000", rawLabel: null },
    ]);
  });

  it("pairs only an immediately preceding standalone label, and retains ambiguous labels", () => {
    expect(
      extractContactNumbersFromLines([
        "H.P.",
        "010-1234-5678",
        "F",
        "example@example.com",
        "02-123-4567",
        "Tel/Fax: 02-999-0000",
      ]),
    ).toEqual([
      { type: "mobile", value: "010-1234-5678", rawLabel: "H.P." },
      { type: "unknown", value: "02-123-4567", rawLabel: null },
      { type: "unknown", value: "02-999-0000", rawLabel: "Tel/Fax" },
    ]);
  });

  it("preserves two explicit types for the same digits and excludes fax from voice phone values", () => {
    const numbers = normalizeContactNumbers([
      { type: "phone", value: "02-123-4567", rawLabel: "Tel" },
      { type: "phone", value: "021234567", rawLabel: "T" },
      { type: "fax", value: "02-123-4567", rawLabel: "Fax" },
      { type: "unknown", value: "02-123-4567", rawLabel: null },
      { type: "fax", value: "02-555-6666", rawLabel: "F" },
    ]);
    expect(numbers).toHaveLength(3);
    expect(voicePhoneValues(numbers)).toEqual(["02-123-4567"]);
  });

  it("reads old phone-only cards without guessing their type", () => {
    expect(getContactNumbers({ phones: ["010-1234-5678"] })).toEqual([
      { type: "unknown", value: "010-1234-5678", rawLabel: null },
    ]);
  });
  it("preserves parentheses and ignores explicitly labelled registration/account numbers", () => {
    expect(
      extractContactNumbersFromLines([
        "Tel: (02) 1234-5678",
        "사업자등록번호: 123-45-67890",
        "Account: 123-456-789012",
      ]),
    ).toEqual([{ type: "phone", value: "(02) 1234-5678", rawLabel: "Tel" }]);
  });
});
