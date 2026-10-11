import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOpenAiBusinessCardAdapter } from "./openai-business-card-adapter";
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
                  phones: ["010-1234-5678"],
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
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
    const body = JSON.parse(String(init.body)) as {
      store: boolean;
      input: Array<{ content: Array<{ type: string; detail?: string }> }>;
      text: { format: { strict: boolean } };
    };
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.input[0]?.content[1]).toMatchObject({
      type: "input_image",
      detail: "original",
    });
    expect(String(init.body)).not.toContain("test-secret");
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
