import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOpenAiBusinessCardAdapter,
  normalizeVisionBusinessCardIdentity,
} from "./openai-business-card-adapter";
import { businessCardExtractionV1Schema } from "../../domain/business-card/business-card-draft";

const input = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  filename: "card.png",
  mimeType: "image/png",
  sha256: "abcdef1234567890",
};

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI vision business card candidate", () => {
  it("sends the image with strict structured output and keeps the key in the header", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  displayName: "김하늘",
                  organizationName: "Persnapse Labs",
                  title: null,
                  department: null,
                  emails: ["haneul@example.com"],
                  contactNumbers: [
                    { type: "mobile", value: "010-1234-5678", rawLabel: "HP" },
                    { type: "fax", value: "02-123-4567", rawLabel: "Fax" },
                  ],
                  websites: [],
                  address: null,
                }),
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const extraction = businessCardExtractionV1Schema.parse(
      await createOpenAiBusinessCardAdapter("test-secret").execute({
        input,
        model: "gpt-5-mini",
        signal: new AbortController().signal,
      }),
    );

    expect(extraction.identity.displayName).toBe("김하늘");
    expect(extraction.identity.emails).toEqual(["haneul@example.com"]);
    expect(extraction.identity.phones).toEqual(["010-1234-5678"]);
    expect(extraction.identity.contactNumbers).toEqual([
      { type: "mobile", value: "010-1234-5678", rawLabel: "HP" },
      { type: "fax", value: "02-123-4567", rawLabel: "Fax" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
    const body = JSON.parse(String(init.body)) as {
      store: boolean;
      input: Array<{ content: Array<{ type: string; detail?: string }> }>;
      text: {
        format: {
          strict: boolean;
          schema: {
            properties: {
              contactNumbers: {
                items: { required: string[]; additionalProperties: boolean };
              };
            };
          };
        };
      };
    };
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(
      body.text.format.schema.properties.contactNumbers.items.required,
    ).toEqual(["type", "value", "rawLabel"]);
    expect(
      body.text.format.schema.properties.contactNumbers.items
        .additionalProperties,
    ).toBe(false);
    expect(body.input[0]?.content[1]).toMatchObject({
      type: "input_image",
      detail: "original",
    });
    expect(String(init.body)).not.toContain("test-secret");
  });

  it("corrects a contradictory model type by the printed label and leaves unlabelled numbers unknown", () => {
    const extraction = normalizeVisionBusinessCardIdentity({
      displayName: null,
      organizationName: null,
      title: null,
      department: null,
      emails: [],
      websites: [],
      address: null,
      contactNumbers: [
        { type: "phone", value: "010-1111-2222", rawLabel: "Fax" },
        { type: "phone", value: "02-333-4444", rawLabel: "H.P." },
        { type: "mobile", value: "010-5555-6666", rawLabel: null },
        { type: "fax", value: "02-777-8888", rawLabel: "Tel/Fax" },
      ],
    });
    expect(
      extraction.identity.contactNumbers?.map((number) => number.type),
    ).toEqual(["fax", "mobile", "unknown", "unknown"]);
    expect(extraction.identity.phones).not.toContain("010-1111-2222");
  });

  it("rejects an invalid structured response without leaking its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ output: [] })),
    );
    await expect(
      createOpenAiBusinessCardAdapter("test-secret").execute({
        input,
        model: "gpt-5-mini",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "OPENAI_OUTPUT_TEXT_MISSING" });
  });
});
