import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BusinessCardCostLimitError,
  BusinessCardProcessingError,
} from "../../../server/application/business-card-service";
import { businessCardErrorResponse } from "./response";

describe("business card error response", () => {
  it("returns 429 before provider use with bounded retry metadata", async () => {
    const response = businessCardErrorResponse(
      new BusinessCardCostLimitError(
        "00000000-0000-4000-8000-000000000001",
        "OCR_RATE_LIMITED",
        60,
      ),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(payload).toMatchObject({
      code: "OCR_RATE_LIMITED",
      retryAfterSeconds: 60,
    });
  });

  it("does not expose provider details or secrets in a provider failure", async () => {
    const response = businessCardErrorResponse(
      new BusinessCardProcessingError(
        "00000000-0000-4000-8000-000000000001",
        "CLOVA_HTTP_503_CODE_9999",
      ),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(serialized).not.toContain("ocr-secret");
    expect(serialized).not.toContain("9999");
    expect(serialized).not.toContain("internal provider detail");
  });

  it("reports limiter storage failure as a sanitized 503", async () => {
    const response = businessCardErrorResponse(
      new BusinessCardProcessingError(
        "00000000-0000-4000-8000-000000000001",
        "OCR_GUARD_UNAVAILABLE",
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "OCR_GUARD_UNAVAILABLE",
    });
  });

  it.each([
    "CLOVA_HTTP_429_CODE_9999",
    "CLOVA_HTTP_400_CODE_0023",
    "CLOVA_HTTP_400_CODE_0025",
  ])("normalizes provider quota failures to a sanitized 429", async (code) => {
    const response = businessCardErrorResponse(
      new BusinessCardProcessingError(
        "00000000-0000-4000-8000-000000000001",
        code,
      ),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(serialized).toContain("CLOVA_PROVIDER_LIMIT_REACHED");
    expect(serialized).not.toContain("9999");
    expect(serialized).not.toContain("0023");
    expect(serialized).not.toContain("0025");
  });
});
