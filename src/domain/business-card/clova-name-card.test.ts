import { describe, expect, it } from "vitest";

import {
  ClovaNameCardResponseError,
  extractClovaNameCard,
} from "./clova-name-card";

function item(text: string) {
  return { text, confidenceScore: 0.99 };
}

function field(text: string, lineBreak = true, height = 30) {
  return {
    inferText: text,
    lineBreak,
    inferConfidence: 0.99,
    boundingPoly: {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: height },
        { x: 0, y: height },
      ],
    },
  };
}

describe("CLOVA business card response", () => {
  it("maps the provider response to the strict Persnapse extraction", () => {
    const extraction = extractClovaNameCard({
      version: "V2",
      images: [
        {
          inferResult: "SUCCESS",
          message: "SUCCESS",
          nameCard: {
            meta: { estimatedLanguage: "ko" },
            result: {
              name: [item(" 김 하늘 ")],
              company: [item("Persnapse Labs")],
              position: [item("Product Lead")],
              department: [item("Product")],
              mobile: [item("010-1234-5678")],
              tel: [item("02-123-4567"), item("010-1234-5678")],
              email: [item("haneul@example.com")],
              homepage: [item("persnapse.example")],
              address: [item("서울특별시"), item("강남구 테헤란로 1")],
              fax: [item("02-999-9999")],
            },
          },
        },
      ],
    });

    expect(extraction).toEqual({
      schemaVersion: "business-card-extraction-v1",
      identity: {
        displayName: "김 하늘",
        organizationName: "Persnapse Labs",
        title: "Product Lead",
        department: "Product",
        emails: ["haneul@example.com"],
        phones: ["010-1234-5678", "02-123-4567"],
        contactNumbers: [
          { type: "mobile", value: "010-1234-5678", rawLabel: null },
          { type: "phone", value: "02-123-4567", rawLabel: null },
          { type: "phone", value: "010-1234-5678", rawLabel: null },
          { type: "fax", value: "02-999-9999", rawLabel: null },
        ],
        websites: ["persnapse.example"],
        address: "서울특별시 강남구 테헤란로 1",
      },
      observedFields: [
        "identity.displayName",
        "identity.organizationName",
        "identity.title",
        "identity.department",
        "identity.emails",
        "identity.phones",
        "identity.contactNumbers",
        "identity.websites",
        "identity.address",
      ],
    });
  });

  it("maps General OCR lines when Document OCR is not enabled", () => {
    const extraction = extractClovaNameCard({
      version: "V2",
      images: [
        {
          inferResult: "SUCCESS",
          fields: [
            field("PERSNAPSE LABS", true, 35),
            field("김하늘", true, 70),
            field("Product Lead", false, 34),
            field("·", false, 34),
            field("Product Team", true, 34),
            field("M", false),
            field("010-1234-5678"),
            field("E", false),
            field("haneul.kim@example.com"),
            field("W", false),
            field("www.persnapse.example"),
            field("A", false),
            field("서울특별시 강남구 테헤란로 123"),
          ],
        },
      ],
    });

    expect(extraction.identity).toMatchObject({
      displayName: "김하늘",
      organizationName: "PERSNAPSE LABS",
      title: "Product Lead",
      department: "Product Team",
      emails: ["haneul.kim@example.com"],
      phones: ["010-1234-5678"],
      contactNumbers: [
        { type: "mobile", value: "010-1234-5678", rawLabel: "M" },
      ],
      websites: ["www.persnapse.example"],
      address: "서울특별시 강남구 테헤란로 123",
    });
  });

  it("retains a fax-only card and does not turn it into a phone number", () => {
    const extraction = extractClovaNameCard({
      images: [
        {
          inferResult: "SUCCESS",
          nameCard: { result: { fax: [item("02-999-9999")] } },
        },
      ],
    });
    expect(extraction.identity.phones).toEqual([]);
    expect(extraction.identity.contactNumbers).toEqual([
      { type: "fax", value: "02-999-9999", rawLabel: null },
    ]);
  });

  it("classifies General OCR labels individually on the same row", () => {
    const extraction = extractClovaNameCard({
      images: [
        {
          inferResult: "SUCCESS",
          fields: [
            field("Tel", false),
            field("02-111-2222", false),
            field("Fax", false),
            field("02-333-4444"),
            field("H.P.", false),
            field("010-5555-6666"),
          ],
        },
      ],
    });
    expect(
      extraction.identity.contactNumbers?.map((number) => number.type),
    ).toEqual(["phone", "fax", "mobile"]);
    expect(extraction.identity.phones).toEqual([
      "02-111-2222",
      "010-5555-6666",
    ]);
  });

  it("classifies provider processing errors as retryable", () => {
    expect(() =>
      extractClovaNameCard({ images: [{ inferResult: "ERROR" }] }),
    ).toThrow(
      expect.objectContaining<Partial<ClovaNameCardResponseError>>({
        code: "CLOVA_INFERENCE_ERROR",
        retryable: true,
      }),
    );
  });

  it("rejects successful responses that contain no usable fields", () => {
    expect(() =>
      extractClovaNameCard({
        images: [
          {
            inferResult: "SUCCESS",
            nameCard: { result: {} },
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining<Partial<ClovaNameCardResponseError>>({
        code: "CLOVA_NO_FIELDS_DETECTED",
        retryable: false,
      }),
    );
  });
});

it("does not assign a large ambiguous company word as the person's name", () => {
  const extraction = extractClovaNameCard({
    images: [
      {
        inferResult: "SUCCESS",
        fields: [
          field("가온빛", true, 70),
          field("김가람", true, 40),
          field("제품 책임", true, 25),
          field("garam@example.com", true, 20),
        ],
      },
    ],
  });
  expect(extraction.identity.displayName).toBeNull();
  expect(extraction.identity.organizationName).toBeNull();
  expect(extraction.identity.emails).toEqual(["garam@example.com"]);
});
