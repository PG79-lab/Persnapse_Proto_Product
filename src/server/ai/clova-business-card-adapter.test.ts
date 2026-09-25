import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createClovaBusinessCardAdapter } from "./clova-business-card-adapter";

const imageInput = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  filename: "card.png",
  mimeType: "image/png",
  sha256: "abcdef1234567890",
};

function successPayload() {
  return {
    version: "V2",
    images: [
      {
        inferResult: "SUCCESS",
        nameCard: {
          result: {
            name: [{ text: "김하늘" }],
            company: [{ text: "Persnapse Labs" }],
            mobile: [{ text: "010-1234-5678" }],
            email: [{ text: "haneul@example.com" }],
          },
        },
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CLOVA business card adapter", () => {
  it("sends a V2 multipart request without placing the secret in the body", async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return Response.json(successPayload(), { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    const adapter = createClovaBusinessCardAdapter({
      invokeUrl: "https://example.apigw.ntruss.com/general",
      secret: "ocr-secret",
    });

    const extraction = await adapter.execute({
      input: imageInput,
      model: "clova-ocr",
      signal: new AbortController().signal,
    });

    expect(extraction).toMatchObject({
      identity: { displayName: "김하늘", organizationName: "Persnapse Labs" },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(
      "https://example.apigw.ntruss.com/general",
    );
    const init = request.mock.calls[0]?.[1];
    if (!init) throw new Error("CLOVA request init was not captured.");
    expect(init.headers).toEqual({ "X-OCR-SECRET": "ocr-secret" });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const message = JSON.parse(String(form.get("message"))) as {
      version: string;
      requestId: string;
      images: Array<{ format: string; name: string }>;
    };
    expect(message).toMatchObject({
      version: "V2",
      images: [{ format: "png", name: "business-card-abcdef123456" }],
    });
    expect(message.requestId).toBeTruthy();
    expect(String(form.get("message"))).not.toContain("ocr-secret");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("does not retry invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "0002" }, { status: 401 })),
    );
    const adapter = createClovaBusinessCardAdapter({
      invokeUrl: "https://example.apigw.ntruss.com/document/name-card",
      secret: "invalid",
    });

    await expect(
      adapter.execute({
        input: imageInput,
        model: "clova-ocr",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "CLOVA_HTTP_401_CODE_0002",
      retryable: false,
    });
  });

  it.each([429, 503])(
    "classifies HTTP %s as retryable without exposing the provider body",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { code: "9999", message: "internal provider detail ocr-secret" },
            { status },
          ),
        ),
      );
      const adapter = createClovaBusinessCardAdapter({
        invokeUrl: "https://example.apigw.ntruss.com/general",
        secret: "ocr-secret",
      });

      const error = await adapter
        .execute({
          input: imageInput,
          model: "clova-ocr",
          signal: new AbortController().signal,
        })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: `CLOVA_HTTP_${status}_CODE_9999`,
        retryable: true,
      });
      expect(String(error)).not.toContain("ocr-secret");
      expect(String(error)).not.toContain("internal provider detail");
    },
  );

  it("fails closed before fetch when the distributed cost guard is unavailable", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const adapter = createClovaBusinessCardAdapter({
      invokeUrl: "https://example.apigw.ntruss.com/general",
      secret: "ocr-secret",
      beforeRequest: async () => {
        throw new Error("database unavailable");
      },
    });

    await expect(
      adapter.execute({
        input: imageInput,
        model: "clova-ocr",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "OCR_GUARD_UNAVAILABLE",
      retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects unsupported WebP input before calling the provider", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const adapter = createClovaBusinessCardAdapter({
      invokeUrl: "https://example.apigw.ntruss.com/document/name-card",
      secret: "ocr-secret",
    });

    await expect(
      adapter.execute({
        input: { ...imageInput, mimeType: "image/webp" },
        model: "clova-ocr",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: "CLOVA_IMAGE_FORMAT_UNSUPPORTED",
      retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
  });
});
